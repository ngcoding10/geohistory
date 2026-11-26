"""Step 2c: yearly border maps for 1886-2019 from CShapes 2.0 (dated state borders), with shared geometry.

CShapes gives every state and dependent territory a shape with exact start and end dates. We take the
situation on 1 July of each year. Each distinct shape is simplified once and stored in a shape file
(data/cshapes/shapes-N.json, grouped by start date); each year gets a small list of shape ids with the
ruling power (data/cshapes/years/<year>.json). So 134 years do not mean 134 copies of the world.

Who rules a unit: if its Gleditsch-Ward code is an independent state on that date (the GW list of
independent states, ksgleditsch.com), it rules itself. Otherwise it is a dependency, and its ruler is
the ruling power of the historical-basemaps territory under its label point on the nearest earlier map.
Display names follow tools/curated/cshapes_names.json (e.g. "Ottoman Empire" before 29 Oct 1923).

Writes data/cshapes/index.json, shapes-N.json, years/<year>.json and updates data/powers.json for powers
that only appear here. Also exposes year_doc(year) for build_events.py.
"""
import json
import os
from collections import defaultdict, Counter

from common import fetch, write_json, read_json, DATA, TOOLS, CACHE, log
from fetch_sources import CSHAPES
from geo import simplify_geom, label_point, bbox_of, PolyIndex, encode_geom, decode_geom
from build_borders import power_key, PALETTE, CURATED, label_name

GW = 'http://ksgleditsch.com/data/iisystem.dat'
FIRST, LAST = 1886, 2019
CHUNK = 90


def dint(y, m, d):
    return y * 10000 + m * 100 + d


def load_gw():
    out = defaultdict(list)
    for line in fetch(GW).decode('latin-1').splitlines():
        bits = line.split('\t')
        if len(bits) < 5:
            continue
        d0, m0, y0 = map(int, bits[3].split(':'))
        d1, m1, y1 = map(int, bits[4].split(':'))
        end = 99991231 if y1 >= 2017 else dint(y1, m1, d1)
        out[int(bits[0])].append((dint(y0, m0, d0), end))
    return out


def name_rules():
    rules = defaultdict(list)
    for r in read_json(os.path.join(TOOLS, 'curated', 'cshapes_names.json'))['rules']:
        rules[r['cs']].append(r)
    return rules


def display_name(cs, date, rules):
    rs = rules.get(cs)
    if not rs:
        return cs.split(' (')[0].strip()
    for r in rs:
        if 'until' not in r or date <= r['until']:
            return r['name']
    return rs[-1].get('after', rs[-1]['name'])


def build():
    src = json.loads(fetch(CSHAPES, ext='.geojson', timeout=600))
    gw = load_gw()
    rules = name_rules()
    shapes = []
    for f in src['features']:
        p = f['properties']
        g = simplify_geom(f['geometry'], 0.012, 3)
        if not g:
            continue
        shapes.append({'cs': p['cntry_name'], 'gw': p['gwcode'], 'a': int(p['area']),
                       's': dint(p['gwsyear'], p['gwsmonth'], p['gwsday']),
                       'e': dint(p['gweyear'], p['gwemonth'], p['gweday']),
                       'g': g, 'l': label_point(g), 'bb': [round(v, 1) for v in bbox_of(g)],
                       'cap': p.get('capname')})
    shapes.sort(key=lambda s: (s['s'], s['gw']))
    for i, s in enumerate(shapes):
        s['id'] = i

    # coarse maps, for the rulers of dependencies
    bindex = read_json(os.path.join(DATA, 'borders', 'index.json'))['snapshots']
    coarse = {}

    def coarse_at(year):
        best = max(s['y'] for s in bindex if s['y'] <= year)
        if best not in coarse:
            doc = read_json(os.path.join(DATA, 'borders', f'{best}.json'))
            coarse[best] = (PolyIndex([(f['properties']['k'], f['geometry']) for f in doc['features'] if f['properties']['k'] >= 0]), doc['polities'])
        return coarse[best]

    def coarse_back(year, back):
        ys = sorted(s['y'] for s in bindex if s['y'] <= year)
        if len(ys) <= back:
            return None, None
        return coarse_at(ys[-1 - back])

    powers = read_json(os.path.join(DATA, 'powers.json'))
    owners = defaultdict(list)
    for r in read_json(os.path.join(TOOLS, 'curated', 'dependency_owners.json'))['rules']:
        owners[r['name']].append(r)
    curated_rows = set()
    years = {}
    for y in range(FIRST, LAST + 1):
        date = dint(y, 7, 1)
        rows = []
        for s in shapes:
            if not (s['s'] <= date <= s['e']):
                continue
            name = display_name(s['cs'], date, rules)
            indep = any(a <= date <= b for a, b in gw.get(s['gw'], []))
            if indep:
                pk, ruler = power_key(name), None
            else:
                pk, ruler = power_key(name), 'not independent (ruler not recorded on this map)'
                # the ruler from the nearest earlier maps (up to three back: some maps show colonies as self-ruled)
                for back in range(3):
                    ci, cpol = coarse_back(y, back)
                    if ci is None or not s['l']:
                        break
                    k = ci.lookup(*s['l'])
                    if k is None:
                        k = ci.nearest(*s['l'], 2.0)
                    cp = cpol[k] if k is not None else None
                    if cp and cp.get('s') and cp['s'] != cp['n']:
                        pk, ruler = cp['p'], cp['s']
                        break
            if not indep:
                # curated owners, keyed by the CShapes source name (the display name is tried last)
                for r in owners.get(s['cs'], []) + (owners.get(name, []) if name != s['cs'] else []):
                    if r.get('from', 0) <= date <= r.get('until', 99991231):
                        if r.get('self'):
                            pk = power_key(name)        # keeps its own colour; the text explains its status
                        elif r.get('key'):
                            pk = r['key']
                        else:
                            pk = power_key(r['owner']) if r['owner'] != 'Leopold II of Belgium (Congo Free State)' else 'belgium'
                        ruler = r['owner']
                        curated_rows.add((y, s['id']))
                        break
            rows.append([s['id'], name, pk, ruler] + ([1] if (y, s['id']) in curated_rows else []))
        years[y] = rows

    # colours for powers that only appear in CShapes
    for rows in years.values():
        for _, name, pk, *_ in rows:
            if pk not in powers:
                h = sum(ord(c) * (i + 1) for i, c in enumerate(pk))
                powers[pk] = {'name': name, 'color': CURATED.get(pk) or PALETTE[h % len(PALETTE)], 'years': [FIRST, LAST]}
    write_json(os.path.join(DATA, 'powers.json'), powers)
    return shapes, years, powers


