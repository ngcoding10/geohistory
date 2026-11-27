// State context and event write-ups, loaded only when a state or an event is opened (data/context/<state>.json,
// data/writeups/<block>.json.gz). Every section says where its facts come from; estimates are labelled as such
// and text written for GeoHistory carries the "AI-written" label of the curated files.
import { h } from './ui.js';
import { getJSON, dataUrl } from './data.js';
import { formatYear } from './year.js';

const wiki = (t) => 'https://en.wikipedia.org/wiki/' + encodeURIComponent(String(t).replace(/ /g, '_'));
const isUrl = (s) => /^https?:\/\//.test(s || '');
const phone = () => window.innerWidth < 900;

/** "about 31 million", "about 2.4 million", "about 31,000" */
export function people(v) {
  if (v >= 1e9) return `${+(v / 1e9).toPrecision(2)} billion`;
  if (v >= 1e6) return `${+(v / 1e6).toPrecision(3)} million`;
  if (v >= 1e4) return Math.round(v / 1000) * 1000 + '';
  return Math.round(v / 100) * 100 + '';
}
const num = (v) => Number(v).toLocaleString('en-GB');

const tag = (text, title) => h('span.unver', { title }, text);
const aiTag = () => tag('AI-written', 'Written for GeoHistory from general knowledge and the sources named; checked against Wikidata where it has the fact');
const src = (href, text) => h('a.ext', { href, target: '_blank', rel: 'noopener' }, text);

function section(id, title, open, ...kids) {
  const body = kids.flat().filter(Boolean);
  if (!body.length) return null;
  return h('details.ctx', { open: open ? true : null, 'data-sec': id }, h('summary', null, h('span', null, title)), h('div.ctx-body', null, body));
}

async function loadState(key) {
  const idx = await getJSON('context/index.json');
  const f = idx[key];
  return f ? getJSON('context/' + f) : null;
}

/** The slice of a context document that contains the year (or the nearest one within 25 years). */
function sliceFor(doc, y) {
  const ps = doc?.periods || [];
  return ps.find((p) => p.from <= y && y <= p.to)
    || ps.filter((p) => Math.abs((y < p.from ? p.from : p.to) - y) <= 25).sort((a, b) => Math.abs(a.from - y) - Math.abs(b.from - y))[0] || null;
}

function popSection(p, y) {
  const rows = p.pop || [];
  if (!rows.length && !p.popw?.length) return null;
  const at = [...rows].reverse().find((r) => r[0] <= y) || rows[0];
  const out = [];
  if (at) {
    const [yr, mid, lo, hi, srcs] = at;
    const range = hi > lo * 1.15;
    out.push(h('p.ctx-big', null, range ? `${people(lo)} to ${people(hi)} people` : `About ${people(mid)} people`,
      h('span.muted', null, ` in ${formatYear(yr)}`), ' ', tag('estimate', 'No census: figures for these years are estimates, and published estimates often differ widely')));
    out.push(h('ul.ctx-src', null, srcs.map((s, i) => h('li', null, s.startsWith('HYDE')
      ? ['HYDE 3.2.1 model, summed over this map\'s outline ', src('https://doi.org/10.17026/DANS-25G-GEZ3', 'data')]
      : s.startsWith('Maddison') ? [s, ' ', src('https://doi.org/10.34894/INZBF2', 'data')] : s))));
    if (range) out.push(h('p.note', null, 'The sources disagree, so the range between them is shown.'));
  }
  const series = rows.filter((r) => r !== at);
  if (series.length) {
    out.push(h('p.note', null, 'Other years: ', series.map((r, i) => [i ? '; ' : '', `${formatYear(r[0])}: about ${people(r[1])}`])));
  }
  if (p.popw?.length) {
    out.push(h('p.note', null, 'Recorded on Wikidata: ', p.popw.map((r, i) => [i ? '; ' : '', `${formatYear(r[0])}: ${num(r[1])}`, r[2] && r[2] !== 'Wikidata' ? ` (${r[2]})` : ''])));
  }
  return section('pop', 'Population', !phone(), out);
}

