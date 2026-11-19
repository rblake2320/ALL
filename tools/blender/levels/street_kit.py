"""Street kit builders (W-025 slice S9). Conventions are the level kit's: front = -Y, Z up, base at z = 0.

Text the game writes itself (a street name, what is under construction) goes on a blank `plate` node; the fixed
words are baked in.
"""
from __future__ import annotations

import math

from mathutils import Vector

import manifest_meta as meta
from common import shapes as S
from common.materials import MatSpec
from common.model import Model

from . import kit
from .kit import add, builder, node
from .spec import LevelSpec
from .street_specs import CELL, CURB_TOP, CURB_W, ROAD_WIDTH

kit.LEVEL_LOOKS.update({
    'StConcrete': MatSpec('#8f8f88', roughness=0.9),
    'StSignFace': MatSpec('#e6dfc8', roughness=0.6),
    'StHazard': MatSpec('#e0a020', roughness=0.6),
    'StRed': MatSpec('#a8322c', roughness=0.55),
    'StLamp': MatSpec('#ffb030', roughness=0.4, emission='#ffb030', strength=3.0),
    'StMesh': MatSpec('#9aa3a0', roughness=0.5, alpha=0.45, double_sided=True),
    'StTarp': MatSpec('#d0671f', roughness=0.8, double_sided=True),
    'StSteel': MatSpec('#6f7678', roughness=0.45),
    'StTimber': MatSpec('#8a7458', roughness=0.85),
})


def _read_frame(depth: float = 0.5) -> None:
    """Where a zombie stands to read a sign: in front of it, facing it."""
    meta.add_frame('read', (0.0, -(depth + 0.45), 0.0), 180.0, 'approach')


@builder('sign_street')
def sign_street(m: Model, spec: LevelSpec) -> None:
    """A street nameplate: a leaning painted post with two blank blades at right angles and a small skull finial.
    The game writes the street names on `plate` (faces the front) and `plate_cross`. `Paint` is the post."""
    add(m, S.cylinder(0.10, 0.06, 8, 0.0, base=(0, 0, 0)), 'StConcrete')
    add(m, S.tube([(0, 0, 0.04), (0.012, 0, 1.3), (0.02, 0, 2.56)], 0.032, 6), 'Paint')
    node(m, 'plate', 'plate', origin=(0.02, 0.0, 2.22), text='streetName')
    add(m, S.box(0.86, 0.02, 0.20, 0.004, 1, loc=(0.02, 0.0, 2.22)), 'StSignFace', 'plate')
    node(m, 'plate_cross', 'plate', origin=(0.02, 0.0, 2.45), text='crossStreetName')
    add(m, S.box(0.02, 0.86, 0.20, 0.004, 1, loc=(0.02, 0.0, 2.45)), 'StSignFace', 'plate_cross')
    for z in (2.22, 2.45):
        add(m, S.box(0.07, 0.07, 0.05, 0.0, 0, loc=(0.02, 0.0, z)), 'Paint')
    add(m, S.sphere(0.055, 7, 5, loc=(0.02, 0.0, 2.615), scale=(1.0, 1.1, 1.0)), 'Bone')
    for sx in (-1, 1):
        add(m, S.sphere(0.012, 4, 3, loc=(0.02 + sx * 0.02, -0.052, 2.625)), 'DecalInk')
    _read_frame()


