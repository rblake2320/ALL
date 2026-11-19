"""Vehicle builders. Each takes (model, spec, lod): lod 0 = full detail, lod 1 = ambient-traffic detail.

LOD1 is authored, not decimated: fewer segments and no small trim, so both levels are deterministic and the
silhouette is kept. Everything is chunky and a little crooked (ART_DIRECTION): bumpers sag, one headlight is
bigger, the sedan has a door from another car.
"""
from __future__ import annotations

import math
from typing import Callable, Dict

import manifest_meta as meta
from common import shapes as S
from common.model import Model

from .specs import VehicleSpec

BuilderFn = Callable[[Model, VehicleSpec, int], None]
BUILDERS: Dict[str, BuilderFn] = {}


def builder(vid: str):
    def deco(fn: BuilderFn) -> BuilderFn:
        BUILDERS[vid] = fn
        return fn

    return deco


def xcyl(r: float, h: float, segs: int, bevel: float, centre, bsegs: int = 2):
    """Cylinder along X, centred on `centre`."""
    bm = S.cylinder(r, h, segs, bevel, base=(0, 0, -h / 2), bsegs=bsegs)
    S.rotate(bm, (0, 90, 0))
    return S.translate(bm, centre)


def car_wheel(m: Model, name: str, pos, r: float, w: float, lod: int, hub: str = 'Chrome', whitewall: bool = False) -> None:
    m.node(name, origin=pos, extras={'part': 'wheel', 'radius': round(r, 4)})
    out = 1.0 if pos[0] > 0 else -1.0
    m.add(xcyl(r, w, 16 if lod == 0 else 12, 0.05 if lod == 0 else 0.03, pos, 2 if lod == 0 else 1), 'Tire', name)
    if whitewall and lod == 0:
        m.add(xcyl(0.78 * r, 0.02, 16, 0.0, (pos[0] + out * (w / 2 + 0.002), pos[1], pos[2])), 'Whitewall', name)
    m.add(xcyl(0.52 * r, 0.03, 12 if lod == 0 else 8, 0.008 if lod == 0 else 0.0,
               (pos[0] + out * (w / 2 + 0.012), pos[1], pos[2])), hub, name)


def glow(m: Model, origin) -> None:
    m.node('glow', origin=origin, extras={'part': 'glow'}, transient=True)


# ---------------------------------------------------------------------------------------------------
# Bone-Shaker Bicycle
# ---------------------------------------------------------------------------------------------------