function govSection(p, doc) {
  const out = [];
  if (p.gov?.length) {
    out.push(h('p', null, h('b', null, 'Form of government: '), p.gov.join('; '), ' ',
      p.govSrc === 'c' ? [aiTag(), ' ', src(p.govCite, 'Source')] : tag('Wikidata', 'From Wikidata (P122, basic form of government)')));
  } else if (p.govAny?.length) {
    out.push(h('p', null, h('b', null, 'Forms of government at some time: '), p.govAny.join('; '), ' ',
      tag('undated', 'Wikidata lists these for the whole history of the state without dates')));
  }
  if (p.regime) out.push(h('p.note', null, `This period on the map is the ${p.regime[0]} `, src(wiki(p.regime[0]), 'Wikipedia')));
  if (p.party) {
    const [name, q, who, office, cur] = p.party;
    out.push(h('p', null, h('b', null, 'Ruling party: '), q ? src('https://www.wikidata.org/wiki/' + q, name) : name,
      who ? h('span.muted', null, ` (party of ${who}, ${office})`) : h('span.muted', null, ` (${String(office).replace(/ \(https?:[^)]*\)$/, '')})`),
      cur ? [' ', aiTag()] : ''));
  }
  if (p.parties?.length) {
    out.push(h('p', null, h('b', null, 'Parties active in these years'), h('span.muted', null, ' (most written about first):')),
      h('ul.ctx-list', null, p.parties.map(([n, q, a, b, ideo]) => h('li', null, src('https://www.wikidata.org/wiki/' + q, n),
        h('span.muted', null, ` ${a != null ? formatYear(a) : '?'}–${b != null ? formatYear(b) : ''}${ideo?.length ? ' · ' + ideo.join(', ') : ''}`)))));
  }
  if (!out.length) return null;
  return section('gov', 'Government and parties', !phone(), out);
}

function relSection(p) {
  if (!p.rel?.length) return null;
  const label = { official: 'official', majority: 'majority', rulers: 'religion of the rulers', recognised: 'recognised', recorded: 'recorded', 'recorded, undated': 'recorded, undated' };
  return section('rel', 'Religion', !phone(),
    h('ul.ctx-list', null, p.rel.map(([v, k, s, url, note]) => h('li', null, h('b', null, v), ' ',
      tag(label[k] || k, k === 'majority' ? 'Most of the population, where censuses or surveys show it' : k === 'official' ? 'The state religion or established church' : k === 'recorded' ? 'Wikidata records this religion for the state, without saying whether it was official or held by most people' : ''),
      ' ', s === 'c' ? [aiTag(), ' ', src(url, 'Source')] : src(url, 'Wikidata'), note ? h('span.muted', null, ` ${note}`) : null))),
    h('p.note', null, 'No shares are given unless a source gives them.'));
}

function leaderSection(p) {
  if (!p.leaders?.length) return null;
  const seen = new Set();
  const rows = p.leaders.filter((l) => { const k = l[0] + l[3]; if (seen.has(k)) return false; seen.add(k); return true; });
  return section('lead', 'Leaders', !phone(), h('ul.ctx-list', null, rows.map(([n, a, b, t, party]) => h('li', null, h('b', null, n), `, ${t}`,
    h('span.muted', null, ` (${formatYear(a)}${b != null && b !== a ? '–' + formatYear(b) : ''})${party ? ' · ' + party : ''}`)))),
  h('p.note', null, 'Heads of state and government from Wikidata and GeoHistory\'s curated ruler lists; party from Wikidata.'));
}

function movSection(p) {
  if (!p.mov?.length) return null;
  return section('mov', 'Movements', !phone(), h('ul.ctx-list', null, p.mov.map(([n, a, b, text, url, kind, v]) => h('li', null, h('b', null, n),
    h('span.muted', null, ` ${formatYear(a)}${b != null ? '–' + formatYear(b) : ''}`), text ? `: ${text}` : '', ' ',
    kind === 'c' ? [aiTag(), v === false ? [' ', tag('dates unconfirmed', 'Wikidata gives another start year')] : null, ' ', src(url, 'Wikipedia')] : src(url, 'Wikidata')))));
}

