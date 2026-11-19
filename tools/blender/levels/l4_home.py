"""L4 Bayou builders, part 1: boat, fishing post, porch furniture, stove, crawdad gear, forage plants, the bald
cypress, the firefly lantern, the crawdad bucket and the cypress rod. Conventions are the level kit's
(tools/blender/levels/kit.py): Blender front = -Y, Z up, floor pieces centred on their footprint, base at z = 0."""
from __future__ import annotations

import math

from mathutils import Vector

from common import shapes as S
from common.materials import MatSpec
from common.model import Model

from . import kit
from .kit import add, builder, node
from .spec import LevelSpec

# Bayou palette from docs/levels/L4-bayou.md §12
kit.LEVEL_LOOKS.update({
    'ByCypress': MatSpec('#3f4a32', roughness=0.9),
    'ByCypressLight': MatSpec('#56633f', roughness=0.9),
    'BySpanishMoss': MatSpec('#9a9a8a', roughness=0.95, double_sided=True),
    'ByMud': MatSpec('#4a3c2c', roughness=0.9),
    'ByBark': MatSpec('#5e5348', roughness=0.95),
    'ByPlank': MatSpec('#8a7458', roughness=0.85),
    'ByPlankDark': MatSpec('#5c4a38', roughness=0.9),
    'ByNet': MatSpec('#b7a67a', roughness=0.95, double_sided=True),
    'ByCrawdad': MatSpec('#b8402c', roughness=0.5),
    'ByBerry': MatSpec('#4a2a5e', roughness=0.35),
    'ByMushroom': MatSpec('#e6dfcf', roughness=0.6),
    'ByFirefly': MatSpec('#d8f080', roughness=0.4, emission='#d8f080', strength=4.0),
})


def boat_outline(length: float, beam: float, n: int = 7):
    """Pointed-both-ends plan outline, CCW, x across, y along."""
    pts = []
    for k in range(n + 1):
        t = k / n
        pts.append((beam / 2 * math.sin(math.pi * t) ** 0.7, -length / 2 + length * t))
    for k in range(1, n):
        t = k / n
        pts.append((-beam / 2 * math.sin(math.pi * (1 - t)) ** 0.7, length / 2 - length * t))
    return pts


@builder('pirogue_dock')
def pirogue_dock(m: Model, spec: LevelSpec) -> None:
    out = boat_outline(2.7, 0.62)
    inn = S.offset_outline(out, 0.035)
    add(m, S.prism(out, 0.05, 0.0, 0, plane='XY'), 'ByPlankDark')                       # the flat bottom
    add(m, S.outline_ring(out, inn, 0.0, 0.27, 0.006, 1), 'ByPlank')                     # the sides
    for y in (-0.55, 0.5):
        add(m, S.box(0.50, 0.14, 0.025, 0.006, 1, loc=(0, y, 0.20)), 'ByPlankDark')      # thwarts
    add(m, S.tube([(-0.16, -1.0, 0.24), (0.14, 0.75, 0.29)], 0.016, 5), 'WoodLight')     # paddle shaft
    add(m, S.box(0.13, 0.36, 0.014, 0.004, 1, loc=(0.16, 0.92, 0.292), rot=(0, 0, -10)), 'WoodLight')
    # mooring cleat on a short piling and the rope to the bow
    add(m, S.cylinder(0.065, 0.62, 8, 0.012, base=(0.40, 1.28, 0.0), rot=(0, 3, 0)), 'ByBark')
    add(m, S.box(0.16, 0.035, 0.03, 0.008, 1, loc=(0.40, 1.28, 0.585)), 'IronOld')
    add(m, S.tube([(0.02, 1.33, 0.24), (0.18, 1.36, 0.16), (0.36, 1.30, 0.50)], 0.011, 4), 'Rope')
    add(m, S.torus(0.075, 0.013, 8, 4, loc=(0.40, 1.28, 0.50)), 'Rope')
    add(m, S.box(0.10, 0.10, 0.09, 0.012, 1, base=(-0.12, 0.05, 0.05)), 'Tin')           # bailing can


