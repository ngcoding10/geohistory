// Data loading: small JSON files, fetched on demand and kept in memory. URLs carry the data version so
// browsers can cache them until the data changes.
import { DATA_VERSION } from './data-version.js';

const memo = new Map();
const base = new URL('../data/', import.meta.url);

export function dataUrl(path) {
  return new URL(path, base).href + '?v=' + DATA_VERSION;
}

export function getJSON(path) {
  if (!memo.has(path)) {
    const p = fetch(dataUrl(path)).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`);
      return r.json();
    });
    p.catch(() => memo.delete(path));
    memo.set(path, p);
  }
  return memo.get(path);
}

// ---- borders ----
let bordersIndex = null;
let csIndex = null;
let clioIndex = null;
export async function loadBordersIndex() {
  if (!bordersIndex) {
    const [b, cs, clio] = await Promise.all([getJSON('borders/index.json'), getJSON('cshapes/index.json'),
      getJSON('clio/index.json').catch(() => null)]);
    bordersIndex = b.snapshots;
    csIndex = cs;
    clioIndex = clio;
  }
  return bordersIndex;
}

/** Yearly border sources: 'cshapes' (dated, as on 1 July) or 'clio' (Cliopatria, one map per year), else null. */
export function yearlySource(y) {
  if (csIndex && y >= csIndex.from && y <= csIndex.to) return 'cshapes';
  if (clioIndex && y >= clioIndex.from && y <= clioIndex.to) return 'clio';
  return null;
}
export const isDatedYear = (y) => !!yearlySource(y);
export const datedRange = () => csIndex && [csIndex.from, csIndex.to];
export const clioRange = () => clioIndex && [clioIndex.from, clioIndex.to];

/** The border map for a year: a yearly map (CShapes or Cliopatria), else the latest snapshot at or before it. */
export function snapshotFor(year) {
  const src = yearlySource(year);
  if (src === 'clio') return { y: clioStored(year), cs: true, src };
  if (src) return { y: year, cs: true, src };
  let best = null;
  for (const s of bordersIndex || []) if (s.y <= year) best = s;
  return best;
}

/** Cliopatria stores a map only for years in which something changes: the latest stored year at or before y. */
function clioStored(y) {
  const ys = clioIndex.years;
  let lo = 0, hi = ys.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ys[mid] <= y) lo = mid; else hi = mid - 1;
  }
  return ys[lo];
}

export function nextSnapshotAfter(y) {
  if (yearlySource(y) === 'clio') {
    const n = clioIndex.years.find((v) => v > y);
    if (n != null) return { y: n, cs: true, src: 'clio' };
  }
  if (yearlySource(y + 1)) return { y: y + 1, cs: true, src: yearlySource(y + 1) };
  const n = (bordersIndex || []).find((s) => s.y > y);
  const firstYearly = [clioIndex, csIndex].filter(Boolean).map((i) => i.from).filter((f) => f > y).sort((a, b) => a - b)[0];
  if (firstYearly && (!n || firstYearly <= n.y)) return { y: firstYearly, cs: true, src: yearlySource(firstYearly) };
  return n || null;
}

// ---- compact geometry (tools/geo.py encode_geom): rings as delta-encoded strings, 0.001 degree ----
function decodeRing(s) {
  const out = [];
  let x = 0, y = 0, i = 0;
  const n = s.length;
  while (i < n) {
    for (let k = 0; k < 2; k++) {
      let shift = 0, res = 0, b;
      do { b = s.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = res & 1 ? ~(res >> 1) : res >> 1;
      if (k === 0) x += d; else y += d;
    }
    out.push([x / 1000, y / 1000]);
  }
  return out;
}
export function decodeGeom(g) {
  if (g.coordinates) return g;
  return g.type === 'Polygon' ? { type: 'Polygon', coordinates: g.enc.map(decodeRing) }
    : { type: 'MultiPolygon', coordinates: g.enc.map((p) => p.map(decodeRing)) };
}

const shapeStore = new Map();
/** One shape of a yearly source by file and id (used for occupied countries that are off the map that year). */
export async function loadShape(src, f, id) {
  if (!shapeStore.has(src + '/' + f)) {
    const d = await getJSON(src + '/' + f);
    for (const [sid, sh] of Object.entries(d)) { sh.g = decodeGeom(sh.g); shapeStore.set(src + ':' + sid, sh); }
    shapeStore.set(src + '/' + f, true);
  }
  return shapeStore.get(src + ':' + id);
}
async function loadCsYear(y, src) {
  const yr = await getJSON(`${src}/years/${y}.json`);
  await Promise.all(yr.need.map(async (f) => {
    if (shapeStore.has(src + '/' + f)) return;
    const d = await getJSON(src + '/' + f);
    for (const [id, sh] of Object.entries(d)) { sh.g = decodeGeom(sh.g); shapeStore.set(src + ':' + id, sh); }
    shapeStore.set(src + '/' + f, true);
  }));
  const features = [];
  const clio = src === 'clio';
  // Cliopatria years: territories without a state point at a polity of an older world snapshot
  const under = new Map();
  if (clio) {
    const snaps = [...new Set(yr.rows.filter((r) => r[4]).map((r) => r[4]))];
    await Promise.all(snaps.map(async (sy) => {
      // outlines borrowed from another snapshot come from its small extract (tools/build_clio.py)
      const d = await getJSON(yr.ux?.includes(sy) ? `clio/u${sy}.json` : `borders/${sy}.json`);
      if (!d._byK) {
        d._byK = new Map();
        for (const f of d.features) {
          if (!d._byK.has(f.properties.k)) d._byK.set(f.properties.k, []);
          d._byK.get(f.properties.k).push(f.geometry);
        }
      }
      under.set(sy, d);
    }));
  }
  const polities = yr.rows.map(([id, n, p, s, extra, alt], k) => {
    if (clio && extra) {
      const d = under.get(extra);
      const src0 = d.polities[id];
      for (const g of d._byK.get(id) || []) features.push({ type: 'Feature', geometry: g, properties: { k, c: null, p, u: 1 } });
      const pol = { n, p, a: src0.a, l: alt || src0.l, bb: src0.bb, pr: 3, under: extra };   // alt: a label point outside the states that cover part of it
      if (src0.ln && n === src0.n) pol.ln = src0.ln;   // the sketch map's label text, unless the row is renamed
      if (s) pol.s = s;
      return pol;
    }
    const sh = shapeStore.get(src + ':' + id);
    features.push({ type: 'Feature', geometry: sh.g, properties: { k, c: null, p } });
    const pol = { n, p, a: sh.a, l: sh.l, bb: sh.bb, pr: 3 };
    if (clio) pol.clio = [sh.s, sh.e];
    if (sh.o) { pol.o = sh.o; pol.ohm = sh.ohm; }   // an OpenHistoricalMap outline the sources lack (tools/curated/ohm_patches.json)
    else {
      pol.dated = [sh.s, sh.e];
      if (extra) pol.cur = 1;
    }
    if (s) pol.s = s;
    return pol;
  });
  // what is drawn, independent of the year: consecutive years with the same rows look the same
  const key = src + ':' + yr.rows.map((r) => r.slice(0, 5).join(',')).join('|');
  return { type: 'FeatureCollection', year: y, cs: true, src, date: yr.date, features, polities, largest: yr.largest, changes: yr.changes, key };
}

export async function loadSnapshot(s) {
  if (s.cs) return loadCsYear(s.y, s.src || 'cshapes');
  // a world sketch map (before 3400 BC): every territory is a people or culture, and each feature gets its
  // power key so that it can be coloured like the yearly maps
  const d = await getJSON('borders/' + s.f);
  const doc = { type: 'FeatureCollection', year: d.year, features: d.features.filter((f) => f.properties.k >= 0).map((f) => ({ type: 'Feature', geometry: f.geometry, properties: { k: f.properties.k, p: d.polities[f.properties.k].p, u: 1 } })),
    polities: d.polities.map((p) => ({ ...p, under: d.year })), largest: d.largest, changes: d.changes, key: 'sketch:' + d.year };
  return doc;
}

// ---- events ----
let eventsIndex = null;
export async function loadEventsIndex() {
  eventsIndex = eventsIndex || (await getJSON('events/index.json'));
  return eventsIndex;
}

export function blocksFor(y0, y1) {
  return (eventsIndex?.blocks || []).filter((b) => b.b > y0 && b.a <= y1);
}

export function countFor(year) {
  return eventsIndex?.counts?.[year] || 0;
}

/** Years near `year` that have events (for "nothing recorded" hints). */
export function nearestYearsWithEvents(year, n = 3) {
  const ys = Object.keys(eventsIndex?.counts || {}).map(Number);
  ys.sort((a, b) => Math.abs(a - year) - Math.abs(b - year));
  return ys.slice(0, n).sort((a, b) => a - b);
}

export async function loadBlock(b) {
  const doc = await getJSON('events/' + b.f);
  if (!doc._ready) {
    for (const e of doc.events) e._block = b.f;
    doc._ready = true;
  }
  return doc;
}

/** Events that started in [y0, y1] plus long events still running at y1. */
export async function eventsBetween(y0, y1) {
  await loadEventsIndex();
  const docs = await Promise.all(blocksFor(y0, y1).map(loadBlock));
  const seen = new Set();
  const events = [];
  const ongoing = [];
  for (const d of docs) {
    for (const e of d.events) {
      if (e.y >= y0 && e.y <= y1) { events.push(e); seen.add(e.i); }
    }
  }
  for (const d of docs) {
    for (const e of [...d.events, ...(d.ongoing || [])]) {
      if (e.y < y0 && e.y2 && e.y2 >= y1 && !seen.has(e.i)) { ongoing.push(e); seen.add(e.i); }
    }
  }
  return { events, ongoing };
}

export async function findEvent(id) {
  const all = [...memo.keys()].filter((k) => k.startsWith('events/') && k !== 'events/index.json');
  for (const k of all) {
    try {
      const d = await memo.get(k);
      const e = d.events.find((x) => x.i === id);
      if (e) return e;
    } catch { /* ignore */ }
  }
  return null;
}

// ---- other files ----
export const loadPowers = () => getJSON('powers.json');
export const loadEntities = () => getJSON('entities.json');
export const loadUS = () => getJSON('us/states.json');
export const loadModern = () => getJSON('base/modern.json');
/** The sea and lakes: coarse ('lo', for world zoom, loaded first) or full. */
export const loadSea = (lo = false) => getJSON(lo ? 'base/sea_lo.json' : 'base/sea.json').then((d) => ({ sea: decodeGeom(d.sea), lakes: decodeGeom(d.lakes) }));
export const loadEmpires = () => getJSON('empires.json').catch(() => ({ empires: {}, rows: {}, undrawn: {}, notes: [] }));
export const loadSuccession = () => getJSON('succession.json').catch(() => ({}));
export const loadOccupations = () => getJSON('occupations.json').catch(() => ({ rows: [] }));
export const loadSearch = () => getJSON('search.json');
export const loadMeta = () => getJSON('meta.json');

/** Every year in which the drawn border map changes (a stored map starts), ascending. */
let storedCache = null;
export function storedYears() {
  if (storedCache) return storedCache;
  const ys = new Set((bordersIndex || []).map((s) => s.y));
  for (const y of clioIndex?.years || []) ys.add(y);
  if (csIndex) for (let y = csIndex.from; y <= csIndex.to; y++) ys.add(y);
  const sorted = [...ys].sort((a, b) => a - b);
  // a stored year counts when the map for it is its own (a sketch map inside the yearly range is not used)
  storedCache = sorted.filter((y) => snapshotFor(y)?.y === y);
  // the first year after a yearly range falls back to a sketch map: the map changes there too
  for (const r of [clioIndex, csIndex]) if (r && !storedCache.includes(r.to + 1) && snapshotFor(r.to + 1) && snapshotFor(r.to + 1).y !== snapshotFor(r.to).y) storedCache.push(r.to + 1);
  storedCache.sort((a, b) => a - b);
  return storedCache;
}
