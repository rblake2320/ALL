"""Turn Parts into skinned Blender mesh objects (vertex groups, colour attribute, _rot mask, shape keys)."""
from __future__ import annotations

import math

import bpy
from mathutils import Vector

from .consts import BUILD_GAIN, BUILD_MORPH
from .meshkit import Part
from .noise import fbm3, smoothstep
from .skeleton import Skeleton
from .weights import normalize

V = Vector
TORSO_BONES = {'pelvis', 'spine', 'chest', 'shoulder_L', 'shoulder_R'}
NO_BUILD_BONES = {'head', 'jaw', 'neck', 'root', 'prop_L', 'prop_R'}


def _closest_on_segment(p: Vector, a: Vector, b: Vector) -> Vector:
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-12)))
    return a + ab * t


def build_delta(sk: Skeleton, co: Vector, w: dict) -> Vector:
    """Stocky-build displacement (+BUILD_GAIN width) as a weight-blended radial push from bone axes."""
    out = V((0.0, 0.0, 0.0))
    for bone, wt in w.items():
        if bone in NO_BUILD_BONES or wt <= 0:
            continue
        if bone in TORSO_BONES:
            axis_y = 0.004
            d = V((co.x, co.y - axis_y, 0.0))
            # widen less near the shoulders' outer edge so arms keep clearance
            k = 1.0 - 0.35 * smoothstep(1.05, 1.16, co.z)
            out += d * (BUILD_GAIN * k * wt)
        else:
            c = _closest_on_segment(co, sk.head[bone], sk.tail[bone]) if bone in sk.head else co
            gain = BUILD_GAIN * (0.6 if bone.startswith('hand') or bone.startswith('foot') else 1.0)
            out += (co - c) * (gain * wt)
    return out


def rot_mask(co: Vector, seed: int = 7) -> float:
    """Per-vertex decay blotch bias in [0,1] (deterministic)."""
    n = fbm3(co.x * 9.0 + 3.1, co.y * 9.0 - 1.7, co.z * 9.0 + 0.3, seed=seed, octaves=3)
    return max(0.0, min(1.0, (n - 0.35) * 1.8))


def part_to_object(part: Part, mats: dict, arm, sk: Skeleton, skin_part: bool = False,
                   extra_keys: dict | None = None) -> bpy.types.Object:
    if part.weights is None:
        raise ValueError(f'part {part.name} has no weights')
    nv = len(part.co)
    me = bpy.data.meshes.new(part.name + '_mesh')
    me.from_pydata([tuple(c) for c in part.co], [], [tuple(f) for f in part.faces])
    if len(me.vertices) != nv:
        raise RuntimeError(f'{part.name}: vertex count changed {nv} -> {len(me.vertices)}')
    names = part.mats_used()
    for n in names:
        me.materials.append(mats[n])
    me.polygons.foreach_set('material_index', [names.index(m) for m in part.fmat])
    me.polygons.foreach_set('use_smooth', [True] * len(part.faces))

    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    flat = []
    for c in part.col:
        flat.extend((max(0.0, min(1.0, c[0])), max(0.0, min(1.0, c[1])), max(0.0, min(1.0, c[2])), 1.0))
    ca.data.foreach_set('color', flat)
    me.color_attributes.active_color = ca
    me.color_attributes.render_color_index = 0

    if skin_part:
        att = me.attributes.new('_rot', 'FLOAT', 'POINT')
        vals = []
        for i, co in enumerate(part.co):
            base = rot_mask(co)
            vals.append(max(0.0, min(1.0, base + part.rot[i])))
        att.data.foreach_set('value', vals)

    if part.sharp_angle is not None:
        me.set_sharp_from_angle(angle=math.radians(part.sharp_angle))
    me.update()

    ob = bpy.data.objects.new(part.name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = arm
    groups = {}
    for i, w in enumerate(part.weights):
        for bone, val in normalize(w).items():
            if bone not in groups:
                groups[bone] = ob.vertex_groups.new(name=bone)
            groups[bone].add([i], val, 'REPLACE')
    mod = ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm

    keys = dict(part.keys)
    if not part.no_build:
        deltas = [build_delta(sk, part.co[i], normalize(part.weights[i])) for i in range(nv)]
        if any(d.length > 1e-6 for d in deltas):
            keys[BUILD_MORPH] = [part.co[i] + deltas[i] for i in range(nv)]
    if extra_keys:
        keys.update(extra_keys)
    if keys:
        ob.shape_key_add(name='Basis', from_mix=False)
        for kname, co_list in keys.items():
            kb = ob.shape_key_add(name=kname, from_mix=False)
            kb.slider_min = -1.0
            flat = []
            for c in co_list:
                flat.extend((c.x, c.y, c.z))
            kb.data.foreach_set('co', flat)
            kb.value = 0.0
    return ob


def assign_weights(part: Part, fn) -> Part:
    part.weights = [fn(co, part.tag[i]) for i, co in enumerate(part.co)]
    return part
