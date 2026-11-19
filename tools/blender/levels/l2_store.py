"""L2 store tie-ins (§13: the 'Moonlit Mourning' premium set + the Bones séance table) and the Night of the Open
Gates dressing (§9: lantern_jack, bob_for_brains). Footprints for these are not given in the design doc; the ones
used here are proposals recorded in the manifest/spec table (1x1 decor, 2x1 bench/arch, 2x2 séance table)."""
from __future__ import annotations

import math

from mathutils import Vector

from common import shapes as S
from common.model import Model
from objects.parts import mold_blotch

from .kit import LevelSpec, add, builder, dome, flat_text, front_poly, node, quad, ribbon


# ───────────────────────────── statue_angelWeeping ─────────────────────────────

def _wing(sx: float):
    """Feathered wing silhouette (scalloped lower edge), extruded thin, for the left (sx=-1) or right side."""
    pts = [(0.0, 0.0), (0.12, 0.3), (0.3, 0.55), (0.42, 0.62), (0.4, 0.45), (0.36, 0.3), (0.3, 0.2), (0.32, 0.08),
           (0.24, 0.02), (0.22, -0.12), (0.14, -0.08), (0.1, -0.22), (0.04, -0.12)]
    pts = [(sx * x, z) for x, z in pts]
    if sx < 0:
        pts = pts[::-1]
    return S.prism(pts, 0.05, 0.012, 1, plane='XZ')


@builder('statue_angelWeeping')
def statue_angel(m: Model, spec: LevelSpec) -> None:
    """Mourning angel on a plinth, head bowed into her hands, wings folded half-open. Chunky toy proportions
    (big head), weathered stone with moss. (Display-name note: avoid echoing a famous TV monster's name.)"""
    add(m, S.box(0.7, 0.62, 0.16, 0.02, 1, base=(0, 0, 0)), 'GyStoneDark')
    add(m, S.box(0.56, 0.48, 0.42, 0.02, 1, base=(0, 0, 0.16)), 'GyStone')
    add(m, S.box(0.62, 0.54, 0.06, 0.015, 1, base=(0, 0, 0.58)), 'GyStoneWarm')
    robe = S.lathe([(0.24, 0.0), (0.22, 0.2), (0.17, 0.5), (0.13, 0.72), (0.15, 0.8), (0.0, 0.84)], 12,
                   scale_xy=(1.0, 0.85))
    add(m, S.translate(robe, (0, 0, 0.64)), 'GyStoneWarm')
    for k in range(5):  # robe folds
        a = math.pi * 1.1 + k * 0.28
        add(m, S.tube([(math.cos(a) * 0.22, math.sin(a) * 0.19, 0.66), (math.cos(a) * 0.15, math.sin(a) * 0.13, 1.2)],
                      radii=[0.03, 0.012], segs=4), 'GyStone')
    head_c = Vector((0.0, -0.07, 1.6))
    add(m, S.sphere(0.17, 12, 8, loc=tuple(head_c), scale=(1.0, 0.95, 1.05)), 'GyStoneWarm')
    add(m, S.blob(0.18, 1, 0.18, 2.5, 2, loc=(0.0, -0.02, 1.68), scale=(1.05, 1.0, 0.75)), 'GyStone')  # hair
    # hands raised to the face
    for sx in (-1, 1):
        add(m, S.tube([(sx * 0.15, -0.02, 1.38), (sx * 0.16, -0.14, 1.44), (sx * 0.07, -0.2, 1.53)], 0.045, 6), 'GyStoneWarm')
        add(m, S.sphere(0.055, 8, 6, loc=(sx * 0.06, -0.21, 1.56), scale=(0.8, 0.6, 1.0)), 'GyStoneWarm')
    # face details peeking between the hands: closed eyes + one tear
    node(m, 'face', origin=tuple(head_c))
    for sx in (-1, 1):
        add(m, front_poly([(-0.035, 0.0), (0.0, -0.015), (0.035, 0.0)], (sx * 0.07, -0.237, 1.64)), 'Slate', 'face')
    add(m, quad(0.016, 0.03, (0.105, -0.236, 1.6)), 'Glass', 'face')
    for sx in (-1, 1):
        w = _wing(sx)
        S.rotate(w, (0, 0, -sx * 25))
        add(m, S.translate(w, (sx * 0.1, 0.17, 1.12)), 'GyStone')
    add(m, mold_blotch(-0.2, 0.1, 0.62, 0.12, (0, 0, 1), seed=1), 'Moss')
    add(m, mold_blotch(0.25, 0.22, 1.5, 0.08, (0.3, 0.3, 1), seed=2), 'Moss')


