"""Head, neck, ears, mouth decal, teeth, brows (all in mesh 'Head') and the per-style eye meshes.

The head surface is an analytic radial function so decals (mouth, brows, stitches) and hair shells can be
projected onto it exactly. Expressions are authored as parameter changes of the decal/lid generators, so every
shape key is the exact target geometry (same topology) rather than hand-sculpted deltas.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

from .meshkit import Part, add_ring, ellipsoid, fan, grid, mul_col, tube
from .noise import clamp, smoothstep

V = Vector

HEAD_TOP = 1.62
HR = (0.168, 0.160, 0.178)            # head radii x, y(depth), z


# ------------------------------------------------------------------------------------------------ surface

def _gauss(x: float, s: float) -> float:
    return math.exp(-(x / s) ** 2)


def head_shape(d: Vector) -> float:
    """Radius multiplier for unit direction d (head-local == armature axes)."""
    dx, dy, dz = d.x, d.y, d.z
    front, back = max(0.0, -dy), max(0.0, dy)
    down, up = max(0.0, -dz), max(0.0, dz)
    s = 1.0
    s *= 1.0 - 0.10 * down ** 1.6 * (1.0 - 0.6 * back)          # narrower jaw / chin
    s *= 1.0 - 0.08 * front ** 4                                # flattened face plane
    s *= 1.0 - 0.07 * up ** 3                                   # slightly flat crown (chunky)
    s *= 1.0 + 0.045 * up * back + 0.02 * back                  # round back of skull
    s *= 1.0 + 0.065 * _gauss(dz + 0.30, 0.24) * front ** 1.2 * min(1.0, abs(dx) / 0.5)  # jowly cheeks
    s *= 1.0 - 0.03 * _gauss(dz - 0.18, 0.22) * abs(dx) ** 4     # temples
    return s


# head centre: placed so the (slightly flattened) crown is exactly at HEAD_TOP = 1.62 m, as the contract says
HC = V((0.0, -0.012, HEAD_TOP - HR[2] * head_shape(V((0.0, 0.0, 1.0)))))


def _ang(a: Vector, b: Vector) -> float:
    return math.acos(clamp(a.dot(b), -1.0, 1.0))


NOSE_DIR = V((0.004, -1.0, -0.13)).normalized()
CHIN_DIR = V((0.0, -0.80, -0.60)).normalized()


def head_disp(d: Vector) -> Vector:
    """Extra local displacement (nose, brow ridge, chin)."""
    out = V((0.0, 0.0, 0.0))
    a = _ang(d, NOSE_DIR)
    if a < 0.6:
        # slightly droopy, crooked little nose
        k = 0.038 * _gauss(a, 0.13)
        out += V((0.006, -1.0, -0.45)).normalized() * k
    # brow ridge band
    front = max(0.0, -d.y)
    out += d * (0.006 * _gauss(d.z - 0.26, 0.07) * front ** 3 * (1.0 - 0.6 * abs(d.x)))
    # chin
    out += d * (0.009 * _gauss(_ang(d, CHIN_DIR), 0.22))
    return out


def head_point(d: Vector) -> Vector:
    d = d.normalized()
    s = head_shape(d)
    p = V((d.x * HR[0] * s, d.y * HR[1] * s, d.z * HR[2] * s)) + head_disp(d)
    return HC + p


def dir_from_angles(az: float, el: float) -> Vector:
    """az: radians from the front (-Y) toward the character's left (+X); el: elevation (+ up)."""
    return V((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))


def surface(az: float, el: float, lift: float = 0.0) -> Vector:
    d = dir_from_angles(az, el)
    p = head_point(d)
    if lift:
        p = p + surface_normal(az, el) * lift
    return p


def surface_normal(az: float, el: float) -> Vector:
    e = 0.004
    p0 = head_point(dir_from_angles(az, el))
    pa = head_point(dir_from_angles(az + e, el))
    pe = head_point(dir_from_angles(az, el + e))
    n = (pa - p0).cross(pe - p0)
    if n.dot(p0 - HC) < 0:
        n = -n
    return n.normalized()


