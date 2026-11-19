"""L4 Bayou builders, part 2: the fish camp (bait rack, tackle counter, bait tank, rod rack, hiring board), the
diner (counter, booth, jukebox) and the gator pond (viewing platform, sunning log). Conventions are the level
kit's: Blender front = -Y, Z up, floor pieces centred on their footprint, base at z = 0."""
from __future__ import annotations

import math

from mathutils import Vector

from common import shapes as S
from common.materials import MatSpec
from common.model import Model

from . import kit
from . import l4_home  # noqa: F401  (the Bayou palette)
from .kit import add, builder, node
from .spec import LevelSpec

kit.LEVEL_LOOKS.update({
    'ByVinyl': MatSpec('#a8322c', roughness=0.45),
    'ByVinylPatch': MatSpec('#c9b28a', roughness=0.7),
    'ByFormica': MatSpec('#d9d2bc', roughness=0.4),
    'ByMinnow': MatSpec('#c8d4d8', roughness=0.3),
    'ByFrog': MatSpec('#5f8a3a', roughness=0.6),
    'ByBubble': MatSpec('#9be8c8', roughness=0.3, emission='#9be8c8', strength=3.5),
    'ByMapPaper': MatSpec('#cdbf94', roughness=0.9),
    'ByPie': MatSpec('#b9793a', roughness=0.7),
    'ByCooler': MatSpec('#7fb8ad', roughness=0.5),
})


def jar(m: Model, x: float, y: float, z: float, r: float = 0.055, h: float = 0.13, lid: str = 'Tin') -> None:
    add(m, S.cylinder(r, h, 6, 0.0, base=(x, y, z)), 'Glass')
    add(m, S.cylinder(r * 0.9, 0.022, 6, 0.0, base=(x, y, z + h)), lid)


@builder('rack_bait')
def rack_bait(m: Model, spec: LevelSpec) -> None:
    y = 0.14
    for sx in (-1, 1):
        add(m, S.box(0.035, 0.42, 1.46, 0.006, 1, base=(sx * 0.43, y, 0.0), rot=(0, sx * 1.5, 0)), 'ByPlankDark')
    add(m, S.box(0.86, 0.02, 1.40, 0.0, 0, base=(0, y + 0.20, 0.04)), 'ByPlank')                      # back boards
    for k, z in enumerate((0.46, 0.86, 1.24)):
        add(m, S.box(0.84, 0.40, 0.03, 0.005, 1, base=(0, y, z), rot=(0, 1.2 if k == 1 else 0, 0)), 'ByPlank')
    for (x, z, lid) in ((-0.28, 0.49, 'Tin'), (-0.12, 0.49, 'TinRed'), (0.26, 0.89, 'Tin'), (0.10, 0.89, 'Tin'),
                        (-0.22, 0.89, 'TinRed'), (-0.05, 1.27, 'Tin')):
        jar(m, x, y - 0.04, z, lid=lid)
    add(m, S.box(0.20, 0.14, 0.10, 0.01, 1, base=(0.24, y - 0.02, 1.27)), 'Cardboard')                # box of hooks
    add(m, S.box(0.24, 0.20, 0.12, 0.012, 1, base=(0.22, y - 0.03, 0.49)), 'TinRed')                  # tackle tin
    add(m, S.box(0.56, 0.34, 0.27, 0.03, 1, base=(0.0, y - 0.06, 0.0)), 'ByCooler')                   # the cooler
    add(m, S.box(0.58, 0.36, 0.05, 0.015, 1, base=(0.0, y - 0.06, 0.27)), 'Enamel')
    add(m, S.tube([(-0.16, y - 0.25, 0.20), (-0.16, y - 0.29, 0.14), (0.16, y - 0.29, 0.14), (0.16, y - 0.25, 0.20)], 0.012, 4), 'Enamel')
    add(m, S.box(0.30, 0.012, 0.11, 0.0, 0, loc=(0, y - 0.215, 1.40)), 'ByMapPaper')                  # "BAIT" card


