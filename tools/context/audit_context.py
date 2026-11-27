"""Check the context facts (kinds P, G, Y, L, V, D of tools/audit/facts.txt) against data/context/.
Used by tools/audit.py; run alone it checks tools/context/facts_context.txt (or a file given as argument)."""
import os
import sys
import unicodedata

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from common import DATA, read_json  # noqa: E402

KINDS = 'PGYLVD'
_idx = {}


def fold(t):
    t = (t or '').replace('ʻ', '').replace("'", '').replace('’', '')
    return ''.join(c for c in unicodedata.normalize('NFKD', t) if not unicodedata.combining(c)).lower()


def period(names, y):
    if 'index' not in _idx:
        p = os.path.join(DATA, 'context', 'index.json')
        _idx['index'] = read_json(p) if os.path.exists(p) else {}
    for n in names:
        f = _idx['index'].get(n.strip())
        if not f:
            continue
        doc = read_json(os.path.join(DATA, 'context', f))
        for p in doc['periods']:
            if p['from'] <= y <= p['to']:
                return n.strip(), p
    return None, None


def pop_at(p, y):
    rows = [r for r in p.get('pop', []) if r[0] <= y] or p.get('pop', [])[:1]
    return rows[-1] if rows else None


def check(kind, a):
    """(ok, got) for one fact line split on '|' (without the kind)."""
    if kind == 'D':
        names, y, states = a[0].split(';'), int(a[1]), a[2].split(';')
        d = read_json(os.path.join(DATA, 'context', 'discoveries.json'))
        F = d['fields']
        rows = [dict(zip(F, r)) for r in d['items']]
        hits = [r for r in rows if any(fold(n) in fold(r['l']) for n in names) and abs(r['y'] - y) <= 1]
        pw = read_json(os.path.join(DATA, 'powers.json')) if os.path.exists(os.path.join(DATA, 'powers.json')) else {}

        def label(r):
            return ' | '.join(x for x in [r['p'] or '', r['pw'] or ''] if x)
        ok = any(any(fold(s) in fold(label(r)) for s in states) for r in hits)
        got = '; '.join(f"{r['l']} {r['y']} -> {label(r) or 'no state'}" for r in hits[:3]) or 'not found'
        return ok, got
    names, y = a[0].split(';'), int(a[1])
    n, p = period(names, y)
    if not p:
        return False, 'no context for that year'
    if kind == 'P':
        lo, hi = float(a[2]), float(a[3])
        r = pop_at(p, y)
        if not r:
            return False, 'no population'
        mid = r[1]
        return lo <= mid <= hi, f'{n} {r[0]}: {r[1]:,} ({r[2]:,}-{r[3]:,}; {", ".join(r[4])})'
    if kind == 'G':
        hay = fold(' | '.join(p.get('gov', [])))
        return any(fold(t) in hay for t in a[2].split(';')), '; '.join(p.get('gov', [])) or 'no form of government'
    if kind == 'Y':
        got = p.get('party')
        hay = fold(got[0]) if got else ''
        return bool(got) and any(fold(t) in hay for t in a[2].split(';')), (f'{got[0]} ({got[2]}, {got[3]})' if got else 'no ruling party')
    if kind == 'L':
        want = a[2]
        rel = [r for r in p.get('rel', []) if want == 'any' or r[1] == want or (want == 'majority' and r[1] == 'majority')]
        hay = fold(' | '.join(r[0] for r in rel))
        return any(fold(t) in hay for t in a[3].split(';')), '; '.join(f'{r[0]} ({r[1]})' for r in p.get('rel', [])) or 'no religion'
    if kind == 'V':
        hay = fold(' | '.join(m[0] + ' ' + (m[3] or '') for m in p.get('mov', [])))
        return any(fold(t) in hay for t in a[2].split(';')), '; '.join(m[0] for m in p.get('mov', [])) or 'no movements'
    return False, 'unknown kind'


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'facts_context.txt')
    n = ok_n = 0
    by = {}
    for line in open(path, encoding='utf-8'):
        line = line.strip()
        if not line or line.startswith('#') or line[0] not in KINDS or line[1] != '|':
            continue
        kind, *a = line.split('|')
        ok, got = check(kind, a)
        n += 1
        ok_n += ok
        by.setdefault(kind, [0, 0])
        by[kind][0] += ok
        by[kind][1] += 1
        print(('PASS ' if ok else 'FAIL ') + line + ('' if ok else f'   (data: {got})'))
    print(f'\n{ok_n}/{n} pass; ' + ', '.join(f'{k} {v[0]}/{v[1]}' for k, v in by.items()))


if __name__ == '__main__':
    main()
