// The map: MapLibre GL with only our own data (no tile servers). Globe and flat views, territories filled by
// ruling power, a cross-fade between border snapshots, US states and colonies, and event markers.
import { typeColor, TYPES } from './types.js';

const maplibregl = window.maplibregl;
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const dark = () => document.documentElement.dataset.theme === 'dark'
  || (document.documentElement.dataset.theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);

const COLORS = {
  light: { ocean: '#c6d5d8', land: '#ece5d4', line: '#5e5241', text: '#2a241c', textUnder: '#6a5d49', halo: 'rgba(255,252,244,0.9)', us: '#3d2f22', modern: '#2c4a6b' },
  dark: { ocean: '#1f2b33', land: '#3b372f', line: '#1d1a16', text: '#221d16', textUnder: '#4f4636', halo: 'rgba(250,244,230,0.85)', us: '#f3e9d6', modern: '#9cc3ef' },
};
const FONT = ['Noto Sans Regular'];
const FONT_IT = ['Noto Sans Italic'];
const NONE = ['==', ['get', 'id'], '__none'];
const EMPTY = { type: 'FeatureCollection', features: [] };

export class HistoryMap extends EventTarget {
  constructor(el) {
    super();
    this.el = el;
    this.active = 'A';
    this.snapshotYear = null;
    this.usDate = null;
    this.selK = null;
    this.ready = false;
  }

