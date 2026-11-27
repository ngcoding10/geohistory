// Groups on the map: empires and their parts, and the regions that stateless peoples are merged into at
// world zoom. Also the draw order ("slots") that hides the borders inside a group, and colour helpers.

/** The membership of a map row in a year: {id, kind, flags, note, part} or null. */
export function membershipOf(emp, name, year) {
  const ms = emp?.rows?.[name];
  if (!ms) return null;
  for (const m of ms) {
    if (m[0] <= year && year <= m[1]) return { id: m[2], kind: m[3], flags: m[4] || '', note: m[5] != null ? emp.notes[m[5]] : null, part: m[6] || name };
  }
  return null;
}

/** The name an empire goes by in a year. */
export function empireName(emp, id, year) {
  const e = emp?.empires?.[id];
  if (!e) return id;
  for (const [a, b, n] of e.names || []) if ((a == null || a <= year) && (b == null || year <= b)) return n;
  return e.n;
}

/** Parts of an empire in a year that have no shape of their own: [{n, from, to, kind, flags, note, w}]. */
export function listedParts(emp, id, year) {
  return (emp?.undrawn?.[id] || []).filter((u) => u[1] <= year && year <= u[2])
    .map((u) => ({ n: u[0], from: u[1], to: u[2], kind: u[3], flags: u[4] || '', note: u[5] != null ? emp.notes[u[5]] : null, w: u[6] }));
}

// Regions for the peoples and cultures of the sketch maps: [name, west, south, east, north], first match wins.
const REGIONS = [
  ['Arctic', -180, 62, -10, 90], ['Subarctic', -170, 50, -50, 62], ['Pacific coast and Plateau', -135, 30, -114, 50],
  ['Great Plains', -114, 28, -93, 50], ['Eastern Woodlands', -93, 24, -50, 50], ['Mesoamerica and the Caribbean', -118, 7, -58, 30],
  ['Andes', -82, -40, -67, 7], ['Brazilian highlands and coast', -52, -34, -34, -2], ['Amazonia and the Guianas', -70, -18, -44, 12],
  ['Southern Cone', -76, -56, -50, -18],
  ['Northern Europe', -25, 54, 45, 72], ['Western Europe', -12, 36, 8, 54], ['Central Europe', 8, 44, 25, 54],
  ['Eastern Europe', 25, 44, 60, 75], ['Mediterranean', -10, 30, 37, 44],
  ['Sahara', -18, 16, 36, 30], ['West Africa and the Sahel', -18, 3, 28, 16], ['Central Africa', 8, -12, 30, 5],
  ['East Africa and the Horn', 28, -12, 52, 16], ['Madagascar', 42, -27, 51, -11], ['Southern Africa', 10, -36, 42, -12],
  ['Arabia', 34, 12, 60, 32], ['Siberia', 58, 54, 180, 80], ['Central Asian steppe', 45, 40, 90, 54], ['Mongolian steppe', 88, 40, 125, 54],
  ['Iran and Central Asia', 44, 24, 78, 40], ['Tibetan plateau', 78, 27, 103, 40], ['Indian subcontinent', 66, 5, 93, 35],
  ['Mainland Southeast Asia', 92, 5, 110, 28], ['East Asia', 100, 20, 146, 54], ['Island Southeast Asia', 94, -11, 130, 20],
  ['Australia', 112, -45, 155, -10], ['New Guinea and Melanesia', 130, -12, 180, 0], ['New Zealand', 165, -48, 180, -33],
  ['Pacific islands', 155, -30, 180, 30], ['Pacific islands', -180, -50, -100, 30],
  ['Africa', -20, -36, 52, 38], ['Europe', -25, 36, 60, 72], ['Asia', 25, 0, 180, 80], ['North America', -170, 7, -50, 84], ['South America', -82, -56, -34, 13],
  ['Other regions', -180, -90, 180, 90],
];
export function regionOf(lon, lat) {
  for (const r of REGIONS) if (lon >= r[1] && lon <= r[3] && lat >= r[2] && lat <= r[4]) return r[0];
  return 'Other regions';
}

// ---- colour helpers (sRGB <-> OKLCH) ----
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
export function hexToLch(hex) {
  const r = lin(parseInt(hex.slice(1, 3), 16) / 255), g = lin(parseInt(hex.slice(3, 5), 16) / 255), b = lin(parseInt(hex.slice(5, 7), 16) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), (Math.atan2(B, A) * 180) / Math.PI];
}
export function lchToHex([L, C, H]) {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(1, gam(v))) * 255).toString(16).padStart(2, '0')).join('');
}
const hash = (s) => { let hsh = 2166136261; for (let i = 0; i < s.length; i++) hsh = Math.imul(hsh ^ s.charCodeAt(i), 16777619); return (hsh >>> 0) / 4294967296; };

