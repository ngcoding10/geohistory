"""Cross-check curated dates against Wikidata (used by every curated file).

wikidata_years(titles) -> {English Wikipedia title: {"q": QID, "years": set of years}} using the item's
point in time, start/end time, inception, dissolution and publication dates (historical years, no 0).
"""
from common import sparql, qid, log

PROPS = ['P585', 'P580', 'P582', 'P571', 'P576', 'P577', 'P1619', 'P575']


def _hist(v):
    neg = v.startswith('-')
    y = int(v.lstrip('-').split('-')[0])
    return -(y + 1) if neg else (y or -1)


def esc(s):
    return s.replace('\\', '\\\\').replace('"', '\\"')


def wikidata_years(titles, batch=60):
    out = {}
    titles = sorted(set(titles))
    props = ' '.join(f'wdt:{p}' for p in PROPS)
    for i in range(0, len(titles), batch):
        if batch > 60 and i % (batch * 50) == 0:
            log(f'  wikidata dates for titles {i}/{len(titles)}')
        vals = ' '.join(f'"{esc(t)}"@en' for t in titles[i:i + batch])
        q = f'''SELECT ?t ?item ?d WHERE {{ VALUES ?t {{ {vals} }}
  ?a schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?t .
  OPTIONAL {{ VALUES ?p {{ {props} }} ?item ?p ?d . }} }}'''
        try:
            rows = sparql(q)
        except Exception as ex:
            if batch <= 60:
                raise
            log(f'  title batch {i} failed ({ex}); skipped')
            continue
        for r in rows:
            e = out.setdefault(r['t'], {'q': qid(r['item']), 'years': set()})
            if r.get('d') and r['d'][:1] in '-0123456789':
                try:
                    e['years'].add(_hist(r['d']))
                except ValueError:
                    pass
    return out


def check(entry_year, info, slack=0):
    """True/False, and a short note."""
    if not info:
        return False, 'no Wikidata item for the linked article'
    if not info['years']:
        return False, 'Wikidata item has no date'
    if any(abs(y - entry_year) <= slack for y in info['years']):
        return True, f"matches Wikidata {info['q']}"
    return False, f"Wikidata {info['q']} gives {', '.join(str(y) for y in sorted(info['years'])[:4])}"
