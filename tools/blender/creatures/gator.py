"""Old Toothless, the undead alligator (docs/levels/L4-bayou.md §6): proportions, body and the six clips.

Built on the pets pipeline's quadruped rig (tools/blender/pets/petlib), so the skeleton is the creature
contract's `quad` plan. The body is its own builder: a low flattened torso, legs out at the sides, a broad flat
head with a long round-ended snout and no teeth, raised eye sockets, rows of back scutes and a deep tail.
Blender axes: front = -Y, Z up, metres, true size (about 2.8 m nose to tail).
"""
from __future__ import annotations

import math

from mathutils import Vector

from petlib import body as B
from petlib import clips as C
from petlib import mk
from petlib.rig import Pose, Rig
from petlib.species import UNDEAD_PATCH, torso_profile, torso_span

V = Vector
Z = V((0.0, 0.0, 1.0))
FWD = V((0.0, -1.0, 0.0))
s, bump, smooth = C.s, C.bump, C.smooth
lerp = B.lerp

SPEC = dict(
    plan='quad', H=0.150, L=0.86, body_w=0.215, body_h=0.135, belly=0.06, chest=-0.04,
    leg_r=0.050, paw_r=0.064, stance=0.255, hind_thigh=1.30,
    neck_up=0.0, neck_fwd=0.13, neck_r=0.125,
    head=(0.150, 0.150, 0.080), snout_len=0.36, snout_r=0.088, snout_drop=0.004, nose='Detail',
    ear='round', ear_h=0.010, ear_w=0.010, ear_x=0.050, no_ears=True,
    eye_r=0.027, eye_x=0.085, eye_fwd=0.02, eye_up=0.07,
    tail_len=1.20, tail_r=0.150, tail_tip=0.022, tail_rise=-0.10, tail_curl=-0.02,
    mark='gator', socks=False, coat=(0.40, 0.52, 0.32),
    paints={'bayou': '#c3cf9e'}, scale=1.0, detail=(1.0, 0.55),
    ground=['idle', 'sun', 'yawn', 'wag'],
)

# clip: (seconds, loop). §6 lists six: idle, swim, sun, yawn (the toothless gummy smile), roll, happy tail-wag
CLIPS = {'idle': (4.0, True), 'swim': (1.6, True), 'sun': (5.0, True), 'yawn': (2.6, False), 'roll': (2.2, False),
         'wag': (1.2, True)}


# ---------------------------------------------------------------------------------------------------
# Body
# ---------------------------------------------------------------------------------------------------

def build_part(rig: Rig, variant: str, name: str, detail: float = 1.0, low: bool = False) -> mk.Part:
    B.OPTS.update(detail=detail, name=name, low=low)
    try:
        part = _build(rig, variant, low)
    finally:
        B.OPTS.update(detail=1.0, name=None, low=False)
    if len(part.weights) != len(part.co):
        raise RuntimeError(f'{part.name}: {len(part.co)} vertices but {len(part.weights)} weights')
    return part


