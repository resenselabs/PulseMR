'use strict';
/* =====================================================================
   PULSEMR simulation: synthetic motion, 30 Hz tracking, filtering,
   compression-cycle detection, metrics, adaptive and static controllers
   ===================================================================== */

/* ---------- 1. synthetic motion model ---------- */
const Gen = {
  rng: makeRng(S.seed),
  segs: [],
  drift: { x: 0, y: 0 },
  corr: { depth: 0, rate: 0, x: 0, y: 0, recoil: 0, pause: 1 },
  lastX: 0, lastY: 0,
  reset(t) {
    this.rng = makeRng(S.seed + S.calib.count * 7919);
    this.segs = []; this.drift = { x: 0, y: 0 };
    this.corr = { depth: 0, rate: 0, x: 0, y: 0, recoil: 0, pause: 1 };
    this.lastX = S.eff.offX; this.lastY = S.eff.offY;
    this.cursor = t;
  },
  next(t0) {
    const r = this.rng, e = S.eff, c = this.corr;
    // hand drift: slow mean-reverting random walk (mm)
    this.drift.x = this.drift.x * 0.94 + r.gauss() * 0.55;
    this.drift.y = this.drift.y * 0.94 + r.gauss() * 0.55;
    const x1 = e.offX + c.x + this.drift.x, y1 = e.offY + c.y + this.drift.y;
    const seg = { t0, x0: this.lastX, y0: this.lastY, x1, y1 };
    if (S.calib.state === 'running') {
      Object.assign(seg, { type: 'calib', t1: t0 + 0.25, D: 0, L: 0 });
    } else if (S.forcedPause) {
      Object.assign(seg, { type: 'pause', t1: t0 + 0.25, D: 0, L: 0, forced: true });
    } else {
      const rate = clamp(e.rate + c.rate + r.gauss() * 2.2, 50, 170);
      const T = 60 / rate;
      const pPause = (e.intFreq * c.pause) / 60 * T;
      if (r() < pPause) {
        Object.assign(seg, { type: 'pause', t1: t0 + 2.5 + r() * 2.5, D: 0, L: 0 });
      } else {
        const D = clamp(e.depth + c.depth + r.gauss() * 1.5, 8, 85);
        const rec = clamp(e.recoil + c.recoil, 50, 100);
        const L = clamp((1 - rec / 100) * D + Math.abs(r.gauss()) * 0.35, 0, D - 4);
        Object.assign(seg, { type: 'cycle', t1: t0 + T, T, D, L });
      }
    }
    this.lastX = x1; this.lastY = y1;
    this.segs.push(seg);
    if (this.segs.length > 64) this.segs.splice(0, this.segs.length - 64);
    return seg;
  },
  ensure(t) {
    if (!this.segs.length) this.next(t);
    let last = this.segs[this.segs.length - 1];
    while (last.t1 <= t) last = this.next(last.t1);
  },
  /* Position of the palm centre at time t in the sternum frame (mm). z > 0 points into the chest. */
  at(t) {
    this.ensure(t);
    let seg = this.segs[this.segs.length - 1];
    for (let i = this.segs.length - 1; i >= 0; i--) { if (this.segs[i].t0 <= t) { seg = this.segs[i]; break; } }
    const k = clamp((t - seg.t0) / Math.max(1e-6, seg.t1 - seg.t0), 0, 1);
    const ks = smooth(Math.min(1, k * 3));
    const x = lerp(seg.x0, seg.x1, ks), y = lerp(seg.y0, seg.y1, ks);
    let z = 0, s = 0;
    if (seg.type === 'cycle') {
      if (k < 0.45) s = 0.5 - 0.5 * Math.cos(Math.PI * k / 0.45);
      else if (k < 0.9) s = 0.5 + 0.5 * Math.cos(Math.PI * (k - 0.45) / 0.45);
      z = seg.L + (seg.D - seg.L) * s;
    } else if (seg.type === 'pause') {
      // hands lift off the chest during a pause and come back at the end
      const lift = seg.forced ? 1 : Math.sin(Math.PI * k);
      z = -26 * Math.min(1, lift * 1.6);
    }
    return { x, y, z, s, seg, k, paused: seg.type === 'pause', calib: seg.type === 'calib' };
  }
};

