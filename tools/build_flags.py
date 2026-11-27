"""Flags: the flag of each state in each year it is on the map (Wikidata P41 with its start and end
qualifiers, images from Wikimedia Commons), the colours of today's countries' flags for the map fills, and
which of today's countries each power maps to.

Writes
  data/flags/index.json    states -> dated flag runs, flag files (Commons name, licence, author), sheets
  data/flags/colors.json   power key -> today's country (ISO), and each country's flag colours (fills)
  data/flags/s<i>.png/json badge sprite sheets, one per era (loaded when a year of that era is shown)
  data/flags/b/<id>.png    the larger flag shown in the click panel (loaded on click)

Rules (accuracy first: a state without a known flag gets none):
  - a flag counts for a year when it is in force on 1 July of that year (the date CShapes maps stand for);
  - the item asked is, in order: a regime from tools/curated/flags.json, a Wikidata era of the map's item
    (data/entities.json 'eras', the shortest covering the year first), the map's item itself;
  - a statement without dates counts only inside its item's own years (and inside the years in the file name,
    "Flag of Germany (1867-1918)"), and is marked 'undated' in the panel;
  - deprecated statements, files whose name says they are fictitious, proposed, reconstructed or taken from a
    medieval atlas, and civil, merchant, naval or war ensigns are dropped unless a curated row asks for them;
  - flags before 1600 are kept only when the curated file lists the state as checked (most pre-modern
    "flags" on Wikidata are modern drawings of arms or later reconstructions);
  - curated rows replace or drop whatever Wikidata gives for a state in a span of years, each with a source.
Emblems (P94, coat of arms) are recorded only for states without any flag, and shown only in the panel,
marked as an emblem.

Images: Wikimedia's own PNG renderings of the Commons SVGs (upload.wikimedia.org thumbnails), resized with
Pillow (a build-time dependency of this step only).
"""
import hashlib
import io
import json
import math
import os
import re
import sys
import urllib.parse
from collections import Counter, defaultdict

from common import DATA, TOOLS, read_json, write_json, sparql, qid, fetch, log

CUR = os.path.join(TOOLS, 'curated', 'flags.json')
OUT = os.path.join(DATA, 'flags')
BADGE_H = 30          # badge height in pixels (shown at 15 CSS pixels, pixelRatio 2)
BADGE_WMAX = 60
BIG_W, BIG_H = 168, 112
EARLY = 1600          # flags before this year need a curated "checked" entry
DROP_FILE = re.compile(r'fictitious|fictional|hypothetic|imaginary|propos|unofficial|reconstruct|conjectur|possible|'
                       r'attributed|catalan|conoscimiento|dulcert|portolan|variant|\(dark version\)|alternative|'
                       r'merchant|civil ensign|naval ensign|war ensign|jack of|ensign of|pennant|car flag|'
                       r'battle flag|military|army|navy|standard of the president|presidential|vexillum|banner of arms of '
                       r'the (?:pope|holy see)|historical flag', re.I)
YEARS_IN_NAME = re.compile(r'\((?:[^()]*?\b)?(\d{3,4})\s*[–\-—]\s*(\d{3,4})\b')


def fid(file):
    return hashlib.md5(file.encode()).hexdigest()[:8]


def year_of(t):
    if not t:
        return None
    m = re.match(r'(-?)(\d+)-(\d\d)-(\d\d)', t)
    if not m:
        return None
    y = int(m.group(2)) * (-1 if m.group(1) else 1)
    # in force on 1 July: a flag that starts after 1 July counts from the next year
    return y if (int(m.group(3)), int(m.group(4))) <= (7, 1) else y + 1


def end_year(t):
    """Last year a flag that ends at t was in force on 1 July."""
    if not t:
        return None
    m = re.match(r'(-?)(\d+)-(\d\d)-(\d\d)', t)
    y = int(m.group(2)) * (-1 if m.group(1) else 1)
    return y if (int(m.group(3)), int(m.group(4))) > (7, 1) else y - 1


