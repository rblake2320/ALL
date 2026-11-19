"""Locomotion & full-body clips: idle, walk, limp, crawl, feral, dance, exercise, angry, cheer, wave, stretch,
groan, disgusted, mourn."""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

from .base import (REST_ANKLE, breathe, clip, hand_orient, look, plant, relaxed_arms, sgn, stand, toe_lift,
                   upper_hunch, zombie_arms)
from .pose import Pose, cosc, ease, ease_in, keyed, osc, pulse

V = Vector


def _weight(t: float) -> float:
    """Idle weight shift (+1 = on the left leg, -1 = on the right): hold, shift, hold, shift back (4 s loop)."""
    return keyed(t, [(0.0, 1.0), (1.45, 1.0), (2.05, -1.0), (3.4, -1.0), (4.0, 1.0)])


@clip('idle', 4.0)
def idle(sk, t):
    """Slack zombie idle: the weight sags onto one leg (the other knee bent, heel up) and slowly shifts across,
    loose arms swinging a beat behind the body, head lolling and gazing about, the jaw hanging open; once per
    loop a comedic twitch (head snaps sideways, a shoulder hitches, fingers flick)."""
    T = 4.0
    w = _weight(t)
    w_lag = _weight((t - 0.32) % T)                 # arms/head follow the hips a beat later
    shift = keyed(t, [(0.0, 0.0), (1.45, 0.0), (1.75, 1.0), (2.05, 0.0), (3.4, 0.0), (3.7, 1.0), (4.0, 0.0)])
    tw = pulse(t, T, 0.74, 0.03)                    # the twitch (~0.12 s snap)
    tw_soft = pulse(t, T, 0.755, 0.07)              # ...and its slower settle
    p = Pose(sk)
    p.move(0.032 * w, 0.004, -0.032 - 0.010 * shift + 0.003 * osc(t, T / 2, 0.25))
    # hips drop on the unweighted side (+y raises the right hip), the chest leans back over the weighted leg
    p.r('pelvis', x=3, y=-4.5 * w, z=3 * w)
    p.r('spine', x=5, y=2.0 * w)
    p.r('chest', x=10, y=1.8 * w_lag, z=-2.5 * w_lag + 2 * tw)
    breathe(p, t, T / 2, 1.6)
    p.r('neck', x=8)
    p.sym('shoulder', z=-8, y=2)
    p.side('shoulder', 'R' if w > 0 else 'L', y=-2.5 * abs(w))      # the loaded side's shoulder droops
    p.side('shoulder', 'L', y=-9 * tw)                               # twitch: left shoulder hitches up
    gaze = keyed(t, [(0.0, 8.0), (1.0, -6.0), (1.8, -6.0), (2.7, 10.0), (3.3, 10.0), (4.0, 8.0)])
    look(p, yaw=gaze + 3 * osc(t, T / 2, 0.1), pitch=-26 - 3 * osc(t, T, 0.35) + 2 * tw_soft,
         tilt=-7 * w_lag + 16 * tw - 6 * tw_soft, neck_share=0.3)
    # loose dangling arms: hang slightly forward, swing like pendulums after each weight shift
    for s in ('L', 'R'):
        k = sgn(s)
        sway = w_lag * k                                              # + = this side is the loaded side
        p.side('upperarm', s, x=-7 + 4.5 * osc(t, T, 0.12 if s == 'L' else 0.42) + 3 * shift, y=6 - 2.5 * sway)
        p.side('forearm', s, x=-14 - 5 * osc(t, T, 0.22 if s == 'L' else 0.52), z=-12)
        p.side('hand', s, y=10 + 6 * osc(t, T / 2, 0.3 if s == 'L' else 0.6))
    p.side('hand', 'R', x=-25 * tw_soft)                             # finger flick on the twitch
    p.side('forearm', 'R', x=-14 * tw_soft)
    # legs: loaded leg straight under the hip; the free leg relaxed, knee forward, heel lifted
    free_l = max(0.0, -w)
    free_r = max(0.0, w)
    plant(p, spread=0.012, yaw=9,
          dl=V((0.012 * free_l, -0.05 * free_l, 0.0)), dr=V((-0.012 * free_r, -0.05 * free_r, 0.0)),
          pitch_l=-14 * free_l, pitch_r=-14 * free_r, knee_out=3)
    p.r('jaw', x=7 + 3 * osc(t, T / 2, 0.15) + 8 * tw)
    return p


