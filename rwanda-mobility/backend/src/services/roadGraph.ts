import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversineM, type LatLng } from '../util/geo.js';

/**
 * Road graph of Rwanda (drivable OpenStreetMap roads cut at junctions) and an in-process router: shortest travel time with A*, snapping to the nearest road,
 * and turn-by-turn steps. Built by scripts/map/roads.py into backend/map/roads.bin.gz (docs/MAP.md). No external routing service and no cost.
 * File layout (little-endian, gzip): "RGR1", n nodes, m edges, k names, p shape points, blob bytes; then Int32 lat[n], lng[n] (1e-6 deg), Uint32 first[n+1] (CSR),
 * Uint32 to[m], Uint32 lenDm[m] (decimetres), Uint8 class[m], Uint8 speed[m] (km/h), Uint32 name[m], Uint32 geomStart[m+1], Int32 geomLat[p], geomLng[p], then the names (utf8, newline separated).
 */
export const CLASS_NAMES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service', 'living_street', 'track'];
const CAP_KMH = [80, 60, 50, 40, 35, 25, 22, 12, 10, 12];       // realistic free-flow caps per road class in Rwandan towns
const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'map', 'roads.bin.gz');
const V_MAX = 80 / 3.6;

export type Step = { maneuver: 'depart' | 'continue' | 'turn' | 'arrive'; modifier?: 'left' | 'right' | 'slight_left' | 'slight_right' | 'sharp_left' | 'sharp_right' | 'uturn' | 'straight'; name: string; distance_m: number; duration_s: number; at: LatLng; bearing: number };
export type RoadRoute = { distance_m: number; duration_s: number; geometry: [number, number][]; steps: Step[]; snapped_start_m: number; snapped_end_m: number };

type Graph = { n: number; m: number; lat: Float64Array; lng: Float64Array; first: Uint32Array; to: Uint32Array; from: Uint32Array; len: Float32Array; cls: Uint8Array; spd: Uint8Array; name: Uint32Array; gs: Uint32Array; glat: Float64Array; glng: Float64Array; names: string[]; restr: Set<number> | null; grid: Map<number, number[]> };
let GRAPH: Graph | null | undefined;

function take<T extends { buffer: ArrayBufferLike }>(buf: Buffer, off: { o: number }, Ctor: new (b: ArrayBuffer) => T, count: number, size: number): T {
  const ab = new ArrayBuffer(count * size); new Uint8Array(ab).set(buf.subarray(off.o, off.o + count * size)); off.o += count * size; return new Ctor(ab);
}
const CELL = 0.005;
const cellKey = (lat: number, lng: number) => Math.floor((lat + 4) / CELL) * 100000 + Math.floor((lng - 26) / CELL);

function edgePoints(g: Pick<Graph, 'lat' | 'lng' | 'from' | 'to' | 'gs' | 'glat' | 'glng'>, e: number): [number, number][] {
  const out: [number, number][] = [[g.lat[g.from[e]], g.lng[g.from[e]]]];
  for (let i = g.gs[e]; i < g.gs[e + 1]; i++) out.push([g.glat[i], g.glng[i]]);
  out.push([g.lat[g.to[e]], g.lng[g.to[e]]]); return out;
}

