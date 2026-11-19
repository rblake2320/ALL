"""Tops: Top_<style>_Body / _SleeveL / _SleeveR. Garments are offset shells of the analytic torso / limb
surfaces; every open edge gets an inward lip so no camera angle sees through to back faces."""
from __future__ import annotations

import math

from mathutils import Vector

from .body import torso_normal, torso_point, torso_section
from .meshkit import Part, add_ring, delete_faces, ellipsoid, face_center, grid, loft, mul_col, tube
from .noise import fbm3, rng, smoothstep
from .skeleton import Skeleton
from .weights import torso_weights

V = Vector
TWO_PI = 2 * math.pi
FRONT = -math.pi / 2  # theta of the front (-Y)


def ang_dist(a: float, b: float) -> float:
    d = (a - b + math.pi) % TWO_PI - math.pi
    return abs(d)


def front_amount(theta: float, width: float) -> float:
    """1 at the front centre, falling to 0 at +-width radians."""
    return smoothstep(width, 0.0, ang_dist(theta, FRONT))


def garment_point(theta: float, z: float, off: float) -> Vector:
    zc = max(z, 0.632)
    p = torso_point(theta, zc) + torso_normal(theta, zc) * off
    if z < zc:
        p = p + V((0, 0, z - zc))
    return p


class BodySpec:
    def __init__(self, hem, neck, off, cols=12, rows=6, colfn=None, theta_range=None, collar=0.006,
                 neck_inner=0.004, hem_lip=0.008, seed=1):
        self.hem, self.neck, self.off = hem, neck, off
        self.cols, self.rows, self.colfn = cols, rows, colfn
        self.theta_range = theta_range
        self.collar, self.neck_inner, self.hem_lip, self.seed = collar, neck_inner, hem_lip, seed


def garment_body(p: Part, spec: BodySpec, mat: str = 'Top', tag: str = 'body') -> list[list[int]]:
    closed = spec.theta_range is None
    if closed:
        thetas = [TWO_PI * j / spec.cols for j in range(spec.cols)]
    else:
        a0, a1 = spec.theta_range
        thetas = [a0 + (a1 - a0) * j / spec.cols for j in range(spec.cols + 1)]
    rows_pts: list[list[Vector]] = []
    # hem lip (inside, slightly up)
    lip = []
    for th in thetas:
        z0 = spec.hem(th)
        lip.append(garment_point(th, z0 + 0.012, spec.off(th, z0 + 0.012) - spec.hem_lip))
    rows_pts.append(lip)
    for k in range(spec.rows + 1):
        t = k / spec.rows
        row = []
        for th in thetas:
            z0, z1 = spec.hem(th), spec.neck(th)
            z = z0 + (z1 - z0) * t
            row.append(garment_point(th, z, spec.off(th, z)))
        rows_pts.append(row)
    # collar roll + inner lip toward the neck / body
    roll, inner = [], []
    for th in thetas:
        z1 = spec.neck(th)
        o = spec.off(th, z1)
        q = garment_point(th, z1, o)
        rolled = q + V((0, 0, spec.collar * 0.6)) + V((q.x, q.y - 0.006, 0)).normalized() * (spec.collar * 0.3)
        roll.append(rolled)
        inn = garment_point(th, z1 - 0.012, -spec.neck_inner)
        inner.append(inn)
    rows_pts.append(roll)
    rows_pts.append(inner)
    idx_rows = []
    for ri, row in enumerate(rows_pts):
        ids = []
        for q in row:
            c = spec.colfn(q, ri, len(rows_pts)) if spec.colfn else (1.0, 1.0, 1.0)
            ids.append(p.v(q, c, 0.0, tag))
        idx_rows.append(ids)
    grid(p, idx_rows, mat, close_u=closed)
    return idx_rows


# ------------------------------------------------------------------------------------------------ sleeves

def arm_chain_point(sk: Skeleton, side: str, u: float) -> Vector:
    """u in [0,2]: 0 shoulder joint, 1 elbow, 2 wrist."""
    ua, fa = 'upperarm_' + side, 'forearm_' + side
    if u <= 1.0:
        return sk.head[ua] + (sk.tail[ua] - sk.head[ua]) * u
    return sk.head[fa] + (sk.tail[fa] - sk.head[fa]) * min(1.0, u - 1.0)


def arm_radius(u: float) -> float:
    if u <= 1.0:
        return 0.047 - 0.008 * u + 0.006 * math.exp(-((u - 0.35) / 0.2) ** 2)
    v = u - 1.0
    return 0.040 - 0.009 * v + 0.006 * math.exp(-((v - 0.22) / 0.18) ** 2)