@builder('post_fishing')
def post_fishing(m: Model, spec: LevelSpec) -> None:
    add(m, S.cylinder(0.11, 1.16, 9, 0.02, base=(0.0, 0.12, 0.0), rot=(2, 3, 0)), 'ByBark')
    add(m, S.cylinder(0.125, 0.05, 9, 0.01, base=(0.0, 0.12, 1.14)), 'ByPlankDark')
    for k in range(3):                                                                    # coil of rope
        add(m, S.torus(0.135 - 0.006 * k, 0.016, 8, 3, loc=(0.0, 0.12, 0.52 + 0.03 * k)), 'Rope')
    add(m, S.lathe([(0.085, 0.0), (0.105, 0.17), (0.11, 0.18)], 9, base=(-0.24, -0.18, 0.0)), 'Tin')   # bait bucket
    add(m, S.torus(0.10, 0.006, 8, 3, loc=(-0.24, -0.18, 0.19), rot=(74, 0, 0), arc=180), 'IronOld')
    add(m, S.cylinder(0.10, 0.01, 9, 0.0, base=(-0.24, -0.18, 0.13)), 'ByMud')            # the bait
    add(m, S.tube([(0.10, 0.02, 1.02), (0.30, -0.20, 1.16), (0.36, -0.30, 0.62)], 0.006, 4), 'Line')
    add(m, S.sphere(0.03, 6, 4, loc=(0.36, -0.30, 0.60)), 'FloatRed')


def _bench(m: Model, w: float, seat_z: float, node_name=None, y0: float = 0.0) -> None:
    """Slatted bench seat + back + arms, centred on x, seat front toward -Y."""
    for k in range(4):
        add(m, S.box(w, 0.085, 0.022, 0.006, 1, loc=(0, y0 - 0.16 + k * 0.105, seat_z)), 'ByPlank', node_name)
    for k in range(4):
        add(m, S.box(w, 0.02, 0.085, 0.006, 1, loc=(0, y0 + 0.235 + 0.02 * k, seat_z + 0.11 + k * 0.105), rot=(-10, 0, 0)), 'ByPlank', node_name)
    for sx in (-1, 1):
        x = sx * (w / 2 - 0.02)
        add(m, S.box(0.04, 0.05, 0.50, 0.008, 1, loc=(x, y0 + 0.25, seat_z + 0.24), rot=(-10, 0, 0)), 'ByPlankDark', node_name)
        add(m, S.box(0.05, 0.46, 0.03, 0.008, 1, loc=(x, y0 + 0.03, seat_z + 0.22)), 'ByPlankDark', node_name)
        add(m, S.box(0.04, 0.04, 0.22, 0.006, 1, loc=(x, y0 - 0.17, seat_z + 0.10)), 'ByPlankDark', node_name)


@builder('chair_rocking')
def chair_rocking(m: Model, spec: LevelSpec) -> None:
    for sx in (-1, 1):                                                                    # rockers
        pts = S.arc_points(0.95, 250, 290, 6)
        add(m, S.tube([(sx * 0.24, p[0], 0.975 + p[2]) for p in pts], 0.018, 5, scale_xy=(1.0, 1.6)), 'ByPlankDark')
        for y in (-0.20, 0.20):
            add(m, S.box(0.035, 0.035, 0.40, 0.006, 1, base=(sx * 0.24, y, 0.03)), 'ByPlankDark')
    add(m, S.box(0.50, 0.46, 0.035, 0.012, 1, loc=(0, 0.0, 0.44)), 'Wicker')              # woven seat
    for k in range(5):                                                                    # back slats
        add(m, S.box(0.055, 0.02, 0.56, 0.006, 1, loc=(-0.2 + k * 0.1, 0.25, 0.75), rot=(-12, 0, 0)), 'ByPlank')
    add(m, S.box(0.52, 0.03, 0.07, 0.01, 1, loc=(0, 0.31, 1.035), rot=(-12, 0, 0)), 'ByPlankDark')
    for sx in (-1, 1):
        add(m, S.box(0.05, 0.44, 0.03, 0.008, 1, loc=(sx * 0.26, 0.02, 0.66)), 'ByPlankDark')
        add(m, S.box(0.035, 0.035, 0.22, 0.006, 1, loc=(sx * 0.26, -0.18, 0.55)), 'ByPlankDark')
    add(m, S.superellipsoid(0.17, 0.15, 0.03, 0.5, 0.6, 8, 4, loc=(0.02, 0.0, 0.475)), 'Cushion')


