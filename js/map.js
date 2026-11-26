// The map: MapLibre GL with only our own data (no tile servers). Globe and flat views; territories filled by
// ruling power; empires drawn as one at world zoom and as their parts when zoomed in; peoples without a state
// as soft regional tints; a sea layer above the territories so that every coast is the same crisp line;
// a cross-fade between years; US states and colonies; occupation hatching; event markers.
import { typeColor, TYPES } from './types.js';
import { tones, hexToLch, lchToHex } from './groups.js';

const maplibregl = window.maplibregl;
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isDark = () => document.documentElement.dataset.theme === 'dark'
  || (document.documentElement.dataset.theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);

const COLORS = {
  light: { sea: '#cfdde0', seaLine: '#8fa9b0', lake: '#d6e2e4', land: '#efe9da', line: '#5d4f3c', inner: '#6b5c47',
    text: '#2b241a', textPart: '#3a3024', textUnder: '#7b705f', textSea: '#7d9aa3', halo: 'rgba(255,252,244,0.82)', haloUnder: 'rgba(250,246,236,0.7)',
    us: '#4a3a2a', modern: '#2c4a6b', sel: '#1d1810', marker: '#fffdf8', cluster: '#2f2820', clusterText: '#fffdf8' },
  dark: { sea: '#161d22', seaLine: '#3a4a52', lake: '#1a2228', land: '#2b2822', line: '#0f0d0a', inner: '#17140f',
    text: '#f1eadc', textPart: '#e4dccb', textUnder: '#a79d8b', textSea: '#55676f', halo: 'rgba(20,17,13,0.8)', haloUnder: 'rgba(20,17,13,0.6)',
    us: '#f3e9d6', modern: '#9cc3ef', sel: '#fff6e0', marker: '#1b1916', cluster: '#efe8da', clusterText: '#2a241c' },
};
const SERIF = ['Atlas Serif Regular'];        // small capitals in place of lower case: for powers
const SERIF_IT = ['Atlas Serif Italic'];
const SANS = ['Noto Sans Regular'];
const NONE = ['==', ['get', 'id'], '__none'];
const EMPTY = { type: 'FeatureCollection', features: [] };
export const SLOTS = 7;
export const Z_SPLIT = 3.2;    // above this zoom an empire is drawn as its parts
const Z_PEOPLES = 3.4;         // above this zoom peoples are drawn one by one instead of as regions

const SEAS = [
  ['Atlantic Ocean', -38, 30, 0], ['Atlantic Ocean', -18, -25, 0], ['Pacific Ocean', -150, 15, 0], ['Pacific Ocean', -125, -30, 0], ['Pacific Ocean', 165, 22, 0],
  ['Indian Ocean', 78, -22, 0], ['Arctic Ocean', 0, 82, 0], ['Southern Ocean', 60, -62, 0], ['Southern Ocean', -120, -62, 0],
  ['Mediterranean Sea', 18.5, 34.6, 2.6], ['Caribbean Sea', -75, 15, 2.6], ['Arabian Sea', 64, 15.5, 2.6], ['Bay of Bengal', 88.5, 14, 2.6],
  ['South China Sea', 114.5, 13, 2.6], ['Gulf of Mexico', -91, 25, 3], ['Black Sea', 34.5, 43.3, 3], ['North Sea', 3, 56.3, 3.2], ['Baltic Sea', 19.5, 57.3, 3.6],
  ['Caspian Sea', 50.7, 41.5, 3.4], ['Red Sea', 38.3, 20.3, 3.6], ['Persian Gulf', 51.7, 26.8, 4], ['Sea of Japan', 135, 40, 3.2], ['Bering Sea', -178, 58, 2.6],
  ['Hudson Bay', -86, 60, 2.8], ['Tasman Sea', 161, -38, 2.8], ['Coral Sea', 155, -17, 3], ['Norwegian Sea', 2, 67, 2.8], ['Gulf of Guinea', 2, 1.5, 3],
  ['Sea of Okhotsk', 149, 54, 2.8], ['East China Sea', 125, 29, 3.4], ['Labrador Sea', -54, 58, 3], ['Mozambique Channel', 41, -18, 3.4],
];

