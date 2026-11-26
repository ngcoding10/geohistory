"""Step 2: turn the raw border snapshots into small per-year files for the app.

Writes:
  data/borders/index.json        snapshot years, polity counts, file names
  data/borders/<year>.json       simplified features + polity table + largest powers + changes
  data/powers.json               every ruling power: display name, colour (stable across years)
  data/base/modern.json          Natural Earth modern countries, simplified (overlay + search)
  tools/cache/names.json         polity/power names with the years they appear (for Wikidata linking)
"""
import json
import os
import re
from collections import defaultdict, Counter

from common import fetch, write_json, DATA, CACHE, log
import names as names_mod
from fetch_sources import HB, NE, hb_index
from geo import (simplify_geom, polys_of, polygon_area_km2, label_point, bbox_of)

# Spellings of the same ruling power in different snapshots -> one colour key.
# Display names stay as the source gives them (only obvious abbreviations are expanded).
ALIASES = {
    'uk': 'britain', 'united kingdom': 'britain', 'great britain': 'britain', 'england': 'britain',
    'kingdom of great britain': 'britain', 'kingdom of england': 'britain', 'british empire': 'britain',
    'united kingdom of great britain and ireland': 'britain', 'british raj': 'britain',
    'united states': 'usa', 'united states of america': 'usa', 'usa': 'usa',
    'russian empire': 'russia', 'russia': 'russia', 'ussr': 'russia', 'tsardom of muscovy': 'russia',
    'grand duchy of moscow': 'russia', 'russian federation': 'russia', 'muscovy': 'russia',
    'soviet union': 'russia',
    'manchu empire': 'china', 'qing empire': 'china', 'china': 'china', 'ming chinese empire': 'china',
    'ming empire': 'china', 'song empire': 'china', 'tang empire': 'china', 'han': 'china',
    'han empire': 'china', 'sui empire': 'china', 'yuan empire': 'china', 'qin': 'china',
    "people's republic of china": 'china', 'republic of china': 'china', 'chinese empire': 'china',
    'ottoman empire': 'ottoman', 'ottoman sultanate': 'ottoman',
    'france': 'france', 'french empire': 'france', 'kingdom of france': 'france', 'frankish kingdom': 'franks',
    'spain': 'spain', 'spanish habsburg': 'spain', 'spanish empire': 'spain', 'castile': 'spain',
    'portugal': 'portugal', 'portuguese empire': 'portugal',
    'netherlands': 'netherlands', 'dutch republic': 'netherlands', 'united provinces': 'netherlands',
    'roman empire': 'rome', 'roman republic': 'rome', 'rome': 'rome', 'western roman empire': 'rome',
    'eastern roman empire': 'byzantium', 'byzantine empire': 'byzantium',
    'persia': 'persia', 'iran': 'persia', 'safavid empire': 'persia', 'sasanian empire': 'persia',
    'achaemenid empire': 'persia', 'parthian empire': 'persia', 'qajar empire': 'persia',
    'germany': 'germany', 'german empire': 'germany', 'prussia': 'germany', 'kingdom of prussia': 'germany',
    'mongol empire': 'mongols', 'mongols': 'mongols',
    'austria': 'austria', 'austrian empire': 'austria', 'austria-hungary': 'austria',
    'austro-hungarian empire': 'austria', 'habsburg monarchy': 'austria', 'archduchy of austria': 'austria',
    'japan': 'japan', 'empire of japan': 'japan', 'japanese empire': 'japan',
    'denmark': 'denmark', 'denmark-norway': 'denmark',
    'sweden': 'sweden', 'swedish empire': 'sweden',
    'italy': 'italy', 'kingdom of italy': 'italy',
    'india': 'india', 'mughal empire': 'mughal',
}
DISPLAY = {'UK': 'United Kingdom', 'USA': 'United States', 'USSR': 'Soviet Union'}