@builder('counter_tackle')
def counter_tackle(m: Model, spec: LevelSpec) -> None:
    add(m, S.box(2.80, 0.56, 0.86, 0.012, 1, base=(0, -0.10, 0.0)), 'ByPlank')                        # the counter
    for k in range(7):
        add(m, S.box(0.012, 0.012, 0.80, 0.0, 0, base=(-1.2 + 0.4 * k, -0.386, 0.03)), 'ByPlankDark') # plank seams
    add(m, S.box(2.92, 0.68, 0.05, 0.012, 1, base=(0, -0.10, 0.86)), 'ByPlankDark')
    # the till
    add(m, S.box(0.36, 0.34, 0.16, 0.02, 1, base=(-0.95, -0.08, 0.91)), 'Brass')
    add(m, S.box(0.30, 0.20, 0.16, 0.02, 1, base=(-0.95, -0.01, 1.07), rot=(-18, 0, 0)), 'Brass')
    add(m, S.box(0.24, 0.02, 0.07, 0.0, 0, loc=(-0.95, -0.26, 0.97)), 'IronOld')
    for k in range(4):
        add(m, S.cylinder(0.016, 0.02, 6, 0.0, base=(-1.04 + 0.06 * k, -0.10, 1.215)), 'Bone')
    # a scale and a bucket of worms on the counter
    add(m, S.box(0.26, 0.20, 0.05, 0.01, 1, base=(0.20, -0.14, 0.91)), 'IronOld')
    add(m, S.cylinder(0.11, 0.012, 10, 0.0, base=(0.20, -0.14, 1.02)), 'Tin')
    add(m, S.cylinder(0.012, 0.06, 5, 0.0, base=(0.20, -0.14, 0.96)), 'IronOld')
    add(m, S.lathe([(0.07, 0.0), (0.09, 0.14), (0.095, 0.15)], 8, base=(1.05, -0.12, 0.91), cap_top=False), 'Tin')
    add(m, S.cylinder(0.085, 0.01, 8, 0.0, base=(1.05, -0.12, 1.02)), 'SoilDark')
    # pegboard wall behind, with hooks, lures and the mounted (plastic) fish
    for sx in (-1, 1):
        add(m, S.box(0.07, 0.07, 1.94, 0.008, 1, base=(sx * 1.36, 0.42, 0.0)), 'ByPlankDark')
    add(m, S.box(2.72, 0.03, 0.92, 0.0, 0, base=(0, 0.43, 1.00)), 'Cork')
    add(m, S.box(2.80, 0.06, 0.06, 0.008, 1, base=(0, 0.42, 1.90)), 'ByPlankDark')
    for k in range(8):
        x = -1.15 + 0.22 * k + (0.03 if k % 3 == 0 else 0.0)
        z = 1.62 - 0.11 * (k % 3)
        add(m, S.tube([(x, 0.41, z), (x, 0.36, z), (x, 0.36, z - 0.03)], 0.006, 3), 'IronOld')
        add(m, S.sphere(0.022, 5, 3, loc=(x, 0.36, z - 0.07), scale=(1, 1, 1.8)), 'FloatRed' if k % 2 else 'Brass')
    add(m, S.box(0.74, 0.03, 0.30, 0.01, 1, loc=(0.78, 0.40, 1.52), rot=(0, 3, 0)), 'WoodDark')       # plaque, hung crooked
    fish = S.superellipsoid(0.27, 0.035, 0.09, 0.7, 0.7, 10, 5, loc=(0.76, 0.365, 1.52), rot=(0, 3, 0))
    add(m, fish, 'ByMinnow')
    add(m, S.box(0.10, 0.012, 0.15, 0.0, 0, loc=(1.06, 0.365, 1.535), rot=(0, 3, 0)), 'ByMinnow')     # tail
    add(m, S.sphere(0.014, 5, 3, loc=(0.56, 0.335, 1.53)), 'Black')


