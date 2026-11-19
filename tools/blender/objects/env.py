"""Neighbourhood dressing (ENV_MODELS): crooked houses, street lamp, fence, trees, bush, hydrant, hearse, cart,
graveyard cluster. Front faces Blender -Y. House windows glow at night through a 'bulb' node."""
from __future__ import annotations

import math
from typing import List, Sequence, Tuple

import bmesh
from mathutils import Vector

from common import shapes as S
from common.catalog import Spec
from common.model import Model
from common.rng import Jitter

from .decor import branchy_tree, clamp_floor, crow, fit_height
from .parts import mold_blotch
from .registry import builder


def _shear(bm: bmesh.types.BMesh, kx: float, ky: float = 0.0, z0: float = 0.0) -> bmesh.types.BMesh:
    """Crooked lean: shift x (and y) proportionally to height above z0."""
    for v in bm.verts:
        dz = max(0.0, v.co.z - z0)
        v.co.x += kx * dz
        v.co.y += ky * dz
    return bm


def _gable_roof(m: Model, x0: float, x1: float, y0: float, y1: float, z_eave: float, z_ridge: float,
                over: float = 0.35, t: float = 0.18, ridge_axis: str = 'y', mat: str = 'Shingle') -> None:
    """Two sloped slabs meeting at a ridge + triangular gable walls (siding)."""
    if ridge_axis == 'y':
        half = (x1 - x0) / 2
        cx = (x0 + x1) / 2
        rise = z_ridge - z_eave
        slope = rise / half
        L = math.hypot(half + over, (half + over) * slope) + 0.12
        ang = math.degrees(math.atan(slope))
        for sx in (-1, 1):
            slab = S.box(L, (y1 - y0) + 2 * over, t, 0.03, 1, loc=(0, 0, 0))
            S.rotate(slab, (0, sx * ang, 0))
            ex, ez = cx + sx * (half + over), z_eave - over * slope
            mid = Vector(((ex + cx) / 2, (y0 + y1) / 2, (ez + z_ridge) / 2 + t / 2))
            m.add(S.translate(slab, mid), mat)
        for y, sgn in ((y0, -1), (y1, 1)):
            tri = S.prism([(x0, z_eave), (x1, z_eave), (cx, z_ridge - 0.05)], 0.12, 0.0, 0, plane='XZ')
            m.add(S.translate(tri, (0, y - sgn * 0.06, 0)), 'Siding' if mat == 'Shingle' else mat)
        m.add(S.cylinder(0.09, (y1 - y0) + 2 * over, 8, 0.0, base=(cx, y0 - over, z_ridge + t * 0.6), rot=(-90, 0, 0)), mat)
    else:
        half = (y1 - y0) / 2
        cy = (y0 + y1) / 2
        rise = z_ridge - z_eave
        slope = rise / half
        L = math.hypot(half + over, (half + over) * slope) + 0.12
        ang = math.degrees(math.atan(slope))
        for sy in (-1, 1):
            slab = S.box((x1 - x0) + 2 * over, L, t, 0.03, 1, loc=(0, 0, 0))
            S.rotate(slab, (-sy * ang, 0, 0))
            ey, ez = cy + sy * (half + over), z_eave - over * slope
            mid = Vector(((x0 + x1) / 2, (ey + cy) / 2, (ez + z_ridge) / 2 + t / 2))
            m.add(S.translate(slab, mid), mat)


def _window(m: Model, x: float, y_face: float, z: float, w: float = 0.9, h: float = 1.3, glow: bool = True,
            boarded: bool = False, frame: str = 'Trim', pointed: bool = False) -> None:
    """Window on a front (-Y) facade at y_face, bottom at z."""
    yf = y_face - 0.03
    m.add(S.box(w + 0.16, 0.08, 0.1, 0.02, 1, base=(x, yf - 0.02, z - 0.1)), frame)
    m.add(S.box(w + 0.1, 0.06, 0.08, 0.015, 1, base=(x, yf, z + h)), frame)
    for sx in (-1, 1):
        m.add(S.box(0.07, 0.06, h, 0.01, 1, base=(x + sx * (w / 2 + 0.035), yf, z)), frame)
    glass = S.box(w, 0.02, h, 0.0, 0, base=(x, yf + 0.01, z))
    if pointed:
        tri = S.prism([(-w / 2 - 0.05, 0.0), (w / 2 + 0.05, 0.0), (0.0, 0.45)], 0.06, 0.0, 0, plane='XZ')
        m.add(S.translate(tri, (x, yf, z + h + 0.06)), frame)
        gtri = S.prism([(-w / 2, 0.0), (w / 2, 0.0), (0.0, 0.36)], 0.02, 0.0, 0, plane='XZ')
        glass = S.merge(glass, S.translate(gtri, (x, yf + 0.01, z + h)))
    if glow and not boarded:
        m.add(glass, 'WindowGlass', 'bulb')
    else:
        m.add(glass, 'WindowDark')
    m.add(S.box(0.04, 0.03, h, 0.0, 0, base=(x, yf - 0.012, z)), frame)
    m.add(S.box(w, 0.03, 0.04, 0.0, 0, base=(x, yf - 0.012, z + h / 2)), frame)
    if boarded:
        j = Jitter(f'board{x}{z}')
        for k in range(3):
            m.add(S.box(w + 0.3, 0.04, 0.16, 0.01, 1, loc=(x, yf - 0.05, z + 0.25 + k * 0.38), rot=(0, j.sym(14), 0)), 'Planks')


