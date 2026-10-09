// Appearance, accessibility and data-saving preferences (dark mode, large text, low-data, app lock settings).
// A tiny external store so non-React code (the API client) and React (useSyncExternalStore) read the same values.
// Persisted in kv. On web the stored value is also read synchronously at import, so the first paint already has the right palette.
import { useSyncExternalStore } from 'react';
import { Appearance as RNAppearance, Platform } from 'react-native';
import { kv } from './storage';
import { applyPalette } from '../ui/theme';
import { resolveTheme } from './palette';
import { DEFAULT_PREFS, parsePrefs, type Prefs } from './prefs';
import { setTimeFormat } from './format';
export { LOCK_CHOICES, TEXT_SCALES, VOLUMES, DEFAULT_PREFS, parsePrefs, type Prefs } from './prefs';

const KEY = 'rm_appearance';

let prefs: Prefs = { ...DEFAULT_PREFS }; let version = 0; let loaded = false;
const subs = new Set<() => void>();
const system = () => { try { return RNAppearance.getColorScheme(); } catch { return 'light'; } };
let snapshot = { ...prefs, resolved: 'light' as 'light' | 'dark', version, loaded };
function commit() {
  setTimeFormat(prefs.timeFormat);
  const resolved = resolveTheme(prefs.theme, system());
  applyPalette(resolved); version++;
  snapshot = { ...prefs, resolved, version, loaded }; subs.forEach((f) => f());
}
if (Platform.OS === 'web') { try { const raw = (globalThis as any).localStorage?.getItem(KEY); if (raw) { prefs = parsePrefs(raw); loaded = true; } } catch { /* no storage */ } }
commit();
try { RNAppearance.addChangeListener(() => { if (prefs.theme === 'system') commit(); }); } catch { /* not available */ }

export const appearance = {
  get: () => snapshot,
  isLowData: () => prefs.lowData,
  subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
  async load() { try { prefs = parsePrefs(await kv.get(KEY)); } catch { /* keep defaults */ } loaded = true; commit(); },
  async set(patch: Partial<Prefs>) { prefs = { ...prefs, ...patch, ...(patch.textScale !== undefined ? { largeText: patch.textScale > 1 } : patch.largeText !== undefined ? { textScale: patch.largeText ? 1.25 : 1 } : {}) }; commit(); try { await kv.set(KEY, JSON.stringify(prefs)); } catch { /* not persisted */ } },
};
export const useAppearance = () => useSyncExternalStore(appearance.subscribe, appearance.get, appearance.get);
