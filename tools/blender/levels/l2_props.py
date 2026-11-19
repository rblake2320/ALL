"""L2 props: firepit_grill, vending_gravecola (Grave-Cola sponsor), den_stray (cat/dog/raccoon), rack_tools,
mower_mulchmaster (Mulch Master sponsor), shovel_trusty, rod_bent, plaque_fish (+gold), board_notice, shelf_curio,
bowl_pet, bed_pet, carry_shovel, carry_rod.

Brand slots (MONETIZATION §BrandSlots): the house-brand look is built in, a BrandSkin can re-tint the 'Livery'
material and replace the 'brand_decal' node's plate (a flat front-facing quad + wordmark). House brands only."""
from __future__ import annotations

import math

from mathutils import Vector

from common import shapes as S
from common.model import Model
from objects.parts import add_broken, mold_blotch

from .kit import LevelSpec, add, builder, dome, flat_text, front_poly, node, quad


# ───────────────────────────── firepit_grill ─────────────────────────────

@builder('firepit_grill')
def firepit_grill(m: Model, spec: LevelSpec) -> None:
    j = m.rng
    add(m, dome(0.62, 0.62, 0.03, 1, 14, None, power=2.0), 'Ash')
    for k in range(10):  # chunky ring stones
        a = math.tau * k / 10 + j.sym(0.08)
        w = j.uniform(0.2, 0.26)
        st = S.taper_box(w, 0.2, w * 0.8, 0.15, j.uniform(0.15, 0.22), 0.03, 1)
        S.rotate(st, (j.sym(6), j.sym(6), math.degrees(a) + 90))
        add(m, S.translate(st, (math.cos(a) * 0.55, math.sin(a) * 0.55, 0.0)), 'GyStone' if k % 3 else 'GyStoneDark')
    for k, (a, l) in enumerate(((0.3, 0.6), (2.2, 0.55), (4.1, 0.58))):  # logs leaning into a teepee
        c, s = math.cos(a), math.sin(a)
        add(m, S.tube([(c * 0.32, s * 0.32, 0.04), (c * 0.05, s * 0.05, 0.24)], 0.045, 7), 'Bark')
    node(m, 'flame', 'flame', origin=(0, 0, 0.1), flicker='fire')
    for k in range(5):
        a = math.tau * k / 5
        add(m, S.ico(0.06, 1, loc=(math.cos(a) * 0.15, math.sin(a) * 0.15, 0.05), scale=(1.2, 1, 0.6)), 'CoalGlow', 'flame')
    add(m, S.flame(0.32, 0.12, base=(0, 0, 0.05)), 'FireOuter', 'flame')
    add(m, S.flame(0.22, 0.08, base=(0.06, 0.02, 0.06)), 'FireMid', 'flame')
    add(m, S.flame(0.14, 0.05, base=(-0.03, -0.02, 0.07)), 'FireCore', 'flame')
    # grate on four little legs
    for sx in (-1, 1):
        for sy in (-1, 1):
            add(m, S.cylinder(0.014, 0.4, 5, 0.0, base=(sx * 0.33, sy * 0.33, 0.0)), 'Iron')
    for k in range(6):
        add(m, S.box(0.7, 0.018, 0.018, 0.0, 0, base=(0, -0.3 + k * 0.12, 0.4)), 'Iron')
    for sy in (-1, 1):
        add(m, S.box(0.72, 0.03, 0.03, 0.0, 0, base=(0, sy * 0.33, 0.39)), 'Iron')
    # tripod + hook + kettle at the side
    apex = Vector((0.62, 0.42, 1.08))
    for k in range(3):
        a = math.tau * k / 3 + 0.4
        add(m, S.tube([(apex.x + math.cos(a) * 0.3, apex.y + math.sin(a) * 0.3, 0.0), tuple(apex)], 0.016, 5), 'Iron')
    add(m, S.tube([tuple(apex), (apex.x, apex.y, 0.78)], 0.006, 3), 'Iron')
    add(m, S.lathe([(0.0, 0.48), (0.1, 0.5), (0.13, 0.58), (0.11, 0.66), (0.05, 0.7), (0.0, 0.71)], 10,
                   base=(apex.x, apex.y, 0.0)), 'Iron')
    add(m, S.tube([(apex.x + 0.1, apex.y, 0.6), (apex.x + 0.2, apex.y, 0.65), (apex.x + 0.24, apex.y, 0.7)], 0.015, 4), 'Iron')
    add(m, S.torus(0.09, 0.008, 10, 3, loc=(apex.x, apex.y, 0.74), rot=(90, 0, 0), arc=180), 'Iron')
    # spare log pile
    for k in range(3):
        add(m, S.cylinder(0.06, 0.5, 8, 0.01, base=(-0.62 + (k % 2) * 0.13, 0.62 - 0.25, 0.06 + 0.1 * (k == 2)),
                          rot=(-90, 0, 10)), 'Bark')


# ───────────────────────────── vending_gravecola ─────────────────────────────

