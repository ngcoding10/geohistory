"""Small pure-Python geometry helpers: simplification, area, point in polygon, label points."""
import math

R = 6371.0088  # km


def ring_area_km2(ring):
    """Spherical area of a lon/lat ring (absolute, km^2)."""
    n = len(ring)
    if n < 4:
        return 0.0
    total = 0.0
    for i in range(n - 1):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[i + 1][0], ring[i + 1][1]
        total += math.radians(x2 - x1) * (2 + math.sin(math.radians(y1)) + math.sin(math.radians(y2)))
    return abs(total * R * R / 2.0)


def polygon_area_km2(poly):
    if not poly:
        return 0.0
    a = ring_area_km2(poly[0])
    for h in poly[1:]:
        a -= ring_area_km2(h)
    return max(a, 0.0)


def polys_of(geom):
    if not geom:
        return []
    if geom['type'] == 'Polygon':
        return [geom['coordinates']]
    if geom['type'] == 'MultiPolygon':
        return geom['coordinates']
    if geom['type'] == 'GeometryCollection':
        out = []
        for g in geom['geometries']:
            out += polys_of(g)
        return out
    return []


def _dp(pts, tol2):
    """Douglas-Peucker on a list of points (iterative)."""
    n = len(pts)
    if n < 3:
        return pts
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a][0], pts[a][1]
        bx, by = pts[b][0], pts[b][1]
        dx, dy = bx - ax, by - ay
        dd = dx * dx + dy * dy
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i][0], pts[i][1]
            if dd == 0:
                d = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = ((px - ax) * dx + (py - ay) * dy) / dd
                t = 0 if t < 0 else 1 if t > 1 else t
                qx, qy = ax + t * dx, ay + t * dy
                d = (px - qx) ** 2 + (py - qy) ** 2
            if d > best:
                best, bi = d, i
        if best > tol2 and bi > 0:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


def simplify_ring(ring, tol, decimals):
    if len(ring) < 4:
        return None
    # split closed ring into two halves so DP keeps a sensible shape
    pts = [(round(p[0], 6), round(p[1], 6)) for p in ring]
    mid = len(pts) // 2
    s = _dp(pts[:mid + 1], tol * tol)[:-1] + _dp(pts[mid:], tol * tol)
    out = []
    for x, y in s:
        q = [round(x, decimals), round(y, decimals)]
        if not out or out[-1] != q:
            out.append(q)
    if out and out[0] != out[-1]:
        out.append(out[0])
    if len(out) < 4:
        return None
    return out


def simplify_geom(geom, tol=0.03, decimals=2, min_area_km2=30.0):
    """Simplify and quantise a (Multi)Polygon. Drops slivers and tiny islands but always keeps the
    largest piece. Returns a GeoJSON geometry or None."""
    polys = polys_of(geom)
    out = []
    for poly in polys:
        if not poly:
            continue
        outer = simplify_ring(poly[0], tol, decimals)
        if not outer:
            continue
        holes = []
        for h in poly[1:]:
            sh = simplify_ring(h, tol, decimals)
            if sh and ring_area_km2(sh) > min_area_km2 * 3:
                holes.append(sh)
        out.append([outer] + holes)
    if not out:
        # keep something for tiny islands: a rounded copy of the largest original outer ring
        best = max(polys, key=lambda p: ring_area_km2(p[0]) if p else 0, default=None)
        if not best:
            return None
        ring = []
        for p in best[0]:
            q = [round(p[0], 3), round(p[1], 3)]
            if not ring or ring[-1] != q:
                ring.append(q)
        if len(ring) < 4:
            return None
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        out = [[ring]]
    areas = [polygon_area_km2(p) for p in out]
    big = max(areas)
    kept = [p for p, a in zip(out, areas) if a >= min_area_km2 or a == big]
    if len(kept) == 1:
        return {'type': 'Polygon', 'coordinates': kept[0]}
    return {'type': 'MultiPolygon', 'coordinates': kept}