# ---------------------------------------------------------------- what is on the map
def map_states():
    """name -> {'years': set, 'keys': Counter, 'top': bool (drawn as a state of its own in some year)}"""
    st = defaultdict(lambda: {'years': set(), 'keys': Counter(), 'top': False})
    for src in ('clio', 'cshapes'):
        d = os.path.join(DATA, src, 'years')
        idx = read_json(os.path.join(DATA, src, 'index.json'))
        stored = sorted(int(f[:-5]) for f in os.listdir(d))
        for i, y in enumerate(stored):
            nxt = stored[i + 1] if i + 1 < len(stored) else idx['to'] + 1
            yr = read_json(os.path.join(d, f'{y}.json'))
            for r in yr['rows']:
                if src == 'clio' and len(r) > 4 and r[4]:
                    continue
                e = st[r[1]]
                e['years'].update(range(y, nxt))
                e['keys'][r[2]] += nxt - y
                if not r[3]:
                    e['top'] = True
    return st


# ---------------------------------------------------------------- Wikidata
def fetch_claims(qs):
    out = defaultdict(list)
    qs = sorted(set(qs))
    for i in range(0, len(qs), 250):
        ch = qs[i:i + 250]
        q = '''SELECT ?item ?prop ?img ?start ?end ?rank WHERE { VALUES ?item { %s }
          VALUES (?prop ?p ?ps) { ("P41" p:P41 ps:P41) ("P94" p:P94 ps:P94) }
          ?item ?p ?st. ?st ?ps ?img; wikibase:rank ?rank.
          OPTIONAL{?st pq:P580 ?start} OPTIONAL{?st pq:P582 ?end} }''' % ' '.join('wd:' + x for x in ch)
        for b in sparql(q):
            out[qid(b['item'])].append({
                'prop': b['prop'], 'file': urllib.parse.unquote(b['img'].rsplit('/', 1)[-1]).replace('_', ' '),
                'from': year_of(b.get('start')), 'to': end_year(b.get('end')),
                'rank': b['rank'].rsplit('#', 1)[-1].replace('Rank', '').lower()})
    # the flag items (P163) of the same states: an undated image dates from its flag item's adoption
    fdates = defaultdict(dict)
    for i in range(0, len(qs), 200):
        ch = qs[i:i + 200]
        q = '''SELECT ?item ?img ?inc ?start ?end WHERE { VALUES ?item { %s } ?item wdt:P163 ?flag. ?flag wdt:P18 ?img.
          OPTIONAL{?flag wdt:P571 ?inc} OPTIONAL{?flag wdt:P580 ?start} OPTIONAL{?flag wdt:P582 ?end} }''' % ' '.join('wd:' + x for x in ch)
        for b in sparql(q):
            f = urllib.parse.unquote(b['img'].rsplit('/', 1)[-1]).replace('_', ' ')
            a = year_of(b.get('start') or b.get('inc'))
            if a is not None:
                fdates[qid(b['item'])][f] = (a, end_year(b.get('end')))
    for q, cs in out.items():
        for c in cs:
            if c['prop'] == 'P41' and c['from'] is None and c['to'] is None and c['file'] in fdates.get(q, {}):
                c['from'], c['to'] = fdates[q][c['file']]
                c['p163'] = True
    return out


def fetch_modern(isos):
    """ISO 3166-1 alpha-2 -> (QID, current flag file)"""
    q = '''SELECT ?iso ?c ?img ?rank ?end WHERE { ?c wdt:P297 ?iso. ?c p:P41 ?st. ?st ps:P41 ?img; wikibase:rank ?rank.
       OPTIONAL{?st pq:P582 ?end} FILTER NOT EXISTS {?c wdt:P576 ?gone} }'''
    best = {}
    for b in sparql(q, cache_key='flags|modern|v1'):
        if b['iso'] not in isos or b.get('end'):
            continue
        r = b['rank'].rsplit('#', 1)[-1]
        if r == 'DeprecatedRank':
            continue
        f = urllib.parse.unquote(b['img'].rsplit('/', 1)[-1]).replace('_', ' ')
        score = (r == 'PreferredRank', not DROP_FILE.search(f), f.startswith('Flag of'))
        if b['iso'] not in best or score > best[b['iso']][0]:
            best[b['iso']] = (score, qid(b['c']), f)
    return {k: (v[1], v[2]) for k, v in best.items()}


