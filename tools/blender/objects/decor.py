"""Decor & yard: plants, rugs, the ancestor portrait (wall), headstone, gnarled tree."""
from __future__ import annotations

import math
from typing import List, Tuple

import bmesh
from mathutils import Vector

from common import dims
from common import shapes as S
from common.catalog import Spec
from common.model import Model
from common.rng import Jitter

from .parts import mold_blotch
from .registry import builder


def _pot(m: Model, r: float, h: float, mat: str = 'Terracotta', soil: str = 'SoilDark') -> None:
    prof = [(r * 0.62, 0.0), (r * 0.66, 0.012), (r * 0.9, h * 0.8), (r * 1.02, h * 0.82), (r * 1.05, h * 0.96),
            (r * 0.95, h), (r * 0.9, h * 0.93), (0.0, h * 0.9)]
    m.add(S.lathe(prof, 16), mat)
    m.add(S.cylinder(r * 0.88, 0.01, 14, 0.0, base=(0, 0, h * 0.9 - 0.004)), soil)


@builder('plant_deadfern')
def plant_deadfern(m: Model, spec: Spec) -> None:
    """Chipped terracotta pot on a saucer with a fern that has given up: long fronds arch up and flop over the rim,
    two crispy fiddleheads still trying, a couple of fronds already on the floor."""
    j = m.rng
    h = 0.38
    _pot(m, 0.2, h)
    m.add(S.lathe([(0.0, 0.0), (0.24, 0.0), (0.255, 0.022), (0.23, 0.03), (0.0, 0.026)], 18), 'Terracotta')
    # chip out of the rim (dark notch) + hairline crack
    m.add(S.box(0.06, 0.03, 0.035, 0.008, 1, loc=(0.09, -0.185, h - 0.01), rot=(0, 20, 25)), 'SoilDark')
    m.add(S.tube([(0.02, -0.2, h - 0.03), (0.035, -0.198, h - 0.1), (0.015, -0.193, h - 0.16), (0.03, -0.188, h - 0.22)],
                 0.0035, 3), 'SoilDark')
    jf = j.fork('fronds')
    n = 10
    for k in range(n):
        yaw = 360 * k / n + jf.sym(12)
        L = jf.uniform(0.6, 0.72)
        pitch = jf.uniform(48, 62)
        droop = jf.uniform(0.42, 0.56)
        mat = ('FernDead', 'FernBrown', 'Straw')[k % 3]
        m.add(S.frond(L, droop, 0.1, 7, base=(0, 0, h * 0.92), yaw=yaw, pitch=pitch, curl=0.035), mat)
    for k in range(3):
        yaw = 120 * k + 40 + jf.sym(10)
        m.add(S.frond(0.64, 0.16, 0.085, 7, base=(0, 0, h * 0.92), yaw=yaw, pitch=84, curl=0.02),
              'FernDead' if k else 'Straw')
    # two fiddleheads: stems rising from the soil ending in tight dry spirals
    for k, (x, y, hh) in enumerate(((0.04, 0.03, 0.42), (-0.05, -0.02, 0.36))):
        stem = S.catmull([(x, y, h * 0.9), (x * 1.5, y * 1.5, h + hh * 0.5), (x * 2.2, y * 2.2, h + hh)], 3)
        m.add(S.tube(stem, 0.007, 4), 'FernDead')
        top = stem[-1]
        sp = S.spiral(0.005, 0.034, 1.4, 12, center=(top.x - 0.034, top.y, top.z), plane='XZ', a0=0)
        coil = S.tube(sp, 0.0075, 4)
        S.rotate(coil, (0, 0, 40 + 110 * k), pivot=(top.x, top.y, top.z))
        m.add(coil, 'FernBrown')
    # fallen fronds + loose leaflets on the floor
    for k, (x, y, yaw) in enumerate(((0.33, -0.25, 200), (-0.3, -0.3, 125), (0.12, 0.36, 300))):
        fr = S.frond(0.36, 0.0, 0.07, 6, base=(0, 0, 0), yaw=0, pitch=0)
        S.rotate(fr, (0, 0, yaw))
        m.add(S.translate(fr, (x, y, 0.012)), 'FernBrown' if k % 2 else 'FernDead')


