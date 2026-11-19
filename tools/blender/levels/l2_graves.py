"""L2 graves & digging: grave_marked (4 headstone variants), mound_soft, heap_compost, obelisk_founder, plot_grub.

Blender axes: front = -Y (glTF +Z). A grave's headstone sits at the BACK (+Y here = glTF -Z, doc §3 "headstone at
-Z"), its low grassy mound in front where zombies stand to pay respects."""
from __future__ import annotations

import math

from mathutils import Vector

from common import shapes as S
from common.model import Model
from objects.parts import mold_blotch

from .kit import LevelSpec, add, builder, dome, flat_text, node, quad, rounded_outline


# ───────────────────────────── helpers ─────────────────────────────

def _grass(m: Model, j, n: int, xr: float, yr, h=(0.07, 0.13), mat='GyMoss', blades: int = 4, nd=None):
    for k in range(n):
        x = j.uniform(-xr, xr)
        y = j.uniform(*yr)
        add(m, S.grass_tuft(0.045, j.uniform(*h), blades, base=(x, y, 0.0), seed=k + 17), mat if k % 3 else 'GrassDry', nd)


def _engraving_lines(m: Model, x: float, y_face: float, z0: float, widths, step: float = 0.05, lean=(0, 0, 0),
                     pivot=(0, 0, 0)):
    """Short dark bars that read as an epitaph from the game camera (the actual text is UI, seeded per grave)."""
    for k, wd in enumerate(widths):
        bar = quad(wd, 0.018, (x, y_face - 0.004, z0 - k * step))
        S.rotate(bar, lean, pivot)
        add(m, bar, 'Slate', 'sign')


def _bouquet(m: Model, j, at, lean_deg: float = 0.0):
    """Flowers left on the grave ('flag' node, hidden until grave_leaveFlowers): 3 blooms, stems, a ribbon."""
    node(m, 'flag', 'flag', origin=at, transient=True)
    x, y, z = at
    cols = ('Flower1', 'Flower2', 'Flower3')
    for k in range(3):
        a = -0.5 + k * 0.5
        tip = Vector((x + a * 0.1, y - 0.07 - 0.03 * k, z + 0.24 + 0.05 * (k == 1)))
        add(m, S.tube([(x, y + 0.04, z + 0.01), tip], 0.006, 3), 'Leaf', 'flag')
        add(m, S.ico(0.055, 1, loc=tuple(tip), scale=(1, 1, 0.75)), cols[k], 'flag')
    add(m, S.box(0.1, 0.04, 0.04, 0.006, 1, loc=(x, y + 0.01, z + 0.08), rot=(30, 0, 0)), 'BloodWine', 'flag')


def _stone_lean(j, lo=2.0, hi=6.0):
    s = 1 if j.chance(0.5) else -1
    return (-j.uniform(lo, hi) * 0.6, s * j.uniform(lo, hi), 0.0)


# ───────────────────────────── grave_marked ─────────────────────────────

def _grave_base(m: Model, j, plinth_w: float = 0.8):
    add(m, dome(0.36, 0.72, 0.17, 4, 14, j, power=2.4, loc=(0, -0.2, 0)), 'GyMoss')
    add(m, dome(0.3, 0.6, 0.05, 2, 10, j.fork('top'), power=2.2, loc=(0, -0.22, 0.13)), 'Sod')
    add(m, S.box(plinth_w, 0.38, 0.1, 0.02, 1, base=(0, 0.72, 0.0)), 'GyStone')
    for k in range(4):
        x = j.uniform(-0.32, 0.32)
        y = j.uniform(-0.85, 0.35)
        add(m, S.grass_tuft(0.06, j.uniform(0.1, 0.16), 4, base=(x, y, 0.0), seed=k + 3), ('GyMoss', 'GrassDry')[k % 2])
    for k in range(2):
        add(m, S.ico(0.04, 1, loc=(j.uniform(-0.4, 0.4), j.uniform(-0.95, 0.4), 0.01), scale=(1.2, 1, 0.5)),
            'GyStoneDark')


