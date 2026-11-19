"""L4 Bayou environment models (docs/levels/L4-bayou.md §12): the swamp-boat hearse that does the carpool, two
stilt houses for neighbour dressing, and a three-tree cypress cluster. Blender front = -Y, Z up, base at z = 0,
sizes in metres (env models have no tile footprint)."""
from __future__ import annotations

import math

from mathutils import Vector

from common import shapes as S
from common.model import Model

from . import l4_home  # noqa: F401  (the Bayou palette)
from .kit import add, builder, node
from .spec import LevelSpec


# ─────────────────────────────────────────── shared pieces ───────────────────────────────────────────

def gable_roof(m: Model, cx: float, cy: float, z: float, half_w: float, depth: float, pitch: float, over: float,
               look: str = 'Rust') -> float:
    """Two tin slabs over a box whose wall tops are at z; returns the ridge height."""
    t = math.tan(math.radians(pitch))
    ridge = z + half_w * t
    run = half_w + over
    length = run / math.cos(math.radians(pitch))
    for sx in (-1, 1):
        add(m, S.box(length, depth, 0.05, 0.0, 0, loc=(cx + sx * run / 2, cy, ridge - run * t / 2 + 0.03), rot=(0, sx * pitch, 0)), look)
        for k in range(1, 5):                                                                         # tin seams
            x = sx * run * k / 5
            add(m, S.box(0.03, depth, 0.02, 0.0, 0, loc=(cx + x, cy, ridge - abs(x) * t + 0.075), rot=(0, sx * pitch, 0)), 'IronOld')
    add(m, S.tube([(cx, cy - depth / 2, ridge + 0.06), (cx, cy + depth / 2, ridge + 0.06)], 0.05, 5), 'IronOld')   # ridge cap
    return ridge


def pilings(m: Model, xs, ys, h: float, r: float = 0.11) -> None:
    j = m.rng
    for x in xs:
        for y in ys:
            add(m, S.cylinder(r, h, 7, 0.0, r_top=r * 0.85, base=(x, y, 0.0), rot=(j.sym(2.5), j.sym(2.5), 0)), 'ByBark')
    for x in xs:                                                                                      # cross braces
        add(m, S.box(0.05, ys[-1] - ys[0], 0.12, 0.0, 0, loc=(x, (ys[0] + ys[-1]) / 2, h * 0.55), rot=(18, 0, 0)), 'ByPlankDark')


def window(m: Model, x: float, y: float, z: float, w: float, h: float, facing_x: bool, shut: bool) -> None:
    """A dark window with a crooked shutter. facing_x: on a wall that faces +/-X, else on one that faces +/-Y."""
    dim = (0.03, w, h) if facing_x else (w, 0.03, h)
    add(m, S.box(*dim, 0.0, 0, loc=(x, y, z)), 'WindowDark')
    frame = (0.05, w + 0.12, 0.07) if facing_x else (w + 0.12, 0.05, 0.07)
    add(m, S.box(*frame, 0.0, 0, loc=(x, y, z - h / 2 - 0.03)), 'ByPlankDark')
    off = w / 2 + 0.17
    sdim = (0.03, 0.28, h + 0.06) if facing_x else (0.28, 0.03, h + 0.06)
    rot = (7 if shut else 0, 0, 0) if facing_x else (0, 7 if shut else 0, 0)
    pos = (x, y + off, z) if facing_x else (x + off, y, z)
    add(m, S.box(*sdim, 0.0, 0, loc=pos, rot=rot), 'ByCypress')


def ladder(m: Model, x: float, y0: float, y1: float, h: float, w: float = 0.6) -> None:
    for sx in (-1, 1):
        add(m, S.tube([(x + sx * w / 2, y0, 0.0), (x + sx * w / 2, y1, h + 0.5)], 0.035, 4), 'ByPlankDark')
    n = max(3, int(h / 0.32))
    for k in range(1, n + 1):
        t = k / (n + 1)
        add(m, S.box(w + 0.06, 0.05, 0.04, 0.0, 0, loc=(x, y0 + (y1 - y0) * t * h / (h + 0.5), h * t)), 'ByPlank')


