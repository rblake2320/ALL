"""L2 water & nature: pond_murky (7x5, one object, README §10), reeds_cattail, tree_willow."""
from __future__ import annotations

import math
from typing import List, Sequence, Tuple

import bmesh
from mathutils import Vector

from common import shapes as S
from common.model import Model
from objects.decor import crow

from .kit import LevelSpec, add, builder, dome, node, ribbon


def _radial(a: float, phase: float) -> float:
    """Smooth deterministic wobble for organic outlines (sum of low harmonics)."""
    return (1.0 + 0.07 * math.sin(2 * a + phase) + 0.05 * math.sin(3 * a + 1.7 * phase)
            + 0.03 * math.sin(5 * a + 0.4 + phase))


def _outline(rx: float, ry: float, n: int, s: float, phase: float = 0.8, power: float = 2.6) -> List[Tuple[float, float]]:
    pts = []
    for k in range(n):
        a = math.tau * k / n
        c, si = math.cos(a), math.sin(a)
        ex = 2.0 / power
        f = _radial(a, phase) * s
        pts.append((math.copysign(abs(c) ** ex, c) * rx * f, math.copysign(abs(si) ** ex, si) * ry * f))
    return pts


def _strip(rings: Sequence[Sequence[Sequence[float]]]) -> bmesh.types.BMesh:
    """Quad strip through closed rings of equal length (outer -> inner), faces up."""
    bm = bmesh.new()
    vs = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(rings[0])
    for ra, rb in zip(vs, vs[1:]):
        for k in range(n):
            k2 = (k + 1) % n
            f = bm.faces.new((ra[k], ra[k2], rb[k2], rb[k]))
    for f in bm.faces:
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
    return bm


def _disc(pts: Sequence[Tuple[float, float]], z: float) -> bmesh.types.BMesh:
    bm = bmesh.new()
    c = Vector((sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts), z))
    cv = bm.verts.new(c)
    ring = [bm.verts.new((x, y, z)) for x, y in pts]
    n = len(ring)
    for k in range(n):
        bm.faces.new((cv, ring[k], ring[(k + 1) % n]))
    return bm


def _lily(x: float, y: float, z: float, r: float, yaw: float) -> bmesh.types.BMesh:
    n = 10
    notch = 0.55
    pts = [(0.0, 0.0)]
    for k in range(n + 1):
        a = notch / 2 + (math.tau - notch) * k / n
        pts.append((math.cos(a) * r, math.sin(a) * r))
    pad = S.prism(pts, 0.012, 0.0, 0, plane='XY')
    S.rotate(pad, (0, 0, yaw))
    return S.translate(pad, (x, y, z))


# ───────────────────────────── pond_murky ─────────────────────────────

