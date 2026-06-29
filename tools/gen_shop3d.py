#!/usr/bin/env python3
"""Generate a 3D shop-building asset (GLB) for the overworld via PiAPI Trellis.

Pipeline:
  1. gpt-image-1 makes a clean 3/4 isometric pixel-art cyber-shop image
     (the user asked for Pixal3D / "pixa3d"; that model is still "coming soon"
      on PiAPI, so we use the available image-to-3D model, Trellis).
  2. flatten onto a plain background, resize < 1024 (Trellis requirement).
  3. upload to a public host, submit Trellis image-to-3d, poll, download GLB.

Usage:
  py tools/gen_shop3d.py --out public/models/shop.glb \
     --prompt "isometric pixel-art cyberpunk data-shop kiosk ..."
  # --image assets/raw/shop_seed.png  : skip gpt-image, use an existing seed
"""
import argparse, json, subprocess, sys, time
from pathlib import Path
from PIL import Image
import requests
sys.path.insert(0, str(Path(__file__).parent))
from seedance import load_key, upload, poll, API

DEFAULT_PROMPT = (
    "A single 3/4 isometric pixel-art building: a small futuristic cyberpunk "
    "data-shop kiosk / storefront made of dark navy panels with bright neon-cyan "
    "and magenta trim, a glowing holographic doorway, a blank sign panel above the "
    "door, rooftop antennae and data-cables, clean voxel/pixel-art style. The "
    "building is centered, fully in frame, standing on nothing, on a plain flat "
    "light-grey background. No ground, no shadow, no text, no people. Crisp pixel art."
)

def gen_image(prompt: str, seed_png: Path):
    seed_png.parent.mkdir(parents=True, exist_ok=True)
    cmd = [sys.executable, str(Path(__file__).parent / "genimg.py"),
           "--prompt", prompt, "--out", str(seed_png),
           "--size", "1024x1024", "--bg", "opaque", "--quality", "high"]
    print("GENIMG", " ".join(cmd[2:]))
    subprocess.run(cmd, check=True)

def prep(seed_png: Path) -> Path:
    """Flatten to RGB on light grey, resize to 896 (< 1024 for Trellis)."""
    img = Image.open(seed_png).convert("RGBA")
    bg = Image.new("RGBA", img.size, (220, 224, 230, 255))
    bg.alpha_composite(img)
    bg = bg.convert("RGB").resize((896, 896), Image.LANCZOS)
    out = seed_png.with_name(seed_png.stem + "_trellis.png")
    bg.save(out)
    return out

def submit_trellis(key: str, image_url: str) -> str:
    body = {"model": "Qubico/trellis", "task_type": "image-to-3d", "input": {
        "images": [image_url],
        "ss_sampling_steps": 50, "slat_sampling_steps": 50,
        "ss_guidance_strength": 7.5, "slat_guidance_strength": 3.0, "seed": 0}}
    r = requests.post(API, headers={"X-API-Key": key, "Content-Type": "application/json"},
                      data=json.dumps(body), timeout=120)
    print("SUBMIT", r.status_code, r.text[:400]); r.raise_for_status()
    d = r.json().get("data", {})
    tid = d.get("task_id") or d.get("id")
    if not tid: sys.exit("no task_id")
    return tid

def find_glb(data: dict) -> str:
    """Scan the output for a .glb URL (field names vary)."""
    blob = json.dumps(data)
    out = data.get("output") or {}
    for k in ("model_file", "model", "glb", "mesh", "url", "no_background_glb"):
        v = out.get(k)
        if isinstance(v, str) and v.lower().split("?")[0].endswith(".glb"):
            return v
    # brute-force: any https...glb in the payload
    import re
    m = re.findall(r'https?://[^\s"\\]+\.glb', blob)
    if m: return m[0]
    print("FULL OUTPUT:", blob[:1200])
    sys.exit("no .glb url in output")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--prompt", default=DEFAULT_PROMPT)
    ap.add_argument("--image")
    args = ap.parse_args()

    seed = Path(args.image) if args.image else Path("assets/raw") / (Path(args.out).stem + "_seed.png")
    if not args.image:
        gen_image(args.prompt, seed)
    flat = prep(seed)
    print("prepped", flat)

    url = None
    for host in ("uguu", "catbox", "0x0", "tmpfiles"):
        try: url = upload(flat, host); print(host, url); break
        except Exception as e: print(host, "failed", e)
    if not url: sys.exit("upload failed")

    key = load_key()
    tid = submit_trellis(key, url)
    print("task", tid)
    data = poll(key, tid, timeout_s=900)
    glb = find_glb(data); print("glb", glb)
    out = Path(args.out); out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(requests.get(glb, timeout=600).content)
    print("saved", out, out.stat().st_size, "bytes")

if __name__ == "__main__":
    main()
