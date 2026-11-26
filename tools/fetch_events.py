"""Step 1c: collect historical events from Wikidata (CC0) into tools/cache/events_raw.json.

Stages (every query is cached, so a rerun resumes where it stopped):
  A. candidates: items with a point in time (P585) or start time (P580) in each time slice, above a
     sitelink threshold that rises for recent, busier centuries. Slices that fail are split in half.
  B. extra candidates: states founded/dissolved (P571/P576), monarchs taking office (P39 + P580),
     inventions and discoveries (P575).
  C. classify every candidate by its "instance of" classes (walking up "subclass of").
  D. details for kept items: label, description, dates with precision and calendar, coordinates,
     country, location, participants, part of, English Wikipedia title.
"""
import json
import os
import sys
from common import sparql, qid, log, CACHE, write_json

# Historical years (no year 0; -44 = 44 BC). Wikidata's RDF uses astronomical years (44 BC = -0043).
SLICES = []


def plan_slices():
    out = []
    def span(a, b, step, thr):
        y = a
        while y < b:
            out.append((y, min(b, y + step), thr))
            y += step
    span(-10000, -3000, 1000, 3)
    span(-3000, -500, 250, 3)
    span(-500, 500, 100, 3)
    span(500, 1500, 50, 3)
    span(1500, 1700, 20, 3)
    span(1700, 1800, 10, 3)
    span(1800, 1900, 5, 4)
    span(1900, 1950, 2, 6)
    span(1950, 2026, 2, 8)
    return out


def astro(y):
    """historical year -> astronomical year used in Wikidata RDF"""
    return y + 1 if y < 0 else y


def xsd(y):
    a = astro(y)
    return ('-%04d' % -a if a < 0 else '%04d' % a) + '-01-01T00:00:00Z'


def candidates_slice(a, b, thr):
    q = f'''SELECT ?item (MAX(?sl) AS ?s) (GROUP_CONCAT(DISTINCT STRAFTER(STR(?c), "entity/")) AS ?cls) WHERE {{
  {{ ?item wdt:P585 ?d }} UNION {{ ?item wdt:P580 ?d }}
  FILTER(?d >= "{xsd(a)}"^^xsd:dateTime && ?d < "{xsd(b)}"^^xsd:dateTime)
  ?item wikibase:sitelinks ?sl . FILTER(?sl >= {thr})
  OPTIONAL {{ ?item wdt:P31 ?c }}
}} GROUP BY ?item'''
    try:
        return sparql(q)
    except Exception as e:
        if b - a <= 1:
            log(f'  slice {a}..{b} failed: {e}; skipped')
            return []
        m = (a + b) // 2
        if m == 0:
            m = 1 if a < 0 else m
        log(f'  slice {a}..{b} failed ({e}); splitting at {m}')
        return candidates_slice(a, m, thr) + candidates_slice(m, b, thr)


POLITY_CLASSES = ['Q3024240', 'Q6256', 'Q3624078', 'Q48349', 'Q417175', 'Q133156', 'Q1250464',
                  'Q28171280', 'Q7275', 'Q12759805', 'Q154547', 'Q1371288', 'Q99541706', 'Q50068795',
                  'Q2577883', 'Q1520223']


def polity_changes():
    vals = ' '.join('wd:' + c for c in sorted(set(POLITY_CLASSES)))
    q = f'''SELECT ?item ?sl ?start ?end WHERE {{
  VALUES ?cls {{ {vals} }}
  ?item wdt:P31 ?cls . ?item wikibase:sitelinks ?sl . FILTER(?sl >= 8)
  OPTIONAL {{ ?item wdt:P571 ?start }} OPTIONAL {{ ?item wdt:P576 ?end }}
  FILTER(BOUND(?start) || BOUND(?end))
}}'''
    return sparql(q)


def monarchs():
    q = '''SELECT ?person ?pos ?start ?prec ?cal ?sl WHERE {
  ?pos wdt:P279* wd:Q116 . ?st ps:P39 ?pos . ?person p:P39 ?st .
  ?st pqv:P580 [ wikibase:timeValue ?start; wikibase:timePrecision ?prec; wikibase:timeCalendarModel ?cal ] .
  ?person wikibase:sitelinks ?sl . FILTER(?sl >= 40)
}'''
    return sparql(q)


