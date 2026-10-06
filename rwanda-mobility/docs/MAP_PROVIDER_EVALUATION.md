# Map provider evaluation (Kigali)

## What was measured (real, from this build environment)

`npm run map-eval` (in `backend/`) queries the **public** OpenStreetMap Nominatim and OSRM demo servers with 10 Kigali landmarks and 5 routes. Result on the build date:

| Metric | Result |
|---|---|
| Landmarks found by Nominatim | **9 of 10** |
| Median distance between result and our reference point | **~630 m** (reference points are approximate hand-entered coordinates, so this over-states error; one query hit the right suburb but a different point) |
| Road distance / straight line (OSRM, 5 routes) | **mean 1.51** (range 1.43-1.58) -> estimator road factor set to **1.5** (was 1.35) |
| OSRM free-flow speed | ~37 km/h average vs our conservative 24 km/h car assumption (OSRM ignores traffic) |

Sample: KCC -> Kimironko Market: straight 3.76 km, OSRM 5.95 km / 9.6 min.

**Limits of this test:** only 10 places and 5 routes, public demo servers (not for production use), reference coordinates are not surveyed. It shows OSM *is usable* in Kigali for the pilot; it does not prove pickup accuracy across the city.

## Candidates

| Provider | Pros | Cons / unknowns | Verdict for pilot |
|---|---|---|---|
| **OSM + self-hosted OSRM/Valhalla + Nominatim/Photon** | No per-request fees, full control, works with this code today (`MAP_PROVIDER=osrm`) | You operate it; OSM landmark/business coverage in Kigali is uneven; no traffic data | **Default for the pilot** (self-host; do not use the public demo servers beyond evaluation) |
| Mapbox | Good SDKs, offline tiles, matrix API, reasonable pricing | Business/POI coverage in Rwanda must be tested; per-request cost | Strong candidate; run `map-eval` with a Mapbox adapter |
| Google Maps Platform | Best POI/landmark search and traffic-aware ETA | Highest cost at scale; terms restrict some caching/usage | Evaluate for geocoding/ETA only if OSM landmark quality proves insufficient |
| HERE | Competitive routing, fleet features | Rwanda data quality to be tested | Optional |

## Procedure before choosing for launch

1. Collect 100+ real pickup points (markets, bus parks, hospitals, schools, hotels, busy junctions) with GPS ground truth taken on site.
2. Run each candidate: geocode by name (en + rw), reverse geocode, route 50 real trips, compare ETA to observed.
3. Score: landmark hit-rate, median pickup error, ETA error, cost per 1,000 trips, terms of use (caching, display).
4. Implement the winner behind `services/maps.ts` (`route`, `searchPlaces`) and the `MapBox` component; keep the estimator as the offline fallback (always labelled "estimated").

## Fallbacks implemented

* Routing down -> clearly labelled straight-line estimate (the fare screen says "distance is estimated").
* Map tiles unreachable -> banner + landmark chips + search (search falls back to the landmark list already loaded in memory; it is not persisted across restarts).
* Driver GPS unavailable -> driver cannot mark arrival (prevents false arrivals); dispatchers can intervene; phone/chat contact.
