"""Kitchen appliances. Fronts face Blender -Y. Dynamic nodes: door (pivot at hinge), glow, flame, screen, water."""
from __future__ import annotations

import math

from mathutils import Vector

from common import dims
from common import shapes as S
from common.catalog import Spec
from common.model import Model

from .parts import add_broken, cabinet, drawer_pull, knob, leg
from .registry import builder

CH = dims.COUNTER_HEIGHT


def _fridge_shell(m: Model, W: float, D: float, H: float, y0: float, z0: float, bevel_top: float,
                  shell_mat: str = 'Paint', lining: str = 'Lining') -> tuple:
    """Hollow cabinet open at the front (y0 - D/2). Returns the interior box (x0,x1,y0,y1,z0,z1)."""
    t = 0.045
    yf, yb = y0 - D / 2, y0 + D / 2
    m.add(S.box(W, D, 0.13, bevel_top, 3, base=(0, y0, H - 0.13)), shell_mat)
    m.add(S.box(W, D, 0.1, 0.03, 2, base=(0, y0, z0)), shell_mat)
    for sx in (-1, 1):
        m.add(S.box(t, D, H - z0 - 0.2, 0.02, 2, base=(sx * (W / 2 - t / 2), y0, z0 + 0.08)), shell_mat)
    m.add(S.box(W - 0.02, t, H - z0 - 0.15, 0.01, 1, base=(0, yb - t / 2, z0 + 0.06)), shell_mat)
    ix0, ix1 = -W / 2 + t, W / 2 - t
    m.add(S.box(ix1 - ix0, 0.01, H - z0 - 0.24, 0.0, 0, base=(0, yb - t - 0.006, z0 + 0.1)), lining)
    m.add(S.box(ix1 - ix0, D - t - 0.02, 0.012, 0.0, 0, base=(0, y0 - 0.01, z0 + 0.1)), lining)
    return (ix0, ix1, yf, yb - t, z0 + 0.1, H - 0.13)


def _rrect(w: float, h: float, r_top: float, r_bot: float, n: int = 5, z0: float = 0.0):
    """CCW rounded rectangle in (u, v) (u across, v up from z0) with separate top/bottom corner radii."""
    pts = []
    corners = ((w / 2 - r_bot, z0 + r_bot, r_bot, -90.0), (w / 2 - r_top, z0 + h - r_top, r_top, 0.0),
               (-w / 2 + r_top, z0 + h - r_top, r_top, 90.0), (-w / 2 + r_bot, z0 + r_bot, r_bot, 180.0))
    for cu, cv, r, a0 in corners:
        if r <= 1e-4:
            pts.append((cu, cv))
            continue
        for k in range(n + 1):
            a = math.radians(a0 + 90.0 * k / n)
            pts.append((cu + math.cos(a) * r, cv + math.sin(a) * r))
    return pts