# Map colours, in OKLCH (lightness, chroma, hue) so that they share one lightness and saturation range: a
# calm atlas palette. PALETTE: 24 muted hues for every power without a colour of its own, assigned so that
# neighbours differ. CURATED: one fixed colour per major power, the same in every year; successor states use
# the same key (Russian Empire and Soviet Union, the Chinese dynasties, the Persian empires) or a related hue.
def oklch(L, C, H):
    import math
    a, b = C * math.cos(math.radians(H)), C * math.sin(math.radians(H))
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    rgb = (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
           -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
           -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
    out = '#'
    for v in rgb:
        v = max(0.0, min(1.0, v))
        v = 12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055
        out += '%02x' % round(max(0.0, min(1.0, v)) * 255)
    return out


PALETTE = [oklch((0.83, 0.775, 0.865)[i % 3], (0.052, 0.062, 0.045)[i % 3], (i * 15 * 7) % 360) for i in range(24)]
CURATED = {
    'britain': oklch(0.80, 0.078, 5), 'france': oklch(0.78, 0.075, 255), 'spain': oklch(0.86, 0.095, 90),
    'portugal': oklch(0.79, 0.08, 152), 'netherlands': oklch(0.80, 0.10, 58), 'russia': oklch(0.80, 0.065, 128),
    'ottoman': oklch(0.74, 0.065, 168), 'austria': oklch(0.87, 0.04, 78), 'holy roman empire': oklch(0.86, 0.035, 105),
    'germany': oklch(0.73, 0.045, 238), 'italy': oklch(0.83, 0.085, 140), 'usa': oklch(0.75, 0.065, 248),
    'japan': oklch(0.80, 0.065, 322), 'china': oklch(0.83, 0.09, 82), 'mongols': oklch(0.76, 0.05, 112),
    'rome': oklch(0.73, 0.10, 25), 'byzantium': oklch(0.73, 0.08, 318), 'persia': oklch(0.79, 0.065, 202),
    'mughal': oklch(0.77, 0.09, 52), 'india': oklch(0.80, 0.085, 36), 'canada': oklch(0.86, 0.06, 104), 'denmark': oklch(0.82, 0.065, 22),
    'sweden': oklch(0.84, 0.055, 232), 'belgium': oklch(0.81, 0.075, 98), 'polish-lithuanian commonwealth': oklch(0.79, 0.07, 14),
    'umayyad caliphate': oklch(0.77, 0.085, 155), 'abbasid caliphate': oklch(0.75, 0.08, 160), 'rashidun caliphate': oklch(0.79, 0.085, 150),
    'macedonian empire': oklch(0.78, 0.065, 278), 'franks': oklch(0.80, 0.07, 262), 'carolingian empire': oklch(0.80, 0.07, 262),
    'brazil': oklch(0.82, 0.075, 136), 'delhi sultanate': oklch(0.78, 0.07, 185),
}

TOL = 0.03       # degrees, Douglas-Peucker tolerance
DECIMALS = 2     # coordinate rounding (about 1 km)


def power_key(s):
    k = re.sub(r'\s+', ' ', s.strip().lower())
    return ALIASES.get(k, k)


def clean(s):
    s = (s or '').strip()
    s = re.sub(r'\s+', ' ', s)
    return s


GLYPH_RANGES = (0, 256, 512, 768, 1024, 7680, 8192)  # the 256-character blocks shipped in fonts/


def label_name(n):
    """Map label text: drop characters the bundled label font cannot draw (the panel shows the full name)."""
    t = n.replace('\ua789', ':')
    t = ''.join(c for c in t if (ord(c) // 256 * 256) in GLYPH_RANGES)
    t = re.sub(r'[\^]', '', t)
    t = re.sub(r'\(\s*\)', '', t)
    t = re.sub(r'\s+', ' ', t).strip(' /-')
    if t.startswith('(') and t.endswith(')') and t.count('(') == 1:
        t = t[1:-1]
    return t or n


def year_label(y):
    return f'{-y} BC' if y < 0 else str(y)


def load_snapshot(fn):
    return json.loads(fetch(HB + 'geojson/' + fn))


def main():
    idx = hb_index()
    years = [y['year'] for y in idx['years']]
    snaps = {}
    names = defaultdict(set)       # polity name -> years
    power_names = defaultdict(Counter)  # power key -> display spellings
    power_years = defaultdict(set)
    power_area = defaultdict(float)
    adj = Counter()               # (keyA, keyB) -> shared vertex count

    for y in years:
        fn = next(x['filename'] for x in idx['years'] if x['year'] == y)
        src = load_snapshot(fn)
        feats = []
        grid = defaultdict(set)
        for f in src['features']:
            p = f.get('properties') or {}
            name = names_mod.display(clean(p.get('NAME')))
            subj = names_mod.display(clean(p.get('SUBJECTO')))
            if subj.isdigit():
                subj = ''
            if not name and subj:
                name = subj
            geom = f.get('geometry')
            if not geom:
                continue
            area = sum(polygon_area_km2(q) for q in polys_of(geom))
            sg = simplify_geom(geom, TOL, DECIMALS)
            if not sg:
                continue
            if not name:
                feats.append({'name': None, 'geom': sg, 'area': area})
                continue
            subj = subj or name
            disp = DISPLAY.get(subj, subj)
            key = power_key(subj)
            power_names[key][disp] += 1
            power_years[key].add(y)
            power_area[key] = max(power_area[key], 0)
            names[name].add(y)
            names[disp].add(y)
            feats.append({'name': name, 'power': key, 'pdisp': disp, 'geom': sg, 'area': area,
                          'prec': p.get('BORDERPRECISION'), 'partof': clean(p.get('PARTOF'))})
            for poly in polys_of(geom):
                ring = poly[0]
                step = max(1, len(ring) // 400)
                for pt in ring[::step]:
                    grid[(round(pt[0] * 4), round(pt[1] * 4))].add(key)
        for keys in grid.values():
            if len(keys) > 1:
                ks = sorted(keys)
                for i in range(len(ks)):
                    for j in range(i + 1, len(ks)):
                        adj[(ks[i], ks[j])] += 1
        snaps[y] = feats
        log(f'{year_label(y)}: {len(feats)} features')

    # --- stable colours: greedy colouring of the "ever neighbours" graph, biggest powers first ---
    tot_area = defaultdict(float)
    for y, feats in snaps.items():
        for f in feats:
            if f['name']:
                tot_area[f['power']] += f['area']
    nbrs = defaultdict(Counter)
    for (a, b), n in adj.items():
        nbrs[a][b] += n
        nbrs[b][a] += n
    colour = {}
    for key in sorted(tot_area, key=lambda k: -tot_area[k]):
        cost = [0.0] * len(PALETTE)
        for nb, w in nbrs[key].items():
            if nb in colour:
                cost[colour[nb]] += w * (1 + tot_area[nb] / 1e7)
        # small deterministic tie-break so equal-cost choices spread over the palette
        h = sum(ord(c) for c in key)
        best = min(range(len(PALETTE)), key=lambda i: (cost[i], (i - h) % len(PALETTE)))
        colour[key] = best
    powers = {}
    for key in tot_area:
        disp = power_names[key].most_common(1)[0][0]
        powers[key] = {'name': disp, 'color': CURATED.get(key) or PALETTE[colour[key]],
                       'years': [min(power_years[key]), max(power_years[key])]}
    write_json(os.path.join(DATA, 'powers.json'), powers)

    # --- per snapshot files ---
    index = []
    prev_names = None
    prev_polities = {}
    for y in years:
        feats = snaps[y]
        polities = {}
        order = []
        out_feats = []
        for f in feats:
            if not f['name']:
                out_feats.append({'type': 'Feature', 'geometry': f['geom'], 'properties': {'k': -1}})
                continue
            pk = (f['name'], f['power'])
            if pk not in polities:
                polities[pk] = {'n': f['name'], 'p': f['power'], 's': f['pdisp'], 'a': 0.0,
                                'b': f['prec'], 'geoms': []}
                order.append(pk)
            pol = polities[pk]
            pol['a'] += f['area']
            pol['geoms'].append(f['geom'])
        order.sort(key=lambda k: -polities[k]['a'])
        kindex = {k: i for i, k in enumerate(order)}
        for f in feats:
            if not f['name']:
                continue
            k = kindex[(f['name'], f['power'])]
            out_feats.append({'type': 'Feature', 'geometry': f['geom'],
                              'properties': {'k': k, 'c': powers[f['power']]['color']}})
        plist = []
        for pk in order:
            pol = polities[pk]
            allpolys = []
            for g in pol['geoms']:
                allpolys += polys_of(g)
            mg = {'type': 'MultiPolygon', 'coordinates': allpolys}
            bb = bbox_of(mg)
            entry = {'n': pol['n'], 'p': pol['p'], 'a': round(pol['a']),
                     'l': label_point(mg), 'bb': [round(v, 1) for v in bb]}
            if pol['s'] != pol['n']:
                entry['s'] = pol['s']
            ln = label_name(pol['n'])
            if ln != pol['n']:
                entry['ln'] = ln
            if pol['b']:
                entry['pr'] = pol['b']
            plist.append(entry)
        # largest powers by summed area
        parea = defaultdict(float)
        pcount = Counter()
        pdisp = defaultdict(Counter)
        for pol in polities.values():
            parea[pol['p']] += pol['a']
            pcount[pol['p']] += 1
            pdisp[pol['p']][pol['s']] += 1
        largest = [{'p': k, 'name': pdisp[k].most_common(1)[0][0], 'a': round(a), 'n': pcount[k]}
                   for k, a in sorted(parea.items(), key=lambda x: -x[1])[:15]]
        cur_names = {pol['n']: pol['a'] for pol in polities.values()}
        changes = None
        if prev_names is not None:
            appeared = sorted((n for n in cur_names if n not in prev_names), key=lambda n: -cur_names[n])
            gone = sorted((n for n in prev_names if n not in cur_names), key=lambda n: -prev_names[n])
            changes = {'since': prev_year, 'appeared': appeared[:12], 'gone': gone[:12],
                       'nAppeared': len(appeared), 'nGone': len(gone)}
        prev_names = cur_names
        prev_year = y
        fname = f'{y}.json'
        doc = {'type': 'FeatureCollection', 'year': y, 'features': out_feats, 'polities': plist,
               'largest': largest, 'changes': changes}
        size = write_json(os.path.join(DATA, 'borders', fname), doc)
        index.append({'y': y, 'f': fname, 'n': len(plist), 'kb': round(size / 1024)})
        log(f'  wrote {fname}: {len(plist)} polities, {size // 1024} KB')

    write_json(os.path.join(DATA, 'borders', 'index.json'), {'snapshots': index})
    # the GPL-3.0 licence travels with the derived border files
    with open(os.path.join(DATA, 'borders', 'LICENSE.txt'), 'wb') as f:
        f.write(b'The files in this folder are simplified from aourednik/historical-basemaps\n'
                b'(https://github.com/aourednik/historical-basemaps), licensed under the GNU GPL v3.\n'
                b'Changes: geometry simplified and rounded, properties renamed, polity tables added.\n'
                b'The scripts that made them are in tools/ (build_borders.py).\n\n')
        f.write(fetch(HB + 'LICENSE'))
    write_json(os.path.join(CACHE, 'names.json'), {n: sorted(v) for n, v in names.items()})
    if os.path.exists(os.path.join(CACHE, 'names_clio.json')):
        os.remove(os.path.join(CACHE, 'names_clio.json'))   # the list starts afresh: build_clio.py has nothing to take out

    # --- base layers ---
    mod = json.loads(fetch(NE + 'ne_50m_admin_0_countries.geojson'))
    mf = []
    for f in mod['features']:
        p = f['properties']
        g = simplify_geom(f['geometry'], 0.06, 2, min_area_km2=600)
        if not g:
            continue
        iso = p.get('ISO_A2_EH') if p.get('ISO_A2_EH') not in (None, '-99') else p.get('ADM0_A3')
        mf.append({'type': 'Feature', 'geometry': g,
                   'properties': {'iso': iso, 'n': p.get('NAME_EN') or p.get('NAME'),
                                  'bb': [round(v, 1) for v in bbox_of(f['geometry'])]}})
    s = write_json(os.path.join(DATA, 'base', 'modern.json'), {'type': 'FeatureCollection', 'features': mf})
    log(f'modern countries: {len(mf)}, {s // 1024} KB')


if __name__ == '__main__':
    main()
