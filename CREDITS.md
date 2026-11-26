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

### State borders for every year, 1700 to 1885: Cliopatria
- **What:** polygons of about 1,600 political entities from 3400 BC to 2024, each valid for a range of years,
  with the empire a polity belongs to and its Wikipedia and Wikidata ids. GeoHistory uses the rows that
  overlap 1700 to 1885 (2,356 shapes).
- **Source:** Seshat Global History Databank, *Cliopatria: a geospatial database of world-wide political
  entities from 3400BCE to 2024CE*, https://github.com/Seshat-Global-History-Databank/cliopatria,
  Scientific Data (2025), https://doi.org/10.1038/s41597-025-04516-9 ; releases on Zenodo,
  https://zenodo.org/records/13363121
- **Licence:** Creative Commons Attribution 4.0 (CC BY 4.0), as stated on the Zenodo record (checked
  26 November 2026). Commercial use is allowed with attribution.
- **Changes we made:** geometry simplified and rounded; one map per year from the rows valid in that year;
  the aggregate rows in brackets, such as "(Spanish Empire)", are used only to name the ruling power of
  their members; territories without a state are filled in from the nearest earlier historical-basemaps
  snapshot and labelled as such (`tools/build_clio.py`). The derived files are in `data/clio/`.
- **Caveat from the source:** "these maps reflect only one version of the territory held by past polities";
  a polity is redrawn only every few years, so a border change can show a year or two late or early.

### State borders by date, 1886 to 2019: CShapes 2.0 (non-commercial licence)
- **What:** borders of states and dependent territories with exact start and end dates.
- **Source:** Schvitz, Rüegger, Girardin, Cederman, Weidmann and Gleditsch, *Mapping the International
  System, 1886-2019: The CShapes 2.0 Dataset*, Journal of Conflict Resolution (2022).
  https://icr.ethz.ch/data/cshapes/
- **Licence:** Creative Commons Attribution-NonCommercial-ShareAlike 4.0 (CC BY-NC-SA 4.0). The derived
  files in `data/cshapes/` are shared under the same licence.
- **Changes we made:** geometry simplified, one map per year as of 1 July, display names for renamed states
  (`tools/curated/cshapes_names.json`), rulers of dependencies from the world snapshots or from
  `tools/curated/dependency_owners.json` (curated, marked unverified in the app) (`tools/build_cshapes.py`).

### Independent states list: Gleditsch and Ward
- **What:** start and end dates of independence for each state code, used to tell states from dependencies.
- **Source:** Kristian S. Gleditsch and Michael D. Ward, *A revised list of independent states since the
  Congress of Vienna* (1999), http://ksgleditsch.com/data/iisystem.dat (free academic data; cited here).

### Coastlines and today's countries: Natural Earth
- **What:** 1:50m land and admin-0 countries.
- **Source:** https://www.naturalearthdata.com/ (via https://github.com/nvkelso/natural-earth-vector)
- **Licence:** public domain. "Made with Natural Earth."

### Events, descriptions and links: Wikidata
- **What:** wars, battles, sieges, revolts, treaties, declarations of independence, states founded and
  dissolved, monarchs taking office, disasters, epidemics, discoveries and other notable events, with
  dates, coordinates, countries, locations, participants and English Wikipedia titles; descriptions,
  dates and capitals for linked territories.
- **Source:** Wikidata Query Service, https://query.wikidata.org/ (`tools/fetch_events.py`,
  `tools/link_wikidata.py`)
- **Licence:** CC0 1.0 (public domain dedication). Links in the app go to the English Wikipedia articles;
  no Wikipedia text is copied.

### Curated American Revolution events
- `tools/supplement_events.json`: 76 events from 1763 to 1789, written for GeoHistory and checked against
  the Wikipedia article linked from each entry. They add day, approximate place and colony where
  Wikidata lacks them. Same licence as the app code.

### Wikipedia year articles (CC BY-SA 4.0)
- The "Events" sections of English Wikipedia's year articles ("1776", "44 BC") are read by
  `tools/fetch_yearpages.py` (the plain wikitext endpoint, one page every 1.5 seconds, resumable). No
  sentence text is copied. For each bullet the first three linked articles are looked up on Wikidata, and
  the bullet becomes an event only when one of them is dated to that year (within one); the event is named
  by that article and credited to the year article. Text from Wikipedia is © Wikipedia contributors,
  CC BY-SA 4.0.

### Curated files (written for GeoHistory, `tools/curated/`)
Written from general knowledge, conservatively, and checked by `tools/build_curated.py` and
`tools/build_changes.py` against the Wikidata item of the article each entry names. The app tags them
"curated", or "curated, unverified" when Wikidata has no matching date.
- `events/*.json`: 380 events in 17 periods (fall of the Roman Republic to the fall of the USSR); 366
  match Wikidata by year. `decades.json`: one summary per decade from 1500 (53; 49 fully verified).
  `polities.json`: 181 short descriptions of major historical states (177 with every year verified).
- `territory_changes.json`: 81 dated border changes before 1886 (70 match). `event_overrides.json`: hand
  corrections to single Wikidata dates, each with a source and a note shown in the app.
  `dependency_owners.json`: rulers of 1886-2019 dependencies (unverified). `cshapes_names.json`: era names
  of renamed states. `centuries.json`: a short "state of the world" per century (narrative, unverified).
  Plus `tools/supplement_events.json` (American Revolution, hand-checked against the linked articles).

## Software and fonts
- **MapLibre GL JS** 5.23.0, BSD 3-Clause licence, `vendor/maplibre/LICENSE.txt`. https://maplibre.org/
- **Noto Sans** (Regular, Italic) map label glyphs, SIL Open Font License 1.1, `fonts/LICENSE-OFL.txt`.
  https://notofonts.github.io/
- **fuzzy.js**, the shared typo-tolerant search from `ngcoding10/backend-combination`, copied unchanged.

## Not used, and why
- **Wikipedia text and summaries**: the API is heavily rate-limited from the build machine, and Wikidata
  descriptions were enough for one-line summaries. The app links to Wikipedia instead.

## Non-commercial licences: clear or replace before ads
CShapes 2.0 is licensed CC BY-NC-SA 4.0. **Every NC-licensed source listed here must be cleared with its
authors or replaced before ads are added to this site.**