@builder('veh_bike')
def bike(m: Model, spec: VehicleSpec, lod: int) -> None:
    r = spec.wheel_radius
    yf, yr = -0.56, 0.54
    ts, rs = (16, 4) if lod == 0 else (12, 3)
    for name, y in (('wheel_F', yf), ('wheel_R', yr)):
        m.node(name, origin=(0, y, r), extras={'part': 'wheel', 'radius': r})
        m.add(S.torus(r - 0.024, 0.024, ts, rs, loc=(0, y, r), rot=(0, 90, 0)), 'Tire', name)
        m.add(xcyl(0.030, 0.09, 8 if lod == 0 else 6, 0.0, (0, y, r)), 'Chrome', name)
        if lod == 0:
            for k in range(6):                                   # spokes
                a = math.radians(30 * k + (7 if name == 'wheel_F' else 0))
                bm = S.box(0.006, 2 * (r - 0.04), 0.006, 0.0, 0)
                S.rotate(bm, (math.degrees(a), 0, 0))
                m.add(S.translate(bm, (0, y, r)), 'Steel', name)
    seg = 5 if lod == 0 else 3
    bb = (0, 0.02, 0.30)             # bottom bracket
    seat = (0, 0.22, 0.86)
    head = (0, -0.40, 0.88)
    # the top tube is one big cartoon bone
    if lod == 0:
        bone = S.bone(0.50, 0.022, 1.9, segs=6)
        S.rotate(bone, (0, 0, 90))
        S.rotate(bone, (2, 0, 0))
        m.add(S.translate(bone, (0, -0.09, 0.855)), 'Bone')
    else:
        m.add(S.tube([(0, 0.20, 0.85), (0, -0.38, 0.86)], 0.024, seg), 'Bone')
    for a, b, rad in ((bb, head, 0.021), (bb, seat, 0.021), (bb, (0, yr, r), 0.014), (seat, (0, yr, r), 0.013)):
        m.add(S.tube([a, b], rad, seg), 'Paint')
    m.add(S.tube([(0, -0.38, 0.98), head, (0, -0.47, 0.60), (0, yf, r)], 0.017, seg), 'Paint')          # steerer + fork
    bar_end = (0.26, -0.33, 1.02)
    m.add(S.tube([(-bar_end[0], bar_end[1], bar_end[2]), (-0.12, -0.39, 1.00), (0.12, -0.39, 1.00), bar_end], 0.014, seg), 'Chrome')
    meta.add_frame('hand_L', bar_end, 0.0, 'hands')
    meta.add_frame('hand_R', (-bar_end[0], bar_end[1], bar_end[2]), 0.0, 'hands')
    for sx in (-1, 1):
        m.add(S.tube([(sx * 0.20, -0.345, 1.012), (sx * 0.29, -0.32, 1.024)], 0.019, seg), 'Rubber')
    m.add(S.tube([seat, (0, 0.24, 0.96)], 0.014, seg), 'Chrome')
    saddle, saddle_h = (0, 0.26, 0.985), 0.030
    m.add(S.superellipsoid(0.085, 0.14, saddle_h, 0.6, 0.6, 8 if lod == 0 else 6, 4 if lod == 0 else 3, loc=saddle, rot=(-4, 0, 0)), 'Leather')
    meta.add_frame('seat_0', (saddle[0], saddle[1], saddle[2] + saddle_h), 0.0, 'seat')                 # on top of the saddle
    # cranks, pedals, chain ring
    m.add(xcyl(0.075, 0.012, 10 if lod == 0 else 6, 0.0, (0.045, bb[1], bb[2])), 'Steel')
    for sx, dz in ((1, -0.13), (-1, 0.13)):
        if lod == 0:
            m.add(S.tube([(sx * 0.05, bb[1], bb[2]), (sx * 0.075, bb[1] + 0.03, bb[2] + dz)], 0.009, 4), 'Steel')
        pedal = (sx * 0.115, bb[1] + 0.03, bb[2] + dz)
        m.add(S.box(0.08, 0.05, 0.016, 0.0, 0, loc=pedal), 'Rubber')
        meta.add_frame('foot_L' if sx > 0 else 'foot_R', pedal, 0.0, 'feet')
    # fenders (the rear one is bent) and a candle lantern for a headlight
    for y, a0, a1, tilt in ((yf, 20, 150, 0), (yr, 35, 170, 5)):
        pts = S.arc_points(r + 0.035, math.radians(a0), math.radians(a1), 6 if lod == 0 else 3)
        m.add(S.tube([(tilt * 0.002 * i, y - p[0], r + p[1]) for i, p in enumerate(pts)], 0.012, 4 if lod == 0 else 3,
                     scale_xy=(2.6, 0.5)), 'Paint')
    meta.add_frame('approach', (bar_end[0] + 0.39, 0.10, 0.0), -90.0, 'approach')                       # beside the frame, on the left
    glow(m, (0, -0.50, 0.80))
    m.add(S.box(0.07, 0.07, 0.09, 0.012 if lod == 0 else 0.0, 1 if lod == 0 else 0, loc=(0, -0.50, 0.80)), 'Lantern', 'glow')
    if lod == 0:
        m.add(S.box(0.085, 0.085, 0.014, 0.0, 0, loc=(0, -0.50, 0.852)), 'Iron')
        m.add(S.tube([(0, -0.44, 0.93), (0, -0.50, 0.87)], 0.006, 4), 'Iron')
    m.add(S.box(0.04, 0.012, 0.03, 0.0, 0, loc=(0, yr + r + 0.035, r + 0.13)), 'TailLight', 'glow')
    if lod == 0:
        m.add(S.sphere(0.028, 8, 5, loc=(0.16, -0.36, 1.045)), 'Brass')                                 # bell
        # a wire basket with a small skull riding in it
        for z in (0.70, 0.80):
            m.add(S.tube([(-0.13, -0.56, z), (0.13, -0.56, z), (0.13, -0.74, z), (-0.13, -0.74, z)], 0.006, 4, closed=True), 'Iron')
        m.add(S.box(0.26, 0.18, 0.008, 0.0, 0, loc=(0, -0.65, 0.70)), 'Iron')
        sk, so = S.skull(0.045, loc=(0, -0.65, 0.755), segs=6)
        m.add(sk, 'Bone')
        m.add(so, 'Black')
        m.add(S.tube([(0.03, 0.10, 0.30), (0.10, 0.20, 0.02)], 0.008, 4), 'Steel')                      # kickstand