def _gait(u: float, duty: float, travel: float, lift: float, drag: bool):
    """Foot (dy, dz, pitch) for phase u. Forward is -Y; stance moves the foot from front to back."""
    if u < duty:
        s = u / duty
        y = -travel / 2 + travel * s
        pitch = 26.0 * ease((s - 0.78) / 0.22) if not drag else 14.0 * ease((s - 0.7) / 0.3)
        if s < 0.12 and not drag:
            pitch = -12.0 * (1 - s / 0.12)
        return y, 0.0, pitch
    s = (u - duty) / (1 - duty)
    y = travel / 2 - travel * ease(s)
    if drag:
        return y, 0.012 * math.sin(math.pi * s), 30.0 - 8.0 * s
    z = lift * math.sin(math.pi * s) ** 0.8
    pitch = 26.0 * (1 - ease(s / 0.5)) - 12.0 * ease((s - 0.5) / 0.5)
    return y, z, pitch


WALK_SPEED = 1.3  # m/s at timeScale 1 (DIM: 1.3 tiles per game-minute at 1x)


@clip('walk', 1.0)
def walk(sk, t):
    """Zombie shamble (1 s cycle): a good left leg and a stiff right leg whose toe drags through its swing - the
    body lurches up onto the good leg and sags onto the bad one. Arms held out in front at chest height with
    soft elbows and limp, drooping wrists that bounce a beat behind the steps; shoulders roll with the stride;
    head lolls on a slight tilt with the face forward (readable from the elevated game camera)."""
    T = 1.0
    duty = 0.52
    # Leg reach (0.65 m) caps the stance travel: 0.58 m per stance (~1.1 m/s authored). At the contract's
    # default 1.3 tiles/s the feet shuffle-slide ~14%, which suits a zombie; setMoveSpeed() rescales.
    travel = min(WALK_SPEED * duty * T, 0.58)
    ph = t / T
    lurch = pulse(t, T, 0.26, 0.2)        # up over the good (left) leg at mid-stance
    sag = pulse(t, T, 0.77, 0.2)          # down onto the dragging (right) leg
    p = Pose(sk)
    p.move(0.022 * cosc(t, T, 0.28) - 0.008 * sag, 0.0,
           -0.05 + 0.016 * cosc(t, T / 2, 0.52) + 0.006 * lurch - 0.012 * sag)
    p.r('pelvis', x=3, z=-7 * cosc(t, T), y=-3.5 * cosc(t, T, 0.28) + 1.5 * lurch)
    p.r('spine', x=4, z=4 * cosc(t, T), y=1.0 * cosc(t, T, 0.28))
    p.r('chest', x=6 + 2 * sag, z=6 * cosc(t, T, 0.04), y=2.0 * cosc(t, T, 0.3) - 3.5 * sag + 1.5 * lurch)
    p.r('neck', x=6)
    nod = cosc(t, T / 2, 0.62)                                   # head bobs a beat after the pelvis
    p.r('head', x=-26 + 3 * nod, y=7 + 4 * osc(t, T, 0.15) - 3 * sag, z=-4 * osc(t, T, 0.05))
    p.sym('shoulder', z=-9, y=1)
    for s in ('L', 'R'):
        ph_s = 0.0 if s == 'L' else 0.5
        p.side('shoulder', s, y=-3 * pulse(t, T, ph_s + 0.25, 0.2), z=2.5 * cosc(t, T, ph_s))
    # arms: wrists in front of the shoulders at chest height (world frame, turning with the shoulders)
    wr, wh = p.fk()
    fwd = wr['chest'] @ V((0.0, -1.0, 0.0))
    fwd = V((fwd.x, fwd.y, 0.0)).normalized()
    side = V((-fwd.y, fwd.x, 0.0))                                 # +X-ish (character's left)
    for s in ('L', 'R'):
        k = sgn(s)
        sh = wh['upperarm_' + s]
        bounce = 0.02 * cosc(t, T / 2, 0.70)                       # hands lag the body bob
        swing = 0.025 * cosc(t, T, 0.0 if s == 'L' else 0.5)      # tiny swing against the legs
        lift = 0.05 if s == 'L' else 0.0                           # the left arm reaches a little higher
        tgt = sh + fwd * (0.515 + swing) + side * (-k * 0.05) + V((0.0, 0.0, -0.14 + lift + bounce))
        droop = 50 + 12 * cosc(t, T / 2, 0.82)                    # floppy wrists flap with the steps
        dr = math.radians(droop)
        fingers = fwd * math.cos(dr) + V((0.0, 0.0, -math.sin(dr))) + side * (-k * 0.12)
        palm = -fwd * math.sin(dr) + V((0.0, 0.0, -math.cos(dr)))
        p.arm_ik(s, tgt, pole=side * (k * 0.9) + V((0.0, 0.0, -0.7)),
                 hand_world=hand_orient(sk, s, fingers, palm))
    p.r('jaw', x=6 + 3 * osc(t, T / 2))
    for s in ('L', 'R'):
        u = (ph + (0.0 if s == 'L' else 0.5)) % 1.0
        drag = s == 'R'
        dy, dz, pitch = _gait(u, duty, travel, 0.075, drag)
        base = REST_ANKLE[s] + V((0.012 * sgn(s) if not drag else -0.02, 0.0, 0.0))
        tgt = base + V((0.0, dy, dz + toe_lift(pitch)))
        p.leg_ik(s, tgt, foot_pitch=pitch, foot_yaw=(6 if s == 'L' else -20))
    return p


