import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import * as Location from 'expo-location';
import { useApp, usePoll } from './app';
import type { Booking } from './types';
import type { TKey } from './i18n';
import { showAlert } from '../ui/dialog';

/** unknown = never asked; denied = can ask again; blocked = "don't ask again" (only system settings can fix it); off = GPS/location services switched off. */
export type LocPerm = 'unknown' | 'granted' | 'denied' | 'blocked' | 'off';
export type Fix = { lat: number; lng: number; accuracy: number | null };

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> => new Promise<T>((res, rej) => { const id = setTimeout(() => rej(new Error('timeout')), ms); p.then((v) => { clearTimeout(id); res(v); }, (e) => { clearTimeout(id); rej(e); }); });
export const openAppSettings = () => { void Linking.openSettings().catch(() => {}); };

/** Foreground location with explicit permission states, recovery (re-check when the user returns from settings) and a timeout so a missing GPS fix never hangs the UI. */
export function useLocate() {
  const [perm, setPerm] = useState<LocPerm>('unknown'); const [busy, setBusy] = useState(false);
  const live = useRef(true); useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const set = useCallback((p: LocPerm) => { if (live.current) setPerm(p); }, []);
  const check = useCallback(async (): Promise<LocPerm> => {
    try {
      const p = await Location.getForegroundPermissionsAsync();
      const r: LocPerm = p.granted ? 'granted' : p.status === 'undetermined' ? 'unknown' : p.canAskAgain === false ? 'blocked' : 'denied';
      set(r); return r;
    } catch { return 'unknown'; }
  }, [set]);
  useEffect(() => { void check(); const s = AppState.addEventListener('change', (st) => { if (st === 'active') void check(); }); return () => s.remove(); }, [check]);
  const request = useCallback(async (): Promise<boolean> => {
    try {
      const p = await Location.requestForegroundPermissionsAsync();
      if (!p.granted) { set(p.canAskAgain === false ? 'blocked' : 'denied'); return false; }
      set('granted'); return true;
    } catch { set('denied'); return false; }
  }, [set]);
  /** Ask if needed, then read one position. Returns null (and sets `perm`) when it cannot. */
  const locate = useCallback(async (): Promise<Fix | null> => {
    setBusy(true);
    try {
      if (!(await request())) return null;
      try { if (!(await Location.hasServicesEnabledAsync())) { set('off'); return null; } } catch { /* web */ }
      try {
        const pos = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 12000);
        return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null };
      } catch {
        const last = await Location.getLastKnownPositionAsync().catch(() => null);
        return last ? { lat: last.coords.latitude, lng: last.coords.longitude, accuracy: last.coords.accuracy ?? null } : null;
      }
    } finally { if (live.current) setBusy(false); }
  }, [request, set]);
  /** Permission granted AND location services on (no position read): the gate for "Go online". Sets `perm` so the UI can show the right recovery card. */
  const ensure = useCallback(async (): Promise<boolean> => {
    if (!(await request())) return false;
    try { if (!(await Location.hasServicesEnabledAsync())) { set('off'); return false; } } catch { /* web */ }
    return true;
  }, [request, set]);
  return { perm, busy, check, request, ensure, locate, openSettings: openAppSettings };
}

/**
 * The booking a passenger is looking at: by id, or the active one (right after an offline request). Polls every `ms`, pauses in the background,
 * keeps showing the last good data while a poll fails (`stale` = true) instead of flashing an error.
 */
export function useTrip(id: string | undefined, ms: number, extraDeps: unknown[] = []) {
  const { client } = useApp();
  const poll = usePoll<Booking | null>(async () => (id ? await client.get<Booking>(`/bookings/${id}`) : (await client.get<{ booking: Booking | null }>('/bookings/active?role=passenger')).booking), ms, [id, ...extraDeps]);
  return { booking: poll.data, error: poll.error, stale: !!poll.error && !!poll.data, reload: poll.reload, loaded: poll.loaded };
}

/** Camera / photo permission refused: explain, and (when the OS will not ask again) offer the system settings. */
export function explainCameraDenied(t: (k: TKey) => string, blocked: boolean) {
  showAlert(t('perm.camera.title'), t('perm.camera.body'), blocked
    ? [{ text: t('common.cancel'), style: 'cancel' }, { text: t('perm.settings'), onPress: openAppSettings }]
    : [{ text: t('common.close'), style: 'cancel' }]);
}