# ---------------------------------------------------------------------------------------------------
# Rattletrap Moped
# ---------------------------------------------------------------------------------------------------

@builder('veh_moped')
def moped(m: Model, spec: VehicleSpec, lod: int) -> None:
    r = spec.wheel_radius
    yf, yr = -0.60, 0.56
    seg = 8 if lod == 0 else 5
    for name, y in (('wheel_F', yf), ('wheel_R', yr)):
        m.node(name, origin=(0, y, r), extras={'part': 'wheel', 'radius': r})
        m.add(xcyl(r, 0.11, 16 if lod == 0 else 12, 0.045 if lod == 0 else 0.03, (0, y, r), 2 if lod == 0 else 1), 'Tire', name)
        for sx in (-1, 1):
            m.add(xcyl(0.11, 0.012, 10 if lod == 0 else 8, 0.0, (sx * 0.060, y, r)), 'Chrome', name)
    board, board_h = (0, -0.02, 0.19), 0.06
    m.add(S.box(0.34, 0.56, board_h, 0.025, 2 if lod == 0 else 1, base=board), 'Paint')                  # floorboard
    for sx in (-1, 1):
        meta.add_frame('foot_L' if sx > 0 else 'foot_R', (sx * 0.10, board[1], board[2] + board_h), 0.0, 'feet')
    shield = S.taper_box(0.36, 0.09, 0.30, 0.07, 0.62, 0.03, 2 if lod == 0 else 1, base=(0, 0, 0))
    S.rotate(shield, (12, 0, 0))
    m.add(S.translate(shield, (0, -0.36, 0.20)), 'Paint')
    m.add(S.superellipsoid(0.20, 0.42, 0.19, 0.5, 0.5, 14 if lod == 0 else 8, 8 if lod == 0 else 5, loc=(0, 0.40, 0.43)), 'Paint')
    saddle, saddle_h = (0, 0.34, 0.655), 0.055
    m.add(S.superellipsoid(0.16, 0.33, saddle_h, 0.5, 0.6, 12 if lod == 0 else 8, 5 if lod == 0 else 4, loc=saddle, rot=(-3, 0, 0)), 'Leather')
    meta.add_frame('seat_0', (saddle[0], saddle[1], saddle[2] + saddle_h), 0.0, 'seat')
    # steering: column, fork legs, bars, grips, cowl with one headlight
    m.add(S.tube([(0, -0.50, 0.42), (0, -0.44, 0.98)], 0.022, seg), 'Steel')
    for sx in (-1, 1):
        m.add(S.tube([(sx * 0.075, yf, r), (sx * 0.075, -0.52, 0.46), (0, -0.50, 0.50)], 0.016, 5 if lod == 0 else 4), 'Steel')
    m.add(S.tube([(-0.31, -0.39, 1.02), (-0.14, -0.44, 0.99), (0.14, -0.44, 0.99), (0.31, -0.39, 1.02)], 0.015, seg), 'Chrome')
    for sx in (-1, 1):
        grip = ((sx * 0.24, -0.405, 1.012), (sx * 0.34, -0.375, 1.026))
        m.add(S.tube(list(grip), 0.021, seg), 'Rubber')
        meta.add_frame('hand_L' if sx > 0 else 'hand_R', tuple((a + b) / 2 for a, b in zip(*grip)), 0.0, 'hands')   # middle of the grip
    meta.add_frame('approach', (0.70, 0.10, 0.0), -90.0, 'approach')
    m.add(S.superellipsoid(0.13, 0.10, 0.10, 0.6, 0.6, 12 if lod == 0 else 8, 6 if lod == 0 else 4, loc=(0, -0.46, 0.90)), 'Paint')
    glow(m, (0, -0.56, 0.90))
    m.add(S.sphere(0.075, 12 if lod == 0 else 8, 8 if lod == 0 else 5, loc=(0, -0.535, 0.90), scale=(1, 0.5, 1)), 'Lantern', 'glow')
    m.add(S.box(0.09, 0.02, 0.05, 0.008, 1, loc=(0, 0.83, 0.47)), 'TailLight', 'glow')
    # fenders
    m.add(S.box(0.15, 0.36, 0.05, 0.02, 1, loc=(0, yf, 2 * r + 0.03), rot=(6, 0, 0)), 'Paint')
    # rear rack with a crate, engine block, exhaust
    m.add(S.box(0.30, 0.26, 0.19, 0.012, 1, base=(0, 0.76, 0.64)), 'WoodLight')
    m.add(S.box(0.22, 0.24, 0.16, 0.02, 1, base=(0, 0.20, 0.23)), 'Steel')
    m.add(S.tube([(0.16, 0.18, 0.27), (0.19, 0.50, 0.25), (0.19, 0.84, 0.31)], 0.026, seg,
                 radii=[0.018, 0.026, 0.034]), 'Rust')
    for sx in (-1, 1):                                              # mirrors on stalks, one drooping (both LODs)
        top = (sx * 0.27, -0.42, 1.20 if sx > 0 else 1.14)
        m.add(S.tube([(sx * 0.20, -0.41, 1.00), top], 0.007, 4 if lod == 0 else 3), 'Chrome')
        m.add(S.cylinder(0.05, 0.012, 10 if lod == 0 else 6, 0.003 if lod == 0 else 0.0,
                         base=(top[0], top[1] - 0.006, top[2]), rot=(90, 0, 12 * sx)), 'Chrome')
    if lod == 0:
        for z in (0.70, 0.78):
            m.add(S.box(0.31, 0.27, 0.012, 0.0, 0, loc=(0, 0.76, z)), 'WoodDark')
        m.add(S.tube([(-0.13, 0.62, 0.62), (-0.13, 0.90, 0.62), (0.13, 0.90, 0.62), (0.13, 0.62, 0.62)], 0.009, 4), 'Iron')
        m.add(S.tube([(-0.06, 0.10, 0.20), (-0.17, 0.16, 0.02)], 0.010, 4), 'Steel')                     # kickstand
        m.add(S.box(0.16, 0.012, 0.09, 0.004, 1, loc=(0, 0.845, 0.36)), 'Bone')                          # plate
        m.add(S.box(0.07, 0.07, 0.012, 0.0, 0, loc=(0.205, 0.30, 0.47), rot=(0, 0, 20)), 'Rust')         # rust patch
        m.add(S.sphere(0.03, 8, 5, loc=(0.20, -0.40, 1.05)), 'Brass')                                    # horn bulb


