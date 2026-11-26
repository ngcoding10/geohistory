"""Step 1g: the "famous items" pass -> tools/cache/famous_raw.json

The first passes only looked at "point in time" and "start time", and only kept items whose class sat under
a list of event classes. That lost well-known things: Apollo 11 (dated by its launch), Magna Carta (dated by
its inception), the Prague Spring (a "historical period"), and rulers whose office is not filed under
"monarch" on Wikidata (Charlemagne as "king of Franks", shoguns, party general secretaries).

  A. items on 40+ Wikipedia editions dated by inception (P571), publication (P577), launch (P619),
     landing (P620), first flight (P606), opening (P1619), first performance (P1191) or discovery (P575),
     kept when their class is on a whitelist (documents, laws, treaties, spaceflights, aircraft,
     international organisations, political parties, monuments, inventions, expeditions...);
  B. dated items from the first pass that were dropped only because of their class: historical periods,
     archaeological cultures, Olympic Games, world's fairs (20+ editions, or 3+ for cultures);
  C. rulers: every dated "position held" (P39) or "noble title" (P97) statement of people on 40+ editions,
     kept when the office is a ruling one (class or name), whatever its jurisdiction;
  D. English "also known as" names of well-known events, so "Opium War" or "Zulu War" find the event.
"""
import json
import os
import re

from common import sparql, qid, log, CACHE
from fetch_events import details, xsd, plan_slices, candidates_slice

THR = 40
DATE_PROPS = ['P571', 'P577', 'P619', 'P620', 'P606', 'P1619', 'P1191', 'P575']
SPANS = ([(-10000, -500), (-500, 500), (500, 1000), (1000, 1300), (1300, 1500), (1500, 1600), (1600, 1700),
          (1700, 1750), (1750, 1800)] + [(y, y + 10) for y in range(1800, 2030, 10)])

# class root -> (event type, label pattern, minimum sitelinks). First match wins.
KEEP = [
    ('Q5916', 'discovery', '{}', 40),            # spaceflight
    ('Q2133344', 'discovery', '{}', 40),         # space mission
    ('Q40218', 'discovery', '{} launched', 40),  # spacecraft
    ('Q26529', 'discovery', '{} launched', 40),  # space probe
    ('Q1297322', 'discovery', '{} launched', 40),  # satellite
    ('Q25956', 'discovery', '{} launched', 40),  # space station
    ('Q2401485', 'discovery', '{}', 40),         # expedition
    ('Q131569', 'treaty', '{}', 40),             # treaty
    ('Q93288', 'treaty', '{}', 40),              # contract (charters, concordats)
    ('Q7755', 'politics', '{}', 40),             # constitution
    ('Q820655', 'politics', '{}', 40),           # legislative act
    ('Q1464916', 'state', '{}', 40),             # declaration of independence
    ('Q3150005', 'politics', '{}', 40),          # legal instrument
    ('Q727002', 'politics', '{}', 40),           # charter
    ('Q189867', 'religion', '{}', 40),           # papal bull
    ('Q46337', 'politics', '{}', 40),            # manifesto
    ('Q1284645', 'politics', '{}', 40),          # edict
    ('Q752783', 'discovery', '{}', 40),          # human spaceflight
    ('Q245065', 'politics', '{} founded', 40),   # intergovernmental organisation
    ('Q484652', 'politics', '{} founded', 40),   # international organisation
    ('Q1127126', 'politics', '{} founded', 40),  # military alliance
    ('Q7278', 'politics', '{} founded', 60),     # political party
    ('Q7210356', 'politics', '{} founded', 60),  # political organisation
    ('Q9174', 'religion', '{} founded', 60),     # religion
    ('Q879146', 'religion', '{} founded', 60),   # christian denomination
    ('Q4830453', 'economy', '{} founded', 90),   # business (only the very best known: East India companies...)
    ('Q11436', 'discovery', 'First flight of the {}', 40),   # aircraft
    ('Q15056993', 'discovery', 'First flight of the {}', 40),  # aircraft family
    ('Q570116', 'founding', '{} built', 70),     # tourist attraction
    ('Q4989906', 'founding', '{} built', 60),    # monument
    ('Q839954', 'founding', '{} (archaeological site)', 40),
    ('Q9259', 'founding', '{} built', 60),       # World Heritage Site
    ('Q811979', 'founding', '{} built', 80),     # architectural structure
    ('Q12772819', 'discovery', '{}', 40),        # discovery
    ('Q11019', 'discovery', '{} invented', 60),  # machine
    ('Q39546', 'discovery', '{} invented', 60),  # tool
    ('Q1183543', 'discovery', '{} invented', 60),  # device
    ('Q17737', 'discovery', '{} proposed', 60),  # theory
]
# never: people, places that already have founding events, creative works, sport, taxa, chemistry, astronomy
# checked in a second pass (kept separate so the first pass's cached queries stay valid)
DROP2 = ['Q618779', 'Q4504495', 'Q2485448', 'Q11422536', 'Q14296', 'Q1445650', 'Q2558684', 'Q15275719']
DROP = ['Q5', 'Q486972', 'Q56061', 'Q6256', 'Q3024240', 'Q7725634', 'Q11424', 'Q482994', 'Q7889', 'Q5398426',
        'Q16521', 'Q11344', 'Q79529', 'Q6999', 'Q18340514', 'Q27020041', 'Q2188189', 'Q7366', 'Q3305213',
        'Q838948', 'Q215380', 'Q476028', 'Q12973014', 'Q13406463', 'Q4167836', 'Q34770', 'Q9143', 'Q35127',
        'Q7397', 'Q3918', 'Q1002697', 'Q11032', 'Q41298', 'Q15416', 'Q1616075', 'Q18127']
