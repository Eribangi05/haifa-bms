// Pure trip statistics for the Home, Trips and Wallet tabs. Platform-free: unit-tested in tests/stats.test.ts.
// Status predicates are repeated here (not imported) so this module stays loadable by plain Node tests; they mirror lib/trip.ts.
const isPayable = (s: string) => s === 'COMPLETED' || s === 'PAYMENT_PENDING';
const isPaid = (s: string) => s === 'PAYMENT_COMPLETED' || s === 'REFUNDED' || s === 'PARTIALLY_REFUNDED';
const isCancelled = (s: string) => s.startsWith('CANCELLED');

export type TripLike = { status: string; requested_at: string; completed_at?: string | null; final_fare: number | null; estimated_fare?: number | null; distance_m?: number | null; duration_s?: number | null; payment_method?: string; estimated_driver_net?: number | null };

/** A trip that really happened (finished, whether or not it is paid yet). Cancelled, searching and live trips do not count. */
export const isDone = (s: string) => isPayable(s) || isPaid(s);
const fare = (b: TripLike) => Math.max(0, Math.round(b.final_fare ?? 0));

export type TripStats = { trips: number; cancelled: number; km: number; minutes: number; spent: number; avgFare: number; credit: number; cash: number; momo: number; other: number };
/** Totals over finished trips. Distance in km (1 decimal), time in minutes. Payment mix is by the booking's payment method. */
export function tripStats(list: TripLike[]): TripStats {
  const o: TripStats = { trips: 0, cancelled: 0, km: 0, minutes: 0, spent: 0, avgFare: 0, credit: 0, cash: 0, momo: 0, other: 0 };
  let m = 0;
  for (const b of list) {
    if (isCancelled(b.status)) { o.cancelled++; continue; }
    if (!isDone(b.status)) continue;
    o.trips++; const f = fare(b); o.spent += f; m += b.distance_m ?? 0; o.minutes += Math.round((b.duration_s ?? 0) / 60);
    const pm = b.payment_method ?? '';
    if (pm.startsWith('wallet')) o.credit += f; else if (pm === 'cash') o.cash += f; else if (pm === 'mtn_momo') o.momo += f; else o.other += f;
  }
  o.km = Math.round(m / 100) / 10; o.avgFare = o.trips ? Math.round(o.spent / o.trips) : 0;
  return o;
}

export type MonthRow = { key: string; year: number; month: number; trips: number; spent: number };
/** Spending per Kigali calendar month, newest first (at most `limit` months). */
export function byMonth(list: TripLike[], limit = 6): MonthRow[] {
  const map = new Map<string, MonthRow>();
  for (const b of list) {
    if (!isDone(b.status)) continue;
    const d = new Date(new Date(b.requested_at).getTime() + 2 * 3600 * 1000); const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1; const key = `${y}-${String(mo).padStart(2, '0')}`;
    const r = map.get(key) ?? { key, year: y, month: mo, trips: 0, spent: 0 }; r.trips++; r.spent += fare(b); map.set(key, r);
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? 1 : -1)).slice(0, limit);
}

export type TripFilter = 'all' | 'done' | 'cancelled' | 'upcoming';
/** Trips tab filter. `upcoming` = scheduled or still open (searching / live / awaiting payment). */
export function filterTrips<T extends TripLike>(list: T[], f: TripFilter): T[] {
  if (f === 'all') return list;
  if (f === 'cancelled') return list.filter((b) => isCancelled(b.status) || b.status === 'NO_DRIVER_FOUND');
  if (f === 'done') return list.filter((b) => isDone(b.status));
  return list.filter((b) => !isDone(b.status) && !isCancelled(b.status) && b.status !== 'NO_DRIVER_FOUND');
}

/** Time-of-day bucket in Kigali time for the greeting. */
export function dayPart(now: Date = new Date()): 'morning' | 'afternoon' | 'evening' {
  const h = new Date(now.getTime() + 2 * 3600 * 1000).getUTCHours();
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

export type DriverDay = { trips: number; fares: number; net: number };
/** Driver's finished trips today (Kigali day) from the trip list: count and fare sum (net comes from the earnings endpoint). */
export function driverToday(list: TripLike[], now: Date = new Date()): DriverDay {
  const day = (x: string | number | Date) => Math.floor((new Date(x).getTime() + 2 * 3600 * 1000) / 86400000);
  const today = day(now); const o: DriverDay = { trips: 0, fares: 0, net: 0 };
  for (const b of list) if (isDone(b.status) && day(b.completed_at ?? b.requested_at) === today) { o.trips++; o.fares += fare(b); o.net += Math.max(0, Math.round(b.estimated_driver_net ?? 0)); }
  return o;
}
