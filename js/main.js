// GeoHistory: choose a year, see the world's borders, powers and events at that time.
import { HistoryMap } from './map.js';
import {
  loadBordersIndex, snapshotFor, nextSnapshotAfter, datedRange, clioRange, loadSnapshot, loadEventsIndex, eventsBetween, nearestYearsWithEvents,
  loadPowers, loadEntities, getJSON, loadUS, loadModern, loadLand, loadMeta, countFor, findEvent,
} from './data.js';
import { parseYear, formatYear, formatDate, addYears, yearToFrac, fracToYear, ERAS, MIN_YEAR, MAX_YEAR } from './year.js';
import { TYPES, TYPE_KEYS } from './types.js';
import { getPref, setPref } from './store.js';
import { makeAreaTest, bboxOf } from './geo.js';
import { Search } from './search.js';
import { h, eventList, filterChips, skeleton, fmtArea, wikiUrl, wikidataUrl, eventDate, placeLine, dayLabel } from './ui.js';

const $ = (s) => document.querySelector(s);
const els = {
  year: $('#year'), form: $('#yearForm'), hint: $('#yearHint'), slider: $('#slider'), ticks: $('#ticks'), eras: $('#eras'),
  play: $('#playBtn'), panel: $('#panel'), body: $('#panelBody'), handle: $('#sheetHandle'), status: $('#mapStatus'),
  badge: $('#badge'), badgeInfo: $('#badgeInfo'), proj: $('#projBtn'), modernBtn: $('#modernBtn'), sourcesBtn: $('#sourcesBtn'),
  sources: $('#sources'), sourcesBody: $('#sourcesBody'),
};

const state = {
  year: 1776, month: 0, day: 0,
  snap: null, snapDoc: null,
  sel: null,            // {kind: 'polity'|'us'|'modern', ...}
  eventId: null,
  view: 'year',         // 'year' | 'sel' | 'event'
  disabled: new Set(getPref('hiddenTypes2', ['birth', 'death'])),   // births and deaths are off until turned on
  projection: getPref('projection', 'mercator'),
  modern: false,
  token: 0,
};
let map = null;
let mapOk = false;
let powers = {};
let entities = null;
let modernNames = {};
let modernFC = null;
let usFC = null;

// ---------------------------------------------------------------- start
init().catch((err) => {
  console.error(err);
  showStatus('Something went wrong while loading. Reload the page to try again.', true);
});

async function init() {
  const p = new URLSearchParams(location.search);
  const parsed = parseYear(p.get('y') || '1776');
  if (!parsed.error) state.year = parsed.year;
  const d = (p.get('d') || '').match(/^(\d{1,2})(?:-(\d{1,2}))?$/);
  if (d) { state.month = +d[1]; state.day = +(d[2] || 0); }
  if (p.get('v') === 'flat') state.projection = 'mercator';
  if (p.get('v') === 'globe') state.projection = 'globe';
  state.modern = p.get('mb') === '1';
  const want = { c: p.get('c'), s: p.get('s'), mc: p.get('mc'), e: p.get('e'), col: p.get('col') };

  setupTimebar();
  setupPanel();
  setupTools();
  new Search($('#q'), $('#results'), chooseSearch);
  document.addEventListener('keydown', globalKeys);
  showYearInput();
  updateSlider();

  map = new HistoryMap($('#map'));
  if (window.innerWidth < 600) $('#q').placeholder = 'Search';
  const mapReady = map.init({ projection: state.projection, zoom: startZoom() }).then(() => {
    mapOk = true;
    showStatus('');
    map.addEventListener('polity', (e) => selectPolityByIndex(e.detail, { fly: false }));
    map.addEventListener('usstate', (e) => selectUS(e.detail.id, { fly: false }));
    map.addEventListener('colony', (e) => selectColony(e.detail, { fly: false }));
    map.addEventListener('event', (e) => openEvent(e.detail, { fly: false }));
    map.addEventListener('empty', () => { if (state.view !== 'year') { clearSelection(); } });
    loadLand().then((fc) => map.setLand(fc)).catch(() => {});
    applyPadding();
  }).catch((err) => {
    console.warn('map failed', err);
    showStatus('The map could not start here (it needs WebGL). The year panel still works.', true);
  });

  const [, , pw] = await Promise.all([loadBordersIndex(), loadEventsIndex(), loadPowers()]);
  powers = pw;
  drawTicks();
  await mapReady;
  await goToYear(state.year, { month: state.month, day: state.day, keepSel: false });
  if (state.modern) toggleModern(true);
  if (want.c) await selectPolityByName(want.c, { fly: true });
  else if (want.s) await selectUS(want.s, { fly: true });
  else if (want.mc) await selectModern(want.mc, { fly: true });
  else if (want.col) await selectColony(want.col, { fly: true });
  if (want.e) await openEvent(want.e, { fly: !want.c });
}

function startZoom() {
  const w = window.innerWidth;
  const avail = w >= 900 ? w - 420 : w;
  if (state.projection === 'globe') return w < 600 ? 0.9 : 1.4;
  return Math.max(0, Math.log2(avail / 512) + 0.1);
}

function showStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle('error', !!isError);
}

// ---------------------------------------------------------------- year changes
async function goToYear(year, { month = 0, day = 0, keepSel = true, fromSlider = false, keepEvent = false } = {}) {
  year = Math.max(MIN_YEAR, Math.min(MAX_YEAR, year));
  state.year = year;
  state.month = month;
  state.day = day;
  const token = ++state.token;
  showYearInput();
  if (!fromSlider) updateSlider();
  setHint('');
  writeUrl();

  // borders
  const snap = snapshotFor(year);
  if (snap?.y !== state.snap?.y) {
    state.snap = snap;
    if (snap) {
      try {
        const doc = await loadSnapshot(snap);
        if (token !== state.token && state.snap?.y !== snap.y) return;
        state.snapDoc = doc;
        if (mapOk) map.setSnapshot(doc);
      } catch (e) {
        console.warn(e);
        showStatus('Could not load the borders for this year. Check your connection and try again.', true);
      }
    } else {
      state.snapDoc = null;
      if (mapOk) map.setSnapshot(null);
    }
  }
  updateBadge();
  await updateUS();
  if (token !== state.token) return;

  // keep a selected territory across years (matched by name); close an open event that belongs to another year
  if (keepSel && state.sel?.kind === 'polity') remapPolity();
  if (keepSel && state.sel?.kind === 'us') remapUS();
  if (keepSel && state.sel?.kind === 'colony') {
    const u = colonyUnits(state.sel.st, colDate());
    if (u.length) Object.assign(state.sel, { name: colonyName(state.sel.st, colDate()), test: makeAreaTest(u.map((f) => f.geometry)), n: u.length, missing: false });
  }
  if (state.view === 'event' && !keepEvent) {
    state.view = state.sel ? 'sel' : 'year';
    state.eventId = null;
    if (mapOk) map.selectEvent(null);
    writeUrl();
  }
  await render();
}

