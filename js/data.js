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
  if (src) return { y: year, cs: true, src };
  let best = null;
  for (const s of bordersIndex || []) if (s.y <= year) best = s;
  return best;
}

export function nextSnapshotAfter(y) {
  if (yearlySource(y + 1)) return { y: y + 1, cs: true, src: yearlySource(y + 1) };
  const n = (bordersIndex || []).find((s) => s.y > y);
  const firstYearly = [clioIndex, csIndex].filter(Boolean).map((i) => i.from).filter((f) => f > y).sort((a, b) => a - b)[0];
  if (firstYearly && (!n || firstYearly <= n.y)) return { y: firstYearly, cs: true, src: yearlySource(firstYearly) };
  return n || null;
}

const shapeStore = new Map();
async function loadCsYear(y, src) {
  const yr = await getJSON(`${src}/years/${y}.json`);
  await Promise.all(yr.need.map(async (f) => {
    if (shapeStore.has(src + '/' + f)) return;
    const d = await getJSON(src + '/' + f);
    for (const [id, sh] of Object.entries(d)) shapeStore.set(src + ':' + id, sh);
    shapeStore.set(src + '/' + f, true);
  }));
  const features = [];
  const clio = src === 'clio';
  const polities = yr.rows.map(([id, n, p, s, extra], k) => {
    const sh = shapeStore.get(src + ':' + id);
    features.push({ type: 'Feature', geometry: sh.g, properties: { k, c: null, p } });
    const pol = { n, p, a: sh.a, l: sh.l, bb: sh.bb, pr: 3 };
    if (clio) {
      if (extra) pol.under = extra; else pol.clio = [sh.s, sh.e];
    } else {
      pol.dated = [sh.s, sh.e];
      if (extra) pol.cur = 1;
    }
    if (s) pol.s = s;
    return pol;
  });
  return { type: 'FeatureCollection', year: y, cs: true, src, date: yr.date, features, polities, largest: yr.largest, changes: yr.changes };
}

export async function loadSnapshot(s) {
  if (s.cs) {
    const [doc, powers] = await Promise.all([loadCsYear(s.y, s.src || 'cshapes'), getJSON('powers.json')]);
    for (const f of doc.features) f.properties.c = powers[f.properties.p]?.color || '#ccc';
    return doc;
  }
  return getJSON('borders/' + s.f);
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
export const loadLand = () => getJSON('base/land.json');
export const loadSearch = () => getJSON('search.json');
export const loadMeta = () => getJSON('meta.json');