@builder('vending_gravecola')
def vending_gravecola(m: Model, spec: LevelSpec) -> None:
    """Chunky retro soda machine in Grave-Cola livery: rounded cabinet, cracked glowing front panel with bottle
    silhouettes ('screen'), coin column, dispenser flap, cream header banner with the wordmark ('brand_decal')."""
    j = m.rng
    W, D, H = 0.82, 0.66, 1.78
    for sx in (-1, 1):
        for sy in (-1, 1):
            add(m, S.cylinder(0.035, 0.06, 8, 0.01, base=(sx * 0.33, sy * 0.25, 0.0)), 'Iron')
    body = S.box(W, D, H - 0.06, 0.07, 3, base=(0, 0.02, 0.06))
    add(m, body, 'Livery')
    add(m, S.box(W + 0.02, D + 0.02, 0.06, 0.02, 1, base=(0, 0.02, 0.06)), 'LiveryAccent')
    add(m, S.box(W + 0.04, D + 0.04, 0.08, 0.03, 2, base=(0, 0.02, H - 0.04)), 'LiveryAccent')
    yf = 0.02 - D / 2
    # glowing panel (left 2/3) with bottle silhouettes and a crack
    add(m, S.box(0.52, 0.03, 0.98, 0.01, 1, base=(-0.1, yf - 0.005, 0.55)), 'PlasticDark')
    node(m, 'screen', 'screen', origin=(-0.1, yf - 0.03, 1.04))
    add(m, quad(0.46, 0.9, (-0.1, yf - 0.022, 1.04)), 'ScreenSoda', 'screen')
    for row in range(3):
        for k in range(4):
            x = -0.27 + k * 0.11
            z = 0.66 + row * 0.29
            bottle = [(-0.035, 0.0), (0.035, 0.0), (0.035, 0.12), (0.014, 0.18), (0.014, 0.22), (-0.014, 0.22),
                      (-0.014, 0.18), (-0.035, 0.12)]
            add(m, front_poly(bottle, (x, yf - 0.026, z)), 'BloodWine')
    crack = S.jagged((0.05, 0, 1.38), (-0.05, 0, 1.12), 4, 0.03, j)
    add(m, S.tube([Vector((p.x, yf - 0.04, p.z)) for p in crack], 0.005, 3), 'Crack')
    add(m, S.tube([(0.0, yf - 0.04, 1.25), (0.07, yf - 0.04, 1.2)], 0.004, 3), 'Crack')
    # coin column
    add(m, S.box(0.2, 0.03, 0.98, 0.01, 1, base=(0.28, yf - 0.005, 0.55)), 'LiveryAccent')
    for k, mat in enumerate(('Magnet1', 'Magnet3', 'Magnet2')):
        add(m, S.cylinder(0.025, 0.02, 8, 0.004, base=(0.28, yf - 0.02, 1.32 - k * 0.09), rot=(90, 0, 0)), mat)
    add(m, S.box(0.08, 0.02, 0.025, 0.004, 1, base=(0.28, yf - 0.025, 0.98)), 'Black')
    add(m, S.box(0.12, 0.02, 0.08, 0.008, 1, base=(0.28, yf - 0.025, 0.8)), 'Chrome')
    # dispenser flap
    add(m, S.box(0.56, 0.06, 0.22, 0.02, 2, base=(-0.05, yf - 0.02, 0.2)), 'PlasticDark')
    add(m, S.box(0.48, 0.03, 0.14, 0.01, 1, base=(-0.05, yf - 0.05, 0.24), rot=(12, 0, 0)), 'Black')
    # side stripe + a dent
    for sx in (-1, 1):
        add(m, S.box(0.01, D * 0.8, 0.14, 0.0, 0, base=(sx * (W / 2 + 0.003), 0.02, 1.1)), 'LiveryAccent')
    # header banner (brand slot)
    node(m, 'brand_decal', 'brand', origin=(0, yf - 0.03, 1.62), slot='front')
    add(m, quad(0.74, 0.18, (0, yf - 0.012, 1.62)), 'Decal', 'brand_decal')
    add(m, flat_text('GRAVE-COLA', 0.095, (0.06, yf - 0.016, 1.615)), 'DecalInk', 'brand_decal')
    cap = S.cylinder(0.05, 0.01, 12, 0.0, base=(-0.31, yf - 0.014, 1.62), rot=(90, 0, 0))
    add(m, cap, 'BloodWine', 'brand_decal')
    for sx in (-1, 1):  # little bat wings on the bottle-cap logo
        wing = [(0.0, 0.0), (sx * 0.07, 0.03), (sx * 0.06, -0.005), (sx * 0.045, 0.005), (sx * 0.03, -0.01)]
        if sx < 0:
            wing = [wing[0]] + wing[1:][::-1]
        add(m, front_poly(wing, (-0.31 + sx * 0.045, yf - 0.02, 1.62)), 'DecalInk', 'brand_decal')
    add_broken(m, (0.1, yf - 0.05, H + 0.05), 1.0)


# ───────────────────────────── den_stray ─────────────────────────────