# ------------------------------------------------------------------------------------------------ head mesh

EYE_AZ = 0.36
EYE_EL = -0.03
MOUTH_EL = -0.56
MOUTH_HALF = 0.46


def build_head() -> Part:
    p = Part('Head')

    def colfn(q: Vector) -> tuple:
        # eye bags / sockets darker + bruise tint, under-jaw shading
        c = (1.0, 1.0, 1.0)
        for sx in (1, -1):
            e = surface(EYE_AZ * sx, EYE_EL - 0.17)
            dist = (q - e).length
            k = smoothstep(0.05, 0.0, dist) * 0.32
            c = (c[0] * (1 - k * 0.8), c[1] * (1 - k), c[2] * (1 - k * 0.55))
        under = smoothstep(HC.z - 0.06, HC.z - 0.17, q.z) * smoothstep(-0.02, 0.10, q.y + 0.06)
        k2 = under * 0.25
        c = (c[0] * (1 - k2), c[1] * (1 - k2), c[2] * (1 - k2 * 0.8))
        return c

    def shape(d: Vector) -> float:
        return head_shape(d)

    ellipsoid(p, HC, HR, 20, 14, 'Skin', shape=shape, disp=head_disp, colfn=colfn, tag='head')

    # ---- neck (flared into the upper chest so scoop necklines show skin)
    def neck_r(u: float, th: float) -> float:
        base = 0.057 + 0.006 * math.sin(u * math.pi)
        flare = smoothstep(0.55, 1.0, u) * 0.035
        return base + flare

    neck_path = [V((0.0, 0.006, 1.37)), V((0.0, 0.006, 1.30)), V((0.0, 0.008, 1.22)), V((0.0, 0.006, 1.15)),
                 V((0.0, 0.004, 1.11))]
    tube(p, neck_path, neck_r, 10, 'Skin', up=V((0, -1, 0)), squash=(1.0, 0.92), cap0=None, cap1='fan',
         cap_depth1=0.01, colfn=lambda q: (0.92, 0.92, 0.92), tag='neck')

    # ---- ears (left one bitten)
    for sx in (1, -1):
        az = (math.pi / 2 + 0.06) * sx
        root = surface(az, -0.06)
        nrm = surface_normal(az, -0.06)
        start = len(p.co)
        fr = Matrix.Rotation(math.radians(-18 * sx), 3, 'Y') @ Matrix.Rotation(math.radians(12), 3, 'X')
        ellipsoid(p, root + nrm * 0.008 + V((0, 0.006, 0.0)), (0.015, 0.034, 0.05), 7, 5, 'Skin', frame=fr,
                  colfn=lambda q: (0.86, 0.8, 0.82), tag='ear')
        if sx == 1:  # notch
            for i in range(start, len(p.co)):
                q = p.co[i]
                top = V((root.x, root.y - 0.004, root.z + 0.035))
                dd = (q - top).length
                if dd < 0.02:
                    p.co[i] = q + (V((0, 0, -1)) * (0.02 - dd) * 0.9)

    mouth_build(p)
    brows_build(p)
    return p


# ------------------------------------------------------------------------------------------------ mouth

MOUTH_COLS = 13


