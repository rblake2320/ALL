"""Electronics: CRT TV, seance flat-screen, boombox, haunted desktop PC. Screens are single-sided emissive
surfaces facing the FRONT (Blender -Y) so their mean normal identifies the facing."""
from __future__ import annotations

import math

import bmesh

from common import dims
from common import shapes as S
from common.catalog import Spec
from common.model import Model

from .parts import add_broken, knob, leg, turned_leg
from .registry import builder

SH = dims.SEAT_HEIGHT
TH = dims.TABLE_HEIGHT


def screen_surface(w: float, h: float, bulge: float = 0.0, nx: int = 6, nz: int = 5,
                   center=(0.0, 0.0, 0.0), tilt: float = 0.0) -> bmesh.types.BMesh:
    """Single-sided screen facing -Y, optionally bulged toward the viewer (CRT)."""
    bm = S.grid(w, h, nx, nz)
    S.rotate(bm, (90, 0, 0))  # +Z facing grid -> faces -Y
    if bulge:
        for v in bm.verts:
            u = v.co.x / (w / 2)
            t = v.co.z / (h / 2)
            v.co.y -= bulge * (1 - 0.6 * u * u) * (1 - 0.6 * t * t)
    if tilt:
        S.rotate(bm, (tilt, 0, 0))
    return S.translate(bm, center)


@builder('tv_crt')
def tv_crt(m: Model, spec: Spec) -> None:
    j = m.rng
    # mid-century stand with a VHS shelf
    st = 0.45
    m.add(S.box(0.64, 0.46, 0.035, 0.01, 2, base=(0, 0.05, st - 0.035)), 'WoodDark')
    m.add(S.box(0.58, 0.4, 0.02, 0.006, 1, base=(0, 0.05, 0.16)), 'WoodDark')
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.add(leg(sx * 0.26, 0.05 + sy * 0.17, st - 0.035, 0.035, 0.022, (sx * 0.03, sy * 0.03)), 'WoodDark')
    for k in range(4):
        m.add(S.box(0.035, 0.19, 0.105, 0.004, 1, base=(-0.2 + k * 0.045, 0.05, 0.18), rot=(0, j.sym(4) if k == 3 else 0, 0)),
              'Black' if k % 2 else 'PlasticDark')
    # cabinet (wood veneer, Paint) with a tapered CRT back
    z0, z1 = st, st + 0.5
    m.add(S.box(0.66, 0.36, z1 - z0, 0.04, 3, base=(0, -0.03, z0)))
    back = S.taper_box(0.5, 0.38, 0.3, 0.22, 0.24, 0.02, 2, base=(0, 0, 0))
    S.rotate(back, (-90, 0, 0))
    m.add(S.translate(back, (0, 0.15, (z0 + z1) / 2)), 'PlasticDark')
    yf = -0.03 - 0.18
    m.add(S.box(0.46, 0.02, 0.38, 0.03, 2, base=(-0.07, yf - 0.006, z0 + 0.06)), 'PlasticDark')
    m.node('screen', origin=(-0.07, yf - 0.02, (z0 + z1) / 2), extras={'part': 'screen'}, transient=True)
    m.add(screen_surface(0.4, 0.32, 0.025, 6, 5, center=(-0.07, yf - 0.018, (z0 + z1) / 2)), 'ScreenCRT', 'screen')
    # side controls + speaker grille
    for k in range(2):
        m.add(knob(0.24, yf - 0.002, z0 + 0.38 - k * 0.1, 0.025, 0.025, segs=8), 'Brass')
    for k in range(5):
        m.add(S.box(0.09, 0.006, 0.008, 0.0, 0, base=(0.24, yf - 0.002, z0 + 0.06 + k * 0.025)), 'Black')
    # rabbit ears, one wearing a tin-foil hat
    m.add(S.lathe([(0.06, 0), (0.06, 0.02), (0.035, 0.045), (0.0, 0.05)], 10, base=(0.08, 0.02, z1)), 'Black')
    for sx, ang in ((-1, 32), (1, 24)):
        a = math.radians(ang)
        tip = (0.08 + sx * math.sin(a) * 0.32, 0.02 + 0.05, z1 + 0.04 + math.cos(a) * 0.3)
        mid = (0.08 + sx * math.sin(a) * 0.16 + (0.02 if sx > 0 else 0), 0.045, z1 + 0.04 + math.cos(a) * 0.15)
        m.add(S.tube([(0.08, 0.02, z1 + 0.04), mid, tip], 0.005, 4), 'Chrome')
        m.add(S.sphere(0.01, 6, 4, loc=tip), 'Chrome')
    foil = S.blob(0.035, 1, 0.45, 4, 5, loc=(0.08 + math.sin(math.radians(24)) * 0.3, 0.07, z1 + 0.04 + math.cos(math.radians(24)) * 0.28),
                  scale=(1, 1, 0.8))
    m.add(foil, 'Chrome')
    add_broken(m, (0.1, 0.0, z1 + 0.1), 0.9)


