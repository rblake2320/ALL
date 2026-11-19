"""Coffins & beds. Head end at Blender +Y (Three -Z); lining/mattress tops per DIM.BED_HEIGHT conventions."""
from __future__ import annotations

import math

import bmesh

from common import dims
from common import shapes as S
from common.catalog import Spec
from common.model import Model
from common.rng import value_noise3

from .parts import add_broken, nail_heads, turned_leg
from .registry import builder

BH = dims.BED_HEIGHT


def _plot_height(x: float, y: float) -> float:
    """Soil surface of the budget plot: a heaped, lumpy rounded-rect mound with a body-shaped hollow in the middle
    (the lie pose rests at y = 0.04)."""
    W, L = 0.92, 1.9
    u = abs(x) / (W / 2)
    w = abs(y) / (L / 2)
    d = (u ** 4 + w ** 4) ** 0.25
    base = S.smoothstep(1.0, 0.7, d)
    e = (x / 0.27) ** 2 + ((y + 0.02) / 0.8) ** 2
    hollow = S.smoothstep(1.45, 0.6, e)
    n = value_noise3(x * 7.3, y * 7.3, 0.4, 11) * 0.02 + value_noise3(x * 17.0, y * 17.0, 1.7, 5) * 0.008
    return 0.003 + base * (0.205 * (1.0 - 0.8 * hollow) + n * (1.0 - 0.6 * hollow))


