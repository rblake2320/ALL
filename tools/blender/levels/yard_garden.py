"""Yard garden builders (W-109 part 3): the garden plot, three crops and four trees in three growth stages each,
and three flower beds. Conventions are the level kit's (front = -Y, Z up, base at z = 0).

Growth stages are separate models (`<id>_s1` sprout/sapling, `_s2` growing/young, `_s3` ripe/mature), so each
stage has its own bounds, outline and triangle count and the runtime swaps one model for the next.
A crop model stands on the plot's `crop` frame (the soil surface); its own base is z = 0.
"""
from __future__ import annotations

import math

from mathutils import Vector

import manifest_meta as meta
from common import shapes as S
from common.materials import MatSpec
from common.model import Model

from . import kit
from .kit import add, builder
from .spec import LevelSpec

kit.LEVEL_LOOKS.update({
    'YdBrain': MatSpec('#c98f9a', roughness=0.55),
    'YdCabbageLeaf': MatSpec('#5f7a4a', roughness=0.8),
    'YdShroomCap': MatSpec('#7fae8a', roughness=0.5, emission='#7fae8a', strength=0.6),
    'YdShroomStem': MatSpec('#d9d2bd', roughness=0.8),
    'YdPumpkin': MatSpec('#d9772b', roughness=0.6),
    'YdPumpkinGreen': MatSpec('#6f8a3e', roughness=0.7),
    'YdPumpkinPale': MatSpec('#d8d4c0', roughness=0.6),
    'YdVine': MatSpec('#4f6b3a', roughness=0.85),
    'YdLeafApple': MatSpec('#5d7446', roughness=0.9),
    'YdLeafAppleDark': MatSpec('#44583a', roughness=0.9),
    'YdApple': MatSpec('#8b1e2b', roughness=0.45),
    'YdBirch': MatSpec('#d8d2c4', roughness=0.8),
    'YdBirchLeaf': MatSpec('#a8a84e', roughness=0.9),
    'YdPine': MatSpec('#2f4a3c', roughness=0.9),
    'YdPineDark': MatSpec('#223a30', roughness=0.9),
    'YdMaple': MatSpec('#9a3b2e', roughness=0.9),
    'YdMapleDark': MatSpec('#74281f', roughness=0.9),
    'YdPetalPurple': MatSpec('#6b4a8a', roughness=0.6),
    'YdPetalOrange': MatSpec('#e08a2a', roughness=0.6),
    'YdPetalWhite': MatSpec('#e8e4d8', roughness=0.6),
    'YdBerry': MatSpec('#1c1a24', roughness=0.3),
})

#: where the four plants of a crop stand on the plot (metres from the plot centre)
SPOTS = ((-0.42, -0.42), (0.42, -0.40), (-0.40, 0.42), (0.42, 0.44))
#: the soil surface of `garden_plot`: its `crop` frame, where a crop model's z = 0 goes
SOIL_TOP = 0.17


def leaf(m: Model, c, r: float, yaw: float, tilt: float, look: str, narrow: float = 0.55) -> None:
    """A flat oval leaf growing out from point `c` in direction `yaw`, raised by `tilt` degrees."""
    a, t = math.radians(yaw), math.radians(tilt)
    d = r * 0.85 * math.cos(t)
    add(m, S.sphere(r, 6, 3, loc=(c[0] + d * math.cos(a), c[1] + d * math.sin(a), c[2] + r * 0.85 * math.sin(t)),
                    scale=(1.0, narrow, 0.14), rot=(0, -tilt, yaw)), look)


def mound(m: Model, x: float, y: float, r: float = 0.13, h: float = 0.03, look: str = 'SoilClod') -> None:
    add(m, S.cylinder(r, h, 7, 0.0, r_top=r * 0.7, base=(x, y, 0.0)), look)


# ─────────────────────────────────────────── the plot ───────────────────────────────────────────

