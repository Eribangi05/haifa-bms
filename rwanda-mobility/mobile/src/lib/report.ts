// Crash / error reporting: global JS handlers + manual reports (error boundary). Sends a scrubbed, truncated record to POST /client-errors
// through the platform-free API client. Rate-limited per session; failures are swallowed (offline reports are simply dropped).
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import type { Client } from './net';

const MAX_PER_SESSION = 5;
let sent = 0; const seen = new Set<string>();
let ctx: { client: Client; lang: () => string; screen: () => string } | null = null;
let installed = false;

/** Strip phone numbers, emails and bearer/JWT-like tokens; cap length. No user content should reach the server. */
export const scrub = (s: unknown, max: number): string => String(s ?? '')
  .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]').replace(/\+?\d[\d\s-]{7,}\d/g, '[num]')
  .replace(/Bearer\s+[\w.-]+/gi, 'Bearer [token]').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt]').slice(0, max);

export function reportError(err: unknown, fatal = false) {
  try {
    if (!ctx || sent >= MAX_PER_SESSION) return;
    const e = err as any; const message = scrub(e?.message ?? e, 300) || 'unknown error'; const stack = scrub(e?.stack ?? '', 2000);
    const sig = message + stack.slice(0, 80); if (seen.has(sig)) return; seen.add(sig); sent++;
    void ctx.client.post('/client-errors', { message: fatal ? '[fatal] ' + message : message, stack, app_version: Constants.expoConfig?.version ?? 'unknown', platform: Platform.OS, screen: ctx.screen(), lang: ctx.lang() }, { retry: false, timeoutMs: 5000 }).catch(() => {});
  } catch { /* reporting must never throw */ }
}

export function installErrorReporting(c: NonNullable<typeof ctx>) {
  ctx = c;
  if (installed) return; installed = true;
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
    window.addEventListener('error', (ev) => reportError(ev.error ?? ev.message));
    window.addEventListener('unhandledrejection', (ev) => reportError((ev as PromiseRejectionEvent).reason));
    return;
  }
  const EU = (globalThis as any).ErrorUtils;
  if (EU?.setGlobalHandler) {
    const prev = EU.getGlobalHandler?.();
    EU.setGlobalHandler((error: unknown, isFatal?: boolean) => { reportError(error, !!isFatal); prev?.(error, isFatal); });
  }
}