@builder('tv_seance')
def tv_seance(m: Model, spec: Spec) -> None:
    j = m.rng
    W, D, H = 1.84, 0.46, 0.56
    y0 = 0.12
    yf = y0 - D / 2
    m.add(S.box(W, D, H - 0.1, 0.015, 2, base=(0, y0, 0.08)))
    m.add(S.box(W + 0.06, D + 0.05, 0.04, 0.015, 2, base=(0, y0, H - 0.02)))
    m.add(S.box(W + 0.02, D + 0.02, 0.03, 0.01, 1, base=(0, y0, 0.06)))
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.add(S.lathe([(0.04, 0), (0.05, 0.02), (0.035, 0.05), (0.045, 0.065)], 10,
                          base=(sx * (W / 2 - 0.08), y0 + sy * (D / 2 - 0.07), 0)), 'WoodEbony')
    # gothic pointed-arch door panels across the front
    arch = [(-0.17, 0.0), (0.17, 0.0), (0.17, 0.2), (0.12, 0.28), (0.0, 0.34), (-0.12, 0.28), (-0.17, 0.2)]
    for k in range(4):
        x = -0.66 + k * 0.44
        p = S.prism(arch, 0.02, 0.006, 1, plane='XZ')
        m.add(S.translate(p, (x, yf - 0.01, 0.12)))
        inner = S.prism([(u * 0.75, v * 0.82) for u, v in arch], 0.02, 0.004, 1, plane='XZ')
        m.add(S.translate(inner, (x, yf - 0.02, 0.15)), 'Slate')
        m.add(S.sphere(0.014, 8, 6, loc=(x + (0.13 if k % 2 == 0 else -0.13), yf - 0.03, 0.27)), 'Gold')
    # flat screen on a stand
    sw, sh = 1.36, 0.78
    zc = H + 0.12 + sh / 2
    m.add(S.box(0.3, 0.18, 0.02, 0.008, 1, base=(0, y0 + 0.02, H + 0.02)), 'Black')
    m.add(S.box(0.06, 0.03, 0.14, 0.008, 1, base=(0, y0 + 0.06, H + 0.03)), 'Black')
    m.add(S.box(sw, 0.05, sh, 0.015, 2, loc=(0, y0 + 0.04, zc)), 'Black')
    m.node('screen', origin=(0, y0 + 0.012, zc), extras={'part': 'screen'}, transient=True)
    m.add(screen_surface(sw - 0.06, sh - 0.06, 0.0, 4, 3, center=(0, y0 + 0.013, zc)), 'ScreenTV', 'screen')
    # tall candles + an ouija planchette on the console
    for sx in (-1, 1):
        x = sx * 0.8
        m.add(S.lathe([(0.05, 0), (0.055, 0.01), (0.02, 0.025), (0.016, 0.08), (0.035, 0.095)], 10, base=(x, y0, H + 0.02)),
              'Brass')
        h = 0.22 if sx < 0 else 0.16
        m.add(S.candle(h, 0.022, base=(x, y0, H + 0.115), drips=3, seed=sx + 3), 'Wax')
    # decorative candles (no light spec): always burning, see docs/contract-requests/assets-objects.md
    m.node('flame', origin=(0, y0, H + 0.3), extras={'part': 'flame', 'alwaysOn': True}, transient=True)
    for sx in (-1, 1):
        h = 0.22 if sx < 0 else 0.16
        name = 'flame_l' if sx < 0 else 'flame_r'
        m.node(name, parent='flame', origin=(sx * 0.8, y0, H + 0.115 + h - 0.008), transient=True)
        m.add(S.flame(0.05, 0.014, base=(sx * 0.8, y0, H + 0.115 + h - 0.008)), 'Flame', name)
    plan = S.prism([(-0.05, -0.04), (0.05, -0.04), (0.0, 0.07)], 0.012, 0.004, 1, plane='XY')
    m.add(S.translate(S.rotate(plan, (0, 0, 20)), (0.5, yf + 0.1, H + 0.02)), 'Bone')
    m.add(S.torus(0.016, 0.004, 10, 3, loc=(0.5, yf + 0.11, H + 0.034)), 'Gold')
    add_broken(m, (0.3, y0, zc + sh / 2 + 0.05), 1.0)


