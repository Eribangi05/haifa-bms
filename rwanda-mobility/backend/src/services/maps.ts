import { config } from '../config.js';
import { haversineM, type LatLng } from '../util/geo.js';
import { q } from '../db.js';

export type Route = { distance_m: number; duration_s: number; source: 'osrm' | 'estimate' };
const SPEED_KMH: Record<string, number> = { moto: 28, car: 24, minivan: 22, pickup: 22, truck: 20 };
const ROAD_FACTOR = 1.5;    // measured: OSRM road distance / straight line averaged 1.51 over 5 Kigali routes (scripts/map-eval.ts). Recalibrate with real trips.

export function estimateRoute(a: LatLng, b: LatLng, vehicle = 'car'): Route {
  const d = Math.round(haversineM(a, b) * ROAD_FACTOR);
  return { distance_m: d, duration_s: Math.round((d / 1000 / (SPEED_KMH[vehicle] ?? 24)) * 3600), source: 'estimate' };
}

/** Route with OSRM when configured; falls back to a clearly labelled estimate if the provider is down. */
export async function route(a: LatLng, b: LatLng, vehicle = 'car'): Promise<Route> {
  if (config.mapProvider === 'osrm') {
    try {
      const url = `${config.osrmUrl}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`;
      const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (r.ok) {
        const j: any = await r.json();
        const rt = j.routes?.[0];
        if (rt) return { distance_m: Math.round(rt.distance), duration_s: Math.round(rt.duration), source: 'osrm' };
      }
    } catch { /* fall through to estimate */ }
  }
  return estimateRoute(a, b, vehicle);
}

/** ETA for dispatch (straight line * road factor; OSRM matrix is a drop-in upgrade). */
export const etaS = (from: LatLng, to: LatLng, vehicle = 'car') => estimateRoute(from, to, vehicle).duration_s;

export type PlaceHit = { id?: string; name: string; lat: number; lng: number; kind: string; source: 'local' | 'nominatim' };
export async function searchPlaces(text: string, lang: 'rw' | 'en'): Promise<PlaceHit[]> {
  const like = `%${text.replace(/[%_]/g, '')}%`;
  const rows = await q<any>(`select id, name_en, name_rw, kind, lat, lng from places where name_en ilike $1 or name_rw ilike $1 order by designated_pickup desc, name_en limit 8`, [like]);
  const out: PlaceHit[] = rows.map((r) => ({ id: r.id, name: lang === 'rw' && r.name_rw ? r.name_rw : r.name_en, lat: r.lat, lng: r.lng, kind: r.kind, source: 'local' }));
  if (config.mapProvider === 'osrm' && out.length < 5) {
    try {
      const u = `${config.nominatimUrl}/search?format=json&limit=5&countrycodes=rw&q=${encodeURIComponent(text)}`;
      const r = await fetch(u, { headers: { 'user-agent': 'RwandaMobility/0.1' }, signal: AbortSignal.timeout(4000) });
      if (r.ok) for (const p of (await r.json()) as any[]) out.push({ name: p.display_name, lat: Number(p.lat), lng: Number(p.lon), kind: p.type, source: 'nominatim' });
    } catch { /* offline: local places only */ }
  }
  return out;
}
