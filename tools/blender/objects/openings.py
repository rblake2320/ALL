"""Doors & windows. Centred on the wall plane (Blender y = 0), x spans one tile edge [-0.5, 0.5], wall thickness
WALL_THICKNESS. Door leaves hang from a 'door' pivot at the hinge (renderer may swing them while in use)."""
from __future__ import annotations

import math

from mathutils import Vector

from common import dims
from common import shapes as S
from common.catalog import Spec
from common.model import Model

from .parts import cobweb, nail_heads
from .registry import builder

T = dims.WALL_THICKNESS
DW, DH = dims.DOOR_WIDTH, dims.DOOR_HEIGHT
WW, WH, SILL = dims.WINDOW_WIDTH, dims.WINDOW_HEIGHT, dims.WINDOW_SILL
FD = T + 0.04   # frame depth: proud of the wall by 2 cm on both faces


def _door_frame(m: Model, mat: str, top_extra: float = 0.1) -> None:
    jw = 0.5 - DW / 2
    for sx in (-1, 1):
        m.add(S.box(jw, FD, DH + top_extra, 0.008, 1, base=(sx * (DW / 2 + jw / 2), 0, 0)), mat)
        # architrave lips on both wall faces
        for sy in (-1, 1):
            m.add(S.box(jw + 0.012, 0.016, DH + top_extra, 0.005, 1, base=(sx * (DW / 2 + jw / 2), sy * (FD / 2 + 0.006), 0)),
                  mat)
    m.add(S.box(1.0, FD, top_extra, 0.008, 1, base=(0, 0, DH)), mat)
    for sy in (-1, 1):
        m.add(S.box(1.0, 0.02, top_extra + 0.02, 0.006, 1, base=(0, sy * (FD / 2 + 0.008), DH - 0.01)), mat)
    m.add(S.box(DW, FD, 0.015, 0.004, 1, base=(0, 0, 0)), 'Brass')


@builder('door_splintered')
def door_splintered(m: Model, spec: Spec) -> None:
    j = m.rng
    _door_frame(m, 'Paint')
    lw, lh, lt = DW - 0.012, DH - 0.02, 0.045
    hinge = (-DW / 2 + 0.004, 0.0, 0.0)
    m.node('door', origin=hinge, extras={'part': 'door', 'openAngle': -1.45})
    m.node('door_leaf', parent='door', origin=hinge)
    x0 = -DW / 2 + 0.006
    cx = x0 + lw / 2
    m.add(S.box(lw, lt, lh, 0.01, 2, base=(cx, 0, 0.012)), 'Paint', 'door_leaf')
    # raised panels on both faces + claw scratches + splinters
    for sy in (-1, 1):
        for (pz, ph) in ((0.12, 0.8), (1.05, 0.85)):
            for px in (-0.19, 0.19):
                m.add(S.box(0.3, 0.012, ph, 0.006, 1, base=(cx + px, sy * (lt / 2 + 0.004), pz)), 'Paint', 'door_leaf')
    for k in range(4):
        z = 1.25 - k * 0.04
        m.add(S.box(0.004, 0.006, 0.32, 0.0, 0, base=(cx - 0.08 + k * 0.035, -lt / 2 - 0.011, z - 0.3), rot=(0, 12, 0)),
              'WoodEbony', 'door_leaf')
    for k in range(3):
        sp = S.cone(0.012, 0.08, 4, base=(0, 0, 0), rot=(0, 90 + j.sym(30), 0))
        m.add(S.translate(sp, (x0 + lw - 0.01, -lt / 2 + 0.01, 0.4 + k * 0.5 + j.sym(0.1))), 'WoodLight', 'door_leaf')
    # brass knob on both faces + keyhole plate + hinges
    for sy in (-1, 1):
        kx, kz = x0 + lw - 0.08, 1.0
        m.add(S.box(0.05, 0.008, 0.14, 0.003, 1, base=(kx, sy * (lt / 2 + 0.004), kz - 0.09)), 'Brass', 'door_leaf')
        k_ = S.lathe([(0.012, 0.0), (0.012, 0.03), (0.03, 0.045), (0.028, 0.06), (0.0, 0.065)], 10)
        S.rotate(k_, (sy * -90, 0, 0))
        m.add(S.translate(k_, (kx, sy * (lt / 2 + 0.008), kz)), 'Brass', 'door_leaf')
    for z in (0.2, 1.0, 1.85):
        m.add(S.cylinder(0.011, 0.09, 8, 0.0, base=(x0 - 0.004, -lt / 2 - 0.004, z)), 'Iron', 'door_leaf')


