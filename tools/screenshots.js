#!/usr/bin/env node
/* Captures the README screenshots and the demo GIF frames of every PULSEMR mode.
   Usage: npm run screenshots      -> docs/screenshots/*.png and docs/screenshots/demo-frames/*.png
          npm run demo-gif         -> docs/screenshots/demo.gif (needs Python with Pillow)
   The script drives the app through its own functions (the same ones the buttons call), stepping the
   simulation clock so every capture shows the state described in docs/screenshots/README.md.
   OFFLINE_FONTS=1 replaces the Google web fonts with installed fonts (Inter, DejaVu Sans Mono, Lora)
   for machines without internet access. Set CHROME_PATH to use an installed Chrome. */
'use strict';
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { server, ROOT } = require('./serve');

const OUT = path.join(ROOT, 'docs', 'screenshots');
const FRAMES = path.join(OUT, 'demo-frames');
const OFFLINE_FONTS = process.env.OFFLINE_FONTS === '1';
const FONT_CSS = `
@font-face{font-family:"Geist";src:local("Inter");font-weight:400}
@font-face{font-family:"Geist";src:local("Inter Medium"),local("Inter");font-weight:500}
@font-face{font-family:"Geist";src:local("Inter SemiBold"),local("Inter");font-weight:600}
@font-face{font-family:"Geist";src:local("Inter Bold"),local("Inter");font-weight:700}
@font-face{font-family:"Geist Mono";src:local("DejaVu Sans Mono");font-weight:400 600}
@font-face{font-family:"Instrument Serif";src:local("Lora");font-style:normal}
@font-face{font-family:"Instrument Serif";src:local("Lora Italic"),local("Lora");font-style:italic}`;

/* in-page helpers, injected once */
const HELPERS = () => {
  // __ff steps the simulation quickly; __freeze slows the clock to a crawl so the captured moment holds still
  // while the app keeps drawing (the status stays "simulation active").
  window.__ff = sec => { S.running = true; S.speed = 1; for (let i = 0; i < Math.round(sec * 10); i++) simAdvance(0.1); };
  window.__freeze = () => { S.speed = 1e-6; document.getElementById('toasts').innerHTML = ''; UI.closeMenus(); };
  window.__prep = () => { S.prefs.reducedMotion = true; S.demo.active = false; UI.setTheme('light', false); applyLighting(); };
};

async function settle(page, ms = 700) {
  await page.evaluate(() => { UI.t = {}; UI.renderTab(true); UI.press('#speedGrp', '1'); document.getElementById('toasts').innerHTML = ''; });
  await page.waitForTimeout(ms);
}

async function open(browser, viewport, scale) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: scale });
  if (OFFLINE_FONTS) {
    await page.route(/fonts\.googleapis\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: FONT_CSS }));
    await page.route(/fonts\.gstatic\.com/, r => r.abort());
  }
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(server.url, { waitUntil: 'load' });
  await page.evaluate(HELPERS);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.__prep());
  return page;
}

