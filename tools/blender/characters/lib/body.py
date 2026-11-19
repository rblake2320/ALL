"""Body parts (rest pose, armature space): Torso, arms, hands, legs, feet.

`torso_point(theta, z)` is the analytic torso surface reused by every top/bottom garment so clothing hugs the
body exactly with a controllable offset. theta = 0 points to the character's left (+X), pi/2 to the back (+Y),
-pi/2 (or 3pi/2) to the front (-Y).
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

from .meshkit import Part, add_ring, fan, grid, loft, mul_col, superellipse, tube
from .noise import smoothstep
from .skeleton import Skeleton
from .weights import chain, rigid, torso_weights

V = Vector

# z, half-width a, half-depth b, superellipse n, centre y
TORSO_SECTIONS = [
    (0.632, 0.118, 0.084, 2.3, 0.006),
    (0.665, 0.150, 0.104, 2.5, 0.006),
    (0.720, 0.164, 0.112, 2.6, 0.010),
    (0.785, 0.158, 0.108, 2.6, 0.005),
    (0.860, 0.149, 0.104, 2.5, 0.000),
    (0.940, 0.153, 0.110, 2.4, -0.005),
    (1.020, 0.163, 0.110, 2.5, -0.002),
    (1.090, 0.172, 0.106, 2.7, 0.002),
    (1.140, 0.176, 0.098, 2.9, 0.006),
    (1.172, 0.160, 0.088, 2.8, 0.008),
    (1.196, 0.118, 0.072, 2.4, 0.008),
    (1.212, 0.072, 0.060, 2.0, 0.008),
]


def _catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


def torso_section(z: float) -> tuple[float, float, float, float]:
    """Interpolated (a, b, n, cy) at height z (clamped to the table range)."""
    S = TORSO_SECTIONS
    if z <= S[0][0]:
        return S[0][1:]
    if z >= S[-1][0]:
        return S[-1][1:]
    for i in range(len(S) - 1):
        if S[i][0] <= z <= S[i + 1][0]:
            t = (z - S[i][0]) / (S[i + 1][0] - S[i][0])
            i0, i3 = max(0, i - 1), min(len(S) - 1, i + 2)
            vals = []
            for k in range(1, 5):
                vals.append(_catmull(S[i0][k], S[i][k], S[i + 1][k], S[i3][k], t))
            return tuple(vals)
    return S[-1][1:]


def torso_point(theta: float, z: float, offset: float = 0.0, flare: float = 0.0) -> Vector:
    a, b, n, cy = torso_section(z)
    x, y = superellipse(theta, a + offset + flare, b + offset + flare * 0.8, n)
    return V((x, cy + y, z))


def torso_normal(theta: float, z: float) -> Vector:
    e = 0.003
    p0 = torso_point(theta, z)
    pt = torso_point(theta + e, z)
    pz = torso_point(theta, z + e)
    nrm = (pt - p0).cross(pz - p0)
    radial = V((p0.x, p0.y, 0.0))
    if nrm.dot(radial) < 0:
        nrm = -nrm
    return nrm.normalized()


def torso_offset_point(theta: float, z: float, off: float) -> Vector:
    return torso_point(theta, z) + torso_normal(theta, z) * off


TORSO_SEGS = 12


def build_torso() -> Part:
    p = Part('Torso')
    rings = []
    zs = [s[0] for s in TORSO_SECTIONS]
    # densify slightly around the chest/shoulders
    zz = []
    for i in range(len(zs) - 1):
        zz.append(zs[i])
    zz.append(zs[-1])
    for z in zz:
        ring = [torso_point(2 * math.pi * j / TORSO_SEGS, z) for j in range(TORSO_SEGS)]
        rings.append(ring)

    def colfn(q: Vector) -> tuple:
        # navel shadow, ribs hint, collarbone shading
        c = (1.0, 1.0, 1.0)
        nav = V((0.0, -0.11, 0.93))
        k = smoothstep(0.03, 0.0, (q - nav).length) * 0.4
        return mul_col(c, 1 - k)

    loft(p, rings, 'Skin', cap0='fan', cap1='fan', cap_depth0=0.03, cap_depth1=0.012, axis0=V((0, 0, -1)),
         axis1=V((0, 0, 1)), colfn=colfn, tag='torso')
    p.weight_fn = torso_weights
    return p


# ------------------------------------------------------------------------------------------------ limbs

def _limb_path(sk: Skeleton, bone: str, n: int = 5, ext0: float = 0.0, ext1: float = 0.0) -> list[Vector]:
    h, t = sk.head[bone], sk.tail[bone]
    d = (t - h).normalized()
    a, b = h - d * ext0, t + d * ext1
    return [a + (b - a) * (i / (n - 1)) for i in range(n)]


def build_arm_upper(sk: Skeleton, side: str) -> Part:
    p = Part('ArmUpper_' + side)
    bone = 'upperarm_' + side
    path = _limb_path(sk, bone, 4, ext0=0.0, ext1=0.0)

    def rad(u, th):
        bic = 0.006 * math.exp(-((u - 0.35) / 0.2) ** 2)
        return 0.047 - 0.008 * u + bic

    tube(p, path, rad, 8, 'Skin', up=V((0, -1, 0)), cap0='dome', cap1='dome', cap_depth0=0.045, cap_depth1=0.04,
         tag='armU', dome_steps=1)
    p.weight_fn = rigid(bone)
    return p


def build_arm_lower(sk: Skeleton, side: str) -> Part:
    p = Part('ArmLower_' + side)
    bone = 'forearm_' + side
    path = _limb_path(sk, bone, 4)

    def rad(u, th):
        bulge = 0.006 * math.exp(-((u - 0.22) / 0.18) ** 2)
        return 0.040 - 0.009 * u + bulge

    def colfn(q):
        # bony knob at the elbow + darker wrist
        return (0.95, 0.95, 0.95)

    tube(p, path, rad, 8, 'Skin', up=V((0, -1, 0)), squash=(1.0, 0.9), cap0='dome', cap1='dome', cap_depth0=0.036,
         cap_depth1=0.026, colfn=colfn, tag='armL', dome_steps=1)
    p.weight_fn = rigid(bone)
    return p


def hand_frame(sk: Skeleton, side: str):
    """(origin=wrist, a=along fingers, v=thumb side (front), w=palm normal)."""
    bone = 'hand_' + side
    a = sk.rest_dir[bone]
    sx = 1.0 if side == 'L' else -1.0
    w = V((-sx, 0.0, 0.0))
    w = (w - a * w.dot(a)).normalized()
    v = V((0.0, -1.0, 0.0))
    v = (v - a * v.dot(a) - w * v.dot(w)).normalized()
    return sk.head[bone], a, v, w


def build_hand(sk: Skeleton, side: str, name: str | None = None, mat: str = 'Skin', wooden: bool = False) -> Part:
    p = Part(name or ('Hand_' + side))
    o, a, v, w = hand_frame(sk, side)
    sx = 1.0 if side == 'L' else -1.0

    def H(u, vv, ww):
        return o + a * u + v * vv + w * ww

    # palm: superellipse rings across (v,w) along a
    rings = []
    prof = [(-0.012, 0.030, 0.013), (0.004, 0.034, 0.016), (0.035, 0.040, 0.017), (0.064, 0.041, 0.015),
            (0.075, 0.036, 0.012)]
    for (u, hv, hw) in prof:
        ring = []
        for j in range(8):
            th = 2 * math.pi * j / 8
            x, y = superellipse(th, hv, hw, 3.0)
            ring.append(H(u, x, y * (1.0 if y < 0 else 1.15)))
        rings.append(ring)
    # ensure CCW about +a: basis (v, w) with v x w should equal a
    if v.cross(w).dot(a) < 0:
        rings = [list(reversed(r)) for r in rings]
    loft(p, rings, mat, cap0='dome', cap1=None, cap_depth0=0.012, axis0=-a, dome_steps=1, tag='palm')
    # fingers (3) + thumb
    knuck = 0.068
    fingers = [(0.024, 0.056, 0.0102), (0.0, 0.062, 0.0108), (-0.024, 0.052, 0.0100)]
    curl = 0.55 if not wooden else 0.25
    for (vv, ln, r) in fingers:
        pts = []
        for k in range(4):
            t = k / 3
            ang = curl * t * t
            pts.append(H(knuck - 0.012 + ln * t * math.cos(ang) * 0.95, vv * (1 + 0.15 * t), ln * math.sin(ang) * 0.9))
        tube(p, pts, lambda u, th, r=r: r * (1.0 - 0.18 * u), 4, mat, up=w, cap0='fan', cap1='dome', cap_depth0=0.004,
             cap_depth1=r * 0.9, dome_steps=1, tag='finger')
    # thumb
    tp = [H(0.018, 0.030, 0.006), H(0.040, 0.050, 0.014), H(0.058, 0.058, 0.022)]
    tube(p, tp, lambda u, th: 0.0118 * (1 - 0.15 * u), 4, mat, up=a, cap0='fan', cap1='dome', cap_depth0=0.004,
         cap_depth1=0.010, dome_steps=1, tag='thumb')
    # close the palm's knuckle end with a fan (fingers overlap it)
    ring_idx = list(range(8 * 4, 8 * 5))
    c = sum((p.co[i] for i in ring_idx), V((0, 0, 0))) / 8
    ci = p.v(c + a * 0.008, (1, 1, 1), 0.0, 'palm')
    fan(p, ring_idx, ci, mat)
    p.weight_fn = rigid('hand_' + side)
    if wooden:
        p.sharp_angle = 40.0
    return p


def build_leg_upper(sk: Skeleton, side: str) -> Part:
    p = Part('LegUpper_' + side)
    bone = 'thigh_' + side
    path = _limb_path(sk, bone, 4)

    def rad(u, th):
        return 0.074 - 0.018 * u + 0.004 * math.sin(u * math.pi)

    tube(p, path, rad, 8, 'Skin', up=V((0, -1, 0)), cap0='dome', cap1='dome', cap_depth0=0.06, cap_depth1=0.05,
         tag='legU', dome_steps=1)
    p.weight_fn = rigid(bone)
    return p


def build_leg_lower(sk: Skeleton, side: str) -> Part:
    p = Part('LegLower_' + side)
    bone = 'shin_' + side
    path = _limb_path(sk, bone, 5)

    def rad(u, th):
        calf = 0.008 * math.exp(-((u - 0.3) / 0.2) ** 2) * (1.0 + 0.6 * math.sin(th) ** 2)
        return 0.054 - 0.016 * u + calf

    tube(p, path, rad, 8, 'Skin', up=V((0, -1, 0)), cap0='dome', cap1='dome', cap_depth0=0.052, cap_depth1=0.035,
         tag='legL', dome_steps=1)
    p.weight_fn = rigid(bone)
    return p


def build_foot(sk: Skeleton, side: str) -> Part:
    p = Part('Foot_' + side)
    bone = 'foot_' + side
    ank = sk.head[bone]
    sx = 1.0 if side == 'L' else -1.0
    pts = [V((ank.x, ank.y + 0.045, 0.045)), V((ank.x, ank.y + 0.0, 0.05)), V((ank.x + 0.004 * sx, ank.y - 0.07, 0.035)),
           V((ank.x + 0.006 * sx, ank.y - 0.13, 0.025))]
    tube(p, pts[1:], lambda u, th: 0.042 - 0.012 * u, 5, 'Skin', up=V((0, 0, 1)), squash=(0.75, 1.15), cap0='fan',
         cap1='fan', cap_depth0=0.03, cap_depth1=0.03, tag='foot', dome_steps=1)
    p.weight_fn = rigid(bone)
    return p


def build_body(sk: Skeleton) -> list[Part]:
    parts = [build_torso()]
    for s in ('L', 'R'):
        parts += [build_arm_upper(sk, s), build_arm_lower(sk, s), build_hand(sk, s), build_leg_upper(sk, s),
                  build_leg_lower(sk, s), build_foot(sk, s)]
    return parts