# ───────────────────────────── bench_gothic ─────────────────────────────

@builder('bench_gothic')
def bench_gothic(m: Model, spec: LevelSpec) -> None:
    """Cast-iron gothic bench, slatted seat at SEAT_HEIGHT, pointed-arch tracery backrest at the back (-Z)."""
    j = m.rng
    for sx in (-1, 1):  # side frames: leg, arm scroll
        x = sx * 0.82
        add(m, S.box(0.06, 0.08, 0.46, 0.012, 1, base=(x, -0.18, 0.0)), 'Iron')
        add(m, S.box(0.06, 0.08, 0.98, 0.012, 1, base=(x, 0.2, 0.0)), 'Iron')
        add(m, S.tube([(x, -0.22, 0.46), (x, -0.25, 0.64), (x, -0.1, 0.68), (x, 0.18, 0.66)], 0.025, 5), 'Iron')
        add(m, S.tube(S.spiral(0.01, 0.05, 1.2, 9, center=(x, -0.2, 0.62), plane='YZ'), 0.008, 3), 'Iron')
    for k in range(4):  # seat slats
        add(m, S.box(1.7, 0.09, 0.04, 0.01, 1, base=(0, -0.2 + k * 0.11, 0.42)), 'WoodDark')
    for z in (0.5, 0.94):
        add(m, S.box(1.66, 0.04, 0.04, 0.008, 1, base=(0, 0.22, z)), 'Iron')
    for k in range(5):  # three-lobed pointed arches
        x0 = -0.66 + k * 0.33
        pts = [(x0 - 0.14, 0.22, 0.52), (x0 - 0.14, 0.22, 0.78), (x0, 0.22, 0.92), (x0 + 0.14, 0.22, 0.78),
               (x0 + 0.14, 0.22, 0.52)]
        add(m, S.tube(pts, 0.012, 4), 'Iron')
        add(m, S.torus(0.035, 0.008, 8, 3, loc=(x0, 0.22, 0.72), rot=(90, 0, 0)), 'Iron')
    for k in range(5):
        x0 = -0.66 + k * 0.33
        add(m, S.cone(0.02, 0.07, 4, base=(x0, 0.22, 0.96)), 'Iron')
    add(m, mold_blotch(0.4, -0.05, 0.47, 0.06, (0, 0, 1), seed=3), 'Moss')


# ───────────────────────────── arch_ironGate ─────────────────────────────

