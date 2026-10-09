// Appearance preference model + defensive parsing. Platform-free (unit-tested).
import type { ThemePref } from './palette';
const isThemePref = (x: unknown): x is ThemePref => x === 'system' || x === 'light' || x === 'dark';
export const TEXT_SCALES = [0.9, 1, 1.25, 1.5] as const;           // small, normal, large, extra large
export const VOLUMES = [0.25, 0.5, 0.75, 1] as const;
export type Prefs = { theme: ThemePref; largeText: boolean; textScale: number; lowData: boolean; lockEnabled: boolean; lockMinutes: number; offerSound: boolean; chatSound: boolean; voiceNav: boolean; timeFormat: '24h' | '12h'; weekStart: 0 | 1; soundVolume: number; vibrate: boolean };
export const DEFAULT_PREFS: Prefs = { theme: 'system', largeText: false, textScale: 1, lowData: false, lockEnabled: false, lockMinutes: 1, offerSound: true, chatSound: true, voiceNav: true, timeFormat: '24h', weekStart: 1, soundVolume: 1, vibrate: true };
export const LOCK_CHOICES = [0, 1, 5, 15] as const;

/** Parse a stored value defensively (unknown/invalid fields fall back to defaults). Pure: unit-tested. */
export function parsePrefs(raw: string | null | undefined): Prefs {
  try {
    const j = raw ? JSON.parse(raw) : {};
    const textScale = (TEXT_SCALES as readonly number[]).includes(j.textScale) ? j.textScale : j.largeText === true ? 1.25 : 1;      // older installs only had "large text" on/off
    return {
      theme: isThemePref(j.theme) ? j.theme : 'system', largeText: textScale > 1, textScale, lowData: j.lowData === true, lockEnabled: j.lockEnabled === true,
      lockMinutes: Number.isInteger(j.lockMinutes) && j.lockMinutes >= 0 && j.lockMinutes <= 120 ? j.lockMinutes : 1,
      timeFormat: j.timeFormat === '12h' ? '12h' : '24h', weekStart: j.weekStart === 0 ? 0 : 1, soundVolume: (VOLUMES as readonly number[]).includes(j.soundVolume) ? j.soundVolume : 1, vibrate: j.vibrate !== false,
      offerSound: j.offerSound !== false, chatSound: j.chatSound !== false, voiceNav: j.voiceNav !== false,      // sounds are ON unless the person switched them off
    };
  } catch { return { ...DEFAULT_PREFS }; }
}

