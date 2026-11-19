"""Hobbies & skills: bone chess table, moldering bookshelf, morbid easel, limb gym, tombstone arcade."""
from __future__ import annotations

import math

from common import dims
from common import shapes as S
from common.catalog import Spec
from common.model import Model

from .electronics import screen_surface
from .parts import add_broken, books_row, cobweb, leg, mold_blotch, turned_leg
from .registry import builder

SH = dims.SEAT_HEIGHT


def _stool(m: Model, x: float, y: float, top: float = SH) -> None:
    """Round stool: puffy dark cushion on a thick wooden seat, three splayed femur legs and a bone ring stretcher."""
    m.add(S.cushion(0.36, 0.36, 0.08, sag=0.01, roundness=0.45, loc=(x, y, top - 0.04), segs=12, rings=6), 'CushionDark')
    m.add(S.cylinder(0.17, 0.045, 14, 0.012, base=(x, y, top - 0.1)))
    for k in range(3):
        a = math.tau * k / 3 + 0.4
        lx, ly = x + math.cos(a) * 0.11, y + math.sin(a) * 0.11
        prof = [(0.03, 0.0), (0.034, 0.02), (0.021, 0.06), (0.018, (top - 0.1) * 0.5), (0.022, top - 0.14),
                (0.03, top - 0.1)]
        lg = S.lathe(prof, 8)
        S.rotate(lg, (math.sin(a) * 9.0, -math.cos(a) * 9.0, 0))
        m.add(S.translate(lg, (lx, ly, 0)), 'Bone')
    m.add(S.torus(0.13, 0.011, 14, 4, loc=(x, y, 0.16)), 'Bone')


def _pawn(h: float):
    return S.lathe([(0.024, 0), (0.026, 0.008), (0.014, 0.018), (0.01, h * 0.6), (0.018, h * 0.72), (0.0, h)], 8)


def _king(h: float):
    body = S.lathe([(0.028, 0), (0.03, 0.01), (0.016, 0.022), (0.013, h * 0.55), (0.021, h * 0.62), (0.0, h * 0.66)], 8)
    sk, so = S.skull(0.019, loc=(0, 0, h * 0.82), segs=6, jaw=False)
    return S.merge(body, sk), so


