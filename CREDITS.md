# Sources, licences and credits

GeoHistory ships only processed files under `data/`. They are rebuilt by the scripts in `tools/`
(`tools/build_all.sh`), which download the raw sources into `tools/cache/` (not committed).

## Data

### World borders by year: historical-basemaps
- **What:** 54 world snapshots, from 123,000 BC to AD 2010, with the properties NAME, SUBJECTO (ruling
  power), PARTOF and BORDERPRECISION.
- **Source:** André Ourednik and contributors, *Historical boundaries of world countries and cultural
  regions*, https://github.com/aourednik/historical-basemaps
- **Licence:** GNU General Public License v3.0. The full licence text is kept with the derived files in
  `data/borders/LICENSE.txt`.
- **Changes we made:** geometry simplified (Douglas-Peucker, 0.03 degrees) and rounded to 0.01 degrees,
  properties renamed, a polity table, rough areas, label points, largest powers and changes between
  snapshots added (`tools/build_borders.py`). Ruling-power spellings that mean the same power (for
  example "UK" and "United Kingdom") share one map colour; names are shown as the source gives them.
- **Caveat from the source:** "work in progress: verify the maps by comparison to other sources before
  using in academic work."

### US states and territories since 1783: Atlas of Historical County Boundaries
- **What:** US state and territory boundaries with start and end dates (generalised 0.01 degree file),
  1783 to 2000, and the text describing each change.
- **Source:** John H. Long et al., *Atlas of Historical County Boundaries*, Dr. William M. Scholl Center
  for American History and Culture, The Newberry Library, Chicago.
  https://publications.newberry.org/ahcb/
- **Licence:** the download page (checked 25 November 2026) says the data "is readily available to
  download to be consulted, reviewed, and reused for any lawful purpose, commercial or non-commercial,
  without licensing or permission fees to the library", and that the older Creative Commons notice inside
  some downloaded files "can be ignored".
- **Changes we made:** geometry simplified and rounded (`tools/build_us.py`). For 1763 to 1783, which
  the file does not cover, the app reuses each state's first (1783) outline for the thirteen colonies
  and marks those outlines as approximate.

### State borders, 3400 BC to 1885: Cliopatria
- **What:** polygons of about 1,600 political entities from 3400 BC to 2024, each valid for a range of years,
  with the empire a polity belongs to and its Wikipedia and Wikidata ids. GeoHistory uses the rows that
  overlap 3400 BC to 1885 (10,037 shapes).
- **Source:** Seshat Global History Databank, *Cliopatria: a geospatial database of world-wide political
  entities from 3400BCE to 2024CE*, https://github.com/Seshat-Global-History-Databank/cliopatria,
  Scientific Data (2025), https://doi.org/10.1038/s41597-025-04516-9 ; releases on Zenodo,
  https://zenodo.org/records/13363121
- **Licence:** Creative Commons Attribution 4.0 (CC BY 4.0), as stated on the Zenodo record (checked
  26 November 2026). Commercial use is allowed with attribution.
- **Changes we made:** geometry simplified (Douglas-Peucker, 0.012 degrees) and rounded to 0.001 degrees, rings stored as
  delta-encoded strings (`tools/geo.py`); one map for each year in which the list of valid rows changes;
  the aggregate rows in brackets, such as "(Spanish Empire)", are used only to name the ruling power of
  their members, and group labels such as "(Warring States China)" are not treated as a ruler; territories
  without a Cliopatria state are filled in from the nearest earlier historical-basemaps snapshot and labelled
  as such; a few names are respelled, and three rows that the source files under a wrong name for some years are renamed
  (`tools/curated/names.json`: "Assyrian Egypt", "Ptolemaic Kingdom" for 331 to 324 BC, "Western Jin" after 317);
  the member-of field is also used to group the parts of an empire (`tools/build_empires.py`) (`tools/build_clio.py`). The derived files are in `data/clio/`.
- **Caveat from the source:** "these maps reflect only one version of the territory held by past polities";
  a polity is redrawn only every few years (every few decades in antiquity), so a border change can show
  some years late or early. Errors we know of are in `tools/curated/map_notes.json`.

### State borders by date, 1886 to 2019: CShapes 2.0 (non-commercial licence)
- **What:** borders of states and dependent territories with exact start and end dates.
- **Source:** Schvitz, Rüegger, Girardin, Cederman, Weidmann and Gleditsch, *Mapping the International
  System, 1886-2019: The CShapes 2.0 Dataset*, Journal of Conflict Resolution (2022).
  https://icr.ethz.ch/data/cshapes/
