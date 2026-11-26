"""OpenHistoricalMap (public domain, CC0): one boundary relation as a simplified MultiPolygon. Used for occupied
areas (build_occupations.py) and for the few states that the border sources leave blank or misplace
(build_clio.py, tools/curated/ohm_patches.json)."""
import json
import urllib.parse

from common import fetch
from geo import simplify_geom, polys_of, polygon_area_km2

OVERPASS = 'https://overpass-api.openhistoricalmap.org/api/interpreter'


def ohm_shape(rel_id):
    """The outline of one OpenHistoricalMap relation as a simplified MultiPolygon, with its name and dates."""
    q = f'[out:json][timeout:170];relation({rel_id});out geom;'
    body = fetch(OVERPASS, data=urllib.parse.urlencode({'data': q}), cache_key=f'ohm|{rel_id}', ext='.json', timeout=240)
    el = json.loads(body)['elements'][0]

    def rings(role):
        segs = [[(p['lon'], p['lat']) for p in m['geometry']] for m in el['members']
                if m['type'] == 'way' and (m['role'] or 'outer') == role and m.get('geometry')]
        out = []
        while segs:
            r = segs.pop()
            while r[0] != r[-1]:
                for i, sg in enumerate(segs):
                    if sg[0] == r[-1]:
                        r += sg[1:]
                    elif sg[-1] == r[-1]:
                        r += sg[-2::-1]
                    else:
                        continue
                    segs.pop(i)
                    break
                else:
                    break
            if r[0] == r[-1] and len(r) > 3:
                out.append([list(pt) for pt in r])
        return out
    g = {'type': 'MultiPolygon', 'coordinates': [[r] for r in rings('outer')]}   # enclaves (inner rings) are not cut out
    g = simplify_geom(g, 0.015, 2)
    t = el['tags']
    return g, {'name': t.get('name:en') or t.get('name'), 'start': t.get('start_date'), 'end': t.get('end_date'),
               'km2': round(sum(polygon_area_km2(p) for p in polys_of(g)))}
