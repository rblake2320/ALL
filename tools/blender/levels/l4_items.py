"""L4 Bayou small items: the eight Bayou Finds curios (docs/levels/L4-bayou.md §5.6), one mesh per curio id for the
shared `item_curio` object. Real size, resting on z = 0, each within 400 triangles."""
from __future__ import annotations

import math

from common import shapes as S
from common.model import Model

from . import l4_home  # noqa: F401  (the Bayou palette)
from .kit import add, builder
from .spec import LevelSpec


@builder('curio_bottleMessage')
def bottle_message(m: Model, spec: LevelSpec) -> None:
    """A corked bottle on its side with a rolled note inside."""
    z = 0.030
    add(m, S.tube([(0, -0.105, z), (0, -0.07, z), (0, -0.04, z), (0, 0.085, z), (0, 0.10, z)], 0.03, 10,
                  radii=[0.011, 0.011, 0.030, 0.030, 0.024]), 'GlassGrimy')
    add(m, S.tube([(0, -0.118, z), (0, -0.098, z)], 0.0095, 6), 'Cork')
    add(m, S.tube([(0, -0.03, z - 0.008), (0, 0.075, z - 0.008)], 0.012, 6), 'PaperOld')            # the note
    add(m, S.torus(0.0125, 0.002, 6, 3, loc=(0, 0.02, z - 0.008), rot=(90, 0, 0)), 'EnamelRed')     # its ribbon
    add(m, S.torus(0.0125, 0.0035, 8, 3, loc=(0, -0.098, z), rot=(90, 0, 0)), 'GlassGrimy')         # lip


@builder('curio_lanternHook')
def lantern_hook(m: Model, spec: LevelSpec) -> None:
    """A rusty wall hook: a plate with two nail holes and a curled arm."""
    add(m, S.box(0.03, 0.09, 0.004, 0.001, 1, base=(0, 0.03, 0.0)), 'Rust')
    for y in (0.0, 0.06):
        add(m, S.cylinder(0.0045, 0.002, 6, 0.0, base=(0, y, 0.004)), 'IronOld')
    arm = [(0, 0.03, 0.006), (0, -0.01, 0.010), (0, -0.05, 0.008)] + \
          [(0.022 - 0.022 * math.cos(math.radians(a)), -0.05 - 0.022 * math.sin(math.radians(a)), 0.008) for a in range(30, 271, 40)]
    add(m, S.tube(arm, 0.005, 5, radii=[0.006] * 3 + [0.005] * 6 + [0.003]), 'Rust')
    add(m, S.sphere(0.0055, 5, 3, loc=arm[-1]), 'IronOld')                                          # the knobbed tip


@builder('curio_cypressCarving')
def cypress_carving(m: Model, spec: LevelSpec) -> None:
    """A cypress knee somebody carved a frog into. Or a face. Or a frog face."""
    add(m, S.lathe([(0.034, 0.0), (0.030, 0.02), (0.026, 0.05), (0.020, 0.078), (0.010, 0.094), (0.0, 0.098)], 10), 'ByBark')
    add(m, S.sphere(0.021, 8, 5, loc=(0, -0.012, 0.052), scale=(1.0, 0.8, 0.85)), 'WoodLight')      # the carved face
    for sx in (-1, 1):
        add(m, S.sphere(0.0075, 6, 4, loc=(sx * 0.011, -0.022, 0.064)), 'WoodLight')                # bulging eyes
        add(m, S.sphere(0.003, 4, 3, loc=(sx * 0.012, -0.029, 0.065)), 'Charcoal')
    add(m, S.tube([(-0.014, -0.028, 0.047), (0, -0.031, 0.043), (0.014, -0.028, 0.047)], 0.0018, 3), 'Charcoal')   # the wide mouth
    for sx in (-1, 1):                                                                              # knife flats
        add(m, S.box(0.012, 0.004, 0.022, 0.0, 0, loc=(sx * 0.024, -0.012, 0.028), rot=(0, sx * 8, sx * 40)), 'WoodLight')


@builder('curio_riverboatToken')
def riverboat_token(m: Model, spec: LevelSpec) -> None:
    """A brass fare token with a paddle wheel struck on it."""
    add(m, S.cylinder(0.017, 0.003, 14, 0.0006, base=(0, 0, 0)), 'Brass')
    add(m, S.torus(0.0155, 0.0011, 14, 3, loc=(0, 0, 0.003)), 'Brass')                              # rim
    add(m, S.torus(0.009, 0.0009, 10, 3, loc=(0, 0, 0.0032)), 'Bronze')                             # the wheel
    for k in range(4):
        add(m, S.box(0.018, 0.0012, 0.0008, 0.0, 0, loc=(0, 0, 0.0034), rot=(0, 0, 45 * k)), 'Bronze')
    add(m, S.cylinder(0.002, 0.0012, 6, 0.0, base=(0, 0, 0.003)), 'Bronze')
    add(m, S.cylinder(0.0018, 0.0034, 6, 0.0, base=(0, 0.0125, 0.0)), 'Charcoal')                   # punched hole


