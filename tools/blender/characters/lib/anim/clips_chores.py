"""Chores, hobbies and one-shots: standEat, cook, clean, washHands, shower, paint, embalm, stitch, read,
pickup (one-shot), collapse (one-shot), yawn (one-shot)."""
from __future__ import annotations

import math

from mathutils import Vector

from ..consts import DIM
from .base import (LIE_Y, LIE_Z, PELVIS_REST_Z, breathe, clip, hand_orient, lie_base, look, plant, relaxed_arms,
                   sgn, stand)
from .clips_sit import MOUTH, fork_to_mouth, head_pt, hold_plate
from .props import plate_frame
from .pose import Pose, blend, ease, ease_in, ease_out, keyed, osc, pulse

V = Vector
COUNTER_Z = DIM['COUNTER_HEIGHT'] + 0.06
SLAB_Z = DIM['SLAB_HEIGHT'] + 0.05
TABLE_Z = DIM['TABLE_HEIGHT'] + 0.04


STAND_PLATE_PALM = V((0.14, -0.30, 0.95))


@clip('standEat', 3.0)
def stand_eat(sk, t):
    """Eating on the go: plate up on the left palm, the right hand forks a bite to the mouth and chews."""
    T = 3.0
    p = stand(sk, crouch=0.03)
    breathe(p, t, T, 0.8)
    m = keyed(t, [(0.0, 0.0), (0.5, 0.0), (1.05, 1.0), (1.6, 1.0), (2.15, 0.0), (3.0, 0.0)])
    chew = max(0.0, osc(t, 0.32)) * (1.0 if 1.0 < t < 2.3 else 0.25)
    look(p, pitch=22 - 30 * m, yaw=-4)
    hold_plate(p, sk, 'L', STAND_PLATE_PALM)
    plate, *_ = plate_frame(p, 'L')
    fork_to_mouth(p, sk, 'R', plate + V((-0.035, -0.01, 0.012 + 0.012 * osc(t, 0.45) * (1 - m))), m)
    plant(p)
    p.r('jaw', x=4 + 9 * chew)
    return p


@clip('cook', 4.8)
def cook(sk, t):
    """At the counter: stirs the pot in slow circles, lifts the spoon for a taste (head tilts - hmm), shakes in some
    seasoning with the other hand, and gets back to stirring with a satisfied little bob."""
    T = 4.8
    taste = keyed(t, [(0.0, 0.0), (2.35, 0.0), (2.75, 1.0), (3.25, 1.0), (3.6, 0.0), (4.8, 0.0)])
    season = keyed(t, [(0.0, 0.0), (3.35, 0.0), (3.6, 1.0), (4.1, 1.0), (4.4, 0.0), (4.8, 0.0)])
    shake = pulse(t, 0.16, 0.0, 0.3) * season
    hmm = pulse(t, T, 3.0 / T, 0.05)
    bob = 0.5 + 0.5 * osc(t, 0.6)
    p = stand(sk, crouch=0.035, arms=False)
    p.move(dx=-0.006 * osc(t, T / 4), dz=-0.006 * bob * (1 - taste))
    p.r('spine', x=4 - 3 * taste)
    p.r('chest', x=6 - 4 * taste, z=3 * osc(t, T / 4) * (1 - taste))
    breathe(p, t, T / 3, 0.8)
    look(p, pitch=26 - 26 * taste + 10 * season, yaw=-6 + 3 * osc(t, T / 4) + 8 * season,
         tilt=4 * osc(t, T, 0.2) + 14 * hmm)
    ang = 2 * math.pi * t / (T / 4)
    c = V((-0.04, -0.38, COUNTER_Z + 0.06))
    stir = c + V((0.06 * math.cos(ang), 0.05 * math.sin(ang), 0.01 * math.sin(2 * ang)))
    mouth = head_pt(p, MOUTH) + V((-0.02, -0.07, -0.05))
    tgt = stir.lerp(mouth, taste)
    fingers = V((0.15, -0.3, -1.0)).lerp(V((0.5, 0.75, 0.45)), taste)
    p.arm_ik('R', tgt, pole=V((-1.0, 0.5, -0.5)).lerp(V((-1.0, 0.2, -0.9)), taste),
             hand_world=hand_orient(sk, 'R', fingers, V((1, 0, 0)).lerp(V((0.8, 0.0, -0.5)), taste)))
    rest_l = V((0.20, -0.36, COUNTER_Z + 0.03))
    over_pot = V((0.06, -0.42, COUNTER_Z + 0.30 + 0.025 * shake))
    p.arm_ik('L', rest_l.lerp(over_pot, season), pole=V((1.0, 0.4, -0.6)),
             hand_world=hand_orient(sk, 'L', V((-0.8, -0.6, -0.1)).lerp(V((-0.2, -0.4, -1.0)), season),
                                    V((0, 0, -1)).lerp(V((-1, 0, -0.2)), season)))
    plant(p)
    p.r('jaw', x=3 + 2 * osc(t, T / 2) + 10 * taste * max(0.0, osc(t, 0.3)))
    return p


