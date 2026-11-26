"""Accuracy audit: check hand-written well-known facts (tools/audit/facts.txt) against the built data,
plus sanity checks. Prints pass/fail per fact and totals; writes data/audit.json.
"""
import datetime
import glob
import json
import os
import re
import sys
from collections import defaultdict

from common import DATA, TOOLS, read_json, write_json
from geo import PolyIndex


def norm(s):
    return re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()


def main():
    events = [e for f in glob.glob(os.path.join(DATA, 'events', '*_*.json')) for e in read_json(f)['events']]
    by_name = defaultdict(list)
    for e in events:
        by_name[norm(e['l'])].append(e)
        if e.get('w'):
            by_name[norm(e['w'])].append(e)
    bindex = read_json(os.path.join(DATA, 'borders', 'index.json'))['snapshots']
    cs = read_json(os.path.join(DATA, 'cshapes', 'index.json'))
    import build_cshapes

    def territory(lon, lat, y):
        if cs['from'] <= y <= cs['to']:
            pols = build_cshapes.year_doc(y)
            k = PolyIndex([(i, p['g']) for i, p in enumerate(pols)]).lookup(lon, lat)
            return None if k is None else f"{pols[k]['n']} | {pols[k]['s'] or ''}"
        snap = max(s['y'] for s in bindex if s['y'] <= y)
        doc = read_json(os.path.join(DATA, 'borders', f'{snap}.json'))
        k = PolyIndex([(f['properties']['k'], f['geometry']) for f in doc['features'] if f['properties']['k'] >= 0]).lookup(lon, lat)
        if k is None:
            return None
        p = doc['polities'][k]
        return f"{p['n']} | {p.get('s', '')}"

    results = []
    for line in open(os.path.join(TOOLS, 'audit', 'facts.txt'), encoding='utf-8'):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        kind, *a = line.split('|')
        if kind == 'E':
            name, y = a[0], int(a[1])
            key = norm(name)
            cands = by_name.get(key, []) + [e for k2, lst in by_name.items() if k2.startswith(key + ' ') and k2[len(key) + 1:].isdigit() for e in lst]
            ok = any(e['y'] == y or (e.get('y2') and e['y'] <= y <= e['y2']) for e in cands)
            got = sorted({e['y'] for e in cands})[:4] if cands else 'not found'
        elif kind == 'R':
            name, y = a[0], int(a[1])
            nm = norm(name)
            def person(e):
                return norm(e['l'].split(' becomes ')[0])
            # "Elizabeth I" matches "Elizabeth I of England"; "Queen Victoria" matches "Victoria"
            cands = [e for e in events if e['t'] == 'ruler' and ' becomes ' in e['l'] and
                     (person(e) == nm or person(e).startswith(nm + ' of ') or nm.endswith(' ' + person(e)))]
            ok = any(abs(e['y'] - y) <= 1 for e in cands)
            got = sorted({e['y'] for e in cands})[:6] if cands else 'not found'
        else:
            lon, lat, y, text = float(a[0]), float(a[1]), int(a[2]), a[3]
            t = territory(lon, lat, y)
            ok = bool(t) and text.lower() in t.lower()
            got = t or 'no territory'
        results.append({'fact': line, 'ok': ok, 'got': str(got)})
        print(('PASS ' if ok else 'FAIL ') + line + ('' if ok else f'   (data: {got})'))

    # sanity checks
    sanity = {}
    wars = {e['l']: e for e in events if e['t'] == 'war' and e.get('y2')}
    sanity['eventsOutsideTheirWar'] = sum(1 for e in events if e.get('po') in wars and not (wars[e['po']]['y'] - 1 <= e['y'] <= wars[e['po']]['y2'] + 1))
    sanity['termsEndingBeforeStart'] = 0
    tp = os.path.join(DATA, 'rulers', 'terms.json')
    if os.path.exists(tp):
        sanity['termsEndingBeforeStart'] = sum(1 for j in read_json(tp).values() for t in j['terms'] if t[2] is not None and t[2] < t[1])
    ents = read_json(os.path.join(DATA, 'entities.json'))
    early = 0
    for s in bindex:
        for p in read_json(os.path.join(DATA, 'borders', f"{s['y']}.json"))['polities']:
            f = ents.get(p['n'], {}).get('from')
            if f is not None and s['y'] < f - 50:
                early += 1
    sanity['territoriesShownOver50YearsBeforeWikidataFounding'] = early
    seen = defaultdict(set)
    for e in events:
        seen[(norm(e['l']), e['y'])].add(e['i'])
    sanity['duplicateNameYearPairs'] = sum(1 for v in seen.values() if len(v) > 1)

    n_ok = sum(r['ok'] for r in results)
    out = {'date': datetime.date.today().isoformat(), 'facts': len(results), 'passed': n_ok,
           'rate': round(n_ok / len(results), 3), 'sanity': sanity, 'results': results}
    write_json(os.path.join(DATA, 'audit.json'), out, pretty=False)
    print(f'\n{n_ok}/{len(results)} facts pass ({out["rate"]:.1%}); sanity: {sanity}')


if __name__ == '__main__':
    main()