@builder('arch_ironGate')
def arch_iron_gate(m: Model, spec: LevelSpec) -> None:
    """Walk-through garden arch: two lattice iron posts, a round top with curls and a finial, climbing ivy with a
    few pale flowers."""
    j = m.rng
    H = 1.9
    for sx in (-1, 1):
        x = sx * 0.78
        for sy in (-1, 1):
            add(m, S.box(0.035, 0.035, H, 0.0, 0, base=(x, sy * 0.18, 0.0)), 'Iron')
        for k in range(7):
            z = 0.15 + k * 0.26
            add(m, S.box(0.02, 0.36, 0.02, 0.0, 0, base=(x, 0.0, z)), 'Iron')
            add(m, S.box(0.015, 0.36, 0.015, 0.0, 0, base=(x, 0.0, z + 0.13), rot=(30 if k % 2 else -30, 0, 0)), 'Iron')
        add(m, S.box(0.12, 0.44, 0.04, 0.01, 1, base=(x, 0.0, 0.0)), 'Iron')
    for sy in (-1, 1):
        arc = [(math.cos(a) * 0.78, sy * 0.18, H + math.sin(a) * 0.42) for a in (math.pi * k / 10 for k in range(11))]
        add(m, S.tube(arc, 0.02, 5), 'Iron')
    for k in range(1, 10, 2):
        a = math.pi * k / 10
        add(m, S.box(0.02, 0.36, 0.02, 0.0, 0, base=(math.cos(a) * 0.78, 0, H + math.sin(a) * 0.42 - 0.01)), 'Iron')
    for sx in (-1, 1):
        add(m, S.tube(S.spiral(0.01, 0.07, 1.3, 10, center=(sx * 0.4, 0.0, H + 0.12), plane='XZ', a0=0 if sx < 0 else 180),
                      0.009, 3), 'Iron')
    add(m, S.sphere(0.04, 8, 6, loc=(0, 0, H + 0.45)), 'Iron')
    add(m, S.cone(0.018, 0.08, 6, base=(0, 0, H + 0.48)), 'Iron')
    # ivy: a vine winding up the left post and over the top, leaves as little double-sided diamonds
    vine = []
    for k in range(17):
        t = k / 16
        if t < 0.55:
            z = t / 0.55 * H
            vine.append((-0.78 + 0.06 * math.sin(k * 1.7), 0.2 * math.cos(k * 1.3), z))
        else:
            a = math.pi - (t - 0.55) / 0.45 * math.pi * 0.7
            vine.append((math.cos(a) * 0.8, 0.2 * math.cos(k * 1.3), H + math.sin(a) * 0.43))
    add(m, S.tube(vine, 0.012, 4), 'Bark')
    for k, p in enumerate(vine[1:]):
        for s in (-1, 1):
            c = Vector(p) + Vector((0.06 * s, 0.05 * s, 0.02))
            add(m, S.prism([(0.0, -0.04), (0.035, 0.0), (0.0, 0.04), (-0.035, 0.0)], 0.004, 0.0, 0, plane='XZ',
                           loc=tuple(c), rot=(j.sym(40), 0, j.uniform(0, 180))), 'Leaf' if (k + s) % 3 else 'HedgeLight')
        if k % 4 == 1:
            add(m, S.ico(0.03, 1, loc=(p[0], p[1] - 0.06, p[2] + 0.03)), 'Lace')


# ───────────────────────────── obelisk_mini ─────────────────────────────

@builder('obelisk_mini')
def obelisk_mini(m: Model, spec: LevelSpec) -> None:
    add(m, S.box(0.5, 0.5, 0.1, 0.015, 1, base=(0, 0, 0)), 'GyStoneDark')
    add(m, S.box(0.36, 0.36, 0.26, 0.015, 1, base=(0, 0, 0.1)), 'Marble')
    add(m, S.box(0.4, 0.4, 0.04, 0.01, 1, base=(0, 0, 0.36)), 'GyStoneWarm')
    add(m, S.taper_box(0.24, 0.24, 0.13, 0.13, 0.72, 0.01, 1, base=(0, 0, 0.4)), 'Marble')
    add(m, S.taper_box(0.14, 0.14, 0.005, 0.005, 0.13, 0.0, 0, base=(0, 0, 1.12)), 'Marble')
    add(m, S.torus(0.07, 0.012, 12, 3, loc=(0, -0.186, 0.24), rot=(90, 0, 0)), 'Bronze')
    add(m, S.sphere(0.02, 8, 5, loc=(0, -0.19, 0.24)), 'Bronze')
    add(m, mold_blotch(0.12, -0.12, 0.38, 0.06, (0.4, -0.4, 1), seed=1), 'Moss')


# ───────────────────────────── lantern_ironCage ─────────────────────────────

