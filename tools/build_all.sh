#!/usr/bin/env bash
# Rebuild all data from scratch (downloads are cached in tools/cache/, so reruns are fast and polite).
set -euo pipefail
cd "$(dirname "$0")"
python3 fetch_sources.py      # border snapshots, Natural Earth, Newberry AHCB, CShapes, Cliopatria
python3 build_borders.py      # data/borders/*, data/powers.json, data/base/modern.json
python3 build_sea.py          # data/base/sea.json (Natural Earth ocean and lakes: the coastline every state is cut to)
python3 build_us.py           # data/us/states.json
python3 build_colonies.py     # data/us/colonies.json (colonial counties before 1783)
python3 build_cshapes.py      # data/cshapes/* (dated borders 1886-2019)
python3 build_clio.py --no-auto # data/clio/* (borders 3400 BC-1885 from Cliopatria, one map per change year): first pass
python3 fetch_events.py       # Wikidata events -> tools/cache/events_raw.json (slow the first time)
python3 fetch_rulers.py       # heads of state and government -> tools/cache/rulers_raw.json
python3 fetch_extra.py        # deep pass, births/deaths, foundings -> tools/cache/extra_raw.json
python3 fetch_famous.py       # famous items by other dates, periods, well-known rulers, aliases
python3 fetch_regions.py      # per-region passes for thin regions, cultures, small states
python3 fetch_places.py       # locations for events without coordinates
python3 fetch_yearpages.py 3000 # Wikipedia year articles (resumable; about 1.5 s per page)
python3 build_yearpages.py     # year-article bullets -> dated events and unverified one-sentence entries
python3 link_wikidata.py      # data/entities.json
python3 build_underlay_spans.py # tools/curated/underlay_auto.json: sketch-map names limited to their Wikidata years
python3 build_clio.py         # second pass, with those spans
python3 link_wikidata.py      # again: the years each name is drawn have changed
python3 build_empires.py      # data/empires.json (empires and their parts, checked against Wikidata)
python3 build_occupations.py  # data/occupations.json (dated occupations on existing outlines)
python3 build_succession.py   # data/succession.json (before and after: Wikidata and the maps)
python3 build_curated.py      # check tools/curated/* against Wikidata; data/decades.json, data/polities.json
python3 build_rulers.py       # offices without a country, curated ruler lists checked against Wikidata
python3 build_events.py       # data/events/*, data/search.json, data/meta.json
python3 build_history.py      # data/history/ruledby.json
python3 context/states.py            # state context (round 9): the states and their shapes, map by map
python3 context/fetch_hyde.py        # HYDE 3.2.1 population grids (range reads from the 5.3 GB archive; cached)
python3 context/build_population.py  # population of every state and power over the map's own outlines
python3 context/fetch_context.py     # Wikidata: government, religion, population, parties, movements
python3 context/fetch_discoveries.py # Wikidata: discoveries and inventions with their places
python3 context/build_discoveries.py # data/context/discoveries.json (placed on the map of their year)
python3 context/build_context.py     # data/context/* (time slices per state and empire)
python3 context/merge_discoveries.py # inventions into the event files (type 'invention')
python3 context/fetch_cirrus.py 1    # English Wikipedia text from the CirrusSearch dump (about 41 GB streamed; cached)
python3 context/writeup_queue.py     # tools/curated/writeups/queue.json (events by notability, tiers)
python3 context/build_writeups.py    # data/writeups/* (written write-ups and Wikipedia excerpts, gzipped)
python3 build_timelines.py    # data/timelines/* (one per territory and modern country)
python3 ruler_coverage.py 150 # data/rulers/coverage.json (share of map years with a known ruler)
python3 build_changes.py      # data/changes.json (curated, checked against Wikidata)
python3 build_flags.py        # data/flags/* (flags by year, badge sheets, fill colours; needs Pillow and Playwright)
python3 audit.py              # data/audit.json (fact checks)
python3 check_glyphs.py       # every label character has a font file
python3 build_version.py      # js/data-version.js