@builder('plant_carnivorous')
def plant_carnivorous(m: Model, spec: Spec) -> None:
    j = m.rng
    h = 0.42
    _pot(m, 0.23, h, 'PotPurple', 'SoilDark')
    # big leaves at the base
    for k in range(6):
        yaw = 60 * k + j.sym(10)
        m.add(S.frond(0.32, 0.2, 0.1, 3, base=(0, 0, h * 0.9), yaw=yaw, pitch=40), 'PlantGreen')
    heads = [((0.0, 0.0), (0.05, -0.12, 1.08), 0), ((0.06, 0.03), (0.3, 0.05, 0.86), 1), ((-0.05, 0.02), (-0.27, -0.02, 0.92), 2)]
    for (bx, by), (hx, hy, hz), idx in heads:
        stalk = S.catmull([(bx, by, h * 0.88), (bx + (hx - bx) * 0.2, by + 0.06, h + 0.2), (hx * 0.7, hy * 0.5 + 0.08, hz - 0.2),
                           (hx, hy + 0.05, hz - 0.06)], 3)
        radii = [0.022 - 0.01 * i / (len(stalk) - 1) for i in range(len(stalk))]
        m.add(S.tube(stalk, radii=radii, segs=6), 'PlantGreen')
        yaw = math.degrees(math.atan2(hx, -hy)) if (hx or hy) else 0
        _flytrap(m, (hx, hy, hz), yaw + j.sym(15), 0.12 if idx == 0 else 0.1, j.fork(f'h{idx}'), idx == 0)


def _flytrap(m: Model, at: Tuple[float, float, float], yaw: float, s: float, j: Jitter, bone: bool) -> None:
    """Two toothy jaws opening toward -Y (before yaw), purple insides."""
    parts_g, parts_p, teeth = [], [], []
    for side, ang in ((1, 32), (-1, -28)):
        jaw = S.sphere(s, 12, 6, scale=(1.0, 0.75, 0.32))
        # keep the half facing the gape
        bm = jaw
        for v in bm.verts:
            if v.co.z * side < 0:
                v.co.z *= 0.15
        S.rotate(bm, (ang, 0, 0))
        parts_g.append(bm)
        inner = S.sphere(s * 0.9, 10, 5, scale=(0.95, 0.7, 0.18))
        S.rotate(inner, (ang, 0, 0))
        S.translate(inner, (0, 0, side * 0.006))
        parts_p.append(inner)
        for k in range(7):
            a = math.pi * (k + 0.5) / 7
            tx = math.cos(a) * s * 0.92
            ty = -math.sin(a) * s * 0.7
            tooth = S.cone(0.008, 0.035, 4, base=(0, 0, 0), rot=(0 if side > 0 else 180, 0, 0))
            S.translate(tooth, (tx, ty, 0.0))
            S.rotate(tooth, (ang, 0, 0))
            teeth.append(tooth)
    g = S.merge(*parts_g)
    p = S.merge(*parts_p)
    t = S.merge(*teeth)
    for bm in (g, p, t):
        S.rotate(bm, (0, 0, yaw))
        S.translate(bm, at)
    m.add(g, 'PlantGreen')
    m.add(p, 'PlantPurple')
    m.add(t, 'Teeth')
    if bone:
        b = S.bone(0.16, 0.012, 1.9, segs=6)
        S.rotate(b, (0, 15, yaw + 90))
        m.add(S.translate(b, at), 'Bone')


def _ring_points(a: float, b: float, n: int, z: float, nexp: float = 2.0) -> List[Tuple[float, float, float]]:
    return [(x, y, z) for x, y in S.superellipse_pts(a, b, nexp, n)]


