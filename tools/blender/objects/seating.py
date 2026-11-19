"""Seating: dining chairs, armchair, sofas, pew. Seat tops at SEAT_HEIGHT, backs at Blender +Y (= Three -Z)."""
from __future__ import annotations

import math

from common import dims
from common import shapes as S
from common.catalog import Spec
from common.model import Model

from .parts import leg, mold_blotch, mushroom, stuffing_tuft, turned_leg, bun_foot, nail_heads
from .registry import builder

SH = dims.SEAT_HEIGHT

# Upholstered seats share one seat frame, measured from the catalog slot root (the sitter's rig root; Three +Z =
# Blender -Y is the sitter's front). The shared sit* clips plant the pelvis at SEAT_HEIGHT over the root, slope the
# thighs down to knees ~0.21-0.27 m ahead of it and stand the shins/feet on the floor from ~0.15 m ahead of it
# (docs/contract-requests/seating.md), so a seat must not have solid volume there:
#   SEAT_BACK  backrest face at lumbar height (SEAT_HEIGHT + 0.22) behind the root      -> catalog seat.back
#   SEAT_LIP   front lip of the seat cushion ahead of the root                          -> catalog seat.front
#   SEAT_KICK  recessed base face ahead of the root (negative = behind it): the space under the front of the
#              seat stays open (tucked feet, calves under the thighs), the seat cushion is a 10 cm slab on top
# tests/unit/seating raycasts the GLBs and checks these against the catalog and every body's legs.
SEAT_BACK = 0.11
SEAT_LIP = 0.17
SEAT_KICK = -0.06
CUSHION_T = 0.10


@builder('chair_creaky')
def chair_creaky(m: Model, spec: Spec) -> None:
    j = m.rng
    seat_t = 0.06
    sx, sy = 0.48, 0.46
    m.add(S.box(sx, sy, seat_t, 0.014, 2, base=(0, 0, SH - seat_t), rot=(j.sym(1.0), j.sym(1.0), 0)))
    # legs (front-right one short, propped on a folded paper wedge)
    lx, ly = 0.19, 0.18
    for sxn in (-1, 1):
        for sy_ in (-1, 1):
            short = 0.025 if (sxn > 0 and sy_ < 0) else 0.0
            sp = (sxn * 0.012, sy_ * 0.012)
            m.add(leg(sxn * lx, sy_ * ly, SH - seat_t + 0.005, 0.052, 0.042, sp, short=short))
    m.add(S.taper_box(0.07, 0.07, 0.07, 0.01, 0.025, 0.003, 1, base=(0.2, -0.19, 0)), 'Paper')
    # back posts lean back a little
    for sxn in (-1, 1):
        post = S.taper_box(0.05, 0.05, 0.042, 0.042, 0.95 - SH + seat_t, 0.008, 1, base=(0, 0, 0))
        S.rotate(post, (-6 + j.sym(1.5), sxn * j.uniform(0.5, 2), 0))
        m.add(S.translate(post, (sxn * lx, ly + 0.005, SH - seat_t)))
    # crooked slats: the middle one has come loose on one side
    for k, (z, tilt) in enumerate(((0.62, j.sym(2.5)), (0.74, 11.0), (0.88, j.sym(2.0)))):
        y = ly + 0.005 + math.tan(math.radians(6)) * (z - SH + seat_t) + 0.004
        w = 0.36 if k != 2 else 0.43
        h = 0.055 if k != 2 else 0.075
        slat = S.box(w, 0.028, h, 0.008, 2, loc=(0, 0, 0))
        # the middle slat (tilt 11 deg) hangs from its left nail with the right end dropped
        S.rotate(slat, (-6, tilt, 0), pivot=(-0.17, 0, 0) if k == 1 else (0, 0, 0))
        m.add(S.translate(slat, (0, y, z)))
    m.add(nail_heads([(0.15, 0.2, 0.745)], 0.007), 'Iron')
    # stretchers
    for sxn in (-1, 1):
        m.add(S.box(0.03, 2 * ly, 0.03, 0.006, 1, loc=(sxn * (lx + 0.004), 0, 0.17), rot=(j.sym(2), 0, 0)))
    m.add(S.box(2 * lx, 0.03, 0.03, 0.006, 1, loc=(0, -ly, 0.22), rot=(0, j.sym(2), 0)))


