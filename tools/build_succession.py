"""Before and after: what a state replaced and what replaced it (data/succession.json).

Two kinds of evidence, both one step only (no chains):
  w  Wikidata: "replaces"/"replaced by" (P1365/P1366) and "follows"/"followed by" (P155/P156) on the item
     linked to the territory. Only direct statements are used; a target that is a person is dropped.
  m  the yearly maps (Cliopatria 3400 BC-1885, CShapes 1886-2019): who held the land of a state on the map
     before the first year it is drawn, and who holds it on the map after its last year. A state that first
     appears on land another state still holds afterwards (a secession) is listed as an "after" of that
     state. Land is compared at a few sample points inside each shape; a holder counts from 15% of them.

Entries: [label, map year or None, flags, map name or None, enwiki title or None, Wikidata inception,
Wikidata dissolution]. The map year is the year of the hand-over on the maps ("m" entries). Flags: w, m,
s (the earlier state continued), u (a people or region from the sketch maps), r (the same land on the
other map source: Cliopatria ends in 1885 and CShapes begins in 1886, with other names).
"""
import os
import re
from collections import defaultdict, Counter

from common import DATA, CACHE, read_json, write_json, sparql, qid, log
from geo import PolyIndex
from link_wikidata import year_of
import yearly
import build_clio

GAP = 5          # a name that returns after at least this many years starts a new run
SHARE = 0.15
FIRST, LAST = -3400, 2019


def runs_of(years):
    out, s, p = [], None, None
    for y in years:
        if s is None:
            s = p = y
        elif y - p <= GAP:
            p = y
        else:
            out.append((s, p))
            s = p = y
    if s is not None:
        out.append((s, p))
    return out


_idx = {}


def index_at(y):
    key = yearly.map_key(y)
    if key not in _idx:
        if len(_idx) > 40:
            _idx.pop(next(iter(_idx)))
        pols = yearly.year_doc(y)
        _idx[key] = (PolyIndex([(i, p['g']) for i, p in enumerate(pols)]), pols)
    return _idx[key]


def holders(y_shape, name, y_other):
    """Who holds, on the map of y_other, the land `name` has on the map of y_shape: {name: (share, underlay)}."""
    _, pols = index_at(y_shape)
    p = next((q for q in pols if q['n'] == name and not q.get('u')), None)
    if p is None:
        return {}
    pts = build_clio.sample_points(p['g'], None)
    if not pts:
        return {}
    pi, opols = index_at(y_other)
    c = Counter()
    und = {}
    for x, yy in pts:
        k = pi.lookup(x, yy)
        if k is not None:
            c[opols[k]['n']] += 1
            und[opols[k]['n']] = bool(opols[k].get('u'))
    return {n: (v / len(pts), und[n]) for n, v in c.items() if n != name and v / len(pts) >= SHARE}


def from_maps():
    cidx = read_json(os.path.join(DATA, 'clio', 'index.json'))
    ys = cidx['years']
    years_of = defaultdict(list)
    for i, y in enumerate(ys):
        end = ys[i + 1] - 1 if i + 1 < len(ys) else cidx['to']
        for r in read_json(os.path.join(DATA, 'clio', 'years', f'{y}.json'))['rows']:
            if len(r) < 5:
                years_of[r[1]].extend(range(y, end + 1))
    csi = read_json(os.path.join(DATA, 'cshapes', 'index.json'))
    for y in range(csi['from'], csi['to'] + 1):
        for r in read_json(os.path.join(DATA, 'cshapes', 'years', f'{y}.json'))['rows']:
            years_of[r[1]].append(y)
    before, after = defaultdict(dict), defaultdict(dict)
    events = []
    for name, yl in years_of.items():
        yl = sorted(set(yl))
        on = set(yl)
        for a, b in runs_of(yl):
            events.append((a, 'start', name, on))
            events.append((b, 'end', name, on))
    events.sort(key=lambda e: e[0])   # by year, so the small index cache is reused
    n = 0
    for y, kind, name, on in events:
        if kind == 'start' and y - 1 >= FIRST:
            for h, (share, und) in holders(y, name, y - 1).items():
                fl = 'm' + ('u' if und else '') + ('r' if y == 1886 else '')
                before[name][h] = [h, y - 1, None, fl, h, None, share]
                if not und:
                    cont = y in set(years_of.get(h, ()))
                    after[h].setdefault(name, [name, y, None, 'm' + ('s' if cont else '') + ('r' if y == 1886 else ''), name, None, share])
        elif kind == 'end' and y + 1 <= LAST:
            for h, (share, und) in holders(y, name, y + 1).items():
                if und:
                    continue
                after[name][h] = [h, y + 1, None, 'm' + ('r' if y == 1885 else ''), h, None, share]
        n += 1
        if n % 1000 == 0:
            log(f'  maps: {n}/{len(events)} run starts and ends')
    return before, after, years_of


