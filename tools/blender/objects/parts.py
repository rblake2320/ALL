"""Furniture-specific composite parts shared by the object builders (legs, cabinets, knobs, decay details)."""
from __future__ import annotations

import math
from typing import List, Optional, Sequence, Tuple

import bmesh
from mathutils import Vector

from common import dims
from common import shapes as S
from common.model import Model
from common.rng import Jitter

FRONT = -1.0  # Blender -Y is the model front


# ───────────────────────────── structure ─────────────────────────────


def leg(x: float, y: float, top: float, w0: float = 0.05, w1: Optional[float] = None, splay: Tuple[float, float] = (0, 0),
        short: float = 0.0, bevel: float = 0.008, round_: bool = False, segs: int = 8) -> bmesh.types.BMesh:
    """Tapered leg from the floor (or ``short`` above it) to ``top``; ``splay`` = (dx, dy) foot offset."""
    w1 = w0 * 0.75 if w1 is None else w1
    h = top - short
    if round_:
        bm = S.cylinder(w1 / 2, h, segs, bevel, r_top=w0 / 2, base=(0, 0, 0))
    else:
        bm = S.taper_box(w1, w1, w0, w0, h, bevel, 1, base=(0, 0, 0))
    # splay: shift bottom verts
    for v in bm.verts:
        t = 1.0 - v.co.z / h
        v.co.x += splay[0] * t
        v.co.y += splay[1] * t
    return S.translate(bm, (x, y, short))


def turned_leg(x: float, y: float, top: float, r: float = 0.03, segs: int = 10, short: float = 0.0) -> bmesh.types.BMesh:
    h = top - short
    prof = [(r * 0.75, 0.0), (r * 0.9, h * 0.06), (r * 0.65, h * 0.14), (r * 0.6, h * 0.45), (r * 1.05, h * 0.62),
            (r * 0.7, h * 0.72), (r * 0.8, h * 0.9), (r * 1.0, h)]
    return S.lathe(prof, segs, base=(x, y, short))


def bun_foot(x: float, y: float, r: float = 0.04, h: float = 0.06) -> bmesh.types.BMesh:
    return S.lathe([(r * 0.7, 0), (r, h * 0.35), (r * 0.95, h * 0.7), (r * 0.6, h), (0, h)], 10, base=(x, y, 0))


def claw_foot(x: float, y: float, s: float = 0.05, yaw: float = 0.0) -> bmesh.types.BMesh:
    """Stubby animal claw foot: ankle + three toes + a ball."""
    parts = [S.sphere(s * 0.55, 10, 6, loc=(0, 0, s * 0.5))]
    for k in (-1, 0, 1):
        a = math.radians(-90 + 40 * k)
        dx, dy = math.cos(a) * s * 0.55, math.sin(a) * s * 0.55
        parts.append(S.tube([(0, 0, s * 0.55), (dx * 0.8, dy * 0.8, s * 0.3), (dx * 1.25, dy * 1.25, s * 0.1)],
                            radii=[s * 0.22, s * 0.2, s * 0.12], segs=6))
    parts.append(S.cylinder(s * 0.3, s * 0.5, 8, 0.004, base=(0, 0, s * 0.6)))
    bm = S.merge(*parts)
    S.rotate(bm, (0, 0, yaw))
    return S.translate(bm, (x, y, 0))


