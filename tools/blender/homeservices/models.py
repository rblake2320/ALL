"""Home service furniture (docs/contract-requests/home-build-system.md section 2): the Hearth, the Wardrobe Coffin, the
Crypt Vault, the Bone Workbench and the Bone Gate. Cosy-macabre and E10+ (bones and skulls, no gore), simple shapes
within the objects kit's budgets (3000 triangles each). Floor objects: footprint centred on the origin, floor at z = 0,
front = -Y (exports to +Z), same conventions as the objects kit (tools/blender/objects).

Registered into the objects kit's builder registry, but built and published by build_homeservices.py into its own folder
(public/assets/models/objects/homeservices) under its own toolchain pin."""
from __future__ import annotations

import math

from common import shapes as S
from common.catalog import Spec
from common.model import Model
from objects.registry import builder


def _skull(m: Model, s: float, loc, rot=(0, 0, 0), mat: str = 'SkullShell', node=None, segs: int = 10) -> None:
    bone, sockets = S.skull(s, loc=loc, rot=rot, segs=segs)
    m.add(bone, mat, node)
    m.add(sockets, 'SkullEyes', node)


@builder('hearth_stone')
def hearth_stone(m: Model, spec: Spec) -> None:
    """Stone fireplace: chimney breast against the back, arched-look firebox with grate and logs and a small fire
    (node "flame", three flames), mantel with a skull candle holder and a candle, logs stacked at the side, a poker."""
    j = m.rng
    # floor slab and chimney breast (back edge at y = +0.5)
    m.add(S.box(1.96, 0.96, 0.1, 0.012, 1, base=(0, 0, 0)), 'Slate')
    cy = 0.3  # centre of the chimney depth (0.1 .. 0.5)
    for sx in (-1, 1):
        m.add(S.box(0.36, 0.4, 0.82, 0.012, 1, base=(sx * 0.73, cy, 0.1)), 'Granite')
    m.add(S.box(1.82, 0.4, 0.2, 0.012, 1, base=(0, cy, 0.92)), 'Granite')
    m.add(S.taper_box(1.82, 0.4, 1.3, 0.36, 0.58, 0.012, 1, base=(0, cy, 1.12), shift=(0, 0.01)), 'Granite')
    # darker firebox back and an arch of voussoir blocks over the opening
    m.add(S.box(1.14, 0.04, 0.84, 0.0, 0, base=(0, 0.3, 0.1)), 'Charcoal')
    for k in range(7):
        a = math.radians(180 - 180 * (k + 0.5) / 7)
        x, z = math.cos(a) * 0.62, 0.92 + math.sin(a) * 0.1
        m.add(S.box(0.16, 0.04, 0.1, 0.006, 1, loc=(x, 0.095, z), rot=(0, -math.degrees(a) + 90, 0)), 'StoneLight')
    # a few stone courses across the breast
    for z in (1.3, 1.46, 1.6):
        m.add(S.box(1.2 + (1.7 - z) * 0.2, 0.012, 0.012, 0.0, 0, base=(0, 0.095, z)), 'Charcoal')
    # mantel shelf with the skull candle holder and a plain candle
    m.add(S.box(1.98, 0.5, 0.08, 0.01, 1, base=(0, 0.25, 1.12)), 'StoneLight')
    _skull(m, 0.075, (0.55, 0.22, 1.2 + 0.075), mat='Bone')
    m.add(S.candle(0.13, 0.021, base=(0.55, 0.22, 1.2 + 0.15), drips=2, seed=1), 'Wax')
    m.add(S.cylinder(0.05, 0.02, 10, 0.004, base=(-0.55, 0.22, 1.2)), 'Brass')
    m.add(S.candle(0.17, 0.021, base=(-0.55, 0.22, 1.22), drips=3, seed=2), 'Wax')
    # firebox: andirons, grate bars, logs and embers
    for sx in (-1, 1):
        m.add(S.box(0.05, 0.4, 0.05, 0.004, 1, base=(sx * 0.4, 0.24, 0.1)), 'Iron')
        m.add(S.box(0.05, 0.05, 0.22, 0.004, 1, base=(sx * 0.4, 0.07 + 0.1, 0.1)), 'Iron')
        m.add(S.sphere(0.035, 8, 5, loc=(sx * 0.4, 0.17, 0.34)), 'Iron')
    for y in (0.2, 0.28, 0.36):
        m.add(S.cylinder(0.012, 0.8, 6, 0.0, base=(0, y, 0.2), rot=(0, 90, 0)), 'Iron')
    m.add(S.box(0.84, 0.3, 0.05, 0.01, 1, base=(0, 0.28, 0.12)), 'Ember')
    for k, (x, y, rz) in enumerate(((-0.18, 0.28, 8), (0.16, 0.26, -12), (0.0, 0.3, 2))):
        m.add(S.cylinder(0.065, 0.62, 9, 0.006, base=(x, y, 0.27 + (0.1 if k == 2 else 0)), rot=(0, 90, rz)), 'Bark')
        m.add(S.cylinder(0.052, 0.01, 9, 0.0, base=(x + 0.31, y, 0.27 + (0.1 if k == 2 else 0)), rot=(0, 90, rz)), 'BarkLight')
    # the fire: three flames as children of one "flame" node (the runtime flickers and toggles them)
    m.node('flame', origin=(0, 0.27, 0.34), extras={'part': 'flame'}, transient=True)
    for k, (x, h) in enumerate(((-0.17, 0.36), (0.0, 0.46), (0.17, 0.32))):
        name = f'flame_{k}'
        m.node(name, parent='flame', origin=(x, 0.27, 0.34), transient=True)
        m.add(S.flame(h, 0.1, base=(x, 0.27, 0.34), lean=j.sym(0.02)), 'Flame', name)
        m.add(S.flame(h * 0.6, 0.055, base=(x, 0.265, 0.345)), 'FlameCore', name)
    # log stack beside the hearth (front left) and a poker leaning on the right jamb
    for k, (x, y, z) in enumerate(((-0.82, -0.28, 0.1), (-0.66, -0.28, 0.1), (-0.74, -0.28, 0.2))):
        m.add(S.cylinder(0.065, 0.36, 8, 0.006, base=(x, -0.12, z + 0.065), rot=(90, 0, 0)), 'Bark')
    m.add(S.tube([(0.9, 0.1, 0.1), (0.9, 0.1, 0.6), (0.88, 0.1, 0.78), (0.84, 0.1, 0.84)], 0.012, 5), 'Iron')
    m.add(S.sphere(0.025, 6, 4, loc=(0.9, 0.09, 0.1)), 'Iron')