export function loadGraph(): Graph | null {
  if (GRAPH !== undefined) return GRAPH;
  GRAPH = null;
  if (!existsSync(FILE)) return null;
  try {
    const buf = gunzipSync(readFileSync(FILE));
    if (buf.toString('latin1', 0, 4) !== 'RGR1') return null;
    const n = buf.readUInt32LE(4), m = buf.readUInt32LE(8), p = buf.readUInt32LE(16), blob = buf.readUInt32LE(20);
    const off = { o: 24 };
    const nlat = take(buf, off, Int32Array, n, 4), nlng = take(buf, off, Int32Array, n, 4), first = take(buf, off, Uint32Array, n + 1, 4), to = take(buf, off, Uint32Array, m, 4);
    const lenDm = take(buf, off, Uint32Array, m, 4), cls = take(buf, off, Uint8Array, m, 1), spd = take(buf, off, Uint8Array, m, 1), name = take(buf, off, Uint32Array, m, 4);
    const gs = take(buf, off, Uint32Array, m + 1, 4), gl = take(buf, off, Int32Array, p, 4), gg = take(buf, off, Int32Array, p, 4);
    const names = buf.toString('utf8', off.o, off.o + blob).split('\n');
    // optional section after the names: forbidden turns (from edge, to edge), built from OpenStreetMap turn-restriction relations
    let restr: Set<number> | null = null; const ro = off.o + blob;
    if (buf.length >= ro + 8 && buf.toString('latin1', ro, ro + 4) === 'RST1') { const k = buf.readUInt32LE(ro + 4); restr = new Set(); for (let i = 0; i < k; i++) restr.add(buf.readUInt32LE(ro + 8 + i * 8) * m + buf.readUInt32LE(ro + 12 + i * 8)); }
    const lat = new Float64Array(n), lng = new Float64Array(n); for (let i = 0; i < n; i++) { lat[i] = nlat[i] / 1e6; lng[i] = nlng[i] / 1e6; }
    const glat = new Float64Array(p), glng = new Float64Array(p); for (let i = 0; i < p; i++) { glat[i] = gl[i] / 1e6; glng[i] = gg[i] / 1e6; }
    const from = new Uint32Array(m); const len = new Float32Array(m);
    for (let u = 0; u < n; u++) for (let e = first[u]; e < first[u + 1]; e++) from[e] = u;
    for (let e = 0; e < m; e++) len[e] = lenDm[e] / 10;
    const grid = new Map<number, number[]>();
    const add = (la: number, ln: number, e: number) => { const key = cellKey(la, ln); const a = grid.get(key); if (!a) grid.set(key, [e]); else if (a[a.length - 1] !== e) a.push(e); };
    const part = { lat, lng, from, to, gs, glat, glng };
    for (let e = 0; e < m; e++) {
      const pts = edgePoints(part, e);
      for (let i = 0; i < pts.length; i++) add(pts[i][0], pts[i][1], e);
      // long straight pieces: also register the cells in between so snapping finds them
      for (let i = 0; i + 1 < pts.length; i++) {
        const d = Math.max(Math.abs(pts[i + 1][0] - pts[i][0]), Math.abs(pts[i + 1][1] - pts[i][1])), steps = Math.floor(d / CELL);
        for (let s = 1; s <= steps; s++) add(pts[i][0] + ((pts[i + 1][0] - pts[i][0]) * s) / (steps + 1), pts[i][1] + ((pts[i + 1][1] - pts[i][1]) * s) / (steps + 1), e);
      }
    }
    GRAPH = { n, m, lat, lng, first, to, from, len, cls, spd, name, gs, glat, glng, names, grid, restr };
  } catch { GRAPH = null; }
  return GRAPH;
}
export const graphReady = () => !!loadGraph();
export const graphStats = () => { const g = loadGraph(); return g ? { nodes: g.n, edges: g.m, names: g.names.length } : null; };

/**
 * Time of day (an assumption, not measured traffic): on weekday rush hours (07:00-09:00 and 17:00-19:30 Kigali time) the roads inside Kigali are slower,
 * main roads more than small ones. Outside the city and at other times the free-flow speed applies. Changing the factors here changes every ETA and fare estimate.
 */
export const RUSH = { arterial: 0.6, minor: 0.8 };
export const isRushHour = (when: Date): boolean => { const k = new Date(when.getTime() + 2 * 3600e3), dow = k.getUTCDay(), t = k.getUTCHours() + k.getUTCMinutes() / 60; return dow >= 1 && dow <= 5 && ((t >= 7 && t < 9) || (t >= 17 && t < 19.5)); };
const inKigali = (la: number, ln: number) => la > -2.1 && la < -1.85 && ln > 29.95 && ln < 30.2;
let rushNow = false;      // set once per route() call (the router is synchronous, so this is safe)
const edgeSpeedMs = (g: Graph, e: number, vehicle: string) => {
  let kmh = Math.min(g.spd[e], CAP_KMH[g.cls[e]]) * (vehicle === 'moto' ? 1.1 : 1);
  if (rushNow && g.cls[e] <= 6 && inKigali(g.lat[g.from[e]], g.lng[g.from[e]])) kmh *= g.cls[e] <= 4 ? RUSH.arterial : RUSH.minor;
  return Math.max(2, kmh / 3.6);
};

