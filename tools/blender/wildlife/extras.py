"""What makes each wild animal its own animal up close (W-083).

The wildlife shares two pet bodies: the bird plan (songbird, pigeon, bat) and the quadruped plan (squirrel, frog).
At game distance proportions are enough. Up close they read as recoloured pets, so each animal gets its own marks
here, on top of the shared body: colour patterns painted into the vertex colours, and a few small pieces of its
own skinned to the same bones.

`decorate(species, rig, part, low)` runs on the body at the plan's reference size, before the build scales it.
Colour marks are applied at both levels of detail (they cost nothing); the added pieces only at LOD0.
"""
from __future__ import annotations

import math

from mathutils import Vector

from petlib import mk

V = Vector
Z = V((0.0, 0.0, 1.0))


def _dominant(w: dict) -> str:
    return max(sorted(w), key=lambda b: w[b])


def _coat(sp: dict, k: float = 1.0, light: float = 0.0) -> tuple:
    """The body's own colour rule (petlib Builder.col): coat tint darkened by k, blended toward bare Paint by light."""
    c = tuple(x * k for x in sp['coat'])
    return tuple(c[i] + (1.0 - c[i]) * max(0.0, min(1.0, light)) for i in range(3))


def _paint(part, pick, colour) -> int:
    """Recolour every vertex for which pick(i, co, bone) is true. colour: a tuple, or fn(co) -> tuple."""
    n = 0
    for i, co in enumerate(part.co):
        if pick(i, co, _dominant(part.weights[i])):
            part.col[i] = colour(co) if callable(colour) else colour
            n += 1
    return n


def _add(part, build, weights) -> None:
    """Run build(part) and skin the new vertices: weights is a dict, or fn(co) -> dict."""
    start = len(part.co)
    build(part)
    for i in range(start, len(part.co)):
        part.weights.append(dict(weights(part.co[i]) if callable(weights) else weights))