@builder('swing_porch')
def swing_porch(m: Model, spec: LevelSpec) -> None:
    node(m, 'swing', 'swing', origin=(0, 0.05, 2.42))                                     # pivot at the ceiling hooks
    _bench(m, 1.50, 0.46, 'swing')
    for sx in (-1, 1):
        for y in (-0.16, 0.26):
            add(m, S.tube([(sx * 0.72, y, 0.50), (sx * 0.70, 0.05, 2.40)], 0.012, 4), 'IronOld', 'swing')
        add(m, S.box(0.08, 0.08, 0.03, 0.006, 1, loc=(sx * 0.70, 0.05, 2.43)), 'IronOld')  # ceiling plates stay still
    add(m, S.superellipsoid(0.26, 0.17, 0.035, 0.5, 0.6, 8, 4, loc=(-0.38, 0.0, 0.50)), 'Cushion', 'swing')
    add(m, S.box(1.60, 0.56, 0.012, 0.0, 0, base=(0, 0.04, 0.0)), 'ByPlankDark')         # scuffed boards under the swing


@builder('hammock_moss')
def hammock_moss(m: Model, spec: LevelSpec) -> None:
    for sx, lean in ((-1, 4), (1, -5)):
        post = S.cylinder(0.055, 1.33, 8, 0.012, base=(0, 0, 0))
        S.rotate(post, (0, lean, 0))
        add(m, S.translate(post, (sx * 0.90, 0, 0)), 'ByBark')
    net = S.slab(1.56, 0.62, 0.012, 10, 4, base=(0, 0, 0))
    S.displace(net, lambda v: Vector((v.x, v.y * (1.0 - 0.55 * (v.x / 0.78) ** 2), 0.52 + 0.62 * (v.x / 0.78) ** 2
                                      - 0.10 * (1 - (v.y / 0.31) ** 2) * (1 - (v.x / 0.78) ** 2))))
    add(m, net, 'ByNet')
    for sx in (-1, 1):
        add(m, S.tube([(sx * 0.78, 0, 1.14), (sx * 0.87, 0, 1.24)], 0.010, 4), 'Rope')
    for k, (x, l) in enumerate(((-0.5, 0.30), (-0.2, 0.22), (0.1, 0.34), (0.42, 0.26), (0.62, 0.2))):   # moss drapes
        z = 0.52 + 0.62 * (x / 0.78) ** 2 - 0.02
        add(m, S.box(0.13, 0.012, l, 0.0, 0, loc=(x, (-0.24 if k % 2 else 0.24), z - l / 2), rot=(0, 0, 12 * (k - 2))), 'BySpanishMoss')
    add(m, S.superellipsoid(0.15, 0.11, 0.05, 0.6, 0.6, 8, 4, loc=(-0.48, 0, 0.74), rot=(0, -24, 0)), 'Cushion')