type Snap = { e: number; frac: number; dist: number; pt: [number, number] };
const KX = 111_320;
/** Project a point onto an edge's polyline: distance, fraction along (0..1 by length) and the projected point. */
function project(g: Graph, e: number, p: LatLng): Snap {
  const pts = edgePoints(g, e); const kx = KX * Math.cos((p.lat * Math.PI) / 180);
  let best = Infinity, bestPt: [number, number] = pts[0], bestAlong = 0, acc = 0, total = 0;
  const segLen: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) { const l = Math.hypot((pts[i + 1][0] - pts[i][0]) * KX, (pts[i + 1][1] - pts[i][1]) * kx); segLen.push(l); total += l; }
  for (let i = 0; i + 1 < pts.length; i++) {
    const ax = (pts[i][1] - p.lng) * kx, ay = (pts[i][0] - p.lat) * KX, bx = (pts[i + 1][1] - p.lng) * kx, by = (pts[i + 1][0] - p.lat) * KX;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; let t = l2 ? -(ax * dx + ay * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) { best = d; bestPt = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]; bestAlong = acc + segLen[i] * t; }
    acc += segLen[i];
  }
  return { e, dist: best, pt: bestPt, frac: total ? bestAlong / total : 0 };
}
function snap(g: Graph, p: LatLng, maxM = 600): Snap[] {
  const cx = Math.floor((p.lat + 4) / CELL), cy = Math.floor((p.lng - 26) / CELL);
  const seen = new Set<number>(); const found: Snap[] = [];
  for (let ring = 0; ring <= Math.ceil(maxM / 550); ring++) {
    for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
      const a = g.grid.get((cx + dx) * 100000 + (cy + dy)); if (!a) continue;
      for (const e of a) if (!seen.has(e)) { seen.add(e); const s = project(g, e, p); if (s.dist <= maxM) found.push(s); }
    }
    if (found.length && ring >= 1) break;
  }
  found.sort((x, y) => x.dist - y.dist);
  return found.filter((s) => s.dist <= found[0].dist + 6).slice(0, 8);      // both directions of the nearest road (and neighbours within a few metres)
}

/** Is edge b the same road as edge a driven the other way? */
function isReverse(g: Graph, a: number, b: number): boolean {
  if (g.from[b] !== g.to[a] || g.to[b] !== g.from[a]) return false;
  return Math.abs(g.len[a] - g.len[b]) < 1;
}

class Heap {
  a: number[] = []; k: number[] = [];
  push(id: number, key: number) { this.a.push(id); this.k.push(key); let i = this.a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (this.k[p] <= this.k[i]) break; this.swap(i, p); i = p; } }
  pop(): [number, number] {
    const id = this.a[0], key = this.k[0]; const la = this.a.pop()!, lk = this.k.pop()!;
    if (this.a.length) { this.a[0] = la; this.k[0] = lk; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < this.a.length && this.k[l] < this.k[m]) m = l; if (r < this.a.length && this.k[r] < this.k[m]) m = r; if (m === i) break; this.swap(i, m); i = m; } }
    return [id, key];
  }
  swap(i: number, j: number) { [this.a[i], this.a[j]] = [this.a[j], this.a[i]]; [this.k[i], this.k[j]] = [this.k[j], this.k[i]]; }
  get size() { return this.a.length; }
}

