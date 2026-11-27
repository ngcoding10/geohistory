"""Download the HYDE 3.2.1 population-count grids (popc, 5 arc-minutes) for the time steps the maps need.

HYDE 3.2.1 (Klein Goldewijk et al. 2017, Earth System Science Data 9, 927-953), DANS Data Station
Archaeology, https://doi.org/10.17026/DANS-25G-GEZ3 . Licence: the repository gives CC0 1.0; the release
readme says CC BY 3.0. We credit it either way (tools/context/CREDITS-context.md).

The baseline archive is 5.3 GB; only the population-count grids are needed (about 9 MB each, compressed),
so they are read out of the remote zip with HTTP range requests (tools/context/rangezip.py). Each grid is
kept gzipped in tools/cache/context/hyde/popc_<year>.asc.gz (year: astronomical, 0 = 1 BC... HYDE's "0AD").
"""
import gzip
import os
import shutil
import struct
import subprocess
import sys
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import CACHE, log  # noqa: E402
from rangezip import RangeFile  # noqa: E402

URL = 'https://archaeology.datastations.nl/api/access/datafile/5490328'   # HYDE3_2_1-baseline.zip
DIR = os.path.join(CACHE, 'context', 'hyde')
# HYDE time steps the maps need: 1000-year steps BC (the maps start in 3400 BC), 100-year steps to 1700,
# 10-year steps to 2000, and 2010 and 2017 for the last CShapes years
STEPS = [-4000, -3000, -2000, -1000, 0] + list(range(100, 1701, 100)) + list(range(1710, 2001, 10)) + [2010, 2017]


def label(y):
    return f'{-y}BC' if y < 0 else f'{y}AD'


def path(y):
    return os.path.join(DIR, f'popc_{y}.asc.gz')


def extract(z, info, out):
    """The members are compressed with Deflate64, which Python's zipfile cannot read: copy the member's
    compressed bytes into a one-file zip and let Info-ZIP unzip decompress it, gzipping the result."""
    f = z.fp
    f.seek(info.header_offset)
    lh = f.read(30)
    nlen, xlen = struct.unpack('<HH', lh[26:30])
    f.seek(info.header_offset + 30 + nlen + xlen)
    data = f.read(info.compress_size)
    assert len(data) == info.compress_size
    name = b'm.asc'
    dt = 0
    loc = struct.pack('<IHHHHHIIIHH', 0x04034b50, 21, 0, info.compress_type, dt, dt, info.CRC,
                      info.compress_size, info.file_size, len(name), 0) + name
    cen = struct.pack('<IHHHHHHIIIHHHHHII', 0x02014b50, 21, 21, 0, info.compress_type, dt, dt, info.CRC,
                      info.compress_size, info.file_size, len(name), 0, 0, 0, 0, 0, 0) + name
    eocd = struct.pack('<IHHHHIIH', 0x06054b50, 0, 0, 1, 1, len(cen), len(loc) + len(data), 0)
    mini = out + '.zip'
    with open(mini, 'wb') as g:
        g.write(loc)
        g.write(data)
        g.write(cen)
        g.write(eocd)
    with gzip.open(out, 'wb', compresslevel=6) as dst:
        p = subprocess.Popen(['unzip', '-p', mini, 'm.asc'], stdout=subprocess.PIPE)
        shutil.copyfileobj(p.stdout, dst, 1 << 20)
        if p.wait() != 0:
            raise RuntimeError('unzip failed for ' + info.filename)
    os.remove(mini)


def main():
    os.makedirs(DIR, exist_ok=True)
    todo = [y for y in STEPS if not os.path.exists(path(y))]
    if not todo:
        log('HYDE grids: all in the cache')
        return
    z = zipfile.ZipFile(RangeFile(URL))
    names = set(z.namelist())
    for y in todo:
        m = f'baseline/asc/{label(y)}_pop/popc_{label(y)}.asc'
        if m not in names:
            log(f'  missing in the archive: {m}')
            continue
        log(f'  {m}')
        tmp = path(y) + '.tmp'
        extract(z, z.getinfo(m), tmp)
        os.replace(tmp, path(y))
    log(f'HYDE grids: {len(STEPS)} steps in {DIR}')


if __name__ == '__main__':
    main()
