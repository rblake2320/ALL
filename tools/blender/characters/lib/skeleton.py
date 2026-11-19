"""Bone table + armature creation + 'semantic' forward kinematics.

Semantic rotation convention (used by every pose/animation): each bone's rotation R is expressed in
armature-aligned axes, applied about the bone head, relative to its parent (as if the parent were at rest).
  X axis = character lateral (+X = character's LEFT). +X rotation pitches the top of an upward bone FORWARD
           (and swings the bottom of a downward bone BACKWARD).
  Y axis = front/back axis. +Y rotation tilts the top of an upward bone toward +X (character's left).
  Z axis = vertical. +Z rotation turns the front toward the character's left.
Blender pose basis = B^-1 * R * B, with B the bone's rest orientation (bone.matrix_local 3x3).
Right-side bones are exact mirrors (head/tail x negated, roll negated) so a pose mirrors as
(rx, ry, rz) -> (rx, -ry, -rz), location x -> -x, and glTF node quaternions mirror as (x,-y,-z,w).
"""
from __future__ import annotations

import math

from mathutils import Euler, Matrix, Quaternion, Vector

V = Vector

CENTER_BONES = [
    # name, head, tail, parent
    ('root', (0.0, 0.0, 0.0), (0.0, 0.0, 0.22), None),
    ('pelvis', (0.0, 0.0, 0.66), (0.0, 0.0, 0.84), 'root'),
    ('spine', (0.0, 0.0, 0.84), (0.0, 0.0, 1.00), 'pelvis'),
    ('chest', (0.0, 0.0, 1.00), (0.0, 0.0, 1.20), 'spine'),
    ('neck', (0.0, 0.004, 1.20), (0.0, 0.0, 1.31), 'chest'),
    ('head', (0.0, 0.0, 1.31), (0.0, 0.0, 1.62), 'neck'),
    ('jaw', (0.0, -0.02, 1.385), (0.0, -0.125, 1.30), 'head'),
]
LEFT_BONES = [
    ('shoulder_L', (0.030, 0.006, 1.165), (0.150, 0.012, 1.158), 'chest'),
    ('upperarm_L', (0.165, 0.012, 1.152), (0.215, 0.014, 0.862), 'shoulder_L'),
    ('forearm_L', (0.215, 0.014, 0.862), (0.262, 0.004, 0.586), 'upperarm_L'),
    ('hand_L', (0.262, 0.004, 0.586), (0.281, -0.002, 0.470), 'forearm_L'),
    ('thigh_L', (0.088, 0.0, 0.735), (0.094, -0.004, 0.415), 'pelvis'),
    ('shin_L', (0.094, -0.004, 0.415), (0.096, 0.012, 0.085), 'thigh_L'),
    ('foot_L', (0.096, 0.012, 0.085), (0.102, -0.118, 0.022), 'shin_L'),
]

# Rotation application order per bone (first letter applied first, extrinsic about parent-aligned axes).
ORDER = {
    'root': 'XYZ', 'pelvis': 'XYZ', 'spine': 'XYZ', 'chest': 'XYZ', 'neck': 'XYZ', 'head': 'XYZ', 'jaw': 'XYZ',
    'shoulder': 'XYZ', 'upperarm': 'ZYX', 'forearm': 'ZXY', 'hand': 'ZXY', 'thigh': 'ZYX', 'shin': 'ZXY',
    'foot': 'XYZ', 'prop': 'XYZ',
}

# Carry pose (LEFT side definition, mirrored for the right). prop_* rest frames are derived from it so that a
# carried item authored with +Y up / +Z forward (three.js) sits flat on the upturned palm in this pose.
CARRY_POSE_L = {
    'shoulder_L': (0.0, 0.0, -6.0),
    'upperarm_L': (-16.0, 6.0, 0.0),
    'forearm_L': (-84.0, 0.0, 90.0),
    'hand_L': (4.0, 0.0, 0.0),
}
PALM_OFFSET = 0.052   # along the hand bone from the wrist to the palm centre
PALM_LIFT = 0.024     # from the hand axis to the palm surface (towards the palm side)


def mirror_name(n: str) -> str:
    if n.endswith('_L'):
        return n[:-2] + '_R'
    if n.endswith('_R'):
        return n[:-2] + '_L'
    return n


def _mirror_bone(b):
    name, h, t, p = b
    return (mirror_name(name), (-h[0], h[1], h[2]), (-t[0], t[1], t[2]), mirror_name(p) if p else None)


def bone_table() -> list[tuple]:
    """All deform/structural bones except prop bones, in parent-before-child order."""
    out = list(CENTER_BONES) + list(LEFT_BONES) + [_mirror_bone(b) for b in LEFT_BONES]
    return out


def base_kind(name: str) -> str:
    return name.split('_')[0]


