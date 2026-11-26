// Small DOM helpers and the pieces of the side panel.
import { TYPES, typeColor } from './types.js';
import { formatYear, formatDate, MONTH_NAMES } from './year.js';

/** h('p.cls', {attrs}, children...) */
export function h(tag, attrs, ...kids) {
  const [name, ...cls] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

export const wikiUrl = (title) => 'https://en.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'));
export const wikidataUrl = (q) => 'https://www.wikidata.org/wiki/' + q;

export function fmtArea(km2) {
  if (!km2) return '';
  if (km2 >= 1e6) return `${(km2 / 1e6).toFixed(km2 >= 1e7 ? 0 : 1)} million km²`;
  if (km2 >= 1000) return `${Math.round(km2 / 1000).toLocaleString('en-GB')},000 km²`;
  return `${Math.round(km2).toLocaleString('en-GB')} km²`;
}

export function eventDate(e) {
  const base = formatDate(e.y, e.m, e.dd);
  return e.y2 && e.y2 !== e.y ? `${base} to ${formatYear(e.y2)}` : base;
}

export function placeLine(e, modernNames) {
  const bits = [];
  if (e.loc && e.loc !== e.p) bits.push(e.loc);
  if (e.c) bits.push(e.c);
  if (e.p) bits.push(e.p);
  else if (e.cn?.length) bits.push(e.cn[0]);
  const mn = e.mc && modernNames?.[e.mc];
  if (mn && !bits.some((b) => b.includes(mn))) bits.push(`today ${mn}`);
  return bits.join(' · ');
}

/** One event row in a list. */
export function eventRow(e, { onOpen, highlight = false, showYear = false, modernNames }) {
  const t = TYPES[e.t] || TYPES.other;
  const when = showYear ? eventDate(e) : (e.m ? formatDate(null, e.m, e.dd).trim() : '');
  const place = placeLine(e, modernNames);
  return h('li', null, h('button.ev' + (highlight ? '.today' : ''), { type: 'button', onclick: () => onOpen(e) },
    h('span.dot', { style: `background:${typeColor(e.t)}`, 'aria-hidden': 'true' }),
    h('span', null,
      h('span.t', null, e.l, e.uv ? h('span.unver', { title: 'Not confirmed by Wikidata' }, 'unverified') : null),
      h('span.m', null, [t.one, when, place].filter(Boolean).join(' · ')),
      e.d ? h('span.d', null, e.d) : null)));
}

export function eventList(events, opts, limit = 12) {
  const ul = h('ul.events');
  const shown = events.slice(0, limit);
  for (const e of shown) ul.append(eventRow(e, { ...opts, highlight: opts.isToday?.(e) }));
  const wrap = h('div', null, ul);
  if (events.length > limit) {
    const more = h('button.more', { type: 'button', onclick: () => {
      for (const e of events.slice(limit)) ul.append(eventRow(e, { ...opts, highlight: opts.isToday?.(e) }));
      more.remove();
    } }, `Show all ${events.length}`);
    wrap.append(more);
  }
  return wrap;
}

export function filterChips(counts, disabled, onToggle) {
  const box = h('div.filters', { role: 'group', 'aria-label': 'Event types' });
  for (const [k, t] of Object.entries(TYPES)) {
    if (!counts[k]) continue;
    const on = !disabled.has(k);
    box.append(h('button', { type: 'button', 'aria-pressed': on ? 'true' : 'false', onclick: () => onToggle(k) },
      h('span.dot', { style: `background:${t.color}`, 'aria-hidden': 'true' }), `${t.label} ${counts[k]}`));
  }
  return box;
}

export function skeleton(n = 4) {
  return h('div', { 'aria-hidden': 'true' }, Array.from({ length: n }, (_, i) => h('div.skeleton', { style: `width:${90 - i * 12}%` })));
}

export function dayLabel(m, d) {
  return d ? `${d} ${MONTH_NAMES[m - 1]}` : MONTH_NAMES[m - 1];
}