@builder('table_bonechess')
def table_bonechess(m: Model, spec: Spec) -> None:
    """Chess for two: a square board table in the middle tile on a pedestal of stacked vertebrae with clawed bone
    feet, bone-vs-charcoal pieces mid-game (skull kings), a captured knucklebone, and a round bone-legged stool on
    each side tile (stool tops at SEAT_HEIGHT)."""
    j = m.rng
    board_top = 0.72
    m.add(S.box(0.66, 0.66, 0.05, 0.016, 2, base=(0, 0, board_top - 0.07)))
    m.add(S.box(0.56, 0.56, 0.06, 0.01, 1, base=(0, 0, board_top - 0.12)), 'WoodDark')
    # vertebrae pedestal
    zc = 0.1
    k = 0
    while zc < board_top - 0.16:
        r = 0.075 - 0.01 * (k % 2)
        m.add(S.superellipsoid(r, r * 0.85, 0.035, 0.5, 0.6, 10, 4, loc=(0, 0, zc + 0.035), rot=(0, 0, j.sym(8))), 'Bone')
        m.add(S.cone(0.022, 0.06, 4, base=(0, r * 0.7, zc + 0.03), rot=(-75, 0, 0)), 'Bone')
        zc += 0.075
        k += 1
    m.add(S.cylinder(0.13, 0.05, 12, 0.012, base=(0, 0, board_top - 0.17)), 'WoodDark')
    for q in range(4):
        a = math.tau * q / 4 + math.pi / 4
        m.add(S.tube([(math.cos(a) * 0.05, math.sin(a) * 0.05, 0.12), (math.cos(a) * 0.17, math.sin(a) * 0.17, 0.07),
                      (math.cos(a) * 0.25, math.sin(a) * 0.25, 0.025)], radii=[0.035, 0.03, 0.025], segs=6), 'Bone')
        m.add(S.sphere(0.035, 8, 5, loc=(math.cos(a) * 0.26, math.sin(a) * 0.26, 0.028), scale=(1.2, 1.2, 0.8)), 'Bone')
    m.add(S.sphere(0.1, 10, 6, loc=(0, 0, 0.11), scale=(1.0, 1.0, 0.6)), 'Bone')
    # board: bone inlay squares on ebony
    m.add(S.box(0.52, 0.52, 0.02, 0.006, 1, base=(0, 0, board_top - 0.02)), 'WoodEbony')
    sq = 0.52 / 8
    for ix in range(8):
        for iy in range(8):
            if (ix + iy) % 2 == 0:
                m.add(S.box(sq, sq, 0.003, 0.0, 0, base=(-0.26 + (ix + 0.5) * sq, -0.26 + (iy + 0.5) * sq, board_top - 0.002)),
                      'Bone')

    def sqc(ix, iy):
        return (-0.26 + (ix + 0.5) * sq, -0.26 + (iy + 0.5) * sq, board_top + 0.001)
    for (ix, iy, kind, side) in ((1, 1, 'p', 0), (2, 2, 'p', 0), (4, 1, 'k', 0), (5, 3, 'p', 0), (6, 1, 'p', 0),
                                 (3, 3, 'b', 0), (1, 6, 'p', 1), (3, 5, 'p', 1), (4, 6, 'k', 1), (6, 5, 'p', 1),
                                 (2, 6, 'b', 1)):
        x, y, z = sqc(ix, iy)
        mat = 'Bone' if side == 0 else 'Charcoal'
        if kind == 'p':
            m.add(S.translate(_pawn(0.05), (x, y, z)), mat)
        elif kind == 'b':
            m.add(S.translate(S.merge(_pawn(0.065), S.sphere(0.015, 6, 4, loc=(0, 0, 0.07))), (x, y, z)), mat)
        else:
            body, so = _king(0.1)
            m.add(S.translate(body, (x, y, z)), mat)
            m.add(S.translate(so, (x, y, z)), 'Black' if side == 0 else 'Bone')
    # a toppled charcoal king and a captured knucklebone beside the board
    body, so = _king(0.1)
    S.rotate(body, (0, 90, 30))
    S.rotate(so, (0, 90, 30))
    m.add(S.translate(body, (0.2, -0.36, board_top - 0.05 + 0.02)), 'Charcoal')
    m.add(S.translate(so, (0.2, -0.36, board_top - 0.05 + 0.02)), 'Bone')
    m.add(S.bone(0.06, 0.008, 1.9, loc=(-0.28, -0.29, board_top - 0.015), rot=(0, 0, 30), segs=5), 'Bone')
    _stool(m, -0.95, 0.0)
    _stool(m, 0.95, 0.0)


