"""Step 4: turn the raw Wikidata results (tools/cache/events_raw.json) plus the curated supplement into
the app's event files.

Writes:
  data/events/index.json     blocks (year ranges -> file) and event counts per year
  data/events/<a>_<b>.json   events that start in [a, b), plus long events still running ("ongoing")
  data/search.json           names for the search box (territories, today's countries, US states, events)
  data/meta.json             build date, counts per source, year range, known gaps

Every event is placed: coordinates -> the territory containing it on the border map shown for its year,
today's country (Natural Earth) and, for 1763-2000, the US state or colony (Newberry AHCB).
Events without coordinates are placed through their Wikidata country.
"""
import datetime
import json
import os
import re
from collections import defaultdict, Counter

from common import CACHE, DATA, TOOLS, fetch, sparql, qid, log, write_json, read_json
from fetch_sources import NE
from geo import PolyIndex
import yearly
import names as names_mod
from classify import classify
from ruler_titles import is_ruler_title

JULIAN = 'Q1985786'
TYPE_ORDER = ['war', 'battle', 'revolt', 'violence', 'treaty', 'state', 'ruler', 'politics', 'economy', 'epidemic',
              'disaster', 'discovery', 'religion', 'founding', 'culture', 'birth', 'death', 'other']


def hist_year(astro):
    return astro if astro > 0 else astro - 1


def parse_time(v):
    """'-0043-03-13T00:00:00Z' -> (astro_year, month, day)"""
    m = re.match(r'^(-?)(\d+)-(\d\d)-(\d\d)T', v or '')
    if not m:
        return None
    y = int(m.group(2)) * (-1 if m.group(1) else 1)
    return y, int(m.group(3)), int(m.group(4))


def jdn_from_gregorian(y, m, d):
    a = (14 - m) // 12
    yy = y + 4800 - a
    mm = m + 12 * a - 3
    return d + (153 * mm + 2) // 5 + 365 * yy + yy // 4 - yy // 100 + yy // 400 - 32045