  init({ projection = 'globe', center = [10, 30], zoom = 1.4 } = {}) {
    const c = dark() ? COLORS.dark : COLORS.light;
    this.c = c;
    const glyphs = new URL('../fonts/{fontstack}/{range}.pbf', import.meta.url).href.replace(/%7B/g, '{').replace(/%7D/g, '}');
    this.map = new maplibregl.Map({
      container: this.el,
      style: {
        version: 8,
        projection: { type: projection },
        glyphs,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': c.ocean } }],
      },
      center, zoom, minZoom: 0, maxZoom: 12,
      attributionControl: false, dragRotate: false, pitchWithRotate: false, renderWorldCopies: true,
      fadeDuration: reduceMotion() ? 0 : 200,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.keyboard.disableRotation?.();
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    this.map.addControl(new maplibregl.AttributionControl({
      compact: true,
      customAttribution: 'Borders: <a href="https://github.com/aourednik/historical-basemaps" target="_blank" rel="noopener">historical-basemaps</a> (GPL-3.0), <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a>, <a href="https://github.com/Seshat-Global-History-Databank/cliopatria" target="_blank" rel="noopener">Cliopatria</a> (CC BY 4.0), <a href="https://publications.newberry.org/ahcb/" target="_blank" rel="noopener">Newberry AHCB</a>, <a href="https://icr.ethz.ch/data/cshapes/" target="_blank" rel="noopener">CShapes 2.0</a> (CC BY-NC-SA) · Events: <a href="https://www.wikidata.org/" target="_blank" rel="noopener">Wikidata</a>',
    }), 'bottom-left');
    return new Promise((resolve, reject) => {
      this.map.on('error', (e) => { if (!this.ready) reject(e.error || e); else console.warn(e.error || e); });
      this.map.on('load', () => { this._build(); this.ready = true; resolve(this); });
    });
  }

  _build() {
    const m = this.map, c = this.c;
    m.addSource('land', { type: 'geojson', data: EMPTY });
    m.addLayer({ id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': c.land } });
    // Two stacks (A and B) for the cross-fade. In each, the territories that are not states in the source
    // (peoples and cultures from the older sketch maps, property u = 1) lie below the states and are drawn
    // paler and with thinner outlines, so that states stand out and no sketch outline crosses a state.
    const STATE = ['all', ['>=', ['get', 'k'], 0], ['!=', ['get', 'u'], 1]];
    const UNDER = ['all', ['>=', ['get', 'k'], 0], ['==', ['get', 'u'], 1]];
    for (const id of ['A', 'B']) {
      m.addSource('t' + id, { type: 'geojson', data: EMPTY });
      m.addLayer({
        id: 'ufill' + id, type: 'fill', source: 't' + id, filter: UNDER,
        paint: { 'fill-color': ['get', 'c'], 'fill-opacity': 0, 'fill-opacity-transition': { duration: 0 } },
      });
      m.addLayer({
        id: 'uline' + id, type: 'line', source: 't' + id, filter: UNDER,
        paint: { 'line-color': c.line, 'line-opacity': 0, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.25, 5, 0.7],
                 'line-opacity-transition': { duration: 0 } },
      });
      m.addLayer({
        id: 'fill' + id, type: 'fill', source: 't' + id, filter: STATE,
        paint: { 'fill-color': ['get', 'c'], 'fill-opacity': 0, 'fill-opacity-transition': { duration: 0 } },
      });
      m.addLayer({
        id: 'line' + id, type: 'line', source: 't' + id, filter: STATE,
        paint: { 'line-color': c.line, 'line-opacity': 0, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.4, 5, 1.1],
                 'line-opacity-transition': { duration: 0 } },
      });
    }
    m.addSource('modern', { type: 'geojson', data: EMPTY });
    m.addLayer({ id: 'modern', type: 'line', source: 'modern', layout: { visibility: 'none' },
      paint: { 'line-color': c.modern, 'line-width': 1, 'line-dasharray': [3, 2], 'line-opacity': 0.8 } });

    // selected territory outline
    m.addLayer({ id: 'sel', type: 'line', source: 'tA', filter: ['==', ['get', 'k'], -99],
      paint: { 'line-color': dark() ? '#fff6e0' : '#1d1810', 'line-width': 2.6 } });

    // US states and colonies
    m.addSource('us', { type: 'geojson', data: EMPTY });
    m.addLayer({ id: 'us-fill', type: 'fill', source: 'us', filter: NONE, paint: { 'fill-color': '#000', 'fill-opacity': 0.001 } });
    m.addLayer({ id: 'us-line', type: 'line', source: 'us', filter: NONE,
      paint: { 'line-color': c.us, 'line-opacity': 0.75, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.6, 6, 1.4],
               'line-dasharray': [2, 1.5] } });
    m.addLayer({ id: 'us-sel', type: 'line', source: 'us', filter: NONE, paint: { 'line-color': c.us, 'line-width': 2.6 } });

    // colonial counties before 1783, filled by colony
    m.addSource('col', { type: 'geojson', data: EMPTY });
    m.addSource('col-lbl', { type: 'geojson', data: EMPTY });
    m.addLayer({ id: 'col-fill', type: 'fill', source: 'col', filter: NONE,
      paint: { 'fill-color': ['get', 'c'], 'fill-opacity': 0.75, 'fill-outline-color': 'rgba(60,50,40,0.25)' } });
    m.addLayer({ id: 'col-sel', type: 'line', source: 'col', filter: NONE, paint: { 'line-color': c.us, 'line-width': 2.2 } });

    // territory labels: bigger places first, smaller ones as you zoom in
    m.addSource('labels', { type: 'geojson', data: EMPTY });
    // Labels of peoples and cultures (italic, lighter) are added first, so the state labels above them win a
    // collision. Large state labels may move off their point when an event marker sits on it.
    const lbl = (id, minzoom, filter, size, { upper = false, under = false, move = false } = {}) => m.addLayer({
      id, type: 'symbol', source: 'labels', minzoom, filter,
      layout: {
        'text-field': ['get', 'n'], 'text-font': under ? FONT_IT : FONT, 'text-size': size, 'text-max-width': 8,
        'text-transform': upper ? 'uppercase' : 'none', 'text-letter-spacing': upper ? 0.08 : 0.02,
        'symbol-sort-key': ['-', 0, ['get', 'a']], 'text-padding': under ? 6 : 3,
        ...(move ? { 'text-variable-anchor': ['center', 'top', 'bottom', 'left', 'right'], 'text-radial-offset': 0.9, 'text-justify': 'center' } : {}),
      },
      paint: { 'text-color': under ? c.textUnder : c.text, 'text-halo-color': c.halo, 'text-halo-width': under ? 1.1 : 1.4, 'text-halo-blur': 0.3 },
    });
    const isU = ['==', ['get', 'u'], 1], notU = ['!=', ['get', 'u'], 1];
    const area = (lo, hi) => [...(lo != null ? [['>=', ['get', 'a'], lo]] : []), ...(hi != null ? [['<', ['get', 'a'], hi]] : [])];
    lbl('ulbl-1', 0, ['all', isU, ...area(2500000, null)], ['interpolate', ['linear'], ['zoom'], 1, 10, 4, 13.5], { under: true });
    lbl('ulbl-2', 2.6, ['all', isU, ...area(400000, 2500000)], ['interpolate', ['linear'], ['zoom'], 2, 10, 5, 12.5], { under: true });
    lbl('ulbl-3', 3.3, ['all', isU, ...area(40000, 400000)], 11, { under: true });
    lbl('ulbl-4', 4.8, ['all', isU, ...area(null, 40000)], 10.5, { under: true });
    lbl('lbl-4', 4.4, ['all', notU, ...area(null, 30000)], 11);
    lbl('lbl-3', 3.2, ['all', notU, ...area(30000, 250000)], 11.5);
    lbl('lbl-2', 1.5, ['all', notU, ...area(250000, 1500000)], ['interpolate', ['linear'], ['zoom'], 1.5, 10, 5, 14], { move: true });
    lbl('lbl-1', 0, ['all', notU, ...area(1500000, null)], ['interpolate', ['linear'], ['zoom'], 1, 10.5, 4, 15], { upper: true, move: true });
    // one label per state or territory, at its label point (a symbol layer on the polygons repeats the name on every part)
    m.addSource('us-lbl', { type: 'geojson', data: EMPTY });
    m.addLayer({ id: 'us-label', type: 'symbol', source: 'us-lbl', minzoom: 3.2, filter: NONE,
      layout: { 'text-field': ['get', 'n'], 'text-font': FONT_IT, 'text-size': 11.5, 'text-max-width': 7, 'text-padding': 2 },
      paint: { 'text-color': c.text, 'text-halo-color': c.halo, 'text-halo-width': 1.4 } });

    m.addLayer({ id: 'col-label', type: 'symbol', source: 'col-lbl', minzoom: 3,
      layout: { 'text-field': ['get', 'n'], 'text-font': FONT_IT, 'text-size': 12, 'text-max-width': 7 },
      paint: { 'text-color': c.text, 'text-halo-color': c.halo, 'text-halo-width': 1.6 } });

    // events
    m.addSource('ev', { type: 'geojson', data: EMPTY, cluster: true, clusterRadius: 34, clusterMaxZoom: 5 });
    m.addLayer({ id: 'ev-cluster', type: 'circle', source: 'ev', filter: ['has', 'point_count'],
      paint: { 'circle-color': dark() ? '#efe8da' : '#2a241c', 'circle-opacity': 0.88,
               'circle-radius': ['step', ['get', 'point_count'], 11, 10, 14, 40, 18],
               'circle-stroke-color': dark() ? '#2a241c' : '#fffdf8', 'circle-stroke-width': 1.5 } });
    m.addLayer({ id: 'ev-count', type: 'symbol', source: 'ev', filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': FONT, 'text-size': 11, 'text-allow-overlap': true },
      paint: { 'text-color': dark() ? '#2a241c' : '#fffdf8' } });
    m.addLayer({ id: 'ev-point', type: 'circle', source: 'ev', filter: ['!', ['has', 'point_count']],
      paint: { 'circle-color': ['get', 'c'], 'circle-radius': ['interpolate', ['linear'], ['get', 's'], 0, 4.5, 40, 7, 150, 9],
               'circle-opacity': ['case', ['==', ['get', 'near'], 1], 0.45, 0.95],
               'circle-stroke-color': '#fffdf8', 'circle-stroke-width': 1.5 } });
    m.addLayer({ id: 'ev-sel', type: 'circle', source: 'ev', filter: ['==', ['get', 'i'], '__none'],
      paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 13, 'circle-stroke-color': dark() ? '#fff' : '#1d1810', 'circle-stroke-width': 2.5 } });

    // interaction
    const pointer = (layers) => {
      for (const l of layers) {
        m.on('mouseenter', l, () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', l, () => { m.getCanvas().style.cursor = ''; });
      }
    };
    pointer(['ev-point', 'ev-cluster', 'fillA', 'fillB', 'ufillA', 'ufillB', 'us-fill', 'col-fill']);
    m.on('click', (e) => this._click(e));
  }

  _click(e) {
    const m = this.map;
    const pad = 6;
    const box = [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]];
    const ev = m.queryRenderedFeatures(box, { layers: ['ev-point'] });
    if (ev.length) {
      this.dispatchEvent(new CustomEvent('event', { detail: ev[0].properties.i }));
      return;
    }
    const cl = m.queryRenderedFeatures(box, { layers: ['ev-cluster'] });
    if (cl.length) {
      const src = m.getSource('ev');
      const id = cl[0].properties.cluster_id;
      Promise.resolve(src.getClusterExpansionZoom(id)).then((z) => {
        m.easeTo({ center: cl[0].geometry.coordinates, zoom: Math.min(z + 0.2, 8), duration: reduceMotion() ? 0 : 600 });
      }).catch(() => {});
      return;
    }
    const us = m.getLayoutProperty('us-fill', 'visibility') !== 'none'
      ? m.queryRenderedFeatures(e.point, { layers: ['us-fill'] }) : [];
    if (us.length && m.getZoom() >= 3) {
      this.dispatchEvent(new CustomEvent('usstate', { detail: us[0].properties }));
      return;
    }
    const col = m.queryRenderedFeatures(e.point, { layers: ['col-fill'] });
    if (col.length && m.getZoom() >= 2.5) {
      this.dispatchEvent(new CustomEvent('colony', { detail: col[0].properties.st }));
      return;
    }
    let t = m.queryRenderedFeatures(e.point, { layers: ['fill' + this.active] });
    if (!t.length) t = m.queryRenderedFeatures(e.point, { layers: ['ufill' + this.active] });
    if (t.length) {
      this.dispatchEvent(new CustomEvent('polity', { detail: t[0].properties.k }));
      return;
    }
    this.dispatchEvent(new CustomEvent('empty'));
  }

