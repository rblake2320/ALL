"""Miscellaneous + lighting: fly zapper, formaldehyde diffuser, crooked mailbox, reanimation kit, prosthetic crate,
skull lamp, drippy candelabra, candle sconce (wall), lantern post."""
from __future__ import annotations

import math

from mathutils import Vector

from common import dims
from common import shapes as S
from common.catalog import Spec
from common.model import Model

from .parts import add_broken, nail_heads
from .registry import builder


@builder('zapper_fly')
def zapper_fly(m: Model, spec: Spec) -> None:
    j = m.rng
    m.add(S.lathe([(0.2, 0.0), (0.2, 0.03), (0.12, 0.06), (0.05, 0.08), (0.0, 0.08)], 16), 'Iron')
    m.add(S.cylinder(0.022, 1.32, 8, 0.0, base=(0, 0, 0.06)), 'Iron')
    for z in (0.5, 1.0):
        m.add(S.torus(0.03, 0.008, 10, 3, loc=(0, 0, z)), 'Iron')
    z0, z1 = 1.38, 1.8
    m.add(S.cylinder(0.14, 0.03, 16, 0.006, base=(0, 0, z0 - 0.03)), 'Iron')
    m.add(S.lathe([(0.15, 0.0), (0.15, 0.02), (0.08, 0.07), (0.02, 0.09), (0.0, 0.09)], 16, base=(0, 0, z1)), 'Iron')
    m.add(S.torus(0.025, 0.005, 8, 3, loc=(0, 0, z1 + 0.11), rot=(90, 0, 0)), 'Iron')
    for k in range(12):
        a = math.tau * k / 12
        m.add(S.cylinder(0.005, z1 - z0, 4, 0.0, base=(math.cos(a) * 0.135, math.sin(a) * 0.135, z0)), 'Iron')
    for z in (z0 + 0.12, z0 + 0.26):
        m.add(S.torus(0.135, 0.005, 16, 3, loc=(0, 0, z)), 'Iron')
    # glowing violet-blue tube inside (glow, on while powered)
    m.node('glow', origin=(0, 0, z0), extras={'part': 'glow', 'flicker': 'buzz'}, transient=True)
    m.add(S.cylinder(0.075, z1 - z0 - 0.04, 12, 0.02, base=(0, 0, z0 + 0.02)), 'GlowZapper', 'glow')
    # casualties at the base
    for k in range(7):
        a = j.uniform(0, math.tau)
        r = j.uniform(0.08, 0.3)
        m.add(S.sphere(0.012, 5, 3, loc=(math.cos(a) * r, math.sin(a) * r, 0.085 if r < 0.18 else 0.006),
                       scale=(1.4, 0.8, 0.5)), 'Black')
    add_broken(m, (0.0, 0.0, z1 + 0.05), 0.7)