@builder('shelf_moldering')
def shelf_moldering(m: Model, spec: Spec) -> None:
    j = m.rng
    W, D, H = 0.92, 0.38, 2.0
    y0 = 0.5 - D / 2 - 0.01
    yb = y0 + D / 2
    # carcass
    for sx in (-1, 1):
        m.add(S.box(0.045, D, H - 0.05, 0.01, 2, base=(sx * (W / 2 - 0.0225), y0, 0.0)))
    m.add(S.box(W, 0.02, H - 0.08, 0.004, 1, base=(0, yb - 0.01, 0.04)), 'WoodDark')
    m.add(S.box(W + 0.06, D + 0.04, 0.05, 0.015, 2, base=(0, y0, H - 0.05)))
    m.add(S.box(W + 0.02, D + 0.02, 0.025, 0.008, 1, base=(0, y0, H - 0.075)))
    m.add(S.box(W, D, 0.08, 0.01, 1, base=(0, y0, 0.0)))
    shelves = [0.08, 0.46, 0.84, 1.22, 1.6]
    for z in shelves[1:]:
        sag = S.box(W - 0.09, D - 0.03, 0.03, 0.006, 1, base=(0, y0 + 0.01, z))
        for v in sag.verts:
            v.co.z -= 0.012 * (1 - (v.co.x / (W / 2)) ** 2)
        m.add(sag)
    # crammed, leaning books (+ a skull bookend, a jar, a candle stub)
    inner_x0, inner_x1 = -W / 2 + 0.05, W / 2 - 0.05
    for k, z in enumerate(shelves):
        zz = z + (0.08 if k == 0 else 0.03) - (0.012 if k else 0)
        x_end = inner_x1
        start = inner_x0
        if k == 2:
            sk, so = S.skull(0.06, loc=(inner_x0 + 0.07, y0 + 0.02, zz + 0.07), segs=8)
            m.add(sk, 'Bone')
            m.add(so, 'Black')
            start = inner_x0 + 0.14
        if k == 3:
            x_end = inner_x1 - 0.16
            m.add(S.cylinder(0.05, 0.13, 10, 0.008, base=(inner_x1 - 0.08, y0 + 0.02, zz)), 'Glass')
            m.add(S.sphere(0.03, 8, 6, loc=(inner_x1 - 0.08, y0 + 0.02, zz + 0.05)), 'Porcelain')
            m.add(S.sphere(0.012, 6, 4, loc=(inner_x1 - 0.08, y0 - 0.005, zz + 0.055)), 'Book2')
        if k == 1:
            x_end = inner_x1 - 0.12
            m.add(S.candle(0.07, 0.025, base=(inner_x1 - 0.06, y0, zz), drips=2, seed=4), 'Wax')
        end = books_row(m, start, x_end, yb - 0.02, zz, D - 0.08, j.fork(f's{k}'), None, max_h=0.32 if k else 0.36)
        if k in (0, 4) and end < x_end - 0.08:
            lean = S.box(0.04, D - 0.1, 0.3, 0.004, 1, base=(0, 0, 0))
            S.rotate(lean, (0, 25, 0))
            m.add(S.translate(lean, (end + 0.08, y0 + 0.02, zz)), 'Book4')
    # cobweb in the top corner and mold creeping up the side
    m.add(cobweb((W / 2 - 0.045, y0 - D / 2 + 0.03, H - 0.075), 0.22, ('x', 'z'), (-1, -1)), 'Cobweb')
    m.add(cobweb((-W / 2 + 0.045, y0 - D / 2 + 0.03, 0.5), 0.12, ('x', 'z'), (1, -1)), 'Cobweb')
    for k, (z, r) in enumerate(((0.2, 0.08), (0.45, 0.06), (0.7, 0.05))):
        m.add(mold_blotch(-W / 2 - 0.001, y0 - 0.05, z, r, (-1, 0, 0), seed=k), 'Mold' if k % 2 == 0 else 'MoldDark')


