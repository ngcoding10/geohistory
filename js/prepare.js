// Turns a loaded border snapshot into what the map draws for one year: groups (empires, states, regions of
// peoples), draw slots, colours, and labels (points, and lines across the largest states for spaced lettering).
import { attachGroups, assignSlots, tones, empireName, colorGroups, fillCandidates } from './groups.js';

// today's countries' flag colours (data/flags/colors.json): {p: power key -> ISO, c: ISO -> [first, second]}
let FC = null;
export function setFlagColors(fc) { FC = fc; }
/** The present-day country a power's fill comes from (ISO code), or null. */
export const modernOf = (pk) => FC?.p?.[pk] || null;
import { makeAreaTest } from './geo.js';

const REGION_HUES = ['#d9c08c', '#b4cf9c', '#dab4a0', '#a9cfc6', '#dccb8e', '#c9c0e0', '#bcd3a0', '#e0b7b9', '#a8c6dc', '#d6c4a2'];
const hash = (s) => { let hsh = 0; for (let i = 0; i < s.length; i++) hsh = (hsh * 31 + s.charCodeAt(i)) >>> 0; return hsh; };
const mercY = (lat) => (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (Math.max(-84, Math.min(84, lat)) * Math.PI) / 360));
const unmercY = (y) => (360 / Math.PI) * Math.atan(Math.exp((y * Math.PI) / 180)) - 90;
const BIG = 1300000;

/** A gently curved line across a polygon through its label point, along its long axis when that is not too
 *  steep: {line: [[lon, lat] x 3], len (Mercator degrees)} or null. */
function labelLine(geoms, l) {
  // the polygon that holds the label point (the largest one by construction of the label point)
  let best = null;
  const px = l[0], py = mercY(l[1]);
  for (const g of geoms) {
    for (const poly of (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)) {
      const r = poly[0];
      let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
      for (const p of r) { if (p[0] < w) w = p[0]; if (p[0] > e) e = p[0]; if (p[1] < s) s = p[1]; if (p[1] > n) n = p[1]; }
      if (l[0] < w || l[0] > e || l[1] < s || l[1] > n) continue;
      const size = (e - w) * (n - s);
      if (!best || size > best.size) best = { poly, size };
    }
  }
  if (!best) return null;
  const ring = best.poly[0];
  // long axis (principal component of the outline, in Mercator)
  const step = Math.max(1, Math.floor(ring.length / 400));
  let mx = 0, my = 0, cnt = 0;
  const pts = [];
  for (let i = 0; i < ring.length; i += step) { const x = ring[i][0], y = mercY(ring[i][1]); pts.push([x, y]); mx += x; my += y; cnt++; }
  mx /= cnt; my /= cnt;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  let ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  if (Math.abs(ang) > 0.61 || sxx + syy === 0) ang = 0;          // steeper than 35 degrees: write it level
  const elong = Math.sqrt(Math.max(sxx, syy) / (Math.min(sxx, syy) || 1));
  if (elong < 1.25) ang = 0;                                      // roundish shapes read best level
  const dx = Math.cos(ang), dy = Math.sin(ang);
  // crossings of the axis through the label point with every ring of the polygon
  const ts = [];
  for (const r of best.poly) {
    for (let i = 0; i < r.length - 1; i++) {
      const ax = r[i][0] - px, ay = mercY(r[i][1]) - py, bx = r[i + 1][0] - px, by = mercY(r[i + 1][1]) - py;
      const ca = ax * dy - ay * dx, cb = bx * dy - by * dx;
      if ((ca > 0) === (cb > 0)) continue;
      const f = ca / (ca - cb);
      ts.push((ax + (bx - ax) * f) * dx + (ay + (by - ay) * f) * dy);
    }
  }
  ts.sort((a, b) => a - b);
  let t0 = null, t1 = null;
  for (let i = 0; i + 1 < ts.length; i += 2) if (ts[i] <= 0 && ts[i + 1] >= 0) { t0 = ts[i]; t1 = ts[i + 1]; break; }
  if (t0 == null) return null;
  const len = t1 - t0;
  const a = t0 + len * 0.1, b = t1 - len * 0.1, mid = (a + b) / 2;
  const bulge = len * 0.025;      // a slight arc, bowed towards the pole
  const sgn = l[1] >= 0 ? 1 : -1;
  const pt = (t, off) => [px + t * dx - off * dy * sgn, unmercY(py + t * dy + off * dx * sgn)];
  const line = [];
  for (let i = 0; i <= 8; i++) { const t = a + ((b - a) * i) / 8; const u = (t - mid) / ((b - a) / 2); line.push(pt(t, bulge * (1 - u * u))); }
  return { line, len: (b - a) };
}

