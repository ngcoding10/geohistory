// Flag fill (flag-map art): each state's land painted with a flag, stretched over each piece of it and clipped
// to its borders. Which flag (data/flags/fill.json, tools/build_flag_fills.py): today's country's flag for a
// power with an obvious present-day successor (colonies take their ruler's: British India gets the UK flag),
// else the power's own flag in that year (the badge flag), else nothing (the plain colour shows).
//
// Why a canvas: MapLibre's fill-pattern only tiles a small image from a fixed screen origin, so it cannot scale
// one flag to a state. A custom WebGL layer could, but on the globe its triangles would have to be subdivided
// by hand to follow the curve. Instead each map is drawn once into a 2D canvas (clip to the outline, draw the
// flag over the piece's box) and handed to MapLibre as a canvas source, which it drapes over globe or plane
// like any raster. The canvas covers the whole world at world zoom and the view (with a margin) when zoomed
// in, at about screen resolution; it is redrawn when the view moves on.
import { getJSON, dataUrl } from './data.js';
import { flagFor, loadFlags } from './flags.js';

let FF = null;
let atlas = null;
const hist = new Map();       // flag id -> Promise<HTMLImageElement|null>

// Flags on the land are shown faded, so that the names over them stay readable: each flag is processed once,
// when first needed, in pixel code (ctx.filter is missing in older Safari): its colours keep FADE.keep of their
// saturation and are then mixed FADE.paper of the way towards the paper colour. The badges (js/flags.js) are
// not touched: they are the flag at the time and stay at full colour.
export const FADE = { keep: 0.55, paper: 0.26 };
let PAPER = [246, 241, 228];
const faded = new Map();      // fill key -> {img (canvas or ImageBitmap), w, h}
const fading = new Map();     // fill key -> Promise
/** The paper colour the flags are lightened towards (the map's land colour family); set once by the map. */
export function setFlagPaper(dark) {
  const p = dark ? [58, 53, 44] : [246, 241, 228];
  if (p.join() !== PAPER.join()) { PAPER = p; faded.clear(); fading.clear(); }
}
/** Fade the pixels of an RGBA buffer in place (exported for the checks). */
export function fadePixels(d) {
  const k = FADE.keep, m = FADE.paper, [pr, pg, pb] = PAPER;
  for (let o = 0; o < d.length; o += 4) {
    const r = d[o], g = d[o + 1], b = d[o + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    const r2 = l + (r - l) * k, g2 = l + (g - l) * k, b2 = l + (b - l) * k;
    d[o] = r2 + (pr - r2) * m; d[o + 1] = g2 + (pg - g2) * m; d[o + 2] = b2 + (pb - b2) * m;
  }
  return d;
}
function fadeOne(key, img, r) {
  if (faded.has(key)) return Promise.resolve(faded.get(key));
  if (fading.has(key)) return fading.get(key);
  const p = (async () => {
    const w = Math.max(1, Math.round(r[2])), h = Math.max(1, Math.round(r[3]));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    if (!cx) return null;
    cx.drawImage(img, r[0], r[1], r[2], r[3], 0, 0, w, h);
    let data;
    try { data = cx.getImageData(0, 0, w, h); } catch { return null; }
    fadePixels(data.data);
    cx.putImageData(data, 0, 0);
    let out = cv;
    // an ImageBitmap does not count towards the memory iOS allows the canvases of a page
    if (typeof createImageBitmap === 'function') {
      try { out = await createImageBitmap(cv); cv.width = cv.height = 0; } catch { out = cv; }
    }
    const v = { img: out, w, h };
    faded.set(key, v);
    return v;
  })().catch(() => null).finally(() => fading.delete(key));
  fading.set(key, p);
  return p;
}
/** The faded image of a fill: {img, r: [0, 0, w, h]}, or null when it is not ready (then the raw flag). */
function fadedOf(fl, imgs) {
  const v = faded.get(fl.key);
  if (v) return { img: v.img, r: [0, 0, v.w, v.h] };
  const img = fl.src === 'atlas' ? atlas : imgs?.get(fl.id);
  if (!img) return null;
  return { img, r: fl.src === 'atlas' ? fl.r : [0, 0, img.naturalWidth, img.naturalHeight] };
}
// same-origin images need no CORS request (and Safari has cached a plain and a CORS copy of one file differently)
const loadImage = (url) => new Promise((res, rej) => {
  const im = new Image();
  if (new URL(url, location.href).origin !== location.origin) im.crossOrigin = 'anonymous';
  im.onload = () => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(() => res(im));
  im.onerror = rej;
  im.src = url;
});

/** The largest side of a flag canvas: at most 2048 pixels, 1536 on a phone (iOS caps the memory of all canvases
 *  of a page together), never above what the GPU takes as a texture. Set by the map once it has a GL context. */
let CAP = 2048;
export function setCanvasCap(maxTexture) {
  const phone = Math.min(screen.width || 9999, screen.height || 9999) < 600 || matchMedia?.('(pointer: coarse)').matches;
  CAP = Math.max(256, Math.min(phone ? 1536 : 2048, maxTexture || 2048));
  return CAP;
}
export const canvasCap = () => CAP;

let loading = null;
export function loadFills() {
  // the flag atlas is a large image: a failed load is tried once more before giving up
  loading ||= Promise.all([getJSON('flags/fill.json'), loadImage(dataUrl('flags/fill.png')).catch(() => loadImage(dataUrl('flags/fill.png') + '&r=1')), loadFlags()])
    .then(([d, im]) => { FF = d; atlas = im; return d; })
    .catch((e) => { loading = null; throw e; });
  return loading;
}
export const fillsReady = () => !!(FF && atlas);

/** How a power is filled: {kind: 'modern', iso} | {kind: 'own'} (its own flag of the time). */
export function fillRule(pk) {
  if (!FF || !pk) return { kind: 'own' };
  const iso = FF.m[pk];
  return iso && FF.a[iso] ? { kind: 'modern', iso } : { kind: 'own' };
}

/** The fill of a group in a year: {img, r: [x, y, w, h], key, what} or a pending promise key, or null. */
function groupFill(g, doc, year, emp) {
  if (g.kind === 'region') return null;
  const pols = doc.polities;
  const ownName = FF.own && (FF.own[g.name] || (g.kind === 'state' && FF.own[pols[g.members[0]].n]));
  const rule = ownName ? { kind: 'own' } : fillRule(g.pk);
  if (rule.kind === 'modern') return { src: 'atlas', r: FF.a[rule.iso], key: 'm:' + rule.iso };
  let name;
  if (g.kind === 'state') name = pols[g.members[0]].n;
  else {
    const core = g.members.map((k) => pols[k]).find((p) => p.core);
    name = core?.n || emp?.empires?.[g.id]?.core?.find((n) => flagFor(n, year));
  }
  const f = name && flagFor(name, year);
  return f ? { src: 'hist', id: f.id, key: 'h:' + f.id } : null;
}

/** feature index -> fill, for every state feature of a prepared document that has one. */
export function fillsOf(doc, year, emp) {
  const out = new Map();
  if (!FF || !doc?.groups) return out;
  const byK = new Map();
  for (const g of doc.groups) {
    const fl = groupFill(g, doc, year, emp);
    if (fl) for (const k of g.members) byK.set(k, fl);
  }
  doc.features.forEach((f, i) => {
    if (f.properties.u === 1) return;
    const fl = byK.get(f.properties.k);
    if (fl) out.set(i, fl);
  });
  return out;
}

/** Load the historical flag images a set of fills needs. */
export async function ensureImages(fills) {
  const ids = new Set();
  for (const fl of fills.values()) if (fl.src === 'hist') ids.add(fl.id);
  await Promise.all([...ids].map((id) => {
    if (!hist.has(id)) hist.set(id, loadImage(dataUrl(`flags/b/${id}.png`)).catch(() => null));
    return hist.get(id);
  }));
  const ready = new Map();
  for (const id of ids) ready.set(id, await hist.get(id));
  const keys = new Map();
  for (const fl of fills.values()) if (!keys.has(fl.key)) keys.set(fl.key, fl);
  await Promise.all([...keys.values()].map((fl) => {
    const img = fl.src === 'atlas' ? atlas : ready.get(fl.id);
    return img ? fadeOne(fl.key, img, fl.src === 'atlas' ? fl.r : [0, 0, img.naturalWidth, img.naturalHeight]) : null;
  }));
  return ready;
}

// ---- geometry: Web Mercator in 0..1 (as MapLibre's MercatorCoordinate)
const LAT = 85.05;
export const mx = (lon) => (lon + 180) / 360;
export const my = (lat) => { const l = Math.max(-LAT, Math.min(LAT, lat)) * Math.PI / 180; return 0.5 - Math.log(Math.tan(Math.PI / 4 + l / 2)) / (2 * Math.PI); };
const unmy = (y) => (Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) * 2 - Math.PI / 2) * 180 / Math.PI;

