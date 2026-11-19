"""Part -> skinned Blender object, materials, action baking, glTF export, GLB inspection and checks."""
from __future__ import annotations

import hashlib
import json
import math
import os
import struct

import bpy
from mathutils import Matrix, Quaternion, Vector

from . import body, clips
from .rig import Rig, ensure_armature, euler
from .species import CLIP_TIMING, CLIPS, FPS, MATERIALS, SPECIES, VARIANT_MATERIALS, hex_lin

TRI_BUDGET = 3000
VARIANTS = ('normal', 'undead')
LINEAR = 1


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    bpy.context.scene.render.fps_base = 1.0
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.actions, bpy.data.images):
        for item in list(coll):
            coll.remove(item)


def make_materials(paint_hex: str) -> dict:
    mats = {}
    for name, (hx, rough, emission) in MATERIALS.items():
        r, g, b = hex_lin(hx or paint_hex)
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nt = mat.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        # Base Color stays an unlinked constant so glTF gets baseColorFactor; COLOR_0 ships separately and the
        # renderer multiplies it in (same contract as the zombie). Previews link the multiply (preview.py).
        bsdf.inputs['Base Color'].default_value = (r, g, b, 1.0)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = 0.0
        if emission is not None:
            bsdf.inputs['Emission Color'].default_value = (r, g, b, 1.0)
            bsdf.inputs['Emission Strength'].default_value = emission
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
        mat.diffuse_color = (r, g, b, 1.0)
        mats[name] = mat
    return mats


