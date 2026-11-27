// GeoHistory: choose a year, see the world's borders, powers and events at that time.
import { HistoryMap, isDark, Z_SPLIT, hatchColor } from './map.js';
import { prepareDoc, setFlagColors, modernOf } from './prepare.js';
import { loadFlagColors, loadFlags, ensureSheet, badgeFeatures, flagBlock, flagFor } from './flags.js';
import { Travel, SPEEDS, reducedMotion } from './travel.js';
import { membershipOf, empireName, listedParts, tones, vividColor, hexDist } from './groups.js';
import {
  loadBordersIndex, snapshotFor, nextSnapshotAfter, datedRange, clioRange, loadSnapshot, loadEventsIndex, eventsBetween, nearestYearsWithEvents,
  loadPowers, loadEntities, getJSON, loadUS, loadModern, loadSea, loadMeta, countFor, findEvent, loadEmpires, loadSuccession, loadOccupations, loadShape, decodeGeom,
  storedYears,
} from './data.js';
import { parseYear, formatYear, formatDate, addYears, yearToFrac, fracToYear, ERAS, MIN_YEAR, MAX_YEAR } from './year.js';
import { renderKey } from './key.js';
import { TYPES, TYPE_KEYS } from './types.js';
import { getPref, setPref } from './store.js';
import { makeAreaTest, bboxOf } from './geo.js';
import { Search } from './search.js';
import { h, eventList, filterChips, skeleton, fmtArea, wikiUrl, wikidataUrl, eventDate, placeLine, dayLabel } from './ui.js';

const $ = (s) => document.querySelector(s);
const els = {
  year: $('#year'), form: $('#yearForm'), hint: $('#yearHint'), slider: $('#slider'), ticks: $('#ticks'), eras: $('#eras'),
  play: $('#playBtn'), speed: $('#speedSel'), prevCh: $('#prevChange'), nextCh: $('#nextChange'), thumbYear: $('#thumbYear'), timeline: $('#timeline'), key: $('#key'), panel: $('#panel'), body: $('#panelBody'), handle: $('#sheetHandle'), status: $('#mapStatus'),
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
  warOn: getPref('wars', true),
  wars: [],             // the wars shown on the map this year (for the key)
  warIds: new Set(),
  token: 0,
};
const SL = 4000;   // timeline slider resolution
let map = null;
let mapOk = false;
let travel = null;
let powers = {};
let entities = null;
let modernNames = {};
let modernFC = null;
let usFC = null;
let empires = { empires: {}, rows: {}, undrawn: {}, notes: [] };
let occupations = { rows: [] };
const US_FILL_UNTIL = 1912;   // Arizona, the last contiguous state, was admitted in 1912
// The eleven states of the Confederacy with the day each passed its ordinance of secession (yyyymmdd), and
// the surrender of the last large Confederate army (26 May 1865). Between those days the state is filled in
// the Confederacy's colour. Source: https://en.wikipedia.org/wiki/Confederate_States_of_America
const SECEDED = { sc_state: 18601220, ms_state: 18610109, fl_state: 18610110, al_state: 18610111, ga_state: 18610119, la_state: 18610126,
  tx_state: 18610201, va_state: 18610417, ar_state: 18610506, nc_state: 18610520, tn_state: 18610608 };
const CSA_END = 18650526;

/** A power's colour on the map shown (it can differ from its own colour where a neighbour holds that one). */
function pcolor(key) {
  return state.snapDoc?.powerColor?.get(key) || vividColor(key || '', powers[key]?.color);
}