@builder('garden_plot')
def garden_plot(m: Model, spec: LevelSpec) -> None:
    """A raised bed, 2 x 2 tiles: weathered timber edging, dark soil in four furrows, a little grave-marker sign."""
    half, t, h = 0.95, 0.07, 0.20
    for s in (-1, 1):
        add(m, S.box(2 * half, t, h, 0.008, 1, base=(0, s * (half - t / 2), 0)), 'YdPlank')
        add(m, S.box(t, 2 * half - 2 * t, h, 0.008, 1, base=(s * (half - t / 2), 0, 0)), 'YdPlank')
        for q in (-1, 1):
            add(m, S.box(0.09, 0.09, 0.26, 0.008, 1, base=(s * (half - 0.045), q * (half - 0.045), 0)), 'YdPlankDark')
    add(m, S.box(2 * (half - t), 2 * (half - t), 0.14, 0.0, 0, base=(0, 0, 0)), 'Soil')
    for y in (-0.63, -0.21, 0.21, 0.63):                                                 # furrow ridges
        add(m, S.box(1.70, 0.24, 0.05, 0.02, 1, base=(0, y, 0.12)), 'SoilDark')
    add(m, S.box(0.03, 0.03, 0.45, 0.0, 0, base=(-0.80, 0.80, 0.0)), 'YdPlankDark')         # the sign, back left
    sign = S.lathe([(0.0, 0.0), (0.11, 0.0), (0.11, 0.10), (0.07, 0.15), (0.0, 0.16)], 8, scale_xy=(1.0, 0.16))
    add(m, S.translate(sign, (-0.80, 0.78, 0.29)), 'YdPlank')
    add(m, kit.flat_text('GROW', 0.05, (-0.80, 0.76, 0.365)), 'DecalInk')
    meta.add_frame('crop', (0.0, 0.0, SOIL_TOP), 0.0, 'attach')
    meta.add_frame('tend', (0.0, -1.45, 0.0), 180.0, 'approach')
    meta.add_frame('hands', (0.0, -0.55, 0.30), 180.0, 'hands')


# ─────────────────────────────────────────── crops ───────────────────────────────────────────

def _stage(spec: LevelSpec) -> int:
    return int(spec.id[-1])


@builder('crop_cabbage_s1', 'crop_cabbage_s2', 'crop_cabbage_s3')
def crop_cabbage(m: Model, spec: LevelSpec) -> None:
    """Rot-brain cabbage: a rosette of leaves round a head that is a small pink brain."""
    st = _stage(spec)
    for i, (x, y) in enumerate(SPOTS):
        mound(m, x, y)
        c = (x, y, 0.03)
        if st == 1:
            for k in range(2):
                leaf(m, c, 0.05, 40 + 180 * k + 30 * i, 50, 'YdCabbageLeaf')
            continue
        n, r, br = (6, 0.10, 0.06) if st == 2 else (8, 0.17, 0.10)
        for k in range(n):
            leaf(m, c, r * (1.0 if k % 2 else 0.85), 360 * k / n + 17 * i, 22 if k % 2 else 42, 'YdCabbageLeaf', 0.7)
        for s in (-1, 1):                                                                # the two halves of the brain
            add(m, S.blob(br, 1, 0.16, 4.0, seed=30 + 4 * i + s, loc=(x + s * br * 0.62, y, 0.03 + br * 0.95),
                          scale=(0.80, 1.20, 0.95), rot=(0, 0, 20 * i)), 'YdBrain')


def _shroom(m: Model, x: float, y: float, h: float, r: float, lean: float = 0.0) -> None:
    add(m, S.tube([(x, y, 0.0), (x + lean, y, h)], r * 0.22, 5), 'YdShroomStem')
    cap = S.lathe([(0.0, -0.02 * r), (r * 0.92, 0.0), (r, r * 0.16), (r * 0.72, r * 0.50), (r * 0.32, r * 0.70), (0.0, r * 0.76)], 7)
    add(m, S.translate(cap, (x + lean, y, h - r * 0.10)), 'YdShroomCap')


