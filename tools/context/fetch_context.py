"""Wikidata facts for the state context: government form, religion, population, parties, the party of every
head of state and government the app lists, and movements. All queries are cached (tools/common.py).

Items asked about: every map state's own Wikidata item, the earlier eras link_wikidata found under the same
name, the regimes in tools/curated/context/regimes.json (resolved here from their Wikipedia titles) and the
countries the ruler lists are filed under (data/rulers/terms.json).

Writes tools/cache/context/wikidata.json:
  items:    {QID: {n, from, to, sl, P122: [...], P140: [...], P3075: [...], P1082: [...]}}
            a statement is [value QID, value label, start, end, point in time, rank, source label]
  regimes:  {territory: [[from, to, QID, title, verified, note]]}
  persons:  {QID: [[party QID, start, end]]}
  parties:  {QID: {n, from, to, sl, c: [country QIDs], ideo: [labels], align: label}}
  movements:{QID: {n, d, from, to, sl, c: [country QIDs], cls}}
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from common import CACHE, DATA, TOOLS, log, qid, read_json, sparql, write_json  # noqa: E402

OUT = os.path.join(CACHE, 'context')


def year_of(v):
    """Wikidata RDF dateTime (astronomical year, as the query service gives it) -> historical year."""
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


def chunks(xs, n):
    xs = sorted(xs)
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def batch(qs, n, make, label):
    rows = []
    for i, part in enumerate(chunks(qs, n)):
        vals = ' '.join('wd:' + q for q in part)
        try:
            rows += sparql(make(vals))
        except Exception as ex:   # noqa: BLE001
            if n > 20:
                log(f'  {label}: batch of {n} failed ({ex}); splitting')
                rows += batch(part, max(10, n // 4), make, label)
            else:
                log(f'  {label}: batch failed: {ex}')
    return rows


def resolve_titles(titles):
    out = {}
    for part in chunks(set(titles), 80):
        vals = ' '.join(f'"{esc(t)}"@en' for t in part)
        for r in sparql(f'''SELECT ?t ?x ?start ?end WHERE {{ VALUES ?t {{ {vals} }}
  ?a schema:about ?x; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?t .
  OPTIONAL {{ ?x wdt:P571 ?start }} OPTIONAL {{ ?x wdt:P576 ?end }} }}'''):
            e = out.setdefault(r['t'], {'q': qid(r['x']), 'from': None, 'to': None})
            a, b = year_of(r.get('start')), year_of(r.get('end'))
            if a is not None:
                e['from'] = a if e['from'] is None else min(e['from'], a)
            if b is not None:
                e['to'] = b if e['to'] is None else max(e['to'], b)
    return out


STATEMENT = '''SELECT ?x ?v ?vl ?start ?end ?pit ?rank ?src WHERE {{ VALUES ?x {{ {vals} }}
  ?x p:{p} ?st . ?st ps:{p} ?v ; wikibase:rank ?rank . FILTER(?rank != wikibase:DeprecatedRank)
  OPTIONAL {{ ?st pq:P580 ?start }} OPTIONAL {{ ?st pq:P582 ?end }} OPTIONAL {{ ?st pq:P585 ?pit }}
  OPTIONAL {{ ?v rdfs:label ?vl FILTER(LANG(?vl) = "en") }}
  OPTIONAL {{ ?st prov:wasDerivedFrom/pr:P248 ?s . ?s rdfs:label ?src FILTER(LANG(?src) = "en") }} }}'''


def main():
    os.makedirs(OUT, exist_ok=True)
    st = read_json(os.path.join(OUT, 'states.json'))['states']
    terms = read_json(os.path.join(DATA, 'rulers', 'terms.json'))
    cur = read_json(os.path.join(TOOLS, 'curated', 'context', 'regimes.json'))['regimes']

    # regimes: titles -> items, checked against the items' own dates
    res = resolve_titles([r[2] for rows in cur.values() for r in rows])
    regimes = {}
    for name, rows in cur.items():
        out = []
        for a, b, title in rows:
            r = res.get(title)
            if not r:
                log(f'  regime not found on Wikidata: {title}')
                out.append([a, b, None, title, False, 'no Wikidata item for this article'])
                continue
            # the row must lie within the item's own years (a regime row may cover part of a longer-lived item)
            ok_a = r['from'] is not None and r['from'] - 2 <= a
            ok_b = (r['to'] is not None and b <= r['to'] + 2) or (r['to'] is None)
            note = f"Wikidata: {r['from'] if r['from'] is not None else '?'} to {r['to'] if r['to'] is not None else 'today'}"
            out.append([a, b, r['q'], title, ok_a and ok_b, note])
        regimes[name] = out

    items = set()
    for s in st.values():
        if s.get('q'):
            items.add(s['q'])
        for e in s.get('eras', []):
            items.add(e['q'])
    for rows in regimes.values():
        items.update(r[2] for r in rows if r[2])
    items.update(k for k in terms if k.startswith('Q'))
    log(f'context: {len(items)} state items')

    info = {}
    for r in batch(items, 200, lambda vals: f'''SELECT ?x ?l ?start ?end ?sl WHERE {{ VALUES ?x {{ {vals} }}
  OPTIONAL {{ ?x rdfs:label ?l FILTER(LANG(?l) = "en") }} OPTIONAL {{ ?x wdt:P571 ?start }} OPTIONAL {{ ?x wdt:P576 ?end }}
  OPTIONAL {{ ?x wikibase:sitelinks ?sl }} }}''', 'items'):
        x = qid(r['x'])
        e = info.setdefault(x, {'n': r.get('l') or x})
        a, b = year_of(r.get('start')), year_of(r.get('end'))
        if a is not None:
            e['from'] = min(e.get('from', a), a)
        if b is not None:
            e['to'] = max(e.get('to', b), b)
        if r.get('sl'):
            e['sl'] = int(r['sl'])
    for p in ('P122', 'P140', 'P3075', 'P1082'):
        rows = batch(items, 150, lambda vals, p=p: STATEMENT.format(vals=vals, p=p), p)
        seen = set()
        for r in rows:
            x = qid(r['x'])
            v = qid(r['v']) if r['v'].startswith('http://www.wikidata.org/entity/') else r['v']
            row = [v, r.get('vl') or (v if p == 'P1082' else None), year_of(r.get('start')), year_of(r.get('end')),
                   year_of(r.get('pit')), r['rank'].rsplit('#', 1)[-1].replace('Rank', '').lower(), r.get('src')]
            key = (x, p, json.dumps(row[:6]))
            if key in seen:
                continue
            seen.add(key)
            info.setdefault(x, {'n': x}).setdefault(p, []).append(row)
        log(f'  {p}: {len(rows)} statements')

    # party of every listed head of state and government
    persons = {r[4] for v in terms.values() for r in v['terms'] if len(r) > 4 and r[4]}
    pm = {}
    plabels = {}
    for r in batch(persons, 300, lambda vals: f'''SELECT ?x ?party ?pl ?start ?end WHERE {{ VALUES ?x {{ {vals} }}
  ?x p:P102 ?st . ?st ps:P102 ?party . OPTIONAL {{ ?st pq:P580 ?start }} OPTIONAL {{ ?st pq:P582 ?end }}
  OPTIONAL {{ ?party rdfs:label ?pl FILTER(LANG(?pl) = "en") }} }}''', 'P102'):
        x, party = qid(r['x']), qid(r['party'])
        row = [party, year_of(r.get('start')), year_of(r.get('end'))]
        if row not in pm.setdefault(x, []):
            pm[x].append(row)
        if r.get('pl'):
            plabels[party] = r['pl']
    log(f'  party memberships: {sum(len(v) for v in pm.values())} for {len(pm)} of {len(persons)} people')

    # political parties of those countries
    parties = {}
    for r in batch(items, 60, lambda vals: f'''SELECT ?party ?x ?pl ?start ?end ?sl WHERE {{ VALUES ?x {{ {vals} }}
  ?party wdt:P17 ?x ; wdt:P31/wdt:P279* wd:Q7278 ; wikibase:sitelinks ?sl . FILTER(?sl >= 8)
  OPTIONAL {{ ?party rdfs:label ?pl FILTER(LANG(?pl) = "en") }}
  OPTIONAL {{ ?party wdt:P571 ?start }} OPTIONAL {{ ?party wdt:P576 ?end }} }}''', 'parties'):
        p = qid(r['party'])
        e = parties.setdefault(p, {'n': r.get('pl') or plabels.get(p) or p, 'c': [], 'sl': int(r['sl'])})
        if qid(r['x']) not in e['c']:
            e['c'].append(qid(r['x']))
        a, b = year_of(r.get('start')), year_of(r.get('end'))
        if a is not None:
            e['from'] = min(e.get('from', a), a)
        if b is not None:
            e['to'] = max(e.get('to', b), b)
    # the parties of heads of government that the country query missed (no P17, or a different item)
    extra = {p for v in pm.values() for p, *_ in v} - set(parties)
    for r in batch(extra, 200, lambda vals: f'''SELECT ?party ?pl ?start ?end ?sl ?c WHERE {{ VALUES ?party {{ {vals} }}
  OPTIONAL {{ ?party rdfs:label ?pl FILTER(LANG(?pl) = "en") }} OPTIONAL {{ ?party wikibase:sitelinks ?sl }}
  OPTIONAL {{ ?party wdt:P571 ?start }} OPTIONAL {{ ?party wdt:P576 ?end }} OPTIONAL {{ ?party wdt:P17 ?c }} }}''', 'party items'):
        p = qid(r['party'])
        e = parties.setdefault(p, {'n': r.get('pl') or p, 'c': [], 'sl': int(r.get('sl') or 0)})
        if r.get('c') and qid(r['c']) not in e['c']:
            e['c'].append(qid(r['c']))
        a, b = year_of(r.get('start')), year_of(r.get('end'))
        if a is not None:
            e['from'] = min(e.get('from', a), a)
        if b is not None:
            e['to'] = max(e.get('to', b), b)
    for r in batch(set(parties), 200, lambda vals: f'''SELECT ?party ?il WHERE {{ VALUES ?party {{ {vals} }}
  ?party wdt:P1142 ?i . ?i rdfs:label ?il FILTER(LANG(?il) = "en") }}''', 'ideologies'):
        e = parties[qid(r['party'])]
        if r['il'] not in e.setdefault('ideo', []) and len(e['ideo']) < 4:
            e['ideo'].append(r['il'])
    log(f'  parties: {len(parties)}')

    # movements: social, political, religious, cultural and artistic movements with a country and a start.
    # The classes are listed first (subclasses of six roots), then their members with 12+ sitelinks.
    movements = {}
    roots = ['Q49773', 'Q2738074', 'Q1062083', 'Q2198855', 'Q968159', 'Q1144661']
    classes = {}
    for root in roots:
        for r in sparql(f'SELECT DISTINCT ?c WHERE {{ ?c wdt:P279* wd:{root} }}'):
            classes.setdefault(qid(r['c']), root)
    log(f'  movement classes: {len(classes)}')
    members = {}
    for r in batch(set(classes), 150, lambda vals: f'''SELECT ?m ?c ?sl WHERE {{ VALUES ?c {{ {vals} }}
  ?m wdt:P31 ?c ; wikibase:sitelinks ?sl . FILTER(?sl >= 12) }}''', 'movement members'):
        members.setdefault(qid(r['m']), (int(r['sl']), classes[qid(r['c'])]))
    log(f'  movement items: {len(members)}')
    for r in batch(set(members), 150, lambda vals: f'''SELECT ?m ?x ?ml ?md ?s1 ?s2 ?e1 ?e2 WHERE {{ VALUES ?m {{ {vals} }}
  {{ ?m wdt:P17 ?x }} UNION {{ ?m wdt:P495 ?x }}
  OPTIONAL {{ ?m wdt:P571 ?s1 }} OPTIONAL {{ ?m wdt:P580 ?s2 }} OPTIONAL {{ ?m wdt:P576 ?e1 }} OPTIONAL {{ ?m wdt:P582 ?e2 }}
  OPTIONAL {{ ?m rdfs:label ?ml FILTER(LANG(?ml) = "en") }} OPTIONAL {{ ?m schema:description ?md FILTER(LANG(?md) = "en") }} }}''', 'movement facts'):
        m = qid(r['m'])
        a_ = year_of(r.get('s1')) if r.get('s1') else year_of(r.get('s2'))
        if a_ is None:
            continue
        if qid(r['x']) not in items:
            continue
        sl, root = members[m]
        e = movements.setdefault(m, {'n': r.get('ml') or m, 'd': r.get('md'), 'c': [], 'sl': sl, 'cls': [root]})
        if qid(r['x']) not in e['c']:
            e['c'].append(qid(r['x']))
        e['from'] = min(e.get('from', a_), a_)
        b_ = year_of(r.get('e1')) if r.get('e1') else year_of(r.get('e2'))
        if b_ is not None:
            e['to'] = max(e.get('to', b_), b_)
    log(f'  movements: {len(movements)}')

    write_json(os.path.join(OUT, 'wikidata.json'), {'items': info, 'regimes': regimes, 'persons': pm,
                                                    'parties': parties, 'movements': movements})


if __name__ == '__main__':
    main()