def euler_matrix(rx: float, ry: float, rz: float, order: str) -> Matrix:
    """Degrees -> rotation matrix applying axes in `order` (first letter first)."""
    m = Matrix.Identity(3)
    ang = {'X': rx, 'Y': ry, 'Z': rz}
    for ax in order:
        a = ang[ax]
        if a:
            m = Matrix.Rotation(math.radians(a), 3, ax) @ m
    return m


class Skeleton:
    """Rest data + semantic FK (pure mathutils; no bpy dependency)."""

    def __init__(self):
        self.table = bone_table()
        self.head: dict[str, Vector] = {}
        self.tail: dict[str, Vector] = {}
        self.parent: dict[str, str | None] = {}
        self.order: list[str] = []
        for name, h, t, p in self.table:
            self.head[name] = V(h)
            self.tail[name] = V(t)
            self.parent[name] = p
            self.order.append(name)
        self.children: dict[str, list[str]] = {n: [] for n in self.order}
        for n in self.order:
            p = self.parent[n]
            if p:
                self.children[p].append(n)
        self.length = {n: (self.tail[n] - self.head[n]).length for n in self.order}
        self.rest_dir = {n: (self.tail[n] - self.head[n]).normalized() for n in self.order}
        self.prop_frames: dict[str, Matrix] = {}
        self.prop_heads: dict[str, Vector] = {}
        self._compute_props()

    # ------------------------------------------------------------------ FK
    def rot_of(self, pose: dict, name: str) -> Matrix:
        r = pose.get(name)
        if r is None:
            return Matrix.Identity(3)
        if isinstance(r, Matrix):
            return r
        return euler_matrix(r[0], r[1], r[2], ORDER[base_kind(name)])

    def fk(self, pose: dict, pelvis_offset: Vector | None = None, names=None) -> tuple[dict, dict]:
        """Return (world_rot, world_head) dicts for the semantic pose (dict bone -> (rx,ry,rz) deg or Matrix)."""
        wr: dict[str, Matrix] = {}
        wh: dict[str, Vector] = {}
        for n in self.order:
            p = self.parent[n]
            R = self.rot_of(pose, n)
            if p is None:
                wr[n] = R
                wh[n] = self.head[n].copy()
            else:
                wr[n] = wr[p] @ R
                wh[n] = wh[p] + wr[p] @ (self.head[n] - self.head[p])
                if n == 'pelvis' and pelvis_offset is not None:
                    wh[n] = wh[n] + wr[p] @ pelvis_offset
        return wr, wh

    def point(self, wr, wh, bone: str, rest_point: Vector) -> Vector:
        """World position of a point rigidly attached to `bone` (given in rest armature space)."""
        return wh[bone] + wr[bone] @ (V(rest_point) - self.head[bone])

    def tail_world(self, wr, wh, bone: str) -> Vector:
        return self.point(wr, wh, bone, self.tail[bone])

    # ------------------------------------------------------------------ props
    def _compute_props(self) -> None:
        m0 = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))  # columns: X=(1,0,0), Y=(0,0,1), Z=(0,-1,0)
        pose_l = dict(CARRY_POSE_L)
        for side in ('L', 'R'):
            pose = pose_l if side == 'L' else {mirror_name(k): (v[0], -v[1], -v[2]) for k, v in pose_l.items()}
            wr, wh = self.fk(pose)
            hand = 'hand_' + side
            q = wr[hand]
            b_prop = q.inverted() @ m0
            sgn = 1.0 if side == 'L' else -1.0
            # palm faces the body midline at rest: -X for the left hand, +X for the right hand
            palm_normal = V((-sgn, 0.0, 0.0))
            head = self.head[hand] + self.rest_dir[hand] * PALM_OFFSET + palm_normal * PALM_LIFT
            self.prop_frames['prop_' + side] = b_prop
            self.prop_heads['prop_' + side] = head


def ensure_armature(sk: Skeleton, name: str = 'Rig'):
    """Create the Blender armature object with exact bone names (requires bpy)."""
    import bpy

    arm_data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm_data.edit_bones
    for n, h, t, p in sk.table:
        b = eb.new(n)
        b.head = h
        b.tail = t
        b.roll = 0.0
        if p:
            b.parent = eb[p]
        b.use_connect = False
        b.use_deform = n not in ('root',)
    for side in ('L', 'R'):
        pn = 'prop_' + side
        b = eb.new(pn)
        frame = sk.prop_frames[pn]
        b.head = sk.prop_heads[pn]
        b.tail = sk.prop_heads[pn] + frame.col[1] * 0.06
        b.matrix = Matrix.Translation(sk.prop_heads[pn]) @ frame.to_4x4()
        b.length = 0.06
        b.parent = eb['hand_' + side]
        b.use_deform = False
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return arm


def rest_matrices(arm) -> dict[str, Matrix]:
    return {b.name: b.matrix_local.to_3x3() for b in arm.data.bones}


def basis_quaternion(B: Matrix, R: Matrix) -> Quaternion:
    """Blender pose basis for semantic rotation R given rest orientation B."""
    return (B.inverted() @ R @ B).to_quaternion()