def _door(m: Model, x: float, y_face: float, z: float, w: float = 1.0, h: float = 2.2) -> None:
    yf = y_face - 0.03
    m.add(S.box(w + 0.2, 0.08, h + 0.1, 0.02, 1, base=(x, yf, z)), 'Trim')
    m.add(S.box(w, 0.1, h, 0.02, 1, base=(x, yf - 0.02, z)), 'WoodEbony')
    m.add(S.sphere(0.05, 8, 6, loc=(x + w * 0.35, yf - 0.09, z + h * 0.48)), 'Brass')
    m.add(S.box(w * 0.5, 0.02, 0.25, 0.005, 1, base=(x, yf - 0.075, z + h * 0.68)), 'WindowGlass', 'bulb')


def _steps(m: Model, x: float, y: float, w: float, n: int, rise: float = 0.17, run: float = 0.3, mat: str = 'StoneLight'):
    for k in range(n):
        m.add(S.box(w, run * (n - k), rise, 0.02, 1, base=(x, y - run * (n - k) / 2, k * rise)), mat)


@builder('env_house_a')
def env_house_a(m: Model, spec: Spec) -> None:
    j = m.rng
    m.node('bulb', origin=(0, -3.0, 2.5), extras={'part': 'bulb', 'flicker': 'window'}, transient=True)
    lean = 0.025
    m.add(S.box(7.0, 6.2, 0.6, 0.04, 1, base=(0, 0.6, 0)), 'StoneLight')
    body = S.box(6.6, 5.8, 4.4, 0.05, 1, base=(0, 0.6, 0.6))
    m.add(_shear(body, lean, 0.0, 0.6), 'Siding')
    for k in range(10):
        z = 0.9 + k * 0.42
        m.add(S.box(6.62, 0.02, 0.025, 0.0, 0, base=(lean * (z - 0.6), -2.31, z)), 'Trim')
    for sx in (-1, 1):
        m.add(_shear(S.box(0.16, 0.16, 4.4, 0.02, 1, base=(sx * 3.3, -2.3, 0.6)), lean, 0.0, 0.6), 'Trim')
    m.add(_shear(S.box(6.9, 6.1, 0.2, 0.03, 1, base=(0, 0.6, 2.75)), lean, 0.0, 0.6), 'Trim')
    _gable_roof(m, -3.3 + lean * 4.4, 3.3 + lean * 4.4, -2.3, 3.5, 5.0, 7.0, 0.4, 0.2, 'y')
    # chimney (crooked) + round attic window
    ch = S.box(0.7, 0.7, 2.2, 0.03, 1, base=(0, 0, 0))
    S.rotate(ch, (0, 4, 0))
    m.add(S.translate(ch, (2.0, 1.8, 5.2)), 'Brick')
    m.add(S.box(0.85, 0.85, 0.15, 0.02, 1, base=(2.05, 1.8, 7.35)), 'Brick')
    m.add(S.torus(0.38, 0.06, 16, 4, loc=(lean * 5.5, -2.42, 5.85), rot=(90, 0, 0)), 'Trim')
    m.add(S.cylinder(0.34, 0.03, 16, 0.0, base=(lean * 5.5, -2.38, 5.85), rot=(90, 0, 0)), 'WindowGlass', 'bulb')
    # windows: ground floor flanking the door, upper floor (one boarded up)
    yface = -2.3
    for x in (-2.2, 2.2):
        _window(m, x + lean * 0.8, yface, 1.3, 0.95, 1.4, glow=(x < 0))
    for k, x in enumerate((-2.2, 0.0, 2.2)):
        _window(m, x + lean * 3.6, yface, 3.3, 0.9, 1.3, glow=(k != 1), boarded=(k == 2))
    _door(m, 0.0 + lean * 0.2, yface, 0.6, 1.0, 2.2)
    # porch with turned posts, sagging roof and steps
    m.add(S.box(5.2, 1.6, 0.12, 0.02, 1, base=(0, -3.1, 0.48)), 'Planks')
    for x in (-2.5, -0.9, 0.9, 2.5):
        post = S.lathe([(0.09, 0), (0.07, 0.15), (0.06, 1.0), (0.08, 1.4), (0.06, 1.8), (0.08, 2.3)], 8, base=(x, -3.8, 0.6))
        m.add(post, 'Trim')
    proof = S.box(5.6, 1.9, 0.14, 0.02, 1, base=(0, -3.1, 2.9))
    for v in proof.verts:
        v.co.z -= 0.12 * (1 - (v.co.x / 2.8) ** 2) * (1 if v.co.y < -3.2 else 0.4)
    S.rotate(proof, (8, 0, 0), pivot=(0, -2.2, 3.0))
    m.add(proof, 'Shingle')
    for k in range(9):
        x = -2.4 + k * 0.6
        if abs(x) < 0.7:
            continue
        m.add(S.box(0.04, 0.04, 0.6, 0.0, 0, base=(x, -3.85, 0.6), rot=(0, j.sym(4), 0)), 'Trim')
    m.add(S.box(5.0, 0.06, 0.06, 0.0, 0, base=(0, -3.85, 1.2)), 'Trim')
    _steps(m, 0.0, -3.9, 1.4, 3)
    # weeds at the foundation
    for k in range(6):
        m.add(S.grass_tuft(0.2, 0.35, 5, base=(j.uniform(-3.4, 3.4), -2.5, 0.0), seed=k), 'GrassDry')


