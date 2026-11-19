"""glTF export of one cast body + a pure-python GLB reader used for post-export verification and the manifest."""
from __future__ import annotations

import hashlib
import json
import math
import os
import struct

import numpy as np

from .config import CAST_BONES, GLB_BYTES_BUDGET, HEIGHT_TOL, TEX_MAX, TRI_BUDGET

_COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def export_glb(path: str, objects, jpeg_quality: int, attributes: bool = False) -> None:
    """`attributes`: also export custom vertex attributes whose name starts with '_' (the cast's `_HEMMASK`)."""
    import bpy
    for o in bpy.context.view_layer.objects:
        if o is not None:
            o.select_set(o in objects)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', export_yup=True, export_apply=False, use_selection=True,
        export_animations=False, export_skins=True, export_influence_nb=4, export_def_bones=False,
        export_leaf_bone=False, export_rest_position_armature=True, export_reset_pose_bones=True,
        export_morph=False, export_extras=True, export_materials='EXPORT', export_image_format='JPEG',
        export_image_quality=jpeg_quality, export_jpeg_quality=jpeg_quality, export_texcoords=True,
        export_normals=True, export_tangents=False, export_cameras=False, export_lights=False,
        export_vertex_color='NONE', export_attributes=attributes, check_existing=False)


def read_glb(path: str) -> tuple[dict, bytes]:
    with open(path, 'rb') as fh:
        data = fh.read()
    magic, _ver, length = struct.unpack('<III', data[:12])
    if magic != 0x46546C67 or length != len(data):
        raise ValueError('not a valid GLB')
    off, js, bin_ = 12, None, b''
    while off < len(data):
        clen, ctype = struct.unpack('<II', data[off:off + 8])
        chunk = data[off + 8:off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode('utf-8'))
        elif ctype == 0x004E4942:
            bin_ = chunk
        off += 8 + clen
    return js, bin_


def accessor(js: dict, bin_: bytes, idx: int) -> np.ndarray:
    a = js['accessors'][idx]
    bv = js['bufferViews'][a['bufferView']]
    dt = _COMP[a['componentType']]
    n = _NC[a['type']]
    stride = bv.get('byteStride', 0)
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    item = np.dtype(dt).itemsize * n
    if stride and stride != item:
        raw = np.frombuffer(bin_, np.uint8, count=stride * a['count'], offset=start).reshape(a['count'], stride)
        return raw[:, :item].copy().view(dt).reshape(a['count'], n)
    return np.frombuffer(bin_, dt, count=a['count'] * n, offset=start).reshape(a['count'], n)