def rail(m: Model, pts, z: float, look: str = 'ByPlankDark') -> None:
    """Posts at each point and two rails between consecutive points."""
    for (x, y) in pts:
        add(m, S.box(0.08, 0.08, 0.95, 0.0, 0, base=(x, y, z)), look)
    for (a, b) in zip(pts, pts[1:]):
        for dz in (0.45, 0.92):
            add(m, S.tube([(a[0], a[1], z + dz), (b[0], b[1], z + dz)], 0.03, 4, scale_xy=(1.0, 1.6)), 'ByPlank')


def cypress(m: Model, ox: float, oy: float, h: float, limbs: int, seed: int, spread: float = 1.0) -> None:
    """A bald cypress: flared, fluted buttress, knees, limbs with flat foliage pads and moss curtains."""
    j = m.rng
    k = h / 7.0
    prof = [(0.80 * k, 0.0), (0.62 * k, 0.25 * k), (0.42 * k, 0.7 * k), (0.30 * k, 1.4 * k), (0.25 * k, 2.6 * k),
            (0.21 * k, 4.0 * k), (0.15 * k, 5.2 * k), (0.08 * k, 6.2 * k)]
    trunk = S.lathe(prof, 14, cap_bottom=True)
    S.displace(trunk, lambda v: Vector((v.x * (1 + 0.16 * math.sin(math.atan2(v.y, v.x) * 7) * max(0.0, 1 - v.z / (1.4 * k))),
                                        v.y * (1 + 0.16 * math.sin(math.atan2(v.y, v.x) * 7) * max(0.0, 1 - v.z / (1.4 * k))), v.z)))
    add(m, S.translate(trunk, (ox, oy, 0.0)), 'ByBark')
    for i in range(5):                                                                                # knees
        a = math.tau * i / 5 + j.sym(0.4)
        r = j.uniform(0.75, 1.15) * k
        add(m, S.cone(j.uniform(0.07, 0.11) * k, j.uniform(0.25, 0.5) * k, 6, base=(ox + math.cos(a) * r, oy + math.sin(a) * r, 0.0)), 'ByBark')
    for n in range(limbs):
        a = 2.4 * n + seed * 0.7
        z = (2.8 + 2.9 * n / limbs) * k
        ln = (1.25 - 0.55 * n / limbs) * k * spread
        up = 0.45 * k
        c, s = math.cos(a), math.sin(a)
        tip = (ox + c * ln, oy + s * ln, z + up)
        add(m, S.tube([(ox + c * 0.14 * k, oy + s * 0.14 * k, z), (ox + c * ln * 0.6, oy + s * ln * 0.6, z + up * 0.5), tip], 0.07 * k, 5,
                      radii=[0.09 * k, 0.06 * k, 0.03 * k]), 'ByBark')
        add(m, S.blob(0.50 * k, 2, 0.24, 2.0, seed=seed * 20 + n, loc=(tip[0], tip[1], tip[2] + 0.12), scale=(1.3, 1.3, 0.55)),
            'ByCypress' if n % 2 == 0 else 'ByCypressLight')
        add(m, S.blob(0.36 * k, 2, 0.26, 2.2, seed=seed * 20 + 10 + n, loc=(ox + c * ln * 0.5, oy + s * ln * 0.5, z + up * 0.5 + 0.2),
                      scale=(1.25, 1.25, 0.5)), 'ByCypressLight' if n % 2 == 0 else 'ByCypress')
        for q in range(3):                                                                            # Spanish moss
            f = 0.45 + 0.25 * q
            ln2 = j.uniform(0.7, 1.5) * k
            card = S.slab(0.30 * k, 0.010, ln2, 2, 1, base=(0, 0, 0))
            S.displace(card, lambda v, ln2=ln2: Vector((v.x * (1.0 - 0.6 * (v.z / ln2)), v.y, v.z)))
            S.rotate(card, (180, 0, math.degrees(a) + 90 + 25 * (q - 1)))
            add(m, S.translate(card, (ox + c * ln * f, oy + s * ln * f, z + up * f - 0.03)), 'BySpanishMoss')
    add(m, S.blob(0.62 * k, 2, 0.2, 1.8, seed=seed, loc=(ox, oy, 6.35 * k), scale=(1.2, 1.2, 0.95)), 'ByCypressLight')