@builder('stereo_boombox')
def stereo_boombox(m: Model, spec: Spec) -> None:
    j = m.rng
    # low speaker cabinet with a woofer
    cw, cd, ch = 0.72, 0.44, 0.5
    y0 = 0.08
    yf = y0 - cd / 2
    m.add(S.box(cw, cd, ch, 0.025, 2, base=(0, y0, 0)), 'WoodDark')
    m.add(S.box(cw - 0.06, 0.02, ch - 0.08, 0.01, 1, base=(0, yf - 0.005, 0.04)), 'Black')
    m.node('speaker', origin=(0, yf, 0.3), extras={'part': 'speaker'})
    cones = [((0.0, yf - 0.012, 0.25), 0.17, 'speaker_0')]
    # the boombox
    bw, bd, bh = 0.7, 0.24, 0.3
    bz = ch
    by = y0 - 0.02
    byf = by - bd / 2
    m.add(S.box(bw, bd, bh, 0.05, 3, base=(0, by, bz)))
    handle = S.catmull([(-0.28, by, bz + bh - 0.01), (-0.26, by, bz + bh + 0.08), (0.0, by, bz + bh + 0.11),
                        (0.26, by, bz + bh + 0.08), (0.28, by, bz + bh - 0.01)], 3)
    m.add(S.tube(handle, 0.016, 6), 'Chrome')
    for sx in (-1, 1):
        cones.append(((sx * 0.21, byf - 0.006, bz + bh / 2 - 0.01), 0.1, f'speaker_{1 if sx < 0 else 2}'))
        m.add(S.torus(0.104, 0.012, 16, 4, loc=(sx * 0.21, byf - 0.004, bz + bh / 2 - 0.01), rot=(90, 0, 0)), 'Chrome')
    # cassette deck window + cassette, buttons, telescoping antenna
    m.add(S.box(0.2, 0.012, 0.12, 0.008, 1, base=(0, byf - 0.004, bz + 0.1)), 'PlasticDark')
    m.add(S.box(0.16, 0.006, 0.08, 0.004, 1, base=(0, byf - 0.012, bz + 0.12)), 'Glass')
    m.add(S.box(0.14, 0.004, 0.06, 0.0, 0, base=(0, byf - 0.008, bz + 0.13)), 'Paper')
    for sx in (-1, 1):
        m.add(S.torus(0.012, 0.004, 8, 3, loc=(sx * 0.035, byf - 0.011, bz + 0.16), rot=(90, 0, 0)), 'Black')
    for k in range(6):
        m.add(S.box(0.03, 0.04, 0.02, 0.005, 1, base=(-0.1 + k * 0.04, by + 0.02, bz + bh - 0.005)),
              'Magnet1' if k == 0 else 'Chrome')
    m.add(S.tube([(0.3, by + 0.08, bz + bh - 0.02), (0.36, by + 0.12, bz + bh + 0.14)], 0.006, 4), 'Chrome')
    m.add(S.sphere(0.012, 6, 4, loc=(0.36, by + 0.12, bz + bh + 0.145)), 'Chrome')
    for k, (x, z) in enumerate(((-0.1, bz + 0.25), (0.25, bz + 0.27), (-0.3, 0.42))):
        sk = S.cylinder(0.026, 0.003, 10, 0.0, base=(0, 0, 0), rot=(90, 0, 0))
        yy = byf - 0.002 if z > bz else yf - 0.012
        m.add(S.translate(sk, (x, yy, z)), 'Bone')
        for sx in (-1, 1):
            m.add(S.cylinder(0.007, 0.003, 6, 0.0, base=(x + sx * 0.009, yy - 0.003, z + 0.003), rot=(90, 0, 0)), 'Black')
    # speaker cones (each pulses about its own centre)
    for (c, r, name) in cones:
        m.node(name, parent='speaker', origin=c)
        cone = S.lathe([(r, 0.0), (r * 0.8, 0.012), (r * 0.35, 0.035), (r * 0.25, 0.03), (0.0, 0.022)], 14)
        S.rotate(cone, (90, 0, 0))  # opening faces -Y
        m.add(S.translate(cone, c), 'Rubber', name)
        m.add(S.sphere(r * 0.22, 8, 5, loc=(c[0], c[1] + 0.02, c[2]), scale=(1, 0.5, 1)), 'PlasticDark', name)
    add_broken(m, (0.0, y0, bz + bh + 0.1), 0.8)