@builder('wardrobe_coffin')
def wardrobe_coffin(m: Model, spec: Spec) -> None:
    """Upright hexagonal coffin on its foot end: two mirrored doors with brass handles and a carved trim,
    bone-knob feet. The body takes the Paint colour."""
    outline = [(-0.23, 0.1), (0.23, 0.1), (0.4, 1.3), (0.29, 1.86), (-0.29, 1.86), (-0.4, 1.3)]
    m.add(S.prism(outline, 0.5, 0.012, 1, plane='XZ'))
    # carved trim: a slightly smaller raised panel on the front, split into two doors
    inner = [(-0.2, 0.2), (0.2, 0.2), (0.34, 1.28), (0.25, 1.76), (-0.25, 1.76), (-0.34, 1.28)]
    m.add(S.prism(inner, 0.02, 0.004, 1, plane='XZ', loc=(0, -0.255, 0)), 'WoodLight')
    for sx in (-1, 1):
        m.add(S.prism([(0.02 * sx, 0.45), (0.2 * sx, 0.45), (0.2 * sx, 1.6), (0.02 * sx, 1.6)][::sx], 0.012, 0.0, 0, plane='XZ', loc=(0, -0.268, 0)), 'Mirror')
        m.add(S.cylinder(0.014, 0.05, 8, 0.002, base=(sx * 0.045, -0.29, 1.0), rot=(90, 0, 0)), 'Brass')
        m.add(S.sphere(0.022, 8, 5, loc=(sx * 0.045, -0.31, 1.0)), 'Brass')
    m.add(S.box(0.012, 0.03, 1.5, 0.0, 0, base=(0, -0.265, 0.2)), 'WoodEbony')
    # top and shoulder trim
    m.add(S.box(0.64, 0.54, 0.04, 0.006, 1, base=(0, 0, 1.86)), 'WoodDark')
    m.add(S.box(0.82, 0.54, 0.03, 0.004, 1, base=(0, 0, 1.28)), 'WoodDark')
    # a small bone finial on top
    m.add(S.bone(0.16, 0.014, 1.9, loc=(0, 0, 1.93), rot=(0, 0, 0)), 'Bone')
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.add(S.sphere(0.04, 7, 5, loc=(sx * 0.16, sy * 0.17, 0.04)), 'Bone')


