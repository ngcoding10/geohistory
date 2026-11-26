"""Step 2f: border maps for 3400 BC to 1885 from Cliopatria (Seshat Global History Databank, CC BY 4.0).

Cliopatria gives every polity one or more shapes, each valid for a range of years, with the empire it
belongs to. A map is stored only for a year in which the list of shapes differs from the year before
(data/clio/years/<year>.json, listed in data/clio/index.json); any other year uses the latest stored map
at or before it. Shapes are kept in files that cover a run of stored years (data/clio/b<year>.json).

Cliopatria only draws states. Peoples and regions without a state (most of North America, Australia,
parts of Africa and the Amazon), and states it does not have, would be blank, so self-ruled territories of
the nearest earlier world snapshot are drawn underneath wherever Cliopatria has no polity; those rows
point at the snapshot's own file and the app labels them as coming from the older sketch map.

Nothing is drawn by hand here: every outline is a source polygon, simplified.
"""
import io
import json
import os
import sys
import zipfile
from collections import defaultdict, Counter

from common import fetch, write_json, read_json, DATA, CACHE, TOOLS, log
from fetch_sources import CLIO
from names import display
from geo import simplify_geom, label_point, bbox_of, polygon_area_km2, polys_of, PolyIndex, encode_geom, decode_geom
from build_borders import power_key, PALETTE, CURATED

FIRST, LAST = -3400, 1885   # Cliopatria's first polity is dated 3400 BC; CShapes takes over in 1886
TARGET = 520_000            # aim for shape files of about this many bytes
TOL = 0.012                 # degrees (about 1.3 km): Douglas-Peucker tolerance; coordinates keep 0.001 degrees
# "Member of" values that are a label for a group of independent states, not a power ruling them
GROUPINGS = {'Spring and Autumn States', 'Brythonic Kingdoms', 'Warring States China', 'Mahajanapadas',
             'Anglo-Saxon England', 'Taifas of Iberia', 'Duchies of Poland', 'Five Dynasties and Ten Kingdoms',
             'Eighteen Kingdoms', 'Sixteen Kingdoms', 'Three Kingdoms', 'Phoenician Empire', 'Chenla',
             'Northern and Southern Dynasties', 'Ten Kingdoms', 'Five Dynasties'}
# Cliopatria spellings -> the colour keys used by the other maps (build_borders.ALIASES)
CLIO_KEYS = {
    'qing dynasty': 'china', 'ming dynasty': 'china', 'british colonial empire': 'britain',
    'united kingdom of great britain and ireland': 'britain', 'british raj': 'britain',
    'french colonial empire': 'france', 'first french empire': 'france', 'second french empire': 'france',
    'french first republic': 'france', 'french second republic': 'france', 'french third republic': 'france',
    'kingdom of france': 'france', 'bourbon restoration': 'france', 'july monarchy': 'france',
    'bourbon kingdom of france': 'france', 'french directory': 'france', 'french consulate': 'france',
    'french fourth republic': 'france', 'vichy france': 'france',
    'kingdom of spain': 'spain', 'kingdom of portugal': 'portugal', 'dutch republic': 'netherlands',
    'kingdom of the netherlands': 'netherlands', 'batavian republic': 'netherlands',
    'united states of america': 'usa', 'tokugawa shogunate': 'japan', 'empire of japan': 'japan',
    'safavid empire': 'persia', 'afsharid dynasty': 'persia', 'zand dynasty': 'persia', 'qajar dynasty': 'persia',
    'tsardom of russia': 'russia', 'kingdom of prussia': 'germany', 'north german confederation': 'germany',
    'kingdom of italy': 'italy', 'kingdom of sweden': 'sweden', 'swedish empire': 'sweden',
    'kingdom of denmark': 'denmark', 'danish colonial empire': 'denmark',
    'han dynasty': 'china', 'western han': 'china', 'eastern han': 'china', 'tang dynasty': 'china',
    'song dynasty': 'china', 'northern song': 'china', 'southern song': 'china', 'yuan dynasty': 'china',
    'qin dynasty': 'china', 'sui dynasty': 'china', 'jin dynasty': 'china', 'western jin': 'china',
    'kingdom of england': 'britain', 'english colonial empire': 'britain', 'kingdom of great britain': 'britain',
    'spanish empire': 'spain', 'crown of castile': 'spain', 'kingdom of castile': 'spain',
    'portuguese empire': 'portugal', 'grand duchy of moscow': 'russia', 'russian empire': 'russia',
    'achaemenid empire': 'persia', 'parthian empire': 'persia', 'sasanian empire': 'persia',
    'roman republic': 'rome', 'roman empire': 'rome', 'western roman empire': 'rome',
    'byzantine empire': 'byzantium', 'eastern roman empire': 'byzantium',
    'mongol empire': 'mongols', 'ottoman empire': 'ottoman', 'mughal empire': 'mughal',
    'habsburg monarchy': 'austria', 'archduchy of austria': 'austria',
}


