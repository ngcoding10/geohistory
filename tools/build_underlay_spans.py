"""Limit sketch-map territories to the years Wikidata gives them (tools/curated/underlay_auto.json).

The historical-basemaps sketch maps reuse outlines across centuries, so a people or state can be drawn under
the Cliopatria states long before it existed or long after it ended. For every sketch-map name that is
drawn on the yearly maps and is linked to a Wikidata item with an inception or a dissolution date
(data/entities.json; the link itself needs an exact label, a fitting class and overlapping years), this
writes a span: the name is drawn only from 60 years before the inception to 60 years after the dissolution.
Names that tools/curated/underlay.json already dates or renames are left to it, and so are names listed in
its "keep" list (links that are known to be about something else). build_clio.py reads the result.
Run after link_wikidata.py; build_all.sh then builds the Cliopatria years a second time.
"""
import os

from common import DATA, TOOLS, read_json, write_json, log, sparql, qid
from link_wikidata import year_of

SLACK = 60


def main():
    ents = read_json(os.path.join(DATA, 'entities.json'))
    ucfg = read_json(os.path.join(TOOLS, 'curated', 'underlay.json'))
    skip = {r['name'] for r in ucfg['spans']} | {r['name'] for r in ucfg['rename']} | set(ucfg.get('keep', []))
    idx = read_json(os.path.join(DATA, 'clio', 'index.json'))
    ys = idx['years']
    shown = {}
    for i, y in enumerate(ys):
        end = ys[i + 1] - 1 if i + 1 < len(ys) else idx['to']
        for r in read_json(os.path.join(DATA, 'clio', 'years', f'{y}.json'))['rows']:
            if len(r) >= 5:
                a = shown.setdefault(r[1], [y, end])
                a[0], a[1] = min(a[0], y), max(a[1], end)
    # archaeological cultures and periods carry "start time" and "end time" rather than inception and dissolution
    linked = sorted({ents[n]['q'] for n in shown if n in ents})
    period = {}
    try:
        for i in range(0, len(linked), 150):
            vals = ' '.join('wd:' + q for q in linked[i:i + 150])
            for r in sparql('SELECT ?x (MIN(?s) AS ?a) (MAX(?e) AS ?b) WHERE { VALUES ?x { %s } OPTIONAL { ?x wdt:P580 ?s } OPTIONAL { ?x wdt:P582 ?e } } GROUP BY ?x' % vals):
                period[qid(r['x'])] = (year_of(r.get('a')), year_of(r.get('b')))
    except Exception as ex:
        log('  Wikidata not reachable for start and end times:', ex)
    spans, n_years = [], 0
    n_linked = n_dated = 0
    for name, (first, last) in sorted(shown.items()):
        e = ents.get(name)
        if not e:
            continue
        n_linked += 1
        pa, pb = period.get(e['q'], (None, None))
        frm = e.get('from') if e.get('from') is not None else pa
        to = e.get('to') if e.get('to') is not None else pb
        if frm is not None or to is not None:
            n_dated += 1
        if name in skip or e.get('mod') is not None:
            continue
        e = dict(e, **{'from': frm, 'to': to})
        lo = e['from'] - SLACK if e.get('from') is not None else None
        hi = e['to'] + SLACK if e.get('to') is not None else None
        cut = (max(0, lo - first) if lo is not None else 0) + (max(0, last - hi) if hi is not None else 0)
        if not cut or (lo is not None and hi is not None and lo > hi):
            continue
        r = {'name': name, 'source': 'https://www.wikidata.org/wiki/' + e['q'], 'verified': True,
             'wikidata': [e.get('from'), e.get('to')], 'shownBefore': [first, last]}
        if lo is not None and lo > first:
            r['from'] = lo
        if hi is not None and hi < last:
            r['to'] = hi
        spans.append(r)
        n_years += cut
    write_json(os.path.join(TOOLS, 'curated', 'underlay_auto.json'),
               {'counts': {'names': len(shown), 'linked': n_linked, 'dated': n_dated, 'limited': len(spans), 'byHand': len(skip)},
                'about': 'Written by tools/build_underlay_spans.py from Wikidata inception and dissolution dates (60 years of slack). '
                         'Do not edit: add exceptions to the "keep" list of underlay.json instead.', 'spans': spans}, pretty=True)
    log(f'underlay spans: {len(shown)} sketch-map names are drawn on the yearly maps; {n_linked} are linked to a Wikidata item, '
        f'{n_dated} of those have a date; {len(spans)} are drawn outside those dates and are now limited to them '
        f'({n_years} name-years no longer drawn); {len(skip)} are dated or renamed by hand')


if __name__ == '__main__':
    main()