@builder('diffuser_formaldehyde')
def diffuser_formaldehyde(m: Model, spec: Spec) -> None:
    """Fluted marble pedestal with a chunky apothecary bottle of glowing green formaldehyde (skull label, cork, rattan
    reeds) breathing out a curly toxic wisp that pools over the pedestal top."""
    j = m.rng
    m.add(S.box(0.34, 0.34, 0.07, 0.016, 2, base=(0, 0, 0)), 'StoneLight')
    prof = [(0.11, 0.07), (0.085, 0.11), (0.075, 0.38), (0.095, 0.42), (0.13, 0.45)]
    m.add(S.lathe(prof, 12), 'StoneLight')
    for k in range(8):
        a = math.tau * k / 8
        m.add(S.box(0.012, 0.012, 0.26, 0.004, 1, base=(math.cos(a) * 0.08, math.sin(a) * 0.08, 0.12)), 'Marble')
    m.add(S.box(0.32, 0.32, 0.045, 0.012, 1, base=(0, 0, 0.45)), 'StoneLight')
    z = 0.495
    bottle = S.lathe([(0.0, 0.0), (0.085, 0.0), (0.1, 0.03), (0.1, 0.11), (0.06, 0.16), (0.03, 0.18), (0.03, 0.22),
                      (0.038, 0.226), (0.0, 0.23)], 14, base=(0, 0, z))
    m.add(bottle, 'Glass')
    m.add(S.lathe([(0.0, 0.0), (0.092, 0.0), (0.095, 0.08), (0.0, 0.1)], 14, base=(0, 0, z + 0.005)), 'GlowToxic')
    m.add(S.cylinder(0.034, 0.05, 10, 0.006, base=(0, 0, z + 0.205)), 'Cardboard')
    label = S.box(0.11, 0.004, 0.07, 0.0, 0, loc=(0, -0.101, z + 0.07))
    m.add(label, 'Paper')
    sk, so = S.skull(0.02, loc=(0, -0.105, z + 0.075), segs=6, jaw=False)
    m.add(sk, 'Bone')
    m.add(so, 'Black')
    for k in range(5):
        a = math.tau * k / 5 + 0.3
        m.add(S.tube([(0, 0, z + 0.2), (math.cos(a) * 0.07, math.sin(a) * 0.07, z + 0.34)], 0.0035, 3), 'WoodLight')
    wisp = S.catmull([(0.0, 0.0, z + 0.24), (0.035, 0.0, z + 0.28), (-0.025, 0.012, z + 0.32), (0.035, -0.012, z + 0.36),
                      (0.0, 0.02, z + 0.4)], 3)
    radii = [0.014 + 0.014 * math.sin(math.pi * i / (len(wisp) - 1)) for i in range(len(wisp))]
    radii[-1] = 0.0
    m.add(S.tube(wisp, radii=radii, segs=6), 'Wisp')
    for k in range(3):
        a = math.tau * k / 3 + 0.5
        m.add(S.blob(0.05, 1, 0.3, 3.0, k, loc=(math.cos(a) * 0.12, math.sin(a) * 0.12, z + 0.005), scale=(1.4, 1.0, 0.25)),
              'Wisp')


@builder('mailbox_crooked')
def mailbox_crooked(m: Model, spec: Spec) -> None:
    j = m.rng
    lean = (5, -3, 0)
    post = S.box(0.09, 0.09, 1.0, 0.01, 1, base=(0, 0, 0))
    S.rotate(post, lean)
    m.add(post, 'WoodLight')
    top = Vector((0, 0, 1.0))
    import mathutils as _mu
    R = _mu.Euler([math.radians(a) for a in lean]).to_matrix()
    tip = R @ top
    m.add(S.blob(0.12, 1, 0.3, 3, 2, loc=(0, 0, 0.03), scale=(1.3, 1.3, 0.25), flat_bottom=-0.1), 'SoilDark')
    # rounded mailbox (box + half-cylinder roof), front door at -Y
    L, W, Hb = 0.48, 0.22, 0.14
    bx = S.box(W, L, Hb, 0.008, 1, base=(0, 0, 0))
    roof = S.cylinder(W / 2, L, 14, 0.0, base=(0, -L / 2, Hb), rot=(-90, 0, 0))
    for v in roof.verts:
        if v.co.z < Hb:
            v.co.z = Hb
    body = S.merge(bx, roof)
    # dents
    for v in body.verts:
        if v.co.x > 0.08 and abs(v.co.y) < 0.1 and v.co.z > 0.08:
            v.co.x -= 0.012
    S.rotate(body, (lean[0] + 2, lean[1] - 2, j.sym(3)))
    m.add(S.translate(body, tip + Vector((0, -0.05, 0.0))), 'Rust')
    door = S.cylinder(W / 2 + 0.006, 0.012, 14, 0.0, base=(0, 0, 0), rot=(90, 0, 0))
    for v in door.verts:
        if v.co.z < 0:
            v.co.z = max(v.co.z, -0.0)
    door = S.merge(door, S.box(W + 0.012, 0.012, Hb, 0.003, 1, base=(0, 0, -Hb)))
    S.translate(door, (0, -L / 2 - 0.006, Hb))
    S.rotate(door, (lean[0] + 2, lean[1] - 2, 0))
    m.add(S.translate(door, tip + Vector((0, -0.05, 0.0))), 'Galvanised')
    hb = tip + Vector((0, -0.05 - L / 2 - 0.03, Hb + 0.02))
    m.add(S.box(0.04, 0.02, 0.02, 0.005, 1, loc=hb), 'Galvanised')
    # bills poking out of the door
    for k in range(2):
        env = S.box(0.16, 0.004, 0.1, 0.0, 0, loc=(0.0, 0.0, 0.0), rot=(70 + 8 * k, 0, 10 - 20 * k))
        m.add(S.translate(env, tip + Vector((0.01 * k, -0.05 - L / 2 - 0.03, Hb + 0.06 + 0.012 * k))), 'Envelope')
    num = S.text('13', 0.05, 0.003, loc=(0, 0, 0), rot=(90, 0, -90))
    m.add(S.translate(num, tip + Vector((-W / 2 - 0.003, -0.05, 0.08))), 'Paper')
    # red flag on the +X side, pivot at its pin; down = arm pointing to the back (+Y), up = +90deg about X
    pin = tip + Vector((W / 2 + 0.012, 0.08, 0.1))
    m.node('flag', origin=tuple(pin), extras={'part': 'flag', 'axis': 'x', 'upAngle': 1.5708})
    arm = S.box(0.01, 0.2, 0.025, 0.003, 1, loc=(pin.x, pin.y + 0.1, pin.z))
    plate = S.box(0.01, 0.07, 0.06, 0.004, 1, loc=(pin.x, pin.y + 0.17, pin.z + 0.035))
    m.add(S.merge(arm, plate), 'EnamelRed', 'flag')
    m.add(S.cylinder(0.012, 0.02, 8, 0.0, base=(pin.x - 0.01, pin.y, pin.z), rot=(0, 90, 0)), 'Galvanised')


