/* E3: feedback policies on identical compression streams.
   Every policy runs in shadow on the same detected compressions and pauses, so differences come only from the policy.
   Policies: static rules (as in the app), static rules with a two-compression repeat limit (fairer baseline),
   the adaptive controller, and the adaptive controller with one mechanism switched off (ablation).
   Protocol A (steady state): the ten scenarios, SEEDS runs of SECONDS each.
   Protocol B (onset): 30 s of on-target compressions, then a single deficit appears.
   Output: dataset/experiments/e3_summary.json, dataset/experiments/e3_onset.json, dataset/experiments/e3_runs.csv */
'use strict';
const fs = require('fs'), path = require('path');
const { load, runSession } = require('./sim_node');
const M = require('./common_metrics');
const P = load();
const SEEDS = +(process.env.SEEDS || 30), SECONDS = +(process.env.SECONDS || 120);
const OUT = path.join(__dirname, '..', 'dataset', 'experiments', process.env.VERSION === 'v1.0' ? 'v1.0' : '');

/* fairer static baseline: identical moderate cues are not repeated on consecutive compressions (same rule the adaptive policy uses) */
class StaticRateLimited extends P.StaticController {
  reset() { super.reset(); this.lastIssued = {}; }
  decide(c) {
    const d = super.decide(c);
    if (!d) return d;
    const key = d.metric + d.level;
    if (d.level < 3 && this.lastIssued[key] != null && this.n - this.lastIssued[key] < 2) return { suppressed: true };
    this.lastIssued[key] = this.n;
    return d;
  }
}
const POLICIES = [
  { id: 'static', label: 'Static rules', make: () => new P.StaticController() },
  { id: 'static_rl', label: 'Static rules + repeat limit', make: () => new StaticRateLimited() },
  { id: 'adaptive', label: 'Adaptive', make: () => new P.AdaptiveController() },
  { id: 'abl_personalize', label: 'Adaptive without personalised weights', make: () => new P.AdaptiveController({ personalize: false }) },
  { id: 'abl_suppress', label: 'Adaptive without repeat suppression', make: () => new P.AdaptiveController({ suppress: false }) },
  { id: 'abl_escalate', label: 'Adaptive without modality escalation', make: () => new P.AdaptiveController({ escalate: false }) },
  { id: 'abl_fade', label: 'Adaptive without baseline fading', make: () => new P.AdaptiveController({ fade: false }) },
  { id: 'abl_confirm', label: 'Adaptive without confirmations', make: () => new P.AdaptiveController({ confirm: false }) }
];
const SCEN = ['stable', 'shallow', 'deep', 'fast', 'slow', 'drift', 'recoil', 'pauses', 'occlusion', 'mixed'];

/* truth helpers */
function mergedPauses(run) {
  const m = [];
  for (const s of run.truth.filter(x => x.type === 'pause')) { const l = m[m.length - 1]; if (l && Math.abs(l.t1 - s.t0) < 1e-6) l.t1 = s.t1; else m.push({ t0: s.t0, t1: s.t1 }); }
  return m;
}
function truthDeficits(s, prevTruePeak) {
  const def = new Set(), pos = M.truePos(s), mag = Math.hypot(pos.x, pos.y);
  if (s.D < 50) def.add('depth:low'); if (s.D > 60) def.add('depth:high');
  if (prevTruePeak != null) { const r = 60 / (M.truePeak(s) - prevTruePeak); if (r < 100) def.add('rate:slow'); if (r > 120) def.add('rate:fast'); }
  if (mag > 20) def.add('position:any');
  if (s.L > 3) def.add('recoil:any');
  return def;
}
function analyse(run, log) {
  const m = M.match(run);
  const byT = new Map();                                     // detected cycle peak time -> truth deficits
  m.pairs.forEach((pr, i) => {
    if (!pr.c) return;
    const prev = i > 0 && Math.abs(m.pairs[i - 1].s.t1 - pr.s.t0) < 1e-6 ? M.truePeak(m.pairs[i - 1].s) : null;
    byT.set(pr.c.t, { def: truthDeficits(pr.s, prev), n: pr.c.n });
  });
  const pauses = mergedPauses(run);
  const t0 = run.activeStart + 0.5, t1 = run.tEnd - 1.5, minutes = (t1 - t0) / 60;
  const cues = log.filter(d => d.t >= t0 && d.t <= t1);
  const act = cues.filter(d => !d.confirm);
  let warranted = 0, judged = 0, rep = 0, prevMsg = null, modal = 0, audio = 0, haptic = 0, lvl = 0;
  for (const d of act) {
    if (d.pause) { judged++; if (pauses.some(p => d.t >= p.t0 && d.t <= p.t1 + 0.15)) warranted++; }
    else { const tr = byT.get(d.ct); if (tr) { judged++; if (tr.def.has(d.metric + ':' + d.dir) || (d.metric === 'position' && tr.def.has('position:any')) || (d.metric === 'recoil' && tr.def.has('recoil:any'))) warranted++; } }
    if (!d.pause && prevMsg && d.message === prevMsg.message && d.cycle === prevMsg.cycle + 1) rep++;
    if (!d.pause) prevMsg = d;
    modal += d.modalities.length; if (d.modalities.includes('audio')) audio++; if (d.modalities.includes('haptic')) haptic++; lvl += d.level;
  }
  // coverage: truly deficient compressions answered within that compression or the next two
  const cyc = run.cycles.filter(c => c.t > t0 && c.t < t1 && !c.lowConf);
  const cueByN = new Map(); for (const d of act) if (!d.pause && d.cycle != null) cueByN.set(d.cycle, d);
  let defN = 0, covered = 0;
  cyc.forEach(c => {
    const tr = byT.get(c.t); if (!tr || !tr.def.size) return;
    defN++;
    const metrics = new Set([...tr.def].map(x => x.split(':')[0]));
    for (let k = 0; k <= 2; k++) { const d = cueByN.get(c.n + k); if (d && metrics.has(d.metric)) { covered++; break; } }
  });
  return {
    cuesPerMin: act.length / minutes, confirmPerMin: (cues.length - act.length) / minutes, precision: judged ? warranted / judged : NaN,
    unwarrantedPerMin: (judged - warranted) / minutes, repeatFrac: act.length ? rep / act.length : NaN, meanLevel: act.length ? lvl / act.length : NaN,
    modalityEventsPerMin: modal / minutes, audioPerMin: audio / minutes, hapticPerMin: haptic / minutes,
    coverage: defN ? covered / defN : NaN, deficientCycles: defN, n: act.length
  };
}

