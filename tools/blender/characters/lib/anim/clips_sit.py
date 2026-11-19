"""Seated + lying clips: sit, sitEat, sitTalk, sitTV, sitComputer, sitRead, sitChess, bath, sleep, beEmbalmed."""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

from ..consts import DIM
from .base import (LIE_Y, LIE_Z, PELVIS_REST_Z, breathe, clip, folded_hands, hand_orient, lap_hands, lie_base,
                   look, sgn, sit_base, sit_legs)
from .pose import Pose, ease, keyed, osc, pulse

from .props import CHIN, EAR_L, EAR_R, MOUTH, head_pt, plate_frame, wrist_for_fork_tip, wrist_for_palm  # noqa: F401

V = Vector
TABLE_Z = DIM['TABLE_HEIGHT'] + 0.03


def fork_to_mouth(p: Pose, sk, s: str, plate_tip: Vector, m: float, mouth_off=V((0.0, -0.012, -0.004))) -> None:
    """Eating hand: the tines of a fork held along the fingers travel plate -> mouth (m = 0..1)."""
    mouth = head_pt(p, MOUTH) + mouth_off
    tip = plate_tip.lerp(mouth, m)
    sx = sgn(s)
    f0 = V((sx * -0.15, -0.55, -0.82))            # at the plate: fingers forward-down, fork digging in
    f1 = V((sx * 0.30, 0.82, 0.48))               # at the mouth: fork pointing back into the mouth
    fingers = f0.lerp(f1, m).normalized()
    palm = V((sx * 0.55, 0.0, -0.85)).lerp(V((sx * 0.9, 0.0, -0.45)), m)
    p.arm_ik(s, wrist_for_fork_tip(tip, fingers, palm), pole=V((sx * 0.9, 0.3, -0.7)),
             hand_world=hand_orient(sk, s, fingers, palm))


def hold_plate(p: Pose, sk, s: str, palm_pos: Vector) -> None:
    """Upturned palm under a plate (the carried plate is anchored to this hand, see props.plate_frame)."""
    fingers = V((-sgn(s) * 0.55, -0.82, 0.0))
    palm = V((0.0, 0.0, 1.0))
    p.arm_ik(s, wrist_for_palm(palm_pos, fingers, palm), pole=V((sgn(s) * 0.9, 0.5, -0.6)),
             hand_world=hand_orient(sk, s, fingers, palm))


@clip('sit', 4.0)
def sit(sk, t):
    """Waiting on a chair: settled back a little, one foot forward tapping and the other tucked under, hands resting
    on the lap (the right one drums its fingers on the left), head drifting round the room and back."""
    T = 4.0
    p = sit_base(sk, lean=-4, slouch=0.25)
    breathe(p, t, T / 2)
    gaze = keyed(t, [(0.0, 4.0), (0.6, 4.0), (1.2, -22.0), (2.0, -22.0), (2.6, 14.0), (3.3, 14.0), (4.0, 4.0)])
    tilt = keyed(t, [(0.0, 3.0), (1.2, -6.0), (2.0, -6.0), (2.6, 9.0), (3.3, 9.0), (4.0, 3.0)])
    look(p, yaw=gaze, pitch=-4 + 3 * osc(t, T, 0.3), tilt=tilt + 6 * pulse(t, T, 0.55, 0.04))
    p.r('chest', z=0.25 * gaze, y=-2 * osc(t, T, 0.1))
    tap = pulse(t, 0.5, 0.0, 0.25) * keyed(t, [(0.0, 0.0), (0.9, 0.0), (1.1, 1.0), (2.3, 1.0), (2.5, 0.0), (4.0, 0.0)])
    sit_legs(p, dl=V((0.015, -0.06, 0.03 * tap)), dr=V((-0.01, 0.13, 0.0)))
    lap_hands(p)
    # right hand drums its fingers on the back of the left hand
    wr, wh = p.fk()
    lap_l = wh['hand_L'] + V((-0.02, -0.01, 0.045))
    drum = pulse(t, 0.24, 0.0, 0.3) * keyed(t, [(0.0, 0.0), (2.3, 0.0), (2.5, 1.0), (3.5, 1.0), (3.7, 0.0), (4.0, 0.0)])
    p.arm_ik('R', lap_l + V((-0.05, -0.03, 0.015 * drum)), pole=V((-0.7, 0.5, -0.4)),
             hand_world=hand_orient(sk, 'R', V((0.45, -0.85, -0.25 - 0.5 * drum)), V((0.1, 0.0, -1.0))))
    p.r('jaw', x=4 + 2 * osc(t, T, 0.4))
    return p


