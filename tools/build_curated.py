"""Step 2g: check the curated files against Wikidata and hand them to the build.

Curated content is written for GeoHistory from general knowledge (tools/curated/). Nothing in it is trusted
on its own: every dated statement names the English Wikipedia article it is about, and is "verified" only
when the Wikidata item of that article carries the same year (point in time, start, end, inception,
dissolution, publication, opening, launch; for people also birth, death and the start or end of an office).

  tools/curated/events/*.json   year-by-year supplements for major periods -> tools/cache/curated_events.json
  tools/curated/decades.json    one summary per decade, 1500-2020           -> data/decades.json
  tools/curated/polities.json   short descriptions of major states           -> data/polities.json

With --write the "verified" and "check" fields in the curated files are refreshed in place.
"""
import glob
import json
import os
import re
import sys

from common import TOOLS, DATA, CACHE, read_json, write_json, log, sparql, qid
from verify import wikidata_years, esc, _hist

CUR = os.path.join(TOOLS, 'curated')


def more_years(titles):
    """Extra dates for articles about people and spacecraft: birth, death, offices held, launch, landing."""
    out = {}
    titles = sorted(set(titles))
    for i in range(0, len(titles), 50):
        vals = ' '.join(f'"{esc(t)}"@en' for t in titles[i:i + 50])
        q = f'''SELECT ?t ?d WHERE {{ VALUES ?t {{ {vals} }}
  ?a schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?t .
  {{ ?item wdt:P569|wdt:P570|wdt:P619|wdt:P620|wdt:P1191|wdt:P729|wdt:P1249 ?d }}
  UNION {{ ?item p:P39|p:P97|p:P793 ?st . ?st pq:P580|pq:P582|pq:P585 ?d }} }}'''
        try:
            for r in sparql(q):
                if r['d'][:1] in '-0123456789':
                    try:
                        out.setdefault(r['t'], set()).add(_hist(r['d']))
                    except ValueError:
                        pass
        except Exception as e:
            log(f'  extra dates batch failed: {e}')
    return out


def checker(titles):
    wd = wikidata_years(titles)
    extra = more_years(titles)

    def check(title, year, slack=0):
        info = wd.get(title)
        if not info:
            return False, 'no Wikidata item for the linked article'
        years = set(info['years']) | extra.get(title, set())
        if not years:
            return False, 'Wikidata item has no date'
        if any(abs(y - year) <= slack for y in years):
            return True, f"matches Wikidata {info['q']}"
        return False, f"Wikidata {info['q']} gives {', '.join(str(y) for y in sorted(years)[:5])}"
    return check


def years_in(text):
    """Years mentioned in a text: 1066, 44 BC."""
    out = set()
    for m in re.finditer(r'(?<![\d,.])(\d{3,4}(?:\s?BC)?|\d{1,2}\s?BC)(?!\d|,\d|s\b|\s?(?:km|people|men|miles|years|ships|soldiers))', text):
        tok = m.group(1)
        y = int(re.match(r'\d+', tok).group(0))
        if tok.endswith('BC'):
            y = -y
        if -3500 <= y <= 2030:
            out.add(y)
    return out


def main():
    write = '--write' in sys.argv
    files = sorted(glob.glob(os.path.join(CUR, 'events', '*.json')))
    docs = [(f, read_json(f)) for f in files]
    dec_path, pol_path = os.path.join(CUR, 'decades.json'), os.path.join(CUR, 'polities.json')
    dec = read_json(dec_path) if os.path.exists(dec_path) else {'decades': []}
    pol = read_json(pol_path) if os.path.exists(pol_path) else {'polities': []}
    titles = [e['wiki'] for _, d in docs for e in d['events']]
    for x in pol['polities']:
        x['claims'] = [[x['wiki'], y] for y in sorted(years_in(x['text']))] + [c for c in x.get('more', [])]
    titles += [c[0] for x in dec['decades'] + pol['polities'] for c in x.get('claims', [])]
    check = checker(titles)

    events = []
    n_ok = 0
    for f, d in docs:
        for e in d['events']:
            e['verified'], e['check'] = check(e['wiki'], e['y'])
            n_ok += e['verified']
            ev = {'id': e['id'], 'label': e['label'], 'y': e['y'], 'm': e.get('m', 0), 'd': e.get('d', 0), 'type': e['type'],
                  'desc': e['desc'], 'wiki': e['wiki'], 'verified': e['verified']}
            if e.get('lon') is not None:
                ev['lon'], ev['lat'] = e['lon'], e['lat']
            events.append(ev)
        if write:
            write_json(f, d, pretty=True)
    write_json(os.path.join(CACHE, 'curated_events.json'), {'events': events})
    log(f'curated period events: {len(events)}, {n_ok} match Wikidata')
    for f, d in docs:
        for e in d['events']:
            if not e['verified']:
                log(f"  unverified: {e['y']} {e['label']} [{e['wiki']}]: {e['check']}")

    for key, doc, path, out in (('decades', dec, dec_path, 'decades.json'), ('polities', pol, pol_path, 'polities.json')):
        rows = doc[key]
        if not rows:
            continue
        ok = 0
        for x in rows:
            notes = []
            good = set()
            for title, year in x.get('claims', []):
                v, note = check(title, year)
                if v:
                    good.add(year)
                elif key != 'polities':   # a polity text only needs each of its years confirmed by one claim
                    notes.append(f'{year} {title}: {note}')
            if key == 'decades':
                for title, year in x.get('claims', []):
                    if not (x['from'] <= year <= x['to']):
                        notes.append(f'{year} {title}: outside the decade')
            missing = sorted(years_in(x['text']) - good - set(x.get('span', [])))
            if missing:
                notes.append('years in the text without a matching Wikidata date: ' + ', '.join(str(y) for y in missing))
            x['verified'] = not notes
            x['check'] = '; '.join(notes) if notes else 'every year in the text matches Wikidata'
            ok += x['verified']
        if write:
            write_json(path, doc, pretty=True)
        if key == 'polities':
            # keep the spellings that are on our maps; an entry with none is not shipped
            np = os.path.join(CACHE, 'names.json')
            known = set(read_json(np)) if os.path.exists(np) else None
            for x in rows:
                x['on_map'] = [n for n in x['names'] if known is None or n in known]
            log(f"  {sum(1 for x in rows if x['on_map'])} of {len(rows)} have a name that is on the maps")
        slim = [{k: v for k, v in x.items() if k not in ('claims', 'check', 'span', 'more', 'on_map', 'wiki', 'source')} for x in rows
                if key != 'polities' or x['on_map']]
        if key == 'polities':
            for x, full in zip(slim, [r for r in rows if r['on_map']]):
                x['names'] = full['on_map']
                x['w'] = full['wiki']
        write_json(os.path.join(DATA, out), {key: slim})
        log(f'curated {key}: {len(rows)}, {ok} fully verified')
        for x in rows:
            if not x['verified']:
                log(f"  unverified: {x.get('name') or x.get('from')}: {x['check']}")


if __name__ == '__main__':
    main()
