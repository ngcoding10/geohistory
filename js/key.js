// The map key: a small collapsible card on the map that explains everything drawn on it, with icons made from
// the map's own colours for the year shown. Open by default on wide screens, closed on phones.
import { h } from './ui.js';
import { tones } from './groups.js';
import { hatchColor } from './map.js';
import { TYPES } from './types.js';
import { getPref, setPref } from './store.js';
import { formatYear } from './year.js';

const KEY_TYPES = ['war', 'battle', 'revolt', 'treaty', 'state', 'ruler', 'discovery', 'other'];

export function renderKey(el, { doc, year, dark, wars = [], warOn = true, onWar, onOpenWar }) {
  if (!el) return;
  const open = getPref('keyOpen', window.innerWidth >= 900);
  const groups = (doc?.groups || []).filter((g) => g.kind !== 'region').sort((a, b) => b.area - a.area);
  const fills = groups.slice(0, 3).map((g) => tones(g.color, g.name, dark));
  while (fills.length < 3) fills.push(tones(['#e48a7c', '#7fb2e0', '#9fd07c'][fills.length], 'x', dark));
  const emp = groups.find((g) => g.kind === 'empire' && g.members.length > 1);
  const empT = emp ? tones(emp.color, emp.name, dark) : fills[0];
  const p1 = emp ? tones(emp.color, doc.polities[emp.members[0]].n, dark).part : empT.fill;
  const p2 = emp ? tones(emp.color, doc.polities[emp.members[1]].n, dark).part : empT.fill;
  const reg = (doc?.groups || []).find((g) => g.kind === 'region');
  const under = reg ? tones(reg.color, reg.name, dark).under : (dark ? '#3a3730' : '#ebe5d6');
  const hc = hatchColor(groups[1]?.color || '#7fb2e0', dark);

  const row = (icon, text) => h('li', null, h('span.ki', { 'aria-hidden': 'true' }, icon), h('span.kt', null, text));
  const sw = (bg, edge, extra = '') => h('span.ksw', { style: `background:${bg};border-color:${edge};${extra}` });
  const body = h('div.key-body', { id: 'keyBody', hidden: open ? null : true },
    h('h3', null, 'Land'),
    h('ul', null,
      row(h('span.ktrio', null, fills.map((t) => sw(t.fill, t.edge))),
        'A state. Each power keeps its colour over the years.'),
      row(h('span.ksw.kemp', { style: `--p1:${p1};--p2:${p2};border-color:${empT.edge}` }),
        'An empire. Zoom in to see its parts.'),
      row(h('span.ksw.kunder', { style: `background:${under}` }, h('i', null, 'Aa')),
        'Pale, italic name: peoples, or rough borders.'),
      row(h('span.ksw.khatch', { style: `--hc:${hc}` }), 'Occupied (lines in the occupier\'s colour).'),
      row(h('span.kflash'), 'Flash: land that just changed hands.')),
    h('h3.kwar-h', null, 'War',
      h('label.kswitch', null, h('input', { type: 'checkbox', checked: warOn ? true : null, onchange: (e) => onWar?.(e.target.checked) }), h('span', null, 'Show'))),
    h('ul', { class: warOn ? '' : 'koff' },
      row(h('span.kbattle'), `Battle in ${formatYear(year)}`),
      row(h('span.kwarmk', { 'aria-hidden': 'true' }), 'War going on (no battle shown)'),
      row(h('span.kedge'), 'Land where a shown battle was fought')),
    warOn && wars.length ? h('p.kwars', null, h('span.muted', null, `Major wars in ${formatYear(year)}: `),
      wars.map((w, i) => [i ? ', ' : '', h('button.link', { type: 'button', onclick: () => onOpenWar?.(w.i) }, w.l)])) : null,
    warOn && !wars.length ? h('p.kwars.muted', null, `No war is recorded for ${formatYear(year)}.`) : null,
    h('h3', null, 'Events'),
    h('ul.kdots', null, KEY_TYPES.map((t) => h('li', null, h('span.kdot', { style: `background:${TYPES[t].color}` }), TYPES[t].one))),
    h('p.kt', null, h('span.kcluster', { 'aria-hidden': 'true' }, '12'), ' Several events: click to zoom in.'),
    h('p.kt', null, 'Click land for who ruled it, before and after. Click a marker for the event, the sea to go back.'));
  const btn = h('button.key-toggle', { type: 'button', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': 'keyBody',
    onclick: () => { const o = btn.getAttribute('aria-expanded') !== 'true'; setPref('keyOpen', o); btn.setAttribute('aria-expanded', o ? 'true' : 'false'); body.hidden = !o; } },
  h('svg', null), 'Map key');
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M4 5h3v3H4zm5 .5h11v2H9zM4 10.5h3v3H4zm5 .5h11v2H9zM4 16h3v3H4zm5 .5h11v2H9z"/></svg><span>Map key</span><svg class="chev" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 10l5 5 5-5z"/></svg>';
  el.replaceChildren(btn, body);
}