@builder('pond_murky')
def pond_murky(m: Model, spec: LevelSpec) -> None:
    j = m.rng
    N = 36
    RX, RY = 2.75, 1.85
    outer = _outline(RX, RY, N, 1.1)
    lip = _outline(RX, RY, N, 1.02)
    inner = _outline(RX, RY, N, 0.92)
    rings = [[(x, y, 0.0) for x, y in outer], [(x, y, 0.13) for x, y in lip], [(x, y, 0.05) for x, y in inner]]
    add(m, _strip(rings), 'GyMud')
    # grass skirt blending the bank into the lawn
    hx, hy = spec.w / 2 - 0.01, spec.d / 2 - 0.01     # the skirt and the tufts stay on the footprint (W-073)
    fit = lambda x, y: (max(-hx, min(hx, x)), max(-hy, min(hy, y)))  # noqa: E731
    add(m, _strip([[(*fit(x * 1.07, y * 1.07), 0.0) for x, y in outer], [(x, y, 0.03) for x, y in outer]]), 'GyMoss')
    add(m, _disc(_outline(RX, RY, N, 0.93), 0.01), 'PondDeep')
    node(m, 'water', 'water', origin=(0, 0, 0.08), ripple=True)
    add(m, _disc(_outline(RX, RY, N, 0.95), 0.085), 'PondWater', 'water')
    # stones on the bank (bigger at the back, where nobody fishes) — six flat stepping stones mark the fish spots
    for k in range(13):
        a = math.tau * (k + j.uniform(-0.3, 0.3)) / 13
        if math.sin(a) < -0.55:   # keep the front bank open for anglers
            continue
        c, s = math.cos(a), math.sin(a)
        f = _radial(a, 0.8) * 1.03
        r = j.uniform(0.11, 0.2) * (1.3 if s > 0.3 else 1.0)
        add(m, S.blob(r, 1, 0.25, 2.5, k, loc=(c * RX * f, s * RY * f, 0.06), scale=(1.3, 1.0, 0.7), flat_bottom=-0.2),
            'GyStone' if k % 3 else 'GyStoneDark')
    spots = []
    for k, a in enumerate((-2.25, -1.85, -1.35, -0.9, -0.15, 3.3)):
        c, s = math.cos(a), math.sin(a)
        f = _radial(a, 0.8) * 1.08
        x, y = c * RX * f, s * RY * f
        spots.append([round(x, 3), round(-y, 3)])
        add(m, S.cylinder(0.2, 0.06, 10, 0.02, base=(x, y, 0.0)), 'GyStoneWarm')
    m.nodes[m.body].extras['fishSpots'] = spots  # glTF (x, z) of the six bank stones, front-left to right
    # a little plank dock on the front bank
    dx, dy = 0.75, -RY * 0.93
    for k in range(4):
        add(m, S.box(0.2, 1.05, 0.05, 0.008, 1, base=(dx - 0.33 + k * 0.22, dy + 0.35, 0.15),
                     rot=(j.sym(1.5), j.sym(1.5), j.sym(2))), 'Planks')
    for sx in (-1, 1):
        for yy in (-0.12, 0.82):
            add(m, S.cylinder(0.05, 0.3, 8, 0.01, base=(dx + sx * 0.42, dy + yy, 0.0)), 'WoodDark')
    add(m, S.tube([(dx + 0.42, dy + 0.82, 0.29), (dx + 0.5, dy + 0.9, 0.24), (dx + 0.46, dy + 0.98, 0.2)], 0.012, 4), 'Rope')
    # lily pads (+ one bloom), a sunken bench back, a bottle
    pads = ((-1.6, 0.6, 0.32), (-1.2, 0.95, 0.24), (1.8, 0.7, 0.3), (2.15, 0.25, 0.22), (-0.3, -0.6, 0.26),
            (0.9, 1.3, 0.27), (-2.1, -0.4, 0.2))
    for k, (x, y, r) in enumerate(pads):
        add(m, _lily(x, y, 0.09, r, j.uniform(0, 360)), 'LilyPad' if k % 2 else 'LilyPadDark')
    add(m, S.lathe([(0.0, 0.0), (0.06, 0.02), (0.08, 0.06), (0.0, 0.05)], 8, base=(-1.55, 0.55, 0.1)), 'LilyFlower')
    add(m, S.sphere(0.03, 8, 4, loc=(-1.55, 0.55, 0.15)), 'Flower2')
    bench = []
    for k in range(3):
        bench.append(S.box(1.1, 0.05, 0.08, 0.01, 1, base=(0, 0, 0.12 + k * 0.13)))
    bench.append(S.box(0.06, 0.06, 0.55, 0.01, 1, base=(-0.5, 0.02, -0.1)))
    bench.append(S.box(0.06, 0.06, 0.55, 0.01, 1, base=(0.5, 0.02, -0.1)))
    b = S.merge(*bench)
    S.rotate(b, (-22, 8, 24))
    add(m, S.translate(b, (-0.6, 1.25, 0.0)), 'Iron')
    add(m, S.lathe([(0.0, 0.0), (0.035, 0.01), (0.035, 0.1), (0.012, 0.14), (0.012, 0.18), (0.0, 0.18)], 8,
                   base=(0.4, 0.2, 0.06), rot=(70, 0, 30)), 'GlassGrimy')
    # grass tufts on the bank
    for k in range(10):
        a = math.tau * k / 10 + 0.3
        f = _radial(a, 0.8) * 1.12
        tx, ty = fit(math.cos(a) * RX * f, math.sin(a) * RY * f)
        tx = max(-hx + 0.09, min(hx - 0.09, tx))
        add(m, S.grass_tuft(0.07, j.uniform(0.12, 0.22), 4, base=(tx, ty, 0.0),
                            seed=k), ('GyMoss', 'GrassDry', 'Reed')[k % 3])
    # eyes that blink in the dark (hidden by day): two pairs peeking above the water near the willow side
    node(m, 'glow', 'glow', origin=(2.0, -1.0, 0.1), transient=True, blink=True)
    for (ex, ey, s) in ((2.0, -1.05, 1.0), (1.45, -0.55, 0.75)):
        for sx in (-1, 1):
            add(m, S.sphere(0.05 * s, 8, 4, loc=(ex + sx * 0.08 * s, ey, 0.1), scale=(1, 0.8, 0.7)), 'PondEyes', 'glow')
            add(m, S.box(0.012 * s, 0.01, 0.05 * s, 0.0, 0, loc=(ex + sx * 0.08 * s, ey - 0.04 * s, 0.11)), 'Black',
                'glow')


