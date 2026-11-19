"""Minimal binary glTF reader used for manifest stats and post-export validation.

Reads the JSON + BIN chunks, walks the node hierarchy (TRS or matrix), and returns world-space bounds (glTF/Three
axes), triangle counts, node names/parents, materials and per-node vertex centroids. Pure Python + numpy
(numpy ships with the Blender venv); falls back to accessor min/max corners when numpy is missing.
"""
from __future__ import annotations

import json
import math
import struct
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

try:
    import numpy as np
except ImportError:  # pragma: no cover
    np = None  # type: ignore

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942

_COMP = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
_NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


@dataclass
class GlbInfo:
    json: dict
    tris: int
    bounds_min: Tuple[float, float, float]
    bounds_max: Tuple[float, float, float]
    node_names: List[str]
    parents: Dict[str, Optional[str]]
    materials: List[str]
    node_centroids: Dict[str, Tuple[float, float, float]] = field(default_factory=dict)
    node_world_pos: Dict[str, Tuple[float, float, float]] = field(default_factory=dict)
    node_bounds: Dict[str, Tuple[Tuple[float, float, float], Tuple[float, float, float]]] = field(default_factory=dict)
    node_mean_normal: Dict[str, Tuple[float, float, float]] = field(default_factory=dict)
    vertex_count: int = 0
    #: all world-space vertex positions (N, 3) when numpy is available
    vertices: object = None


def read_chunks(data: bytes) -> Tuple[dict, bytes]:
    magic, version, length = struct.unpack_from('<III', data, 0)
    if magic != GLB_MAGIC or version != 2:
        raise ValueError('not a glTF 2.0 binary')
    off = 12
    js, binc = None, b''
    while off < min(length, len(data)):
        clen, ctype = struct.unpack_from('<II', data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == CHUNK_JSON:
            js = json.loads(chunk.decode('utf-8'))
        elif ctype == CHUNK_BIN:
            binc = chunk
        off += 8 + clen
    if js is None:
        raise ValueError('GLB without JSON chunk')
    return js, binc


def _mat_mul(a: List[float], b: List[float]) -> List[float]:
    """Column-major 4x4 multiply (glTF convention)."""
    out = [0.0] * 16
    for c in range(4):
        for r in range(4):
            out[c * 4 + r] = sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4))
    return out


def _trs(node: dict) -> List[float]:
    if 'matrix' in node:
        return list(node['matrix'])
    t = node.get('translation', [0, 0, 0])
    q = node.get('rotation', [0, 0, 0, 1])
    s = node.get('scale', [1, 1, 1])
    x, y, z, w = q
    r = [
        1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
        2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
        0, 0, 0, 1,
    ]
    for c in range(3):
        for k in range(3):
            r[c * 4 + k] *= s[c]
    r[12], r[13], r[14] = t
    return r


def _apply(m: List[float], p: Tuple[float, float, float]) -> Tuple[float, float, float]:
    x, y, z = p
    return (m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14])


def _accessor_array(js: dict, binc: bytes, idx: int):
    acc = js['accessors'][idx]
    bv = js['bufferViews'][acc['bufferView']]
    fmt, size = _COMP[acc['componentType']]
    n = _NCOMP[acc['type']]
    count = acc['count']
    start = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = bv.get('byteStride', size * n)
    if np is not None:
        dt = np.dtype('<' + fmt)
        if stride == size * n:
            arr = np.frombuffer(binc, dtype=dt, count=count * n, offset=start).reshape(count, n)
        else:
            rows = [np.frombuffer(binc, dtype=dt, count=n, offset=start + i * stride) for i in range(count)]
            arr = np.stack(rows)
        out = arr.astype(np.float64)
        if acc.get('normalized'):
            ct = acc['componentType']
            out = out / {5120: 127.0, 5121: 255.0, 5122: 32767.0, 5123: 65535.0}.get(ct, 1.0)
            if ct in (5120, 5122):
                out = np.maximum(out, -1.0)
        return out
    vals = []
    for i in range(count):
        vals.append(struct.unpack_from('<' + fmt * n, binc, start + i * stride))
    return vals