/* ---------- protocol A ---------- */
const summary = { release_sha256: P.sha256, version: P.version, seeds: SEEDS, seconds_per_run: SECONDS, policies: POLICIES.map(p => ({ id: p.id, label: p.label })), scenarios: {} };
const csv = ['scenario,seed,policy,cues_per_min,confirm_per_min,precision,unwarranted_per_min,repeat_frac,mean_level,modality_events_per_min,audio_per_min,haptic_per_min,coverage,deficient_cycles'];
let sanity = { ok: 0, bad: 0 };
for (const sc of SCEN) {
  const acc = Object.fromEntries(POLICIES.map(p => [p.id, []]));
  for (let seed = 1; seed <= SEEDS; seed++) {
    const run = runSession(P, { scenario: sc, seed, seconds: SECONDS, shadow: POLICIES });
    // sanity: the shadow adaptive and static policies reproduce the app's own controller logs
    const a = run.shadow[2].filter(d => !d.confirm).length, aApp = run.adaptiveLog.filter(d => !d.confirm).length;
    const s = run.shadow[0].length, sApp = run.staticLog.length;
    if (a === aApp && s === sApp) sanity.ok++; else sanity.bad++;
    POLICIES.forEach((p, i) => {
      const r = analyse(run, run.shadow[i]); acc[p.id].push(r);
      csv.push([sc, seed, p.id, ...['cuesPerMin', 'confirmPerMin', 'precision', 'unwarrantedPerMin', 'repeatFrac', 'meanLevel', 'modalityEventsPerMin', 'audioPerMin', 'hapticPerMin', 'coverage', 'deficientCycles'].map(k => Number.isFinite(r[k]) ? +r[k].toFixed(4) : '')].join(','));
    });
  }
  summary.scenarios[sc] = {};
  for (const p of POLICIES) {
    const rs = acc[p.id], o = {};
    for (const k of ['cuesPerMin', 'confirmPerMin', 'precision', 'unwarrantedPerMin', 'repeatFrac', 'meanLevel', 'modalityEventsPerMin', 'audioPerMin', 'hapticPerMin', 'coverage']) {
      const v = rs.map(r => r[k]).filter(Number.isFinite);
      o[k] = { mean: M.mean(v), sd: M.sd(v), ci95: M.bootCI(v), n: v.length };
    }
    summary.scenarios[sc][p.id] = o;
  }
  const f = (id, k, d = 1) => { const x = summary.scenarios[sc][id][k].mean; return Number.isFinite(x) ? x.toFixed(d) : 'n/a'; };
  console.log(sc.padEnd(10), POLICIES.slice(0, 3).map(p => `${p.id}: cues ${f(p.id, 'cuesPerMin')} prec ${f(p.id, 'precision', 3)} rep ${f(p.id, 'repeatFrac', 2)} lvl ${f(p.id, 'meanLevel', 2)} cov ${f(p.id, 'coverage', 3)} mod ${f(p.id, 'modalityEventsPerMin')}`).join(' | '));
}
summary.sanity = sanity;
console.log('sanity', sanity);
fs.writeFileSync(path.join(OUT, 'e3_summary.json'), JSON.stringify(summary, null, 1));
fs.writeFileSync(path.join(OUT, 'e3_runs.csv'), csv.join('\n') + '\n');

