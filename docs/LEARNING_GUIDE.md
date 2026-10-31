# Learning guide

This guide takes you from "what is good CPR?" to writing your own feedback controller and measuring it. Each step takes about 20 to 40 minutes. You need a browser for steps 1 and 2. For steps 3 to 6 you also need a text editor and, optionally, Python with pandas.

> PULSEMR is a teaching and research demonstration with simulated data. It does not teach CPR itself; for that, take a certified course.

---

## Step 1 · Explore the app (no code)

Start the app (`npm start`, then open <http://localhost:8080>) and let the first-load demonstration run for 30 seconds.

1. Press **S** to open the scenario lab. Run each scenario for about 20 seconds. **Before** each cue appears, predict which message the app will show.
2. Switch between **Adaptive feedback** and **Static feedback** in the training controls (left panel). Watch the feedback log: how often does each controller speak?
3. Press **2** for the MR view, then **3** for the assessment, then **5** for replay. Scrub back to the moment the first cue appeared.
4. In the training controls, change the **Tracking condition** to *Partial occlusion*. What happens to the compression table? (Look for "Low confidence".)

**Check yourself.**
- *Shallow* gives "PUSH DEEPER".
- *Fast* gives "SLOWER".
- *Hand drift* gives "ADJUST HAND POSITION", but only about 14 s into the session, because the hands start on target.
- *Incomplete recoil* gives "RELEASE FULLY".

## Step 2 · CPR quality in five numbers

Adult CPR guidelines (AHA 2020, ERC 2021) describe high-quality compressions with five measurable targets. PULSEMR uses exactly these targets (`TARGET` in `js/01-core.js`):

| Metric | Target | Why it matters | How PULSEMR measures it |
|---|---|---|---|
| Depth | 50–60 mm | Too shallow moves too little blood. Too deep risks injury. | Peak of the filtered vertical palm position |
| Rate | 100–120 per minute | Too slow lowers flow. Too fast leaves no time to refill. | 60 ÷ time between consecutive peaks |
| Recoil | Full release | Leaning on the chest stops the heart from refilling. | Lowest depth between compressions (≤ 3 mm = full) |
| Hand position | Lower half of the sternum | Off-centre pressure is less effective and riskier. | Distance of the mean palm position from the target (≤ 20 mm) |
| Interruptions | As few as possible | Blood pressure falls quickly every time compressions stop. | Gaps longer than 1.2 s without a compression |

The **guideline compliance score (GCS)** in the app is the plain average of five percentages: depth accuracy, rate accuracy, hand accuracy, full-recoil rate and compression fraction.

**Exercise.** In the *Shallow* scenario, the depth is wrong but the other four components are perfect. What GCS do you expect? *(Answer: (0 + 100 + 100 + 100 + 100) / 5 = 80, which is what the app and `dataset/sessions/index.csv` show.)*

## Step 3 · Follow one compression through the code

Open `js/02-simulation.js`. It is about 700 lines and split into numbered sections. Read it in this order:

1. **`Gen.next()` and `Gen.at()`: the synthetic rescuer.**
   - Each compression is a *segment* with depth `D`, residual `L`, period `T` and hand offset.
   - `at(t)` gives the true palm position at any time. Pressing uses a raised cosine over 45% of the period, release over the next 45%.
2. **`takeSample()`: the tracking model.**
   - True position, plus calibration offset, plus Gaussian noise.
   - The occlusion is a two-state Markov chain. During occlusion, the last estimate is held.
   - The confidence value falls with noise and occlusion.
3. **`butter2()` and `Biquad`: the filter.**
   - A second-order Butterworth low-pass at 5 Hz, designed with the bilinear transform.
   - *Try it:* compute `butter2(5, 30)` in the browser console and compare with a textbook design.
4. **`Detect.step()`: the detector.** A two-state machine (`release` → `compress` → `release`).
   - Starts a compression when depth exceeds 12 mm *and* has risen 8 mm from the last trough.
   - Ends the peak when depth falls by max(6 mm, 35%).
   - Refines the peak with parabolic interpolation (look for `den`).
5. **`Detect.finalize()`: the assessment.** Computes residual depth, recoil percentage, the low-confidence gate (> 20% occluded or confidence < 0.6), classification and status.
6. **`scoreCycles()`: the scores.**

**Exercise.** In the browser console (the app exposes its globals), run:

```js
Cycles.items.slice(-3)          // the last three compressions
Samples.length                  // how many 30 Hz samples are in the buffer
FB.log.items.slice(-1)[0]       // the last cue that was delivered
```

**Exercise.** The filter causes a delay. Using `dataset/sessions/stable/samples.csv`, find the shift (in samples) that maximises the correlation between `true_z_mm` and `filt_z_mm`. *(Answer: 1 sample, about 33 ms. The E1 matching window allows for a 40 ms lag.)*

## Step 4 · How the two controllers decide

Read `StaticController` and `AdaptiveController` (section 4 of `js/02-simulation.js`).

- **Deviation.** Each metric's error is measured in tolerance units, in `deviations()`: depth error ÷ 15 mm, rate error ÷ 20 per minute, position error beyond 20 mm ÷ 20, residual beyond 3 mm ÷ 6.
- **Static.** Takes the first deviating metric in a fixed order. Level 1, 2 or 3 depends on the size of the deviation, with 1, 2 or 3 modalities.
- **Adaptive.** Adds the following:
  - **Personalised weights.** `w ← 0.7·w + 0.3·(1 + persistence)`, so a deficit that keeps coming back gets more attention.
  - **Primary deficit.** Only the largest *weighted* deviation is cued, so the trainee hears one thing at a time.
  - **Baseline fading.** If the trainee has improved to half of their first-five-compression baseline, the intensity drops by one level.
  - **Modality escalation.** If the same cue has been given three times and is not working, another sense is added (haptic or audio).
  - **Repeat suppression.** An identical moderate cue is not repeated on consecutive compressions.
  - **Confirmation.** Every fourth on-target compression gets a brief "good" cue.

**Exercise.** Open `dataset/sessions/mixed/feedback.csv`. Count the corrective cues (`confirmation == 0`) per controller and metric.

```python
import pandas as pd
fb = pd.read_csv("dataset/sessions/mixed/feedback.csv")
print(fb[fb.confirmation == 0].groupby(["controller", "metric"]).size())
```

*(Answer: adaptive gives depth 34, position 26, rate 43, recoil 42, for 145 in total. Static gives depth 63, position 47, rate 83, recoil 43, for 236 in total. Why is recoil almost the same for both? Hint: look at the cue `level`. Level-3 cues are never suppressed.)*

## Step 5 · Work with the dataset

Read [`dataset/README.md`](../dataset/README.md) for the column dictionary. Every session folder has the same six files, and every measured value sits next to its ground truth.

| # | Question | File(s) | Answer |
|---|---|---|---|
| 1 | Mean measured depth and mean absolute depth error in the shallow session (scored compressions only)? | `shallow/compressions.csv` | 38.0 mm; MAE 0.29 mm (bias −0.17 mm) |
| 2 | How many compressions in the fast session have a measured rate above 120? | `fast/compressions.csv` | 274 of the 274 with a rate |
| 3 | In the occlusion session, what share of samples are occluded, and how many compressions were withheld? | `occlusion/samples.csv`, `compressions.csv` | 13.9% of samples; 45 of 203 compressions |
| 4 | When does the first "Off target" compression occur in the drift session? | `drift/compressions.csv` | Compression 19, at 13.7 s |
| 5 | List the four detected pauses and their durations. | `pauses/pauses.csv` | 2.78, 3.46, 3.36 and 2.58 s |
| 6 | Mean residual depth in the recoil session, and how is every compression labelled? | `recoil/compressions.csv` | 9.5 mm; all 219 "Incomplete" |
| 7 | How does depth MAE change between tracking noise σ = 1 mm and σ = 8 mm? | `experiments/e1_cycles.csv` (`detected == 1`) | 0.47 → 2.03 mm |
| 8 | In the mixed scenario, which single mechanism of the adaptive controller removes the most cues? | `experiments/e3_runs.csv` | Repeat suppression: without it, 117.8 cues per minute instead of 73.1 |

**Mini-project.** Write your own peak detector on `filt_z_mm` of the stable session. Count the compressions and compare with the 219 in `compressions.csv`. A simple threshold-crossing count at 25 mm after calibration finds 220. The generator produced 221 and the app detected 219, so look at the first and last seconds of the session to see where the counts differ. Then try your detector on the occlusion session, where it becomes much harder.

## Step 6 · Change something and measure it

All of the following changes are made in the simulation layer. The harness measures them.

1. **Add a scenario.** Append to `SCENARIOS` in `js/01-core.js`, for example `{ key: 'tired', name: 'Fatigue', blurb: 'Depth fades slowly.', p: { depth: 47 } }`. It appears in the scenario lab automatically. Then run `node harness/export_sessions.js` to get its recording.
2. **Tune the filter.** Change `butter2(5, FS)` to 3 Hz or 8 Hz. Run `SEEDS=5 node harness/e1_measurement.js` and compare the depth MAE and `peak_lag_ms` with the published `e1_summary.json`.
3. **Write a controller.** Subclass `StaticController` and implement `decide(c)`. Add it to the `POLICIES` list in `harness/e3_controllers.js`, which runs every policy on identical compressions. Then compare `cues_per_min`, `precision` and `coverage`.
4. **Break it on purpose.** Restore the v1.0 pause bug: remove the `if (this.state === 'release')` guard in `Detect.step()`. Run `node harness/e2_interruptions.js` and watch the false pauses appear. This is how the defect in `CHANGELOG.md` was found.

After any change to the simulation layer, the `release_sha256` in the summaries changes. That hash tells you (and your readers) exactly which code produced which numbers.

## Where to go next

- The dataset paper: [`docs/paper/PULSEMR-SIM_dataset_paper.pdf`](paper/PULSEMR-SIM_dataset_paper.pdf) covers the methods in full, with validation and figures.
- **E** in the app opens the research explorer, a summary of the PULSEMR manuscript.
- The rendering side (`js/03-scene.js`, `js/04-frame.js`) is a compact example of a three.js scene built from primitives, with picking, camera tweens and a simulated MR overlay.
