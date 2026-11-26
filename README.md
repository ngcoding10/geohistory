# GeoHistory

A world history map. Type a year (1776, 44 BC, 4 July 1776) and the map shows who ruled where, the
largest powers, and the wars, battles, treaties and other events of that year. Click or search a
territory to see what happened there that year and in the years around it.

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

Steps (see `tools/build_all.sh`): download the border sources; simplify borders; build US states, colonial
counties, the CShapes years and the Cliopatria years; query Wikidata (events, rulers, the deep pass, the
famous-items pass, the per-region passes, places for events without coordinates: a few thousand queries,
one at a time, all cached); read Wikipedia's year articles; link territories to Wikidata; check the curated
files against Wikidata; place every event and write the event files, search index and `data/meta.json`;
build timelines; run the audit; write `js/data-version.js` (a hash of `data/`, used to version data URLs).

Curated text lives in `tools/curated/`: period supplements (`events/*.json`), decade summaries, state
descriptions, dated border changes and a few hand corrections. Every entry names the Wikipedia article it
is about and carries a `verified` flag set by `tools/build_curated.py` when Wikidata has the same year.
`tools/supplement_events.json` is a small hand-checked list of American Revolution events (1763 to 1789),
each with a source link. Sources and licences: [CREDITS.md](CREDITS.md).

Test: `NODE_PATH=$(npm root -g) node tools/e2e.cjs` (uses the globally installed Playwright; starts its
own `python3 -m http.server`).

## How it fits with the other apps

The house rules (storage key prefix `geohistory.`, the shared typo-tolerant search `js/fuzzy.js`, copied
unchanged) come from [ngcoding10/backend-combination](https://github.com/ngcoding10/backend-combination):
see `docs/STANDARD.md` and `HANDOFF.md` there. Version 1 has no backend, sign-in, ads or analytics. A
later "save bookmarks and notes" feature would add the shared `core.js` with the data prefix `geo_`.

## Known limits

- Borders: 1886 to 2019 come from CShapes 2.0, one map per year as on 1 July. 3400 BC to 1885 come from
  Cliopatria: a map is stored for each of the 469 years in which its data changes, and every other year
  uses the latest one before it. These are approximate (a state is redrawn every few years, in antiquity
  every few decades; peoples without a state, and states Cliopatria lacks, are filled in from the nearest
  earlier historical-basemaps sketch map and can be out of date). Before 3400 BC there are only the
  sketch-map snapshots, and the badge on the map says which one you see. Known source errors are listed
  in `tools/curated/map_notes.json` and shown in the panel of the territory concerned. Rulers of colonies in 1886-2019 can lag a change by a few years.
- **Licences:** CShapes 2.0 is CC BY-NC-SA (non-commercial). NC sources must be cleared or replaced
  before ads are added to this site (see CREDITS.md). Cliopatria is CC BY 4.0.
- Borders before about 1500 are rough, and all borders are simplified (about 1 to 3 km).
- US state borders come from the Newberry atlas from 1783. For 1763 to 1783 the thirteen colonies are
  drawn from their 1783 outlines and marked approximate.
- Events come from Wikidata and follow Wikipedia's coverage: strong for Europe and North America, thin
  for much of Africa, Oceania, Central and Southeast Asia and the distant past. Dates and places can be
  wrong or missing. `data/meta.json` has the full region-by-era table and the share of events placed in a
  modern country.
- Events that Wikidata dates outside the war it files them under are detached from the war or marked
  "doubtful date" (`data/meta.json`, `consistency`).
- Rulers need a start date on Wikidata ("position held" or "noble title" with a start); many early and
  minor rulers have none and are missing.
- Archaeological cultures and early sites carry approximate dates ("c."), sometimes only a century.
- Curated text (decades, state descriptions, period events) is written from general knowledge and tagged
  "curated"; entries whose year Wikidata does not confirm are tagged "curated, unverified".
- The flat map is the default because borders are easier to read; the globe is one tap away. Both were
  checked only in headless Chromium with software rendering, not yet on real phones.
- Births and deaths (the 12 most notable per year) are off by default; turn them on under "Event types".
- `tools/audit.py` checks 682 hand-written well-known facts spread over every region and era; 665 pass.
  The 17 failures are listed in `data/audit.json` (source-map errors, coastal points that fall outside
  simplified polygons, naming differences, and a few real gaps on Wikidata).
