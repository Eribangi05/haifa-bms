// Calendar and clock helpers for the date and time pickers: pure functions (unit-tested in tests/calendar.test.ts), no React.
// Dates are ISO "YYYY-MM-DD" in Kigali time; times are "HH:MM" (24-hour inside the app, shown as 12-hour when the person chose that).
export type CalLang = 'rw' | 'fr' | 'en';
export const MONTHS: Record<CalLang, string[]> = {
  rw: ['Mutarama', 'Gashyantare', 'Werurwe', 'Mata', 'Gicurasi', 'Kamena', 'Nyakanga', 'Kanama', 'Nzeri', 'Ukwakira', 'Ugushyingo', 'Ukuboza'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
/** Weekday initials, Monday first. */
export const WEEKDAYS_SHORT: Record<CalLang, string[]> = {
  rw: ['Mbe', 'Kab', 'Gat', 'Kan', 'Gat', 'Gas', 'Cyu'],
  fr: ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
};
const p2 = (n: number) => String(n).padStart(2, '0');
export const toIso = (y: number, m: number, d: number) => `${y}-${p2(m)}-${p2(d)}`;          // m is 1..12
export function parseIso(s: string): { y: number; m: number; d: number } | null {
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!r) return null; const y = +r[1], m = +r[2], d = +r[3];
  const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? { y, m, d } : null;
}
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Weeks of the month as rows of 7 cells (a day number or null). weekStart: 1 = Monday first, 0 = Sunday first. */
export function monthGrid(y: number, m: number, weekStart: 0 | 1 = 1): (number | null)[][] {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();                        // 0 = Sunday
  const lead = weekStart === 1 ? (first + 6) % 7 : first; const cells: (number | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= daysInMonth(y, m); d++) cells.push(d); while (cells.length % 7) cells.push(null);
  const rows: (number | null)[][] = []; for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7)); return rows;
}
export const addMonths = (y: number, m: number, n: number) => { const t = y * 12 + (m - 1) + n; return { y: Math.floor(t / 12), m: (t % 12) + 1 }; };
export const addDays = (iso: string, n: number) => { const p = parseIso(iso); if (!p) return iso; return new Date(Date.UTC(p.y, p.m - 1, p.d + n)).toISOString().slice(0, 10); };
export const todayKigali = (now: Date = new Date()) => new Date(now.getTime() + 2 * 3600e3).toISOString().slice(0, 10);
/** A day can be chosen when it lies within [min, max] (either may be absent). */
export const dayAllowed = (iso: string, min?: string, max?: string) => (!min || iso >= min) && (!max || iso <= max);
export const clampIso = (iso: string, min?: string, max?: string) => (min && iso < min ? min : max && iso > max ? max : iso);
/** "9 Ukwakira 2026" / "9 octobre 2026" / "9 October 2026". */
export function longDate(iso: string, lang: CalLang): string { const p = parseIso(iso); return p ? `${p.d} ${MONTHS[lang][p.m - 1]} ${p.y}` : ''; }

// ---- time ----
export const validHM = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export const splitHM = (s: string): { h: number; m: number } => (validHM(s) ? { h: +s.slice(0, 2), m: +s.slice(3) } : { h: 8, m: 0 });
export const joinHM = (h: number, m: number) => `${p2(((h % 24) + 24) % 24)}:${p2(((m % 60) + 60) % 60)}`;
/** Show "14:30" as is, or as "2:30 PM" when the person prefers the 12-hour clock. */
export function showHM(s: string, fmt: '24h' | '12h'): string {
  if (!validHM(s)) return ''; if (fmt === '24h') return s; const { h, m } = splitHM(s); return `${h % 12 === 0 ? 12 : h % 12}:${p2(m)} ${h < 12 ? 'AM' : 'PM'}`;
}
/** Minute choices for a step (1, 5, 10, 15, 30): 0, step, 2*step ... below 60. */
export const minuteChoices = (step: number) => { const s = [1, 5, 10, 15, 20, 30].includes(step) ? step : 5; return Array.from({ length: Math.floor(60 / s) }, (_, i) => i * s); };
/** Split an instant into Kigali date + time, and join them back (used by the date-and-time field). */
export function splitInstant(iso: string | null): { date: string; time: string } | null {
  if (!iso) return null; const t = new Date(iso); if (Number.isNaN(t.getTime())) return null; const k = new Date(t.getTime() + 2 * 3600e3).toISOString();
  return { date: k.slice(0, 10), time: k.slice(11, 16) };
}
export const joinInstant = (date: string, time: string): string | null => (parseIso(date) && validHM(time) ? new Date(`${date}T${time}:00+02:00`).toISOString() : null);
/** Is this instant within [now + minLeadMin, now + maxDays]? */
export const instantAllowed = (iso: string | null, minLeadMin: number, maxDays: number, now: Date = new Date()) => { if (!iso) return false; const t = new Date(iso).getTime(); return t >= now.getTime() + minLeadMin * 60e3 && t <= now.getTime() + maxDays * 864e5; };
