"""Flag fill: which flag each power's land is painted with on the map (js/flagfill.js), and today's countries'
flags as one image.

Writes
  data/flags/fill.json   m: power key -> ISO (filled with that country's flag today); a: ISO -> [x, y, w, h] in
                         fill.png; names: ISO -> country name; why: power key -> reason (curated rows only)
  data/flags/fill.png    today's flags, 160 pixels high (stretched over states, so they need some size)

A power without an ISO here is filled with its own flag of the year shown (data/flags/index.json, the badge
flag), or with its plain colour when it had none. Rules, in order:
  1. tools/curated/flag_fills.json: 'successor' (power -> ISO, with a reason) and 'own' (power -> reason);
     'own_names': names of states or empires (as the map names them in a year) that take their own flag even
     when their power has a successor (Austria-Hungary is drawn under the power of today's Austria);
  2. the power's name contains the name of the present-day country it maps to (Kingdom of Romania -> Romania);
  3. at least 60% of the land it held, weighted by area and years, lies in that country.
Needs build_flags.py to have run (its caches of today's flags and of the power -> country shares).
"""
import json
import os
import re

from common import DATA, TOOLS, read_json, write_json, cache_path, log
import build_flags as bf

H = 160
WMAX = 320
SHARE = 0.6


def local_image(f):
    """Today's flag from the build cache only (no network): the Chromium rendering of the original SVG."""
    from PIL import Image
    import hashlib
    import urllib.parse
    ff = f.replace(' ', '_')
    h = hashlib.md5(ff.encode()).hexdigest()
    url = f'https://upload.wikimedia.org/wikipedia/commons/{h[0]}/{h[:2]}/{urllib.parse.quote(ff)}'
    src = cache_path(url, '.orig')
    path = src[:-5] + f'.r{bf.RASTER_W}.png' if f.lower().endswith('.svg') else src
    if not os.path.exists(path):
        return None
    im = Image.open(path)
    im.load()
    return im.convert('RGB')


def main():
    from PIL import Image
    cur = read_json(os.path.join(TOOLS, 'curated', 'flag_fills.json'))
    colors = read_json(os.path.join(DATA, 'flags', 'colors.json'))
    shares = read_json(os.path.join(TOOLS, 'cache', 'flags_modern.json'))
    powers = read_json(os.path.join(DATA, 'powers.json'))
    modern = read_json(os.path.join(DATA, 'base', 'modern.json'))['features']
    names = {f['properties']['iso']: f['properties']['n'] for f in modern}
    by_name = sorted(names.items(), key=lambda t: -len(t[1]))
    m, why, rule = {}, {}, {}
    for k, iso in colors['p'].items():
        if k in cur['own']:
            continue
        label = (k + ' | ' + (powers.get(k, {}).get('name') or '')).lower()
        named = any(i == iso and re.search(r'\b' + re.escape(n.lower()) + r'\b', label) for i, n in by_name)
        share = dict(map(tuple, shares.get(k, []))).get(iso, 0)
        if named or share >= SHARE:
            m[k] = iso
            rule[k] = 'name' if named else 'share'
    for k, (iso, reason) in cur['successor'].items():
        m[k] = iso
        why[k] = reason
        rule[k] = 'curated'
    for k, reason in cur['own'].items():
        m.pop(k, None)
        why[k] = reason
    # today's flags, for the countries used
    files = bf.fetch_modern(set(names))
    tiles = {}
    for iso in sorted(set(m.values())):
        if iso not in files:
            log(f'  no flag file for {iso}')
            continue
        im = local_image(files[iso][1])
        if im is None:
            log(f'  no cached rendering of {files[iso][1]}')
            continue
        w = max(24, min(WMAX, round(H * im.size[0] / im.size[1])))
        tiles[iso] = im.resize((w, H), Image.LANCZOS)
    m = {k: v for k, v in m.items() if v in tiles}
    # pack in rows of 2048 pixels, 1 pixel apart
    pos, x, y = {}, 0, 0
    for iso, im in tiles.items():
        if x + im.size[0] > 2048:
            x, y = 0, y + H + 2
        pos[iso] = [x, y, im.size[0], H]
        x += im.size[0] + 2
    sheet = Image.new('RGB', (2048, y + H), (255, 255, 255))
    for iso, im in tiles.items():
        sheet.paste(im, tuple(pos[iso][:2]))
    sheet.save(os.path.join(DATA, 'flags', 'fill.png'), optimize=True)
    write_json(os.path.join(DATA, 'flags', 'fill.json'), {'m': dict(sorted(m.items())), 'a': pos,
                                                         'names': {i: names[i] for i in pos}, 'why': why,
                                                         'own': cur.get('own_names', {})})
    from collections import Counter
    log(f'flag fill: {len(m)} powers filled with a present-day flag ({dict(Counter(rule[k] for k in m))}), '
        f'{len(colors["p"]) - len(m)} mapped powers keep their own flag; {len(pos)} flags in fill.png')


if __name__ == '__main__':
    main()
