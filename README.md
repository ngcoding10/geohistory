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
timelines; run the audit; write `js/data-version.js` (a hash of `data/`, used to version data URLs).
The map label glyphs in `fonts/Atlas Serif */` are not part of that run: `tools/make_glyphs.cjs` draws them
from the Alegreya fonts in `fonts/src/` with headless Chromium.

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

Test: `NODE_PATH=$(npm root -g) node tools/e2e.cjs` (99 checks; uses the globally installed Playwright; starts its
own `python3 -m http.server`).

## How it fits with the other apps

The house rules (storage key prefix `geohistory.`, the shared typo-tolerant search `js/fuzzy.js`, copied
unchanged) come from [ngcoding10/backend-combination](https://github.com/ngcoding10/backend-combination):
see `docs/STANDARD.md` and `HANDOFF.md` there. Version 1 has no backend, sign-in, ads or analytics. A
later "save bookmarks and notes" feature would add the shared `core.js` with the data prefix `geo_`.

## Empires and their parts

At world zoom an empire is drawn as one power: one colour, one name, no inner borders. Zoom in (past
zoom 3.2) and its parts appear, each with its own name and its own tone of the empire's colour. A click at
world zoom opens the empire with the list of its parts for that year; a click on a part when zoomed in opens
the part, which says "Part of ...". No outline is merged or changed: the inner borders are hidden by the
order in which the map draws them (`js/groups.js`, `js/map.js`).

A part belongs to an empire only in the years a source says so (`tools/build_empires.py`,
`data/empires.json`): 424 dated memberships, of which 216 are confirmed by Wikidata (the part's item names
an item of the empire as its country, as what it is part of, or as its administrative parent).
- 148 come from Cliopatria's member-of field (the Holy Roman Empire and its states, the fiefs of the French
  crown, the Portuguese, Dutch and British possessions before 1886).
- 158 are the CShapes dependencies of 1886 to 2019 with the owners in `tools/curated/dependency_owners.json`,
  and 12 come from the sketch maps.
- 106 are written for GeoHistory in `tools/curated/empires.json`, each with a source article: the British
  dominions until the Statute of Westminster (1931), the Ottoman vassals, personal unions, and 71 parts that
  no source draws (New Spain and Peru, the two halves of Austria-Hungary, the Crown and Lithuania, the Soviet
  republics, the four Mongol khanates of 1260 to 1293). These are listed in the empire's panel and never drawn.
Not merged although the sources colour them alike: Egypt after the British occupation of 1882, the Congo Free
State (Leopold II's own, not Belgium's), occupied countries, Hanover (in personal union with Great Britain but
never part of its empire), and states only partly inside the Holy Roman Empire (the Habsburg Monarchy,
Brandenburg-Prussia).

## Before and after

Every territory panel has "Before" and "After" (`tools/build_succession.py`, `data/succession.json`), one
step only: what Wikidata lists as replaced and replacing (P1365/P1366, P155/P156), and who held the same
land on the yearly map just before the first year a state is drawn and just after the last (measured at
sample points; a holder counts from 15% of them). A state that first appears on land another state keeps
(a secession) is listed under that state's "After". Each entry says which of the two it comes from; a click
jumps to that state in its year. 1562 of 1570 territories have an entry (2973 links from Wikidata, 4231 from
the maps). "Today this is" and, for one of today's countries, "In <year> this was" are measured in the
browser by overlap at sample points, and are approximate.

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
  renames 39 of the 2,176 names by hand, and `tools/build_underlay_spans.py` limits a name to its Wikidata
  years where the linked item has dates: 482 names are linked to an item, 106 of those have a date, and
  18 were drawn outside those dates and are now cut to them. For most peoples Wikidata has no dates, so
  anachronisms remain. 29 regions that the nearest sketch map lacks are borrowed from another sketch map
  for a documented span of years (Celtic and Germanic peoples, Irish kingdoms, Picts, Sarmatians, Arab
  tribes, Saharan peoples, Rajput states, Gujarat, Spanish Louisiana, Rupert's Land, Quebec, New South Wales):
  the outline is that map's, nothing is drawn by hand, and the panel says which map it comes from. Still blank
  because no source has an outline: most of Germania between the Elbe and the Vistula, the Malwa Sultanate
  and Khandesh around 1450, Travancore, the Muisca. Known source errors are listed in
  `tools/curated/map_notes.json` (30 notes) and shown in the panel of the territory concerned; three rows
  that Cliopatria files under a wrong name are renamed (`tools/curated/names.json`: "Assyrian Egypt" for the
  whole Assyrian Empire of 650 to 616 BC, "Ptolemaic Kingdom" for Alexander's conquests of 331 to 324 BC,
  "Western Jin" for the Eastern Jin after 317).
- 1886 to 2019 shows recognised borders. Wartime occupation is an overlay. No dataset of occupation areas is
  used (none of the border sources has one, and no systematic search for another was made in this round), so `tools/curated/occupations.json` lists 38 dated occupations (16 with both
  years confirmed by Wikidata) and the map hatches the existing outline of the occupied country in the
  occupier's colour (Poland, France, Norway, Denmark, the Low Countries, Greece, Yugoslavia, the Baltic states,
  the Philippines, the Dutch East Indies, Malaya, Burma and others in 1939 to 1945; Belgium, Serbia, Romania in
  1914 to 1918). Whole countries only: where only a part was occupied (France before November 1942, Romania)
  the entry says so. Not shown at all, for want of an outline: Manchukuo, the occupied parts of China and of
  the Soviet Union, northern France in 1914 to 1918.
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
  27,842 entries whose date nothing but the year article confirms are tagged "unverified" and ranked last.
  Their type comes from keyword rules (`tools/classify.py`), rewritten in round 5. Judged strictly by one
  reader, a sample of 150 under the old rules had 18 wrong types and 30 left as the general "Event" although
  a specific type applies (48 in 150). Two fresh samples of 150 under the new rules had 15 wrong and 12
  general (27 in 150), and after one more round of rules 8 wrong and 13 general (21 in 150); the last small
  round of rules after that is unmeasured. A sentence that only repeats a verified event of the same year (it
  links to that event, or it has the same day and names) is dropped: 928 were.
- Archaeological cultures and early sites carry approximate dates ("c."), sometimes only a century.
- Curated text (decades, state descriptions, period events) is written from general knowledge and tagged
  "curated"; entries whose year Wikidata does not confirm are tagged "curated, unverified".
- The flat map is the default because borders are easier to read; the globe is one tap away. Both were
  checked only in headless Chromium with software rendering, not yet on real phones. No relief or paper
  texture is drawn (no hillshade source was evaluated); the map has a faint vignette only.
- Births and deaths (the 12 most notable per year) are off by default; turn them on under "Event types".
- `tools/audit.py` checks 1,202 hand-written well-known facts (who held a city in a given year; dates of
  events and reigns; successions; empire memberships; occupations; who was in office; "top five of the year
  must include" checks); 1,181 pass. The 21 failures are listed in `data/audit.json`: all but a few are map
  points where the border source is wrong, late or blank (see the map notes); no check was removed or
  loosened, and the six checks that were themselves corrected say so in `tools/audit/facts.txt`.
