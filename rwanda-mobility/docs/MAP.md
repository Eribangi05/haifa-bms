# Rwanda map

Abasare draws its own map of Rwanda. There is no map API key and no per-use fee.

## What it is

| Part | What | Where |
|---|---|---|
| Map data | OpenStreetMap data for all of Rwanda: roads with names, buildings, hospitals, hotels, shops, schools, markets, rivers, lakes, forests, districts, villages | `backend/map/rwanda.pmtiles` (about 45 MB, one file, zoom 0-14, drawn sharper beyond that) |
| Map drawing | MapLibre GL (vector, smooth zoom) with a custom Abasare style | `mobile/src/ui/mapHtml.ts`, libraries in `backend/map/lib/` |
| Labels | Noto Sans (open font), Latin ranges for Kinyarwanda, French and English place names | `backend/map/fonts/` |
| Serving | The API serves `/map/*` as public files with HTTP range requests, no rate limit, cached for a day | `backend/src/app.ts` |

The phone downloads only the pieces it shows (range requests), not the 45 MB file.

## Fallbacks

1. If the vector map cannot start the page falls back to the public OpenStreetMap picture tiles (pilot use only, see the tile usage policy).
2. If that fails too the screen shows the existing "map unavailable" banner and the landmark chips.
3. Low-data mode still shows the text card instead of the map.

## Cost and licence

* Data: © OpenStreetMap contributors, ODbL. Tile design: © OpenMapTiles, CC-BY. Both credits are shown on the map. Fonts: Noto Sans (SIL OFL). MapLibre GL: BSD-3 (`backend/map/lib/LICENSE-maplibre.txt`).
* Cost: the file is served from the API (Render). 45 MB of storage, and bandwidth only for the pieces riders open. For heavy traffic put `rwanda.pmtiles` and `lib/` on a CDN or object storage and set `EXPO_PUBLIC_MAP_BASE` to its address.

## Refreshing the data

`scripts/map/build.sh` downloads the latest Rwanda extract and rebuilds `rwanda.pmtiles` (needs Java 17+, about 8 GB RAM, 5 minutes). Do this every few months. Street and building detail improves as OpenStreetMap volunteers edit (openstreetmap.org); this is the only way to correct a missing street or place.

## Known limits (honest)

* Tested: Kigali (detailed streets, names, buildings, hospitals and hotels draw correctly in a real browser). Not field-checked in the countryside, where OSM has fewer names and buildings.
* Map labels use the local OSM name. Where a Kinyarwanda name (`name:rw`) exists it is preferred; French and English names are not translated.
* Not offline yet. The map needs data. A future step is to cache the Kigali area on the phone.
* Search and routing are unchanged (places table, haversine fallback; see `MAP_PROVIDER_EVALUATION.md`).