function remapPolity() {
  const sel = state.sel;
  const doc = state.snapDoc;
  const k = doc ? doc.polities.findIndex((p) => p.n === sel.name) : -1;
  if (k >= 0) {
    sel.k = k;
    sel.p = doc.polities[k];
    sel.test = makeAreaTest(doc.features.filter((f) => f.properties.k === k).map((f) => f.geometry));
    sel.missing = false;
  } else {
    sel.missing = true;
    sel.k = null;
  }
  if (mapOk) map.selectPolity(sel.k);
}

function remapUS() {
  const s = state.sel;
  if (!usFC) return;
  const d = usDateInt();
  const f = usFC.features.find((x) => x.properties.id === s.id && x.properties.s <= d && x.properties.e >= d);
  if (f) { s.props = f.properties; s.name = f.properties.n; s.test = makeAreaTest([f.geometry]); s.missing = false; }
  else s.missing = true;
}

// ---- the colonies before 1783 (Newberry county files) ----
const COL_COLORS = ['#d79c86', '#94b4cc', '#a9c08f', '#e3cf86', '#c7a8c9', '#86bdb8', '#e5b893', '#a9a7d6',
  '#dba8a8', '#c4cd8c', '#9fc6ad', '#d9b77e', '#b996b0', '#9cb0d2', '#cf9a9a'];
const COLONY_NAMES = { CT: 'Connecticut Colony', DE: 'Delaware Colony', GA: 'Province of Georgia', MD: 'Province of Maryland',
  MA: 'Province of Massachusetts Bay', NH: 'Province of New Hampshire', NJ: 'Province of New Jersey', NY: 'Province of New York',
  NC: 'Province of North Carolina', PA: 'Province of Pennsylvania', RI: 'Colony of Rhode Island', SC: 'Province of South Carolina',
  VA: 'Colony of Virginia', ME: 'Province of Massachusetts Bay', VT: 'Vermont (disputed)' };
let colFC = null;
const colDate = () => state.year * 10000 + (state.month || 12) * 100 + (state.day || (state.month ? 28 : 31));
function colonyName(st, date) {
  const states = colFC?.states || {};
  if (date >= 17760704) return st === 'ME' ? 'Massachusetts' : st === 'VT' ? 'Vermont' : `${states[st] || st} (state)`;
  return COLONY_NAMES[st] || states[st] || st;
}
function colonyUnits(st, date) {
  return (colFC?.features || []).filter((f) => f.properties.s <= date && f.properties.e >= date && (f.properties.st === st || (st === 'MA' && f.properties.st === 'ME')));
}
async function updateColonies() {
  const y = state.year;
  if (y < 1607 || y > 1783 || colDate() >= 17830903) { if (mapOk && map._colOn) { map.setColonies(null, null); map._colOn = false; } return; }
  try {
    if (!colFC) {
      colFC = await getJSON('us/colonies.json');
      const codes = Object.keys(colFC.states);
      for (const f of colFC.features) f.properties.c = COL_COLORS[codes.indexOf(f.properties.st === 'ME' ? 'MA' : f.properties.st) % COL_COLORS.length];
    }
    const d = colDate();
    const best = {};
    for (const f of colFC.features) {
      const p = f.properties;
      if (p.s > d || p.e < d) continue;
      const st = p.st === 'ME' ? 'MA' : p.st;
      const a = bboxArea(f.geometry);
      if (!best[st] || a > best[st].a) best[st] = { a, l: p.l };
    }
    const labels = { type: 'FeatureCollection', features: Object.entries(best).map(([st, b]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: b.l }, properties: { n: colonyName(st, d) } })) };
    if (mapOk) { map.setColonies(colFC, d, labels, state.sel?.kind === 'colony' ? state.sel.st : null); map._colOn = true; }
  } catch (e) { console.warn(e); }
}
function bboxArea(g) {
  const b = bboxOf([g]);
  return b ? (b[2] - b[0]) * (b[3] - b[1]) : 0;
}

async function selectColony(st, { fly }) {
  st = st === 'ME' ? 'MA' : st;
  const d = colDate();
  const units = colonyUnits(st, d);
  if (!units.length) return;
  state.sel = { kind: 'colony', st, id: st.toLowerCase() + '_state', name: colonyName(st, d), test: makeAreaTest(units.map((f) => f.geometry)), n: units.length };
  state.view = 'sel';
  state.eventId = null;
  if (mapOk) { map.selectPolity(null); updateColonies(); if (fly) map.fitBBox(bboxOf(units.map((f) => f.geometry)), 6.5); }
  expandSheet();
  writeUrl();
  await render();
}

async function updateUS() {
  await updateColonies();
  const y = state.year;
  if (y < 1783 || y > 2000) { if (mapOk && map.usDate != null) map.setUSDate(null); return; }
  try {
    if (!usFC) { usFC = await loadUS(); if (mapOk) map.setUS(usFC); }
    if (mapOk) map.setUSDate(usDateInt(), state.sel?.kind === 'us' ? state.sel.id : null);
  } catch (e) { console.warn(e); }
}

function usDateInt() {
  // whole year: show the situation at its end; with a typed date, on that day
  const m = state.month || 12, d = state.day || (state.month ? 28 : 31);
  return state.year * 10000 + m * 100 + d;
}

function updateBadge() {
  const s = state.snap;
  els.badge.hidden = false;
  els.badgeInfo.hidden = true;
  els.badge.setAttribute('aria-expanded', 'false');
  if (!s) {
    els.badge.textContent = 'No border map this early';
    els.badge.classList.remove('exact');
    return;
  }
  const exact = s.y === state.year;
  els.badge.textContent = s.src === 'clio' ? `Borders in ${s.y} (approximate)` : s.cs ? `Borders on 1 July ${s.y}` : `Borders as of ${formatYear(s.y)}`;
  els.badge.classList.toggle('exact', exact);
}

function badgeText() {
  const s = state.snap;
  if (!s) return [h('p', null, `The border maps start in ${formatYear(MIN_YEAR)}.`)];
  const next = nextSnapshotAfter(s.y);
  const out = [];
  if (s.src === 'clio') {
    out.push(h('p', null, `From ${clioRange()[0]} to ${clioRange()[1]} the map uses Cliopatria (Seshat Global History Databank), which gives each state a shape for a range of years. You see the shapes it lists for ${s.y}. They are approximate: the source redraws a state only every few years, and border dates can be a year or two off.`));
    out.push(h('p', null, 'Cliopatria only draws states. Peoples and regions without a state are filled in from the nearest earlier world sketch map (historical-basemaps); click one to see which map it comes from.'));
    out.push(h('p', null, h('button.more', { type: 'button', onclick: openSources }, 'Sources and accuracy')));
    return out;
  }
  if (s.cs) {
    out.push(h('p', null, `From ${datedRange()[0]} to ${datedRange()[1]} the map uses CShapes 2.0, which dates every change of state borders. You see the borders as they stood on 1 July ${s.y}.`));
    out.push(h('p', null, 'Rulers of colonies come from the older world maps or from a short curated list, so they can lag a change by a few years.'));
    out.push(h('p', null, h('button.more', { type: 'button', onclick: openSources }, 'Sources and accuracy')));
    return out;
  }
  if (s.y === state.year) out.push(h('p', null, `This is one of the years with its own border map.`));
  else out.push(h('p', null, `There is no border map for ${formatYear(state.year)}. You are seeing the nearest earlier one, from ${formatYear(s.y)}.`));
  out.push(h('p', null, next ? `The next border map is ${formatYear(next.y)}.` : 'This is the latest border map.'));
  out.push(h('p', null, s.y < 1500
    ? 'Borders this early are rough sketches. Many regions had no fixed borders at all.'
    : 'Borders are simplified for speed and may be off by a few kilometres or more.'));
  if (state.year >= 1607 && state.year <= 2000) {
    out.push(h('p', null, state.year < 1783
      ? 'In North America the colonies are drawn from their organized counties on this date (exact dates, Newberry Library).'
      : 'Dashed lines in the United States show state and territory borders on this date.'));
  }
  out.push(h('p', null, h('button.more', { type: 'button', onclick: openSources }, 'Sources and accuracy')));
  return out;
}

