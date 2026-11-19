"""Wildlife clips. fn(rig, p) -> Pose with p in [0, 1]; looping clips use whole numbers of cycles so p = 1 equals
p = 0, one-shot clips (land, takeoff) run once from p = 0 to p = 1. Poses are authored at the reference size of
the pet body plan; the build scales the hips offset with the animal.
"""
from __future__ import annotations

import math

from mathutils import Vector

from petlib import clips as C
from petlib.rig import Pose

V = Vector
s, bump, smooth, step = C.s, C.bump, C.smooth, C.step


def _tucked_legs(pose: Pose, a: float = 52.0, b: float = -84.0) -> None:
    for side in ('L', 'R'):
        pose.rot[f'upper_H_{side}'] = (a, 0, 0)
        pose.rot[f'lower_H_{side}'] = (b, 0, 0)
        pose.rot[f'paw_H_{side}'] = (40.0, 0, 0)


def _hanging_feet(rig, pose: Pose) -> Pose:
    """Feet reach for the floor: planted when the body is low, hanging below it when it is high."""
    lift = max(0.0, pose.loc.z)
    return C._stand(rig, pose, {'H_L': (0.0, 0.92 * lift), 'H_R': (0.0, 0.92 * lift)})


# ---------------------------------------------------------------------------------------------------
# Birds and the bat (bird plan)
# ---------------------------------------------------------------------------------------------------

def bird_fly(rig, p, height: float = 0.10, flap: float = 50.0, cycles: int = 1, pitch: float = -6.0):
    pose = Pose()
    pose.loc = V((0, 0, height + 0.010 * s(cycles * p + 0.25)))
    pose.rot['hips'] = (pitch, 0, 0)
    pose.rot['neck'] = (8.0, 0, 0)
    pose.rot['head'] = (4.0, 0, 0)
    pose.rot['tail_1'] = (6.0 + 4.0 * s(cycles * p), 0, 0)
    C._wings(pose, 84.0, flap * s(cycles * p))
    _tucked_legs(pose)
    return pose


def bird_glide(rig, p):
    pose = Pose()
    pose.loc = V((0, 0, 0.10 + 0.004 * s(p)))
    pose.rot['hips'] = (-3.0, 4.0 * s(p), 0)
    pose.rot['neck'] = (6.0, 0, 0)
    pose.rot['tail_1'] = (4.0, 0, 3.0 * s(p))
    C._wings(pose, 88.0, 8.0 + 3.0 * s(2 * p))
    _tucked_legs(pose)
    return pose


def bird_land(rig, p):
    k = smooth(p)
    pose = Pose()
    pose.loc = V((0, 0, 0.10 * (1 - k) - 0.008 * bump(p, 0.75, 1.0)))
    pose.rot['hips'] = (-22.0 * (1 - k) * bump(p, -0.6, 1.0) - 4.0 * (1 - k), 0, 0)
    pose.rot['neck'] = (8.0 * (1 - k), 0, 0)
    pose.rot['tail_1'] = (14.0 * (1 - k), 0, 0)
    C._wings(pose, 84.0 * (1 - k * k), 42.0 * (1 - k) * math.sin(math.tau * 3 * p))
    return _hanging_feet(rig, pose)


def bird_takeoff(rig, p):
    k = smooth(p)
    pose = Pose()
    pose.loc = V((0, 0, 0.10 * k - 0.012 * bump(p, 0.0, 0.3)))
    pose.rot['hips'] = (-14.0 * bump(p, 0.1, 1.2) - 6.0 * k, 0, 0)
    pose.rot['neck'] = (8.0 * k, 0, 0)
    pose.rot['tail_1'] = (10.0 * k, 0, 0)
    C._wings(pose, 84.0 * smooth(p * 2.2), 50.0 * smooth(p * 2.2) * math.sin(math.tau * 3 * p))
    if p > 0.6:                      # legs fold once clear of the perch
        j = smooth((p - 0.6) / 0.4)
        _hanging_feet(rig, pose)
        for side in ('L', 'R'):
            for bone, tgt in ((f'upper_H_{side}', 52.0), (f'lower_H_{side}', -84.0), (f'paw_H_{side}', 40.0)):
                cur = pose.rot[bone][0]
                pose.rot[bone] = (cur + (tgt - cur) * j, 0, 0)
        return pose
    return _hanging_feet(rig, pose)