@builder('env_house_b')
def env_house_b(m: Model, spec: Spec) -> None:
    j = m.rng
    m.node('bulb', origin=(0, -2.5, 1.5), extras={'part': 'bulb', 'flicker': 'window'}, transient=True)
    m.add(S.box(8.4, 5.6, 0.45, 0.04, 1, base=(0, 0.7, 0)), 'StoneLight')
    m.add(S.box(8.0, 5.2, 2.7, 0.05, 1, base=(0, 0.7, 0.45)), 'SidingB')
    for k in range(7):
        z = 0.7 + k * 0.36
        m.add(S.box(8.02, 0.02, 0.025, 0.0, 0, base=(0, -1.91, z)), 'Trim')
    # hip roof (frustum) with a sag in the ridge
    roof = S.taper_box(8.8, 6.0, 3.6, 0.8, 1.7, 0.04, 1, base=(0, 0.7, 3.15))
    for v in roof.verts:
        if v.co.z > 4.5:
            v.co.z -= 0.18 * (1 - (v.co.x / 1.8) ** 2) if abs(v.co.x) < 1.8 else 0
    m.add(roof, 'Shingle')
    m.add(S.box(0.6, 0.6, 1.3, 0.03, 1, base=(-2.4, 1.6, 3.9)), 'Brick')
    yface = -1.9
    for x in (-2.8, -1.4, 1.6, 2.9):
        _window(m, x, yface, 1.15, 0.9, 1.2, glow=(x in (-2.8, 1.6)))
    _door(m, 0.1, yface, 0.45, 1.0, 2.1)
    # sagging full-width porch: deck, leaning posts, droopy roof, overgrown hedge in front
    m.add(S.box(8.2, 1.6, 0.12, 0.02, 1, base=(0, -2.7, 0.33)), 'Planks')
    for k, x in enumerate((-3.9, -1.3, 1.3, 3.9)):
        post = S.box(0.14, 0.14, 2.35, 0.02, 1, base=(0, 0, 0))
        S.rotate(post, (j.sym(4), 6 if k == 2 else j.sym(2), 0))
        m.add(S.translate(post, (x, -3.35, 0.45)), 'Trim')
    proof = S.box(8.6, 1.9, 0.12, 0.02, 1, base=(0, -2.75, 2.78))
    for v in proof.verts:
        v.co.z -= 0.28 * (1 - (v.co.x / 4.3) ** 2) * (0.3 + 0.7 * max(0.0, min(1.0, (-v.co.y - 1.9) / 1.9)))
    S.rotate(proof, (7, 0, 0), pivot=(0, -1.9, 2.9))
    m.add(proof, 'Shingle')
    _steps(m, 0.1, -3.5, 1.3, 2)
    for k in range(9):
        x = -4.0 + k * 1.0
        if abs(x - 0.1) < 0.8:
            continue
        r = j.uniform(0.45, 0.65)
        m.add(S.blob(r, 1, 0.3, 2.0, k, loc=(x, -3.75, r * 0.7), scale=(1.2, 0.9, 1.0), flat_bottom=-0.6), 'Hedge')
    m.add(S.grass_tuft(0.3, 0.5, 6, base=(3.5, -2.0, 0.45), seed=4), 'GrassDry')


@builder('env_house_c')
def env_house_c(m: Model, spec: Spec) -> None:
    j = m.rng
    m.node('bulb', origin=(0, -3.0, 4.0), extras={'part': 'bulb', 'flicker': 'window'}, transient=True)
    lean = -0.02
    m.add(S.box(5.2, 7.2, 0.5, 0.04, 1, base=(-0.3, 0.4, 0)), 'StoneLight')
    body = S.box(4.8, 6.8, 7.0, 0.05, 1, base=(-0.3, 0.4, 0.5))
    m.add(_shear(body, lean, 0.0, 0.5), 'SidingC')
    for z in (2.8, 5.1):
        m.add(_shear(S.box(5.0, 7.0, 0.18, 0.03, 1, base=(-0.3, 0.4, z)), lean, 0.0, 0.5), 'Trim')
    _gable_roof(m, -2.7 + lean * 7, 2.1 + lean * 7, -3.0, 3.8, 7.5, 10.2, 0.35, 0.2, 'y')
    # tower with a conical roof + weather vane (a crow on an arrow)
    tx, ty = 2.25, -2.4
    m.add(S.cylinder(1.05, 8.2, 16, 0.04, base=(tx, ty, 0.0)), 'SidingC')
    for z in (2.8, 5.1, 7.8):
        m.add(S.cylinder(1.12, 0.2, 16, 0.03, base=(tx, ty, z)), 'Trim')
    m.add(S.cone(1.3, 2.8, 16, base=(tx, ty, 8.2)), 'Shingle')
    m.add(S.cylinder(0.03, 0.8, 6, 0.0, base=(tx, ty, 10.9)), 'Iron')
    arrow = S.prism([(-0.4, -0.03), (0.3, -0.03), (0.3, -0.09), (0.45, 0.0), (0.3, 0.09), (0.3, 0.03), (-0.4, 0.03)], 0.03,
                    0.0, 0, plane='XY')
    m.add(S.translate(S.rotate(arrow, (0, 0, 30)), (tx, ty, 11.5)), 'Iron')
    crow(m, Vector((tx, ty, 11.55)), 210, 2.2, 'Crow')
    for k in range(3):
        a = math.radians(-60 - 30 * k)
        x, y = tx + math.cos(a) * 1.04, ty + math.sin(a) * 1.04
        for z in (1.2, 3.4, 5.8):
            win = S.box(0.45, 0.06, 1.0, 0.0, 0, base=(0, 0, 0))
            S.rotate(win, (0, 0, math.degrees(a) + 90))
            m.add(S.translate(win, (x, y, z)), 'WindowGlass' if (k + int(z)) % 2 == 0 else 'WindowDark',
                  'bulb' if (k + int(z)) % 2 == 0 else None)
    yface = -3.0
    for x, z, g in ((-1.8, 1.2, True), (-0.4, 1.2, False), (-1.8, 3.4, False), (-0.4, 3.4, True), (-1.8, 5.7, True),
                    (-0.4, 5.7, False)):
        _window(m, x + lean * (z + 0.5), yface, z, 0.75, 1.45, glow=g, pointed=True)
    _door(m, 0.75, yface, 0.5, 0.9, 2.1)
    _steps(m, 0.75, -3.0, 1.2, 3)
    # gothic finials on the gable
    m.add(S.cone(0.12, 0.8, 8, base=(-0.3 + lean * 9.7, -3.1, 10.0)), 'Iron')
    m.add(mold_blotch(-2.2, -3.04, 0.6, 0.5, (0, -1, 0), seed=3), 'Moss')


