import { q } from '../db.js';
import { getSetting } from './settings.js';
import { haversineM, type LatLng } from '../util/geo.js';
import { cellsCovering, precisionFor } from '../util/geohash.js';
import { etaS } from './maps.js';

/**
 * Online drivers around a rider, for the rider map ("cars nearby", as ride apps do). Privacy first: no driver id, name or plate leaves the server, and each
 * position is moved onto a grid (map.nearby_blur_m) and shifted a little every 30 seconds, so a rider cannot follow one driver or work out where a driver lives.
 * Only drivers who are approved, online, reported a position recently and are not on a trip are shown. Read from the geohash index, not by scanning every driver.
 */
export type NearbyCar = { k: number; type: 'moto' | 'car'; lat: number; lng: number };
export type Nearby = { cars: NearbyCar[]; count: number; nearest_eta_min: number | null; radius_km: number };

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
/** Blur one position: snap to a grid of `blurM` metres, then shift by a small amount that changes every 30 seconds and differs per driver. */
export function blurPoint(p: LatLng, blurM: number, seed: string, now = Date.now()): LatLng {
  if (blurM <= 0) return p;
  const dLat = blurM / 111_320, dLng = dLat / Math.max(0.2, Math.cos((p.lat * Math.PI) / 180));
  const bucket = Math.floor(now / 30_000), h1 = hash(seed + ':' + bucket), h2 = hash(bucket + ':' + seed);
  const jx = ((h1 % 1000) / 1000 - 0.5) * 0.8, jy = ((h2 % 1000) / 1000 - 0.5) * 0.8;
  return { lat: (Math.round(p.lat / dLat) + jy) * dLat, lng: (Math.round(p.lng / dLng) + jx) * dLng };
}

export async function nearbyDrivers(at: LatLng, now = Date.now()): Promise<Nearby> {
  const [radiusKm, max, blur, fresh] = await Promise.all([getSetting('map.nearby_radius_km'), getSetting('map.nearby_max'), getSetting('map.nearby_blur_m'), getSetting('dispatch.heartbeat_max_age_s')]);
  const radiusM = radiusKm * 1000, gp = precisionFor(radiusM + 500);
  const rows = await q<{ user_id: string; last_lat: number; last_lng: number; vehicle_type: string | null }>(
    `select dp.user_id, dp.last_lat, dp.last_lng, (select v.vehicle_type from vehicles v where v.driver_id = dp.user_id and v.status = 'approved' order by v.created_at desc limit 1) vehicle_type
     from driver_profiles dp join users u on u.id = dp.user_id and u.status = 'active'
     where dp.status = 'APPROVED' and dp.is_online and 'ride' = any(dp.accepting) and dp.last_lat is not null
       and dp.last_seen_at > now() - make_interval(secs => $1) and dp.last_location_at > now() - make_interval(secs => $1)
       ${gp ? `and dp.gh${gp} = any($2)` : ''}
       and not exists (select 1 from bookings b where b.driver_id = dp.user_id and b.status in ('DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS'))
     limit 400`, gp ? [fresh, cellsCovering(at, radiusM + 500, gp)] : [fresh]);
  const near = rows.map((r) => ({ r, d: haversineM(at, { lat: r.last_lat, lng: r.last_lng }) })).filter((x) => x.d <= radiusM).sort((a, b) => a.d - b.d);
  const cars: NearbyCar[] = near.slice(0, max).map(({ r }, i) => { const p = blurPoint({ lat: r.last_lat, lng: r.last_lng }, blur, r.user_id, now); return { k: i, type: r.vehicle_type === 'moto' ? 'moto' : 'car', lat: Math.round(p.lat * 1e5) / 1e5, lng: Math.round(p.lng * 1e5) / 1e5 }; });
  const nearest = near[0] ? Math.max(1, Math.ceil(etaS({ lat: near[0].r.last_lat, lng: near[0].r.last_lng }, at, near[0].r.vehicle_type ?? 'car') / 60)) : null;
  return { cars, count: near.length, nearest_eta_min: nearest, radius_km: radiusKm };
}
