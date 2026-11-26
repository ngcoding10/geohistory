"""Seas and lakes for the map (data/base/sea.json), from Natural Earth (public domain).

The app draws the ocean polygon above the territories, so every state meets the sea along the same
Natural Earth 1:10m coastline, whatever coastline its own source used. Rings are simplified (about 300 m)
and stored as encoded strings (geo.encode_geom). Lakes are the larger Natural Earth 1:50m lakes.
"""
import json
import os

from common import fetch, write_json, DATA, log
from fetch_sources import NE
from geo import simplify_ring, ring_area_km2, polys_of, encode_geom

TOL = 0.003
TOL_LO = 0.03   # about 3 km: below a pixel up to zoom 2.5


def simp(geom, tol, min_island_km2, min_poly_km2):
    out = []
    for poly in polys_of(geom):
        outer = simplify_ring(poly[0], tol, 3)
        if not outer or ring_area_km2(outer) < min_poly_km2:
            continue
        holes = []
        for h in poly[1:]:
            if ring_area_km2(h) < min_island_km2:
                continue
            sh = simplify_ring(h, tol, 3)
            if sh:
                holes.append(sh)
        out.append([outer] + holes)
    return {'type': 'MultiPolygon', 'coordinates': out}


CELL = 30   # degrees: the ocean is cut into cells so that no polygon has thousands of holes


def clip_ring(ring, w, s, e, n):
    """Sutherland-Hodgman: a closed ring clipped to a rectangle (closed ring, or [] when nothing is left)."""
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    for edge in range(4):
        if not pts:
            return []
        out = []
        if edge == 0:
            inside = lambda p: p[0] >= w
            cut = lambda a, b: [w, a[1] + (b[1] - a[1]) * (w - a[0]) / (b[0] - a[0])]
        elif edge == 1:
            inside = lambda p: p[0] <= e
            cut = lambda a, b: [e, a[1] + (b[1] - a[1]) * (e - a[0]) / (b[0] - a[0])]
        elif edge == 2:
            inside = lambda p: p[1] >= s
            cut = lambda a, b: [a[0] + (b[0] - a[0]) * (s - a[1]) / (b[1] - a[1]), s]
        else:
            inside = lambda p: p[1] <= n
            cut = lambda a, b: [a[0] + (b[0] - a[0]) * (n - a[1]) / (b[1] - a[1]), n]
        prev = pts[-1]
        pin = inside(prev)
        for p in pts:
            cin = inside(p)
            if cin:
                if not pin:
                    out.append(cut(prev, p))
                out.append(p)
            elif pin:
                out.append(cut(prev, p))
            prev, pin = p, cin
        pts = out
    if len(pts) < 3:
        return []
    res = []
    for p in pts:
        q = [round(p[0], 3), round(p[1], 3)]
        if not res or res[-1] != q:
            res.append(q)
    if res[0] != res[-1]:
        res.append(res[0])
    return res if len(res) >= 4 else []


def in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def cut_cells(geom):
    """The (multi)polygon cut into CELL-degree cells. Rings wholly inside a cell are kept as they are."""
    out = []
    boxes = []
    for poly in geom['coordinates']:
        bs = []
        for r in poly:
            xs = [p[0] for p in r]
            ys = [p[1] for p in r]
            bs.append((min(xs), min(ys), max(xs), max(ys)))
        boxes.append(bs)
    for w in range(-180, 180, CELL):
        for s in range(-90, 90, CELL):
            e, n = w + CELL, s + CELL
            cx, cy = w + CELL / 2, s + CELL / 2
            rect = [[w, s], [e, s], [e, n], [w, n], [w, s]]
            for poly, bs in zip(geom['coordinates'], boxes):
                b = bs[0]
                if b[2] <= w or b[0] >= e or b[3] <= s or b[1] >= n:
                    continue
                if b[0] >= w and b[2] <= e and b[1] >= s and b[3] <= n:
                    outer = poly[0]
                else:
                    outer = clip_ring(poly[0], w, s, e, n) or (rect if in_ring(cx, cy, poly[0]) else [])
                if not outer:
                    continue
                holes = []
                land = False
                for r, hb in zip(poly[1:], bs[1:]):
                    if hb[2] <= w or hb[0] >= e or hb[3] <= s or hb[1] >= n:
                        continue
                    if hb[0] >= w and hb[2] <= e and hb[1] >= s and hb[3] <= n:
                        holes.append(r)
                        continue
                    c = clip_ring(r, w, s, e, n)
                    if c:
                        holes.append(c)
                    elif in_ring(cx, cy, r):
                        land = True     # the whole cell lies inside this land mass
                        break
                if not land:
                    out.append([outer] + holes)
    return {'type': 'MultiPolygon', 'coordinates': out}


def main():
    ocean = json.loads(fetch(NE + 'ne_10m_ocean.geojson', timeout=600))
    polys = []
    for f in ocean['features']:
        polys += polys_of(f['geometry'])
    sea = simp({'type': 'MultiPolygon', 'coordinates': polys}, TOL, 1.0, 50)
    sea = cut_cells(sea)
    lakes = json.loads(fetch(NE + 'ne_50m_lakes.geojson'))
    lp = []
    for f in lakes['features']:
        if (f['properties'].get('scalerank') or 0) <= 3:
            lp += polys_of(f['geometry'])
    lk = simp({'type': 'MultiPolygon', 'coordinates': lp}, 0.006, 20, 600)
    # a coarse sea for world zoom, loaded first; the full one is loaded when the map is zoomed in (js/main.js)
    lo = cut_cells(simp({'type': 'MultiPolygon', 'coordinates': polys}, TOL_LO, 40.0, 400))
    lk_lo = simp({'type': 'MultiPolygon', 'coordinates': lp}, 0.03, 200, 3000)
    size_lo = write_json(os.path.join(DATA, 'base', 'sea_lo.json'), {'sea': encode_geom(lo), 'lakes': encode_geom(lk_lo)})
    log(f'sea for world zoom: {size_lo // 1024} KB')
    n = sum(len(r) for p in sea['coordinates'] for r in p)
    size = write_json(os.path.join(DATA, 'base', 'sea.json'), {'sea': encode_geom(sea), 'lakes': encode_geom(lk)})
    log(f'sea: {len(sea["coordinates"])} polygons, {sum(len(p) - 1 for p in sea["coordinates"])} islands and land masses, '
        f'{n} points; {len(lk["coordinates"])} lakes; {size // 1024} KB')


if __name__ == '__main__':
    main()
