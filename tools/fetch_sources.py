"""Step 1a: download the raw geographic sources into tools/cache/ (skips anything already cached).

  - aourednik/historical-basemaps: index.json, LICENSE and every world_<year>.geojson snapshot (GPL-3.0)
  - Natural Earth 50m land and admin-0 countries (public domain), via the natural-earth-vector repo
  - Newberry Library Atlas of Historical County Boundaries: US state and territory boundaries over
    time, generalised at 0.01 degree (free for any lawful use)
"""
import json
from common import fetch, log

HB = 'https://raw.githubusercontent.com/aourednik/historical-basemaps/master/'
NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'
AHCB = 'https://publications.newberry.org/ahcb/downloads/gis/US_AtlasHCB_StateTerr_Gen01.zip'


def hb_index():
    return json.loads(fetch(HB + 'index.json'))


def main():
    idx = hb_index()
    fetch(HB + 'LICENSE')
    for y in idx['years']:
        log('snapshot', y['year'], y['filename'])
        fetch(HB + 'geojson/' + y['filename'], min_gap=0.5)
    for f in ('ne_50m_land.geojson', 'ne_50m_admin_0_countries.geojson'):
        log('natural earth', f)
        fetch(NE + f)
    log('newberry ahcb')
    fetch(AHCB, ext='.zip', timeout=300)
    log('done')


if __name__ == '__main__':
    main()