@builder('tank_bait')
def tank_bait(m: Model, spec: LevelSpec) -> None:
    for sx in (-1, 1):                                                                                 # trestle stand
        for sy in (-1, 1):
            add(m, S.box(0.07, 0.07, 0.44, 0.008, 1, base=(sx * 0.82, sy * 0.26, 0.0)), 'ByPlankDark')
    add(m, S.box(1.82, 0.68, 0.05, 0.008, 1, base=(0, 0, 0.42)), 'ByPlank')
    add(m, S.box(1.70, 0.04, 0.10, 0.006, 1, base=(0, -0.26, 0.20)), 'ByPlankDark')
    outer = [(-0.86, -0.30), (0.86, -0.30), (0.86, 0.30), (-0.86, 0.30)]
    add(m, S.outline_ring(outer, S.offset_outline(outer, 0.02), 0.47, 0.93, 0.0, 0), 'Glass')         # the glass
    add(m, S.box(1.72, 0.60, 0.012, 0.0, 0, base=(0, 0, 0.47)), 'Tin')
    add(m, S.outline_ring(S.offset_outline(outer, -0.012), S.offset_outline(outer, 0.025), 0.93, 0.965, 0.0, 0), 'Tin')
    node(m, 'water', 'water', origin=(0, 0, 0.86))
    add(m, S.box(1.66, 0.54, 0.37, 0.0, 0, base=(0, 0, 0.485)), 'Water', 'water')
    j = m.rng
    for k in range(7):                                                                                 # minnows
        x, y, z = j.uniform(-0.7, 0.7), j.uniform(-0.18, 0.18), j.uniform(0.56, 0.80)
        add(m, S.superellipsoid(0.045, 0.012, 0.016, 0.7, 0.7, 6, 3, loc=(x, y, z), rot=(0, 0, j.uniform(-40, 40))), 'ByMinnow')
    add(m, S.tube([(0.78, 0.24, 0.99), (0.78, 0.24, 0.52)], 0.012, 4), 'RubberGreen')                 # bubbler hose
    for k in range(4):
        add(m, S.sphere(0.012 + 0.003 * k, 5, 3, loc=(0.74 - 0.01 * k, 0.22, 0.56 + 0.07 * k)), 'Glass')
    add(m, S.box(0.20, 0.14, 0.10, 0.01, 1, base=(0.66, 0.22, 0.965)), 'IronOld')                     # pump
    add(m, S.tube([(-0.60, -0.36, 0.44), (-0.60, -0.33, 0.99)], 0.008, 4), 'Bamboo')                  # dip net
    add(m, S.torus(0.07, 0.006, 8, 3, loc=(-0.60, -0.33, 1.0), rot=(90, 0, 0)), 'IronOld')


@builder('rack_rods')
def rack_rods(m: Model, spec: LevelSpec) -> None:
    for k, x in enumerate((-0.95, 0.0, 0.95)):                                                         # crates
        add(m, S.box(0.88, 0.50, 0.36, 0.01, 1, base=(x, 0.12, 0.0), rot=(0, 0, (-2, 0, 3)[k])), 'ByPlank')
        for z in (0.09, 0.27):
            add(m, S.box(0.90, 0.012, 0.05, 0.0, 0, loc=(x, -0.135, z), rot=(0, 0, (-2, 0, 3)[k])), 'ByPlankDark')
    for sx in (-1, 1):
        add(m, S.box(0.07, 0.07, 1.88, 0.008, 1, base=(sx * 1.38, 0.40, 0.0)), 'ByPlankDark')
    for z in (1.10, 1.78):
        add(m, S.box(2.84, 0.05, 0.09, 0.008, 1, base=(0, 0.40, z)), 'ByPlankDark')
    j = m.rng
    for k in range(10):                                                                                # the rods
        x = -1.22 + 0.27 * k
        lean = j.uniform(-0.03, 0.03)
        foot, tip = (x, 0.05, 0.36), (x + lean, 0.36, 1.86 - 0.05 * (k % 3))
        add(m, S.tube([foot, tip], 0.012, 4, radii=[0.014, 0.005]), ('Bamboo', 'ByCypressLight', 'WoodLight')[k % 3])
        add(m, S.tube([foot, (x, 0.09, 0.56)], 0.018, 4), 'Cork')                                     # grip
        add(m, S.cylinder(0.03, 0.024, 6, 0.0, base=(x + 0.022, 0.10, 0.60), rot=(0, 90, 0)), 'Brass' if k % 2 else 'IronOld')
    add(m, S.box(0.50, 0.012, 0.16, 0.0, 0, loc=(0, 0.37, 1.60), rot=(0, -2, 0)), 'ByMapPaper')       # price card


