#!/usr/bin/env node
/* Builds the dataset paper (docs/paper/PULSEMR-SIM_dataset_paper.docx) from the figures in docs/paper/figures
   and the numbers in dataset/. Usage: python3 docs/paper/make_figures.py && node docs/paper/build_paper.js
   Needs the npm package "docx" (npm install docx). */
'use strict';
const fs = require('fs'), path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, ShadingType,
  ImageRun, LevelFormat, BorderStyle, Footer, PageNumber, TabStopType
} = require('docx');

const ROOT = path.resolve(__dirname, '..', '..');
const DS = path.join(ROOT, 'dataset');
const FIG = path.join(__dirname, 'figures');
const csv = p => { const [h, ...r] = fs.readFileSync(p, 'utf8').trim().split('\n'); const k = h.split(','); return r.map(l => Object.fromEntries(l.split(',').map((v, i) => [k[i], v]))); };
const json = p => JSON.parse(fs.readFileSync(p, 'utf8'));

/* ---------- numbers pulled from the dataset ---------- */
const idx = csv(path.join(DS, 'sessions/index.csv'));
const e1 = json(path.join(DS, 'experiments/e1_summary.json'));
const e2 = json(path.join(DS, 'experiments/e2_summary.json'));
const e2v10 = json(path.join(DS, 'experiments/v1.0/e2_summary.json'));
const e3 = json(path.join(DS, 'experiments/e3_summary.json'));
const e5 = json(path.join(DS, 'experiments/e5_compute.json'));
const meta = Object.fromEntries(idx.map(r => [r.scenario, json(path.join(DS, 'sessions', r.scenario, 'meta.json'))]));
const SHA = e1.release_sha256;
const nE1 = fs.readFileSync(path.join(DS, 'experiments/e1_cycles.csv'), 'utf8').trim().split('\n').length - 1;
const nE3 = fs.readFileSync(path.join(DS, 'experiments/e3_runs.csv'), 'utf8').trim().split('\n').length - 1;
const f = (v, d = 1) => Number(v).toFixed(d);

/* ---------- styling helpers ---------- */
const FONT = 'Arial', MONO = 'Courier New';
const P = (text, o = {}) => new Paragraph({ spacing: { after: 120, line: 288 }, alignment: o.align || AlignmentType.JUSTIFIED, ...o.p, children: runs(text, o) });
function runs(text, o = {}) {
  // **bold**, *italic*, `code` inline markup
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), size: o.size, color: o.color }));
    const t = m[0];
    if (t.startsWith('**')) out.push(new TextRun({ text: t.slice(2, -2), bold: true, size: o.size, color: o.color }));
    else if (t.startsWith('`')) out.push(new TextRun({ text: t.slice(1, -1), font: MONO, size: (o.size || 21) - 2, color: o.color }));
    else out.push(new TextRun({ text: t.slice(1, -1), italics: true, size: o.size, color: o.color }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), size: o.size, color: o.color }));
  return out;
}
const H1 = t => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = t => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const H3 = t => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const bullet = (t, lvl = 0) => new Paragraph({ numbering: { reference: 'bullets', level: lvl }, spacing: { after: 60, line: 276 }, children: runs(t) });
const code = lines => lines.map((l, i) => new Paragraph({
  shading: { type: ShadingType.CLEAR, fill: 'F3F3F1', color: 'auto' }, spacing: { after: i === lines.length - 1 ? 160 : 0, line: 240 },
  indent: { left: 200, right: 200 }, children: [new TextRun({ text: l || ' ', font: MONO, size: 17 })]
}));
const W = 9360; // text width, DXA (US Letter, 1-inch margins)
function table(head, body, widths, o = {}) {
  const tot = widths.reduce((a, b) => a + b, 0), cw = widths.map(w => Math.round(w / tot * W));
  cw[cw.length - 1] += W - cw.reduce((a, b) => a + b, 0);
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBEB8' };
  const cell = (t, i, hdr) => new TableCell({
    width: { size: cw[i], type: WidthType.DXA }, margins: { top: 50, bottom: 50, left: 80, right: 80 },
    shading: hdr ? { type: ShadingType.CLEAR, fill: 'E9EEF6', color: 'auto' } : undefined,
    borders: { top: border, bottom: border, left: border, right: border },
    children: [new Paragraph({ alignment: (o.right || []).includes(i) && !hdr ? AlignmentType.RIGHT : AlignmentType.LEFT, spacing: { after: 0, line: 240 },
      children: hdr ? [new TextRun({ text: t, bold: true, size: 16 })] : runs(String(t), { size: 16 }) })]
  });
  return [new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: cw,
    rows: [new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, i, true)) }), ...body.map(r => new TableRow({ children: r.map((c, i) => cell(c, i, false)) }))] }),
    new Paragraph({ spacing: { after: 100 }, children: [] })];
}
const caption = (label, text) => new Paragraph({ spacing: { before: 80, after: 220, line: 264 }, children: [new TextRun({ text: label + ' ', bold: true, size: 18 }), ...runs(text, { size: 18 })] });
const tcap = (label, text) => new Paragraph({ keepNext: true, spacing: { before: 200, after: 80, line: 264 }, children: [new TextRun({ text: label + ' ', bold: true, size: 18 }), ...runs(text, { size: 18 })] });
function figure(file, widthIn) {
  const buf = fs.readFileSync(path.join(FIG, file));
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const wp = Math.round(widthIn * 96);
  return new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 40 },
    children: [new ImageRun({ type: 'png', data: buf, transformation: { width: wp, height: Math.round(wp * h / w) }, altText: { title: file, description: file, name: file } })] });
}

