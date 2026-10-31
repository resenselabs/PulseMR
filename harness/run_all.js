#!/usr/bin/env node
/* Regenerates every file in dataset/experiments/ (E1, E2 for v1.1 and v1.0, E3, E5).
   Usage: npm run experiments      (Node.js 18+, no dependencies)
   Set SEEDS=5 for a quick run; the published dataset uses the default of 30 seeds. */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const steps = [
  ['E1 measurement accuracy', 'e1_measurement.js', {}],
  ['E2 interruptions, v1.1', 'e2_interruptions.js', {}],
  ['E2 interruptions, v1.0', 'e2_interruptions.js', { VERSION: 'v1.0' }],
  ['E3 feedback policies', 'e3_controllers.js', {}],
  ['E5 computational cost', 'e5_compute.js', {}]
];
const t0 = Date.now();
for (const [name, file, env] of steps) {
  console.log(`\n=== ${name} (${file}) ===`);
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) { console.error(`${file} failed`); process.exit(r.status || 1); }
}
console.log(`\nAll experiments finished in ${((Date.now() - t0) / 1000).toFixed(0)} s. Outputs: dataset/experiments/`);