  setLand(fc) { this.map.getSource('land').setData(fc); }

  /** Show a border snapshot, cross-fading from the previous one. */
  setSnapshot(doc) {
    const m = this.map;
    const next = this.active === 'A' ? 'B' : 'A';
    const prev = this.active;
    const dur = reduceMotion() || this.snapshotYear == null ? 0 : 650;
    const op = dark() ? 0.9 : 1;   // states are opaque so that the paler sketch-map territories below never show through
    m.getSource('t' + next).setData(doc || EMPTY);
    for (const [id, o] of [[next, op], [prev, 0]]) {
      for (const [f, l, fo, lo] of [['fill', 'line', o, o ? 0.55 : 0], ['ufill', 'uline', o * 0.62, o ? 0.3 : 0]]) {
        m.setPaintProperty(f + id, 'fill-opacity-transition', { duration: dur });
        m.setPaintProperty(l + id, 'line-opacity-transition', { duration: dur });
        m.setPaintProperty(f + id, 'fill-opacity', fo);
        m.setPaintProperty(l + id, 'line-opacity', lo);
      }
    }
    // keep the new snapshot on top so clicks and the outline use it
    for (const l of ['ufill', 'uline', 'fill', 'line']) m.moveLayer(l + next, 'modern');
    this.active = next;
    this.snapshotYear = doc ? doc.year : null;
    const labels = { type: 'FeatureCollection', features: (doc?.polities || []).map((p, k) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: p.l }, properties: { n: p.ln || p.n, a: p.a, k, u: p.under ? 1 : 0 },
    })) };
    m.getSource('labels').setData(labels);
    this._sel();
  }

  selectPolity(k) { this.selK = k; this._sel(); }

  _sel() {
    const m = this.map;
    if (!m.getLayer('sel')) return;
    m.removeLayer('sel');
    m.addLayer({ id: 'sel', type: 'line', source: 't' + this.active,
      filter: ['==', ['get', 'k'], this.selK == null ? -99 : this.selK],
      paint: { 'line-color': dark() ? '#fff6e0' : '#1d1810', 'line-width': 2.6 } }, 'us-fill');
  }

  setUS(fc) {
    this.map.getSource('us').setData(fc || EMPTY);
    this.map.getSource('us-lbl').setData({ type: 'FeatureCollection', features: (fc?.features || []).filter((f) => f.properties.l).map((f) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: f.properties.l }, properties: { n: f.properties.n, s: f.properties.s, e: f.properties.e, id: f.properties.id },
    })) });
  }

  /** Fill US states and territories by status (1783 to 1912, when the interior was still being organized):
   *  states in the US colour, organized territories lighter, unorganized territory lightest. null: outlines only. */
  setUSFill(color, { seceded = [], csaColor = null } = {}) {
    const m = this.map;
    const key = color + '|' + seceded.join(',');
    if (this._usFill === key) return;
    this._usFill = key;
    if (!color) {
      m.setPaintProperty('us-fill', 'fill-color', '#000');
      m.setPaintProperty('us-fill', 'fill-opacity', 0.001);
      m.setPaintProperty('us-line', 'line-dasharray', [2, 1.5]);
      return;
    }
    const mix = (hex, t) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - t) + 255 * t).toString(16).padStart(2, '0')).join('');
    const byStatus = ['match', ['get', 't'], 'State', color, 'District of Columbia', color,
      'Territory', mix(color, 0.45), 'Unorganized Territory', mix(color, 0.68), '#000'];
    // 1861 to 1865: the states that had seceded take the colour of the Confederacy
    m.setPaintProperty('us-fill', 'fill-color', seceded.length && csaColor
      ? ['case', ['in', ['get', 'id'], ['literal', seceded]], csaColor, byStatus] : byStatus);
    m.setPaintProperty('us-fill', 'fill-opacity', ['match', ['get', 't'], 'Other', 0.001, dark() ? 0.9 : 1]);
    m.setPaintProperty('us-line', 'line-dasharray', [1, 0]);
  }

  /** Show US states/colonies valid on a date (yyyymmdd), or hide them (null). */
  setUSDate(d, selId = null) {
    const m = this.map;
    const f = d == null ? NONE : ['all', ['<=', ['get', 's'], d], ['>=', ['get', 'e'], d]];
    for (const l of ['us-fill', 'us-line', 'us-label']) m.setFilter(l, f);
    m.setFilter('us-sel', d == null || !selId ? NONE : ['all', f, ['==', ['get', 'id'], selId]]);
    this.usDate = d;
  }

  /** Colonial counties on a date (yyyymmdd), coloured by colony; null hides them. */
  setColonies(fc, d, labels, selSt = null) {
    if (fc && !this._colSet) { this.map.getSource('col').setData(fc); this._colSet = true; }
    const f = d == null ? NONE : ['all', ['<=', ['get', 's'], d], ['>=', ['get', 'e'], d]];
    this.map.setFilter('col-fill', f);
    this.map.setFilter('col-sel', d == null || !selSt ? NONE : ['all', f, ['==', ['get', 'st'], selSt]]);
    this.map.getSource('col-lbl').setData(labels || EMPTY);
  }

  setModern(fc, visible) {
    if (fc) this.map.getSource('modern').setData(fc);
    this.map.setLayoutProperty('modern', 'visibility', visible ? 'visible' : 'none');
  }

  setEvents(events, { near = new Set(), selected = null } = {}) {
    const fc = { type: 'FeatureCollection', features: [] };
    for (const e of events) {
      if (e.lo == null) continue;
      fc.features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [e.lo, e.la] },
        properties: { i: e.i, c: typeColor(e.t), s: e.s || 0, near: near.has(e.i) ? 1 : 0 } });
    }
    this.map.getSource('ev').setData(fc);
    this.selectEvent(selected);
  }

  selectEvent(id) {
    this.map.setFilter('ev-sel', ['==', ['get', 'i'], id || '__none']);
  }

  setProjection(type) { this.map.setProjection({ type }); }

  setPadding(p) { this.map.setPadding(p); }

  fitBBox(bb, maxZoom = 5.5) {
    if (!bb) return;
    let [w, s, e, n] = bb;
    if (e - w > 300) { // crosses the date line or spans the world
      this.map.easeTo({ center: [(w + e) / 2, (s + n) / 2], zoom: 1.6, duration: reduceMotion() ? 0 : 900 });
      return;
    }
    this.map.fitBounds([[w, s], [e, n]], { maxZoom, duration: reduceMotion() ? 0 : 900, padding: 40 });
  }

  flyTo(lon, lat, zoom = 5) {
    this.map.easeTo({ center: [lon, lat], zoom: Math.max(this.map.getZoom(), zoom), duration: reduceMotion() ? 0 : 900 });
  }
}

export { TYPES };