/** The part of the world a canvas should cover for the current view, and its size in pixels:
 *  {x0, y0, x1, y1 (Mercator 0..1), W, H, coords (for the canvas source)}. */
export function extentFor(map) {
  const z = map.getZoom();
  const cv = map.getCanvas();
  const vw = cv.clientWidth || 1024, vh = cv.clientHeight || 768;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const world = 512 * 2 ** z;
  let x0 = 0, y0 = 0, x1 = 1, y1 = 1;
  if (world > Math.max(vw, vh) * 1.6 && map.getProjection?.()?.type !== 'globe' || z > 2.6) {
    const b = map.getBounds();
    const cx0 = mx(Math.max(-180, b.getWest())), cx1 = mx(Math.min(180, b.getEast()));
    const cy0 = my(Math.min(LAT, b.getNorth())), cy1 = my(Math.max(-LAT, b.getSouth()));
    const padX = (cx1 - cx0) * 0.35, padY = (cy1 - cy0) * 0.35;
    x0 = Math.max(0, cx0 - padX); x1 = Math.min(1, cx1 + padX);
    y0 = Math.max(0, cy0 - padY); y1 = Math.min(1, cy1 + padY);
    if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6) { x0 = 0; y0 = 0; x1 = 1; y1 = 1; }
  }
  const scale = world * dpr;
  let W = Math.round((x1 - x0) * scale), H = Math.round((y1 - y0) * scale);
  const cap = CAP / Math.max(W, H, 1);
  if (cap < 1) { W = Math.round(W * cap); H = Math.round(H * cap); }
  W = Math.max(16, W); H = Math.max(16, H);
  const lon = (x) => x * 360 - 180;
  return { x0, y0, x1, y1, W, H, z,
    coords: [[lon(x0), unmy(y0)], [lon(x1), unmy(y0)], [lon(x1), unmy(y1)], [lon(x0), unmy(y1)]] };
}