def sleeve(sk: Skeleton, side: str, name: str, u1: float, off: float, cuff_flare: float = 0.0, puff: float = 0.0,
           segs: int = 8, colfn=None, ragged: float = 0.0, seed: int = 3, mat: str = 'Top') -> Part:
    p = Part(name)
    us = [0.0, 0.3]
    if u1 > 1.0:
        us += [0.92, 1.08]
    k = 1.5
    while k < u1 - 0.15:
        us.append(k)
        k += 0.45
    us = [u for u in us if u < u1 - 0.05] + [u1]
    path = [arm_chain_point(sk, side, u) for u in us]
    r = rng(seed)
    rag = [r.uniform(-ragged, ragged) for _ in range(segs)]

    def rad(t, th):
        u = us[0] + (u1 - us[0]) * t
        base = arm_radius(min(u, 2.0)) + off
        base += puff * math.exp(-((u - 0.18) / 0.16) ** 2)
        base += cuff_flare * smoothstep(u1 - 0.3, u1, u)
        return base

    rows = tube(p, path, rad, segs, mat, up=V((0, -1, 0)), cap0='dome', cap1=None, cap_depth0=0.05,
                colfn=colfn, tag='sleeve')
    end = rows[-1]
    axis = (path[-1] - path[-2]).normalized()
    if ragged:
        for j, vi in enumerate(end):
            p.co[vi] = p.co[vi] + axis * rag[j]
    # cuff lip
    lip = []
    for vi in end:
        q = p.co[vi]
        c = path[-1]
        radial = (q - c) - axis * (q - c).dot(axis)
        lip.append(q - radial.normalized() * (off + 0.004) - axis * 0.012)
    lip_ids = add_ring(p, lip, col=(0.55, 0.55, 0.55), tag='sleeve')
    grid(p, [end, lip_ids], mat)
    p.weight_fn = sleeve_weights(sk, side)
    return p


def sleeve_weights(sk: Skeleton, side: str):
    ua, fa = 'upperarm_' + side, 'forearm_' + side
    elbow = sk.head[fa]
    axis_u = sk.rest_dir[ua]

    def fn(co: Vector, tag: str) -> dict:
        t = smoothstep(-0.035, 0.035, (co - elbow).dot(axis_u))
        return {ua: 1.0 - t, fa: t}
    return fn


# ------------------------------------------------------------------------------------------------ helpers

def _frayed(seed: int, amp: float, cols: int):
    r = rng(seed)
    vals = [r.uniform(-amp, amp) if r.random() < 0.6 else 0.0 for _ in range(cols + 1)]

    def fn(theta: float) -> float:
        j = int(round((theta % TWO_PI) / TWO_PI * cols)) % cols
        return vals[j]
    return fn


def _patch(center: Vector, half: float, tint=(0.78, 0.7, 0.6)):
    def fn(q: Vector) -> float:
        d = q - center
        return 1.0 if (abs(d.x) < half and abs(d.z) < half and abs(d.y) < 0.2) else 0.0
    return fn, tint


def stdcol(q: Vector, ri: int, nrows: int, hem_band=0.0, patches=(), dirt=0.25, seed=2) -> tuple:
    c = (1.0, 1.0, 1.0)
    if ri == 0:
        c = mul_col(c, 0.6)
    elif ri == 1:
        c = mul_col(c, 0.86 - hem_band)
    if ri >= nrows - 2:
        c = mul_col(c, 0.78)
    for pf, tint in patches:
        if pf(q):
            c = mul_col(c, tint)
    n = fbm3(q.x * 6, q.y * 6, q.z * 6, seed)
    k = 1.0 - dirt * max(0.0, n - 0.45) * 1.6
    return mul_col(c, k)


def dot_col(points: list[Vector], radius: float, tint):
    def fn(q: Vector) -> tuple | None:
        for pt in points:
            if (q - pt).length < radius:
                return tint
        return None
    return fn


# ------------------------------------------------------------------------------------------------ styles

def top_tee(sk):
    fr = _frayed(5, 0.012, 12)
    patch = _patch(V((-0.08, 0.10, 0.98)), 0.045)

    def off(th, z):
        return 0.013 + 0.012 * smoothstep(0.98, 0.80, z) + 0.004 * smoothstep(1.12, 1.19, z)

    spec = BodySpec(lambda th: 0.80 + fr(th), lambda th: 1.198 - 0.012 * front_amount(th, 0.7), off,
                    colfn=lambda q, ri, n: stdcol(q, ri, n, 0.12, (patch,)), seed=5)
    body = Part('Top_tee_Body')
    garment_body(body, spec)
    sl = {s: sleeve(sk, s, 'Top_tee_Sleeve' + s, 0.42, 0.014, cuff_flare=0.006,
                    colfn=lambda q: (0.95, 0.95, 0.95)) for s in ('L', 'R')}
    return body, sl


