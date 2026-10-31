/* E1: accuracy of the sensing and assessment pipeline against the simulator's ground truth.
   Conditions: tracking-noise sweep in the controlled-lab mode, and the four tracking conditions at the default noise.
   Each run draws its own technique parameters so that in-range and out-of-range compressions both occur.
   Output: dataset/experiments/e1_summary.json, dataset/experiments/e1_cycles.csv (one row per true compression), dataset/experiments/e1_trace.json (example trace). */
'use strict';
const fs = require('fs'), path = require('path');
const { load, runSession } = require('./sim_node');
const M = require('./common_metrics');

const P = load();
const SEEDS = +(process.env.SEEDS || 30), SECONDS = +(process.env.SECONDS || 90);
const OUT = path.join(__dirname, '..', 'dataset', 'experiments', process.env.VERSION === 'v1.0' ? 'v1.0' : ''); fs.mkdirSync(OUT, { recursive: true });

const CONDITIONS = [];
for (const n of [0, 0.5, 1, 2, 4, 6, 8]) CONDITIONS.push({ id: `noise_${n}`, group: 'noise', noise: n, env: 'lab' });
for (const e of ['lab', 'low', 'occl', 'motion']) CONDITIONS.push({ id: `env_${e}`, group: 'env', noise: 1, env: e });

function drawParams(seed) {
  const r = M.rng(1000 + seed);
  const ang = r.uni(0, 2 * Math.PI), rad = r.uni(0, 35);
  return { depth: r.uni(35, 70), rate: r.uni(80, 145), offX: rad * Math.cos(ang), offY: rad * Math.sin(ang), recoil: r.uni(78, 100), intFreq: 0 };
}

