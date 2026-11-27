// Flags (tools/build_flags.py, data/flags/): the flag of each state in each year it is on the map, as a small
// badge beside the state's name and larger in the click panel. Badges come from sprite sheets, one per era,
// loaded when a year of that era is first shown; the panel image is loaded on click.
import { getJSON, dataUrl } from './data.js';
import { h } from './ui.js';
import { formatYear } from './year.js';

let idx = null;
export const loadFlagColors = () => getJSON('flags/colors.json');
export const loadFlags = () => getJSON('flags/index.json').then((d) => (idx = d));

const fileTitle = (f) => f.replace(/\.(svg|png|jpe?g|gif)$/i, '');
const commonsUrl = (f) => 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(f.replace(/ /g, '_'));

/** The flag of a map state in a year: {id, from, to, flags, item, note, file, lic, by} or null. */
export function flagFor(name, year) {
  const rs = idx?.s?.[name];
  if (!rs) return null;
  for (const r of rs) {
    if (r[0] <= year && year <= r[1]) {
      const f = idx.f[r[2]];
      return { id: r[2], from: r[0], to: r[1], flags: r[3] || '', item: r[4], note: r[5] != null ? idx.n[r[5]] : null, file: f[0], lic: f[1], by: f[2] || '' };
    }
  }
  return null;
}

/** A coat of arms for a state with no flag at all (Wikidata P94 on the state's own item), or null. */
export function emblemFor(name) {
  const e = idx?.e?.[name];
  if (!e) return null;
  const f = idx.f[e[0]];
  return { id: e[0], item: e[1], file: f[0], lic: f[1], by: f[2] || '' };
}

// ---- badges on the map
const sheets = new Map();
const loadImage = (url) => new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = rej; im.src = url; });
/** Add the badge images of the era of `year` to the map (once per era). */
export function ensureSheet(map, year) {
  const sh = idx?.sheets?.find(([a, b]) => a <= year && year <= b);
  if (!sh) return Promise.resolve();
  const n = sh[2];
  if (!sheets.has(n)) {
    const p = Promise.all([getJSON(`flags/s${n}.json`), loadImage(dataUrl(`flags/s${n}.png`))]).then(([pos, img]) => {
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      for (const [id, [x, y, w, hh]] of Object.entries(pos)) {
        const nm = 'flag-' + id;
        if (!map.hasImage(nm)) map.addImage(nm, cx.getImageData(x, y, w, hh), { pixelRatio: 2 });
      }
    });
    p.catch(() => sheets.delete(n));
    sheets.set(n, p);
  }
  return sheets.get(n);
}

const MIN_PX2 = 2600;     // a badge shows once the state covers about 50 by 50 pixels
/** Badge points for a prepared map document: [{type:'Feature', ...}] with properties
 *  id (image), k ('s' state, 'e' empire at world zoom, 'p' part when zoomed in), a (area), zm (smallest
 *  zoom at which the state is large enough), r (rank by area among the badges of its zoom range). */