@builder('crop_mushroom_s1', 'crop_mushroom_s2', 'crop_mushroom_s3')
def crop_mushroom(m: Model, spec: LevelSpec) -> None:
    """Swamp mushrooms: faintly glowing green caps in clusters."""
    st = _stage(spec)
    ring = ((0.0, 0.0), (0.11, 0.05), (-0.07, 0.10), (-0.04, -0.11))
    for i, (x, y) in enumerate(SPOTS):
        mound(m, x, y, 0.17)
        for k, (dx, dy) in enumerate(ring[: 3 if st < 3 else 4]):
            px, py = x + dx, y + dy
            if st == 1:
                add(m, S.sphere(0.03, 5, 3, loc=(px, py, 0.045), scale=(1, 1, 0.7)), 'YdShroomCap')
            elif st == 2:
                _shroom(m, px, py, 0.07 + 0.02 * ((i + k) % 2), 0.05)
            else:
                big = k == 0
                _shroom(m, px, py, (0.22 if big else 0.11) + 0.02 * ((i + k) % 3), 0.13 if big else 0.065,
                        0.0 if big else 0.02 * (1 if dx > 0 else -1))


def _pumpkin(m: Model, x: float, y: float, r: float, look: str, face: bool = False) -> None:
    body = S.sphere(r, 10, 6, scale=(1.0, 1.0, 0.80))
    S.displace(body, lambda v: Vector((v.x * (1 + 0.07 * math.cos(5 * math.atan2(v.y, v.x))),
                                       v.y * (1 + 0.07 * math.cos(5 * math.atan2(v.y, v.x))), v.z)))
    add(m, S.translate(body, (x, y, r * 0.80)), look)
    add(m, S.tube([(x, y, r * 1.56), (x + 0.01, y, r * 1.56 + 0.04), (x + 0.04, y, r * 1.56 + 0.06)], 0.014, 4), 'YdVine')
    if face:                                                                             # a carved grin, facing the front
        yf = y - r * 1.02
        for s in (-1, 1):
            add(m, S.box(0.05, 0.012, 0.05, 0.0, 0, loc=(x + s * r * 0.34, yf + 0.02, r * 0.98), rot=(0, 45, 0)), 'YdBerry')
        add(m, S.box(r * 0.9, 0.012, 0.03, 0.0, 0, loc=(x, yf, r * 0.58)), 'YdBerry')


@builder('crop_pumpkin_s1', 'crop_pumpkin_s2', 'crop_pumpkin_s3')
def crop_pumpkin(m: Model, spec: LevelSpec) -> None:
    """Graveyard pumpkins on a vine: sprouts, then small green fruit, then three ripe ones, one pale, one carved."""
    st = _stage(spec)
    for x, y in SPOTS:
        mound(m, x, y)
    if st == 1:
        for i, (x, y) in enumerate(SPOTS):
            add(m, S.tube([(x, y, 0.02), (x + 0.01, y, 0.09)], 0.008, 4), 'YdVine')
            for k in range(2):
                leaf(m, (x + 0.01, y, 0.09), 0.045, 90 * i + 180 * k, 25, 'YdVine', 0.8)
        return
    path = [(-0.42, -0.42, 0.035), (-0.05, -0.55, 0.03), (0.42, -0.40, 0.035), (0.55, 0.02, 0.03), (0.42, 0.44, 0.035),
            (0.00, 0.30, 0.03), (-0.40, 0.42, 0.035), (-0.60, 0.05, 0.03)]
    add(m, S.tube(path, 0.014, 4), 'YdVine')
    lr = 0.085 if st == 2 else 0.11
    for i, p in enumerate(path):
        leaf(m, (p[0], p[1], p[2] + 0.05), lr, 47 * i + 20, 12, 'YdVine', 0.85)
        add(m, S.tube([p, (p[0], p[1], p[2] + 0.06)], 0.006, 3), 'YdVine')
    if st == 2:
        for (x, y) in SPOTS[:3]:
            _pumpkin(m, x + 0.10, y + 0.06, 0.07, 'YdPumpkinGreen')
    else:
        _pumpkin(m, -0.40, -0.36, 0.20, 'YdPumpkin', face=True)
        _pumpkin(m, 0.44, -0.30, 0.16, 'YdPumpkinPale')
        _pumpkin(m, 0.34, 0.46, 0.18, 'YdPumpkin')
        _pumpkin(m, -0.36, 0.46, 0.10, 'YdPumpkinGreen')


# ─────────────────────────────────────────── trees ───────────────────────────────────────────