def inspect(path: Path, exclude_from_bounds: Tuple[str, ...] = ('broken',)) -> GlbInfo:
    """Stats for a GLB. Subtrees named in ``exclude_from_bounds`` (hidden-by-default overlays such as the
    'broken' smoke) still count toward tris but not toward the model bounds."""
    data = Path(path).read_bytes()
    js, binc = read_chunks(data)
    nodes = js.get('nodes', [])
    parents: Dict[int, Optional[int]] = {i: None for i in range(len(nodes))}
    for i, nd in enumerate(nodes):
        for c in nd.get('children', []):
            parents[c] = i
    world: Dict[int, List[float]] = {}

    def wm(i: int) -> List[float]:
        if i in world:
            return world[i]
        local = _trs(nodes[i])
        p = parents[i]
        world[i] = local if p is None else _mat_mul(wm(p), local)
        return world[i]

    excluded = set()
    for i, nd in enumerate(nodes):
        p, hit = i, False
        while p is not None:
            if nodes[p].get('name') in exclude_from_bounds:
                hit = True
                break
            p = parents[p]
        if hit:
            excluded.add(i)
    tris = 0
    vcount = 0
    gmin = [math.inf] * 3
    gmax = [-math.inf] * 3
    centroids: Dict[str, Tuple[float, float, float]] = {}
    nbounds = {}
    nnormals = {}
    allverts = []
    for i, nd in enumerate(nodes):
        if 'mesh' not in nd:
            continue
        m = wm(i)
        mesh = js['meshes'][nd['mesh']]
        acc_sum = [0.0, 0.0, 0.0]
        acc_n = 0
        nmin = [math.inf] * 3
        nmax = [-math.inf] * 3
        nsum = [0.0, 0.0, 0.0]
        for prim in mesh['primitives']:
            mode = prim.get('mode', 4)
            if 'indices' in prim:
                ic = js['accessors'][prim['indices']]['count']
            else:
                ic = js['accessors'][prim['attributes']['POSITION']]['count']
            if mode == 4:
                tris += ic // 3
            pos = _accessor_array(js, binc, prim['attributes']['POSITION'])
            vcount += len(pos)
            if np is not None:
                M = np.array(m, dtype=np.float64).reshape(4, 4).T
                hp = np.hstack([pos, np.ones((len(pos), 1))]) @ M.T
                wp = hp[:, :3]
                if i not in excluded:
                    allverts.append(wp)
                if 'NORMAL' in prim['attributes']:
                    nrm = _accessor_array(js, binc, prim['attributes']['NORMAL'])
                    wn = nrm @ M[:3, :3].T
                    ns = wn.sum(axis=0)
                    for k in range(3):
                        nsum[k] += float(ns[k])
                lo, hi = wp.min(axis=0), wp.max(axis=0)
                s = wp.sum(axis=0)
                for k in range(3):
                    if i not in excluded:
                        gmin[k] = min(gmin[k], float(lo[k]))
                        gmax[k] = max(gmax[k], float(hi[k]))
                    nmin[k] = min(nmin[k], float(lo[k]))
                    nmax[k] = max(nmax[k], float(hi[k]))
                    acc_sum[k] += float(s[k])
                acc_n += len(wp)
            else:  # pragma: no cover
                for p in pos:
                    w = _apply(m, p)
                    for k in range(3):
                        gmin[k] = min(gmin[k], w[k])
                        gmax[k] = max(gmax[k], w[k])
                        nmin[k] = min(nmin[k], w[k])
                        nmax[k] = max(nmax[k], w[k])
                        acc_sum[k] += w[k]
                    acc_n += 1
        name = nd.get('name', f'node{i}')
        if acc_n:
            centroids[name] = tuple(c / acc_n for c in acc_sum)  # type: ignore[assignment]
            nbounds[name] = (tuple(nmin), tuple(nmax))
            nnormals[name] = tuple(c / acc_n for c in nsum)  # type: ignore[assignment]
    names = [nd.get('name', f'node{i}') for i, nd in enumerate(nodes)]
    wpos = {names[i]: _apply(wm(i), (0.0, 0.0, 0.0)) for i in range(len(nodes))}
    if gmin[0] == math.inf:
        gmin = [0.0, 0.0, 0.0]
        gmax = [0.0, 0.0, 0.0]
    return GlbInfo(
        json=js,
        tris=tris,
        bounds_min=tuple(gmin),  # type: ignore[arg-type]
        bounds_max=tuple(gmax),  # type: ignore[arg-type]
        node_names=names,
        parents={names[i]: (names[p] if p is not None else None) for i, p in parents.items()},
        materials=[m.get('name', '') for m in js.get('materials', [])],
        node_centroids=centroids,
        node_world_pos=wpos,
        node_bounds=nbounds,
        node_mean_normal=nnormals,
        vertex_count=vcount,
        vertices=(np.vstack(allverts) if (np is not None and allverts) else None),
    )


def write_glb(path: Path, js: dict, binc: bytes) -> None:
    jb = json.dumps(js, separators=(',', ':')).encode('utf-8')
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    binc += b'\x00' * ((4 - len(binc) % 4) % 4)
    total = 12 + 8 + len(jb) + (8 + len(binc) if binc else 0)
    out = struct.pack('<III', GLB_MAGIC, 2, total) + struct.pack('<II', len(jb), CHUNK_JSON) + jb
    if binc:
        out += struct.pack('<II', len(binc), CHUNK_BIN) + binc
    Path(path).write_bytes(out)


