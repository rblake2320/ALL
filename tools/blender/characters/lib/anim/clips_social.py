"""Social standing clips: talk, listen, laugh, cry, flirt, kiss, hug, admire, phone."""
from __future__ import annotations

import math

from mathutils import Vector

from .base import REST_ANKLE, breathe, clip, hand_orient, look, plant, relaxed_arms, sgn, stand
from .clips_sit import EAR_R, MOUTH, head_pt
from .pose import Pose, blend, cosc, ease, keyed, osc, pulse
from .props import phone_hand

V = Vector
# Socials run between zombies on neighbouring tiles: partners stand one tile (1 m) apart, facing each other.
PARTNER_DIST = 1.0


def _yaw_frame(p: Pose):
    """(forward, left) horizontal unit vectors that turn with the chest (targets stay level with the floor)."""
    wr, wh = p.fk()
    f = wr['chest'] @ V((0.0, -1.0, 0.0))
    f = V((f.x, f.y, 0.0)).normalized()
    return f, V((-f.y, f.x, 0.0)), wr, wh


def _gesture(keys, t):
    """Interpolate gesture keys (time, (fwd, out, up), fingers(f, o, u), palm(f, o, u)) -> eased values."""
    if t <= keys[0][0]:
        return keys[0][1:]
    for i in range(len(keys) - 1):
        t0, *a = keys[i]
        t1, *b = keys[i + 1]
        if t <= t1:
            u = ease((t - t0) / (t1 - t0)) if t1 > t0 else 1.0
            return tuple(tuple(x0 + (x1 - x0) * u for x0, x1 in zip(va, vb)) for va, vb in zip(a, b))
    return keys[-1][1:]


# hand keys relative to the shoulder joint in the chest's yaw frame: (forward, outward, up); fingers / palm as
# (forward, outward, up) directions. LOW = arm hanging relaxed, slightly forward.
_LOW = ((0.10, 0.03, -0.52), (0.25, -0.1, -1.0), (0.0, -1.0, 0.1))
_TALK_R = [   # dominant hand: two palm-up beats, the open-handed "you know?", then down to rest
    (0.00, (0.30, 0.02, -0.24), (0.75, -0.30, 0.10), (0.05, -0.15, 1.0)),
    (0.22, (0.32, 0.03, -0.30), (0.80, -0.30, -0.15), (0.0, -0.15, 1.0)),   # beat
    (0.42, (0.31, 0.02, -0.20), (0.75, -0.30, 0.15), (0.05, -0.15, 1.0)),
    (0.62, (0.33, 0.03, -0.30), (0.80, -0.30, -0.15), (0.0, -0.15, 1.0)),   # beat
    (0.95, (0.30, 0.10, -0.24), (0.60, 0.35, 0.25), (0.10, 0.10, 1.0)),
    (1.25, (0.26, 0.20, -0.20), (0.45, 0.70, 0.20), (0.0, 0.25, 1.0)),      # "who knows?" - hands out
    (1.55, (0.27, 0.16, -0.24), (0.50, 0.60, 0.15), (0.0, 0.2, 1.0)),
    (2.05, *_LOW),
    (2.55, *_LOW),
    (3.00, (0.30, 0.02, -0.24), (0.75, -0.30, 0.10), (0.05, -0.15, 1.0)),
]
_TALK_L = [   # off hand: rests, joins the shrug, then jabs a finger at the listener twice
    (0.00, *_LOW),
    (0.70, *_LOW),
    (1.00, (0.24, 0.12, -0.26), (0.60, 0.35, 0.25), (0.10, 0.10, 1.0)),
    (1.25, (0.25, 0.21, -0.20), (0.45, 0.70, 0.20), (0.0, 0.25, 1.0)),      # "who knows?"
    (1.55, (0.30, 0.06, -0.22), (0.85, -0.10, 0.20), (0.0, -1.0, 0.2)),
    (1.72, (0.40, 0.02, -0.16), (0.95, -0.15, 0.25), (0.0, -1.0, 0.1)),     # jab
    (1.86, (0.31, 0.05, -0.21), (0.85, -0.10, 0.20), (0.0, -1.0, 0.2)),
    (2.02, (0.41, 0.02, -0.15), (0.95, -0.15, 0.25), (0.0, -1.0, 0.1)),     # jab
    (2.30, (0.30, 0.06, -0.24), (0.80, -0.10, 0.10), (0.0, -1.0, 0.2)),
    (2.75, *_LOW),
    (3.00, *_LOW),
]


