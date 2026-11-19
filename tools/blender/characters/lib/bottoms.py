"""Bottoms (Bottom_<style>_Waist / _LegL / _LegR) and shoes (Shoe_L / Shoe_R)."""
from __future__ import annotations

import math

from mathutils import Vector

from .clothing import BodySpec, TWO_PI, garment_body, garment_point, skirt_weights, stdcol, _frayed
from .meshkit import Part, add_ring, grid, loft, mul_col, superellipse, tube
from .noise import rng, smoothstep
from .skeleton import Skeleton
from .weights import torso_weights

V = Vector


def waist_weights(co: Vector, tag: str) -> dict:
    w = torso_weights(co, tag)
    t = smoothstep(0.74, 0.64, co.z) * smoothstep(0.02, 0.09, abs(co.x)) * 0.55
    if t > 0:
        w = {k: v * (1 - t) for k, v in w.items()}
        side = 'thigh_L' if co.x > 0 else 'thigh_R'
        w[side] = w.get(side, 0.0) + t
    return w


def leg_chain_point(sk: Skeleton, side: str, u: float) -> Vector:
    th, sh = 'thigh_' + side, 'shin_' + side
    if u <= 1.0:
        return sk.head[th] + (sk.tail[th] - sk.head[th]) * u
    return sk.head[sh] + (sk.tail[sh] - sk.head[sh]) * min(1.0, u - 1.0)


def leg_radius(u: float) -> float:
    if u <= 1.0:
        return 0.074 - 0.018 * u + 0.004 * math.sin(u * math.pi)
    v = u - 1.0
    return 0.054 - 0.016 * v + 0.008 * math.exp(-((v - 0.3) / 0.2) ** 2)


def leg_weights(sk: Skeleton, side: str, pelvis_blend: bool = True):
    th, sh = 'thigh_' + side, 'shin_' + side
    knee = sk.head[sh]
    axis = sk.rest_dir[th]

    def fn(co: Vector, tag: str) -> dict:
        t = smoothstep(-0.04, 0.04, (co - knee).dot(axis))
        w = {th: 1.0 - t, sh: t}
        if pelvis_blend:
            pb = smoothstep(0.66, 0.80, co.z) * 0.6
            if pb > 0:
                w = {k: v * (1 - pb) for k, v in w.items()}
                w['pelvis'] = pb
        return w
    return fn


def trouser_leg(sk: Skeleton, side: str, name: str, u1: float, off: float, cuff: float = 0.0, ragged: float = 0.0,
                colfn=None, seed: int = 1, segs: int = 9, start_up: float = 0.06) -> Part:
    p = Part(name)
    us = [-start_up / 0.33, 0.0, 0.45, 0.92, 1.08]
    k = 1.45
    while k < u1 - 0.12:
        us.append(k)
        k += 0.4
    us = [u for u in us if u < u1 - 0.04] + [u1]
    path = []
    for u in us:
        if u < 0:
            path.append(leg_chain_point(sk, side, 0.0) + V((0, 0, start_up)))
        else:
            path.append(leg_chain_point(sk, side, u))

    def rad(t, th):
        u = us[0] + (u1 - us[0]) * t
        r = leg_radius(max(0.0, min(2.0, u))) + off
        r += cuff * smoothstep(u1 - 0.25, u1, u)
        if u < 0.05:
            r += 0.006
        return r

    rows = tube(p, path, rad, segs, 'Bottom', up=V((0, -1, 0)), cap0='dome', cap1=None, cap_depth0=0.05,
                colfn=colfn, tag='leg')
    end = rows[-1]
    axis = (path[-1] - path[-2]).normalized()
    if ragged:
        r = rng(seed)
        for vi in end:
            if r.random() < 0.6:
                p.co[vi] = p.co[vi] + axis * r.uniform(-ragged, ragged * 0.5)
    lip = []
    for vi in end:
        q = p.co[vi]
        c = path[-1]
        radial = (q - c) - axis * (q - c).dot(axis)
        lip.append(q - radial.normalized() * (off + 0.006) - axis * 0.012)
    lip_ids = add_ring(p, lip, col=(0.5, 0.5, 0.5), tag='leg')
    grid(p, [end, lip_ids], 'Bottom')
    p.weight_fn = leg_weights(sk, side)
    return p


def _waist_piece(name: str, z_top: float, z_bot: float, off_fn, colfn, cols: int = 12) -> Part:
    p = Part(name)
    spec = BodySpec(lambda th: z_bot, lambda th: z_top, off_fn, cols=cols, rows=4, colfn=colfn, collar=0.004,
                    neck_inner=0.006, hem_lip=0.006)
    garment_body(p, spec, mat='Bottom', tag='waist')
    p.weight_fn = waist_weights
    return p


def _belt_col(q, ri, n, belt=True):
    c = stdcol(q, ri, n, 0.0, (), dirt=0.2, seed=4)
    if belt and q.z > 0.865:
        c = mul_col(c, 0.42)
        if abs(q.x) < 0.022 and q.y < 0:
            c = (0.75, 0.62, 0.3)  # buckle-ish
    return c