def bbox_of(geom):
    xs, ys = [], []
    for poly in polys_of(geom):
        for p in poly[0]:
            xs.append(p[0]); ys.append(p[1])
    if not xs:
        return None
    return [min(xs), min(ys), max(xs), max(ys)]


def point_in_ring(x, y, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y):
            xint = (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi
            if x < xint:
                inside = not inside
        j = i
    return inside


def point_in_polys(x, y, polys):
    for poly in polys:
        if point_in_ring(x, y, poly[0]) and not any(point_in_ring(x, y, h) for h in poly[1:]):
            return True
    return False


class PolyIndex:
    """Grid index for point-in-polygon lookups over many features."""

    def __init__(self, items, cell=5.0):
        # items: list of (key, geometry)
        self.cell = cell
        self.grid = {}
        self.items = []
        for key, geom in items:
            polys = polys_of(geom)
            bb = bbox_of(geom)
            if not bb:
                continue
            idx = len(self.items)
            self.items.append((key, polys, bb))
            for gx in range(int(math.floor(bb[0] / cell)), int(math.floor(bb[2] / cell)) + 1):
                for gy in range(int(math.floor(bb[1] / cell)), int(math.floor(bb[3] / cell)) + 1):
                    self.grid.setdefault((gx, gy), []).append(idx)

    def lookup(self, x, y):
        cands = self.grid.get((int(math.floor(x / self.cell)), int(math.floor(y / self.cell))), [])
        for i in cands:
            key, polys, bb = self.items[i]
            if bb[0] <= x <= bb[2] and bb[1] <= y <= bb[3] and point_in_polys(x, y, polys):
                return key
        return None

    def nearest(self, x, y, max_deg=1.0):
        """Containing feature, else the closest by vertex distance within max_deg (coastal points)."""
        k = self.lookup(x, y)
        if k is not None:
            return k
        best, bk = max_deg * max_deg, None
        c = self.cell
        for gx in range(int(math.floor((x - max_deg) / c)), int(math.floor((x + max_deg) / c)) + 1):
            for gy in range(int(math.floor((y - max_deg) / c)), int(math.floor((y + max_deg) / c)) + 1):
                for i in self.grid.get((gx, gy), []):
                    key, polys, bb = self.items[i]
                    if x < bb[0] - max_deg or x > bb[2] + max_deg or y < bb[1] - max_deg or y > bb[3] + max_deg:
                        continue
                    for poly in polys:
                        for p in poly[0]:
                            d = (p[0] - x) ** 2 + (p[1] - y) ** 2
                            if d < best:
                                best, bk = d, key
        return bk


def _seg_d2(x, y, ax, ay, bx, by, kx):
    """Squared distance in degrees of latitude from a point to a segment (kx = cos(latitude))."""
    dx, dy = (bx - ax) * kx, by - ay
    px, py = (x - ax) * kx, y - ay
    dd = dx * dx + dy * dy
    t = 0.0 if dd == 0 else max(0.0, min(1.0, (px * dx + py * dy) / dd))
    return (px - t * dx) ** 2 + (py - t * dy) ** 2


def near_index(index, x, y, km=8.0, accept=None):
    """Containing feature of a PolyIndex, else the feature whose outline passes within `km` of the point
    (true distance to the nearest edge). For coastal cities: simplified outlines cut a few km off coasts.
    `accept(key)` can restrict which features are considered."""
    k = index.lookup(x, y)
    if k is not None and (accept is None or accept(k)):
        return k
    deg = km / 111.2
    kx = math.cos(math.radians(y))
    padx = deg / max(kx, 0.05)
    best, bk = deg * deg, None
    c = index.cell
    seen = set()
    for gx in range(int(math.floor((x - padx) / c)), int(math.floor((x + padx) / c)) + 1):
        for gy in range(int(math.floor((y - deg) / c)), int(math.floor((y + deg) / c)) + 1):
            for i in index.grid.get((gx, gy), []):
                if i in seen:
                    continue
                seen.add(i)
                key, polys, bb = index.items[i]
                if x < bb[0] - padx or x > bb[2] + padx or y < bb[1] - deg or y > bb[3] + deg:
                    continue
                if accept is not None and not accept(key):
                    continue
                for poly in polys:
                    for ring in poly:
                        for j in range(len(ring) - 1):
                            a, b = ring[j], ring[j + 1]
                            if (a[0] < x - padx and b[0] < x - padx) or (a[0] > x + padx and b[0] > x + padx) or \
                               (a[1] < y - deg and b[1] < y - deg) or (a[1] > y + deg and b[1] > y + deg):
                                continue
                            d = _seg_d2(x, y, a[0], a[1], b[0], b[1], kx)
                            if d < best:
                                best, bk = d, key
    return bk


def label_point(geom):
    """A point inside the largest polygon, near its visual middle (widest horizontal span)."""
    polys = polys_of(geom)
    if not polys:
        return None
    poly = max(polys, key=polygon_area_km2)
    ring = poly[0]
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    y0, y1 = min(ys), max(ys)
    best = None
    for k in range(1, 12):
        y = y0 + (y1 - y0) * k / 12
        xints = []
        rings = poly
        for r in rings:
            for i in range(len(r) - 1):
                (xa, ya), (xb, yb) = r[i][:2], r[i + 1][:2]
                if (ya > y) != (yb > y):
                    xints.append(xa + (y - ya) * (xb - xa) / (yb - ya))
        xints.sort()
        for i in range(0, len(xints) - 1, 2):
            w = (xints[i + 1] - xints[i]) * math.cos(math.radians(y))
            # prefer wide spans near the vertical middle
            score = w * (1 - 0.6 * abs(k - 6) / 6)
            if best is None or score > best[0]:
                best = (score, (xints[i] + xints[i + 1]) / 2, y)
    if not best:
        return [round(sum(xs) / len(xs), 2), round(sum(ys) / len(ys), 2)]
    return [round(best[1], 2), round(best[2], 2)]


# ---- compact geometry: rings as delta-encoded strings (the "encoded polyline" format, x then y) ----
PREC = 1000   # 0.001 degree, about 110 m


def _enc_num(v, out):
    v = ~(v << 1) if v < 0 else (v << 1)
    while v >= 0x20:
        out.append(chr((0x20 | (v & 0x1f)) + 63))
        v >>= 5
    out.append(chr(v + 63))


def encode_ring(ring, prec=PREC):
    out = []
    px = py = 0
    for p in ring:
        x, y = round(p[0] * prec), round(p[1] * prec)
        _enc_num(x - px, out)
        _enc_num(y - py, out)
        px, py = x, y
    return ''.join(out)


def decode_ring(s, prec=PREC):
    out = []
    x = y = 0
    i, n = 0, len(s)
    while i < n:
        for k in (0, 1):
            shift = res = 0
            while True:
                b = ord(s[i]) - 63
                i += 1
                res |= (b & 0x1f) << shift
                shift += 5
                if b < 0x20:
                    break
            d = ~(res >> 1) if res & 1 else res >> 1
            if k == 0:
                x += d
            else:
                y += d
        out.append([x / prec, y / prec])
    return out


def encode_geom(g, prec=PREC):
    """{'type', 'coordinates'} -> {'type', 'enc'} (rings as strings)."""
    if g['type'] == 'Polygon':
        return {'type': 'Polygon', 'enc': [encode_ring(r, prec) for r in g['coordinates']]}
    return {'type': 'MultiPolygon', 'enc': [[encode_ring(r, prec) for r in p] for p in g['coordinates']]}


def decode_geom(g, prec=PREC):
    if 'coordinates' in g:
        return g
    if g['type'] == 'Polygon':
        return {'type': 'Polygon', 'coordinates': [decode_ring(r, prec) for r in g['enc']]}
    return {'type': 'MultiPolygon', 'coordinates': [[decode_ring(r, prec) for r in p] for p in g['enc']]}
