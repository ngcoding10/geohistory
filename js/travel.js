// Time travel. When the year runs (play, a step of several years, the timeline being dragged) the map passes
// through every stored border map in between, in order, and each change is animated by the map (js/map.js
// show(): land that changes hands turns from the old ruler's colour to the new one's, borders fade across).
// What rests on the screen is always a stored map for the year shown; the frames in between are only a fade
// between two stored maps. While one change is shown, the next map is loaded and tiled in a third stack.
//
// Degrades: with prefers-reduced-motion there is no animation at all (the caller jumps). When frames come
// slowly (a slow device), a jump goes straight to its end in one cross-fade and play skips the maps it cannot
// keep up with.
import { MAX_YEAR } from './year.js';

const astro = (y) => (y < 0 ? y + 1 : y);
const hist = (a) => (a <= 0 ? a - 1 : a);
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const SPEEDS = [1, 2, 5, 10, 50];

export class Travel {
  /** stopsBetween(a, b): the years between a (exclusive) and b (inclusive) in which the map may change, in
   *  the order they are passed. docFor(year, prevDoc): {snap, doc, sig}. keyNow(): the key of the map shown.
   *  onStep(year, st): a new map is shown. onTick(year): play reached a year. onRest(year): the run ended. */
  constructor({ map, stopsBetween, docFor, keyNow, yearNow, onStep, onTick, onRest }) {
    Object.assign(this, { map, stopsBetween, docFor, keyNow, yearNow, onStep, onTick, onRest });
    this.speed = 2;          // years per second while playing
    this.mode = null;        // 'to' | 'play' | null
    this.full = false;       // never degrade (tests)
    this.durScale = 1;       // stretches every transition (tests, to look at the frames in between)
    this.slow = false;
    this.slowRuns = 0;
    this.stats = { transitions: 0, frames: [], skipped: 0, coarse: 0, stages: [] };
  }

  get running() { return this._running || this.mode != null; }
  get playing() { return this.mode === 'play'; }

  /** Run to a year. scrub: the timeline is being dragged, so far-off targets may be reached in fewer steps. */
  to(target, { scrub = false } = {}) {
    if (this.mode === 'play') this._stopClock();
    this.mode = 'to';
    this.target = target;
    this.scrub = scrub;
    this._budget = 4;          // a far drag of the timeline reaches its year in at most four changes
    if (!this._running) this.cur = this.yearNow();
    this._run();
  }

  play() {
    this.mode = 'play';
    if (!this._running) this.cur = this.yearNow();
    this.clock = astro(this.cur) + 0.0001;
    this._shownYear = this.cur;
    this._startClock();
    this._run();
  }

  /** Stop after the change being shown; onRest gets the year reached. */
  pause() {
    const wasPlay = this.mode === 'play';
    if (wasPlay) { this._stopClock(); this._restYear = hist(Math.floor(this.clock)); }
    this.mode = null;
    if (this._running) return;     // the loop ends after the change on screen and calls onRest
    if (wasPlay) { this.map.setTravel(false); this.onRest(this._restYear); }
  }

  /** Stop without onRest (the caller goes elsewhere itself). */
  cancel() {
    this._stopClock();
    this.mode = null;
    this._silent = true;
  }