/* ---------- 2. signal processing ---------- */
/* Second-order Butterworth low-pass, bilinear transform with pre-warping. */
function butter2(fc, fs) {
  const K = Math.tan(Math.PI * fc / fs), q = Math.SQRT2;
  const norm = 1 / (1 + q * K + K * K);
  const b0 = K * K * norm;
  return { b0, b1: 2 * b0, b2: b0, a1: 2 * (K * K - 1) * norm, a2: (1 - q * K + K * K) * norm };
}
const BW = butter2(5, FS);
class Biquad {
  constructor(c) { this.c = c; this.reset(0); }
  reset(v) { this.x1 = this.x2 = v; this.y1 = this.y2 = v; }
  step(x) {
    const c = this.c;
    const y = c.b0 * x + c.b1 * this.x1 + c.b2 * this.x2 - c.a1 * this.y1 - c.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}
class MovingAvg {
  constructor(n) { this.n = n; this.buf = []; }
  reset() { this.buf = []; }
  step(x) { this.buf.push(x); if (this.buf.length > this.n) this.buf.shift(); let s = 0; for (const v of this.buf) s += v; return s / this.buf.length; }
}

const Track = {
  fz: new Biquad(BW), fx: new Biquad(BW), fy: new Biquad(BW),
  mx: new MovingAvg(5), my: new MovingAvg(5),
  nextT: 0, occl: false, last: null, conf: 0.97, jitPhase: 0,
  reset(t) {
    this.nextT = t; this.occl = false; this.last = null;
    this.fz.reset(0); this.fx.reset(S.eff.offX); this.fy.reset(S.eff.offY); this.mx.reset(); this.my.reset();
  }
};

const SAMPLE_COLS = ['tz', 'tx', 'ty', 'rz', 'rx', 'ry', 'fz', 'fx', 'fy', 'conf', 'occ', 'pause', 'calib', 'fbLevel'];
const Samples = new Ring(Math.ceil(FS * REPLAY_SECONDS) + 60, SAMPLE_COLS);

function takeSample(t) {
  const env = ENV_MODES[S.env], r = Gen.rng;
  const g = Gen.at(t);
  const sigma = (S.eff.noise * env.noiseMul + env.noiseAdd);
  // occlusion: two-state Markov process at the sample rate
  if (env.occl) {
    if (!Track.occl && r() < 0.025) Track.occl = true;
    else if (Track.occl && r() < 0.12) Track.occl = false;
  } else Track.occl = false;
  let jit = 0;
  if (env.jitter) { Track.jitPhase += DT_SAMPLE; jit = env.jitter * (Math.sin(2 * Math.PI * 9.3 * Track.jitPhase) * 0.6 + Math.sin(2 * Math.PI * 11.7 * Track.jitPhase + 1.3) * 0.4); }
  const cal = S.calib.residual;
  let rx = g.x + cal.x + r.gauss() * sigma + jit;
  let ry = g.y + cal.y + r.gauss() * sigma - jit * 0.6;
  let rz = g.z + r.gauss() * sigma * 0.55 + jit * 0.5;
  if (Track.occl && Track.last) {
    // observation missing: hold the last filtered estimate and extrapolate the vertical velocity briefly
    rx = Track.last.fx; ry = Track.last.fy; rz = Track.last.fz + (Track.last.fz - Track.last.fzPrev) * 0.3;
  }
  const fzv = Track.fz.step(rz);
  const fxv = Track.mx.step(Track.fx.step(rx));
  const fyv = Track.my.step(Track.fy.step(ry));
  let conf = env.conf - Math.min(0.25, sigma * 0.012) - (Track.occl ? 0.42 : 0);
  conf = clamp(conf + r.gauss() * 0.01, 0.2, 0.99);
  Track.conf = Track.conf * 0.85 + conf * 0.15;
  Track.last = { fx: fxv, fy: fyv, fz: fzv, fzPrev: Track.last ? Track.last.fz : fzv, g, rx, ry, rz };
  Samples.push(t, { tz: g.z, tx: g.x, ty: g.y, rz, rx, ry, fz: fzv, fx: fxv, fy: fyv, conf, occ: Track.occl ? 1 : 0, pause: g.paused ? 1 : 0, calib: g.calib ? 1 : 0, fbLevel: FB.current && t - FB.current.t < 2.5 ? FB.current.level : 0 });
  Detect.step(t, fzv, fxv, fyv, conf, g);
}

/* ---------- 3. compression-cycle detection and metrics ---------- */
const Cycles = new Capped(4000);
const Pauses = new Capped(800);
const Stats = { activeStart: 0, interruptTotal: 0, gcsTrace: [], lastTraceT: -1 };

const Detect = {
  state: 'release', peak: 0, peakT: 0, prevPeakT: null, trough: 0, troughT: 0,
  pos: [0, 0, 0], confSum: 0, confN: 0, occN: 0, pending: null, pauseLive: null, lastPauseDecision: 0,
  reset() {
    this.winN = 0; this.winConf = 0; this.winOcc = 0;
    Object.assign(this, { lastPeakT: null, lastFz: 0, state: 'release', peak: 0, peakT: 0, prevPeakT: null, trough: 0, troughT: 0, pos: [0, 0, 0], confSum: 0, confN: 0, occN: 0, pending: null, pauseLive: null, lastPauseDecision: 0 });
  },
  step(t, fz, fx, fy, conf, g) {
    const prevFz = this.lastFz; this.lastFz = fz;
    if (S.calib.state !== 'done') return;
    // tracking quality over the whole peak-to-peak window (used for the low-confidence gate)
    this.winN = (this.winN || 0) + 1; this.winConf = (this.winConf || 0) + conf; if (Track.occl) this.winOcc = (this.winOcc || 0) + 1;
    if (this.state === 'release') {
      if (fz < this.trough) { this.trough = fz; this.troughT = t; }
      if (fz > 12 && fz - this.trough > 8 && (this.lastPeakT == null || t - this.lastPeakT > 0.3)) {
        // a new compression has started
        let pauseBefore = 0;
        if (this.pauseLive) {
          const p = this.pauseLive; p.t1 = t; p.dur = t - p.t0;
          Pauses.push({ t0: p.t0, t1: t, dur: p.dur });
          Stats.interruptTotal += p.dur; pauseBefore = p.dur;
          this.pauseLive = null; markDirty('pause');
          Engine.onResume(t, p.dur);
        }
        if (this.pending) this.finalize(this.pending, t);
        this.state = 'compress'; this.peak = fz; this.peakT = t; this.peakPrev = prevFz; this.peakNext = null;
        this.pos = [0, 0, 0]; this.confSum = 0; this.confN = 0; this.occN = 0;
        this.pauseBefore = pauseBefore;
      } else if (this.pending && t - this.troughT > 0.6 && t - this.pending.peakT > 1.0) {
        // no new compression soon: close the cycle with the recoil seen so far
        this.finalize(this.pending, t);
      }
      // pause onset is evaluated only while still releasing: a compression that started in this very
      // sample has just ended any pause (v1.0 re-opened the pause here, double-counting interruptions)
      if (this.state === 'release') {
        const lastActive = this.pending ? this.pending.peakT : (this.lastPeakT || Stats.activeStart);
        if (!this.pauseLive && t - lastActive > TARGET.pauseMin + 0.35) {
          this.pauseLive = { t0: lastActive + 0.35, t1: null, dur: 0 };
          markDirty('pause');
          Engine.onPause(t, this.pauseLive);
        }
        if (this.pauseLive) {
          this.pauseLive.dur = t - this.pauseLive.t0;
          Engine.onPauseTick(t, this.pauseLive);
        }
      }
    } else {
      if (fz > this.peak) { this.peakPrev = prevFz; this.peak = fz; this.peakT = t; this.peakNext = null; }
      else if (this.peakNext == null) this.peakNext = fz;
      this.pos[0] += fx; this.pos[1] += fy; this.pos[2]++;
      this.confSum += conf; this.confN++; if (Track.occl) this.occN++;
      if (fz < this.peak - Math.max(6, 0.35 * this.peak)) {
        const n = Math.max(1, this.pos[2]);
        const mx = this.pos[0] / n, my = this.pos[1] / n;
        // sub-sample peak timing and height by parabolic interpolation of the three samples around the maximum
        if (this.peakPrev != null && this.peakNext != null) {
          const a0 = this.peakPrev, b0 = this.peak, c0 = this.peakNext, den = a0 - 2 * b0 + c0;
          if (den < -1e-6) {
            const delta = clamp(0.5 * (a0 - c0) / den, -0.5, 0.5);
            this.peakT += delta * DT_SAMPLE; this.peak = b0 - 0.25 * (a0 - c0) * delta;
          }
        }
        const interval = this.prevPeakT != null ? this.peakT - this.prevPeakT : null;
        const rate = interval != null && interval <= 1.5 && interval >= 0.33 && !this.pauseBefore ? 60 / interval : null;   // 40 to 180 per minute
        this.pending = { peakT: this.peakT, depth: this.peak, interval, rate, posX: mx, posY: my, pos: Math.hypot(mx, my), conf: (this.winConf || 0) / Math.max(1, this.winN || 0), occl: (this.winOcc || 0) / Math.max(1, this.winN || 0), pauseBefore: this.pauseBefore || 0 };
        this.winN = 0; this.winConf = 0; this.winOcc = 0;
        this.prevPeakT = this.peakT; this.lastPeakT = this.peakT;
        this.state = 'release'; this.trough = fz; this.troughT = t;
        Pipeline.flash(2);
      }
    }
  },
  finalize(p, t) {
    this.pending = null;
    const resid = Math.max(0, this.trough);
    const c = {
      n: Cycles.length + Cycles.dropped + 1, t: p.peakT, tEnd: t, depth: p.depth, rate: p.rate, interval: p.interval,
      pos: p.pos, posX: p.posX, posY: p.posY, resid, recoilPct: clamp((p.depth - resid) / Math.max(1, p.depth) * 100, 0, 100),
      pauseBefore: p.pauseBefore, conf: p.conf, occl: p.occl
    };
    c.cls = classify(c);
    // demo rule: compressions measured mostly from estimated (occluded) or low-confidence samples are not scored and get no cue
    c.lowConf = c.occl > 0.2 || c.conf < 0.6;
    c.status = c.lowConf ? 'Low confidence' : statusOf(c);
    c.recoilLabel = resid <= TARGET.recoilFull ? 'Complete' : resid <= TARGET.recoilPartial ? 'Partial' : 'Incomplete';
    Cycles.push(c);
    Engine.onCycle(c);
    markDirty('cycle');
  }
};

function classify(c) {
  return {
    shallow: c.depth < TARGET.depthMin, deep: c.depth > TARGET.depthMax,
    slow: c.rate != null && c.rate < TARGET.rateMin, fast: c.rate != null && c.rate > TARGET.rateMax,
    drift: c.pos > TARGET.posTol, recoil: c.resid > TARGET.recoilFull, pause: c.pauseBefore > 0
  };
}
function statusOf(c) {
  const k = c.cls, issues = [];
  if (k.shallow) issues.push('Shallow'); if (k.deep) issues.push('Too deep');
  if (k.fast) issues.push('Fast'); if (k.slow) issues.push('Slow');
  if (k.drift) issues.push('Off target'); if (k.recoil) issues.push('Partial recoil');
  if (!issues.length) return 'Target';
  return issues.length > 1 ? 'Warning' : issues[0];
}

/* Equal-weighted guideline compliance score, as implemented in this demo:
   mean of depth accuracy, rate accuracy, hand-position accuracy, full-recoil rate and compression fraction (1 - interruption fraction). */
function scoreCycles(list, spanSeconds, pauseSeconds) {
  list = list.filter(c => !c.lowConf);
  const n = list.length;
  if (!n) return null;
  let d = 0, r = 0, rn = 0, p = 0, rc = 0;
  for (const c of list) {
    if (c.depth >= TARGET.depthMin && c.depth <= TARGET.depthMax) d++;
    if (c.rate != null) { rn++; if (c.rate >= TARGET.rateMin && c.rate <= TARGET.rateMax) r++; }
    if (c.pos <= TARGET.posTol) p++;
    if (c.resid <= TARGET.recoilFull) rc++;
  }
  const depthAcc = 100 * d / n, rateAcc = rn ? 100 * r / rn : null, posAcc = 100 * p / n, recoilAcc = 100 * rc / n;
  const IF = spanSeconds > 0 ? clamp(pauseSeconds / spanSeconds, 0, 1) : 0;
  const parts = [depthAcc, rateAcc == null ? depthAcc : rateAcc, posAcc, recoilAcc, 100 * (1 - IF)];
  const gcs = parts.reduce((a, b) => a + b, 0) / parts.length;
  return { n, depthAcc, rateAcc, posAcc, recoilAcc, IF, cf: 1 - IF, gcs };
}
function pauseTimeBetween(t0, t1) {
  let s = 0;
  for (const p of Pauses.items) { const a = Math.max(t0, p.t0), b = Math.min(t1, p.t1); if (b > a) s += b - a; }
  if (Detect.pauseLive) { const a = Math.max(t0, Detect.pauseLive.t0), b = Math.min(t1, S.t); if (b > a) s += b - a; }
  return s;
}
/* Scores for the last ROLL_N cycles up to time t (live or replay). */
function rollingScores(tNow = S.t, nWin = ROLL_N) {
  const all = Cycles.items;
  let end = all.length;
  if (tNow < S.t) { end = 0; while (end < all.length && all[end].t <= tNow) end++; }
  const list = all.slice(Math.max(0, end - nWin), end);
  if (!list.length) return null;
  const t0 = list[0].t - (list[0].interval || 0.55);
  return scoreCycles(list, Math.max(1, tNow - t0), pauseTimeBetween(t0, tNow));
}
function sessionScores(tNow = S.t) {
  const all = Cycles.items;
  let end = all.length;
  if (tNow < S.t) { end = 0; while (end < all.length && all[end].t <= tNow) end++; }
  const list = all.slice(0, end);
  if (!list.length) return null;
  const t0 = Math.max(Stats.activeStart, list[0].t - 0.6);
  return scoreCycles(list, Math.max(1, tNow - t0), pauseTimeBetween(t0, tNow));
}

/* ---------- 4. adaptive and static feedback controllers ---------- */
const MSG = {
  depth: { low: ['PUSH DEEPER', 'Push deeper'], high: ['REDUCE DEPTH', 'Reduce depth'] },
  rate: { slow: ['FASTER', 'Faster'], fast: ['SLOWER', 'Slower'] },
  position: { any: ['ADJUST HAND POSITION', 'Adjust hand position'] },
  recoil: { any: ['RELEASE FULLY', 'Release fully'] },
  interrupt: { any: ['RESUME COMPRESSIONS', 'Resume compressions'] },
  none: { any: ['GOOD COMPRESSIONS', ''] },
  gooddepth: { any: ['GOOD DEPTH', ''] }
};
function deviations(c) {
  const d = { depth: 0, rate: 0, position: 0, recoil: 0, interrupt: 0 }, dir = {};
  if (c.depth < TARGET.depthMin) { d.depth = (TARGET.depthMin - c.depth) / 15; dir.depth = 'low'; }
  else if (c.depth > TARGET.depthMax) { d.depth = (c.depth - TARGET.depthMax) / 15; dir.depth = 'high'; }
  if (c.rate != null) {
    if (c.rate < TARGET.rateMin) { d.rate = (TARGET.rateMin - c.rate) / 20; dir.rate = 'slow'; }
    else if (c.rate > TARGET.rateMax) { d.rate = (c.rate - TARGET.rateMax) / 20; dir.rate = 'fast'; }
  }
  if (c.pos > TARGET.posTol) { d.position = (c.pos - TARGET.posTol) / 20; dir.position = 'any'; }
  if (c.resid > TARGET.recoilFull) { d.recoil = (c.resid - TARGET.recoilFull) / 6; dir.recoil = 'any'; }
  return { d, dir };
}
const levelOf = e => e <= 0 ? 0 : e < 0.35 ? 1 : e < 1.0 ? 2 : 3;
const DEV_WORD = ['None', 'Small', 'Moderate', 'Significant'];
const PRIORITY = { 3: 'HIGH', 2: 'MEDIUM', 1: 'LOW', 0: 'NONE' };
const EXTRA_MODALITY = { depth: 'haptic', rate: 'audio', position: 'visual', recoil: 'haptic', interrupt: 'audio' };
function moduleEnabled(m) {
  const a = S.ablation;
  return !((a === 'hand' && m === 'position') || (a === 'depth' && m === 'depth') || (a === 'rate' && m === 'rate'));
}
function capLevel(L) { return Math.min(L, S.prefs.intensityCap); }

class StaticController {
  constructor() { this.reset(); }
  reset() { this.n = 0; this.log = []; }
  decide(c) {
    this.n++;
    const { d, dir } = deviations(c);
    for (const m of ['depth', 'rate', 'position', 'recoil']) {
      if (d[m] > 0 && moduleEnabled(m)) {
        const L = capLevel(Math.max(1, levelOf(d[m])));
        const mods = L === 1 ? ['visual'] : L === 2 ? ['visual', 'audio'] : ['visual', 'audio', 'haptic'];
        return this.make(c.t, m, dir[m], d[m], d[m], L, mods, d, null);
      }
    }
    return null;
  }
  decidePause(t, dur) {
    const dev = 0.5 + (dur - TARGET.pauseMin) / 4;
    const L = capLevel(levelOf(dev));
    return this.make(t, 'interrupt', 'any', dev, dev, L, L >= 3 ? ['visual', 'audio', 'haptic'] : ['visual', 'audio'], null, null);
  }
  make(t, m, dir, dev, eff, L, mods, all, w) {
    if (S.ablation === 'haptic') mods = mods.filter(x => x !== 'haptic');
    const msg = (MSG[m][dir] || MSG[m].any);
    return { t, metric: m, dir, dev, eff, level: L, modalities: mods, message: msg[0], speech: msg[1], all, weights: w, ctl: 'static' };
  }
}

class AdaptiveController extends StaticController {
  /* opts switch individual mechanisms off for ablation experiments; the app always uses the defaults */
  constructor(opts = {}) { super(); this.opt = { personalize: true, suppress: true, escalate: true, fade: true, confirm: true, ...opts }; }
  reset() {
    super.reset();
    this.buf = []; this.base = null; this.baseAcc = [];
    this.w = { depth: 1, rate: 1, position: 1, recoil: 1, interrupt: 1 };
    this.lastIssued = {}; this.cueRepeats = {}; this.lastCue = null; this.pausesRecent = [];
    this.confirmEvery = 4;
  }
  decide(c) {
    this.n++;
    const { d, dir } = deviations(c);
    this.buf.push(d); if (this.buf.length > HISTORY_N) this.buf.shift();
    if (!this.base) {
      this.baseAcc.push(d);
      if (this.baseAcc.length >= BASELINE_N) {
        this.base = {};
        for (const m of ['depth', 'rate', 'position', 'recoil']) this.base[m] = this.baseAcc.reduce((a, x) => a + x[m], 0) / this.baseAcc.length;
      }
    }
    const persist = {}, mean = {};
    for (const m of ['depth', 'rate', 'position', 'recoil']) {
      persist[m] = this.buf.filter(x => x[m] > 0).length / this.buf.length;
      mean[m] = this.buf.reduce((a, x) => a + x[m], 0) / this.buf.length;
      if (this.opt.personalize) this.w[m] = (1 - ALPHA) * this.w[m] + ALPHA * (1 + persist[m]);
    }
    this.persist = persist; this.mean = mean;
    const eff = {};
    let best = null;
    for (const m of ['depth', 'rate', 'position', 'recoil']) {
      eff[m] = moduleEnabled(m) ? this.w[m] * d[m] : 0;
      if (eff[m] > 0 && (!best || eff[m] > eff[best])) best = m;
    }
    if (!best) {
      // minimal visual confirmation, not every cycle
      if (this.opt.confirm && this.n % this.confirmEvery === 0 && S.prefs.intensityCap >= 1) {
        const m = c.depth >= TARGET.depthMin && c.depth <= TARGET.depthMax ? 'gooddepth' : 'none';
        return { ...this.make(c.t, m, 'any', 0, 0, 1, ['visual'], d, { ...this.w }), confirm: true, all: d, effAll: eff };
      }
      return null;
    }
    // deviation level follows the decision matrix on the raw deviation; personalisation lowers only the
    // small-to-moderate threshold for metrics that keep recurring (sensitivity), never the targets
    const t1 = 0.35 / Math.sqrt(this.w[best]);
    let L = d[best] >= 1.0 ? 3 : d[best] >= t1 ? 2 : 1;
    this.t1 = { depth: 0.35 / Math.sqrt(this.w.depth), rate: 0.35 / Math.sqrt(this.w.rate), position: 0.35 / Math.sqrt(this.w.position), recoil: 0.35 / Math.sqrt(this.w.recoil) };
    let note = '';
    // trainee is improving against their own baseline: lighter touch
    if (this.opt.fade && this.base && this.base[best] > 0 && mean[best] < 0.5 * this.base[best] && L > 1) { L -= 1; note = 'improving against personal baseline: intensity reduced'; }
    let mods = L === 1 ? ['visual'] : L === 2 ? ['visual', EXTRA_MODALITY[best]] : ['visual', 'audio', 'haptic'];
    mods = [...new Set(mods)];
    // recurring deficit with the same cue: add a modality instead of repeating it
    const cueKey = best + ':' + mods.join('+');
    this.cueRepeats[cueKey] = (this.lastCue === cueKey ? (this.cueRepeats[cueKey] || 0) + 1 : 0);
    if (this.opt.escalate && persist[best] >= 0.6 && this.cueRepeats[cueKey] >= 3 && mods.length < 3) {
      for (const add of ['haptic', 'audio']) if (!mods.includes(add)) { mods.push(add); break; }
      note = note || 'recurring deficit: extra modality added';
    }
    this.lastCue = best + ':' + mods.join('+');
    L = capLevel(Math.max(1, L));
    // avoid repeating an identical moderate cue on consecutive cycles
    const key = best + L;
    if (this.opt.suppress && L < 3 && this.lastIssued[key] != null && this.n - this.lastIssued[key] < 2) return { suppressed: true, metric: best, level: L };
    this.lastIssued[key] = this.n;
    const dec = this.make(c.t, best, dir[best], d[best], eff[best], L, mods, d, { ...this.w });
    dec.ctl = 'adaptive'; dec.note = note; dec.persist = persist[best]; dec.effAll = eff;
    return dec;
  }
  decidePause(t, dur) {
    this.pausesRecent = this.pausesRecent.filter(x => t - x < 60);
    const recurring = this.pausesRecent.length >= 2;
    const dev = 0.5 + (dur - TARGET.pauseMin) / 4 + (recurring ? 0.4 : 0);
    const L = capLevel(levelOf(dev));
    const dec = this.make(t, 'interrupt', 'any', dev, dev, L, L >= 3 ? ['visual', 'audio', 'haptic'] : ['visual', 'audio'], null, { ...this.w });
    dec.ctl = 'adaptive'; dec.note = recurring ? 'recurring pauses: urgency raised' : '';
    return dec;
  }
  notePause(t) { this.pausesRecent.push(t); }
}

/* ---------- 5. engine: runs both controllers, delivers feedback, logs ---------- */
const FB = { current: null, log: new Capped(3000), shadow: new Capped(3000), adaptiveLog: new Capped(3000), staticLog: new Capped(3000), decisions: new Capped(400) };
const Ctl = { adaptive: new AdaptiveController(), static: new StaticController() };

const Engine = {
  onCycle(c) {
    if (c.lowConf) {
      FB.decisions.push({ t: c.t, n: c.n, adaptive: null, static: null, withheld: true, used: S.controller === 'adaptive' && S.ablation !== 'adaptive' ? 'adaptive' : 'static' });
      c.fb = 'Withheld · low tracking confidence'; c.fbLevel = 0; Stats.withheld = (Stats.withheld || 0) + 1;
      Pipeline.flash(3);
      return;
    }
    const a = Ctl.adaptive.decide(c);
    const s = Ctl.static.decide(c);
    if (a && !a.suppressed) FB.adaptiveLog.push(a);
    if (s) FB.staticLog.push(s);
    const active = S.controller === 'adaptive' && S.ablation !== 'adaptive' ? a : s;
    FB.decisions.push({ t: c.t, n: c.n, adaptive: a, static: s, used: S.controller === 'adaptive' && S.ablation !== 'adaptive' ? 'adaptive' : 'static' });
    c.fb = !active ? 'None' : active.suppressed ? 'Same cue held' : active.message;
    c.fbLevel = active && !active.suppressed ? active.level : 0;
    Pipeline.flash(3); setTimeout(() => Pipeline.flash(4), 140);
    if (active && !active.suppressed) this.deliver(active, c);
    if (S.learner) Learner.react(active && !active.suppressed ? active : null);
    // live GCS trace for the trajectory chart
    if (S.t - Stats.lastTraceT >= 5) {
      const r = rollingScores();
      if (r) { Stats.gcsTrace.push({ t: S.t - Stats.activeStart, gcs: r.gcs }); Stats.lastTraceT = S.t; if (Stats.gcsTrace.length > 400) Stats.gcsTrace.shift(); }
    }
  },
  onPause(t, p) {
    Ctl.adaptive.notePause(t);
    this.pauseDecision(t, p.dur || TARGET.pauseMin, false);
  },
  onPauseTick(t, p) {
    if (p.dur > 3.5 && !p.escalated) { p.escalated = true; this.pauseDecision(t, p.dur, true); }
  },
  pauseDecision(t, dur, escalation) {
    const a = Ctl.adaptive.decidePause(t, dur), s = Ctl.static.decidePause(t, dur);
    FB.adaptiveLog.push(a); FB.staticLog.push(s);
    const active = S.controller === 'adaptive' && S.ablation !== 'adaptive' ? a : s;
    this.deliver(active, null);
  },
  onResume(t, dur) { markDirty('pause'); },
  deliver(dec, c) {
    dec.t = S.t;
    dec.cycle = c ? c.n : null;
    FB.current = dec;
    FB.log.push(dec);
    Pipeline.flash(5);
    markDirty('feedback');
    if (typeof Feedback !== 'undefined') Feedback.emit(dec);
  }
};

/* Optional synthetic trainee that reacts to feedback (off by default). Its rules are illustrative only. */
const Learner = {
  repeats: 0, lastCue: '',
  react(dec) {
    const c = Gen.corr;
    for (const k of ['depth', 'rate', 'x', 'y', 'recoil']) c[k] *= 0.997;
    if (!dec || dec.confirm) return;
    const cue = dec.metric + dec.level + dec.modalities.join('');
    this.repeats = cue === this.lastCue ? this.repeats + 1 : 0; this.lastCue = cue;
    const gain = 0.06 * dec.level * (1 + 0.3 * (dec.modalities.length - 1)) * Math.pow(0.8, this.repeats);
    const e = S.eff;
    if (dec.metric === 'depth') c.depth += gain * (TARGET.depthMid - (e.depth + c.depth));
    if (dec.metric === 'rate') c.rate += gain * (TARGET.rateMid - (e.rate + c.rate));
    if (dec.metric === 'position') { c.x += gain * (0 - (e.offX + c.x)); c.y += gain * (0 - (e.offY + c.y)); }
    if (dec.metric === 'recoil') c.recoil += gain * (100 - (e.recoil + c.recoil));
    if (dec.metric === 'interrupt') c.pause = Math.max(0.2, c.pause * (1 - gain));
  },
  reset() { this.repeats = 0; this.lastCue = ''; Object.assign(Gen.corr, { depth: 0, rate: 0, x: 0, y: 0, recoil: 0, pause: 1 }); }
};

/* ---------- 6. process pipeline activity (for the tracker) ---------- */
const Pipeline = {
  last: [0, 0, 0, 0, 0, 0], active: 0,
  flash(i) { this.last[i] = performance.now(); this.active = i; markDirty('pipeline'); }
};

/* ---------- 7. calibration ---------- */
const CALIB_STEPS = ['CALIBRATION STARTED', 'REFERENCE POSITION DETECTED', 'STERNUM COORDINATE FRAME ESTABLISHED', 'CALIBRATION COMPLETE'];
function startCalibration() {
  S.calib.state = 'running'; S.calib.t0 = S.t; S.calib.step = 0; S.calib.count++;
  const env = ENV_MODES[S.env], r = makeRng(S.seed + S.calib.count * 31);
  const sd = 0.9 + env.noiseAdd * 0.8;
  S.calib.residual = { x: r.gauss() * sd, y: r.gauss() * sd };
  Gen.segs = []; Gen.ensure(S.t);
  Detect.reset(); Track.reset(S.t);
  Pipeline.flash(0);
  markDirty('calib');
  if (typeof Feedback !== 'undefined') Feedback.calibStep(0);
}
function updateCalibration() {
  if (S.calib.state !== 'running') return;
  const k = Math.floor((S.t - S.calib.t0) / 0.9);
  if (k !== S.calib.step && k < CALIB_STEPS.length) {
    S.calib.step = k; Pipeline.flash(0); markDirty('calib');
    if (typeof Feedback !== 'undefined') Feedback.calibStep(k);
  }
  if (S.t - S.calib.t0 >= 3.6) {
    S.calib.state = 'done'; S.calib.step = 3;
    if (!Stats.activeStart) Stats.activeStart = S.t;
    Gen.segs = []; Gen.ensure(S.t);
    Pipeline.flash(1);
    markDirty('calib');
  }
}

/* ---------- 8. parameters, scenarios, demo ---------- */
function setParam(k, v, fromUser = true) {
  S.params[k] = v;
  if (fromUser) { S.demo.active = false; if (S.scenario !== 'custom' && fromUser !== 'scenario') S.scenario = 'custom'; Learner.reset(); }
  markDirty('params');
}
function applyScenario(key, opts = {}) {
  const sc = SCENARIOS.find(s => s.key === key); if (!sc) return;
  S.scenario = key; S.dynT0 = S.t;
  if (!opts.keepDemo) S.demo.active = false;
  const base = { ...DEFAULT_PARAMS, ...SCENARIOS[0].p, ...sc.p };
  for (const k in base) S.params[k] = base[k];
  setEnv(sc.env || 'lab', false);
  Learner.reset();
  markDirty('params', 'scenario');
}
function setEnv(key, user = true) {
  S.env = key; markDirty('env');
  if (user && typeof Feedback !== 'undefined' && ENV_MODES[key].warn) UI.toast(ENV_MODES[key].warn, 'warn');
}
function dynamicScenario() {
  const dt = S.t - (S.dynT0 || 0);
  if (S.scenario === 'drift') {
    const k = clamp(dt / 22, 0, 1);
    S.params.offX = Math.round(24 * smooth(k)); S.params.offY = Math.round(-21 * smooth(k));
    markDirty('params');
  } else if (S.scenario === 'mixed') {
    const phase = Math.floor(dt / 12) % 4;
    const sets = [{ depth: 40, rate: 112, offX: 0, offY: 0, recoil: 100 }, { depth: 55, rate: 136, offX: 0, offY: 0, recoil: 100 }, { depth: 54, rate: 110, offX: 26, offY: 18, recoil: 100 }, { depth: 56, rate: 108, offX: 0, offY: 0, recoil: 80 }];
    if (phase !== S.mixedPhase) { S.mixedPhase = phase; Object.assign(S.params, sets[phase]); markDirty('params'); }
  }
}
function updateEffective(dt) {
  const tau = S.scenarioSwitching ? 1.4 : 0.6;
  const k = 1 - Math.exp(-dt / tau);
  for (const key in S.params) S.eff[key] = S.eff[key] + (S.params[key] - S.eff[key]) * k;
}
/* First-load demonstration: stable compressions, then a shallow phase so the controller visibly reacts. */
function updateDemo() {
  if (!S.demo.active) return;
  const t = S.t;
  if (S.demo.stage === 0 && t > 15) {
    S.demo.stage = 1; applyScenario('shallow', { keepDemo: true });
    if (typeof UI !== 'undefined') UI.toast('Demonstration: shallow compressions (38 mm). Watch the adaptive feedback respond.', 'info');
  } else if (S.demo.stage === 1 && t > 36) {
    S.demo.stage = 2; applyScenario('stable', { keepDemo: true });
    if (typeof UI !== 'undefined') UI.toast('Demonstration: back to stable compressions.', 'info');
  } else if (S.demo.stage === 2 && t > 40) { S.demo.active = false; }
}

/* ---------- 9. clock ---------- */
function simAdvance(realDt) {
  if (!S.running || S.mode === 'replay') return;
  const dt = Math.min(0.1, realDt) * S.speed;
  S.t += dt;
  updateEffective(dt);
  updateCalibration();
  updateDemo();
  dynamicScenario();
  // generate every 30 Hz sample that falls inside the step
  let guard = 0;
  while (Track.nextT <= S.t && guard++ < 200) { takeSample(Track.nextT); Track.nextT += DT_SAMPLE; }
}

function resetSession(recal = true) {
  S.t = 0; Samples.clear(); Cycles.clear(); Pauses.clear();
  FB.current = null; FB.log.clear(); FB.adaptiveLog.clear(); FB.staticLog.clear(); FB.decisions.clear();
  Ctl.adaptive.reset(); Ctl.static.reset(); Learner.reset();
  Stats.activeStart = 0; Stats.interruptTotal = 0; Stats.gcsTrace = []; Stats.lastTraceT = -1; Stats.withheld = 0;
  Detect.reset(); Track.reset(0);
  S.calib.count = 0;
  Gen.reset(0);
  if (recal) startCalibration();
  markDirty('all');
}

/* ---------- 10. synthetic static-versus-adaptive projection (cycle-level, no 30 Hz) ---------- */
function runProjection(scenarioKey, minutes = 10) {
  const sc = SCENARIOS.find(s => s.key === scenarioKey) || SCENARIOS[0];
  const habit = { ...DEFAULT_PARAMS, ...SCENARIOS[0].p, ...sc.p };
  if (scenarioKey === 'drift') { habit.offX = 24; habit.offY = -21; }
  if (scenarioKey === 'mixed') { habit.depth = 44; habit.rate = 128; habit.offX = 14; habit.recoil = 88; }
  if (scenarioKey === 'occlusion') habit.noise = 2.5;
  const out = {};
  for (const kind of ['static', 'adaptive']) {
    const rng = makeRng(777 + scenarioKey.length * 13);
    const ctl = kind === 'adaptive' ? new AdaptiveController() : new StaticController();
    const corr = { depth: 0, rate: 0, x: 0, y: 0, recoil: 0, pause: 1 };
    let t = 0, repeats = 0, lastCue = '', n = 0, pauseT = 0;
    const cycles = [], events = [], curve = [], pauses = [];
    const pausedIn = (a0, a1) => { let s = 0; for (const p of pauses) { const x = Math.max(a0, p.t0), y = Math.min(a1, p.t1); if (y > x) s += y - x; } return s; };
    const react = dec => {
      for (const k of ['depth', 'rate', 'x', 'y', 'recoil']) corr[k] *= 0.997;
      if (!dec || dec.confirm || dec.suppressed) return;
      const cue = dec.metric + dec.level + dec.modalities.join('');
      repeats = cue === lastCue ? repeats + 1 : 0; lastCue = cue;
      const gain = 0.06 * dec.level * (1 + 0.3 * (dec.modalities.length - 1)) * Math.pow(0.8, repeats);
      if (dec.metric === 'depth') corr.depth += gain * (TARGET.depthMid - (habit.depth + corr.depth));
      if (dec.metric === 'rate') corr.rate += gain * (TARGET.rateMid - (habit.rate + corr.rate));
      if (dec.metric === 'position') { corr.x += gain * (0 - (habit.offX + corr.x)); corr.y += gain * (0 - (habit.offY + corr.y)); }
      if (dec.metric === 'recoil') corr.recoil += gain * (100 - (habit.recoil + corr.recoil));
      if (dec.metric === 'interrupt') corr.pause = Math.max(0.2, corr.pause * (1 - gain));
    };
    while (t < minutes * 60) {
      const rate = clamp(habit.rate + corr.rate + rng.gauss() * 2.2, 50, 170), T = 60 / rate;
      if (rng() < habit.intFreq * corr.pause / 60 * T) {
        const dur = 2.5 + rng() * 2.5; pauseT += dur; pauses.push({ t0: t, t1: t + dur });
        const dec = ctl.decidePause(t + TARGET.pauseMin, dur);
        if (ctl.notePause) ctl.notePause(t);
        events.push(dec); react(dec); t += dur; continue;
      }
      const depth = clamp(habit.depth + corr.depth + rng.gauss() * 1.6, 8, 85);
      const rec = clamp(habit.recoil + corr.recoil, 50, 100);
      const resid = clamp((1 - rec / 100) * depth + Math.abs(rng.gauss()) * 0.4, 0, depth - 4);
      const sd = habit.noise * 0.7 + 0.4;
      const px = habit.offX + corr.x + rng.gauss() * sd, py = habit.offY + corr.y + rng.gauss() * sd;
      const c = { t, depth, rate: n ? rate : null, pos: Math.hypot(px, py), resid, pauseBefore: 0 };
      n++; cycles.push(c);
      const dec = ctl.decide(c);
      if (dec && !dec.suppressed && !dec.confirm) events.push(dec);
      react(dec);
      t += T;
      if (curve.length === 0 || t - curve[curve.length - 1].t >= 30) {
        const win = cycles.slice(-ROLL_N);
        const span = Math.max(1, t - win[0].t);
        const sc2 = scoreCycles(win, span, pausedIn(win[0].t, t));
        curve.push({ t, gcs: sc2.gcs });
      }
    }
    const mods = { visual: 0, audio: 0, haptic: 0 };
    let lvl = 0, reps = 0, prev = '';
    for (const e of events) { for (const m of e.modalities) mods[m]++; lvl += e.level; if (e.message === prev) reps++; prev = e.message; }
    const lastWin = cycles.slice(-ROLL_N);
    const final = lastWin.length ? scoreCycles(lastWin, Math.max(1, t - lastWin[0].t), pausedIn(lastWin[0].t, t)) : null;
    out[kind] = { curve, events: events.length, mods, meanLevel: events.length ? lvl / events.length : 0, repeats: reps, finalGcs: final ? final.gcs : null, cycles: cycles.length };
  }
  return out;
}