@builder('vault_crypt')
def vault_crypt(m: Model, spec: Spec) -> None:
    """Squat stone sarcophagus-style chest: domed lid, three iron bands, a brass padlock, a bone skull plaque on the
    front and moss in the corners."""
    m.add(S.box(0.92, 0.62, 0.6, 0.02, 2, base=(0, 0, 0)), 'StoneLight')
    m.add(S.taper_box(0.96, 0.66, 0.74, 0.42, 0.2, 0.02, 2, base=(0, 0, 0.6)), 'Granite')
    for x in (-0.3, 0.0, 0.3):
        m.add(S.box(0.06, 0.64, 0.64, 0.004, 1, base=(x, 0, 0)), 'Iron')
        m.add(S.box(0.06, 0.55, 0.05, 0.004, 1, base=(x, 0, 0.77)), 'Iron')
    # padlock and plaque on the front (-Y)
    m.add(S.box(0.14, 0.05, 0.16, 0.01, 1, base=(0, -0.345, 0.34)), 'Brass')
    m.add(S.torus(0.04, 0.011, 12, 5, loc=(0, -0.345, 0.5), rot=(90, 0, 0), arc=360), 'Iron')
    m.add(S.cylinder(0.014, 0.03, 6, 0.0, base=(0, -0.375, 0.37), rot=(90, 0, 0)), 'Iron')
    _skull(m, 0.07, (0.0, -0.345, 0.54), mat='Bone')
    # moss and a cobweb corner
    for k, (x, y) in enumerate(((-0.4, -0.25), (0.42, 0.22), (-0.38, 0.26))):
        m.add(S.blob(0.07, 1, 0.3, 3, 7 + k, loc=(x, y, 0.03), scale=(1.2, 1.1, 0.5)), 'Moss')
    # four stubby feet
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.add(S.box(0.1, 0.1, 0.02, 0.006, 1, base=(sx * 0.4, sy * 0.25, -0.0)), 'Granite')


