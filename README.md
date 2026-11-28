# GeoHistory

A world history map. Type a year (1776, 44 BC, 4 July 1776) and the map shows who ruled where, the
largest powers, and the wars, battles, treaties and other events of that year. Click or search a
territory to see what happened there that year and in the years around it, who ruled it, what it replaced
and what replaced it ("Before" and "After"), and which countries the land is today. Empires are drawn as
one power at world zoom and split into their parts when you zoom in; occupied countries are hatched.

Live: https://ngcoding10.github.io/geohistory/

## Run it locally

It is a static site (plain HTML, CSS and ES modules, no build step):

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

## Rebuild the data

All data is fetched at build time by the scripts in `tools/` (Python 3, standard library only) and
written to `data/`. Raw downloads are cached in `tools/cache/` (not committed), so reruns are quick and
do not hit the sources again.

```sh
tools/build_all.sh
```

Steps (see `tools/build_all.sh`): download the border sources; simplify borders; build the sea layer, US
states, colonial counties, the CShapes years and the Cliopatria years; query Wikidata (events, rulers, the
deep pass, the famous-items pass, the per-region passes, places for events without coordinates: a few
thousand queries, one at a time, all cached); read Wikipedia's year articles; link territories to Wikidata;
limit sketch-map names to their Wikidata years and build the Cliopatria years a second time with those limits;
build the empires, the occupations and the before/after lists; check the curated files and ruler lists
against Wikidata; place every event and write the event files, search index and `data/meta.json`; build
timelines (after the context steps: per-state population, government, parties, religion, leaders, movements and
placed discoveries, which become map events of the type "invention", and the event write-ups; see "State
context and event write-ups"); run the audit; write `js/data-version.js` (a hash of `data/`, used to version data URLs).
That last step also runs `tools/build_assets.py`, which versions every script and stylesheet URL in `index.html`
by its content (an import map versions the ES modules) and stamps a build id; run it on its own after changing
anything in `js/` or `css/`, or the end-to-end check reports the stale URLs. The page compares its build id with
the live `index.html` when it comes back to the front and reloads once for a newer build, so phones (and
home-screen web apps) pick up a deploy. Add `?debug=1` to the address to see how the device draws the flag fill
(`?fill=pattern` forces the tiled-flag fallback).
The map label glyphs in `fonts/Atlas Sans */` are not part of that run: `tools/make_glyphs.cjs` draws them
from the Source Sans 3 fonts in `fonts/src/` with headless Chromium.

Curated text lives in `tools/curated/`: period supplements (`events/*.json`), decade summaries, state
descriptions, dated border changes and a few hand corrections. Every entry names the Wikipedia article it
is about and carries a `verified` flag set by `tools/build_curated.py` when Wikidata has the same year.
`tools/supplement_events.json` is a small hand-checked list of American Revolution events (1763 to 1789),
each with a source link. Sources and licences: [CREDITS.md](CREDITS.md).

A full run from an empty `data/` folder with the caches in place takes about 16 minutes and needs no network.
The intermediate files `tools/cache/*_raw.json` are kept between runs, and `fetch_extra.py` and
`fetch_famous.py` leave out items that later steps found on the previous run, so a second run in a row sends
new Wikidata queries and can differ in a few hundred events (which births and deaths are listed, how an event
without coordinates is placed). The border, ruler and year-article steps give identical output on every run. The committed data is such a
second state: after the run from scratch `fetch_extra.py` was refreshed from Wikidata, which added 240 births
that an old failed query had left out.

Test: `NODE_PATH=$(npm root -g) node tools/e2e.cjs` (143 checks; uses the globally installed Playwright; starts its
own `python3 -m http.server`).

## How it fits with the other apps

The house rules (storage key prefix `geohistory.`, the shared typo-tolerant search `js/fuzzy.js`, copied
unchanged) come from [ngcoding10/backend-combination](https://github.com/ngcoding10/backend-combination):
see `docs/STANDARD.md` and `HANDOFF.md` there. Version 1 has no backend, sign-in, ads or analytics. A
later "save bookmarks and notes" feature would add the shared `core.js` with the data prefix `geo_`.

## Time travel

The time bar has a year box (type 1914, 44 BC or 4 July 1776), "Previous change" and "Next change" (the
previous or next year in which the drawn borders change: a stored map with other shapes, or an empire gaining,
losing or renaming a part), play/pause, and one speed control in plain words (slow, normal, fast, fastest:
2, 5, 20 or 60 years a second). Under it the timeline has era bands and labelled ticks; its scale is uneven
(recent centuries get more room) and the tick interval is chosen piece by piece from the width available, so
labels never crowd. Keys: Left/Right one year, Shift+Left/Right the previous/next change, Space play/pause; on the
timeline Page Up/Down ten years.

When the year changes by the timeline, the change buttons, the arrow keys or play, the map passes through
every stored border map in between, in order (`js/travel.js`). Each change animates only the land that
changed hands (`js/map.js` `show()` and `diff()`): a shape is unchanged when the next map has the same outline in
the same colours, and everything else is changed land. The new map is laid under the old one; in the same frame
every unchanged part of the old map goes (the two are identical there), and the old map's changed shapes stay
on top in their own layer and are taken away one by one, sweeping out from the part of the new owner that it
already held (a conquest spreads from the conqueror's side; new states stamp in one after another). Each gained
shape shows in its old owner's colour until its moment, then flashes: a light fill and a white outline that switch
off in two steps. Nothing is faded or cross-faded: borders snap, and unchanged land does not change at all. Feature
state switches the shapes on and off, so a frame costs no rebuilt sources. At rest the map is always a stored map
for the year shown; nothing is interpolated or morphed. The stops are every year in which a stored map starts or an
empire membership or name changes; a year with the same rows as the one before only moves the year on. While
the years run, small states' and peoples' names hide, and a power's name stays where it was while that place is
still inside it. Play never skips a map: the year waits for the next map to be ready. Dragging the timeline far
may take larger steps (at most four). With `prefers-reduced-motion` there is no animation; when frames come
slowly (over 70 ms on two changes in a row) a jump goes to its end in one change and play skips the maps it
cannot keep up with.

## Colours and flags

**Fill colour = today's country's flag.** Each power is filled with a colour of the flag of the present-day
country that holds most of its land (`data/flags/colors.json`, `tools/build_flags.py`): the Russian Empire, the
Soviet Union and Russia take Russia's flag, the Ottoman Empire Türkiye's, Rome Italy's. That country is measured
on the yearly maps (sample points in every shape the power draws as a state of its own, weighted by area and
years, not its colonies), except that a power named after one of today's countries that holds some of that
country is that country (Denmark, not Norway; Spain, not Argentina), and a few are set by hand
(`tools/curated/flags.json` `modern`: Rome, the Mongols, the Abbasids, the Umayyads, the Seljuks, the Timurids,
Macedon, the Holy Roman Empire, the Ottomans, the Mughals, the Byzantine Empire). The flag's colours come from
its current image on Wikimedia Commons: the most distinctive colour first (its share of the flag, counted for
less when many flags share that hue, as red, white and blue do; white, grey and black are never a fill), then
the next colour of another hue. Each is set into one of two lightness bands so that names stay readable.

**Clash rule.** A graph colouring on each map (neighbours from the outlines) lets larger powers choose first; a
power takes its first colour unless a neighbour that already chose is too close to it (under 0.085 in OKLab),
then its flag's second colour, then the same two in the other lightness band, and only then the nearest of the
24 colours of round 8 that is clear of every such neighbour. Neighbours always differ, and the result depends
only on the map, not on the year shown before. Powers with no country (none of the sample points fell on land
today's countries hold) keep their round-8 palette colour. Peoples and sketch-map regions stay pale with italic
names. Borders are a dark line with a flat rim, no blur. No flag stripes are drawn inside states (tried on paper,
left out: it would cost legibility and frame time).

**Badge = the flag at the time.** A small flag beside each state's name (below it), from sprite sheets of
15-pixel-high badges, one sheet per era, loaded when a year of that era is first shown (`js/flags.js`). A badge
shows once its state covers about 50 by 50 pixels; at world zoom only the largest powers have one (at most 6,
12 and 30 below zoom 2, 3 and 3.2), and more as you zoom in (30, 60, 120). Badges are placed by MapLibre's symbol
collision after the names and after an invisible block at each war marker, so a badge never covers a name or a
marker; one that would is not drawn. An empire shows its ruling state's flag at world zoom and its parts' own
flags (colonies) when zoomed in. Badges hide while the years run and come back when the map rests. The panel of
a territory or empire shows the flag larger, with its name, the years it is shown for, notes, its licence and
links to Commons and Wikidata.

Which flag: Wikidata's flag image (P41) with its start and end time, in force on 1 July of the year shown,
asked of a curated regime, then of the Wikidata era of the map's item that covers the year (Nazi Germany within
"Germany"), then of the item itself. A statement without dates counts from the adoption date of its flag item
(P163, inception) or within the years in the file name ("Flag of Germany (1867–1918)"), else not at all, unless the
state is listed as checked. Dropped: deprecated statements; files named fictitious, proposed, reconstructed,
alternative or variant, from a medieval atlas, or a civil, merchant, naval or war ensign; every flag before 1600
except six states read by hand; and the spans in `tools/curated/flags.json` `drop`, each with its reason.
Curated rows replace Wikidata where it is wrong or silent (the Russian Empire's black-yellow-white flag of 1858 to
1882, China's five flags from the Qing to the People's Republic, Iran's Pahlavi and Islamic Republic flags,
Austria-Hungary's civil ensign, the Bourbon Restoration's white flag), each with a source. A royal banner or
standard, and a flag that is not official or dated only by its file name, is marked in the panel. A state with
no flag shows none; a former state's coat of arms (P94, on its own item) is shown in the panel only, marked
"emblem, not a flag".

Coverage (`data/flags/index.json` `stats`; states drawn as a state of their own in some year of the era, and of
those the ones with a flag in it): before 1600, 6 of 924; 1600s 16 of 142; 1700s 21 of 173; 1800 to 1849 51 of
244; 1850 to 1885 69 of 178; 1886 to 1913 57 of 104; 1914 to 1938 80 of 132; 1939 to 1960 106 of 141; 1961 to 2019
185 of 196. In all 307 states have a dated flag (591 dated runs, 492 images; 80 runs marked uncertain, 17 a royal
banner or standard). What has none, and why: almost every state before 1600 and most outside Europe and the
Americas before 1800 (no national flag, or only a modern drawing on Wikidata: the Ottoman flags before 1844 are
filed as "fictitious", the Mughal Empire, the Qing before 1862, Tokugawa Japan, the Roman Empire have none);
colonies whose Wikidata item has no flag; and 29 runs whose image Wikimedia Commons refused to serve to the
build (`tools/cache/flags_refused.json`; rerun `tools/build_flags.py --retry`). Three such images are replaced by
the same design (`same_design`: France 1976 to 2020 and Italy 1946 to 2003, which differ only in shade).

Spot check (round 9): 85 state-years were read against Wikipedia's flag articles and the Commons file pages,
among them the Soviet Union (1925, 1940, 1950, 1985), Germany (1925, 1934, 1940, 1946, 2000; Weimar, the 1933
to 1935 black-white-red, the swastika flag of 15 September 1935 to May 1945, none under occupation), the German
Empire, the Russian Empire (1800, 1870, 1900), the Ottoman Empire, the Qing and the Republic of China, Japan,
Great Britain and the United Kingdom, France (Kingdom, the Revolution, both Empires, Restoration, July
Monarchy, Vichy), Spain (Bourbon, Second Republic, both Franco flags, today), Italy, Austria-Hungary, the
Austrian Empire, the Mughal Empire, the Confederacy (1861, 1862, 1864), the United States (star counts) and Iran
(Qajar, Pahlavi, Islamic Republic). Found and fixed: Wikidata's "fictitious" Ottoman flags of 1299 to 1844;
the Russian black-yellow-white dated to 1896; the tricolour missing for Napoleon's France and the Consulate (its
flag item dates it from 1853) and the 1790 tricolour for 1792; the Holy Roman Empire's pre-1433 banner shown for
1620; no flag at all for China 1886 to 2019, Iran before 1964 and Austria-Hungary; the Habsburg Monarchy given
Austria's red-white-red; Taiwan given the Republic of China's flags under Japanese rule; gaps for the
Confederacy in 1862 and the United States in 1864 and 1865; a reconstructed Muscovite ship flag; undated
modern flags shown decades too early (Morocco, Guatemala, Burma, Sweden without the union mark, Monaco,
Andorra, Bolivia, Chile, Siam, Hawaii); wrong flags for Mozambique, Martinique, Puerto Rico, Cuba, Venezuela,
Jammu and Kashmir and Ghana.

## War on the map

For the year shown (`js/main.js` `updateWar()`), from the event data only: the major wars going on (those with
the highest notability score, at most six, named in the map key), and the battles fought that year at a recorded
place (not those only placed at a state's centre), battles of the major wars first. At most 8 battle markers at
world zoom and 24 when zoomed in, plus up to 3 war markers for major wars none of whose battles is shown. The
state (or part of an empire) where a shown battle was fought is edged in red, with a slow pulse at rest. A click
on a marker opens the battle or war: its war ("Part of") and the participants Wikidata lists; Wikidata does not
record sides, and the panel says so. The key turns the layer off. The markers stay on while the years play.

## Map key

A collapsible card on the map (`js/key.js`), open on wide screens and closed on phones, with icons drawn in the
map's own colours for the year shown: states, empires and their parts, peoples and sketch borders, occupation
hatching, the change flash, battle and war markers and the red edge, event dots by type, clusters, and what a
click does.

## First load

What the first map needs is loaded first and the rest when it is used: a coarse sea and coast (273 KB,
about 3 km, below a pixel at world zoom) until the map is zoomed in past 2.4, then the full one (948 KB); today's
country names for the event lists from a 14 KB file (the 1 MB search index loads when the search box is used);
and the sketch-map outlines a Cliopatria year draws from an extract of its snapshot (`data/clio/o<year>.json`,
about half of the snapshot). Measured in headless Chromium on a local server (bodies, uncompressed), bytes
before the first map: 1776 6.37 to 4.39 MB, 1942 7.41 to 5.71 MB, 300 BC 5.47 to 3.66 MB. Round 9 (flags; measured up to the first map with its badges, a slightly later point):
1776 4.08 to 4.33 MB, 1942 5.53 to 5.79 MB, 300 BC 3.53 to 3.68 MB: the fill colours (36 KB), the flag index (80 KB,
28 KB compressed) and one era's badge sheet (17 to 251 KB). The panel's larger flag (about 10 KB) loads on click.

## Empires and their parts

At world zoom an empire is drawn as one power: one colour, one name, no inner borders. Zoom in (past
zoom 3.2) and its parts appear, each with its own name and its own tone of the empire's colour. A click at
world zoom opens the empire with the list of its parts for that year; a click on a part when zoomed in opens
the part, which says "Part of ...". No outline is merged or changed: the inner borders are hidden by the
order in which the map draws them (`js/groups.js`, `js/map.js`).

A part belongs to an empire only in the years a source says so (`tools/build_empires.py`,
`data/empires.json`): 418 dated memberships, of which 231 are confirmed by Wikidata (the part's item names
an item of the empire as its country, as what it is part of, as its administrative parent, owner, jurisdiction
or what it is a member of, in a statement of any rank but deprecated, or one "part of" step further up).
- 136 come from Cliopatria's member-of field (the Holy Roman Empire and its states, the fiefs of the French
  crown, the Portuguese, Dutch and British possessions before 1886).
- 158 are the CShapes dependencies of 1886 to 2019 with the owners in `tools/curated/dependency_owners.json`,
  and 12 come from the sketch maps.
- 110 are written for GeoHistory in `tools/curated/empires.json`, each with a source article: the British
  dominions until the Statute of Westminster (1931), the Ottoman vassals, personal unions, and 71 parts that
  no source draws (New Spain and Peru, the two halves of Austria-Hungary, the Crown and Lithuania, the Soviet
  republics, the four Mongol khanates of 1260 to 1293). These are listed in the empire's panel and never drawn.
Not merged although the sources colour them alike: Egypt after the British occupation of 1882, the Congo Free
State (Leopold II's own, not Belgium's), occupied countries, Hanover (in personal union with Great Britain but
never part of its empire), and states only partly inside the Holy Roman Empire (the Habsburg Monarchy,
Brandenburg-Prussia) or France (the Angevin princes' lands, which include Provence).
In round 7 the check also accepts statements of any rank (a place's former country is often
kept beside its current one at a lower rank) and one "part of" step further up: 14 more confirmed (Angola,
Mozambique, Cape Verde and East Timor in the Portuguese Empire, Madagascar in the French, Malta, Brunei, the
Malay states, Australia, South Africa and others in the British); the 187 still unconfirmed were read again and
left as they are (most are CShapes colonies whose Wikidata item has no historical country; arguable rather than
wrong: East Timor in Indonesia in 1976, Gaza in Egypt and the West Bank in Jordan in 1948 to 1966, which CShapes
draws as dependencies). In round 6 the unverified memberships were read one by one; 15 that were wrong were removed or re-dated
(`"exclude"` in `tools/curated/empires.json`, each with its reason): the Carolingian realms count as one
empire only until 887, not 987; the Kingdom of Arles is imperial from 1033, not French; Bahrain is British
from 1861, not 1783; three Silesian duchies were not in the Kingdom of Poland in 1305 to 1313.

## Before and after

Every territory panel has "Before" and "After" (`tools/build_succession.py`, `data/succession.json`), one
step only: what Wikidata lists as replaced and replacing (P1365/P1366, P155/P156), and who held the same
land on the yearly map just before the first year a state is drawn and just after the last (measured on
a grid of points weighted by area). The rules, rewritten in round 6 after the lists were read for 25
well-known states: a holder the maps alone name needs 10% of the land and must hand over within 25 years
of the state's beginning or end (an annexation a century later is not a predecessor); a break-away needs
80% of its own land from the earlier state, at least 5 years on the map, and a large share or a place in
the earlier state's last years; a Wikidata statement is shown only when the maps agree, or when it is on
the state's own item and the two states' Wikidata dates meet within 10 years. A state that first appears
on land another state keeps (a secession) is listed under that state's "After". Each entry says which of
the two it comes from; a click jumps to that state in its year. Round 7 rules: on Cliopatria a holder that did not hold the land two years before is passed over for the one
that did (Gran Colombia's army in Upper Peru in 1824 is not Bolivia's predecessor); an end that is only a
remnant's (under 5% of what the state held ten years before: the Holy Roman Empire's last minor states of 1806)
has no successor from the maps; a change of regime (one state takes 90% of the land) lists beside it only
Wikidata's successors and break-aways (not Saint-Domingue after the Kingdom of France); a state with a shape of
its own needs 8% of the land in its own shape, not only through its parts; when Wikidata names a predecessor
whose end meets the state's beginning, holders the maps name later than that are left out (the maps draw the
state late: the County of Lippe, not the Holy Roman Empire, preceded the Principality); when Wikidata confirms
the state going on across the change of map source in 1886, a colony the second source draws apart is not a
successor (Portugal, not Angola); a Wikidata target whose namesake on the maps was then a part of a third state
is not linked to it and is named by an English alias that names a state (the Republic of China of 1912, not
"Taiwan"); and a state that came out of another and went back into it says so (Pro-Swedish Poland). 1551 of
1579 territories have an entry (1451 links from Wikidata, 3642 from the maps). Known weak spots: a conquest
by a state that first appears on the conquered land reads as a break-away (the Turkish beyliks under the
Byzantine Empire); a name used by both map sources for different states (Vietnam of 1802 to 1885 and of 1976)
has one list; Egypt's predecessor in 1886 is Cliopatria's "British Africa". "Today this is" and, for one of today's countries, "In <year> this was" are measured in the
browser by overlap at sample points, and are approximate.

## State context and event write-ups

Round 9. A click on a state or empire adds collapsible sections under its description: At a glance,
Population, Government & parties, Religion, Leaders, Movements, Discoveries (`js/context.js`, loaded only on a
click from `data/context/<state>.json`, about 9.5 MB in all). Built by `tools/context/` from:

- Population: HYDE 3.2.1 (5 arc-minute grids summed over each state's shape in each year, interpolated between
  the HYDE steps) and the Maddison Project 2023 where a state is close to one of today's countries. Every
  figure is labelled an estimate with its range and source. Not shown: states under 2,500 km², HYDE-only
  figures before 1000 or for states under 100,000 km², very thin densities before 1800, and figures where two
  sources differ more than twofold.
- Government form, official and majority religion, ruling and major parties, leaders: Wikidata statements with
  dates (P122, P140, P3075, P102 and the offices of head of state and government), plus dated hand entries in
  `tools/curated/context/`. A ruling party is named only for a holder in office the whole year, and none during
  cohabitation or for directorial systems.
- Movements: only the hand-written list `tools/curated/context/movements.json` (Wikidata's were too loose).
- Discoveries and inventions: 99 hand-placed ones and Wikidata items with a dated place of discovery or a
  dated workplace of the one discoverer (`tools/context/build_discoveries.py`), shown on the map as the event
  type "Inventions and scientific discoveries" (a ringed dot). The telephone of 1876 is in the United States;
  Gutenberg's press of about 1450 in Mainz, in the Holy Roman Empire.

Spot checks of 50 random values per field, after the rules above, found 1 wrong value in 50 (2%) for
government, party, religion, population and discoveries and none for movements. Coverage per field and era
is in `tools/cache/context/coverage.json` when built; thin before 1000 (population and government) and for
parties before 1900.

Event write-ups (`data/writeups/*.json.gz`, gzipped per event block, about 19 MB, loaded when an event is
opened): 232 hand-written ones (`tools/curated/writeups/t1/`, 2 to 5 paragraphs from two or more fetched
sources each, marked "AI-written", with their sources and the points where sources disagree), and lead
excerpts of the event's English Wikipedia article for the rest (labelled "From Wikipedia", with a link and the
CC BY-SA licence; from the CirrusSearch dump of 22 November 2026). Events with neither say "No detailed source
found for this event." The work queue for more hand-written ones is `tools/curated/writeups/queue.json`.

## Known limits

- Borders: 1886 to 2019 come from CShapes 2.0, one map per year as on 1 July. 3400 BC to 1885 come from
  Cliopatria: a map is stored for each of the 508 years in which the map changes, and every other year
  uses the latest one before it. These are approximate (a state is redrawn every few years, in antiquity
  every few decades). Outlines keep the detail of the sources (simplified to about 1.3 km, coordinates to
  0.001 degrees); the sources themselves generalise inland borders to several kilometres, so a border looks
  angular, not blocky, when you zoom far in. Coasts are sharper than that: the sea is drawn above the
  territories from Natural Earth's 1:10m coastline.
- Peoples without a state, and states Cliopatria lacks, are filled in from the nearest earlier
  historical-basemaps sketch map, drawn pale and without outlines, with italic names. At world zoom they are
  merged into 41 named regions ("Great Plains", "Amazonia and the Guianas"); the peoples themselves appear
  from zoom 3.4. The sketch maps reuse outlines across centuries. `tools/curated/underlay.json` dates or
  renames 40 of the 2,180 names by hand, and `tools/build_underlay_spans.py` limits a name to its Wikidata
  years where the linked item has dates: 484 names are linked to an item, 108 of those have a date, and
  18 were drawn outside those dates and are now cut to them. For most peoples Wikidata has no dates, so
  anachronisms remain. 33 regions that the nearest sketch map lacks are borrowed from another sketch map
  for a documented span of years (Celtic and Germanic peoples, Irish kingdoms, Picts, Sarmatians, Arab
  tribes, Saharan peoples, Rajput states, Gujarat, Spanish Louisiana, Rupert's Land, Quebec, New South Wales,
  the Greek cities of 480 to 405 BC, the Dacians, the Muisca, Travancore):
  the outline is that map's, nothing is drawn by hand, and the panel says which map it comes from. Still blank
  because no source has an outline: most of Germania between the Elbe and the Vistula, Khandesh around 1450,
  Odisha around 1450, the Río de la Plata coast around 1700. (A borrowed region
  whose name equals a Cliopatria state's name of that year is skipped as already drawn: that is why Athens
  stayed blank in 440 BC, with Cliopatria's "Greek City-States" elsewhere; it is now borrowed under another
  name.) Three states that no source draws, or that Cliopatria merges into another, are drawn from OpenHistoricalMap
  (public domain, `tools/curated/ohm_patches.json`): the Malwa Sultanate (1401 to 1561, only where no source draws
  a state), the Dominion of Canada (1867 to 1885, as a part of the British Empire) and Portuguese Goa (1543 to
  1763). `tools/curated/clio_dates.json` re-dates or renames 16 single Cliopatria shapes that outlive their
  state or carry a later name (Khwarezm after 1221, France and Germany in 1870 to 1872, Tang in 907 to 910,
  Mitanni, Great Moravia before 833, Hoysala after 1346, Congress Poland). Known source errors are listed in
  `tools/curated/map_notes.json` (42 notes) and shown in the panel of the territory concerned; three rows
  that Cliopatria files under a wrong name are renamed (`tools/curated/names.json`: "Assyrian Egypt" for the
  whole Assyrian Empire of 650 to 616 BC, "Ptolemaic Kingdom" for Alexander's conquests of 331 to 324 BC,
  "Western Jin" for the Eastern Jin after 317).
- 1886 to 2019 shows recognised borders. Wartime occupation is an overlay (`tools/curated/occupations.json`,
  `tools/build_occupations.py`): the occupied country keeps its own colour, made faint, under diagonal lines in
  the occupier's colour, and the year panel lists the occupiers, each with a swatch of its lines. 39 dated rows
  are whole countries (17 with both years confirmed by Wikidata): Poland, Norway, Denmark, the Low Countries,
  Greece, Yugoslavia, the Baltic states, the Philippines, the Dutch East Indies, Malaya, Burma and others in
  1939 to 1945; Belgium, Serbia, Romania in 1914 to 1918. Where only a part was occupied, the part is cut from
  Cliopatria, which has one outline per calendar year of everything Germany or Japan held: the occupied zone of
  France (1940 to 1942; all of France after), the occupied west of the Soviet Union (1942 to 1944), the occupied
  parts of China (1938 to 1945), northern France and western Russia in 1915 to 1918 (24 parts). Manchukuo is
  OpenHistoricalMap's outline. Limits: Cliopatria does not say which day of a year an outline stands for, and a
  front moved within a year (the 1942 outline is the front before the summer offensive towards Stalingrad; the
  1941 outline predates the invasion of the Soviet Union, so 1941 shows only the Baltic states); its outlines are
  coarse (tens of kilometres); Romania in 1916 to 1918 and Italy in 1943 to 1945 are not cut to the occupied
  part; no source found has the front lines themselves.
- Colonies carry the name they had at the time (`tools/curated/cshapes_names.json`) and their ruler comes
  from a curated table of 176 dated rules (`tools/curated/dependency_owners.json`), written from general
  knowledge and not checked against a dataset.
- Inside the United States the eleven seceded states are filled in the Confederacy's colour from the day of
  each ordinance of secession until 26 May 1865; the border states and Union-held areas are not drawn apart.
- **Licences:** CShapes 2.0 is CC BY-NC-SA (non-commercial). NC sources must be cleared or replaced
  before ads are added to this site (see CREDITS.md). Cliopatria is CC BY 4.0.
- US state borders come from the Newberry atlas from 1783. For 1763 to 1783 the thirteen colonies are
  drawn from their 1783 outlines and marked approximate.
- Events come from Wikidata and follow Wikipedia's coverage: strong for Europe and North America, thin
  for much of Africa, Oceania, Central and Southeast Asia and the distant past. Dates and places can be
  wrong or missing. `data/meta.json` has the full region-by-era table and the share of events placed in a
  modern country.
- Events that Wikidata dates outside the war it files them under are detached from the war or marked
  "doubtful date" (`data/meta.json`, `consistency`).
- Rulers need a start date on Wikidata ("position held" or "noble title" with a start); many early and
  minor rulers have none and are missing. For the 150 most significant states on the maps a ruler is known
  for 62.0% of their map years on average; `data/rulers/coverage.json` has the figure per state. Only heads
  of state and of government are listed, plus the party leaders of one-party states, labelled as such (the
  Soviet Union, China, Poland, East Germany, Vietnam, Cuba). The Holy Roman Empire lists its kings and
  emperors only, from a curated list of 43 reigns from 936 to 1806. Curated lists also cover the Ilkhans, the
  khans of the Golden Horde, the Durrani shahs, the main Parthian kings (approximate) and the Maratha
  Chhatrapatis; 291 of the 321 curated reigns have both years confirmed by Wikidata, the rest are tagged
  "curated, unverified". Still empty: the Maya and Sumerian city-states (Wikidata has dated holders only for
  single cities such as Tikal, which are not territories on the maps), Elam, Champa.
- Year-article sentences are Wikipedia text (CC BY-SA 4.0), shown with a link to the year article. The
  27,564 entries whose date nothing but the year article confirms are tagged "unverified" and ranked last.
  Their type comes from keyword rules (`tools/classify.py`), rewritten in round 5. Judged strictly by one
  reader, a sample of 150 under the old rules had 18 wrong types and 30 left as the general "Event" although
  a specific type applies (48 in 150). Two fresh samples of 150 under the new rules had 15 wrong and 12
  general (27 in 150), and after one more round of rules 8 wrong and 13 general (21 in 150); the last small
  round of rules after that is unmeasured. In round 6 another reader judged a fresh sample of 150 (rules
  unchanged) more strictly: 17 wrong and 27 left general (44 in 150). In round 7 a fresh strict sample under
  the old rules had 21 wrong and 26 general (47 in 150); the rules were rewritten from it and from a second
  sample (a scientific paper is science, a coup is a revolt, a law or a ban is politics, a church office is
  religion, a fire or stampede with deaths is a disaster, a ruler's title must belong to the one who dies, a
  sentence about someone dying is a death, "Muslim" alone is not religious news), and a third fresh sample of
  150, not looked at before, had 15 wrong and 23 general (38 in 150). A sentence that only repeats a verified event of the same year (it
  links to that event, or it has the same day and names) is dropped: 920 were. A sentence that reports a
  ruler taking office on the day of that ruler's event (round 6: also when it is not worded as a succession,
  "Cleopatra declares her son co-ruler as Ptolemy XV Caesarion") only confirms the event: 1,911 were. Two events in one year about the same Wikipedia article are merged (59), and a death
  beside the killing it was ("Death of Julius Caesar", "assassination of Julius Caesar") is merged into it (40).
- Archaeological cultures and early sites carry approximate dates ("c."), sometimes only a century.
- Curated text (decades, state descriptions, period events) is written from general knowledge and tagged
  "curated"; entries whose year Wikidata does not confirm are tagged "curated, unverified".
- The flat map is the default because borders are easier to read; the globe is one tap away. Both were
  checked only in headless Chromium with software rendering, not yet on real phones. No relief or paper
  texture is drawn (no hillshade source was evaluated); the map has a faint vignette only.
- Births and deaths (the 12 most notable per year) are off by default; turn them on under "Event types".
- `tools/audit.py` checks 1,376 hand-written well-known facts (who held a city in a given year; dates of
  events and reigns; successions; empire memberships; occupations; who was in office; "top five of the year
  must include" checks; and, from round 9, 134 context facts: population ranges, forms of government, ruling
  parties, religions, movements and where discoveries were made); 1,364 pass. One context failure: HYDE gives
  the French Consulate of 1801 36.2 million against a checked range of 24 to 34 million. The other 11 failures are listed in `data/audit.json`: all are map points
  where the border source is wrong, late or blank (three of them blank in every source) (see the map notes); no check was removed or
  loosened, and the six checks that were themselves corrected say so in `tools/audit/facts.txt`.
