"""Procedural mesh toolkit. A `Part` accumulates vertices/faces/material names/vertex colours/_rot mask
in rest-pose armature space; builders below append primitives. Winding convention: rings are ordered
counter-clockwise around their advance direction, which yields outward-facing quads."""
from __future__ import annotations

import math
from typing import Callable, Iterable, Sequence

from mathutils import Matrix, Vector

V = Vector
WHITE = (1.0, 1.0, 1.0)


class Part:
    def __init__(self, name: str):
        self.name = name
        self.co: list[Vector] = []
        self.col: list[tuple[float, float, float]] = []
        self.rot: list[float] = []
        self.tag: list[str] = []
        self.faces: list[tuple[int, ...]] = []
        self.fmat: list[str] = []
        self.keys: dict[str, list[Vector]] = {}
        self.weights: list[dict[str, float]] | None = None
        self.sharp_angle: float | None = None  # degrees; None = fully smooth
        self.no_build = False

    # -- construction -----------------------------------------------------------------
    def v(self, co: Sequence[float], col=WHITE, rot: float = 0.0, tag: str = '') -> int:
        self.co.append(V(co))
        self.col.append(tuple(col))
        self.rot.append(rot)
        self.tag.append(tag)
        return len(self.co) - 1

    def f(self, idx: Sequence[int], mat: str) -> None:
        self.faces.append(tuple(idx))
        self.fmat.append(mat)

    def extend(self, other: 'Part') -> None:
        off = len(self.co)
        self.co += [c.copy() for c in other.co]
        self.col += list(other.col)
        self.rot += list(other.rot)
        self.tag += list(other.tag)
        self.faces += [tuple(i + off for i in fc) for fc in other.faces]
        self.fmat += list(other.fmat)

    @property
    def tri_count(self) -> int:
        return sum(len(fc) - 2 for fc in self.faces)

    def transform(self, m: Matrix, indices: Iterable[int] | None = None) -> None:
        rng = range(len(self.co)) if indices is None else indices
        for i in rng:
            self.co[i] = m @ self.co[i]

    def recolor(self, fn: Callable[[Vector, tuple], tuple], indices: Iterable[int] | None = None) -> None:
        rng = range(len(self.co)) if indices is None else indices
        for i in rng:
            self.col[i] = fn(self.co[i], self.col[i])

    def tag_range(self, start: int, tag: str) -> None:
        for i in range(start, len(self.co)):
            self.tag[i] = tag

    def mats_used(self) -> list[str]:
        seen: list[str] = []
        for m in self.fmat:
            if m not in seen:
                seen.append(m)
        return seen


# ------------------------------------------------------------------------------------------------
# Low-level helpers
# ------------------------------------------------------------------------------------------------

def orthonormal(t: Vector, up_hint: Vector) -> tuple[Vector, Vector]:
    """Return (n, b) perpendicular to tangent t with b = t x n (so rings (cos n + sin b) are CCW about t)."""
    t = t.normalized()
    n = up_hint - t * up_hint.dot(t)
    if n.length < 1e-6:
        alt = V((1, 0, 0)) if abs(t.x) < 0.9 else V((0, 1, 0))
        n = alt - t * alt.dot(t)
    n.normalize()
    b = t.cross(n)
    return n, b


def superellipse(theta: float, a: float, b: float, n: float) -> tuple[float, float]:
    c, s = math.cos(theta), math.sin(theta)
    e = 2.0 / n
    x = a * math.copysign(abs(c) ** e, c)
    y = b * math.copysign(abs(s) ** e, s)
    return x, y


def grid(part: Part, rows: list[list[int]], mat: str, close_u: bool = True, flip: bool = False) -> None:
    """Connect consecutive index rows with quads. Rows must have equal length."""
    for r in range(len(rows) - 1):
        a, b = rows[r], rows[r + 1]
        n = len(a)
        last = n if close_u else n - 1
        for j in range(last):
            j2 = (j + 1) % n
            q = (a[j], a[j2], b[j2], b[j])
            part.f(q[::-1] if flip else q, mat)


def fan(part: Part, ring: list[int], center: int, mat: str, flip: bool = False) -> None:
    n = len(ring)
    for j in range(n):
        tri = (center, ring[j], ring[(j + 1) % n])
        part.f(tri[::-1] if flip else tri, mat)