function discSection(p) {
  if (!p.disc?.length) return null;
  return section('disc', 'Discoveries and inventions', !phone(), h('ul.ctx-list', null, p.disc.map(([y, l, who, k, link, note, how, v, approx]) => h('li', null,
    h('b', null, l), h('span.muted', null, ` ${approx ? 'c. ' : ''}${formatYear(y)}`), who ? ` · ${who}` : '', note ? h('span.muted', null, ` ${note}`) : null,
    ' ', src(isUrl(link) ? link : wiki(link), isUrl(link) && link.includes('wikidata') ? 'Wikidata' : 'Wikipedia'),
    v === false || v === null ? [' ', tag('date unconfirmed', 'Wikidata does not confirm this year')] : null,
    how ? h('span.muted', null, ` (${how})`) : null))),
  p.discMore ? h('p.note', null, `And ${p.discMore} more.`) : null);
}

/** The context sections for a state (key: its map name) or an empire (key: "e:<id>") in a year. */
export async function contextSections(key, y) {
  let doc;
  try { doc = await loadState(key); } catch { return []; }
  const p = doc && sliceFor(doc, y);
  if (!p) return [];
  const span = p.from === p.to ? formatYear(p.from) : `${formatYear(p.from)}–${formatYear(p.to)}`;
  const glance = h('details.ctx.ctx-glance', { open: true, 'data-sec': 'glance' }, h('summary', null, h('span', null, 'At a glance'), h('span.muted', null, ` ${span}`)),
    h('div.ctx-body', null, h('p', null, p.glance), h('p.note', null, 'Built from the facts below, each with its source.')));
  return [glance, popSection(p, y), govSection(p, doc), relSection(p), leaderSection(p), movSection(p), discSection(p)].filter(Boolean);
}

// ---------------------------------------------------------------- event write-ups
const wuMemo = new Map();

async function gunzipJSON(path) {
  const r = await fetch(dataUrl(path));
  if (!r.ok) throw new Error(`Could not load ${path}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  let text;
  if (buf[0] === 0x1f && buf[1] === 0x8b && 'DecompressionStream' in window) {
    const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    text = await new Response(s).text();
  } else text = new TextDecoder().decode(buf);   // already decoded by the server
  return JSON.parse(text);
}

export async function writeupFor(e, blockFile) {
  if (!blockFile) return null;
  const path = 'writeups/' + blockFile.replace(/\.json$/, '.json.gz');
  if (!wuMemo.has(path)) wuMemo.set(path, getJSON('writeups/index.json').then((idx) => (idx[blockFile] ? gunzipJSON(path) : {})).catch(() => { wuMemo.delete(path); return {}; }));
  return (await wuMemo.get(path))[e.i] || null;
}

/** The write-up section of an event panel. */
export function writeupBlock(w) {
  if (!w) return h('p.note.wu-none', null, 'No detailed source found for this event.');
  const box = h('section.wu', { 'aria-label': 'About this event' });
  if (w.k === 1) {
    box.append(h('h2', null, 'What happened ', aiTag()));
    for (const t of w.p) box.append(h('p', null, t));
    if (w.dis) box.append(h('p.note', null, h('b', null, 'Where the sources differ: '), w.dis));
    box.append(h('h3', null, 'Sources'), h('ol.wu-src', null, w.s.map(([t, url, pub, at]) => h('li', null, src(url, t), h('span.muted', null, ` · ${pub} · read ${at}`)))));
    box.append(h('p.note', null, 'Written for GeoHistory from the sources listed; every fact in it is matched to one of them. Copyrighted pages are cited for facts only, never copied.'));
  } else {
    box.append(h('h2', null, 'From Wikipedia'));
    for (const t of w.p) box.append(h('p', null, t));
    if (w.yd) box.append(h('p.note', null, h('span.unver', null, 'dates may differ'), ' This text does not name the year this event is filed under.'));
    const [t, url, pub, at] = w.s[0];
    box.append(h('p.note', null, 'Quoted from ', src(url, `"${t}"`), `, ${pub}, Wikipedia contributors, CC BY-SA 4.0 (dump of ${at}).`));
  }
  return box;
}