@clip('clean', 2.0)
def clean(sk, t):
    """Bent low, scrubbing in circles with one hand, the other braced on the knee."""
    T = 2.0
    ang = 2 * math.pi * t / (T / 2)
    p = Pose(sk)
    p.move(0.01 * math.cos(ang), 0.06, -0.16)
    p.r('pelvis', x=34)
    p.r('spine', x=16)
    p.r('chest', x=14, z=4 * math.cos(ang))
    look(p, pitch=-26)
    p.sym('shoulder', z=-10)
    scrub = V((-0.06 + 0.09 * math.cos(ang), -0.52 + 0.06 * math.sin(ang), 0.34))
    p.arm_ik('R', scrub, pole=V((-1.0, 0.5, -0.2)),
             hand_world=hand_orient(sk, 'R', V((0.2, -1.0, 0.0)), V((0, 0, -1))))
    plant(p, spread=0.06, yaw=14, knee_out=10, dl=V((0, -0.06, 0)))
    wr, wh = p.fk()
    knee = wh['shin_L']
    p.arm_ik('L', knee + V((0.02, -0.03, 0.06)), pole=V((1.0, 0.3, -0.4)),
             hand_world=hand_orient(sk, 'L', V((-0.4, -0.7, -0.5)), V((0, 0, -1))))
    p.r('jaw', x=5 + 3 * osc(t, T / 2))
    return p


@clip('washHands', 2.0)
def wash_hands(sk, t):
    T = 2.0
    p = stand(sk, crouch=0.035)
    p.r('chest', x=8)
    look(p, pitch=26, tilt=4 * osc(t, T))
    rub = 2 * math.pi * t / (T / 4)
    c = V((0.0, -0.34, COUNTER_Z + 0.04))
    for s in ('L', 'R'):
        off = V((sgn(s) * 0.035, 0.02 * math.sin(rub + (0 if s == 'L' else math.pi)),
                 0.015 * math.cos(rub + (0 if s == 'L' else math.pi))))
        p.arm_ik(s, c + off, pole=V((sgn(s) * 1.0, 0.4, -0.6)),
                 hand_world=hand_orient(sk, s, V((-sgn(s) * 0.4, -1.0, -0.4)), V((-sgn(s), 0, 0))))
    plant(p)
    p.r('jaw', x=3)
    return p


@clip('shower', 3.0)
def shower(sk, t):
    T = 3.0
    p = stand(sk, crouch=0.02)
    p.r('chest', x=-6)
    sway = osc(t, T)
    p.move(dx=0.012 * sway)
    look(p, pitch=-26, tilt=8 * sway)          # face up into the spray (look pitch < 0 = up)
    scrub = keyed(t, [(0.0, 0.0), (1.2, 0.0), (1.5, 1.0), (2.6, 1.0), (2.9, 0.0), (3.0, 0.0)])
    w = osc(t, 0.4)
    for s in ('L', 'R'):
        top = head_pt(p, (sgn(s) * 0.07, 0.0, 1.66)) + V((0, 0.0, 0.01 * w * sgn(s)))
        pit = V((sgn(s) * 0.05, -0.12, 1.08 + 0.02 * w * sgn(s)))
        tgt = top.lerp(pit, scrub if s == 'R' else 0.0)
        p.arm_ik(s, tgt, pole=V((sgn(s) * 1.0, 0.2, 0.0 if s == 'L' or scrub < 0.5 else -0.8)),
                 hand_world=hand_orient(sk, s, V((-sgn(s) * 0.6, 0.0, 0.8)), V((-sgn(s), 0, -0.5))))
    if scrub > 0:
        p.side('upperarm', 'L', y=-25 * scrub)
    plant(p)
    p.r('jaw', x=6 + 4 * osc(t, T))
    return p


@clip('paint', 2.4)
def paint(sk, t):
    T = 2.4
    think = keyed(t, [(0.0, 0.0), (1.5, 0.0), (1.7, 1.0), (2.2, 1.0), (2.4, 0.0)])
    p = stand(sk, crouch=0.03)
    p.r('chest', z=6, y=3 * think)
    look(p, pitch=2, yaw=4, tilt=-14 * think)
    ang = 2 * math.pi * t / (T * 0.6)
    stroke = V((-0.06 + 0.12 * math.sin(ang), -0.50, 1.12 + 0.10 * math.sin(2 * ang * 0.5 + 0.4)))
    rest = V((-0.16, -0.36, 1.0))
    tgt = stroke.lerp(rest, think)
    p.arm_ik('R', tgt, pole=V((-1.0, 0.4, -0.6)),
             hand_world=hand_orient(sk, 'R', V((0.3, -1.0, 0.3)), V((1, 0, 0))))
    p.arm_ik('L', V((0.24, -0.22, 0.98)), pole=V((1.0, 0.3, -0.6)),
             hand_world=hand_orient(sk, 'L', V((-0.7, -0.7, 0.0)), V((0, 0, 1))))
    plant(p, dr=V((0, 0.06, 0)))
    p.r('jaw', x=3 + 4 * think)
    return p