def cabinet(m: Model, w: float, d: float, h: float, mat: str = 'Paint', doors: int = 2, drawer: bool = True,
            knob_mat: str = 'Brass', kick: float = 0.07, y0: float = 0.0, x0: float = 0.0,
            node: Optional[str] = None, panel_inset: bool = True, j: Optional[Jitter] = None) -> None:
    """Kitchen base cabinet centred on (x0, y0) with doors facing the FRONT (-Y). Top at ``h``."""
    j = j or m.rng.fork('cab')
    front = y0 - d / 2
    m.add(S.box(w, d - 0.03, h - kick, 0.012, 2, base=(x0, y0 + 0.015, kick)), mat, node)
    # recessed toe kick
    m.add(S.box(w - 0.06, d - 0.1, kick, 0.006, 1, base=(x0, y0 + 0.03, 0)), 'Black', node)
    top_band = 0.0
    if drawer:
        top_band = 0.16
        m.add(S.box(w - 0.06, 0.03, 0.12, 0.01, 2, base=(x0, front - 0.005, h - 0.15)), mat, node)
        m.add(S.box(0.14, 0.03, 0.022, 0.008, 1, base=(x0, front - 0.03, h - 0.1)), knob_mat, node)
    dh = h - kick - top_band - 0.06
    if doors <= 0:
        return
    dw = (w - 0.06 - 0.02 * (doors - 1)) / doors
    for i in range(doors):
        cx = x0 - w / 2 + 0.03 + dw / 2 + i * (dw + 0.02)
        rz = j.sym(1.2)
        m.add(S.box(dw, 0.03, dh, 0.01, 2, base=(cx, front - 0.005, kick + 0.03), rot=(0, rz * 0.3, 0)), mat, node)
        if panel_inset:
            m.add(S.box(dw - 0.08, 0.012, dh - 0.1, 0.006, 1, base=(cx, front - 0.022, kick + 0.08)), mat, node)
        # double doors: knobs meet in the middle; a single door gets its knob on the right edge
        side = (1 if i % 2 == 0 else -1) if doors > 1 else 1
        kx = cx + (dw / 2 - 0.05) * side
        m.add(S.sphere(0.018, 8, 6, loc=(kx, front - 0.035, kick + 0.03 + dh * 0.82)), knob_mat, node)


def drawer_pull(x: float, y: float, z: float, w: float = 0.12) -> bmesh.types.BMesh:
    bar = S.cylinder(0.008, w, 8, 0.0, base=(-w / 2, 0, 0), rot=(0, 90, 0))
    posts = [S.cylinder(0.006, 0.025, 6, 0.0, base=(sx * w * 0.4, 0, 0), rot=(-90, 0, 0)) for sx in (-1, 1)]
    for p in posts:
        S.translate(p, (0, 0.0, 0))
    bm = S.merge(bar, *posts)
    S.translate(bm, (0, -0.025, 0))
    return S.translate(bm, (x, y, z))


def knob(x: float, y: float, z: float, r: float = 0.022, depth: float = 0.025, segs: int = 10,
         facing: str = 'front') -> bmesh.types.BMesh:
    bm = S.lathe([(r * 0.6, 0), (r, depth * 0.25), (r * 0.95, depth * 0.8), (r * 0.6, depth), (0, depth)], segs)
    if facing == 'front':
        S.rotate(bm, (90, 0, 0))
    elif facing == 'up':
        pass
    return S.translate(bm, (x, y, z))


def nail_heads(points: Sequence[Sequence[float]], r: float = 0.006, normal_axis: str = 'y') -> bmesh.types.BMesh:
    parts = []
    for p in points:
        rot = (90, 0, 0) if normal_axis == 'y' else (0, 90, 0) if normal_axis == 'x' else (0, 0, 0)
        parts.append(S.cylinder(r, 0.006, 6, 0.002, base=(0, 0, 0), rot=rot))
        S.translate(parts[-1], p)
    return S.merge(*parts)


# ───────────────────────────── decay / funny details ─────────────────────────────


def mold_blotch(x: float, y: float, z: float, r: float, normal: Sequence[float] = (0, 0, 1), seed: int = 0,
                flat: float = 0.18) -> bmesh.types.BMesh:
    """Flattened lumpy blob lying on a surface with the given normal."""
    bm = S.blob(r, 1, 0.35, 3.0, seed, scale=(1.0, 1.0, flat))
    n = Vector(normal).normalized()
    q = Vector((0, 0, 1)).rotation_difference(n)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=q.to_matrix(), verts=bm.verts)
    return S.translate(bm, (x, y, z))


def stuffing_tuft(x: float, y: float, z: float, r: float = 0.035, seed: int = 0) -> bmesh.types.BMesh:
    parts = [S.blob(r, 1, 0.3, 2.5, seed + k, loc=(dx * r, dy * r, dz * r)) for k, (dx, dy, dz) in
             enumerate(((0, 0, 0), (0.7, 0.2, 0.3), (-0.5, -0.3, 0.4)))]
    return S.translate(S.merge(*parts), (x, y, z))


