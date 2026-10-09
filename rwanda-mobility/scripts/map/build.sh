#!/usr/bin/env bash
# Rebuilds backend/map/rwanda.pmtiles from fresh OpenStreetMap data (about 5 minutes, needs Java 17+ and ~8 GB RAM).
# Usage: scripts/map/build.sh      (run from rwanda-mobility/; refresh a few times a year)
set -euo pipefail
OUT="$(cd "$(dirname "$0")/../.." && pwd)/backend/map"
WORK="${MAP_WORK:-$(mktemp -d)}"
mkdir -p "$WORK"; cd "$WORK"
curl -fL -o rwanda.osm.pbf https://download.openstreetmap.fr/extracts/africa/rwanda.osm.pbf        # or Geofabrik: download.geofabrik.de/africa/rwanda-latest.osm.pbf
[ -f planetiler.jar ] || curl -fL -o planetiler.jar https://github.com/onthegomap/planetiler/releases/latest/download/planetiler.jar
java -Xmx8g -jar planetiler.jar --osm-path=rwanda.osm.pbf --output=rwanda.pmtiles --download --force --maxzoom=14 --nodemap-type=sparsearray --storage=mmap
cp rwanda.pmtiles "$OUT/rwanda.pmtiles"
(python3 -I "$(dirname "$0")/places.py" rwanda.osm.pbf "$OUT/places.json" && echo "Wrote places.json") || echo "places.json not rebuilt (pip install osmium)"
echo "Wrote $OUT/rwanda.pmtiles ($(du -h "$OUT/rwanda.pmtiles" | cut -f1))"