def commons_info(files):
    """file -> {'lic': short licence name, 'by': artist (plain text), 'url': description page}"""
    out = {}
    files = sorted(set(files))
    for i in range(0, len(files), 40):
        ch = files[i:i + 40]
        url = 'https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode({
            'action': 'query', 'format': 'json', 'prop': 'imageinfo', 'iiprop': 'extmetadata|size',
            'iiextmetadatafilter': 'LicenseShortName|Artist|UsageTerms', 'titles': '|'.join('File:' + f for f in ch)})
        try:
            body = json.loads(fetch(url, ext='.json', min_gap=1.5, tries=3, max_wait=60))
        except Exception as e:          # noqa: BLE001 - Commons throttles its API: the licence stays unknown until a rerun
            log(f'  licences not fetched for {len(ch)} files ({e}); rerun later')
            for f in ch:
                out[f] = {'lic': '', 'by': '', 'w': None, 'h': None, 'missing': False}
            continue
        norm = {n['to']: n['from'] for n in body['query'].get('normalized', [])}
        for p in body['query']['pages'].values():
            t = p['title']
            t = norm.get(t, t)[5:]
            ii = (p.get('imageinfo') or [{}])[0]
            md = ii.get('extmetadata', {})
            lic = md.get('LicenseShortName', {}).get('value', '')
            by = re.sub(r'<[^>]+>', '', md.get('Artist', {}).get('value', '')).strip()
            out[t] = {'lic': lic, 'by': by[:120], 'w': ii.get('width'), 'h': ii.get('height'), 'missing': 'missing' in p}
    return out


def lic_class(lic):
    l = (lic or '').lower()
    if not l:
        return 'unknown'
    if 'public domain' in l or l.startswith('pd') or 'cc0' in l or 'cc-zero' in l:
        return 'PD'
    if 'by-sa' in l or 'by sa' in l:
        return 'CC BY-SA'
    if l.startswith('cc by') or l.startswith('cc-by'):
        return 'CC BY'
    if 'gfdl' in l:
        return 'GFDL'
    return lic


def original(file):
    """The file as uploaded to Commons (cached). Originals are static files, which Wikimedia serves without the
    rate limits of its thumbnail renderer."""
    f = file.replace(' ', '_')
    h = hashlib.md5(f.encode()).hexdigest()
    url = f'https://upload.wikimedia.org/wikipedia/commons/{h[0]}/{h[:2]}/{urllib.parse.quote(f)}'
    fetch(url, ext='.orig', min_gap=0.3, tries=3, max_wait=30)
    from common import cache_path
    return cache_path(url, '.orig')


RASTER_W = 300


def rasterize(files):
    """Render the SVGs among `files` to PNG with headless Chromium (tools/rasterize_flags.cjs), once."""
    import subprocess
    todo = []
    for f in sorted(set(files)):
        if not f.lower().endswith('.svg'):
            continue
        try:
            src = original(f)
        except Exception as e:          # noqa: BLE001
            log(f'  no original for {f}: {e}')
            continue
        png = src[:-5] + f'.r{RASTER_W}.png'
        if not os.path.exists(png):
            todo.append([src, png, RASTER_W])
    if todo:
        lp = os.path.join(TOOLS, 'cache', 'rasterize_list.json')
        write_json(lp, todo)
        root = subprocess.run(['npm', 'root', '-g'], capture_output=True, text=True).stdout.strip()
        subprocess.run(['node', os.path.join(TOOLS, 'rasterize_flags.cjs'), lp], env={**os.environ, 'NODE_PATH': root}, check=True)