@builder('kit_reanimation')
def kit_reanimation(m: Model, spec: Spec) -> None:
    j = m.rng
    W, D, H = 0.56, 0.46, 0.42
    # slatted crate
    m.add(S.box(W - 0.04, D - 0.04, H - 0.04, 0.006, 1, base=(0, 0, 0.02)), 'WoodDark')
    for z in (0.02, H - 0.1):
        for sy in (-1, 1):
            m.add(S.box(W, 0.025, 0.1, 0.008, 1, base=(0, sy * (D / 2 - 0.0125), z)), 'Pine')
        for sx in (-1, 1):
            m.add(S.box(0.025, D, 0.1, 0.008, 1, base=(sx * (W / 2 - 0.0125), 0, z)), 'Pine')
    m.add(S.box(W, D, 0.03, 0.008, 1, base=(0, 0, H - 0.02)), 'Pine')
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.add(S.box(0.05, 0.05, H, 0.008, 1, base=(sx * (W / 2 - 0.025), sy * (D / 2 - 0.025), 0)), 'Pine')
    # stencilled lightning bolt on the front
    bolt = [(-0.04, 0.12), (0.05, 0.12), (0.0, 0.03), (0.06, 0.03), (-0.05, -0.12), (-0.01, -0.01), (-0.07, -0.01)]
    m.add(S.prism(bolt, 0.006, 0.0, 0, plane='XZ', loc=(0.02, -D / 2 - 0.004, H * 0.5)), 'Magnet3')
    # tesla coil on top: base, wound column, toroid
    tz = H + 0.01
    m.add(S.cylinder(0.08, 0.03, 12, 0.006, base=(0.06, 0.03, tz)), 'Iron')
    m.add(S.cylinder(0.035, 0.18, 12, 0.004, base=(0.06, 0.03, tz + 0.03)), 'Copper')
    for k in range(6):
        m.add(S.torus(0.037, 0.003, 12, 3, loc=(0.06, 0.03, tz + 0.05 + k * 0.025)), 'Brass')
    m.add(S.torus(0.06, 0.025, 14, 6, loc=(0.06, 0.03, tz + 0.23)), 'Chrome')
    # crackling arcs (glow) between the toroid and the crate corners
    m.node('glow', origin=(0.06, 0.03, tz + 0.23), extras={'part': 'glow', 'flicker': 'crackle'}, transient=True)
    for k, end in enumerate(((0.25, -0.18, tz + 0.02), (-0.2, 0.15, tz + 0.05), (0.2, 0.2, tz + 0.3))):
        start = (0.06 + 0.07 * (1 if end[0] > 0.06 else -1), 0.03, tz + 0.24)
        pts = S.jagged(start, end, 5, 0.03, j.fork(f'arc{k}'), normal=(0, 0, 1))
        m.add(S.tube(pts, 0.005, 3), 'GlowTesla', 'glow')
    m.add(S.sphere(0.04, 8, 6, loc=(0.06, 0.03, tz + 0.255), scale=(1, 1, 0.5)), 'GlowTesla', 'glow')
    # jumper cables draped over the side
    for k, (mat, dy) in enumerate((('EnamelRed', -0.06), ('Black', 0.04))):
        cable = S.catmull([(-0.15, dy, tz + 0.01), (-0.26, dy + 0.02, tz + 0.03), (-0.31, dy, H - 0.1), (-0.32, dy - 0.02, 0.15),
                           (-0.45, dy - 0.1, 0.02)], 3)
        m.add(S.tube(cable, 0.009, 5), mat)
        m.add(S.box(0.06, 0.025, 0.03, 0.006, 1, loc=(-0.47, dy - 0.12, 0.02), rot=(0, 0, 30 + 20 * k)), 'Chrome')
        m.add(S.box(0.05, 0.03, 0.025, 0.006, 1, loc=(-0.14, dy, tz + 0.015)), 'Chrome')