@builder('env_streetlamp')
def env_streetlamp(m: Model, spec: Spec) -> None:
    j = m.rng
    m.add(S.lathe([(0.2, 0.0), (0.2, 0.1), (0.14, 0.2), (0.09, 0.45), (0.07, 0.5)], 12), 'Iron')
    pole = S.catmull([(0, 0, 0.45), (0.0, 0.0, 2.5), (0.03, 0.0, 3.6), (0.3, 0.0, 4.0), (0.62, 0.0, 3.85), (0.68, 0.0, 3.6)], 4)
    m.add(S.tube(pole, radii=[0.07 - 0.04 * i / (len(pole) - 1) for i in range(len(pole))], segs=8), 'Iron')
    m.add(S.tube(S.spiral(0.02, 0.18, 1.2, 10, center=(0.18, 0.0, 3.45), plane='XZ'), 0.018, 4), 'Iron')
    m.add(S.torus(0.08, 0.02, 10, 4, loc=(0.0, 0.0, 1.0)), 'Iron')
    hz = 3.55
    m.add(S.lathe([(0.03, 0.0), (0.22, -0.12), (0.24, -0.16), (0.0, -0.18)], 12, base=(0.68, 0.0, hz)), 'Iron')
    m.add(S.cylinder(0.16, 0.36, 8, 0.0, r_top=0.2, base=(0.68, 0.0, hz - 0.54)), 'Glass')
    m.add(S.lathe([(0.0, 0.0), (0.16, 0.0), (0.12, 0.04), (0.0, 0.06)], 10, base=(0.68, 0.0, hz - 0.58)), 'Iron')
    m.node('bulb', origin=(0.68, 0.0, hz - 0.35), extras={'part': 'bulb', 'flicker': 'candle'})
    m.add(S.sphere(0.11, 10, 6, loc=(0.68, 0.0, hz - 0.33), scale=(1, 1, 1.3)), 'Lantern', 'bulb')


@builder('env_fence')
def env_fence(m: Model, spec: Spec) -> None:
    """One 1 m section along +X from x=0 (post at the segment start, so sections tile)."""
    j = m.rng
    H = 1.1
    m.add(S.box(0.07, 0.07, H, 0.01, 1, base=(0.0, 0.0, 0.0), rot=(j.sym(2), j.sym(2), 0)), 'Iron')
    m.add(S.sphere(0.05, 8, 6, loc=(0.0, 0.0, H + 0.03)), 'Iron')
    m.add(S.cone(0.025, 0.08, 6, base=(0.0, 0.0, H + 0.06)), 'Iron')
    for z, tilt in ((0.14, j.sym(1)), (0.92, j.sym(1.5))):
        m.add(S.box(1.0, 0.03, 0.03, 0.006, 1, base=(0.5, 0.0, z), rot=(0, tilt, 0)), 'Iron')
    for k in range(7):
        x = 0.125 + k * 0.125
        lean = j.sym(3.5) if k != 4 else 9.0
        top = H - 0.05 + j.sym(0.03)
        bar = S.cylinder(0.011, top - 0.02, 6, 0.0, base=(0, 0, 0.0))
        tip = S.cone(0.03, 0.09, 6, base=(0, 0, top - 0.02))
        S.translate(tip, (0, 0, 0))
        b = S.merge(bar, tip)
        S.rotate(b, (j.sym(2), lean, 0))
        m.add(S.translate(b, (x, 0.0, 0.0)), 'Iron')
    m.add(S.tube(S.spiral(0.01, 0.06, 1.1, 10, center=(0.31, 0.0, 0.53), plane='XZ'), 0.008, 3), 'Iron')
    m.add(S.tube(S.spiral(0.01, 0.06, 1.1, 10, center=(0.69, 0.0, 0.53), plane='XZ', a0=180), 0.008, 3), 'Iron')


@builder('env_tree_a')
def env_tree_a(m: Model, spec: Spec) -> None:
    j = m.rng
    tips = branchy_tree(m, j.fork('t'), 6.0, 0.44, 1.15, 'Bark', levels=4, splits=(3, 3, 2, 2), root_r=0.95,
                        twist=0.3, taper=0.38, twigs=3, burls=4)
    k = fit_height(m, 6.0)
    clamp_floor(m)
    tips = [(p * k, d) for p, d in tips]
    for idx in (2, 9):
        if idx < len(tips):
            p, d = tips[idx]
            crow(m, p - d * 0.35, math.degrees(math.atan2(d.y, d.x)) + 180, 1.5)
    m.add(S.sphere(0.12, 8, 6, loc=(0.05, -0.33, 1.4), scale=(0.8, 0.4, 1.3)), 'Black')