export function badgeFeatures(doc, year, emp) {
  if (!idx || !doc?.groups) return [];
  const pols = doc.polities;
  const out = [];
  const zmin = (a, lat) => Math.log2((40075 * Math.sqrt(MIN_PX2)) / (512 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)) * Math.sqrt(Math.max(a, 1))));
  // o: how far below the label point: 2 for a name that wraps onto two lines, 0 else
  const add = (k, f, at, a, n, label = n) => out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: at },
    properties: { id: 'flag-' + f.id, k, a, zm: Math.round(zmin(a, at[1]) * 100) / 100, n, re: 9999, rp: 9999,
      o: label.length > 10 && /\s/.test(label) ? 2 : 0 } });
  for (const g of doc.groups) {
    if (g.kind === 'region' || !g.at) continue;
    if (g.kind === 'state') {
      const p = pols[g.members[0]];
      if (p.under && !p.s) continue;
      const f = flagFor(p.n, year);
      if (f) add('s', f, g.at, g.area, p.n, p.ln || p.n);
      continue;
    }
    // an empire: its ruling state's flag at world zoom; each part with a flag of its own when zoomed in
    const ms = g.members.map((k) => pols[k]);
    const core = ms.find((p) => p.core);
    const coreName = core?.n || emp?.empires?.[g.id]?.core?.find((n) => flagFor(n, year));
    const fe = coreName && flagFor(coreName, year);
    if (fe) add('e', fe, g.at, g.area, coreName, g.name);
    for (const p of ms) {
      if (!p.l) continue;
      const f = flagFor(p.n, year);
      if (f) add('p', f, p.l, p.a, p.n);
    }
  }
  // ranks: world zoom (states and empires) and zoomed in (states and parts)
  for (const set of [['s', 'e'], ['s', 'p']]) {
    const fs = out.filter((f) => set.includes(f.properties.k)).sort((a, b) => b.properties.a - a.properties.a);
    fs.forEach((f, i) => { f.properties['r' + set[1]] = i; });
  }
  return out;
}

// ---- the click panel
/** The flag block of a territory or empire panel for the state `name` in `year`. */
export async function flagBlock(name, year, { label = null } = {}) {
  try { await loadFlags(); } catch { return null; }
  const f = flagFor(name, year);
  const box = h('div.flagbox');
  if (f) {
    const notes = [];
    if (f.flags.includes('s')) notes.push('A royal banner or standard: the state had no national flag.');
    if (f.flags.includes('u')) notes.push('Uncertain: not an official national flag, or the source gives no dates (dated from the file name).');
    box.append(
      h('img.flagbig', { src: dataUrl(`flags/b/${f.id}.png`), alt: fileTitle(f.file), loading: 'lazy' }),
      h('div.flagtext', null,
        h('p.flagname', null, fileTitle(f.file)),
        h('p.muted', null, `${label || name}, shown for ${formatYear(f.from)}${f.to !== f.from ? ` to ${formatYear(f.to)}` : ''}`),
        f.note ? h('p.note', null, f.note) : null,
        notes.length ? h('p.note.flagwarn', null, notes.join(' ')) : null,
        /^redrawn/.test(f.lic) ? h('p.note.flagwarn', null, 'Redrawn from description: Wikimedia Commons would not serve this image, so it was drawn here from the published description of its design (a simple geometric flag).') : null,
        h('p.note', null, h('a', { href: commonsUrl(f.file), target: '_blank', rel: 'noopener' }, /^redrawn/.test(f.lic) ? 'The original on Wikimedia Commons' : 'Wikimedia Commons'),
          /^redrawn/.test(f.lic) ? ' · redrawn from description' : ` · ${f.lic}${f.by ? ', ' + f.by : ''}`,
          /^Q\d+$/.test(f.item) ? [' · ', h('a', { href: `https://www.wikidata.org/wiki/${f.item}#P41`, target: '_blank', rel: 'noopener' }, 'Wikidata')] : ' · curated')));
    return box;
  }
  const e = emblemFor(name);
  if (e) {
    box.append(h('img.flagbig.emblem', { src: dataUrl(`flags/b/${e.id}.png`), alt: fileTitle(e.file), loading: 'lazy' }),
      h('div.flagtext', null,
        h('p.flagname', null, h('span.unver', null, 'emblem, not a flag'), ' ', fileTitle(e.file)),
        h('p.note', null, 'No flag is recorded for this state. This is the coat of arms Wikidata gives for it, undated.'),
        h('p.note', null, h('a', { href: commonsUrl(e.file), target: '_blank', rel: 'noopener' }, 'Wikimedia Commons'), ` · ${e.lic}${e.by ? ', ' + e.by : ''}`)));
    return box;
  }
  return h('p.note.noflag', null, `No flag is recorded for ${label || name} in ${formatYear(year)}. Many states before modern times had none.`);
}
