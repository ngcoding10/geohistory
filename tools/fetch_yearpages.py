"""Step 1f: Wikipedia year articles ("1776", "44 BC", "AD 5") as a yearly backbone. Slow and resumable.

Fetches one page every 1.5 seconds from the raw-wikitext endpoint, honours Retry-After, caches every raw page in tools/cache/ and can be re-run to continue. Years with the
fewest events in our data come first. Usage: python3 fetch_yearpages.py [max_pages]
Only the Events section is used later (build_yearpages.py), and only as dated links to articles.
"""
import json
import os
import sys
import urllib.parse

from common import fetch, cache_path, read_json, DATA, log

API = 'https://en.wikipedia.org/w/api.php?action=parse&prop=wikitext&format=json&formatversion=2&redirects=1&page='
# The plain "raw wikitext" endpoint is throttled far less than the action API or the REST API (both
# answered HTTP 429 from the build machine), so it is tried first; pages cached from the old API stay valid.
RAW = 'https://en.wikipedia.org/w/index.php?action=raw&title='


def page_text(y):
    """Cached wikitext of a year article, or None."""
    p = cache_path(RAW + urllib.parse.quote(title(y).replace(' ', '_')))
    if os.path.exists(p):
        return open(p, encoding='utf-8').read()
    p = cache_path(API + urllib.parse.quote(title(y)))
    if os.path.exists(p):
        try:
            return json.load(open(p))['parse']['wikitext']
        except Exception:
            return None
    return None


def title(y):
    if y < 0:
        return f'{-y} BC'
    return f'AD {y}' if y < 100 else str(y)


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 50
    idx = os.path.join(DATA, 'events', 'index.json')     # absent on a rebuild from scratch: then plain year order
    counts = {int(k): v for k, v in read_json(idx)['counts'].items()} if os.path.exists(idx) else {}
    years = [y for y in range(-500, 2025) if y != 0]
    years.sort(key=lambda y: (counts.get(y, 0), -y))
    done = 0
    for y in years:
        url = RAW + urllib.parse.quote(title(y).replace(' ', '_'))
        if os.path.exists(cache_path(url)) or os.path.exists(cache_path(API + urllib.parse.quote(title(y)))):
            continue
        try:
            fetch(url, min_gap=1.5, timeout=60, tries=6)
        except Exception as e:
            log(f'{title(y)}: {e}')
            continue
        done += 1
        if done % 10 == 0:
            log(f'{done} pages fetched (last {title(y)})')
        if done >= limit:
            break
    log(f'fetched {done} new year pages')


if __name__ == '__main__':
    main()