@builder('den_stray_cat')
def den_cat(m: Model, spec: LevelSpec) -> None:
    """Cardboard box on its side, opening to the front, folded blanket inside, a saucer of milk."""
    W, D, H, t = 0.62, 0.5, 0.42, 0.014
    rot = (0, 3, 0)
    parts = [S.box(W, D, t, 0.0, 0, base=(0, 0.05, 0.0)), S.box(W, D, t, 0.0, 0, base=(0, 0.05, H - t)),
             S.box(t, D, H, 0.0, 0, base=(-W / 2, 0.05, 0.0)), S.box(t, D, H, 0.0, 0, base=(W / 2, 0.05, 0.0)),
             S.box(W, t, H, 0.0, 0, base=(0, 0.05 + D / 2, 0.0))]
    for p in parts:
        S.rotate(p, rot)
        add(m, p, 'Cardboard')
    # flaps flopping open at the front
    add(m, S.box(W - 0.02, 0.2, t, 0.0, 0, loc=(0, 0.05 - D / 2 - 0.08, H + 0.02), rot=(-30, 3, 0)), 'Cardboard')
    add(m, S.box(0.18, t, H - 0.04, 0.0, 0, loc=(-W / 2 - 0.07, 0.05 - D / 2 - 0.06, H / 2), rot=(0, 3, 40)), 'Cardboard')
    node(m, 'opening', origin=(0, 0.05 + D / 2 - 0.02, H / 2))
    add(m, quad(W - 0.04, H - 0.04, (0, 0.05 + D / 2 - 0.01, H / 2)), 'CushionDark', 'opening')
    add(m, S.cushion(0.46, 0.34, 0.08, 0.01, 0.4, loc=(0, 0.08, 0.055), segs=10, rings=5), 'Cushion')
    add(m, S.lathe([(0.0, 0.0), (0.07, 0.0), (0.09, 0.025), (0.0, 0.02)], 10, base=(0.2, -0.3, 0.0)), 'Enamel')
    add(m, S.box(0.08, 0.02, 0.04, 0.0, 0, base=(-0.05, 0.05 - D / 2 - 0.01, H - 0.12)), 'Ink')


@builder('den_stray_dog')
def den_dog(m: Model, spec: LevelSpec) -> None:
    """Upturned wooden crate on its side with a sack bed and a chewed toy bone."""
    W, D, H = 0.7, 0.56, 0.48
    j = m.rng
    for z in (0.0, H - 0.04):
        for k in range(2):
            add(m, S.box(W, 0.24, 0.04, 0.0, 0, base=(0, 0.05 - 0.13 + k * 0.27, z)), 'Planks')
    for sx in (-1, 1):
        add(m, S.box(0.04, D, 0.2, 0.0, 0, base=(sx * (W / 2 - 0.02), 0.05, 0.14)), 'Planks')
    for k in range(3):
        add(m, S.box(W, 0.04, 0.12, 0.0, 0, base=(0, 0.05 + D / 2, 0.04 + k * 0.15)), 'WoodDark')
    for sx in (-1, 1):
        add(m, S.box(0.05, 0.05, H, 0.0, 0, base=(sx * (W / 2 - 0.03), 0.05 - D / 2 + 0.03, 0.0)), 'WoodDark')
    node(m, 'opening', origin=(0, 0.05 + D / 2 - 0.03, H / 2))
    add(m, quad(W - 0.1, H - 0.1, (0, 0.05 + D / 2 - 0.025, H / 2)), 'CushionDark', 'opening')
    add(m, S.cushion(0.56, 0.4, 0.08, 0.02, 0.4, loc=(0, 0.06, 0.08), segs=10, rings=5), 'Straw')
    bone = S.bone(0.16, 0.016, 1.9, segs=5)
    S.rotate(bone, (0, 0, 25))
    add(m, S.translate(bone, (0.08, -0.36, 0.028)), 'Bone')


@builder('den_stray_raccoon')
def den_raccoon(m: Model, spec: LevelSpec) -> None:
    """Old drainpipe end half-sunk in a mound, mouth to the front; a dented tin can and an apple core outside."""
    j = m.rng
    R, L = 0.24, 0.62
    add(m, dome(0.42, 0.42, 0.16, 2, 10, j, power=2.0, loc=(0, 0.07, 0)), 'GyDirt')   # the mound stays on its tile (W-073)
    add(m, S.cylinder(R, L, 12, 0.0, base=(0, -0.3 + L, R - 0.02), rot=(90, 0, 0), cap=False), 'GyStoneDark')
    for k in range(3):
        add(m, S.torus(R + 0.012, 0.02, 12, 3, loc=(0, -0.28 + k * 0.24, R - 0.02), rot=(90, 0, 0)), 'GyStone')
    node(m, 'opening', origin=(0, 0.25, R))
    add(m, front_poly([(math.cos(a) * (R - 0.02), math.sin(a) * (R - 0.02)) for a in (math.tau * k / 12 for k in range(12))],
                      (0, 0.25, R - 0.02)), 'Void', 'opening')
    add(m, S.cylinder(0.05, 0.11, 8, 0.0, base=(0.3, -0.35, 0.05), rot=(90, 0, 70)), 'Tin')
    add(m, S.lathe([(0.0, 0.0), (0.025, 0.01), (0.015, 0.04), (0.03, 0.07), (0.0, 0.08)], 6, base=(-0.3, -0.38, 0.0)),
        'Peel')


# ───────────────────────────── rack_tools ─────────────────────────────