@builder('board_swampguide')
def board_swampguide(m: Model, spec: LevelSpec) -> None:
    for sx in (-1, 1):
        add(m, S.box(0.07, 0.07, 1.62, 0.008, 1, base=(sx * 0.40, 0.10, 0.0), rot=(0, sx * 1.5, 0)), 'ByBark')
    add(m, S.box(0.92, 0.04, 0.78, 0.008, 1, base=(0, 0.07, 0.78)), 'ByPlank')
    add(m, S.box(1.00, 0.16, 0.04, 0.008, 1, base=(0, 0.08, 1.60), rot=(8, 0, 0)), 'ByPlankDark')     # little roof
    add(m, S.box(0.70, 0.008, 0.46, 0.0, 0, loc=(-0.04, 0.046, 1.10), rot=(0, -2, 0)), 'ByMapPaper')  # hand-painted map
    river = [(-0.34, 0.04, 0.95), (-0.20, 0.04, 1.06), (-0.06, 0.04, 1.02), (0.08, 0.04, 1.16), (0.24, 0.04, 1.22)]
    add(m, S.tube(river, 0.012, 3), 'Cobalt')
    for (x, z) in ((-0.26, 1.20), (-0.10, 1.24), (0.14, 1.00), (0.20, 1.04)):                          # trees on the map
        add(m, S.cone(0.025, 0.05, 4, base=(x, 0.036, z)), 'ByCypress')
    add(m, S.box(0.05, 0.006, 0.05, 0.0, 0, loc=(0.02, 0.038, 1.10), rot=(0, 45, 0)), 'EnamelRed')    # "you are here"
    add(m, kit.flat_text('GUIDES WANTED', 0.085, (0, 0.048, 1.43)), 'DecalInk')
    add(m, S.box(0.30, 0.008, 0.20, 0.0, 0, loc=(0.27, 0.044, 0.92), rot=(0, 6, 0)), 'Paper')         # tear-off notice
    for k in range(4):
        add(m, S.box(0.012, 0.010, 0.07, 0.0, 0, loc=(0.16 + 0.07 * k, 0.040, 0.84)), 'ByPlank')
    add(m, S.sphere(0.014, 5, 3, loc=(0.27, 0.04, 1.01)), 'Brass')
    add(m, S.superellipsoid(0.07, 0.06, 0.04, 0.6, 0.6, 8, 4, loc=(-0.30, 0.08, 1.665)), 'ByFrog')    # a frog on the roof
    for sx in (-1, 1):
        add(m, S.sphere(0.018, 5, 3, loc=(-0.30 + sx * 0.03, 0.035, 1.70)), 'ByFrog')


