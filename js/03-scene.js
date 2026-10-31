'use strict';
/* =====================================================================
   PULSEMR scene: procedural mixed-reality CPR simulation laboratory
   Units are metres. The manikin lies along +x (head at +x); the rescuer
   kneels on the -z side (SIDE) and faces +z, towards the default camera.
   ===================================================================== */
let renderer, scene, camera, controls;
const SIDE = -1;   // rescuer kneels on the far (-z) side of the manikin, facing the default camera
const G = { pick: [], picks: {}, mats: new Map(), geos: new Map(), screens: {}, overlay: {}, dayMats: [] };

const COL = {
  floor: 0xEDE8DE, floorEdge: 0xD7D0C3, wall: 0xF1EFE9, wallCap: 0xE2DDD3, trim: 0xD9D2C6,
  platform: 0xE4DED3, mat: 0xCFD8DE, matEdge: 0xB9C4CC,
  wood: 0xC8A27C, woodD: 0xA9825F, white: 0xF8F7F4, porcelain: 0xF2F1EC, graphite: 0x2A3440, steel: 0xB9C1C7,
  coral: 0xFF6259, lav: 0xA595D8, sage: 0x8FC9AA, warn: 0xF0AB64, err: 0xE35A62, neutral: 0xA5B0B7,
  manikin: 0xE8D6C4, manikinD: 0xD9C1AB, scrubs: 0x50607C, scrubsD: 0x3F4C64, skin: 0xC99872, hair: 0x2F2A26, shoe: 0x2C333C,
  glass: 0x9FB4C4
};

function M(color, o = {}) {
  const key = color + JSON.stringify(o);
  if (G.mats.has(key)) return G.mats.get(key);
  const m = new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.72, metalness: o.metal ?? 0.02, transparent: !!o.opacity && o.opacity < 1, opacity: o.opacity ?? 1, emissive: o.emissive ?? 0x000000, emissiveIntensity: o.ei ?? 0, flatShading: !!o.flat, depthWrite: o.depthWrite ?? true, side: o.side ?? THREE.FrontSide });
  G.mats.set(key, m);
  return m;
}
function U(color, o = {}) { // unlit material for overlays
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: o.opacity ?? 1, depthWrite: false, depthTest: o.depthTest ?? true, side: o.side ?? THREE.DoubleSide, toneMapped: false });
}
function geo(key, make) { if (!G.geos.has(key)) G.geos.set(key, make()); return G.geos.get(key); }
/* rounded box: rounded in x/y, softly bevelled in z; centred at origin */
function RB(w, h, d, r = 0.02) {
  return geo(`rb${w}|${h}|${d}|${r}`, () => {
    r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3);
    const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    const bev = Math.min(r * 0.6, d * 0.25);
    const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - 2 * bev), bevelEnabled: true, bevelThickness: bev, bevelSize: bev * 0.9, bevelSegments: 2, curveSegments: 5 });
    g.translate(0, 0, -(d - 2 * bev) / 2);
    g.computeVertexNormals();
    return g;
  });
}
/* horizontal slab: w along x, d along z, h tall, corners rounded in plan */
function slab(parent, w, d, h, r, m, x, y, z, o = {}) {
  const mesh = add(parent, RB(w, d, h, r), m, x, y, z, o);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}
