"""Compare two GLB files by what they contain, not by their bytes.

Blender writes the same model with different last float bits on Linux and on Windows, and may order vertices
differently, so a rebuild on another platform is not byte-identical. `diff()` says whether two files are the same
model: same nodes (names, parents, transforms, extras), same materials, and per mesh primitive the same vertex
and triangle counts, the same coordinates (sorted per axis), bounds, surface area and centroid, within a
tolerance.

The geometry comparison uses sums over the whole primitive rather than a hash of rounded coordinates: a hash
flips when a coordinate that sits on a rounding boundary moves by 1e-8, which is exactly the case this is for.

Pure Python (no bpy), so tests can run it with a system python.
"""
from __future__ import annotations

import json
import math
import struct
from typing import Any, Dict, List, Tuple

_FMT = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
_NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

#: default tolerance in metres for positions, bounds and transforms
TOL = 1e-5


def read(path: str) -> Tuple[Dict[str, Any], bytes]:
    data = open(path, 'rb').read()
    if data[:4] != b'glTF':
        raise ValueError(f'{path}: not a GLB')
    o, js, binary = 12, None, b''
    while o < len(data):
        n, kind = struct.unpack('<II', data[o:o + 8])
        chunk = data[o + 8:o + 8 + n]
        if kind == 0x4E4F534A:
            js = json.loads(chunk)
        elif kind == 0x004E4942:
            binary = chunk
        o += 8 + n
    if js is None:
        raise ValueError(f'{path}: no JSON chunk')
    return js, binary


def _accessor(js: Dict[str, Any], binary: bytes, index: int) -> List[Tuple[float, ...]]:
    acc = js['accessors'][index]
    bv = js['bufferViews'][acc['bufferView']]
    fmt = _FMT[acc['componentType']]
    ncomp = _NCOMP[acc['type']]
    size = struct.calcsize(fmt) * ncomp
    stride = bv.get('byteStride') or size
    start = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    return [struct.unpack_from('<' + fmt * ncomp, binary, start + i * stride) for i in range(acc['count'])]


def _prim(js: Dict[str, Any], binary: bytes, prim: Dict[str, Any]) -> Dict[str, Any]:
    pos = _accessor(js, binary, prim['attributes']['POSITION'])
    if 'indices' in prim:
        idx = [i[0] for i in _accessor(js, binary, prim['indices'])]
    else:
        idx = list(range(len(pos)))
    area = 0.0
    cx = cy = cz = 0.0
    for t in range(0, len(idx) - 2, 3):
        a, b, c = pos[idx[t]], pos[idx[t + 1]], pos[idx[t + 2]]
        ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        k = 0.5 * math.sqrt(nx * nx + ny * ny + nz * nz)
        area += k
        cx += k * (a[0] + b[0] + c[0]) / 3
        cy += k * (a[1] + b[1] + c[1]) / 3
        cz += k * (a[2] + b[2] + c[2]) / 3
    mat = prim.get('material')
    return {
        'material': js['materials'][mat]['name'] if mat is not None else None,
        'attributes': sorted(prim['attributes']),
        'triangles': len(idx) // 3,
        'vertices': len(pos),
        # every coordinate, sorted per axis: the same whatever order the vertices are written in, and any one
        # moved vertex shows
        'axes': [sorted(q[i] for q in pos) for i in range(3)],
        'min': [min(p[i] for p in pos) for i in range(3)],
        'max': [max(p[i] for p in pos) for i in range(3)],
        'area': area,
        # area-weighted centroid times area: moves when any triangle moves, does not depend on vertex order
        'moment': [cx, cy, cz],
    }


def summary(path: str) -> Dict[str, Any]:
    js, binary = read(path)
    nodes = []
    parent = {}
    for i, n in enumerate(js.get('nodes', [])):
        for c in n.get('children', []):
            parent[c] = i
    for i, n in enumerate(js.get('nodes', [])):
        prims = [_prim(js, binary, p) for p in js['meshes'][n['mesh']]['primitives']] if 'mesh' in n else []
        nodes.append({
            'name': n.get('name'),
            'parent': js['nodes'][parent[i]].get('name') if i in parent else None,
            'translation': n.get('translation', [0, 0, 0]),
            'rotation': n.get('rotation', [0, 0, 0, 1]),
            'scale': n.get('scale', [1, 1, 1]),
            'extras': n.get('extras'),
            'primitives': sorted(prims, key=lambda p: (str(p['material']), p['triangles'])),
        })
    return {
        'nodes': sorted(nodes, key=lambda n: str(n['name'])),
        'materials': sorted(m.get('name') for m in js.get('materials', [])),
        'images': len(js.get('images', [])),
        'animations': sorted(a.get('name', '') for a in js.get('animations', [])),
    }


def _close(a: Any, b: Any, tol: float) -> bool:
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool) and not isinstance(b, bool):
        return abs(a - b) <= tol
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_close(x, y, tol) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_close(a[k], b[k], tol) for k in a)
    return a == b


def diff(path_a: str, path_b: str, tol: float = TOL) -> List[str]:
    """Differences between two GLBs as readable lines; an empty list means the same model."""
    a, b = summary(path_a), summary(path_b)
    out: List[str] = []
    for key in ('materials', 'images', 'animations'):
        if a[key] != b[key]:
            out.append(f'{key}: {a[key]} != {b[key]}')
    names_a, names_b = [n['name'] for n in a['nodes']], [n['name'] for n in b['nodes']]
    if names_a != names_b:
        out.append(f'nodes: {names_a} != {names_b}')
        return out
    for na, nb in zip(a['nodes'], b['nodes']):
        where = f"node {na['name']}"
        for key in ('parent', 'translation', 'rotation', 'scale', 'extras'):
            if not _close(na[key], nb[key], tol):
                out.append(f'{where}: {key} {na[key]} != {nb[key]}')
        if len(na['primitives']) != len(nb['primitives']):
            out.append(f"{where}: {len(na['primitives'])} primitives != {len(nb['primitives'])}")
            continue
        for pa, pb in zip(na['primitives'], nb['primitives']):
            tag = f"{where} / {pa['material']}"
            for key in ('material', 'attributes', 'triangles', 'vertices'):
                if pa[key] != pb[key]:
                    out.append(f'{tag}: {key} {pa[key]} != {pb[key]}')
            for key in ('min', 'max'):
                if not _close(pa[key], pb[key], tol):
                    out.append(f'{tag}: bounds {key} {pa[key]} != {pb[key]}')
            if pa['vertices'] == pb['vertices']:
                for axis, xa, xb in zip('xyz', pa['axes'], pb['axes']):
                    worst = max((abs(u - v) for u, v in zip(xa, xb)), default=0.0)
                    if worst > tol:
                        out.append(f'{tag}: a vertex moved {worst:.6f} m along {axis}')
            # area and its moment are sums over every triangle: allow the tolerance once per triangle
            slack = tol * max(1, pa['triangles'])
            if abs(pa['area'] - pb['area']) > slack:
                out.append(f"{tag}: surface area {pa['area']:.6f} != {pb['area']:.6f}")
            if not _close(pa['moment'], pb['moment'], slack):
                out.append(f"{tag}: area moment {pa['moment']} != {pb['moment']}")
    return out


if __name__ == '__main__':
    import sys
    lines = diff(sys.argv[1], sys.argv[2])
    print('semantic match' if not lines else '\n'.join(lines))
    sys.exit(1 if lines else 0)