@clip('embalm', 2.4)
def embalm(sk, t):
    T = 2.4
    pump = 0.5 + 0.5 * osc(t, T / 3)
    p = Pose(sk)
    p.move(0.0, 0.05, -0.05)
    p.r('pelvis', x=22)
    p.r('spine', x=12)
    p.r('chest', x=14, z=3 * osc(t, T))
    look(p, pitch=-14, yaw=6 * osc(t, T, 0.2), tilt=4 * osc(t, T / 2))
    p.sym('shoulder', z=-10)
    p.arm_ik('L', V((0.10, -0.46, SLAB_Z + 0.02)), pole=V((1.0, 0.4, -0.6)),
             hand_world=hand_orient(sk, 'L', V((-0.4, -1.0, -0.5)), V((0, 0, -1))))
    p.arm_ik('R', V((-0.09, -0.48, SLAB_Z + 0.04 + 0.06 * pump)), pole=V((-1.0, 0.4, -0.5)),
             hand_world=hand_orient(sk, 'R', V((0.1, -0.6, -1.0)), V((1, 0, 0))))
    plant(p, spread=0.03, yaw=12)
    p.r('jaw', x=3)
    return p


@clip('stitch', 2.4)
def stitch(sk, t):
    T = 2.4
    pull = keyed(t, [(0.0, 0.0), (0.5, 0.0), (1.1, 1.0), (1.4, 1.0), (2.0, 0.0), (2.4, 0.0)])
    p = stand(sk, crouch=0.03)
    p.r('chest', x=10, z=-4 * pull)
    look(p, pitch=20 - 22 * pull, yaw=-14 * pull)
    p.arm_ik('L', V((0.07, -0.36, TABLE_Z + 0.04)), pole=V((1.0, 0.4, -0.6)),
             hand_world=hand_orient(sk, 'L', V((-0.6, -0.8, -0.2)), V((0, 0, -1))))
    fabric = V((-0.02, -0.38, TABLE_Z + 0.05))
    high = V((-0.30, -0.24, 1.18))
    mid = (fabric + high) * 0.5 + V((-0.06, -0.04, 0.08))
    if pull < 0.5:
        tgt = fabric.lerp(mid, pull * 2)
    else:
        tgt = mid.lerp(high, (pull - 0.5) * 2)
    p.arm_ik('R', tgt, pole=V((-1.0, 0.3, -0.6)),
             hand_world=hand_orient(sk, 'R', V((0.3, -0.6, 0.3 + 0.4 * pull)), V((0.6, 0, -0.6))))
    plant(p)
    p.r('jaw', x=2)
    return p


@clip('read', 4.0)
def read(sk, t):
    T = 4.0
    turn = keyed(t, [(0.0, 0.0), (2.5, 0.0), (2.8, 1.0), (3.1, 0.0), (4.0, 0.0)])
    p = stand(sk, crouch=0.03)
    breathe(p, t, T / 2, 0.8)
    look(p, pitch=28, yaw=-4 * osc(t, T), tilt=5)
    wr, wh = p.fk()
    center = wh['chest'] + V((0.0, -0.30, -0.06))
    for s in ('L', 'R'):
        p.arm_ik(s, center + V((sgn(s) * 0.10, 0, 0)), pole=V((sgn(s) * 0.9, 0.4, -0.8)),
                 hand_world=hand_orient(sk, s, V((-sgn(s) * 0.25, -0.35, 1.0)), V((-sgn(s) * 0.3, 0.6, 0.3))))
    if turn > 0:
        tgt = center + V((-0.10 + 0.16 * turn, -0.03 * turn, 0.04 * turn))
        p.arm_ik('R', tgt, pole=V((-0.9, 0.4, -0.8)),
                 hand_world=hand_orient(sk, 'R', V((0.6, -0.5, 0.5)), V((0.3, 0.6, 0.3))))
    plant(p)
    p.r('jaw', x=2 + 2 * osc(t, 0.8))
    return p


# ------------------------------------------------------------------------------------------------ one-shots

def _stand_neutral(sk) -> Pose:
    p = stand(sk, crouch=0.025)
    plant(p)
    return p


