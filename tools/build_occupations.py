"""Occupations: data/occupations.json from tools/curated/occupations.json.

Checks every row against the yearly maps (the named territory must be on the CShapes map in those years, or
the row must name an older CShapes outline to draw instead), resolves those outlines to a shape file and id,
and compares the years with the Wikidata item of the article the row cites (start and end time, or inception
and dissolution): "verified" when both years agree.

A row may instead carry "ohm": the id of a boundary relation in OpenHistoricalMap (public domain, CC0). Its
outline is fetched once through the Overpass API (cached), simplified, and written to
data/occupation_shapes.json (Manchukuo inside China).

"areas" are the occupied parts of a country: Cliopatria has one outline per calendar year of everything a
power held (the German Empire of 1915 to 1918, Nazi Germany, the Empire of Japan). That outline is cut to the
country as CShapes draws it on 1 July of the year (geo.clip_geom) and written to data/occupations/<id>.json.
Nothing is drawn by hand.
"""
import json
import urllib.parse
import os
import re

from common import DATA, TOOLS, read_json, write_json, sparql, qid, log, fetch
from geo import simplify_geom, polygon_area_km2, polys_of
from link_wikidata import year_of
from build_empires import titles_to_q


from ohm import OVERPASS, ohm_shape   # noqa: F401 (shared with build_clio.py)


def main():
    path = os.path.join(TOOLS, 'curated', 'occupations.json')
    cur = read_json(path)
    idx = read_json(os.path.join(DATA, 'cshapes', 'index.json'))
    names = {}
    for y in range(idx['from'], idx['to'] + 1):
        names[y] = {r[1] for r in read_json(os.path.join(DATA, 'cshapes', 'years', f'{y}.json'))['rows']}
    shapes = {}
    for c in idx['chunks']:
        for sid, s in read_json(os.path.join(DATA, 'cshapes', c['f'])).items():
            shapes.setdefault(s['cs'], []).append((s['s'], s['e'], c['f'], int(sid)))
    titles = [re.sub('_', ' ', r['source'].rsplit('/wiki/', 1)[-1]) for r in cur['rows']]
    dates = {}
    try:
        t2q = titles_to_q(titles)
        qs = sorted(set(t2q.values()))
        for i in range(0, len(qs), 100):
            vals = ' '.join('wd:' + q for q in qs[i:i + 100])
            for r in sparql('SELECT ?x ?a ?b WHERE { VALUES ?x { %s } OPTIONAL { ?x wdt:P580|wdt:P571 ?a } OPTIONAL { ?x wdt:P582|wdt:P576 ?b } }' % vals):
                d = dates.setdefault(qid(r['x']), [set(), set()])
                if r.get('a'):
                    d[0].add(year_of(r['a']))
                if r.get('b'):
                    d[1].add(year_of(r['b']))
    except Exception as ex:
        log('  Wikidata not reachable, occupations stay unverified:', ex)
        t2q = {}
    out = []
    missing = []
    ohm = {}
    for r, t in zip(cur['rows'], titles):
        d = dates.get(t2q.get(t))
        r['verified'] = bool(d and r['from'] // 10000 in d[0] and r['to'] // 10000 in d[1])
        ya, yb = max(r['from'] // 10000, idx['from']), min(r['to'] // 10000, idx['to'])
        on_map = sorted({n for y in range(ya, yb + 1) for n in r['names'] if n in names[y]})
        row = {'label': r['label'], 'n': on_map, 'in': r.get('within', []), 'covers': r.get('covers', []), 'by': r['by'], 'key': r['key'], 'from': r['from'], 'to': r['to'], 'kind': r['kind'],
               'note': r['note'], 'src': r['source'], 'v': r['verified']}
        if r.get('shape'):
            hit = [s for s in shapes.get(r['shape']['cs'], []) if s[0] <= r['shape']['date'] <= s[1]]
            if hit:
                row['shape'] = {'f': hit[0][2], 'id': hit[0][3]}
        if r.get('ohm'):
            g, info = ohm_shape(r['ohm'])
            # the relation's own years must contain the row's years (a row may end earlier: see its note)
            ya_, yb_ = int(info['start'][:4]), int(info['end'][:4])
            if g and ya_ <= r['from'] // 10000 and r['to'] // 10000 <= yb_:
                ohm[str(r['ohm'])] = {'g': g, 'n': info['name'], 'km2': info['km2']}
                row['shape'] = {'src': 'ohm', 'id': str(r['ohm'])}
                row['n'] = []   # drawn from its own outline, never by re-tinting a whole country
            else:
                log('  OpenHistoricalMap relation does not fit the row:', r['label'], info)
        if not on_map and 'shape' not in row:
            missing.append(r['label'])
            continue
        out.append(row)
    # the occupied part of a country, from Cliopatria's yearly outline of the occupier cut to the country
    import build_clio
    import yearly
    from geo import clip_geom
    odir = os.path.join(DATA, 'occupations')
    os.makedirs(odir, exist_ok=True)
    for f in os.listdir(odir):
        os.remove(os.path.join(odir, f))
    clio = None
    n_area = 0
    for ar in cur.get('areas', []):
        if clio is None:
            clio = build_clio.load()['features']
        minus = ohm_shape(ar['minus_ohm'])[0] if ar.get('minus_ohm') else None
        prow = sorted((f['properties']['FromYear'], f['properties']['ToYear'], f['geometry']) for f in clio
                      if f['properties']['Name'] == ar['clio'] and f['properties'].get('Type') == 'POLITY' and f.get('geometry'))
        for ov in ar['over']:
            for y in range(max(ov['from'] // 10000, idx['from']), min(ov['to'] // 10000, idx['to']) + 1):
                pg = next((g for a, b, g in prow if a <= y <= b), None)
                vic = next((p for p in yearly.year_doc(y) if p['n'] in [ov['name']] + ov.get('alt', [])), None)
                if pg is None or vic is None:
                    continue
                g = clip_geom(pg, vic['g'], minus)
                km2 = round(sum(polygon_area_km2(q) for q in polys_of(g))) if g else 0
                if km2 < ov.get('min_km2', 15000):
                    continue   # nothing held inside that country in Cliopatria's outline of the year (slivers where the two sources' borders differ)
                sid = f"{ar['key']}-{vic['n'].lower().replace(' ', '-').replace('(', '').replace(')', '')}-{y}"
                write_json(os.path.join(odir, sid + '.json'), {'g': g, 'km2': km2, 'from': f"Cliopatria, {ar['clio']} {y}", 'cut': f"CShapes, {vic['n']} on 1 July {y}"})
                out.append({'label': ov['label'], 'n': [], 'in': [vic['n']], 'covers': ov.get('covers', []), 'quiet': vic['n'] in ov.get('covers', []),
                            'by': ar['by'], 'key': ar['key'], 'from': max(ov['from'], y * 10000 + 101), 'to': min(ov['to'], y * 10000 + 1231),
                            'kind': ar['kind'], 'note': ov['note'], 'src': ov.get('source') or ar['source'], 'v': False, 'ds': f'Cliopatria, {km2:,} km²'.replace(',', ' '),
                            'shape': {'src': 'area', 'id': sid}})
                n_area += 1
    write_json(path, cur, pretty=True)
    write_json(os.path.join(DATA, 'occupations.json'), {'rows': out})
    write_json(os.path.join(DATA, 'occupation_shapes.json'), ohm)
    log(f'occupations: {len(out)} rows on the maps ({sum(r["v"] for r in out)} verified, {n_area} parts of countries from Cliopatria); not on any map and left out: {missing}')


if __name__ == '__main__':
    main()