def bird_hop(rig, p):
    pose = Pose()
    hop = 0.016 * max(0.0, s(p))
    pose.loc = V((0, 0, hop))
    pose.rot['hips'] = (4.0 - 6.0 * max(0.0, s(p)), 0, 0)
    pose.rot['neck'] = (5.0 * s(p + 0.1), 0, 0)
    pose.rot['tail_1'] = (8.0 * max(0.0, s(p)), 0, 0)
    C._wings(pose, 5.0 * max(0.0, s(p)), 0.0)
    return C._stand(rig, pose, {'H_L': (0.0, 0.85 * hop), 'H_R': (0.0, 0.85 * hop)})


def pigeon_walk(rig, p):
    H = rig.sp['H']
    pose = Pose()
    pose.loc = V((0, 0, 0.003 * s(2 * p)))
    pose.rot['neck'] = (14.0 * s(2 * p), 0, 0)          # the head bob
    pose.rot['head'] = (-8.0 * s(2 * p), 0, 0)
    pose.rot['tail_1'] = (3.0 * s(2 * p + 0.3), 0, 0)
    C._wings(pose, 0.0, 0.0)
    return C._stand(rig, pose, {'H_L': step(p, 0.24 * H, 0.14 * H, 0.62), 'H_R': step(p + 0.5, 0.24 * H, 0.14 * H, 0.62)})


def bat_fly(rig, p):
    return bird_fly(rig, p, height=0.12, flap=58.0, cycles=1, pitch=-4.0)


def bat_hover(rig, p):
    pose = bird_fly(rig, p, height=0.12, flap=34.0, cycles=1, pitch=-52.0)
    pose.rot['neck'] = (30.0, 0, 0)
    pose.rot['head'] = (18.0, 0, 0)
    return pose


# ---------------------------------------------------------------------------------------------------
# Squirrel and frog (quadruped plan)
# ---------------------------------------------------------------------------------------------------

def squirrel_run(rig, p):
    pose, feet = C._gallop(rig, p, 0.44, 0.24, 9.0)
    pose.rot['neck'] = (6.0 + 4.0 * s(p + 0.5), 0, 0)
    pose.rot['head'] = (-6.0, 0, 0)
    C.tail(pose, -70.0 + 10.0 * s(p + 0.3), 3.0, 1, p)        # streaming out behind
    C._ears(pose, -10.0)
    return C._stand(rig, pose, feet)


def _upright(rig, p, sway: float = 0.0) -> Pose:
    """Sitting up on the haunches, front paws held against the chest."""
    L = rig.sp['L']
    pose = Pose()
    pose.rot['hips'] = (-62.0 + sway, 0, 0)
    pose.loc = V((0, -0.16 * L, 0.0))
    C._rest_on_floor(rig, pose)
    pose.rot['neck'] = (36.0, 0, 0)
    pose.rot['head'] = (20.0, 0, 0)
    for side in ('L', 'R'):
        pose.rot[f'upper_F_{side}'] = (46.0, 0, 0)
        pose.rot[f'lower_F_{side}'] = (-70.0, 0, 0)
        pose.rot[f'paw_F_{side}'] = (30.0, 0, 0)
    for leg in ('H_L', 'H_R'):
        rig.place_foot(pose, leg, -0.30 * rig.sp['H'], 0.0)
    return pose


def squirrel_freeze(rig, p):
    pose = _upright(rig, p)
    pose.rot['head'] = (20.0 + 0.6 * s(4 * p), 0, 0)          # only the nose twitches
    C._tail_flat(rig, pose, 78.0, 0.5, 2, p, curl=0.0)
    C._ears(pose, 8.0)
    return pose


def squirrel_chitter(rig, p):
    pose = _upright(rig, p, sway=2.0 * s(2 * p))
    pose.rot['head'] = (16.0 + 4.0 * s(4 * p), 0, 0)
    pose.rot['jaw'] = (12.0 * abs(s(3 * p)), 0, 0)
    C._tail_flat(rig, pose, 70.0 + 14.0 * s(4 * p), 6.0, 4, p, curl=0.0)
    C._ears(pose, 4.0 * s(4 * p))
    return pose