def _bone_leg(x: float, y: float, top: float, r: float = 0.022) -> 'bmesh.types.BMesh':
    """Femur-ish leg: knobbly double-condyle ends, slim waist."""
    prof = [(r * 1.55, 0.0), (r * 1.8, 0.022), (r * 1.35, 0.055), (r * 0.95, 0.12), (r * 0.85, top * 0.5),
            (r * 0.98, top - 0.08), (r * 1.5, top - 0.03), (r * 1.35, top)]
    leg_ = S.lathe(prof, 8, base=(x, y, 0))
    knob = S.sphere(r * 1.25, 6, 4, loc=(x + r * 0.9, y, r * 1.1))
    return S.merge(leg_, knob)


def _rib(y_spine: float, z: float, span: float, depth: float, r0: float, sx: int, droop: float = 0.05):
    """One rib: leaves the spine at the back centre, sweeps out and forward (toward -Y) around the sitter's back and
    curls in at the tip — the C-shape is what makes it read as a ribcage from the elevated camera."""
    pts = [(sx * 0.02, y_spine - 0.01, z), (sx * span * 0.45, y_spine - depth * 0.15, z + 0.012),
           (sx * span * 0.85, y_spine - depth * 0.5, z - droop * 0.4), (sx * span, y_spine - depth * 0.9, z - droop),
           (sx * span * 0.88, y_spine - depth * 1.15, z - droop * 1.3)]
    pts = S.catmull(pts, 2)
    n = len(pts)
    radii = [r0 * (1.0 - 0.45 * (i / (n - 1)) ** 1.5) for i in range(n)]
    return S.tube(pts, radii=radii, segs=5)


@builder('chair_ribcage')
def chair_ribcage(m: Model, spec: Spec) -> None:
    """Bone dining chair: femur legs, dark plum cushion, and a backrest that IS a ribcage — chunky vertebral column
    rising from the seat, five C-shaped rib pairs wrapping toward the sitter, a sternum-ish crest bone and a tiny
    grinning skull finial."""
    j = m.rng
    m.add(S.box(0.48, 0.46, 0.05, 0.016, 1, base=(0, 0, SH - 0.085)))
    m.add(S.cushion(0.45, 0.43, 0.075, sag=0.012, roundness=0.32, loc=(0, -0.01, SH - 0.032), segs=12, rings=6),
          'CushionDark')
    m.add(S.sphere(0.014, 6, 4, loc=(0, -0.01, SH + 0.002), scale=(1, 1, 0.5)), 'BlackVelvetButton')
    for sx in (-1, 1):
        for sy in (-1, 1):
            lg = _bone_leg(0, 0, SH - 0.08, 0.023)
            S.rotate(lg, (sy * 3.0, -sx * 3.0, 0))
            m.add(S.translate(lg, (sx * 0.19, sy * 0.18, 0)))
    # stretchers: two little bones between the legs
    for sx in (-1, 1):
        m.add(S.bone(0.34, 0.011, 1.8, loc=(sx * 0.19, 0, 0.16), rot=(0, 0, 90 + j.sym(4)), segs=5))
    # vertebral column (back centre) leaning back 8 degrees
    lean = math.tan(math.radians(8))
    y0 = 0.205
    top = 0.98
    n_vert = 6
    for k in range(n_vert):
        z = SH + 0.01 + k * (top - SH - 0.02) / n_vert
        y = y0 + lean * (z - SH)
        sz = 0.034 - k * 0.0018
        m.add(S.superellipsoid(sz, sz * 0.85, sz * 0.5, 0.6, 0.6, 6, 4, loc=(0, y, z), rot=(0, 0, j.sym(5))))
        if k % 2 == 0:
            m.add(S.cone(sz * 0.45, sz * 1.1, 4, base=(0, y + sz * 0.6, z), rot=(-70, 0, 0)))
    # ribs: five chunky pairs, shorter toward the top, wrapping forward around the sitter's back
    for k, z in enumerate((0.58, 0.67, 0.76, 0.85, 0.93)):
        ys = y0 + lean * (z - SH)
        span = 0.215 - 0.012 * k
        depth = 0.11 - 0.01 * k
        for sx in (-1, 1):
            m.add(_rib(ys, z, span, depth, 0.0185 - 0.0012 * k, sx))
    # posts: two long bones at the back corners (they carry the ribs visually and make the chair sturdy)
    for sx in (-1, 1):
        post = _bone_leg(0, 0, top - SH + 0.06, 0.018)
        S.rotate(post, (-8, sx * 2.5, 0))
        m.add(S.translate(post, (sx * 0.215, 0.2, SH - 0.08)))
    # crest bone across the top + skull finial on the spine
    m.add(S.bone(0.48, 0.017, 1.8, loc=(0, y0 + lean * (top - SH) + 0.01, top + 0.005), rot=(0, j.sym(2), 0), segs=6))
    sk, so = S.skull(0.045, loc=(0.0, y0 + lean * (top - SH) - 0.005, top + 0.055), rot=(-8, 0, 10), segs=10)
    m.add(sk)
    m.add(so, 'Black')


