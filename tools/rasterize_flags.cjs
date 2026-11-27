// Renders flag SVGs to PNG with headless Chromium, for tools/build_flags.py (which has no SVG renderer).
// Usage: NODE_PATH=$(npm root -g) node tools/rasterize_flags.cjs <list.json>
// list.json: [[svgPath, pngPath, width], ...]. Each SVG is drawn into a canvas of the given width (height from
// its aspect ratio) and saved as PNG. Files that do not render are skipped and named on stderr.
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const list = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<!doctype html><body></body>');
  let done = 0;
  for (const [svg, png, width] of list) {
    const text = fs.readFileSync(svg, 'utf8');
    try {
      const data = await page.evaluate(async ([t, w]) => {
        const url = URL.createObjectURL(new Blob([t], { type: 'image/svg+xml' }));
        const im = new Image();
        await new Promise((res, rej) => { im.onload = res; im.onerror = () => rej(new Error('load')); im.src = url; });
        let iw = im.naturalWidth, ih = im.naturalHeight;
        if (!iw || !ih) {
          const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(t);
          if (vb) { iw = +vb[1]; ih = +vb[2]; } else { iw = 3; ih = 2; }
        }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = Math.max(1, Math.round((w * ih) / iw));
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        return cv.toDataURL('image/png');
      }, [text, width]);
      fs.writeFileSync(png, Buffer.from(data.split(',')[1], 'base64'));
      done++;
    } catch (e) {
      console.error('not rendered: ' + svg + ' ' + e.message);
    }
  }
  console.error(`rendered ${done} of ${list.length}`);
  await browser.close();
})();
