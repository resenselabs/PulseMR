#!/usr/bin/env python3
"""Draws the figures of the PULSEMR dataset paper from the files in dataset/.
Usage: python3 docs/paper/make_figures.py      (needs matplotlib)
Output: docs/paper/figures/fig1..fig6 (.png, 300 dpi)"""
import csv, json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

ROOT = Path(__file__).resolve().parents[2]
DS = ROOT / "dataset"
OUT = Path(__file__).resolve().parent / "figures"
OUT.mkdir(exist_ok=True)

# palette: categorical slots 1-3 and neutrals (validated, colour-blind safe as adjacent pairs)
BLUE, ORANGE, AQUA = "#2a78d6", "#eb6834", "#1baf7a"
INK, INK2, MUTED, GRID, BAND = "#0b0b0b", "#52514e", "#8a8984", "#e6e5e0", "#eef4fc"
SEQ = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"]

plt.rcParams.update({
    "font.family": ["Inter", "DejaVu Sans"], "font.size": 8.5, "axes.titlesize": 9.5, "axes.titleweight": "semibold",
    "axes.labelsize": 8.5, "axes.edgecolor": MUTED, "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2,
    "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6,
    "axes.axisbelow": True, "legend.frameon": False, "legend.fontsize": 8, "figure.dpi": 100, "savefig.dpi": 300,
    "axes.titlelocation": "left", "lines.linewidth": 1.6,
})

def rows(p):
    with open(p, newline="") as f:
        return list(csv.DictReader(f))

def num(v):
    return float(v) if v not in ("", None) else None

