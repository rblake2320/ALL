"""The shared-clip runtime rule, implemented once here (the build uses it to pose cast bodies for anchors, checks and
preview sheets) and documented verbatim in docs/contract-requests/cast.md for the three.js runtime.

Rule (glTF / three.js coordinates, metres, rig-root space):
  * every `<bone>.quaternion` track of zombie.glb is used unchanged (cast rest orientations == zombie rest
    orientations, verified by the build and by tests/unit/cast-assets);
  * every `.position` / `.scale` track is dropped EXCEPT `pelvis.position`, which is remapped per keyframe:
        P0 = zombie pelvis rest (0, 0.66, 0), Pc = body.pelvisRest, s = body.pelvisScale
        sit* clips  : p' = p + seatPelvisOffset                       (absolute: seat contact stays at SEAT_HEIGHT)
        other clips : p' = Pc + (p - P0) * s + lyingOffset * w(p.y),   w(y) = clamp((0.25 - y) / 0.14, 0, 1)
    (w = 0 for every upright/kneeling/crouching key, 1 for lying keys - sleep, beEmbalmed, bath, crawl, the end of
    collapse - so thick bodies rest on the mattress instead of sinking into it, and long bodies stay centred.)
  * sit* clips only, when body.sitThighLift (deg) > 0: every thigh_L / thigh_R keyframe quaternion q is
    pre-multiplied by a rotation of -sitThighLift about the PARENT (pelvis) local X axis: q' = qx(-lift) * q.
    Long-legged bodies lift their knees so the feet stay on the floor instead of passing through it.
    A body may also carry body.sitThighLiftByClip {clip: deg}: for a clip listed there that angle is used instead
    (one angle cannot keep long legs on the floor in every sit clip - the clips differ by centimetres).
  * tracks whose bone the body lacks (jaw) are dropped.
"""
from __future__ import annotations

import math

from mathutils import Quaternion, Vector

from .config import SIT_CLIPS

LYING_Y0 = 0.25
LYING_SPAN = 0.14


def to_gl(v) -> Vector:
    return Vector((v[0], v[2], -v[1]))


def to_bl(v) -> Vector:
    return Vector((v[0], -v[2], v[1]))


def lying_weight(y: float) -> float:
    return min(1.0, max(0.0, (LYING_Y0 - y) / LYING_SPAN))


def pelvis_target_gl(p: Vector, clip: str, P0: Vector, body: dict) -> Vector:
    """p, P0 and the result in glTF coordinates. body: {pelvisRest, pelvisScale, seatPelvisOffset, lyingOffset}."""
    if clip in SIT_CLIPS:
        return p + Vector(body.get('seatPelvisOffset', (0, 0, 0)))
    Pc = Vector(body['pelvisRest'])
    s = body['pelvisScale']
    return Pc + (p - P0) * s + Vector(body.get('lyingOffset', (0, 0, 0))) * lying_weight(p.y)


def sit_thigh_lift(body: dict, clip: str) -> float:
    """Thigh lift (deg) of `clip`: the per-clip value when the body has one, else body.sitThighLift."""
    by_clip = body.get('sitThighLiftByClip') or {}
    return float(by_clip.get(clip, body.get('sitThighLift', 0.0)))


def apply_pose(zref, carm, clip: str, frame: float, body: dict, mirror_free=True) -> None:
    """Pose the cast armature `carm` with zombie clip `clip` at `frame` using the runtime rule."""
    zref.set_clip(clip, frame)
    zpb = zref.arm.pose.bones
    B = zref.rest_rot['pelvis']
    P0 = to_gl(zref.head['pelvis'])
    for pb in carm.pose.bones:
        src = zpb.get(pb.name)
        if src is None:
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)
            continue
        pb.rotation_quaternion = src.rotation_quaternion.copy()
        lift = sit_thigh_lift(body, clip)
        if lift and clip in SIT_CLIPS and pb.name in ('thigh_L', 'thigh_R'):
            rel = (zref.rest_rot['pelvis'].inverted() @ zref.rest_rot[pb.name]).to_quaternion()
            ql = Quaternion((1, 0, 0), math.radians(-lift))
            pb.rotation_quaternion = rel.inverted() @ ql @ rel @ pb.rotation_quaternion
        if pb.name == 'pelvis':
            p_arm = zref.head['pelvis'] + B @ src.location
            tgt = to_bl(pelvis_target_gl(to_gl(p_arm), clip, P0, body))
            rest = carm.data.bones['pelvis'].head_local
            pb.location = B.inverted() @ (tgt - rest)
        else:
            pb.location = (0, 0, 0)
    import bpy
    bpy.context.view_layer.update()


def rest_pose(carm) -> None:
    import bpy
    for pb in carm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()
