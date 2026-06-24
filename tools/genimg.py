#!/usr/bin/env python3
"""Generate character art with OpenAI gpt-image-1.

Reads OPENAI_API_KEY from the environment, or from ~/.config/watch/.env,
or from a local .env. Saves a PNG (transparent background by default).

Usage:
  py tools/genimg.py --prompt "..." --out assets/raw/player.png [--size 1024x1024] [--bg transparent|opaque] [--quality high|medium|low]
"""
import argparse, base64, json, os, sys, urllib.request, urllib.error
from pathlib import Path

def load_key() -> str:
    if os.environ.get("OPENAI_API_KEY"):
        return os.environ["OPENAI_API_KEY"]
    candidates = [
        Path.home() / ".config" / "watch" / ".env",
        Path(".env.local"), Path(".env"),
    ]
    for p in candidates:
        try:
            for line in p.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line.startswith("OPENAI_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
        except OSError:
            continue
    sys.exit("ERROR: OPENAI_API_KEY not found in env or .env files")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--size", default="1024x1024")
    ap.add_argument("--bg", default="transparent", choices=["transparent", "opaque", "auto"])
    ap.add_argument("--quality", default="high", choices=["high", "medium", "low", "auto"])
    args = ap.parse_args()

    body = {
        "model": "gpt-image-1",
        "prompt": args.prompt,
        "size": args.size,
        "background": args.bg,
        "quality": args.quality,
        "n": 1,
        "output_format": "png",
    }
    req = urllib.request.Request(
        "https://api.openai.com/v1/images/generations",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {load_key()}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            payload = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode()[:800]}")

    b64 = payload["data"][0]["b64_json"]
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(base64.b64decode(b64))
    print(f"OK -> {out}  ({out.stat().st_size} bytes)")

if __name__ == "__main__":
    main()
