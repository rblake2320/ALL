"""Preservation & bath: shower, ice bath, embalming station, stitching table, cracked mirror."""
from __future__ import annotations

import math

from common import dims
from common import shapes as S
from common.catalog import Spec
from common.model import Model

from .parts import add_broken, claw_foot, drawer_pull, knob, leg, mold_blotch, turned_leg
from .registry import builder


@builder('shower_drizzle')
def shower_drizzle(m: Model, spec: Spec) -> None:
    j = m.rng
    # tray with a raised lip; the zombie stands on it at y=0.05
    m.add(S.box(0.94, 0.94, 0.045, 0.012, 2, base=(0, 0, 0)), 'TileWhite')
    m.add(S.outline_ring([(-0.47, -0.47), (0.47, -0.47), (0.47, 0.47), (-0.47, 0.47)],
                         [(-0.43, -0.43), (0.43, -0.43), (0.43, 0.43), (-0.43, 0.43)], 0.04, 0.07, 0.008), 'TileWhite')
    m.add(S.cylinder(0.035, 0.004, 10, 0.0, base=(0.1, 0.1, 0.045)), 'Chrome')
    # tiled back + left walls (Paint) with grout lines
    H = 2.0
    m.add(S.box(0.94, 0.06, H - 0.07, 0.012, 2, base=(0, 0.44, 0.07)))
    m.add(S.box(0.06, 0.88, H - 0.07, 0.012, 2, base=(-0.44, 0.03, 0.07)))
    for k in range(1, 9):
        z = 0.07 + k * (H - 0.07) / 9
        m.add(S.box(0.86, 0.006, 0.008, 0.0, 0, base=(0.03, 0.408, z)), 'Grout')
        m.add(S.box(0.006, 0.84, 0.008, 0.0, 0, base=(-0.408, 0.03, z)), 'Grout')
    for k in range(1, 5):
        x = -0.41 + k * 0.88 / 5
        m.add(S.box(0.008, 0.006, H - 0.08, 0.0, 0, base=(x, 0.408, 0.075)), 'Grout')
        y = -0.41 + k * 0.84 / 5
        m.add(S.box(0.006, 0.008, H - 0.08, 0.0, 0, base=(-0.408, y + 0.03, 0.075)), 'Grout')
    for k, (x, y, z, r, n) in enumerate(((-0.38, 0.4, 0.15, 0.08, (0, -1, 0)), (0.3, 0.41, 0.2, 0.06, (0, -1, 0)),
                                         (-0.41, -0.2, 0.18, 0.07, (1, 0, 0)), (-0.1, 0.41, 1.75, 0.05, (0, -1, 0)))):
        m.add(mold_blotch(x, y, z, r, n, seed=k, flat=0.12), 'MoldDark' if k % 2 else 'Mold')
    # L-shaped curtain rail along the front and right side, curtain bunched at the front-right corner
    rail_z = 1.98
    m.add(S.tube([(-0.44, -0.44, rail_z), (0.44, -0.44, rail_z), (0.44, 0.44, rail_z)], 0.012, 6), 'Chrome')
    for k in range(7):
        m.add(S.torus(0.018, 0.004, 8, 3, loc=(0.2 + k * 0.035, -0.44, rail_z - 0.01), rot=(0, 90, 0)), 'Chrome')
    folds = []
    n = 14
    for i in range(n + 1):
        t = i / n
        x = 0.2 + t * 0.25
        y = -0.44 + 0.035 * math.sin(t * math.pi * 6)
        folds.append((x, y))
    curtain = S.grid(1, 1, 1, 1)
    import bmesh as _bm
    cb = _bm.new()
    top_v, bot_v = [], []
    for (x, y) in folds:
        top_v.append(cb.verts.new((x, y, rail_z - 0.02)))
        bot_v.append(cb.verts.new((x + 0.03, y - 0.015, 0.22)))
    for i in range(n):
        cb.faces.new((top_v[i], top_v[i + 1], bot_v[i + 1], bot_v[i]))
    m.add(cb, 'Curtain')
    for k in range(3):
        m.add(mold_blotch(0.25 + k * 0.08, -0.47, 0.3 + 0.05 * k, 0.05, (0, -1, 0), seed=10 + k, flat=0.1), 'MoldDark')
    # rusty showerhead on a crooked arm
    arm = [(0.0, 0.41, 2.1), (0.0, 0.3, 2.12), (0.02, 0.18, 2.06)]
    m.add(S.tube(arm, 0.014, 6), 'Rust')
    m.add(S.cylinder(0.02, 0.1, 8, 0.0, base=(0.0, 0.43, 2.06), rot=(90, 0, 0)), 'Rust')
    head = S.lathe([(0.012, 0.06), (0.05, 0.0), (0.06, -0.012), (0.0, -0.014)], 12)
    S.rotate(head, (-22, 6, 0))
    m.add(S.translate(head, (0.02, 0.16, 2.02)), 'Rust')
    for sx in (-1, 1):
        m.add(S.cylinder(0.02, 0.05, 8, 0.004, base=(sx * 0.12, 0.41, 1.15), rot=(90, 0, 0)), 'Chrome')
        m.add(S.box(0.06, 0.012, 0.012, 0.003, 1, loc=(sx * 0.12, 0.35, 1.15), rot=(0, 45, 0)), 'Porcelain')
    # a zombie rubber duck with X eyes
    duck = S.merge(S.sphere(0.05, 10, 6, loc=(0, 0, 0.04), scale=(1.3, 1.0, 0.8)),
                   S.sphere(0.032, 8, 6, loc=(-0.045, 0, 0.09)))
    m.add(S.translate(duck, (0.3, 0.28, 0.045)), 'Magnet3')
    m.add(S.cone(0.016, 0.03, 6, base=(0.3 - 0.075, 0.28, 0.135 - 0.005), rot=(0, -90, 0)), 'Rust')
    for sy in (-1, 1):
        for a in (45, -45):
            m.add(S.box(0.016, 0.003, 0.004, 0.0, 0, loc=(0.3 - 0.06, 0.28 + sy * 0.022, 0.145), rot=(0, a, 90)), 'Black')
    # water: a fan of falling streams (visible in use)
    m.node('water', origin=(0.02, 0.15, 2.0), extras={'part': 'water'}, transient=True)
    for k in range(5):
        a = math.tau * k / 5
        dx, dy = math.cos(a) * 0.03, math.sin(a) * 0.03
        m.add(S.tube([(0.02 + dx, 0.15 + dy, 1.99), (0.02 + dx * 4, 0.12 + dy * 4, 0.06)], 0.006, 4), 'Water', 'water')
    m.add(S.blob(0.18, 1, 0.12, 2, 1, loc=(0.03, 0.08, 0.05), scale=(1.4, 1.3, 0.05)), 'Water', 'water')