def from_wikidata(name_q):
    """{q: {'b': {...}, 'a': {...}}} with one-step statements only. Two passes: the pairs, then the targets."""
    qs = sorted(set(name_q.values()))
    pairs = []
    for i in range(0, len(qs), 150):
        vals = ' '.join('wd:' + q for q in qs[i:i + 150])
        query = f'''SELECT ?x ?dir ?p WHERE {{ VALUES ?x {{ {vals} }}
  {{ ?x wdt:P1365 ?p BIND("b" AS ?dir) }} UNION {{ ?x wdt:P155 ?p BIND("b" AS ?dir) }}
  UNION {{ ?p wdt:P1366 ?x BIND("b" AS ?dir) }} UNION {{ ?p wdt:P156 ?x BIND("b" AS ?dir) }}
  UNION {{ ?x wdt:P1366 ?p BIND("a" AS ?dir) }} UNION {{ ?x wdt:P156 ?p BIND("a" AS ?dir) }}
  UNION {{ ?p wdt:P1365 ?x BIND("a" AS ?dir) }} UNION {{ ?p wdt:P155 ?x BIND("a" AS ?dir) }} }}'''
        try:
            for r in sparql(query):
                x, p = qid(r['x']), qid(r['p'])
                if x != p and re.match(r'^Q\d+$', p or ''):
                    pairs.append((x, r['dir'], p))
        except Exception as ex:
            log(f'  succession batch failed: {ex}')
    targets = sorted({p for _, _, p in pairs})
    info = {}
    for i in range(0, len(targets), 150):
        vals = ' '.join('wd:' + q for q in targets[i:i + 150])
        query = f'''SELECT ?p ?l ?start ?end ?w ?human WHERE {{ VALUES ?p {{ {vals} }}
  ?p rdfs:label ?l FILTER(LANG(?l) = "en")
  OPTIONAL {{ ?p wdt:P571 ?start }} OPTIONAL {{ ?p wdt:P576 ?end }}
  OPTIONAL {{ ?a schema:about ?p; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?w }}
  OPTIONAL {{ ?p wdt:P31 wd:Q5 BIND(1 AS ?human) }} }}'''
        try:
            for r in sparql(query):
                if r.get('human'):
                    continue
                e = info.setdefault(qid(r['p']), {'q': qid(r['p']), 'n': r['l'], 'w': r.get('w')})
                a, b = year_of(r.get('start')), year_of(r.get('end'))
                if a is not None:
                    e['from'] = min(e.get('from', a), a)
                if b is not None:
                    e['to'] = max(e.get('to', b), b)
        except Exception as ex:
            log(f'  succession info batch failed: {ex}')
    out = defaultdict(lambda: {'b': {}, 'a': {}})
    for x, d, p in pairs:
        if p in info:
            out[x][d][p] = info[p]
    return out


def maps_cached():
    """from_maps() is slow (several minutes): keep its result in tools/cache/ for as long as the yearly maps
    list the same rows."""
    import hashlib
    import json
    hsh = hashlib.sha1()
    for src in ('clio', 'cshapes'):
        d = os.path.join(DATA, src, 'years')
        for f in sorted(os.listdir(d)):
            hsh.update(json.dumps(read_json(os.path.join(d, f))['rows']).encode())
    stamp = hsh.hexdigest()
    path = os.path.join(CACHE, 'succession_maps.json')
    if os.path.exists(path):
        c = read_json(path)
        if c.get('stamp') == stamp:
            return c['before'], c['after'], c['years']
    before, after, years_of = from_maps()
    write_json(path, {'stamp': stamp, 'before': before, 'after': after, 'years': years_of})
    return before, after, years_of


