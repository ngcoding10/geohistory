"""Step 2f: yearly border maps for 1700-1885 from Cliopatria (Seshat Global History Databank, CC BY 4.0).

The coarse world snapshots have nothing between 1715 and 1783 or between 1815 and 1878, so 1776 used to
show 1715 borders. Cliopatria gives every polity one or more shapes, each valid for a range of years, with
the empire it belongs to. We store each shape once (data/clio/shapes-N.json) and a short list of shape ids
per year (data/clio/years/<year>.json): the same layout as the CShapes years (build_cshapes.py).

Cliopatria only draws states. Peoples and regions without a state (most of North America, Australia,
parts of Africa and the Amazon in these years) would be blank, so self-ruled territories of the nearest
earlier world snapshot are drawn underneath wherever Cliopatria has no polity; those rows carry the
snapshot year and the app labels them as coming from the older sketch map.

Nothing is drawn by hand here: every outline is a source polygon, simplified.
"""
import io
import json
import os
import zipfile
from collections import defaultdict, Counter

from common import fetch, write_json, read_json, DATA, CACHE, log
from fetch_sources import CLIO
from geo import simplify_geom, label_point, bbox_of, polygon_area_km2, polys_of, PolyIndex
from build_borders import power_key, PALETTE

FIRST, LAST = 1700, 1885
BUCKET = 5
# Cliopatria spellings -> the colour keys used by the other maps (build_borders.ALIASES)
CLIO_KEYS = {
    'qing dynasty': 'china', 'ming dynasty': 'china', 'british colonial empire': 'britain',
    'united kingdom of great britain and ireland': 'britain', 'british raj': 'britain',
    'french colonial empire': 'france', 'first french empire': 'france', 'second french empire': 'france',
    'french first republic': 'france', 'french second republic': 'france', 'french third republic': 'france',
    'kingdom of france': 'france', 'bourbon restoration': 'france', 'july monarchy': 'france',
    'kingdom of spain': 'spain', 'kingdom of portugal': 'portugal', 'dutch republic': 'netherlands',
    'kingdom of the netherlands': 'netherlands', 'batavian republic': 'netherlands',
    'united states of america': 'usa', 'tokugawa shogunate': 'japan', 'empire of japan': 'japan',
    'safavid empire': 'persia', 'afsharid dynasty': 'persia', 'zand dynasty': 'persia', 'qajar dynasty': 'persia',
    'tsardom of russia': 'russia', 'kingdom of prussia': 'germany', 'north german confederation': 'germany',
    'kingdom of italy': 'italy', 'kingdom of sweden': 'sweden', 'swedish empire': 'sweden',
    'kingdom of denmark': 'denmark', 'danish colonial empire': 'denmark',
}


def strip(name):
    return name[1:-1] if name.startswith('(') and name.endswith(')') else name


def key_of(name):
    k = power_key(name)
    return CLIO_KEYS.get(k, k)


def load():
    raw = fetch(CLIO, ext='.zip', timeout=900)
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        name = next(n for n in z.namelist() if n.endswith('.geojson'))
        return json.loads(z.read(name))