def bottom_pants(sk):
    waist = _waist_piece('Bottom_pants_Waist', 0.905, 0.635,
                         lambda th, z: 0.010 + 0.003 * smoothstep(0.86, 0.9, z), lambda q, ri, n: _belt_col(q, ri, n))

    def legcol_l(q):
        # knee patch on the left leg
        k = sk.head['shin_L']
        if (q - k).length < 0.06 and q.y < k.y:
            return (0.7, 0.62, 0.52)
        return (0.95, 0.95, 0.95)

    legs = {
        'L': trouser_leg(sk, 'L', 'Bottom_pants_LegL', 1.96, 0.014, cuff=0.012, colfn=legcol_l),
        'R': trouser_leg(sk, 'R', 'Bottom_pants_LegR', 1.93, 0.014, cuff=0.014, ragged=0.03, seed=7,
                         colfn=lambda q: (0.9, 0.9, 0.9)),
    }
    return waist, legs


def bottom_shorts(sk):
    waist = _waist_piece('Bottom_shorts_Waist', 0.9, 0.635, lambda th, z: 0.012,
                         lambda q, ri, n: _belt_col(q, ri, n, belt=False))
    legs = {s: trouser_leg(sk, s, 'Bottom_shorts_Leg' + s, 0.80, 0.02, cuff=0.01,
                           colfn=lambda q: (0.95, 0.95, 0.95)) for s in ('L', 'R')}
    return waist, legs


def bottom_skirt(sk):
    fr = _frayed(21, 0.01, 14)

    def off(th, z):
        return 0.012 + max(0.0, 0.82 - z) * 0.30

    def col(q, ri, n):
        c = stdcol(q, ri, n, 0.15, (), dirt=0.2, seed=6)
        if q.z > 0.86:
            c = mul_col(c, 0.7)
        return c

    p = Part('Bottom_skirt_Waist')
    spec = BodySpec(lambda th: 0.46 + fr(th), lambda th: 0.90, off, cols=14, rows=5, colfn=col, collar=0.004,
                    neck_inner=0.006, hem_lip=0.01)
    garment_body(p, spec, mat='Bottom', tag='waist')
    p.weight_fn = skirt_weights(top=0.80, bottom=0.52)
    # tights (darker) on each leg
    legs = {s: trouser_leg(sk, s, 'Bottom_skirt_Leg' + s, 1.97, 0.004, colfn=lambda q: (0.5, 0.48, 0.5), segs=7,
                           start_up=0.04) for s in ('L', 'R')}
    return p, legs


BOTTOM_BUILDERS = {'pants': bottom_pants, 'shorts': bottom_shorts, 'skirt': bottom_skirt}
# Skin parts hidden under each bottom (legs): thigh / shin
BOTTOM_COVERS = {
    'pants': {'legUpper': True, 'legLower': True},
    'shorts': {'legUpper': False, 'legLower': False},
    'skirt': {'legUpper': True, 'legLower': True},
}


def build_bottom(sk: Skeleton, style: str) -> list[Part]:
    waist, legs = BOTTOM_BUILDERS[style](sk)
    return [waist, legs['L'], legs['R']]


# ------------------------------------------------------------------------------------------------ shoes

def build_shoe(sk: Skeleton, side: str) -> Part:
    p = Part('Shoe_' + side)
    ank = sk.head['foot_' + side]
    sx = 1.0 if side == 'L' else -1.0
    x0 = ank.x + 0.004 * sx
    # (y, half width, top z, bottom z, toe lift)
    secs = [(ank.y + 0.072, 0.040, 0.098, 0.0, 0.0), (ank.y + 0.05, 0.050, 0.112, 0.0, 0.0),
            (ank.y + 0.0, 0.056, 0.118, 0.0, 0.0), (ank.y - 0.06, 0.060, 0.090, 0.0, 0.0),
            (ank.y - 0.12, 0.060, 0.074, 0.0, 0.004), (ank.y - 0.165, 0.050, 0.066, 0.0, 0.012)]
    rings = []
    segs = 9
    for (y, hw, top, bot, lift) in secs:
        hh = (top - bot) / 2
        zc = bot + hh + lift
        ring = []
        for j in range(segs):
            th = TWO_PI * j / segs
            x, z = superellipse(th, hw, hh, 3.2)
            z = max(z, -hh + 0.0)  # flat-ish sole
            ring.append(V((x0 + x, y, zc + z)))
        rings.append(ring)
    # rings advance toward -Y and (x, z) parametrisation is CCW about X x Z = -Y, so quads face outward

    def col(q):
        if q.z < 0.018:
            return (0.38, 0.33, 0.3)  # sole
        # laces: stripes across the instep top
        if abs(q.x - x0) < 0.022 and q.z > 0.075 and ank.y - 0.08 < q.y < ank.y + 0.01:
            return (0.6, 0.6, 0.6) if int((q.y - ank.y) * 70) % 2 == 0 else (1.0, 1.0, 1.0)
        return (1.0, 1.0, 1.0)

    loft(p, rings, 'Shoes', cap0='dome', cap1='dome', cap_depth0=0.02, cap_depth1=0.035, colfn=col, dome_steps=1,
         tag='shoe')
    p.weight_fn = lambda co, tag: {'foot_' + side: 1.0}
    p.no_build = True
    return p