class MouthShape:
    """Parametric mouth: centre line curve + opening height per column (u in [-1,1])."""

    def __init__(self, width=1.0, smile=0.0, open_=0.0, round_=0.0, skew=0.0, sneer=0.0, tilt=0.0,
                 lift=0.0, press=0.0, teeth_show=0.0):
        self.width, self.smile, self.open, self.round = width, smile, open_, round_
        self.skew, self.sneer, self.tilt, self.lift, self.press = skew, sneer, tilt, lift, press
        self.teeth_show = teeth_show

    def rows(self, u: float) -> tuple[float, float]:
        """Return (upper_el, lower_el) elevation offsets (radians) for column u."""
        w = self.width
        uu = u
        # base line: gentle lopsided frown (zombie), smile bends corners
        line = -0.012 * uu * uu + 0.01 * uu * 0.4
        line += self.smile * 0.095 * (uu * uu) - self.smile * 0.012
        line += self.tilt * 0.05 * uu
        line += self.lift * 0.03
        prof = max(0.0, 1.0 - uu * uu) ** 0.7
        h = 0.010 * prof + self.open * 0.16 * max(0.0, 1.0 - uu * uu) ** 0.9
        h += self.round * 0.12 * max(0.0, 1.0 - (uu / 0.62) ** 2) ** 0.5 if abs(uu) < 0.62 else 0.0
        h *= (1.0 - 0.75 * self.press)
        up = line + h * 0.30
        lo = line - h * 0.70
        # sneer lifts the upper lip on the left side
        up += self.sneer * 0.045 * smoothstep(-0.1, 0.8, uu) * prof
        return up, lo

    def az(self, u: float) -> float:
        w = self.width * (1.0 - 0.38 * self.round) * (1.0 - 0.2 * self.press)
        return (u * MOUTH_HALF * w) + self.skew * 0.06


MOUTH_SHAPES = {
    'neutral': MouthShape(),
    'blink': MouthShape(),
    'talk': MouthShape(open_=0.75, width=0.92),
    'happy': MouthShape(smile=1.35, width=1.12, open_=0.24),
    'sad': MouthShape(smile=-1.2, width=0.84, open_=0.06),
    'angry': MouthShape(smile=-0.62, open_=0.38, width=1.06, teeth_show=1.0, press=0.0),
    'sleepy': MouthShape(open_=0.22, width=0.78, smile=-0.15, skew=-0.25),
    'disgusted': MouthShape(smile=-0.45, sneer=1.0, width=0.95, tilt=0.4, open_=0.12),
    'flirty': MouthShape(smile=0.45, tilt=0.55, width=0.9, skew=0.5),
    'shocked': MouthShape(round_=1.0, open_=0.42, width=0.95),
    'focused': MouthShape(press=1.0, width=0.82, skew=-0.55, smile=-0.25),
}


def _mouth_positions(ms: MouthShape) -> list[Vector]:
    out = []
    for row in range(3):
        for c in range(MOUTH_COLS):
            u = -1.0 + 2.0 * c / (MOUTH_COLS - 1)
            up, lo = ms.rows(u)
            el = MOUTH_EL + (up if row == 0 else (up + lo) * 0.5 if row == 1 else lo)
            out.append(surface(ms.az(u), el, 0.0028))
    return out


TEETH = [(-0.30, 1.0, 0.016, -0.08), (0.20, 0.8, 0.013, 0.12)]  # (u, scale, length, tilt)


def _teeth_positions(ms: MouthShape) -> list[Vector]:
    """Two crooked upper teeth hanging from the upper lip line (8 verts each)."""
    out = []
    for (u, sc, ln, tilt) in TEETH:
        up, lo = ms.rows(u)
        az = ms.az(u)
        el_top = MOUTH_EL + up + 0.012
        top = surface(az, el_top, 0.0034)
        nrm = surface_normal(az, el_top)
        dn = (surface(az, el_top - 0.1, 0.0) - surface(az, el_top, 0.0)).normalized()
        side = nrm.cross(dn).normalized()
        dn = (dn + side * tilt).normalized()
        length = ln * (1.0 + 0.6 * ms.teeth_show) * sc
        hw = 0.0062 * sc
        corners = []
        for depth in (0.0, -0.0035):
            for (s_, d_) in ((-1, 0), (1, 0), (0.75, 1), (-0.75, 1)):
                corners.append(top + side * (hw * s_) + dn * (length * d_) + nrm * depth)
        out.extend(corners)
    return out