@clip('talk', 3.0)
def talk(sk, t):
    """Chatting with a neighbour: two palm-up beats with the right hand, both hands out for a "who knows?" shrug,
    then the left hand jabs a finger at the listener; leans in on the points, head nodding on the beats."""
    T = 3.0
    shrug = pulse(t, T, 1.25 / T, 0.09)
    jab = pulse(t, T, 1.72 / T, 0.035) + pulse(t, T, 2.02 / T, 0.035)
    beat = pulse(t, T, 0.22 / T, 0.04) + pulse(t, T, 0.62 / T, 0.04)
    lean = keyed(t, [(0.0, 0.3), (0.7, 0.4), (1.25, -0.3), (1.6, 0.6), (2.2, 0.8), (2.7, 0.3), (3.0, 0.3)])
    p = stand(sk, crouch=0.028, arms=False)
    w = osc(t, T, 0.6)
    p.move(0.018 * w, -0.012 * lean, 0.0)
    p.r('pelvis', y=-2.5 * w, z=2 * w)
    p.r('chest', x=4 * lean + 2 * jab, z=-6 * jab + 5 * osc(t, T, 0.1), y=1.5 * w)
    breathe(p, t, T / 2, 0.8)
    p.sym('shoulder', y=-12 * shrug)
    look(p, yaw=6 * osc(t, T, 0.05) - 5 * jab, pitch=-10 + 7 * beat - 4 * shrug + 5 * jab,
         tilt=6 * osc(t, T, 0.3) + 10 * shrug)
    f, left, wr, wh = _yaw_frame(p)
    for s, keys in (('R', _TALK_R), ('L', _TALK_L)):
        k = sgn(s)
        (fw, out, up), fing, palm = _gesture(keys, t)
        out_v = left * k
        tgt = wh['upperarm_' + s] + f * fw + out_v * out + V((0.0, 0.0, up))
        fv = f * fing[0] + out_v * fing[1] + V((0.0, 0.0, fing[2]))
        pv = f * palm[0] + out_v * palm[1] + V((0.0, 0.0, palm[2]))
        p.arm_ik(s, tgt, pole=out_v * 0.9 + V((0.0, 0.0, -0.8)) - f * 0.2,
                 hand_world=hand_orient(sk, s, fv, pv))
    plant(p, spread=0.01, yaw=10, dl=V((0.0, -0.03, 0.0)), dr=V((0.0, 0.03, 0.0)), knee_out=3)
    p.r('jaw', x=4 + 7 * max(0.0, osc(t, 0.26)))
    return p


@clip('listen', 4.0)
def listen(sk, t):
    T = 4.0
    p = stand(sk, crouch=0.025)
    p.move(dx=0.01 * osc(t, T))
    breathe(p, t, T / 2)
    nod = pulse(t, T / 2, 0.3, 0.15)
    look(p, pitch=-8 + 10 * nod, tilt=10 + 3 * osc(t, T), yaw=-6)
    wr, wh = p.fk()
    # arms crossed: each hand to the opposite upper arm
    for s in ('L', 'R'):
        other = 'R' if s == 'L' else 'L'
        elbow_other = wh['forearm_' + other]
        tgt = wh['chest'] + wr['chest'] @ V((-sgn(s) * 0.12, -0.17, 0.0 if s == 'L' else -0.04))
        p.arm_ik(s, tgt, pole=V((sgn(s) * 0.8, -0.2, -0.9)),
                 hand_world=hand_orient(sk, s, V((-sgn(s), -0.2, 0.1)), V((0, 1, 0))))
    plant(p, dl=V((0, -0.02, 0)), dr=V((0.0, 0.04, 0)))
    p.r('jaw', x=2)
    return p