# ---------------------------------------------------------------------------------------------------
# Cars
# ---------------------------------------------------------------------------------------------------

def _car_lights(m: Model, W: float, yf: float, yb: float, z: float, lod: int, big_left: bool) -> None:
    glow(m, (0, yf, z))
    for sx in (-1, 1):
        rad = 0.105 if (sx > 0 and big_left) else 0.085
        m.add(S.sphere(rad, 12 if lod == 0 else 8, 8 if lod == 0 else 5, loc=(sx * (W / 2 - 0.26), yf + 0.02, z),
                       scale=(1, 0.45, 1)), 'Lantern', 'glow')
        m.add(S.box(0.20, 0.05, 0.12, 0.015, 1, loc=(sx * (W / 2 - 0.22), yb - 0.02, z - 0.04)), 'TailLight', 'glow')


def _cabin_frames(W: float, yb: float, door: tuple, rows: tuple, seat_z: float) -> None:
    """Seat frames in rows across the cabin (driver on the left, numbered front to back), the approach point
    outside the middle of the driver's door, and the trunk point behind the rear bumper."""
    x = round(W / 2 - 0.48, 3)                                    # seat centre: inside the door, clear of the glass
    for i, y in enumerate(rows):
        meta.add_frame(f'seat_{2 * i}', (x, y, seat_z), 0.0, 'seat')
        meta.add_frame(f'seat_{2 * i + 1}', (-x, y, seat_z), 0.0, 'seat')
    meta.add_frame('approach', (W / 2 + 0.59, round((door[0] + door[1]) / 2, 1), 0.0), -90.0, 'approach')
    meta.add_frame('trunk', (0.0, yb + 0.65, 0.0), 0.0, 'approach')


