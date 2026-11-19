"""Stumps (shown when a limb is missing) and wooden prosthetics (shown when a limb is replaced)."""
from __future__ import annotations

import math

from mathutils import Vector

from .body import build_hand
from .bottoms import leg_chain_point
from .clothing import arm_chain_point
from .meshkit import Part, ellipsoid, mul_col, tube
from .skeleton import Skeleton
from .weights import rigid

V = Vector


def _stitched_tip_col(tip: Vector, axis: Vector, r: float):
    """Darken a stitched seam across the stump tip + raw pinkish rim."""
    def fn(q: Vector) -> tuple:
        d = q - tip
        along = d.dot(axis)
        c = (1.0, 1.0, 1.0)
        if along > -r * 0.55:
            c = (0.86, 0.72, 0.74)
            side = (d - axis * along)
            if abs(side.x) < r * 0.18 or abs(side.y) < r * 0.18:
                c = (0.32, 0.26, 0.3)
        return c
    return fn


def build_stump_arm(sk: Skeleton, side: str) -> Part:
    p = Part('Stump_Arm' + side)
    bone = 'upperarm_' + side
    a = sk.head[bone]
    d = sk.rest_dir[bone]
    tip = a + d * 0.105
    tube(p, [a - d * 0.01, a + d * 0.08], lambda u, th: 0.049 - 0.004 * u, 8, 'Skin', cap0='dome',
         cap1='dome', cap_depth0=0.04, cap_depth1=0.03, colfn=_stitched_tip_col(tip, d, 0.05), tag='stump',
         dome_steps=1)
    p.weight_fn = rigid(bone)
    return p


def build_stump_leg(sk: Skeleton, side: str) -> Part:
    p = Part('Stump_Leg' + side)
    bone = 'thigh_' + side
    a = sk.head[bone]
    d = sk.rest_dir[bone]
    tip = a + d * 0.16
    tube(p, [a - d * 0.02, a + d * 0.12], lambda u, th: 0.074 - 0.006 * u, 9, 'Skin', cap0='dome',
         cap1='dome', cap_depth0=0.05, cap_depth1=0.045, colfn=_stitched_tip_col(tip, d, 0.07), tag='stump',
         dome_steps=1)
    p.weight_fn = rigid(bone)
    return p


WOOD_DARK = (0.55, 0.5, 0.45)
BRASS = (0.62, 0.48, 0.25)
STRAP = (0.35, 0.24, 0.2)


def _wood_col(q: Vector) -> tuple:
    # subtle grain banding
    k = 0.9 + 0.1 * math.sin(q.z * 140.0 + q.x * 30.0)
    return (k, k, k)