def julian_from_jdn(j):
    c = j + 32082
    d = (4 * c + 3) // 1461
    e = c - 1461 * d // 4
    m = (5 * e + 2) // 153
    day = e - (153 * m + 2) // 5 + 1
    month = m + 3 - 12 * (m // 10)
    year = d - 4800 + m // 10
    return year, month, day


def to_date(v, prec, cal):
    """Wikidata RDF time (Gregorian-normalised) -> (hist_year, month, day, approx) or None."""
    t = parse_time(v)
    if not t:
        return None
    y, m, d = t
    prec = int(prec)
    if prec >= 11 and cal == JULIAN:
        y, m, d = julian_from_jdn(jdn_from_gregorian(y, m, d))
    hy = hist_year(y)
    if prec >= 11:
        return hy, m, d, 0
    if prec == 10:
        return hy, m, 0, 0
    if prec == 9:
        return hy, 0, 0, 0
    if prec in (7, 8) and hy < 500:
        return hy, 0, 0, 1
    if prec == 8:
        return hy, 0, 0, 1   # known to the decade ("1820s"): shown as "c. 1820"
    return None


def century_note(astro, prec):
    """Wikidata century/millennium precision -> (representative historical year, label)."""
    size = 100 if prec == 7 else 1000
    word = 'century' if prec == 7 else 'millennium'
    n = (abs(astro) + size - 1) // size if astro > 0 else (abs(astro)) // size + 1
    def ordinal(k):
        return f"{k}{'th' if 10 <= k % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(k % 10, 'th')}"
    if astro > 0:
        return (n - 1) * size + size // 2, f'{ordinal(n)} {word}'
    return -((n - 1) * size + size // 2), f'{ordinal(n)} {word} BC'


def to_date_coarse(v, prec, cal):
    """Like to_date, but keeps decade, century and millennium precision as an approximate year with a note
    ("9th century"), for archaeological cultures and sites. -> (year, month, day, approx, note) or None."""
    d = to_date(v, prec, cal)
    prec = int(prec)
    if d and prec >= 9:
        return d + (None,)
    t = parse_time(v)
    if not t:
        return None
    if prec == 8:
        return hist_year(t[0]), 0, 0, 1, None
    if prec in (6, 7):
        y, note = century_note(t[0], prec)
        return y, 0, 0, 1, note
    return None


def pick_main(dates):
    """Main date of an event. A start time wins over a "point in time" when the item also has an end time
    or the point is later than the start (Wikidata often stores the end or a midpoint as the point:
    Vietnam War 1975, Chinese Civil War 1946, Congress of Vienna 1815). -> (date, extra end years)"""
    key = lambda x: (-x[0], x[1][0])
    st = sorted(dates['P580'], key=key)
    pt = sorted(dates['P585'], key=key)
    if st and pt:
        if dates['P582'] or st[0][1][0] < pt[0][1][0]:
            return st[0][1], [d[0] for _, d in dates['P585']]
        return pt[0][1], []
    if pt:
        return pt[0][1], []
    if st:
        return st[0][1], []
    return None, []


JUNK = re.compile(r'^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$'
                  r'|Wiki Loves|Wikimedia|Wikipedia|^\d{4}s? in |^Timeline of ', re.I)
# year-article links that are sport, show business or by-elections rather than history
YP_SKIP = re.compile(r'UEFA|FIFA|Eurovision|Miss (World|Universe|America)|Championships?\b|Grand Prix|Super Bowl|\bCup\b|\bseason\b|'
                     r'\bAwards?\b|by-election|\bOpen\b|Tour de France|World Series|Stanley|Wimbledon|\bLeague\b|Idol\b|\(film\)|\(album\)|\(song\)|\(novel\)|\(TV', re.I)
# kinds of event that happen inside the state they are filed under (so a former state's capital places them)
# Wikidata classes of things (not events) that carry a start date: ranked like "X founded"
THINGS = {'Q8142', 'Q28783456', 'Q1368', 'Q25530138', 'Q93636179', 'Q378427', 'Q618779', 'Q1709894', 'Q11448906',
          'Q62049', 'Q1093829', 'Q515', 'Q15221310', 'Q976327', 'Q15087423', 'Q8192', 'Q3918', 'Q875538',
          'Q2385804', 'Q9826', 'Q3914', 'Q107655869'}
DOMESTIC = {'politics', 'revolt', 'state', 'ruler', 'economy', 'religion', 'epidemic', 'disaster', 'violence', 'other', 'founding'}


def person_name(label, enwiki):
    """Rulers are shown under their English Wikipedia title ("Catherine the Great", "Franklin D. Roosevelt")
    when it is a plain name; Wikidata's label otherwise."""
    if enwiki and ',' not in enwiki:
        return re.sub(r'\s*\([^)]*\)$', '', enwiki)
    return label


def parse_point(s):
    m = re.match(r'Point\(([-\d.eE]+) ([-\d.eE]+)\)', s or '')
    if not m:
        return None
    lon, lat = float(m.group(1)), float(m.group(2))
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        return None
    return round(lon, 3), round(lat, 3)


def split_pairs(s, n=2):
    out = []
    for part in (s or '').split('~'):
        if not part:
            continue
        bits = part.split('|')
        if len(bits) >= n and bits[0]:
            out.append(bits)
    return out


# Locations too wide to put a marker on: an event "in Africa" or "in the Pacific Ocean" is not at the centre
# of the continent or the sea, and the country nearest to that centre is not where it happened.
WIDE_PLACES = {'africa', 'europe', 'asia', 'north america', 'south america', 'americas', 'america', 'oceania',
               'antarctica', 'eurasia', 'earth', 'world', 'worldwide', 'atlantic ocean', 'pacific ocean',
               'indian ocean', 'arctic ocean', 'mediterranean sea', 'caribbean sea', 'caribbean', 'baltic sea',
               'north sea', 'black sea', 'middle east', 'near east', 'southeast asia', 'south asia', 'east asia',
               'central asia', 'western europe', 'eastern europe', 'central europe', 'northern europe',
               'southern europe', 'latin america', 'central america', 'mesoamerica', 'north africa',
               'sub-saharan africa', 'west africa', 'east africa', 'southern africa', 'western world',
               'old world', 'new world', 'pacific', 'atlantic', 'global', 'northern hemisphere'}


WIDE_Q = {'Q15', 'Q46', 'Q48', 'Q49', 'Q18', 'Q828', 'Q51', 'Q2', 'Q5401', 'Q97', 'Q98', 'Q1239', 'Q4918',
          'Q1247', 'Q7204', 'Q664609', 'Q13703', 'Q12585', 'Q27611', 'Q11708', 'Q27231', 'Q27275', 'Q27496',
          'Q27468', 'Q27381', 'Q4412', 'Q132959'}


def narrow_locs(locs):
    """An event's locations without continents, oceans and world regions -> (locations, wide). When one of
    them was that wide (the Second World War: "Africa, Europe, Asia, ...") the event is not a local one:
    wide is True, no location is kept, and the caller does not place it in a country either."""
    keep = [b for b in locs if b[0] not in WIDE_Q and (len(b) < 2 or (b[1] or '').strip().lower() not in WIDE_PLACES)]
    wide = len(keep) < len(locs)
    return ([] if wide else keep), wide


def good_label(l):
    return bool(l) and not re.match(r'^Q\d+$', l)


def main():
    raw = read_json(os.path.join(CACHE, 'events_raw.json'))
    kept, det = raw['kept'], raw['details']
    log(f'raw: {len(kept)} kept events, {len(det)} detail rows')

    # ---------- snapshots for placement ----------
    bindex = read_json(os.path.join(DATA, 'borders', 'index.json'))['snapshots']
    snap_years = [s['y'] for s in bindex]
    snap_cache = {}

    cs_index = read_json(os.path.join(DATA, 'cshapes', 'index.json'))

    def snap_index(y):
        if yearly.source(y):
            key = yearly.map_key(y)
            if key not in snap_cache:
                pols = yearly.year_doc(y)
                snap_cache[key] = (PolyIndex([(k, p['g']) for k, p in enumerate(pols)]), pols)
            return key, snap_cache[key]
        best = None
        for sy in snap_years:
            if sy <= y:
                best = sy
        if best is None:
            return None, None
        if best not in snap_cache:
            doc = read_json(os.path.join(DATA, 'borders', f'{best}.json'))
            items = [(f['properties']['k'], f['geometry']) for f in doc['features'] if f['properties']['k'] >= 0]
            snap_cache[best] = (PolyIndex(items), doc['polities'])
        return best, snap_cache[best]

    mod = json.loads(fetch(NE + 'ne_50m_admin_0_countries.geojson'))
    mod_items, mod_names = [], {}
    for f in mod['features']:
        p = f['properties']
        iso = p.get('ISO_A2_EH') if p.get('ISO_A2_EH') not in (None, '-99') else p.get('ADM0_A3')
        mod_items.append((iso, f['geometry']))
        mod_names[iso] = p.get('NAME_EN') or p.get('NAME')
    mod_index = PolyIndex(mod_items)

    us = read_json(os.path.join(DATA, 'us', 'states.json'))['features']
    us_by_name = {}
    for f in us:
        p = f['properties']
        if p['id'].endswith('_state'):
            us_by_name.setdefault(p['n'], p['id'])
    us_versions = defaultdict(list)  # coarse index by year for speed
    for f in us:
        p = f['properties']
        for yy in range(p['s'] // 10000, p['e'] // 10000 + 1):
            us_versions[yy].append(f)
    us_pi_cache = {}

    col = read_json(os.path.join(DATA, 'us', 'colonies.json'))
    col_names = col['states']
    col_pi = {}

    def colony(y, m, d, lon, lat):
        date = y * 10000 + (m or 7) * 100 + (d or 1)
        cands = [f for f in col['features'] if f['properties']['s'] <= date <= f['properties']['e']]
        key = tuple(sorted(id(f) for f in cands))
        if key not in col_pi:
            col_pi[key] = PolyIndex([(f['properties']['st'], f['geometry']) for f in cands], cell=2.0)
        st = col_pi[key].lookup(lon, lat)
        if not st:
            return None
        st = 'MA' if st == 'ME' else st
        return col_names.get(st, st), st.lower() + '_state'

    def us_state(y, m, d, lon, lat):
        if 1607 <= y and y * 10000 + (m or 7) * 100 + (d or 1) < 17830903:
            if -90 < lon < -60 and 25 < lat < 50:
                return colony(y, m, d, lon, lat)
            return None
        if y < 1763 or y > 2000:
            return None
        date = y * 10000 + (m or 7) * 100 + (d or 1)
        cands = [f for f in us_versions.get(y, []) if f['properties']['s'] <= date <= f['properties']['e']]
        key = tuple(sorted(id(f) for f in cands))
        if key not in us_pi_cache:
            us_pi_cache[key] = PolyIndex([(f['properties'], f['geometry']) for f in cands], cell=2.0)
        p = us_pi_cache[key].lookup(lon, lat)
        if not p:
            return None
        name = p['n']
        if p.get('approx') and p['id'] in us_by_name.values():
            name = next(n for n, i in us_by_name.items() if i == p['id'])
        return name, p['id']

    # ---------- entities: polity QIDs for events without coordinates ----------
    ents_path = os.path.join(DATA, 'entities.json')
    ents = read_json(ents_path) if os.path.exists(ents_path) else {}
    q_to_names = defaultdict(list)
    for name, e in ents.items():
        q_to_names[e['q']].append(name)

    # ISO codes for country QIDs (to place events with only a country)
    country_qids = set()
    for r in det.values():
        for q, _ in split_pairs(r.get('countries')):
            country_qids.add(q)
    iso_of = {}
    cq = sorted(country_qids)
    for i in range(0, len(cq), 300):
        vals = ' '.join('wd:' + q for q in cq[i:i + 300])
        for b in sparql(f'SELECT ?c ?iso WHERE {{ VALUES ?c {{ {vals} }} ?c wdt:P297 ?iso . }}'):
            iso_of[qid(b['c'])] = b['iso']
    log(f'{len(iso_of)} of {len(cq)} country items have ISO codes')
    rr_path0 = os.path.join(CACHE, 'rulers_raw.json')
    if os.path.exists(rr_path0):
        # ISO codes for the ruler jurisdictions too, so today's countries find their heads of state
        js = sorted(set(read_json(rr_path0)['pos_j'].values()) - set(iso_of))
        for i in range(0, len(js), 300):
            vals = ' '.join('wd:' + q for q in js[i:i + 300])
            for b in sparql(f'SELECT ?c ?iso WHERE {{ VALUES ?c {{ {vals} }} ?c wdt:P297 ?iso . }}'):
                iso_of[qid(b['c'])] = b['iso']
    write_json(os.path.join(CACHE, 'iso_q.json'), {iso: q for q, iso in sorted(iso_of.items(), key=lambda x: x[0], reverse=True)})

    def load_raw(name, default):
        p = os.path.join(CACHE, name)
        return read_json(p) if os.path.exists(p) else default
    fam = load_raw('famous_raw.json', {'items': {}, 'details': {}, 'dates': {}, 'terms': [], 'labels': {}, 'aliases': {}})
    regs = load_raw('regions_raw.json', {'kept': {}, 'cultures': {}, 'polity_changes': [], 'settle': {}, 'details': {}, 'dates': {}})
    places = load_raw('places_raw.json', {'points': {}, 'locations': {}, 'pos_j': {}})
    stats = Counter()

    def mc_at(lon, lat):
        return mod_index.nearest(lon, lat, 0.8)

    def place_entity(ev, q, mark='ap'):
        """Put an event at a state's own coordinates, else its capital. True when that gave a country."""
        pt = places['points'].get(q) or {}
        if pt.get('iso') in mod_names and ev.get('lo') is None and not (pt.get('pt') or pt.get('cap')):
            ev['mc'] = pt['iso']
            return True
        xy = parse_point(pt.get('pt')) or parse_point(pt.get('cap'))
        if not xy:
            return False
        if ev.get('lo') is None:
            ev['lo'], ev['la'] = xy
            ev[mark] = 1
            keep = (ev.get('p'), ev.get('pw'))
            place(ev, [])
            if keep[0]:
                ev['p'], ev['pw'] = keep
        elif not ev.get('mc'):
            mc = mc_at(*xy)
            if mc:
                ev['mc'] = mc
        return bool(ev.get('mc'))

    def place_more(ev, q):
        """Fallbacks for events still without a modern country (see fetch_places.py)."""
        if ev.get('mc'):
            return
        for kind, lq, iso, lc in places['locations'].get(q, []):
            if kind != 'loc' or lq in WIDE_Q:
                continue
            xy = parse_point(lc)
            if xy and ev.get('lo') is None:
                ev['lo'], ev['la'] = xy
                ev['ap'] = 1
                place(ev, [])
            if not ev.get('mc') and iso in mod_names:
                ev['mc'] = iso
            if ev.get('mc'):
                stats['placedByLocation'] += 1
                return
        if ev['t'] in DOMESTIC:
            for kind, lq, iso, lc in places['locations'].get(q, []):
                if kind == 'country' and not iso and place_entity(ev, lq, 'mi'):
                    stats['placedByFormerState'] += 1
                    return

    events = {}

    def place(ev, countries):
        y = ev['y']
        if ev.get('lo') is not None:
            sy, si = snap_index(y)
            if si:
                k = si[0].lookup(ev['lo'], ev['la'])
                if k is None:
                    k = si[0].nearest(ev['lo'], ev['la'], 0.6)
                if k is not None:
                    pol = si[1][k]
                    ev['p'] = pol['n']
                    ev['pw'] = pol['p']
            mc = mod_index.nearest(ev['lo'], ev['la'], 0.8)
            if mc:
                ev['mc'] = mc
            if not ev.get('c'):
                st = us_state(y, ev.get('m'), ev.get('dd'), ev['lo'], ev['la'])
                if st:
                    ev['c'], ev['ci'] = st
        else:
            sy, si = snap_index(y)
            names_here = {p['n']: p for p in si[1]} if si else {}
            for q, _ in countries:
                for n in q_to_names.get(q, []):
                    if n in names_here:
                        ev['p'] = n
                        ev['pw'] = names_here[n]['p']
                        break
                if 'p' in ev:
                    break
            for q, _ in countries:
                if q in iso_of and iso_of[q] in mod_names:
                    ev['mc'] = iso_of[q]
                    break

    # ---------- Wikidata events (first pass plus the deep pass by class) ----------
    extra_path = os.path.join(CACHE, 'extra_raw.json')
    extra = read_json(extra_path) if os.path.exists(extra_path) else {'deep': {}, 'people': [], 'found': {}, 'details': {}, 'dates': {}}
    det = dict(det)
    det.update(extra['details'])
    kept = dict(kept)
    for k, v in extra['deep'].items():
        kept.setdefault(k, {'type': {'famine': 'disaster'}.get(v['t'], v['t']), 'sl': v['sl'], 'deep': 1})
    det.update(fam['details'])
    det.update(regs['details'])
    # Wikidata now stores many names once, as a language-neutral "mul" label, and the detail queries asked
    # for English: fall back to the English Wikipedia title (minus any bracketed qualifier)
    n_mul = 0
    for r in det.values():
        if not r.get('label') and r.get('enwiki'):
            r['label'] = re.sub(r'\s*\([^)]*\)$', '', r['enwiki'])
            n_mul += 1
    log(f'{n_mul} items named from their Wikipedia title (no English label on Wikidata)')
    for k, v in regs['kept'].items():
        kept.setdefault(k, v)
    parent_q = {}
    for k, v in kept.items():
        r = det.get(k)
        if not r or not good_label(r.get('label')) or JUNK.search(r['label']):
            continue
        dates = defaultdict(list)
        for prop, val, prec, cal in split_pairs(r.get('dates'), 4):
            dt = to_date(val, prec, cal)
            if dt:
                dates[prop].append((int(prec), dt))
        main, more_ends = pick_main(dates)
        if not main:
            continue
        y, m, d, approx = main
        ev = {'i': k, 'l': r['label'], 'y': y, 't': v['type'], 's': v['sl']}
        if set(v.get('cls') or []) & THINGS:
            ev['_inc'] = 1     # a currency, prize, town or school with a start date: a thing, not an event
        if m:
            ev['m'] = m
        if d:
            ev['dd'] = d
        if approx:
            ev['ya'] = 1
        ends = [dt[0] for _, dt in dates['P582']] + more_ends
        if ends and max(ends) > y:
            ev['y2'] = max(ends)
        if r.get('desc'):
            ev['d'] = r['desc'][:160]
        if r.get('enwiki'):
            ev['w'] = r['enwiki']
        pt = parse_point(r.get('coord'))
        locs, wide = narrow_locs(split_pairs(r.get('locs'), 2))
        if locs:
            ev['loc'] = locs[0][1]
        if not pt:
            for bits in locs:
                if len(bits) >= 3 and parse_point(bits[2]):
                    pt = parse_point(bits[2])
                    ev['ap'] = 1
                    break
        if pt:
            ev['lo'], ev['la'] = pt
        countries = [] if wide else split_pairs(r.get('countries'))
        if countries:
            ev['cn'] = [c[1] for c in countries[:3]]
        parts = split_pairs(r.get('parts'))
        if parts:
            ev['pa'] = [p[1] for p in parts[:6]]
        pof = split_pairs(r.get('partof'))
        if pof:
            ev['po'] = pof[0][1]
            parent_q[k] = pof[0][0]
        al = [a for a in fam['aliases'].get(k, []) if 3 < len(a) <= 60 and a.lower() != ev['l'].lower() and re.match(r"^[\w .,'()\u2013-]+$", a)]
        if al and v['sl'] >= 15:
            ev['al'] = sorted(set(al), key=lambda a: (len(a), a))[:4]
        # fix obvious type slips from Wikidata classes (a riot classed under "armed conflict" is not a war)
        low = ev['l'].lower()
        if ev['t'] in ('war', 'battle') and any(w in low for w in ('riot', 'uprising', 'revolt', 'rebellion', 'insurrection', 'mutiny', 'protest', 'strike')):
            ev['t'] = 'revolt'
        if ev['t'] in ('war', 'battle', 'revolt') and any(w in low for w in ('massacre', 'genocide', 'pogrom')):
            ev['t'] = 'violence'
        place(ev, countries)
        if not wide:
            place_more(ev, k)
        events[k] = ev

    # ---------- famous items dated by inception, publication, launch... (fetch_famous.py) ----------
    ORDER = ['P585', 'P580', 'P619', 'P571', 'P577', 'P575', 'P606', 'P1619', 'P1191', 'P620']
    today = datetime.date.today()
    n_fam = 0
    for k, v in fam['items'].items():
        r = det.get(k)
        if k in events or k in regs['cultures'] or not r or not good_label(r.get('label')) or JUNK.search(r['label']):
            continue   # cultures are handled below, where century-precision dates are kept
        dates = defaultdict(list)
        for prop, val, prec, cal in split_pairs(r.get('dates'), 4) + [d4 for d4 in fam['dates'].get(k, [])]:
            dt = to_date(val, prec, cal)
            if dt:
                dates[prop].append((int(prec), dt))
        prop = next((p for p in ORDER if dates[p]), None)
        if not prop:
            continue
        if prop in ('P585', 'P580'):
            main, more_ends = pick_main(dates)
        else:
            main, more_ends = sorted(dates[prop], key=lambda x: (x[1][0], -x[0]))[0][1], []
        y, m, d, approx = main
        if (y, m, d) > (today.year, today.month, today.day):
            continue   # planned launches and openings are not history yet
        pat = v['pat']
        if prop in ('P585', 'P580', 'P577') and pat.endswith((' founded', ' built', ' launched', ' invented', ' proposed')):
            pat = '{}'
        if prop == 'P619':
            pat = '{} launched' if not r['label'].lower().startswith(('apollo', 'soyuz', 'vostok', 'gemini', 'mercury', 'sts', 'shenzhou', 'voskhod')) else '{}'
        ev = {'i': k, 'l': pat.format(r['label']), 'y': y, 't': v['type'], 's': max(1, int(v['sl'] * (0.5 if pat != '{}' else 1)))}
        if prop == 'P571':
            ev['_inc'] = 1     # dated by the inception of a thing (a currency, a prize, a script), not by an event
        if m:
            ev['m'] = m
        if d:
            ev['dd'] = d
        if approx:
            ev['ya'] = 1
        ends = [dt[0] for _, dt in dates['P582']] + more_ends
        if prop in ('P585', 'P580') and ends and max(ends) > y:
            ev['y2'] = max(ends)
        if r.get('desc'):
            ev['d'] = r['desc'][:160]
        if r.get('enwiki'):
            ev['w'] = r['enwiki']
        pt = parse_point(r.get('coord'))
        locs, wide = narrow_locs(split_pairs(r.get('locs'), 2))
        if locs:
            ev['loc'] = locs[0][1]
        if not pt:
            for bits in locs:
                if len(bits) >= 3 and parse_point(bits[2]):
                    pt = parse_point(bits[2])
                    ev['ap'] = 1
                    break
        if pt:
            ev['lo'], ev['la'] = pt
        countries = [] if wide else split_pairs(r.get('countries'))
        if countries:
            ev['cn'] = [c[1] for c in countries[:3]]
        pof = split_pairs(r.get('partof'))
        if pof:
            ev['po'] = pof[0][1]
            parent_q[k] = pof[0][0]
        al = [a for a in fam['aliases'].get(k, []) if 3 < len(a) <= 60 and a.lower() != ev['l'].lower() and re.match(r"^[\w .,'()\u2013-]+$", a)]
        if al:
            ev['al'] = sorted(set(al), key=lambda a: (len(a), a))[:4]
        place(ev, countries)
        if not wide:
            place_more(ev, k)
        events[k] = ev
        n_fam += 1
    log(f'{n_fam} famous items added (inception, publication, launch, periods)')

    # ---------- archaeological cultures and periods (fetch_regions.py): coarse dates kept as "c." ----------
    n_cult = 0
    for k, sl in regs['cultures'].items():
        r = det.get(k)
        if k in events or not r or not good_label(r.get('label')):
            continue
        st, en = [], []
        for prop, val, prec, cal in split_pairs(r.get('dates'), 4) + regs['dates'].get(k, []):
            dt = to_date_coarse(val, prec, cal)
            if dt:
                (st if prop in ('P580', 'P571') else en if prop in ('P582', 'P576') else []).append(dt)
        if not st and not en:
            continue
        a = min(st) if st else None
        b = max(en) if en else None
        if a is None:
            continue   # an end without a beginning cannot be put on the timeline honestly
        ev = {'i': k, 'l': r['label'], 'y': a[0], 't': 'culture', 's': max(2, sl), 'ya': 1}
        if b and b[0] > a[0]:
            ev['y2'] = b[0]
        note = ' to '.join(x for x in (a[4] or (f'c. {abs(a[0])}' + (' BC' if a[0] < 0 else '')),
                                       (b[4] or (f'c. {abs(b[0])}' + (' BC' if b[0] < 0 else ''))) if b else None) if x)
        ev['dn'] = note
        if r.get('desc'):
            ev['d'] = r['desc'][:160]
        if r.get('enwiki'):
            ev['w'] = r['enwiki']
        pt = parse_point(r.get('coord'))
        locs, wide = narrow_locs(split_pairs(r.get('locs'), 2))
        if not pt:
            for bits in locs:
                if len(bits) >= 3 and parse_point(bits[2]):
                    pt = parse_point(bits[2])
                    ev['ap'] = 1
                    break
        if pt:
            ev['lo'], ev['la'] = pt
        countries = [] if wide else split_pairs(r.get('countries'))
        if countries:
            ev['cn'] = [c[1] for c in countries[:3]]
        place(ev, countries)
        if not wide:
            place_more(ev, k)
        events[k] = ev
        n_cult += 1
    log(f'{n_cult} archaeological cultures and periods')
    n_wd = len(events)
    log(f'{n_wd} Wikidata events with label and year')

    # ---------- states founded and dissolved ----------
    pol = defaultdict(lambda: {'start': [], 'end': [], 'sl': 0})
    for r in raw['polity_changes'] + regs['polity_changes']:
        q = qid(r['item'])
        pol[q]['sl'] = int(r['sl'])
        for f in ('start', 'end'):
            t = parse_time(r.get(f))
            if t:
                pol[q][f].append(hist_year(t[0]))
    # A founding or end "in 800" is often Wikidata's way of writing "8th or 9th century" (Denmark). Ask for
    # the precision of the dates that fall on a round century; anything coarser than a year is marked
    # approximate, shown with "c." and kept out of the top of the year's list.
    round_q = sorted(q for q, v in pol.items() if any(y % 100 == 0 for y in v['start'] + v['end']))
    coarse = set()
    for prop, kind in (('P571', 'start'), ('P576', 'end')):
        for i in range(0, len(round_q), 80):
            vals = ' '.join('wd:' + q for q in round_q[i:i + 80])
            for r in sparql(f'SELECT ?item ?prec WHERE {{ VALUES ?item {{ {vals} }} ?item p:{prop} ?st . ?st psv:{prop} ?n . ?n wikibase:timePrecision ?prec . }}'):
                if int(r['prec']) <= 8:
                    coarse.add((qid(r['item']), kind))
    stats['stateDatesCoarserThanAYear'] = len(coarse)
    n_states = 0
    for q, v in pol.items():
        r = det.get(q)
        if not r or not good_label(r.get('label')):
            continue
        name = r['label']
        for f, verb in (('start', 'founded'), ('end', 'ends')):
            if not v[f]:
                continue
            y = min(v[f]) if f == 'start' else max(v[f])
            if y < -10000 or y > datetime.date.today().year:
                continue
            ev = {'i': f'{"f" if f == "start" else "x"}{q}', 'l': f'{name} {verb}', 'y': y, 't': 'state',
                  's': max(1, int(v['sl'] * 0.6)), 'w': r.get('enwiki')}
            if (q, f) in coarse and y % 100 == 0:
                ev['ya'] = 1
            if r.get('desc'):
                ev['d'] = r['desc'][:160]
            if not ev['w']:
                del ev['w']
            place(ev, [(q, name)])
            if 'p' not in ev and q in q_to_names:
                ev['p'] = q_to_names[q][0]
            if not ev.get('mc') and place_entity(ev, q):
                stats['statesPlacedByCapital'] += 1
            events[ev['i']] = ev
            n_states += 1
    log(f'{n_states} state founded/ended events')

    # ---------- rulers ----------
    seen = set()
    n_rulers = 0
    for r in sorted(raw['monarchs'], key=lambda r: (r['person'], r['start'])):
        person, pos = qid(r['person']), qid(r['pos'])
        pr, po = det.get(person), det.get(pos)
        if not pr or not po or not good_label(pr.get('label')) or not good_label(po.get('label')):
            continue
        dt = to_date(r['start'], r['prec'], qid(r['cal']))
        if not dt:
            continue
        y, m, d, approx = dt
        key = (person, y)
        if key in seen:
            continue
        seen.add(key)
        title = po['label']
        title = title[0].upper() + title[1:]
        ev = {'i': f'r{person}-{y}', 'l': f'{person_name(pr["label"], pr.get("enwiki"))} becomes {title}', 'y': y, 't': 'ruler',
              's': max(1, int(int(r['sl']) * 0.5))}
        if m:
            ev['m'] = m
        if d:
            ev['dd'] = d
        if pr.get('desc'):
            ev['d'] = pr['desc'][:160]
        if pr.get('enwiki'):
            ev['w'] = pr['enwiki']
        place(ev, [])
        j = places['pos_j'].get(pos)
        if not ev.get('mc') and j and place_entity(ev, j):
            stats['rulersPlacedByState'] += 1
        events[ev['i']] = ev
        n_rulers += 1
    log(f'{n_rulers} ruler events')

    # ---------- heads of state and government (terms) ----------
    rr_path = os.path.join(CACHE, 'rulers_raw.json')
    terms_out = defaultdict(list)
    n_terms = 0
    if os.path.exists(rr_path):
        rr = read_json(rr_path)
        lab = rr['labels']
        for t in sorted(rr['terms'], key=lambda t: -t['sl']):
            pl, posl = lab.get(t['p']), lab.get(t['pos'])
            j = rr['pos_j'].get(t['pos'])
            if not pl or not posl or not good_label(pl[0]):
                continue
            dt = to_date(t['s'], t['sp'], t['sc'])
            if not dt:
                continue
            y, m, d, _ = dt
            end = None
            if t.get('e') and parse_time(t['e']):
                end = hist_year(parse_time(t['e'])[0])
            if end is not None and end < y:
                end = None   # Wikidata has the end before the start: keep the start only
            key = (t['p'], y)
            title = posl[0][0].upper() + posl[0][1:]
            terms_out[j].append([pl[0], y, end, title, t['p']])
            n_terms += 1
            if key in seen:
                continue
            seen.add(key)
            ev = {'i': f'r{t["p"]}-{y}', 'l': f'{person_name(pl[0], pl[1])} becomes {title}', 'y': y, 't': 'ruler', 's': max(1, int(t['sl'] * 0.5))}
            if m:
                ev['m'] = m
            if d:
                ev['dd'] = d
            if end and end > y:
                ev['y2'] = end
            if pl[1]:
                ev['w'] = pl[1]
            place(ev, [(j, lab.get(j, [''])[0])] if j else [])
            if not ev.get('mc') and j and place_entity(ev, j):
                stats['rulersPlacedByState'] += 1
            events[ev['i']] = ev
            n_rulers += 1
        # well-known people whose office Wikidata does not file under a ruling class or a country
        # (fetch_famous.py): Charlemagne as "king of Franks", shoguns, party general secretaries
        flab = fam['labels']
        n_fr = 0
        for t in sorted(fam['terms'], key=lambda t: (-t['sl'], t['k'] != 'P39')):
            pl, posl = flab.get(t['p']), flab.get(t['pos'])
            if not pl or not posl or not good_label(pl[0]):
                continue
            dt = to_date(t['s'], t['sp'], t['sc'])
            if not dt:
                continue
            y, m, d, _ = dt
            end = None
            if t.get('e') and parse_time(t['e']):
                end = hist_year(parse_time(t['e'])[0])
            if end is not None and end < y:
                end = None
            j = posl[2] if len(posl) > 2 else None
            title = posl[0][0].upper() + posl[0][1:]
            if j and t['k'] == 'P39':
                terms_out[j].append([pl[0], y, end, title, t['p']])
                lab.setdefault(j, [flab.get(j, [j])[0] if flab.get(j) else (det.get(j) or {}).get('label', j), None])
            key = (t['p'], y)
            if key in seen:
                continue
            seen.add(key)
            ev = {'i': f'r{t["p"]}-{y}', 'l': f'{person_name(pl[0], pl[1])} becomes {title}', 'y': y, 't': 'ruler', 's': max(1, int(t['sl'] * 0.5))}
            if m:
                ev['m'] = m
            if d:
                ev['dd'] = d
            if end and end > y:
                ev['y2'] = end
            if pl[1]:
                ev['w'] = pl[1]
            place(ev, [])
            jj = j or places['pos_j'].get(t['pos'])
            if not ev.get('mc') and jj and place_entity(ev, jj):
                stats['rulersPlacedByState'] += 1
            events[ev['i']] = ev
            n_rulers += 1
            n_fr += 1
        log(f'{n_fr} more ruler events from well-known people')
        # ---------- rulers Wikidata does not file under the state on the map (build_rulers.py) ----------
        map_names = read_json(os.path.join(CACHE, 'names.json'))
        rmap = read_json(os.path.join(TOOLS, 'curated', 'ruler_map.json'))

        def key_of(name):
            """terms.json key of a map territory: its Wikidata id, else "n:<name>"."""
            return ents[name]['q'] if name in ents else 'n:' + name

        def first_entity(names_):
            return next((ents[n]['q'] for n in names_ if n in ents), None)

        extra_path = os.path.join(CACHE, 'rulers_extra.json')
        n_extra = 0
        if os.path.exists(extra_path):
            ex = read_json(extra_path)
            xlab = ex['labels']
            pos_to = {p_['q']: p_['to'] for p_ in rmap['positions']}
            for t in sorted(ex['terms'], key=lambda t: -t['sl']):
                pl, posl = xlab.get(t['p']), xlab.get(t['pos'])
                if not pl or not posl or not good_label(pl[0]):
                    continue
                dt = to_date(t['s'], t['sp'], t['sc'])
                if not dt:
                    continue
                y, m, d, _ = dt
                end = None
                if t.get('e') and parse_time(t['e']):
                    end = hist_year(parse_time(t['e'])[0])
                if end is not None and end < y:
                    end = None
                title = posl[0][0].upper() + posl[0][1:]
                terms_out['pos:' + t['pos']].append([pl[0], y, end, title, t['p']])
                n_terms += 1
                n_extra += 1
                if (t['p'], y) in seen:
                    continue
                seen.add((t['p'], y))
                ev = {'i': f'r{t["p"]}-{y}', 'l': f'{person_name(pl[0], pl[1])} becomes {title}', 'y': y, 't': 'ruler', 's': max(1, int(t['sl'] * 0.5))}
                if m:
                    ev['m'] = m
                if d:
                    ev['dd'] = d
                if end and end > y:
                    ev['y2'] = end
                if pl[1]:
                    ev['w'] = pl[1]
                place(ev, [])
                jj = first_entity([n for n in pos_to.get(t['pos'], []) if n in map_names and map_names[n][0] - 5 <= y <= map_names[n][-1] + 5])
                if not ev.get('mc') and jj and place_entity(ev, jj):
                    stats['rulersPlacedByState'] += 1
                events[ev['i']] = ev
                n_rulers += 1
        # attach terms to the map territories named in tools/curated/ruler_map.json, by overlapping years
        n_att = 0
        for src, to, only in [(j_['q'], j_['to'], j_.get('title')) for j_ in rmap['jurisdictions']] + [('pos:' + p_['q'], p_['to'], None) for p_ in rmap['positions']]:
            for name in to:
                ys = map_names.get(name)
                if not ys or key_of(name) == src:
                    continue
                dst = terms_out[key_of(name)]
                have_t = {(x[4], x[1]) for x in dst}
                for x in list(terms_out.get(src, [])):
                    if only and not re.search(only, x[3]):
                        continue
                    last = x[2] if x[2] is not None else x[1]
                    if x[1] <= ys[-1] + 2 and last >= ys[0] - 2 and (x[4], x[1]) not in have_t:
                        dst.append(list(x[:5]))
                        have_t.add((x[4], x[1]))
                        n_att += 1
                lab.setdefault(key_of(name), [name, None])
        for k_ in [k_ for k_ in terms_out if k_.startswith('pos:')]:
            del terms_out[k_]
        # curated ruler lists, checked against Wikidata by tools/build_rulers.py
        cr_path = os.path.join(CACHE, 'curated_rulers.json')
        n_cur_r = n_cur_ev = 0
        if os.path.exists(cr_path):
            for l in read_json(cr_path)['lists']:
                for r in l['rulers']:
                    flag = ('c' if r['verified'] else 'u') + ('a' if l['approx'] else '')
                    for name in l['polities']:
                        if name not in map_names:
                            continue
                        dst = terms_out[key_of(name)]
                        if any((r['q'] and x[4] == r['q'] or x[0] == r['name']) and abs(x[1] - r['from']) <= 2 for x in dst):
                            continue
                        dst.append([r['name'], r['from'], r['to'], l['title'], r['q'] or '', flag])
                        lab.setdefault(key_of(name), [name, None])
                        n_cur_r += 1
                    if r['q'] and any((r['q'], r['from'] + k_) in seen for k_ in (-1, 0, 1)):
                        continue
                    if r['q']:
                        seen.add((r['q'], r['from']))
                    ev = {'i': f"cr{r['q'] or re.sub(r'[^a-z]+', '', r['name'].lower())}-{r['from']}", 'l': f"{r['name']} becomes {l['title']}",
                          'y': r['from'], 't': 'ruler', 's': 12, 'w': r['wiki'], 'cur': 2}
                    if r['to'] > r['from']:
                        ev['y2'] = r['to']
                    if not r['verified']:
                        ev['uv'] = 1
                    if l['approx']:
                        ev['ya'] = 1
                    place(ev, [])
                    jj = first_entity(l['polities'])
                    if not ev.get('mc') and jj:
                        place_entity(ev, jj)
                    events[ev['i']] = ev
                    n_cur_ev += 1
        stats['rulerTermsFromOffices'] = n_extra
        stats['rulerTermsAttachedToMapTerritories'] = n_att
        stats['curatedRulerTerms'] = n_cur_r
        stats['curatedRulerEvents'] = n_cur_ev
        rdir = os.path.join(DATA, 'rulers')
        os.makedirs(rdir, exist_ok=True)
        rulers_doc = {}
        n_inf = 0
        # only heads of state and of government count as "in office" (tools/ruler_titles.py); offices that
        # Wikidata files under a state but that did not rule it are left out (ruler_map.json, "exclude")
        excl = {x_['q']: re.compile(x_['title']) for x_ in rmap.get('exclude', [])}
        n_not_ruler = 0
        for j, lst in terms_out.items():
            n0 = len(lst)
            lst = [x for x in lst if is_ruler_title(x[3]) and not (j in excl and excl[j].search(x[3]))]
            n_not_ruler += n0 - len(lst)
            if not lst:
                continue
            for x in lst:      # an office named after its list article ("List of Safavid monarchs")
                m_ = re.match(r'^List of (.+?)s$', x[3])
                if m_:
                    x[3] = m_.group(1)[0].upper() + m_.group(1)[1:]
            lst = sorted({tuple(x) for x in lst}, key=lambda x: (x[1], x[0]))
            lst = [list(x) for x in lst]
            # a term without an end: the next holder of the same office within 80 years ends it ("i" = inferred)
            for i_, x in enumerate(lst):
                if x[2] is None:
                    nxt = next((z for z in lst[i_ + 1:] if z[3] == x[3] and z[4] != x[4] and z[1] > x[1]), None)
                    if nxt and nxt[1] - x[1] <= 80:
                        x[2] = nxt[1]
                        x[5:] = [(x[5] if len(x) > 5 else '') + 'i']
                        n_inf += 1
            rulers_doc[j] = {'n': lab.get(j, [j])[0], 'terms': lst}
        stats['rulerTermEndsInferredFromSuccessor'] = n_inf
        stats['termsLeftOutAsNotRulers'] = n_not_ruler
        # "X becomes Mayor of a place in Hungary" and the like are not ruler events either
        for k_ in [k_ for k_, e_ in events.items() if e_['t'] == 'ruler' and ' becomes ' in e_['l'] and not e_.get('cur')
                   and not is_ruler_title(e_['l'].split(' becomes ', 1)[1])]:
            del events[k_]
            stats['rulerEventsLeftOutAsNotRulers'] += 1
        write_json(os.path.join(rdir, 'terms.json'), rulers_doc)
        log(f'{n_terms} terms in {len(rulers_doc)} jurisdictions')

    # ---------- people (optional filter) and foundings ----------
    n_people = n_found = 0
    for kind_list, prop in ((extra['people'], None),):
        pass
    by_year = defaultdict(list)
    for x in extra['people']:
        r = det.get(x['p'])
        if not r or not good_label(r.get('label')):
            continue
        for prop, val, prec, cal, pc in extra['dates'].get(x['p'], []):
            if (prop == 'P569') != (x['k'] == 'birth') or prop not in ('P569', 'P570'):
                continue
            dt = to_date(val, prec, cal)
            if not dt:
                continue
            y, m, d, _ = dt
            ev = {'i': f'{x["k"][0]}{x["p"]}', 'l': f'{"Birth" if x["k"] == "birth" else "Death"} of {r["label"]}', 'y': y,
                  't': x['k'], 's': max(1, x['sl'] // 3)}
            if m:
                ev['m'] = m
            if d:
                ev['dd'] = d
            if r.get('desc'):
                ev['d'] = r['desc'][:160]
            if r.get('enwiki'):
                ev['w'] = r['enwiki']
            pt = parse_point(pc)
            if pt:
                ev['lo'], ev['la'] = pt
            by_year[(y, x['k'])].append(ev)
            break
    for (y, k), lst in by_year.items():
        for ev in sorted(lst, key=lambda e: -e['s'])[:12]:   # the 12 most notable births and deaths per year
            place(ev, [])
            events[ev['i']] = ev
            n_people += 1
    for q, v in extra['found'].items():
        r = det.get(q)
        if not r or not good_label(r.get('label')):
            continue
        ds = [to_date(val, prec, cal) for prop, val, prec, cal, _ in extra['dates'].get(q, []) if prop == 'P571']
        ds = [d for d in ds if d]
        if not ds:
            continue
        y, m, d, approx = min(ds)
        ev = {'i': f'n{q}', 'l': f'{r["label"]} founded', 'y': y, 't': 'founding', 's': max(1, int(v['sl'] * 0.4))}
        if m:
            ev['m'] = m
        if d:
            ev['dd'] = d
        if approx:
            ev['ya'] = 1
        if r.get('desc'):
            ev['d'] = r['desc'][:160]
        if r.get('enwiki'):
            ev['w'] = r['enwiki']
        pt = parse_point(r.get('coord'))
        if pt:
            ev['lo'], ev['la'] = pt
        place(ev, split_pairs(r.get('countries')))
        events[ev['i']] = ev
        n_found += 1
    for q, v in regs['settle'].items():
        r = det.get(q)
        if f'n{q}' in events or not r or not good_label(r.get('label')):
            continue
        ds = [to_date_coarse(val, prec, cal) for prop, val, prec, cal in regs['dates'].get(q, []) if prop == 'P571']
        ds = [d for d in ds if d]
        if not ds:
            continue
        y, m, d, approx, note = min(ds)
        # the regional pass is for the thin early cells: after 1600 only better-known towns are kept
        # (Central Asia is thin in every era and keeps them all)
        # (towns on 25+ editions are in the global foundings pass anyway)
        if v['kind'] == 'city' and y >= 1600 and not (48 < (parse_point(r.get('coord')) or (0, 0))[0] < 88
                                                      and 35 < (parse_point(r.get('coord')) or (0, 0))[1] < 56):
            continue
        ev = {'i': f'n{q}', 'l': f'{r["label"]} founded' if v['kind'] == 'city' else f'{r["label"]} built' if v['kind'] == 'built'
              else f'{r["label"]} (archaeological site) first occupied',
              'y': y, 't': 'founding', 's': max(1, int(v['sl'] * 0.4))}
        if m:
            ev['m'] = m
        if d:
            ev['dd'] = d
        if approx:
            ev['ya'] = 1
        if note:
            ev['dn'] = note
        if r.get('desc'):
            ev['d'] = r['desc'][:160]
        if r.get('enwiki'):
            ev['w'] = r['enwiki']
        pt = parse_point(r.get('coord'))
        if pt:
            ev['lo'], ev['la'] = pt
        place(ev, split_pairs(r.get('countries')))
        events[ev['i']] = ev
        n_found += 1
    log(f'{n_people} births and deaths, {n_found} foundings')

    # ---------- Wikipedia year articles (dated links; only what Wikidata does not already have) ----------
    yp_path = os.path.join(CACHE, 'yearpage_events.json')
    n_yp = 0
    yp_pages = 0
    if os.path.exists(yp_path):
        yp = read_json(yp_path)
        yp_pages = yp['pages']
        have_w = {e.get('w') for e in events.values()}
        def put(ev, at):
            """Place a year-article event at the first linked article that has coordinates."""
            if ev.get('lo') is None and at:
                ev['lo'], ev['la'] = at[0], at[1]
                ev['mi' if at[2] else 'ap'] = 1

        n_text = 0
        for i, f in enumerate(yp['events']):
            q = f.get('q')
            have = events.get(q) or events.get(f'f{q}') or events.get(f'x{q}') or events.get(f'n{q}')
            if have is not None and f.get('text') and not have.get('d') and have['y'] == f['y']:
                # the event is already there from Wikidata but has no description: use the bullet's sentence
                have['d'], have['wx'] = f['text'], 1
                have.setdefault('src', f['source'])
                n_text += 1
            if not f.get('verified') or have is not None \
                    or f['link'] in have_w or JUNK.search(f['link']) or YP_SKIP.search(f['link']):
                continue
            ev = {'i': q or f"wp{f['y']}-{i}", 'l': re.sub(r'\s*\([^)]*\)$', '', f['link']), 'y': f['y'], 't': 'other', 's': 3,
                  'w': f['link'], 'src': f['source']}
            # the day in the bullet belongs to the bullet's own event: only trust it for the bullet's first link
            if f.get('first') and f['m']:
                ev['m'] = f['m']
                if f['d']:
                    ev['dd'] = f['d']
            r = det.get(q)
            if r:
                if r.get('desc'):
                    ev['d'] = r['desc'][:160]
                pt = parse_point(r.get('coord'))
                if pt:
                    ev['lo'], ev['la'] = pt
            if f.get('text'):
                ev['d'], ev['wx'] = f['text'], 1     # the bullet's own sentence (Wikipedia, CC BY-SA)
                n_text += 1
            ev['t'] = classify(f.get('text') or ev.get('d') or '', ev['l'], f.get('head', ''))
            put(ev, f.get('at'))
            place(ev, [])
            events[ev['i']] = ev
            have_w.add(f['link'])
            n_yp += 1
        # the other bullets: complete sentences whose date nothing but the year article confirms
        n_bul = n_bul_dup = 0
        norm_l = lambda t: re.sub(r'[^a-z0-9]+', ' ', t.lower()).strip()
        have_ly = {(norm_l(e['l']), e['y']): e for e in events.values()}
        for b in yp.get('bullets', []):
            text = b['text']
            # the same news as an event already there (a ruler taking office, or the same wording): the bullet
            # only confirms it, and gives it a day when it has none
            dup = have_ly.get((norm_l(text), b['y']))
            if dup is None and classify(text, '', b.get('head', '')) == 'ruler':
                dup = next((events[k_] for l_, q_ in b.get('links', []) for k_ in (f'r{q_}-{b["y"]}', f'cr{q_}-{b["y"]}') if k_ in events), None)
            if dup is not None:
                if b['m'] and not dup.get('m') and dup['t'] == 'ruler':
                    dup['m'] = b['m']
                    if b['d']:
                        dup['dd'] = b['d']
                n_bul_dup += 1
                continue
            label = text
            if len(label) > 110:
                label = label[:108].rsplit(' ', 1)[0].rstrip(',;:') + '\u2026'
            ev = {'i': b['id'], 'l': label, 'y': b['y'], 't': classify(text, '', b.get('head', '')), 's': 2,
                  'src': b['source'], 'uv': 1, 'wx': 1}
            if label != text:
                ev['d'] = text
            if b['m']:
                ev['m'] = b['m']
                if b['d']:
                    ev['dd'] = b['d']
            put(ev, b.get('at'))
            place(ev, [])
            events[ev['i']] = ev
            n_bul += 1
        stats['yearArticleSentences'] = n_text
        stats['yearArticleUnverified'] = n_bul
        stats['yearArticleBulletsSameAsAnEvent'] = n_bul_dup
        log(f'{n_yp} events added from {yp_pages} Wikipedia year articles')

    # ---------- curated supplement ----------
    sup = read_json(os.path.join(TOOLS, 'supplement_events.json'))['events']
    for s0 in sup:
        s0['_rev'] = 1
    # curated period supplements (tools/curated/events/*.json), each entry cross-checked against Wikidata
    # by tools/build_curated.py, which writes the checked list to the cache
    cur_path = os.path.join(CACHE, 'curated_events.json')
    if os.path.exists(cur_path):
        sup = sup + read_json(cur_path)['events']
    by_wiki = defaultdict(list)
    for e in events.values():
        if e.get('w'):
            by_wiki[e['w']].append(e)
    n_merged = n_added = 0
    for s in sup:
        # "X founded", "X ends" and "P becomes T" are derived from a state or a person, not the event itself
        match = [e for e in by_wiki.get(s['wiki'], []) if e['y'] == s['y'] and e['t'] not in ('ruler', 'birth', 'death')
                 and not re.search(r' (founded|ends)$| becomes ', e['l'])]
        if match and (s.get('_rev') or s.get('own')):
            e = match[0]
            n_merged += 1
            if s.get('m'):
                e['m'] = s['m']
                if s.get('d'):
                    e['dd'] = s['d']
            if s.get('lon') is not None and (e.get('lo') is None or e.get('ap') or e.get('mi')):
                e['lo'], e['la'] = s['lon'], s['lat']
                e.pop('ap', None)
                e.pop('mi', None)
                e.pop('p', None)
                place(e, [])
            if s.get('colony'):
                e['c'] = s['colony']
                e['ci'] = us_by_name.get(s['colony'])
            e['s'] = max(e['s'], 25)
            continue
        if match:
            # the event is already there under its Wikidata item: only lift its rank and fill gaps
            e = match[0]
            n_merged += 1
            e['_lm'] = 1     # a curated landmark: ranked with the curated events
            if s['label'].lower() != e['l'].lower() and len(s['label']) <= 60 and s['label'] == s['wiki']:
                e['al'] = sorted(set(e.get('al', [])) | {s['label']})
            e['s'] = max(e['s'], 25)
            if s.get('m') and not e.get('m'):
                e['m'] = s['m']
                if s.get('d'):
                    e['dd'] = s['d']
            if s.get('lon') is not None and e.get('lo') is None:
                e['lo'], e['la'] = s['lon'], s['lat']
                place(e, [])
            continue
        ev = {'i': s['id'], 'l': s['label'], 'y': s['y'], 't': s['type'],
              's': 25, 'd': s['desc'], 'w': s['wiki'], 'cur': 1 if s.get('_rev') else 2}
        if s.get('m'):
            ev['m'] = s['m']
            if s.get('d'):
                ev['dd'] = s['d']
        if s.get('lon') is not None:
            ev['lo'], ev['la'] = s['lon'], s['lat']
        if s.get('_rev') is None and not s.get('verified'):
            ev['uv'] = 1
        if s.get('y2') and s['y2'] > s['y']:
            ev['y2'] = s['y2']
        if s.get('approx'):
            ev['ya'] = 1
        if s.get('colony'):
            ev['c'] = s['colony']
            ev['ci'] = us_by_name.get(s['colony'])
        place(ev, [])
        events[ev['i']] = ev
        n_added += 1
    log(f'supplement: {n_merged} merged into Wikidata events, {n_added} added')
    for e in events.values():
        if e.get('ci') is None:
            e.pop('ci', None)

    # ---------- duplicates: same name in the same year (two Wikidata items, or Wikidata + curated) ----------
    best = {}
    for e in sorted(events.values(), key=lambda e: (-e.get('cur', 0), -e['s'])):
        key = (e['l'].lower(), e['y'])
        if key in best:
            keep = best[key]
            for f in ('lo', 'la', 'c', 'ci', 'm', 'dd', 'w', 'd'):
                if f not in keep and f in e:
                    keep[f] = e[f]
            continue
        best[key] = e
    n_dup = len(events) - len(best)
    events = {e['i']: e for e in best.values()}
    log(f'{n_dup} duplicate events merged')

    # ---------- extra names (tools/curated/aliases.json) ----------
    extra_names = read_json(os.path.join(TOOLS, 'curated', 'aliases.json'))['aliases']
    for e in events.values():
        if e['l'] in extra_names and e['t'] not in ('ruler', 'birth', 'death'):
            e['al'] = sorted(set(e.get('al', [])) | set(extra_names[e['l']]))
            stats['curatedAliases'] += 1

    # ---------- hand corrections (tools/curated/event_overrides.json) ----------
    for o in read_json(os.path.join(TOOLS, 'curated', 'event_overrides.json'))['overrides']:
        e = events.get(o['q'])
        if e:
            e.update(o['set'])
            e['on'] = o['note']
            stats['handCorrections'] += 1

    # ---------- parents by Wikidata id, not by name ----------
    # Several wars share a name ("Nine Years' War" 1593 and 1688, "Anglo-Spanish War" six times), and the
    # "part of" text used to be matched by name. Wars with a shared name get their first year in the name.
    by_label = defaultdict(list)
    for e in events.values():
        if e['t'] == 'war':
            by_label[e['l']].append(e)
    for lst in by_label.values():
        if len(lst) > 1:
            for e in lst:
                e['l'] = f"{e['l']} ({e['y'] if e['y'] > 0 else str(-e['y']) + ' BC'})"
                stats['warsRenamedWithYear'] += 1
    war_labels = {e['l'] for e in events.values() if e['t'] == 'war'}
    for k, pq in parent_q.items():
        e = events.get(k)
        if not e or 'po' not in e:
            continue
        par = events.get(pq)
        if par:
            e['po'] = par['l']
            e['pq'] = pq
        elif e['po'] in by_label and len(by_label[e['po']]) > 1:
            pass   # parent not in our data and its name is shared by several wars: the text stays, unlinked
    # Events dated outside the war they are filed under: decide which side is wrong.
    for k, e in events.items():
        par = events.get(e.get('pq'))
        if not par or par['t'] != 'war' or not par.get('y2'):
            continue
        if par['y'] - 1 <= e['y'] <= par['y2'] + 1:
            continue
        stats['outsideWar'] += 1
        years_in_name = set(re.findall(r'(?<!\d)(\d{3,4})(?!\d)', e['l'] + ' ' + e.get('w', '')))
        gap = min(abs(e['y'] - par['y']), abs(e['y'] - par['y2']))
        e2 = e.get('y2') or e['y']
        if str(abs(e['y'])) in years_in_name:
            # the event's own name carries its year, so the parent link is the wrong side
            del e['po'], e['pq']
            stats['outsideWar:detached (the event name carries its year)'] += 1
        elif e['y'] < par['y'] and e2 > par['y2']:
            # the "part" is longer than the whole: the relation is the wrong way round on Wikidata
            del e['po'], e['pq']
            stats['outsideWar:detached (longer than its parent)'] += 1
        elif e['y'] < par['y'] <= e2:
            stats['outsideWar:kept (started earlier, overlaps the war)'] += 1
        elif gap > 20:
            del e['po'], e['pq']
            e['dq'] = 1
            stats['outsideWar:detached and date marked doubtful (more than 20 years off)'] += 1
        else:
            e['dq'] = 1
            stats['outsideWar:kept, date marked doubtful (within 20 years)'] += 1
    # last fallback for placement: the country of the parent event
    for k, e in events.items():
        if e.get('mc') or e['t'] in ('birth', 'death'):
            continue
        par = events.get(e.get('pq'))
        hops = 0
        while par is not None and not par.get('mc') and hops < 3:
            par = events.get(par.get('pq'))
            hops += 1
        if par is not None and par.get('mc'):
            e['mc'] = par['mc']
            e['mi'] = 1
            stats['placedByParent'] += 1
    log('placement and consistency: ' + json.dumps(dict(sorted(stats.items()))))

    # ---------- rank ----------
    # The raw score is the number of Wikipedia editions of the item an event was made from. That is the
    # event itself for a battle or a treaty, but for "X founded", "X ends" and "P becomes T" it is the fame of
    # the city, state or person, which says little about the event: Istanbul "founded" in 1453 outranked the
    # fall of Constantinople. So derived events are compressed, periods that run for decades count less in
    # their first year, and the curated landmark events of each period are lifted near the top.
    by_year_ev = defaultdict(list)
    n_lab = 0
    for e in events.values():
        # a Wikidata label cut off in the middle of a word ("Peace of Westph"): use the article title
        w0 = e.get('w') or ''
        if w0.startswith(e['l']) and len(w0) > len(e['l']) and w0[len(e['l'])].isalpha() and e['l'][-1:].isalpha():
            e['l'] = re.sub(r'\s*\([^)]*\)$', '', w0)
            n_lab += 1
    stats['labelsCompletedFromArticleTitle'] = n_lab
    for e in events.values():
        sc = e['s']
        lbl, typ = e['l'], e['t']
        span = (e.get('y2') or e['y']) - e['y']
        derived = bool(re.search(r' (founded|ends)$', lbl)) or bool(e.pop('_inc', None))
        if typ == 'ruler' and ' becomes ' in lbl:
            if sc > 30:
                sc = 30 + (sc - 30) * 0.2
        elif derived and typ == 'founding':
            sc = min(sc, 22)
        elif derived and e.get('ya'):
            sc = min(sc, 18)        # a founding known only to the century is not the news of that year
        elif derived and sc > 45:
            sc = 45 + (sc - 45) * 0.07
        if typ not in ('ruler', 'birth', 'death', 'culture') and span >= (50 if typ == 'war' else 40):
            sc *= 0.6 if typ == 'war' else 0.4
        if sc > 100:
            sc = 100 + (sc - 100) * 0.2
        lm = e.pop('_lm', None)
        if e.get('ya') or e.get('uv'):
            pass        # approximate or unconfirmed curated entries are not lifted
        elif (e.get('cur') == 2 and not e['i'].startswith('cr')) or lm:
            sc = max(sc, 80 + min(e['s'], 100) * 0.15)
        elif e.get('cur') == 1:
            sc = max(sc, 30)
        e['s'] = max(1, int(round(sc)))
        if typ not in ('birth', 'death'):
            by_year_ev[e['y']].append(e)
    # the defining event of a famous year leads its list (tools/curated/headlines.json)
    for hl in read_json(os.path.join(TOOLS, 'curated', 'headlines.json'))['headlines']:
        hit = [e for e in by_year_ev.get(hl['y'], []) if re.search(hl['match'], e['l']) and not e.get('uv')]
        if not hit:
            log(f"  headline for {hl['y']} matches no event: {hl['match']}")
        for e in hit:
            e['s'] = max(e['s'], 130)
            e['hl'] = 1
        stats['headlines'] += len(hit)
    n_demoted = 0
    for y, lst in by_year_ev.items():
        others = [o for o in lst if o['t'] != 'ruler' and not o.get('uv') and o['s'] >= 20]
        cur_w = {o.get('w'): o for o in lst if o.get('cur') == 2 and o.get('w')}
        for e in lst:
            # a ruler whose name is in the label of another event of the year ("Death of Muhammad; Abu Bakr
            # becomes caliph") is the same news: keep it just below that event
            if e['t'] == 'ruler' and ' becomes ' in e['l'] and not e.get('cur'):
                who = e['l'].split(' becomes ')[0]
                top = max((o['s'] for o in others if re.search(r'\b' + re.escape(who) + r'\b', o['l'])), default=None)
                if top is not None and e['s'] >= top:
                    e['s'] = top - 1
                    n_demoted += 1
            # "X founded" next to a curated event about the same article
            elif re.search(r' (founded|ends)$', e['l']) and e.get('w') in cur_w and cur_w[e['w']] is not e and e['s'] > 20:
                e['s'] = 20
                n_demoted += 1
    stats['rankDemotedAsDuplicateNews'] = n_demoted

    # ---------- shards ----------
    # nothing before the first border map (Wikidata has a few geological "events" millions of years ago)
    events = {k: e for k, e in events.items() if e['y'] >= -130000}
    evs = sorted(events.values(), key=lambda e: (e['y'], e.get('m', 0), e.get('dd', 0), -e['s']))
    per_year = Counter(e['y'] for e in evs)
    blocks = []

    def count(a, b):
        return sum(n for y, n in per_year.items() if a <= y < b)

    blocks.append((-200000, -10000))
    for a, b, opts in [(-10000, -1000, [9000, 1000, 500, 100]), (-1000, 1000, [500, 100, 50]),
                       (1000, 2100, [100, 50, 25, 10, 5, 2, 1])]:
        y = a
        while y < b:
            for o in opts:
                if (y - a) % o == 0 and o <= (b - y) and (count(y, y + o) <= 900 or o == opts[-1]):
                    blocks.append((y, y + o))
                    y += o
                    break
            else:
                blocks.append((y, y + opts[-1]))
                y += opts[-1]
    out_blocks = []
    edir = os.path.join(DATA, 'events')
    os.makedirs(edir, exist_ok=True)
    for f in os.listdir(edir):
        os.remove(os.path.join(edir, f))
    long_events = [e for e in evs if e.get('y2') and e['y2'] > e['y'] and e['s'] >= 8]
    total_size = 0
    for a, b in blocks:
        inside = [e for e in evs if a <= e['y'] < b]
        if not inside:
            continue
        ongoing = [e for e in long_events if e['y'] < a and e['y2'] >= a]
        ongoing = sorted(ongoing, key=lambda e: -e['s'])[:60]
        fname = f'{a}_{b}.json'
        size = write_json(os.path.join(edir, fname), {'a': a, 'b': b, 'events': inside, 'ongoing': ongoing})
        total_size += size
        out_blocks.append({'a': a, 'b': b, 'f': fname, 'n': len(inside)})
    counts = {str(y): n for y, n in sorted(per_year.items())}
    write_json(os.path.join(edir, 'index.json'), {'blocks': out_blocks, 'counts': counts})
    log(f'{len(out_blocks)} event files, {total_size // 1024} KB total')

    # ---------- search ----------
    names = read_json(os.path.join(CACHE, 'names.json'))
    pol_area = defaultdict(int)
    for s in bindex:
        doc = read_json(os.path.join(DATA, 'borders', f'{s["y"]}.json'))
        for p in doc['polities']:
            pol_area[p['n']] = max(pol_area[p['n']], p['a'])
    for y in range(min(a for a, b in yearly.ranges().values()), cs_index['to'] + 1):
        for p in snap_index(y)[1][1]:
            pol_area[p['n']] = max(pol_area[p['n']], p['a'])
    polities = []
    for n, ys in sorted(names.items()):
        if n in pol_area:
            # consecutive CShapes years collapse into [first, last] ranges to keep the file small
            rng = []
            for y in ys:
                if rng and y == rng[-1][1] + 1 and yearly.source(y) and yearly.source(y - 1):
                    rng[-1][1] = y
                else:
                    rng.append([y, y])
            polities.append([n, [r[0] if r[0] == r[1] else r for r in rng], round(pol_area[n] / 1e5, 1)] + ([names_mod.aliases(n)] if names_mod.aliases(n) else []))
    modern = []
    for f in mod['features']:
        p = f['properties']
        iso = p.get('ISO_A2_EH') if p.get('ISO_A2_EH') not in (None, '-99') else p.get('ADM0_A3')
        alt = sorted({x for x in (p.get('NAME'), p.get('NAME_LONG'), p.get('FORMAL_EN'), p.get('ABBREV')) if x and x != p.get('NAME_EN')})
        modern.append([p.get('NAME_EN') or p.get('NAME'), iso, alt])
    usl = {}
    for f in us:
        p = f['properties']
        k = (p['n'], p['id'])
        y0, y1 = p['s'] // 10000, min(p['e'] // 10000, 2000)
        if k in usl:
            usl[k][2] = min(usl[k][2], y0)
            usl[k][3] = max(usl[k][3], y1)
        else:
            usl[k] = [p['n'], p['id'], y0, y1]
    top = sorted(evs, key=lambda e: -e['s'])
    sev = [[e['l'], e['i'], e['y'], '', e['s']] + ([e['al']] if e.get('al') else []) for e in top if e['s'] >= 8 or e.get('cur')][:12000]
    places = []
    for n, e in ents.items():
        for c in e.get('cap', []):
            if n in names and c != n:
                places.append([c, n, [names[n][0], names[n][-1]]])
    sz = write_json(os.path.join(DATA, 'search.json'), {'polities': polities, 'modern': modern, 'us': list(usl.values()),
                                                        'events': sev, 'places': places})
    log(f'search.json: {len(polities)} territories, {len(sev)} events, {len(places)} capitals, {sz // 1024} KB')

    # ---------- meta ----------
    by_type = Counter(e['t'] for e in evs)
    # region x era table (region from today's country, Natural Earth subregions grouped)
    REG = {'Eastern Asia': 'East Asia', 'Southern Asia': 'South Asia', 'South-Eastern Asia': 'Southeast Asia',
           'Central Asia': 'Central Asia', 'Western Asia': 'Middle East', 'Northern Africa': 'North Africa',
           'Northern America': 'North America', 'Caribbean': 'Latin America', 'Central America': 'Latin America',
           'South America': 'Latin America', 'Australia and New Zealand': 'Oceania', 'Melanesia': 'Oceania',
           'Micronesia': 'Oceania', 'Polynesia': 'Oceania'}
    sub = {}
    for f in mod['features']:
        p = f['properties']
        iso = p.get('ISO_A2_EH') if p.get('ISO_A2_EH') not in (None, '-99') else p.get('ADM0_A3')
        sr = p.get('SUBREGION') or ''
        sub[iso] = REG.get(sr, 'Sub-Saharan Africa' if 'Africa' in sr else 'Europe' if 'Europe' in sr else sr or 'Other')
    era_cuts = [(-10**6, -500, 'before 500 BC'), (-500, 500, '500 BC-AD 500'), (500, 1000, '500-1000'), (1000, 1500, '1000-1500'),
                (1500, 1700, '1500-1700'), (1700, 1800, '1700s'), (1800, 1900, '1800s'), (1900, 3000, '1900-today')]
    grid = defaultdict(Counter)
    for e in evs:
        if e['t'] in ('birth', 'death'):
            continue
        rg = sub.get(e.get('mc'), 'unplaced')
        era = next(l for a, b, l in era_cuts if a <= e['y'] < b)
        grid[rg][era] += 1
    eras = [('before 3000 BC', -10**6, -3000), ('3000 BC to 500 BC', -3000, -500), ('500 BC to AD 500', -500, 500),
            ('500 to 1500', 500, 1500), ('1500 to 1800', 1500, 1800), ('1800 to 1900', 1800, 1900),
            ('1900 to today', 1900, 3000)]
    by_era = {label: sum(1 for e in evs if a <= e['y'] < b) for label, a, b in eras}
    meta = {
        'built': datetime.date.today().isoformat(),
        'borders': {'first': snap_years[0], 'last': snap_years[-1], 'years': snap_years},
        'counts': {
            'snapshots': len(snap_years),
            'polityNames': len(polities),
            'linkedToWikidata': len(ents),
            'events': len(evs),
            'eventsFromWikidata': len(evs) - n_added - stats.get('yearArticleUnverified', 0) - stats.get('curatedRulerEvents', 0),
            'stateChanges': n_states, 'rulers': n_rulers,
            'yearArticles': yp_pages, 'yearArticleEvents': n_yp, 'yearArticleSentences': stats.get('yearArticleSentences', 0), 'yearArticleUnverified': stats.get('yearArticleUnverified', 0),
            'rulerTerms': n_terms, 'curatedRulerTerms': stats.get('curatedRulerTerms', 0), 'rulerTermsAttached': stats.get('rulerTermsAttachedToMapTerritories', 0), 'headlines': stats.get('headlines', 0), 'birthsDeaths': n_people, 'foundings': n_found,
            'curated': n_added + n_merged, 'curatedAdded': n_added, 'curatedMerged': n_merged,
            'withCoordinates': sum(1 for e in evs if e.get('lo') is not None),
            'coordinatesFromLocation': sum(1 for e in evs if e.get('ap')),
            'usStateVersions': len(us),
            'famousItems': n_fam, 'cultures': n_cult,
            'placedInModernCountry': sum(1 for e in evs if e.get('mc')),
            'yearlyMaps': sum(b - a + 1 for a, b in yearly.ranges().values()),
        },
        'consistency': dict(sorted(stats.items())),
        'eventsByType': {t: by_type.get(t, 0) for t in TYPE_ORDER},
        'eventsByEra': by_era,
        'eventsByRegionEra': {rg: dict(c) for rg, c in sorted(grid.items())},
        'yearRange': {'events': [evs[0]['y'], evs[-1]['y']], 'borders': [snap_years[0], snap_years[-1]]},
        'gaps': [
            'Before 3400 BC borders are snapshots: only a handful of sketch maps, so most years show the nearest earlier map.',
            'From 3400 BC to 1885 borders come from Cliopatria and are approximate (a state is redrawn every few years, in antiquity every few decades; territories it lacks come from the nearest earlier sketch map); from 1886 to 2019 from CShapes (dated).',
            'No border map between 2010 and today.',
            'US colony outlines for 1763-1783 reuse the 1783 state borders; the Newberry data starts in 1783.',
            'Event coverage follows Wikipedia: thin for Africa, Asia, the Americas before 1500 and the distant past.',
            'Events are ranked by the number of Wikipedia language editions, which favours Europe and recent times.',
            'Rulers need a start date on Wikidata; many early and minor rulers have none and are missing.',
        ],
    }
    write_json(os.path.join(DATA, 'meta.json'), meta, pretty=True)
    log(json.dumps(meta['counts']))


if __name__ == '__main__':
    main()