def _canonical_order(blobs: List[bytes], strides: List[int], count: int, indices):
    """Deterministic, de-duplicated vertex set (sorted on the packed attribute bytes) + canonical triangle order.

    The exporter's vertex splitting and order depend on float noise in multi-threaded normal evaluation (weighted
    normals at UV-sphere poles); after quantisation the vertex *set* is stable, so identical packed vertices are
    merged and the rest sorted, which makes rebuilds byte-identical. Returns (source row of every kept vertex,
    remapped index buffer)."""
    rows = np.concatenate([np.frombuffer(b, dtype=np.uint8).reshape(count, st) for b, st in zip(blobs, strides)], axis=1)
    _, first, inverse = np.unique(rows, axis=0, return_index=True, return_inverse=True)
    rank = np.asarray(inverse, dtype=np.int64).reshape(-1)
    tri = rank[np.asarray(indices, dtype=np.int64).reshape(-1, 3)]
    # merging can collapse sliver triangles (two corners quantise to the same vertex): drop those degenerate
    # triangles -- they rasterise nothing but cost index bandwidth and confuse normal/AO tooling
    tri = tri[(tri[:, 0] != tri[:, 1]) & (tri[:, 1] != tri[:, 2]) & (tri[:, 0] != tri[:, 2])]
    # rotate each triangle so its smallest index comes first (winding preserved), sort, drop exact duplicates
    m = tri.argmin(axis=1)
    rot = np.stack([tri[np.arange(len(tri)), (m + k) % 3] for k in range(3)], axis=1)
    if len(rot):
        rot = np.unique(rot, axis=0)          # lexicographically sorted + de-duplicated (same winding only)
    # compact: keep only vertices still referenced (stable order), remap indices
    first = np.asarray(first, dtype=np.int64)
    used = np.unique(rot.reshape(-1)) if len(rot) else np.zeros(0, dtype=np.int64)
    if len(used) != len(first):
        lut = np.full(len(first), -1, dtype=np.int64)
        lut[used] = np.arange(len(used), dtype=np.int64)
        first = first[used]
        rot = lut[rot]
    return first, rot.reshape(-1)