@builder('lantern_ironCage')
def lantern_iron_cage(m: Model, spec: LevelSpec) -> None:
    add(m, S.box(0.26, 0.26, 0.04, 0.01, 1, base=(0, 0, 0)), 'Iron')
    for sx in (-1, 1):
        for sy in (-1, 1):
            add(m, S.box(0.025, 0.025, 0.4, 0.004, 1, base=(sx * 0.11, sy * 0.11, 0.04)), 'Iron')
    for z in (0.12, 0.3):
        for k in range(4):
            a = 90 * k
            add(m, S.box(0.22, 0.012, 0.012, 0.0, 0, loc=(0.11 * math.cos(math.radians(a + 90)),
                                                          0.11 * math.sin(math.radians(a + 90)), z), rot=(0, 0, a)), 'Iron')
    for k in range(4):  # diagonal cage bars
        a = 90 * k + 45
        add(m, S.rotate(S.box(0.012, 0.012, 0.3, 0.0, 0, loc=(0.0, -0.112, 0.24), rot=(0, 28, 0)), (0, 0, 90 * k)),
            'Iron')
    add(m, S.box(0.3, 0.3, 0.03, 0.008, 1, base=(0, 0, 0.44)), 'Iron')
    add(m, S.taper_box(0.26, 0.26, 0.03, 0.03, 0.12, 0.005, 1, base=(0, 0, 0.47)), 'Iron')
    add(m, S.torus(0.04, 0.01, 10, 3, loc=(0, 0, 0.62), rot=(90, 0, 0)), 'Iron')
    node(m, 'bulb', 'bulb', origin=(0, 0, 0.15), flicker='candle')
    add(m, S.candle(0.12, 0.03, base=(0, 0, 0.04), drips=2, seed=3), 'Wax')
    add(m, S.flame(0.07, 0.022, base=(0, 0, 0.17)), 'Lantern', 'bulb')


# ───────────────────────────── wreath_mourning ─────────────────────────────

@builder('wreath_mourning')
def wreath_mourning(m: Model, spec: LevelSpec) -> None:
    j = m.rng
    cz = 1.6
    yb = -0.05
    add(m, S.torus(0.2, 0.05, 16, 6, loc=(0, yb, cz), rot=(90, 0, 0)), 'Hedge')
    for k in range(22):
        a = math.tau * k / 22
        c = Vector((math.cos(a) * 0.2, yb - 0.035, cz + math.sin(a) * 0.2))
        leaf = S.prism([(0.0, -0.05), (0.025, 0.0), (0.0, 0.05), (-0.025, 0.0)], 0.004, 0.0, 0, plane='XZ')
        S.rotate(leaf, (j.sym(20), 0, 0))
        S.rotate(leaf, (0, math.degrees(-a) + 90 + j.sym(25), 0))
        add(m, S.translate(leaf, c), 'Leaf' if k % 2 else 'HedgeLight')
    for k, a in enumerate((0.4, 1.3, 2.4, 3.6, 4.5, 5.6)):
        add(m, S.ico(0.032, 1, loc=(math.cos(a) * 0.2, yb - 0.06, cz + math.sin(a) * 0.2)), ('Lace', 'Flower3')[k % 2])
    # plum bow with trailing tails at the bottom
    for sx in (-1, 1):
        lp = S.torus(0.05, 0.016, 10, 4, loc=(sx * 0.055, yb - 0.08, cz - 0.21), rot=(90, 0, 0))
        S.xf(lp, scale=(1.2, 1.0, 0.75), pivot=(sx * 0.055, yb - 0.08, cz - 0.21))
        add(m, lp, 'CurtainPurple')
        tail = ribbon([(sx * 0.02, yb - 0.075, cz - 0.22), (sx * 0.07, yb - 0.07, cz - 0.32), (sx * 0.06, yb - 0.065, cz - 0.42)],
                      (0.04, 0.045, 0.05), (1, 0, 0))
        add(m, tail, 'CurtainPurple')
    add(m, S.sphere(0.025, 8, 5, loc=(0, yb - 0.085, cz - 0.21)), 'CurtainPurple')
    add(m, S.tube([(0, -0.005, cz + 0.3), (0, yb, cz + 0.24)], 0.005, 3), 'Iron')
    add(m, S.cylinder(0.012, 0.03, 6, 0.0, base=(0, 0.0, cz + 0.3), rot=(90, 0, 0)), 'Iron')


# ───────────────────────────── candle_cluster ─────────────────────────────

