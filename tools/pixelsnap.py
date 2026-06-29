#!/usr/bin/env python3
"""Pixel-snap an AI-generated image into crisp, true pixel art.

AI image models (gpt-image-1, Flux, etc.) make art that LOOKS pixel-ish but
isn't grid-aligned — soft edges, anti-aliasing, hundreds of near-duplicate
colours. This snaps it to a perfect grid + a small quantized palette, the same
idea as Hugo-Dz/spritefusion-pixel-snapper (a Rust CLI). Ported to Python so it
drops into our existing asset tools (genimg.py / gen_shop3d.py) — no Rust needed.

Pipeline (mirrors the snapper algorithm):
  1. (optional) key a solid green/magenta screen out to alpha
  2. estimate the cell pitch per axis from edge-gradient peak spacing (autocorr),
     or take --pixel-size
  3. box-downsample to the recovered logical resolution (W/pitch x H/pitch)
  4. K-means quantize the small image to `colors` palette entries
  5. (optional) nearest-neighbour upscale for display/use

Usage:
  py tools/pixelsnap.py in.png out.png [colors] [--pixel-size N] [--upscale N]
     [--size N] [--key green|magenta] [--alpha-thresh 128]
  py tools/pixelsnap.py in_dir/ out_dir/ 16 --pixel-size 8   # batch a folder

THE PIXEL-ASSET WORKFLOW (for future sprites):
  1. genimg.py with a "clean source character for a pixel sprite pipeline"
     prompt on a solid green background, 1024x1024 (16/32-bit JRPG style targets).
  2. pixelsnap.py to snap it to true pixel art (e.g. 48-64px logical), keying the
     green to alpha.
  3. drop the PNG into public/sprites and use it as a billboard.
  `genimg.py --snap` runs steps 1-2 in one shot.
"""
import argparse, sys
from pathlib import Path
import numpy as np
from PIL import Image
from sklearn.cluster import KMeans

KEYS = {"green": (0, 255, 0), "magenta": (255, 0, 255), "blue": (0, 0, 255), "auto": None}