export class HistoryMap extends EventTarget {
  constructor(el) {
    super();
    this.el = el;
    this.active = 'A';
    this.snapshotYear = null;
    this.usDate = null;
    this.selK = null;
    this.selG = null;
    this.ready = false;
  }

  init({ projection = 'globe', center = [10, 30], zoom = 1.4 } = {}) {
    const c = isDark() ? COLORS.dark : COLORS.light;
    this.c = c;
    this.dark = isDark();
    const glyphs = new URL('../fonts/{fontstack}/{range}.pbf', import.meta.url).href.replace(/%7B/g, '{').replace(/%7D/g, '}');
    this.map = new maplibregl.Map({
      container: this.el,
      style: {
        version: 8,
        projection: { type: projection },
        glyphs,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': c.land } }],
      },
      center, zoom, minZoom: 0, maxZoom: 9,
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
    const zoomIn = (lo, hi, a, b) => ['interpolate', ['linear'], ['zoom'], lo, a, hi, b];
    // Two stacks (A and B) for the cross-fade. In each stack:
    //   ufill          peoples and cultures from the sketch maps: pale, no outline at world zoom
    //   uline          their hairlines, only when zoomed in
    //   line<s>/fill<s> for s in 0..SLOTS-1: the states. Groups that touch are in different slots, and each
    //                  slot draws its outlines first and its fills on top, so an outline shows only on the outer
    //                  side of the group: borders inside an empire disappear without any geometry being merged.
    //   inner          hairlines between the parts of an empire, fading in as you zoom in
    const STATE = ['all', ['>=', ['get', 'k'], 0], ['!=', ['get', 'u'], 1]];
    const UNDER = ['all', ['>=', ['get', 'k'], 0], ['==', ['get', 'u'], 1]];
    const fillColor = ['interpolate', ['linear'], ['zoom'], Z_SPLIT - 0.5, ['to-color', ['get', 'c']], Z_SPLIT + 0.3, ['to-color', ['get', 'c2']]];
    for (const id of ['A', 'B']) {
      m.addSource('t' + id, { type: 'geojson', data: EMPTY, tolerance: 0.2, buffer: 8 });
      m.addLayer({ id: 'ufill' + id, type: 'fill', source: 't' + id, filter: UNDER,
        paint: { 'fill-color': ['interpolate', ['linear'], ['zoom'], Z_PEOPLES - 0.5, ['to-color', ['get', 'c']], Z_PEOPLES + 0.3, ['to-color', ['get', 'c2']]],
          'fill-opacity': 0, 'fill-antialias': false, 'fill-opacity-transition': { duration: 0 } } });
      m.addLayer({ id: 'uline' + id, type: 'line', source: 't' + id, filter: UNDER, minzoom: Z_PEOPLES - 0.4,
        paint: { 'line-color': c.inner, 'line-opacity': 0, 'line-width': 0.5, 'line-dasharray': [3, 2], 'line-opacity-transition': { duration: 0 } } });
      for (let s = 0; s < SLOTS; s++) {
        const f = ['all', STATE, ['==', ['get', 's'], s]];
        m.addLayer({ id: `glow${s}${id}`, type: 'line', source: 't' + id, filter: f, layout: { 'line-join': 'round' },
          paint: { 'line-color': ['get', 'ce'], 'line-opacity': 0, 'line-blur': zoomIn(1, 6, 2.5, 5), 'line-width': zoomIn(1, 6, 4.5, 11), 'line-opacity-transition': { duration: 0 } } });
        m.addLayer({ id: `line${s}${id}`, type: 'line', source: 't' + id, filter: f, layout: { 'line-join': 'round' },
          paint: { 'line-color': ['get', 'ce'], 'line-opacity': 0, 'line-width': zoomIn(1, 6, 1.5, 2.8), 'line-opacity-transition': { duration: 0 } } });
        m.addLayer({ id: `fill${s}${id}`, type: 'fill', source: 't' + id, filter: f,
          paint: { 'fill-color': fillColor, 'fill-opacity': 0, 'fill-opacity-transition': { duration: 0 } } });
      }
      m.addLayer({ id: 'inner' + id, type: 'line', source: 't' + id, filter: ['all', STATE, ['==', ['get', 'in'], 1]], minzoom: Z_SPLIT - 0.6,
        layout: { 'line-join': 'round' },
        paint: { 'line-color': ['get', 'ce'], 'line-opacity': 0, 'line-width': zoomIn(Z_SPLIT, 7, 0.6, 1.3), 'line-opacity-transition': { duration: 0 } } });
    }

    // US states (filled 1783 to 1912) and colonial counties, below the sea
    m.addSource('us', { type: 'geojson', data: EMPTY });
    m.addLayer({ id: 'us-fill', type: 'fill', source: 'us', filter: NONE, paint: { 'fill-color': '#000', 'fill-opacity': 0.001, 'fill-antialias': false } });
    m.addSource('col', { type: 'geojson', data: EMPTY });
    m.addSource('col-lbl', { type: 'geojson', data: EMPTY });
    m.addLayer({ id: 'col-fill', type: 'fill', source: 'col', filter: NONE,
      paint: { 'fill-color': ['get', 'c'], 'fill-opacity': 0.85, 'fill-outline-color': this.dark ? 'rgba(0,0,0,0.3)' : 'rgba(60,50,40,0.22)' } });

    // occupied territories: hatched in the occupier's colour
    m.addSource('occ', { type: 'geojson', data: EMPTY });
    m.addLayer({ id: 'occ', type: 'fill', source: 'occ', paint: { 'fill-pattern': ['get', 'pat'], 'fill-opacity': 0.9 } });
    m.addLayer({ id: 'occ-line', type: 'line', source: 'occ', paint: { 'line-color': ['get', 'ce'], 'line-width': 1.1, 'line-dasharray': [2, 1.5], 'line-opacity': 0.8 } });

    // the sea, above everything that is filled: one coastline for all sources
    m.addSource('sea', { type: 'geojson', data: EMPTY, tolerance: 0.02 });   // nearly unsimplified: the cells the sea is stored in must meet without gaps
    m.addLayer({ id: 'sea', type: 'fill', source: 'sea', paint: { 'fill-color': c.sea, 'fill-antialias': false } });
    m.addSource('coast', { type: 'geojson', data: EMPTY, tolerance: 0.15 });
    m.addLayer({ id: 'coast-glow', type: 'line', source: 'coast', layout: { 'line-join': 'round' },
      paint: { 'line-color': c.seaLine, 'line-width': zoomIn(1, 6, 3, 9), 'line-blur': zoomIn(1, 6, 2.5, 7), 'line-opacity': this.dark ? 0.35 : 0.45 } });
    m.addLayer({ id: 'coast', type: 'line', source: 'coast', layout: { 'line-join': 'round' },
      paint: { 'line-color': this.dark ? '#4b5d66' : '#6f8790', 'line-width': zoomIn(1, 6, 0.5, 1.1), 'line-opacity': 0.9 } });
    m.addSource('lakes', { type: 'geojson', data: EMPTY });
    m.addLayer({ id: 'lakes', type: 'fill', source: 'lakes', paint: { 'fill-color': c.lake, 'fill-outline-color': this.dark ? '#4b5d66' : '#7f979f' } });

    m.addSource('modern', { type: 'geojson', data: EMPTY });
    m.addLayer({ id: 'modern', type: 'line', source: 'modern', layout: { visibility: 'none' },
      paint: { 'line-color': c.modern, 'line-width': 1, 'line-dasharray': [3, 2], 'line-opacity': 0.8 } });

    // selected territory (or every member of the selected empire)
    m.addLayer({ id: 'sel', type: 'line', source: 'tA', filter: ['==', ['get', 'k'], -99], layout: { 'line-join': 'round' },
      paint: { 'line-color': c.sel, 'line-width': 2.4 } });

    m.addLayer({ id: 'us-line', type: 'line', source: 'us', filter: NONE,
      paint: { 'line-color': c.us, 'line-opacity': 0.6, 'line-width': zoomIn(2, 6, 0.5, 1.2), 'line-dasharray': [2, 1.5] } });
    m.addLayer({ id: 'us-sel', type: 'line', source: 'us', filter: NONE, paint: { 'line-color': c.sel, 'line-width': 2.4 } });
    m.addLayer({ id: 'col-sel', type: 'line', source: 'col', filter: NONE, paint: { 'line-color': c.sel, 'line-width': 2.2 } });

    // ---- labels. Added from least to most important: MapLibre places the upper layers first.
    m.addSource('seas', { type: 'geojson', data: { type: 'FeatureCollection', features: SEAS.map(([n, x, y, z]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [x, y] }, properties: { n, z } })) } });
    m.addLayer({ id: 'sea-lbl', type: 'symbol', source: 'seas', filter: ['<=', ['get', 'z'], ['zoom']],
      layout: { 'text-field': ['get', 'n'], 'text-font': SERIF_IT, 'text-size': ['interpolate', ['linear'], ['zoom'], 1, ['case', ['==', ['get', 'z'], 0], 12, 10], 6, ['case', ['==', ['get', 'z'], 0], 18, 13.5]],
        'text-letter-spacing': ['case', ['==', ['get', 'z'], 0], 0.3, 0.12], 'text-max-width': 6, 'text-padding': 6 },
      paint: { 'text-color': c.textSea, 'text-opacity': 0.9 } });

    m.addSource('labels', { type: 'geojson', data: EMPTY });
    m.addSource('label-lines', { type: 'geojson', data: EMPTY, tolerance: 0, maxzoom: 0 });   // one tile: a line is never cut, so its name is placed once
    const kind = (k) => ['==', ['get', 't'], k];
    const sym = (id, filter, layout, paint, extra = {}) => m.addLayer({ id, type: 'symbol', source: extra.source || 'labels', filter, ...(extra.minzoom != null ? { minzoom: extra.minzoom } : {}), ...(extra.maxzoom != null ? { maxzoom: extra.maxzoom } : {}),
      layout: { 'text-field': ['get', 'n'], 'text-max-width': 7.5, 'symbol-sort-key': ['-', 0, ['get', 'a']], ...layout },
      paint: { 'text-halo-blur': 0.6, ...paint } });
    const under = { 'text-color': c.textUnder, 'text-halo-color': c.haloUnder, 'text-halo-width': 1 };
    // peoples: one by one when zoomed in ...
    sym('lbl-people-s', ['all', kind('u'), ['<', ['get', 'a'], 150000]], { 'text-font': SERIF_IT, 'text-size': 11, 'text-padding': 5 }, under, { minzoom: 4.6 });
    sym('lbl-people', ['all', kind('u'), ['>=', ['get', 'a'], 150000]], { 'text-font': SERIF_IT, 'text-size': zoomIn(3, 6, 11, 13), 'text-padding': 5 }, under, { minzoom: Z_PEOPLES });
    // ... and one name per region at world zoom
    sym('lbl-region', kind('r'), { 'text-font': SERIF_IT, 'text-size': zoomIn(1, 3.4, 11, 13.5), 'text-letter-spacing': 0.08, 'text-padding': 8 }, under, { maxzoom: Z_PEOPLES });
    const st = { 'text-color': c.textPart, 'text-halo-color': c.halo, 'text-halo-width': 1.2 };
    const big = { 'text-color': c.text, 'text-halo-color': c.halo, 'text-halo-width': 1.4 };
    const AREA = { s: 30000, m: 250000, l: 1300000 };
    const ar = (lo, hi) => [...(lo != null ? [['>=', ['get', 'a'], lo]] : []), ...(hi != null ? [['<', ['get', 'a'], hi]] : [])];
    const stOrPart = ['any', kind('s'), kind('p')];
    // minor states and the parts of empires: upright, smaller
    sym('lbl-xs', ['all', stOrPart, ...ar(null, AREA.s)], { 'text-font': SANS, 'text-size': 10.5, 'text-padding': 2 }, st, { minzoom: 4.4 });
    sym('lbl-s', ['all', stOrPart, ...ar(AREA.s, AREA.m)], { 'text-font': SANS, 'text-size': zoomIn(3, 6, 10.5, 12.5), 'text-padding': 2 }, st, { minzoom: 3.2 });
    sym('lbl-part', ['all', kind('p'), ...ar(AREA.m, null)], { 'text-font': SERIF, 'text-size': zoomIn(3, 6, 12, 15), 'text-letter-spacing': 0.04, 'text-padding': 3,
      'text-variable-anchor': ['center', 'top', 'bottom'], 'text-radial-offset': 0.8 }, st, { minzoom: Z_SPLIT });
    sym('lbl-m', ['all', kind('s'), ...ar(AREA.m, AREA.l)], { 'text-font': SERIF, 'text-size': zoomIn(1.5, 5, 10.5, 14.5), 'text-letter-spacing': 0.04, 'text-padding': 3,
      'text-variable-anchor': ['center', 'top', 'bottom', 'left', 'right'], 'text-radial-offset': 0.8, 'text-justify': 'center' }, st, { minzoom: 1.6 });
    // major powers and empires: serif small capitals, sized by area; along a line across the state when it fits
    const bigSize = ['interpolate', ['linear'], ['zoom'], 1, ['interpolate', ['linear'], ['get', 'a'], 1300000, 10.5, 12000000, 13.5], 5, ['interpolate', ['linear'], ['get', 'a'], 1300000, 14, 12000000, 19]];
    const fits = ['>=', ['zoom'], ['get', 'zf']];
    const bigPt = { 'text-font': SERIF, 'text-size': bigSize, 'text-letter-spacing': 0.12, 'text-padding': 3, 'text-max-width': 6.5, 'text-line-height': 1.05,
      'text-variable-anchor': ['center', 'top', 'bottom', 'left', 'right'], 'text-radial-offset': 0.9, 'text-justify': 'center' };
    const bigLine = { 'text-font': SERIF, 'text-size': bigSize, 'symbol-placement': 'line-center', 'text-max-angle': 28, 'text-padding': 2, 'text-max-width': 100,
      'text-letter-spacing': ['interpolate', ['linear'], ['zoom'], 1, ['get', 's1'], 2, ['get', 's2'], 3, ['get', 's3'], 4, ['get', 's4'], 5, ['get', 's5'], 6, ['get', 's6'], 7, ['get', 's7'], 8, ['get', 's8']] };
    // the point label stays as a fallback: where the spaced name along the line is blocked (an event marker on
    // its path) the compact name is placed instead; where the line name is placed, the point name collides with it
    const bigFixed = { ...bigPt }; delete bigFixed['text-variable-anchor']; delete bigFixed['text-radial-offset'];
    const hasLine = ['<', ['get', 'zf'], 90];
    sym('lbl-l', ['all', kind('s'), ...ar(AREA.l, null), ['!', hasLine]], bigPt, big);
    sym('lbl-l-fb', ['all', kind('s'), ...ar(AREA.l, null), hasLine], bigFixed, big);
    sym('lbl-l-line', ['all', kind('s'), fits], bigLine, big, { source: 'label-lines' });
    sym('lbl-emp', ['all', kind('e'), ['!', hasLine]], bigPt, big, { maxzoom: Z_SPLIT });
    sym('lbl-emp-fb', ['all', kind('e'), hasLine], bigFixed, big, { maxzoom: Z_SPLIT });
    sym('lbl-emp-line', ['all', kind('e'), fits], bigLine, big, { source: 'label-lines', maxzoom: Z_SPLIT });

    m.addSource('us-lbl', { type: 'geojson', data: EMPTY });
    m.addLayer({ id: 'us-label', type: 'symbol', source: 'us-lbl', minzoom: 3.4, filter: NONE,
      layout: { 'text-field': ['get', 'n'], 'text-font': SERIF_IT, 'text-size': 11.5, 'text-max-width': 7, 'text-padding': 2 },
      paint: { 'text-color': c.textPart, 'text-halo-color': c.halo, 'text-halo-width': 1.2 } });
    m.addLayer({ id: 'col-label', type: 'symbol', source: 'col-lbl', minzoom: 3,
      layout: { 'text-field': ['get', 'n'], 'text-font': SERIF_IT, 'text-size': 12, 'text-max-width': 7 },
      paint: { 'text-color': c.textPart, 'text-halo-color': c.halo, 'text-halo-width': 1.4 } });

    // events
    m.addSource('ev', { type: 'geojson', data: EMPTY, cluster: true, clusterRadius: 34, clusterMaxZoom: 5 });
    m.addLayer({ id: 'ev-shadow', type: 'circle', source: 'ev',
      paint: { 'circle-color': '#000', 'circle-opacity': this.dark ? 0.35 : 0.16, 'circle-blur': 0.9, 'circle-translate': [0, 1.5],
        'circle-radius': ['case', ['has', 'point_count'], ['step', ['get', 'point_count'], 13, 10, 16, 40, 20], ['interpolate', ['linear'], ['get', 's'], 0, 7, 40, 9.5, 150, 11.5]] } });
    m.addLayer({ id: 'ev-cluster', type: 'circle', source: 'ev', filter: ['has', 'point_count'],
      paint: { 'circle-color': c.cluster, 'circle-opacity': 0.92,
        'circle-radius': ['step', ['get', 'point_count'], 10, 10, 13, 40, 17],
        'circle-stroke-color': c.marker, 'circle-stroke-width': 1.5 } });
    m.addLayer({ id: 'ev-count', type: 'symbol', source: 'ev', filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': SANS, 'text-size': 11, 'text-allow-overlap': true, 'text-padding': 7 },
      paint: { 'text-color': c.clusterText } });
    m.addLayer({ id: 'ev-point', type: 'circle', source: 'ev', filter: ['!', ['has', 'point_count']],
      paint: { 'circle-color': ['get', 'c'], 'circle-radius': ['interpolate', ['linear'], ['get', 's'], 0, 4, 40, 6, 150, 8],
        'circle-opacity': ['case', ['==', ['get', 'near'], 1], 0.45, 1],
        'circle-stroke-color': c.marker, 'circle-stroke-width': 1.6 } });
    // an invisible letter on every single marker: territory labels move away from markers instead of hiding them
    m.addLayer({ id: 'ev-pad', type: 'symbol', source: 'ev', filter: ['!', ['has', 'point_count']],
      layout: { 'text-field': 'O', 'text-font': SANS, 'text-size': 13, 'text-allow-overlap': true, 'text-padding': 3 }, paint: { 'text-opacity': 0 } });
    m.addLayer({ id: 'ev-sel', type: 'circle', source: 'ev', filter: ['==', ['get', 'i'], '__none'],
      paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 13, 'circle-stroke-color': c.sel, 'circle-stroke-width': 2.5 } });

