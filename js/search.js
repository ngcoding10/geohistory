// Search box: territories, ruling powers, today's countries, US states and colonies, and events.
// Normal matching first (word starts and substrings); when that finds little, the shared typo-tolerant
// index (fuzzy.js) fills in, so "ottomon", "prusia" and "constantinopel" still find something.
import { createFuzzyIndex, foldText } from './fuzzy.js';
import { loadSearch } from './data.js';
import { formatYear } from './year.js';

const KIND = { p: 'Territory', m: "Today's country", u: 'US state or colony', e: 'Event', c: 'Place' };

export class Search {
  constructor(input, list, onChoose) {
    this.input = input;
    this.list = list;
    this.onChoose = onChoose;
    this.items = null;
    this.fuzzy = null;
    this.active = -1;
    this.results = [];
    input.addEventListener('focus', () => this.ensure());
    input.addEventListener('input', () => this.update());
    input.addEventListener('keydown', (e) => this.key(e));
    input.addEventListener('blur', () => setTimeout(() => this.close(), 150));
    list.addEventListener('mousedown', (e) => e.preventDefault());
    list.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-i]');
      if (li) this.choose(+li.dataset.i);
    });
  }

  async ensure() {
    if (this.items) return this.items;
    if (!this.loading) {
      this.loading = loadSearch().then((d) => {
        const items = [];
        for (const p of d.polities) items.push({ k: 'p', n: p[0], ys: p[1], w: p[2] || 0 });
        for (const m of d.modern) items.push({ k: 'm', n: m[0], iso: m[1], alt: m[2] || [], w: 5 });
        for (const u of d.us) items.push({ k: 'u', n: u[0], id: u[1], y0: u[2], y1: u[3], w: 3 });
        for (const e of d.events) items.push({ k: 'e', n: e[0], i: e[1], y: e[2], f: e[3], w: e[4] || 0 });
        for (const c of d.places || []) items.push({ k: 'c', n: c[0], alt: [c[1]], ys: c[2], w: 2 });
        for (const it of items) it.f0 = foldText(it.n + ' ' + (it.alt || []).join(' '));
        this.items = items;
        this.fuzzy = createFuzzyIndex(items, (it) => [it.n, ...(it.alt || [])], { weight: (it) => it.w });
        return items;
      });
    }
    return this.loading;
  }

  async update() {
    const q = this.input.value;
    const fq = foldText(q);
    if (fq.length < 2) { this.close(); return; }
    if (!this.items) {
      this.render([], 'Loading…');
      try { await this.ensure(); } catch { this.render([], 'Search could not load. Check your connection.'); return; }
      if (foldText(this.input.value) !== fq) return;
    }
    const words = fq.split(' ');
    const scored = [];
    for (const it of this.items) {
      const f = it.f0;
      if (!words.every((w) => f.includes(w))) continue;
      let s = 0;
      if (f === fq) s = 4;
      else if (f.startsWith(fq)) s = 3;
      else if (words.every((w) => f.startsWith(w) || f.includes(' ' + w))) s = 2;
      else s = 1;
      scored.push({ it, s });
    }
    scored.sort((a, b) => b.s - a.s || b.it.w - a.it.w);
    let out = scored.slice(0, 12).map((x) => x.it);
    if (out.length < 5) {
      const seen = new Set(out);
      for (const r of this.fuzzy.search(q, { limit: 12 })) {
        if (!seen.has(r.item)) { out.push(r.item); seen.add(r.item); }
        if (out.length >= 12) break;
      }
    }
    this.render(out, out.length ? '' : 'Nothing found. Try another spelling or a year.');
  }

  render(items, emptyText) {
    this.results = items;
    this.active = items.length ? 0 : -1;
    this.list.innerHTML = '';
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'r-empty';
      li.textContent = emptyText;
      this.list.append(li);
    }
    items.forEach((it, i) => {
      const li = document.createElement('li');
      li.id = 'res-' + i;
      li.dataset.i = i;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', i === this.active ? 'true' : 'false');
      const a = document.createElement('span');
      a.className = 'r-name';
      a.textContent = it.n;
      const b = document.createElement('span');
      b.className = 'r-meta';
      b.textContent = meta(it);
      li.append(a, b);
      this.list.append(li);
    });
    this.list.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
    this.input.setAttribute('aria-activedescendant', this.active >= 0 ? 'res-' + this.active : '');
  }

  key(e) {
    if (e.key === 'Escape') { this.close(); this.input.blur(); return; }
    if (this.list.hidden || !this.results.length) {
      if (e.key === 'Enter') { e.preventDefault(); this.update(); }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = this.results.length;
      this.active = (this.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      [...this.list.children].forEach((li, i) => li.setAttribute('aria-selected', i === this.active ? 'true' : 'false'));
      this.input.setAttribute('aria-activedescendant', 'res-' + this.active);
      this.list.children[this.active]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.active >= 0) this.choose(this.active);
    }
  }

  choose(i) {
    const it = this.results[i];
    if (!it) return;
    this.close();
    this.input.value = '';
    this.input.blur();
    this.onChoose(it);
  }

  close() {
    this.list.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
  }
}

function meta(it) {
  if (it.k === 'e') return formatYear(it.y);
  if (it.k === 'p' || it.k === 'c') {
    const a = it.ys[0], b = it.ys[it.ys.length - 1];
    return a === b ? `${KIND[it.k]}, ${formatYear(a)} map` : `${KIND[it.k]}, ${formatYear(a)}–${formatYear(b)} maps`;
  }
  if (it.k === 'u') return `${KIND.u}, ${it.y0}–${it.y1}`;
  return KIND[it.k];
}