// ---------------------------------------------------------------- rendering the panel
async function render() {
  if (state.view === 'event' && state.eventId) return renderEvent();
  if (state.sel) return renderSelection();
  return renderYear();
}

function setBody(...nodes) {
  els.body.replaceChildren(...nodes.flat());
}

function filtered(events) {
  return events.filter((e) => !state.disabled.has(e.t));
}

function isToday(e) {
  return state.month && e.y === state.year && e.m === state.month && (!state.day || e.dd === state.day);
}

function rank(events) {
  return [...events].sort((a, b) => (isToday(b) - isToday(a)) || (b.s - a.s) || ((a.m || 13) - (b.m || 13)));
}

function counts(events) {
  const c = {};
  for (const e of events) c[e.t] = (c[e.t] || 0) + 1;
  return c;
}

const listOpts = () => ({ onOpen: (e) => openEvent(e.i, { fly: true }), isToday, modernNames });

async function renderYear() {
  const token = state.token;
  const y = state.year;
  setBody(h('p.kicker', null, 'Year'), h('h1', null, `The world in ${formatYear(y)}`), skeleton());
  let data;
  try {
    data = await eventsBetween(y, y);
  } catch (e) {
    console.warn(e);
    if (token !== state.token) return;
    setBody(h('h1', null, `The world in ${formatYear(y)}`),
      h('p.empty', null, 'The events for this year could not load.'),
      h('button.more', { type: 'button', onclick: () => render() }, 'Try again'));
    return;
  }
  if (token !== state.token || state.view !== 'year' || state.sel) return;
  const all = data.events;
  const shown = rank(filtered(all));
  if (mapOk) map.setEvents(shown);
  const nodes = [h('p.kicker', null, 'Year'), h('h1', null, `The world in ${formatYear(y)}`)];
  if (state.month) nodes.push(h('p.lead', null, `Highlighting ${dayLabel(state.month, state.day)}.`));
  nodes.push(h('p.note', null, `${all.length} ${all.length === 1 ? 'event' : 'events'} recorded · `,
    state.snap ? (state.snap.src === 'clio' ? `map borders in ${state.snap.y}, approximate` : state.snap.cs ? `map borders on 1 July ${state.snap.y}` : `map borders as of ${formatYear(state.snap.y)}`) : 'no border map this early'));

  const cen = await getJSON('centuries.json').then((d) => d.centuries.find((c) => c.from <= y && c.to >= y)).catch(() => null);
  const dec = y >= 1500 ? await getJSON('decades.json').then((d) => d.decades.find((c) => c.from <= y && c.to >= y)).catch(() => null) : null;
  if (dec) nodes.push(h('p.lead.century', null, h('b', null, `The ${dec.from}s. `), dec.text, h('span.unver', { title: dec.verified
    ? 'Written for GeoHistory; every event it names is dated to this decade by Wikidata' : 'Written for GeoHistory; not every statement could be confirmed in Wikidata' },
  dec.verified ? 'curated' : 'curated, unverified')));
  else if (cen) nodes.push(h('p.lead.century', null, cen.text, h('span.unver', { title: 'Curated summary, not checked against a dataset' }, 'curated')));
  const strip = await changeStrip(y);
  if (token !== state.token || state.view !== 'year' || state.sel) return;
  if (strip) nodes.push(strip);
  nodes.push(h('h2', null, 'Events'));
  if (all.length) {
    const hidden = TYPE_KEYS.filter((k) => state.disabled.has(k) && counts(all)[k]).length;
    const box = h('details.filter-box', { open: state.filtersOpen ? '' : null, ontoggle: (ev) => { state.filtersOpen = ev.target.open; } },
      h('summary', null, hidden ? `Event types (${hidden} hidden)` : 'Event types'),
      filterChips(counts(all), state.disabled, toggleType));
    nodes.push(box);
    if (shown.length) nodes.push(eventList(shown, listOpts(), 12));
    else nodes.push(h('p.empty', null, 'All event types are hidden. Turn some back on above.'));
  } else {
    const near = nearestYearsWithEvents(y, 4).filter((x) => x !== y);
    nodes.push(h('p.empty', null, `No events recorded for ${formatYear(y)} yet.`));
    if (near.length) nodes.push(h('p.note', null, 'Nearby years with events: '),
      h('ul.pill-list', null, near.map((ny) => h('li', null, h('button', { type: 'button', onclick: () => goToYear(ny) }, formatYear(ny))))));
  }
  const ongoing = rank(filtered(data.ongoing)).slice(0, 8);
  if (ongoing.length) {
    nodes.push(h('h2', null, 'Still going'));
    nodes.push(eventList(ongoing, { ...listOpts(), isToday: () => false }, 6));
  }

  const doc = state.snapDoc;
  if (doc) {
    nodes.push(h('h2', null, `Largest territories on the ${formatYear(doc.year)} map`));
    const ul = h('ul.legend');
    for (const p of doc.largest.slice(0, 10)) {
      const col = powers[p.p]?.color || '#ccc';
      const name = p.name;
      ul.append(h('li', null, h('button', { type: 'button', onclick: () => selectPower(p.p) },
        h('span.sw', { style: `background:${col}`, 'aria-hidden': 'true' }),
        h('span', null, name, p.n > 1 ? h('span.muted', null, ` (${p.n} areas)`) : null),
        h('span.a', null, fmtArea(p.a)))));
    }
    nodes.push(ul, h('p.note', null, 'Areas are rough, measured from the simplified map. Some entries are peoples or cultures rather than states.'));
    if (doc.changes) {
      const ch = doc.changes;
      nodes.push(h('h2', null, `Changes since the ${formatYear(ch.since)} map`));
      nodes.push(h('p.changes', null, h('b', null, `${ch.nAppeared}`), ' names appear and ', h('b', null, `${ch.nGone}`), ' disappear. Largest:'));
      if (ch.appeared.length) nodes.push(h('h3', null, 'New on the map'), pills(ch.appeared, (n) => selectPolityByName(n, { fly: true })));
      if (ch.gone.length) nodes.push(h('h3', null, 'Gone from the map'), pills(ch.gone, (n) => selectGone(n, ch.since)));
    }
  }
  setBody(nodes);
}

function pills(names, onClick) {
  return h('ul.pill-list', null, names.map((n) => h('li', null, h('button', { type: 'button', onclick: () => onClick(n) }, n))));
}