    // interaction
    const hover = ['ev-point', 'ev-cluster', 'us-fill', 'col-fill', 'ufillA', 'ufillB'];
    for (const id of ['A', 'B']) for (let s = 0; s < SLOTS; s++) hover.push(`fill${s}${id}`);
    m.on('mousemove', (e) => {
      const hit = m.queryRenderedFeatures(e.point, { layers: hover.filter((l) => m.getLayer(l)) }).length > 0;
      m.getCanvas().style.cursor = hit ? 'pointer' : '';
    });
    m.on('click', (e) => this._click(e));
  }

  /** setData that never overlaps another setData on the same source: when a second update arrives while the
   *  first is still being tiled, MapLibre can keep the older one. The latest data waits its turn instead. */
  _setData(id, data) {
    const st = ((this._sd ||= {})[id] ||= { busy: false, next: null });
    if (st.busy) { st.next = data; return; }
    st.busy = true;
    const finish = () => {
      if (!st.busy) return;
      clearTimeout(timer);
      st.busy = false;
      if (st.next) { const d = st.next; st.next = null; this._setData(id, d); }
    };
    const timer = setTimeout(finish, 6000);
    // the next update may follow once the worker has taken this one and its tiles are in
    const poll = () => { if (!st.busy) return; if (this.map.isSourceLoaded(id)) finish(); else setTimeout(poll, 80); };
    Promise.resolve(this.map.getSource(id).setData(data, true)).catch(() => {}).then(() => setTimeout(poll, 80));
  }

  _stateLayers(id) { return Array.from({ length: SLOTS }, (_, s) => `fill${s}${id}`); }

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
    // open sea (a lake counts as land: the territory around it is meant)
    if (m.queryRenderedFeatures(e.point, { layers: ['sea'] }).length) { this.dispatchEvent(new CustomEvent('empty')); return; }
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
    let t = m.queryRenderedFeatures(e.point, { layers: this._stateLayers(this.active) });
    if (!t.length) t = m.queryRenderedFeatures(e.point, { layers: ['ufill' + this.active] });
    if (t.length) {
      // at world zoom a click on any part of an empire means the empire
      this.dispatchEvent(new CustomEvent('polity', { detail: { k: t[0].properties.k, whole: m.getZoom() < Z_SPLIT } }));
      return;
    }
    this.dispatchEvent(new CustomEvent('empty'));
  }

  /** Seas, coastlines and lakes (decoded data/base/sea.json). */
  setSea({ sea, lakes }) {
    this.map.getSource('sea').setData({ type: 'Feature', geometry: sea, properties: {} });
    // coastlines: the rings of the sea without the edges of the 30-degree cells it is stored in
    const onGrid = (v) => Math.abs(v / 30 - Math.round(v / 30)) < 1e-9;
    const lines = [];
    for (const poly of sea.coordinates) for (const ring of poly) {
      let cur = [ring[0]];
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1], b = ring[i];
        const cellEdge = (a[0] === b[0] && onGrid(a[0])) || (a[1] === b[1] && onGrid(a[1])) || Math.abs(b[1]) >= 85;
        if (cellEdge) { if (cur.length > 1) lines.push(cur); cur = [b]; } else cur.push(b);
      }
      if (cur.length > 1) lines.push(cur);
    }
    this.map.getSource('coast').setData({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: lines }, properties: {} });
    this.map.getSource('lakes').setData({ type: 'Feature', geometry: lakes, properties: {} });
  }

  /** Show a border snapshot (prepared by prepareDoc in main.js), cross-fading from the previous one. */
  setSnapshot(doc, { fade = true } = {}) {
    const m = this.map;
    const next = this.active === 'A' ? 'B' : 'A';
    const prev = this.active;
    const dur = reduceMotion() || this.snapshotYear == null || !fade ? 0 : 650;
    this._setData('t' + next, doc || EMPTY);
    const set = (layer, prop, v, d) => { m.setPaintProperty(layer, prop + '-transition', { duration: d }); m.setPaintProperty(layer, prop, v); };
    clearTimeout(this._lineTimer);
    const lines = (id, on) => {
      for (let s = 0; s < SLOTS; s++) {
        set(`line${s}${id}`, 'line-opacity', on ? 0.85 : 0, 0);
        set(`glow${s}${id}`, 'line-opacity', on ? (this.dark ? 0.5 : 0.22) : 0, 0);
      }
      set('inner' + id, 'line-opacity', on ? ['interpolate', ['linear'], ['zoom'], Z_SPLIT - 0.5, 0, Z_SPLIT + 0.4, 0.55] : 0, 0);
      set('uline' + id, 'line-opacity', on ? ['interpolate', ['linear'], ['zoom'], Z_PEOPLES - 0.4, 0, Z_PEOPLES + 0.4, 0.45] : 0, 0);
    };
    for (const [id, o] of [[next, 1], [prev, 0]]) {
      for (let s = 0; s < SLOTS; s++) set(`fill${s}${id}`, 'fill-opacity', o, dur);
      set('ufill' + id, 'fill-opacity', o * (this.dark ? 0.85 : 0.9), dur);
    }
    // outlines lie under the fills, so they would show through both maps during the fade: the old ones go
    // at once and the new ones come when the fade is over
    lines(prev, false);
    if (dur) { lines(next, false); this._lineTimer = setTimeout(() => lines(next, true), dur); } else lines(next, true);
    // keep the new snapshot on top so clicks and the outline use it
    const order = ['ufill', 'uline'];
    for (let s = 0; s < SLOTS; s++) order.push('glow' + s, 'line' + s, 'fill' + s);
    order.push('inner');
    for (const l of order) m.moveLayer(l + next, 'us-fill');
    this.active = next;
    this.snapshotYear = doc ? doc.year : null;
    this._setData('labels', doc?.labels || EMPTY);
    this._setData('label-lines', doc?.labelLines || EMPTY);
    this._sel();
  }

  selectPolity(k) { this.selK = k; this.selG = null; this._sel(); }
  selectGroup(g) { this.selG = g; this.selK = null; this._sel(); }

  _sel() {
    const m = this.map;
    if (!m.getLayer('sel')) return;
    m.removeLayer('sel');
    m.addLayer({ id: 'sel', type: 'line', source: 't' + this.active, layout: { 'line-join': 'round' },
      filter: this.selG != null ? ['==', ['get', 'g'], this.selG] : ['==', ['get', 'k'], this.selK == null ? -99 : this.selK],
      paint: { 'line-color': this.c.sel, 'line-width': this.selG != null ? 1.6 : 2.4 } }, 'us-line');
  }

  /** Occupied territories: features with {by, c (occupier colour)}; drawn hatched. */
  setOccupied(features) {
    const m = this.map;
    for (const f of features) {
      const id = 'hatch-' + f.properties.c;
      if (!m.hasImage(id)) m.addImage(id, hatch(f.properties.c, this.dark), { pixelRatio: 2 });
      f.properties.pat = id;
      f.properties.ce = lchToHex([this.dark ? 0.8 : 0.3, 0.05, hexToLch(f.properties.c)[2]]);
    }
    this._setData('occ', { type: 'FeatureCollection', features });
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
    const base = tones(color, 'usa', this.dark).fill;
    const [L, C, H] = hexToLch(base);
    const mix = (t) => lchToHex(this.dark ? [L - t * 0.1, C * (1 - t * 0.6), H] : [L + (0.93 - L) * t, C * (1 - t * 0.6), H]);
    const byStatus = ['match', ['get', 't'], 'State', base, 'District of Columbia', base,
      'Territory', mix(0.5), 'Unorganized Territory', mix(0.85), '#000'];
    // 1861 to 1865: the states that had seceded take the colour of the Confederacy
    m.setPaintProperty('us-fill', 'fill-color', seceded.length && csaColor
      ? ['case', ['in', ['get', 'id'], ['literal', seceded]], tones(csaColor, 'csa', this.dark).fill, byStatus] : byStatus);
    m.setPaintProperty('us-fill', 'fill-opacity', ['match', ['get', 't'], 'Other', 0.001, 1]);
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
    this._setData('ev', fc);
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

/** A diagonal hatch tile in one colour (for occupied territories). */
function hatch(hex, dark) {
  const n = 16;
  const cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const g = cv.getContext('2d');
  const [, , H] = hexToLch(hex);
  g.strokeStyle = lchToHex(dark ? [0.82, 0.07, H] : [0.36, 0.09, H]);
  g.globalAlpha = dark ? 0.75 : 0.8;
  g.lineWidth = 2.4;
  g.lineCap = 'square';
  for (const o of [-n, 0, n]) { g.beginPath(); g.moveTo(o, n); g.lineTo(o + n, 0); g.stroke(); }
  const d = g.getImageData(0, 0, n, n);
  return { width: n, height: n, data: new Uint8Array(d.data.buffer) };
}

export { TYPES };
