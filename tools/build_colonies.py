"""Step 2f: the British North American colonies before 1783, from the Newberry Library's Atlas of Historical
County Boundaries state files (counties and colony-wide units with exact dates, back to the 1600s).

Every county-level unit that existed before 3 September 1783 is kept with its dates and colony. The app
fills each colony's units in one colour, so a colony shows as its organized counties on the chosen date.
Lands not yet organized into counties are left empty: that is what the source records, not a gap in drawing.
Writes data/us/colonies.json.
"""
import io
import os
import zipfile

from common import fetch, write_json, DATA, log
from geo import simplify_geom, label_point, encode_geom

STATES = {'CT': 'Connecticut', 'DE': 'Delaware', 'GA': 'Georgia', 'MD': 'Maryland', 'MA': 'Massachusetts',
          'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NY': 'New York', 'NC': 'North Carolina',
          'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina', 'VA': 'Virginia', 'ME': 'Maine',
          'VT': 'Vermont'}
URL = 'https://publications.newberry.org/ahcb/downloads/gis/{}_AtlasHCB.zip'
END = 17830903


def main():
    from shapefile_min import read_dbf, read_shp
    feats = []
    for code in STATES:
        z = zipfile.ZipFile(io.BytesIO(fetch(URL.format(code), ext='.zip', timeout=900)))
        base = next(n[:-4] for n in z.namelist() if n.endswith('_Historical_Counties.shp'))
        rows = read_dbf(z.read(base + '.dbf'))
        geoms = read_shp(z.read(base + '.shp'))
        n = 0
        for r, g in zip(rows, geoms):
            s = int(r['START_DATE'])
            if not g or s >= END:
                continue
            sg = simplify_geom(g, 0.01, 3, min_area_km2=5)
            if not sg:
                continue
            props = {'n': r['NAME'], 'st': r['STATE'] or code, 's': s, 'e': int(r['END_DATE']),
                     't': r.get('CNTY_TYPE') or '', 'l': label_point(sg)}
            # rings as encoded strings (0.001 degree, as simplified): the file is less than half the size
            feats.append({'type': 'Feature', 'geometry': encode_geom(sg), 'properties': props})
            n += 1
        log(f'{code}: {n} units before 1783')
    size = write_json(os.path.join(DATA, 'us', 'colonies.json'), {'type': 'FeatureCollection', 'features': feats,
                                                                    'states': STATES})
    log(f'colonies: {len(feats)} unit versions, {size // 1024} KB')


if __name__ == '__main__':
    main()
