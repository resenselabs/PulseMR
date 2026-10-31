'use strict';
/* =====================================================================
   PULSEMR frame: drives the 3D scene from the shared simulation state
   ===================================================================== */
const V = { t: 0, x: 0, y: 0, z: 0, paused: false, calib: false, noise: { x: 0, y: 0, z: 0 }, fx: 0, fy: 0, fz: 0, conf: 0.97, occl: false };
const W = { palm: new THREE.Vector3(), wristL: new THREE.Vector3(), wristR: new THREE.Vector3(), headPos: new THREE.Vector3(), eye: new THREE.Vector3() };

/* Current view state: live generator, or recorded samples during replay. */
function readView() {
  if (S.mode === 'replay' && Samples.length) {
    const tr = S.replay.t;
    let k = Samples.find(tr); if (k < 0) k = 0;
    const i = Samples.idx(k), j = Samples.idx(Math.min(Samples.length - 1, k + 1));
    const t0 = Samples.time[i], t1 = Samples.time[j];
    const a = t1 > t0 ? clamp((tr - t0) / (t1 - t0), 0, 1) : 0;
    const L = c => lerp(Samples[c][i], Samples[c][j], a);
    Object.assign(V, { t: tr, x: L('tx'), y: L('ty'), z: L('tz'), paused: Samples.pause[i] > 0.5, calib: Samples.calib[i] > 0.5, fx: L('fx'), fy: L('fy'), fz: L('fz'), conf: Samples.conf[i], occl: Samples.occ[i] > 0.5 });
    V.noise.x = Samples.rx[i] - Samples.tx[i] - S.calib.residual.x; V.noise.y = Samples.ry[i] - Samples.ty[i] - S.calib.residual.y; V.noise.z = Samples.rz[i] - Samples.tz[i];
    V.calibK = 1;
    return V;
  }
  const g = Gen.at(S.t);
  Object.assign(V, { t: S.t, x: g.x, y: g.y, z: g.z, paused: g.paused, calib: S.calib.state !== 'done', conf: Track.conf, occl: Track.occl });
  const L = Track.last;
  if (L) { V.fx = L.fx; V.fy = L.fy; V.fz = L.fz; V.noise.x = L.rx - L.g.x - S.calib.residual.x; V.noise.y = L.ry - L.g.y - S.calib.residual.y; V.noise.z = L.rz - L.g.z; }
  V.calibK = S.calib.state === 'running' ? clamp((S.t - S.calib.t0) / 3.6, 0, 1) : 1;
  return V;
}