@builder('counter_diner')
def counter_diner(m: Model, spec: LevelSpec) -> None:
    y = 0.14
    add(m, S.box(4.80, 0.50, 0.98, 0.012, 1, base=(0, y, 0.0)), 'ByVinyl')                            # counter front
    add(m, S.box(4.82, 0.012, 0.10, 0.0, 0, loc=(0, y - 0.256, 0.10)), 'Chrome')                      # kick rail
    for k in range(6):
        add(m, S.box(0.03, 0.012, 0.78, 0.0, 0, loc=(-2.0 + 0.8 * k, y - 0.256, 0.56)), 'Chrome')
    add(m, S.box(4.92, 0.66, 0.05, 0.012, 1, base=(0, y - 0.04, 0.98)), 'ByFormica')
    add(m, S.box(4.94, 0.02, 0.06, 0.0, 0, loc=(0, y - 0.378, 1.005)), 'Chrome')                      # chrome edge
    for k, x in enumerate((-2.0, -1.0, 0.0, 1.0, 2.0)):                                                # stools
        tilt = 4 if k == 3 else 0
        add(m, S.cylinder(0.15, 0.025, 10, 0.0, base=(x, -0.30, 0.0)), 'Chrome')
        add(m, S.cylinder(0.032, 0.60, 6, 0.0, base=(x, -0.30, 0.02)), 'Chrome')
        add(m, S.torus(0.12, 0.012, 8, 3, loc=(x, -0.30, 0.26)), 'Chrome')                            # foot ring
        add(m, S.cylinder(0.17, 0.085, 12, 0.025, base=(x, -0.30, 0.62), rot=(tilt, 0, 0)), 'ByVinyl' if k != 1 else 'ByVinylPatch')
    # pie case
    case = [(0.95, y - 0.24), (1.65, y - 0.24), (1.65, y + 0.14), (0.95, y + 0.14)]
    add(m, S.box(0.74, 0.42, 0.03, 0.0, 0, base=(1.30, y - 0.05, 1.03)), 'Chrome')
    add(m, S.outline_ring(case, S.offset_outline(case, 0.012), 1.06, 1.33, 0.0, 0), 'Glass')
    add(m, S.box(0.72, 0.40, 0.02, 0.0, 0, base=(1.30, y - 0.05, 1.33)), 'Chrome')
    add(m, S.cylinder(0.13, 0.05, 10, 0.012, base=(1.15, y - 0.05, 1.06)), 'ByPie')
    pie = S.cylinder(0.13, 0.05, 10, 0.012, base=(0, 0, 0))
    S.displace(pie, lambda v: Vector((v.x, max(v.y, -0.02), v.z)))                                    # one slice gone
    add(m, S.translate(pie, (1.47, y - 0.05, 1.06)), 'ByPie')
    # napkin holders, a coffee pot, a plate
    for x in (-1.5, 0.3):
        add(m, S.box(0.14, 0.06, 0.11, 0.008, 1, base=(x, y - 0.10, 1.03)), 'Chrome')
        add(m, S.box(0.12, 0.03, 0.09, 0.0, 0, base=(x, y - 0.10, 1.045)), 'Paper')
    add(m, S.lathe([(0.07, 0.0), (0.085, 0.10), (0.05, 0.17), (0.055, 0.19)], 8, base=(-0.55, y + 0.02, 1.03)), 'Glass')
    add(m, S.cylinder(0.062, 0.08, 8, 0.0, base=(-0.55, y + 0.02, 1.04)), 'WoodEbony')                # the coffee
    add(m, S.tube([(-0.47, y + 0.02, 1.17), (-0.42, y + 0.02, 1.13), (-0.47, y + 0.02, 1.07)], 0.009, 4), 'Black')
    add(m, S.cylinder(0.10, 0.012, 10, 0.0, base=(-2.05, y - 0.16, 1.03)), 'Porcelain')
    add(m, S.box(0.05, 0.012, 0.012, 0.0, 0, loc=(-1.90, y - 0.16, 1.036), rot=(0, 0, 30)), 'Steel')


