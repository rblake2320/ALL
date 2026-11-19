"""Carry anchors: per-animation placements of carried items (exported in the 'Rig' node extras as carryAnchors).

By default the runtime puts a carried item on the right palm (prop_R) and blends the arm into the palm-up carry
pose. Some clips hold the item differently - the plate on the left palm while the right hand forks food to the
mouth, an open book between both hands, the phone pressed to the ear. For those the build computes, from the clip
pose at a reference time, the item's transform relative to a bone; the runtime parents the item to that bone
with that local matrix (mirrored together with the clip when the right arm is missing).

Maths: three.js bone-node frames are exactly the Blender bone frames (export_yup only converts the root), so
an item whose desired armature-space frame is T (columns = item axes in Blender coordinates, translation =
item origin) has the local matrix L = P^-1 @ T under a bone posed at P (= translation(head) @ world_rot @ rest).
"""
from __future__ import annotations

from mathutils import Matrix, Vector

from .anim import props
from .skeleton import PALM_LIFT, PALM_OFFSET

V = Vector

ANCHORS = [
    # anim, items, bone, reference time (s), frame function, item variant, extra item on the other hand
    ('sitEat', ('plate', 'dish'), 'hand_L', 0.3, lambda p: props.plate_frame(p, 'L'), 'centered', 'fork'),
    ('standEat', ('plate', 'dish'), 'hand_L', 0.3, lambda p: props.plate_frame(p, 'L'), 'centered', 'fork'),
    ('read', ('book',), 'chest', 0.6, props.book_frame, 'open', None),
    ('sitRead', ('book',), 'chest', 0.6, props.book_frame, 'open', None),
    ('phone', ('phone',), 'hand_R', 0.6, lambda p: props.phone_frame(p)[:4], 'centered', None),
]


def _frame_matrix(origin: Vector, x: Vector, y: Vector, z: Vector) -> Matrix:
    m = Matrix.Identity(4)
    for r in range(3):
        m[r][0], m[r][1], m[r][2], m[r][3] = x[r], y[r], z[r], origin[r]
    return m


def _posed_bone_matrix(arm, pose, bone: str) -> Matrix:
    wr, wh = pose.fk()
    B = arm.data.bones[bone].matrix_local.to_3x3()
    return Matrix.Translation(wh[bone]) @ (wr[bone] @ B).to_4x4()


def _rest_bone_matrix(arm, bone: str) -> Matrix:
    return arm.data.bones[bone].matrix_local.copy()


def _column_major(m: Matrix) -> list[float]:
    return [round(m[r][c], 6) for c in range(4) for r in range(4)]


def fork_matrix(arm, sk, side: str = 'R') -> list[float]:
    """Fork held in the fist along the fingers (rigid to the hand, so computed in the rest pose)."""
    hb = 'hand_' + side
    a = sk.rest_dir[hb].normalized()
    sx = 1.0 if side == 'L' else -1.0
    w = V((-sx, 0.0, 0.0))
    w = (w - a * w.dot(a)).normalized()
    origin = sk.head[hb] + a * (PALM_OFFSET + props.FORK_GRIP) + w * PALM_LIFT
    y = -w                                   # tines curve away from the palm
    z = a                                    # handle -> tines along the fingers
    x = y.cross(z)
    T = _frame_matrix(origin, x, y, z)
    return _column_major(_rest_bone_matrix(arm, hb).inverted() @ T)


def compute_anchors(arm, sk, clips: dict) -> dict:
    out = {}
    for anim, items, bone, t_ref, frame_fn, variant, extra in ANCHORS:
        if anim not in clips:
            continue
        pose = clips[anim]['fn'](sk, t_ref)
        origin, x, y, z = frame_fn(pose)
        T = _frame_matrix(origin, x, y, z)
        L = _posed_bone_matrix(arm, pose, bone).inverted() @ T
        entry = {'items': list(items), 'bone': bone, 'matrix': _column_major(L), 'variant': variant}
        if extra == 'fork':
            entry['extra'] = {'item': 'fork', 'bone': 'hand_R', 'matrix': fork_matrix(arm, sk, 'R')}
        out[anim] = entry
    return out
