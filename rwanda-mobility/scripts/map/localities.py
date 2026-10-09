# Builds backend/map/localities.json (named villages, cells, towns and the 30 districts of Rwanda, with province) from a CSV of administrative places
# with columns Name,Region,Country,Latitude,Longitude,Population,Timezone. Rows whose name already exists in places.json within 3 km (OpenStreetMap) are skipped,
# and repeats of the same name within 700 m are merged. Usage: python3 scripts/map/localities.py places.csv backend/map/places.json backend/map/localities.json
import csv, json, math, re, sys, unicodedata, collections
src, osm, out = sys.argv[1], sys.argv[2], sys.argv[3]
def norm(s): return re.sub(r'[^a-z0-9 ]+', ' ', unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode().lower()).strip()
def hav(a, b, c, d):
    p = math.pi / 180; x = math.sin((c - a) * p / 2) ** 2 + math.cos(a * p) * math.cos(c * p) * math.sin((d - b) * p / 2) ** 2; return 12742000 * math.asin(math.sqrt(x))
ours = collections.defaultdict(list)
for o in json.load(open(osm)): ours[norm(o[0])].append((o[2], o[3]))
PROV = ['Kigali', 'Northern', 'Southern', 'Eastern', 'Western']
rows = list(csv.DictReader(open(src, encoding='utf-8-sig')))
kept = []; seen = collections.defaultdict(list); skipped_osm = skipped_dup = skipped_bad = 0
for r in sorted(rows, key=lambda r: -int(r['Population'] or 0)):
    name = r['Name'].strip(); lat = float(r['Latitude']); lng = float(r['Longitude'])
    if not name or not (-2.9 < lat < -1.0 and 28.8 < lng < 31.0): skipped_bad += 1; continue
    if name.endswith('Province'): continue                      # five provinces: not pickup places
    n = norm(name.replace(' District', ''))
    if any(hav(lat, lng, a, b) < 3000 for a, b in ours.get(n, [])): skipped_osm += 1; continue
    if any(hav(lat, lng, a, b) < 700 for a, b in seen[n]): skipped_dup += 1; continue
    seen[n].append((lat, lng))
    prov = next((i for i, p in enumerate(PROV) if r['Region'].startswith(p)), 0)
    kept.append([name, round(lat, 5), round(lng, 5), prov, int(r['Population'] or 0), 1 if name.endswith('District') else 0])
json.dump(kept, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
print('kept', len(kept), '| skipped: already in OpenStreetMap', skipped_osm, 'repeat', skipped_dup, 'bad coordinates', skipped_bad)
