"""Population of every state on the map, for every year it is drawn: zonal sums of the HYDE 3.2.1 population
grid over the map's own outlines, plus Maddison's figures for today's countries for comparison.

1. Every shape the yearly maps use (Cliopatria and CShapes) is turned once into runs of grid cells: a cell of
   the 5 arc-minute HYDE grid belongs to a shape when its centre is inside the outline (even-odd rule, so
   holes count). A shape too small to hold a cell centre takes the share of the cell under its label point
   that its area covers.
2. For each HYDE time step the grid is summed over each shape's runs (row prefix sums, so a run costs two
   lookups).
3. A state's population in a year is the sum over the shapes it has on that year's map; between HYDE steps
   the value is interpolated geometrically (constant growth rate), which is how HYDE itself fills years.
4. A power (an empire drawn as one colour with its parts) gets the sum of all its rows on the map.
5. Today's countries (Natural Earth outlines in data/base/modern.json) are summed the same way, so a state
   can be compared with Maddison's series for the country it most resembles (only when the HYDE totals of the
   two areas are within 20% of each other in that year: Maddison counts today's borders).

Writes tools/cache/context/population.json:
  {"steps": [...], "states": {name: [[year, people], ...]}, "powers": {key: [[year, people]]},
   "modern": {iso: {"hyde": [[year, people]], "maddison": [[year, people]]}}}
"""
import array
import gzip
import itertools
import math
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import CACHE, DATA, log, read_json, write_json  # noqa: E402
from geo import decode_geom, polys_of, polygon_area_km2  # noqa: E402
from fetch_hyde import STEPS, path as hyde_path  # noqa: E402

OUT = os.path.join(CACHE, 'context')
NC, NR, CS = 4320, 2160, 1 / 12


def app_year(step):
    """HYDE labels its steps 1000BC ... 0AD, 100AD: the app has no year 0, so 0AD is year 1."""
    return step if step != 0 else 1


def spans_of(geom):
    """[(row, c0, c1)] runs of grid cells (inclusive) whose centres are inside the outline."""
    rows = {}
    for poly in polys_of(geom):
        for ring in poly:
            n = len(ring)
            for i in range(n - 1):
                x1, y1 = ring[i][0], ring[i][1]
                x2, y2 = ring[i + 1][0], ring[i + 1][1]
                if y1 == y2:
                    continue
                lo, hi = (y1, y2) if y1 < y2 else (y2, y1)
                # rows whose centre latitude lies in [lo, hi): row r has centre 90 - (r + 0.5) * CS
                r0 = math.ceil((90 - hi) / CS - 0.5)
                r1 = math.floor((90 - lo) / CS - 0.5)
                for r in range(max(r0, 0), min(r1, NR - 1) + 1):
                    lat = 90 - (r + 0.5) * CS
                    if not (lo <= lat < hi):
                        continue
                    x = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
                    rows.setdefault(r, []).append(x)
    out = []
    for r, xs in rows.items():
        xs.sort()
        for a, b in zip(xs[0::2], xs[1::2]):
            c0 = math.ceil((a + 180) / CS - 0.5)
            c1 = math.floor((b + 180) / CS - 0.5)
            c0, c1 = max(c0, 0), min(c1, NC - 1)
            if c1 >= c0:
                out.append((r, c0, c1))
    return out


def label_cell(geom):
    """The cell under a point of the outline (the middle of its bounding box when inside, else a vertex)."""
    pts = [p for poly in polys_of(geom) for p in poly[0]]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    x, y = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    r = min(max(int((90 - y) / CS), 0), NR - 1)
    c = min(max(int((x + 180) / CS), 0), NC - 1)
    return r, c


def cell_area(r):
    lat = 90 - (r + 0.5) * CS
    return (111.32 * CS) ** 2 * math.cos(math.radians(lat))


def load_grid(step):
    """Row prefix sums of the population-count grid: pre[r][c] = sum of cells 0..c-1 of row r."""
    pre = []
    with gzip.open(hyde_path(step), 'rt') as f:
        for _ in range(6):
            f.readline()
        for line in f:
            vals = [v if v > 0 else 0.0 for v in map(float, line.split())]
            a = array.array('d', [0.0])
            a.extend(itertools.accumulate(vals))
            pre.append(a)
    assert len(pre) == NR, len(pre)
    return pre


def sum_spans(pre, spans):
    t = 0.0
    for r, c0, c1 in spans:
        row = pre[r]
        t += row[c1 + 1] - row[c0]
    return t


def shapes():
    """{key: geometry} for every Cliopatria and CShapes shape ('c<id>' and 's<id>')."""
    out = {}
    ci = read_json(os.path.join(DATA, 'clio', 'index.json'))
    for f in ci['files']:
        for sid, s in read_json(os.path.join(DATA, 'clio', f)).items():
            out['c' + sid] = (decode_geom(s['g']), s['a'])
    cs = read_json(os.path.join(DATA, 'cshapes', 'index.json'))
    for c in cs['chunks']:
        for sid, s in read_json(os.path.join(DATA, 'cshapes', c['f'])).items():
            out['s' + sid] = (decode_geom(s['g']), s['a'])
    for f in read_json(os.path.join(DATA, 'base', 'modern.json'))['features']:
        out['m' + f['properties']['iso']] = (f['geometry'], None)
    return out