def year_doc(y, shapes=None, years=None):
    """Assembled polity table + geometries for one year (used by build_events for event placement)."""
    if shapes is None:
        shapes, years = _cache()
    byid = {s['id']: s for s in shapes}
    pols = []
    for sid, name, pk, ruler, *_ in years[y]:
        s = byid[sid]
        pols.append({'n': name, 'p': pk, 's': ruler, 'a': s['a'], 'g': s['g']})
    return pols


_C = {}


def _cache():
    if not _C:
        idx = read_json(os.path.join(DATA, 'cshapes', 'index.json'))
        shapes = []
        for c in idx['chunks']:
            for sid, s in read_json(os.path.join(DATA, 'cshapes', c['f'])).items():
                shapes.append({'id': int(sid), 'a': s['a'], 'g': decode_geom(s['g'])})
        years = {}
        for y in range(idx['from'], idx['to'] + 1):
            years[y] = read_json(os.path.join(DATA, 'cshapes', 'years', f'{y}.json'))['rows']
        _C['v'] = (shapes, years)
    return _C['v']


def main():
    shapes, years, powers = build()
    out = os.path.join(DATA, 'cshapes')
    os.makedirs(os.path.join(out, 'years'), exist_ok=True)
    chunks = []
    total = 0
    for i in range(0, len(shapes), CHUNK):
        part = shapes[i:i + CHUNK]
        f = f'shapes-{i // CHUNK}.json'
        doc = {str(s['id']): {'g': encode_geom(s['g']), 'a': s['a'], 'l': s['l'], 'bb': s['bb'], 'cs': s['cs'], 's': s['s'], 'e': s['e']}
               for s in part}
        total += write_json(os.path.join(out, f), doc)
        chunks.append({'f': f, 'lo': part[0]['id'], 'hi': part[-1]['id']})
    prev = None
    for y, rows in years.items():
        area = {}
        byid = {s['id']: s for s in shapes}
        parea = defaultdict(float)
        pcount = Counter()
        pname = {}
        for sid, name, pk, ruler, *_ in rows:
            parea[pk] += byid[sid]['a']
            pcount[pk] += 1
            if not ruler:
                pname[pk] = name
        largest = [{'p': k, 'name': pname.get(k) or powers.get(k, {}).get('name', k), 'a': round(a), 'n': pcount[k]}
                   for k, a in sorted(parea.items(), key=lambda x: -x[1])[:15]]
        names = {r[1]: byid[r[0]]['a'] for r in rows}
        changes = None
        if prev is not None:
            ap = sorted((n for n in names if n not in prev), key=lambda n: -names[n])
            gone = sorted((n for n in prev if n not in names), key=lambda n: -prev[n])
            ruler_changes = sorted(f'{r[1]}: now {r[3] or "independent"}' for r in rows
                                   if r[1] in prev_rulers and prev_rulers[r[1]] != bool(r[3]))
            changes = {'since': y - 1, 'appeared': ap[:12], 'gone': gone[:12], 'nAppeared': len(ap), 'nGone': len(gone),
                       'ruler': ruler_changes[:12]}
        prev = names
        prev_rulers = {r[1]: bool(r[3]) for r in rows}
        rows_sorted = sorted(rows, key=lambda r: -byid[r[0]]['a'])
        need = sorted({c['f'] for c in chunks for r in rows if c['lo'] <= r[0] <= c['hi']})
        total += write_json(os.path.join(out, 'years', f'{y}.json'),
                            {'year': y, 'date': f'{y}-07-01', 'rows': rows_sorted, 'need': need,
                             'largest': largest, 'changes': changes})
    write_json(os.path.join(out, 'index.json'), {'from': FIRST, 'to': LAST, 'chunks': chunks, 'shapes': len(shapes)})
    # names for search and Wikidata linking
    names_path = os.path.join(CACHE, 'names.json')
    names = read_json(names_path)
    for y, rows in years.items():
        for r in rows:
            ys = names.setdefault(r[1], [])
            if y not in ys:
                ys.append(y)
    for ys in names.values():
        ys.sort()
    write_json(names_path, names)
    log(f'cshapes: {len(shapes)} shapes in {len(chunks)} files, {LAST - FIRST + 1} years, {total // 1024} KB')


if __name__ == '__main__':
    main()
