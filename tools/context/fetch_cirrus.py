"""Plain text of the English Wikipedia articles the event write-ups need, from Wikimedia's CirrusSearch
index dump (https://dumps.wikimedia.org/other/cirrus_search_index/, CC BY-SA 4.0 text).

The Wikipedia APIs answer "too many requests" from the shared address this build runs from, so the dump is
streamed instead: each of the ~66 bz2 shards (about 630 MB each) is downloaded and decompressed on the fly,
and only the articles whose title (or one of whose redirects) an event, a state or a discovery names are kept.
A shard that is done leaves tools/cache/context/cirrus/<shard>.jsonl behind, so a stopped run continues
where it stopped (the work queue is the shard list).

Usage: fetch_cirrus.py [workers] [wiki]   (wiki: enwiki, or enwikisource for the 1911 Britannica)
"""
import ast
import bz2
import glob
import json
import os
import re
import sys
import time
import urllib.request
from multiprocessing import Pool

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from common import CACHE, DATA, TOOLS, UA, log, read_json  # noqa: E402

DUMP = 'https://dumps.wikimedia.org/other/cirrus_search_index/'
DIR = os.path.join(CACHE, 'context', 'cirrus')


def wanted():
    out = set()
    for f in glob.glob(os.path.join(DATA, 'events', '*_*.json')):
        for e in read_json(f)['events']:
            if e.get('w'):
                out.add(e['w'])
    for f in ('movements.json', 'discoveries.json'):
        p = os.path.join(TOOLS, 'curated', 'context', f)
        if os.path.exists(p):
            for m in list(read_json(p).values())[-1]:
                out.add(m['wiki'])
    for v in read_json(os.path.join(DATA, 'entities.json')).values():
        if v.get('w'):
            out.add(v['w'])
    return out


def shards(date, wiki):
    url = f'{DUMP}{date}/index_name%3D{wiki}_content/'
    html = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60).read().decode()
    return [url + n for n in sorted(set(re.findall(r'href="([^"]+\.json\.bz2)"', html)))]


def latest():
    html = urllib.request.urlopen(urllib.request.Request(DUMP, headers={'User-Agent': UA}), timeout=60).read().decode()
    return sorted(re.findall(r'href="(\d{8})/"', html))[-1]


def strip_wiki(w):
    """Rough wikitext to plain text, enough to find a section's first words in the plain text."""
    w = re.sub(r'<ref[^>/]*/>', '', w)
    w = re.sub(r'<ref[^>]*>.*?</ref>', '', w, flags=re.S)
    w = re.sub(r'<!--.*?-->', '', w, flags=re.S)
    for _ in range(4):
        w = re.sub(r'\{\{[^{}]*\}\}', '', w)
    w = re.sub(r'\{\|.*?\|\}', '', w, flags=re.S)
    w = re.sub(r'\[\[(?:File|Image|Category):[^\]]*(?:\[\[[^\]]*\]\][^\]]*)*\]\]', '', w, flags=re.I)
    w = re.sub(r'\[\[(?:[^\]|]*\|)?([^\]]*)\]\]', r'\1', w)
    w = re.sub(r'\[https?://\S+ ([^\]]*)\]', r'\1', w)
    w = re.sub(r"'{2,}", '', w)
    w = re.sub(r'<[^>]+>', '', w)
    return w


def sections(text, src):
    """Split the plain text into the lead and the sections, using the wikitext's headings: each section starts
    where its first words (from the wikitext) occur in the plain text. [[heading, level, plain text], ...];
    the lead is the first entry with heading ''."""
    parts = re.split(r'\n(={2,6})\s*([^=\n]+?)\s*\1\s*\n', '\n' + src)
    heads = [('', 0, parts[0])]
    for i in range(1, len(parts) - 2, 3):
        heads.append((strip_wiki(parts[i + 1]).strip(), len(parts[i]), parts[i + 2]))
    starts = []
    pos = 0
    for h, lvl, body in heads:
        plain = re.sub(r'\s+', ' ', strip_wiki(body)).strip()
        words = plain.split(' ')[:6]
        found = -1
        while len(words) >= 3:
            found = text.find(' '.join(words), pos)
            if found >= 0:
                break
            words = words[:-1]
        if h == '':
            found = 0
        if found >= 0:
            starts.append((found, h, lvl))
            pos = found + 1
    out = []
    for k, (st, h, lvl) in enumerate(starts):
        en = starts[k + 1][0] if k + 1 < len(starts) else len(text)
        out.append([h, lvl, text[st:en].strip()])
    return out


