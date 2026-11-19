"""Post-export checks for level-kit GLBs (THREE/glTF axes: Y up, +Z front). Re-checked independently in TypeScript
by tests/unit/levels-assets/*.test.ts."""
from __future__ import annotations

from typing import List

import numpy as np

from common.glb import GlbInfo, read_chunks

from .kit import LevelSpec

TOL_FOOTPRINT = 0.15
TOL_HEIGHT = 0.20
EMISSIVE_PARTS = ('screen', 'glow', 'bulb', 'flame')


def _facing_ratio(path, node_name: str) -> float:
    """Fraction of a node subtree's triangle area whose normal points to +Z (glTF front)."""
    from common.glb import _accessor_array, _trs, _mat_mul, _apply  # type: ignore
    data = open(path, 'rb').read()
    js, binc = read_chunks(data)
    nodes = js.get('nodes', [])
    parents = {i: None for i in range(len(nodes))}
    for i, nd in enumerate(nodes):
        for c in nd.get('children', []):
            parents[c] = i
    world = {}

    def wm(i):
        if i not in world:
            loc = _trs(nodes[i])
            p = parents[i]
            world[i] = loc if p is None else _mat_mul(wm(p), loc)
        return world[i]

    root = next((i for i, nd in enumerate(nodes) if nd.get('name') == node_name), None)
    if root is None:
        return 0.0
    stack, sub = [root], []
    while stack:
        k = stack.pop()
        sub.append(k)
        stack += nodes[k].get('children', [])
    front = total = 0.0
    for i in sub:
        nd = nodes[i]
        if 'mesh' not in nd:
            continue
        m = wm(i)
        for prim in js['meshes'][nd['mesh']]['primitives']:
            pos = np.asarray(_accessor_array(js, binc, prim['attributes']['POSITION']), dtype=float).reshape(-1, 3)
            pos = np.array([_apply(m, tuple(p)) for p in pos])
            idx = np.asarray(_accessor_array(js, binc, prim['indices']), dtype=int).reshape(-1, 3)
            a, b, c = pos[idx[:, 0]], pos[idx[:, 1]], pos[idx[:, 2]]
            n = np.cross(b - a, c - a)
            area = np.linalg.norm(n, axis=1)
            ok = area > 1e-12
            nz = np.where(ok, n[:, 2] / np.where(ok, area, 1), 0)
            total += float(area.sum())
            front += float(area[nz > 0.5].sum())
    return front / total if total > 0 else 0.0


def check(spec: LevelSpec, info: GlbInfo, path) -> List[str]:
    w: List[str] = []
    names = set(info.node_names)
    for p in spec.parts:
        if p not in names:
            w.append(f'missing dynamic node {p!r}')
    if spec.paint and 'Paint' not in info.materials:
        w.append('paint declared but no Paint material')
    if info.tris > spec.budget:
        w.append(f'tris {info.tris} > budget {spec.budget}')
    if info.tris < 40:
        w.append(f'suspiciously few tris ({info.tris})')
    mats = info.json.get('materials', [])
    for part in EMISSIVE_PARTS:
        if part in spec.parts:
            from objects.validate import _node_emissive_strengths
            st = _node_emissive_strengths(info, part)
            if not st:
                w.append(f'{part}: no emissive material')
            elif max(st) < 2 or max(st) > 6.01:
                w.append(f'{part}: emissive strength {max(st):.2f} outside 2..6')
    if any((m.get('name') or '').endswith('.001') for m in mats):
        w.append('duplicated material name')
    (lx, ly, lz), (hx, hy, hz) = info.bounds_min, info.bounds_max
    k = spec.kind
    if k in ('floor', 'item'):
        lim_x, lim_z = spec.w / 2 * (1 + TOL_FOOTPRINT), spec.d / 2 * (1 + TOL_FOOTPRINT)
        if lx < -lim_x or hx > lim_x:
            w.append(f'x extent [{lx:.3f},{hx:.3f}] exceeds footprint {spec.w}')
        if lz < -lim_z or hz > lim_z:
            w.append(f'z extent [{lz:.3f},{hz:.3f}] exceeds footprint {spec.d}')
        if ly < -0.012:
            w.append(f'below floor {ly:.3f}')
        if ly > 0.02:
            w.append(f'floating: lowest point {ly:.3f}')
        tol = max(TOL_HEIGHT * spec.height, 0.012 if spec.height < 0.06 else 0.03)
        if abs(hy - spec.height) > tol:
            w.append(f'height {hy:.3f} vs spec {spec.height:.3f}')
    elif k == 'wall':
        if lx < -0.575 or hx > 0.575:
            w.append(f'wall item x [{lx:.3f},{hx:.3f}] outside the tile')
        if lz < -0.01 or hz > 0.4:
            w.append(f'wall item depth z [{lz:.3f},{hz:.3f}] (back must be at z=0)')
        if spec.wall_centre is not None and abs((ly + hy) / 2 - spec.wall_centre) > 0.15:
            w.append(f'wall item vertical centre {(ly + hy) / 2:.2f} vs {spec.wall_centre}')
        if abs((hy - ly) - spec.height) > TOL_HEIGHT * spec.height + 0.02:
            w.append(f'wall item height {(hy - ly):.2f} vs {spec.height}')
    elif k in ('edge', 'opening'):
        if lx < -0.5 - 0.06 or hx > 0.5 + 0.06:
            w.append(f'edge piece x [{lx:.3f},{hx:.3f}] wider than a tile edge')
        if lz < -0.2 or hz > 0.2:
            w.append(f'edge piece z [{lz:.3f},{hz:.3f}] not centred on the edge')
        if ly < -0.012 or ly > 0.02:
            w.append(f'edge piece bottom {ly:.3f}')
        if abs(hy - spec.height) > TOL_HEIGHT * spec.height:
            w.append(f'height {hy:.3f} vs spec {spec.height:.3f}')
    elif k == 'env':
        if not (spec.height * 0.75 <= hy <= spec.height * 1.25):
            w.append(f'env height {hy:.2f} vs ~{spec.height}')
        if (hx - lx) > spec.w * 1.3 or (hz - lz) > spec.d * 1.3:
            w.append(f'env size {(hx - lx):.2f}x{(hz - lz):.2f} vs ~{spec.w}x{spec.d}')
        if ly < -0.02:
            w.append(f'below ground {ly:.3f}')
    elif k == 'carry':
        if abs(hy - ly - spec.height) > TOL_HEIGHT * spec.height:
            w.append(f'carry prop length {(hy - ly):.2f} vs {spec.height}')
        if 'grip' not in names:
            w.append("carry prop without a 'grip' node")
    # front rules
    f = spec.front
    if f.startswith('back_tall:') and info.vertices is not None:
        th = float(f.split(':')[1])
        v = info.vertices
        up = v[v[:, 1] > th]
        if len(up) == 0 or float(up[:, 2].mean()) > -0.05:
            w.append(f'tall parts (y > {th}) are not behind the centre (-Z)')
    elif f.startswith('facing:'):
        nn = f.split(':')[1]
        r = _facing_ratio(path, nn)
        if r < 0.7:
            w.append(f'{nn!r} does not face +Z (front area ratio {r:.2f})')
    return w
