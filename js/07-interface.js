'use strict';
/* =====================================================================
   PULSEMR interface: panels, modes, interaction, accessibility
   ===================================================================== */
const SLIDERS = [
  { k: 'depth', label: 'Compression depth', min: 20, max: 80, step: 1, unit: 'mm', st: v => v < 50 ? ['BELOW TARGET', 'bad'] : v > 60 ? ['ABOVE TARGET', 'bad'] : ['TARGET RANGE', 'ok'] },
  { k: 'rate', label: 'Compression rate', min: 60, max: 160, step: 1, unit: 'CPM', st: v => v < 100 ? ['TOO SLOW', 'bad'] : v > 120 ? ['TOO FAST', 'bad'] : ['TARGET RANGE', 'ok'] },
  { k: 'offX', label: 'Hand offset X (across chest)', min: -40, max: 40, step: 1, unit: 'mm', st: () => offsetState() },
  { k: 'offY', label: 'Hand offset Y (along sternum)', min: -40, max: 40, step: 1, unit: 'mm', st: () => offsetState() },
  { k: 'recoil', label: 'Recoil completeness', min: 60, max: 100, step: 1, unit: '%', st: v => v >= 95 ? ['FULL RELEASE', 'ok'] : v >= 85 ? ['PARTIAL', 'warn'] : ['INCOMPLETE', 'bad'] },
  { k: 'intFreq', label: 'Interruption frequency', min: 0, max: 4, step: 0.5, unit: '/min', st: v => v === 0 ? ['NONE', 'ok'] : v <= 1 ? ['OCCASIONAL', 'warn'] : ['FREQUENT', 'bad'] },
  { k: 'noise', label: 'Tracking noise', min: 0, max: 8, step: 0.5, unit: 'mm', st: v => v <= 2 ? ['LOW', 'ok'] : v <= 4.5 ? ['MODERATE', 'warn'] : ['HIGH', 'bad'] }
];
function offsetState() { const m = Math.hypot(S.params.offX, S.params.offY); return m <= TARGET.posTol ? ['WITHIN 20 mm', 'ok'] : ['OFF TARGET ' + m.toFixed(0) + ' mm', 'bad']; }

const STAGES = [
  { n: '01', t: 'STERNUM CALIBRATION', info: 'Establishes a reference frame on the lower half of the manikin’s sternum. X is horizontal deviation across the chest, Y is position along the sternum, Z is compression depth. The calibration residual is a small simulated alignment error that carries into measured hand-position error.' },
  { n: '02', t: 'HAND TRACKING', info: 'Simulated input modelled on the study hardware: 25 articulated joints per hand sampled at 30 Hz. Samples come from a deterministic motion model with configurable noise, drift, occlusion and jitter. No camera or optical tracking runs in this browser. Demo rule: a compression measured mostly from estimated (occluded) samples, or with mean confidence below 0.6, is not scored and gets no cue.' },
  { n: '03', t: 'SIGNAL PROCESSING', info: 'Each axis passes a second-order Butterworth low-pass filter (5 Hz cut-off at 30 Hz, bilinear transform). Palm X and Y then pass a five-sample moving average. Positions are expressed in the sternum frame. Peaks are timed by parabolic interpolation between samples.' },
  { n: '04', t: 'PERFORMANCE ASSESSMENT', info: 'A compression starts when filtered depth rises above 12 mm and ends when it falls well below its peak. Depth is the peak, rate comes from peak-to-peak time, hand-position error is the distance of the mean palm centre from the target, recoil is the lowest depth before the next compression, and a pause starts after 1.2 s without a compression.' },
  { n: '05', t: 'ADAPTIVE CONTROLLER', info: 'Deviations are normalised (depth per 15 mm outside 50 to 60 mm, rate per 20 CPM outside 100 to 120, position per 20 mm beyond 20 mm, recoil per 6 mm of residual). The first five compressions set a personal baseline, the last ten set persistence, and per-metric weights update with coefficient 0.3. The largest weighted deficit gets the cue. Targets never change.' },
  { n: '06', t: 'MULTIMODAL FEEDBACK', info: 'Level 1 gives minimal visual confirmation, level 2 adds one more modality, level 3 raises prominence with visual, auditory and simulated haptic cues. Audio uses Web Audio and the browser’s speech synthesis after you enable it. Haptics are drawn on the wrist cuffs; phone vibration is optional where the browser allows it.' }
];

const OBJ = {
  manikin: { title: 'CPR training manikin', kicker: 'Object · training manikin', rows: () => { const c = lastCycleAt(viewT()); return [['Status', 'READY', 'ok'], ['Simulation', S.running ? 'ACTIVE' : 'PAUSED', S.running ? 'ok' : 'warn'], ['Sternum calibration', calibWord(), S.calib.state === 'done' ? 'ok' : 'info'], ['Current compression depth', c ? c.depth.toFixed(0) + ' mm' : 'n/a'], ['Target range', '50–60 mm'], ['Compression rate', kpiRate() ? kpiRate().toFixed(0) + ' CPM' : 'n/a'], ['Current hand-position error', posErrNow().toFixed(0) + ' mm', posErrNow() <= 20 ? 'ok' : 'bad'], ['Chest recoil', c ? c.recoilLabel : 'n/a'], ['Study manikin', 'Laerdal Resusci Anne QCPR'], ['This model', 'Generic procedural manikin']]; }, actions: [['Focus on chest', 'view', 'hands'], ['Show target', 'show-target'], ['View compression waveform', 'show-wave'], ['Recalibrate', 'recalibrate']] },
  rescuer: { title: 'Rescuer avatar', kicker: 'Object · simulated rescuer', rows: () => [['State', S.calib.state !== 'done' ? 'CALIBRATING' : V.paused ? 'PAUSED' : 'COMPRESSING', V.paused ? 'warn' : 'ok'], ['Posture', 'Kneeling, arms straight'], ['Driven by', 'Synthetic motion model'], ['Depth setting', S.params.depth.toFixed(0) + ' mm'], ['Rate setting', S.params.rate.toFixed(0) + ' CPM'], ['Vertical motion scale', VIS + '× for visibility'], ['Learner response', S.learner ? 'ON (synthetic)' : 'OFF']], actions: [[() => S.forcedPause ? 'Resume compressions' : 'Pause compressions', 'force-pause'], ['Side view', 'view', 'side'], ['Hand close-up', 'view', 'hands']] },
  handL: { title: 'Hand tracking', kicker: 'Object · lower hand landmarks', rows: () => handRows(), actions: handActions() },
  handR: { title: 'Hand tracking', kicker: 'Object · upper hand landmarks', rows: () => handRows(), actions: handActions() },
  sternum: { title: 'Sternum calibration anchor', kicker: 'Object · reference frame', rows: () => [['Calibration', calibWord(), S.calib.state === 'done' ? 'ok' : 'info'], ['Calibration residual', Math.hypot(S.calib.residual.x, S.calib.residual.y).toFixed(1) + ' mm'], ['X', 'Horizontal deviation'], ['Y', 'Position along sternum'], ['Z', 'Compression depth direction'], ['Hand-position threshold', '20 mm'], ['Current hand-position error', posErrNow().toFixed(1) + ' mm', posErrNow() <= 20 ? 'ok' : 'bad'], ['Calibrations this session', String(S.calib.count)]], actions: [['Recalibrate position', 'recalibrate'], ['Top view', 'view', 'top'], [() => S.overlay.on ? 'Hide biomechanics overlay' : 'Show biomechanics overlay', 'overlay']] },
  headset: { title: 'Mixed-reality headset', kicker: 'Object · generic headset model', rows: () => [['Status', 'SIMULATED', 'info'], ['Device connection', 'None'], ['Study device', 'Microsoft HoloLens 2'], ['Study tracking', '25 joints per hand, 30 Hz'], ['Rendering here', 'Browser WebGL'], ['MR view', S.mode === 'mr' ? 'ACTIVE' : 'Available']], actions: [['Enter MR view', 'mode', 'mr']] },
  depthviz: { title: 'Compression-depth visualization', kicker: 'Object · depth gauge', rows: () => { const c = lastCycleAt(viewT()); return [['Live displacement', Math.max(0, V.z).toFixed(0) + ' mm'], ['Last peak', c ? c.depth.toFixed(1) + ' mm' : 'n/a', c && !c.cls.shallow && !c.cls.deep ? 'ok' : 'bad'], ['Target band', '50–60 mm'], ['Scale', '0 to 70 mm'], ['Measured from', 'Filtered tracked depth']]; }, actions: [['Side view', 'view', 'side'], ['Open assessment', 'mode', 'assess']] },
  metronome: { title: 'Compression-rate metronome', kicker: 'Object · rhythm cue', rows: () => [['Target rhythm', '110 per minute'], ['Guideline range', '100–120 per minute'], ['Current rate', kpiRate() ? kpiRate().toFixed(0) + ' CPM' : 'n/a', rateState()[1]], ['Audio', S.audio.enabled ? 'ON' : 'MUTED', S.audio.enabled ? 'ok' : 'info'], ['Rhythm cue', { off: 'Off', feedback: 'On rate cues', always: 'Always' }[S.audio.rhythm]]], actions: [['Change rhythm cue', 'rhythm-cycle'], [() => S.audio.enabled ? 'Mute audio' : 'Enable audio', 'audio-enable']] },
  controller: { title: 'Feedback controller', kicker: 'Object · adaptive feedback controller', rows: () => controllerRows(), actions: [['View decision log', 'sub', 'log'], ['Show adaptive threshold', 'sub', 'threshold'], ['Compare static feedback', 'tab', 'avs'], ['Reset model history', 'reset-model']] },
  projection: { title: 'Visual feedback projection', kicker: 'Object · floating guidance panel', rows: () => { const f = currentFeedback(); return [['Current message', f ? f.message : 'Monitoring'], ['Intensity', f ? 'LEVEL ' + f.level : 'n/a'], ['Modalities', f ? f.modalities.join(' + ') : 'n/a'], ['Cue display time', '2.5 s'], ['Confirmations', 'Every 4th on-target compression (adaptive)'], ['Intensity cap', 'Level ' + S.prefs.intensityCap]]; }, actions: [['Feedback system view', 'area', 'feedback'], ['Open feedback log', 'tab', 'log']] },
  haptic: { title: 'Simulated haptic device', kicker: 'Object · wrist cuffs', rows: () => { const f = lastHaptic(); return [['Haptic signal', 'SIMULATED', 'info'], ['Device', 'Wrist cuffs drawn in the scene'], ['Phone vibration', Feedback.vibrateSupported ? (S.haptics.vibrate ? 'ENABLED' : 'Available') : 'Not available here'], ['Last haptic cue', f ? f.message + ' · level ' + f.level : 'None yet'], ['Haptic disabled by ablation', S.ablation === 'haptic' ? 'YES' : 'No']]; }, actions: [[() => S.haptics.vibrate ? 'Disable vibration' : 'Enable vibration', 'vibrate'], ['Test pulse', 'test-haptic']] },
  workstation: { title: 'Performance assessment workstation', kicker: 'Object · research workstation', rows: () => { const s = sessionScores(viewT()); return [['Left screen', 'Live simulated assessment'], ['Right screen', 'Reported findings (fixed)'], ['Session GCS', s ? s.gcs.toFixed(1) : 'n/a'], ['Compressions', String(Cycles.length)], ['Feedback events', String(FB.log.length)]]; }, actions: [['Open assessment', 'mode', 'assess'], ['Open comparison', 'mode', 'compare'], ['Research view', 'area', 'research']] },
  trainmon: { title: 'Training monitor', kicker: 'Object · bedside display', rows: () => { const r = rollingScores(viewT()); const c = lastCycleAt(viewT()); return [['Depth', c ? c.depth.toFixed(0) + ' mm' : 'n/a'], ['Rate', kpiRate() ? kpiRate().toFixed(0) + ' CPM' : 'n/a'], ['GCS, last 20', r ? r.gcs.toFixed(0) : 'n/a']]; }, actions: [['Open assessment', 'mode', 'assess']] },
  cart: { title: 'Medical cart', kicker: 'Environment', rows: () => [['Holds', 'Adaptive controller hub'], ['Contents', 'Training supplies (decorative)']], actions: [['Select controller', 'select', 'controller']] },
  cabinets: { title: 'Equipment cabinets', kicker: 'Environment', rows: () => [['Contents', 'Training supplies (decorative)']], actions: [] },
  instruct: { title: 'Instructional display', kicker: 'Environment', rows: () => [['Shows', 'Guideline ranges used by the study'], ['Depth', '50–60 mm'], ['Rate', '100–120 per minute']], actions: [] },
  clock: { title: 'Wall clock', kicker: 'Environment', rows: () => [['Shows', 'Your local time'], ['Session time', fmtClock(S.t)]], actions: [] },
  signage: { title: 'Simulation signage', kicker: 'Environment', rows: () => [['Text', 'Simulation in progress · training only']], actions: [] },
  lights: { title: 'Examination lights', kicker: 'Environment', rows: () => [['Lab lighting', S.lighting === 'day' ? 'Day lab' : 'Dimmed simulation']], actions: [[() => S.lighting === 'day' ? 'Dim the lab' : 'Day lighting', 'lighting-toggle']] },
  clinic: { title: 'Clinical workstation', kicker: 'Environment', rows: () => [['Shows', 'Recent compression events']], actions: [['Open events table', 'tab', 'events']] },
  platform: { title: 'Demonstration platform', kicker: 'Environment', rows: () => [['Surface', 'Padded training mat']], actions: [] }
};
function handRows() {
  const q = qualityWord();
  const obs = G.lmObserved ? Array.from(G.lmObserved).reduce((a, b) => a + b, 0) : 50;
  return [['Status', 'SIMULATED', 'info'], ['Tracking frequency', '30 Hz'], ['Hand joints', '25 per hand'], ['Reference', 'STERNUM RELATIVE'], ['Filter', '5 Hz Butterworth + 5-sample average'], ['Position error', posErrNow().toFixed(0) + ' mm', posErrNow() <= 20 ? 'ok' : 'bad'], ['Tracking quality', q[0], q[1]], ['Confidence', V.conf.toFixed(2)], ['Observed joints', obs + ' of 50'], ['Condition', ENV_MODES[S.env].name], ['Cues withheld (low confidence)', String(Stats.withheld || 0)]];
}
function handActions() { return [[() => S.overlay.joints ? 'Hide landmarks' : 'Show landmarks', 'layer', 'joints'], [() => S.overlay.traj ? 'Hide trajectory' : 'Show trajectory', 'layer', 'traj'], ['Add tracking noise', 'add-noise'], ['Reset calibration', 'recalibrate']]; }
function controllerRows() {
  const f = lastActionable(), adaptive = S.controller === 'adaptive' && S.ablation !== 'adaptive';
  return [['Status', 'ACTIVE', 'ok'], ['Feedback mode', adaptive ? 'ADAPTIVE' : 'STATIC', adaptive ? 'ok' : 'info'], ['Primary deficit', f ? METRIC_LABEL[f.metric].toUpperCase() : 'NONE'], ['Deviation', f ? DEV_WORD[f.metric === 'interrupt' ? f.level : Math.min(3, Math.max(1, levelOf(f.dev)))].toUpperCase() : 'NONE'], ['Feedback priority', f ? PRIORITY[f.level] : 'NONE'], ['Modality', f ? f.modalities.map(m => m.toUpperCase()).join(' + ') : 'n/a'], ['Feedback intensity', f ? 'LEVEL ' + f.level : 'n/a'], ['Personalization', adaptive ? 'ENABLED' : 'DISABLED'], ['Baseline (first 5)', Ctl.adaptive.base ? 'SET' : 'COLLECTING ' + Math.min(5, Ctl.adaptive.baseAcc.length) + '/5'], ['History window', '10 compressions'], ['Adaptation coefficient', '0.3']];
}
const viewT = () => S.mode === 'replay' ? S.replay.t : S.t;
function calibWord() { return S.calib.state === 'done' ? 'COMPLETE' : S.calib.state === 'running' ? 'RUNNING' : 'NOT STARTED'; }
function posErrNow() { return Math.hypot(V.fx, V.fy); }
function qualityWord() { return V.conf >= 0.9 ? ['STABLE', 'ok'] : V.conf >= 0.7 ? ['REDUCED', 'warn'] : ['DEGRADED', 'bad']; }
function kpiRate(t = viewT()) {
  const it = Cycles.items; const out = [];
  for (let i = it.length - 1; i >= 0 && out.length < 4; i--) { if (it[i].t > t) continue; if (t - it[i].t > 6) break; if (it[i].rate != null && !it[i].lowConf) out.push(it[i].rate); }
  return out.length ? out.reduce((a, b) => a + b, 0) / out.length : null;
}
function rateState(r = kpiRate()) { return r == null ? ['NO RATE', 'info'] : r < 100 ? ['TOO SLOW', 'bad'] : r > 120 ? ['TOO FAST', 'bad'] : ['TARGET RANGE', 'ok']; }
function lastActionable() { const it = FB.log.items; for (let i = it.length - 1; i >= 0; i--) if (!it[i].confirm && it[i].t <= viewT()) return it[i]; return null; }
function lastHaptic() { const it = FB.log.items; for (let i = it.length - 1; i >= 0; i--) if (it[i].modalities.includes('haptic')) return it[i]; return null; }
function stateOfCycle(c) { return c.status === 'Target' ? 'ok' : c.status === 'Low confidence' ? 'info' : c.status === 'Warning' ? 'bad' : 'warn'; }