function toggleType(k) {
  if (state.disabled.has(k)) state.disabled.delete(k); else state.disabled.add(k);
  setPref('hiddenTypes2', [...state.disabled]);
  render();
}

// ---------------------------------------------------------------- selections
async function selectPolityByIndex(k, { fly }) {
  const doc = state.snapDoc;
  if (!doc || k == null || k < 0) return;
  const p = doc.polities[k];
  state.sel = { kind: 'polity', name: p.n };
  state.view = 'sel';
  state.eventId = null;
  remapPolity();
  if (fly && mapOk) map.fitBBox(p.bb);
  expandSheet();
  writeUrl();
  await render();
}

async function selectPolityByName(name, { fly }) {
  const doc = state.snapDoc;
  const k = doc ? doc.polities.findIndex((p) => p.n === name) : -1;
  if (k >= 0) return selectPolityByIndex(k, { fly });
  // not on this map: jump to the nearest map that has it
  const ys = await yearsOf(name);
  if (ys.length) {
    const best = ys.reduce((a, b) => (Math.abs(b - state.year) < Math.abs(a - state.year) ? b : a));
    await goToYear(best, { keepSel: false });
    return selectPolityByName(name, { fly });
  }
}

async function selectGone(name, since) {
  await goToYear(since, { keepSel: false });
  return selectPolityByName(name, { fly: true });
}

async function selectPower(key) {
  const doc = state.snapDoc;
  if (!doc) return;
  const k = doc.polities.findIndex((p) => p.p === key);
  if (k >= 0) return selectPolityByIndex(k, { fly: true });
}

let searchIndex = null;
async function yearsOf(name) {
  if (!searchIndex) {
    const { loadSearch } = await import('./data.js');
    searchIndex = await loadSearch();
  }
  const p = searchIndex.polities.find((x) => x[0] === name);
  if (!p) return [];
  const out = [];
  for (const r of p[1]) {
    if (!Array.isArray(r)) out.push(r);
    else for (let y = r[0]; y <= r[1]; y++) out.push(y);
  }
  return out;
}

async function selectUS(id, { fly }) {
  if (!usFC) usFC = await loadUS();
  const d = usDateInt();
  let f = usFC.features.find((x) => x.properties.id === id && x.properties.s <= d && x.properties.e >= d);
  if (!f) {
    // outside its years: go to the first year it exists
    const all = usFC.features.filter((x) => x.properties.id === id).sort((a, b) => a.properties.s - b.properties.s);
    if (!all.length) return;
    await goToYear(Math.floor(all[0].properties.s / 10000), { keepSel: false });
    f = all[0];
  }
  state.sel = { kind: 'us', id, name: f.properties.n, test: makeAreaTest([f.geometry]), props: f.properties };
  state.view = 'sel';
  state.eventId = null;
  if (mapOk) { map.selectPolity(null); map.setUSDate(usDateInt(), id); if (fly) map.fitBBox(bboxOf([f.geometry]), 6.5); }
  expandSheet();
  writeUrl();
  await render();
}

async function selectModern(iso, { fly }) {
  if (!modernFC) modernFC = await loadModern();
  const f = modernFC.features.find((x) => x.properties.iso === iso);
  if (!f) return;
  state.sel = { kind: 'modern', iso, name: f.properties.n, test: makeAreaTest([f.geometry]) };
  state.view = 'sel';
  state.eventId = null;
  toggleModern(true);
  if (mapOk) { map.selectPolity(null); if (fly) map.fitBBox(f.properties.bb, 5); }
  expandSheet();
  writeUrl();
  await render();
}

function clearSelection() {
  state.sel = null;
  state.view = 'year';
  state.eventId = null;
  if (mapOk) { map.selectPolity(null); map.selectEvent(null); if (state.year >= 1783 && state.year <= 2000) map.setUSDate(usDateInt()); }
  updateColonies();
  writeUrl();
  render();
}

/** Is this event in the selected area? */
function inSelection(e) {
  const s = state.sel;
  if (!s) return false;
  if (s.kind === 'modern') return e.mc === s.iso || (e.lo != null && !e.mc && s.test(e.lo, e.la));
  if (s.kind === 'us' || s.kind === 'colony') return e.ci === s.id || (e.lo != null && s.test(e.lo, e.la));
  if (e.p === s.name) return true;
  return !!(s.test && e.lo != null && s.test(e.lo, e.la));
}

async function renderSelection() {
  const token = state.token;
  const s = state.sel;
  const y = state.year;
  const head = await selectionHeader(s);
  if (token !== state.token || state.sel !== s) return;
  setBody(head, skeleton(3));
  let data;
  const y0 = addYears(y, -5), y1 = addYears(y, 5);
  try {
    data = await eventsBetween(y0, y1);
  } catch (e) {
    console.warn(e);
    if (token !== state.token) return;
    setBody(head, h('p.empty', null, 'The events could not load.'), h('button.more', { type: 'button', onclick: () => render() }, 'Try again'));
    return;
  }
  if (token !== state.token || state.sel !== s || state.view !== 'sel') return;
  const mine = filtered(data.events.filter(inSelection));
  const thisYear = rank(mine.filter((e) => e.y === y));
  const near = mine.filter((e) => e.y !== y);
  if (mapOk) map.setEvents([...thisYear, ...near], { near: new Set(near.map((e) => e.i)) });

  const tl = await loadTimeline(s);
  if (token !== state.token || state.sel !== s) return;
  const nodes = [head];
  if (tl?.rulers?.length) {
    const now = tl.rulers.filter(([, a, b]) => a <= y && (b != null ? b >= y : a === y));
    nodes.push(h('h2', null, `In office in ${formatYear(y)}`));
    if (now.length) nodes.push(h('ul.changes-list', null, now.slice(0, 8).map(([n, a, b, t]) =>
      h('li', null, h('b', null, n), `, ${t} (${formatYear(a)}${b != null ? '–' + formatYear(b) : ''})`))));
    else nodes.push(h('p.empty', null, 'No head of state or government recorded for this year.'));
    const all = h('details.ruled-hist', null, h('summary', null, `All ${tl.rulers.length} recorded terms (${tl.rulersOf})`),
      h('ol', null, tl.rulers.map(([n, a, b, t]) => h('li', null, `${formatYear(a)}${b != null ? '–' + formatYear(b) : ''}: ${n}, ${t}`))));
    nodes.push(all);
  }
  nodes.push(h('h2', null, `In ${formatYear(y)}`));
  if (thisYear.length) nodes.push(eventList(thisYear, listOpts(), 15));
  else {
    nodes.push(h('p.empty', null, `No events recorded here for ${formatYear(y)}.`));
    const ys = [...new Set((tl?.events || []).map((r) => r[1]))].filter((x) => x !== y)
      .sort((a, b) => Math.abs(a - y) - Math.abs(b - y)).slice(0, 4).sort((a, b) => a - b);
    if (ys.length) nodes.push(h('p.note', null, 'Nearest years with entries here: '),
      h('ul.pill-list', null, ys.map((ny) => h('li', null, h('button', { type: 'button', onclick: () => goToYear(ny) }, formatYear(ny))))));
  }
  nodes.push(h('h2', null, 'Nearby years'));
  const byYear = new Map();
  for (const e of near) { if (!byYear.has(e.y)) byYear.set(e.y, []); byYear.get(e.y).push(e); }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  if (!years.length) nodes.push(h('p.empty', null, `Nothing recorded here between ${formatYear(y0)} and ${formatYear(y1)}.`));
  for (const yy of years) {
    nodes.push(h('div.year-group', null, h('span', null, formatYear(yy)),
      h('button', { type: 'button', onclick: () => goToYear(yy) }, `Go to ${formatYear(yy)}`)));
    nodes.push(eventList(rank(byYear.get(yy)), { ...listOpts(), isToday: () => false }, 4));
  }
  const ongoing = filtered(data.ongoing.filter(inSelection)).slice(0, 5);
  if (ongoing.length) nodes.push(h('h2', null, 'Still going'), eventList(ongoing, { ...listOpts(), isToday: () => false }, 5));
  const chg = (await loadChanges()).filter((c) => Math.abs(c.y - y) <= 30 && s.test && s.test(c.lon, c.lat));
  if (token !== state.token || state.sel !== s) return;
  if (chg.length) {
    nodes.push(h('h2', null, 'Border changes recorded here'),
      h('p.note', null, state.snap && !state.snap.cs ? `The map shows ${formatYear(state.snap.y)} borders; these dated changes happened within 30 years of ${formatYear(y)}.` : `Within 30 years of ${formatYear(y)}.`),
      h('ul.changes-list', null, chg.map(changeRow)));
  }
  setBody(nodes);
}