@builder('booth_diner')
def booth_diner(m: Model, spec: LevelSpec) -> None:
    add(m, S.box(1.90, 0.62, 0.36, 0.012, 1, base=(0, -0.02, 0.0)), 'WoodDark')                       # plinth
    add(m, S.box(1.92, 0.012, 0.05, 0.0, 0, loc=(0, -0.335, 0.33)), 'Chrome')
    for sx in (-1, 1):                                                                                 # two seat cushions
        add(m, S.cushion(0.93, 0.60, 0.13, 0.02, 0.3, loc=(sx * 0.475, -0.03, 0.425)), 'ByVinyl')
    add(m, S.box(1.90, 0.10, 1.12, 0.012, 1, base=(0, 0.42, 0.0)), 'WoodDark')                        # back wall
    for sx in (-1, 1):                                                                                 # tufted back pads
        pad = S.cushion(0.93, 0.74, 0.12, 0.015, 0.3, loc=(0, 0, 0))
        S.rotate(pad, (80, 0, 0))
        add(m, S.translate(pad, (sx * 0.475, 0.33, 0.76)), 'ByVinyl')
        for bx in (-0.22, 0.22):
            add(m, S.sphere(0.022, 6, 3, loc=(sx * 0.475 + bx, 0.262, 0.80), scale=(1, 0.5, 1)), 'Chrome')
    add(m, S.box(1.94, 0.14, 0.035, 0.01, 1, base=(0, 0.41, 1.12)), 'Chrome')                         # top rail
    # patches: tape on the seat, a sewn square on the back
    add(m, S.box(0.20, 0.13, 0.008, 0.0, 0, loc=(-0.52, -0.12, 0.492), rot=(0, 0, 18)), 'ByVinylPatch')
    add(m, S.box(0.07, 0.30, 0.008, 0.0, 0, loc=(0.60, -0.05, 0.492), rot=(0, 0, -8)), 'Tin')
    add(m, S.box(0.18, 0.008, 0.16, 0.0, 0, loc=(0.36, 0.268, 0.66), rot=(-10, 0, 6)), 'ByVinylPatch')
    for sx in (-1, 1):                                                                                 # end panels
        add(m, S.box(0.04, 0.72, 0.62, 0.008, 1, base=(sx * 0.955, 0.08, 0.0)), 'WoodDark')


@builder('jukebox_swamp')
def jukebox_swamp(m: Model, spec: LevelSpec) -> None:
    y = 0.08
    add(m, S.box(0.80, 0.50, 0.14, 0.02, 1, base=(0, y, 0.0)), 'WoodDark')                            # plinth
    add(m, S.box(0.76, 0.46, 0.90, 0.03, 2, base=(0, y, 0.12)), 'Wood')
    add(m, S.superellipsoid(0.38, 0.23, 0.38, 0.9, 0.45, 16, 8, loc=(0, y, 1.00)), 'Wood')            # arched top
    add(m, S.box(0.52, 0.02, 0.34, 0.01, 1, loc=(0, y - 0.235, 0.40)), 'Cork')                        # speaker cloth
    for k in range(4):
        add(m, S.box(0.012, 0.014, 0.34, 0.0, 0, loc=(-0.18 + 0.12 * k, y - 0.248, 0.40)), 'Brass')
    add(m, S.box(0.50, 0.03, 0.26, 0.01, 1, loc=(0, y - 0.225, 0.80), rot=(-12, 0, 0)), 'Glass')      # record window
    add(m, S.cylinder(0.10, 0.008, 10, 0.0, base=(0, y - 0.215, 0.78), rot=(78, 0, 0)), 'Black')
    add(m, S.box(0.56, 0.05, 0.05, 0.01, 1, loc=(0, y - 0.245, 0.615)), 'Brass')                      # button rail
    for k in range(6):
        add(m, S.box(0.045, 0.02, 0.025, 0.0, 0, loc=(-0.20 + 0.08 * k, y - 0.275, 0.615)), 'Bone')
    add(m, S.box(0.04, 0.012, 0.07, 0.0, 0, loc=(0.30, y - 0.236, 0.50)), 'Brass')                    # coin slot
    node(m, 'glow', 'glow', origin=(0, y - 0.24, 0.9), transient=True)
    arch = [(-0.34, y - 0.24, 0.16)] + [(0.34 * math.cos(math.radians(a)), y - 0.24, 1.00 + 0.34 * math.sin(math.radians(a)))
                                        for a in range(180, -1, -30)] + [(0.34, y - 0.24, 0.16)]
    add(m, S.tube(arch, 0.028, 6), 'ByBubble', 'glow')                                                # bubble tube
    # the frog on top, mid-croak
    add(m, S.superellipsoid(0.10, 0.12, 0.065, 0.6, 0.6, 10, 5, loc=(0.04, y, 1.425), rot=(0, 0, 20)), 'ByFrog')
    add(m, S.sphere(0.05, 8, 5, loc=(0.02, y - 0.10, 1.41)), 'ByMushroom')                            # throat sac
    for sx in (-1, 1):
        add(m, S.sphere(0.028, 6, 4, loc=(0.03 + sx * 0.05, y - 0.07, 1.485)), 'ByFrog')
        add(m, S.sphere(0.012, 5, 3, loc=(0.025 + sx * 0.055, y - 0.092, 1.492)), 'Black')
        add(m, S.box(0.07, 0.10, 0.03, 0.01, 1, loc=(0.04 + sx * 0.12, y + 0.02, 1.385), rot=(0, 0, sx * 25)), 'ByFrog')


