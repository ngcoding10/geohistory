"""Print the events the year panel shows first for the given years (rank as in js/main.js: score, then month;
births and deaths are hidden by default). Usage: python3 top_events.py 1066 1492 -44 [--n 15]"""
import glob
import json
import os
import sys

from common import DATA, read_json


def top(year, n=15):
    idx = read_json(os.path.join(DATA, 'events', 'index.json'))
    evs = []
    for b in idx['blocks']:
        if b['a'] <= year < b['b']:
            evs += [e for e in read_json(os.path.join(DATA, 'events', b['f']))['events'] if e['y'] == year]
    evs = [e for e in evs if e['t'] not in ('birth', 'death')]
    evs.sort(key=lambda e: (-e['s'], e.get('m') or 13))
    return evs[:n], len(evs)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    n = int(sys.argv[sys.argv.index('--n') + 1]) if '--n' in sys.argv else 15
    for y in map(int, args):
        evs, total = top(y, n)
        print(f'--- {y} ({total} events)')
        for e in evs:
            print(f"  {e['s']:4} {e['t']:9} {e['l'][:90]}" + (' [uv]' if e.get('uv') else '') + (' [cur]' if e.get('cur') else ''))