@builder('stove_woodburning')
def stove_woodburning(m: Model, spec: LevelSpec) -> None:
    body = [(0.16, 0.20), (0.27, 0.34), (0.31, 0.52), (0.27, 0.72), (0.19, 0.86), (0.20, 0.90), (0.12, 0.94), (0.0, 0.94)]
    add(m, S.lathe(body, 14, cap_bottom=True), 'IronOld')
    add(m, S.cylinder(0.33, 0.035, 14, 0.008, base=(0, 0, 0.50)), 'Iron')                 # belly band
    for k in range(3):
        a = math.radians(90 + 120 * k)
        add(m, S.tube([(math.cos(a) * 0.17, math.sin(a) * 0.17, 0.22), (math.cos(a) * 0.27, math.sin(a) * 0.27, 0.0)], 0.022, 5), 'Iron')
    add(m, S.cylinder(0.30, 0.02, 12, 0.0, base=(0, 0, 0.0)), 'Ash')                      # hearth plate
    add(m, S.box(0.22, 0.03, 0.20, 0.01, 1, loc=(0, -0.295, 0.50)), 'Iron')               # door frame
    node(m, 'flame', 'flame', origin=(0, -0.30, 0.50), transient=True, flicker='fire')
    for k in range(4):
        add(m, S.box(0.028, 0.012, 0.15, 0.0, 0, loc=(-0.066 + 0.044 * k, -0.312, 0.50)), 'CoalGlow', 'flame')
    add(m, S.sphere(0.022, 6, 4, loc=(0.13, -0.31, 0.50)), 'Brass')                       # door knob
    add(m, S.tube([(0, 0.02, 0.92), (0, 0.02, 1.70), (0, 0.24, 1.92), (0, 0.24, 2.30)], 0.07, 8), 'IronOld')   # flue
    add(m, S.torus(0.074, 0.012, 8, 3, loc=(0, 0.02, 1.30)), 'Iron')
    add(m, S.cylinder(0.11, 0.03, 8, 0.0, base=(0, 0, 0.94)), 'Iron')                     # cook lid
    kettle = S.lathe([(0.06, 0.0), (0.085, 0.05), (0.07, 0.11), (0.03, 0.13)], 8, base=(0.02, -0.02, 0.97))
    add(m, kettle, 'Tin')
    add(m, S.torus(0.05, 0.006, 6, 3, loc=(0.02, -0.02, 1.10), rot=(90, 0, 0), arc=180), 'IronOld')


@builder('pot_crawdad')
def pot_crawdad(m: Model, spec: LevelSpec) -> None:
    for k in range(4):                                                                    # wire hoops, lying along X
        add(m, S.torus(0.17, 0.009, 10, 3, loc=(-0.27 + 0.18 * k, 0.05, 0.18), rot=(0, 90, 0)), 'Galvanised')
    for k in range(8):
        a = math.tau * k / 8
        y, z = 0.05 + math.cos(a) * 0.17, 0.18 + math.sin(a) * 0.17
        add(m, S.box(0.56, 0.007, 0.007, 0.0, 0, loc=(0, y, z)), 'Galvanised')
    for sx in (-1, 1):                                                                    # funnel ends
        cone = S.cone(0.17, 0.12, 8, base=(0, 0, 0))
        S.rotate(cone, (0, -90 * sx, 0))
        add(m, S.translate(cone, (sx * 0.28, 0.05, 0.18)), 'ByNet')
    add(m, S.tube([(0.02, 0.05, 0.35), (0.10, -0.20, 0.30), (0.30, -0.36, 0.05)], 0.009, 4), 'Rope')
    add(m, S.sphere(0.055, 8, 5, loc=(0.32, -0.38, 0.055), scale=(1, 1, 0.9)), 'FloatRed')
    add(m, S.box(0.07, 0.07, 0.03, 0.006, 1, loc=(-0.05, 0.05, 0.035)), 'ByMud')         # bait block
    node(m, 'full', 'full', origin=(0, 0.05, 0.12))                                       # the catch (state)
    for k, (x, y, r) in enumerate(((-0.15, 0.02, 20), (0.0, 0.09, -35), (0.14, 0.03, 60), (-0.05, 0.0, 100))):
        add(m, S.superellipsoid(0.05, 0.022, 0.018, 0.6, 0.6, 6, 3, loc=(x, y, 0.06 + 0.02 * (k % 2)), rot=(0, 0, r)), 'ByCrawdad', 'full')
        add(m, S.box(0.03, 0.012, 0.01, 0.0, 0, loc=(x + 0.05 * math.cos(math.radians(r)), y + 0.05 * math.sin(math.radians(r)), 0.07 + 0.02 * (k % 2)), rot=(0, 0, r)), 'ByCrawdad', 'full')