@builder('platform_viewing')
def platform_viewing(m: Model, spec: LevelSpec) -> None:
    dz = 0.55                                                                                          # deck height
    y0, y1 = -0.95, 0.40
    for x in (-1.85, -0.62, 0.62, 1.85):                                                               # pilings
        for y in (y0 + 0.08, y1 - 0.08):
            add(m, S.cylinder(0.07, dz, 6, 0.0, base=(x, y, 0.0), rot=(0, 1.5 if x > 0 else -1, 0)), 'ByBark')
    add(m, S.box(3.86, y1 - y0, 0.07, 0.008, 1, base=(0, (y0 + y1) / 2, dz - 0.07)), 'ByPlank')       # deck
    for k in range(9):
        add(m, S.box(0.012, y1 - y0 - 0.02, 0.006, 0.0, 0, loc=(-1.72 + 0.43 * k, (y0 + y1) / 2, dz + 0.002)), 'ByPlankDark')
    add(m, S.box(3.80, 0.05, 0.14, 0.006, 1, base=(0, y0 + 0.03, dz - 0.21)), 'ByPlankDark')
    # rail on the pond side (front) and both ends
    posts = [(x, y0 + 0.05) for x in (-1.88, -0.94, 0.0, 0.94, 1.88)] + [(sx * 1.88, y1 - 0.05) for sx in (-1, 1)]
    for (x, y) in posts:
        add(m, S.box(0.07, 0.07, 1.02, 0.006, 1, base=(x, y, dz)), 'ByPlankDark')
    for z in (dz + 0.50, dz + 0.98):
        add(m, S.box(3.86, 0.05, 0.07, 0.006, 1, base=(0, y0 + 0.05, z), rot=(0, 0.6 if z > 1.2 else 0, 0)), 'ByPlank')
        for sx in (-1, 1):
            add(m, S.box(0.05, y1 - y0 - 0.10, 0.07, 0.006, 1, base=(sx * 1.88, (y0 + y1) / 2, z)), 'ByPlank')
    # steps up at the back
    for k in range(3):
        add(m, S.box(0.95, 0.19, 0.045, 0.006, 1, base=(1.25, 0.90 - 0.18 * k, 0.12 + 0.145 * k)), 'ByPlank')
    for sx in (-1, 1):
        add(m, S.tube([(1.25 + sx * 0.50, 0.93, 0.0), (1.25 + sx * 0.50, 0.42, dz - 0.05)], 0.035, 4, scale_xy=(0.6, 1.8)), 'ByPlankDark')   # on the 4 x 2 (W-073)
    # the coin binocular (decor)
    bx, by = -0.75, y0 + 0.22
    add(m, S.cylinder(0.10, 0.03, 8, 0.0, base=(bx, by, dz)), 'IronOld')
    add(m, S.cylinder(0.035, 1.12, 6, 0.0, base=(bx, by, dz + 0.02)), 'IronOld')
    add(m, S.box(0.20, 0.26, 0.20, 0.04, 2, loc=(bx, by, dz + 1.27), rot=(12, 0, 0)), 'Verdigris')
    for sx in (-1, 1):
        add(m, S.cylinder(0.045, 0.10, 8, 0.0, base=(bx + sx * 0.055, by - 0.12, dz + 1.245), rot=(102, 0, 0)), 'Brass')
    add(m, S.box(0.05, 0.02, 0.07, 0.0, 0, loc=(bx + 0.105, by, dz + 1.20)), 'Brass')                 # coin box
    add(m, S.box(0.40, 0.02, 0.24, 0.006, 1, loc=(0.9, y0 + 0.012, dz + 0.74), rot=(0, -2, 0)), 'ByMapPaper')   # "DO NOT FEED. (HE'S FULL.)"


