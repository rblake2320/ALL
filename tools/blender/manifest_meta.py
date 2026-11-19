"""Generated placement data for art manifests (decision D-043): a floor outline and contact frames.

Everything written to a manifest is in glTF/three axes (X = the model's left, Y up, Z = the model's front), metres.

outline       the tight floor shape for free placement: a LIST of convex parts, [[[x, z], ...], ...]. The shape is
              the union of the parts. One part (the convex hull) is the common case; a model with a notch a
              character could stand in (an L-shaped sofa, a U-shaped counter) gets several. Each part has no
              repeated first point and is counter-clockwise when (x, z) is read as an ordinary 2-D plane:

                  shoelace = sum(x[i] * z[i+1] - x[i+1] * z[i]) > 0

tileFootprint the grid size in tiles, where a kit has one. Never called `footprint`.
frame         {'pos': [x, y, z], 'yaw': degrees, 'kind': str}. yaw is a rotation about +Y; 0 faces +Z (the
              model's front), 90 faces +X.

Frames are authored in the Blender scene, never as numbers kept beside the model: each is an Empty named
`FRAME_<name>` parented to the model, its local -Y axis pointing the way the character faces, with a custom
property `kind`. `collect_frames` reads their world transforms for the manifest and removes them from the scene,
so the exported GLB is the same file with or without frames.

The geometry code is plain Python (no bpy, no numpy) so it can be tested outside Blender:
    python tools/blender/manifest_meta.py --selftest
"""
from __future__ import annotations

import math
import sys
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

FRAME_PREFIX = 'FRAME_'
KINDS = ('seat', 'hands', 'feet', 'mouth', 'attach', 'approach', 'exit')

CELL = 0.025          #: raster cell, metres
NOTCH = 0.40          #: a gap must hold a square this wide to count as a notch (about one character)
MAX_PARTS = 8

Point = Tuple[float, float]
Tri = Tuple[Point, Point, Point]


class OutlineError(ValueError):
    """The floor shape could not be covered by MAX_PARTS convex parts."""


# ─────────────────────────────────────────── plain geometry ───────────────────────────────────────────

def convex_hull_xz(points: Iterable[Sequence[float]]) -> List[List[float]]:
    """Convex hull of (x, z) points (Andrew's monotone chain), counter-clockwise, rounded to 0.1 mm."""
    pts = sorted({(round(float(p[0]), 4) + 0.0, round(float(p[1]), 4) + 0.0) for p in points})
    if len(pts) < 3:
        return [[x, z] for x, z in pts]

    def half(seq):
        h: list = []
        for p in seq:
            while len(h) >= 2 and (h[-1][0] - h[-2][0]) * (p[1] - h[-2][1]) - (h[-1][1] - h[-2][1]) * (p[0] - h[-2][0]) <= 0:
                h.pop()
            h.append(p)
        return h

    lower, upper = half(pts), half(pts[::-1])
    return [[x, z] for x, z in lower[:-1] + upper[:-1]]


def shoelace(poly: Sequence[Sequence[float]]) -> float:
    """Twice the signed area; positive for a counter-clockwise polygon."""
    return sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1]
               for i in range(len(poly)))


def _clip_rect(poly: List[List[float]], x0: float, z0: float, x1: float, z1: float) -> List[List[float]]:
    """Sutherland-Hodgman: a convex counter-clockwise polygon clipped to an axis-aligned rectangle."""
    def clip(pts, inside, cut):
        out = []
        for i, p in enumerate(pts):
            q = pts[(i + 1) % len(pts)]
            if inside(p):
                out.append(p)
                if not inside(q):
                    out.append(cut(p, q))
            elif inside(q):
                out.append(cut(p, q))
        return out

    def at_x(x):
        return lambda p, q: [x, p[1] + (q[1] - p[1]) * (x - p[0]) / (q[0] - p[0])]

    def at_z(z):
        return lambda p, q: [p[0] + (q[0] - p[0]) * (z - p[1]) / (q[1] - p[1]), z]

    pts = [list(p) for p in poly]
    for inside, cut in ((lambda p: p[0] >= x0, at_x(x0)), (lambda p: p[0] <= x1, at_x(x1)),
                        (lambda p: p[1] >= z0, at_z(z0)), (lambda p: p[1] <= z1, at_z(z1))):
        if not pts:
            return []
        pts = clip(pts, inside, cut)
    out: List[List[float]] = []
    for p in pts:
        q = [round(p[0], 4) + 0.0, round(p[1], 4) + 0.0]
        if not out or q != out[-1]:
            out.append(q)
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out