@builder('pot_boil')
def pot_boil(m: Model, spec: LevelSpec) -> None:
    j = m.rng
    for k in range(8):                                                                    # fire ring
        a = math.tau * k / 8 + j.sym(0.1)
        st = S.taper_box(0.17, 0.14, 0.13, 0.10, j.uniform(0.10, 0.14), 0.025, 1)
        S.rotate(st, (0, 0, math.degrees(a) + 90))
        add(m, S.translate(st, (math.cos(a) * 0.36, math.sin(a) * 0.36, 0.0)), 'StoneLight' if k % 2 else 'Granite')
    for a in (0.4, 2.5, 4.4):
        add(m, S.tube([(math.cos(a) * 0.26, math.sin(a) * 0.26, 0.04), (-math.cos(a) * 0.05, -math.sin(a) * 0.05, 0.10)], 0.04, 6), 'Bark')
    node(m, 'flame', 'flame', origin=(0, 0, 0.06), transient=True, flicker='fire')
    add(m, S.flame(0.26, 0.10, base=(0.10, 0.0, 0.05)), 'FireOuter', 'flame')
    add(m, S.flame(0.20, 0.07, base=(-0.09, 0.06, 0.05)), 'FireMid', 'flame')
    add(m, S.flame(0.14, 0.05, base=(0.0, -0.10, 0.05)), 'FireCore', 'flame')
    for k in range(3):                                                                    # tripod legs under the pot
        a = math.radians(30 + 120 * k)
        add(m, S.tube([(math.cos(a) * 0.30, math.sin(a) * 0.30, 0.0), (math.cos(a) * 0.20, math.sin(a) * 0.20, 0.36)], 0.014, 4), 'Iron')
    pot = S.lathe([(0.20, 0.36), (0.30, 0.42), (0.33, 0.62), (0.32, 0.84), (0.34, 0.86), (0.31, 0.87), (0.29, 0.80)], 14,
                  cap_bottom=True, cap_top=False)
    add(m, pot, 'Steel')
    for sx in (-1, 1):
        add(m, S.torus(0.05, 0.010, 6, 3, loc=(sx * 0.345, 0, 0.74), rot=(0, 90, 0)), 'IronOld')
    node(m, 'water', 'water', origin=(0, 0, 0.80))
    add(m, S.cylinder(0.295, 0.012, 14, 0.0, base=(0, 0, 0.794)), 'WaterDirty', 'water')
    for (x, y) in ((0.08, 0.05), (-0.12, -0.04), (0.0, -0.14)):
        add(m, S.sphere(0.035, 6, 4, loc=(x, y, 0.806), scale=(1, 1, 0.5)), 'ByCrawdad', 'water')
    add(m, S.tube([(0.18, -0.10, 0.74), (0.34, -0.22, 0.95)], 0.012, 5), 'WoodLight')    # stirring paddle


