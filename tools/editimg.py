#!/usr/bin/env python3
"""Image-to-image with OpenAI gpt-image-1 edits endpoint.

Feeds one or more reference images plus a prompt and writes a PNG.
Used to turn a reference character into a game-ready pixel sprite while
keeping its design.

Usage:
  py tools/editimg.py --ref assets/raw/ref.jpg --prompt "..." --out assets/raw/x.png
      [--size 1024x1024] [--bg transparent|opaque|auto] [--quality high|medium|low]
"""
import argparse, base64, json, mimetypes, os, sys, urllib.request, urllib.error, uuid
from pathlib import Path

def load_key() -> str:
    if os.environ.get("OPENAI_API_KEY"):
        return os.environ["OPENAI_API_KEY"]
    for p in [Path(".env.local"), Path(".env"), Path.home() / ".config" / "watch" / ".env"]:
        try:
            for line in p.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line.startswith("OPENAI_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
        except OSError:
            continue
    sys.exit("ERROR: OPENAI_API_KEY not found")

def multipart(fields: dict[str, str], files: list[tuple[str, Path]]) -> tuple[bytes, str]:
    boundary = "----abyssal" + uuid.uuid4().hex
    out = bytearray()
    for name, val in fields.items():
        out += f"--{boundary}\r\n".encode()
        out += f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
        out += f"{val}\r\n".encode()
    for name, path in files:
        ctype = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        out += f"--{boundary}\r\n".encode()
        out += f'Content-Disposition: form-data; name="{name}"; filename="{path.name}"\r\n'.encode()
        out += f"Content-Type: {ctype}\r\n\r\n".encode()
        out += path.read_bytes()
        out += b"\r\n"
    out += f"--{boundary}--\r\n".encode()
    return bytes(out), boundary

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", required=True, action="append", help="reference image (repeatable)")
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--size", default="1024x1024")
    ap.add_argument("--bg", default="transparent", choices=["transparent", "opaque", "auto"])
    ap.add_argument("--quality", default="high", choices=["high", "medium", "low", "auto"])
    args = ap.parse_args()

    fields = {
        "model": "gpt-image-1",
        "prompt": args.prompt,
        "size": args.size,
        "background": args.bg,
        "quality": args.quality,
        "n": "1",
    }
    # multiple references use the field name image[]
    field_name = "image[]" if len(args.ref) > 1 else "image"
    files = [(field_name, Path(r)) for r in args.ref]
    body, boundary = multipart(fields, files)

    req = urllib.request.Request(
        "https://api.openai.com/v1/images/edits",
        data=body,
        headers={
            "Authorization": f"Bearer {load_key()}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
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