/* ---------- content ---------- */
const sc = Object.fromEntries(idx.map(r => [r.scenario, r]));
const e1c = id => e1.conditions.find(c => c.id === id);
const e2c = (d, id) => d.conditions.find(c => c.id === id);
const pol = (s, p) => e3.scenarios[s][p].cuesPerMin.mean;
const totalSamples = Object.values(meta).reduce((a, m) => a + m.counts.samples, 0);
const totalTrue = Object.values(meta).reduce((a, m) => a + m.counts.true_compressions, 0);

const children = [];
const add = (...x) => children.push(...x.flat());

add(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'DATA DESCRIPTOR', bold: true, size: 17, color: '2A78D6' })] }));
add(new Paragraph({ spacing: { after: 200, line: 300 }, children: [new TextRun({ text: 'PULSEMR-SIM: a ground-truth-labelled synthetic dataset of CPR hand tracking, compression assessment and adaptive feedback decisions', bold: true, size: 34 })] }));
add(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'Irish Singh', size: 21 })] }));
add(new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: 'The Pennsylvania State University, University Park, PA, USA', size: 18, color: '52514E' })] }));

add(H1('Abstract'));
add(P(`Training feedback for cardiopulmonary resuscitation (CPR) depends on a chain of steps: tracking the rescuer’s hands, filtering the signal, detecting compressions, scoring them against guideline targets, and deciding which cue to give. Real recordings rarely carry ground truth for every step, so the effect of each step on the next is hard to measure. PULSEMR-SIM is a fully synthetic, deterministic dataset produced by the simulation layer of PULSEMR, an open browser-based demonstration of adaptive mixed-reality CPR guidance. Every record is paired with the motion that generated it. The dataset has two parts. **Session recordings** contain ten 120-second sessions, one per training scenario (stable, shallow, too deep, fast, slow, hand drift, incomplete recoil, interruptions, tracking occlusion, mixed errors), with ${totalSamples.toLocaleString('en-US')} 30 Hz samples at three layers (ground truth, tracked, filtered), ${totalTrue.toLocaleString('en-US')} true compression segments, every detected compression and pause, and every decision of an adaptive and a static feedback controller run side by side. **Experiment outputs** contain the four reproducible experiments behind the PULSEMR manuscript: measurement accuracy over ${nE1.toLocaleString('en-US')} true compressions under 11 tracking conditions (E1), interruption detection in two software versions (E2), ${nE3.toLocaleString('en-US')} feedback-policy runs (E3), and computational cost (E5). The generator code is included, so every file can be regenerated bit-for-bit. The data contain no human participants and make no claim about clinical performance. They support teaching, testing of detection and feedback algorithms, and reproduction of the manuscript’s tables.`));

add(H1('Background & Summary'));
add(P(`High-quality chest compressions are defined by a small set of measurable targets: a depth of 50 to 60 mm, a rate of 100 to 120 compressions per minute, full chest recoil between compressions, correct hand position on the lower half of the sternum, and as few interruptions as possible [1, 2]. Feedback devices and mixed-reality (MR) training systems estimate these quantities from sensors and turn deviations into cues. Each estimate, however, passes through several processing stages, and errors at one stage (a noisy hand position, a missed peak, a pause counted twice) silently change what the trainee is told.`));
add(P(`PULSEMR is a research demonstration of adaptive MR guidance for CPR training. Its browser version runs the full sensing-to-feedback chain on a simulated rescuer: a seeded motion generator produces compressions with known depth, rate, hand offset and recoil; a tracking model samples the palm at 30 Hz with configurable noise, occlusion and jitter; a Butterworth filter, a peak-and-trough detector and a scorer assess each compression; and two controllers, one adaptive and one static, decide on feedback for the same compressions. Because the generator is the only source of motion, the ground truth for every compression and pause is known exactly.`));
add(P(`This descriptor documents the dataset produced by that simulation layer. It was created for three uses: (i) to make the manuscript’s quantitative results reproducible and inspectable down to single compressions; (ii) to give students and developers a labelled, small, readable dataset for learning how CPR quality metrics are computed and how feedback policies behave; and (iii) to provide a benchmark against which alternative filters, detectors or controllers can be compared on identical inputs. Fig 1 shows how the stages map to files.`));
add(figure('fig1_generation.png', 6.5));
add(caption('Fig 1.', 'Data generation. Each stage of the PULSEMR simulation layer writes its own record, so every derived value can be traced back to the motion that produced it.'));

add(H1('Methods'));
add(H2('Software and determinism'));
add(P(`All data were produced by PULSEMR version 1.1 (simulation layer unchanged in the 1.1.1 interface release). The simulation layer is the pair of files \`js/01-core.js\` and \`js/02-simulation.js\`; their concatenation has SHA-256 \`${SHA.slice(0, 16)}…\`, which is stored in every summary and \`meta.json\` file. The harness (\`harness/sim_node.js\`) loads exactly this code into a Node.js \`vm\` context, stubs the display hooks, and advances the simulation clock in 50 ms steps. No wall-clock time, browser state or rendering enters the computation; random numbers come from a seeded generator (\`makeRng\`), so the same seed always gives the same file. Earlier version 1.0, whose interruption detector double-counted pauses, is kept in \`releases/\` and is used only for experiment E2.`));