# ---------------------------------------------------------------- resolve: state, year -> flag
def lifetime(e):
    return e.get('from'), e.get('to')


def in_span(y, a, b):
    return (a is None or a <= y) and (b is None or y <= b)


def candidates(name, y, ent, cur):
    """Items to ask for the state `name` in year y, most specific first: (qid, from, to)."""
    out = []
    for a, b, q in cur.get('regimes', {}).get(name, []):
        if in_span(y, a, b):
            out.append((q, a, b))
    if cur.get('regimes', {}).get(name) and out:
        return out
    e = ent.get(name) or {}
    qn = cur.get('qid', {}).get(name)
    if qn:
        return out + [(qn, None, None)]
    eras = sorted((er for er in e.get('eras', []) if er.get('from') is not None and in_span(y, er.get('from'), er.get('to'))),
                  key=lambda er: ((er.get('to') or 2100) - er['from']))
    out += [(er['q'], er['from'], er.get('to')) for er in eras]
    if e.get('q'):
        a, b = lifetime(e)
        if e.get('mod') is not None:
            a = e['mod']
        out.append((e['q'], a, b))
    return out


def pick(claims, y, a, b, allowed_early, checked=False):
    """The flag statement of an item in force in year y, or None. a, b: the item's own years."""
    good = [c for c in claims if c['prop'] == 'P41' and c['rank'] != 'deprecated' and not DROP_FILE.search(c['file'])]
    dated = [c for c in good if c['from'] is not None or c['to'] is not None]
    hit = [c for c in dated if in_span(y, c['from'], c['to'])
           and not (c['to'] is None and c['from'] is not None and b is not None and y > b)]
    undated = False
    if not hit:
        und = []
        for c in good:
            if c['from'] is not None or c['to'] is not None:
                continue
            m = YEARS_IN_NAME.search(c['file'])
            fa, fb = (int(m.group(1)), int(m.group(2))) if m else (None, None)
            if fa is not None and fb is not None and fb < fa:
                fa = fb = None
            # without dates a flag counts only where its file name gives years, or the state is listed as checked
            if in_span(y, a, b) and in_span(y, fa, fb) and (fa is not None or (checked and (a is not None or b is not None))):
                und.append(c)
        # an undated flag beside dated ones is a variant the dated ones already cover, unless no dated one does
        hit, undated = und, True
    if not hit:
        return None
    hit.sort(key=lambda c: (c['rank'] == 'preferred', c['from'] or -9999), reverse=True)
    c = hit[0]
    if y < EARLY and not allowed_early:
        return None
    return {'file': c['file'], 'undated': undated, 'from': c['from'], 'to': c['to']}


def resolve(states, ent, claims, cur):
    """name -> [[from, to, file, flags, item]] runs over the years the state is on the map."""
    early_ok = set(cur.get('early', {}))
    checked = set(cur.get('checked', {}))
    drops = cur.get('drop', {})
    fixed = cur.get('flags', {})
    out = {}
    why = Counter()
    for name, st in states.items():
        runs = []
        for y in sorted(st['years']):
            f = None
            fx = next((r for r in fixed.get(name, []) if r['from'] <= y <= r['to']), None)
            if fx:
                f = {'file': fx['file'], 'flags': fx.get('flags', ''), 'item': fx.get('q', '') or 'curated', 'cur': True}
            elif any(a <= y <= b for a, b, *_ in drops.get(name, [])):
                why['dropped (curated)'] += 1
            else:
                for q, a, b in candidates(name, y, ent, cur):
                    p = pick(claims.get(q, []), y, a, b, name in early_ok, name in checked)
                    if p:
                        f = {'file': p['file'], 'flags': 'u' if p['undated'] else '', 'item': q}
                        break
            if not f:
                continue
            f['file'] = cur.get('same_design', {}).get(f['file'], f['file'])
            if runs and runs[-1][2] == f['file'] and runs[-1][1] == y - 1 and runs[-1][4] == f['item']:
                runs[-1][1] = y
            else:
                runs.append([y, y, f['file'], f['flags'], f['item']])
        if runs:
            out[name] = runs
    return out