def _door(m: Model, x: float, y0: float, y1: float, z0: float, z1: float, lod: int, look: str) -> None:
    """Front-left door: origin on the hinge line (front edge), panel slightly proud of the body."""
    m.node('door', origin=(x, y0, z0), extras={'part': 'door'})
    m.add(S.box(0.045, y1 - y0, z1 - z0, 0.018, 2 if lod == 0 else 1, loc=(x + 0.012, (y0 + y1) / 2, (z0 + z1) / 2)), look, 'door')
    m.add(S.box(0.02, 0.12, 0.028, 0.006, 1, loc=(x + 0.045, y1 - 0.14, z1 - 0.10)), 'Chrome', 'door')


@builder('veh_sedan')
def sedan(m: Model, spec: VehicleSpec, lod: int) -> None:
    W, L = 1.72, 4.20
    r = spec.wheel_radius
    yf, yb = -L / 2, L / 2
    b2 = 2 if lod == 0 else 1
    m.add(S.box(W, L - 0.12, 0.50, 0.12, b2, base=(0, 0, 0.27)), 'Paint')                               # lower body
    m.add(S.box(W - 0.10, 1.20, 0.13, 0.07, b2, base=(0, yf + 0.68, 0.76)), 'Paint')                    # hood
    m.add(S.box(W - 0.10, 0.92, 0.13, 0.07, b2, base=(0, yb - 0.54, 0.76)), 'Paint')                    # boot
    m.add(S.taper_box(W - 0.06, 2.10, W - 0.38, 1.46, 0.56, 0.07, b2, base=(0, 0.12, 0.78), shift=(0, 0.05)), 'Paint')
    for sx in (-1, 1):                                                                                   # side glass
        for y0, y1 in ((-0.62, 0.10), (0.20, 0.86)):
            g = S.box(0.03, y1 - y0, 0.34, 0.01, 1, loc=(0, 0, 0))
            S.rotate(g, (0, sx * 16, 0))
            m.add(S.translate(g, (sx * (W / 2 - 0.115), (y0 + y1) / 2 + 0.12, 1.07)), 'WindowDark')
    for y, tilt in ((-0.86, -38), (1.12, 34)):                                                           # front + rear glass
        g = S.box(W - 0.46, 0.03, 0.50, 0.01, 1, loc=(0, 0, 0))
        S.rotate(g, (tilt, 0, 0))
        m.add(S.translate(g, (0, y + 0.12, 1.05)), 'WindowDark')
    fb = S.box(W + 0.08, 0.16, 0.13, 0.05, b2, loc=(0, 0, 0))                                            # sagging front bumper
    S.rotate(fb, (0, 3.5, 0))
    m.add(S.translate(fb, (0, yf + 0.03, 0.36)), 'Chrome')
    m.add(S.box(W + 0.08, 0.16, 0.13, 0.05, b2, loc=(0, yb - 0.03, 0.37)), 'Chrome')
    m.add(S.box(0.92, 0.05, 0.20, 0.02, 1, loc=(0, yf + 0.045, 0.60)), 'Black')                          # grille
    _car_lights(m, W, yf + 0.05, yb - 0.02, 0.64, lod, big_left=True)
    for name, x, y in (('wheel_FL', 1, yf + 0.80), ('wheel_FR', -1, yf + 0.80), ('wheel_RL', 1, yb - 0.82), ('wheel_RR', -1, yb - 0.82)):
        car_wheel(m, name, (x * (W / 2 - 0.10), y, r), r, 0.22, lod, hub='Rust' if name == 'wheel_FR' else 'Chrome')
        m.add(S.box(0.30, 0.86, 0.10, 0.04, 1, loc=(x * (W / 2 - 0.10), y, 2 * r + 0.07)), 'Paint')      # wheel arch
    _door(m, W / 2, -0.66, 0.24, 0.36, 0.86, lod, 'Rust')                                               # a door from another car
    _cabin_frames(W, yb, (-0.66, 0.24), (-0.20, 0.62), 0.62)
    for sx in (-1, 1):                                                                                   # mirrors
        m.add(S.box(0.10, 0.07, 0.07, 0.02 if lod == 0 else 0.0, 1 if lod == 0 else 0, loc=(sx * (W / 2 + 0.06), -0.70, 0.93)), 'Paint')
    # a strapped-down suitcase on the roof (both LODs: it is part of the silhouette)
    m.add(S.box(0.62, 0.44, 0.18, 0.03, b2, base=(0.05, 0.27, 1.43), rot=(0, 0, 6)), 'Leather')
    if lod == 0:
        for k in range(5):
            m.add(S.box(0.90, 0.055, 0.012, 0.0, 0, loc=(0, yf + 0.04, 0.53 + 0.035 * k)), 'Chrome')
        for sx in (-1, 1):
            m.add(S.box(0.02, L - 0.9, 0.035, 0.006, 1, loc=(sx * (W / 2 + 0.004), 0, 0.60)), 'Chrome')  # side trim
        m.add(S.box(0.34, 0.012, 0.11, 0.004, 1, loc=(0, yb + 0.055, 0.46)), 'Bone')                     # plate
        m.add(S.tube([(-0.55, yb - 0.10, 0.26), (-0.55, yb + 0.10, 0.24)], 0.035, 8), 'Rust')            # exhaust
        m.add(S.tube([(0.55, 0.95, 1.33), (0.57, 1.02, 1.48), (0.62, 1.00, 1.60)], 0.007, 4), 'Steel')   # bent aerial
        for (x, y, z, sx_, sy_, rot) in ((0.30, yf + 0.55, 0.892, 0.34, 0.26, 20), (-0.50, yb - 0.50, 0.892, 0.26, 0.20, -15)):
            m.add(S.box(sx_, sy_, 0.008, 0.0, 0, loc=(x, y, z), rot=(0, 0, rot)), 'Rust')                # rust patches
        m.add(S.box(0.022, 0.50, 0.20, 0.0, 0, loc=(-(W / 2 + 0.002), yb - 0.95, 0.52)), 'Rust')
        # roof rack bars and the suitcase strap
        for y in (-0.25, 0.55):
            m.add(S.tube([(-0.60, y + 0.12, 1.36), (-0.60, y + 0.12, 1.42), (0.60, y + 0.12, 1.42), (0.60, y + 0.12, 1.36)], 0.012, 4), 'Iron')
        m.add(S.box(0.64, 0.05, 0.19, 0.0, 0, base=(0.05, 0.27, 1.43), rot=(0, 0, 6)), 'Brass')


