"""Step 1f: Wikipedia year articles ("1776", "44 BC", "AD 5") as a yearly backbone. Slow and resumable.

Wikipedia throttles this machine to a few requests a minute, so this fetches one page every 20 seconds,
honours Retry-After, caches every raw page in tools/cache/ and can be re-run to continue. Years with the
fewest events in our data come first. Usage: python3 fetch_yearpages.py [max_pages]
Only the Events section is used later (build_yearpages.py), and only as dated links to articles.
"""
import json
import os
import sys
import urllib.parse

from common import fetch, cache_path, read_json, DATA, log

API = 'https://en.wikipedia.org/w/api.php?action=parse&prop=wikitext&format=json&formatversion=2&redirects=1&page='


def title(y):
    if y < 0:
        return f'{-y} BC'
    return f'AD {y}' if y < 100 else str(y)


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 50
    counts = {int(k): v for k, v in read_json(os.path.join(DATA, 'events', 'index.json'))['counts'].items()}
    years = [y for y in range(-500, 2025) if y != 0]
    years.sort(key=lambda y: (counts.get(y, 0), -y))
    done = 0
    for y in years:
        url = API + urllib.parse.quote(title(y))
        if os.path.exists(cache_path(url)):
            continue
        try:
            fetch(url, min_gap=20, timeout=60, tries=4)
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
