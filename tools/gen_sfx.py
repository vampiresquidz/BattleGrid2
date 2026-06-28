#!/usr/bin/env python3
"""Generate game sound effects with the ElevenLabs Sound Effects API.

Reads ELEVENLABS_API_KEY from env or .env. Saves mp3s to public/sfx/.
The key is only used here at generation time — the SFX ship as static files,
so the key never reaches the client bundle.
"""
import os, sys, json, urllib.request, urllib.error
from pathlib import Path

def load_key() -> str:
    if os.environ.get("ELEVENLABS_API_KEY"):
        return os.environ["ELEVENLABS_API_KEY"]
    for p in [Path(".env.local"), Path(".env"), Path.home() / ".config" / "watch" / ".env"]:
        try:
            for line in p.read_text(encoding="utf-8").splitlines():
                if line.strip().startswith("ELEVENLABS_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
        except OSError:
            continue
    sys.exit("ERROR: ELEVENLABS_API_KEY not found")

API = "https://api.elevenlabs.io/v1/sound-generation"

# name -> (prompt, duration_seconds)
SFX = {
    "ui_click":  ("short crisp digital UI button click, clean futuristic interface blip", 0.5),
    "ui_confirm":("positive confirm chime, short bright sci-fi interface accept", 0.6),
    "buster":    ("quick energy pulse laser shot, snappy retro sci-fi blaster zap", 0.6),
    "cannon":    ("punchy energy cannon blast, deep impactful sci-fi shot", 0.7),
    "slash":     ("fast energy sword slash, sharp swoosh with a metallic ring", 0.6),
    "bomb":      ("explosion, punchy digital boom with a short debris tail", 0.9),
    "hit":       ("impact hit, short crunchy digital damage thud", 0.5),
    "hurt":      ("player takes damage, distorted glitchy electronic impact", 0.6),
    "freeze":    ("ice freeze crackle, crystallizing shimmer, cold", 0.9),
    "heal":      ("healing restore shimmer, soft positive rising sparkle", 1.0),
    "victory":   ("short triumphant victory fanfare, bright synth arpeggio sting", 1.6),
    "defeat":    ("downbeat defeat sound, descending power-down glitch", 1.4),
    "pa":        ("epic power surge activation, super move charge and release, big sci-fi whoosh with a chime", 1.5),
    "mint":      ("magical crystallize confirm, success sparkle chime, premium", 1.1),
}

def gen(key: str, name: str, prompt: str, dur: float):
    body = json.dumps({
        "text": prompt,
        "duration_seconds": max(0.5, min(22.0, dur)),
        "prompt_influence": 0.4,
        "output_format": "mp3_44100_128",
    }).encode()
    req = urllib.request.Request(API, data=body, method="POST",
        headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        print(f"  {name}: HTTP {e.code} {e.read().decode()[:200]}"); return False
    out = Path("public/sfx") / f"{name}.mp3"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    print(f"  {name}.mp3  ({len(data)} bytes)")
    return True

def main():
    key = load_key()
    only = set(sys.argv[1:])
    ok = 0
    for name, (prompt, dur) in SFX.items():
        if only and name not in only:
            continue
        if gen(key, name, prompt, dur):
            ok += 1
    print(f"done: {ok} sfx")

if __name__ == "__main__":
    main()