class _Grid:
    """A bit raster: one Python int per row (bit i = column i). Row j covers z0 + j*cell .. z0 + (j+1)*cell."""

    def __init__(self, x0: float, z0: float, nx: int, nz: int, cell: float):
        self.x0, self.z0, self.nx, self.nz, self.cell = x0, z0, nx, nz, cell
        self.full = (1 << nx) - 1

    def empty(self) -> List[int]:
        return [0] * self.nz

    def fill(self, rows: List[int], tris: Iterable[Tri]) -> None:
        """Mark every cell whose centre is inside a triangle, and every cell that holds a corner."""
        c, x0, z0 = self.cell, self.x0, self.z0
        for tri in tris:
            for (x, z) in tri:
                i, j = int((x - x0) / c), int((z - z0) / c)
                if 0 <= i < self.nx and 0 <= j < self.nz:
                    rows[j] |= 1 << i
            zs = [p[1] for p in tri]
            j0 = max(0, int(math.ceil((min(zs) - z0) / c - 0.5)))
            j1 = min(self.nz - 1, int(math.floor((max(zs) - z0) / c - 0.5)))
            for j in range(j0, j1 + 1):
                z = z0 + (j + 0.5) * c
                xs = []
                for k in range(3):
                    (ax, az), (bx, bz) = tri[k], tri[(k + 1) % 3]
                    if (az <= z < bz) or (bz <= z < az):
                        xs.append(ax + (bx - ax) * (z - az) / (bz - az))
                if len(xs) < 2:
                    continue
                i0 = max(0, int(math.ceil((min(xs) - x0) / c - 0.5)))
                i1 = min(self.nx - 1, int(math.floor((max(xs) - x0) / c - 0.5)))
                if i1 >= i0:
                    rows[j] |= ((1 << (i1 - i0 + 1)) - 1) << i0

    def _spread(self, rows: List[int], k: int, grow: bool) -> List[int]:
        """Dilate (grow) or erode with a (2k+1) square. Cells outside the grid count as empty."""
        out = []
        for r in rows:
            acc = r
            for s in range(1, k + 1):
                if grow:
                    acc |= (r << s) | (r >> s)
                else:
                    acc &= (r << s) & (r >> s)
            out.append(acc & self.full)
        res = []
        for j in range(self.nz):
            acc = out[j]
            for s in range(1, k + 1):
                a = out[j - s] if j - s >= 0 else 0
                b = out[j + s] if j + s < self.nz else 0
                acc = (acc | a | b) if grow else (acc & a & b)
            res.append(acc)
        return res

    def dilate(self, rows: List[int], k: int) -> List[int]:
        return self._spread(rows, k, True)

    def erode(self, rows: List[int], k: int) -> List[int]:
        return self._spread(rows, k, False)

    def reachable(self, free: List[int], inset: int = 0) -> List[int]:
        """The cells of `free` connected (4-neighbour) to the ring of cells `inset` in from the border of the grid."""
        lo, hi = inset, self.nz - 1 - inset
        edge = (1 << inset) | (1 << (self.nx - 1 - inset))
        ring = ((1 << (self.nx - 2 * inset)) - 1) << inset
        cur = [((ring if j in (lo, hi) else edge) if lo <= j <= hi else 0) & free[j] for j in range(self.nz)]
        changed = True
        while changed:
            changed = False
            for order in (range(self.nz), range(self.nz - 1, -1, -1)):
                for j in order:
                    r = cur[j]
                    if j > 0:
                        r |= cur[j - 1]
                    if j + 1 < self.nz:
                        r |= cur[j + 1]
                    r &= free[j]
                    while True:
                        grown = (r | (r << 1) | (r >> 1)) & free[j]
                        if grown == r:
                            break
                        r = grown
                    if r != cur[j]:
                        cur[j], changed = r, True
        return cur

    @staticmethod
    def count(rows: List[int]) -> int:
        return sum(bin(r).count('1') for r in rows)

    def extent(self, rows: List[int]) -> Optional[Tuple[int, int, int, int]]:
        """(i0, j0, i1, j1) of the set cells, or None when there are none."""
        js = [j for j, r in enumerate(rows) if r]
        if not js:
            return None
        union = 0
        for r in rows:
            union |= r
        return ((union & -union).bit_length() - 1, js[0], union.bit_length() - 1, js[-1])

    def outside(self, rows: List[int], box: Optional[Tuple[int, int, int, int]]) -> List[int]:
        """The cells of `rows` that lie outside the cell box (all of them when there is no box)."""
        if box is None:
            return list(rows)
        i0, j0, i1, j1 = box
        inside = ((1 << (i1 - i0 + 1)) - 1) << i0
        return [r if (j < j0 or j > j1) else (r & ~inside) for j, r in enumerate(rows)]

    def best_rect(self, allowed: List[int], want: List[int]) -> Optional[Tuple[int, int, int, int]]:
        """The rectangle of `allowed` cells that holds the most `want` cells, shrunk to the `want` cells in it:
        (i0, j0, i1, j1), cell indices inclusive, or None when no rectangle holds any. Every maximal rectangle
        is tried (the histogram method), scored with a summed-area table; ties go to the first found."""
        nx, nz = self.nx, self.nz
        sat = [[0] * (nx + 1)]
        for r in want:
            row, acc, prev = [0] * (nx + 1), 0, sat[-1]
            for i in range(nx):
                acc += (r >> i) & 1
                row[i + 1] = prev[i + 1] + acc
            sat.append(row)

        def weight(i0, j0, i1, j1):
            return sat[j1 + 1][i1 + 1] - sat[j0][i1 + 1] - sat[j1 + 1][i0] + sat[j0][i0]

        best, best_w = None, 0
        heights = [0] * (nx + 1)
        for j, r in enumerate(allowed):
            for i in range(nx):
                heights[i] = heights[i] + 1 if (r >> i) & 1 else 0
            stack: List[int] = []
            for i in range(nx + 1):
                h = heights[i] if i < nx else 0
                while stack and heights[stack[-1]] >= h:
                    top = stack.pop()
                    if heights[top] == 0:
                        continue
                    left = stack[-1] + 1 if stack else 0
                    w = weight(left, j - heights[top] + 1, i - 1, j)
                    if w > best_w:
                        best_w, best = w, (left, j - heights[top] + 1, i - 1, j)
                stack.append(i)
        if best is None:
            return None
        i0, j0, i1, j1 = best
        span = ((1 << (i1 - i0 + 1)) - 1) << i0
        rows = [want[j] & span for j in range(j0, j1 + 1)]
        js = [j0 + n for n, r in enumerate(rows) if r]
        union = 0
        for r in rows:
            union |= r
        return ((union & -union).bit_length() - 1, js[0], union.bit_length() - 1, js[-1])


