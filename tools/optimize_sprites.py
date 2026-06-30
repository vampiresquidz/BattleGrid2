#!/usr/bin/env python3
"""Shrink the sprite PNGs for fast loading on the (no-CDN) host.

The art was saved at full gpt-image resolution (1-3 MB each) but the game
pixelates every sprite to a ~128px grid at runtime, so that detail is wasted
bytes. We downscale to a sane cap and reduce the colour count while KEEPING the
soft alpha (quantize RGB, reattach the original alpha), then re-encode optimized.

  singles  -> max dimension 512
  strips   -> (walk/ , battle/ , anim_*) horizontal N-cell strips: cap HEIGHT 192
  skip     -> files already small (<70 KB), e.g. the pixelsnap'd rats/goblin

Idempotent-ish: re-running on already-small files is a no-op (skipped).
"""
import os, sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SPR = ROOT / 'public' / 'sprites'
SINGLE_MAX = 512
STRIP_H = 192
COLORS = 128
SKIP_UNDER = 70 * 1024

def is_strip(p: Path) -> bool:
    s = str(p).replace('\\', '/')
    return '/walk/' in s or '/battle/' in s or p.name.startswith('anim_')

def shrink(p: Path) -> tuple[int, int]:
    before = p.stat().st_size
    if before < SKIP_UNDER:
        return before, before
    im = Image.open(p).convert('RGBA')
    w, h = im.size
    if is_strip(p):
        if h > STRIP_H:
            nw = max(1, round(w * STRIP_H / h)); im = im.resize((nw, STRIP_H), Image.LANCZOS)
    else:
        m = max(w, h)
        if m > SINGLE_MAX:
            im = im.resize((max(1, round(w * SINGLE_MAX / m)), max(1, round(h * SINGLE_MAX / m))), Image.LANCZOS)
    # reduce colours but keep the soft alpha
    alpha = im.split()[3]
    rgb = im.convert('RGB').quantize(colors=COLORS, method=Image.FASTOCTREE).convert('RGB')
    out = Image.merge('RGBA', (*rgb.split(), alpha))
    out.save(p, optimize=True)
    return before, p.stat().st_size

def main():
    files = sorted(SPR.rglob('*.png'))
    tb = ta = 0; n = 0
    for f in files:
        b, a = shrink(f)
        tb += b; ta += a
        if a != b:
            n += 1
            print(f"{f.relative_to(SPR)}  {b//1024}KB -> {a//1024}KB")
    print(f"\noptimized {n}/{len(files)} files: {tb/1048576:.1f}MB -> {ta/1048576:.1f}MB")

if __name__ == '__main__':
    main()