@builder('plot_budget')
def plot_budget(m: Model, spec: Spec) -> None:
    """DIY grave: heaped soil with a body-shaped hollow, sod edging, a crooked cross with a cardboard RIP sign at the
    head end (+Y), a shovel left stuck in the foot end, a wilted bouquet and one curious worm."""
    j = m.rng
    W, L = 0.92, 1.9
    mound = S.grid(W, L, 13, 25)
    for v in mound.verts:
        v.co.z = _plot_height(v.co.x, v.co.y)
    m.add(mound, 'Soil')
    # sod border (reads as a grave plot from the zoomed-out camera: dark mound on a green frame)
    outer = S.superellipse_pts(0.5, 0.99, 5.0, 28)
    inner = S.superellipse_pts(0.43, 0.92, 5.0, 28)
    m.add(S.outline_ring(outer, inner, 0.0, 0.022, 0.006, 1), 'Sod')
    jc = j.fork('clods')
    placed = 0
    for k in range(40):
        if placed >= 7:
            break
        x, y = jc.uniform(-0.38, 0.38), jc.uniform(-0.82, 0.78)
        e = (x / 0.27) ** 2 + ((y + 0.02) / 0.8) ** 2
        if e < 1.5:
            continue
        r = jc.uniform(0.03, 0.05)
        m.add(S.blob(r, 1, 0.4, 3.0, k, loc=(x, y, _plot_height(x, y) + r * 0.25), scale=(1.2, 1.0, 0.7)), 'SoilClod')
        placed += 1
    for k, (x, y) in enumerate(((0.31, -0.2), (-0.33, 0.45), (0.2, 0.62), (-0.18, -0.7))):
        m.add(S.blob(0.018, 1, 0.3, 3.0, 20 + k, loc=(x, y, _plot_height(x, y) + 0.008), scale=(1.3, 1.0, 0.7)),
              'StoneLight')
    # crooked cross at the head end, with a cardboard sign and a sad little wreath
    cx, cy = 0.02, 0.86
    lean = (-5.0 + j.sym(1.5), 4.0 + j.sym(1.5), 3.0 + j.sym(2.0))
    post = S.box(0.07, 0.055, 0.6, 0.012, 2, base=(0, 0, 0.0))
    bar = S.box(0.38, 0.055, 0.07, 0.012, 2, loc=(0.0, -0.004, 0.44), rot=(0, j.sym(4.0), 0))
    cross = S.merge(post, bar)
    S.rotate(cross, lean)
    m.add(S.translate(cross, (cx, cy, 0.0)), 'WoodLight')
    nails = [(0.0, -0.033, 0.44)]
    for p_ in nails:
        nb = S.sphere(0.008, 6, 4, loc=p_, scale=(1, 0.5, 1))
        S.rotate(nb, lean)
        m.add(S.translate(nb, (cx, cy, 0.0)), 'Iron')
    sign = S.box(0.2, 0.01, 0.1, 0.004, 1, loc=(0.0, -0.045, 0.3), rot=(0, 6, 0))
    txt = S.text('RIP', 0.055, 0.003, loc=(0.0, -0.052, 0.3), rot=(90, 6, 0))
    string = S.tube([(-0.07, -0.042, 0.345), (0.0, -0.034, 0.39), (0.07, -0.042, 0.35)], 0.0025, 3)
    for bm_, mat in ((sign, 'Cardboard'), (txt, 'Ink'), (string, 'Ink')):
        S.rotate(bm_, lean)
        m.add(S.translate(bm_, (cx, cy, 0.0)), mat)
    wreath = S.torus(0.07, 0.018, 12, 4, loc=(0.0, -0.05, 0.47), rot=(90, 0, 0))
    S.rotate(wreath, lean)
    m.add(S.translate(wreath, (cx, cy, 0.0)), 'Hedge')
    for k in range(4):
        a = math.tau * k / 4 + 0.5
        b = S.sphere(0.012, 6, 4, loc=(math.cos(a) * 0.07, -0.068, 0.47 + math.sin(a) * 0.07))
        S.rotate(b, lean)
        m.add(S.translate(b, (cx, cy, 0.0)), 'BloodWine')
    # shovel left stuck in the foot end, leaning out toward the viewer
    sx_, sy_ = 0.22, -0.72
    g = _plot_height(sx_, sy_)
    blade = S.box(0.2, 0.022, 0.24, 0.008, 1, base=(0, 0, 0.0))
    for v in blade.verts:   # dished blade with a rounded tip
        v.co.y += 0.035 * (v.co.x / 0.1) ** 2
        if v.co.z < 0.06:
            v.co.z += 0.06 * (abs(v.co.x) / 0.1) ** 2
    shaft = S.cylinder(0.018, 0.34, 8, 0.0, base=(0, 0, 0.22))
    collar = S.cylinder(0.026, 0.07, 8, 0.006, base=(0, 0, 0.2))
    grip = S.torus(0.05, 0.013, 10, 4, loc=(0, 0, 0.6), rot=(90, 0, 0))
    gbar = S.cylinder(0.015, 0.1, 6, 0.0, base=(-0.05, 0, 0.6), rot=(0, 90, 0))
    rot = (12.0, 10.0, 28.0)
    for bm_, mat in ((blade, 'SheetMetal'), (shaft, 'WoodLight'), (collar, 'Rust'), (grip, 'WoodDark'), (gbar, 'WoodDark')):
        S.rotate(bm_, rot)
        m.add(S.translate(bm_, (sx_, sy_, g - 0.12)), mat)
    m.add(S.blob(0.06, 1, 0.35, 3.0, 50, loc=(sx_ + 0.01, sy_ - 0.02, g + 0.01), scale=(1.4, 1.2, 0.5)), 'SoilClod')
    # wilted bouquet laid on the rim + a worm poking out to say hello
    bx, by = -0.3, -0.42
    bz = _plot_height(bx, by)
    for k, (dx, dy, mat) in enumerate(((0.0, 0.0, 'BloodWine'), (0.04, 0.03, 'Parchment'), (-0.03, 0.05, 'PlantPurple'))):
        m.add(S.tube([(bx + 0.05, by - 0.14, bz + 0.012), (bx + dx * 0.5, by - 0.06, bz + 0.02),
                      (bx + dx, by + dy, bz + 0.026)], 0.004, 3), 'Grass')
        m.add(S.blob(0.024, 1, 0.35, 3.0, 30 + k, loc=(bx + dx, by + dy, bz + 0.03), scale=(1.1, 1.1, 0.6)), mat)
    m.add(S.torus(0.014, 0.004, 8, 3, loc=(bx + 0.03, by - 0.09, bz + 0.018), rot=(0, 70, 30)), 'PaintRed')
    wx, wy = 0.32, 0.08
    wz = _plot_height(wx, wy)
    worm = S.torus(0.032, 0.0085, 12, 5, arc=200, loc=(0, 0, 0), rot=(90, 0, 0))
    S.rotate(worm, (0, -10, 30))
    m.add(S.translate(worm, (wx, wy, wz - 0.006)), 'Worm')
    m.add(S.sphere(0.0105, 6, 4, loc=(wx - 0.028, wy + 0.016, wz + 0.012)), 'Worm')
    # weeds on the sod and a couple sprouting from the mound
    jt = j.fork('tufts')
    # W-073: tufts kept inside the 1x2 footprint (at x ±0.46 / y 0.95 they stuck 22 / 45 mm into the next tile)
    spots = [(0.43, -0.6), (-0.43, -0.1), (0.43, 0.4), (-0.42, 0.75), (-0.25, 0.9)]
    for k, (x, y) in enumerate(spots):
        m.add(S.grass_tuft(0.045, jt.uniform(0.07, 0.12), 5, base=(x, y, 0.01), seed=k), 'GrassDry' if k % 2 else 'Grass')
    for k, (x, y) in enumerate(((0.28, 0.5), (-0.3, -0.62))):
        m.add(S.grass_tuft(0.03, 0.1, 4, base=(x, y, _plot_height(x, y) - 0.005), seed=40 + k), 'Grass')


def _coffin_walls(m: Model, outer, wall: float, z0: float, z1: float, mat: str = 'Paint'):
    inner = S.offset_outline(outer, wall)
    m.add(S.outline_ring(outer, inner, z0, z1, 0.012, 2), mat)
    return inner