@builder('env_tree_b')
def env_tree_b(m: Model, spec: Spec) -> None:
    """Spooky cypress: crooked bare trunk at the foot, then seven drooping, jagged-edged foliage tiers (two greens for
    value variation) narrowing upward to a tip that curls over like a witch's hat. Leans a little."""
    j = m.rng
    trunk = S.catmull([(0, 0, 0), (0.04, 0.02, 0.5), (-0.02, 0.05, 1.0), (0.05, 0.02, 1.6)], 3)
    m.add(S.tube(trunk, radii=[0.2, 0.18, 0.16, 0.15, 0.14, 0.13, 0.12, 0.11, 0.1, 0.1], segs=8), 'Bark')
    for k in range(4):
        a = math.tau * k / 4 + 0.4
        m.add(S.tube([(0, 0, 0.3), (math.cos(a) * 0.2, math.sin(a) * 0.2, 0.08), (math.cos(a) * 0.38, math.sin(a) * 0.38, 0.0)],
                     radii=[0.12, 0.08, 0.0], segs=5), 'Bark')
    segs = 16
    tiers = 7
    for t in range(tiers):
        f = t / (tiers - 1)
        z0 = 0.9 + f * 3.2
        r = 1.05 * (1 - f) ** 0.85 + 0.22
        hgt = 0.95 - 0.35 * f
        lean = Vector((0.06 * f * f * 4, 0.02 * f, 0))
        jt = j.fork(f'tier{t}')
        top = [(lean.x, lean.y, z0 + hgt)]
        mid = []
        edge = []
        under = []
        for k in range(segs):
            a = math.tau * k / segs + jt.sym(0.08)
            ca, sa = math.cos(a), math.sin(a)
            jag = 1.0 + (0.16 if k % 2 == 0 else -0.06) + jt.sym(0.07)
            rr = r * jag
            mid.append((lean.x + ca * r * 0.55, lean.y + sa * r * 0.55, z0 + hgt * 0.55))
            droop = 0.12 * (1.0 if k % 2 == 0 else 0.4) + jt.sym(0.04)
            edge.append((lean.x + ca * rr, lean.y + sa * rr, z0 - droop))
            under.append((lean.x + ca * r * 0.3, lean.y + sa * r * 0.3, z0 + 0.12))
        tier = S.loft([top, mid, edge, under], cap_bottom=True, cap_top=False)
        m.add(tier, 'Cypress' if t % 2 == 0 else 'CypressLight')
    # curled tip
    tip = S.catmull([(0.22, 0.06, 4.6), (0.26, 0.06, 4.85), (0.4, 0.05, 5.0), (0.52, 0.04, 4.92)], 3)
    m.add(S.tube(tip, radii=[0.16, 0.13, 0.1, 0.08, 0.06, 0.045, 0.03, 0.015, 0.0, 0.0], segs=6), 'Cypress')
    clamp_floor(m)


@builder('env_bush')
def env_bush(m: Model, spec: Spec) -> None:
    """Overgrown thorny bush: lumpy two-tone foliage clumps, bramble arcs with thorns poking out, dark berries — and a
    skeletal hand waving from the middle (it has been there a while)."""
    j = m.rng
    # organic: puffy smooth-shaded foliage (the lumpy blobs read as faceted rocks with a 42-degree auto-smooth)
    m.nodes[m.body].smooth_angle = 180.0
    clumps = [((0.0, 0.02), 0.44, 0.4, 'Hedge'), ((0.28, 0.14), 0.31, 0.3, 'Hedge'), ((-0.27, 0.12), 0.33, 0.3, 'Hedge'),
              ((0.14, -0.25), 0.3, 0.27, 'HedgeLight'), ((-0.14, -0.22), 0.29, 0.26, 'Hedge'),
              ((0.3, -0.08), 0.24, 0.42, 'HedgeLight'), ((-0.3, -0.05), 0.25, 0.46, 'HedgeLight'),
              ((0.04, 0.06), 0.33, 0.7, 'HedgeLight'), ((-0.08, -0.08), 0.24, 0.86, 'HedgeLight')]
    for k, ((x, y), r, z, mat) in enumerate(clumps):
        z = z * 0.78
        fb = max(-0.95, -z / (r * 0.85))     # flat bottom exactly on the ground
        m.add(S.blob(r, 2, 0.22, 2.4, k, loc=(x, y, z), scale=(1.1, 1.0, 0.88), flat_bottom=fb), mat)
    jb = j.fork('brambles')
    for k in range(6):
        a = math.tau * k / 6 + jb.sym(0.3)
        z = jb.uniform(0.4, 0.7)
        p0 = Vector((math.cos(a) * 0.25, math.sin(a) * 0.25, z))
        p1 = p0 + Vector((math.cos(a) * 0.16, math.sin(a) * 0.16, jb.uniform(0.1, 0.18)))
        p2 = p1 + Vector((math.cos(a + 0.5) * 0.13, math.sin(a + 0.5) * 0.13, -jb.uniform(0.12, 0.2)))
        arc = S.catmull([p0, p1, p2], 3)
        m.add(S.tube(arc, radii=[0.016, 0.014, 0.012, 0.01, 0.008, 0.006, 0.0], segs=4), 'Thorn')
        for q in (2, 4):
            if q < len(arc):
                d = (arc[q] - arc[q - 1]).normalized()
                up = Vector((0, 0, 1))
                side = d.cross(up).normalized()
                m.add(S.cone(0.008, 0.035, 4, base=arc[q], rot=(math.degrees(side.x) * 0.0 + 60 * (1 if q % 4 else -1), 0,
                                                                     math.degrees(a))), 'Thorn')
    for k in range(10):
        a = jb.uniform(0, math.tau)
        rr = jb.uniform(0.3, 0.42)
        z = jb.uniform(0.3, 0.8)
        for q in range(3):
            m.add(S.sphere(0.022, 6, 4, loc=(math.cos(a) * rr + 0.02 * q, math.sin(a) * rr, z - 0.018 * q)), 'Berry')
    # the hand: forearm bones out of the top, fingers spread in a little wave
    wrist = Vector((0.12, -0.12, 0.98))
    m.add(S.tube([Vector((0.06, -0.06, 0.72)), wrist], 0.018, 6), 'Bone')
    m.add(S.sphere(0.035, 8, 6, loc=wrist + Vector((0.0, 0.0, 0.03)), scale=(1.0, 0.6, 0.9), rot=(0, 15, 0)), 'Bone')
    for f in range(5):
        a = math.radians(-50 + 25 * f)
        base = wrist + Vector((0.035 * math.sin(a), 0.0, 0.05))
        tipp = base + Vector((0.06 * math.sin(a), -0.01, 0.06 * math.cos(a) + 0.01))
        m.add(S.tube([base, (base + tipp) / 2 + Vector((0.0, -0.008, 0.0)), tipp], radii=[0.009, 0.008, 0.006], segs=4),
              'Bone')


