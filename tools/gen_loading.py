#!/usr/bin/env python3
"""Animate the loading-screen seed image into a loopable Seedance clip.

Unlike seedance.py (which chroma-composites transparent sprites), the loading
screen wants the FULL opaque frame animated, so we upload the seed image as-is
and submit a first_last_frames task with the same frame twice -> a seamless,
loopable, subtle motion clip. Output -> public/loading.mp4.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import requests
from seedance import load_key, upload, submit, poll, find_video

SEED = Path("assets/raw/loading_seed.png")
OUT = Path("public/loading.mp4")
PROMPT = (
    "A glowing neon data-core orb slowly pulses and rotates at the center, "
    "energy particles drifting inward, circuit traces faintly shimmering with "
    "flowing light, subtle cyan-to-magenta plasma swirl, gentle continuous "
    "looping motion, dark background stays static, cinematic sci-fi loading screen"
)

def main():
    key = load_key()
    print("uploading seed...")
    # try a few hosts in case one is blocked by PiAPI's fetcher
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