def mouth_build(p: Part) -> None:
    base = MOUTH_SHAPES['neutral']
    pos = _mouth_positions(base)
    start = len(p.co)
    for q in pos:
        p.v(q, (1.0, 1.0, 1.0), 0.0, 'mouth')
    rows = [list(range(start + r * MOUTH_COLS, start + (r + 1) * MOUTH_COLS)) for r in range(3)]
    # rows are top->bottom; the decal must face outward (+normal): connect bottom->top
    for r in range(2):
        a, b = rows[r + 1], rows[r]
        for j in range(MOUTH_COLS - 1):
            p.f((a[j], a[j + 1], b[j + 1], b[j]), 'Mouth')
    tstart = len(p.co)
    for q in _teeth_positions(base):
        p.v(q, (1.0, 1.0, 1.0), 0.0, 'teeth')
    for t in range(len(TEETH)):
        o = tstart + t * 8
        front = [o + 0, o + 1, o + 2, o + 3]
        back = [o + 4, o + 5, o + 6, o + 7]
        p.f((front[0], front[3], front[2], front[1]), 'Teeth')
        for k in range(4):
            k2 = (k + 1) % 4
            p.f((front[k], front[k2], back[k2], back[k]), 'Teeth')
    p._mouth_range = (start, start + 3 * MOUTH_COLS)
    p._teeth_range = (tstart, tstart + 8 * len(TEETH))


# ------------------------------------------------------------------------------------------------ brows

BROW_COLS = 6


class BrowShape:
    def __init__(self, inner=0.0, outer=0.0, raise_=0.0, squeeze=0.0, thick=1.0):
        self.inner, self.outer, self.raise_, self.squeeze, self.thick = inner, outer, raise_, squeeze, thick


BROW_SHAPES = {
    'neutral': ({'L': BrowShape(inner=0.02), 'R': BrowShape(inner=0.0, outer=-0.01)}),
    'blink': ({'L': BrowShape(raise_=-0.03), 'R': BrowShape(raise_=-0.03)}),
    'talk': ({'L': BrowShape(raise_=0.03), 'R': BrowShape(raise_=0.02)}),
    'happy': ({'L': BrowShape(raise_=0.08, inner=0.03, outer=0.0), 'R': BrowShape(raise_=0.08, inner=0.03)}),
    'sad': ({'L': BrowShape(inner=0.19, outer=-0.06, raise_=0.01), 'R': BrowShape(inner=0.19, outer=-0.06)}),
    'angry': ({'L': BrowShape(inner=-0.20, outer=0.06, squeeze=0.05), 'R': BrowShape(inner=-0.20, outer=0.06,
                                                                                    squeeze=0.05)}),
    'sleepy': ({'L': BrowShape(raise_=-0.05, outer=-0.04), 'R': BrowShape(raise_=-0.05, outer=-0.04)}),
    'disgusted': ({'L': BrowShape(inner=-0.10, raise_=-0.03, squeeze=0.02), 'R': BrowShape(raise_=0.05, inner=0.05)}),
    'flirty': ({'L': BrowShape(raise_=0.10, outer=0.03), 'R': BrowShape(raise_=-0.02, inner=-0.03)}),
    'shocked': ({'L': BrowShape(raise_=0.20, inner=0.05), 'R': BrowShape(raise_=0.20, inner=0.05)}),
    'focused': ({'L': BrowShape(inner=-0.07, raise_=-0.03, squeeze=0.03), 'R': BrowShape(inner=-0.06,
                                                                                     raise_=-0.03, squeeze=0.03)}),
}


def _brow_positions(shapes: dict) -> list[Vector]:
    out = []
    for side in ('L', 'R'):
        sx = 1 if side == 'L' else -1
        bs: BrowShape = shapes[side]
        for row in range(2):
            for c in range(BROW_COLS):
                u = c / (BROW_COLS - 1)  # 0 = inner, 1 = outer
                az = sx * (EYE_AZ - 0.19 + u * 0.40 - bs.squeeze * (1 - u))
                el = 0.30 + bs.raise_ + bs.inner * (1 - u) + bs.outer * u - 0.05 * (u - 0.45) ** 2
                th = (0.060 - 0.026 * u) * bs.thick
                el += th * (0.5 if row == 0 else -0.5)
                out.append(surface(az, el, 0.0042))
    return out


