/* Session recordings: one 120-s session per training scenario, recorded at full detail.
   For each scenario this writes dataset/sessions/<scenario>/ with
     samples.csv          every 30 Hz tracking sample: true, tracked (raw) and filtered palm position, confidence, flags
     truth_segments.csv   every motion segment the generator produced (compressions and pauses) = ground truth
     compressions.csv     every compression the app detected, with its metrics and the matched true compression
     pauses.csv           every interruption the app detected
     feedback.csv         every cue the adaptive and the static controller decided (both see the same compressions)
     meta.json            scenario, seed, technique parameters, calibration residual and session scores
   and dataset/sessions/index.csv with one summary row per scenario.
   Usage: node harness/export_sessions.js            (SECONDS=120 SEED=1 by default) */
'use strict';
const fs = require('fs'), path = require('path');
const { load, runSession } = require('./sim_node');
const M = require('./common_metrics');

const P = load();
const SECONDS = +(process.env.SECONDS || 120), SEED = +(process.env.SEED || 1);
const OUT = path.join(__dirname, '..', 'dataset', 'sessions');
fs.mkdirSync(OUT, { recursive: true });

const f = (v, d = 3) => (v == null || !Number.isFinite(v)) ? '' : (+v).toFixed(d);
const q = s => (s == null ? '' : /[",\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s));
const csv = (header, rows) => header.join(',') + '\n' + rows.map(r => r.map(q).join(',')).join('\n') + '\n';

const index = [];
for (const sc of P.SCENARIOS) {
  const run = runSession(P, { scenario: sc.key, seed: SEED, seconds: SECONDS });
  const dir = path.join(OUT, sc.key); fs.mkdirSync(dir, { recursive: true });

  // samples (the ring buffer holds the last 10 min, so the whole session is available)
  const S = P.Samples, rows = [];
  for (let k = 0; k < S.length; k++) {
    const i = S.idx(k);
    rows.push([f(S.time[i], 4), f(S.tx[i], 2), f(S.ty[i], 2), f(S.tz[i], 2), f(S.rx[i], 2), f(S.ry[i], 2), f(S.rz[i], 2),
      f(S.fx[i], 2), f(S.fy[i], 2), f(S.fz[i], 2), f(S.conf[i], 3), S.occ[i] > 0.5 ? 1 : 0, S.pause[i] > 0.5 ? 1 : 0, S.calib[i] > 0.5 ? 1 : 0, S.fbLevel[i]]);
  }
  fs.writeFileSync(path.join(dir, 'samples.csv'), csv(['time_s', 'true_x_mm', 'true_y_mm', 'true_z_mm', 'raw_x_mm', 'raw_y_mm', 'raw_z_mm',
    'filt_x_mm', 'filt_y_mm', 'filt_z_mm', 'confidence', 'occluded', 'true_pause', 'calibrating', 'feedback_level'], rows));

  // ground truth segments
  const seg = run.truth.map((s, n) => [n + 1, s.type, f(s.t0, 4), f(s.t1, 4), s.type === 'cycle' ? f(M.truePeak(s), 4) : '',
    s.type === 'cycle' ? f(s.D, 2) : '', s.type === 'cycle' ? f(s.L, 2) : '', s.type === 'cycle' ? f(s.T, 4) : '', s.type === 'cycle' ? f(60 / s.T, 2) : '',
    s.type === 'cycle' ? f(Math.hypot(M.truePos(s).x, M.truePos(s).y), 2) : '', f(s.x0, 2), f(s.y0, 2), f(s.x1, 2), f(s.y1, 2), s.forced ? 1 : 0]);
  fs.writeFileSync(path.join(dir, 'truth_segments.csv'), csv(['segment', 'type', 't_start_s', 't_end_s', 'true_peak_s', 'true_depth_mm', 'true_residual_mm',
    'period_s', 'true_rate_cpm', 'true_hand_offset_mm', 'offset_x_start_mm', 'offset_y_start_mm', 'offset_x_end_mm', 'offset_y_end_mm', 'forced_pause'], seg));

  // detected compressions, matched to truth by peak time (same rule as experiment E1)
  const m = M.match(run, { margin0: -1e9, margin1: -1e9 });
  const byCycle = new Map(); m.pairs.forEach(p => { if (p.c) byCycle.set(p.c.n, p.s); });
  const segIdx = new Map(run.truth.map((s, n) => [s, n + 1]));
  const comp = run.cycles.map(c => {
    const s = byCycle.get(c.n);
    return [c.n, f(c.t, 4), f(c.tEnd, 4), f(c.depth, 2), f(c.rate, 2), f(c.interval, 4), f(c.pos, 2), f(c.posX, 2), f(c.posY, 2), f(c.resid, 2), f(c.recoilPct, 1),
      c.recoilLabel, f(c.pauseBefore, 2), f(c.conf, 3), f(c.occl, 3), c.lowConf ? 1 : 0, c.status, c.fb || '', c.fbLevel || 0,
      s ? segIdx.get(s) : '', s ? f(M.truePeak(s), 4) : '', s ? f(s.D, 2) : '', s ? f(s.L, 2) : '', s ? f(Math.hypot(M.truePos(s).x, M.truePos(s).y), 2) : ''];
  });
  fs.writeFileSync(path.join(dir, 'compressions.csv'), csv(['cycle', 'peak_s', 'closed_s', 'depth_mm', 'rate_cpm', 'interval_s', 'hand_error_mm', 'hand_x_mm', 'hand_y_mm',
    'residual_mm', 'recoil_pct', 'recoil_label', 'pause_before_s', 'mean_confidence', 'occluded_fraction', 'low_confidence', 'status', 'feedback_shown', 'feedback_level',
    'true_segment', 'true_peak_s', 'true_depth_mm', 'true_residual_mm', 'true_hand_offset_mm'], comp));

  // detected pauses
  fs.writeFileSync(path.join(dir, 'pauses.csv'), csv(['pause', 'start_s', 'end_s', 'duration_s'], run.pauses.map((p, n) => [n + 1, f(p.t0, 3), f(p.t1, 3), f(p.dur, 3)])));

  // feedback decisions of both controllers
  // each compression decision is linked to its compression; its time is the moment that compression was closed and assessed
  const cycOf = new Map(), closeT = new Map(run.cycles.map(c => [c.n, c.tEnd]));
  for (const d of P.FB.decisions.items) { if (d.adaptive) cycOf.set(d.adaptive, d.n); if (d.static) cycOf.set(d.static, d.n); }
  const shown = new Set(run.log);
  const fb = [];
  for (const [name, log] of [['adaptive', run.adaptiveLog], ['static', run.staticLog]]) {
    for (const d of log) {
      const n = cycOf.get(d);
      fb.push([name, f(n != null ? closeT.get(n) : d.t, 3), n == null ? '' : n, d.metric, d.dir || '', f(d.dev, 3), d.level, (d.modalities || []).join('+'),
        d.message, d.confirm ? 1 : 0, d.note || '', shown.has(d) ? 1 : 0]);
    }
  }
  fb.sort((a, b) => +a[1] - +b[1]);
  fs.writeFileSync(path.join(dir, 'feedback.csv'), csv(['controller', 'time_s', 'cycle', 'metric', 'direction', 'deviation', 'level', 'modalities', 'message', 'confirmation', 'note', 'shown_in_app'], fb));

  const params = { ...P.DEFAULT_PARAMS, ...P.SCENARIOS[0].p, ...sc.p };
  const meta = { scenario: sc.key, name: sc.name, description: sc.blurb, seed: SEED, seconds_after_calibration: SECONDS, calibration_s: 3.6,
    tracking_condition: sc.env || 'lab', technique_parameters: params, dynamic: sc.dyn || null,
    calibration_residual_mm: { x: +run.calib.x.toFixed(3), y: +run.calib.y.toFixed(3) }, session_scores: run.session,
    counts: { samples: rows.length, true_compressions: run.truth.filter(s => s.type === 'cycle').length, true_pauses: run.truth.filter(s => s.type === 'pause').length,
      detected_compressions: run.cycles.length, detected_pauses: run.pauses.length, withheld_low_confidence: run.withheld,
      adaptive_cues: run.adaptiveLog.filter(d => !d.confirm).length, static_cues: run.staticLog.length },
    simulation_sha256: P.sha256 };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 1));
  const sco = run.session || {};
  index.push([sc.key, sc.name, sc.env || 'lab', meta.counts.true_compressions, meta.counts.detected_compressions, meta.counts.true_pauses, meta.counts.detected_pauses,
    meta.counts.withheld_low_confidence, meta.counts.adaptive_cues, meta.counts.static_cues, f(sco.gcs, 1), f(sco.depthAcc, 1), f(sco.rateAcc, 1), f(sco.posAcc, 1), f(sco.recoilAcc, 1), f(sco.IF, 3)]);
  console.log(sc.key.padEnd(10), meta.counts);
}
fs.writeFileSync(path.join(OUT, 'index.csv'), csv(['scenario', 'name', 'tracking_condition', 'true_compressions', 'detected_compressions', 'true_pauses', 'detected_pauses',
  'withheld_low_confidence', 'adaptive_cues', 'static_cues', 'session_gcs', 'depth_accuracy_pct', 'rate_accuracy_pct', 'hand_accuracy_pct', 'full_recoil_pct', 'interruption_fraction'], index));
