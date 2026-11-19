"""Yard furniture builders (W-109 part 2). Conventions are the level kit's (tools/blender/levels/kit.py): Blender
front = -Y, Z up, floor pieces centred on their footprint, base at z = 0. Contact frames are FRAME_ Empties
(manifest_meta.add_frame); the driver reads and removes them before the model is built."""
from __future__ import annotations

import math

from mathutils import Vector

import manifest_meta as meta
from common import dims
from common import shapes as S
from common.materials import MatSpec
from common.model import Model

from . import kit
from .kit import add, builder, node
from .spec import LevelSpec

kit.LEVEL_LOOKS.update({
    'YdPlank': MatSpec('#8a7458', roughness=0.85),
    'YdPlankDark': MatSpec('#5c4a38', roughness=0.9),
    'YdCoal': MatSpec('#ff7a2a', roughness=0.6, emission='#ff7a2a', strength=3.0),
    'YdEnamel': MatSpec('#27323a', roughness=0.35),
    'YdLily': MatSpec('#4f7a3c', roughness=0.7),
})


@builder('picnic_table')
def picnic_table(m: Model, spec: LevelSpec) -> None:
    """Weathered plank table with attached benches along its long sides, 2 x 3 tiles, top at table height."""
    top, seat = dims.TABLE_HEIGHT, dims.SEAT_HEIGHT
    length = 2.5
    for k in range(4):                                                                   # top planks, one warped
        x = -0.33 + 0.22 * k
        add(m, S.box(0.20, length, 0.04, 0.006, 1, loc=(x, 0, top - 0.02), rot=(0, 2.5 if k == 2 else 0, 0)), 'YdPlank')
    for sx in (-1, 1):                                                                   # benches, two planks each
        for dx in (-0.09, 0.09):
            add(m, S.box(0.16, length, 0.04, 0.006, 1, loc=(sx * 0.78 + dx, 0, seat - 0.02)), 'YdPlank')
    for y in (-0.85, 0.85):                                                              # A-frames
        for sx in (-1, 1):
            add(m, S.tube([(sx * 0.92, y, 0.0), (sx * 0.22, y, top - 0.05)], 0.035, 4, scale_xy=(1.0, 1.8)), 'YdPlankDark')
        add(m, S.box(1.90, 0.045, 0.09, 0.0, 0, loc=(0, y, seat - 0.085)), 'YdPlankDark')    # the cross piece that carries the benches
        add(m, S.box(0.86, 0.045, 0.07, 0.0, 0, loc=(0, y, top - 0.075)), 'YdPlankDark')
    add(m, S.tube([(0, -0.85, seat - 0.06), (0, 0.0, top - 0.09), (0, 0.85, seat - 0.06)], 0.022, 4), 'YdPlankDark')   # braces
    add(m, kit.flat_text('R.I.P. + D.O.A.', 0.06, (0.02, 0.35, top + 0.0015), rot=(0, 0, 90)), 'DecalInk')   # the carved initials
    add(m, S.box(0.10, 0.07, 0.006, 0.0, 0, loc=(-0.25, -0.6, top + 0.003), rot=(0, 0, 20)), 'Moss')       # a patch of moss
    for name, sx, y in (('n0', -1, -0.55), ('n1', -1, 0.55), ('s0', 1, -0.55), ('s1', 1, 0.55)):
        meta.add_frame(name, (sx * 0.78, y, seat), 90.0 * sx * -1, 'seat')                 # facing the table
    meta.add_frame('approach', (0.0, -1.9, 0.0), 180.0, 'approach')


@builder('swing_creaky')
def swing_creaky(m: Model, spec: LevelSpec) -> None:
    """An A-frame of rusted pipe with two chain swings; one chain is longer. `Paint` is the frame."""
    top = 2.18
    for sx in (-1, 1):                                                                   # the A at each end
        for sy in (-1, 1):
            add(m, S.tube([(sx * 0.90, sy * 0.44, 0.0), (sx * 0.86, 0.0, top)], 0.035, 6), 'Paint')
        add(m, S.tube([(sx * 0.885, -0.24, 1.0), (sx * 0.885, 0.24, 1.0)], 0.022, 5), 'Paint')
    add(m, S.tube([(-0.93, 0, top), (0.93, 0, top)], 0.04, 6), 'Paint')                   # top bar
    add(m, S.box(0.18, 0.012, 0.10, 0.0, 0, loc=(0.5, -0.045, top - 0.3), rot=(0, 25, 0)), 'Rust')   # a rust patch
    for i, (x, drop) in enumerate(((-0.42, 1.72), (0.42, 1.66))):                        # the right swing hangs a little crooked
        name = f'swing{i}'
        node(m, name, name, origin=(x, 0.0, top))
        for k, sx in enumerate((-1, 1)):
            d = drop + (0.07 if (i == 1 and k == 1) else 0.0)
            add(m, S.tube([(x + sx * 0.20, 0, top - 0.04), (x + sx * 0.20, 0, top - d)], 0.010, 4), 'IronOld', name)
            add(m, S.torus(0.03, 0.008, 6, 3, loc=(x + sx * 0.20, 0, top - 0.04), rot=(0, 90, 0)), 'IronOld', name)
        add(m, S.box(0.50, 0.20, 0.035, 0.006, 1, loc=(x, 0, top - drop - 0.02), rot=(0, 4.5 if i == 1 else 0, 0)), 'YdPlank', name)
        meta.add_frame(f'seat_{i}', (x, 0.0, top - drop), 0.0, 'seat')
    meta.add_frame('approach', (0.0, -1.1, 0.0), 180.0, 'approach')