SIT_PLATE_PALM = V((0.135, -0.33, 0.80))      # left palm under the plate, a hand above the table top


@clip('sitEat', 3.0)
def sit_eat(sk, t):
    """Seated meal: the plate held up on the left palm (works with or without a table), the right hand forks a
    bite, lifts it to the mouth, chews; a greedy second dig on the way back."""
    T = 3.0
    p = sit_base(sk, lean=12)
    breathe(p, t, T, 0.8)
    sit_legs(p)
    m = keyed(t, [(0.0, 0.0), (0.55, 0.0), (1.1, 1.0), (1.65, 1.0), (2.2, 0.0), (3.0, 0.0)])
    chew = max(0.0, osc(t, 0.32)) * (1.0 if 1.0 < t < 2.3 else 0.25)
    look(p, pitch=16 - 26 * m, yaw=-4 + 3 * m)
    hold_plate(p, sk, 'L', SIT_PLATE_PALM)
    plate, *_ = plate_frame(p, 'L')
    dig = 0.012 * osc(t, 0.45) * (1 - m)
    fork_to_mouth(p, sk, 'R', plate + V((-0.035, -0.01, 0.012 + dig)), m)
    p.r('jaw', x=4 + 9 * chew)
    return p


@clip('sitTalk', 3.0)
def sit_talk(sk, t):
    T = 3.0
    p = sit_base(sk, lean=6)
    breathe(p, t, T, 0.8)
    look(p, yaw=12 * osc(t, T, 0.1), pitch=4 * osc(t, T / 2), tilt=6 * osc(t, T, 0.3))
    p.r('chest', z=6 * osc(t, T, 0.1))
    sit_legs(p)
    lap_hands(p)
    g1 = 0.5 + 0.5 * osc(t, T, 0.0)
    g2 = 0.5 + 0.5 * osc(t, T, 0.45)
    wr, wh = p.fk()
    for s, g in (('R', g1), ('L', g2)):
        base = wh['upperarm_' + s] + V((sgn(s) * 0.06, -0.30, -0.28 + 0.16 * g))
        p.arm_ik(s, base + V((0, 0, 0.02 * osc(t, 0.6, 0.2))), pole=V((sgn(s) * 0.8, 0.4, -0.8)),
                 hand_world=hand_orient(sk, s, V((-sgn(s) * 0.4, -0.8, 0.5 * g)), V((-sgn(s) * 0.2, -0.3, 1.0))))
    p.r('jaw', x=4 + 6 * max(0.0, osc(t, 0.27)))
    return p


@clip('sitTV', 5.0)
def sit_tv(sk, t):
    """Couch potato: slumped deep with the legs sprawled, remote resting on the armrest - aims it at the TV and
    clicks twice, scratches the belly, then slowly nods off (head sinking, jaw dropping) and jerks awake."""
    T = 5.0
    aim = keyed(t, [(0.0, 0.0), (0.9, 0.0), (1.25, 1.0), (1.95, 1.0), (2.35, 0.0), (5.0, 0.0)])
    click = pulse(t, T, 1.45 / T, 0.02) + pulse(t, T, 1.72 / T, 0.02)
    scratch = keyed(t, [(0.0, 0.0), (2.4, 0.0), (2.6, 1.0), (3.15, 1.0), (3.35, 0.0), (5.0, 0.0)])
    doze = keyed(t, [(0.0, 0.0), (3.3, 0.0), (4.35, 1.0), (4.47, 0.0), (5.0, 0.0)])
    jolt = pulse(t, T, 4.5 / T, 0.025)
    p = sit_base(sk, slouch=1.0)
    breathe(p, t, T / 2, 1.2)
    p.r('chest', x=4 * doze - 3 * jolt, y=-3 * aim)
    look(p, pitch=-6 + 40 * doze - 10 * jolt, tilt=9 - 5 * aim + 6 * doze + 8 * jolt, yaw=-3 + 4 * aim, neck_share=0.45)
    sit_legs(p, feet_y=-0.54, splay=0.06, dl=V((0.02, -0.02, 0.0)), dr=V((-0.02, 0.03, 0.0)))
    wr, wh = p.fk()
    belly = wh['spine'] + wr['spine'] @ V((0.0, -0.13, 0.06))
    rub = 0.014 * scratch * osc(t, 0.22)
    p.arm_ik('L', belly + V((0.02 + rub, -0.02, 0.01 * scratch)), pole=V((1, 0.3, -0.5)),
             hand_world=hand_orient(sk, 'L', V((-1, -0.1, 0.2 - 0.6 * scratch)), V((0.1, 1.0, 0.0))))
    # right hand: on the armrest holding the remote; lifts it toward the TV and flicks the wrist on each click
    rest = wh['upperarm_R'] + V((-0.20, -0.24, -0.38))
    aimed = wh['upperarm_R'] + V((-0.06, -0.42, -0.12))
    tgt = rest.lerp(aimed, aim) + V((0.0, 0.0, 0.012 * click))
    fingers = V((0.0, -1.0, -0.3)).lerp(V((0.05, -1.0, 0.05 - 0.35 * click)), aim)
    p.arm_ik('R', tgt, pole=V((-1, 0.3, -0.4)),
             hand_world=hand_orient(sk, 'R', fingers, V((1.0, 0.0, -0.2)).lerp(V((0.3, 0.0, -1.0)), aim)))
    p.r('jaw', x=7 + 2 * osc(t, T) + 14 * doze)
    return p


