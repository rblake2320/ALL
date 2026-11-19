"""Part builders: one skinned mesh per variant ('normal' | 'undead'), rest pose, armature space.

Every primitive is appended to a single Part together with its skin weights. Left-side pieces are built once
and mirrored. Markings are per-vertex multipliers on the recolourable `Paint` material.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

from . import mk
from .rig import Rig
from .species import UNDEAD_PATCH, UNDEAD_TINT, torso_profile, torso_span

V = Vector
Z = V((0.0, 0.0, 1.0))

# Build options, set by build_part() for the duration of one build. The defaults are the pets' values.
OPTS = {'detail': 1.0, 'name': None, 'low': False}


def _seg(n: int, lo: int) -> int:
    return n if OPTS['detail'] == 1.0 else max(lo, int(round(n * OPTS['detail'])))


def _tube(part, path, radius, segs, mat, **kw):
    return mk.tube(part, path, radius, _seg(segs, 3 if OPTS['low'] else 4), mat, **kw)


def _ellipsoid(part, center, radii, segs, rings, mat, **kw):
    return mk.ellipsoid(part, center, radii, _seg(segs, 4 if OPTS['low'] else 5), _seg(rings, 3), mat, **kw)
FWD = V((0.0, -1.0, 0.0))


def smooth(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def lerp(a, b, t):
    return a + (b - a) * t


def mulc(c, k):
    return (c[0] * k[0], c[1] * k[1], c[2] * k[2]) if isinstance(k, tuple) else (c[0] * k, c[1] * k, c[2] * k)


class Builder:
    def __init__(self, name: str, rig: Rig, variant: str):
        self.part = mk.Part(name)
        self.part.weights = []
        self.rig = rig
        self.sp = rig.sp
        self.undead = variant == 'undead'
        self.tint = UNDEAD_TINT if self.undead else (1.0, 1.0, 1.0)

    # -- plumbing -----------------------------------------------------------------------
    def add(self, build, wfn) -> range:
        start = len(self.part.co)
        build(self.part)
        for i in range(start, len(self.part.co)):
            self.part.weights.append(wfn(self.part.co[i]))
        return range(start, len(self.part.co))

    def add_side(self, build, wfn) -> None:
        """Build a left-side piece, then its mirror image (x -> -x, _L -> _R, winding flipped)."""
        tmp = mk.Part('tmp')
        build(tmp)
        w = [wfn(c) for c in tmp.co]
        for sign in (1.0, -1.0):
            off = len(self.part.co)
            for i, c in enumerate(tmp.co):
                self.part.v((c.x * sign, c.y, c.z), tmp.col[i])
                self.part.weights.append(w[i] if sign > 0 else {_swap(b): x for b, x in w[i].items()})
            for f, m in zip(tmp.faces, tmp.fmat):
                idx = tuple(j + off for j in f)
                self.part.f(idx if sign > 0 else idx[::-1], m)

    def col(self, k: float, light: float = 0.0) -> tuple:
        """Vertex colour: the species coat tint darkened by `k`, blended toward the bare `Paint` colour by
        `light` (belly, muzzle, socks), with the variant tint applied on top."""
        c = mulc(self.sp['coat'], k)
        c = tuple(lerp(c[i], 1.0, max(0.0, min(1.0, light))) for i in range(3))
        return mulc(c, self.tint)

    # -- stitches -----------------------------------------------------------------------
    def cross(self, p: Vector, n: Vector, t: Vector, size: float, wfn) -> None:
        n = n.normalized()
        t = (t - n * t.dot(n)).normalized()
        s = n.cross(t).normalized()
        a = p + n * (0.0022 + 0.02 * size)
        for d in ((t + s).normalized(), (t - s).normalized()):
            self.add(lambda part, d=d: mk.strip_quad(part, a - d * size * 0.5, a + d * size * 0.5, n, size * 0.26,
                                                     'Stitch'), wfn)

    def seam(self, fn, t0: float, t1: float, count: int, size: float, wfn) -> None:
        """Crosses along a surface curve fn(t) -> (point, normal)."""
        for i in range(count):
            t = lerp(t0, t1, (i + 0.5) / count)
            p, n = fn(t)
            p2, _ = fn(t + (t1 - t0) * 0.01)
            self.cross(p, n, p2 - p, size, wfn)


def _swap(b: str) -> str:
    return b[:-2] + '_R' if b.endswith('_L') else (b[:-2] + '_L' if b.endswith('_R') else b)


def rigid(bone: str):
    return lambda co: {bone: 1.0}


def chain_w(bones: list[str], pts: list[Vector], width: float = 0.35):
    """Weights along a polyline of joints (len(pts) == len(bones) + 1), blended around interior joints."""
    segs = [(pts[i], pts[i + 1]) for i in range(len(bones))]

    def fn(co: Vector) -> dict:
        best, bi, bt = None, 0, 0.0
        for i, (a, b) in enumerate(segs):
            ab = b - a
            t = max(0.0, min(1.0, (co - a).dot(ab) / max(ab.length_squared, 1e-12)))
            d = (co - (a + ab * t)).length_squared
            if best is None or d < best:
                best, bi, bt = d, i, t
        w = {bones[bi]: 1.0}
        if bt < width and bi > 0:
            k = 0.5 * (1.0 - bt / width)
            w = {bones[bi]: 1.0 - k, bones[bi - 1]: k}
        elif bt > 1.0 - width and bi < len(bones) - 1:
            k = 0.5 * (1.0 - (1.0 - bt) / width)
            w = {bones[bi]: 1.0 - k, bones[bi + 1]: k}
        return w

    return fn


def bspline(ctrl: list[Vector], n: int) -> list[Vector]:
    """Clamped polyline smoothing: sample a Catmull-Rom curve through `ctrl` at n points."""
    pts = [ctrl[0]] + list(ctrl) + [ctrl[-1]]
    out = []
    segs = len(ctrl) - 1
    for k in range(n):
        u = k / (n - 1) * segs
        i = min(int(u), segs - 1)
        t = u - i
        p0, p1, p2, p3 = pts[i], pts[i + 1], pts[i + 2], pts[i + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                          + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
    return out


def on_ellipsoid(c: Vector, radii, d: Vector) -> tuple[Vector, Vector]:
    """Surface point and outward normal of an axis-aligned ellipsoid along unit-sphere direction d."""
    d = d.normalized()
    p = c + V((radii[0] * d.x, radii[1] * d.y, radii[2] * d.z))
    n = V((d.x / radii[0], d.y / radii[1], d.z / radii[2])).normalized()
    return p, n


def add_eyes(b: Builder, c: Vector, radii, dirs: tuple[Vector, Vector], r: float, bone: str) -> None:
    """Left (+X) then right eye. Undead: mismatched sizes and glows; normal: dark eye + highlight."""
    for side, d in enumerate(dirs):
        p, n = on_ellipsoid(c, radii, d)
        if b.undead:
            er = r * (1.32 if side == 0 else 0.84)
            mat = 'EyeGlowA' if side == 0 else 'EyeGlowB'
        else:
            er, mat = r, 'Eye'
        ec = p - n * (0.52 * er)
        b.add(lambda part: _ellipsoid(part, ec, (er, er, er), 10, 6, mat), rigid(bone))
        if not b.undead and not OPTS['low']:
            sc = ec + n * (0.80 * er) + V((0.0, 0.0, 0.34 * er)) + V((0.22 * er * (1 if side == 0 else -1), 0, 0))
            b.add(lambda part: _ellipsoid(part, sc, (0.26 * er,) * 3, 6, 4, 'Shine'), rigid(bone))


# ---------------------------------------------------------------------------------------------------
# Quadrupeds (cat, dog, raccoon)
# ---------------------------------------------------------------------------------------------------

def build_quad(rig: Rig, variant: str) -> mk.Part:
    sp = rig.sp
    b = Builder(OPTS['name'] or 'Pet_' + variant, rig, variant)
    H, L, bw, bh = sp['H'], sp['L'], sp['body_w'], sp['body_h']
    hb = rig.head['hips'].z
    yb, yf = L / 2, -L / 2
    y_r, y_f = torso_span(sp)
    mark = sp['mark']
    bm = 1.0
    scale = H / 0.17
    st = 0.017 * min(1.5, max(0.9, scale))          # stitch size

    def prof(u: float) -> float:
        return torso_profile(sp, u)

    def zc(u: float) -> float:
        return hb + 0.004 * math.sin(math.pi * u)

    def torso(u: float, th: float) -> tuple[Vector, Vector]:
        k = prof(u)
        p = V((bw * k * math.cos(th), lerp(y_r, y_f, u), zc(u) + bh * k * math.sin(th)))
        return p, V((math.cos(th) / bw, 0.0, math.sin(th) / bh)).normalized()

    patch_u, patch_th = (0.30, 0.58), (math.radians(12), math.radians(100))

    def torso_col(p: Vector):
        u = (y_r - p.y) / (y_r - y_f)
        th = math.atan2((p.z - zc(u)) / bh, p.x / bw)
        belly = smooth((hb - 0.30 * bh - p.z) / (0.35 * bh))
        k = 1.0
        if mark == 'tabby' and p.z > hb - 0.25 * bh:
            band = math.sin((p.y - yb) / L * math.pi * 7.0)
            k *= lerp(1.0, 0.55, smooth((band - 0.15) / 0.3) * smooth((p.z - hb + 0.25 * bh) / (0.45 * bh)))
        if mark == 'patch':
            saddle = smooth((p.z - hb - 0.15 * bh) / (0.4 * bh)) * smooth(1.0 - abs(u - 0.45) / 0.26)
            k *= lerp(1.0, 0.62, saddle)
        if b.undead and patch_u[0] < u < patch_u[1] and patch_th[0] < th < patch_th[1]:
            return mulc(UNDEAD_PATCH, 0.80)
        return b.col(k, belly)

    w1 = L / 4.5

    def torso_w(co: Vector) -> dict:
        t1 = smooth((L / 6 + w1 / 2 - co.y) / w1)
        t2 = smooth((-L / 6 + w1 / 2 - co.y) / w1)
        w = {'hips': 1.0 - t1, 'spine': t1 * (1.0 - t2), 'chest': t1 * t2}
        return {k: v for k, v in w.items() if v > 1e-4}

    path = [V((0.0, lerp(y_r, y_f, i / 8), zc(i / 8))) for i in range(9)]
    b.add(lambda part: _tube(part, path, lambda u, th: bh * prof(u), 14, 'Paint', up=Z, squash=(1.0, bw / bh),
                               colfn=torso_col, dome_steps=3), torso_w)

    # neck
    nb, hd = rig.head['neck'], rig.head['head']
    hr = sp['head']
    hc = hd + V((0.0, -0.45 * hr[1], 0.10 * hr[2]))
    npath = [nb + V((0, 0.022, -0.020)), nb.lerp(hd, 0.5) + V((0, 0.004, 0.0)), hd.lerp(hc, 0.5)]
    neck_w = chain_w(['chest', 'neck', 'head'], [npath[0], nb, hd, hc], 0.45)
    b.add(lambda part: _tube(part, npath, lambda u, th: sp['neck_r'] * lerp(1.12, 0.92, u), 10, 'Paint', up=FWD,
                               cap0=None, cap1=None, colfn=lambda p: b.col(1.0, smooth((nb.z - p.z) / 0.05))),
          neck_w)

    # head
    eye_d = [V((s * sp['eye_x'] / hr[0], -sp['eye_fwd'] / hr[1], sp['eye_up'] / hr[2])) for s in (1.0, -1.0)]
    eye_p = [on_ellipsoid(hc, hr, d)[0] for d in eye_d]
    snout_ry = 0.9 * sp['snout_len'] + 0.012
    sc = hc + V((0.0, -0.80 * hr[1] - 0.30 * sp['snout_len'], -0.22 * hr[2] - 0.4 * sp['snout_drop']))

    def head_col(p: Vector):
        k = bm
        muzzle = smooth(1.0 - (p - sc).length / (1.9 * sp['snout_r']))
        if mark == 'mask':
            band = max(smooth(1.25 - (p - e).length / (2.6 * sp['eye_r'])) for e in eye_p)
            bridge = smooth(1.0 - abs(p.z - eye_p[0].z) / (1.5 * sp['eye_r'])) * smooth((hc.y - 0.4 * hr[1] - p.y) / 0.02)
            k = lerp(k, 0.22, max(band, 0.85 * bridge * smooth(1.0 - abs(p.x) / (1.6 * sp['eye_x']))))
        elif mark == 'patch':
            k = lerp(k, 0.50, smooth(1.0 - (p - eye_p[0]).length / (3.0 * sp['eye_r'])))
        elif mark == 'tabby':
            if p.z > hc.z + 0.2 * hr[2]:
                stripe = math.sin(p.x / hr[0] * math.pi * 3.5)
                k *= lerp(1.0, 0.55, smooth((stripe - 0.3) / 0.3) * smooth((p.z - hc.z - 0.2 * hr[2]) / (0.4 * hr[2])))
        return b.col(k, muzzle)

    b.add(lambda part: _ellipsoid(part, hc, hr, 14, 10, 'Paint', colfn=head_col), rigid('head'))
    b.add(lambda part: _ellipsoid(part, sc, (sp['snout_r'], snout_ry, 0.78 * sp['snout_r']), 10, 6, 'Paint',
                                    colfn=head_col), rigid('head'))
    jc = sc + V((0.0, 0.006, -0.46 * sp['snout_r']))
    b.add(lambda part: _ellipsoid(part, jc, (0.74 * sp['snout_r'], 0.80 * snout_ry, 0.40 * sp['snout_r']), 8, 5,
                                    'Paint', colfn=lambda p: b.col(1.0, 1.0)), rigid('jaw'))
    nose = sc + V((0.0, -0.93 * snout_ry, 0.26 * sp['snout_r']))
    nr = sp['snout_r']
    if not OPTS['low']:
        b.add(lambda part: _ellipsoid(part, nose, (0.40 * nr, 0.26 * nr, 0.28 * nr), 8, 5, sp['nose']), rigid('head'))
    add_eyes(b, hc, hr, (eye_d[0], eye_d[1]), sp['eye_r'], 'head')

    # ears (left, mirrored)
    eb, et = rig.head['ear_L'], rig.tail['ear_L']
    ear_k = 0.50 if mark == 'patch' else (0.40 if mark == 'mask' else 0.86)

    def ear(part):
        if sp['ear'] == 'point':
            mid = eb.lerp(et, 0.5) + V((0.004, 0.0, 0.0))
            _tube(part, [eb + V((0, 0, -0.012)), mid, et], lambda u, th: sp['ear_w'] * 0.80 * (1 - u) ** 0.85 + 0.003, 8,
                    'Paint', up=FWD, squash=(0.36, 1.0), cap0=None, cap1='dome', colfn=lambda p: b.col(ear_k))
            mk.strip_quad(part, eb + V((0.002, -0.0125, 0.006)), eb.lerp(et, 0.66) + V((0.004, -0.0075, 0.0)), FWD,
                          0.50 * sp['ear_w'], 'Skin')
        elif sp['ear'] == 'round':
            c = eb.lerp(et, 0.55)
            _ellipsoid(part, c, (0.62 * sp['ear_w'], 0.011, 0.66 * sp['ear_h']), 8, 6, 'Paint',
                         colfn=lambda p: b.col(ear_k))
            _ellipsoid(part, c + V((0, -0.0065, -0.002)), (0.36 * sp['ear_w'], 0.006, 0.40 * sp['ear_h']), 8, 4, 'Skin')
        else:  # flop
            c = eb.lerp(et, 0.52)
            fr = Matrix.Rotation(math.radians(-14), 3, 'Y')
            _ellipsoid(part, c, (0.013, 0.56 * sp['ear_w'], 0.60 * sp['ear_h']), 8, 6, 'Paint', frame=fr,
                         colfn=lambda p: b.col(ear_k))

    if not sp.get('no_ears'):
        b.add_side(ear, rigid('ear_L'))

    # legs (left, mirrored)
    def leg(kind: str):
        up, lo, paw = (f'{x}_{kind}_L' for x in ('upper', 'lower', 'paw'))
        top, knee, ank = rig.head[up], rig.tail[up], rig.tail[lo]
        thigh = sp['hind_thigh'] if kind == 'H' else 1.22
        dark = 0.42 if mark == 'mask' else 1.0
        pr = sp['paw_r']

        def leg_col(p: Vector):
            if sp['socks']:
                return b.col(1.0, 1.0 - smooth((p.z - 0.30 * H) / (0.18 * H)))
            return b.col(dark)

        def build(part):
            _tube(part, [top + V((0, 0, 0.30 * bh)), top, knee, ank + V((0, 0, 0.004))],
                    lambda u, th: sp['leg_r'] * lerp(thigh, 0.96, smooth(u / 0.8)), 8, 'Paint', up=FWD,
                    cap0=None, cap1=None, colfn=leg_col)
            _ellipsoid(part, V((ank.x, ank.y - 0.50 * pr, 0.62 * pr)), (0.96 * pr, 1.36 * pr, 0.62 * pr), 8, 5,
                         'Paint', colfn=leg_col)

        wz = 0.24 * H
        parent = rig.parent[up]

        def w(co: Vector) -> dict:
            if co.z < 1.25 * pr and (co - V((ank.x, ank.y - 0.50 * pr, 0.62 * pr))).length < 1.6 * pr and co.z < ank.z + 0.012:
                k = smooth((co.z - 0.5 * ank.z) / max(ank.z, 1e-4))
                return {paw: 1.0 - 0.5 * k, lo: 0.5 * k} if k > 1e-3 else {paw: 1.0}
            if co.z > top.z:
                k = smooth((co.z - top.z) / (0.30 * bh))
                return {up: 1.0 - k, parent: k} if k > 1e-3 else {up: 1.0}
            k = smooth((knee.z + wz / 2 - co.z) / wz)
            return {kk: v for kk, v in {up: 1.0 - k, lo: k}.items() if v > 1e-4}

        b.add_side(build, w)

    leg('F')
    leg('H')

    # tail
    tb = [rig.head['tail_1'] - (rig.tail['tail_1'] - rig.head['tail_1']).normalized() * (0.9 * bw),
          rig.head['tail_1'], rig.tail['tail_1'], rig.tail['tail_2'], rig.tail['tail_3']]
    tpath = bspline(tb, 11)
    lens = [0.0]
    for i in range(1, len(tpath)):
        lens.append(lens[-1] + (tpath[i] - tpath[i - 1]).length)

    def tail_u(p: Vector) -> float:
        i = min(range(len(tpath)), key=lambda j: (tpath[j] - p).length_squared)
        return lens[i] / lens[-1]

    def tail_r(u: float, th: float) -> float:
        if mark == 'mask' or sp.get('bushy'):
            return sp['tail_r'] * (0.62 + 0.52 * math.sin(math.pi * (0.12 + 0.74 * u)))
        return lerp(sp['tail_r'], sp['tail_tip'], u ** 0.8)

    def tail_col(p: Vector):
        u = tail_u(p)
        k, light = 1.0, 0.0
        if mark == 'mask':
            k, light = (0.28, 0.0) if int(u * 7.0 + 0.5) % 2 == 1 else (1.0, 0.45)
        elif mark == 'tabby':
            k = 0.55 if int(u * 8.0) % 2 == 1 else 1.0
        elif mark == 'patch':
            light = smooth((u - 0.72) / 0.2)
        if b.undead and u > 0.62:
            return mulc(UNDEAD_PATCH, 0.80 * (0.6 if k < 0.6 else 1.0))
        return b.col(k, light)

    tail_w = chain_w(['hips', 'tail_1', 'tail_2', 'tail_3'], tb, 0.35)
    if not sp.get('no_tail'):
        b.add(lambda part: _tube(part, tpath, tail_r, 10 if mark == 'mask' else 8, 'Paint', up=Z, cap0=None,
                                   cap1='dome', colfn=tail_col), tail_w)

    if b.undead:
        two_pi = 2 * math.pi
        b.seam(lambda t: torso(0.86, t), 0.0, two_pi, 12, st, torso_w)                       # collar
        (u0, u1), (a0, a1) = patch_u, patch_th
        b.seam(lambda t: torso(t, a0), u0, u1, 4, st, torso_w)
        b.seam(lambda t: torso(t, a1), u0, u1, 4, st, torso_w)
        b.seam(lambda t: torso(u0, t), a0, a1, 4, st, torso_w)
        b.seam(lambda t: torso(u1, t), a0, a1, 4, st, torso_w)
        b.seam(lambda t: on_ellipsoid(hc, hr, V((math.sin(t), -0.30, math.cos(t)))), -0.62, 0.62, 5, st, rigid('head'))
    return b.part


# ---------------------------------------------------------------------------------------------------
# Crow
# ---------------------------------------------------------------------------------------------------

def build_bird(rig: Rig, variant: str) -> mk.Part:
    sp = rig.sp
    b = Builder(OPTS['name'] or 'Pet_' + variant, rig, variant)
    bw, bh, bl = sp['body_w'], sp['body_h'], sp['body_len']
    bm = 1.0
    hips, chest = rig.head['hips'], rig.tail['hips']
    fwd = (chest - hips).normalized()
    rump = rig.head['tail_1']
    hd = rig.head['head']
    hr = sp['head_r']
    hc = hd + V((0.0, -0.30 * hr, 0.22 * hr))
    radii = (0.94 * hr, 1.06 * hr, 0.96 * hr)
    st = 0.0085

    def prof(u: float) -> float:
        return 0.50 + 0.50 * math.sin(math.pi * (0.14 + 0.72 * u)) ** 0.8

    p0, p1 = rump - fwd * 0.004, chest + fwd * 0.012
    path = [p0.lerp(p1, i / 6) for i in range(7)]
    up_n = (Z - fwd * Z.dot(fwd)).normalized()
    side_n = V((1.0, 0.0, 0.0))

    def body(u: float, th: float) -> tuple[Vector, Vector]:
        k = prof(u)
        p = p0.lerp(p1, u) + side_n * (bw * k * math.cos(th)) + up_n * (bh * k * math.sin(th))
        return p, (side_n * (math.cos(th) / bw) + up_n * (math.sin(th) / bh)).normalized()

    def body_col(p: Vector):
        belly = smooth((hips.z - p.z) / (0.9 * bh))
        if b.undead:
            u = max(0.0, min(1.0, (p - p0).dot(p1 - p0) / (p1 - p0).length_squared))
            if 0.70 < u < 0.90:
                return mulc(UNDEAD_PATCH, 0.95)       # pale sewn-on collar so the dark stitches read
        if sp['mark'] != 'crow':
            return b.col(1.0, belly * sp.get('breast', 0.85))
        return b.col(lerp(bm, bm * 0.80, belly))

    b.add(lambda part: _tube(part, path, lambda u, th: bh * prof(u), 12, 'Paint', up=Z, squash=(1.0, bw / bh),
                               colfn=body_col, dome_steps=3), rigid('hips'))

    npath = [chest - fwd * 0.012 + V((0, 0, 0.006)), chest.lerp(hd, 0.55) + V((0, -0.003, 0)), hd.lerp(hc, 0.6)]
    b.add(lambda part: _tube(part, npath, lambda u, th: sp['neck_r'] * lerp(1.15, 0.95, u), 10, 'Paint', up=FWD,
                               cap0=None, cap1=None, colfn=lambda p: b.col(bm)),
          chain_w(['hips', 'neck', 'head'], [npath[0], chest, hd, hc], 0.45))
    b.add(lambda part: _ellipsoid(part, hc, radii, 12, 8, 'Paint', colfn=lambda p: b.col(bm)), rigid('head'))

    # beak: upper rigid to the head, lower on the jaw
    bk0 = hc + V((0.0, -0.80 * hr, -0.04 * hr))
    bk1 = bk0 + V((0.0, -sp['beak_len'], -0.007))
    b.add(lambda part: _tube(part, [bk0 + V((0, 0.012, 0)), bk0.lerp(bk1, 0.5) + V((0, 0, 0.002)), bk1],
                               lambda u, th: sp['beak_r'] * (1 - u) ** 0.75 + 0.0012, 8, 'Detail', up=Z,
                               squash=(0.78, 1.0), cap0=None, cap1='dome'), rigid('head'))
    j0, j1 = rig.head['jaw'], rig.tail['jaw']
    b.add(lambda part: _tube(part, [j0 + V((0, 0.010, 0)), j1], lambda u, th: 0.72 * sp['beak_r'] * (1 - u) ** 0.8 + 0.001,
                               8, 'Detail', up=Z, squash=(0.55, 1.0), cap0=None, cap1='dome'), rigid('jaw'))
    add_eyes(b, hc, radii, (V((0.86, -0.46, 0.22)), V((-0.86, -0.46, 0.22))), sp['eye_r'], 'head')
    if sp.get('ears'):                                               # bats
        eh = sp['ears']
        b.add_side(lambda part: _tube(part, [hc + V((0.45 * hr, 0.1 * hr, 0.6 * hr)), hc + V((0.75 * hr, 0.15 * hr, 0.6 * hr + eh))],
                                      lambda u, th: 0.42 * hr * (1 - u) ** 0.9 + 0.002, 6, 'Paint', up=FWD, squash=(0.35, 1.0),
                                      cap0=None, cap1='dome', colfn=lambda p: b.col(0.8)), rigid('head'))

    # wings (left, mirrored)
    w1h, w1t, w2t = rig.head['wing_1_L'], rig.tail['wing_1_L'], rig.tail['wing_2_L']

    def wing_col(p: Vector):
        u = max(0.0, min(1.0, (p - w1h).dot(w2t - w1h) / (w2t - w1h).length_squared))
        if b.undead and 0.30 < u < 0.62 and p.x > 0:
            return mulc(UNDEAD_PATCH, bm * 0.85)
        return b.col(lerp(bm * 0.92, bm * 0.66, smooth((u - 0.45) / 0.5)))

    def wing(part):
        _tube(part, [w1h - (w1t - w1h).normalized() * 0.012, w1t + V((0.004, 0, 0.004)), w2t],
                lambda u, th: sp['wing_h'] * 0.58 * (1 - 0.82 * u ** 1.5), 10, 'Paint', up=Z, squash=(1.0, 0.22),
                cap0='dome', cap1='dome', colfn=wing_col)

    b.add_side(wing, chain_w(['wing_1_L', 'wing_2_L'], [w1h, w1t, w2t], 0.4))

    # tail fan
    t0, t1 = rump + fwd * 0.014, rig.tail['tail_1']
    b.add(lambda part: _tube(part, [t0, t0.lerp(t1, 0.5), t1], lambda u, th: 0.017 + 0.016 * u, 10, 'Paint', up=Z,
                               squash=(0.20, 1.0), cap0=None, cap1='dome',
                               colfn=lambda p: b.col(lerp(bm * 0.9, bm * 0.66, smooth((p - t0).length / (t1 - t0).length)))),
          chain_w(['hips', 'tail_1'], [t0 - (t1 - t0) * 0.4, t0, t1], 0.5))

    # legs + toes (left, mirrored)
    up, lo, paw = 'upper_H_L', 'lower_H_L', 'paw_H_L'
    top, knee, ank = rig.head[up], rig.tail[up], rig.tail[lo]
    lr = sp['leg_r']

    def leg(part):
        _ellipsoid(part, top + V((0, 0.004, 0.004)), (0.015, 0.018, 0.022), 8, 5, 'Paint', colfn=lambda p: b.col(bm * 0.84))
        _tube(part, [top, knee, ank], lambda u, th: lr * lerp(1.5, 1.0, u), 6, 'Detail', up=FWD, cap0=None, cap1='dome')
        toes = ((0.0, -1.0), (0.42, -0.86), (-0.42, -0.86), (0.0, 0.62))
        for dx, dy in (toes[:1] if OPTS['low'] else toes):
            tip = V((ank.x + dx * sp['toe_len'], ank.y + dy * sp['toe_len'], 0.0036))
            _tube(part, [V((ank.x, ank.y, 0.0052)), tip], lambda u, th: lerp(0.0050, 0.0036, u), 5, 'Detail', up=Z,
                    cap0='dome', cap1='dome')

    def leg_w(co: Vector) -> dict:
        if co.z < ank.z - 0.001:
            return {paw: 1.0}
        if co.z > top.z - 0.004:
            return {up: 1.0}
        k = smooth((knee.z + 0.008 - co.z) / 0.016)
        return {kk: v for kk, v in {up: 1.0 - k, lo: k}.items() if v > 1e-4}

    b.add_side(leg, leg_w)

    if b.undead:
        b.seam(lambda t: body(0.80, t), 0.0, 2 * math.pi, 9, st, rigid('hips'))
        b.seam(lambda t: on_ellipsoid(hc, radii, V((math.sin(t), -0.25, math.cos(t)))), -0.6, 0.6, 4, st, rigid('head'))
    return b.part


def build_part(rig: Rig, variant: str, name: str | None = None, detail: float = 1.0, low: bool = False) -> mk.Part:
    """One skinned mesh. `name`, `detail` (segment-count scale) and `low` (drop tiny parts) are for other kits
    built on these bodies (wildlife); the defaults are the pets'."""
    OPTS.update(detail=detail, name=name, low=low)
    try:
        part = build_quad(rig, variant) if rig.plan == 'quad' else build_bird(rig, variant)
    finally:
        OPTS.update(detail=1.0, name=None, low=False)
    if len(part.weights) != len(part.co):
        raise RuntimeError(f'{part.name}: {len(part.co)} vertices but {len(part.weights)} weights')
    return part