(async () => {
  fs.mkdirSync(FRAMES, { recursive: true });
  await new Promise(r => server.listen(0, r));
  server.url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const shot = async (page, name) => { await settle(page); await page.screenshot({ path: path.join(OUT, name) }); console.log('saved', name); };

  /* ---------- desktop, 1440 x 900 ---------- */
  const p = await open(browser, { width: 1440, height: 900 }, 1.5);
  // 1. training mode during shallow compressions
  await p.evaluate(() => { __ff(5); applyScenario('stable'); __ff(22); applyScenario('shallow'); __ff(14); __freeze(); });
  await shot(p, '01-train.png');
  // 2. object details: the adaptive feedback controller
  await p.evaluate(() => { UI.select('controller', false); setView('iso'); });
  await shot(p, '02-controller-details.png');
  await p.evaluate(() => UI.select(null, false));
  // 3. simulated mixed-reality headset view
  await p.evaluate(() => { UI.setMode('mr'); });
  await shot(p, '03-mr-view.png');
  console.log('  MR message:', await p.evaluate(() => document.getElementById('mrMsg').className + ' / ' + document.getElementById('mrMsg').textContent));
  // 4. hand close-up during hand drift
  await p.evaluate(() => { UI.setMode('train'); applyScenario('drift'); __ff(26); setView('hands'); UI.setTab('events'); __freeze(); });
  await shot(p, '04-hand-closeup.png');
  // 5. assessment after mixed errors and interruptions
  await p.evaluate(() => { setView('iso'); applyScenario('mixed'); __ff(48); applyScenario('pauses'); __ff(24); __freeze(); UI.setMode('assess'); });
  await shot(p, '05-assess.png');
  // 6-7. comparison mode, top and bottom
  await p.evaluate(() => { UI.setMode('compare'); applyScenario('shallow'); UI.runProjection(); });
  await shot(p, '06-compare.png');
  await p.evaluate(() => { const b = document.querySelector('#compareDrawer .pbody'); b.scrollTop = b.scrollHeight; Perf.n = 0; Perf.i = 0; });
  await p.waitForTimeout(2500);   // let the frame-interval meter collect fresh frames
  await shot(p, '07-compare-ablation.png');
  // 8. replay at a hand-position cue
  await p.evaluate(() => {
    UI.setMode('replay');
    const f = FB.log.items.filter(x => !x.confirm && x.metric === 'position');
    if (f.length) S.replay.t = f[Math.floor(f.length / 2)].t + 0.3;
    S.replay.playing = false; UI.renderReplay();
  });
  await shot(p, '08-replay.png');
  // 9. scenario lab with tracking occlusion
  await p.evaluate(() => { UI.setMode('train'); setView('iso'); applyScenario('occlusion'); __ff(16); __freeze(); UI.act('open-lab'); });
  await shot(p, '09-scenario-lab.png');
  // 10. dark theme, dimmed lab, fast compressions, side view
  await p.evaluate(() => {
    document.getElementById('scenarioLab').hidden = true;
    UI.setTheme('dark', false); S.lighting = 'dim'; applyLighting(); applyScenario('fast'); __ff(16); __freeze(); setView('side'); UI.setTab('avs');
  });
  await shot(p, '10-dark-dim.png');
  // 11. research explorer
  await p.evaluate(() => { UI.setTheme('light', false); S.lighting = 'day'; applyLighting(); setView('iso'); UI.setTab('events'); UI.openExplorer(); });
  await shot(p, '11-research-explorer.png');
  await p.close();

  /* ---------- phone, 390 x 844 ---------- */
  const m = await open(browser, { width: 390, height: 844 }, 2);
  await m.evaluate(() => { __ff(5); applyScenario('stable'); __ff(20); applyScenario('shallow'); __ff(12); __freeze(); UI.setSheet('guide'); });
  await shot(m, '12-phone-guidance.png');
  await m.evaluate(() => UI.setSheet('data'));
  await shot(m, '13-phone-data.png');
  await m.close();

  /* ---------- demo GIF frames: 12 s of the first-load demonstration, 8 frames per simulated second ---------- */
  const d = await open(browser, { width: 1440, height: 900 }, 2 / 3);
  await d.evaluate(() => { S.prefs.reducedMotion = false; __ff(5); applyScenario('stable'); __ff(10); applyScenario('shallow'); __freeze(); });
  for (let i = 0; i < 96; i++) {
    await d.evaluate(() => { S.speed = 1; for (let k = 0; k < 5; k++) simAdvance(0.025); S.speed = 1e-6; UI.t = {}; UI.press('#speedGrp', '1'); });
    await d.waitForTimeout(90);
    await d.screenshot({ path: path.join(FRAMES, `frame-${String(i).padStart(3, '0')}.png`) });
  }
  console.log('saved 96 demo frames');
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
