"""Step 4b: turn cached Wikipedia year articles into dated events -> tools/cache/yearpage_events.json

From each page's "Events" section we keep, per bullet: the year, the month and day when the bullet starts
with one, its first linked articles, and the bullet's first sentence as plain text (wiki markup removed).
The sentence is Wikipedia text (CC BY-SA 4.0); the app shows it with a link to the year article.

  events   bullets with a linked article that Wikidata dates to the same year (within one). The event is
           named by that article and its date counts as verified.
  bullets  the other bullets, kept only when the text is a complete sentence and is not about sport or
           entertainment. They are shown as "unverified": nothing confirms the date but the year article.

Each bullet also gets a place when one of its linked articles has coordinates on Wikidata (a specific
place first, else a state, which the app labels as an approximate position).
"""
import hashlib
import html
import os
import re

from common import CACHE, log, write_json, sparql, qid
from fetch_yearpages import title, page_text
from verify import wikidata_years, check

MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
          'november', 'december']
MON_RE = '(?:January|February|March|April|May|June|July|August|September|October|November|December)'
SKIP = re.compile(r'^(\d{1,4}s?( BC)?|AD \d+|\d+(st|nd|rd|th) century.*|.*\b(births|deaths)\b.*|list of .*|'
                  r'january|february|march|april|may|june|july|august|september|october|november|december'
                  r'|[A-Z][a-z]+ \d{1,2})$', re.I)
DASH = '\u2013\u2014' + r'\-'

# templates whose text can be kept
KEEP_ARG = {'nowrap', 'nobr', 'small', 'smaller', 'lang', 'transl', 'transliteration', 'nihongo', 'abbr', 'sic', 'not a typo',
            'smallcaps', 'sc', 'big', 'nobreak', 'zh', 'langx', 'ill', 'interlanguage link', 'tooltip', 'linktext', 'flag', 'flagcountry'}
SHIPS = {'hms', 'uss', 'ss', 'rms', 'mv', 'hmas', 'hmcs', 'sms', 'usns', 'hmnzs', 'ms', 'rv', 'mt', 'usat', 'uscgc', 'ins', 'hnlms', 'hmt', 'gts'}
DROP = re.compile(r'^(cite|citation|sfn|efn|refn|rp$|r$|cn$|fact$|dubious|clarify|better source|when$|who$|which$|by whom|'
                  r'failed verification|verify|page needed|full citation|additional citation|unreliable|dead link|webarchive|'
                  r'use |anchor|vague|specify|according to whom|update|relevance|importance|disputed|pov|original research|'
                  r'cbignore|bare url|isbn|oclc|doi|harv|notetag|#tag|dn$|disambiguation needed|incomplete|expand|'
                  r'self-published|primary source|third-party|medical citation|chronology citation|year needed|date missing|'
                  r'elucidate|example needed|quantify|where$|why$|how$|citation needed|unsourced|refimprove|more citations)', re.I)


def template(body, state):
    parts = [p.strip() for p in body.split('|')]
    name = parts[0].lower().replace('_', ' ').strip()
    pos = [p for p in parts[1:] if '=' not in p.split('[[')[0]]
    if DROP.match(name):
        return ''
    if name in ('circa', 'c.', 'ca.', 'circa.'):
        return 'c. ' + (pos[0] if pos else '')
    if name in ('snd', 'spaced ndash', 'spnd', 'spaced en dash', 'dash', 'spndash'):
        return ' – '
    if name in ('ndash', 'en dash', 'nbnd'):
        return '–'
    if name in ('mdash', 'em dash', 'emdash'):
        return '—'
    if name in ('nbsp', 'space', 'sp', 'spaces'):
        return ' '
    if name in ("'", 'apostrophe', "'s"):
        return "'" if name != "'s" else "'s"
    if name in ('convert', 'cvt') and len(pos) >= 2:
        if pos[1] in ('-', 'to', 'and', '–') and len(pos) >= 4:
            return f'{pos[0]} to {pos[2]} {pos[3]}'
        return f'{pos[0]} {pos[1]}'
    if name in ('frac', 'fraction', 'sfrac') and len(pos) >= 2:
        return '/'.join(pos[:3]) if len(pos) == 2 else f'{pos[0]} {pos[1]}/{pos[2]}'
    if name in SHIPS and pos:
        return f'{parts[0].strip()} {pos[0]}'
    if name == 'ship' and len(pos) >= 2:
        return f'{pos[0]} {pos[1]}'.strip()
    if name == 'sclass' and len(pos) >= 2:
        return f'{pos[0]}-class {pos[1]}'
    if name in KEEP_ARG and pos:
        if name in ('lang', 'transl', 'transliteration', 'langx') and len(pos) >= 2:
            return pos[1]
        if name == 'ill':
            return pos[0]
        return pos[-1] if name in ('abbr',) and False else pos[0]
    if name in ('oldstyledate', 'oldstyledatedy', 'oldstyledatenonc') and pos:
        return pos[0]
    state['unknown'] = True
    return ''