@builder('fridge_humming')
def fridge_humming(m: Model, spec: Spec) -> None:
    """Rounded 1950s fridge: big soft top corners, chunky chrome lever handle and badge, chrome kick grille, a few
    magnets and the BRAINS note. Door pivot 'door' at the left front edge swings toward +Z (Three) when in use;
    inside: wire shelves, questionable leftovers and a light ('glow', on while open)."""
    j = m.rng
    W, H = 0.76, 1.86
    yf, yb = -0.24, 0.32          # cabinet front/back (Blender y; front = -y)
    z0 = 0.1
    outer = _rrect(W, H - z0, 0.16, 0.035, 6, z0)
    inner = S.offset_outline(outer, 0.045)
    cab = S.outline_ring(outer, inner, -yb, -yf, 0.012, 1)
    S.rotate(cab, (90, 0, 0))
    m.add(cab)
    back = S.prism(outer, 0.03, 0.0, 0, plane='XY')
    S.rotate(back, (90, 0, 0))
    m.add(S.translate(back, (0, yb, 0)))
    liner = S.prism(inner, 0.01, 0.0, 0, plane='XY')
    S.rotate(liner, (90, 0, 0))
    m.add(S.translate(liner, (0, yb - 0.035, 0)), 'Lining')
    # plinth with a chrome kick grille + little feet
    m.add(S.box(W - 0.04, yb - yf - 0.02, z0, 0.012, 1, base=(0, (yf + yb) / 2 + 0.01, 0.0)), 'Black')
    for k in range(4):
        m.add(S.box(W - 0.12, 0.012, 0.012, 0.0, 0, base=(0, yf - 0.003, 0.018 + k * 0.02)), 'Chrome')
    for sx in (-1, 1):
        m.add(S.cylinder(0.024, 0.02, 8, 0.0, base=(sx * 0.31, yf + 0.04, 0.0)), 'Chrome')
    # interior: wire shelves + leftovers
    ix = W / 2 - 0.05
    for z in (0.62, 1.1, 1.45):
        m.add(S.box(2 * ix - 0.01, yb - yf - 0.1, 0.012, 0.0, 0, base=(0, (yf + yb) / 2, z)), 'Chrome')
    m.add(S.cylinder(0.07, 0.17, 10, 0.01, base=(-0.15, 0.12, 1.112)), 'Glass')
    m.add(S.blob(0.055, 1, 0.22, 4.0, 5, loc=(-0.15, 0.12, 1.18), scale=(1, 0.9, 0.8)), 'Brain')
    m.add(S.cylinder(0.074, 0.025, 10, 0.008, base=(-0.15, 0.12, 1.28)), 'Rust')
    m.add(S.cylinder(0.045, 0.22, 8, 0.0, base=(0.15, 0.16, 1.112)), 'Porcelain')
    m.add(S.cylinder(0.12, 0.03, 12, 0.0, base=(0.05, 0.1, 0.632)), 'Porcelain')
    m.add(S.blob(0.08, 1, 0.3, 3.0, 9, loc=(0.05, 0.1, 0.67), scale=(1, 0.8, 0.45)), 'SkinDark')
    m.add(S.bone(0.16, 0.012, 1.9, loc=(0.12, 0.05, 1.47), rot=(0, 0, 30), segs=6), 'Bone')
    m.node('glow', origin=(0, yb - 0.25, H - 0.17), extras={'part': 'glow', 'on': 'inUse'}, transient=True)
    m.add(S.box(0.16, 0.08, 0.025, 0.008, 1, loc=(0, yb - 0.25, H - 0.17)), 'GlowFridge', 'glow')
    # door: pivot at the left front edge; the leaf is the full rounded front
    dt = 0.075
    hinge = (-W / 2, yf - dt / 2, 0.0)
    m.node('door', origin=hinge, extras={'part': 'door', 'openAngle': -2.18, 'hingeSide': 'left'})   # 125 deg max: the leaf clears
    # the widest body (W-073 D1); hingeSide (object-local, seen from the front) tells the runtime which neighbour
    # tile the open leaf sweeps, so it can clamp the angle there
    m.node('door_leaf', parent='door', origin=hinge)
    door_o = _rrect(W - 0.006, H - z0 - 0.006, 0.155, 0.032, 6, z0 + 0.003)
    leaf = S.prism(door_o, dt, 0.028, 2, plane='XZ')
    m.add(S.translate(leaf, (0, yf - dt / 2, 0)), 'Paint', 'door_leaf')
    gasket = S.prism(S.offset_outline(door_o, 0.06), 0.03, 0.01, 1, plane='XZ')
    m.add(S.translate(gasket, (0, yf + 0.012, 0)), 'Lining', 'door_leaf')
    yfront = yf - dt
    # chunky chrome lever handle on the right + latch housing
    hx = W / 2 - 0.075
    m.add(S.box(0.05, 0.03, 0.11, 0.012, 2, base=(hx, yfront - 0.012, 1.1)), 'Chrome', 'door_leaf')
    lever = S.catmull([(hx, yfront - 0.03, 1.16), (hx, yfront - 0.07, 1.12), (hx, yfront - 0.08, 0.98),
                       (hx, yfront - 0.06, 0.86)], 3)
    m.add(S.tube(lever, radii=[0.018, 0.019, 0.02, 0.02, 0.019, 0.018, 0.017, 0.016, 0.016, 0.015], segs=8),
          'Chrome', 'door_leaf')
    # chrome badge + trim stripe
    m.add(S.superellipsoid(0.11, 0.006, 0.03, 0.5, 0.5, 12, 6, loc=(0, yfront - 0.002, H - 0.26)), 'Chrome', 'door_leaf')
    m.add(S.box(0.13, 0.004, 0.012, 0.0, 0, loc=(0, yfront - 0.008, H - 0.26)), 'BloodWine', 'door_leaf')
    m.add(S.box(W - 0.14, 0.004, 0.012, 0.0, 0, loc=(0, yfront - 0.001, 0.32)), 'Chrome', 'door_leaf')
    # magnets + the BRAINS note
    note = S.box(0.17, 0.004, 0.13, 0.0015, 1, loc=(-0.12, yfront - 0.003, 1.28), rot=(0, 7, 0))
    m.add(note, 'Paper', 'door_leaf')
    m.add(S.text('BRAINS', 0.034, 0.002, loc=(-0.12, yfront - 0.006, 1.28), rot=(90, 7, 0), resolution=1), 'Blood',
          'door_leaf')
    for k, (x, z, mat) in enumerate(((-0.12, 1.35, 'Magnet1'), (0.1, 1.2, 'Magnet2'), (-0.2, 0.98, 'Magnet3'),
                                     (0.05, 1.45, 'Magnet2'))):
        m.add(S.cylinder(0.018, 0.012, 8, 0.0, base=(x, yfront + 0.001, z), rot=(90, 0, 0)), mat, 'door_leaf')
    add_broken(m, (0.0, 0.05, H + 0.06))