@builder('rug_rag')
def rug_rag(m: Model, spec: Spec) -> None:
    """Braided oval: flattened twisted coils laid edge to edge, tintable main colour + rag accents."""
    j = m.rng
    A, B = 0.94, 0.72
    rings = 10
    mats = ['Paint', 'RugB', 'Paint', 'RugC', 'Paint', 'RugD', 'Paint', 'RugB', 'Paint', 'RugD']
    r = 0.04
    z = 0.0105
    m.add(S.translate(S.prism(S.superellipse_pts(0.22, 0.04, 2.0, 12), 0.016, 0.004, 1, plane='XY'), (0, 0, 0.0)), 'RugC')
    for k in range(rings):
        da = 0.22 + (A - 0.22 - r) * k / (rings - 1)
        db = 0.04 + (B - 0.04 - r) * k / (rings - 1)
        n = int(26 + 26 * k / (rings - 1))
        pts = _ring_points(da, db, n, z)
        m.add(S.tube(pts, r, 4, closed=True, scale_xy=(1.0, 0.26), twist=0.6), mats[k % len(mats)])


@builder('rug_funeral')
def rug_funeral(m: Model, spec: Spec) -> None:
    j = m.rng
    L, W, T = 2.86, 1.86, 0.012
    m.add(S.box(L, W, T, 0.004, 1, base=(0, 0, 0)))
    g = 'RugGold'
    z = T

    def frame(lx: float, wy: float, w: float, mat: str, dz: float = 0.002) -> None:
        for sy in (-1, 1):
            m.add(S.box(lx, w, dz, 0.0, 0, base=(0, sy * (wy / 2 - w / 2), z)), mat)
        for sx in (-1, 1):
            m.add(S.box(w, wy - 2 * w, dz, 0.0, 0, base=(sx * (lx / 2 - w / 2), 0, z)), mat)

    frame(L - 0.12, W - 0.12, 0.05, g)
    frame(L - 0.3, W - 0.3, 0.025, 'RugB')
    frame(L - 0.42, W - 0.42, 0.015, g)
    # central medallion: stacked diamonds and an oval ring
    for k, (s, mat) in enumerate(((0.62, g), (0.48, 'RugB'), (0.34, g), (0.18, 'RugB'))):
        pts = [(s * 1.6, 0.0), (0.0, s), (-s * 1.6, 0.0), (0.0, -s)]
        m.add(S.translate(S.prism(pts, 0.002, 0.0, 0, plane='XY'), (0, 0, z + 0.0005 * k)), mat)
    m.add(S.tube([(x, y, z + 0.004) for x, y in S.superellipse_pts(0.75, 0.46, 2.0, 32)], 0.012, 3, closed=True,
                 scale_xy=(1.0, 0.3)), g)
    # corner fans
    for sx in (-1, 1):
        for sy in (-1, 1):
            pts = [(0.0, 0.0), (0.3, 0.0), (0.0, 0.3)]
            fan = S.prism(pts, 0.002, 0.0, 0, plane='XY')
            for v in fan.verts:
                v.co.x *= -sx
                v.co.y *= -sy
            bmesh.ops.recalc_face_normals(fan, faces=fan.faces)
            m.add(S.translate(fan, (sx * (L / 2 - 0.24), sy * (W / 2 - 0.24), z)), g)
    # fringe on the short ends
    for sx in (-1, 1):
        for k in range(22):
            y = -W / 2 + 0.06 + k * (W - 0.12) / 21
            m.add(S.box(0.07, 0.012, 0.004, 0.0, 0, base=(sx * (L / 2 + 0.03), y, 0.0), rot=(0, 0, j.sym(8))), 'Lace')


