// The outlines of the states on one map (called by js/prepare.js). Every edge of every state's outline is
// classed by what lies just outside it:
//   'b'  another state: a border, drawn as one solid black line (the same width everywhere, flags or not)
//   'i'  another part of the same empire: a thin grey line, shown only when zoomed in
//   'o'  no state at all (the sea, or land of peoples or unclaimed): a thin dark line, like the coast
// Edges between pieces of the same state get no line. The test is a point a little outside the middle of each
// edge, so neighbours whose outlines were simplified apart (or overlap a little) still find each other.
// Each line carries the area of its piece at zoom 0 ('pa', square pixels of a 512-pixel world), so the map can
// leave out the outlines of specks that would be smaller than a few pixels on screen.
const EPS = [0.03, 0.1];      // degrees: how far outside an edge to look (again further where nothing was found)
const CELL = 4;               // degrees: the grid the pieces are indexed by

// Shapes are shared by the maps of many years (js/data.js keeps them): the lines of a piece are remembered
// with the pieces around it, and reused while those are the same (the years play without redoing them).
const ids = new WeakMap();
let nextId = 1;
const idOf = (o) => { let v = ids.get(o); if (!v) ids.set(o, (v = nextId++)); return v; };
const memo = new WeakMap();   // piece (its rings array) -> {sig, runs, pa}
export const outlineStats = { pieces: 0, reused: 0 };

const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const mercY = (lat) => { const l = Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180; return (0.5 - Math.log(Math.tan(Math.PI / 4 + l / 2)) / (2 * Math.PI)) * 512; };

/** A piece (polygon with its holes) prepared for fast point tests: its edges sorted into horizontal bands. */
function indexPiece(poly, fi, k, g) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity, ne = 0;
  for (const r of poly) { ne += r.length - 1; for (const p of r) { if (p[0] < w) w = p[0]; if (p[0] > e) e = p[0]; if (p[1] < s) s = p[1]; if (p[1] > n) n = p[1]; } }
  const nb = Math.max(1, Math.min(256, Math.ceil(ne / 12)));
  const bh = (n - s) / nb || 1;
  const bands = Array.from({ length: nb }, () => []);
  const ex = new Float64Array(ne * 4);
  let j = 0;
  for (const r of poly) {
    for (let i = 0; i < r.length - 1; i++, j++) {
      const a = r[i], b = r[i + 1];
      ex[j * 4] = a[0]; ex[j * 4 + 1] = a[1]; ex[j * 4 + 2] = b[0]; ex[j * 4 + 3] = b[1];
      const b0 = Math.max(0, Math.min(nb - 1, Math.floor((Math.min(a[1], b[1]) - s) / bh)));
      const b1 = Math.max(0, Math.min(nb - 1, Math.floor((Math.max(a[1], b[1]) - s) / bh)));
      for (let q = b0; q <= b1; q++) bands[q].push(j);
    }
  }
  return { fi, k, g, poly, bb: [w, s, e, n], bands, bh, nb, ex };
}

function inside(pc, x, y) {
  const [w, s, e, n] = pc.bb;
  if (x < w || x > e || y < s || y > n) return false;
  const band = pc.bands[Math.max(0, Math.min(pc.nb - 1, Math.floor((y - s) / pc.bh)))];
  const ex = pc.ex;
  let c = false;
  for (const j of band) {
    const x1 = ex[j * 4], y1 = ex[j * 4 + 1], x2 = ex[j * 4 + 2], y2 = ex[j * 4 + 3];
    if ((y1 > y) !== (y2 > y) && x < x1 + ((y - y1) * (x2 - x1)) / (y2 - y1)) c = !c;
  }
  return c;
}