@builder('fridge_cryo')
def fridge_cryo(m: Model, spec: Spec) -> None:
    """Sleek stainless cryo-freezer: a finned compressor housing on top feeding a frosty chrome coolant pipe down
    the side, a full-height icy LED strip beside the chunky lever handle plus a '-196' display with a snowflake
    (node "glow", on the door so it swings with it), frost crust, icicles and a cold mist puddle at its feet
    (node "frost", visible while powered). Door pivot "door" at the front-left edge."""
    W, D, H = 0.8, 0.7, 1.9
    y0 = 0.1
    m.mats.paint_spec(spec.variants[0], roughness=0.32, metallic=0.75)
    ix0, ix1, yf, yb, iz0, iz1 = _fridge_shell(m, W, D, H, y0, 0.04, 0.02, 'Paint', 'LiningCryo')
    m.add(S.box(W - 0.06, 0.02, 0.05, 0.004, 1, base=(0, yf - 0.002, 0.0)), 'Black')
    for z in (0.55, 1.0, 1.42):
        m.add(S.box(ix1 - ix0 - 0.01, yb - yf - 0.08, 0.015, 0.004, 1, base=(0, (yf + yb) / 2 + 0.02, z)), 'Glass')
    for k, (x, z) in enumerate(((-0.15, 1.015), (0.12, 1.015), (0.0, 0.565))):
        m.add(S.box(0.16, 0.14, 0.06, 0.01, 1, base=(x, 0.15, z), rot=(0, 0, 8 * (k - 1.5))), 'Paper')
        m.add(S.blob(0.05, 1, 0.2, 3.0, k, loc=(x, 0.15, z + 0.07), scale=(1.2, 1, 0.4)), 'Brain')
    # compressor housing on top: chrome-capped box, dark vent slats, two cooling fins
    m.add(S.box(0.64, 0.46, 0.16, 0.03, 2, base=(0, y0 + 0.04, H - 0.005)), 'SheetMetal')
    m.add(S.box(0.66, 0.48, 0.025, 0.01, 1, base=(0, y0 + 0.04, H + 0.15)), 'Chrome')
    for k in range(4):
        m.add(S.box(0.44, 0.012, 0.016, 0.0, 0, loc=(-0.06, y0 + 0.04 - 0.232, H + 0.035 + k * 0.03)), 'Black')
    for sx in (-1, 1):
        m.add(S.box(0.012, 0.3, 0.1, 0.004, 1, base=(sx * 0.33, y0 + 0.06, H + 0.02)), 'Chrome')
    m.add(S.cylinder(0.026, 0.012, 10, 0.0, base=(0.23, y0 + 0.04 - 0.236, H + 0.075), rot=(90, 0, 0)), 'Chrome')
    # coolant pipe: out of the compressor, down the right side, back into the cabinet near the floor
    pipe = S.catmull([(0.3, y0 + 0.1, H + 0.04), (W / 2 + 0.05, y0 + 0.1, H - 0.05), (W / 2 + 0.05, y0 + 0.12, 1.2),
                      (W / 2 + 0.05, y0 + 0.18, 0.4), (W / 2 + 0.02, y0 + 0.2, 0.18)], 3)
    m.add(S.tube(pipe, 0.026, 6), 'Copper')
    for q in (3, 9):
        if q < len(pipe):
            m.add(S.torus(0.03, 0.008, 8, 3, loc=pipe[q]), 'Chrome')
    hinge = (-W / 2, yf - 0.035, 0.0)
    m.node('door', origin=hinge, extras={'part': 'door', 'openAngle': -2.18, 'hingeSide': 'left'})   # 125 deg max: the leaf clears
    # the widest body (W-073 D1); hingeSide (object-local, seen from the front) tells the runtime which neighbour
    # tile the open leaf sweeps, so it can clamp the angle there
    m.node('door_leaf', parent='door', origin=hinge)
    dz0, dz1 = 0.07, H - 0.14
    m.add(S.box(W, 0.07, dz1 - dz0, 0.015, 2, base=(0, yf - 0.035, dz0)), 'Paint', 'door_leaf')
    # chunky lever handle on stand-offs
    hx = W / 2 - 0.085
    m.add(S.box(0.034, 0.045, 0.9, 0.014, 2, base=(hx, yf - 0.115, 0.5)), 'Chrome', 'door_leaf')
    for z in (0.53, 1.36):
        m.add(S.box(0.028, 0.06, 0.04, 0.008, 1, base=(hx, yf - 0.085, z)), 'Chrome', 'door_leaf')
    # specimen label: parchment tag with a blue snowflake and two ink 'lines'
    m.add(S.box(0.24, 0.006, 0.11, 0.003, 1, base=(-0.12, yf - 0.071, 0.6)), 'Parchment', 'door_leaf')
    for ang in (0, 60, 120):
        m.add(S.box(0.07, 0.004, 0.011, 0.0, 0, loc=(-0.19, yf - 0.076, 0.655), rot=(0, ang, 0)), 'Lapis', 'door_leaf')
    for z in (0.675, 0.635):
        m.add(S.box(0.1, 0.004, 0.012, 0.0, 0, loc=(-0.08, yf - 0.076, z)), 'Ink', 'door_leaf')
    # icy LED: full-height strip beside the handle + display with a snowflake (glow swings with the door)
    m.node('glow', parent='door_leaf', origin=(-0.1, yf - 0.072, 1.38), extras={'part': 'glow'}, transient=True)
    m.add(S.box(0.026, 0.012, 1.42, 0.006, 1, base=(W / 2 - 0.03, yf - 0.072, 0.2)), 'GlowCryo', 'glow')
    m.add(S.box(0.36, 0.012, 0.17, 0.008, 1, loc=(-0.1, yf - 0.072, 1.38)), 'GlowCryo', 'glow')
    m.add(S.box(0.38, 0.008, 0.19, 0.004, 1, loc=(-0.1, yf - 0.066, 1.38)), 'Black', 'door_leaf')
    m.add(S.text('-196', 0.06, 0.004, loc=(-0.05, yf - 0.08, 1.38)), 'Black', 'glow')
    for a in (0, 60, 120):
        m.add(S.box(0.07, 0.004, 0.012, 0.0, 0, loc=(-0.205, yf - 0.08, 1.38), rot=(0, a, 0)), 'Black', 'glow')
    # frost crust along the top front edge with icicles, frosty pipe joints, cold mist pooling at the feet
    m.node('frost', origin=(0, yf, H), extras={'part': 'frost'}, transient=True)
    j = m.rng.fork('frost')
    for k in range(6):
        x = -W / 2 + 0.06 + k * (W - 0.12) / 5
        m.add(S.blob(0.048, 1, 0.35, 3.0, k, loc=(x, yf - 0.03, H - 0.005), scale=(1.4, 1.0, 0.55)), 'Frost', 'frost')
        if k % 2 == 1 or k == 0:
            m.add(S.cone(0.013, j.uniform(0.06, 0.13), 6, base=(x, yf - 0.06, H - 0.12), rot=(180, 0, 0)), 'Ice',
                  'frost')
    for k in range(3):
        z = 0.3 + k * 0.5
        m.add(S.blob(0.034, 1, 0.35, 3.0, 20 + k, loc=(W / 2 + 0.005, yf - 0.02, z), scale=(0.5, 1.0, 2.0)), 'Frost',
              'frost')
    for q in (5, 11):
        if q < len(pipe):
            m.add(S.ico(0.03, 1, loc=pipe[q], scale=(1.0, 1.0, 0.8)), 'Frost', 'frost')
    m.add(S.blob(0.2, 1, 0.3, 2.2, 7, loc=(0.02, yf - 0.12, 0.02), scale=(1.6, 0.5, 0.1)), 'Mist', 'frost')
    add_broken(m, (0.0, 0.1, H + 0.2))


