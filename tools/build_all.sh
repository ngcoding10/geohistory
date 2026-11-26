#!/usr/bin/env bash
# Rebuild all data from scratch (downloads are cached in tools/cache/, so reruns are fast and polite).
set -euo pipefail
cd "$(dirname "$0")"
python3 fetch_sources.py      # border snapshots, Natural Earth, Newberry AHCB
python3 build_borders.py      # data/borders/*, data/powers.json, data/base/*
python3 build_us.py           # data/us/states.json
python3 build_cshapes.py      # data/cshapes/* (dated borders 1886-2019)
python3 fetch_events.py       # Wikidata events -> tools/cache/events_raw.json (slow the first time)
python3 link_wikidata.py      # data/entities.json
python3 build_events.py       # data/events/*, data/search.json, data/meta.json
python3 build_history.py      # data/history/ruledby.json
python3 check_glyphs.py       # every label character has a font file
python3 build_version.py      # js/data-version.js