def top_hoodie(sk):
    def off(th, z):
        return 0.019 + 0.014 * smoothstep(1.0, 0.82, z)

    def col(q, ri, n):
        c = stdcol(q, ri, n, 0.0, ())
        if q.z < 0.80:
            c = mul_col(c, 0.82)  # ribbed band
        # kangaroo pocket outline
        if -0.11 < q.x < 0.11 and 0.80 < q.z < 0.93 and q.y < -0.05:
            edge = min(abs(abs(q.x) - 0.11), abs(q.z - 0.93))
            c = mul_col(c, 0.78 if edge < 0.015 else 0.93)
        return c

    spec = BodySpec(lambda th: 0.765, lambda th: 1.202 - 0.01 * front_amount(th, 0.7), off, colfn=col,
                    collar=0.01)
    body = Part('Top_hoodie_Body')
    garment_body(body, spec)
    # hood bunched behind the neck
    pts = []
    for k in range(7):
        th = math.radians(-5 + 190 * k / 6)  # from the left side around the back to the right side
        pts.append(garment_point(th, 1.20, 0.03) + V((0, 0.012, 0.012)))
    tube(body, pts, lambda u, th: 0.032 + 0.012 * math.sin(u * math.pi), 6, 'Top', up=V((0, 0, 1)), cap0='dome',
         cap1='dome', cap_depth0=0.02, cap_depth1=0.02, colfn=lambda q: (0.86, 0.86, 0.86), tag='body', dome_steps=1)
    # drawstrings
    for sx in (1, -1):
        a = garment_point(FRONT + 0.32 * sx, 1.18, 0.024)
        tube(body, [a, a + V((0.004 * sx, -0.012, -0.06)), a + V((0.008 * sx, -0.018, -0.11))], 0.0045, 4, 'Top',
             cap0='fan', cap1='fan', cap_depth0=0.0, cap_depth1=0.002, colfn=lambda q: (0.55, 0.55, 0.55), tag='body')
    sl = {s: sleeve(sk, s, 'Top_hoodie_Sleeve' + s, 1.96, 0.018, cuff_flare=0.002,
                    colfn=lambda q: (0.93, 0.93, 0.93)) for s in ('L', 'R')}
    return body, sl


def _shirt_front(body: Part, z0: float, z1: float, width: float, tie: bool, off: float = 0.006):
    """Undershirt panel (Accessory material) filling a V-neck; optional wine tie."""
    cols, rows = 6, 5
    idx = []
    for k in range(rows + 1):
        z = z0 + (z1 - z0) * k / rows
        row = []
        for j in range(cols + 1):
            th = FRONT - width + 2 * width * j / cols
            q = garment_point(th, z, off)
            c = (0.93, 0.91, 0.85)
            if tie and abs(q.x) < 0.016 + 0.01 * smoothstep(1.1, 0.95, z):
                c = (0.42, 0.10, 0.14)
            row.append(body.v(q, c, 0.0, 'body'))
        idx.append(row)
    grid(body, idx, 'Accessory', close_u=False)


