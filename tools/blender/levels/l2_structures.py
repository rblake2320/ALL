"""L2 structures: stairs_crypt (Gloam Vault), circle_seance (Moon Circle), fence_iron, gate_iron, env_spire."""
from __future__ import annotations

import math

from mathutils import Vector

from common import shapes as S
from common.model import Model
from objects.decor import crow
from objects.parts import cobweb, mold_blotch

from .kit import LevelSpec, add, builder, dome, flat_text, node


# ───────────────────────────── stairs_crypt ─────────────────────────────

@builder('stairs_crypt')
def stairs_crypt(m: Model, spec: LevelSpec) -> None:
    """Stone stairwell sunk into a raised kerb: treads step down from the front lip into darkness under a carved
    'GLOAM' arch at the back; an iron grille ('door', hinged on the left post) closes the mouth. The lot floor
    cannot be cut, so the descent is staged above it: a 0.42 m kerb, treads down to a black void."""
    j = m.rng
    K = 0.42          # kerb height
    X0, X1 = -0.95, 0.95
    Y0, Y1 = -0.95, 0.95
    # kerb walls (left/right/back) + front lip
    for sx in (-1, 1):
        add(m, S.box(0.22, 1.9, K, 0.02, 1, base=(sx * 0.84, 0.0, 0.0)), 'GyStone')
        add(m, S.box(0.28, 1.94, 0.06, 0.015, 1, base=(sx * 0.84, 0.0, K)), 'GyStoneWarm')
    add(m, S.box(1.46, 0.22, K, 0.02, 1, base=(0, 0.84, 0.0)), 'GyStone')
    add(m, S.box(1.46, 0.16, K - 0.06, 0.02, 1, base=(0, -0.87, 0.0)), 'GyStoneWarm')
    # descending treads (front high -> back low) and the darkness at the bottom
    n = 5
    for k in range(n):
        top = K - 0.06 - k * 0.075
        y = -0.72 + k * 0.26
        add(m, S.box(1.44, 0.28, max(0.03, top), 0.01, 1, base=(0, y, 0.0)), 'GyStoneDark' if k % 2 else 'GySlab')
    add(m, S.box(1.44, 0.3, 0.012, 0.0, 0, base=(0, 0.6, 0.0)), 'Void')
    add(m, S.box(1.44, 0.02, K + 0.2, 0.0, 0, base=(0, 0.72, 0.0)), 'Void')
    # back arch with the carved lintel
    for sx in (-1, 1):
        add(m, S.box(0.26, 0.3, 1.75, 0.025, 1, base=(sx * 0.82, 0.8, 0.0)), 'GyStone')
        add(m, S.box(0.32, 0.36, 0.12, 0.02, 1, base=(sx * 0.82, 0.8, 1.75)), 'GyStoneWarm')
    arch = []
    for k in range(9):
        a = math.pi * k / 8
        arch.append((math.cos(a) * 0.82, 0.8, 1.82 + math.sin(a) * 0.36))
    add(m, S.tube(arch, 0.12, 6), 'GyStone')
    add(m, S.box(1.12, 0.26, 0.26, 0.02, 1, base=(0, 0.8, 1.55)), 'GyStoneWarm')
    add(m, S.prism([(-0.3, 0.0), (0.3, 0.0), (0.0, 0.22)], 0.2, 0.015, 1, plane='XZ', loc=(0, 0.82, 2.0)), 'GyStoneWarm')
    add(m, S.sphere(0.06, 8, 6, loc=(0, 0.8, 2.3)), 'GyStoneWarm')
    add(m, flat_text('GLOAM', 0.15, (0, 0.665, 1.68)), 'Slate', 'sign')
    add(m, S.box(1.12, 0.19, 1.5, 0.0, 0, base=(0, 0.90, 0.0)), 'Void')  # the dark doorway behind the arch, on the 2 x 2 (W-073)
    # moss + cobweb
    add(m, mold_blotch(-0.75, -0.2, K + 0.06, 0.14, (0, 0, 1), seed=1), 'Moss')
    add(m, mold_blotch(0.6, 0.66, 1.2, 0.1, (0, -1, 0.1), seed=2), 'Moss')
    add(m, cobweb((0.7, 0.64, 1.53), 0.22, ('x', 'z'), (-1, -1)), 'Cobweb')
    # iron grille across the mouth, hinged at the left post (opens inward, toward +Y)
    hx = -0.72
    node(m, 'door', 'door', origin=(hx, -0.78, 0.0), hinge='left', swing=-100)
    gw = 1.44
    add(m, S.box(gw, 0.04, 0.04, 0.006, 1, base=(hx + gw / 2, -0.78, 0.08)), 'Iron', 'door')
    add(m, S.box(gw, 0.04, 0.04, 0.006, 1, base=(hx + gw / 2, -0.78, 1.02)), 'Iron', 'door')
    for k in range(9):
        x = hx + 0.05 + k * (gw - 0.1) / 8
        add(m, S.cylinder(0.014, 1.08, 6, 0.0, base=(x, -0.78, 0.04)), 'Iron', 'door')
        add(m, S.cone(0.032, 0.09, 6, base=(x, -0.78, 1.1)), 'Iron', 'door')
    add(m, S.box(0.14, 0.05, 0.18, 0.01, 1, base=(hx + gw - 0.12, -0.8, 0.5)), 'Iron', 'door')
    add(m, S.torus(0.035, 0.008, 8, 3, loc=(hx + gw - 0.12, -0.83, 0.56), rot=(90, 0, 0)), 'Brass', 'door')
    add(m, S.box(0.12, 0.04, 0.03, 0.0, 0, base=(hx + gw - 0.12, -0.84, 0.55)), 'Black', 'door')  # 3-part keyhole slot
    for sx in (-1, 1):
        add(m, S.box(0.1, 0.1, 1.16, 0.015, 1, base=(sx * 0.77, -0.78, 0.0)), 'Iron')
        add(m, S.sphere(0.06, 8, 6, loc=(sx * 0.77, -0.78, 1.2)), 'Iron')