def discoveries():
    q = '''SELECT ?item (MAX(?sl) AS ?s) (GROUP_CONCAT(DISTINCT STRAFTER(STR(?c), "entity/")) AS ?cls) WHERE {
  ?item wdt:P575 ?d . ?item wikibase:sitelinks ?sl . FILTER(?sl >= 25)
  OPTIONAL { ?item wdt:P31 ?c }
} GROUP BY ?item'''
    return sparql(q)


# ---- classification -------------------------------------------------------------------------
# type -> root classes (anything that is a subclass* of a root gets that type). Order = priority.
TYPE_ROOTS = [
    ('battle', ['Q178561', 'Q188055', 'Q1261499', 'Q645883', 'Q467011', 'Q831663', 'Q2001676', 'Q4688003',
                'Q1361229', 'Q2380335', 'Q844947', 'Q2210774']),
    ('war', ['Q198', 'Q8465', 'Q350604', 'Q103495', 'Q1006311', 'Q766875', 'Q188686', 'Q334516', 'Q1348385']),
    ('revolt', ['Q10931', 'Q124734', 'Q45382', 'Q124757', 'Q273120', 'Q175331', 'Q1323212', 'Q6107280',
                'Q511866', 'Q49776', 'Q49775', 'Q686984', 'Q49773']),
    ('violence', ['Q3199915', 'Q3882219', 'Q41397', 'Q2223653', 'Q750215', 'Q1371150', 'Q177716',
                  'Q154278', 'Q851824']),
    ('treaty', ['Q131569', 'Q625298', 'Q864737', 'Q107706', 'Q208383', 'Q3769366']),
    ('state', ['Q1464916', 'Q37055', 'Q194465', 'Q687031', 'Q1219394', 'Q260703', 'Q815962']),
    ('ruler', ['Q209715', 'Q207549', 'Q1671499', 'Q1417098', 'Q1052001']),
    ('epidemic', ['Q44512', 'Q12184', 'Q3241045', 'Q1516910', 'Q133780', 'Q2723958']),
    ('disaster', ['Q3839081', 'Q8065', 'Q7944', 'Q7692360', 'Q8068', 'Q168247', 'Q168983', 'Q8092',
                  'Q906512', 'Q744913', 'Q8070', 'Q167903', 'Q43059', 'Q81054', 'Q8081', 'Q215864',
                  'Q1620824', 'Q179057', 'Q1078765']),
    ('discovery', ['Q2401485', 'Q2133344', 'Q12772819', 'Q12579633', 'Q6502154', 'Q752783']),
    ('religion', ['Q51645', 'Q111161', 'Q41521']),
    ('politics', ['Q40231', 'Q43109', 'Q2495862', 'Q367293', 'Q4358176', 'Q7755', 'Q820655', 'Q1572600',
                  'Q3002772', 'Q290178', 'Q114380', 'Q1020018', 'Q2720142', 'Q2761147', 'Q7748']),
]
GENERIC_ROOTS = ['Q1190554', 'Q1656682', 'Q13418847']
# "time of discovery or invention" is also used for species, asteroids and compounds; only these count
DISCOVERY_OK = ['Q12579633', 'Q11019', 'Q39546', 'Q1183543', 'Q17737', 'Q11344', 'Q634', 'Q134808', 'Q12772819']
EXCLUDE_ROOTS = ['Q13406554', 'Q16510064', 'Q27020041', 'Q1079023', 'Q577', 'Q3186692', 'Q14795564',
                 'Q18340514', 'Q39911', 'Q578', 'Q36507', 'Q132241', 'Q4504495', 'Q2020153', 'Q58863414',
                 'Q13406463', 'Q5', 'Q4167836', 'Q11424', 'Q7725634', 'Q482994', 'Q134556', 'Q7889',
                 'Q6999', 'Q3887', 'Q1931185', 'Q5398426', 'Q7725310', 'Q17537576', 'Q4830453',
                 'Q43229', 'Q15275719', 'Q47258130', 'Q2990963', 'Q11483816', 'Q500834',
                 'Q46970', 'Q3863', 'Q1366722', 'Q1569167', 'Q868557', 'Q15416', 'Q1983062', 'Q21191270',
                 'Q16970', 'Q1002697', 'Q19832486', 'Q1752939', 'Q186117', 'Q60797',
                 'Q131436', 'Q2085381', 'Q11410', 'Q18608583', 'Q24856',
                 'Q182832', 'Q2668072', 'Q1344', 'Q2743', 'Q175173', 'Q26540', 'Q109551565']


