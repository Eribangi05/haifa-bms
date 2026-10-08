// Demand heat map: requests per ~500 m grid cell for three windows. Cells with fewer than k distinct requesters are never returned.
import { q } from '../db.js';
import { getSetting } from './settings.js';

export const CELL_DEG = 0.0045;            // ~500 m of latitude; at Rwanda's latitude a degree of longitude is within 0.1 % of that
export const CELL_M = 500;
type Cell = { lat: number; lng: number; requests: number; unmatched: number; intensity: number; hint: string };
type Windows = Record<'now' | 'last_hour' | 'same_hour_last_week', Cell[]>;
let cache: { at: number; data: Windows } | null = null;
export const clearHeatmapCache = () => { cache = null; };

const hintOf = (c: { requests: number; unmatched: number; intensity: number }, k: number) =>
  c.unmatched >= k && c.unmatched * 2 >= c.requests ? 'heat.unserved' : c.intensity >= 0.66 ? 'heat.high' : c.intensity >= 0.33 ? 'heat.busy' : 'heat.some';

async function window(from: Date, to: Date, k: number): Promise<Cell[]> {
  const rows = await q<any>(
    `select floor(pickup_lat / $3)::int ci, floor(pickup_lng / $3)::int cj, count(*)::int requests, count(distinct passenger_id)::int people,
            count(*) filter (where driver_id is null and assigned_at is null)::int unmatched
       from bookings where scheduled_for is null and requested_at >= $1 and requested_at < $2
      group by 1,2 having count(distinct passenger_id) >= $4`, [from, to, CELL_DEG, k]);
  const max = Math.max(1, ...rows.map((r) => r.requests));
  return rows.map((r) => {
    const c = { requests: r.requests, unmatched: r.unmatched >= k ? r.unmatched : 0, intensity: Math.round((r.requests / max) * 100) / 100 };
    return { lat: Math.round((r.ci + 0.5) * CELL_DEG * 1e5) / 1e5, lng: Math.round((r.cj + 0.5) * CELL_DEG * 1e5) / 1e5, ...c, hint: hintOf(c, k) };
  }).sort((a, b) => b.intensity - a.intensity);
}

export async function computeHeatmap(now = new Date()): Promise<Windows & { generated_at: string }> {
  const ttl = (await getSetting('heatmap.cache_s')) * 1000;
  if (cache && Date.now() - cache.at < ttl) return { ...cache.data, generated_at: new Date(cache.at).toISOString() };
  const k = Math.max(3, await getSetting('heatmap.k_min'));
  const t = now.getTime(), wk = 7 * 86400e3;
  const data: Windows = {
    now: await window(new Date(t - 15 * 60e3), new Date(t + 1000), k),
    last_hour: await window(new Date(t - 3600e3), new Date(t + 1000), k),
    same_hour_last_week: await window(new Date(t - wk - 1800e3), new Date(t - wk + 1800e3), k),
  };
  cache = { at: Date.now(), data };
  return { ...data, generated_at: new Date(cache.at).toISOString() };
}

/** Driver view: no counts, only intensity and a hint key; admin view: the same plus request / unmatched counts. */
export async function heatmapView(kind: 'driver' | 'admin', now = new Date()) {
  const d = await computeHeatmap(now);
  const strip = (cells: Cell[]) => cells.map((c) => (kind === 'admin' ? c : { lat: c.lat, lng: c.lng, intensity: c.intensity, hint: c.hint }));
  return { cell_size_m: CELL_M, k_min: Math.max(3, await getSetting('heatmap.k_min')), generated_at: d.generated_at,
    windows: { now: { minutes: 15, cells: strip(d.now) }, last_hour: { minutes: 60, cells: strip(d.last_hour) }, same_hour_last_week: { minutes: 60, offset_days: 7, cells: strip(d.same_hour_last_week) } } };
}
