# PULSEMR-SIM dataset

PULSEMR-SIM is a fully synthetic, deterministic dataset of CPR compressions. It was produced by the simulation layer of PULSEMR v1.1 (`js/01-core.js` + `js/02-simulation.js`; SHA-256 `c0f026fc152a9f29…`). Every measured value is paired with the ground truth that produced it.

The dataset contains no human data and supports no clinical claim. Full methods and validation are in the [dataset paper](../docs/paper/PULSEMR-SIM_dataset_paper.pdf).

## Conventions

- **Files.** CSV is comma-separated with a header row, a decimal point and UTF-8 encoding. An empty cell means "not defined".
- **Units.** Lengths are in millimetres and times in seconds from the start of the session. Rates are in compressions per minute.
- **Coordinates.** Positions use a sternum-centred frame. x and y are horizontal; z is the compression depth, positive into the chest and negative when the hands are lifted.
- **Calibration.** Every session begins with a 3.6 s calibration (`calibrating = 1`).
- **Regenerating.** `npm run sessions` and `npm run experiments` rebuild everything, byte for byte.

## sessions/

There is one folder per scenario: `stable`, `shallow`, `deep`, `fast`, `slow`, `drift`, `recoil`, `pauses`, `occlusion` and `mixed`. Each session uses seed 1 and runs for 120 s after calibration. `index.csv` gives one summary row per scenario.

### samples.csv: one row per 30 Hz sample

| Column | Description |
|---|---|
| `time_s` | Sample time |
| `true_x_mm`, `true_y_mm`, `true_z_mm` | Ground-truth palm position from the motion generator |
| `raw_x_mm`, `raw_y_mm`, `raw_z_mm` | Tracked position: truth + calibration offset + noise. Held or extrapolated while occluded. |
| `filt_x_mm`, `filt_y_mm`, `filt_z_mm` | Filtered position used by the detector. Butterworth 5 Hz on all axes; x and y also get a 5-sample moving average. |
| `confidence` | Simulated tracking confidence, 0.2–0.99 |
| `occluded` | 1 if the hand landmarks were occluded |
| `true_pause` | 1 if the generator was in a pause (ground-truth interruption) |
| `calibrating` | 1 during sternum calibration |
| `feedback_level` | Intensity 0–3 of the cue shown within the last 2.5 s |

### truth_segments.csv: one row per motion segment (ground truth)

| Column | Description |
|---|---|
| `segment` | Segment number. `compressions.csv` refers to it in `true_segment`. |
| `type` | `calib`, `cycle` (one compression) or `pause` |
| `t_start_s`, `t_end_s` | Start and end of the segment |
| `true_peak_s` | Time of maximum depth (= start + 0.45 × period) |
| `true_depth_mm`, `true_residual_mm` | Peak depth and the residual depth at release |
| `period_s`, `true_rate_cpm` | Period and 60 / period |
| `true_hand_offset_mm` | Distance of the mean pressing-phase hand position from the target |
| `offset_x_start_mm`, `offset_y_start_mm`, `offset_x_end_mm`, `offset_y_end_mm` | Hand offset at the segment boundaries |
| `forced_pause` | 1 if the pause was forced from the interface (always 0 here) |

Columns that only apply to compressions are empty for `calib` and `pause` rows.

### compressions.csv: one row per detected compression

| Column | Description |
|---|---|
| `cycle` | Compression number |
| `peak_s`, `closed_s` | Interpolated peak time, and the time the compression was closed and assessed |
| `depth_mm`, `rate_cpm`, `interval_s` | Measured depth, rate and peak-to-peak interval. Rate is empty after a pause or outside the 0.33–1.5 s interval range. |
| `hand_error_mm`, `hand_x_mm`, `hand_y_mm` | Hand-position error and mean filtered hand position while pressing |
| `residual_mm`, `recoil_pct`, `recoil_label` | Residual depth, recoil percentage, and a label: Complete (≤ 3 mm), Partial (≤ 8 mm) or Incomplete |
| `pause_before_s` | Duration of the pause that ended at this compression |
| `mean_confidence`, `occluded_fraction`, `low_confidence` | Tracking quality over the peak-to-peak window. `low_confidence` = 1 means the compression was not scored and got no cue. |
| `status` | Target, Shallow, Too deep, Fast, Slow, Off target, Partial recoil, Warning (more than one deficit) or Low confidence |
| `feedback_shown`, `feedback_level` | What the app showed for this compression (a message, "Same cue held", "None" or "Withheld · …") and its intensity |
| `true_segment`, `true_peak_s`, `true_depth_mm`, `true_residual_mm`, `true_hand_offset_mm` | The matched true compression. Matching uses the true peak within −0.1 to +0.3 s of the detected peak. Empty if unmatched. |

