"""Discoveries and inventions from Wikidata, with the facts needed to place them on the map.

An item counts when it has a time of discovery or invention (P575) and at least 20 Wikipedia sitelinks, and
is not a living thing, a star, an asteroid or another sky object, a mineral or a compound (those are
"discovered" by the thousand). For each one: the discoverers or inventors (P61), the location of discovery
(P189), the country of origin (P495) and, for each discoverer, the countries of citizenship (P27, with dates)
and the work locations (P937, with dates and coordinates).

Writes tools/cache/context/discoveries_raw.json:
  {QID: {n, d, y, prec, sl, cls: [..], who: [[QID, label]], loc: [[QID, label, lon, lat]], origin: [[QID, label]],
         coord: [lon, lat]}}
  people: {QID: {cit: [[QID, label, from, to]], work: [[QID, label, lon, lat, from, to]], birth: [QID, label, lon, lat]}}
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import CACHE, log, qid, sparql, write_json  # noqa: E402
from fetch_context import batch, year_of  # noqa: E402

OUT = os.path.join(CACHE, 'context')
# classes whose members are "discovered" by the thousand: taxa, sky objects, minerals, compounds, genes, proteins
SKIP = ['Q16521', 'Q6999', 'Q3863', 'Q1022867', 'Q44559', 'Q523', 'Q318', 'Q3559', 'Q7946', 'Q11173', 'Q7187',
        'Q8054', 'Q4167836', 'Q83373', 'Q1931185', 'Q2154519', 'Q13442814', 'Q5', 'Q11424', 'Q482994', 'Q7889',
        'Q2088357', 'Q1153690', 'Q204194', 'Q1457376', 'Q11410', 'Q4022', 'Q46831']


def point(s):
    m = re.match(r'Point\(([-\d.eE]+) ([-\d.eE]+)\)', s or '')
    return (round(float(m.group(1)), 3), round(float(m.group(2)), 3)) if m else None


def main():
    skip = ' '.join('wd:' + q for q in SKIP)
    rows = sparql(f'''SELECT ?item ?d ?prec ?sl WHERE {{
  ?item p:P575/psv:P575 [ wikibase:timeValue ?d ; wikibase:timePrecision ?prec ] .
  ?item wikibase:sitelinks ?sl . FILTER(?sl >= 20) }}''')
    items = {}
    for r in rows:
        q = qid(r['item'])
        y = year_of(r['d'])
        e = items.setdefault(q, {'sl': int(r['sl'])})
        # several dates: keep the earliest (an invention's first form), with its precision
        if y is not None and (e.get('y') is None or y < e['y']):
            e['y'], e['prec'] = y, int(r['prec'])
    log(f'discoveries: {len(items)} items with a date')
    # leave out the classes discovered by the thousand (checked through subclass chains, in small batches)
    bad = set()
    for r in batch(set(items), 100, lambda vals: f'''SELECT DISTINCT ?x WHERE {{ VALUES ?x {{ {vals} }} VALUES ?bad {{ {skip} }}
  ?x wdt:P31/wdt:P279* ?bad }}''', 'skip classes'):
        bad.add(qid(r['x']))
    for q in bad:
        items.pop(q, None)
    log(f'  {len(bad)} left out as taxa, sky objects, minerals, compounds or people; {len(items)} kept')
    qs = set(items)
    for r in batch(qs, 200, lambda vals: f'''SELECT ?x ?l ?d ?c WHERE {{ VALUES ?x {{ {vals} }}
  OPTIONAL {{ ?x rdfs:label ?l FILTER(LANG(?l) = "en") }} OPTIONAL {{ ?x schema:description ?d FILTER(LANG(?d) = "en") }}
  OPTIONAL {{ ?x wdt:P625 ?c }} }}''', 'labels'):
        e = items[qid(r['x'])]
        e['n'] = r.get('l') or e.get('n')
        e['d'] = r.get('d') or e.get('d')
        if r.get('c') and point(r['c']):
            e['coord'] = point(r['c'])
    for r in batch(qs, 200, lambda vals: f'''SELECT ?x ?c ?cl WHERE {{ VALUES ?x {{ {vals} }} ?x wdt:P31 ?c .
  OPTIONAL {{ ?c rdfs:label ?cl FILTER(LANG(?cl) = "en") }} }}''', 'classes'):
        e = items[qid(r['x'])]
        lab = r.get('cl') or qid(r['c'])
        if lab not in e.setdefault('cls', []):
            e['cls'].append(lab)
    for r in batch(qs, 200, lambda vals: f'''SELECT ?x ?w ?wl WHERE {{ VALUES ?x {{ {vals} }} ?x wdt:P61 ?w .
  OPTIONAL {{ ?w rdfs:label ?wl FILTER(LANG(?wl) = "en") }} }}''', 'discoverers'):
        e = items[qid(r['x'])]
        row = [qid(r['w']), r.get('wl') or qid(r['w'])]
        if row not in e.setdefault('who', []):
            e['who'].append(row)
    for prop, key in (('P189', 'loc'), ('P495', 'origin'), ('P17', 'country')):
        for r in batch(qs, 200, lambda vals, prop=prop: f'''SELECT ?x ?p ?pl ?c WHERE {{ VALUES ?x {{ {vals} }} ?x wdt:{prop} ?p .
  OPTIONAL {{ ?p rdfs:label ?pl FILTER(LANG(?pl) = "en") }} OPTIONAL {{ ?p wdt:P625 ?c }} }}''', prop):
            e = items[qid(r['x'])]
            pt = point(r.get('c'))
            row = [qid(r['p']), r.get('pl') or qid(r['p'])] + (list(pt) if pt else [None, None])
            if not any(x[0] == row[0] for x in e.setdefault(key, [])):
                e[key].append(row)
    people = {}
    who = {w for e in items.values() for w, _ in e.get('who', [])}
    for r in batch(who, 200, lambda vals: f'''SELECT ?x ?c ?cl ?s ?e WHERE {{ VALUES ?x {{ {vals} }} ?x p:P27 ?st . ?st ps:P27 ?c .
  OPTIONAL {{ ?st pq:P580 ?s }} OPTIONAL {{ ?st pq:P582 ?e }} OPTIONAL {{ ?c rdfs:label ?cl FILTER(LANG(?cl) = "en") }} }}''', 'citizenship'):
        row = [qid(r['c']), r.get('cl') or qid(r['c']), year_of(r.get('s')), year_of(r.get('e'))]
        lst = people.setdefault(qid(r['x']), {}).setdefault('cit', [])
        if row not in lst:
            lst.append(row)
    for r in batch(who, 200, lambda vals: f'''SELECT ?x ?w ?wl ?c ?s ?e WHERE {{ VALUES ?x {{ {vals} }} ?x p:P937 ?st . ?st ps:P937 ?w .
  ?w wdt:P625 ?c . OPTIONAL {{ ?st pq:P580 ?s }} OPTIONAL {{ ?st pq:P582 ?e }} OPTIONAL {{ ?w rdfs:label ?wl FILTER(LANG(?wl) = "en") }} }}''', 'work places'):
        pt = point(r['c'])
        if not pt:
            continue
        row = [qid(r['w']), r.get('wl') or qid(r['w']), pt[0], pt[1], year_of(r.get('s')), year_of(r.get('e'))]
        lst = people.setdefault(qid(r['x']), {}).setdefault('work', [])
        if not any(x[0] == row[0] for x in lst):
            lst.append(row)
    for r in batch(who, 200, lambda vals: f'''SELECT ?x ?b ?bl ?c WHERE {{ VALUES ?x {{ {vals} }} ?x wdt:P19 ?b . ?b wdt:P625 ?c .
  OPTIONAL {{ ?b rdfs:label ?bl FILTER(LANG(?bl) = "en") }} }}''', 'birthplaces'):
        pt = point(r['c'])
        if pt:
            people.setdefault(qid(r['x']), {})['birth'] = [qid(r['b']), r.get('bl') or qid(r['b']), pt[0], pt[1]]
    # the capitals of countries of origin and citizenship, for items with nothing more precise
    cs = {c[0] for e in items.values() for c in e.get('origin', []) + e.get('country', [])} | {c[0] for p in people.values() for c in p.get('cit', [])}
    caps = {}
    for r in batch(cs, 200, lambda vals: f'''SELECT ?x ?cap ?capl ?c ?s ?e WHERE {{ VALUES ?x {{ {vals} }} ?x p:P36 ?st . ?st ps:P36 ?cap .
  ?cap wdt:P625 ?c . OPTIONAL {{ ?st pq:P580 ?s }} OPTIONAL {{ ?st pq:P582 ?e }} OPTIONAL {{ ?cap rdfs:label ?capl FILTER(LANG(?capl) = "en") }} }}''', 'capitals'):
        pt = point(r['c'])
        if pt:
            row = [qid(r['cap']), r.get('capl'), pt[0], pt[1], year_of(r.get('s')), year_of(r.get('e'))]
            lst = caps.setdefault(qid(r['x']), [])
            if not any(x[0] == row[0] for x in lst):
                lst.append(row)
    write_json(os.path.join(OUT, 'discoveries_raw.json'), {'items': items, 'people': people, 'capitals': caps})
    log(f'  {len(items)} items, {len(people)} people, {len(caps)} countries with a capital')


if __name__ == '__main__':
    main()