/* sternum frame (mm) to world (m). x: horizontal deviation (world -z), y: along sternum (world +x), z: depth (world -y, exaggerated) */
function frameToWorld(x, y, z, out) {
  const s = G.sternum;
  return out.set(s.x + y * 0.001, s.y - z * 0.001 * VIS, s.z - x * 0.001);
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _pole = new THREE.Vector3();
const _zAxis = new THREE.Vector3(0, 0, 1);
function solveArm(S0, Wp, a, b, pole, outElbow) {
  _a.subVectors(Wp, S0); let d = _a.length();
  d = Math.min(d, a + b - 1e-4); _a.normalize();
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  _b.copy(pole).addScaledVector(_a, -pole.dot(_a)).normalize();
  return outElbow.copy(S0).addScaledVector(_a, a * cosA).addScaledVector(_b, a * sinA);
}

function updateRescuer(v) {
  const R = G.R, st = G.sternum;
  // palm centre of the lower hand
  frameToWorld(v.x, v.y, Math.max(v.z, 0), W.palm);
  W.palm.y += 0.013;
  if (v.z < 0) W.palm.y += -v.z * 0.001 * VIS;          // lifted during a pause
  if (v.calibK < 1) {                                     // calibration: hands travel from the knees to the sternum
    const k = smooth(clamp(v.calibK / 0.55, 0, 1));
    _a.set(st.x, 0.66, 0.36 * SIDE);
    W.palm.lerpVectors(_a, W.palm, k);
  }
  const hL = R.handL, hR = R.handR;
  const turn = SIDE < 0 ? Math.PI : 0;
  hL.position.copy(W.palm); hL.rotation.set(0, turn, 0);
  hR.position.copy(W.palm).add(_c.set(-0.004 * SIDE, 0.024, 0.006 * SIDE)); hR.rotation.set(0, 0.42 + turn, 0);
  W.wristL.copy(hL.position).add(_c.set(0.0, 0.006, 0.07 * SIDE));
  W.wristR.copy(hR.position).add(_c.set(-0.03 * SIDE, 0.01, 0.06 * SIDE));
  // shoulders sit above the hands, arms nearly straight
  const mid = _d.addVectors(W.wristL, W.wristR).multiplyScalar(0.5);
  const sc = _e.copy(mid).add(_c.set(0, 0.5, 0.1 * SIDE));
  const hip0 = new THREE.Vector3(st.x, 0.66, 0.47 * SIDE);
  const dir = _a.subVectors(sc, hip0).normalize();
  const hip = new THREE.Vector3().copy(sc).addScaledVector(dir, -0.5);
  // torso, hips, neck, head
  limb(R.torso, hip, sc, null);
  R.hips.position.copy(hip).add(_c.set(0, -0.02, 0.03 * SIDE));
  const neckBase = sc.clone().addScaledVector(dir, 0.08);
  const headPos = sc.clone().addScaledVector(dir, 0.22).add(_c.set(0, 0.02, -0.02 * SIDE));
  limb(R.neck, neckBase, headPos.clone().addScaledVector(dir, -0.07), null);
  R.head.position.copy(headPos);
  _b.copy(headPos).multiplyScalar(2).sub(W.palm);
  R.head.lookAt(_b);
  W.headPos.copy(headPos);
  // arms
  const sL = sc.clone().add(_c.set(0.17 * SIDE, 0.01, 0)), sR = sc.clone().add(_c.set(-0.17 * SIDE, 0.01, 0));
  const eL = new THREE.Vector3(), eR = new THREE.Vector3();
  solveArm(sL, W.wristR, 0.29, 0.27, _pole.set(SIDE, 0.1, 0.6 * SIDE), eL);
  solveArm(sR, W.wristL, 0.29, 0.27, _pole.set(-SIDE, 0.1, 0.6 * SIDE), eR);
  limb(R.upperL, sL, eL, null); limb(R.foreL, eL, W.wristR, null);
  limb(R.upperR, sR, eR, null); limb(R.foreR, eR, W.wristL, null);
  for (const [cuff, glow, wr, el] of [[R.cuffL, R.cuffGlowL, W.wristR, eL], [R.cuffR, R.cuffGlowR, W.wristL, eR]]) {
    _a.subVectors(wr, el).normalize();
    cuff.position.copy(wr).addScaledVector(_a, -0.035); cuff.quaternion.setFromUnitVectors(_zAxis, _a);
    glow.position.copy(cuff.position); glow.quaternion.copy(cuff.quaternion);
  }
  // legs: knees fixed on the mat, feet behind
  for (const [s, thigh, shin, foot] of [[1, R.thighL, R.shinL, R.footL], [-1, R.thighR, R.shinR, R.footR]]) {
    const knee = new THREE.Vector3(st.x + s * 0.12, 0.31, 0.66 * SIDE);
    const hipS = hip.clone().add(_c.set(s * 0.1, -0.03, 0.02 * SIDE));
    const ankle = new THREE.Vector3(st.x + s * 0.13, 0.3, 1.02 * SIDE);
    limb(thigh, knee, hipS, null); limb(shin, knee, ankle, null);
    foot.position.copy(ankle).add(_c.set(0, 0.02, 0.06 * SIDE)); foot.rotation.set(SIDE * (-Math.PI / 2 + 0.3), 0, 0);
  }
  // eye point for the simulated headset view
  W.eye.copy(headPos).add(_c.set(0, 0.03, -0.09 * SIDE));
}

/* landmark positions in world space; noise from the latest tracked sample is drawn at true scale x1.5 */
const _m4 = new THREE.Matrix4(), _p = new THREE.Vector3(), _col = new THREE.Color();
function updateLandmarks(v) {
  const show = S.overlay.on && S.overlay.joints;
  G.lmMesh.visible = show; G.lmLines.visible = show;
  if (!show) return;
  const hands = [G.R.handL, G.R.handR];
  const nx = v.noise.x * 0.0015, ny = v.noise.y * 0.0015, nz = v.noise.z * 0.0015 * VIS;
  const simple = S.prefs.simpleLandmarks;
  const lav = new THREE.Color(COL.lav), lavKey = new THREE.Color(0x8E7CCB), est = new THREE.Color(COL.neutral), coral = new THREE.Color(COL.coral);
  let n = 0;
  hands.forEach((h, hi) => {
    h.updateMatrixWorld();
    JOINT_LOCAL.forEach((j, ji) => {
      _p.set(j[0], j[1], j[2]).applyMatrix4(h.matrixWorld);
      _p.x += ny; _p.z -= nx; _p.y -= nz;
      const idx = hi * JOINT_LOCAL.length + ji;
      G.lmWorld[idx * 3] = _p.x; G.lmWorld[idx * 3 + 1] = _p.y; G.lmWorld[idx * 3 + 2] = _p.z;
      const occluded = v.occl && hi === 1 && ji >= 10;            // ring and little fingers of the top hand hidden
      G.lmObserved[idx] = occluded ? 0 : 1;
      const key = KEY_JOINTS.has(ji);
      const visible = !simple || key;
      const r = !visible ? 0.00001 : ji === 1 ? 0.0075 : key ? 0.0055 : 0.0035;
      _m4.makeScale(r, r, r).setPosition(_p);
      G.lmMesh.setMatrixAt(idx, _m4);
      G.lmMesh.setColorAt(idx, occluded ? est : ji === 1 ? coral : key ? lavKey : lav);
      n++;
    });
  });
  G.lmMesh.instanceMatrix.needsUpdate = true; G.lmMesh.instanceColor.needsUpdate = true;
  const pos = G.lmLines.geometry.attributes.position.array;
  let q = 0;
  for (let hi = 0; hi < 2; hi++) for (const [a, b] of JOINT_BONES) {
    const ia = (hi * JOINT_LOCAL.length + a) * 3, ib = (hi * JOINT_LOCAL.length + b) * 3;
    const hide = simple && !(KEY_JOINTS.has(a) && KEY_JOINTS.has(b)) && !(a === 0);
    for (let k = 0; k < 3; k++) { pos[q + k] = G.lmWorld[ia + k]; pos[q + 3 + k] = hide ? G.lmWorld[ia + k] : G.lmWorld[ib + k]; }
    q += 6;
  }
  G.lmLines.geometry.attributes.position.needsUpdate = true;
}

function updateOverlays(v, now) {
  const O = G.overlay, st = G.sternum, on = S.overlay.on;
  const surface = st.y + 0.003;
  // anchor
  O.anchor.visible = on && S.overlay.anchor;
  O.anchor.position.set(st.x, surface, st.z);
  const fb = currentFeedback();
  const err = Math.hypot(v.fx, v.fy);
  const inTol = err <= TARGET.posTol;
  const lastC = lastCycleAt(v.t);
  const good = inTol && lastC && !lastC.cls.shallow && !lastC.cls.deep;
  const ringCol = S.calib.state !== 'done' ? COL.lav : good ? COL.sage : COL.coral;
  O.targetRing.material.color.setHex(ringCol);
  O.pulseRing.material.color.setHex(ringCol);
  const pk = (now / 1000) % 1.4 / 1.4;
  O.pulseRing.scale.setScalar(1 + pk * 1.6); O.pulseRing.material.opacity = S.prefs.reducedMotion ? 0.35 : 0.55 * (1 - pk);
  O.marker.material.color.setHex(ringCol); O.marker.material.opacity = S.lighting === 'dim' ? 0.2 : 0.12;
  O.tolRing.material.opacity = 0.65; O.tolRing.material.color.setHex(inTol ? COL.sage : COL.warn);
  const ck = S.calib.state === 'running' ? v.calibK : 1;
  O.axX.scale.setScalar(Math.max(0.01, ck)); O.axY.scale.setScalar(Math.max(0.01, ck)); O.axZ.scale.setScalar(Math.max(0.01, ck));
  O.grid.visible = on && S.overlay.anchor;
  // calibration sweep
  if (S.calib.state === 'running') {
    O.calRing.visible = true; O.calRing.position.set(st.x, surface + 0.001, st.z);
    const k = (v.calibK * 3) % 1; O.calRing.scale.setScalar(0.3 + k * 1.4); O.calRing.material.opacity = 0.9 * (1 - k);
  } else O.calRing.visible = false;
  // depth axis and target region (motion exaggerated by VIS like the avatar)
  O.axis.visible = on && S.overlay.axis;
  const mm = d => d * 0.001 * VIS;
  O.axisLine.position.set(st.x, surface - mm(35), st.z); O.axisLine.scale.y = mm(75);
  O.targetSlab.position.set(st.x, surface - mm(55), st.z); O.targetSlab.scale.y = mm(10);
  O.slabTop.position.set(st.x, surface - mm(50), st.z); O.slabBot.position.set(st.x, surface - mm(60), st.z);
  const dz = Math.max(0, v.z);
  O.dispLine.visible = dz > 0.5; O.dispLine.position.set(st.x + 0.012, surface - mm(dz) / 2, st.z + 0.012); O.dispLine.scale.y = Math.max(0.0001, mm(dz));
  const highlight = fb && fb.metric === 'depth' ? (fb.dir === 'high' ? 'top' : 'band') : '';
  O.targetSlab.material.opacity = highlight === 'band' ? 0.4 + 0.15 * Math.sin(now / 160) : 0.22;
  O.slabBot.material.color.setHex(highlight === 'top' ? COL.coral : COL.sage);
  // palm marker, deviation vector
  frameToWorld(v.fx, v.fy, 0, _a); _a.y = surface + 0.004;
  O.palm.visible = on && S.overlay.joints; O.palm.position.copy(_a);
  O.palmRing.visible = O.palm.visible; O.palmRing.position.copy(_a); O.palmRing.material.color.setHex(inTol ? COL.sage : COL.warn);
  O.devLine.visible = on && S.overlay.anchor && err > 2;
  if (O.devLine.visible) { _b.set(st.x, surface + 0.004, st.z); limb(O.devLine, _b, _a, null); O.devLine.scale.set(1, _a.distanceTo(_b), 1); O.devLine.material.color.setHex(inTol ? COL.sage : COL.warn); }
  // correction arrows mirror the feedback the system is currently giving
  const arrowsOn = on && S.overlay.arrows && fb && !fb.confirm;
  O.corr.visible = arrowsOn && fb.metric === 'position';
  if (O.corr.visible) {
    _b.set(st.x, surface + 0.03, st.z);
    _c.subVectors(_b, _a); _c.y = 0; const L = _c.length();
    if (L > 1e-4) { _c.normalize(); O.corr.position.copy(_a).add(_d.set(0, 0.03, 0)); O.corr.quaternion.setFromUnitVectors(_up, _c); O.corr.scale.setScalar(clamp(L / 0.03, 0.6, 1.3)); }
  }
  const vert = arrowsOn && (fb.metric === 'depth' || fb.metric === 'recoil');
  O.corrV.visible = vert; O.corrV2.visible = vert;
  if (vert) {
    const down = fb.metric === 'depth' && fb.dir === 'low';
    const bob = S.prefs.reducedMotion ? 0 : Math.sin(now / 180) * 0.008;
    for (const [arr, side] of [[O.corrV, 1], [O.corrV2, -1]]) {
      arr.position.set(W.palm.x + side * 0.12, W.palm.y + (down ? 0.16 : 0.06) + bob, W.palm.z);
      arr.rotation.set(down ? Math.PI : 0, 0, 0);
    }
  }
  // trajectory of the filtered palm centre (last 2 s)
  O.traj.visible = on && S.overlay.traj;
  if (O.traj.visible && Samples.length > 2) {
    const arr = O.traj.geometry.attributes.position.array;
    const end = S.mode === 'replay' ? Samples.find(S.replay.t) : Samples.length - 1;
    const count = Math.min(60, end + 1);
    for (let i = 0; i < 90; i++) {
      const k = Math.max(0, end - count + 1 + Math.min(i, count - 1)), ii = Samples.idx(k);
      frameToWorld(Samples.fx[ii], Samples.fy[ii], Math.max(-30, Samples.fz[ii]), _b);
      _b.y += 0.016; _b.z += 0.0;
      arr[i * 3] = _b.x; arr[i * 3 + 1] = _b.y; arr[i * 3 + 2] = _b.z;
    }
    O.traj.geometry.attributes.position.needsUpdate = true;
    O.traj.geometry.setDrawRange(0, count);
  }
  // haptic ripples at both wrists while a haptic cue is active
  const hapticOn = fb && fb.modalities.includes('haptic') && (v.t - fb.t) < 1.6;
  const amp = hapticOn ? fb.level / 3 : 0;
  G.R.cuffGlowL.material.emissiveIntensity = amp ? 0.6 + 1.2 * amp * (0.5 + 0.5 * Math.sin(now / 45)) : 0.05;
  O.ripples.forEach((rg, i) => {
    const w = i < 2 ? W.wristR : W.wristL;
    const ph = ((now / 520) + (i % 2) * 0.5) % 1;
    rg.visible = !!amp && !S.prefs.reducedMotion; rg.position.copy(w);
    rg.quaternion.copy(G.R.cuffL.quaternion); rg.scale.setScalar(0.8 + ph * 1.2); rg.material.opacity = amp * 0.8 * (1 - ph);
  });
}

/* feedback visible at view time (live or replay), within 2.5 s of delivery */
function currentFeedback() {
  if (S.mode === 'replay') {
    const items = FB.log.items; let best = null;
    for (let i = items.length - 1; i >= 0; i--) { if (items[i].t <= S.replay.t) { best = items[i]; break; } }
    return best && S.replay.t - best.t < 2.5 ? best : null;
  }
  const f = FB.current;
  return f && S.t - f.t < 2.5 ? f : null;
}
function lastCycleAt(t) {
  const it = Cycles.items;
  if (!it.length) return null;
  if (S.mode !== 'replay') return it[it.length - 1];
  for (let i = it.length - 1; i >= 0; i--) if (it[i].t <= t) return it[i];
  return null;
}

function updateDevices(v, now) {
  // manikin chest moves with the compression
  const dz = Math.max(0, v.z) * 0.001 * VIS;
  G.chest.position.y = -dz * 0.92;
  G.chestMesh.scale.y = 1;
  // depth gauge
  const H = G.depthH;
  G.depthIndicator.position.y = -H * clamp(Math.max(0, v.z) / 70, 0, 1);
  const lc = lastCycleAt(v.t);
  G.depthPeak.visible = !!lc; if (lc) G.depthPeak.position.y = -H * clamp(lc.depth / 70, 0, 1);
  G.depthBand.material.color.setHex(lc && (lc.cls.shallow || lc.cls.deep) ? COL.warn : COL.sage);
  G.depthViz.quaternion.copy(camera.quaternion); G.depthViz.rotation.x = 0; G.depthViz.rotation.z = 0;
  // metronome at the target rhythm (110 per minute)
  const beat = (v.t * TARGET.rateMid / 60);
  G.pendulum.rotation.z = 0.42 * Math.sin(Math.PI * beat);
  const ph = beat % 1;
  G.metroLed.material.emissiveIntensity = ph < 0.18 ? 1.6 : 0.15;
  // controller hub
  G.hubOrbit.rotation.y = S.prefs.reducedMotion ? 0 : now / 900;
  const sinceDecision = (performance.now() - Pipeline.last[4]) / 1000;
  G.hubCore.material.emissiveIntensity = 0.4 + 1.2 * Math.max(0, 1 - sinceDecision * 2.5);
  // projection panel faces the camera around the vertical axis
  _a.subVectors(camera.position, G.projection.position); G.projection.rotation.y = Math.atan2(_a.x, _a.z);
  G.projBeam.visible = S.mode !== 'mr';
}

/* ---------------- canvas screens ---------------- */
function fillRound(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
const FONT = { ui: '"Geist", "Segoe UI", system-ui, sans-serif', mono: '"Geist Mono", ui-monospace, "SFMono-Regular", Menlo, monospace', serif: '"Instrument Serif", Georgia, serif' };
function drawProjection(force) {
  const sc = G.screens.projection; if (!sc) return;
  const fb = currentFeedback();
  const calib = S.calib.state === 'running';
  const paused = S.mode !== 'replay' && Detect.pauseLive;
  const key = calib ? 'c' + S.calib.step : paused ? 'p' + Math.floor(Detect.pauseLive.dur * 2) : fb ? fb.t + fb.message : 'idle';
  if (!force && key === sc.key) return; sc.key = key;
  const g = sc.ctx, w = sc.w, h = sc.h;
  g.clearRect(0, 0, w, h);
  let accent = '#A595D8', title = 'MONITORING', sub = 'Adaptive guidance active', lvl = 0, mods = '';
  if (calib) { title = CALIB_STEPS[S.calib.step]; sub = 'Sternum-relative reference frame'; }
  else if (paused) { accent = '#E35A62'; title = 'COMPRESSION PAUSED'; sub = 'Paused ' + Detect.pauseLive.dur.toFixed(1) + ' s · resume compressions'; lvl = Detect.pauseLive.dur > 3.5 ? 3 : 2; }
  else if (fb) {
    lvl = fb.level; title = fb.message;
    accent = fb.confirm ? '#8FC9AA' : lvl >= 3 ? '#E35A62' : lvl === 2 ? '#FF6259' : '#F0AB64';
    sub = (fb.confirm ? 'Minimal visual confirmation' : METRIC_LABEL[fb.metric] + ' · ' + DEV_WORD[Math.min(3, levelOf(fb.dev) || 1)].toLowerCase() + ' deviation');
    mods = fb.modalities.map(m => m.toUpperCase()).join(' + ');
  }
  g.fillStyle = 'rgba(255,255,255,0.86)'; fillRound(g, 6, 6, w - 12, h - 12, 34); g.fill();
  g.lineWidth = 6; g.strokeStyle = accent; fillRound(g, 6, 6, w - 12, h - 12, 34); g.stroke();
  g.fillStyle = accent; g.fillRect(40, 44, 10, h - 88);
  g.fillStyle = '#202B35'; g.font = `600 ${title.length > 22 ? 46 : 58}px ${FONT.ui}`; g.textBaseline = 'middle';
  g.fillText(title, 76, 100);
  g.fillStyle = '#5F6B74'; g.font = `500 26px ${FONT.mono}`; g.fillText(sub.toUpperCase(), 78, 168);
  if (lvl) { g.fillStyle = accent; fillRound(g, w - 196, 30, 160, 52, 26); g.fill(); g.fillStyle = '#19212C'; g.font = `600 26px ${FONT.mono}`; g.fillText('LEVEL ' + lvl, w - 172, 57); }
  if (mods) { g.fillStyle = '#6B58A8'; g.font = `600 22px ${FONT.mono}`; g.fillText(mods, 78, 214); }
  sc.tex.needsUpdate = true;
}
function drawMonitors(now) {
  const lc = Cycles.last();
  const rs = rollingScores(S.mode === 'replay' ? S.replay.t : S.t);
  // training monitor
  let sc = G.screens.trainmon;
  if (sc) {
    const g = sc.ctx, w = sc.w, h = sc.h;
    g.fillStyle = '#19212C'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#A595D8'; g.font = `600 18px ${FONT.mono}`; g.fillText('CPR TRAINING MONITOR · SIMULATED', 22, 34);
    const rows = [['DEPTH', lc ? lc.depth.toFixed(0) + ' mm' : 'n/a', lc && !lc.cls.shallow && !lc.cls.deep], ['RATE', kpiRate() ? kpiRate().toFixed(0) + ' CPM' : 'n/a', kpiRate() && kpiRate() >= 100 && kpiRate() <= 120], ['GCS', rs ? rs.gcs.toFixed(0) + ' / 100' : 'n/a', rs && rs.gcs >= 80]];
    rows.forEach(([k, val, ok], i) => {
      g.fillStyle = '#A9B4BB'; g.font = `500 20px ${FONT.mono}`; g.fillText(k, 22, 96 + i * 82);
      g.fillStyle = ok ? '#8FC9AA' : '#FF8C84'; g.font = `600 52px ${FONT.ui}`; g.fillText(val, 170, 108 + i * 82);
    });
    sc.tex.needsUpdate = true;
  }
  // workstation: waveform and compliance
  sc = G.screens.ws1;
  if (sc) {
    const g = sc.ctx, w = sc.w, h = sc.h;
    g.fillStyle = '#F6F5F0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#202B35'; g.font = `600 22px ${FONT.mono}`; g.fillText('PERFORMANCE ASSESSMENT · LIVE SIMULATION', 20, 34);
    const n = Math.min(Samples.length, 150), y0 = 70, hh = 200;
    g.fillStyle = 'rgba(143,201,170,0.3)'; g.fillRect(20, y0 + hh * 50 / 70, w - 40, hh * 10 / 70);
    g.strokeStyle = '#FF6259'; g.lineWidth = 3; g.beginPath();
    const end = S.mode === 'replay' ? Samples.find(S.replay.t) : Samples.length - 1;
    for (let i = 0; i < n; i++) { const k = Samples.idx(Math.max(0, end - n + 1 + i)); const x = 20 + (w - 40) * i / Math.max(1, n - 1), y = y0 + hh * clamp(Samples.fz[k], -10, 70) / 70; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    g.fillStyle = '#5F6B74'; g.font = `500 18px ${FONT.mono}`; g.fillText('DEPTH 0 TO 70 MM · TARGET BAND 50 TO 60 MM', 20, y0 + hh + 34);
    g.fillStyle = '#202B35'; g.font = `600 40px ${FONT.ui}`; g.fillText(rs ? 'GCS ' + rs.gcs.toFixed(0) : 'GCS n/a', 20, h - 30);
    g.fillStyle = '#6B58A8'; g.font = `500 20px ${FONT.mono}`; g.fillText('COMPUTED FROM SIMULATED EVENTS', 210, h - 36);
    sc.tex.needsUpdate = true;
  }
  sc = G.screens.ws2;
  if (sc && !sc.key) {
    sc.key = 'static';
    const g = sc.ctx, w = sc.w, h = sc.h;
    g.fillStyle = '#F6F5F0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#202B35'; g.font = `600 22px ${FONT.mono}`; g.fillText('REPORTED IN MANUSCRIPT · GCS / 100', 20, 34);
    const C = RESEARCH.conditions, list = [C.metronome, C.av, C.commercial, C.mr];
    list.forEach((c, i) => {
      const y = 70 + i * 74, bw = (w - 260) * c.gcs / 100;
      g.fillStyle = '#5F6B74'; g.font = `500 18px ${FONT.mono}`; g.fillText(c.short.toUpperCase(), 20, y + 26);
      g.fillStyle = c.key === 'mr' ? '#FF6259' : '#A595D8'; fillRound(g, 200, y + 6, bw, 34, 8); g.fill();
      g.fillStyle = '#202B35'; g.font = `600 22px ${FONT.ui}`; g.fillText(c.gcs.toFixed(1), 210 + bw, y + 31);
    });
    g.fillStyle = '#5F6B74'; g.font = `500 16px ${FONT.mono}`; g.fillText('FIXED VALUES · NOT FROM THIS SIMULATION', 20, h - 20);
    sc.tex.needsUpdate = true;
  }
  // computer on wheels: recent cycles
  sc = G.screens.cow;
  if (sc) {
    const g = sc.ctx, w = sc.w, h = sc.h;
    g.fillStyle = '#19212C'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#A595D8'; g.font = `600 16px ${FONT.mono}`; g.fillText('COMPRESSION EVENTS', 16, 26);
    Cycles.last(6) && [].concat(Cycles.last(6)).filter(Boolean).reverse().forEach((c, i) => {
      g.fillStyle = c.status === 'Target' ? '#8FC9AA' : '#FF8C84'; g.font = `500 17px ${FONT.mono}`;
      g.fillText(`${String(c.n).padStart(3, '0')}  ${c.depth.toFixed(0)} mm  ${c.rate ? c.rate.toFixed(0) : '---'}  ${c.status}`, 16, 58 + i * 32);
    });
    sc.tex.needsUpdate = true;
  }
}
function drawStaticScreens() {
  let sc = G.screens.instruct;
  if (sc) {
    const g = sc.ctx, w = sc.w, h = sc.h;
    g.fillStyle = '#F6F5F0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#FF6259'; g.fillRect(0, 0, 14, h);
    g.fillStyle = '#202B35'; g.font = `400 64px ${FONT.serif}`; g.fillText('Chest compressions', 46, 86);
    g.font = `500 22px ${FONT.mono}`; g.fillStyle = '#5F6B74'; g.fillText('TRAINING REFERENCE · RESEARCH GUIDELINE RANGES', 48, 126);
    const steps = ['Heel of hand on the lower half of the sternum', 'Compress 50 to 60 mm', '100 to 120 compressions per minute', 'Let the chest recoil fully', 'Keep pauses short'];
    steps.forEach((s, i) => { g.fillStyle = '#FF6259'; g.font = `600 30px ${FONT.mono}`; g.fillText('0' + (i + 1), 50, 196 + i * 62); g.fillStyle = '#202B35'; g.font = `500 34px ${FONT.ui}`; g.fillText(s, 120, 196 + i * 62); });
    sc.tex.needsUpdate = true;
  }
  sc = G.screens.sign;
  if (sc) {
    const g = sc.ctx, w = sc.w, h = sc.h;
    g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#FF6259'; fillRound(g, 18, 18, 120, h - 36, 20); g.fill();
    g.fillStyle = '#19212C'; g.font = `700 88px ${FONT.ui}`; g.fillText('+', 52, 136);
    g.fillStyle = '#202B35'; g.font = `700 46px ${FONT.ui}`; g.fillText('SIMULATION IN PROGRESS', 166, 88);
    g.fillStyle = '#5F6B74'; g.font = `500 28px ${FONT.mono}`; g.fillText('TRAINING ONLY · NO PATIENT CARE', 168, 146);
    sc.tex.needsUpdate = true;
  }
}
function drawClock() {
  const sc = G.screens.clock; if (!sc) return;
  const d = new Date(), key = d.getHours() + ':' + d.getMinutes() + ':' + d.getSeconds();
  if (key === sc.key) return; sc.key = key;
  const g = sc.ctx, w = sc.w, c = w / 2;
  g.clearRect(0, 0, w, w); g.fillStyle = '#FFFFFF'; g.beginPath(); g.arc(c, c, c - 4, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#202B35';
  for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.lineWidth = i % 3 ? 3 : 6; g.beginPath(); g.moveTo(c + Math.sin(a) * (c - 18), c - Math.cos(a) * (c - 18)); g.lineTo(c + Math.sin(a) * (c - 34), c - Math.cos(a) * (c - 34)); g.stroke(); }
  const hand = (a, l, wd, col) => { g.strokeStyle = col; g.lineWidth = wd; g.lineCap = 'round'; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.sin(a) * l, c - Math.cos(a) * l); g.stroke(); };
  const s = d.getSeconds(), m = d.getMinutes() + s / 60, hr = (d.getHours() % 12) + m / 60;
  hand(hr * Math.PI / 6, c * 0.5, 9, '#202B35'); hand(m * Math.PI / 30, c * 0.72, 6, '#202B35'); hand(s * Math.PI / 30, c * 0.8, 3, '#FF6259');
  sc.tex.needsUpdate = true;
}

/* ---------------- lighting ---------------- */
const BG = { day: new THREE.Color(0xF6F5F0), dim: new THREE.Color(0x19212C), dark: new THREE.Color(0x141B24) };
function applyLighting() {
  const dim = S.lighting === 'dim' ? 1 : S.env === 'low' ? 0.55 : 0;
  G.dim = dim;
  G.hemi.intensity = lerp(0.62, 0.12, dim); G.key.intensity = lerp(1.05, 0.22, dim); G.fill.intensity = lerp(0.28, 0.12, dim);
  G.spot.intensity = lerp(0.0, 1.6, dim);
  const dark = S.theme === 'dark' ? 1 : 0;
  const bg = dark && dim === 0 ? BG.dark : BG.day;
  scene.background.copy(bg).lerp(BG.dim, dim);
  const room = Math.max(dim, dark * 0.85);
  G.floorMat.color.setHex(0xFFFFFF).lerp(new THREE.Color(0x4A5361), room * 0.85);
  for (const [m, d, n] of G.dayMats) m.color.setHex(d).lerp(new THREE.Color(n), room * 0.8);
  G.lampFace.material.emissiveIntensity = lerp(0.8, 1.6, dim);
  G.visorGlow.material.emissiveIntensity = lerp(1.1, 2.2, dim);
  G.hubRing.material.emissiveIntensity = lerp(0.9, 2.0, dim);
  G.stationRing.material.opacity = lerp(0.35, 0.8, dim);
  renderer.toneMappingExposure = lerp(1.05, 1.25, dim);
}

/* ---------------- camera: presets, glide, view offset, MR view ---------------- */
const CAM_PRESETS = {
  iso: { pos: [2.82, 2.68, 3.2], tgt: [0.05, 0.52, 0.0], fov: 32, label: 'Isometric lab' },
  side: { pos: [2.55, 0.82, 0.26], tgt: [0.08, 0.62, 0.26], fov: 34, label: 'Side view' },
  top: { pos: [0.12, 2.15, 0.07], tgt: [0.12, 0.44, 0.0], fov: 30, label: 'Top view' },
  hands: { pos: [0.62, 0.98, 0.82], tgt: [0.1, 0.48, 0.02], fov: 34, label: 'Hand close-up' },
  mr: { pos: null, tgt: null, fov: 66, label: 'MR first person' }
};
const AREAS = {
  overview: { name: 'Lab overview', view: 'iso' },
  cpr: { name: 'CPR performance', pos: [1.05, 1.15, 1.35], tgt: [0.08, 0.52, 0.02], fov: 34 },
  tracking: { name: 'Hand-tracking space', pos: [0.48, 0.92, 0.6], tgt: [0.11, 0.47, 0.0], fov: 34 },
  feedback: { name: 'Feedback system', pos: [1.95, 1.75, 2.15], tgt: [0.2, 0.95, -0.2], fov: 34 },
  research: { name: 'Research workstation', pos: [-1.25, 1.75, -0.55], tgt: [-2.95, 0.98, -2.5], fov: 38 }
};
const Cam = { tw: null, mrBlend: 0 };
function glideTo(pos, tgt, fov = 32, dur = 1.25) {
  if (S.prefs.reducedMotion) dur = 0.01;
  Cam.tw = { p0: camera.position.clone(), t0: controls.target.clone(), f0: camera.fov, p1: new THREE.Vector3(...pos), t1: new THREE.Vector3(...tgt), f1: fov, start: performance.now(), dur: dur * 1000 };
}
function setView(key) {
  S.view = key;
  if (key === 'mr') { enterMR(); return; }
  if (S.mode === 'mr') { S.mode = 'train'; UI.applyMode(); }
  const p = CAM_PRESETS[key]; glideTo(p.pos, p.tgt, p.fov);
  markDirty('view');
}
function setArea(key) {
  S.area = key; const a = AREAS[key];
  if (S.mode === 'mr') { S.mode = 'train'; UI.applyMode(); }
  if (a.view) setView(a.view); else glideTo(a.pos, a.tgt, a.fov);
  markDirty('area');
}
function enterMR() { Cam.mrBlend = 0; Cam.mrStart = performance.now(); Cam.mrFov0 = camera.fov; Cam.mrPos0 = camera.position.clone(); Cam.tw = null; controls.enabled = false; }
function updateCamera(now) {
  if (S.mode === 'mr') {
    const k = S.prefs.reducedMotion ? 1 : smooth(clamp((now - (Cam.mrStart || 0)) / 1100, 0, 1));
    const eye = W.eye, look = _a.copy(G.sternum).add(_b.set(-0.02, 0.0, 0.0));
    camera.position.lerpVectors(Cam.mrPos0 || camera.position, eye, k);
    controls.target.lerp(look, Math.max(k, 0.2));
    camera.fov = lerp(Cam.mrFov0 || camera.fov, CAM_PRESETS.mr.fov, k);
    camera.near = 0.02;
    camera.lookAt(controls.target);
    camera.updateProjectionMatrix();
    G.R.head.visible = false;
    return;
  }
  G.R.head.visible = true; camera.near = 0.03;
  if (!controls.enabled) controls.enabled = true;
  if (Cam.tw) {
    const k = smooth(clamp((now - Cam.tw.start) / Cam.tw.dur, 0, 1));
    camera.position.lerpVectors(Cam.tw.p0, Cam.tw.p1, k);
    controls.target.lerpVectors(Cam.tw.t0, Cam.tw.t1, k);
    camera.fov = lerp(Cam.tw.f0, Cam.tw.f1, k); camera.updateProjectionMatrix();
    if (k >= 1) Cam.tw = null;
  }
  controls.update();
}
function focusObject(key) {
  const obj = G.picks[key]; if (!obj) return;
  const box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
  const dir = Cam.tw ? _a.subVectors(Cam.tw.p1, Cam.tw.t1).normalize() : _a.subVectors(camera.position, controls.target).normalize();
  if (dir.y > 0.8) { dir.lerp(_b.set(0.55, 0.5, 0.67), 0.6).normalize(); }
  const dist = clamp(size * 2.2, 0.8, 4.5);
  glideTo([c.x + dir.x * dist, Math.max(c.y + dir.y * dist, c.y + 0.25), c.z + dir.z * dist], [c.x, c.y, c.z], 34, 1.1);
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const ins = UI.insets();
  const dx = (ins.l - ins.r) / 2, dy = (ins.t - ins.b) / 2;
  camera.setViewOffset(w, h, -dx, -dy, w, h);
  camera.updateProjectionMatrix();
}

/* ---------------- selection ---------------- */
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
function pickAt(clientX, clientY) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(G.pick, false);
  for (const h of hits) { if (h.object.visible !== false && h.object.userData.pick) return h.object.userData.pick; }
  return null;
}
function updateSelection(now) {
  const key = S.selected;
  if (!key || !G.picks[key] || S.mode === 'mr') { G.sel.visible = false; return; }
  const box = new THREE.Box3().setFromObject(G.picks[key]);
  const c = box.getCenter(_a), s = box.getSize(_b);
  const r = clamp(Math.max(s.x, s.z) * 0.65, 0.07, 1.4);
  G.sel.visible = true;
  G.sel.position.set(c.x, Math.max(0.01, box.min.y + 0.005), c.z);
  const pulse = S.prefs.reducedMotion ? 1 : 1 + 0.04 * Math.sin(now / 260);
  G.sel.scale.setScalar(r * pulse);
  G.selTop = new THREE.Vector3(c.x, box.max.y + 0.06, c.z);
}

/* project a world point to screen pixels */
function toScreen(v) {
  _c.copy(v).project(camera);
  const w = window.innerWidth, h = window.innerHeight;
  return { x: (_c.x * 0.5 + 0.5) * w, y: (-_c.y * 0.5 + 0.5) * h, behind: _c.z > 1 };
}

let monitorClock = 0;
function renderFrame(now, realDt) {
  const v = readView();
  updateRescuer(v);
  updateLandmarks(v);
  updateOverlays(v, now);
  updateDevices(v, now);
  updateCamera(now);
  updateSelection(now);
  drawProjection(false);
  monitorClock += realDt;
  if (monitorClock > 0.25) { monitorClock = 0; drawMonitors(now); drawClock(); }
  renderer.render(scene, camera);
}
