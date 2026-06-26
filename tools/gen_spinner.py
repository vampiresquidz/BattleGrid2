#!/usr/bin/env python3
"""Animate the spinner seed (glowing ring on black) into a loopable rotating clip.

The ring is rendered on PURE BLACK so the loading screen can drop the background
with CSS mix-blend-mode:screen — only the glow shows. We submit the same frame
twice (first_last_frames) for a seamless loop and prompt for continuous rotation.
Output -> public/spinner.mp4.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import requests
from seedance import load_key, upload, submit, poll, find_video

SEED = Path("assets/raw/spinner_seed.png")
OUT = Path("public/spinner.mp4")
PROMPT = (
    "A glowing neon loading ring rotates smoothly and continuously clockwise. The "
    "bright cyan-to-magenta arc sweeps around the circle, luminous edges shimmering, "
    "tiny particle sparks trailing along the ring, faint concentric tech rings pulsing "
    "gently. Seamless looping rotation, perfectly centered, no camera movement, "
    "background stays pure solid black. Clean futuristic HUD loader."
)

def main():
    key = load_key()
    print("uploading spinner seed...")
    url = None
    for host in ("uguu", "catbox", "0x0", "tmpfiles"):
        try:
            url = upload(SEED, host)
            print(f"  {host}: {url}")
            break
        except Exception as e:
            print(f"  {host} failed: {e}")
    if not url:
        sys.exit("all uploads failed")

    tid = submit(key, [url, url], PROMPT, duration=5, res="720p", task_type="seedance-2")
    print("task_id:", tid)
    data = poll(key, tid, timeout_s=600)
    vurl = find_video(data)
    print("video:", vurl)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    vr = requests.get(vurl, timeout=300)
    vr.raise_for_status()
    OUT.write_bytes(vr.content)
    print("saved", OUT, len(vr.content), "bytes")

if __name__ == "__main__":
    main()
