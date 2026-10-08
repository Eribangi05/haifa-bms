import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { API_URL } from '../config';
import { Client, ApiError, createClient, createOutbox, Outbox } from './net';
import { getDeviceId, kv, loadJson, saveJson, tokenStore } from './storage';
import { stopBgLocation, setBgClient } from './bgLocation';
import { unregisterPush } from './push';
import { Lang, TKey, isLang, translate } from './i18n';
import { errorText } from './errors';
import { appearance, useAppearance } from './appearance';

export type Route = { name: string; params?: any };
export type Me = { id: string; phone: string; display_name?: string | null; email?: string | null; preferred_language: string; roles: string[]; referral_code?: string; notif_prefs?: Record<string, boolean> };
export type AppConfig = { payment_methods: { id: string; enabled: boolean; simulated?: boolean }[]; emergency_numbers: { police: string; ambulance: string }; features: Record<string, boolean>;
  abasare?: { enabled: boolean; packages: number[]; min_hours: number; max_hours: number; min_photos: number } };
export type Nav = { stack: Route[]; push: (name: string, params?: any) => void; pop: () => void; reset: (name: string, params?: any) => void; replace: (name: string, params?: any) => void };

type Ctx = {
  ready: boolean; lang: Lang; setLang: (l: Lang) => void; t: (k: TKey, v?: Record<string, string | number>) => string;
  client: Client; outbox: Outbox; me: Me | null; refreshMe: () => Promise<void>; signedIn: (roles?: string[]) => Promise<void>; signOut: () => Promise<void>;
  online: boolean; cfg: AppConfig | null; toast: string | null; say: (m: string) => void; errMsg: (e: unknown) => string;
  nav: Nav; mode: 'passenger' | 'driver'; setMode: (m: 'passenger' | 'driver') => void; pendingOutbox: number;
  /** Register a handler for the system back gesture/button (modals, sheets, wizard steps). Return true when handled. Latest registration runs first. */
  registerBack: (fn: () => boolean) => () => void;
};
const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

/** Close sheets / step back inside a screen before the system back leaves the screen. `active` = only while the sheet is open. */
export function useBackHandler(fn: () => boolean, active = true) {
  const { registerBack } = useApp(); const ref = useRef(fn); ref.current = fn;
  useEffect(() => (active ? registerBack(() => ref.current()) : undefined), [active, registerBack]);
}