- **Licence:** Creative Commons Attribution-NonCommercial-ShareAlike 4.0 (CC BY-NC-SA 4.0). The derived
  files in `data/cshapes/` are shared under the same licence.
- **Changes we made:** geometry simplified (0.012 degrees) and stored as encoded strings, one map per year as of 1 July, display names for renamed states
  (`tools/curated/cshapes_names.json`), rulers of dependencies from the world snapshots or from
  `tools/curated/dependency_owners.json` (curated, marked unverified in the app) (`tools/build_cshapes.py`).

### Independent states list: Gleditsch and Ward
- **What:** start and end dates of independence for each state code, used to tell states from dependencies.
- **Source:** Kristian S. Gleditsch and Michael D. Ward, *A revised list of independent states since the
  Congress of Vienna* (1999), http://ksgleditsch.com/data/iisystem.dat (free academic data; cited here).

### Coastlines, lakes and today's countries: Natural Earth
- **What:** the 1:10m ocean polygon (drawn above the territories, so every state meets the sea along the same
  coastline), the larger 1:50m lakes, and 1:50m admin-0 countries. Simplified to about 300 m and cut into
  30-degree cells (`tools/build_sea.py`).
- **Source:** https://www.naturalearthdata.com/ (via https://github.com/nvkelso/natural-earth-vector)
- **Licence:** public domain. "Made with Natural Earth."

