// Point-in-polygon for GeoJSON (Multi)Polygons, with a bounding-box check first.

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function polysOf(g) {
  if (!g) return [];
  return g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
}

/** Build a tester for a list of GeoJSON geometries: (lon, lat) => boolean. */
export function makeAreaTest(geoms) {
  const polys = [];
  for (const g of geoms) {
    for (const p of polysOf(g)) {
      let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
      for (const [x, y] of p[0]) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
      polys.push({ p, bb: [w, s, e, n] });
    }
  }
  return (x, y) => {
    for (const { p, bb } of polys) {
      if (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3]) continue;
      if (inRing(x, y, p[0]) && !p.slice(1).some((h) => inRing(x, y, h))) return true;
    }
    return false;
  };
}

export function bboxOf(geoms) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const g of geoms) for (const p of polysOf(g)) for (const [x, y] of p[0]) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return w === Infinity ? null : [w, s, e, n];
}
