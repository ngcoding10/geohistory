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

## Software and fonts
- **MapLibre GL JS** 5.23.0, BSD 3-Clause licence, `vendor/maplibre/LICENSE.txt`. https://maplibre.org/
- **Noto Sans** (Regular, Italic) map label glyphs, SIL Open Font License 1.1, `fonts/LICENSE-OFL.txt`.
  https://notofonts.github.io/
- **fuzzy.js**, the shared typo-tolerant search from `ngcoding10/backend-combination`, copied unchanged.

## Not used, and why
- **CShapes 2.0** (state borders by date, 1886 to 2019): licensed CC BY-NC-SA 4.0. The non-commercial
  term would conflict with the planned ads on these sites, so it is not included in v1.
- **Wikipedia text and summaries**: the API is heavily rate-limited from the build machine, and Wikidata
  descriptions were enough for one-line summaries. The app links to Wikipedia instead.