const bearing = (a: [number, number], b: [number, number]) => {
  const y = Math.sin(((b[1] - a[1]) * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180);
  const x = Math.cos((a[0] * Math.PI) / 180) * Math.sin((b[0] * Math.PI) / 180) - Math.sin((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.cos(((b[1] - a[1]) * Math.PI) / 180);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};
const turnOf = (d: number): Step['modifier'] => { const a = Math.abs(d); const side = d > 0 ? 'right' : 'left'; return a < 20 ? 'straight' : a < 60 ? (`slight_${side}` as Step['modifier']) : a < 135 ? (side as Step['modifier']) : a < 165 ? (`sharp_${side}` as Step['modifier']) : 'uturn'; };

type Leg = { e: number; f0: number; f1: number };
/** Same street under different spellings ("KN 5 Rd" / "KN 5 Road") is one street for turn instructions. */
const normName = (s: string) => s.toLowerCase().replace(/\b(rd|road)\b/g, 'road').replace(/\b(ave|avenue)\b/g, 'avenue').replace(/\b(st|street)\b/g, 'street').replace(/[^a-z0-9]+/g, ' ').trim();

/** Fastest route between two points, or null when there is no road graph, no road within 600 m, or the places are not connected. */
export function routeOnRoads(a: LatLng, b: LatLng, vehicle = 'car', when: Date = new Date()): RoadRoute | null {
  const g = loadGraph(); if (!g) return null;
  rushNow = isRushHour(when);
  const r = route(g, a, b, vehicle, true); return r ?? (g.restr?.size ? route(g, a, b, vehicle, false) : null);     // if turn restrictions leave no way, ignore them rather than give no route
}
function route(g: Graph, a: LatLng, b: LatLng, vehicle: string, useRestr: boolean): RoadRoute | null {
  const S = snap(g, a), D = snap(g, b); if (!S.length || !D.length) return null;
  const dist = new Map<number, number>(), prevEdge = new Map<number, number>(); const open = new Heap();
  const h = (u: number) => haversineM({ lat: g.lat[u], lng: g.lng[u] }, b) / V_MAX;
  const goalExtra = new Map<number, { cost: number; snap: Snap }>();
  for (const d of D) { const u = g.from[d.e], c = (g.len[d.e] * d.frac) / edgeSpeedMs(g, d.e, vehicle); const cur = goalExtra.get(u); if (!cur || c < cur.cost) goalExtra.set(u, { cost: c, snap: d }); }
  let best = Infinity, bestGoal = -1; let direct: { cost: number; s: Snap; d: Snap } | null = null;
  for (const s of S) {
    const rem = (g.len[s.e] * (1 - s.frac)) / edgeSpeedMs(g, s.e, vehicle), v = g.to[s.e];
    if (!dist.has(v) || rem < dist.get(v)!) { dist.set(v, rem); prevEdge.set(v, -1 - s.e); open.push(v, rem + h(v)); }
    for (const d of D) {            // both points on the same stretch of road (either directed copy of it): drive straight along it
      const same = d.e === s.e, back = !same && isReverse(g, s.e, d.e);
      const df = same ? d.frac : back ? 1 - d.frac : -1;
      if (df >= s.frac) { const c = (g.len[s.e] * (df - s.frac)) / edgeSpeedMs(g, s.e, vehicle); if (!direct || c < direct.cost) direct = { cost: c, s, d: same ? d : { ...d, e: s.e, frac: df } }; }
    }
  }
  if (direct) { best = direct.cost; bestGoal = -2; }
  const done = new Set<number>(); let guard = 0;
  while (open.size && guard++ < 3_000_000) {
    const [u, f] = open.pop(); if (done.has(u)) continue; done.add(u);
    if (f >= best) break;
    const gu = dist.get(u)!; const ge = goalExtra.get(u); if (ge && gu + ge.cost < best) { best = gu + ge.cost; bestGoal = u; }
    for (let e = g.first[u]; e < g.first[u + 1]; e++) {
      const v = g.to[e]; if (done.has(v)) continue;
      if (useRestr && g.restr) { const pe = prevEdge.get(u)!; if (g.restr.has((pe < 0 ? -1 - pe : pe) * g.m + e)) continue; }      // a forbidden turn (no left turn, no U-turn, only straight on...)
      const nd = gu + g.len[e] / edgeSpeedMs(g, e, vehicle);
      if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prevEdge.set(v, e); open.push(v, nd + h(v)); }
    }
  }
  if (!Number.isFinite(best)) return null;
  const legs: Leg[] = []; let startSnap: Snap | undefined, endSnap: Snap;
  if (bestGoal === -2 && direct) { legs.push({ e: direct.s.e, f0: direct.s.frac, f1: direct.d.frac }); startSnap = direct.s; endSnap = direct.d; }
  else {
    endSnap = goalExtra.get(bestGoal)!.snap;
    let u = bestGoal; const chain: number[] = [];
    for (let guard2 = 0; guard2 < 400000; guard2++) { const pe = prevEdge.get(u)!; if (pe < 0) { startSnap = S.find((s) => s.e === -1 - pe); break; } chain.push(pe); u = g.from[pe]; }
    if (!startSnap) return null;
    chain.reverse();
    legs.push({ e: startSnap.e, f0: startSnap.frac, f1: 1 }, ...chain.map((e) => ({ e, f0: 0, f1: 1 })), { e: endSnap.e, f0: 0, f1: endSnap.frac });
  }
  return assemble(g, legs, vehicle, startSnap!, endSnap);
}

function slice(pts: [number, number][], f0: number, f1: number): [number, number][] {
  const cum = [0]; for (let i = 0; i + 1 < pts.length; i++) cum.push(cum[i] + haversineM({ lat: pts[i][0], lng: pts[i][1] }, { lat: pts[i + 1][0], lng: pts[i + 1][1] }));
  const total = cum[cum.length - 1]; if (!total) return [pts[0], pts[pts.length - 1]];
  const at = (d: number): [number, number] => { for (let i = 0; i + 1 < pts.length; i++) if (d <= cum[i + 1]) { const t = (d - cum[i]) / (cum[i + 1] - cum[i] || 1); return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]; } return pts[pts.length - 1]; };
  const d0 = f0 * total, d1 = f1 * total; const out: [number, number][] = [at(d0)];
  for (let i = 1; i + 1 < pts.length; i++) if (cum[i] > d0 && cum[i] < d1) out.push(pts[i]);
  out.push(at(d1)); return out;
}

function assemble(g: Graph, legs: Leg[], vehicle: string, s: Snap, d: Snap): RoadRoute {
  const geometry: [number, number][] = []; const steps: Step[] = [];
  let dist = 0, dur = 0;
  type Piece = { name: string; len: number; time: number; pts: [number, number][] };
  const pieces: Piece[] = [];
  for (const l of legs) {
    const pts = slice(edgePoints(g, l.e), l.f0, l.f1);
    const len = g.len[l.e] * (l.f1 - l.f0); const time = len / edgeSpeedMs(g, l.e, vehicle);
    pieces.push({ name: g.names[g.name[l.e]] ?? '', len, time, pts }); dist += len; dur += time;
    for (const p of pts) { const last = geometry[geometry.length - 1]; if (!last || last[0] !== p[0] || last[1] !== p[1]) geometry.push(p); }
  }
  const endBearing = (pc: Piece) => bearing(pc.pts[Math.max(0, pc.pts.length - 2)], pc.pts[pc.pts.length - 1]);
  const startBearing = (pc: Piece) => bearing(pc.pts[0], pc.pts[Math.min(1, pc.pts.length - 1)]);
  let cur: Step = { maneuver: 'depart', name: pieces[0].name, distance_m: pieces[0].len, duration_s: pieces[0].time, at: { lat: pieces[0].pts[0][0], lng: pieces[0].pts[0][1] }, bearing: Math.round(startBearing(pieces[0])) };
  for (let i = 1; i < pieces.length; i++) {
    const prev = pieces[i - 1], pc = pieces[i];
    const delta = ((startBearing(pc) - endBearing(prev) + 540) % 360) - 180;
    const mod = turnOf(delta), sameName = normName(pc.name) === normName(prev.name);
    if (mod === 'straight' && (sameName || !pc.name || !prev.name || pc.len < 25)) { cur.distance_m += pc.len; cur.duration_s += pc.time; continue; }
    if ((mod === 'slight_left' || mod === 'slight_right') && (sameName || pc.len < 25 || !pc.name)) { cur.distance_m += pc.len; cur.duration_s += pc.time; continue; }
    steps.push(cur);
    cur = { maneuver: mod === 'straight' ? 'continue' : 'turn', modifier: mod, name: pc.name, distance_m: pc.len, duration_s: pc.time, at: { lat: pc.pts[0][0], lng: pc.pts[0][1] }, bearing: Math.round(startBearing(pc)) };
  }
  steps.push(cur);
  const last = geometry[geometry.length - 1];
  steps.push({ maneuver: 'arrive', name: pieces[pieces.length - 1].name, distance_m: 0, duration_s: 0, at: { lat: last[0], lng: last[1] }, bearing: Math.round(endBearing(pieces[pieces.length - 1])) });
  for (const st of steps) { st.distance_m = Math.round(st.distance_m); st.duration_s = Math.round(st.duration_s); }
  return { distance_m: Math.round(dist), duration_s: Math.round(dur), geometry: geometry.map(([la, ln]) => [Math.round(la * 1e6) / 1e6, Math.round(ln * 1e6) / 1e6] as [number, number]), steps, snapped_start_m: Math.round(s.dist), snapped_end_m: Math.round(d.dist) };
}
