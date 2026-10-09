// Pure formatting / geometry helpers (no React Native imports, unit-tested in tests/format.test.ts).
export type LatLng = { lat: number; lng: number };
const rad = (d: number) => (d * Math.PI) / 180;
/** Great-circle distance in metres. */
export const distM = (a: LatLng, b: LatLng) => {
  const x = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(x));
};
export const fmtMin = (s: number) => Math.max(1, Math.round(s / 60));
/** Rough arrival time in whole minutes from a straight-line distance; city traffic average of 22 km/h, with a 1.3 detour factor. Always at least 1. */
export const etaMinutes = (meters: number, kmh = 22) => Math.max(1, Math.round(((meters * 1.3) / 1000 / kmh) * 60));
/** 0..1 progress along pickup -> destination from straight-line distances (clamped; 0 when the route is degenerate). */
export function routeProgress(pickup: LatLng, dest: LatLng, pos: LatLng | null): number {
  const total = distM(pickup, dest); if (!pos || total < 50) return 0;
  return Math.min(1, Math.max(0, 1 - distM(pos, dest) / total));
}
export const fmtRwf = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? '-' : Math.round(n).toLocaleString('en-US'));

/** Real calendar date `YYYY-MM-DD` (rejects 2024-02-31, 2024-13-01 ...). With `notFuture`, also rejects dates after `now`; with `future`, dates before today. */
export function isIsoDate(s: string, opt: { notFuture?: boolean; future?: boolean; now?: Date } = {}): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3]; const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return false;
  const now = opt.now ?? new Date(); const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (opt.notFuture && dt.getTime() > today) return false;
  if (opt.future && dt.getTime() < today) return false;
  return true;
}

const KIGALI_OFFSET_MS = 2 * 3600 * 1000;   // Africa/Kigali is UTC+2 all year (no DST)
const kigali = (iso: string | number | Date) => new Date(new Date(iso).getTime() + KIGALI_OFFSET_MS);
const p2 = (n: number) => String(n).padStart(2, '0');
/** `dd/mm/yyyy` in Kigali time. Numeric on purpose: identical in every app language. */
export const fmtDate = (iso: string | number | Date) => { const d = kigali(iso); return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; };
let timeFmt: '24h' | '12h' = '24h';
/** Set by the appearance store: every clock time in the app follows the person's 24-hour or 12-hour choice. */
export const setTimeFormat = (f: '24h' | '12h') => { timeFmt = f; };
export const fmtTime = (iso: string | number | Date) => { const d = kigali(iso); const h = d.getUTCHours(), m = p2(d.getUTCMinutes()); return timeFmt === '12h' ? `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}` : `${p2(h)}:${m}`; };
export const fmtDateTime = (iso: string | number | Date) => `${fmtDate(iso)} ${fmtTime(iso)}`;
const dayNumber = (iso: string | number | Date) => Math.floor(kigali(iso).getTime() / 86400000);

export type DayGroup<T> = { key: string; kind: 'today' | 'yesterday' | 'date'; date: string; items: T[] };
/** Groups items (already newest-first) by Kigali calendar day. `kind` lets the UI localise "Today" / "Yesterday"; other days show `date`. */
export function groupByDay<T>(items: T[], getIso: (x: T) => string, now: Date = new Date()): DayGroup<T>[] {
  const today = dayNumber(now); const out: DayGroup<T>[] = [];
  for (const it of items) {
    const n = dayNumber(getIso(it)); let g = out[out.length - 1];
    if (!g || g.key !== String(n)) { g = { key: String(n), kind: n === today ? 'today' : n === today - 1 ? 'yesterday' : 'date', date: fmtDate(getIso(it)), items: [] }; out.push(g); }
    g.items.push(it);
  }
  return out;
}
