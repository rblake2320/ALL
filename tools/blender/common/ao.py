"""Deterministic vertex-colour ambient occlusion (BVH ray casts -> COLOR_0).

Every static mesh node gets a BYTE_COLOR corner attribute named 'AO', remapped to a gentle [floor..1] multiplier so
creases, cushion seams and cabinet interiors read darker in-engine without textures.

Why not a Cycles bake: Cycles' vertex-colour bake is noisy per corner and the noise is not reproducible across runs
(thread scheduling), which made rebuilt GLBs differ byte-for-byte (different AO bytes and different exporter vertex
splits). Here AO is computed per *vertex* (all corners of a vertex share one value, so AO never splits vertices) by
casting a fixed, cosine-weighted set of hemisphere rays against a BVH of the whole model plus a contact plane.
Single-threaded, seed-free, pure float maths: identical inputs give identical bytes.

Transient dynamic parts (flames, glows, water, smoke, frost) neither receive nor cast AO.
"""
from __future__ import annotations

import math
from typing import List, Optional, Sequence, Tuple

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from .model import Model

TRANSIENT_PREFIXES = ('flame', 'glow', 'bulb', 'screen', 'water', 'frost', 'broken')


def hemisphere_dirs(n: int) -> List[Tuple[float, float, float]]:
    """``n`` cosine-weighted unit directions around +Z (Fibonacci spiral: even coverage, no randomness)."""
    out = []
    golden = math.pi * (3.0 - math.sqrt(5.0))
    for i in range(n):
        u = (i + 0.5) / n               # uniform in (0,1): cosine-weighted -> r = sqrt(u)
        r = math.sqrt(u)
        phi = i * golden
        z = math.sqrt(max(0.0, 1.0 - u))
        out.append((r * math.cos(phi), r * math.sin(phi), z))
    return out


def _basis(nrm: Vector) -> Tuple[Vector, Vector]:
    """Orthonormal tangent frame for a unit normal (branch-free variant of Duff et al. 2017)."""
    s = 1.0 if nrm.z >= 0.0 else -1.0
    a = -1.0 / (s + nrm.z)
    b = nrm.x * nrm.y * a
    t = Vector((1.0 + s * nrm.x * nrm.x * a, s * b, -s * nrm.x))
    bt = Vector((b, s + nrm.y * nrm.y * a, -nrm.y))
    return t, bt


def _plane(kind: str) -> Optional[Tuple[List[Tuple[float, float, float]], List[List[int]]]]:
    if kind in ('floor', 'item', 'env'):
        return [(-14.0, -14.0, 0.0), (14.0, -14.0, 0.0), (14.0, 14.0, 0.0), (-14.0, 14.0, 0.0)], [[0, 1, 2, 3]]
    if kind == 'wall':  # wall surface at Blender y = 0, wall body behind it (+Y)
        return [(-3.0, 0.002, -1.0), (3.0, 0.002, -1.0), (3.0, 0.002, 5.0), (-3.0, 0.002, 5.0)], [[0, 1, 2, 3]]
    return None


def _is_transient(name: str, node) -> bool:
    return bool(node.transient) or name.startswith(TRANSIENT_PREFIXES)


def _canonical_polys(ob: bpy.types.Object) -> List[Tuple[Tuple[float, float, float], ...]]:
    """World-space polygons as tuples of vertex positions, each loop rotated to start at its smallest vertex.

    bmesh operators (bevel, remove_doubles, bisect...) emit vertices/faces in an order that depends on memory
    addresses, so element order — and with it float summation order and n-gon triangulation — changes from run to
    run. Working on sorted, position-keyed data makes the AO a pure function of the geometry."""
    mw = ob.matrix_world
    co = [tuple(mw @ v.co) for v in ob.data.vertices]
    out = []
    for poly in ob.data.polygons:
        loop = [co[i] for i in poly.vertices]
        k = min(range(len(loop)), key=lambda i: loop[i])
        out.append(tuple(loop[k:] + loop[:k]))
    return out


def _newell(loop) -> Tuple[float, float, float]:
    """Polygon normal with magnitude = 2 * area (double precision, fixed order)."""
    nx = ny = nz = 0.0
    k = len(loop)
    for i in range(k):
        ax, ay, az = loop[i]
        bx, by, bz = loop[(i + 1) % k]
        nx += (ay - by) * (az + bz)
        ny += (az - bz) * (ax + bx)
        nz += (ax - bx) * (ay + by)
    return nx, ny, nz