add(H2('Synthetic rescuer (ground truth)'));
add(P(`Motion is generated as a sequence of segments. A compression segment of period *T* = 60/rate drives the palm from a residual depth *L* to a peak depth *D* and back with raised-cosine phases (pressing during the first 45% of the period, release during the next 45%, then a short hold). Per segment, the rate varies by Gaussian noise with SD 2.2 per minute and the depth by SD 1.5 mm. Residual depth follows the recoil setting: *L* = (1 − recoil/100)·*D* plus a small half-normal term. The horizontal hand offset follows a slow mean-reverting random walk (coefficient 0.94, step SD 0.55 mm) around the scenario’s offset. With an interruption frequency *f* per minute, each new segment becomes a 2.5 to 5 s pause with probability *f*·*T*/60; during a pause, the hands lift about 26 mm off the chest. Every session starts with a 3.6 s sternum calibration made of 0.25 s calibration segments. Table 1 lists the ten scenarios.`));
add(tcap('Table 1.', 'Training scenarios. Parameters not listed take the stable values (depth 55 mm, rate 110 per minute, hand offset 0 mm, recoil 100%, no pauses, tracking noise σ = 1 mm, controlled-lab tracking).'));
add(table(['Key', 'Scenario', 'Change from stable'], [
  ['stable', 'Stable performance', 'none'],
  ['shallow', 'Shallow compressions', 'depth 38 mm'],
  ['deep', 'Excessive depth', 'depth 67 mm'],
  ['fast', 'Fast compressions', 'rate 138 per minute'],
  ['slow', 'Slow compressions', 'rate 84 per minute'],
  ['drift', 'Hand-position drift', 'offset ramps to (24, −21) mm, about 32 mm, over 22 s'],
  ['recoil', 'Incomplete recoil', 'recoil 82%'],
  ['pauses', 'Frequent interruptions', 'about 3 pauses per minute, 2.5 to 5 s each'],
  ['occlusion', 'Tracking occlusion', 'partial-occlusion tracking condition'],
  ['mixed', 'Mixed performance errors', 'rotates every 12 s: depth 40 mm; rate 136; offset (26, 18) mm; recoil 80%']
], [1.1, 2.2, 5]));

add(H2('Tracking model'));
add(P(`The palm centre is sampled at 30 Hz in a sternum-centred frame (x, y horizontal; z positive into the chest). The tracked position equals the true position plus a calibration offset (residual of the calibration step, below 1.5 mm), independent Gaussian noise with SD σ in x and y and 0.55σ in z, and the condition-specific effects in Table 2. Under partial occlusion, a two-state Markov process (entry probability 0.025 per sample, exit probability 0.12) marks samples as occluded; occluded samples carry no new observation, so the tracker holds the last filtered estimate and briefly extrapolates the vertical velocity. A confidence value in [0.2, 0.99] falls with noise and drops by 0.42 during occlusion.`));
add(tcap('Table 2.', 'Tracking conditions. Effective noise SD = σ × multiplier + added noise.'));
add(table(['Key', 'Condition', 'Noise ×', 'Noise + (mm)', 'Base confidence', 'Other'], [
  ['lab', 'Controlled lab', '1.0', '0', '0.97', '–'],
  ['low', 'Low light', '1.8', '1.5', '0.80', '–'],
  ['occl', 'Partial occlusion', '1.2', '0.6', '0.90', 'Markov occlusion'],
  ['motion', 'Motion disturbance', '1.3', '1.0', '0.84', '9.3 and 11.7 Hz jitter, 3.5 mm']
], [0.8, 1.7, 0.9, 1.1, 1.2, 2.3], { right: [2, 3, 4] }));

add(H2('Signal processing and compression detection'));
add(P(`Each axis is low-pass filtered with a second-order Butterworth filter (cut-off 5 Hz, bilinear transform with pre-warping); x and y are additionally smoothed with a 5-sample moving average. A compression starts when filtered depth exceeds 12 mm and has risen at least 8 mm from the preceding trough, at least 0.3 s after the previous peak. The peak is the maximum until depth falls by max(6 mm, 35% of the peak); its time and height are refined by parabolic interpolation over the three samples around the maximum. The compression is closed when the next one starts, or when no new compression arrives (0.6 s after the trough and 1 s after the peak); the lowest filtered depth before closing is the residual depth. Rate is 60 divided by the peak-to-peak interval, reported only for intervals of 0.33 to 1.5 s and not across a pause. Hand position is the mean filtered (x, y) during the pressing phase, and its error is the distance from the sternum target. An interruption starts when no compression has peaked for 1.2 + 0.35 s, is dated from 0.35 s after the last peak, and ends at the next compression.`));
add(P(`A compression is labelled **low confidence** and is neither scored nor given feedback if more than 20% of its peak-to-peak window was occluded or its mean confidence is below 0.6.`));

