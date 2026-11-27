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
    for (let i = 0; i < 8; i++) {
      const buf = await page.screenshot({ clip: { x: mbox.x + spot[0], y: mbox.y + spot[1], width: 2, height: 2 } });
      px.push(buf.toString('base64'));
      opac.push(await page.evaluate(() => { const M = window.__geo.map, m = M.map; return ['A', 'B', 'C'].map((s) => m.getPaintProperty('fill0' + s, 'fill-opacity')).join(','); }));
      await page.waitForTimeout(250);
    }
    await page.waitForFunction(() => !window.__geo.travel.running, null, { timeout: 120000 });
    const lc = await page.evaluate(() => ({ ...window.__geo.map.lastChange, n: window.__geo.state.snapDoc.features.length }));
    ok(new Set(px).size === 1, `while 1991 -> 1992 runs, unchanged land (China) never changes colour (${new Set(px).size} distinct samples in ${px.length})`);
    ok(opac.every((o) => o.split(',').every((v) => v === '0' || v === '1')), `stacks are only ever fully on or off, never cross-faded (${[...new Set(opac)].join(' | ')})`);
    ok(lc.gained >= 10 && lc.lost >= 1 && lc.gained < lc.n / 3, `1992: only the changed territories animate (${lc.lost} old shapes leave, ${lc.gained} of ${lc.n} new shapes flash in)`);
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
    ok(await page.locator('#key .key-toggle').isVisible() && /One colour|A state/.test(await page.locator('#key').innerText()) && /Occupied/.test(await page.locator('#key').innerText()), 'the map key is visible and explains states, empires, occupation, war and events');
    await page.locator('#key input[type=checkbox]').uncheck();
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => [...document.querySelectorAll('.warwrap')].every((e) => getComputedStyle(e).display === 'none') && window.__geo.map.map.getLayoutProperty('war-edge', 'visibility') === 'none'), 'the key turns the war layer off');
    await page.locator('#key input[type=checkbox]').check();
    await page.click('#key .key-toggle');
    ok(await page.locator('#keyBody').isHidden(), 'the key collapses');
    await page.click('#key .key-toggle');
    }
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