def top_suit(sk):
    def neck(th):
        return 1.205 - 0.20 * front_amount(th, 0.62)

    def off(th, z):
        return 0.017 + 0.01 * smoothstep(0.98, 0.80, z)

    buttons = [garment_point(FRONT + 0.05, 0.905, 0.02), garment_point(FRONT + 0.05, 0.835, 0.02)]
    dots = dot_col(buttons, 0.012, (0.35, 0.3, 0.3))

    def col(q, ri, n):
        c = stdcol(q, ri, n, 0.0, ())
        d = dots(q)
        if d:
            c = mul_col(c, d)
        return c

    spec = BodySpec(lambda th: 0.745, neck, off, colfn=col, cols=12, collar=0.012)
    body = Part('Top_suit_Body')
    garment_body(body, spec)
    # lapels: folded strips along both V edges
    for sx in (1, -1):
        pts = []
        for k in range(6):
            t = k / 5
            z = 1.185 - 0.20 * t
            th = FRONT + sx * (0.62 - 0.55 * t)
            pts.append(garment_point(th, z, 0.026))
        tube(body, pts, lambda u, th: 0.016 + 0.006 * u, 4, 'Top', up=V((0, -1, 0)), squash=(1.0, 0.3), cap0='fan',
             cap1='fan', cap_depth0=0.0, cap_depth1=0.0, colfn=lambda q: (0.62, 0.62, 0.62), tag='body')
    _shirt_front(body, 0.97, 1.21, 0.62, tie=False, off=0.004)
    # tie: knot + blade as its own strip in front of the shirt
    tie_pts = [garment_point(FRONT, z, 0.012) for z in (1.19, 1.15, 1.08, 1.02)]
    tube(body, tie_pts, lambda u, th: 0.011 + 0.010 * u, 4, 'Accessory', up=V((0, -1, 0)), squash=(1.0, 0.25),
         cap0='fan', cap1='fan', cap_depth0=0.0, cap_depth1=0.012, colfn=lambda q: (0.30, 0.04, 0.07), tag='body')
    # pocket square (Accessory), left chest
    pq = garment_point(FRONT + 0.55, 1.07, 0.024)
    tube(body, [pq, pq + V((0, -0.002, 0.022))], lambda u, th: 0.012 * (1 - u) + 0.002, 3, 'Accessory',
         cap0='fan', cap1='fan', cap_depth0=0.0, cap_depth1=0.0, colfn=lambda q: (0.55, 0.62, 0.45), tag='body')
    sl = {s: sleeve(sk, s, 'Top_suit_Sleeve' + s, 1.98, 0.017, colfn=lambda q: (0.95, 0.95, 0.95)) for s in ('L', 'R')}
    return body, sl


def top_blouse(sk):
    def off(th, z):
        return 0.018 + 0.016 * smoothstep(0.88, 0.79, z) + 0.002 * smoothstep(1.1, 1.18, z)

    btn = [garment_point(FRONT, z, 0.016) for z in (1.15, 1.07, 0.99, 0.91, 0.84)]
    dots = dot_col(btn, 0.009, (0.55, 0.5, 0.5))

    def col(q, ri, n):
        c = stdcol(q, ri, n, 0.0, (), dirt=0.15)
        d = dots(q)
        return mul_col(c, d) if d else c

    spec = BodySpec(lambda th: 0.79, lambda th: 1.215, off, colfn=col, collar=0.004)
    body = Part('Top_blouse_Body')
    garment_body(body, spec)
    # frilly collar ruffle (Accessory lace)
    ring = []
    for j in range(16):
        th = TWO_PI * j / 16
        q = garment_point(th, 1.208, 0.018)
        out = V((q.x, q.y, 0)).normalized()
        wave = 0.008 if j % 2 == 0 else -0.002
        ring.append(q + out * (0.016 + wave) + V((0, 0, -0.012)))
    top = [garment_point(TWO_PI * j / 16, 1.214, 0.008) for j in range(16)]
    a = add_ring(body, top, col=(0.95, 0.93, 0.88), tag='body')
    b = add_ring(body, ring, col=(0.9, 0.88, 0.84), tag='body')
    grid(body, [b, a], 'Accessory')
    sl = {s: sleeve(sk, s, 'Top_blouse_Sleeve' + s, 1.55, 0.015, cuff_flare=0.014, puff=0.014,
                    colfn=lambda q: (0.96, 0.96, 0.96)) for s in ('L', 'R')}
    return body, sl


def top_dress(sk):
    fr = _frayed(9, 0.012, 14)

    def neck(th):
        return 1.185 - 0.065 * front_amount(th, 0.9)

    def off(th, z):
        base = 0.012 + 0.006 * smoothstep(1.0, 0.86, z)
        skirt = max(0.0, 0.80 - z) * 0.34
        return base + skirt

    def col(q, ri, n):
        c = stdcol(q, ri, n, 0.15, (), dirt=0.2)
        if 0.845 < q.z < 0.875:
            c = mul_col(c, 0.75)  # waist band
        return c

    spec = BodySpec(lambda th: 0.43 + fr(th), neck, off, colfn=col, cols=14, rows=8, hem_lip=0.01)
    body = Part('Top_dress_Body')
    garment_body(body, spec)
    sl = {s: sleeve(sk, s, 'Top_dress_Sleeve' + s, 0.24, 0.013, cuff_flare=0.01, puff=0.01,
                    colfn=lambda q: (0.95, 0.95, 0.95)) for s in ('L', 'R')}
    body.weight_fn = skirt_weights(top=0.80, bottom=0.52)
    return body, sl


