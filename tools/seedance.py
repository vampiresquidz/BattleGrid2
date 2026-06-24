#!/usr/bin/env python3
"""Experimental Seedance animation pipeline for transparent pixel sprites.

Seedance (PiAPI) only takes PUBLIC image URLs and only outputs opaque video,
so to animate a transparent billboard sprite we:
  1. composite the sprite onto a solid chroma colour chosen to be as far as
     possible from the sprite's own palette (so keying won't eat the character),
  2. upload that frame(s) to a public host (catbox.moe, anonymous),
  3. submit a Seedance first_last_frames task (same frame twice = loopable idle;
     idle->attack = an attack tween) and poll until done,
  4. download the mp4.  (Keying back to alpha happens in tools/vid2frames.py.)

Usage:
  py tools/seedance.py --first assets/raw/meme_goblinmonkey.png \
     --prompt "subtle idle breathing, gentle sway, flat static background" \
     --out tools/seed_goblin_idle.mp4 --duration 4 --res 480p
  # add --last <png> for an idle->pose tween (attack)
  # --dry-host  : only composite + upload, print URLs, no PiAPI call (free)
"""
import argparse, json, sys, time, os
from pathlib import Path
from PIL import Image
import requests

API = "https://api.piapi.ai/api/v1/task"

def load_key() -> str:
    if os.environ.get("PIAPI_API_KEY"):
        return os.environ["PIAPI_API_KEY"]
    for p in [Path(".env.local"), Path(".env"), Path.home() / ".config" / "watch" / ".env"]:
        try:
            for line in p.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line.startswith("PIAPI_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
        except OSError:
            continue
    sys.exit("ERROR: PIAPI_API_KEY not found")

# Candidate chroma keys; we pick whichever is farthest from the sprite palette.
CHROMA = {
    "magenta": (255, 0, 255),
    "green":   (0, 255, 0),
    "blue":    (0, 0, 255),
    "cyan":    (0, 255, 255),
    "yellow":  (255, 255, 0),
    "red":     (255, 0, 0),
}

def pick_chroma(img: Image.Image) -> tuple:
    """Choose the chroma colour with the greatest minimum distance to any
    sufficiently-opaque sprite pixel — so the key never overlaps the art."""
    small = img.convert("RGBA").resize((64, 64))
    px = [p for p in small.getdata() if p[3] > 40]
    if not px:
        return "magenta", CHROMA["magenta"]
    best, best_d = "magenta", -1
    for name, (cr, cg, cb) in CHROMA.items():
        d = min((r-cr)**2 + (g-cg)**2 + (b-cb)**2 for r, g, b, _ in px)
        if d > best_d:
            best_d, best = d, name
    return best, CHROMA[best]

def composite(src: Path, chroma_rgb: tuple, size: int = 768) -> Path:
    """Centre the sprite on a square solid-chroma canvas (uniform bg keys clean)."""
    spr = Image.open(src).convert("RGBA")
    # scale to ~78% of the canvas, keeping aspect
    scale = (size * 0.78) / max(spr.width, spr.height)
    spr = spr.resize((max(1, int(spr.width*scale)), max(1, int(spr.height*scale))), Image.NEAREST)
    canvas = Image.new("RGBA", (size, size), chroma_rgb + (255,))
    canvas.alpha_composite(spr, ((size - spr.width)//2, (size - spr.height)//2))
    out = src.with_name(src.stem + "_chroma.png")
    canvas.convert("RGB").save(out)
    return out

UA = {"User-Agent": "Mozilla/5.0 (abyssal-grid asset uploader)"}

def upload(path: Path, host: str = "0x0") -> str:
    """Anonymous upload -> direct public image URL. Some hosts are blocked by
    PiAPI's image fetcher, so this supports a few interchangeable ones."""
    with open(path, "rb") as f:
        data = f.read()
    if host == "catbox":
        r = requests.post("https://catbox.moe/user/api.php",
                          data={"reqtype": "fileupload"},
                          files={"fileToUpload": (path.name, data, "image/png")}, timeout=120)
        r.raise_for_status(); url = r.text.strip()
    elif host == "0x0":
        r = requests.post("https://0x0.st", headers=UA,
                          files={"file": (path.name, data, "image/png")}, timeout=120)
        r.raise_for_status(); url = r.text.strip()
    elif host == "tmpfiles":
        r = requests.post("https://tmpfiles.org/api/v1/upload", headers=UA,
                          files={"file": (path.name, data, "image/png")}, timeout=120)
        r.raise_for_status()
        u = r.json()["data"]["url"]
        url = u.replace("tmpfiles.org/", "tmpfiles.org/dl/")
    elif host == "uguu":
        r = requests.post("https://uguu.se/upload?output=text", headers=UA,
                          files={"files[]": (path.name, data, "image/png")}, timeout=120)
        r.raise_for_status(); url = r.text.strip()
    else:
        sys.exit(f"unknown host {host}")
    if not url.startswith("http"):
        sys.exit(f"{host} upload failed: {url[:200]}")
    return url

def submit(key: str, image_urls: list, prompt: str, duration: int, res: str, task_type: str) -> str:
    body = {
        "model": "seedance",
        "task_type": task_type,
        "input": {
            "prompt": prompt,
            "mode": "first_last_frames",
            "image_urls": image_urls,
            "duration": duration,
            "aspect_ratio": "1:1",
            "resolution": res,
        },
    }
    r = requests.post(API, headers={"X-API-Key": key, "Content-Type": "application/json"},
                      data=json.dumps(body), timeout=120)
    print("SUBMIT", r.status_code, r.text[:500])
    r.raise_for_status()
    data = r.json().get("data", {})
    tid = data.get("task_id") or data.get("id")
    if not tid:
        sys.exit(f"no task_id in response: {r.text[:500]}")
    return tid

def poll(key: str, tid: str, timeout_s: int = 600) -> dict:
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        r = requests.get(f"{API}/{tid}", headers={"X-API-Key": key}, timeout=60)
        if r.status_code != 200:
            print("poll", r.status_code, r.text[:200]); time.sleep(6); continue
        data = r.json().get("data", {})
        status = (data.get("status") or "").lower()
        print(f"  [{int(time.time()-t0)}s] status={status}")
        if status in ("completed", "success"):
            return data
        if status in ("failed", "error"):
            sys.exit(f"task failed: {json.dumps(data)[:600]}")
        time.sleep(8)
    sys.exit("poll timeout")

def find_video(data: dict) -> str:
    out = data.get("output") or {}
    for k in ("video", "video_url", "url"):
        if isinstance(out.get(k), str):
            return out[k]
    works = out.get("works") or []
    if works and isinstance(works[0], dict):
        v = works[0].get("video") or works[0].get("url")
        if isinstance(v, dict):
            return v.get("url") or v.get("resource")
        if v:
            return v
    print("FULL OUTPUT:", json.dumps(data)[:1000])
    sys.exit("could not locate video URL in output")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--first", required=True)
    ap.add_argument("--last")
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--duration", type=int, default=4)
    ap.add_argument("--res", default="480p")
    ap.add_argument("--task-type", default="seedance-2")
    ap.add_argument("--host", default="0x0", choices=["0x0", "catbox", "tmpfiles", "uguu"])
    ap.add_argument("--dry-host", action="store_true")
    args = ap.parse_args()

    first = Path(args.first)
    name, rgb = pick_chroma(Image.open(first))
    print(f"chroma = {name} {rgb}")
    fc = composite(first, rgb)
    urls = [upload(fc, args.host)]
    if args.last:
        lc = composite(Path(args.last), rgb)
        urls.append(upload(lc, args.host))
    else:
        urls.append(urls[0])  # same frame twice -> loopable idle
    print("URLS:", urls)
    # remember the chroma for the keying step
    Path(args.out).with_suffix(".chroma.txt").write_text("%d,%d,%d" % rgb)

    if args.dry_host:
        print("dry-host done"); return

    key = load_key()
    tid = submit(key, urls, args.prompt, args.duration, args.res, args.task_type)
    print("task_id:", tid)
    data = poll(key, tid)
    vurl = find_video(data)
    print("video:", vurl)
    vr = requests.get(vurl, timeout=300)
    vr.raise_for_status()
    Path(args.out).write_bytes(vr.content)
    print("saved", args.out, len(vr.content), "bytes")

if __name__ == "__main__":
    main()
