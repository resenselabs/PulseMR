'use strict';
/* =====================================================================
   PULSEMR multimodal output: Web Audio cues, speech prompts, vibration.
   Audio stays muted until the user turns it on.
   ===================================================================== */
const Feedback = {
  ctx: null, master: null, nextBeat: null, lastSpeech: 0, lastRateCue: -99,
  vibrateSupported: typeof navigator !== 'undefined' && 'vibrate' in navigator,
  enable(on) {
    S.audio.enabled = on;
    if (on) {
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          this.ctx = new AC();
          this.master = this.ctx.createGain(); this.master.gain.value = 0.6; this.master.connect(this.ctx.destination);
        }
        this.ctx.resume && this.ctx.resume();
        this.nextBeat = null;
        this.chime(1);
      } catch (e) { S.audio.enabled = false; UI.toast('Audio could not start in this browser.', 'warn'); }
    } else {
      try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
    }
    UI.syncAudio();
  },
  tone(freq, start, dur, gain = 0.25, type = 'sine') {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, start); g.gain.exponentialRampToValueAtTime(gain, start + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(this.master); o.start(start); o.stop(start + dur + 0.02);
  },
  click(at) { this.tone(1650, at, 0.05, 0.22, 'triangle'); },
  chime(level) {
    if (!this.ctx || !S.audio.enabled || !S.audio.chimes) return;
    const t = this.ctx.currentTime + 0.01;
    if (level >= 3) { this.tone(880, t, 0.16, 0.2); this.tone(660, t + 0.15, 0.2, 0.2); }
    else if (level === 2) { this.tone(740, t, 0.14, 0.16); }
    else this.tone(990, t, 0.1, 0.08);
  },
  say(text) {
    if (!S.audio.enabled || !S.audio.voice || !text) return;
    const now = performance.now();
    if (now - this.lastSpeech < 2600) return;
    this.lastSpeech = now;
    try {
      const u = new SpeechSynthesisUtterance(text); u.rate = 1.05; u.pitch = 1; u.volume = 0.9;
      if (window.speechSynthesis.speaking) window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
    } catch (e) { /* speech synthesis unavailable */ }
  },
  vibrate(level) {
    if (!S.haptics.vibrate || !this.vibrateSupported) return;
    try { navigator.vibrate(level >= 3 ? [90, 60, 90, 60, 90] : level === 2 ? [80, 70, 80] : [40]); } catch (e) {}
  },
  emit(dec) {
    UI.onFeedback(dec);
    if (dec.confirm) return;
    if (dec.metric === 'rate') this.lastRateCue = S.t;
    if (S.mode === 'replay') return;
    if (dec.modalities.includes('audio')) {
      this.chime(dec.level);
      if (dec.level >= 2) this.say(dec.speech);
    }
    if (dec.modalities.includes('haptic')) this.vibrate(dec.level);
  },
  calibStep(k) { UI.calibStep(k); },
  /* rhythm cue at the target 110 per minute, locked to the simulation clock and speed */
  tick() {
    if (!this.ctx || !S.audio.enabled || !S.running || S.mode === 'replay') { this.nextBeat = null; return; }
    const mode = S.audio.rhythm;
    const want = mode === 'always' || (mode === 'feedback' && S.t - this.lastRateCue < 8);
    if (!want || S.calib.state !== 'done') { this.nextBeat = null; return; }
    const per = 60 / TARGET.rateMid;
    if (this.nextBeat == null || this.nextBeat < S.t) this.nextBeat = Math.ceil(S.t / per) * per;
    const lookahead = 0.25 * S.speed;
    while (this.nextBeat < S.t + lookahead) {
      const at = this.ctx.currentTime + (this.nextBeat - S.t) / S.speed;
      this.click(Math.max(this.ctx.currentTime, at));
      this.nextBeat += per;
    }
  }
};