def emblems(states, ent, claims, flagged):
    """Coats of arms for states with no flag at all: name -> [file, item]. Only statements on the state's own item."""
    out = {}
    for name in states:
        if name in flagged:
            continue
        e = ent.get(name) or {}
        # only a former state's own item (not today's country of the same name, whose arms are modern)
        if e.get('to') is None or e.get('eras') or e.get('mod') is not None:
            continue
        cs = [c for c in claims.get(e.get('q'), []) if c['prop'] == 'P94' and c['rank'] != 'deprecated' and not DROP_FILE.search(c['file'])]
        if not cs:
            continue
        cs.sort(key=lambda c: (c['rank'] == 'preferred', c['from'] is None), reverse=True)
        out[name] = [cs[0]['file'], e['q']]
    return out


def main():
    cur = read_json(CUR)
    ent = read_json(os.path.join(DATA, 'entities.json'))
    states = map_states()
    log(f'{len(states)} map names')
    qs = set()
    for n in states:
        e = ent.get(n) or {}
        if e.get('q'):
            qs.add(e['q'])
        for er in e.get('eras', []):
            qs.add(er['q'])
    for rs in cur.get('regimes', {}).values():
        qs.update(r[2] for r in rs)
    qs.update(cur.get('qid', {}).values())
    claims = fetch_claims(qs)
    flags = resolve(states, ent, claims, cur)
    if '--review' in sys.argv:
        for n in sorted(flags, key=lambda n: min(r[0] for r in flags[n])):
            for r in flags[n]:
                print(f'{n}\t{r[0]}\t{r[1]}\t{r[2]}\t{r[3]}\t{r[4]}')
        return
    build_outputs(states, ent, claims, cur, flags)



# ---------------------------------------------------------------- powers -> today's countries
def power_countries():
    """power key -> [(ISO, share)] of the land it held, weighted by area and years, from the yearly maps (only
    rows drawn as states of their own, not colonies: Britain is the United Kingdom, not Canada or India).
    Cached in tools/cache/flags_modern.json (it takes a minute)."""
    from geo import PolyIndex
    from build_succession import grid_points
    import yearly
    cp = os.path.join(TOOLS, 'cache', 'flags_modern.json')
    if os.path.exists(cp):
        return read_json(cp)
    modern = read_json(os.path.join(DATA, 'base', 'modern.json'))
    pi = PolyIndex([(f['properties']['iso'], f['geometry']) for f in modern['features']])
    acc = defaultdict(Counter)
    years = []
    for src in ('clio', 'cshapes'):
        idx = read_json(os.path.join(DATA, src, 'index.json'))
        ys = sorted(int(f[:-5]) for f in os.listdir(os.path.join(DATA, src, 'years')))
        if src == 'cshapes':
            ys = ys[::3]
        for i, y in enumerate(ys):
            years.append((y, (ys[i + 1] if i + 1 < len(ys) else idx['to'] + 1) - y))
    for n, (y, w) in enumerate(years):
        if n % 50 == 0:
            log(f'  modern countries: {n}/{len(years)}')
        for p in yearly.year_doc(y) or []:
            if p.get('s') or p.get('u') or not p.get('p'):
                continue
            pts = grid_points(p['g'], 8)
            if not pts:
                continue
            per = p['a'] * w / len(pts)
            for x, yy in pts:
                iso = pi.nearest(x, yy, 0.5)
                if iso:
                    acc[p['p']][iso] += per
    out = {}
    for k, c in acc.items():
        tot = sum(c.values())
        out[k] = [[iso, round(v / tot, 3)] for iso, v in c.most_common(3)]
    write_json(cp, out)
    return out