// ---- the map palette: bold, flat colours, two lightness bands of twelve hues (OKLCH). Every power has a
// preferred entry that stays the same in every year (from the hue of its stored colour, else its key); a
// graph-colouring pass per map (colorGroups) keeps neighbours apart and moves a power off its entry only
// when a larger neighbour already holds a colour too close to it.
const HUES = [22, 48, 75, 100, 128, 150, 172, 200, 232, 262, 298, 335];
export const PALETTE = [];
for (const band of [0, 1]) for (const H of HUES) {
  const L = band ? 0.7 : 0.81;
  const C = band ? 0.135 : 0.125 + (H > 60 && H < 140 ? 0.02 : 0);
  PALETTE.push(lchToHex([L, C, H + (band ? 8 : 0)]));
}
const LAB = PALETTE.map((hex) => { const [L, C, H] = hexToLch(hex); return [L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)]; });
const dist = (i, j) => Math.hypot(LAB[i][0] - LAB[j][0], LAB[i][1] - LAB[j][1], LAB[i][2] - LAB[j][2]);
const prefMemo = new Map();
/** The palette entry a power prefers: the hue of its stored colour when that has one, its key otherwise. */
export function preferredIndex(key, stored) {
  const mk = key + '|' + stored;
  if (prefMemo.has(mk)) return prefMemo.get(mk);
  const band = hash(key + '#') < 0.5 ? 0 : 1;
  let hi;
  if (stored && /^#[0-9a-f]{6}$/i.test(stored) && hexToLch(stored)[1] > 0.045) {
    const H = (hexToLch(stored)[2] + 360) % 360;
    let best = 0;
    HUES.forEach((h, i) => { const d = Math.min(Math.abs(h - H), 360 - Math.abs(h - H)); if (d < Math.min(Math.abs(HUES[best] - H), 360 - Math.abs(HUES[best] - H))) best = i; });
    hi = best;
  } else hi = Math.floor(hash(key) * HUES.length);
  const i = band * HUES.length + hi;
  prefMemo.set(mk, i);
  return i;
}
/** A power's own map colour (light-theme hex), as preferred. */
export const vividColor = (key, stored) => PALETTE[preferredIndex(key, stored)];