/** Prepare a snapshot document for a year. Returns the signature of its empire groups.
 *  `prev`: the label places of the map shown before (doc._lbl of that map). While the years run, a power's
 *  name stays where it was as long as that place is still inside the power, so names do not jump about. */
export function prepareDoc(doc, { emp, powers, year, dark, prev = null }) {
  const { groups, sig } = attachGroups(doc, emp, year);
  doc.groups = groups;
  doc.fy = year;          // the year the flags are drawn for (js/flagfill.js)
  const pols = doc.polities;
  const featsOf = new Map();
  for (const f of doc.features) { const k = f.properties.k; if (!featsOf.has(k)) featsOf.set(k, []); featsOf.get(k).push(f); }
  for (const f of doc.features) { const p = pols[f.properties.k]; f.properties.u = p.under && !p.s ? 1 : 0; }
  const adj = assignSlots(doc, groups, 7);
  doc.adj = adj;
  const colorOf = (key) => powers[key]?.color || '#c9c1b0';
  // each group's power key: what its colour is remembered by from year to year
  const keyOf = (g) => {
    if (g.kind === 'empire') {
      const id = g.key.slice(2);
      const core = g.members.map((k) => pols[k]).find((p) => p.core) || pols[g.members[0]];
      g.id = id;
      return powers[emp.empires[id]?.ck || id] ? (emp.empires[id]?.ck || id) : core.p;
    }
    return pols[g.members[0]].p;
  };
  const prefs = groups.map((g) => {
    if (g.kind === 'region') return null;
    g.pk = keyOf(g);
    g.iso = modernOf(g.pk);
    const core = g.kind === 'empire' ? g.members.map((k) => pols[k]).find((p) => p.core) : null;
    g.carea = core ? Math.max(core.a, g.area * 0.25) : g.area;   // a colonial empire counts a quarter of its colonies
    return fillCandidates(g.pk || g.name, powers[g.pk]?.color, g.iso ? FC.c[g.iso] : null);
  });
  const pick = colorGroups(groups, adj, prefs);
  doc.powerColor = new Map();
  for (const g of groups) {
    if (g.kind === 'region') g.color = REGION_HUES[hash(g.name) % REGION_HUES.length];
    else {
      g.color = pick.get(groups.indexOf(g));
      if (g.pk && !doc.powerColor.has(g.pk)) doc.powerColor.set(g.pk, g.color);
    }
    const tg = tones(g.color, g.name, dark);
    for (const k of g.members) {
      const p = pols[k];
      const multi = g.kind === 'empire' && g.members.length > 1;
      const own = g.kind === 'region' ? tones(colorOf(p.p), p.n, dark).under : multi ? tones(g.color, p.n, dark).part : tg.fill;
      p.color = g.kind === 'region' ? tones(g.color, g.name, dark).under : tg.fill;
      for (const f of featsOf.get(k) || []) {
        Object.assign(f.properties, { c: p.color, c2: own, ce: tg.edge, s: g.slot || 0, g: p.g, in: multi ? 1 : 0 });
      }
    }
  }

  // ---- labels
  const labels = [], lines = [];
  const placed = new Map();
  const text = (p) => p.ln || p.n;
  const point = (t, n, a, p, extra = {}, at = p.l) => labels.push({ type: 'Feature', geometry: { type: 'Point', coordinates: at }, properties: { t, n, a, ...extra } });
  const big = (t, n, a, p) => {
    const geoms = (featsOf.get(pols.indexOf(p)) || []).map((f) => f.geometry);
    let key = t + '|' + n;
    while (placed.has(key)) key += '+';
    let at = p.l;
    const pv = prev?.get(key);
    let test = null;
    if (pv) {
      test = makeAreaTest(geoms);
      if (test(pv.at[0], pv.at[1])) at = pv.at;
      if (pv.line && at === pv.at && pv.line.every((q) => test(q[0], q[1]))) {
        // the same name along the same line as on the map before
        lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pv.line }, properties: { ...pv.props, a } });
        placed.set(key, pv);
        point(t, n, a, p, { zf: pv.props.zf }, at);
        return at;
      }
    }
    const ll = a >= BIG ? labelLine(geoms, at) : null;
    const chars = n.length;
    let zf = 99;
    const props = { t, n, a };
    placed.set(key, { at, line: ll && ll.len >= 6 ? ll.line : null, props });
    if (ll && ll.len >= 6) {
      const pxAt = (z) => (ll.len * 512 * 2 ** z) / 360;
      const font = 13;
      zf = Math.log2((chars * font * 0.72) / (0.62 * pxAt(0)));
      for (let z = 1; z <= 8; z++) props['s' + z] = Math.max(0.06, Math.min(0.45, (0.62 * pxAt(z) - chars * font * 0.62) / (chars * font)));
      props.zf = Math.max(0, Math.round(zf * 10) / 10);
      lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: ll.line }, properties: props });
    }
    point(t, n, a, p, { zf: ll && ll.len >= 6 ? props.zf : 99 }, at);
    // a badge goes below the label point: below the compact name, and below the name along the line (which
    // runs through the point, bowed towards the pole) when that is placed instead
    return at;
  };
  for (const g of groups) {
    const ms = g.members.map((k) => pols[k]).filter((p) => p.l);
    if (!ms.length) continue;
    if (g.kind === 'state') {
      const p = ms[0];
      g.at = big('s', text(p), p.a, p);
    } else if (g.kind === 'empire') {
      // the empire's name on its largest part, and again on other large parts far away from it
      const sorted = [...ms].sort((a, b) => b.a - a.a);
      const anchors = [];
      for (const p of sorted) {
        if (anchors.length >= 4) break;
        if (!anchors.length || (p.a >= 900000 && anchors.every((q) => Math.hypot(q.l[0] - p.l[0], q.l[1] - p.l[1]) > 42))) anchors.push(p);
      }
      // an empire with one drawn member (its other parts are only listed) keeps that member's own name
      const name = ms.length === 1 ? text(ms[0]) : g.name;
      anchors.forEach((p, i) => { const at = big('e', name, i ? p.a : Math.max(g.area, BIG), p); if (!i) g.at = at; });
      for (const p of ms) point('p', text(p), p.a, p, { zf: 99 });
    } else {
      // a region of peoples: its name at the member nearest the area-weighted middle
      let sx = 0, sy = 0, sa = 0;
      for (const p of ms) { const w = p.a || 1; sx += p.l[0] * w; sy += p.l[1] * w; sa += w; }
      const cx = sx / sa, cy = sy / sa;
      const at = ms.reduce((a, b) => (Math.hypot(b.l[0] - cx, b.l[1] - cy) < Math.hypot(a.l[0] - cx, a.l[1] - cy) ? b : a));
      point('r', g.name, g.area, at, { zf: 99 });
      for (const p of ms) point('u', text(p), p.a, p, { zf: 99 });
    }
  }
  doc.labels = { type: 'FeatureCollection', features: labels };
  doc.labelLines = { type: 'FeatureCollection', features: lines };
  doc._lbl = placed;
  doc.sig = sig + '|' + dark;
  return doc.sig;
}

export { empireName };