def _build(rig: Rig, variant: str, low: bool) -> mk.Part:
    sp = rig.sp
    b = B.Builder(B.OPTS['name'], rig, variant)
    H, L, bw, bh = sp['H'], sp['L'], sp['body_w'], sp['body_h']
    hb = rig.head['hips'].z
    y_r, y_f = torso_span(sp)
    st = 0.034                                                  # stitch size

    def prof(u: float) -> float:
        return torso_profile(sp, u)

    def torso(u: float, th: float):
        k = prof(u)
        p = V((bw * k * math.cos(th), lerp(y_r, y_f, u), hb + bh * k * math.sin(th)))
        return p, V((math.cos(th) / bw, 0.0, math.sin(th) / bh)).normalized()

    patch_u, patch_th = (0.34, 0.58), (math.radians(20), math.radians(80))

    def hide(p: Vector, top: float, span: float, y_phase: float = 0.0):
        """Coat colour: pale underneath, darker on top with faint cross bands."""
        under = smooth((top - 0.45 * span - p.z) / (0.55 * span))
        band = smooth((math.sin((p.y + y_phase) * 19.0) - 0.2) / 0.5) * smooth((p.z - top + 0.3 * span) / (0.5 * span))
        return b.col(lerp(1.0, 0.70, band), 0.80 * under)

    def torso_col(p: Vector):
        u = (y_r - p.y) / (y_r - y_f)
        th = math.atan2((p.z - hb) / bh, p.x / bw)
        if patch_u[0] < u < patch_u[1] and patch_th[0] < th < patch_th[1]:
            return B.mulc(UNDEAD_PATCH, 0.78)                   # the sewn-on lilac patch
        return hide(p, hb + bh, 2 * bh)

    w1 = L / 4.5

    def torso_w(co: Vector) -> dict:
        t1 = smooth((L / 6 + w1 / 2 - co.y) / w1)
        t2 = smooth((-L / 6 + w1 / 2 - co.y) / w1)
        w = {'hips': 1.0 - t1, 'spine': t1 * (1.0 - t2), 'chest': t1 * t2}
        return {k: v for k, v in w.items() if v > 1e-4}

    path = [V((0.0, lerp(y_r, y_f, i / 10), hb)) for i in range(11)]
    b.add(lambda part: B._tube(part, path, lambda u, th: bh * prof(u), 18, 'Paint', up=Z, squash=(1.0, bw / bh),
                               colfn=torso_col, dome_steps=3), torso_w)

    # neck and head: a thick neck that carries the body's width into a broad flat skull
    nb, hd = rig.head['neck'], rig.head['head']
    hr = sp['head']
    hc = hd + V((0.0, -0.45 * hr[1], 0.10 * hr[2]))
    chest_pt = V((0.0, y_f + 0.24, hb))                          # well inside the torso, so the join is hidden
    neck_w = B.chain_w(['chest', 'neck', 'head'], [chest_pt, nb, hd, hc], 0.4)
    b.add(lambda part: B._tube(part, [chest_pt, nb, hd, hc], lambda u, th: lerp(0.80 * bh, 1.05 * hr[2], smooth(u)), 14, 'Paint',
                               up=Z, squash=(1.0, lerp(bw / bh, hr[0] / hr[2], 0.6) * 0.92), cap0='dome', cap1=None,
                               colfn=lambda p: hide(p, hb + bh, 2 * bh)), neck_w)

    def head_col(p: Vector):
        return hide(p, hc.z + hr[2], 2 * hr[2], 0.11)

    b.add(lambda part: B._ellipsoid(part, hc, hr, 16, 9, 'Paint', colfn=head_col), B.rigid('head'))
    sl, sr = sp['snout_len'], sp['snout_r']
    su = hc + V((0.0, -0.62 * hr[1] - 0.5 * sl, -0.18 * hr[2]))                 # upper jaw
    b.add(lambda part: B._ellipsoid(part, su, (1.05 * sr, 0.5 * sl + 0.07, 0.046), 14, 7, 'Paint', colfn=head_col), B.rigid('head'))
    sj = su + V((0.0, 0.035, -0.050))                                           # lower jaw
    jaw_col = lambda p: b.col(1.0, 0.85)                                        # noqa: E731  (pale chin)
    b.add(lambda part: B._ellipsoid(part, sj, (0.98 * sr, 0.5 * sl + 0.09, 0.032), 14, 6, 'Paint', colfn=jaw_col), B.rigid('jaw'))
    # gums: no teeth. They show when the jaw drops (the yawn and the wag)
    b.add(lambda part: B._ellipsoid(part, sj + V((0.0, 0.0, 0.020)), (0.80 * sr, 0.5 * sl + 0.03, 0.014), 10, 4, 'Skin'), B.rigid('jaw'))
    b.add(lambda part: B._ellipsoid(part, su + V((0.0, 0.01, -0.030)), (0.84 * sr, 0.5 * sl + 0.03, 0.014), 10, 4, 'Skin'), B.rigid('head'))
    tip_y = su.y - 0.5 * sl - 0.07
    for sx in (1.0, -1.0):                                                      # nostril bumps, raised eye sockets
        b.add(lambda part, sx=sx: B._ellipsoid(part, V((sx * 0.030, tip_y + 0.045, su.z + 0.040)), (0.022, 0.026, 0.016), 8, 5,
                                                'Paint', colfn=lambda p: b.col(0.62)), B.rigid('head'))
        b.add(lambda part, sx=sx: B._ellipsoid(part, hc + V((sx * sp['eye_x'], -sp['eye_fwd'], sp['eye_up'] - 0.012)),
                                                (0.052, 0.066, 0.046), 10, 6, 'Paint', colfn=lambda p: b.col(0.80)), B.rigid('head'))
        if not low:
            b.add(lambda part, sx=sx: B._ellipsoid(part, V((sx * 0.030, tip_y + 0.040, su.z + 0.052)), (0.008, 0.010, 0.006), 6, 4,
                                                    'Detail'), B.rigid('head'))
    orbit = (0.050, 0.064, 0.044)
    for side, sx in enumerate((1.0, -1.0)):                                     # eyes look out and a little forward
        oc = hc + V((sx * sp['eye_x'], -sp['eye_fwd'], sp['eye_up'] - 0.012))
        d = V((sx * 0.80, -0.42, 0.42)).normalized()
        p_, n_ = B.on_ellipsoid(oc, orbit, d)
        er = sp['eye_r'] * ((1.28 if side == 0 else 0.86) if b.undead else 1.0)
        mat = ('EyeGlowA' if side == 0 else 'EyeGlowB') if b.undead else 'Eye'
        b.add(lambda part, c=p_ - n_ * (0.55 * er), er=er, mat=mat: B._ellipsoid(part, c, (er, er, er), 10, 6, mat), B.rigid('head'))

    # scutes: two rows down the back, one down the tail
    if True:
        n_back = 5 if low else 10
        for i in range(n_back):
            u = 0.10 + 0.84 * i / (n_back - 1)
            for sgn in (1.0, -1.0):
                p, n = torso(u, math.radians(90.0 - sgn * 24.0))
                b.add(lambda part, p=p, n=n: B._ellipsoid(part, p + n * 0.004, (0.026, 0.040, 0.020), 6, 4, 'Paint',
                                                          colfn=lambda q: b.col(0.58)), torso_w)

    # legs (left, mirrored): short, set outside the body
    def leg(kind: str):
        up, lo, paw = (f'{x}_{kind}_L' for x in ('upper', 'lower', 'paw'))
        top, knee, ank = rig.head[up], rig.tail[up], rig.tail[lo]
        thigh = sp['hind_thigh'] if kind == 'H' else 1.15
        pr = sp['paw_r']
        pc = V((ank.x + 0.010, ank.y - 0.50 * pr, 0.50 * pr))
        root = V((0.60 * top.x, top.y, top.z + 0.06 * bh))                      # buried in the flank, below the back line

        def leg_col(p: Vector):
            return b.col(0.86, 0.35 * smooth((0.6 * H - p.z) / (0.5 * H)))

        def build(part):
            B._tube(part, [root, top, knee, ank + V((0, 0, 0.004))], lambda u, th: sp['leg_r'] * lerp(thigh, 0.94, smooth(u / 0.8)),
                    10, 'Paint', up=FWD, cap0=None, cap1=None, colfn=leg_col)
            B._ellipsoid(part, pc, (1.05 * pr, 1.30 * pr, 0.50 * pr), 10, 5, 'Paint', colfn=leg_col)
            if not low:
                for k in (-1, 0, 1):                                            # three blunt toes
                    B._ellipsoid(part, pc + V((k * 0.62 * pr, -1.12 * pr, -0.22 * pr)), (0.30 * pr, 0.46 * pr, 0.22 * pr), 6, 4,
                                 'Paint', colfn=lambda p: b.col(0.62))

        wz = 0.30 * H
        parent = rig.parent[up]

        def w(co: Vector) -> dict:
            if co.z < 1.1 * pr and (co - pc).length < 2.1 * pr and co.z < ank.z + 0.014:
                k = smooth((co.z - 0.5 * ank.z) / max(ank.z, 1e-4))
                return {paw: 1.0 - 0.5 * k, lo: 0.5 * k} if k > 1e-3 else {paw: 1.0}
            if co.z > top.z or abs(co.x) < 0.9 * top.x:
                k = max(smooth((co.z - top.z) / (0.25 * bh)), smooth((0.9 * top.x - abs(co.x)) / (0.35 * top.x)))
                return {up: 1.0 - k, parent: k} if k > 1e-3 else {up: 1.0}
            k = smooth((knee.z + wz / 2 - co.z) / wz)
            return {kk: v for kk, v in {up: 1.0 - k, lo: k}.items() if v > 1e-4}

        b.add_side(build, w)

    leg('F')
    leg('H')

    # tail: deep and narrow, tapering to a point
    tb = [rig.head['tail_1'] - (rig.tail['tail_1'] - rig.head['tail_1']).normalized() * (0.9 * bw),
          rig.head['tail_1'], rig.tail['tail_1'], rig.tail['tail_2'], rig.tail['tail_3']]
    tpath = B.bspline(tb, 15)
    lens = [0.0]
    for i in range(1, len(tpath)):
        lens.append(lens[-1] + (tpath[i] - tpath[i - 1]).length)

    def tail_r(u: float, th: float) -> float:
        return lerp(0.80 * sp['tail_r'], sp['tail_tip'], u ** 0.75)   # starts inside the rump, no wider than it

    def tail_col(p: Vector):
        i = min(range(len(tpath)), key=lambda j: (tpath[j] - p).length_squared)
        r = tail_r(lens[i] / lens[-1], 0.0)
        return hide(p, tpath[i].z + r, 2 * r, 0.05)

    tail_w = B.chain_w(['hips', 'tail_1', 'tail_2', 'tail_3'], tb, 0.35)
    b.add(lambda part: B._tube(part, tpath, tail_r, 12, 'Paint', up=Z, squash=(1.0, 0.78), cap0='dome', cap1='dome',
                               colfn=tail_col), tail_w)
    n_tail = 5 if low else 9
    for i in range(n_tail):
        f = 0.14 + 0.72 * i / (n_tail - 1)
        j = min(len(tpath) - 1, int(round(f * (len(tpath) - 1))))
        r = tail_r(lens[j] / lens[-1], 0.0)
        b.add(lambda part, c=tpath[j] + Z * (r + 0.004), r=r: B._ellipsoid(part, c, (0.020 + 0.06 * r, 0.050, 0.020 + 0.10 * r), 6, 4,
                                                                         'Paint', colfn=lambda q: b.col(0.58)), tail_w)

    if b.undead:
        two_pi = 2 * math.pi
        b.seam(lambda t: torso(0.90, t), 0.0, two_pi, 14, st, torso_w)                       # collar seam
        (u0, u1), (a0, a1) = patch_u, patch_th
        b.seam(lambda t: torso(t, a0), u0, u1, 4, st, torso_w)
        b.seam(lambda t: torso(t, a1), u0, u1, 4, st, torso_w)
        b.seam(lambda t: torso(u0, t), a0, a1, 3, st, torso_w)
        b.seam(lambda t: torso(u1, t), a0, a1, 3, st, torso_w)
        b.seam(lambda t: B.on_ellipsoid(su, (1.05 * sr, 0.5 * sl + 0.07, 0.046), V((math.sin(t), 0.25, math.cos(t)))), -0.9, 0.9, 5,
               st * 0.8, B.rigid('head'))                                                    # across the snout
    return b.part


