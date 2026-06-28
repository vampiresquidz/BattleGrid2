#!/usr/bin/env python3
"""Animate the landing seed (wide pixel-art abyss) into a loopable 16:9 clip.
Same frame twice → seamless loop, subtle ambient motion. Output public/landing.mp4."""
import sys, json, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import requests
from seedance import load_key, upload, poll, find_video, API

SEED = Path("assets/raw/landing_seed.png")
OUT = Path("public/landing.mp4")
PROMPT = (
    "Gentle ambient motion in a serene neon digital world: rivers of light-energy "
    "flow slowly along the glowing circuit grid, holographic glyphs and data particles "
    "drift and twinkle, soft light beams shimmer, the distant data-citadel glows and "
    "softly pulses, faint scanline shimmer. Seamless looping motion, no camera cut, "
    "no zoom, pixel-art style preserved, calm and atmospheric. No water."
)

def submit_wide(key, urls, prompt):
    body = {"model": "seedance", "task_type": "seedance-2", "input": {
        "prompt": prompt, "mode": "first_last_frames", "image_urls": urls,
        "duration": 5, "aspect_ratio": "16:9", "resolution": "720p"}}
    r = requests.post(API, headers={"X-API-Key": key, "Content-Type": "application/json"},
                      data=json.dumps(body), timeout=120)
    print("SUBMIT", r.status_code, r.text[:300]); r.raise_for_status()
    d = r.json().get("data", {})
    tid = d.get("task_id") or d.get("id")
    if not tid: sys.exit("no task_id")
    return tid

def main():
    key = load_key()
    url = None
    for host in ("uguu", "catbox", "0x0", "tmpfiles"):
        try: url = upload(SEED, host); print(host, url); break
        except Exception as e: print(host, "failed", e)
    if not url: sys.exit("upload failed")
    tid = submit_wide(key, [url, url], PROMPT)
    print("task", tid)
    data = poll(key, tid, timeout_s=600)
    vurl = find_video(data); print("video", vurl)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(requests.get(vurl, timeout=300).content)
    print("saved", OUT, OUT.stat().st_size, "bytes")

if __name__ == "__main__":
    main()
