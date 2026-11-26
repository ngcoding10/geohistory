"""Empires and their parts: data/empires.json.

A membership says that a territory belonged to a sovereign power in a range of years. They come from
  1. the border sources themselves: a row of a yearly map that names a ruler (Cliopatria's member-of field;
     CShapes dependencies, whose owner comes from tools/curated/dependency_owners.json or the sketch maps);
  2. tools/curated/empires.json: dated memberships written for GeoHistory (dominions, vassals, personal
     unions, and parts that have no shape of their own in the sources: these are listed, never drawn).
Rows whose "ruler" text is a status, an occupation or a dispute are not memberships (occupations go to
data/occupations.json, see build_occupations.py).

Each membership is checked against Wikidata: verified when the item of the part names an item of the empire
as its country (P17), as what it is part of (P361), as its administrative parent (P131), its owner (P127),
its jurisdiction (P1001) or what it is a member of (P463), in a statement of any rank but deprecated, or one
"part of" / "located in" step further up; or when the empire's item lists the part (P150, P527).

The app merges the drawn parts of an empire at world zoom and shows them apart when zoomed in.
"""
import os
import re
from collections import defaultdict

from common import DATA, TOOLS, CACHE, read_json, write_json, sparql, qid, log

NOT_MEMBER = re.compile(r'^(Self-ruling|Disputed|Free city|not independent|Leopold II)|occupation|occupied|military administration', re.I)   # Leopold II: the Congo Free State was the king's own, not Belgium's
ZONE = re.compile(r'\bzone\b|zones\)', re.I)


def runs(years):
    out, s, p = [], None, None
    for y in sorted(years):
        if s is None:
            s = p = y
        elif y == p + 1:
            p = y
        else:
            out.append([s, p])
            s = p = y
    if s is not None:
        out.append([s, p])
    return out


def titles_to_q(titles):
    """English Wikipedia titles -> Wikidata ids (cached)."""
    out = {}
    ts = sorted(set(titles))
    for i in range(0, len(ts), 60):
        vals = ' '.join('"%s"@en' % t.replace('\\', '\\\\').replace('"', '\\"') for t in ts[i:i + 60])
        q = ('SELECT ?t ?x WHERE { VALUES ?t { %s } ?a schema:name ?t ; schema:isPartOf <https://en.wikipedia.org/> ; '
             'schema:about ?x . }' % vals)
        for r in sparql(q):
            out[r['t']] = qid(r['x'])
    return out


def links_of(qs):
    """For each item: the items it points at with P17/P361/P131/P127/P1001/P5125, and the items that list it.
    Statements of every rank count (a place's former country is often kept beside its current one at a lower
    rank), and so does one step further up "part of" / "located in" (a colony part of the British West Indies,
    which are part of the British Empire)."""
    out = defaultdict(set)
    qs = sorted(set(qs))
    for i in range(0, len(qs), 150):
        vals = ' '.join('wd:' + q for q in qs[i:i + 150])
        for r in sparql('SELECT ?x ?o WHERE { VALUES ?x { %s } { ?x wdt:P17|wdt:P361|wdt:P131|wdt:P127|wdt:P1001|wdt:P5125 ?o } '
                        'UNION { ?o wdt:P150|wdt:P527 ?x } }' % vals):
            out[qid(r['x'])].add(qid(r['o']))
    for i in range(0, len(qs), 100):
        vals = ' '.join('wd:' + q for q in qs[i:i + 100])
        try:
            rows = sparql('SELECT DISTINCT ?x ?o WHERE { VALUES ?x { %s } '
                          '{ ?x p:P17|p:P361|p:P131|p:P127|p:P1001|p:P463 ?st . ?st ps:P17|ps:P361|ps:P131|ps:P127|ps:P1001|ps:P463 ?o . '
                          '  FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank } } '
                          'UNION { ?o p:P150|p:P527 ?st2 . ?st2 ps:P150|ps:P527 ?x } '
                          'UNION { ?x wdt:P361|wdt:P131 ?m . ?m wdt:P361|wdt:P17|wdt:P131 ?o } }' % vals)
        except Exception as ex:
            log(f'  broader membership check, batch {i} failed: {ex}')
            continue
        for r in rows:
            out[qid(r['x'])].add(qid(r['o']))
    return out


