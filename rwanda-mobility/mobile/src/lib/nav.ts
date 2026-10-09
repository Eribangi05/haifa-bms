// Turn-by-turn helpers. Pure and platform-free (unit-tested in tests/nav.test.ts): where am I on the route, what is the next manoeuvre, am I off the road.

export type LL = { lat: number; lng: number };
export type NavStep = { maneuver: 'depart' | 'continue' | 'turn' | 'arrive'; modifier?: string; name: string; distance_m: number; duration_s: number; at: LL; bearing: number };
export type NavRoute = { distance_m: number; duration_s: number; geometry: [number, number][]; steps: NavStep[] };

const KX = 111_320;
const toXY = (p: LL, ref: LL) => ({ x: (p.lng - ref.lng) * KX * Math.cos((ref.lat * Math.PI) / 180), y: (p.lat - ref.lat) * KX });

/** Distance in metres between two points (flat approximation: fine for a few kilometres). */
export function distM(a: LL, b: LL): number { const A = toXY(a, b); return Math.hypot(A.x, A.y); }

/** Project a position onto the route: metres from the start along the route, and how far from the road the position is. */
export function locate(geometry: [number, number][], pos: LL): { along: number; off: number; total: number } {
  let best = Infinity, bestAlong = 0, acc = 0, total = 0;
  const seg: number[] = [];
  for (let i = 0; i + 1 < geometry.length; i++) { const l = distM({ lat: geometry[i][0], lng: geometry[i][1] }, { lat: geometry[i + 1][0], lng: geometry[i + 1][1] }); seg.push(l); total += l; }
  for (let i = 0; i + 1 < geometry.length; i++) {
    const a = toXY({ lat: geometry[i][0], lng: geometry[i][1] }, pos), b = toXY({ lat: geometry[i + 1][0], lng: geometry[i + 1][1] }, pos);   // pos is the origin
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / l2)) : 0;
    const d = Math.hypot(a.x + t * dx, a.y + t * dy);
    if (d < best) { best = d; bestAlong = acc + seg[i] * t; }
    acc += seg[i];
  }
  return { along: bestAlong, off: best, total };
}

export type NavState = { stepIndex: number; step: NavStep; next: NavStep | null; toNextM: number; remainingM: number; remainingS: number; offRouteM: number; arrived: boolean };

/** Where the driver is on the route. `step` = the manoeuvre to do next (its `at` is where it happens). */
export function progress(route: NavRoute, pos: LL, arriveWithinM = 25): NavState {
  const loc = locate(route.geometry, pos);
  const stepAlong = route.steps.map((s) => locate(route.geometry, s.at).along);
  // the next manoeuvre = first step (after the start) whose position is still ahead of us
  let idx = route.steps.length - 1;
  for (let i = 1; i < route.steps.length; i++) if (stepAlong[i] > loc.along + 8) { idx = i; break; }
  const remainingM = Math.max(0, loc.total - loc.along);
  const arrived = remainingM <= arriveWithinM;
  return {
    stepIndex: idx, step: route.steps[idx], next: route.steps[idx + 1] ?? null,
    toNextM: Math.max(0, Math.round(stepAlong[idx] - loc.along)), remainingM: Math.round(remainingM),
    remainingS: loc.total ? Math.round((route.duration_s * remainingM) / loc.total) : 0, offRouteM: Math.round(loc.off), arrived,
  };
}

/** Off the road for long enough to ask for a new route? */
export const shouldReroute = (offRouteM: number, lastRouteAt: number, now = Date.now(), thresholdM = 60, minGapMs = 12_000) => offRouteM > thresholdM && now - lastRouteAt > minGapMs;

export const fmtDist = (m: number) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`);
/** Arrow shown with a manoeuvre (plain text arrows work on every phone font). */
export const arrowFor = (maneuver: string, modifier?: string): string => {
  if (maneuver === 'arrive') return '⚑';
  switch (modifier) { case 'left': return '←'; case 'right': return '→'; case 'slight_left': return '↖'; case 'slight_right': return '↗'; case 'sharp_left': return '↙'; case 'sharp_right': return '↘'; case 'uturn': return '↶'; default: return '↑'; }
};
