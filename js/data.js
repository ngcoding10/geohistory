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
export async function loadBordersIndex() {
  bordersIndex = bordersIndex || (await getJSON('borders/index.json')).snapshots;
  return bordersIndex;
}

/** Latest snapshot at or before the year (or null when the year is before the first one). */
export function snapshotFor(year) {
  let best = null;
  for (const s of bordersIndex || []) if (s.y <= year) best = s;
  return best;
}

export function nextSnapshotAfter(y) {
  return (bordersIndex || []).find((s) => s.y > y) || null;
}

export function loadSnapshot(s) {
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