@builder('birdbath_skull')
def birdbath_skull(m: Model, spec: LevelSpec) -> None:
    """A stone birdbath whose bowl is an upturned skull cap, with a rim birds can perch on."""
    add(m, S.lathe([(0.0, 0.0), (0.24, 0.0), (0.22, 0.06), (0.10, 0.12), (0.075, 0.30), (0.085, 0.62), (0.13, 0.70), (0.0, 0.70)], 10), 'StoneLight')
    bowl_z = 0.70
    add(m, S.lathe([(0.0, 0.0), (0.16, 0.02), (0.30, 0.12), (0.36, 0.26), (0.33, 0.27), (0.27, 0.15), (0.0, 0.08)], 12,
                   base=(0, 0, bowl_z)), 'Bone')                                           # the cranium, upside down
    for a in (-0.5, 0.5):                                                                # eye sockets and nose under the rim
        add(m, S.sphere(0.055, 6, 4, loc=(0.20 * math.sin(a), -0.26 * math.cos(a) - 0.02, bowl_z + 0.15)), 'Black')
    add(m, S.cone(0.03, 0.05, 4, base=(0, -0.285, bowl_z + 0.07)), 'Black')
    node(m, 'water', 'water', origin=(0, 0, bowl_z + 0.20))
    add(m, S.cylinder(0.29, 0.012, 12, 0.0, base=(0, 0, bowl_z + 0.19)), 'Water', 'water')
    add(m, S.blob(0.05, 1, 0.3, 3.0, seed=2, loc=(0.20, 0.12, 0.05), scale=(1.5, 1.2, 0.5)), 'Moss')
    meta.add_frame('perch', (0.0, 0.345, bowl_z + 0.265), 180.0, 'feet')                  # a bird on the far rim, facing the water
    meta.add_frame('perch_2', (-0.30, -0.17, bowl_z + 0.265), 60.0, 'feet')
    meta.add_frame('use', (0.0, -0.80, 0.0), 180.0, 'approach')