@clip('limp', 1.2)
def limp(sk, t):
    """Left leg missing: hop on the right leg, stump swinging, arms out for balance (mirrored at runtime)."""
    T = 1.2
    hop_T = T / 2
    speed = WALK_SPEED * 0.6
    duty = 0.62
    p = Pose(sk)
    u = (t / hop_T) % 1.0
    hop = math.sin(math.pi * max(0.0, (u - duty) / (1 - duty))) if u > duty else 0.0
    second = 1.0 if t >= hop_T else 0.0
    p.move(-0.045, 0.0, -0.05 + 0.05 * hop - 0.012 * math.sin(math.pi * min(1.0, u / duty)))
    p.r('pelvis', x=8, y=7, z=3 * osc(t, T))
    p.r('spine', x=8, y=-5)
    p.r('chest', x=12, y=-6 + 3 * osc(t, hop_T))
    p.r('neck', x=8)
    p.r('head', x=-18, y=6 * osc(t, T, 0.1) + 4 * second * pulse(t, T, 0.8, 0.1))
    p.sym('shoulder', z=-8)
    # arms out for balance, flapping a little
    p.side('upperarm', 'L', x=-30, y=-42 + 10 * osc(t, hop_T, 0.2))
    p.side('forearm', 'L', x=-30, z=-40)
    p.side('hand', 'L', y=20)
    p.side('upperarm', 'R', x=-50 + 8 * osc(t, hop_T, 0.6), y=-18)
    p.side('forearm', 'R', x=-35, z=-60)
    p.side('hand', 'R', y=25)
    # stump (left thigh) swings with the hops
    p.side('thigh', 'L', x=-20 + 18 * osc(t, hop_T, 0.35), y=-8)
    p.side('shin', 'L', x=10)
    # right leg: stance slides back, hop brings it forward
    travel = speed * duty * hop_T
    if u < duty:
        s = u / duty
        dy, dz, pitch = -travel / 2 + travel * s, 0.0, 18 * ease((s - 0.7) / 0.3)
    else:
        s = (u - duty) / (1 - duty)
        dy, dz, pitch = travel / 2 - travel * ease(s), 0.03 * math.sin(math.pi * s), 18 * (1 - s) - 6 * s
    tgt = REST_ANKLE['R'] + V((-0.03, dy, dz + toe_lift(pitch)))
    p.leg_ik('R', tgt, foot_pitch=pitch, foot_yaw=-10)
    p.r('jaw', x=6 + 4 * hop)
    return p