def _shovel(top, length: float = 1.15, blade=(0.22, 0.28)):
    """Spade hanging blade-down from ``top`` (x, y, z) along -Z: D-grip, shaft, collar, blade."""
    x, y, z = top
    shaft = S.cylinder(0.017, length - 0.3, 6, 0.0, base=(x, y, z - length + 0.3))
    grip = S.torus(0.05, 0.012, 8, 3, loc=(x, y, z - 0.03), rot=(90, 0, 0))
    collar = S.cylinder(0.026, 0.1, 6, 0.0, base=(x, y, z - length + 0.24))
    bw, bh = blade
    pts = [(-bw / 2, 0.0), (bw / 2, 0.0), (bw / 2, -bh * 0.75), (0.0, -bh), (-bw / 2, -bh * 0.75)]
    bl = S.prism(pts, 0.012, 0.004, 1, plane='XZ', loc=(x, y, z - length + 0.26))
    return S.merge(shaft, grip), collar, bl


def _rod(top, length: float = 1.15, bend: float = 0.08):
    x, y, z = top
    pts = [(x, y, z), (x + bend * 0.3, y, z - length * 0.35), (x + bend, y, z - length * 0.7), (x + bend * 0.6, y, z - length)]
    rod = S.tube(S.catmull(pts, 2), radii=None, radius=0.01, segs=4)
    reel = S.cylinder(0.035, 0.025, 8, 0.0, base=(x + bend * 0.1 + 0.02, y, z - length * 0.2), rot=(0, 90, 0))
    return rod, reel


@builder('rack_tools')
def rack_tools(m: Model, spec: LevelSpec) -> None:
    """Wall-backed plank rack (back at -Z): 3 shovels + 3 bent rods on pegs, a lantern, a 'PLEASE RETURN' sign.
    Every tool is its own node so the runtime can hide one while it is borrowed."""
    j = m.rng
    yb = 0.38
    for k in range(5):
        add(m, S.box(0.17, 0.05, 1.72, 0.0, 0, base=(-0.36 + k * 0.18, yb, 0.0), rot=(0, j.sym(0.8), 0)), 'Planks')
    for z in (0.35, 1.45):
        add(m, S.box(0.94, 0.04, 0.09, 0.008, 1, base=(0, yb - 0.045, z)), 'WoodDark')
    for sx in (-1, 1):
        add(m, S.box(0.08, 0.3, 0.06, 0.008, 1, base=(sx * 0.42, yb - 0.1, 0.0)), 'WoodDark')
    add(m, S.box(0.99, 0.24, 0.05, 0.01, 1, base=(0, yb - 0.08, 1.72), rot=(-12, 0, 0)), 'Shingle')   # inside the tile (W-073)
    # pegs
    for k in range(6):
        add(m, S.box(0.02, 0.09, 0.02, 0.0, 0, base=(-0.36 + k * 0.144, yb - 0.065, 1.46)), 'WoodDark')
    for k in range(3):
        nm = f'shovel_{k}'
        node(m, nm, 'tool', origin=(-0.36 + k * 0.144, yb - 0.11, 1.5), tool='shovel')
        a, b, c = _shovel((-0.36 + k * 0.144, yb - 0.11, 1.56), 1.2)
        add(m, a, 'Wood', nm)
        add(m, b, 'Iron', nm)
        add(m, c, 'Steel' if k != 1 else 'Rust', nm)
    for k in range(3):
        nm = f'rod_{k}'
        x = 0.07 + k * 0.144
        node(m, nm, 'tool', origin=(x, yb - 0.1, 1.5), tool='rod')
        rod, reel = _rod((x, yb - 0.1, 1.56), 1.2, 0.05 + 0.03 * k)
        add(m, rod, 'Bamboo', nm)
        add(m, reel, 'Iron', nm)
        add(m, S.sphere(0.025, 6, 4, loc=(x + 0.05 + 0.03 * k, yb - 0.1, 0.38)), 'FloatRed', nm)
    # lantern on a hook at the right edge, inside the tile (W-073)
    add(m, S.tube([(0.42, yb - 0.04, 1.62), (0.42, yb - 0.12, 1.62), (0.42, yb - 0.12, 1.56)], 0.008, 3), 'Iron')
    add(m, S.box(0.1, 0.1, 0.13, 0.008, 1, base=(0.42, yb - 0.12, 1.36)), 'Iron')
    node(m, 'bulb', 'bulb', origin=(0.42, yb - 0.12, 1.42), flicker='candle')
    add(m, S.cylinder(0.035, 0.1, 8, 0.0, base=(0.42, yb - 0.12, 1.375)), 'Lantern', 'bulb')
    add(m, S.taper_box(0.13, 0.13, 0.03, 0.03, 0.06, 0.0, 0, base=(0.42, yb - 0.12, 1.49)), 'Iron')
    # sign
    add(m, S.box(0.66, 0.025, 0.14, 0.008, 1, base=(-0.05, yb - 0.08, 1.56), rot=(0, 2, 0)), 'PaperOld')
    t = flat_text('PLEASE RETURN', 0.055, (-0.05, yb - 0.096, 1.63))
    S.rotate(t, (0, 2, 0), pivot=(-0.05, yb - 0.08, 1.56))
    add(m, t, 'BloodWine', 'sign')