@builder('painting_greatgrand')
def painting_greatgrand(m: Model, spec: Spec) -> None:
    """Wall item: back flat at y=0 (wall surface), projecting toward -Y (front); centred at z=1.6."""
    j = m.rng
    cz = 1.6
    W, H, D = 0.7, 0.9, 0.06
    fw = 0.075
    # gilded frame: four bevelled bars + inner lip + corner rosettes + crest
    for sz in (-1, 1):
        m.add(S.box(W, D, fw, 0.02, 2, base=(0, -D / 2, cz + sz * (H / 2 - fw / 2) - fw / 2)), 'Gold')
    for sx in (-1, 1):
        m.add(S.box(fw, D, H - 2 * fw, 0.02, 2, base=(sx * (W / 2 - fw / 2), -D / 2, cz - (H - 2 * fw) / 2)), 'Gold')
    for sx in (-1, 1):
        for sz in (-1, 1):
            m.add(S.sphere(0.03, 8, 6, loc=(sx * (W / 2 - fw / 2), -D - 0.004, cz + sz * (H / 2 - fw / 2)), scale=(1, 0.5, 1)),
                  'Gold')
    crest = S.prism([(-0.14, 0.0), (0.14, 0.0), (0.08, 0.05), (0.0, 0.09), (-0.08, 0.05)], 0.04, 0.01, 1, plane='XZ')
    m.add(S.translate(crest, (0, -0.025, cz + H / 2 - 0.01)), 'Gold')
    # canvas + the stern ancestor in low relief
    cw, ch = W - 2 * fw + 0.01, H - 2 * fw + 0.01
    m.add(S.box(cw, 0.01, ch, 0.0, 0, base=(0, -0.012, cz - ch / 2)), 'Plum')
    yb = -0.017
    shoulders = S.superellipsoid(0.2, 0.02, 0.12, 0.6, 0.6, 12, 6, loc=(0, yb, cz - 0.27))
    m.add(shoulders, 'Black')
    m.add(S.prism([(-0.04, 0.0), (0.04, 0.0), (0.0, -0.09)], 0.01, 0.0, 0, plane='XZ', loc=(0, yb - 0.022, cz - 0.15)), 'Lace')
    m.add(S.superellipsoid(0.11, 0.025, 0.14, 0.8, 0.8, 12, 8, loc=(0, yb - 0.005, cz - 0.02)), 'Skin')
    # top hat
    m.add(S.box(0.2, 0.02, 0.025, 0.004, 1, base=(0, yb - 0.01, cz + 0.11)), 'Black')
    m.add(S.box(0.14, 0.02, 0.15, 0.006, 1, base=(0, yb - 0.01, cz + 0.13)), 'Black')
    m.add(S.box(0.142, 0.022, 0.02, 0.002, 1, base=(0, yb - 0.01, cz + 0.14)), 'BloodWine')
    # droopy left eye; empty right socket with a monocle; mustache; stitched brow
    m.add(S.sphere(0.022, 8, 6, loc=(-0.045, yb - 0.028, cz + 0.01), scale=(1, 0.4, 0.7)), 'Porcelain')
    m.add(S.sphere(0.009, 6, 4, loc=(-0.045, yb - 0.036, cz + 0.006), scale=(1, 0.4, 1)), 'Black')
    m.add(S.box(0.05, 0.01, 0.012, 0.003, 1, loc=(-0.045, yb - 0.034, cz + 0.026), rot=(0, -8, 0)), 'SkinDark')
    m.add(S.sphere(0.022, 8, 6, loc=(0.045, yb - 0.026, cz + 0.01), scale=(1, 0.3, 0.8)), 'Black')
    m.add(S.torus(0.028, 0.004, 12, 3, loc=(0.045, yb - 0.034, cz + 0.01), rot=(90, 0, 0)), 'Gold')
    m.add(S.tube([(0.07, yb - 0.034, cz - 0.015), (0.08, yb - 0.03, cz - 0.08), (0.06, yb - 0.025, cz - 0.15)], 0.0015, 3), 'Gold')
    must = S.tube([(-0.07, yb - 0.03, cz - 0.07), (-0.03, yb - 0.034, cz - 0.05), (0.0, yb - 0.034, cz - 0.06),
                   (0.03, yb - 0.034, cz - 0.05), (0.07, yb - 0.03, cz - 0.07)], 0.011, 5, scale_xy=(1, 0.5))
    m.add(must, 'Charcoal')
    m.add(S.stitches((-0.06, yb - 0.03, cz + 0.075), (0.05, yb - 0.03, cz + 0.08), 4, 0.008, (0, -1, 0), 0.002), 'Ink')
    # the eye that fell out, dangling over the frame on its nerve
    ex, ez = 0.12, cz - H / 2 - 0.05
    m.add(S.tube(S.catmull([(0.045, yb - 0.03, cz + 0.0), (0.1, yb - 0.04, cz - 0.2), (0.13, -D - 0.01, cz - H / 2 + 0.02),
                            (ex, -D - 0.012, ez + 0.02)], 3), 0.003, 4), 'BloodWine')
    m.add(S.sphere(0.02, 10, 6, loc=(ex, -D - 0.012, ez)), 'Porcelain')
    m.add(S.sphere(0.01, 8, 4, loc=(ex, -D - 0.03, ez), scale=(1, 0.4, 1)), 'Book2')
    m.add(S.sphere(0.005, 6, 3, loc=(ex, -D - 0.034, ez), scale=(1, 0.4, 1)), 'Black')
    # hanging wire peeking above the frame
    m.add(S.tube([(-0.12, -0.005, cz + H / 2 - 0.02), (0.0, -0.004, cz + H / 2 + 0.06), (0.12, -0.005, cz + H / 2 - 0.02)],
                 0.0025, 3), 'Iron')


