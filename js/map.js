// The map: MapLibre GL with only our own data (no tile servers). Globe and flat views; territories filled by
// ruling power; empires drawn as one at world zoom and as their parts when zoomed in; peoples without a state
// as soft regional tints; a sea layer above the territories so that every coast is the same crisp line;
// year changes that animate only the land that changed hands (no whole-map cross-fade: borders snap, each
// changed piece settles in calmly, sweeping out from its new owner); flag fill (js/flagfill.js); US states and colonies; occupation hatching; war markers; event markers.
import { typeColor, TYPES } from './types.js';
import { tones, hexToLch, lchToHex } from './groups.js';
import { makeAreaTest } from './geo.js';
import { loadFills, fillsReady, fillsOf, ensureImages, extentFor, extentOk, paint, flagTile, setCanvasCap, canvasCap } from './flagfill.js';

const maplibregl = window.maplibregl;
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isDark = () => document.documentElement.dataset.theme === 'dark'
  || (document.documentElement.dataset.theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);

const COLORS = {
  light: { sea: '#c4dbe6', seaLine: '#86a8b8', lake: '#cfe2ea', land: '#ece6d8', line: '#5d4f3c', inner: '#3a3226',
    text: '#2b241a', textPart: '#3a3024', textUnder: '#7b705f', textSea: '#7d9aa3', halo: 'rgba(255,252,244,0.82)', haloUnder: 'rgba(250,246,236,0.7)',
    us: '#4a3a2a', modern: '#2c4a6b', sel: '#1d1810', marker: '#fffdf8', cluster: '#2f2820', clusterText: '#fffdf8' },
  dark: { sea: '#121a21', seaLine: '#3a4a52', lake: '#16202a', land: '#2b2822', line: '#0f0d0a', inner: '#0c0a08',
    text: '#f1eadc', textPart: '#e4dccb', textUnder: '#a79d8b', textSea: '#55676f', halo: 'rgba(20,17,13,0.8)', haloUnder: 'rgba(20,17,13,0.6)',
    us: '#f3e9d6', modern: '#9cc3ef', sel: '#fff6e0', marker: '#1b1916', cluster: '#efe8da', clusterText: '#2a241c' },
};
// map labels: Source Sans 3 (tools/make_glyphs.cjs), one weight per role
const POWER = ['Atlas Sans Semibold'];      // empires and major powers, in capitals
const STATE_F = ['Atlas Sans Medium'];      // ordinary states and the parts of empires
const ITALIC = ['Atlas Sans Italic'];       // peoples, sketch regions, US states and colonies
const SEA_F = ['Atlas Sans Light Italic'];  // oceans and seas
const SANS = ['Noto Sans Regular'];
const NONE = ['==', ['get', 'id'], '__none'];
const EMPTY = { type: 'FeatureCollection', features: [] };
export const SLOTS = 7;
const STACKS = ['A', 'B', 'C'];   // one shown, one leaving (only its changed land, on top), one being loaded with the next map
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
    // Three stacks (A, B, C) for the transitions between years: the shown map, the one fading out and the next
    // one being loaded. In each stack:
    //   ufill          peoples and cultures from the sketch maps: pale, no outline at world zoom
    //   uline          their hairlines, only when zoomed in
    //   line<s>/fill<s> for s in 0..SLOTS-1: the states. Groups that touch are in different slots, and each
    //                  slot draws its outlines first and its fills on top, so an outline shows only on the outer
    //                  side of the group: borders inside an empire disappear without any geometry being merged.
    //   inner          hairlines between the parts of an empire, fading in as you zoom in
    const STATE = ['all', ['>=', ['get', 'k'], 0], ['!=', ['get', 'u'], 1]];
    const UNDER = ['all', ['>=', ['get', 'k'], 0], ['==', ['get', 'u'], 1]];
    const fillColor = ['interpolate', ['linear'], ['zoom'], Z_SPLIT - 0.5, ['to-color', ['get', 'c']], Z_SPLIT + 0.3, ['to-color', ['get', 'c2']]];
    for (const id of STACKS) {
      m.addSource('t' + id, { type: 'geojson', data: EMPTY, tolerance: 0.2, buffer: 8 });
      m.addLayer({ id: 'ufill' + id, type: 'fill', source: 't' + id, filter: UNDER,
        paint: { 'fill-color': ['interpolate', ['linear'], ['zoom'], Z_PEOPLES - 0.5, ['to-color', ['get', 'c']], Z_PEOPLES + 0.3, ['to-color', ['get', 'c2']]],
          'fill-opacity': 0, 'fill-antialias': false, 'fill-opacity-transition': { duration: 0 } } });
      m.addLayer({ id: 'uline' + id, type: 'line', source: 't' + id, filter: UNDER, minzoom: Z_PEOPLES - 0.4,
        paint: { 'line-color': c.inner, 'line-opacity': 0, 'line-width': 0.5, 'line-dasharray': [3, 2], 'line-opacity-transition': { duration: 0 } } });
      for (let s = 0; s < SLOTS; s++) {
        const f = ['all', STATE, ['==', ['get', 's'], s]];
        // a flat rim just outside the border (half of it is under the group's own fill), then the border line
        m.addLayer({ id: `glow${s}${id}`, type: 'line', source: 't' + id, filter: f, layout: { 'line-join': 'round' },
          paint: { 'line-color': ['get', 'ce'], 'line-opacity': 0, 'line-width': zoomIn(1, 6, 3.6, 7), 'line-opacity-transition': { duration: 0 } } });
        m.addLayer({ id: `line${s}${id}`, type: 'line', source: 't' + id, filter: f, layout: { 'line-join': 'round' },
          paint: { 'line-color': ['get', 'ce'], 'line-opacity': 0, 'line-width': zoomIn(1, 6, 1.7, 3), 'line-opacity-transition': { duration: 0 } } });
        m.addLayer({ id: `fill${s}${id}`, type: 'fill', source: 't' + id, filter: f,
          paint: { 'fill-color': fillColor, 'fill-opacity': 0, 'fill-opacity-transition': { duration: 0 } } });
      }
      m.addLayer({ id: 'inner' + id, type: 'line', source: 't' + id, filter: ['all', STATE, ['==', ['get', 'in'], 1]], minzoom: Z_SPLIT - 0.6,
        layout: { 'line-join': 'round' },
        paint: { 'line-color': ['get', 'ce'], 'line-opacity': 0, 'line-width': zoomIn(Z_SPLIT, 7, 0.6, 1.3), 'line-opacity-transition': { duration: 0 } } });
    }

    // flag fill: one canvas per stack (js/flagfill.js), drawn over the plain fills, with dark borders on top
    // (two neighbours under the same flag stay apart); a fourth canvas holds the leaving land during a change
    this._fc = {};
    // how the flags reach the map: 'canvas' (above), or 'pattern', the fallback where a canvas source fails (some
    // phones): each state tiled with its flag by MapLibre's fill-pattern, which every WebGL device draws.
    // ?fill=pattern starts with the fallback; ?fill=fail makes the canvas check fail (for tests).
    const q = new URLSearchParams(location.search);
    this.fillImpl = q.get('fill') === 'pattern' ? 'pattern' : 'canvas';
    this.fillWhy = this.fillImpl === 'pattern' ? 'asked for in the address' : '';
    this._forceFail = q.get('fill') === 'fail';
    try {
      const gl = m.painter.context.gl;
      this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      const ri = gl.getExtension('WEBGL_debug_renderer_info');
      this.renderer = (ri && gl.getParameter(ri.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER);
    } catch { this.maxTex = 4096; }
    setCanvasCap(this.maxTex);
    const mkCanvas = (sid) => {
      const cv = document.createElement('canvas');
      cv.width = 16; cv.height = 16;
      m.addSource('fsrc' + sid, { type: 'canvas', canvas: cv, animate: false, coordinates: [[-180, 85], [180, 85], [180, -85], [-180, -85]] });
      m.addLayer({ id: 'flag' + sid, type: 'raster', source: 'fsrc' + sid,
        paint: { 'raster-opacity': 0, 'raster-resampling': 'linear', 'raster-fade-duration': 0, 'raster-opacity-transition': { duration: 0 },
          'raster-brightness-max': this.dark ? 0.8 : 1, 'raster-saturation': this.dark ? -0.15 : 0 } });   // evening reading: flags dimmed in dark mode
      if (sid !== 'X') {
        m.addLayer({ id: 'fpat' + sid, type: 'fill', source: 't' + sid, filter: NONE,
          paint: { 'fill-pattern': 'pf-none', 'fill-opacity': 0, 'fill-antialias': false, 'fill-opacity-transition': { duration: 0 } } });
      }
      this._fc[sid] = { cv, ext: null, key: null };
    };
    m.addImage('pf-none', new ImageData(2, 2), { pixelRatio: 2 });
    for (const id of STACKS) mkCanvas(id);
    for (const id of STACKS) {
      m.addLayer({ id: 'fline' + id, type: 'line', source: 't' + id, filter: STATE, layout: { 'line-join': 'round' },
        paint: { 'line-color': this.dark ? '#0b0906' : '#2a2219', 'line-opacity': 0, 'line-width': zoomIn(1, 6, 0.9, 1.8), 'line-opacity-transition': { duration: 0 } } });
    }

    // land of the map being left that has not changed hands yet, over the new map during a change (show())
    m.addSource('leave', { type: 'geojson', data: EMPTY, tolerance: 0.2, buffer: 8 });
    // per-feature opacity 'o' (1 until its moment, then easing to 0), stepped by show()
    const gone = ['coalesce', ['feature-state', 'o'], 1];
    m.addLayer({ id: 'leave-line', type: 'line', source: 'leave', filter: ['!=', ['get', 'u'], 1], layout: { 'line-join': 'round' },
      paint: { 'line-color': ['get', 'ce'], 'line-opacity': gone, 'line-width': zoomIn(1, 6, 1.7, 3) } });
    m.addLayer({ id: 'leave-fill', type: 'fill', source: 'leave',
      paint: { 'fill-color': fillColor, 'fill-opacity': ['*', gone, ['case', ['==', ['get', 'u'], 1], this.dark ? 0.85 : 0.9, 1]] } });

    // US states (filled 1783 to 1912) and colonial counties, below the sea. us-old and us-vis draw the fills (the
    // previous date fades out under the new one); us-fill is the invisible layer that clicks are tested against.
    m.addSource('us', { type: 'geojson', data: EMPTY });
    for (const id of ['us-old', 'us-vis']) m.addLayer({ id, type: 'fill', source: 'us', filter: NONE, paint: { 'fill-color': '#000', 'fill-opacity': 0, 'fill-antialias': false, 'fill-opacity-transition': { duration: 0 } } });
    m.addLayer({ id: 'us-fill', type: 'fill', source: 'us', filter: NONE, paint: { 'fill-color': '#000', 'fill-opacity': 0.001, 'fill-antialias': false } });
    m.addSource('col', { type: 'geojson', data: EMPTY });
    m.addSource('col-lbl', { type: 'geojson', data: EMPTY });
    m.addLayer({ id: 'col-fill', type: 'fill', source: 'col', filter: NONE,
      paint: { 'fill-color': ['get', 'c'], 'fill-opacity': 0.85, 'fill-outline-color': this.dark ? 'rgba(0,0,0,0.3)' : 'rgba(60,50,40,0.22)' } });

    // the leaving land in flag fill (its old flags), over the new map during a change
    mkCanvas('X');
    // land that has just changed hands (show()): drawn a little lighter in its new colour (or over its new
    // flag), settling to the final look, with a thin outline in the new owner's colour that eases in and out.
    // Per-feature values stepped by show(); no white, no blinking.
    m.addSource('fx', { type: 'geojson', data: EMPTY });
    const fv = (k) => ['coalesce', ['feature-state', k], 0];
    m.addLayer({ id: 'fx-cover', type: 'fill', source: 'fx', paint: { 'fill-color': ['get', 'oc'], 'fill-opacity': fv('c'), 'fill-antialias': false } });
    m.addLayer({ id: 'fx-tint', type: 'fill', source: 'fx', paint: { 'fill-color': ['get', 'lc'], 'fill-opacity': fv('a'), 'fill-antialias': false } });
    m.addLayer({ id: 'fx-edge', type: 'line', source: 'fx', layout: { 'line-join': 'round' },
      paint: { 'line-color': ['get', 'ce'], 'line-width': zoomIn(1, 6, 1.4, 2.4), 'line-opacity': fv('e') } });
    m.addLayer({ id: 'us-flash', type: 'line', source: 'us', filter: NONE, layout: { 'line-join': 'round' },
      paint: { 'line-color': c.us, 'line-width': 2, 'line-opacity': 0, 'line-opacity-transition': { duration: 0 } } });

    // war: the land where this year's shown battles were fought, edged in red (a slow pulse at rest)
    this._warCol = this.dark ? '#ff6b57' : '#d9261c';
    m.addLayer({ id: 'war-glow', type: 'line', source: 'tA', filter: NONE, layout: { 'line-join': 'round', visibility: 'none' },
      paint: { 'line-color': this._warCol, 'line-width': zoomIn(1, 6, 4, 9), 'line-blur': zoomIn(1, 6, 2, 4), 'line-opacity': 0.45,
        'line-opacity-transition': { duration: 800 } } });
    m.addLayer({ id: 'war-edge', type: 'line', source: 'tA', filter: NONE, layout: { 'line-join': 'round', visibility: 'none' },
      paint: { 'line-color': this._warCol, 'line-width': zoomIn(1, 6, 1.6, 2.6), 'line-dasharray': [2, 1.2] } });

    // selected territory (or every member of the selected empire), under the sea layer
    m.addLayer({ id: 'sel', type: 'line', source: 'tA', filter: ['==', ['get', 'k'], -99], layout: { 'line-join': 'round' },
      paint: { 'line-color': c.sel, 'line-width': 2.8 } });

    // occupied territories: the own fill made faint by a wash of the land colour, then lines in the occupier's colour
    m.addSource('occ', { type: 'geojson', data: EMPTY });
    m.addLayer({ id: 'occ-wash', type: 'fill', source: 'occ', paint: { 'fill-color': c.land, 'fill-opacity': 0.6, 'fill-antialias': false } });
    m.addLayer({ id: 'occ', type: 'fill', source: 'occ', paint: { 'fill-pattern': ['get', 'pat'] } });
    m.addLayer({ id: 'occ-line', type: 'line', source: 'occ', filter: ['!=', ['get', 'a'], 1], paint: { 'line-color': ['get', 'ce'], 'line-width': 1.1, 'line-dasharray': [2, 1.5], 'line-opacity': 0.8 } });

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


    m.addLayer({ id: 'us-line', type: 'line', source: 'us', filter: NONE,
      paint: { 'line-color': c.us, 'line-opacity': 0.6, 'line-width': zoomIn(2, 6, 0.5, 1.2), 'line-dasharray': [2, 1.5] } });
    m.addLayer({ id: 'us-sel', type: 'line', source: 'us', filter: NONE, paint: { 'line-color': c.sel, 'line-width': 2.4 } });
    m.addLayer({ id: 'col-sel', type: 'line', source: 'col', filter: NONE, paint: { 'line-color': c.sel, 'line-width': 2.2 } });

    // ---- labels. Added from least to most important: MapLibre places the upper layers first.
    m.addSource('seas', { type: 'geojson', data: { type: 'FeatureCollection', features: SEAS.map(([n, x, y, z]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [x, y] }, properties: { n, z } })) } });
    m.addLayer({ id: 'sea-lbl', type: 'symbol', source: 'seas', filter: ['<=', ['get', 'z'], ['zoom']],
      layout: { 'text-field': ['get', 'n'], 'text-font': SEA_F, 'text-size': ['interpolate', ['linear'], ['zoom'], 1, ['case', ['==', ['get', 'z'], 0], 12.5, 10.5], 6, ['case', ['==', ['get', 'z'], 0], 18, 14]],
        'text-letter-spacing': ['case', ['==', ['get', 'z'], 0], 0.22, 0.08], 'text-max-width': 6, 'text-padding': 6 },
      paint: { 'text-color': c.textSea, 'text-opacity': 0.9 } });

    m.addSource('labels', { type: 'geojson', data: EMPTY });
    m.addSource('label-lines', { type: 'geojson', data: EMPTY, tolerance: 0, maxzoom: 0 });   // one tile: a line is never cut, so its name is placed once
    const kind = (k) => ['==', ['get', 't'], k];
    const sym = (id, filter, layout, paint, extra = {}) => m.addLayer({ id, type: 'symbol', source: extra.source || 'labels', filter, ...(extra.minzoom != null ? { minzoom: extra.minzoom } : {}), ...(extra.maxzoom != null ? { maxzoom: extra.maxzoom } : {}),
      layout: { 'text-field': ['get', 'n'], 'text-max-width': 7.5, 'symbol-sort-key': ['-', 0, ['get', 'a']], ...layout },
      paint: { 'text-halo-blur': 0.6, ...paint } });
    // flag badges (js/flags.js): beside the name, below it; placed after the names (lower in the stack), so a
    // badge never covers a name, and after the war markers' blocks, so it never sits under a marker. A badge
    // shows once its state covers about 50 by 50 pixels; at world zoom only the largest powers have one.
    m.addSource('badges', { type: 'geojson', data: EMPTY });
    const badge = (id, kinds, extra) => m.addLayer({ id, type: 'symbol', source: 'badges', filter: ['in', ['get', 'k'], ['literal', kinds]], ...extra,
      layout: { 'icon-image': ['get', 'id'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 1, 0.82, 4, 1, 7, 1.15],
        'icon-anchor': 'top', 'icon-offset': ['match', ['get', 'o'], 2, ['literal', [0, 30]], ['literal', [0, 21]]], 'icon-padding': 1, 'symbol-sort-key': ['-', 0, ['get', 'a']], visibility: 'visible' },
      paint: { 'icon-opacity': 1 } });
    badge('badge-lo', ['s', 'e'], { maxzoom: Z_SPLIT });
    badge('badge-hi', ['s', 'p'], { minzoom: Z_SPLIT });
    // which badges may show depends on the zoom (the state's size on screen, and at world zoom a cap on the
    // count): the source is given those when a zoom ends
    m.on('zoomend', () => this._badgeData());
    // war markers are HTML markers: an invisible symbol at each keeps badges off them
    m.addSource('warblk', { type: 'geojson', data: EMPTY });
    const blk = new ImageData(22, 22);
    m.addImage('blk', blk, { pixelRatio: 1 });
    m.addLayer({ id: 'warblk', type: 'symbol', source: 'warblk', layout: { 'icon-image': 'blk', 'icon-allow-overlap': true, 'icon-ignore-placement': false } });
    const under = { 'text-color': c.textUnder, 'text-halo-color': c.haloUnder, 'text-halo-width': 1 };
    // peoples: one by one when zoomed in ...
    sym('lbl-people-s', ['all', kind('u'), ['<', ['get', 'a'], 60000]], { 'text-font': ITALIC, 'text-size': 11, 'text-padding': 4 }, under, { minzoom: 3.8 });
    sym('lbl-people', ['all', kind('u'), ['>=', ['get', 'a'], 60000]], { 'text-font': ITALIC, 'text-size': zoomIn(3, 6, 11, 13), 'text-padding': 5 }, under, { minzoom: Z_PEOPLES });
    // ... and one name per region at world zoom
    sym('lbl-region', kind('r'), { 'text-font': ITALIC, 'text-size': zoomIn(1, 3.4, 11, 13.5), 'text-letter-spacing': 0.04, 'text-padding': 8 }, under, { maxzoom: Z_PEOPLES });
    const st = { 'text-color': c.textPart, 'text-halo-color': c.halo, 'text-halo-width': 1.2 };
    const big = { 'text-color': c.text, 'text-halo-color': c.halo, 'text-halo-width': 1.4 };
    const AREA = { s: 30000, m: 250000, l: 1300000 };
    const ar = (lo, hi) => [...(lo != null ? [['>=', ['get', 'a'], lo]] : []), ...(hi != null ? [['<', ['get', 'a'], hi]] : [])];
    const stOrPart = ['any', kind('s'), kind('p')];
    // minor states and the parts of empires: upright, smaller
    sym('lbl-xs', ['all', stOrPart, ...ar(null, AREA.s)], { 'text-font': STATE_F, 'text-size': 10.5, 'text-padding': 2 }, st, { minzoom: 4.4 });
    sym('lbl-s', ['all', stOrPart, ...ar(AREA.s, AREA.m)], { 'text-font': STATE_F, 'text-size': zoomIn(3, 6, 10.5, 12.5), 'text-padding': 2 }, st, { minzoom: 3.2 });
    sym('lbl-part', ['all', kind('p'), ...ar(AREA.m, null)], { 'text-font': STATE_F, 'text-size': zoomIn(3, 6, 12, 15), 'text-letter-spacing': 0.01, 'text-padding': 3,
      'text-variable-anchor': ['center', 'top', 'bottom'], 'text-radial-offset': 0.8 }, st, { minzoom: Z_SPLIT });
    sym('lbl-m', ['all', kind('s'), ...ar(AREA.m, AREA.l)], { 'text-font': STATE_F, 'text-size': zoomIn(1.5, 5, 11, 14.5), 'text-letter-spacing': 0.01, 'text-padding': 3,
      'text-variable-anchor': ['center', 'top', 'bottom', 'left', 'right'], 'text-radial-offset': 0.8, 'text-justify': 'center' }, st, { minzoom: 1.6 });
    // major powers and empires: semibold capitals with modest letter-spacing, sized by area; along a line across the state when it fits
    const bigSize = ['interpolate', ['linear'], ['zoom'], 1, ['interpolate', ['linear'], ['get', 'a'], 1300000, 10.5, 12000000, 13], 5, ['interpolate', ['linear'], ['get', 'a'], 1300000, 13.5, 12000000, 17]];
    const fits = ['>=', ['zoom'], ['get', 'zf']];
    const bigPt = { 'text-font': POWER, 'text-transform': 'uppercase', 'text-size': bigSize, 'text-letter-spacing': 0.07, 'text-padding': 3, 'text-max-width': 6.5, 'text-line-height': 1.05,
      'text-variable-anchor': ['center', 'top', 'bottom', 'left', 'right'], 'text-radial-offset': 0.9, 'text-justify': 'center' };
    const bigLine = { 'text-font': POWER, 'text-transform': 'uppercase', 'text-size': bigSize, 'symbol-placement': 'line-center', 'text-max-angle': 28, 'text-padding': 2, 'text-max-width': 100,
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
      layout: { 'text-field': ['get', 'n'], 'text-font': ITALIC, 'text-size': 11.5, 'text-max-width': 7, 'text-padding': 2 },
      paint: { 'text-color': c.textPart, 'text-halo-color': c.halo, 'text-halo-width': 1.2 } });
    m.addLayer({ id: 'col-label', type: 'symbol', source: 'col-lbl', minzoom: 3,
      layout: { 'text-field': ['get', 'n'], 'text-font': ITALIC, 'text-size': 12, 'text-max-width': 7 },
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
        'circle-stroke-color': ['case', ['==', ['get', 'inv'], 1], ['get', 'c'], c.marker],
        'circle-stroke-width': ['case', ['==', ['get', 'inv'], 1], 3.5, 1.6], 'circle-stroke-opacity': ['case', ['==', ['get', 'inv'], 1], 0.45, 1] } });
    // inventions and discoveries: a ring round the dot (their own mark in the key)
    // an invisible letter on every single marker: territory labels move away from markers instead of hiding them
    m.addLayer({ id: 'ev-pad', type: 'symbol', source: 'ev', filter: ['!', ['has', 'point_count']],
      layout: { 'text-field': 'O', 'text-font': SANS, 'text-size': 13, 'text-allow-overlap': true, 'text-padding': 3 }, paint: { 'text-opacity': 0 } });
    m.addLayer({ id: 'ev-sel', type: 'circle', source: 'ev', filter: ['==', ['get', 'i'], '__none'],
      paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 13, 'circle-stroke-color': c.sel, 'circle-stroke-width': 2.5 } });

    // interaction
    const hover = ['ev-point', 'ev-cluster', 'us-fill', 'col-fill', ...STACKS.map((id) => 'ufill' + id)];
    for (const id of STACKS) for (let s = 0; s < SLOTS; s++) hover.push(`fill${s}${id}`);
    m.on('mousemove', (e) => {
      const hit = m.queryRenderedFeatures(e.point, { layers: hover.filter((l) => m.getLayer(l)) }).length > 0;
      m.getCanvas().style.cursor = hit ? 'pointer' : '';
    });
    m.on('click', (e) => this._click(e));
    m.on('moveend', () => this._flagsAfter());
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
      if (st.next) { const d = st.next; st.next = null; this._setData(id, d); } else this.map.triggerRepaint();
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

  /** Show a border snapshot (prepared by prepareDoc in main.js); the land that changed hands is animated. */
  async setSnapshot(doc, { fade = true } = {}) {
    const tok = (this._snapTok = (this._snapTok || 0) + 1);
    const id = await this.stage(doc);
    if (tok !== this._snapTok) { this.release(id); return; }   // a later call took over
    await this.show(id, doc, { dur: reduceMotion() || this.snapshotYear == null || !fade ? 0 : 900 * (this.durScale || 1) });
  }

  /** Load a document into a hidden stack and wait until its tiles are in. Resolves with the stack id, which is
   *  held for show() (or release()). */
  async stage(doc) {
    const free = () => STACKS.find((s) => s !== this.active && s !== this._out && !(this._held ||= new Set()).has(s));
    // every stack busy (calls in quick succession): wait for one; a running change ends within a second
    for (let i = 0; !free() && i < 300; i++) await new Promise((r) => setTimeout(r, 30));
    const id = free() || STACKS.find((s) => s !== this.active);
    this._held.add(id);
    const src = this.map.getSource('t' + id);
    if (doc) doc.features.forEach((f, i) => { f.id = i; });   // feature ids: the changed land is marked by feature state
    this.map.removeFeatureState({ source: 't' + id });
    // only the features go to the worker (the document also holds polities, groups and label places)
    try { await src.setData(doc ? { type: 'FeatureCollection', features: doc.features } : EMPTY, true); } catch { /* the source reports errors itself */ }
    const t0 = performance.now();
    await new Promise((res) => {
      const poll = () => (this.map.isSourceLoaded('t' + id) || performance.now() - t0 > 8000 ? res() : setTimeout(poll, 16));
      setTimeout(poll, 0);
    });
    if (!this._flagHold && this._wantFlags()) await this._drawFlags(id, doc);
    else Object.assign(this._fc[id], { doc, ok: false });
    return id;
  }

  release(id) { this._held?.delete(id); }

  /** How a stack is drawn: 'on' (the map shown) or 'off'. Opacity only ever switches; nothing is faded. */
  _mode(sid, mode) {
    const m = this.map;
    const v = (on) => (mode === 'on' ? on : 0);
    for (let s = 0; s < SLOTS; s++) {
      m.setPaintProperty(`fill${s}${sid}`, 'fill-opacity', v(1));
      m.setPaintProperty(`line${s}${sid}`, 'line-opacity', v(1));
      m.setPaintProperty(`glow${s}${sid}`, 'line-opacity', v(this.dark ? 0.55 : 0.3));
    }
    m.setPaintProperty('ufill' + sid, 'fill-opacity', v(this.dark ? 0.85 : 0.9));
    m.setPaintProperty('inner' + sid, 'line-opacity', mode === 'on' ? ['interpolate', ['linear'], ['zoom'], Z_SPLIT - 0.5, 0, Z_SPLIT + 0.4, 0.6] : 0);
    const fl = mode === 'on' && this._flagOn(sid);
    const pat = mode === 'on' && this._patOn(sid);
    m.setPaintProperty('flag' + sid, 'raster-opacity-transition', { duration: 0 });
    m.setPaintProperty('flag' + sid, 'raster-opacity', fl ? 1 : 0);
    m.setPaintProperty('fpat' + sid, 'fill-opacity', pat ? (this.dark ? 0.85 : 1) : 0);
    m.setPaintProperty('fline' + sid, 'line-opacity', fl || pat ? 0.8 : 0);
    if (fl) this._upload(sid);
    m.setPaintProperty('uline' + sid, 'line-opacity', mode === 'on' ? ['interpolate', ['linear'], ['zoom'], Z_PEOPLES - 0.4, 0, Z_PEOPLES + 0.4, 0.45] : 0);
  }

  /** What changed between two prepared documents. A feature is unchanged when the other map has the same
   *  outline in the same colours; everything else is changed land. Returns {lost: [old feature ids], gained:
   *  [new feature ids], t: Map('o'+id | 'n'+id -> start time in 0..1)}. Times sweep outwards from the part of
   *  the new owner that it already held, so a conquest spreads from the conqueror's side; new states stamp in
   *  one after another. */
  diff(oldDoc, newDoc) {
    const out = { lost: [], gained: [], t: new Map() };
    if (!oldDoc || !newDoc) return out;
    const key = (f) => `${gk(f.geometry)}|${f.properties.c}|${f.properties.c2}|${f.properties.u}`;
    const oldKeys = new Set(oldDoc.features.map(key));
    const newKeys = new Set(newDoc.features.map(key));
    oldDoc.features.forEach((f, i) => { if (!newKeys.has(key(f))) out.lost.push(i); });
    newDoc.features.forEach((f, i) => { if (!oldKeys.has(key(f))) out.gained.push(i); });
    const lp = (doc, f) => doc.polities[f.properties.k]?.l;
    // the anchor of each new group: the label point of its largest member that it already held
    const gainedSet = new Set(out.gained);
    const unchanged = new Set();
    newDoc.features.forEach((f, i) => { if (!gainedSet.has(i)) unchanged.add(f.properties.k); });
    const anchor = new Map();
    const anchorOf = (g) => {
      if (anchor.has(g)) return anchor.get(g);
      const ks = (newDoc.groups?.[g]?.members || []).filter((k) => newDoc.polities[k]?.l);
      const held = ks.filter((k) => unchanged.has(k));
      const best = (held.length ? held : ks).reduce((a, b) => (a == null || (newDoc.polities[b].a || 0) > (newDoc.polities[a].a || 0) ? b : a), null);
      anchor.set(g, best == null ? null : newDoc.polities[best].l);
      return anchor.get(g);
    };
    const many = out.gained.length + out.lost.length > 700;
    const raw = new Map();
    let dMax = 12;
    const gainTests = many ? [] : out.gained.map((i) => ({ i, f: newDoc.features[i], test: null }));
    const ownerAt = (x, y) => {
      for (const gt of gainTests) {
        gt.test ||= makeAreaTest([gt.f.geometry]);
        if (gt.test(x, y)) return gt;
      }
      return null;
    };
    for (const i of out.gained) {
      const f = newDoc.features[i];
      const l = lp(newDoc, f);
      const a = anchorOf(f.properties.g);
      const d = l && a ? Math.hypot(l[0] - a[0], l[1] - a[1]) : 0;
      // a state that is new as a whole stamps in after a short stagger of its own
      const own = a && l && a[0] === l[0] && a[1] === l[1];
      raw.set('n' + i, own ? -1 - hash01(String(newDoc.polities[f.properties.k]?.n)) : d);
      if (!own) dMax = Math.max(dMax, d);
    }
    for (const i of out.lost) {
      const f = oldDoc.features[i];
      const l = lp(oldDoc, f);
      const gt = l && !many ? ownerAt(l[0], l[1]) : null;
      raw.set('o' + i, gt ? raw.get('n' + gt.i) : -1.5);
    }
    for (const [k, d] of raw) out.t.set(k, d < 0 ? 0.15 + 0.6 * (-1 - d) : Math.min(1, d / dMax) * 0.85);
    // the colour each gained feature had on the old map (at its label point): it is shown in that colour until
    // its moment comes, so that a large state breaking up does not change all at once
    out.oc = new Map();
    if (!many) {
      const olds = oldDoc.features.filter((f) => f.properties.u !== 1);
      for (const i of out.gained) {
        const f = newDoc.features[i];
        const l = lp(newDoc, f);
        if (!l) continue;
        for (const o of olds) {
          const bb = bbOf(o.geometry);
          if (!bb || l[0] < bb[0] || l[0] > bb[2] || l[1] < bb[1] || l[1] > bb[3]) continue;
          if (testOf(o.geometry)(l[0], l[1])) { if (o.properties.c !== f.properties.c) out.oc.set(i, o.properties.c); break; }
        }
      }
    }
    return out;
  }

  /** Show a staged stack. Without `dur`, at once. With it, only the land that changed hands moves: the new map
   *  is laid under the old one at once, every unchanged part of the old map drops away in the same frame (the
   *  two are identical there), and each changed part of the old map eases away at its own moment, sweeping out
   *  from the new owner. The land under it is shown a little lighter in its new colour (or over its new flag)
   *  and settles to its final look, with a thin outline in the new owner's colour that eases in and out.
   *  Borders snap; nothing else moves. Each piece takes about 55% of `dur` (400-700 ms for a single change at
   *  Normal speed). `lite` (a slow device): the old land just eases away. Resolves when the change is over. */
  show(id, doc, { dur = 0, lite = false } = {}) {
    const m = this.map;
    this._held?.delete(id);
    this._finish();
    const prev = this.active;
    const oldDoc = this._docs?.[prev];
    (this._docs ||= {})[id] = doc;
    const stats = { lost: 0, gained: 0, eases: new Set(), fades: new Set() };   // eases/fades: in-between values stepped through (checks)
    if (prev !== id) {
      // the new map goes directly under the old one
      const order = ['ufill', 'uline'];
      for (let s = 0; s < SLOTS; s++) order.push('glow' + s, 'line' + s, 'fill' + s);
      order.push('inner');
      for (const l of order) m.moveLayer(l + id, 'ufill' + prev);
      m.moveLayer('flag' + id, 'flag' + prev);
      this._mode(id, 'on');
      const d = dur ? this.diff(oldDoc, doc) : null;
      if (d && (d.lost.length || d.gained.length)) {
        stats.lost = d.lost.length; stats.gained = d.gained.length;
        // flags on both maps: the leaving land is drawn with its old flags into the 'X' canvas; else the old
        // map's changed land is copied to the 'leave' layers. Either is drawn over the new map, and the old
        // stack goes once they are in, so no frame shows the new map there early.
        const flagged = this._flagOn(id) && this._flagOn(prev);
        const ffx = flagged ? this._fc[prev] : null;
        const leave = flagged ? [] : d.lost.map((i, j) => ({ type: 'Feature', id: j, geometry: oldDoc.features[i].geometry, properties: { ...oldDoc.features[i].properties } }));
        const light = (hex) => { try { const [L, C, H] = hexToLch(hex); return lchToHex([Math.min(0.97, L + (1 - L) * 0.45), C * 0.7, H]); } catch { return hex; } };
        const paper = this.dark ? '#3a352c' : '#f6f1e4';
        const fx = d.gained.map((i, j) => {
          const p = doc.features[i].properties;
          return { type: 'Feature', id: j, geometry: doc.features[i].geometry,
            properties: { ce: p.ce, oc: d.oc.get(i) || p.c, lc: flagged && this._fc[id].fills?.has(i) ? paper : light(p.c) } };
        });
        m.removeFeatureState({ source: 'leave' });
        m.removeFeatureState({ source: 'fx' });
        const W = Math.round(Math.max(90, Math.min(700 * (this.durScale || 1), dur * 0.55)));
        const span = Math.max(0, dur - W);
        // items: [start, kind, j]; kinds: 'o' a leaving piece, 'n' a gained piece
        const items = [];
        d.lost.forEach((i, j) => items.push([d.t.get('o' + i) * span, 'o', j, i]));
        // (with flags the leaving land is already in the 'X' canvas in its old flags: no plain-colour cover)
        d.gained.forEach((i, j) => items.push([d.t.get('n' + i) * span, 'n', j, i, !flagged && d.oc.has(i) && d.t.get('n' + i) > 0]));
        items.sort((a, b) => a[0] - b[0]);
        const run = this._run = { items, i: 0, act: [], t0: null, prev, nfx: fx.length, nleave: leave.length, W, lite: lite || dur < 200, ffx, alpha: new Map(), dirty: false };
        const loads = [this._load('leave', leave), this._load('fx', fx)];
        if (ffx) {
          // the leaving land, in its old flags (or its plain colour where it had none), at full strength
          const X = this._fc.X;
          X.ext = ffx.ext;
          run.lostIdx = d.lost;
          run.plain = new Map(d.lost.map((i) => [i, oldDoc.features[i].properties.c]));
          run.paintX = () => { try { paint(X.cv, oldDoc, ffx.fills, ffx.imgs, ffx.ext, { which: d.lost, alpha: run.alpha, plain: run.plain }); } catch { /* no canvas: the change shows without the old flags */ } };
          run.paintX();
          m.getSource('fsrcX').setCoordinates(ffx.ext.coords);
          m.getSource('fsrcX').play();
          m.setPaintProperty('flagX', 'raster-opacity', 1);
          loads.push(new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        }
        Promise.all(loads).then(() => {
          if (this._run !== run) return;
          if (!flagged) d.gained.forEach((i, j) => { if (d.oc.has(i) && d.t.get('n' + i) > 0) m.setFeatureState({ source: 'fx', id: j }, { c: 1 }); });
          this._mode(prev, 'off');
          run.t0 = performance.now();
          const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
          const q = (v) => Math.round(v * 16) / 16;      // stepped: a feature state is set only when its step changes
          const tick = () => {
            if (this._run !== run) return;
            const now = performance.now() - run.t0;
            while (run.i < run.items.length && run.items[run.i][0] <= now) run.act.push({ it: run.items[run.i++], last: {} });
            run.act = run.act.filter((a) => {
              const [t0, kind, j, i, covered] = a.it;
              const u = Math.min(1, (now - t0) / run.W);
              const out = q(1 - ease(u / 0.4));
              let st;
              if (kind === 'o') {
                if (run.ffx) { if (run.alpha.get(i) !== out) { run.alpha.set(i, out); run.dirty = true; } }
                else st = { o: out };
                if (st && st.o !== a.last.o) m.setFeatureState({ source: 'leave', id: j }, st);
                if (out > 0 && out < 1) stats.fades.add(out);
                a.last = st || a.last;
              } else {
                const s2 = run.lite ? { c: covered ? out : 0, a: 0, e: 0 }
                  : { c: covered ? out : 0, a: q(u < 0.3 ? 0.55 : 0.55 * (1 - ease((u - 0.3) / 0.7))), e: q(0.85 * Math.sin(Math.PI * u)) };
                if (s2.c !== a.last.c || s2.a !== a.last.a || s2.e !== a.last.e) { m.setFeatureState({ source: 'fx', id: j }, s2); a.last = s2; if (s2.e > 0 && s2.e < 0.85) stats.eases.add(s2.e); }
              }
              return u < 1;
            });
            if (run.dirty) { run.dirty = false; run.paintX(); }
            if (run.i < run.items.length || run.act.length) run.raf = requestAnimationFrame(tick);
            else if (run.ffx) m.getSource('fsrcX').pause();
          };
          tick();
        });
      } else this._mode(prev, 'off');
      this._out = prev;
    } else this._mode(id, 'on');
    this.active = id;
    this.lastChange = stats;
    this.snapshotYear = doc ? doc.year : null;
    // names change when about a third of the land has moved
    clearTimeout(this._lblT);
    const names = () => { this._setData('labels', doc?.labels || EMPTY); this._setData('label-lines', doc?.labelLines || EMPTY); };
    if (dur) this._lblT = setTimeout(names, dur * 0.3); else names();
    this._sel();
    this._warLayers();
    if (!this._run && prev !== id) { this._out = null; this._flagsAfter(); return Promise.resolve(); }
    // the change lasts `dur` from the moment the leaving land is drawn (at most 400 ms after this call)
    const run = this._run;
    return new Promise((res) => {
      const t0 = performance.now();
      const wait = () => {
        if (this._run !== run) return res();
        if (run.t0 == null && performance.now() - t0 < 400) { this._endT = setTimeout(wait, 16); return; }
        this._endT = setTimeout(() => { if (this._run === run) this._finish(); res(); }, Math.max(0, dur - (performance.now() - (run.t0 ?? performance.now()))));
      };
      wait();
    });
  }

  /** setData and wait until the source's tiles are in (at most 400 ms). */
  async _load(id, features) {
    try { await this.map.getSource(id).setData({ type: 'FeatureCollection', features }, true); } catch { /* reported by the source */ }
    const t0 = performance.now();
    while (!this.map.isSourceLoaded(id) && performance.now() - t0 < 400) await new Promise((r) => setTimeout(r, 8));
  }

  /** End the change on screen at once: the old map goes, the overlays switch off. */
  _finish() {
    const r = this._run;
    if (r) {
      cancelAnimationFrame(r.raf);
      this._run = null;
      this._mode(r.prev, 'off');
      for (let j = 0; j < r.nfx; j++) this.map.setFeatureState({ source: 'fx', id: j }, { c: 0, a: 0, e: 0 });
      this.map.getSource('leave').setData(EMPTY);
      this.map.getSource('fx').setData(EMPTY);
      if (r.ffx) {
        this.map.setPaintProperty('flagX', 'raster-opacity', 0);
        this.map.getSource('fsrcX').pause();
        this._fc.X.cv.width = this._fc.X.cv.height = 1;   // the leaving land's canvas is not needed until the next change
      }
      this._flagsAfter();
    }
    clearTimeout(this._endT);
    this._out = null;
  }

  // ---------------------------------------------------------------- flag fill
  /** 'flag' (default) or 'plain' (round 9's colours). */
  setFillMode(mode) {
    this.fillMode = mode;
    if (mode === 'flag') loadFills().then(() => this._redrawActive(true)).catch((e) => console.warn('flag fill', e));
    this._fillStyle();
    for (const s of STACKS) this._mode(s, s === this.active || s === this._out ? 'on' : 'off');
  }

  /** While the years play, flags are not drawn (each map would take a canvas redraw): plain colours, then flags
   *  again when the map rests. */
  setFlagHold(on) {
    this._flagHold = on && !this.flagsInPlay;
    if (!on) this._flagsAfter();
  }

  _wantFlags() { return this.fillMode !== 'plain' && fillsReady(); }

  _flagOn(sid) {
    const f = this._fc?.[sid];
    return !!(f && this.fillImpl === 'canvas' && this._wantFlags() && f.doc && f.doc === this._docs?.[sid] && f.ok);
  }

  /** The fallback fill is drawn for a stack's map. */
  _patOn(sid) {
    const f = this._fc?.[sid];
    return !!(f && this.fillImpl === 'pattern' && this._wantFlags() && f.pat && f.pat.doc === this._docs?.[sid]);
  }

  /** The canvas path failed on this device: switch to the fallback for good (this page), free the canvases. */
  _flagFail(why) {
    if (this.fillImpl === 'pattern') return;
    console.warn('flag fill: canvas path failed (' + why + '); using the pattern fill');
    this.fillImpl = 'pattern';
    this.fillWhy = why;
    for (const sid of [...STACKS, 'X']) {
      const f = this._fc[sid];
      if (f.onRender) { this.map.off('render', f.onRender); f.onRender = null; }
      this.map.setPaintProperty('flag' + sid, 'raster-opacity', 0);
      this.map.getSource('fsrc' + sid)?.pause();
      f.cv.width = f.cv.height = 1;
      Object.assign(f, { ok: false, ext: null, probe: null });
    }
    this._redrawActive(true);
  }

  /** The fallback: each state of a stack's map tiled with its flag (fill-pattern). */
  _drawPattern(sid, doc, fills, imgs, year) {
    const m = this.map;
    const byK = new Map();
    for (const [i, fl] of fills) {
      const id = 'pf:' + fl.key;
      if (!m.hasImage(id)) { const t = flagTile(fl, imgs); if (!t) continue; m.addImage(id, t, { pixelRatio: 2 }); }
      byK.set(doc.features[i].properties.k, id);
    }
    const f = this._fc[sid];
    if (!byK.size) { m.setFilter('fpat' + sid, NONE); f.pat = { doc, fy: year }; return; }
    const ks = [...byK.keys()];
    const match = ['match', ['get', 'k']];
    for (const [k, id] of byK) match.push(k, id);
    match.push('pf-none');
    m.setFilter('fpat' + sid, ['all', ['!=', ['get', 'u'], 1], ['in', ['get', 'k'], ['literal', ks]]]);
    m.setPaintProperty('fpat' + sid, 'fill-pattern', match);
    f.pat = { doc, fy: year, n: byK.size };
  }

  /** For ?debug=1 and the checks: how the flags are drawn on this device. */
  fillDiag() {
    const cvs = Object.values(this._fc || {}).map((f) => f.cv);
    const px = cvs.reduce((a, c) => a + c.width * c.height, 0);
    return { mode: this.fillMode, impl: this.fillImpl, why: this.fillWhy || '', renderer: this.renderer || '?', maxTex: this.maxTex, cap: canvasCap(),
      canvases: cvs.length, canvasMB: Math.round((px * 4) / 1e5) / 10, sizes: cvs.map((c) => c.width + 'x' + c.height).join(' '),
      check: this._checkLog || '', dpr: window.devicePixelRatio, on: this._flagOn(this.active) || this._patOn(this.active) };
  }

  /** Did the GPU get the canvas? Reads, from the source's texture itself, the pixel that paint() found opaque.
   *  true / false, or null when it cannot tell yet (no texture, or no probe pixel). */
  _texOk(sid) {
    const f = this._fc[sid], src = this.map.getSource('fsrc' + sid), tex = src?.texture;
    if (this._forceFail) return false;
    if (!f.probe) return true;   // nothing large enough was drawn to check
    if (!tex || !tex.texture) return null;
    if (tex.size && (tex.size[0] !== f.cv.width || tex.size[1] !== f.cv.height)) return false;
    try {
      const gl = this.map.painter.context.gl;
      const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex.texture, 0);
      let px = null;
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
        px = new Uint8Array(4);
        gl.readPixels(f.probe.x, f.probe.y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
      gl.deleteFramebuffer(fb);
      if (!px) { this._unreadable = true; return true; }   // cannot read this texture back here: no verdict
      const want = f.probe.rgba;
      return px[3] > 200 && Math.abs(px[0] - want[0]) < 48 && Math.abs(px[1] - want[1]) < 48 && Math.abs(px[2] - want[2]) < 48;
    } catch { this._unreadable = true; return true; }
  }

  /** Text halos a little wider over busy flags; US state and colony fills give way to the flags. */
  _fillStyle() {
    const m = this.map;
    const on = this.fillMode !== 'plain';
    for (const l of ['lbl-xs', 'lbl-s', 'lbl-part', 'lbl-m', 'lbl-l', 'lbl-l-fb', 'lbl-l-line', 'lbl-emp', 'lbl-emp-fb', 'lbl-emp-line']) {
      if (!m.getLayer(l)) continue;
      const base = /lbl-(l|emp)/.test(l) ? 1.4 : 1.2;
      m.setPaintProperty(l, 'text-halo-width', on ? base + 0.8 : base);
      m.setPaintProperty(l, 'text-halo-blur', on ? 0.3 : 0.6);
    }
    m.setPaintProperty('col-fill', 'fill-opacity', on ? 0 : 0.85);
    this._usFlagHide = on;
  }

  /** A canvas source uploads its pixels only while it plays and its layer is drawn: play it for a few frames
   *  from the moment its layer shows. */
  _upload(sid) {
    const src = this.map.getSource('fsrc' + sid);
    if (!src || this.fillImpl !== 'canvas') return;
    src.play();
    this.map.triggerRepaint();
    // count drawn frames, not time: a slow device may take longer than a timer to draw one. Then check that the
    // texture holds the new picture (MapLibre skips the upload while the source has no tile yet, and a resize
    // seen in that frame is lost); keep uploading until it does, and fall back to the pattern fill if it never
    // does.
    const f = this._fc[sid];
    f.left = 3;
    f.tries = 0;
    f.t0 = performance.now();
    if (f.onRender) return;
    f.onRender = () => {
      if (--f.left > 0) return;
      const check = STACKS.includes(sid) && f.ok;
      const v = check ? this._texOk(sid) : true;
      if (v !== true) {
        f.tries++;
        this._checkLog = `${sid}: try ${f.tries} ${v === null ? 'no texture yet' : 'texture differs'}`;
        // give up after 2 s and a few frames (a slow GPU draws a frame a second), or 120 frames
        if (f.tries < 120 && !(f.tries >= 5 && performance.now() - f.t0 > 2000)) { f.left = 1; this.map.triggerRepaint(); return; }
        this.map.off('render', f.onRender);
        f.onRender = null;
        this._flagFail(v === null ? 'no texture' : 'texture check');
        return;
      }
      if (check) this._checkLog = `${sid}: ${this._unreadable ? 'texture not readable' : 'texture ok'} after ${f.tries} retries`;
      this.map.off('render', f.onRender);
      f.onRender = null;
      if (!(this._run?.ffx && sid === 'X')) src.pause();
    };
    this.map.on('render', f.onRender);
  }

  /** Draw a stack's flag canvas for its document (at the current view). */
  async _drawFlags(sid, doc) {
    const f = this._fc[sid];
    if (!doc || !this._wantFlags()) { f.ok = false; f.doc = doc; return false; }
    const year = doc.fy ?? doc.year;
    const fills = fillsOf(doc, year, this.flagEmp);
    const imgs = await ensureImages(fills);
    if (this.fillImpl === 'pattern') {
      try { this._drawPattern(sid, doc, fills, imgs, year); } catch (e) { console.warn('pattern fill', e); }
      Object.assign(f, { doc, fills, imgs, ok: false, fy: year });
      return false;
    }
    const ext = extentFor(this.map);
    const t0 = performance.now();
    let probe;
    try {
      probe = paint(f.cv, doc, fills, imgs, ext, { probe: true });
    } catch (e) {
      Object.assign(f, { doc, ok: false });
      this._flagFail('canvas: ' + (e?.message || e));
      return false;
    }
    (this.flagStats ||= []).push(Math.round(performance.now() - t0));
    Object.assign(f, { doc, ext, fills, imgs, ok: true, fy: year, probe });
    this.map.getSource('fsrc' + sid).setCoordinates(ext.coords);
    if (sid === this.active || sid === this._out) this._upload(sid);
    return true;
  }

  /** After a change or a pan: the shown stack gets flags drawn for its map and view if it lacks them. */
  async _redrawActive(fade = false) {
    const sid = this.active;
    const doc = this._docs?.[sid];
    if (!doc || !this._wantFlags() || this._flagHold || this._run) return;
    const f = this._fc[sid];
    const m = this.map;
    if (this.fillImpl === 'pattern') {
      if (!(f.pat?.doc === doc && f.fy === (doc.fy ?? doc.year))) {
        const tok = (this._flagTok = (this._flagTok || 0) + 1);
        await this._drawFlags(sid, doc);
        if (tok !== this._flagTok || this.active !== sid || this._run) return;
      }
      m.setPaintProperty('fpat' + sid, 'fill-opacity', this._patOn(sid) ? (this.dark ? 0.85 : 1) : 0);
      m.setPaintProperty('fline' + sid, 'line-opacity', this._patOn(sid) ? 0.8 : 0);
      return;
    }
    if (f.doc === doc && f.ok && f.fy === (doc.fy ?? doc.year) && extentOk(f.ext, this.map)) return;
    const tok = (this._flagTok = (this._flagTok || 0) + 1);
    const had = this._flagOn(sid);
    if (!(await this._drawFlags(sid, doc))) return;
    if (tok !== this._flagTok || this.active !== sid || this._run || this.fillImpl !== 'canvas') return;
    m.setPaintProperty('flag' + sid, 'raster-opacity-transition', { duration: fade && !had && !reduceMotion() ? 350 : 0 });
    m.setPaintProperty('flag' + sid, 'raster-opacity', 1);
    m.setPaintProperty('fline' + sid, 'line-opacity', 0.8);
    this._upload(sid);
  }

  /** For checks: the flag fill drawn at a point of the shown map: {on, key ('m:RU' today's flag, 'h:<id>' the
   *  state's own flag, null none), name}. */
  fillAt(lon, lat) {
    const sid = this.active, f = this._fc?.[sid], doc = this._docs?.[sid];
    if (!doc) return null;
    const i = doc.features.findIndex((ft) => ft.properties.u !== 1 && ft.properties.k >= 0 && makeAreaTest([ft.geometry])(lon, lat));
    const on = this.fillImpl === 'pattern' ? this._patOn(sid) && this.map.getPaintProperty('fpat' + sid, 'fill-opacity') > 0
      : this._flagOn(sid) && this.map.getPaintProperty('flag' + sid, 'raster-opacity') === 1;
    return { on, impl: this.fillImpl, key: f?.fills?.get(i)?.key || null,
      name: i >= 0 ? doc.polities[doc.features[i].properties.k]?.n : null };
  }

  /** The year moved on over the same map (an own flag can change without a border change). */
  refreshFlags() { this._flagsAfter(); }

  _flagsAfter() {
    if (this._wantFlags() && !this._flagHold) this._redrawActive(true);
  }

  /** While the years run (play, a step, the timeline being dragged): the names of small states and peoples
   *  fade out, so that only the major powers' names stay, in steady places. */
  setTravel(on) {
    if (this._travel === on) return;
    this._travel = on;
    this.el.classList.toggle('travel', on);   // marker pings pause while the years run
    for (const l of ['lbl-xs', 'lbl-s', 'lbl-people-s', 'lbl-people', 'us-label', 'col-label']) {
      if (!this.map.getLayer(l)) continue;
      this.map.setPaintProperty(l, 'text-opacity-transition', { duration: 300 });
      this.map.setPaintProperty(l, 'text-opacity', on ? 0 : 1);
    }
    this._warLayers();
  }

  /** War on the map: markers [{id, kind: 'battle'|'war', lo, la, label, minor}] and the polity indices (of the
   *  shown map) where shown battles were fought. Markers are buttons (a click opens the event). */
  setWar({ markers = [], groups = [] } = {}) {
    this._warGroups = groups;
    const m = this.map;
    this._wm ||= new Map();
    const keep = new Set();
    for (const mk of markers) {
      keep.add(mk.id);
      let w = this._wm.get(mk.id);
      if (!w) {
        // the marker's own element is positioned by MapLibre (with a transform); the button inside it animates
        const wrap = document.createElement('div');
        wrap.className = 'warwrap';
        const el = document.createElement('button');
        el.type = 'button';
        el.className = `warmk ${mk.kind}`;
        el.innerHTML = mk.kind === 'war' ? SWORDS : '<i></i>';
        el.addEventListener('click', (e) => { e.stopPropagation(); this.dispatchEvent(new CustomEvent('event', { detail: mk.id })); });
        wrap.append(el);
        w = new maplibregl.Marker({ element: wrap, anchor: 'center' }).setLngLat([mk.lo, mk.la]).addTo(m);
        this._wm.set(mk.id, w);
        if (!this._zoomHook) {
          this._zoomHook = () => this.el.classList.toggle('zlow', m.getZoom() < 3.2);
          m.on('zoom', this._zoomHook);
          this._zoomHook();
        }
      }
      const wrap = w.getElement();
      const el = wrap.firstChild;
      wrap.classList.toggle('minor', !!mk.minor);
      el.setAttribute('aria-label', mk.label);
      el.title = mk.label;
    }
    for (const [id, w] of this._wm) if (!keep.has(id)) { w.remove(); this._wm.delete(id); }
    this._setData('warblk', { type: 'FeatureCollection', features: this._warOn === false ? [] : markers.map((mk) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [mk.lo, mk.la] }, properties: { w: 1 } })) });
    this._warLayers();
  }

  setWarVisible(on) {
    this._warOn = on;
    this.el.classList.toggle('war-off', !on);
    this._warLayers();
  }

  _warLayers() {
    const m = this.map;
    if (!m.getLayer('war-edge')) return;
    const gs = this._warOn === false ? [] : this._warGroups || [];
    for (const id of ['war-glow', 'war-edge']) {
      const lay = m.getLayer(id);
      const paint = {};
      for (const p of ['line-color', 'line-width', 'line-blur', 'line-opacity', 'line-dasharray']) { const v = m.getPaintProperty(id, p); if (v !== undefined) paint[p] = v; }
      if (lay.source !== 't' + this.active) {
        m.removeLayer(id);
        m.addLayer({ id, type: 'line', source: 't' + this.active, layout: { 'line-join': 'round' }, paint: { ...paint, 'line-opacity-transition': { duration: 800 } } }, 'occ');
      }
      m.setFilter(id, gs.length ? ['in', ['get', 'k'], ['literal', gs]] : NONE);
      m.setLayoutProperty(id, 'visibility', gs.length ? 'visible' : 'none');
    }
    // a slow pulse of the red glow, at rest only (it repaints the map)
    clearInterval(this._pulse);
    if (gs.length && !this._travel && !reduceMotion()) {
      let hi = false;
      this._pulse = setInterval(() => { hi = !hi; if (m.getLayer('war-glow')) m.setPaintProperty('war-glow', 'line-opacity', hi ? 0.6 : 0.12); }, 900);
    } else m.setPaintProperty('war-glow', 'line-opacity', 0.4);
  }

  selectPolity(k) { this.selK = k; this.selG = null; this._sel(); }
  selectGroup(g) { this.selG = g; this.selK = null; this._sel(); }

  _sel() {
    const m = this.map;
    if (!m.getLayer('sel')) return;
    m.removeLayer('sel');
    m.addLayer({ id: 'sel', type: 'line', source: 't' + this.active, layout: { 'line-join': 'round' },
      filter: this.selG != null ? ['==', ['get', 'g'], this.selG] : ['==', ['get', 'k'], this.selK == null ? -99 : this.selK],
      paint: { 'line-color': this.c.sel, 'line-width': this.selG != null ? 2 : 2.8 } }, 'occ');   // below the sea: the coast stays the coastline
  }

  /** Occupied territories: features with {by, c (occupier colour)}; drawn hatched. */
  setOccupied(features) {
    const m = this.map;
    for (const f of features) {
      const id = 'hatch-' + f.properties.c;
      if (!m.hasImage(id)) m.addImage(id, hatch(f.properties.c, this.dark), { pixelRatio: 2 });
      f.properties.pat = id;
      f.properties.ce = hatchColor(f.properties.c, this.dark);
    }
    this._setData('occ', { type: 'FeatureCollection', features });
  }

  setUS(fc) {
    this._usFC = fc;
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
      for (const l of ['us-old', 'us-vis']) { m.setPaintProperty(l, 'fill-opacity-transition', { duration: 0 }); m.setPaintProperty(l, 'fill-opacity', 0); }
      m.setPaintProperty('us-line', 'line-dasharray', [2, 1.5]);
      return;
    }
    const base = tones(color, 'usa', this.dark).fill;
    const [L, C, H] = hexToLch(base);
    const mix = (t) => lchToHex(this.dark ? [L - t * 0.1, C * (1 - t * 0.6), H] : [L + (0.93 - L) * t, C * (1 - t * 0.6), H]);
    const byStatus = ['match', ['get', 't'], 'State', base, 'District of Columbia', base,
      'Territory', mix(0.5), 'Unorganized Territory', mix(0.85), '#000'];
    // 1861 to 1865: the states that had seceded take the colour of the Confederacy
    const fc = seceded.length && csaColor
      ? ['case', ['in', ['get', 'id'], ['literal', seceded]], tones(csaColor, 'csa', this.dark).fill, byStatus] : byStatus;
    // the colour on the visible layers; us-old keeps the previous colours until it has faded
    m.setPaintProperty('us-fill', 'fill-color', fc);
    m.setPaintProperty('us-vis', 'fill-color', fc);
    clearTimeout(this._usColT);
    this._usColT = setTimeout(() => m.setPaintProperty('us-old', 'fill-color', fc), 700);
    if (m.getPaintProperty('us-vis', 'fill-opacity') === 0) { m.setPaintProperty('us-vis', 'fill-opacity-transition', { duration: 0 }); m.setPaintProperty('us-vis', 'fill-opacity', 1); }
    m.setPaintProperty('us-line', 'line-dasharray', [1, 0]);
  }

  /** Show US states/colonies valid on a date (yyyymmdd), or hide them (null). With `dur`, the fills of the new
   *  date fade in over those of the old one (a territory organized or admitted grows in instead of popping). */
  setUSDate(d, selId = null, { dur = 0 } = {}) {
    const m = this.map;
    const at = (x) => (x == null ? NONE : ['all', ['<=', ['get', 's'], x], ['>=', ['get', 'e'], x]]);
    const f = at(d);
    const vis = (x) => (x == null ? NONE : ['all', at(x), ['!=', ['get', 't'], 'Other']]);
    const prev = this.usDate;
    for (const l of ['us-fill', 'us-line', 'us-label']) m.setFilter(l, f);
    const op = (l, v, du = 0, delay = 0) => { m.setPaintProperty(l, 'fill-opacity-transition', { duration: du, delay }); m.setPaintProperty(l, 'fill-opacity', v); };
    const filled = this._usFill && !this._usFill.startsWith('null');
    clearTimeout(this._usT);
    // the new date at once; states and territories that are new on it get an outline that eases in and out
    m.setFilter('us-vis', vis(d));
    m.setFilter('us-old', NONE);
    op('us-vis', filled && !this._usFlagHide ? 1 : 0);
    if (dur && prev != null && d != null && prev !== d && filled && !reduceMotion() && this._usFC) {
      const was = new Set(this._usFC.features.filter((f) => f.properties.s <= prev && f.properties.e >= prev && f.properties.t !== 'Other').map((f) => f.properties.id + '|' + f.properties.t));
      const fresh = this._usFC.features.filter((f) => f.properties.s <= d && f.properties.e >= d && f.properties.t !== 'Other' && !was.has(f.properties.id + '|' + f.properties.t)).map((f) => f.properties.id);
      if (fresh.length && fresh.length < 40) {
        // a thin outline that eases in and out (no blinking)
        const t = Math.max(120, Math.min(350, dur * 0.4));
        m.setFilter('us-flash', ['all', at(d), ['in', ['get', 'id'], ['literal', fresh]]]);
        m.setPaintProperty('us-flash', 'line-opacity-transition', { duration: t });
        m.setPaintProperty('us-flash', 'line-opacity', 0.75);
        this._usT = setTimeout(() => {
          m.setPaintProperty('us-flash', 'line-opacity-transition', { duration: t * 1.4 });
          m.setPaintProperty('us-flash', 'line-opacity', 0);
        }, t);
      }
    } else { m.setPaintProperty('us-flash', 'line-opacity-transition', { duration: 0 }); m.setPaintProperty('us-flash', 'line-opacity', 0); }
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

  /** Flag badges for the map shown (js/flags.js badgeFeatures). */
  setBadges(features) {
    this._badges = features || [];
    this._bz = null;
    this._badgeData();
    this.setBadgesVisible(true);
  }

  _badgeData() {
    const z = Math.round(this.map.getZoom() * 4) / 4;
    if (z === this._bz || !this._badges) return;
    this._bz = z;
    const cap = z < 2 ? 6 : z < 3 ? 12 : 30;     // at world zoom only the largest powers
    const fs = this._badges.filter((f) => f.properties.zm <= z && (z >= Z_SPLIT || f.properties.re < cap));
    this.badgeCount = fs.length;
    this._setData('badges', { type: 'FeatureCollection', features: fs });
  }

  /** Badges are hidden while the years run and come back when the map rests. */
  setBadgesVisible(on) {
    if (this._badgesOn === on) return;
    this._badgesOn = on;
    for (const l of ['badge-lo', 'badge-hi']) this.map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none');
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
        properties: { i: e.i, c: typeColor(e.t), s: e.s || 0, near: near.has(e.i) ? 1 : 0, inv: e.t === 'invention' ? 1 : 0 } });
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