# classes dropped by the first pass that are history all the same (dated by start/point in time)
PERIODS = [('Q11514315', 'other', 20), ('Q465299', 'other', 3), ('Q15401633', 'other', 3), ('Q5389', 'other', 40),
           ('Q159821', 'other', 40), ('Q82414', 'other', 40), ('Q172754', 'other', 30), ('Q6428674', 'other', 30),
           ('Q8432', 'other', 20), ('Q28171280', 'other', 20), ('Q49773', 'revolt', 20),
           ('Q2198855', 'other', 30), ('Q273120', 'revolt', 20), ('Q189760', 'politics', 30),
           ('Q546113', 'politics', 30)]

RULER_ROOTS = ['Q116', 'Q48352', 'Q2285706', 'Q19546', 'Q65997', 'Q39018', 'Q12097', 'Q2304859', 'Q1097498',
               'Q14212', 'Q16511993', 'Q184299', 'Q131767', 'Q181888', 'Q187878', 'Q43292', 'Q44356', 'Q236885']
RULER_NAME = re.compile(
    r'^(king|queen regnant|queen|emperor|empress regnant|empress|tsar|tsarina|sultan|caliph|khan|khagan|great khan|shogun|'
    r'pharaoh|shah|shahanshah|emir|amir|grand prince|grand duke|doge|pope|negus|mansa|sapa inca|huey tlatoani|tlatoani|'
    r'president of|prime minister of|chancellor of|first consul|lord protector|dictator|roman dictator|roman emperor|'
    r'byzantine emperor|holy roman emperor|general secretary of the (central committee of the )?[a-z ]*communist party|'
    r'first secretary of the (central committee of the )?[a-z ]*communist party|chairman of the chinese communist party|'
    r'paramount leader|supreme leader|f[uü]hrer|duce|head of state|head of government|maharaja|peshwa|mughal emperor|'
    r'ottoman sultan|sultan of the ottoman empire|basileus|archon|stadtholder|taoiseach|kaiser|imam|bey|dey|khedive|'
    r'chairman of the council of (ministers|people.s commissars))( |$)', re.I)