@builder('crate_prosthetic')
def crate_prosthetic(m: Model, spec: Spec) -> None:
    j = m.rng
    W, D, H = 0.62, 0.5, 0.4
    m.add(S.box(W - 0.04, D - 0.04, 0.03, 0.006, 1, base=(0, 0, 0.0)), 'Pine')
    for k in range(3):
        z = 0.03 + k * 0.125
        for sy in (-1, 1):
            m.add(S.box(W, 0.022, 0.085, 0.006, 1, base=(0, sy * (D / 2 - 0.011), z), rot=(0, j.sym(1.5), 0)), 'Pine')
        for sx in (-1, 1):
            m.add(S.box(0.022, D, 0.085, 0.006, 1, base=(sx * (W / 2 - 0.011), 0, z)), 'Pine')
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.add(S.box(0.045, 0.045, H, 0.008, 1, base=(sx * (W / 2 - 0.02), sy * (D / 2 - 0.02), 0)), 'WoodLight')
    m.add(S.box(0.2, 0.006, 0.1, 0.002, 1, base=(0.12, -D / 2 - 0.004, 0.18), rot=(0, 3, 0)), 'Paper')
    m.add(S.text('FRAGILE', 0.028, 0.002, loc=(0.12, -D / 2 - 0.008, 0.23), rot=(90, 3, 0)), 'Blood')
    # straw stuffing
    for k in range(10):
        x, y = j.uniform(-0.25, 0.25), j.uniform(-0.2, 0.2)
        m.add(S.blob(0.07, 1, 0.4, 3, k, loc=(x, y, H - 0.03), scale=(1.3, 1.0, 0.45)), 'Straw')
    for k in range(10):
        x, y = j.uniform(-0.28, 0.28), j.uniform(-0.22, 0.22)
        a = j.uniform(0, math.tau)
        m.add(S.tube([(x, y, H), (x + math.cos(a) * 0.12, y + math.sin(a) * 0.12, H + j.uniform(0.0, 0.06))], 0.003, 3), 'Straw')
    # wooden arm: upper arm, ball elbow, forearm, mitten hand with a thumb
    p0, p1, p2 = Vector((-0.1, 0.0, H - 0.1)), Vector((-0.08, -0.05, H + 0.12)), Vector((0.02, -0.15, H + 0.22))
    m.add(S.tube([p0, p1], 0.032, 8), 'WoodLight')
    m.add(S.sphere(0.04, 8, 6, loc=p1), 'Brass')
    m.add(S.tube([p1, p2], 0.028, 8), 'WoodLight')
    hand = S.superellipsoid(0.05, 0.025, 0.06, 0.6, 0.6, 10, 6, loc=(0, 0, 0.05))
    S.rotate(hand, (40, 30, 20))
    m.add(S.translate(hand, p2), 'WoodLight')
    thumb = S.tube([p2 + Vector((0.03, -0.02, 0.03)), p2 + Vector((0.07, -0.03, 0.06))], 0.012, 6)
    m.add(thumb, 'WoodLight')
    # peg leg sticking out the other corner
    q0, q1 = Vector((0.12, 0.08, H - 0.15)), Vector((0.32, 0.12, H + 0.1))
    m.add(S.tube([q0, q1], 0.045, 10, radii=[0.05, 0.045]), 'WoodLight')
    m.add(S.tube([q1, q1 + (q1 - q0).normalized() * 0.12], 0.02, 8, radii=[0.03, 0.018]), 'WoodDark')
    m.add(S.torus(0.05, 0.008, 12, 3, loc=q0 + (q1 - q0) * 0.6, rot=(0, -60, 15)), 'Brass')