# ---------------------------------------------------------------- images, colours, outputs
ERAS = [(-99999, 1599), (1600, 1699), (1700, 1799), (1800, 1849), (1850, 1885), (1886, 1913), (1914, 1938), (1939, 1960), (1961, 2019)]
STD_FILE = re.compile(r'royal|standard|banner|estandarte|bandera de|vessillo', re.I)


def thumb(file, width=330):
    """Wikimedia's own PNG rendering, in one of the thumbnail sizes it serves to scripts (330 pixels)."""
    f = file.replace(' ', '_')
    h = hashlib.md5(f.encode()).hexdigest()
    ext = '.png' if f.lower().endswith('.svg') else ''
    url = f'https://upload.wikimedia.org/wikipedia/commons/thumb/{h[0]}/{h[:2]}/{urllib.parse.quote(f)}/{width}px-{urllib.parse.quote(f)}{ext}'
    fetch(url, ext='.thumb', min_gap=0.5, tries=3, max_wait=30)
    from common import cache_path
    return cache_path(url, '.thumb')


def image(file):
    """The flag as a PNG: the original SVG rendered in Chromium when Commons served the original, else Wikimedia's
    330-pixel rendering (Commons serves uncached originals to scripts only slowly)."""
    from PIL import Image
    path = None
    try:
        src = original(file)
        path = src[:-5] + f'.r{RASTER_W}.png' if file.lower().endswith('.svg') else src
        if not os.path.exists(path):
            path = None
    except Exception:                   # noqa: BLE001
        path = None
    if path is None:
        # Commons refuses some requests from scripts; a refusal is remembered (rerun with --retry to ask again)
        rp = os.path.join(TOOLS, 'cache', 'flags_refused.json')
        refused = set(read_json(rp)) if os.path.exists(rp) and '--retry' not in sys.argv else set()
        if file in refused:
            raise RuntimeError('refused by Commons on an earlier run')
        try:
            path = thumb(file)
        except Exception:
            refused.add(file)
            write_json(rp, sorted(refused))
            raise
    im = Image.open(path)
    im.load()
    if im.mode == 'P':
        im = im.convert('RGBA')
    im = im.convert('RGBA')
    if im.size[0] > RASTER_W:
        im = im.resize((RASTER_W, max(1, round(im.size[1] * RASTER_W / im.size[0]))), Image.LANCZOS)
    return im


def badge_of(im):
    from PIL import Image
    w, h = im.size
    bh = BADGE_H
    bw = max(14, round(bh * w / h))
    if bw > BADGE_WMAX:
        bw = BADGE_WMAX
        bh = max(12, round(bw * h / w))
    inner = im.resize((bw - 2, bh - 2), Image.LANCZOS)
    out = Image.new('RGBA', (bw, bh), (40, 34, 26, 200))     # a thin dark frame: the badge reads on any fill
    out.alpha_composite(inner, (1, 1))
    return out


def big_of(im):
    from PIL import Image
    w, h = im.size
    s = min(BIG_W / w, BIG_H / h)
    return im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)


def oklch(rgb):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(v) for v in rgb[:3])
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
    A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
    B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    return L, math.hypot(A, B), math.degrees(math.atan2(B, A)) % 360


def flag_colours(im):
    """The chromatic colours of a flag with their share of its area: [(hex, share, (L, C, H))], largest first.
    White, grey and black are left out (they cannot be a fill)."""
    q = im.convert('RGB').resize((90, 60)).quantize(colors=8)
    pal = q.getpalette()
    counts = sorted(q.getcolors(), reverse=True)
    tot = sum(c for c, _ in counts)
    groups = []
    for c, i in counts:
        rgb = tuple(pal[i * 3:i * 3 + 3])
        L, C, H = oklch(rgb)
        if C < 0.05 or L < 0.22:
            continue
        for g in groups:
            dh = min(abs(g['H'] - H), 360 - abs(g['H'] - H))
            if dh < 22 and abs(g['L'] - L) < 0.15:
                g['n'] += c
                break
        else:
            groups.append({'rgb': rgb, 'n': c, 'L': L, 'C': C, 'H': H})
    groups.sort(key=lambda g: -g['n'])
    return [('#%02x%02x%02x' % g['rgb'], g['n'] / tot, (g['L'], g['C'], g['H'])) for g in groups if g['n'] / tot >= 0.02]