@clip('sitComputer', 2.0)
def sit_computer(sk, t):
    T = 2.0
    p = sit_base(sk, lean=12)
    p.r('neck', x=8)
    look(p, pitch=-4 + 2 * osc(t, T), yaw=3 * osc(t, T, 0.2))
    p.sym('shoulder', y=-6)
    sit_legs(p)
    for s in ('L', 'R'):
        tap = pulse(t, 0.25, 0.0 if s == 'L' else 0.5, 0.25) * 0.012
        drift = 0.02 * osc(t, T, 0.0 if s == 'L' else 0.4)
        tgt = V((sgn(s) * 0.11 + drift * 0.5, -0.38 + drift * 0.3, TABLE_Z + 0.025 + tap))
        p.arm_ik(s, tgt, pole=V((sgn(s) * 0.9, 0.5, -0.6)),
                 hand_world=hand_orient(sk, s, V((-sgn(s) * 0.2, -1, -0.35)), V((0, 0, -1))))
    p.r('jaw', x=3)
    return p


def _book_hands(p: Pose, sk, center: Vector, open_width: float = 0.10, tilt_back: float = 0.6):
    for s in ('L', 'R'):
        tgt = center + V((sgn(s) * open_width, 0.0, 0.0))
        p.arm_ik(s, tgt, pole=V((sgn(s) * 0.9, 0.4, -0.8)),
                 hand_world=hand_orient(sk, s, V((-sgn(s) * 0.25, -0.35, 1.0)), V((-sgn(s) * 0.3, tilt_back, 0.3))))


@clip('sitRead', 4.0)
def sit_read(sk, t):
    T = 4.0
    p = sit_base(sk, lean=4)
    breathe(p, t, T / 2, 0.9)
    turn = keyed(t, [(0.0, 0.0), (2.4, 0.0), (2.7, 1.0), (3.0, 0.0), (4.0, 0.0)])
    look(p, pitch=26, yaw=-4 * osc(t, T), tilt=4)
    sit_legs(p)
    wr, wh = p.fk()
    center = wh['chest'] + V((0.0, -0.30, -0.10))
    _book_hands(p, sk, center)
    if turn > 0:
        tgt = center + V((-0.10 + 0.16 * turn, -0.03 * turn, 0.04 * turn))
        p.arm_ik('R', tgt, pole=V((-0.9, 0.4, -0.8)),
                 hand_world=hand_orient(sk, 'R', V((0.6, -0.5, 0.5)), V((0.3, 0.6, 0.3))))
    p.r('jaw', x=3 + 2 * osc(t, 0.8))
    return p