@clip('crawl', 1.6)
def crawl(sk, t):
    """Both legs missing: prone, propped on the arms, pulling forward hand over hand (root stays put)."""
    T = 1.6
    p = Pose(sk)
    surge = 0.03 * osc(t, T / 2, 0.1)
    p.loc = V((0.0, 0.30 + surge, 0.115 - 0.66))
    p.r('pelvis', x=84, y=3 * osc(t, T))
    p.r('spine', x=-8, y=-3 * osc(t, T))
    p.r('chest', x=-22, z=5 * osc(t, T), y=-4 * osc(t, T))
    p.r('neck', x=-10)
    p.r('head', x=-34 + 4 * osc(t, T / 2, 0.3), y=4 * osc(t, T))
    p.sym('thigh', x=-12, y=-6)
    p.side('thigh', 'L', x=6 * osc(t, T, 0.2))
    p.side('thigh', 'R', x=6 * osc(t, T, 0.7))
    p.sym('shin', x=20)
    wr, wh = p.fk()
    for s in ('L', 'R'):
        u = (t / T + (0.0 if s == 'L' else 0.5)) % 1.0
        if u < 0.55:   # planted, pulling
            k = u / 0.55
            y = -0.70 + 0.36 * k
            z = 0.04
        else:          # reach forward
            k = (u - 0.55) / 0.45
            y = -0.34 - 0.36 * ease(k)
            z = 0.04 + 0.12 * math.sin(math.pi * k)
        tgt = V((sgn(s) * 0.2, y, z))
        p.arm_ik(s, tgt, pole=V((sgn(s) * 0.8, 0.5, 0.2)),
                 hand_world=hand_orient(sk, s, V((-sgn(s) * 0.25, -1.0, -0.15)), V((0, 0, -1))))
    p.r('jaw', x=8 + 5 * osc(t, T / 2))
    return p


@clip('feral', 1.0)
def feral(sk, t):
    T = 1.0
    p = Pose(sk)
    j1 = pulse(t, T, 0.18, 0.05)
    j2 = pulse(t, T, 0.62, 0.04)
    p.move(0.02 * osc(t, T), 0.03, -0.17 + 0.012 * osc(t, T / 2))
    p.r('pelvis', x=20, y=3 * osc(t, T), z=4 * osc(t, T, 0.25))
    p.r('spine', x=14, z=-3 * osc(t, T, 0.25))
    p.r('chest', x=16 + 3 * j2, y=-3 * osc(t, T))
    p.r('neck', x=6)
    look(p, yaw=14 * j1 - 10 * j2, pitch=-36 + 6 * j2, tilt=18 * j1)
    p.sym('shoulder', z=-14, y=-8 - 6 * j1)
    zombie_arms(p, raise_deg=48, bend=48, droop=-10)
    p.sym('hand', x=-28)
    p.side('upperarm', 'L', x=6 * j2, y=-12)
    p.side('upperarm', 'R', x=-8 * j1, y=-12)
    p.side('forearm', 'R', x=-10 * j2)
    p.r('jaw', x=12 + 10 * j1 + 6 * j2)
    plant(p, spread=0.07, yaw=22, knee_out=12, dl=V((0, -0.05, 0)), dr=V((0, 0.06, 0)))
    return p


# ------------------------------------------------------------------------------------------------ expressive

def _step_touch(u: float) -> tuple[float, float, float]:
    """Step-touch footwork for one foot over a 4-beat bar (u = bar phase 0..1, LEFT-foot timing).
    Returns (lateral offset, lift, toe pitch): beat 1 steps out, beat 2 holds, beat 3 taps in, beat 4 holds."""
    if u < 0.25:                     # step out (to the side), quick lift arc
        k = ease(u / 0.25)
        return 0.04 + 0.12 * k, 0.07 * math.sin(math.pi * u / 0.25), 18 * math.sin(math.pi * u / 0.25)
    if u < 0.5:                      # weight on it
        return 0.16, 0.0, 0.0
    if u < 0.75:                     # tap back in next to the other foot (toe touches, heel up)
        k = ease((u - 0.5) / 0.25)
        return 0.16 - 0.12 * k, 0.05 * math.sin(math.pi * (u - 0.5) / 0.25), 26 * math.sin(math.pi * (u - 0.5) / 0.25)
    return 0.04, 0.0, 0.0


