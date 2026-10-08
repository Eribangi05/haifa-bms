// Appearance preference model + defensive parsing. Platform-free (unit-tested).
import type { ThemePref } from './palette';
const isThemePref = (x: unknown): x is ThemePref => x === 'system' || x === 'light' || x === 'dark';
export type Prefs = { theme: ThemePref; largeText: boolean; lowData: boolean; lockEnabled: boolean; lockMinutes: number };
export const DEFAULT_PREFS: Prefs = { theme: 'system', largeText: false, lowData: false, lockEnabled: false, lockMinutes: 1 };
export const LOCK_CHOICES = [0, 1, 5, 15] as const;

/** Parse a stored value defensively (unknown/invalid fields fall back to defaults). Pure: unit-tested. */
export function parsePrefs(raw: string | null | undefined): Prefs {
  try {
    const j = raw ? JSON.parse(raw) : {};
    return {
      theme: isThemePref(j.theme) ? j.theme : 'system', largeText: j.largeText === true, lowData: j.lowData === true, lockEnabled: j.lockEnabled === true,
      lockMinutes: (LOCK_CHOICES as readonly number[]).includes(j.lockMinutes) ? j.lockMinutes : 1,
    };
  } catch { return { ...DEFAULT_PREFS }; }
}