# ───────────────────────────── lighting ─────────────────────────────


def _lamp_skull_shade(s: float):
    """Big cartoon skull lampshade facing -Y: (shell, teeth, sockets+nose). ``s`` = cranium radius.
    The face is a flattened front block so sockets/nose sit ON the surface (readable from the elevated camera);
    sockets are separate geometry so they can burn hot (jack-o'-lantern) while the shell glows softly."""
    shell = [
        S.sphere(s, 16, 10, loc=(0, 0.06 * s, 0.16 * s), scale=(1.0, 1.0, 0.95)),                     # cranium
        S.superellipsoid(0.76 * s, 0.46 * s, 0.46 * s, 0.5, 0.5, 14, 6, loc=(0, -0.56 * s, -0.3 * s)),   # cheeks
        S.superellipsoid(0.5 * s, 0.4 * s, 0.2 * s, 0.6, 0.6, 12, 5, loc=(0, -0.56 * s, -0.84 * s)),    # jaw
    ]
    teeth = []
    for k in range(5):
        x = (-0.28 + 0.14 * k) * s
        teeth.append(S.box(0.12 * s, 0.08 * s, 0.17 * s, 0.025 * s, 1, loc=(x, -0.95 * s, -0.67 * s)))
    holes = []
    for sx in (-1, 1):
        holes.append(S.sphere(0.27 * s, 10, 6, loc=(sx * 0.37 * s, -0.99 * s, -0.08 * s), scale=(1.0, 0.32, 1.15),
                              rot=(0, sx * -14, 0)))
    nose = S.prism([(-0.12 * s, 0.0), (0.12 * s, 0.0), (0.0, -0.22 * s)], 0.07 * s, 0.0, 0, plane='XZ')
    holes.append(S.translate(nose, (0, -1.02 * s, -0.33 * s)))
    return S.merge(*shell), S.merge(*teeth), S.merge(*holes)