@builder('env_hydrant')
def env_hydrant(m: Model, spec: Spec) -> None:
    j = m.rng
    m.add(S.cylinder(0.16, 0.06, 12, 0.01, base=(0, 0, 0)), 'Rust')
    for k in range(6):
        a = math.tau * k / 6
        m.add(S.cylinder(0.018, 0.03, 6, 0.0, base=(math.cos(a) * 0.13, math.sin(a) * 0.13, 0.05)), 'Iron')
    m.add(S.lathe([(0.12, 0.06), (0.11, 0.1), (0.1, 0.5), (0.115, 0.52), (0.115, 0.56), (0.1, 0.58)], 14), 'EnamelRed')
    m.add(S.lathe([(0.12, 0.0), (0.1, 0.06), (0.06, 0.13), (0.0, 0.15)], 14, base=(0, 0, 0.58)), 'EnamelRed')
    m.add(S.cylinder(0.035, 0.06, 5, 0.0, base=(0, 0, 0.72)), 'Iron')
    for sx in (-1, 1):
        m.add(S.cylinder(0.045, 0.08, 10, 0.006, base=(sx * 0.09, 0, 0.4), rot=(0, sx * 90, 0)), 'EnamelRed')
        m.add(S.cylinder(0.05, 0.03, 6, 0.004, base=(sx * 0.17, 0, 0.4), rot=(0, sx * 90, 0)), 'Iron')
    m.add(S.cylinder(0.06, 0.1, 10, 0.008, base=(0, -0.09, 0.32), rot=(90, 0, 0)), 'EnamelRed')
    m.add(S.cylinder(0.066, 0.035, 6, 0.004, base=(0, -0.19, 0.32), rot=(90, 0, 0)), 'Iron')
    chain = [(0.17, 0.0, 0.36), (0.14, -0.08, 0.26), (0.07, -0.18, 0.28)]
    m.add(S.tube(chain, 0.008, 4), 'Iron')
    for k, (z, n_) in enumerate(((0.2, (0, -1, 0)), (0.45, (0.7, -0.7, 0)), (0.62, (0, 0, 1)))):
        m.add(mold_blotch(0.0 if k != 1 else 0.07, -0.1 if k != 1 else -0.07, z, 0.06, n_, seed=k, flat=0.15), 'Rust')
    m.add(S.blob(0.2, 1, 0.3, 3, 3, loc=(0.0, 0.0, 0.0), scale=(1.4, 1.2, 0.12), flat_bottom=0.0), 'GrassDry')


def _curtain(x0: float, x1: float, y: float, z0: float, z1: float, folds: int = 5):
    """Gathered curtain panel in the XZ plane at depth y: vertical sinusoidal folds, tied in at the waist."""
    bm = S.grid(x1 - x0, z1 - z0, folds * 4, 3)
    S.rotate(bm, (90, 0, 0))
    for v in bm.verts:
        u = (v.co.x + (x1 - x0) / 2) / (x1 - x0)
        t = (v.co.z + (z1 - z0) / 2) / (z1 - z0)
        waist = 1.0 - 0.25 * math.exp(-((t - 0.45) / 0.18) ** 2)
        v.co.x *= waist
        v.co.y += 0.018 * math.sin(u * folds * math.tau)
    return S.translate(bm, ((x0 + x1) / 2, y, (z0 + z1) / 2))