# ---------------------------------------------------------------------------------------------------
# Clips. fn(rig, p) -> Pose with p in [0, 1]. Looping clips use whole cycles.
# ---------------------------------------------------------------------------------------------------

def _trail_legs(pose: Pose, fold: float = 1.0) -> None:
    """Legs swept back along the body (swimming, rolling)."""
    for side in ('L', 'R'):
        pose.rot[f'upper_F_{side}'] = (62.0 * fold, 0, 0)
        pose.rot[f'lower_F_{side}'] = (24.0 * fold, 0, 0)
        pose.rot[f'paw_F_{side}'] = (40.0 * fold, 0, 0)
        pose.rot[f'upper_H_{side}'] = (70.0 * fold, 0, 0)
        pose.rot[f'lower_H_{side}'] = (-30.0 * fold, 0, 0)
        pose.rot[f'paw_H_{side}'] = (50.0 * fold, 0, 0)


def idle(rig, p):
    pose = Pose()
    pose.loc = V((0, 0, 0.004 * s(p)))                       # slow breath
    pose.rot['neck'] = (2.0 * s(p), 0, 3.0 * s(p + 0.2))
    pose.rot['head'] = (-3.0 + 2.0 * s(p + 0.1), 0, 4.0 * s(p + 0.3))
    pose.rot['jaw'] = (3.0 + 2.0 * s(2 * p), 0, 0)
    C.tail(pose, 0.0, 7.0, 1, p)
    return C._stand(rig, pose)