@builder('headstone_decor')
def headstone_decor(m: Model, spec: Spec) -> None:
    j = m.rng
    W, H, D = 0.62, 0.92, 0.15
    r = W / 2
    pts = [(-r, 0.0), (r, 0.0), (r, H - r)]
    for k in range(1, 10):
        a = math.pi * k / 10
        pts.append((math.cos(a) * r, H - r + math.sin(a) * r))
    pts.append((-r, H - r))
    stone = S.prism(pts, D, 0.025, 2, plane='XZ')
    lean = (j.sym(3), 0, j.sym(3))
    S.rotate(stone, lean)
    m.add(S.translate(stone, (0, 0.05, 0.07)), 'Granite')
    m.add(S.box(0.78, 0.32, 0.08, 0.02, 2, base=(0, 0.05, 0.0)), 'StoneLight')
    yf = 0.05 - D / 2
    txt = S.text('R.I.P.', 0.15, 0.01, loc=(0, 0, 0))
    S.translate(txt, (0, yf - 0.002, 0.07 + H * 0.5))
    S.rotate(txt, lean, pivot=(0, 0.05, 0.07))
    m.add(txt, 'Slate')
    cross = S.merge(S.box(0.035, 0.012, 0.15, 0.004, 1, base=(0, 0, 0)), S.box(0.1, 0.012, 0.035, 0.004, 1, base=(0, 0, 0.09)))
    S.translate(cross, (0, yf - 0.002, 0.07 + H * 0.68))
    S.rotate(cross, lean, pivot=(0, 0.05, 0.07))
    m.add(cross, 'Slate')
    # crack + moss + grass
    crack = S.jagged((0.18, 0, 0.3), (0.25, 0, 0.55), 4, 0.02, j)
    crack = [Vector((p.x, yf - 0.003, p.z + 0.07)) for p in crack]
    m.add(S.tube(crack, 0.004, 3), 'Charcoal')
    for k, (x, z, n, rr) in enumerate(((0.12, H + 0.04, (0.2, -0.3, 1), 0.12), (-0.25, 0.25, (-1, -0.4, 0.2), 0.08),
                                       (0.2, 0.12, (0.2, -1, 0.1), 0.07), (-0.05, H + 0.06, (0, 0.3, 1), 0.08))):
        m.add(mold_blotch(x, 0.05 + (yf - 0.05) * (0.3 if k == 0 else 1.0), z, rr, n, seed=k), 'Moss')
    for k in range(5):
        x = j.uniform(-0.38, 0.38)
        y = j.choice((-0.15, 0.24))
        m.add(S.grass_tuft(0.05, j.uniform(0.08, 0.14), 6, base=(x, y, 0.0), seed=k), 'Grass')


