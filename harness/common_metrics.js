/* Shared ground-truth matching and statistics for the PULSEMR experiments. */
'use strict';

/* mulberry32 for experiment-level draws (independent of the simulator's own generator) */
function rng(seed) {
  let a = seed >>> 0;
  const r = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.uni = (lo, hi) => lo + (hi - lo) * r();
  return r;
}
const smooth = k => k * k * (3 - 2 * k);
const lerp = (a, b, k) => a + (b - a) * k;

/* True mean palm position during the pressing phase of a cycle segment (same motion law as the generator). */
function truePos(s) {
  let x = 0, y = 0, n = 0;
  for (let k = 0.1; k <= 0.65 + 1e-9; k += 0.011) { const ks = smooth(Math.min(1, k * 3)); x += lerp(s.x0, s.x1, ks); y += lerp(s.y0, s.y1, ks); n++; }
  return { x: x / n, y: y / n };
}
const truePeak = s => s.t0 + 0.45 * s.T;

/* One-to-one matching of detected cycles to true compression segments by peak time. */
function match(run, { lo = -0.1, hi = 0.3, margin0 = 0.5, margin1 = 1.5 } = {}) {
  const t0 = run.activeStart + margin0, t1 = run.tEnd - margin1;
  const truth = run.truth.filter(s => s.type === 'cycle' && truePeak(s) > t0 && truePeak(s) < t1);
  const det = run.cycles.filter(c => c.t > t0 - 0.2 && c.t < t1 + 0.4);
  const used = new Set(), pairs = [];
  let j = 0;
  for (const s of truth) {
    const tp = truePeak(s);
    while (j < det.length && det[j].t < tp + lo) j++;
    let best = -1, bestD = 1e9;
    for (let k = j; k < det.length && det[k].t <= tp + hi; k++) {
      if (used.has(k)) continue;
      const d = Math.abs(det[k].t - tp - 0.04);
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best >= 0) { used.add(best); pairs.push({ s, c: det[best] }); } else pairs.push({ s, c: null });
  }
  const inWin = det.filter(c => c.t > t0 && c.t < t1);
  const falsePos = inWin.filter(c => !used.has(det.indexOf(c))).length;
  return { truth, det: inWin, pairs, falsePos, minutes: (t1 - t0) / 60 };
}

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const sd = a => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
function quantile(a, q) { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y); const p = (b.length - 1) * q, i = Math.floor(p); return b[i] + (b[Math.min(b.length - 1, i + 1)] - b[i]) * (p - i); }
function kappa(pairs) {   // pairs of [truthBool, measuredBool]
  const n = pairs.length; if (!n) return { agree: NaN, kappa: NaN, n: 0 };
  let a = 0, tp = 0, tn = 0, t1 = 0, m1 = 0;
  for (const [t, m] of pairs) { if (t === m) a++; if (t) t1++; if (m) m1++; }
  const po = a / n, pe = (t1 / n) * (m1 / n) + (1 - t1 / n) * (1 - m1 / n);
  return { agree: po, kappa: pe < 1 ? (po - pe) / (1 - pe) : NaN, n, prevTruth: t1 / n };
}
/* percentile bootstrap CI of the mean over independent runs */
function bootCI(vals, B = 4000, seed = 99) {
  const r = rng(seed), n = vals.length; if (n < 2) return [NaN, NaN];
  const ms = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += vals[Math.floor(r() * n)]; ms.push(s / n); }
  return [quantile(ms, 0.025), quantile(ms, 0.975)];
}
const inDepth = d => d >= 50 && d <= 60, inRate = r => r >= 100 && r <= 120, inPos = p => p <= 20, fullRecoil = l => l <= 3;

module.exports = { rng, truePos, truePeak, match, mean, sd, quantile, kappa, bootCI, inDepth, inRate, inPos, fullRecoil };
