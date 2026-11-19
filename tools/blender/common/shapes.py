"""bmesh primitive library for chunky, bevelled, toy-like props.

Every function returns a *new* ``bmesh.types.BMesh`` already placed in model space (Blender axes: X right,
Y back (front is -Y), Z up). Combine them through ``common.model.Model.add``. Rotations are Euler XYZ degrees.

Conventions
* ``loc`` is the centre of the shape unless the parameter is called ``base`` (bottom centre).
* Bevel widths are clamped to 45% of the smallest dimension so tiny parts never self-intersect.
"""
from __future__ import annotations

import math
from typing import Callable, Iterable, List, Optional, Sequence, Tuple

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

from .rng import value_noise3

Vec3 = Tuple[float, float, float]
TAU = math.tau

# ───────────────────────────── transforms ─────────────────────────────


def matrix(loc: Sequence[float] = (0, 0, 0), rot: Sequence[float] = (0, 0, 0),
           scale: Sequence[float] | float = 1.0) -> Matrix:
    if isinstance(scale, (int, float)):
        scale = (scale, scale, scale)
    s = Matrix.Diagonal((*scale, 1.0))
    r = Euler([math.radians(a) for a in rot], 'XYZ').to_matrix().to_4x4()
    return Matrix.Translation(Vector(loc)) @ r @ s


def xf(bm: bmesh.types.BMesh, loc: Sequence[float] = (0, 0, 0), rot: Sequence[float] = (0, 0, 0),
       scale: Sequence[float] | float = 1.0, pivot: Sequence[float] = (0, 0, 0)) -> bmesh.types.BMesh:
    """Scale+rotate about ``pivot`` then translate by ``loc``. Returns ``bm`` for chaining."""
    if isinstance(scale, (int, float)):
        scale = (scale, scale, scale)
    p = Vector(pivot)
    m = (Matrix.Translation(Vector(loc) + p)
         @ Euler([math.radians(a) for a in rot], 'XYZ').to_matrix().to_4x4()
         @ Matrix.Diagonal((*scale, 1.0))
         @ Matrix.Translation(-p))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return bm


def rotate(bm: bmesh.types.BMesh, rot: Sequence[float], pivot: Sequence[float] = (0, 0, 0)) -> bmesh.types.BMesh:
    p = Vector(pivot)
    m = Matrix.Translation(p) @ Euler([math.radians(a) for a in rot], 'XYZ').to_matrix().to_4x4() @ Matrix.Translation(-p)
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return bm


def translate(bm: bmesh.types.BMesh, d: Sequence[float]) -> bmesh.types.BMesh:
    bmesh.ops.translate(bm, vec=Vector(d), verts=bm.verts)
    return bm


def displace(bm: bmesh.types.BMesh, fn: Callable[[Vector], Vector]) -> bmesh.types.BMesh:
    for v in bm.verts:
        v.co = fn(v.co.copy())
    return bm


def copy(bm: bmesh.types.BMesh) -> bmesh.types.BMesh:
    return bm.copy()


def merge(*bms: bmesh.types.BMesh) -> bmesh.types.BMesh:
    out = bmesh.new()
    tmp = bpy.data.meshes.new('_merge_tmp')
    try:
        for b in bms:
            b.to_mesh(tmp)
            out.from_mesh(tmp)
    finally:
        bpy.data.meshes.remove(tmp)
    return out


def mirror_x(bm: bmesh.types.BMesh, keep: bool = True) -> bmesh.types.BMesh:
    """Return bm merged with its mirror across X=0 (or only the mirror if keep=False)."""
    m = bm.copy()
    bmesh.ops.scale(m, vec=(-1, 1, 1), verts=m.verts)
    bmesh.ops.reverse_faces(m, faces=m.faces)
    return merge(bm, m) if keep else m


def array(bm: bmesh.types.BMesh, count: int, offset: Sequence[float]) -> bmesh.types.BMesh:
    parts = []
    for i in range(count):
        c = bm.copy()
        translate(c, [o * i for o in offset])
        parts.append(c)
    return merge(*parts)


def bend_z(bm: bmesh.types.BMesh, amount: float, axis: str = 'y') -> bmesh.types.BMesh:
    """Quadratic sag along Z as a function of height (lean/curve a tall part)."""
    idx = 0 if axis == 'x' else 1
    for v in bm.verts:
        v.co[idx] += amount * (v.co.z ** 2)
    return bm


# ───────────────────────────── bevel helpers ─────────────────────────────


def bevel(bm: bmesh.types.BMesh, width: float, segments: int = 2, angle: float = 30.0,
          edges: Optional[Iterable] = None, profile: float = 0.5) -> bmesh.types.BMesh:
    """Bevel edges whose dihedral angle exceeds ``angle`` degrees (or the given edges)."""
    if width <= 0 or segments <= 0:
        return bm
    bm.normal_update()
    if edges is None:
        thr = math.radians(angle)
        edges = [e for e in bm.edges if len(e.link_faces) == 2
                 and e.link_faces[0].normal.angle(e.link_faces[1].normal, 0.0) > thr]
    edges = list(edges)
    if not edges:
        return bm
    bmesh.ops.bevel(bm, geom=edges, offset=width, offset_type='OFFSET', segments=segments,
                    profile=profile, affect='EDGES', clamp_overlap=True)
    return bm


