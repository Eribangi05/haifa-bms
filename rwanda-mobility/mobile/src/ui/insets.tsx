import React from 'react';
import { Platform } from 'react-native';
import { SafeAreaInsetsContext, type EdgeInsets } from 'react-native-safe-area-context';

/** Web-only test hook: `?insets=top:44,bottom:48,left:0,right:0` simulates a notch / gesture bar so layouts can be checked in a browser. Ignored on native. */
export function parseInsets(search: string): EdgeInsets | null {
  const m = /[?&]insets=([^&#]*)/.exec(search); if (!m) return null;
  const out: EdgeInsets = { top: 0, bottom: 0, left: 0, right: 0 };
  for (const part of decodeURIComponent(m[1]).split(',')) {
    const [k, v] = part.split(':'); const n = Number(v);
    if ((k === 'top' || k === 'bottom' || k === 'left' || k === 'right') && Number.isFinite(n) && n >= 0 && n <= 200) out[k] = n;
  }
  return out;
}
let cached: EdgeInsets | null | undefined;
const override = (): EdgeInsets | null => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  if (cached === undefined) { try { cached = parseInsets(window.location.search); if (cached) window.sessionStorage?.setItem('rm_insets', window.location.search); else { const s = window.sessionStorage?.getItem('rm_insets'); cached = s ? parseInsets(s) : null; } } catch { cached = null; } }
  return cached;
};

/** Place inside every SafeAreaProvider (app root and each Modal): applies the simulated insets on web, otherwise passes children through. */
export function InsetsGate({ children }: { children: React.ReactNode }) {
  const o = override();
  return o ? <SafeAreaInsetsContext.Provider value={o}>{children}</SafeAreaInsetsContext.Provider> : <>{children}</>;
}