/** The colour of the hatch lines for an occupier: its map colour, darker (lighter on the dark theme) and stronger,
 * so that the lines read as that power's colour on any fill. The year panel's legend uses the same colour. */
export function hatchColor(hex, dark) {
  const [, C, H] = hexToLch(hex);
  return lchToHex([dark ? 0.8 : 0.47, C < 0.01 ? 0 : Math.min(0.16, Math.max(0.11, C * 1.5)), H]);
}

/** A diagonal hatch tile in one colour (for occupied territories). */
function hatch(hex, dark) {
  const n = 16;
  const cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const g = cv.getContext('2d');
  g.strokeStyle = hatchColor(hex, dark);
  g.lineWidth = 3.4;
  g.lineCap = 'square';
  for (const o of [-n, 0, n]) { g.beginPath(); g.moveTo(o, n); g.lineTo(o + n, 0); g.stroke(); }
  const d = g.getImageData(0, 0, n, n);
  return { width: n, height: n, data: new Uint8Array(d.data.buffer) };
}

const GK = new WeakMap();
/** A cheap fingerprint of an outline (point count and coordinate sums), cached per geometry object. */
function gk(g) {
  if (!g) return '';
  let v = GK.get(g);
  if (v) return v;
  let n = 0, sx = 0, sy = 0;
  for (const poly of g.type === 'Polygon' ? [g.coordinates] : g.coordinates || []) for (const ring of poly) for (const p of ring) { n++; sx += p[0]; sy += p[1]; }
  v = `${n}:${sx.toFixed(2)}:${sy.toFixed(2)}`;
  GK.set(g, v);
  return v;
}
const SWORDS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3l7.5 7.5-1.4 1.4L3 4.8V3zm16 0v1.8l-7.1 7.1-1.4-1.4L19 3zM6.3 14.3l3.4 3.4-1.4 1.4-1-1-2.2 2.2-1.4-1.4 2.2-2.2-1-1zm11.4 0l1.4 1.4-1 1 2.2 2.2-1.4 1.4-2.2-2.2-1 1-1.4-1.4 3.4-3.4zM12 13.4l1.4 1.4-1.4 1.4-1.4-1.4z"/></svg>';
const BB = new WeakMap(), TEST = new WeakMap();
function bbOf(g) {
  if (!BB.has(g)) {
    let w = Infinity, so = Infinity, e = -Infinity, n = -Infinity;
    for (const poly of g.type === 'Polygon' ? [g.coordinates] : g.coordinates || []) for (const [x, y] of poly[0]) { if (x < w) w = x; if (x > e) e = x; if (y < so) so = y; if (y > n) n = y; }
    BB.set(g, w === Infinity ? null : [w, so, e, n]);
  }
  return BB.get(g);
}
function testOf(g) { if (!TEST.has(g)) TEST.set(g, makeAreaTest([g])); return TEST.get(g); }
const hash01 = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };

export { TYPES };