# ───────────────────────────── circle_seance ─────────────────────────────

@builder('circle_seance')
def circle_seance(m: Model, spec: LevelSpec) -> None:
    j = m.rng
    add(m, dome(1.28, 1.28, 0.06, 2, 20, j, power=2.0, lump=0.05), 'GyMoss')
    add(m, S.cylinder(0.92, 0.05, 24, 0.015, base=(0, 0, 0.02)), 'GyStoneDark')
    add(m, S.torus(0.92, 0.035, 20, 4, loc=(0, 0, 0.065)), 'GyStone')
    # moon-rune inlay (glows on full moon): crescent + ring of 8 rune dots
    node(m, 'glow', 'glow', origin=(0, 0, 0.075), transient=True)
    cres = []
    for k in range(13):
        a = math.radians(-120 + 240 * k / 12)
        cres.append((math.cos(a) * 0.32, math.sin(a) * 0.32))
    for k in range(13):
        a = math.radians(120 - 240 * k / 12)
        cres.append((math.cos(a) * 0.25 + 0.1, math.sin(a) * 0.26))
    add(m, S.prism(cres, 0.012, 0.0, 0, plane='XY', loc=(0, 0, 0.07)), 'RuneGlow', 'glow')
    for k in range(8):
        a = math.tau * k / 8 + math.pi / 8
        rune = S.box(0.12, 0.03, 0.01, 0.0, 0, loc=(math.cos(a) * 0.68, math.sin(a) * 0.68, 0.075),
                     rot=(0, 0, math.degrees(a) + 90))
        tick = S.box(0.03, 0.08, 0.01, 0.0, 0, loc=(math.cos(a) * 0.72, math.sin(a) * 0.72, 0.075),
                     rot=(0, 0, math.degrees(a) + 90 + (35 if k % 2 else -35)))
        add(m, S.merge(rune, tick), 'RuneGlow', 'glow')
    # 8 worn standing stones on the rim
    for k in range(8):
        a = math.tau * k / 8 + 0.2
        h = (1.05, 0.7, 0.92, 0.62, 1.1, 0.78, 0.95, 0.66)[k]
        w = j.uniform(0.22, 0.3)
        st = S.taper_box(w, 0.18, w * 0.75, 0.13, h, 0.035, 1)
        S.rotate(st, (j.sym(5), j.sym(6), math.degrees(a) + 90))
        S.translate(st, (math.cos(a) * 1.2, math.sin(a) * 1.2, 0.0))
        add(m, st, 'GyStone' if k % 2 else 'GyStoneWarm')
        if k % 2 == 0:
            add(m, mold_blotch(math.cos(a) * 1.2, math.sin(a) * 1.2, h - 0.02, 0.09, (0, 0, 1), seed=k), 'Moss')
        # candle stub at the inner foot of each stone
        cx, cy = math.cos(a) * 1.0, math.sin(a) * 1.0
        add(m, S.cylinder(0.03, 0.06 + 0.03 * (k % 3), 8, 0.0, base=(cx, cy, 0.07)), 'Wax')
    node(m, 'flame', 'flame', origin=(0, 0, 0.2), transient=True, flicker='candle')
    for k in range(8):
        a = math.tau * k / 8 + 0.2
        cx, cy = math.cos(a) * 1.0, math.sin(a) * 1.0
        add(m, S.flame(0.07, 0.02, base=(cx, cy, 0.13 + 0.03 * (k % 3))), 'CandleFlame', 'flame')


