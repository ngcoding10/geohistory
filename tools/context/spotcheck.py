"""Random samples of the context for checking by hand against Wikipedia: for each field, 50 slices (seeded),
each with the value shown and the sentences of the state's English Wikipedia article (from the dump
extract) that bear on it. Usage: spotcheck.py field [n] [seed]  (field: gov, party, rel, pop, mov)"""
import json
import os
import random
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA, read_json  # noqa: E402
from writeup_prep import article, index  # noqa: E402

KEYS = {'gov': r'monarch|republic|dictator|kingdom|empire|sultanat|caliphat|one-party|democra|federa|theocra|junta|parliament|constitution',
        'party': None, 'rel': r'religio|islam|muslim|christian|catholic|orthodox|protestant|lutheran|buddhis|hindu|jew|pagan|zoroastr|shinto|confuci|athei',
        'pop': r'population|inhabitants|people|census|million',
        'mov': None}


def sentences(text):
    return re.split(r'(?<=[.!?])\s+', text)


def main():
    field = sys.argv[1]
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 50
    seed = int(sys.argv[3]) if len(sys.argv) > 3 else 9
    idx = read_json(os.path.join(DATA, 'context', 'index.json'))
    ents = read_json(os.path.join(DATA, 'entities.json'))
    pool = []
    for name, f in idx.items():
        doc = read_json(os.path.join(DATA, 'context', f))
        for p in doc['periods']:
            v = {'gov': p.get('gov'), 'party': p.get('party'), 'rel': p.get('rel'), 'pop': p.get('pop'), 'mov': p.get('mov')}[field]
            if v:
                pool.append((name, p, v))
    random.seed(seed)
    sample = random.sample(pool, min(n, len(pool)))
    aidx = index()
    for k, (name, p, v) in enumerate(sample, 1):
        w = (ents.get(name) or {}).get('w')
        if p.get('regime'):
            w = p['regime'][0]
        a = article(w, aidx) if w else None
        text = ' '.join(t for _, _, t in a['sec'][:6]) if a else ''
        if field == 'gov':
            show = '; '.join(v)
        elif field == 'party':
            show = f'{v[0]} ({v[2]}, {v[3]})'
        elif field == 'rel':
            show = '; '.join(f'{r[0]} [{r[1]}]' for r in v)
        elif field == 'pop':
            show = '; '.join(f'{r[0]}: {r[1]:,} ({r[2]:,}-{r[3]:,}) {"+".join(s.split(" (")[0] for s in r[4])}' for r in v[:2])
        else:
            show = '; '.join(f'{m[0]} {m[1]}-{m[2]} [{m[5]}]' for m in v[:4])
        print(f'#{k} {name} {p["from"]}..{p["to"]}: {show}   [article: {w or "-"}{"" if a else ", not in dump"}]')
        if field in ('party', 'mov'):
            words = [v[0]] if field == 'party' else [m[0] for m in v[:4]]
            ev = [s for s in sentences(text) if any(re.search(re.escape(x.split(' (')[0][:25]), s, re.I) for x in words)]
        else:
            ev = [s for s in sentences(text) if re.search(KEYS[field], s, re.I)]
        for s in ev[:3]:
            print('    - ' + s[:260])


if __name__ == '__main__':
    main()
