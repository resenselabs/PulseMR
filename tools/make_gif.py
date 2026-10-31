#!/usr/bin/env python3
"""Builds docs/screenshots/demo.gif from the frames written by tools/screenshots.js.
Usage: python3 tools/make_gif.py        (needs Pillow: pip install pillow)"""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
frames_dir = root / "docs" / "screenshots" / "demo-frames"
files = sorted(frames_dir.glob("frame-*.png"))
if not files:
    raise SystemExit("No frames found. Run `npm run screenshots` first.")

frames = []
for f in files:
    im = Image.open(f).convert("RGB")
    im.thumbnail((880, 880))
    frames.append(im)

# one shared palette keeps the GIF small and stops colours flickering between frames
palette_src = frames[len(frames) // 2].quantize(colors=128, method=Image.Quantize.MEDIANCUT)
quantized = [im.quantize(palette=palette_src, dither=Image.Dither.NONE) for im in frames]
out = root / "docs" / "screenshots" / "demo.gif"
quantized[0].save(out, save_all=True, append_images=quantized[1:], duration=125, loop=0, optimize=True)
print(f"wrote {out} ({out.stat().st_size / 1e6:.1f} MB, {len(quantized)} frames)")
