"""Occupations: data/occupations.json from tools/curated/occupations.json.

Checks every row against the yearly maps (the named territory must be on the CShapes map in those years, or
the row must name an older CShapes outline to draw instead), resolves those outlines to a shape file and id,
and compares the years with the Wikidata item of the article the row cites (start and end time, or inception
and dissolution): "verified" when both years agree.
"""
import os
import re

from common import DATA, TOOLS, read_json, write_json, sparql, qid, log
from link_wikidata import year_of
from build_empires import titles_to_q


def main():
    path = os.path.join(TOOLS, 'curated', 'occupations.json')
    cur = read_json(path)
    idx = read_json(os.path.join(DATA, 'cshapes', 'index.json'))
    names = {}
    for y in range(idx['from'], idx['to'] + 1):
        names[y] = {r[1] for r in read_json(os.path.join(DATA, 'cshapes', 'years', f'{y}.json'))['rows']}
    shapes = {}
    for c in idx['chunks']:
        for sid, s in read_json(os.path.join(DATA, 'cshapes', c['f'])).items():
            shapes.setdefault(s['cs'], []).append((s['s'], s['e'], c['f'], int(sid)))
    titles = [re.sub('_', ' ', r['source'].rsplit('/wiki/', 1)[-1]) for r in cur['rows']]
    dates = {}
    try:
        t2q = titles_to_q(titles)
        qs = sorted(set(t2q.values()))
        for i in range(0, len(qs), 100):
            vals = ' '.join('wd:' + q for q in qs[i:i + 100])
            for r in sparql('SELECT ?x ?a ?b WHERE { VALUES ?x { %s } OPTIONAL { ?x wdt:P580|wdt:P571 ?a } OPTIONAL { ?x wdt:P582|wdt:P576 ?b } }' % vals):
                d = dates.setdefault(qid(r['x']), [set(), set()])
                if r.get('a'):
                    d[0].add(year_of(r['a']))
                if r.get('b'):
                    d[1].add(year_of(r['b']))
    except Exception as ex:
        log('  Wikidata not reachable, occupations stay unverified:', ex)
        t2q = {}
    out = []
    missing = []
    for r, t in zip(cur['rows'], titles):
        d = dates.get(t2q.get(t))
        r['verified'] = bool(d and r['from'] // 10000 in d[0] and r['to'] // 10000 in d[1])
        ya, yb = max(r['from'] // 10000, idx['from']), min(r['to'] // 10000, idx['to'])
        on_map = sorted({n for y in range(ya, yb + 1) for n in r['names'] if n in names[y]})
        row = {'label': r['label'], 'n': on_map, 'by': r['by'], 'key': r['key'], 'from': r['from'], 'to': r['to'], 'kind': r['kind'],
               'note': r['note'], 'src': r['source'], 'v': r['verified']}
        if r.get('shape'):
            hit = [s for s in shapes.get(r['shape']['cs'], []) if s[0] <= r['shape']['date'] <= s[1]]
            if hit:
                row['shape'] = {'f': hit[0][2], 'id': hit[0][3]}
        if not on_map and 'shape' not in row:
            missing.append(r['label'])
            continue
        out.append(row)
    write_json(path, cur, pretty=True)
    write_json(os.path.join(DATA, 'occupations.json'), {'rows': out})
    log(f'occupations: {len(out)} rows on the maps ({sum(r["v"] for r in out)} verified); not on any map and left out: {missing}')


if __name__ == '__main__':
    main()
