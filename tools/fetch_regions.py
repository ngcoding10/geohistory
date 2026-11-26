"""Step 1h: per-region passes for the thin parts of the map -> tools/cache/regions_raw.json

The first passes ranked by Wikipedia editions, which leaves North America, Oceania, Southeast Asia and
sub-Saharan Africa before 1500, Latin America before 1500 and Central Asia almost empty. This pass asks
Wikidata region by region and class by class instead, down to one edition:

  A. archaeological cultures and periods everywhere (dated by start/end or inception/dissolution): for
     regions without written records these are the history. Dates keep their precision (century,
     millennium) and are shown as approximate;
  B. states of every kind down to 2 editions (the first pass needed 8), plus dynasties, chiefdoms,
     khanates, city-states, confederations and protectorates;
  C. per country in the thin regions: every dated item before 1900 (any year for Central Asia) whose class
     is an event class at any depth, and settlements and archaeological sites with an inception date.
"""
import json
import os

from common import sparql, qid, log, CACHE, fetch
from fetch_events import details, class_ancestors, classify, POLITY_CLASSES
from fetch_famous import extra_dates
from fetch_sources import NE

THIN = {'North America', 'Oceania', 'Southeast Asia', 'Sub-Saharan Africa', 'Latin America', 'Central Asia'}
REG = {'Eastern Asia': 'East Asia', 'Southern Asia': 'South Asia', 'South-Eastern Asia': 'Southeast Asia',
       'Central Asia': 'Central Asia', 'Western Asia': 'Middle East', 'Northern Africa': 'North Africa',
       'Northern America': 'North America', 'Caribbean': 'Latin America', 'Central America': 'Latin America',
       'South America': 'Latin America', 'Australia and New Zealand': 'Oceania', 'Melanesia': 'Oceania',
       'Micronesia': 'Oceania', 'Polynesia': 'Oceania'}
MORE_POLITY = ['Q164950', 'Q1642488', 'Q331644', 'Q133442', 'Q208500', 'Q170156', 'Q131401', 'Q164142',
               'Q2495771', 'Q12356456', 'Q1798550', 'Q2479824', 'Q12857432']
CULTURE_ROOTS = ['Q465299', 'Q15401633']
SETTLE = ['Q486972', 'Q839954', 'Q811979']   # settlements, archaeological sites, built structures (before 1500 only)


def regions():
    mod = json.loads(fetch(NE + 'ne_50m_admin_0_countries.geojson'))
    out = {}
    for f in mod['features']:
        p = f['properties']
        iso = p.get('ISO_A2_EH')
        if not iso or iso == '-99' or len(iso) != 2:
            continue
        sr = p.get('SUBREGION') or ''
        out[iso] = REG.get(sr, 'Sub-Saharan Africa' if 'Africa' in sr else 'Europe' if 'Europe' in sr else sr or 'Other')
    return out


def cultures():
    out = {}
    for root in CULTURE_ROOTS:
        try:
            for r in sparql(f'''SELECT ?item ?sl WHERE {{ ?item wdt:P31/wdt:P279* wd:{root} . ?item wikibase:sitelinks ?sl . FILTER(?sl >= 1)
  FILTER EXISTS {{ {{ ?item wdt:P580 [] }} UNION {{ ?item wdt:P571 [] }} UNION {{ ?item wdt:P582 [] }} UNION {{ ?item wdt:P576 [] }} }} }}'''):
                out[qid(r['item'])] = int(r['sl'])
        except Exception as e:
            log(f'  cultures {root} failed: {e}')
    log(f'archaeological cultures and periods with dates: {len(out)}')
    return out


def polities():
    rows = []
    for cls in sorted(set(POLITY_CLASSES + MORE_POLITY)):
        try:
            rs = sparql(f'''SELECT ?item ?sl ?start ?end WHERE {{ ?item wdt:P31 wd:{cls} . ?item wikibase:sitelinks ?sl . FILTER(?sl >= 2)
  OPTIONAL {{ ?item wdt:P571 ?start }} OPTIONAL {{ ?item wdt:P576 ?end }} FILTER(BOUND(?start) || BOUND(?end)) }}''')
        except Exception as e:
            log(f'  polities {cls} failed: {e}')
            continue
        rows += rs
        log(f'  polity class {cls}: {len(rs)} rows')
    return rows