# ───────────────────────────── primitives ─────────────────────────────


def box(sx: float, sy: float, sz: float, bevel_w: float = 0.012, segs: int = 2,
        loc: Sequence[float] = (0, 0, 0), rot: Sequence[float] = (0, 0, 0),
        base: Optional[Sequence[float]] = None) -> bmesh.types.BMesh:
    """Bevelled box. ``base`` = bottom-centre position (overrides ``loc``)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    w = min(bevel_w, 0.45 * min(sx, sy, sz))
    if w > 0.0005 and segs > 0:
        bevel(bm, w, segs, angle=10.0)
    if base is not None:
        loc = (base[0], base[1], base[2] + sz / 2)
    return xf(bm, loc, rot)


def taper_box(bx: float, by: float, tx: float, ty: float, h: float, bevel_w: float = 0.012, segs: int = 2,
              base: Sequence[float] = (0, 0, 0), rot: Sequence[float] = (0, 0, 0),
              shift: Sequence[float] = (0, 0)) -> bmesh.types.BMesh:
    """Frustum box: bottom bx*by, top tx*ty, height h; ``shift`` offsets the top face (x, y)."""
    bm = bmesh.new()
    pts = []
    for (sx, sy, z, dx, dy) in ((bx, by, 0.0, 0.0, 0.0), (tx, ty, h, shift[0], shift[1])):
        ring = [bm.verts.new((dx + sx / 2 * cx, dy + sy / 2 * cy, z)) for cx, cy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        pts.append(ring)
    b, t = pts
    bm.faces.new(list(reversed(b)))
    bm.faces.new(t)
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((b[i], b[j], t[j], t[i]))
    w = min(bevel_w, 0.45 * min(bx, by, tx, ty, h))
    if w > 0.0005:
        bevel(bm, w, segs, angle=10.0)
    return xf(bm, (base[0], base[1], base[2]), rot)


def cylinder(r: float, h: float, segs: int = 16, bevel_w: float = 0.01, r_top: Optional[float] = None,
             base: Sequence[float] = (0, 0, 0), rot: Sequence[float] = (0, 0, 0), bsegs: int = 2,
             cap: bool = True) -> bmesh.types.BMesh:
    """Cylinder/cone standing on ``base`` along +Z, cap rims bevelled."""
    bm = bmesh.new()
    rt = r if r_top is None else r_top
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs, radius1=r, radius2=rt, depth=h)
    translate(bm, (0, 0, h / 2))
    w = min(bevel_w, 0.45 * min(r, rt if rt > 0 else r, h))
    if cap and w > 0.0005:
        bevel(bm, w, bsegs, angle=50.0)
    return xf(bm, base, rot)


def lathe(profile: Sequence[Tuple[float, float]], segs: int = 16, base: Sequence[float] = (0, 0, 0),
          rot: Sequence[float] = (0, 0, 0), cap_bottom: bool = True, cap_top: bool = True,
          scale_xy: Tuple[float, float] = (1.0, 1.0), phase: float = 0.0) -> bmesh.types.BMesh:
    """Surface of revolution around +Z from a (radius, z) profile listed bottom -> top.

    A radius of 0 at either end collapses to a pole (closed tip)."""
    bm = bmesh.new()
    rings: List[List] = []
    for (r, z) in profile:
        if r <= 1e-6:
            rings.append([bm.verts.new((0.0, 0.0, z))])
        else:
            ring = []
            for k in range(segs):
                a = TAU * k / segs + phase
                ring.append(bm.verts.new((math.cos(a) * r * scale_xy[0], math.sin(a) * r * scale_xy[1], z)))
            rings.append(ring)
    for ra, rb in zip(rings, rings[1:]):
        if len(ra) == 1 and len(rb) == 1:
            continue
        if len(ra) == 1:
            for k in range(segs):
                bm.faces.new((ra[0], rb[k], rb[(k + 1) % segs]))
        elif len(rb) == 1:
            for k in range(segs):
                bm.faces.new((ra[k], rb[0], ra[(k + 1) % segs]))
        else:
            for k in range(segs):
                k2 = (k + 1) % segs
                bm.faces.new((ra[k], ra[k2], rb[k2], rb[k]))
    if cap_bottom and len(rings[0]) > 1:
        bm.faces.new(list(reversed(rings[0])))
    if cap_top and len(rings[-1]) > 1:
        bm.faces.new(rings[-1])
    bm.normal_update()
    return xf(bm, base, rot)


def sphere(r: float, segs: int = 12, rings: int = 8, loc: Sequence[float] = (0, 0, 0),
           scale: Sequence[float] = (1, 1, 1), rot: Sequence[float] = (0, 0, 0)) -> bmesh.types.BMesh:
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    return xf(bm, loc, rot)


def ico(r: float, subdiv: int = 2, loc: Sequence[float] = (0, 0, 0), scale: Sequence[float] = (1, 1, 1),
        rot: Sequence[float] = (0, 0, 0)) -> bmesh.types.BMesh:
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    return xf(bm, loc, rot)


def blob(r: float, subdiv: int = 2, noise: float = 0.18, freq: float = 2.2, seed: int = 0,
         loc: Sequence[float] = (0, 0, 0), scale: Sequence[float] = (1, 1, 1), flat_bottom: Optional[float] = None,
         rot: Sequence[float] = (0, 0, 0)) -> bmesh.types.BMesh:
    """Lumpy icosphere (rocks, bushes, brains, ash). ``flat_bottom``: clamp local z >= that fraction of r."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    for v in bm.verts:
        n = v.co.normalized()
        d = 1.0 + noise * value_noise3(n.x * freq + 11.3, n.y * freq + 3.7, n.z * freq + 7.1, seed)
        v.co = n * d
        if flat_bottom is not None and v.co.z < flat_bottom:
            v.co.z = flat_bottom
    bmesh.ops.scale(bm, vec=(r * scale[0], r * scale[1], r * scale[2]), verts=bm.verts)
    return xf(bm, loc, rot)


