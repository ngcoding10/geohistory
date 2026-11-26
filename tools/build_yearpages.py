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
from fetch_yearpages import API, title, page_text
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
        seen = []
        for l in links:
            l = l.split('#')[0].strip()
            if l and l not in seen:
                seen.append(l[0].upper() + l[1:])
        if seen:
            out.append({'y': y, 'm': mon, 'd': day, 'links': seen[:3]})
    return out


def main():
    found = []
    pages = 0
    for y in range(-500, 2025):
        if y == 0:
            continue
        text = page_text(y)
        if not text or text.lstrip().upper().startswith('#REDIRECT'):
            continue
        pages += 1
        found += parse(y, text)
    # A bullet usually links a person or a place before the event itself, so each of its first three links
    # is checked and the first whose Wikidata item is dated to this year (within one) names the event.
    # Bullets with no such link are dropped: a name without a matching date is not an event we can stand by.
    wd = wikidata_years([l for f in found for l in f['links']], batch=150) if found else {}
    kept = []
    for f in found:
        for l in f['links']:
            ok, note = check(f['y'], wd.get(l), slack=1)
            if ok:
                kept.append({'y': f['y'], 'm': f['m'], 'd': f['d'], 'link': l, 'verified': True, 'check': note,
                             'q': wd[l]['q'], 'first': l == f['links'][0], 'source': 'https://en.wikipedia.org/wiki/' + title(f['y']).replace(' ', '_')})
                break
    log(f'year pages: {len(found)} bullets, {len(kept)} with a link dated to the same year')
    found = kept
    write_json(os.path.join(CACHE, 'yearpage_events.json'), {'pages': pages, 'events': found})
    log(f'year pages: {pages} parsed, {len(found)} dated links, {sum(f["verified"] for f in found)} verified')


if __name__ == '__main__':
    main()