@builder('tub_icebath')
def tub_icebath(m: Model, spec: Spec) -> None:
    j = m.rng
    R = dims.TUB_RIM
    cx = 0.15
    a, b = 0.78, 0.37
    prof = [(0.0, 0.1), (0.86, 0.1), (0.95, 0.16), (1.0, 0.36), (1.03, R - 0.03), (1.04, R - 0.005), (1.0, R),
            (0.95, R - 0.02), (0.93, 0.36), (0.86, 0.16), (0.78, 0.125), (0.0, 0.12)]
    tub = S.superlathe(prof, a, b, 3.2, 28, base=(cx, 0, 0), cap_bottom=False, cap_top=False)
    m.add(tub)
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.add(claw_foot(cx + sx * 0.58, sy * 0.24, 0.07, yaw=0 if sy < 0 else 180), 'Brass')
    # little ice machine at the -X end with a chute into the tub
    m.add(S.box(0.3, 0.5, 0.62, 0.02, 2, base=(-0.83, 0.05, 0.02)), 'Steel')
    m.add(S.box(0.26, 0.46, 0.06, 0.015, 2, base=(-0.83, 0.05, 0.64)), 'Steel')
    for k in range(5):
        m.add(S.box(0.2, 0.008, 0.012, 0.0, 0, base=(-0.83, 0.05 - 0.255, 0.12 + k * 0.035)), 'Black')
    # status LED: its own 'glow' node so it goes dark when the tub is unpowered (library drives glow by power)
    m.node('glow', origin=(-0.9, -0.209, 0.52), extras={'part': 'glow'}, transient=True)
    m.add(S.box(0.04, 0.008, 0.04, 0.003, 1, base=(-0.9, -0.205, 0.5)), 'GlowLED', 'glow')
    snow = S.merge(*[S.box(0.07, 0.006, 0.01, 0.0, 0, loc=(0, 0, 0), rot=(0, a_, 0)) for a_ in (0, 60, 120)])
    m.add(S.translate(snow, (-0.8, -0.205, 0.38)), 'Ice')
    chute = [(-0.72, 0.05, 0.6), (-0.6, 0.05, 0.62), (-0.52, 0.05, 0.55)]
    m.add(S.tube(chute, 0.04, 6, scale_xy=(1.0, 1.2)), 'Steel')
    m.add(S.tube([(-0.83, 0.3, 0.3), (-0.83, 0.42, 0.2), (-0.83, 0.45, 0.02)], 0.012, 5), 'Rubber')
    # water + floating ice (visible while bathing)
    m.node('water', origin=(cx, 0, 0.45), extras={'part': 'water'}, transient=True)
    m.add(S.superlathe([(0.0, 0.45), (0.935, 0.45)], a, b, 3.2, 28, base=(cx, 0, 0), cap_bottom=False, cap_top=False),
          'Water', 'water')
    for k in range(7):
        x = cx + j.uniform(-0.55, 0.55)
        y = j.uniform(-0.2, 0.2)
        m.add(S.box(0.07, 0.07, 0.06, 0.012, 1, loc=(x, y, 0.455), rot=(j.sym(20), j.sym(20), j.sym(45))), 'Ice', 'water')
    m.add(S.box(0.06, 0.06, 0.05, 0.01, 1, loc=(-0.5, 0.0, 0.47), rot=(10, 20, 30)), 'Ice', 'water')
    # frost crust around the rim (powered)
    m.node('frost', origin=(cx, 0, R), extras={'part': 'frost'}, transient=True)
    pts = S.superellipse_pts(a * 1.015, b * 1.015, 3.2, 18)
    for k, (x, y) in enumerate(pts):
        if k % 3 == 2:
            continue
        m.add(S.blob(0.04, 1, 0.35, 3.0, k, loc=(cx + x, y, R - 0.005), scale=(1.3, 1.3, 0.45)), 'Frost', 'frost')
        if k % 4 == 0:
            m.add(S.cone(0.012, j.uniform(0.05, 0.1), 5, base=(cx + x * 1.03, y * 1.03, R - 0.02), rot=(180, 0, 0)),
                  'Ice', 'frost')
    add_broken(m, (-0.83, 0.05, 0.75), 0.8)