@builder('bush_bogberry')
def bush_bogberry(m: Model, spec: LevelSpec) -> None:
    add(m, S.blob(0.30, 2, 0.20, 2.2, seed=41, loc=(0.02, 0.02, 0.26), scale=(1.15, 1.05, 0.85), flat_bottom=-0.75), 'Hedge')
    add(m, S.blob(0.20, 1, 0.22, 2.4, seed=42, loc=(-0.20, -0.12, 0.20), scale=(1.0, 1.0, 0.9), flat_bottom=-0.8), 'HedgeLight')
    add(m, S.blob(0.18, 1, 0.22, 2.4, seed=43, loc=(0.22, 0.14, 0.42), scale=(1.0, 1.0, 0.8)), 'HedgeLight')
    for n, (x, y, z, r) in enumerate(((-0.10, 0.22, 0.40, 0.15), (0.24, -0.16, 0.24, 0.16), (-0.02, -0.10, 0.50, 0.13))):
        add(m, S.blob(r, 1, 0.25, 2.6, seed=44 + n, loc=(x, y, z), scale=(1.0, 1.0, 0.8)), 'Hedge' if n == 1 else 'HedgeLight')   # leaf clumps
    for k in range(3):                                                                    # woody stems at the base
        a = math.tau * k / 3 + 0.4
        add(m, S.tube([(math.cos(a) * 0.06, math.sin(a) * 0.06, 0.0), (math.cos(a) * 0.16, math.sin(a) * 0.16, 0.20)], 0.012, 3), 'Bark')
    spots = (((-0.24, -0.28, 0.30), (-0.10, -0.33, 0.24)), ((0.26, -0.22, 0.34), (0.34, -0.06, 0.28)),
             ((0.04, -0.16, 0.56), (0.24, 0.02, 0.58)))
    for i, cluster in enumerate(spots):                                                   # count 1..3 shows clusters 1..n
        name = f'count_{i + 1}'
        node(m, name, name, origin=cluster[0])
        for (x, y, z) in cluster:
            for (dx, dy, dz) in ((0, 0, 0), (0.035, 0.01, -0.02), (-0.03, 0.02, -0.03)):
                add(m, S.sphere(0.026, 5, 3, loc=(x + dx, y + dy, z + dz)), 'ByBerry', name)


@builder('log_mushroom')
def log_mushroom(m: Model, spec: LevelSpec) -> None:
    log = S.cylinder(0.17, 0.92, 10, 0.02, base=(0, 0, -0.46))
    S.rotate(log, (0, 90, 8))
    add(m, S.translate(log, (0, 0.04, 0.165)), 'ByBark')
    for sx in (-1, 1):
        cap = S.cylinder(0.15, 0.012, 10, 0.0, base=(0, 0, -0.006))
        S.rotate(cap, (0, 90, 8))
        add(m, S.translate(cap, (sx * 0.458, 0.04 + sx * 0.064, 0.165)), 'WoodLight')
    for (x, y, sc) in ((-0.2, 0.0, 1.0), (0.12, 0.08, 0.8), (0.3, -0.02, 0.6)):
        add(m, S.blob(0.10, 1, 0.25, 2.5, seed=7, loc=(x, y, 0.315), scale=(1.4 * sc, 0.9 * sc, 0.28)), 'Moss')
    for k, (x, y, h, r) in enumerate(((-0.26, -0.10, 0.10, 0.045), (-0.18, -0.13, 0.07, 0.032), (0.02, -0.12, 0.12, 0.05),
                                      (0.20, -0.12, 0.08, 0.036), (0.33, -0.10, 0.06, 0.028))):
        z0 = 0.26
        add(m, S.cylinder(r * 0.28, h, 5, 0.0, base=(x, y, z0)), 'ByMushroom')
        add(m, S.sphere(r, 8, 4, loc=(x, y, z0 + h), scale=(1, 1, 0.55)), 'ByMushroom')
    node(m, 'glow', 'glow', origin=(0.10, -0.15, 0.30), transient=True)                  # the Glowcap
    add(m, S.cylinder(0.012, 0.09, 5, 0.0, base=(0.10, -0.16, 0.25)), 'ByMushroom')
    add(m, S.sphere(0.04, 8, 4, loc=(0.10, -0.16, 0.345), scale=(1, 1, 0.6)), 'GlowToxic', 'glow')