def sun(rig, p):
    """Basking: belly on the log, chin down, legs slack, the tail curled lazily to one side."""
    sp = rig.sp
    pose = Pose()
    belly = rig.head['hips'].z - sp['body_h'] * max(torso_profile(sp, i / 16) for i in range(17))
    pose.loc = V((0, 0, 0.006 - belly + 0.003 * (0.5 + 0.5 * s(p))))      # the belly rests on the log
    pose.rot['neck'] = (2.0, 0, 0)                           # chin just clear of the log
    pose.rot['head'] = (2.0 + 0.6 * s(p), 0, 0)
    pose.rot['jaw'] = (0.5, 0, 0)
    C._tail_flat(rig, pose, -2.5, 3.0, 1, p, curl=14.0)        # along the log, not through it
    return C._stand(rig, pose)


def yawn(rig, p):
    """Head up, jaw wide: the toothless gummy smile."""
    k = bump(p, 0.08, 0.92)
    hold = smooth(min(1.0, k * 1.6))
    pose = Pose()
    pose.rot['neck'] = (-12.0 * hold, 0, 0)
    pose.rot['head'] = (-24.0 * hold, 0, 5.0 * s(p) * hold)
    pose.rot['jaw'] = (2.0 + 46.0 * hold, 0, 0)
    C.tail(pose, 4.0 * hold, 5.0, 1, p)
    return C._stand(rig, pose)