def _base(m: Model, st: int, r: float) -> None:
    """What the tree stands in: a planting mound while it is young, surface roots once it is grown."""
    if st < 3:
        mound(m, 0.0, 0.0, 0.20 if st == 1 else 0.30, 0.04)
        return
    for k in range(5):
        a = math.tau * k / 5 + 0.4
        add(m, S.tube([(0.0, 0.0, r * 0.9), (math.cos(a) * r * 1.6, math.sin(a) * r * 1.6, r * 0.35),
                       (math.cos(a) * r * 2.9, math.sin(a) * r * 2.9, 0.0)], r * 0.4, 5, radii=[r * 0.55, r * 0.36, r * 0.14]), 'Bark')


def _tend(spec: LevelSpec) -> None:
    """Where a zombie stands to plant, water or prune: in front of the footprint, facing it."""
    meta.add_frame('tend', (0.0, -(spec.d / 2 + 0.45), 0.0), 180.0, 'approach')


def _stake(m: Model) -> None:
    add(m, S.box(0.03, 0.03, 0.62, 0.0, 0, base=(0.11, 0.02, 0.0)), 'YdPlank')
    add(m, S.tube([(0.11, 0.02, 0.50), (0.0, 0.0, 0.48)], 0.006, 3), 'Straw')


@builder('tree_rotapple_s1', 'tree_rotapple_s2', 'tree_rotapple_s3')
def tree_rotapple(m: Model, spec: LevelSpec) -> None:
    """A crooked apple tree whose fruit goes bad on the branch."""
    _tend(spec)
    st = _stage(spec)
    k = (0.20, 0.52, 1.0)[st - 1]                                                         # overall scale against the grown tree
    _base(m, st, 0.17)
    if st == 1:
        _stake(m)
        add(m, S.tube([(0, 0, 0.02), (0.02, 0, 0.40), (-0.02, 0.01, 0.74)], 0.016, 5, radii=[0.018, 0.013, 0.008]), 'Bark')
        add(m, S.blob(0.11, 1, 0.2, 2.4, seed=3, loc=(-0.02, 0.01, 0.76), scale=(1.1, 1.0, 0.8)), 'YdLeafApple')
        for q in range(3):
            leaf(m, (0.0, 0.0, 0.50 + 0.06 * q), 0.06, 120 * q, 30, 'YdLeafAppleDark')
        return
    h = 4.2 * k
    top = (0.10 * k, -0.05 * k, h * 0.50)
    add(m, S.tube([(0, 0, 0.0), (0.08 * k, 0.03 * k, h * 0.18), (-0.06 * k, 0.0, h * 0.34), top], 0.17 * k, 7,
                  radii=[0.20 * k, 0.16 * k, 0.14 * k, 0.11 * k]), 'Bark')
    n = 3 if st == 2 else 4
    for q in range(n):
        a = math.tau * q / n + 0.5
        ln = (0.34 * k * 2.0) if st == 2 else 0.46
        tip = (top[0] + math.cos(a) * ln, top[1] + math.sin(a) * ln, h * (0.66 + 0.04 * (q % 2)))
        add(m, S.tube([top, ((top[0] + tip[0]) / 2, (top[1] + tip[1]) / 2, h * 0.56), tip], 0.07 * k, 5,
                      radii=[0.10 * k, 0.07 * k, 0.04 * k]), 'Bark')
        r = (0.30 if st == 2 else 0.57) * (1.0 if q % 2 else 0.9)
        add(m, S.blob(r, 2, 0.16, 2.0, seed=10 * st + q, loc=(tip[0] * (0.45 if st == 2 else 0.85), tip[1] * (0.45 if st == 2 else 0.85),
                                                             tip[2] + r * 0.35), scale=(1.0, 1.0, 0.78)),
            'YdLeafApple' if q % 2 else 'YdLeafAppleDark')
        for f in range(1 if st == 2 else 2):                                             # apples under the leaves
            fa = a + 0.5 + 1.3 * f
            fr = r * 0.62
            add(m, S.sphere(0.035 if st == 2 else 0.055, 6, 4, loc=(tip[0] * (0.45 if st == 2 else 0.85) + math.cos(fa) * fr,
                                                                  tip[1] * (0.45 if st == 2 else 0.85) + math.sin(fa) * fr,
                                                                  tip[2] - r * 0.30)), 'YdApple')
    r = 0.34 if st == 2 else 0.60
    add(m, S.blob(r, 2, 0.16, 1.8, seed=7 * st, loc=(top[0] * 0.5, top[1] * 0.5, h - r * 0.86), scale=(1.05, 1.05, 0.9)), 'YdLeafApple')
    if st == 3:
        for (x, y) in ((0.55, -0.50), (-0.62, -0.20), (0.20, 0.66)):                     # windfalls
            add(m, S.sphere(0.055, 6, 4, loc=(x, y, 0.045), scale=(1, 1, 0.85)), 'YdApple')