def superellipsoid(a: float, b: float, c: float, e1: float = 0.35, e2: float = 0.35, segs: int = 16,
                   rings: int = 10, loc: Sequence[float] = (0, 0, 0), rot: Sequence[float] = (0, 0, 0)
                   ) -> bmesh.types.BMesh:
    """Soft rounded box (cushions, mattresses, pillows). a,b,c are half extents; e -> 0 = boxier."""

    def spow(x: float, e: float) -> float:
        return math.copysign(abs(x) ** e, x)

    bm = bmesh.new()
    top = bm.verts.new((0, 0, c))
    bot = bm.verts.new((0, 0, -c))
    grid = []
    for i in range(1, rings):
        v = -math.pi / 2 + math.pi * i / rings
        row = []
        for j in range(segs):
            u = -math.pi + TAU * j / segs
            cv, sv = math.cos(v), math.sin(v)
            x = a * spow(cv, e1) * spow(math.cos(u), e2)
            y = b * spow(cv, e1) * spow(math.sin(u), e2)
            z = c * spow(sv, e1)
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    for j in range(segs):
        j2 = (j + 1) % segs
        bm.faces.new((bot, grid[0][j2], grid[0][j]))
        bm.faces.new((top, grid[-1][j], grid[-1][j2]))
    for i in range(len(grid) - 1):
        for j in range(segs):
            j2 = (j + 1) % segs
            bm.faces.new((grid[i][j], grid[i][j2], grid[i + 1][j2], grid[i + 1][j]))
    bm.normal_update()
    return xf(bm, loc, rot)


def cushion(sx: float, sy: float, sz: float, sag: float = 0.015, roundness: float = 0.3,
            loc: Sequence[float] = (0, 0, 0), rot: Sequence[float] = (0, 0, 0), segs: int = 16, rings: int = 8,
            puff: float = 0.0) -> bmesh.types.BMesh:
    """Superellipsoid cushion with a sagging top (``sag`` metres at the centre). ``loc`` = centre."""
    bm = superellipsoid(sx / 2, sy / 2, sz / 2, roundness, roundness, segs, rings)
    if sag or puff:
        for v in bm.verts:
            u = min(1.0, abs(v.co.x) / (sx / 2))
            w = min(1.0, abs(v.co.y) / (sy / 2))
            f = (1 - u * u) * (1 - w * w)
            if v.co.z > 0:
                v.co.z -= sag * f
            if puff:
                k = 1 - (v.co.z / (sz / 2)) ** 2
                v.co.x *= 1 + puff * k
                v.co.y *= 1 + puff * k
    return xf(bm, loc, rot)


def torus(R: float, r: float, segs: int = 16, ring_segs: int = 6, loc: Sequence[float] = (0, 0, 0),
          rot: Sequence[float] = (0, 0, 0), arc: float = 360.0) -> bmesh.types.BMesh:
    """Torus in the XY plane (rotate for handles). ``arc`` < 360 gives an open tube arc."""
    n = segs if arc >= 360 else segs + 1
    pts = []
    for k in range(n):
        a = math.radians(arc) * k / segs
        pts.append((math.cos(a) * R, math.sin(a) * R, 0.0))
    bm = tube(pts, r, ring_segs, closed=arc >= 360)
    return xf(bm, loc, rot)