@builder('tree_cypress')
def tree_cypress(m: Model, spec: LevelSpec) -> None:
    j = m.rng
    prof = [(0.80, 0.0), (0.62, 0.25), (0.42, 0.7), (0.30, 1.4), (0.25, 2.6), (0.21, 4.0), (0.15, 5.2), (0.08, 6.2)]
    trunk = S.lathe(prof, 20, cap_bottom=True)
    S.displace(trunk, lambda v: Vector((v.x * (1 + 0.16 * math.sin(math.atan2(v.y, v.x) * 7) * max(0.0, 1 - v.z / 1.4)),
                                        v.y * (1 + 0.16 * math.sin(math.atan2(v.y, v.x) * 7) * max(0.0, 1 - v.z / 1.4)), v.z)))
    add(m, trunk, 'ByBark')
    for k in range(7):                                                                    # cypress knees
        a = math.tau * k / 7 + j.sym(0.3)
        r = j.uniform(0.66, 0.86)                                                         # knees stay on the 2 x 2 (W-073)
        add(m, S.cone(j.uniform(0.07, 0.10), j.uniform(0.22, 0.42), 6, base=(math.cos(a) * r, math.sin(a) * r, 0.0)), 'ByBark')
    limbs = ((0.4, 2.9, 0.62, 0.5), (1.6, 3.3, 0.58, 0.5), (2.9, 3.7, 0.62, 0.45), (4.1, 4.1, 0.60, 0.45), (5.3, 4.5, 0.55, 0.4),
             (0.9, 4.9, 0.50, 0.4), (2.3, 5.3, 0.45, 0.35), (3.8, 5.6, 0.40, 0.3))
    for n, (a, z, ln, up) in enumerate(limbs):
        c, s = math.cos(a), math.sin(a)
        tip = (c * ln, s * ln, z + up)
        add(m, S.tube([(c * 0.16, s * 0.16, z), (c * ln * 0.6, s * ln * 0.6, z + up * 0.5), tip], 0.07, 6, radii=[0.09, 0.06, 0.03]), 'ByBark')
        add(m, S.blob(0.36, 2, 0.24, 2.0, seed=10 + n, loc=(tip[0], tip[1], tip[2] + 0.12), scale=(1.06, 1.06, 0.6)),   # crown inside the 2 x 2 (W-073)
            'ByCypress' if n % 2 == 0 else 'ByCypressLight')
        add(m, S.blob(0.28, 2, 0.26, 2.2, seed=30 + n, loc=(c * ln * 0.5, s * ln * 0.5, z + up * 0.5 + 0.16), scale=(1.2, 1.2, 0.55)),
            'ByCypressLight' if n % 2 == 0 else 'ByCypress')                              # feathery inner foliage
        for q in range(3):                                                                # Spanish moss curtains
            f = 0.5 + 0.22 * q
            ln2 = j.uniform(0.6, 1.2)
            card = S.slab(0.26, 0.010, ln2, 2, 1, base=(0, 0, 0))
            S.displace(card, lambda v, ln2=ln2: Vector((v.x * (1.0 - 0.6 * (v.z / ln2)), v.y, v.z)))   # tapering to a ragged tip
            S.rotate(card, (180, 0, math.degrees(a) + 90 + 25 * (q - 1)))
            add(m, S.translate(card, (c * ln * f, s * ln * f, z + up * f - 0.03)), 'BySpanishMoss')
    add(m, S.blob(0.52, 2, 0.2, 1.8, seed=3, loc=(0.0, 0.0, 6.35), scale=(1.15, 1.15, 0.95)), 'ByCypressLight')


