// Round 2 pure logic (ride for someone else, recurring rides, quests, heat map). Platform-free, unit-tested in tests/r2.test.ts.
import type { Lang } from './i18n';

// ------------------------------------------------------------------ guest (ride for someone else)
const RW_PHONE = /^(?:\+?250|0)?7[2389]\d{7}$/;
/** `+2507XXXXXXXX` from any accepted way of typing a Rwandan mobile number, or null. */
export function normalizeRwPhone(raw: string): string | null {
  const s = raw.replace(/[\s-]/g, ''); if (!RW_PHONE.test(s)) return null;
  return '+250' + s.replace(/^\+?250/, '').replace(/^0/, '');
}
export type GuestForm = { name: string; phone: string; language: Lang };
export type GuestCheck = { ok: boolean; name?: 'name_short'; phone?: 'phone_invalid' | 'phone_own' };
/** Client-side check before sending; the server stays the authority (limits, `guest_not_allowed`). `ownPhone` = the booker's own number. */
export function checkGuest(g: GuestForm, ownPhone?: string | null): GuestCheck {
  const out: GuestCheck = { ok: true };
  if (g.name.trim().length < 2) { out.name = 'name_short'; out.ok = false; }
  const p = normalizeRwPhone(g.phone);
  if (!p) { out.phone = 'phone_invalid'; out.ok = false; } else if (ownPhone && normalizeRwPhone(ownPhone) === p) { out.phone = 'phone_own'; out.ok = false; }
  return out;
}
export const guestBody = (g: GuestForm) => ({ name: g.name.trim().slice(0, 60), phone: normalizeRwPhone(g.phone) ?? g.phone, language: g.language });
/** Server error codes about the guest that are shown next to the form (the message itself is already localised by the server). */
export const isGuestError = (code?: string) => !!code && (code.startsWith('guest_') || code === 'invalid_phone');