@builder('armchair_tattered')
def armchair_tattered(m: Model, spec: Spec) -> None:
    """Club armchair around the slot root (Three z = +0.02 -> Blender y = R = -0.02): a deep stuffed back + wings,
    side arms that run to the floor, and a seat whose lip / recessed base leave room for the sitter's shins."""
    j = m.rng
    W = 0.86
    R = -0.02                      # slot root (catalog pose z 0.52) in Blender y
    back_y = 0.40                  # rear face of the chair
    lip_y = R - SEAT_LIP           # cushion front
    kick_y = R - SEAT_KICK         # base front
    base_z = 0.11
    # recessed base under the seat (back to front kick)
    m.add(S.cushion(W - 0.06, back_y - kick_y, 0.25, sag=0.0, roundness=0.22, loc=(0, (back_y + kick_y) / 2, base_z + 0.125)))
    # seat cushion: from under the back pillow to the lip
    seat_back_y = R + SEAT_BACK + 0.08
    m.add(S.cushion(0.56, seat_back_y - lip_y, CUSHION_T, sag=0.012, roundness=0.32, puff=0.03,
                    loc=(0, (seat_back_y + lip_y) / 2, SH - CUSHION_T / 2 + 0.005), rot=(j.sym(1.0), j.sym(1.5), j.sym(2.0))))
    # side arms, floor to roll, running past the seat lip
    arm_front = lip_y - 0.07
    arm_d = back_y - arm_front
    for sx in (-1, 1):
        m.add(S.cushion(0.17, arm_d, 0.55, sag=0.0, roundness=0.3, loc=(sx * (W / 2 - 0.085), (back_y + arm_front) / 2, base_z + 0.275),
                        rot=(0, sx * j.uniform(0.5, 2.0), 0)))
        m.add(S.cylinder(0.07, arm_d - 0.02, 14, 0.03, base=(sx * (W / 2 - 0.085), arm_front + 0.01, 0.62), rot=(-90, 0, 0)))
    # tall back with wings; the lumbar pillow's face is the backrest face (SEAT_BACK behind the root)
    back = S.cushion(0.7, 0.2, 0.68, sag=0.0, roundness=0.3, puff=0.03, loc=(0, 0.3, 0.72))
    S.rotate(back, (-8, 0, 0), pivot=(0, 0.3, 0.42))
    m.add(back)
    pillow_t = 0.12
    m.add(S.cushion(0.56, pillow_t, 0.44, sag=0.0, roundness=0.4, puff=0.06, loc=(0, R + SEAT_BACK + pillow_t / 2 - 0.01, 0.68),
                    rot=(-10, 0, j.sym(2))))
    for sx in (-1, 1):
        wing = S.cushion(0.11, 0.36, 0.42, sag=0.0, roundness=0.35, loc=(sx * 0.35, 0.18, 0.82))
        S.rotate(wing, (-6, 0, sx * 12))
        m.add(wing)
    for sx in (-1, 1):
        for sy, y in ((-1, arm_front + 0.06), (1, 0.33)):
            m.add(turned_from_floor(sx * 0.34, y, base_z + 0.01), 'WoodDark')
    # patches with stitches + escaping stuffing
    m.add(S.box(0.14, 0.012, 0.12, 0.004, 1, loc=(0.2, 0.17, 0.82), rot=(-8, 9, 0)), 'PatchA')
    m.add(S.stitches((0.14, 0.16, 0.88), (0.27, 0.16, 0.86), 4, 0.01, (0, -1, 0)), 'Ink')
    m.add(S.box(0.012, 0.16, 0.12, 0.004, 1, loc=(-W / 2 + 0.002, 0.02, 0.42), rot=(6, 0, 0)), 'PatchB')
    m.add(stuffing_tuft(0.37, arm_front + 0.02, 0.66, 0.035, 3), 'Stuffing')
    m.add(stuffing_tuft(-0.2, lip_y + 0.01, 0.43, 0.03, 7), 'Stuffing')
    m.add(stuffing_tuft(-0.3, 0.33, 1.02, 0.028, 11), 'Stuffing')