const EXIT_WINDOW_MS = 2000;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [lang, setLangState] = useState<Lang>('rw');
  const [me, setMe] = useState<Me | null>(null);
  const [online, setOnline] = useState(true);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [stack, setStack] = useState<Route[]>([{ name: 'boot' }]);
  const [mode, setModeState] = useState<'passenger' | 'driver'>('passenger');
  const [pendingOutbox, setPending] = useState(0);
  const langRef = useRef<Lang>('rw'); const deviceRef = useRef('dev');
  const authLost = useRef<() => void>(() => {});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backs = useRef<(() => boolean)[]>([]); const lastBack = useRef(0);

  const client = useMemo(() => { const c = createClient({ baseUrl: API_URL, tokens: tokenStore, deviceId: () => deviceRef.current, lang: () => langRef.current, onAuthLost: () => authLost.current(), lowData: () => appearance.isLowData() }); setBgClient(c); return c; }, []);
  const outbox = useMemo(() => createOutbox(kv, client), [client]);
  const t = useCallback((k: TKey, v?: Record<string, string | number>) => translate(lang, k, v), [lang]);
  const say = useCallback((m: string) => { if (toastTimer.current) clearTimeout(toastTimer.current); setToast(m); toastTimer.current = setTimeout(() => setToast(null), 3500); }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const errMsg = useCallback((e: unknown) => errorText(t, e), [t]);

  const nav = useMemo<Nav>(() => ({
    stack,
    // A double tap must not push the same screen twice.
    push: (name, params) => setStack((s) => { const top = s[s.length - 1]; return top && top.name === name && JSON.stringify(top.params) === JSON.stringify(params) ? s : [...s, { name, params }]; }),
    pop: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    reset: (name, params) => setStack([{ name, params }]),
    replace: (name, params) => setStack((s) => [...s.slice(0, -1), { name, params }]),
  }), [stack]);

  const setMode = useCallback((m: 'passenger' | 'driver') => { setModeState(m); void kv.set('rm_mode', m); setStack([{ name: m === 'driver' ? 'driverHome' : 'home' }]); }, []);
  const registerBack = useCallback((fn: () => boolean) => { backs.current.push(fn); return () => { backs.current = backs.current.filter((x) => x !== fn); }; }, []);

  // Android back / gesture: overlays first, then pop, then sensible roots (never a silent exit from the middle of a flow).
  useEffect(() => {
    const h = BackHandler.addEventListener('hardwareBackPress', () => {
      for (const fn of [...backs.current].reverse()) if (fn()) return true;
      if (stack.length > 1) { nav.pop(); return true; }
      const top = stack[0]?.name;
      if (top === 'welcome' || top === 'boot') return false;
      if (top === 'phone') { nav.replace('welcome'); return true; }
      if (top === 'home' || top === 'driverHome') {   // never leave driver mode (and go offline) by accident: press twice to exit the app
        if (Date.now() - lastBack.current < EXIT_WINDOW_MS) return false;   // second press inside the window exits
        lastBack.current = Date.now(); say(translate(langRef.current, 'exit.again')); return true;
      }
      nav.reset(mode === 'driver' ? 'driverHome' : 'home'); return true;
    });
    return () => h.remove();
  }, [stack, nav, mode, say, setMode]);

  const setLang = useCallback((l: Lang) => {
    langRef.current = l; setLangState(l); void kv.set('rm_lang', l);
    void tokenStore.get().then((tk) => { if (tk) client.patch('/users/me', { preferred_language: l }).catch(() => { /* offline: stored locally, synced on next sign-in */ }); });
  }, [client]);

  const refreshMe = useCallback(async (fast = false) => {
    try { const u = await client.get<Me>('/users/me', fast ? { maxRetries: 0, timeoutMs: 7000 } : {}); setMe(u); await saveJson('rm_me', u); if (isLang(u.preferred_language)) { langRef.current = u.preferred_language; setLangState(u.preferred_language); } }
    catch (e) { if (e instanceof ApiError && e.isNetwork) { const cached = await loadJson<Me | null>('rm_me', null); if (cached) setMe(cached); } else throw e; }
  }, [client]);

  const signOut = useCallback(async () => {
    await stopBgLocation(); await unregisterPush(client);
    try { await client.post('/auth/logout', undefined, { timeoutMs: 5000 }); } catch { /* ignore */ }
    client.clearCache(); await tokenStore.set(null); await kv.del('rm_me'); await outbox.clear();   // never let a queued request of this user run as the next user
    setMe(null); setModeState('passenger'); setStack([{ name: 'welcome' }]);
  }, [client, outbox]);
  // Refresh token rejected (revoked / expired session): drop to the welcome screen and say why.
  authLost.current = () => { void stopBgLocation(); void kv.del('rm_me'); setMe(null); setModeState('passenger'); setStack([{ name: 'welcome' }]); say(translate(langRef.current, 'err.session')); };

  // A profile fetch hiccup right after a successful sign-in must not strand the user on the OTP screen (the tokens are already stored).
  const signedIn = useCallback(async () => { try { await refreshMe(); } catch { /* retried when the app is online again */ } setStack([{ name: 'home' }]); }, [refreshMe]);

  // boot: never block on the network. Cached profile + config let the app start offline; fresh data arrives in the background.
  useEffect(() => {
    (async () => {
      deviceRef.current = await getDeviceId();
      const l = (await kv.get('rm_lang')) as Lang | null; if (isLang(l)) { langRef.current = l; setLangState(l); }
      const m = (await kv.get('rm_mode')) as 'passenger' | 'driver' | null;
      const cachedCfg = await loadJson<AppConfig | null>('rm_cfg', null); if (cachedCfg) setCfg(cachedCfg);
      void client.get<AppConfig>('/config', { maxRetries: 1, timeoutMs: 7000 }).then((c) => { setCfg(c); void saveJson('rm_cfg', c); }).catch(() => { /* offline: cached or none */ });
      const tk = await tokenStore.get();
      if (!tk) { setStack([{ name: l ? 'phone' : 'welcome' }]); setReady(true); return; }
      let cached = await loadJson<Me | null>('rm_me', null);
      if (cached) { setMe(cached); void refreshMe(true).catch(() => { /* 401 handled by authLost; other errors: keep cached profile */ }); }
      else { try { await refreshMe(true); } catch { /* handled below */ } cached = await loadJson<Me | null>('rm_me', null); }
      if (!(await tokenStore.get())) { setStack([{ name: 'welcome' }]); setReady(true); return; }   // the session was rejected while booting
      const drv = m === 'driver' && (cached?.roles ?? []).includes('driver');
      setModeState(drv ? 'driver' : 'passenger'); setStack([{ name: drv ? 'driverHome' : 'home' }]); setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // connectivity + outbox flushing; if we started offline without a profile, fetch it when the network returns
  const meRef = useRef(me); meRef.current = me;
  useEffect(() => {
    const flush = () => outbox.flush().catch(() => {});
    const unsub = NetInfo.addEventListener((s) => {
      const on = !!(s.isConnected && s.isInternetReachable !== false); setOnline(on);
      if (on) { flush(); if (!meRef.current) void tokenStore.get().then((tk) => { if (tk) void refreshMe(true).catch(() => {}); }); }
    });
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') flush(); });
    const off = outbox.onChange(() => outbox.list().then((l) => setPending(l.length)));
    const iv = setInterval(flush, 20000); outbox.list().then((l) => setPending(l.length));
    return () => { unsub(); sub.remove(); off(); clearInterval(iv); };
  }, [outbox, refreshMe]);

  const value: Ctx = useMemo(() => ({ ready, lang, setLang, t, client, outbox, me, refreshMe: () => refreshMe(), signedIn, signOut, online, cfg, toast, say, errMsg, nav, mode, setMode, pendingOutbox, registerBack }),
    [ready, lang, setLang, t, client, outbox, me, refreshMe, signedIn, signOut, online, cfg, toast, say, errMsg, nav, mode, setMode, pendingOutbox, registerBack]);
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

/** Poll an async function; pauses while the screen is unmounted or the app is in the background, backs off after failures, never overlaps calls. */
export function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[] = [], enabled = true) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState<ApiError | null>(null); const [loaded, setLoaded] = useState(false);
  const fnRef = useRef(fn); fnRef.current = fn;
  if (useAppearance().lowData) ms = ms * 2.5;   // low-data mode: poll less often
  const [tick, setTick] = useState(0);
  const [fg, setFg] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useEffect(() => { const s = AppState.addEventListener('change', (st) => setFg(st === 'active')); return () => s.remove(); }, []);
  useEffect(() => {
    if (!enabled || !fg) return; let stop = false; let timer: ReturnType<typeof setTimeout>; let fails = 0;
    const run = async () => {
      try { const d = await fnRef.current(); if (!stop) { setData(d); setError(null); setLoaded(true); fails = 0; } }
      catch (e) { fails++; if (!stop) { setError(e as ApiError); setLoaded(true); } }
      if (!stop) timer = setTimeout(run, Math.min(ms * 2 ** Math.min(fails, 3), 15000));
    };
    void run(); return () => { stop = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, enabled, fg, tick, ...deps]);
  const reload = useCallback(() => setTick((x) => x + 1), []);
  return { data, error, loaded, reload, setData };
}

/** Run an async action with a busy flag. Ignores a second call while one is running (double-tap / double-submit safe) and shows a localised error toast. */
export function useAsync() {
  const [busy, setBusy] = useState(false); const inflight = useRef(false);
  const { say, errMsg } = useApp();
  const run = useCallback(async <T,>(fn: () => Promise<T>, opts: { silent?: boolean } = {}): Promise<T | undefined> => {
    if (inflight.current) return undefined;
    inflight.current = true; setBusy(true);
    try { return await fn(); } catch (e) { if (!opts.silent) say(errMsg(e)); return undefined; } finally { inflight.current = false; setBusy(false); }
  }, [say, errMsg]);
  return { busy, run };
}
