#!/usr/bin/env python3
"""Generate a MODULAR 3D pixel character — our own take on the AssetHub →
Blender → AccuRig → Unreal modular pipeline, adapted to this repo's stack
(no Blender/Unreal). For a character concept we:

  1. PART DECOMPOSITION  — a fixed set of slots (body, head, arms, legs, weapon…)
  2. per-part GENERATION  — gpt-image-1 pixel-art of each part + VARIATIONS,
     all sharing one style preamble so they read as one character
  3. pixelsnap           — crisp transparent pixel-art (hue chroma key)
  4. Trellis image-to-3D — each part → a .glb  (skip with --no-3d for 2D layers)
  5. MANIFEST            — public/models/parts/<char>/manifest.json with each
     slot's variants + a default mount ANCHOR + target height, so the Three.js
     assembler (tools/modular_viewer.html / src use) can mount + swap slots.

The Blender "align each part to the body" step becomes per-slot anchor offsets
here (chunky pixel parts tolerate fixed anchors); tune them in the manifest.

Usage:
  py tools/gen_modular_char.py --char ronin            # full set, 3D
  py tools/gen_modular_char.py --char ronin --no-3d    # part images only (fast)
  py tools/gen_modular_char.py --char ronin --slots body,head,weapon
"""
import argparse, json, sys
from pathlib import Path
import requests
sys.path.insert(0, str(Path(__file__).parent))
from seedance import load_key, upload, poll, API
from gen_shop3d import submit_trellis, find_glb, prep, gen_image

STYLE = ("HD-2D cyberpunk pixel art, neon-noir Blade Runner palette, glowing "
         "emissive accents in pink/cyan/violet (NO green), crisp chunky pixel "
         "shading, bold dark outlines. SINGLE isolated part, centered and fully "
         "in frame, on a solid flat bright GREEN chroma background. No body, no "
         "ground, no shadow, no text, no people.")

# A character SPEC = the part decomposition. Each slot has a default mount anchor
# [x,y,z] (in a ~2.2-unit-tall character) + target height, and N variant prompts.
CHARS = {
    "ronin": {
        "desc": "a lean cyberpunk street-samurai netrunner",
        "slots": {
            "body":   {"anchor": [0, 0, 0],     "h": 2.2, "variants": {
                "base": "the full BODY of {d}: torso, arms and legs in a slim dark armored bodysuit with cyan circuit lines, NO head, T-pose, front view"}},
            "head":   {"anchor": [0, 1.95, 0],  "h": 0.62, "variants": {
                "visor":  "just the HEAD of {d}: a sleek helmet with a glowing cyan visor and antenna, front view",
                "hood":   "just the HEAD of {d}: a tactical hood with a glowing pink half-mask over the face, front view"}},
            "weapon": {"anchor": [0.55, 1.0, 0.15], "h": 1.4, "variants": {
                "katana": "a glowing mono-katana SWORD, cyan energy blade, dark wrapped hilt, held vertical",
                "baton":  "a cyberpunk stun-BATON, violet energy tip, dark grip, held vertical"}},
        },
    },
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--char", default="ronin")
    ap.add_argument("--slots", help="comma list to limit (e.g. body,head,weapon)")
    ap.add_argument("--no-3d", action="store_true", help="stop at the pixel-art PNG (2D layers)")
    args = ap.parse_args()

    spec = CHARS.get(args.char)
    if not spec: sys.exit(f"unknown char '{args.char}' (have: {', '.join(CHARS)})")
    only = set(args.slots.split(",")) if args.slots else None
    raw = Path("assets/raw/parts") / args.char
    outdir = Path("public/models/parts") / args.char
    raw.mkdir(parents=True, exist_ok=True); outdir.mkdir(parents=True, exist_ok=True)
    key = load_key()
    manifest = {"char": args.char, "desc": spec["desc"], "slots": {}}

    for slot, sd in spec["slots"].items():
        if only and slot not in only: continue
        manifest["slots"][slot] = {"anchor": sd["anchor"], "h": sd["h"], "variants": []}
        for variant, vp in sd["variants"].items():
            stem = f"{slot}_{variant}"
            prompt = vp.format(d=spec["desc"]) + ". " + STYLE
            print(f"\n=== {args.char}/{stem} ===")
            seed = raw / f"{stem}.png"
            gen_image(prompt, seed)
            png = outdir / f"{stem}.png"
            # crisp transparent pixel-art part (snap module is importable too)
            import pixelsnap
            pixelsnap.snap_image(seed, png, colors=28, size=112, upscale=5, key="auto")
            entry = {"variant": variant, "png": f"/models/parts/{args.char}/{png.name}"}
            if not args.no_3d:
                flat = prep(seed)
                url = None
                for host in ("uguu", "catbox", "0x0"):
                    try: url = upload(flat, host); break
                    except Exception as e: print(host, "failed", e)
                if url:
                    tid = submit_trellis(key, url)
                    data = poll(key, tid, timeout_s=900)
                    glb = find_glb(data)
                    glbp = outdir / f"{stem}.glb"
                    glbp.write_bytes(requests.get(glb, timeout=600).content)
                    entry["glb"] = f"/models/parts/{args.char}/{glbp.name}"
                    print("glb", glbp, glbp.stat().st_size)
            manifest["slots"][slot]["variants"].append(entry)

    (outdir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print("\nmanifest ->", outdir / "manifest.json")


if __name__ == "__main__":
    main()