def _coil(x: float, y: float, z: float, r: float = 0.075, turns: float = 2.6):
    pts = S.spiral(0.018, r, turns, 20, center=(x, y, z), plane='XY')
    return S.tube(pts, 0.008, 4)


@builder('stove_greasefire')
def stove_greasefire(m: Model, spec: Spec) -> None:
    j = m.rng
    W, D = 0.78, 0.68
    y0 = 0.1
    yf = y0 - D / 2
    m.add(S.box(W, D, CH - 0.07, 0.03, 2, base=(0, y0, 0.07)))
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.add(leg(sx * (W / 2 - 0.05), y0 + sy * (D / 2 - 0.06), 0.075, 0.05, 0.035), 'Chrome')
    m.add(S.box(W + 0.01, D + 0.01, 0.025, 0.01, 1, base=(0, y0, CH - 0.02)), 'Paint')
    m.add(S.box(W, 0.07, 0.15, 0.025, 2, base=(0, y0 + D / 2 - 0.035, CH)), 'Paint')
    m.add(S.superellipsoid(0.07, 0.004, 0.045, 0.4, 0.4, 12, 6, loc=(0, y0 + D / 2 - 0.072, CH + 0.075)), 'Chrome')
    m.add(S.box(0.002, 0.003, 0.03, 0.0, 0, loc=(0.012, y0 + D / 2 - 0.077, CH + 0.08), rot=(0, 40, 0)), 'Black')
    # oven door with smoky window and chrome bar
    m.add(S.box(W - 0.1, 0.03, 0.46, 0.02, 2, base=(0, yf - 0.012, 0.16)), 'Paint')
    m.add(S.box(W - 0.3, 0.012, 0.18, 0.008, 1, base=(0, yf - 0.03, 0.34)), 'GlassGrimy')
    m.add(S.cylinder(0.014, W - 0.2, 10, 0.004, base=(-(W - 0.2) / 2, yf - 0.065, 0.58), rot=(0, 90, 0)), 'Chrome')
    for sx in (-1, 1):
        m.add(S.box(0.02, 0.045, 0.02, 0.005, 1, base=(sx * (W / 2 - 0.12), yf - 0.04, 0.57)), 'Chrome')
    for k in range(4):
        m.add(knob(-0.24 + k * 0.16, yf - 0.012, CH - 0.11, 0.024, 0.03, segs=8), 'Black')
    # burners: dark coils + red-hot glowing copies (flame node; glows while cooking)
    burners = [(-0.18, y0 - 0.14), (0.18, y0 - 0.14), (-0.18, y0 + 0.14), (0.18, y0 + 0.14)]
    for (x, y) in burners:
        m.add(S.cylinder(0.09, 0.008, 12, 0.0, base=(x, y, CH + 0.005)), 'Chrome')
    # the coils ARE the flame node: dull iron-red when off, red-hot while cooking (kept visible)
    m.node('flame', origin=(0, y0, CH + 0.02),
           extras={'part': 'flame', 'on': 'inUse', 'flicker': 'intensity', 'keepVisible': True})
    for (x, y) in burners:
        m.add(_coil(x, y, CH + 0.02), 'Coil', 'flame')
    # stained pot on the front-left burner + grease
    pot = S.lathe([(0.0, 0.0), (0.09, 0.0), (0.1, 0.02), (0.1, 0.13), (0.108, 0.14), (0.096, 0.142), (0.0, 0.1)], 12,
                  base=(-0.18, y0 - 0.14, CH + 0.03), cap_top=False)
    m.add(pot, 'Slate')
    m.add(S.blob(0.08, 1, 0.3, 3.0, 4, loc=(-0.18, y0 - 0.14, CH + 0.155), scale=(1, 1, 0.15)), 'Mold')
    m.add(S.tube([(-0.08, y0 - 0.14, CH + 0.13), (0.03, y0 - 0.14, CH + 0.14)], 0.012, 6), 'Black')
    m.add(S.tube([(-0.11, y0 - 0.24, CH + 0.16), (-0.1, y0 - 0.25, CH + 0.12), (-0.1, y0 - 0.252, CH + 0.06)],
                 radii=[0.008, 0.007, 0.004], segs=5), 'Mold')
    for k, (x, y) in enumerate(((0.05, y0), (0.22, y0 + 0.02), (-0.3, yf - 0.02))):
        m.add(S.blob(0.04, 1, 0.3, 3.0, 30 + k, loc=(x, y, CH + 0.003), scale=(1.3, 1, 0.08)), 'Rust')
    add_broken(m, (0.15, 0.05, CH + 0.2))