@builder('grave_marked_rounded')
def grave_rounded(m: Model, spec: LevelSpec) -> None:
    j = m.rng
    _grave_base(m, j)
    W, H, D = 0.66, 0.96, 0.15
    lean = _stone_lean(j)
    piv = (0, 0.72, 0.1)
    stone = S.prism(rounded_outline(W, H, W / 2, 6), D, 0.02, 1, plane='XZ')
    S.translate(stone, (0, 0.72, 0.1))
    S.rotate(stone, lean, piv)
    add(m, stone, 'GySlab')
    yf = 0.72 - D / 2
    t = flat_text('R.I.P.', 0.13, (0, yf - 0.003, 0.1 + H * 0.66))
    S.rotate(t, lean, piv)
    add(m, t, 'Slate', 'sign')
    _engraving_lines(m, 0, yf, 0.1 + H * 0.45, (0.3, 0.22, 0.26), lean=lean, pivot=piv)
    add(m, S.rotate(mold_blotch(0.18, 0.66, 0.1 + H - 0.05, 0.11, (0.2, -0.3, 1), seed=1), lean, piv), 'Moss')
    add(m, S.rotate(mold_blotch(-0.22, 0.64, 0.2, 0.07, (-0.6, -1, 0.1), seed=2), lean, piv), 'GyLichen')
    _bouquet(m, j, (0.08, 0.5, 0.1))


@builder('grave_marked_cross')
def grave_cross(m: Model, spec: LevelSpec) -> None:
    j = m.rng
    _grave_base(m, j, 0.62)
    lean = _stone_lean(j)
    piv = (0, 0.72, 0.1)
    D = 0.12
    die = S.box(0.42, D + 0.02, 0.42, 0.02, 1, base=(0, 0.72, 0.1))
    shaft = S.box(0.12, D, 0.62, 0.015, 1, base=(0, 0.72, 0.5))
    arm = S.box(0.42, D, 0.12, 0.015, 1, base=(0, 0.72, 0.86))
    ring = S.torus(0.15, 0.022, 14, 4, loc=(0, 0.72, 0.92), rot=(90, 0, 0))
    for bm in (die, shaft, arm, ring):
        S.rotate(bm, lean, piv)
    add(m, S.merge(die, shaft, arm), 'GyStone')
    add(m, ring, 'GyStone')
    yf = 0.72 - (D + 0.02) / 2
    t = flat_text('BELOVED', 0.06, (0, yf - 0.003, 0.4))
    S.rotate(t, lean, piv)
    add(m, t, 'Slate', 'sign')
    _engraving_lines(m, 0, yf, 0.3, (0.24, 0.18), lean=lean, pivot=piv)
    add(m, S.rotate(mold_blotch(0.0, 0.66, 1.0, 0.07, (0, -0.2, 1), seed=3), lean, piv), 'Moss')
    add(m, S.rotate(mold_blotch(0.16, 0.65, 0.16, 0.06, (0.3, -1, 0), seed=4), lean, piv), 'Moss')
    _bouquet(m, j, (-0.1, 0.5, 0.1))