# ───────────────────────────── mower_mulchmaster ─────────────────────────────

@builder('mower_mulchmaster')
def mower_mulchmaster(m: Model, spec: LevelSpec) -> None:
    """Small ride-on mower facing +X (the seat is mounted from the model front, -Y): chunky tyres, rounded hood with
    the Mulch Master decal on its front-facing side, seat, steering wheel, mower deck, rear grass catcher."""
    def wheel(x, r, w):
        t = S.cylinder(r, w, 14, 0.03, base=(x, -0.3 - w / 2, r), rot=(-90, 0, 0))
        t2 = S.cylinder(r, w, 14, 0.03, base=(x, 0.3 - w / 2, r), rot=(-90, 0, 0))
        h1 = S.cylinder(r * 0.55, 0.02, 10, 0.0, base=(x, -0.3 - w / 2 - 0.012, r), rot=(-90, 0, 0))
        h2 = S.cylinder(r * 0.55, 0.02, 10, 0.0, base=(x, 0.3 + w / 2 - 0.008, r), rot=(-90, 0, 0))
        add(m, S.merge(t, t2), 'Tire')
        add(m, S.merge(h1, h2), 'LiveryAccent')

    wheel(-0.5, 0.26, 0.2)
    wheel(0.55, 0.16, 0.14)
    # chassis + deck
    add(m, S.box(1.5, 0.56, 0.18, 0.04, 2, base=(0.0, 0.0, 0.18)), 'LiveryMower')
    add(m, S.box(0.8, 0.82, 0.08, 0.03, 2, base=(0.05, 0.0, 0.1)), 'SheetMetal')
    hood = S.box(0.62, 0.54, 0.3, 0.1, 3, base=(0.45, 0.0, 0.34))
    S.displace(hood, lambda v: v + Vector((0, 0, -0.08 * max(0.0, v.x - 0.5) / 0.26)))
    add(m, hood, 'LiveryMower')
    add(m, S.box(0.1, 0.5, 0.12, 0.02, 1, base=(0.78, 0.0, 0.28)), 'Black')
    for sy in (-1, 1):
        add(m, S.sphere(0.04, 8, 5, loc=(0.79, sy * 0.17, 0.4), scale=(0.6, 1, 1)), 'Lantern')
    # seat
    add(m, S.box(0.4, 0.5, 0.12, 0.02, 1, base=(-0.3, 0.0, 0.36)), 'Black')
    add(m, S.cushion(0.36, 0.42, 0.09, 0.012, 0.4, loc=(-0.32, 0.0, 0.53)), 'Leather')
    back = S.cushion(0.1, 0.42, 0.3, 0.01, 0.4, loc=(-0.52, 0.0, 0.7))
    S.rotate(back, (0, -12, 0), pivot=(-0.52, 0, 0.55))
    add(m, back, 'Leather')
    # steering
    add(m, S.cylinder(0.025, 0.5, 6, 0.0, base=(0.25, 0.0, 0.5), rot=(0, -28, 0)), 'Iron')
    add(m, S.torus(0.14, 0.022, 14, 4, loc=(0.03, 0.0, 0.94), rot=(0, -62, 0)), 'Rubber')
    # grass catcher at the rear
    add(m, S.box(0.36, 0.52, 0.32, 0.05, 2, base=(-0.82, 0.0, 0.2)), 'RubberGreen')
    add(m, S.box(0.36, 0.5, 0.03, 0.01, 1, base=(-0.82, 0.0, 0.52)), 'Iron')
    add(m, S.blob(0.12, 1, 0.3, 3.0, 2, loc=(-0.82, 0.0, 0.55), scale=(1.2, 1.6, 0.4)), 'GrassDry')
    add(m, S.cylinder(0.025, 0.2, 6, 0.0, base=(0.3, 0.22, 0.55)), 'Chrome')
    # brand slot: decal on the hood's front-facing (-Y) side + a little leaf mark
    yd = -0.275
    node(m, 'brand_decal', 'brand', origin=(0.45, yd - 0.01, 0.48), slot='hood')
    add(m, quad(0.46, 0.14, (0.44, yd - 0.004, 0.5)), 'Decal', 'brand_decal')
    add(m, flat_text('MULCH MASTER', 0.052, (0.46, yd - 0.008, 0.5)), 'DecalInk', 'brand_decal')
    leaf = [(0.0, -0.03), (0.02, 0.0), (0.0, 0.035), (-0.02, 0.0)]
    add(m, S.prism(leaf, 0.003, 0.0, 0, plane='XZ', loc=(0.26, yd - 0.008, 0.5)), 'Leaf', 'brand_decal')
    add(m, flat_text('MM', 0.05, (-0.82, -0.263, 0.36)), 'LiveryAccent', 'sign')


# ───────────────────────────── wall tools / trophy ─────────────────────────────

