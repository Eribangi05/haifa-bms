# Extracts named places (areas, hospitals, schools, hotels, markets, banks, bus stations...) from an OSM .pbf into backend/map/places.json.
# Usage: python3 -I scripts/map/places.py rwanda.osm.pbf backend/map/places.json   (needs: pip install osmium)
import osmium, json, sys
KEEP_AMENITY={'hospital','clinic','pharmacy','school','university','college','bank','restaurant','cafe','marketplace','place_of_worship','bus_station','fuel','police','townhall','courthouse','post_office','kindergarten','doctors','dentist','cinema','theatre','library','community_centre','atm'}
class H(osmium.SimpleHandler):
    def __init__(s): super().__init__(); s.out=[]; s.seen=set()
    def add(s,name,kind,lat,lng,t):
        if not name: return
        k=(name.lower(),kind,round(lat,3),round(lng,3))
        if k in s.seen: return
        s.seen.add(k); s.out.append([name,kind,round(lat,5),round(lng,5),t.get('name:rw') or '',t.get('name:fr') or '',t.get('name:en') or ''])
    def kind(s,t):
        p=t.get('place')
        if p in ('city','town','village','suburb','neighbourhood','hamlet','quarter','locality'): return 'area'
        a=t.get('amenity')
        if a in KEEP_AMENITY: return {'hospital':'hospital','clinic':'hospital','doctors':'hospital','pharmacy':'pharmacy','school':'school','university':'school','college':'school','kindergarten':'school','bank':'bank','atm':'bank','restaurant':'food','cafe':'food','marketplace':'market','place_of_worship':'worship','bus_station':'bus','fuel':'fuel'}.get(a,'service')
        if t.get('tourism') in ('hotel','guest_house','hostel','motel','attraction','museum','viewpoint','resort'): return 'hotel' if t['tourism'] in ('hotel','guest_house','hostel','motel','resort') else 'attraction'
        if t.get('shop') in ('mall','supermarket','department_store'): return 'shop'
        if t.get('leisure') in ('stadium','park','sports_centre'): return 'leisure'
        if t.get('aeroway')=='aerodrome' or t.get('railway')=='station' or t.get('public_transport')=='station': return 'bus'
        if t.get('office')=='government': return 'service'
        return None
    def node(s,n):
        if 'name' not in n.tags: return
        t=dict(n.tags); k=s.kind(t)
        if k and n.location.valid(): s.add(t['name'],k,n.location.lat,n.location.lon,t)
    def area(s,a):
        if 'name' not in a.tags: return
        t=dict(a.tags); k=s.kind(t)
        if not k or k=='area': return
        try:
            c=[(n.lat,n.lon) for r in a.outer_rings() for n in r]
            s.add(t['name'],k,sum(x[0] for x in c)/len(c),sum(x[1] for x in c)/len(c),t)
        except Exception: pass
h=H(); h.apply_file(sys.argv[1] if len(sys.argv)>1 else 'rw.osm.pbf',locations=True)
json.dump(h.out,open(sys.argv[2] if len(sys.argv)>2 else 'places.json','w'),ensure_ascii=False,separators=(',',':'))
from collections import Counter; print(len(h.out),Counter(x[1] for x in h.out).most_common(12))