@builder('candle_cluster')
def candle_cluster(m: Model, spec: LevelSpec) -> None:
    j = m.rng
    add(m, S.blob(0.24, 1, 0.12, 2.0, 1, loc=(0, 0, 0.0), scale=(1.0, 0.85, 0.2), flat_bottom=0.0), 'GyStoneDark')
    spots = ((0.0, 0.03, 0.3), (-0.12, -0.04, 0.2), (0.11, -0.05, 0.24), (-0.05, -0.12, 0.13), (0.09, 0.1, 0.17),
             (-0.13, 0.09, 0.15))
    node(m, 'flame', 'flame', origin=(0, 0, 0.2), flicker='candle')
    for k, (x, y, h) in enumerate(spots):
        add(m, S.candle(h, 0.026 + 0.004 * (k % 2), base=(x, y, 0.04), drips=1, seed=k), 'Wax' if k % 3 else 'Bone')
        add(m, S.flame(0.065, 0.018, base=(x, y, 0.04 + h), segs=6), 'CandleFlame', 'flame')
    for k in range(2):
        a = j.uniform(0, math.tau)
        add(m, S.cylinder(0.03, 0.006, 8, 0.0, base=(math.cos(a) * 0.2, math.sin(a) * 0.17, 0.035)), 'Wax')


# ───────────────────────────── urn_planterStone ─────────────────────────────

@builder('urn_planterStone')
def urn_planter_stone(m: Model, spec: LevelSpec) -> None:
    j = m.rng
    add(m, S.box(0.4, 0.4, 0.26, 0.02, 1, base=(0, 0, 0)), 'GyStone')
    add(m, S.box(0.44, 0.44, 0.04, 0.012, 1, base=(0, 0, 0.26)), 'GyStoneWarm')
    urn = S.lathe([(0.0, 0.0), (0.12, 0.0), (0.08, 0.06), (0.06, 0.12), (0.16, 0.22), (0.22, 0.36), (0.24, 0.44),
                   (0.27, 0.48), (0.25, 0.5), (0.0, 0.47)], 14)
    add(m, S.translate(urn, (0, 0, 0.3)), 'GyStoneWarm')
    for sx in (-1, 1):
        add(m, S.torus(0.05, 0.014, 8, 3, loc=(sx * 0.24, 0, 0.66), rot=(90, 0, 0)), 'GyStone')
    add(m, dome(0.22, 0.22, 0.06, 2, 12, j, power=2.0, loc=(0, 0, 0.76)), 'GyDirt')
    for k in range(6):  # plum flowers on stems + trailing ivy
        a = math.tau * k / 6
        p = (math.cos(a) * 0.12, math.sin(a) * 0.12, 0.95 + 0.04 * (k % 2))
        add(m, S.tube([(p[0] * 0.5, p[1] * 0.5, 0.8), p], 0.006, 3), 'Leaf')
        add(m, S.ico(0.035, 1, loc=p, scale=(1, 1, 0.7)), 'PlantPurple' if k % 2 else 'Flower3')
    for sx in (-1, 1):
        trail = [(sx * 0.24, -0.1, 0.78), (sx * 0.29, -0.14, 0.62), (sx * 0.26, -0.16, 0.45), (sx * 0.23, -0.21, 0.33)]
        add(m, S.tube(trail, 0.007, 3), 'Leaf')
        for p in trail[1:]:
            add(m, S.prism([(0.0, -0.03), (0.02, 0.0), (0.0, 0.03), (-0.02, 0.0)], 0.004, 0.0, 0, plane='XZ',
                           loc=(p[0], p[1] - 0.012, p[2])), 'HedgeLight')
    add(m, mold_blotch(-0.15, -0.21, 0.12, 0.06, (0, -1, 0.2), seed=4), 'Moss')


# ───────────────────────────── table_seance ─────────────────────────────

