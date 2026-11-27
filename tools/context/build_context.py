"""The state context: for every state on the map, time slices with population, government and parties,
religion, leaders, movements and discoveries, and an "at a glance" line built from those facts.

Inputs (all built earlier in this folder): states.json, population.json, wikidata.json (tools/cache/context/),
data/context/discoveries.json, the curated files in tools/curated/context/, and the ruler lists of
data/timelines/ (heads of state and government already shown by the app).

Rules
- Which Wikidata items speak for a state in a year: the curated regime for that year
  (tools/curated/context/regimes.json), else the state's own item and the earlier eras link_wikidata found,
  each only within its own dates (with 10 years of slack).
- A statement (government form, religion) counts in a year when its start/end qualifiers contain the year;
  one without qualifiers counts for the whole life of its item. Deprecated statements are never used.
- Religion: "official" only from Wikidata's official religion (P3075); a "religion" statement (P140) on a
  state is shown as "religion (Wikidata)", without a claim that most people held it.
- Ruling party in a year: the party (P102, valid that year) of the leader of a one-party state as the
  ruler lists name him, else of the head of government, else of the head of state (head of state first where
  the form of government is presidential). Nothing is shown when the office holder has no party on Wikidata.
- Parties: Wikidata political parties of the state's items (P17) active in the slice, most sitelinks first.
- Population: the HYDE 3.2.1 sum over the map's own outlines (a model estimate), Wikidata census figures
  (P1082) of the state's items within the slice, and Maddison's figure for today's country when the state
  covers nearly the same population (HYDE totals within 15%); several figures make a range.
- Slices: a new slice starts when the regime item, form of government, official religion or ruling party
  changes, and at least every 100 years before 1500, 50 years before 1800 and 25 years after.

Writes data/context/index.json ({name: file}), data/context/<slug>.json and tools/cache/context/coverage.json.
"""
import hashlib
import math
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from common import CACHE, DATA, TOOLS, log, read_json, write_json  # noqa: E402

OUT = os.path.join(CACHE, 'context')
DEST = os.path.join(DATA, 'context')
SLACK = 10
HOG = re.compile(r'prime minister|premier\b|taoiseach|head of government|president of the government|'
                 r'president of the council of ministers|chairman of the council of ministers|chairman of the council of people|'
                 r'(?:reich |federal )?chancellor(?! of the exchequer)(?! of the duchy)(?! of the university)(?! of the high court)|'
                 r'grand vizier|chief minister|state counsellor|first minister', re.I)
LEADER = re.compile(r'general secretary|first secretary|leader of the|chairman of the (?:chinese )?communist party|'
                    r'chairman of the central committee|supreme leader|führer|duce', re.I)
HOS = re.compile(r'president|king|queen|emperor|empress|monarch|sultan|shah|tsar|emir|head of state', re.I)
BAD_TITLE = re.compile(r'exchequer|duchy of lancaster|vice[- ]president|vice[- ]chancellor|deputy|speaker', re.I)


def slug(name):
    s = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')[:40] or 'x'
    return f'{s}-{hashlib.sha1(name.encode()).hexdigest()[:6]}'


def sig(v, n):
    if not v:
        return 0
    d = n - 1 - int(math.floor(math.log10(abs(v))))
    return int(round(v, d))


def valid(row, y, item):
    """A statement [v, label, start, end, pit, rank, src] applies in year y."""
    a, b = row[2], row[3]
    if a is None and b is None:
        f, t = item.get('from'), item.get('to')
        return (f is None or f - SLACK <= y) and (t is None or y <= t + SLACK)
    return (a is None or a <= y) and (b is None or y <= b)


def pick(rows, y, item):
    ok = [r for r in rows if valid(r, y, item) and r[1]]
    if any(r[5] == 'preferred' for r in ok):
        ok = [r for r in ok if r[5] == 'preferred']
    out = []
    for r in ok:
        if r[1] not in [o[1] for o in out]:
            out.append(r)
    return out