def hue_bucket(H):
    return int(((H + 15) % 360) // 30)


def country_colours(cur, isos):
    """ISO -> [first, second]: the flag's most distinctive colour (its share of the flag, less for hues that
    many flags share: red, white and blue are everywhere), then the next one of another hue."""
    modern = fetch_modern(isos)
    rasterize([f for _, f in modern.values()])
    cols = {}
    for iso, (q, f) in sorted(modern.items()):
        try:
            cols[iso] = flag_colours(image(f))
        except Exception as e:          # noqa: BLE001 - a missing rendering only loses that country's colours
            log(f'  no image for {iso} {f}: {e}')
    common = Counter()
    for cs in cols.values():
        for b in {hue_bucket(c[2][2]) for c in cs if c[1] >= 0.08}:
            common[b] += 1
    n = max(1, len(cols))
    out = {}
    for iso, cs in cols.items():
        if not cs:
            continue
        sc = sorted(cs, key=lambda c: -(c[1] * (1.2 - common[hue_bucket(c[2][2])] / n)))
        first = sc[0]
        second = next((c for c in sc[1:] if min(abs(c[2][2] - first[2][2]), 360 - abs(c[2][2] - first[2][2])) > 30), None)
        out[iso] = [first[0], second[0] if second else None]
    out.update(cur.get('colors', {}))
    return out, {iso: modern[iso][1] for iso in modern}


def pack(items):
    """Shelf packing: items [(id, image)] -> (sheet image, {id: [x, y, w, h]})."""
    from PIL import Image
    W = 512
    x = y = rowh = 0
    pos = {}
    for k, im in sorted(items, key=lambda t: (-t[1].size[1], t[0])):
        w, h = im.size
        if x + w > W:
            x, y, rowh = 0, y + rowh + 1, 0
        pos[k] = (x, y, w, h)
        x += w + 1
        rowh = max(rowh, h)
    sheet = Image.new('RGBA', (W, y + rowh), (0, 0, 0, 0))
    for k, im in items:
        sheet.alpha_composite(im, pos[k][:2])
    return sheet, {k: list(v) for k, v in pos.items()}


def build_outputs(states, ent, claims, cur, flags):
    os.makedirs(os.path.join(OUT, 'b'), exist_ok=True)
    marks = {}
    for name, runs in flags.items():
        for r in runs:
            sp = cur.get('standard', {}).get(name)
            if STD_FILE.search(r[2]) or (sp and sp[0] <= r[0] and r[1] <= sp[1]):
                r[3] = ''.join(sorted(set(r[3] + 's')))
    emb = emblems(states, ent, claims, flags)
    files = {r[2] for runs in flags.values() for r in runs} | {v[0] for v in emb.values()}
    info = commons_info(files)
    rasterize([f for f in files if info.get(f) and not info[f]['missing']])
    imgs = {}
    for f in sorted(files):
        i = info.get(f)
        if not i or i['missing']:
            log(f'  missing on Commons: {f}')
            continue
        try:
            imgs[f] = image(f)
        except Exception as e:          # noqa: BLE001
            log(f'  no rendering for {f}: {e}')
    # states and their runs; drop runs whose file could not be had
    notes, note_ix = [], {}
    fixed_notes = {}
    for name, rows in cur.get('flags', {}).items():
        for r in rows:
            if r.get('note'):
                fixed_notes[(name, r['file'], r['from'])] = r['note']
    st_out = {}
    for name, runs in sorted(flags.items()):
        rs = []
        for a, b, f, fl, item in runs:
            if f not in imgs:
                continue
            nt = next((v for (n, ff, fr), v in fixed_notes.items() if n == name and ff == f and fr <= a), None)
            if nt is None and name in cur.get('checked', {}) and 'u' in fl:
                nt = cur['checked'][name]
                fl = fl.replace('u', '')
            row = [a, b, fid(f), fl, item]
            if nt:
                if nt not in note_ix:
                    note_ix[nt] = len(notes)
                    notes.append(nt)
                row.append(note_ix[nt])
            rs.append(row)
        if rs:
            st_out[name] = rs
    emb_out = {n: [fid(v[0]), v[1]] for n, v in emb.items() if v[0] in imgs}
    used = {r[2] for rs in st_out.values() for r in rs}
    used_e = {v[0] for v in emb_out.values()}
    fmeta = {}
    for f, im in imgs.items():
        k = fid(f)
        if k not in used and k not in used_e:
            continue
        i = info[f]
        fmeta[k] = [f, lic_class(i['lic'])] + ([i['by']] if lic_class(i['lic']) != 'PD' and i['by'] else [])
        big_of(im).save(os.path.join(OUT, 'b', k + '.png'), optimize=True)
    # badge sheets per era
    sheets = []
    for n, (a, b) in enumerate(ERAS):
        ids = sorted({r[2] for rs in st_out.values() for r in rs if r[0] <= b and r[1] >= a})
        if not ids:
            continue
        byk = {fid(f): im for f, im in imgs.items()}
        sheet, pos = pack([(k, badge_of(byk[k])) for k in ids])
        sheet.save(os.path.join(OUT, f's{n}.png'), optimize=True)
        write_json(os.path.join(OUT, f's{n}.json'), pos)
        sheets.append([a, b, n])
    # coverage by era (for the README and the report)
    cov = {}
    for a, b in ERAS:
        top = [nm for nm, s in states.items() if s['top'] and any(a <= y <= b for y in s['years'])]
        has = [nm for nm in top if any(r[0] <= b and r[1] >= a for r in st_out.get(nm, []))]
        cov[f'{max(a, -3400)}-{b}'] = [len(has), len(top)]
    lic = Counter(v[1] for v in fmeta.values())
    write_json(os.path.join(OUT, 'index.json'), {'f': fmeta, 's': st_out, 'e': emb_out, 'n': notes, 'sheets': sheets,
                                                  'stats': {'coverage': cov, 'licences': dict(lic), 'states': len(st_out), 'flags': len(used), 'emblems': len(emb_out)}})
    # fills: power key -> today's country
    pc = power_countries()
    pmap = {}
    modern = read_json(os.path.join(DATA, 'base', 'modern.json'))['features']
    by_name = sorted(((f['properties']['n'], f['properties']['iso']) for f in modern), key=lambda t: -len(t[0]))
    powers = read_json(os.path.join(DATA, 'powers.json'))
    for k, lst in pc.items():
        if not lst:
            continue
        iso = lst[0][0] if lst[0][1] >= 0.2 else None
        # a power named after one of today's countries that holds some of it is that country (Denmark, not
        # Norway; Spain, not Argentina): measured by area, a homeland is outweighed by its empire
        label = k + ' | ' + (powers.get(k, {}).get('name') or '')
        for n, i in by_name:
            if re.search(r'\b' + re.escape(n.lower()) + r'\b', label.lower()) and any(c == i and s >= 0.05 for c, s in lst):
                iso = i
                break
        if iso:
            pmap[k] = iso
    pmap.update(cur.get('modern', {}))
    isos = {f['properties']['iso'] for f in modern}
    cc, cflag = country_colours(cur, isos)
    write_json(os.path.join(OUT, 'colors.json'), {'p': {k: v for k, v in sorted(pmap.items()) if v in cc}, 'c': cc})
    log(f'flags: {len(st_out)} states with a dated flag, {len(used)} flag images, {len(emb_out)} emblems; licences {dict(lic)}')
    log('coverage (states with a flag / states drawn as their own, by era): ' + json.dumps(cov))


if __name__ == '__main__':
    main()