/** Does `ext` still serve the view well (covers it, and at about the right resolution)? */
export function extentOk(ext, map) {
  if (!ext) return false;
  const n = extentFor(map);
  const inside = n.x0 >= ext.x0 - 1e-9 && n.x1 <= ext.x1 + 1e-9 && n.y0 >= ext.y0 - 1e-9 && n.y1 <= ext.y1 + 1e-9;
  const resA = ext.W / (ext.x1 - ext.x0), resB = n.W / (n.x1 - n.x0);
  return inside && resA / resB > 0.7 && resA / resB < 1.6;
}

function rings(geom) {
  return geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
}

/** The flag grid of a box (Mercator 0..1) for a flag of proportions fa: the flag over the box, stretched to it
 *  but never more than 1.6 times off its own proportions. A box much wider or taller than the flag gets the flag
 *  several times side by side (or one above the other), so that every part of a large state shows the flag and
 *  not one stripe of a flag blown up over a continent. {x0, y0, cw, ch (cell), dw, dh (flag drawn in a cell)} */
const CELL_MAX = 0.25;   // Mercator 0..1: 90 degrees of longitude
function gridOf([w, n, e, s], fa) {
  const bw = e - w, bh = Math.max(s - n, 1e-12), ba = bw / bh;
  let cols = ba > fa * 1.6 ? Math.min(8, Math.round(ba / fa)) : 1;
  let rows = ba < fa / 1.6 ? Math.min(8, Math.round(fa / ba)) : 1;
  // and no flag taller than CELL_MAX (a sub-continent): its stripes would read as plain colours
  if (bh / rows > CELL_MAX) { rows = Math.min(8, Math.ceil(bh / CELL_MAX)); cols = Math.max(1, Math.min(8, Math.round(bw / ((bh / rows) * fa)))); }
  const cw = bw / cols, ch = bh / rows, ca = cw / ch;
  const ta = Math.max(fa / 1.6, Math.min(fa * 1.6, ca));
  let dw, dh;
  if (ca > ta) { dw = cw; dh = cw / ta; } else { dh = ch; dw = ch * ta; }
  return { x0: w, y0: n, cw, ch, dw, dh };
}

function inPiece(poly, x, y) {   // lon, lat
  let c = false;
  for (const ring of poly) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < xi + ((y - yi) * (xj - xi)) / (yj - yi)) c = !c;
    }
  }
  return c;
}