def build_prosthetic_arm(sk: Skeleton, side: str) -> Part:
    p = Part('Prosthetic_Arm' + side)
    ua, fa, hd = 'upperarm_' + side, 'forearm_' + side, 'hand_' + side
    s0 = len(p.co)
    # socket cup + upper segment (6-sided, faceted)
    tube(p, [arm_chain_point(sk, side, 0.02), arm_chain_point(sk, side, 0.18)], lambda u, th: 0.052, 7, 'Prosthetic',
         cap0='dome', cap1='fan', cap_depth0=0.03, cap_depth1=0.0, colfn=lambda q: STRAP, tag='pU', dome_steps=1)
    tube(p, [arm_chain_point(sk, side, 0.15), arm_chain_point(sk, side, 0.92)], lambda u, th: 0.036 - 0.004 * u, 6,
         'Prosthetic', cap0='fan', cap1='fan', cap_depth0=0.0, cap_depth1=0.0, colfn=_wood_col, tag='pU')
    s1 = len(p.co)
    # elbow hinge (brass)
    ellipsoid(p, arm_chain_point(sk, side, 1.0), (0.032, 0.032, 0.032), 6, 4, 'Prosthetic', colfn=lambda q: BRASS,
              tag='pE')
    s2 = len(p.co)
    tube(p, [arm_chain_point(sk, side, 1.06), arm_chain_point(sk, side, 1.95)], lambda u, th: 0.031 - 0.006 * u, 6,
         'Prosthetic', cap0='fan', cap1='fan', cap_depth0=0.0, cap_depth1=0.0, colfn=_wood_col, tag='pF')
    s3 = len(p.co)
    # wooden mitten hand: rounded block + thumb peg
    o = sk.head[hd]
    a = sk.rest_dir[hd]
    tube(p, [o + a * 0.0, o + a * 0.05, o + a * 0.095], lambda u, t: 0.032 - 0.008 * u, 6, 'Prosthetic',
         squash=(0.62, 1.15), cap0='fan', cap1='dome', cap_depth0=0.0, cap_depth1=0.02, dome_steps=1,
         colfn=lambda q: mul_col(_wood_col(q), 0.95), tag='pH')
    sx = 1.0 if side == 'L' else -1.0
    th0 = o + a * 0.03 + V((0, -0.03, 0))
    tube(p, [th0, th0 + a * 0.03 + V((0, -0.018, 0))], 0.011, 4, 'Prosthetic', cap0='fan', cap1='dome',
         cap_depth0=0.0, cap_depth1=0.008, dome_steps=1, colfn=_wood_col, tag='pH')
    p.sharp_angle = 42.0

    def wfn(co, tag):
        if tag in ('pU',):
            return {ua: 1.0}
        if tag == 'pE':
            return {ua: 0.5, fa: 0.5}
        if tag == 'pF':
            return {fa: 1.0}
        return {hd: 1.0}
    p.weight_fn = wfn
    return p


def build_prosthetic_leg(sk: Skeleton, side: str) -> Part:
    p = Part('Prosthetic_Leg' + side)
    th, sh = 'thigh_' + side, 'shin_' + side
    tube(p, [leg_chain_point(sk, side, 0.0) + V((0, 0, 0.03)), leg_chain_point(sk, side, 0.35)],
         lambda u, t: 0.078 - 0.006 * u, 7, 'Prosthetic', cap0='dome', cap1='fan', cap_depth0=0.05, cap_depth1=0.0,
         colfn=lambda q: STRAP if q.z > 0.66 else _wood_col(q), tag='pT', dome_steps=1)
    tube(p, [leg_chain_point(sk, side, 0.3), leg_chain_point(sk, side, 0.93)], lambda u, t: 0.058 - 0.012 * u, 6,
         'Prosthetic', cap0='fan', cap1='fan', cap_depth0=0.0, cap_depth1=0.0, colfn=_wood_col, tag='pT')
    ellipsoid(p, leg_chain_point(sk, side, 1.0), (0.042, 0.042, 0.042), 6, 4, 'Prosthetic', colfn=lambda q: BRASS,
              tag='pK')
    ank = leg_chain_point(sk, side, 2.0)
    foot = V((ank.x, ank.y, 0.0))
    tube(p, [leg_chain_point(sk, side, 1.06), (leg_chain_point(sk, side, 1.06) + foot) * 0.5, foot + V((0, 0, 0.03))],
         lambda u, t: 0.036 - 0.014 * u, 6, 'Prosthetic', cap0='fan', cap1='fan', cap_depth0=0.0, cap_depth1=0.0,
         colfn=_wood_col, tag='pS')
    # rubber tip
    ellipsoid(p, foot + V((0, 0, 0.018)), (0.032, 0.032, 0.02), 6, 3, 'Prosthetic', colfn=lambda q: (0.18, 0.16, 0.16),
              tag='pS')
    p.sharp_angle = 42.0

    def wfn(co, tag):
        if tag == 'pT':
            return {th: 1.0}
        if tag == 'pK':
            return {th: 0.5, sh: 0.5}
        return {sh: 1.0}
    p.weight_fn = wfn
    return p


def build_limb_parts(sk: Skeleton) -> list[Part]:
    out = []
    for s in ('L', 'R'):
        out += [build_stump_arm(sk, s), build_stump_leg(sk, s), build_prosthetic_arm(sk, s), build_prosthetic_leg(sk, s)]
    return out
