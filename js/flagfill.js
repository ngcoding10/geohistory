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
const loadImage = (url) => new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = rej; im.src = url; });

let loading = null;
export function loadFills() {
  loading ||= Promise.all([getJSON('flags/fill.json'), loadImage(dataUrl('flags/fill.png')), loadFlags()])
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
  const cap = 2048 / Math.max(W, H, 1);
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

/** Draw one piece (a polygon) filled with its flag. */
function drawPiece(cx, poly, ext, img, r) {
  const sx = ext.W / (ext.x1 - ext.x0), sy = ext.H / (ext.y1 - ext.y0);
  let w = Infinity, e = -Infinity, n = Infinity, s = -Infinity;
  for (const p of poly[0]) { const x = mx(p[0]); const y = my(p[1]); if (x < w) w = x; if (x > e) e = x; if (y < n) n = y; if (y > s) s = y; }
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
  // the flag over the piece's box: stretched to it, but never more than twice off its own proportions (a long
  // thin piece then shows the middle of the flag)
  const fa = r[2] / r[3], ba = bw / Math.max(bh, 1e-6);
  const ta = Math.max(fa / 2, Math.min(fa * 2, ba));
  let dw, dh;
  if (ba > ta) { dw = bw; dh = bw / ta; } else { dh = bh; dw = bh * ta; }
  cx.drawImage(img, r[0], r[1], r[2], r[3], bx + (bw - dw) / 2, by + (bh - dh) / 2, dw, dh);
  cx.restore();
}

/** Paint features of a document into a canvas covering `ext`. `which`: feature indices to draw (all with a
 *  fill when null); `alpha`: index -> opacity; `plain`: index -> colour for features without a flag. */
export function paint(canvas, doc, fills, imgs, ext, { which = null, alpha = null, plain = null, clear = true } = {}) {
  if (canvas.width !== ext.W || canvas.height !== ext.H) { canvas.width = ext.W; canvas.height = ext.H; }
  const cx = canvas.getContext('2d');
  if (clear) cx.clearRect(0, 0, ext.W, ext.H);
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = 'high';
  const list = which || [...fills.keys()];
  for (const i of list) {
    const f = doc.features[i];
    if (!f) continue;
    const a = alpha ? alpha.get(i) ?? 1 : 1;
    if (a <= 0.001) continue;
    cx.globalAlpha = a;
    const fl = fills.get(i);
    const img = fl ? (fl.src === 'atlas' ? atlas : imgs.get(fl.id)) : null;
    if (img) {
      const r = fl.src === 'atlas' ? fl.r : [0, 0, img.naturalWidth, img.naturalHeight];
      for (const poly of rings(f.geometry)) drawPiece(cx, poly, ext, img, r);
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
}

/** For the panel: how a power's land is filled on the map, in words. */
export function fillNote(pk) {
  if (!FF) return null;
  const rule = fillRule(pk);
  const why = FF.why?.[pk];
  if (rule.kind === 'modern') return { kind: 'modern', iso: rule.iso, name: FF.names?.[rule.iso] || rule.iso, why };
  return { kind: 'own', why };
}