@builder('coffin_pine')
def coffin_pine(m: Model, spec: Spec) -> None:
    j = m.rng
    outer = S.coffin_outline(1.86, 0.44, 0.64, 0.38, 0.26, axis='y')
    base = S.prism(outer, 0.06, 0.012, 2, plane='XY')
    m.add(S.translate(base, (0, 0, 0.035)))
    for (x, y) in ((-0.14, -0.75), (0.14, -0.75), (-0.2, 0.4), (0.2, 0.4)):
        m.add(S.box(0.08, 0.1, 0.04, 0.006, 1, base=(x, y, 0)), 'WoodDark')
    inner = _coffin_walls(m, outer, 0.045, 0.09, 0.52)
    # plank seams: two dark grooves round the walls make it read as knocked-together pine boards
    for zz in (0.22, 0.37):
        m.add(S.band(outer, zz, zz + 0.012, 0.003), 'WoodDark')
    # pale cloth lining (top at BED_HEIGHT) with a ruffle and a pillow at the head end
    lin = S.offset_outline(outer, 0.05)
    m.add(S.translate(S.prism(lin, BH - 0.095, 0.02, 2, plane='XY'), (0, 0, 0.095)), 'Lining')
    ruffle = [(x, y, 0.505) for x, y in S.offset_outline(outer, 0.052)]
    m.add(S.tube(ruffle, 0.014, 6, closed=True, scale_xy=(1.0, 0.6)), 'Lace')
    m.add(S.cushion(0.36, 0.2, 0.08, sag=0.015, roundness=0.4, puff=0.08, loc=(0, 0.7, BH + 0.03)), 'Lining')
    for (x, y) in ((-0.1, 0.25), (0.1, 0.25), (0.0, -0.1), (-0.1, -0.45), (0.1, -0.45)):
        m.add(S.sphere(0.012, 6, 4, loc=(x, y, BH + 0.002), scale=(1, 1, 0.5)), 'Lace')
    # rope handles (both sides): sagging loops knotted through the boards
    for sx in (-1, 1):
        for y in (-0.5, 0.0, 0.4):
            t = (y + 0.93) / 1.86
            xx = sx * (0.19 + (0.32 - 0.19) * min(1.0, t / 0.74) + 0.012) if y < 0.4 else sx * 0.335
            loop = [(xx, y - 0.08, 0.33), (xx + sx * 0.035, y - 0.05, 0.27), (xx + sx * 0.04, y, 0.255),
                    (xx + sx * 0.035, y + 0.05, 0.27), (xx, y + 0.08, 0.33)]
            m.add(S.tube(loop, 0.011, 4), 'Straw')
            for dy in (-0.08, 0.08):
                m.add(S.sphere(0.016, 5, 3, loc=(xx + sx * 0.004, y + dy, 0.33)), 'Straw')
    # lid leaning against the +X side, propped on the floor (W-073: LX keeps it inside the 1-tile footprint; at 0.46
    # it stuck 45 mm into the neighbouring tile / the wall)
    LX = -0.05
    lid_outline = [(x * 1.02, y * 1.0) for x, y in outer]
    lid = S.prism(lid_outline, 0.04, 0.012, 2, plane='XY')
    S.rotate(lid, (0, -79, 0))
    S.translate(lid, (0.46 + LX, 0.0, 0.33))
    m.add(lid)
    m.add(S.translate(S.rotate(S.box(0.035, 1.3, 0.04, 0.008, 1), (0, -79, 0)), (0.435 + LX, 0.02, 0.33)), 'WoodDark')
    m.add(nail_heads([(0.43 + LX, -0.6, 0.26), (0.44 + LX, 0.6, 0.18), (0.42 + LX, 0.05, 0.42)], 0.007, 'x'), 'Iron')
    # "ZZZ" tag hanging from a nail at the foot end
    m.add(nail_heads([(0.0, -0.93, 0.48)], 0.007, 'y'), 'Iron')
    m.add(S.tube([(0.0, -0.935, 0.48), (-0.04, -0.94, 0.4), (0.04, -0.94, 0.4), (0.0, -0.935, 0.48)], 0.0018, 3), 'Ink')
    m.add(S.box(0.14, 0.006, 0.08, 0.002, 1, loc=(0.0, -0.945, 0.36), rot=(0, 4, 0)), 'Paper')
    m.add(S.text('ZZZ', 0.045, 0.002, loc=(0.0, -0.95, 0.36), rot=(90, 4, 0)), 'Ink')
    for (x, y) in ((-0.08, 0.3), (0.1, -0.4), (-0.05, -0.75)):
        m.add(S.cylinder(0.015, 0.003, 8, 0.0, base=(x + 0.43 + LX, y, 0.0)), 'WoodDark')


def _shift(pts, dx: float = 0.0, dy: float = 0.0):
    return [(x + dx, y + dy) for x, y in pts]