@builder('shovel_trusty')
def shovel_trusty(m: Model, spec: LevelSpec) -> None:
    for x in (-0.08, 0.08):
        add(m, S.cylinder(0.015, 0.1, 6, 0.0, base=(x, 0.0, 1.62), rot=(90, 0, 0)), 'WoodDark')
        add(m, S.box(0.06, 0.02, 0.06, 0.006, 1, base=(x, -0.01, 1.59)), 'Iron')
    a, b, c = _shovel((0.0, -0.065, 1.78), 1.28, (0.26, 0.32))
    add(m, a, 'WoodLight')
    add(m, b, 'Iron')
    add(m, c, 'Steel')
    add(m, S.box(0.1, 0.004, 0.06, 0.0, 0, base=(0.04, -0.075, 0.68)), 'GyDirt')


@builder('rod_bent')
def rod_bent(m: Model, spec: LevelSpec) -> None:
    for x in (-0.3, 0.3):
        add(m, S.cylinder(0.014, 0.1, 6, 0.0, base=(x, 0.0, 1.62), rot=(90, 0, 0)), 'WoodDark')
    pts = [(-0.52, -0.06, 1.66), (-0.2, -0.06, 1.66), (0.2, -0.06, 1.63), (0.5, -0.06, 1.55)]
    add(m, S.tube(S.catmull(pts, 2), radii=[0.016, 0.015, 0.013, 0.012, 0.01, 0.009, 0.007], segs=5), 'Bamboo')
    for x in (-0.2, 0.25):
        add(m, S.torus(0.017, 0.005, 6, 3, loc=(x, -0.06, 1.65 - 0.01 * (x > 0)), rot=(0, 90, 0)), 'Fringe')
    add(m, S.cylinder(0.045, 0.03, 10, 0.0, base=(-0.42, -0.06 - 0.015, 1.6), rot=(90, 0, 0)), 'Iron')
    add(m, S.tube([(0.5, -0.06, 1.55), (0.49, -0.07, 1.3), (0.48, -0.07, 1.15)], 0.002, 3), 'Line')
    add(m, S.sphere(0.04, 8, 6, loc=(0.48, -0.07, 1.15)), 'FloatRed')
    add(m, S.cylinder(0.041, 0.012, 8, 0.0, base=(0.48, -0.07, 1.145)), 'Bone')
    add(m, S.cone(0.008, 0.05, 4, base=(0.48, -0.07, 1.19)), 'Bone')


def _fish_body(L: float, H: float, T: float, n: int = 8):
    """Side-on fish (length along X, height along Z, thickness along Y) as a lofted lens + tail + fins."""
    rings = []
    for i in range(n + 1):
        t = i / n
        x = -L / 2 + L * t
        h = H * math.sin(math.pi * (0.08 + 0.84 * t)) ** 0.8 * (1.0 - 0.25 * t)
        w = T * math.sin(math.pi * (0.08 + 0.84 * t)) ** 0.9
        ring = [(x, math.sin(a) * w / 2, math.cos(a) * h / 2) for a in (math.tau * k / 8 for k in range(8))]
        rings.append(ring)
    body = S.loft(rings, cap_bottom=True, cap_top=True)
    tail = S.prism([(0.0, 0.0), (-L * 0.28, H * 0.42), (-L * 0.2, 0.0), (-L * 0.28, -H * 0.42)], T * 0.18, 0.0, 0,
                   plane='XZ', loc=(-L / 2 + 0.02, 0, 0))
    dorsal = S.prism([(-L * 0.15, 0.0), (L * 0.12, 0.0), (-L * 0.08, H * 0.28)], T * 0.12, 0.0, 0, plane='XZ',
                     loc=(0, 0, H * 0.42))
    return body, S.merge(tail, dorsal)


@builder('plaque_fish', 'plaque_fish_gold')
def plaque_fish(m: Model, spec: LevelSpec) -> None:
    """Oval wooden plaque with a leaping fish (the fish is 'Paint': the runtime tints it per species) and a brass
    label. The Bones variant gets a gold frame."""
    gold = spec.variant == 'gold'
    cz = 1.5
    pts = [(math.cos(a) * 0.34, math.sin(a) * 0.2) for a in (math.tau * k / 16 for k in range(16))]
    add(m, S.prism(pts, 0.035, 0.0, 0, plane='XZ', loc=(0, -0.0175, cz)), 'WoodDark')
    if gold:
        ring = [(math.cos(a) * 0.35, -0.04, cz + math.sin(a) * 0.21) for a in (math.tau * k / 14 for k in range(14))]
        add(m, S.tube(ring, 0.022, 4, closed=True), 'Gold')
    body, fins = _fish_body(0.46, 0.15, 0.07)
    for bm in (body, fins):
        S.rotate(bm, (0, -14, 0))
        S.translate(bm, (0.02, -0.085, cz + 0.02))
    add(m, body, 'Paint')
    add(m, fins, 'Paint')
    add(m, S.sphere(0.014, 6, 4, loc=(0.2, -0.115, cz + 0.07)), 'Black')
    add(m, S.box(0.2, 0.012, 0.05, 0.004, 1, base=(0.0, -0.04, cz - 0.17)), 'Gold' if gold else 'Brass')
    add(m, flat_text('THE BIG ONE', 0.024, (0.0, -0.047, cz - 0.145)), 'Ink', 'sign')


# ───────────────────────────── board_notice ─────────────────────────────