@builder('station_embalming')
def station_embalming(m: Model, spec: Spec) -> None:
    """Brushed-steel embalming slab (top at SLAB_HEIGHT) with a raised drain lip, porcelain head block, a folded sheet
    with a dangling toe tag and a galvanised bucket under the drain, on twin pedestals. At the +X end a rounded
    mint-enamel pump cabinet with chrome trim and two gauges carries a glass tank of glowing green fluid (node
    "glow") and a piston (node "pump"); red rubber tubing droops from the tank to the head of the slab."""
    j = m.rng
    m.mats.paint_spec(spec.variants[0], roughness=0.34, metallic=0.4)
    SL = dims.SLAB_HEIGHT
    x0, x1 = -0.97, 0.62
    w = x1 - x0
    xc = (x0 + x1) / 2
    # slab with a raised drain lip and a drain + bucket at the foot end
    m.add(S.box(w, 0.66, 0.045, 0.012, 1, base=(xc, 0, SL - 0.045)))
    outer = [(x0, -0.33), (x1, -0.33), (x1, 0.33), (x0, 0.33)]
    inner = [(x0 + 0.035, -0.295), (x1 - 0.035, -0.295), (x1 - 0.035, 0.295), (x0 + 0.035, 0.295)]
    m.add(S.outline_ring(outer, inner, SL - 0.005, SL + 0.03, 0.008, 1))
    dx = x1 - 0.12
    m.add(S.cylinder(0.034, 0.004, 10, 0.0, base=(dx, 0, SL)), 'Black')
    m.add(S.tube([(dx, 0, SL - 0.045), (dx, 0.0, SL - 0.2), (dx + 0.02, -0.02, SL - 0.33)], 0.016, 6), 'Rubber')
    m.add(S.lathe([(0.0, 0.0), (0.1, 0.0), (0.125, 0.24), (0.118, 0.24), (0.094, 0.012), (0.0, 0.012)], 12,
                  base=(dx + 0.02, -0.02, 0.0)), 'Galvanised')
    m.add(S.torus(0.105, 0.006, 12, 3, loc=(dx + 0.02, -0.02, 0.16), rot=(0, 0, 0)), 'Galvanised')
    # twin pedestals on cross feet, with a stretcher
    for x in (x0 + 0.2, x1 - 0.3):
        m.add(S.lathe([(0.075, 0.0), (0.06, 0.05), (0.045, 0.09), (0.045, SL - 0.14), (0.06, SL - 0.09),
                       (0.09, SL - 0.06), (0.0, SL - 0.045)], 10, base=(x, 0, 0)))
        m.add(S.box(0.12, 0.6, 0.05, 0.015, 1, base=(x, 0, 0.0)))
        m.add(S.box(0.38, 0.1, 0.045, 0.015, 1, base=(x, 0, 0.0)))
    m.add(S.cylinder(0.022, (x1 - 0.3) - (x0 + 0.2), 10, 0.0, base=(x0 + 0.2, 0, 0.26), rot=(0, 90, 0)))
    # porcelain head block at the -X end, folded sheet + toe tag at the foot end
    m.add(S.superellipsoid(0.07, 0.12, 0.04, 0.4, 0.4, 12, 6, loc=(x0 + 0.13, 0, SL + 0.035)), 'Porcelain')
    sheet = S.cushion(0.36, 0.56, 0.05, sag=-0.006, roundness=0.2, loc=(x1 - 0.32, 0.0, SL + 0.03), segs=10, rings=4)
    m.add(S.rotate(sheet, (0, 0, j.sym(4)), pivot=(x1 - 0.32, 0, SL)), 'GhostSheet')
    drape = S.box(0.34, 0.015, 0.22, 0.006, 1, loc=(x1 - 0.32, -0.33, SL - 0.07), rot=(-8, 0, j.sym(3)))
    m.add(drape, 'GhostSheet')
    m.add(S.tube([(x1 - 0.2, -0.345, SL - 0.15), (x1 - 0.19, -0.35, SL - 0.22)], 0.0025, 3), 'Ink')
    m.add(S.box(0.05, 0.004, 0.08, 0.002, 1, loc=(x1 - 0.19, -0.352, SL - 0.26), rot=(0, 12, 0)), 'Paper')
    # pump cabinet at the +X end: rounded mint enamel, chrome kick + top trim, gauges, switch
    px0, px1 = 0.66, 0.98
    pxc = (px0 + px1) / 2
    m.add(S.box(px1 - px0, 0.7, 0.78, 0.05, 3, base=(pxc, 0.05, 0.04)), 'EnamelMint')
    m.add(S.box(px1 - px0 + 0.02, 0.72, 0.045, 0.0, 0, base=(pxc, 0.05, 0.0)), 'Chrome')
    m.add(S.box(px1 - px0 + 0.02, 0.72, 0.03, 0.0, 0, base=(pxc, 0.05, 0.8)), 'Chrome')
    for k, (gz, ang) in enumerate(((0.64, 40), (0.47, -55))):
        m.add(S.cylinder(0.052, 0.025, 12, 0.0, base=(pxc, -0.302, gz), rot=(90, 0, 0)), 'Chrome')
        m.add(S.cylinder(0.044, 0.004, 12, 0.0, base=(pxc, -0.326, gz), rot=(90, 0, 0)), 'Paper')
        m.add(S.box(0.005, 0.003, 0.034, 0.0, 0, loc=(pxc + 0.006, -0.33, gz + 0.006), rot=(0, ang, 0)), 'Blood')
    m.add(S.box(0.07, 0.025, 0.04, 0.008, 1, base=(pxc, -0.3, 0.28)), 'EnamelRed')
    m.add(S.box(0.012, 0.03, 0.05, 0.004, 1, base=(pxc + 0.01, -0.315, 0.3), rot=(0, 25, 0)), 'Chrome')
    # glass tank of glowing green fluid (glow)
    tx, ty = pxc, 0.2
    m.add(S.cylinder(0.125, 0.04, 14, 0.01, base=(tx, ty, 0.82)), 'Brass')
    m.add(S.cylinder(0.112, 0.6, 14, 0.0, base=(tx, ty, 0.86)), 'Glass')
    m.add(S.lathe([(0.125, 0), (0.125, 0.03), (0.07, 0.07), (0.028, 0.08), (0.028, 0.11), (0.0, 0.11)], 14,
                  base=(tx, ty, 1.46)), 'Brass')
    m.node('glow', origin=(tx, ty, 0.87), extras={'part': 'glow', 'flicker': 'bubble'}, transient=True)
    m.add(S.cylinder(0.1, 0.46, 12, 0.0, base=(tx, ty, 0.87)), 'GlowToxic', 'glow')
    for k in range(4):
        m.add(S.sphere(0.014 + 0.006 * (k % 2), 6, 4, loc=(tx + j.sym(0.05), ty + j.sym(0.05), 1.16 + k * 0.07)),
              'GlowToxic', 'glow')
    # piston housing + moving plunger (pump node bobs while in use)
    hx, hy = pxc, -0.14
    m.add(S.cylinder(0.072, 0.3, 12, 0.0, base=(hx, hy, 0.82)), 'Chrome')
    m.add(S.torus(0.072, 0.011, 12, 3, loc=(hx, hy, 1.12)), 'Brass')
    m.node('pump', origin=(hx, hy, 1.12), extras={'part': 'pump', 'axis': 'y', 'amp': 0.07, 'rate': 1.4})
    m.add(S.cylinder(0.02, 0.22, 8, 0.0, base=(hx, hy, 1.08)), 'Chrome', 'pump')
    m.add(S.cylinder(0.055, 0.032, 12, 0.008, base=(hx, hy, 1.3)), 'Brass', 'pump')
    m.add(S.sphere(0.024, 8, 6, loc=(hx, hy, 1.36)), 'EnamelRed', 'pump')
    # red rubber tubing drooping from the tank to the head end of the slab, with a chrome trocar tip
    tube_pts = S.catmull([(tx - 0.1, ty - 0.02, 0.95), (0.56, 0.3, 1.02), (0.25, 0.37, SL + 0.12),
                          (-0.3, 0.36, SL + 0.07), (-0.72, 0.24, SL + 0.035)], 4)
    m.add(S.tube(tube_pts, 0.016, 6), 'Gum')
    m.add(S.tube([(-0.72, 0.24, SL + 0.035), (-0.8, 0.19, SL + 0.035)], 0.007, 5), 'Chrome')


