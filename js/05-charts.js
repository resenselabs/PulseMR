'use strict';
/* =====================================================================
   PULSEMR charts: canvas and SVG drawings (all from the shared state)
   ===================================================================== */
const C = {};
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const g = n => cs.getPropertyValue(n).trim();
  Object.assign(C, { ink: g('--ink'), ink2: g('--ink-2'), ink3: g('--ink-3'), line: g('--line'), lineS: g('--line-strong'), coral: g('--coral'), coralInk: g('--coral-ink'), lav: g('--lav'), lavInk: g('--lav-ink'), sage: g('--sage'), sageInk: g('--sage-ink'), warn: g('--warn'), warnInk: g('--warn-ink'), err: g('--err'), errInk: g('--err-ink'), inset: g('--panel-inset'), panel: g('--panel-solid'), bg: g('--bg'), mono: g('--f-mono'), ui: g('--f-ui') });
}
function prep(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(10, canvas.clientWidth), h = Math.max(10, canvas.clientHeight);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}
function alpha(hex, a) {
  if (!hex || hex[0] !== '#') return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function txt(g, s, x, y, o = {}) {
  g.font = `${o.w || 500} ${o.s || 10}px ${o.f === 'ui' ? C.ui : C.mono}`;
  g.fillStyle = o.c || C.ink2; g.textAlign = o.a || 'left'; g.textBaseline = o.b || 'alphabetic';
  g.fillText(s, x, y);
}

/* ---------- compression waveform ---------- */
const WaveState = { hover: null, frozenEnd: null };
function drawWave(canvas, opts = {}) {
  const { g, w, h } = prep(canvas);
  const win = opts.window || 6;
  const tEnd = opts.tEnd;
  const t0 = tEnd - win;
  const padL = 34, padR = 8, padT = 14, padB = 18;
  const ymin = -30, ymax = 78;
  const X = t => padL + (w - padL - padR) * (t - t0) / win;
  const Y = mm => padT + (h - padT - padB) * (mm - ymin) / (ymax - ymin);
  // target band
  g.fillStyle = alpha(C.sage, 0.28); g.fillRect(padL, Y(50), w - padL - padR, Y(60) - Y(50));
  g.strokeStyle = alpha(C.sage, 0.9); g.lineWidth = 1; g.setLineDash([4, 3]);
  for (const v of [50, 60]) { g.beginPath(); g.moveTo(padL, Y(v)); g.lineTo(w - padR, Y(v)); g.stroke(); }
  g.setLineDash([]);
  // grid and axis labels (depth increases downward, like the chest)
  g.strokeStyle = C.line; g.lineWidth = 1;
  for (const v of [0, 25, 50, 75]) { g.beginPath(); g.moveTo(padL, Y(v)); g.lineTo(w - padR, Y(v)); g.stroke(); txt(g, String(v), padL - 5, Y(v) + 3, { a: 'right', s: 9.5 }); }
  txt(g, 'mm', 4, padT + 2, { s: 9 });
  txt(g, 'TARGET BAND 50–60 mm', w - padR - 2, padT + 8, { a: 'right', s: 9, c: C.sageInk, w: 600 });
  // pauses
  const pauses = Pauses.items.filter(p => p.t1 > t0 && p.t0 < tEnd).map(p => ({ ...p }));
  if (Detect.pauseLive && S.mode !== 'replay') pauses.push({ t0: Detect.pauseLive.t0, t1: tEnd, dur: Detect.pauseLive.dur, live: true });
  for (const p of pauses) {
    const a = Math.max(padL, X(p.t0)), b = Math.min(w - padR, X(Math.min(p.t1, tEnd)));
    if (b <= a) continue;
    g.fillStyle = alpha(C.err, 0.08); g.fillRect(a, padT, b - a, h - padT - padB);
    g.strokeStyle = alpha(C.err, 0.35);
    for (let x = a - 30; x < b; x += 8) { g.beginPath(); g.moveTo(Math.max(a, x), padT + Math.max(0, a - x)); g.lineTo(Math.min(b, x + 30), padT + Math.min(30, b - x)); g.stroke(); }
    txt(g, (p.live ? 'PAUSED ' : 'PAUSE ') + (p.live ? (tEnd - p.t0) : p.dur).toFixed(1) + ' s', (a + b) / 2, padT + 26, { a: 'center', s: 9.5, w: 700, c: C.errInk });
  }
  // incomplete recoil: shade the release region of affected cycles
  const fb = opts.fb;
  const cyc = Cycles.items.filter(c => c.t > t0 - 1 && c.t <= tEnd);
  for (const c of cyc) {
    if (c.resid > TARGET.recoilFull) {
      const a = X(c.t + 0.12), b = X(c.tEnd);
      g.fillStyle = alpha(C.warn, fb && fb.metric === 'recoil' ? 0.38 : 0.2);
      g.fillRect(Math.max(padL, a), Y(0), Math.max(0, Math.min(w - padR, b) - Math.max(padL, a)), Y(c.resid) - Y(0));
    }
  }
  // samples in the window
  const k1 = Samples.find(tEnd), k0 = Math.max(0, Samples.find(t0));
  if (k1 >= 0) {
    const line = (col, key, lw, a) => {
      g.strokeStyle = col; g.lineWidth = lw; g.globalAlpha = a; g.beginPath();
      let first = true;
      for (let k = k0; k <= k1; k++) { const i = Samples.idx(k); const x = X(Samples.time[i]); const y = Y(clamp(Samples[key][i], ymin, ymax)); if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y); }
      g.stroke(); g.globalAlpha = 1;
    };
    if (opts.raw !== false) line(C.lav, 'rz', 1.2, 0.85);
    if (opts.filt !== false) line(C.coral, 'fz', 2.2, 1);
    // occluded samples
    g.fillStyle = C.ink3;
    for (let k = k0; k <= k1; k++) { const i = Samples.idx(k); if (Samples.occ[i] > 0.5) g.fillRect(X(Samples.time[i]) - 1, h - padB + 3, 2, 3); }
  }
  // peaks: markers, depth labels, and cycle durations
  g.textAlign = 'center';
  let prev = null;
  for (const c of cyc) {
    const x = X(c.t), y = Y(c.depth);
    if (x < padL || x > w - padR) { prev = c; continue; }
    const ok = c.depth >= TARGET.depthMin && c.depth <= TARGET.depthMax;
    g.fillStyle = ok ? C.sageInk : C.coralInk;
    g.beginPath(); g.arc(x, y, 3.2, 0, Math.PI * 2); g.fill();
    if ((w - padL) / win > 55) txt(g, c.depth.toFixed(0), x, y + 13, { a: 'center', s: 9, w: 600, c: ok ? C.sageInk : C.coralInk });
    if (prev && c.interval && c.interval < 1.6 && (w - padL) / win > 70) {
      const xa = X(prev.t);
      if (xa > padL) { g.strokeStyle = C.line; g.beginPath(); g.moveTo(xa, h - padB + 2); g.lineTo(x, h - padB + 2); g.stroke(); txt(g, (c.interval * 1000).toFixed(0), (xa + x) / 2, h - 4, { a: 'center', s: 8.5 }); }
    }
    prev = c;
  }
  // inspect cursor
  if (opts.inspect && WaveState.hover != null) {
    const tx = t0 + (WaveState.hover - padL) / (w - padL - padR) * win;
    let best = null; for (const c of cyc) if (!best || Math.abs(c.t - tx) < Math.abs(best.t - tx)) best = c;
    g.strokeStyle = C.ink; g.globalAlpha = 0.4; g.beginPath(); g.moveTo(WaveState.hover, padT); g.lineTo(WaveState.hover, h - padB); g.stroke(); g.globalAlpha = 1;
    if (best) {
      const bx = clamp(X(best.t) + 10, padL, w - 170), by = padT + 4;
      g.fillStyle = C.panel; g.strokeStyle = C.lineS; g.lineWidth = 1;
      g.beginPath(); g.roundRect ? g.roundRect(bx, by, 162, 76, 8) : g.rect(bx, by, 162, 76); g.fill(); g.stroke();
      const L = [`CYCLE ${String(best.n).padStart(3, '0')}`, `Depth ${best.depth.toFixed(1)} mm`, `Rate ${best.rate ? best.rate.toFixed(0) + ' CPM' : 'n/a'}`, `Position error ${best.pos.toFixed(1)} mm`, `Recoil ${best.recoilLabel} (${best.resid.toFixed(1)} mm)`];
      L.forEach((s, i) => txt(g, s, bx + 8, by + 15 + i * 13, { s: 9.5, w: i ? 500 : 700, c: i ? C.ink2 : C.ink }));
      g.strokeStyle = C.coral; g.beginPath(); g.arc(X(best.t), Y(best.depth), 6, 0, Math.PI * 2); g.stroke();
    }
  }
  // legend line in the corner
  txt(g, opts.inspect ? 'INSPECTING · move over a peak' : 'LIVE · last ' + win + ' s', padL + 2, h - 4, { s: 9, c: C.ink2 });
}