def squirrel_idle_tail(rig, p):
    pose, th = C._sit_base(rig)
    pose.rot['neck'] = (0.50 * th, 0, 5.0 * s(p))
    pose.rot['head'] = (0.42 * th, 0, 8.0 * s(p + 0.1))
    C._tail_flat(rig, pose, 60.0 + 8.0 * s(p), 22.0 * bump(p, 0.15, 0.45) + 14.0 * bump(p, 0.6, 0.8), 6, p, curl=0.0)
    C._ears(pose, -12.0 * bump(p, 0.5, 0.62))
    return C._stand(rig, pose, {'H_L': (-0.20 * rig.sp['H'], 0.0), 'H_R': (-0.20 * rig.sp['H'], 0.0)})


def squirrel_climb(rig, p):
    """Running straight up a trunk: the body is vertical (nose up), paws alternate in pairs. In place; the game
    moves the squirrel up the tree."""
    sp = rig.sp
    pose = Pose()
    pose.rot['hips'] = (-88.0 + 3.0 * s(p), 0, 0)
    pose.loc = V((0, 0, 0.55 * sp['L'] + 0.01 * s(p)))
    pose.rot['neck'] = (24.0, 0, 0)
    pose.rot['head'] = (16.0, 0, 0)
    C.tail(pose, -40.0, 5.0, 1, p)
    for kind, ph in (('F', 0.0), ('H', 0.5)):
        for i, side in enumerate(('L', 'R')):
            k = s(p + ph + 0.08 * i)
            pose.rot[f'upper_{kind}_{side}'] = (28.0 * k, 0, 0)
            pose.rot[f'lower_{kind}_{side}'] = (-22.0 - 18.0 * s(p + ph + 0.25), 0, 0)
            pose.rot[f'paw_{kind}_{side}'] = (20.0, 0, 0)
    return pose


def frog_idle(rig, p):
    pose, th = C._sit_base(rig)
    pose.loc.z += 0.002 * s(p)
    pose.rot['neck'] = (0.5 * th, 0, 0)
    pose.rot['head'] = (0.3 * th, 0, 0)
    pose.rot['jaw'] = (4.0 + 4.0 * s(3 * p), 0, 0)             # the throat pulses
    return C._stand(rig, pose, {'H_L': (-0.30 * rig.sp['H'], 0.0), 'H_R': (-0.30 * rig.sp['H'], 0.0)})


def frog_hop(rig, p):
    H = rig.sp['H']
    air = math.sin(math.pi * min(1.0, max(0.0, (p - 0.18) / 0.62))) if 0.18 < p < 0.80 else 0.0
    crouch = bump(p, 0.0, 0.2) + bump(p, 0.78, 1.0)
    pose, th = C._sit_base(rig)
    pose.loc.z += 0.95 * H * air - 0.10 * H * crouch * 0.0
    pose.rot['hips'] = (pose.rot['hips'][0] * (1 - 0.7 * air) - 16.0 * air, 0, 0)
    pose.rot['neck'] = (0.4 * th * (1 - air), 0, 0)
    pose.rot['head'] = (0.3 * th * (1 - air), 0, 0)
    lift = 0.95 * H * air
    feet = {'H_L': (-0.30 * H * (1 - air) + 0.55 * H * air, 0.55 * lift), 'H_R': (-0.30 * H * (1 - air) + 0.55 * H * air, 0.55 * lift),
            'F_L': (-0.10 * H * air, 0.90 * lift), 'F_R': (-0.10 * H * air, 0.90 * lift)}
    return C._stand(rig, pose, feet)


TABLE = {
    'songbird': {'fly': bird_fly, 'glide': bird_glide, 'land': bird_land, 'perch-idle': C.bird_idle, 'hop': bird_hop,
                 'peck': C.bird_eat, 'takeoff': bird_takeoff},
    'pigeon': {'walk': pigeon_walk, 'peck': C.bird_eat, 'takeoff': bird_takeoff, 'fly': bird_fly},
    'squirrel': {'run': squirrel_run, 'freeze': squirrel_freeze, 'climb': squirrel_climb, 'idle-tail': squirrel_idle_tail,
                 'chitter': squirrel_chitter},
    'bat': {'fly': bat_fly, 'flap-hover': bat_hover},
    'frog': {'hop': frog_hop, 'idle': frog_idle},
}