def bake_vertex_ao(m: Model, kind: str = 'floor', rays: int = 40, distance: float = 0.35, floor: float = 0.58,
                   bias: float = 0.0025, **_ignored) -> int:
    """Write per-vertex AO into a corner colour attribute 'AO' on every static mesh node of ``m``.

    ``kind`` selects the contact surface ('floor' | 'item' | 'env' -> ground plane, 'wall' -> wall plane at y = 0,
    'door' | 'window' -> none). Returns the number of meshes that received AO."""
    bpy.context.view_layer.update()
    targets: List[bpy.types.Object] = []
    for name, node in m.nodes.items():
        ob = m.objects.get(name)
        if ob is None or ob.type != 'MESH' or _is_transient(name, node):
            continue
        # anything inside a transient group (e.g. children of 'flame') is transient too
        p = node.parent
        hidden = False
        while p is not None:
            pn = m.nodes.get(p)
            if pn is None:
                break
            if _is_transient(p, pn):
                hidden = True
                break
            p = pn.parent
        if not hidden:
            targets.append(ob)
    if not targets:
        return 0
    per_ob = [(ob, _canonical_polys(ob)) for ob in targets]
    all_polys = sorted(pl for _, polys in per_ob for pl in polys)
    n_model = len(all_polys)
    plane = _plane(kind)
    if plane is not None:
        all_polys.append(tuple(tuple(float(c) for c in plane[0][i]) for i in plane[1][0]))
    index: dict = {}
    verts: List[Tuple[float, float, float]] = []
    faces: List[List[int]] = []
    for loop in all_polys:
        f = []
        for c in loop:
            i = index.get(c)
            if i is None:
                i = index[c] = len(verts)
                verts.append(c)
            f.append(i)
        faces.append(f)
    bvh = BVHTree.FromPolygons(verts, faces, all_triangles=False, epsilon=0.0)
    # smooth vertex normals keyed by position, accumulated in canonical polygon order (contact plane excluded)
    acc: dict = {}
    for loop in all_polys[:n_model]:
        nx, ny, nz = _newell(loop)
        for c in loop:
            a = acc.get(c)
            if a is None:
                acc[c] = [nx, ny, nz]
            else:
                a[0] += nx
                a[1] += ny
                a[2] += nz
    dirs = hemisphere_dirs(rays)
    inv_n = 1.0 / len(dirs)
    cast = bvh.ray_cast
    cache: dict = {}

    def ao_at(c: Tuple[float, float, float]) -> float:
        val = cache.get(c)
        if val is not None:
            return val
        a = acc.get(c, [0.0, 0.0, 1.0])
        ln = math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])
        n = Vector((a[0] / ln, a[1] / ln, a[2] / ln)) if ln > 1e-12 else Vector((0.0, 0.0, 1.0))
        t, b = _basis(n)
        o = Vector(c) + n * bias
        occ = 0.0
        for dx, dy, dz in dirs:
            d = t * dx + b * dy + n * dz
            hit = cast(o, d, distance)
            if hit[0] is not None:
                f = hit[3] / distance
                occ += 1.0 - f * f   # near hits occlude fully, fading out toward the AO distance
        val = 1.0 - occ * inv_n
        cache[c] = val
        return val

    for ob, _ in per_ob:
        me = ob.data
        mw = ob.matrix_world
        vkeys = [tuple(mw @ v.co) for v in me.vertices]
        attr = me.color_attributes.get('AO')
        if attr is not None:
            me.color_attributes.remove(attr)
        attr = me.color_attributes.new('AO', 'BYTE_COLOR', 'CORNER')
        me.color_attributes.active_color = attr
        me.color_attributes.render_color_index = me.color_attributes.find('AO')
        data = attr.data
        for li, loop in enumerate(me.loops):
            k = floor + (1.0 - floor) * max(0.0, min(1.0, ao_at(vkeys[loop.vertex_index])))
            data[li].color = (k, k, k, 1.0)
    return len(targets)


def ao_stats(values: Sequence[float]) -> Tuple[float, float, float]:
    """(min, mean, max) helper for diagnostics."""
    if not values:
        return (1.0, 1.0, 1.0)
    return (min(values), sum(values) / len(values), max(values))