@builder('lamp_skull')
def lamp_skull(m: Model, spec: Spec) -> None:
    """Brass floor lamp with a big, slightly tilted skull lampshade. Lit: the shell glows softly and the eye sockets
    and nose burn bright (reads as a face at night); unlit: bone shell with dark sockets."""
    j = m.rng
    m.add(S.lathe([(0.0, 0.0), (0.19, 0.0), (0.2, 0.02), (0.17, 0.035), (0.09, 0.05), (0.05, 0.07), (0.03, 0.1),
                   (0.0, 0.1)], 18), 'Brass')
    m.add(S.torus(0.17, 0.012, 18, 4, loc=(0, 0, 0.03)), 'Bronze')
    stem = S.catmull([(0, 0, 0.09), (0.0, 0.004, 0.6), (0.01, 0.0, 1.0), (0.03, -0.02, 1.2)], 4)
    m.add(S.tube(stem, 0.021, 8), 'Brass')
    for z in (0.32, 0.72):
        m.add(S.lathe([(0.02, -0.025), (0.036, -0.008), (0.036, 0.008), (0.02, 0.025)], 10, base=(0.0, 0.002, z),
                      cap_bottom=False, cap_top=False), 'Bronze')
    # fitter cup holding the shade
    m.add(S.lathe([(0.025, 0.0), (0.05, 0.03), (0.055, 0.05), (0.0, 0.052)], 12, base=(0.03, -0.02, 1.19)), 'Brass')
    # pull chain with a tiny bone bead
    m.add(S.tube([(0.07, -0.05, 1.25), (0.075, -0.06, 1.12), (0.074, -0.06, 1.02)], 0.003, 3), 'Brass')
    m.add(S.bone(0.035, 0.005, 1.9, loc=(0.074, -0.06, 1.0), rot=(0, 90, 0), segs=6), 'Bone')
    # power cord snaking off the base
    m.add(S.tube(S.catmull([(0.12, 0.08, 0.02), (0.22, 0.2, 0.01), (0.34, 0.16, 0.008), (0.45, 0.3, 0.008)], 3),
                 0.006, 4), 'Black')
    # the skull shade (bulb): tilted for charm, facing the front (-Y)
    s_ = 0.17
    cx, cy, cz = 0.03, -0.03, 1.4
    shell, teeth, holes = _lamp_skull_shade(s_)
    tilt = (-14.0, 0.0, 0.0)     # face tipped up toward the viewer
    roll = (0.0, -10.0, 6.0)
    m.node('bulb', origin=(cx, cy, cz), extras={'part': 'bulb'})
    for bm_, mat in ((shell, 'SkullShell'), (teeth, 'SkullShell'), (holes, 'SkullEyes')):
        S.rotate(bm_, tilt)
        S.rotate(bm_, roll)
        m.add(S.translate(bm_, (cx, cy, cz)), mat, 'bulb')
    # a little crack on the cranium (static, dark line on the shell)
    crack = S.jagged((0.05, -0.1, 0.16), (0.12, -0.03, 0.08), 4, 0.012, j, normal=(0.3, -0.6, 0.7))
    m.add(S.tube([Vector(p) + Vector((cx, cy, cz)) for p in crack], 0.0035, 3), 'Charcoal')


@builder('candelabra_drippy')
def candelabra_drippy(m: Model, spec: Spec) -> None:
    j = m.rng
    # tripod feet + knotted stem
    for k in range(3):
        a = math.tau * k / 3 + 0.3
        foot = S.catmull([(0, 0, 0.12), (math.cos(a) * 0.12, math.sin(a) * 0.12, 0.05), (math.cos(a) * 0.2, math.sin(a) * 0.2, 0.012)], 3)
        m.add(S.tube(foot, 0.013, 6), 'Iron')
        m.add(S.sphere(0.02, 6, 4, loc=(math.cos(a) * 0.2, math.sin(a) * 0.2, 0.012), scale=(1, 1, 0.6)), 'Iron')
    m.add(S.cylinder(0.016, 0.95, 8, 0.0, base=(0, 0, 0.1)), 'Iron')
    for z in (0.3, 0.65):
        m.add(S.sphere(0.035, 8, 6, loc=(0, 0, z), scale=(1, 1, 0.8)), 'Iron')
    cups = [(0.0, 0.0, 1.12)]
    for k in range(4):
        a = math.tau * k / 4 + math.pi / 4
        r = 0.22
        tip = (math.cos(a) * r, math.sin(a) * r, 1.0 + 0.04 * (k % 2))
        arm = S.catmull([(0, 0, 0.92), (math.cos(a) * r * 0.5, math.sin(a) * r * 0.5, 0.86), (tip[0], tip[1], tip[2] - 0.08), tip], 3)
        m.add(S.tube(arm, 0.011, 6), 'Iron')
        m.add(S.tube(S.spiral(0.005, 0.03, 1.1, 8, center=(math.cos(a) * r * 0.55, math.sin(a) * r * 0.55, 0.84), plane='XY'),
                     0.005, 3), 'Iron')
        cups.append(tip)
    m.add(S.cylinder(0.016, 0.1, 8, 0.0, base=(0, 0, 1.02)), 'Iron')
    m.node('flame', origin=(0, 0, 1.2), extras={'part': 'flame'}, transient=True)
    for k, (x, y, z) in enumerate(cups):
        m.add(S.lathe([(0.0, 0.0), (0.045, 0.0), (0.05, 0.012), (0.025, 0.02), (0.022, 0.04), (0.0, 0.04)], 10, base=(x, y, z)), 'Iron')
        h = j.uniform(0.11, 0.2) if k else 0.2
        m.add(S.candle(h, 0.02, base=(x, y, z + 0.035), drips=2, seed=k), 'Wax')
        m.add(S.blob(0.035, 1, 0.3, 3, k, loc=(x, y, z + 0.04), scale=(1, 1, 0.3)), 'Wax')
        name = f'flame_{k}'
        m.node(name, parent='flame', origin=(x, y, z + 0.035 + h * 0.95), transient=True)
        m.add(S.flame(0.055, 0.014, base=(x, y, z + 0.035 + h * 0.95), lean=j.sym(0.01)), 'Flame', name)
    # wax puddle on the floor
    m.add(S.blob(0.08, 1, 0.3, 3, 9, loc=(0.06, -0.08, 0.0), scale=(1.4, 1.1, 0.06)), 'Wax')


