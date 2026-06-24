#!/usr/bin/env python3
"""Clean up the Seedance-baked enemy animation strips:
  1. Erase the gray floor-shadow blob baked under/around the legs (low-saturation
     midtone pixels in the bottom band — keeps bright shoes and dark outlines).
  2. Kill the Seedance "zoom drift" that makes idles grow across the loop:
     normalize each frame's silhouette to the median height and plant the feet on
     a fixed baseline, while preserving horizontal motion (sway / lunge).

Always processes from the pristine backups in assets/raw/anim_src so re-runs are
idempotent. Pass 'preview' to write side-by-side montages to tools/_fix/ instead
of overwriting the served sheets.
"""
import os, sys, statistics
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRCDIR = os.path.join(ROOT, 'assets', 'raw', 'anim_src')
OUTDIR = os.path.join(ROOT, 'public', 'sprites')
PREVIEW = len(sys.argv) > 1 and sys.argv[1] == 'preview'
PREVDIR = os.path.join(ROOT, 'tools', '_fix')
if PREVIEW:
    os.makedirs(PREVDIR, exist_ok=True)

ENEMIES = ['tralalero', 'tungtung', 'angler', 'ballerina', 'bombardiro',
           'crab', 'hallucination', 'daemon', 'trainer', 'crawler']
KINDS = ['idle', 'attack']

BAND = 0.26        # bottom fraction of the bbox scanned for shadow
SAT_MAX = 0.16     # shadow is desaturated
V_LO, V_HI = 60, 200  # ... and a midtone (not a bright shoe, not a dark outline)
SCALE_CLAMP = (0.7, 1.4)


def erase_shadow(cell):
    """Remove the gray floor shadow from the bottom band of one frame."""
    bb = cell.getbbox()
    if not bb:
        return cell
    W, H = cell.size
    px = cell.load()
    y_start = int(bb[3] - (bb[3] - bb[1]) * BAND)
    for y in range(max(0, y_start), bb[3]):
        for x in range(bb[0], bb[2]):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            mx, mn = max(r, g, b), min(r, g, b)
            v = mx
            sat = (mx - mn) / mx if mx else 0
            if sat < SAT_MAX and V_LO <= v <= V_HI:
                px[x, y] = (r, g, b, 0)
    return cell


def process(name):
    src = os.path.join(SRCDIR, f'anim_{name}.png')
    im = Image.open(src).convert('RGBA')
    H = im.height
    n = im.width // H
    # pass 1: de-shadow every frame, collect cleaned geometry
    cells, boxes = [], []
    for i in range(n):
        c = erase_shadow(im.crop((i * H, 0, (i + 1) * H, H)).copy())
        cells.append(c)
        boxes.append(c.getbbox())
    heights = [b[3] - b[1] for b in boxes if b]
    foots = [b[3] for b in boxes if b]
    target_h = statistics.median(heights)
    baseline = int(statistics.median(foots))

    out = Image.new('RGBA', (H * n, H), (0, 0, 0, 0))
    for i, (c, bb) in enumerate(zip(cells, boxes)):
        if not bb:
            continue
        bw, bh = bb[2] - bb[0], bb[3] - bb[1]
        cx = (bb[0] + bb[2]) / 2
        s = target_h / bh
        s = max(SCALE_CLAMP[0], min(SCALE_CLAMP[1], s))     # guard bad bboxes
        body = c.crop(bb).resize((max(1, round(bw * s)), max(1, round(bh * s))), Image.LANCZOS)
        px_x = i * H + round(cx - body.width / 2)            # cell offset + keep horizontal pos
        px_y = round(baseline - body.height)                # plant feet on the baseline
        out.alpha_composite(body, (px_x, px_y))
    return im, out


def montage(orig, fixed, name):
    H = fixed.height
    bg = Image.new('RGBA', (fixed.width, H * 2 + 8), (45, 45, 60, 255))
    bg.alpha_composite(orig, (0, 0))
    bg.alpha_composite(fixed, (0, H + 8))
    sc = min(1.0, 1500 / bg.width)
    bg = bg.resize((int(bg.width * sc), int(bg.height * sc)))
    bg.save(os.path.join(PREVDIR, f'{name}.png'))


for name in ENEMIES:
    for kind in KINDS:
        key = f'{name}_{kind}'
        if not os.path.exists(os.path.join(SRCDIR, f'anim_{key}.png')):
            continue
        orig, fixed = process(key)
        if PREVIEW:
            montage(orig, fixed, key)
            print('preview', key)
        else:
            fixed.save(os.path.join(OUTDIR, f'anim_{key}.png'))
            print('wrote', key)
print('done', 'PREVIEW' if PREVIEW else 'APPLIED')