async function selectionHeader(s) {
  const box = h('div');
  box.append(h('button.back', { type: 'button', onclick: clearSelection }, `← The world in ${formatYear(state.year)}`));
  if (s.kind === 'polity') {
    const p = s.p;
    box.append(h('p.kicker', null, 'Territory'), h('h1', null, s.name));
    box.append(historyLine(s.name));
    if (s.missing) {
      box.append(h('p.lead', null, `${s.name} is not on the ${state.snap ? formatYear(state.snap.y) : ''} map. Events below are inside its last outline.`));
      return box;
    }
    const facts = h('dl.facts');
    if (p.s && p.s !== p.n) facts.append(h('dt', null, 'Ruled by'), h('dd', null, p.s, p.cur ? h('span.unver', { title: 'From a curated list, not checked against Wikidata' }, ' unverified') : null));
    else facts.append(h('dt', null, 'Status'), h('dd', null, 'Independent or self-ruling on this map'));
    facts.append(h('dt', null, 'Area'), h('dd', null, `about ${fmtArea(p.a)}`));
    if (p.dated) {
      const f = (d) => formatDate(Math.floor(d / 10000), Math.floor(d / 100) % 100, d % 100);
      facts.append(h('dt', null, 'Map'), h('dd', null, `These borders held from ${f(p.dated[0])} to ${p.dated[1] >= 20191231 ? '2019 or later' : f(p.dated[1])} (CShapes)`));
    } else if (p.clio) facts.append(h('dt', null, 'Map'), h('dd', null, `Cliopatria gives this shape for ${p.clio[0]} to ${p.clio[1]} (approximate)`));
    else if (p.under) facts.append(h('dt', null, 'Map'), h('dd', null, `Not a state in Cliopatria: outline from the ${formatYear(p.under)} world sketch map (approximate, may be out of date)`));
    else facts.append(h('dt', null, 'Map'), h('dd', null, `Borders as of ${formatYear(state.snap.y)}${p.pr === 1 ? ', approximate' : ''}`));
    box.append(facts);
    try {
      const pd = await getJSON('polities.json').then((d) => d.polities.find((x) => x.names.includes(s.name))).catch(() => null);
      if (pd && (pd.from == null || pd.from - 25 <= state.year) && (pd.to == null || pd.to + 25 >= state.year)) {
        box.insertBefore(h('p.about', null, pd.text, h('span.unver', { title: pd.verified
          ? 'Written for GeoHistory; the years in it match Wikidata' : 'Written for GeoHistory; not every year in it could be confirmed in Wikidata' },
        pd.verified ? 'curated' : 'curated, unverified')), facts);
      }
    } catch { /* optional */ }
    try {
      entities = entities || await loadEntities();
      const info = entities[s.name];
      if (info) {
        // the same name can mean a different state in another era ("France" in 1000 is not the modern
        // republic): only show the description when Wikidata's dates fit the year on screen
        const y = state.year;
        // "mod": Wikidata dates today's state of this name from that year (independence, a new constitution);
        // "eras": the earlier states it replaced. Before "mod" show the era that fits, or say so plainly.
        const before = info.mod != null && y < info.mod - 25;
        const era = before ? (info.eras || []).find((c) => c.from - 25 <= y && (c.to ?? info.mod) + 25 >= y) : null;
        const shown = era || info;
        const fits = era ? true : before ? false
          : (info.mod != null || info.from == null || info.from - 25 <= y) && (info.to == null || info.to + 25 >= y);
        if (fits) {
          if (era) box.insertBefore(h('p.lead', null, `${era.n}${era.d ? ': ' + era.d : ''}`), facts);
          else if (info.d) box.insertBefore(h('p.lead', null, cap(info.d)), facts);
          const from = era ? era.from : (info.mod ?? info.from);
          const to = era ? era.to : info.to;
          if (from != null || to != null) facts.append(h('dt', null, 'Existed'), h('dd', null, `${from != null ? formatYear(from) : '?'} to ${to != null ? formatYear(to) : 'today'}`));
          if (!era && info.cap?.length) facts.append(h('dt', null, 'Capital'), h('dd', null, info.cap.join(', ')));
        } else if (before) {
          box.insertBefore(h('p.note', null, `Today's state of this name dates from ${formatYear(info.mod)}. On this map the name marks the land or an earlier realm.`), facts);
        }
        const links = h('p.note');
        if (shown.w) links.append(h('a.ext', { href: wikiUrl(shown.w), target: '_blank', rel: 'noopener' }, 'Wikipedia'), '  ');
        links.append(h('a.ext', { href: wikidataUrl(shown.q), target: '_blank', rel: 'noopener' }, 'Wikidata'));
        box.append(links);
      }
      const rulerInfo = p.s && p.s !== p.n ? entities[p.s] : null;
      if (rulerInfo?.d) box.append(h('p.note', null, `${p.s}: ${rulerInfo.d}.`));
    } catch { /* descriptions are optional */ }
    return box;
  }
  if (s.kind === 'colony') {
    box.append(h('p.kicker', null, colDate() >= 17760704 ? 'State' : 'British colony'), h('h1', null, s.name));
    box.append(h('dl.facts', null, h('dt', null, 'On the map'), h('dd', null, `${s.n} organized counties or parishes on ${formatDate(state.year, state.month || 12, state.day || 31)}`)));
    box.append(h('p.note', null, 'Colonies are drawn as their organized counties, with the exact dates in the Newberry Library\'s Atlas of Historical County Boundaries. Land not yet organized into counties, and colonial charter claims to the west, are not shown.'));
    return box;
  }
  if (s.kind === 'us') {
    const pr = s.props;
    if (s.missing) {
      box.append(h('p.kicker', null, 'US state or colony'), h('h1', null, s.name),
        h('p.lead', null, `No borders for ${s.name} on this date. Events below are inside its last outline.`));
      return box;
    }
    const t = pr.t === 'Colony' ? 'British colony' : pr.t === 'Other' ? 'Self-declared republic' : pr.t;
    box.append(h('p.kicker', null, t), h('h1', null, s.name));
    const from = String(pr.s), to = String(pr.e);
    const f = (x) => formatDate(+x.slice(0, 4), +x.slice(4, 6), +x.slice(6, 8));
    box.append(h('dl.facts', null, h('dt', null, 'These borders'), h('dd', null, `${f(from)} to ${to.startsWith('2000') ? 'today' : f(to)}`)));
    if (pr.approx) box.append(h('p.note', null, 'Approximate: drawn from the 1783 state borders. Colonial borders and western land claims were different and often disputed.'));
    if (pr.ch) box.append(h('p.lead', null, pr.ch), h('p.note', null, 'Text: Newberry Library, Atlas of Historical County Boundaries.'));
    return box;
  }
  box.append(h('p.kicker', null, "Today's country"), h('h1', null, s.name),
    h('p.lead', null, `Events that happened on the land that is ${s.name} today, whoever ruled it at the time.`));
  return box;
}

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

