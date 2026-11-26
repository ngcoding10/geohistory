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
    out = {name: info.get(q, {'q': q}) for name, q in sorted(chosen.items())}
    size = write_json(os.path.join(DATA, 'entities.json'), out)
    log(f'wrote entities.json ({len(out)} names, {size // 1024} KB)')


if __name__ == '__main__':
    main()
