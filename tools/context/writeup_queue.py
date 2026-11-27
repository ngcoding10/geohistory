"""The work queue for event write-ups: every event, most notable first, with its tier.

Notability: the event's score (Wikipedia sitelinks and the other signals build_events.py ranks by), with
births and deaths after the rest. Items that are places or institutions rather than events (a country listed
as a 'politics' event in the year Wikidata dates it) are left to tier 3. Tier 1: the first 3,000; tier 2: the
next 30,000; tier 3: the rest. The queue keeps its order between runs, so a stopped run continues where it
stopped (tools/curated/writeups/queue.json: {"order": [ids], "tier": {id: 1|2|3}}).
"""
import glob
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from common import DATA, TOOLS, log, read_json, write_json  # noqa: E402

NOT_EVENT = re.compile(r'^(?:country|sovereign state|city|town|village|capital|island|region|province|state of|'
                       r'political party|company|newspaper|university|museum|organi[sz]ation|ethnic group|people|'
                       r'language|religion|river|mountain|human settlement|municipality|commune|municipal)', re.I)


def main():
    evs = {}
    for f in glob.glob(os.path.join(DATA, 'events', '*_*.json')):
        for e in read_json(f)['events']:
            evs.setdefault(e['i'], e)
    def rank(e):
        bd = e['t'] in ('birth', 'death')
        thing = bool(NOT_EVENT.search(e.get('d') or ''))
        return (bd, thing, -e['s'], e['y'])
    order = sorted(evs.values(), key=rank)
    p = os.path.join(TOOLS, 'curated', 'writeups', 'queue.json')
    old = read_json(p)['order'] if os.path.exists(p) else []
    ids = [i for i in old if i in evs] + [e['i'] for e in order if e['i'] not in set(old)]
    tier = {}
    n = 0
    for i in ids:
        e = evs[i]
        if e['t'] not in ('birth', 'death') and not NOT_EVENT.search(e.get('d') or '') and e.get('w'):
            n += 1
            tier[i] = 1 if n <= 3000 else 2 if n <= 33000 else 3
        else:
            tier[i] = 3
    write_json(p, {'order': ids, 'tier': tier})
    log(f'queue: {len(ids)} events; tier 1 {sum(1 for t in tier.values() if t == 1)}, tier 2 {sum(1 for t in tier.values() if t == 2)}, tier 3 {sum(1 for t in tier.values() if t == 3)}')


if __name__ == '__main__':
    main()