@builder('easel_morbid')
def easel_morbid(m: Model, spec: Spec) -> None:
    j = m.rng
    H = 1.72
    # A-frame: two front legs splayed, one back leg
    # front legs stay BEHIND the canvas plane (the canvas leans on them), back leg props the frame
    for sx in (-1, 1):
        m.add(S.tube([(sx * 0.3, -0.04, 0.0), (sx * 0.05, 0.1, H)], 0.022, 6))
    m.add(S.tube([(0.0, 0.48, 0.0), (0.0, 0.11, H - 0.12)], 0.02, 6))
    m.add(S.box(0.07, 0.05, 0.08, 0.01, 1, loc=(0.0, 0.1, H - 0.03)))
    # tray at ~0.85 with a lip
    tz = 0.85
    m.add(S.box(0.66, 0.12, 0.025, 0.006, 1, base=(0, -0.03, tz)))
    m.add(S.box(0.66, 0.015, 0.03, 0.004, 1, base=(0, -0.09, tz + 0.02)))
    m.add(S.tube([(0, 0.36, 0.6), (0, 0.06, 0.6)], 0.012, 5))
    # canvas leaning back on the tray; the 'canvas' node is the painted FRONT face only
    tilt = -12
    cw, ch = 0.6, 0.74
    ccz = tz + 0.03 + ch / 2
    cy = -0.012
    frame = S.box(cw, 0.03, ch, 0.006, 1, loc=(0, 0, 0))
    S.rotate(frame, (tilt, 0, 0))
    m.add(S.translate(frame, (0, cy + 0.019, ccz)), 'WoodLight')
    m.node('canvas', origin=(0, cy, ccz), extras={'part': 'canvas'})
    face = screen_surface(cw - 0.02, ch - 0.02, 0.0, 1, 1, center=(0, 0, 0), tilt=tilt)
    m.add(S.translate(face, (0, cy, ccz)), 'CanvasBlank', 'canvas')
    # brush strokes appear as the painting progresses (canvas_stroke_N children)
    import mathutils as _mu
    rot = _mu.Euler((math.radians(tilt), 0, 0)).to_matrix()

    def on_canvas(u: float, v: float, off: float = 0.004):
        p = rot @ _mu.Vector((u, -off, v))
        return (p.x, p.y + cy, p.z + ccz)

    strokes = [
        ('PaintMoon', [(0.12, 0.2), (0.16, 0.24), (0.2, 0.2), (0.16, 0.16), (0.12, 0.2)], 0.035),
        ('PaintRed', [(-0.22, -0.2), (-0.1, -0.1), (0.0, -0.18), (0.12, -0.08), (0.22, -0.16)], 0.03),
        ('PaintGreen', [(-0.2, 0.05), (-0.12, 0.15), (-0.02, 0.05), (0.05, 0.12)], 0.025),
        ('PaintBone', [(-0.05, -0.02), (0.0, 0.05), (0.06, -0.02), (0.0, -0.06), (-0.05, -0.02)], 0.022),
    ]
    for k, (mat, pts, r) in enumerate(strokes):
        name = f'canvas_stroke_{k}'
        m.node(name, parent='canvas', origin=on_canvas(0, 0))
        m.add(S.tube([on_canvas(u, v) for u, v in pts], r, 4, scale_xy=(1.0, 0.25)), mat, name)
    # paint-splattered palette on the tray + a jar of brushes
    pal = S.prism(S.superellipse_pts(0.11, 0.07, 2.0, 14), 0.008, 0.003, 1, plane='XY')
    m.add(S.translate(S.rotate(pal, (0, 0, 15)), (0.24, -0.04, tz + 0.025)), 'WoodLight')
    for k, mat in enumerate(('PaintRed', 'PaintGreen', 'PaintMoon', 'Book5')):
        a = math.tau * k / 4
        m.add(S.sphere(0.014, 6, 4, loc=(0.24 + math.cos(a) * 0.06, -0.04 + math.sin(a) * 0.035, tz + 0.036),
                       scale=(1, 1, 0.4)), mat)
    m.add(S.cylinder(0.035, 0.08, 10, 0.006, base=(-0.24, -0.04, tz + 0.025)), 'Glass')
    for k in range(4):
        a = math.tau * k / 4
        top = (-0.24 + math.cos(a) * 0.03, -0.04 + math.sin(a) * 0.03, tz + 0.2)
        m.add(S.tube([(-0.24, -0.04, tz + 0.03), top], 0.004, 4), 'WoodLight')
        m.add(S.cone(0.008, 0.03, 5, base=top), ('PaintRed', 'Black', 'PaintGreen', 'Book5')[k])
    # splatters on the floor
    for k, mat in enumerate(('PaintRed', 'PaintGreen', 'PaintMoon')):
        m.add(S.blob(0.04, 1, 0.4, 3, k, loc=(j.uniform(-0.3, 0.3), j.uniform(-0.35, 0.0), 0.002), scale=(1.4, 1, 0.04)), mat)


def _bone_plate(r: float = 0.17, t: float = 0.05):
    """Weight plate shaped like the knobbly end of a giant cartoon bone: two fat lobes (top/bottom) with a pinched
    waist, outline in XZ, extruded along Y."""
    pts = []
    n = 20
    for k in range(n):
        a = math.tau * k / n
        c, s_ = math.cos(a), math.sin(a)
        # distance to the union of two circles at z = +-0.45r (radius 0.62r) -> bone-end silhouette
        rr = 0.0
        for cz in (0.45 * r, -0.45 * r):
            # ray from origin at angle a against circle centred (0, cz) radius 0.62r
            b = s_ * cz
            disc = b * b - (cz * cz - (0.62 * r) ** 2)
            if disc >= 0:
                rr = max(rr, b + math.sqrt(disc))
        pts.append((c * rr, s_ * rr))
    return S.prism(pts, t, 0.012, 1, plane='XZ')