def brows_build(p: Part) -> None:
    pos = _brow_positions(BROW_SHAPES['neutral'])
    start = len(p.co)
    for q in pos:
        p.v(q, (1.0, 1.0, 1.0), 0.0, 'brow')
    for s in range(2):
        o = start + s * 2 * BROW_COLS
        top = list(range(o, o + BROW_COLS))
        bot = list(range(o + BROW_COLS, o + 2 * BROW_COLS))
        for j in range(BROW_COLS - 1):
            quad = (bot[j], bot[j + 1], top[j + 1], top[j])
            if s == 1:  # mirrored side flips winding
                quad = quad[::-1]
            p.f(quad, 'Mouth')
    p._brow_range = (start, start + 4 * BROW_COLS)


# ------------------------------------------------------------------------------------------------ head keys

def _jaw_zone(q: Vector) -> float:
    """0..1 how much a head vertex belongs to the lower jaw/chin."""
    mouth_z = surface(0.0, MOUTH_EL).z
    below = smoothstep(mouth_z + 0.004, mouth_z - 0.03, q.z)
    frontness = smoothstep(0.03, -0.09, q.y)
    return below * frontness


def head_shape_keys(p: Part) -> None:
    """Fill p.keys for every FACE_MORPH (exact decal targets + soft facial deformation)."""
    from .consts import FACE_MORPHS
    ms0, ts0 = p._mouth_range, p._teeth_range
    bs0 = p._brow_range
    base_m = _mouth_positions(MOUTH_SHAPES['neutral'])
    base_t = _teeth_positions(MOUTH_SHAPES['neutral'])
    for name in FACE_MORPHS:
        co = [c.copy() for c in p.co]
        ms = MOUTH_SHAPES.get(name, MOUTH_SHAPES['neutral'])
        mpos = _mouth_positions(ms)
        tpos = _teeth_positions(ms)
        bpos = _brow_positions(BROW_SHAPES.get(name, BROW_SHAPES['neutral']))
        for i, q in enumerate(mpos):
            co[ms0[0] + i] = q
        for i, q in enumerate(tpos):
            co[ts0[0] + i] = q
        for i, q in enumerate(bpos):
            co[bs0[0] + i] = q
        # soft deformation of the skull surface around the mouth: follow mean lower-lip motion in the jaw zone
        dl = V((0, 0, 0))
        for c in range(MOUTH_COLS):
            dl += mpos[2 * MOUTH_COLS + c] - base_m[2 * MOUTH_COLS + c]
        dl /= MOUTH_COLS
        cheek_up = {'happy': 0.009, 'flirty': 0.004, 'disgusted': 0.005, 'angry': 0.002}.get(name, 0.0)
        for i in range(len(p.co)):
            tag = p.tag[i]
            if tag not in ('head',):
                continue
            q = p.co[i]
            jz = _jaw_zone(q)
            if jz > 0 and dl.length > 1e-6:
                co[i] = co[i] + dl * jz * 0.85
            if cheek_up:
                for sx in (1, -1):
                    if name == 'flirty' and sx == -1:
                        continue
                    if name == 'disgusted' and sx == -1:
                        continue
                    ck = surface(0.36 * sx, -0.38)
                    k = smoothstep(0.05, 0.0, (q - ck).length)
                    co[i] = co[i] + V((0, -0.3, 1.0)).normalized() * cheek_up * k
            if name == 'disgusted':
                nz = surface(0.05, -0.12)
                k = smoothstep(0.035, 0.0, (q - nz).length)
                co[i] = co[i] + V((0, 0.1, 1.0)) * 0.004 * k
        p.keys[name] = co


# ------------------------------------------------------------------------------------------------ eyes