  // ---- the play clock: years advance at `speed`, but never past a map that is not shown yet
  _startClock() {
    this._stopClock();
    let last = performance.now();
    const tick = (t) => {
      if (this.mode !== 'play') return;
      const dt = Math.min(0.25, (t - last) / 1000);
      last = t;
      const nxt = this._nextStop();
      const limit = nxt != null ? astro(nxt) - 0.0005 : astro(MAX_YEAR) + 0.9;
      this.clock = Math.min(this.clock + dt * this.speed, Math.max(this.clock, limit));
      const y = hist(Math.floor(this.clock));
      if (y !== this._shownYear && (nxt == null || astro(y) < astro(nxt))) {
        this._shownYear = y;
        this.onTick(y);
      }
      if (nxt == null && astro(y) >= astro(MAX_YEAR)) { this.pause(); return; }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  _stopClock() { cancelAnimationFrame(this._raf); this._raf = null; }

  _clockAt(stop) {
    return new Promise((res) => {
      const check = () => (this.mode !== 'play' || this.clock >= astro(stop) - 0.001 ? res() : setTimeout(check, 15));
      check();
    });
  }

  // ---- which map comes next
  _nextStop() {
    if (this.mode === 'to') {
      const stops = this.stopsBetween(this.cur, this.target);
      if (!stops.length) return null;
      const k = this._degraded() ? 1 : this.scrub ? Math.max(1, this._budget) : Infinity;
      if (stops.length > k) { this.stats.coarse++; return stops[Math.ceil(stops.length / k) - 1]; }
      return stops[0];
    }
    if (this.mode === 'play') {
      const stops = this.stopsBetween(this.cur, MAX_YEAR);
      if (!stops.length) return null;
      if (this._degraded()) {
        // cannot keep up: the latest map the clock has passed
        let s = stops[0];
        for (const y of stops) { if (astro(y) <= this.clock) s = y; else break; }
        return s;
      }
      return stops[0];
    }
    return null;
  }

  _degraded() { return this.slow && !this.full; }

  _duration(stop, remaining) {
    return Math.round(this._dur0(stop, remaining) * this.durScale);
  }

  _dur0(stop, remaining) {
    if (reducedMotion()) return 0;
    if (this._degraded()) return 350;
    if (this.mode === 'play') {
      const after = this.stopsBetween(stop, MAX_YEAR)[0];
      const gap = after != null ? astro(after) - astro(stop) : 1;
      return Math.round(Math.max(140, Math.min(700, (850 * gap) / this.speed)));
    }
    if (remaining <= 1) return this.scrub ? 300 : 520;
    return Math.round(Math.max(120, Math.min(this.scrub ? 260 : 420, 2600 / remaining)));
  }

  // ---- loading the next map into a hidden stack
  _stage(year, prevDoc) {
    const t0 = performance.now();
    const p = (async () => {
      const st = await this.docFor(year, prevDoc);
      st.key = `${st.doc?.key ?? st.snap?.y}#${st.sig}`;
      if (st.key === this._key) { st.skip = true; return st; }
      st.id = await this.map.stage(st.doc);
      this.stats.stages.push(Math.round(performance.now() - t0));
      return st;
    })();
    return { year, p };
  }

  _drop(pending) {
    pending.p.then((st) => { if (st.id) this.map.release(st.id); }).catch(() => {});
  }

  async _run() {
    if (this._running) return;
    this._running = true;
    this._silent = false;
    this._restYear = null;
    this._key = this.keyNow();
    this.map.setTravel(true);
    let pending = null;
    let prevDoc = null;
    let restYear = this.cur;
    try {
      for (;;) {
        if (this._silent || this.mode == null) break;
        const stop = this._nextStop();
        if (stop == null) break;
        if (!pending || pending.year !== stop) { if (pending) this._drop(pending); pending = this._stage(stop, prevDoc); }
        let st;
        try { st = await pending.p; } catch (e) { console.warn(e); pending = null; this.cur = stop; continue; }
        if (this._silent || this.mode == null) break;
        if (this._nextStop() !== stop) continue;          // the target moved while this map loaded
        pending = null;
        if (st.skip) {
          // the same map as the one shown (a year in which nothing changed): the year moves on, the map stays
          if (this.mode === 'play') await this._clockAt(stop);
          if (this._silent || this.mode == null) break;
          this.cur = stop; this.stats.skipped++;
          st.dur = 0; st.same = true;
          this.onStep(stop, st);
          continue;
        }
        if (this.mode === 'play') await this._clockAt(stop);
        if (this._silent || this.mode == null) { this.map.release(st.id); break; }
        const remaining = this.mode === 'to' ? this.stopsBetween(stop, this.target).length + 1 : 1;
        const dur = this._duration(stop, remaining);
        const shown = this.map.show(st.id, st.doc, { dur });
        this.cur = stop;
        this._key = st.key;
        prevDoc = st.doc;
        restYear = stop;
        this.stats.transitions++;
        if (this.mode === 'to' && this.scrub) this._budget--;
        if (this.mode === 'play') this._shownYear = stop;
        st.dur = dur;
        this.onStep(stop, st);
        // the next map loads while this change is on screen
        const nx = this._nextStop();
        if (nx != null) pending = this._stage(nx, st.doc);
        await this._watch(shown, dur);
      }
    } finally {
      if (pending) this._drop(pending);
      this._running = false;
      const silent = this._silent;
      // played past the last map: the clock runs on to the present and pause() ends the run
      if (!(this.mode === 'play' && !silent)) {
        const end = this.mode === 'to' ? this.target : this._restYear ?? restYear;
        this.mode = null;
        this.map.setTravel(false);
        if (!silent) this.onRest(end);
      }
    }
  }

  /** Frame times during a transition; slow frames twice in a row switch to the degraded mode. */
  async _watch(shown, dur) {
    if (dur < 100) { await shown; return; }
    const ts = [];
    let on = true;
    const f = (t) => { ts.push(t); if (on) requestAnimationFrame(f); };
    requestAnimationFrame(f);
    await shown;
    on = false;
    const d = ts.slice(1).map((t, i) => t - ts[i]);
    if (!d.length) return;
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    this.stats.frames.push({ mean: Math.round(mean * 10) / 10, max: Math.round(Math.max(...d)), n: d.length, dur });
    if (mean > 70) { if (++this.slowRuns >= 2) this.slow = true; } else this.slowRuns = 0;
  }
}