@builder('gym_limb')
def gym_limb(m: Model, spec: Spec) -> None:
    """Squat rack for the undead: chunky uprights with peg holes, safety arms, a barbell racked at shoulder height
    with giant bone-end plates, a bone dumbbell pair, a towel, a glowing 'BRAINADE' bottle and a motivational sign.
    The 0.6 m standing area in the middle (x in [-0.3, 0.3]) stays clear."""
    j = m.rng
    m.mats.paint_spec(spec.variants[0], roughness=0.45, metallic=0.55)
    m.add(S.box(1.94, 0.96, 0.03, 0.012, 1, base=(0, 0, 0)), 'Rubber')
    m.add(S.box(0.62, 0.42, 0.004, 0.0, 0, base=(0, -0.12, 0.03)), 'Black')
    by = 0.28
    ux = 0.64
    for sx in (-1, 1):
        x = sx * ux
        m.add(S.box(0.09, 0.09, 1.66, 0.014, 1, base=(x, by, 0.03)))
        m.add(S.box(0.12, 0.62, 0.07, 0.016, 1, base=(x, 0.07, 0.03)))
        for k in range(5):
            m.add(S.box(0.004, 0.04, 0.03, 0.0, 0, base=(x - sx * 0.046, by - 0.0, 0.62 + k * 0.13)), 'Black')
        # J-hook holding the bar
        m.add(S.box(0.07, 0.12, 0.035, 0.0, 0, base=(x, by - 0.09, 1.27)))
        m.add(S.box(0.07, 0.025, 0.07, 0.0, 0, base=(x, by - 0.14, 1.28)))
        # safety arm sticking forward at hip height
        m.add(S.box(0.06, 0.4, 0.06, 0.01, 1, base=(x, by - 0.24, 0.86)))
        m.add(S.box(0.07, 0.03, 0.09, 0.0, 0, base=(x, by - 0.44, 0.86)), 'Rubber')
    m.add(S.box(1.37, 0.09, 0.09, 0.014, 1, base=(0, by, 1.6)))
    # rear floor bar + feet (W-073: inside the footprint's back edge; at by + 0.2 / by + 0.09 they stuck 20 mm out)
    m.add(S.box(1.37, 0.08, 0.07, 0.012, 1, base=(0, by + 0.17, 0.03)))
    for sx in (-1, 1):
        m.add(S.box(0.08, 0.27, 0.07, 0.012, 1, base=(sx * ux, by + 0.075, 0.03)))
    # barbell on the hooks with chunky bone-end plates
    bz = 1.33
    bar_y = by - 0.09
    m.add(S.cylinder(0.017, 1.9, 8, 0.0, base=(-0.95, bar_y, bz), rot=(0, 90, 0)), 'Chrome')
    for sx in (-1, 1):
        for k in range(2):
            plate = _bone_plate(0.21 - 0.045 * k, 0.05)
            S.rotate(plate, (0, 0, 90))
            m.add(S.translate(plate, (sx * (0.75 + k * 0.058), bar_y, bz)), 'Bone')
            m.add(S.cylinder(0.03, 0.054, 8, 0.0, base=(sx * (0.75 + k * 0.058) - 0.027, bar_y, bz), rot=(0, 90, 0)),
                  'BoneDark')
        m.add(S.cylinder(0.032, 0.035, 8, 0.004, base=(sx * 0.705 - 0.0175, bar_y, bz), rot=(0, 90, 0)), 'Chrome')
    # bone dumbbells on the mat (front left), towel over the crossbar, BRAINADE bottle (front right)
    for k, y in enumerate((-0.3, -0.18)):
        m.add(S.bone(0.24, 0.02, 2.2, loc=(-0.66, y, 0.065), rot=(0, 0, 90 + j.sym(8)), segs=5), 'Bone')
    towel = S.box(0.24, 0.012, 0.26, 0.006, 1, base=(0, 0, 0))
    for v in towel.verts:
        v.co.y += 0.02 * math.sin(v.co.z * 18.0)
    S.rotate(towel, (0, 0, 4))
    m.add(S.translate(towel, (0.38, by - 0.052, 1.39)), 'Lining')
    m.add(S.box(0.26, 0.11, 0.02, 0.006, 1, base=(0.38, by, 1.645)), 'Lining')
    m.add(S.cylinder(0.04, 0.2, 10, 0.012, base=(0.62, -0.32, 0.03)), 'GlowToxic')
    m.add(S.cylinder(0.022, 0.05, 8, 0.004, base=(0.62, -0.32, 0.23)), 'PlasticDark')
    m.add(S.box(0.07, 0.006, 0.07, 0.0, 0, base=(0.62, -0.362, 0.08)), 'Paper')
    # motivational sign hanging from the crossbar (behind the lifter's head)
    m.add(S.box(0.5, 0.02, 0.15, 0.006, 1, base=(-0.33, by - 0.055, 1.4), rot=(0, j.sym(3), 0)), 'Planks')
    m.add(S.text('NO BRAINS', 0.045, 0.002, loc=(-0.33, by - 0.067, 1.5), rot=(90, 0, 0), resolution=1), 'Blood')
    m.add(S.text('NO GAINS', 0.045, 0.002, loc=(-0.33, by - 0.067, 1.44), rot=(90, 0, 0), resolution=1), 'Blood')
    for dx in (-0.2, 0.2):
        m.add(S.tube([(-0.33 + dx, by - 0.05, 1.55), (-0.33 + dx * 0.9, by - 0.02, 1.6)], 0.004, 3), 'Ink')