/** Where each piece's flag goes: feature index -> [{poly, box, grid}]. A piece that lies on a larger piece of
 *  the same state or empire under the same flag (a viceroyalty that the empire's outline also covers) takes
 *  that piece's grid, so the two read as one flag and not as two flags cut across each other. */
const layouts = new WeakMap();   // fills -> layout (the same map and year: only the view changes)
function layoutOf(doc, fills, imgs) {
  const known = layouts.get(fills);
  if (known && known.doc === doc) return known.out;
  const out = new Map();
  const all = [];
  for (const [i, fl] of fills) {
    const f = doc.features[i];
    if (!f) continue;
    const fd = fadedOf(fl, imgs);
    if (!fd) continue;
    const fa = fd.r[2] / fd.r[3];
    const list = [];
    for (const poly of rings(f.geometry)) {
      let w = Infinity, e = -Infinity, n = -Infinity, s = Infinity;
      for (const p of poly[0]) { if (p[0] < w) w = p[0]; if (p[0] > e) e = p[0]; if (p[1] > n) n = p[1]; if (p[1] < s) s = p[1]; }
      const box = [mx(w), my(n), mx(e), my(s)];
      const pc = { poly, box, ll: [w, s, e, n], size: (box[2] - box[0]) * (box[3] - box[1]), grid: gridOf(box, fa), g: f.properties.g, key: fl.key };
      list.push(pc); all.push(pc);
    }
    out.set(i, list);
  }
  const hosts = all.filter((pc) => pc.size > 1e-6).sort((a, b) => b.size - a.size).slice(0, 40);
  for (const pc of all) {
    const cx = (pc.ll[0] + pc.ll[2]) / 2, cy = (pc.ll[1] + pc.ll[3]) / 2;
    for (const h of hosts) {
      if (h.size < pc.size * 3) break;
      if (h.key !== pc.key || h.g !== pc.g || cx < h.ll[0] || cx > h.ll[2] || cy < h.ll[1] || cy > h.ll[3]) continue;
      if (inPiece(h.poly, cx, cy)) { pc.grid = h.grid; break; }
    }
  }
  layouts.set(fills, { doc, out });
  return out;
}

/** Draw one piece (a polygon) filled with its flag, on its grid. */
function drawPiece(cx, pc, ext, img, r) {
  const { poly, box, grid } = pc;
  const sx = ext.W / (ext.x1 - ext.x0), sy = ext.H / (ext.y1 - ext.y0);
  const [w, n, e, s] = box;
  const bx = (w - ext.x0) * sx, by = (n - ext.y0) * sy, bw = (e - w) * sx, bh = (s - n) * sy;
  if (bx > ext.W || by > ext.H || bx + bw < 0 || by + bh < 0 || bw * bh < 3) return;
  cx.save();
  cx.beginPath();
  for (const ring of poly) {
    let lx = null, ly = null;
    ring.forEach((p, i) => {
      const x = (mx(p[0]) - ext.x0) * sx, y = (my(p[1]) - ext.y0) * sy;
      if (i && Math.abs(x - lx) < 0.6 && Math.abs(y - ly) < 0.6 && i < ring.length - 1) return;
      if (i) cx.lineTo(x, y); else cx.moveTo(x, y);
      lx = x; ly = y;
    });
    cx.closePath();
  }
  cx.clip('evenodd');
  // the cells of the grid that the piece (and the canvas) cover
  const vx0 = Math.max(w, ext.x0), vx1 = Math.min(e, ext.x1), vy0 = Math.max(n, ext.y0), vy1 = Math.min(s, ext.y1);
  const i0 = Math.floor((vx0 - grid.x0) / grid.cw), i1 = Math.floor((vx1 - grid.x0) / grid.cw);
  const j0 = Math.floor((vy0 - grid.y0) / grid.ch), j1 = Math.floor((vy1 - grid.y0) / grid.ch);
  if (i1 - i0 < 64 && j1 - j0 < 64) {
    const dw = grid.dw * sx, dh = grid.dh * sy, cw = grid.cw * sx, ch = grid.ch * sy;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const x = (grid.x0 - ext.x0) * sx + i * cw, y = (grid.y0 - ext.y0) * sy + j * ch;
        cx.drawImage(img, r[0], r[1], r[2], r[3], x + (cw - dw) / 2, y + (ch - dh) / 2, dw, dh);
      }
    }
  }
  cx.restore();
  return bw * bh >= 64 ? [Math.max(0, bx), Math.max(0, by), Math.min(bw, ext.W - Math.max(0, bx)), Math.min(bh, ext.H - Math.max(0, by))] : null;
}