def _quat_mat(q) -> np.ndarray:
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def inspect(path: str) -> dict:
    js, bin_ = read_glb(path)
    nodes = js['nodes']
    skin = js['skins'][0]
    joints = [nodes[j]['name'] for j in skin['joints']]
    rest_rot = {nodes[j]['name']: list(nodes[j].get('rotation', [0, 0, 0, 1])) for j in skin['joints']}
    rest_t = {nodes[j]['name']: list(nodes[j].get('translation', [0, 0, 0])) for j in skin['joints']}
    # world rest positions of joints (skeleton nodes; the armature node may hold a transform too)
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []):
            parent[c] = i

    def world(i):
        n = nodes[i]
        R = _quat_mat(n.get('rotation', [0, 0, 0, 1])) * np.array(n.get('scale', [1, 1, 1]))
        T = np.eye(4); T[:3, :3] = R; T[:3, 3] = n.get('translation', [0, 0, 0])
        return world(parent[i]) @ T if i in parent else T
    joint_pos = {nodes[j]['name']: world(j)[:3, 3].tolist() for j in skin['joints']}
    tris = 0
    pos_min, pos_max = None, None
    mesh_nodes = []
    for n in nodes:
        if 'mesh' not in n:
            continue
        mesh_nodes.append(n['name'])
        for p in js['meshes'][n['mesh']]['primitives']:
            tris += js['accessors'][p['indices']]['count'] // 3
            a = js['accessors'][p['attributes']['POSITION']]
            mn, mx = np.array(a['min']), np.array(a['max'])
            pos_min = mn if pos_min is None else np.minimum(pos_min, mn)
            pos_max = mx if pos_max is None else np.maximum(pos_max, mx)
    images = []
    for im in js.get('images', []):
        bv = js['bufferViews'][im['bufferView']]
        raw = bin_[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
        images.append({'mimeType': im.get('mimeType'), 'bytes': bv['byteLength'], 'size': jpeg_size(raw)})
    mats = js.get('materials', [])
    return {'json': js, 'bin': bin_, 'joints': joints, 'restRot': rest_rot, 'restT': rest_t, 'jointPos': joint_pos,
            'triangles': tris, 'min': pos_min.tolist(), 'max': pos_max.tolist(), 'meshNodes': mesh_nodes,
            'images': images, 'materials': [m.get('name') for m in mats], 'materialDefs': mats,
            'animations': len(js.get('animations', []))}


def jpeg_size(raw: bytes):
    if raw[:2] != b'\xff\xd8':
        if raw[:8] == b'\x89PNG\r\n\x1a\n':
            return list(struct.unpack('>II', raw[16:24]))
        return None
    i = 2
    while i < len(raw):
        if raw[i] != 0xFF:
            i += 1
            continue
        m = raw[i + 1]
        if m in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack('>HH', raw[i + 5:i + 9])
            return [w, h]
        L = struct.unpack('>H', raw[i + 2:i + 4])[0]
        i += 2 + L
    return None


def zombie_rest_rotations(zombie_glb: str) -> dict:
    js, _ = read_glb(zombie_glb)
    nodes = js['nodes']
    return {nodes[j]['name']: list(nodes[j].get('rotation', [0, 0, 0, 1])) for j in js['skins'][0]['joints']}


def quat_angle_deg(a, b) -> float:
    """Rotation angle between unit quaternions, numerically stable near 0 (acos(dot) is not)."""
    a, b = np.asarray(a, np.float64), np.asarray(b, np.float64)
    d = min(np.linalg.norm(a - b), np.linalg.norm(a + b))
    return math.degrees(4 * math.asin(min(1.0, d / 2)))


def verify(info: dict, height: float, zrot: dict, nbytes: int, limits: dict | None = None) -> list[str]:
    """`limits` = {'tris', 'bytes', 'tex'} for a representation with its own declared budget (premium bodies);
    omitted = the cast budget in config.py, unchanged."""
    lim = {'tris': TRI_BUDGET, 'bytes': GLB_BYTES_BUDGET, 'tex': TEX_MAX}
    if limits is not None:
        if set(limits) != set(lim):
            raise ValueError(f'limits must give exactly {sorted(lim)}, got {sorted(limits)}')
        lim = dict(limits)
    p = []
    if sorted(info['joints']) != sorted(CAST_BONES):
        p.append(f'joint set mismatch: {sorted(set(info["joints"]) ^ set(CAST_BONES))}')
    for n in CAST_BONES:
        if n in info['restRot'] and n in zrot:
            a = quat_angle_deg(info['restRot'][n], zrot[n])
            if a > 0.001:
                p.append(f'{n} rest rotation differs from zombie.glb by {a:.5f} deg')
    if info['triangles'] > lim['tris']:
        p.append(f'{info["triangles"]} triangles > {lim["tris"]}')
    if nbytes > lim['bytes']:
        p.append(f'{nbytes} bytes > {lim["bytes"]}')
    for im in info['images']:
        if im['mimeType'] != 'image/jpeg':
            p.append(f'image is {im["mimeType"]}, expected JPEG')
        if not im['size'] or max(im['size']) > lim['tex']:
            p.append(f'image size {im["size"]} > {lim["tex"]}')
    if abs(info['max'][1] - height) > HEIGHT_TOL:
        p.append(f'height {info["max"][1]:.3f} != {height}')
    if abs(info['min'][1]) > 0.005:
        p.append(f'feet not on y=0 (min y {info["min"][1]:.4f})')
    if info['animations']:
        p.append('cast GLB must not carry animations (clips are shared from zombie.glb)')
    if info['meshNodes'] != ['Body']:
        p.append(f'mesh nodes {info["meshNodes"]} != ["Body"]')
    return p


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for blk in iter(lambda: fh.read(1 << 16), b''):
            h.update(blk)
    return h.hexdigest()