@clip('dance', 2.0)
def dance(sk, t):
    """Zombie bop at 120 bpm (4 beats / 2 s): step-touch side to side with the weight, knees bouncing on every
    beat, hips swinging, clawed hands sweeping across toward the weighted side, shoulder shimmy, head bob."""
    T = 2.0
    beat = T / 4
    u = (t / T) % 1.0
    w = math.sin(2 * math.pi * (u - 0.125))          # weight: +1 over the left foot, -1 over the right
    bounce = abs(math.cos(math.pi * t / beat))       # 1 on every beat, 0 between
    shimmy = osc(t, beat / 2)
    p = Pose(sk)
    p.move(0.075 * w, 0.0, -0.075 + 0.045 * bounce)
    p.r('pelvis', x=5, y=-7 * w, z=12 * osc(t, T, 0.125))
    p.r('spine', x=5, y=5 * w)
    p.r('chest', x=6 + 3 * (1 - bounce), z=-10 * osc(t, T, 0.125), y=4 * w)
    look(p, yaw=16 * w, pitch=-6 + 9 * (1 - bounce), tilt=-9 * w)
    p.sym('shoulder', z=-6)
    p.side('shoulder', 'L', y=-9 * shimmy)
    p.side('shoulder', 'R', y=9 * shimmy)
    wr, wh = p.fk()
    chest = wh['chest']
    for s in ('L', 'R'):
        # both claws sweep toward the weighted side at chest height, lifting a little on the off-beat
        sweep = 0.11 * w
        lift = 0.07 * (1 - bounce) + 0.04 * (1 if (w > 0) == (s == 'L') else 0)
        tgt = chest + V((sgn(s) * 0.15 + sweep, -0.33, 0.12 + lift))
        # bent-wrist zombie claw: fingers forward and drooping, palms down
        p.arm_ik(s, tgt, pole=V((sgn(s) * 1.0, 0.2, -0.7)),
                 hand_world=hand_orient(sk, s, V((-sgn(s) * 0.15 + 0.25 * w, -0.9, -0.45)), V((0, -0.35, -1))))
    for s in ('L', 'R'):
        lat, lift, pitch = _step_touch((u + (0.0 if s == 'L' else 0.5)) % 1.0)
        tgt = V((sgn(s) * (0.04 + lat), 0.012 - 0.02 * lift, 0.085 + lift + toe_lift(pitch)))
        p.leg_ik(s, tgt, foot_pitch=pitch, foot_yaw=12 * sgn(s), knee_out=10)
    p.r('jaw', x=6 + 10 * bounce)
    return p


@clip('exercise', 2.0)
def exercise(sk, t):
    """Squat + overhead press with an imaginary barbell, trembling with effort."""
    T = 2.0
    k = 0.5 - 0.5 * cosc(t, T)            # 0 = standing (bar overhead), 1 = squatting (bar at shoulders)
    tremble = 0.8 * osc(t, 0.125)
    p = Pose(sk)
    p.move(0.0, 0.05 * k, -0.02 - 0.24 * k)
    p.r('pelvis', x=12 + 22 * k)
    p.r('spine', x=-2 * k)
    p.r('chest', x=-10 * k + tremble)
    p.r('neck', x=2)
    p.r('head', x=-12 - 8 * k)
    wr, wh = p.fk()
    sh_h = (wh['upperarm_L'] + wh['upperarm_R']) * 0.5
    bar_z = sh_h.z + 0.03 + (0.42 * (1 - k))
    for s in ('L', 'R'):
        tgt = V((sgn(s) * 0.25, sh_h.y - 0.10, bar_z))
        p.arm_ik(s, tgt, pole=V((sgn(s) * 1.0, 0.4, -0.6)),
                 hand_world=hand_orient(sk, s, V((0, 0, 1)), V((0, -1, 0))))
    plant(p, spread=0.06, yaw=18, knee_out=14)
    p.r('jaw', x=4 + 8 * k)
    return p


def _stomp(ph: float) -> tuple[float, float]:
    """One stomp per half-cycle phase ph (0..1): knee-high lift, slam down at 0.34, recoil. -> (lift, impact)."""
    if ph < 0.28:
        lift = 0.13 * math.sin(0.5 * math.pi * ph / 0.28)          # rise (ease out)
    elif ph < 0.34:
        lift = 0.13 * (1 - ease_in((ph - 0.28) / 0.06))            # SLAM
    else:
        lift = 0.0
    impact = pulse(ph, 1.0, 0.36, 0.08)
    return lift, impact


