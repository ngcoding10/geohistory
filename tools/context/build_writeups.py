"""Event write-ups, one gzipped file per event block (data/writeups/<a>_<b>.json.gz, the blocks of
data/events/index.json), loaded only when an event is opened.

Three kinds, best first:
  t1  written for GeoHistory from several sources (tools/curated/writeups/t1/*.json; AI-written, labelled so):
      2-5 paragraphs, the sources with what each supports, and where the sources disagree.
  t2  for the next 30,000 events by notability: the lead of the event's English Wikipedia article and the
      opening of its background and aftermath sections, quoted with attribution (CC BY-SA 4.0).
  t3  for every other event with an article: the opening of the lead, quoted with attribution.
Text comes from Wikimedia's CirrusSearch dump (tools/context/fetch_cirrus.py), never rewritten by a model.
A Wikipedia excerpt that names years but not the event's year is marked (the dates may differ from the
event record). An event without a write-up shows "no detailed source found".

Writes data/writeups/*.json.gz and data/writeups/index.json ({block file: {count, kb}}),
and tools/cache/context/writeups_stats.json.
"""
import glob
import gzip
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import CACHE, DATA, TOOLS, log, read_json, write_json  # noqa: E402
from writeup_prep import article, index  # noqa: E402

DEST = os.path.join(DATA, 'writeups')
DUMP_DATE = '2026-11-22'
BG = re.compile(r'^(?:background|prelude|origins?|causes?|context|historical background)$', re.I)
AFTER = re.compile(r'^(?:aftermath|consequences?|outcome|results?|legacy|impact|significance)$', re.I)


def clean(t):
    """Drop pronunciation guides and IPA from the opening sentence: '(Spanish pronunciation: [...])', '(/ˈ.../)'."""
    t = re.sub(r'\s*\((?:[^()]*\b(?:pronunciation|pronounced|listen)\b[^()]*|[^()]*/[^()/]{1,40}/[^()]*)\)', '', t)
    t = re.sub(r'\s*\[[^\]]*[ˈˌːɐɑɒæɔəɛɜɪʊʌʃʒθðŋɾɣ][^\]]*\]', '', t)
    return re.sub(r'\s+([,.;:])', r'\1', t)


def sentences(t, limit):
    """Whole sentences up to about `limit` characters."""
    t = clean(re.sub(r'\s+', ' ', t).strip())
    if len(t) <= limit:
        return t
    cut = t[:limit]
    m = list(re.finditer(r'(?<=[.!?])\s+(?=[A-Z0-9"\'(])', cut))
    if m and m[-1].start() > limit * 0.4:
        return cut[:m[-1].start()].strip()
    return cut.rsplit(' ', 1)[0] + ' …'


def year_words(y):
    return [f'{-y} BC', f'{-y} BCE', f'{-y} BC'] if y < 0 else [str(y)]


def date_flag(text, e):
    """True when the text names years but not the event's (start or end) year."""
    yrs = year_words(e['y']) + (year_words(e['y2']) if e.get('y2') else [])
    if any(re.search(r'(?<!\d)' + re.escape(w) + r'(?!\d)', text) for w in yrs):
        return False
    return bool(re.search(r'(?<!\d)\d{3,4}(?!\d)', text))


def main():
    q = read_json(os.path.join(TOOLS, 'curated', 'writeups', 'queue.json'))
    tier = q['tier']
    t1 = {}
    for f in sorted(glob.glob(os.path.join(TOOLS, 'curated', 'writeups', 't1', '*.json'))):
        t1.update(read_json(f))
    idx = index()
    blocks = read_json(os.path.join(DATA, 'events', 'index.json'))['blocks']
    os.makedirs(DEST, exist_ok=True)
    for f in glob.glob(os.path.join(DEST, '*')):
        os.remove(f)
    stats = {'t1': 0, 't2': 0, 't3': 0, 'none': 0, 'dateFlag': 0, 't1YearMismatch': 0}
    out_index, total = {}, 0
    for b in blocks:
        doc = read_json(os.path.join(DATA, 'events', b['f']))
        out = {}
        for e in doc['events']:
            i = e['i']
            if i in out:
                continue
            w = t1.get(i)
            if w:
                if w['y'] != e['y']:
                    stats['t1YearMismatch'] += 1
                    log(f'  t1 year differs from the event record: {i} {w["y"]} vs {e["y"]} (left out)')
                else:
                    out[i] = {'k': 1, 'p': w['paras'], 's': [[s['title'], s['url'], s['publisher'], s['accessed']] for s in w['sources']],
                              'dis': w.get('disagree'), 'chk': w.get('checked')}
                    stats['t1'] += 1
                    continue
            a = article(e['w'], idx) if e.get('w') else None
            if not a or not a['sec'] or len(a['sec'][0][2]) < 80:
                stats['none'] += 1
                continue
            lead = a['sec'][0][2]
            src = [[f"{a['title']}", 'https://en.wikipedia.org/wiki/' + a['title'].replace(' ', '_'),
                    f"Wikipedia (CC BY-SA 4.0), revision {a['rev']}", DUMP_DATE]]
            if tier.get(i) in (1, 2):
                paras = [sentences(lead, 750)]
                for rx, label in ((BG, 'Background'), (AFTER, 'Aftermath')):
                    sec = next((s for s in a['sec'][1:] if rx.match(s[0].strip())), None)
                    if sec and len(sec[2]) > 120:
                        paras.append(f'{label}: ' + sentences(sec[2], 380))
                k = 2
            else:
                paras = [sentences(lead, 420)]
                k = 3
            rec = {'k': k, 'p': paras, 's': src}
            if date_flag(' '.join(paras), e):
                rec['yd'] = 1
                stats['dateFlag'] += 1
            out[i] = rec
            stats['t2' if k == 2 else 't3'] += 1
        if out:
            name = b['f'].replace('.json', '.json.gz')
            raw = json.dumps(out, ensure_ascii=False, separators=(',', ':')).encode()
            gz = gzip.compress(raw, compresslevel=9, mtime=0)     # no timestamp: unchanged blocks stay byte-identical
            path = os.path.join(DEST, name)
            if not os.path.exists(path) or open(path, 'rb').read() != gz:
                with open(path, 'wb') as g:
                    g.write(gz)
            kb = os.path.getsize(os.path.join(DEST, name)) // 1024
            out_index[b['f']] = {'n': len(out), 'kb': kb}
            total += kb
    write_json(os.path.join(DEST, 'index.json'), out_index)
    stats['kb'] = total
    write_json(os.path.join(CACHE, 'context', 'writeups_stats.json'), stats, pretty=True)
    log(f'write-ups: {stats}')


if __name__ == '__main__':
    main()