@builder('grave_marked_scroll')
def grave_scroll(m: Model, spec: LevelSpec) -> None:
    """Unrolled-scroll headstone: a slab with two rolled volutes at the top and a curled foot."""
    j = m.rng
    _grave_base(m, j)
    lean = _stone_lean(j)
    piv = (0, 0.72, 0.1)
    W, H, D = 0.62, 0.78, 0.12
    pts = [(-W / 2, 0.0), (W / 2, 0.0), (W / 2, H - 0.06)]
    for k in range(1, 6):
        u = k / 6
        pts.append((W / 2 - u * W, H - 0.06 + 0.07 * math.sin(math.pi * u * 2) * 0.6 + 0.04 * math.sin(math.pi * u)))
    pts.append((-W / 2, H - 0.06))
    slab = S.prism(pts, D, 0.018, 1, plane='XZ')
    S.translate(slab, (0, 0.72, 0.1))
    rolls = [S.cylinder(0.075, D + 0.05, 8, 0.0, base=(sx * (W / 2 - 0.02), 0.72 - (D + 0.05) / 2, 0.1 + H - 0.04),
                        rot=(-90, 0, 0)) for sx in (-1, 1)]
    spiral = [S.torus(0.04, 0.012, 8, 3, loc=(sx * (W / 2 - 0.02), 0.72 - (D + 0.05) / 2 - 0.004, 0.1 + H - 0.04),
                      rot=(90, 0, 0)) for sx in (-1, 1)]
    for bm in [slab] + rolls + spiral:
        S.rotate(bm, lean, piv)
    add(m, slab, 'GyStoneWarm')
    add(m, S.merge(*rolls), 'GyStoneWarm')
    add(m, S.merge(*spiral), 'GyStoneDark')
    yf = 0.72 - D / 2
    t = flat_text('HERE LIES', 0.07, (0, yf - 0.003, 0.1 + H * 0.7))
    S.rotate(t, lean, piv)
    add(m, t, 'Slate', 'sign')
    _engraving_lines(m, 0, yf, 0.1 + H * 0.5, (0.34, 0.26, 0.3, 0.16), step=0.055, lean=lean, pivot=piv)
    add(m, S.rotate(mold_blotch(-0.25, 0.66, 0.15, 0.08, (-0.4, -1, 0.1), seed=5), lean, piv), 'Moss')
    _bouquet(m, j, (0.12, 0.5, 0.1))


@builder('grave_marked_slab')
def grave_slab(m: Model, spec: LevelSpec) -> None:
    """Wide flat-topped slab, heavy moss and lichen, leaning more than the others; a chipped corner."""
    j = m.rng
    _grave_base(m, j, 0.86)
    lean = (-5.0, -6.5, 0.0)
    piv = (0, 0.72, 0.1)
    W, H, D = 0.74, 0.7, 0.17
    pts = [(-W / 2, 0.0), (W / 2, 0.0), (W / 2, H - 0.12), (W / 2 - 0.12, H), (-W / 2 + 0.03, H), (-W / 2, H - 0.03)]
    slab = S.prism(pts, D, 0.03, 2, plane='XZ')
    S.translate(slab, (0, 0.72, 0.1))
    S.rotate(slab, lean, piv)
    add(m, slab, 'GySlab')
    yf = 0.72 - D / 2
    t = flat_text('1887', 0.1, (0.02, yf - 0.003, 0.1 + H * 0.62))
    S.rotate(t, lean, piv)
    add(m, t, 'Slate', 'sign')
    _engraving_lines(m, 0.02, yf, 0.1 + H * 0.4, (0.36, 0.28), lean=lean, pivot=piv)
    for k, (x, z, n, r) in enumerate(((0.0, 0.1 + H, (0, 0, 1), 0.2), (-0.3, 0.1 + H - 0.05, (-0.6, -0.5, 0.6), 0.12),
                                      (0.28, 0.25, (0.3, -1, 0.1), 0.1), (-0.12, 0.18, (0, -1, 0.0), 0.09))):
        blot = mold_blotch(x, 0.72 + (0.0 if k == 0 else -D / 2 + 0.01), z, r, n, seed=10 + k)
        add(m, S.rotate(blot, lean, piv), 'Moss' if k % 2 == 0 else 'GyLichen')
    # moss beard trailing down the left edge
    add(m, S.rotate(S.blob(0.06, 1, 0.3, 3.0, 7, loc=(-W / 2 + 0.02, 0.66, 0.1 + H * 0.6), scale=(0.7, 0.6, 2.2)),
                    lean, piv), 'Moss')
    _bouquet(m, j, (-0.12, 0.48, 0.1))


# ───────────────────────────── mound_soft ─────────────────────────────