def tube(points: Sequence[Sequence[float]], radius: float = 0.02, segs: int = 6,
         radii: Optional[Sequence[float]] = None, closed: bool = False, cap: bool = True,
         scale_xy: Tuple[float, float] = (1.0, 1.0), twist: float = 0.0) -> bmesh.types.BMesh:
    """Sweep a circle along a polyline with parallel-transport frames. ``radii`` per point (0 = pointed tip)."""
    pts = [Vector(p) for p in points]
    n = len(pts)
    bm = bmesh.new()
    if n < 2:
        return bm
    tangents = []
    for i in range(n):
        if closed:
            t = pts[(i + 1) % n] - pts[i - 1]
        elif i == 0:
            t = pts[1] - pts[0]
        elif i == n - 1:
            t = pts[-1] - pts[-2]
        else:
            t = (pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
        if t.length < 1e-9:
            t = Vector((0, 0, 1))
        tangents.append(t.normalized())
    ref = Vector((0, 0, 1)) if abs(tangents[0].z) < 0.9 else Vector((1, 0, 0))
    normal = tangents[0].cross(ref).normalized()
    frames = [normal]
    for i in range(1, n):
        q = tangents[i - 1].rotation_difference(tangents[i])
        frames.append((q @ frames[-1]).normalized())
    rings = []
    for i in range(n):
        r = radii[i] if radii is not None else radius
        t, nr = tangents[i], frames[i]
        bn = t.cross(nr).normalized()
        if r <= 1e-6:
            rings.append([bm.verts.new(pts[i])])
            continue
        ring = []
        for k in range(segs):
            a = TAU * k / segs + twist * i
            off = nr * (math.cos(a) * r * scale_xy[0]) + bn * (math.sin(a) * r * scale_xy[1])
            ring.append(bm.verts.new(pts[i] + off))
        rings.append(ring)
    pairs = list(zip(rings, rings[1:]))
    if closed:
        pairs.append((rings[-1], rings[0]))
    for ra, rb in pairs:
        if len(ra) == 1 and len(rb) == 1:
            continue
        if len(ra) == 1:
            for k in range(segs):
                bm.faces.new((ra[0], rb[k], rb[(k + 1) % segs]))
        elif len(rb) == 1:
            for k in range(segs):
                bm.faces.new((ra[k], ra[(k + 1) % segs], rb[0]))
        else:
            for k in range(segs):
                k2 = (k + 1) % segs
                bm.faces.new((ra[k], ra[k2], rb[k2], rb[k]))
    if cap and not closed:
        if len(rings[0]) > 1:
            bm.faces.new(list(reversed(rings[0])))
        if len(rings[-1]) > 1:
            bm.faces.new(rings[-1])
    bm.normal_update()
    # make normals point outward (the frame handedness may flip winding)
    _fix_winding(bm)
    return bm


def _fix_winding(bm: bmesh.types.BMesh) -> None:
    if not bm.faces:
        return
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


def prism(poly: Sequence[Tuple[float, float]], depth: float, bevel_w: float = 0.01, segs: int = 2,
          loc: Sequence[float] = (0, 0, 0), rot: Sequence[float] = (0, 0, 0), plane: str = 'XZ'
          ) -> bmesh.types.BMesh:
    """Extrude a 2D polygon (CCW) by ``depth``. plane 'XZ': (u,v)->(x,z), extruded along Y centred on 0
    (a front-facing silhouette); plane 'XY': (u,v)->(x,y), extruded up along +Z from 0."""
    bm = bmesh.new()
    if plane == 'XZ':
        vs0 = [bm.verts.new((u, -depth / 2, v)) for (u, v) in poly]
        vs1 = [bm.verts.new((u, depth / 2, v)) for (u, v) in poly]
    else:
        vs0 = [bm.verts.new((u, v, 0.0)) for (u, v) in poly]
        vs1 = [bm.verts.new((u, v, depth)) for (u, v) in poly]
    n = len(poly)
    bm.faces.new(vs0)
    bm.faces.new(list(reversed(vs1)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((vs0[j], vs0[i], vs1[i], vs1[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bevel_w > 0:
        bevel(bm, min(bevel_w, depth * 0.45), segs, angle=35.0)
    return xf(bm, loc, rot)


def grid(sx: float, sy: float, nx: int, ny: int, loc: Sequence[float] = (0, 0, 0)) -> bmesh.types.BMesh:
    """Subdivided plane facing +Z (for displacement: soil, cloth, water surfaces)."""
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=nx, y_segments=ny, size=0.5)
    bmesh.ops.scale(bm, vec=(sx, sy, 1), verts=bm.verts)
    return translate(bm, loc)


def slab(sx: float, sy: float, sz: float, nx: int, ny: int, base: Sequence[float] = (0, 0, 0)
         ) -> bmesh.types.BMesh:
    """Box with a subdivided top (nx*ny) for sculpting mounds/cushions via ``displace``."""
    bm = grid(sx, sy, nx, ny)
    bm.normal_update()
    res = bmesh.ops.extrude_face_region(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces), use_keep_orig=True)
    verts = [g for g in res['geom'] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, 0, -sz), verts=verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return translate(bm, (base[0], base[1], base[2] + sz))


def cone(r: float, h: float, segs: int = 8, base: Sequence[float] = (0, 0, 0),
         rot: Sequence[float] = (0, 0, 0)) -> bmesh.types.BMesh:
    return cylinder(r, h, segs, 0.0, r_top=0.0, base=base, rot=rot)


def text(body: str, size: float = 0.1, depth: float = 0.006, loc: Sequence[float] = (0, 0, 0),
         rot: Sequence[float] = (90, 0, 0), align: str = 'CENTER', resolution: int = 2) -> bmesh.types.BMesh:
    """Extruded text mesh (built-in font). Default rotation makes it read on the FRONT (-Y facing)."""
    cu = bpy.data.curves.new('_txt', 'FONT')
    cu.body = body
    cu.size = size
    cu.extrude = depth / 2
    cu.resolution_u = resolution
    cu.align_x = align
    cu.align_y = 'CENTER'
    ob = bpy.data.objects.new('_txt', cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bpy.data.meshes.remove(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    return xf(bm, loc, rot)


# ───────────────────────────── curves ─────────────────────────────


def bezier(p0, p1, p2, p3, n: int = 8) -> List[Vector]:
    p0, p1, p2, p3 = (Vector(p) for p in (p0, p1, p2, p3))
    out = []
    for i in range(n + 1):
        t = i / n
        a = (1 - t) ** 3
        b = 3 * (1 - t) ** 2 * t
        c = 3 * (1 - t) * t * t
        d = t ** 3
        out.append(p0 * a + p1 * b + p2 * c + p3 * d)
    return out


def catmull(points: Sequence[Sequence[float]], per_seg: int = 4) -> List[Vector]:
    """Catmull-Rom through the points (endpoints duplicated)."""
    P = [Vector(p) for p in points]
    if len(P) < 3:
        return P
    P = [P[0]] + P + [P[-1]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(per_seg):
            t = k / per_seg
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-2])
    return out


def arc_points(radius: float, a0: float, a1: float, n: int, center: Sequence[float] = (0, 0, 0),
               plane: str = 'XZ') -> List[Vector]:
    """Points on a circular arc (degrees). plane XZ: x=cos, z=sin; XY: x=cos, y=sin; YZ: y=cos, z=sin."""
    c = Vector(center)
    out = []
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        ca, sa = math.cos(a) * radius, math.sin(a) * radius
        if plane == 'XZ':
            out.append(c + Vector((ca, 0, sa)))
        elif plane == 'XY':
            out.append(c + Vector((ca, sa, 0)))
        else:
            out.append(c + Vector((0, ca, sa)))
    return out


def spiral(r0: float, r1: float, turns: float, n: int, center: Sequence[float] = (0, 0, 0),
           plane: str = 'XZ', a0: float = 0.0) -> List[Vector]:
    """Flat spiral (wrought-iron scrolls)."""
    c = Vector(center)
    out = []
    for i in range(n + 1):
        t = i / n
        a = math.radians(a0) + TAU * turns * t
        r = r0 + (r1 - r0) * t
        if plane == 'XZ':
            out.append(c + Vector((math.cos(a) * r, 0, math.sin(a) * r)))
        else:
            out.append(c + Vector((math.cos(a) * r, math.sin(a) * r, 0)))
    return out


# ───────────────────────────── composite helpers ─────────────────────────────


def bone(length: float, r: float = 0.018, knob: float = 1.9, loc: Sequence[float] = (0, 0, 0),
         rot: Sequence[float] = (0, 0, 0), segs: int = 8) -> bmesh.types.BMesh:
    """Cartoon bone along X: a shaft with two double-knob ends."""
    shaft = cylinder(r, length, segs, 0.0, base=(0, 0, -length / 2), rot=(0, 0, 0), cap=False)
    rotate(shaft, (0, 90, 0))
    parts = [shaft]
    kr = r * knob * 0.62
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(sphere(kr, max(5, segs - 2), max(4, segs // 2), loc=(sx * length / 2, sy * kr * 0.62, 0)))
    bm = merge(*parts)
    return xf(bm, loc, rot)


def skull(s: float = 0.1, loc: Sequence[float] = (0, 0, 0), rot: Sequence[float] = (0, 0, 0),
          jaw: bool = True, segs: int = 12) -> Tuple[bmesh.types.BMesh, bmesh.types.BMesh]:
    """Cute cartoon skull facing -Y (front). Returns (bone_bm, socket_bm) so sockets get a dark material.
    ``s`` = cranium radius."""
    cran = sphere(s, segs, max(5, segs * 2 // 3), loc=(0, 0, 0.12 * s), scale=(1.0, 1.05, 0.95))
    cheek = superellipsoid(0.72 * s, 0.62 * s, 0.38 * s, 0.6, 0.6, segs, max(4, segs // 2), loc=(0, -0.28 * s, -0.48 * s))
    parts = [cran, cheek]
    if jaw:
        parts.append(superellipsoid(0.5 * s, 0.42 * s, 0.2 * s, 0.6, 0.6, max(6, segs - 2), 4, loc=(0, -0.42 * s, -0.86 * s)))
    bone_bm = merge(*parts)
    sockets = []
    for sx in (-1, 1):
        sockets.append(sphere(0.26 * s, max(6, segs - 4), 5, loc=(sx * 0.38 * s, -0.78 * s, -0.12 * s), scale=(1.0, 0.55, 1.1)))
    sockets.append(sphere(0.12 * s, 5, 3, loc=(0, -0.86 * s, -0.5 * s), scale=(0.8, 0.5, 1.2)))
    sock = merge(*sockets)
    return xf(bone_bm, loc, rot), xf(sock, loc, rot)


def flame(h: float = 0.06, r: float = 0.018, base: Sequence[float] = (0, 0, 0), segs: int = 8,
          lean: float = 0.0) -> bmesh.types.BMesh:
    """Teardrop flame standing on ``base`` (origin at its base so runtime flicker scales upward)."""
    prof = [(0.0, 0.0), (r * 0.75, h * 0.12), (r, h * 0.32), (r * 0.78, h * 0.58), (r * 0.36, h * 0.84), (0.0, h)]
    bm = lathe(prof, segs)
    if lean:
        for v in bm.verts:
            v.co.x += lean * (v.co.z / h) ** 2
    return translate(bm, base)


def candle(h: float = 0.16, r: float = 0.022, base: Sequence[float] = (0, 0, 0), drips: int = 3,
           seed: int = 0) -> bmesh.types.BMesh:
    """Wax candle with a slumped top and drips (no flame)."""
    from .rng import Jitter
    j = Jitter(f'candle{seed}')
    prof = [(r, 0.0), (r * 1.02, h * 0.5), (r * 0.98, h * 0.92), (r * 0.75, h), (r * 0.25, h * 0.97), (0.0, h * 0.95)]
    parts = [lathe(prof, 10)]
    for i in range(drips):
        a = TAU * (i / max(1, drips)) + j.sym(0.5)
        dl = h * j.uniform(0.18, 0.45)
        x, y = math.cos(a) * r * 0.98, math.sin(a) * r * 0.98
        parts.append(tube([(x, y, h * 0.96), (x * 1.08, y * 1.08, h * 0.96 - dl * 0.5), (x * 1.1, y * 1.1, h * 0.96 - dl)],
                          radii=[r * 0.28, r * 0.24, r * 0.2], segs=5))
    wick = cylinder(0.0025, 0.014, 4, 0.0, base=(0, 0, h * 0.95))
    bm = merge(*parts)
    return translate(merge(bm, wick), base)


def frond(length: float, droop: float, width: float, leaflets: int = 7, base: Sequence[float] = (0, 0, 0),
          yaw: float = 0.0, pitch: float = 50.0, curl: float = 0.0) -> bmesh.types.BMesh:
    """A drooping fern frond: a thin stem with paired triangular leaflets (use a double-sided material)."""
    bm = bmesh.new()
    pts = []
    n = leaflets + 1
    for i in range(n + 1):
        t = i / n
        horiz = length * t
        z = math.sin(math.radians(pitch)) * horiz - droop * t * t
        pts.append(Vector((horiz * math.cos(math.radians(pitch)), 0.0, z)))
    stem = tube(pts, radii=[0.005 * (1 - 0.7 * i / n) for i in range(n + 1)], segs=3)
    parts = [stem]
    for i in range(1, n):
        p = pts[i]
        t = i / n
        lw = width * (1 - t * 0.7)
        d = (pts[i + 1] - pts[i - 1]).normalized()
        side = Vector((0, 1, 0))
        leaf = bmesh.new()
        for sgn in (-1, 1):
            tip = p + side * sgn * lw + d * lw * 0.5 + Vector((0, 0, -lw * 0.35 - curl * t))
            a = leaf.verts.new(p - d * lw * 0.18)
            b = leaf.verts.new(p + d * lw * 0.32)
            c = leaf.verts.new(tip)
            leaf.faces.new((a, b, c) if sgn > 0 else (b, a, c))
        parts.append(leaf)
    bm = merge(*parts)
    rotate(bm, (0, 0, yaw))
    return translate(bm, base)


def grass_tuft(r: float = 0.05, h: float = 0.08, blades: int = 5, base: Sequence[float] = (0, 0, 0),
               seed: int = 0) -> bmesh.types.BMesh:
    from .rng import Jitter
    j = Jitter(f'tuft{seed}')
    parts = []
    for i in range(blades):
        a = TAU * i / blades + j.sym(0.4)
        d = r * j.uniform(0.2, 0.9)
        x, y = math.cos(a) * d, math.sin(a) * d
        lean = j.uniform(0.2, 0.6)
        hh = h * j.uniform(0.6, 1.2)
        parts.append(tube([(x, y, 0), (x + math.cos(a) * hh * lean * 0.5, y + math.sin(a) * hh * lean * 0.5, hh * 0.6),
                           (x + math.cos(a) * hh * lean, y + math.sin(a) * hh * lean, hh)],
                          radii=[0.007, 0.005, 0.0], segs=3))
    return translate(merge(*parts), base)


def stitches(p0: Sequence[float], p1: Sequence[float], count: int = 4, size: float = 0.012,
             normal: Sequence[float] = (0, -1, 0), r: float = 0.0025) -> bmesh.types.BMesh:
    """Dark thread crosses along a seam from p0 to p1 lying on a surface with the given normal."""
    a, b, n = Vector(p0), Vector(p1), Vector(normal).normalized()
    d = (b - a)
    side = d.cross(n).normalized() * size
    parts = []
    for i in range(count):
        c = a + d * ((i + 0.5) / count) + n * r
        parts.append(tube([c - side - d.normalized() * size * 0.5, c + side + d.normalized() * size * 0.5], r, 3))
        parts.append(tube([c - side + d.normalized() * size * 0.5, c + side - d.normalized() * size * 0.5], r, 3))
    return merge(*parts)


def count_tris(bm: bmesh.types.BMesh) -> int:
    return sum(len(f.verts) - 2 for f in bm.faces)


def outline_ring(outer: Sequence[Tuple[float, float]], inner: Sequence[Tuple[float, float]], z0: float, z1: float,
                 bevel_w: float = 0.008, segs: int = 1) -> bmesh.types.BMesh:
    """Closed wall solid between two same-length CCW XY loops (coffin walls, frames, rims) from z0 to z1."""
    if len(outer) != len(inner):
        raise ValueError('outline_ring loops must have equal length')
    bm = bmesh.new()
    n = len(outer)
    ob = [bm.verts.new((u, v, z0)) for u, v in outer]
    ot = [bm.verts.new((u, v, z1)) for u, v in outer]
    ib = [bm.verts.new((u, v, z0)) for u, v in inner]
    it = [bm.verts.new((u, v, z1)) for u, v in inner]
    for i in range(n):
        k = (i + 1) % n
        bm.faces.new((ob[i], ob[k], ot[k], ot[i]))      # outer side
        bm.faces.new((it[i], it[k], ib[k], ib[i]))      # inner side
        bm.faces.new((ot[i], ot[k], it[k], it[i]))      # top
        bm.faces.new((ib[i], ib[k], ob[k], ob[i]))      # bottom
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bevel_w > 0:
        bevel(bm, bevel_w, segs, angle=35.0)
    return bm


def offset_outline(pts: Sequence[Tuple[float, float]], d: float) -> List[Tuple[float, float]]:
    """Offset a convex CCW polygon inward by d (miter)."""
    n = len(pts)
    out = []
    for i in range(n):
        p0, p1, p2 = Vector((*pts[i - 1], 0)), Vector((*pts[i], 0)), Vector((*pts[(i + 1) % n], 0))
        e0 = (p1 - p0).normalized()
        e1 = (p2 - p1).normalized()
        n0 = Vector((-e0.y, e0.x, 0))
        n1 = Vector((-e1.y, e1.x, 0))
        bis = (n0 + n1).normalized()
        cosh = max(0.2, bis.dot(n0))
        q = p1 + bis * (d / cosh)
        out.append((q.x, q.y))
    return out


def coffin_outline(length: float, head_w: float, shoulder_w: float, foot_w: float, shoulder_t: float = 0.26,
                   axis: str = 'y') -> List[Tuple[float, float]]:
    """Classic hexagonal coffin outline (CCW). Head at +length/2 of the axis ('y' -> Blender +Y = model back)."""
    L = length / 2
    s = L - shoulder_t * length
    pts = [(-L, -foot_w / 2), (s, -shoulder_w / 2), (L, -head_w / 2), (L, head_w / 2), (s, shoulder_w / 2),
           (-L, foot_w / 2)]
    if axis == 'y':  # (along, across) -> (x=across, y=along), keep CCW
        pts = [(-b, a) for a, b in pts]
        pts = [(x, y) for x, y in pts]
        pts = [(-x, y) for x, y in pts][::-1]
    return pts


def superlathe(profile: Sequence[Tuple[float, float]], a: float, b: float, n: float = 3.0, segs: int = 24,
               base: Sequence[float] = (0, 0, 0), cap_bottom: bool = True, cap_top: bool = True) -> bmesh.types.BMesh:
    """Like ``lathe`` but each ring follows a superellipse |x/a|^n + |y/b|^n = s^n (rounded rectangle
    for n~3-4). Profile = (s, z) with s the ring scale (0 = pole). Great for tubs, troughs, planters."""
    bm = bmesh.new()

    def ring_pt(t: float, s: float) -> Tuple[float, float]:
        c, si = math.cos(t), math.sin(t)
        x = a * s * math.copysign(abs(c) ** (2.0 / n), c)
        y = b * s * math.copysign(abs(si) ** (2.0 / n), si)
        return x, y

    rings: List[List] = []
    for (s, z) in profile:
        if s <= 1e-6:
            rings.append([bm.verts.new((0.0, 0.0, z))])
        else:
            rings.append([bm.verts.new((*ring_pt(TAU * k / segs, s), z)) for k in range(segs)])
    for ra, rb in zip(rings, rings[1:]):
        if len(ra) == 1 and len(rb) == 1:
            continue
        if len(ra) == 1:
            for k in range(segs):
                bm.faces.new((ra[0], rb[k], rb[(k + 1) % segs]))
        elif len(rb) == 1:
            for k in range(segs):
                bm.faces.new((ra[k], rb[0], ra[(k + 1) % segs]))
        else:
            for k in range(segs):
                k2 = (k + 1) % segs
                bm.faces.new((ra[k], ra[k2], rb[k2], rb[k]))
    if cap_bottom and len(rings[0]) > 1:
        bm.faces.new(list(reversed(rings[0])))
    if cap_top and len(rings[-1]) > 1:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return translate(bm, base)


def superellipse_pts(a: float, b: float, n: float = 3.0, segs: int = 24) -> List[Tuple[float, float]]:
    out = []
    for k in range(segs):
        t = TAU * k / segs
        c, si = math.cos(t), math.sin(t)
        out.append((a * math.copysign(abs(c) ** (2.0 / n), c), b * math.copysign(abs(si) ** (2.0 / n), si)))
    return out


def jagged(p0: Sequence[float], p1: Sequence[float], n: int, amp: float, j, normal: Sequence[float] = (0, -1, 0)
           ) -> List[Vector]:
    """Zig-zag polyline from p0 to p1 (cracks, lightning) displaced perpendicular to the segment within the plane
    whose normal is given."""
    a, b, nn = Vector(p0), Vector(p1), Vector(normal).normalized()
    d = b - a
    side = d.cross(nn).normalized()
    pts = [a]
    for i in range(1, n):
        t = i / n
        pts.append(a + d * t + side * j.sym(amp))
    pts.append(b)
    return pts


# ───────────────────────────── hardening-pass helpers ─────────────────────────────


def smoothstep(e0: float, e1: float, x: float) -> float:
    """Hermite step: 0 at ``e0``, 1 at ``e1`` (``e0 > e1`` gives a falling edge)."""
    if e0 == e1:
        return 1.0 if x >= e1 else 0.0
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


def loft(rings: Sequence[Sequence[Sequence[float]]], cap_bottom: bool = False, cap_top: bool = True,
         closed: bool = True) -> bmesh.types.BMesh:
    """Skin a stack of loops (bottom -> top), each a list of (x, y, z) with equal length; a single-point ring is a
    pole. ``closed=False`` skins open strips (no wrap-around quad)."""
    bm = bmesh.new()
    vr: List[List] = [[bm.verts.new(tuple(p)) for p in ring] for ring in rings]
    n = max(len(r) for r in vr)
    span = n if closed else n - 1
    for ra, rb in zip(vr, vr[1:]):
        if len(ra) == 1 and len(rb) == 1:
            continue
        if len(ra) == 1:
            for k in range(span):
                bm.faces.new((ra[0], rb[k], rb[(k + 1) % n]))
        elif len(rb) == 1:
            for k in range(span):
                bm.faces.new((ra[k], rb[0], ra[(k + 1) % n]))
        else:
            for k in range(span):
                k2 = (k + 1) % n
                bm.faces.new((ra[k], ra[k2], rb[k2], rb[k]))
    if closed and cap_bottom and len(vr[0]) > 2:
        bm.faces.new(list(reversed(vr[0])))
    if closed and cap_top and len(vr[-1]) > 2:
        bm.faces.new(vr[-1])
    bm.normal_update()
    return bm


def outline_scaled(pts: Sequence[Tuple[float, float]], s: float, z: float,
                   centre: Tuple[float, float] = (0.0, 0.0)) -> List[Tuple[float, float, float]]:
    """2D outline scaled about ``centre`` and lifted to height ``z`` (rings for ``loft``)."""
    cx, cy = centre
    return [(cx + (x - cx) * s, cy + (y - cy) * s, z) for x, y in pts]


def figure8(r: float, sep: float, n: int = 28) -> List[Tuple[float, float]]:
    """Convex-hull-free 'cartoon bone end' outline (two circles of radius r at +-sep/2 on Z, smoothly waisted) in
    the XZ plane, CCW. Used for bone-shaped weight plates."""
    out = []
    for k in range(n):
        a = TAU * k / n
        c, s_ = math.cos(a), math.sin(a)
        # two lobes: radius grows toward +-Z, waist pinched at the X axis
        lobe = 1.0 + 0.34 * abs(s_) ** 1.6 - 0.12 * abs(c) ** 4
        out.append((c * r * 0.86 * lobe, s_ * (r + sep / 2) * (0.92 + 0.08 * abs(s_))))
    return out


def band(outline: Sequence[Tuple[float, float]], z0: float, z1: float, out: float = 0.01) -> bmesh.types.BMesh:
    """Cheap decorative strip proud of a wall following a CCW ``outline``: outer face + top/bottom lips only (no
    inner face, no bevel) — a third of the triangles of an ``outline_ring``."""
    o = offset_outline(outline, -out)
    bm = bmesh.new()
    n = len(outline)
    ib = [bm.verts.new((x, y, z0)) for x, y in outline]
    it = [bm.verts.new((x, y, z1)) for x, y in outline]
    ob = [bm.verts.new((x, y, z0)) for x, y in o]
    ot = [bm.verts.new((x, y, z1)) for x, y in o]
    for i in range(n):
        k = (i + 1) % n
        bm.faces.new((ob[i], ob[k], ot[k], ot[i]))
        bm.faces.new((ot[i], ot[k], it[k], it[i]))
        bm.faces.new((ib[i], ib[k], ob[k], ob[i]))
    bm.normal_update()
    return bm