@builder('lantern_firefly')
def lantern_firefly(m: Model, spec: LevelSpec) -> None:
    add(m, S.tube([(0.0, 0.0, 0.0), (0.02, 0.0, 0.92), (0.16, 0.0, 1.03), (0.20, 0.0, 0.96)], 0.022, 5), 'IronOld')   # shepherd's hook
    add(m, S.cylinder(0.07, 0.02, 8, 0.0, base=(0, 0, 0.0)), 'IronOld')
    add(m, S.tube([(0.20, 0.0, 0.96), (0.20, 0.0, 0.90)], 0.005, 4), 'Line')
    jar = S.lathe([(0.055, 0.0), (0.075, 0.03), (0.075, 0.15), (0.05, 0.19), (0.05, 0.21)], 10, base=(0.20, 0.0, 0.66), cap_top=False)
    add(m, jar, 'Glass')
    add(m, S.cylinder(0.056, 0.03, 10, 0.006, base=(0.20, 0.0, 0.865)), 'Tin')
    node(m, 'glow', 'glow', origin=(0.20, 0.0, 0.75), transient=True)
    for (dx, dy, dz) in ((0.0, 0.0, 0.0), (0.03, 0.02, 0.05), (-0.03, -0.01, 0.03), (0.01, -0.03, -0.04), (-0.02, 0.03, -0.02)):
        add(m, S.sphere(0.011, 5, 3, loc=(0.20 + dx, dy, 0.75 + dz)), 'ByFirefly', 'glow')


@builder('item_crawdads')
def item_crawdads(m: Model, spec: LevelSpec) -> None:
    add(m, S.lathe([(0.085, 0.0), (0.115, 0.20), (0.12, 0.21)], 10, cap_top=False), 'Tin')
    add(m, S.cylinder(0.108, 0.01, 10, 0.0, base=(0, 0, 0.17)), 'ByMud')
    add(m, S.torus(0.115, 0.006, 8, 3, loc=(0, 0, 0.215), rot=(80, 0, 0), arc=180), 'IronOld')
    for (x, y, r) in ((0.03, 0.02, 30), (-0.04, -0.03, 130), (0.0, 0.06, -70)):
        add(m, S.superellipsoid(0.045, 0.02, 0.016, 0.6, 0.6, 6, 3, loc=(x, y, 0.20), rot=(0, 10, r)), 'ByCrawdad')
        add(m, S.box(0.028, 0.01, 0.045, 0.0, 0, loc=(x + 0.045 * math.cos(math.radians(r)), y + 0.045 * math.sin(math.radians(r)), 0.235)), 'ByCrawdad')


@builder('rod_cypress')
def rod_cypress(m: Model, spec: LevelSpec) -> None:
    """Wall item: the back is the wall plane (Blender y = 0), body toward -Y, centred 1.5 m up the wall."""
    z = 1.5
    for x in (-0.36, 0.30):                                                               # two pegs
        add(m, S.cylinder(0.014, 0.07, 6, 0.0, base=(x, -0.07, z - 0.05), rot=(-90, 0, 0)), 'Brass')
        add(m, S.box(0.07, 0.012, 0.07, 0.004, 1, loc=(x, -0.006, z - 0.05)), 'ByPlankDark')
    add(m, S.tube([(-0.50, -0.06, z - 0.03), (0.50, -0.06, z + 0.02)], 0.011, 6, radii=[0.014, 0.005]), 'WoodLight')
    add(m, S.tube([(-0.50, -0.06, z - 0.03), (-0.34, -0.06, z - 0.022)], 0.017, 6), 'Cork')    # grip
    add(m, S.cylinder(0.035, 0.03, 10, 0.004, base=(-0.27, -0.045, z - 0.07), rot=(90, 0, 0)), 'Brass')   # reel
    add(m, S.sphere(0.012, 5, 3, loc=(-0.235, -0.09, z - 0.07)), 'Brass')
    for x in (-0.05, 0.2, 0.42):                                                          # line guides
        add(m, S.torus(0.012, 0.003, 6, 3, loc=(x, -0.06, z - 0.02 + 0.05 * x), rot=(0, 90, 0)), 'IronOld')
    add(m, S.tube([(-0.25, -0.06, z - 0.045), (0.49, -0.06, z + 0.005), (0.47, -0.06, z - 0.09)], 0.002, 3), 'Line')
    add(m, S.sphere(0.014, 6, 4, loc=(0.47, -0.06, z - 0.10)), 'FloatRed')
