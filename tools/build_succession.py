"""Before and after: what a state replaced and what replaced it (data/succession.json).

Two kinds of evidence, both one step only (no chains):
  m  the yearly maps (Cliopatria 3400 BC-1885, CShapes 1886-2019): who held the land of a state (its own
     shape and the shapes of its parts) on the map before it is first drawn, and who holds it after it is
     last drawn (also around a return after REAL_GAP years or more). Land is compared on a grid of points,
     each weighted by the area it stands for. A holder that only the maps name is listed from 10% of the
     land, and only when it hands over within WINDOW years of the state's beginning (end) on the maps or on
     Wikidata: a state annexed a century later is not a predecessor. A state that first appears on land
     another state keeps (a break-away) is listed under that state's "after" when nearly all (80%) of its own
     land came from it, it lasted at least 5 years, and it took 10% of the earlier state's land, or 1% in
     the earlier state's last third (at most its last 100 years). Remnants smaller than 0.5% of a state's
     extent, risings the source draws as territories, parts listed beside their own state, and colonies the
     second source draws apart from 1886 are left out.
  w  Wikidata: "replaces"/"replaced by" (P1365/P1366) and "follows"/"followed by" (P155/P156) on the item
     linked to the territory; a target that is a person is dropped. A statement is shown only when the maps
     agree: the map comparison names the same state, or the hand-over shows from the other state's side,
     or (for a state not on this land at the hand-over, or on no map) the statement is on this state's own
     item and the two states' Wikidata dates meet within MEET years. Periods, cultures, cabinets, provinces
     and the like are left out.

Entries: [label, map year or None, flags, map name or None, enwiki title or None, Wikidata inception,
Wikidata dissolution]. The map year is the year of the hand-over on the maps ("m" entries). Flags: w, m,
s (broke away; the earlier state continued), u (a people or region from the sketch maps), r (the same land
on the other map source: Cliopatria ends in 1885 and CShapes begins in 1886, with other names).
"""
import os
import re
from collections import defaultdict, Counter

from common import DATA, CACHE, read_json, write_json, sparql, qid, log
from geo import PolyIndex, bbox_of, polys_of, point_in_polys
from link_wikidata import year_of
import yearly
import build_clio

GAP = 5          # a name that returns after at least this many years starts a new run
LOW = 0.08       # the smallest share of the land that is recorded at all (enough to confirm a Wikidata statement)
MAP_ONLY = 0.1   # a holder that only the maps name is listed from this share of the land
BREAK_W = 0.01   # a break-away is listed when it took at least this share of the earlier state's land ...
BREAK_S = 0.8    # ... and nearly all of its own land came from that state (else it is a conquest, not a break-away)
TINY = 0.005     # a beginning or end below this share of the state's largest extent is a remnant's, not the state's
MEET = 10        # Wikidata dates of a state not on this land at the hand-over must meet within this many years
REAL_GAP = 20    # a state away from the maps this long and back again has a new beginning
WINDOW = 25      # a predecessor (successor) hands over within this many years of the state's first (last) year
MAXPOLY = 10     # shapes sampled per state (the largest: its own shape and those of its parts)
FIRST, LAST = -3400, 2019
DEBUG = set(filter(None, os.environ.get('SUCC_DEBUG', '').split('|')))   # names whose raw lists are logged
RISING = re.compile(r'\b(rebellion|uprising|revolt)\b', re.I)   # map rows that are a rising, not a state
# Wikidata targets that are not states: periods, cultures, governments, groups of states
NOT_A_STATE = re.compile(r'\b(period|culture|era|age|ages|cabinet|government of|occupation of|states|committee|krai|sanjak|rebellion|voivodeship|governorate|guberniya|oblast)\b', re.I)


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


def grid_points(g, n=14):
    """Points of an n by n grid over the shape's box that fall inside it (an even spread, unlike the label
    point and three lines of build_clio.sample_points)."""
    bb = bbox_of(g)
    if not bb:
        return []
    polys = polys_of(g)
    w, s, e, nn = bb
    return [(x, y) for i in range(n) for j in range(n)
            for x, y in [(w + (e - w) * (i + 0.5) / n, s + (nn - s) * (j + 0.5) / n)] if point_in_polys(x, y, polys)]


