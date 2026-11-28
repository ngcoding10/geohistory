// admin.html: the owner's list of reader suggestions. Google sign-in, then every call goes to the
// geoAdminSuggestions function, which checks the account id against the backend's allow-list. This page
// holds no data of its own and no secret: someone who is not on the list sees only their own account id.
import { loadCloud, adminCall, emulator } from './cloud.js';
import { h } from './ui.js';
import { formatYear, parseYear } from './year.js';

const $ = (s) => document.querySelector(s);
const STATUSES = [['new', 'New'], ['reviewing', 'Reviewing'], ['added', 'Added'], ['rejected', 'Rejected']];
const LABEL = Object.fromEntries(STATUSES);
const KIND = { polity: 'State', empire: 'Empire', event: 'Event', us: 'US state', colony: 'Colony', modern: "Today's country" };
const PARAM = { polity: 'c', empire: 'em', us: 's', colony: 'col', modern: 'mc', event: 'e' };
const PAGE = 30;

const view = { status: null, yearFrom: null, yearTo: null, q: '', cursor: null, counts: null, items: [], token: 0 };
let core = null;

function show(id) {
  for (const s of ['gate', 'denied', 'app']) $('#' + s).hidden = s !== id;
}
const gateSay = (t, err = false) => { $('#gateStatus').textContent = t; $('#gateStatus').classList.toggle('err', err); };
const listSay = (t, err = false) => { $('#listStatus').textContent = t; $('#listStatus').classList.toggle('err', err); };

/** The map address for a suggestion: its year and, when it has one, the state, place or event it is about. */
export function mapLink(s) {
  const p = new URLSearchParams();
  if (s.year != null) p.set('y', String(s.year));
  const k = s.subject && PARAM[s.subject.kind];
  if (k) p.set(k, s.subject.id);
  return './' + (p.toString() ? '?' + p.toString() : '');
}
const safeHref = (u) => { try { const x = new URL(u); return ['http:', 'https:'].includes(x.protocol) ? x.toString() : null; } catch { return null; } };
const shortUrl = (u) => { const x = new URL(u); let p = x.pathname; try { p = decodeURIComponent(p); } catch { /* keep it encoded */ } return (x.hostname.replace(/^www\./, '') + p.replace(/\/$/, '')).slice(0, 80); };
const when = (ms) => (ms ? new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'just now');

function statusSeg() {
  const c = view.counts || {};
  const btn = (val, label, n) => h('button', { type: 'button', 'aria-pressed': String(view.status === val), 'data-status': val ?? 'all',
    onclick: () => { view.status = val; reload(); } }, label, h('span.n', null, n == null ? '' : String(n)));
  $('#statusSeg').replaceChildren(btn(null, 'All', c.all), ...STATUSES.map(([v, l]) => btn(v, l, c[v])));
  $('#countLine').textContent = view.counts
    ? `${c.all} in all · ${c.new} new · ${c.reviewing} reviewing · ${c.added} added · ${c.rejected} rejected` : '';
}

function card(s) {
  const li = h('li.card', { 'data-id': s.id, 'data-status': s.status });
  const pill = h('span.pill', { 'data-s': s.status }, LABEL[s.status] || s.status);
  const meta = h('p.meta', null, pill, h('time', { datetime: s.createdAt ? new Date(s.createdAt).toISOString() : '' }, when(s.createdAt)));
  const facts = h('dl.facts');
  const fact = (k, v) => { if (v) facts.append(h('dt', null, k), h('dd', null, v)); };
  fact('Year', s.year != null ? formatYear(s.year) : 'not given');
  fact('Date as typed', s.date && s.date !== formatYear(s.year) ? s.date : '');
  fact('Place', s.place);
  fact('About', s.subject ? `${s.subject.name || s.subject.id} (${(KIND[s.subject.kind] || s.subject.kind).toLowerCase()})` : (s.year != null ? `The world in ${formatYear(s.year)}` : ''));
  const src = safeHref(s.sourceUrl);
  if (src) fact('Source', h('a', { href: src, target: '_blank', rel: 'noopener noreferrer' }, shortUrl(src)));
  if (s.email) fact('Reply to', h('a', { href: 'mailto:' + s.email }, s.email));

  const statusBtns = h('div.seg.small', { role: 'group', 'aria-label': 'Set status' }, STATUSES.map(([v, l]) =>
    h('button', { type: 'button', 'aria-pressed': String(s.status === v), onclick: () => setStatus(s, v, li) }, l)));
  const noteId = 'note-' + s.id;
  const note = h('textarea', { id: noteId, rows: 2, maxlength: 2000, placeholder: 'Only you see this' });
  note.value = s.note || '';
  const saved = h('span.status', { role: 'status', 'aria-live': 'polite' });
  const saveNote = h('button.btn', { type: 'button', onclick: async () => {
    saveNote.disabled = true; saved.textContent = 'Saving…'; saved.classList.remove('err');
    try { const r = await adminCall({ action: 'update', id: s.id, note: note.value }); s.note = r.note ?? note.value; saved.textContent = 'Saved'; } catch (e) { saved.textContent = e.message; saved.classList.add('err'); }
    saveNote.disabled = false;
  } }, 'Save note');
  const del = h('button.btn.danger', { type: 'button', onclick: async () => {
    if (!confirm('Delete this suggestion for good?')) return;
    del.disabled = true;
    try {
      await adminCall({ action: 'delete', id: s.id });
      li.remove();
      if (view.counts) { view.counts.all--; view.counts[s.status]--; statusSeg(); }
    } catch (e) { del.disabled = false; saved.textContent = e.message; saved.classList.add('err'); }
  } }, 'Delete');

  li.append(meta, h('p.txt', null, s.text), facts,
    h('p.links', null, h('a.map', { href: mapLink(s), target: '_blank', rel: 'noopener' }, 'View on map')),
    h('div.row', null, statusBtns),
    h('div.notebox', null, h('label', { for: noteId }, 'Note'), note, h('div.row', null, saveNote, saved, del)));
  return li;
}