@builder('workbench_bone')
def workbench_bone(m: Model, spec: Spec) -> None:
    """Thick plank bench on four femur legs with cross braces, an iron vise at the right end, a mallet, a saw and a
    coil of wire on top. The bench top takes the Paint colour."""
    j = m.rng
    top_z = 0.86
    m.add(S.box(1.9, 0.8, 0.1, 0.012, 2, base=(0, 0, top_z)))
    for k in range(4):  # plank seams
        m.add(S.box(1.88, 0.004, 0.004, 0.0, 0, base=(0, -0.3 + k * 0.2, top_z + 0.1)), 'WoodDark')
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.add(S.bone(0.76, 0.04, 1.9, loc=(sx * 0.8, sy * 0.3, 0.43), rot=(0, 90, 0)), 'Bone')
    for sy in (-1, 1):
        m.add(S.box(1.6, 0.04, 0.05, 0.004, 1, base=(0, sy * 0.3, 0.25)), 'WoodDark')
    for sx in (-1, 1):
        m.add(S.box(0.04, 0.6, 0.05, 0.004, 1, base=(sx * 0.8, 0, 0.25)), 'WoodDark')
    # iron vise at the right end
    m.add(S.box(0.16, 0.22, 0.08, 0.006, 1, base=(0.8, -0.28, top_z + 0.1)), 'Iron')
    m.add(S.box(0.05, 0.12, 0.1, 0.004, 1, base=(0.8, -0.32, top_z + 0.1)), 'Iron')
    m.add(S.cylinder(0.014, 0.18, 8, 0.0, base=(0.8, -0.3, top_z + 0.16), rot=(90, 0, 0)), 'Steel')
    m.add(S.sphere(0.022, 8, 5, loc=(0.8, -0.49, top_z + 0.16)), 'Iron')
    # mallet, saw and wire coil on the bench
    m.add(S.box(0.16, 0.09, 0.09, 0.008, 1, loc=(-0.55, 0.12, top_z + 0.145), rot=(0, 0, 18)), 'WoodDark')
    m.add(S.cylinder(0.014, 0.36, 8, 0.0, base=(-0.55, 0.12, top_z + 0.105), rot=(0, 90, 18)), 'WoodLight')
    m.add(S.prism([(-0.28, 0.0), (0.22, 0.0), (0.28, 0.07), (-0.28, 0.07)], 0.008, 0.0, 0, plane='XY', loc=(0.05, -0.18, top_z + 0.1), rot=(0, 0, -6)), 'Steel')
    m.add(S.box(0.1, 0.03, 0.06, 0.006, 1, base=(-0.28, -0.2, top_z + 0.1)), 'Wood')
    m.add(S.torus(0.07, 0.016, 14, 5, loc=(-0.15, 0.22, top_z + 0.12)), 'Copper')
    # a few bone shavings and a stool-leg blank
    for k in range(3):
        m.add(S.sphere(0.014, 5, 3, loc=(j.uniform(-0.4, 0.4), j.uniform(-0.2, 0.3), top_z + 0.105), scale=(1.6, 1, 0.4)), 'Bone')


@builder('gate_bone')
def gate_bone(m: Model, spec: Spec) -> None:
    """Freestanding arch of bones on two stone plinths: knobbly bone ribs round a circle, two skulls at the spring
    points and one at the keystone, a flat swirling green glow disc filling the arch (node "glow")."""
    cx, cz, r = 0.0, 1.3, 0.8
    for sx in (-1, 1):
        m.add(S.box(0.4, 0.5, 0.25, 0.015, 2, base=(sx * 0.8, 0, 0)), 'StoneLight')
        m.add(S.box(0.3, 0.4, 0.04, 0.008, 1, base=(sx * 0.8, 0, 0.25)), 'Granite')
    # pillars: straight bone ribs; the arch: an arc of ribs (two ribs side by side for body)
    for dy in (-0.05, 0.05):
        for sx in (-1, 1):
            m.add(S.tube([(sx * r, dy, 0.29), (sx * r, dy, cz)], 0.045, 6, radii=[0.05, 0.036]), 'Bone')
        arc = S.arc_points(r, 0, 180, 14, center=(cx, dy, cz), plane='XZ')
        radii = [0.036 + 0.014 * abs(math.cos(i * math.pi / 1.5)) for i in range(len(arc))]
        m.add(S.tube([tuple(p) for p in arc], 0.04, 6, radii=radii, cap=True), 'Bone')
    # knuckle knobs along the arch
    for i in range(2, 13, 5):
        a = math.radians(180 * i / 14)
        m.add(S.sphere(0.058, 7, 4, loc=(cx + math.cos(a) * r, -0.075, cz + math.sin(a) * r)), 'Bone')
    # skulls: spring points (facing front) and the keystone
    for sx in (-1, 1):
        _skull(m, 0.1, (sx * r, -0.11, cz + 0.02), mat='Bone')
    _skull(m, 0.11, (0.0, -0.11, cz + r + 0.02), mat='Bone')
    # swirling green glow disc, a thin flat cylinder facing the front (the runtime pulses and toggles it)
    m.node('glow', origin=(cx, 0.0, cz), extras={'part': 'glow'}, transient=True)
    m.add(S.cylinder(r - 0.06, 0.012, 28, 0.0, base=(cx, 0.0, cz), rot=(90, 0, 0)), 'GlowToxic', 'glow')
    # a few small bones leaning at the foot of the plinths
    for sx in (-1, 1):
        m.add(S.bone(0.22, 0.016, 1.9, loc=(sx * 0.42, -0.2, 0.025), rot=(0, 0, 20 * sx)), 'Bone')
