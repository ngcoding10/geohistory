"""Ruler coverage review. The most significant states on the maps (years on the Cliopatria and CShapes
maps x Wikipedia editions of the linked Wikidata item) and, for each, the share of its map years in which
data/rulers/terms.json names a ruler.

Usage: python3 ruler_coverage.py [N] [terms.json to compare against]
Prints the table and writes data/rulers/coverage.json (with "before" when a second file is given)."""
import json
import os
import sys

from common import sparql, qid, CACHE, DATA, read_json, write_json


def sitelinks(qs):
    out = {}
    qs = sorted(qs, key=lambda q: int(q[1:]))
    for i in range(0, len(qs), 300):
        vals = ' '.join('wd:' + q for q in qs[i:i + 300])
        for r in sparql(f'SELECT ?x ?sl WHERE {{ VALUES ?x {{ {vals} }} ?x wikibase:sitelinks ?sl }}'):
            out[qid(r['x'])] = int(r['sl'])
    return out


def state_years():
    """{name: set of years} for states on the yearly maps (not the sketch-map underlay)."""
    out = {}
    clio = read_json(os.path.join(DATA, 'clio', 'index.json'))
    ys = clio['years']
    for i, y in enumerate(ys):
        end = ys[i + 1] - 1 if i + 1 < len(ys) else clio['to']
        for r in read_json(os.path.join(DATA, 'clio', 'years', f'{y}.json'))['rows']:
            if len(r) < 5:
                out.setdefault(r[1], set()).update(v for v in range(y, end + 1) if v != 0)
    cs = read_json(os.path.join(DATA, 'cshapes', 'index.json'))
    for y in range(cs['from'], cs['to'] + 1):
        for r in read_json(os.path.join(DATA, 'cshapes', 'years', f'{y}.json'))['rows']:
            if not r[3]:      # independent states only
                out.setdefault(r[1], set()).add(y)
    return out


def covered(terms, key, years):
    got = set()
    for t in terms.get(key, {}).get('terms', []):
        a = t[1]
        b = t[2] if t[2] is not None else (2025 if a >= 1990 else a)
        got.update(range(a, b + 1))
    return len(got & years) / len(years)


def table(n=150, before=None):
    ents = read_json(os.path.join(DATA, 'entities.json'))
    terms = read_json(os.path.join(DATA, 'rulers', 'terms.json'))
    years = state_years()
    sl = sitelinks({ents[nm]['q'] for nm in years if nm in ents})
    rows = []
    for nm, ys in years.items():
        if nm not in ents:
            continue
        q = ents[nm]['q']
        rows.append({'name': nm, 'q': q, 'from': min(ys), 'to': max(ys), 'years': len(ys), 'sl': sl.get(q, 0), 'score': len(ys) * sl.get(q, 0)})
    rows.sort(key=lambda p: -p['score'])
    rows = rows[:n]
    for p in rows:
        ys = years[p['name']]
        p['cov'] = round(covered(terms, p['q'], ys), 3)
        if before is not None:
            p['before'] = round(covered(before, p['q'], ys), 3)
    return rows


if __name__ == '__main__':
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 150
    before = read_json(sys.argv[2]) if len(sys.argv) > 2 else None
    rows = table(n, before)
    write_json(os.path.join(DATA, 'rulers', 'coverage.json'), rows)
    for i, p in enumerate(rows):
        b = f"{p['before']:4.0%} -> " if 'before' in p else ''
        print(f"{i + 1:3} {p['name'][:40]:40} {p['from']:6} {p['to']:5} years={p['years']:4} sl={p['sl']:3}  {b}{p['cov']:4.0%}")
    if before is not None:
        print('mean coverage before', round(sum(p['before'] for p in rows) / len(rows), 3), 'states with any ruler before', sum(1 for p in rows if p['before'] > 0))
    print('mean coverage', round(sum(p['cov'] for p in rows) / len(rows), 3), 'states with any ruler', sum(1 for p in rows if p['cov'] > 0))
