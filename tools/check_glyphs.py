"""Check that every character used in map labels has a glyph file in fonts/ (MapLibre asks for
256-character ranges; a missing range would show up as a 404 in the browser). Characters outside the
shipped ranges are reported and the build fails, so a new name never breaks the page silently."""
import os
import sys

from common import DATA, ROOT, read_json

fonts = os.path.join(ROOT, 'fonts')
have = {}
for font in os.listdir(fonts):
    d = os.path.join(fonts, font)
    if os.path.isdir(d):
        have[font] = {f for f in os.listdir(d) if f.endswith('.pbf')}

def rng(ch):
    c = ord(ch)
    a = c // 256 * 256
    return f'{a}-{a + 255}.pbf'

need = {}
for f in os.listdir(os.path.join(DATA, 'borders')):
    if not f.endswith('.json') or f == 'index.json':
        continue
    for p in read_json(os.path.join(DATA, 'borders', f))['polities']:
        for ch in p.get('ln', p['n']):
            need.setdefault(rng(ch), set()).add(ch)
for feat in read_json(os.path.join(DATA, 'us', 'states.json'))['features']:
    for ch in feat['properties']['n']:
        need.setdefault(rng(ch), set()).add(ch)
need.setdefault('0-255.pbf', set()).update('0123456789k')  # cluster counts
bad = False
for font, files in have.items():
    missing = {r: chars for r, chars in need.items() if r not in files}
    for r, chars in missing.items():
        print(f'{font}: missing {r} for {"".join(sorted(chars))!r}')
        bad = True
print('glyph check', 'FAILED' if bad else 'ok', sorted(need))
sys.exit(1 if bad else 0)