# ─────────────────────────────────────────── models ───────────────────────────────────────────

@builder('env_cypressGroup')
def env_cypress_group(m: Model, spec: LevelSpec) -> None:
    cypress(m, -1.7, 0.7, 8.6, 6, seed=1, spread=1.25)
    cypress(m, 1.5, 1.0, 7.2, 6, seed=2, spread=1.15)
    cypress(m, 0.5, -1.6, 6.0, 5, seed=3, spread=1.2)
    add(m, S.cylinder(3.0, 0.02, 12, 0.0, base=(0.1, 0.1, 0.0)), 'ByMud')                             # the shared hummock
    add(m, S.blob(0.5, 1, 0.25, 2.0, seed=9, loc=(-0.3, -0.4, 0.05), scale=(2.2, 1.6, 0.25)), 'Moss')


@builder('env_stiltHouse_a')
def env_stilt_house_a(m: Model, spec: LevelSpec) -> None:
    """The tidy one: a plank cabin with a tin gable roof, a front porch and a ladder."""
    dz = 1.7
    pilings(m, (-2.3, 0.0, 2.3), (-2.0, 0.0, 2.0), dz)
    add(m, S.box(5.0, 4.4, 0.12, 0.0, 0, base=(0, 0, dz)), 'ByPlank')                                 # deck
    add(m, S.box(5.04, 0.06, 0.20, 0.0, 0, loc=(0, -2.2, dz - 0.02)), 'ByPlankDark')
    z0 = dz + 0.12
    cy, W, D, H = 0.65, 3.6, 2.8, 2.3
    add(m, S.box(W, D, H, 0.0, 0, base=(0, cy, z0)), 'ByPlank')                                       # cabin
    for k in range(9):                                                                                # battens on the front
        add(m, S.box(0.04, 0.03, H, 0.0, 0, base=(-W / 2 + 0.2 + 0.4 * k, cy - D / 2 - 0.012, z0)), 'ByPlankDark')
    for sx in (-1, 1):
        add(m, S.taper_box(0.06, D, 0.06, D, H, 0.0, 0, base=(sx * (W / 2 + 0.01), cy, z0)), 'ByPlankDark')   # corner boards
    ridge = gable_roof(m, 0.0, cy, z0 + H, W / 2, D + 0.7, 28, 0.4)
    for sy in (-1, 1):                                                                                # gable ends
        add(m, S.taper_box(W, 0.05, 0.05, 0.05, ridge - z0 - H, 0.0, 0, base=(0, cy + sy * D / 2, z0 + H)), 'ByPlankDark')
    fy = cy - D / 2
    add(m, S.box(0.86, 0.05, 1.95, 0.0, 0, base=(-0.5, fy - 0.02, z0)), 'ByCypress')                  # door
    add(m, S.sphere(0.04, 6, 4, loc=(-0.2, fy - 0.06, z0 + 0.95)), 'Brass')
    window(m, 0.95, fy - 0.01, z0 + 1.3, 0.7, 0.8, False, True)
    window(m, W / 2 + 0.01, cy + 0.2, z0 + 1.3, 0.8, 0.8, True, False)
    window(m, -W / 2 - 0.01, cy - 0.3, z0 + 1.3, 0.8, 0.8, True, True)
    add(m, S.tube([(1.1, cy + 0.6, z0 + H + 0.2), (1.1, cy + 0.6, ridge + 0.7), (1.25, cy + 0.6, ridge + 0.95)], 0.08, 6), 'IronOld')   # stovepipe
    add(m, S.cone(0.16, 0.14, 6, base=(1.25, cy + 0.6, ridge + 0.95)), 'IronOld')
    # porch: rail around the front, a gap for the ladder, a lantern by the door, a net drying
    rail(m, [(-2.42, fy), (-2.42, -2.12), (-1.5, -2.12)], z0)
    rail(m, [(-0.6, -2.12), (2.42, -2.12), (2.42, fy)], z0)
    ladder(m, -1.05, -2.75, -2.2, z0)
    add(m, S.tube([(0.1, fy - 0.03, z0 + 2.05), (0.1, fy - 0.32, z0 + 2.1), (0.1, fy - 0.32, z0 + 1.95)], 0.012, 4), 'IronOld')
    node(m, 'glow', 'glow', origin=(0.1, fy - 0.32, z0 + 1.85), transient=True)
    add(m, S.box(0.13, 0.13, 0.18, 0.02, 1, loc=(0.1, fy - 0.32, z0 + 1.85)), 'Lantern', 'glow')
    net = S.slab(1.3, 0.012, 0.8, 4, 2, base=(0, 0, 0))
    S.displace(net, lambda v: Vector((v.x, v.y + 0.06 * math.sin(v.x * 5), v.z - 0.10 * math.cos(v.x * 2.4))))
    add(m, S.translate(net, (1.55, -2.16, z0 + 0.25)), 'ByNet')
    add(m, S.cylinder(0.28, 0.75, 8, 0.0, base=(1.95, fy - 0.45, z0)), 'ByPlankDark')                 # rain barrel
    for z in (0.15, 0.55):
        add(m, S.torus(0.285, 0.015, 8, 3, loc=(1.95, fy - 0.45, z0 + z)), 'IronOld')
    add(m, S.box(1.2, 0.4, 0.05, 0.0, 0, loc=(-1.6, 2.0, dz - 1.1), rot=(0, 4, 0)), 'ByPlank')        # a plank someone forgot under the house