def _skull_knob(m: Model, x: float, y: float, z: float, s: float = 0.03) -> None:
    sk, so = S.skull(s, loc=(x, y - s * 0.6, z), rot=(0, 0, 0), jaw=False, segs=6)
    m.add(sk, 'Bone')
    m.add(so, 'Black')
    m.add(S.cylinder(0.012, 0.03, 6, 0.0, base=(x, y + 0.01, z), rot=(90, 0, 0)), 'Chrome')


@builder('stove_necrochef')
def stove_necrochef(m: Model, spec: Spec) -> None:
    j = m.rng
    W, D = 0.9, 0.72
    y0 = 0.1
    yf = y0 - D / 2
    m.mats.paint_spec(spec.variants[0], roughness=0.42, metallic=0.25, coat=0.4)
    m.add(S.box(W, D, CH - 0.04, 0.02, 2, base=(0, y0, 0.04)))
    m.add(S.box(W + 0.02, D + 0.02, 0.04, 0.012, 2, base=(0, y0, CH - 0.04)), 'Steel')
    m.add(S.box(W - 0.06, 0.04, 0.04, 0.008, 1, base=(0, yf, 0.0)), 'Black')
    # tall backguard with a salamander shelf
    m.add(S.box(W, 0.08, 0.2, 0.015, 2, base=(0, y0 + D / 2 - 0.04, CH)), 'Steel')
    m.add(S.box(W, 0.22, 0.025, 0.01, 1, base=(0, y0 + D / 2 - 0.11, CH + 0.175)), 'Steel')
    # oven door + big chrome bar + skull-and-bone badge
    m.add(S.box(W - 0.08, 0.035, 0.5, 0.015, 2, base=(0, yf - 0.015, 0.1)))
    m.add(S.box(W - 0.3, 0.012, 0.2, 0.01, 1, base=(0, yf - 0.035, 0.28)), 'GlassGrimy')
    m.add(S.cylinder(0.018, W - 0.16, 12, 0.005, base=(-(W - 0.16) / 2, yf - 0.08, 0.66), rot=(0, 90, 0)), 'Chrome')
    for sx in (-1, 1):
        m.add(S.box(0.025, 0.06, 0.025, 0.006, 1, base=(sx * (W / 2 - 0.1), yf - 0.05, 0.648)), 'Chrome')
    sk, so = S.skull(0.04, loc=(0, yf - 0.05, 0.53), jaw=True, segs=8)
    m.add(sk, 'Chrome')
    m.add(so, 'Black')
    for k in range(4):
        _skull_knob(m, -0.27 + k * 0.18, yf - 0.02, CH - 0.11, 0.028)
    # four gas burners: cast-iron grates + blue flame rings (flame node; burns while cooking)
    burners = [(-0.21, y0 - 0.15), (0.21, y0 - 0.15), (-0.21, y0 + 0.13), (0.21, y0 + 0.13)]
    for (x, y) in burners:
        m.add(S.cylinder(0.05, 0.02, 10, 0.0, base=(x, y, CH)), 'Iron')
        for a in (0, 90):
            m.add(S.box(0.3, 0.018, 0.018, 0.0, 0, base=(x, y, CH + 0.03), rot=(0, 0, a)), 'Iron')
        m.add(S.torus(0.12, 0.009, 12, 3, loc=(x, y, CH + 0.04)), 'Iron')
    m.node('flame', origin=(0, y0, CH + 0.02), extras={'part': 'flame', 'on': 'inUse'}, transient=True)
    for bi, (x, y) in enumerate(burners):
        m.node(f'flame_{bi}', parent='flame', origin=(x, y, CH + 0.02), transient=True)
        crown = []
        for k in range(8):
            a = math.tau * k / 8
            fx, fy = x + math.cos(a) * 0.045, y + math.sin(a) * 0.045
            crown.append(S.cone(0.011, 0.04 + 0.008 * (k % 2), 4, base=(fx, fy, CH + 0.018),
                                rot=(math.sin(a) * 18, -math.cos(a) * 18, 0)))
        m.add(S.merge(*crown), 'GasFlame', f'flame_{bi}')
    # a heavy black pot with something bubbling
    m.add(S.lathe([(0.0, 0.0), (0.1, 0.0), (0.11, 0.02), (0.11, 0.15), (0.118, 0.16), (0.1, 0.16), (0.0, 0.12)], 12,
                  base=(0.21, y0 + 0.13, CH + 0.04), cap_top=False), 'Iron')
    m.add(S.blob(0.095, 1, 0.25, 3.5, 7, loc=(0.21, y0 + 0.13, CH + 0.17), scale=(1, 1, 0.16)), 'GlowToxic')
    add_broken(m, (-0.2, 0.05, CH + 0.25))