def add_ring(part: Part, pts: list[Vector], col=WHITE, rot=0.0, colfn=None, tag: str = '') -> list[int]:
    out = []
    for p in pts:
        c = colfn(p) if colfn else col
        out.append(part.v(p, c, rot, tag))
    return out


# ------------------------------------------------------------------------------------------------
# Lofts / tubes
# ------------------------------------------------------------------------------------------------

def loft(part: Part, rings: list[list[Vector]], mat: str, cap0: str | None = None, cap1: str | None = None,
         cap_depth0: float = 0.0, cap_depth1: float = 0.0, axis0: Vector | None = None, axis1: Vector | None = None,
         colfn=None, close_u: bool = True, dome_steps: int = 2, tag: str = '') -> list[list[int]]:
    """Loft explicit rings (each CCW about the advance direction). Caps: None | 'fan' | 'dome'."""
    idx_rows = [add_ring(part, r, colfn=colfn, tag=tag) for r in rings]
    grid(part, idx_rows, mat, close_u=close_u)

    def cap(ring_pts: list[Vector], ring_idx: list[int], kind: str, depth: float, axis: Vector, at_start: bool):
        c = sum(ring_pts, V((0, 0, 0))) / len(ring_pts)
        if kind == 'fan':
            ci = part.v(c + axis * depth, colfn(c) if colfn else WHITE, 0.0, tag)
            fan(part, ring_idx, ci, mat, flip=at_start)
            return
        prev = ring_idx
        for k in range(1, dome_steps + 1):
            ang = (k / (dome_steps + 1)) * (math.pi / 2)
            pts = [c + (p - c) * math.cos(ang) + axis * depth * math.sin(ang) for p in ring_pts]
            row = add_ring(part, pts, colfn=colfn, tag=tag)
            grid(part, [row, prev] if at_start else [prev, row], mat, close_u=close_u)
            prev = row
        ci = part.v(c + axis * depth, colfn(c) if colfn else WHITE, 0.0, tag)
        fan(part, prev, ci, mat, flip=at_start)

    if cap0 and close_u:
        ax = axis0 if axis0 is not None else _ring_axis(rings[0], rings[1], start=True)
        cap(rings[0], idx_rows[0], cap0, cap_depth0, ax, True)
    if cap1 and close_u:
        ax = axis1 if axis1 is not None else _ring_axis(rings[-1], rings[-2], start=False)
        cap(rings[-1], idx_rows[-1], cap1, cap_depth1, ax, False)
    return idx_rows


def _ring_axis(r_end: list[Vector], r_next: list[Vector], start: bool) -> Vector:
    c0 = sum(r_end, V((0, 0, 0))) / len(r_end)
    c1 = sum(r_next, V((0, 0, 0))) / len(r_next)
    d = (c0 - c1)
    return d.normalized() if d.length > 1e-9 else V((0, 0, 1))


def tube(part: Part, path: Sequence[Vector], radius: Callable[[float, float], float] | float, segs: int, mat: str,
         up: Vector = V((0, -1, 0)), squash: tuple[float, float] = (1.0, 1.0), cap0: str | None = 'dome',
         cap1: str | None = 'dome', cap_depth0: float | None = None, cap_depth1: float | None = None,
         colfn=None, theta0: float = 0.0, offset: Callable[[float, float], Vector] | None = None,
         dome_steps: int = 2, tag: str = '') -> list[list[int]]:
    """Tube along a polyline. radius(t, theta) with t in [0,1] along the path. Rings are perpendicular to the
    local tangent; `up` orients the ring frame (squash x along n, y along b)."""
    path = [V(p) for p in path]
    npts = len(path)
    seglen = [0.0]
    for i in range(1, npts):
        seglen.append(seglen[-1] + (path[i] - path[i - 1]).length)
    total = seglen[-1] or 1.0
    rings = []
    for i, p in enumerate(path):
        if i == 0:
            t = path[1] - path[0]
        elif i == npts - 1:
            t = path[-1] - path[-2]
        else:
            t = path[i + 1] - path[i - 1]
        n, b = orthonormal(t, up)
        u = seglen[i] / total
        ring = []
        for j in range(segs):
            th = theta0 + 2 * math.pi * j / segs
            r = radius(u, th) if callable(radius) else radius
            q = p + n * (math.cos(th) * r * squash[0]) + b * (math.sin(th) * r * squash[1])
            if offset is not None:
                q = q + offset(u, th)
            ring.append(q)
        rings.append(ring)
    r0 = radius(0.0, 0.0) if callable(radius) else radius
    r1 = radius(1.0, 0.0) if callable(radius) else radius
    d0 = r0 * 0.9 if cap_depth0 is None else cap_depth0
    d1 = r1 * 0.9 if cap_depth1 is None else cap_depth1
    ax0 = -(path[1] - path[0]).normalized()
    ax1 = (path[-1] - path[-2]).normalized()
    return loft(part, rings, mat, cap0=cap0, cap1=cap1, cap_depth0=d0, cap_depth1=d1, axis0=ax0, axis1=ax1,
                colfn=colfn, dome_steps=dome_steps, tag=tag)


