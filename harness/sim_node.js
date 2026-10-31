/* Loads the simulation layer (core + sim) of PULSEMR into a Node vm context, so the experiments exercise
   exactly the code the browser app runs.
   Rendering, interface and audio layers are not loaded; the hooks they would provide are stubbed. */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path'), crypto = require('crypto');

const VERSION = process.env.VERSION || 'v1.1';
const ROOT = path.join(__dirname, '..');

/* v1.1 (the app in this repository): the simulation layer is js/01-core.js + js/02-simulation.js.
   v1.0 (the earlier release, kept for the defect comparison): cut out of releases/pulsemr-v1.0.html. */
function extractSim() {
  if (VERSION === 'v1.1') {
    const files = ['js/01-core.js', 'js/02-simulation.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'));
    const code = files.join('\n');
    return { code, sha256: crypto.createHash('sha256').update(code).digest('hex') };
  }
  const html = fs.readFileSync(path.join(ROOT, 'releases', `pulsemr-${VERSION}.html`), 'utf8');
  const a = html.indexOf("'use strict';\n/* =====================================================================\n   PULSEMR core");
  const b = html.indexOf('/* =====================================================================\n   PULSEMR scene');
  if (a < 0 || b < 0) throw new Error('markers not found in release HTML');
  return { code: html.slice(a, b), sha256: crypto.createHash('sha256').update(html).digest('hex') };
}

const EXPORTS = `globalThis.__P = { S, TARGET, RESEARCH, SCENARIOS, ENV_MODES, DEFAULT_PARAMS, Gen, Track, Samples, Cycles, Pauses, Stats, Detect,
  FB, Ctl, Engine, StaticController, AdaptiveController, deviations, levelOf, scoreCycles, sessionScores, rollingScores, pauseTimeBetween,
  resetSession, applyScenario, setEnv, setParam, simAdvance, startCalibration, BW, butter2, Biquad, MovingAvg, FS, DT_SAMPLE, makeRng };`;

function load() {
  const { code, sha256 } = extractSim();
  const ctx = {
    console, Math, Date, JSON, Object, Array, Number, String, Set, Map, Float32Array, Float64Array, Uint8Array, Error, isFinite, parseFloat,
    performance: { now: () => 0 },            // pipeline activity timestamps are display-only
    setTimeout: () => 0, clearTimeout: () => 0,
    document: undefined
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(code + '\n' + EXPORTS, ctx, { filename: 'pulsemr-sim.js' });
  const P = ctx.__P;
  P.sha256 = sha256; P.version = VERSION;
  return P;
}

/* Ground-truth recorder: every motion segment the generator creates. A re-generation from time t
   (after calibration or a reset) discards previously generated segments that start at or after t. */
function attachTruth(P) {
  const truth = [];
  const orig = P.Gen.next;
  P.Gen.next = function (t0) {
    while (truth.length && truth[truth.length - 1].t0 >= t0 - 1e-9) truth.pop();
    const s = orig.call(this, t0);
    truth.push({ ...s, calX: P.S.calib.residual.x, calY: P.S.calib.residual.y });
    return s;
  };
  return truth;
}

/* Runs one session. params: technique parameters; env: tracking condition; seed; seconds after calibration. */
function runSession(P, { params = {}, env = null, seed = 1, seconds = 90, scenario = null, onset = null, shadow = [] } = {}) {
  const S = P.S;
  S.seed = seed; S.speed = 1; S.running = true; S.mode = 'train'; S.controller = 'adaptive'; S.ablation = 'full';
  S.learner = false; S.forcedPause = false; S.demo.active = false; S.prefs.intensityCap = 3;
  Object.assign(S.params, P.DEFAULT_PARAMS); Object.assign(S.eff, P.DEFAULT_PARAMS);
  S.env = 'lab'; S.scenario = 'custom';
  const truth = attachTruth(P);
  P.resetSession(true);
  // first part: either the onset protocol's stable phase or the requested condition
  const apply = (sc, p, e) => {
    if (sc) P.applyScenario(sc, { keepDemo: true });
    if (p) for (const k in p) { S.params[k] = p[k]; S.eff[k] = p[k]; }
    if (e) P.setEnv(e, false);
    if (!sc) S.scenario = 'custom';
  };
  const shadowLog = shadow.map(() => []);
  const shadowCtl = shadow.map(s => s.make());
  const origOnCycle = P.Engine.onCycle.bind(P.Engine), origPause = P.Engine.pauseDecision.bind(P.Engine);
  const emitT = [];
  P.Engine.onCycle = function (c) {
    origOnCycle(c);
    if (c.lowConf) return;
    shadowCtl.forEach((ctl, i) => { const d = ctl.decide(c); if (d && !d.suppressed) shadowLog[i].push({ ...d, ct: c.t, t: S.t, cycle: c.n }); });
  };
  P.Engine.pauseDecision = function (t, dur, esc) {
    origPause(t, dur, esc);
    shadowCtl.forEach((ctl, i) => { if (ctl.notePause && !esc) ctl.notePause(t); const d = ctl.decidePause(t, dur); shadowLog[i].push({ ...d, t: S.t, pause: true }); });
  };
  if (onset) { apply(null, P.DEFAULT_PARAMS, 'lab'); } else { apply(scenario, params, env); }
  // keep the effective parameters identical to the requested ones for steady-state runs
  for (const k in S.params) S.eff[k] = S.params[k];
  const step = 0.05; let switched = false;
  const total = 3.6 + seconds;
  while (S.t < total) {
    if (onset && !switched && S.t >= 3.6 + onset.at) { apply(onset.scenario, onset.params || null, onset.env || null); switched = true; }
    P.simAdvance(step);
  }
  P.Engine.onCycle = origOnCycle; P.Engine.pauseDecision = origPause;
  return {
    truth: truth.slice(), cycles: P.Cycles.items.slice(), pauses: P.Pauses.items.slice(),
    adaptiveLog: P.FB.adaptiveLog.items.slice(), staticLog: P.FB.staticLog.items.slice(), log: P.FB.log.items.slice(),
    shadow: shadowLog, calib: { ...S.calib.residual }, activeStart: P.Stats.activeStart, tEnd: S.t,
    session: P.sessionScores(S.t), withheld: P.Stats.withheld || 0
  };
}

module.exports = { load, runSession, extractSim };