@clip('angry', 1.4)
def angry(sk, t):
    """Stomping tantrum: alternate knee-high stomps slammed down every 0.7 s, the body dropping on impact, both
    fists shaken at head height, chest thrust forward and head jutting with a snarl."""
    T = 1.4
    u = (t / T) % 1.0
    lift_l, imp_l = _stomp((u * 2.0) % 1.0) if u < 0.5 else (0.0, 0.0)
    lift_r, imp_r = _stomp((u * 2.0 - 1.0) % 1.0) if u >= 0.5 else (0.0, 0.0)
    imp = imp_l + imp_r
    shake = osc(t, 0.14)
    up_l, up_r = lift_l / 0.13, lift_r / 0.13
    p = Pose(sk)
    p.move(0.03 * (up_r - up_l), -0.02, -0.05 - 0.05 * imp + 0.02 * max(up_l, up_r))
    p.r('pelvis', x=8, y=5 * (up_r - up_l))
    p.r('spine', x=6 + 3 * imp)
    p.r('chest', x=12 + 5 * imp, z=5 * (up_l - up_r))
    p.r('neck', x=12)
    look(p, pitch=-12 + 6 * imp, yaw=5 * shake, tilt=3 * shake)
    p.sym('shoulder', y=-12 - 4 * imp, z=-10)
    wr, wh = p.fk()
    chest = wh['chest']
    for s in ('L', 'R'):
        # clenched fists pumping in front of the chest, elbows out (reads as 'grrr' from the game camera)
        k = shake if s == 'L' else -shake
        tgt = chest + V((sgn(s) * 0.23, -0.30 - 0.03 * imp, 0.11 + 0.05 * k - 0.08 * imp))
        p.arm_ik(s, tgt, pole=V((sgn(s) * 1.0, 0.35, -0.5)),
                 hand_world=hand_orient(sk, s, V((-sgn(s) * 0.55, -0.6, 0.55)), V((-sgn(s) * 0.5, 0.2, -0.85))))
    plant(p, spread=0.05, yaw=14, knee_out=6, dl=V((0, -0.05, lift_l)), dr=V((0, -0.02, lift_r)),
          pitch_l=-8 * up_l, pitch_r=-8 * up_r)
    p.r('jaw', x=9 + 9 * imp + 3 * shake)
    return p


@clip('cheer', 1.2)
def cheer(sk, t):
    T = 1.2
    p = Pose(sk)
    b = 0.5 + 0.5 * cosc(t, T / 2)
    p.move(0.0, 0.0, -0.06 + 0.07 * b)
    p.r('pelvis', x=-2)
    p.r('spine', x=-4)
    p.r('chest', x=-6, y=4 * osc(t, T))
    look(p, pitch=-16 - 6 * b, tilt=8 * osc(t, T, 0.2))   # face up to the sky (look pitch < 0 = up)
    p.sym('shoulder', y=-16)
    for s in ('L', 'R'):
        ph = 0.0 if s == 'L' else 0.25
        pump = osc(t, T / 2, ph)
        p.side('upperarm', s, x=-20, y=-150 - 8 * pump)
        p.side('forearm', s, x=-25 - 20 * pump, z=-90)
        p.side('hand', s, x=-25, y=-30)
    plant(p, spread=0.04, yaw=12, dl=V((0, 0, 0.05 * b)), dr=V((0, 0, 0.05 * b)), pitch_l=30 * b, pitch_r=30 * b)
    p.r('jaw', x=14 + 6 * b)
    return p


@clip('wave', 1.2)
def wave(sk, t):
    T = 1.2
    p = stand(sk, crouch=0.025)
    p.move(dx=-0.012)
    p.r('pelvis', y=2)
    p.r('chest', y=-4, z=6)
    look(p, yaw=4, tilt=-8 + 4 * osc(t, T), pitch=4)
    w = osc(t, T / 2)
    p.side('shoulder', 'R', y=-14)
    p.side('upperarm', 'L', x=3 * osc(t, T))
    wr, wh = p.fk()
    sh = wh['upperarm_R']
    tgt = sh + V((-0.22 - 0.07 * w, -0.10, 0.36 - 0.02 * abs(w)))
    p.arm_ik('R', tgt, pole=V((-1.0, 0.2, -0.7)),
             hand_world=hand_orient(sk, 'R', V((0.35 * w - 0.05, -0.1, 1.0)), V((0.0, -1.0, 0.0))))
    plant(p)
    p.r('jaw', x=6)
    return p