def land(y, name):
    """Sample points inside everything `name` holds on the map of y (its own shape and the shapes drawn as its
    parts), the area of all of it, and the state it is itself a part of."""
    _, pols = index_at(y)
    mine = sorted((q for q in pols if not q.get('u') and (q['n'] == name or q.get('s') == name)), key=lambda q: -q['a'])
    pts = []
    for q in mine[:MAXPOLY]:
        qp = grid_points(q['g']) or build_clio.sample_points(q['g'], None)
        # each point stands for an equal part of its shape's area, so a small colony does not weigh as much
        # as the homeland
        pts += [(x, yy, q['a'] / len(qp)) for x, yy in qp]
    over = next((q.get('s') for q in mine if q['n'] == name and q.get('s')), None)
    return pts, sum(q['a'] for q in mine), over


def holders(y_shape, name, y_other):
    """Who holds, on the map of y_other, the land `name` has on the map of y_shape: {holder: (share, underlay)}.
    A point counts for the state drawn there and for the state that one is a part of; points that `name`
    still holds, and the state `name` was itself a part of, are left out. A state that has a shape of its own
    on that map counts for its parts' land only where its own shape is on this land too (Napoleon's
    Confederation of the Rhine is drawn as French, but the First French Empire did not take over the Holy
    Roman Empire); a state drawn only through its parts (the Holy Roman Empire) counts for all of them."""
    pts, area, over = land(y_shape, name)
    if not pts:
        return {}, 0.0, {}, over
    pi, opols = index_at(y_other)
    c = Counter()
    via = Counter()                  # credited only as the state a holder is part of
    own = {q['n'] for q in opols}    # states with a shape of their own on that map
    und = {}
    parent = {}
    total = sum(w for _, _, w in pts) or 1.0
    for x, yy, wt in pts:
        k = pi.lookup(x, yy)
        if k is None:
            continue
        q = opols[k]
        if q['n'] == name or q.get('s') == name:
            continue
        for h in {q['n'], q.get('s') or q['n']} - {over}:
            c[h] += wt
            if h != q['n']:
                via[h] += wt
            elif q.get('s'):
                parent[h] = q['s']
            und[h] = bool(q.get('u'))
    for h in list(c):
        if h in own and c[h] - via[h] <= 0:
            del c[h]
    return {n: (v / total, und[n]) for n, v in c.items() if v / total >= LOW}, area, parent, over