def by_country(iso, region):
    """Dated items and dated settlements/sites in one country."""
    # North America is dense after 1700 already (the gap there is before 1500), so its pass stops at 1700
    cap = '' if region == 'Central Asia' else 'FILTER(?d < "%d-01-01T00:00:00Z"^^xsd:dateTime)' % (1700 if region == 'North America' else 1900)
    items, settle = {}, {}
    try:
        for r in sparql(f'''SELECT ?item (MAX(?sl) AS ?s) (GROUP_CONCAT(DISTINCT STRAFTER(STR(?c), "entity/")) AS ?cls) WHERE {{
  ?country wdt:P297 "{iso}" . ?item wdt:P17 ?country . {{ ?item wdt:P585 ?d }} UNION {{ ?item wdt:P580 ?d }} {cap}
  ?item wikibase:sitelinks ?sl . FILTER(?sl >= 1) OPTIONAL {{ ?item wdt:P31 ?c }} }} GROUP BY ?item'''):
            items[qid(r['item'])] = {'sl': int(r['s']), 'cls': r.get('cls', '').split()}
    except Exception as e:
        log(f'  {iso} dated items failed: {e}')
    thr = 15 if iso in ('US', 'CA', 'AU', 'MX', 'BR', 'AR') else 6
    for root in SETTLE:
        before = 1500 if root == 'Q811979' else 1900
        minsl = thr if root == 'Q486972' else 2
        try:
            for r in sparql(f'''SELECT ?item ?sl WHERE {{ ?country wdt:P297 "{iso}" . ?item wdt:P17 ?country ; wdt:P571 ?d .
  FILTER(?d < "{before}-01-01T00:00:00Z"^^xsd:dateTime) ?item wdt:P31/wdt:P279* wd:{root} . ?item wikibase:sitelinks ?sl . FILTER(?sl >= {minsl}) }}'''):
                settle.setdefault(qid(r['item']), {'sl': int(r['sl']), 'kind': {'Q486972': 'city', 'Q839954': 'site'}.get(root, 'built')})
        except Exception as e:
            log(f'  {iso} {root} failed: {e}')
    return items, settle


def main():
    raw = json.load(open(os.path.join(CACHE, 'events_raw.json')))
    extra = json.load(open(os.path.join(CACHE, 'extra_raw.json')))
    have = set(raw['kept']) | set(extra['deep'])
    have_det = set(raw['details']) | set(extra['details'])
    cult = cultures()
    pol = polities()
    reg = regions()
    cands, settle = {}, {}
    for iso, region in sorted(reg.items()):
        if region not in THIN:
            continue
        it, st = by_country(iso, region)
        for k, v in it.items():
            if k not in have:
                cands[k] = v
        for k, v in st.items():
            if k not in extra['found']:
                settle[k] = v
        log(f'{iso} ({region}): {len(it)} dated items, {len(st)} settlements/sites -> {len(cands)} new candidates')
    anc = class_ancestors({c for v in cands.values() for c in v['cls']})
    kept = {}
    for k, v in cands.items():
        t = classify(v['cls'], anc)
        if t:
            kept[k] = {'type': t, 'sl': v['sl'], 'region': 1}
    log(f'regional events kept: {len(kept)} of {len(cands)}')
    pol_items = {qid(r['item']) for r in pol}
    need = (set(kept) | set(cult) | pol_items | set(settle)) - have_det
    det = details(need)
    dates = extra_dates(set(cult) | set(settle), ['P571', 'P576', 'P580', 'P582'])
    with open(os.path.join(CACHE, 'regions_raw.json'), 'w') as f:
        json.dump({'kept': kept, 'cultures': cult, 'polity_changes': pol, 'settle': settle, 'details': det, 'dates': dates}, f)
    log(f'wrote regions_raw.json: {len(kept)} events, {len(cult)} cultures, {len(pol)} polity rows, {len(settle)} settlements/sites')


if __name__ == '__main__':
    main()