def _smooth(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


# ─────────────────────────────────────────── birds ───────────────────────────────────────────

def _bird_frame(rig):
    hips, chest = rig.head['hips'], rig.tail['hips']
    fwd = (chest - hips).normalized()
    up = (Z - fwd * Z.dot(fwd)).normalized()
    return hips, chest, fwd, up


def songbird(rig, part, low: bool) -> None:
    """A robin's bib: bright breast and face against a darker back, a pale belly, and a cocked tail."""
    sp = rig.sp
    hips, chest, fwd, up = _bird_frame(rig)
    hd = rig.head['head']
    length = (chest - hips).length

    def bib(i, co, bone):
        if bone in ('hips', 'neck'):
            u = (co - hips).dot(fwd) / length
            return u > 0.30 and (co - hips).dot(up) < 0.30 * sp['body_h']
        return bone == 'head' and co.z < hd.z + 0.25 * sp['head_r'] and co.y < hd.y

    _paint(part, bib, (1.0, 1.0, 1.0))                                           # bare Paint: the variant's bright colour
    _paint(part, lambda i, co, bone: bone == 'hips' and (co - hips).dot(fwd) / length <= 0.30 and (co - hips).dot(up) < -0.35 * sp['body_h'],
           _coat(sp, 1.0, 0.75))                                                # pale under the tail
    _paint(part, lambda i, co, bone: bone.startswith('wing') or (bone == 'hips' and (co - hips).dot(up) > 0.45 * sp['body_h']),
           _coat(sp, 0.42))                                                     # dark wings and back
    _paint(part, lambda i, co, bone: bone == 'head' and co.z > hd.z + 0.55 * sp['head_r'], _coat(sp, 0.42))   # and a dark cap
    if low:
        return
    rump = rig.head['tail_1']
    tip = rump - fwd * 0.078 + up * 0.050                                        # the tail, cocked up
    _add(part, lambda p: mk.tube(p, [rump + fwd * 0.010, rump.lerp(tip, 0.5) + up * 0.004, tip],
                                 lambda u, th: 0.0045 + 0.0015 * u, 6, 'Paint', up=Z, squash=(1.0, 2.6), cap0=None, cap1='dome',
                                 colfn=lambda q: _coat(sp, 0.42)), {'tail_1': 1.0})


def pigeon(rig, part, low: bool) -> None:
    """A town pigeon: a puffed chest, a green-and-purple sheen on the neck, two dark wing bars, a dark tail tip,
    and the pale cere over the beak."""
    sp = rig.sp
    hips, chest, fwd, up = _bird_frame(rig)
    hd = rig.head['head']
    length = (chest - hips).length
    for i, co in enumerate(part.co):                                             # puff the chest
        if _dominant(part.weights[i]) == 'hips':
            u = (co - hips).dot(fwd) / length
            k = 0.16 * _smooth((u - 0.45) / 0.35) * (1.0 if (co - hips).dot(up) < 0.2 * sp['body_h'] else 0.4)
            if k > 0:
                axis = hips + fwd * (co - hips).dot(fwd)
                part.co[i] = co + (co - axis) * k
    green, purple = (0.20, 0.62, 0.42), (0.52, 0.28, 0.72)

    def neck(i, co, bone):
        if bone == 'hips':
            return (co - hips).dot(fwd) / length > 0.80 and (co - hips).dot(up) > -0.2 * sp['body_h']
        return bone == 'neck' or (bone == 'head' and co.z < hd.z + 0.10 * sp['head_r'])

    _paint(part, neck, lambda co: green if co.z > (chest.z + hd.z) / 2 else purple)
    w1h, w2t = rig.head['wing_1_L'], rig.tail['wing_2_L']
    span = (w2t - w1h).length

    def bar(i, co, bone):
        if not bone.startswith('wing'):
            return False
        u = (V((abs(co.x), co.y, co.z)) - w1h).dot((w2t - w1h).normalized()) / span
        return 0.34 < u < 0.50 or 0.62 < u < 0.80

    _paint(part, bar, _coat(sp, 0.22))
    _paint(part, lambda i, co, bone: bone == 'head' and co.z >= hd.z + 0.10 * sp['head_r'], _coat(sp, 0.62))   # a darker head
    t0, t1 = rig.head['tail_1'], rig.tail['tail_1']
    _paint(part, lambda i, co, bone: bone == 'tail_1' and (co - t0).dot((t1 - t0).normalized()) > 0.62 * (t1 - t0).length, _coat(sp, 0.36))
    if low:
        return
    hc = hd + V((0.0, -0.30 * sp['head_r'], 0.22 * sp['head_r']))
    cere = hc + V((0.0, -0.84 * sp['head_r'], 0.07 * sp['head_r']))
    _add(part, lambda p: mk.ellipsoid(p, cere, (0.30 * sp['head_r'], 0.26 * sp['head_r'], 0.20 * sp['head_r']), 6, 4, 'Paint',
                                      colfn=lambda q: (1.0, 1.0, 1.0)), {'head': 1.0})
    fan0, fan1 = t0.lerp(t1, 0.35), t1 + (t1 - t0).normalized() * 0.030          # a wider, squarer tail
    _add(part, lambda p: mk.tube(p, [fan0, fan1], lambda u, th: 0.006 + 0.002 * u, 6, 'Paint', up=Z, squash=(1.0, 3.6), cap0=None,
                                 cap1='dome', colfn=lambda q: _coat(sp, 0.36 if (q - t0).dot((t1 - t0).normalized()) > 0.62 * (t1 - t0).length else 0.9)),
         {'tail_1': 1.0})


def bat(rig, part, low: bool) -> None:
    """Finger bones through the wings and a paler membrane between them, a dark muzzle."""
    sp = rig.sp
    hd = rig.head['head']
    _paint(part, lambda i, co, bone: bone.startswith('wing'), _coat(sp, 1.0, 0.22))   # the membrane, a little translucent-pale
    _paint(part, lambda i, co, bone: bone == 'head' and co.y < hd.y - 0.55 * sp['head_r'], _coat(sp, 0.55))
    if low:
        return
    for sign, side in ((1.0, 'L'), (-1.0, 'R')):
        w1h, w1t, w2t = (V((v.x * sign, v.y, v.z)) for v in (rig.head[f'wing_1_{side}'] if sign > 0 else rig.head['wing_1_L'],
                                                             rig.tail['wing_1_L'], rig.tail['wing_2_L']))
        if sign < 0:
            w1h = V((-rig.head['wing_1_L'].x, rig.head['wing_1_L'].y, rig.head['wing_1_L'].z))
        back = V((0.0, 1.0, 0.0))
        drop = 0.50 * sp['wing_h']
        for k, t in enumerate((0.35, 0.68, 1.0)):                                # three fingers fanning to the trailing edge
            end = w1t.lerp(w2t, t) + back * drop * (1.0 - 0.45 * t) - Z * 0.002
            bone = f'wing_2_{side}' if t > 0.5 else f'wing_1_{side}'
            _add(part, lambda p, a=w1t.lerp(w1h, 0.15), e=end: mk.tube(p, [a + Z * 0.003, e + Z * 0.003], 0.0028, 3, 'Detail', cap0=None, cap1=None),
                 {bone: 1.0})
        _add(part, lambda p, a=w1h, b=w1t, c=w2t: mk.tube(p, [a + Z * 0.004, b + Z * 0.004, c + Z * 0.003], 0.0034, 3, 'Detail', cap0=None, cap1='dome'),
             lambda co, s=side: {f'wing_2_{s}': 1.0} if (co - w1t).dot((w2t - w1t)) > 0 else {f'wing_1_{s}': 1.0})   # the arm bone


# ─────────────────────────────────────────── quadrupeds ───────────────────────────────────────────

def squirrel(rig, part, low: bool) -> None:
    """A bushy tail built from overlapping tufts, ear tufts, a pale chest and belly, and a pale eye ring."""
    sp = rig.sp
    hb = rig.head['hips'].z
    _paint(part, lambda i, co, bone: bone in ('hips', 'spine', 'chest') and co.z < hb - 0.25 * sp['body_h'], _coat(sp, 1.0, 0.85))
    hd = rig.head['head']
    _paint(part, lambda i, co, bone: bone in ('neck', 'head', 'jaw') and co.z < hd.z - 0.10 * sp['head'][2] and co.y < hd.y + 0.02, _coat(sp, 1.0, 0.80))
    _paint(part, lambda i, co, bone: bone.startswith('tail') and (co - rig.head['tail_1']).length > 0.75 * sp['tail_len'], _coat(sp, 0.62))   # dark tail tip
    if low:
        return
    pts = [rig.head['tail_1'], rig.tail['tail_1'], rig.tail['tail_2'], rig.tail['tail_3']]
    bones = ['tail_1', 'tail_2', 'tail_3']
    n = 5
    for k in range(n):                                                           # tufts along the tail, alternating sides
        t = (k + 0.6) / n
        seg = min(2, int(t * 3))
        a, b = pts[seg], pts[seg + 1]
        c = a.lerp(b, t * 3 - seg)
        axis = (b - a).normalized()
        side = V((1.0, 0.0, 0.0)) * (0.30 * sp['tail_r'] * (1 if k % 2 else -1))
        out = (Z - axis * Z.dot(axis))
        out = out.normalized() * (0.35 * sp['tail_r']) if out.length > 1e-6 else V((0, 0, 0))
        r = sp['tail_r'] * (0.95 + 0.45 * math.sin(math.pi * t))
        _add(part, lambda p, c=c + side + out * (1 if k % 3 else -0.4), r=r: mk.ellipsoid(p, c, (0.85 * r, 0.95 * r, 1.25 * r), 6, 4, 'Paint',
                                                                                         colfn=lambda q: _coat(sp, 0.86 if k % 2 else 1.0, 0.10)),
             {bones[seg]: 1.0})
    hc = hd + V((0.0, -0.45 * sp['head'][1], 0.10 * sp['head'][2]))
    for sign, side in ((1.0, 'L'), (-1.0, 'R')):                                 # ear tufts
        base = hc + V((sign * sp['ear_x'], 0.10 * sp['head'][1], 0.72 * sp['head'][2] + sp['ear_h'] * 0.8))
        _add(part, lambda p, b=base, s=sign: mk.tube(p, [b, b + V((s * 0.006, 0.004, 0.030))], lambda u, th: 0.008 * (1 - u) + 0.001, 4, 'Paint',
                                                     cap0=None, cap1='dome', colfn=lambda q: _coat(sp, 0.62)), {f'ear_{side}': 1.0})


def frog(rig, part, low: bool) -> None:
    """Fat folded thighs, wide webbed feet, dark spots down the back, a pale throat and belly, a dark mouth line."""
    sp = rig.sp
    hb = rig.head['hips'].z
    hd = rig.head['head']
    _paint(part, lambda i, co, bone: bone in ('hips', 'spine', 'chest') and co.z < hb - 0.10 * sp['body_h'], _coat(sp, 1.0, 0.80))
    _paint(part, lambda i, co, bone: bone in ('neck', 'head', 'jaw') and co.z < hd.z - 0.05 * sp['head'][2], _coat(sp, 1.0, 0.85))

    def spot(i, co, bone):
        if bone not in ('hips', 'spine', 'chest') or co.z < hb + 0.35 * sp['body_h']:
            return False
        return math.sin(co.y * 95.0 + 1.3) * math.sin(co.x * 85.0 + 1.57) > 0.30       # a fixed pattern, not random

    _paint(part, spot, _coat(sp, 0.36))
    _paint(part, lambda i, co, bone: bone in ('hips', 'spine', 'chest') and co.z > hb + 0.2 * sp['body_h'] and 0.45 * sp['body_w'] < abs(co.x) < 0.72 * sp['body_w'],
           _coat(sp, 1.0, 0.70))                                                # the pale folds along each side of the back
    if low:
        return
    for sign, side in ((1.0, 'L'), (-1.0, 'R')):
        hip, knee = rig.head['upper_H_L'], rig.tail['upper_H_L']
        c = hip.lerp(knee, 0.45)
        c = V((sign * (c.x + 0.012), c.y - 0.006, c.z + 0.004))
        _add(part, lambda p, c=c: mk.ellipsoid(p, c, (0.024, 0.036, 0.030), 6, 4, 'Paint', colfn=lambda q: _coat(sp, 0.92)),
             {f'upper_H_{side}': 1.0})                                           # the thigh
        for kind in ('F', 'H'):                                                  # webbed feet, splayed
            ank = rig.tail[f'lower_{kind}_L']
            pr = sp['paw_r']
            c = V((sign * (ank.x + 0.004), ank.y - 0.75 * pr, 0.20 * pr))
            wide = 1.55 if kind == 'H' else 1.25
            _add(part, lambda p, c=c, wide=wide, pr=pr: mk.ellipsoid(p, c, (wide * pr, 1.35 * pr, 0.20 * pr), 6, 3, 'Paint',
                                                                     colfn=lambda q: _coat(sp, 0.80)), {f'paw_{kind}_{side}': 1.0})
    hc = hd + V((0.0, -0.45 * sp['head'][1], 0.10 * sp['head'][2]))
    hr = sp['head']
    mouth = [hc + V((math.sin(a) * hr[0] * 0.98, -math.cos(a) * hr[1] * 0.98 - 0.5 * sp['snout_len'] * math.cos(a) ** 2, -0.30 * hr[2]))
             for a in (math.radians(d) for d in range(-80, 81, 32))]
    _add(part, lambda p: mk.tube(p, mouth, 0.0022, 3, 'Detail', cap0=None, cap1=None), {'head': 1.0})


TABLE = {'songbird': songbird, 'pigeon': pigeon, 'bat': bat, 'squirrel': squirrel, 'frog': frog}


def decorate(species: str, rig, part, low: bool) -> None:
    fn = TABLE.get(species)
    if fn is None:
        return
    fn(rig, part, low)
    if len(part.weights) != len(part.co) or len(part.col) != len(part.co):
        raise RuntimeError(f'{species}: {len(part.co)} vertices, {len(part.weights)} weights, {len(part.col)} colours')