@clip('sitChess', 4.0)
def sit_chess(sk, t):
    T = 4.0
    move = keyed(t, [(0.0, 0.0), (2.4, 0.0), (2.9, 1.0), (3.2, 1.0), (3.7, 0.0), (4.0, 0.0)])
    p = sit_base(sk, lean=20)
    breathe(p, t, T / 2, 0.8)
    look(p, pitch=-6 + 8 * move, yaw=-6 * osc(t, T), tilt=8 * (1 - move))
    sit_legs(p)
    chin = head_pt(p, CHIN) + V((0.0, -0.02, -0.04))
    p.arm_ik('L', chin, pole=V((0.6, 0.1, -1.0)),
             hand_world=hand_orient(sk, 'L', V((-0.3, -0.3, 1.0)), V((0, -0.3, 1.0))))
    piece = V((-0.06, -0.42, 0.74 + 0.05 * (1 - move)))
    rest = V((-0.16, -0.30, TABLE_Z + 0.02))
    p.arm_ik('R', rest.lerp(piece, move), pole=V((-0.9, 0.3, -0.6)),
             hand_world=hand_orient(sk, 'R', V((0.2, -0.8, -0.6)), V((0.2, -0.2, -1.0))))
    p.r('jaw', x=2 + 2 * pulse(t, T, 0.3, 0.05))
    return p


@clip('bath', 4.0)
def bath(sk, t):
    """Seated low on the tub floor (root at the tub floor), legs forward, leaning back, arms on the rims."""
    T = 4.0
    splash = keyed(t, [(0.0, 0.0), (2.8, 0.0), (3.1, 1.0), (3.4, 0.0), (4.0, 0.0)])
    p = Pose(sk)
    p.move(0.0, 0.08, 0.03 - PELVIS_REST_Z)
    p.r('pelvis', x=-22)
    p.r('spine', x=4)
    p.r('chest', x=6 + 1.2 * osc(t, T / 2))
    look(p, pitch=10 + 3 * osc(t, T), tilt=10 * osc(t, T, 0.2))
    p.sym('shoulder', y=-6)
    for s in ('L', 'R'):
        p.leg_ik(s, V((sgn(s) * 0.13, -0.68, 0.09 + 0.06 * (0.5 + 0.5 * osc(t, T, 0.25 if s == 'L' else 0.6)))),
                 foot_pitch=-30, foot_yaw=10 * sgn(s), knee_out=6)
    wr, wh = p.fk()
    for s in ('L', 'R'):
        rim = V((sgn(s) * 0.36, wh['chest'].y + 0.02, DIM['TUB_RIM'] - 0.06))
        if s == 'R':
            rim = rim + V((0.08 * splash, -0.15 * splash, -0.2 * splash))
        p.arm_ik(s, rim, pole=V((sgn(s) * 0.7, 0.6, -0.6)),
                 hand_world=hand_orient(sk, s, V((sgn(s) * 1.0, -0.3, -0.4)), V((0, 0, -1))))
    p.r('jaw', x=4)
    return p


@clip('sleep', 4.0)
def sleep(sk, t):
    """Laid out like a proper corpse, hands folded: slow deep breaths with a snore (chest heave, jaw dropping open),
    head lolled to one side, and a dreaming twitch of the left foot and fingers."""
    T = 4.0
    b = 0.5 + 0.5 * osc(t, T)
    snore = pulse(t, T, 0.2, 0.12)
    kick = pulse(t, T, 0.68, 0.03) + 0.6 * pulse(t, T, 0.74, 0.025)
    p = lie_base(sk)
    p.r('chest', x=-1.8 * b - 1.2 * snore)
    p.r('spine', x=-0.8 * b)
    p.r('head', z=14, y=4 * osc(t, T, 0.3), x=-3 * snore)
    p.side('foot', 'L', x=-14 * kick, z=6 * kick)
    p.side('shin', 'L', x=4 * kick)
    folded_hands(p)
    p.side('hand', 'R', x=-12 * kick)
    p.r('jaw', x=4 + 8 * b + 8 * snore)
    return p


@clip('beEmbalmed', 4.0)
def be_embalmed(sk, t):
    T = 4.0
    tw = pulse(t, T, 0.55, 0.03)
    tw2 = pulse(t, T, 0.85, 0.025)
    p = lie_base(sk)
    p.r('chest', x=-0.6 * osc(t, T))
    p.r('head', x=-4, z=6 * tw)
    p.sym('thigh', y=3)
    p.sym('foot', x=-10, z=-10)
    p.side('foot', 'L', x=-15 * tw2)
    for s in ('L', 'R'):
        p.side('upperarm', s, x=2, y=-8)
        p.side('forearm', s, x=-4, z=-20)
        p.side('hand', s, y=4 + (18 * tw if s == 'R' else 0))
    p.r('jaw', x=2)
    return p