@builder('env_hearse')
def env_hearse(m: Model, spec: Spec) -> None:
    """Carpool hearse (~5 m along X, front at +X): plum-black clear-coat body, long glass-house cabin with purple
    curtains gathered in the rear windows, chrome beltline, landau bars and grille, whitewall tyres, a wreath on
    the grille and a cheerful skeleton chauffeur. Head/tail lights in 'bulb' (glow at night)."""
    j = m.rng
    L, W = 5.0, 1.86
    m.node('bulb', origin=(2.4, 0, 0.75), extras={'part': 'bulb'}, transient=True)
    # chassis + body + hood
    m.add(S.box(L - 0.2, W, 0.6, 0.14, 2, base=(0, 0, 0.32)), 'HearsePaint')
    m.add(S.box(1.4, W - 0.06, 0.18, 0.1, 2, base=(1.75, 0, 0.92)), 'HearsePaint')
    cab = S.superlathe([(0.0, 0.0), (1.0, 0.0), (1.0, 0.55), (0.93, 0.7), (0.0, 0.72)], 1.75, W / 2 - 0.06, 6.0, 20,
                       base=(-0.65, 0, 0.92))
    m.add(cab, 'HearsePaint')
    ws = S.box(0.06, W - 0.3, 0.55, 0.02, 1, base=(0, 0, 0))
    S.rotate(ws, (0, -30, 0))
    m.add(S.translate(ws, (1.12, 0, 0.97)), 'WindowDark')
    for sy in (-1, 1):
        y = sy * (W / 2 - 0.04)
        for (x0, x1) in ((0.45, 1.0), (-1.0, 0.3), (-2.3, -1.15)):
            m.add(S.box(x1 - x0, 0.04, 0.42, 0.01, 1, base=((x0 + x1) / 2, y, 1.04)), 'WindowDark')
            m.add(S.tube([(x0 - 0.02, y + sy * 0.025, 1.03), (x1 + 0.02, y + sy * 0.025, 1.03), (x1 + 0.02, y + sy * 0.025, 1.47),
                          (x0 - 0.02, y + sy * 0.025, 1.47)], 0.012, 4, closed=True), 'Chrome')
        # gathered purple curtains filling the rear windows
        for (x0, x1) in ((-1.0, 0.3), (-2.3, -1.15)):
            m.add(_curtain(x0 + 0.03, (x0 + x1) / 2 - 0.02, y + sy * 0.035, 1.06, 1.44, 4), 'HearseCurtain')
            m.add(_curtain((x0 + x1) / 2 + 0.02, x1 - 0.03, y + sy * 0.035, 1.06, 1.44, 4), 'HearseCurtain')
        # chrome landau bar on the rear quarter + beltline + rocker strip
        bar = S.catmull([(-2.3, y + sy * 0.04, 1.16), (-2.05, y + sy * 0.045, 1.42), (-1.75, y + sy * 0.045, 1.3),
                         (-1.45, y + sy * 0.04, 1.44)], 3)
        m.add(S.tube(bar, 0.024, 5), 'Chrome')
        m.add(S.box(L - 0.4, 0.02, 0.045, 0.006, 1, base=(0, y + sy * 0.04, 0.88)), 'Chrome')
        m.add(S.box(L - 0.9, 0.02, 0.05, 0.006, 1, base=(0, y + sy * 0.04, 0.38)), 'Chrome')
    # wheels: whitewall tyres + chrome hubs + fender skirts
    for x in (-1.6, 1.55):
        for sy in (-1, 1):
            tire = S.cylinder(0.36, 0.24, 16, 0.06, base=(0, 0, 0), rot=(90, 0, 0))
            m.add(S.translate(tire, (x, sy * (W / 2 - 0.12) + sy * 0.12, 0.36)), 'Tire')
            ww = S.torus(0.25, 0.04, 16, 4, rot=(90, 0, 0))
            m.add(S.translate(ww, (x, sy * (W / 2 + 0.01), 0.36)), 'Whitewall')
            hub = S.cylinder(0.17, 0.03, 12, 0.01, base=(0, 0, 0), rot=(90, 0, 0))
            m.add(S.translate(hub, (x, sy * (W / 2 + 0.02), 0.36)), 'Chrome')
            m.add(S.box(0.9, 0.3, 0.1, 0.04, 1, base=(x, sy * (W / 2 - 0.1), 0.74)), 'HearsePaint')
    # bumpers, grille, lights (bulb), wreath on the grille
    for x in (L / 2 - 0.08, -L / 2 + 0.08):
        m.add(S.box(0.16, W + 0.06, 0.13, 0.05, 2, base=(x, 0, 0.34)), 'Chrome')
    m.add(S.box(0.06, 1.0, 0.34, 0.02, 1, base=(L / 2 - 0.1, 0, 0.52)), 'Chrome')
    for k in range(6):
        m.add(S.box(0.07, 0.95, 0.018, 0.0, 0, base=(L / 2 - 0.095, 0, 0.56 + k * 0.045)), 'Black')
    for sy in (-1, 1):
        m.add(S.sphere(0.1, 10, 6, loc=(L / 2 - 0.1, sy * 0.68, 0.72), scale=(0.5, 1, 1)), 'Lantern', 'bulb')
        m.add(S.box(0.04, 0.16, 0.2, 0.01, 1, base=(-L / 2 + 0.1, sy * 0.72, 0.6)), 'TailLight', 'bulb')
    m.add(S.torus(0.22, 0.06, 14, 5, loc=(L / 2 - 0.02, 0, 0.72), rot=(0, 90, 0)), 'Hedge')
    for k in range(5):
        a = math.tau * k / 5
        m.add(S.sphere(0.045, 6, 4, loc=(L / 2 + 0.03, math.cos(a) * 0.22, 0.72 + math.sin(a) * 0.22)), 'BloodWine')
    # coffin in the back + the skeleton chauffeur at the wheel (visible through the side window)
    m.add(S.box(1.6, 0.55, 0.32, 0.05, 1, base=(-1.45, 0, 0.93)), 'WoodEbony')
    sk, so = S.skull(0.1, loc=(0.72, -0.35, 1.28), rot=(0, 0, -70), segs=10)
    m.add(sk, 'Bone')
    m.add(so, 'Black')
    m.add(S.superellipsoid(0.12, 0.16, 0.2, 0.6, 0.6, 10, 5, loc=(0.68, -0.35, 1.05)), 'Black')
    m.add(S.cylinder(0.16, 0.025, 14, 0.0, base=(0.95, -0.35, 1.08), rot=(0, -60, 0)), 'Black')