@clip('laugh', 1.6)
def laugh(sk, t):
    """Big belly laugh: head thrown back cackling, then doubled over slapping the knee twice, shoulders and
    belly shaking on every 'ha' (0.2 s)."""
    T = 1.6
    back = keyed(t, [(0.0, 1.0), (0.5, 1.0), (0.78, -1.0), (1.36, -1.0), (1.6, 1.0)])   # +1 back, -1 doubled over
    up, down = max(0.0, back), max(0.0, -back)
    ha = 0.5 + 0.5 * osc(t, 0.2)
    slap = pulse(t, T, 0.62, 0.05) + pulse(t, T, 0.75, 0.05)
    p = Pose(sk)
    p.move(0.0, -0.03 * up - 0.02 * down, -0.035 - 0.06 * down - 0.012 * ha)
    p.r('pelvis', x=-2 * up + 12 * down)
    p.r('spine', x=-3 * up + 12 * down + 1.5 * ha)
    p.r('chest', x=-6 * up + 14 * down + 2.5 * ha)
    look(p, pitch=-24 * up + 8 * down + 3 * ha, tilt=7 * osc(t, T, 0.2), yaw=5 * down)
    p.sym('shoulder', y=-6 - 7 * ha, z=-6)
    wr, wh = p.fk()
    belly = wh['spine'] + wr['spine'] @ V((0.0, -0.14, 0.05))
    p.arm_ik('L', belly + V((0.05, 0.0, 0.01 * ha)), pole=V((1.0, 0.4, -0.6)),
             hand_world=hand_orient(sk, 'L', V((-1, -0.1, 0.1)), V((0, 1, 0))))
    # right hand: clutching the chest while cackling, slapping the thigh when doubled over
    thigh = wh['thigh_R'] + wr['thigh_R'] @ V((-0.01, -0.13, -0.17))
    chest = wh['chest'] + wr['chest'] @ V((-0.05, -0.15, 0.10))
    tgt = chest.lerp(thigh, down) + V((0.0, 0.0, 0.07 * (1 - slap) * down))
    p.arm_ik('R', tgt, pole=V((-1.0, 0.3, -0.5)),
             hand_world=hand_orient(sk, 'R', V((0.4, -0.6, -0.7 * down + 0.3 * up)), V((0.2, 0.3 * up, -1.0 * down + 0.6 * up))))
    plant(p, spread=0.02, knee_out=6 * down)
    p.r('jaw', x=10 + 14 * ha * (0.5 + 0.5 * up))
    return p


@clip('cry', 2.4)
def cry(sk, t):
    T = 2.4
    sob = pulse(t, T / 3, 0.2, 0.25)
    p = stand(sk, crouch=0.05)
    p.r('spine', x=6)
    p.r('chest', x=10 + 6 * sob)
    look(p, pitch=22 + 6 * sob, yaw=4 * osc(t, T))
    p.sym('shoulder', y=-10 * sob, z=-10)
    face = head_pt(p, (0.0, -0.20, 1.42))
    for s in ('L', 'R'):
        tgt = face + V((sgn(s) * 0.065, -0.02, -0.01 + 0.01 * sob))
        p.arm_ik(s, tgt, pole=V((sgn(s) * 0.6, 0.1, -1.0)),
                 hand_world=hand_orient(sk, s, V((-sgn(s) * 0.3, 0.1, 1.0)), V((0, 1, 0))))
    plant(p, spread=-0.015, knee_out=-6)
    p.r('jaw', x=6 + 6 * sob)
    return p


