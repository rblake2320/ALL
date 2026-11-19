"""Post-export validation of each GLB against its catalog spec (bounds, height, nodes, materials, budgets).

All coordinates here are THREE/glTF axes (Y up, +Z front). The same rules are re-checked independently by
``tests/unit/models/assets.test.ts`` from the TypeScript side.
"""
from __future__ import annotations

import math
from typing import Dict, List, Tuple

from common import dims
from common.catalog import Spec
from common.glb import GlbInfo

TOL_FOOTPRINT = 0.15
TOL_HEIGHT = 0.20

WALL_CENTRE = {'painting_greatgrand': 1.6, 'sconce_candle': 1.7}
SCREEN_FRONT = ('tv_crt', 'tv_seance', 'arcade_tombstone', 'desk_hauntedpc', 'microwave_nuke')
CANVAS_FRONT = ('easel_morbid', 'item_painting')
BACKREST = {
    'chair_creaky': dims.SEAT_HEIGHT + 0.15,
    'chair_ribcage': dims.SEAT_HEIGHT + 0.15,
    'armchair_tattered': dims.SEAT_HEIGHT + 0.2,
    'sofa_moldy': dims.SEAT_HEIGHT + 0.2,
    'sofa_velvet': dims.SEAT_HEIGHT + 0.2,
    'pew_salvaged': dims.SEAT_HEIGHT + 0.15,
    'bed_normal': 0.8,
}
FRONT_DOOR = ('fridge_humming', 'fridge_cryo')
NO_FOOTPRINT_CHECK = ('tree_gnarled',)
EMISSIVE_PARTS = ('screen', 'glow', 'bulb', 'flame')


def is_large(spec: Spec) -> bool:
    return spec.env or spec.w * spec.d >= 3 or spec.height >= 2.4 or spec.id in ('bed_normal', 'rug_rag')


def tri_budget(spec: Spec) -> int:
    return 6000 if is_large(spec) else 3000


def env_dims(spec: Spec) -> Tuple[float, float, float]:
    """Approximate (width X, depth Z, height Y) of an environment prop, from ``ENV_MODELS[].size`` in catalog.ts."""
    return spec.size if spec.size else (1.0, 1.0, 1.0)


def env_footprint(spec: Spec) -> Tuple[int, int]:
    w, d, _ = env_dims(spec)
    return max(1, math.ceil(w)), max(1, math.ceil(d))


def expected_nodes(spec: Spec) -> List[str]:
    out: List[str] = []
    for p in spec.dynamic_parts:
        if p == 'servings':
            out += [f'serving_{i}' for i in range(4)]
        else:
            out.append(p)
    return out


