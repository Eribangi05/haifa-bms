import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { API_URL } from '../config';
import { Client, ApiError, createClient, createOutbox, Outbox } from './net';
import { getDeviceId, kv, loadJson, saveJson, tokenStore } from './storage';
import { Lang, TKey, isLang, translate } from './i18n';

export type Route = { name: string; params?: any };
export type Me = { id: string; phone: string; display_name?: string | null; email?: string | null; preferred_language: string; roles: string[]; referral_code?: string; notif_prefs?: any };
export type AppConfig = { payment_methods: { id: string; enabled: boolean; simulated?: boolean }[]; emergency_numbers: { police: string; ambulance: string }; features: Record<string, boolean>;
  abasare?: { enabled: boolean; packages: number[]; min_hours: number; max_hours: number; min_photos: number } };

type Ctx = {
  ready: boolean; lang: Lang; setLang: (l: Lang) => void; t: (k: TKey, v?: Record<string, string | number>) => string;
  client: Client; outbox: Outbox; me: Me | null; refreshMe: () => Promise<void>; signedIn: (roles?: string[]) => Promise<void>; signOut: () => Promise<void>;
  online: boolean; cfg: AppConfig | null; toast: string | null; say: (m: string) => void;
  nav: { stack: Route[]; push: (name: string, params?: any) => void; pop: () => void; reset: (name: string, params?: any) => void; replace: (name: string, params?: any) => void };
  mode: 'passenger' | 'driver'; setMode: (m: 'passenger' | 'driver') => void; pendingOutbox: number;
};
const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

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

  const client = useMemo(() => createClient({ baseUrl: API_URL, tokens: tokenStore, deviceId: () => deviceRef.current, lang: () => langRef.current, onAuthLost: () => authLost.current() }), []);
  const outbox = useMemo(() => createOutbox(kv, client), [client]);
  const say = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); }, []);

  const nav = useMemo(() => ({
    stack,
    push: (name: string, params?: any) => setStack((s) => [...s, { name, params }]),
    pop: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    reset: (name: string, params?: any) => setStack([{ name, params }]),
    replace: (name: string, params?: any) => setStack((s) => [...s.slice(0, -1), { name, params }]),
  }), [stack]);

  useEffect(() => {
    const h = BackHandler.addEventListener('hardwareBackPress', () => { if (stack.length > 1) { nav.pop(); return true; } return false; });
    return () => h.remove();
  }, [stack, nav]);

  const setLang = useCallback((l: Lang) => {
    langRef.current = l; setLangState(l); void kv.set('rm_lang', l);
    void tokenStore.get().then((tk) => { if (tk) client.patch('/users/me', { preferred_language: l }).catch(() => { /* offline: stored locally, synced on next sign-in */ }); });
  }, [client]);
  const t = useCallback((k: TKey, v?: Record<string, string | number>) => translate(lang, k, v), [lang]);

  const refreshMe = useCallback(async () => {
    try { const u = await client.get<Me>('/users/me'); setMe(u); await saveJson('rm_me', u); if (isLang(u.preferred_language)) { langRef.current = u.preferred_language; setLangState(u.preferred_language); } }
    catch (e) { if (e instanceof ApiError && e.isNetwork) { const cached = await loadJson<Me | null>('rm_me', null); if (cached) setMe(cached); } else throw e; }
  }, [client]);

  const signOut = useCallback(async () => {
    try { await client.post('/auth/logout'); } catch { /* ignore */ }
    await tokenStore.set(null); await kv.del('rm_me'); setMe(null); setModeState('passenger'); setStack([{ name: 'welcome' }]);
  }, [client]);
  authLost.current = () => { setMe(null); setStack([{ name: 'welcome' }]); };

  const signedIn = useCallback(async () => { await refreshMe(); setStack([{ name: 'home' }]); }, [refreshMe]);
  const setMode = useCallback((m: 'passenger' | 'driver') => { setModeState(m); void kv.set('rm_mode', m); setStack([{ name: m === 'driver' ? 'driverHome' : 'home' }]); }, []);

  // boot
  useEffect(() => {
    (async () => {
      deviceRef.current = await getDeviceId();
      const l = (await kv.get('rm_lang')) as Lang | null; if (isLang(l)) { langRef.current = l; setLangState(l); }
      const m = (await kv.get('rm_mode')) as 'passenger' | 'driver' | null;
      try { setCfg(await client.get<AppConfig>('/config')); } catch { /* offline */ }
      const tk = await tokenStore.get();
      if (tk) {
        try { await refreshMe(); } catch { /* invalid session: tokens cleared by client */ }
        const cached = await loadJson<Me | null>('rm_me', null);
        if (cached || (await tokenStore.get())) { const drv = m === 'driver' && (cached?.roles ?? []).includes('driver'); setModeState(drv ? 'driver' : 'passenger'); setStack([{ name: drv ? 'driverHome' : 'home' }]); }
        else setStack([{ name: 'welcome' }]);
      } else setStack([{ name: l ? 'phone' : 'welcome' }]);
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // connectivity + outbox flushing
  useEffect(() => {
    const flush = () => outbox.flush().catch(() => {});
    const unsub = NetInfo.addEventListener((s) => { const on = !!(s.isConnected && s.isInternetReachable !== false); setOnline(on); if (on) flush(); });
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') flush(); });
    const off = outbox.onChange(() => outbox.list().then((l) => setPending(l.length)));
    const iv = setInterval(flush, 20000); outbox.list().then((l) => setPending(l.length));
    return () => { unsub(); sub.remove(); off(); clearInterval(iv); };
  }, [outbox]);

  const value: Ctx = { ready, lang, setLang, t, client, outbox, me, refreshMe, signedIn, signOut, online, cfg, toast, say, nav, mode, setMode, pendingOutbox };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

/** Poll an async function; pauses while the screen is unmounted, backs off after failures, never overlaps calls. */
export function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[] = [], enabled = true) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState<ApiError | null>(null);
  const fnRef = useRef(fn); fnRef.current = fn;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return; let stop = false; let timer: ReturnType<typeof setTimeout>; let fails = 0;
    const run = async () => {
      try { const d = await fnRef.current(); if (!stop) { setData(d); setError(null); fails = 0; } }
      catch (e) { fails++; if (!stop) setError(e as ApiError); }
      if (!stop) timer = setTimeout(run, Math.min(ms * 2 ** Math.min(fails, 3), 15000));
    };
    run(); return () => { stop = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, enabled, tick, ...deps]);
  return { data, error, reload: () => setTick((x) => x + 1), setData };
}

export function useAsync() {
  const [busy, setBusy] = useState(false);
  const { say } = useApp();
  const run = useCallback(async <T,>(fn: () => Promise<T>, opts: { silent?: boolean } = {}): Promise<T | undefined> => {
    setBusy(true);
    try { return await fn(); } catch (e: any) { if (!opts.silent) say(e?.message ?? 'Error'); return undefined; } finally { setBusy(false); }
  }, [say]);
  return { busy, run };
}