// ------------------------------------------------------------------ recurring rides
/** Monday-first display order of the backend's day numbers (0 = Sunday). */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
export const WEEKDAYS = [1, 2, 3, 4, 5];
export const toggleDay = (days: number[], d: number) => (days.includes(d) ? days.filter((x) => x !== d) : [...days, d]).sort((a, b) => WEEK_ORDER.indexOf(a as 1) - WEEK_ORDER.indexOf(b as 1));
export const validTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
/** Add minutes (wraps over midnight) to HH:MM; used by the time stepper. */
export function stepTime(s: string, deltaMin: number): string {
  const [h, m] = validTime(s) ? s.split(':').map(Number) : [7, 30]; const tot = (((h * 60 + m + deltaMin) % 1440) + 1440) % 1440;
  return `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;
}
/** Kigali (UTC+2) calendar date `YYYY-MM-DD` of an instant plus `plusDays`. */
export const kigaliDate = (now: Date = new Date(), plusDays = 0) => new Date(now.getTime() + 2 * 3600e3 + plusDays * 86400e3).toISOString().slice(0, 10);
export type RepeatForm = { days: number[]; time: string; start: string; end: string };
export type RepeatCheck = { ok: boolean; days?: boolean; time?: boolean; start?: boolean; end?: boolean };
const realDate = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return false; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]; };
export function checkRepeat(f: RepeatForm, now: Date = new Date()): RepeatCheck {
  const r: RepeatCheck = { ok: true };
  if (!f.days.length) r.days = true;
  if (!validTime(f.time)) r.time = true;
  if (!realDate(f.start) || f.start < kigaliDate(now)) r.start = true;
  if (f.end.trim() && (!realDate(f.end) || f.end < f.start)) r.end = true;
  r.ok = !(r.days || r.time || r.start || r.end); return r;
}
export type SchedulePayload = { label?: string; service_id: string; pickup: { lat: number; lng: number; name?: string }; dest: { lat: number; lng: number; name?: string }; days_of_week: number[]; local_time: string; start_date: string; end_date: string | null; payment_method: 'cash' | 'mtn_momo'; customer_vehicle_id?: string; hours?: number; owner_attested?: boolean };
export type Run = { date: string; scheduled_for?: string; status: string; booking_id?: string | null; quoted_total?: number | null };
export type Schedule = {
  id: string; label?: string | null; service_id: string; status: 'active' | 'paused' | 'ended'; pickup_name?: string | null; dest_name?: string | null; days_of_week: number[]; local_time: string;
  start_date: string; end_date?: string | null; skip_dates?: string[]; payment_method: string; expected_total?: number | null; next_occurrence?: string | null; recent_runs?: Run[]; customer_vehicle_id?: string | null; hours?: number | null;
};
export type Warning = { kind: 'price_changed'; total: number | null; date: string } | { kind: 'no_coverage'; date: string } | null;
/** The most recent unresolved warning: a held-back run (price changed / no coverage) whose ride time has not passed yet. */
export function scheduleWarning(s: Schedule, now: Date = new Date()): Warning {
  if (s.status === 'ended') return null;
  const runs = (s.recent_runs ?? []).filter((r) => (r.status === 'price_changed' || r.status === 'no_coverage') && (!r.scheduled_for || new Date(r.scheduled_for).getTime() > now.getTime()));
  const r = [...runs].sort((a, b) => (a.date < b.date ? 1 : -1))[0]; if (!r) return null;
  return r.status === 'price_changed' ? { kind: 'price_changed', total: r.quoted_total ?? null, date: r.date } : { kind: 'no_coverage', date: r.date };
}
/** The run shown as "last result": the newest run whose ride time has passed, else the newest. */
export function lastRun(s: Schedule, now: Date = new Date()): Run | null {
  const runs = [...(s.recent_runs ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1)); if (!runs.length) return null;
  return runs.find((r) => r.scheduled_for && new Date(r.scheduled_for).getTime() <= now.getTime()) ?? runs[0];
}

// ------------------------------------------------------------------ fixed price
export type OptLike = { service_id: string; fixed_price?: boolean };
/** Metered and fixed-price options share a service_id, so selection uses this key. */
export const optKey = (o: OptLike) => o.service_id + (o.fixed_price ? ':fixed' : '');

// ------------------------------------------------------------------ quests
export type Quest = { id: string; kind: string; window: 'daily' | 'weekly'; target: number; reward: number; title?: string; title_en?: string; title_rw?: string; title_fr?: string; description?: string; period: { key: string; starts_at: string; ends_at: string }; progress: number; percent: number; completed: boolean; budget_exhausted?: boolean; placeholder?: boolean };
export const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)));
/** 0..4 filled quarters of the progress ring. */
export const ringQuarters = (pct: number) => (pct <= 0 ? 0 : Math.min(4, Math.ceil(clampPct(pct) / 25)));
export const questSeenKey = (q: Pick<Quest, 'id' | 'period'>) => `${q.id}|${q.period.key}`;
/** Quests completed that the driver has not yet been congratulated for. */
export const newlyCompleted = (qs: Quest[], seen: Set<string>) => qs.filter((q) => q.completed && !seen.has(questSeenKey(q)));
/** Whole days (>=0) and hours left until `endsAt`; null when already over. */
export function timeLeft(endsAt: string, now: Date = new Date()): { days: number; hours: number } | null {
  const ms = new Date(endsAt).getTime() - now.getTime(); if (!(ms > 0)) return null;
  return { days: Math.floor(ms / 86400e3), hours: Math.floor((ms % 86400e3) / 3600e3) };
}
/** Active first (closest to done first), completed last. */
export const sortQuests = (qs: Quest[]) => [...qs].sort((a, b) => Number(a.completed) - Number(b.completed) || b.percent - a.percent);

// ------------------------------------------------------------------ heat map
export type HeatCell = { lat: number; lng: number; intensity: number; hint: string };
export type HeatWindowKey = 'now' | 'last_hour' | 'same_hour_last_week';
export const HEAT_WINDOWS: HeatWindowKey[] = ['now', 'last_hour', 'same_hour_last_week'];
const HINTS = ['heat.unserved', 'heat.high', 'heat.busy', 'heat.some'];
export const heatHintKey = (h: string) => (HINTS.includes(h) ? h : 'heat.some');
/** Light yellow -> orange -> red as demand grows (never relies on colour alone: the list below states the hint in words). */
export function heatColor(i: number): string {
  const v = Math.max(0, Math.min(1, i)); return v >= 0.66 ? '#C0392B' : v >= 0.33 ? '#E67E22' : '#F1C40F';
}
export const heatOpacity = (i: number) => 0.25 + 0.45 * Math.max(0, Math.min(1, i));
/** Centre of the cells (for the map) or the fallback. */
export function heatCenter(cells: { lat: number; lng: number }[], fallback: { lat: number; lng: number }) {
  if (!cells.length) return fallback;
  return { lat: cells.reduce((a, c) => a + c.lat, 0) / cells.length, lng: cells.reduce((a, c) => a + c.lng, 0) / cells.length };
}
export const topCells = (cells: HeatCell[], n = 5) => [...cells].sort((a, b) => b.intensity - a.intensity).slice(0, n);
