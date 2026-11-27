### Population grids: HYDE 3.2.1
- **What:** gridded population counts (5 arc-minutes) for 4000 BC to 2017 (`popc` grids of the baseline
  scenario, 54 time steps). GeoHistory sums them over the map's own outlines for every state and year
  (`tools/context/build_population.py`), interpolating between time steps at a constant growth rate.
- **Source:** Klein Goldewijk, K., Beusen, A., Doelman, J. and Stehfest, E. (2017), *Anthropogenic land use
  estimates for the Holocene – HYDE 3.2*, Earth System Science Data 9, 927–953; data: DANS Data Station
  Archaeology, https://doi.org/10.17026/DANS-25G-GEZ3
- **Licence:** the repository lists CC0 1.0; the release notes say CC BY 3.0. Credited here either way.
  The newer HYDE 3.3 (Utrecht University, CC BY 4.0) sits behind a bot challenge and was not used.
- **Caveat:** a model estimate. Before 1800 it can differ from published estimates by tens of percent
  (HYDE puts China at 97 million in 1600 where Maddison has 160 million); the app shows every figure it has
  and the range between them, and never one number as exact.

### Population series: Maddison Project Database 2023
- **What:** population by country (in today's borders) from AD 1. Used only where a state on the map holds
  nearly the same people as one of today's countries (HYDE totals within 15%).
- **Source:** Bolt, J. and van Zanden, J. L. (2024), *Maddison style estimates of the evolution of the world
  economy: A new 2023 update*, Journal of Economic Surveys; https://doi.org/10.34894/INZBF2
- **Licence:** Creative Commons Attribution 4.0 (CC BY 4.0).

### State facts: Wikidata
- Forms of government (P122), official religion (P3075), religion (P140), population (P1082 with point in
  time), political parties (P31 political party, P17 country, inception and dissolution), party membership of
  heads of state and government (P102 with dates), movements (social, political, religious, cultural and
  artistic movements with P17 or P495 and a start date), discoveries and inventions (P575, P61, P189, P495,
  P27, P937). CC0.

### Curated context (written for GeoHistory, AI-written and labelled so in the app)
- `tools/curated/context/regimes.json` (which Wikidata item stands for a territory in which years),
  `government.json`, `religion.json`, `parties.json`, `population.json`, `movements.json`,
  `discoveries.json`: written from general knowledge; every entry names the English Wikipedia article it
  follows and is checked against Wikidata where Wikidata has the fact (`verified`).

### Event write-ups
- **Wikipedia excerpts:** the lead (and for the 33,000 most notable events, the opening of the background
  and aftermath sections) of each event's English Wikipedia article, quoted unchanged with a link and the
  revision, from Wikimedia's CirrusSearch dump of 22 November 2026
  (https://dumps.wikimedia.org/other/cirrus_search_index/). Licence: CC BY-SA 4.0; the excerpts are shared
  under the same licence.
- **Written write-ups** (`tools/curated/writeups/t1/`): written for GeoHistory from at least two sources each
  and labelled AI-written in the app. Every source is listed with a link: Wikipedia (CC BY-SA 4.0, summarised
  with attribution), and for facts only (cited, linked, never copied): HISTORY.com (A&E Television
  Networks), The National Archives (UK), Historic Environment Scotland, Historic UK, the Avalon Project
  (Yale Law School), the Internet History Sourcebooks (Fordham University), LacusCurtius (University of
  Chicago; public-domain Loeb translations), the Dictionary of National Biography 1885-1900 on Wikisource
  (public domain).
- Not used because they refuse automated requests from the build's network (HTTP 403): Encyclopaedia
  Britannica, the Oxford Dictionary of National Biography, the Imperial War Museums, the British Museum,
  Royal Museums Greenwich, Smithsonian Magazine, World History Encyclopedia.
