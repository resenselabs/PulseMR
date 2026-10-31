# Changelog

## 1.1.1 — repository release

- **Split into separate files.** The single-file app (`releases/pulsemr-v1.1.html`) is now `index.html`, `css/styles.css` and eight scripts in `js/`, loaded in order. The code is otherwise identical, and the app also opens from `file://`.
- **three.js is now bundled.** three.js r147 is in `vendor/three/` (MIT licence), so the app no longer needs a CDN.
- **Interface fix.**
  - Two `classList.toggle(name, condition)` calls received `undefined` instead of `false`.
  - That made the class flip on every frame. The mixed-reality message could show a correction such as "PUSH DEEPER" in the green "on target" colour, and the pipeline flow chips flickered.
  - The conditions are now coerced to booleans (`js/07-interface.js`).
- **Simulation unchanged.** `js/01-core.js` and `js/02-simulation.js` are the v1.1 simulation layer unchanged, so every dataset file is byte-identical to the v1.1 results. The in-app version string therefore still reads 1.1.
- **New tooling.** Added the zero-dependency server, smoke test, screenshot capture, the dataset export (`harness/export_sessions.js`), the experiment runner, and the dataset paper and its figure scripts.

## 1.1

- **Interruption detection fixed.**
  - Version 1.0 evaluated the pause condition in the same sample in which a new compression had just ended a pause. That re-opened the pause and double-counted interruptions: 409 pauses detected for 206 true pauses, and the interruption fraction roughly doubled.
  - Pause onset is now evaluated only while the detector is still in the release state. See experiment E2 and `dataset/experiments/v1.0/`.
- **Reported constants frozen.** The reported latency IQR array is now frozen like the other reported constants.

## 1.0

- First public release, `releases/pulsemr-v1.0.html`. It is kept for the E2 defect comparison.