def turned_from_floor(x: float, y: float, top: float):
    r = 0.028
    return S.lathe([(r * 0.8, 0.0), (r, 0.015), (r * 0.7, 0.04), (r * 0.9, top * 0.7), (r * 1.2, top)], 10, base=(x, y, 0))


@builder('sofa_moldy')
def sofa_moldy(m: Model, spec: Spec) -> None:
    """Two-seat sofa; slot roots at Blender y = 0 (catalog pose z 0.5). Seat lip / base kick per the seat frame."""
    j = m.rng
    W, D = 1.84, 0.86
    back_y = D / 2 - 0.02
    lip_y = -SEAT_LIP
    kick_y = -SEAT_KICK
    m.add(S.cushion(W - 0.06, back_y - kick_y, 0.26, sag=0.0, roundness=0.2, loc=(0, (back_y + kick_y) / 2, 0.23)))
    seat_back_y = SEAT_BACK + 0.08
    for i, sx in enumerate((-1, 1)):
        m.add(S.cushion(0.74, seat_back_y - lip_y, CUSHION_T + 0.02, sag=0.03, roundness=0.32, puff=0.03,
                        loc=(sx * 0.385, (seat_back_y + lip_y) / 2, SH - CUSHION_T / 2 + 0.005),
                        rot=(j.sym(1.5), sx * j.uniform(0.5, 2.0), j.sym(2.5))))
    back = S.cushion(W - 0.08, 0.22, 0.56, sag=0.0, roundness=0.25, loc=(0, 0.31, 0.62))
    m.add(back)
    arm_front = lip_y - 0.07
    arm_d = back_y + 0.01 - arm_front
    for sx in (-1, 1):
        bc = S.cushion(0.72, 0.16, 0.38, sag=0.0, roundness=0.38, puff=0.05, loc=(sx * 0.38, SEAT_BACK + 0.08, 0.64),
                       rot=(-12 + j.sym(3), 0, j.sym(3)))
        m.add(bc)
        m.add(S.cushion(0.2, arm_d, 0.52, sag=0.0, roundness=0.3, loc=(sx * (W / 2 - 0.1), (back_y + 0.01 + arm_front) / 2, 0.36),
                        rot=(0, sx * j.uniform(0.5, 2.0), 0)))
        m.add(S.cylinder(0.075, arm_d - 0.02, 14, 0.03, base=(sx * (W / 2 - 0.1), arm_front + 0.01, 0.6), rot=(-90, 0, 0)))
    for sx in (-1, 1):
        for y in (arm_front + 0.06, 0.33):
            m.add(S.taper_box(0.06, 0.06, 0.07, 0.07, 0.11, 0.01, 1, base=(sx * 0.82, y, 0)), 'WoodDark')
    # mold: blotches on cushions, arm and back; a mushroom colony on the left arm
    blots = [(-0.5, -0.06, SH - 0.005, 0.07, (0, 0, 1)), (0.25, 0.0, SH - 0.01, 0.05, (0, 0, 1)),
             (0.45, 0.2, 0.78, 0.08, (0, -1, 0.6)), (-0.2, 0.2, 0.64, 0.05, (0, -1, 0.4)),
             (0.88, 0.0, 0.62, 0.05, (1, 0, 0.5)), (-0.6, kick_y - 0.005, 0.25, 0.06, (0, -1, 0)),
             (0.1, 0.42, 0.75, 0.06, (0, 1, 0))]
    for k, (x, y, z, r, n) in enumerate(blots):
        m.add(mold_blotch(x, y, z, r, n, seed=k), 'Mold' if k % 2 == 0 else 'MoldDark')
    for k, (x, y, s) in enumerate(((-0.86, -0.04, 0.032), (-0.83, 0.08, 0.022), (-0.88, 0.16, 0.026))):
        stem, cap = mushroom(x, y, 0.665, s, lean=j.sym(12))
        m.add(stem, 'Bone')
        m.add(cap, 'BloodWine')
    m.add(stuffing_tuft(0.62, kick_y - 0.01, 0.33, 0.03, 5), 'Stuffing')


