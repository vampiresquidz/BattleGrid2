#!/usr/bin/env python3
"""Turn a Seedance chroma-keyed video back into transparent sprite frames.

Steps: ffmpeg extracts N evenly-spaced frames and colour-keys the chroma to
alpha; PIL then crops every frame to the shared content bbox, shrinks to a
pixel-art height (NEAREST), and packs a horizontal sprite sheet plus a
checkerboard preview so we can judge the keying honestly.

Usage:
  py tools/vid2frames.py --in tools/seed_goblin_idle.mp4 --frames 8 \
     --height 200 --sheet public/sprites/anim_goblin_idle.png
  # chroma colour is read from <in>.chroma.txt unless --chroma "0,0,255" given
"""
import argparse, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--frames", type=int, default=8)
    ap.add_argument("--height", type=int, default=200)
    ap.add_argument("--chroma")
    ap.add_argument("--similarity", default="0.26")
    ap.add_argument("--blend", default="0.08")
    ap.add_argument("--sheet", required=True)
    ap.add_argument("--duration", type=float, default=4.0)
    ap.add_argument("--deshadow", action="store_true",
                    help="erase the grayish ground-shadow blot in the bottom band")
    args = ap.parse_args()

    inp = Path(args.inp)
    if args.chroma:
        r, g, b = (int(x) for x in args.chroma.split(","))
    else:
        txt = inp.with_suffix(".chroma.txt")
        r, g, b = (int(x) for x in txt.read_text().split(","))
    hexkey = f"0x{r:02X}{g:02X}{b:02X}"
    print(f"chroma {hexkey}  sim={args.similarity} blend={args.blend}")

    tmp = Path(tempfile.mkdtemp())
    fps = args.frames / args.duration
    vf = f"fps={fps},colorkey={hexkey}:{args.similarity}:{args.blend},format=rgba"
    cmd = ["ffmpeg", "-y", "-i", str(inp), "-vf", vf, str(tmp / "f_%03d.png")]
    subprocess.run(cmd, check=True, capture_output=True)
    frames = sorted(tmp.glob("f_*.png"))[: args.frames]
    if not frames:
        sys.exit("no frames extracted")
    print(f"{len(frames)} frames extracted")

    imgs = [Image.open(f).convert("RGBA") for f in frames]

    if args.deshadow:
        # The baked ground-shadow keys to a grey blob at the feet. Erase low-
        # saturation grey pixels in the bottom band (boots are saturated brown
        # and survive; the dark visor is up high, outside the band).
        for im in imgs:
            px = im.load(); w, h = im.size
            band = int(h * 0.82)
            for y in range(band, h):
                for x in range(w):
                    r, g, b, a = px[x, y]
                    if a == 0:
                        continue
                    mx, mn = max(r, g, b), min(r, g, b)
                    sat = (mx - mn) / mx if mx else 0
                    if sat < 0.22 and 36 < mx < 215:
                        px[x, y] = (r, g, b, 0)

    # shared content bbox across all frames (so the character doesn't jitter)
    box = None
    for im in imgs:
        b2 = im.getbbox()
        if b2 is None:
            continue
        box = b2 if box is None else (min(box[0], b2[0]), min(box[1], b2[1]),
                                      max(box[2], b2[2]), max(box[3], b2[3]))
    if box is None:
        sys.exit("all frames empty after key — chroma/similarity is wrong")
    imgs = [im.crop(box) for im in imgs]

    # scale to a pixel-art height, NEAREST to re-crisp
    h = args.height
    scaled = []
    for im in imgs:
        w = max(1, round(im.width * h / im.height))
        scaled.append(im.resize((w, h), Image.NEAREST))
    fw = max(im.width for im in scaled)

    # square cells so the strip matches the game's square billboard sprites
    cell = max(fw, h)
    sheet = Image.new("RGBA", (cell * len(scaled), cell), (0, 0, 0, 0))
    for i, im in enumerate(scaled):
        sheet.alpha_composite(im, (i * cell + (cell - im.width)//2, (cell - im.height)//2))
    Path(args.sheet).parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.sheet)
    print(f"sheet {args.sheet}  {len(scaled)} frames @ {fw}x{h}")

    # checkerboard preview to judge keying
    prev = Image.new("RGB", sheet.size, (200, 200, 200))
    cs = 12
    for yy in range(0, sheet.height, cs):
        for xx in range(0, sheet.width, cs):
            if (xx//cs + yy//cs) % 2:
                for py in range(yy, min(yy+cs, sheet.height)):
                    for px in range(xx, min(xx+cs, sheet.width)):
                        prev.putpixel((px, py), (150, 150, 150))
    prev = prev.convert("RGBA")
    prev.alpha_composite(sheet)
    prevpath = Path(args.sheet).with_name(Path(args.sheet).stem + "_preview.png")
    prev.convert("RGB").save(prevpath)
    print(f"preview {prevpath}")

if __name__ == "__main__":
    main()