# ───────────────────────────── reeds_cattail ─────────────────────────────

@builder('reeds_cattail')
def reeds_cattail(m: Model, spec: LevelSpec) -> None:
    j = m.rng
    add(m, dome(0.3, 0.26, 0.06, 2, 10, j, power=2.0), 'GyMud')
    node(m, 'sway', 'sway', origin=(0, 0, 0.05), amplitude=4.0)
    for k in range(13):
        a = math.tau * k / 13 + j.sym(0.3)
        r = j.uniform(0.04, 0.24)
        x, y = math.cos(a) * r, math.sin(a) * r
        h = j.uniform(0.7, 1.15)
        lean = j.uniform(0.08, 0.35)
        dx, dy = math.cos(a) * lean, math.sin(a) * lean
        pts = [(x, y, 0.02), (x + dx * 0.15, y + dy * 0.15, h * 0.4), (x + dx * 0.5, y + dy * 0.5, h * 0.78),
               (x + dx, y + dy, h)]
        side = (-math.sin(a), math.cos(a), 0)
        add(m, ribbon(pts, (0.05, 0.045, 0.03, 0.0), side), 'Reed' if k % 3 else 'ReedDry', 'sway')
    for k in range(5):
        a = math.tau * k / 5 + 0.5
        r = j.uniform(0.05, 0.16)
        x, y = math.cos(a) * r, math.sin(a) * r
        h = j.uniform(0.95, 1.18)
        tx, ty = x + j.sym(0.08), y + j.sym(0.08)
        add(m, S.tube([(x, y, 0.02), ((x + tx) / 2, (y + ty) / 2, h * 0.5), (tx, ty, h)], 0.009, 4), 'Reed', 'sway')
        add(m, S.cylinder(0.028, 0.15, 6, 0.0, base=(tx, ty, h - 0.2)), 'Cattail', 'sway')
        add(m, S.cone(0.006, 0.06, 4, base=(tx, ty, h - 0.05)), 'Reed', 'sway')


# ───────────────────────────── tree_willow ─────────────────────────────