@builder('arcade_tombstone')
def arcade_tombstone(m: Model, spec: Spec) -> None:
    j = m.rng
    W, D, H = 0.72, 0.64, 1.85
    r = W / 2
    pts = [(-r, 0.0), (r, 0.0), (r, H - r)]
    for k in range(1, 12):
        a = math.pi * k / 12
        pts.append((math.cos(a) * r, H - r + math.sin(a) * r))
    pts.append((-r, H - r))
    body = S.prism(pts, D, 0.03, 2, plane='XZ')
    S.translate(body, (0, 0.12, 0))
    m.add(body)
    yf = 0.12 - D / 2
    # crumbling corner + moss on the top like a real headstone
    m.add(mold_blotch(0.2, yf + 0.05, H - 0.07, 0.09, (0.3, -0.5, 1), seed=3), 'Moss')
    m.add(mold_blotch(-0.3, yf + 0.05, 0.14, 0.09, (0, -1, 0.3), seed=5), 'Moss')
    # recessed screen (tilted back), bezel and marquee
    m.add(S.box(0.58, 0.04, 0.5, 0.02, 2, base=(0, yf - 0.005, 1.0)), 'Black')
    m.node('screen', origin=(0, yf - 0.03, 1.25), extras={'part': 'screen'}, transient=True)
    m.add(screen_surface(0.5, 0.42, 0.012, 5, 4, center=(0, yf - 0.028, 1.25), tilt=-8), 'ScreenArcade', 'screen')
    m.add(S.box(0.6, 0.06, 0.16, 0.02, 2, base=(0, yf - 0.01, 1.52)), 'Black')
    m.add(S.text('RIP', 0.12, 0.012, loc=(0, yf - 0.045, 1.6)), 'Bone')
    # control panel with joystick and buttons
    cp = S.box(0.66, 0.24, 0.07, 0.02, 2, base=(0, 0, 0))
    S.rotate(cp, (-14, 0, 0))
    m.add(S.translate(cp, (0, yf - 0.09, 0.86)))
    m.add(S.cylinder(0.008, 0.08, 6, 0.0, base=(-0.15, yf - 0.1, 0.92)), 'Chrome')
    m.add(S.sphere(0.028, 10, 6, loc=(-0.15, yf - 0.1, 1.0)), 'EnamelRed')
    # lit buttons + coin slots share one 'glow' node: dark when the cabinet is unpowered
    m.node('glow', origin=(0.12, yf - 0.09, 0.93), extras={'part': 'glow'}, transient=True)
    for k, mat in enumerate(('Magnet3', 'GlowToxic', 'Magnet2')):
        m.add(S.cylinder(0.022, 0.02, 10, 0.006, base=(0.04 + k * 0.08, yf - 0.1 + 0.01 * k, 0.92)), mat,
              'glow' if mat == 'GlowToxic' else None)
    # coin door with glowing slots
    m.add(S.box(0.3, 0.02, 0.24, 0.01, 1, base=(0, yf - 0.008, 0.3)), 'Iron')
    for sx in (-1, 1):
        m.add(S.box(0.06, 0.012, 0.08, 0.004, 1, base=(sx * 0.07, yf - 0.02, 0.42)), 'Coil', 'glow')
    m.add(S.text('25c', 0.03, 0.002, loc=(0.0, yf - 0.02, 0.36)), 'Bone')
    # side art: a carved cross on both sides
    for sx in (-1, 1):
        m.add(S.box(0.012, 0.06, 0.32, 0.004, 1, base=(sx * (r + 0.002), 0.12, 1.15)), 'Slate')
        m.add(S.box(0.012, 0.22, 0.06, 0.004, 1, base=(sx * (r + 0.002), 0.12, 1.36)), 'Slate')
    add_broken(m, (0.0, 0.0, H + 0.05), 0.9)