// ---------------------------------------------------------------- start
init().catch((err) => {
  console.error(err);
  showStatus('GeoHistory could not finish loading. Reload the page to try again.', true);
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
  const want = { c: p.get('c'), s: p.get('s'), mc: p.get('mc'), e: p.get('e'), col: p.get('col'), em: p.get('em') };

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
    map.addEventListener('polity', (e) => selectPolityByIndex(e.detail.k, { fly: false, whole: e.detail.whole }));
    map.addEventListener('usstate', (e) => selectUS(e.detail.id, { fly: false }));
    map.addEventListener('colony', (e) => selectColony(e.detail, { fly: false }));
    map.addEventListener('event', (e) => openEvent(e.detail, { fly: false, stay: state.warIds.has(e.detail) }));
    map.addEventListener('empty', () => { if (state.view !== 'year') { clearSelection(); } });
    // the coast: a coarse sea at world zoom (a fifth of the size), the full one once the map is zoomed in
    let fullSea = false;
    const seaFull = (force) => {
      if (fullSea || (map.map.getZoom() < 2.4 && force !== true)) return;
      fullSea = true;
      loadSea().then((d) => map.setSea(d)).catch((e) => console.warn(e));
    };
    if (map.map.getZoom() >= 2.4) seaFull();
    else {
      loadSea(true).then((d) => { if (!fullSea) map.setSea(d); }).catch(() => seaFull(true));
      map.map.on('zoomend', seaFull);
    }
    applyPadding();
  }).catch((err) => {
    console.warn('map failed', err);
    showStatus('This browser cannot draw the map (it needs WebGL). You can still read each year in the panel.', true);
  });

  const [, , pw, em, oc, fc] = await Promise.all([loadBordersIndex(), loadEventsIndex(), loadPowers(), loadEmpires(), loadOccupations(),
    loadFlagColors().catch(() => null)]);
  setFlagColors(fc);
  powers = pw;
  empires = em;
  occupations = oc;
  drawTicks();
  await mapReady;
  if (mapOk) { setupTravel(); map.setWarVisible(state.warOn); }
  drawKey();
  await goToYear(state.year, { month: state.month, day: state.day, keepSel: false });
  if (state.modern) toggleModern(true);
  if (want.em) await selectEmpire(want.em, { fly: true });
  else if (want.c) await selectPolityByName(want.c, { fly: true });
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
async function goToYear(year, { month = 0, day = 0, keepSel = true, fromSlider = false, keepEvent = false, fromTravel = false } = {}) {
  year = Math.max(MIN_YEAR, Math.min(MAX_YEAR, year));
  if (!fromTravel && travel?.running) { travel.cancel(); playUI(false); document.body.classList.remove('travelling'); }
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
        state.sig = prepareDoc(doc, { emp: empires, powers, year: state.year, dark: isDark() });
        if (mapOk) map.setSnapshot(doc);
      } catch (e) {
        console.warn(e);
        showStatus('The borders for this year did not load. Check your connection and try again.', true);
      }
    } else {
      state.snapDoc = null;
      if (mapOk) map.setSnapshot(null);
    }
  } else if (state.snapDoc) {
    // the same stored map, another year: memberships are dated by year, so the groups can still change
    const sig = prepareDoc(state.snapDoc, { emp: empires, powers, year: state.year, dark: isDark() });
    if (sig !== state.sig) { state.sig = sig; if (mapOk) map.setSnapshot(state.snapDoc, { fade: false }); }
  }
  updateBadge();
  updateOccupied();
  updateWar(state.year);
  updateFlags();
  await updateUS();
  if (token !== state.token) return;

  // keep a selected territory across years (matched by name); close an open event that belongs to another year
  if (keepSel && state.sel?.kind === 'polity') remapPolity();
  if (keepSel && state.sel?.kind === 'us') remapUS();
  if (keepSel && state.sel?.kind === 'empire') remapEmpire();
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
// counties in what are now other states belonged to these colonies (Maine to Massachusetts; the counties of
// today's West Virginia and Kentucky to Virginia; the Washington District, today's Tennessee, to North Carolina)
const COL_PARENT = { ME: 'MA', WV: 'VA', KY: 'VA', TN: 'NC' };
const colParent = (st) => COL_PARENT[st] || st;
const colDate = () => state.year * 10000 + (state.month || 12) * 100 + (state.day || (state.month ? 28 : 31));
function colonyName(st, date) {
  const states = colFC?.states || {};
  if (date >= 17760704) return st === 'ME' ? 'Massachusetts' : st === 'VT' ? 'Vermont' : `${states[st] || st} (state)`;
  return COLONY_NAMES[st] || states[st] || st;
}
function colonyUnits(st, date) {
  return (colFC?.features || []).filter((f) => f.properties.s <= date && f.properties.e >= date && colParent(f.properties.st) === st);
}
async function updateColonies() {
  const y = state.year;
  if (y < 1607 || y > 1783 || colDate() >= 17830903) { if (mapOk && map._colOn) { map.setColonies(null, null); map._colOn = false; } return; }
  try {
    if (!colFC) {
      colFC = await getJSON('us/colonies.json');
      for (const f of colFC.features) f.geometry = decodeGeom(f.geometry);   // rings come encoded (tools/build_colonies.py)
      const codes = Object.keys(colFC.states);
      for (const f of colFC.features) f.properties.c = COL_COLORS[Math.max(0, codes.indexOf(colParent(f.properties.st))) % COL_COLORS.length];
    }
    const d = colDate();
    const best = {};
    for (const f of colFC.features) {
      const p = f.properties;
      if (p.s > d || p.e < d) continue;
      const st = colParent(p.st);
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
  st = colParent(st);
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

async function updateUS({ dur = 0 } = {}) {
  await updateColonies();
  const y = state.year;
  if (y < 1783 || y > 2000) { if (mapOk && map.usDate != null) map.setUSDate(null); return; }
  try {
    if (!usFC) { usFC = await loadUS(); if (mapOk) map.setUS(usFC); }
    if (mapOk) map.setUSDate(usDateInt(), state.sel?.kind === 'us' ? state.sel.id : null, { dur });
    // 1783 to 1912: fill states, organized territories and unorganized territory in three tints of the US colour
    if (mapOk) {
      const pw = await loadPowers();
      const d = usDateInt();
      const seceded = d <= CSA_END ? Object.keys(SECEDED).filter((id) => SECEDED[id] <= d) : [];
      map.setUSFill(y <= US_FILL_UNTIL ? pcolor('usa') : null,
        { seceded, csaColor: pcolor('confederate states of america') });
    }
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
  const exact = s.y === state.year || s.src === 'clio';
  els.badge.textContent = s.src === 'clio' ? `Borders in ${formatYear(state.year)} (approximate)` : s.cs ? `Borders on 1 July ${s.y}` : `Borders as of ${formatYear(s.y)}`;
  els.badge.classList.toggle('exact', exact);
  // a note that concerns the whole map this year (wartime occupation and the like) is flagged on the badge
  const yy = state.year;
  worldNotes(yy).then((ns) => { if (ns.length && state.year === yy && !els.badge.textContent.includes('see note')) els.badge.textContent += ' · see note'; });
}

function usNote() {
  const y = state.year;
  if (y < 1607 || y > 2000) return null;
  return h('p', null, y < 1783
    ? 'In North America the colonies are drawn from their organized counties on this date (exact dates, Newberry Library).'
    : y <= US_FILL_UNTIL
      ? 'Inside the United States the map shows states (full colour), organized territories (lighter) and unorganized territory (lightest) with their borders on this date (Newberry Library atlas). Click one for its history.'
        + (y >= 1860 && y <= 1865 ? ' The states that had seceded are drawn in the colour of the Confederacy, from the day each seceded until May 1865.' : '')
      : 'Dashed lines in the United States show state borders on this date.');
}

function badgeText() {
  const s = state.snap;
  if (!s) return [h('p', null, `The border maps start in ${formatYear(MIN_YEAR)}.`)];
  const next = nextSnapshotAfter(s.y);
  const out = [];
  for (const nt of (mapNotesDoc?.notes || [])) {
    if (nt.world && state.year >= nt.from && state.year <= nt.to) out.push(h('p', null, h('b', null, 'Note. '), nt.note));
  }
  if (s.src === 'clio') {
    out.push(h('p', null, `From ${formatYear(clioRange()[0])} to ${clioRange()[1]} the map uses Cliopatria (Seshat Global History Databank), which gives each state a shape for a range of years. You see the shapes it lists for ${formatYear(state.year)}${s.y !== state.year ? ` (nothing changes in its data between ${formatYear(s.y)} and ${formatYear(state.year)})` : ''}. They are approximate: the source redraws a state only every few years (every few decades in antiquity), and border dates can be a few years off. Borders before about 1500 are rough: many places had no fixed borders.`));
    out.push(h('p', null, 'Cliopatria only draws states. Peoples and regions without a state are filled in from the nearest earlier world sketch map (historical-basemaps); click one to see which map it comes from.'));
    if (usNote()) out.push(usNote());
    out.push(h('p', null, h('button.more', { type: 'button', onclick: openSources }, 'Sources and accuracy')));
    return out;
  }
  if (s.cs) {
    out.push(h('p', null, `From ${datedRange()[0]} to ${datedRange()[1]} the map uses CShapes 2.0, which dates every change of state borders. You see the borders as they stood on 1 July ${s.y}.`));
    out.push(h('p', null, 'Rulers of colonies come from the older world maps or from a short curated list, so they can lag a change by a few years.'));
    if (usNote()) out.push(usNote());
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
      : state.year <= US_FILL_UNTIL
        ? 'Inside the United States the map shows states (full colour), organized territories (lighter) and unorganized territory (lightest) with their borders on this date (Newberry Library atlas). Click one for its history.'
        : 'Dashed lines in the United States show state borders on this date.'));
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
      h('p.empty', null, 'The events for this year did not load.'),
      h('button.more', { type: 'button', onclick: () => render() }, 'Try again'));
    return;
  }
  if (token !== state.token || state.view !== 'year' || state.sel) return;
  const all = data.events;
  const shown = rank(filtered(all));
  await updateWar(y, data);
  if (token !== state.token || state.view !== 'year' || state.sel) return;
  if (mapOk) map.setEvents(shown.filter((e) => !state.warIds.has(e.i)));
  const nodes = [h('p.kicker', null, 'Year'), h('h1', null, `The world in ${formatYear(y)}`)];
  if (state.month) nodes.push(h('p.lead', null, `Highlighting ${dayLabel(state.month, state.day)}.`));
  nodes.push(h('p.note', null, `${all.length} ${all.length === 1 ? 'event' : 'events'} recorded · `,
    state.snap ? (state.snap.src === 'clio' ? `map borders in ${formatYear(state.year)}, approximate` : state.snap.cs ? `map borders on 1 July ${state.snap.y}` : `map borders as of ${formatYear(state.snap.y)}`) : 'no border map this early'));

  const cen = await getJSON('centuries.json').then((d) => d.centuries.find((c) => c.from <= y && c.to >= y)).catch(() => null);
  const dec = y >= 1500 ? await getJSON('decades.json').then((d) => d.decades.find((c) => c.from <= y && c.to >= y)).catch(() => null) : null;
  if (dec) nodes.push(h('p.lead.century', null, h('b', null, `The ${dec.from}s. `), dec.text, h('span.unver', { title: dec.verified
    ? 'Written for GeoHistory; every event it names is dated to this decade by Wikidata' : 'Written for GeoHistory; not every statement could be confirmed in Wikidata' },
  dec.verified ? 'curated' : 'curated, unverified')));
  else if (cen) nodes.push(h('p.lead.century', null, cen.text, h('span.unver', { title: 'Curated summary, not checked against a dataset' }, 'curated')));
  for (const nt of await worldNotes(y)) {
    nodes.push(h('p.note.worldnote', null, h('span.unver', { title: 'A known limit of the border source, written for GeoHistory' }, 'map note'), ' ', nt.note, ' ',
      h('a', { href: nt.source, target: '_blank', rel: 'noopener' }, 'Source')));
  }
  const occ = occupiedNow();
  if (occ.length) {
    // one group per occupier, each led by a swatch of its hatch colour: this is the legend of the hatching
    const by = new Map();
    for (const o of occ) { if (o.quiet) continue; if (!by.has(o.by)) by.set(o.by, []); by.get(o.by).push(o); }
    const onMap = (o) => state.snapDoc?.polities.find((p) => o.n.includes(p.n) || (o.in || []).includes(p.n));
    nodes.push(h('div.note.worldnote', null, h('span.unver', { title: 'From GeoHistory\'s dated list of occupations; drawn hatched on the map' }, 'occupied'), ' ',
      [...by.entries()].map(([who, lst], i) => [i ? '; ' : '',
        h('span.hatchsw', { style: `--hc:${hatchColor(pcolor(lst[0].key), isDark())}`, title: `Lines of this colour on the map: ${lst[0].kind === 'Annexed' ? 'annexed' : 'occupied or controlled'} by ${who}` }),
        h('b', null, `by ${who}: `), lst.map((o, j) => [j ? ', ' : '',
          onMap(o) ? h('button.link', { type: 'button', onclick: () => selectPolityByName(onMap(o).n, { fly: true }) }, o.label) : o.label])]),
      '. On the map each keeps its own colour, made faint, under lines in the occupier\'s colour; the borders are still the recognised ones.'));
  }
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
    else nodes.push(h('p.empty', null, 'Every event type is switched off. Turn one back on above.'));
  } else {
    const near = nearestYearsWithEvents(y, 4).filter((x) => x !== y);
    nodes.push(h('p.empty', null, `No events recorded for ${formatYear(y)} yet.`));
    if (near.length) nodes.push(h('p.note', null, 'Nearby years with events: '),
      h('ul.pill-list', null, near.map((ny) => h('li', null, h('button', { type: 'button', onclick: () => goToYear(ny) }, formatYear(ny))))));
  }
  const ongoing = rank(filtered(data.ongoing)).slice(0, 8);
  if (ongoing.length) {
    nodes.push(h('h2', null, 'Still under way'));
    nodes.push(eventList(ongoing, { ...listOpts(), isToday: () => false }, 6));
  }

  const doc = state.snapDoc;
  if (doc) {
    nodes.push(h('h2', null, `Largest territories on the ${formatYear(doc.year)} map`));
    const ul = h('ul.legend');
    for (const p of doc.largest.slice(0, 10)) {
      const col = tones(pcolor(p.p), p.name, isDark()).fill;
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


// ---------------------------------------------------------------- war on the map
// For the year shown: the major wars going on (by how notable they are) and the battles fought that year at a
// recorded place, battles of those wars first. At most 8 battles at world zoom (24 when zoomed in) and 3 war
// markers (only for wars none of whose battles is shown). The land where a shown battle was fought gets a red
// edge. Nothing here is inferred: names, years, places and participants are the event data's own.
const WAR_MAX = 24, WAR_WORLD = 8, WAR_WARS = 6;
let warTok = 0;
async function updateWar(y, data = null) {
  if (!mapOk) return;
  const tok = ++warTok;
  if (!state.warOn) { state.wars = []; state.warIds = new Set(); map.setWar({}); drawKey(); return; }
  try { data = data || await eventsBetween(y, y); } catch { return; }
  if (tok !== warTok || y !== state.year) return;
  const wars = [...data.events, ...data.ongoing].filter((e) => e.t === 'war' && e.y <= y && (e.y2 || e.y) >= y)
    .sort((a, b) => b.s - a.s).slice(0, WAR_WARS);
  const major = new Set(wars.map((e) => e.i));
  const battles = data.events.filter((e) => e.t === 'battle' && e.y === y && e.lo != null && !e.mi)
    .sort((a, b) => (b.s + (major.has(b.pq) ? 40 : 0)) - (a.s + (major.has(a.pq) ? 40 : 0)))
    .slice(0, WAR_MAX);
  // at world zoom: at most WAR_WORLD battles, none within 2.5 degrees of another (a front's many battles would
  // stack up); the others show once zoomed in
  const world = [];
  for (const e of battles) {
    if (world.length >= WAR_WORLD) break;
    if (world.every((o) => Math.hypot(o.lo - e.lo, o.la - e.la) > 2.5)) world.push(e);
  }
  const worldSet = new Set(world);
  battles.sort((a, b) => worldSet.has(b) - worldSet.has(a));
  const shownWar = new Set(world.map((e) => e.pq).filter(Boolean));
  const warMk = wars.filter((e) => e.lo != null && !e.mi && !shownWar.has(e.i)).slice(0, 3);
  const markers = [
    ...battles.map((e) => ({ id: e.i, kind: 'battle', lo: e.lo, la: e.la, minor: !worldSet.has(e), label: `${e.l}, ${formatYear(e.y)}${e.po ? ` (${e.po})` : ''}` })),
    ...warMk.map((e) => ({ id: e.i, kind: 'war', lo: e.lo, la: e.la, label: `${e.l}, ${eventDate(e)}` })),
  ];
  // the territories (single states or parts of empires, not whole empires) under the battles shown at world zoom
  const doc = state.snapDoc;
  const groups = new Set();
  if (doc) {
    for (const e of world) {
      for (const f of doc.features) {
        if (f.properties.u === 1) continue;
        f._bb ||= bboxOf([f.geometry]);
        const bb = f._bb;
        if (!bb || e.lo < bb[0] || e.lo > bb[2] || e.la < bb[1] || e.la > bb[3]) continue;
        f._test ||= makeAreaTest([f.geometry]);
        if (f._test(e.lo, e.la)) { groups.add(f.properties.k); break; }
      }
    }
  }
  state.wars = wars;
  state.warIds = new Set(markers.map((m) => m.id));
  map.setWar({ markers, groups: [...groups] });
  drawKey();
}

// flag badges: the flag of each state at the time, beside its name (js/flags.js). Set when the map rests; hidden
// while the years run.
let flagTok = 0;
async function updateFlags() {
  if (!mapOk) return;
  const tok = ++flagTok;
  const y = state.year, doc = state.snapDoc;
  try {
    await loadFlags();
    await ensureSheet(map.map, y);
  } catch (e) { console.warn('flags', e); return; }
  if (tok !== flagTok || y !== state.year || doc !== state.snapDoc) return;
  map.setBadges(badgeFeatures(doc, y, empires));
}

function drawKey() {
  renderKey(els.key, {
    doc: state.snapDoc, year: state.year, dark: isDark(), wars: state.wars, warOn: state.warOn,
    onWar: (on) => { state.warOn = on; setPref('wars', on); if (mapOk) map.setWarVisible(on); updateWar(state.year); if (state.view === 'year' && !state.sel) render(); },
    onOpenWar: (id) => openEvent(id, { fly: true, stay: true }),
  });
}

/** Map notes that concern the whole map in a year (wartime occupation, a region the sources leave blank). */
let mapNotesDoc = null;
async function worldNotes(y) {
  try {
    const mn = mapNotesDoc = await getJSON('mapnotes.json');
    return mn.notes.filter((nt) => nt.world && y >= nt.from && y <= nt.to);
  } catch { return []; }
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
async function selectPolityByIndex(k, { fly, whole = false }) {
  const doc = state.snapDoc;
  if (!doc || k == null || k < 0) return;
  const p = doc.polities[k];
  if (whole && p.e && doc.groups[p.g]?.members.length > 1) return selectEmpire(p.e, { fly });
  state.sel = { kind: 'polity', name: p.n };
  state.view = 'sel';
  state.eventId = null;
  remapPolity();
  if (fly && mapOk) map.fitBBox(p.bb);
  expandSheet();
  writeUrl();
  await render();
}

async function selectPolityByName(name, { fly, tried = 0 }) {
  const doc = state.snapDoc;
  const k = doc ? doc.polities.findIndex((p) => p.n === name) : -1;
  if (k >= 0) return selectPolityByIndex(k, { fly });
  // not on this map: jump to the nearest map that has it (once: the index of names can be a little wider
  // than what is drawn)
  if (tried) return;
  const ys = await yearsOf(name);
  if (ys.length) {
    const best = ys.reduce((a, b) => (Math.abs(b - state.year) < Math.abs(a - state.year) ? b : a));
    await goToYear(best, { keepSel: false });
    return selectPolityByName(name, { fly, tried: 1 });
  }
}

/** Select an empire: all of its parts on this year's map. */
async function selectEmpire(id, { fly }) {
  state.sel = { kind: 'empire', id, name: empireName(empires, id, state.year) };
  state.view = 'sel';
  state.eventId = null;
  remapEmpire();
  if (state.sel.missing && !listedParts(empires, id, state.year).length) {
    // not an empire in this year: fall back to its ruling state
    const core = (empires.empires[id]?.core || []).find((n) => state.snapDoc?.polities.some((p) => p.n === n));
    if (core) return selectPolityByName(core, { fly });
  }
  if (fly && mapOk && state.sel.bb) map.fitBBox(state.sel.bb, 4);
  expandSheet();
  writeUrl();
  await render();
}

function remapEmpire() {
  const sel = state.sel;
  const doc = state.snapDoc;
  sel.name = empireName(empires, sel.id, state.year);
  const gi = doc ? doc.groups.findIndex((g) => g.key === 'e:' + sel.id) : -1;
  if (gi < 0) {
    sel.missing = true; sel.members = []; sel.g = null; sel.test = null;
    if (mapOk) map.selectGroup(-99);
    return;
  }
  const g = doc.groups[gi];
  sel.missing = false;
  sel.g = gi;
  sel.members = g.members;
  sel.area = g.area;
  const set = new Set(g.members);
  const geoms = doc.features.filter((f) => set.has(f.properties.k)).map((f) => f.geometry);
  sel.test = makeAreaTest(geoms);
  sel.names = new Set(g.members.map((k) => doc.polities[k].n));
  let w = 180, s0 = 90, e = -180, n = -90;
  for (const k of g.members) { const bb = doc.polities[k].bb; if (!bb) continue; w = Math.min(w, bb[0]); s0 = Math.min(s0, bb[1]); e = Math.max(e, bb[2]); n = Math.max(n, bb[3]); }
  sel.bb = [w, s0, e, n];
  if (mapOk) map.selectGroup(gi);
}

async function selectGone(name, since) {
  await goToYear(since, { keepSel: false });
  return selectPolityByName(name, { fly: true });
}

async function selectPower(key) {
  const doc = state.snapDoc;
  if (!doc) return;
  // the ruling state of that power if it is on the map, else its largest territory; an empire opens as a whole
  let k = doc.polities.findIndex((p) => p.p === key && p.core);
  if (k < 0) k = doc.polities.findIndex((p) => p.p === key);
  if (k >= 0) return selectPolityByIndex(k, { fly: true, whole: true });
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
  if (s.kind === 'empire') return !!(s.names?.has(e.p) || (s.test && e.lo != null && s.test(e.lo, e.la)));
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
    setBody(head, h('p.empty', null, 'The events did not load.'), h('button.more', { type: 'button', onclick: () => render() }, 'Try again'));
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
    // in office this year: sovereigns first, then heads of government; one line per person and office
    const rankOf = (t) => (/emperor|empress|king|queen|monarch|sultan|caliph|shah|tsar|pope|pharaoh|khan|khagan|president(?! of the council)|shogun|doge|emir|prince|duke|consul|dictator|inca|tlatoani|ruler|stadtholder|general secretary|head of state|f\u00fchrer/i.test(t)
      && !/prime minister|vizier|chancellor|premier|council of ministers|head of government/i.test(t) ? 0 : 1);
    const seenNow = new Map();
    for (const r of tl.rulers) {
      const [n, a, b, t] = r;
      if (!(a <= y && (b != null ? b >= y : a === y))) continue;
      const key = n + '|' + t;
      const prev = seenNow.get(key);
      if (prev) { prev[1] = Math.min(prev[1], a); if (prev[2] != null) prev[2] = b == null ? prev[2] : Math.max(prev[2], b); } else seenNow.set(key, [...r]);
    }
    const now = [...seenNow.values()].sort((p, q) => rankOf(p[3]) - rankOf(q[3]) || p[1] - q[1]);
    nodes.push(h('h2', null, `In office in ${formatYear(y)}`));
    // flags: c = from GeoHistory's curated list and confirmed by Wikidata, u = curated and not confirmed,
    // a = approximate dates, i = the end year is the start of the next holder of the office
    const span = (a, b, f = '') => `${f.includes('a') ? 'c. ' : ''}${formatYear(a)}${b != null && b !== a ? '–' + (f.includes('i') ? 'c. ' : '') + formatYear(b) : ''}`;
    const tag = (f = '') => (f.includes('u') ? h('span.unver', { title: 'Written for GeoHistory; Wikidata does not confirm both years' }, 'curated, unverified')
      : f.includes('c') ? h('span.unver', { title: 'Written for GeoHistory; both years match Wikidata' }, 'curated') : null);
    if (now.length) nodes.push(h('ul.changes-list', null, now.slice(0, 8).map(([n, a, b, t, , f]) =>
      h('li', null, h('b', null, n), `, ${t} (${span(a, b, f)})`, tag(f)))));
    else nodes.push(h('p.empty', null, 'No head of state or government is recorded for this year.'));
    const all = h('details.ruled-hist', null, h('summary', null, `All ${tl.rulers.length} recorded terms (${tl.rulersOf})`),
      h('ol', null, tl.rulers.map(([n, a, b, t, , f]) => h('li', null, `${span(a, b, f)}: ${n}, ${t}`, tag(f)))),
      tl.rulers.some((r) => (r[5] || '').includes('i')) ? h('p.note', null, 'An end year marked "c." is not recorded on Wikidata: it is the year the next holder of the same office began.') : null);
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
  if (ongoing.length) nodes.push(h('h2', null, 'Still under way'), eventList(ongoing, { ...listOpts(), isToday: () => false }, 5));
  const chg = (await loadChanges()).filter((c) => Math.abs(c.y - y) <= 30 && s.test && s.test(c.lon, c.lat));
  if (token !== state.token || state.sel !== s) return;
  if (chg.length) {
    nodes.push(h('h2', null, 'Border changes here'),
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
    const mem = p.mem && empires.empires[p.mem.id] ? p.mem : null;
    if (mem) {
      const top = p.e && p.e !== mem.id ? p.e : mem.id;
      facts.append(h('dt', null, 'Part of'), h('dd', null,
        h('button.link', { type: 'button', onclick: () => selectEmpire(top, { fly: true }) }, empireName(empires, top, state.year)),
        top !== mem.id ? ` (through ${empireName(empires, mem.id, state.year)})` : '', ` · ${mem.kind}`, memTag(mem.flags)));
      if (mem.flags.includes('n')) box.append(h('p.note', null, 'Listed with this power but not merged into it on the map.'));
      if (mem.note) box.append(h('p.note', null, mem.note));
      if (p.s && p.s !== p.n && !/^(United Kingdom|France|Spain|Portugal|Netherlands|Japan|Italy|Belgium|Denmark|United States|German Empire|Russian Empire|Australia|South Africa)$/.test(p.s) && p.s !== empireName(empires, mem.id, state.year))
        facts.append(h('dt', null, 'Ruled by'), h('dd', null, p.s));
    } else if (p.core && p.e) {
      const en = empireName(empires, p.e, state.year);
      facts.append(h('dt', null, 'Status'), h('dd', null, en === p.n ? 'Sovereign power; ' : 'Ruling state of ',
        h('button.link', { type: 'button', onclick: () => selectEmpire(p.e, { fly: true }) }, en === p.n ? 'see its parts' : en)));
    } else if (p.s && p.s !== p.n) facts.append(h('dt', null, 'Ruled by'), h('dd', null, p.s, p.cur ? h('span.unver', { title: 'From a curated list, not checked against Wikidata' }, ' unverified') : null));
    else facts.append(h('dt', null, 'Status'), h('dd', null, p.under ? 'A people, culture or region without a state on this map' : 'Independent or self-ruling on this map'));
    facts.append(h('dt', null, 'Area'), h('dd', null, `about ${fmtArea(p.a)}`));
    if (p.dated) {
      const f = (d) => formatDate(Math.floor(d / 10000), Math.floor(d / 100) % 100, d % 100);
      facts.append(h('dt', null, 'Map'), h('dd', null, `These borders held from ${f(p.dated[0])} to ${p.dated[1] >= 20191231 ? '2019 or later' : f(p.dated[1])} (CShapes)`));
    } else if (p.ohm) facts.append(h('dt', null, 'Map'), h('dd', null, `Not in Cliopatria for this year: outline from OpenHistoricalMap (public domain), drawn for ${formatYear(p.clio[0])} to ${formatYear(p.clio[1])} `,
      h('a', { href: `https://www.openhistoricalmap.org/relation/${p.ohm}`, target: '_blank', rel: 'noopener' }, 'relation ' + p.ohm), ' (approximate)'));
    else if (p.clio) facts.append(h('dt', null, 'Map'), h('dd', null, `Cliopatria gives this shape for ${formatYear(p.clio[0])} to ${formatYear(p.clio[1])} (approximate)`));
    else if (p.under) facts.append(h('dt', null, 'Map'), h('dd', null, `Not a state in Cliopatria: outline from the ${formatYear(p.under)} world sketch map (approximate, may be out of date)`));
    else facts.append(h('dt', null, 'Map'), h('dd', null, `Borders as of ${formatYear(state.snap.y)}${p.pr === 1 ? ', approximate' : ''}`));
    box.append(facts);
    if (!p.under || p.s) { const fb = await flagBlock(s.name, state.year); if (fb) box.append(fb); }
    for (const o of occupiedNow(s.name)) box.append(occupationNote(o));
    box.append(await successionBlock(s.name), todayBlock(s));
    try {
      const mn = await getJSON('mapnotes.json');
      const aka = mn.aliases[s.name];
      if (aka) facts.append(h('dt', null, 'Also called'), h('dd', null, aka.join(', ')));
      for (const nt of mn.notes) {
        if (!(nt.names || []).includes(s.name) || state.year < nt.from || state.year > nt.to) continue;
        box.append(h('p.note', null, h('span.unver', { title: 'A known problem of the border source, written for GeoHistory' }, 'map note'), ' ', nt.note, ' ',
          h('a', { href: nt.source, target: '_blank', rel: 'noopener' }, 'Source')));
      }
    } catch { /* optional */ }
    try {
      // several descriptions can share a name (Germany 1918 to 1933 and 1933 to 1945): the one whose years
      // contain this year wins, else the nearest one
      const pd = await getJSON('polities.json').then((d) => {
        const gap = (x) => (x.from != null && state.year < x.from ? x.from - state.year : x.to != null && state.year > x.to ? state.year - x.to : 0);
        return d.polities.filter((x) => x.names.includes(s.name)).sort((a, b) => gap(a) - gap(b))[0];
      }).catch(() => null);
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
        const before = info.mod != null && y < info.mod;
        const eras = before ? (info.eras || []) : [];
        const era = eras.filter((c) => c.from <= y && (c.to ?? info.mod) >= y).pop()
          || eras.filter((c) => c.from - 25 <= y && (c.to ?? info.mod) + 25 >= y).pop() || null;
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
  if (s.kind === 'empire') {
    const e = empires.empires[s.id] || { n: s.name };
    const doc = state.snapDoc;
    box.append(h('p.kicker', null, 'Empire and its parts'), h('h1', null, s.name));
    const listed = listedParts(empires, s.id, state.year);
    if (s.missing && !listed.length) {
      box.append(h('p.lead', null, `No parts of ${s.name} are recorded for ${formatYear(state.year)}.`));
      return box;
    }
    const drawn = (s.members || []).map((k) => ({ k, p: doc.polities[k] })).sort((a, b) => (b.p.core ? 1 : 0) - (a.p.core ? 1 : 0) || b.p.a - a.p.a);
    const facts = h('dl.facts');
    if (s.area) facts.append(h('dt', null, 'Area'), h('dd', null, `about ${fmtArea(s.area)} drawn on the map`));
    facts.append(h('dt', null, 'Parts'), h('dd', null, `${drawn.length} drawn${listed.length ? `, ${listed.length} more listed` : ''} in ${formatYear(state.year)}`));
    box.append(facts);
    const coreP = drawn.find(({ p }) => p.core)?.p;
    const coreName = coreP?.n || (e.core || [])[0];
    if (coreName) { const fb = await flagBlock(coreName, state.year, { label: coreName }); if (fb) box.append(fb); }
    box.append(h('p.note', null, 'At world zoom the parts are drawn as one power. Zoom in to see each part, or choose one below.'));
    if (drawn.length) {
      box.append(h('h2', null, `Parts on the map in ${formatYear(state.year)}`));
      box.append(h('ul.parts', null, drawn.map(({ k, p }) => h('li', null,
        h('button.link', { type: 'button', onclick: () => selectPolityByIndex(k, { fly: true }) }, p.n),
        h('span.muted', null, p.core ? ' · ruling state' : p.mem ? ` · ${p.mem.kind}${p.via ? `, through ${empireName(empires, p.via, state.year)}` : ''}` : ''),
        p.mem ? memTag(p.mem.flags) : null))));
    }
    if (listed.length) {
      box.append(h('h2', null, 'Parts without a shape of their own'),
        h('p.note', null, 'The border sources draw these inside the empire, so they are listed but cannot be shown apart.'));
      box.append(h('ul.parts', null, listed.map((u) => h('li', null, h('b', null, u.n), h('span.muted', null, ` · ${u.kind} · ${formatYear(u.from)} to ${formatYear(u.to)}`), memTag(u.flags),
        u.w ? [' ', h('a.ext', { href: wikiUrl(u.w), target: '_blank', rel: 'noopener' }, 'Wikipedia')] : null))));
      const notes = [...new Set(listed.map((u) => u.note).filter(Boolean))];
      for (const nt of notes) box.append(h('p.note', null, nt));
    }
    const core = drawn.find((d) => d.p.core)?.p.n || (e.core || [])[0];
    if (core) box.append(await successionBlock(core, `${core}: `));
    if (e.w) box.append(h('p.note', null, h('a.ext', { href: wikiUrl(e.w), target: '_blank', rel: 'noopener' }, 'Wikipedia')));
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
  box.append(thenBlock(s));
  return box;
}

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/** The small tag after a membership: where it comes from and whether Wikidata confirms it. */
function memTag(flags = '') {
  const src = flags.includes('c') ? 'Cliopatria' : flags.includes('x') ? 'curated' : flags.includes('d') ? 'curated list of colonial rulers' : 'sketch map';
  return flags.includes('v')
    ? h('span.unver', { title: `Source: ${src}. Wikidata names this power as its country or parent.` }, 'verified')
    : h('span.unver', { title: `Source: ${src}. Not confirmed by Wikidata.` }, flags.includes('c') ? 'Cliopatria' : 'unverified');
}

// ---- before and after: what a state replaced and what replaced it (data/succession.json)
let successionP = null;
async function successionBlock(name, prefix = '') {
  successionP = successionP || loadSuccession();
  const box = h('div.succ');
  let rec;
  try { rec = (await successionP)[name]; } catch { rec = null; }
  if (!rec) return box;
  const row = (e, side) => {
    const [label, mapYear, flags, mapName, w, wdFrom, wdTo] = e;
    const fromMap = flags.includes('m'), fromWd = flags.includes('w');
    const years = wdFrom != null || wdTo != null
      ? `${wdFrom != null ? formatYear(wdFrom) : '?'} to ${wdTo != null ? formatYear(wdTo) : 'today'}`
      : mapYear != null ? (side === 'b' ? `on the map until ${formatYear(mapYear)}` : `on the map from ${formatYear(mapYear)}`) : '';
    const jump = fromMap ? mapYear : side === 'b' ? (wdTo != null ? wdTo - 1 : wdFrom) : (wdFrom != null ? wdFrom + 1 : wdTo);
    // a state that came out of another and went back into it (a rival government, an occupation): said so
    const back = side === 'a' && fromMap && (rec.b || []).some((x) => x[0] === label && x[2].includes('m'));
    const what = flags.includes('u') ? 'peoples, from the sketch map' : flags.includes('r') ? 'the same land on the other map source'
      : flags.includes('s') ? 'broke away; the earlier state went on' : back ? 'the land went back to the state it came from' : null;
    const src = fromWd && fromMap ? 'Wikidata and the maps' : fromWd ? 'Wikidata' : 'the maps';
    return h('li', null,
      mapName ? h('button.link' + (flags.includes('u') ? '.people' : ''), { type: 'button', onclick: () => jumpTo(mapName, jump) }, label) : h('b', null, label),
      years ? h('span.muted', null, ` · ${years}`) : null, what ? h('span.muted', null, ` · ${what}`) : null,
      h('span.unver', { title: fromWd ? 'Wikidata: replaces / replaced by, follows / followed by' : 'Who held this land on the map just before or just after' }, src),
      !mapName && w ? [' ', h('a.ext', { href: wikiUrl(w), target: '_blank', rel: 'noopener' }, 'Wikipedia')] : null);
  };
  if (rec.b?.length) box.append(h('h2', null, `${prefix}Before`), h('ul.parts', null, rec.b.map((e) => row(e, 'b'))));
  if (rec.a?.length) box.append(h('h2', null, `${prefix}After`), h('ul.parts', null, rec.a.map((e) => row(e, 'a'))));
  if (rec.b?.length || rec.a?.length) box.append(h('p.note', null, 'One step back and one step forward only. Click a name to jump to it on the map.'));
  return box;
}

async function jumpTo(name, year) {
  if (year != null) await goToYear(year, { keepSel: false });
  return selectPolityByName(name, { fly: true });
}

// ---- overlap with today's countries, measured at sample points
let modernTests = null;
async function modernIndex() {
  if (!modernFC) modernFC = await loadModern();
  if (!modernTests) modernTests = modernFC.features.map((f) => ({ n: f.properties.n, iso: f.properties.iso, bb: bboxOf([f.geometry]), test: makeAreaTest([f.geometry]) }));
  return modernTests;
}
function samplePoints(bb, test, n = 26) {
  const pts = [];
  if (!bb || !test) return pts;
  let [w, s0, e, nn] = bb;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = w + ((e - w) * (i + 0.5)) / n, y = s0 + ((nn - s0) * (j + 0.5)) / n;
    if (test(x, y)) pts.push([x, y]);
  }
  return pts;
}
/** "Today this is: ..." for a territory or an empire. */
function todayBlock(s) {
  const box = h('p.note.today');
  if (state.year >= 2010 || !s.test) return box;
  const bb = s.kind === 'empire' ? null : s.p?.bb;
  (async () => {
    const idx = await modernIndex();
    const geomsBB = s.kind === 'empire' ? s.bb : bb || (state.snapDoc ? bboxOf(state.snapDoc.features.filter((f) => f.properties.k === s.k).map((f) => f.geometry)) : null);
    const pts = samplePoints(geomsBB, s.test);
    if (pts.length < 3) return;
    const c = new Map();
    for (const [x, y] of pts) {
      const m = idx.find((t) => x >= t.bb[0] && x <= t.bb[2] && y >= t.bb[1] && y <= t.bb[3] && t.test(x, y));
      if (m) c.set(m, (c.get(m) || 0) + 1);
    }
    const list = [...c.entries()].sort((a, b) => b[1] - a[1]).filter(([, v]) => v / pts.length >= 0.03);
    if (!list.length) return;
    box.append(h('b', null, 'Today this is: '));
    list.slice(0, 10).forEach(([m], i) => box.append(i ? ', ' : '', h('button.link', { type: 'button', onclick: () => selectModern(m.iso, { fly: true }) }, m.n)));
    if (list.length > 10) box.append(` and ${list.length - 10} more`);
    box.append(h('span.muted', null, ' (by overlap with today\'s borders, approximate)'));
  })().catch(() => {});
  return box;
}
/** "In <year> this was: ..." for one of today's countries. */
function thenBlock(s) {
  const box = h('p.note.today');
  const doc = state.snapDoc;
  if (!doc || !s.test || !modernFC) return box;
  const f = modernFC.features.find((x) => x.properties.iso === s.iso);
  const pts = samplePoints(bboxOf([f.geometry]), s.test, 22);
  if (!pts.length) return box;
  const feats = doc.features.map((ft) => ({ k: ft.properties.k, bb: bboxOf([ft.geometry]), test: makeAreaTest([ft.geometry]), u: ft.properties.u }));
  const c = new Map();
  for (const [x, y] of pts) {
    const hit = feats.filter((t) => t.bb && x >= t.bb[0] && x <= t.bb[2] && y >= t.bb[1] && y <= t.bb[3] && t.test(x, y)).sort((a, b) => a.u - b.u)[0];
    if (hit) c.set(hit.k, (c.get(hit.k) || 0) + 1);
  }
  const list = [...c.entries()].sort((a, b) => b[1] - a[1]).filter(([, v]) => v / pts.length >= 0.04);
  if (!list.length) { box.append(`No state or people is drawn here on the ${formatYear(state.year)} map.`); return box; }
  box.append(h('b', null, `In ${formatYear(state.year)} this was: `));
  list.slice(0, 8).forEach(([k], i) => box.append(i ? ', ' : '', h('button.link' + (doc.polities[k].under ? '.people' : ''), { type: 'button', onclick: () => selectPolityByIndex(k, { fly: true }) }, doc.polities[k].n)));
  box.append(h('span.muted', null, ' (by overlap with the map of that year, approximate)'));
  return box;
}

// ---- wartime occupation (data/occupations.json): existing outlines, hatched in the occupier's colour
const occDate = () => state.year * 10000 + (state.month || 7) * 100 + (state.day || 1);
function occupiedNow(name) {
  const d = occDate();
  return (occupations.rows || []).filter((o) => o.from <= d && d <= o.to && (!name || o.n.includes(name) || (o.in || []).includes(name)));
}
function occupationNote(o) {
  const f = (d) => formatDate(Math.floor(d / 10000), Math.floor(d / 100) % 100, d % 100);
  return h('p.note.occ', null, h('span.unver', { title: o.ds ? 'The outline is Cliopatria\'s for this calendar year, cut to the country; the dates are from GeoHistory\'s list' : 'From GeoHistory\'s dated list of occupations' }, o.ds ? 'occupied part, ' + o.ds : o.v ? 'occupation' : 'occupation, unverified'), ' ',
    h('b', null, o.ds ? `${o.label[0].toUpperCase()}${o.label.slice(1)}: held by ${o.by}` : `${o.kind || 'Occupied'} by ${o.by}`), o.ds ? `, outline of ${Math.floor(o.from / 10000)}. ` : ` from ${f(o.from)} to ${f(o.to)}. `, o.note || '', ' ',
    h('a', { href: o.src, target: '_blank', rel: 'noopener' }, 'Source'));
}
let occToken = 0;
let occShapesP = null;
async function updateOccupied() {
  if (!mapOk) return;
  const token = ++occToken;
  const doc = state.snapDoc;
  const feats = [];
  const now = occupiedNow();
  const covered = new Set(now.flatMap((o) => o.covers || []));   // drawn by a wider row's own outline instead
  for (const o of now) {
    if (covered.has(o.label)) continue;
    const c = pcolor(o.key);
    const ks = new Set((doc?.polities || []).map((p, k) => (o.n.includes(p.n) ? k : -1)).filter((k) => k >= 0));
    let geoms = ks.size ? doc.features.filter((f) => ks.has(f.properties.k)).map((f) => f.geometry) : [];
    if (!geoms.length && o.shape) {
      try {
        geoms = o.shape.src === 'ohm' ? [(await (occShapesP ||= getJSON('occupation_shapes.json')))[o.shape.id].g]
          : o.shape.src === 'area' ? [(await getJSON(`occupations/${o.shape.id}.json`)).g]
            : [(await loadShape('cshapes', o.shape.f, o.shape.id)).g];
      } catch { geoms = []; }
    }
    for (const g of geoms) feats.push({ type: 'Feature', geometry: g, properties: { by: o.by, c, a: o.shape?.src === 'area' ? 1 : 0 } });
  }
  if (token === occToken) map.setOccupied(feats);
}

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
    let key = s.kind === 'modern' ? 'iso:' + s.iso : s.name;
    if (s.kind === 'empire') {
      // an empire's rulers are those of its ruling state
      const doc = state.snapDoc;
      const core = (s.members || []).map((k) => doc.polities[k]).find((p) => p.core) || (empires.empires[s.id]?.core || []).map((n) => ({ n })).find((p) => idx[p.n]);
      key = core?.n;
    }
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
    try { d = await getJSON('history/ruledby.json'); } catch { box.append(h('p.empty', null, 'This did not load.')); return; }
    const runs = d[name] || [];
    if (!runs.length) { box.append(h('p.empty', null, 'Nothing recorded.')); return; }
    box.append(h('ol', null, runs.map(([a, b, r, src]) => {
      const span = a === b ? (src === 'm' ? `${formatYear(a)} map` : `${a}`) : (src === 'm' ? `maps of ${formatYear(a)} to ${formatYear(b)}` : `${a} to ${b}`);
      return h('li', null, `${span}: `, r ? `ruled by ${r}` : 'self-ruling');
    })));
    box.append(h('p.note', null, 'From the border maps only: a run means the same ruler on every map in that span, not that nothing changed between maps.'));
  });
  return box;
}

// ---------------------------------------------------------------- events
async function openEvent(id, { fly, stay = false }) {
  let e = await findEvent(id);
  if (!e) {
    // maybe the panel for its year is not loaded yet
    await eventsBetween(addYears(state.year, -5), addYears(state.year, 5)).catch(() => {});
    e = await findEvent(id);
  }
  if (!e) return;
  if (e.y !== state.year && state.view !== 'sel' && !(stay && e.y <= state.year && (e.y2 || e.y) >= state.year)) {
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
  if (e.pa?.length) facts.append(h('dt', null, 'Took part'), h('dd', null, e.pa.join(', '), h('span.muted', null, ' (as listed by Wikidata, which does not record who fought on which side)')));
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
  if (e.src) nodes.push(h('p.note', null, e.wx ? 'Text from ' : 'Listed in ', h('a', { href: e.src, target: '_blank', rel: 'noopener' }, "Wikipedia's article for this year"),
    e.wx ? ' (Wikipedia contributors, CC BY-SA 4.0), shortened to one sentence' : '',
    e.uv ? '. Its date could not be confirmed in Wikidata (unverified).' : e.wx && !/^Q\d+$/.test(e.i) ? '.' : ', and its date matches Wikidata.'));
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
  els.slider.value = Math.round(yearToFrac(state.year) * SL);
  els.slider.setAttribute('aria-valuetext', formatYear(state.year));
}

/** The year bubble over the timeline thumb, shown while it is dragged. */
let bubbleT = null;
function showBubble(y) {
  const f = els.slider.value / SL;
  els.thumbYear.textContent = formatYear(y);
  els.thumbYear.style.left = `calc(${(f * 100).toFixed(3)}% + ${(8 - 16 * f).toFixed(1)}px)`;
  els.thumbYear.classList.add('on');
  clearTimeout(bubbleT);
  bubbleT = setTimeout(() => els.thumbYear.classList.remove('on'), 900);
}

/** Tick marks with year labels under the timeline. The scale is uneven (recent centuries get more room), so the
 *  interval is chosen piece by piece: the smallest round interval whose labels stay at least ~64 px apart, and
 *  minor ticks at a smaller one where they stay ~7 px apart. Redrawn when the timeline changes width. */
function drawTicks() {
  const W = els.ticks.clientWidth || 800;
  const IV = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10];
  const px = (y) => yearToFrac(y) * W;
  const ticks = [];
  const labels = new Map();
  const lab = (y) => (y < 0 ? `${(-y).toLocaleString('en-GB')} BC` : y < 1000 ? `AD ${y}` : String(y));
  // walk the range in pieces of the scale, so each piece can have its own interval
  const pieces = [[MIN_YEAR, -10000], [-10000, -3000], [-3000, -500], [-500, 500], [500, 1000], [1000, 1500], [1500, 1800], [1800, 1900], [1900, MAX_YEAR]];
  for (const [y0, y1] of pieces) {
    const perYear = (px(y1) - px(y0)) / (y1 - y0);
    const major = [...IV].reverse().find((iv) => iv * perYear >= 64) || IV[0];
    const minor = [...IV].reverse().find((iv) => iv * perYear >= 7 && major % iv === 0) || major;
    for (let y = Math.ceil(y0 / minor) * minor; y <= y1; y += minor) {
      const yy = y === 0 ? 1 : y;
      if (y % major === 0) labels.set(yy, lab(yy));
      ticks.push([yy, y % major === 0]);
    }
  }
  // labels: left to right, none closer than 58 px to the one before
  const out = [];
  let last = -1e9;
  for (const [y, isMajor] of ticks.sort((a, b) => a[0] - b[0])) {
    const x = px(y);
    let t = isMajor ? labels.get(y) : null;
    if (t && x - last < 58) t = null;
    if (t) last = x;
    out.push(h('i' + (isMajor ? '.mj' : ''), { style: `left:${x.toFixed(1)}px` }, t ? h('b', { style: x < 30 ? 'transform:none' : x > W - 30 ? 'transform:translateX(-100%)' : null }, t) : null));
  }
  els.ticks.replaceChildren(...out);
  els.eras.replaceChildren(...ERAS.map((e) => {
    const l = px(Math.max(MIN_YEAR, e.from)), r = px(Math.min(MAX_YEAR, e.to));
    return h('span', { style: `left:${l.toFixed(1)}px;width:${(r - l).toFixed(1)}px`, title: `${e.label}: ${formatYear(e.from)} to ${e.to >= MAX_YEAR ? 'today' : formatYear(e.to)} (rough dates)` },
      r - l > e.label.length * 6.5 + 10 ? e.label : '');
  }));
}

/** The next (dir 1) or previous (dir -1) year in which the drawn borders change: a stored map whose shapes
 *  differ from the shown one, or a year in which an empire gains or loses a part or changes its name. */
async function changeYearFrom(y, dir) {
  const stops = stopsBetween(y, dir > 0 ? MAX_YEAR : MIN_YEAR);
  const memb = memberChangeYears();
  const keyOf = async (yy) => {
    const sn = snapshotFor(yy);
    if (!sn) return 'none';
    if (sn.src === 'cshapes') {
      const yr = await getJSON(`cshapes/years/${sn.y}.json`);
      return 'cs:' + yr.rows.map((r) => r[0]).join(',');
    }
    return sn.src + ':' + sn.y;
  };
  let cur = await keyOf(y);
  for (let i = 0; i < stops.length && i < 60; i++) {
    const s = stops[i];
    // backwards, a stop is the last year of the earlier map: the change itself is the year after it
    const k = await keyOf(s);
    if (k !== cur || memb.has(dir > 0 ? s : addYears(s, 1))) return s;
    cur = k;
  }
  return stops.length ? stops[Math.min(stops.length, 60) - 1] : null;
}

let memberYearsCache = null;
function memberChangeYears() {
  if (memberYearsCache) return memberYearsCache;
  const ys = new Set();
  for (const ms of Object.values(empires.rows || {})) for (const m of ms) { ys.add(m[0]); ys.add(addYears(m[1], 1)); }
  for (const e of Object.values(empires.empires || {})) for (const [a, b] of e.names || []) { if (a != null) ys.add(a); if (b != null) ys.add(addYears(b, 1)); }
  return (memberYearsCache = ys);
}

async function jumpChange(dir) {
  const base = travel?.mode === 'to' ? travel.target : state.year;
  const y = await changeYearFrom(base, dir).catch(() => null);
  if (y == null) { setHint(dir > 0 ? 'No later border change on record.' : 'No earlier border change on record.'); return; }
  playUI(false);
  travelTo(y);
}

function setupTimebar() {
  els.form.addEventListener('submit', (ev) => {
    ev.preventDefault();
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
  els.prevCh.addEventListener('click', () => jumpChange(-1));
  els.nextCh.addEventListener('click', () => jumpChange(1));
  let pending = null;
  els.slider.addEventListener('input', () => {
    const y = fracToYear(els.slider.value / SL);
    els.year.value = formatYear(y);
    els.slider.setAttribute('aria-valuetext', formatYear(y));
    showBubble(y);
    // the map runs through the years towards the thumb (in fewer, larger steps when it is far behind)
    if (travelOn()) { playUI(false); travelTo(y, { scrub: true }); return; }
    clearTimeout(pending);
    pending = setTimeout(() => goToYear(y, { fromSlider: true }), 140);
  });
  els.slider.addEventListener('keydown', (e) => {
    const k = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 };
    if (e.key in k) {
      e.preventDefault();
      if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { jumpChange(k[e.key]); return; }
      step(k[e.key] * (e.shiftKey ? 100 : 1));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      travelTo(e.key === 'Home' ? -3000 : MAX_YEAR);
    }
  });
  els.play.addEventListener('click', () => (travel?.playing ? stopPlay() : startPlay()));
  let sp = +getPref('speed2', 5);
  if (!SPEEDS.includes(sp)) sp = 5;
  els.speed.value = String(sp);
  els.speed.addEventListener('change', () => { sp = +els.speed.value; setPref('speed2', sp); if (travel) travel.speed = sp; });
  els.speed._sp = () => sp;
  new ResizeObserver(() => drawTicks()).observe(els.timeline);
}

const travelOn = () => mapOk && travel && !reducedMotion();

function setupTravel() {
  travel = new Travel({
    map,
    stopsBetween,
    docFor: async (y, prevDoc) => {
      const snap = snapshotFor(y);
      if (!snap) return { snap: null, doc: null, sig: 'none' };
      const doc = await loadSnapshot(snap);
      const sig = prepareDoc(doc, { emp: empires, powers, year: y, dark: isDark(), prev: prevDoc?._lbl || state.snapDoc?._lbl });
      return { snap, doc, sig };
    },
    keyNow: () => `${state.snapDoc?.key ?? state.snap?.y}#${state.snap ? state.sig : 'none'}`,
    yearNow: () => state.year,
    onStep: (y, st) => {
      state.year = y; state.month = 0; state.day = 0;
      // (an unchanged map, st.same: the drawn features are the same rows, so the new document fits them)
      state.snap = st.snap; state.snapDoc = st.doc; state.sig = st.sig;
      travelShow(st.dur);
    },
    onTick: (y) => { state.year = y; state.month = 0; state.day = 0; travelShow(400); },
    onRest: (y) => { playUI(travel.playing); document.body.classList.remove('travelling'); goToYear(y, { fromTravel: true }); },
  });
  travel.speed = els.speed._sp();
}

/** A year reached while the years run: the year box, the timeline, the badge, the overlays; the panel only
 *  now and then while playing (it loads that year's events), and at the end. */
let lastPanel = 0;
function travelShow(dur = 0) {
  // while a jump runs the panel still describes the year it started from: it is dimmed until the end
  document.body.classList.toggle('travelling', travel.mode === 'to');
  showYearInput();
  if (!(travel.mode === 'to' && travel.scrub)) updateSlider();
  updateBadge();
  updateOccupied();
  updateUS({ dur: Math.min(dur || 400, 500) });
  updateWar(state.year);
  ++flagTok;
  map.setBadgesVisible(false);
  if (state.sel?.kind === 'polity') remapPolity();
  if (state.sel?.kind === 'empire') remapEmpire();
  if (travel.playing && performance.now() - lastPanel > (travel.speed <= 1 ? 900 : 2500)) {
    lastPanel = performance.now();
    ++state.token;
    render();
  }
}

// The years in which the drawn map can change: a stored border map starts, or an empire gains or loses a
// part, or is renamed (the memberships are dated by year).
let changeYearsCache = null;
function changeYears() {
  if (changeYearsCache) return changeYearsCache;
  const ys = new Set(storedYears());
  for (const ms of Object.values(empires.rows || {})) for (const m of ms) { ys.add(m[0]); ys.add(addYears(m[1], 1)); }
  for (const us of Object.values(empires.undrawn || {})) for (const u of us) { ys.add(u[1]); ys.add(addYears(u[2], 1)); }
  for (const e of Object.values(empires.empires || {})) for (const [a, b] of e.names || []) { if (a != null) ys.add(a); if (b != null) ys.add(addYears(b, 1)); }
  changeYearsCache = [...ys].filter((y) => y >= MIN_YEAR && y <= MAX_YEAR).sort((a, b) => a - b);
  return changeYearsCache;
}

/** The years passed between a (exclusive) and b (inclusive) at which the map may change, in travel order.
 *  Forwards that is each change year; backwards the year before each (where the earlier map is in force). */
function stopsBetween(a, b) {
  const all = changeYears();
  if (a === b) return [];
  if (a < b) return all.filter((y) => y > a && y <= b);
  const out = [];
  for (let i = all.length - 1; i >= 0; i--) {
    const y = all[i];
    if (y > a) continue;
    if (y <= b) break;
    const p = addYears(y, -1);
    if (p >= b && out[out.length - 1] !== p) out.push(p);
  }
  return out;
}

function travelTo(y, { scrub = false } = {}) {
  y = Math.max(MIN_YEAR, Math.min(MAX_YEAR, y));
  if (!travelOn()) return goToYear(y, { month: 0, day: 0, fromSlider: scrub });
  // markers of the year left behind would stand on the wrong map
  if (!travel.running && stopsBetween(state.year, y).length > 1) map.setEvents([]);
  travel.to(y, { scrub });
}

function step(n) {
  const base = travel?.mode === 'to' ? travel.target : state.year;
  playUI(false);
  travelTo(addYears(base, n));
}

function playUI(on) {
  els.play.setAttribute('aria-pressed', on ? 'true' : 'false');
  els.play.setAttribute('aria-label', on ? 'Pause' : 'Play');
}

function startPlay() {
  if (!mapOk || !travel) return;
  if (state.year >= MAX_YEAR) return;
  playUI(true);
  lastPanel = performance.now();
  travel.play();
}

function stopPlay() {
  playUI(false);
  if (travel?.playing) travel.pause();
}

function globalKeys(e) {
  const t = e.target;
  const typing = t.closest?.('input, textarea, select, [contenteditable]');
  if (e.key === '/' && !typing) { e.preventDefault(); $('#q').focus(); return; }
  if (typing || t.closest?.('.maplibregl-canvas-container, dialog') || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    if (e.shiftKey) jumpChange(e.key === 'ArrowLeft' ? -1 : 1);
    else step(e.key === 'ArrowLeft' ? -1 : 1);
  } else if (e.key === ' ' && !t.closest?.('button, a, summary')) {
    e.preventDefault();
    if (travel?.playing) stopPlay(); else startPlay();
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
  getJSON('modern_names.json').then((d) => {
    for (const m of d) modernNames[m[1]] = m[0];
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
    h('p', null, `From 1886 to 2019 the map uses CShapes 2.0, which dates every change of state borders. From 3400 BC to 1885 it uses Cliopatria, which gives each state a shape for a range of years: every year has a map, but it is approximate (a state is redrawn every few years, in antiquity every few decades), and peoples without a state, and states Cliopatria does not have, are filled in from an older sketch map (historical-basemaps, ${n(c.snapshots)} world snapshots). Before 3400 BC only those snapshots exist, from ${formatYear(meta?.borders?.first ?? MIN_YEAR)} on: you see the nearest earlier one, and the badge on the map says which. Borders before about 1500 are rough sketches; many places had no fixed borders.`),
    h('p', null, 'Every state is cut to one coastline (Natural Earth, 1:10 million), drawn above the borders, so coasts are sharper than the border sources themselves; inland borders are as detailed as the sources, which generalise them to a few kilometres.'),
    h('h3', null, 'Empires, occupations, before and after'),
    h('p', null, `At world zoom an empire is drawn as one power and splits into its parts when you zoom in. A part belongs to an empire only in the years a source says so: the border sources themselves (Cliopatria's member-of field, CShapes dependencies) and a dated list written for GeoHistory${meta?.empires ? ` (${n(meta.empires.memberships)} memberships, ${n(meta.empires.verified)} confirmed by Wikidata)` : ''}. Parts that the sources do not draw (New Spain, the Soviet republics) are listed in the empire's panel, never drawn.`),
    h('p', null, 'Wartime occupations are not in the border sources. An occupied country keeps its own colour, made faint, under diagonal lines in the occupier\'s colour (the year panel shows which colour is which occupier). The list of occupations is written for GeoHistory; most entries are whole countries, and each says so where only a part was occupied. Where only a part of a country was occupied (the Soviet Union, China, France in both world wars, Russia in 1915 to 1918) the part is Cliopatria\'s outline of what the occupier held in that calendar year, cut to the country; Manchukuo is OpenHistoricalMap\'s outline. Cliopatria has one outline per year and does not say which day it stands for, so a front line is approximate.'),
    h('p', null, '"Before" and "After" in a territory panel go one step only: what Wikidata lists as replaced and replacing, and who held the same land on the map just before and just after. "Today this is" is measured by overlap with today\'s borders and is approximate.'),
    h('h3', null, 'Events come from Wikidata'),
    h('p', null, `${n(c.events)} events, most of them from Wikidata's free database, ranked by how many Wikipedia language editions cover them. Entries made from a city, a state or a person rather than from an event of their own ("X founded", "X becomes king") count for less, periods that run for decades count for less in their first year, and the curated landmark events of each period and the defining event of ${n(c.headlines || 0)} famous years are listed first. Dates, places and descriptions can be wrong or missing, and coverage is much thinner for Africa, Asia and the distant past than for Europe and North America. ${n(c.placedInModernCountry || 0)} of them could be placed in one of today's countries.`),
    h('p', null, `English Wikipedia's year articles add ${n(c.yearArticleEvents || 0)} more whose linked article Wikidata dates to the same year, and ${n(c.yearArticleUnverified || 0)} further entries that are shown as "unverified": complete sentences from the year's own article whose date nothing else confirms (sport and entertainment are left out). For both kinds the one-sentence description is Wikipedia's text, shortened, © Wikipedia contributors, CC BY-SA 4.0; each such event links to the year article it comes from. Archaeological cultures and periods are listed with approximate dates.`),
    h('h3', null, 'Curated text'),
    h('p', null, `Decade summaries from 1500, short descriptions of major states and ${n(c.curated)} events for major periods were written for GeoHistory. Each is checked against Wikidata by its year and tagged "curated", or "curated, unverified" when Wikidata has no matching date.`),
    h('p', null, `Rulers come from Wikidata's "position held" statements. Where Wikidata files an office under something other than the state on the map (Roman emperors under "Ancient Rome", popes under the Catholic Church), a hand-made table attaches them to the map's territories (${n(c.rulerTermsAttached || 0)} terms). ${n(c.curatedRulerTerms || 0)} more terms for major states (the Chinese dynasties, the caliphates, the Tokugawa shoguns and others) were written for GeoHistory and are tagged "curated" when Wikidata confirms both years, otherwise "curated, unverified". An end year shown with "c." is the year the next holder took office.`),
    h('h3', null, 'Accuracy check'),
    h('p', null, audit ? `On ${audit.date} the data was checked against ${audit.facts} well-known facts (dates of events, reigns, who held a city in a given year): ${audit.passed} passed (${Math.round(audit.rate * 100)}%). Entries marked "unverified" or "curated" were written by hand or could not be confirmed in Wikidata.` : 'The accuracy check has not been run for this build.'),
    h('h3', null, 'Sources'),
    h('ul', null,
      h('li', null, h('a', { href: 'https://github.com/aourednik/historical-basemaps', target: '_blank', rel: 'noopener' }, 'historical-basemaps'), ' by André Ourednik and contributors: world borders by year (GPL-3.0).'),
      h('li', null, h('a', { href: 'https://publications.newberry.org/ahcb/', target: '_blank', rel: 'noopener' }, 'Atlas of Historical County Boundaries'), ', Newberry Library: US state and territory borders since 1783.'),
      h('li', null, h('a', { href: 'https://github.com/Seshat-Global-History-Databank/cliopatria', target: '_blank', rel: 'noopener' }, 'Cliopatria'), ' (Seshat Global History Databank): state shapes from 3400 BC to 1885 (CC BY 4.0).'),
      h('li', null, h('a', { href: 'https://icr.ethz.ch/data/cshapes/', target: '_blank', rel: 'noopener' }, 'CShapes 2.0'), ': dated state borders 1886 to 2019 (CC BY-NC-SA, non-commercial).'),
      h('li', null, h('a', { href: 'https://www.naturalearthdata.com/', target: '_blank', rel: 'noopener' }, 'Natural Earth'), ': coastlines and today\'s countries (public domain).'),
      h('li', null, h('a', { href: 'https://www.wikidata.org/', target: '_blank', rel: 'noopener' }, 'Wikidata'), ': events and descriptions (CC0). Links go to Wikipedia.'),
      h('li', null, h('a', { href: 'https://en.wikipedia.org/wiki/List_of_years', target: '_blank', rel: 'noopener' }, 'English Wikipedia year articles'), ': one-sentence descriptions of events, © Wikipedia contributors, ', h('a', { href: 'https://creativecommons.org/licenses/by-sa/4.0/', target: '_blank', rel: 'noopener' }, 'CC BY-SA 4.0'), '. The sentences are shortened and stripped of links; the same licence applies to them here.'),
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
  if (s?.kind === 'empire') p.set('em', s.id);
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
window.__geo = { state, modernOf, flagFor, hexDist, goToYear: (y) => goToYear(y), get travel() { return travel; }, stopsBetween, travelTo, step, get map() { return map; }, selectEmpire, selectPolityByName, Z_SPLIT };