@clip('flirt', 3.0)
def flirt(sk, t):
    T = 3.0
    sway = osc(t, T)
    shrug = pulse(t, T, 0.6, 0.12)
    p = Pose(sk)
    p.move(0.035 + 0.01 * sway, 0.0, -0.03)
    p.r('pelvis', y=-8 - 2 * sway, z=8)
    p.r('spine', y=4)
    p.r('chest', x=-4, y=6 + 2 * sway, z=-6)
    look(p, yaw=-14, tilt=-14 + 5 * sway, pitch=-6)
    p.sym('shoulder', y=-10 * shrug)
    p.side('shoulder', 'R', y=-6)
    head_back = head_pt(p, (-0.10, 0.10, 1.50))
    p.arm_ik('R', head_back, pole=V((-1.0, 0.5, 0.4)),
             hand_world=hand_orient(sk, 'R', V((0.4, 0.5, 0.6)), V((1, 0, 0))))
    wr, wh = p.fk()
    hip = wh['pelvis'] + V((0.17, 0.0, 0.18))
    p.arm_ik('L', hip, pole=V((1.0, 0.6, 0.0)),
             hand_world=hand_orient(sk, 'L', V((-0.3, 0.3, -1.0)), V((-1, 0, 0))))
    twirl = 0.5 + 0.5 * osc(t, T, 0.25)
    plant(p, dl=V((0.0, 0.0, 0.0)), dr=V((0.05, -0.12, 0.03 + 0.02 * twirl)), pitch_r=40, yaw=12)
    p.r('jaw', x=2)
    return p


@clip('kiss', 2.4)
def kiss(sk, t):
    """Step in toward the partner (one tile away), lean in with the head tilted, hands on their upper arms, eyes
    closed, and the back foot popping up like in an old movie."""
    T = 2.4
    lean = 0.88 + 0.12 * osc(t, T)
    bob = osc(t, T / 2)
    p = Pose(sk)
    p.move(0.03, -0.19 - 0.03 * lean, -0.02)
    p.r('pelvis', x=4 * lean, y=-2)
    p.r('spine', x=5 * lean)
    p.r('chest', x=6 * lean)
    look(p, pitch=-4, tilt=-15 + 2 * bob, yaw=-3)
    wr, wh = p.fk()
    # the partner's upper arms, as seen from here (they step in by the same amount)
    reach_y = -(PARTNER_DIST - 0.22 - 0.13)
    for s in ('L', 'R'):
        tgt = V((sgn(s) * 0.235, reach_y, 1.05 + 0.01 * bob))
        p.arm_ik(s, tgt, pole=V((sgn(s) * 1.0, 0.3, -0.7)),
                 hand_world=hand_orient(sk, s, V((-sgn(s) * 0.2, -0.45, 0.85)), V((-sgn(s), 0.0, 0.0))))
    # weight on the forward left foot; right foot popped up behind
    p.leg_ik('L', V((0.075, -0.33, 0.085)), foot_pitch=0, foot_yaw=6, knee_out=2)
    p.leg_ik('R', V((-0.10, -0.01, 0.33 + 0.025 * bob)), foot_pitch=55, foot_yaw=-8, knee_out=4)
    p.r('jaw', x=1)
    return p


@clip('hug', 2.4)
def hug(sk, t):
    """Step in to the partner one tile away and wrap both arms around them - left arm high over their shoulder,
    right arm round their waist (the partner mirrors it, so the arms interleave) - head resting to the left,
    a slow sway and two pats on the back."""
    T = 2.4
    sway = osc(t, T)
    pat = pulse(t, T, 0.55, 0.045) + pulse(t, T, 0.68, 0.045)
    squeeze = 0.5 + 0.5 * cosc(t, T)
    p = Pose(sk)
    p.move(0.015 * sway, -0.27, -0.035)
    p.r('pelvis', x=5, y=-2 * sway, z=4 * sway)
    p.r('spine', x=5)
    p.r('chest', x=7 + 2 * squeeze, y=3 * sway)
    look(p, yaw=26, pitch=4, tilt=12 + 3 * sway)        # cheek on the partner's right shoulder
    p.sym('shoulder', z=-8, y=-3 * squeeze)
    back_y = -(PARTNER_DIST - 0.27 + 0.10)                # the partner's back (they stepped in too)
    hi = V((0.03, back_y + 0.02 * squeeze, 1.20 + 0.012 * sway))
    lo = V((-0.03, back_y + 0.03 - 0.05 * pat, 0.96 - 0.012 * sway))
    p.arm_ik('L', hi, pole=V((1.0, 0.15, 0.35)),
             hand_world=hand_orient(sk, 'L', V((-1.0, 0.1, -0.15)), V((0.0, 1.0, 0.0))))
    p.arm_ik('R', lo, pole=V((-1.0, 0.15, -0.45)),
             hand_world=hand_orient(sk, 'R', V((1.0, 0.1, 0.1)), V((0.0, 1.0, 0.0))))
    p.leg_ik('L', V((0.10, -0.40, 0.085)), foot_pitch=0, foot_yaw=6, knee_out=2)
    p.leg_ik('R', V((-0.10, -0.14, 0.085 + 0.02)), foot_pitch=16, foot_yaw=-10, knee_out=2)
    p.r('jaw', x=2)
    return p