@builder('coffin_chillrest')
def coffin_chillrest(m: Model, spec: Spec) -> None:
    """Glossy lacquered half-couch casket presented on a funeral-home bier: a draped plum velvet skirt, walls with
    raised side panels and a chrome cap rail, a crowned lid closed over the foot half (the sleeper is tucked in under
    it) carrying a spray of wilted roses, the head half open on a ruffled frosty lining, chrome swing bars, and a
    rounded refrigeration unit at the foot end (-Y = Three +Z) whose porthole fan is ringed by the blue status
    light (node "glow")."""
    j = m.rng
    m.mats.paint_spec(spec.variants[0], roughness=0.22, metallic=0.15, coat=0.85)
    W, L = 0.68, 1.76
    yc = 0.075                      # body centre (the unit sits at the foot end, -Y); W-073: L / yc / uy0 keep the
    #                                 chrome band and the unit's dial inside the 1x2 footprint (were 16 mm over each end)
    y_foot, y_head = yc - L / 2, yc + L / 2
    seg = 20
    body = _shift(S.superellipse_pts(W / 2, L / 2, 10.0, seg), 0.0, yc)
    # draped velvet bier skirt (vertical folds) from the floor to the casket's chrome base band
    skirt_o = S.offset_outline(body, -0.03)
    nf = len(skirt_o)
    folds = []
    for i, (x, y) in enumerate(skirt_o):
        k = 0.016 * math.cos(i * math.pi)          # alternate in/out per outline vertex = pleats
        cx, cy = x - 0.0, y - yc
        ln = max(1e-6, math.hypot(cx, cy))
        folds.append((x + cx / ln * k, y + cy / ln * k))
    m.add(S.prism(folds, 0.16, 0.0, 0, plane='XY'), 'CurtainPurple')
    m.add(S.band(body, 0.16, 0.18, 0.03), 'Chrome')
    inner = S.offset_outline(body, 0.05)
    m.add(S.outline_ring(body, inner, 0.15, 0.55, 0.0, 0))
    m.add(S.outline_ring(S.offset_outline(body, -0.02), S.offset_outline(body, 0.048), 0.53, 0.6, 0.0, 0))
    m.add(S.tube([(x, y, 0.535) for x, y in S.offset_outline(body, -0.024)], 0.012, 3, closed=True), 'Chrome')
    # raised panels on the long sides + head end (casket joinery reads from far away)
    for sx in (-1, 1):
        for (ya, yb) in ((y_foot + 0.1, yc - 0.03), (yc + 0.03, y_head - 0.1)):
            m.add(S.box(0.02, yb - ya, 0.26, 0.0, 0, base=(sx * (W / 2 + 0.004), (ya + yb) / 2, 0.16)))
    # quilted frosty lining (top at BED_HEIGHT), tufting, pillow + the signature ruffle around the open head half
    lin = S.offset_outline(body, 0.056)
    m.add(S.translate(S.prism(lin, BH - 0.105, 0.0, 0, plane='XY'), (0, 0, 0.105)), 'LiningCryo')
    for k, (x, y) in enumerate(((-0.1, yc + 0.12), (0.1, yc + 0.12), (0.0, yc + 0.34))):
        m.add(S.sphere(0.012, 4, 3, loc=(x, y, BH + 0.002), scale=(1, 1, 0.45)), 'Chrome')
    m.add(S.cushion(0.44, 0.22, 0.09, sag=0.016, roundness=0.4, puff=0.08, loc=(0, y_head - 0.2, BH + 0.035),
                    rot=(-6, 0, j.sym(3)), segs=12, rings=6), 'LiningCryo')
    ruffle = [(x, y, 0.565) for x, y in S.offset_outline(body, 0.052)]
    m.add(S.tube(ruffle, 0.022, 4, closed=True, scale_xy=(1.0, 0.55)), 'LiningCryo')
    # crowned lid closed over the foot half (lid top = spec height 0.7), chrome edge on its open end
    ly0, ly1 = y_foot - 0.005, yc - 0.02
    lcy = (ly0 + ly1) / 2
    m.add(S.box(W + 0.04, ly1 - ly0, 0.045, 0.016, 1, base=(0, lcy, 0.6)))
    # crowned top: the cushion's lower half stays inside the lid slab so the cavity under the lid is clear
    crown = S.cushion(W - 0.08, ly1 - ly0 - 0.08, 0.1, sag=-0.03, roundness=0.3, loc=(0, lcy, 0.646),
                      segs=10, rings=5)
    m.add(crown)
    m.add(S.box(W + 0.05, 0.02, 0.03, 0.0, 0, loc=(0, ly1, 0.625)), 'Chrome')
    m.add(S.box(0.16, 0.08, 0.008, 0.0, 0, base=(0.0, lcy + 0.12, 0.668), rot=(-4, 0, 0)), 'Chrome')
    # funeral spray on the closed lid (off the centre line the tests probe): a mound of wilted roses on broad leaves
    # with a lace ribbon -- the strongest 'casket' cue from the game camera
    jr = j.fork('spray')
    sx_, sy_ = 0.08, ly0 + 0.3
    for k in range(6):
        a = math.tau * k / 6 + 0.3
        tipx, tipy = sx_ + math.cos(a) * 0.22, sy_ + math.sin(a) * 0.14
        leaf = S.catmull([(sx_, sy_, 0.712), ((sx_ + tipx) / 2, (sy_ + tipy) / 2, 0.724), (tipx, tipy, 0.69)], 2)
        m.add(S.tube(leaf, radii=[0.02, 0.026, 0.022, 0.012, 0.0], segs=3, scale_xy=(1.0, 0.3)),
              'Moss' if k % 2 else 'PlantGreen')
    rose = [(0.0, 0.0), (0.034, 0.008), (0.042, 0.03), (0.0, 0.04)]
    for k in range(8):
        a = jr.uniform(0, math.tau)
        rr = 0.0 if k == 0 else jr.uniform(0.045, 0.11)
        x, y = sx_ + math.cos(a) * rr * 1.25, sy_ + math.sin(a) * rr * 0.8
        z = 0.712 + 0.022 * (1 - rr / 0.11)
        m.add(S.lathe(rose, 6, base=(x, y, z), rot=(jr.sym(18), jr.sym(18), 0)),
              ('BloodWine', 'PaintRed', 'BloodWine', 'Velvet')[k % 4])
    m.add(S.tube([(sx_ - 0.2, sy_ - 0.05, 0.672), (sx_ - 0.08, sy_ - 0.09, 0.712), (sx_ + 0.05, sy_ - 0.11, 0.71),
                  (sx_ + 0.2, sy_ - 0.07, 0.672)], 0.012, 3, scale_xy=(1.0, 0.3)), 'Lace')
    # chrome swing-bar handles on both long sides + a short one at the head end
    for sx in (-1, 1):
        x = sx * (W / 2 + 0.05)
        m.add(S.cylinder(0.014, 1.2, 6, 0.0, base=(x, yc - 0.6, 0.36), rot=(-90, 0, 0)), 'Chrome')
        for y in (yc - 0.52, yc, yc + 0.52):
            m.add(S.box(0.06, 0.03, 0.03, 0.0, 0, loc=(sx * (W / 2 + 0.024), y, 0.36)), 'Chrome')
        for y in (yc - 0.61, yc + 0.61):
            m.add(S.sphere(0.02, 4, 3, loc=(x, y, 0.36)), 'Chrome')
    # refrigeration unit at the foot end: vented steel box, dial, status LED (glow), coolant hoses into the casket
    uy0, uy1 = -0.975, y_foot + 0.01
    uyc = (uy0 + uy1) / 2
    ud = uy1 - uy0
    m.add(S.box(0.6, ud, 0.36, 0.05, 2, base=(0, uyc, 0.0)), 'SheetMetal')
    m.add(S.box(0.62, ud + 0.012, 0.03, 0.0, 0, base=(0, uyc, 0.345)), 'Chrome')
    for k in range(3):
        m.add(S.box(0.012, ud * 0.6, 0.016, 0.0, 0, loc=(0.302, uyc, 0.12 + k * 0.055)), 'Black')
        m.add(S.box(0.012, ud * 0.6, 0.016, 0.0, 0, loc=(-0.302, uyc, 0.12 + k * 0.055)), 'Black')
    fx, fz = -0.08, 0.18
    m.add(S.torus(0.105, 0.016, 14, 3, loc=(fx, uy0 + 0.004, fz), rot=(90, 0, 0)), 'Chrome')
    m.add(S.cylinder(0.098, 0.01, 12, 0.0, base=(fx, uy0 + 0.012, fz), rot=(90, 0, 0)), 'Black')
    for k in range(3):
        m.add(S.box(0.085, 0.006, 0.03, 0.0, 0, loc=(fx, uy0 - 0.002, fz), rot=(0, 120 * k + 15, 0)), 'Chrome')
    m.add(S.sphere(0.02, 6, 4, loc=(fx, uy0 - 0.006, fz), scale=(1, 0.5, 1)), 'Chrome')
    m.add(S.cylinder(0.034, 0.02, 10, 0.0, base=(0.18, uy0 + 0.004, 0.25), rot=(90, 0, 0)), 'Chrome')
    m.add(S.box(0.008, 0.006, 0.028, 0.002, 1, loc=(0.18, uy0 - 0.018, 0.262), rot=(0, 35, 0)), 'Black')
    m.node('glow', origin=(fx, uy0 - 0.01, fz), extras={'part': 'glow', 'flicker': 'blink'}, transient=True)
    m.add(S.torus(0.12, 0.008, 16, 3, loc=(fx, uy0 - 0.006, fz), rot=(90, 0, 0)), 'GlowLED', 'glow')
    m.add(S.sphere(0.016, 6, 4, loc=(0.18, uy0 - 0.008, 0.12), scale=(1, 0.6, 1)), 'GlowLED', 'glow')
    hoses = []
    for sx in (-1, 1):
        hose = S.catmull([(sx * 0.2, uyc, 0.37), (sx * 0.24, uyc + 0.03, 0.5), (sx * (W / 2 + 0.035), y_foot + 0.2, 0.47),
                          (sx * (W / 2 + 0.035), y_foot + 0.36, 0.33)], 3)
        hoses.append(hose)
        m.add(S.tube(hose, 0.018, 4), 'Rubber')
        m.add(S.cylinder(0.026, 0.03, 6, 0.0, base=(sx * 0.2, uyc, 0.355)), 'Chrome')
    # frost (visible while powered): crust on the rim, icicles off the crown rail, frosty hoses, cold mist
    m.node('frost', origin=(0, yc, 0.6), extras={'part': 'frost'}, transient=True)
    rim = S.offset_outline(body, 0.012)
    for k, (x, y) in enumerate(rim):
        if y < yc - 0.05:
            continue
        if k % 4 == 0:
            m.add(S.blob(0.034, 1, 0.35, 3.0, k, loc=(x, y, 0.602), scale=(1.4, 1.4, 0.3)), 'Frost', 'frost')
        else:
            m.add(S.cone(0.009, j.uniform(0.04, 0.07), 5, base=(x * 1.04, y, 0.535), rot=(180, 0, 0)), 'Ice', 'frost')
    for hose in hoses:
        for q in (2, 5, 8):
            if q < len(hose):
                m.add(S.ico(0.022, 1, loc=hose[q], scale=(1.0, 1.0, 0.8)), 'Frost', 'frost')
    m.add(S.blob(0.2, 1, 0.25, 2.0, 3, loc=(0, yc + 0.32, BH + 0.06), scale=(1.0, 1.7, 0.22)), 'Mist', 'frost')
    add_broken(m, (0.0, uyc, 0.66), 0.8)


