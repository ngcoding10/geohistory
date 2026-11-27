"""Put the placed discoveries and inventions (data/context/discoveries.json) into the event files as the event
type 'invention', run after build_events.py and before build_timelines.py (tools/build_all.sh).

An event that is the same Wikidata item (the Telephone of 1876) becomes an 'invention' event and gets the
place, state and power the discovery was placed on, unless it already has coordinates of its own. A
discovery without such an event is added, with its year, place and state. A discovery with no state is not
drawn on the map (it keeps its place in the context panel only if it has one).
"""
import glob
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from common import DATA, log, read_json, write_json  # noqa: E402


def main():
    d = read_json(os.path.join(DATA, 'context', 'discoveries.json'))
    F = d['fields']
    items = [dict(zip(F, r)) for r in d['items']]
    idx = read_json(os.path.join(DATA, 'events', 'index.json'))
    blocks = idx['blocks']
    docs = {b['f']: read_json(os.path.join(DATA, 'events', b['f'])) for b in blocks}
    by_id = {}
    for f, doc in docs.items():
        for e in doc['events']:
            by_id.setdefault(e['i'], []).append(e)
    changed = added = 0
    for x in items:
        if not x['p']:
            continue
        qid = x['id'] if str(x['id']).startswith('Q') else None
        hits = by_id.get(qid, []) if qid else []
        if not hits:
            # the same thing already among the events under its own name in the same year
            n = re.sub(r'[^a-z0-9]+', ' ', x['l'].lower()).strip()
            n0 = re.sub(r'\s*\(.*?\)', '', x['l']).lower().strip()
            hits = [e for es in by_id.values() for e in es if abs(e['y'] - x['y']) <= 1 and e['t'] in ('discovery', 'invention', 'other', 'culture')
                    and re.sub(r'[^a-z0-9]+', ' ', e['l'].lower()).strip() in (n, re.sub(r'[^a-z0-9]+', ' ', n0).strip())]
        if not hits and x.get('w'):
            hits = [e for es in by_id.values() for e in es if e.get('w') == x['w'] and abs(e['y'] - x['y']) <= 1] if x['id'].startswith('c:') else []
        if hits:
            for e in hits:
                e['t'] = 'invention'
                if e.get('lo') is None and x['lo'] is not None:
                    e['lo'], e['la'] = x['lo'], x['la']
                if not e.get('p') or e.get('lo') is None or x['lo'] is not None:
                    e['p'], e['pw'] = x['p'], x['pw']
                if x.get('who') and not e.get('who'):
                    e['who'] = x['who']
                e['iv'] = x['how']
                if str(x['id']).startswith('c:'):
                    e['vt'], e['vs'] = x['text'], x['src']     # GeoHistory's curated text (AI-written) and its source
                    if x.get('note'):
                        e['vn'] = x['note']
            changed += 1
            continue
        b = next((b for b in blocks if b['a'] <= x['y'] < b['b']), None)
        if not b or ('v' + str(x['id']).replace('c:', '')) in by_id:
            continue      # outside the event years, or added by an earlier run
        ev = {'i': 'v' + str(x['id']).replace('c:', ''), 'l': x['l'], 'y': x['y'], 't': 'invention',
              's': max(3, (x['sl'] or 60) // 3), 'p': x['p'], 'pw': x['pw'], 'iv': x['how']}
        for k_src, k in (('lo', 'lo'), ('la', 'la'), ('w', 'w'), ('who', 'who'), ('text', 'd')):
            if x.get(k_src) is not None:
                ev[k] = x[k_src]
        if x.get('approx'):
            ev['ya'] = 1
        if str(x['id']).startswith('c:'):
            ev['vt'], ev['vs'] = x['text'], x['src']
            if x.get('note'):
                ev['vn'] = x['note']
        docs[b['f']]['events'].append(ev)
        b['n'] = b.get('n', 0) + 1
        k = str(x['y'])
        idx['counts'][k] = idx['counts'].get(k, 0) + 1
        added += 1
    for f, doc in docs.items():
        write_json(os.path.join(DATA, 'events', f), doc)
    write_json(os.path.join(DATA, 'events', 'index.json'), idx)
    log(f'inventions on the map: {changed} events marked, {added} added')


if __name__ == '__main__':
    main()