def from_maps():
    cidx = read_json(os.path.join(DATA, 'clio', 'index.json'))
    ys = cidx['years']
    years_of = defaultdict(list)      # the years a name is drawn
    ruler_years = defaultdict(set)    # the years it is drawn only through its parts
    for i, y in enumerate(ys):
        end = ys[i + 1] - 1 if i + 1 < len(ys) else cidx['to']
        for r in read_json(os.path.join(DATA, 'clio', 'years', f'{y}.json'))['rows']:
            if len(r) < 5:
                years_of[r[1]].extend(range(y, end + 1))
                if r[3]:
                    ruler_years[r[3]].update(range(y, end + 1))
    csi = read_json(os.path.join(DATA, 'cshapes', 'index.json'))
    for y in range(csi['from'], csi['to'] + 1):
        for r in read_json(os.path.join(DATA, 'cshapes', 'years', f'{y}.json'))['rows']:
            years_of[r[1]].append(y)
            if r[3]:
                ruler_years[r[3]].add(y)
    before, after = defaultdict(dict), defaultdict(dict)
    events = []
    present = {}
    for name, yl in years_of.items():
        on = set(yl) | ruler_years.get(name, set())
        present[name] = on
        rr = runs_of(sorted(on))
        for k, (a, b) in enumerate(rr):
            # x: not the first appearance (or not the last disappearance) of the name on the maps
            events.append((a, 'start', name, '' if k == 0 else 'x'))
            events.append((b, 'end', name, '' if k == len(rr) - 1 else 'x'))
    events.sort(key=lambda e: e[0])   # by year, so the small index cache is reused

    def area_of(y, name):
        _, pols = index_at(y)
        return sum(q['a'] for q in pols if not q.get('u') and (q['n'] == name or q.get('s') == name))
    n = 0
    written = []                      # (name, area at the event, [(dict, key, key, entry)])
    for y, kind, name, x in events:
        made = []
        if kind == 'start' and y - 1 >= FIRST:
            hs, area, parent, over = holders(y, name, y - 1)
            for h, (share, und) in hs.items():
                fl = 'm' + ('u' if und else '') + ('r' if y == 1886 else '') + x
                # a part (a county of France) is not listed beside the state it is part of
                if parent.get(h) not in hs:
                    before[name][h] = [h, y - 1, None, fl, h, None, share]
                    made.append((before, name, h, before[name][h]))
                if not und and not (over and over != h):   # a new part of another state: listed as that state
                    # the same hand-over seen from the earlier state: v, with the share of ITS land that went
                    cont = y in present.get(h, ())
                    ha = area_of(y - 1, h)
                    w = min(1.0, share * area / ha) if ha else 0.0
                    after[h].setdefault(name, [name, y, None, 'mv' + ('s' if cont else '') + ('r' if y == 1886 else '') + x, name, None, w, share])
                    made.append((after, h, name, after[h][name]))
        elif kind == 'end' and y + 1 <= LAST:
            hs, area, parent, _ = holders(y, name, y + 1)
            for h, (share, und) in hs.items():
                if und or parent.get(h) in hs:
                    continue
                after[name][h] = [h, y + 1, None, 'm' + ('r' if y == 1885 else '') + x, h, None, share]
                made.append((after, name, h, after[name][h]))
        else:
            area = 0.0
        written.append((name, area, made))
        n += 1
        if n % 1000 == 0:
            log(f'  maps: {n}/{len(events)} run starts and ends')
    # a beginning or end of a tiny remnant (the source keeps a 96 km2 "Byzantine Empire" until 1226) is not
    # the state's hand-over: left out below TINY of the largest extent the state has at its beginnings and ends
    top = Counter()
    for name, area, _ in written:
        top[name] = max(top[name], area)
    for name, area, made in written:
        if area < TINY * top[name]:
            for dct, k1, k2, ent in made:
                if dct[k1].get(k2) is ent:
                    del dct[k1][k2]
    # the years a state is on the maps, as its own shape or through its parts (the Holy Roman Empire has a
    # shape of its own only until 1621)
    return before, after, {n: sorted(v) for n, v in present.items()}