@builder('tree_bonebirch_s1', 'tree_bonebirch_s2', 'tree_bonebirch_s3')
def tree_bonebirch(m: Model, spec: LevelSpec) -> None:
    """A thin, bone-pale birch with dark bands and sparse yellow leaves that hang."""
    _tend(spec)
    st = _stage(spec)
    h = (0.95, 2.5, 4.7)[st - 1]
    r0 = (0.016, 0.05, 0.11)[st - 1]
    _base(m, st, 0.10)
    if st == 1:
        _stake(m)
    lean = (0.04, 0.04, 0.015)[st - 1] * h                                                # a grown one stands nearly straight, inside its tiles
    add(m, S.tube([(0, 0, 0.0), (lean * 0.3, 0, h * 0.45), (lean, 0.0, h * 0.86)], r0, 7, radii=[r0 * 1.15, r0 * 0.8, r0 * 0.35]), 'YdBirch')
    for q in range((2, 4, 7)[st - 1]):                                                   # the dark bands
        z = h * (0.10 + 0.10 * q)
        rr = r0 * (1.12 - 0.5 * z / h)
        add(m, S.cylinder(rr, 0.012 + 0.006 * st, 7, 0.0, base=(lean * 0.3 * z / (h * 0.45) if z < h * 0.45 else lean * 0.45, 0, z)), 'Bark')
    n = (2, 4, 6)[st - 1]
    reach = (0.14, 0.26, 0.60)[st - 1]
    for q in range(n):
        a = math.tau * q / n + 0.3 * q
        z0 = h * (0.50 + 0.36 * q / n)
        ln = reach * (1.0 - 0.35 * q / n)
        root = (lean * 0.6, 0.0, z0)
        tip = (root[0] + math.cos(a) * ln, math.sin(a) * ln, z0 + ln * 0.55)
        add(m, S.tube([root, tip], r0 * 0.3, 4, radii=[r0 * 0.38, r0 * 0.14]), 'YdBirch')
        br = (0.07, 0.17, 0.30)[st - 1]
        add(m, S.blob(br, 1, 0.22, 2.6, seed=50 + 9 * st + q, loc=(tip[0], tip[1], tip[2]), scale=(1.15, 1.15, 0.62)), 'YdBirchLeaf')
        if st > 1:                                                                       # hanging strands
            for s in range(2):
                dx, dy = math.cos(a + 1.5 * s) * br * 0.6, math.sin(a + 1.5 * s) * br * 0.6
                dl = br * (1.6 + 0.5 * s)
                card = S.box(br * 0.30, 0.012, dl, 0.0, 0, base=(0, 0, 0))
                S.rotate(card, (180, 0, math.degrees(a) + 60 * s))
                add(m, S.translate(card, (tip[0] + dx, tip[1] + dy, tip[2] - 0.02)), 'YdBirchLeaf')
    add(m, S.blob((0.08, 0.20, 0.34)[st - 1], 1, 0.2, 2.2, seed=60 + st, loc=(lean, 0.0, h - (0.07, 0.17, 0.29)[st - 1]),
                  scale=(1.0, 1.0, 0.85)), 'YdBirchLeaf')