@builder('env_stiltHouse_b')
def env_stilt_house_b(m: Model, spec: LevelSpec) -> None:
    """The leaning one: taller stilts, a shed roof, a side walkway down to a small dock, laundry on a line."""
    dz = 2.3
    pilings(m, (-1.9, 1.9), (-1.7, 0.0, 1.7), dz, r=0.12)
    add(m, S.box(4.2, 3.9, 0.12, 0.0, 0, base=(0, 0, dz)), 'ByPlank')
    z0 = dz + 0.12
    cy, W, D = 0.35, 3.2, 2.9
    hf, hb = 2.5, 1.9                                                                                 # front and back wall heights
    body = S.box(W, D, hf, 0.0, 0, base=(0, 0, 0))
    S.displace(body, lambda v: Vector((v.x + 0.05 * v.z, v.y, v.z if v.z < 0.1 else (hf if v.y < 0 else hb))))   # lean + shed slope
    add(m, S.translate(body, (0, cy, z0)), 'ByPlankDark')
    pitch = math.degrees(math.atan2(hf - hb, D))
    roof = S.box(W + 0.7, (D + 0.8) / math.cos(math.radians(pitch)), 0.06, 0.0, 0, loc=(0, 0, 0))
    S.rotate(roof, (-pitch, 0, 0))
    add(m, S.translate(roof, (0.05 * (hf + hb) / 2, cy, z0 + (hf + hb) / 2 + 0.05)), 'Rust')
    for k in range(6):                                                                                # patches of newer tin
        if k % 2:
            p = S.box(0.55, 0.9, 0.02, 0.0, 0, loc=(0, 0, 0))
            S.rotate(p, (-pitch, 0, 0))
            add(m, S.translate(p, (-1.3 + 0.5 * k, cy - 0.6 + 0.35 * k, z0 + (hf + hb) / 2 + 0.105 + (0.6 - 0.35 * k) * math.tan(math.radians(pitch)))), 'Tin')
    fy = cy - D / 2
    add(m, S.box(0.8, 0.05, 1.9, 0.0, 0, base=(0.55, fy - 0.02, z0), rot=(0, 2, 0)), 'ByPlank')       # door, off its top hinge
    window(m, -0.75, fy - 0.01, z0 + 1.35, 0.7, 0.7, False, True)
    window(m, W / 2 + 0.09, cy, z0 + 1.2, 0.8, 0.7, True, False)
    for k in range(7):
        add(m, S.box(0.035, 0.03, hf - 0.1, 0.0, 0, base=(-W / 2 + 0.25 + 0.45 * k, fy - 0.012, z0)), 'ByBark')
    # walkway along the left side, stepping down to a dock at water level
    add(m, S.box(1.0, 3.9, 0.10, 0.0, 0, base=(-2.6, 0, dz + 0.01)), 'ByPlank')
    for y in (-1.7, 1.7):
        add(m, S.cylinder(0.09, dz, 6, 0.0, base=(-3.0, y, 0.0)), 'ByBark')
    for k in range(6):                                                                                # stairs down toward the front
        add(m, S.box(0.9, 0.30, 0.05, 0.0, 0, base=(-2.6, -2.1 - 0.30 * k, dz - 0.33 * (k + 1))), 'ByPlank')
    for sx in (-1, 1):
        add(m, S.tube([(-2.6 + sx * 0.47, -1.95, dz + 0.9), (-2.6 + sx * 0.47, -3.85, 0.35 + 0.9)], 0.03, 4), 'ByPlankDark')
        add(m, S.tube([(-2.6 + sx * 0.47, -1.95, dz), (-2.6 + sx * 0.47, -3.85, 0.30)], 0.045, 4), 'ByPlankDark')
    add(m, S.box(2.4, 1.3, 0.10, 0.0, 0, base=(-2.1, -4.4, 0.22)), 'ByPlank')                         # dock
    for (x, y) in ((-3.2, -4.95), (-1.0, -4.95), (-3.2, -3.85), (-1.0, -3.85)):
        add(m, S.cylinder(0.08, 0.75, 6, 0.0, base=(x, y, 0.0)), 'ByBark')
    rail(m, [(-3.05, 1.85), (-3.05, -1.85)], dz + 0.1)
    rail(m, [(-2.0, -1.87), (2.0, -1.87), (2.0, fy)], z0)
    # laundry line from the cabin corner to a pole, a crab trap stack, a stovepipe through the wall
    pole_top = (2.0, -1.87, z0 + 2.3)
    add(m, S.tube([(2.0, -1.87, z0), pole_top], 0.035, 4), 'ByBark')
    add(m, S.tube([(W / 2 - 0.2, fy, z0 + 2.2), (1.8, -1.2, z0 + 2.05), pole_top], 0.008, 3), 'Rope')
    for k, look in enumerate(('GhostSheet', 'CurtainPurple', 'ByVinylPatch')):
        t = 0.25 + 0.25 * k
        x, y = W / 2 - 0.2 + (2.0 - W / 2 + 0.2) * t, fy + (-1.87 - fy) * t
        cloth = S.slab(0.42, 0.012, 0.5 + 0.1 * (k % 2), 2, 2, base=(0, 0, 0))
        S.rotate(cloth, (180, 0, math.degrees(math.atan2(-1.87 - fy, 2.0 - W / 2 + 0.2))))
        add(m, S.translate(cloth, (x, y, z0 + 2.10)), look)
    for k in range(3):
        add(m, S.box(0.6, 0.45, 0.28, 0.0, 0, base=(-1.3 + 0.04 * k, -1.35, z0 + 0.29 * k), rot=(0, 0, 6 * k)), 'ByNet')
    add(m, S.tube([(-0.6, cy + D / 2, z0 + 1.2), (-0.6, cy + D / 2 + 0.35, z0 + 1.3), (-0.6, cy + D / 2 + 0.35, z0 + 2.9)], 0.08, 6), 'IronOld')
    node(m, 'glow', 'glow', origin=(-0.2, fy - 0.2, z0 + 2.0), transient=True)
    add(m, S.box(0.13, 0.13, 0.18, 0.02, 1, loc=(-0.2, fy - 0.2, z0 + 2.0)), 'Lantern', 'glow')
    add(m, S.tube([(-0.2, fy - 0.02, z0 + 2.2), (-0.2, fy - 0.2, z0 + 2.22), (-0.2, fy - 0.2, z0 + 2.1)], 0.012, 4), 'IronOld')


