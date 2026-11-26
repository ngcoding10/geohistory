"""Step 3: link polity and power names from the border snapshots to Wikidata, carefully.

A name gets a QID only when:
  - an item's English label (or, failing that, an alias) is exactly the name, and
  - the item is a polity, people, culture or territory (instance of a subclass of one of ROOTS), and
  - its inception/dissolution dates (when Wikidata has them) overlap the years the name is on the map
    (with 150 years of slack, because snapshot years are coarse).
Among several matches the label match with most sitelinks wins. Everything else stays unlinked.

Writes data/entities.json: { name: {q, d, from, to, cap, w} } (description, years, capital, enwiki title).
"""
import json
import os
import re

from common import sparql, qid, log, CACHE, DATA, write_json, read_json

ROOTS = ['Q1048835', 'Q3024240', 'Q7275', 'Q41710', 'Q465299', 'Q8432', 'Q2472587', 'Q133311',
         'Q170156', 'Q11514315', 'Q164950', 'Q28171280', 'Q133442', 'Q133156']
# never a territory on these maps, even when the name matches (villages, towns, modern districts)
NOT_ROOTS = ['Q486972', 'Q515', 'Q3957', 'Q532', 'Q15284']


def year_of(v):
    """Wikidata RDF dateTime -> historical year."""
    if not v:
        return None
    try:
        neg = v.startswith('-')
        y = int(v.lstrip('-').split('-')[0])
        return -(y + 1) if neg else (y if y != 0 else -1)
    except ValueError:
        return None


def esc(s):
    return s.replace('\\', '\\\\').replace('"', '\\"')


