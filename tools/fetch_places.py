"""Step 1i: where things were, for events that Wikidata gives no coordinates -> tools/cache/places_raw.json

A fifth of the events could not be put in a modern country. Three more ways to place them, in order:
  1. states and offices: the coordinates of the state itself, else of its capital (a "Kingdom of Kongo
     founded" or "X becomes King of Kongo" event belongs where Kongo was);
  2. events: the country or coordinates of their location or administrative unit (P276, P131);
  3. events whose only country is a former state: that state's coordinates or capital. Only used for
     domestic kinds of event (politics, revolts, disasters...), never for battles or wars, which are
     often fought abroad.
build_events.py adds a last fallback itself: the placement of the parent event ("part of").
"""
import json
import os
import re

from common import sparql, qid, log, CACHE


def entity_points(ids):
    out = {}
    ids = sorted((q for q in ids if q and re.match(r'^Q\d+$', q)), key=lambda q: int(q[1:]))
    for i in range(0, len(ids), 200):
        v = ' '.join('wd:' + x for x in ids[i:i + 200])
        try:
            rows = sparql(f'''SELECT ?x ?c ?cc ?iso WHERE {{ VALUES ?x {{ {v} }}
  OPTIONAL {{ ?x wdt:P625 ?c }} OPTIONAL {{ ?x wdt:P36 ?cap . ?cap wdt:P625 ?cc }} OPTIONAL {{ ?x wdt:P297 ?iso }} }}''')
        except Exception as e:
            log(f'  entity batch {i} failed: {e}')
            continue
        for r in rows:
            e = out.setdefault(qid(r['x']), {})
            if r.get('iso'):
                e['iso'] = r['iso']
            if r.get('c') and 'pt' not in e:
                e['pt'] = r['c']
            if r.get('cc') and 'cap' not in e:
                e['cap'] = r['cc']
        if i % 4000 == 0:
            log(f'  entity points {i}/{len(ids)}')
    return {k: v for k, v in out.items() if v}


def event_locations(ids):
    out = {}
    ids = sorted((q for q in ids if q and re.match(r'^Q\d+$', q)), key=lambda q: int(q[1:]))
    for i in range(0, len(ids), 200):
        v = ' '.join('wd:' + x for x in ids[i:i + 200])
        try:
            rows = sparql(f'''SELECT ?x ?l ?iso ?lc ?kind WHERE {{ VALUES ?x {{ {v} }}
  {{ ?x wdt:P276 ?l BIND("loc" AS ?kind) }} UNION {{ ?x wdt:P131 ?l BIND("loc" AS ?kind) }} UNION {{ ?x wdt:P17 ?l BIND("country" AS ?kind) }}
  OPTIONAL {{ ?l wdt:P297 ?iso0 }} OPTIONAL {{ ?l wdt:P17 ?lcn . ?lcn wdt:P297 ?iso1 }} BIND(COALESCE(?iso0, ?iso1) AS ?iso)
  OPTIONAL {{ ?l wdt:P625 ?lc }} }}''')
        except Exception as e:
            log(f'  location batch {i} failed: {e}')
            continue
        for r in rows:
            out.setdefault(qid(r['x']), []).append([r['kind'], qid(r['l']), r.get('iso'), r.get('lc')])
        if i % 4000 == 0:
            log(f'  event locations {i}/{len(ids)}')
    return out


def main():
    def load(n):
        p = os.path.join(CACHE, n)
        return json.load(open(p)) if os.path.exists(p) else {}
    raw, extra, fam, reg, rul = (load(n) for n in ('events_raw.json', 'extra_raw.json', 'famous_raw.json',
                                                    'regions_raw.json', 'rulers_raw.json'))
    det = dict(raw.get('details', {}))
    for d in (extra, fam, reg):
        det.update(d.get('details', {}))
    ents = {qid(r['item']) for r in raw.get('polity_changes', []) + reg.get('polity_changes', [])}
    ents |= set(rul.get('pos_j', {}).values())
    positions = {qid(r['pos']) for r in raw.get('monarchs', [])} | {t['pos'] for t in fam.get('terms', [])}
    pos_j = {}
    pl = sorted(positions)
    for i in range(0, len(pl), 300):
        v = ' '.join('wd:' + x for x in pl[i:i + 300])
        try:
            for r in sparql(f'SELECT ?p ?j WHERE {{ VALUES ?p {{ {v} }} {{ ?p wdt:P1001 ?j }} UNION {{ ?p wdt:P17 ?j }} }}'):
                pos_j.setdefault(qid(r['p']), qid(r['j']))
        except Exception as e:
            log(f'  position batch failed: {e}')
    ents |= set(pos_j.values())
    events = set(raw.get('kept', {})) | set(extra.get('deep', {})) | set(fam.get('items', {})) | set(reg.get('kept', {})) | set(reg.get('cultures', {}))
    noco = {k for k in events if k in det and not det[k].get('coord')}
    log(f'{len(noco)} events without coordinates of {len(events)}; {len(ents)} states and jurisdictions')
    locs = event_locations(noco)
    ents |= {l[1] for ls in locs.values() for l in ls if l[0] == 'country' and not l[2]}
    pts = entity_points(ents)
    with open(os.path.join(CACHE, 'places_raw.json'), 'w') as f:
        json.dump({'points': pts, 'locations': locs, 'pos_j': pos_j}, f)
    log(f'wrote places_raw.json: {len(pts)} entity points, {len(locs)} events with a location chain')


if __name__ == '__main__':
    main()