class Ctx:
    def __init__(self):
        self.st = read_json(os.path.join(OUT, 'states.json'))
        self.pop = read_json(os.path.join(OUT, 'population.json'))
        self.wd = read_json(os.path.join(OUT, 'wikidata.json'))
        self.items = self.wd['items']
        self.tl_index = read_json(os.path.join(DATA, 'timelines', 'index.json'))
        self.terms = read_json(os.path.join(DATA, 'rulers', 'terms.json'))
        self.offices_from = {k: v for k, v in read_json(os.path.join(TOOLS, 'curated', 'context', 'regimes.json')).get('officesFrom', {}).items() if not k.startswith('_')}
        cur = read_json(os.path.join(TOOLS, 'curated', 'context', 'movements.json'))
        self.cur_mov = cur['movements']
        self.mov_by_state = {}
        for m in self.cur_mov:
            for n in m['states']:
                self.mov_by_state.setdefault(n, []).append(m)
        self.wd_mov_by_item = {}
        for q, m in self.wd['movements'].items():
            if m.get('sl', 0) < 25 or m.get('from') is None:
                continue
            for c in m['c']:
                self.wd_mov_by_item.setdefault(c, []).append((q, m))
        self.parties_by_item = {}
        for q, p in self.wd['parties'].items():
            for c in p['c']:
                self.parties_by_item.setdefault(c, []).append((q, p))
        d = read_json(os.path.join(DATA, 'context', 'discoveries.json'))
        F = d['fields']
        self.disc, self.disc_pw = {}, {}
        for row in d['items']:
            r = dict(zip(F, row))
            if r['p']:
                self.disc.setdefault(r['p'], []).append(r)
            if r['pw']:
                self.disc_pw.setdefault(r['pw'], []).append(r)
        iso_q = read_json(os.path.join(CACHE, 'iso_q.json'))
        self.iso_of_q = {q: iso for iso, q in iso_q.items()}
        self.cur_gov, self.cur_rel = {}, {}
        g = read_json(os.path.join(TOOLS, 'curated', 'context', 'government.json'))
        for e in g['states']:
            for n in e['names']:
                self.cur_gov.setdefault(n, []).append(e)
        r = read_json(os.path.join(TOOLS, 'curated', 'context', 'religion.json'))
        for e in r['states']:
            for n in e['names']:
                self.cur_rel.setdefault(n, []).append(e)
        self.gov_doc, self.rel_doc = g, r
        self.cur_pop = {}
        for r in read_json(os.path.join(TOOLS, 'curated', 'context', 'population.json'))['rows']:
            for n in r['names']:
                self.cur_pop.setdefault(n, []).append(r)
        self.party_doc = read_json(os.path.join(TOOLS, 'curated', 'context', 'parties.json'))
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from fetch_context import resolve_titles
        res = resolve_titles([row[2] for e in self.party_doc['states'] for row in e['rows']])
        self.cur_party = {}
        for e in self.party_doc['states']:
            ok = True
            for row in e['rows']:
                r = res.get(row[2]) or {}
                row_ok = bool(r.get('q')) and (r.get('from') is None or r['from'] <= row[0] + 1) and (r.get('to') is None or r['to'] >= row[1] - 1)
                ok = ok and row_ok
                for n in e['names']:
                    self.cur_party.setdefault(n, []).append((row[0], row[1], r.get('q'), self.wd['parties'].get(r.get('q'), {}).get('n') or row[2], row[3], e['source']))
            e['verified'] = ok
        self.modern_pts = modern_index()
        self.label_pt = label_points(self.st)

    # ------------------------------------------------------------------ items speaking for a state
    def items_at(self, name, s, y):
        reg = self.wd['regimes'].get(name)
        if reg:
            for a, b, q, title, ok, note in reg:
                if q and a <= y <= b:
                    return [q], q
        out = []
        for e in s.get('eras', []):
            f, t = e.get('from'), e.get('to')
            if (f is None or f - SLACK <= y) and (t is None or y <= t + SLACK):
                out.append(e['q'])
        q = s.get('q')
        if q:
            it = self.items.get(q, {})
            f, t = it.get('from', s.get('from')), it.get('to', s.get('to'))
            mod = s.get('mod')
            if (mod is None or y >= mod - SLACK) and (f is None or f - SLACK <= y or mod is not None) and (t is None or y <= t + SLACK):
                out.insert(0, q)
        return out, (out[0] if out else None)

    def statements(self, qs, prop, y):
        res = []
        for q in qs:
            it = self.items.get(q, {})
            for r in pick(it.get(prop, []), y, it):
                if r[1] not in [x[0] for x in res]:
                    res.append([r[1], q])
            if res:
                break   # the first item that has an answer speaks for the state
        return res

    def gov(self, name, qs, y):
        """(forms, undated forms, source): curated dated rows first, else Wikidata (dated statements, or the
        only undated one; several undated forms are kept apart as 'at some time')."""
        for e in self.cur_gov.get(name, []):
            for a, b, form in e['rows']:
                if a <= y <= b:
                    return [form], [], 'c'
        for q in qs:
            it = self.items.get(q, {})
            rows = [r for r in it.get('P122', []) if r[1]]
            dated = [r for r in rows if (r[2] is not None or r[3] is not None) and valid(r, y, it)]
            undated = [r for r in rows if r[2] is None and r[3] is None and valid(r, y, it)]
            if dated:
                return list(dict.fromkeys(r[1] for r in dated)), [], 'w'
            short = it.get('from') is not None and it.get('to') is not None and it['to'] - it['from'] <= 30
            if len(undated) == 1 or (undated and short):
                return list(dict.fromkeys(r[1] for r in undated)), [], 'w'
            if undated:
                return [], list(dict.fromkeys(r[1] for r in undated)), 'w'
        return [], [], None

    def religion(self, name, qs, y):
        out = []
        for e in self.cur_rel.get(name, []):
            if e['from'] <= y <= e['to']:
                for k in ('official', 'majority', 'rulers'):
                    for v in e.get(k, []):
                        if not any(o[0] == v and o[1] == k for o in out):
                            out.append([v, k, 'c', e['source'], e.get('note')])
        curated = bool(out)
        for q in qs:
            it = self.items.get(q, {})
            long_lived = it.get('from') is None or it.get('to') is None or it['to'] - it['from'] > 100
            for prop, kind in (('P3075', 'official'), ('P140', 'recorded')):
                rows = pick(it.get(prop, []), y, it)
                undated = [r for r in rows if r[2] is None and r[3] is None]
                for r in rows:
                    k = kind
                    if r in undated and long_lived and len(undated) > 1:
                        if curated:
                            continue      # a curated, dated entry speaks for these years
                        k = 'recorded, undated'
                    elif prop == 'P3075' and len(undated) > 2:
                        k = 'recognised'
                    if not any(fold(r[1]) in fold(o[0]) or fold(o[0]) in fold(r[1]) for o in out):
                        out.append([r[1], k, 'w', f'https://www.wikidata.org/wiki/{q}', None])
            if it.get('P3075') or it.get('P140'):
                break
        return out

    # ------------------------------------------------------------------ parties
    def party_of(self, person, y):
        rows = self.wd['persons'].get(person, [])
        dated = [r for r in rows if (r[1] is not None or r[2] is not None) and (r[1] is None or r[1] <= y) and (r[2] is None or y <= r[2])]
        cand = dated or [r for r in rows if r[1] is None and r[2] is None]
        out = []
        for r in cand:
            p = self.wd['parties'].get(r[0], {})
            f, t = p.get('from'), p.get('to')
            if (f is None or f <= y + 1) and (t is None or y <= t + 1):
                out.append(r[0])
        if len(out) > 1 and dated:
            out = [r[0] for r in dated if r[0] in out]
        return out[:1] if len(set(out)) == 1 else (out[:1] if out else [])

    def ruling(self, rulers, y, gov, name=None):
        for a, b, q, label, kind, src in self.cur_party.get(name, []):
            if a <= y <= b:
                return q or label, [label, None, None, f'{kind} rule ({src})', label]
        now = [r for r in rulers if r[1] <= y and (r[2] if r[2] is not None else r[1]) >= y and not BAD_TITLE.search(r[3])]
        one_party = any(re.search(r'one-party|communist|socialist|soviet|people.s republic|fascis|totalitarian', g, re.I) for g in gov)
        lead = [r for r in now if LEADER.search(r[3]) and (one_party or (len(r) > 5 and 'c' in (r[5] or '')))]
        hog = [r for r in now if HOG.search(r[3]) and r not in lead]
        hos = [r for r in now if HOS.search(r[3]) and r not in lead and r not in hog]
        presidential = any('presidential' in g.lower() for g in gov)
        order = lead + (hos + hog if presidential else hog + hos)
        for r in order:
            if len(r) > 4 and r[4]:
                ps = self.party_of(r[4], y)
                if ps:
                    return ps[0], r
        return None, None

    def parties(self, qs, a, b, limit=6):
        seen, out = set(), []
        for q in qs:
            for pq, p in self.parties_by_item.get(q, []):
                f, t = p.get('from'), p.get('to')
                if pq in seen or (f is not None and f > b) or (t is not None and t < a) or f is None:
                    continue
                seen.add(pq)
                out.append((p['sl'], pq, p))
        out.sort(key=lambda x: -x[0])
        return [[p['n'], pq, p.get('from'), p.get('to'), (p.get('ideo') or [])[:2]] for _, pq, p in out[:limit]]

    # ------------------------------------------------------------------ population
    def population(self, name, s, a, b, qs_by_year):
        ser = self.pop['states'].get(name, [])
        pw = None
        samples = [r for r in ser if a <= r[0] <= b]
        before = [r for r in ser if r[0] < a]
        if before and (not samples or samples[0][0] > a):
            samples.insert(0, [a, before[-1][1]])
        if not samples and ser:
            samples = [min(ser, key=lambda r: abs(r[0] - a))]
        # keep at most 6 samples: first, last and evenly spaced
        if len(samples) > 6:
            k = (len(samples) - 1) / 5
            samples = [samples[round(i * k)] for i in range(6)]
        out = []
        iso = self.modern_iso(name, s)
        mod = self.pop['modern'].get(iso, {}) if iso else {}
        census = []
        for q in (qs_by_year[0][1][:1] if qs_by_year else []):
            for r in self.items.get(q, {}).get('P1082', []):
                try:
                    if r[4] is not None and float(r[0]) > 0:
                        census.append((r[4], float(r[0]), r[6] or 'Wikidata'))
                except (TypeError, ValueError):
                    pass
        for y, hy in samples:
            figs = [[hy, 'HYDE 3.2.1 (model estimate for this territory)']]
            cur = sorted(self.cur_pop.get(name, []), key=lambda r: r['year'])
            hit = [r for r in cur if abs(r['year'] - y) <= 5]
            if hit:
                r = hit[0]
                for v in ([r['value']] if 'value' in r else [r['low'], r['high']]):
                    figs.append([v, f"{r['who']}, {r['year']} (curated)"])
            elif y < 1500:
                lo_ = [r for r in cur if r['year'] < y and 'value' in r]
                hi_ = [r for r in cur if r['year'] > y and 'value' in r]
                if lo_ and hi_:
                    a_, b_ = lo_[-1], hi_[0]
                    v = a_['value'] * (b_['value'] / a_['value']) ** ((y - a_['year']) / (b_['year'] - a_['year']))
                    figs.append([v, f"{a_['who']}, between {a_['year']} and {b_['year']} (curated, interpolated)"])
            near = [c for c in census if abs(c[0] - y) <= 5]
            if near:
                c = min(near, key=lambda c: abs(c[0] - y))
                figs.append([c[1], f'Wikidata, {c[0]} ({c[2]})'])
            if mod.get('maddison') and mod.get('hyde'):
                mh = interp_series(mod['hyde'], y)
                md = [r for r in mod['maddison'] if abs(r[0] - y) <= (5 if y >= 1820 else 50)]
                if md and mh and 0.87 <= hy / mh <= 1.15:
                    yy, v = min(md, key=lambda r: abs(r[0] - y))
                    figs.append([v, f"Maddison Project 2023 ({mod.get('mname')}, today's borders, {yy})"])
            out.append([y] + compact(figs, y))
        # census and official figures on Wikidata
        wdp = []
        seen = set()
        for y0, qs in qs_by_year:
            for q in qs[:1]:
                for r in self.items.get(q, {}).get('P1082', []):
                    pit = r[4]
                    try:
                        v = float(r[0])
                    except (TypeError, ValueError):
                        continue
                    if pit is not None and a <= pit <= b and (q, pit) not in seen and v > 0:
                        seen.add((q, pit))
                        wdp.append([pit, int(v), r[6] or 'Wikidata', self.items.get(q, {}).get('n', q)])
        wdp.sort()
        if len(wdp) > 8:
            k = (len(wdp) - 1) / 7
            wdp = [wdp[round(i * k)] for i in range(8)]
        return out, wdp

    def modern_iso(self, name, s):
        """Today's country the state most resembles: its own item when that is a country of today, else the
        country under a point inside its largest shape (the population ratio test then decides)."""
        if s.get('q') in self.iso_of_q:
            return self.iso_of_q[s['q']]
        pt = self.label_pt.get(name)
        return self.modern_pts.lookup(pt[0], pt[1]) if pt else None

    # ------------------------------------------------------------------ one state
    def build(self, name, s):
        tlf = self.tl_index.get(name)
        rulers = read_json(os.path.join(DATA, 'timelines', tlf)).get('rulers', []) if tlf else []
        # the office holders filed under the regimes and earlier eras of this name (ROC 1912-1949 for China)
        extra_q = [r[2] for r in self.wd['regimes'].get(name, []) if r[2]] + [e['q'] for e in s.get('eras', [])] + self.offices_from.get(name, [])
        seen = {(r[0], r[1], r[3]) for r in rulers}
        for q in extra_q:
            for r in self.terms.get(q, {}).get('terms', []):
                if r[1] > s['last'] or (r[2] if r[2] is not None else r[1]) < s['first']:
                    continue
                if (r[0], r[1], r[3]) not in seen:
                    seen.add((r[0], r[1], r[3]))
                    rulers.append(r)
        rulers.sort(key=lambda r: (r[1], r[0]))
        maps = self.st['maps']
        spans = []
        for mi, *_ in s['maps']:
            a, b = maps[mi][0], maps[mi][1]
            if spans and a <= spans[-1][1] + 1:
                spans[-1][1] = max(spans[-1][1], b)
            else:
                spans.append([a, b])
        periods = []
        for a, b in spans:
            cur, start, facts = None, a, None
            for y in range(a, b + 1):
                qs, main = self.items_at(name, s, y)
                gov, gany, gsrc = self.gov(name, qs, y)
                off = [r[0] for r in self.religion(name, qs, y) if r[1] == 'official']
                party, holder = self.ruling(rulers, y, gov or gany, name)
                key = (main, tuple(gov), tuple(off), party)
                step = 100 if y < 1500 else 50 if y < 1800 else 25
                if cur is None:
                    cur, facts = key, (qs, gov, gany, gsrc, party, holder)
                    continue
                if key != cur or y - start >= step:
                    periods.append(self.period(name, s, start, y - 1, facts, rulers))
                    cur, start, facts = key, y, (qs, gov, gany, gsrc, party, holder)
            periods.append(self.period(name, s, start, b, facts, rulers))
        # merge one-year slices caused by a change of party or office in the middle of a year into the next
        merged = []
        for p in periods:
            if merged and p['to'] - p['from'] < 1 and merged[-1]['to'] + 1 == p['from'] and len(periods) > 3 and p.get('party') == merged[-1].get('party'):
                merged[-1]['to'] = p['to']
            else:
                merged.append(p)
        return {'name': name, 'q': s.get('q'), 'from': s['first'], 'to': s['last'], 'periods': merged}

    def period(self, name, s, a, b, facts, rulers):
        qs, gov, gany, gsrc, party, holder = facts
        mid = (a + b) // 2
        rel = self.religion(name, qs, mid)
        p = {'from': a, 'to': b}
        items = [[q, self.items.get(q, {}).get('n', q)] for q in qs[:2]]
        if items:
            p['items'] = items
        reg = [r for r in self.wd['regimes'].get(name, []) if r[2] and r[0] <= a <= r[1]]
        if reg:
            p['regime'] = [reg[0][3], reg[0][4]]
        if gov:
            p['gov'] = gov[:3]
            p['govSrc'] = gsrc
            if gsrc == 'c':
                e = next(e for e in self.cur_gov[name] if any(r[0] <= a <= r[1] for r in e['rows']))
                p['govCite'] = e['source']
        if gany:
            p['govAny'] = gany[:6]
        if rel:
            p['rel'] = rel[:6]
        if party:
            pp = self.wd['parties'].get(party, {})
            if holder[1] is None and holder[2] is None:     # curated party row
                p['party'] = [holder[0], party if str(party).startswith('Q') else None, None, holder[3], 'c']
            else:
                p['party'] = [pp.get('n', party), party, holder[0], holder[3]]
        parties = self.parties(qs, a, b)
        if parties:
            p['parties'] = parties
        # leaders in office during the slice, with their party in the middle of their time in it
        led = []
        for r in rulers:
            ra, rb = r[1], r[2] if r[2] is not None else r[1]
            if ra <= b and rb >= a and not BAD_TITLE.search(r[3]):
                pm = self.party_of(r[4], max(ra, a)) if len(r) > 4 and r[4] else []
                led.append([r[0], ra, r[2], r[3], self.wd['parties'].get(pm[0], {}).get('n') if pm else None])
        if led:
            p['leaders'] = led[:14]
        pop, wdp = self.population(name, s, a, b, [(a, qs)])
        if pop:
            p['pop'] = pop
        if wdp:
            p['popw'] = wdp
        mov = []
        for m in self.mov_by_state.get(name, []):
            if m['from'] <= b and m['to'] >= a and m['name'] not in [x[0] for x in mov]:
                mov.append([m['name'], m['from'], m['to'], m['text'], m['source'], 'c', m.get('verified')])
        seen = {m[0].lower() for m in mov}
        wm = []
        for q in qs:
            for mq, m in self.wd_mov_by_item.get(q, []):
                f, t = m['from'], m.get('to')
                if f <= b and (t if t is not None else f + 30) >= a and m['n'].lower() not in seen:
                    seen.add(m['n'].lower())
                    wm.append((m['sl'], [m['n'], f, t, m.get('d'), f'https://www.wikidata.org/wiki/{mq}', 'w', True]))
        wm.sort(key=lambda x: -x[0])
        mov += [x[1] for x in wm[:5]]
        if mov:
            p['mov'] = mov
        ds = [d for d in self.disc.get(name, []) if a <= d['y'] <= b]
        ds.sort(key=lambda d: (not d.get('cur') if 'cur' in d else d['src'].startswith('https://www.wikidata'), -d['sl']))
        if ds:
            p['disc'] = [[d['y'], d['l'], d['who'], d['k'], d['w'] or d['src'], d['note'], d['how'], d['v'], d['approx'], d['id']] for d in ds[:12]]
            if len(ds) > 12:
                p['discMore'] = len(ds) - 12
        p['glance'] = glance(name, p)
        return p


