"""The nine clips per body plan. Each clip is fn(rig, t_seconds) -> Pose; every one loops exactly.

All periodic terms use whole numbers of cycles per loop, so the pose at t = duration equals the pose at t = 0.
Feet are placed with the planar leg IK, so planted paws do not slide or sink while the body moves.
"""
from __future__ import annotations

import math

from mathutils import Vector

from .rig import Pose, Rig, rx, ry, rz
from .species import CLIP_TIMING, torso_profile, torso_span

V = Vector
TAU = 2 * math.pi


def s(x: float) -> float:
    return math.sin(TAU * x)


def smooth(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def bump(p: float, a: float, b: float) -> float:
    """0 outside [a, b], smooth 0->1->0 inside (p in [0, 1))."""
    if p <= a or p >= b:
        return 0.0
    return math.sin(math.pi * (p - a) / (b - a)) ** 2


def step(ph: float, a: float, h: float, duty: float) -> tuple[float, float]:
    """Foot offset (dy, dz) through one stride: planted and moving back for `duty`, then lifted forward."""
    ph %= 1.0
    if ph < duty:
        return -a + 2 * a * (ph / duty), 0.0
    k = (ph - duty) / (1.0 - duty)
    return a - 2 * a * smooth(k), h * math.sin(math.pi * k)


def tail(pose: Pose, lift: float, amp: float, cycles: float, p: float, curl: float = 0.0, n: int = 3) -> None:
    for i in range(n):
        pose.rot[f'tail_{i + 1}'] = (lift if i == 0 else 0.0, 0.0, curl + amp * s(cycles * p - 0.11 * i))


# ---------------------------------------------------------------------------------------------------
# Quadrupeds
# ---------------------------------------------------------------------------------------------------

def _stand(rig: Rig, pose: Pose, feet: dict | None = None) -> Pose:
    for leg in rig.legs:
        dy, dz = (feet or {}).get(leg, (0.0, 0.0))
        rig.place_foot(pose, leg, dy, dz)
    return pose


def _torso_low(rig: Rig, pose: Pose) -> float:
    """Height of the lowest point of the (pitched) torso above the floor, from the real torso profile."""
    sp = rig.sp
    hips = rig.head['hips']
    R = rx(pose.rot.get('hips', (0.0, 0.0, 0.0))[0])
    y_r, y_f = torso_span(sp)
    r_max = max(sp['body_w'], sp['body_h'])
    low = 1e9
    for i in range(17):
        u = i / 16
        p = hips + pose.loc + R @ V((0.0, y_r + (y_f - y_r) * u - hips.y, 0.0))
        low = min(low, p.z - r_max * torso_profile(sp, u))
    return low


def _rest_on_floor(rig: Rig, pose: Pose, gap: float = 0.003) -> None:
    """Shift the hips vertically so the lowest point of the torso sits `gap` above the floor."""
    pose.loc.z += gap - _torso_low(rig, pose)


def _tail_flat(rig: Rig, pose: Pose, world_deg: float, amp: float, cycles: float, p: float, curl: float) -> None:
    """Tail at `world_deg` above horizontal regardless of the body pitch (so it lies on the floor when seated)."""
    pitch = pose.rot.get('hips', (0.0, 0.0, 0.0))[0]
    tail(pose, world_deg - math.degrees(rig.sp['tail_rise']) - pitch, amp, cycles, p, curl=curl)
    for i in (2, 3):
        r = pose.rot[f'tail_{i}']
        pose.rot[f'tail_{i}'] = (-math.degrees(rig.sp['tail_curl']), r[1], r[2])


def _ears(pose: Pose, a: float, b: float | None = None) -> None:
    pose.rot['ear_L'] = (a, 0.0, 0.0)
    pose.rot['ear_R'] = (a if b is None else b, 0.0, 0.0)


def _sit_base(rig: Rig) -> tuple[Pose, float]:
    """Seated: shoulders stay where they are (front legs straight), the rump comes down onto the floor.

    The body pitch is found by bisection so both hold at once.
    """
    L = rig.sp['L']

    def at(th: float) -> Pose:
        pose = Pose()
        pose.rot['hips'] = (-math.degrees(th), 0.0, 0.0)
        pose.loc = V((0.0, -L * (1 - math.cos(th)), -L * math.sin(th)))
        return pose

    lo, hi = math.radians(2.0), math.radians(70.0)
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        if _torso_low(rig, at(mid)) > 0.003:
            lo = mid
        else:
            hi = mid
    return at(lo), math.degrees(lo)


def quad_idle(rig, p):
    H = rig.sp['H']
    pose = Pose()
    pose.loc = V((0, 0, 0.010 * H * s(p)))
    pose.rot['spine'] = (0.8 * s(p), 0, 0)
    pose.rot['chest'] = (-0.8 * s(p), 0, 0)
    pose.rot['neck'] = (1.5 * s(p), 0, 3.0 * s(p))
    pose.rot['head'] = (2.0 * s(2 * p), 0, 7.0 * s(p))
    tail(pose, 0.0, 14.0, 2, p)
    _ears(pose, -20.0 * bump(p, 0.36, 0.46), -20.0 * bump(p, 0.72, 0.80))
    return _stand(rig, pose)


def quad_walk(rig, p):
    H = rig.sp['H']
    pose = Pose()
    pose.loc = V((0, 0, 0.012 * H * s(2 * p)))
    pose.rot['hips'] = (1.2 * s(2 * p + 0.1), 0, 0)
    pose.rot['neck'] = (-2.0 + 3.0 * s(2 * p), 0, 0)
    pose.rot['head'] = (2.0 * s(2 * p + 0.2), 0, 0)
    tail(pose, 0.0, 9.0, 1, p)
    ph = {'H_L': 0.0, 'F_L': 0.25, 'H_R': 0.5, 'F_R': 0.75}
    return _stand(rig, pose, {k: step(p + v, 0.20 * H, 0.10 * H, 0.64) for k, v in ph.items()})


def _gallop(rig, p, stride: float, lift: float, pitch: float):
    H = rig.sp['H']
    pose = Pose()
    pose.loc = V((0, 0, 0.055 * H * s(p + 0.16)))
    pose.rot['hips'] = (pitch * s(p + 0.05), 0, 0)
    pose.rot['spine'] = (5.0 * s(p + 0.30), 0, 0)
    pose.rot['chest'] = (-5.0 * s(p + 0.30), 0, 0)
    ph = {'F_L': 0.0, 'F_R': 0.12, 'H_L': 0.50, 'H_R': 0.62}
    return pose, {k: step(p + v, stride * H, lift * H, 0.42) for k, v in ph.items()}


def quad_run(rig, p):
    pose, feet = _gallop(rig, p, 0.40, 0.22, 6.0)
    pose.rot['neck'] = (4.0 + 4.0 * s(p + 0.5), 0, 0)
    pose.rot['head'] = (-3.0, 0, 0)
    pose.rot['jaw'] = (8.0, 0, 0)
    tail(pose, -18.0, 5.0, 1, p)
    _ears(pose, -14.0)
    return _stand(rig, pose, feet)


def quad_flee(rig, p):
    pose, feet = _gallop(rig, p, 0.48, 0.24, 8.0)
    pose.rot['neck'] = (20.0 + 3.0 * s(p + 0.5), 0, 0)
    pose.rot['head'] = (-10.0, 0, 0)
    tail(pose, -48.0, 4.0, 1, p)
    _ears(pose, -36.0)
    return _stand(rig, pose, feet)


def quad_sit(rig, p):
    H = rig.sp['H']
    pose, th = _sit_base(rig)
    pose.rot['chest'] = (0.8 * s(p), 0, 0)
    pose.rot['neck'] = (0.50 * th + 1.0 * s(p), 0, 4.0 * s(p))
    pose.rot['head'] = (0.42 * th, 0, 6.0 * s(p + 0.1))
    _tail_flat(rig, pose, 2.0, 4.0, 1, p, curl=30.0)
    _ears(pose, -16.0 * bump(p, 0.55, 0.66))
    return _stand(rig, pose, {'H_L': (-0.20 * H, 0.0), 'H_R': (-0.20 * H, 0.0)})


def quad_sleep(rig, p):
    sp = rig.sp
    H = sp['H']
    pose = Pose()
    _rest_on_floor(rig, pose)
    pose.loc.z += 0.003 * (1 + s(p))
    pose.rot['chest'] = (1.0 * s(p), 0, 0)
    pose.rot['neck'] = (30.0, 0, 6.0)
    pose.rot['head'] = (12.0 + 1.0 * s(p), 0, 8.0)
    _tail_flat(rig, pose, 2.0, 1.5, 1, p, curl=46.0)
    _ears(pose, 12.0)
    feet = {'F_L': (-0.42 * H, 0.0), 'F_R': (-0.42 * H, 0.0), 'H_L': (-0.30 * H, 0.0), 'H_R': (-0.30 * H, 0.0)}
    return _stand(rig, pose, feet)


def quad_eat(rig, p):
    pose = Pose()
    pose.rot['chest'] = (6.0, 0, 0)
    pose.rot['neck'] = (52.0 + 3.0 * s(2 * p), 0, 0)
    pose.rot['head'] = (26.0 + 8.0 * s(2 * p), 0, 0)
    pose.rot['jaw'] = (10.0 + 9.0 * s(4 * p), 0, 0)
    tail(pose, 0.0, 8.0, 1, p)
    return _stand(rig, pose)


def quad_play(rig, p):
    H = rig.sp['H']
    pose = Pose()
    pose.rot['hips'] = (11.0 + 5.0 * s(p), 0, 0)
    pose.loc = V((0, 0, 0.015 * H * (1 + s(2 * p))))
    pose.rot['neck'] = (-26.0, 0, 0)
    pose.rot['head'] = (-8.0, 14.0 * s(2 * p), 0)
    pose.rot['jaw'] = (13.0, 0, 0)
    tail(pose, 26.0, 30.0, 3, p)
    _ears(pose, 6.0)
    return _stand(rig, pose, {'F_L': (-0.30 * H, 0.0), 'F_R': (-0.30 * H, 0.0)})


def quad_beg(rig, p):
    H, L = rig.sp['H'], rig.sp['L']
    pose = Pose()
    pose.rot['hips'] = (-58.0 + 2.0 * s(p), 0, 0)
    pose.loc = V((0, -0.16 * L, 0.0))
    _rest_on_floor(rig, pose)
    pose.rot['neck'] = (34.0, 0, 0)
    pose.rot['head'] = (16.0 + 2.0 * s(p), 0, 0)
    pose.rot['jaw'] = (6.0, 0, 0)
    _tail_flat(rig, pose, 2.0, 5.0, 2, p, curl=12.0)
    _ears(pose, 6.0)
    for i, side in enumerate(('L', 'R')):
        k = s(2 * p + 0.25 * i)
        pose.rot[f'upper_F_{side}'] = (38.0 + 10.0 * k, 0, 0)
        pose.rot[f'lower_F_{side}'] = (-58.0 - 10.0 * k, 0, 0)
        pose.rot[f'paw_F_{side}'] = (30.0, 0, 0)
    for leg in ('H_L', 'H_R'):
        rig.place_foot(pose, leg, -0.36 * H, 0.0)
    return pose


# ---------------------------------------------------------------------------------------------------
# Crow
# ---------------------------------------------------------------------------------------------------

def _wings(pose: Pose, spread: float, flap: float) -> None:
    """Spread = degrees away from the body; flap = degrees up (+) about the body axis."""
    pose.rot['wing_1_L'] = ry(-flap) @ rz(-spread)
    pose.rot['wing_1_R'] = ry(flap) @ rz(spread)
    pose.rot['wing_2_L'] = ry(-0.35 * flap) @ rz(-0.25 * spread)
    pose.rot['wing_2_R'] = ry(0.35 * flap) @ rz(0.25 * spread)


def _snap(x: float) -> float:
    return math.copysign(abs(x) ** 0.35, x)


def bird_idle(rig, p):
    pose = Pose()
    pose.loc = V((0, 0, 0.0015 * s(p)))
    pose.rot['neck'] = (2.0 * s(p), 0, 8.0 * _snap(s(p)))
    pose.rot['head'] = (0, 9.0 * s(2 * p), 16.0 * _snap(s(p)))
    pose.rot['tail_1'] = (7.0 * bump(p, 0.60, 0.72), 0, 0)
    _wings(pose, 7.0 * bump(p, 0.20, 0.34), 0.0)
    return _stand(rig, pose)


def bird_walk(rig, p):
    H = rig.sp['H']
    pose = Pose()
    pose.loc = V((0, 0, 0.003 * s(2 * p)))
    pose.rot['neck'] = (9.0 * s(2 * p), 0, 0)
    pose.rot['head'] = (-5.0 * s(2 * p), 0, 0)
    pose.rot['tail_1'] = (3.0 * s(2 * p + 0.3), 0, 0)
    _wings(pose, 0.0, 0.0)
    return _stand(rig, pose, {'H_L': step(p, 0.26 * H, 0.16 * H, 0.60), 'H_R': step(p + 0.5, 0.26 * H, 0.16 * H, 0.60)})


def bird_run(rig, p):
    H = rig.sp['H']
    pose = Pose()
    hop = 0.012 * max(0.0, s(p))
    pose.loc = V((0, 0, hop))
    pose.rot['hips'] = (6.0, 0, 0)
    pose.rot['neck'] = (6.0 + 5.0 * s(p), 0, 0)
    _wings(pose, 26.0, 14.0 * s(2 * p))
    feet = {'H_L': step(p + 0.50, 0.36 * H, 0.28 * H, 0.46), 'H_R': step(p + 0.58, 0.36 * H, 0.28 * H, 0.46)}
    return _stand(rig, pose, {k: (v[0], v[1] + 0.8 * hop) for k, v in feet.items()})


def bird_flee(rig, p):
    pose = Pose()
    pose.loc = V((0, 0, 0.100 + 0.012 * s(2 * p + 0.25)))
    pose.rot['hips'] = (-16.0, 0, 0)
    pose.rot['neck'] = (10.0, 0, 0)
    pose.rot['head'] = (8.0, 0, 0)
    pose.rot['tail_1'] = (10.0, 0, 0)
    _wings(pose, 82.0, 44.0 * s(2 * p))
    for side in ('L', 'R'):
        pose.rot[f'upper_H_{side}'] = (52.0, 0, 0)
        pose.rot[f'lower_H_{side}'] = (-84.0, 0, 0)
        pose.rot[f'paw_H_{side}'] = (40.0, 0, 0)
    return pose


def _crouch(rig, p, depth: float) -> Pose:
    pose = Pose()
    pose.loc = V((0, 0, -depth * rig.sp['H'] + 0.0015 * s(p)))
    pose.rot['hips'] = (7.0, 0, 0)
    return pose


# crouched: feet a little back, directly under the leg joints, so the folded legs stay above the floor
TUCK = {'H_L': (0.006, 0.0), 'H_R': (0.006, 0.0)}


def bird_sit(rig, p):
    pose = _crouch(rig, p, 0.46)
    pose.rot['neck'] = (12.0, 0, 5.0 * _snap(s(p)))
    pose.rot['head'] = (-4.0, 0, 9.0 * _snap(s(p)))
    _wings(pose, 0.0, 0.0)
    return _stand(rig, pose, TUCK)


def bird_sleep(rig, p):
    pose = _crouch(rig, p, 0.48)
    pose.rot['neck'] = (6.0, 0, 62.0)
    pose.rot['head'] = (22.0 + 1.0 * s(p), 0, 66.0)
    _wings(pose, 3.0 + 1.0 * s(p), 0.0)
    return _stand(rig, pose, TUCK)


def bird_eat(rig, p):
    pose = Pose()
    k = 0.5 * (1 + s(2 * p))
    pose.rot['hips'] = (16.0 + 10.0 * k, 0, 0)
    pose.rot['neck'] = (24.0 + 17.0 * k, 0, 0)
    pose.rot['head'] = (8.0, 0, 0)
    pose.rot['jaw'] = (16.0 * (1 - k), 0, 0)
    pose.rot['tail_1'] = (-8.0, 0, 0)
    _wings(pose, 0.0, 0.0)
    return _stand(rig, pose)


def bird_play(rig, p):
    pose = Pose()
    hop = 0.028 * abs(s(p))
    pose.loc = V((0, 0, hop))
    pose.rot['neck'] = (-6.0, 0, 0)
    pose.rot['head'] = (0, 20.0 * s(p), 0)
    pose.rot['jaw'] = (14.0, 0, 0)
    pose.rot['tail_1'] = (16.0, 0, 0)
    _wings(pose, 46.0, 30.0 * s(3 * p))
    return _stand(rig, pose, {'H_L': (0.0, 0.85 * hop), 'H_R': (0.0, 0.85 * hop)})


def bird_beg(rig, p):
    pose = _crouch(rig, p, 0.34)
    pose.rot['neck'] = (-34.0, 0, 0)
    pose.rot['head'] = (-16.0, 0, 0)
    pose.rot['jaw'] = (28.0 + 6.0 * s(4 * p), 0, 0)
    _wings(pose, 30.0, 12.0 * s(8 * p))
    return _stand(rig, pose, TUCK)


QUAD = {'idle': quad_idle, 'walk': quad_walk, 'run': quad_run, 'sit': quad_sit, 'sleep': quad_sleep,
        'eat': quad_eat, 'play': quad_play, 'beg': quad_beg, 'flee': quad_flee}
BIRD = {'idle': bird_idle, 'walk': bird_walk, 'run': bird_run, 'sit': bird_sit, 'sleep': bird_sleep,
        'eat': bird_eat, 'play': bird_play, 'beg': bird_beg, 'flee': bird_flee}


def pose_at(rig: Rig, clip: str, t: float) -> Pose:
    """Pose of `clip` at time t (seconds)."""
    dur, _ = CLIP_TIMING[clip]
    table = QUAD if rig.plan == 'quad' else BIRD
    return table[clip](rig, (t / dur) % 1.0)