@builder('table_stitchnmend')
def table_stitchnmend(m: Model, spec: Spec) -> None:
    j = m.rng
    T = 0.72
    m.add(S.box(0.8, 0.5, 0.04, 0.012, 2, base=(0, 0.12, T - 0.04), rot=(0, j.sym(0.6), j.sym(1.0))))
    m.add(S.box(0.7, 0.42, 0.12, 0.01, 1, base=(0, 0.12, T - 0.16)))
    m.add(S.box(0.34, 0.02, 0.08, 0.006, 1, base=(0, 0.12 - 0.215, T - 0.14)))
    m.add(S.sphere(0.014, 8, 6, loc=(0, 0.12 - 0.235, T - 0.1)), 'Brass')
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.add(turned_leg(sx * 0.35, 0.12 + sy * 0.2, T - 0.16, 0.026, 8))
    # tomato pincushion with pins
    pc = (0.22, 0.16, T)
    m.add(S.blob(0.055, 1, 0.12, 3, 4, loc=(pc[0], pc[1], pc[2] + 0.04), scale=(1.2, 1.2, 0.8)), 'EnamelRed')
    m.add(S.cone(0.03, 0.03, 5, base=(pc[0], pc[1], pc[2] + 0.075)), 'PlantGreen')
    for k in range(6):
        a = math.tau * k / 6
        b0 = (pc[0] + math.cos(a) * 0.03, pc[1] + math.sin(a) * 0.03, pc[2] + 0.06)
        b1 = (pc[0] + math.cos(a) * 0.065, pc[1] + math.sin(a) * 0.065, pc[2] + 0.1)
        m.add(S.tube([b0, b1], 0.0018, 3), 'Steel')
        m.add(S.sphere(0.006, 5, 3, loc=b1), ('Magnet1', 'Magnet2', 'Magnet3')[k % 3])
    # spools of thread
    for k, (x, y, mat) in enumerate(((-0.05, 0.25, 'Book1'), (0.03, 0.27, 'Book2'), (-0.12, 0.2, 'Magnet3'))):
        m.add(S.cylinder(0.022, 0.006, 10, 0.0, base=(x, y, T)), 'WoodLight')
        m.add(S.cylinder(0.018, 0.04, 10, 0.003, base=(x, y, T + 0.006)), mat)
        m.add(S.cylinder(0.022, 0.006, 10, 0.0, base=(x, y, T + 0.046)), 'WoodLight')
    # big curved needle with a trailing thread, and a severed finger awaiting surgery
    needle = S.torus(0.07, 0.004, 14, 4, arc=200, loc=(0.0, 0.0, 0.0), rot=(0, 0, 0))
    m.add(S.translate(S.rotate(needle, (0, 0, 20)), (-0.1, 0.02, T + 0.005)), 'Chrome')
    thread = S.catmull([(-0.03, 0.04, T + 0.006), (0.05, 0.0, T + 0.004), (0.1, 0.06, T + 0.004), (0.16, 0.02, T + 0.005)], 4)
    m.add(S.tube(thread, 0.0022, 3), 'Book1')
    finger = S.tube(S.catmull([(0.0, 0.0, 0.0), (0.04, 0.005, 0.004), (0.075, 0.0, 0.006)], 3),
                    radii=[0.012, 0.012, 0.011, 0.011, 0.01, 0.009, 0.008], segs=6)
    m.add(S.translate(S.rotate(finger, (0, 0, -30)), (0.05, -0.05, T + 0.012)), 'Skin')
    m.add(S.sphere(0.012, 6, 4, loc=(0.05, -0.05, T + 0.012)), 'BloodWine')
    # magnifying lamp on a clamp arm
    lx, ly = -0.3, 0.3
    m.add(S.box(0.06, 0.08, 0.05, 0.008, 1, base=(lx, ly, T)), 'Iron')
    arm = [(lx, ly, T + 0.05), (lx, ly, T + 0.15), (lx + 0.04, ly - 0.08, T + 0.22), (lx + 0.1, ly - 0.2, T + 0.2)]
    m.add(S.tube(arm, 0.009, 6), 'Iron')
    m.add(S.torus(0.06, 0.012, 16, 5, loc=(lx + 0.12, ly - 0.24, T + 0.17), rot=(60, 0, 20)), 'Iron')
    m.add(S.cylinder(0.055, 0.006, 16, 0.0, base=(lx + 0.12, ly - 0.24, T + 0.17), rot=(60, 0, 20)), 'Glass')


