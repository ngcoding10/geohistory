"""Accuracy audit: check hand-written well-known facts (tools/audit/facts.txt) against the built data,
plus sanity checks. Prints pass/fail per fact and totals; writes data/audit.json.
"""
import datetime
import glob
import json
import os
import re
import sys
import unicodedata
from collections import defaultdict

from common import DATA, TOOLS, read_json, write_json
from geo import PolyIndex, near_index
from names import aliases


def norm(s):
    return re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()


def main():
    events = [e for f in glob.glob(os.path.join(DATA, 'events', '*_*.json')) for e in read_json(f)['events']]
    by_name = defaultdict(list)
    for e in events:
        by_name[norm(e['l'])].append(e)
        if e.get('w'):
            by_name[norm(e['w'])].append(e)
        for al in e.get('al', []):   # English "also known as" names from Wikidata
            by_name[norm(al)].append(e)
    tcache = {}
    bindex = read_json(os.path.join(DATA, 'borders', 'index.json'))['snapshots']
    cs = read_json(os.path.join(DATA, 'cshapes', 'index.json'))
    import yearly

    NEAR_KM = 8.0   # coastal cities: outlines are simplified by about 3 km and rounded to 1 km

    def territory(lon, lat, y):
        """(name, ruler) of the territory at a point; a state within NEAR_KM wins over open sea."""
        if yearly.source(y):
            key = yearly.map_key(y)
            if key not in tcache:
                pols = yearly.year_doc(y)
                tcache[key] = (PolyIndex([(i, p['g']) for i, p in enumerate(pols)]), pols)
            pi, pols = tcache[key]
            k = pi.lookup(lon, lat)
            if k is None or pols[k].get('u'):
                # not inside a state: a state whose outline passes within a few km, else the sketch-map row
                k2 = near_index(pi, lon, lat, NEAR_KM, accept=lambda i: not pols[i].get('u'))
                k = k2 if k2 is not None else (k if k is not None else near_index(pi, lon, lat, NEAR_KM))
            return None if k is None else (pols[k]['n'], pols[k]['s'] or '')
        snap = max(s['y'] for s in bindex if s['y'] <= y)
        if snap not in tcache:
            doc = read_json(os.path.join(DATA, 'borders', f'{snap}.json'))
            tcache[snap] = (PolyIndex([(f['properties']['k'], f['geometry']) for f in doc['features'] if f['properties']['k'] >= 0]), doc['polities'])
        pi, pols = tcache[snap]
        k = near_index(pi, lon, lat, NEAR_KM)
        if k is None:
            return None
        return (pols[k]['n'], pols[k].get('s', ''))

    def fold(t):
        t = t.replace('đ', 'd').replace('Đ', 'D').replace('ʻ', '').replace("'", '').replace('’', '')
        return ''.join(c for c in unicodedata.normalize('NFKD', t) if not unicodedata.combining(c)).lower()

    results = []
    for line in open(os.path.join(TOOLS, 'audit', 'facts.txt'), encoding='utf-8'):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        kind, *a = line.split('|')
        if kind == 'T':
            y, text = int(a[0]), a[1]
            lst = sorted((e for e in events if e['y'] == y and e['t'] not in ('birth', 'death')), key=lambda e: (-e['s'], e.get('m') or 13))[:5]
            ok = any(text.lower() in ' | '.join([e['l'], e.get('w') or ''] + e.get('al', [])).lower() for e in lst)   # name, article title, aliases
            got = [e['l'][:40] for e in lst]
        elif kind == 'E':
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
            # the name, its ruler and their aliases (tools/curated/names.json); ";" separates spellings
            hay = fold(' | '.join([x for n in t for x in [n] + aliases(n)])) if t else ''
            ok = bool(t) and any(fold(alt.strip()) in hay for alt in text.split(';'))
            got = f'{t[0]} | {t[1]}' if t else 'no territory'
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
