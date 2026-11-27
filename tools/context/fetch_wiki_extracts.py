"""Lead sections of the English Wikipedia articles of the events, for the event write-ups.

Every event with an article title ('w') is asked for, most notable first (score 's'), through the REST
summary endpoint (the lead paragraph; redirects followed). Requests are cached
(tools/common.py fetch), so a stopped run continues where it stopped: the work queue is the sorted title
list, and each batch's answer is in the cache.

Writes tools/cache/context/wiki_extracts.json: {title: {"t": final title, "x": plain-text lead, "rev": revision id,
"len": article length, "at": access date}}
"""
import datetime
import glob
import json
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from common import CACHE, DATA, fetch, log, read_json, write_json  # noqa: E402

REST = 'https://en.wikipedia.org/api/rest_v1/page/summary/'
OUT = os.path.join(CACHE, 'context', 'wiki_extracts.json')


def titles():
    seen, out = set(), []
    evs = [e for f in glob.glob(os.path.join(DATA, 'events', '*_*.json')) for e in read_json(f)['events']]
    evs.sort(key=lambda e: (e['t'] in ('birth', 'death'), -e['s']))
    for e in evs:
        w = e.get('w')
        if w and w not in seen:
            seen.add(w)
            out.append(w)
    return out


def main(limit=None):
    ts = titles()
    if limit:
        ts = ts[:limit]
    out = read_json(OUT) if os.path.exists(OUT) else {}
    today = datetime.date.today().isoformat()
    todo = [t for t in ts if t not in out]
    log(f'wiki extracts: {len(ts)} titles, {len(todo)} to ask for')
    # the Action API is rate-limited for the shared address this runs from; the REST summary endpoint
    # (one article per request, served from Wikimedia's cache) is not, and gives the lead paragraph
    for i, t in enumerate(todo):
        url = REST + urllib.parse.quote(t.replace(' ', '_'), safe='')
        try:
            res = json.loads(fetch(url, min_gap=0.25, timeout=60, tries=4))
        except Exception as ex:   # noqa: BLE001 (a missing page answers 404)
            out[t] = None
            continue
        if res.get('type') not in ('standard', 'disambiguation') or not res.get('extract'):
            out[t] = None
            continue
        out[t] = {'t': res.get('title'), 'x': res['extract'].strip(), 'rev': res.get('revision'), 'at': today,
                  'd': res.get('description'), 'type': res.get('type'),
                  'url': (res.get('content_urls') or {}).get('desktop', {}).get('page')}
        if i % 500 == 0:
            write_json(OUT, out)
            log(f'  {i} / {len(todo)}')
    write_json(OUT, out)
    log(f'  done: {sum(1 for v in out.values() if v and v["x"])} extracts')


if __name__ == '__main__':
    main(int(sys.argv[1]) if len(sys.argv) > 1 else None)