let changesP = null;
const loadChanges = () => (changesP = changesP || getJSON('changes.json').then((d) => d.changes).catch(() => []));

function changeRow(c) {
  return h('li', null, h('span.ch-date', null, formatDate(c.y, c.m, c.d)), ' ', c.text,
    c.verified ? null : h('span.unver', { title: c.check || 'Not confirmed by Wikidata' }, 'unverified'), ' ',
    h('a.ext', { href: c.source, target: '_blank', rel: 'noopener' }, 'source'));
}

/** "What changed this year": dated border changes (curated before 1886, CShapes after) and map changes. */
async function changeStrip(y) {
  const items = [];
  const doc = state.snapDoc;
  const curated = (await loadChanges()).filter((c) => c.y === y);
  for (const c of curated) items.push(changeRow(c));
  if (doc?.cs && doc.changes && doc.year === y) {
    const ch = doc.changes;
    for (const n of ch.appeared) items.push(h('li', null, h('b', null, n), ' appears on the map'));
    for (const n of ch.gone) items.push(h('li', null, h('b', null, n), ' leaves the map'));
    for (const r of ch.ruler || []) items.push(h('li', null, r));
  }
  if (!items.length) return null;
  return h('section.strip', { 'aria-label': 'What changed this year' }, h('h2', null, 'What changed this year'), h('ul.changes-list', null, items));
}

async function loadTimeline(s) {
  try {
    const idx = await getJSON('timelines/index.json');
    const key = s.kind === 'modern' ? 'iso:' + s.iso : s.name;
    const f = idx[key];
    return f ? await getJSON('timelines/' + f) : null;
  } catch { return null; }
}

/** "Who held it over time": runs of maps with the same ruler, loaded on demand. */
function historyLine(name) {
  const box = h('details.ruled-hist', null, h('summary', null, 'Who held it over time'));
  box.addEventListener('toggle', async () => {
    if (!box.open || box.dataset.done) return;
    box.dataset.done = '1';
    let d;
    try { d = await getJSON('history/ruledby.json'); } catch { box.append(h('p.empty', null, 'Could not load.')); return; }
    const runs = d[name] || [];
    if (!runs.length) { box.append(h('p.empty', null, 'Not recorded.')); return; }
    box.append(h('ol', null, runs.map(([a, b, r, src]) => {
      const span = a === b ? (src === 'm' ? `${formatYear(a)} map` : `${a}`) : (src === 'm' ? `maps of ${formatYear(a)} to ${formatYear(b)}` : `${a} to ${b}`);
      return h('li', null, `${span}: `, r ? `ruled by ${r}` : 'self-ruling');
    })));
    box.append(h('p.note', null, 'From the border maps only: a run means the same ruler on every map in that span, not that nothing changed between maps.'));
  });
  return box;
}

// ---------------------------------------------------------------- events
async function openEvent(id, { fly }) {
  let e = await findEvent(id);
  if (!e) {
    // maybe the panel for its year is not loaded yet
    await eventsBetween(addYears(state.year, -5), addYears(state.year, 5)).catch(() => {});
    e = await findEvent(id);
  }
  if (!e) return;
  if (e.y !== state.year && state.view !== 'sel') {
    await goToYear(e.y, { month: e.m || 0, day: e.dd || 0, keepEvent: true });
  }
  state.prevView = state.view === 'event' ? state.prevView : state.view;
  state.view = 'event';
  state.eventId = id;
  if (mapOk) {
    map.selectEvent(id);
    if (fly && e.lo != null) map.flyTo(e.lo, e.la, 5);
  }
  expandSheet();
  writeUrl();
  renderEvent();
}

async function renderEvent() {
  const e = await findEvent(state.eventId);
  if (!e) { state.view = state.sel ? 'sel' : 'year'; return render(); }
  const t = TYPES[e.t] || TYPES.other;
  const back = state.sel ? `← ${state.sel.name}` : `← The world in ${formatYear(state.year)}`;
  const nodes = [h('button.back', { type: 'button', onclick: closeEvent }, back),
    h('p.kicker', null, t.one), h('h1', null, e.l), h('p.lead', null, eventDate(e))];
  if (e.d) nodes.push(h('p', null, cap(e.d)));
  const facts = h('dl.facts');
  const place = placeLine(e, modernNames);
  if (place) facts.append(h('dt', null, 'Where'), h('dd', null, place));
  if (e.pa?.length) facts.append(h('dt', null, 'Who'), h('dd', null, e.pa.join(', ')));
  if (e.po) facts.append(h('dt', null, 'Part of'), h('dd', null, e.po));
  if (e.al?.length) facts.append(h('dt', null, 'Also called'), h('dd', null, e.al.join(', ')));
  if (e.dn) facts.append(h('dt', null, 'Dated'), h('dd', null, `${e.dn} (approximate)`));
  if (e.lo == null) facts.append(h('dt', null, 'On the map'), h('dd', null, e.mi ? 'No location recorded; listed under the country of the event it belongs to' : 'No location recorded'));
  else if (e.mi) facts.append(h('dt', null, 'On the map'), h('dd', null, 'Placed at the centre or capital of the state it is filed under'));
  else if (e.ap) facts.append(h('dt', null, 'On the map'), h('dd', null, 'Placed at the nearest known location'));
  nodes.push(facts);
  const links = h('p.note');
  if (e.w) links.append(h('a.ext', { href: wikiUrl(e.w), target: '_blank', rel: 'noopener' }, 'Read on Wikipedia'), '  ');
  if (/^Q\d+$/.test(e.i)) links.append(h('a.ext', { href: wikidataUrl(e.i), target: '_blank', rel: 'noopener' }, 'Wikidata'));
  nodes.push(links);
  if (e.src) nodes.push(h('p.note', null, 'Listed in ', h('a', { href: e.src, target: '_blank', rel: 'noopener' }, "Wikipedia's article for this year"),
    e.uv ? '. Its date could not be confirmed in Wikidata (unverified).' : ', and its date matches Wikidata.'));
  if (e.on) nodes.push(h('p.note', null, h('span.unver', null, 'corrected by hand'), ' ', e.on));
  if (e.dq) nodes.push(h('p.note', null, h('span.unver', null, 'doubtful date'), ' Wikidata dates this outside the war it is filed under. One of the two is wrong, so treat the date as unverified.'));
  if (e.cur === 1) nodes.push(h('p.note', null, 'From GeoHistory\'s hand-checked list of American Revolution events. Day and place are checked against the linked article.'));
  if (e.cur === 2) nodes.push(h('p.note', null, h('span.unver', null, e.uv ? 'curated, unverified' : 'curated'), e.uv
    ? ' Written for GeoHistory from general knowledge. Its date could not be confirmed in Wikidata.'
    : ' Written for GeoHistory; its year matches the Wikidata item of the linked article.'));
  if (e.lo != null) nodes.push(h('p', null, h('button.more', { type: 'button', onclick: () => mapOk && map.flyTo(e.lo, e.la, 6) }, 'Show on map')));
  setBody(nodes);
  els.body.scrollTop = 0;
}

