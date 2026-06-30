#!/usr/bin/env python3
"""Bake frame-by-frame walk-cycle sprite STRIPS from the existing static agent
sprites (puppet animation). For each chassis + direction we split the sprite at
the knee line and scissor the lower legs (alternating fore/aft swing + lift)
while the whole body bobs. This reuses the exact approved art so every frame is
perfectly on-model, and produces a horizontal N-frame strip per direction.

  out: public/sprites/walk/<body>_<dir>.png   (dir = front|back|right|left)
  left = the right source mirrored before animating (correct mirrored stride).

The strips are the DARK/untinted base; the runtime recolor pipeline tints them.
"""
import math, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'public', 'sprites')
OUT = os.path.join(SRC, 'walk')
os.makedirs(OUT, exist_ok=True)

FRAMES = 6
# motion amounts at the native 1024px scale (downsampled ~/8 to the 128 px grid)
KNEE = 0.82     # cut line: bottom 18% (lower legs + feet) is the scissoring part
LIFT = 34       # how high a stepping foot rises
SWING = 24      # fore/aft leg travel
BOB = 16        # whole-body vertical bounce
# arm swing (front/back only — on side views the arms overlap the torso so we
# leave them alone). Arms counter-swing the same-side leg.
SHOULDER = 0.40 # arm band starts here (below the head)
CORE = 0.17     # half-width of the protected central torso column
ARM_SWING = 15  # fore/aft hand travel

# chassis -> {dir: source filename}. left is derived from right (mirrored).
BODIES = {
    'humanoid': {'front': 'agent_base.png',  'back': 'agent_base_back.png',  'right': 'agent_base_right.png'},
    'monkey':   {'front': 'monkey_base.png', 'back': 'monkey_back.png',      'right': 'monkey_right.png'},
    'evilbot':  {'front': 'robot_base.png',  'back': 'robot_back.png',       'right': 'robot_right.png'},
    'cortex':   {'front': 'cortex_base.png', 'back': 'cortex_back.png',      'right': 'cortex_right.png'},
    'goblin':   {'front': 'goblin_base.png', 'back': 'goblin_back.png',      'right': 'goblin_right.png'},
}


def content_bbox(im):
    bb = im.getbbox()
    return bb if bb else (0, 0, im.width, im.height)


def make_frame(base, g, phase, arms):
    """Compose one walk frame from the static base image."""
    W, H = base.size
    knee_y, cx = g['knee_y'], g['cx']
    bob = -BOB * abs(math.sin(phase))                 # body highest at mid-stride
    lp, rp = phase, phase + math.pi                   # legs in opposite phase
    l_sw = SWING * math.sin(lp); l_lf = max(0.0, math.sin(lp)) * LIFT
    r_sw = SWING * math.sin(rp); r_lf = max(0.0, math.sin(rp)) * LIFT

    upper = base.crop((0, 0, W, knee_y)).copy()       # torso + thighs (bob only)
    legs = base.crop((0, knee_y, W, H))               # lower legs + feet (scissor)
    left_leg = legs.crop((0, 0, cx, legs.height))     # split at body centre
    right_leg = legs.crop((cx, 0, W, legs.height))

    arm_imgs = []
    if arms:
        sh, x0, x1 = g['shoulder_y'], g['x0'], g['x1']
        lb = (x0, sh, cx - g['core'], knee_y)         # left arm band
        rb = (cx + g['core'], sh, x1, knee_y)         # right arm band
        la, ra = base.crop(lb), base.crop(rb)
        upper.paste((0, 0, 0, 0), lb)                 # remove arms from torso (no ghosting)
        upper.paste((0, 0, 0, 0), rb)
        a_l = ARM_SWING * math.sin(lp + math.pi)      # arm opposes its same-side leg
        a_r = ARM_SWING * math.sin(rp + math.pi)
        arm_imgs = [(la, lb[0] + a_l, sh + bob), (ra, rb[0] + a_r, sh + bob)]

    frame = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    # legs first, torso on top so the knee seam is hidden, then the swung arms
    frame.alpha_composite(left_leg,  (int(round(l_sw)),      int(round(knee_y + bob - l_lf))))
    frame.alpha_composite(right_leg, (cx + int(round(r_sw)), int(round(knee_y + bob - r_lf))))
    frame.alpha_composite(upper,     (0,                     int(round(bob))))
    for img, ax, ay in arm_imgs:
        frame.alpha_composite(img, (int(round(ax)), int(round(ay))))
    return frame


def bake(body, dirn, src_name, mirror=False, arms=False):
    im = Image.open(os.path.join(SRC, src_name)).convert('RGBA')
    if mirror:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    W, H = im.size
    x0, y0, x1, y1 = content_bbox(im)
    g = {
        'knee_y': int(y0 + (y1 - y0) * KNEE),
        'shoulder_y': int(y0 + (y1 - y0) * SHOULDER),
        'cx': (x0 + x1) // 2,
        'core': int((x1 - x0) * CORE),
        'x0': x0, 'x1': x1,
    }
    strip = Image.new('RGBA', (W * FRAMES, H), (0, 0, 0, 0))
    for i in range(FRAMES):
        ph = 2 * math.pi * i / FRAMES
        strip.alpha_composite(make_frame(im, g, ph, arms), (i * W, 0))
    out = os.path.join(OUT, f'{body}_{dirn}.png')
    strip.save(out)
    print('baked', os.path.relpath(out, ROOT), f'({FRAMES} frames, arms={arms})')


for body, dirs in BODIES.items():
    bake(body, 'front', dirs['front'], arms=True)
    bake(body, 'back',  dirs['back'],  arms=True)
    bake(body, 'right', dirs['right'])                 # side: arms overlap torso
    bake(body, 'left',  dirs['right'], mirror=True)

print('done. FRAMES =', FRAMES)
