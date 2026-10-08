import { pointInPolygon } from '../util/geo.js';
import { badRequest } from '../errors.js';

// Coverage zones: validation and construction. Rings are [lng, lat], first point == last point (the format stored in service_zones.polygon).
export type Ring = [number, number][];
// Rwanda with a margin: refuses swapped latitude/longitude and typos that would put a zone in the ocean.
const BOUNDS = { minLng: 28.5, maxLng: 31.3, minLat: -3.2, maxLat: -0.7 };
const R = 6371008.8;

/** Circle as a 48-sided polygon (error under 0.2% of the radius). */
export function circleToRing(lat: number, lng: number, radiusM: number, n = 48): Ring {
  const ring: Ring = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n, dLat = (radiusM * Math.cos(a)) / R, dLng = (radiusM * Math.sin(a)) / (R * Math.cos((lat * Math.PI) / 180));
    ring.push([+(lng + (dLng * 180) / Math.PI).toFixed(6), +(lat + (dLat * 180) / Math.PI).toFixed(6)]);
  }
  ring.push([...ring[0]] as [number, number]);
  return ring;
}
/** Area in km2 (equirectangular shoelace: ample for zones of up to a few hundred km). */
export function ringAreaKm2(ring: Ring): number {
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length, kx = 111.32 * Math.cos((lat0 * Math.PI) / 180), ky = 110.57;
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * kx * ring[i + 1][1] * ky - ring[i + 1][0] * kx * ring[i][1] * ky;
  return Math.abs(a) / 2;
}
const ccw = (a: number[], b: number[], c: number[]) => (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0]);
const cross = (a: number[], b: number[], c: number[], d: number[]) => ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);

/** Throws a friendly 400 unless the ring is a closed, simple (non self-crossing) polygon of sensible size inside Rwanda. */
export function validateRing(ring: Ring): void {
  if (ring.length < 4) throw badRequest('polygon_too_small', 'A zone needs at least 3 corners');
  if (ring.length > 501) throw badRequest('polygon_too_big', 'At most 500 corners');
  const f = ring[0], l = ring[ring.length - 1];
  if (f[0] !== l[0] || f[1] !== l[1]) throw badRequest('polygon_not_closed', 'The last point must equal the first point');
  for (const [lng, lat] of ring) if (!(lng >= BOUNDS.minLng && lng <= BOUNDS.maxLng && lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat))
    throw badRequest('outside_rwanda', 'A corner lies outside Rwanda. Points are [longitude, latitude]: check they are not swapped.');
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;   // first and last edge share a corner
    if (cross(ring[i], ring[i + 1], ring[j], ring[j + 1])) throw badRequest('polygon_self_intersects', 'The outline crosses itself. Reorder the corners so the edges do not cross.');
  }
  const km2 = ringAreaKm2(ring);
  if (km2 < 0.05) throw badRequest('polygon_too_small', 'The zone is too small (under 0.05 km2)');
  if (km2 > 30000) throw badRequest('polygon_too_big', 'The zone is larger than Rwanda');
}
/** Names of other zones this ring overlaps (any corner of one inside the other): a warning, not an error, because a booking uses the first matching zone. */
export function overlaps(ring: Ring, others: { id: string; name: string; polygon: Ring }[]): string[] {
  const inside = (r: Ring, o: Ring) => r.some(([lng, lat]) => pointInPolygon({ lat, lng }, o));
  return others.filter((o) => inside(ring, o.polygon) || inside(o.polygon, ring)).map((o) => o.name);
}