### Outlines of occupied areas: Cliopatria's yearly outlines and OpenHistoricalMap
- **Cliopatria** (see above, CC BY 4.0) also has, for the years of the two world wars, one outline per
  calendar year of everything a power held (German Empire 1915 to 1918, Nazi Germany 1940 to 1944, Empire of
  Japan 1938 to 1945). `tools/build_occupations.py` cuts that outline to the country concerned as CShapes
  draws it on 1 July (France, the Soviet Union, Russia, China) and stores the part in `data/occupations/`
  (24 parts). **Changes we made:** the cut is done along horizontal lines 0.04 degrees apart, so the part
  follows both sources to about 4 km; parts under 15,000 km² (slivers where the two sources' borders differ)
  are dropped. Cliopatria does not say which day of the year an outline stands for.
- **OpenHistoricalMap**: one dated boundary relation, Manchukuo (relation 2885965, 1932 to 1945), from
  https://www.openhistoricalmap.org/ through its Overpass API (fetched 26 November 2026). Public domain
  (CC0 1.0), the project's default for its data; the relation carries no other licence tag. Member ways are
  joined into a ring, simplified (0.015 degrees) and rounded to 0.01 degrees (`data/occupation_shapes.json`).
- **OpenHistoricalMap, states the border sources lack** (`tools/curated/ohm_patches.json`, fetched 26 November
  2026, same licence): the Malwa Sultanate (relation 2847908, drawn 1401 to 1561 where no source draws a state),
  the Dominion of Canada (relations 2831017, 2831027, 2831026, 2831033, 2831052; 1867 to 1885, as a part of the
  British Empire) and Portuguese Goa (relation 2965457, 1543 to 1763). Same processing as above; they are added to
  the Cliopatria years by `tools/build_clio.py` and their panel names the relation. Searched and not used: OHM's
  Viceroyalty of New Spain of 1697 to 1704 (it includes the Philippines and the far north, which would paint the
  Spanish colour over land Cliopatria leaves to its peoples) and Governorate General of Brazil (1549 to 1621, it
  overlaps Cliopatria's Spanish shape only in part). No OHM relation was found for the Gajapati kingdom, the Río de
  la Plata around 1700, the Germanic peoples around AD 100, the Maratha state of 1680, the Durrani empire, the
  Palmyrene empire, the kingdom of Dahomey or the Edetani.
- **Also searched** (26 November 2026, about 20 minutes) for a dataset of front lines or occupation zones:
  OpenHistoricalMap has the German civil administrations of 1941 to 1944 (Reichskommissariat Ostland and
  Ukraine, the Generalgouvernement, the military administration in Belgium and northern France), which
  Cliopatria's outlines make unnecessary, but no front line, no demarcation line in France (its "État
  français" relations cover all of France) and nothing for occupied China or for 1914 to 1918 in France.
  Zenodo and GitHub repository search gave no dataset; Wikimedia Commons map data did not answer
  (rate-limited); data.gouv.fr was not reachable from the build machine.

### Events, descriptions and links: Wikidata
- **What:** wars, battles, sieges, revolts, treaties, declarations of independence, states founded and
  dissolved, rulers taking office, documents, spaceflights, organisations, archaeological cultures, disasters, epidemics, discoveries and other notable events, with
  dates, coordinates, countries, locations, participants and English Wikipedia titles; descriptions,
  dates and capitals for linked territories.
- **Source:** Wikidata Query Service, https://query.wikidata.org/ (`tools/fetch_events.py`,
  `fetch_extra.py`, `fetch_rulers.py`, `fetch_famous.py`, `fetch_regions.py`, `fetch_places.py`,
  `tools/link_wikidata.py`)
- **Licence:** CC0 1.0 (public domain dedication). Links in the app go to the English Wikipedia articles.

### Flags: Wikidata and Wikimedia Commons
- **What:** the flag of each state by date (Wikidata's flag image, P41, with its start and end time
  qualifiers; flag items, P163, for the adoption date of an undated image; coats of arms, P94, for former states
  without a flag), queried by `tools/build_flags.py`; and the flag images themselves from Wikimedia Commons.
  Wikidata is CC0. `tools/curated/flags.json` (written for GeoHistory, each row with a source article) replaces
  or drops Wikidata's flag where it is wrong or silent.
- **Images:** the Commons files named in `data/flags/index.json` (field `f`: file name and licence class, and
  the author for files that are not public domain), rendered to PNG (from the original SVG with headless
  Chromium where Commons served it, else Wikimedia's own 330-pixel rendering), scaled down and framed for the
  badges (`data/flags/s*.png`) and the panel (`data/flags/b/*.png`). The panel links every flag to its
  Commons page and names its licence and author.
- **Licences, by class** (from each file's Commons page, `LicenseShortName`): of the 492 flag images, 433 public
  domain, 55 CC BY-SA, 3 "Attribution", 1 OGL Oman; of the 202 emblems shown in panels, 74 public domain, 110
  CC BY-SA, 16 CC BY, 2 "Attribution". Most national flags are public domain (works of governments, or too
  simple for copyright); many historical reconstructions on Commons are the drawer's own work under CC BY-SA:
  those keep that licence, with the author named in the panel and in `data/flags/index.json`. Not cleared for
  reuse outside this site beyond what each licence allows. Flags are shown as historical facts; a flag shown is
  not an endorsement (the swastika flag of 1935 to 1945 is shown for Germany as its national flag of the time).
- **Fill colours:** today's flags (Wikidata P41 of each country with an ISO 3166 code, P297), from the same
  images; the colours are measured, not copied.

### Curated American Revolution events
- `tools/supplement_events.json`: 76 events from 1763 to 1789, written for GeoHistory and checked against
  the Wikipedia article linked from each entry. They add day, approximate place and colony where
  Wikidata lacks them. Same licence as the app code.

### Wikipedia year articles (text under CC BY-SA 4.0)
- The "Events" sections of English Wikipedia's year articles ("1776", "44 BC") are read by
  `tools/fetch_yearpages.py` (the plain wikitext endpoint, one page every 1.5 seconds, resumable) and turned
  into events by `tools/build_yearpages.py`.
- **Text that is copied:** the first sentence of a bullet, with wiki markup, links and references removed
  and long sentences cut for list labels. This text is © Wikipedia contributors and licensed
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); the authors are listed in the history of
  the year article, which every such event links to ("Text from Wikipedia's article for this year"). The
  sentences in `data/events/*.json` (fields `d` and `l` of events marked `wx`) and in `data/timelines/`
  stay under CC BY-SA 4.0: anyone reusing them must credit Wikipedia and keep that licence.
- **Verified entries:** a bullet becomes a verified event only when one of its first three linked articles
  is dated to that year (within one) on Wikidata; the event is named by that article.
- **Unverified entries:** other bullets are kept only when the cleaned text is a complete sentence and is
  not about sport or entertainment (`tools/build_yearpages.py`). They are tagged "unverified" in the app
  and ranked below everything else. Their place on the map is the first linked article with coordinates.
- Event types for both kinds come from keyword rules (`tools/classify.py`).

### Curated files (written for GeoHistory, `tools/curated/`)
Written from general knowledge, conservatively, and checked by `tools/build_curated.py` and
`tools/build_changes.py` against the Wikidata item of the article each entry names. The app tags them
"curated", or "curated, unverified" when Wikidata has no matching date.
- `events/*.json`: 498 events in 19 files: 17 periods from the fall of the Roman Republic to the fall of the
  USSR, early history of thinly recorded regions and Central Asia, and three well-known events that have no
  date on Wikidata; 445 match Wikidata by year (approximate entries within 50 years). `decades.json`: one
  summary per decade from 1500 (53; 50 fully verified). `polities.json`: 264 short descriptions of
  historical states (259 with every year verified; 227 have a name that is on the maps).
- `rulers.json`: 321 ruler terms in 41 lists for major states whose rulers Wikidata does not file under the
  state on the map (Qin, Han, Sui, Tang, Song, Yuan, Ming and Qing emperors, Rashidun and Umayyad caliphs,
  Tokugawa shoguns, Qajar shahs, Achaemenid kings, Mongol great khans, the first Capetian kings, the kings and
  emperors of the Holy Roman Empire, the Ilkhans, the khans of the Golden Horde, the Durrani shahs, the main
  Parthian kings, the Maratha Chhatrapatis, and the party leaders of the Soviet Union, Poland and East
  Germany, labelled as such). `tools/build_rulers.py` compares both years of each term with the offices and
  the year of death on the Wikidata item of the linked article: 291 are confirmed and tagged "curated", 30 are
  tagged "curated, unverified".
  `ruler_map.json`: which Wikidata jurisdictions and offices belong to which territories on the map (content
  comes from Wikidata). `names.json`: display names and aliases of territories. `map_notes.json`: 30 notes on
  known errors of the border sources, shown in the territory panel. `headlines.json`: the defining event of
  24 famous years, used only for ranking.
- `famous_include.json`: titles of well-known Wikidata items that the class filters miss (content comes
  from Wikidata). `aliases.json`: extra search names for 11 events.
- `territory_changes.json`: 81 dated border changes before 1886 (70 match). `event_overrides.json`: hand
  corrections to single Wikidata dates, each with a source and a note shown in the app.
  `dependency_owners.json`: rulers of 1886-2019 dependencies (unverified). `cshapes_names.json`: era names
  of renamed states. `centuries.json`: a short "state of the world" per century (narrative, unverified).
  Plus `tools/supplement_events.json` (American Revolution, hand-checked against the linked articles).

### Empires, occupations, before and after (written for GeoHistory, checked against Wikidata)
- `tools/curated/empires.json`: the sovereign powers and 106 dated memberships (dominions, vassals, personal
  unions, and parts that no source draws), each with the Wikipedia article that supports it. Further memberships
  are read from Cliopatria's member-of field and from the CShapes dependencies. `tools/build_empires.py` marks a
  membership verified when the Wikidata item of the part names an item of the empire as its country (P17), as
  what it is part of (P361), as its administrative parent (P131), owner (P127) or jurisdiction (P1001).
- `tools/curated/occupations.json`: 39 dated occupations and wartime annexations of whole countries (17 with
  both years confirmed by Wikidata; 38 re-tint an existing CShapes outline, Manchukuo is OpenHistoricalMap's),
  and three "areas" that give 24 occupied parts of countries from Cliopatria (see above). The dates are the
  commonly cited ones from the Wikipedia article in each row, and a row is verified when the Wikidata item of
  that article has the same start and end years.
- `data/succession.json` ("Before" and "After"): Wikidata's replaces / replaced by and follows / followed by
  statements (CC0), and a comparison of the yearly maps (`tools/build_succession.py`).
- `tools/curated/underlay.json` now also lists regions borrowed from one sketch map for the years another lacks
  them, each with the article that documents the years; `tools/curated/underlay_auto.json` is generated from
  Wikidata dates (`tools/build_underlay_spans.py`).

## Software and fonts
- **MapLibre GL JS** 5.23.0, BSD 3-Clause licence, `vendor/maplibre/LICENSE.txt`. https://maplibre.org/
- **Noto Sans** (Regular, Italic) map label glyphs, SIL Open Font License 1.1, `fonts/LICENSE-OFL.txt`.
  https://notofonts.github.io/
- **Alegreya** and **Alegreya SC** by Juan Pablo del Peral (Huerta Tipográfica), SIL Open Font License 1.1,
  `fonts/LICENSE-Alegreya-OFL.txt`; files from the `@fontsource/alegreya` and `@fontsource/alegreya-sc` packages.
  Used for headings (`fonts/web/`) and, drawn into MapLibre's glyph format by `tools/make_glyphs.cjs`, for the
  map labels: "Atlas Serif Regular" is Alegreya SC Medium (lower case as small capitals), "Atlas Serif Italic"
  is Alegreya Italic. https://github.com/huertatipografica/Alegreya
- **fuzzy.js**, the shared typo-tolerant search from `ngcoding10/backend-combination`, copied unchanged.

## Not used, and why
- **Wikipedia article summaries**: the API is heavily rate-limited from the build machine. Only single
  sentences from year articles are used (see above); the app links to Wikipedia for everything else.

## Non-commercial licences: clear or replace before ads
CShapes 2.0 is licensed CC BY-NC-SA 4.0. **Every NC-licensed source listed here must be cleared with its
authors or replaced before ads are added to this site.**