const UI = {
  tab: 'events', wave: { raw: true, filt: true }, alerts: [], unread: 0, t: {}, sub: null, logFilter: '', showConfirm: false,
  proj: null, projScenario: null, compareBase: 'av', trajMode: 'research', assessScope: 'session', lastFb: null,

  init() {
    readColors();
    this.buildControls();
    this.buildTracker();
    this.buildHelp();
    this.bind();
    this.renderRight(true);
    this.renderTab(true);
    this.syncAll();
    let th = null; try { th = localStorage.getItem('pulsemr-theme'); } catch (e) {}
    if (!th && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) th = 'dark';
    if (th) this.setTheme(th, false);
    setTimeout(() => this.toast('SIMULATION ACTIVE · HAND TRACKING SYNTHETIC', 'info', 7000), 600);
  },

  /* ---------- controls ---------- */
  buildControls() {
    const sl = SLIDERS.map(s => `
      <div class="ctl">
        <label for="sl-${s.k}"><span>${s.label}</span><output id="out-${s.k}" for="sl-${s.k}"></output></label>
        <input type="range" id="sl-${s.k}" data-param="${s.k}" min="${s.min}" max="${s.max}" step="${s.step}" value="${S.params[s.k]}">
        <span class="st" id="st-${s.k}"></span>
      </div>`).join('');
    $('#ctlBody').innerHTML = `
      <div class="sect"><span>Run</span><span id="scenarioName">Scenario: stable performance</span></div>
      <div class="btnrow">
        <button class="btn primary" data-action="open-lab">Scenario lab</button>
        <button class="btn" data-action="recalibrate" title="R"><svg><use href="#i-target"/></svg>Recalibrate position</button>
      </div>
      <div class="mini" role="group" aria-label="Simulation speed" id="speedGrp">
        <button data-action="speed" data-arg="0.5" aria-pressed="false">0.5×</button><button data-action="speed" data-arg="1" aria-pressed="true">1×</button><button data-action="speed" data-arg="2" aria-pressed="false">2×</button>
      </div>
      <div class="sect"><span>Rescuer technique (synthetic)</span><button class="tog" data-action="reset-params" style="height:26px">RESET</button></div>
      ${sl}
      <div class="sect"><span>Feedback strategy</span></div>
      <div class="mini" role="group" aria-label="Feedback strategy" id="ctlGrp">
        <button class="coral" data-action="controller" data-arg="adaptive" aria-pressed="true">Adaptive feedback</button><button class="coral" data-action="controller" data-arg="static" aria-pressed="false">Static feedback</button>
      </div>
      <div class="sw"><span>Simulated learner responds to feedback</span><button class="switch" role="switch" aria-checked="false" data-action="learner" aria-label="Simulated learner responds to feedback"></button></div>
      <p class="hint">Off by default so the motion stays exactly as you set it. When on, the synthetic rescuer corrects part of each deficit after a cue (illustrative rule).</p>
      <div class="sect"><span>Tracking condition</span></div>
      <div class="mini" role="group" aria-label="Tracking condition" id="envGrp" style="flex-wrap:wrap">
        ${Object.values(ENV_MODES).map(e => `<button data-action="env" data-arg="${e.key}" aria-pressed="${e.key === 'lab'}" title="${e.name}">${e.short} · ${e.name.split(' ')[0]}</button>`).join('')}
      </div>
      <div class="sect"><span>Lab lighting</span></div>
      <div class="mini" role="group" aria-label="Lab lighting" id="lightGrp">
        <button data-action="lighting" data-arg="day" aria-pressed="true">Day lab</button><button data-action="lighting" data-arg="dim" aria-pressed="false">Dimmed simulation</button>
      </div>
      <div class="sw"><span>Biomechanics overlay</span><button class="switch" role="switch" aria-checked="true" data-action="overlay" aria-label="Biomechanics overlay"></button></div>
      <div class="chips" id="layerChips">
        ${[['joints', 'HAND JOINTS'], ['anchor', 'STERNUM ANCHOR'], ['axis', 'DEPTH AXIS'], ['traj', 'TRAJECTORY'], ['arrows', 'CORRECTION ARROWS']].map(([k, l]) => `<button class="tog" data-action="layer" data-arg="${k}" aria-pressed="true">${l}</button>`).join('')}
      </div>
      <div class="sect"><span>Camera</span><button class="tog" data-action="reset-camera" style="height:26px">RESET</button></div>
      <div class="chips">
        ${Object.entries(CAM_PRESETS).map(([k, p]) => `<button class="tog" data-action="view" data-arg="${k}" aria-pressed="false">${p.label.toUpperCase()}</button>`).join('')}
      </div>
      <button class="btn" data-action="explore"><svg><use href="#i-book"/></svg>Explore the research</button>`;
    this.syncControls();
  },
  syncControls() {
    for (const s of SLIDERS) {
      const el = $('#sl-' + s.k); if (!el) continue;
      if (document.activeElement !== el) el.value = S.params[s.k];
      const p = (S.params[s.k] - s.min) / (s.max - s.min) * 100; el.style.setProperty('--p', p + '%');
      $('#out-' + s.k).textContent = (s.step < 1 ? S.params[s.k].toFixed(1) : Math.round(S.params[s.k])) + ' ' + s.unit;
      const [w, st] = s.st(S.params[s.k]); const e = $('#st-' + s.k); e.textContent = w; e.style.color = `var(--${st === 'ok' ? 'sage' : st === 'warn' ? 'warn' : 'err'}-ink)`;
    }
    const sc = SCENARIOS.find(x => x.key === S.scenario);
    $('#scenarioName').textContent = 'Scenario: ' + (sc ? sc.name.toLowerCase() : 'custom settings');
    this.press('#speedGrp', String(S.speed));
    this.press('#ctlGrp', S.controller);
    this.press('#envGrp', S.env);
    this.press('#lightGrp', S.lighting);
    $$('[data-action="learner"]').forEach(b => b.setAttribute('aria-checked', String(S.learner)));
    $$('.switch[data-action="overlay"]').forEach(b => b.setAttribute('aria-checked', String(S.overlay.on)));
    $$('#layerChips .tog').forEach(b => b.setAttribute('aria-pressed', String(S.overlay[b.dataset.arg])));
    $$('.tog[data-action="view"]').forEach(b => b.setAttribute('aria-pressed', String(S.view === b.dataset.arg)));
  },
  press(sel, val) { $$(sel + ' button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.arg === val))); },

  /* ---------- tracker ---------- */
  buildTracker() {
    $('#stages').innerHTML = STAGES.map((s, i) => `${i ? '<li class="link" aria-hidden="true"></li>' : ''}<li><button class="stage" data-action="stage" data-arg="${i}" data-on="0"><span class="n">${s.n}</span><span class="t">${s.t}<span class="d" id="sd-${i}"></span></span></button></li>`).join('');
  },
  updateTracker() {
    const now = performance.now();
    let active = Pipeline.active;
    if (S.calib.state === 'running') active = 0;
    else if (now - Pipeline.last[active] > 1400) active = 1;
    $$('.stage').forEach((b, i) => b.dataset.on = i === active ? '1' : '0');
    const lc = lastCycleAt(viewT()), f = currentFeedback(), la = lastActionable();
    const d = [
      S.calib.state === 'done' ? `Complete · residual ${Math.hypot(S.calib.residual.x, S.calib.residual.y).toFixed(1)} mm` : `Running · step ${S.calib.step + 1} of 4`,
      `30 Hz simulated · confidence ${V.conf.toFixed(2)}${S.env !== 'lab' ? ' · ' + ENV_MODES[S.env].name.toLowerCase() : ''}`,
      `Butterworth 5 Hz · 5-sample average`,
      lc ? `Cycle ${String(lc.n).padStart(3, '0')} · ${lc.depth.toFixed(0)} mm · ${lc.rate ? lc.rate.toFixed(0) + ' CPM' : 'rate n/a'}` : 'Waiting for compressions',
      la ? `Primary ${METRIC_LABEL[la.metric].toLowerCase()} · level ${la.level}` : 'No deficit detected',
      f ? f.modalities.join(' + ') + ' · ' + f.message.toLowerCase() : 'Idle'
    ];
    d.forEach((s, i) => { const e = $('#sd-' + i); if (e && e.textContent !== s) e.textContent = s; });
  },

  /* ---------- KPI cards ---------- */
  updateKpis() {
    const t = viewT(), c = lastCycleAt(t);
    const depth = c ? c.depth : null;
    $('#kDepth').innerHTML = (depth == null ? 'n/a' : depth.toFixed(0)) + '<small>mm</small>';
    const dc = $('#kDepthChip');
    const ds = depth == null ? ['WAITING', 'info'] : depth < 50 ? ['BELOW TARGET', 'bad'] : depth > 60 ? ['ABOVE TARGET', 'bad'] : ['TARGET RANGE', 'ok'];
    dc.textContent = ds[0]; dc.dataset.s = ds[1];
    drawDepthBar($('#kDepthBar'), depth, V.z);
    const r = kpiRate(t);
    $('#kRate').innerHTML = (r == null ? 'n/a' : r.toFixed(0)) + '<small>CPM</small>';
    const rc = $('#kRateChip');
    const pl = S.mode !== 'replay' ? Detect.pauseLive : null;
    const rs = pl ? ['PAUSED ' + pl.dur.toFixed(1) + ' s', 'bad'] : rateState(r);
    rc.textContent = rs[0]; rc.dataset.s = rs[1];
    drawRhythm($('#kRateViz'), t);
    const roll = rollingScores(t), ses = sessionScores(t);
    const g = roll ? roll.gcs : null;
    $('#kScore').textContent = g == null ? 'n/a' : g.toFixed(0);
    $('#kScoreArc').setAttribute('stroke-dasharray', `${(g || 0) / 100 * 157} 157`);
    $('#kScoreArc').setAttribute('stroke', g == null ? 'var(--neutral)' : g >= 80 ? 'var(--sage)' : g >= 60 ? 'var(--warn)' : 'var(--coral)');
    const parts = roll ? [['Depth', roll.depthAcc], ['Rate', roll.rateAcc == null ? roll.depthAcc : roll.rateAcc], ['Hand', roll.posAcc], ['Recoil', roll.recoilAcc], ['CCF', 100 * roll.cf]] : [];
    $('#kParts').innerHTML = parts.map(([k, v]) => `<div class="part"><span>${k}</span><i><b style="width:${v.toFixed(0)}%"></b></i><span>${v.toFixed(0)}</span></div>`).join('') || '<div class="part" style="grid-template-columns:1fr"><span>Waiting for compressions</span></div>';
    $('#kScoreSub').textContent = ses ? `SESSION ${ses.gcs.toFixed(0)}` : '';
  },

  /* ---------- right panel ---------- */
  renderRight(force) {
    const key = S.selected ? 'obj:' + S.selected + ':' + (this.sub || '') : 'default';
    const el = $('#right');
    el.classList.toggle('sel-open', !!S.selected);
    if (!force && this.rightKey === key) { this.updateRight(); return; }
    this.rightKey = key;
    if (!S.selected) {
      el.innerHTML = `
        <div class="phead"><h2>Adaptive CPR guidance</h2><span class="rtag sim">Simulated</span></div>
        <div class="pbody" id="rightBody" tabindex="0">
          <div class="rows" id="statusRows"></div>
          <div><div class="sect"><span>Current compression wave</span><span id="waveNote"></span></div><canvas class="spark" id="spark"></canvas></div>
          <div class="box" id="decisionBox">
            <div class="sect" style="margin:0 0 8px"><span>Adaptive decision engine</span><span id="ctlMode"></span></div>
            <div class="devs" id="devs"></div>
            <div class="flow" id="flow" style="margin:10px 0 8px">${['INPUT METRICS', 'DEVIATION', 'DEFICIT PRIORITY', 'MODALITY', 'INTENSITY', 'OUTPUT'].map((s, i) => `${i ? '<i></i>' : ''}<span data-i="${i}">${s}</span>`).join('')}</div>
            <dl class="out" id="decOut"></dl>
            <div class="msg" id="decMsg" style="margin-top:8px"></div>
            <p class="hint" id="decNote" style="margin:4px 0 0"></p>
          </div>
          <div class="box">
            <div class="sect" style="margin:0 0 6px"><span>Haptic feedback</span><span id="hapNote">HAPTIC SIGNAL SIMULATED</span></div>
            <div class="haptic"><canvas class="spark" id="hapWave" style="height:34px"></canvas><div><div class="hgauge"><b id="hapGauge" style="width:0%"></b></div><div class="mono" style="font-size:10px;color:var(--ink-2);margin-top:4px" id="hapLvl">INTENSITY 0</div></div></div>
          </div>
          <div class="btnrow"><button class="btn sm" data-action="sub-open" data-arg="log">Decision log</button><button class="btn sm" data-action="sub-open" data-arg="threshold">Adaptive thresholds</button><button class="btn sm" data-action="mode" data-arg="assess">Assess session</button></div>
        </div>`;
      $('#devs').innerHTML = ['depth', 'rate', 'position', 'recoil', 'interrupt'].map(m => `<div class="dev" data-m="${m}"><span>${METRIC_LABEL[m]}</span><div class="bar"><b style="width:0%"></b></div><span class="w"></span></div>`).join('');
    } else {
      const o = OBJ[S.selected]; if (!o) { S.selected = null; return this.renderRight(true); }
      const acts = (o.actions || []).map(([l, a, arg], i) => `<button class="btn sm${i === 0 ? ' primary' : ''}" data-action="${a}" ${arg != null ? `data-arg="${arg}"` : ''} data-dyn="${i}">${typeof l === 'function' ? l() : l}</button>`).join('');
      el.innerHTML = `
        <div class="phead"><span class="eyebrow">${esc(o.kicker)}</span><button class="btn sm ghost" data-action="deselect" aria-label="Close details"><svg><use href="#i-close"/></svg></button></div>
        <div class="pbody" tabindex="0">
          <h2 class="obj-title">${esc(o.title)}</h2>
          <div class="rows" id="objRows"></div>
          <div class="actions">${acts}</div>
          <div id="subView"></div>
        </div>`;
    }
    this.updateRight();
  },
  updateRight() {
    if (!S.selected) {
      const rows = [['Mode', S.mode === 'replay' ? 'REPLAY' : 'TRAINING SIMULATION'], ['Tracking', S.calib.state === 'done' ? 'ACTIVE · SYNTHETIC' : 'CALIBRATING', S.calib.state === 'done' ? 'ok' : 'info'], ['Calibration', calibWord(), S.calib.state === 'done' ? 'ok' : 'info'], ['Compression monitoring', S.running ? 'ACTIVE' : 'PAUSED', S.running ? 'ok' : 'warn'], ['Adaptive controller', S.controller === 'adaptive' && S.ablation !== 'adaptive' ? 'ENABLED' : 'STATIC RULES', S.controller === 'adaptive' && S.ablation !== 'adaptive' ? 'ok' : 'info'], ['Visual feedback', 'ENABLED', 'ok'], ['Auditory feedback', S.audio.enabled ? 'ON' : 'OPTIONAL · MUTED', S.audio.enabled ? 'ok' : 'info'], ['Haptic feedback', S.ablation === 'haptic' ? 'DISABLED (ABLATION)' : 'SIMULATED', 'info']];
      if (S.ablation !== 'full') rows.push(['Illustrative ablation', RESEARCH.ablation.find(a => a.key === S.ablation).name.toUpperCase(), 'warn']);
      this.fillRows($('#statusRows'), rows);
      drawSpark($('#spark'), viewT());
      $('#waveNote').textContent = V.paused ? 'PAUSED' : (Math.max(0, V.z)).toFixed(0) + ' mm now';
      this.updateDecision();
      const f = currentFeedback(), hap = f && f.modalities.includes('haptic') && viewT() - f.t < 1.6;
      drawHaptic($('#hapWave'), hap ? f.level : 0, hap, performance.now());
      $('#hapGauge').style.width = (hap ? f.level / 3 * 100 : 0) + '%';
      $('#hapLvl').textContent = hap ? 'INTENSITY ' + f.level + ' OF 3' : 'INTENSITY 0';
      $('#hapNote').textContent = S.haptics.vibrate && Feedback.vibrateSupported ? 'PHONE VIBRATION ON' : 'HAPTIC SIGNAL SIMULATED';
      return;
    }
    const o = OBJ[S.selected]; if (!o) return;
    this.fillRows($('#objRows'), o.rows());
    (o.actions || []).forEach(([l], i) => { if (typeof l === 'function') { const b = $(`#right [data-dyn="${i}"]`); if (b) b.textContent = l(); } });
    const sv = $('#subView');
    if (sv) {
      if (this.sub === 'log') sv.innerHTML = this.decisionLogHtml();
      else if (this.sub === 'threshold') sv.innerHTML = this.thresholdHtml();
      else sv.innerHTML = '';
    }
  },
  fillRows(el, rows) {
    if (!el) return;
    if (el.children.length !== rows.length) el.innerHTML = rows.map(() => `<div class="rrow"><span></span><b></b></div>`).join('');
    rows.forEach(([k, v, st], i) => {
      const r = el.children[i]; r.children[0].textContent = k;
      const b = r.children[1];
      if (st) { b.innerHTML = `<span class="st-pill" data-s="${st}">${esc(v)}</span>`; } else if (b.textContent !== v) b.textContent = v;
    });
  },
  updateDecision() {
    let dec = FB.decisions.last();
    if (S.mode === 'replay') { dec = null; const it = FB.decisions.items; for (let i = it.length - 1; i >= 0; i--) if (it[i].t <= viewT()) { dec = it[i]; break; } }
    const used = S.controller === 'adaptive' && S.ablation !== 'adaptive' ? 'adaptive' : 'static';
    $('#ctlMode').textContent = used === 'adaptive' ? 'α = 0.3' : 'STATIC RULES'; $('#ctlMode').style.textTransform = 'none';
    const c = lastCycleAt(viewT());
    const dv = c ? deviations(c) : { d: { depth: 0, rate: 0, position: 0, recoil: 0 } };
    const pauseDev = Detect.pauseLive && S.mode !== 'replay' ? 0.5 + (Detect.pauseLive.dur - TARGET.pauseMin) / 4 : 0;
    const la = lastActionable();
    const primary = Detect.pauseLive && S.mode !== 'replay' ? 'interrupt' : la && viewT() - la.t < 3 ? la.metric : null;
    const w = Ctl.adaptive.w;
    const labels = {
      depth: c ? `${c.depth.toFixed(0)} mm` : 'n/a', rate: c && c.rate ? `${c.rate.toFixed(0)} CPM` : 'n/a', position: c ? `${c.pos.toFixed(0)} mm` : 'n/a',
      recoil: c ? `${c.resid.toFixed(1)} mm` : 'n/a', interrupt: Detect.pauseLive && S.mode !== 'replay' ? `${Detect.pauseLive.dur.toFixed(1)} s` : 'none'
    };
    $$('#devs .dev').forEach(row => {
      const m = row.dataset.m, val = m === 'interrupt' ? pauseDev : dv.d[m];
      row.querySelector('b').style.width = clamp(val / 1.5, 0, 1) * 100 + '%';
      row.querySelector('.w').textContent = labels[m] + (used === 'adaptive' && m !== 'interrupt' && S.mode !== 'replay' ? ` ×${w[m].toFixed(2)}` : '');
      row.dataset.primary = primary === m ? '1' : '0';
    });
    const f = la && viewT() - la.t < 4 ? la : null;
    const out = f ? [['PRIMARY DEFICIT', METRIC_LABEL[f.metric].toUpperCase()], ['DEVIATION', (f.metric === 'interrupt' ? DEV_WORD[f.level] : DEV_WORD[Math.min(3, Math.max(1, levelOf(f.dev)))]).toUpperCase()], ['MODALITY', f.modalities.map(m => m.toUpperCase()).join(' + ')], ['INTENSITY', String(f.level)], ['CONTROLLER', (f.ctl || used).toUpperCase()]] : [['PRIMARY DEFICIT', 'NONE'], ['DEVIATION', 'WITHIN TARGETS'], ['MODALITY', 'VISUAL CONFIRMATION'], ['INTENSITY', '1'], ['CONTROLLER', used.toUpperCase()]];
    const dl = $('#decOut'); const html = out.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
    if (dl.innerHTML !== html) dl.innerHTML = html;
    const msg = f ? 'MESSAGE: ' + f.message : (Detect.pauseLive && S.mode !== 'replay' ? 'MESSAGE: RESUME COMPRESSIONS' : 'MESSAGE: GOOD COMPRESSIONS');
    $('#decMsg').textContent = msg;
    $('#decMsg').style.color = f ? (f.level >= 3 ? 'var(--err-ink)' : 'var(--coral-ink)') : 'var(--sage-ink)';
    $('#decNote').textContent = f && f.note ? f.note.charAt(0).toUpperCase() + f.note.slice(1) + '.' : (dec && dec.adaptive && dec.adaptive.suppressed ? 'Same cue held to avoid repeating it on consecutive compressions.' : '');
    // decision flow recalculation animation
    const since = (performance.now() - (this.flowT || 0));
    $$('#flow span').forEach(s => { const i = +s.dataset.i; s.classList.toggle('on', !!(this.flowT && since > i * 110 && since < 900 + i * 110)); });
  },
  animateFlow() { this.flowT = performance.now(); },
  decisionLogHtml() {
    const it = FB.decisions.last(8);
    const rows = [].concat(it || []).filter(Boolean).reverse().map(d => {
      if (d.withheld) return `<tr><td class="m">${String(d.n).padStart(3, '0')}</td><td colspan="2">withheld · low tracking confidence</td><td class="m">${d.used}</td></tr>`;
      const a = d.adaptive, s = d.static;
      const fa = a ? (a.suppressed ? 'held' : (a.confirm ? 'confirm' : a.message.toLowerCase()) + ' L' + (a.level || '')) : 'none';
      const fs = s ? s.message.toLowerCase() + ' L' + s.level : 'none';
      return `<tr><td class="m">${String(d.n).padStart(3, '0')}</td><td>${esc(fa)}</td><td>${esc(fs)}</td><td class="m">${d.used}</td></tr>`;
    }).join('');
    return `<div class="sect"><span>Decision log</span><button class="tog" data-action="sub-close" style="height:26px">CLOSE</button></div><table class="data"><thead><tr><th>Cycle</th><th>Adaptive</th><th>Static</th><th>Used</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No decisions yet</td></tr>'}</tbody></table>`;
  },
  thresholdHtml() {
    const A = Ctl.adaptive, t1 = A.t1 || {};
    const rows = ['depth', 'rate', 'position', 'recoil'].map(m => `<tr><td>${METRIC_LABEL[m]}</td><td class="m">${A.w[m].toFixed(2)}</td><td class="m">${A.persist ? (A.persist[m] * 100).toFixed(0) + '%' : 'n/a'}</td><td class="m">${(t1[m] || 0.35).toFixed(2)}</td><td class="m">1.00</td></tr>`).join('');
    return `<div class="sect"><span>Adaptive thresholds</span><button class="tog" data-action="sub-close" style="height:26px">CLOSE</button></div>
      <table class="data"><thead><tr><th>Metric</th><th>Weight</th><th>Persistence</th><th>Moderate from</th><th>Significant from</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="hint">Weights update each compression: w ← 0.7·w + 0.3·(1 + persistence over the last 10). A larger weight raises a deficit's priority and lowers its moderate threshold (0.35 / √w). Guideline targets stay at 50–60 mm, 100–120 CPM, 20 mm and full recoil.</p>`;
  },

  /* ---------- bottom tabs ---------- */
  renderTab(force) {
    const p = $('#tabPanel'); if (!p) return;
    $$('#dataTabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.arg === this.tab)));
    if (this.tab === 'events') {
      const items = Cycles.items.filter(c => c.t <= viewT()).slice(-80).reverse();
      const newest = items[0] ? items[0].n : 0;
      const rows = items.map(c => `<tr class="${c.n === newest && newest !== this.lastNewest ? 'new' : ''}"><td class="m">${String(c.n).padStart(3, '0')}</td><td class="m">${c.depth.toFixed(0)} mm</td><td class="m">${c.rate ? c.rate.toFixed(0) + ' CPM' : 'n/a'}</td><td class="m">${c.pos.toFixed(0)} mm</td><td>${c.recoilLabel}</td><td>${esc(c.fb || 'None')}</td><td><span class="st-pill" data-s="${stateOfCycle(c)}">${c.status}</span></td></tr>`).join('');
      this.lastNewest = newest;
      p.innerHTML = `<table class="data"><thead><tr><th>Cycle</th><th>Depth</th><th>Rate</th><th>Position error</th><th>Recoil</th><th>Feedback</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="7">Compressions appear here after calibration.</td></tr>'}</tbody></table>`;
    } else if (this.tab === 'log') {
      let items = FB.log.items.filter(f => f.t <= viewT());
      if (!this.showConfirm) items = items.filter(f => !f.confirm);
      if (this.logFilter) items = items.filter(f => f.message === this.logFilter);
      items = items.slice(-80).reverse();
      const rows = items.map(f => `<tr><td class="m">${fmtStamp(f.t)}</td><td>${f.confirm ? 'None (confirmation)' : METRIC_LABEL[f.metric]}</td><td>${f.confirm ? 'Small' : f.metric === 'interrupt' ? DEV_WORD[f.level] : DEV_WORD[Math.min(3, Math.max(1, levelOf(f.dev)))]}</td><td>${f.modalities.map(m => m[0].toUpperCase() + m.slice(1)).join(' + ')}</td><td class="m">${f.level}</td><td>${esc(f.message.charAt(0) + f.message.slice(1).toLowerCase())}</td></tr>`).join('');
      p.innerHTML = `<div class="tabnote"><span>${this.logFilter ? 'Filtered: ' + esc(this.logFilter.toLowerCase()) + ' <button class="tog" data-action="log-filter" data-arg="" style="height:26px">CLEAR</button>' : 'Feedback delivered by the active controller'}</span><button class="tog" data-action="log-confirm" aria-pressed="${this.showConfirm}">CONFIRMATIONS</button></div>
        <table class="data"><thead><tr><th>Timestamp</th><th>Performance deficit</th><th>Deviation</th><th>Modality</th><th>Intensity</th><th>Message</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No feedback events yet.</td></tr>'}</tbody></table>`;
    } else if (this.tab === 'results') {
      if (!force && p.dataset.k === 'results') return;
      p.innerHTML = `<div class="tabnote"><span class="rtag">Reported in manuscript</span><span>Fixed values. Never changed by the simulation. No participant-level records are shown.</span></div>
        <div class="minichart">${svgSmall('depth', 'Depth accuracy (%)')}${svgSmall('rate', 'Rate accuracy (%)')}${svgSmall('hand', 'Hand position accuracy (%)')}${svgSmall('gcs', 'Guideline compliance score')}</div>`;
    } else if (this.tab === 'avs') {
      p.innerHTML = this.avsHtml();
    }
    p.dataset.k = this.tab;
  },
  avsHtml() {
    const sum = log => { const it = log.items; const mods = { visual: 0, audio: 0, haptic: 0 }; let lvl = 0, rep = 0, prev = ''; const act = it.filter(x => !x.confirm); for (const e of act) { e.modalities.forEach(m => mods[m]++); lvl += e.level; if (e.message === prev) rep++; prev = e.message; } return { n: act.length, mods, lvl: act.length ? lvl / act.length : 0, rep }; };
    const a = sum(FB.adaptiveLog), s = sum(FB.staticLog);
    const hist = (log, n) => [].concat(log.items.filter(x => !x.confirm).slice(-n)).reverse().map(e => `<tr><td class="m">${fmtStamp(e.t)}</td><td>${esc(e.message.toLowerCase())}</td><td class="m">${e.modalities.map(m => m[0].toUpperCase()).join('+')} L${e.level}</td></tr>`).join('') || '<tr><td colspan="3">None yet</td></tr>';
    const row = (k, x, y) => `<tr><td>${k}</td><td class="m">${x}</td><td class="m">${y}</td></tr>`;
    return `<div class="tabnote"><span class="rtag sim">Synthetic · this demo's own rules</span><span>Both controllers see the same simulated compressions; only the ${S.controller === 'adaptive' ? 'adaptive' : 'static'} one drives what you see.</span></div>
      <div style="padding:0 10px 8px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">
        <table class="data"><thead><tr><th>Measure</th><th>Static</th><th>Adaptive</th></tr></thead><tbody>
          ${row('Feedback events', s.n, a.n)}${row('Visual cues', s.mods.visual, a.mods.visual)}${row('Audio cues', s.mods.audio, a.mods.audio)}${row('Haptic cues', s.mods.haptic, a.mods.haptic)}${row('Repeated identical cues', s.rep, a.rep)}${row('Mean intensity', s.lvl.toFixed(2), a.lvl.toFixed(2))}
        </tbody></table>
        <table class="data"><thead><tr><th>Static</th><th>Message</th><th>Cue</th></tr></thead><tbody>${hist(FB.staticLog, 8)}</tbody></table>
        <table class="data"><thead><tr><th>Adaptive</th><th>Message</th><th>Cue</th></tr></thead><tbody>${hist(FB.adaptiveLog, 8)}</tbody></table>
      </div>
      <div class="tabnote"><span>Simulated quality trajectory for both strategies is in COMPARE.</span><button class="btn sm" data-action="mode" data-arg="compare">Open projection</button></div>`;
  },

  /* ---------- assessment drawer ---------- */
  renderAssess() {
    const d = $('#assessDrawer');
    d.innerHTML = `
      <div class="phead"><h2>Performance assessment · simulated session</h2>
        <div class="btnrow"><div class="mini" id="scopeGrp"><button data-action="scope" data-arg="session" aria-pressed="${this.assessScope === 'session'}">Session</button><button data-action="scope" data-arg="roll" aria-pressed="${this.assessScope === 'roll'}">Last 20</button></div>
        <button class="btn sm ghost" data-action="mode" data-arg="train" aria-label="Close assessment"><svg><use href="#i-close"/></svg></button></div></div>
      <div class="pbody" tabindex="0">
        <div class="tiles" id="aTiles"></div>
        <div class="card"><h4><span>Live depth waveform</span><span class="rtag sim">Simulated</span></h4><canvas id="aWave" style="height:170px"></canvas></div>
        <div class="grid2">
          <div class="card"><h4>Depth per compression</h4><canvas id="aDepth"></canvas></div>
          <div class="card"><h4>Rate per compression</h4><canvas id="aRate"></canvas></div>
          <div class="card"><h4>Hand-position error</h4><canvas id="aPos"></canvas></div>
          <div class="card"><h4>Recoil residual</h4><canvas id="aRecoil"></canvas></div>
          <div class="card"><h4>Interruption history</h4><canvas id="aPause" style="height:120px"></canvas></div>
          <div class="card"><h4>Feedback events</h4><canvas id="aFb" style="height:120px"></canvas></div>
        </div>
        <p class="hint">Scores use this demo's equal-weighted guideline compliance score: the mean of depth accuracy (50–60 mm), rate accuracy (100–120 CPM), hand-position accuracy (≤ 20 mm), full-recoil rate (residual ≤ 3 mm) and compression fraction (1 minus interruption fraction). It is computed from simulated events and is not a clinically validated score.</p>
      </div>`;
    this.updateAssess();
  },
  updateAssess() {
    if ($('#assessDrawer').hidden) return;
    const sc = this.assessScope === 'session' ? sessionScores(viewT()) : rollingScores(viewT());
    const mean = (f) => { const l = Cycles.items.filter(c => c.t <= viewT()); const v = l.map(f).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const tiles = [['GCS', sc ? sc.gcs.toFixed(1) : 'n/a', '/100', true], ['Depth accuracy', sc ? sc.depthAcc.toFixed(0) : 'n/a', '%'], ['Rate accuracy', sc && sc.rateAcc != null ? sc.rateAcc.toFixed(0) : 'n/a', '%'], ['Hand position acc.', sc ? sc.posAcc.toFixed(0) : 'n/a', '%'], ['Full recoil', sc ? sc.recoilAcc.toFixed(0) : 'n/a', '%'], ['Interruption fraction', sc ? sc.IF.toFixed(2) : 'n/a', ''], ['Compressions', String(sc ? sc.n : 0), ''], ['Mean depth', fmt1(mean(c => c.depth)), 'mm'], ['Mean rate', fmt0(mean(c => c.rate)), 'CPM']];
    $('#aTiles').innerHTML = tiles.map(([k, v, u, hl]) => `<div class="tile${hl ? ' hl' : ''}"><div class="k">${k}</div><div class="v">${v}<small> ${u}</small></div></div>`).join('');
    drawWave($('#aWave'), { tEnd: viewT(), window: 12, fb: currentFeedback(), raw: this.wave.raw, filt: this.wave.filt });
    const list = Cycles.items.filter(c => c.t <= viewT()).slice(-160);
    drawCycleChart($('#aDepth'), list, { get: c => c.depth, range: [20, 80], band: [50, 60], ticks: [20, 50, 60, 80], unit: 'mm', ok: v => v >= 50 && v <= 60 });
    drawCycleChart($('#aRate'), list, { get: c => c.rate, range: [60, 160], band: [100, 120], ticks: [60, 100, 120, 160], unit: 'CPM', ok: v => v >= 100 && v <= 120 });
    drawCycleChart($('#aPos'), list, { get: c => c.pos, range: [0, 50], limit: 20, limitLabel: '20 mm THRESHOLD', ticks: [0, 20, 50], unit: 'mm', ok: v => v <= 20 });
    drawCycleChart($('#aRecoil'), list, { get: c => c.resid, range: [0, 16], limit: 3, limitLabel: 'FULL RECOIL ≤ 3 mm', ticks: [0, 3, 8, 16], unit: 'mm', ok: v => v <= 3 });
    drawPauseHistory($('#aPause'));
    drawFeedbackTimeline($('#aFb'));
  },

  /* ---------- comparison drawer ---------- */
  renderCompare() {
    const d = $('#compareDrawer');
    const C2 = RESEARCH.conditions;
    const abl = RESEARCH.ablation.map(a => `<button data-action="ablation" data-arg="${a.key}" data-full="${a.key === 'full' ? 1 : 0}" aria-pressed="${S.ablation === a.key}"><span>${a.name}</span><span class="track"><b style="width:${a.gcs}%"></b></span><span class="v">${a.gcs.toFixed(1)}</span></button>`).join('');
    const L = RESEARCH.latency;
    d.innerHTML = `
      <div class="phead"><h2>Reported experimental findings</h2><div class="btnrow"><span class="rtag">Reported in manuscript</span><button class="btn sm ghost" data-action="mode" data-arg="train" aria-label="Close comparison"><svg><use href="#i-close"/></svg></button></div></div>
      <div class="pbody" tabindex="0">
        <div>
          <h3 class="bigtitle">Adaptive MR guidance against <em>${esc(C2[this.compareBase].short.toLowerCase())}</em></h3>
          <p class="hint" style="margin-top:6px">${RESEARCH.participants} participants. Fixed values from the manuscript summary; they do not come from, and never change with, this simulation.</p>
        </div>
        <div class="mini" role="group" aria-label="Baseline condition" id="baseGrp" style="max-width:560px">
          <button data-action="base" data-arg="av" aria-pressed="${this.compareBase === 'av'}">Conventional audio-visual</button><button data-action="base" data-arg="metronome" aria-pressed="${this.compareBase === 'metronome'}">Metronome-only</button><button data-action="base" data-arg="commercial" aria-pressed="${this.compareBase === 'commercial'}">Commercial device</button>
        </div>
        <div class="card">${svgCompare(this.compareBase)}</div>
        <div class="grid3">
          <div class="tile hl"><div class="k">Depth accuracy, AV to adaptive MR</div><div class="v">+17.5<small> percentage points</small></div><div class="k" style="margin-top:4px">58.1% to 75.6%</div></div>
          <div class="tile"><div class="k">Interruption fraction, AV to adaptive MR</div><div class="v">0.18 → 0.08</div><div class="k" style="margin-top:4px">Not reported for the other baselines</div></div>
          <div class="tile"><div class="k">Median feedback latency, adaptive MR</div><div class="v">47<small> ms</small></div><div class="k" style="margin-top:4px">IQR 34–67 ms</div></div>
        </div>
        <div class="card"><h4><span>Performance trajectory</span><span class="mini" id="trajGrp" style="width:260px"><button data-action="traj" data-arg="research" aria-pressed="${this.trajMode === 'research'}">Research summary</button><button data-action="traj" data-arg="live" aria-pressed="${this.trajMode === 'live'}">Live simulation</button></span></h4>
          <canvas id="cTraj" style="height:210px"></canvas>
          <p>Adaptive MR guidance was reported to produce a steeper performance improvement trajectory during simulated CPR training. The manuscript's plotted values were not available, so the research view shows the reported session means as dotted reference lines and dashed curves whose shape is illustrative, constrained only to average to those means.</p>
        </div>
        <div class="grid2">
          <div class="card"><h4><span>Component contribution analysis</span><span class="rtag">Reported</span></h4>
            <div class="abl" id="ablList">${abl}</div>
            <p id="ablNote">Select a variant to switch off that module in the live demonstration. This illustrates the module; it does not reproduce the original experiment.</p>
          </div>
          <div class="card"><h4><span>System responsiveness</span><span class="rtag">Reported research measurements</span></h4>
            <table class="lat"><thead><tr><th>Measure</th><th>Median</th></tr></thead><tbody>
              <tr><td>Overall feedback latency (IQR ${L.iqr[0]}–${L.iqr[1]} ms)</td><td>${L.median} ms</td></tr><tr><td>Visual feedback</td><td>${L.visual} ms</td></tr><tr><td>Auditory feedback</td><td>${L.auditory} ms</td></tr><tr><td>Haptic feedback</td><td>${L.haptic} ms</td></tr><tr><td>Combined feedback</td><td>${L.combined} ms</td></tr>
            </tbody></table>
            <div class="sect" style="margin-top:6px"><span>This browser demo</span><span class="rtag sim">Measured here</span></div>
            <table class="lat"><tbody><tr><td>Browser frame interval (mean of last 120 frames)</td><td id="frameMs">n/a</td></tr><tr><td>Frames per second</td><td id="fps">n/a</td></tr></tbody></table>
            <p>Browser frame interval is not hand-tracking-to-feedback latency. This page does not reproduce the headset measurement pipeline.</p>
          </div>
        </div>
        <div class="card"><h4><span>Static versus adaptive guidance · synthetic projection</span><span class="rtag sim">Synthetic rules</span></h4>
          <div class="btnrow"><button class="btn sm primary" data-action="run-proj">Run 10-minute projection for this scenario</button><span class="hint" id="projNote">Scenario: ${esc((SCENARIOS.find(s => s.key === S.scenario) || { name: 'custom settings' }).name)}</span></div>
          <canvas id="cProj" style="height:170px"></canvas>
          <div id="projStats"></div>
          <p>Two synthetic trainees with the same habits receive static or adaptive cues. Each cue corrects part of the deficit; repeated identical cues lose effect (0.8 per repeat). These are this demo's rules, not measured evidence.</p>
        </div>
      </div>`;
    this.updateCompare(true);
  },
  updateCompare(force) {
    if ($('#compareDrawer').hidden) return;
    drawTrajectory($('#cTraj'), this.trajMode);
    drawProjection2($('#cProj'), this.proj && this.projScenario === S.scenario ? this.proj : null);
    const fm = $('#frameMs'); if (fm) { fm.textContent = Perf.frameMs ? Perf.frameMs.toFixed(1) + ' ms' : 'n/a'; $('#fps').textContent = Perf.fps ? Perf.fps.toFixed(0) : 'n/a'; }
    const ps = $('#projStats');
    if (ps && force) {
      const p = this.proj && this.projScenario === S.scenario ? this.proj : null;
      ps.innerHTML = p ? `<table class="data"><thead><tr><th>Synthetic trainee</th><th>Feedback events</th><th>Visual / audio / haptic</th><th>Repeated cues</th><th>Mean intensity</th><th>GCS at 10 min</th></tr></thead><tbody>
        <tr><td>Static feedback</td><td class="m">${p.static.events}</td><td class="m">${p.static.mods.visual} / ${p.static.mods.audio} / ${p.static.mods.haptic}</td><td class="m">${p.static.repeats}</td><td class="m">${p.static.meanLevel.toFixed(2)}</td><td class="m">${fmt1(p.static.finalGcs)}</td></tr>
        <tr><td>Adaptive feedback</td><td class="m">${p.adaptive.events}</td><td class="m">${p.adaptive.mods.visual} / ${p.adaptive.mods.audio} / ${p.adaptive.mods.haptic}</td><td class="m">${p.adaptive.repeats}</td><td class="m">${p.adaptive.meanLevel.toFixed(2)}</td><td class="m">${fmt1(p.adaptive.finalGcs)}</td></tr></tbody></table>` : '';
    }
  },

  /* ---------- replay ---------- */
  renderReplay() {
    $('#replayBar').innerHTML = `
      <div class="phead"><h2>Session replay</h2><div class="btnrow"><span class="rtag sim">Recorded synthetic session</span><button class="btn sm ghost" data-action="mode" data-arg="train">Exit replay</button></div></div>
      <div class="pbody" tabindex="0">
        <div class="rp-controls">
          <button class="btn sm" data-action="rp" data-arg="start" title="Restart replay"><svg><use href="#i-reset"/></svg>Restart</button>
          <button class="btn sm" data-action="rp" data-arg="back" title="Step backward one compression (Left arrow)"><svg><use href="#i-back"/></svg></button>
          <button class="btn sm primary" data-action="rp" data-arg="play" id="rpPlay"><svg><use href="#i-play" id="rpIcon"/></svg><span id="rpTxt">Play</span></button>
          <button class="btn sm" data-action="rp" data-arg="fwd" title="Step forward one compression (Right arrow)"><svg><use href="#i-fwd"/></svg></button>
          <div class="mini" id="rpSpeed" style="width:190px">${[0.5, 1, 2, 4].map(v => `<button data-action="rp-speed" data-arg="${v}" aria-pressed="${S.replay.speed === v}">${v}×</button>`).join('')}</div>
          <button class="btn sm" data-action="rp" data-arg="prevfb"><svg><use href="#i-flag"/></svg>Previous feedback</button>
          <button class="btn sm" data-action="rp" data-arg="nextfb"><svg><use href="#i-flag"/></svg>Next feedback</button>
          <button class="btn sm ghost" data-action="reset" title="Discard this session and start a new one">Restart session</button>
          <span class="rp-time" id="rpTime"></span>
        </div>
        <div class="timeline"><canvas id="rpTimeline" aria-label="Replay timeline. Click or drag to scrub."></canvas></div>
        <div class="rp-legend">${MARKS.map(m => `<span><i style="background:${m.col()}"></i>${m.label}</span>`).join('')}<span><i style="background:var(--coral);clip-path:polygon(50% 0,0 100%,100% 100%)"></i>Feedback event</span></div>
        <div class="tabnote" style="padding:0" id="rpEvent"></div>
      </div>`;
    this.updateReplay();
  },
  updateReplay() {
    if ($('#replayBar').hidden) return;
    drawTimeline($('#rpTimeline'));
    const [a, b] = replayRange();
    $('#rpTime').textContent = fmtClock(S.replay.t) + ' / ' + fmtClock(b);
    $('#rpIcon').setAttribute('href', S.replay.playing ? '#i-pause' : '#i-play'); $('#rpTxt').textContent = S.replay.playing ? 'Pause' : 'Play';
    const f = currentFeedback(), c = lastCycleAt(S.replay.t);
    $('#rpEvent').innerHTML = `<span>${c ? `Cycle ${String(c.n).padStart(3, '0')} · ${c.depth.toFixed(0)} mm · ${c.rate ? c.rate.toFixed(0) + ' CPM' : 'rate n/a'} · error ${c.pos.toFixed(0)} mm · recoil ${c.recoilLabel.toLowerCase()} · ${c.status}` : 'Before the first compression'}</span><span>${f ? `<span class="st-pill" data-s="${f.level >= 3 ? 'bad' : 'warn'}">${esc(f.message)} · ${f.modalities.join(' + ')} · level ${f.level}</span>` : ''}</span>`;
  },
  replayStep(dir) {
    const it = Cycles.items, t = S.replay.t;
    let target = null;
    if (dir > 0) target = it.find(c => c.t > t + 0.01); else for (let i = it.length - 1; i >= 0; i--) if (it[i].t < t - 0.01) { target = it[i]; break; }
    if (target) S.replay.t = target.t;
    S.replay.playing = false;
  },
  replayJumpFb(dir) {
    const it = FB.log.items.filter(f => !f.confirm), t = S.replay.t;
    let target = null;
    if (dir > 0) target = it.find(f => f.t > t + 0.05); else for (let i = it.length - 1; i >= 0; i--) if (it[i].t < t - 0.05) { target = it[i]; break; }
    if (target) S.replay.t = target.t + 0.05; else this.toast('No more feedback events in that direction.', 'info');
    S.replay.playing = false;
  },

  /* ---------- scenario lab ---------- */
  renderLab() {
    const sc = S.scenario;
    $('#scenarioLab').innerHTML = `
      <div class="phead"><h2>CPR training scenario lab</h2><button class="btn sm ghost" data-action="close-lab" aria-label="Close scenario lab"><svg><use href="#i-close"/></svg></button></div>
      <div class="pbody" tabindex="0">
        <p class="hint">Each scenario changes the synthetic motion model. The rescuer, metrics, feedback, waveform and event table all follow from that one model. All scenarios are fictional training demonstrations.</p>
        <div class="scen">${SCENARIOS.map(s => `<button data-action="scenario" data-arg="${s.key}" aria-pressed="${sc === s.key}"><b>${s.name}</b><span>${s.blurb}</span></button>`).join('')}</div>
        <div class="btnrow">
          <button class="btn primary" data-action="lab-start"><svg><use href="#i-play"/></svg>Start</button>
          <button class="btn" data-action="lab-pause"><svg><use href="#i-pause"/></svg>Pause</button>
          <button class="btn" data-action="reset"><svg><use href="#i-reset"/></svg>Reset</button>
          <button class="btn" data-action="mode" data-arg="replay">Replay</button>
          <button class="btn" data-action="lab-compare">Compare</button>
        </div>
        <div class="mini" role="group" aria-label="Simulation speed" id="labSpeed" style="max-width:300px">${[0.5, 1, 2].map(v => `<button data-action="speed" data-arg="${v}" aria-pressed="${S.speed === v}">${v}×</button>`).join('')}</div>
        <div class="box" id="labDeficit"></div>
      </div>`;
    this.updateLab();
  },
  updateLab() {
    const el = $('#labDeficit'); if (!el || $('#scenarioLab').hidden) return;
    const la = lastActionable(), c = lastCycleAt(viewT());
    el.innerHTML = `<div class="sect" style="margin:0 0 6px"><span>Active deficit</span><span>${S.speed}× speed</span></div><div class="msg" style="color:${la && viewT() - la.t < 4 ? 'var(--coral-ink)' : 'var(--sage-ink)'}">${la && viewT() - la.t < 4 ? esc(la.message) : 'NO ACTIVE DEFICIT'}</div><div class="hint">${c ? `Last compression: ${c.depth.toFixed(0)} mm, ${c.rate ? c.rate.toFixed(0) + ' CPM' : 'rate n/a'}, position error ${c.pos.toFixed(0)} mm, recoil ${c.recoilLabel.toLowerCase()}.` : 'Waiting for compressions.'}</div>`;
    $$('#scenarioLab .scen button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.arg === S.scenario)));
    this.press('#labSpeed', String(S.speed));
  },

  /* ---------- research explorer ---------- */
  renderExplorer() {
    const R2 = RESEARCH, C2 = R2.conditions;
    $('#explorerBody').innerHTML = `
      <div class="phead"><h2>Explore the research</h2><button class="btn sm ghost" data-action="close-modal" aria-label="Close"><svg><use href="#i-close"/></svg></button></div>
      <div class="pbody" tabindex="0">
        <div><span class="eyebrow">Manuscript</span><h3 class="bigtitle" style="font-size:40px;margin-top:6px">Adaptive Mixed Reality Guidance for Cardiopulmonary Resuscitation: <em>A Real-Time Performance Assessment and Feedback System</em></h3>
        <p class="hint" style="margin-top:8px;max-width:80ch">Figures on this page are transcribed from the manuscript summary supplied for this demonstration and are labelled as reported. Everything else in PULSEMR is simulated in your browser.</p></div>
        <div class="ex-grid">
          <section class="ex-sec w8"><h3>Study objective</h3><p>Evaluate whether adaptive, personalised mixed-reality CPR guidance improves compression performance compared with conventional instructions in simulated training.</p>
            <div class="arch" style="margin-top:6px"><div><b>Sensing module</b><span>Hand tracking relative to a calibrated sternum frame</span></div><div><b>Performance assessment</b><span>Depth, rate, hand position, recoil, interruptions</span></div><div><b>Adaptive controller</b><span>Baseline, history, adaptation coefficient 0.3, primary deficit</span></div><div><b>Feedback generation</b><span>Visual, auditory and haptic cues at three intensities</span></div></div></section>
          <section class="ex-sec"><h3>Research setup</h3><ul><li>Participants: ${R2.participants}</li><li>Conditions: conventional audio-visual instruction and adaptive MR guidance</li><li>Ten minutes of CPR under each condition, separated by a fifteen-minute rest</li><li>Further comparison baselines: metronome-only and a commercial feedback device</li></ul></section>
          <section class="ex-sec"><h3>Hardware and software</h3><ul>${R2.hardware.map(h => `<li>${esc(h)}</li>`).join('')}</ul></section>
          <section class="ex-sec"><h3>Data</h3><p>EgoEMS multimodal dataset and supplementary experimental recordings, as described in the manuscript. No participant-level data are included in this demonstration.</p></section>
          <section class="ex-sec"><h3>Key outcomes</h3><ul><li>Depth accuracy</li><li>Rate accuracy</li><li>Hand position accuracy</li><li>Compression consistency</li><li>Interruption fraction</li><li>Guideline compliance score</li><li>Feedback latency</li></ul></section>
          <section class="ex-sec w8"><h3>Reported results</h3>
            <table class="lat"><thead><tr><th>Condition</th><th>Depth %</th><th>Rate %</th><th>Hand %</th><th>GCS</th><th>Interruption fraction</th></tr></thead><tbody>
            ${[C2.metronome, C2.av, C2.commercial, C2.mr].map(c => `<tr><td>${esc(c.name)}</td><td>${c.depth.toFixed(1)}</td><td>${c.rate.toFixed(1)}</td><td>${c.hand.toFixed(1)}</td><td>${c.gcs.toFixed(1)}</td><td style="font-family:var(--f-mono);text-align:right">${c.interruption == null ? 'not reported' : c.interruption.toFixed(2)}</td></tr>`).join('')}
            </tbody></table><p class="hint">Median feedback latency ${R2.latency.median} ms (IQR ${R2.latency.iqr[0]}–${R2.latency.iqr[1]} ms). Ablation: full system 83.5; without adaptive adjustment 73.6.</p></section>
          <section class="ex-sec"><h3>Limitations</h3><ul><li>Evaluated in simulated CPR scenarios only</li><li>Real-world emergency effectiveness was not established</li><li>Patient survival outcomes were not evaluated</li><li>No ventilation or defibrillation guidance</li><li>Tracking may degrade with occlusion and lighting</li><li>Sample of 24 participants</li></ul></section>
          <section class="ex-sec w12"><h3>How this demonstration relates</h3><p>PULSEMR re-implements the described processing steps on synthetic motion: 30 Hz samples, a 5 Hz Butterworth filter, a five-sample moving average, sternum-relative coordinates, cycle detection, a five-compression baseline, a ten-compression history and an adaptation coefficient of 0.3. It cannot measure real compressions, does not connect to a headset or manikin, and its numbers are not comparable with the study's results.</p></section>
        </div>
      </div>`;
  },
  buildHelp() {
    const keys = [['1 to 5', 'Switch mode: train, MR view, assess, compare, replay'], ['Space', 'Start or pause the simulation'], ['R', 'Recalibrate the sternum reference'], ['S', 'Open the scenario lab'], ['E', 'Explore the research'], ['A', 'Turn audio on or off'], ['T', 'Light or dark theme'], ['B', 'Biomechanics overlay on or off'], ['Arrow keys', 'Step through compressions in replay'], ['Esc', 'Close panels and clear the selection'], ['?', 'Show this list']];
    $('#helpRows').innerHTML = keys.map(([k, v]) => `<div class="rrow"><span>${v}</span><b><span class="kbd">${k}</span></b></div>`).join('');
  },

  /* ---------- MR overlays and scene labels ---------- */
  buildMR() {
    $('#mrlayer').innerHTML = `
      <div class="mrp" id="mrTarget">STERNUM TARGET<b id="mrErr">n/a</b></div>
      <div class="mrp" id="mrDepth" style="text-align:center">DEPTH<b id="mrDepthV">n/a</b><div class="mrbar"><div class="band" style="top:${50 / 70 * 100}%;height:${10 / 70 * 100}%"></div><div class="cur" id="mrDepthCur"></div></div></div>
      <div class="mrp" id="mrRate">RATE<b id="mrRateV">n/a</b><span id="mrRateS"></span></div>
      <div class="mrp" id="mrRecoil">RECOIL<b id="mrRecoilV">n/a</b></div>
      <div class="mrp msg" id="mrMsg">GOOD COMPRESSIONS</div>`;
  },
  updateMR() {
    if (S.mode !== 'mr') return;
    const st = G.sternum, W0 = window.innerWidth, H0 = window.innerHeight;
    const place = (id, p, dx = 0, dy = 0) => {
      const s = toScreen(p); const e = $(id);
      const hw = e.offsetWidth / 2 + 10, hh = e.offsetHeight / 2 + 10;
      e.style.left = clamp(s.x + dx, hw, W0 - hw) + 'px'; e.style.top = clamp(s.y + dy, 70 + hh, H0 - 70 - hh) + 'px'; e.style.display = s.behind ? 'none' : '';
    };
    place('#mrTarget', new THREE.Vector3(st.x, st.y, st.z + 0.12), 0, 30);
    place('#mrDepth', new THREE.Vector3(st.x + 0.05, st.y + 0.02, st.z - 0.26));
    place('#mrRate', new THREE.Vector3(st.x - 0.05, st.y + 0.05, st.z + 0.28), -10, 0);
    place('#mrRecoil', new THREE.Vector3(st.x + 0.26, st.y + 0.02, st.z), 0, 0);
    place('#mrMsg', new THREE.Vector3(st.x + 0.18, st.y + 0.18, st.z - 0.05));
    const err = posErrNow(), c = lastCycleAt(viewT()), r = kpiRate(), f = currentFeedback();
    $('#mrErr').textContent = `${err.toFixed(0)} mm ${err <= 20 ? 'ON TARGET' : 'ADJUST'}`;
    $('#mrTarget').classList.toggle('ok', err <= 20);
    $('#mrDepthV').textContent = c ? c.depth.toFixed(0) + ' mm' : 'n/a';
    $('#mrDepthCur').style.top = clamp(Math.max(0, V.z) / 70, 0, 1) * 100 + '%';
    $('#mrRateV').textContent = r ? r.toFixed(0) + ' CPM' : 'n/a'; $('#mrRateS').textContent = rateState(r)[0];
    $('#mrRecoilV').textContent = c ? c.recoilLabel.toUpperCase() : 'n/a';
    const pl = Detect.pauseLive;
    const m = pl ? 'COMPRESSION PAUSED ' + pl.dur.toFixed(1) + ' s' : f ? f.message : 'GOOD COMPRESSIONS';
    $('#mrMsg').textContent = m; $('#mrMsg').classList.toggle('ok', !!(!pl && (!f || f.confirm)));
  },
  updateLabels() {
    const L = $('#labels');
    let html = '';
    if (S.selected && G.selTop && S.mode !== 'mr') {
      const s = toScreen(G.selTop); const o = OBJ[S.selected];
      const r0 = o && o.rows()[0];
      if (!s.behind && o) html += `<div class="tag sel" style="left:${s.x}px;top:${s.y}px">${esc(o.title)}<small>${r0 ? esc((r0[0] + ' · ' + r0[1]).toUpperCase()) : ''}</small></div>`;
    }
    if (S.overlay.on && S.overlay.joints && S.mode !== 'mr' && S.calib.state === 'done') {
      const camD = camera.position.distanceTo(G.sternum);
      if (camD < 2.4) {
        frameToWorld(V.fx, V.fy, 0, _a); _a.y = G.sternum.y + 0.01;
        const s = toScreen(_a), err = posErrNow();
        if (!s.behind) html += `<div class="tag err" style="left:${s.x}px;top:${s.y}px;border-color:${err <= 20 ? 'var(--sage)' : 'var(--warn)'}">${err.toFixed(0)} mm ${err <= 20 ? 'within 20 mm' : 'off target'}</div>`;
      }
    }
    if (S.calib.state === 'running') {
      const s = toScreen(new THREE.Vector3(G.sternum.x, G.sternum.y + 0.25, G.sternum.z));
      if (!s.behind) html += `<div class="tag" style="left:${s.x}px;top:${s.y}px;border-color:var(--lav)">${CALIB_STEPS[S.calib.step]}</div>`;
    }
    if (L.innerHTML !== html) L.innerHTML = html;
  },

  /* ---------- notifications ---------- */
  toast(msg, kind = 'info', ms = 4200) {
    const el = document.createElement('div');
    el.className = 'toast panel'; el.dataset.k = kind;
    el.innerHTML = `<span class="tg">${kind === 'warn' ? 'TRACKING' : kind === 'ok' ? 'DONE' : 'NOTICE'}</span><span>${esc(msg)}</span>`;
    const host = $('#toasts'); host.appendChild(el);
    while (host.children.length > 2) host.firstChild.remove();
    setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 450); }, ms);
  },
  alert(text, kind) {
    this.alerts.unshift({ text, kind, t: S.t });
    if (this.alerts.length > 30) this.alerts.pop();
    this.unread++; const b = $('#alertBadge'); b.hidden = false; b.textContent = String(Math.min(99, this.unread));
  },
  renderAlerts() {
    $('#alertsMenu').innerHTML = `<h4>Alerts</h4>${this.alerts.length ? this.alerts.map(a => `<div class="mitem" style="cursor:default"><span class="st-pill" data-s="${a.kind}">${fmtClock(a.t)}</span><span>${esc(a.text)}</span></div>`).join('') : '<div class="mitem" style="cursor:default">No alerts. Level 3 cues, long pauses and tracking warnings appear here.</div>'}`;
    this.unread = 0; $('#alertBadge').hidden = true;
  },
  onFeedback(dec) {
    if (dec.confirm) return;
    this.animateFlow();
    const card = dec.metric === 'depth' ? '#kpiDepth' : dec.metric === 'rate' ? '#kpiRate' : dec.metric === 'interrupt' ? '#kpiRate' : '#kpiScore';
    const el = $(card); if (el && !S.prefs.reducedMotion) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
    if (dec.level >= 3) this.alert(`${dec.message} · ${METRIC_LABEL[dec.metric].toLowerCase()} · level 3`, 'bad');
    markDirty('feedback');
  },
  onHaptic() {},
  calibStep(k) {
    markDirty('calib');
    if (k === 3) this.toast('Calibration complete · sternum coordinate frame established', 'ok', 3000);
  },
  syncAudio() {
    $('#audioIcon').setAttribute('href', S.audio.enabled ? '#i-sound-on' : '#i-sound-off');
    $('#audioBtn').setAttribute('aria-pressed', String(S.audio.enabled));
    $('#audioEnable').setAttribute('aria-pressed', String(S.audio.enabled));
    $('#audioEnable').firstChild.textContent = S.audio.enabled ? 'Audio on' : 'Enable audio';
    $$('[data-action="audio-opt"]').forEach(b => b.setAttribute('aria-pressed', String(S.audio[b.dataset.arg])));
    this.press('#rhythmMode', S.audio.rhythm);
    $('#vibBtn').setAttribute('aria-pressed', String(S.haptics.vibrate));
    $('#vibNote').textContent = Feedback.vibrateSupported ? 'Vibrates on level 2 and 3 haptic cues' : 'Not available in this browser: HAPTIC SIGNAL SIMULATED';
  },

  /* ---------- modes ---------- */
  setMode(m) {
    if (m === S.mode) return;
    const prev = S.mode;
    if (prev === 'replay') { S.replay.playing = false; }
    if (prev === 'mr') { controls.enabled = true; }
    S.mode = m;
    if (m === 'replay') {
      if (!Samples.length) { S.mode = prev; this.toast('Nothing recorded yet.', 'info'); return; }
      const [a, b] = replayRange(); S.replay.t = Math.max(a, b - 20); S.replay.playing = false;
    }
    this.applyMode();
    if (m === 'mr') { setView('mr'); this.buildMR(); }
    else if (prev === 'mr') setView('iso');
    if (m === 'assess' || (m === 'replay' && S.area === 'research')) setArea('cpr');
    if (m === 'compare') setArea('research');
    markDirty('mode');
  },
  applyMode() {
    const app = $('#app');
    app.dataset.mode = S.mode;
    $$('#modes button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === S.mode)));
    $('#mrvisor').hidden = S.mode !== 'mr'; $('#mrlayer').hidden = S.mode !== 'mr'; $('#mrhud').hidden = S.mode !== 'mr';
    $('#assessDrawer').hidden = S.mode !== 'assess'; $('#compareDrawer').hidden = S.mode !== 'compare'; $('#replayBar').hidden = S.mode !== 'replay';
    if (S.mode === 'assess') this.renderAssess();
    if (S.mode === 'compare') this.renderCompare();
    if (S.mode === 'replay') this.renderReplay();
    if (S.mode !== 'train') $('#scenarioLab').hidden = true;
    this.syncStatus();
    setTimeout(resize, 30);
  },
  insets() {
    const w = window.innerWidth, h = window.innerHeight;
    const rect = sel => { const e = $(sel); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.width ? r : null; };
    if (S.mode === 'mr') return { l: 0, r: 0, t: 0, b: 0 };
    const top = rect('.topbar'), k = rect('#kpis');
    let t = k && S.mode !== 'assess' && S.mode !== 'compare' ? k.bottom : top ? top.bottom : 60;
    if (w <= 760) {
      const sh = S.mode === 'train' ? rect('#sheet') : rect('#replayBar') || rect('#assessDrawer') || rect('#compareDrawer');
      const b = sh ? h - sh.top : 0;
      if (S.mode === 'assess' || S.mode === 'compare') return { l: 0, r: 0, t: top ? top.bottom : 60, b: Math.max(0, h * 0.55) };
      return { l: 0, r: 0, t, b };
    }
    let l = 0, r = 0, b = 0;
    const lf = rect('#left'), rt = rect('#right'), dk = rect('#dock'), rp = rect('#replayBar'), dr = rect('#assessDrawer') || rect('#compareDrawer'), lab = rect('#scenarioLab');
    if (dr) l = dr.right; else if (lab) l = lab.right; else if (lf) l = lf.right;
    if (rt) r = w - rt.left;
    if (dk) b = h - dk.top; else if (rp) b = h - rp.top;
    return { l, r, t, b };
  },
  syncStatus() {
    const st = $('#simStatus');
    const s = S.mode === 'replay' ? 'replay' : S.calib.state === 'running' ? 'calib' : S.running ? 'ok' : 'paused';
    st.dataset.s = s;
    $('#simStatusTxt').textContent = { replay: 'REPLAY', calib: 'CALIBRATING', ok: 'SIMULATION ACTIVE', paused: 'SIMULATION PAUSED' }[s];
    $('#runIcon').setAttribute('href', S.running ? '#i-pause' : '#i-play'); $('#runTxt').textContent = S.running ? 'Pause' : 'Start';
  },
  syncAll() { this.syncControls(); this.syncStatus(); this.syncAudio(); },

  /* ---------- selection ---------- */
  select(key, glide = true) {
    S.selected = key; this.sub = null;
    if (key && glide && S.mode !== 'mr') focusObject(key);
    if (window.innerWidth <= 760 && key) this.setSheet('guide');
    this.renderRight(true);
  },
  setSheet(k) {
    $('#app').dataset.sheet = k;
    $$('.mobile-tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.arg === k)));
    $('#app').classList.remove('sheet-collapsed');
    setTimeout(resize, 30);
  },
  setTheme(th, persist = true) {
    S.theme = th;
    document.documentElement.setAttribute('data-theme', th);
    $('#themeIcon').setAttribute('href', th === 'dark' ? '#i-sun' : '#i-moon');
    $('#themeItem').setAttribute('aria-pressed', String(th === 'dark'));
    if (persist) { try { localStorage.setItem('pulsemr-theme', th); } catch (e) {} }
    readColors(); applyLighting();
    if (!$('#compareDrawer').hidden) this.renderCompare();
    this.renderTab(true);
  },

  /* ---------- search ---------- */
  index() {
    if (this._idx) return this._idx;
    const I = [];
    for (const [k, o] of Object.entries(OBJ)) I.push({ label: o.title + (k === 'handL' ? ' (lower hand)' : k === 'handR' ? ' (upper hand)' : ''), kind: 'Object', run: () => this.select(k) });
    STAGES.forEach((s, i) => I.push({ label: s.t.charAt(0) + s.t.slice(1).toLowerCase(), kind: 'Module', run: () => this.stageInfo(i) }));
    I.push({ label: 'Compression depth', kind: 'Metric', run: () => this.focusMetric('depth') }, { label: 'Compression rate', kind: 'Metric', run: () => this.focusMetric('rate') }, { label: 'Hand position error', kind: 'Metric', run: () => this.select('sternum') }, { label: 'Chest recoil', kind: 'Metric', run: () => { this.focusMetric('depth'); this.setTab('events'); } }, { label: 'Interruption duration', kind: 'Metric', run: () => this.setMode('assess') }, { label: 'Session quality score (GCS)', kind: 'Metric', run: () => this.focusMetric('score') }, { label: 'Feedback latency', kind: 'Metric', run: () => this.setMode('compare') });
    for (const m of ['PUSH DEEPER', 'REDUCE DEPTH', 'SLOWER', 'FASTER', 'ADJUST HAND POSITION', 'RELEASE FULLY', 'RESUME COMPRESSIONS']) I.push({ label: m.charAt(0) + m.slice(1).toLowerCase(), kind: 'Feedback', run: () => { this.logFilter = m; this.setTab('log'); } });
    I.push({ label: 'Reported experimental findings', kind: 'Research', run: () => this.setMode('compare') }, { label: 'Component contribution analysis (ablation)', kind: 'Research', run: () => this.setMode('compare') }, { label: 'System responsiveness', kind: 'Research', run: () => this.setMode('compare') }, { label: 'Performance trajectory', kind: 'Research', run: () => this.setMode('compare') }, { label: 'Explore the research', kind: 'Research', run: () => this.openExplorer() });
    SCENARIOS.forEach(s => I.push({ label: s.name, kind: 'Scenario', run: () => { applyScenario(s.key); this.syncControls(); } }));
    Object.entries(AREAS).forEach(([k, a]) => I.push({ label: a.name, kind: 'Area', run: () => setArea(k) }));
    return (this._idx = I);
  },
  search(q) {
    const box = $('#results');
    q = q.trim().toLowerCase();
    if (!q) { box.hidden = true; return; }
    const res = this.index().map(e => ({ e, s: e.label.toLowerCase().startsWith(q) ? 0 : e.label.toLowerCase().includes(q) ? 1 : (e.kind.toLowerCase().startsWith(q) ? 2 : 9) })).filter(x => x.s < 9).sort((a, b) => a.s - b.s).slice(0, 9);
    this.results = res.map(x => x.e); this.resIdx = 0;
    box.innerHTML = res.length ? res.map((x, i) => `<button role="option" data-i="${i}" class="${i === 0 ? 'on' : ''}"><span class="k">${x.e.kind}</span><span>${esc(x.e.label)}</span></button>`).join('') : '<div class="hint" style="padding:8px">No match. Try depth, rate, sternum or feedback.</div>';
    box.hidden = false;
  },
  runResult(i) { const r = this.results && this.results[i]; if (!r) return; $('#results').hidden = true; $('#search').value = ''; $('#search').blur(); r.run(); },
  focusMetric(m) {
    if (S.mode !== 'train') this.setMode('train');
    if (m === 'depth') { this.select('depthviz', false); setArea('cpr'); }
    else if (m === 'rate') { this.select('metronome', false); setView('side'); }
    else this.select('controller', false);
    const el = $(m === 'depth' ? '#kpiDepth' : m === 'rate' ? '#kpiRate' : '#kpiScore'); if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
    if (window.innerWidth <= 760) this.setSheet('data');
  },
  setTab(t) { this.tab = t; if (window.innerWidth <= 760) this.setSheet('data'); this.renderTab(true); },
  stageInfo(i, anchor) {
    const p = $('#stageInfo'); const s = STAGES[i];
    p.innerHTML = `<div class="phead" style="padding:4px 4px 8px"><h3>${s.n} ${s.t}</h3><button class="btn sm ghost" data-action="close-stage" aria-label="Close"><svg><use href="#i-close"/></svg></button></div><p class="hint" style="margin:0 4px 6px;font-size:12.5px;color:var(--ink)">${s.info}</p>`;
    const r = anchor ? anchor.getBoundingClientRect() : $('#tracker').getBoundingClientRect();
    p.style.left = Math.min(window.innerWidth - 336, r.right + 12) + 'px';
    p.style.top = Math.max(70, Math.min(window.innerHeight - 220, r.top - 40)) + 'px';
    if (window.innerWidth <= 760) { p.style.left = '16px'; p.style.top = '80px'; }
    p.hidden = false;
    if (i === 1) setArea('tracking'); if (i === 0) setView('top'); if (i === 5) setArea('feedback');
  },
  openExplorer() { this.renderExplorer(); $('#explorer').hidden = false; setTimeout(() => $('#explorer .btn').focus(), 30); },

  /* ---------- events ---------- */
  bind() {
    const app = $('#app');
    app.addEventListener('click', e => {
      const b = e.target.closest('[data-action]');
      if (!b) { if (!e.target.closest('.popover') && !e.target.closest('.dd')) this.closeMenus(); return; }
      this.act(b.dataset.action, b.dataset.arg, b, e);
    });
    $$('#modes button').forEach(b => b.addEventListener('click', () => this.setMode(b.dataset.mode)));
    app.addEventListener('input', e => {
      const el = e.target;
      if (el.dataset && el.dataset.param) { setParam(el.dataset.param, parseFloat(el.value)); this.syncControls(); }
    });
    const s = $('#search');
    s.addEventListener('input', () => this.search(s.value));
    s.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = (this.results || []).length; if (!n) return; this.resIdx = (this.resIdx + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; $$('#results button').forEach((x, i) => x.classList.toggle('on', i === this.resIdx)); }
      if (e.key === 'Enter') { e.preventDefault(); this.runResult(this.resIdx || 0); }
      if (e.key === 'Escape') { $('#results').hidden = true; s.blur(); }
    });
    $('#results').addEventListener('mousedown', e => { const b = e.target.closest('button[data-i]'); if (b) { e.preventDefault(); this.runResult(+b.dataset.i); } });
    s.addEventListener('blur', () => setTimeout(() => { $('#results').hidden = true; }, 150));
    // scene picking: a click without drag selects
    const cv = $('#scene'); let down = null;
    cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, b: e.button }; });
    cv.addEventListener('pointerup', e => {
      if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); const btn = down.b; down = null;
      if (moved > 5 || btn !== 0 || S.mode === 'mr') return;
      const k = pickAt(e.clientX, e.clientY);
      this.select(k);
    });
    cv.addEventListener('contextmenu', e => e.preventDefault());
    // waveform inspect hover
    const wv = $('#wave');
    wv.addEventListener('pointermove', e => { const r = wv.getBoundingClientRect(); WaveState.hover = e.clientX - r.left; });
    wv.addEventListener('pointerleave', () => { WaveState.hover = null; });
    wv.addEventListener('click', () => { if (!S.wavePaused) this.act('wave-pause'); });
    // replay timeline scrub
    const scrub = e => { const cvs = $('#rpTimeline'); if (!cvs) return; const r = cvs.getBoundingClientRect(); const [a, b] = replayRange(); S.replay.t = clamp(a + (b - a) * (e.clientX - r.left - 8) / (r.width - 16), a, b); S.replay.playing = false; };
    let scrubbing = false;
    app.addEventListener('pointerdown', e => { if (e.target.id === 'rpTimeline') { scrubbing = true; scrub(e); e.target.setPointerCapture(e.pointerId); } });
    app.addEventListener('pointermove', e => { if (scrubbing) scrub(e); });
    app.addEventListener('pointerup', () => { scrubbing = false; });
    window.addEventListener('keydown', e => this.key(e));
    window.addEventListener('resize', () => { resize(); });
    window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); applyLighting(); });
  },
  closeMenus(except) { $$('.popover').forEach(p => { if (p.id !== except && p.id !== 'stageInfo') p.hidden = true; }); $$('[aria-haspopup]').forEach(b => { if (b.dataset.arg !== except) b.setAttribute('aria-expanded', 'false'); }); },
  act(a, arg, el, ev) {
    const userTouch = () => { S.demo.active = false; };
    switch (a) {
      case 'mode': this.setMode(arg); break;
      case 'toggle-menu': { const p = $('#' + arg); const open = p.hidden; this.closeMenus(arg); p.hidden = !open; el.setAttribute('aria-expanded', String(open)); if (open && arg === 'alertsMenu') this.renderAlerts(); break; }
      case 'area': setArea(arg); $('#areaName').textContent = AREAS[arg].name; this.closeMenus(); break;
      case 'view': if (arg === 'mr') this.setMode('mr'); else setView(arg); this.closeMenus(); this.syncControls(); break;
      case 'reset-camera': if (S.mode === 'mr') this.setMode('train'); setView('iso'); $('#areaName').textContent = 'Lab overview'; this.closeMenus(); break;
      case 'run': S.running = !S.running; userTouch(); this.syncStatus(); break;
      case 'reset': resetSession(true); S.running = true; S.demo.active = false; if (S.mode === 'replay') this.setMode('train'); this.syncAll(); this.renderTab(true); this.toast('New session started · calibrating', 'info'); this.closeMenus(); break;
      case 'recalibrate': if (S.mode === 'replay') this.setMode('train'); startCalibration(); this.toast('Recalibrating the sternum reference', 'info', 2500); break;
      case 'speed': S.speed = parseFloat(arg); this.syncControls(); this.updateLab(); break;
      case 'controller': S.controller = arg; userTouch(); this.syncControls(); this.renderRight(true); this.toast(arg === 'adaptive' ? 'Adaptive feedback: personalised thresholds and modality changes' : 'Static feedback: fixed rules, no personalisation. Targets are unchanged.', 'info'); break;
      case 'learner': S.learner = !S.learner; Learner.reset(); this.syncControls(); break;
      case 'env': setEnv(arg); applyLighting(); this.syncControls(); if (arg !== 'lab') this.alert(ENV_MODES[arg].warn, 'warn'); break;
      case 'lighting': S.lighting = arg; applyLighting(); this.syncControls(); break;
      case 'lighting-toggle': S.lighting = S.lighting === 'day' ? 'dim' : 'day'; applyLighting(); this.syncControls(); break;
      case 'overlay': S.overlay.on = !S.overlay.on; this.syncControls(); break;
      case 'layer': S.overlay[arg] = !S.overlay[arg]; if (S.overlay[arg]) S.overlay.on = true; this.syncControls(); break;
      case 'reset-params': applyScenario('stable'); this.syncControls(); break;
      case 'open-lab': this.renderLab(); $('#scenarioLab').hidden = false; setTimeout(resize, 30); break;
      case 'close-lab': $('#scenarioLab').hidden = true; setTimeout(resize, 30); break;
      case 'scenario': if (S.mode === 'replay') this.setMode('train'); applyScenario(arg); S.running = true; this.syncAll(); this.updateLab(); this.toast('Scenario: ' + SCENARIOS.find(s => s.key === arg).name, 'info', 2500); break;
      case 'lab-start': S.running = true; this.syncStatus(); break;
      case 'lab-pause': S.running = false; this.syncStatus(); break;
      case 'lab-compare': $('#scenarioLab').hidden = true; this.setMode('compare'); this.runProjection(); break;
      case 'explore': this.closeMenus(); this.openExplorer(); break;
      case 'help': this.closeMenus(); $('#helpModal').hidden = false; break;
      case 'close-modal': $('#explorer').hidden = true; $('#helpModal').hidden = true; break;
      case 'theme': this.setTheme(S.theme === 'dark' ? 'light' : 'dark'); break;
      case 'pref': {
        S.prefs[arg] = !S.prefs[arg]; el.setAttribute('aria-pressed', String(S.prefs[arg]));
        if (arg === 'contrast') document.documentElement.setAttribute('data-contrast', S.prefs.contrast ? 'high' : 'normal');
        if (arg === 'reducedMotion') $('#app').dataset.motion = S.prefs.reducedMotion ? 'reduced' : 'full';
        readColors(); break;
      }
      case 'cap': S.prefs.intensityCap = +arg; this.press('#capMode', arg); this.toast('Feedback intensity capped at level ' + arg, 'info', 2200); break;
      case 'audio-enable': Feedback.enable(!S.audio.enabled); break;
      case 'audio-opt': S.audio[arg] = !S.audio[arg]; this.syncAudio(); break;
      case 'rhythm': S.audio.rhythm = arg; this.syncAudio(); break;
      case 'rhythm-cycle': S.audio.rhythm = { off: 'feedback', feedback: 'always', always: 'off' }[S.audio.rhythm]; this.syncAudio(); if (!S.audio.enabled) this.toast('Enable audio to hear the rhythm cue.', 'info'); break;
      case 'vibrate':
        if (!Feedback.vibrateSupported) { this.toast('Vibration is not available in this browser. The haptic signal stays simulated on the wrist cuffs.', 'info'); break; }
        S.haptics.vibrate = !S.haptics.vibrate; if (S.haptics.vibrate) Feedback.vibrate(2); this.syncAudio(); break;
      case 'test-haptic': FB.current = { t: S.t, metric: 'depth', dir: 'low', dev: 0.6, eff: 0.6, level: 2, modalities: ['visual', 'haptic'], message: 'HAPTIC TEST', speech: '', confirm: false, test: true }; Feedback.vibrate(2); break;
      case 'force-pause': S.forcedPause = !S.forcedPause; userTouch(); this.renderRight(true); break;
      case 'show-target': S.overlay.on = true; S.overlay.anchor = true; this.syncControls(); setView('top'); break;
      case 'show-wave': if (window.innerWidth <= 760) this.setSheet('data'); else { const d = $('#dock'); d.classList.remove('flash'); void d.offsetWidth; d.style.boxShadow = '0 0 0 3px var(--coral)'; setTimeout(() => d.style.boxShadow = '', 1400); } break;
      case 'add-noise': setParam('noise', Math.min(8, S.params.noise + 2)); this.syncControls(); this.toast('Tracking noise raised to ' + S.params.noise.toFixed(1) + ' mm', 'warn', 2400); break;
      case 'select': this.select(arg); break;
      case 'deselect': this.select(null, false); break;
      case 'sub': case 'sub-open': if (a === 'sub-open') { S.selected = 'controller'; } this.sub = arg; this.renderRight(true); break;
      case 'sub-close': this.sub = null; this.renderRight(true); break;
      case 'reset-model': Ctl.adaptive.reset(); this.toast('Adaptive model history cleared. The baseline restarts from the next five compressions.', 'info'); break;
      case 'tab': this.setTab(arg); break;
      case 'log-filter': this.logFilter = arg || ''; this.renderTab(true); break;
      case 'log-confirm': this.showConfirm = !this.showConfirm; this.renderTab(true); break;
      case 'wave-layer': this.wave[arg] = !this.wave[arg]; el.setAttribute('aria-pressed', String(this.wave[arg])); break;
      case 'wave-pause': S.wavePaused = !S.wavePaused; WaveState.frozenEnd = S.wavePaused ? viewT() : null; $('#wavePause').setAttribute('aria-pressed', String(S.wavePaused)); break;
      case 'focus-metric': this.focusMetric(arg); break;
      case 'stage': this.stageInfo(+arg, el); break;
      case 'close-stage': $('#stageInfo').hidden = true; break;
      case 'scope': this.assessScope = arg; this.press('#scopeGrp', arg); this.updateAssess(); break;
      case 'base': this.compareBase = arg; this.renderCompare(); break;
      case 'traj': this.trajMode = arg; this.press('#trajGrp', arg); this.updateCompare(); break;
      case 'ablation': S.ablation = arg; $$('#ablList button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.arg === arg))); $('#ablNote').textContent = arg === 'full' ? 'Full system active in the live demonstration.' : `Illustrative: "${RESEARCH.ablation.find(x => x.key === arg).name}" is now applied to the live demonstration. Reported GCS ${RESEARCH.ablation.find(x => x.key === arg).gcs}. The browser does not reproduce the experiment.`; this.toast(arg === 'full' ? 'Full system restored' : 'Illustrative ablation applied to the live demo', 'info', 2500); break;
      case 'run-proj': this.runProjection(); break;
      case 'rp': {
        const [ra, rb] = replayRange();
        if (arg === 'start') { S.replay.t = ra; S.replay.playing = true; }
        if (arg === 'play') { if (S.replay.t >= rb - 0.05) S.replay.t = ra; S.replay.playing = !S.replay.playing; }
        if (arg === 'back') this.replayStep(-1); if (arg === 'fwd') this.replayStep(1);
        if (arg === 'prevfb') this.replayJumpFb(-1); if (arg === 'nextfb') this.replayJumpFb(1);
        break;
      }
      case 'rp-speed': S.replay.speed = parseFloat(arg); this.press('#rpSpeed', arg); break;
      case 'exit-mr': this.setMode('train'); break;
      case 'sheet': this.setSheet(arg); break;
      case 'sheet-toggle': $('#app').classList.toggle('sheet-collapsed'); setTimeout(resize, 30); break;
    }
  },
  runProjection() {
    this.proj = runProjection(S.scenario === 'custom' ? 'stable' : S.scenario); this.projScenario = S.scenario;
    this.updateCompare(true);
  },
  key(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' && e.target.type !== 'range') return;
    if (tag === 'input' && e.target.type === 'range' && e.key.startsWith('Arrow')) return;
    const k = e.key;
    if (k === 'Escape') { this.closeMenus(); $('#stageInfo').hidden = true; if (!$('#explorer').hidden || !$('#helpModal').hidden) { $('#explorer').hidden = true; $('#helpModal').hidden = true; return; } if (!$('#scenarioLab').hidden) { $('#scenarioLab').hidden = true; setTimeout(resize, 30); return; } if (S.selected) this.select(null, false); else if (S.mode !== 'train') this.setMode('train'); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (['1', '2', '3', '4', '5'].includes(k)) { this.setMode(['train', 'mr', 'assess', 'compare', 'replay'][+k - 1]); return; }
    if (k === ' ' && tag !== 'button') { e.preventDefault(); if (S.mode === 'replay') S.replay.playing = !S.replay.playing; else this.act('run'); return; }
    if (k === 'r' || k === 'R') this.act('recalibrate');
    if (k === 's' || k === 'S') this.act('open-lab');
    if (k === 'e' || k === 'E') this.act('explore');
    if (k === 'a' || k === 'A') this.act('audio-enable');
    if (k === 't' || k === 'T') this.act('theme');
    if (k === 'b' || k === 'B') this.act('overlay');
    if (k === '?') this.act('help');
    if (S.mode === 'replay' && (k === 'ArrowLeft' || k === 'ArrowRight')) { e.preventDefault(); this.replayStep(k === 'ArrowRight' ? 1 : -1); }
  },

  /* ---------- per-frame update ---------- */
  tick(now) {
    const T = this.t;
    $('#simTime').textContent = fmtClock(viewT());
    if (!T.kpi || now - T.kpi > 100) { T.kpi = now; this.updateKpis(); }
    if (!T.wave || now - T.wave > 33) {
      T.wave = now;
      const wv = $('#wave');
      if (wv && wv.offsetParent !== null) drawWave(wv, { tEnd: S.wavePaused && WaveState.frozenEnd != null ? WaveState.frozenEnd : viewT(), window: window.innerWidth <= 760 ? 5 : 6, fb: currentFeedback(), raw: this.wave.raw, filt: this.wave.filt, inspect: S.wavePaused });
    }
    if (!T.right || now - T.right > 200) { T.right = now; this.renderRight(false); this.updateTracker(); this.updateLab(); }
    if (!T.tab || now - T.tab > 600) { T.tab = now; if (S.dirty.has('cycle') || S.dirty.has('feedback') || S.mode === 'replay') { if (this.tab !== 'results') this.renderTab(); S.dirty.delete('cycle'); S.dirty.delete('feedback'); } }
    if (!T.drawer || now - T.drawer > 400) { T.drawer = now; this.updateAssess(); this.updateCompare(); }
    if (S.mode === 'replay' && (!T.rp || now - T.rp > 60)) { T.rp = now; this.updateReplay(); }
    if (S.dirty.has('params') || S.dirty.has('scenario')) { this.syncControls(); S.dirty.delete('params'); S.dirty.delete('scenario'); }
    if (S.dirty.has('calib') || S.dirty.has('mode')) { this.syncStatus(); S.dirty.delete('calib'); S.dirty.delete('mode'); }
    if (S.dirty.has('env')) { applyLighting(); S.dirty.delete('env'); }
    this.updateLabels();
    this.updateMR();
  }
};
