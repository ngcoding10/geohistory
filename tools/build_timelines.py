"""Step 5: one lazy-loaded timeline per territory name and per modern country -> data/timelines/

Each file: names it was shown under and who ruled it (from the border maps), heads of state/government
when the territory links to a Wikidata jurisdiction, wars it took part in, and its events by year
(compact: id, year, label, type, block file), so the panel can always show the nearest years with entries.
data/timelines/index.json maps a name or "iso:XX" to its file.
"""
import glob
import hashlib
import json
import os
import re
from collections import defaultdict

from common import DATA, CACHE, read_json, write_json, log


def slug(name):
    s = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')[:40] or 'x'
    return f'{s}-{hashlib.sha1(name.encode()).hexdigest()[:6]}'


def main():
    ruled = read_json(os.path.join(DATA, 'history', 'ruledby.json'))
    ents = read_json(os.path.join(DATA, 'entities.json'))
    terms_path = os.path.join(DATA, 'rulers', 'terms.json')
    terms = read_json(terms_path) if os.path.exists(terms_path) else {}
    search = read_json(os.path.join(DATA, 'search.json'))
    modern = {m[1]: m[0] for m in search['modern']}

    by_p, by_mc = defaultdict(list), defaultdict(list)
    for f in glob.glob(os.path.join(DATA, 'events', '*_*.json')):
        fname = os.path.basename(f)
        for e in read_json(f)['events']:
            if e['t'] in ('birth', 'death'):
                continue
            row = [e['i'], e['y'], e['l'], e['t'], fname]
            if e.get('p'):
                by_p[e['p']].append(row)
            if e.get('mc'):
                by_mc[e['mc']].append(row)

    out = os.path.join(DATA, 'timelines')
    os.makedirs(out, exist_ok=True)
    for f in glob.glob(os.path.join(out, '*.json')):
        os.remove(f)
    index = {}
    total = 0

    def write(key, name, rows, q=None, ruled_runs=None):
        nonlocal total
        rows = sorted(rows, key=lambda r: (r[1], r[2]))
        doc = {'name': name, 'ruledBy': ruled_runs or [], 'events': rows,
               'wars': [r for r in rows if r[3] == 'war'][:80]}
        if q and q in terms:
            doc['rulers'] = terms[q]['terms']
            doc['rulersOf'] = terms[q]['n']
        if not rows and not doc.get('rulers') and not doc['ruledBy']:
            return
        f = slug(key) + '.json'
        total += write_json(os.path.join(out, f), doc)
        index[key] = f

    for name, runs in ruled.items():
        q = ents.get(name, {}).get('q')
        write(name, name, by_p.get(name, []), q, runs)
    # today's countries: Wikidata QID for rulers comes from the ISO code
    iso_q = read_json(os.path.join(CACHE, 'iso_q.json'))
    for iso, name in modern.items():
        q = iso_q.get(iso) or ents.get(name, {}).get('q')
        write('iso:' + iso, name, by_mc.get(iso, []), q)
    write_json(os.path.join(out, 'index.json'), index)
    log(f'timelines: {len(index)} files, {total // 1024} KB')


if __name__ == '__main__':
    main()
