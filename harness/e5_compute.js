/* E5a: computational cost of the sensing, assessment and feedback pipeline (no rendering), measured in Node.
   Each run simulates 120 s of the mixed-errors scenario; cost is wall time divided by the number of 30 Hz samples.
   Output: dataset/experiments/e5_compute.json */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { load } = require('./sim_node');
const M = require('./common_metrics');
const P = load();
const RUNS = +(process.env.RUNS || 20);
const res = [];
for (let r = 0; r < RUNS + 3; r++) {
  const S = P.S;
  S.seed = 500 + r; S.running = true; S.mode = 'train'; S.demo.active = false; S.controller = 'adaptive'; S.ablation = 'full';
  P.resetSession(true); P.applyScenario('mixed');
  const n0 = P.Samples.length;
  const t0 = process.hrtime.bigint();
  while (S.t < 123.6) P.simAdvance(1 / 60);
  const ns = Number(process.hrtime.bigint() - t0);
  // the replay ring buffer holds 10 min, so the sample count is the number generated in this run
  const samples = P.Samples.length - n0 + (P.Samples.length >= P.Samples.cap ? 0 : 0);
  if (r >= 3) res.push({ run: r - 3, samples, usPerSample: ns / 1000 / samples, msPerSimSecond: ns / 1e6 / 123.6, cycles: P.Cycles.length });
}
const us = res.map(x => x.usPerSample);
const out = {
  release_sha256: P.sha256, version: P.version, node: process.version, cpu: os.cpus()[0].model, logicalCpus: os.cpus().length,
  runs: res, usPerSample: { median: M.quantile(us, 0.5), q25: M.quantile(us, 0.25), q75: M.quantile(us, 0.75), max: Math.max(...us) },
  budgetUs: 1e6 / P.FS
};
fs.writeFileSync(path.join((d => (fs.mkdirSync(d, { recursive: true }), d))(path.join(__dirname, '..', 'dataset', 'experiments', process.env.VERSION === 'v1.0' ? 'v1.0' : '')), 'e5_compute.json'), JSON.stringify(out, null, 1));
console.log(out.cpu, out.node, 'us/sample median', out.usPerSample.median.toFixed(2), 'IQR', out.usPerSample.q25.toFixed(2), out.usPerSample.q75.toFixed(2), 'max', out.usPerSample.max.toFixed(2), 'budget', out.budgetUs.toFixed(0));
