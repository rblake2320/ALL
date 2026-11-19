"""Shared pose builders + the clip registry. All clip functions are f(sk, t) -> Pose, loops are periodic in t."""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

from ..consts import DIM
from .pose import Pose, osc, pulse

V = Vector

REST_ANKLE = {'L': V((0.096, 0.012, 0.085)), 'R': V((-0.096, 0.012, 0.085))}
PELVIS_REST_Z = 0.66
SEAT_Z = DIM['SEAT_HEIGHT']          # sit*: pelvis (seat point) at this height
LIE_Z = 0.11                         # lying: pelvis head height so the back rests on y=0
LIE_Y = -0.15                        # lying: body centred on the origin (head toward +Y Blender)

CLIPS: dict[str, dict] = {}


def clip(name: str, duration: float, loop: bool = True):
    """Register a clip. Durations are rounded to an even number of frames at 30 fps."""
    frames = int(round(duration * 30))
    if frames % 2:
        frames += 1

    def deco(fn):
        CLIPS[name] = {'fn': fn, 'frames': frames, 'loop': loop, 'duration': frames / 30.0}
        return fn
    return deco


def sgn(s: str) -> float:
    return 1.0 if s == 'L' else -1.0


def upper_hunch(p: Pose, k: float = 1.0) -> Pose:
    p.r('pelvis', x=2 * k)
    p.r('spine', x=5 * k)
    p.r('chest', x=9 * k)
    p.r('neck', x=8 * k)
    p.r('head', x=-20 * k)  # nearly cancels the hunch so faces stay readable from the elevated game camera
    p.sym('shoulder', z=-7 * k, y=2 * k)
    return p


def relaxed_arms(p: Pose, k: float = 1.0) -> Pose:
    p.sym('upperarm', x=-6 * k, y=6)
    p.sym('forearm', x=-16 * k, z=-10)
    p.sym('hand', y=10 * k)
    return p


def zombie_arms(p: Pose, raise_deg: float = 62.0, bend: float = 22.0, droop: float = 32.0) -> Pose:
    """Classic half-raised zombie arms: forward, palms down, droopy wrists."""
    p.sym('upperarm', x=-raise_deg, y=5)
    p.sym('forearm', x=-bend, z=-80)
    p.sym('hand', y=droop)
    return p


def plant(p: Pose, spread: float = 0.0, yaw: float = 8.0, dl: Vector | None = None, dr: Vector | None = None,
          pitch_l: float = 0.0, pitch_r: float = 0.0, knee_out: float = 0.0) -> Pose:
    l = REST_ANKLE['L'] + V((spread, 0, 0)) + (dl if dl is not None else V((0, 0, 0)))
    r = REST_ANKLE['R'] + V((-spread, 0, 0)) + (dr if dr is not None else V((0, 0, 0)))
    p.leg_ik('L', l, foot_pitch=pitch_l, foot_yaw=yaw, knee_out=knee_out)
    p.leg_ik('R', r, foot_pitch=pitch_r, foot_yaw=-yaw, knee_out=knee_out)
    return p


def stand(sk, crouch: float = 0.025, hunch: float = 1.0, arms: bool = True) -> Pose:
    """Upper body of the neutral zombie stance (legs NOT yet solved: call plant() last)."""
    p = Pose(sk)
    p.move(0, 0, -crouch)
    upper_hunch(p, hunch)
    if arms:
        relaxed_arms(p)
    return p


def breathe(p: Pose, t: float, period: float, amp: float = 1.4) -> Pose:
    p.r('chest', x=amp * osc(t, period))
    p.sym('shoulder', y=-amp * 0.6 * osc(t, period))
    return p


def toe_lift(pitch: float) -> float:
    """Ankle height gain when the foot pivots on its toe (pitch>0) or heel (pitch<0)."""
    r = math.radians(pitch)
    if r > 0:
        return 0.115 * math.sin(r)
    return 0.045 * math.sin(-r)