/* ---------- protocol B: deficit onset ---------- */
const ONSET = [{ sc: 'shallow', metric: 'depth' }, { sc: 'deep', metric: 'depth' }, { sc: 'fast', metric: 'rate' }, { sc: 'slow', metric: 'rate' }, { sc: 'recoil', metric: 'recoil' }, { sc: 'drift', metric: 'position' }];
const onset = { protocol: '30 s on target, then the scenario is applied; 60 s observed after the switch', seeds: SEEDS, cases: {} };
for (const o of ONSET) {
  const res = Object.fromEntries(POLICIES.slice(0, 3).map(p => [p.id, { latencyS: [], latencyCycles: [], firstLevel: [], levelsByCycle: [] }]));
  let example = null;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const run = runSession(P, { seed, seconds: 90, onset: { at: 30, scenario: o.sc }, shadow: POLICIES.slice(0, 3) });
    const m = M.match(run);
    // first truly deficient compression on the target metric after the switch
    const sw = run.activeStart + 30;
    let first = null;
    m.pairs.forEach((pr, i) => {
      if (first || !pr.c || M.truePeak(pr.s) < sw) return;
      const prev = i > 0 && Math.abs(m.pairs[i - 1].s.t1 - pr.s.t0) < 1e-6 ? M.truePeak(m.pairs[i - 1].s) : null;
      const def = [...truthDeficits(pr.s, prev)].map(x => x.split(':')[0]);
      if (def.includes(o.metric)) first = pr;
    });
    if (!first) continue;
    POLICIES.slice(0, 3).forEach((p, i) => {
      const cues = run.shadow[i].filter(d => !d.confirm && !d.pause && d.metric === o.metric && d.t >= M.truePeak(first.s));
      if (cues.length) {
        res[p.id].latencyS.push(cues[0].t - M.truePeak(first.s));
        res[p.id].latencyCycles.push(cues[0].cycle - first.c.n);
        res[p.id].firstLevel.push(cues[0].level);
      }
      // level of the cue (0 if none) for each of the first 40 compressions after onset
      const lv = [];
      for (let k = 0; k < 40; k++) { const d = run.shadow[i].find(x => !x.pause && !x.confirm && x.cycle === first.c.n + k); lv.push(d ? d.level : 0); }
      res[p.id].levelsByCycle.push(lv);
    });
    if (seed === 1) example = { switchT: sw, firstDeficitT: M.truePeak(first.s), cues: Object.fromEntries(POLICIES.slice(0, 3).map((p, i) => [p.id, run.shadow[i].filter(d => d.t > sw - 10 && d.t < sw + 40).map(d => ({ t: +d.t.toFixed(3), level: d.level, metric: d.metric, modalities: d.modalities, confirm: !!d.confirm }))])), cycles: run.cycles.filter(c => c.t > sw - 10 && c.t < sw + 40).map(c => ({ t: +c.t.toFixed(3), depth: +c.depth.toFixed(2), rate: c.rate ? +c.rate.toFixed(1) : null, pos: +c.pos.toFixed(2), resid: +c.resid.toFixed(2) })) };
  }
  onset.cases[o.sc] = { metric: o.metric, example };
  for (const p of POLICIES.slice(0, 3)) {
    const r = res[p.id];
    const meanLv = Array.from({ length: 40 }, (_, k) => M.mean(r.levelsByCycle.map(a => a[k])));
    onset.cases[o.sc][p.id] = { n: r.latencyS.length, latencyS: { median: M.quantile(r.latencyS, 0.5), q25: M.quantile(r.latencyS, 0.25), q75: M.quantile(r.latencyS, 0.75) }, latencyCycles: { median: M.quantile(r.latencyCycles, 0.5), max: Math.max(...r.latencyCycles) }, firstLevelMean: M.mean(r.firstLevel), meanLevelByCycle: meanLv, cuesFirst40: M.mean(r.levelsByCycle.map(a => a.filter(x => x > 0).length)) };
  }
  const q = id => onset.cases[o.sc][id];
  console.log('onset', o.sc.padEnd(8), POLICIES.slice(0, 3).map(p => `${p.id}: lat ${q(p.id).latencyS.median.toFixed(3)}s (${q(p.id).latencyCycles.median} cyc) L1st ${q(p.id).firstLevelMean.toFixed(2)} cues/40 ${q(p.id).cuesFirst40.toFixed(1)}`).join(' | '));
}
fs.writeFileSync(path.join(OUT, 'e3_onset.json'), JSON.stringify(onset, null, 1));
