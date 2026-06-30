#!/usr/bin/env python3
"""Bake battle-scene animation STRIPS from each chassis's BATTLE-stance sprite:
  - <body>_idle.png : a breathing idle (squash/stretch about the feet) with a
                      pulsing glow on the weapon/energy hand.
  - <body>_atk.png  : a weapon firing burst (a muzzle/energy flash that grows
                      then fades at the weapon point); the engine adds the lunge.

Both are the DARK base art; the runtime recolor pipeline tints them (so the
flash takes on each shell's energy colour). Re-run after editing a battle sprite.
"""
import math, os
from PIL import Image, ImageDraw, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'public', 'sprites')
OUT = os.path.join(SRC, 'battle')
os.makedirs(OUT, exist_ok=True)

IDLE_FRAMES = 6
ATK_FRAMES = 5
ATK_FLASH = [0.0, 0.45, 1.0, 0.55, 0.2]   # flash intensity per attack frame (peak mid)
ATK_SIZE = [0.16, 0.30, 0.54, 0.42, 0.28]  # flash radius as a fraction of width
ATK_DY = [0, -2, -9, -4, -1]               # small vertical recoil on the blast

MELEE_FRAMES = 5
SLASH_ROT = [40, 20, 0, -20, -40]          # blade tilt through the swing
SLASH_DY = [-0.17, -0.09, 0.0, 0.09, 0.17] # vertical sweep (fraction of H), top→down
SLASH_A = [0.55, 0.95, 1.0, 0.85, 0.55]    # blade opacity per frame

BODIES = {
    'humanoid': 'agent_battle.png',
    'monkey':   'monkey_battle.png',
    'evilbot':  'robot_battle.png',
    'cortex':   'cortex_battle.png',
    'goblin':   'goblin_battle.png',
}


def make_glow(size=256, color=(205, 240, 255)):
    """A soft radial glow (bright core → transparent edge)."""
    g = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(g)
    c = size / 2
    for i in range(int(c), 0, -1):
        a = int(255 * (1 - i / c) ** 2.2)
        d.ellipse([c - i, c - i, c + i, c + i], fill=a)
    img = Image.new('RGBA', (size, size), color + (0,))
    img.putalpha(g)
    return img


GLOW = make_glow()


def make_sickle(size=256, bow=0.42, color=(230, 248, 255)):
    """A crescent blade: a disc minus a left-shifted disc, so the blade bulges
    toward the enemy (right) with the bite scooped out toward the body (left)."""
    outer = Image.new('L', (size, size), 0)
    ImageDraw.Draw(outer).ellipse([0, 0, size, size], fill=255)
    inner = Image.new('L', (size, size), 0)
    off = int(size * bow)
    ImageDraw.Draw(inner).ellipse([-off, 0, size - off, size], fill=255)
    mask = ImageChops.subtract(outer, inner)
    img = Image.new('RGBA', (size, size), color + (0,))
    img.putalpha(mask)
    return img


SICKLE = make_sickle()


def scale_alpha(img, f):
    r, g, b, a = img.split()
    a = a.point(lambda v: int(v * f))
    return Image.merge('RGBA', (r, g, b, a))


def weapon_point(im):
    """The forward muzzle: every stance fires to the right, so we gather vivid
    neon energy pixels (cyan OR magenta) and take the centroid of the rightmost
    cluster. This skips the central chest core / visor that pulled a plain bright
    centroid toward the body. Falls back to rightmost content at chest height."""
    W, H = im.size
    px = im.load()
    pts = []
    for y in range(0, H, 2):
        for x in range(0, W, 2):
            r, g, b, a = px[x, y]
            if a < 128:
                continue
            mx = max(r, g, b); mn = min(r, g, b)
            lum = r + g + b
            sat = (mx - mn) / mx if mx else 0
            if (lum > 500 and sat > 0.35) or lum > 680:   # vivid neon or very bright
                pts.append((x, y, lum))
    if pts:
        xs = [p[0] for p in pts]
        thr = min(xs) + 0.62 * (max(xs) - min(xs))        # rightmost ~38% = the discharge
        fwd = [p for p in pts if p[0] >= thr]
        sw = sum(p[2] for p in fwd)
        return (sum(p[0] * p[2] for p in fwd) / sw, sum(p[1] * p[2] for p in fwd) / sw)
    bb = im.getbbox() or (0, 0, W, H)
    ymid = int(bb[1] + (bb[3] - bb[1]) * 0.45)
    rx = bb[0]
    for yy in range(max(0, ymid - 40), min(H, ymid + 40)):
        for xx in range(W - 1, -1, -1):
            if px[xx, yy][3] >= 128:
                rx = max(rx, xx); break
    return (rx, ymid)