def main():
    before, after, years_of = maps_cached()
    ents = read_json(os.path.join(DATA, 'entities.json'))
    clio_links = read_json(os.path.join(CACHE, 'clio_links.json'))
    name_q = {}
    for n in years_of:
        q = (ents.get(n) or {}).get('q') or (clio_links.get(n) or {}).get('q')
        if q and re.match(r'^Q\d+$', q):
            name_q[n] = q
    q_names = defaultdict(list)
    for n, q in name_q.items():
        q_names[q].append(n)
    wd = from_wikidata(name_q)
    out = {}
    n_w = n_m = 0
    for name in sorted(years_of):
        rec = {}
        yl = years_of[name]
        first, last = min(yl), max(yl)
        for side, mp in (('b', before), ('a', after)):
            lst = {}
            for h, e in mp.get(name, {}).items():
                # [label, map year, flags, map name, enwiki title, Wikidata from, Wikidata to, share of the land]
                lst[h] = [e[0], e[1], e[3], e[4], None, None, None, e[6]]
            for p, e in (wd.get(name_q.get(name)) or {}).get(side, {}).items():
                # Wikidata dates must fit the direction: a predecessor may not begin after this state ended
                if side == 'b' and e.get('from') is not None and e['from'] > last + 5:
                    continue
                if side == 'a' and e.get('to') is not None and e['to'] < first - 5:
                    continue
                mnames = [m for m in q_names.get(p, []) if m != name]
                # the same item under one of its map names: the nearest in time
                mname = None
                if mnames:
                    ref = first if side == 'b' else last
                    mname = min(mnames, key=lambda m: min(abs(v - ref) for v in years_of[m]))
                key = mname or e['n']
                if key in lst:
                    lst[key][2] = 'w' + lst[key][2]
                    lst[key][4:7] = [e.get('w'), e.get('from'), e.get('to')]
                else:
                    lst[key] = [mname or e['n'], None, 'w', mname, e.get('w'), e.get('from'), e.get('to'), 0.0]
            if not lst:
                continue

            ref = first if side == 'b' else last

            def near(e):
                """How close the Wikidata dates are to the hand-over (a predecessor that ended when this began)."""
                v = e[6] if side == 'b' else e[5]
                return abs(v - ref) if v is not None else 9999

            def group(e):
                fl = e[2]
                if 'w' in fl and 'm' in fl:
                    return 0
                if 'm' in fl and 'u' not in fl and 's' not in fl:
                    return 1
                if fl == 'w' and e[3]:
                    return 2
                if 's' in fl:
                    return 3
                if 'u' in fl:
                    return 4
                return 5
            items = sorted(lst.values(), key=lambda e: (group(e), near(e) if 'w' in e[2] else -e[7]))
            # break-aways long before the end are redraws of the source more often than successions
            items = [e for e in items if not ('s' in e[2] and 'w' not in e[2] and e[1] is not None and e[1] < last - 60)]
            cap = {0: 16, 1: 8, 2: 5, 3: 6, 4: 3, 5: 3}
            kept, n_in = [], {}
            for e in items:
                g = group(e)
                n_in[g] = n_in.get(g, 0) + 1
                if n_in[g] <= cap[g]:
                    kept.append(e)
            items = kept[:20]
            if items:
                rec[side] = [e[:7] for e in items]
                n_w += sum('w' in e[2] for e in items)
                n_m += sum('m' in e[2] for e in items)
        if rec:
            out[name] = rec
    size = write_json(os.path.join(DATA, 'succession.json'), out)
    log(f'succession: {len(out)} of {len(years_of)} territories have a before or after; {n_w} links from Wikidata, '
        f'{n_m} from the maps; {size // 1024} KB')


if __name__ == '__main__':
    main()
