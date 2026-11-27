"""Shared helpers for the data build: polite cached HTTP, JSON writing, paths.

Every network request goes through fetch(): sequential, generic User-Agent, backs off on 429/5xx,
and caches the raw response under tools/cache/ so a rebuild does not hit the network again.
"""
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, 'tools')
CACHE = os.path.join(TOOLS, 'cache')
DATA = os.path.join(ROOT, 'data')
UA = 'historical-map-build/1.0 (non-commercial)'   # generic: no names or contact details in requests
SPARQL = 'https://query.wikidata.org/sparql'

_last = [0.0]


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def cache_path(key, ext=''):
    os.makedirs(CACHE, exist_ok=True)
    h = hashlib.sha1(key.encode()).hexdigest()[:16]
    return os.path.join(CACHE, h + ext)


def fetch(url, data=None, headers=None, cache_key=None, ext='', min_gap=1.0, timeout=120, tries=6, max_wait=None):
    """GET (or POST when data is given) with on-disk cache. Returns bytes."""
    key = cache_key or (url + ('|' + data if data else ''))
    path = cache_path(key, ext)
    if os.path.exists(path):
        with open(path, 'rb') as f:
            return f.read()
    hdrs = {'User-Agent': UA}
    hdrs.update(headers or {})
    delay = 5
    for attempt in range(tries):
        wait = _last[0] + min_gap - time.time()
        if wait > 0:
            time.sleep(wait)
        try:
            req = urllib.request.Request(url, data=data.encode() if data else None, headers=hdrs)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
            _last[0] = time.time()
            tmp = path + '.tmp'
            with open(tmp, 'wb') as f:
                f.write(body)
            os.replace(tmp, path)
            return body
        except urllib.error.HTTPError as e:
            _last[0] = time.time()
            if e.code in (429, 500, 502, 503, 504) and attempt < tries - 1:
                ra = e.headers.get('Retry-After')
                pause = int(ra) if ra and ra.isdigit() else delay
                if max_wait is not None and pause > max_wait:
                    raise
                log(f'  HTTP {e.code}, waiting {pause}s ({url[:60]})')
                time.sleep(pause)
                delay = min(delay * 2, 120)
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            _last[0] = time.time()
            if attempt < tries - 1:
                log(f'  network error {e}, waiting {delay}s')
                time.sleep(delay)
                delay = min(delay * 2, 120)
                continue
            raise
    raise RuntimeError('unreachable')


def sparql(query, cache_key=None):
    """Run a Wikidata SPARQL query (POST), cached. Returns the list of bindings as plain dicts."""
    body = fetch(SPARQL, data=urllib.parse.urlencode({'query': query}),
                 headers={'Accept': 'application/sparql-results+json',
                          'Content-Type': 'application/x-www-form-urlencoded'},
                 cache_key=cache_key or ('sparql|' + query), ext='.json', min_gap=1.0, timeout=90)
    try:
        res = json.loads(body)
    except json.JSONDecodeError:
        # the service sometimes times out mid-answer; never keep a truncated result in the cache
        os.remove(cache_path(cache_key or ('sparql|' + query), '.json'))
        raise RuntimeError('truncated SPARQL result (query timed out)')
    return [{k: v['value'] for k, v in b.items()} for b in res['results']['bindings']]


def qid(uri):
    return uri.rsplit('/', 1)[-1] if uri else None


def write_json(path, obj, pretty=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        if pretty:
            json.dump(obj, f, ensure_ascii=False, indent=1)
        else:
            json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    return os.path.getsize(path)


def read_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)