@builder('sconce_candle')
def sconce_candle(m: Model, spec: Spec) -> None:
    """Wall item, chunky enough to read from the game camera: a tall gothic-arch back plate of tarnished bronze with
    a verdigris inset and a grinning skull boss, a fat scrolled arm reaching ~0.22 out to a wide drip pan, a
    stubby church candle with wax pooled and dribbling over the pan's lip, and a big teardrop flame (node
    "flame"). Back flat on the wall (y = 0), projecting to -Y (front); vertical centre ~1.7."""
    j = m.rng
    cz = 1.66
    # gothic arch plate (CCW in XZ): straight sides, pointed arch on top, little scalloped foot
    arch = []
    for k in range(7):
        t = k / 6
        a = math.radians(180 * t)
        arch.append((0.105 * math.cos(a) * (1 - 0.25 * math.sin(a)), 0.1 + 0.13 * math.sin(a) ** 0.8))
    plate_pts = [(0.105, -0.11), (0.105, 0.1)] + arch[1:-1] + [(-0.105, 0.1), (-0.105, -0.11), (-0.055, -0.17),
                                                               (0.0, -0.19), (0.055, -0.17)]
    plate = S.prism(plate_pts, 0.026, 0.008, 1, plane='XZ')
    m.add(S.translate(plate, (0, -0.013, cz)), 'Bronze')
    inset = [(x * 0.74, z * 0.8 + 0.012) for x, z in plate_pts]
    m.add(S.translate(S.prism(inset, 0.008, 0.003, 1, plane='XZ'), (0, -0.028, cz)), 'Verdigris')
    rim = [(x * 1.03, -0.03, z * 1.03 + cz) for x, z in plate_pts]
    m.add(S.tube(rim, 0.0065, 4, closed=True), 'Brass')
    sk, so = S.skull(0.036, loc=(0, -0.05, cz + 0.12), segs=8)
    m.add(sk, 'Bone')
    m.add(so, 'Black')
    # two rivets + a scrolled arm from the plate to the pan
    for sx in (-1, 1):
        m.add(S.sphere(0.009, 6, 4, loc=(sx * 0.07, -0.03, cz - 0.12)), 'Brass')
    root = (0, -0.03, cz - 0.04)
    arm = S.catmull([root, (0, -0.095, cz - 0.11), (0, -0.172, cz - 0.1), (0, -0.195, cz - 0.04)], 4)
    m.add(S.tube(arm, 0.017, 6), 'Bronze')
    # scroll bracket under the arm, in the arm's own (YZ) plane
    scroll = [Vector((0.0, p.x, p.z)) for p in S.spiral(0.006, 0.05, 1.3, 14, center=(-0.075, 0.0, cz - 0.15),
                                                       plane='XZ', a0=200.0)]
    m.add(S.tube(scroll, 0.0085, 5), 'Bronze')
    m.add(S.sphere(0.021, 8, 5, loc=root), 'Brass')
    pan_z = cz - 0.035
    px, py = 0.0, -0.195
    m.add(S.lathe([(0.0, -0.012), (0.03, -0.014), (0.085, 0.0), (0.098, 0.022), (0.086, 0.017), (0.0, 0.012)], 14,
                  base=(px, py, pan_z)), 'Bronze')
    m.add(S.blob(0.065, 1, 0.3, 3.0, 4, loc=(px + 0.008, py, pan_z + 0.016), scale=(1.12, 1.0, 0.24)), 'Wax')
    h, r = 0.15, 0.036
    m.add(S.candle(h, r, base=(px, py, pan_z + 0.014), drips=5, seed=5), 'Wax')
    # wax dribbles over the pan lip (stalactites hanging below the pan)
    for k, (a, L) in enumerate(((-0.4, 0.06), (0.9, 0.04), (2.4, 0.075))):
        x0, y0 = px + math.cos(a) * 0.094, py + math.sin(a) * 0.094
        m.add(S.tube([(x0, y0, pan_z + 0.02), (x0 * 1.0 + math.cos(a) * 0.006, y0 + math.sin(a) * 0.006, pan_z),
                      (x0 + math.cos(a) * 0.008, y0 + math.sin(a) * 0.008, pan_z - L)],
                     radii=[0.011, 0.009, 0.0], segs=5), 'Wax')
    fz = pan_z + 0.014 + h * 0.95
    m.node('flame', origin=(px, py, fz), extras={'part': 'flame'}, transient=True)
    m.add(S.flame(0.085, 0.024, base=(px, py, fz)), 'Flame', 'flame')
    m.add(S.flame(0.045, 0.012, base=(px, py, fz + 0.004)), 'FlameCore', 'flame')


