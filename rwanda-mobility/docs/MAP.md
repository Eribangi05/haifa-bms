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

## Place search

`backend/map/places.json` (about 340 KB, 5,000 named places) is built from the same OpenStreetMap extract by `scripts/map/places.py`. `GET /places/search?q=...&lang=...&lat=...&lng=...` returns the curated places first, then matches from this index (accent-insensitive, word-start matching, nearest first when the rider's pickup is sent). It needs no external service. Rebuilt together with the map by `scripts/map/build.sh` (needs `pip install osmium`).

## Road router and turn-by-turn

`backend/map/roads.bin.gz` (about 11 MB) is the drivable road graph of Rwanda built from the same OpenStreetMap extract by `scripts/map/roads.py`: 158,000 junctions, 407,000 one-way road pieces, street names, road class, speed and one-way rules. The API loads it on the first routing request (about 100 MB of memory, about half a second) and routes with A* on travel time, in-process, with no external service.

* `MAP_PROVIDER=roads` (set in `render.yaml`): fares use the real road distance and time instead of "straight line x 1.5". If no road is found within 600 m, or the places are not connected, the fare falls back to the estimate and says so ("estimated").
* `GET /bookings/:id/navigation` (driver only): route to the pickup, then to the destination, with turn steps (street name, manoeuvre, distance) and the line to draw on the map. The app shows it in a full-screen view with the next manoeuvre in large letters, distance and time left, and asks for a new route when the driver leaves the road. Switch it off remotely with the `navigation.enabled` flag.
* Checked here: Kigali Convention Centre to Kimironko 6.7 km / 11 min, Kigali to Musanze 92 km, Kigali to Huye 125 km, a point outside Rwanda returns no route. Not checked: against real traffic or on a phone.
* Limits: no live traffic, no voice instructions yet, roads missing from OpenStreetMap are missing here, turn restrictions are not modelled, and a very new road needs a rebuild of the graph.

## Offline map

Settings has "Offline map of Kigali": it saves the map pieces of Kigali (zoom 8 to 14, about 200 pieces) in the phone's web-view cache. Every map piece the app shows is also kept there, so places already seen draw with no signal. Checked in a browser: 199 pieces saved, then the map drew Kigali with the map file blocked. Label fonts and map libraries are served with a one-year cache header. Not checked on an Android phone.

The offline cache for screens (trips, credit, earnings, driver status, landmarks) is separate: see `mobile/src/lib/cache.ts`. Those screens show "Saved copy from ..." while there is no signal.

## Fallbacks

1. If the vector map cannot start the page falls back to the public OpenStreetMap picture tiles (pilot use only, see the tile usage policy).
2. If that fails too the screen shows the existing "map unavailable" banner and the landmark chips.
3. Low-data mode still shows the text card instead of the map.

## Routing details (0.9.2)

* **Time of day**: `isRushHour` in `backend/src/services/roadGraph.ts`: weekdays 07:00 to 09:00 and 17:00 to 19:30 Kigali time, roads inside Kigali (box -2.10..-1.85, 29.95..30.20) run at 60 % (main roads) or 80 % (small roads) of free-flow speed. These factors are an assumption (`RUSH`); change them there. They affect ETAs and any fare that uses trip time.
* **Turn restrictions**: `scripts/map/roads.py` reads OpenStreetMap `restriction` relations (no_* and only_*, motor vehicles only) into the `RST1` section of `roads.bin.gz`; the router skips forbidden turns and, if that leaves no route at all, tries again without them. The current Rwanda extract has only 14 forbidden turns.

## Cost and licence

* Data: © OpenStreetMap contributors, ODbL. Tile design: © OpenMapTiles, CC-BY. Both credits are shown on the map. Fonts: Noto Sans (SIL OFL). MapLibre GL: BSD-3 (`backend/map/lib/LICENSE-maplibre.txt`).
* Cost: the file is served from the API (Render). 45 MB of storage, and bandwidth only for the pieces riders open. For heavy traffic put `rwanda.pmtiles` and `lib/` on a CDN or object storage and set `EXPO_PUBLIC_MAP_BASE` to its address.

* Villages, cells, towns and the 30 districts (`backend/map/localities.json`, built by `scripts/map/localities.py` from the owner-supplied CSV of Rwanda administrative places): the owner confirms it is an open, community-contributed dataset that is free to use. It adds about 19,000 names to search and names the rider's pickup ("Near {place}", `GET /places/reverse`). It has no categories and is ranked below OpenStreetMap places. Keep the source's credit line here if it asks for one.

## Refreshing the data

`scripts/map/build.sh` downloads the latest Rwanda extract and rebuilds `rwanda.pmtiles` (needs Java 17+, about 8 GB RAM, 5 minutes). Do this every few months. Street and building detail improves as OpenStreetMap volunteers edit (openstreetmap.org); this is the only way to correct a missing street or place.

## Known limits (honest)

* Tested: Kigali (detailed streets, names, buildings, hospitals and hotels draw correctly in a real browser). Not field-checked in the countryside, where OSM has fewer names and buildings.
* Map labels use the local OSM name. Where a Kinyarwanda name (`name:rw`) exists it is preferred; French and English names are not translated.
* Not offline yet. The map needs data. A future step is to cache the Kigali area on the phone.
* Search and routing are unchanged (places table, haversine fallback; see `MAP_PROVIDER_EVALUATION.md`).