@builder('env_hearseBoat')
def env_hearse_boat(m: Model, spec: LevelSpec) -> None:
    """A flat-bottomed swamp boat with a hearse cabin amidships, a coffin deck, and an airboat fan at the stern."""
    hull = [(1.0, 2.6), (-1.0, 2.6), (-1.0, -1.2), (-0.72, -2.0), (0.0, -2.7), (0.72, -2.0), (1.0, -1.2)]
    inner = S.offset_outline(hull, 0.07)
    add(m, S.prism(hull, 0.12, 0.0, 0, plane='XY'), 'HearseBlack')                                    # flat bottom
    add(m, S.outline_ring(hull, inner, 0.0, 0.58, 0.012, 1), 'HearsePaint')                           # sides
    deck = S.prism(inner, 0.04, 0.0, 0, plane='XY')
    add(m, S.translate(deck, (0, 0, 0.30)), 'ByPlankDark')
    add(m, S.outline_ring(S.offset_outline(hull, -0.03), S.offset_outline(hull, 0.03), 0.56, 0.62, 0.0, 0), 'Chrome')   # gunwale trim
    # the hearse cabin
    cw, cl, cz, ch = 1.56, 2.3, 0.34, 1.05
    cy = -0.35
    add(m, S.box(cw, cl, ch, 0.05, 2, base=(0, cy, cz)), 'HearsePaint')
    add(m, S.taper_box(cw + 0.06, cl + 0.06, cw - 0.25, cl - 0.3, 0.14, 0.03, 1, base=(0, cy, cz + ch)), 'HearseBlack')   # roof
    for sx in (-1, 1):
        x = sx * (cw / 2 + 0.005)
        for (y0, y1) in ((-1.25, -0.55), (-0.40, 0.55)):
            add(m, S.box(0.03, y1 - y0, 0.46, 0.0, 0, loc=(x, (y0 + y1) / 2, cz + 0.70)), 'WindowDark')
        for (ya, yb) in ((-0.37, 0.03), (0.12, 0.52)):                                                # gathered curtains
            add(m, S.box(0.02, yb - ya, 0.42, 0.0, 0, loc=(x + sx * 0.018, (ya + yb) / 2, cz + 0.70)), 'HearseCurtain')
        bar = S.catmull([(x + sx * 0.03, 0.62, cz + 0.55), (x + sx * 0.03, 0.72, cz + 0.85), (x + sx * 0.03, 0.62, cz + 0.72), (x + sx * 0.03, 0.74, cz + 0.98)], 3)
        add(m, S.tube(bar, 0.02, 5), 'Chrome')                                                        # landau bar
        add(m, S.box(0.02, cl - 0.2, 0.04, 0.0, 0, loc=(x + sx * 0.004, cy, cz + 0.40)), 'Chrome')
    ws = S.box(cw - 0.3, 0.03, 0.50, 0.0, 0, loc=(0, 0, 0))
    S.rotate(ws, (-20, 0, 0))
    add(m, S.translate(ws, (0, cy - cl / 2 - 0.01, cz + 0.70)), 'WindowDark')                         # windscreen
    add(m, S.box(0.5, 0.03, 0.75, 0.0, 0, loc=(0, cy + cl / 2 + 0.012, cz + 0.52)), 'HearseBlack')    # rear door
    add(m, S.box(0.04, 0.03, 0.12, 0.0, 0, loc=(0.18, cy + cl / 2 + 0.03, cz + 0.55)), 'Chrome')
    # bow: wreath, lanterns, a mooring cleat and a coil of rope
    add(m, S.torus(0.20, 0.055, 12, 5, loc=(0, -1.72, 0.80), rot=(70, 0, 0)), 'Hedge')
    for k in range(5):
        a = math.tau * k / 5
        add(m, S.sphere(0.04, 6, 4, loc=(math.cos(a) * 0.20, -1.72 - 0.07 * math.sin(a), 0.80 + math.sin(a) * 0.19)), 'BloodWine')
    node(m, 'glow', 'glow', origin=(0, -2.2, 0.9), transient=True)
    for sx in (-1, 1):
        add(m, S.tube([(sx * 0.62, -1.9, 0.58), (sx * 0.62, -1.9, 1.02)], 0.018, 4), 'IronOld')
        add(m, S.box(0.13, 0.13, 0.18, 0.02, 1, loc=(sx * 0.62, -1.9, 1.12)), 'Lantern', 'glow')
        add(m, S.cone(0.10, 0.07, 4, base=(sx * 0.62, -1.9, 1.21)), 'IronOld')
    add(m, S.box(0.22, 0.05, 0.05, 0.0, 0, loc=(0, -2.35, 0.64)), 'Chrome')
    for k in range(3):
        add(m, S.torus(0.16 - 0.01 * k, 0.022, 8, 3, loc=(-0.45, -1.45, 0.36 + 0.04 * k)), 'Rope')
    # coffin deck between the cabin and the fan, with a strapped-down coffin
    add(m, S.box(0.56, 1.25, 0.28, 0.03, 1, base=(-0.05, 1.20, 0.34), rot=(0, 0, 4)), 'WoodEbony')
    add(m, S.box(0.60, 0.06, 0.30, 0.0, 0, base=(-0.05, 1.05, 0.34), rot=(0, 0, 4)), 'Brass')
    add(m, S.box(0.60, 0.06, 0.30, 0.0, 0, base=(-0.05, 1.40, 0.34), rot=(0, 0, 4)), 'Brass')
    # stern: engine, fan cage, blades, rudders and the driver's high seat
    fy, fz, fr = 2.25, 1.45, 0.82
    add(m, S.box(0.55, 0.6, 0.45, 0.03, 1, base=(0, fy - 0.45, 0.34)), 'IronOld')                     # engine
    add(m, S.tube([(0.2, fy - 0.5, 0.75), (0.34, fy - 0.5, 1.15), (0.34, fy - 0.9, 1.2)], 0.035, 5), 'Rust')
    add(m, S.tube([(0, fy - 0.35, 0.78), (0, fy - 0.2, fz)], 0.05, 5), 'IronOld')
    for dy in (-0.14, 0.0, 0.14):
        add(m, S.torus(fr, 0.022, 16, 3, loc=(0, fy + dy, fz), rot=(90, 0, 0)), 'Galvanised')
    for k in range(8):
        a = math.tau * k / 8
        add(m, S.tube([(0.08 * math.cos(a), fy - 0.15, fz + 0.08 * math.sin(a)), (fr * math.cos(a), fy - 0.14, fz + fr * math.sin(a)),
                       (fr * math.cos(a), fy + 0.14, fz + fr * math.sin(a))], 0.012, 3), 'Galvanised')
    for k in range(4):                                                                                # blades
        a = 20 + 90 * k
        add(m, S.box(0.20, 0.03, fr * 1.75 / 2, 0.0, 0, base=(0, fy, fz), rot=(0, a, 0)), 'WoodLight')
    add(m, S.cylinder(0.09, 0.12, 8, 0.0, base=(0, fy - 0.06, fz), rot=(-90, 0, 0)), 'Chrome')
    for sx in (-1, 1):
        add(m, S.box(0.03, 0.5, 1.1, 0.0, 0, base=(sx * 0.45, fy + 0.5, 0.75)), 'HearsePaint')        # rudders
        add(m, S.tube([(sx * 0.45, fy + 0.3, 0.60), (sx * 0.45, fy + 0.3, 0.80)], 0.03, 4), 'IronOld')
    seat_z = 1.55
    for sx in (-1, 1):
        add(m, S.tube([(sx * 0.42, 1.55, 0.34), (sx * 0.25, 1.75, seat_z)], 0.03, 4), 'IronOld')
        add(m, S.tube([(sx * 0.42, 2.0, 0.34), (sx * 0.25, 1.85, seat_z)], 0.03, 4), 'IronOld')
    add(m, S.box(0.6, 0.5, 0.10, 0.03, 1, base=(0, 1.80, seat_z)), 'HearseCurtain')
    add(m, S.box(0.6, 0.08, 0.5, 0.03, 1, base=(0, 2.02, seat_z + 0.08)), 'HearseCurtain')
    add(m, S.tube([(0.36, 1.62, seat_z + 0.05), (0.36, 1.50, seat_z + 0.6)], 0.018, 4), 'Chrome')     # steering stick
    add(m, S.sphere(0.04, 6, 4, loc=(0.36, 1.50, seat_z + 0.62)), 'Bone')