/* ---------- KPI mini canvases ---------- */
function drawDepthBar(canvas, depth, live) {
  const { g, w, h } = prep(canvas);
  const X = mm => 4 + (w - 8) * clamp(mm / 80, 0, 1);
  g.fillStyle = C.inset; g.fillRect(4, 9, w - 8, 8);
  g.fillStyle = alpha(C.sage, 0.6); g.fillRect(X(50), 7, X(60) - X(50), 12);
  if (live != null) { g.fillStyle = alpha(C.coral, 0.35); g.fillRect(4, 9, X(Math.max(0, live)) - 4, 8); }
  if (depth != null) {
    g.fillStyle = C.ink; g.beginPath(); g.moveTo(X(depth), 6); g.lineTo(X(depth) - 5, 0); g.lineTo(X(depth) + 5, 0); g.fill();
    g.fillStyle = C.coral; g.fillRect(X(depth) - 1.5, 5, 3, 16);
  }
  for (const v of [0, 50, 60, 80]) txt(g, String(v), X(v), h - 1, { a: v === 0 ? 'left' : v === 80 ? 'right' : 'center', s: 8.5 });
}
function drawRhythm(canvas, tEnd) {
  const { g, w, h } = prep(canvas);
  const win = 4, t0 = tEnd - win, X = t => 4 + (w - 8) * (t - t0) / win;
  g.strokeStyle = C.line; g.beginPath(); g.moveTo(4, h / 2); g.lineTo(w - 4, h / 2); g.stroke();
  const per = 60 / TARGET.rateMid;
  for (let t = Math.ceil(t0 / per) * per; t <= tEnd; t += per) { g.fillStyle = alpha(C.lav, 0.8); g.fillRect(X(t) - 1, h / 2 - 8, 2, 16); }
  for (const c of Cycles.items) { if (c.t < t0 || c.t > tEnd) continue; g.fillStyle = C.coral; g.beginPath(); g.arc(X(c.t), h / 2, 4, 0, Math.PI * 2); g.fill(); }
  txt(g, 'TARGET BEAT', 4, 8, { s: 8, c: C.lavInk }); txt(g, 'DETECTED PEAK', w - 4, 8, { s: 8, c: C.coralInk, a: 'right' });
}
function drawSpark(canvas, tEnd) {
  const { g, w, h } = prep(canvas);
  const win = 3, t0 = tEnd - win, k1 = Samples.find(tEnd), k0 = Math.max(0, Samples.find(t0));
  const Y = mm => 4 + (h - 8) * (clamp(mm, -30, 75) + 30) / 105;
  g.fillStyle = alpha(C.sage, 0.25); g.fillRect(0, Y(50), w, Y(60) - Y(50));
  if (k1 < 0) return;
  g.strokeStyle = C.coral; g.lineWidth = 1.8; g.beginPath();
  for (let k = k0; k <= k1; k++) { const i = Samples.idx(k), x = w * (Samples.time[i] - t0) / win; k === k0 ? g.moveTo(x, Y(Samples.fz[i])) : g.lineTo(x, Y(Samples.fz[i])); }
  g.stroke();
}
function drawHaptic(canvas, level, active, now) {
  const { g, w, h } = prep(canvas);
  g.strokeStyle = C.line; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  g.strokeStyle = active ? C.coral : C.ink3; g.lineWidth = 1.6; g.beginPath();
  const amp = active ? (h / 2 - 3) * level / 3 : 0;
  for (let x = 0; x <= w; x += 2) { const y = h / 2 + amp * Math.sin(x / 3.2 + now / 40) * Math.sin(Math.PI * x / w); x ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
}

/* ---------- per-cycle chart for the assessment drawer ---------- */
function drawCycleChart(canvas, list, opts) {
  const { g, w, h } = prep(canvas);
  const padL = 34, padR = 8, padT = 10, padB = 18;
  const [lo, hi] = opts.range;
  const X = i => padL + (w - padL - padR) * (list.length > 1 ? i / (list.length - 1) : 0.5);
  const Y = v => padT + (h - padT - padB) * (1 - (clamp(v, lo, hi) - lo) / (hi - lo));
  if (opts.band) { g.fillStyle = alpha(C.sage, 0.25); g.fillRect(padL, Y(opts.band[1]), w - padL - padR, Y(opts.band[0]) - Y(opts.band[1])); }
  if (opts.limit != null) { g.strokeStyle = C.warn; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(padL, Y(opts.limit)); g.lineTo(w - padR, Y(opts.limit)); g.stroke(); g.setLineDash([]); txt(g, opts.limitLabel || '', w - padR, Y(opts.limit) - 3, { a: 'right', s: 9, c: C.warnInk, w: 600 }); }
  g.strokeStyle = C.line;
  for (const v of opts.ticks) { g.beginPath(); g.moveTo(padL, Y(v)); g.lineTo(w - padR, Y(v)); g.stroke(); txt(g, String(v), padL - 4, Y(v) + 3, { a: 'right', s: 9 }); }
  if (!list.length) { txt(g, 'No compressions yet', w / 2, h / 2, { a: 'center', s: 11 }); return; }
  g.strokeStyle = alpha(C.lav, 0.9); g.lineWidth = 1.2; g.beginPath();
  let started = false;
  list.forEach((c, i) => { const v = opts.get(c); if (v == null) { started = false; return; } const x = X(i), y = Y(v); if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y); });
  g.stroke();
  list.forEach((c, i) => { const v = opts.get(c); if (v == null) return; const ok = opts.ok(v); g.fillStyle = c.lowConf ? C.ink3 : ok ? C.sageInk : C.coral; g.beginPath(); g.arc(X(i), Y(v), list.length > 120 ? 1.6 : 2.6, 0, Math.PI * 2); g.fill(); });
  txt(g, `${list[0].n}`, padL, h - 4, { s: 9 }); txt(g, `cycle ${list[list.length - 1].n}`, w - padR, h - 4, { s: 9, a: 'right' });
  txt(g, opts.unit, padL + 4, padT + 10, { s: 9 });
}
function drawPauseHistory(canvas) {
  const { g, w, h } = prep(canvas);
  const span = Math.max(30, S.t - Stats.activeStart);
  const padL = 30, padB = 18, padT = 8;
  const X = t => padL + (w - padL - 8) * (t - Stats.activeStart) / span, Y = d => padT + (h - padT - padB) * (1 - clamp(d, 0, 8) / 8);
  g.strokeStyle = C.line; for (const v of [0, 4, 8]) { g.beginPath(); g.moveTo(padL, Y(v)); g.lineTo(w - 8, Y(v)); g.stroke(); txt(g, v + ' s', padL - 4, Y(v) + 3, { a: 'right', s: 9 }); }
  const list = Pauses.items.slice();
  if (Detect.pauseLive) list.push({ t0: Detect.pauseLive.t0, dur: Detect.pauseLive.dur, live: true });
  for (const p of list) { const x = X(p.t0); g.fillStyle = p.live ? C.err : C.coral; g.fillRect(x - 3, Y(p.dur), 6, Y(0) - Y(p.dur)); }
  if (!list.length) txt(g, 'No interruptions recorded', w / 2, h / 2, { a: 'center', s: 11 });
  txt(g, 'session time', w - 8, h - 4, { a: 'right', s: 9 }); txt(g, fmtClock(0), padL, h - 4, { s: 9 });
}
function drawFeedbackTimeline(canvas) {
  const { g, w, h } = prep(canvas);
  const rows = ['depth', 'rate', 'position', 'recoil', 'interrupt'];
  const span = Math.max(30, S.t - Stats.activeStart);
  const padL = 84, padT = 6, rh = (h - padT - 18) / rows.length;
  const X = t => padL + (w - padL - 8) * (t - Stats.activeStart) / span;
  rows.forEach((r, i) => { txt(g, METRIC_LABEL[r].toUpperCase(), 4, padT + rh * i + rh / 2 + 3, { s: 9.5, w: 600 }); g.strokeStyle = C.line; g.beginPath(); g.moveTo(padL, padT + rh * (i + 1)); g.lineTo(w - 8, padT + rh * (i + 1)); g.stroke(); });
  for (const f of FB.log.items) {
    const r = rows.indexOf(f.metric); if (r < 0) continue;
    g.fillStyle = f.level >= 3 ? C.err : f.level === 2 ? C.coral : C.warn;
    const hh = rh * (0.3 + 0.2 * f.level);
    g.fillRect(X(f.t) - 1.2, padT + rh * r + (rh - hh) / 2, 2.4, hh);
  }
  txt(g, 'tick height shows intensity level 1 to 3', w - 8, h - 4, { a: 'right', s: 9 });
}

