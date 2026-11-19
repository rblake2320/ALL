"""Surfaces: tables and counters. Table tops at TABLE_HEIGHT, counters at COUNTER_HEIGHT (full tile width so runs
of counters join seamlessly), coffee table at COFFEE_TABLE_HEIGHT."""
from __future__ import annotations

import math

from common import dims
from common import shapes as S
from common.catalog import Spec
from common.model import Model

from .parts import cabinet, claw_foot, leg, turned_leg, drawer_pull, bun_foot
from .registry import builder

TH = dims.TABLE_HEIGHT
CH = dims.COUNTER_HEIGHT


@builder('table_rickety')
def table_rickety(m: Model, spec: Spec) -> None:
    j = m.rng
    top_t = 0.05
    m.add(S.box(0.8, 0.8, top_t, 0.014, 2, base=(0, 0, TH - top_t), rot=(j.sym(0.6), j.sym(0.6), j.sym(1.5))))
    m.add(S.box(0.66, 0.66, 0.07, 0.008, 1, base=(0, 0, TH - top_t - 0.07)))
    for sx in (-1, 1):
        for sy in (-1, 1):
            short = 0.018 if (sx < 0 and sy < 0) else 0.0
            m.add(leg(sx * 0.32, sy * 0.32, TH - top_t, 0.045, 0.03, (sx * 0.02, sy * 0.02), short=short))
    # folded coaster shim under the short leg, a coffee-ring stain and a fork stabbed into a corner
    m.add(S.taper_box(0.085, 0.085, 0.08, 0.08, 0.018, 0.003, 1, base=(-0.34, -0.34, 0), rot=(0, 0, 12)), 'Cardboard')
    m.add(S.torus(0.05, 0.006, 16, 4, loc=(0.2, 0.18, TH + 0.001), rot=(0, 0, 0)), 'WoodDark')
    fork = S.merge(S.box(0.012, 0.004, 0.11, 0.002, 1, base=(0, 0, 0)),
                   *[S.box(0.003, 0.004, 0.045, 0.001, 1, base=(dx, 0, -0.045)) for dx in (-0.0045, 0, 0.0045)])
    S.rotate(fork, (12, 18, 0))
    m.add(S.translate(fork, (-0.3, 0.3, TH + 0.035)), 'Steel')


def _chunky_turned_leg(x: float, y: float, top: float, r: float = 0.05, segs: int = 10):
    """Heavier turned leg (baluster + collar + bun foot) for big tables."""
    h = top
    prof = [(r * 0.95, 0.0), (r * 1.12, h * 0.04), (r * 0.8, h * 0.1), (r * 0.62, h * 0.2), (r * 1.08, h * 0.42),
            (r * 0.95, h * 0.55), (r * 0.62, h * 0.68), (r * 0.78, h * 0.8), (r * 0.9, h * 0.86), (r * 0.9, h)]
    return S.lathe(prof, segs, base=(x, y, 0))


