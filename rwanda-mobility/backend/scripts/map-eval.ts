// Evaluates map providers for Kigali: landmark geocoding and road-route accuracy vs our straight-line estimator.
// Usage: npx tsx scripts/map-eval.ts   (uses public OSM Nominatim + OSRM demo servers; be gentle, it sleeps between calls)
import { haversineM } from '../src/util/geo.ts';
import { estimateRoute } from '../src/services/maps.ts';

const NOMINATIM = process.env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org';
const OSRM = process.env.OSRM_URL ?? 'https://router.project-osrm.org';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// [query, expected lat, expected lng] (approximate reference points seeded in the app)
const LANDMARKS: [string, number, number][] = [
  ['Kigali Convention Centre', -1.9540, 30.0927], ['Nyabugogo bus park', -1.9386, 30.0446], ['Kimironko market', -1.9496, 30.1262],
  ['Kigali International Airport', -1.9686, 30.1395], ['CHUK hospital Kigali', -1.9519, 30.0610], ['King Faisal Hospital Kigali', -1.9448, 30.0881],
  ['Amahoro Stadium', -1.9546, 30.1048], ['Kigali Genocide Memorial Gisozi', -1.9304, 30.0603], ['Nyamirambo Kigali', -1.9780, 30.0447], ['Remera Kigali', -1.9569, 30.1105],
];
const ROUTES: [string, [number, number], [number, number]][] = [
  ['KCC -> Kimironko market', [-1.9540, 30.0927], [-1.9496, 30.1262]], ['Nyabugogo -> Airport', [-1.9386, 30.0446], [-1.9686, 30.1395]],
  ['CHUK -> Kicukiro', [-1.9519, 30.0610], [-1.9777, 30.1068]], ['Gisozi -> Remera', [-1.9304, 30.0603], [-1.9569, 30.1105]], ['Nyamirambo -> KCC', [-1.9780, 30.0447], [-1.9540, 30.0927]],
];

const out: any = { when: new Date().toISOString(), geocode: [], routes: [] };
for (const [q, la, ln] of LANDMARKS) {
  try {
    const r = await fetch(`${NOMINATIM}/search?format=json&limit=1&countrycodes=rw&q=${encodeURIComponent(q)}`, { headers: { 'user-agent': 'RwandaMobility-eval/0.1' }, signal: AbortSignal.timeout(15000) });
    const j: any[] = await r.json();
    out.geocode.push(j[0] ? { q, found: true, error_m: haversineM({ lat: la, lng: ln }, { lat: +j[0].lat, lng: +j[0].lon }), name: String(j[0].display_name).slice(0, 60) } : { q, found: false });
  } catch (e: any) { out.geocode.push({ q, error: e.message }); }
  await sleep(1100);                                   // Nominatim policy: max 1 request/second
}
let ratios: number[] = [];
for (const [name, a, b] of ROUTES) {
  try {
    const r = await fetch(`${OSRM}/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=false`, { signal: AbortSignal.timeout(15000) });
    const j: any = await r.json(); const rt = j.routes?.[0];
    const est = estimateRoute({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }, 'car');
    const straight = haversineM({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
    if (rt) { ratios.push(rt.distance / straight); out.routes.push({ name, straight_m: straight, osrm_m: Math.round(rt.distance), osrm_s: Math.round(rt.duration), our_est_m: est.distance_m, our_est_s: est.duration_s, road_factor: +(rt.distance / straight).toFixed(2) }); }
  } catch (e: any) { out.routes.push({ name, error: e.message }); }
  await sleep(500);
}
out.summary = {
  geocode_found: `${out.geocode.filter((g: any) => g.found).length}/${LANDMARKS.length}`,
  geocode_median_error_m: median(out.geocode.filter((g: any) => g.found).map((g: any) => g.error_m)),
  mean_road_factor: ratios.length ? +(ratios.reduce((a, b) => a + b, 0) / ratios.length).toFixed(2) : null,
  current_road_factor_assumption: 1.35,
};
function median(a: number[]) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
console.log(JSON.stringify(out, null, 2));
