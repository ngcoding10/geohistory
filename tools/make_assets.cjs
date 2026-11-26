// Renders the PNG icons from assets/icon.svg, and (with a server running) the 1200x630 share image.
// Usage: NODE_PATH=$(npm root -g) node tools/make_assets.cjs [http://localhost:8765/]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const root = path.join(__dirname, '..');
  const svg = fs.readFileSync(path.join(root, 'assets/icon.svg'), 'utf8');
  const square = svg.replace('rx="14"', 'rx="0"');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, size, src] of [['favicon-32.png', 32, svg], ['icon-192.png', 192, svg], ['icon-512.png', 512, square], ['apple-touch-icon.png', 180, square]]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${src}`);
    await page.screenshot({ path: path.join(root, 'assets', name), omitBackground: true });
  }
  const url = process.argv[2];
  if (url) {
    const p2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await p2.goto(url + '?y=1715&v=flat');
    await p2.waitForFunction(() => window.__geo && window.__geo.state.snapDoc, null, { timeout: 60000 });
    await p2.setViewportSize({ width: 1280, height: 800 });
    await p2.waitForTimeout(6000);
    await p2.addStyleTag({ content: '.badges,.maplibregl-control-container{display:none!important}' });
    await p2.evaluate(() => window.__geo.map.setEvents([]));
    await p2.waitForTimeout(1500);
    const shot = await p2.screenshot({ clip: { x: 40, y: 60, width: 800, height: 628 } });
    const b64 = shot.toString('base64');
    await p2.setContent(`<style>
      body{margin:0;width:1200px;height:630px;background:#f5f0e6;font-family:"Iowan Old Style",Palatino,Georgia,serif;display:flex;overflow:hidden}
      .t{width:420px;padding:64px 40px 0 56px;color:#26211a} h1{font-size:64px;margin:0 0 18px;line-height:1} p{font-size:28px;line-height:1.35;color:#51483c;margin:0}
      .y{margin-top:36px;font-size:44px;color:#8a2d1c;font-weight:600}
      img{height:630px;width:auto;object-fit:cover;flex:1;min-width:0;border-left:1px solid #d8cebc}</style>
      <div class="t"><h1>GeoHistory</h1><p>Type a year. See who ruled where, and what happened.</p><div class="y">1715</div></div><img src="data:image/png;base64,${b64}">`);
    await p2.setViewportSize({ width: 1200, height: 630 });
    await p2.screenshot({ path: path.join(root, 'assets/share.png') });
  }
  await browser.close();
})();