CLIO_FIXES = read_json(os.path.join(TOOLS, 'curated', 'names.json')).get('clio_rows', [])
# years and names of single source shapes, corrected (curated/clio_dates.json)
CLIO_DATES = {(r['name'], r['row'][0], r['row'][1]): r for r in read_json(os.path.join(TOOLS, 'curated', 'clio_dates.json'))['rows']}


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


def sample_points(g, lab):
    """A few points inside a shape (its label point and points on three horizontal lines)."""
    pts = [tuple(lab)] if lab else []
    polys = sorted(polys_of(g), key=polygon_area_km2, reverse=True)[:2]
    for poly in polys:
        ys = [p[1] for p in poly[0]]
        y0, y1 = min(ys), max(ys)
        for fr in (0.25, 0.5, 0.75):
            y = y0 + (y1 - y0) * fr
            xs = []
            r = poly[0]
            for i in range(len(r) - 1):
                (xa, ya), (xb, yb) = r[i][:2], r[i + 1][:2]
                if (ya > y) != (yb > y):
                    xs.append(xa + (y - ya) * (xb - xa) / (yb - ya))
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                w = xs[i + 1] - xs[i]
                for t in (0.25, 0.5, 0.75):
                    pts.append((xs[i] + w * t, y))
    return pts[:24]


