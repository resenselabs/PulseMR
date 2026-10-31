'use strict';
/* =====================================================================
   PULSEMR core: constants, fixed research values, shared state, helpers
   ===================================================================== */

const FS = 30;                         // simulated hand-tracking rate (Hz)
const DT_SAMPLE = 1 / FS;
const ALPHA = 0.3;                     // adaptation coefficient stated in the manuscript
const BASELINE_N = 5;                  // compressions used to initialise the personal baseline
const HISTORY_N = 10;                  // compressions used for personalised adjustment
const ROLL_N = 20;                     // cycles in the rolling session-quality window
const REPLAY_SECONDS = 600;            // replay keeps the last 10 simulated minutes
const VIS = 1.8;                       // 3D vertical motion exaggeration (numbers stay in true mm)

/* Guideline ranges used by the manuscript. The controller never changes these. */
const TARGET = Object.freeze({
  depthMin: 50, depthMax: 60, depthMid: 55,
  rateMin: 100, rateMax: 120, rateMid: 110,
  posTol: 20,                          // mm, hand-position accuracy threshold
  recoilFull: 3,                       // mm residual or less counts as full recoil (demo threshold)
  recoilPartial: 8,                    // mm residual above this counts as incomplete (demo threshold)
  pauseMin: 1.2                        // s without a compression before an interruption is counted
});

/* Reported values supplied with the manuscript summary. Never changed by the simulation. */
const RESEARCH = Object.freeze({
  participants: 24,
  conditions: Object.freeze({
    metronome:  Object.freeze({ key: 'metronome', name: 'Metronome-only', short: 'Metronome', depth: 52.3, rate: 68.4, hand: 71.2, gcs: 62.4, interruption: null }),
    av:         Object.freeze({ key: 'av', name: 'Conventional audio-visual instruction', short: 'Audio-visual', depth: 58.1, rate: 72.3, hand: 73.8, gcs: 67.3, interruption: 0.18 }),
    commercial: Object.freeze({ key: 'commercial', name: 'Commercial feedback device', short: 'Commercial device', depth: 64.2, rate: 76.1, hand: 75.6, gcs: 72.8, interruption: null }),
    mr:         Object.freeze({ key: 'mr', name: 'Adaptive MR guidance', short: 'Adaptive MR', depth: 75.6, rate: 82.4, hand: 84.3, gcs: 83.5, interruption: 0.08 })
  }),
  ablation: Object.freeze([
    Object.freeze({ key: 'full', name: 'Full system', gcs: 83.5 }),
    Object.freeze({ key: 'hand', name: 'Without hand-position guidance', gcs: 74.2 }),
    Object.freeze({ key: 'depth', name: 'Without depth feedback', gcs: 72.8 }),
    Object.freeze({ key: 'rate', name: 'Without rate feedback', gcs: 77.1 }),
    Object.freeze({ key: 'adaptive', name: 'Without adaptive adjustment', gcs: 73.6 }),
    Object.freeze({ key: 'haptic', name: 'Without haptic feedback', gcs: 79.2 })
  ]),
  latency: Object.freeze({ median: 47, iqr: Object.freeze([34, 67]), visual: 28, auditory: 35, haptic: 72, combined: 64 }),
  hardware: Object.freeze(['Microsoft HoloLens 2', 'Unity 2019.4', 'Mixed Reality Toolkit 2.7', 'Hand tracking at 30 Hz, 25 articulated joints per hand', 'Laerdal Resusci Anne QCPR manikin'])
});

/* ---------------- small helpers ---------------- */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = k => k * k * (3 - 2 * k);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt1 = v => (v == null || !isFinite(v)) ? 'n/a' : v.toFixed(1);
const fmt0 = v => (v == null || !isFinite(v)) ? 'n/a' : Math.round(v).toString();
function fmtClock(t) {
  t = Math.max(0, t);
  const m = Math.floor(t / 60), s = t - m * 60;
  return String(m).padStart(2, '0') + ':' + s.toFixed(1).padStart(4, '0');
}
function fmtStamp(t) {
  t = Math.max(0, t);
  const m = Math.floor(t / 60), s = t - m * 60;
  return String(m).padStart(2, '0') + ':' + s.toFixed(3).padStart(6, '0');
}

/* Seeded generator (mulberry32) so a session can be repeated. */
function makeRng(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return r;
}

/* Column-oriented ring buffer for 30 Hz samples (also the replay store). */
class Ring {
  constructor(cap, cols) {
    this.cap = cap; this.n = 0; this.head = 0; this.cols = cols;
    for (const c of cols) this[c] = new Float32Array(cap);
    this.time = new Float64Array(cap);
  }
  push(t, row) {
    const i = this.head;
    this.time[i] = t;
    for (const c of this.cols) this[c][i] = row[c] || 0;
    this.head = (i + 1) % this.cap;
    if (this.n < this.cap) this.n++;
  }
  idx(k) { return (this.head - this.n + k + this.cap) % this.cap; }   // k = 0 oldest
  get length() { return this.n; }
  first() { return this.n ? this.time[this.idx(0)] : 0; }
  last() { return this.n ? this.time[this.idx(this.n - 1)] : 0; }
  /* index k (0 = oldest) of the last sample with time <= t */
  find(t) {
    let lo = 0, hi = this.n - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.time[this.idx(mid)] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }
  clear() { this.n = 0; this.head = 0; }
}