def clean(body):
    """Wikitext of one bullet -> (plain text, damaged). damaged: a template we cannot render was removed."""
    state = {}
    s = re.sub(r'<!--.*?-->', '', body, flags=re.S)
    s = re.sub(r'<ref[^>/]*/>', '', s)
    s = re.sub(r'<ref[^>]*>.*?</ref>', '', s, flags=re.S)
    s = re.sub(r'<ref[^>]*>.*$', '', s, flags=re.S)      # unclosed reference running to the end of the line
    for _ in range(6):
        s2 = re.sub(r'\{\{([^{}]*)\}\}', lambda m: template(m.group(1), state), s)
        if s2 == s:
            break
        s = s2
    if '{{' in s or '}}' in s:
        state['unknown'] = True
    s = re.sub(r'\[\[(?:File|Image|Category):[^\]]*\]\]', '', s, flags=re.I)
    s = re.sub(r'\[\[(?:[^\]|]*\|)?([^\]|]*)\]\]', r'\1', s)
    s = re.sub(r'\[https?://\S+\s+([^\]]+)\]', r'\1', s)
    s = re.sub(r'\[https?://\S+\]', '', s)
    s = re.sub(r"'{2,}", '', s)
    s = re.sub(r'</?(small|sup|sub|br|span|nowiki|i|b|u|big|abbr|onlyinclude|includeonly|noinclude)[^>]*>', ' ', s, flags=re.I)
    s = html.unescape(html.unescape(s)).replace('\xa0', ' ')
    s = re.sub(r'\s+', ' ', s).strip()
    s = re.sub(r'\s+([,.;:)])', r'\1', s)
    s = re.sub(r'\(\s+', '(', s)
    s = re.sub(r'\(\s*\)', '', s)
    s = re.sub(r'\s{2,}', ' ', s)
    return s, bool(state.get('unknown'))


DATE_RE = re.compile(r'^(?:c\. |ca\. |circa )?(' + MON_RE + r')(?:\s+(\d{1,2})(?:st|nd|rd|th)?)?'
                     r'(?:\s*[' + DASH + r'/]\s*(?:' + MON_RE + r'\s+)?\d{1,2}(?:st|nd|rd|th)?)?'
                     r'(?:\s*\([^)]{0,60}\))?\s*(?:[' + DASH + r':]\s+|$)', re.I)