add(H2('Assessment and scores'));
add(P(`Each scored compression is classified against the guideline targets: depth within 50 to 60 mm, rate within 100 to 120 per minute, hand-position error at most 20 mm, and residual depth at most 3 mm for full recoil (3 to 8 mm partial; above 8 mm incomplete, demonstration thresholds). The guideline compliance score (GCS) used by the demonstration is the unweighted mean of five percentages: depth accuracy, rate accuracy, hand-position accuracy, full-recoil rate and compression fraction (100 × (1 − interruption fraction)). Session scores in \`meta.json\` cover all scored compressions after calibration.`));

add(H2('Feedback controllers'));
add(P(`For every scored compression, the deviation of each metric is expressed in units of a tolerance (depth: mm outside the band / 15; rate: per-minute outside the band / 20; position: mm beyond 20 / 20; recoil: mm beyond 3 / 6). The **static controller** reports the first deviating metric in fixed order (depth, rate, position, recoil) at level 1 (< 0.35), 2 (< 1.0) or 3, with one, two or three modalities. The **adaptive controller** keeps a five-compression baseline and a ten-compression history. For each metric it updates a weight *w* ← (1 − α)*w* + α(1 + *p*), where α = 0.3 and *p* is the fraction of recent compressions with that deficit, picks the metric with the largest weighted deviation, lowers the level-2 threshold to 0.35/√*w* for recurring deficits, lowers the level by one when the trainee has improved to below half of their baseline deviation, adds a modality when the same cue has been repeated three times, does not repeat an identical moderate cue on consecutive compressions, and gives a brief visual confirmation every fourth compression on target. Interruptions trigger a cue at onset and an escalated cue after 3.5 s. Both controllers see identical compressions; the app delivers the adaptive decisions, and the static decisions are recorded as a shadow.`));

add(H2('Experiments and session exports'));
add(P(`Five harness scripts produce the dataset (Table 3). Experiments run for 30 seeds per condition. Each detected compression is matched one-to-one to the true compression whose analytic peak time (segment start + 0.45*T*) lies within −0.1 to +0.3 s of the detected peak, choosing the closest to a 40 ms filter lag. Unmatched detections are false positives. Experiment-level means carry 95% percentile-bootstrap confidence intervals over seeds (4,000 resamples) [5], and agreement of binary classifications with ground truth is reported as Cohen’s κ [4].`));
add(tcap('Table 3.', 'Generating scripts and their outputs (all paths relative to the repository root).'));
add(table(['Script', 'Design', 'Output'], [
  ['harness/export_sessions.js', '10 scenarios × seed 1 × 120 s after calibration', 'dataset/sessions/'],
  ['harness/e1_measurement.js', '11 conditions (σ = 0, 0.5, 1, 2, 4, 6, 8 mm in the lab; lab, low light, occlusion, motion at σ = 1 mm) × 30 seeds × 90 s; stable technique', 'e1_cycles.csv, e1_summary.json, e1_trace.json'],
  ['harness/e2_interruptions.js', '3 conditions × 30 seeds × 180 s, 3 pauses per minute; run for v1.1 and v1.0', 'e2_summary.json, v1.0/e2_summary.json'],
  ['harness/e3_controllers.js', 'Protocol A: 10 scenarios × 8 policies × 30 seeds × 120 s. Protocol B: 30 s on target, then a single deficit, 60 s observed', 'e3_runs.csv, e3_summary.json, e3_onset.json'],
  ['harness/e5_compute.js', '20 runs × 120 s, pipeline only (no rendering)', 'e5_compute.json']
], [2.2, 4.3, 2.6]));
add(P(`To regenerate everything, run \`npm run experiments\` and \`npm run sessions\` from the repository root (Node.js 18 or later; no other dependencies). Version 1.0 results are produced with \`VERSION=v1.0 node harness/e2_interruptions.js\`.`));

add(H1('Data Records'));
add(P(`The dataset is the \`dataset/\` folder of the PULSEMR repository (about 9 MB, plain CSV and JSON, UTF-8, comma-separated, header row, decimal point). Lengths are millimetres, times are seconds from the start of the session, and the calibration phase occupies the first 3.6 s. Empty cells mean “not defined” (for example, the rate of the first compression after a pause).`));
add(...code([
  'dataset/',
  '├── sessions/',
  '│   ├── index.csv                one summary row per scenario',
  '│   └── <scenario>/              stable, shallow, deep, fast, slow, drift,',
  '│       │                        recoil, pauses, occlusion, mixed',
  '│       ├── samples.csv          30 Hz samples: truth, tracked, filtered',
  '│       ├── truth_segments.csv   generator segments (ground truth)',
  '│       ├── compressions.csv     detected compressions + matched truth',
  '│       ├── pauses.csv           detected interruptions',
  '│       ├── feedback.csv         adaptive and static decisions',
  '│       └── meta.json            parameters, counts, session scores',
  '└── experiments/',
  '    ├── e1_cycles.csv, e1_summary.json, e1_trace.json',
  '    ├── e2_summary.json, v1.0/e2_summary.json',
  '    ├── e3_runs.csv, e3_summary.json, e3_onset.json',
  '    └── e5_compute.json'
]));

