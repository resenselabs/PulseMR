'use strict';
/* =====================================================================
   PULSEMR main loop: one clock drives simulation, scene and interface
   ===================================================================== */
const Perf = { frameMs: 0, fps: 0, buf: new Float32Array(120), i: 0, n: 0 };
let lastNow = 0;

function fatal(msg) {
  const d = document.createElement('div');
  d.className = 'modal'; d.style.zIndex = 99;
  d.innerHTML = `<div class="sheetmodal panel" style="width:min(520px,100%);height:auto;align-self:center;padding:24px"><h2 style="margin:0 0 8px">PULSEMR could not start</h2><p class="hint" style="font-size:13px;color:var(--ink)">${esc(msg)}</p></div>`;
  document.getElementById('app').appendChild(d);
}

function loop(now) {
  requestAnimationFrame(loop);
  const realDt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 1 / 60;
  if (lastNow) {
    Perf.buf[Perf.i] = now - lastNow; Perf.i = (Perf.i + 1) % Perf.buf.length; Perf.n = Math.min(Perf.n + 1, Perf.buf.length);
    let s = 0; for (let k = 0; k < Perf.n; k++) s += Perf.buf[k];
    Perf.frameMs = s / Perf.n; Perf.fps = 1000 / Perf.frameMs;
  }
  lastNow = now;
  try {
    simAdvance(realDt);
    if (S.mode === 'replay' && S.replay.playing) {
      const [, b] = replayRange();
      S.replay.t += realDt * S.replay.speed;
      if (S.replay.t >= b) { S.replay.t = b; S.replay.playing = false; }
    }
    Feedback.tick();
    renderFrame(now, realDt);
    UI.tick(now, realDt);
  } catch (e) {
    if (!loop.errShown) { loop.errShown = true; console.error(e); }
  }
}

function boot() {
  if (typeof THREE === 'undefined' || !THREE.OrbitControls) { fatal('The Three.js library did not load. Make sure vendor/three/three.min.js and vendor/three/OrbitControls.js are present and that you opened the app through a web server (npm start).'); return; }
  try {
    buildScene(document.getElementById('scene'));
  } catch (e) { console.error(e); fatal('WebGL is not available in this browser, so the 3D laboratory cannot be drawn.'); return; }
  readColors();
  UI.init();
  resetSession(true);
  drawStaticScreens();
  applyLighting();
  resize();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { drawStaticScreens(); drawProjection(true); readColors(); });
  requestAnimationFrame(loop);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