ABBR = {'st', 'dr', 'mr', 'mrs', 'ms', 'gen', 'col', 'lt', 'capt', 'sr', 'jr', 'c', 'ca', 'no', 'vs', 'mt', 'ft', 'gov',
        'rev', 'prof', 'sgt', 'adm', 'brig', 'maj', 'hon', 'cmdr', 'co', 'inc', 'ltd', 'corp', 'u.s', 'u.k', 'u.n', 'o.s',
        'n.s', 'a.d', 'b.c', 'e.g', 'i.e', 'etc', 'approx', 'est', 'fr', 'bros', 'messrs', 'pres', 'sen', 'rep', 'jan', 'feb',
        'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'viz', 'cf', 'al', 'op', 'vol', 'pp', 'p', 'd', 'r', 'b', 'fl', 'ss', 'sts'}


def first_sentence(s):
    depth = 0
    for i, ch in enumerate(s):
        if ch in '([':
            depth += 1
        elif ch in ')]':
            depth = max(0, depth - 1)
        elif ch in '.!?' and depth == 0 and i + 1 < len(s):
            rest = s[i + 1:]
            m = re.match(r'["”\')]*\s+(["“\'(]?[A-Z0-9])', rest)
            if not m:
                continue
            if ch == '.':
                prev = re.search(r'([\w.]+)$', s[:i])
                w = prev.group(1).lower() if prev else ''
                if w in ABBR or len(w) == 1 or re.fullmatch(r'(?:[a-z]\.)+[a-z]', w):
                    continue
            q = re.match(r'["”\')]*', rest).group(0)
            return s[:i + 1] + q
    return s


VERB = re.compile(r"\b(is|are|was|were|has|have|had|becomes?|became|begins?|began|ends?|ended|dies|died|defeats?|defeated|"
                  r"captures?|captured|founds|founded|takes|took|makes|made|signs?|signed|declares?|declared|invades?|invaded|"
                  r"conquers?|conquered|succeeds?|succeeded|marries|married|arrives?|arrived|leaves|left|returns?|returned|"
                  r"establish(?:es|ed)|opens?|opened|launch(?:es|ed)|wins?|won|loses|lost|kills?|killed|destroys?|destroyed|"
                  r"occurs?|occurred|breaks|broke|strikes?|struck|issues?|issued|adopts?|adopted|grants?|granted|sends?|sent|"
                  r"leads?|led|moves?|moved|builds?|built|completes?|completed|publish(?:es|ed)|discovers?|discovered|"
                  r"reach(?:es|ed)|attacks?|attacked|besieges?|besieged|sacks?|sacked|occup(?:ies|ied)|annex(?:es|ed)|"
                  r"appoints?|appointed|elects?|elected|crowns?|crowned|proclaims?|proclaimed|abdicates?|abdicated|"
                  r"overthrows?|overthrew|revolts?|rebels?|surrenders?|surrendered|agrees?|agreed|recogni[sz]es?|recogni[sz]ed|"
                  r"gains?|gained|joins?|joined|forms?|formed|creates?|created|introduces?|introduced|pass(?:es|ed)|"
                  r"approves?|approved|rejects?|rejected|orders?|ordered|forces?|forced|expels?|expelled|exiles?|exiled|"
                  r"executes?|executed|murders?|murdered|assassinates?|assassinated|convenes?|convened|meets?|met|holds?|held|"
                  r"enters?|entered|cross(?:es|ed)|sails?|sailed|lands?|landed|explores?|explored|claims?|claimed|settles?|settled|"
                  r"erupts?|erupted|hits?|sinks?|sank|crash(?:es|ed)|explodes?|exploded|collapses?|collapsed|burns?|burned|"
                  r"receives?|received|gives?|gave|sees|saw|comes|came|goes|went|starts?|started|continues?|continued|"
                  r"fails?|failed|falls?|fell|rises?|rose|raises?|raised|drives?|drove|puts?|sets?|seizes?|seized|"
                  r"restores?|restored|resigns?|resigned|replaces?|replaced|removes?|removed|deposes?|deposed|ratif(?:ies|ied)|"
                  r"abolish(?:es|ed)|bans?|banned|suppress(?:es|ed)|crush(?:es|ed)|rout(?:s|ed)|repels?|repelled|withdraws?|withdrew|"
                  r"retreats?|retreated|advances?|advanced|marches|marched|concludes?|concluded|negotiates?|negotiated|"
                  r"unites?|united|divides?|divided|splits?|cedes?|ceded|sells?|sold|buys?|bought|purchases?|purchased|"
                  r"writes?|wrote|composes?|composed|paints?|painted|performs?|performed|invents?|invented|patents?|patented|"
                  r"observes?|observed|demonstrates?|demonstrated|announces?|announced|releases?|released|orbits?|"
                  r"votes?|voted|commissions?|commissioned|dedicates?|dedicated|consecrates?|consecrated|baptizes|baptized|"
                  r"converts?|converted|flees|fled|escapes?|escaped|imprisons?|imprisoned|arrests?|arrested|tries|tried|"
                  r"convicts?|convicted|sentences?|sentenced|hangs?|hanged|burns|rules?|ruled|reigns?|governs?|commands?|"
                  r"remains?|remained|inherits?|inherited|acquires?|acquired|obtains?|obtained|secures?|secured|ravages?|ravaged|"
                  r"plunders?|plundered|raids?|raided|devastates?|devastated|relieves?|relieved|lays?|laid|lifts?|lifted|"
                  r"calls?|called|names?|named|renames?|renamed|incorporates?|incorporated|charters?|chartered|admits?|admitted|"
                  r"emerges?|emerged|appears?|appeared|spreads?|spread|allows?|allowed|permits?|permitted|prohibits?|prohibited|"
                  r"brings?|brought|carries|carried|constructs?|constructed|finish(?:es|ed)|transfers?|transferred|shifts?|"
                  r"assumes?|assumed|ascends?|ascended|accedes?|usurps?|usurped|submits?|submitted|pays?|paid|offers?|offered|"
                  r"refuses?|refused|accepts?|accepted|supports?|supported|allies|allied|betrays?|betrayed|poisons?|poisoned|"
                  r"commits?|committed|organi[sz]es?|organi[sz]ed|make|flies|flew|fights?|fought|plans?|planned|attempts?|attempted|"
                  r"asks?|asked|advocates?|urges?|urged|warns?|warned|visits?|visited|travels?|travelled|traveled|addresses|addressed|"
                  r"tak(?:es|en) place|uses?|used|shows?|showed|records?|recorded|reports?|reported|describes?|described)\b")
SPORT = re.compile(r'\b(football|soccer|Olympics|Olympic Games|(?:Winter|Summer) Olympic|championships?|world cup|super bowl|'
                   r'tournament|grand prix|movies?|television|tv series|sitcom|eurovision|box office|video games?|'
                   r'rock band|pop band|rock group|pop group|singers?|rapper|actors?|actress(?:es)?|academy awards?|emmy|grammy|'
                   r'golden globe|baseball|cricket|golf|rugby|hockey|basketball|tour de france|wrestling|wrestler|formula one|'
                   r'motor rac\w+|horse rac\w+|wimbledon|stanley cup|world series|heavyweight|athletes?|athletics|sprinter|'
                   r'miss world|miss universe|beauty pageant|disney|broadway|musical|premieres?|debuts?|nintendo|playstation|'
                   r'xbox|sega|billboard|mtv|cartoon|comic strip|comics|animated|soap opera|game show|talk show|radio show|'
                   r'pilot episode|episodes?|test match|the beatles|elvis|record label|rock and roll|jazz|world record|swimmer|'
                   r'skater|skating|cyclist|cycling|racing driver|chess|playoffs?|innings|touchdown|sports club|football club|athletic club|futebol)\b', re.I)
# words that are only sport or show business in lower case ("Song dynasty", "Oscar II" and "NFL" need care)
SPORT_CS = re.compile(r'\b(films?|albums?|songs?|singles?|FIFA|UEFA|NBA|NFL|MLB|NHL|Oscars?\b(?= for| ceremony| nominat)|goalkeeper)\b')
SPORT_HEAD = re.compile(r'\b(sports?|entertainment|music|films?|television|radio|games?|theat(?:er|re)|publications)\b', re.I)
SEASON = re.compile(r'^(?:(?:early|late|mid)[ -])?(?:spring|summer|autumn|fall|winter)\s*[' + DASH + r']\s+', re.I)


def complete(s):
    """Is this cleaned text a complete, self-contained sentence?"""
    if not 30 <= len(s) <= 320 or len(s.split()) < 5:
        return False
    if re.search(r'[{}\[\]|<>=]|\'\'|\bhttp', s) or not re.match(r'["“(]?[A-Z0-9]', s):
        return False
    if s.count('(') != s.count(')') or s.count('"') % 2:
        return False
    if s.endswith(':') or s.endswith(',') or s.endswith(';'):
        return False
    core = re.sub(r'^[^:]{3,60}: ', '', s)      # "Battle of X: the army ..." -> test the part after the colon
    return bool(VERB.search(core))


def parse(y, text):
    m = re.search(r'==\s*Events\s*==(.*?)(\n==[^=]|\Z)', text, re.S)
    if not m:
        return []
    out = []
    month = 0
    heads = ['', '']
    parent = (0, 0)      # date of the last first-level bullet that is only a date
    for line in m.group(1).splitlines():
        hm = re.match(r'(===+)\s*(.*?)\s*===+', line)
        if hm:
            name = clean(hm.group(2))[0]
            mm = next((i + 1 for i, n in enumerate(MONTHS) if name.lower().startswith(n)), 0)
            # "January" sets the month; "January-June" or "By place" do not
            month = mm if re.fullmatch(MON_RE, name, re.I) else 0
            heads[0 if len(hm.group(1)) == 3 else 1] = name
            if len(hm.group(1)) == 3:
                heads[1] = ''
            parent = (0, 0)
            continue
        if not line.startswith('*'):
            continue
        depth = len(line) - len(line.lstrip('*'))
        body = line.lstrip('*').strip()
        links = [l.split('|')[0].strip() for l in re.findall(r'\[\[([^\]]+)\]\]', re.sub(r'<ref[^>]*>.*?</ref>', '', body))]
        txt, damaged = clean(body)
        mon, day = month, 0
        dm = DATE_RE.match(txt)
        if dm:
            mon = MONTHS.index(dm.group(1).lower()) + 1
            day = int(dm.group(2)) if dm.group(2) and int(dm.group(2)) <= 31 else 0
            txt = txt[dm.end():].strip()
            if depth == 1:
                parent = (mon, day) if not txt else (0, 0)
        elif SEASON.match(txt):
            txt = txt[SEASON.match(txt).end():].strip()
            txt = txt[:1].upper() + txt[1:]
        elif depth >= 2 and parent[0]:
            mon, day = parent
        elif depth == 1:
            parent = (0, 0)
        links = [l for l in links if l and not SKIP.match(l) and ':' not in l]
        seen = []
        for l in links:
            l = l.split('#')[0].strip().replace('_', ' ')
            if l and l not in seen:
                seen.append(l[0].upper() + l[1:])
        if not txt or not seen:
            continue
        sent = re.sub(r'\.\.$', '.', first_sentence(txt))
        if sent and sent[-1] not in '.!?"”)' and VERB.search(sent):
            sent += '.'
        out.append({'y': y, 'm': mon, 'd': day, 'links': seen[:6], 'text': sent, 'damaged': damaged,
                    'head': ' / '.join(h for h in heads if h)})
    return out


BIG = {'Q6256', 'Q3624078', 'Q3024240', 'Q48349', 'Q417175', 'Q1250464', 'Q7270', 'Q5107', 'Q28171280', 'Q133156',
       'Q1790360', 'Q12759805', 'Q107390', 'Q35657', 'Q82794', 'Q1763527', 'Q11514315', 'Q112099', 'Q179164'}  # states, empires, continents, regions


def coordinates(qs):
    """{QID: (lon, lat, is a state or large region)} for linked items that have coordinates."""
    out = {}
    qs = sorted(qs, key=lambda q: int(q[1:]))
    for i in range(0, len(qs), 300):
        vals = ' '.join('wd:' + q for q in qs[i:i + 300])
        try:
            rows = sparql(f'SELECT ?item ?c (GROUP_CONCAT(DISTINCT STRAFTER(STR(?k), "entity/")) AS ?cls) WHERE {{ VALUES ?item {{ {vals} }} '
                          f'?item wdt:P625 ?c . OPTIONAL {{ ?item wdt:P31 ?k }} }} GROUP BY ?item ?c')
        except Exception as ex:
            log(f'  coordinates batch {i} failed ({ex}); skipped')
            continue
        for r in rows:
            mm = re.match(r'Point\(([-\d.eE]+) ([-\d.eE]+)\)', r['c'])
            if mm and qid(r['item']) not in out:
                out[qid(r['item'])] = (round(float(mm.group(1)), 3), round(float(mm.group(2)), 3),
                                       bool(set(r.get('cls', '').split()) & BIG))
        if i % 6000 == 0:
            log(f'  coordinates for linked articles {i}/{len(qs)}')
    return out


def main():
    found = []
    pages = 0
    for y in range(-500, 2025):
        if y == 0:
            continue
        text = page_text(y)
        if not text or text.lstrip().upper().startswith('#REDIRECT'):
            continue
        pages += 1
        found += parse(y, text)
    # A bullet usually links a person or a place before the event itself, so each of its first three links
    # is checked and the first whose Wikidata item is dated to this year (within one) names the event.
    wd = wikidata_years([l for f in found for l in f['links']], batch=150) if found else {}
    coords = coordinates({wd[l]['q'] for f in found for l in f['links'] if l in wd})

    def where(f):
        best = None
        for l in f['links']:
            c = coords.get(wd.get(l, {}).get('q'))
            if c and not c[2]:
                return [c[0], c[1], 0]
            if c and best is None:
                best = [c[0], c[1], 1]
        return best

    kept, bullets, seen_text = [], [], set()
    stats = {'bullets': len(found), 'dated': 0, 'sentence': 0, 'sport': 0, 'notSentence': 0, 'damaged': 0, 'duplicate': 0}
    for f in found:
        src = 'https://en.wikipedia.org/wiki/' + title(f['y']).replace(' ', '_')
        text_ok = not f['damaged'] and complete(f['text'])
        hit = None
        for l in f['links'][:3]:
            ok, note = check(f['y'], wd.get(l), slack=1)
            if ok:
                hit = (l, note)
                break
        if hit:
            l, note = hit
            stats['dated'] += 1
            kept.append({'y': f['y'], 'm': f['m'], 'd': f['d'], 'link': l, 'verified': True, 'check': note, 'q': wd[l]['q'],
                         'first': l == f['links'][0], 'source': src, 'text': f['text'] if text_ok else '', 'head': f['head'],
                         'at': where(f)})
            continue
        if f['damaged']:
            stats['damaged'] += 1
            continue
        if not text_ok:
            stats['notSentence'] += 1
            continue
        if SPORT.search(f['text']) or SPORT_CS.search(f['text']) or SPORT_HEAD.search(f['head']) or any(SPORT.search(l) or SPORT_CS.search(l) for l in f['links']):
            stats['sport'] += 1
            continue
        key = (f['y'], re.sub(r'\W+', '', f['text'].lower())[:60])
        if key in seen_text:
            stats['duplicate'] += 1
            continue
        seen_text.add(key)
        stats['sentence'] += 1
        bullets.append({'id': 'yp%d-%s' % (f['y'], hashlib.sha1(f['text'].encode()).hexdigest()[:8]), 'y': f['y'], 'm': f['m'],
                        'd': f['d'], 'text': f['text'], 'head': f['head'], 'source': src, 'at': where(f),
                        'links': [[l, wd[l]['q']] for l in f['links'][:4] if l in wd]})
    log(f'year pages: {pages} parsed; {stats}')
    write_json(os.path.join(CACHE, 'yearpage_events.json'), {'pages': pages, 'events': kept, 'bullets': bullets, 'stats': stats})


if __name__ == '__main__':
    main()
