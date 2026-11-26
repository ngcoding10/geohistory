"""Minimal shapefile (polygon) + dBASE reader, standard library only."""
import struct


def read_dbf(buf):
    n, hlen, rlen = struct.unpack('<xxxxIHH', buf[:12])
    fields = []
    pos = 32
    while buf[pos] != 0x0D:
        name = buf[pos:pos + 11].split(b'\0')[0].decode('latin-1')
        ftype = chr(buf[pos + 11])
        flen = buf[pos + 16]
        fields.append((name, ftype, flen))
        pos += 32
    rows = []
    for i in range(n):
        off = hlen + i * rlen
        rec = buf[off:off + rlen]
        p = 1
        row = {}
        for name, ftype, flen in fields:
            raw = rec[p:p + flen]
            p += flen
            try:
                v = raw.decode('utf-8').strip()
            except UnicodeDecodeError:
                v = raw.decode('latin-1').strip()
            if ftype in 'NF':
                try:
                    v = float(v) if v else None
                    if v is not None and v.is_integer():
                        v = int(v)
                except ValueError:
                    v = None
            row[name] = v
        rows.append(row)
    return rows


def _ring_signed_area(r):
    s = 0.0
    for i in range(len(r) - 1):
        s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
    return s / 2


def read_shp(buf):
    """Yields GeoJSON-like geometries (Polygon/MultiPolygon) for each record."""
    pos = 100
    out = []
    while pos < len(buf):
        _, clen = struct.unpack('>ii', buf[pos:pos + 8])
        pos += 8
        content = buf[pos:pos + clen * 2]
        pos += clen * 2
        stype = struct.unpack('<i', content[:4])[0]
        if stype == 0:
            out.append(None)
            continue
        nparts, npts = struct.unpack('<ii', content[36:44])
        parts = struct.unpack('<%di' % nparts, content[44:44 + 4 * nparts])
        ptoff = 44 + 4 * nparts
        pts = struct.unpack('<%dd' % (2 * npts), content[ptoff:ptoff + 16 * npts])
        rings = []
        for k in range(nparts):
            a = parts[k]
            b = parts[k + 1] if k + 1 < nparts else npts
            rings.append([[pts[2 * j], pts[2 * j + 1]] for j in range(a, b)])
        # shapefile outer rings are clockwise (negative signed area in x/y), holes counter-clockwise
        polys = []
        for r in rings:
            if _ring_signed_area(r) <= 0 or not polys:
                polys.append([r[::-1] if _ring_signed_area(r) < 0 else r])
            else:
                polys[-1].append(r[::-1] if _ring_signed_area(r) > 0 else r)
        out.append({'type': 'MultiPolygon', 'coordinates': polys} if len(polys) > 1
                   else {'type': 'Polygon', 'coordinates': polys[0]})
    return out