def fold(t):
    return ''.join(c for c in unicodedata.normalize('NFKD', t or '') if not unicodedata.combining(c)).lower()


def modern_index():
    from geo import PolyIndex
    feats = read_json(os.path.join(DATA, 'base', 'modern.json'))['features']
    return PolyIndex([(f['properties']['iso'], f['geometry']) for f in feats])


def label_points(st):
    """{name: (lon, lat)}: a point inside the state's largest shape on the last map that draws it."""
    from geo import decode_geom, polys_of
    clio = {}
    ci = read_json(os.path.join(DATA, 'clio', 'index.json'))
    for f in ci['files']:
        for sid, sh in read_json(os.path.join(DATA, 'clio', f)).items():
            clio[int(sid)] = (sh['a'], sh.get('l'))
    cs = {}
    ix = read_json(os.path.join(DATA, 'cshapes', 'index.json'))
    for c in ix['chunks']:
        for sid, sh in read_json(os.path.join(DATA, 'cshapes', c['f'])).items():
            ring = max((pl[0] for pl in polys_of(decode_geom(sh['g']))), key=len)
            xs, ys = [p_[0] for p_ in ring], [p_[1] for p_ in ring]
            cs[int(sid)] = (sh['a'], (sum(xs) / len(xs), sum(ys) / len(ys)))
    maps = st['maps']
    out = {}
    for name, s in st['states'].items():
        mi, sids = s['maps'][-1][0], s['maps'][-1][1]
        src = cs if maps[mi][2] == 'cshapes' else clio
        best = max((src[i] for i in sids if i in src), key=lambda t: t[0], default=None)
        if best and best[1]:
            out[name] = best[1]
    return out