def from_wikidata(name_q):
    """{q: {'b': {...}, 'a': {...}}} with one-step statements only. Two passes: the pairs, then the targets."""
    qs = sorted(set(name_q.values()))
    pairs = []
    for i in range(0, len(qs), 150):
        vals = ' '.join('wd:' + q for q in qs[i:i + 150])
        # own: the statement is on this state's item (not only the inverse, on the other state's item)
        query = f'''SELECT ?x ?dir ?p ?own WHERE {{ VALUES ?x {{ {vals} }}
  {{ ?x wdt:P1365 ?p BIND("b" AS ?dir) BIND(1 AS ?own) }} UNION {{ ?x wdt:P155 ?p BIND("b" AS ?dir) BIND(1 AS ?own) }}
  UNION {{ ?p wdt:P1366 ?x BIND("b" AS ?dir) }} UNION {{ ?p wdt:P156 ?x BIND("b" AS ?dir) }}
  UNION {{ ?x wdt:P1366 ?p BIND("a" AS ?dir) BIND(1 AS ?own) }} UNION {{ ?x wdt:P156 ?p BIND("a" AS ?dir) BIND(1 AS ?own) }}
  UNION {{ ?p wdt:P1365 ?x BIND("a" AS ?dir) }} UNION {{ ?p wdt:P155 ?x BIND("a" AS ?dir) }} }}'''
        try:
            for r in sparql(query):
                x, p = qid(r['x']), qid(r['p'])
                if x != p and re.match(r'^Q\d+$', p or ''):
                    pairs.append((x, r['dir'], p, bool(r.get('own'))))
        except Exception as ex:
            log(f'  succession batch failed: {ex}')
    targets = sorted({p for _, _, p, _ in pairs})
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
    for x, d, p, own in pairs:
        if p in info:
            e = out[x][d].setdefault(p, dict(info[p]))
            e['own'] = e.get('own', False) or own
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
    stamp = 'v10:' + hsh.hexdigest()
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
    def wd_year(n, key):
        v = (ents.get(n) or {}).get(key)
        return v if isinstance(v, int) else None
    dropped = Counter()
    for name in sorted(years_of):
        rec = {}
        yl = years_of[name]
        first, last = min(yl), max(yl)
        # the beginnings and ends of the state's runs on the maps: a name that is away for REAL_GAP years or more
        # and comes back (Eritrea in 1993) begins again; shorter gaps are the source's redrawing
        starts, stops = [yl[0]], []
        for a_, b_ in zip(yl, yl[1:]):
            if b_ - a_ >= REAL_GAP:
                stops.append(a_)
                starts.append(b_)
        stops.append(yl[-1])
        for side, mp, other in (('b', before, after), ('a', after, before)):
            lst = {}
            for h, e in mp.get(name, {}).items():
                # [label, map year, flags, map name, enwiki title, Wikidata from, Wikidata to, share of the land, share of the new state's land]
                lst[h] = [e[0], e[1], e[3], e[4], None, None, None, e[6], e[7] if len(e) > 7 else None]
            for p, e in (wd.get(name_q.get(name)) or {}).get(side, {}).items():
                # Wikidata dates must fit the direction: a predecessor may not begin after this state ended
                if side == 'b' and e.get('from') is not None and e['from'] > last + 5:
                    continue
                if side == 'a' and e.get('to') is not None and e['to'] < first - 5:
                    continue
                mnames = [m for m in q_names.get(p, []) if m != name]
                # a Wikidata statement is shown only when the maps agree:
                #  1. the map comparison names the same state on this side; or
                #  2. the hand-over shows from the other state's side (a predecessor whose land this state held
                #     the year after it ended; a successor that first appeared on this state's land); or
                #  3. the other state is on no map, and its Wikidata dates meet this state's start or end.
                hit = [m for m in mnames if m in lst]
                cross = [m for m in mnames if name in other.get(m, {})]
                if hit:
                    key = hit[0]
                    lst[key][2] = 'w' + lst[key][2]
                    lst[key][4:7] = [e.get('w'), e.get('from'), e.get('to')]
                elif cross:
                    o = other[cross[0]][name]
                    lst[cross[0]] = [cross[0], o[1], 'wm', cross[0], e.get('w'), e.get('from'), e.get('to'), o[6], None]
                else:
                    # 3. the hand-over is not on the maps (the other state is on no map, or not on this land
                    #    then): its Wikidata dates must meet this state's beginning or end
                    if side == 'b':
                        ends, mine = [e.get('to')], starts + [wd_year(name, 'from')]
                    else:
                        ends, mine = [e.get('from')], stops + [wd_year(name, 'to')]
                    meets = any(a is not None and b is not None and abs(a - b) <= MEET for a in ends for b in mine)
                    # and the statement must be on this state's own item: a small state that names a large one
                    # as its predecessor (the Free State of Icaria, the Ottoman Empire) is not listed there
                    if not meets or not e.get('own') or NOT_A_STATE.search(e['n']):
                        dropped['on the maps, but not on this land at the hand-over, and its dates do not meet this state\'s' if mnames
                                else 'not on the maps, and its dates do not meet this state\'s'] += 1
                        continue
                    ref_ = ends[0]
                    mname = min(mnames, key=lambda m: min(abs(v - ref_) for v in years_of[m])) if mnames and ref_ is not None else None
                    lst[mname or e['n']] = [mname or e['n'], None, 'w', mname, e.get('w'), e.get('from'), e.get('to'), 0.0, None]
            if not lst:
                continue
            if name in DEBUG:
                for e in sorted(lst.values(), key=lambda e: -e[7]):
                    log(f'  debug {name} {side}: {e[0]} {e[1]} {e[2]} share={e[7]:.3f} new={e[8]}')

            ref = first if side == 'b' else last

            def near(e):
                """How close the Wikidata dates are to the hand-over (a predecessor that ended when this began)."""
                v = e[6] if side == 'b' else e[5]
                return abs(v - ref) if v is not None else 9999

            # the state's own beginning (end) on the maps and on Wikidata
            edge = starts + [wd_year(name, 'from')] if side == 'b' else stops + [wd_year(name, 'to')]

            def breakaway(e):
                # a break-away takes a large share of the land, or comes in the last third of the state's
                # years on the maps; earlier small ones are more often the source drawing a part on its own
                late = e[1] is not None and e[1] >= last - min((last - first) / 3, 100)
                return ('s' in e[2] and (e[8] or 0) >= BREAK_S and (e[7] >= 0.1 or (late and e[7] >= BREAK_W))
                        and ('w' in e[2] or lasted(e) >= 5))

            def lasted(e):
                # years the other state stays on the maps from the hand-over (a rising of a year or two is not
                # a state that broke away)
                on, n_ = set(years_of.get(e[3] or '', ())), 0
                while e[1] is not None and e[1] + n_ in on:
                    n_ += 1
                return n_

            def at_edge(e):
                # a hand-over on the maps long after this state began (or long before it ended) is an
                # annexation or a conquest, not a predecessor (successor)
                return e[1] is None or any(v is not None and abs(e[1] - v) <= WINDOW for v in edge)

            def keep(e):
                fl = e[2]
                if 'w' not in fl and RISING.search(e[0]):   # a rising the source draws as a territory
                    return False
                if 'r' in fl and 's' in fl and 'w' not in fl:   # a part drawn on its own by the other map source from 1886
                    return False
                if 's' in fl and not breakaway(e):
                    if 'w' not in fl:
                        return False
                    e[2] = fl = fl.replace('s', '')   # Wikidata names it, but it did not break away: a conquest
                if 's' not in fl and not at_edge(e):
                    return False
                if 'w' in fl:
                    return True
                if 'x' in fl and e[7] < 0.5:   # a gap in the source's drawing, not a beginning or end
                    return False
                if 's' in fl:
                    return True
                if 'v' in fl:        # a state that first appeared on this state's land as it ended
                    return e[7] >= LOW or ((e[8] or 0) >= BREAK_S and e[7] >= BREAK_W)
                if 'u' in fl:
                    return e[7] >= 0.3
                return e[7] >= MAP_ONLY

            def group(e):
                fl = e[2]
                if 'w' in fl and 'm' in fl:
                    return 0
                if 'm' in fl and 'u' not in fl and 's' not in fl:
                    return 1
                if fl == 'w':
                    return 2
                if 's' in fl:
                    return 3
                return 4
            items = sorted((e for e in lst.values() if keep(e)), key=lambda e: (group(e), -e[7], near(e)))
            # where the maps change source (1885 to 1886) only the main holder is the same state going on;
            # colonies drawn apart by the new source (Cuba, the Philippines) did not succeed it
            r_top = max((e[7] for e in items if 'r' in e[2]), default=None)
            items = [e for e in items if 'r' not in e[2] or 'w' in e[2] or e[7] == r_top]
            cap = {0: 10, 1: 6, 2: 4, 3: 8, 4: 2}
            kept, n_in = [], {}
            for e in items:
                g = group(e)
                n_in[g] = n_in.get(g, 0) + 1
                if n_in[g] <= cap[g]:
                    kept.append(e)
            items = kept[:16]
            if items:
                rec[side] = [e[:2] + [e[2].replace('v', '').replace('x', '')] + e[3:7] for e in items]
                n_w += sum('w' in e[2] for e in items)
                n_m += sum('m' in e[2] for e in items)
        if rec:
            out[name] = rec
    log('  Wikidata statements left out:', dict(dropped))
    size = write_json(os.path.join(DATA, 'succession.json'), out)
    log(f'succession: {len(out)} of {len(years_of)} territories have a before or after; {n_w} links from Wikidata, '
        f'{n_m} from the maps; {size // 1024} KB')


if __name__ == '__main__':
    main()