@builder('tree_gravepine_s1', 'tree_gravepine_s2', 'tree_gravepine_s3')
def tree_gravepine(m: Model, spec: LevelSpec) -> None:
    """A dark, drooping pine built of ragged tiers."""
    _tend(spec)
    st = _stage(spec)
    h = (0.80, 2.4, 4.8)[st - 1]
    rmax = (0.20, 0.50, 0.92)[st - 1]
    tiers = (2, 4, 6)[st - 1]
    _base(m, st, 0.13)
    tr = (0.02, 0.06, 0.13)[st - 1]
    add(m, S.cylinder(tr, h * 0.9, 7, 0.0, r_top=tr * 0.3, base=(0, 0, 0)), 'Bark')
    z0 = h * (0.16 if st > 1 else 0.14)
    step = (h - z0) / (tiers + 0.35)
    for q in range(tiers):
        f = 1.0 - q / (tiers + 0.6)
        r = rmax * f
        z = z0 + step * q
        th = step * 1.75
        for s in range(2):                                                               # two skirts, turned against each other
            skirt = S.cylinder(r * (1.0 - 0.14 * s), th * (1.0 - 0.1 * s), 8, 0.0, r_top=r * 0.10, base=(0, 0, 0), cap=True)
            S.displace(skirt, lambda v, r=r, th=th: Vector((v.x, v.y, v.z - 0.10 * th * (math.hypot(v.x, v.y) / max(r, 1e-6)) *
                                                             (1 + 0.6 * math.cos(4 * math.atan2(v.y, v.x))))))
            S.rotate(skirt, (0, 0, 22.5 * s + 11 * q))
            add(m, S.translate(skirt, (0, 0, z + 0.12 * th + 0.04 * th * s)), 'YdPine' if (q + s) % 2 else 'YdPineDark')
    if st == 3:                                                                          # dropped cones
        for (x, y) in ((0.50, -0.42), (-0.48, 0.30), (0.10, 0.62)):
            add(m, S.sphere(0.045, 5, 4, loc=(x, y, 0.04), scale=(0.8, 0.8, 1.2), rot=(70, 0, 40 * x)), 'BarkLight')


@builder('tree_bloodmaple_s1', 'tree_bloodmaple_s2', 'tree_bloodmaple_s3')
def tree_bloodmaple(m: Model, spec: LevelSpec) -> None:
    """A maple that forks low and carries a wide, dark red crown all year."""
    _tend(spec)
    st = _stage(spec)
    h = (0.85, 2.3, 4.0)[st - 1]
    r0 = (0.018, 0.07, 0.18)[st - 1]
    _base(m, st, 0.16)
    if st == 1:
        _stake(m)
    fork = (0.0, 0.0, h * 0.40)
    add(m, S.tube([(0, 0, 0.0), (0.02 * h, 0, h * 0.2), fork], r0, 7, radii=[r0 * 1.2, r0, r0 * 0.85]), 'BarkLight')
    arms = (2, 3, 4)[st - 1]
    spread = (0.10, 0.20, 0.40)[st - 1]
    cr = (0.10, 0.29, 0.58)[st - 1]
    for q in range(arms):
        a = math.tau * q / arms + 0.8
        tip = (math.cos(a) * spread, math.sin(a) * spread, h * 0.70)
        add(m, S.tube([fork, (tip[0] * 0.6, tip[1] * 0.6, h * 0.56), tip], r0 * 0.6, 5, radii=[r0 * 0.75, r0 * 0.5, r0 * 0.28]), 'BarkLight')
        add(m, S.blob(cr, 1 if st == 1 else 2, 0.17, 2.0, seed=80 + 7 * st + q, loc=(tip[0], tip[1], tip[2] + cr * 0.30),
                      scale=(1.0, 1.0, 0.66)), 'YdMaple' if q % 2 else 'YdMapleDark')
    add(m, S.blob(cr * 1.05, 1 if st == 1 else 2, 0.15, 1.8, seed=90 + st, loc=(0, 0, h - cr * 0.80), scale=(1.1, 1.1, 0.74)), 'YdMaple')
    if st == 3:                                                                          # fallen leaves
        for i in range(7):
            a = 2.4 * i
            d = 0.45 + 0.07 * (i % 4)
            add(m, S.cylinder(0.05, 0.006, 5, 0.0, base=(math.cos(a) * d, math.sin(a) * d, 0.0)), 'YdMaple' if i % 2 else 'YdMapleDark')


# ─────────────────────────────────────────── flower beds ───────────────────────────────────────────

def _bed_soil(m: Model) -> None:
    add(m, S.box(1.70, 0.74, 0.10, 0.03, 1, base=(0, 0, 0)), 'Soil')


