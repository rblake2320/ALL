"""The classic rig (public/assets/models/characters/zombie.glb) as the reference every cast body is fitted to.

Imported with bone_heuristic='BLENDER', which round-trips the exported Blender bone frames exactly (verified: max
|delta| < 1e-6 against tools/blender/characters/lib/skeleton.py), so `rest_rot[name]` are THE rest orientations a
cast skeleton must reproduce for the shared clips to bind by bone name.
"""
from __future__ import annotations

import bpy
from mathutils import Matrix, Vector

from .config import ZOMBIE_GLB

# Meshes of the classic body used to measure its own anchors (lying extent, seat contact).
MEASURE_MESHES = ('Head', 'Torso', 'ArmUpper_L', 'ArmUpper_R', 'ArmLower_L', 'ArmLower_R', 'Hand_L', 'Hand_R',
                  'LegUpper_L', 'LegUpper_R', 'LegLower_L', 'LegLower_R', 'Foot_L', 'Foot_R')


class ZombieRef:
    def __init__(self) -> None:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=ZOMBIE_GLB, bone_heuristic='BLENDER')
        new = [o for o in bpy.data.objects if o not in before]
        arm = next(o for o in new if o.type == 'ARMATURE')
        arm.name = 'ZRig'
        self.arm = arm
        self.meshes = []
        for o in new:
            if o.type == 'MESH' and o.name.split('.')[0] in MEASURE_MESHES:
                o.name = 'Z_' + o.name.split('.')[0]
                o.hide_render = True
                self.meshes.append(o)
            elif o is not arm:
                bpy.data.objects.remove(o, do_unlink=True)
        arm.hide_render = True
        if arm.animation_data:
            for tr in list(arm.animation_data.nla_tracks):
                arm.animation_data.nla_tracks.remove(tr)
            arm.animation_data.action = None
        for pb in arm.pose.bones:
            pb.rotation_mode = 'QUATERNION'
        bones = arm.data.bones
        self.rest_rot: dict[str, Matrix] = {b.name: b.matrix_local.to_3x3() for b in bones}
        self.head: dict[str, Vector] = {b.name: b.head_local.copy() for b in bones}
        self.tail: dict[str, Vector] = {b.name: b.tail_local.copy() for b in bones}
        self.length: dict[str, float] = {b.name: b.length for b in bones}
        self.dir: dict[str, Vector] = {b.name: (b.tail_local - b.head_local).normalized() for b in bones}
        # edit-bone rolls (the exact construction the classic rig used: head, tail, roll)
        for o in bpy.context.view_layer.objects:
            if o is not None and o.select_get():
                o.select_set(False)
        bpy.context.view_layer.objects.active = arm
        arm.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        self.roll: dict[str, float] = {b.name: b.roll for b in arm.data.edit_bones}
        self.vec: dict[str, Vector] = {b.name: (b.tail - b.head) for b in arm.data.edit_bones}
        bpy.ops.object.mode_set(mode='OBJECT')
        arm.select_set(False)
        self.pelvis_rest = self.head['pelvis'].copy()          # Blender coords (z up)
        self.hip_height = (self.head['thigh_L'].z + self.head['thigh_R'].z) / 2
        self.actions = {a.name: a for a in bpy.data.actions}

    def set_clip(self, name: str, frame: float) -> None:
        ad = self.arm.animation_data or self.arm.animation_data_create()
        act = self.actions[name]
        if ad.action is not act:
            ad.action = act
            if hasattr(ad, 'action_slot') and act.slots and ad.action_slot is None:
                ad.action_slot = act.slots[0]
        bpy.context.scene.frame_set(int(frame), subframe=float(frame) - int(frame))

    def clip_frames(self, name: str) -> tuple[int, int]:
        a = self.actions[name]
        fr = a.frame_range
        return int(round(fr[0])), int(round(fr[1]))

    def clear(self) -> None:
        if self.arm.animation_data:
            self.arm.animation_data.action = None
        for pb in self.arm.pose.bones:
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)
            pb.scale = (1, 1, 1)