def interp_series(ser, y):
    if not ser:
        return None
    if y <= ser[0][0]:
        return ser[0][1]
    for (y0, v0), (y1, v1) in zip(ser, ser[1:]):
        if y0 <= y <= y1:
            if v0 > 0 and v1 > 0:
                return v0 * (v1 / v0) ** ((y - y0) / (y1 - y0))
            return v0
    return ser[-1][1]


def compact(figs, y):
    """[value, low, high, [sources]] rounded: 2 significant figures before 1800, 3 after."""
    n = 2 if y < 1800 else 3
    vals = [f[0] for f in figs]
    lo, hi = min(vals), max(vals)
    mid = sig(math.sqrt(lo * hi) if lo > 0 else hi, n)
    return [mid, sig(lo, n), sig(hi, n), [f[1] for f in figs]]


def fmt_people(v):
    if v >= 1e9:
        return f'{v / 1e9:.2g} billion'.replace('.0 ', ' ')
    if v >= 1e6:
        return f'{v / 1e6:.3g} million'
    if v >= 1e4:
        return f'{round(v, -3):,.0f}'
    return f'{round(v, -2):,.0f}'


def yr(y):
    return f'{-y} BC' if y < 0 else str(y)


def glance(name, p):
    """One paragraph assembled from the slice's facts (no free text: every clause is a field below)."""
    parts = []
    span = f'{yr(p["from"])}' if p['from'] == p['to'] else f'{yr(p["from"])} to {yr(p["to"])}'
    head = f'{name}, {span}'
    if p.get('gov'):
        head += f': {", ".join(p["gov"][:2])}'
    parts.append(head + '.')
    if p.get('pop'):
        y, mid, lo, hi, src = p['pop'][0]
        if lo != hi and hi > lo * 1.15:
            parts.append(f'About {fmt_people(lo)} to {fmt_people(hi)} people in {yr(y)} (estimates differ).')
        else:
            parts.append(f'About {fmt_people(mid)} people in {yr(y)} ({"model estimate" if len(src) == 1 else "estimate"}).')
    off = [r[0] for r in p.get('rel', []) if r[1] == 'official']
    rec = [r[0] for r in p.get('rel', []) if r[1] != 'official']
    if off:
        parts.append(f'Official religion: {", ".join(off)}.')
    elif rec:
        parts.append(f'Religion recorded on Wikidata: {", ".join(rec[:2])}.')
    if p.get('party'):
        parts.append(f'Ruling party: {p["party"][0]}' + (f' ({p["party"][2]})' if p['party'][2] else '') + '.')
    led = [l for l in p.get('leaders', [])]
    if led:
        names = []
        for l in led:
            if l[0] not in names:
                names.append(l[0])
        parts.append(f'Leaders: {", ".join(names[:3])}{" and others" if len(names) > 3 else ""}.')
    if p.get('mov'):
        parts.append(f'Movements: {", ".join(m[0] for m in p["mov"][:3])}.')
    if p.get('disc'):
        parts.append(f'Discoveries and inventions here: {", ".join(d[1] for d in p["disc"][:3])}.')
    return ' '.join(parts)