@builder('board_notice')
def board_notice(m: Model, spec: LevelSpec) -> None:
    j = m.rng
    for sx in (-1, 1):
        add(m, S.box(0.08, 0.08, 1.6, 0.012, 1, base=(sx * 0.41, 0.05, 0.0), rot=(0, j.sym(1.5), 0)), 'WoodDark')   # inside the tile (W-073)
    add(m, S.box(0.92, 0.06, 0.66, 0.015, 1, base=(0, 0.05, 0.86)), 'Wood')
    add(m, S.box(0.84, 0.03, 0.58, 0.0, 0, base=(0, 0.02, 0.9)), 'Cork')
    roof = S.prism([(-0.51, 0.0), (0.51, 0.0), (0.0, 0.2)], 0.3, 0.015, 1, plane='XZ', loc=(0, 0.05, 1.55))
    add(m, roof, 'Shingle')
    papers = (((-0.25, 1.28), 0.22, 0.26, 'PaperOld', 4), ((0.05, 1.25), 0.2, 0.2, 'PaperPink', -6),
              ((0.28, 1.27), 0.2, 0.26, 'PaperGreen', 3), ((-0.15, 1.0), 0.32, 0.18, 'PaperOld', -2),
              ((0.24, 1.0), 0.2, 0.17, 'PaperOld', 7))
    for k, ((x, z), w, h, mat, rz) in enumerate(papers):
        add(m, S.box(w, 0.004, h, 0.0, 0, loc=(x, 0.0, z), rot=(0, rz, 0)), mat)
        add(m, S.sphere(0.012, 6, 3, loc=(x, -0.008, z + h / 2 - 0.03)), ('Magnet1', 'Magnet2', 'Magnet3')[k % 3])
        if k in (1, 2):
            for r in range(3):
                add(m, S.box(w * 0.6, 0.002, 0.012, 0.0, 0, loc=(x, -0.004, z - 0.02 - r * 0.04), rot=(0, rz, 0)), 'Ink')
    t = flat_text('LOST:', 0.045, (-0.25, -0.004, 1.34))
    S.rotate(t, (0, 4, 0), pivot=(-0.25, 0, 1.28))
    add(m, t, 'BloodWine', 'sign')
    t = flat_text('LEFT ARM', 0.04, (-0.25, -0.004, 1.28))
    S.rotate(t, (0, 4, 0), pivot=(-0.25, 0, 1.28))
    add(m, t, 'Ink', 'sign')
    t = flat_text('WORMS WANTED', 0.032, (-0.15, -0.004, 1.02))
    S.rotate(t, (0, -2, 0), pivot=(-0.15, 0, 1.0))
    add(m, t, 'Ink', 'sign')
    add(m, mold_blotch(0.3, 0.02, 1.55, 0.07, (0, -0.4, 1), seed=1), 'Moss')


# ───────────────────────────── shelf_curio ─────────────────────────────

@builder('shelf_curio')
def shelf_curio(m: Model, spec: LevelSpec) -> None:
    """Glass-front curio cabinet: 4 small shelves (display surfaces), bone knobs, crown moulding."""
    W, D, H = 0.78, 0.4, 1.6
    y0 = 0.05
    for sx in (-1, 1):
        add(m, S.box(0.05, D, H, 0.012, 1, base=(sx * (W / 2 - 0.025), y0, 0.08)), 'WoodDark')
        add(m, S.lathe([(0.04, 0.0), (0.05, 0.03), (0.035, 0.08)], 8, base=(sx * 0.32, y0 - 0.12, 0.0)), 'WoodDark')
        add(m, S.lathe([(0.04, 0.0), (0.05, 0.03), (0.035, 0.08)], 8, base=(sx * 0.32, y0 + 0.12, 0.0)), 'WoodDark')
    add(m, S.box(W, 0.03, H, 0.008, 1, base=(0, y0 + D / 2 - 0.015, 0.08)), 'BloodWine')
    shelves = []
    for k in range(5):
        z = 0.08 + k * 0.37
        add(m, S.box(W - 0.06, D - 0.02, 0.03, 0.006, 1, base=(0, y0, z)), 'WoodDark')
        shelves.append(round(z + 0.03, 3))
    add(m, S.box(W + 0.08, D + 0.08, 0.06, 0.02, 2, base=(0, y0, H + 0.08)), 'WoodDark')
    add(m, S.box(W - 0.1, 0.05, 0.08, 0.02, 1, base=(0, y0 - D / 2 + 0.02, H + 0.14)), 'WoodDark')
    m.nodes[m.body].extras['surfaces'] = shelves[:4]
    # glass doors (two leaves) with frames + bone knobs
    yf = y0 - D / 2 - 0.01
    node(m, 'glass', origin=(0, yf, 0.9))
    for sx in (-1, 1):
        cx = sx * (W / 4 - 0.01)
        add(m, quad(W / 2 - 0.08, H - 0.1, (cx, yf - 0.003, 0.08 + H / 2)), 'Glass', 'glass')
        for zz in (0.1, H + 0.04):
            add(m, S.box(W / 2 - 0.02, 0.025, 0.04, 0.005, 1, base=(cx, yf, zz)), 'WoodDark')
        for xx in (cx - W / 4 + 0.03, cx + W / 4 - 0.03):
            add(m, S.box(0.035, 0.025, H - 0.02, 0.005, 1, base=(xx, yf, 0.1)), 'WoodDark')
        add(m, S.sphere(0.02, 8, 5, loc=(sx * 0.04, yf - 0.03, 0.9), scale=(1, 1, 1.4)), 'Bone')
    add(m, S.ico(0.035, 1, loc=(-0.15, y0, 0.08 + 0.37 + 0.06)), 'Porcelain')
    add(m, S.lathe([(0.0, 0.0), (0.04, 0.0), (0.04, 0.08), (0.02, 0.1), (0.0, 0.1)], 6, base=(0.18, y0, 0.08 + 0.74 + 0.03)), 'Cobalt')