def branchy_tree(m: Model, j: Jitter, height: float, trunk_r: float, spread: float, mat: str = 'Bark',
                 levels: int = 3, splits: Tuple[int, ...] = (3, 2, 2), root_r: float = 0.45,
                 twist: float = 0.25, taper: float = 0.42, twigs: int = 3, burls: int = 3) -> List[Tuple[Vector, Vector]]:
    """Recursive crooked branches with a slow taper (chunky, toy-like limbs), twig fans at the tips, burls on the
    trunk and a root flare; returns (tip, direction) of the final twigs (for perching crows)."""
    tips: List[Tuple[Vector, Vector]] = []
    trunk_pts: List[Vector] = []

    def grow(p0: Vector, d: Vector, length: float, r0: float, level: int) -> None:
        pts = [p0]
        radii = [r0]
        n = 5 if level == 0 else 4
        cur = p0.copy()
        dd = d.normalized()
        for i in range(1, n + 1):
            dd = (dd + Vector((j.sym(twist), j.sym(twist), j.sym(twist * 0.4)))).normalized()
            if level == 0:
                dd = (dd + Vector((0, 0, 0.35))).normalized()
            cur = cur + dd * (length / n)
            pts.append(cur.copy())
            radii.append(r0 * (1 - taper * i / n))
        if level == 0:
            trunk_pts.extend(pts)
        segs = 8 if level == 0 else (6 if level == 1 else (5 if level == 2 else 4))
        if level == levels:
            radii[-1] = r0 * 0.25
        m.add(S.tube(pts, radii=radii, segs=segs), mat)
        if level >= levels:
            tips.append((pts[-1], dd))
            # twig fan: a few short, thin crooked sprigs make the silhouette spooky instead of stubby
            for t in range(twigs):
                a = math.tau * t / max(1, twigs) + j.sym(0.8)
                side = Vector((math.cos(a), math.sin(a), 0.4)).normalized()
                tdir = (dd * 0.8 + side * 0.7).normalized()
                tl = length * j.uniform(0.35, 0.6)
                q0 = pts[-1] - dd * 0.02
                q1 = q0 + tdir * tl * 0.55 + Vector((j.sym(0.03), j.sym(0.03), 0.0))
                q2 = q1 + (tdir + Vector((j.sym(0.4), j.sym(0.4), j.sym(0.2)))).normalized() * tl * 0.45
                m.add(S.tube([q0, q1, q2], radii=[radii[-1] * 0.7, radii[-1] * 0.45, 0.0], segs=3), mat)
            return
        k = splits[min(level, len(splits) - 1)]
        for b in range(k):
            yaw = math.tau * b / k + j.sym(0.6)
            out = Vector((math.cos(yaw), math.sin(yaw), 0)) * spread
            nd = (dd * 0.9 + out * 0.9 + Vector((0, 0, 0.25 - 0.1 * level))).normalized()
            grow(pts[-1] - dd * 0.02, nd, length * j.uniform(0.55, 0.72), radii[-1] * 1.08, level + 1)

    trunk_len = height * 0.36
    grow(Vector((0, 0, 0)), Vector((j.sym(0.1), j.sym(0.1), 1)), trunk_len, trunk_r, 0)
    # burls + a knot hole on the trunk
    for b in range(burls):
        if len(trunk_pts) < 3:
            break
        i = 1 + (b * 7) % (len(trunk_pts) - 2)
        c = trunk_pts[i]
        a = j.uniform(0, math.tau)
        rr = trunk_r * (1 - taper * i / 5) * 0.95
        m.add(S.blob(trunk_r * 0.42, 1, 0.3, 3.0, b, loc=(c.x + math.cos(a) * rr, c.y + math.sin(a) * rr, c.z),
                     scale=(1.0, 1.0, 1.25)), mat)
    # root flare inside the tile
    for k in range(5):
        a = math.tau * k / 5 + j.sym(0.3)
        p1 = Vector((math.cos(a) * root_r, math.sin(a) * root_r, 0.0))
        m.add(S.tube([Vector((0, 0, 0.45)), Vector((math.cos(a) * trunk_r * 1.25, math.sin(a) * trunk_r * 1.25, 0.14)), p1],
                     radii=[trunk_r * 0.7, trunk_r * 0.5, 0.0], segs=5), mat)
    return tips


