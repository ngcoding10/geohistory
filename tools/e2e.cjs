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
    ok(/^Borders in 1776 \(approximate\)/.test(badge), `1776 has its own border map (badge "${badge}")`);
    const snap1776 = await page.evaluate(() => { const d = window.__geo.state.snapDoc; return { src: d.src, n: d.polities.length, usa: d.polities.some((p) => /United States/.test(p.n)), under: d.polities.filter((p) => p.under).length }; });
    ok(snap1776.src === 'clio' && snap1776.n > 100 && snap1776.usa, `the 1776 map comes from Cliopatria and shows the United States (${snap1776.n} territories, ${snap1776.under} from the older sketch map)`);
    // the full list, so a lower-ranked headline still counts
    if (await page.locator('#panelBody .more').count()) await page.locator('#panelBody .more').first().click();
    ok(/The 1770s\./.test(await page.locator('#panelBody').innerText()), 'the 1776 panel opens with the curated summary of the 1770s');
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

    // famous items that the first round missed, and approximate dates
    await typeYear(page, '1969');
    await waitH1(page, 'The world in 1969');
    await waitEvents(page);
    if (await page.locator('#panelBody .more').count()) await page.locator('#panelBody .more').first().click();
    ok(/Apollo 11/.test(await listText(page)), '1969 list contains Apollo 11');
    await typeYear(page, '1215');
    await waitH1(page, 'The world in 1215');
    await waitEvents(page);
    if (await page.locator('#panelBody .more').count()) await page.locator('#panelBody .more').first().click();
    ok(/Magna Carta/.test(await listText(page)), '1215 list contains Magna Carta');

    // BC years
    await typeYear(page, '44 BC');
    await waitH1(page, 'The world in 44 BC');
    ok(/^Borders in 44 BC \(approximate\)/.test(await page.locator('#badge').innerText()), '44 BC has a Cliopatria map (badge "Borders in 44 BC (approximate)")');
    const snap44 = await page.evaluate(() => { const d = window.__geo.state.snapDoc; return { src: d.src, rome: d.polities.some((p) => /Roman Republic/.test(p.n)), under: d.polities.filter((p) => p.under).length, feats: d.features.length }; });
    ok(snap44.src === 'clio' && snap44.rome && snap44.under > 5, `the 44 BC map shows the Roman Republic and ${snap44.under} territories from the older sketch map (${snap44.feats} outlines)`);
    await typeYear(page, '-44');
    await waitH1(page, 'The world in 44 BC');
    ok(new URL(page.url()).searchParams.get('y') === '-44', '"-44" is 44 BC and the URL says y=-44');

    // before 1700 Cliopatria is used too; before 3400 BC the coarse snapshots remain
    await typeYear(page, '1660');
    await waitH1(page, 'The world in 1660');
    ok(/^Borders in 1660 \(approximate\)/.test(await page.locator('#badge').innerText()), '1660 has a Cliopatria map (badge "Borders in 1660 (approximate)")');
    await typeYear(page, '1453');
    await waitH1(page, 'The world in 1453');
    await page.waitForFunction(() => window.__geo.state.snapDoc?.src === 'clio' && window.__geo.state.snapDoc.year <= 1453 && window.__geo.state.snapDoc.year > 1400, null, { timeout: 60000 });
    const n1453 = await page.evaluate(() => window.__geo.state.snapDoc.polities.map((p) => p.n).join('|'));
    ok(/Ottoman/.test(n1453) && /Ming/.test(n1453) && /Inca/.test(n1453), 'the 1453 map has the Ottoman Empire, the Ming and the Inca');
    await typeYear(page, '5000 BC');
    await waitH1(page, 'The world in 5,000 BC');
    ok(/^Borders as of 5,000 BC/.test(await page.locator('#badge').innerText()), '5000 BC, before Cliopatria starts, uses the 5000 BC snapshot');
    // borders change between nearby years in the yearly range: Poland is on the 1790 map and gone from 1800
    const names = async (y) => { await typeYear(page, String(y)); await waitH1(page, `The world in ${y}`); await page.waitForFunction((yy) => { const d = window.__geo.state.snapDoc; return d && d.year <= yy && window.__geo.state.snap?.y === d.year && window.__geo.state.year === yy; }, y, { timeout: 60000 }); return page.evaluate(() => window.__geo.state.snapDoc.polities.map((p) => p.n).join('|')); };
    const n1790 = await names(1790);
    const n1800 = await names(1800);
    ok(/Polish/.test(n1790) && !/Polish-Lithuanian/.test(n1800), 'Poland-Lithuania is on the 1790 map and gone from the 1800 map');
    const n1860 = await names(1860);
    const n1872 = await names(1872);
    ok(!/German Empire/.test(n1860) && /German Empire/.test(n1872), 'the German Empire is absent in 1860 and present in 1872');
    await page.click('#badge');
    ok(/Cliopatria/.test(await page.locator('#badgeInfo').innerText()), 'the badge explains that the map is derived from Cliopatria and approximate');
    await page.click('#badge');

    // dated CShapes borders, the change strip, colonies
    await typeYear(page, '1914');
    await waitH1(page, 'The world in 1914');
    ok(/^Borders on 1 July 1914/.test(await page.locator('#badge').innerText()), '1914 uses dated borders (badge "Borders on 1 July 1914")');
    await typeYear(page, '1772');
    await waitH1(page, 'The world in 1772');
    await page.waitForSelector('.strip', { timeout: 30000 }).catch(() => {});
    ok(/Poland/.test(await page.locator('#panelBody').innerText()), '1772 "What changed this year" names the partition of Poland');

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
    await page.waitForSelector('#panelBody p.about', { timeout: 30000 }).catch(() => {});
    ok(/Anatolia/.test(await page.locator('#panelBody p.about').first().innerText().catch(() => '')), 'the Ottoman Empire panel shows the curated description, tagged as curated');
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

    // ---- round 3: ranking, year-article text, rulers, map notes, aliases, US fills ----
    await page.goto(BASE + '?y=1453');
    await waitH1(page, 'The world in 1453');
    await waitEvents(page);
    const first1453 = await page.locator('#panelBody ul.events li .t').first().innerText();
    ok(/^Fall of Constantinople/.test(first1453), `the 1453 list starts with the fall of Constantinople ("${first1453}")`);
    const top5 = async (y) => { await page.goto(BASE + '?y=' + y); await waitH1(page, 'The world in ' + (y < 0 ? -y + ' BC' : y)); await waitEvents(page); return (await page.locator('#panelBody ul.events li .t').allInnerTexts()).slice(0, 5).join(' | '); };
    for (const [y, re] of [[1066, /Battle of Hastings/], [1688, /Glorious Revolution/], [1861, /American Civil War/], [1911, /Xinhai Revolution/], [1941, /Pearl Harbor/],
      [1054, /Schism/], [1096, /First Crusade/], [1337, /Hundred Years/], [1521, /Tenochtitlan/], [1618, /Thirty Years/], [1865, /Abraham Lincoln/], [1929, /Wall Street/]]) {
      const t5 = await top5(y);
      ok(re.test(t5), `top five of ${y} include ${re.source} (${t5.slice(0, 110)})`);
    }
    // a year-article event: the title, with Wikipedia's sentence under it and the licence in its panel
    await page.goto(BASE + '?y=-44');
    await waitH1(page, 'The world in 44 BC');
    await waitEvents(page);
    const unv = page.locator('#panelBody ul.events li', { hasText: 'unverified' }).first();
    ok(await unv.count() > 0, '44 BC lists unverified sentences from the year article');
    await unv.locator('button').click();
    await page.waitForFunction(() => /CC BY-SA 4\.0/.test(document.querySelector('#panelBody')?.innerText || ''), null, { timeout: 30000 }).catch(() => {});
    const evText = await page.locator('#panelBody').innerText();
    ok(/Text from Wikipedia's article for this year/.test(evText) && /CC BY-SA 4\.0/.test(evText) && /unverified/.test(evText), 'its panel credits Wikipedia (CC BY-SA 4.0) and says the date is unverified');
    // rulers attached from Wikidata and from the curated lists
    await page.goto(BASE + '?y=100&c=' + encodeURIComponent('Roman Empire'));
    await waitH1(page, 'Roman Empire');
    await page.waitForFunction(() => /In office in 100/.test(document.querySelector('#panelBody')?.innerText || ''), null, { timeout: 30000 }).catch(() => {});
    ok(/Trajan/.test(await page.locator('#panelBody').innerText()), 'the Roman Empire panel in 100 names Trajan');
    await page.goto(BASE + '?y=1700&c=' + encodeURIComponent('Qing Dynasty'));
    await waitH1(page, 'Qing Dynasty');
    await page.waitForFunction(() => /In office in 1700/.test(document.querySelector('#panelBody')?.innerText || ''), null, { timeout: 30000 }).catch(() => {});
    const qing = await page.locator('#panelBody').innerText();
    ok(/Kangxi Emperor/.test(qing) && /curated/i.test(qing), 'the Qing panel in 1700 names the Kangxi Emperor, tagged curated');
    ok(/Also called/.test(qing) && /Manchu Empire/.test(qing), 'the Qing panel lists its aliases (Manchu Empire)');
    await page.goto(BASE + '?y=1800&c=' + encodeURIComponent('Danish India'));
    await waitH1(page, 'Danish India');
    await page.waitForFunction(() => /map note/.test(document.querySelector('#panelBody')?.innerText || ''), null, { timeout: 30000 }).catch(() => {});
    ok(/Serampore/.test(await page.locator('#panelBody').innerText()), 'the Danish India panel in 1800 carries the map note about Serampore and Calcutta');
    await page.click('#q');
    await page.fill('#q', 'Manchu Empire');
    await page.waitForSelector('#results li[data-i]', { timeout: 30000 });
    ok(/Qing Dynasty/.test(await page.locator('#results').innerText()), 'searching "Manchu Empire" finds the Qing Dynasty through the alias table');
    await page.keyboard.press('Escape');
    // US states and territories are filled from 1783 to 1912
    const usFill = async (y) => { await page.goto(BASE + '?y=' + y); await waitH1(page, 'The world in ' + y); await page.waitForFunction(() => window.__geo?.map?.usDate != null, null, { timeout: 60000 }); await page.waitForTimeout(800); return page.evaluate(() => { const m = window.__geo.map.map; return { fill: JSON.stringify(m.getPaintProperty('us-fill', 'fill-color')), n: m.querySourceFeatures('us').length }; }); };
    const us1850 = await usFill(1850);
    const us1950 = await usFill(1950);
    ok(/Unorganized Territory/.test(us1850.fill) && !/Unorganized Territory/.test(us1950.fill), 'US states and territories are filled by status in 1850 and are outlines only in 1950');

    await page.goto(BASE + '?y=1750&col=VA');
    await waitH1(page, 'Colony of Virginia');
    ok(true, 'colony panel opens from the URL (Colony of Virginia, 1750)');

    // ---- round 4: what a look at the map by eye turned up ----
    const polAt = async (y) => { await page.goto(BASE + '?y=' + y); await waitH1(page, 'The world in ' + (y < 0 ? (-y).toLocaleString('en-US') + ' BC' : y)); await page.waitForFunction((yy) => window.__geo?.state.year === yy && window.__geo.state.snapDoc && window.__geo.map?.ready, y, { timeout: 60000 }); await page.waitForTimeout(600); return page.evaluate(() => window.__geo.state.snapDoc.polities.map((p) => ({ n: p.n, s: p.s || '', u: !!p.under }))); };
    const layers = await page.evaluate(() => { const m = window.__geo.map.map; const ids = m.getStyle().layers.map((l) => l.id); return { u: ids.indexOf('ufillA'), f: ids.indexOf('fillA'), ul: ids.includes('ulbl-1'), usl: m.getLayer('us-label').source }; });
    ok(layers.u >= 0 && layers.u < layers.f && layers.ul, 'sketch-map territories have their own fill below the states and their own label layers');
    ok(layers.usl === 'us-lbl', 'US state names come from one label point per state');
    const p1914 = await polAt(1914);
    ok(p1914.some((p) => p.n === 'French Sudan') && !p1914.some((p) => p.n === 'Mali') && p1914.some((p) => p.n === 'Belgian Congo'), '1914 uses colonial names (French Sudan, Belgian Congo), not the names of today\'s countries');
    const p1930 = await polAt(1930);
    const zan = p1930.find((p) => p.n === 'Zanzibar'), tan = p1930.find((p) => p.n === 'Tanganyika');
    ok(zan && /United Kingdom/.test(zan.s) && tan && /United Kingdom/.test(tan.s), `1930: Zanzibar and Tanganyika are British ("${zan?.s}", "${tan?.s}")`);
    const p1942 = await polAt(1942);
    await page.waitForFunction(() => /see note/.test(document.querySelector('#badge').textContent), null, { timeout: 20000 }).catch(() => {});
    ok(/see note/.test(await page.locator('#badge').innerText()) && /does not show wartime occupation/.test(await page.locator('#panelBody').innerText()), '1942: the badge and the year panel say that occupation is not shown');
    ok(p1942.length > 100, '1942 map loaded');
    const p1848 = await polAt(1848);
    const bna = p1848.find((p) => p.n === 'British North America');
    ok(bna && bna.u && /United Kingdom/.test(bna.s) && !p1848.some((p) => p.n === 'Canada'), '1848: the sketch map\'s "Canada" is shown as British North America under the United Kingdom');
    const pm1300 = await polAt(-1300);
    ok(!pm1300.some((p) => /^(Urartu|Phrygians|Greek city-states)$/.test(p.n)) && pm1300.some((p) => p.n === 'Hittites'), '1300 BC: Urartu, the Phrygians and the Greek city-states are not drawn centuries early');
    await page.goto(BASE + '?y=1861');
    await waitH1(page, 'The world in 1861');
    await page.waitForFunction(() => window.__geo?.map?.usDate != null, null, { timeout: 60000 });
    await page.waitForTimeout(800);
    const csa = await page.evaluate(() => JSON.stringify(window.__geo.map.map.getPaintProperty('us-fill', 'fill-color')));
    ok(/va_state/.test(csa) && /tn_state/.test(csa) && !/ky_state/.test(csa), '1861: the eleven seceded states are filled in the Confederacy\'s colour');
    const office = async (y, name) => { await page.goto(BASE + '?y=' + y + '&c=' + encodeURIComponent(name)); await waitH1(page, name); await page.waitForSelector('#panelBody .changes-list, #panelBody .empty', { timeout: 60000 }); return (await page.locator('#panelBody .changes-list').first().innerText().catch(() => '')).replace(/\n/g, ' | '); };
    const o1812 = await office(1812, 'First French Empire');
    ok(/Napoleon/.test(o1812), `France 1812 lists Napoleon in office ("${o1812.slice(0, 80)}")`);
    const o1942 = await office(1942, 'Germany');
    ok(/Adolf Hitler/.test(o1942), `Germany 1942 lists Hitler in office ("${o1942.slice(0, 80)}")`);
    const o1600 = await office(1600, 'Ottoman Empire');
    ok(/^Mehmed III, Sultan/.test(o1600) && !/Haseki|Hürrem/.test(o1600), `Ottoman Empire 1600: the sultan comes first and consorts are not listed ("${o1600.slice(0, 90)}")`);
    const o1700 = await office(1700, 'Tokugawa Shogunate');
    ok(/Emperor of Japan/.test(o1700) && /Shogun/.test(o1700), `Tokugawa Japan 1700 shows the emperor and the shogun as separate offices ("${o1700.slice(0, 110)}")`);
    const o63 = await office(-63, 'Roman Republic');
    ok(/Cicero/.test(o63) && /consul/i.test(o63), `Roman Republic 63 BC lists Cicero as consul ("${o63.slice(0, 100)}")`);
    const o1580 = await office(1580, 'Spanish Empire');
    ok(/Philip II/.test(o1580), `Spanish Empire 1580 lists Philip II ("${o1580.slice(0, 80)}")`);
    const t1945 = await top5(1945);
    ok(!/Cold War/.test(t1945), `the Cold War is not among the top five of 1945 (${t1945})`);
    const t1492 = await top5(1492);
    ok(!/European colonization/.test(t1492) && /Columbus/.test(t1492), `1492 is led by Columbus, not by "European colonization of the Americas" (${t1492})`);
    const t800 = await top5(800);
    ok(!/Denmark founded/.test(t800) && /Charlemagne/.test(t800), `"Denmark founded" is not among the top five of 800 (${t800})`);
    await page.goto(BASE + '?y=1942');
    await waitH1(page, 'The world in 1942');
    await waitEvents(page);
    const mid = await page.locator('#panelBody ul.events li', { hasText: 'Battle of Midway' }).first().innerText().catch(() => '');
    ok(mid && !/Congo/.test(mid), `the Battle of Midway is not placed in the Congo ("${mid.replace(/\n/g, ' / ').slice(0, 90)}")`);
    await page.click('#q');
    await page.fill('#q', 'bizantine empir');
    await page.waitForSelector('#results li[data-i]', { timeout: 30000 });
    const firstHit = await page.locator('#results li').first().innerText();
    ok(/^Byzantine Empire\s*Territory/.test(firstHit), `searching "bizantine empir" puts the territory first ("${firstHit.replace(/\n/g, ' ')}")`);
    await page.keyboard.press('Escape');

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