@builder('sign_construction')
def sign_construction(m: Model, spec: LevelSpec) -> None:
    """The honest sign in front of an unfinished area: an A-frame board that says UNDER CONSTRUCTION, with a blank
    strip (`plate`) for what is being built, hazard stripes and a sandbag."""
    for sx in (-1, 1):
        add(m, S.tube([(sx * 0.36, -0.10, 0.0), (sx * 0.34, 0.0, 1.38)], 0.022, 4), 'StTimber')
        add(m, S.tube([(sx * 0.36, 0.42, 0.0), (sx * 0.34, 0.02, 1.36)], 0.022, 4), 'StTimber')
    add(m, S.box(0.80, 0.03, 0.62, 0.006, 1, base=(0, -0.045, 0.78)), 'StHazard')
    add(m, kit.flat_text('UNDER', 0.105, (0.0, -0.062, 1.27)), 'DecalInk')
    add(m, kit.flat_text('CONSTRUCTION', 0.062, (0.0, -0.062, 1.14)), 'DecalInk')
    node(m, 'plate', 'plate', origin=(0.0, -0.064, 0.98), text='unfinishedWhat')
    add(m, S.box(0.70, 0.010, 0.15, 0.003, 1, loc=(0.0, -0.064, 0.98)), 'StSignFace', 'plate')
    for k in range(5):                                                                   # hazard stripes along the bottom
        add(m, S.box(0.07, 0.008, 0.11, 0.0, 0, loc=(-0.30 + 0.15 * k, -0.062, 0.845), rot=(0, 35, 0)), 'DecalInk')
    add(m, S.blob(0.16, 1, 0.2, 2.4, seed=5, loc=(0.0, 0.26, 0.07), scale=(1.5, 0.9, 0.42), flat_bottom=-0.7), 'StTimber')
    _read_frame()


@builder('barrier_road')
def barrier_road(m: Model, spec: LevelSpec) -> None:
    """A road barrier, three tiles wide: two trestles, two striped planks and two warning lamps (`glow`). Three of
    them close a street from kerb to kerb."""
    for sx in (-1, 1):
        x = sx * 1.12
        for sy in (-1, 1):
            add(m, S.tube([(x, sy * 0.32, 0.0), (x, 0.0, 1.0)], 0.024, 4), 'StTimber')
        add(m, S.box(0.05, 0.42, 0.04, 0.0, 0, loc=(x, 0.0, 0.34)), 'StTimber')
    for z in (0.92, 0.58):
        add(m, S.box(2.70, 0.04, 0.16, 0.004, 1, loc=(0, -0.03, z)), 'StSignFace')
        for k in range(6):
            add(m, S.box(0.20, 0.045, 0.165, 0.0, 0, loc=(-1.125 + 0.45 * k, -0.03, z)), 'StRed')
    node(m, 'glow', 'glow', origin=(0, 0, 1.07), transient=True, blink=True)
    for sx in (-1, 1):
        add(m, S.cylinder(0.05, 0.05, 6, 0.0, base=(sx * 1.12, 0.0, 1.0)), 'StSteel')
        add(m, S.sphere(0.065, 7, 5, loc=(sx * 1.12, 0.0, 1.065)), 'StLamp', 'glow')
    meta.add_frame('read', (0.0, -0.95, 0.0), 180.0, 'approach')


@builder('fence_construction_run')
def fence_construction_run(m: Model, spec: LevelSpec) -> None:
    """One metre of site fence, centred on a tile edge: steel rails, a see-through mesh panel and a torn tarp."""
    for z in (1.80, 0.14):
        add(m, S.tube([(-0.5, 0, z), (0.5, 0, z)], 0.02, 5), 'StSteel')
    add(m, S.box(1.0, 0.006, 1.80, 0.0, 0, loc=(0, 0, 0.90)), 'StMesh')                     # down to the ground
    tarp = S.slab(0.62, 0.008, 1.05, 3, 4, base=(0, 0, 0))
    S.displace(tarp, lambda v: Vector((v.x, v.y + 0.035 * math.sin(v.x * 9.0) * (1.0 - v.z / 1.05), v.z)))
    add(m, S.translate(tarp, (-0.12, -0.03, 0.70)), 'StTarp')
    add(m, S.tube([(-0.40, -0.03, 1.74), (-0.40, -0.01, 1.80)], 0.006, 3), 'StTimber')     # ties
    add(m, S.tube([(0.16, -0.03, 1.74), (0.16, -0.01, 1.80)], 0.006, 3), 'StTimber')


@builder('fence_construction_post')
def fence_construction_post(m: Model, spec: LevelSpec) -> None:
    """The site fence's upright, standing in a concrete foot block. One serves ends, corners and joints."""
    add(m, S.box(0.30, 0.20, 0.12, 0.01, 1, base=(0, 0, 0)), 'StConcrete')
    add(m, S.tube([(0, 0, 0.06), (0, 0, 1.98)], 0.026, 6), 'StSteel')
    for z in (1.80, 0.14):
        add(m, S.cylinder(0.04, 0.05, 6, 0.0, base=(0, 0, z - 0.025)), 'StSteel')
    add(m, S.cylinder(0.032, 0.02, 6, 0.0, base=(0, 0, 1.98)), 'StRed')


