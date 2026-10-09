import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAppearance } from './appearance';
import { playOffer, playPing, stopOffer } from './sound';

export { freshIds } from './alertLogic';
import { freshIds, increased } from './alertLogic';

/**
 * Rings (sound + vibration) when a new trip request arrives and keeps ringing until the list is empty (answered or expired). `enabled` = the driver is online
 * and free. Stops at once when the app goes to the background (a ringing phone with the screen off is the push notification's job).
 */
export function useOfferAlert(ids: readonly string[], enabled: boolean) {
  const seen = useRef(new Set<string>()); const { offerSound } = useAppearance();
  const key = ids.join(',');
  useEffect(() => {
    if (!enabled || ids.length === 0) { stopOffer(); if (ids.length === 0) seen.current.clear(); return; }
    const fresh = freshIds(seen.current, ids); fresh.forEach((i) => seen.current.add(i));
    if (fresh.length) void playOffer({ sound: offerSound });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, offerSound]);
  useEffect(() => { const s = AppState.addEventListener('change', (st) => { if (st !== 'active') stopOffer(); }); return () => { s.remove(); stopOffer(); }; }, []);
}

/** A short ping when a counter goes up (unread messages) — never on the first value, so opening a screen is silent. */
export function usePingOnIncrease(n: number | undefined, enabled = true) {
  const { chatSound } = useAppearance(); enabled = enabled && chatSound;
  const prev = useRef<number | undefined>(undefined);
  useEffect(() => { const p = prev.current; prev.current = n; if (enabled && increased(p, n)) void playPing(); }, [n, enabled]);
}

/** A short ping when a value changes to one of the listed values (e.g. trip status becomes DRIVER_ARRIVED). Silent on the first value. */
export function usePingOnChange<T>(value: T | undefined, targets: readonly T[], enabled = true) {
  const { chatSound } = useAppearance(); enabled = enabled && chatSound;
  const prev = useRef<T | undefined>(undefined); const first = useRef(true);
  useEffect(() => { const was = prev.current; prev.current = value; if (first.current) { first.current = false; return; } if (enabled && value !== was && value !== undefined && targets.includes(value)) void playPing(); }, [value, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