/* Small capped array used for cycles and feedback logs. */
class Capped {
  constructor(cap) { this.cap = cap; this.items = []; this.dropped = 0; }
  push(x) { this.items.push(x); if (this.items.length > this.cap) { this.items.shift(); this.dropped++; } }
  get length() { return this.items.length; }
  last(n = 1) { return n === 1 ? this.items[this.items.length - 1] : this.items.slice(-n); }
  clear() { this.items = []; this.dropped = 0; }
}

/* ---------------- shared application state ---------------- */
const DEFAULT_PARAMS = Object.freeze({ depth: 55, rate: 110, offX: 0, offY: 0, recoil: 100, intFreq: 0, noise: 1.0 });

const S = {
  version: '1.1',
  t: 0,                    // simulated seconds since the session started
  speed: 1,
  running: true,
  mode: 'train',           // train | mr | assess | compare | replay
  area: 'overview',
  view: 'iso',
  theme: 'light',
  lighting: 'day',         // day | dim
  env: 'lab',              // lab | low | occl | motion
  controller: 'adaptive',  // adaptive | static
  ablation: 'full',        // full | hand | depth | rate | adaptive | haptic (illustrative)
  learner: false,          // synthetic trainee reacts to feedback
  scenario: 'stable',
  params: { ...DEFAULT_PARAMS },        // what the user asked for
  eff: { ...DEFAULT_PARAMS },           // smoothed values actually driving the motion model
  forcedPause: false,
  audio: { enabled: false, rhythm: 'feedback', voice: true, chimes: true },
  haptics: { vibrate: false },
  overlay: { on: true, joints: true, anchor: true, axis: true, traj: true, arrows: true },
  prefs: { reducedMotion: false, contrast: false, intensityCap: 3, simpleLandmarks: false },
  calib: { state: 'idle', t0: 0, step: 0, residual: { x: 0, y: 0 }, count: 0 },
  demo: { active: true, stage: 0 },
  selected: null,
  replay: { t: 0, playing: false, speed: 1 },
  wavePaused: false,
  dirty: new Set(),
  seed: 20261026
};
function markDirty(...k) { for (const x of k) S.dirty.add(x); }

/* Scenario presets for the scenario lab. Dynamic ones change parameters over time. */
const SCENARIOS = [
  { key: 'stable', name: 'Stable performance', blurb: 'Depth near 55 mm, rate near 110 per minute, hands on target, full recoil.', p: { depth: 55, rate: 110, offX: 0, offY: 0, recoil: 100, intFreq: 0, noise: 1.0 }, env: 'lab' },
  { key: 'shallow', name: 'Shallow compressions', blurb: 'Compressions near 38 mm, below the 50 to 60 mm range.', p: { depth: 38 } },
  { key: 'deep', name: 'Excessive depth', blurb: 'Compressions near 67 mm, above the range.', p: { depth: 67 } },
  { key: 'fast', name: 'Fast compressions', blurb: 'About 138 compressions per minute.', p: { rate: 138 } },
  { key: 'slow', name: 'Slow compressions', blurb: 'About 84 compressions per minute.', p: { rate: 84 } },
  { key: 'drift', name: 'Hand-position drift', blurb: 'Hands drift slowly off the sternum target to about 32 mm.', p: {}, dyn: 'drift' },
  { key: 'recoil', name: 'Incomplete recoil', blurb: 'The chest is not released fully between compressions.', p: { recoil: 82 } },
  { key: 'pauses', name: 'Frequent interruptions', blurb: 'About three pauses per minute, each 2.5 to 5 s.', p: { intFreq: 3 } },
  { key: 'occlusion', name: 'Tracking occlusion', blurb: 'Hand landmarks drop out at times; tracking confidence falls.', p: {}, env: 'occl' },
  { key: 'mixed', name: 'Mixed performance errors', blurb: 'Errors rotate every 12 s: shallow, fast, drifting, incomplete recoil.', p: {}, dyn: 'mixed' }
];

const ENV_MODES = {
  lab:    { key: 'lab', name: 'Controlled lab', short: 'A', noiseAdd: 0, noiseMul: 1, conf: 0.97, jitter: 0, occl: false, warn: '' },
  low:    { key: 'low', name: 'Low light', short: 'B', noiseAdd: 1.5, noiseMul: 1.8, conf: 0.8, jitter: 0, occl: false, warn: 'Low light: tracking uncertainty raised' },
  occl:   { key: 'occl', name: 'Partial occlusion', short: 'C', noiseAdd: 0.6, noiseMul: 1.2, conf: 0.9, jitter: 0, occl: true, warn: 'Landmarks partly occluded: some positions estimated' },
  motion: { key: 'motion', name: 'Motion disturbance', short: 'D', noiseAdd: 1.0, noiseMul: 1.3, conf: 0.84, jitter: 3.5, occl: false, warn: 'Hand jitter detected: filter smoothing high-frequency noise' }
};

const METRICS = ['interrupt', 'depth', 'rate', 'position', 'recoil'];
const METRIC_LABEL = { depth: 'Depth', rate: 'Rate', position: 'Position', recoil: 'Recoil', interrupt: 'Interruption' };
