"""Accessories (Acc_<name>, material 'Accessory' = near-white base x vertex colours)."""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

from .clothing import FRONT, garment_point
from .face import EYE_AZ, EYE_EL, HC, HR, _eye_frame, EYE_STYLE_DEFS, surface, surface_normal
from .hair import SHELL_TAG, hair_point, shell
from .meshkit import Part, add_ring, ellipsoid, fan, grid, mul_col, rounded_box, tube
from .consts import hex_lin
from .noise import smoothstep
from .weights import torso_weights

V = Vector
# vertex colours are LINEAR multipliers of the near-white Accessory base
DARK_FRAME = hex_lin('#2a2226')
WINE = hex_lin('#7a2636')
BONE = hex_lin('#e8e0c8')
RUST = hex_lin('#b0602f')
PARCH = hex_lin('#ddd2b6')
LEATHER = hex_lin('#2e2422')
MOSS = hex_lin('#6f8f5e')


def _head(p: Part) -> Part:
    p.weight_fn = lambda co, tag: {'head': 1.0}
    p.no_build = True
    return p


def ring_path(center: Vector, n: Vector, up: Vector, r: float, count: int) -> list[Vector]:
    n = n.normalized()
    a = (up - n * up.dot(n)).normalized()
    b = n.cross(a)
    return [center + (a * math.cos(2 * math.pi * k / count) + b * math.sin(2 * math.pi * k / count)) * r
            for k in range(count)]


def closed_tube(p: Part, pts: list[Vector], r: float, sides: int, mat: str, col, tag: str = 'acc') -> None:
    pts = pts + [pts[0], pts[1]]
    rows = []
    n = len(pts) - 2
    for i in range(n + 1):
        prev, nxt = pts[i - 1] if i > 0 else pts[n - 1], pts[i + 1]
        t = (nxt - prev).normalized()
        nn = V((0, 0, 1))
        nn = (nn - t * nn.dot(t))
        if nn.length < 1e-6:
            nn = V((1, 0, 0))
        nn.normalize()
        b = t.cross(nn)
        ring = [pts[i] + (nn * math.cos(2 * math.pi * j / sides) + b * math.sin(2 * math.pi * j / sides)) * r
                for j in range(sides)]
        rows.append(add_ring(p, ring, col=col, tag=tag))
    grid(p, rows, mat)


def acc_glasses() -> Part:
    p = Part('Acc_glasses')
    st = EYE_STYLE_DEFS['droopy']
    centers = []
    for side in ('L', 'R'):
        c, f, up, sv, r, sx = _eye_frame(side, st)
        lens_c = c + V((0, -1, 0)) * 0.05 + V((0, 0, 0.002))
        centers.append(lens_c)
        closed_tube(p, ring_path(lens_c, V((0, -1, 0)), V((0, 0, 1)), 0.038, 9), 0.005, 3, 'Accessory', DARK_FRAME)
        # temple arm back to the ear
        sxv = 1 if side == 'L' else -1
        ear = surface(sxv * (math.pi / 2 + 0.05), 0.0, 0.006)
        start = lens_c + V((0.038 * sxv, 0, 0.004))
        tube(p, [start, (start + ear) * 0.5 + V((0.012 * sxv, 0, 0.004)), ear], 0.004, 4, 'Accessory',
             cap0='fan', cap1='fan', cap_depth0=0.0, cap_depth1=0.0, colfn=lambda q: DARK_FRAME, tag='acc')
    a, b = centers
    mid = (a + b) * 0.5 + V((0, -0.004, 0.01))
    tube(p, [a + V((-0.036, 0, 0.006)), mid, b + V((0.036, 0, 0.006))], 0.0042, 4, 'Accessory', cap0='fan', cap1='fan',
         cap_depth0=0.0, cap_depth1=0.0, colfn=lambda q: DARK_FRAME, tag='acc')
    return _head(p)


def acc_bowtie() -> Part:
    p = Part('Acc_bowtie')
    c = garment_point(FRONT, 1.19, 0.032)
    for sx in (1, -1):
        fr = Matrix.Rotation(math.radians(8 * sx), 3, 'Y')
        ellipsoid(p, c + V((0.032 * sx, 0, 0)), (0.032, 0.012, 0.022), 6, 4, 'Accessory', frame=fr,
                  colfn=lambda q: WINE, tag='acc', shape=lambda d: 1.0 - 0.35 * max(0.0, -d.x * (1 if sx > 0 else -1)))
    ellipsoid(p, c + V((0, -0.006, 0)), (0.011, 0.012, 0.013), 6, 4, 'Accessory', colfn=lambda q: mul_col(WINE, 0.75),
              tag='acc')
    p.weight_fn = lambda co, tag: {'chest': 0.7, 'neck': 0.3}
    p.no_build = True
    return p