def work(args):
    url, want, wiki = args
    name = url.rsplit('/', 1)[-1].replace('.json.bz2', '')
    out = os.path.join(DIR, wiki, name + '.jsonl')
    if os.path.exists(out):
        return name, 'cached'
    for attempt in range(5):
        try:
            return name, stream(url, want, out, wiki)
        except Exception as ex:   # noqa: BLE001 (network: start the shard again)
            log(f'  {name}: {ex}; retrying')
            time.sleep(30 * (attempt + 1))
    return name, 'failed'


def stream(url, want, out, wiki):
    dec = bz2.BZ2Decompressor()
    buf = b''
    kept = n = 0
    tmp = out + '.tmp'
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=300) as r, open(tmp, 'w', encoding='utf-8') as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            data = dec.decompress(chunk)
            if not data:
                continue
            buf += data
            lines = buf.split(b'\n')
            buf = lines.pop()
            for line in lines:
                if not line.startswith(b'{"page_id"') and b'"title"' not in line[:400] and not line.startswith(b'{"'):
                    continue
                if line.startswith(b'{"index"'):
                    continue
                try:
                    doc = json.loads(line)
                except ValueError:
                    continue
                n += 1
                if doc.get('namespace') not in ('0', 0, '102', 102) and wiki == 'enwiki':
                    continue
                if doc.get('page_type') == 'redirect':
                    continue
                title = doc.get('title')
                reds = doc.get('redirect')
                if isinstance(reds, str):
                    try:
                        reds = [x.get('title') for x in ast.literal_eval(reds)]
                    except (ValueError, SyntaxError, AttributeError):
                        reds = []
                elif isinstance(reds, list):
                    reds = [x.get('title') if isinstance(x, dict) else x for x in reds]
                else:
                    reds = []
                if want is None:
                    hits = [title] if (title or '').startswith('1911 Encyclopædia Britannica/') else []
                else:
                    hits = [t for t in [title] + reds if t in want]
                if not hits:
                    continue
                heads = doc.get('heading')
                if isinstance(heads, str):
                    try:
                        heads = ast.literal_eval(heads)
                    except (ValueError, SyntaxError):
                        heads = []
                text = doc.get('text') or ''
                try:
                    secs = sections(text, doc.get('source_text') or '')
                except Exception:   # noqa: BLE001
                    secs = [['', 0, text[:3000]]]
                rec = {'title': title, 'as': hits, 'sec': [[h, l, t[:8000]] for h, l, t in secs[:30]],
                       'pop': doc.get('popularity_score'), 'rev': doc.get('version'), 'ts': doc.get('timestamp'),
                       'coord': doc.get('coordinates') if doc.get('coordinates') not in ('[]', [], None) else None}
                f.write(json.dumps(rec, ensure_ascii=False) + '\n')
                kept += 1
    os.replace(tmp, out)
    return f'{kept} kept of {n}'


def main():
    workers = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    wiki = sys.argv[2] if len(sys.argv) > 2 else 'enwiki'
    os.makedirs(os.path.join(DIR, wiki), exist_ok=True)
    date = latest()
    urls = shards(date, wiki)
    want = wanted() if wiki == 'enwiki' else None
    log(f'cirrus {wiki} {date}: {len(urls)} shards, {len(want) if want else "all"} titles wanted')
    with Pool(workers) as pool:
        for name, res in pool.imap_unordered(work, [(u, want, wiki) for u in urls]):
            log(f'  {name}: {res}')


if __name__ == '__main__':
    main()