@builder('grill_bbq')
def grill_bbq(m: Model, spec: LevelSpec) -> None:
    """A kettle grill on three legs with a side shelf: coals glow under the grate, the lid is its own node."""
    bz, r = 0.62, 0.30
    add(m, S.lathe([(0.0, 0.0), (0.12, 0.01), (0.24, 0.08), (r, 0.20), (r, 0.22), (0.27, 0.21), (0.20, 0.10), (0.0, 0.05)], 12,
                   base=(0, 0, bz)), 'YdEnamel')                                           # the bowl
    for k in range(3):                                                                   # legs, two with wheels
        a = math.tau * k / 3 + math.pi / 2
        foot = (0.34 * math.cos(a), 0.34 * math.sin(a), 0.07 if k else 0.0)
        add(m, S.tube([(0.16 * math.cos(a), 0.16 * math.sin(a), bz + 0.04), foot], 0.014, 4), 'Chrome')
        if k:
            add(m, S.cylinder(0.07, 0.03, 8, 0.0, base=(foot[0], foot[1] - 0.015, 0.07), rot=(90, 0, math.degrees(a) + 90)), 'Rubber')
    add(m, S.torus(0.22, 0.008, 10, 3, loc=(0, 0, 0.26)), 'Chrome')                       # the leg ring
    node(m, 'flame', 'flame', origin=(0, 0, bz + 0.12), transient=True)
    add(m, S.cylinder(0.21, 0.02, 10, 0.0, base=(0, 0, bz + 0.11)), 'Charcoal')
    for k in range(6):
        a = math.tau * k / 6
        add(m, S.sphere(0.035, 5, 3, loc=(0.11 * math.cos(a), 0.11 * math.sin(a), bz + 0.135), scale=(1, 1, 0.6)), 'YdCoal', 'flame')
    for k in range(5):                                                                   # the grate
        x = -0.20 + 0.10 * k
        half = math.sqrt(max(0.0, 0.27 ** 2 - x * x))
        add(m, S.tube([(x, -half, bz + 0.205), (x, half, bz + 0.205)], 0.006, 3), 'Chrome')
    add(m, S.torus(0.27, 0.007, 12, 3, loc=(0, 0, bz + 0.205)), 'Chrome')
    node(m, 'lid', 'lid', origin=(0, r, bz + 0.22))                                       # hinged at the back
    lid = S.lathe([(r + 0.005, 0.0), (0.27, 0.10), (0.16, 0.18), (0.0, 0.21)], 12, cap_bottom=False)
    S.rotate(lid, (38, 0, 0), pivot=(0, r, 0))                                           # propped open
    add(m, S.translate(lid, (0, 0, bz + 0.22)), 'YdEnamel', 'lid')
    knob = S.cylinder(0.035, 0.03, 6, 0.0, base=(0, 0, 0.215))
    S.rotate(knob, (38, 0, 0), pivot=(0, r, 0))
    add(m, S.translate(knob, (0, 0, bz + 0.22)), 'WoodDark', 'lid')
    add(m, S.box(0.24, 0.22, 0.02, 0.004, 1, loc=(0.375, -0.05, bz + 0.17)), 'YdPlank')   # side shelf, inside the tile
    add(m, S.tube([(0.27, -0.05, bz + 0.16), (0.27, -0.05, bz + 0.08), (0.40, -0.05, bz + 0.16)], 0.008, 3), 'Chrome')
    add(m, S.tube([(0.34, -0.10, bz + 0.185), (0.45, 0.02, bz + 0.185)], 0.008, 3), 'Chrome')   # tongs
    add(m, S.tube([(0.31, -0.02, bz + 0.185), (0.44, -0.11, bz + 0.185)], 0.008, 3), 'Chrome')
    meta.add_frame('cook', (0.0, -0.80, 0.0), 180.0, 'approach')
    meta.add_frame('hands', (0.0, -0.30, bz + 0.26), 180.0, 'hands')


@builder('pond_yard')
def pond_yard(m: Model, spec: LevelSpec) -> None:
    """A small garden pond: a ring of stones round dark water, lily pads, a few reeds, a mossy rock."""
    j = m.rng
    node(m, 'water', 'water', origin=(0, 0, 0.06))
    add(m, S.cylinder(0.75, 0.02, 14, 0.0, base=(0.0, 0.0, 0.05)), 'PondWater', 'water')
    add(m, S.cylinder(0.81, 0.05, 14, 0.0, base=(0.0, 0.0, 0.0)), 'SoilDark')            # the liner
    for k in range(12):                                                                  # rim stones, uneven
        a = math.tau * k / 12 + j.sym(0.08)
        rr = 0.79 + j.sym(0.03)                                                          # the whole ring stays on its tiles
        sz = j.uniform(0.11, 0.17)
        add(m, S.blob(sz, 1, 0.25, 2.6, seed=20 + k, loc=(rr * math.cos(a), rr * math.sin(a), sz * 0.45),
                      scale=(1.25, 1.0, 0.62), flat_bottom=-0.7), 'GyStone' if k % 3 else 'GyStoneDark')
    for (x, y, r) in ((-0.28, 0.10, 0.13), (0.22, -0.30, 0.10), (0.34, 0.24, 0.085), (-0.10, -0.42, 0.07)):   # lily pads
        add(m, S.cylinder(r, 0.008, 7, 0.0, base=(x, y, 0.072)), 'YdLily', 'water')
    add(m, S.cone(0.035, 0.05, 5, base=(-0.28, 0.10, 0.08)), 'LilyFlower', 'water')
    for k in range(5):                                                                   # reeds at the back
        x, y = -0.45 + 0.07 * k, 0.55 + j.sym(0.05)
        h = j.uniform(0.16, 0.24)
        add(m, S.tube([(x, y, 0.05), (x + j.sym(0.03), y, 0.05 + h)], 0.008, 3), 'Reed')
    add(m, S.blob(0.10, 1, 0.3, 3.0, seed=40, loc=(0.56, 0.54, 0.16), scale=(1.5, 1.2, 0.4)), 'Moss')
    meta.add_frame('view', (0.0, -1.5, 0.0), 180.0, 'approach')