@builder('table_seance')
def table_seance(m: Model, spec: LevelSpec) -> None:
    """Round home séance table under a fringed plum cloth: crystal ball on a claw stand ('glow'), two candles
    ('flame'), a talking-board planchette."""
    T = 0.76
    add(m, S.lathe([(0.24, 0.0), (0.18, 0.04), (0.06, 0.12), (0.05, 0.6), (0.1, 0.7), (0.0, 0.72)], 12), 'WoodEbony')
    add(m, S.cylinder(0.62, 0.04, 24, 0.012, base=(0, 0, T - 0.04)), 'WoodEbony')
    cloth = S.lathe([(0.66, T - 0.32), (0.64, T - 0.12), (0.63, T - 0.02), (0.6, T + 0.005), (0.0, T + 0.006)], 24)
    S.displace(cloth, lambda v: v + Vector((0, 0, 0.03 * math.sin(math.atan2(v.y, v.x) * 6) if v.z < T - 0.1 else 0.0)))
    add(m, cloth, 'TableCloth')
    for k in range(24):
        a = math.tau * k / 24
        add(m, S.cylinder(0.008, 0.05, 4, 0.0, base=(math.cos(a) * 0.665, math.sin(a) * 0.665,
                                                      T - 0.37 + 0.03 * math.sin(a * 6))), 'Fringe')
    for k in range(3):  # claw stand
        a = math.tau * k / 3 + 0.5
        add(m, S.tube([(math.cos(a) * 0.09, math.sin(a) * 0.09, T + 0.01), (math.cos(a) * 0.06, math.sin(a) * 0.06, T + 0.07),
                       (math.cos(a) * 0.07, math.sin(a) * 0.07, T + 0.12)], 0.012, 4), 'Brass')
    add(m, S.torus(0.06, 0.01, 12, 3, loc=(0, 0, T + 0.06)), 'Brass')
    node(m, 'glow', 'glow', origin=(0, 0, T + 0.2), pulse=True)
    add(m, S.sphere(0.12, 14, 10, loc=(0, 0, T + 0.2)), 'Crystal', 'glow')
    add(m, S.ico(0.04, 1, loc=(0.02, -0.03, T + 0.2)), 'GlowZapper', 'glow')
    node(m, 'flame', 'flame', origin=(0, 0, T + 0.3), flicker='candle')
    for sx in (-1, 1):
        x, y = sx * 0.38, 0.18
        add(m, S.cylinder(0.05, 0.02, 10, 0.004, base=(x, y, T + 0.005)), 'Brass')
        add(m, S.candle(0.2 if sx < 0 else 0.14, 0.025, base=(x, y, T + 0.02), drips=2, seed=sx + 5), 'Wax')
        add(m, S.flame(0.06, 0.017, base=(x, y, T + 0.02 + (0.2 if sx < 0 else 0.14))), 'CandleFlame', 'flame')
    plan = S.prism([(0.0, 0.07), (0.06, -0.04), (-0.06, -0.04)], 0.012, 0.004, 1, plane='XY',
                   loc=(0.2, -0.3, T + 0.006), rot=(0, 0, 20))
    add(m, plan, 'Wood')
    add(m, S.cylinder(0.018, 0.004, 10, 0.0, base=(0.2, -0.3, T + 0.018)), 'Glass')


# ───────────────────────────── lantern_jack / bob_for_brains ─────────────────────────────