@builder('env_cart')
def env_cart(m: Model, spec: Spec) -> None:
    j = m.rng
    m.add(S.box(1.0, 0.6, 0.05, 0.012, 1, base=(0.05, 0, 0.42)), 'Galvanised')
    for sy in (-1, 1):
        m.add(S.box(1.0, 0.03, 0.08, 0.008, 1, base=(0.05, sy * 0.3, 0.46)), 'Galvanised')
    # big spoked wheels at the back (-X), casters at the front
    for sy in (-1, 1):
        y = sy * 0.34
        rim = S.torus(0.24, 0.025, 18, 5, rot=(90, 0, 0))
        m.add(S.translate(rim, (-0.3, y, 0.25)), 'Rubber')
        for k in range(6):
            a = math.pi * k / 6
            sp = S.cylinder(0.008, 0.46, 4, 0.0, base=(0, 0, -0.23), rot=(0, 0, 0))
            S.rotate(sp, (0, math.degrees(a), 0))
            m.add(S.translate(sp, (-0.3, y, 0.25)), 'Iron')
        m.add(S.cylinder(0.04, 0.05, 8, 0.0, base=(-0.3, y - 0.025, 0.25), rot=(-90, 0, 0)), 'Iron')
        m.add(S.cylinder(0.008, 0.3, 4, 0.0, base=(0.45, y * 0.8, 0.12)), 'Iron')
        m.add(S.cylinder(0.06, 0.04, 10, 0.0, base=(0.45, y * 0.8 - 0.02, 0.06), rot=(-90, 0, 0)), 'Rubber')
    m.add(S.cylinder(0.015, 0.68, 6, 0.0, base=(-0.3, -0.34, 0.25), rot=(-90, 0, 0)), 'Iron')
    # push handle
    handle = [(-0.42, -0.28, 0.45), (-0.55, -0.28, 0.95), (-0.55, 0.28, 0.95), (-0.42, 0.28, 0.45)]
    m.add(S.tube(handle, 0.02, 6), 'Iron')
    m.add(S.cylinder(0.03, 0.4, 8, 0.0, base=(-0.55, -0.2, 0.95), rot=(-90, 0, 0)), 'Rubber')
    # pizza warmer box with a crooked sign + a little bell
    m.add(S.box(0.56, 0.5, 0.36, 0.04, 2, base=(0.1, 0, 0.47)), 'EnamelRed')
    m.add(S.box(0.58, 0.52, 0.05, 0.02, 1, base=(0.1, 0, 0.83)), 'EnamelRed')
    m.add(S.box(0.4, 0.02, 0.12, 0.01, 1, base=(0.1, -0.26, 0.6)), 'Paper')
    m.add(S.text('PIZZA', 0.07, 0.004, loc=(0.1, -0.272, 0.66)), 'Blood')
    m.add(S.box(0.3, 0.03, 0.2, 0.01, 1, base=(0.15, 0.0, 0.88), rot=(0, 0, 8)), 'Paper')
    m.add(S.text('HOT', 0.07, 0.004, loc=(0.15, -0.02, 0.98), rot=(90, 0, 8)), 'Blood')
    m.add(S.lathe([(0.0, 0.0), (0.04, 0.0), (0.035, 0.04), (0.0, 0.06)], 8, base=(-0.5, 0.2, 0.97)), 'Brass')


@builder('env_gravestones')
def env_gravestones(m: Model, spec: Spec) -> None:
    j = m.rng
    m.add(S.blob(1.0, 1, 0.15, 2.0, 2, loc=(0, 0.05, 0.0), scale=(1.0, 0.6, 0.12), flat_bottom=0.0), 'Grass')
    # rounded slab, leaning left
    r = 0.25
    pts = [(-r, 0.0), (r, 0.0), (r, 0.75 - r)] + [(math.cos(math.pi * k / 8) * r, 0.75 - r + math.sin(math.pi * k / 8) * r)
                                                for k in range(1, 8)] + [(-r, 0.75 - r)]
    a = S.prism(pts, 0.12, 0.02, 1, plane='XZ')
    S.rotate(a, (6, -9, 4))
    m.add(S.translate(a, (-0.6, 0.05, 0.0)), 'Granite')
    # celtic cross, leaning back
    cr = S.merge(S.box(0.12, 0.1, 0.95, 0.015, 1, base=(0, 0, 0)), S.box(0.42, 0.1, 0.12, 0.015, 1, base=(0, 0, 0.62)),
                 S.torus(0.14, 0.025, 14, 4, loc=(0, 0, 0.68), rot=(90, 0, 0)))
    S.rotate(cr, (-8, 4, -6))
    m.add(S.translate(cr, (0.05, 0.25, 0.0)), 'StoneLight')
    # square-topped stone with a little obelisk cap, leaning right
    ob = S.merge(S.box(0.4, 0.14, 0.55, 0.02, 1, base=(0, 0, 0)),
                 S.taper_box(0.4, 0.14, 0.05, 0.05, 0.25, 0.01, 1, base=(0, 0, 0.55)))
    S.rotate(ob, (3, 10, 8))
    m.add(S.translate(ob, (0.65, -0.05, 0.0)), 'Granite')
    for k, (x, z, n_) in enumerate(((-0.6, 0.72, (0, 0, 1)), (0.65, 0.4, (0, -1, 0.2)), (0.05, 0.9, (0, -0.5, 1)))):
        m.add(mold_blotch(x, 0.0 if k != 2 else 0.2, z, 0.12, n_, seed=k), 'Moss')
    for k in range(7):
        m.add(S.grass_tuft(0.08, j.uniform(0.12, 0.22), 6, base=(j.uniform(-0.9, 0.9), j.uniform(-0.3, 0.4), 0.0), seed=k),
              'Grass' if k % 2 else 'GrassDry')
    clamp_floor(m)