def main():
    cur = read_json(os.path.join(TOOLS, 'curated', 'empires.json'))
    emps = {e['id']: e for e in cur['empires']}
    ruler_to = {}
    for e in cur['empires']:
        for r in e['rulers']:
            ruler_to[r] = e['id']
    exclude = {(x['row'], x['empire']) for x in cur.get('exclude', [])}

    # ---- 1. memberships stated by the yearly maps
    auto = defaultdict(set)      # (row name, empire id, source letter) -> years
    auto_name = {}
    present = defaultdict(set)   # row name -> years on the yearly maps
    cidx = read_json(os.path.join(DATA, 'clio', 'index.json'))
    ys = cidx['years']
    for i, y in enumerate(ys):
        end = ys[i + 1] - 1 if i + 1 < len(ys) else cidx['to']
        span = range(y, end + 1)
        for r in read_json(os.path.join(DATA, 'clio', 'years', f'{y}.json'))['rows']:
            if len(r) >= 5 and r[4] and not r[3]:
                continue
            present[r[1]].update(span)
            if r[3] and not NOT_MEMBER.search(r[3]):
                eid = ruler_to.get(r[3]) or r[2]
                if (r[1], eid) in exclude:
                    continue
                auto[(r[1], eid, 'c' if len(r) < 5 else 'm')].update(span)
                auto_name.setdefault(eid, r[3])
    csi = read_json(os.path.join(DATA, 'cshapes', 'index.json'))
    for y in range(csi['from'], csi['to'] + 1):
        for r in read_json(os.path.join(DATA, 'cshapes', 'years', f'{y}.json'))['rows']:
            present[r[1]].add(y)
            if r[3] and not NOT_MEMBER.search(r[3]) and not ZONE.search(r[1]) and not ZONE.search(r[3]):
                eid = ruler_to.get(r[3]) or r[2]
                auto[(r[1], eid, 'd' if len(r) > 4 else 'm')].add(y)
                auto_name.setdefault(eid, r[3])

    for eid, nm in auto_name.items():
        if eid not in emps:
            emps[eid] = {'id': eid, 'name': nm, 'wiki': [], 'rulers': [nm], 'core': [nm], 'auto': True}

    rows = defaultdict(list)     # row name -> [from, to, empire, kind, flags, note index]
    undrawn = defaultdict(list)
    members = []                 # for verification and counts
    # a curated membership of the same row in the same empire replaces what the map states for those years
    for mrow in cur['memberships']:
        for rn in mrow.get('rows') or []:
            for key in [k for k in auto if k[0] == rn and k[1] == mrow['empire']]:
                auto[key] -= set(range(mrow['from'], mrow['to'] + 1))
    for (name, eid, src), years in sorted(auto.items()):
        for a, b in runs(years):
            members.append({'part': name, 'empire': eid, 'from': a, 'to': b, 'kind': 'dependency' if src != 'c' else 'member',
                            'src': src, 'rows': [name]})
    for mrow in cur['memberships']:
        d = dict(mrow, src='x')
        if d.get('rows'):
            # keep the years in which one of its rows is on a yearly map
            yrs = set()
            for rn in d['rows']:
                yrs |= {y for y in present.get(rn, ()) if d['from'] <= y <= d['to']}
            if not yrs:
                d['rows'] = None        # never drawn in those years: listed only
        members.append(d)

    # ---- 2. Wikidata check
    ents = read_json(os.path.join(DATA, 'entities.json'))
    clio_links = read_json(os.path.join(CACHE, 'clio_links.json')) if os.path.exists(os.path.join(CACHE, 'clio_links.json')) else {}
    titles = set()
    for e in emps.values():
        titles.update(e.get('wiki', []))
    for d in members:
        if d.get('source'):
            d['_t'] = re.sub(r'_', ' ', d['source'].rsplit('/wiki/', 1)[-1])
            titles.add(d['_t'])
    try:
        t2q = titles_to_q(titles)
    except Exception as ex:   # no network and no cache: nothing is verified
        log('  Wikidata not reachable, memberships stay unverified:', ex)
        t2q = {}
    emp_q = defaultdict(set)
    for e in emps.values():
        for t in e.get('wiki', []):
            if t in t2q:
                emp_q[e['id']].add(t2q[t])
        for n in e.get('core', []) + e.get('rulers', []):
            q = (ents.get(n) or {}).get('q') or (clio_links.get(n) or {}).get('q')
            if q:
                emp_q[e['id']].add(q)
    for d in members:
        d['_q'] = t2q.get(d.get('_t')) or (ents.get(d['part']) or {}).get('q') or (clio_links.get(d['part']) or {}).get('q')
    try:
        lk = links_of([d['_q'] for d in members if d['_q']])
    except Exception as ex:
        log('  Wikidata not reachable, memberships stay unverified:', ex)
        lk = {}
    for d in members:
        d['verified'] = bool(d['_q'] and (lk.get(d['_q'], set()) & emp_q[d['empire']]))

    # write the flags back into the curated file
    it = iter([d for d in members if d['src'] == 'x'])
    for mrow in cur['memberships']:
        mrow['verified'] = next(it)['verified']
    write_json(os.path.join(TOOLS, 'curated', 'empires.json'), cur, pretty=True)

    # ---- 3. output
    notes = []

    def note_ix(t):
        if not t:
            return None
        if t not in notes:
            notes.append(t)
        return notes.index(t)
    for d in members:
        flags = d['src'] + ('v' if d['verified'] else '') + ('' if d.get('merge', True) else 'n')
        if d.get('rows'):
            for rn in d['rows']:
                yrs = [y for y in present.get(rn, ()) if d['from'] <= y <= d['to']]
                for a, b in runs(yrs):
                    rows[rn].append([a, b, d['empire'], d['kind'], flags, note_ix(d.get('note')), d['part'] if d['part'] != rn else None])
        else:
            undrawn[d['empire']].append([d['part'], d['from'], d['to'], d['kind'], flags, note_ix(d.get('note')),
                                         d.get('_t')])
    for v in rows.values():
        v.sort(key=lambda r: (r[0], 0 if r[4][0] == 'x' else 1))
    out_emps = {}
    used = {r[2] for v in rows.values() for r in v} | set(undrawn)
    for eid in sorted(used):
        e = emps[eid]
        o = {'n': e['name'], 'core': e.get('core', [])}
        if e.get('names'):
            o['names'] = e['names']
        if e.get('wiki'):
            o['w'] = e['wiki'][0]
        if e.get('ck'):
            o['ck'] = e['ck']
        out_emps[eid] = o
    n_all = len(members)
    n_ver = sum(d['verified'] for d in members)
    by_src = defaultdict(lambda: [0, 0])
    for d in members:
        by_src[d['src']][0] += 1
        by_src[d['src']][1] += d['verified']
    stats = {'memberships': n_all, 'verified': n_ver, 'drawn': sum(1 for d in members if d.get('rows')),
             'listedOnly': sum(1 for d in members if not d.get('rows')),
             'bySource': {{'c': 'cliopatria', 'd': 'curatedOwners', 'm': 'sketchMaps', 'x': 'curatedEmpires'}[k]: v for k, v in sorted(by_src.items())},
             'empires': len(out_emps)}
    write_json(os.path.join(DATA, 'empires.json'), {'empires': out_emps, 'rows': rows, 'undrawn': undrawn, 'notes': notes, 'stats': stats})
    log(f'empires: {stats}')


if __name__ == '__main__':
    main()
