import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversineM, type LatLng } from '../util/geo.js';

/**
 * Offline place search over named OpenStreetMap places (areas, hospitals, schools, hotels, markets, banks, bus stations...).
 * Built by scripts/map/places.py into backend/map/places.json (docs/MAP.md). No external service, no cost; works on the free plan.
 */
type Row = { name: string; kind: string; sub?: string; prov?: number; rank?: number; lat: number; lng: number; rw: string; fr: string; en: string; words: string[]; nname: string };
export type OsmHit = { name: string; kind: string; lat: number; lng: number; source: 'osm'; sub?: string };

export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'map', 'places.json');
const LOC_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'map', 'localities.json');
const PROVINCES = ['Kigali City', 'Northern Province', 'Southern Province', 'Eastern Province', 'Western Province'];
const PROVINCES_L = {      // shown in the language of the person searching: never a mix
  en: PROVINCES,
  rw: ['Umujyi wa Kigali', 'Intara y\'Amajyaruguru', 'Intara y\'Amajyepfo', 'Intara y\'Iburasirazuba', 'Intara y\'Iburengerazuba'],
  fr: ['Ville de Kigali', 'Province du Nord', 'Province du Sud', 'Province de l\'Est', 'Province de l\'Ouest'],
} as const;
const districtName = (base: string, lang: 'rw' | 'fr' | 'en') => (lang === 'rw' ? `Akarere ka ${base}` : lang === 'fr' ? `District de ${base}` : `${base} District`);
let rows: Row[] | null = null;

function load(): Row[] {
  if (rows) return rows;
  rows = [];
  if (existsSync(FILE)) {
    try { for (const r of JSON.parse(readFileSync(FILE, 'utf8')) as any[]) rows.push({ name: r[0], kind: r[1], lat: r[2], lng: r[3], rw: r[4], fr: r[5], en: r[6], words: norm([r[0], r[4], r[5], r[6]].filter(Boolean).join(' ')).split(' '), nname: norm(r[0]) }); }
    catch { rows = []; }
  }
  // villages, cells, towns and the 30 districts (scripts/map/localities.py): ranked below OpenStreetMap places, they let rural spots be found and named
  if (existsSync(LOC_FILE)) {
    try { for (const r of JSON.parse(readFileSync(LOC_FILE, 'utf8')) as any[]) { const base = r[5] ? String(r[0]).replace(/ District$/, '') : r[0]; rows.push({ name: base, kind: r[5] ? 'district' : 'locality', prov: r[3], rank: -6, lat: r[1], lng: r[2], rw: '', fr: '', en: '', words: norm(r[5] ? `${base} district akarere` : base).split(' '), nname: norm(base) }); } }
    catch { /* optional file */ }
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
    let s = r.rank ?? 0;
    const n = r.nname;
    if (n === q) s += 100; else if (n.startsWith(q)) s += 60;
    if (toks.every((t) => words.includes(t))) s += 20;
    if (r.kind === 'area') s += 8; else if (r.kind === 'market' || r.kind === 'bus' || r.kind === 'hospital') s += 3;
    if (near) s += Math.max(0, 25 - haversineM(near, r) / 1000);     // closer places first (up to 25 km)
    scored.push({ r, s });
  }
  scored.sort((a, b) => b.s - a.s);
  const res = scored.slice(0, limit).map(({ r }) => ({ name: r.kind === 'district' ? districtName(r.name, lang) : (lang === 'rw' ? r.rw : lang === 'fr' ? r.fr : r.en) || r.name, kind: r.kind, lat: r.lat, lng: r.lng, source: 'osm' as const, ...(r.prov != null ? { sub: PROVINCES_L[lang][r.prov] } : {}) }));
  if (ck) { if (cache.size > 500) cache.clear(); cache.set(ck, res); }
  return res;
}

/** Nearest named place to a point (used to name "My location" in the field): OpenStreetMap areas first, then villages/cells; null when nothing is within maxM. */
export function reverseIndex(p: LatLng, maxM = 2500, lang: 'rw' | 'fr' | 'en' = 'en'): OsmHit | null {
  let best: Row | null = null; let bd = Infinity;
  for (const r of load()) {
    if (r.kind === 'district') continue;
    if (Math.abs(r.lat - p.lat) > 0.03 || Math.abs(r.lng - p.lng) > 0.03) continue;
    const d = haversineM(p, r) + (r.rank ? 150 : 0);
    if (d < bd) { bd = d; best = r; }
  }
  return best && bd <= maxM ? { name: best.name, kind: best.kind, lat: best.lat, lng: best.lng, source: 'osm', ...(best.prov != null ? { sub: PROVINCES_L[lang][best.prov] } : {}) } : null;
}
