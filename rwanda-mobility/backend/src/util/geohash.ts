// Geohash cells (base32). Used as a plain indexed text column instead of PostGIS: nearby-driver lookups ask for a handful of cells, not every online driver.
const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function encode(lat: number, lng: number, precision: number): string {
  let latLo = -90, latHi = 90, lngLo = -180, lngHi = 180, bit = 0, ch = 0, even = true, out = '';
  while (out.length < precision) {
    if (even) { const m = (lngLo + lngHi) / 2; if (lng >= m) { ch = (ch << 1) | 1; lngLo = m; } else { ch <<= 1; lngHi = m; } }
    else { const m = (latLo + latHi) / 2; if (lat >= m) { ch = (ch << 1) | 1; latLo = m; } else { ch <<= 1; latHi = m; } }
    even = !even;
    if (++bit === 5) { out += B32[ch]; bit = 0; ch = 0; }
  }
  return out;
}

/** Approximate cell size in metres [height, width at the equator] for a precision. */
export const CELL_M: Record<number, [number, number]> = { 3: [156_000, 156_000], 4: [19_500, 39_000], 5: [4_900, 4_900], 6: [610, 1_200], 7: [153, 153] };

/** Pick the finest precision whose cells are still larger than the search radius, so a radius never needs more than 3x3 cells. */
export function precisionFor(radiusM: number): number | null {
  for (const p of [6, 5, 4]) if (Math.min(...CELL_M[p]) >= radiusM) return p;
  return null;       // very wide search: no cell filter
}

/** Every geohash cell (of `precision`) that touches the circle's bounding box around `c`. */
export function cellsCovering(c: { lat: number; lng: number }, radiusM: number, precision: number): string[] {
  const dLat = radiusM / 111_320, dLng = dLat / Math.max(0.2, Math.cos((c.lat * Math.PI) / 180));
  const [h, w] = CELL_M[precision]; const stepLat = (h / 111_320) * 0.9, stepLng = (w / 111_320 / Math.max(0.2, Math.cos((c.lat * Math.PI) / 180))) * 0.9;
  const set = new Set<string>();
  for (let la = c.lat - dLat; la <= c.lat + dLat + stepLat; la += stepLat)
    for (let ln = c.lng - dLng; ln <= c.lng + dLng + stepLng; ln += stepLng)
      set.add(encode(Math.max(-89.9, Math.min(89.9, Math.min(la, c.lat + dLat))), Math.min(ln, c.lng + dLng), precision));
  set.add(encode(c.lat, c.lng, precision));
  return [...set];
}