def part_to_object(part, mats: dict, arm) -> bpy.types.Object:
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
    me.update()
    ob = bpy.data.objects.new(part.name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = arm
    groups = {}
    for i, w in enumerate(part.weights):
        tot = sum(v for v in w.values() if v > 0)
        top = sorted(((v / tot, b) for b, v in w.items() if v > 0), reverse=True)[:4]
        norm = sum(v for v, _ in top)
        for v, bone in top:
            if bone not in groups:
                groups[bone] = ob.vertex_groups.new(name=bone)
            groups[bone].add([i], v / norm, 'REPLACE')
    mod = ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    return ob


def tri_count(part) -> int:
    return sum(len(f) - 2 for f in part.faces)


# ---------------------------------------------------------------------------------------------------
# Animation
# ---------------------------------------------------------------------------------------------------

def _basis(B: Matrix, R: Matrix) -> Quaternion:
    return (B.inverted() @ R @ B).to_quaternion()


def apply_pose(arm, rig: Rig, pose) -> None:
    B = {b.name: b.matrix_local.to_3x3() for b in arm.data.bones}
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = _basis(B[pb.name], euler(pose.rot.get(pb.name, (0.0, 0.0, 0.0))))
        pb.location = (B['hips'].inverted() @ pose.loc) if pb.name == 'hips' else Vector((0, 0, 0))
    bpy.context.view_layer.update()


def _write(fc, frames, values) -> None:
    fc.keyframe_points.add(len(frames))
    co = []
    for f, v in zip(frames, values):
        co.extend((float(f), float(v)))
    fc.keyframe_points.foreach_set('co', co)
    fc.keyframe_points.foreach_set('interpolation', [LINEAR] * len(frames))
    fc.update()


def bake_clips(arm, rig: Rig) -> None:
    """One slotted action + muted NLA track per clip; every bone keyed on every frame at 30 fps."""
    B = {b.name: b.matrix_local.to_3x3() for b in arm.data.bones}
    bones = [b.name for b in arm.data.bones]
    if arm.animation_data is None:
        arm.animation_data_create()
    ad = arm.animation_data
    for name in CLIPS:
        dur, loop = CLIP_TIMING[name]
        nframes = round(dur * FPS)
        frames = list(range(nframes + 1))
        quats = {b: [] for b in bones}
        locs = []
        for f in frames:
            pose = clips.pose_at(rig, name, f / FPS)
            for b in bones:
                q = _basis(B[b], euler(pose.rot.get(b, (0.0, 0.0, 0.0))))
                if quats[b] and quats[b][-1].dot(q) < 0:
                    q = -q
                quats[b].append(q)
            locs.append(B['hips'].inverted() @ pose.loc)
        if loop:
            for b in bones:
                quats[b][-1] = quats[b][0].copy()
            locs[-1] = locs[0].copy()
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        slot = act.slots.new(id_type='OBJECT', name='Rig')
        strip = act.layers.new('Layer').strips.new(type='KEYFRAME')
        cb = strip.channelbags.new(slot)
        for b in bones:
            path = f'pose.bones["{b}"].rotation_quaternion'
            for i in range(4):
                _write(cb.fcurves.new(path, index=i, group_name=b), frames, [q[i] for q in quats[b]])
        for i in range(3):
            _write(cb.fcurves.new('pose.bones["hips"].location', index=i, group_name='hips'), frames,
                   [v[i] for v in locs])
        act.frame_range = (0, nframes)
        act.use_frame_range = True
        ad.action = act
        ad.action_slot = slot
        track = ad.nla_tracks.new()
        track.name = name
        st = track.strips.new(name, 0, act)
        try:
            st.action_slot = slot
        except Exception:  # noqa: BLE001 - assigned automatically on some builds
            pass
        track.mute = True
        ad.action = None


def ground_clearance(arm, rig: Rig, objs: list) -> dict:
    """Lowest deformed vertex (mm, negative = below the floor) per clip, over every baked frame."""
    out = {}
    dg = bpy.context.evaluated_depsgraph_get()
    for name in CLIPS:
        dur, _ = CLIP_TIMING[name]
        low = 1e9
        for f in range(round(dur * FPS)):
            apply_pose(arm, rig, clips.pose_at(rig, name, f / FPS))
            dg.update()
            for ob in objs:
                ev = ob.evaluated_get(dg)
                me = ev.to_mesh()
                low = min(low, min(v.co.z for v in me.vertices))
                ev.to_mesh_clear()
        out[name] = round(low * 1000.0, 1)
    apply_pose(arm, rig, clips.Pose())
    return out


# ---------------------------------------------------------------------------------------------------
# Export + inspection
# ---------------------------------------------------------------------------------------------------

def export_glb(path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kwargs = dict(
        filepath=path, export_format='GLB', export_yup=True, export_apply=False,
        export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_frame_step=1, export_optimize_animation_size=True, export_optimize_animation_keep_anim_armature=True,
        export_skins=True, export_influence_nb=4, export_def_bones=False, export_leaf_bone=False,
        export_reset_pose_bones=True, export_rest_position_armature=True, export_anim_single_armature=True,
        export_morph=False, export_attributes=False, export_vertex_color='ACTIVE', export_extras=False,
        export_materials='EXPORT', export_image_format='NONE', export_texcoords=False, export_normals=True,
        export_tangents=False, export_cameras=False, export_lights=False, export_nla_strips=True,
        use_selection=False, check_existing=False,
    )
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    dropped = sorted(k for k in kwargs if k not in props)
    if dropped:
        print(f'[pets] exporter does not know: {dropped} (skipped)')
    bpy.ops.export_scene.gltf(**{k: v for k, v in kwargs.items() if k in props})


def read_glb(path: str) -> tuple[dict, bytes]:
    with open(path, 'rb') as fh:
        data = fh.read()
    magic, _, _ = struct.unpack('<III', data[:12])
    if magic != 0x46546C67:
        raise ValueError('not a GLB file')
    off, js, binc = 12, None, b''
    while off < len(data):
        clen, ctype = struct.unpack('<II', data[off:off + 8])
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode('utf-8'))
        elif ctype == 0x004E4942:
            binc = chunk
        off += 8 + clen
    return js, binc


def inspect(path: str) -> dict:
    js, _ = read_glb(path)
    nodes, acc = js.get('nodes', []), js['accessors']
    info = {'meshes': {}, 'materials': sorted(m.get('name', '') for m in js.get('materials', [])),
            'images': len(js.get('images', [])), 'textures': len(js.get('textures', [])),
            'joints': [nodes[j]['name'] for j in js['skins'][0]['joints']] if js.get('skins') else [],
            'skins': len(js.get('skins', [])), 'animations': []}
    for a in js.get('animations', []):
        dur = max(float(acc[s['input']].get('max', [0])[0]) for s in a['samplers'])
        info['animations'].append({'name': a['name'], 'duration': round(dur, 4), 'channels': len(a['channels'])})
    for n in nodes:
        if 'mesh' not in n:
            continue
        tris, lo, hi = 0, [1e9] * 3, [-1e9] * 3
        for p in js['meshes'][n['mesh']]['primitives']:
            tris += acc[p['indices']]['count'] // 3
            pa = acc[p['attributes']['POSITION']]
            lo = [min(a, b) for a, b in zip(lo, pa['min'])]
            hi = [max(a, b) for a, b in zip(hi, pa['max'])]
        info['meshes'][n['name']] = {'triangles': tris, 'min': [round(v, 4) for v in lo], 'max': [round(v, 4) for v in hi],
                                     'skinned': 'skin' in n,
                                     'attributes': sorted(js['meshes'][n['mesh']]['primitives'][0]['attributes'])}
    return info


def verify(info: dict, rig: Rig, clearance: dict) -> list[str]:
    problems = []
    names = [a['name'] for a in info['animations']]
    if sorted(names) != sorted(CLIPS):
        problems.append(f'animations {sorted(names)} != {sorted(CLIPS)}')
    for a in info['animations']:
        want = CLIP_TIMING.get(a['name'], (None,))[0]
        if want is not None and abs(a['duration'] - want) > 1e-3:
            problems.append(f"{a['name']}: duration {a['duration']} != {want}")
    if sorted(info['meshes']) != ['Pet_normal', 'Pet_undead']:
        problems.append(f"mesh nodes {sorted(info['meshes'])}")
    for name, m in info['meshes'].items():
        if m['triangles'] > TRI_BUDGET:
            problems.append(f"{name}: {m['triangles']} triangles > {TRI_BUDGET}")
        if not m['skinned']:
            problems.append(f'{name}: not skinned')
        if not -0.002 <= m['min'][1] <= 0.003:
            problems.append(f"{name}: feet not on y=0 (min y {m['min'][1]})")
        if 'COLOR_0' not in m['attributes']:
            problems.append(f'{name}: no COLOR_0')
    if info['skins'] != 1:
        problems.append(f"{info['skins']} skins (want 1 shared skeleton)")
    missing = [b for b in rig.order if b != 'root' and b not in info['joints']]
    if missing:
        problems.append(f'bones missing from the skin: {missing}')
    if info['images'] or info['textures']:
        problems.append('GLB contains images/textures')
    allowed = set(VARIANT_MATERIALS['normal']) | set(VARIANT_MATERIALS['undead'])
    if not set(info['materials']) <= allowed:
        problems.append(f"unexpected materials: {sorted(set(info['materials']) - allowed)}")
    for need in ('Paint', 'EyeGlowA', 'EyeGlowB', 'Stitch'):
        if need not in info['materials']:
            problems.append(f'material {need} missing')
    if rig.head['head'].y >= rig.head['hips'].y:
        problems.append('head is not in front of the hips (front must be -Y in Blender = +Z in glTF)')
    for clip, mm in clearance.items():
        if mm < -6.0:
            problems.append(f'{clip}: mesh sinks {-mm} mm below the floor')
        if clip not in ('flee',) and mm > 12.0:
            problems.append(f'{clip}: mesh floats {mm} mm above the floor')
    return problems


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for block in iter(lambda: fh.read(1 << 16), b''):
            h.update(block)
    return h.hexdigest()


def build_scene(species: str) -> tuple:
    """Fresh scene with the armature, both variant meshes and all baked clips. Returns (rig, arm, objs, tris)."""
    sp = SPECIES[species]
    reset_scene()
    rig = Rig(sp)
    arm = ensure_armature(rig)
    mats = make_materials(sp['paint'])
    objs, tris = [], {}
    for variant in VARIANTS:
        part = body.build_part(rig, variant)
        used = set(part.mats_used())
        extra = used - set(VARIANT_MATERIALS[variant])
        if extra:
            raise RuntimeError(f'{species}/{variant}: unexpected materials {sorted(extra)}')
        tris[part.name] = tri_count(part)
        objs.append(part_to_object(part, mats, arm))
    return rig, arm, objs, tris
