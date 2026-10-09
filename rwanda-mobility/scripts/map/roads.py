# Builds the Abasare road graph (backend/map/roads.bin.gz) from an OpenStreetMap .pbf: drivable roads cut at junctions, with name, class and one-way rules.
# Usage: python3 -I scripts/map/roads.py rwanda.osm.pbf backend/map/roads.bin.gz      (needs: pip install osmium numpy)
# File format (little-endian, then gzip): see backend/src/services/roadGraph.ts (the reader) for the exact layout.
import sys, gzip, struct, collections
import numpy as np
import osmium

CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service', 'living_street', 'track']
CLS = {c: i for i, c in enumerate(CLASSES)}
LINK = {f'{c}_link': c for c in ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']}
MAXSPEED_DEFAULT = {'motorway': 90, 'trunk': 70, 'primary': 60, 'secondary': 50, 'tertiary': 40, 'unclassified': 30, 'residential': 25, 'service': 15, 'living_street': 10, 'track': 15}

class Ways(osmium.SimpleHandler):
    def __init__(s):
        super().__init__(); s.ways = []; s.use = collections.Counter()
    def way(s, w):
        t = w.tags; h = t.get('highway')
        if not h: return
        h = LINK.get(h, h)
        if h not in CLS: return
        if t.get('access') in ('no', 'private') and t.get('motor_vehicle') not in ('yes', 'permissive', 'destination'): return
        if t.get('motor_vehicle') in ('no', 'private') or t.get('motorcar') == 'no': return
        refs = [n.ref for n in w.nodes]
        if len(refs) < 2: return
        ow = t.get('oneway')
        oneway = 0
        if ow in ('yes', 'true', '1') or t.get('junction') == 'roundabout': oneway = 1
        elif ow == '-1': oneway = -1
        ms = t.get('maxspeed', '')
        try: spd = int(''.join(ch for ch in ms.split(' ')[0] if ch.isdigit())) if ms else 0
        except ValueError: spd = 0
        if not (5 <= spd <= 130): spd = MAXSPEED_DEFAULT[h]
        name = t.get('name') or t.get('ref') or ''
        s.ways.append((refs, CLS[h], oneway, spd, name))
        for r in refs: s.use[r] += 1
        s.use[refs[0]] += 1; s.use[refs[-1]] += 1          # ends always count as junctions

class Coords(osmium.SimpleHandler):
    def __init__(s, wanted): super().__init__(); s.wanted = wanted; s.xy = {}
    def node(s, n):
        if n.id in s.wanted and n.location.valid(): s.xy[n.id] = (n.location.lat, n.location.lon)

def rdp(pts, a, b, tol_m=2.5):
    # Douglas-Peucker on the shape points between nodes a and b (planar approximation around Rwanda: 1 deg lat ~ 111.1 km, lng ~ 111.3 km at the equator)
    if not pts: return []
    A = np.array([a[0] * 111100.0, a[1] * 111300.0]); B = np.array([b[0] * 111100.0, b[1] * 111300.0])
    P = np.array([[p[0] * 111100.0, p[1] * 111300.0] for p in pts])
    keep = [False] * len(pts)
    stack = [(-1, len(pts))]
    pts_all = np.vstack([A, P, B])         # index i in pts -> i+1 in pts_all
    while stack:
        lo, hi = stack.pop()
        if hi - lo < 2: continue
        s0, s1 = pts_all[lo + 1], pts_all[hi + 1]
        seg = s1 - s0; L2 = float(seg @ seg)
        mid = pts_all[lo + 2:hi + 1]
        if L2 == 0: d = np.linalg.norm(mid - s0, axis=1)
        else:
            t = np.clip(((mid - s0) @ seg) / L2, 0, 1); d = np.linalg.norm(mid - (s0 + np.outer(t, seg)), axis=1)
        k = int(np.argmax(d))
        if d[k] > tol_m:
            idx = lo + 1 + k; keep[idx] = True; stack.append((lo, idx)); stack.append((idx, hi))
    return [p for p, kf in zip(pts, keep) if kf]

def hav(a, b):
    from math import radians, sin, cos, asin, sqrt
    la1, lo1, la2, lo2 = map(radians, (a[0], a[1], b[0], b[1]))
    d = sin((la2 - la1) / 2) ** 2 + cos(la1) * cos(la2) * sin((lo2 - lo1) / 2) ** 2
    return 12742000 * asin(sqrt(d))

src, dst = sys.argv[1], sys.argv[2]
W = Ways(); W.apply_file(src)
need = set(W.use.keys())
C = Coords(need); C.apply_file(src, locations=False)
xy = C.xy
node_idx = {}; lat = []; lng = []
def nid(ref):
    if ref not in node_idx: node_idx[ref] = len(lat); lat.append(xy[ref][0]); lng.append(xy[ref][1])
    return node_idx[ref]
names = ['']; name_idx = {'': 0}
def nm(s):
    if s not in name_idx: name_idx[s] = len(names); names.append(s)
    return name_idx[s]
edges = []      # (from, to, len_dm, cls, speed, name, geom[(lat,lng)...])
for refs, cls, oneway, spd, name in W.ways:
    refs = [r for r in refs if r in xy]
    if len(refs) < 2: continue
    ni = nm(name)
    seg = [refs[0]]
    def flush(seg):
        pts = [xy[r] for r in seg]
        length = sum(hav(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
        if length < 0.5: return
        a, b = nid(seg[0]), nid(seg[-1])
        if a == b and len(seg) < 4: return
        mid = rdp(pts[1:-1], pts[0], pts[-1])
        if oneway >= 0: edges.append((a, b, int(length * 10), cls, spd, ni, mid))
        if oneway <= 0: edges.append((b, a, int(length * 10), cls, spd, ni, mid[::-1]))
    for r in refs[1:]:
        seg.append(r)
        if W.use[r] > 1 or r == refs[-1]:
            flush(seg); seg = [r]
n = len(lat); m = len(edges)
edges.sort(key=lambda e: e[0])
first = np.zeros(n + 1, dtype=np.uint32)
for e in edges: first[e[0] + 1] += 1
first = np.cumsum(first, dtype=np.uint32)
to = np.array([e[1] for e in edges], dtype=np.uint32)
ln = np.array([e[2] for e in edges], dtype=np.uint32)
cl = np.array([e[3] for e in edges], dtype=np.uint8)
sp = np.array([e[4] for e in edges], dtype=np.uint8)
na = np.array([e[5] for e in edges], dtype=np.uint32)
gs = np.zeros(m + 1, dtype=np.uint32)
pool = []
for i, e in enumerate(edges):
    gs[i + 1] = gs[i] + len(e[6])
    for p in e[6]: pool.append(p)
glat = np.array([int(round(p[0] * 1e6)) for p in pool], dtype=np.int32); glng = np.array([int(round(p[1] * 1e6)) for p in pool], dtype=np.int32)
nlat = np.array([int(round(x * 1e6)) for x in lat], dtype=np.int32); nlng = np.array([int(round(x * 1e6)) for x in lng], dtype=np.int32)
blob = '\n'.join(names).encode('utf8')
with gzip.open(dst, 'wb', compresslevel=9) as f:
    f.write(b'RGR1' + struct.pack('<IIIII', n, m, len(names), len(pool), len(blob)))
    for arr in (nlat, nlng, first, to, ln, cl, sp, na, gs, glat, glng): f.write(arr.tobytes())
    f.write(blob)
print('nodes', n, 'edges', m, 'names', len(names), 'shape points', len(pool))
