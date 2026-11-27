"""Which states the context is written for, and where they are on the map in each year.

Reads the yearly maps (Cliopatria 3400 BC-1885, stored at change years; CShapes 1886-2019) and lists every
state row (not the pale sketch-map peoples): its name (the app's identity, as in data/timelines/index.json),
its power key, its shapes, and the years each map is shown. Adds the Wikidata items from data/entities.json
(the state's own item and the earlier eras Wikidata gives under the same name).

Writes tools/cache/context/states.json:
  {"maps": [[from, to, src, key]],                 one entry per stored map, with the years it is shown
   "states": {name: {"q": QID, "eras": [...], "maps": [[map index, [shape ids], power, ruler]], "first", "last"}},
   "powers": {power key: [[map index, [names]]]}}
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from common import CACHE, DATA, read_json, write_json, log  # noqa: E402

OUT = os.path.join(CACHE, 'context')


def maps():
    """[(from, to, src, key, rows)] for every stored map; rows = [(shape id, name, power, ruler)]."""
    out = []
    ci = read_json(os.path.join(DATA, 'clio', 'index.json'))
    ys = ci['years']
    for i, y in enumerate(ys):
        nxt = ys[i + 1] - 1 if i + 1 < len(ys) else ci['to']
        rows = read_json(os.path.join(DATA, 'clio', 'years', f'{y}.json'))['rows']
        out.append((y, nxt, 'clio', y, [(r[0], r[1], r[2], r[3]) for r in rows if len(r) < 5]))
    cs = read_json(os.path.join(DATA, 'cshapes', 'index.json'))
    for y in range(cs['from'], cs['to'] + 1):
        rows = read_json(os.path.join(DATA, 'cshapes', 'years', f'{y}.json'))['rows']
        out.append((y, y, 'cshapes', y, [(r[0], r[1], r[2], r[3]) for r in rows]))
    return out


def main():
    ms = maps()
    ents = read_json(os.path.join(DATA, 'entities.json'))
    states, powers = {}, {}
    for mi, (a, b, src, key, rows) in enumerate(ms):
        by = {}
        for sid, name, pk, ruler in rows:
            by.setdefault(name, [[], pk, ruler])[0].append(sid)
            powers.setdefault(pk, {}).setdefault(mi, set()).add(name)
        for name, (sids, pk, ruler) in by.items():
            st = states.setdefault(name, {'maps': [], 'first': a, 'last': b})
            st['maps'].append([mi, sids, pk, ruler])
            st['first'], st['last'] = min(st['first'], a), max(st['last'], b)
    for name, st in states.items():
        e = ents.get(name) or {}
        if e.get('q'):
            st['q'] = e['q']
            for k in ('from', 'to', 'mod', 'w', 'd'):
                if e.get(k) is not None:
                    st[k] = e[k]
            if e.get('eras'):
                st['eras'] = e['eras']
    doc = {'maps': [[a, b, src, key] for a, b, src, key, _ in ms], 'states': states,
           'powers': {pk: [[mi, sorted(ns)] for mi, ns in sorted(v.items())] for pk, v in powers.items()}}
    write_json(os.path.join(OUT, 'states.json'), doc)
    log(f'{len(ms)} maps, {len(states)} states ({sum(1 for s in states.values() if s.get("q"))} with a Wikidata item), {len(powers)} powers')


if __name__ == '__main__':
    main()