def fix_early(out, names):
    """Names shown on maps more than 50 years before the linked item's inception: decide which side is wrong.

    1. the item replaced an earlier state that covers those years (Ethiopia <- Ethiopian Empire): record the
       earlier states as "eras" and count the name from the first of them;
    2. the item is one of today's countries and Wikidata's inception is its independence or current
       constitution (Madagascar 1960): the name on older maps is the land or an earlier realm, so the date is
       kept as "mod" (shown as a note) instead of "from";
    3. the item is a modern unit that starts after 1700 (Oldenburg the 1933 district, Tibet 1912-1951, a US
       state) and most of the maps are earlier: the link was wrong, drop it;
    4. anything else stays linked and flagged (the audit counts it).
    """
    early = {}
    for name, e in out.items():
        ys = [y for y in names.get(name, []) if e.get('from') is not None and y < e['from'] - 50]
        if ys:
            early[name] = ys
    if not early:
        return
    qs = sorted({out[n]['q'] for n in early})
    iso = set()
    for i in range(0, len(qs), 200):
        vals = ' '.join('wd:' + q for q in qs[i:i + 200])
        for r in sparql(f'SELECT ?x WHERE {{ VALUES ?x {{ {vals} }} ?x wdt:P297 [] . }}'):
            iso.add(qid(r['x']))
    # Predecessors, up to six steps back. "Replaces" on Wikidata fans out quickly (France <- ... <- Ancient
    # Rome), so a predecessor only counts, and is only followed further, when its name carries the map name
    # ("Kingdom of France", "Ethiopian Empire", "Roman Egypt").
    def stem(n):
        n = re.sub(r'[^a-z ]', '', n.lower())
        w = max(n.split(), key=len) if n.split() else n
        return w[:max(4, len(w) - 2)]
    stems = {}
    for name in early:
        stems.setdefault(out[name]['q'], set()).add(stem(name))
    pred = {}
    info = {}
    frontier = {q: set(st) for q, st in stems.items()}
    seen = set(qs)
    for depth in range(6):
        nxt = {}
        fl = sorted(frontier)
        for i in range(0, len(fl), 150):
            vals = ' '.join('wd:' + q for q in fl[i:i + 150])
            try:
                rows = sparql(f'''SELECT ?x ?p ?start ?end ?l ?d ?w WHERE {{ VALUES ?x {{ {vals} }}
  {{ ?x wdt:P1365 ?p }} UNION {{ ?x wdt:P155 ?p }} UNION {{ ?p wdt:P1366 ?x }} UNION {{ ?p wdt:P156 ?x }}
  ?p wdt:P571 ?start . OPTIONAL {{ ?p wdt:P576 ?end }} ?p rdfs:label ?l FILTER(LANG(?l) = "en")
  OPTIONAL {{ ?p schema:description ?d FILTER(LANG(?d) = "en") }}
  OPTIONAL {{ ?a schema:about ?p; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?w }}
  FILTER NOT EXISTS {{ ?p wdt:P31 wd:Q5 }} }}''')
            except Exception as ex:
                log(f'  predecessor batch failed: {ex}')
                continue
            for r in rows:
                x, p = qid(r['x']), qid(r['p'])
                want = frontier.get(x, set())
                lab = re.sub(r'[^a-z ]', '', r['l'].lower())
                if not any(st in lab for st in want):
                    continue
                pred.setdefault(x, set()).add(p)
                e = info.setdefault(p, {'q': p, 'n': r['l']})
                a, b = year_of(r.get('start')), year_of(r.get('end'))
                if a is not None:
                    e['from'] = min(e.get('from', a), a)
                if b is not None:
                    e['to'] = max(e.get('to', b), b)
                if r.get('d'):
                    e['d'] = r['d']
                if r.get('w'):
                    e['w'] = r['w']
                if p not in seen:
                    seen.add(p)
                    nxt.setdefault(p, set()).update(want)
        frontier = nxt
        if not frontier:
            break
    stats = {'eras': 0, 'modern': 0, 'dropped': 0, 'flagged': 0}
    for name, ys in early.items():
        e = out[name]
        chain, todo, done = [], [e['q']], set()
        while todo:
            x = todo.pop()
            for p in pred.get(x, ()):
                if p not in done:
                    done.add(p)
                    chain.append(info[p])
                    todo.append(p)
        chain = [c for c in chain if c.get('from') is not None and c['from'] < e['from']]
        covered = [y for y in ys if any(c['from'] - 50 <= y <= c.get('to', e['from']) + 50 for c in chain)]
        if chain and len(covered) >= max(1, len(ys) // 2):
            e['eras'] = sorted(chain, key=lambda c: c['from'])[:8]
            e['mod'] = e['from']
            e['from'] = min(c['from'] for c in chain)
            if not any(y < e['from'] - 50 for y in ys):
                stats['eras'] += 1
            elif e['q'] in iso:
                del e['from']   # the earlier states do not reach back far enough: the name is the land
                stats['modern'] += 1
            else:
                stats['flagged'] += 1
        elif e['q'] in iso:
            e['mod'] = e.pop('from')
            if chain:
                e['eras'] = sorted(chain, key=lambda c: c['from'])[:8]
            stats['modern'] += 1
        else:
            fit = [y for y in names.get(name, []) if y >= e['from'] - 50 and (e.get('to') is None or y <= e['to'] + 50)]
            # a modern unit (a US state, a 20th-century province) on mostly older maps is the wrong item;
            # an old state drawn too early is the map's anachronism and stays linked and flagged
            if len(ys) > len(fit) and e['from'] >= 1700:
                del out[name]
                stats['dropped'] += 1
            else:
                stats['flagged'] += 1
    write_json(os.path.join(CACHE, 'early_fix.json'), stats)
    log(f'names shown before their linked item begins: {len(early)} -> {stats}')


def main():
    names = read_json(os.path.join(CACHE, 'names.json'))
    powers = read_json(os.path.join(DATA, 'powers.json'))
    for k, p in powers.items():
        names.setdefault(p['name'], list(range(p['years'][0], p['years'][1] + 1, 100)) + [p['years'][1]])
    todo = sorted(n for n in names if 2 < len(n) < 90)
    log(f'{len(todo)} names to link')
    cands = {}
    item_cls = {}
    for i in range(0, len(todo), 60):
        batch = todo[i:i + 60]
        vals = ' '.join(f'"{esc(n)}"@en' for n in batch)
        # labels and aliases as two simple queries: one combined query times out
        for alias, pred in ((0, 'rdfs:label'), (1, 'skos:altLabel')):
            q = f'''SELECT ?name ?item ?sl WHERE {{ VALUES ?name {{ {vals} }} ?item {pred} ?name .
  ?item wikibase:sitelinks ?sl . FILTER(?sl >= 2) }}'''
            try:
                rows = sparql(q)
            except Exception as e:
                log(f'  batch {i} ({pred}) failed: {e}')
                continue
            for r in rows:
                c = cands.setdefault(r['name'], {}).setdefault(qid(r['item']), {'sl': int(r['sl']), 'alias': alias})
                c['alias'] = min(c['alias'], alias)
        log(f'  names {i + len(batch)}/{len(todo)}: {len(cands)} with candidates')
    items = sorted({k for cs in cands.values() for k in cs}, key=lambda q: int(q[1:]))
    spans = {}
    for i in range(0, len(items), 200):
        vals = ' '.join('wd:' + q for q in items[i:i + 200])
        q = f'''SELECT ?item (GROUP_CONCAT(DISTINCT STRAFTER(STR(?c), "entity/")) AS ?cls) (MIN(?s) AS ?start) (MAX(?e) AS ?end) WHERE {{
  VALUES ?item {{ {vals} }} OPTIONAL {{ ?item wdt:P31 ?c }} OPTIONAL {{ ?item wdt:P571 ?s }} OPTIONAL {{ ?item wdt:P576 ?e }} }} GROUP BY ?item'''
        for r in sparql(q):
            k = qid(r['item'])
            item_cls[k] = set(r.get('cls', '').split())
            spans[k] = (year_of(r.get('start')), year_of(r.get('end')))
        log(f'  items {min(i + 200, len(items))}/{len(items)}')
    for cs in cands.values():
        for k, c in cs.items():
            c['start'], c['end'] = spans.get(k, (None, None))

    # keep only polities, peoples, cultures and territories (instance of a subclass of a root)
    classes = sorted({c for cs in item_cls.values() for c in cs})
    ok_cls = set()
    rootvals = ' '.join('wd:' + r for r in ROOTS)
    for i in range(0, len(classes), 150):
        vals = ' '.join('wd:' + c for c in classes[i:i + 150])
        try:
            for b in sparql(f'SELECT DISTINCT ?c WHERE {{ VALUES ?c {{ {vals} }} VALUES ?r {{ {rootvals} }} ?c wdt:P279* ?r . }}'):
                ok_cls.add(qid(b['c']))
        except Exception as e:
            log(f'  class batch failed: {e}')
    bad_cls = set()
    badvals = ' '.join('wd:' + r for r in NOT_ROOTS)
    for i in range(0, len(classes), 150):
        vals = ' '.join('wd:' + c for c in classes[i:i + 150])
        try:
            for b in sparql(f'SELECT DISTINCT ?c WHERE {{ VALUES ?c {{ {vals} }} VALUES ?r {{ {badvals} }} ?c wdt:P279* ?r . }}'):
                bad_cls.add(qid(b['c']))
        except Exception as e:
            log(f'  class batch failed: {e}')
    for name in list(cands):
        cands[name] = {k: v for k, v in cands[name].items()
                       if item_cls.get(k, set()) & ok_cls and not item_cls.get(k, set()) & bad_cls}
    log(f'{len(ok_cls)} of {len(classes)} classes are polity-like')

    chosen = {}
    for name, cs in cands.items():
        yrs = names[name]
        lo, hi = min(yrs), max(yrs)
        ok = []
        for q, c in cs.items():
            if c['start'] is not None and c['start'] > hi + 150:
                continue
            if c['end'] is not None and c['end'] < lo - 150:
                continue
            ok.append((c['alias'], -c['sl'], q, c))
        if not ok:
            continue
        ok.sort()
        alias, nsl, q, c = ok[0]
        if alias and (c['sl'] < 5 or sum(1 for o in ok if o[0] == 1) > 1):
            continue
        if c['sl'] < 3:
            continue
        # short names ("Han", "Wei") are ambiguous: only trust them when the dates confirm the match
        if len(name) <= 4 and (c['start'] is None or c['start'] > hi or (c['end'] is not None and c['end'] < lo)):
            continue
        chosen[name] = q
    log(f'linked {len(chosen)} of {len(todo)} names')
    # Cliopatria supplies a Wikidata id for each of its polities: use it where the name search found nothing
    cl_path = os.path.join(CACHE, 'clio_links.json')
    n_clio = 0
    if os.path.exists(cl_path):
        for name, v in read_json(cl_path).items():
            if name not in chosen and name in names and re.match(r'^Q\d+$', v.get('q') or ''):
                chosen[name] = v['q']
                n_clio += 1
    log(f'{n_clio} more names linked by the ids Cliopatria gives')

    qs = sorted(set(chosen.values()))
    info = {}
    for i in range(0, len(qs), 150):
        vals = ' '.join('wd:' + q for q in qs[i:i + 150])
        q = f'''SELECT ?item ?desc ?enwiki ?start ?end ?capL WHERE {{
  VALUES ?item {{ {vals} }}
  OPTIONAL {{ ?item schema:description ?desc FILTER(LANG(?desc) = "en") }}
  OPTIONAL {{ ?w schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?enwiki }}
  OPTIONAL {{ ?item wdt:P571 ?start }} OPTIONAL {{ ?item wdt:P576 ?end }}
  OPTIONAL {{ ?item wdt:P36 ?cap . ?cap rdfs:label ?capL FILTER(LANG(?capL) = "en") }}
}}'''
        for r in sparql(q):
            k = qid(r['item'])
            e = info.setdefault(k, {'q': k})
            if r.get('desc'):
                e['d'] = r['desc']
            if r.get('enwiki'):
                e['w'] = r['enwiki']
            for f, src in (('from', 'start'), ('to', 'end')):
                y = year_of(r.get(src))
                if y is not None and (f not in e or (f == 'from' and y < e[f]) or (f == 'to' and y > e[f])):
                    e[f] = y
            if r.get('capL'):
                caps = e.setdefault('cap', [])
                if r['capL'] not in caps and len(caps) < 3:
                    caps.append(r['capL'])
        log(f'  info {min(i + 150, len(qs))}/{len(qs)}')
    out = {name: dict(info.get(q, {'q': q})) for name, q in sorted(chosen.items())}
    fix_early(out, names)
    size = write_json(os.path.join(DATA, 'entities.json'), out)
    log(f'wrote entities.json ({len(out)} names, {size // 1024} KB)')


if __name__ == '__main__':
    main()