@builder('microwave_nuke')
def microwave_nuke(m: Model, spec: Spec) -> None:
    j = m.rng
    m.mats.paint_spec(spec.variants[0], roughness=0.45, metallic=0.7)
    top = 0.78
    W, D = 0.62, 0.5
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.add(S.cylinder(0.014, top - 0.06, 8, 0.003, base=(sx * (W / 2 - 0.03), sy * (D / 2 - 0.03), 0.06)))
            m.add(S.sphere(0.03, 8, 6, loc=(sx * (W / 2 - 0.03), sy * (D / 2 - 0.03), 0.03)), 'Rubber')
    for z, t in ((top - 0.03, 0.03), (0.22, 0.025)):
        m.add(S.box(W, D, t, 0.008, 1, base=(0, 0, z)))
        m.add(S.box(W + 0.01, 0.012, 0.035, 0.004, 1, base=(0, -D / 2, z - 0.005)))
    # TV dinners on the bottom shelf
    for k in range(3):
        m.add(S.box(0.3, 0.22, 0.03, 0.006, 1, base=(j.sym(0.02), j.sym(0.02), 0.245 + k * 0.032), rot=(0, 0, j.sym(8))),
              'Cardboard' if k != 1 else 'Paper')
    # the boxy retro microwave
    mw, md, mh = 0.56, 0.42, 0.33
    zb = top
    m.add(S.box(mw, md, mh, 0.03, 2, base=(0, 0.02, zb)), 'PlasticBeige')
    yf = 0.02 - md / 2
    m.add(S.box(0.38, 0.02, mh - 0.06, 0.01, 1, base=(-0.07, yf - 0.006, zb + 0.03)), 'PlasticDark')
    m.node('screen', origin=(-0.07, yf - 0.018, zb + mh / 2), extras={'part': 'screen', 'flicker': 'pulse'},
           transient=True)
    pane = S.grid(0.3, 0.2, 1, 1)
    S.rotate(pane, (90, 0, 0))
    m.add(S.translate(pane, (-0.07, yf - 0.018, zb + mh / 2)), 'ScreenMicrowave', 'screen')
    m.add(S.box(0.1, 0.02, mh - 0.06, 0.008, 1, base=(0.2, yf - 0.006, zb + 0.03)), 'PlasticDark')
    for k in range(2):
        m.add(knob(0.2, yf - 0.012, zb + 0.22 - k * 0.1, 0.022, 0.025), 'Chrome')
    # radiation sticker (yellow disc with three dark blades)
    m.add(S.cylinder(0.035, 0.003, 16, 0.0, base=(0.2, yf - 0.018, zb + 0.29), rot=(90, 0, 0)), 'Magnet3')
    for k in range(3):
        a = 90 + 120 * k
        m.add(S.box(0.022, 0.002, 0.02, 0.0, 0, loc=(0.2 + math.cos(math.radians(a)) * 0.017, yf - 0.022,
                                                     zb + 0.29 + math.sin(math.radians(a)) * 0.017), rot=(0, -a, 0)), 'Black')
    m.add(S.box(0.38, 0.02, 0.04, 0.008, 1, base=(-0.07, yf - 0.008, zb + 0.005)), 'Chrome')
    add_broken(m, (0.0, 0.0, zb + mh + 0.08), 0.8)


@builder('espresso_embalmer')
def espresso_embalmer(m: Model, spec: Spec) -> None:
    j = m.rng
    top = 0.82
    cabinet(m, 0.7, 0.55, top, 'Paint', doors=2, drawer=False, knob_mat='Brass', y0=0.15, j=j)
    m.add(S.box(0.74, 0.6, 0.035, 0.01, 1, base=(0, 0.15, top)), 'WoodDark')
    z = top + 0.035
    # boiler + base
    m.add(S.box(0.44, 0.3, 0.07, 0.015, 2, base=(0, 0.17, z)), 'Brass')
    m.add(S.cylinder(0.13, 0.32, 14, 0.015, base=(0.04, 0.2, z + 0.07)), 'Copper')
    m.add(S.lathe([(0.13, 0), (0.1, 0.06), (0.04, 0.1), (0.02, 0.14), (0.0, 0.15)], 14, base=(0.04, 0.2, z + 0.39)),
          'Brass')
    m.add(S.sphere(0.02, 8, 6, loc=(0.04, 0.2, z + 0.55)), 'Brass')
    for zz in (z + 0.14, z + 0.3):
        m.add(S.torus(0.132, 0.008, 16, 3, loc=(0.04, 0.2, zz)), 'Brass')
    # gauges
    for k, (x, zz) in enumerate(((-0.02, z + 0.28), (0.13, z + 0.22))):
        g = S.cylinder(0.045, 0.02, 12, 0.0, base=(0, 0, 0), rot=(90, 0, 0))
        S.translate(g, (x, 0.2 - 0.135, zz))
        m.add(g, 'Brass')
        m.add(S.cylinder(0.037, 0.004, 12, 0.0, base=(x, 0.2 - 0.157, zz), rot=(90, 0, 0)), 'Paper')
        m.add(S.box(0.004, 0.003, 0.03, 0.0, 0, loc=(x + 0.006, 0.2 - 0.162, zz + 0.006), rot=(0, 35 - 70 * k, 0)), 'Blood')
    # group head + portafilter + cup
    m.add(S.cylinder(0.04, 0.05, 12, 0.008, base=(0.04, 0.03, z + 0.14)), 'Chrome')
    m.add(S.tube([(0.04, 0.03, z + 0.13), (0.04, -0.12, z + 0.125)], 0.014, 6), 'WoodEbony')
    m.add(S.lathe([(0.0, 0), (0.03, 0), (0.035, 0.05), (0.0, 0.046)], 10, base=(0.04, 0.03, z + 0.0), cap_top=False),
          'Porcelain')
    # pipes
    m.add(S.tube(S.catmull([(0.17, 0.2, z + 0.25), (0.22, 0.12, z + 0.3), (0.22, 0.05, z + 0.38), (0.12, 0.02, z + 0.42)], 3),
                 0.012, 6), 'Copper')
    m.add(S.tube(S.catmull([(-0.09, 0.2, z + 0.35), (-0.14, 0.2, z + 0.42), (-0.15, 0.25, z + 0.48)], 3), 0.01, 6),
          'Brass')
    # glowing formaldehyde tank on the left (glow, on while powered)
    tx, ty = -0.17, 0.25
    m.add(S.cylinder(0.075, 0.03, 12, 0.0, base=(tx, ty, z + 0.07)), 'Brass')
    m.add(S.cylinder(0.068, 0.28, 14, 0.01, base=(tx, ty, z + 0.1)), 'Glass')
    m.add(S.cylinder(0.075, 0.03, 12, 0.0, base=(tx, ty, z + 0.38)), 'Brass')
    m.node('glow', origin=(tx, ty, z + 0.1), extras={'part': 'glow', 'flicker': 'bubble'}, transient=True)
    m.add(S.cylinder(0.06, 0.21, 14, 0.01, base=(tx, ty, z + 0.105)), 'GlowToxic', 'glow')
    for k in range(4):
        m.add(S.sphere(0.012 + 0.004 * (k % 2), 6, 4, loc=(tx + j.sym(0.03), ty + j.sym(0.03), z + 0.33 + k * 0.012)),
              'GlowToxic', 'glow')
    add_broken(m, (0.0, 0.15, z + 0.62), 0.8)


