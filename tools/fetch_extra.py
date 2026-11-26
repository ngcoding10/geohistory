"""Step 1e: more events from Wikidata -> tools/cache/extra_raw.json

  - deep pass: every item that is directly a battle, siege, war, rebellion, revolution, treaty, massacre,
    earthquake, epidemic, famine... with a date, down to 1 Wikipedia edition (the first pass needed 3 to 8,
    which favoured Europe and North America);
  - notable people born and died (40+ Wikipedia editions), for an optional filter;
  - foundings of cities, universities and other major institutions (25+ editions).
"""
import json
import os
from common import sparql, qid, log, CACHE
from fetch_events import details, xsd

DEEP = {  # class -> type
    'Q178561': 'battle', 'Q188055': 'battle', 'Q1261499': 'battle', 'Q467011': 'battle', 'Q831663': 'battle',
    'Q198': 'war', 'Q8465': 'war', 'Q1006311': 'war',
    'Q124734': 'revolt', 'Q10931': 'revolt', 'Q45382': 'revolt', 'Q124757': 'revolt', 'Q6107280': 'revolt',
    'Q3199915': 'violence', 'Q41397': 'violence', 'Q3882219': 'violence', 'Q177716': 'violence',
    'Q131569': 'treaty', 'Q625298': 'treaty',
    'Q7944': 'disaster', 'Q7692360': 'disaster', 'Q8068': 'disaster', 'Q168247': 'famine', 'Q8092': 'disaster',
    'Q8070': 'disaster', 'Q168983': 'disaster',
    'Q44512': 'epidemic', 'Q12184': 'epidemic', 'Q3241045': 'epidemic',
    'Q209715': 'ruler', 'Q51645': 'religion', 'Q2401485': 'discovery', 'Q1464916': 'state',
    'Q7755': 'politics', 'Q40231': 'politics', 'Q43109': 'politics', 'Q290178': 'economy', 'Q114380': 'economy',
    'Q1020018': 'economy',
}
FOUND = {'Q3918': 'university', 'Q515': 'city', 'Q1549591': 'city', 'Q5119': 'city', 'Q1637706': 'city',
         'Q33506': 'museum', 'Q7075': 'library', 'Q44613': 'monastery', 'Q2977': 'cathedral', 'Q16970': 'church'}


def deep():
    out = {}
    for cls, t in DEEP.items():
        q = f'''SELECT ?item ?sl WHERE {{ ?item wdt:P31 wd:{cls} . ?item wikibase:sitelinks ?sl . FILTER(?sl >= 1)
  FILTER EXISTS {{ {{ ?item wdt:P585 [] }} UNION {{ ?item wdt:P580 [] }} }} }}'''
        try:
            rows = sparql(q)
        except Exception as e:
            log(f'  {cls} failed: {e}')
            continue
        for r in rows:
            out.setdefault(qid(r['item']), {'t': t, 'sl': int(r['sl'])})
        log(f'deep {cls} ({t}): {len(rows)} -> {len(out)}')
    return out


def people():
    out = []
    spans = [(-3000, -500, 500), (-500, 1000, 250), (1000, 1500, 100), (1500, 1800, 50), (1800, 1900, 20), (1900, 2026, 10)]
    for a0, b0, step in spans:
        for a in range(a0, b0, step):
            b = min(b0, a + step)
            for prop, kind in (('P569', 'birth'), ('P570', 'death')):
                q = f'''SELECT ?p ?d ?sl WHERE {{ ?p wdt:{prop} ?d .
  FILTER(?d >= "{xsd(a)}"^^xsd:dateTime && ?d < "{xsd(b)}"^^xsd:dateTime)
  ?p wikibase:sitelinks ?sl . FILTER(?sl >= 40) ?p wdt:P31 wd:Q5 . }}'''
                try:
                    rows = sparql(q)
                except Exception as e:
                    log(f'  people {a}..{b} {kind} failed: {e}')
                    continue
                for r in rows:
                    out.append({'p': qid(r['p']), 'k': kind, 'sl': int(r['sl'])})
        log(f'people up to {b0}: {len(out)}')
    return out


def foundings():
    out = {}
    for cls, kind in FOUND.items():
        q = f'''SELECT ?item ?sl WHERE {{ ?item wdt:P31 wd:{cls} . ?item wdt:P571 [] .
  ?item wikibase:sitelinks ?sl . FILTER(?sl >= 25) }}'''
        try:
            for r in sparql(q):
                out.setdefault(qid(r['item']), {'kind': kind, 'sl': int(r['sl'])})
        except Exception as e:
            log(f'  founding {cls} failed: {e}')
        log(f'foundings {kind}: {len(out)}')
    return out


def main():
    raw = json.load(open(os.path.join(CACHE, 'events_raw.json')))
    have = set(raw['kept']) | set(raw['details'])
    d = deep()
    new = {k: v for k, v in d.items() if k not in raw['kept']}
    log(f'deep pass: {len(d)} items, {len(new)} new')
    pe = people()
    fo = foundings()
    need = (set(new) | {x['p'] for x in pe} | set(fo)) - have
    det = details(need)
    # people need birth/death dates and places, foundings need inception: ask separately (details() reads P585/P580)
    extra_dates = {}
    ids = sorted({x['p'] for x in pe} | set(fo), key=lambda q: int(q[1:]))
    for i in range(0, len(ids), 150):
        v = ' '.join('wd:' + x for x in ids[i:i + 150])
        q = f'''SELECT ?x ?prop ?t ?prec ?cal ?pc WHERE {{ VALUES ?x {{ {v} }} VALUES ?prop {{ "P569" "P570" "P571" }}
  BIND(IRI(CONCAT("http://www.wikidata.org/prop/", ?prop)) AS ?pp)
  BIND(IRI(CONCAT("http://www.wikidata.org/prop/statement/value/", ?prop)) AS ?pv)
  ?x ?pp ?st . ?st ?pv [ wikibase:timeValue ?t; wikibase:timePrecision ?prec; wikibase:timeCalendarModel ?cal ] .
  OPTIONAL {{ FILTER(?prop = "P569") ?x wdt:P19/wdt:P625 ?pc }}
  OPTIONAL {{ FILTER(?prop = "P570") ?x wdt:P20/wdt:P625 ?pc }} }}'''
        try:
            for r in sparql(q):
                extra_dates.setdefault(qid(r['x']), []).append([r['prop'], r['t'], r['prec'], qid(r['cal']), r.get('pc')])
        except Exception as e:
            log(f'  dates batch {i} failed: {e}')
        if i % 3000 == 0:
            log(f'  dates {i}/{len(ids)}')
    with open(os.path.join(CACHE, 'extra_raw.json'), 'w') as f:
        json.dump({'deep': new, 'people': pe, 'found': fo, 'details': det, 'dates': extra_dates}, f)
    log('wrote extra_raw.json')


if __name__ == '__main__':
    main()