async function setStatus(s, v, li) {
  if (s.status === v) return;
  const old = s.status;
  const btns = li.querySelectorAll('.seg.small button');
  btns.forEach((b) => { b.disabled = true; });
  try {
    await adminCall({ action: 'update', id: s.id, status: v });
    s.status = v;
    li.dataset.status = v;
    li.querySelector('.pill').dataset.s = v;
    li.querySelector('.pill').textContent = LABEL[v];
    btns.forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === LABEL[v])));
    if (view.counts) { view.counts[old]--; view.counts[v]++; statusSeg(); }
  } catch (e) {
    listSay(e.message, true);
  }
  btns.forEach((b) => { b.disabled = false; });
}

async function load({ append = false } = {}) {
  const token = ++view.token;
  listSay(append ? 'Loading more…' : 'Loading…');
  $('#more').hidden = true;
  try {
    const r = await adminCall({ action: 'list', status: view.status, yearFrom: view.yearFrom, yearTo: view.yearTo, q: view.q, cursor: append ? view.cursor : null, limit: PAGE });
    if (token !== view.token) return;
    view.counts = r.counts;
    view.cursor = r.cursor;
    view.items = append ? [...view.items, ...r.items] : r.items;
    statusSeg();
    if (!append) $('#list').replaceChildren();
    $('#list').append(...r.items.map(card));
    const filtering = view.status || view.yearFrom != null || view.yearTo != null || view.q;
    listSay(view.items.length ? `${view.items.length} shown${r.cursor ? '' : filtering ? ' (all that match)' : ''}` : filtering ? 'Nothing matches these filters.' : 'No suggestions yet.');
    $('#more').hidden = !r.cursor;
    show('app');
  } catch (e) {
    if (token !== view.token) return;
    if (e.code === 'permission-denied') return denied();
    if (!$('#app').hidden) listSay(e.message, true);
    else gateSay(e.message, true);
  }
}
const reload = () => { view.cursor = null; load(); };

function denied() {
  $('#myUid').textContent = core?.user?.uid || '';
  show('denied');
}

function readFilters() {
  const yr = (el) => {
    const v = el.value.trim();
    if (!v) { el.removeAttribute('aria-invalid'); return null; }
    const p = parseYear(v);
    el.toggleAttribute('aria-invalid', !p.year);
    return p.year ?? null;
  };
  view.yearFrom = yr($('#yFrom'));
  view.yearTo = yr($('#yTo'));
  view.q = $('#q').value.trim().slice(0, 100);
}

function setup() {
  let t = null;
  const later = () => { clearTimeout(t); t = setTimeout(() => { readFilters(); reload(); }, 350); };
  for (const id of ['#yFrom', '#yTo', '#q']) $(id).addEventListener('input', later);
  $('#filters').addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(t); readFilters(); reload(); });
  $('#more').addEventListener('click', () => load({ append: true }));
  $('#copyUid').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#myUid').textContent); $('#copied').textContent = 'Copied'; } catch { $('#copied').textContent = 'Select the id and copy it by hand'; }
  });
  // Google sign-in must open straight from the click, with nothing awaited first
  $('#signIn').addEventListener('click', () => {
    if (!core) return;
    gateSay('');
    core.signInWithGoogle().catch((e) => gateSay(e.message, true));
  });
  $('#signOut').addEventListener('click', () => core?.signOut());
  statusSeg();
}

async function start() {
  setup();
  try {
    core = await loadCloud();
  } catch (e) {
    console.warn(e);
    gateSay('Sign-in could not load. Check your connection and reload the page.', true);
    return;
  }
  $('#signIn').disabled = false;
  gateSay(emulator ? 'Using the local emulators.' : '');
  core.onUser((u) => {
    $('#who').hidden = !u;
    $('#whoName').textContent = u ? (u.email || u.name || u.uid) : '';
    if (!u) { view.token++; show('gate'); gateSay(''); $('#list').replaceChildren(); return; }
    gateSay('Checking your account…');
    reload();
  });
}

start();
