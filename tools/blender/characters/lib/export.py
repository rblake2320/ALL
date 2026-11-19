"""glTF export + GLB inspection + manifest writer."""
from __future__ import annotations

import hashlib
import json
import os
import struct

import bpy
from mathutils import Matrix

from .consts import ANIM_STATES, BONES, FACE_MORPHS, MATERIALS


def export_glb(path: str, morph_normals: bool = False) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kwargs = dict(
        filepath=path, export_format='GLB', export_yup=True, export_apply=False,
        export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_frame_step=1, export_optimize_animation_size=True, export_optimize_animation_keep_anim_armature=True,
        export_skins=True, export_influence_nb=4, export_def_bones=False, export_leaf_bone=False,
        export_reset_pose_bones=True, export_rest_position_armature=True, export_anim_single_armature=True,
        export_morph=True, export_morph_normal=morph_normals, export_morph_animation=False,
        export_try_sparse_sk=True, export_attributes=True, export_vertex_color='ACTIVE', export_extras=True,
        export_materials='EXPORT', export_image_format='NONE', export_texcoords=False, export_normals=True,
        export_tangents=False, export_cameras=False, export_lights=False, export_nla_strips=True,
        use_selection=False, check_existing=False,
    )
    bpy.ops.export_scene.gltf(**kwargs)


def read_glb(path: str) -> tuple[dict, bytes]:
    with open(path, 'rb') as fh:
        data = fh.read()
    magic, version, length = struct.unpack('<III', data[:12])
    if magic != 0x46546C67:
        raise ValueError('not a GLB file')
    off = 12
    js, binchunk = None, b''
    while off < len(data):
        clen, ctype = struct.unpack('<II', data[off:off + 8])
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode('utf-8'))
        elif ctype == 0x004E4942:
            binchunk = chunk
        off += 8 + clen
    if js is None:
        raise ValueError('GLB without JSON chunk')
    return js, binchunk


def _accessor_floats(js: dict, binchunk: bytes, idx: int) -> list[float]:
    acc = js['accessors'][idx]
    bv = js['bufferViews'][acc['bufferView']]
    comps = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[acc['type']]
    if acc.get('componentType') != 5126:
        raise ValueError('only float accessors supported here')
    start = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    n = acc['count'] * comps
    return list(struct.unpack('<%df' % n, binchunk[start:start + 4 * n]))


def inspect(path: str) -> dict:
    js, binchunk = read_glb(path)
    nodes = js.get('nodes', [])
    anims = []
    for a in js.get('animations', []):
        dur = 0.0
        for s in a['samplers']:
            acc = js['accessors'][s['input']]
            dur = max(dur, float(acc.get('max', [0])[0]))
        anims.append({'name': a['name'], 'duration': round(dur, 4)})
    skins = js.get('skins', [])
    joints = [nodes[j]['name'] for j in skins[0]['joints']] if skins else []
    mesh_nodes = [n['name'] for n in nodes if 'mesh' in n]
    morphs = {}
    tris = 0
    for n in nodes:
        if 'mesh' not in n:
            continue
        m = js['meshes'][n['mesh']]
        tn = (m.get('extras') or {}).get('targetNames')
        if tn:
            morphs[n['name']] = tn
        for prim in m['primitives']:
            if 'indices' in prim:
                tris += js['accessors'][prim['indices']]['count'] // 3
    mats = [m.get('name') for m in js.get('materials', [])]
    rig = next((n for n in nodes if n.get('name') == 'Rig'), None)
    return {'animations': anims, 'joints': joints, 'meshNodes': mesh_nodes, 'morphs': morphs, 'materials': mats,
            'triangles': tris, 'rigExtras': (rig or {}).get('extras', {}), 'json': js, 'bin': binchunk}


def verify(info: dict, required_nodes: list[str]) -> list[str]:
    """Return a list of human-readable problems (empty == OK)."""
    problems = []
    names = [a['name'] for a in info['animations']]
    if sorted(names) != sorted(ANIM_STATES):
        problems.append(f'animation names mismatch: missing={sorted(set(ANIM_STATES) - set(names))} '
                        f'extra={sorted(set(names) - set(ANIM_STATES))}')
    missing_bones = [b for b in BONES if b not in info['joints']]
    if missing_bones:
        problems.append(f'missing bones: {missing_bones}')
    missing_nodes = [n for n in required_nodes if n not in info['meshNodes']]
    if missing_nodes:
        problems.append(f'missing mesh nodes: {missing_nodes}')
    head = info['morphs'].get('Head', [])
    if [m for m in FACE_MORPHS if m not in head]:
        problems.append(f'Head morphs incomplete: {head}')
    missing_mats = [m for m in MATERIALS if m not in info['materials']]
    if missing_mats:
        problems.append(f'missing materials: {missing_mats}')
    return problems


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for block in iter(lambda: fh.read(1 << 16), b''):
            h.update(block)
    return h.hexdigest()


def write_manifest(path: str, glb_path: str, rel_file: str, info: dict, clips: dict, extra: dict) -> dict:
    man = {
        'version': 1,
        'file': rel_file,
        'bytes': os.path.getsize(glb_path),
        'sha256': sha256(glb_path),
        'animations': [{'name': a['name'], 'duration': a['duration'], 'loop': bool(clips[a['name']]['loop'])}
                       for a in info['animations']],
        'morphs': list(FACE_MORPHS),
        'morphTargets': info['morphs'],
        'nodes': sorted(info['meshNodes']),
        'bones': info['joints'],
        'materials': sorted(m for m in info['materials'] if m),
        'triangles': info['triangles'],
    }
    man.update(extra)
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(man, fh, indent=2, sort_keys=False)
        fh.write('\n')
    return man


def gltf_local_quat(arm, bone: str, R: Matrix) -> list[float]:
    """glTF/three.js local rotation [x,y,z,w] of `bone` for semantic rotation R (bone frames survive export)."""
    from .skeleton import basis_quaternion
    b = arm.data.bones[bone]
    B = b.matrix_local.to_3x3()
    basis = basis_quaternion(B, R)
    if b.parent is not None:
        rel = (b.parent.matrix_local.to_3x3().inverted() @ B).to_quaternion()
    else:
        rel = (Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0))) @ B).to_quaternion()  # Z-up -> Y-up for root bones
    q = rel @ basis
    q.normalize()
    return [round(q.x, 6), round(q.y, 6), round(q.z, 6), round(q.w, 6)]