@builder('sofa_velvet')
def sofa_velvet(m: Model, spec: Spec) -> None:
    """Chesterfield three-seater; slot roots at Blender y = 0. Tufted back face, seat lip and base kick per the seat
    frame (SEAT_BACK / SEAT_LIP / SEAT_KICK)."""
    j = m.rng
    W, D = 2.86, 0.9
    back_y = D / 2 - 0.02
    lip_y = -SEAT_LIP
    kick_y = -SEAT_KICK
    m.add(S.cushion(W - 0.1, back_y - kick_y, 0.26, sag=0.0, roundness=0.18, loc=(0, (back_y + kick_y) / 2, 0.25)))
    seat_back_y = SEAT_BACK + 0.08
    for k in range(3):
        x = (k - 1) * 0.86
        m.add(S.cushion(0.84, seat_back_y - lip_y, CUSHION_T, sag=0.012, roundness=0.28, puff=0.02,
                        loc=(x, (seat_back_y + lip_y) / 2, SH - CUSHION_T / 2 + 0.005), rot=(0, 0, j.sym(1.0))))
    # tufted back: panel (face = backrest face) + diamond grid of buttons
    panel_t = 0.22
    py = SEAT_BACK + panel_t / 2
    m.add(S.cushion(W - 0.3, panel_t, 0.62, sag=0.0, roundness=0.2, loc=(0, py, 0.68)))
    # filler behind the panel up to the frame's rear face
    m.add(S.cushion(W - 0.3, back_y - py, 0.5, sag=0.0, roundness=0.2, loc=(0, (py + back_y) / 2, 0.62)))
    for row in range(3):
        z = 0.6 + row * 0.12
        n = 9 if row % 2 == 0 else 8
        for c in range(n):
            x = (c - (n - 1) / 2) * 0.27
            m.add(S.sphere(0.014, 6, 4, loc=(x, SEAT_BACK - 0.005, z)), 'BlackVelvetButton')
    m.add(S.cylinder(0.08, W - 0.34, 16, 0.03, base=(-(W - 0.34) / 2, py + 0.03, 0.95), rot=(0, 90, 0)))
    # rolled chesterfield arms (same height as the back roll), floor to roll, running past the seat lip
    arm_front = lip_y - 0.08
    arm_d = back_y + 0.02 - arm_front
    for sx in (-1, 1):
        m.add(S.cushion(0.2, arm_d, 0.62, sag=0.0, roundness=0.22, loc=(sx * (W / 2 - 0.1), (back_y + 0.02 + arm_front) / 2, 0.43)))
        m.add(S.cylinder(0.1, arm_d, 16, 0.035, base=(sx * (W / 2 - 0.08), arm_front, 0.74), rot=(-90, 0, 0)))
        m.add(S.lathe([(0.0, 0), (0.07, 0.0), (0.085, 0.012), (0.06, 0.02), (0.0, 0.022)], 14,
                      base=(sx * (W / 2 - 0.08), arm_front - 0.02, 0.74), rot=(90, 0, 0)), 'Gold')
        for row in range(2):
            for c in range(3):
                m.add(S.sphere(0.012, 6, 4, loc=(sx * (W / 2 - 0.2), arm_front + 0.1 + c * 0.2, 0.5 + row * 0.12)),
                      'BlackVelvetButton')
    for sx in (-1, 0, 1):
        for sy in (-1, 1):
            if sx == 0 and sy < 0:
                continue
            y = arm_front + 0.07 if sy < 0 else 0.34
            m.add(S.lathe([(0.04, 0), (0.055, 0.03), (0.045, 0.07), (0.06, 0.1), (0.05, 0.12)], 12,
                          base=(sx * (W / 2 - 0.12), y, 0)), 'WoodEbony')
    # a lace doily draped on the back roll and a black-edged mourning pillow tucked into the right arm
    m.add(S.cushion(0.3, 0.12, 0.28, sag=0.0, roundness=0.4, puff=0.1, loc=(1.27, SEAT_BACK + 0.06, 0.64), rot=(-14, 0, 55)),
          'BlackVelvetButton')
    m.add(S.box(0.3, 0.2, 0.006, 0.002, 1, loc=(-0.6, py + 0.02, 1.03), rot=(-12, 0, 6)), 'Lace')