def sit_base(sk, lean: float = 0.0, slouch: float = 0.0, feet_y: float = -0.40, feet_x: float = 0.115) -> Pose:
    """Seated on a chair: pelvis (seat point) at SEAT_HEIGHT, thighs forward, feet on the floor."""
    p = Pose(sk)
    p.move(0, 0.03 - slouch * 0.08, SEAT_Z - PELVIS_REST_Z)
    p.r('pelvis', x=-8 - 14 * slouch)
    p.r('spine', x=6 + lean * 0.4 - 6 * slouch)
    p.r('chest', x=8 + lean * 0.6 - 4 * slouch)
    p.r('neck', x=6 + lean * 0.2 + 10 * slouch)
    p.r('head', x=-10 - lean * 0.5 - 8 * slouch)
    p.sym('shoulder', z=-6, y=2)
    return p


def sit_legs(p: Pose, feet_y: float = -0.40, feet_x: float = 0.115, splay: float = 0.0, dl=None, dr=None) -> Pose:
    l = V((feet_x + splay, feet_y, 0.085)) + (dl if dl is not None else V((0, 0, 0)))
    r = V((-feet_x - splay, feet_y, 0.085)) + (dr if dr is not None else V((0, 0, 0)))
    p.leg_ik('L', l, foot_yaw=8, knee_out=4)
    p.leg_ik('R', r, foot_yaw=-8, knee_out=4)
    return p


def hand_orient(sk, s: str, fingers: Vector, palm: Vector) -> Matrix:
    """World rotation that points the hand's fingers along `fingers` with the palm facing `palm`."""
    a0 = sk.rest_dir['hand_' + s].normalized()
    w0 = V((-sgn(s), 0.0, 0.0))
    w0 = (w0 - a0 * w0.dot(a0)).normalized()
    F0 = Matrix((a0, w0, a0.cross(w0))).transposed()
    a1 = V(fingers).normalized()
    w1 = V(palm) - a1 * V(palm).dot(a1)
    if w1.length < 1e-6:
        w1 = V((0, 0, -1)) - a1 * (-a1.z)
    w1.normalize()
    F1 = Matrix((a1, w1, a1.cross(w1))).transposed()
    return F1 @ F0.inverted()


def lap_hands(p: Pose, inset: float = 0.62) -> Pose:
    """Hands resting palm-down on the thighs (seated)."""
    wr, wh = p.fk()
    for s in ('L', 'R'):
        knee = wh['shin_' + s]
        hip = wh['thigh_' + s]
        tgt = hip + (knee - hip) * inset + V((0.0, 0.03, 0.07))
        p.arm_ik(s, tgt, pole=V((sgn(s) * 0.7, 0.5, -0.4)),
                 hand_world=hand_orient(p.sk, s, V((-sgn(s) * 0.15, -1.0, -0.25)), V((0, 0, -1))))
    return p


def lie_base(sk, face_up: bool = True) -> Pose:
    """Lying on the back, body centred on the origin, head toward Blender +Y (= glTF/Three -Z)."""
    p = Pose(sk)
    p.move(0.0, LIE_Y, LIE_Z - PELVIS_REST_Z)
    p.r('pelvis', x=-90.0)
    p.r('spine', x=2)
    p.r('chest', x=2)
    p.r('neck', x=8)
    p.r('head', x=6)
    p.sym('thigh', x=-4, y=-3)
    p.sym('shin', x=6)
    p.sym('foot', x=-35, z=10)
    return p


def folded_hands(p: Pose, height: float = 0.13) -> Pose:
    """Corpse pose: hands folded on the belly (works on any torso orientation)."""
    wr, wh = p.fk()
    S = wr['spine']
    belly = wh['spine'] + S @ V((0.0, -height, 0.07))
    up = S @ V((0, 0, 1))
    front = S @ V((0, -1, 0))
    for s in ('L', 'R'):
        tgt = belly + S @ V((sgn(s) * 0.03, 0.0, 0.03 * sgn(s)))
        p.arm_ik(s, tgt, pole=S @ V((sgn(s) * 1.0, 0.2, -0.7)),
                 hand_world=hand_orient(p.sk, s, S @ V((-sgn(s), 0.0, 0.35 * sgn(s))), -front))
    return p


def look(p: Pose, yaw: float = 0.0, pitch: float = 0.0, tilt: float = 0.0, neck_share: float = 0.35) -> Pose:
    p.r('neck', x=pitch * neck_share, z=yaw * neck_share, y=tilt * 0.3)
    p.r('head', x=pitch * (1 - neck_share), z=yaw * (1 - neck_share), y=tilt * 0.7)
    return p
