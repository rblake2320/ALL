"""'Stitches' mesh: dark thread crosses along seams on face, neck, arms, knee and belly (material 'Stitch').

Each seam is tagged by region; morph targets hide_armL/hide_armR/hide_legL/hide_legR collapse the seams of a
missing/prosthetic limb to a point (zero area) so a single draw call serves every limb state."""
from __future__ import annotations

import math

from mathutils import Vector

from .body import torso_normal, torso_point
from .bottoms import leg_chain_point, leg_radius
from .clothing import arm_chain_point, arm_radius
from .face import head_weights, surface, surface_normal
from .meshkit import Part
from .skeleton import Skeleton
from .weights import torso_weights

V = Vector
THREAD = (1.0, 1.0, 1.0)


def _seam(p: Part, pts: list[Vector], normals: list[Vector], tag: str, cross_every: int = 2, width: float = 0.0026,
          cross_len: float = 0.011) -> None:
    """Line strip + X crosses along a polyline lying on a surface."""
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        n = (normals[i] + normals[i + 1]).normalized()
        d = (b - a)
        side = n.cross(d).normalized() * width * 0.5
        i0 = p.v(a - side, THREAD, 0.0, tag)
        i1 = p.v(b - side, THREAD, 0.0, tag)
        i2 = p.v(b + side, THREAD, 0.0, tag)
        i3 = p.v(a + side, THREAD, 0.0, tag)
        p.f((i0, i1, i2, i3) if (p.co[i1] - p.co[i0]).cross(p.co[i3] - p.co[i0]).dot(n) > 0 else (i3, i2, i1, i0),
            'Stitch')
    for i in range(0, len(pts), max(1, cross_every)):
        c, n = pts[i], normals[i]
        if i < len(pts) - 1:
            d = (pts[i + 1] - c).normalized()
        else:
            d = (c - pts[i - 1]).normalized()
        s = n.cross(d).normalized()
        for diag in ((d + s).normalized(), (d - s).normalized()):
            a = c - diag * cross_len * 0.5 + n * 0.0008
            b = c + diag * cross_len * 0.5 + n * 0.0008
            side = n.cross(diag).normalized() * width * 0.55
            i0 = p.v(a - side, THREAD, 0.0, tag)
            i1 = p.v(b - side, THREAD, 0.0, tag)
            i2 = p.v(b + side, THREAD, 0.0, tag)
            i3 = p.v(a + side, THREAD, 0.0, tag)
            p.f((i0, i1, i2, i3) if (p.co[i1] - p.co[i0]).cross(p.co[i3] - p.co[i0]).dot(n) > 0 else (i3, i2, i1, i0),
                'Stitch')


def _head_seam(p: Part, a: tuple[float, float], b: tuple[float, float], n: int, tag: str = 'head') -> None:
    pts, nrm = [], []
    for k in range(n):
        t = k / (n - 1)
        az = a[0] + (b[0] - a[0]) * t
        el = a[1] + (b[1] - a[1]) * t
        pts.append(surface(az, el, 0.0032))
        nrm.append(surface_normal(az, el))
    _seam(p, pts, nrm, tag)


def _ring_seam(p: Part, center_fn, radius_fn, n: int, tag: str, arc: tuple[float, float] = (0.0, 2 * math.pi),
               up: Vector = V((0, -1, 0))) -> None:
    pts, nrm = [], []
    for k in range(n):
        t = k / (n - 1)
        th = arc[0] + (arc[1] - arc[0]) * t
        c, axis = center_fn(t)
        a = (up - axis * up.dot(axis)).normalized()
        b = axis.cross(a)
        d = a * math.cos(th) + b * math.sin(th)
        pts.append(c + d * radius_fn(t))
        nrm.append(d)
    _seam(p, pts, nrm, tag)


def build_stitches(sk: Skeleton) -> Part:
    p = Part('Stitches')
    # face: forehead diagonal + cheek
    _head_seam(p, (0.62, 0.66), (-0.12, 0.44), 7)
    _head_seam(p, (-0.58, -0.22), (-0.44, -0.52), 4)
    # neck ring (head sewn back on)
    neck_c = V((0.0, 0.007, 1.255))
    _ring_seam(p, lambda t: (neck_c, V((0, 0, 1))), lambda t: 0.0625, 11, 'neck', arc=(0.5, 2 * math.pi - 0.5),
               up=V((1, 0, 0)))
    # left wrist (forearm near the hand) and right upper arm
    for side, u, tag, arc in (('L', 1.78, 'armL', (0.0, 2 * math.pi * 0.7)), ('R', 0.62, 'armR', (0.6, 4.2))):
        ua = 'upperarm_' + side if u <= 1 else 'forearm_' + side
        axis = sk.rest_dir[ua]
        _ring_seam(p, lambda t, s=side, u=u, a=axis: (arm_chain_point(sk, s, u), a),
                   lambda t, u=u: arm_radius(u) + 0.0035, 8, tag, arc=arc)
    # left knee (visible with shorts/skirts)
    axis = sk.rest_dir['shin_L']
    _ring_seam(p, lambda t: (leg_chain_point(sk, 'L', 1.12), axis), lambda t: leg_radius(1.12) + 0.004, 6, 'legL',
               arc=(-2.4, -0.6))
    axis_r = sk.rest_dir['shin_R']
    _ring_seam(p, lambda t: (leg_chain_point(sk, 'R', 1.82), axis_r), lambda t: leg_radius(1.82) + 0.004, 5, 'legR',
               arc=(-2.2, -0.9))
    # belly seam (visible through tatters)
    pts, nrm = [], []
    for k in range(6):
        z = 0.98 - 0.022 * k
        th = -math.pi / 2 + 0.35 - 0.08 * k
        pts.append(torso_point(th, z) + torso_normal(th, z) * 0.003)
        nrm.append(torso_normal(th, z))
    _seam(p, pts, nrm, 'torso')

    def wfn(co: Vector, tag: str) -> dict:
        if tag == 'head':
            return head_weights(co, 'head')
        if tag == 'neck':
            return head_weights(co, 'neck')
        if tag == 'armL':
            return {'forearm_L': 1.0}
        if tag == 'armR':
            return {'upperarm_R': 1.0}
        if tag == 'legL':
            return {'shin_L': 1.0}
        if tag == 'legR':
            return {'shin_R': 1.0}
        return torso_weights(co, tag)
    p.weight_fn = wfn
    return p


def stitch_hide_keys(p: Part) -> dict:
    """Collapse each limb region's stitch vertices onto their centroid (degenerate triangles = invisible)."""
    out = {}
    for limb in ('armL', 'armR', 'legL', 'legR'):
        idx = [i for i, t in enumerate(p.tag) if t == limb]
        co = [c.copy() for c in p.co]
        if idx:
            cen = sum((p.co[i] for i in idx), V((0, 0, 0))) / len(idx)
            for i in idx:
                co[i] = cen.copy()
        out['hide_' + limb] = co
    return out