# ───────────────────────────── bowl_pet / bed_pet ─────────────────────────────

@builder('bowl_pet')
def bowl_pet(m: Model, spec: LevelSpec) -> None:
    add(m, S.lathe([(0.0, 0.0), (0.11, 0.0), (0.15, 0.075), (0.16, 0.085), (0.135, 0.085), (0.1, 0.02), (0.0, 0.02)], 14),
        'Enamel')
    add(m, S.torus(0.155, 0.007, 14, 3, loc=(0, 0, 0.085)), 'EnamelRim')
    add(m, S.cylinder(0.1, 0.01, 12, 0.0, base=(0, 0, 0.02)), 'Brain')
    add(m, flat_text('GOOD BOI', 0.026, (0, -0.142, 0.052), rot=(70, 0, 0)), 'EnamelRim', 'sign')
    add(m, flat_text('(RIP)', 0.018, (0, -0.128, 0.026), rot=(70, 0, 0)), 'EnamelRim', 'sign')
    add(m, S.ico(0.025, 1, loc=(0.2, -0.05, 0.012), scale=(1, 1, 0.5)), 'Brain')


@builder('bed_pet')
def bed_pet(m: Model, spec: LevelSpec) -> None:
    j = m.rng
    sxy = (1.0, 0.78)
    add(m, S.lathe([(0.0, 0.0), (0.34, 0.0), (0.38, 0.12), (0.42, 0.24), (0.38, 0.24), (0.33, 0.08), (0.0, 0.07)], 18,
                   scale_xy=sxy), 'Wicker')
    rim = S.torus(0.41, 0.035, 18, 4, loc=(0, 0, 0.245))
    S.xf(rim, scale=(1.0, sxy[1], 1.0))
    add(m, rim, 'WickerDark')
    for k in range(14):  # weave ribs
        a = math.tau * k / 14
        c, s = math.cos(a), math.sin(a) * sxy[1]
        add(m, S.box(0.025, 0.012, 0.2, 0.0, 0, loc=(c * 0.39, s * 0.39, 0.12), rot=(0, 18 * c, math.degrees(a) + 90)),
            'WickerDark')
    add(m, S.cushion(0.6, 0.46, 0.1, 0.02, 0.45, loc=(0, 0, 0.12)), 'Cushion')
    for k in range(3):  # moth holes
        add(m, S.cylinder(0.025, 0.004, 8, 0.0, base=(j.uniform(-0.2, 0.2), j.uniform(-0.12, 0.12), 0.165)), 'CushionDark')
    add(m, S.sphere(0.045, 8, 6, loc=(0.18, -0.08, 0.2)), 'FloatRed')


# ───────────────────────────── carry props ─────────────────────────────

@builder('carry_shovel')
def carry_shovel(m: Model, spec: LevelSpec) -> None:
    """Hand prop for the proposed carry item 'shovel': origin = hand grip (mid-shaft), shaft along +Y (glTF),
    D-grip up, blade down."""
    node(m, 'grip', origin=(0, 0, 0), anchor='hand')
    a, b, c = _shovel((0.0, 0.0, 0.42), 1.05, (0.22, 0.27))
    add(m, a, 'WoodLight')
    add(m, b, 'Iron')
    add(m, c, 'Steel')


@builder('carry_rod')
def carry_rod(m: Model, spec: LevelSpec) -> None:
    """Hand prop for the proposed carry item 'rod': origin = hand grip at the reel, rod up along +Y, line + float."""
    node(m, 'grip', origin=(0, 0, 0), anchor='hand')
    pts = [(0.0, 0.0, -0.18), (0.0, 0.0, 0.3), (0.03, 0.0, 0.75), (0.1, 0.0, 1.1)]
    add(m, S.tube(S.catmull(pts, 2), radii=[0.016, 0.015, 0.013, 0.011, 0.009, 0.007, 0.005], segs=5), 'Bamboo')
    add(m, S.cylinder(0.035, 0.025, 8, 0.004, base=(0.03, 0.0, 0.05), rot=(0, 90, 0)), 'Iron')
    add(m, S.tube([(0.1, 0.0, 1.1), (0.12, 0.0, 0.85), (0.12, 0.0, 0.7)], 0.002, 3), 'Line')
    add(m, S.sphere(0.03, 8, 5, loc=(0.12, 0.0, 0.7)), 'FloatRed')