def acc_necklace() -> Part:
    p = Part('Acc_necklace')
    pts = []
    for k in range(10):
        th = 2 * math.pi * k / 10
        drop = 0.05 * smoothstep(1.2, 0.0, abs(((th - FRONT + math.pi) % (2 * math.pi)) - math.pi))
        pts.append(garment_point(th, 1.185 - drop, 0.034))
    closed_tube(p, pts, 0.0038, 3, 'Accessory', hex_lin('#4a3a30'))
    # teeth & beads hanging at the front
    for k, dth in enumerate((-0.3, 0.0, 0.3)):
        th = FRONT + dth
        drop = 0.05 * smoothstep(1.2, 0.0, abs(dth))
        q = garment_point(th, 1.18 - drop, 0.04)
        if k % 2 == 0:
            tube(p, [q, q + V((0, -0.006, -0.028))], lambda u, t: 0.007 * (1 - 0.8 * u), 5, 'Accessory', cap0='dome',
                 cap1='fan', cap_depth0=0.004, cap_depth1=0.0, colfn=lambda c: BONE, tag='acc', dome_steps=1)
        else:
            ellipsoid(p, q + V((0, -0.002, -0.008)), (0.009, 0.009, 0.009), 6, 4, 'Accessory',
                      colfn=lambda c: MOSS, tag='acc')
    p.weight_fn = lambda co, tag: {'chest': 1.0}
    p.no_build = True
    return p


def _beanie_edge(az: float) -> float:
    """Bottom of the cuff: just above the brows at the front, over the tops of the ears, low on the nape."""
    a = abs(az)
    return 0.34 - 0.24 * smoothstep(0.5, 1.45, a) - 0.30 * smoothstep(1.9, 3.0, a)


BEANIE_COLS = 16
CUFF_EL = 0.17          # cuff height (elevation span)


def acc_beanie() -> Part:
    """Slouchy knit beanie roomy enough to cover every visible hair style's crown: a ribbed cuff folded up (only
    ~6 mm proud of the cap, so it reads as a cuff, never a brim), a knitted body slouching toward the back of the
    crown, and a bone-white pom-pom on the slouch."""
    p = Part('Acc_beanie')
    cols = BEANIE_COLS
    azs = [-math.pi + 2 * math.pi * j / cols for j in range(cols)]

    def body_lift(az, el):
        slouch = 0.030 * smoothstep(0.9, 1.45, el) * smoothstep(1.2, 3.0, abs(az))
        return 0.040 + 0.008 * smoothstep(0.6, 1.4, el) + slouch

    rows_idx = []
    # folded cuff (rib-striped), then the knitted body up to the crown
    for (de, lift, k) in ((-0.012, 0.010, 0.55), (0.0, 0.044, 0.80), (0.085, 0.047, 0.88), (CUFF_EL - 0.012, 0.046, 0.82),
                          (CUFF_EL + 0.004, 0.040, 0.62)):
        rows_idx.append([p.v(hair_point(az, _beanie_edge(az) + de, lift),
                             mul_col(RUST, k * (0.86 if j % 2 else 1.0)), 0.0, SHELL_TAG) for j, az in enumerate(azs)])
    for r in range(1, 4):
        t = r / 3.0
        row = []
        for j, az in enumerate(azs):
            e0 = _beanie_edge(az) + CUFF_EL + 0.004
            el = e0 + (1.45 - e0) * t
            rib = 0.92 if j % 2 else 1.0
            row.append(p.v(hair_point(az, el, body_lift(az, el)), mul_col(RUST, (0.84 + 0.12 * t) * rib), 0.0,
                           SHELL_TAG))
        rows_idx.append(row)
    grid(p, rows_idx, 'Accessory', flip=True)
    top = p.v(surface(math.pi, math.pi / 2, body_lift(math.pi, 1.5) + 0.004), mul_col(RUST, 0.95), 0.0, 'acc')
    fan(p, rows_idx[-1], top, 'Accessory', flip=True)
    # pom-pom on the slouch (back of the crown)
    pom = surface(math.pi * 0.92, 1.22, body_lift(math.pi * 0.92, 1.22) + 0.022)
    ellipsoid(p, pom, (0.030, 0.030, 0.028), 6, 4, 'Accessory', colfn=lambda q: BONE, tag='acc')
    return _head(p)