/* ---------- trajectory chart ---------- */
function drawTrajectory(canvas, mode) {
  const { g, w, h } = prep(canvas);
  const padL = 34, padR = 12, padT = 12, padB = 26;
  const X = m => padL + (w - padL - padR) * m / 10, Y = v => padT + (h - padT - padB) * (1 - v / 100);
  g.strokeStyle = C.line;
  for (const v of [0, 25, 50, 75, 100]) { g.beginPath(); g.moveTo(padL, Y(v)); g.lineTo(w - padR, Y(v)); g.stroke(); txt(g, String(v), padL - 5, Y(v) + 3, { a: 'right', s: 9 }); }
  for (let m = 0; m <= 10; m += 2) txt(g, m + ' min', X(m), h - 8, { a: m === 10 ? 'right' : m === 0 ? 'left' : 'center', s: 9 });
  txt(g, 'GCS', padL + 4, padT + 12, { s: 9 });
  if (mode === 'research') {
    // reported session means as references; curves are illustrative shapes constrained only by those means
    const refs = [['Adaptive MR guidance', RESEARCH.conditions.mr.gcs, C.coral], ['Conventional instruction', RESEARCH.conditions.av.gcs, C.lav]];
    for (const [name, mean, col] of refs) {
      g.strokeStyle = col; g.lineWidth = 1; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(X(0), Y(mean)); g.lineTo(X(10), Y(mean)); g.stroke(); g.setLineDash([]);
      txt(g, `${name}: reported session GCS ${mean}`, X(10) - 2, Y(mean) - 5, { a: 'right', s: 9.5, w: 600, c: col === C.coral ? C.coralInk : C.lavInk });
    }
    const curve = (mean, rise) => { // saturating shape whose 0-10 min average equals the reported mean
      const f = m => 1 - Math.exp(-m / rise);
      let avg = 0; for (let i = 0; i <= 100; i++) avg += f(i / 10) / 101;
      const span = 26, base = mean - span * avg;
      return m => base + span * f(m);
    };
    for (const [mean, rise, col] of [[RESEARCH.conditions.mr.gcs, 2.2, C.coral], [RESEARCH.conditions.av.gcs, 5.5, C.lav]]) {
      const fn = curve(mean, rise);
      g.strokeStyle = col; g.lineWidth = 2.4; g.setLineDash([7, 5]); g.beginPath();
      for (let i = 0; i <= 100; i++) { const m = i / 10; i ? g.lineTo(X(m), Y(fn(m))) : g.moveTo(X(m), Y(fn(m))); }
      g.stroke(); g.setLineDash([]);
    }
    txt(g, 'ILLUSTRATIVE SHAPE · NOT STUDY DATA', X(0) + 6, Y(14), { s: 9.5, w: 700, c: C.ink2 });
  } else {
    const tr = Stats.gcsTrace;
    if (!tr.length) { txt(g, 'The live trace starts after about 20 compressions', w / 2, h / 2, { a: 'center', s: 11 }); return; }
    g.strokeStyle = C.coral; g.lineWidth = 2.2; g.beginPath();
    tr.forEach((p, i) => { const m = p.t / 60; if (m > 10) return; i ? g.lineTo(X(m), Y(p.gcs)) : g.moveTo(X(m), Y(p.gcs)); });
    g.stroke();
    const lastP = tr[tr.length - 1];
    if (lastP.t / 60 <= 10) { g.fillStyle = C.coral; g.beginPath(); g.arc(X(lastP.t / 60), Y(lastP.gcs), 4, 0, Math.PI * 2); g.fill(); txt(g, lastP.gcs.toFixed(0), X(lastP.t / 60) + 7, Y(lastP.gcs) + 4, { s: 10, w: 700, c: C.coralInk }); }
    txt(g, 'THIS SIMULATED SESSION · ROLLING 20 COMPRESSIONS', X(0) + 6, Y(8), { s: 9.5, w: 700, c: C.ink2 });
  }
}
function drawProjection2(canvas, proj) {
  const { g, w, h } = prep(canvas);
  const padL = 34, padR = 10, padT = 10, padB = 24;
  const X = m => padL + (w - padL - padR) * m / 10, Y = v => padT + (h - padT - padB) * (1 - v / 100);
  g.strokeStyle = C.line;
  for (const v of [0, 50, 100]) { g.beginPath(); g.moveTo(padL, Y(v)); g.lineTo(w - padR, Y(v)); g.stroke(); txt(g, String(v), padL - 5, Y(v) + 3, { a: 'right', s: 9 }); }
  for (let m = 0; m <= 10; m += 2) txt(g, m + ' min', X(m), h - 7, { a: m === 10 ? 'right' : m === 0 ? 'left' : 'center', s: 9 });
  if (!proj) { txt(g, 'Run the projection to draw both synthetic trainees', w / 2, h / 2, { a: 'center', s: 11 }); return; }
  for (const [k, col, dash] of [['static', C.lav, [6, 4]], ['adaptive', C.coral, []]]) {
    g.strokeStyle = col; g.lineWidth = 2.2; g.setLineDash(dash); g.beginPath();
    proj[k].curve.forEach((p, i) => { const m = p.t / 60; i ? g.lineTo(X(m), Y(p.gcs)) : g.moveTo(X(m), Y(p.gcs)); });
    g.stroke(); g.setLineDash([]);
  }
  txt(g, 'SYNTHETIC RULES · NOT EXPERIMENTAL EVIDENCE', padL + 6, Y(6), { s: 9.5, w: 700 });
  // legend (line style as well as colour)
  const lx = w - padR - 250, ly = Y(30);
  g.lineWidth = 2.2; g.strokeStyle = C.coral; g.beginPath(); g.moveTo(lx, ly); g.lineTo(lx + 22, ly); g.stroke();
  txt(g, 'Adaptive feedback', lx + 28, ly + 3, { s: 9.5, w: 600, c: C.ink });
  g.strokeStyle = C.lav; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(lx + 130, ly); g.lineTo(lx + 152, ly); g.stroke(); g.setLineDash([]);
  txt(g, 'Static feedback', lx + 158, ly + 3, { s: 9.5, w: 600, c: C.ink });
}

