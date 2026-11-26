// The map: MapLibre GL with only our own data (no tile servers). Globe and flat views, territories filled by
// ruling power, a cross-fade between border snapshots, US states and colonies, and event markers.
import { typeColor, TYPES } from './types.js';

const maplibregl = window.maplibregl;
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const dark = () => document.documentElement.dataset.theme === 'dark'
  || (document.documentElement.dataset.theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);

const COLORS = {
  light: { ocean: '#c6d5d8', land: '#ece5d4', line: '#5e5241', text: '#2a241c', halo: 'rgba(255,252,244,0.9)', us: '#3d2f22', modern: '#2c4a6b' },
  dark: { ocean: '#1f2b33', land: '#3b372f', line: '#1d1a16', text: '#221d16', halo: 'rgba(250,244,230,0.85)', us: '#f3e9d6', modern: '#9cc3ef' },
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
      customAttribution: 'Borders: <a href="https://github.com/aourednik/historical-basemaps" target="_blank" rel="noopener">historical-basemaps</a> (GPL-3.0), <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a>, <a href="https://publications.newberry.org/ahcb/" target="_blank" rel="noopener">Newberry AHCB</a> · Events: <a href="https://www.wikidata.org/" target="_blank" rel="noopener">Wikidata</a>',
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
    for (const id of ['A', 'B']) {
      m.addSource('t' + id, { type: 'geojson', data: EMPTY });
      m.addLayer({
        id: 'fill' + id, type: 'fill', source: 't' + id, filter: ['>=', ['get', 'k'], 0],
        paint: { 'fill-color': ['get', 'c'], 'fill-opacity': 0, 'fill-opacity-transition': { duration: 0 } },
      });
      m.addLayer({
        id: 'line' + id, type: 'line', source: 't' + id, filter: ['>=', ['get', 'k'], 0],
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

    // territory labels: bigger places first, smaller ones as you zoom in
    m.addSource('labels', { type: 'geojson', data: EMPTY });
    const lbl = (id, minzoom, filter, size, upper) => m.addLayer({
      id, type: 'symbol', source: 'labels', minzoom, filter,
      layout: {
        'text-field': ['get', 'n'], 'text-font': FONT, 'text-size': size, 'text-max-width': 8,
        'text-transform': upper ? 'uppercase' : 'none', 'text-letter-spacing': upper ? 0.08 : 0.02,
        'symbol-sort-key': ['-', 0, ['get', 'a']], 'text-padding': 3,
      },
      paint: { 'text-color': c.text, 'text-halo-color': c.halo, 'text-halo-width': 1.4, 'text-halo-blur': 0.3 },
    });
    lbl('lbl-1', 0, ['>=', ['get', 'a'], 1500000], ['interpolate', ['linear'], ['zoom'], 1, 10.5, 4, 15], true);
    lbl('lbl-2', 2.2, ['all', ['>=', ['get', 'a'], 250000], ['<', ['get', 'a'], 1500000]], ['interpolate', ['linear'], ['zoom'], 2, 10.5, 5, 14], false);
    lbl('lbl-3', 3.4, ['all', ['>=', ['get', 'a'], 30000], ['<', ['get', 'a'], 250000]], 11.5, false);
    lbl('lbl-4', 4.6, ['<', ['get', 'a'], 30000], 11, false);
    m.addLayer({ id: 'us-label', type: 'symbol', source: 'us', minzoom: 3.2, filter: NONE,
      layout: { 'text-field': ['get', 'n'], 'text-font': FONT_IT, 'text-size': 11.5, 'text-max-width': 7, 'text-padding': 2 },
      paint: { 'text-color': c.text, 'text-halo-color': c.halo, 'text-halo-width': 1.4 } });

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
    pointer(['ev-point', 'ev-cluster', 'fillA', 'fillB', 'us-fill']);
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
    const t = m.queryRenderedFeatures(e.point, { layers: ['fill' + this.active] });
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
    const op = dark() ? 0.8 : 0.92;
    m.getSource('t' + next).setData(doc || EMPTY);
    for (const [id, o] of [[next, op], [prev, 0]]) {
      m.setPaintProperty('fill' + id, 'fill-opacity-transition', { duration: dur });
      m.setPaintProperty('line' + id, 'line-opacity-transition', { duration: dur });
      m.setPaintProperty('fill' + id, 'fill-opacity', o);
      m.setPaintProperty('line' + id, 'line-opacity', o ? 0.55 : 0);
    }
    // keep the new snapshot on top so clicks and the outline use it
    m.moveLayer('fill' + next, 'modern');
    m.moveLayer('line' + next, 'modern');
    this.active = next;
    this.snapshotYear = doc ? doc.year : null;
    const labels = { type: 'FeatureCollection', features: (doc?.polities || []).map((p, k) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: p.l }, properties: { n: p.ln || p.n, a: p.a, k },
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

  setUS(fc) { this.map.getSource('us').setData(fc || EMPTY); }

  /** Show US states/colonies valid on a date (yyyymmdd), or hide them (null). */
  setUSDate(d, selId = null) {
    const m = this.map;
    const f = d == null ? NONE : ['all', ['<=', ['get', 's'], d], ['>=', ['get', 'e'], d]];
    for (const l of ['us-fill', 'us-line', 'us-label']) m.setFilter(l, f);
    m.setFilter('us-sel', d == null || !selId ? NONE : ['all', f, ['==', ['get', 'id'], selId]]);
    this.usDate = d;
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