# ------------------------------------------------------------------------------------------------
# Ellipsoids / spheres
# ------------------------------------------------------------------------------------------------

def ellipsoid(part: Part, center: Sequence[float], radii: Sequence[float], segs: int, rings: int, mat: str,
              frame: Matrix | None = None, shape: Callable[[Vector], float] | None = None,
              disp: Callable[[Vector], Vector] | None = None, colfn=None, tag: str = '',
              lat_range: tuple[float, float] = (-math.pi / 2, math.pi / 2), cap_bottom: bool = True,
              cap_top: bool = True) -> dict:
    """UV ellipsoid around local Z (poles on +-Z). `shape(d)` scales the radius for unit direction d (local),
    `disp(d)` adds a local offset. Returns dict(rows=..., top=idx|None, bottom=idx|None)."""
    c = V(center)
    fr = frame.to_3x3() if frame is not None else Matrix.Identity(3)
    lat0, lat1 = lat_range

    def point(lat: float, lon: float) -> Vector:
        d = V((math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)))
        s = shape(d) if shape else 1.0
        p = V((d.x * radii[0] * s, d.y * radii[1] * s, d.z * radii[2] * s))
        if disp:
            p = p + disp(d)
        return c + fr @ p

    rows = []
    for i in range(1, rings):
        lat = lat0 + (lat1 - lat0) * i / rings
        pts = [point(lat, 2 * math.pi * j / segs) for j in range(segs)]
        rows.append(add_ring(part, pts, colfn=colfn, tag=tag))
    grid(part, rows, mat)  # rows go bottom->top; CCW about +Z => outward
    top = bottom = None
    if cap_top:
        p = point(lat1, 0.0)
        top = part.v(p, colfn(p) if colfn else WHITE, 0.0, tag)
        fan(part, rows[-1], top, mat)
    if cap_bottom:
        p = point(lat0, 0.0)
        bottom = part.v(p, colfn(p) if colfn else WHITE, 0.0, tag)
        fan(part, rows[0], bottom, mat, flip=True)
    return {'rows': rows, 'top': top, 'bottom': bottom}