@builder('flowerbed_nightshade')
def flowerbed_nightshade(m: Model, spec: LevelSpec) -> None:
    """Deadly nightshade in a ring of field stones: purple bells and black berries."""
    _tend(spec)
    j = m.rng
    _bed_soil(m)
    for k in range(14):                                                                  # the stone border
        a = math.tau * k / 14
        sz = j.uniform(0.07, 0.10)
        add(m, S.blob(sz, 1, 0.25, 2.6, seed=100 + k, loc=(0.86 * math.cos(a), 0.39 * math.sin(a), sz * 0.45),
                      scale=(1.25, 1.0, 0.65), flat_bottom=-0.7), 'GyStone' if k % 3 else 'GyStoneDark')
    for i in range(7):
        x = -0.60 + 0.20 * i
        y = 0.10 * (1 if i % 2 else -1)
        h = 0.26 + 0.03 * (i % 3)
        add(m, S.tube([(x, y, 0.08), (x + 0.02, y, h)], 0.010, 4), 'YdVine')
        for q in range(3):
            leaf(m, (x, y, 0.12 + 0.05 * q), 0.07, 120 * q + 40 * i, 20, 'YdLeafAppleDark')
        add(m, S.cylinder(0.012, 0.06, 6, 0.0, r_top=0.035, base=(x + 0.02, y, h - 0.02), rot=(150, 0, 40 * i)), 'YdPetalPurple')
        add(m, S.sphere(0.022, 5, 3, loc=(x - 0.04, y + 0.03, h * 0.62)), 'YdBerry')


@builder('flowerbed_marigold')
def flowerbed_marigold(m: Model, spec: LevelSpec) -> None:
    """Grave marigolds in a low timber frame."""
    _tend(spec)
    _bed_soil(m)
    for s in (-1, 1):
        add(m, S.box(1.84, 0.05, 0.14, 0.006, 1, base=(0, s * 0.41, 0)), 'YdPlankDark')
        add(m, S.box(0.05, 0.78, 0.14, 0.006, 1, base=(s * 0.895, 0, 0)), 'YdPlankDark')
    for i in range(9):
        x = -0.68 + 0.17 * i
        y = (-0.16, 0.14, 0.0)[i % 3]
        h = 0.20 + 0.03 * (i % 2)
        add(m, S.tube([(x, y, 0.08), (x, y, h)], 0.009, 4), 'YdVine')
        for q in range(2):
            leaf(m, (x, y, 0.13), 0.065, 180 * q + 50 * i, 25, 'YdVine', 0.5)
        add(m, S.sphere(0.05, 7, 4, loc=(x, y, h + 0.02), scale=(1, 1, 0.62)), 'YdPetalOrange')
        add(m, S.sphere(0.022, 5, 3, loc=(x, y, h + 0.045), scale=(1, 1, 0.6)), 'YdPumpkin')


@builder('flowerbed_lily')
def flowerbed_lily(m: Model, spec: LevelSpec) -> None:
    """White funeral lilies behind a border of knuckle bones."""
    _tend(spec)
    _bed_soil(m)
    for k in range(16):                                                                  # bone border along the front and the ends
        if k < 10:
            x, y, rz = -0.78 + 0.173 * k, -0.40, 0
        else:
            s = -1 if k < 13 else 1
            x, y, rz = s * 0.88, -0.24 + 0.24 * ((k - 10) % 3), 90
        add(m, S.sphere(0.036, 5, 3, loc=(x, y, 0.035), scale=(1.9, 0.85, 0.85), rot=(0, 0, rz)), 'Bone')
    for i in range(6):
        x = -0.62 + 0.25 * i
        y = 0.10 if i % 2 else -0.04
        h = 0.40 + 0.04 * (i % 3)
        add(m, S.tube([(x, y, 0.08), (x + 0.01, y, h * 0.6), (x + 0.03, y - 0.02, h)], 0.011, 4), 'YdVine')
        for q in range(3):
            leaf(m, (x, y, 0.10), 0.13, 120 * q + 35 * i, 62, 'YdCabbageLeaf', 0.28)
        add(m, S.cylinder(0.012, 0.09, 6, 0.0, r_top=0.062, base=(x + 0.03, y - 0.02, h - 0.01), rot=(-35, 0, 0)), 'YdPetalWhite')
        add(m, S.sphere(0.014, 5, 3, loc=(x + 0.03, y - 0.06, h + 0.05)), 'YdPetalOrange')