# ───────────────────────────── fence_iron / gate_iron ─────────────────────────────

@builder('fence_iron')
def fence_iron(m: Model, spec: LevelSpec) -> None:
    """One wrought-iron segment on a tile edge (x -0.5..0.5 along the edge, centred on it). Its post is at x = -0.5,
    so a run of segments shares posts (the last post of a run is the next gate's/segment's)."""
    j = m.rng
    H = 1.08
    add(m, S.box(0.07, 0.07, H, 0.0, 0, base=(-0.5 + 0.035, 0.0, 0.0)), 'Iron')
    add(m, S.sphere(0.045, 6, 4, loc=(-0.465, 0.0, H + 0.02)), 'Iron')
    for z in (0.13, 0.9):
        add(m, S.box(0.93, 0.025, 0.03, 0.0, 0, base=(0.035, 0.0, z)), 'Iron')
    for k in range(6):
        x = -0.36 + k * 0.155
        lean = j.sym(2.5) if k != 3 else 6.0
        bar = S.merge(S.box(0.018, 0.018, 0.98, 0.0, 0, base=(0, 0, 0.0)), S.cone(0.028, 0.08, 4, base=(0, 0, 0.98)))
        S.rotate(bar, (0, lean, 45 * 0))
        add(m, S.translate(bar, (x, 0.0, 0.0)), 'Iron')


@builder('gate_iron')
def gate_iron(m: Model, spec: LevelSpec) -> None:
    """Two-leaf gate for one tile edge: stout posts with ball finials, leaves with an arched top rail and curls.
    Leaves are 'door' (left hinge) and 'door_b' (right hinge, mirrored swing)."""
    H = 1.15
    for sx in (-1, 1):
        add(m, S.box(0.1, 0.1, H + 0.12, 0.015, 1, base=(sx * 0.45, 0.0, 0.0)), 'Iron')
        add(m, S.box(0.13, 0.13, 0.04, 0.01, 1, base=(sx * 0.45, 0.0, H + 0.12)), 'Iron')
        add(m, S.sphere(0.06, 8, 6, loc=(sx * 0.45, 0.0, H + 0.22)), 'Iron')
        add(m, S.cone(0.02, 0.07, 6, base=(sx * 0.45, 0.0, H + 0.27)), 'Iron')
    for name, sx, hinge in (('door', -1, 'left'), ('door_b', 1, 'right')):
        hx = sx * 0.4
        node(m, name, 'door', origin=(hx, 0.0, 0.0), hinge=hinge, swing=95 * (-sx))
        L = 0.4
        x0 = hx
        x1 = hx - sx * L
        add(m, S.box(L, 0.03, 0.035, 0.0, 0, base=((x0 + x1) / 2, 0.0, 0.08)), 'Iron', name)
        add(m, S.box(0.035, 0.03, H - 0.05, 0.0, 0, base=(x0 - sx * 0.02, 0.0, 0.05)), 'Iron', name)
        add(m, S.box(0.035, 0.03, H - 0.25, 0.0, 0, base=(x1 + sx * 0.02, 0.0, 0.05)), 'Iron', name)
        top = [(x0 - sx * 0.02, 0.0, H), (x0 - sx * 0.2, 0.0, H - 0.08), (x1 + sx * 0.02, 0.0, H - 0.2)]
        add(m, S.tube(S.catmull(top, 3), 0.016, 4), 'Iron', name)
        for k in range(4):
            t = (k + 1) / 5
            x = x0 + (x1 - x0) * t
            ztop = H - 0.2 * t * t - 0.04
            add(m, S.cylinder(0.011, ztop - 0.08, 4, 0.0, base=(x, 0.0, 0.08)), 'Iron', name)
            add(m, S.cone(0.022, 0.06, 4, base=(x, 0.0, ztop)), 'Iron', name)
        add(m, S.tube(S.spiral(0.01, 0.06, 1.2, 9, center=((x0 + x1) / 2, 0.0, 0.45), plane='XZ',
                               a0=0 if sx < 0 else 180), 0.008, 3), 'Iron', name)
    add(m, S.torus(0.04, 0.009, 8, 3, loc=(0.0, -0.03, 0.62), rot=(90, 0, 0)), 'Brass', 'door')