@builder('den_gator')
def den_gator(m: Model, spec: LevelSpec) -> None:
    add(m, S.cylinder(0.94, 0.018, 14, 0.0, base=(0, 0, 0.0)), 'ByMud')                               # the wallow
    log = S.cylinder(0.40, 1.80, 12, 0.03, base=(0, 0, -0.90))
    S.displace(log, lambda v: Vector((v.x * (1 + 0.08 * math.sin(v.z * 5)), v.y * (1 + 0.10 * math.cos(v.z * 3.3)), v.z)))
    S.rotate(log, (0, 90, 14))
    S.translate(log, (0.0, 0.05, 0.13))
    S.displace(log, lambda v: Vector((v.x, v.y, max(v.z, 0.0))))                                      # half sunk
    add(m, log, 'ByBark')
    for sx in (-1, 1):                                                                                 # ring ends
        cap = S.cylinder(0.33, 0.012, 12, 0.0, base=(0, 0, -0.006))
        S.rotate(cap, (0, 90, 14))
        S.translate(cap, (sx * 0.878, 0.05 + sx * 0.219, 0.13))
        S.displace(cap, lambda v: Vector((v.x, v.y, max(v.z, 0.0))))
        add(m, cap, 'WoodLight')
    stub = S.cylinder(0.09, 0.30, 7, 0.0, r_top=0.06, base=(0, 0, 0))                                  # a broken limb
    S.rotate(stub, (-35, 20, 0))
    add(m, S.translate(stub, (0.35, 0.22, 0.40)), 'ByBark')
    for k in range(4):                                                                                 # claw marks along the top
        add(m, S.box(0.30, 0.022, 0.012, 0.0, 0, loc=(-0.42 + 0.07 * k, -0.02 + 0.045 * k, 0.532 - 0.004 * k), rot=(0, 0, 62)), 'Charcoal')
    add(m, S.blob(0.16, 1, 0.25, 2.4, seed=7, loc=(-0.62, 0.02, 0.46), scale=(1.3, 1.0, 0.35)), 'Moss')
    add(m, S.blob(0.12, 1, 0.25, 2.4, seed=8, loc=(0.58, 0.30, 0.44), scale=(1.2, 1.0, 0.35)), 'Moss')
    for (x, y, r) in ((-0.55, -0.60, 0.07), (0.62, -0.52, 0.05), (-0.20, 0.70, 0.06)):                 # cypress knees
        add(m, S.cone(r, r * 3.4, 6, base=(x, y, 0.0)), 'ByBark')
    add(m, S.box(0.20, 0.14, 0.012, 0.0, 0, loc=(0.30, -0.62, 0.024), rot=(0, 0, 25)), 'Tin')          # a chewed bait tin