def build():
    src = load()
    shapes = []
    for f in src['features']:
        p = f['properties']
        if p.get('Type') != 'POLITY' or p['Name'].startswith('('):
            continue   # "(Spanish Empire)" rows are the union of their members; the members are drawn
        if p['ToYear'] < FIRST or p['FromYear'] > LAST or not f.get('geometry'):
            continue
        g = simplify_geom(f['geometry'], 0.03, 2)
        if not g:
            continue
        member = strip((p.get('MemberOf') or '').split(';')[0].strip())
        shapes.append({'n': p['Name'], 'from': p['FromYear'], 'to': p['ToYear'], 'm': member if member != p['Name'] else '',
                       'q': p.get('Wikidata') or '', 'w': p.get('Wikipedia') or '', 'g': g,
                       'a': round(p.get('Area') or sum(polygon_area_km2(q) for q in polys_of(g))), 'l': label_point(g),
                       'bb': [round(v, 1) for v in bbox_of(g)]})
    shapes.sort(key=lambda s: (s['from'], s['n']))
    for i, s in enumerate(shapes):
        s['id'] = i
    log(f'cliopatria: {len(shapes)} polity shapes touch {FIRST}-{LAST}')

    # peoples and regions without a state, from the nearest earlier world snapshot
    bindex = read_json(os.path.join(DATA, 'borders', 'index.json'))['snapshots']
    under_cache = {}

    def underlay(snap_year):
        if snap_year not in under_cache:
            doc = read_json(os.path.join(DATA, 'borders', f'{snap_year}.json'))
            geoms = defaultdict(list)
            for f in doc['features']:
                k = f['properties']['k']
                if k >= 0:
                    geoms[k] += polys_of(f['geometry'])
            out = []
            for k, pol in enumerate(doc['polities']):
                if pol.get('s') and pol['s'] != pol['n']:
                    continue   # colonies and dependencies: their ruler may have changed since the snapshot
                if not pol.get('l') or k not in geoms:
                    continue
                g = {'type': 'MultiPolygon', 'coordinates': geoms[k]}
                s = {'n': pol['n'], 'from': None, 'to': None, 'm': '', 'q': '', 'w': '', 'g': g, 'a': pol['a'],
                     'l': pol['l'], 'bb': pol['bb'], 'u': snap_year, 'id': len(shapes)}
                shapes.append(s)
                out.append(s)
            under_cache[snap_year] = out
        return under_cache[snap_year]

    years = {}
    for y in range(FIRST, LAST + 1):
        live = [s for s in shapes if s['from'] is not None and s['from'] <= y <= s['to']]
        # one shape per name: the row whose range starts latest
        byname = {}
        for s in live:
            if s['n'] not in byname or s['from'] > byname[s['n']]['from']:
                byname[s['n']] = s
        live = list(byname.values())
        idx = PolyIndex([(s['id'], s['g']) for s in live])
        names = {s['n'] for s in live}
        snap = max(b['y'] for b in bindex if b['y'] <= y)
        rows = []
        for s in underlay(snap):
            if s['n'] in names or idx.lookup(*s['l']) is not None:
                continue
            rows.append([s['id'], s['n'], power_key(s['n']), None, snap])
        for s in live:
            ruler = s['m'] or None
            rows.append([s['id'], s['n'], key_of(ruler or s['n']), ruler])
        years[y] = rows
        if y % 20 == 0:
            log(f'  {y}: {len(live)} Cliopatria polities, {len(rows) - len(live)} from the {snap} snapshot')
    used = {r[0] for rows in years.values() for r in rows}
    shapes = [s for s in shapes if s['id'] in used]
    remap = {s['id']: i for i, s in enumerate(shapes)}
    for s in shapes:
        s['id'] = remap[s['id']]
    for rows in years.values():
        for r in rows:
            r[0] = remap[r[0]]

    powers = read_json(os.path.join(DATA, 'powers.json'))
    for rows in years.values():
        for _, name, pk, ruler, *_ in rows:
            if pk not in powers:
                h = sum(ord(c) * (i + 1) for i, c in enumerate(pk))
                powers[pk] = {'name': ruler or name, 'color': PALETTE[h % len(PALETTE)], 'years': [FIRST, LAST]}
    write_json(os.path.join(DATA, 'powers.json'), powers)
    return shapes, years


def year_doc(y):
    """Polity table + geometries for one year (for event placement and the audit). Cliopatria rows come
    last in the year files, so they are listed first here: a point lookup prefers them to the underlay."""
    shapes, years = _cache()
    rows = years[y]
    rows = [r for r in rows if len(r) < 5] + [r for r in rows if len(r) >= 5]
    return [{'n': r[1], 'p': r[2], 's': r[3], 'a': shapes[r[0]]['a'], 'g': shapes[r[0]]['g']} for r in rows]


_C = {}