NOT_RULER = re.compile(r'(vice[- ]|deputy|candidate|elect\b|consort|member of|(?<!prime )(?<!first )minister of|ministers? for|^mayor|^governor(?!.general)|lord lieutenant|lieutenant governor|secretary of state|'
                       r'pretender|titular|leader of the opposition|leader of the house|president of the (senate|chamber|'
                       r'assembly|parliament|council of the|court|board|university|royal|european|general assembly|bundes|'
                       r'national (assembly|council)|supreme court|regional|generalitat|province|government of [a-z]+ia$)|'
                       r'club|company|society|association|federation|committee|academy)', re.I)
PARTY_LEADER = re.compile(r'^(general|first) secretary of the (central committee of the )?[a-z ]*communist party|^chairman of the chinese communist party', re.I)


def by_prop(prop, a, b):
    q = f'''SELECT ?item (MAX(?sl) AS ?s) (GROUP_CONCAT(DISTINCT STRAFTER(STR(?c), "entity/")) AS ?cls) WHERE {{
  ?item wdt:{prop} ?d . FILTER(?d >= "{xsd(a)}"^^xsd:dateTime && ?d < "{xsd(b)}"^^xsd:dateTime)
  ?item wikibase:sitelinks ?sl . FILTER(?sl >= {THR}) OPTIONAL {{ ?item wdt:P31 ?c }} }} GROUP BY ?item'''
    try:
        return sparql(q)
    except Exception as e:
        if b - a <= 1:
            log(f'  {prop} {a}..{b} failed: {e}')
            return []
        m = (a + b) // 2 or 1
        return by_prop(prop, a, m) + by_prop(prop, m, b)