def _admire_base(sk, t, flexing: bool):
    T = 3.0
    turn = osc(t, T)
    p = Pose(sk)
    p.move(0.02 * turn, 0.0, -0.025)
    p.r('pelvis', z=10 * turn)
    p.r('spine', x=-2)
    p.r('chest', x=-6, z=8 * turn)
    look(p, yaw=-10 * turn, tilt=-8 * turn, pitch=-4)
    wr, wh = p.fk()
    hip = wh['pelvis'] + wr['pelvis'] @ V((0.17, 0.0, 0.17))
    p.arm_ik('L', hip, pole=V((1.0, 0.6, 0.0)),
             hand_world=hand_orient(sk, 'L', V((-0.3, 0.3, -1.0)), V((-1, 0, 0))))
    if flexing:
        p.side('upperarm', 'R', x=-10, y=-88)
        p.side('forearm', 'R', x=-125, z=-90)
        p.side('hand', 'R', y=-25)
        p.side('shoulder', 'R', y=-8)
    else:
        hair = head_pt(p, (-0.12, -0.02, 1.58))
        p.arm_ik('R', hair, pole=V((-1.0, 0.2, 0.4)),
                 hand_world=hand_orient(sk, 'R', V((0.6, 0.0, 0.8)), V((1, 0, -0.2))))
    plant(p, spread=0.02, yaw=14)
    p.r('jaw', x=2)
    return p


@clip('admire', 3.0)
def admire(sk, t):
    """Mirror posing: hand on hip, fixes the hair, then flexes a (questionable) bicep."""
    flex = keyed(t, [(0.0, 0.0), (1.2, 0.0), (1.5, 1.0), (2.1, 1.0), (2.4, 0.0), (3.0, 0.0)])
    a = _admire_base(sk, t, False)
    if flex <= 0.0:
        return a
    b = _admire_base(sk, t, True)
    return blend(a, b, flex)


@clip('phone', 3.0)
def phone(sk, t):
    """Chatting on a chunky phone pressed to the right ear (the carried phone is anchored to this hand); the free
    hand gestures along, a nod and a laugh-tilt now and then."""
    T = 3.0
    p = stand(sk, crouch=0.03)
    p.move(dx=-0.012 * osc(t, T))
    breathe(p, t, T / 2, 0.8)
    look(p, tilt=-12 + 3 * osc(t, T), yaw=6 * osc(t, T, 0.3), pitch=-4 + 6 * pulse(t, T / 2, 0.1, 0.2))
    wrist, fingers, palm = phone_hand(p)
    p.arm_ik('R', wrist, pole=V((-0.7, 0.2, -1.0)), hand_world=hand_orient(sk, 'R', fingers, palm))
    g = pulse(t, T, 0.55, 0.18)
    p.side('upperarm', 'L', x=-10 - 25 * g, y=-5)
    p.side('forearm', 'L', x=-20 - 60 * g, z=-30 * g)
    p.side('hand', 'L', x=-20 * g)
    plant(p, dl=V((0.0, 0.0, 0.0)), dr=V((0.0, 0.05, 0.0)))
    p.r('jaw', x=3 + 5 * max(0.0, osc(t, 0.3)))
    return p