def acc_bandage() -> Part:
    p = Part('Acc_bandage')
    tilt = Matrix.Rotation(math.radians(-16), 3, 'Y') @ Matrix.Rotation(math.radians(12), 3, 'X')
    pts_top, pts_bot = [], []
    n = 18
    for k in range(n):
        az = -math.pi + 2 * math.pi * k / n
        for (el, out) in ((0.50, pts_top), (0.28, pts_bot)):
            d = V((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
            d = (tilt @ d).normalized()
            el2 = math.asin(max(-1.0, min(1.0, d.z)))
            az2 = math.atan2(d.x, -d.y)
            out.append(surface(az2, el2, 0.011 + 0.002 * math.sin(k * 2.1)))

    def col(q):
        stain = (q - surface(0.25, 0.46, 0.0)).length < 0.03
        return hex_lin('#8a4a3a') if stain else PARCH

    a = [p.v(q, col(q), 0.0, 'acc') for q in pts_bot]
    b = [p.v(q, col(q), 0.0, 'acc') for q in pts_top]
    grid(p, [a, b], 'Accessory', flip=True)
    # knot + tails at the back
    knot = surface(math.pi * 0.92, 0.42, 0.02)
    ellipsoid(p, knot, (0.02, 0.016, 0.018), 6, 4, 'Accessory', colfn=lambda q: PARCH, tag='acc')
    for sx in (1, -1):
        tube(p, [knot, knot + V((0.02 * sx, 0.02, -0.03)), knot + V((0.03 * sx, 0.03, -0.07))], 0.008, 4, 'Accessory',
             squash=(1.0, 0.35), cap0='fan', cap1='fan', cap_depth0=0.0, cap_depth1=0.0, colfn=lambda q: PARCH,
             tag='acc')
    return _head(p)


def acc_flower() -> Part:
    p = Part('Acc_flower')
    base = surface(math.pi / 2 + 0.25, 0.22, 0.03)  # above/behind the left ear
    nrm = surface_normal(math.pi / 2 + 0.25, 0.22)
    up = V((0, 0, 1))
    a = (up - nrm * up.dot(nrm)).normalized()
    b = nrm.cross(a)
    for k in range(5):
        ang = 2 * math.pi * k / 5 + 0.3
        dirv = a * math.cos(ang) + b * math.sin(ang)
        fr = Matrix((dirv, dirv.cross(nrm).normalized(), nrm)).transposed()
        ellipsoid(p, base + dirv * 0.026 + nrm * 0.004, (0.026, 0.014, 0.006), 5, 3, 'Accessory', frame=fr,
                  colfn=lambda q: hex_lin('#efe4e6'), tag='acc')
    ellipsoid(p, base + nrm * 0.01, (0.011, 0.011, 0.009), 6, 4, 'Accessory', colfn=lambda q: hex_lin('#ffb35a'),
              tag='acc')
    tube(p, [base - nrm * 0.005, base - a * 0.05 - nrm * 0.008], 0.0035, 4, 'Accessory', cap0='fan', cap1='fan',
         cap_depth0=0.0, cap_depth1=0.0, colfn=lambda q: MOSS, tag='acc')
    return _head(p)


def acc_eyepatch() -> Part:
    p = Part('Acc_eyepatch')
    st = EYE_STYLE_DEFS['wide']
    c, f, up, sv, r, sx = _eye_frame('R', st)
    centre = c + f * (r + 0.004)
    fr = Matrix((sv, up, f)).transposed()
    ellipsoid(p, centre - f * 0.012, (0.046, 0.042, 0.022), 8, 4, 'Accessory', frame=fr, colfn=lambda q: LEATHER,
              tag='acc', lat_range=(0.0, math.pi / 2), cap_bottom=False)
    # strap around the head
    tilt = Matrix.Rotation(math.radians(-22), 3, 'Y')
    pts = []
    for k in range(12):
        az = -math.pi + 2 * math.pi * k / 12
        d = V((math.sin(az), -math.cos(az), 0.0))
        d = (tilt @ d).normalized()
        el2 = math.asin(max(-1.0, min(1.0, d.z))) + 0.12
        az2 = math.atan2(d.x, -d.y)
        pts.append(surface(az2, el2, 0.008))
    closed_tube(p, pts, 0.0045, 3, 'Accessory', LEATHER)
    return _head(p)


ACC_BUILDERS = {
    'glasses': acc_glasses, 'bowtie': acc_bowtie, 'necklace': acc_necklace, 'beanie': acc_beanie,
    'bandage': acc_bandage, 'flower': acc_flower, 'eyepatch': acc_eyepatch,
}


def build_accessory(name: str) -> Part:
    return ACC_BUILDERS[name]()
