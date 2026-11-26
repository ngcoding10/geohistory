// End-to-end check of the main flows in headless Chromium (software WebGL, so allow time).
// Usage: NODE_PATH=$(npm root -g) node tools/e2e.cjs        (starts python3 -m http.server itself)
// Screenshots for a human look go to tools/screens/ (git-ignored).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PORT = 8765 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}/`;
const SHOTS = path.join(__dirname, 'screens');
let failures = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures++; };

async function waitServer() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE); if (r.ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not start');
}

async function newPage(browser, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('requestfailed', (r) => errors.push('request failed: ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  return { page, errors, ctx };
}

const h1 = (page) => page.locator('#panelBody h1').first().innerText();
const listText = (page) => page.locator('#panelBody .events').first().innerText().catch(() => '');

async function typeYear(page, text) {
  await page.fill('#year', text);
  await page.press('#year', 'Enter');
}

async function waitH1(page, text) {
  await page.waitForFunction((t) => document.querySelector('#panelBody h1')?.textContent === t, text, { timeout: 60000 });
}

async function waitEvents(page) {
  await page.waitForSelector('#panelBody .events li, #panelBody .empty', { timeout: 60000 });
}

(async () => {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  fs.mkdirSync(SHOTS, { recursive: true });
  let browser;
  try {
    await waitServer();
    browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

    // ---------------- desktop ----------------
    const { page, errors } = await newPage(browser, { width: 1280, height: 800 });
    await page.goto(BASE + '?y=1700');
    await waitH1(page, 'The world in 1700');
    await page.waitForFunction(() => window.__geo?.state.snapDoc, null, { timeout: 60000 });
    ok(!(await page.locator('#mapStatus.error').count()), 'map started (WebGL available)');

    await typeYear(page, '1776');
    await waitH1(page, 'The world in 1776');
    await waitEvents(page);
    const badge = await page.locator('#badge').innerText();
    ok(/^Borders as of /.test(badge), `badge shows "${badge}"`);
    // the full list, so a lower-ranked headline still counts
    if (await page.locator('#panelBody .more').count()) await page.locator('#panelBody .more').first().click();
    const t1776 = await listText(page);
    ok(/Declaration of Independence/.test(t1776), '1776 list contains the Declaration of Independence');
    await page.screenshot({ path: path.join(SHOTS, 'desktop-1776.png') });

    // step 1773 -> 1776, the list changes every year
    await typeYear(page, '1773');
    await waitH1(page, 'The world in 1773');
    await waitEvents(page);
    let prev = await listText(page);
    ok(/Boston Tea Party/.test(prev), '1773 list contains the Boston Tea Party');
    for (const y of [1774, 1775, 1776]) {
      await page.click('[data-step="1"]');
      await waitH1(page, `The world in ${y}`);
      await waitEvents(page);
      await page.waitForTimeout(300);
      const cur = await listText(page);
      ok(cur && cur !== prev, `stepping to ${y} changes the event list`);
      prev = cur;
    }
    ok(/Lexington and Concord|Bunker Hill/.test(await (async () => { await typeYear(page, '1775'); await waitH1(page, 'The world in 1775'); await waitEvents(page); return listText(page); })()), '1775 has Lexington and Concord or Bunker Hill');

    // a full date highlights that day
    await typeYear(page, '4 July 1776');
    await waitH1(page, 'The world in 1776');
    await waitEvents(page);
    const today = await page.locator('#panelBody .ev.today').first().innerText().catch(() => '');
    ok(/Declaration of Independence/.test(today), '"4 July 1776" highlights the Declaration');

    // BC years
    await typeYear(page, '44 BC');
    await waitH1(page, 'The world in 44 BC');
    ok(/Borders as of 100 BC/.test(await page.locator('#badge').innerText()), '44 BC uses the 100 BC border map');
    await typeYear(page, '-44');
    await waitH1(page, 'The world in 44 BC');
    ok(new URL(page.url()).searchParams.get('y') === '-44', '"-44" is 44 BC and the URL says y=-44');

    // click a territory on the map
    await typeYear(page, '1776');
    await waitH1(page, 'The world in 1776');
    await page.waitForTimeout(1500);
    const pt = await page.evaluate(() => { const p = window.__geo.map.map.project([90, 60]); return { x: p.x, y: p.y }; });
    const box = await page.locator('#map').boundingBox();
    await page.mouse.click(box.x + pt.x, box.y + pt.y);
    await page.waitForFunction(() => document.querySelector('#panelBody .kicker')?.textContent === 'Territory', null, { timeout: 30000 }).catch(() => {});
    const terr = await h1(page);
    ok((await page.locator('#panelBody .kicker').first().textContent()) === 'Territory', `clicking the map opens a territory panel ("${terr}")`);
    await page.waitForSelector('#panelBody h2', { timeout: 30000 });
    await page.screenshot({ path: path.join(SHOTS, 'desktop-territory.png') });

    // fuzzy search
    await page.click('#q');
    await page.fill('#q', 'ottomon');
    await page.waitForSelector('#results li[data-i]', { timeout: 30000 });
    const res = await page.locator('#results').innerText();
    ok(/Ottoman Empire/.test(res), 'fuzzy search "ottomon" finds the Ottoman Empire');
    await page.locator('#results li', { hasText: /^Ottoman Empire\s*Territory/ }).first().click();
    await waitH1(page, 'Ottoman Empire');
    ok(true, 'choosing it opens the Ottoman Empire panel');
    for (const q of ['prusia', 'constantinopel']) {
      await page.fill('#q', q);
      await page.waitForSelector('#results li[data-i]', { timeout: 30000 }).catch(() => {});
      const r = await page.locator('#results').innerText();
      ok(/Prussia|Constantinople/.test(r), `fuzzy search "${q}" finds something (${r.split('\n')[0]})`);
    }
    await page.keyboard.press('Escape');

    // URL round trip
    const url = page.url();
    const before = { h: await h1(page), y: await page.inputValue('#year') };
    ok(/[?&]c=/.test(url) && /[?&]y=/.test(url), `URL holds year and territory (${new URL(url).search})`);
    await page.goto(url);
    await waitH1(page, before.h);
    ok((await page.inputValue('#year')) === before.y, `reload keeps the view (${before.h}, ${before.y})`);

    ok(errors.length === 0, `no console errors on desktop${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);

    // ---------------- phones ----------------
    for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 740 }]) {
      const p = await newPage(browser, vp);
      await p.page.goto(BASE + '?y=1776');
      await waitH1(p.page, 'The world in 1776');
      await p.page.waitForFunction(() => window.__geo?.state.snapDoc, null, { timeout: 60000 });
      await waitEvents(p.page);
      await p.page.waitForTimeout(2500);
      const sw = await p.page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth, document.body.scrollWidth]);
      ok(sw[0] <= sw[1] && sw[2] <= sw[1], `no horizontal scroll at ${vp.width}px (${sw.join('/')})`);
      await p.page.screenshot({ path: path.join(SHOTS, `phone-${vp.width}.png`) });
      if (vp.width === 390) {
        await p.page.click('#sheetHandle');
        await p.page.waitForTimeout(400);
        await p.page.screenshot({ path: path.join(SHOTS, 'phone-390-open.png') });
      }
      ok(p.errors.length === 0, `no console errors at ${vp.width}px${p.errors.length ? ': ' + p.errors.slice(0, 5).join(' | ') : ''}`);
      await p.ctx.close();
    }
  } catch (e) {
    console.error(e);
    failures++;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
  console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
  process.exit(failures ? 1 : 0);
})();