@builder('mound_soft')
def mound_soft(m: Model, spec: LevelSpec) -> None:
    """Potter's Field soft mound: two lumpy humps of loose earth on a grassy skirt (an allotment heap, not a
    grave shape), sparse grass, a little toadstool."""
    j = m.rng
    add(m, dome(0.44, 0.86, 0.035, 2, 12, j.fork('skirt'), power=2.0, lump=0.3), 'Sod')
    add(m, dome(0.36, 0.45, 0.2, 3, 12, j, power=2.0, lump=0.22, loc=(0.03, -0.32, 0.0)), 'GyDirt')
    add(m, dome(0.33, 0.42, 0.17, 3, 12, j.fork('b'), power=2.0, lump=0.22, loc=(-0.04, 0.36, 0.0)), 'GyDirt')
    for k in range(2):
        add(m, S.grass_tuft(0.05, j.uniform(0.09, 0.14), 3, base=((-0.34, 0.33)[k], (0.05, -0.75)[k], 0.0), seed=k + 31),
            ('GyMoss', 'GrassDry')[k % 2])
    stem = S.cylinder(0.012, 0.05, 5, 0.0, base=(0.3, 0.72, 0.0))
    cap = S.lathe([(0.0, 0.045), (0.035, 0.05), (0.028, 0.07), (0.0, 0.078)], 6, base=(0.3, 0.72, 0.0))
    add(m, stem, 'Bone')
    add(m, cap, 'EnamelRed')
    # turned: fresh dark soil heaped on top, clods, two worms (hidden until dug; 24 h cooldown)
    node(m, 'turned', 'turned', origin=(0, 0, 0.18), transient=True)
    add(m, dome(0.33, 0.66, 0.27, 3, 12, j.fork('t'), power=2.0, lump=0.2, loc=(0, 0.05, 0)), 'GyDirtFresh', 'turned')
    for k in range(2):
        add(m, S.ico(0.05, 0, loc=(j.uniform(-0.3, 0.3), j.uniform(-0.6, 0.6), 0.2), scale=(1.1, 1, 0.7)),
            'SoilClod', 'turned')
    for k, (x, y) in enumerate(((0.12, -0.3),)):
        pts = [(x, y, 0.24), (x + 0.03, y + 0.02, 0.29), (x + 0.07, y - 0.01, 0.3), (x + 0.09, y + 0.02, 0.27)]
        add(m, S.tube(pts, 0.011, 4), 'Worm', 'turned')
    # blessed: faint toxic-green glow sheet hugging the mound + three motes (séance blessing, 24 h)
    node(m, 'glow', 'glow', origin=(0, 0, 0.2), transient=True)
    ring = S.torus(0.36, 0.012, 12, 3, loc=(0, 0, 0.05), rot=(0, 0, 0))
    S.xf(ring, scale=(1.0, 2.0, 1.0))
    add(m, ring, 'BlessGlow', 'glow')
    for k in range(2):
        add(m, S.ico(0.025, 0, loc=(j.uniform(-0.25, 0.25), j.uniform(-0.6, 0.6), 0.3 + 0.08 * k)), 'RuneGlow', 'glow')


# ───────────────────────────── heap_compost ─────────────────────────────