class EyeStyle:
    def __init__(self, r_l, r_r, up_l, up_r, lo_l=-58.0, lo_r=-58.0, tilt=6.0, iris=0.58, pupil=0.42,
                 drop_r=0.0, gaze_r=(0.0, 0.0), dark_iris=False):
        self.r = {'L': r_l, 'R': r_r}
        self.up = {'L': up_l, 'R': up_r}
        self.lo = {'L': lo_l, 'R': lo_r}
        self.tilt, self.iris, self.pupil = tilt, iris, pupil
        self.drop = {'L': 0.0, 'R': drop_r}
        self.gaze = {'L': (0.0, 0.0), 'R': gaze_r}
        self.dark_iris = dark_iris


EYE_STYLE_DEFS = {
    'droopy': EyeStyle(0.037, 0.037, 10.0, 10.0, tilt=7.0),
    'wide': EyeStyle(0.041, 0.041, 44.0, 44.0, lo_l=-66, lo_r=-66, tilt=0.0, iris=0.5, pupil=0.4),
    'mismatched': EyeStyle(0.043, 0.030, 30.0, 4.0, lo_l=-62, lo_r=-50, tilt=4.0, iris=0.55, drop_r=0.012,
                           gaze_r=(9.0, -4.0)),
    'sleepy': EyeStyle(0.036, 0.036, -10.0, -10.0, lo_l=-42, lo_r=-42, tilt=3.0),
    'beady': EyeStyle(0.025, 0.025, 40.0, 40.0, lo_l=-70, lo_r=-70, tilt=0.0, iris=0.78, pupil=0.62,
                      dark_iris=True),
}

# Expression lid modifiers: (d_upper, d_tilt, d_lower, iris_scale, absolute_close)
LID_EXPR = {
    'blink': None,
    'talk': (3.0, 0.0, 0.0, 1.0),
    'happy': (4.0, -6.0, 30.0, 1.0),
    'sad': (-6.0, 16.0, -2.0, 1.05),
    'angry': (-10.0, -22.0, 12.0, 0.95),
    'sleepy': (-24.0, 2.0, 8.0, 1.0),
    'disgusted': (-14.0, -8.0, 22.0, 0.95),
    'flirty': (-6.0, -4.0, 6.0, 1.0),
    'shocked': (30.0, 0.0, -12.0, 0.72),
    'focused': (-10.0, -9.0, 14.0, 0.9),
}
# how much each expression already closes the lids (runtime scales blink by 1 - closure)
LID_CLOSURE = {'sleepy': 0.5, 'focused': 0.25, 'disgusted': 0.3, 'angry': 0.2, 'happy': 0.3, 'flirty': 0.2}

LID_SEGS = 7
EYE_SEGS = 8
IRIS_SEGS = 10


def _eye_frame(side: str, st: EyeStyle):
    sx = 1 if side == 'L' else -1
    az = EYE_AZ * sx
    el = EYE_EL - st.drop[side] * 2.0
    s = surface(az, el)
    n = surface_normal(az, el)
    r = st.r[side]
    center = s - n * (r * 0.42)
    f = (n * 0.35 + V((0, -1, 0)) * 0.65).normalized()
    up = V((0, 0, 1))
    side_v = up.cross(f).normalized()  # points to the character's right when f = -Y?  (0,0,1)x(0,-1,0)=(1,0,0)
    up = f.cross(side_v).normalized()
    return center, f, up, side_v, r, sx


def _sph(center, f, up, sv, rad, lon_deg, lat_deg):
    lo, la = math.radians(lon_deg), math.radians(lat_deg)
    return center + (f * (math.cos(la) * math.cos(lo)) + sv * (math.cos(la) * math.sin(lo)) + up * math.sin(la)) * rad


