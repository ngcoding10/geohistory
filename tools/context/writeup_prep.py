"""Print the material for writing event write-ups: the event record and its Wikipedia article (lead and the
sections most write-ups need), from the CirrusSearch dump extract (tools/cache/context/cirrus/enwiki).

Usage: writeup_prep.py [--chars N] id [id ...]   or   writeup_prep.py --next N   (the next N tier-1 events
of tools/curated/writeups/queue.json that have no write-up yet and are not in resume.skipped)
"""
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from common import CACHE, DATA, TOOLS, read_json, write_json  # noqa: E402

CIR = os.path.join(CACHE, 'context', 'cirrus', 'enwiki')
IDX = os.path.join(CACHE, 'context', 'cirrus_index.json')
WANT = re.compile(r'background|prelude|origin|cause|context|battle|course|events?|campaign|invasion|siege|'
                  r'aftermath|consequence|outcome|result|legacy|impact|signing|terms|provisions|negotiation|'
                  r'history|development|invention|discovery|reaction|casualties|fighting|engagement', re.I)


def index():
    files = sorted(glob.glob(os.path.join(CIR, '*.jsonl')))
    if os.path.exists(IDX):
        idx = read_json(IDX)
        if idx.get('files') == [os.path.basename(f) for f in files]:
            return idx['map']
    m = {}
    for f in files:
        with open(f, 'rb') as fh:
            off = 0
            for line in fh:
                r = json.loads(line)
                for t in r['as']:
                    m[t] = [os.path.basename(f), off]
                off += len(line)
    write_json(IDX, {'files': [os.path.basename(f) for f in files], 'map': m})
    return m


def article(title, idx):
    loc = idx.get(title)
    if not loc:
        return None
    with open(os.path.join(CIR, loc[0]), 'rb') as fh:
        fh.seek(loc[1])
        return json.loads(fh.readline())


def events():
    out = {}
    for f in glob.glob(os.path.join(DATA, 'events', '*_*.json')):
        for e in read_json(f)['events']:
            out.setdefault(e['i'], e)
    return out


def done_ids():
    ids = set()
    for f in glob.glob(os.path.join(TOOLS, 'curated', 'writeups', 't1', '*.json')):
        ids.update(read_json(f).keys())
    return ids


def show(e, idx, chars):
    keys = ('i', 'l', 'y', 'm', 'dd', 'y2', 't', 'p', 'pw', 'mc', 'lo', 'la', 'po', 'pa', 'w', 'd')
    print('=' * 100)
    print(json.dumps({k: e.get(k) for k in keys if e.get(k) is not None}, ensure_ascii=False))
    a = article(e['w'], idx) if e.get('w') else None
    if not a:
        print('  (no article text in the dump extract)')
        return
    print(f"  WIKIPEDIA: {a['title']} (rev {a['rev']}, {a['ts']})")
    left = chars
    for k, (h, lvl, t) in enumerate(a['sec']):
        if k == 0 or (WANT.search(h) and lvl <= 3):
            t = t[:min(len(t), max(400, left // 3 if k else left // 2))]
            print(f'  [{h or "lead"}] {t}')
            left -= len(t)
            if left <= 0:
                break
    print('  sections: ' + ' | '.join(h for h, _, _ in a['sec'][1:]))


def main():
    args = sys.argv[1:]
    chars = 3500
    if args[:1] == ['--chars']:
        chars, args = int(args[1]), args[2:]
    idx = index()
    ev = events()
    if args[:1] == ['--next']:
        q = read_json(os.path.join(TOOLS, 'curated', 'writeups', 'queue.json'))
        done = done_ids()
        skip = {i for v in q.get('resume', {}).get('skipped', {}).values() for i in v}
        ids = [i for i in q['order'] if q['tier'][i] == 1 and i not in done and i not in skip][:int(args[1])]
    else:
        ids = args
    for i in ids:
        show(ev[i], idx, chars)


if __name__ == '__main__':
    main()