function closeEvent() {
  state.view = state.sel ? 'sel' : 'year';
  state.eventId = null;
  if (mapOk) map.selectEvent(null);
  writeUrl();
  render();
}

// ---------------------------------------------------------------- search choices
async function chooseSearch(it) {
  if (it.k === 'p') return selectPolityByName(it.n, { fly: true });
  if (it.k === 'c') return selectPolityByName(it.alt[0], { fly: true });
  if (it.k === 'm') return selectModern(it.iso, { fly: true });
  if (it.k === 'u') return selectUS(it.id, { fly: true });
  if (it.k === 'e') {
    state.sel = null;
    state.view = 'year';
    if (mapOk) map.selectPolity(null);
    await goToYear(it.y, { keepSel: false });
    return openEvent(it.i, { fly: true });
  }
}

// ---------------------------------------------------------------- time bar
function showYearInput() {
  if (document.activeElement === els.year) return;
  els.year.value = state.month ? formatDate(state.year, state.month, state.day) : formatYear(state.year);
  els.year.removeAttribute('aria-invalid');
}

function setHint(text, err = false) {
  els.hint.textContent = text;
  els.hint.classList.toggle('err', err);
}

function updateSlider() {
  els.slider.value = Math.round(yearToFrac(state.year) * 1000);
  els.slider.setAttribute('aria-valuetext', formatYear(state.year));
}

function drawTicks() {
  els.ticks.replaceChildren();
  // one tick per border map: you can see where the borders change
  import('./data.js').then(({ loadBordersIndex: li }) => li()).then((snaps) => {
    for (const s of snaps) els.ticks.append(h('i', { style: `left:${(yearToFrac(s.y) * 100).toFixed(2)}%`, title: `Border map ${formatYear(s.y)}` }));
  });
  els.eras.replaceChildren(...ERAS.map((e) => h('span', { style: `left:${(yearToFrac(e.y) * 100).toFixed(2)}%` },
    h('span.lg', null, e.label), e.short ? h('span.sm', null, e.short) : null)));
}

let playTimer = null;
function setupTimebar() {
  els.form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    stopPlay();
    const r = parseYear(els.year.value);
    if (r.error) {
      els.year.setAttribute('aria-invalid', 'true');
      setHint(r.error, true);
      return;
    }
    els.year.blur();
    goToYear(r.year, { month: r.month || 0, day: r.day || 0 });
  });
  els.year.addEventListener('input', () => { els.year.removeAttribute('aria-invalid'); setHint(''); });
  for (const b of document.querySelectorAll('[data-step]')) {
    b.addEventListener('click', () => { stopPlay(); step(+b.dataset.step); });
  }
  let pending = null;
  els.slider.addEventListener('input', () => {
    stopPlay();
    const y = fracToYear(els.slider.value / 1000);
    els.year.value = formatYear(y);
    els.slider.setAttribute('aria-valuetext', formatYear(y));
    clearTimeout(pending);
    pending = setTimeout(() => goToYear(y, { fromSlider: true }), 140);
  });
  els.slider.addEventListener('keydown', (e) => {
    const map_ = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 };
    if (e.key in map_) {
      e.preventDefault();
      stopPlay();
      step(map_[e.key] * (e.shiftKey ? 100 : 1));
    }
  });
  els.play.addEventListener('click', () => (playTimer ? stopPlay() : startPlay()));
}

function step(n) {
  goToYear(addYears(state.year, n), { month: 0, day: 0 });
}

function startPlay() {
  els.play.setAttribute('aria-pressed', 'true');
  els.play.setAttribute('aria-label', 'Pause');
  const tick = () => {
    if (state.year >= MAX_YEAR) return stopPlay();
    step(1);
  };
  playTimer = setInterval(tick, 1600);
}

function stopPlay() {
  if (!playTimer) return;
  clearInterval(playTimer);
  playTimer = null;
  els.play.setAttribute('aria-pressed', 'false');
  els.play.setAttribute('aria-label', 'Play, one year at a time');
}

function globalKeys(e) {
  const t = e.target;
  const typing = t.closest?.('input, textarea, select, [contenteditable]');
  if (e.key === '/' && !typing) { e.preventDefault(); $('#q').focus(); return; }
  if (typing || t.closest?.('.maplibregl-canvas-container, dialog') || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    stopPlay();
    step((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1));
  } else if (e.key === 'Escape' && state.view !== 'year') {
    if (state.view === 'event') closeEvent(); else clearSelection();
  }
}

// ---------------------------------------------------------------- panel, tools, url
function setupPanel() {
  els.handle.addEventListener('click', () => {
    const order = ['peek', 'half', 'full'];
    const next = order[(order.indexOf(els.panel.dataset.size) + 1) % order.length];
    setSheet(next);
  });
  new ResizeObserver(() => applyPadding()).observe(els.panel);
  window.addEventListener('resize', applyPadding);
}

function setSheet(size) {
  els.panel.dataset.size = size;
  els.handle.setAttribute('aria-expanded', size === 'peek' ? 'false' : 'true');
  els.handle.setAttribute('aria-label', size === 'full' ? 'Shrink panel' : 'Expand panel');
}

function expandSheet() {
  if (window.innerWidth < 900 && els.panel.dataset.size === 'peek') setSheet('half');
}

function applyPadding() {
  if (!mapOk || window.NOPAD) return;
  const w = window.innerWidth;
  if (w >= 900) map.setPadding({ top: 40, bottom: 20, left: 20, right: els.panel.offsetWidth + 24 });
  else map.setPadding({ top: 40, bottom: Math.min(els.panel.offsetHeight, window.innerHeight * 0.5), left: 0, right: 0 });
}