def _cache():
    if not _C:
        idx = read_json(os.path.join(DATA, 'clio', 'index.json'))
        shapes = {}
        for f in idx['files']:
            for sid, s in read_json(os.path.join(DATA, 'clio', f)).items():
                shapes[int(sid)] = s
        years = {y: read_json(os.path.join(DATA, 'clio', 'years', f'{y}.json'))['rows'] for y in range(idx['from'], idx['to'] + 1)}
        _C['v'] = (shapes, years)
    return _C['v']


def main():
    shapes, years = build()
    out = os.path.join(DATA, 'clio')
    os.makedirs(os.path.join(out, 'years'), exist_ok=True)
    for f in os.listdir(out):
        if f.endswith('.json') and f != 'index.json':
            os.remove(os.path.join(out, f))
    byid = {s['id']: s for s in shapes}
    # Files: one per snapshot for the underlay ("u1715.json"), one per BUCKET years for Cliopatria shapes
    # ("b1775.json": every shape used in 1775-1779). A year needs two files, and nearby years share them.
    def rec(s):
        d = {'g': s['g'], 'a': s['a'], 'l': s['l'], 'bb': s['bb']}
        if s['from'] is not None:
            d['s'], d['e'] = s['from'], s['to']
        return d
    total = 0
    files = {}
    need_of = {}
    for y, rows in years.items():
        b = FIRST + (y - FIRST) // BUCKET * BUCKET
        need = set()
        for r in rows:
            f = f'u{r[4]}.json' if len(r) >= 5 else f'b{b}.json'
            files.setdefault(f, {})[str(r[0])] = byid[r[0]]
            need.add(f)
        need_of[y] = sorted(need)
    for f, doc in files.items():
        total += write_json(os.path.join(out, f), {k: rec(s) for k, s in doc.items()})
    powers = read_json(os.path.join(DATA, 'powers.json'))
    prev = None
    for y, rows in years.items():
        parea, pcount, pname = defaultdict(float), Counter(), {}
        for sid, name, pk, ruler, *rest in rows:
            if rest:
                continue
            parea[pk] += byid[sid]['a']
            pcount[pk] += 1
            pname[pk] = ruler or pname.get(pk) or name
        largest = [{'p': k, 'name': pname.get(k) or powers.get(k, {}).get('name', k), 'a': round(a), 'n': pcount[k]}
                   for k, a in sorted(parea.items(), key=lambda x: -x[1])[:15]]
        names = {r[1]: byid[r[0]]['a'] for r in rows if len(r) < 5}
        changes = None
        if prev is not None:
            ap = sorted((n for n in names if n not in prev), key=lambda n: -names[n])
            gone = sorted((n for n in prev if n not in names), key=lambda n: -prev[n])
            changes = {'since': y - 1, 'appeared': ap[:12], 'gone': gone[:12], 'nAppeared': len(ap), 'nGone': len(gone), 'ruler': []}
        prev = names
        need = need_of[y]
        total += write_json(os.path.join(out, 'years', f'{y}.json'),
                            {'year': y, 'rows': rows, 'need': need, 'largest': largest, 'changes': changes})
    write_json(os.path.join(out, 'index.json'), {'from': FIRST, 'to': LAST, 'files': sorted(files), 'shapes': len(shapes)})
    # Wikidata ids and article titles as given by Cliopatria, for link_wikidata.py
    links = {}
    for s in shapes:
        if s.get('q') and s['from'] is not None:
            links.setdefault(s['n'], {'q': s['q'], 'w': s['w']})
    write_json(os.path.join(CACHE, 'clio_links.json'), links)
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
    with open(os.path.join(out, 'LICENSE.txt'), 'w') as f:
        f.write('Polity shapes in this folder are simplified from Cliopatria (Seshat Global History Databank),\n'
                'https://github.com/Seshat-Global-History-Databank/cliopatria, DOI 10.1038/s41597-025-04516-9,\n'
                'licensed CC BY 4.0. Rows marked with a snapshot year come from aourednik/historical-basemaps (GPL-3.0),\n'
                'see ../borders/LICENSE.txt.\n')
    log(f'clio: {len(shapes)} shapes in {len(files)} files, {LAST - FIRST + 1} years, {total // 1024} KB')


if __name__ == '__main__':
    main()
