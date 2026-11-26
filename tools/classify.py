"""Rules that put a sentence from a Wikipedia year article into one of the app's event types.

The first rule that matches wins, so the order is from the most specific kind of event to the most
general. A sentence that matches nothing stays "other"."""
import re

_R = lambda p: re.compile(p, re.I)
RULES = [
    ('epidemic', _R(r'\b(plague|epidemic|pandemic|cholera|smallpox|outbreak of (?:the )?(?:disease|influenza|yellow fever|typhus|measles|ebola)|black death|pestilence|influenza|yellow fever)\b')),
    ('disaster', _R(r'\b(earthquake|erupts?|eruption|tsunami|hurricane|cyclone|typhoon|tornado|floods?|flooding|famine|drought|avalanche|landslide|'
                    r'great fire|fire (?:destroys|breaks out|kills|sweeps|devastates|burns)|destroyed by (?:a )?fire|shipwreck|is wrecked|runs aground|capsizes|sinks (?:in|off|after|during|with)|'
                    r'crash(?:es|ed)|derails?|train (?:wreck|collision|disaster)|explosion|explodes|mine disaster|collapses, killing|meteorite|wildfires?|blizzard|heat wave|volcano)\b')),
    ('treaty', _R(r'\b(treaty|peace of|truce|armistice|concordat|peace (?:is|was) (?:signed|concluded|made)|peace agreement|ceasefire|convention of|accords?\b|pact\b|capitulations? of|peace treaty|alliance (?:is|with|between)|sign an? (?:alliance|agreement))')),
    ('ruler', _R(r'\b(becomes? (?:the )?(?:\w+ ){0,3}(?:king|queen|emperor|empress|pope|caliph|sultan|shah|tsar|czar|khan|president|prime minister|chancellor|duke|prince|regent|shogun|pharaoh|consul|dictator|doge|emir|governor|ruler|monarch|chief minister|premier|leader)|'
                 r'(?:is|are) crowned|coronation|succeeds? (?:him|her|his|as|to the throne)|is succeeded by|ascends? (?:to )?the throne|accedes|accession|abdicates?|is (?:elected|proclaimed|acclaimed|declared|installed|enthroned|inaugurated|sworn in) (?:as )?(?:the )?(?:\w+ ){0,3}(?:king|queen|emperor|empress|pope|caliph|sultan|president|prime minister|chancellor|shogun|doge)|'
                 r'becomes? (?:the )?(?:new|next) |becomes? (?:the )?(?:\w+ ){0,3}(?:landgrave|margrave|count|tyrant|grand vizier|vizier|secretary[- ]general|archon|khagan|voivode|high king|elector|grand duke|grand prince|lord protector|imam|bey|dey|raja|maharaja|satrap|co-ruler|co-emperor|caesar|augustus|king|ruler)\b|surrenders (?:his|her|the) (?:crown|throne)|'
                 r'is elected pope|elected (?:as )?(?:the )?(?:\d+\w+ )?pope|pope \w+(?: \w+)? succeeds|is deposed|is overthrown|usurps|takes the throne|seizes the throne|begins (?:his|her) reign|start of the reign|inaugurated as|sworn in as)\b')),
    ('revolt', _R(r'\b(revolts?|rebellion|rebels?|uprising|insurrection|mutiny|mutinies|coup\b|coup d|riots?|rioting|insurgents?|rises? (?:up )?against|strike (?:begins|ends|by)|general strike|protests?|demonstrations?|demonstrators|peasants. war|secedes?)\b')),
    ('violence', _R(r'\b(massacres?|massacred|assassinat\w+|is murdered|are murdered|murders?|pogrom|bombing|bomb (?:explodes|kills)|terrorist|lynch\w+|is executed|are executed|executed|beheaded|burned at the stake|hanged|genocide|slaughter\w*|shot dead|shoots|hijack\w+|kidnap\w+|hostages?)\b')),
    ('battle', _R(r'\b(battle|siege|besieges?|besieged|defeats?|defeated|is routed|routs|victory|victorious|sacks?|sacked|captures?|captured|conquers?|conquered|invades?|invasion|raids?|army|armies|troops|forces (?:take|capture|enter|occupy|attack|defeat|land|cross)|'
                  r'fleet (?:defeats|attacks|destroys|captures|is destroyed|is defeated|sails against)|storms?|campaign against|expedition against|skirmish|surrenders?|naval|bombard\w*|offensive|counter-?attack|ambush\w*|occup(?:y|ies|ied)|falls to|is taken by|plunders?|pillages?|lays? siege)\b')),
    ('war', _R(r'\b(war (?:begins|ends|breaks out|is declared)|declares? war|outbreak of (?:the )?(?:\w+ )*war|end of the (?:\w+ )*war|start of the (?:\w+ )*war|civil war (?:begins|breaks out|ends))\b')),
    ('violence', _R(r'\b(is killed|are killed|is slain|puts? .{0,60} to death|put to death|is stabbed|is poisoned|is strangled|is blinded|is shot|is tortured)\b')),
    ('state', _R(r'\b(independence|independent|annex\w+|is partitioned|partition of|unification|union of|is united with|personal union|becomes (?:a|an|the) (?:\w+ ){0,2}(?:colony|province|protectorate|republic|kingdom|state|territory|duchy|vassal|dependency|dominion|empire)|'
                 r'(?:kingdom|empire|republic|dynasty|caliphate|khanate|sultanate|state|duchy|principality) (?:is|was) (?:founded|established|proclaimed|created|dissolved|abolished)|republic of [\w ]{2,40} is proclaimed|is admitted as|admitted to the union|cedes?|ceded|secession|dissolution of|is incorporated into|is proclaimed (?:a|an|the) (?:republic|kingdom|empire)|collapse of the|fall of the|end of the (?:\w+ )?(?:dynasty|empire|kingdom|republic))\b')),
    ('religion', _R(r'\b(pope|papal|bishops?|archbishop|patriarch|council of|synod|monastery|monks?|abbey|abbot|cathedral|church|canoni[sz]ed|excommunicat\w+|heresy|heretics?|crusade|buddhis\w+|mosque|saint|baptism|baptized|convert(?:s|ed) to|christianity|islam|muslims?|temple|missionar\w+|jesuits?|inquisition|relics?|pilgrim\w*|diocese|quran|bible|encyclical|protestant\w*|catholic\w*|reformation|rabbi|synagogue|jews are)\b')),
    ('discovery', _R(r'\b(discovers?|discovered|discovery|expedition|explorers?|explores?|circumnavigat\w+|first (?:recorded )?(?:european|ascent|flight|crossing|voyage|to reach|to sail|sighting)|purif(?:y|ies)|transit of (?:venus|mercury)|aviators?|crosses the (?:atlantic|mediterranean|english channel|pacific)|sights?|invents?|invented|invention|patents?|patented|comet|eclipse|supernova|observes?|observed|astronomer|'
                     r'launch(?:es|ed)|spacecraft|satellite|orbit\w*|space shuttle|cosmonaut|astronaut|telescope|vaccine|isolates?|synthesi[sz]es?|element|theorem|theory of|demonstrates|first successful|lands on|sets sail|sails (?:from|to|around|for)|reaches the)\b')),
    ('economy', _R(r'\b(banks?|stock (?:market|exchange)|currency|coins?|coinage|mint|tax(?:es|ation)?|tariffs?|trade (?:agreement|monopoly|route)|(?:commercial|trade|trading) (?:concessions|rights|privileges)|trading post|company is (?:founded|chartered|established|formed|incorporated)|east india company|bankrupt\w*|financial|inflation|debas\w+|'
                   r'gold rush|strike gold|railway|railroad|canal (?:opens|is)|factory|corporation|merger|market crash|recession|depression|price of|monopoly|guild)\b')),
    ('politics', _R(r'\b(parliament|elections?|elected|referendum|constitution\w*|edict|decree|laws?|act of|acts?\b|bill|statute|charter|diet of|senate|consuls?|tribune|congress|assembly|estates[- ]general|legislat\w+|cabinet|minister|government|supreme court|verdict|trial|'
                    r'impeach\w+|resigns?|appoints?|appointed|ambassador|embassy|envoys?|diplomatic|summit|conference|united nations|league of nations|vote[sd]?|veto\w*|census|reforms?|abolish\w+|proclamation|ultimatum|sanctions|governor|viceroy|exiled?|banish\w+|imprison\w+|arrest\w+)\b')),
    ('founding', _R(r'\b(is founded|are founded|founded by|founds|foundation of|is established|establish(?:es|ed) (?:a|an|the)|opens|is opened|is inaugurated|is chartered|is built|is constructed|'
                    r'construction (?:of|begins|starts)|is completed|cornerstone|foundation stone|is consecrated|is dedicated|first (?:\w+ ){0,2}(?:university|college|school|hospital|library)|moves? (?:the|his|her|its) (?:\w+ )?capital)\b')),
    ('culture', _R(r'\b(publish\w*|writes?|written|wrote|poets?|poems?|novel|book|printed|printing|paints?|painting|sculpt\w+|compos\w+|opera|symphony|play\b|theatre|theater|newspaper|magazine|dictionary|encyclop\w+|manuscript|chronicle|historian|philosopher|architect|museum|exhibition|world.s fair|calendar|alphabet|script)\b')),
]


def classify(text, title='', head=''):
    """Event type for a sentence (with the article title and section heading it came under)."""
    h = head.lower()
    s = f'{title}. {text}' if title else text
    for t, rx in RULES:
        if rx.search(s):
            return t
    if 'religion' in h:
        return 'religion'
    if re.search(r'science|technology|astronomy|exploration', h):
        return 'discovery'
    if re.search(r'\bart|literature|culture|education', h):
        return 'culture'
    if re.search(r'econom|commerce|trade', h):
        return 'economy'
    return 'other'