def ancestors(classes, roots):
    out = {}
    classes = sorted(classes)
    rv = ' '.join('wd:' + r for r in roots if not r.endswith('x'))

    def run(batch):
        v = ' '.join('wd:' + c for c in batch)
        try:
            for b in sparql(f'SELECT ?c ?r WHERE {{ VALUES ?c {{ {v} }} VALUES ?r {{ {rv} }} ?c wdt:P279* ?r . }}'):
                out.setdefault(qid(b['c']), set()).add(qid(b['r']))
        except Exception as e:
            if len(batch) <= 5:
                log(f'  class batch failed: {e}')
                return
            run(batch[:len(batch) // 2])
            run(batch[len(batch) // 2:])
    for i in range(0, len(classes), 150):
        run(classes[i:i + 150])
    return out


def extra_dates(ids, props):
    out = {}
    ids = sorted(ids, key=lambda q: int(q[1:]))
    pv = ' '.join(f'"{p}"' for p in props)
    for i in range(0, len(ids), 150):
        v = ' '.join('wd:' + x for x in ids[i:i + 150])
        q = f'''SELECT ?x ?prop ?t ?prec ?cal WHERE {{ VALUES ?x {{ {v} }} VALUES ?prop {{ {pv} }}
  BIND(IRI(CONCAT("http://www.wikidata.org/prop/", ?prop)) AS ?pp)
  BIND(IRI(CONCAT("http://www.wikidata.org/prop/statement/value/", ?prop)) AS ?pv)
  ?x ?pp ?st . ?st ?pv [ wikibase:timeValue ?t; wikibase:timePrecision ?prec; wikibase:timeCalendarModel ?cal ] .
  ?st wikibase:rank ?rank . FILTER(?rank != wikibase:DeprecatedRank) }}'''
        try:
            for r in sparql(q):
                out.setdefault(qid(r['x']), []).append([r['prop'], r['t'], r['prec'], qid(r['cal'])])
        except Exception as e:
            log(f'  dates batch {i} failed: {e}')
    return out


def famous_items(have):
    cands = {}
    for prop in DATE_PROPS:
        for a, b in SPANS:
            for r in by_prop(prop, a, b):
                c = cands.setdefault(qid(r['item']), {'sl': int(r['s']), 'cls': r.get('cls', '').split(), 'props': []})
                if prop not in c['props']:
                    c['props'].append(prop)
        log(f'{prop}: {len(cands)} candidates so far')
    roots = [k for k, *_ in KEEP] + ['Q49848'] + DROP
    anc = ancestors({c for v in cands.values() for c in v['cls']}, roots)
    anc2 = ancestors({c for v in cands.values() for c in v['cls']}, DROP2)
    out = {}
    for k, v in cands.items():
        if k in have:
            continue
        rs = set()
        for c in v['cls']:
            rs |= anc.get(c, set()) | {c}
        if rs & set(DROP):
            continue
        if any(anc2.get(c) for c in v['cls']) or set(v['cls']) & set(DROP2):
            continue
        for root, typ, pat, thr in KEEP:
            if root in rs and v['sl'] >= thr:
                out[k] = {'type': typ, 'pat': pat, 'sl': v['sl'], 'props': v['props']}
                break
    log(f'famous items by other dates: {len(out)} new of {len(cands)} candidates')
    return out


def dropped_periods(have):
    cands = {}
    for a, b, thr in plan_slices():
        for r in candidates_slice(a, b, thr):
            k = qid(r['item'])
            if k not in have:
                cands[k] = {'sl': int(r['s']), 'cls': r.get('cls', '').split()}
    anc = ancestors({c for v in cands.values() for c in v['cls']}, [k for k, *_ in PERIODS] + DROP)
    out = {}
    for k, v in cands.items():
        rs = set()
        for c in v['cls']:
            rs |= anc.get(c, set()) | {c}
        if rs & set(DROP):
            continue
        for root, typ, thr in PERIODS:
            if root in rs and v['sl'] >= thr:
                out[k] = {'type': typ, 'pat': '{}', 'sl': v['sl'], 'props': ['P580']}
                break
    log(f'periods, cultures and other dropped classes: {len(out)}')
    return out


def famous_rulers(people):
    """All dated office/title statements of well-known people; the office filter runs afterwards."""
    rows = []
    people = sorted(people, key=lambda q: int(q[1:]))

    def run(batch, prop):
        v = ' '.join('wd:' + p for p in batch)
        q = f'''SELECT ?person ?pos ?s ?sp ?sc ?e ?sl WHERE {{ VALUES ?person {{ {v} }}
  ?person p:{prop} ?st . ?st ps:{prop} ?pos .
  ?st pqv:P580 [ wikibase:timeValue ?s; wikibase:timePrecision ?sp; wikibase:timeCalendarModel ?sc ] .
  OPTIONAL {{ ?st pq:P582 ?e }} ?person wikibase:sitelinks ?sl . }}'''
        try:
            rs = sparql(q)
        except Exception as ex:
            if len(batch) <= 10:
                log(f'  rulers batch failed: {ex}')
                return
            run(batch[:len(batch) // 2], prop)
            run(batch[len(batch) // 2:], prop)
            return
        for r in rs:
            rows.append({'p': qid(r['person']), 'pos': qid(r['pos']), 's': r['s'], 'sp': int(r['sp']), 'sc': qid(r['sc']),
                         'e': r.get('e'), 'sl': int(r['sl']), 'k': prop})
    for i in range(0, len(people), 60):
        for prop in ('P39', 'P97'):
            run(people[i:i + 60], prop)
        if i % 3000 == 0:
            log(f'  ruler statements {i}/{len(people)}: {len(rows)}')
    positions = sorted({r['pos'] for r in rows if r['pos']})
    anc = ancestors(positions, RULER_ROOTS)
    labels = {}
    need = sorted(set(positions) | {r['p'] for r in rows})
    def lab_run(batch):
        v = ' '.join('wd:' + x for x in batch)
        try:
            # Wikidata now stores many names once, as a language-neutral "mul" label, with no English label
            for r in sparql(f'''SELECT ?x ?l ?m ?w ?j WHERE {{ VALUES ?x {{ {v} }}
  OPTIONAL {{ ?x rdfs:label ?l FILTER(LANG(?l) = "en") }} OPTIONAL {{ ?x rdfs:label ?m FILTER(LANG(?m) = "mul") }}
  OPTIONAL {{ ?a schema:about ?x; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?w }} OPTIONAL {{ ?x wdt:P1001 ?j }} }}'''):
                name = r.get('l') or r.get('m') or r.get('w')
                if name:
                    labels.setdefault(qid(r['x']), [name, r.get('w'), qid(r.get('j'))])
        except Exception as ex:
            if len(batch) <= 20:
                log(f'  labels batch failed: {ex}')
                return
            lab_run(batch[:len(batch) // 2])
            lab_run(batch[len(batch) // 2:])
    for i in range(0, len(need), 300):
        lab_run(need[i:i + 300])
    missing = [x for x in need if x not in labels]
    for i in range(0, len(missing), 100):   # a batch that failed silently the first time
        lab_run(missing[i:i + 100])
    keep = []
    for r in rows:
        lab = labels.get(r['pos'])
        if not lab:
            continue
        name = lab[0]
        if PARTY_LEADER.match(name):
            keep.append(r)
            continue
        if NOT_RULER.search(name):
            continue
        if anc.get(r['pos']) or RULER_NAME.match(name):
            keep.append(r)
    log(f'famous rulers: {len(keep)} ruling terms of {len(rows)} dated statements')
    return keep, {k: v for k, v in labels.items()}


def aliases(ids):
    out = {}
    ids = sorted(ids, key=lambda q: int(q[1:]))
    for i in range(0, len(ids), 250):
        v = ' '.join('wd:' + x for x in ids[i:i + 250])
        try:
            for r in sparql(f'SELECT ?x ?a WHERE {{ VALUES ?x {{ {v} }} ?x skos:altLabel ?a FILTER(LANG(?a) = "en") }}'):
                out.setdefault(qid(r['x']), []).append(r['a'])
        except Exception as ex:
            log(f'  alias batch {i} failed: {ex}')
    return out


def main():
    raw = json.load(open(os.path.join(CACHE, 'events_raw.json')))
    extra = json.load(open(os.path.join(CACHE, 'extra_raw.json')))
    have = set(raw['kept']) | set(extra['deep'])
    items = famous_items(have)
    for k, v in dropped_periods(have | set(items)).items():
        items[k] = v
    # well-known items the class filters miss, named in tools/curated/famous_include.json
    inc = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'curated', 'famous_include.json')))['items']
    titles = [t for t, _ in inc]
    typ = dict(inc)
    n_inc = 0
    for i in range(0, len(titles), 60):
        vals = ' '.join('"%s"@en' % t.replace('\\', '\\\\').replace('"', '\\"') for t in titles[i:i + 60])
        for r in sparql(f'''SELECT ?t ?item ?sl WHERE {{ VALUES ?t {{ {vals} }}
  ?a schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?t . ?item wikibase:sitelinks ?sl . }}'''):
            k = qid(r['item'])
            if k not in have and k not in items:
                items[k] = {'type': typ[r['t']], 'pat': '{}', 'sl': int(r['sl']), 'props': ['include']}
                n_inc += 1
    log(f'include list: {n_inc} of {len(titles)} titles added (the rest are already in, or have no item)')
    people = {x['p'] for x in extra['people']}
    terms, labels = famous_rulers(people)
    have_det = set(raw['details']) | set(extra['details'])
    det = details(set(items) - have_det)
    dates = extra_dates(set(items), DATE_PROPS + ['P576', 'P582', 'P730'])
    reg_path = os.path.join(CACHE, 'regions_raw.json')
    reg_kept = json.load(open(reg_path))['kept'] if os.path.exists(reg_path) else {}
    well_known = [k for k, v in list(raw['kept'].items()) + list(extra['deep'].items()) + list(items.items()) + list(reg_kept.items()) if v['sl'] >= 15]
    al = aliases(set(well_known))
    with open(os.path.join(CACHE, 'famous_raw.json'), 'w') as f:
        json.dump({'items': items, 'details': det, 'dates': dates, 'terms': terms, 'labels': labels, 'aliases': al}, f)
    log(f'wrote famous_raw.json: {len(items)} items, {len(terms)} ruler terms, {len(al)} items with aliases')


if __name__ == '__main__':
    main()