@clip('stretch', 3.0)
def stretch(sk, t):
    T = 3.0
    up = keyed(t, [(0.0, 0.25), (0.6, 1.0), (2.4, 1.0), (3.0, 0.25)])
    lean = keyed(t, [(0.0, 0.0), (0.7, 0.0), (1.1, 1.0), (1.4, 1.0), (1.7, 0.0), (2.0, -1.0), (2.3, -1.0), (2.7, 0.0),
                     (3.0, 0.0)])
    p = Pose(sk)
    p.move(0.03 * lean, 0.0, -0.02 + 0.03 * up)
    p.r('pelvis', y=-4 * lean)
    p.r('spine', x=-4 * up, y=8 * lean)
    p.r('chest', x=-8 * up, y=12 * lean)
    look(p, pitch=-14 * up, tilt=10 * lean)
    p.sym('shoulder', y=-14 * up)
    for s in ('L', 'R'):
        p.side('upperarm', s, x=-30 * up, y=-(40 + 120 * up))
        p.side('forearm', s, x=-30 + 10 * up, z=-90)
        p.side('hand', s, y=-30 * up)
    plant(p, dl=V((0, 0, 0.04 * up)), dr=V((0, 0, 0.04 * up)), pitch_l=25 * up, pitch_r=25 * up)
    p.r('jaw', x=4 + 10 * up)
    return p


@clip('groan', 2.4)
def groan(sk, t):
    T = 2.4
    g = keyed(t, [(0.0, 0.2), (0.6, 1.0), (1.8, 1.0), (2.4, 0.2)])
    p = stand(sk, crouch=0.04, arms=False)
    p.move(dx=0.01 * osc(t, T))
    p.r('spine', x=-4 * g)
    p.r('chest', x=-10 * g + 2 * osc(t, 0.3) * g)
    look(p, pitch=-30 * g, yaw=6 * osc(t, T), tilt=8 * osc(t, T, 0.3))   # head thrown back, moaning at the ceiling
    p.sym('shoulder', y=6, z=-4)
    p.sym('upperarm', x=4, y=10)
    p.sym('forearm', x=-6)
    p.sym('hand', y=4)
    for s in ('L', 'R'):
        p.side('upperarm', s, x=3 * osc(t, T, 0.2 if s == 'L' else 0.6))
    plant(p, spread=0.02)
    p.r('jaw', x=4 + 22 * g + 3 * osc(t, 0.25) * g)
    return p


@clip('disgusted', 1.6)
def disgusted(sk, t):
    T = 1.6
    gag = pulse(t, T, 0.45, 0.12)
    p = Pose(sk)
    p.move(0.02, 0.05, -0.03)
    p.r('pelvis', x=-4)
    p.r('spine', x=-8)
    p.r('chest', x=-12 + 10 * gag, z=-10)
    look(p, yaw=-30, pitch=-6 + 12 * gag, tilt=-10)
    p.sym('shoulder', y=-8)
    p.side('upperarm', 'L', x=-60, y=-10)
    p.side('forearm', 'L', x=-70, z=10)
    p.side('hand', 'L', x=-60, y=-20)
    p.side('upperarm', 'R', x=-40 - 10 * gag, y=-5)
    p.side('forearm', 'R', x=-95 - 20 * gag, z=-60)
    p.side('hand', 'R', y=20)
    plant(p, dl=V((0, 0.04, 0)), dr=V((0, 0.10, 0)), pitch_l=0)
    p.r('jaw', x=4 + 14 * gag)
    return p


@clip('mourn', 3.0)
def mourn(sk, t):
    """Kneeling, head bowed, hands clasped, slow heaving sobs."""
    T = 3.0
    sob = 0.5 + 0.5 * osc(t, T / 2)
    p = Pose(sk)
    p.move(0.0, 0.10, 0.36 - 0.66 - 0.01 * sob)
    p.r('pelvis', x=6)
    p.r('spine', x=10)
    p.r('chest', x=16 + 4 * sob)
    look(p, pitch=30 + 6 * sob, tilt=4 * osc(t, T))
    p.sym('shoulder', z=-12, y=-3 * sob)
    wr, wh = p.fk()
    clasp = wh['chest'] + wr['chest'] @ V((0.0, -0.24, -0.08))
    for s in ('L', 'R'):
        p.arm_ik(s, clasp + wr['chest'] @ V((sgn(s) * 0.03, 0, 0)), pole=V((sgn(s) * 1.0, 0.3, -0.8)),
                 hand_world=hand_orient(sk, s, V((-sgn(s) * 0.3, -0.4, 0.8)), V((-sgn(s), 0, 0))))
    # knees on the floor, shins back
    for s in ('L', 'R'):
        p.leg_ik(s, V((sgn(s) * 0.11, 0.38, 0.09)), foot_pitch=70, foot_yaw=4 * sgn(s))
    p.r('jaw', x=5)
    return p