@builder('curio_pearlButton')
def pearl_button(m: Model, spec: LevelSpec) -> None:
    """A freshwater pearl button with a scrap of thread still in it."""
    add(m, S.lathe([(0.0, 0.0), (0.010, 0.0), (0.012, 0.0015), (0.0115, 0.0035), (0.008, 0.0042), (0.0, 0.0036)], 14), 'Shell')
    for k in range(4):
        a = math.tau * k / 4 + math.pi / 4
        add(m, S.cylinder(0.0012, 0.0008, 5, 0.0, base=(0.0034 * math.cos(a), 0.0034 * math.sin(a), 0.0038)), 'Charcoal')
    add(m, S.tube([(-0.0024, -0.0024, 0.0046), (0.0024, 0.0024, 0.0046)], 0.0005, 3), 'Curtain')
    add(m, S.tube([(0.0024, -0.0024, 0.0046), (-0.0024, 0.0024, 0.0046), (-0.009, 0.006, 0.0042), (-0.016, 0.004, 0.0008)], 0.0005, 3), 'Curtain')


@builder('curio_fiddlePeg')
def fiddle_peg(m: Model, spec: LevelSpec) -> None:
    """An ebony tuning peg: a tapered shaft with a string hole and a flat thumb grip."""
    z = 0.0062
    add(m, S.tube([(0, -0.036, z - 0.002), (0, 0.010, z)], 0.004, 8, radii=[0.0028, 0.0042]), 'WoodEbony')
    add(m, S.torus(0.0044, 0.0012, 8, 3, loc=(0, 0.010, z), rot=(90, 0, 0)), 'Bone')                # collar ring
    add(m, S.superellipsoid(0.0095, 0.011, 0.0028, 0.7, 0.6, 10, 4, loc=(0, 0.022, z)), 'WoodEbony')  # thumb grip
    add(m, S.sphere(0.0022, 5, 3, loc=(0, 0.034, z)), 'Bone')                                       # pip
    add(m, S.cylinder(0.0009, 0.009, 4, 0.0, base=(0, -0.022, z - 0.0055)), 'Charcoal')             # string hole
    add(m, S.tube([(0, -0.022, z + 0.0035), (0.006, -0.027, z + 0.004), (0.011, -0.024, 0.0015)], 0.0004, 3), 'Silver')  # a curl of old string


@builder('curio_gatorTooth')
def gator_tooth(m: Model, spec: LevelSpec) -> None:
    """Old Toothless's lost tooth: a curved, hollow-rooted cone with a worn tip."""
    pts = [(0.0, 0.030, 0.0085), (0.001, 0.012, 0.0085), (0.004, -0.008, 0.0075), (0.009, -0.024, 0.006), (0.015, -0.034, 0.0045)]
    add(m, S.tube(pts, 0.008, 8, radii=[0.0085, 0.0082, 0.0066, 0.0042, 0.0014]), 'Teeth')
    add(m, S.torus(0.0078, 0.0012, 8, 3, loc=pts[0], rot=(90, 0, 0)), 'BoneDark')                   # root rim
    add(m, S.cylinder(0.0055, 0.0015, 8, 0.0, base=(0.0, 0.0312, 0.0085), rot=(90, 0, 0)), 'Gum')   # the hollow root
    for k in range(3):                                                                              # growth ridges
        add(m, S.tube([(0.001 + 0.002 * k, 0.018 - 0.012 * k, 0.0166 - 0.0012 * k), (0.002 + 0.003 * k, 0.008 - 0.012 * k, 0.0158 - 0.0016 * k)],
                      0.0006, 3), 'BoneDark')


@builder('curio_sunkenCompass')
def sunken_compass(m: Model, spec: LevelSpec) -> None:
    """A pocket compass, lid sprung open, green from the pond. The needle points at the diner."""
    add(m, S.cylinder(0.026, 0.011, 10, 0.0, base=(0, 0, 0)), 'Verdigris')
    add(m, S.cylinder(0.0225, 0.0015, 10, 0.0, base=(0, 0, 0.011)), 'PaperOld')                     # the card
    add(m, S.torus(0.0235, 0.0018, 10, 3, loc=(0, 0, 0.0115)), 'Brass')
    for k in range(4):
        a = math.tau * k / 4
        add(m, S.box(0.0012, 0.005, 0.0006, 0.0, 0, loc=(0.0185 * math.sin(a), 0.0185 * math.cos(a), 0.0128), rot=(0, 0, -math.degrees(a))), 'Charcoal')
    add(m, S.box(0.0030, 0.019, 0.0008, 0.0, 0, loc=(0.0045, -0.0075, 0.0136), rot=(0, 0, 31)), 'EnamelRed')   # needle, north half
    add(m, S.box(0.0030, 0.019, 0.0008, 0.0, 0, loc=(-0.0045, 0.0075, 0.0136), rot=(0, 0, 31)), 'Steel')
    add(m, S.cylinder(0.0022, 0.0022, 6, 0.0, base=(0, 0, 0.0128)), 'Brass')
    lid = S.cylinder(0.026, 0.003, 10, 0.0, base=(0, 0.026, 0))
    S.rotate(lid, (-68, 0, 0), pivot=(0, 0.026, 0.0))
    add(m, S.translate(lid, (0, 0.002, 0.011)), 'Verdigris')
    add(m, S.cylinder(0.003, 0.012, 6, 0.0, base=(-0.006, 0.027, 0.011), rot=(0, 90, 0)), 'Brass')  # hinge
    add(m, S.torus(0.006, 0.0014, 6, 3, loc=(0, -0.031, 0.006), rot=(0, 90, 0)), 'Brass')           # bow ring
    add(m, S.sphere(0.006, 5, 3, loc=(0.017, -0.012, 0.004), scale=(1.4, 1.0, 0.5)), 'ByMud')     # dried pond mud