def detect_bg(img: Image.Image) -> tuple:
    """Background colour = median of the four corner patches (subject rarely
    occupies corners). Robust to whatever shade the image model actually used."""
    a = np.asarray(img.convert("RGB"))
    h, w = a.shape[:2]; s = max(4, min(h, w) // 16)
    patches = np.concatenate([
        a[:s, :s].reshape(-1, 3), a[:s, -s:].reshape(-1, 3),
        a[-s:, :s].reshape(-1, 3), a[-s:, -s:].reshape(-1, 3),
    ])
    return tuple(int(v) for v in np.median(patches, axis=0))


def key_screen(img: Image.Image, rgb, hue_tol=22, sat_min=70, val_min=40) -> Image.Image:
    """Hue-based chroma key: drop only SATURATED pixels matching the background
    hue. This removes a green/magenta screen while keeping a desaturated (grey)
    subject — RGB-distance keying wrongly eats grey subjects near green."""
    rgba = np.asarray(img.convert("RGBA"))
    hsv = np.asarray(img.convert("HSV")).astype(np.int16)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    bg = np.asarray(Image.new("RGB", (1, 1), tuple(rgb)).convert("HSV"))[0, 0].astype(np.int16)
    dh = np.abs(h - bg[0]); dh = np.minimum(dh, 256 - dh)
    mask = (dh < hue_tol) & (s > sat_min) & (v > val_min)
    out = rgba.copy()
    out[mask, 3] = 0
    return Image.fromarray(out)


def detect_pitch(rgb: np.ndarray) -> tuple[int, int]:
    """Edge-gradient autocorrelation → dominant cell size per axis."""
    f = rgb.astype(np.float32)
    gx = np.abs(np.diff(f, axis=1)).sum(axis=(0, 2))   # vertical grid lines
    gy = np.abs(np.diff(f, axis=0)).sum(axis=(1, 2))   # horizontal grid lines

    def best_lag(prof: np.ndarray) -> int:
        p = prof - prof.mean()
        hi = max(3, len(p) // 3)
        best, bestv = 4, -1.0
        for lag in range(2, hi):
            v = float(np.dot(p[:-lag], p[lag:]))
            if v > bestv:
                bestv, best = v, lag
        return best

    return best_lag(gx), best_lag(gy)


def snap_image(src: Path, out: Path, colors: int = 16, pixel_size: int | None = None,
               upscale: int = 1, size: int | None = None, key: str | None = None,
               alpha_thresh: int = 128, fill_holes: bool = True) -> tuple[int, int]:
    img = Image.open(src).convert("RGBA")
    if key:
        rgb = detect_bg(img) if key == "auto" else KEYS[key]
        img = key_screen(img, rgb)
    W, H = img.size
    rgb = np.asarray(img.convert("RGB"))

    if size:                                  # explicit logical resolution wins
        out_w = out_h = size
    else:
        if pixel_size:
            px = py = pixel_size
        else:
            px, py = detect_pitch(rgb)
        out_w = max(1, round(W / px))
        out_h = max(1, round(H / py))

    # box-downsample (averages each cell) — RGB + alpha separately
    small = img.resize((out_w, out_h), Image.BOX)
    arr = np.asarray(small).astype(np.float32)
    flat = arr[:, :, :3].reshape(-1, 3)

    # K-means palette quantize
    k = min(colors, max(2, len(np.unique(flat, axis=0))))
    km = KMeans(n_clusters=k, n_init=4, random_state=0).fit(flat)
    pal = km.cluster_centers_.astype(np.uint8)
    quant = pal[km.labels_].reshape(out_h, out_w, 3)

    alpha = (arr[:, :, 3] >= alpha_thresh).astype(np.uint8) * 255
    if fill_holes:
        # close interior transparent holes the chroma key punched in the body
        # (they keep their quantized colour underneath — just make them opaque)
        from scipy import ndimage
        m = alpha > 0
        filled = ndimage.binary_fill_holes(m)
        alpha[filled & ~m] = 255
    final = np.dstack([quant, alpha]).astype(np.uint8)
    res = Image.fromarray(final)

    scale = max(1, upscale)
    if scale > 1:
        res = res.resize((out_w * scale, out_h * scale), Image.NEAREST)
    out.parent.mkdir(parents=True, exist_ok=True)
    res.save(out)
    return out_w, out_h


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("colors", nargs="?", type=int, default=16)
    ap.add_argument("--pixel-size", type=int, default=None, help="override auto grid size")
    ap.add_argument("--size", type=int, default=None, help="force output logical resolution (NxN)")
    ap.add_argument("--upscale", type=int, default=1, help="nearest-neighbour upscale factor")
    ap.add_argument("--key", choices=list(KEYS), default=None, help="chroma-key this screen colour to alpha")
    ap.add_argument("--alpha-thresh", type=int, default=128)
    ap.add_argument("--no-fill", action="store_true", help="don't fill interior chroma-key holes")
    args = ap.parse_args()

    inp, outp = Path(args.input), Path(args.output)
    if inp.is_dir():
        outp.mkdir(parents=True, exist_ok=True)
        for f in sorted(inp.iterdir()):
            if f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"):
                w, h = snap_image(f, outp / (f.stem + ".png"), args.colors, args.pixel_size,
                                  args.upscale, args.size, args.key, args.alpha_thresh, not args.no_fill)
                print(f"{f.name} -> {w}x{h}")
    else:
        w, h = snap_image(inp, outp, args.colors, args.pixel_size, args.upscale, args.size, args.key, args.alpha_thresh, not args.no_fill)
        print(f"snapped -> {outp}  ({w}x{h} logical, x{args.upscale})")


if __name__ == "__main__":
    main()