@builder('pew_salvaged')
def pew_salvaged(m: Model, spec: Spec) -> None:
    j = m.rng
    L = 1.92
    # seat board from the back boards to the lip (SEAT_LIP ahead of the slot roots at Blender y = 0); the apron under
    # the lip is shallow and set back so the sitter's knees / shins pass in front of it
    seat_back_y = 0.21
    m.add(S.box(L - 0.1, seat_back_y + SEAT_LIP, 0.055, 0.012, 2, base=(0, (seat_back_y - SEAT_LIP) / 2, SH - 0.055),
                rot=(0, j.sym(0.6), 0)))
    m.add(S.box(L - 0.1, 0.04, 0.05, 0.01, 2, base=(0, -SEAT_KICK, SH - 0.1)))
    back = S.box(L - 0.1, 0.045, 0.5, 0.012, 2, base=(0, 0, 0))
    S.rotate(back, (-6, 0, 0))
    m.add(S.translate(back, (0, 0.2, SH + 0.02)))
    cap = S.box(L - 0.04, 0.09, 0.05, 0.015, 2, base=(0, 0, 0))
    S.rotate(cap, (-6, 0, 0))
    m.add(S.translate(cap, (0, 0.255, SH + 0.5)))
    for k in range(5):  # vertical back boards seams
        x = -0.72 + k * 0.36
        m.add(S.box(0.012, 0.02, 0.44, 0.003, 1, base=(x, 0.17 + 0.03, SH + 0.05), rot=(-6, 0, 0)), 'WoodDark')
    # carved end panels (YZ silhouette, extruded along X)
    prof = [(-0.25, 0.0), (0.28, 0.0), (0.3, 0.98), (0.24, 1.03), (0.16, 1.0), (0.1, 0.8), (0.02, 0.68),
            (-0.12, 0.66), (-0.2, 0.7), (-0.27, 0.66), (-0.24, 0.55), (-0.2, 0.5)]
    for sx in (-1, 1):
        panel = S.prism(prof, 0.06, 0.012, 2, plane='XZ')
        S.rotate(panel, (0, 0, 90))
        m.add(S.translate(panel, (sx * (L / 2 - 0.03), 0, 0)))
        m.add(S.torus(0.065, 0.012, 14, 5, loc=(sx * (L / 2 + 0.003), 0.04, 0.4), rot=(0, 90, 0)), 'WoodDark')
        m.add(S.box(0.012, 0.03, 0.17, 0.004, 1, loc=(sx * (L / 2 + 0.004), 0.04, 0.4)), 'WoodDark')
        m.add(S.box(0.012, 0.17, 0.03, 0.004, 1, loc=(sx * (L / 2 + 0.004), 0.04, 0.4)), 'WoodDark')
    # hymnal shelf behind + an abandoned hymnal on the seat
    m.add(S.box(L - 0.2, 0.1, 0.02, 0.005, 1, base=(0, 0.3, 0.66)))
    m.add(S.box(L - 0.2, 0.012, 0.07, 0.004, 1, base=(0, 0.35, 0.66)))
    m.add(S.box(0.13, 0.18, 0.035, 0.006, 1, base=(-0.81, 0.0, SH), rot=(0, 0, 9)), 'Book1')
    m.add(S.box(0.122, 0.17, 0.028, 0.004, 1, base=(-0.81, 0.0, SH + 0.004), rot=(0, 0, 9)), 'Paper')