@builder('sink_rusty')
def sink_rusty(m: Model, spec: Spec) -> None:
    j = m.rng
    d, y0 = 0.86, 0.06
    yf = y0 - d / 2
    cabinet(m, 0.98, d, CH - 0.05, 'Paint', doors=2, drawer=False, knob_mat='Brass', y0=y0, j=j)
    # counter top frame around the basin opening
    bx0, bx1, by0, by1 = -0.27, 0.27, -0.24, 0.16
    z = CH - 0.05
    m.add(S.box(1.0, by0 - (yf - 0.015) , 0.05, 0.01, 1, base=(0, (yf - 0.015 + by0) / 2, z)), 'TileWhite')
    m.add(S.box(1.0, (y0 + d / 2) - by1, 0.05, 0.01, 1, base=(0, (by1 + y0 + d / 2) / 2, z)), 'TileWhite')
    for sx, x0, x1 in ((-1, -0.5, bx0), (1, bx1, 0.5)):
        m.add(S.box(x1 - x0, by1 - by0, 0.05, 0.006, 1, base=((x0 + x1) / 2, (by0 + by1) / 2, z)), 'TileWhite')
    # chipped porcelain basin set into the counter
    outer = [(bx0, by0), (bx1, by0), (bx1, by1), (bx0, by1)]
    inner = S.offset_outline(outer, 0.03)
    m.add(S.outline_ring(outer, inner, CH - 0.2, CH + 0.012, 0.01, 1), 'Porcelain')
    m.add(S.box(bx1 - bx0 - 0.06, by1 - by0 - 0.06, 0.02, 0.01, 1, base=(0, (by0 + by1) / 2, CH - 0.2)), 'Porcelain')
    m.add(S.cylinder(0.025, 0.005, 10, 0.0, base=(0.02, (by0 + by1) / 2, CH - 0.18)), 'Iron')
    m.add(S.blob(0.05, 1, 0.3, 3, 2, loc=(0.03, (by0 + by1) / 2 + 0.02, CH - 0.179), scale=(1.4, 1, 0.05)), 'Rust')
    m.add(S.blob(0.02, 1, 0.4, 3, 3, loc=(bx1, by0 + 0.05, CH + 0.01), scale=(1, 1.4, 0.7)), 'Grout')
    # backsplash + gooseneck faucet + cross taps
    m.add(S.box(1.0, 0.04, 0.14, 0.01, 1, base=(0, y0 + d / 2 - 0.02, CH)), 'TileWhite')
    fx, fy = 0.0, by1 + 0.07
    neck = S.catmull([(fx, fy, CH), (fx, fy, CH + 0.18), (fx, fy - 0.06, CH + 0.25), (fx, fy - 0.14, CH + 0.2),
                      (fx, fy - 0.16, CH + 0.15)], 3)
    m.add(S.tube(neck, 0.016, 8), 'Chrome')
    m.add(S.cylinder(0.03, 0.03, 10, 0.006, base=(fx, fy, CH)), 'Chrome')
    for sx in (-1, 1):
        m.add(S.cylinder(0.018, 0.05, 8, 0.004, base=(fx + sx * 0.13, fy, CH)), 'Chrome')
        for a in (0, 90):
            m.add(S.box(0.07, 0.012, 0.012, 0.004, 1, loc=(fx + sx * 0.13, fy, CH + 0.055), rot=(0, 0, a + 45)), 'Porcelain')
    m.add(S.tube([(fx + 0.012, fy - 0.15, CH + 0.14), (fx + 0.02, fy - 0.15, CH + 0.08), (fx + 0.022, fy - 0.15, CH + 0.02)],
                 radii=[0.006, 0.005, 0.003], segs=4), 'Rust')
    # water stream from the spout into the basin (water node, visible while in use)
    m.node('water', origin=(fx, fy - 0.16, CH + 0.145), extras={'part': 'water'}, transient=True)
    m.add(S.cylinder(0.008, 0.32, 8, 0.0, r_top=0.011, base=(fx, fy - 0.16, CH - 0.18)), 'Water', 'water')
    m.add(S.torus(0.03, 0.006, 12, 4, loc=(fx, fy - 0.16, CH - 0.178)), 'Water', 'water')
    m.add(S.blob(0.12, 1, 0.1, 2, 1, loc=(0.0, (by0 + by1) / 2, CH - 0.17), scale=(1.8, 1.4, 0.06)), 'WaterDirty', 'water')
    add_broken(m, (0.25, 0.25, CH + 0.12), 0.8)