add(H2('Session recordings'));
add(tcap('Table 4.', '`samples.csv`: one row per 30 Hz tracking sample (about 3,710 rows per session).'));
add(table(['Column', 'Meaning'], [
  ['time_s', 'Sample time (s)'],
  ['true_x_mm, true_y_mm, true_z_mm', 'Ground-truth palm position from the generator; z is compression depth (positive into the chest, negative when the hands are lifted)'],
  ['raw_x_mm, raw_y_mm, raw_z_mm', 'Tracked position: truth + calibration offset + noise (held/extrapolated while occluded)'],
  ['filt_x_mm, filt_y_mm, filt_z_mm', 'Filtered position used for detection (Butterworth 5 Hz; x, y also 5-sample average)'],
  ['confidence', 'Simulated tracking confidence, 0.2 to 0.99'],
  ['occluded', '1 if the hand landmarks were occluded in this sample'],
  ['true_pause', '1 if the generator was in a pause segment (ground-truth interruption)'],
  ['calibrating', '1 during the 3.6 s sternum calibration'],
  ['feedback_level', 'Intensity (0 to 3) of the cue shown by the app within the last 2.5 s']
], [2.6, 6.4]));
add(tcap('Table 5.', '`truth_segments.csv`: one row per generator segment.'));
add(table(['Column', 'Meaning'], [
  ['segment', 'Segment number (1-based); referenced by compressions.csv'],
  ['type', 'calib, cycle (one compression) or pause'],
  ['t_start_s, t_end_s', 'Segment start and end'],
  ['true_peak_s', 'Analytic time of maximum depth (cycles only)'],
  ['true_depth_mm, true_residual_mm', 'Peak depth D and residual depth L (cycles only)'],
  ['period_s, true_rate_cpm', 'Period T and 60/T (cycles only)'],
  ['true_hand_offset_mm', 'Distance of the mean pressing-phase hand position from the target (cycles only)'],
  ['offset_x/y_start_mm, offset_x/y_end_mm', 'Hand offset at the segment boundaries'],
  ['forced_pause', '1 if the pause was forced by the user interface (always 0 in this dataset)']
], [2.6, 6.4]));
add(tcap('Table 6.', '`compressions.csv`: one row per detected compression.'));
add(table(['Column', 'Meaning'], [
  ['cycle', 'Compression number'],
  ['peak_s, closed_s', 'Interpolated peak time; time the compression was closed and assessed'],
  ['depth_mm, rate_cpm, interval_s', 'Measured depth, rate and peak-to-peak interval'],
  ['hand_error_mm, hand_x_mm, hand_y_mm', 'Hand-position error and mean filtered position during pressing'],
  ['residual_mm, recoil_pct, recoil_label', 'Residual depth, recoil percentage, Complete/Partial/Incomplete'],
  ['pause_before_s', 'Duration of the interruption that ended at this compression'],
  ['mean_confidence, occluded_fraction, low_confidence', 'Tracking quality over the peak-to-peak window and the low-confidence flag'],
  ['status', 'Target, Shallow, Too deep, Fast, Slow, Off target, Partial recoil, Warning (several deficits) or Low confidence'],
  ['feedback_shown, feedback_level', 'Cue the app showed for this compression (or “Same cue held”, “None”, “Withheld”) and its level'],
  ['true_segment, true_peak_s, true_depth_mm, true_residual_mm, true_hand_offset_mm', 'Matched ground-truth compression (empty if unmatched, i.e. a false detection)']
], [3.2, 5.8]));
add(tcap('Table 7.', '`feedback.csv` and `pauses.csv`.'));
add(table(['Column', 'Meaning'], [
  ['controller', 'adaptive or static'],
  ['time_s, cycle', 'Decision time (the closing time of the compression, or the pause time) and compression number (empty for pause cues)'],
  ['metric, direction, deviation', 'Chosen metric (depth, rate, position, recoil, interrupt; gooddepth/none for confirmations), direction (low, high, slow, fast, any) and deviation in tolerance units'],
  ['level, modalities', 'Intensity 1 to 3 and modalities (visual, audio, haptic joined by +)'],
  ['message, confirmation, note', 'Displayed message, 1 for a confirmation cue, and the adaptive controller’s reason (for example “recurring deficit: extra modality added”)'],
  ['shown_in_app', '1 if this decision was the one delivered to the trainee'],
  ['pause, start_s, end_s, duration_s', 'pauses.csv: detected interruption number, start, end and duration']
], [2.6, 6.4]));
add(P(`\`meta.json\` stores the scenario, seed, duration, tracking condition, technique parameters, calibration residual, session scores (n, depth, rate, position and recoil accuracy, interruption fraction, compression fraction, GCS), counts and the simulation hash. \`index.csv\` repeats the counts and scores for all ten sessions.`));