const BOX = (w, h, d) => geo(`box${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
const CYL = (rt, rb, h, n = 20) => geo(`cyl${rt}|${rb}|${h}|${n}`, () => new THREE.CylinderGeometry(rt, rb, h, n));
const SPH = (r, w = 16, h = 12) => geo(`sph${r}|${w}|${h}`, () => new THREE.SphereGeometry(r, w, h));
const CAP = (r, l, n = 8) => geo(`cap${r}|${l}|${n}`, () => new THREE.CapsuleGeometry(r, l, 4, n));
const TOR = (r, t, n = 40) => geo(`tor${r}|${t}|${n}`, () => new THREE.TorusGeometry(r, t, 10, n));

function add(parent, g, m, x = 0, y = 0, z = 0, o = {}) {
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  if (o.rx) mesh.rotation.x = o.rx; if (o.ry) mesh.rotation.y = o.ry; if (o.rz) mesh.rotation.z = o.rz;
  if (o.s) mesh.scale.setScalar(o.s);
  mesh.castShadow = o.cast ?? true; mesh.receiveShadow = o.receive ?? true;
  if (o.pick) { mesh.userData.pick = o.pick; G.pick.push(mesh); }
  parent.add(mesh);
  return mesh;
}
function group(parent, x = 0, y = 0, z = 0, pick) {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
  if (pick) { g.userData.pick = pick; G.picks[pick] = g; }
  return g;
}
function pickable(obj, key) { obj.traverse(o => { if (o.isMesh) { o.userData.pick = key; G.pick.push(o); } }); G.picks[key] = G.picks[key] || obj; }

/* Canvas screens drawn in code (no external images). */
function screen(key, w, h, pxW, pxH) {
  const c = document.createElement('canvas'); c.width = pxW; c.height = pxH;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4; tex.encoding = THREE.sRGBEncoding;
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const mesh = new THREE.Mesh(geo(`pl${w}|${h}`, () => new THREE.PlaneGeometry(w, h)), mat);
  G.screens[key] = { c, ctx, tex, mesh, w: pxW, h: pxH, key: '' };
  return mesh;
}

/* ---------------- build ---------------- */
function buildScene(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xF6F5F0);
  camera = new THREE.PerspectiveCamera(32, 1, 0.03, 80);
  camera.position.set(2.82, 2.68, 3.2);

  controls = new THREE.OrbitControls(camera, canvas);
  controls.target.set(0.05, 0.52, 0.0);
  controls.enableDamping = true; controls.dampingFactor = 0.09;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.screenSpacePanning = true;
  controls.minDistance = 0.35; controls.maxDistance = 12; controls.maxPolarAngle = Math.PI * 0.495;
  controls.keyPanSpeed = 14;

  // lights
  G.hemi = new THREE.HemisphereLight(0xFFFFFF, 0xD9D2C6, 0.62); scene.add(G.hemi);
  G.key = new THREE.DirectionalLight(0xFFF4E6, 1.05); G.key.position.set(3.5, 6.5, 3.0);
  G.key.castShadow = true; G.key.shadow.mapSize.set(2048, 2048);
  Object.assign(G.key.shadow.camera, { left: -5.5, right: 5.5, top: 5.5, bottom: -5.5, near: 0.5, far: 18 });
  G.key.shadow.bias = -0.0004; G.key.shadow.normalBias = 0.02; G.key.shadow.radius = 4;
  scene.add(G.key);
  G.fill = new THREE.DirectionalLight(0xDCE6FF, 0.28); G.fill.position.set(-4, 3, -2); scene.add(G.fill);
  G.spot = new THREE.SpotLight(0xFFF7EC, 0.0, 6, 0.55, 0.6, 1.4); G.spot.position.set(0.0, 2.3, 0.0); G.spot.target.position.set(0.1, 0.4, 0); scene.add(G.spot, G.spot.target);

  buildRoom();
  buildPlatform();
  buildManikin();
  buildRescuer();
  buildDevices();
  buildFurniture();
  buildOverlays();
  buildLandmarks();
  G.ready = true;
}

function buildRoom() {
  // diorama base
  slab(scene, 9.2, 7.2, 0.3, 0.3, M(COL.floorEdge), 0, -0.15, 0, { cast: false });
  // floor with a procedural tile texture
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#EDE8DE'; g.fillRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(120,108,92,0.13)'; g.lineWidth = 2;
  for (let i = 0; i <= 512; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); }
  const rng = makeRng(5);
  for (let i = 0; i < 64; i++) { g.fillStyle = `rgba(255,255,255,${0.05 + rng() * 0.08})`; g.fillRect((i % 8) * 64 + 2, Math.floor(i / 8) * 64 + 2, 60, 60); }
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(9, 7); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 8;
  G.floorMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, color: 0xFFFFFF });
  const floor = new THREE.Mesh(geo('floor', () => new THREE.PlaneGeometry(9, 7)), G.floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.002; floor.receiveShadow = true; scene.add(floor);
  // cutaway walls
  G.wallMat = M(COL.wall, { rough: 0.9 });
  add(scene, BOX(9.0, 2.7, 0.14), G.wallMat, 0, 1.35, -3.53);
  add(scene, BOX(0.14, 2.7, 7.0), G.wallMat, -4.53, 1.35, 0);
  add(scene, BOX(9.0, 0.06, 0.18), M(COL.wallCap), 0, 2.73, -3.53, { cast: false });
  add(scene, BOX(0.18, 0.06, 7.0), M(COL.wallCap), -4.53, 2.73, 0, { cast: false });
  // skirting and a soft coral accent stripe at the simulation zone
  add(scene, BOX(9.0, 0.1, 0.03), M(COL.trim), 0, 0.05, -3.45, { cast: false });
  add(scene, BOX(0.03, 0.1, 7.0), M(COL.trim), -4.45, 0.05, 0, { cast: false });
  add(scene, BOX(3.6, 0.04, 0.012), M(COL.coral, { emissive: COL.coral, ei: 0.25 }), -0.2, 1.05, -3.455, { cast: false });
  // window band on the back wall (frosted)
  const glass = M(0xDCE7EE, { rough: 0.15, opacity: 0.55, metal: 0.1 });
  add(scene, BOX(2.2, 0.9, 0.04), glass, 2.6, 1.75, -3.44, { cast: false });
  add(scene, BOX(2.3, 0.05, 0.08), M(COL.white), 2.6, 1.28, -3.42);
  G.dayMats.push([G.wallMat, COL.wall, 0x2A3342], [M(COL.floorEdge), COL.floorEdge, 0x1E2632]);
}

function buildPlatform() {
  const p = group(scene, 0, 0, 0.2 * SIDE, 'platform');
  slab(p, 2.7, 1.9, 0.2, 0.12, M(COL.platform), 0, 0.1, 0);
  slab(p, 2.3, 1.5, 0.04, 0.14, M(COL.mat, { rough: 0.95 }), 0, 0.22, 0);
  // floor guide ring around the station
  const ring = new THREE.Mesh(geo('stationRing', () => new THREE.RingGeometry(1.86, 1.9, 96)), U(COL.coral, { opacity: 0.35 }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.006, 0.2 * SIDE); scene.add(ring);
  G.stationRing = ring;
}

function buildManikin() {
  const m = group(scene, 0, 0.24, 0, null);
  G.manikin = m;
  const skin = M(COL.manikin, { rough: 0.55 }), skinD = M(COL.manikinD, { rough: 0.6 });
  // torso (abdomen and lower body part)
  slab(m, 0.7, 0.36, 0.16, 0.12, skin, -0.02, 0.08, 0);
  // chest block that compresses
  G.chest = group(m, 0.1, 0.0, 0);
  G.chestMesh = slab(G.chest, 0.36, 0.38, 0.12, 0.13, skin, 0, 0.14, 0);
  // sternum ridge and nipple line markers (anatomical landmarks used by trainers)
  add(G.chest, BOX(0.17, 0.006, 0.03), skinD, 0.03, 0.203, 0, { cast: false });
  add(G.chest, SPH(0.008), skinD, 0.1, 0.2, 0.09, { cast: false }); add(G.chest, SPH(0.008), skinD, 0.1, 0.2, -0.09, { cast: false });
  // shoulders, neck, head
  add(m, CAP(0.07, 0.22, 10), skin, 0.31, 0.1, 0, { rx: Math.PI / 2 });
  add(m, CYL(0.05, 0.055, 0.1, 14), skin, 0.4, 0.11, 0, { rz: Math.PI / 2 });
  const head = add(m, SPH(0.11, 20, 16), skin, 0.53, 0.12, 0);
  head.scale.set(1.05, 0.95, 0.9);
  add(m, BOX(0.03, 0.02, 0.05), skinD, 0.62, 0.16, 0, { cast: false }); // nose
  add(m, SPH(0.105, 18, 10), M(0x8D6E58, { rough: 0.9 }), 0.555, 0.15, 0, { s: 1 }).scale.set(0.9, 0.62, 0.95); // moulded hair cap
  // arms resting along the body
  for (const s of [-1, 1]) {
    add(m, CAP(0.045, 0.26, 8), skin, 0.12, 0.06, s * 0.23, { rz: Math.PI / 2 });
    add(m, CAP(0.04, 0.22, 8), skin, -0.17, 0.05, s * 0.24, { rz: Math.PI / 2 });
    add(m, SPH(0.045), skinD, -0.33, 0.05, s * 0.24);
  }
  // pelvis and upper legs (training torso manikin)
  slab(m, 0.24, 0.34, 0.15, 0.1, skin, -0.42, 0.075, 0);
  for (const s of [-1, 1]) add(m, CAP(0.07, 0.42, 10), skin, -0.78, 0.07, s * 0.1, { rz: Math.PI / 2 });
  pickable(m, 'manikin');
  // sternum point in world space (lower half of the sternum, chest surface at rest)
  G.sternum = new THREE.Vector3(0.12, 0.24 + 0.205, 0);
}

/* Rescuer: kneeling, arms solved with a two-bone IK each frame. */
function buildRescuer() {
  const r = group(scene, 0, 0, 0, null);
  G.rescuer = r;
  const scrubs = M(COL.scrubs, { rough: 0.8 }), scrubsD = M(COL.scrubsD, { rough: 0.85 }), skin = M(COL.skin, { rough: 0.6 });
  const P = {};
  P.torso = add(r, CAP(0.135, 0.3, 12), scrubs, 0, 0, 0);
  P.torso.scale.set(1.1, 1, 0.78);
  P.hips = add(r, CAP(0.13, 0.12, 10), scrubsD, 0, 0, 0); P.hips.scale.set(1.15, 1, 0.85); P.hips.rotation.z = Math.PI / 2;
  P.neck = add(r, CYL(0.045, 0.05, 0.08, 12), skin, 0, 0, 0);
  P.head = group(r);
  add(P.head, SPH(0.1, 20, 16), skin, 0, 0, 0).scale.set(0.92, 1.08, 1);
  add(P.head, SPH(0.102, 18, 12), M(COL.hair, { rough: 0.95 }), 0, 0.03, 0.02).scale.set(0.95, 0.9, 1.0);
  // mixed-reality headset (generic model)
  const hs = group(P.head, 0, 0.02, 0, null);
  G.headset = hs;
  add(hs, TOR(0.105, 0.016, 40), M(COL.white, { rough: 0.35 }), 0, 0.03, 0, { rx: Math.PI / 2 + 0.25 });
  const visor = add(hs, RB(0.17, 0.07, 0.06, 0.03), M(0x26303D, { rough: 0.18, metal: 0.3 }), 0, 0.0, -0.085);
  G.visorGlow = add(hs, BOX(0.15, 0.006, 0.01), M(COL.lav, { emissive: COL.lav, ei: 1.1 }), 0, -0.03, -0.116, { cast: false });
  add(hs, SPH(0.008), M(COL.coral, { emissive: COL.coral, ei: 1.4 }), 0.07, 0.025, -0.11, { cast: false });
  pickable(hs, 'headset');
  // legs (kneeling)
  P.thighL = add(r, CAP(0.07, 0.28, 10), scrubsD, 0, 0, 0); P.thighR = add(r, CAP(0.07, 0.28, 10), scrubsD, 0, 0, 0);
  P.shinL = add(r, CAP(0.06, 0.3, 10), scrubsD, 0, 0, 0); P.shinR = add(r, CAP(0.06, 0.3, 10), scrubsD, 0, 0, 0);
  P.footL = add(r, RB(0.09, 0.22, 0.07, 0.03), M(COL.shoe), 0, 0, 0); P.footR = add(r, RB(0.09, 0.22, 0.07, 0.03), M(COL.shoe), 0, 0, 0);
  // arms
  for (const s of ['L', 'R']) {
    P['upper' + s] = add(r, CAP(0.048, 0.22, 10), scrubs, 0, 0, 0);
    P['fore' + s] = add(r, CAP(0.04, 0.21, 10), skin, 0, 0, 0);
    P['cuff' + s] = add(r, TOR(0.045, 0.014, 28), M(COL.graphite, { rough: 0.4 }), 0, 0, 0);
    P['cuffGlow' + s] = add(r, TOR(0.047, 0.006, 28), M(COL.coral, { emissive: COL.coral, ei: 0.0 }), 0, 0, 0, { cast: false });
  }
  // hands: palm-down stacked hands with fingers
  for (const s of ['L', 'R']) {
    const h = group(r, 0, 0, 0, null);
    add(h, RB(0.085, 0.024, 0.095, 0.012), skin, 0, 0, 0);
    for (let f = 0; f < 4; f++) add(h, CAP(0.0095, 0.06, 6), skin, -0.03 + f * 0.02, 0.0, -0.075, { rx: Math.PI / 2 });
    add(h, CAP(0.011, 0.045, 6), skin, 0.05, 0.0, -0.02, { rx: Math.PI / 2, rz: 0.7 });
    P['hand' + s] = h;
    pickable(h, s === 'L' ? 'handL' : 'handR');
  }
  G.R = P;
  // rescuer body pick (torso, legs, head)
  for (const k of ['torso', 'hips', 'neck', 'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR', 'upperL', 'upperR', 'foreL', 'foreR']) { P[k].userData.pick = 'rescuer'; G.pick.push(P[k]); }
  P.head.children.slice(0, 2).forEach(o => { o.userData.pick = 'rescuer'; G.pick.push(o); });
  G.picks.rescuer = P.torso;
  G.picks.haptic = P.cuffL;
  for (const k of ['cuffL', 'cuffR', 'cuffGlowL', 'cuffGlowR']) { P[k].userData.pick = 'haptic'; G.pick.push(P[k]); }
}

/* Place a capsule between two points. */
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion();
function limb(mesh, a, b, baseLen) {
  _v1.subVectors(b, a); const len = _v1.length();
  mesh.position.copy(a).addScaledVector(_v1, 0.5);
  _q.setFromUnitVectors(_up, _v1.normalize()); mesh.quaternion.copy(_q);
  if (baseLen) mesh.scale.y = len / baseLen;
}

function buildDevices() {
  // compression-depth visualisation: floating gauge beside the manikin on the far side
  const dv = group(scene, 0.12, 0.62, 0.62 * -SIDE, null);
  G.depthViz = dv;
  const H = 0.42;  // 0 to 70 mm
  add(dv, RB(0.06, H + 0.06, 0.03, 0.025), M(COL.white, { opacity: 0.6, rough: 0.3 }), 0, -H / 2, 0, { cast: false });
  const band = add(dv, BOX(0.065, H * 10 / 70, 0.035), M(COL.sage, { opacity: 0.55, emissive: COL.sage, ei: 0.35 }), 0, -H * 55 / 70, 0, { cast: false });
  G.depthBand = band;
  for (let mm = 0; mm <= 70; mm += 10) add(dv, BOX(mm % 50 === 0 || mm === 60 ? 0.05 : 0.03, 0.002, 0.04), M(COL.graphite), -0.045, -H * mm / 70, 0, { cast: false });
  G.depthIndicator = add(dv, BOX(0.09, 0.008, 0.05), M(COL.coral, { emissive: COL.coral, ei: 0.7 }), 0, 0, 0, { cast: false });
  G.depthPeak = add(dv, BOX(0.075, 0.004, 0.045), M(COL.graphite), 0, 0, 0, { cast: false });
  G.depthH = H;
  pickable(dv, 'depthviz');

  // metronome (rate cue) on the platform corner
  const mt = group(scene, 1.05, 0.24, 0.38 * -SIDE, null);
  G.metronome = mt;
  const body = add(mt, CYL(0.035, 0.07, 0.2, 4), M(COL.graphite, { rough: 0.4 }), 0, 0.1, 0, { ry: Math.PI / 4 });
  add(mt, RB(0.11, 0.04, 0.11, 0.02), M(COL.white), 0, 0.02, 0);
  G.pendulum = group(mt, 0, 0.04, 0.038);
  add(G.pendulum, BOX(0.006, 0.17, 0.004), M(COL.steel, { metal: 0.6, rough: 0.3 }), 0, 0.085, 0, { cast: false });
  add(G.pendulum, BOX(0.022, 0.016, 0.008), M(COL.coral), 0, 0.12, 0, { cast: false });
  G.metroLed = add(mt, SPH(0.012), M(COL.coral, { emissive: COL.coral, ei: 0.2 }), 0, 0.215, 0, { cast: false });
  pickable(mt, 'metronome');

  // medical cart with the adaptive feedback controller hub on top
  const cart = group(scene, -1.85, 0, 0.75, null);
  add(cart, RB(0.62, 0.78, 0.46, 0.04), M(COL.white), 0, 0.46, 0);
  for (let i = 0; i < 3; i++) { add(cart, BOX(0.56, 0.005, 0.01), M(COL.trim), 0, 0.28 + i * 0.2, 0.235, { cast: false }); add(cart, BOX(0.1, 0.018, 0.02), M(COL.graphite), 0, 0.36 + i * 0.2, 0.24); }
  add(cart, RB(0.66, 0.04, 0.5, 0.02), M(COL.porcelain), 0, 0.87, 0);
  for (const [x, z] of [[-0.26, -0.18], [0.26, -0.18], [-0.26, 0.18], [0.26, 0.18]]) add(cart, CYL(0.035, 0.035, 0.04, 12), M(COL.graphite), x, 0.03, z, { rz: Math.PI / 2 });
  pickable(cart, 'cart');
  const hub = group(scene, -1.85, 0.89, 0.75, null);
  G.hub = hub;
  add(hub, CYL(0.13, 0.15, 0.07, 32), M(COL.graphite, { rough: 0.35, metal: 0.2 }), 0, 0.035, 0);
  G.hubRing = add(hub, TOR(0.12, 0.008, 48), M(COL.lav, { emissive: COL.lav, ei: 0.9 }), 0, 0.072, 0, { rx: Math.PI / 2, cast: false });
  G.hubCore = add(hub, SPH(0.05, 20, 12), M(COL.coral, { emissive: COL.coral, ei: 0.6, rough: 0.2 }), 0, 0.1, 0);
  G.hubOrbit = group(hub, 0, 0.1, 0);
  for (let i = 0; i < 3; i++) add(G.hubOrbit, SPH(0.012), M(COL.lav, { emissive: COL.lav, ei: 1 }), Math.cos(i * 2.09) * 0.09, 0, Math.sin(i * 2.09) * 0.09, { cast: false });
  pickable(hub, 'controller');

  // visual feedback projection: floating panel above the manikin
  const pr = group(scene, 0.12, 1.42, 0.42 * -SIDE, null);
  G.projection = pr;
  const frame = add(pr, RB(0.74, 0.3, 0.012, 0.04), M(COL.white, { opacity: 0.35, rough: 0.2 }), 0, 0, -0.004, { cast: false });
  const scr = screen('projection', 0.7, 0.26, 700, 260);
  scr.material.transparent = true; scr.material.depthWrite = false;
  pr.add(scr);
  G.projBeam = add(pr, CYL(0.004, 0.004, 0.5, 6), U(COL.lav, { opacity: 0.35 }), 0, -0.4, 0.15, { cast: false });
  G.projBeam.rotation.x = -0.4;
  pickable(pr, 'projection');

  // training monitor on a stand, near the platform
  const tm = group(scene, 1.75, 0, -0.55, null);
  add(tm, CYL(0.025, 0.025, 1.2, 12), M(COL.steel, { metal: 0.5, rough: 0.35 }), 0, 0.6, 0);
  add(tm, CYL(0.22, 0.24, 0.03, 24), M(COL.graphite), 0, 0.015, 0);
  const tmBody = group(tm, 0, 1.38, 0);
  tmBody.rotation.y = -0.55;
  add(tmBody, RB(0.62, 0.4, 0.04, 0.03), M(COL.graphite, { rough: 0.4 }), 0, 0, 0);
  const tms = screen('trainmon', 0.57, 0.35, 570, 350); tms.position.z = 0.022; tmBody.add(tms);
  pickable(tm, 'trainmon');

  // performance assessment workstation (back-left)
  const ws = group(scene, -2.95, 0, -2.45, null);
  G.workstation = ws;
  add(ws, RB(1.7, 0.05, 0.8, 0.02), M(COL.wood), 0, 0.76, 0);
  for (const x of [-0.78, 0.78]) add(ws, RB(0.06, 0.74, 0.7, 0.02), M(COL.white), x, 0.37, 0);
  add(ws, RB(1.5, 0.3, 0.02, 0.01), M(COL.white), 0, 0.55, -0.32);
  for (const [x, ry, key] of [[-0.38, 0.18, 'ws1'], [0.38, -0.18, 'ws2']]) {
    const mon = group(ws, x, 1.08, -0.12); mon.rotation.y = ry;
    add(mon, RB(0.72, 0.44, 0.035, 0.02), M(COL.graphite, { rough: 0.4 }), 0, 0, 0);
    const s = screen(key, 0.68, 0.4, 680, 400); s.position.z = 0.02; mon.add(s);
    add(ws, CYL(0.02, 0.02, 0.28, 10), M(COL.steel, { metal: 0.5 }), x, 0.92, -0.16);
    add(ws, RB(0.2, 0.012, 0.14, 0.01), M(COL.graphite), x, 0.79, -0.16);
  }
  add(ws, RB(0.46, 0.015, 0.15, 0.01), M(COL.porcelain), 0, 0.79, 0.16);
  add(ws, RB(0.07, 0.012, 0.1, 0.02), M(COL.porcelain), 0.36, 0.79, 0.18);
  // chair
  const ch = group(ws, 0.1, 0, 0.75); ch.rotation.y = 0.3;
  add(ch, RB(0.5, 0.08, 0.48, 0.04), M(COL.scrubsD), 0, 0.48, 0);
  add(ch, RB(0.48, 0.5, 0.06, 0.05), M(COL.scrubsD), 0, 0.78, 0.22);
  add(ch, CYL(0.025, 0.025, 0.4, 10), M(COL.steel), 0, 0.26, 0);
  for (let i = 0; i < 5; i++) add(ch, BOX(0.03, 0.02, 0.3), M(COL.graphite), Math.cos(i * 1.257) * 0.14, 0.04, Math.sin(i * 1.257) * 0.14, { ry: -i * 1.257 });
  pickable(ws, 'workstation');
}

function buildFurniture() {
  // equipment cabinets along the back wall
  const cab = group(scene, 1.15, 0, -3.18, null);
  for (let i = 0; i < 3; i++) {
    const x = i * 0.82;
    add(cab, RB(0.8, 2.0, 0.5, 0.03), M(COL.white), x, 1.0, 0);
    add(cab, BOX(0.7, 0.9, 0.02), M(0xCFDDE6, { opacity: 0.6, rough: 0.15 }), x, 1.45, 0.255, { cast: false });
    for (let s = 0; s < 3; s++) add(cab, BOX(0.68, 0.015, 0.4), M(COL.porcelain), x, 1.1 + s * 0.3, 0.02, { cast: false });
    for (let b = 0; b < 4; b++) add(cab, RB(0.12, 0.16 + (b % 2) * 0.06, 0.12, 0.02), M([COL.lav, COL.porcelain, COL.sage, COL.coral][(b + i) % 4], { rough: 0.6 }), x - 0.24 + b * 0.16, 1.2 + (b % 2) * 0.03, 0.02);
    add(cab, BOX(0.7, 0.6, 0.02), M(COL.porcelain), x, 0.38, 0.255, { cast: false });
    add(cab, BOX(0.14, 0.02, 0.02), M(COL.graphite), x, 0.62, 0.27);
  }
  pickable(cab, 'cabinets');

  // instructional display on the back wall
  const ins = group(scene, -1.1, 1.62, -3.44, null);
  add(ins, RB(1.62, 0.94, 0.04, 0.03), M(COL.graphite), 0, 0, 0);
  const isc = screen('instruct', 1.54, 0.86, 924, 516); isc.position.z = 0.022; ins.add(isc);
  pickable(ins, 'instruct');

  // wall clock on the left wall
  const clk = group(scene, -4.44, 2.0, -1.4, null); clk.rotation.y = Math.PI / 2;
  add(clk, CYL(0.2, 0.2, 0.04, 40), M(COL.white), 0, 0, 0, { rx: Math.PI / 2 });
  add(clk, TOR(0.2, 0.012, 40), M(COL.graphite), 0, 0, 0.012, {});
  const cs = screen('clock', 0.36, 0.36, 256, 256); cs.position.z = 0.024; clk.add(cs);
  pickable(clk, 'clock');

  // emergency simulation signage
  const sg = group(scene, -4.44, 1.55, 1.2, null); sg.rotation.y = Math.PI / 2;
  add(sg, RB(1.1, 0.34, 0.03, 0.03), M(COL.white), 0, 0, 0);
  const ss = screen('sign', 1.06, 0.3, 742, 210); ss.position.z = 0.017; sg.add(ss);
  pickable(sg, 'signage');

  // examination light on an articulated floor stand, reaching over the manikin
  const lamp = group(scene, -1.05, 0, -1.15, null);
  add(lamp, CYL(0.28, 0.3, 0.04, 28), M(COL.graphite), 0, 0.02, 0);
  add(lamp, CYL(0.03, 0.03, 2.2, 12), M(COL.white), 0, 1.1, 0);
  const arm = add(lamp, CYL(0.022, 0.022, 1.45, 10), M(COL.white), 0.48, 2.18, 0.48, { rz: Math.PI / 2 - 0.15 });
  arm.rotation.set(0, -Math.PI / 4, Math.PI / 2 - 0.18);
  const head = group(lamp, 1.02, 2.05, 1.02);
  add(head, CYL(0.26, 0.2, 0.1, 36), M(COL.white, { rough: 0.3 }), 0, 0, 0);
  G.lampFace = add(head, CYL(0.21, 0.21, 0.01, 36), M(0xFFF7E8, { emissive: 0xFFF2DC, ei: 0.8 }), 0, -0.052, 0, { cast: false });
  pickable(lamp, 'lights');
  // second light, smaller, over the workstation zone
  const lamp2 = group(scene, -2.95, 2.5, -1.7, null);
  add(lamp2, CYL(0.012, 0.012, 0.4, 8), M(COL.steel), 0, 0.2, 0);
  add(lamp2, CYL(0.04, 0.28, 0.16, 32), M(COL.white, { rough: 0.3 }), 0, -0.05, 0);
  G.lampFace2 = add(lamp2, CYL(0.25, 0.25, 0.01, 32), M(0xFFF7E8, { emissive: 0xFFF2DC, ei: 0.6 }), 0, -0.13, 0, { cast: false });
  pickable(lamp2, 'lights');

  // small clinical workstation (computer on wheels)
  const cow = group(scene, 2.9, 0, 1.25, null); cow.rotation.y = -0.9;
  add(cow, CYL(0.03, 0.03, 0.95, 12), M(COL.steel, { metal: 0.5 }), 0, 0.5, 0);
  add(cow, RB(0.5, 0.04, 0.42, 0.02), M(COL.white), 0, 0.98, 0);
  for (let i = 0; i < 5; i++) add(cow, BOX(0.03, 0.02, 0.3), M(COL.graphite), Math.cos(i * 1.257) * 0.13, 0.03, Math.sin(i * 1.257) * 0.13, { ry: -i * 1.257 });
  const cm = group(cow, 0, 1.28, -0.1); cm.rotation.x = -0.15;
  add(cm, RB(0.46, 0.3, 0.03, 0.02), M(COL.graphite), 0, 0, 0);
  const cws = screen('cow', 0.42, 0.26, 420, 260); cws.position.z = 0.017; cm.add(cws);
  pickable(cow, 'clinic');

  // plants for warmth
  for (const [x, z, s] of [[3.9, -2.8, 1], [-4.0, 2.9, 0.85], [3.95, 2.9, 0.75]]) {
    const p = group(scene, x, 0, z);
    add(p, CYL(0.17 * s, 0.13 * s, 0.32 * s, 16), M(COL.porcelain), 0, 0.16 * s, 0);
    for (let i = 0; i < 6; i++) add(p, SPH(0.14 * s, 7, 5), M(i % 2 ? 0x8DB89A : 0x7BAA8A, { flat: true }), Math.cos(i) * 0.08 * s, (0.42 + (i % 3) * 0.12) * s, Math.sin(i) * 0.08 * s);
  }
  // bench by the signage
  const bench = group(scene, -3.95, 0, 2.0);
  add(bench, RB(0.48, 0.06, 1.2, 0.03), M(COL.wood), 0, 0.44, 0);
  for (const z of [-0.5, 0.5]) add(bench, RB(0.42, 0.42, 0.05, 0.02), M(COL.white), 0, 0.21, z);
}

/* ---------------- overlays: sternum frame, tracking, guidance ---------------- */
function arrowMesh(color, len = 0.08, op = 0.95) {
  const g = new THREE.Group();
  const m = U(color, { opacity: op, depthTest: false });
  const shaft = new THREE.Mesh(CYL(0.0045, 0.0045, len, 8), m); shaft.position.y = len / 2; g.add(shaft);
  const tip = new THREE.Mesh(geo('arrowTip', () => new THREE.ConeGeometry(0.014, 0.03, 12)), m); tip.position.y = len + 0.015; g.add(tip);
  g.userData.mat = m; g.renderOrder = 5;
  g.traverse(o => { o.renderOrder = 5; });
  return g;
}
function buildOverlays() {
  const O = G.overlay;
  const root = group(scene, 0, 0, 0); O.root = root;
  // sternum calibration anchor
  const anc = group(root, 0, 0, 0); O.anchor = anc;
  O.targetRing = new THREE.Mesh(geo('tring', () => new THREE.RingGeometry(0.018, 0.022, 48)), U(COL.coral, { opacity: 0.95, depthTest: false }));
  O.targetRing.rotation.x = -Math.PI / 2; O.targetRing.renderOrder = 4; anc.add(O.targetRing);
  O.tolRing = new THREE.Mesh(geo('tolring', () => new THREE.RingGeometry(0.0195, 0.0205, 64)), U(COL.coral, { opacity: 0.0, depthTest: false }));
  O.tolRing.rotation.x = -Math.PI / 2; anc.add(O.tolRing);
  O.pulseRing = new THREE.Mesh(geo('pring', () => new THREE.RingGeometry(0.03, 0.033, 48)), U(COL.coral, { opacity: 0.5, depthTest: false }));
  O.pulseRing.rotation.x = -Math.PI / 2; O.pulseRing.renderOrder = 4; anc.add(O.pulseRing);
  O.marker = new THREE.Mesh(geo('smark', () => new THREE.CircleGeometry(0.055, 40)), U(COL.coral, { opacity: 0.12, depthTest: false }));
  O.marker.rotation.x = -Math.PI / 2; anc.add(O.marker);
  // axes: X (horizontal deviation, world -z), Y (along sternum, world +x), Z (depth, world -y)
  O.axX = arrowMesh(COL.lav, 0.09); O.axX.rotation.x = -Math.PI / 2; anc.add(O.axX);
  O.axY = arrowMesh(COL.lav, 0.09); O.axY.rotation.z = -Math.PI / 2; anc.add(O.axY);
  O.axZ = arrowMesh(COL.coral, 0.09); O.axZ.rotation.x = Math.PI; anc.add(O.axZ);
  // chest grid (2 cm cells, 12 cm square)
  const gridGeo = geo('cgrid', () => {
    const pts = [];
    for (let i = -3; i <= 3; i++) { pts.push(-0.06, 0, i * 0.02, 0.06, 0, i * 0.02, i * 0.02, 0, -0.06, i * 0.02, 0, 0.06); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); return g;
  });
  O.grid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: COL.lav, transparent: true, opacity: 0.55, depthTest: false }));
  O.grid.renderOrder = 3; anc.add(O.grid);
  // depth axis with the target-depth region (true scale of the exaggerated motion)
  const ax = group(root, 0, 0, 0); O.axis = ax;
  O.axisLine = new THREE.Mesh(CYL(0.0022, 0.0022, 1, 6), U(COL.lav, { opacity: 0.8, depthTest: false })); O.axisLine.renderOrder = 4; ax.add(O.axisLine);
  O.targetSlab = new THREE.Mesh(geo('tslab', () => new THREE.CylinderGeometry(0.045, 0.045, 1, 32, 1, true)), U(COL.sage, { opacity: 0.22, depthTest: false })); O.targetSlab.renderOrder = 3; ax.add(O.targetSlab);
  O.slabTop = new THREE.Mesh(geo('slabdisc', () => new THREE.RingGeometry(0.04, 0.046, 40)), U(COL.sage, { opacity: 0.7, depthTest: false })); O.slabTop.rotation.x = -Math.PI / 2; ax.add(O.slabTop);
  O.slabBot = new THREE.Mesh(geo('slabdisc', null), U(COL.sage, { opacity: 0.7, depthTest: false })); O.slabBot.rotation.x = -Math.PI / 2; ax.add(O.slabBot);
  O.dispLine = new THREE.Mesh(CYL(0.004, 0.004, 1, 8), U(COL.coral, { opacity: 0.95, depthTest: false })); O.dispLine.renderOrder = 6; ax.add(O.dispLine);
  // palm centre marker and deviation vector
  O.palm = new THREE.Mesh(SPH(0.009, 14, 10), U(COL.coral, { opacity: 1, depthTest: false })); O.palm.renderOrder = 7; root.add(O.palm);
  O.palmRing = new THREE.Mesh(geo('palmring', () => new THREE.RingGeometry(0.014, 0.017, 32)), U(COL.coral, { opacity: 0.9, depthTest: false })); O.palmRing.rotation.x = -Math.PI / 2; root.add(O.palmRing);
  O.devLine = new THREE.Mesh(CYL(0.0025, 0.0025, 1, 6), U(COL.warn, { opacity: 0.95, depthTest: false })); O.devLine.renderOrder = 6; root.add(O.devLine);
  // correction arrows (in-plane and vertical)
  O.corr = arrowMesh(COL.coral, 0.07); root.add(O.corr);
  O.corrV = arrowMesh(COL.coral, 0.08); root.add(O.corrV);
  O.corrV2 = arrowMesh(COL.coral, 0.08); root.add(O.corrV2);
  // trajectory (lavender)
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(90 * 3), 3));
  O.traj = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: COL.lav, transparent: true, opacity: 0.95, depthTest: false })); O.traj.renderOrder = 6; O.traj.frustumCulled = false; root.add(O.traj);
  // calibration sweep ring
  O.calRing = new THREE.Mesh(geo('calring', () => new THREE.RingGeometry(0.1, 0.104, 64)), U(COL.lav, { opacity: 0, depthTest: false })); O.calRing.rotation.x = -Math.PI / 2; O.calRing.renderOrder = 4; root.add(O.calRing);
  // haptic ripple rings at the wrists
  O.ripples = [0, 1, 2, 3].map(() => { const m = new THREE.Mesh(geo('ripple', () => new THREE.RingGeometry(0.05, 0.056, 32)), U(COL.coral, { opacity: 0, depthTest: false })); m.renderOrder = 5; root.add(m); return m; });
  pickable(anc, 'sternum');
  // pick proxy for the sternum (bigger than the thin rings)
  const proxy = new THREE.Mesh(geo('sproxy', () => new THREE.CylinderGeometry(0.06, 0.06, 0.01, 20)), new THREE.MeshBasicMaterial({ visible: false }));
  anc.add(proxy); proxy.userData.pick = 'sternum'; G.pick.push(proxy);
  // selection ring
  G.sel = new THREE.Mesh(geo('selring', () => new THREE.RingGeometry(0.92, 1.0, 72)), U(COL.coral, { opacity: 0.85, depthTest: false }));
  G.sel.rotation.x = -Math.PI / 2; G.sel.visible = false; G.sel.renderOrder = 8; scene.add(G.sel);
}

/* 25 tracked joints per hand: wrist, palm centre, thumb (3), index to little finger (5 each). */
const JOINT_NAMES = ['Wrist', 'Palm', 'Thumb proximal', 'Thumb distal', 'Thumb tip'];
for (const f of ['Index', 'Middle', 'Ring', 'Little']) for (const j of ['metacarpal', 'knuckle', 'middle', 'distal', 'tip']) JOINT_NAMES.push(f + ' ' + j);
const JOINT_LOCAL = (() => {
  const p = [[0, 0, 0.065], [0, 0.012, 0.005], [0.045, 0.01, 0.03], [0.062, 0.012, 0.0], [0.072, 0.012, -0.025]];
  const fx = [-0.03, -0.01, 0.01, 0.03];
  for (let f = 0; f < 4; f++) {
    const lenK = [1.0, 1.06, 1.0, 0.86][f];
    p.push([fx[f] * 0.8, 0.012, 0.03]);
    p.push([fx[f], 0.012, -0.04 * lenK]);
    p.push([fx[f], 0.012, -0.068 * lenK]);
    p.push([fx[f], 0.011, -0.09 * lenK]);
    p.push([fx[f], 0.01, -0.108 * lenK]);
  }
  return p;
})();
const JOINT_BONES = (() => {
  const b = [[0, 1], [0, 2], [2, 3], [3, 4]];
  for (let f = 0; f < 4; f++) { const s = 5 + f * 5; b.push([0, s], [s, s + 1], [s + 1, s + 2], [s + 2, s + 3], [s + 3, s + 4]); }
  b.push([6, 11], [11, 16], [16, 21]);
  return b;
})();
const KEY_JOINTS = new Set([0, 1, 4, 9, 14, 19, 24]);   // wrist, palm, fingertips (emphasised)
function buildLandmarks() {
  const n = JOINT_LOCAL.length * 2;
  G.lmMesh = new THREE.InstancedMesh(SPH(1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.95, depthTest: false, toneMapped: false }), n);
  G.lmMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  G.lmMesh.renderOrder = 9; G.lmMesh.frustumCulled = false;
  scene.add(G.lmMesh);
  const segs = JOINT_BONES.length * 2;
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs * 2 * 3), 3));
  G.lmLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: COL.lav, transparent: true, opacity: 0.9, depthTest: false }));
  G.lmLines.renderOrder = 8; G.lmLines.frustumCulled = false; scene.add(G.lmLines);
  G.lmWorld = new Float32Array(n * 3);
  G.lmObserved = new Uint8Array(n).fill(1);
}
