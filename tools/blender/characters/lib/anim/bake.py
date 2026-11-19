"""Bake clip functions into Blender layered (slotted) actions, one NLA track per action.

Every bone gets a rotation channel on every frame (sampled at 30 fps, LINEAR); the pelvis also gets location.
Loops write the t=0 pose again on the last frame so first == last exactly."""
from __future__ import annotations

import bpy
from mathutils import Matrix, Quaternion, Vector

from ..skeleton import basis_quaternion, rest_matrices

LINEAR = 1  # Keyframe.interpolation enum value


def _fcurve(cb, path: str, index: int, group: str):
    fc = cb.fcurves.new(path, index=index, group_name=group)
    return fc


def _write(fc, frames: list[int], values: list[float]) -> None:
    n = len(frames)
    fc.keyframe_points.add(n)
    co = []
    for f, v in zip(frames, values):
        co.extend((float(f), float(v)))
    fc.keyframe_points.foreach_set('co', co)
    fc.keyframe_points.foreach_set('interpolation', [LINEAR] * n)
    fc.update()


def sample_clip(sk, B: dict, clip: dict, bones: list[str]) -> tuple[list[int], dict, list]:
    frames = list(range(0, clip['frames'] + 1))
    quats: dict[str, list[Quaternion]] = {b: [] for b in bones}
    locs = []
    first = None
    for f in frames:
        if clip['loop'] and f == clip['frames'] and first is not None:
            pose = first
        else:
            pose = clip['fn'](sk, f / 30.0)
            if f == 0:
                first = pose
        mats = pose.matrices()
        for b in bones:
            R = mats.get(b, Matrix.Identity(3))
            q = basis_quaternion(B[b], R)
            prev = quats[b][-1] if quats[b] else None
            if prev is not None and prev.dot(q) < 0:
                q = -q
            quats[b].append(q)
        locs.append(B['pelvis'].inverted() @ pose.loc)
    if clip['loop']:
        # exact closure: last key == first key (three.js slerps the short way, so a sign flip is harmless)
        for b in bones:
            quats[b][-1] = quats[b][0].copy()
        locs[-1] = locs[0].copy()
    return frames, quats, locs


def bake_all(arm, sk, clips: dict, order: list[str]) -> list[str]:
    B = rest_matrices(arm)
    bones = [b.name for b in arm.data.bones]
    if arm.animation_data is None:
        arm.animation_data_create()
    ad = arm.animation_data
    names = []
    for name in order:
        clip = clips[name]
        frames, quats, locs = sample_clip(sk, B, clip, bones)
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        slot = act.slots.new(id_type='OBJECT', name='Rig')
        layer = act.layers.new('Layer')
        strip = layer.strips.new(type='KEYFRAME')
        cb = strip.channelbags.new(slot)
        for b in bones:
            path = f'pose.bones["{b}"].rotation_quaternion'
            for i in range(4):
                _write(_fcurve(cb, path, i, b), frames, [q[i] for q in quats[b]])
        lp = 'pose.bones["pelvis"].location'
        for i in range(3):
            _write(_fcurve(cb, lp, i, 'pelvis'), frames, [l[i] for l in locs])
        act.frame_range = (0, clip['frames'])
        act.use_frame_range = True
        ad.action = act
        ad.action_slot = slot
        track = ad.nla_tracks.new()
        track.name = name
        st = track.strips.new(name, 0, act)
        try:
            st.action_slot = slot
        except Exception:  # noqa: BLE001 - older API variants auto-assign
            pass
        track.mute = True
        ad.action = None
        names.append(name)
    return names


def apply_pose(arm, sk, pose) -> None:
    """Set the armature pose directly (previews / tests)."""
    B = rest_matrices(arm)
    mats = pose.matrices()
    for pb in arm.pose.bones:
        R = mats.get(pb.name, Matrix.Identity(3))
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = basis_quaternion(B[pb.name], R)
        pb.location = (B['pelvis'].inverted() @ pose.loc) if pb.name == 'pelvis' else Vector((0, 0, 0))
    bpy.context.view_layer.update()