### pauses.csv: one row per detected interruption

| Column | Description |
|---|---|
| `pause` | Interruption number |
| `start_s` | Start of the interruption (0.35 s after the last peak) |
| `end_s` | End of the interruption (the next compression) |
| `duration_s` | Duration of the interruption |

### feedback.csv: every decision of both controllers

| Column | Description |
|---|---|
| `controller` | `adaptive` (delivered by the app) or `static` (recorded as a shadow on the same compressions) |
| `time_s`, `cycle` | Decision time (the compression's `closed_s`, or the time of the pause) and the compression number (empty for pause cues) |
| `metric` | `depth`, `rate`, `position`, `recoil` or `interrupt`. Confirmations use `gooddepth` or `none`. |
| `direction` | `low`, `high`, `slow`, `fast` or `any` |
| `deviation` | Deviation in tolerance units (depth ÷ 15 mm, rate ÷ 20 per minute, position beyond 20 mm ÷ 20, residual beyond 3 mm ÷ 6) |
| `level`, `modalities` | Intensity 1–3, and the modalities used (`visual`, `audio`, `haptic`, joined by `+`) |
| `message` | The text shown, for example `PUSH DEEPER` |
| `confirmation` | 1 for a positive confirmation cue |
| `note` | The adaptive controller's reason, for example "recurring deficit: extra modality added" |
| `shown_in_app` | 1 if this decision was delivered to the trainee |

### meta.json

`meta.json` records:

- the scenario, seed, duration and tracking condition
- the technique parameters
- the calibration residual
- the session scores (`depthAcc`, `rateAcc`, `posAcc`, `recoilAcc`, interruption fraction `IF`, compression fraction `cf`, `gcs`)
- counts of samples, true and detected compressions and pauses, withheld compressions, and cues
- `simulation_sha256`

### index.csv

`index.csv` repeats the counts and scores of all ten `meta.json` files in one table.

## experiments/

| File | Contents |
|---|---|
| `e1_cycles.csv` | **E1 measurement accuracy.** One row per true compression (57,516 rows): 11 conditions × 30 seeds × 90 s. Columns: `cond`, `seed`, `true_peak_s`, `detected`, `true_/meas_depth_mm`, `true_/meas_rate_cpm`, `true_/meas_pos_mm`, `pos_vec_err_mm`, `true_/meas_resid_mm`, `peak_lag_ms`, `emit_lag_ms`, `low_conf`. |
| `e1_summary.json` | For each condition: sensitivity, false detections per minute, low-confidence share, depth, rate and recoil MAE with bias, position error, and Cohen's κ for the depth, rate, position and recoil classes. Values are given as mean, SD and bootstrap 95% CI over seeds. |
| `e1_trace.json` | A 6 s example trace (true, raw and filtered x and z; detected and true peaks) for a signal figure. |
| `e2_summary.json` | **E2 interruption detection, v1.1.** Three conditions × 30 seeds × 180 s. Reports true, detected and false pauses, onset delay, duration error, cues per pause, and per-run `trueIF` / `measIF` pairs. |
| `v1.0/e2_summary.json` | The same experiment run with the defective v1.0 detector |
| `e3_runs.csv` | **E3 feedback policies.** One row per scenario × seed × policy (2,400 rows). Policies: `static`, `static_rl`, `adaptive`, `abl_personalize`, `abl_suppress`, `abl_escalate`, `abl_fade`, `abl_confirm`. Metrics: `cues_per_min`, `confirm_per_min`, `precision`, `unwarranted_per_min`, `repeat_frac`, `mean_level`, `modality_events_per_min`, `audio_per_min`, `haptic_per_min`, `coverage`, `deficient_cycles`. |
| `e3_summary.json` | Mean, SD and CI of every E3 metric for each scenario and policy |
| `e3_onset.json` | **E3 protocol B.** 30 s on target, then one deficit appears. Reports the latency to the first cue (in seconds and compressions), the level of the first cue, and the mean cue level for each of the first 40 compressions. |
| `e5_compute.json` | **E5 cost.** Microseconds per 30 Hz sample over 20 runs, with the CPU and Node.js version. This is the only machine-dependent file. |

### Metric definitions (E3)

- **precision.** The share of corrective cues whose metric was truly deficient in that compression.
- **unwarranted_per_min.** Corrective cues per minute for compressions with no true deficit.
- **coverage.** The share of truly deficient compressions answered by a cue on that metric, at that compression or one of the next two.
- **repeat_frac.** The share of cues identical to the previous cue.
- **modality_events_per_min.** Sensory load: every visual, audio and haptic activation, counted per minute.