@builder('lantern_jack')
def lantern_jack(m: Model, spec: LevelSpec) -> None:
    """Friendly carved pumpkin (round eyes, gap-toothed grin): the glowing face is the 'flame' node."""
    R, Hh = 0.24, 0.34
    prof = [(0.0, 0.0), (0.14, 0.005), (0.22, 0.05), (0.25, 0.14), (0.24, 0.24), (0.18, 0.31), (0.06, 0.34), (0.0, 0.33)]
    body = S.lathe(prof, 20)
    S.displace(body, lambda v: Vector((v.x, v.y, v.z)) * 1.0 - Vector((v.x, v.y, 0)) *
               (0.06 * (1 - abs(math.cos(math.atan2(v.y, v.x) * 4)))))
    add(m, body, 'Pumpkin')
    for k in range(8):
        a = math.tau * k / 8
        add(m, S.tube([(math.cos(a) * 0.12, math.sin(a) * 0.12, 0.33), (math.cos(a) * 0.235, math.sin(a) * 0.235, 0.17),
                       (math.cos(a) * 0.14, math.sin(a) * 0.14, 0.01)], 0.01, 3), 'PumpkinDark')
    add(m, S.tube([(0, 0, 0.32), (0.01, 0, 0.4), (0.05, 0.0, 0.44)], radii=[0.03, 0.022, 0.015], segs=6), 'Stem')
    add(m, ribbon([(0.0, 0.0, 0.37), (-0.06, 0.03, 0.39), (-0.11, 0.0, 0.36)], (0.0, 0.06, 0.0), (0, 1, 0)), 'Leaf')
    node(m, 'flame', 'flame', origin=(0, -0.2, 0.17), flicker='candle')
    yf = -0.225
    for sx in (-1, 1):
        eye = [(math.cos(a) * 0.04, math.sin(a) * 0.045) for a in (math.tau * k / 10 for k in range(10))]
        add(m, front_poly(eye, (sx * 0.085, yf - 0.012, 0.22)), 'PumpkinGlow', 'flame')
    nose = [(-0.025, 0.0), (0.025, 0.0), (0.0, 0.035)]
    add(m, front_poly(nose, (0.0, yf - 0.02, 0.15)), 'PumpkinGlow', 'flame')
    grin = []
    for k in range(9):
        a = math.radians(200 + 140 * k / 8)
        grin.append((math.cos(a) * 0.13, math.sin(a) * 0.07 + 0.0))
    for k in range(8, -1, -1):
        a = math.radians(200 + 140 * k / 8)
        grin.append((math.cos(a) * 0.11, math.sin(a) * 0.04 + 0.01))
    add(m, front_poly(grin, (0.0, yf - 0.01, 0.12)), 'PumpkinGlow', 'flame')
    add(m, S.box(0.03, 0.01, 0.025, 0.0, 0, base=(0.02, yf - 0.03, 0.065)), 'Pumpkin')  # the missing-tooth gap


@builder('bob_for_brains')
def bob_for_brains(m: Model, spec: LevelSpec) -> None:
    """A party barrel of murky water with three bobbing (pink, squishy, harmless) brains — the game's food."""
    j = m.rng
    prof = [(0.0, 0.0), (0.27, 0.0), (0.31, 0.2), (0.33, 0.38), (0.31, 0.56), (0.28, 0.72), (0.0, 0.72)]
    staves = S.lathe(prof, 16, cap_top=False)
    add(m, staves, 'WoodLight')
    for k in range(16):
        a = math.tau * k / 16
        add(m, S.box(0.006, 0.01, 0.7, 0.0, 0, loc=(math.cos(a) * 0.318, math.sin(a) * 0.318, 0.37),
                     rot=(0, 0, math.degrees(a))), 'WoodDark')
    for z, r in ((0.12, 0.3), (0.38, 0.335), (0.64, 0.3)):
        add(m, S.torus(r, 0.014, 16, 3, loc=(0, 0, z)), 'Iron')
    add(m, S.torus(0.28, 0.022, 16, 3, loc=(0, 0, 0.72)), 'WoodDark')
    node(m, 'water', 'water', origin=(0, 0, 0.66), ripple=True)
    add(m, S.cylinder(0.27, 0.01, 16, 0.0, base=(0, 0, 0.655)), 'PondWater', 'water')
    for k, (x, y) in enumerate(((0.08, -0.06), (-0.1, 0.05), (0.04, 0.13))):
        b = S.blob(0.075, 2, 0.28, 4.0, 10 + k, loc=(x, y, 0.69), scale=(1.1, 0.9, 0.7))
        add(m, b, 'Brain')
        add(m, S.box(0.004, 0.13, 0.01, 0.0, 0, loc=(x, y, 0.735), rot=(0, 0, 90)), 'BrainDark')
    add(m, S.tube([(0.2, -0.24, 0.72), (0.26, -0.3, 0.76), (0.3, -0.33, 0.68)], 0.006, 3), 'Iron')  # ladle hook
    add(m, S.box(0.36, 0.02, 0.12, 0.006, 1, base=(0, -0.335, 0.42), rot=(4, 0, 0)), 'PaperOld')
    add(m, flat_text('BOB!', 0.07, (0, -0.348, 0.48), rot=(94, 0, 0)), 'BloodWine', 'sign')