@builder('curb_ramp')
def curb_ramp(m: Model, spec: LevelSpec) -> None:
    """A dropped kerb for a crosswalk, two tiles wide: road level at the front, kerb height at the back, with two
    rows of raised studs."""
    depth = 0.60
    wedge = S.slab(2.0, depth, CURB_TOP, 2, 2, base=(0, 0, 0))
    S.displace(wedge, lambda v: Vector((v.x, v.y, v.z * (v.y + depth / 2) / depth)))        # rises from front to back
    add(m, wedge, 'StConcrete')
    add(m, S.box(2.0, CURB_W, 0.012, 0.0, 0, base=(0, depth / 2 - CURB_W / 2, CURB_TOP - 0.012)), 'StConcrete')
    for row, y in enumerate((0.02, 0.14)):
        for k in range(9):
            x = -0.88 + 0.22 * k + 0.11 * row
            if abs(x) > 0.95:
                continue
            z = CURB_TOP * (y + depth / 2) / depth
            add(m, S.cylinder(0.028, 0.008, 6, 0.0, base=(x, y, z - 0.001)), 'StHazard')


@builder('street_end_circle')
def street_end_circle(m: Model, spec: LevelSpec) -> None:
    """The end of a street, one 10 x 10 cell: a kerb round the turning circle, open at the front where the road
    comes in, and a planted island in the middle with a DEAD END sign. The asphalt itself is the renderer's."""
    r_in = 4.05
    r_mid = r_in + CURB_W / 2
    gap = math.asin((ROAD_WIDTH / 2) / r_mid)                                             # the road enters at the front (-Y)
    n = 30
    a0, a1 = -math.pi / 2 + gap, 3 * math.pi / 2 - gap
    for k in range(n):
        a = a0 + (a1 - a0) * (k + 0.5) / n
        chord = r_mid * (a1 - a0) / n + 0.02
        add(m, S.box(chord, CURB_W, CURB_TOP, 0.0, 0, base=(r_mid * math.cos(a), r_mid * math.sin(a), 0.0),
                     rot=(0, 0, math.degrees(a) + 90)), 'StConcrete')
    assert r_in + CURB_W <= CELL / 2 - 0.5, 'the kerb ring has to leave the verge free'
    add(m, S.lathe([(0.0, 0.0), (1.30, 0.0), (1.30, CURB_TOP), (1.18, CURB_TOP + 0.02), (0.0, CURB_TOP + 0.06)], 16), 'StConcrete')
    add(m, S.cylinder(1.12, 0.02, 16, 0.0, base=(0, 0, CURB_TOP + 0.03)), 'SoilDark')
    add(m, S.blob(0.42, 1, 0.28, 2.4, seed=11, loc=(0.35, 0.30, 0.42), scale=(1.2, 1.0, 0.8)), 'Moss')
    add(m, S.blob(0.28, 1, 0.3, 2.8, seed=12, loc=(-0.45, 0.42, 0.34), scale=(1.1, 1.0, 0.8)), 'Moss')
    add(m, S.tube([(-0.10, -0.55, 0.15), (-0.085, -0.55, 0.98)], 0.022, 5), 'StSteel')      # the sign, facing the road
    add(m, S.box(0.56, 0.02, 0.26, 0.004, 1, loc=(-0.085, -0.565, 0.90), rot=(0, 3, 0)), 'StHazard')
    add(m, kit.flat_text('DEAD END', 0.075, (-0.085, -0.578, 0.90)), 'DecalInk')
    for k in range(3):                                                                   # low stone bollards
        a = math.radians(200 + 70 * k)
        add(m, S.cylinder(0.09, 0.42, 7, 0.01, r_top=0.07, base=(0.95 * math.cos(a), 0.95 * math.sin(a), CURB_TOP)), 'GyStone')
