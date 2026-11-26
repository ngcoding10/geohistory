"""Step 2b: US states and territories over time from the Newberry Library's Atlas of Historical
County Boundaries (state/territory file, generalised 0.01 degree). Writes data/us/states.json.

The AHCB state file starts on 3 September 1783 (Treaty of Paris). Earlier years use the colonial
county units from build_colonies.py.
"""
import io
import os
import zipfile

from common import fetch, write_json, DATA, log
from fetch_sources import AHCB
from geo import simplify_geom, label_point, bbox_of
from shapefile_min import read_dbf, read_shp

BASE = 'US_AtlasHCB_StateTerr_Gen01/US_HistStateTerr_Gen01_Shapefile/US_HistStateTerr_Gen01'

# Colonial names (before 4 July 1776) for the thirteen colonies, keyed by AHCB id.
COLONIES = {
    'ct_state': 'Connecticut Colony', 'de_state': 'Delaware Colony (Lower Counties)',
    'ga_state': 'Province of Georgia', 'ma_state': 'Province of Massachusetts Bay',
    'md_state': 'Province of Maryland', 'nc_state': 'Province of North Carolina',
    'nh_state': 'Province of New Hampshire', 'nj_state': 'Province of New Jersey',
    'ny_state': 'Province of New York', 'pa_state': 'Province of Pennsylvania',
    'ri_state': 'Colony of Rhode Island and Providence Plantations', 'sc_state': 'Province of South Carolina',
    'va_state': 'Colony of Virginia',
}
TREATY_1763 = 17630210
INDEPENDENCE = 17760704
TREATY_1783 = 17830903


def main():
    z = zipfile.ZipFile(io.BytesIO(fetch(AHCB, ext='.zip', timeout=300)))
    rows = read_dbf(z.read(BASE + '.dbf'))
    geoms = read_shp(z.read(BASE + '.shp'))
    feats = []
    first = {}
    for r, g in zip(rows, geoms):
        if not g:
            continue
        sg = simplify_geom(g, 0.025, 2, min_area_km2=40)
        if not sg:
            continue
        props = {'id': r['ID'], 'n': r['NAME'], 't': r['TERR_TYPE'], 's': int(r['START_DATE']),
                 'e': int(r['END_DATE']), 'l': label_point(sg)}
        ch = (r.get('CHANGE') or '').strip()
        if ch:
            props['ch'] = ch[:600]
        feats.append({'type': 'Feature', 'geometry': sg, 'properties': props})
        if r['ID'] in COLONIES and int(r['START_DATE']) == TREATY_1783:
            first[r['ID']] = (sg, props)
        if r['ID'] == 'vt_republic' and int(r['START_DATE']) == TREATY_1783:
            first[r['ID']] = (sg, props)
    # before 1783 the colonies come from the county files instead (build_colonies.py)
    size = write_json(os.path.join(DATA, 'us', 'states.json'), {'type': 'FeatureCollection', 'features': feats})
    log(f'us states: {len(feats)} versions, {size // 1024} KB')


if __name__ == '__main__':
    main()