def _sarc_outline() -> list:
    """Anthropoid plan outline (convex, CCW): flat rounded foot (-Y), broad shoulders, egg-round head (+Y)."""
    right = [(0.2, -0.955), (0.255, -0.93), (0.285, -0.66), (0.315, -0.4), (0.336, -0.2), (0.355, 0.0), (0.371, 0.2)]
    pts = list(right)
    for k in range(0, 13):
        a = math.radians(k * 15.0)
        pts.append((0.385 * math.cos(a), 0.4 + 0.55 * math.sin(a)))
    left = [(-x, y) for x, y in reversed(right)]
    return pts + left


@builder('sarcophagus_cryo')
def sarcophagus_cryo(m: Model, spec: Spec) -> None:
    """Gilded anthropoid sarcophagus (lapis bands, glowing cyan hieroglyph panels) with a glass cryo canopy hinged on
    the -X side and tilted open, a pharaoh-zombie headboard and canopic-jar coolant tanks at the foot."""
    j = m.rng
    m.mats.paint_spec(spec.variants[0], roughness=0.32, metallic=0.6)
    out = _sarc_outline()
    top = 0.62
    m.add(S.prism(S.offset_outline(out, -0.04), 0.05, 0.0, 0, plane='XY'), 'Lapis')
    m.add(S.translate(S.prism(S.offset_outline(out, -0.02), 0.05, 0.0, 0, plane='XY'), (0, 0, 0.05)))
    inner = S.offset_outline(out, 0.05)
    m.add(S.outline_ring(out, inner, 0.1, top, 0.0, 0))
    for (z0, z1, mat, o) in ((0.47, 0.51, 'Lapis', 0.008), (0.43, 0.447, 'Turquoise', 0.005)):
        m.add(S.band(out, z0, z1, o), mat)
    m.add(S.outline_ring(S.offset_outline(out, -0.014), S.offset_outline(out, 0.03), 0.57, top + 0.025, 0.0, 0))
    # body lining (top = lie pose height) + headrest
    lp = BH + 0.1
    m.add(S.translate(S.prism(S.offset_outline(out, 0.05), lp - 0.1, 0.0, 0, plane='XY'), (0, 0, 0.1)), 'LiningCryo')
    m.add(S.cushion(0.3, 0.17, 0.08, sag=0.0, roundness=0.45, loc=(0, 0.66, lp + 0.03), segs=12, rings=6), 'LiningCryo')
    # glowing hieroglyph panels on both long sides (glow)
    m.node('glow', origin=(0, 0, 0.33), extras={'part': 'glow', 'flicker': 'pulse'}, transient=True)

    def side_point(y: float, sx: int):
        # half-width of the outline at y + local slope (for orienting panels)
        best = None
        for (x0, y0), (x1, y1) in zip(out, out[1:] + out[:1]):
            if (x0 * sx) > 0 and (x1 * sx) > 0 and min(y0, y1) <= y <= max(y0, y1) and abs(y1 - y0) > 1e-6:
                t = (y - y0) / (y1 - y0)
                best = (x0 + (x1 - x0) * t, math.degrees(math.atan2(x1 - x0, y1 - y0)))
        return best

    glyphs = ('eye', 'ankh', 'wave', 'scarab', 'eye')
    for sx in (-1, 1):
        for k, y in enumerate((-0.5, -0.12, 0.24)):
            sp = side_point(y, sx)
            if sp is None:
                continue
            x, slope = sp
            yaw = -slope if sx > 0 else slope
            x = x + sx * 0.004
            panel = S.box(0.012, 0.2, 0.17, 0.0, 0, loc=(0, 0, 0))
            S.rotate(panel, (0, 0, yaw))
            m.add(S.translate(panel, (x, y, 0.33)), 'Slate')
            gx = x + sx * 0.008
            kind = glyphs[(k + (0 if sx > 0 else 2)) % len(glyphs)]
            parts = []
            if kind == 'eye':
                parts.append(S.sphere(0.03, 6, 4, loc=(0, 0, 0.35), scale=(0.25, 1.4, 0.55)))
                parts.append(S.tube([(0, -0.035, 0.38), (0, 0.0, 0.392), (0, 0.04, 0.378)], 0.005, 3))
                parts.append(S.tube([(0, 0.0, 0.33), (0, 0.006, 0.3), (0, 0.025, 0.29)], 0.005, 3))
            elif kind == 'ankh':
                parts.append(S.torus(0.02, 0.006, 8, 3, loc=(0, 0, 0.385), rot=(0, 90, 0)))
                parts.append(S.box(0.012, 0.012, 0.09, 0.0, 0, loc=(0, 0, 0.32)))
                parts.append(S.box(0.012, 0.07, 0.012, 0.0, 0, loc=(0, 0, 0.36)))
            elif kind == 'wave':
                parts.append(S.tube([(0, -0.06, 0.33), (0, -0.03, 0.35), (0, 0.0, 0.33), (0, 0.03, 0.35),
                                     (0, 0.06, 0.33)], 0.006, 3))
            else:  # scarab
                parts.append(S.sphere(0.03, 8, 5, loc=(0, 0, 0.34), scale=(0.3, 0.8, 1.0)))
                for sz in (-1, 1):
                    parts.append(S.sphere(0.03, 6, 4, loc=(0, sz * 0.035, 0.36), scale=(0.25, 0.9, 0.45),
                                          rot=(sz * 25, 0, 0)))
            g = S.merge(*parts)
            S.translate(g, (0, 0, -0.33))
            S.rotate(g, (0, 0, yaw))
            m.add(S.translate(g, (gx, y, 0.33)), 'GlowCryo', 'glow')
    # pharaoh-zombie headboard at the head end (+Y): striped nemes, sickly green face, stitched smile, gold beard
    hy = 0.955
    nemes = S.prism([(-0.27, 0.0), (0.27, 0.0), (0.21, 0.3), (0.13, 0.4), (0.0, 0.44), (-0.13, 0.4), (-0.21, 0.3)],
                    0.045, 0.012, 1, plane='XZ')
    m.add(S.translate(nemes, (0, hy, 0.5)))
    for k in range(4):
        zz = 0.55 + k * 0.075
        m.add(S.box(0.5 - k * 0.07, 0.05, 0.022, 0.0, 0, loc=(0, hy - 0.002, zz)), 'Lapis')
    m.add(S.superellipsoid(0.085, 0.03, 0.105, 0.7, 0.7, 10, 5, loc=(0, hy - 0.032, 0.72)), 'Skin')
    for sx in (-1, 1):
        m.add(S.sphere(0.019, 6, 4, loc=(sx * 0.033, hy - 0.055, 0.745), scale=(1.1, 0.5, 0.8)), 'Black')
        m.add(S.box(0.035, 0.008, 0.008, 0.002, 1, loc=(sx * 0.036, hy - 0.058, 0.775), rot=(0, sx * -12, 0)), 'Black')
    m.add(S.tube([(-0.04, hy - 0.058, 0.69), (0.0, hy - 0.062, 0.68), (0.04, hy - 0.058, 0.69)], 0.004, 3), 'Ink')
    m.add(S.box(0.04, 0.03, 0.07, 0.01, 1, base=(0, hy - 0.04, 0.58)), 'Gold')
    # canopic-jar coolant tanks at the foot corners, lids glowing cyan (glow), pipes into the base
    for sx in (-1, 1):
        jx, jy = sx * 0.37, -0.84
        m.add(S.lathe([(0.045, 0.0), (0.066, 0.03), (0.068, 0.15), (0.05, 0.24), (0.0, 0.25)], 8,
                      base=(jx, jy, 0.0)), 'Paint')
        m.add(S.lathe([(0.069, 0.1), (0.071, 0.13)], 8, base=(jx, jy, 0.0), cap_bottom=False, cap_top=False), 'Lapis')
        lid = S.sphere(0.045, 8, 4, loc=(jx, jy, 0.29), scale=(1.0, 1.0, 0.9))
        m.add(lid, 'GlowCryo', 'glow')
        m.add(S.tube([(jx, jy + 0.05, 0.08), (jx - sx * 0.02, jy + 0.12, 0.06), (sx * 0.27, -0.72, 0.07)], 0.012, 5),
              'Rubber')
    # glass cryo canopy (lofted dome over the outline), hinged on the -X side and tilted open
    rings = [S.outline_scaled(out, s_, z_) for s_, z_ in ((1.0, 0.0), (0.95, 0.1), (0.78, 0.18), (0.45, 0.23))]
    canopy = S.loft(rings, cap_bottom=False, cap_top=True)
    frame = S.tube([(x, y, 0.0) for x, y in out], 0.016, 3, closed=True)
    hinge_x = -0.39
    for bm_, mat in ((canopy, 'GlassCanopy'), (frame, 'Gold')):
        S.translate(bm_, (0, 0, top + 0.03))
        S.rotate(bm_, (0, -33, 0), pivot=(hinge_x, 0, top + 0.03))
        m.add(bm_, mat)
    for y in (-0.5, 0.45):
        m.add(S.cylinder(0.02, 0.12, 8, 0.0, base=(hinge_x, y - 0.06, top + 0.03), rot=(-90, 0, 0)), 'Gold')
    # cold mist inside (frost)
    m.node('frost', origin=(0, 0, lp + 0.1), extras={'part': 'frost'}, transient=True)
    m.add(S.blob(0.22, 1, 0.3, 2.0, 1, loc=(0.0, -0.05, lp + 0.08), scale=(1.2, 3.2, 0.3)), 'Mist', 'frost')
    add_broken(m, (0.25, -0.55, 0.8), 0.8)