def rounded_box(part: Part, center: Sequence[float], half: Sequence[float], radius: float, mat: str,
                n: int = 2, frame: Matrix | None = None, colfn=None, tag: str = '',
                warp: Callable[[Vector], Vector] | None = None) -> list[int]:
    """Rounded box built from a subdivided cube whose vertices are pushed onto the rounded surface."""
    c = V(center)
    fr = frame.to_3x3() if frame is not None else Matrix.Identity(3)
    hx, hy, hz = half
    inner = (max(hx - radius, 0.0), max(hy - radius, 0.0), max(hz - radius, 0.0))
    cache: dict[tuple, int] = {}
    created: list[int] = []

    def vid(p: tuple[float, float, float]) -> int:
        key = (round(p[0], 6), round(p[1], 6), round(p[2], 6))
        if key in cache:
            return cache[key]
        q = V((p[0] * hx, p[1] * hy, p[2] * hz))
        cl = V((max(-inner[0], min(inner[0], q.x)), max(-inner[1], min(inner[1], q.y)),
                max(-inner[2], min(inner[2], q.z))))
        d = q - cl
        if d.length > 1e-9:
            q = cl + d.normalized() * radius
        if warp:
            q = warp(q)
        w = c + fr @ q
        i = part.v(w, colfn(w) if colfn else WHITE, 0.0, tag)
        cache[key] = i
        created.append(i)
        return i

    steps = [(-1 + 2 * k / n) for k in range(n + 1)]
    faces = [  # (normal axis, sign, u axis, v axis) with u x v = normal*sign
        (0, 1, 1, 2), (0, -1, 2, 1), (1, 1, 2, 0), (1, -1, 0, 2), (2, 1, 0, 1), (2, -1, 1, 0)]
    for ax, sg, ua, va in faces:
        for a in range(n):
            for b in range(n):
                quad = []
                for (da, db) in ((0, 0), (1, 0), (1, 1), (0, 1)):
                    p = [0.0, 0.0, 0.0]
                    p[ax] = float(sg)
                    p[ua] = steps[a + da]
                    p[va] = steps[b + db]
                    quad.append(vid(tuple(p)))
                part.f(quad, mat)
    return created


def disc(part: Part, center: Vector, normal: Vector, radius: float, segs: int, mat: str, up: Vector = V((0, 0, 1)),
         colfn=None, tag: str = '') -> list[int]:
    n, b = orthonormal(normal, up)
    ring = [center + (n * math.cos(2 * math.pi * j / segs) + b * math.sin(2 * math.pi * j / segs)) * radius
            for j in range(segs)]
    ri = add_ring(part, ring, colfn=colfn, tag=tag)
    ci = part.v(center, colfn(center) if colfn else WHITE, 0.0, tag)
    fan(part, ri, ci, mat)
    return ri + [ci]


def strip_quad(part: Part, a: Vector, b: Vector, normal: Vector, width: float, mat: str, col=WHITE,
               tag: str = '') -> None:
    """A flat quad from a to b with given width, facing `normal`."""
    d = (b - a)
    if d.length < 1e-9:
        return
    side = normal.cross(d).normalized() * (width * 0.5)
    i0 = part.v(a - side, col, 0.0, tag)
    i1 = part.v(b - side, col, 0.0, tag)
    i2 = part.v(b + side, col, 0.0, tag)
    i3 = part.v(a + side, col, 0.0, tag)
    # orient towards normal
    fn = (part.co[i1] - part.co[i0]).cross(part.co[i3] - part.co[i0])
    if fn.dot(normal) >= 0:
        part.f((i0, i1, i2, i3), mat)
    else:
        part.f((i3, i2, i1, i0), mat)


def mul_col(c: tuple, k) -> tuple:
    if isinstance(k, (int, float)):
        return (c[0] * k, c[1] * k, c[2] * k)
    return (c[0] * k[0], c[1] * k[1], c[2] * k[2])


def face_normal(part: Part, fi: int) -> Vector:
    fc = part.faces[fi]
    a, b, c = part.co[fc[0]], part.co[fc[1]], part.co[fc[2]]
    return (b - a).cross(c - a)


def face_center(part: Part, fi: int) -> Vector:
    fc = part.faces[fi]
    return sum((part.co[i] for i in fc), V((0, 0, 0))) / len(fc)


def delete_faces(part: Part, pred: Callable[[int], bool]) -> int:
    keep_f, keep_m = [], []
    removed = 0
    for i, fc in enumerate(part.faces):
        if pred(i):
            removed += 1
            continue
        keep_f.append(fc)
        keep_m.append(part.fmat[i])
    part.faces, part.fmat = keep_f, keep_m
    return removed


def compact(part: Part) -> None:
    """Drop vertices not referenced by any face (keeps shape keys consistent if called before keys exist)."""
    used = sorted({i for fc in part.faces for i in fc})
    remap = {old: new for new, old in enumerate(used)}
    part.co = [part.co[i] for i in used]
    part.col = [part.col[i] for i in used]
    part.rot = [part.rot[i] for i in used]
    part.tag = [part.tag[i] for i in used]
    for k in list(part.keys.keys()):
        part.keys[k] = [part.keys[k][i] for i in used]
    part.faces = [tuple(remap[i] for i in fc) for fc in part.faces]