def top_tatters(sk):
    fr = _frayed(13, 0.045, 12)
    fr_n = _frayed(17, 0.02, 12)

    def off(th, z):
        return 0.015 + 0.008 * smoothstep(0.98, 0.82, z)

    def col(q, ri, n):
        c = stdcol(q, ri, n, 0.2, (), dirt=0.55, seed=7)
        return c

    spec = BodySpec(lambda th: 0.83 + fr(th), lambda th: 1.19 + fr_n(th) - 0.03 * front_amount(th, 0.6), off,
                    colfn=col)
    body = Part('Top_tatters_Body')
    rows = garment_body(body, spec)
    # holes: remove a few quads in the middle rows (Torso stays visible under tatters)
    holes = [(3, 2), (4, 8), (5, 10), (2, 5)]
    hole_faces = set()
    cols = spec.cols
    for (rr, cc) in holes:
        hole_faces.add(rr * cols + cc)
    delete_faces(body, lambda fi: fi in hole_faces)
    sl = {
        'L': sleeve(sk, 'L', 'Top_tatters_SleeveL', 1.15, 0.012, ragged=0.03, seed=4,
                    colfn=lambda q: (0.85, 0.85, 0.85)),
        'R': sleeve(sk, 'R', 'Top_tatters_SleeveR', 0.48, 0.012, ragged=0.03, seed=6,
                    colfn=lambda q: (0.85, 0.85, 0.85)),
    }
    return body, sl


def top_cardigan(sk):
    gap = 0.16

    def off(th, z):
        return 0.019 + 0.012 * smoothstep(0.98, 0.80, z)

    btn = [garment_point(FRONT + gap + 0.05, z, 0.024) for z in (1.06, 0.97, 0.88)]
    dots = dot_col(btn, 0.011, (0.45, 0.38, 0.32))
    pockets = [_patch(garment_point(FRONT + 0.75, 0.84, 0.0), 0.04, (0.84, 0.84, 0.84)),
               _patch(garment_point(FRONT - 0.75, 0.84, 0.0), 0.04, (0.84, 0.84, 0.84))]

    def col(q, ri, n):
        c = stdcol(q, ri, n, 0.0, pockets, dirt=0.2)
        if q.z < 0.79:
            c = mul_col(c, 0.84)
        d = dots(q)
        return mul_col(c, d) if d else c

    def neck(th):
        return 1.205 - 0.16 * front_amount(th, 0.7)

    spec = BodySpec(lambda th: 0.745, neck, off, colfn=col, cols=13, theta_range=(FRONT + gap, FRONT + TWO_PI - gap),
                    collar=0.01)
    body = Part('Top_cardigan_Body')
    garment_body(body, spec)
    _shirt_front(body, 0.80, 1.205, 0.42, tie=False, off=0.006)
    sl = {s: sleeve(sk, s, 'Top_cardigan_Sleeve' + s, 1.97, 0.019, colfn=lambda q: (0.93, 0.93, 0.93))
          for s in ('L', 'R')}
    return body, sl


def skirt_weights(top: float, bottom: float):
    """Pelvis at the waist, sliding onto the thighs (split by side) toward the hem so legs move the skirt."""
    def fn(co: Vector, tag: str) -> dict:
        if co.z > top:
            return torso_weights(co, tag)
        t = smoothstep(top, bottom, co.z) * 0.85
        side = smoothstep(-0.05, 0.05, co.x)
        return {'pelvis': 1.0 - t, 'thigh_L': t * side, 'thigh_R': t * (1.0 - side)}
    return fn


TOP_BUILDERS = {
    'tee': top_tee, 'hoodie': top_hoodie, 'suit': top_suit, 'blouse': top_blouse, 'dress': top_dress,
    'tatters': top_tatters, 'cardigan': top_cardigan,
}

# Which body skin parts each top hides (fully covered): upper arms / forearms / torso
TOP_COVERS = {
    'tee': {'armUpper': False, 'armLower': False, 'torso': True},
    'hoodie': {'armUpper': True, 'armLower': True, 'torso': True},
    'suit': {'armUpper': True, 'armLower': True, 'torso': True},
    'blouse': {'armUpper': True, 'armLower': False, 'torso': True},
    'dress': {'armUpper': False, 'armLower': False, 'torso': True},
    'tatters': {'armUpper': False, 'armLower': False, 'torso': False},
    'cardigan': {'armUpper': True, 'armLower': True, 'torso': True},
}


def build_top(sk: Skeleton, style: str) -> list[Part]:
    body, sl = TOP_BUILDERS[style](sk)
    if not hasattr(body, 'weight_fn'):
        body.weight_fn = torso_weights
    return [body, sl['L'], sl['R']]
