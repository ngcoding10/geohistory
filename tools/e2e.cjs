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
const ONLY = process.env.E2E_ONLY || '';   // 'phone': only the phone, sheet, fill fallback and asset checks; 'suggest': only the suggestion form and admin page
const crypto = require('crypto');
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
    if (!ONLY) {   // E2E_ONLY=phone runs only the phone checks (round 12) below
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
    ok(/Context: the 1770s/i.test(await page.locator('#panelBody').innerText()), 'the 1776 panel has the curated summary of the 1770s, under its own heading');
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
      await page.focus('#slider'); await page.keyboard.press('ArrowRight');
      await waitH1(page, `The world in ${y}`);
      await waitEvents(page);
      await page.waitForTimeout(300);
      const cur = await listText(page);
      ok(cur && cur !== prev, `the Right arrow on the timeline steps to ${y} and changes the event list`);
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
    ok(/Also called/i.test(qing) && /Manchu Empire/.test(qing), 'the Qing panel lists its aliases (Manchu Empire)');
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
    const layers = await page.evaluate(() => { const m = window.__geo.map.map; const ids = m.getStyle().layers.map((l) => l.id); return { u: ids.indexOf('ufillA'), f: ids.indexOf('fill0A'), ul: ids.includes('lbl-people') && ids.includes('lbl-region'), usl: m.getLayer('us-label').source }; });
    ok(layers.u >= 0 && layers.u < layers.f && layers.ul, 'sketch-map territories have their own fill below the states and their own label layers');
    ok(layers.usl === 'us-lbl', 'US state names come from one label point per state');
    const p1914 = await polAt(1914);
    ok(p1914.some((p) => p.n === 'French Sudan') && !p1914.some((p) => p.n === 'Mali') && p1914.some((p) => p.n === 'Belgian Congo'), '1914 uses colonial names (French Sudan, Belgian Congo), not the names of today\'s countries');
    const p1930 = await polAt(1930);
    const zan = p1930.find((p) => p.n === 'Zanzibar'), tan = p1930.find((p) => p.n === 'Tanganyika');
    ok(zan && /United Kingdom/.test(zan.s) && tan && /United Kingdom/.test(tan.s), `1930: Zanzibar and Tanganyika are British ("${zan?.s}", "${tan?.s}")`);
    const p1942 = await polAt(1942);
    await page.waitForFunction(() => /see note/.test(document.querySelector('#badge').textContent), null, { timeout: 20000 }).catch(() => {});
    await waitEvents(page);   // the panel is complete (it loads the year's notes, summaries and events one after another)
    ok(/see note/.test(await page.locator('#badge').innerText()) && /lines in the occupier's colour/.test(await page.locator('#panelBody').innerText()) && /Manchukuo/.test(await page.locator('#panelBody').innerText()), '1942: the badge and the year panel say that the borders are the recognised ones, that occupied countries are hatched, and what is not shown');
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

    // ---------------- empires and their parts ----------------
    await page.goto(BASE + '?y=1914&v=flat');
    await waitH1(page, 'The world in 1914');
    await page.waitForFunction(() => window.__geo?.state.snapDoc?.groups, null, { timeout: 60000 });
    const grp = await page.evaluate(() => {
      const d = window.__geo.state.snapDoc;
      const g = d.groups.find((x) => x.key === 'e:britain');
      const prop = (n) => d.features.find((f) => d.polities[f.properties.k].n === n)?.properties;
      return { n: g?.members.length, name: g?.name, india: prop('India'), canada: prop('Canada'), france: prop('France') };
    });
    ok(grp.name === 'British Empire' && grp.n > 25, `1914: the British Empire is one group of ${grp.n} drawn parts`);
    ok(grp.india.g === grp.canada.g && grp.india.c === grp.canada.c && grp.india.s === grp.canada.s && grp.india.c !== grp.france.c,
      '1914: India and Canada share the empire colour and draw slot, France has another colour');
    await page.evaluate(() => window.__geo.map.map.jumpTo({ center: [60, 25], zoom: 1.6 }));
    await page.waitForTimeout(4000);
    const lowZoom = await page.evaluate(() => {
      const m = window.__geo.map.map;
      const names = (ls) => m.queryRenderedFeatures({ layers: ls }).map((f) => f.properties.n);
      return { emp: names(['lbl-emp', 'lbl-emp-fb', 'lbl-emp-line']), parts: names(['lbl-part', 'lbl-s', 'lbl-xs']).filter((n) => ['India', 'Nigeria', 'Algeria', 'Uganda'].includes(n)),
        inner: m.getPaintProperty('inner' + window.__geo.map.active, 'line-opacity') };
    });
    ok(lowZoom.emp.includes('British Empire') && lowZoom.parts.length === 0, `world zoom shows the empire label and no part labels (${[...new Set(lowZoom.emp)].slice(0, 5).join(', ')})`);
    const px = await page.evaluate(() => { const p = window.__geo.map.map.project([78, 22]); return [p.x, p.y]; });
    await page.mouse.click(px[0], px[1]);
    await waitH1(page, 'British Empire');
    const empText = await page.locator('#panelBody').innerText();
    ok(/Parts on the map in 1914/i.test(empText) && /India/.test(empText) && /Canada/.test(empText), 'clicking India at world zoom opens the British Empire with its parts listed');
    await page.locator('#panelBody .parts button', { hasText: /^India$/ }).first().click();
    await waitH1(page, 'India');
    const partText = await page.locator('#panelBody .facts').innerText();
    ok(/Part of\s*British Empire/i.test(partText), 'the part\'s panel says "Part of British Empire"');
    await page.evaluate(() => window.__geo.map.map.jumpTo({ center: [8, 9], zoom: 4.4 }));
    await page.waitForTimeout(5000);
    const hiZoom = await page.evaluate(() => {
      const m = window.__geo.map.map;
      return { parts: m.queryRenderedFeatures({ layers: ['lbl-part', 'lbl-s', 'lbl-xs'] }).map((f) => f.properties.n), emp: m.queryRenderedFeatures({ layers: ['lbl-emp', 'lbl-emp-fb', 'lbl-emp-line'] }).length };
    });
    ok(hiZoom.parts.includes('Nigeria') && hiZoom.emp === 0, `zoomed in, the parts carry their own labels (${[...new Set(hiZoom.parts)].slice(0, 6).join(', ')}) and the empire label is gone`);
    const px2 = await page.evaluate(() => { const p = window.__geo.map.map.project([8, 9.5]); return [p.x, p.y]; });
    await page.mouse.click(px2[0], px2[1]);
    await waitH1(page, 'Nigeria');
    ok(true, 'zoomed in, a click selects the part (Nigeria), not the empire');
    await page.goto(BASE + '?y=1935&v=flat&c=Canada');
    await waitH1(page, 'Canada');
    await page.waitForSelector('#panelBody .facts');
    ok(!/Part of/i.test(await page.locator('#panelBody .facts').innerText()), '1935: Canada is no longer part of the British Empire');
    await page.goto(BASE + '?y=1700&v=flat&em=spain');
    await waitH1(page, 'Spanish Empire');
    ok(/Viceroyalty of New Spain/.test(await page.locator('#panelBody').innerText()), '1700: the Spanish Empire panel lists New Spain as a part without a shape');

    // ---------------- state context (round 9) ----------------
    const ctxSections = async (q, h1) => {
      await page.goto(BASE + q);
      await waitH1(page, h1);
      await page.waitForSelector('#panelBody .ctx-glance', { timeout: 60000 });
      return page.evaluate(() => [...document.querySelectorAll('#panelBody details.ctx')].map((d) => d.dataset.sec));
    };
    const ussr = await ctxSections('?y=1950&v=flat&c=Soviet+Union', 'Soviet Union');
    ok(['glance', 'pop', 'gov', 'rel', 'lead'].every((k) => ussr.includes(k)), `1950: the Soviet Union panel has At a glance, Population, Government, Religion and Leaders (${ussr.join(', ')})`);
    const ussrText = await page.locator('#panelBody .ctx-wrap').innerText();
    ok(/Communist Party of the Soviet Union/.test(ussrText), '1950: the Soviet Union\'s ruling party is the CPSU');
    ok(/estimate/i.test(ussrText), 'population figures are labelled as estimates');
    await page.screenshot({ path: path.join(SHOTS, 'context-ussr-1950.png') });
    const ott = await ctxSections('?y=1600&v=flat&c=Ottoman+Empire', 'Ottoman Empire');
    ok(ott.includes('rel') && /Sunni Islam/.test(await page.locator('#panelBody .ctx-wrap').innerText()), `1600: the Ottoman panel gives Sunni Islam as official religion (${ott.join(', ')})`);
    await page.screenshot({ path: path.join(SHOTS, 'context-ottoman-1600.png') });
    const usa = await ctxSections('?y=1876&v=flat&c=United+States+of+America', 'United States of America');
    ok(usa.includes('disc') && /Telephone/.test(await page.locator('#panelBody details[data-sec=disc]').innerText()), '1876: the telephone is among the discoveries of the United States');
    const tel = await page.evaluate(async () => {
      const { eventsBetween } = await import('./js/data.js');
      const d = await eventsBetween(1876, 1876);
      return d.events.filter((e) => e.y === 1876 && e.t === 'invention' && /^Telephone$/.test(e.l)).map((e) => ({ i: e.i, p: e.p, lo: e.lo }));
    });
    ok(tel.length === 1 && tel[0].p === 'United States of America' && tel[0].lo != null, `1876: a telephone invention event placed in the United States (${JSON.stringify(tel)})`);
    if (tel.length) {
      await page.goto(BASE + '?y=1876&v=flat&e=' + tel[0].i);
      await page.waitForSelector('#panelBody .wu, #panelBody .wu-none', { timeout: 60000 });
      const evText = await page.locator('#panelBody').innerText();
      ok(/Meucci/.test(evText) && /Gray/.test(evText), 'the telephone event names Meucci and Gray');
      ok(/From Wikipedia|What happened/i.test(evText) && /Wikipedia|Source/i.test(evText), 'the telephone event shows a write-up with its source');
      await page.screenshot({ path: path.join(SHOTS, 'telephone-1876.png') });
    }
    await page.goto(BASE + '?y=1066&v=flat&e=Q83224');
    await page.waitForSelector('#panelBody .wu', { timeout: 60000 });
    const hast = await page.locator('#panelBody .wu').innerText();
    ok(/AI-written/i.test(hast) && /Sources/i.test(hast) && (await page.locator('#panelBody .wu-src li').count()) >= 2, 'Battle of Hastings: a written write-up labelled AI-written with at least two sources');

    // ---------------- before and after ----------------
    await page.goto(BASE + '?y=1900&v=flat&c=Ottoman+Empire');
    await waitH1(page, 'Ottoman Empire');
    await page.waitForSelector('#panelBody .succ h2', { timeout: 30000 });
    const succText = await page.locator('#panelBody .succ').innerText();
    ok(/Before/i.test(succText) && /Byzantine Empire/.test(succText) && /After/i.test(succText) && /Turkey/.test(succText), 'the Ottoman Empire panel has Before (Byzantine Empire) and After (Turkey)');
    await page.waitForFunction(() => /Today this is/.test(document.querySelector('#panelBody .today')?.textContent || ''), null, { timeout: 30000 });
    ok(/Turkey/.test(await page.locator('#panelBody .today').first().innerText()), '"Today this is" names Turkey for the Ottoman Empire of 1900');
    await page.locator('#panelBody .succ button', { hasText: /^Turkey$/ }).first().click();
    await waitH1(page, 'Turkey');
    const ty = await page.evaluate(() => window.__geo.state.year);
    ok(ty >= 1923 && ty <= 1925, `clicking "Turkey" under After jumps to Turkey in ${ty}`);
    await page.waitForSelector('#panelBody .succ h2', { timeout: 30000 });
    ok(/Before[\s\S]*Ottoman Empire/i.test(await page.locator('#panelBody .succ').innerText()), 'Turkey lists the Ottoman Empire under Before');
    await page.goto(BASE + '?y=1700&v=flat&mc=PL');
    await waitH1(page, 'Poland');
    await page.waitForFunction(() => /In 1700 this was/.test(document.querySelector('#panelBody .today')?.textContent || ''), null, { timeout: 30000 });
    ok(/Polish-Lithuanian Commonwealth/.test(await page.locator('#panelBody .today').first().innerText()), 'today\'s Poland: "In 1700 this was" names the Polish-Lithuanian Commonwealth');

    // ---------------- round 5: occupations, filled blanks, de facto leaders ----------------
    await page.goto(BASE + '?y=1942&v=flat');
    await waitH1(page, 'The world in 1942');
    await page.waitForFunction(() => window.__geo?.map?.map.getSource('occ') && window.__geo.map.map.querySourceFeatures('occ').length > 0, null, { timeout: 60000 }).catch(() => {});
    await waitEvents(page);
    const occ42 = await page.evaluate(() => ({ n: new Set(window.__geo.map.map.querySourceFeatures('occ').map((f) => f.properties.by)).size, t: document.querySelector('#panelBody').innerText }));
    const leg42 = await page.evaluate(() => ({ sw: document.querySelectorAll('#panelBody .hatchsw').length, wash: !!window.__geo.map.map.getLayer('occ-wash'),
      ukr: window.__geo.map.map.querySourceFeatures('occ').length, by: [...document.querySelectorAll('#panelBody .hatchsw')].map((e) => e.nextSibling.textContent).join('|') }));
    ok(leg42.sw >= 3 && leg42.wash && /by Germany/.test(leg42.by) && /by Japan/.test(leg42.by) && /occupied west of the Soviet Union/.test(occ42.t), `1942: the year panel has a hatch legend (${leg42.sw} occupiers with a swatch), the own fill is washed out under the hatch, and the occupied part of the Soviet Union is listed`);
    ok(occ42.n >= 2 && /occupied/i.test(occ42.t) && /Poland/.test(occ42.t) && /France/.test(occ42.t), `1942: occupied countries are hatched on the map (${occ42.n} occupiers) and listed in the year panel`);
    await page.goto(BASE + '?y=1942&v=flat&c=Poland');
    await waitH1(page, 'Poland');
    await page.waitForSelector('#panelBody .occ', { timeout: 30000 });
    ok(/Occupied by Germany/.test(await page.locator('#panelBody .occ').first().innerText()), '1942: the Poland panel says "Occupied by Germany" with dates and a source');
    await page.goto(BASE + '?y=1938&v=flat&c=Poland');
    await waitH1(page, 'Poland');
    await page.waitForSelector('#panelBody .facts');
    ok((await page.locator('#panelBody .occ').count()) === 0, '1938: Poland is not marked occupied');
    const p117 = await polAt(117);
    ok(p117.some((p) => /Irish kingdoms/.test(p.n) && p.u) && p117.some((p) => /Germanic peoples/.test(p.n) && p.u), 'AD 117: Ireland and Germania are labelled as peoples (italic, from the sketch maps), not left blank');
    const p1770 = await polAt(1770);
    const lou = p1770.find((p) => p.n === 'Spanish Louisiana');
    ok(lou && /Spanish/.test(lou.s), `1770: Spanish Louisiana is on the map under the Spanish Empire ("${lou?.s}")`);
    await page.goto(BASE + '?y=1935&v=flat&c=Soviet+Union');
    await waitH1(page, 'Soviet Union');
    await page.waitForFunction(() => /In office in 1935/i.test(document.querySelector('#panelBody').innerText), null, { timeout: 30000 });
    ok(/Stalin/.test(await page.locator('#panelBody').innerText()), '1935: Stalin is listed in office for the Soviet Union');

    // ---------------- time travel: the map runs through every stored map between two years ----------------
    await page.goto(BASE + '?y=1914&v=flat');
    await waitH1(page, 'The world in 1914');
    await page.waitForFunction(() => window.__geo?.travel && window.__geo.state.snapDoc, null, { timeout: 60000 });
    const runTo = async (fn) => {
      await page.evaluate((src) => {
        const g = window.__geo; const t = g.travel;
        t.full = true;   // software rendering is slow: test the full animation, not the degraded path
        window.__seen = []; window.__shown = [];
        if (!t._wrapped) { const o = t.onStep; t.onStep = (y, st) => { window.__seen.push(y); if (!st.same) window.__shown.push(y); o(y, st); }; t._wrapped = true; }
        (0, eval)(src)();
      }, fn.toString());
      await page.waitForFunction(() => !window.__geo.travel.running, null, { timeout: 240000 });
      return page.evaluate(() => ({ seen: window.__seen, shown: window.__shown, year: window.__geo.state.year, input: document.querySelector('#year').value,
        h1: document.querySelector('#panelBody h1')?.textContent, badge: document.querySelector('#badge').textContent, tr: window.__geo.travel.stats.transitions }));
    };
    const fwd = await runTo(() => window.__geo.step(10));
    await waitH1(page, 'The world in 1924');
    const want = () => [1915, 1916, 1917, 1918, 1919, 1920, 1921, 1922, 1923, 1924];
    ok(JSON.stringify(fwd.seen) === JSON.stringify(want()) && fwd.year === 1924 && fwd.input === '1924' && /1924/.test(fwd.badge),
      `+10 from 1914 runs through every yearly map in between (${fwd.seen.join(',')}; ${fwd.shown.length} animated changes) and rests on 1924`);
    const back = await runTo(() => window.__geo.step(-10));
    await waitH1(page, 'The world in 1914');
    ok(back.seen.length === 10 && back.seen[0] === 1923 && back.seen[9] === 1914 && back.year === 1914, `-10 runs backwards through ${back.seen.join(',')} and rests on 1914`);
    // Cliopatria years: only the stored change years are passed, and the end year is the one asked for
    await page.goto(BASE + '?y=1600&v=flat');
    await waitH1(page, 'The world in 1600');
    await page.waitForFunction(() => window.__geo?.travel && window.__geo.state.snapDoc, null, { timeout: 60000 });
    const romeStops = await page.evaluate(() => window.__geo.stopsBetween(1600, 1480).length);
    const rome = await runTo(() => window.__geo.travelTo(1480));
    ok(rome.year === 1480 && rome.seen.length === romeStops && rome.seen.length >= 10 && rome.seen.every((y, i) => !i || y < rome.seen[i - 1]),
      `1600 -> 1480 passes all ${rome.seen.length} change years of the Cliopatria maps in order (${rome.shown.length} animated) and rests on 1480`);
    await waitH1(page, 'The world in 1480');
    // play and pause
    await page.goto(BASE + '?y=1989&v=flat');
    await waitH1(page, 'The world in 1989');
    await page.waitForFunction(() => window.__geo?.travel && window.__geo.state.snapDoc, null, { timeout: 60000 });
    await page.evaluate(() => { window.__geo.travel.full = true; });
    await page.selectOption('#speedSel', '5');
    await page.click('#playBtn');
    await page.waitForFunction(() => window.__geo.state.year >= 1992, null, { timeout: 120000 });
    ok((await page.getAttribute('#playBtn', 'aria-pressed')) === 'true', 'play runs (the button shows pause)');
    await page.click('#playBtn');
    await page.waitForFunction(() => !window.__geo.travel.running, null, { timeout: 60000 });
    const paused = await page.evaluate(() => ({ y: window.__geo.state.year, snap: window.__geo.state.snap?.y, key: window.__geo.state.snapDoc?.year }));
    await waitH1(page, `The world in ${paused.y}`);
    ok(paused.y >= 1992 && paused.snap === paused.y, `pause rests on a year with its own map (${paused.y}, map ${paused.snap})`);
    // the timeline dragged far: it may take larger steps, but ends on the year of the thumb
    const scrub = await runTo(() => { const s = document.querySelector('#slider'); s.value = 2560; s.dispatchEvent(new Event('input')); });
    const scrubY = await page.evaluate(() => (window.__geo.state.year));
    ok(scrub.seen.length >= 1 && scrub.seen.length <= 5 && scrubY === scrub.year, `dragging the timeline from ${paused.y} to ${scrubY} animates ${scrub.seen.length} steps (coarser when far) and ends on the thumb's year`);

    {
    // ---------------- round 8: only changed land animates; next/previous change; timeline ticks ----------------
    await page.goto(BASE + '?y=1990&v=flat');
    await waitH1(page, 'The world in 1990');
    await page.waitForFunction(() => window.__geo?.travel && window.__geo.state.snapDoc, null, { timeout: 60000 });
    await page.evaluate(() => { window.NOPAD = 1; window.__geo.map.map.jumpTo({ center: [60, 50], zoom: 2 }); });
    await page.waitForTimeout(2500);
    // a fixed spot in China (unchanged in 1991-1992) and the map's stack opacities, sampled through the change
    const spot = await page.evaluate(() => { const p = window.__geo.map.map.project([104, 33]); return [Math.round(p.x), Math.round(p.y)]; });
    const mbox = await page.locator("#map").boundingBox();
    await page.evaluate(() => { const t = window.__geo.travel; t.full = true; t.durScale = 6; window.__mid = []; window.__geo.travelTo(1992); });
    const px = [];
    const opac = [];
    const fxSeen = { a: new Set(), e: new Set(), o: new Set() };
    for (let i = 0; i < 8; i++) {
      const buf = await page.screenshot({ clip: { x: mbox.x + spot[0], y: mbox.y + spot[1], width: 2, height: 2 } });
      px.push(buf.toString('base64'));
      opac.push(await page.evaluate(() => { const M = window.__geo.map, m = M.map; return ['A', 'B', 'C'].map((s) => m.getPaintProperty('fill0' + s, 'fill-opacity')).join(','); }));
      const st = await page.evaluate(() => { const m = window.__geo.map.map; const out = []; for (let j = 0; j < 40; j++) { out.push(m.getFeatureState({ source: 'fx', id: j }), m.getFeatureState({ source: 'leave', id: j })); } return out; });
      for (const x of st) for (const k of ['a', 'e', 'o']) if (typeof x[k] === 'number') fxSeen[k].add(x[k]);
      await page.waitForTimeout(250);
    }
    await page.waitForFunction(() => !window.__geo.travel.running, null, { timeout: 120000 });
    const lc = await page.evaluate(() => ({ ...window.__geo.map.lastChange, n: window.__geo.state.snapDoc.features.length }));
    ok(new Set(px).size === 1, `while 1991 -> 1992 runs, unchanged land (China) never changes colour (${new Set(px).size} distinct samples in ${px.length})`);
    ok(opac.every((o) => o.split(',').every((v) => v === '0' || v === '1')), `stacks are only ever fully on or off, never cross-faded (${[...new Set(opac)].join(' | ')})`);
    ok(lc.gained >= 10 && lc.lost >= 1 && lc.gained < lc.n / 3, `1992: only the changed territories animate (${lc.lost} old shapes leave, ${lc.gained} of ${lc.n} new shapes settle in)`);
    const mid = (set) => [...set].filter((v) => v > 0 && v < 1).length;
    const ez = await page.evaluate(() => { const c = window.__geo.map.lastChange; return { e: c.eases?.size || 0, f: c.fades?.size || 0, seen: 0 }; });
    ok(ez.e >= 3 && ez.f >= 1, `1992: changed land eases in steps, no blinking (outline passed through ${ez.e} in-between values, the leaving land's fade ${ez.f}; sampled on screen: ${mid(fxSeen.e) + mid(fxSeen.o) + mid(fxSeen.a)})`);
    const calm = await page.evaluate(() => { const m = window.__geo.map.map; return { pop: !!m.getLayer('fx-pop') || !!m.getLayer('fx-line'), us: m.getPaintProperty('us-flash', 'line-color'), edge: JSON.stringify(m.getPaintProperty('fx-edge', 'line-color')) }; });
    ok(!calm.pop && !/^#fff/i.test(calm.us) && calm.edge === '["get","ce"]', `no white flash layers; the outline of changed land is in the new owner's colour (${calm.edge}, US ${calm.us})`);
    await page.evaluate(() => { window.__geo.travel.durScale = 1; });
    await page.goto(BASE + '?y=1938&v=flat');
    await waitH1(page, 'The world in 1938');
    await page.waitForFunction(() => window.__geo?.travel && window.__geo.state.snapDoc, null, { timeout: 60000 });
    const key38 = await page.evaluate(() => window.__geo.state.snapDoc.key);
    await page.click('#nextChange');
    await page.waitForFunction(() => window.__geo.state.year > 1938 && !window.__geo.travel.running, null, { timeout: 60000 });
    const nc = await page.evaluate(() => ({ y: window.__geo.state.year, key: window.__geo.state.snapDoc.key }));
    ok(nc.y >= 1939 && nc.key !== key38, `"Next change" goes from 1938 to ${nc.y}, the next year whose borders differ`);
    await page.click('#prevChange');
    await page.waitForFunction((y) => window.__geo.state.year < y && !window.__geo.travel.running, nc.y, { timeout: 60000 });
    ok(await page.evaluate(() => window.__geo.state.year) === nc.y - 1, '"Previous change" goes back to the last year of the earlier borders');
    const tk = await page.evaluate(() => [...document.querySelectorAll('#ticks b')].map((b) => b.textContent));
    ok(tk.length >= 8 && tk.some((t) => / BC$/.test(t)) && tk.some((t) => /^AD /.test(t)) && tk.includes('1900'), `the timeline has labelled ticks (${tk.join(', ')})`);
    ok((await page.locator('[data-step]').count()) === 0 && (await page.locator('#speedSel option').count()) === 4, 'no +1/+10/+100 buttons; one speed control with 4 named speeds');

    // ---------------- round 8: war on the map and the key ----------------
    await page.goto(BASE + '?y=1916&v=flat');
    await waitH1(page, 'The world in 1916');
    await waitEvents(page);
    await page.waitForSelector('.warmk', { timeout: 30000 });
    const wm = await page.evaluate(() => ({ all: document.querySelectorAll('.warwrap').length, shown: [...document.querySelectorAll('.warwrap')].filter((e) => getComputedStyle(e).display !== 'none').length,
      edge: window.__geo.map.map.getLayoutProperty('war-edge', 'visibility'), wars: [...document.querySelectorAll('#key .kwars button')].map((b) => b.textContent) }));
    ok(wm.shown >= 3 && wm.shown <= 11 && wm.all <= 27, `1916: ${wm.shown} war markers at world zoom (of ${wm.all}, capped)`);
    ok(wm.edge === 'visible' && wm.wars.some((w) => /World War I/.test(w)), `1916: land with battles is edged in red and the key names the major wars (${wm.wars.slice(0, 3).join(', ')})`);
    const bt = page.locator('.warwrap:not(.minor) .warmk.battle').first();
    const btName = await bt.getAttribute('aria-label');
    await bt.evaluate((el) => el.click());
    await page.waitForFunction(() => /Battle/.test(document.querySelector('#panelBody .kicker')?.textContent || ''), null, { timeout: 30000 });
    const btText = await page.locator('#panelBody').innerText();
    ok(/Part of/i.test(btText) && (await page.evaluate(() => window.__geo.state.year)) === 1916, `clicking a battle marker opens it in 1916 with its war ("${btName.slice(0, 60)}")`);
    ok(await page.locator('#key .key-toggle').isVisible() && /present-day successor|today's country's flag/.test(await page.locator('#key').innerText()) && /Badge = the flag at the time/.test(await page.locator('#key').innerText()) && /Occupied/.test(await page.locator('#key').innerText()), 'the map key is visible and explains states, empires, occupation, war and events');
    await page.locator('#key input[type=checkbox]').uncheck();
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => [...document.querySelectorAll('.warwrap')].every((e) => getComputedStyle(e).display === 'none') && window.__geo.map.map.getLayoutProperty('war-edge', 'visibility') === 'none'), 'the key turns the war layer off');
    await page.locator('#key input[type=checkbox]').check();
    await page.click('#key .key-toggle');
    ok(await page.locator('#keyBody').isHidden(), 'the key collapses');
    await page.click('#key .key-toggle');
    }
    // ---------------- flags: fills from today's country's flag, badges with the flag at the time ----------------
    const { page: fp, errors: fErr, ctx: fCtx } = await newPage(browser, { width: 1280, height: 800 });
    const atYear = async (y, view) => {
      await fp.goto(BASE + '?y=' + y);
      await waitH1(fp, 'The world in ' + y);
      await fp.waitForFunction((yy) => window.__geo?.state.year === yy && window.__geo.state.snapDoc && window.__geo.map?.ready, y, { timeout: 60000 });
      if (view) await fp.evaluate((v) => window.__geo.map.map.jumpTo(v), view);
      await fp.waitForFunction(() => window.__geo.map.badgeCount > 0, null, { timeout: 30000 }).catch(() => {});
      await fp.waitForTimeout(3000);
      // badges placed on screen (each layer on its own: MapLibre can throw on a query across layers while a
      // symbol source is being replaced; then ask again)
      let last = [];
      for (let i = 0; i < 20; i++) {
        try {
          last = await fp.evaluate(() => ['badge-lo', 'badge-hi'].flatMap((l) => window.__geo.map.map.queryRenderedFeatures({ layers: [l] }))
            .map((f) => ({ n: f.properties.n, id: f.properties.id, a: f.properties.a, file: window.__geo.flagFor(f.properties.n, window.__geo.state.year)?.file || '' })));
          if (last.length) return last;
        } catch (e) { if (i > 15) throw e; }
        await fp.waitForTimeout(1000);   // badges come in once the map rests and the era's sheet is loaded
      }
      return last;
    };
    const world = { center: [40, 35], zoom: 1.6 };
    const b50 = await atYear(1950, world);
    ok(b50.some((b) => b.n === 'Soviet Union' && /Soviet Union/.test(b.file)), `1950 at world zoom: the Soviet Union has a badge with the Soviet flag (${b50.length} badges: ${b50.slice(0, 6).map((b) => b.n).join(', ')})`);
    ok(b50.length <= 12 && b50.every((b) => b.a >= 400000), `1950 at world zoom: badges only on large states, at most 12 (${b50.length}; smallest ${Math.min(...b50.map((b) => b.a))} km2)`);
    const nb = await fp.evaluate(() => {
      const d = window.__geo.state.snapDoc; let pairs = 0, bad = 0, min = 9;
      for (const [i, js] of d.adj) for (const j of js) {
        const a = d.groups[i], b = d.groups[j];
        if (i >= j || a.kind === 'region' || b.kind === 'region') continue;
        pairs++; const dd = window.__geo.hexDist(a.color, b.color); min = Math.min(min, dd); if (a.color === b.color || dd < 0.08) bad++;
      }
      const ru = d.groups.find((g) => g.name === 'Soviet Union');
      return { pairs, bad, min: Math.round(min * 1000) / 1000, ru: ru && ru.iso };
    });
    ok(nb.pairs > 100 && nb.bad === 0 && nb.ru === 'RU', `1950: all ${nb.pairs} neighbouring fills differ (closest pair ${nb.min} in OKLab), the Soviet Union is filled from Russia's flag (${nb.ru})`);
    await fp.evaluate(() => window.__geo.selectPolityByName('Soviet Union', { fly: false }));
    await fp.waitForSelector('#panelBody .flagbox img', { timeout: 30000 });
    ok(/Soviet Union/.test(await fp.locator('#panelBody .flagbox').innerText()) && /shown for 19\d\d to 19\d\d/.test(await fp.locator('#panelBody .flagbox').innerText()), 'the Soviet Union panel shows its flag larger, with its name and years');
    const europe = { center: [14, 50], zoom: 3.6 };
    const b40 = await atYear(1940, europe);
    ok(b40.some((b) => b.n === 'Germany' && /Flag of Germany \(1935–1945\)/.test(b.file)), `1940 in Europe: Germany's badge is the swastika flag of 1935 to 1945 (${b40.map((b) => b.n).join(', ')})`);
    const sw = (bs) => bs.filter((b) => /1935–1945/.test(b.file)).length;
    const b30 = await atYear(1930, europe);
    const f30 = await fp.evaluate(() => window.__geo.flagFor('Germany', 1930)?.file || '');
    ok(sw(b30) === 0 && /3-2/.test(f30), `1930: no swastika flag; Germany's badge is the Weimar black-red-gold (${f30})`);
    const b46 = await atYear(1946, europe);
    ok(sw(b46) === 0, `1946: no swastika flag on the map (${b46.length} badges)`);
    const b00 = await atYear(1900, world);
    ok(b00.some((b) => b.n === 'Russian Empire' && /Flag of Russia/.test(b.file)), `1900 at world zoom: the Russian Empire has a badge with its flag (${b00.map((b) => b.n).join(', ')})`);
    ok(b00.every((b) => b.a >= 400000) && !b00.some((b) => /Luxembourg|Belgium|Netherlands|Switzerland|Denmark/.test(b.n)), '1900 at world zoom: no badge on small states');
    ok(fErr.length === 0, `no console errors on the flag checks${fErr.length ? ': ' + fErr.slice(0, 3).join(' | ') : ''}`);

    ok(errors.length === 0, `no console errors on desktop${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);

    // reduced motion: no animation, the year changes at once
    {
      const ctxR = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      const pr = await ctxR.newPage();
      const errR = [];
      pr.on('console', (m) => { if (m.type() === 'error') errR.push(m.text()); });
      pr.on('pageerror', (e) => errR.push(String(e)));
      await pr.goto(BASE + '?y=1914&v=flat');
      await waitH1(pr, 'The world in 1914');
      await pr.waitForFunction(() => window.__geo?.travel && window.__geo.state.snapDoc, null, { timeout: 60000 });
      await pr.evaluate(() => window.__geo.step(10));
      await waitH1(pr, 'The world in 1924');
      await pr.waitForFunction(() => window.__geo.state.snapDoc?.year === 1924, null, { timeout: 60000 });
      const r = await pr.evaluate(() => ({ tr: window.__geo.travel.stats.transitions, running: window.__geo.travel.running }));
      ok(r.tr === 0 && !r.running, `with reduced motion +10 jumps straight to 1924 (${r.tr} animated steps)`);
      await pr.click('#nextChange');
      await pr.waitForFunction(() => window.__geo.state.year > 1924 && document.querySelector('#panelBody h1')?.textContent === `The world in ${window.__geo.state.year}`, null, { timeout: 60000 });
      const rn = await pr.evaluate(() => ({ y: window.__geo.state.year, tr: window.__geo.travel.stats.transitions }));
      ok(rn.tr === 0, `with reduced motion "Next change" jumps at once to the next year with a border change (${rn.y})`);
      ok(errR.length === 0, `no console errors with reduced motion${errR.length ? ': ' + errR.slice(0, 3).join(' | ') : ''}`);
      await ctxR.close();
    }

    // ---------------- round 11: flag fill (today's successor's flag over the land), badges stay the flag of the time ----------------
    const fillAt = (lon, lat) => fp.evaluate(([x, y]) => window.__geo.map.fillAt(x, y), [lon, lat]);
    const waitFill = () => fp.waitForFunction(() => { const M = window.__geo.map; return M._flagOn(M.active); }, null, { timeout: 30000 }).catch(() => {});
    const r50 = await atYear(1950, world); await waitFill();
    const ru50 = await fillAt(37.6, 55.75);
    ok(ru50?.on && ru50.key === 'm:RU' && r50.some((b) => b.n === 'Soviet Union' && /Soviet Union/.test(b.file)), `1950: Moscow (${ru50?.name}) is drawn with the Russian flag fill (${ru50?.key}) and the Soviet Union keeps its Soviet badge`);
    await fp.screenshot({ path: path.join(SHOTS, 'flagfill-1950.png') });
    const r40 = await atYear(1940, europe); await waitFill();
    const de40 = await fillAt(13.4, 52.5);
    ok(de40?.on && de40.key === 'm:DE' && r40.some((b) => b.n === 'Germany' && /1935–1945/.test(b.file)), `1940: Berlin (${de40?.name}) has the German flag fill (${de40?.key}) and the swastika badge`);
    await atYear(1900, world); await waitFill();
    const in00 = await fillAt(77.2, 28.6);
    ok(in00?.on && in00.key === 'm:GB', `1900: Delhi (${in00?.name}) is drawn with the UK flag fill (${in00?.key})`);
    const ah00 = await fillAt(16.37, 48.2);
    ok(ah00?.on && /^h:/.test(ah00.key || ''), `1900: Vienna (${ah00?.name}), with no obvious successor, is filled with its own flag of the time (${ah00?.key})`);
    await fp.locator('#key .key-toggle[aria-expanded="false"]').click().catch(() => {});
    await fp.locator('#key .kseg button', { hasText: 'Plain colours' }).click();
    await fp.waitForTimeout(600);
    const plain = await fillAt(77.2, 28.6);
    await fp.locator('#key .kseg button', { hasText: 'Flag fill' }).click();
    await waitFill();
    const flagBack = await fillAt(77.2, 28.6);
    ok(plain && !plain.on && flagBack?.on, `the key switches between flag fill and plain colours (plain: flags ${plain?.on ? 'on' : 'off'}; flag fill: ${flagBack?.on ? 'on' : 'off'})`);
    ok(fErr.length === 0, `no console errors with flag fill${fErr.length ? ': ' + fErr.slice(0, 3).join(' | ') : ''}`);

    // ---------------- round 11: the year panel opens with the year itself ----------------
    for (const [q, label] of [['2009', '2009'], ['1969', '1969'], ['1914', '1914'], ['1492', '1492'], ['AD 800', '800'], ['300 BC', '300 BC']]) {
      await fp.goto(BASE + '?y=' + encodeURIComponent(q));
      await waitH1(fp, 'The world in ' + label);
      await fp.waitForSelector('#panelBody .yearhead', { timeout: 60000 });
      const yh = await fp.evaluate(() => {
        const b = document.querySelector('#panelBody');
        const head = b.querySelector('.yearhead'), ctxH = b.querySelector('h2.context');
        return { y: +head.querySelector('.yh-top')?.dataset.y, date: head.querySelector('.yh-date')?.textContent || '', year: window.__geo.state.year,
          first: [...b.children].findIndex((n) => n.classList.contains('yearhead')), ctx: ctxH ? [...b.children].indexOf(ctxH) : -1, ctxText: ctxH?.textContent || '' };
      });
      const dateYear = (yh.date.match(/(\d+(?: BC)?)(?: to .*)?$/) || [])[1];
      ok(yh.y === yh.year && dateYear === label && yh.first >= 0 && (yh.ctx < 0 || yh.ctx > yh.first),
        `${label}: the first headline is dated in ${label} itself ("${yh.date}"), and the overview comes after it under "${yh.ctxText}"`);
    }
    await fp.goto(BASE + '?y=5000%20BC');
    await waitH1(fp, 'The world in 5,000 BC');
    await fp.waitForSelector('#panelBody .yearhead', { timeout: 60000 });
    ok(/No major recorded events for 5,000 BC in this dataset/.test(await fp.locator('#panelBody .yearhead').innerText()), 'a year with no events of its own says so plainly before any overview');
    await fCtx.close();

    }   // end of the desktop checks
    // ---------------- reader suggestions and the hidden admin page (E2E_ONLY=suggest runs only these) ----------------
    // Firebase is replaced by small fake modules served in place of Google's CDN files, so the real js/cloud.js and
    // js/core.js run, and the two callables answer like the backend does (see functions/src/geo.js in backend-combination).
    if (!ONLY || ONLY === 'suggest') {
      const FAKE_SDK = {
        'firebase-app.js': 'export function initializeApp(o, name) { return { options: o, name: name || "[DEFAULT]" }; }',
        'firebase-app-check.js': 'export function initializeAppCheck() { window.__fake.appCheck = true; return {}; } export class ReCaptchaEnterpriseProvider { constructor(k) { window.__fake.siteKey = k; } }',
        'firebase-firestore.js': 'export const initializeFirestore = () => ({}); export const getFirestore = () => ({}); export const persistentLocalCache = () => ({}); export const persistentMultipleTabManager = () => ({}); export const connectFirestoreEmulator = () => {};',
        'firebase-functions.js': 'export const getFunctions = () => ({}); export const connectFunctionsEmulator = () => {}; export function httpsCallable(_f, name) { return async (data) => ({ data: await window.__fake.call(name, data) }); }',
        'firebase-auth.js': `const L = new Set();
          const wrap = (u) => u && { uid: u.uid, displayName: u.name || '', email: u.email || '', photoURL: '', emailVerified: true, providerData: [{ providerId: 'google.com' }] };
          const tell = () => { for (const cb of [...L]) cb(wrap(window.__fake.user)); };
          export const getAuth = () => ({});
          export function onAuthStateChanged(_a, cb) { L.add(cb); setTimeout(() => cb(wrap(window.__fake.user)), 0); return () => L.delete(cb); }
          export const getRedirectResult = async () => null;
          export class GoogleAuthProvider { setCustomParameters() {} }
          export async function signInWithPopup() { window.__fake.user = window.__fake.nextUser; tell(); return { user: wrap(window.__fake.user) }; }
          export async function signInWithRedirect() {}
          export async function signOut() { window.__fake.user = null; tell(); }
          export const connectAuthEmulator = () => {};`,
      };
      const fakeInit = () => {
        const err = (code, message) => Object.assign(new Error(message), { code: 'functions/' + code });
        const day = 86400e3, t0 = Date.parse('2026-11-20T10:00:00Z');
        window.__fake = {
          calls: [], user: null, fail: null, admins: ['ownerUid12345'], nextUser: { uid: 'readerUid987', email: 'reader@example.com' },
          store: [
            { id: 'aaaaaaaaaaaa1', text: 'The Battle of Long Island (27 August 1776) is missing from the year.', place: 'Brooklyn', date: '27 August 1776', year: 1776, subject: { kind: 'polity', id: 'United States', name: 'United States' }, sourceUrl: 'https://en.wikipedia.org/wiki/Battle_of_Long_Island', email: 'reader@example.com', status: 'new', note: '', createdAt: t0 + 3 * day },
            { id: 'aaaaaaaaaaaa2', text: 'Tupac Amaru II led a great revolt in Peru.', place: 'Cusco', date: '1780', year: 1780, subject: null, sourceUrl: '', email: '', status: 'added', note: 'Added 28 Nov.', createdAt: t0 + 2 * day },
            { id: 'aaaaaaaaaaaa3', text: 'The Library of Alexandria burned in 48 BC.', place: 'Alexandria', date: '48 BC', year: -48, subject: { kind: 'event', id: 'Q435', name: 'Library of Alexandria' }, sourceUrl: '', email: '', status: 'reviewing', note: '', createdAt: t0 + day },
          ],
          async call(name, data) {
            this.calls.push({ name, data: JSON.parse(JSON.stringify(data)) });
            if (name === 'geoSuggest') { if (this.fail) throw err('resource-exhausted', this.fail); return { ok: true }; }
            if (!this.user) throw err('unauthenticated', 'Sign in first.');
            if (!this.admins.includes(this.user.uid)) throw err('permission-denied', 'Not an admin.');
            const s = this.store.find((x) => x.id === data.id);
            if (data.action === 'update') { if (data.status) s.status = data.status; if (data.note !== undefined) s.note = data.note; return { ok: true, id: s.id, status: s.status, note: s.note }; }
            if (data.action === 'delete') { this.store = this.store.filter((x) => x !== s); return { ok: true, id: data.id }; }
            const q = (data.q || '').toLowerCase();
            const items = this.store.filter((x) => (!data.status || x.status === data.status) && (data.yearFrom == null || x.year >= data.yearFrom)
              && (data.yearTo == null || x.year <= data.yearTo) && (!q || (x.text + ' ' + x.place).toLowerCase().includes(q))).sort((a, b) => b.createdAt - a.createdAt);
            const counts = { all: this.store.length };
            for (const k of ['new', 'reviewing', 'added', 'rejected']) counts[k] = this.store.filter((x) => x.status === k).length;
            return { items: JSON.parse(JSON.stringify(items)), cursor: null, counts };
          },
        };
      };
      const sctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
      await sctx.addInitScript(fakeInit);
      await sctx.route('https://www.gstatic.com/firebasejs/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: FAKE_SDK[r.request().url().split('/').pop()] || 'export {};' }));
      const sp = await sctx.newPage();
      const sErr = [], reqs = [];
      sp.on('console', (m) => { if (m.type() === 'error') sErr.push(m.text()); });
      sp.on('pageerror', (e) => sErr.push(String(e)));
      sp.on('request', (r) => reqs.push(r.url()));
      const cloudish = () => reqs.filter((u) => /\/js\/(cloud|core|config|suggest|admin)\.js|gstatic\.com/.test(u));
      const fake = (fn) => sp.evaluate(fn);
      await sp.goto(BASE + '?y=1776');
      await waitH1(sp, 'The world in 1776');
      await waitEvents(sp);
      await sp.waitForSelector('#panelBody > details.suggest', { timeout: 60000 });
      const last = await sp.evaluate(() => document.querySelector('#panelBody').lastElementChild?.matches('details.suggest:not([open])'));
      ok(last && cloudish().length === 0, `the 1776 panel ends with a closed "Suggest something we missed" box, and the page has loaded no Firebase code (${cloudish().length} requests)`);

      // open it: the form, prefilled with the year, and only now the Firebase code
      await sp.click('#panelBody details.suggest > summary');
      await sp.waitForSelector('#panelBody .sg-form', { timeout: 20000 });
      const f0 = await sp.evaluate(() => {
        const f = document.querySelector('#panelBody .sg-form');
        const hp = f.querySelector('.sg-hp'), r = hp.getBoundingClientRect();
        return { date: f.querySelector('input[name=date]').value, about: f.querySelector('.sg-about').textContent, labels: [...f.querySelectorAll('label')].map((l) => l.textContent),
          hpHidden: hp.getAttribute('aria-hidden') === 'true' && r.right < 0 && f.querySelector('input[name=website]').tabIndex === -1, privacy: f.querySelector('.sg-privacy').textContent };
      });
      ok(f0.date === '1776' && /The world in 1776/.test(f0.about), `the form is prefilled with the year shown (${f0.date}) and says what it is about ("${f0.about}")`);
      ok(f0.labels.some((l) => /What happened\? \(required\)/.test(l)) && f0.labels.filter((l) => /\(optional\)/.test(l)).length === 4 && f0.labels.some((l) => /email.*\(optional\)/i.test(l)),
        'it has the required "what happened" field and four optional ones (place, date, source link, email marked optional)');
      ok(f0.hpHidden && /address on the internet is not stored/.test(f0.privacy) && /Privacy policy/.test(f0.privacy), 'the honeypot field is off screen and out of the tab order; a plain privacy note sits above the button');
      await sp.waitForFunction(() => window.__fake && performance.getEntriesByType('resource').some((r) => /gstatic\.com\/firebasejs/.test(r.name)), null, { timeout: 20000 }).catch(() => {});
      ok(cloudish().some((u) => /suggest\.js/.test(u)) && cloudish().some((u) => /cloud\.js/.test(u)) && cloudish().some((u) => /gstatic\.com\/firebasejs/.test(u)), 'opening the form loads js/suggest.js, then js/cloud.js and the Firebase SDK');

      // validation: nothing is sent while it is wrong
      const sg = (sel) => sp.locator('#panelBody .sg-form ' + sel);
      await sg('.sg-send').click();
      const e1 = await sg('.sg-err:not([hidden])').allInnerTexts();
      await sg('textarea').fill('too short');
      await sg('.sg-send').click();
      const e2 = await sg('.sg-err:not([hidden])').allInnerTexts();
      await sg('textarea').fill('  The Battle of Long Island, fought on 27 August 1776, is not on the map.  ');
      await sg('input[name=sourceUrl]').fill('not a link');
      await sg('input[name=email]').fill('nobody@');
      await sg('.sg-send').click();
      const e3 = await sg('.sg-err:not([hidden])').allInnerTexts();
      const sent0 = await fake(() => window.__fake.calls.filter((c) => c.name === 'geoSuggest').length);
      ok(/at least 10 characters/.test(e1.join()) && /at least 10 characters/.test(e2.join()) && e3.some((t) => /web address/.test(t)) && e3.some((t) => /email address/.test(t)) && sent0 === 0,
        `empty, too short, a bad link and a bad email are each refused before sending (${e3.length} messages on the last try, ${sent0} sent)`);
      // a good one is sent, once, and thanked
      await sg('input[name=sourceUrl]').fill('https://en.wikipedia.org/wiki/Battle_of_Long_Island');
      await sg('input[name=email]').fill('');
      await sg('input[name=place]').fill('Brooklyn');
      await sp.screenshot({ path: path.join(SHOTS, 'suggest-form.png') });
      await sg('.sg-send').click();
      await sp.waitForSelector('#panelBody .sg-done', { timeout: 20000 });
      const c1 = await fake(() => window.__fake.calls.filter((c) => c.name === 'geoSuggest'));
      const d1 = c1[0]?.data || {};
      ok(c1.length === 1 && d1.text === 'The Battle of Long Island, fought on 27 August 1776, is not on the map.' && d1.year === 1776 && d1.subject === null && d1.place === 'Brooklyn'
        && d1.sourceUrl === 'https://en.wikipedia.org/wiki/Battle_of_Long_Island' && d1.hp === '' && d1.email === '' && d1.ms >= 3000,
      `a good suggestion goes to geoSuggest once, with the year, place, link, an empty honeypot and the time on the form (${d1.ms} ms)`);
      ok(/Thank you\. Your suggestion has been sent\./.test(await sp.locator('#panelBody .sg-done').innerText()), 'the reader sees a thank-you message');
      // a refusal from the server is shown, and the form stays filled
      await sp.click('#panelBody .sg-done button');
      await fake(() => { window.__fake.fail = 'We cannot take more suggestions from here today. Thank you, and please try again tomorrow.'; });
      await sg('textarea').fill('Another missing event, the Siege of Boston ended in March.');
      await sg('.sg-send').click();
      await sp.waitForSelector('#panelBody .sg-status.err', { timeout: 20000 });
      ok(/try again tomorrow/.test(await sg('.sg-status').innerText()) && (await sg('textarea').inputValue()).startsWith('Another'), 'a refusal from the server (daily limit) is shown and what was typed is kept');
      await fake(() => { window.__fake.fail = null; });

      // a state panel and an event panel send their subject
      for (const [url, h1t, kind, id] of [['?y=1700&c=' + encodeURIComponent('Qing Dynasty'), 'Qing Dynasty', 'polity', 'Qing Dynasty'],
        ['?y=1776&e=Q127912', null, 'event', 'Q127912']]) {
        await sp.goto(BASE + url);
        if (h1t) await waitH1(sp, h1t); else await sp.waitForFunction(() => /Declaration/.test(document.querySelector('#panelBody h1')?.textContent || ''), null, { timeout: 60000 });
        await sp.waitForSelector('#panelBody > details.suggest', { timeout: 60000 });
        await sp.click('#panelBody details.suggest > summary');
        await sp.waitForSelector('#panelBody .sg-form', { timeout: 20000 });
        const about = await sg('.sg-about').innerText();
        const date = await sg('input[name=date]').inputValue();
        await sg('textarea').fill(`Something missing about ${id}, written by the end-to-end test.`);
        await sg('.sg-send').click();
        await sp.waitForSelector('#panelBody .sg-done', { timeout: 20000 });
        const d = (await fake(() => window.__fake.calls.filter((c) => c.name === 'geoSuggest'))).at(-1).data;
        ok(d.subject?.kind === kind && d.subject?.id === id && (kind === 'event' ? /4 July 1776/.test(date) && d.year === 1776 : date === '1700' && d.year === 1700),
          `the ${kind} panel's form is about "${about.replace(/^About: /, '')}" and sends subject ${d.subject?.kind}:${d.subject?.id}, date "${date}"`);
      }

      // the hidden door: "lavafoundry" three times in the search box, then a triple-click on "The"
      await sp.goto(BASE + '?y=1776');
      await waitH1(sp, 'The world in 1776');
      await sp.locator('#panelBody h1 .the').click({ clickCount: 3 });
      await sp.waitForTimeout(800);
      ok(!/admin\.html/.test(sp.url()), 'a triple-click on "The" does nothing until the search box has been given the word');
      for (let i = 0; i < 3; i++) { await sp.fill('#q', ''); await sp.locator('#q').pressSequentially('lavafoundry', { delay: 5 }); }
      await sp.fill('#q', '');
      await sp.locator('#panelBody h1 .the').click({ clickCount: 3 });
      await sp.waitForURL(/admin\.html$/, { timeout: 15000 }).catch(() => {});
      ok(/admin\.html$/.test(sp.url()), 'three separate "lavafoundry" entries, then a triple-click on "The", open admin.html');
      await sp.goto(BASE + '?y=1914');
      await waitH1(sp, 'The world in 1914');
      await sp.fill('#q', 'lavafoundrylavafoundrylavafoundry');
      await sp.locator('#panelBody h1 .the').click({ clickCount: 3 });
      await sp.waitForURL(/admin\.html$/, { timeout: 15000 }).catch(() => {});
      ok(/admin\.html$/.test(sp.url()), '"lavafoundrylavafoundrylavafoundry" typed in one go also arms it');

      // admin.html: a signed-in account that is not on the list sees only its own id
      await sp.waitForFunction(() => !document.querySelector('#signIn').disabled, null, { timeout: 20000 });
      await sp.click('#signIn');
      await sp.waitForSelector('#denied:not([hidden])', { timeout: 20000 });
      const den = await sp.locator('#denied').innerText();
      ok(/Not an admin\. Your account id is readerUid987/.test(den) && await sp.locator('#app').isHidden() && !(await sp.locator('.card').count()),
        'a signed-in account that is not an admin sees "Not an admin. Your account id is readerUid987" and no suggestions');
      // the owner: list, counts, filters, status, note, map link
      await fake(() => { window.__fake.nextUser = { uid: 'ownerUid12345', email: 'owner@example.com' }; });
      await sp.click('#signOut');
      await sp.waitForSelector('#gate:not([hidden])');
      await sp.click('#signIn');
      await sp.waitForSelector('#app:not([hidden]) .card', { timeout: 20000 });
      const cards = await sp.locator('.card .txt').allInnerTexts();
      const cl = await sp.locator('#countLine').innerText();
      ok(cards.length === 3 && /Long Island/.test(cards[0]) && /Alexandria/.test(cards[2]) && /3 in all · 1 new · 1 reviewing · 1 added · 0 rejected/.test(cl), `the owner sees every suggestion, newest first, with counts ("${cl}")`);
      const first = sp.locator('.card').first();
      const href = await first.locator('a.map').getAttribute('href');
      const src = await first.locator('dd a[href^="https://en.wikipedia"]').count();
      const mail = await first.locator('a[href="mailto:reader@example.com"]').count();
      ok(href === './?y=1776&c=United+States' && src === 1 && mail === 1, `each item shows its links: source, reply email, and "View on map" (${href})`);
      const ev = await sp.locator('.card').nth(2).locator('a.map').getAttribute('href');
      ok(ev === './?y=-48&e=Q435', `an event suggestion's map link opens that event (${ev})`);
      await sp.click('#statusSeg button[data-status="added"]');
      await sp.waitForFunction(() => document.querySelectorAll('.card').length === 1, null, { timeout: 10000 }).catch(() => {});
      const added = await sp.locator('.card .txt').allInnerTexts();
      await sp.click('#statusSeg button[data-status="all"]');
      await sp.waitForFunction(() => document.querySelectorAll('.card').length === 3, null, { timeout: 10000 }).catch(() => {});
      await sp.fill('#yFrom', '1700'); await sp.fill('#yTo', '1800');
      await sp.waitForFunction(() => document.querySelectorAll('.card').length === 2, null, { timeout: 10000 }).catch(() => {});
      const ranged = await sp.locator('.card').count();
      await sp.fill('#yFrom', ''); await sp.fill('#yTo', ''); await sp.fill('#q', 'cusco');
      await sp.waitForFunction(() => document.querySelectorAll('.card').length === 1, null, { timeout: 10000 }).catch(() => {});
      const found = await sp.locator('.card .txt').allInnerTexts();
      ok(added.length === 1 && /Tupac/.test(added[0]) && ranged === 2 && found.length === 1 && /Tupac/.test(found[0]), 'filters work: by status (Added), by year range (1700-1800: 2) and by text ("cusco")');
      await sp.fill('#q', '');
      await sp.waitForFunction(() => document.querySelectorAll('.card').length === 3, null, { timeout: 10000 }).catch(() => {});
      await first.locator('.seg.small button', { hasText: 'Reviewing' }).click();
      await sp.waitForFunction(() => document.querySelector('.card .pill')?.textContent === 'Reviewing', null, { timeout: 10000 }).catch(() => {});
      await first.locator('textarea').fill('Check the date against two sources.');
      await first.locator('button', { hasText: 'Save note' }).click();
      await first.locator('.notebox .status', { hasText: 'Saved' }).waitFor({ timeout: 10000 }).catch(() => {});
      const st = await fake(() => window.__fake.store.find((x) => x.id === 'aaaaaaaaaaaa1'));
      const cl2 = await sp.locator('#countLine').innerText();
      ok(st.status === 'reviewing' && st.note === 'Check the date against two sources.' && /0 new · 2 reviewing/.test(cl2), `status buttons and the note are saved through the admin function (counts now "${cl2}")`);
      await sp.screenshot({ path: path.join(SHOTS, 'admin-desktop.png'), fullPage: true });
      ok(sErr.length === 0, `no console errors in the suggestion and admin checks${sErr.length ? ': ' + sErr.slice(0, 3).join(' | ') : ''}`);

      // phones: the admin page and the form fit a 360 px screen
      await sp.setViewportSize({ width: 360, height: 740 });
      await sp.waitForTimeout(300);
      const aw = await sp.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      ok(aw[0] <= aw[1] && await sp.locator('.card').first().isVisible(), `admin.html fits a 360 px phone with no sideways scroll (${aw.join('/')})`);
      await sp.screenshot({ path: path.join(SHOTS, 'admin-phone.png'), fullPage: true });
      await sp.goto(BASE + '?y=1776');
      await waitH1(sp, 'The world in 1776');
      await sp.click('#sheetHandle').catch(() => {});
      await sp.waitForSelector('#panelBody > details.suggest', { state: 'attached', timeout: 60000 });
      await sp.evaluate(() => { const d = document.querySelector('#panelBody > details.suggest'); d.scrollIntoView(); d.querySelector('summary').click(); });
      await sp.waitForSelector('#panelBody .sg-form', { state: 'attached', timeout: 20000 });
      await sp.waitForTimeout(400);
      const pw = await sp.evaluate(() => { const b = document.querySelector('#panelBody'); const f = b.querySelector('.sg-form').getBoundingClientRect(); return [b.scrollWidth, b.clientWidth, Math.round(f.right), document.documentElement.scrollWidth, window.innerWidth]; });
      ok(pw[0] <= pw[1] && pw[2] <= pw[4] && pw[3] <= pw[4], `the form fits the phone panel (${pw.join('/')})`);
      await sctx.close();
    }

    if (ONLY !== 'suggest') {   // the phone checks (E2E_ONLY=phone runs only these)
    // ---------------- phones ----------------
    for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 740 }]) {
      const p = await newPage(browser, vp);
      await p.page.goto(BASE + '?y=1776');
      await waitH1(p.page, 'The world in 1776');
      await p.page.waitForFunction(() => window.__geo?.state.snapDoc, null, { timeout: 60000 });
      await p.page.waitForSelector('#panelBody .events li, #panelBody .empty', { state: 'attached', timeout: 60000 });   // the sheet starts collapsed
      await p.page.waitForTimeout(2500);
      const sw = await p.page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth, document.body.scrollWidth]);
      ok(sw[0] <= sw[1] && sw[2] <= sw[1], `no horizontal scroll at ${vp.width}px (${sw.join('/')})`);
      ok(await p.page.locator('#key .key-toggle').isVisible() && await p.page.locator('#keyBody').isHidden() && await p.page.locator('#playBtn').isVisible() && await p.page.locator('#nextChange').isVisible(),
        `${vp.width}px: the key is a closed button, play and next change are on screen`);
      await p.page.screenshot({ path: path.join(SHOTS, `phone-${vp.width}.png`) });
      if (vp.width === 390) {
        await p.page.click('#sheetHandle');
        await p.page.waitForTimeout(400);
        await p.page.screenshot({ path: path.join(SHOTS, 'phone-390-open.png') });
      }
      ok(p.errors.length === 0, `no console errors at ${vp.width}px${p.errors.length ? ': ' + p.errors.slice(0, 5).join(' | ') : ''}`);
      await p.ctx.close();
    }

    // ---------------- round 12: fresh code on phones, flag fill that cannot fail silently, the bottom sheet ----------------
    {
      // every script and stylesheet URL carries the hash of its file; the modules are versioned by an import map
      const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
      const hash = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 10);
      const refs = [...html.matchAll(/(?:src|href)="((?:js|css|vendor)\/[^"]+)"/g)].map((m) => m[1]);
      const badRef = refs.filter((u) => { const [f, q] = u.split('?v='); return !q || q !== hash(f); });
      const imap = JSON.parse((html.match(/<script type="importmap">([\s\S]*?)<\/script>/) || [])[1] || '{"imports":{}}').imports;
      const mods = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js'));
      const badMod = mods.filter((f) => imap[`./js/${f}`] !== `./js/${f}?v=${hash('js/' + f)}`);
      ok(refs.length >= 4 && !badRef.length && !badMod.length && /<meta name="build" content="[0-9a-f]{10}">/.test(html),
        `asset URLs are versioned by content (${refs.length} script/style URLs, ${mods.length} modules in the import map${badRef.length || badMod.length ? '; stale: ' + [...badRef, ...badMod].join(', ') + ' (run python3 tools/build_assets.py)' : ''})`);
      const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
      // an old "Plain colours" choice (before round 12) does not turn the flags off
      const ctx = await browser.newContext(phone);
      await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('geohistory.fill', '"plain"'); sessionStorage.setItem('seeded', '1'); } } catch {} });
      const pg = await ctx.newPage();
      const perr = [];
      pg.on('pageerror', (e) => perr.push(String(e)));
      pg.on('console', (m) => { if (m.type() === 'error') perr.push(m.text()); });
      await pg.goto(BASE + '?y=1914&debug=1');
      await waitH1(pg, 'The world in 1914');
      await pg.waitForFunction(() => window.__geo?.state.snapDoc && window.__geo.map?.ready, null, { timeout: 60000 });
      await pg.waitForFunction(() => window.__geo.map.fillDiag().on, null, { timeout: 30000 }).catch(() => {});
      const d0 = await pg.evaluate(() => ({ ...window.__geo.map.fillDiag(), at: window.__geo.map.fillAt(37.6, 55.75), diag: document.querySelector('.diag')?.textContent || '' }));
      ok(d0.mode === 'flag' && d0.impl === 'canvas' && d0.at?.on && d0.at.key === 'm:RU', `phone: flag fill is on despite an old stored "plain" (${d0.mode} via ${d0.impl}; Moscow ${d0.at?.key}, ${d0.check})`);
      ok(/fill flag via canvas/.test(d0.diag) && /max texture \d+/.test(d0.diag) && d0.cap <= Math.min(1536, d0.maxTex), `?debug=1 shows the renderer, texture size, canvases and fill mode (canvas cap ${d0.cap}, ${d0.canvasMB} MB)`);
      const js = await pg.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /\/js\/[^/]+\.js/.test(n)));
      ok(js.length >= 10 && js.every((n) => /\?v=[0-9a-f]{10}$/.test(n)), `every module is fetched with its version (${js.length} modules${js.filter((n) => !/\?v=/.test(n)).map((n) => ' unversioned: ' + n).join('')})`);
      // the bottom sheet
      const geo = () => pg.evaluate(() => {
        const p = document.querySelector('#panel').getBoundingClientRect(), st = document.querySelector('.stage').getBoundingClientRect();
        return { size: document.querySelector('#panel').dataset.size, top: Math.round(p.top), mapVisible: Math.round(p.top - st.top), title: document.querySelector('#sheetTitle').textContent };
      });
      // the sheet has stopped moving (software WebGL makes the transition slow)
      const settle = async () => {
        let last = -1;
        for (let i = 0; i < 40; i++) {
          await pg.waitForTimeout(150);
          const t = await pg.evaluate(() => Math.round(document.querySelector('#panel').getBoundingClientRect().top));
          if (t === last) return;
          last = t;
        }
      };
      const g0 = await geo();
      ok(g0.size === 'collapsed' && g0.mapVisible > 844 * 0.7 && g0.title === 'The world in 1914', `phone: the sheet starts collapsed with the year as its title; the map shows ${g0.mapVisible}px of 844`);
      await pg.tap('#sheetHandle'); await settle();
      const g1 = await geo();
      ok(g1.size === 'half' && g1.mapVisible < g0.mapVisible - 200, `tapping the handle opens the sheet half way (map ${g0.mapVisible} -> ${g1.mapVisible}px)`);
      // drags by touch (CDP touch events: the phone's own path)
      const cdp = await ctx.newCDPSession(pg);
      // each event carries its own time, `pause` ms apart (a slow software renderer then does not turn a swipe into a drag)
      let clock = Date.now() / 1000;
      const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, timestamp: clock, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
      const drag = async (from, to, steps, pause) => {
        clock = Date.now() / 1000;
        await touch('touchStart', from.x, from.y);
        for (let i = 1; i <= steps; i++) { clock += (pause || 12) / 1000; await touch('touchMove', from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); if (pause) await pg.waitForTimeout(pause); }
        clock += 0.005;
        await touch('touchEnd');
        await settle();
      };
      const barAt = async () => { const b = await pg.locator('#sheetBar').boundingBox(); return { x: b.x + 60, y: b.y + 22 }; };
      await drag(await barAt(), { x: 60, y: 120 }, 12, 40);
      const g2 = await geo();
      ok(g2.size === 'full' && g2.top < g1.top, `dragging the handle up opens it fully (top ${g1.top} -> ${g2.top})`);
      const b2 = await barAt();
      await drag(b2, { x: b2.x, y: b2.y + 300 }, 3, 0);
      const g3 = await geo();
      ok(g3.size === 'collapsed' && g3.mapVisible >= g0.mapVisible - 2, `a swipe down collapses it and the map gets its room back (${g3.size}, map ${g3.mapVisible}px)`);
      await pg.tap('#sheetChev'); await settle();
      const c1 = (await geo()).size;
      await pg.tap('#sheetChev'); await settle();
      const c2 = (await geo()).size;
      await pg.tap('#sheetChev'); await settle();
      const c3 = (await geo()).size;
      ok(c1 === 'half' && c2 === 'full' && c3 === 'collapsed', `the chevron button steps the sheet: ${c1}, ${c2}, ${c3}`);
      await pg.tap('#sheetChev'); await settle();
      // a pan on the map leaves the sheet alone; scrolling the panel leaves the map alone
      const c0 = await pg.evaluate(() => window.__geo.map.map.getCenter().lng);
      await pg.evaluate(() => { const b = document.querySelector('#panelBody'); b.scrollTop = 200; });
      const c0b = await pg.evaluate(() => window.__geo.map.map.getCenter().lng);
      const st0 = (await geo()).size;
      await drag({ x: 200, y: 200 }, { x: 120, y: 260 }, 6, 30);
      const st1 = await geo();
      const c1m = await pg.evaluate(() => window.__geo.map.map.getCenter().lng);
      ok(c0 === c0b && c1m !== c0 && st0 === 'half' && st1.size === 'half', `a pan on the map leaves the sheet alone, the panel's scroll leaves the map alone (${st0} -> ${st1.size}; map moved ${Math.abs(c1m - c0).toFixed(1)} degrees)`);
      await pg.reload();
      await waitH1(pg, 'The world in 1914');
      ok((await geo()).size === 'half', 'the sheet comes back at the height last chosen');
      const sw = await pg.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      const row = await pg.evaluate(() => { const r = document.querySelector('.timebar').getBoundingClientRect(); return Math.round(r.height); });
      ok(sw[0] <= sw[1] && row <= 110, `the time bar is one compact row over the timeline (${row}px), no sideways scroll`);
      ok(perr.length === 0, `no console errors on the phone checks${perr.length ? ': ' + perr.slice(0, 3).join(' | ') : ''}`);
      await ctx.close();
      // the canvas path made to fail: the flags come in as a tiled pattern instead of not at all
      const ctxF = await browser.newContext(phone);
      const pf = await ctxF.newPage();
      await pf.goto(BASE + '?y=1914&fill=fail');
      await waitH1(pf, 'The world in 1914');
      await pf.waitForFunction(() => window.__geo?.map?.ready && window.__geo.map.fillImpl === 'pattern' && window.__geo.map.fillDiag().on, null, { timeout: 60000 }).catch(() => {});
      const fb = await pf.evaluate(() => ({ d: window.__geo.map.fillDiag(), at: window.__geo.map.fillAt(37.6, 55.75), pat: window.__geo.map.map.getPaintProperty('fpat' + window.__geo.map.active, 'fill-pattern') }));
      ok(fb.d.impl === 'pattern' && fb.at?.on && fb.at.key === 'm:RU' && Array.isArray(fb.pat) && fb.d.canvasMB < 0.1,
        `when the canvas check fails the pattern fill takes over (${fb.d.impl}, ${fb.d.why}; Moscow ${fb.at?.key} ${fb.at?.on ? 'shown' : 'not shown'}; canvases freed: ${fb.d.canvasMB} MB)`);
      await pf.evaluate(() => window.__geo.goToYear(1950));
      await waitH1(pf, 'The world in 1950');
      await pf.waitForFunction(() => window.__geo.state.snapDoc?.year === 1950 && window.__geo.map.fillAt(37.6, 55.75)?.on, null, { timeout: 60000 }).catch(() => {});
      const fb2 = await pf.evaluate(() => window.__geo.map.fillAt(37.6, 55.75));
      ok(fb2?.on && fb2.impl === 'pattern', `the pattern fill follows a change of year (1950: ${fb2?.key})`);
      await ctxF.close();
    }
    }   // end of the phone checks
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