add(H2('Experiment outputs'));
add(tcap('Table 8.', '`e1_cycles.csv`: one row per true compression in experiment E1 (all conditions and seeds).'));
add(table(['Column', 'Meaning'], [
  ['cond, seed', 'Condition id (noise_0 … noise_8, env_lab, env_low, env_occl, env_motion) and seed 1 to 30'],
  ['true_peak_s, detected', 'Analytic peak time; 1 if a detected compression was matched'],
  ['true_depth_mm, meas_depth_mm', 'True and measured depth'],
  ['true_rate_cpm, meas_rate_cpm', 'True and measured rate'],
  ['true_pos_mm, meas_pos_mm, pos_vec_err_mm', 'True and measured hand offset, and the vector distance between them'],
  ['true_resid_mm, meas_resid_mm', 'True and measured residual depth'],
  ['peak_lag_ms, emit_lag_ms', 'Detected peak minus true peak; closing time minus true peak'],
  ['low_conf', '1 if the matched compression was withheld for low confidence']
], [2.6, 6.4]));
add(tcap('Table 9.', '`e3_runs.csv`: one row per scenario × seed × policy (2,400 rows).'));
add(table(['Column', 'Meaning'], [
  ['scenario, seed, policy', 'Scenario key; seed 1 to 30; static, static_rl (repeat limit), adaptive, or an adaptive ablation (abl_personalize, abl_suppress, abl_escalate, abl_fade, abl_confirm)'],
  ['cues_per_min, confirm_per_min', 'Corrective cues and confirmation cues per minute'],
  ['precision, unwarranted_per_min', 'Share of corrective cues that named a deficit truly present in the compression; cues with no true deficit per minute'],
  ['repeat_frac, mean_level', 'Share of cues identical to the previous cue; mean intensity'],
  ['modality_events_per_min, audio_per_min, haptic_per_min', 'Sensory load: modality activations per minute, total and by channel'],
  ['coverage, deficient_cycles', 'Share of truly deficient compressions answered by a cue on that metric at that compression or one of the next two; number of truly deficient compressions']
], [2.6, 6.4]));
add(P(`The JSON summaries hold per-condition statistics with mean, SD and 95% CI (E1: sensitivity, false detections per minute, depth/rate/recoil MAE and bias, position error, κ for each classification; E2: pause sensitivity, false pauses, onset delay, duration error, cues per pause and per-run pairs of true and measured interruption fraction; E3: every metric of Table 9 per scenario and policy; E3 onset: latency to the first cue and mean cue level for the first 40 compressions after a deficit appears; E5: microseconds per sample per run with CPU and Node.js version).`));

add(H1('What happens in each session'));
add(P(`Fig 2 shows one stretch of two sessions at full resolution and Fig 3 summarises all ten. In every session the first 3.6 s are calibration, after which the generator produces about 1.8 compressions per second (2.3 in the fast scenario, 1.4 in the slow one).`));
add(figure('fig2_session_traces.png', 6.3));
add(caption('Fig 2.', 'Two sessions at sample level. (a) Shallow scenario: ground-truth depth (blue), the tracked signal (grey, almost hidden at σ = 1 mm) and the filtered signal (orange), which lags the truth by about 40 ms. Every detected peak lies near 38 mm, below the guideline band. (b) Occlusion scenario: occluded intervals (shaded) pull confidence down; compressions measured mostly from estimated samples are withheld (crosses) rather than scored.'));
add(figure('fig3_scenario_scores.png', 5.8));
add(caption('Fig 3.', `Session scores from \`sessions/index.csv\`. Each single-error scenario removes one component, so the GCS falls to about 80; the drift scenario keeps ${f(sc.drift.hand_accuracy_pct)}% hand accuracy only while the hands are still close to the target.`));
add(tcap('Table 10.', 'Session counts (seed 1, 120 s after calibration). Adaptive and static count corrective cues decided by each controller for the same compressions.'));
add(table(['Scenario', 'True comp.', 'Detected', 'Withheld', 'Pauses (true/det.)', 'Adaptive cues', 'Static cues', 'GCS'],
  idx.map(r => [r.name, r.true_compressions, r.detected_compressions, r.withheld_low_confidence, `${r.true_pauses}/${r.detected_pauses}`, r.adaptive_cues, r.static_cues, f(r.session_gcs)]),
  [2.4, 0.9, 0.9, 0.9, 1.1, 1, 0.9, 0.7], { right: [1, 2, 3, 4, 5, 6, 7] }));