@builder('table_wake')
def table_wake(m: Model, spec: Spec) -> None:
    """Long wake table: thick top, scalloped apron, heavy turned legs, a lace runner and a cluster of three
    dripping candles in the middle (one in a little skull holder). Place settings stay clear at x = +-0.5."""
    j = m.rng
    top_t = 0.065
    m.add(S.box(1.92, 0.88, top_t, 0.018, 2, base=(0, 0, TH - top_t), rot=(0, j.sym(0.4), j.sym(0.4))))
    m.add(S.box(1.96, 0.92, 0.014, 0.006, 1, base=(0, 0, TH - top_t - 0.006)))
    ap_h = 0.1
    m.add(S.box(1.72, 0.7, ap_h, 0.012, 1, base=(0, 0, TH - top_t - ap_h)))
    # scalloped apron skirt on the long sides (front reads from the camera)
    for sy in (-1, 1):
        for k in range(6):
            x = -0.675 + k * 0.27
            m.add(S.sphere(0.075, 8, 3, loc=(x, sy * 0.352, TH - top_t - ap_h), scale=(1.0, 0.12, 0.55)), 'Paint')
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.add(_chunky_turned_leg(sx * 0.86, sy * 0.36, TH - top_t, 0.05, 10))
    # lace runner with scalloped ends hanging over the edges
    m.add(S.box(2.0, 0.32, 0.004, 0.0015, 1, base=(0, 0, TH)), 'Lace')
    for sx in (-1, 1):
        m.add(S.box(0.004, 0.32, 0.13, 0.0015, 1, base=(sx * 0.962, 0, TH - 0.128)), 'Lace')
        for k in range(5):
            m.add(S.sphere(0.024, 5, 3, loc=(sx * 0.963, -0.13 + k * 0.065, TH - 0.13), scale=(0.25, 1, 1)), 'Lace')
    for k in range(9):
        x = -0.8 + k * 0.2
        if abs(x) < 0.15:
            continue
        m.add(S.box(0.05, 0.05, 0.002, 0.0, 0, base=(x, 0.0, TH + 0.004), rot=(0, 0, 45)), 'Lining')
    # centrepiece: brass tray with three dripping candles (all within the 0.91 m model height)
    tz = TH + 0.004
    m.add(S.lathe([(0.0, 0.0), (0.13, 0.0), (0.14, 0.012), (0.125, 0.016), (0.0, 0.014)], 18, base=(0, 0, tz)), 'Brass')
    m.add(S.blob(0.09, 1, 0.3, 2.5, 3, loc=(0.02, 0.01, tz + 0.016), scale=(1.2, 0.9, 0.12)), 'Wax')
    m.add(S.blob(0.04, 1, 0.3, 2.5, 4, loc=(0.13, -0.03, TH + 0.006), scale=(1.0, 0.8, 0.12)), 'Wax')
    m.node('flame', origin=(0, 0, tz + 0.1), extras={'part': 'flame', 'alwaysOn': True}, transient=True)
    candles = (((0.0, 0.01), 0.088, 0.034), ((-0.075, -0.03), 0.06, 0.026), ((0.07, 0.04), 0.045, 0.024))
    for k, ((x, y), h, r) in enumerate(candles):
        base_z = tz + 0.016
        if k == 1:   # this one stands in a little skull holder
            sk, so = S.skull(0.032, loc=(x, y, base_z + 0.025), rot=(0, 0, 25), segs=8, jaw=False)
            m.add(sk, 'Bone')
            m.add(so, 'Black')
            base_z += 0.045
            h = 0.035
        m.add(S.candle(h, r, base=(x, y, base_z), drips=3 if k == 0 else 2, seed=12 + k), 'Wax')
        name = f'flame_{k}'
        fz = base_z + h * 0.95
        m.node(name, parent='flame', origin=(x, y, fz), transient=True)
        m.add(S.flame(0.042 - 0.006 * k, 0.012, base=(x, y, fz), lean=j.sym(0.006)), 'Flame', name)


@builder('counter_butcher')
def counter_butcher(m: Model, spec: Spec) -> None:
    j = m.rng
    d, y0 = 0.86, 0.06
    cabinet(m, 0.98, d, CH - 0.07, 'Paint', doors=2, drawer=True, knob_mat='Brass', y0=y0, j=j)
    # butcher block top: glued strips with alternating tones
    strips = 9
    for k in range(strips):
        x = -0.5 + (k + 0.5) / strips
        mat = 'WoodLight' if k % 2 == 0 else 'Pine'
        m.add(S.box(1.0 / strips - 0.002, d + 0.03, 0.07, 0.006, 1, base=(x, y0 - 0.015, CH - 0.07),
                    rot=(0, 0, 0)), mat)
    # scars and a stain
    m.add(S.box(0.16, 0.006, 0.003, 0.001, 1, base=(-0.15, -0.1, CH), rot=(0, 0, 28)), 'WoodDark')
    m.add(S.box(0.1, 0.006, 0.003, 0.001, 1, base=(-0.1, -0.16, CH), rot=(0, 0, -15)), 'WoodDark')
    m.add(S.blob(0.06, 1, 0.3, 3.0, 9, loc=(0.18, -0.05, CH), scale=(1.2, 1, 0.03)), 'BloodWine')
    # cleaver stuck in the top near the back
    blade = S.prism([(-0.09, 0.0), (0.07, 0.0), (0.075, 0.085), (-0.09, 0.075)], 0.006, 0.0015, 1, plane='XZ')
    handle = S.box(0.11, 0.022, 0.03, 0.008, 2, loc=(-0.15, 0, 0.055))
    cleaver = S.merge(blade)
    S.rotate(cleaver, (0, 8, 25))
    S.rotate(handle, (0, 8, 25))
    m.add(S.translate(cleaver, (0.05, 0.3, CH - 0.03)), 'Steel')
    m.add(S.translate(handle, (0.05, 0.3, CH - 0.03)), 'WoodDark')