@builder('heap_compost')
def heap_compost(m: Model, spec: LevelSpec) -> None:
    """Slatted wooden bin (low front, tall back) heaped with leaves and peelings; steam wisps at dawn."""
    j = m.rng
    X, Y = 0.8, 0.72
    for sx in (-1, 1):
        for sy in (-1, 1):
            h = 0.92 if sy > 0 else 0.62
            add(m, S.box(0.09, 0.09, h + j.sym(0.03), 0.012, 1, base=(sx * X, sy * Y, 0), rot=(j.sym(2), j.sym(2), 0)),
                'WoodDark')
    for k in range(3):  # back
        add(m, S.box(1.62, 0.04, 0.16, 0.0, 0, base=(0, Y, 0.18 + k * 0.24), rot=(0, j.sym(2.5), 0)), 'Wood')
    for sx in (-1, 1):  # sides, stepping down toward the front
        for k in range(3):
            z = 0.18 + k * 0.24
            add(m, S.box(0.04, 1.44, 0.16, 0.0, 0, base=(sx * X, 0, z), rot=(j.sym(3) + (k == 2) * -8, 0, 0)), 'Wood')
    for k in range(2):  # low front
        add(m, S.box(1.62, 0.04, 0.15, 0.0, 0, base=(0, -Y, 0.06 + k * 0.24), rot=(0, j.sym(3), 0)), 'WoodLight')
    heap = S.blob(0.72, 2, 0.22, 2.3, 4, loc=(0, 0.05, 0.25), scale=(1.05, 0.95, 0.85), flat_bottom=-0.35)
    add(m, heap, 'GyDirt')
    for k in range(9):  # leaves + peelings + an eggshell scattered on top
        a = j.uniform(0, math.tau)
        r = j.uniform(0.1, 0.55)
        x, y = math.cos(a) * r, 0.05 + math.sin(a) * r * 0.85
        z = 0.25 + 0.72 * 0.85 * math.sqrt(max(0.0, 1 - (r / 0.78) ** 2)) - 0.03
        mat = ('LeafDead', 'Leaf', 'Peel')[k % 3]
        add(m, S.box(0.12, 0.07, 0.012, 0.0, 0, loc=(x, y, z), rot=(j.sym(25), j.sym(25), j.uniform(0, 180))), mat)
    add(m, S.sphere(0.05, 8, 4, loc=(0.25, -0.2, 0.86), scale=(1, 1, 0.6)), 'Porcelain')
    add(m, S.tube([(-0.2, -0.32, 0.8), (-0.17, -0.36, 0.86), (-0.12, -0.35, 0.88)], 0.013, 4), 'Worm')
    add(m, S.torus(0.09, 0.03, 10, 4, loc=(0.32, 0.25, 0.78), rot=(20, 10, 0), arc=200), 'Pumpkin')
    # steam wisps
    node(m, 'steam', 'steam', origin=(0, 0.05, 0.95), transient=True)
    for k in range(3):
        x0 = -0.3 + k * 0.3
        pts = [Vector((x0 + 0.05 * math.sin(t * 5 + k), 0.05 + 0.04 * math.cos(t * 4), 0.95 + t * 0.5))
               for t in (0.0, 0.25, 0.5, 0.75, 1.0)]
        add(m, S.tube(pts, radii=[0.02, 0.035, 0.035, 0.025, 0.0], segs=4), 'Steam', 'steam')


# ───────────────────────────── obelisk_founder ─────────────────────────────

@builder('obelisk_founder')
def obelisk_founder(m: Model, spec: LevelSpec) -> None:
    j = m.rng
    add(m, S.box(0.9, 0.9, 0.14, 0.02, 1, base=(0, 0, 0)), 'GyStoneDark')
    add(m, S.box(0.72, 0.72, 0.14, 0.02, 1, base=(0, 0, 0.14)), 'GyStone')
    add(m, S.box(0.56, 0.56, 0.5, 0.02, 1, base=(0, 0, 0.28)), 'Granite')
    add(m, S.box(0.62, 0.62, 0.06, 0.015, 1, base=(0, 0, 0.78)), 'GyStone')
    shaft = S.taper_box(0.4, 0.4, 0.24, 0.24, 1.32, 0.015, 1, base=(0, 0, 0.84))
    S.rotate(shaft, (j.sym(1.5), 1.2, 0), pivot=(0, 0, 0.84))
    add(m, shaft, 'Granite')
    tip = S.taper_box(0.26, 0.26, 0.01, 0.01, 0.18, 0.0, 0, base=(0.028, 0, 2.16))
    add(m, tip, 'Granite')
    urn = S.lathe([(0.0, 0.0), (0.05, 0.0), (0.035, 0.04), (0.08, 0.1), (0.09, 0.15), (0.06, 0.2), (0.07, 0.22),
                   (0.0, 0.24)], 10, base=(0.03, 0, 2.33))
    add(m, urn, 'Bronze')
    # plaque (front)
    add(m, S.box(0.44, 0.03, 0.28, 0.01, 1, base=(0, -0.29, 0.4)), 'Verdigris')
    add(m, flat_text('EZEKIEL', 0.06, (0, -0.307, 0.6)), 'Bone', 'sign')
    add(m, flat_text('WORMWOOD', 0.06, (0, -0.307, 0.53)), 'Bone', 'sign')
    add(m, flat_text('HE MEANT WELL', 0.038, (0, -0.307, 0.45)), 'Bone', 'sign')
    crack = S.jagged((0.12, -0.31, 0.75), (0.2, -0.31, 0.32), 4, 0.02, j)
    add(m, S.tube([Vector((p.x, -0.288, p.z)) for p in crack], 0.004, 3), 'Charcoal')
    add(m, mold_blotch(-0.2, -0.2, 0.28, 0.12, (-0.5, -0.5, 0.7), seed=1), 'Moss')
    add(m, mold_blotch(0.25, 0.3, 0.14, 0.12, (0.3, 0.3, 1), seed=2), 'Moss')
    add(m, mold_blotch(0.02, -0.13, 1.4, 0.06, (0, -1, 0.2), seed=3), 'GyLichen')
    _grass(m, j, 3, 0.42, (-0.45, 0.45))