add(P(`**Stable.** All scored compressions meet every target (GCS 100). The adaptive controller issues no corrective cue, only periodic confirmations; the static controller is silent.`));
add(P(`**Shallow and too deep.** Every compression misses the depth band (depth accuracy 0%), while rate, position and recoil stay on target. Both controllers immediately name the depth deficit; the static controller repeats it on all ${sc.shallow.static_cues} compressions, whereas the adaptive controller gives ${sc.shallow.adaptive_cues} cues because it holds an identical moderate cue instead of repeating it on consecutive compressions, and pairs the visual cue with a haptic channel for depth.`));
add(P(`**Fast and slow.** Rate is outside the band for every compression; the fast session contains ${sc.fast.true_compressions} compressions and the slow one ${sc.slow.true_compressions}. The adaptive controller pairs the visual cue with audio (a metronome channel) for rate.`));
add(P(`**Hand drift.** The hands move away from the target over the first 22 s and settle about 32 mm off it. The first compressions are on target, so hand-position accuracy is ${f(sc.drift.hand_accuracy_pct)}% for the session; once the offset passes 20 mm every compression is labelled “Off target”.`));
add(P(`**Incomplete recoil.** Residual depth is about 18% of the depth (about 10 mm), so no compression reaches full recoil. Because the recoil deviation is large, most cues are level 3 and are not suppressed, which is why adaptive and static cue counts are almost equal here (${sc.recoil.adaptive_cues} vs ${sc.recoil.static_cues}).`));
add(P(`**Interruptions.** The generator inserted ${sc.pauses.true_pauses} pauses and all ${sc.pauses.detected_pauses} were detected; the interruption fraction is ${f(sc.pauses.interruption_fraction, 3)}, so the compression fraction is ${f(100 * (1 - sc.pauses.interruption_fraction))}%. Each pause triggers an onset cue and, if it lasts beyond 3.5 s, an escalated cue.`));
add(P(`**Occlusion.** Technique is on target, but tracking drops out repeatedly. ${sc.occlusion.true_compressions - sc.occlusion.detected_compressions} of ${sc.occlusion.true_compressions} compressions were not detected and ${sc.occlusion.withheld_low_confidence} of the ${sc.occlusion.detected_compressions} detected ones were withheld. Rate accuracy drops to ${f(sc.occlusion.rate_accuracy_pct)}% because a missed peak doubles the next interval. The ${sc.occlusion.adaptive_cues} cues issued are almost all caused by such measurement artefacts, not by the trainee; this session is useful for studying false feedback.`));
add(P(`**Mixed errors.** The error type changes every 12 s (shallow, fast, drifting, incomplete recoil), so every component falls to between ${f(sc.mixed.rate_accuracy_pct, 0)}% and ${f(sc.mixed.full_recoil_pct, 0)}% and the controllers must switch metrics; this is the most informative session for comparing policies.`));

add(H1('Technical Validation'));
add(H2('Measurement accuracy against ground truth (E1)'));
add(P(`Across the noise conditions every true compression was detected with no false detections. Errors grow smoothly with tracking noise (Fig 4): at σ = 1 mm the depth MAE is ${f(e1c('noise_1').depthMAE.mean, 2)} mm and the hand-position error ${f(e1c('noise_1').posErr.mean, 2)} mm; at σ = 8 mm they reach ${f(e1c('noise_8').depthMAE.mean, 2)} mm and ${f(e1c('noise_8').posErr.mean, 2)} mm, still well inside the 10 mm depth band. Low light and motion jitter raise errors moderately. Partial occlusion is the only condition that loses compressions: ${f(100 * e1c('env_occl').sensitivity.mean)}% were detected and ${f(100 * e1c('env_occl').lowConfFrac.mean)}% of those were withheld. The small negative depth bias (about −0.4 mm) comes from the low-pass filter attenuating the peak.`));
add(figure('fig4_noise_accuracy.png', 5.6));
add(caption('Fig 4.', 'Measurement error against injected tracking noise (E1, controlled lab, 30 seeds per point, 95% bootstrap CI).'));
add(H2('Interruption detection and the version 1.0 defect (E2)'));
const a = e2c(e2, 'lab_noise1'), b = e2c(e2v10, 'lab_noise1');
add(P(`In version 1.1 all ${a.truePauses} true pauses at σ = 1 mm were detected with ${a.falsePauses} false pauses, and the measured interruption fraction matches the truth (mean ${f(a.interruptionFraction.measMean, 3)} vs ${f(a.interruptionFraction.trueMean, 3)}). Version 1.0 re-opened a pause in the same sample in which a compression ended it, producing ${b.detected} detections for ${b.truePauses} pauses and roughly doubling the interruption fraction (${f(b.interruptionFraction.measMean, 3)}). Fig 5 shows the per-run pairs. This comparison validates that the dataset can expose a single-line defect quantitatively.`));
add(figure('fig5_interruptions.png', 3.6));
add(caption('Fig 5.', 'Measured against true interruption fraction for each of 30 runs (E2, lab, σ = 1 mm). Version 1.1 lies on the identity line; version 1.0 over-counts.'));
add(H2('Feedback policies on identical inputs (E3)'));
add(P(`Because all policies receive exactly the same compressions, differences in Fig 6 are caused only by the policy. Static rules issue one cue per deficient compression (for example ${f(pol('shallow', 'static'))} per minute in the shallow scenario). Repeat suppression roughly halves this (${f(pol('shallow', 'adaptive'))} per minute) without lowering precision; the adaptive controller further lowers the load for excessive depth (${f(pol('deep', 'adaptive'))} vs ${f(pol('deep', 'static_rl'))} per minute for static rules with the same repeat limit) through personalised thresholds and baseline fading. In the occlusion scenario all policies cue at about ${f(pol('occlusion', 'adaptive'))} per minute although technique is correct, which quantifies how measurement artefacts propagate into feedback. In the onset protocol, every policy issued the first cue on the first deficient compression (median latency 0.41 to 0.56 s after the deficit appeared).`));
add(figure('fig6_feedback_load.png', 6.4));
add(caption('Fig 6.', 'Corrective cues per minute by scenario and policy (E3, mean of 30 seeds).'));
add(H2('Reproducibility and agreement with the manuscript'));
add(P(`All dataset tables were regenerated from the split repository code and compared with an independent run of the original single-file release: \`e1_cycles.csv\` and \`e3_runs.csv\` are byte-identical, and the summary statistics reproduce Tables 3 to 6 of the PULSEMR manuscript to the printed precision. Computational cost (E5) is the only machine-dependent output: the pipeline needed a median of ${f(e5.usPerSample.median)} µs per sample on a 2-core ${e5.cpu.replace(/\(R\)/g, '')} (Node.js ${e5.node}), far below the 33,333 µs available per 30 Hz sample; the manuscript reports 13.2 µs on its machine. Every summary file stores the SHA-256 of the code that produced it.`));

