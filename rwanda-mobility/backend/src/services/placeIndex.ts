import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversineM, type LatLng } from '../util/geo.js';

/**
 * Offline place search over named OpenStreetMap places (areas, hospitals, schools, hotels, markets, banks, bus stations...).
 * Built by scripts/map/places.py into backend/map/places.json (docs/MAP.md). No external service, no cost; works on the free plan.
 */
type Row = { name: string; kind: string; lat: number; lng: number; rw: string; fr: string; en: string; words: string[]; nname: string };
export type OsmHit = { name: string; kind: string; lat: number; lng: number; source: 'osm' };

export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'map', 'places.json');
let rows: Row[] | null = null;

function load(): Row[] {
  if (rows) return rows;
  rows = [];
  if (existsSync(FILE)) {
    try { for (const r of JSON.parse(readFileSync(FILE, 'utf8')) as any[]) rows.push({ name: r[0], kind: r[1], lat: r[2], lng: r[3], rw: r[4], fr: r[5], en: r[6], words: norm([r[0], r[4], r[5], r[6]].filter(Boolean).join(' ')).split(' '), nname: norm(r[0]) }); }
    catch { rows = []; }
  }
  return rows;
}
export const placeIndexSize = () => load().length;

/** Token-prefix match: every query word must start a word of the place name. Ranked: name starts with query, then whole-word hits, then proximity. */
const cache = new Map<string, OsmHit[]>();      // tiny LRU for the unbiased query (typing the same words again is common)
export function searchIndex(text: string, lang: 'rw' | 'fr' | 'en', near?: LatLng, limit = 8): OsmHit[] {
  const q = norm(text);
  if (q.length < 2) return [];
  const ck = near ? '' : `${lang}|${limit}|${q}`;
  if (ck && cache.has(ck)) return cache.get(ck)!;
  const toks = q.split(' ');
  const scored: { r: Row; s: number }[] = [];
  for (const r of load()) {
    const words = r.words;
    if (!toks.every((t) => words.some((w) => w.startsWith(t)))) continue;
    let s = 0;
    const n = r.nname;
    if (n === q) s += 100; else if (n.startsWith(q)) s += 60;
    if (toks.every((t) => words.includes(t))) s += 20;
    if (r.kind === 'area') s += 8; else if (r.kind === 'market' || r.kind === 'bus' || r.kind === 'hospital') s += 3;
    if (near) s += Math.max(0, 25 - haversineM(near, r) / 1000);     // closer places first (up to 25 km)
    scored.push({ r, s });
  }
  scored.sort((a, b) => b.s - a.s);
  const res = scored.slice(0, limit).map(({ r }) => ({ name: (lang === 'rw' ? r.rw : lang === 'fr' ? r.fr : r.en) || r.name, kind: r.kind, lat: r.lat, lng: r.lng, source: 'osm' as const }));
  if (ck) { if (cache.size > 500) cache.clear(); cache.set(ck, res); }
  return res;
}