@builder('bed_normal')
def bed_normal(m: Model, spec: Spec) -> None:
    j = m.rng
    MT = BH + 0.12
    W, L = 1.9, 1.96
    # frame
    for sx in (-1, 1):
        m.add(S.box(0.06, L - 0.1, 0.18, 0.012, 2, base=(sx * (W / 2 - 0.03), 0, 0.2)), 'WoodDark')
    for y, top in ((L / 2 - 0.04, 1.1), (-L / 2 + 0.04, 0.62)):
        for sx in (-1, 1):
            m.add(turned_leg(sx * (W / 2 - 0.04), y, top - 0.05, 0.035, 10), 'WoodDark')
            m.add(S.sphere(0.045, 10, 6, loc=(sx * (W / 2 - 0.04), y, top - 0.02)), 'WoodDark')
    hb = S.box(W - 0.1, 0.05, 0.62, 0.02, 2, base=(0, L / 2 - 0.04, 0.4))
    m.add(hb, 'WoodDark')
    m.add(S.cylinder(0.035, W - 0.08, 12, 0.008, base=(-(W - 0.08) / 2, L / 2 - 0.04, 1.02), rot=(0, 90, 0)), 'WoodDark')
    arch = [(x, L / 2 - 0.068, 0.62 + 0.25 * math.cos(x / (W / 2) * math.pi / 2)) for x in
            [(-W / 2 + 0.2) + k * (W - 0.4) / 10 for k in range(11)]]
    m.add(S.tube(arch, 0.018, 6), 'Wood')
    m.add(S.box(W - 0.1, 0.05, 0.3, 0.02, 2, base=(0, -L / 2 + 0.04, 0.22)), 'WoodDark')
    # mattress (top at BED_HEIGHT + 0.12)
    m.add(S.cushion(W - 0.12, L - 0.12, 0.2, sag=0.01, roundness=0.25, loc=(0, 0, MT - 0.1)), 'Lining')
    # patchwork quilt over the lower two-thirds, folded back at the top
    qy0, qy1 = -L / 2 + 0.03, 0.28
    q = S.cushion(W - 0.04, qy1 - qy0, 0.07, sag=0.008, roundness=0.25, loc=(0, (qy0 + qy1) / 2, MT + 0.02))
    m.add(q)
    m.add(S.cylinder(0.05, W - 0.06, 14, 0.02, base=(-(W - 0.06) / 2, qy1, MT + 0.035), rot=(0, 90, 0)), 'QuiltB')
    for sx in (-1, 1):
        m.add(S.box(0.035, qy1 - qy0 - 0.04, 0.2, 0.015, 2, base=(sx * (W / 2 - 0.035), (qy0 + qy1) / 2, MT - 0.18)))
    m.add(S.box(W - 0.04, 0.035, 0.2, 0.015, 2, base=(0, -L / 2 + 0.035, MT - 0.18)))
    nx, ny = 6, 4
    for ix in range(nx):
        for iy in range(ny):
            if (ix + iy) % 2:
                continue
            cx = -W / 2 + 0.02 + (ix + 0.5) * (W - 0.04) / nx
            cy = qy0 + (iy + 0.5) * (qy1 - qy0) / ny
            m.add(S.box((W - 0.04) / nx - 0.02, (qy1 - qy0) / ny - 0.02, 0.006, 0.002, 1, base=(cx, cy, MT + 0.052)),
                  'QuiltB' if (ix // 2 + iy) % 2 else 'QuiltC')
    # two pillows + a heart cushion
    for sx in (-1, 1):
        m.add(S.cushion(0.66, 0.36, 0.14, sag=0.02, roundness=0.4, puff=0.12, loc=(sx * 0.44, 0.72, MT + 0.06),
                        rot=(-10, j.sym(3), sx * j.uniform(1, 4))), 'Lining')
    heart = S.merge(S.sphere(0.07, 10, 6, loc=(-0.045, 0, 0.0)), S.sphere(0.07, 10, 6, loc=(0.045, 0, 0.0)),
                    S.cone(0.1, 0.12, 10, base=(0, 0, -0.02), rot=(180, 0, 0)))
    S.rotate(heart, (-20, 0, 8))
    m.add(S.translate(heart, (0.0, 0.5, MT + 0.14)), 'BloodWine')
