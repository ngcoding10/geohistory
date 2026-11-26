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

JULIAN = 'Q1985786'
TYPE_ORDER = ['war', 'battle', 'revolt', 'violence', 'treaty', 'state', 'ruler', 'politics', 'epidemic',
              'disaster', 'discovery', 'religion', 'other']


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
    return None


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
        if cs_index['from'] <= y <= cs_index['to']:
            key = ('cs', y)
            if key not in snap_cache:
                import build_cshapes
                pols = build_cshapes.year_doc(y)
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

    # ---------- Wikidata events ----------
    for k, v in kept.items():
        r = det.get(k)
        if not r or not good_label(r.get('label')):
            continue
        dates = defaultdict(list)
        for prop, val, prec, cal in split_pairs(r.get('dates'), 4):
            dt = to_date(val, prec, cal)
            if dt:
                dates[prop].append((int(prec), dt))
        main = None
        for prop in ('P585', 'P580'):
            if dates[prop]:
                main = sorted(dates[prop], key=lambda x: (-x[0], x[1][0]))[0][1]
                break
        if not main:
            continue
        y, m, d, approx = main
        ev = {'i': k, 'l': r['label'], 'y': y, 't': v['type'], 's': v['sl']}
        if m:
            ev['m'] = m
        if d:
            ev['dd'] = d
        if approx:
            ev['ya'] = 1
        ends = [dt[0] for _, dt in dates['P582']]
        if ends and max(ends) > y:
            ev['y2'] = max(ends)
        if r.get('desc'):
            ev['d'] = r['desc'][:160]
        if r.get('enwiki'):
            ev['w'] = r['enwiki']
        pt = parse_point(r.get('coord'))
        locs = split_pairs(r.get('locs'), 2)
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
        countries = split_pairs(r.get('countries'))
        if countries:
            ev['cn'] = [c[1] for c in countries[:3]]
        parts = split_pairs(r.get('parts'))
        if parts:
            ev['pa'] = [p[1] for p in parts[:6]]
        pof = split_pairs(r.get('partof'))
        if pof:
            ev['po'] = pof[0][1]
        place(ev, countries)
        events[k] = ev
    n_wd = len(events)
    log(f'{n_wd} Wikidata events with label and year')

    # ---------- states founded and dissolved ----------
    pol = defaultdict(lambda: {'start': [], 'end': [], 'sl': 0})
    for r in raw['polity_changes']:
        q = qid(r['item'])
        pol[q]['sl'] = int(r['sl'])
        for f in ('start', 'end'):
            t = parse_time(r.get(f))
            if t:
                pol[q][f].append(hist_year(t[0]))
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
            if r.get('desc'):
                ev['d'] = r['desc'][:160]
            if not ev['w']:
                del ev['w']
            place(ev, [(q, name)])
            if 'p' not in ev and q in q_to_names:
                ev['p'] = q_to_names[q][0]
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
        ev = {'i': f'r{person}-{y}', 'l': f'{pr["label"]} becomes {title}', 'y': y, 't': 'ruler',
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
        events[ev['i']] = ev
        n_rulers += 1
    log(f'{n_rulers} ruler events')

    # ---------- curated supplement ----------
    sup = read_json(os.path.join(TOOLS, 'supplement_events.json'))['events']
    by_wiki = defaultdict(list)
    for e in events.values():
        if e.get('w'):
            by_wiki[e['w']].append(e)
    n_merged = n_added = 0
    for s in sup:
        match = [e for e in by_wiki.get(s['wiki'], []) if e['y'] == s['y'] and e['t'] != 'ruler']
        if match:
            e = match[0]
            n_merged += 1
            e['m'], e['dd'] = s['m'], s['d']
            if e.get('lo') is None or e.get('ap'):
                e['lo'], e['la'] = s['lon'], s['lat']
                e.pop('ap', None)
            if s.get('colony'):
                e['c'] = s['colony']
                e['ci'] = us_by_name.get(s['colony'])
            e['s'] = max(e['s'], 25)
            e.pop('p', None)
            place(e, [])
            continue
        ev = {'i': s['id'], 'l': s['label'], 'y': s['y'], 'm': s['m'], 'dd': s['d'], 't': s['type'],
              's': 25, 'd': s['desc'], 'w': s['wiki'], 'lo': s['lon'], 'la': s['lat'], 'cur': 1}
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
    for y in range(cs_index['from'], cs_index['to'] + 1):
        for p in snap_index(y)[1][1]:
            pol_area[p['n']] = max(pol_area[p['n']], p['a'])
    polities = []
    for n, ys in sorted(names.items()):
        if n in pol_area:
            # consecutive CShapes years collapse into [first, last] ranges to keep the file small
            rng = []
            for y in ys:
                if rng and y == rng[-1][1] + 1 and y > 1886:
                    rng[-1][1] = y
                else:
                    rng.append([y, y])
            polities.append([n, [r[0] if r[0] == r[1] else r for r in rng], round(pol_area[n] / 1e5, 1)])
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
    sev = [[e['l'], e['i'], e['y'], '', e['s']] for e in top if e['s'] >= 8 or e.get('cur')][:9000]
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
            'eventsFromWikidata': len(evs) - n_added,
            'stateChanges': n_states, 'rulers': n_rulers,
            'curated': n_added + n_merged, 'curatedAdded': n_added, 'curatedMerged': n_merged,
            'withCoordinates': sum(1 for e in evs if e.get('lo') is not None),
            'coordinatesFromLocation': sum(1 for e in evs if e.get('ap')),
            'usStateVersions': len(us),
        },
        'eventsByType': {t: by_type.get(t, 0) for t in TYPE_ORDER},
        'eventsByEra': by_era,
        'yearRange': {'events': [evs[0]['y'], evs[-1]['y']], 'borders': [snap_years[0], snap_years[-1]]},
        'gaps': [
            'Borders are snapshots: there are only %d maps, so most years show the nearest earlier map.' % len(snap_years),
            'No border map between 2010 and today.',
            'US colony outlines for 1763-1783 reuse the 1783 state borders; the Newberry data starts in 1783.',
            'Event coverage follows Wikipedia: thin for Africa, Asia, the Americas before 1500 and the distant past.',
            'Events are ranked by the number of Wikipedia language editions, which favours Europe and recent times.',
            'Rulers are monarchs whose Wikidata entry has a start date; presidents and prime ministers are not included.',
        ],
    }
    write_json(os.path.join(DATA, 'meta.json'), meta, pretty=True)
    log(json.dumps(meta['counts']))


if __name__ == '__main__':
    main()