/* ---------- replay timeline ---------- */
const MARKS = [
  { k: 'shallow', label: 'Too shallow', col: () => C.coral },
  { k: 'fast', label: 'Too fast', col: () => C.warn },
  { k: 'drift', label: 'Hand drift', col: () => C.lav },
  { k: 'recoil', label: 'Incomplete recoil', col: () => C.ink2 },
  { k: 'pause', label: 'Pause', col: () => C.err },
  { k: 'stable', label: 'Stable performance', col: () => C.sage }
];
function replayRange() {
  const a = Samples.length ? Samples.first() : 0, b = Samples.length ? Samples.last() : 0;
  return [a, Math.max(a + 0.1, b)];
}
function drawTimeline(canvas) {
  const { g, w, h } = prep(canvas);
  const [a, b] = replayRange();
  const X = t => 8 + (w - 16) * (t - a) / (b - a);
  g.fillStyle = C.inset; g.fillRect(8, 24, w - 16, 18);
  // stable stretches: runs of target cycles
  let run = null;
  const flush = end => { if (run && run.n >= 6) { g.fillStyle = alpha(C.sage, 0.55); g.fillRect(X(run.t0), 24, Math.max(2, X(end) - X(run.t0)), 18); } run = null; };
  for (const c of Cycles.items) {
    if (c.t < a) continue;
    if (c.status === 'Target') { if (!run) run = { t0: c.t, n: 0 }; run.n++; } else flush(c.t);
  }
  flush(b);
  const row = { shallow: 0, fast: 1, drift: 2, recoil: 3, pause: 4 };
  for (const c of Cycles.items) {
    if (c.t < a) continue;
    for (const k of ['shallow', 'fast', 'drift', 'recoil']) if (c.cls[k]) { g.fillStyle = MARKS.find(m => m.k === k).col(); g.fillRect(X(c.t) - 1, 4 + row[k] * 4, 2, 4); }
  }
  for (const p of Pauses.items) { if (p.t1 < a) continue; g.fillStyle = C.err; g.fillRect(X(p.t0), 24, Math.max(2, X(p.t1) - X(p.t0)), 18); }
  for (const f of FB.log.items) { if (f.t < a || f.confirm) continue; g.fillStyle = f.level >= 3 ? C.err : C.coral; g.beginPath(); g.moveTo(X(f.t), 46); g.lineTo(X(f.t) - 3.5, 53); g.lineTo(X(f.t) + 3.5, 53); g.fill(); }
  const x = X(S.replay.t);
  g.fillStyle = C.ink; g.fillRect(x - 1, 0, 2, h - 4);
  g.beginPath(); g.arc(x, 33, 7, 0, Math.PI * 2); g.fill();
  g.fillStyle = C.panel; g.beginPath(); g.arc(x, 33, 3, 0, Math.PI * 2); g.fill();
  txt(g, fmtClock(a), 8, h - 1, { s: 9 }); txt(g, fmtClock(b), w - 8, h - 1, { s: 9, a: 'right' });
}