function setupTools() {
  const setProjLabel = () => {
    els.proj.textContent = state.projection === 'globe' ? 'Globe' : 'Flat';
    els.proj.setAttribute('aria-label', state.projection === 'globe' ? 'Globe view. Switch to flat map' : 'Flat map. Switch to globe');
  };
  setProjLabel();
  els.proj.addEventListener('click', () => {
    state.projection = state.projection === 'globe' ? 'mercator' : 'globe';
    setPref('projection', state.projection);
    setProjLabel();
    if (mapOk) map.setProjection(state.projection);
    writeUrl();
  });
  els.modernBtn.addEventListener('click', () => toggleModern(!state.modern));
  els.sourcesBtn.addEventListener('click', openSources);
  els.sources.addEventListener('click', (e) => { if (e.target === els.sources || e.target.closest('[data-close]')) els.sources.close(); });
  els.badge.addEventListener('click', () => {
    const open = els.badgeInfo.hidden;
    if (open) els.badgeInfo.replaceChildren(...badgeText());
    els.badgeInfo.hidden = !open;
    els.badge.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  // modern country names for event place lines (small, from the search file)
  import('./data.js').then(({ loadSearch }) => loadSearch()).then((d) => {
    for (const m of d.modern) modernNames[m[1]] = m[0];
  }).catch(() => {});
}

async function toggleModern(on) {
  state.modern = on;
  els.modernBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  if (on && !modernFC) {
    try { modernFC = await loadModern(); } catch { return; }
  }
  if (mapOk) map.setModern(modernFC, on);
  writeUrl();
}

async function openSources() {
  const body = els.sourcesBody;
  if (!body.dataset.filled) {
    body.replaceChildren(h('p', null, 'Loading…'));
    let meta = null, audit = null;
    try { meta = await loadMeta(); } catch { /* still show the text */ }
    try { audit = await getJSON('audit.json'); } catch { /* optional */ }
    body.replaceChildren(...sourcesContent(meta, audit));
    body.dataset.filled = '1';
  }
  els.sources.showModal();
}

function sourcesContent(meta, audit) {
  const n = (x) => (x == null ? '?' : Number(x).toLocaleString('en-GB'));
  const c = meta?.counts || {};
  return [
    h('p', null, 'GeoHistory is a way to explore the past, not an authority on it. Please check anything important against a good history book or the linked articles.'),
    h('h3', null, 'Borders'),
    h('p', null, `From 1886 to 2019 the map uses CShapes 2.0, which dates every change of state borders. From 1700 to 1885 it uses Cliopatria, which gives each state a shape for a range of years: there is a map for every year, but it is approximate, and peoples without a state are filled in from an older sketch map. Before 1700 there are only ${n(c.snapshots)} world snapshots, from ${formatYear(meta?.borders?.first ?? MIN_YEAR)} on: for any other year you see the nearest earlier one, and the badge on the map says which. Borders before about 1500 are rough sketches; many places had no fixed borders.`),
    h('h3', null, 'Events come from Wikidata'),
    h('p', null, `${n(c.events)} events, from Wikidata's free database, ranked by how many Wikipedia language editions cover them. Dates, places and descriptions can be wrong or missing, and coverage is much thinner for Africa, Asia and the distant past than for Europe and North America. ${n(c.placedInModernCountry || 0)} of them could be placed in one of today's countries.`),
    h('p', null, `English Wikipedia's year articles add ${n(c.yearArticleEvents || 0)} more (only entries whose linked article Wikidata dates to the same year). Archaeological cultures and periods are listed with approximate dates.`),
    h('h3', null, 'Curated text'),
    h('p', null, `Decade summaries from 1500, short descriptions of major states and ${n(c.curated)} events for major periods were written for GeoHistory. Each is checked against Wikidata by its year and tagged "curated", or "curated, unverified" when Wikidata has no matching date.`),
    h('h3', null, 'Accuracy check'),
    h('p', null, audit ? `On ${audit.date} the data was checked against ${audit.facts} well-known facts (dates of events, reigns, who held a city in a given year): ${audit.passed} passed (${Math.round(audit.rate * 100)}%). Entries marked "unverified" or "curated" were written by hand or could not be confirmed in Wikidata.` : 'The accuracy check has not been run for this build.'),
    h('h3', null, 'Sources'),
    h('ul', null,
      h('li', null, h('a', { href: 'https://github.com/aourednik/historical-basemaps', target: '_blank', rel: 'noopener' }, 'historical-basemaps'), ' by André Ourednik and contributors: world borders by year (GPL-3.0).'),
      h('li', null, h('a', { href: 'https://publications.newberry.org/ahcb/', target: '_blank', rel: 'noopener' }, 'Atlas of Historical County Boundaries'), ', Newberry Library: US state and territory borders since 1783.'),
      h('li', null, h('a', { href: 'https://github.com/Seshat-Global-History-Databank/cliopatria', target: '_blank', rel: 'noopener' }, 'Cliopatria'), ' (Seshat Global History Databank): state shapes for every year from 1700 to 1885 (CC BY 4.0).'),
      h('li', null, h('a', { href: 'https://icr.ethz.ch/data/cshapes/', target: '_blank', rel: 'noopener' }, 'CShapes 2.0'), ': dated state borders 1886 to 2019 (CC BY-NC-SA, non-commercial).'),
      h('li', null, h('a', { href: 'https://www.naturalearthdata.com/', target: '_blank', rel: 'noopener' }, 'Natural Earth'), ': coastlines and today\'s countries (public domain).'),
      h('li', null, h('a', { href: 'https://www.wikidata.org/', target: '_blank', rel: 'noopener' }, 'Wikidata'), ': events and descriptions (CC0). Links go to Wikipedia.'),
      h('li', null, h('a', { href: 'https://maplibre.org/', target: '_blank', rel: 'noopener' }, 'MapLibre GL JS'), ' (BSD licence) draws the map; labels use Noto Sans (SIL Open Font License).')),
    h('p', null, 'Full credits and licences: ', h('a', { href: 'https://github.com/ngcoding10/geohistory/blob/main/CREDITS.md', target: '_blank', rel: 'noopener' }, 'CREDITS.md'),
      '. Data built on ', meta?.built || '?', '.'),
    h('p', null, h('a', { href: 'privacy.html' }, 'Privacy'), ' · ', h('a', { href: 'terms.html' }, 'Terms'), ' · ',
      h('a', { href: 'https://github.com/ngcoding10/geohistory/issues', target: '_blank', rel: 'noopener' }, 'Report a mistake')),
  ];
}

function writeUrl() {
  const p = new URLSearchParams();
  p.set('y', String(state.year));
  if (state.month) p.set('d', state.day ? `${state.month}-${state.day}` : String(state.month));
  const s = state.sel;
  if (s?.kind === 'polity') p.set('c', s.name);
  if (s?.kind === 'us') p.set('s', s.id);
  if (s?.kind === 'colony') p.set('col', s.st);
  if (s?.kind === 'modern') p.set('mc', s.iso);
  if (state.view === 'event' && state.eventId) p.set('e', state.eventId);
  if (state.projection === 'mercator') p.set('v', 'flat');
  if (state.modern) p.set('mb', '1');
  const url = '?' + p.toString();
  if (url !== location.search) history.replaceState(null, '', url);
  document.title = `${formatYear(state.year)}${s ? ' · ' + s.name : ''} · GeoHistory`;
}

// exposed for the end-to-end test only
window.__geo = { state, goToYear: (y) => goToYear(y), get map() { return map; } };