def _lid_positions(side, st: EyeStyle, upper_deg, lower_deg, tilt_deg):
    """Upper + lower lid shell vertices: rows from the edge (lash line) back into the head."""
    center, f, up, sv, r, sx = _eye_frame(side, st)
    tilt = math.radians(tilt_deg * sx)  # positive tilt = inner corner up (towards the nose)
    rot = Matrix.Rotation(-tilt, 3, f)
    u2, sv2 = rot @ up, rot @ sv
    out = []
    for lid, edge, top in (('U', upper_deg, 88.0), ('L', lower_deg, -88.0)):
        rad = r * (1.13 if lid == 'U' else 1.09)
        lats = [edge + (top - edge) * t for t in ((0.0, 0.4, 1.0) if lid == 'U' else (0.0, 1.0))]
        for ri, la in enumerate(lats):
            for j in range(LID_SEGS + 1):
                lo = -100.0 + 200.0 * j / LID_SEGS
                bend = 6.0 * (1.0 - (lo / 100.0) ** 2) if lid == 'U' else -4.0 * (1.0 - (lo / 100.0) ** 2)
                out.append(_sph(center, f, u2, sv2, rad * (0.985 if ri == 0 else 1.0), lo, la + (bend if ri == 0 else 0)))
        # inner rim row (lid thickness, tucked toward the eyeball)
        for j in range(LID_SEGS + 1):
            lo = -100.0 + 200.0 * j / LID_SEGS
            bend = 6.0 * (1.0 - (lo / 100.0) ** 2) if lid == 'U' else -4.0 * (1.0 - (lo / 100.0) ** 2)
            out.append(_sph(center, f, u2, sv2, r * 1.015, lo, edge + bend + (-3.0 if lid == 'U' else 3.0)))
    return out


def _iris_positions(side, st: EyeStyle, scale=1.0):
    center, f, up, sv, r, sx = _eye_frame(side, st)
    gx, gy = st.gaze[side]
    # aim irises straight ahead (-Y) with optional lazy-eye offset
    g = V((0, -1, 0))
    g = (Matrix.Rotation(math.radians(gx * sx), 3, 'Z') @ Matrix.Rotation(math.radians(gy), 3, 'X') @ g).normalized()
    up2 = (V((0, 0, 1)) - g * g.z).normalized()
    sv2 = up2.cross(g).normalized()
    ir = st.iris * scale
    out = [center + g * (r * 1.004)]
    for k, frac in enumerate((st.pupil, 1.0)):
        ang = math.asin(min(0.95, ir * frac))
        for j in range(IRIS_SEGS):
            th = 2 * math.pi * j / IRIS_SEGS
            d = (g * math.cos(ang) + (up2 * math.cos(th) + sv2 * math.sin(th)) * math.sin(ang))
            out.append(center + d * (r * 1.004))
    return out


def build_eyes(style: str) -> Part:
    st = EYE_STYLE_DEFS[style]
    p = Part('Eyes_' + style)
    p.no_build = True
    p._lid_ranges = {}
    p._iris_ranges = {}
    for side in ('L', 'R'):
        center, f, up, sv, r, sx = _eye_frame(side, st)
        # eyeball: front dome (white), slightly squashed in depth
        fr = Matrix((sv, up, f)).transposed()  # columns: x=sv, y=up, z=f  -> local Z = forward
        ellipsoid(p, center, (r, r * 1.04, r * 0.92), EYE_SEGS, 4, 'EyeWhite', frame=fr,
                  lat_range=(-0.25, math.pi / 2), cap_bottom=False, colfn=lambda q: (0.97, 0.97, 0.92), tag='eyeball')
        # iris + pupil (vertex colour pupil)
        ip = _iris_positions(side, st)
        i0 = len(p.co)
        dark = (0.10, 0.08, 0.08)
        ring_cols = [dark, (1.0, 1.0, 1.0) if not st.dark_iris else (0.35, 0.3, 0.3)]
        p.v(ip[0], dark, 0.0, 'iris')
        rings = []
        for k in range(2):
            row = [p.v(ip[1 + k * IRIS_SEGS + j], ring_cols[k], 0.0, 'iris') for j in range(IRIS_SEGS)]
            rings.append(row)
        fan(p, rings[0], i0, 'Iris')
        grid(p, rings, 'Iris')
        p._iris_ranges[side] = (i0, len(p.co))
        # lids
        lp = _lid_positions(side, st, st.up[side], st.lo[side], st.tilt)
        l0 = len(p.co)
        n = LID_SEGS + 1
        # upper lid rows: 4 shell rows + rim row ; lower likewise
        idx = 0
        for lid in ('U', 'L'):
            shell = []
            for ri in range(3 if lid == 'U' else 2):
                lash = ri == 0
                col = (0.30, 0.26, 0.28) if lash else (0.95, 0.93, 0.93)
                if lid == 'L' and lash:
                    col = (0.62, 0.55, 0.58)
                shell.append([p.v(lp[idx + j], col, 0.0, 'lid' + lid) for j in range(n)])
                idx += n
            rim = [p.v(lp[idx + j], (0.30, 0.26, 0.28) if lid == 'U' else (0.6, 0.52, 0.55), 0.0, 'lid' + lid)
                   for j in range(n)]
            idx += n
            rows = [rim] + shell
            flip = (lid == 'L')
            if side == 'R':
                flip = not flip
            grid(p, rows, 'Skin', close_u=False, flip=not flip)
        p._lid_ranges[side] = (l0, len(p.co))
    return p