@builder('veh_hearse')
def hearse(m: Model, spec: VehicleSpec, lod: int) -> None:
    W, L = 1.78, 4.70
    r = spec.wheel_radius
    yf, yb = -L / 2, L / 2
    b2 = 2 if lod == 0 else 1
    m.add(S.box(W, L - 0.14, 0.58, 0.14, b2, base=(0, 0, 0.30)), 'Paint')
    m.add(S.box(W - 0.08, 1.36, 0.17, 0.09, b2, base=(0, yf + 0.78, 0.86)), 'Paint')                    # long hood
    m.add(S.taper_box(W - 0.06, 3.30, W - 0.30, 2.96, 0.64, 0.09, b2, base=(0, 0.72, 0.88), shift=(0, 0.10)), 'Paint')
    ws = S.box(W - 0.40, 0.035, 0.56, 0.01, 1, loc=(0, 0, 0))
    S.rotate(ws, (-32, 0, 0))
    m.add(S.translate(ws, (0, -0.86, 1.19)), 'WindowDark')
    for sx in (-1, 1):
        x = sx * (W / 2 - 0.085)
        for i, (y0, y1) in enumerate(((-0.72, -0.08), (0.04, 1.10), (1.22, 2.18))):
            m.add(S.box(0.035, y1 - y0, 0.40, 0.01, 1, loc=(x, (y0 + y1) / 2, 1.22), rot=(0, sx * 9, 0)), 'WindowDark')
            if i > 0:                                                                                    # gathered curtains
                for ya, yb_ in ((y0 + 0.03, (y0 + y1) / 2 - 0.03), ((y0 + y1) / 2 + 0.03, y1 - 0.03)):
                    m.add(S.box(0.02, yb_ - ya, 0.36, 0.006, 1, loc=(x + sx * 0.022, (ya + yb_) / 2, 1.22), rot=(0, sx * 9, 0)), 'HearseCurtain')
        m.add(S.box(0.02, L - 0.5, 0.045, 0.006, 1, loc=(sx * (W / 2 + 0.004), 0, 0.90)), 'Chrome')      # beltline
        if lod == 0:
            bar = S.catmull([(x + sx * 0.075, 1.30, 1.10), (x + sx * 0.075, 1.56, 1.36), (x + sx * 0.075, 1.84, 1.22),
                             (x + sx * 0.075, 2.12, 1.38)], 3)
            m.add(S.tube(bar, 0.022, 5), 'Chrome')                                                        # landau bar
            m.add(S.box(0.02, L - 1.0, 0.05, 0.006, 1, loc=(sx * (W / 2 + 0.004), 0, 0.38)), 'Chrome')
    rear = S.box(W - 0.44, 0.035, 0.44, 0.01, 1, loc=(0, 0, 0))
    S.rotate(rear, (14, 0, 0))
    m.add(S.translate(rear, (0, yb - 0.10, 1.22)), 'WindowDark')
    fb = S.box(W + 0.08, 0.17, 0.14, 0.05, b2, loc=(0, 0, 0))
    S.rotate(fb, (0, -2.5, 0))
    m.add(S.translate(fb, (0, yf + 0.03, 0.38)), 'Chrome')
    m.add(S.box(W + 0.08, 0.17, 0.14, 0.05, b2, loc=(0, yb - 0.03, 0.39)), 'Chrome')
    m.add(S.box(1.00, 0.06, 0.36, 0.02, 1, loc=(0, yf + 0.05, 0.66)), 'Chrome')                          # grille
    _car_lights(m, W, yf + 0.05, yb - 0.02, 0.80, lod, big_left=False)
    for name, x, y in (('wheel_FL', 1, yf + 0.92), ('wheel_FR', -1, yf + 0.92), ('wheel_RL', 1, yb - 0.98), ('wheel_RR', -1, yb - 0.98)):
        car_wheel(m, name, (x * (W / 2 - 0.10), y, r), r, 0.24, lod, whitewall=True)
        m.add(S.box(0.30, 0.94, 0.11, 0.04, 1, loc=(x * (W / 2 - 0.10), y, 2 * r + 0.08)), 'Paint')
    _door(m, W / 2, -0.74, 0.12, 0.40, 0.94, lod, 'Paint')
    _cabin_frames(W, yb, (-0.74, 0.12), (-0.25, 0.55, 1.35), 0.68)
    for sx in (-1, 1):                                                                                   # mirrors
        m.add(S.box(0.08, 0.07, 0.07, 0.02 if lod == 0 else 0.0, 1 if lod == 0 else 0, loc=(sx * (W / 2 + 0.045), -0.78, 1.02)), 'Paint')
    if lod == 0:
        for k in range(6):
            m.add(S.box(0.94, 0.07, 0.016, 0.0, 0, loc=(0, yf + 0.045, 0.53 + 0.045 * k)), 'Black')
        m.add(S.torus(0.20, 0.055, 14, 5, loc=(0, yf - 0.01, 0.80), rot=(90, 0, 0)), 'Hedge')            # wreath
        for k in range(5):
            a = math.tau * k / 5
            m.add(S.sphere(0.042, 6, 4, loc=(math.cos(a) * 0.20, yf - 0.05, 0.80 + math.sin(a) * 0.20)), 'BloodWine')
        m.add(S.box(0.56, 1.64, 0.30, 0.05, 1, base=(0, 1.36, 0.93)), 'WoodEbony')                       # the coffin in the back
        for sx in (-1, 1):                                                                               # roof lanterns
            m.add(S.box(0.06, 0.06, 0.10, 0.012, 1, base=(sx * 0.62, -0.62, 1.50)), 'Lantern', 'glow')
            m.add(S.box(0.08, 0.08, 0.014, 0.004, 1, base=(sx * 0.62, -0.62, 1.60)), 'Brass')
        m.add(S.box(0.34, 0.012, 0.11, 0.004, 1, loc=(0, yb + 0.06, 0.50)), 'Bone')
        m.add(S.tube([(-0.60, yb - 0.10, 0.28), (-0.60, yb + 0.10, 0.26)], 0.035, 8), 'Chrome')