@builder('door_crypt')
def door_crypt(m: Model, spec: Spec) -> None:
    j = m.rng
    jw = 0.5 - DW / 2
    spring = DH - DW / 2  # arch springs here, apex at DH
    # stone jambs (quoins) + voussoir arch + spandrel infill (fills the rectangle corners of the opening)
    z = 0.0
    k = 0
    while z < spring - 0.05:
        h = min(0.3 if k % 2 == 0 else 0.22, spring - z)
        wid = jw + (0.02 if k % 2 == 0 else 0.0)
        for sx in (-1, 1):
            m.add(S.box(wid, FD + 0.02, h - 0.01, 0.012, 1, base=(sx * (0.5 - wid / 2 + (0.0 if k % 2 == 0 else 0.0)), 0, z)),
                  'StoneLight', None)
        z += h
        k += 1
    r_in, r_out = DW / 2, DW / 2 + jw
    n = 9
    for i in range(n):
        a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
        poly = [(math.cos(a0) * r_in, math.sin(a0) * r_in), (math.cos(a0) * r_out, math.sin(a0) * r_out),
                (math.cos(a1) * r_out, math.sin(a1) * r_out), (math.cos(a1) * r_in, math.sin(a1) * r_in)]
        poly = [(x, z_) for x, z_ in poly][::-1]
        vb = S.prism(poly, FD + 0.03 if i == n // 2 else FD + 0.02, 0.006, 1, plane='XZ')
        m.add(S.translate(vb, (0, 0, spring)), 'StoneLight' if i != n // 2 else 'Granite')
    # keystone skull
    sk, so = S.skull(0.05, loc=(0, -FD / 2 - 0.03, spring + r_out - 0.04), segs=7)
    m.add(sk, 'Bone')
    m.add(so, 'Black')
    for sx in (-1, 1):
        poly = [(sx * r_out, 0.0), (sx * 0.5, 0.0), (sx * 0.5, r_out + 0.06), (0.0 + sx * 0.12, r_out + 0.06)]
        pts = [(sx * (math.cos(a) * r_out), math.sin(a) * r_out) for a in (0.0, 0.35, 0.7, 1.05, 1.4)]
        poly = [(sx * 0.5, 0.0), (sx * 0.5, r_out + 0.06)] + [(x, z_) for x, z_ in reversed(pts)]
        if sx < 0:
            poly = poly[::-1]
        sp = S.prism(poly, FD, 0.0, 0, plane='XZ')
        m.add(S.translate(sp, (0, 0, spring)), 'Granite')
    m.add(S.box(1.0, FD + 0.04, 0.04, 0.008, 1, base=(0, 0, 0)), 'Granite')
    # arched dark-wood leaf with iron bands, studs and a ring knocker
    hinge = (-DW / 2 + 0.004, 0.0, 0.0)
    m.node('door', origin=hinge, extras={'part': 'door', 'openAngle': -1.4})
    m.node('door_leaf', parent='door', origin=hinge)
    lt = 0.06
    leaf_poly = [(-DW / 2 + 0.008, 0.04), (DW / 2 - 0.008, 0.04), (DW / 2 - 0.008, spring)]
    for i in range(1, 12):
        a = math.pi * i / 12
        leaf_poly.append((math.cos(a) * (DW / 2 - 0.008), spring + math.sin(a) * (DW / 2 - 0.012)))
    leaf_poly.append((-DW / 2 + 0.008, spring))
    m.add(S.prism(leaf_poly, lt, 0.008, 1, plane='XZ'), 'Paint', 'door_leaf')
    for k in range(1, 5):  # planks
        x = -DW / 2 + k * DW / 5
        hgt = spring + math.sqrt(max(0.0, (DW / 2) ** 2 - x * x)) - 0.06
        for sy in (-1, 1):
            m.add(S.box(0.008, 0.006, hgt - 0.06, 0.0, 0, base=(x, sy * (lt / 2 + 0.002), 0.06)), 'WoodEbony', 'door_leaf')
    for zb in (0.32, 1.0, 1.62):
        for sy in (-1, 1):
            m.add(S.box(DW - 0.04, 0.012, 0.07, 0.004, 1, base=(0, sy * (lt / 2 + 0.006), zb)), 'Iron', 'door_leaf')
            for k in range(4):
                m.add(S.sphere(0.012, 5, 3, loc=(-0.3 + k * 0.2, sy * (lt / 2 + 0.013), zb + 0.035), scale=(1, 0.6, 1)),
                      'Iron', 'door_leaf')
    m.add(S.torus(0.06, 0.012, 14, 5, loc=(0.0, -lt / 2 - 0.03, 1.2), rot=(90, 0, 0)), 'Iron', 'door_leaf')
    m.add(S.sphere(0.03, 8, 6, loc=(0.0, -lt / 2 - 0.012, 1.27), scale=(1, 0.6, 1)), 'Iron', 'door_leaf')
    m.add(S.box(0.06, 0.012, 0.12, 0.004, 1, base=(0.3, -lt / 2 - 0.006, 0.95)), 'Iron', 'door_leaf')
    m.add(S.cylinder(0.02, 0.04, 8, 0.0, base=(0.3, -lt / 2 - 0.012, 1.0), rot=(90, 0, 0)), 'Iron', 'door_leaf')


def _window_box(m: Model, mat: str, top: float) -> None:
    """Jambs + head + protruding sill around [SILL, top]."""
    jw = 0.5 - WW / 2
    h = top - SILL
    for sx in (-1, 1):
        m.add(S.box(jw, FD, h, 0.008, 1, base=(sx * (WW / 2 + jw / 2), 0, SILL)), mat)
    m.add(S.box(1.0, FD, 0.07, 0.01, 2, base=(0, 0, top)), mat)
    for sy in (-1, 1):
        m.add(S.box(1.0, 0.05, 0.05, 0.012, 2, base=(0, sy * (FD / 2 + 0.01), SILL - 0.05)), mat)
        m.add(S.box(0.92, 0.03, 0.05, 0.008, 1, base=(0, sy * (FD / 2 + 0.005), SILL - 0.1)), mat)


@builder('window_grimy')
def window_grimy(m: Model, spec: Spec) -> None:
    j = m.rng
    top = SILL + WH
    _window_box(m, 'Paint', top)
    # double-hung sashes (lower one jammed open a crack), 2x2 muntins each
    sw = WW
    mid = SILL + WH / 2
    for k, (z0, z1, y) in enumerate(((SILL, mid + 0.03, -0.018), (mid - 0.03, top, 0.018))):
        h = z1 - z0
        st = 0.045
        for sx in (-1, 1):
            m.add(S.box(st, 0.035, h, 0.006, 1, base=(sx * (sw / 2 - st / 2), y, z0)))
        m.add(S.box(sw, 0.035, st, 0.006, 1, base=(0, y, z0)))
        m.add(S.box(sw, 0.035, st, 0.006, 1, base=(0, y, z1 - st)))
        m.add(S.box(0.02, 0.025, h - 2 * st, 0.0, 0, base=(0, y, z0 + st)))
        m.add(S.box(sw - 2 * st, 0.025, 0.02, 0.0, 0, base=(0, y, z0 + h / 2 - 0.01)))
        m.add(S.box(sw - 2 * st, 0.006, h - 2 * st, 0.0, 0, base=(0, y, z0 + st)), 'Glass')
        # smudges and drips on the glass
        for q in range(3):
            x = j.uniform(-0.25, 0.25)
            zz = j.uniform(z0 + 0.08, z1 - 0.08)
            m.add(S.sphere(j.uniform(0.04, 0.08), 8, 4, loc=(x, y - 0.006, zz), scale=(1.4, 0.06, 0.8)), 'Smudge')
    # a cracked pane + a cobweb in the top corner
    crack = S.jagged((0.08, -0.026, top - 0.12), (0.3, -0.026, top - 0.4), 4, 0.03, j, normal=(0, -1, 0))
    m.add(S.tube(crack, 0.003, 3), 'Cobweb')
    m.add(cobweb((-WW / 2 + 0.045, -0.04, top - 0.045), 0.16, ('x', 'z'), (1, -1)), 'Cobweb')


@builder('window_gothic')
def window_gothic(m: Model, spec: Spec) -> None:
    j = m.rng
    top = SILL + spec.height
    rect_top = SILL + WH
    jw = 0.5 - WW / 2
    # dark frame: jambs, sill, and a pointed-arch head built from ring segments
    for sx in (-1, 1):
        m.add(S.box(jw, FD, rect_top - SILL, 0.008, 1, base=(sx * (WW / 2 + jw / 2), 0, SILL)))
    for sy in (-1, 1):
        m.add(S.box(1.0, 0.05, 0.05, 0.012, 2, base=(0, sy * (FD / 2 + 0.01), SILL - 0.05)))
    m.add(S.box(1.0, FD, 0.05, 0.01, 1, base=(0, 0, SILL - 0.05)))
    n = 8
    left = [(-WW / 2 + (WW / 2) * i / n, _arch_z(-WW / 2 + (WW / 2) * i / n, rect_top, top, WW)) for i in range(n + 1)]
    curve = left + [(-x, z) for x, z in reversed(left[:-1])]
    outer = [(x / (WW / 2) * 0.5, z + 0.07) for x, z in curve]
    for i in range(len(curve) - 1):
        quad = [curve[i], curve[i + 1], outer[i + 1], outer[i]]
        m.add(S.prism(quad[::-1], FD, 0.0, 0, plane='XZ'))
    for sx in (-1, 1):  # fill the corners above the jambs up to the arch springing
        m.add(S.prism([(sx * WW / 2, rect_top), (sx * 0.5, rect_top), (sx * 0.5, rect_top + 0.07)][::sx], FD, 0.0, 0,
                      plane='XZ'))
    # glass fills the rectangle + the arch
    glass_poly = [(-WW / 2, SILL), (WW / 2, SILL)] + [(x, z) for x, z in reversed(curve)]
    m.add(S.prism(glass_poly, 0.008, 0.0, 0, plane='XZ'), 'Glass')
    # leaded diamond lattice clipped to the window shape (both faces)
    for k in range(-8, 9):
        for sgn in (1, -1):
            a = Vector((k * 0.13, 0.0, SILL))
            d = Vector((sgn * 0.55, 0, 1.0)).normalized()
            seg = []
            for s_ in range(26):
                p = a + d * (s_ * 0.09)
                if abs(p.x) <= WW / 2 - 0.01 and SILL + 0.01 <= p.z <= _arch_z(p.x, rect_top, top, WW) - 0.01:
                    seg.append(p)
            if len(seg) >= 2:
                for sy in (-1, 1):
                    m.add(S.tube([Vector((q.x, sy * 0.006, q.z)) for q in seg], 0.006, 3, cap=False), 'Iron')
    # stained accent panes
    for (x, z, mat) in ((0.0, top - 0.18, 'StainedRed'), (-0.2, SILL + 0.5, 'StainedGreen'),
                        (0.2, SILL + 0.85, 'StainedBlue'), (0.13, SILL + 0.2, 'StainedRed')):
        dia = S.prism([(0.0, -0.06), (0.05, 0.0), (0.0, 0.06), (-0.05, 0.0)], 0.012, 0.0, 0, plane='XZ')
        m.add(S.translate(dia, (x, 0, z)), mat)
    m.add(S.box(0.03, FD, top - SILL - 0.05, 0.004, 1, base=(0, 0, SILL)), 'Iron')


def _arch_z(x: float, rect_top: float, top: float, w: float) -> float:
    t = 1.0 - min(1.0, abs(x) / (w / 2))
    return rect_top + (top - rect_top) * math.sin(t * math.pi / 2) ** 0.8