@builder('counter_slab')
def counter_slab(m: Model, spec: Spec) -> None:
    j = m.rng
    d, y0 = 0.86, 0.06
    front = y0 - d / 2
    body_h = CH - 0.06
    m.add(S.box(0.98, d - 0.03, body_h - 0.06, 0.012, 2, base=(0, y0 + 0.015, 0.06)), 'Galvanised')
    m.add(S.box(0.9, d - 0.1, 0.06, 0.006, 1, base=(0, y0 + 0.03, 0)), 'Black')
    # morgue-style drawers with steel pulls and tiny name-card holders
    for k in range(3):
        h = (body_h - 0.1) / 3
        z = 0.08 + k * h
        m.add(S.box(0.9, 0.03, h - 0.02, 0.01, 2, base=(0, front - 0.01, z)), 'Steel')
        m.add(drawer_pull(0.0, front - 0.02, z + h * 0.55, 0.22), 'Chrome')
        m.add(S.box(0.09, 0.008, 0.045, 0.002, 1, base=(0.3, front - 0.028, z + h * 0.35)), 'Chrome')
        m.add(S.box(0.075, 0.004, 0.032, 0.001, 1, base=(0.3, front - 0.031, z + h * 0.36)), 'Paper')
    # veined marble top (tintable) with dark veins lying on it
    m.add(S.box(1.0, d + 0.03, 0.06, 0.012, 2, base=(0, y0 - 0.015, CH - 0.06)))
    for k in range(4):
        pts = []
        x = j.uniform(-0.45, 0.2)
        yy = front + 0.02
        for s in range(6):
            pts.append((x, yy, CH + 0.0008))
            x += j.uniform(0.04, 0.14)
            yy += (d + 0.0) / 6
            if x > 0.48:
                break
        if len(pts) >= 2:
            m.add(S.tube(pts, 0.0035, 3, scale_xy=(1.0, 0.2)), 'Slate')
    m.add(S.box(0.18, 0.07, 0.002, 0.0005, 1, base=(-0.25, -0.2, CH), rot=(0, 0, 8)), 'Paper')


def _hex_lid(length: float, head: float, shoulder: float, foot: float, z: float, t: float):
    outer = S.coffin_outline(length, head, shoulder, foot, axis='x')
    lid = S.prism(outer, t, 0.014, 2, plane='XY')
    S.translate(lid, (0, 0, z))
    inner = S.offset_outline(outer, 0.06)
    panel = S.prism(inner, 0.014, 0.006, 1, plane='XY')
    S.translate(panel, (0, 0, z + t))
    return lid, panel, outer


