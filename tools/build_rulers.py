"""Step 4c: rulers that Wikidata does not file under the state drawn on the map.

1. Offices without a country on Wikidata (tools/curated/ruler_map.json, "positions"): fetch every holder
   with a start date -> tools/cache/rulers_extra.json.
2. Curated ruler lists (tools/curated/rulers.json): look up the Wikidata item of each linked article and
   compare our years with the years of the offices the person held (P39 start and end) and the year of
   death -> tools/cache/curated_rulers.json. A row is verified only when both of its years are confirmed:
   the first year by an office start, or by the death of the ruler before it in the list; the last year by
   an office end or the ruler's own death.
build_events.py merges both into data/rulers/terms.json and the ruler events (rulers_merge.py).
"""
import json
import os

from common import sparql, qid, log, CACHE, TOOLS, read_json, write_json
from verify import _hist, esc


def fetch_positions(cfg):
    positions = [p['q'] for p in cfg['positions']]
    terms = []
    for i in range(0, len(positions), 20):
        v = ' '.join('wd:' + p for p in positions[i:i + 20])
        q = f'''SELECT ?person ?pos ?s ?sp ?sc ?e ?sl WHERE {{ VALUES ?pos {{ {v} }}
  ?st ps:P39 ?pos . ?person p:P39 ?st . ?person wdt:P31 wd:Q5 .
  ?st pqv:P580 [ wikibase:timeValue ?s; wikibase:timePrecision ?sp; wikibase:timeCalendarModel ?sc ] .
  OPTIONAL {{ ?st pq:P582 ?e }}
  ?person wikibase:sitelinks ?sl . FILTER(?sl >= 2) }}'''
        for r in sparql(q):
            terms.append({'p': qid(r['person']), 'pos': qid(r['pos']), 's': r['s'], 'sp': int(r['sp']),
                          'sc': qid(r['sc']), 'e': r.get('e'), 'sl': int(r['sl'])})
    need = sorted({t['p'] for t in terms} | set(positions))
    labels = {}
    for i in range(0, len(need), 400):
        v = ' '.join('wd:' + x for x in need[i:i + 400])
        for r in sparql(f'''SELECT ?x ?l ?m ?w WHERE {{ VALUES ?x {{ {v} }}
  OPTIONAL {{ ?x rdfs:label ?l FILTER(LANG(?l) = "en") }} OPTIONAL {{ ?x rdfs:label ?m FILTER(LANG(?m) = "mul") }}
  OPTIONAL {{ ?a schema:about ?x; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?w }} }}'''):
            name = r.get('l') or r.get('m') or r.get('w')
            if name:
                labels.setdefault(qid(r['x']), [name, r.get('w')])
    for p in cfg['positions']:
        labels.setdefault(p['q'], [p['label'], None])
    write_json(os.path.join(CACHE, 'rulers_extra.json'), {'terms': terms, 'labels': labels})
    log(f'ruler positions without a country: {len(positions)} offices, {len(terms)} terms')


def person_years(titles):
    """{title: {q, starts, ends, death}} from the Wikidata item of each English Wikipedia title."""
    out = {}
    titles = sorted(set(titles))
    for i in range(0, len(titles), 40):
        vals = ' '.join(f'"{esc(t)}"@en' for t in titles[i:i + 40])
        rows = sparql(f'''SELECT ?t ?item ?s ?e ?d WHERE {{ VALUES ?t {{ {vals} }}
  ?a schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?t .
  OPTIONAL {{ ?item wdt:P570 ?d }}
  OPTIONAL {{ ?item p:P39 ?st . OPTIONAL {{ ?st pq:P580 ?s }} OPTIONAL {{ ?st pq:P582 ?e }} }} }}''')
        for r in rows:
            e = out.setdefault(r['t'], {'q': qid(r['item']), 'starts': set(), 'ends': set(), 'death': set()})
            for f, k in (('s', 'starts'), ('e', 'ends'), ('d', 'death')):
                v = r.get(f)
                if v and v[:1] in '-0123456789':
                    try:
                        e[k].add(_hist(v))
                    except ValueError:
                        pass
    return out


def check_curated():
    doc = read_json(os.path.join(TOOLS, 'curated', 'rulers.json'))
    titles = [(r[3] if len(r) > 3 else r[0]) for l in doc['lists'] for r in l['rulers']]
    wd = person_years(titles)
    out = []
    n = n_ok = 0
    for l in doc['lists']:
        slack = 5 if l.get('approx') else 1
        rows = []
        prev = None
        for r in l['rulers']:
            name, a, b = r[0], r[1], r[2]
            title = r[3] if len(r) > 3 else name
            info = wd.get(title)
            near = lambda ys, y: any(abs(v - y) <= slack for v in ys)
            if not info:
                ok, note = False, 'no Wikidata item for the linked article'
            else:
                s_ok = near(info['starts'], a) or bool(prev and prev[1] == a and near(prev[0]['death'], a))
                e_ok = near(info['ends'], b) or near(info['death'], b)
                ok = s_ok and e_ok
                note = ('both years match Wikidata ' + info['q']) if ok else \
                    f"Wikidata {info['q']}: first year {'confirmed' if s_ok else 'not confirmed'}, last year {'confirmed' if e_ok else 'not confirmed'}"
            rows.append({'name': name, 'from': a, 'to': b, 'wiki': title, 'q': info['q'] if info else None, 'verified': ok, 'check': note})
            n += 1
            n_ok += ok
            prev = (info, b) if info else None
            if not ok:
                log(f'  unverified: {name} {a} to {b}: {note}')
        out.append({'polities': l['polities'], 'title': l['title'], 'source': l['source'], 'approx': bool(l.get('approx')), 'rulers': rows})
    write_json(os.path.join(CACHE, 'curated_rulers.json'), {'lists': out, 'rows': n, 'verified': n_ok})
    log(f'curated rulers: {n} rows in {len(out)} lists, {n_ok} verified against Wikidata')


def main():
    fetch_positions(read_json(os.path.join(TOOLS, 'curated', 'ruler_map.json')))
    check_curated()


if __name__ == '__main__':
    main()
