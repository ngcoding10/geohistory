"""Discoveries and inventions placed on the map: each one is attached to the state the map shows at its place
in its year (so a 1450 press in Mainz belongs to the Holy Roman Empire's lands, not to 'Germany').

Two sources:
  - tools/curated/context/discoveries.json: about a hundred major ones with the town where the work was done
    (AI-written text, checked here against Wikidata's dates);
  - Wikidata: every item with a time of discovery or invention and 20+ sitelinks
    (tools/cache/context/discoveries_raw.json), ranked by sitelinks.
A Wikidata item is placed by, in order: its location of discovery (P189); the discoverer's work location
(P937) valid in that year, when there is exactly one; its country of origin (P495) or the discoverer's
citizenship in that year (P27), when that country is itself a state on the map then, else by the country's
capital in that year. Each placement says which rule placed it. Items that none of these place are kept
without a state.

Writes data/context/discoveries.json:
  {"items": [[id, year, label, type, state, power, lon, lat, how, sitelinks, wiki, who, note, src, verified, approx, text]], ...}
and tools/cache/context/discoveries_check.json (the top 200 for a reading by hand).
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import CACHE, DATA, TOOLS, log, qid, read_json, sparql, write_json  # noqa: E402
from fetch_context import batch, esc, year_of, resolve_titles  # noqa: E402
from mapwhere import where  # noqa: E402

OUT = os.path.join(CACHE, 'context')
GEO = re.compile(r'island|continent|country|archipelago|lake|ocean|\bsea\b|region|territory|\bpole\b|mountain|river|cape|bay|peninsula|atoll|colony|sovereign state|geographic|land mass|landmass')
FIELDS = ['id', 'y', 'l', 'k', 'p', 'pw', 'lo', 'la', 'how', 'sl', 'w', 'who', 'note', 'src', 'v', 'approx', 'text']
# kinds by class words: what to call it in the panel
KIND = [('invention', r'invention|machine|device|engine|vehicle|tool|instrument|apparatus|technology|weapon|aircraft|vaccine|drug|medication'),
        ('exploration', r'expedition|voyage|exploration'),
        ('find', r'archaeological|fossil|hoard|manuscript|tomb|artifact|artefact|cave'),
        ('element', r'chemical element'),
        ('discovery', r'.')]


def state_index():
    """{QID: [(from, to, territory name)]} from the map states, their eras and the curated regimes."""
    st = read_json(os.path.join(OUT, 'states.json'))['states']
    wd = read_json(os.path.join(OUT, 'wikidata.json'))
    idx = {}
    for name, s in st.items():
        if s.get('q'):
            idx.setdefault(s['q'], []).append((s['first'], s['last'], name))
        for e in s.get('eras', []):
            idx.setdefault(e['q'], []).append((max(s['first'], e.get('from', s['first'])), min(s['last'], e.get('to', s['last'])), name))
    for name, rows in wd['regimes'].items():
        if name in st:
            for a, b, q, *_ in rows:
                if q:
                    idx.setdefault(q, []).append((a, b, name))
    return idx


def by_country(q, y, idx, caps):
    for a, b, name in idx.get(q, []):
        if a <= y <= b:
            return name, 'state'
    for cap in caps.get(q, []):
        s, e = cap[4], cap[5]
        if (s is None or s <= y) and (e is None or y <= e):
            w = where(cap[2], cap[3], y)
            if w:
                return w[0], f'capital ({cap[1]})'
    return None, None


def main():
    raw = read_json(os.path.join(OUT, 'discoveries_raw.json'))
    items, people, caps = raw['items'], raw['people'], raw['capitals']
    country_locs = set(raw.get('countryLocs', []))
    cur = read_json(os.path.join(TOOLS, 'curated', 'context', 'discoveries.json'))
    idx = state_index()
    out = []
    # curated first: resolve their articles, check the year against Wikidata
    titles = [d['wiki'] for d in cur['discoveries']]
    res = resolve_titles(titles)
    qs = sorted({r['q'] for r in res.values()})
    dates = {}
    for r in batch(qs, 100, lambda vals: f'''SELECT ?x ?p ?d WHERE {{ VALUES ?x {{ {vals} }} VALUES ?p {{ wdt:P575 wdt:P571 wdt:P577 wdt:P585 wdt:P580 wdt:P582 }}
  ?x ?p ?d }}''', 'curated dates'):
        y = year_of(r['d'])
        if y is not None:
            dates.setdefault(qid(r['x']), set()).add(y)
    taken = set()
    for d in cur['discoveries']:
        q = (res.get(d['wiki']) or {}).get('q')
        ys = dates.get(q, set())
        slack = 25 if d.get('approx') else 1
        v = any(abs(y - d['year']) <= slack for y in ys) if ys else None
        d['verified'] = v
        if q:
            taken.add(q)
        if d.get('place'):
            w = where(d['place'][1], d['place'][2], d['year'])
            lo, la = d['place'][1], d['place'][2]
            how = f"place: {d['place'][0]}"
        else:
            st = d['state']
            w = (st, None, None)
            lo = la = None
            how = 'sponsoring state'
        sl = items.get(q, {}).get('sl') if q else None
        out.append({'id': 'c:' + d['id'], 'q': q, 'y': d['year'], 'l': d['name'], 'k': d['kind'], 'p': w[0] if w else None,
                    'pw': w[1] if w else None, 'lo': lo, 'la': la, 'how': how, 'sl': sl or 0, 'w': d['wiki'], 'who': d.get('who'),
                    'note': d.get('note'), 'src': d['source'], 'v': v, 'approx': bool(d.get('approx')), 'text': d['text'], 'cur': True})
    write_json(os.path.join(TOOLS, 'curated', 'context', 'discoveries.json'), cur, pretty=True)
    # Wikidata items
    n_placed = skipped = 0

    def alive(wq, y):
        p = people.get(wq, {})
        return (p.get('born') is None or p['born'] + 10 <= y) and (p.get('died') is None or y <= p['died'])
    for q, e in sorted(items.items(), key=lambda kv: -kv[1]['sl']):
        if q in taken or e.get('y') is None or not e.get('n') or e['n'] == q:
            continue
        y = e['y']
        cls = ' '.join(e.get('cls', [])).lower()
        # not a datable discovery: places "discovered" by Europeans, prehistoric materials, and items with
        # neither a discoverer nor a place (broad concepts such as electricity or the newspaper)
        if GEO.search(cls) or y < -3000 or not (e.get('who') or e.get('loc')):
            skipped += 1
            continue
        kind = next((k for k, rx in KIND if re.search(rx, cls)), 'discovery')
        p = how = None
        lo = la = None
        # Wikidata often lists a later isolator beside the first discoverer (barium: Scheele 1772, Davy 1808):
        # when a listed discoverer was born after the year, the item mixes two events and is not placed
        mixed = any((people.get(w, {}).get('born') or -99999) > y - 10 for w, _ in e.get('who', []))
        for loc in ([] if mixed else e.get('loc', [])):
            if loc[0] in country_locs:
                name, h = by_country(loc[0], y, idx, caps)
                if name:
                    p, how = (name, None, None), f'country of discovery ({loc[1]}), {h}'
                    break
                continue
            if loc[2] is not None:
                w = where(loc[2], loc[3], y)
                if w:
                    p, how, lo, la = w, f'place of discovery: {loc[1]}', loc[2], loc[3]
                    break
        # the discoverer's own facts count only when there is one discoverer, alive and adult in that year
        solo = [w for w, _ in e.get('who', [])]
        solo = solo if len(solo) == 1 and alive(solo[0], y) and not mixed else []
        if not p:
            works = []
            for wq in solo:
                for wk in people.get(wq, {}).get('work', []):
                    s, en = wk[4], wk[5]
                    if (s is None or s <= y) and (en is None or y <= en):
                        works.append(wk)
            if len({w[0] for w in works}) == 1:
                wk = works[0]
                w = where(wk[2], wk[3], y)
                if w:
                    p, how, lo, la = w, f"discoverer's workplace: {wk[1]}", wk[2], wk[3]
        if not p and e.get('coord') and kind == 'find':
            w = where(e['coord'][0], e['coord'][1], y)
            if w:
                p, how, lo, la = w, 'where it was found', e['coord'][0], e['coord'][1]
        if not p and not mixed:
            for c in e.get('origin', []):
                name, h = by_country(c[0], y, idx, caps)
                if name:
                    p, how = (name, None, None), f'country of origin ({c[1]}), {h}'
                    break
        if not p:
            cits = []
            for wq in solo:
                for c in people.get(wq, {}).get('cit', []):
                    if (c[2] is None or c[2] <= y) and (c[3] is None or y <= c[3]):
                        cits.append(c)
            if len({c[0] for c in cits}) == 1:
                name, h = by_country(cits[0][0], y, idx, caps)
                if name:
                    p, how = (name, None, None), f"discoverer's citizenship ({cits[0][1]}), {h}"
        if p:
            n_placed += 1
        out.append({'id': q, 'q': q, 'y': y, 'l': e['n'][:1].upper() + e['n'][1:], 'k': kind, 'p': p[0] if p else None,
                    'pw': p[1] if p else None, 'lo': lo, 'la': la, 'how': how, 'sl': e['sl'], 'w': None,
                    'who': ', '.join(n for _, n in e.get('who', [])[:3]) or None, 'note': None,
                    'src': f'https://www.wikidata.org/wiki/{q}', 'v': True, 'approx': e.get('prec', 9) < 9, 'text': e.get('d')})
    # power keys for states placed by name only
    st = read_json(os.path.join(OUT, 'states.json'))
    maps = st['maps']
    for d in out:
        if d['p'] and not d['pw'] and d['p'] in st['states']:
            for mi, sids, pk, ruler in st['states'][d['p']]['maps']:
                if maps[mi][0] <= d['y'] <= maps[mi][1]:
                    d['pw'] = pk
                    break
    out.sort(key=lambda d: (not d.get('cur'), -d['sl']))
    write_json(os.path.join(DATA, 'context', 'discoveries.json'),
               {'fields': FIELDS, 'items': [[d.get(f) for f in FIELDS] for d in out]})
    write_json(os.path.join(OUT, 'discoveries_check.json'), out[:260], pretty=True)
    cv = [d for d in out if d.get('cur')]
    log(f'  {skipped} Wikidata items left out (places, prehistoric materials, no discoverer or place)')
    log(f'discoveries: {len(out)} ({len(cv)} curated, {sum(1 for d in cv if d["v"])} of them confirmed by Wikidata, '
        f'{sum(1 for d in cv if d["v"] is None)} without a Wikidata date); {n_placed} of {len(out) - len(cv)} Wikidata items placed on a state')


if __name__ == '__main__':
    main()
