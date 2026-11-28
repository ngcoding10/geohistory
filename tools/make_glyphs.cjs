// Builds the map label glyphs (fonts/<stack>/<range>.pbf, the signed-distance-field format MapLibre reads)
// from the Source Sans 3 web fonts in fonts/src (Adobe, SIL Open Font License; the @fontsource/source-sans-3
// files), by drawing every character in headless Chromium. Four stacks, one per role on the map:
//   "Atlas Sans Semibold"      empires and major powers (set in capitals by the layer, modest letter-spacing)
//   "Atlas Sans Medium"        ordinary states and the parts of empires (title case)
//   "Atlas Sans Italic"        peoples, sketch regions, US states and colonies
//   "Atlas Sans Light Italic"  oceans and seas
// Usage: NODE_PATH=$(npm root -g) node tools/make_glyphs.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const RANGES = [0, 256, 512, 768, 1024, 7680, 8192];
const UR = {
  cyrillic: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116',
  vietnamese: 'U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB',
  'latin-ext': 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
  greek: 'U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF',
  latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
};
const ss = (w, style) => (s) => `source-sans-3-${s}-${w}-${style}.woff2`;
const STACKS = [
  { name: 'Atlas Sans Semibold', family: 'AtlasSB', file: ss(600, 'normal'), css: '600 24px AtlasSB', style: 'normal', weight: 600 },
  { name: 'Atlas Sans Medium', family: 'AtlasMd', file: ss(500, 'normal'), css: '500 24px AtlasMd', style: 'normal', weight: 500 },
  { name: 'Atlas Sans Italic', family: 'AtlasIt', file: ss(400, 'italic'), css: 'italic 400 24px AtlasIt', style: 'italic', weight: 400 },
  { name: 'Atlas Sans Light Italic', family: 'AtlasLi', file: ss(300, 'italic'), css: 'italic 300 24px AtlasLi', style: 'italic', weight: 300 },
];

function varint(n, out) { n >>>= 0; while (n > 0x7f) { out.push((n & 0x7f) | 0x80); n >>>= 7; } out.push(n); }
function field(num, type, out) { varint((num << 3) | type, out); }
function bytes(num, buf, out) { field(num, 2, out); varint(buf.length, out); for (const b of buf) out.push(b); }
const zz = (n) => (n << 1) ^ (n >> 31);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let css = '';
  for (const st of STACKS) for (const [sub, range] of Object.entries(UR)) {
    const b64 = fs.readFileSync(path.join(root, 'fonts/src', st.file(sub))).toString('base64');
    css += `@font-face{font-family:${st.family};font-style:${st.style};font-weight:${st.weight};src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${range};}\n`;
  }
  await page.setContent(`<style>${css}</style><canvas id=c></canvas>`);
  for (const st of STACKS) {
    for (const start of RANGES) {
      const glyphs = await page.evaluate(async ({ font, start }) => {
        const chars = [];
        for (let cp = start; cp < start + 256; cp++) if (cp >= 32 && !(cp >= 127 && cp < 160)) chars.push(cp);
        await document.fonts.load(font, String.fromCodePoint(...chars));
        const buffer = 3, radius = 8, cutoff = 0.25, INF = 1e20;
        const cv = document.getElementById('c');
        const size = 64;
        cv.width = cv.height = size;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.font = font;
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = 'black';
        const edt1d = (grid, offset, stride, length, f, v, z) => {
          v[0] = 0; z[0] = -INF; z[1] = INF; f[0] = grid[offset];
          for (let q = 1, k = 0, s = 0; q < length; q++) {
            f[q] = grid[offset + q * stride];
            const q2 = q * q;
            do { const r = v[k]; s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2; } while (s <= z[k] && --k > -1);
            k++; v[k] = q; z[k] = s; z[k + 1] = INF;
          }
          for (let q = 0, k = 0; q < length; q++) {
            while (z[k + 1] < q) k++;
            const r = v[k]; const qr = q - r;
            grid[offset + q * stride] = f[r] + qr * qr;
          }
        };
        const edt = (data, x0, y0, width, height, gridSize, f, v, z) => {
          for (let x = x0; x < x0 + width; x++) edt1d(data, y0 * gridSize + x, gridSize, height, f, v, z);
          for (let y = y0; y < y0 + height; y++) edt1d(data, y * gridSize + x0, 1, width, f, v, z);
        };
        const out = [];
        const gridOuter = new Float64Array(size * size), gridInner = new Float64Array(size * size);
        const f = new Float64Array(size), z = new Float64Array(size + 1), v = new Uint16Array(size);
        for (const cp of chars) {
          const ch = String.fromCodePoint(cp);
          const m = ctx.measureText(ch);
          const advance = Math.round(m.width);
          const top = Math.ceil(m.actualBoundingBoxAscent), left = Math.floor(-m.actualBoundingBoxLeft);
          const gw = Math.max(0, Math.min(size - 2 * buffer, Math.ceil(m.actualBoundingBoxRight) - left));
          const gh = Math.max(0, Math.min(size - 2 * buffer, top + Math.ceil(m.actualBoundingBoxDescent)));
          if (!gw || !gh) { out.push({ id: cp, w: 0, h: 0, left: 0, top: -25, advance, bitmap: [] }); continue; }
          const w = gw + 2 * buffer, hh = gh + 2 * buffer;
          ctx.clearRect(0, 0, size, size);
          ctx.fillText(ch, buffer - left, buffer + top);
          const img = ctx.getImageData(buffer, buffer, gw, gh).data;
          gridOuter.fill(INF, 0, w * hh); gridInner.fill(0, 0, w * hh);
          for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
            const a = img[4 * (y * gw + x) + 3] / 255;
            if (a === 0) continue;
            const j = (y + buffer) * w + x + buffer;
            if (a === 1) { gridOuter[j] = 0; gridInner[j] = INF; } else { const d = 0.5 - a; gridOuter[j] = d > 0 ? d * d : 0; gridInner[j] = d < 0 ? d * d : 0; }
          }
          edt(gridOuter, 0, 0, w, hh, w, f, v, z);
          edt(gridInner, buffer, buffer, gw, gh, w, f, v, z);
          const bitmap = new Array(w * hh);
          for (let i = 0; i < w * hh; i++) {
            const d = Math.sqrt(gridOuter[i]) - Math.sqrt(gridInner[i]);
            bitmap[i] = Math.max(0, Math.min(255, Math.round(255 - 255 * (d / radius + cutoff))));
          }
          out.push({ id: cp, w: gw, h: gh, left, top: top - 25, advance, bitmap });
        }
        return out;
      }, { font: st.css, start });
      const stack = [];
      bytes(1, Buffer.from(st.name), stack);
      bytes(2, Buffer.from(`${start}-${start + 255}`), stack);
      for (const g of glyphs) {
        const gb = [];
        field(1, 0, gb); varint(g.id, gb);
        if (g.bitmap.length) bytes(2, g.bitmap, gb);
        field(3, 0, gb); varint(g.w, gb);
        field(4, 0, gb); varint(g.h, gb);
        field(5, 0, gb); varint(zz(g.left), gb);
        field(6, 0, gb); varint(zz(g.top), gb);
        field(7, 0, gb); varint(g.advance, gb);
        bytes(3, gb, stack);
      }
      const doc = [];
      bytes(1, stack, doc);
      const dir = path.join(root, 'fonts', st.name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${start}-${start + 255}.pbf`), Buffer.from(doc));
      console.log(st.name, start, glyphs.length, 'glyphs');
    }
  }
  await browser.close();
})();
