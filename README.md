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

Steps: download the border snapshots, Natural Earth and Newberry files; simplify borders; build US
states; query Wikidata for events (slow the first time: a few hundred queries, one at a time); link
territories to Wikidata; place every event and write the event files, search index and `data/meta.json`;
check label fonts; write `js/data-version.js` (a hash of `data/`, used to version data URLs).

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

- From 1886 to 2019 borders come from CShapes 2.0, one map per year as on 1 July. Outside that span
  borders are snapshots (54 maps from 123,000 BC to AD 2010): other years show the nearest earlier map,
  and the badge on the map says which. Rulers of colonies in 1886-2019 can lag a change by a few years.
- **Licences:** CShapes 2.0 is CC BY-NC-SA (non-commercial). NC sources must be cleared or replaced
  before ads are added to this site (see CREDITS.md).
- Borders before about 1500 are rough, and all borders are simplified (about 1 to 3 km).
- US state borders come from the Newberry atlas from 1783. For 1763 to 1783 the thirteen colonies are
  drawn from their 1783 outlines and marked approximate.
- Events come from Wikidata and follow Wikipedia's coverage: strong for Europe and North America, thin
  for much of Africa, Asia and the distant past. Dates and places can be wrong or missing.
- Rulers are monarchs only (from Wikidata position-held dates); presidents and prime ministers are not
  included yet.
- The flat map is the default because borders are easier to read; the globe is one tap away. Both were
  checked only in headless Chromium with software rendering, not yet on real phones.
- Births and deaths (about 11,000, the 12 most notable per year) are off by default; turn them on under
  "Event types".
- Event coverage is uneven by region: before 1500 there is almost nothing for North America, Oceania,
  Southeast Asia and sub-Saharan Africa, and about a fifth of events cannot be placed in a modern country.
  `data/meta.json` has the full region-by-era table.
- Wikipedia year articles are fetched very slowly (the API throttles the build machine); only a few have
  been read so far. Re-run `tools/fetch_yearpages.py` to continue.
- `tools/audit.py` checks 354 well-known facts; failures are listed in `data/audit.json`. Known source map
  errors (for example Constantinople shown as Ottoman on the 1400 map) are explained as dated changes.
