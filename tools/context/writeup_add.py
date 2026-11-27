"""Add write-ups (a JSON object {event id: entry}) read from stdin to a batch file of
tools/curated/writeups/t1/, checking the entry against the event record and the claim numbering."""
import glob
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from common import DATA, TOOLS, read_json  # noqa: E402

D = os.path.join(TOOLS, 'curated', 'writeups', 't1')


def main():
    new = json.load(sys.stdin)
    ev = {}
    for f in glob.glob(os.path.join(DATA, 'events', '*_*.json')):
        for e in read_json(f)['events']:
            if e['i'] in new:
                ev[e['i']] = e
    for i, w in new.items():
        e = ev.get(i)
        assert e, f'{i}: not an event'
        assert w['y'] == e['y'], f'{i}: year {w["y"]} but the event record says {e["y"]}'
        assert 2 <= len(w['paras']) <= 5, f'{i}: {len(w["paras"])} paragraphs'
        n = len(w['claims'])
        used = {c for s in w['sources'] for c in s['supports']}
        assert used == set(range(1, n + 1)), f'{i}: claims without a source {set(range(1, n + 1)) - used} or numbers out of range {used - set(range(1, n + 1))}'
        hosts = {s['url'].split('/')[2] for s in w['sources']}
        assert len(w['sources']) >= 2, f'{i}: fewer than two sources'
        w.setdefault('checked', None)
        w.setdefault('disagree', None)
        print(f'{i}: ok ({len(w["paras"])} paragraphs, {n} claims, {len(w["sources"])} sources on {len(hosts)} sites)')
    files = sorted(glob.glob(os.path.join(D, '*.json')))
    cur = files[-1] if files else os.path.join(D, '001.json')
    doc = read_json(cur) if os.path.exists(cur) else {}
    if len(doc) >= 50:
        cur = os.path.join(D, f'{int(os.path.basename(cur)[:3]) + 1:03d}.json')
        doc = {}
    doc.update(new)
    with open(cur, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    print(f'{os.path.basename(cur)}: {len(doc)} entries')


if __name__ == '__main__':
    main()