def main():
    c = Ctx()
    os.makedirs(DEST, exist_ok=True)
    for f in os.listdir(DEST):
        if f not in ('discoveries.json',):
            os.remove(os.path.join(DEST, f))
    index, total = {}, 0
    cov = {}
    for name, s in sorted(c.st['states'].items()):
        doc = c.build(name, s)
        f = slug(name) + '.json'
        total += write_json(os.path.join(DEST, f), doc)
        index[name] = f
        for p in doc['periods']:
            era = era_of(p['from'])
            e = cov.setdefault(era, {'slices': 0, 'years': 0})
            e['slices'] += 1
            yrs = p['to'] - p['from'] + 1
            e['years'] += yrs
            for k in ('pop', 'popw', 'gov', 'rel', 'party', 'parties', 'leaders', 'mov', 'disc'):
                if p.get(k):
                    e[k] = e.get(k, 0) + yrs
            if any(r[1] == 'official' for r in p.get('rel', [])):
                e['relOfficial'] = e.get('relOfficial', 0) + yrs
    # empires (a power drawn as one colour with its parts): the core state's items and leaders, the whole
    # power's population, its parts' discoveries
    emp = read_json(os.path.join(DATA, 'empires.json'))['empires']
    for eid, e in sorted(emp.items()):
        core = [n for n in e.get('core', []) if n in c.st['states']]
        rows = c.st['powers'].get(eid)
        if not core or not rows:
            continue
        key = 'e:' + eid
        base = c.st['states'][core[0]]
        s = {k: base[k] for k in ('q', 'eras', 'from', 'to', 'mod') if k in base}
        s['maps'] = [[mi, [], eid, None] for mi, names in rows]
        maps = c.st['maps']
        s['first'], s['last'] = min(maps[mi][0] for mi, _ in rows), max(maps[mi][1] for mi, _ in rows)
        label = e['n']
        for d_ in (c.cur_gov, c.cur_rel, c.cur_party, c.mov_by_state, c.cur_pop):
            merged = [x for n in core for x in d_.get(n, [])]
            if merged:
                d_[label] = merged
        if core[0] in c.wd['regimes']:
            c.wd['regimes'][label] = c.wd['regimes'][core[0]]
        if core[0] in c.tl_index:
            c.tl_index[label] = c.tl_index[core[0]]
        c.pop['states'][label] = c.pop['powers'].get(eid, [])
        c.disc[label] = c.disc_pw.get(eid, [])
        doc = c.build(label, s)
        doc['empire'] = eid
        doc['core'] = core
        f = 'e-' + slug(eid) + '.json'
        total += write_json(os.path.join(DEST, f), doc)
        index[key] = f
    write_json(os.path.join(DEST, 'index.json'), index)
    for doc, fn in ((c.party_doc, 'parties.json'),):
        write_json(os.path.join(TOOLS, 'curated', 'context', fn), doc, pretty=True)
    for era, e in cov.items():
        for k in list(e):
            if k not in ('slices', 'years'):
                e[k + '%'] = round(100 * e[k] / e['years'], 1)
    write_json(os.path.join(OUT, 'coverage.json'), cov, pretty=True)
    log(f'context: {len(index)} states, {total // 1024} KB')
    for era in sorted(cov, key=lambda e: ERAS.index(e)):
        e = cov[era]
        log(f"  {era:>14}: {e['slices']:5} slices; " + ', '.join(f"{k} {e.get(k + '%', 0)}%" for k in ('pop', 'gov', 'rel', 'relOfficial', 'party', 'parties', 'leaders', 'mov', 'disc')))


ERAS = ['before 500 BC', '500 BC-499', '500-999', '1000-1499', '1500-1799', '1800-1899', '1900-1945', '1946-2019']


def era_of(y):
    return ('before 500 BC' if y < -500 else '500 BC-499' if y < 500 else '500-999' if y < 1000 else '1000-1499' if y < 1500
            else '1500-1799' if y < 1800 else '1800-1899' if y < 1900 else '1900-1945' if y < 1946 else '1946-2019')


if __name__ == '__main__':
    main()
