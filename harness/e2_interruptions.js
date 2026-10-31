/* E2: interruption detection and interruption fraction against ground truth.
   Pauses are generated with probability intFreq/min per cycle and last 2.5 to 5 s (uniform), hands lifted.
   Output: dataset/experiments/e2_summary.json */
'use strict';
const fs = require('fs'), path = require('path');
const { load, runSession } = require('./sim_node');
const M = require('./common_metrics');
const P = load();
const SEEDS = +(process.env.SEEDS || 30), SECONDS = +(process.env.SECONDS || 180);
const out = { release_sha256: P.sha256, seeds: SEEDS, seconds_per_run: SECONDS, conditions: [] };

for (const cond of [{ id: 'lab_noise1', env: 'lab', noise: 1 }, { id: 'lab_noise4', env: 'lab', noise: 4 }, { id: 'occl_noise1', env: 'occl', noise: 1 }]) {
  const per = [], onsetDelay = [], durErr = [], cueDelay = [], ifPairs = [], cuesPer = [], afterResume = [];
  let nTrue = 0, nDet = 0, nMatched = 0, nFalse = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const run = runSession(P, { params: { depth: 55, rate: 110, intFreq: 3, noise: cond.noise }, env: cond.env, seed, seconds: SECONDS });
    const tA = run.activeStart + 2, tB = run.tEnd - 6;
    // consecutive pause segments are one hands-off period
    const merged = [];
    for (const s of run.truth.filter(x => x.type === 'pause')) {
      const last = merged[merged.length - 1];
      if (last && Math.abs(last.t1 - s.t0) < 1e-6) last.t1 = s.t1; else merged.push({ t0: s.t0, t1: s.t1 });
    }
    const truth = merged.filter(s => s.t0 > tA && s.t0 < tB);
    const det = run.pauses.filter(p => p.t0 > tA + 0.2 && p.t0 < tB + 0.5);
    const used = new Set();
    for (const s of truth) {
      const k = det.findIndex((p, i) => !used.has(i) && p.t1 > s.t0 && p.t0 < s.t1 + 0.5);
      if (k >= 0) {
        used.add(k); nMatched++;
        const p = det[k];
        onsetDelay.push(p.t0 - s.t0); if (s.t1 < run.tEnd - 1) durErr.push(p.dur - (s.t1 - s.t0));
        const cue = run.log.find(f => f.metric === 'interrupt' && f.t >= s.t0 && f.t <= s.t1 + 0.6);
        if (cue) cueDelay.push(cue.t - s.t0);
        const cues = run.log.filter(f => f.metric === 'interrupt' && f.t >= s.t0 && f.t <= s.t1 + 1.0);
        cuesPer.push(cues.length); afterResume.push(cues.filter(f => f.t > s.t1 + 0.05).length);
      }
    }
    nTrue += truth.length; nDet += det.length; nFalse += det.filter((p, i) => !used.has(i)).length;
    if (process.env.DEBUG) det.forEach((p, i) => { if (!used.has(i)) console.log('  false', seed, p.t0.toFixed(2), p.t1.toFixed(2), JSON.stringify(merged.filter(s => Math.abs(s.t0 - p.t0) < 8).map(s => [s.t0.toFixed(2), s.t1.toFixed(2)]))); });
    // interruption fraction over the active period: truth = hands-off time / active time
    const span = run.tEnd - run.activeStart;
    const trueOff = merged.filter(s => s.t0 >= run.activeStart).reduce((a, s) => a + Math.min(s.t1, run.tEnd) - s.t0, 0);
    ifPairs.push({ trueIF: trueOff / span, measIF: run.session.IF });
    per.push({ seed, nTrue: truth.length, nDet: det.length });
  }
  const res = {
    ...cond, truePauses: nTrue, detected: nDet, matched: nMatched, falsePauses: nFalse, sensitivity: nMatched / nTrue,
    onsetDelayS: { median: M.quantile(onsetDelay, 0.5), q25: M.quantile(onsetDelay, 0.25), q75: M.quantile(onsetDelay, 0.75) },
    durationErrS: { mean: M.mean(durErr), sd: M.sd(durErr), mae: M.mean(durErr.map(Math.abs)) },
    firstCueDelayS: { n: cueDelay.length, median: M.quantile(cueDelay, 0.5), q25: M.quantile(cueDelay, 0.25), q75: M.quantile(cueDelay, 0.75) },
    cuesPerPause: { mean: M.mean(cuesPer), afterResumeTotal: afterResume.reduce((a, b) => a + b, 0), pausesWithLateCue: afterResume.filter(x => x > 0).length },
    interruptionFraction: { trueMean: M.mean(ifPairs.map(x => x.trueIF)), measMean: M.mean(ifPairs.map(x => x.measIF)), meanAbsErr: M.mean(ifPairs.map(x => Math.abs(x.measIF - x.trueIF))), bias: M.mean(ifPairs.map(x => x.measIF - x.trueIF)), pairs: ifPairs },
    perSeed: per
  };
  out.conditions.push(res);
  console.log(cond.id, 'true', nTrue, 'det', nDet, 'sens', res.sensitivity.toFixed(3), 'false', nFalse, 'onset', res.onsetDelayS.median.toFixed(2), 'durErr', res.durationErrS.mean.toFixed(2), '+/-', res.durationErrS.sd.toFixed(2), 'cue', res.firstCueDelayS.median.toFixed(2), 'IF', res.interruptionFraction.trueMean.toFixed(3), res.interruptionFraction.measMean.toFixed(3), 'IFerr', res.interruptionFraction.meanAbsErr.toFixed(4), 'cues/pause', res.cuesPerPause.mean.toFixed(2), 'late', res.cuesPerPause.pausesWithLateCue);
}
fs.writeFileSync(path.join((d => (fs.mkdirSync(d, { recursive: true }), d))(path.join(__dirname, '..', 'dataset', 'experiments', process.env.VERSION === 'v1.0' ? 'v1.0' : '')), 'e2_summary.json'), JSON.stringify(out, null, 1));