def save(fig, name):
    fig.savefig(OUT / name, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print("wrote", OUT / name)

# ---------- Fig 1: how the data are generated ----------
def fig1():
    fig, ax = plt.subplots(figsize=(7.4, 3.4))
    ax.set_axis_off(); ax.set_xlim(0, 100); ax.set_ylim(0, 44)
    stages = [
        ("Synthetic\nrescuer", "seeded segments:\ndepth, rate,\nhand offset,\nrecoil, pauses", "truth_segments.csv"),
        ("Tracking\nmodel", "30 Hz palm position\n+ noise, occlusion,\njitter; confidence", "samples.csv\n(true_*, raw_*)"),
        ("Signal\nprocessing", "Butterworth 5 Hz\nlow-pass; 5-sample\naverage on x, y", "samples.csv\n(filt_*)"),
        ("Assessment", "peak and trough\ndetection; depth,\nrate, position,\nrecoil, pauses", "compressions.csv\npauses.csv"),
        ("Feedback", "adaptive and static\ncontrollers judge\nthe same\ncompressions", "feedback.csv"),
    ]
    w, gap, y0, h = 17.6, 3.0, 12, 27
    for i, (title, body, files) in enumerate(stages):
        x = 0.5 + i * (w + gap)
        ax.add_patch(FancyBboxPatch((x, y0), w, h, boxstyle="round,pad=0,rounding_size=1.6", fc="#f6f6f4", ec=MUTED, lw=0.8))
        ax.text(x + w / 2, y0 + h - 4.4, title, ha="center", va="center", fontsize=8.2, linespacing=1.1, weight="semibold", color=INK)
        ax.text(x + w / 2, y0 + h / 2 - 4.2, body, ha="center", va="center", fontsize=6.7, color=INK2, linespacing=1.35)
        ax.text(x + w / 2, y0 - 6.4, files, ha="center", va="center", fontsize=6.5, color=BLUE, family="DejaVu Sans Mono", linespacing=1.3)
        ax.plot([x + w / 2, x + w / 2], [y0 - 0.2, y0 - 2.4], color=BLUE, lw=0.8)
        if i < len(stages) - 1:
            ax.annotate("", xy=(x + w + gap - 0.4, y0 + h / 2), xytext=(x + w + 0.4, y0 + h / 2),
                        arrowprops=dict(arrowstyle="-|>", color=INK2, lw=0.9, mutation_scale=8))
    ax.text(50, 42.5, "One simulation clock drives every stage; the harness runs it headless in Node and records each layer",
            ha="center", fontsize=7.4, color=INK2, style="italic")
    save(fig, "fig1_generation.png")

# ---------- Fig 2: what a session looks like ----------
def fig2():
    s = rows(DS / "sessions/shallow/samples.csv")
    c = rows(DS / "sessions/shallow/compressions.csv")
    t0, t1 = 40.0, 46.0
    seg = [r for r in s if t0 <= float(r["time_s"]) <= t1]
    t = [float(r["time_s"]) for r in seg]
    fig, axes = plt.subplots(2, 1, figsize=(7.2, 5.0), gridspec_kw={"height_ratios": [1.35, 1], "hspace": 0.85})
    ax = axes[0]
    ax.axhspan(50, 60, color=BAND, lw=0, zorder=0)
    ax.text(t1 - 0.02, 58.6, "guideline 50-60 mm", ha="right", va="top", fontsize=7, color=BLUE)
    ax.plot(t, [float(r["raw_z_mm"]) for r in seg], color=MUTED, lw=0.9, label="tracked (raw)")
    ax.plot(t, [float(r["true_z_mm"]) for r in seg], color=BLUE, lw=1.6, label="ground truth")
    ax.plot(t, [float(r["filt_z_mm"]) for r in seg], color=ORANGE, lw=1.6, label="filtered")
    pk = [r for r in c if t0 <= float(r["peak_s"]) <= t1]
    ax.scatter([float(r["peak_s"]) for r in pk], [float(r["depth_mm"]) for r in pk], s=22, color=ORANGE, ec="white", lw=1, zorder=5, label="detected peak")
    ax.set_ylabel("Compression depth (mm)"); ax.set_xlabel("Session time (s)")
    ax.set_title("a  Shallow-compression session: the same motion at three layers of the dataset")
    ax.set_xlim(t0, t1); ax.set_ylim(-8, 62)
    ax.legend(ncol=4, loc="upper left", bbox_to_anchor=(0, -0.3), fontsize=7.2, handlelength=1.6)

    s = rows(DS / "sessions/occlusion/samples.csv")
    c = rows(DS / "sessions/occlusion/compressions.csv")
    t0, t1 = 20.0, 60.0
    seg = [r for r in s if t0 <= float(r["time_s"]) <= t1]
    t = [float(r["time_s"]) for r in seg]
    ax = axes[1]
    occ = [r["occluded"] == "1" for r in seg]
    start = None
    for i, o in enumerate(occ + [False]):
        if o and start is None: start = t[i]
        if not o and start is not None:
            ax.axvspan(start, t[i - 1] + 1 / 30, color="#fbe1d6", lw=0, zorder=0); start = None
    ax.plot(t, [float(r["confidence"]) for r in seg], color=BLUE, lw=1.0, label="tracking confidence")
    wh = [r for r in c if t0 <= float(r["peak_s"]) <= t1 and r["low_confidence"] == "1"]
    ok = [r for r in c if t0 <= float(r["peak_s"]) <= t1 and r["low_confidence"] == "0"]
    ax.scatter([float(r["peak_s"]) for r in ok], [1.04] * len(ok), marker="|", s=40, color=AQUA, lw=1.2, label="compression scored")
    ax.scatter([float(r["peak_s"]) for r in wh], [1.04] * len(wh), marker="x", s=22, color=ORANGE, lw=1.3, label="withheld (low confidence)")
    ax.set_ylim(0.05, 1.1); ax.set_xlim(t0, t1)
    ax.set_ylabel("Confidence (0-1)"); ax.set_xlabel("Session time (s)")
    ax.set_title("b  Tracking-occlusion session: shaded = landmarks occluded, positions estimated")
    ax.legend(ncol=3, loc="lower left", fontsize=7.2, bbox_to_anchor=(0, -0.02))
    save(fig, "fig2_session_traces.png")

# ---------- Fig 3: scenario overview ----------
def fig3():
    idx = rows(DS / "sessions/index.csv")
    cols = [("depth_accuracy_pct", "Depth"), ("rate_accuracy_pct", "Rate"), ("hand_accuracy_pct", "Hand\nposition"),
            ("full_recoil_pct", "Full\nrecoil"), ("interruption_fraction", "Compression\nfraction"), ("session_gcs", "Session\nGCS")]
    data = []
    for r in idx:
        line = []
        for k, _ in cols:
            v = float(r[k])
            line.append(100 * (1 - v) if k == "interruption_fraction" else v)
        data.append(line)
    from matplotlib.colors import LinearSegmentedColormap
    cmap = LinearSegmentedColormap.from_list("seq", ["#ffffff"] + SEQ)
    fig, ax = plt.subplots(figsize=(6.4, 4.2))
    ax.grid(False)
    ax.imshow(data, cmap=cmap, vmin=0, vmax=100, aspect="auto")
    for i, line in enumerate(data):
        for j, v in enumerate(line):
            ax.text(j, i, f"{v:.0f}", ha="center", va="center", fontsize=7.6, color="white" if v > 62 else INK)
    ax.set_xticks(range(len(cols)), [l for _, l in cols], fontsize=7.6)
    ax.set_yticks(range(len(idx)), [r["name"] for r in idx], fontsize=7.8)
    ax.xaxis.tick_top(); ax.tick_params(length=0)
    for s in ax.spines.values(): s.set_visible(False)
    ax.axvline(4.5, color="white", lw=3)
    ax.set_title("Per-scenario session scores (%), seed 1, 120 s after calibration", pad=34)
    save(fig, "fig3_scenario_scores.png")

# ---------- Fig 4: measurement accuracy vs tracking noise ----------
def fig4():
    e1 = json.load(open(DS / "experiments/e1_summary.json"))
    cond = [c for c in e1["conditions"] if c["group"] == "noise"]
    x = [c["noise"] for c in cond]
    fig, ax = plt.subplots(figsize=(5.6, 3.2))
    for key, label, col, mk in [("depthMAE", "Depth MAE", BLUE, "o"), ("posErr", "Hand-position error", ORANGE, "s"), ("recoilMAE", "Recoil MAE", AQUA, "D")]:
        m = [c[key]["mean"] for c in cond]
        lo = [c[key]["ci95"][0] for c in cond]; hi = [c[key]["ci95"][1] for c in cond]
        ax.fill_between(x, lo, hi, color=col, alpha=0.15, lw=0)
        ax.plot(x, m, color=col, marker=mk, ms=4.5, mec="white", mew=0.8, label=label)
    ax.set_xlim(-0.3, 8.3)
    ax.set_xlabel("Simulated tracking noise σ (mm)"); ax.set_ylabel("Error (mm)")
    ax.set_title("Measurement error against injected tracking noise (E1; mean and 95% CI over 30 seeds)")
    ax.legend(loc="upper left")
    save(fig, "fig4_noise_accuracy.png")

# ---------- Fig 6: feedback load by policy ----------
def fig5():
    e3 = json.load(open(DS / "experiments/e3_summary.json"))
    order = ["shallow", "deep", "fast", "slow", "drift", "recoil", "pauses", "occlusion", "mixed"]
    names = {"shallow": "Shallow", "deep": "Too deep", "fast": "Fast", "slow": "Slow", "drift": "Hand drift", "recoil": "Recoil",
             "pauses": "Interrupt.", "occlusion": "Occlusion", "mixed": "Mixed"}
    pols = [("static", "Static rules", MUTED), ("static_rl", "Static + repeat limit", ORANGE), ("adaptive", "Adaptive", BLUE)]
    fig, ax = plt.subplots(figsize=(7.2, 3.1))
    w = 0.26
    for k, (pid, label, col) in enumerate(pols):
        v = [e3["scenarios"][s][pid]["cuesPerMin"]["mean"] for s in order]
        ax.bar([i + (k - 1) * (w + 0.02) for i in range(len(order))], v, width=w, color=col, label=label, linewidth=0)
    ax.set_xticks(range(len(order)), [names[s] for s in order])
    ax.set_ylabel("Cues per minute"); ax.grid(axis="x", visible=False)
    ax.set_title("Feedback cues per minute on identical compression streams (E3; mean of 30 seeds)")
    ax.legend(ncol=3, loc="upper right", bbox_to_anchor=(1, 1.02))
    ax.set_ylim(0, 160)
    save(fig, "fig6_feedback_load.png")

# ---------- Fig 5: interruption fraction, v1.0 versus v1.1 ----------
def fig6():
    v11 = json.load(open(DS / "experiments/e2_summary.json"))
    v10 = json.load(open(DS / "experiments/v1.0/e2_summary.json"))
    fig, ax = plt.subplots(figsize=(4.4, 3.8))
    for data, label, col, mk in [(v10, "v1.0", ORANGE, "s"), (v11, "v1.1", BLUE, "o")]:
        c = next(c for c in data["conditions"] if c["id"] == "lab_noise1")
        p = c["interruptionFraction"]["pairs"]
        ax.scatter([q["trueIF"] for q in p], [q["measIF"] for q in p], s=26, color=col, marker=mk, ec="white", lw=0.8, label=label, zorder=3)
    ax.plot([0, 0.5], [0, 0.5], color=MUTED, lw=0.9, ls="--", zorder=1)
    ax.text(0.24, 0.262, "identity", color=MUTED, fontsize=7, rotation=38)
    ax.set_xlim(0, 0.3); ax.set_ylim(0, 0.6)
    ax.set_xlabel("True interruption fraction"); ax.set_ylabel("Measured interruption fraction")
    ax.set_title("Interruption fraction per run (E2, lab, σ = 1 mm)")
    ax.legend(loc="upper left")
    save(fig, "fig5_interruptions.png")

for f in (fig1, fig2, fig3, fig4, fig5, fig6):
    f()