# ───────────────────────────── env_spire ─────────────────────────────

@builder('env_spire')
def env_spire(m: Model, spec: LevelSpec) -> None:
    """Church spire silhouette for the far background (40 m back, fog-faded): a square stone tower with lancet
    belfry openings and a bell, a tall slate spire leaning a touch, a weathervane crow. Original design."""
    j = m.rng
    W = 3.2
    add(m, S.box(W + 0.5, W + 0.5, 0.6, 0.04, 1, base=(0, 0, 0)), 'GyStoneDark')
    add(m, S.taper_box(W, W, W * 0.94, W * 0.94, 6.8, 0.04, 1, base=(0, 0, 0.6)), 'Spire')
    for z in (2.6, 5.2):
        add(m, S.box(W * 0.98, W * 0.98, 0.18, 0.02, 1, base=(0, 0, z)), 'GyStone')
    for k in range(4):  # corner buttresses
        a = math.tau * k / 4 + math.pi / 4
        add(m, S.taper_box(0.5, 0.5, 0.3, 0.3, 5.0, 0.03, 1, base=(math.cos(a) * W * 0.68, math.sin(a) * W * 0.68, 0.6)),
            'GyStone')
    # lancet openings on all four faces (dark) + a glowing clock-less round window front
    for face in range(4):
        rz = 90 * face
        for xo in (-0.55, 0.55):
            pts = [(-0.28, 0.0), (0.28, 0.0), (0.28, 1.2), (0.0, 1.7), (-0.28, 1.2)]
            op = S.prism(pts, 0.1, 0.0, 0, plane='XZ', loc=(xo, -W * 0.47 - 0.02, 5.5))
            S.rotate(op, (0, 0, rz))
            add(m, op, 'Void')
        door = S.prism([(-0.5, 0.0), (0.5, 0.0), (0.5, 1.6), (0.0, 2.3), (-0.5, 1.6)], 0.1, 0.0, 0, plane='XZ',
                       loc=(0, -W * 0.5 - 0.03, 0.6))
        S.rotate(door, (0, 0, rz))
        add(m, door, 'WoodEbony' if face == 0 else 'Spire')
    add(m, S.cylinder(0.42, 0.1, 16, 0.0, base=(0, -W * 0.48, 3.8), rot=(90, 0, 0)), 'WindowGlass')
    add(m, S.lathe([(0.0, 0.0), (0.3, 0.05), (0.42, 0.45), (0.48, 0.6), (0.0, 0.62)], 10, base=(0, 0, 5.9)),
        'BellBronze')
    # spire
    sp = S.taper_box(W * 1.02, W * 1.02, 0.05, 0.05, 7.4, 0.02, 1, base=(0, 0, 7.4))
    S.rotate(sp, (1.2, -1.5, 45), pivot=(0, 0, 7.4))
    add(m, sp, 'SpireRoof')
    add(m, S.box(W * 1.1, W * 1.1, 0.25, 0.03, 1, base=(0, 0, 7.3)), 'GyStone')
    for k in range(4):  # pinnacles
        a = math.tau * k / 4 + math.pi / 4
        add(m, S.cone(0.22, 1.2, 4, base=(math.cos(a) * W * 0.66, math.sin(a) * W * 0.66, 7.55)), 'GyStone')
    tip = Vector((0.13, -0.11, 14.75))
    add(m, S.cylinder(0.04, 0.9, 6, 0.0, base=tuple(tip)), 'Iron')
    add(m, S.box(0.6, 0.04, 0.04, 0.0, 0, base=(tip.x, tip.y, tip.z + 0.5)), 'Iron')
    crow(m, Vector((tip.x, tip.y, tip.z + 0.85)), 30, 3.0, 'Iron')