@builder('trash_lidded')
def trash_lidded(m: Model, spec: Spec) -> None:
    """Dented galvanised bin with corrugated bands; the lid is pushed up and askew by a fish skeleton, a banana peel
    hangs over the rim and two painted-on flies (with wiggle lines) circle the dent."""
    j = m.rng
    m.mats.paint_spec(spec.variants[0], roughness=0.48, metallic=0.65)
    r0, r1, H = 0.2, 0.235, 0.62
    prof = [(r0 - 0.01, 0.0), (r0, 0.015)]
    for k in range(1, 9):
        z = 0.015 + (H - 0.03) * k / 8
        prof.append((r0 + (r1 - r0) * k / 8 + (0.012 if k in (2, 5) else 0.0), z))
    prof.append((r1 + 0.012, H))
    can = S.lathe(prof, 20, cap_top=False)
    for v in can.verts:     # two dents + a slight lean
        a = math.atan2(v.co.y, v.co.x)
        dent = math.exp(-((a + 1.9) ** 2) * 6) * math.exp(-((v.co.z - 0.36) ** 2) * 40) * 0.04
        dent += math.exp(-((a - 1.0) ** 2) * 8) * math.exp(-((v.co.z - 0.13) ** 2) * 60) * 0.025
        rr = math.hypot(v.co.x, v.co.y)
        if dent > 0.0005 and rr > 0.05:
            f = 1 - dent / rr
            v.co.x *= f
            v.co.y *= f
        v.co.x += 0.02 * (v.co.z / H) ** 2
    m.add(can)
    m.add(S.lathe([(r1 - 0.006, H - 0.04), (r1 - 0.006, H - 0.008), (0.0, H - 0.01)], 20), 'Black')
    for z in (0.2, 0.43):
        m.add(S.torus(r0 + (r1 - r0) * z / H + 0.004, 0.01, 20, 4, loc=(0.02 * (z / H) ** 2, 0, z)))
    # handles
    for sx in (-1, 1):
        m.add(S.torus(0.045, 0.009, 10, 4, arc=180, loc=(sx * (r1 + 0.012) + 0.012, 0, H * 0.74), rot=(0, sx * 90, 0)))
    # lid pushed up and askew
    lid = S.lathe([(r1 + 0.02, 0), (r1 + 0.02, 0.022), (r1 * 0.7, 0.065), (0.04, 0.088), (0.0, 0.09)], 20)
    handle = S.torus(0.05, 0.01, 12, 4, arc=180, rot=(90, 0, 0), loc=(0, 0, 0.088))
    for bm_ in (lid, handle):
        S.rotate(bm_, (-14, 9, 20))
        S.translate(bm_, (0.04, 0.03, H + 0.045))
    m.add(lid)
    m.add(handle)
    # fish skeleton poking out under the raised lid edge (front), banana peel over the rim (right)
    spine = [(-0.02, -0.12, H + 0.02), (0.02, -0.2, H + 0.05), (0.05, -0.27, H + 0.04)]
    m.add(S.tube(spine, 0.006, 4), 'Bone')
    for k in range(4):
        t = 0.2 + 0.2 * k
        c = Vector(spine[0]).lerp(Vector(spine[2]), t)
        for sx in (-1, 1):
            m.add(S.tube([c, c + Vector((sx * 0.035, -0.01, 0.005))], 0.0035, 3), 'Bone')
    m.add(S.prism([(-0.03, 0.0), (0.03, 0.0), (0.0, 0.05)], 0.008, 0.0, 0, plane='XZ', loc=(0.06, -0.3, H + 0.03),
                  rot=(0, 0, 20)), 'Bone')
    for k in range(3):
        a = math.radians(-30 + 30 * k)
        peel = S.tube([(r1 + 0.005, 0.05, H + 0.005), (r1 + 0.04 + 0.03 * math.cos(a), 0.05 + 0.03 * math.sin(a), H - 0.03),
                       (r1 + 0.05 + 0.04 * math.cos(a), 0.05 + 0.04 * math.sin(a), H - 0.11)],
                      radii=[0.016, 0.014, 0.004], segs=4, scale_xy=(1.0, 0.4))
        m.add(peel, 'PaintMoon')
    # painted flies with little wiggle trails
    for k, (a, z) in enumerate(((-2.2, 0.47), (-1.4, 0.3))):
        rr = r0 + (r1 - r0) * z / H + 0.004
        p0 = Vector((math.cos(a) * rr + 0.02 * (z / H) ** 2, math.sin(a) * rr, z))
        nrm = Vector((math.cos(a), math.sin(a), 0.0))
        m.add(S.sphere(0.013, 6, 4, loc=p0 + nrm * 0.004, scale=(1.3, 1.3, 0.8)), 'Black')
        side = Vector((-math.sin(a), math.cos(a), 0.0))
        for sx in (-1, 1):
            m.add(S.sphere(0.012, 5, 3, loc=p0 + nrm * 0.007 + side * sx * 0.012 + Vector((0, 0, 0.008)),
                           scale=(0.7, 0.7, 0.3)), 'Lining')
        trail = [p0 + nrm * 0.005 - side * (0.02 + 0.015 * q) + Vector((0, 0, 0.012 * math.sin(q * 2.2))) for q in range(5)]
        m.add(S.tube(trail, 0.0022, 3), 'Black')