def wag(rig, p):
    """Happy: the tail thumps side to side, the body wiggles against it, mouth open in a grin."""
    pose = Pose()
    pose.loc = V((0, 0, 0.008 * abs(s(p))))
    pose.rot['spine'] = (0, 0, 3.0 * s(2 * p))
    pose.rot['chest'] = (0, 0, -3.0 * s(2 * p))
    pose.rot['neck'] = (-6.0, 0, -5.0 * s(2 * p + 0.1))
    pose.rot['head'] = (-10.0, 0, 6.0 * s(2 * p + 0.15))
    pose.rot['jaw'] = (16.0 + 5.0 * s(2 * p), 0, 0)
    C.tail(pose, 9.0, 40.0, 2, p)
    return C._stand(rig, pose)


def swim(rig, p):
    """In place (the game moves him): the body snakes, the tail drives, legs trail along the flanks."""
    pose = Pose()
    pose.loc = V((0.012 * s(p + 0.25), 0, 0.006 * s(2 * p)))
    pose.rot['hips'] = (0, 0, 7.0 * s(p))
    pose.rot['spine'] = (0, 0, -9.0 * s(p + 0.08))
    pose.rot['chest'] = (0, 0, 6.0 * s(p + 0.16))
    pose.rot['neck'] = (-4.0, 0, -5.0 * s(p + 0.22))
    pose.rot['head'] = (-5.0, 0, -3.0 * s(p + 0.28))          # eyes and nostrils stay level
    pose.rot['jaw'] = (1.0, 0, 0)
    C.tail(pose, 3.0, 30.0, 1, p + 0.5)
    _trail_legs(pose)
    return pose


def roll(rig, p):
    """One slow barrel roll in the water, belly up halfway, with a grin."""
    k = smooth(p)
    pose = Pose()
    pose.rot['hips'] = (0, 360.0 * k, 0)
    pose.loc = V((0, 0, 0.02 * bump(p, 0.0, 1.0)))
    pose.rot['neck'] = (-4.0 * bump(p, 0.1, 0.9), 0, 0)
    pose.rot['jaw'] = (2.0 + 14.0 * bump(p, 0.25, 0.85), 0, 0)
    C.tail(pose, 4.0, 16.0 * bump(p, 0.0, 1.0), 1, p, curl=10.0 * bump(p, 0.1, 0.9))
    _trail_legs(pose, fold=bump(p, 0.0, 1.0) ** 0.5)
    return pose


TABLE = {'idle': idle, 'swim': swim, 'sun': sun, 'yawn': yawn, 'roll': roll, 'wag': wag}