/** Paint features of a document into a canvas covering `ext`. `which`: feature indices to draw (all with a
 *  fill when null); `alpha`: index -> opacity; `plain`: index -> colour for features without a flag.
 *  With `probe`, returns a canvas pixel that came out opaque, {x, y, rgba}, for the map's check that the GPU got
 *  the picture (null if none was found). Throws when the browser gives no 2D context (iOS does so once the
 *  page's canvases take too much memory). */
export function paint(canvas, doc, fills, imgs, ext, { which = null, alpha = null, plain = null, clear = true, probe = false } = {}) {
  if (canvas.width !== ext.W || canvas.height !== ext.H) { canvas.width = ext.W; canvas.height = ext.H; }
  const cx = canvas.getContext('2d');
  if (!cx || canvas.width !== ext.W) throw new Error(`no 2D canvas of ${ext.W} x ${ext.H}`);
  const boxes = probe ? [] : null;
  if (clear) cx.clearRect(0, 0, ext.W, ext.H);
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = 'high';
  const list = which || [...fills.keys()];
  const lay = layoutOf(doc, fills, imgs);
  for (const i of list) {
    const f = doc.features[i];
    if (!f) continue;
    const a = alpha ? alpha.get(i) ?? 1 : 1;
    if (a <= 0.001) continue;
    cx.globalAlpha = a;
    const fl = fills.get(i);
    const fd = fl ? fadedOf(fl, imgs) : null;
    if (fd) {
      for (const pc of lay.get(i) || []) { const b = drawPiece(cx, pc, ext, fd.img, fd.r); if (b && boxes) boxes.push(b); }
    } else if (plain?.get(i)) {
      cx.fillStyle = plain.get(i);
      const sx = ext.W / (ext.x1 - ext.x0), sy = ext.H / (ext.y1 - ext.y0);
      cx.beginPath();
      for (const poly of rings(f.geometry)) for (const ring of poly) {
        ring.forEach((p, j) => { const x = (mx(p[0]) - ext.x0) * sx, y = (my(p[1]) - ext.y0) * sy; if (j) cx.lineTo(x, y); else cx.moveTo(x, y); });
        cx.closePath();
      }
      cx.fill('evenodd');
    }
  }
  cx.globalAlpha = 1;
  if (!boxes) return null;
  // the middle of the largest pieces drawn: the first opaque one
  boxes.sort((a, b) => b[2] * b[3] - a[2] * a[3]);
  for (const [bx, by, bw, bh] of boxes.slice(0, 6)) {
    const x = Math.round(Math.max(0, Math.min(ext.W - 1, bx + bw / 2))), y = Math.round(Math.max(0, Math.min(ext.H - 1, by + bh / 2)));
    const d = cx.getImageData(x, y, 1, 1).data;
    if (d[3] >= 250) return { x, y, rgba: [d[0], d[1], d[2], d[3]] };
  }
  return null;
}

/** One flag as a small tile for the fallback fill (MapLibre fill-pattern, tiled from the screen origin): ImageData
 *  of w x h, or null. */
export function flagTile(fl, imgs, w = 48, h = 32) {
  const fd = fadedOf(fl, imgs);
  if (!fd) return null;
  const { img, r } = fd;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  if (!cx) return null;
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(img, r[0], r[1], r[2], r[3], 0, 0, w, h);
  // a hairline at the tile's edge so the repeats read as flags, not as stripes running on
  cx.strokeStyle = 'rgba(30,24,16,0.45)';
  cx.lineWidth = 1;
  cx.strokeRect(0.5, 0.5, w - 1, h - 1);
  const d = cx.getImageData(0, 0, w, h);
  cv.width = cv.height = 0;   // released at once (iOS counts canvas memory until a canvas is collected)
  return d;
}

/** For the panel: how a power's land is filled on the map, in words. */
export function fillNote(pk) {
  if (!FF) return null;
  const rule = fillRule(pk);
  const why = FF.why?.[pk];
  if (rule.kind === 'modern') return { kind: 'modern', iso: rule.iso, name: FF.names?.[rule.iso] || rule.iso, why };
  return { kind: 'own', why };
}