add(H1('Usage Notes'));
add(P(`The files are plain CSV and load directly in Python, R, MATLAB or a spreadsheet. A minimal example in Python with pandas:`));
add(...code([
  'import pandas as pd',
  's = pd.read_csv("dataset/sessions/shallow/samples.csv")',
  'c = pd.read_csv("dataset/sessions/shallow/compressions.csv")',
  'scored = c[c.low_confidence == 0]',
  'print((scored.depth_mm - scored.true_depth_mm).abs().mean())  # depth error, mm',
  'fb = pd.read_csv("dataset/sessions/mixed/feedback.csv")',
  'print(fb[fb.confirmation == 0].groupby(["controller", "metric"]).size())'
]));
add(P(`Suggested uses:`));
add(bullet('**Teaching.** Recompute depth, rate and recoil from `filt_z_mm` with your own peak detector and compare against `compressions.csv` and the truth columns.'));
add(bullet('**Filter and detector benchmarking.** Feed `raw_*` columns into an alternative filter and score it against `true_*`; E1 gives reference errors at seven noise levels.'));
add(bullet('**Feedback-policy design.** Replay `compressions.csv` through a new controller and compare cue load, precision and coverage with the adaptive and static decisions in `feedback.csv` and `e3_runs.csv`.'));
add(bullet('**Robustness.** Use the occlusion session and the E1 environment conditions to study how missing data turn into false cues.'));
add(bullet('**More data.** Change `SEED` or `SECONDS` in `harness/export_sessions.js`, or add a scenario in `js/01-core.js`, to generate further sessions with the same format.'));
add(H2('Limitations'));
add(P(`The data are synthetic. Compressions follow an idealised raised-cosine shape with Gaussian variability, the tracking errors are modelled rather than measured on a headset, and the trainee does not react to feedback (the optional learner model is off in all exports). The thresholds for recoil and low confidence are demonstration values. The dataset therefore tests whether an algorithm behaves correctly under known conditions; it does not show how real rescuers perform or respond to cues, and it must not be used to make clinical claims. The 24-participant results shown in the PULSEMR interface are fixed values reported in the manuscript and are not part of this dataset.`));

add(H1('Code Availability'));
add(P(`The generator, harness, figure scripts and the PULSEMR browser application are in the same repository as the dataset (\`js/\`, \`harness/\`, \`docs/paper/\`). The application uses three.js r147 (MIT licence) for rendering; the simulation layer and the harness have no third-party dependencies and run on Node.js 18 or later.`));

add(H1('References'));
[
  'Panchal AR, Bartos JA, Cabañas JG, Donnino MW, Drennan IR, Hirsch KG, et al. Part 3: Adult Basic and Advanced Life Support: 2020 American Heart Association Guidelines for Cardiopulmonary Resuscitation and Emergency Cardiovascular Care. Circulation. 2020;142(16 Suppl 2):S366–S468.',
  'Olasveengen TM, Semeraro F, Ristagno G, Castren M, Handley A, Kuzovlev A, et al. European Resuscitation Council Guidelines 2021: Basic Life Support. Resuscitation. 2021;161:98–114.',
  'Wilkinson MD, Dumontier M, Aalbersberg IJ, Appleton G, Axton M, Baak A, et al. The FAIR Guiding Principles for scientific data management and stewardship. Sci Data. 2016;3:160018.',
  'Cohen J. A coefficient of agreement for nominal scales. Educ Psychol Meas. 1960;20(1):37–46.',
  'Efron B, Tibshirani RJ. An Introduction to the Bootstrap. New York: Chapman & Hall; 1993.'
].forEach((r, i) => add(new Paragraph({ spacing: { after: 80, line: 264 }, indent: { left: 360, hanging: 360 }, children: [new TextRun({ text: `${i + 1}.\t${r}`, size: 18 })], tabStops: [{ type: TabStopType.LEFT, position: 360 }] })));

const doc = new Document({
  creator: 'Irish Singh', title: 'PULSEMR-SIM dataset descriptor',
  styles: {
    default: { document: { run: { font: FONT, size: 21 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 28, bold: true, font: FONT, color: '0B0B0B' }, paragraph: { spacing: { before: 320, after: 120 }, keepNext: true, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 23, bold: true, font: FONT, color: '1C5CAB' }, paragraph: { spacing: { before: 220, after: 100 }, keepNext: true, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 21, bold: true, font: FONT }, paragraph: { spacing: { before: 160, after: 80 }, keepNext: true, outlineLevel: 2 } }
    ]
  },
  numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] }] },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'PULSEMR-SIM data descriptor · synthetic data, not for clinical use · ', size: 16, color: '8A8984' }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '8A8984' })] })] }) },
    children
  }]
});
const out = path.join(__dirname, 'PULSEMR-SIM_dataset_paper.docx');
Packer.toBuffer(doc).then(b => { fs.writeFileSync(out, b); console.log('wrote', out); });
