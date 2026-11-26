"""Which Wikidata offices count as "in office" for a state: heads of state and of government.

Wikidata files every office that names a country under it (mayors, queens consort, party youth leaders,
the head of a deposed royal house), so the lists of rulers are filtered by title: a title must contain a
ruling office (RULER) and must not be one of the look-alikes (NOT_RULER)."""
import re

RULER = re.compile(
    r'\b(kings?|queen|emperors?|empress|monarchs?|sultan|caliph|shah|tsar|czar|khan|khagan|pope|pharaoh|president|'
    r'prime minister|premier|chancellor|reichskanzler|bundeskanzler|shogun|doge|emir|amir|duke|prince|regent|consul|'
    r'dictator|stadtholder|pensionary|vizier|governor|viceroy|chief|chairman|chairperson|general secretary|first secretary|'
    r'secretary[- ]general|secretary of state of spain|head of state|head of government|leader|ruler|tlatoani|inca|negus|maharaja|raja|nawab|nizam|peshwa|'
    r'lord protector|minister[- ]president|first minister|chief minister|minister of state of monaco|captain regent|sovereign|basileus|tyrant|archon|satrap|'
    r'khedive|bey|dey|pasha|voivode|hospodar|margrave|landgrave|elector|count|grand master|imam|sharif|oba|'
    r'asantehene|kabaka|mwami|mansa|taoiseach|co-prince|co-monarch|list of [\w ]*monarchs|führer|commissars|council of ministers|'
    r'manikongo|maharana|yang di-pertuan|shikken|state elder|judge of|khwarazmshah|supreme director|tsenpo|interrex|jefe supremo|'
    r'council of people|posadnik|hetman|o le ao|beylerbey|wali|state counsellor|head of the central rada|ban of|druk gyalpo|aksum|'
    r'caudillo|chhatrapati|supreme leader|protector|lord of|grand duke|archduke|khedive|mikado|autocrat|khanum|despot|exarch|high king|chief executive)\b', re.I)
NOT_RULER = re.compile(
    r'\b(mayor|lord mayor|bürgermeister\w*|\w*bürgermeister|consort|haseki|valide|empress of japan|byzantine empress|empress of nicaea|'
    r'emerita|emeritus|deputy|vice[- ]president|vice[- ]chancellor|vice[- ]premier|local|chiltern|civil governor|regional governor|district|arrondissement|bank|banco|senate|'
    r'court|young|youth|imperial house|royal house|head of the house|pretender|titular|claimant|speaker|council vice|municipal|university|'
    r'company|club|association|football|olympic|academy|society|chamber|parliament|assembly|league|trade union|'
    r'party(?! of the soviet| of china| of vietnam| of cuba)|governor of (?:a|the) (?:state|province|region|prefecture|bank)|'
    r'state governor|provincial|prefect|county|canton|commune|village|town|city|borough|metropolitan)\b', re.I)


def is_ruler_title(title):
    t = title or ''
    if re.search(r'communist party|workers. party', t, re.I) and re.search(r'general secretary|first secretary|chairman', t, re.I):
        return True     # party leaders of one-party states
    if re.search(r'presidium', t, re.I):
        return True     # collective heads of state
    return bool(RULER.search(t)) and not NOT_RULER.search(t)