def interp(ys, vals, y):
    """Geometric interpolation of a value known at the HYDE steps."""
    if y <= ys[0]:
        return vals[0]
    if y >= ys[-1]:
        return vals[-1]
    i = next(k for k in range(1, len(ys)) if ys[k] >= y)
    y0, y1, v0, v1 = ys[i - 1], ys[i], vals[i - 1], vals[i]
    t = (y - y0) / (y1 - y0)
    if v0 > 0 and v1 > 0:
        return v0 * (v1 / v0) ** t
    return v0 + (v1 - v0) * t


def maddison():
    """{country name: {year: people}} from the Maddison Project Database 2023 ('Full data' sheet; pop in 1000s)."""
    p = os.path.join(OUT, 'maddison', 'mpd2023_web.xlsx')
    if not os.path.exists(p):
        log('  Maddison workbook missing: run tools/context/fetch_maddison.sh')
        return {}, {}
    z = zipfile.ZipFile(p)
    ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    ss = [''.join(t.text or '' for t in si.iter('{%s}t' % ns['m'])) for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', ns)]
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    rid = {r.get('Id'): r.get('Target') for r in rels}
    sheet = next(s for s in wb.find('m:sheets', ns) if s.get('name') == 'Full data')
    target = rid[sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')]
    root = ET.fromstring(z.read('xl/' + target.lstrip('/').replace('xl/', '')))
    rows = []
    for row in root.iter('{%s}row' % ns['m']):
        vals = {}
        for c in row.findall('m:c', ns):
            col = re.match(r'[A-Z]+', c.get('r')).group(0)
            v = c.find('m:v', ns)
            if v is None:
                continue
            vals[col] = ss[int(v.text)] if c.get('t') == 's' else v.text
        rows.append(vals)
    head = rows[0]
    col = {v: k for k, v in head.items()}
    out, codes = {}, {}
    for r in rows[1:]:
        try:
            code, name, y, pop = r[col['countrycode']], r[col['country']], int(float(r[col['year']])), r.get(col['pop'])
        except (KeyError, ValueError):
            continue
        if pop in (None, ''):
            continue
        out.setdefault(code, {})[y] = float(pop) * 1000
        codes[code] = name
    return out, codes


def main():
    st = read_json(os.path.join(OUT, 'states.json'))
    shp = shapes()
    log(f'population: {len(shp)} shapes')
    spans, small = {}, {}
    for k, (g, a) in shp.items():
        s = spans_of(g)
        if s:
            spans[k] = s
        else:
            r, c = label_cell(g)
            area = a if a is not None else polygon_area_km2(polys_of(g)[0]) if polys_of(g) else 0
            small[k] = (r, c, min(1.0, (area or 0) / cell_area(r)))
    log(f'  {sum(len(v) for v in spans.values())} runs; {len(small)} shapes smaller than a cell')
    ys = [app_year(s) for s in STEPS]
    per = {k: [] for k in shp}
    for step in STEPS:
        pre = load_grid(step)
        for k in shp:
            if k in spans:
                per[k].append(sum_spans(pre, spans[k]))
            else:
                r, c, frac = small[k]
                per[k].append((pre[r][c + 1] - pre[r][c]) * frac)
        log(f'  step {step}: world {sum(row[-1] for row in pre) / 1e6:.0f} M')
        del pre

    maps = st['maps']

    def shape_key(mi, sid):
        return ('s' if maps[mi][2] == 'cshapes' else 'c') + str(sid)

    def years_of(a, b):
        """Sample years for one map shown a..b: its first year and every HYDE step inside."""
        return [a] + [y for y in ys if a < y <= b]

    out_states, out_powers = {}, {}
    for name, s in st['states'].items():
        ser = {}
        for mi, sids, pk, ruler in s['maps']:
            a, b = maps[mi][0], maps[mi][1]
            for y in years_of(a, b):
                ser[y] = sum(interp(ys, per[shape_key(mi, sid)], y) for sid in sids)
        out_states[name] = [[y, round(v)] for y, v in sorted(ser.items())]
    # powers: all rows of the power on the map (the empire drawn as one colour)
    rows_by_map = {}
    for name, s in st['states'].items():
        for mi, sids, pk, ruler in s['maps']:
            rows_by_map.setdefault((pk, mi), []).extend(sids)
    for (pk, mi), sids in rows_by_map.items():
        a, b = maps[mi][0], maps[mi][1]
        ser = out_powers.setdefault(pk, {})
        for y in years_of(a, b):
            ser[y] = sum(interp(ys, per[shape_key(mi, sid)], y) for sid in sids)
    out_powers = {pk: [[y, round(v)] for y, v in sorted(ser.items())] for pk, ser in out_powers.items()}
    modern = {k[1:]: {'hyde': [[y, round(v)] for y, v in zip(ys, per[k])]} for k in shp if k.startswith('m')}
    mad, names = maddison()
    iso3 = read_json(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'iso3.json'))
    matched = 0
    for code, ser in mad.items():
        iso = iso3.get(code)
        if iso in modern:
            modern[iso]['maddison'] = [[y, round(v)] for y, v in sorted(ser.items())]
            modern[iso]['mname'] = names[code]
            matched += 1
    log(f'  Maddison: {len(mad)} countries, {matched} matched to today\'s outlines')
    write_json(os.path.join(OUT, 'population.json'), {'steps': ys, 'states': out_states, 'powers': out_powers, 'modern': modern})
    w = [sum(v for y, v in modern[i]['hyde'] if y == 2000) for i in modern]
    log(f'  states: {len(out_states)}, powers: {len(out_powers)}; world 2000 in today\'s outlines {sum(w) / 1e9:.2f} bn')


if __name__ == '__main__':
    main()