def class_ancestors(classes):
    """{class: set(roots it falls under)} for every root in TYPE_ROOTS/GENERIC/EXCLUDE."""
    roots = sorted({r for _, rs in TYPE_ROOTS for r in rs} | set(GENERIC_ROOTS) | set(EXCLUDE_ROOTS) | set(DISCOVERY_OK))
    rootvals = ' '.join('wd:' + r for r in roots)
    out = {c: set() for c in classes}
    classes = sorted(classes)
    def run(batch):
        vals = ' '.join('wd:' + c for c in batch)
        q = f'''SELECT ?c ?r WHERE {{ VALUES ?c {{ {vals} }} VALUES ?r {{ {rootvals} }} ?c wdt:P279* ?r . }}'''
        try:
            for b in sparql(q):
                out.setdefault(qid(b['c']), set()).add(qid(b['r']))
        except Exception as e:
            if len(batch) <= 5:
                log(f'  class batch failed, skipped: {e}')
                return
            half = len(batch) // 2
            run(batch[:half])
            run(batch[half:])

    for i in range(0, len(classes), 200):
        run(classes[i:i + 200])
        log(f'  classes {min(i + 200, len(classes))}/{len(classes)}')
    return out


def classify(cls_list, anc):
    roots = set()
    for c in cls_list:
        roots |= anc.get(c, set())
        roots.add(c)
    for t, rs in TYPE_ROOTS:
        if roots & set(rs):
            return t
    if roots & set(EXCLUDE_ROOTS):
        return None
    if roots & set(GENERIC_ROOTS):
        return 'other'
    return None