def melee_frame(im, wp, i):
    W, H = im.size
    frame = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    frame.alpha_composite(im, (0, 0))
    bw, bh = int(W * 0.22), int(H * 0.50)               # crescent blade footprint
    blade = SICKLE.resize((bw, bh))
    blade = blade.rotate(SLASH_ROT[i], expand=True, resample=Image.BICUBIC)
    blade = scale_alpha(blade, SLASH_A[i])
    cx = int(wp[0] + W * 0.06)                          # just forward of the muzzle
    cy = int(wp[1] + SLASH_DY[i] * H)
    frame.alpha_composite(blade, (cx - blade.width // 2, cy - blade.height // 2))
    return frame


def idle_frame(im, feet, wp, phase):
    W, H = im.size
    w = math.sin(phase)
    sx = 1 + 0.02 * w
    sy = 1 - 0.03 * w
    bob = -6 * abs(w)
    scaled = im.resize((round(W * sx), round(H * sy)))
    fx, fy = feet
    ox = round(fx - fx * sx)
    oy = round(fy - fy * sy + bob)
    frame = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    frame.alpha_composite(scaled, (ox, oy))
    pulse = 0.30 + 0.28 * (0.5 + 0.5 * math.sin(phase * 2))   # gentle weapon glow
    gd = int(W * 0.22)
    glow = scale_alpha(GLOW.resize((gd, gd)), pulse)
    frame.alpha_composite(glow, (int(wp[0] - gd / 2), int(wp[1] - gd / 2 + bob)))
    return frame


def atk_frame(im, wp, i):
    W, H = im.size
    frame = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    frame.alpha_composite(im, (0, ATK_DY[i]))            # body with small recoil
    inten = ATK_FLASH[i]
    if inten > 0:
        gd = int(W * ATK_SIZE[i])
        glow = scale_alpha(GLOW.resize((gd, gd)), inten)
        frame.alpha_composite(glow, (int(wp[0] - gd / 2), int(wp[1] - gd / 2 + ATK_DY[i])))
    return frame


def bake(body, src_name):
    im = Image.open(os.path.join(SRC, src_name)).convert('RGBA')
    W, H = im.size
    bb = im.getbbox() or (0, 0, W, H)
    feet = ((bb[0] + bb[2]) / 2, bb[3])
    wp = weapon_point(im)

    idle = Image.new('RGBA', (W * IDLE_FRAMES, H), (0, 0, 0, 0))
    for i in range(IDLE_FRAMES):
        ph = 2 * math.pi * i / IDLE_FRAMES
        idle.alpha_composite(idle_frame(im, feet, wp, ph), (i * W, 0))
    idle.save(os.path.join(OUT, f'{body}_idle.png'))

    atk = Image.new('RGBA', (W * ATK_FRAMES, H), (0, 0, 0, 0))
    for i in range(ATK_FRAMES):
        atk.alpha_composite(atk_frame(im, wp, i), (i * W, 0))
    atk.save(os.path.join(OUT, f'{body}_atk.png'))

    melee = Image.new('RGBA', (W * MELEE_FRAMES, H), (0, 0, 0, 0))
    for i in range(MELEE_FRAMES):
        melee.alpha_composite(melee_frame(im, wp, i), (i * W, 0))
    melee.save(os.path.join(OUT, f'{body}_melee.png'))
    print(f'baked {body}: idle({IDLE_FRAMES}) atk({ATK_FRAMES}) melee({MELEE_FRAMES})  weapon@({wp[0]:.0f},{wp[1]:.0f})')


for body, src in BODIES.items():
    bake(body, src)
print('done. IDLE =', IDLE_FRAMES, 'ATK =', ATK_FRAMES, 'MELEE =', MELEE_FRAMES)