@builder('mirror_cracked')
def mirror_cracked(m: Model, spec: Spec) -> None:
    j = m.rng
    # stand: two uprights on splayed feet joined by a low stretcher
    for sx in (-1, 1):
        m.add(S.box(0.06, 0.06, 1.42, 0.012, 2, base=(sx * 0.36, 0.03, 0.06), rot=(0, sx * 1.0, 0)))
        m.add(S.sphere(0.035, 10, 6, loc=(sx * 0.36 + sx * 0.018, 0.03, 1.5)), 'Paint')
        foot = S.box(0.07, 0.5, 0.06, 0.02, 2, base=(sx * 0.36, 0.03, 0.0))
        m.add(foot)
        for sy in (-1, 1):
            m.add(S.sphere(0.03, 8, 6, loc=(sx * 0.36, 0.03 + sy * 0.25, 0.02), scale=(1, 1, 0.7)), 'WoodDark')
    m.add(S.box(0.66, 0.04, 0.05, 0.01, 1, base=(0, 0.03, 0.3)))
    # oval frame pivoting between the uprights, tilted back a little; glass faces the front (-Y)
    cz = 1.08
    tilt = -6
    a, b = 0.27, 0.48
    ring = []
    pts = []
    for k in range(28):
        t = math.tau * k / 28
        pts.append((math.cos(t) * a, 0.0, math.sin(t) * b))
    frame = S.tube(pts, 0.045, 7, closed=True, scale_xy=(1.0, 0.75))
    S.rotate(frame, (tilt, 0, 0))
    m.add(S.translate(frame, (0, 0.03, cz)))
    glass_pts = S.superellipse_pts(a - 0.005, b - 0.005, 2.0, 28)
    glass = S.prism(glass_pts, 0.01, 0.0, 0, plane='XZ')
    S.rotate(glass, (tilt, 0, 0))
    m.add(S.translate(glass, (0, 0.035, cz)), 'MirrorBright')
    # cartoon reflection streaks (read as 'mirror' even without an environment map)
    for k, (dx, w_) in enumerate(((-0.08, 0.05), (0.03, 0.022))):
        streak = S.box(w_, 0.002, 0.62, 0.0, 0, loc=(dx, 0.0, 0.0), rot=(0, 34, 0))
        for v in streak.verts:   # clip to the oval
            t = (v.co.x / (a - 0.03)) ** 2 + (v.co.z / (b - 0.03)) ** 2
            if t > 1.0:
                f = 1.0 / math.sqrt(t)
                v.co.x *= f
                v.co.z *= f
        S.rotate(streak, (tilt, 0, 0))
        m.add(S.translate(streak, (0, 0.027, cz)), 'MirrorStreak')
    inner_ring = S.tube([(math.cos(math.tau * k / 28) * (a - 0.012), 0.0, math.sin(math.tau * k / 28) * (b - 0.012))
                         for k in range(28)], 0.011, 5, closed=True)
    S.rotate(inner_ring, (tilt, 0, 0))
    m.add(S.translate(inner_ring, (0, 0.026, cz)), 'Gold')
    back = S.prism(S.superellipse_pts(a + 0.01, b + 0.01, 2.0, 28), 0.012, 0.004, 1, plane='XZ')
    S.rotate(back, (tilt, 0, 0))
    m.add(S.translate(back, (0, 0.055, cz)))
    # crest: carved scroll + little skull on top of the frame
    sk, so = S.skull(0.04, loc=(0, 0.0, cz + b + 0.07), rot=(tilt, 0, 0), segs=8)
    m.add(sk, 'Bone')
    m.add(so, 'Black')
    for sx in (-1, 1):
        m.add(S.tube(S.spiral(0.005, 0.04, 1.2, 12, center=(sx * 0.07, -0.01, cz + b + 0.02), plane='XZ',
                              a0=0 if sx > 0 else 180), 0.008, 5))
    # pivot knobs
    for sx in (-1, 1):
        m.add(S.cylinder(0.025, 0.05, 10, 0.006, base=(sx * 0.33, 0.03, cz), rot=(0, 90 * sx, 0)), 'Brass')
    # the crack: a burst from an impact point plus radiating jagged lines lying on the glass
    impact = (0.08, 0.0, cz + 0.12)
    import mathutils as _mu
    rot = _mu.Euler((math.radians(tilt), 0, 0)).to_matrix()
    for k in range(6):
        ang = math.tau * k / 6 + j.sym(0.3)
        L = j.uniform(0.12, 0.3)
        p1 = (impact[0] + math.cos(ang) * L * 0.6, 0.0, impact[2] + math.sin(ang) * L)
        line = S.jagged((impact[0], 0, impact[2] - cz), (p1[0], 0, p1[2] - cz), 4, 0.025, j)
        line = [rot @ p + _mu.Vector((0, 0.025, cz)) for p in line]
        m.add(S.tube(line, 0.005, 3), 'Crack')
    m.add(S.torus(0.032, 0.0045, 10, 3, loc=(impact[0], 0.025, impact[2]), rot=(90 + tilt, 0, 0)), 'Crack')