def mushroom(x: float, y: float, z: float, s: float = 0.03, lean: float = 0.0) -> Tuple[bmesh.types.BMesh, bmesh.types.BMesh]:
    stem = S.cylinder(s * 0.28, s * 1.1, 6, 0.0, r_top=s * 0.22, base=(0, 0, 0))
    cap = S.lathe([(0.0, s * 0.95), (s * 0.75, s * 1.0), (s * 0.7, s * 1.25), (s * 0.35, s * 1.5), (0.0, s * 1.55)], 8)
    for b in (stem, cap):
        S.rotate(b, (lean, 0, 0))
        S.translate(b, (x, y, z))
    return stem, cap


def cobweb(corner: Sequence[float], size: float = 0.18, axes: Tuple[str, str] = ('x', 'z'),
           signs: Tuple[float, float] = (1, -1)) -> bmesh.types.BMesh:
    """Triangular corner web: a few radial threads + sagging rings, as thin double-sided ribbons."""
    c = Vector(corner)
    ax = {'x': Vector((1, 0, 0)), 'y': Vector((0, 1, 0)), 'z': Vector((0, 0, 1))}
    a, b = ax[axes[0]] * signs[0], ax[axes[1]] * signs[1]
    parts = []
    spokes = 4
    for i in range(spokes + 1):
        t = i / spokes
        d = (a * (1 - t) + b * t).normalized()
        parts.append(S.tube([c, c + d * size], 0.0015, 3, cap=False))
    for ring in (0.4, 0.7, 1.0):
        pts = []
        for i in range(spokes + 1):
            t = i / spokes
            d = (a * (1 - t) + b * t).normalized()
            sag = 0.1 * ring * size * math.sin(math.pi * t) * 0.5
            pts.append(c + d * size * ring * 0.95 - (a + b).normalized() * sag)
        parts.append(S.tube(pts, 0.0012, 3, cap=False))
    return S.merge(*parts)


def add_broken(m: Model, at: Sequence[float], scale: float = 1.0) -> None:
    """Generic 'broken' indicator (hidden at runtime unless broken): smoke puffs + a zig-zag spark."""
    m.node('broken', origin=at, transient=True, extras={'part': 'broken'})
    x, y, z = at
    s = scale * 1.45  # chunky enough to read from the zoomed-out game camera
    for k, (dx, dz, r) in enumerate(((0, 0.0, 0.07), (0.06, 0.07, 0.055), (-0.05, 0.1, 0.05), (0.01, 0.16, 0.04))):
        m.add(S.blob(r * s, 1, 0.25, 2.0, 40 + k, loc=(x + dx * s, y, z + dz * s)), 'Smoke', 'broken')
    bolt = [(x - 0.07 * s, y - 0.05 * s, z + 0.02 * s), (x - 0.02 * s, y - 0.06 * s, z - 0.03 * s),
            (x + 0.0, y - 0.06 * s, z + 0.03 * s), (x + 0.06 * s, y - 0.05 * s, z - 0.04 * s)]
    m.add(S.tube(bolt, 0.008 * s, 4), 'Spark', 'broken')


def books_row(m: Model, x0: float, x1: float, y_back: float, z: float, depth: float, j: Jitter, node: Optional[str] = None,
              max_h: float = 0.3, lean_last: bool = True, mats: Sequence[str] = ('Book1', 'Book2', 'Book3', 'Book4', 'Book5')
              ) -> float:
    """Fill a shelf with leaning books from x0..x1; returns x where the row ended."""
    x = x0
    while x < x1 - 0.02:
        t = j.uniform(0.025, 0.055)
        if x + t > x1:
            break
        h = j.uniform(0.6, 1.0) * max_h
        dd = depth * j.uniform(0.8, 1.0)
        tilt = j.sym(2.5)
        m.add(S.box(t, dd, h, 0.0, 0, base=(x + t / 2, y_back - dd / 2, z), rot=(0, tilt, 0)), j.choice(mats), node)
        x += t + 0.002
    return x