def fit_height(m: Model, target: float, node: str = None) -> float:
    """Uniformly scale a node's parts about the origin so its top lands at ``target``. Returns the factor."""
    n = m.nodes[node or m.body]
    top = max((v.co.z for bm, _ in n.parts for v in bm.verts), default=0.0)
    if top <= 1e-6:
        return 1.0
    k = target / top
    for bm, _ in n.parts:
        bmesh.ops.scale(bm, vec=(k, k, k), verts=bm.verts)
    return k


def clamp_floor(m: Model, node: str = None, z0: float = 0.0) -> None:
    for bm, _ in m.nodes[node or m.body].parts:
        for v in bm.verts:
            if v.co.z < z0:
                v.co.z = z0


def crow(m: Model, at: Vector, yaw: float, s: float = 1.0, mat: str = 'Crow') -> None:
    body = S.sphere(0.07 * s, 10, 6, scale=(1.4, 0.9, 0.9))
    head = S.sphere(0.045 * s, 8, 6, loc=(0.09 * s, 0, 0.06 * s))
    tail = S.prism([(-0.08 * s, -0.025 * s), (-0.2 * s, -0.05 * s), (-0.2 * s, 0.05 * s), (-0.08 * s, 0.025 * s)],
                   0.012 * s, 0.0, 0, plane='XY')
    beak = S.cone(0.014 * s, 0.05 * s, 5, base=(0.12 * s, 0, 0.055 * s), rot=(0, 90, 0))
    eye = S.sphere(0.009 * s, 5, 3, loc=(0.11 * s, -0.03 * s, 0.075 * s))
    for bm in (body, head, tail, beak, eye):
        S.rotate(bm, (0, -10, yaw))
        S.translate(bm, at + Vector((0, 0, 0.07 * s)))
    m.add(S.merge(body, head, tail), mat)
    m.add(beak, 'Gold')
    m.add(eye, 'Magnet3')
    for sx in (-1, 1):
        leg_ = S.tube([at + Vector((0, sx * 0.02 * s, 0.03 * s)), at + Vector((0.01 * s, sx * 0.02 * s, 0.0))], 0.004, 3)
        m.add(leg_, 'Gold')


@builder('tree_gnarled')
def tree_gnarled(m: Model, spec: Spec) -> None:
    j = m.rng
    tips = branchy_tree(m, j.fork('tree'), 4.5, 0.3, 1.2, 'Bark', levels=4, splits=(3, 2, 2, 2), root_r=0.47,
                        twist=0.3, taper=0.38, twigs=3, burls=3)
    k = fit_height(m, 4.45)
    clamp_floor(m)
    tips = [(p * k, d) for p, d in tips]
    # trim height to the brief (scale the whole crown later if needed) and perch a crow on a mid branch
    best = max(tips, key=lambda t: -abs(t[0].z - 3.1) + 0.2 * t[0].x)
    p, d = best
    crow(m, p - d * 0.25, math.degrees(math.atan2(d.y, d.x)) + 180, 1.2)
    # knot hole with glowing eyes? keep it simple: a dark knot hole facing the front
    m.add(S.sphere(0.06, 8, 6, loc=(0.02, -0.16, 1.1), scale=(0.8, 0.4, 1.2)), 'Black')