def build():
    src = load()
    shapes = []
    used_fixes = set()
    for f in src['features']:
        p = f['properties']
        if p.get('Type') != 'POLITY' or p['Name'].startswith('('):
            continue   # "(Spanish Empire)" rows are the union of their members; the members are drawn
        if p['ToYear'] < FIRST or p['FromYear'] > LAST or not f.get('geometry'):
            continue
        g = simplify_geom(f['geometry'], TOL, 3)
        if not g:
            continue
        # the first "member of" value that is a ruling power: not the polity's own aggregate row
        # ("Kingdom of Bohemia" in "(Kingdom of Bohemia)") and not a label for a group of independent states
        members = [strip(x.strip()) for x in (p.get('MemberOf') or '').split(';') if x.strip()]
        member = next((x for x in members if x != p['Name'] and x not in GROUPINGS), '')
        shown = display(p['Name'])
        for fx in CLIO_FIXES:   # rows the source files under the wrong name for some years (curated/names.json)
            if fx['name'] == p['Name'] and fx['from'] <= p['FromYear'] and p['ToYear'] <= fx['to']:
                shown, member = fx['as'], fx.get('member', member)
        base = {'g': g, 'a': round(p.get('Area') or sum(polygon_area_km2(q) for q in polys_of(g))), 'l': label_point(g),
                'bb': [round(v, 1) for v in bbox_of(g)]}
        fix = CLIO_DATES.get((p['Name'], p['FromYear'], p['ToYear']))
        if fix is None:
            segs = [{'from': p['FromYear'], 'to': p['ToYear']}]
        else:   # the shape is drawn only in the curated spans, each optionally under another name
            segs = fix['segments']
            used_fixes.add((p['Name'], p['FromYear'], p['ToYear']))
        for sg in segs:
            if sg['to'] < FIRST or sg['from'] > LAST:
                continue
            renamed = 'as' in sg
            shapes.append(dict(base, n=sg.get('as', shown), m=display(sg.get('member', member)),
                               q='' if renamed else p.get('Wikidata') or '', w='' if renamed else p.get('Wikipedia') or ''))
            shapes[-1]['from'], shapes[-1]['to'] = sg['from'], sg['to']
    for k in set(CLIO_DATES) - used_fixes:
        log('  curated/clio_dates.json: no source shape', k)
    # states the sources leave blank or merge into a larger shape, from OpenHistoricalMap (curated/ohm_patches.json)
    from ohm import ohm_shape
    for r in read_json(os.path.join(TOOLS, 'curated', 'ohm_patches.json'))['rows']:
        try:
            g, info = ohm_shape(r['ohm'])
        except Exception as ex:   # no network and nothing cached: the map stays as the sources draw it
            log(f"  ohm patch {r['name']} ({r['ohm']}) skipped: {ex}")
            continue
        shapes.append({'g': g, 'a': info['km2'], 'l': label_point(g), 'bb': [round(v, 1) for v in bbox_of(g)],
                       'n': r['name'], 'm': display(r['ruler']) if r.get('ruler') else '', 'q': '', 'w': r['source'].rsplit('/', 1)[-1].replace('_', ' '),
                       'from': r['from'], 'to': r['to'], 'o': 1 if r['mode'] == 'over' else -1, 'ohm': r['ohm']})
    shapes.sort(key=lambda s: (s['from'], s['n']))
    for i, s in enumerate(shapes):
        s['id'] = i
    log(f'cliopatria: {len(shapes)} polity shapes touch {FIRST}-{LAST}')

    # peoples and regions without a state, from the nearest earlier world snapshot. Their outlines are
    # not copied: a row points at the polity number in data/borders/<snapshot>.json.
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
                if not pol.get('l') or k not in geoms:
                    continue
                g = {'type': 'MultiPolygon', 'coordinates': geoms[k]}
                # colonies and dependencies are not drawn by default (their ruler may have changed since the
                # snapshot); a curated 'borrow' entry can still use one, with the ruler it documents
                out.append({'k': k, 'n': pol['n'], 'pts': sample_points(g, pol['l']), 'a': pol['a'],
                            'ruled': bool(pol.get('s') and pol['s'] != pol['n'])})
            under_cache[snap_year] = out
        return under_cache[snap_year]

    # curated corrections to the sketch-map territories: years in which a name may be drawn, and renames
    ucfg = read_json(os.path.join(TOOLS, 'curated', 'underlay.json'))
    spans = {r['name']: r for r in ucfg['spans']}
    renames = {}
    for r in ucfg['rename']:
        renames.setdefault(r['name'], []).append(r)

    def under_row(u, y, snap):
        """The row for a sketch-map territory in year y, or None when it does not belong on that year's map."""
        sp = spans.get(u['n'])
        if sp and (y < sp.get('from', -99999) or y > sp.get('to', 99999)):
            return None
        for r in renames.get(u['n'], []):
            if r.get('from', -99999) <= y <= r.get('to', 99999):
                return [u['k'], r['as'], r.get('key') or power_key(r['as']), r.get('ruler'), snap]
        return [u['k'], u['n'], power_key(u['n']), None, snap]

    # 'borrow': a people or region that the nearest earlier sketch map lacks is taken from another sketch map
    # for a documented range of years (the outline is that map's; nothing is drawn by hand)
    borrow = ucfg.get('borrow', [])
    # spans read from Wikidata by build_underlay_spans.py (inception and dissolution of the linked item)
    auto_path = os.path.join(TOOLS, 'curated', 'underlay_auto.json')
    if os.path.exists(auto_path) and '--no-auto' not in sys.argv:
        for r in read_json(auto_path)['spans']:
            spans.setdefault(r['name'], r)

    def uncovered(row, u, idx, limit=0.4):
        """Drop a sketch-map territory when Cliopatria states cover over 40% of it (measured at sample points;
        80% for the curated 'borrow' rows, whose years are documented: what a state covers is hidden under it).
        When they cover its label point but less than that, the row carries another point for the label:
        the uncovered sample point nearest the middle of the uncovered ones."""
        hit = [idx.lookup(x, yy) is not None for x, yy in u['pts']]
        if not hit:
            return row
        if sum(hit) > limit * len(hit):
            return None
        if hit[0]:
            free = [p for p, hh in zip(u['pts'], hit) if not hh]
            if not free:
                return None
            mx, my = sum(p[0] for p in free) / len(free), sum(p[1] for p in free) / len(free)
            best = min(free, key=lambda p: (p[0] - mx) ** 2 + (p[1] - my) ** 2)
            return row + [[round(best[0], 2), round(best[1], 2)]]
        return row

    # a year gets its own map only when the list of shapes differs from the year before
    cand = {FIRST}
    for s in shapes:
        cand.add(max(s['from'], FIRST))
        cand.add(s['to'] + 1)
    cand |= {b['y'] for b in bindex}
    for r in list(spans.values()) + ucfg['rename'] + borrow:
        if 'from' in r:
            cand.add(r['from'])
        if 'to' in r:
            cand.add(r['to'] + 1)
    cand = sorted(y for y in cand if FIRST <= y <= LAST)
    years = {}
    prev_rows = None
    for y in cand:
        live = [s for s in shapes if s['from'] <= y <= s['to']]
        # one shape per name: the row whose range starts latest
        byname = {}
        for s in live:
            o = byname.get(s['n'])
            if o is None or (s['from'], s['a']) > (o['from'], o['a']):   # the latest start; of two, the larger
                byname[s['n']] = s
        live = list(byname.values())
        # a patch is not needed where the source itself draws that power at the patch's label point (a gap
        # patch: any state there)
        normal = [s for s in live if 'o' not in s]
        nidx = PolyIndex([(i, s['g']) for i, s in enumerate(normal)])

        def needed(pt):
            hits = [normal[i] for i in nidx.lookup_all(*pt.get('l'))] if pt.get('l') else []
            if pt['o'] < 0:
                return not hits
            # a part drawn over a larger shape: not needed where the source draws that state itself
            return not any(key_of(h['n']) == key_of(pt['n']) for h in hits)
        # gap patches first (drawn under the states), parts that go over a larger shape last
        live = sorted((s for s in live if 'o' not in s or needed(s)), key=lambda s: s.get('o', 0))
        idx = PolyIndex([(s['id'], s['g']) for s in live])
        names = {power_key(s['n']) for s in live}
        snap = max(b['y'] for b in bindex if b['y'] <= y)
        rows = []
        for u in underlay(snap):
            if u['ruled']:
                continue
            row = under_row(u, y, snap)
            if row is None or power_key(row[1]) in names:
                continue
            row = uncovered(row, u, idx)
            if row is not None:
                rows.append(row)
        have = {power_key(r[1]) for r in rows} | names
        for b in borrow:
            if not (b['from'] <= y <= b['to']):
                continue
            u = next((u for u in underlay(b['snap']) if u['n'] == b['name']), None)
            nm = b.get('as', b['name'])
            if u is None or power_key(nm) in have:
                continue
            if u['ruled'] and not b.get('ruler'):
                continue
            row = uncovered([u['k'], nm, b.get('key') or power_key(nm), b.get('ruler'), b['snap']], u, idx, 0.8)
            if row is not None:
                rows.append(row)
                have.add(power_key(nm))
        for s in live:
            ruler = s['m'] or None
            rows.append([s['id'], s['n'], key_of(ruler or s['n']), ruler])
        if rows != prev_rows:
            years[y] = rows
            prev_rows = rows
    log(f'{len(years)} stored years out of {len(cand)} candidate change years')
    used = {r[0] for rows in years.values() for r in rows if len(r) < 5}
    shapes = [s for s in shapes if s['id'] in used]
    remap = {s['id']: i for i, s in enumerate(shapes)}
    for s in shapes:
        s['id'] = remap[s['id']]
    years = {y: [r if len(r) >= 5 else [remap[r[0]]] + r[1:] for r in rows] for y, rows in years.items()}

    powers = read_json(os.path.join(DATA, 'powers.json'))
    # Colours for powers that only Cliopatria has. Neighbours should not share a colour, so the powers are
    # coloured greedily, largest first: each takes the palette colour that its neighbours use least.
    # Two shapes are neighbours when they exist in the same years and have outline points in the same or
    # an adjacent cell of a 0.5 degree grid.
    pk_of = {}
    for rows in years.values():
        for r in rows:
            if len(r) < 5:
                pk_of[r[0]] = r[2]
    grid = defaultdict(set)
    for s in shapes:
        cells = set()
        for poly in polys_of(s['g']):
            for x, yy in poly[0]:
                cells.add((int(x * 2 // 1), int(yy * 2 // 1)))
        s['_cells'] = cells
        for c in cells:
            grid[c].add(s['id'])
    byid = {s['id']: s for s in shapes}
    nbrs = defaultdict(lambda: defaultdict(float))
    tot = defaultdict(float)
    for s in shapes:
        a = pk_of[s['id']]
        tot[a] += s['a'] * (s['to'] - s['from'] + 1)
        near = set()
        for cx, cy in s['_cells']:
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    near |= grid.get((cx + dx, cy + dy), set())
        for j in near:
            o = byid[j]
            b = pk_of[j]
            if b == a:
                continue
            both = min(s['to'], o['to']) - max(s['from'], o['from']) + 1
            if both > 0:
                nbrs[a][b] += both * (1 + min(s['a'], o['a']) / 1e5)
    for s in shapes:
        del s['_cells']
    colour = {k: PALETTE.index(v['color']) for k, v in powers.items() if v['color'] in PALETTE}
    for pk in sorted(tot, key=lambda k: (-tot[k], k)):
        if pk in colour:
            continue
        cost = [0.0] * len(PALETTE)
        for nb, w in nbrs[pk].items():
            if nb in colour:
                cost[colour[nb]] += w
        h = sum(ord(c) * (i + 1) for i, c in enumerate(pk))
        colour[pk] = min(range(len(PALETTE)), key=lambda i: (cost[i], (i - h) % len(PALETTE)))
    span = {}
    for y, rows in years.items():
        for _, name, pk, ruler, *_ in rows:
            if pk not in powers:
                h = sum(ord(c) * (i + 1) for i, c in enumerate(pk))
                powers[pk] = {'name': ruler or name, 'color': CURATED.get(pk) or PALETTE[colour.get(pk, h % len(PALETTE))], 'years': [y, y]}
                span[pk] = powers[pk]
            elif pk in span:
                span[pk]['years'][1] = y
    write_json(os.path.join(DATA, 'powers.json'), powers)
    return shapes, years


def stored_year(y, ys):
    """The stored map that is valid in year y (the latest one at or before it)."""
    import bisect
    i = bisect.bisect_right(ys, y) - 1
    return ys[max(i, 0)]


_U = {}


def under_geom(snap, k):
    if snap not in _U:
        doc = read_json(os.path.join(DATA, 'borders', f'{snap}.json'))
        geoms = defaultdict(list)
        for f in doc['features']:
            geoms[f['properties']['k']] += polys_of(f['geometry'])
        _U[snap] = (geoms, doc['polities'])
    geoms, pols = _U[snap]
    return {'type': 'MultiPolygon', 'coordinates': geoms[k]}, pols[k]['a']


def year_doc(y):
    """Polity table + geometries for one year (for event placement and the audit). Cliopatria rows are
    listed first: a point lookup prefers them to the underlay."""
    shapes, years, ys = _cache()
    rows = years[stored_year(y, ys)]
    out = [{'n': r[1], 'p': r[2], 's': r[3], 'a': shapes[r[0]]['a'], 'g': shapes[r[0]]['g'], 'o': shapes[r[0]].get('o', 0)} for r in rows if len(r) < 5]
    # a point lookup takes the first hit: parts drawn over a larger shape first, gap patches after the states
    out.sort(key=lambda p: -p['o'] if p['o'] > 0 else p['o'] < 0)
    for r in rows:
        if len(r) >= 5:
            g, a = under_geom(r[4], r[0])
            out.append({'n': r[1], 'p': r[2], 's': r[3], 'a': a, 'g': g, 'u': r[4]})
    return out


_C = {}


def _cache():
    if not _C:
        idx = read_json(os.path.join(DATA, 'clio', 'index.json'))
        shapes = {}
        for f in idx['files']:
            for sid, s in read_json(os.path.join(DATA, 'clio', f)).items():
                s['g'] = decode_geom(s['g'])
                shapes[int(sid)] = s
        years = {y: read_json(os.path.join(DATA, 'clio', 'years', f'{y}.json'))['rows'] for y in idx['years']}
        _C['v'] = (shapes, years, idx['years'])
    return _C['v']


def main():
    shapes, years = build()
    out = os.path.join(DATA, 'clio')
    os.makedirs(os.path.join(out, 'years'), exist_ok=True)
    for d in (out, os.path.join(out, 'years')):
        for f in os.listdir(d):
            if f.endswith('.json'):
                os.remove(os.path.join(d, f))
    byid = {s['id']: s for s in shapes}

    def rec(s):
        r = {'g': encode_geom(s['g']), 'a': s['a'], 'l': s['l'], 'bb': s['bb'], 's': s['from'], 'e': s['to']}
        if 'o' in s:   # an OpenHistoricalMap patch: drawn over (1) or under (-1) the source's states
            r['o'], r['ohm'] = s['o'], s['ohm']
        return r
    size = {s['id']: len(json.dumps(rec(s), ensure_ascii=False, separators=(',', ':'))) + 8 for s in shapes}
    # Shape files: consecutive stored years share one file ("b1450.json": every shape used from 1450 until
    # the next file starts), grown until the file would pass TARGET bytes. A shape that lives across
    # several files is repeated in each, so that any year needs exactly one file.
    ys = sorted(years)
    total = 0
    files = {}
    need_of = {}
    cur, cur_ids, cur_size = None, set(), 0
    for y in ys:
        ids = {r[0] for r in years[y] if len(r) < 5}
        add = sum(size[i] for i in ids - cur_ids)
        if cur is None or (cur_size + add > TARGET and cur_ids):
            cur, cur_ids, cur_size = f'b{y}.json', set(), 0
            add = sum(size[i] for i in ids)
            files[cur] = cur_ids
        cur_ids |= ids
        cur_size += add
        need_of[y] = [cur]
    for f, ids in files.items():
        total += write_json(os.path.join(out, f), {str(i): rec(byid[i]) for i in sorted(ids)})
    # The sketch-map outlines a year uses are read from extracts, not from the whole snapshot: a region borrowed
    # from another snapshot (Travancore from the map of 1815, drawn in 1776) from clio/u<snapshot>.json (named in
    # the year file's 'ux'), and the year's own snapshot's regions from clio/o<snapshot>.json ('ox': every
    # outline of that snapshot that some year uses, about half of it; round 7, to make the first map lighter).
    snaps_all = sorted(b['y'] for b in read_json(os.path.join(DATA, 'borders', 'index.json'))['snapshots'])
    ux_of, ux_ks = {}, defaultdict(set)
    ox_of, ox_ks = {}, defaultdict(set)
    for y in ys:
        own = max(sy for sy in snaps_all if sy <= y)
        for r in years[y]:
            if len(r) >= 5 and r[4] != own:
                ux_of.setdefault(y, set()).add(r[4])
                ux_ks[r[4]].add(r[0])
            elif len(r) >= 5:
                ox_of.setdefault(y, set()).add(r[4])
                ox_ks[r[4]].add(r[0])
    for pre, kss in (('u', ux_ks), ('o', ox_ks)):
        for sy, ks in kss.items():
            doc = read_json(os.path.join(DATA, 'borders', f'{sy}.json'))
            total += write_json(os.path.join(out, f'{pre}{sy}.json'), {
                'year': doc.get('year', sy), 'polities': {str(k): doc['polities'][k] for k in sorted(ks)},
                'features': [f for f in doc['features'] if f['properties']['k'] in ks]})
    powers = read_json(os.path.join(DATA, 'powers.json'))
    prev, prev_y = None, None
    for y in ys:
        rows = years[y]
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
            changes = {'since': prev_y, 'appeared': ap[:12], 'gone': gone[:12], 'nAppeared': len(ap), 'nGone': len(gone), 'ruler': []}
        prev, prev_y = names, y
        ydoc = {'year': y, 'rows': rows, 'need': need_of[y], 'largest': largest, 'changes': changes}
        if y in ux_of:
            ydoc['ux'] = sorted(ux_of[y])
        if y in ox_of:
            ydoc['ox'] = sorted(ox_of[y])
        total += write_json(os.path.join(out, 'years', f'{y}.json'), ydoc)
    write_json(os.path.join(out, 'index.json'), {'from': FIRST, 'to': LAST, 'years': ys, 'files': sorted(files), 'shapes': len(shapes)})
    # Wikidata ids and article titles as given by Cliopatria, for link_wikidata.py
    links = {}
    for s in shapes:
        if s.get('q'):
            links.setdefault(s['n'], {'q': s['q'], 'w': s['w']})
    write_json(os.path.join(CACHE, 'clio_links.json'), links)
    names_path = os.path.join(CACHE, 'names.json')
    names = read_json(names_path)
    ys_all = sorted(years)
    seen = defaultdict(set)
    for i, y in enumerate(ys_all):
        end = ys_all[i + 1] - 1 if i + 1 < len(ys_all) else LAST
        for r in years[y]:
            seen[r[1]].update(range(y, end + 1))   # every year the stored map stands for
    # this script can run twice in one build (before and after the sketch-map spans are read from Wikidata):
    # the years it added last time are taken out first, so that the index never lists a year that is not drawn
    mine_path = os.path.join(CACHE, 'names_clio.json')
    if os.path.exists(mine_path):
        for n, ys_old in read_json(mine_path).items():
            if n in names:
                left = sorted(set(names[n]) - set(ys_old))
                if left:
                    names[n] = left
                else:
                    del names[n]
    for n, v in seen.items():
        names[n] = sorted(set(names.get(n, [])) | v)
    write_json(names_path, names)
    write_json(mine_path, {n: sorted(v) for n, v in seen.items()})
    with open(os.path.join(out, 'LICENSE.txt'), 'w') as f:
        f.write('Polity shapes in this folder are simplified from Cliopatria (Seshat Global History Databank),\n'
                'https://github.com/Seshat-Global-History-Databank/cliopatria, DOI 10.1038/s41597-025-04516-9,\n'
                'licensed CC BY 4.0. Rows marked with a snapshot year come from aourednik/historical-basemaps (GPL-3.0),\n'
                'see ../borders/LICENSE.txt.\n')
    # the year each correction rests on, compared with the Wikidata item of the article it cites
    try:
        from verify import wikidata_years
        import re as _re
        import urllib.parse as _up
        dpath = os.path.join(TOOLS, 'curated', 'clio_dates.json')
        cur = read_json(dpath)
        title = lambda r: _re.sub('_', ' ', _up.unquote(r['source'].rsplit('/wiki/', 1)[-1]))
        wd = wikidata_years([title(r) for r in cur['rows']])
        for r in cur['rows']:
            r['verified'] = any(abs(y - r['check']) <= 1 for y in wd.get(title(r), {}).get('years', ()))
        write_json(dpath, cur, pretty=True)
        log(f"  clio_dates: {len(cur['rows'])} corrected shapes, {sum(r['verified'] for r in cur['rows'])} with the year confirmed by Wikidata")
    except Exception as ex:
        log('  Wikidata not reachable, curated/clio_dates.json keeps its verified flags:', ex)
    log(f'clio: {len(shapes)} shapes in {len(files)} files, {len(ys)} stored years for {FIRST} to {LAST}, {total // 1024} KB')


if __name__ == '__main__':
    main()
