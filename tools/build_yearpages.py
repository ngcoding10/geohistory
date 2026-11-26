"""Step 4b: turn cached Wikipedia year articles into dated links -> tools/cache/yearpage_events.json

From each page's "Events" section we keep, per bullet line: the year, the month and day when the line
starts with one, and the first article it links to. No sentence text is copied: the event is named by its
linked article, and credited to the year article (CC BY-SA). Each link is checked against the Wikidata
item of the linked article: verified when Wikidata dates it to the same year.
"""
import json
import os
import re
import urllib.parse

from common import cache_path, CACHE, log, write_json
from fetch_yearpages import API, title
from verify import wikidata_years, check

MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
          'november', 'december']
SKIP = re.compile(r'^(\d{1,4}s?( BC)?|AD \d+|\d+(st|nd|rd|th) century.*|.*\b(births|deaths)\b.*|list of .*|'
                  r'january|february|march|april|may|june|july|august|september|october|november|december'
                  r'|[A-Z][a-z]+ \d{1,2})$', re.I)


def parse(y, text):
    m = re.search(r'==\s*Events\s*==(.*?)(\n==[^=])', text, re.S)
    if not m:
        return []
    out = []
    month = 0
    for line in m.group(1).splitlines():
        hm = re.match(r'===+\s*(.*?)\s*===+', line)
        if hm:
            mm = next((i + 1 for i, n in enumerate(MONTHS) if hm.group(1).lower().startswith(n)), 0)
            month = mm
            continue
        if not line.startswith('*'):
            continue
        body = line.lstrip('*').strip()
        dm = re.match(r'\[\[([A-Z][a-z]+) (\d{1,2})\]\]', body)
        mon, day = month, 0
        if dm and dm.group(1).lower() in MONTHS:
            mon, day = MONTHS.index(dm.group(1).lower()) + 1, int(dm.group(2))
        links = [l.split('|')[0].strip() for l in re.findall(r'\[\[([^\]]+)\]\]', body)]
        links = [l for l in links if l and not SKIP.match(l) and ':' not in l]
        if not links:
            continue
        out.append({'y': y, 'm': mon, 'd': day, 'link': links[0][0].upper() + links[0][1:]})
    return out


def main():
    found = []
    pages = 0
    for y in range(-500, 2025):
        if y == 0:
            continue
        p = cache_path(API + urllib.parse.quote(title(y)))
        if not os.path.exists(p):
            continue
        pages += 1
        try:
            text = json.load(open(p))['parse']['wikitext']
        except Exception:
            continue
        found += parse(y, text)
    wd = wikidata_years([f['link'] for f in found]) if found else {}
    for f in found:
        f['verified'], f['check'] = check(f['y'], wd.get(f['link']), slack=1)
        f['q'] = (wd.get(f['link']) or {}).get('q')
        f['source'] = 'https://en.wikipedia.org/wiki/' + title(f['y']).replace(' ', '_')
    write_json(os.path.join(CACHE, 'yearpage_events.json'), {'pages': pages, 'events': found})
    log(f'year pages: {pages} parsed, {len(found)} dated links, {sum(f["verified"] for f in found)} verified')


if __name__ == '__main__':
    main()