/* ---------- SVG research charts (fixed reported values) ---------- */
function svgCompare(baseKey) {
  const B = RESEARCH.conditions[baseKey], A = RESEARCH.conditions.mr;
  const metrics = [['depth', 'Depth accuracy', '%'], ['rate', 'Rate accuracy', '%'], ['hand', 'Hand position accuracy', '%'], ['gcs', 'Guideline compliance score', '/100']];
  const W2 = 640, H2 = 270, padL = 16, padB = 58, top = 26, gw = (W2 - padL * 2) / metrics.length;
  const Y = v => top + (H2 - padB - top) * (1 - v / 100);
  let s = `<svg viewBox="0 0 ${W2} ${H2}" role="img" aria-label="Reported values: ${esc(B.name)} versus adaptive MR guidance">`;
  for (const v of [0, 25, 50, 75, 100]) s += `<line x1="${padL}" x2="${W2 - padL}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${padL}" y="${Y(v) - 3}" font-size="9" fill="var(--ink-2)">${v}</text>`;
  metrics.forEach(([k, label], i) => {
    const x0 = padL + gw * i + gw * 0.2, bw = gw * 0.26;
    const bv = B[k], av = A[k];
    s += `<rect x="${x0}" y="${Y(bv)}" width="${bw}" height="${Y(0) - Y(bv)}" rx="4" fill="var(--lav)"><animate attributeName="height" from="0" to="${Y(0) - Y(bv)}" dur="0.6s"/><animate attributeName="y" from="${Y(0)}" to="${Y(bv)}" dur="0.6s"/></rect>`;
    s += `<rect x="${x0 + bw + 6}" y="${Y(av)}" width="${bw}" height="${Y(0) - Y(av)}" rx="4" fill="var(--coral)"><animate attributeName="height" from="0" to="${Y(0) - Y(av)}" dur="0.6s"/><animate attributeName="y" from="${Y(0)}" to="${Y(av)}" dur="0.6s"/></rect>`;
    s += `<text x="${x0 + bw / 2}" y="${Y(bv) - 4}" font-size="11" font-weight="600" text-anchor="middle" fill="var(--ink)">${bv.toFixed(1)}</text>`;
    s += `<text x="${x0 + bw * 1.5 + 6}" y="${Y(av) - 4}" font-size="11" font-weight="700" text-anchor="middle" fill="var(--ink)">${av.toFixed(1)}</text>`;
    const d = av - bv;
    s += `<text x="${x0 + bw + 3}" y="${H2 - padB + 16}" font-size="10" text-anchor="middle" fill="var(--ink)" font-weight="600">${esc(label)}</text>`;
    s += `<text x="${x0 + bw + 3}" y="${H2 - padB + 31}" font-size="10" text-anchor="middle" fill="var(--coral-ink)" font-weight="700">${d >= 0 ? '+' : ''}${d.toFixed(1)} ${k === 'gcs' ? 'points' : 'pp'}</text>`;
  });
  s += `<rect x="${W2 - 300}" y="4" width="10" height="10" rx="2" fill="var(--lav)"/><text x="${W2 - 286}" y="13" font-size="10" fill="var(--ink)">${esc(B.short)}</text>`;
  s += `<rect x="${W2 - 160}" y="4" width="10" height="10" rx="2" fill="var(--coral)"/><text x="${W2 - 146}" y="13" font-size="10" fill="var(--ink)">Adaptive MR guidance</text>`;
  s += `<text x="${padL}" y="${H2 - 6}" font-size="9" fill="var(--ink-2)">Differences are arithmetic on the reported values. pp = percentage points.</text>`;
  return s + '</svg>';
}
function svgSmall(metric, label) {
  const C4 = [RESEARCH.conditions.metronome, RESEARCH.conditions.av, RESEARCH.conditions.commercial, RESEARCH.conditions.mr];
  const W2 = 300, H2 = 132, padL = 86;
  let s = `<svg viewBox="0 0 ${W2} ${H2}" role="img" aria-label="${esc(label)}"><text x="0" y="12" font-size="10" font-weight="700" fill="var(--ink)">${esc(label.toUpperCase())}</text>`;
  C4.forEach((c, i) => {
    const y = 22 + i * 26, bw = (W2 - padL - 36) * c[metric] / 100;
    s += `<text x="0" y="${y + 13}" font-size="9.5" fill="var(--ink-2)">${esc(c.short)}</text><rect x="${padL}" y="${y + 3}" width="${bw}" height="14" rx="3" fill="${c.key === 'mr' ? 'var(--coral)' : 'var(--lav)'}"/><text x="${padL + bw + 4}" y="${y + 14}" font-size="10" font-weight="600" fill="var(--ink)">${c[metric].toFixed(1)}</text>`;
  });
  return s + '</svg>';
}