@builder('tree_willow')
def tree_willow(m: Model, spec: LevelSpec) -> None:
    """Weeping willow: knotted leaning trunk, four arching limbs, curtains of drooping fronds (double-sided strips,
    two greens), a crow perched on the left limb. Fronds live in 'sway' (runtime wind)."""
    j = m.rng
    trunk = [Vector((0, 0, 0)), Vector((0.05, 0.02, 0.6)), Vector((0.02, 0.06, 1.3)), Vector((0.1, 0.04, 2.0)),
             Vector((0.08, 0.02, 2.5))]
    add(m, S.tube(trunk, radii=[0.34, 0.27, 0.24, 0.22, 0.18], segs=10), 'Bark')
    for k in range(5):  # root flare
        a = math.tau * k / 5 + 0.4
        add(m, S.tube([(0, 0, 0.45), (math.cos(a) * 0.3, math.sin(a) * 0.3, 0.12), (math.cos(a) * 0.6, math.sin(a) * 0.6, 0)],
                      radii=[0.2, 0.13, 0.0], segs=5), 'Bark')
    for k, (z, a) in enumerate(((0.9, 0.3), (1.6, 2.6))):  # burls
        add(m, S.blob(0.12, 1, 0.3, 3.0, k, loc=(math.cos(a) * 0.22, math.sin(a) * 0.22, z)), 'BarkLight')
    add(m, S.sphere(0.08, 8, 6, loc=(0.0, -0.24, 1.15), scale=(0.8, 0.4, 1.2)), 'Black')
    limbs = []
    for k in range(4):
        a = math.tau * k / 4 + 0.6
        c, s = math.cos(a), math.sin(a)
        p = [Vector((0.08, 0.02, 2.4)), Vector((c * 0.45, s * 0.45, 3.4)), Vector((c * 0.95, s * 0.95, 3.95)),
             Vector((c * 1.25, s * 1.25, 3.8))]
        add(m, S.tube(p, radii=[0.15, 0.1, 0.06, 0.02], segs=6), 'Bark')
        limbs.append(p)
    node(m, 'sway', 'sway', origin=(0, 0, 3.6), amplitude=3.0)
    # crown: lumpy leaf masses so the canopy reads solid from the iso camera
    for k, (x, y, z, r) in enumerate(((0.0, 0.0, 4.0, 0.85), (0.5, 0.3, 3.75, 0.6), (-0.45, 0.35, 3.8, 0.6),
                                      (0.1, -0.5, 3.75, 0.6))):
        add(m, S.blob(r, 2, 0.22, 2.2, 3 + k, loc=(x, y, z), scale=(1.0, 1.0, 0.7)), 'WillowDark', 'sway')
    # fronds fountain out of the crown and weep down in curtains (3 layers, longest outside)
    for layer, (n, r0, top, mat, lo, hi) in enumerate(((34, 0.85, 4.35, 'Willow', 2.2, 3.0),
                                                       (26, 0.55, 4.5, 'Willow', 1.6, 2.4),
                                                       (22, 1.05, 4.0, 'WillowDark', 1.4, 2.1))):
        for k in range(n):
            a = math.tau * (k + 0.37 * layer) / n + j.sym(0.06)
            c, si = math.cos(a), math.sin(a)
            r = r0 + j.sym(0.08)
            z0 = top + j.sym(0.1) - 0.25 * (r0 - 0.5)
            L = j.uniform(lo, hi)
            out = min(1.0, (spec.w / 2 - r0 - 0.08) / 0.67)   # how far this layer may fountain outwards (W-073: stay on the 3 x 3)
            pts = [(c * r, si * r, z0),
                   (c * (r + 0.32 * out), si * (r + 0.32 * out), z0 + 0.05),
                   (c * (r + 0.52 * out), si * (r + 0.52 * out), z0 - L * 0.3),
                   (c * (r + 0.6 * out), si * (r + 0.6 * out), z0 - L * 0.65),
                   (c * (r + (0.62 + j.sym(0.05)) * out), si * (r + (0.62 + j.sym(0.05)) * out), z0 - L)]
            add(m, ribbon(pts, (0.16, 0.18, 0.15, 0.11, 0.02), (-si, c, 0)), mat, 'sway')
    # crow on the left limb (stray crow perch, §4.4)
    p = limbs[1][2]
    crow(m, Vector((p.x, p.y, p.z + 0.03)), -60, 1.3)
