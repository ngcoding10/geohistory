"""Step 1d: heads of state and government (monarchs, emperors, sultans, presidents, prime ministers, popes,
caliphs...) as terms with start and end, from Wikidata "position held" statements. -> tools/cache/rulers_raw.json

1. positions whose "applies to jurisdiction" is a country, state, kingdom or empire;
2. keep those that are a subclass (at any depth) of head of state, head of government or monarch;
3. every "position held" statement for them with a start date, for people with 8+ Wikipedia editions.
"""
import json
import os
from common import sparql, qid, log, CACHE

ROOTS = ['Q48352', 'Q2285706', 'Q116', 'Q19546', 'Q1806453']  # head of state, head of govt, monarch, pope, caliph
JC = ['Q6256', 'Q3624078', 'Q3024240', 'Q417175', 'Q48349', 'Q7275', 'Q1250464', 'Q12759805', 'Q28171280']


def main():
    vals = ' '.join('wd:' + c for c in JC)
    rows = sparql(f'''SELECT ?pos ?j ?parent WHERE {{ VALUES ?jc {{ {vals} }}
  ?j wdt:P31 ?jc . ?pos wdt:P1001 ?j . ?pos wdt:P279 ?parent . }}''')
    pos_j, parents = {}, {}
    for r in rows:
        pos_j.setdefault(qid(r['pos']), qid(r['j']))
        parents.setdefault(qid(r['pos']), set()).add(qid(r['parent']))
    allp = sorted({p for ps in parents.values() for p in ps} | set(ROOTS))
    ok = set(ROOTS)
    rv = ' '.join('wd:' + r for r in ROOTS)
    for i in range(0, len(allp), 300):
        v = ' '.join('wd:' + c for c in allp[i:i + 300])
        for b in sparql(f'SELECT DISTINCT ?c WHERE {{ VALUES ?c {{ {v} }} VALUES ?r {{ {rv} }} ?c wdt:P279* ?r . }}'):
            ok.add(qid(b['c']))
    positions = sorted(p for p, ps in parents.items() if ps & ok)
    log(f'{len(positions)} ruling positions of {len(parents)} with a country jurisdiction')

    terms = []
    for i in range(0, len(positions), 80):
        v = ' '.join('wd:' + p for p in positions[i:i + 80])
        q = f'''SELECT ?person ?pos ?s ?sp ?sc ?e ?sl WHERE {{ VALUES ?pos {{ {v} }}
  ?st ps:P39 ?pos . ?person p:P39 ?st . ?person wdt:P31 wd:Q5 .
  ?st pqv:P580 [ wikibase:timeValue ?s; wikibase:timePrecision ?sp; wikibase:timeCalendarModel ?sc ] .
  OPTIONAL {{ ?st pq:P582 ?e }}
  ?person wikibase:sitelinks ?sl . FILTER(?sl >= 8) }}'''
        try:
            rs = sparql(q)
        except Exception as ex:
            log(f'  batch {i} failed: {ex}')
            continue
        for r in rs:
            terms.append({'p': qid(r['person']), 'pos': qid(r['pos']), 's': r['s'], 'sp': int(r['sp']),
                          'sc': qid(r['sc']), 'e': r.get('e'), 'sl': int(r['sl'])})
        log(f'  positions {min(i + 80, len(positions))}/{len(positions)}: {len(terms)} terms')

    need = sorted({t['p'] for t in terms} | {t['pos'] for t in terms} | {pos_j[t['pos']] for t in terms})
    labels = {}
    for i in range(0, len(need), 400):
        v = ' '.join('wd:' + x for x in need[i:i + 400])
        for r in sparql(f'''SELECT ?x ?l ?w WHERE {{ VALUES ?x {{ {v} }} ?x rdfs:label ?l FILTER(LANG(?l) = "en")
  OPTIONAL {{ ?a schema:about ?x; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?w }} }}'''):
            labels[qid(r['x'])] = [r['l'], r.get('w')]
    with open(os.path.join(CACHE, 'rulers_raw.json'), 'w') as f:
        json.dump({'terms': terms, 'pos_j': pos_j, 'labels': labels}, f)
    log(f'wrote rulers_raw.json: {len(terms)} terms, {len(labels)} labels')


if __name__ == '__main__':
    main()
