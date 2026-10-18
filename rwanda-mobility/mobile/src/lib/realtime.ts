import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import type { Client } from './net';

/**
 * Instant updates without a socket: one held request ("long poll") asks the server to answer as soon as something changes for this user
 * (a new offer, a booking step, a chat message) or after ~25 seconds. Works on every phone and browser with plain fetch.
 * A change only nudges the screens that poll quickly to refresh now; while it works those screens can poll much less often,
 * and when it fails they fall back to their normal polling, so nothing depends on it.
 */
let tick = 0, ok = false; const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useRtTick = () => useSyncExternalStore(sub, () => tick, () => tick);
export const useRtOk = () => useSyncExternalStore(sub, () => ok, () => ok);
const setOk = (v: boolean) => { if (ok !== v) { ok = v; emit(); } };
const bump = () => { tick++; emit(); };

export const WAIT_S = 25;

export function startRealtime(client: Client): () => void {
  let stop = false, cursor: number | null = null, fails = 0;
  const fg = () => AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
  const nap = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const loop = async () => {
    while (!stop) {
      if (!fg()) { setOk(false); await nap(2000); continue; }
      try {
        const q = cursor == null ? '' : `?since=${cursor}&timeout_s=${WAIT_S}`;
        const r = await client.get<{ cursor: number; events: string[] }>(`/realtime/wait${q}`, { timeoutMs: (WAIT_S + 10) * 1000, maxRetries: 0 });
        fails = 0; setOk(true);
        if (cursor != null && r.events.length) bump();
        cursor = r.cursor;
      } catch {
        fails++; setOk(false); await nap(Math.min(3000 * 2 ** Math.min(fails, 3), 20000));
      }
    }
  };
  void loop();
  return () => { stop = true; setOk(false); };
}