/** Line features for the outlines of the states of a prepared document (features need properties k, u, g). */
export function buildOutlines(doc) {
  const pieces = [];
  doc.features.forEach((f, fi) => {
    const p = f.properties;
    if (p.u === 1 || !(p.k >= 0)) return;
    for (const poly of polysOf(f.geometry)) if (poly[0]?.length > 3) pieces.push(indexPiece(poly, fi, p.k, p.g));
  });
  const grid = new Map();
  const cellKey = (cx, cy) => cx * 1000 + cy;
  pieces.forEach((pc, i) => {
    const [w, s, e, n] = pc.bb;
    for (let cx = Math.floor(w / CELL); cx <= Math.floor(e / CELL); cx++) {
      for (let cy = Math.floor(s / CELL); cy <= Math.floor(n / CELL); cy++) {
        const key = cellKey(cx, cy);
        let l = grid.get(key);
        if (!l) grid.set(key, (l = []));
        l.push(i);
      }
    }
  });
  // what is at a point, seen from the piece `self`: 'b', 'i', 'x' (the same state) or null (nothing)
  const what = (self, x, y) => {
    if (x > 180) x -= 360; else if (x < -180) x += 360;
    const l = grid.get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (!l) return null;
    let res = null;
    for (const i of l) {
      const pc = pieces[i];
      if (!inside(pc, x, y)) continue;
      if (pc.k === self.k) { res ||= 'x'; continue; }
      if (pc.g === self.g && self.g != null) { if (res !== 'b') res = 'i'; continue; }
      return 'b';
    }
    return res;
  };
  const out = [];
  // the features again, in the same order as the pieces were indexed
  let pi = 0;
  doc.features.forEach((f, fi) => {
    const p = f.properties;
    if (p.u === 1 || !(p.k >= 0)) return;
    for (const poly of polysOf(f.geometry)) {
      if (!(poly[0]?.length > 3)) continue;
      const self = pieces[pi++];
      // the pieces around this one, and how they relate to it: the lines are the same while these are
      const [w0, s0, e0, n0] = self.bb, pad = EPS[1] + 0.01;
      const padX = pad / Math.max(0.05, Math.cos((Math.max(Math.abs(s0), Math.abs(n0)) * Math.PI) / 180));
      const near = new Set();
      for (let cx = Math.floor((w0 - padX) / CELL); cx <= Math.floor((e0 + padX) / CELL); cx++) {
        for (let cy = Math.floor((s0 - pad) / CELL); cy <= Math.floor((n0 + pad) / CELL); cy++) {
          for (const j of grid.get(cellKey(cx, cy)) || []) near.add(j);
        }
      }
      const sig = [];
      for (const j of near) {
        const o = pieces[j];
        if (o === self || o.bb[0] > e0 + padX || o.bb[2] < w0 - padX || o.bb[1] > n0 + pad || o.bb[3] < s0 - pad) continue;
        sig.push(idOf(o.poly) + (o.k === self.k ? 'x' : o.g === self.g && self.g != null ? 'i' : 'b'));
      }
      const key = sig.sort().join(',') + (w0 < -179.5 || e0 > 179.5 ? '|w' + Math.random() : '');
      outlineStats.pieces++;
      const known = memo.get(poly);
      if (known && known.sig === key) {
        outlineStats.reused++;
        for (const e of ['b', 'i', 'o']) {
          if (known.runs[e].length) out.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: known.runs[e] }, properties: { ol: 1, e, k: -2, pk: p.k, pa: known.pa } });
        }
        continue;
      }
      // the piece's area at zoom 0, in square pixels (Mercator)
      let pa = 0;
      const r0 = poly[0];
      for (let i = 0; i < r0.length - 1; i++) {
        const x1 = (r0[i][0] + 180) / 360 * 512, y1 = mercY(r0[i][1]), x2 = (r0[i + 1][0] + 180) / 360 * 512, y2 = mercY(r0[i + 1][1]);
        pa += x1 * y2 - x2 * y1;
      }
      pa = Math.round(Math.abs(pa / 2) * 1000) / 1000;
      const runs = { b: [], i: [], o: [] };
      poly.forEach((ring, ri) => {
        // which side of the ring is inside the piece: the left for a counter-clockwise outer ring
        let sa = 0;
        for (let i = 0; i < ring.length - 1; i++) sa += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
        const left = (ri === 0) === (sa > 0);
        const cls = [];
        for (let i = 0; i < ring.length - 1; i++) {
          const a = ring[i], b = ring[i + 1];
          const mxp = (a[0] + b[0]) / 2, myp = (a[1] + b[1]) / 2;
          const cos = Math.max(0.05, Math.cos((myp * Math.PI) / 180));
          const dx = (b[0] - a[0]) * cos, dy = b[1] - a[1];
          const len = Math.hypot(dx, dy);
          if (!len) { cls.push(i ? cls[i - 1] : 'x'); continue; }
          // the outward normal: to the right of the direction of travel when the inside is on the left
          const nx = (left ? dy : -dy) / len, ny = (left ? -dx : dx) / len;
          let c = null;
          for (const eps of EPS) {
            c = what(self, mxp + (nx * eps) / cos, myp + ny * eps);
            if (c) break;
          }
          cls.push(c || 'o');
        }
        // runs of edges of one class, as lines (a run through the ring's start is joined up)
        const n = cls.length;
        if (!n) return;
        let start = 0;
        if (cls.every((c) => c === cls[0])) {
          if (cls[0] !== 'x') runs[cls[0]].push(ring);
          return;
        }
        while (cls[start] === cls[(start - 1 + n) % n]) start++;
        let cur = [ring[start]], cc = cls[start];
        for (let s = 0; s < n; s++) {
          const i = (start + s) % n;
          if (cls[i] !== cc) {
            if (cc !== 'x' && cur.length > 1) runs[cc].push(cur);
            cur = [ring[i]]; cc = cls[i];
          }
          cur.push(ring[i + 1]);
        }
        if (cc !== 'x' && cur.length > 1) runs[cc].push(cur);
      });
      memo.set(poly, { sig: key, runs, pa });
      for (const e of ['b', 'i', 'o']) {
        if (runs[e].length) out.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: runs[e] }, properties: { ol: 1, e, k: -2, pk: p.k, pa } });
      }
    }
  });
  return out;
}