// ---- fills from flags: each power is filled with a colour of the flag of the present-day country it maps to
// (data/flags/colors.json, tools/build_flags.py): the flag's most distinctive colour first, then its second
// colour, each set into the map's two lightness bands so that names stay readable.
const lab = (hex) => { const [L, C, H] = hexToLch(hex); return [L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)]; };
const labMemo = new Map();
const labOf = (hex) => { let v = labMemo.get(hex); if (!v) labMemo.set(hex, (v = lab(hex))); return v; };
export const hexDist = (a, b) => { const x = labOf(a), y = labOf(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
const BANDS = [0.8, 0.68];
/** A flag colour set into a lightness band of the map (0: light, 1: deeper). */
export function flagTone(hex, band) {
  const [, C, H] = hexToLch(hex);
  const yellow = H > 70 && H < 115;
  // yellows stay golden in the deeper band (at the band's own lightness they turn olive)
  return lchToHex([BANDS[band] + (yellow ? (band === 0 ? 0.06 : 0.08) : 0), Math.max(0.05, Math.min(yellow ? 0.15 : 0.145, C)), yellow && band === 1 ? H - 12 : H]);
}
const candMemo = new Map();
/** The fill candidates of a power, best first: [first colour, second colour] in the band nearest the flag's
 *  own lightness, then both in the other band. Without flag colours: the palette entry it prefers, then its
 *  twin in the other band. */
export function fillCandidates(key, stored, flagCols) {
  const mk = key + '|' + stored + '|' + (flagCols || []).join(',');
  if (candMemo.has(mk)) return candMemo.get(mk);
  let out;
  const cols = (flagCols || []).filter(Boolean);
  if (cols.length) {
    const b0 = hexToLch(cols[0])[0] >= 0.66 ? 0 : 1;
    out = [];
    for (const b of [b0, 1 - b0]) for (const c of cols) out.push(flagTone(c, b));
  } else {
    const p = preferredIndex(key, stored);
    out = [PALETTE[p], PALETTE[(p + HUES.length) % PALETTE.length]];
  }
  candMemo.set(mk, out);
  return out;
}

/** Colour the groups of one map. adj: Map(group index -> Set of neighbouring group indices). cands[i]: the
 *  fill candidates of group i, best first (null for regions, which keep their own pale tints). Larger groups
 *  (an empire by its ruling state's own land) choose first; a group takes its first candidate unless a neighbour that chose before is too close to it,
 *  then its next (its flag's second colour, then a lightness shift), else the nearest palette entry that is
 *  clear of every such neighbour. Neighbours always differ. Deterministic: the same map always gets the
 *  same colours, whatever year was shown before. */
export const MIN_FILL_DIST = 0.085;
// the size that decides who chooses first: an empire's ruling state (its homeland), not its colonies
const sz = (g) => g.carea ?? g.area;
export function colorGroups(groups, adj, cands) {
  const order = groups.map((g, i) => i).filter((i) => cands[i] != null).sort((a, b) => sz(groups[b]) - sz(groups[a]) || a - b);
  const pick = new Map();
  for (const i of order) {
    const nb = [...(adj.get(i) || [])].filter((j) => pick.has(j)).map((j) => pick.get(j));
    const clear = (c) => nb.every((o) => o !== c && hexDist(c, o) >= MIN_FILL_DIST);
    const own = cands[i];
    let c = own.find(clear);
    if (c == null) {
      const rest = [...PALETTE].sort((a, b) => hexDist(a, own[0]) - hexDist(b, own[0]));
      c = rest.find(clear);
      if (c == null) c = rest.reduce((a, b) => (Math.min(...nb.map((o) => hexDist(b, o))) > Math.min(...nb.map((o) => hexDist(a, o))) ? b : a));
    }
    pick.set(i, c);
  }
  return pick;
}

const memo = new Map();
/** Map colours for one power colour: fill (group colour), part (a member's own tone of the same hue, shown
 *  when zoomed in), under (pale tone for peoples and sketch regions), edge (the dark border line).
 *  Dark theme: deeper fills under light text. */
export function tones(hex, name, dark) {
  const key = hex + '|' + name + '|' + dark;
  if (memo.has(key)) return memo.get(key);
  const [L, C, H] = hexToLch(hex);
  const t = hash(name);
  const fl = dark ? L * 0.74 : L;
  const fc = dark ? C * 0.95 : C;
  const out = {
    fill: lchToHex([fl, fc, H]),
    part: lchToHex([fl + (t - 0.5) * (dark ? 0.09 : 0.085), fc * (0.78 + 0.4 * hash(name + 'c')), H + (hash(name + 'h') - 0.5) * 22]),
    under: lchToHex(dark ? [0.3 + (t - 0.5) * 0.03, Math.min(0.05, C * 0.4), H] : [0.9 + (t - 0.5) * 0.025, Math.min(0.045, C * 0.4), H]),
    edge: lchToHex(dark ? [0.13, Math.min(0.04, fc * 0.4), H] : [0.33, Math.min(0.06, C * 0.5), H]),
  };
  memo.set(key, out);
  return out;
}

/** Attach groups to a snapshot document for a year: sets on every polity
 *    e     empire id when the polity is merged into an empire (root of a chain: Papua -> Australia -> British Empire)
 *    mem   its membership {id, kind, flags, note, part} (also when not merged)
 *    core  true for the ruling state of the empire itself
 *    reg   region name for sketch-map peoples
 *  and returns {groups, sig}: groups[i] = {key, name, kind: 'empire'|'state'|'region', members: [k...], area}. */
export function attachGroups(doc, emp, year) {
  const pols = doc.polities;
  for (const p of pols) { p.e = null; p.mem = null; p.core = false; p.reg = null; }
  const states = pols.filter((p) => !p.under || p.s);
  for (const p of states) {
    p.mem = membershipOf(emp, p.n, year);
    if (p.mem && !p.mem.flags.includes('n') && emp.empires[p.mem.id]) p.e = p.mem.id;
  }
  // the ruling state joins its empire when the empire has drawn or listed parts this year
  const active = new Set(states.filter((p) => p.e).map((p) => p.e));
  for (const id of Object.keys(emp.empires || {})) if (!active.has(id) && listedParts(emp, id, year).length) active.add(id);
  const coreOf = new Map();
  for (const id of active) for (const n of emp.empires[id].core || []) if (!coreOf.has(n)) coreOf.set(n, id);
  for (const p of states) {
    const id = coreOf.get(p.n);
    if (id && !p.under) {
      if (!p.e) { p.e = id; p.core = true; } else if (p.e !== id) p.coreOf = id;   // Australia: core of its own, member of another
    }
  }
  // chains: an empire whose ruling state is itself a member of another empire
  const up = new Map();
  for (const p of states) if (p.coreOf && p.e) up.set(p.coreOf, p.e);
  const root = (id) => { let n = 0; while (up.has(id) && n++ < 4) id = up.get(id); return id; };
  for (const p of states) if (p.e) { const r = root(p.e); if (r !== p.e) { p.via = p.e; p.e = r; } }

  const byKey = new Map();
  const add = (key, kind, name, k) => {
    if (!byKey.has(key)) byKey.set(key, { key, kind, name, members: [], area: 0 });
    const g = byKey.get(key);
    g.members.push(k);
    g.area += pols[k].a || 0;
  };
  pols.forEach((p, k) => {
    if (p.under && !p.s) { p.reg = regionOf(p.l[0], p.l[1]); add('r:' + p.reg, 'region', p.reg, k); } else if (p.e) add('e:' + p.e, 'empire', empireName(emp, p.e, year), k);
    else add('p:' + k, 'state', p.n, k);
  });
  const groups = [...byKey.values()];
  // an "empire" with a single drawn member and nothing listed is just that state
  for (const g of groups) {
    if (g.kind === 'empire' && g.members.length === 1 && !listedParts(emp, g.key.slice(2), year).length && pols[g.members[0]].core) {
      const p = pols[g.members[0]];
      p.e = null; p.core = false; g.kind = 'state'; g.name = p.n;
    }
  }
  groups.forEach((g, i) => { for (const k of g.members) pols[k].g = i; });
  const sig = groups.filter((g) => g.kind === 'empire').map((g) => g.key + ':' + g.members.join(',')).join('|');
  return { groups, sig };
}

/** Draw slots: groups that touch get different slots, so a line drawn under a group's own fill shows only
 *  along its outer border. Greedy colouring over a grid of outline samples. */
export function assignSlots(doc, groups, nSlots) {
  const cell = 0.5;
  const grid = new Map();
  const put = (x, y, g) => {
    const key = Math.floor(x / cell) * 4096 + Math.floor(y / cell);
    let s = grid.get(key);
    if (!s) grid.set(key, (s = new Set()));
    s.add(g);
  };
  for (const f of doc.features) {
    const p = doc.polities[f.properties.k];
    if (!p || (p.under && !p.s)) continue;
    const g = p.g;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const ring of poly) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
        const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / (cell * 0.8)));
        for (let j = 0; j < n; j++) put(x0 + ((x1 - x0) * j) / n, y0 + ((y1 - y0) * j) / n, g);
      }
    }
  }
  const adj = new Map();
  const link = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
  for (const [key, s] of grid) {
    // neighbours: same cell and the cells to the east and north (and both diagonals)
    const all = new Set(s);
    for (const d of [4096, 1, 4097, 4095]) { const t = grid.get(key + d); if (t) for (const g of t) all.add(g); }
    if (all.size < 2) continue;
    for (const a of s) for (const b of all) if (a !== b) { link(a, b); link(b, a); }
  }
  const order = groups.map((g, i) => i).filter((i) => groups[i].kind !== 'region').sort((a, b) => groups[b].area - groups[a].area);
  const slot = new Map();
  // OpenHistoricalMap patches (polity.o): a part drawn over a larger shape goes in the top slot, a filled
  // gap in the bottom one (and first in it), so that the sources' own states stay on top of it
  const pols = doc.polities;
  const forced = (g) => { let o = 0; for (const k of g.members) if (pols[k]?.o) o = o > 0 ? o : pols[k].o; return o; };
  let top = false;
  for (const i of order) {
    const o = forced(groups[i]);
    if (o > 0) { slot.set(i, nSlots - 1); top = true; } else if (o < 0) slot.set(i, 0);
  }
  for (const i of order) {
    if (slot.has(i)) continue;
    const used = new Array(nSlots).fill(0);
    for (const j of adj.get(i) || []) if (slot.has(j)) used[slot.get(j)]++;
    let best = 0;
    for (let s = 1; s < (top ? nSlots - 1 : nSlots); s++) if (used[s] < used[best]) best = s;
    slot.set(i, best);
  }
  groups.forEach((g, i) => { g.slot = slot.get(i) ?? 0; });
  return adj;
}