def quantize(path: Path, normals: bool = True, colors: bool = True) -> Tuple[int, int]:
    """Shrink a GLB in place with KHR_mesh_quantization: NORMAL float32x3 -> int8x3 normalized (+1 pad byte),
    COLOR_0 uint16x4 -> uint8x4 normalized. Positions and node transforms are untouched, so runtime animation
    of pivots is unaffected. Returns (bytes_before, bytes_after)."""
    if np is None:  # pragma: no cover
        return (Path(path).stat().st_size,) * 2
    data = Path(path).read_bytes()
    js, binc = read_chunks(data)
    views = js.get('bufferViews', [])
    accs = js.get('accessors', [])
    # copy every bufferView's bytes, then replace converted accessors with fresh tightly-packed views
    blobs: List[bytes] = [binc[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']] for v in views]
    view_targets = [v.get('target') for v in views]
    converted = {}
    for mesh in js.get('meshes', []):
        for prim in mesh['primitives']:
            for attr, ai in prim['attributes'].items():
                if ai in converted:
                    continue
                acc = accs[ai]
                if normals and attr == 'NORMAL' and acc['componentType'] == 5126 and acc['type'] == 'VEC3':
                    arr = _accessor_array(js, binc, ai)
                    q = np.clip(np.round(arr * 127.0), -127, 127).astype(np.int8)
                    packed = np.zeros((len(q), 4), dtype=np.int8)
                    packed[:, :3] = q
                    converted[ai] = (packed.tobytes(), 5120, 4)
                elif colors and attr.startswith('COLOR_') and acc['componentType'] == 5123:
                    arr = _accessor_array(js, binc, ai)  # already normalised to 0..1 by the reader
                    n = _NCOMP[acc['type']]
                    q = np.clip(np.round(arr * 255.0), 0, 255).astype(np.uint8)
                    if n == 3:
                        q = np.hstack([q, np.zeros((len(q), 1), dtype=np.uint8)])
                    converted[ai] = (q.tobytes(), 5121, 4)
    if not converted:
        return (len(data), len(data))
    # the exporter de-duplicates identical index buffers across primitives: give every primitive its own index
    # accessor (same data) so each one can be re-ordered independently
    seen_idx = set()
    for mesh in js.get('meshes', []):
        for prim in mesh['primitives']:
            ii = prim.get('indices')
            if ii is None:
                continue
            if ii in seen_idx:
                accs.append(dict(accs[ii]))
                prim['indices'] = len(accs) - 1
            else:
                seen_idx.add(ii)
    # canonical vertex/triangle order per primitive (only when the primitive owns all of its accessors)
    users: Dict[int, int] = {}
    for mesh in js.get('meshes', []):
        for prim in mesh['primitives']:
            for ai in list(prim['attributes'].values()) + ([prim['indices']] if 'indices' in prim else []):
                users[ai] = users.get(ai, 0) + 1
    rewritten: Dict[int, Tuple[bytes, int, int]] = {}
    for mesh in js.get('meshes', []):
        for prim in mesh['primitives']:
            if prim.get('mode', 4) != 4 or 'indices' not in prim:
                continue
            attrs = prim['attributes']
            ids = list(attrs.values()) + [prim['indices']]
            if any(users[i] != 1 for i in ids):
                continue
            count = accs[attrs['POSITION']]['count']
            names = sorted(attrs.keys())
            attr_blobs: List[bytes] = []
            attr_strides: List[int] = []
            for name in names:
                ai = attrs[name]
                if ai in converted:
                    blob, _, st = converted[ai]
                else:
                    acc = accs[ai]
                    fmt, size = _COMP[acc['componentType']]
                    st = size * _NCOMP[acc['type']]
                    bv = views[acc['bufferView']]
                    start = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
                    if bv.get('byteStride', st) != st:
                        break
                    blob = binc[start:start + st * count]
                attr_blobs.append(blob)
                attr_strides.append(st)
            else:
                idx = _accessor_array(js, binc, prim['indices']).astype(np.int64).reshape(-1)
                order, new_idx = _canonical_order(attr_blobs, attr_strides, count, idx)
                for name, blob, st in zip(names, attr_blobs, attr_strides):
                    arr = np.frombuffer(blob, dtype=np.uint8).reshape(count, st)[order]
                    ai = attrs[name]
                    ct = converted[ai][1] if ai in converted else accs[ai]['componentType']
                    rewritten[ai] = (arr.tobytes(), ct, st)
                    accs[ai]['count'] = int(len(order))  # duplicates merged
                ia = accs[prim['indices']]
                dt = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32}[ia['componentType']]
                rewritten[prim['indices']] = (new_idx.astype(dt).tobytes(), ia['componentType'], 0)
                if len(new_idx) == 0:
                    raise ValueError(f'{Path(path).name}: a primitive of mesh {mesh.get("name")!r} has only '
                                     'degenerate triangles')
                ia['count'] = int(len(new_idx))      # degenerate/duplicate triangles may have been dropped
                if 'min' in ia or 'max' in ia:
                    ia['min'], ia['max'] = [int(new_idx.min())], [int(new_idx.max())]
    for ai, (blob, ct, st) in rewritten.items():
        converted[ai] = (blob, ct, st)
    used_views = set()
    for ai, acc in enumerate(accs):
        if ai not in converted and 'bufferView' in acc:
            used_views.add(acc['bufferView'])
    for img in js.get('images', []):
        if 'bufferView' in img:
            used_views.add(img['bufferView'])
    new_views, new_blobs, remap = [], [], {}
    for vi in sorted(used_views):
        remap[vi] = len(new_views)
        v = dict(views[vi])
        new_views.append(v)
        new_blobs.append(blobs[vi])
    for ai, (blob, ctype, stride) in converted.items():
        acc = accs[ai]
        acc['bufferView'] = len(new_views)
        acc['byteOffset'] = 0
        acc['componentType'] = ctype
        if ctype in (5120, 5121) and acc['type'] != 'SCALAR':
            acc['normalized'] = True  # quantised normals / colours
        if acc.get('normalized') and ctype in (5120, 5121):
            acc.pop('min', None)
            acc.pop('max', None)
        view = {'buffer': 0, 'byteLength': len(blob), 'target': 34963 if stride == 0 else 34962}
        if stride and ctype != 5126:
            view['byteStride'] = stride
        new_views.append(view)
        new_blobs.append(blob)
    for ai, acc in enumerate(accs):
        if ai not in converted and 'bufferView' in acc:
            acc['bufferView'] = remap[acc['bufferView']]
    for img in js.get('images', []):
        if 'bufferView' in img:
            img['bufferView'] = remap[img['bufferView']]
    out = bytearray()
    for v, blob in zip(new_views, new_blobs):
        pad = (4 - len(out) % 4) % 4
        out += b'\x00' * pad
        v['byteOffset'] = len(out)
        v['byteLength'] = len(blob)
        out += blob
    js['bufferViews'] = new_views
    js['buffers'] = [{'byteLength': len(out)}]
    ext = set(js.get('extensionsUsed', []))
    ext.add('KHR_mesh_quantization')
    js['extensionsUsed'] = sorted(ext)
    req = set(js.get('extensionsRequired', []))
    req.add('KHR_mesh_quantization')
    js['extensionsRequired'] = sorted(req)
    write_glb(path, js, bytes(out))
    return (len(data), Path(path).stat().st_size)