@builder('lantern_post')
def lantern_post(m: Model, spec: Spec) -> None:
    j = m.rng
    m.add(S.box(0.3, 0.3, 0.12, 0.02, 2, base=(0, 0, 0)), 'Iron')
    m.add(S.taper_box(0.22, 0.22, 0.12, 0.12, 0.14, 0.015, 2, base=(0, 0, 0.12)), 'Iron')
    m.add(S.cylinder(0.035, 1.8, 10, 0.0, base=(0, 0, 0.25)), 'Iron')
    for z in (0.6, 1.4, 1.95):
        m.add(S.torus(0.045, 0.01, 10, 3, loc=(0, 0, z)), 'Iron')
    m.add(S.lathe([(0.04, 0.0), (0.1, 0.06), (0.12, 0.08), (0.0, 0.085)], 12, base=(0, 0, 2.0)), 'Iron')
    # caged lantern head: square glass box + bars + peaked roof + finial
    z0, z1 = 2.08, 2.36
    m.add(S.box(0.2, 0.2, z1 - z0, 0.004, 1, base=(0, 0, z0)), 'Glass')
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.add(S.box(0.022, 0.022, z1 - z0 + 0.02, 0.004, 1, base=(sx * 0.1, sy * 0.1, z0 - 0.01)), 'Iron')
    for k in (-1, 1):
        m.add(S.box(0.012, 0.21, 0.012, 0.0, 0, base=(k * 0.0, 0, z0 + 0.13), rot=(0, 0, 0)), 'Iron')
        m.add(S.box(0.21, 0.012, 0.012, 0.0, 0, base=(0, 0, z0 + 0.13)), 'Iron')
    roof = S.taper_box(0.28, 0.28, 0.02, 0.02, 0.12, 0.008, 1, base=(0, 0, z1))
    m.add(roof, 'Iron')
    m.add(S.sphere(0.025, 8, 6, loc=(0, 0, z1 + 0.135)), 'Iron')
    m.add(S.cone(0.012, 0.06, 6, base=(0, 0, z1 + 0.15)), 'Iron')
    # the light inside (bulb): a fat candle-bulb that glows when lit
    m.node('bulb', origin=(0, 0, z0 + 0.12), extras={'part': 'bulb', 'flicker': 'candle'})
    m.add(S.cylinder(0.035, 0.06, 10, 0.006, base=(0, 0, z0)), 'Iron')
    m.add(S.lathe([(0.0, 0.0), (0.045, 0.03), (0.05, 0.09), (0.03, 0.16), (0.0, 0.18)], 12, base=(0, 0, z0 + 0.04)),
          'Lantern', 'bulb')
    # a raven-repelling spike crown? no - a cobweb in the cage corner
    m.add(S.tube([(0.09, -0.09, z1 - 0.01), (0.03, -0.09, z1 - 0.05), (0.09, -0.09, z1 - 0.09)], 0.0015, 3), 'Cobweb')