# ───────────────────────────── plot_grub ─────────────────────────────

@builder('plot_grub')
def plot_grub(m: Model, spec: LevelSpec) -> None:
    j = m.rng
    X, Y = 0.42, 0.88
    for sx in (-1, 1):  # long planks
        add(m, S.box(0.05, 2 * Y, 0.16, 0.0, 0, base=(sx * X, 0, 0), rot=(0, j.sym(2), 0)), 'Planks')
    for sy in (-1, 1):
        add(m, S.box(2 * X, 0.05, 0.16, 0.0, 0, base=(0, sy * Y, 0), rot=(j.sym(2), 0, 0)), 'Planks')
    for sx in (-1, 1):
        for sy in (-1, 1):
            add(m, S.box(0.07, 0.07, 0.24, 0.0, 0, base=(sx * X, sy * Y, 0)), 'WoodDark')
    bed = S.slab(0.8, 1.7, 0.12, 2, 6)
    S.displace(bed, lambda v: v + Vector((0, 0, 0.025 * math.cos(v.y * 11.0))) if v.z > 0.11 else v)
    add(m, bed, 'GyDirt')
    add(m, S.tube([(0.1, -0.2, 0.15), (0.13, -0.18, 0.2), (0.17, -0.21, 0.21)], 0.011, 4), 'Worm')
    # sign on a stake at the back
    add(m, S.box(0.04, 0.04, 0.6, 0.008, 1, base=(0.2, Y - 0.02, 0.0), rot=(0, 3, 0)), 'WoodDark')
    add(m, S.box(0.46, 0.03, 0.16, 0.01, 1, base=(0.21, Y - 0.05, 0.56), rot=(0, -4, 0)), 'Pine')
    t = flat_text('WORM FARM', 0.055, (0.21, Y - 0.07, 0.64))
    S.rotate(t, (0, -4, 0), pivot=(0.21, Y - 0.05, 0.56))
    add(m, t, 'Ink', 'sign')
    # turned: dark dug pile with a cut hole
    node(m, 'turned', 'turned', origin=(0, 0, 0.12), transient=True)
    add(m, dome(0.28, 0.32, 0.2, 3, 10, j.fork('t'), power=2.0, lump=0.2, loc=(0, -0.3, 0.1)), 'GyDirtFresh', 'turned')
    add(m, S.cylinder(0.14, 0.012, 10, 0.0, base=(0.0, 0.35, 0.12)), 'Void', 'turned')
    add(m, S.tube([(-0.1, -0.35, 0.22), (-0.06, -0.33, 0.27), (-0.02, -0.36, 0.26)], 0.011, 4), 'Worm', 'turned')