@builder('desk_hauntedpc')
def desk_hauntedpc(m: Model, spec: Spec) -> None:
    j = m.rng
    # desk on the back tile (Blender y in [0, 1]); front edge near y = 0.04
    dy0, dy1 = 0.04, 0.74
    dyc = (dy0 + dy1) / 2
    m.add(S.box(0.96, dy1 - dy0, 0.04, 0.012, 2, base=(0, dyc, TH - 0.04)))
    # open kneehole: the stool sitter's legs and feet (up to ~0.35 m either side, ~0.7 m under the desk) need the
    # whole space under the top (tests/unit/seating), so the drawers hang under the desktop above knee height and
    # the beige tower stands on the desk, left of the monitor
    px, pw = -0.31, 0.3
    dz0 = TH - 0.04 - 0.16
    m.add(S.box(pw, dy1 - dy0 - 0.04, 0.16, 0.012, 2, base=(px, dyc, dz0)))
    for k in range(2):
        m.add(S.box((pw - 0.04) / 2 - 0.01, 0.02, 0.12, 0.008, 1, base=(px + (k - 0.5) * pw / 2, dy0 - 0.005, dz0 + 0.02)))
        m.add(S.box(0.06, 0.02, 0.018, 0.005, 1, base=(px + (k - 0.5) * pw / 2, dy0 - 0.02, dz0 + 0.08)), 'Brass')
    for sx in (-1, 1):
        for sy in (dy0 + 0.04, dy1 - 0.04):
            m.add(S.box(0.04, 0.04, TH - 0.04, 0.008, 1, base=(sx * 0.44, sy, 0)))
        m.add(S.box(0.04, dy1 - dy0 - 0.08, 0.04, 0.006, 1, base=(sx * 0.44, dyc, 0.12)))
    tx, ty = -0.34, 0.5
    m.add(S.box(0.16, 0.36, 0.4, 0.012, 2, base=(tx, ty, TH)), 'PlasticBeige')
    m.add(S.box(0.1, 0.01, 0.015, 0.0, 0, base=(tx, ty - 0.185, TH + 0.3)), 'Black')
    # power LED in its own 'glow' node (off when the PC is unpowered)
    m.node('glow', origin=(tx + 0.04, ty - 0.185, TH + 0.06), extras={'part': 'glow'}, transient=True)
    m.add(S.sphere(0.008, 6, 4, loc=(tx + 0.04, ty - 0.185, TH + 0.06)), 'GlowToxic', 'glow')
    # CRT monitor facing the front (-Y)
    my = 0.42
    mz = TH + 0.04
    m.add(S.box(0.2, 0.18, 0.04, 0.01, 1, base=(0.0, my, TH)), 'PlasticBeige')
    m.add(S.box(0.44, 0.34, 0.38, 0.03, 2, base=(0.0, my - 0.02, mz)), 'PlasticBeige')
    back = S.taper_box(0.38, 0.32, 0.24, 0.2, 0.16, 0.02, 1, base=(0, 0, 0))
    S.rotate(back, (-90, 0, 0))
    m.add(S.translate(back, (0.0, my + 0.15, mz + 0.19)), 'PlasticBeige')
    m.node('screen', origin=(0.0, my - 0.2, mz + 0.2), extras={'part': 'screen'}, transient=True)
    m.add(screen_surface(0.33, 0.26, 0.018, 5, 4, center=(0.0, my - 0.195, mz + 0.2)), 'ScreenPC', 'screen')
    # keyboard at the front edge + mouse
    kb = S.box(0.42, 0.15, 0.025, 0.008, 1, base=(-0.02, dy0 + 0.1, TH), rot=(3, 0, j.sym(3)))
    m.add(kb, 'PlasticBeige')
    for r in range(3):
        m.add(S.box(0.38, 0.03, 0.008, 0.002, 1, base=(-0.02, dy0 + 0.06 + r * 0.035, TH + 0.024), rot=(3, 0, 0)), 'PlasticDark')
    m.add(S.blob(0.03, 1, 0.1, 2, 2, loc=(0.3, dy0 + 0.12, TH + 0.012), scale=(0.8, 1.2, 0.5)), 'PlasticBeige')
    m.add(S.tube(S.catmull([(0.3, dy0 + 0.16, TH + 0.01), (0.3, 0.35, TH + 0.005), (0.2, 0.6, TH + 0.005)], 3), 0.004, 3),
          'Black')
    # a little sheet ghost peeking over the monitor (it lives here)
    gx, gy, gz = 0.12, 0.5, mz + 0.38
    ghost = S.lathe([(0.0, 0.0), (0.09, 0.0), (0.085, 0.08), (0.07, 0.14), (0.04, 0.17), (0.0, 0.18)], 12)
    for v in ghost.verts:
        if v.co.z < 0.01:
            a = math.atan2(v.co.y, v.co.x)
            v.co.z -= 0.025 * (1 + math.sin(a * 6)) / 2
    m.add(S.translate(S.rotate(ghost, (0, 8, 0)), (gx, gy, gz)), 'GhostSheet')
    for sx in (-1, 1):
        m.add(S.sphere(0.014, 6, 4, loc=(gx + sx * 0.03 + 0.01, gy - 0.075, gz + 0.11), scale=(0.8, 0.4, 1.2)), 'Black')
    # round stool on the front tile, centred at local (0.5, 1.35) -> Blender (0, -0.35)
    sy = -0.35
    m.add(S.cushion(0.36, 0.36, 0.06, sag=0.006, roundness=0.45, loc=(0, sy, SH - 0.03)), 'CushionDark')
    m.add(S.cylinder(0.17, 0.03, 16, 0.008, base=(0, sy, SH - 0.08)))
    for k in range(3):
        a = math.tau * k / 3 + 0.5
        m.add(leg(math.cos(a) * 0.12, sy + math.sin(a) * 0.12, SH - 0.08, 0.035, 0.028,
                  (math.cos(a) * 0.05, math.sin(a) * 0.05)))
    m.add(S.torus(0.13, 0.01, 14, 4, loc=(0, sy, 0.16)), 'Chrome')
    add_broken(m, (0.0, my, mz + 0.5), 0.9)