def _pickup_bend(sk) -> Pose:
    p = Pose(sk)
    p.move(0.0, 0.10, -0.32)
    p.r('pelvis', x=42)
    p.r('spine', x=23)
    p.r('chest', x=21)
    look(p, pitch=-26)
    p.sym('shoulder', z=-9)
    relaxed_arms(p)
    p.side('upperarm', 'L', x=-10, y=-10)
    plant(p, spread=0.03, yaw=10, knee_out=10, dr=V((0, 0.05, 0)))
    p.arm_ik('R', V((-0.13, -0.34, 0.07)), pole=V((-1.0, 0.5, -0.4)),
             hand_world=hand_orient(sk, 'R', V((0.2, -0.6, -1.0)), V((0.3, -0.2, -1.0))))
    p.r('jaw', x=7)
    return p


def _pickup_carry(sk) -> Pose:
    from ..skeleton import CARRY_POSE_L, mirror_name
    p = stand(sk, crouch=0.025)
    for k, v in CARRY_POSE_L.items():
        if k.endswith('_L'):
            p.rot.pop(mirror_name(k), None)
            p.side(k[:-2], 'R', *v)
    p.side('forearm', 'R', x=16)  # undo the relaxed_arms bend contribution
    plant(p)
    return p


@clip('pickup', 1.2, loop=False)
def pickup(sk, t):
    """Bend, grab from the floor, stand back up holding the item in the carry pose (last frame is held)."""
    a = _stand_neutral(sk)
    b = _pickup_bend(sk)
    c = _pickup_carry(sk)
    if t < 0.42:
        return blend(a, b, ease(t / 0.42))
    if t < 0.62:
        return b
    if t < 1.05:
        return blend(b, c, ease((t - 0.62) / 0.43))
    return c


@clip('collapse', 1.6, loop=False)
def collapse(sk, t):
    """Sway, knees buckle, topple backwards and end lying on the floor (matches the 'sleep' layout)."""
    start = _stand_neutral(sk)
    wob = keyed(t, [(0.0, 0.0), (0.15, 1.0), (0.3, -1.0), (0.45, 0.6)])
    if t < 0.45:
        p = start.copy()
        p.r('chest', y=10 * wob)
        p.r('head', y=14 * wob, x=8 * abs(wob))
        p.r('jaw', x=10 * abs(wob))
        return p
    knees = Pose(sk)
    knees.move(0.02, 0.04, -0.28)
    knees.r('pelvis', x=-14)
    knees.r('spine', x=-6)
    knees.r('chest', x=-8, y=-6)
    look(knees, pitch=24, tilt=12)
    knees.sym('upperarm', x=-30, y=-40)
    knees.sym('forearm', x=-30)
    plant(knees, spread=0.05, knee_out=12, dl=V((0, -0.08, 0)), dr=V((0, -0.04, 0)))
    lying = lie_base(sk)
    lying.r('head', z=-16, y=6)
    lying.sym('upperarm', y=-55, x=-10)
    lying.sym('forearm', x=-35, z=-30)
    lying.sym('thigh', y=-6)
    lying.r('jaw', x=16)
    if t < 0.8:
        k = ease((t - 0.45) / 0.35)
        return blend(start, knees, k)
    if t < 1.3:
        k = ease_in((t - 0.8) / 0.5)
        p = blend(knees, lying, k)
        return p
    k = (t - 1.3) / 0.3
    bounce = math.sin(math.pi * min(1.0, k)) * (1 - k) * 0.03
    p = lying.copy()
    p.move(dz=bounce)
    p.r('head', x=-10 * math.sin(math.pi * min(1.0, k)))
    return p


@clip('yawn', 2.0, loop=False)
def yawn(sk, t):
    y = keyed(t, [(0.0, 0.0), (0.45, 1.0), (1.15, 1.0), (1.6, 0.15), (2.0, 0.0)])
    shiver = math.sin(t * 40.0) * pulse(t, 2.0, 0.65, 0.08)
    p = stand(sk, crouch=0.025)
    p.r('spine', x=-6 * y)
    p.r('chest', x=-12 * y + 2 * shiver)
    look(p, pitch=-24 * y, tilt=-6 * y)        # head tips back for the big yawn
    p.sym('shoulder', y=-12 * y)
    for s in ('L', 'R'):
        p.side('upperarm', s, x=-30 * y, y=-(100 * y))
        p.side('forearm', s, x=-16 * (1 - y) - 40 * y, z=-60 * y)
        p.side('hand', s, x=-20 * y)
    plant(p, dl=V((0, 0, 0.03 * y)), dr=V((0, 0, 0.03 * y)), pitch_l=18 * y, pitch_r=18 * y)
    p.r('jaw', x=3 + 30 * y)
    return p