def check(spec: Spec, info: GlbInfo) -> List[str]:
    w: List[str] = []
    names = set(info.node_names)
    for n in expected_nodes(spec):
        if n not in names:
            w.append(f'missing dynamic node {n!r}')
    if 'door' in spec.dynamic_parts and 'door' in names:
        kids = [k for k, p in info.parents.items() if p == 'door']
        if not kids:
            w.append("'door' pivot has no child mesh")
    if spec.variants and 'Paint' not in info.materials:
        w.append('variants declared but no Paint material')
    if spec.placement == 'window' and 'Glass' not in info.materials:
        w.append('window without Glass material')
    (lx, ly, lz), (hx, hy, hz) = info.bounds_min, info.bounds_max
    # emissive dynamic parts must carry an emissive material of strength 2..6
    mats = info.json.get('materials', [])
    for part in EMISSIVE_PARTS:
        if part in spec.dynamic_parts:
            strengths = _node_emissive_strengths(info, part)
            if not strengths:
                w.append(f'{part}: no emissive material')
            elif max(strengths) < 2 or max(strengths) > 6.01:
                w.append(f'{part}: emissive strength {max(strengths):.2f} outside 2..6')
    if info.tris > tri_budget(spec):
        w.append(f'tris {info.tris} > budget {tri_budget(spec)}')
    if info.tris < 40:
        w.append(f'suspiciously few tris ({info.tris})')

    if spec.env:
        ew, ed, eh = env_dims(spec)
        if not (eh * 0.7 <= hy <= eh * 1.3):
            w.append(f'env height {hy:.2f} vs ~{eh}')
        if (hx - lx) > ew * 1.3 + 0.2 or (hz - lz) > ed * 1.3 + 0.2:
            w.append(f'env size {(hx - lx):.2f}x{(hz - lz):.2f} vs ~{ew}x{ed}')
        if ly < -0.02:
            w.append(f'below ground {ly:.3f}')
        return w

    if spec.placement in ('floor', 'item'):
        if spec.id not in NO_FOOTPRINT_CHECK:
            lim_x = spec.w / 2 * (1 + TOL_FOOTPRINT)
            lim_z = spec.d / 2 * (1 + TOL_FOOTPRINT)
            if lx < -lim_x or hx > lim_x:
                w.append(f'x extent [{lx:.3f},{hx:.3f}] exceeds footprint {spec.w}')
            if lz < -lim_z or hz > lim_z:
                w.append(f'z extent [{lz:.3f},{hz:.3f}] exceeds footprint {spec.d}')
        if ly < -0.012:
            w.append(f'below floor {ly:.3f}')
        tol = max(TOL_HEIGHT * spec.height, 0.012 if spec.height < 0.05 else 0.03)
        if abs(hy - spec.height) > tol:
            w.append(f'height {hy:.3f} vs spec {spec.height:.3f}')
    elif spec.placement == 'wall':
        if lx < -0.5 * 1.15 or hx > 0.5 * 1.15:
            w.append(f'wall item x [{lx:.3f},{hx:.3f}] outside the tile')
        if lz < -0.01 or hz > 0.4:
            w.append(f'wall item depth z [{lz:.3f},{hz:.3f}] (back must be at z=0)')
        c = WALL_CENTRE.get(spec.id)
        if c is not None and abs((ly + hy) / 2 - c) > 0.15:
            w.append(f'wall item vertical centre {(ly + hy) / 2:.2f} vs {c}')
        if abs((hy - ly) - spec.height) > TOL_HEIGHT * spec.height + 0.02:
            w.append(f'wall item height {(hy - ly):.2f} vs {spec.height}')
    elif spec.placement in ('door', 'window'):
        if lx < -0.5 * 1.15 or hx > 0.5 * 1.15:
            w.append(f'opening x [{lx:.3f},{hx:.3f}] wider than a tile')
        if lz < -0.25 or hz > 0.25:
            w.append(f'opening depth z [{lz:.3f},{hz:.3f}] not centred on the wall plane')
        if spec.placement == 'door':
            if ly < -0.012 or not (dims.DOOR_HEIGHT <= hy <= dims.DOOR_HEIGHT * 1.2):
                w.append(f'door y [{ly:.3f},{hy:.3f}]')
        else:
            top = dims.WINDOW_SILL + spec.height
            if not (dims.WINDOW_SILL - 0.15 <= ly <= dims.WINDOW_SILL + 0.01):
                w.append(f'window bottom {ly:.3f} vs sill {dims.WINDOW_SILL}')
            if abs(hy - top) > 0.2:
                w.append(f'window top {hy:.3f} vs {top:.2f}')

    # front orientation sanity
    if spec.id in SCREEN_FRONT and 'screen' in info.node_mean_normal:
        if info.node_mean_normal['screen'][2] < 0.3:
            w.append(f'screen does not face +Z (mean normal {info.node_mean_normal["screen"]})')
    if spec.id in CANVAS_FRONT and 'canvas' in info.node_mean_normal:
        if info.node_mean_normal['canvas'][2] < 0.3:
            w.append('canvas does not face +Z')
    if spec.id in FRONT_DOOR and 'door' in info.node_world_pos:
        if info.node_world_pos['door'][2] < 0.1:
            w.append('fridge door pivot is not at the front')
    if spec.id in BACKREST and info.vertices is not None:
        v = info.vertices
        up = v[v[:, 1] > BACKREST[spec.id]]
        if len(up) == 0 or float(up[:, 2].mean()) > -0.05:
            w.append('backrest/headboard is not at -Z')
    return w


def _node_emissive_strengths(info: GlbInfo, node: str) -> List[float]:
    js = info.json
    idx = {nd.get('name'): i for i, nd in enumerate(js.get('nodes', []))}
    if node not in idx:
        return []
    out: List[float] = []
    stack = [idx[node]]
    while stack:
        nd = js['nodes'][stack.pop()]
        stack += nd.get('children', [])
        if 'mesh' in nd:
            for prim in js['meshes'][nd['mesh']]['primitives']:
                if 'material' not in prim:
                    continue
                mat = js['materials'][prim['material']]
                ef = mat.get('emissiveFactor', [0, 0, 0])
                if max(ef) <= 0:
                    continue
                st = mat.get('extensions', {}).get('KHR_materials_emissive_strength', {}).get('emissiveStrength', 1.0)
                out.append(float(st) * max(ef))
    return out