const rows = ['cond,seed,true_peak_s,detected,true_depth_mm,meas_depth_mm,true_rate_cpm,meas_rate_cpm,true_pos_mm,meas_pos_mm,pos_vec_err_mm,true_resid_mm,meas_resid_mm,peak_lag_ms,emit_lag_ms,low_conf'];
const summary = { release_sha256: P.sha256, seeds: SEEDS, seconds_per_run: SECONDS, conditions: [] };
const t0 = Date.now();
for (const cond of CONDITIONS) {
  const perSeed = [];
  const agg = { dErr: [], rErr: [], pErr: [], pMagErr: [], lErr: [], peakLag: [], emitLag: [], cls: { depth: [], rate: [], pos: [], recoil: [] } };
  for (let seed = 1; seed <= SEEDS; seed++) {
    const p = { ...drawParams(seed), noise: cond.noise };
    const run = runSession(P, { params: p, env: cond.env, seed, seconds: SECONDS });
    const m = M.match(run);
    const s = { seed, nTrue: m.truth.length, nMatched: 0, falsePos: m.falsePos, minutes: m.minutes, lowConf: 0, dAbs: [], rAbs: [], pAbs: [], lAbs: [] };
    m.pairs.forEach((pr, i) => {
      const tp = M.truePeak(pr.s), tpos = M.truePos(pr.s), tposMag = Math.hypot(tpos.x, tpos.y);
      let trueRate = null;
      const prev = i > 0 ? m.pairs[i - 1].s : null;
      if (prev && Math.abs(prev.t1 - pr.s.t0) < 1e-6) trueRate = 60 / (tp - M.truePeak(prev));
      const c = pr.c;
      const row = [cond.id, seed, tp.toFixed(3), c ? 1 : 0, pr.s.D.toFixed(2), c ? c.depth.toFixed(2) : '', trueRate ? trueRate.toFixed(2) : '', c && c.rate ? c.rate.toFixed(2) : '',
        tposMag.toFixed(2), c ? c.pos.toFixed(2) : '', c ? Math.hypot(c.posX - tpos.x, c.posY - tpos.y).toFixed(2) : '', pr.s.L.toFixed(2), c ? c.resid.toFixed(2) : '',
        c ? ((c.t - tp) * 1000).toFixed(1) : '', c ? ((c.tEnd - tp) * 1000).toFixed(1) : '', c ? (c.lowConf ? 1 : 0) : ''];
      rows.push(row.join(','));
      if (!c) return;
      s.nMatched++;
      if (c.lowConf) { s.lowConf++; return; }          // withheld compressions are not scored by the app either
      const de = c.depth - pr.s.D; agg.dErr.push(de); s.dAbs.push(Math.abs(de));
      if (trueRate && c.rate) { const re = c.rate - trueRate; agg.rErr.push(re); s.rAbs.push(Math.abs(re)); agg.cls.rate.push([M.inRate(trueRate), M.inRate(c.rate)]); }
      const pe = Math.hypot(c.posX - tpos.x, c.posY - tpos.y); agg.pErr.push(pe); s.pAbs.push(pe); agg.pMagErr.push(c.pos - tposMag);
      const le = c.resid - pr.s.L; agg.lErr.push(le); s.lAbs.push(Math.abs(le));
      agg.peakLag.push((c.t - tp) * 1000); agg.emitLag.push((c.tEnd - tp) * 1000);
      agg.cls.depth.push([M.inDepth(pr.s.D), M.inDepth(c.depth)]);
      agg.cls.pos.push([M.inPos(tposMag), M.inPos(c.pos)]);
      agg.cls.recoil.push([M.fullRecoil(pr.s.L), M.fullRecoil(c.resid)]);
    });
    perSeed.push({ seed, sensitivity: s.nMatched / s.nTrue, falsePerMin: s.falsePos / s.minutes, lowConfFrac: s.lowConf / Math.max(1, s.nMatched),
      depthMAE: M.mean(s.dAbs), rateMAE: M.mean(s.rAbs), posErr: M.mean(s.pAbs), recoilMAE: M.mean(s.lAbs), nTrue: s.nTrue, params: p });
  }
  const col = k => perSeed.map(x => x[k]).filter(Number.isFinite);
  const stat = k => ({ mean: M.mean(col(k)), sd: M.sd(col(k)), ci95: M.bootCI(col(k)) });
  const dist = a => ({ n: a.length, bias: M.mean(a), mae: M.mean(a.map(Math.abs)), p95abs: M.quantile(a.map(Math.abs), 0.95) });
  summary.conditions.push({
    ...cond, trueCompressions: perSeed.reduce((a, x) => a + x.nTrue, 0),
    sensitivity: stat('sensitivity'), falsePerMin: stat('falsePerMin'), lowConfFrac: stat('lowConfFrac'),
    depthMAE: stat('depthMAE'), rateMAE: stat('rateMAE'), posErr: stat('posErr'), recoilMAE: stat('recoilMAE'),
    depthErr: dist(agg.dErr), rateErr: dist(agg.rErr), posVecErr: { n: agg.pErr.length, mean: M.mean(agg.pErr), p95: M.quantile(agg.pErr, 0.95) }, posMagErr: dist(agg.pMagErr), recoilErr: dist(agg.lErr),
    peakLagMs: { median: M.quantile(agg.peakLag, 0.5), q25: M.quantile(agg.peakLag, 0.25), q75: M.quantile(agg.peakLag, 0.75) },
    emitLagMs: { median: M.quantile(agg.emitLag, 0.5), q25: M.quantile(agg.emitLag, 0.25), q75: M.quantile(agg.emitLag, 0.75), p95: M.quantile(agg.emitLag, 0.95) },
    classification: Object.fromEntries(Object.entries(agg.cls).map(([k, v]) => [k, M.kappa(v)])),
    perSeed
  });
  const c = summary.conditions[summary.conditions.length - 1];
  console.log(`${cond.id.padEnd(12)} sens=${c.sensitivity.mean.toFixed(4)} fp/min=${c.falsePerMin.mean.toFixed(2)} lowconf=${c.lowConfFrac.mean.toFixed(3)} depthMAE=${c.depthMAE.mean.toFixed(2)} bias=${c.depthErr.bias.toFixed(2)} rateMAE=${c.rateMAE.mean.toFixed(2)} pos=${c.posErr.mean.toFixed(2)} recoil=${c.recoilMAE.mean.toFixed(2)} kD=${c.classification.depth.kappa.toFixed(3)} kR=${c.classification.rate.kappa.toFixed(3)} kP=${c.classification.pos.kappa.toFixed(3)} kL=${c.classification.recoil.kappa.toFixed(3)} emit=${c.emitLagMs.median.toFixed(0)}`);
}
fs.writeFileSync(path.join(OUT, 'e1_summary.json'), JSON.stringify(summary, null, 1));
fs.writeFileSync(path.join(OUT, 'e1_cycles.csv'), rows.join('\n') + '\n');

/* example trace for the signal figure: 6 s of a run at 4 mm noise with a shallow, slightly off-centre technique */
{
  const run = runSession(P, { params: { depth: 46, rate: 112, offX: 12, offY: -8, recoil: 92, noise: 4 }, env: 'lab', seed: 7, seconds: 20 });
  const S = P.Samples, out = { t: [], tz: [], rz: [], fz: [], tx: [], rx: [], fx: [], peaks: [] };
  for (let k = 0; k < S.length; k++) { const i = S.idx(k); const t = S.time[i]; if (t < 12 || t > 18) continue; out.t.push(+t.toFixed(4)); for (const c of ['tz', 'rz', 'fz', 'tx', 'rx', 'fx']) out[c].push(+S[c][i].toFixed(3)); }
  out.peaks = run.cycles.filter(c => c.t >= 12 && c.t <= 18).map(c => ({ t: c.t, depth: c.depth, resid: c.resid, tEnd: c.tEnd }));
  out.truePeaks = run.truth.filter(s => s.type === 'cycle' && M.truePeak(s) >= 12 && M.truePeak(s) <= 18).map(s => ({ t: M.truePeak(s), D: s.D, L: s.L }));
  fs.writeFileSync(path.join(OUT, 'e1_trace.json'), JSON.stringify(out));
}
console.log('elapsed s', ((Date.now() - t0) / 1000).toFixed(1));