def eye_shape_keys(p: Part, style: str) -> None:
    from .consts import FACE_MORPHS
    st = EYE_STYLE_DEFS[style]
    for name in FACE_MORPHS:
        co = [c.copy() for c in p.co]
        for side in ('L', 'R'):
            up, lo, tilt = st.up[side], st.lo[side], st.tilt
            iris_scale = 1.0
            mod = LID_EXPR.get(name)
            if name == 'blink':
                up, lo, tilt = -34.0, -36.0, 0.0
            elif mod is not None:
                du, dt, dl, iris_scale = mod
                if name == 'flirty' and side == 'L':
                    du, dl = -30.0, 20.0  # a lazy half-wink
                if name == 'disgusted' and side == 'R':
                    du, dl = du * 0.4, dl * 0.4
                up = clamp(up + du, -30.0, 70.0)
                lo = clamp(lo + dl, -80.0, -20.0)
                if up - lo < 8:
                    up = lo + 8
                tilt = tilt + dt
            lp = _lid_positions(side, st, up, lo, tilt)
            a, b = p._lid_ranges[side]
            for i in range(a, b):
                co[i] = lp[i - a]
            if iris_scale != 1.0:
                ip = _iris_positions(side, st, iris_scale)
                a, b = p._iris_ranges[side]
                for i in range(a, b):
                    co[i] = ip[i - a]
        p.keys[name] = co


# ------------------------------------------------------------------------------------------------ weights

def head_weights(co: Vector, tag: str) -> dict:
    """Head/jaw/neck/chest weights for every vertex of the Head mesh."""
    if tag == 'neck':
        t1 = smoothstep(1.17, 1.23, co.z)
        t2 = smoothstep(1.29, 1.34, co.z)
        return {'chest': 1.0 - t1, 'neck': t1 * (1.0 - t2), 'head': t1 * t2}
    if tag in ('mouth',):
        mouth_z = surface(0.0, MOUTH_EL).z
        t = smoothstep(mouth_z + 0.006, mouth_z - 0.008, co.z)
        return {'head': 1.0 - t, 'jaw': t}
    if tag in ('teeth', 'brow', 'ear'):
        return {'head': 1.0}
    jz = _jaw_zone(co)
    w = {'head': 1.0 - jz, 'jaw': jz}
    # bottom of the skull blends into the neck so nods bend smoothly
    nb = smoothstep(HC.z - 0.10, HC.z - 0.19, co.z) * smoothstep(-0.05, 0.06, co.y)
    if nb > 0:
        w = {k: v * (1 - nb * 0.5) for k, v in w.items()}
        w['neck'] = nb * 0.5
    return w