@builder('table_coffinlid')
def table_coffinlid(m: Model, spec: Spec) -> None:
    """Coffee table made from a chunky hexagonal coffin lid: thick moulded edge, raised centre panel (the table top at
    COFFEE_TABLE_HEIGHT), a brass cross + nameplate near the head, swing handles on the long sides and four squat
    turned legs. Item spots at x = +-0.4 stay flat."""
    j = m.rng
    H = dims.COFFEE_TABLE_HEIGHT
    outer = S.coffin_outline(1.86, 0.5, 0.76, 0.44, 0.26, axis='x')
    z0 = H - 0.115
    m.add(S.translate(S.prism(outer, 0.075, 0.02, 2, plane='XY'), (0, 0, z0)))
    m.add(S.band(outer, z0 + 0.03, z0 + 0.05, 0.012), 'WoodDark')
    panel_o = S.offset_outline(outer, 0.075)
    m.add(S.translate(S.prism(panel_o, 0.04, 0.014, 2, plane='XY'), (0, 0, H - 0.04)))
    m.add(S.band(panel_o, H - 0.04, H - 0.025, 0.006), 'WoodDark')
    for (x, y) in ((-0.62, -0.15), (-0.62, 0.15), (0.48, -0.25), (0.48, 0.25)):
        m.add(S.lathe([(0.05, 0.0), (0.065, 0.03), (0.05, 0.08), (0.036, 0.15), (0.05, 0.22), (0.058, z0)], 10,
                      base=(x, y, 0)), 'WoodDark')
    # brass swing handles on both long sides
    for sy in (-1, 1):
        for x in (-0.42, 0.3):
            yy = sy * (0.33 if x > 0 else 0.3)
            m.add(S.cylinder(0.011, 0.22, 8, 0.0, base=(x - 0.11, yy + sy * 0.035, z0 + 0.035), rot=(0, 90, 0)),
                  'Brass')
            for dx in (-0.09, 0.09):
                m.add(S.box(0.02, 0.045, 0.022, 0.0, 0, loc=(x + dx, yy + sy * 0.014, z0 + 0.035)), 'Brass')
    # brass cross + nameplate at the head end (+X), brass studs round the panel
    m.add(S.box(0.2, 0.04, 0.006, 0.002, 1, base=(0.7, 0, H)), 'Brass')
    m.add(S.box(0.05, 0.13, 0.006, 0.002, 1, base=(0.66, 0, H)), 'Brass')
    m.add(S.box(0.12, 0.07, 0.004, 0.002, 1, base=(0.0, 0.0, H)), 'Brass')
    m.add(S.text('R.I.P.', 0.034, 0.002, loc=(0.0, 0.0, H + 0.0045), rot=(0, 0, 0)), 'WoodDark')
    for k, (x, y) in enumerate(S.offset_outline(outer, 0.035)):
        m.add(S.sphere(0.011, 6, 4, loc=(x, y, H - 0.04), scale=(1, 1, 0.6)), 'Brass')
    # a crocheted doily and a tea-ring stain: lived-in
    m.add(S.cylinder(0.11, 0.003, 16, 0.0, base=(-0.4, 0.06, H)), 'Doily')
    m.add(S.torus(0.035, 0.004, 12, 3, loc=(0.38, -0.12, H + 0.001)), 'WoodDark')


@builder('table_urnstand')
def table_urnstand(m: Model, spec: Spec) -> None:
    """Round pedestal side table (top at 0.62): moulded top with a lace doily, bulbous turned column, three big claw
    feet on curved knees, and the dusty ring where Aunt Mildred's urn used to stand."""
    j = m.rng
    H = 0.62
    m.add(S.lathe([(0.0, 0.0), (0.27, 0.0), (0.3, 0.014), (0.305, 0.032), (0.29, 0.045), (0.0, 0.045)], 28,
                  base=(0, 0, H - 0.045)))
    m.add(S.cylinder(0.25, 0.03, 24, 0.008, base=(0, 0, H - 0.075)), 'WoodDark')
    prof = [(0.1, 0.1), (0.06, 0.13), (0.05, 0.17), (0.09, 0.25), (0.1, 0.3), (0.075, 0.36), (0.042, 0.42),
            (0.05, 0.47), (0.07, 0.5), (0.05, 0.53), (0.08, H - 0.075)]
    m.add(S.lathe(prof, 14, base=(0, 0, 0)))
    m.add(S.lathe([(0.15, 0.0), (0.155, 0.04), (0.12, 0.09), (0.0, 0.1)], 14, base=(0, 0, 0)), 'WoodDark')
    for k in range(3):
        a = math.radians(90 + 120 * k + 30)
        ca, sa = math.cos(a), math.sin(a)
        knee = S.catmull([(ca * 0.09, sa * 0.09, 0.12), (ca * 0.17, sa * 0.17, 0.13), (ca * 0.23, sa * 0.23, 0.08),
                          (ca * 0.25, sa * 0.25, 0.05)], 3)
        m.add(S.tube(knee, radii=[0.04, 0.036, 0.03, 0.028, 0.026, 0.024, 0.022, 0.022, 0.022, 0.022], segs=7))
        m.add(claw_foot(ca * 0.25, sa * 0.25, 0.055, yaw=math.degrees(a) + 90), 'Brass')
    m.add(S.cylinder(0.17, 0.003, 18, 0.0, base=(0.02, 0.0, H)), 'Doily')
    for k in range(18):
        a = math.tau * k / 18
        m.add(S.sphere(0.014, 5, 3, loc=(0.02 + math.cos(a) * 0.17, math.sin(a) * 0.17, H + 0.001), scale=(1, 1, 0.25)),
              'Doily')
    m.add(S.torus(0.075, 0.012, 20, 3, loc=(0.03, 0.02, H + 0.003), rot=(0, 0, 0)), 'Ash')