# ---- details ----------------------------------------------------------------------------------
def details(qids):
    out = {}
    qids = sorted(qids, key=lambda q: int(q[1:]))
    for i in range(0, len(qids), 120):
        batch = qids[i:i + 120]
        vals = ' '.join('wd:' + q for q in batch)
        q = f'''SELECT ?item ?label ?desc ?enwiki ?coord
  (GROUP_CONCAT(DISTINCT CONCAT(?dp, "|", STR(?dv), "|", STR(?dprec), "|", STRAFTER(STR(?dcal), "entity/")); SEPARATOR="~") AS ?dates)
  (GROUP_CONCAT(DISTINCT CONCAT(STRAFTER(STR(?country), "entity/"), "|", ?countryL); SEPARATOR="~") AS ?countries)
  (GROUP_CONCAT(DISTINCT CONCAT(STRAFTER(STR(?loc), "entity/"), "|", ?locL, "|", STR(?locC)); SEPARATOR="~") AS ?locs)
  (GROUP_CONCAT(DISTINCT CONCAT(STRAFTER(STR(?part), "entity/"), "|", ?partL); SEPARATOR="~") AS ?parts)
  (GROUP_CONCAT(DISTINCT CONCAT(STRAFTER(STR(?pof), "entity/"), "|", ?pofL); SEPARATOR="~") AS ?partof)
WHERE {{
  VALUES ?item {{ {vals} }}
  OPTIONAL {{ ?item rdfs:label ?label FILTER(LANG(?label) = "en") }}
  OPTIONAL {{ ?item schema:description ?desc FILTER(LANG(?desc) = "en") }}
  OPTIONAL {{ ?enwikiUrl schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?enwiki }}
  OPTIONAL {{ ?item wdt:P625 ?coord }}
  OPTIONAL {{ VALUES ?dp {{ "P585" "P580" "P582" }} BIND(IRI(CONCAT("http://www.wikidata.org/prop/", ?dp)) AS ?pp)
             BIND(IRI(CONCAT("http://www.wikidata.org/prop/statement/value/", ?dp)) AS ?pv)
             ?item ?pp ?dst . ?dst ?pv ?dnode . ?dnode wikibase:timeValue ?dv; wikibase:timePrecision ?dprec; wikibase:timeCalendarModel ?dcal . }}
  OPTIONAL {{ ?item wdt:P17 ?country . ?country rdfs:label ?countryL FILTER(LANG(?countryL) = "en") }}
  OPTIONAL {{ ?item wdt:P276 ?loc . ?loc rdfs:label ?locL FILTER(LANG(?locL) = "en") OPTIONAL {{ ?loc wdt:P625 ?locC }} }}
  OPTIONAL {{ ?item wdt:P710 ?part . ?part rdfs:label ?partL FILTER(LANG(?partL) = "en") }}
  OPTIONAL {{ ?item wdt:P361 ?pof . ?pof rdfs:label ?pofL FILTER(LANG(?pofL) = "en") }}
}} GROUP BY ?item ?label ?desc ?enwiki ?coord'''
        try:
            rows = sparql(q)
        except Exception as e:
            log(f'  details batch {i} failed ({e}); trying smaller batches')
            rows = []
            for j in range(0, len(batch), 20):
                sub = ' '.join('wd:' + x for x in batch[j:j + 20])
                try:
                    rows += sparql(q.replace(vals, sub))
                except Exception as e2:
                    log(f'    sub-batch failed: {e2}')
        for r in rows:
            k = qid(r['item'])
            if k in out:  # several coords: keep the first
                continue
            out[k] = r
        log(f'  details {i + len(batch)}/{len(qids)}')
    return out


def main():
    os.makedirs(CACHE, exist_ok=True)
    cands = {}  # qid -> {sl, cls}
    for a, b, thr in plan_slices():
        rows = candidates_slice(a, b, thr)
        for r in rows:
            k = qid(r['item'])
            cands[k] = {'sl': int(r['s']), 'cls': r.get('cls', '').split()}
        log(f'slice {a}..{b} (sl>={thr}): {len(rows)} -> total {len(cands)}')

    disc = discoveries()
    for r in disc:
        k = qid(r['item'])
        c = cands.setdefault(k, {'sl': int(r['s']), 'cls': r.get('cls', '').split()})
        c['discovery'] = True
    log(f'discoveries: {len(disc)}')

    pol = polity_changes()
    log(f'polity founding/dissolution rows: {len(pol)}')
    mon = monarchs()
    log(f'monarch accession rows: {len(mon)}')

    all_cls = {c for v in cands.values() for c in v['cls']}
    anc = class_ancestors(all_cls)
    kept = {}
    for k, v in cands.items():
        t = classify(v['cls'], anc)
        if t is None and v.get('discovery'):
            roots = set().union(*[anc.get(c, set()) | {c} for c in v['cls']]) if v['cls'] else set()
            if roots & set(DISCOVERY_OK):
                t = 'discovery'
        if t:
            kept[k] = {'sl': v['sl'], 'type': t, 'cls': v['cls'], 'discovery': v.get('discovery', False)}
    log(f'kept {len(kept)} of {len(cands)} candidates')

    # polity subjects and monarchs need labels/coords too
    pol_items = {qid(r['item']) for r in pol}
    mon_people = {qid(r['person']) for r in mon}
    mon_pos = {qid(r['pos']) for r in mon}
    det = details(set(kept) | pol_items | mon_people | mon_pos)

    raw = {'kept': kept, 'details': det, 'polity_changes': pol, 'monarchs': mon}
    with open(os.path.join(CACHE, 'events_raw.json'), 'w') as f:
        json.dump(raw, f)
    log('wrote events_raw.json')


if __name__ == '__main__':
    main()
