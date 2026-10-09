// Driver location sharing that outlives any single screen: it keeps running while the driver opens Help or a map, and stops only when the driver goes
// offline, leaves driver mode, signs out or the app is closed. Working (the driver home) only tells it whether the driver is online / on a trip.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Location from 'expo-location';
import { useApp } from './app';
import { ApiError } from './net';
import { kv } from './storage';
import { shouldTrack } from './trip';
import { BG_TASK, bgSupported, startBgLocation, stopBgLocation } from './bgLocation';

type State = { online: boolean; onTrip: boolean; pos: { lat: number; lng: number } | null; lastFixAt: number; forbiddenAt: number; bgDenied: boolean };
let state: State = { online: false, onTrip: false, pos: null, lastFixAt: 0, forbiddenAt: 0, bgDenied: false };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
export const setDriverTracking = (p: Partial<Pick<State, 'online' | 'onTrip'>>) => set(p);
export const useDriverTracking = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state);
export const consentKeyFor = () => (bgSupported ? 'rm_drv_bg_consent' : 'rm_drv_loc_consent');

/** Renders nothing. Mount once inside AppProvider. */
export function DriverTracker() {
  const { client, mode, me, lang, say, t } = useApp(); const tr = useDriverTracking();
  const bgOn = useRef(false); const sub = useRef<Location.LocationSubscription | null>(null);
  const [consent, setConsent] = useState(false);
  // The consent flag lives in storage and is written before "Go online" is possible; re-read whenever the driver state changes.
  useEffect(() => { let live = true; kv.get(consentKeyFor()).then((x) => { if (live) setConsent(x === '1'); }).catch(() => {}); return () => { live = false; }; }, [tr.online, tr.onTrip, mode]);
  const active = !!me && shouldTrack({ mode, consent, online: tr.online, onTrip: tr.onTrip });

  useEffect(() => {
    if (!active) { sub.current?.remove(); sub.current = null; return; }
    let cancelled = false;
    (async () => {
      try {
        const p = await Location.requestForegroundPermissionsAsync(); if (p.status !== 'granted' || cancelled) return;
        const s = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 15 }, (l) => {
          set({ pos: { lat: l.coords.latitude, lng: l.coords.longitude }, lastFixAt: Date.now() });
          if (bgOn.current) return;   // the background task is already posting
          client.post('/drivers/me/location', { lat: l.coords.latitude, lng: l.coords.longitude, mocked: (l as any).mocked === true ? true : undefined, accuracy: l.coords.accuracy ?? undefined, speed: l.coords.speed != null && l.coords.speed >= 0 ? l.coords.speed : undefined, recorded_at: new Date(l.timestamp).toISOString() }, { retry: false }).catch((e) => { if (e instanceof ApiError && e.status === 403) set({ forbiddenAt: Date.now() }); });
        });
        if (cancelled) s.remove(); else sub.current = s;
      } catch { /* location unavailable: the driver home shows a "no GPS" banner */ }
    })();
    return () => { cancelled = true; sub.current?.remove(); sub.current = null; };
  }, [active, client]);

  // Android foreground service for background sharing; re-checked every 30 s in case the OS stopped it.
  useEffect(() => {
    if (!bgSupported) return;
    if (!active) { bgOn.current = false; void stopBgLocation(); return; }
    let cancelled = false;
    const start = () => startBgLocation(lang).then((r) => { if (cancelled) return; bgOn.current = r === 'started'; set({ bgDenied: r === 'denied' }); if (r === 'denied') say(t('drv.bg.denied')); });
    void start();
    const timer = setInterval(() => { void (async () => { try { if (!(await Location.hasStartedLocationUpdatesAsync(BG_TASK))) { bgOn.current = false; await start(); } } catch { /* ignore */ } })(); }, 30000);
    return () => { cancelled = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, lang]);
  useEffect(() => () => { bgOn.current = false; void stopBgLocation(); }, []);
  return null;
}
