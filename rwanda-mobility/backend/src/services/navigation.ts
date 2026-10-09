import { etaS } from './maps.js';
import { routeOnRoads, graphReady } from './roadGraph.js';
import { haversineM } from '../util/geo.js';

const pt = (lat: number, lng: number, name?: string | null) => ({
  lat, lng, name: name ?? null,
  google_maps: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
  waze: `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`,
  geo: `geo:${lat},${lng}?q=${lat},${lng}`,
});
const FRESH_MS = 5 * 60e3;

/** Driver-facing hand-off to a navigation app. ETA uses the same straight-line x road-factor logic as dispatch. */
export function navigationFor(b: any, d: { last_lat?: number | null; last_lng?: number | null; last_location_at?: any; vehicle_type?: string | null }) {
  const target = b.status === 'IN_PROGRESS' ? 'destination' : 'pickup';
  const pickup = pt(b.pickup_lat, b.pickup_lng, b.pickup_name), destination = pt(b.dest_lat, b.dest_lng, b.dest_name);
  const fresh = d.last_lat != null && d.last_location_at && Date.now() - new Date(d.last_location_at).getTime() < FRESH_MS;
  const from = fresh ? { lat: d.last_lat as number, lng: d.last_lng as number } : null;
  const min = (to: { lat: number; lng: number }) => (from ? Math.max(1, Math.ceil(etaS(from, to, d.vehicle_type ?? 'car') / 60)) : null);
  return {
    target, pickup, destination,
    eta_to_pickup_min: ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'].includes(b.status) ? min(pickup) : null,
    eta_to_destination_min: b.status === 'IN_PROGRESS' && b.hire_mode !== 'hourly' ? min(destination) : null,
  };
}

/** Seconds until the driver reaches the pickup (before boarding) or the destination (during the trip), from the driver's last location. */
export function driverEtaS(b: any, d: { last_lat?: number | null; last_lng?: number | null; last_location_at?: any; vehicle_type?: string | null }): { driver_eta_s: number | null; driver_eta_target: 'pickup' | 'destination' | null } {
  if (d.last_lat == null || !d.last_location_at || Date.now() - new Date(d.last_location_at).getTime() > FRESH_MS) return { driver_eta_s: null, driver_eta_target: null };
  const from = { lat: d.last_lat, lng: d.last_lng as number };
  if (['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'].includes(b.status)) return { driver_eta_s: etaS(from, { lat: b.pickup_lat, lng: b.pickup_lng }, d.vehicle_type ?? 'car'), driver_eta_target: 'pickup' };
  if (b.status === 'IN_PROGRESS' && b.hire_mode !== 'hourly') return { driver_eta_s: etaS(from, { lat: b.dest_lat, lng: b.dest_lng }, d.vehicle_type ?? 'car'), driver_eta_target: 'destination' };
  return { driver_eta_s: null, driver_eta_target: null };
}

/** Turn-by-turn route for the driver from where they are now to the current target (pickup before boarding, destination during the trip). */
export function turnByTurn(b: any, from: { lat: number; lng: number }, vehicle = 'car') {
  const target = b.status === 'IN_PROGRESS' ? 'destination' : 'pickup';
  const to = target === 'destination' ? { lat: b.dest_lat, lng: b.dest_lng } : { lat: b.pickup_lat, lng: b.pickup_lng };
  const r = routeOnRoads(from, to, vehicle);
  if (!r) return { target, available: false as const, to, from, reason: graphReady() ? 'no_road_found' : 'no_road_data', straight_line_m: Math.round(haversineM(from, to)) };
  return { target, available: true as const, to, from, source: 'roads' as const, distance_m: r.distance_m, duration_s: r.duration_s, geometry: r.geometry, steps: r.steps };
}