def _snap(value: float, coords: List[float], reach: float, high: bool) -> float:
    """Move a part edge onto a real mesh edge: the outermost mesh coordinate within `reach` of `value` (the
    largest for a high edge, the smallest for a low one), else `value`. Outermost, so the parts never fall
    short of the mesh; a bevelled box has several coordinates within reach and the true extent is the last."""
    near = [c for c in coords if abs(c - value) <= reach]
    if not near:
        return value
    return max(near) if high else min(near)


def outline(triangles: Iterable[Sequence[Sequence[float]]], cell: float = CELL, notch: float = NOTCH,
            max_parts: int = MAX_PARTS) -> List[List[List[float]]]:
    """Floor outline of a mesh as a list of convex counter-clockwise parts. `triangles` are ((x, z), (x, z), (x, z)).

    Convex or nearly so (no gap in the hull that holds a `notch` square): one part, the convex hull.
    Otherwise the silhouette, with enclosed holes and gaps narrower than `notch` filled, is covered by rectangles
    that stay out of the notches (the one covering the most first);
    each part is the hull clipped to one rectangle, its edges snapped to mesh edges.
    """
    tris: List[Tri] = [tuple((float(p[0]), float(p[1])) for p in t) for t in triangles]  # type: ignore[misc]
    pts = [p for t in tris for p in t]
    hull = convex_hull_xz(pts)
    if len(hull) < 3:
        return [hull]
    k = max(1, int(round(notch / cell)) // 2 - 1)            # (2k+1) cells: a little under `notch`, for raster slack
    pad = (k + 2) * cell
    x0, z0 = min(p[0] for p in pts) - pad, min(p[1] for p in pts) - pad
    nx = int(math.ceil((max(p[0] for p in pts) + pad - x0) / cell))
    nz = int(math.ceil((max(p[1] for p in pts) + pad - z0) / cell))
    g = _Grid(x0, z0, nx, nz, cell)
    mask, hmask = g.empty(), g.empty()
    g.fill(mask, tris)
    h = [tuple(p) for p in hull]
    g.fill(hmask, [(h[0], h[i], h[i + 1]) for i in range(1, len(h) - 1)])
    hmask = [a | b for a, b in zip(hmask, mask)]
    # centres of the notch-sized squares that miss the mesh and can be reached from outside; an enclosed hole
    # (the inside of a bike rack) is not a place anything can get to, so it stays part of the shape
    centres = g.reachable(g.erode([~r & g.full for r in mask], k), k)    # erosion empties the outer k cells
    if not any(a & b for a, b in zip(centres, g.erode(hmask, k))):
        return [hull]                                         # no such square lies inside the hull: no notch
    open_floor = g.dilate(centres, k)
    closed = [(h & ~o) | m for h, o, m in zip(hmask, open_floor, mask)]
    total = g.count(closed)
    # a part may reach outside the hull (the hull clips it) but never into the open floor of a notch
    allowed = [(c | ~h) & g.full for c, h in zip(closed, hmask)]
    xs_mesh = sorted({round(p[0], 4) for p in pts})
    zs_mesh = sorted({round(p[1], 4) for p in pts})
    parts: List[List[List[float]]] = []
    left = list(closed)
    def take(rect) -> None:
        i0, j0, i1, j1 = rect
        block = ((1 << (i1 - i0 + 1)) - 1) << i0
        for j in range(j0, j1 + 1):
            left[j] &= ~block
        part = _clip_rect(hull, _snap(x0 + i0 * cell, xs_mesh, cell, False), _snap(z0 + j0 * cell, zs_mesh, cell, False),
                          _snap(x0 + (i1 + 1) * cell, xs_mesh, cell, True), _snap(z0 + (j1 + 1) * cell, zs_mesh, cell, True))
        if len(part) >= 3 and shoelace(part) > 1e-6:
            parts.append(part)

    while g.count(left) > max(4, 0.002 * total):               # what is left after that is raster noise...
        if len(parts) >= max_parts:
            raise OutlineError(f'floor shape needs more than {max_parts} convex parts')
        rect = g.best_rect(allowed, left)
        if rect is None:
            break
        take(rect)
    # ...unless it sticks out. A thin tip (the foot of a stair rail, a rudder) is few cells but it is the edge of
    # the model: keep covering whatever lies beyond the extent of what is covered so far.
    full = g.extent(closed)
    while True:
        done = g.extent([c & ~r for c, r in zip(closed, left)])
        if done is not None and all(abs(a - b) <= 1 for a, b in zip(done, full)):
            break
        beyond = g.outside(left, done)
        if not any(beyond):
            break
        if len(parts) >= max_parts:
            raise OutlineError(f'floor shape needs more than {max_parts} convex parts')
        rect = g.best_rect(allowed, beyond)
        if rect is None:
            break
        take(rect)
    return parts or [hull]


def from_blender(pos: Sequence[float]) -> List[float]:
    """Blender (x, y, z) with front = -Y, Z up  ->  glTF [x, y, z] with front = +Z, Y up."""
    return [round(float(pos[0]), 4) + 0.0, round(float(pos[2]), 4) + 0.0, round(-float(pos[1]), 4) + 0.0]


# ─────────────────────────────────────────── Blender scene ───────────────────────────────────────────

def add_frame(name: str, pos: Sequence[float], yaw: float, kind: str, parent=None):
    """Author a frame: an Empty `FRAME_<name>` at `pos` (Blender axes), facing `yaw` degrees (0 = the model's front)."""
    import bpy
    if kind not in KINDS:
        raise ValueError(f'frame {name}: unknown kind {kind!r}')
    ob = bpy.data.objects.new(FRAME_PREFIX + name, None)
    if ob.name != FRAME_PREFIX + name:
        raise RuntimeError(f'frame {name!r} defined twice')
    ob.empty_display_type = 'SINGLE_ARROW'
    ob.empty_display_size = 0.2
    ob.location = tuple(float(c) for c in pos)
    ob.rotation_euler = (0.0, 0.0, math.radians(yaw))
    ob['kind'] = kind
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        parent_frames(parent, [ob])
    return ob


def parent_frames(root, frames=None) -> None:
    """Parent the scene's unparented frames (or the given ones) to `root`, keeping their world transform."""
    import bpy
    bpy.context.view_layer.update()
    for ob in (frames if frames is not None else [o for o in bpy.context.scene.objects if o.name.startswith(FRAME_PREFIX)]):
        if ob.parent is None:
            ob.parent = root
            ob.matrix_parent_inverse = root.matrix_world.inverted()


def collect_frames(remove: bool = True) -> Dict[str, dict]:
    """World transforms of every `FRAME_*` Empty in the scene as manifest frames; the Empties are then removed."""
    import bpy
    from mathutils import Vector
    bpy.context.view_layer.update()
    out: Dict[str, dict] = {}
    for ob in sorted((o for o in bpy.context.scene.objects if o.name.startswith(FRAME_PREFIX)), key=lambda o: o.name):
        if ob.parent is None:
            raise RuntimeError(f'{ob.name} is not parented to the model')
        mw = ob.matrix_world
        f = mw.to_3x3() @ Vector((0.0, -1.0, 0.0))
        yaw = round(math.degrees(math.atan2(f.x, -f.y)), 2) + 0.0
        if yaw <= -180.0:
            yaw += 360.0
        out[ob.name[len(FRAME_PREFIX):]] = {'pos': from_blender(mw.translation), 'yaw': yaw, 'kind': ob['kind']}
        if remove:
            bpy.data.objects.remove(ob, do_unlink=True)
    return out


def scene_triangles(objects=None) -> List[Tri]:
    """Floor-plane triangles (glTF x, z) of the given mesh objects, or of every mesh in the scene, in world space."""
    import bpy
    bpy.context.view_layer.update()
    out: List[Tri] = []
    for ob in (objects if objects is not None else bpy.context.scene.objects):
        if ob.type != 'MESH':
            continue
        me, mw = ob.data, ob.matrix_world
        me.calc_loop_triangles()
        co = [mw @ v.co for v in me.vertices]
        for lt in me.loop_triangles:
            a, b, c = (co[i] for i in lt.vertices)
            out.append(((a.x, -a.y), (b.x, -b.y), (c.x, -c.y)))
    return out


# ─────────────────────────────────────────── self test ───────────────────────────────────────────

def _box(x0: float, z0: float, x1: float, z1: float) -> List[Tri]:
    return [((x0, z0), (x1, z0), (x1, z1)), ((x0, z0), (x1, z1), (x0, z1))]


def _area(parts: List[List[List[float]]]) -> float:
    return sum(shoelace(p) / 2 for p in parts)


def selftest() -> List[str]:
    bad: List[str] = []

    def expect(name: str, ok: bool, detail: str = '') -> None:
        if not ok:
            bad.append(f'{name}: {detail}')

    def convex_ccw(parts) -> bool:
        for p in parts:
            n = len(p)
            if n < 3 or shoelace(p) <= 0:
                return False
            for i in range(n):
                a, b, c = p[i], p[(i + 1) % n], p[(i + 2) % n]
                if (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < -1e-9:
                    return False
        return True

    # a plain box: one part, the box
    o = outline(_box(-0.5, -0.25, 0.5, 0.25))
    expect('box', o == [[[-0.5, -0.25], [0.5, -0.25], [0.5, 0.25], [-0.5, 0.25]]], str(o))

    # an L-shaped sofa: 3 x 1 back with a 1 x 1 arm; the notch is 2 x 1
    o = outline(_box(-1.5, -1.0, 1.5, 0.0) + _box(-1.5, 0.0, -0.5, 1.0))
    expect('L parts', len(o) == 2 and convex_ccw(o), str(o))
    expect('L area', abs(_area(o) - 4.0) < 1e-6, f'{_area(o)} != 4')

    # the same L, turned a quarter (parts must follow the mesh, not the axes of the first case)
    o = outline(_box(0.0, -1.5, 1.0, 1.5) + _box(-1.0, -1.5, 0.0, -0.5))
    expect('L turned', len(o) == 2 and convex_ccw(o) and abs(_area(o) - 4.0) < 1e-6, str(o))

    # a U-shaped counter: three parts
    o = outline(_box(-1.5, -1.0, -0.5, 1.0) + _box(0.5, -1.0, 1.5, 1.0) + _box(-0.5, -1.0, 0.5, 0.0))
    expect('U', len(o) == 3 and convex_ccw(o) and abs(_area(o) - 5.0) < 1e-6, f'{len(o)} parts, area {_area(o)}')

    # a gap too narrow to stand in is not a notch: two boxes 0.3 m apart stay one hull
    o = outline(_box(-1.0, -0.5, -0.15, 0.5) + _box(0.15, -0.5, 1.0, 0.5))
    expect('narrow gap', len(o) == 1 and abs(_area(o) - 2.0) < 1e-6, str(o))

    # a frame with an enclosed hole (a bike rack, a pergola): the hole cannot be reached, so one part
    o = outline(_box(-1.0, -1.0, 1.0, -0.9) + _box(-1.0, 0.9, 1.0, 1.0) + _box(-1.0, -1.0, -0.9, 1.0) + _box(0.9, -1.0, 1.0, 1.0))
    expect('enclosed hole', len(o) == 1 and abs(_area(o) - 4.0) < 1e-6, str(o))

    # a boat with a pointed bow and two thin rudders behind the stern, a notch between them: the slanted bow
    # must not shatter into steps (three parts: the boat and each rudder), and the rudders must be covered
    boat = [((-1.0, -2.6), (1.0, -2.6), (1.0, 1.2)), ((-1.0, -2.6), (1.0, 1.2), (-1.0, 1.2)), ((-1.0, 1.2), (1.0, 1.2), (0.0, 2.7))]
    o = outline(boat + _box(-0.47, -3.0, -0.43, -2.6) + _box(0.43, -3.0, 0.47, -2.6))
    zs = [q[1] for p in o for q in p]
    expect('boat', len(o) == 3 and convex_ccw(o) and min(zs) == -3.0 and max(zs) == 2.7 and abs(_area(o) - (7.6 + 1.5 + 0.032)) < 1e-6,
           f'{len(o)} parts, area {_area(o)}, z {min(zs)}..{max(zs)}')

    # a house with a flight of steps whose two rails run 0.3 m past the last tread: the rails are a handful of
    # cells against a 15 x 16 m house, but they are the front edge, so the outline must reach them
    house = _box(-7.5, -8.0, 7.5, 8.0) + _box(-0.75, 8.0, 0.75, 11.0) + _box(-0.79, 11.0, -0.71, 11.3) + _box(0.71, 11.0, 0.79, 11.3)
    o = outline(house)
    zs = [q[1] for p in o for q in p]
    expect('thin tips are covered', max(zs) == 11.3 and min(zs) == -8.0 and convex_ccw(o) and len(o) <= 5, f'{len(o)} parts, z {min(zs)}..{max(zs)}')

    # a bicycle seen from above (thin frame, wide handlebar): one hull, not slivers
    o = outline(_box(-0.03, -0.9, 0.03, 0.9) + _box(-0.3, -0.42, 0.3, -0.36))
    expect('bicycle', len(o) == 1 and convex_ccw(o), str(o))

    # a round table (16-gon fan): one part with 16 corners
    ring = [(0.6 * math.cos(math.tau * i / 16), 0.6 * math.sin(math.tau * i / 16)) for i in range(16)]
    o = outline([((0.0, 0.0), ring[i], ring[(i + 1) % 16]) for i in range(16)])
    expect('round', len(o) == 1 and len(o[0]) == 16 and convex_ccw(o), str(o))

    # a comb with nine 0.5 m teeth cannot be covered by eight parts: refuse rather than return something wrong
    comb = _box(0.0, 0.0, 17.0, 0.5)
    for i in range(9):
        comb += _box(2.0 * i, 0.5, 2.0 * i + 1.0, 1.5)
    try:
        outline(comb)
        expect('comb', False, 'no OutlineError')
    except OutlineError:
        pass

    # bevelled boxes: several mesh coordinates sit near each edge; the parts must reach the outermost
    def bevelled(x0, z0, x1, z1, b=0.012):
        return _box(x0 + b, z0, x1 - b, z1) + _box(x0, z0 + b, x1, z1 - b)
    o = outline(bevelled(-1.5, -1.0, 1.5, 0.0) + bevelled(-1.5, 0.0, -0.5, 1.0))
    ext = [min(q[0] for p in o for q in p), max(q[0] for p in o for q in p), min(q[1] for p in o for q in p), max(q[1] for p in o for q in p)]
    expect('bevelled L reaches the mesh extent', len(o) == 2 and ext == [-1.5, 1.5, -1.0, 1.0], f'{ext} {o}')

    expect('clockwise is negative', shoelace([[0, 0], [0, 1], [1, 1], [1, 0]]) < 0)
    return bad


def blender_selftest() -> List[str]:
    """Inside Blender: frames and the outline are read from the scene, so they follow the model when it changes."""
    import bmesh
    import bpy
    bad: List[str] = []
    bpy.ops.wm.read_factory_settings(use_empty=True)

    def box(name, x0, y0, x1, y1, parent=None):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co.x = x0 if v.co.x < 0 else x1
            v.co.y = y0 if v.co.y < 0 else y1
            v.co.z = 0.0 if v.co.z < 0 else 0.8
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = parent
        return ob

    sofa = box('sofa', -1.5, 0.0, 1.5, 1.0)                    # the back, 3 x 1
    box('arm', -1.5, -1.0, -0.5, 0.0, sofa)                    # one arm toward the front: an L
    add_frame('seat_0', (1.0, 0.5, 0.45), 0.0, 'seat', sofa)
    o = outline(scene_triangles())
    if len(o) != 2 or abs(_area(o) - 4.0) > 1e-6:
        bad.append(f'L sofa outline: {o}')
    f = collect_frames(remove=False)['seat_0']
    if f != {'pos': [1.0, 0.45, -0.5], 'yaw': 0.0, 'kind': 'seat'}:
        bad.append(f'frame at rest: {f}')
    sofa.location = (2.0, 0.0, 0.0)                            # move and turn the model a quarter turn
    sofa.rotation_euler = (0.0, 0.0, math.radians(90))
    f = collect_frames()['seat_0']
    if f != {'pos': [1.5, 0.45, -1.0], 'yaw': 90.0, 'kind': 'seat'}:
        bad.append(f'frame after moving the model: {f}')
    o = outline(scene_triangles())
    xs = [q[0] for part in o for q in part]
    if len(o) != 2 or abs(_area(o) - 4.0) > 1e-6 or min(xs) != 1.0 or max(xs) != 3.0:
        bad.append(f'outline after moving the model: {o}')
    if any(ob.name.startswith(FRAME_PREFIX) for ob in bpy.context.scene.objects):
        bad.append('frames were not removed from the scene')
    add_frame('loose', (0, 0, 0), 0.0, 'feet')
    try:
        collect_frames()
        bad.append('an unparented frame was accepted')
    except RuntimeError:
        pass
    return bad


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        problems = selftest()
        try:
            import bpy  # noqa: F401
            problems += blender_selftest()
            where = ' (with Blender scene checks)'
        except ImportError:
            where = ''
        for p in problems:
            print('FAIL', p)
        print('manifest_meta selftest:', ('FAILED' if problems else 'ok') + where)
        sys.exit(1 if problems else 0)
