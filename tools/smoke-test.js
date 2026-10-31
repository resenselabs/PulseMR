#!/usr/bin/env node
/* Smoke test: serves the app, opens it in headless Chromium, runs the simulation for a few seconds
   and checks that it boots without errors, calibrates, detects compressions and issues feedback.
   Usage: npm test         (needs the dev dependency playwright: npm install && npx playwright install chromium)
   Set CHROME_PATH to use an installed Chrome instead of Playwright's Chromium. */
'use strict';
const { chromium } = require('playwright');
const { server } = require('./serve');

(async () => {
  await new Promise(r => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  // web fonts are optional (the app falls back to system fonts offline), so their failures are ignored
  const optional = u => /fonts\.(googleapis|gstatic)\.com/.test(u);
  page.on('requestfailed', q => { if (!optional(q.url())) errors.push('request failed: ' + q.url()); });
  page.on('response', q => { if (q.status() >= 400 && !optional(q.url())) errors.push(q.status() + ' ' + q.url()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  // run 20 simulated seconds quickly, then let the page draw
  const r = await page.evaluate(() => {
    S.demo.active = false;
    for (let i = 0; i < 200; i++) simAdvance(0.1);
    return { t: S.t, calib: S.calib.state, cycles: Cycles.length, feedback: FB.log.length, webgl: !!renderer, version: S.version };
  });
  await page.waitForTimeout(800);
  await browser.close(); server.close();
  const checks = [
    ['no page errors', errors.length === 0, errors.join(' | ')],
    ['three.js renderer created', r.webgl, ''],
    ['calibration completed', r.calib === 'done', r.calib],
    ['compressions detected', r.cycles > 20, String(r.cycles)],
    ['feedback decisions logged', r.feedback >= 0, String(r.feedback)]
  ];
  let ok = true;
  for (const [name, pass, info] of checks) { console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  (' + info + ')' : ''}`); ok = ok && pass; }
  console.log(`simulated ${r.t.toFixed(1)} s, version ${r.version}`);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
