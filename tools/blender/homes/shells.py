"""Exterior shell builders (W-049). Blender axes: front = -Y (the street), Z up, 1 unit = 1 m. A shell stands on
its house's wall rectangle, w x d, centred on the origin, so the front wall is the plane y = -d/2.

A shell is the outside only: walls, roof, windows as dark panes, doors, porches, steps. There is no floor plan, no
furniture and no room node; everything goes on the model's single root node.

LOD1 (`far`) keeps the silhouette, the roof, the windows and the doors, and drops frames, shutters, rails, seams
and other small trim.
"""
from __future__ import annotations

import math
from typing import Callable, Dict, Sequence

from mathutils import Vector

from common import shapes as S
from common.model import Model

from .specs import STOREY, ShellSpec

BUILDERS: Dict[str, Callable] = {}


def style(name: str):
    def deco(fn):
        BUILDERS[name] = fn
        return fn
    return deco


class House:
    def __init__(self, m: Model, spec: ShellSpec, lod: int):
        self.m, self.spec, self.far = m, spec, lod > 0
        self.w, self.d = float(spec.w), float(spec.d)
        self.fy = -self.d / 2                 # the front wall plane
        self.floor_z = 0.0                    # height of the front door's threshold
        self.porch_depth = 0.0                      # depth of the porch or stoop in front of the door
        self.reach = 0.0                      # how far steps run out in front of the porch
        self.stair_x = None                   # x of the front steps (None = straight in front of the door)
        self.j = m.rng

    # ---- primitives -------------------------------------------------------------------------------
    def box(self, sx, sy, sz, base, look, rot=(0, 0, 0)) -> None:
        self.m.add(S.box(sx, sy, sz, 0.0, 0, base=base, rot=rot), look)

    def cbox(self, sx, sy, sz, loc, look, rot=(0, 0, 0)) -> None:
        self.m.add(S.box(sx, sy, sz, 0.0, 0, loc=loc, rot=rot), look)

    def body(self, w, d, h, z0, look, cx=0.0, cy=0.0, plinth=None, corners=None) -> None:
        self.box(w, d, h, (cx, cy, z0), look)
        if plinth:
            self.box(w + 0.14, d + 0.14, 0.32, (cx, cy, z0), plinth)
        if corners and not self.far:
            for sx in (-1, 1):
                for sy in (-1, 1):
                    self.box(0.16, 0.16, h, (cx + sx * (w / 2 - 0.03), cy + sy * (d / 2 - 0.03), z0), corners)

    # ---- openings ---------------------------------------------------------------------------------
    def window(self, face: str, u: float, z: float, ww: float, wh: float, plane: float, frame='Trim', shutters=None,
               arch=False, bars=0) -> None:
        """A dark pane on a wall. face: 'F' (front, -Y), 'B', 'L' (+X) or 'R' (-X); u = position along the wall;
        plane = the wall's coordinate on the axis it faces; z = sill height."""
        along_x = face in 'FB'
        sgn = -1.0 if face in 'FR' else 1.0
        t = 0.05

        def put(du, dz, su, sz_, look, out=0.0, thick=t):
            c = plane + sgn * (out + thick / 2 - 0.02)
            if along_x:
                self.cbox(su, thick, sz_, (u + du, c, z + dz + sz_ / 2), look)
            else:
                self.cbox(thick, su, sz_, (c, u + du, z + dz + sz_ / 2), look)

        put(0.0, 0.0, ww, wh, 'WindowDark')
        if arch:                                                         # a pointed head
            top = S.taper_box(ww if along_x else t, t if along_x else ww, 0.04 if along_x else t, t if along_x else 0.04,
                              ww * 0.7, 0.0, 0)
            c = plane + sgn * (t / 2 - 0.02)
            self.m.add(S.translate(top, (u, c, z + wh) if along_x else (c, u, z + wh)), 'WindowDark')
        if self.far:
            return
        put(0.0, -0.08, ww + 0.20, 0.08, frame, out=0.03, thick=0.10)    # sill
        if not arch:
            put(0.0, wh, ww + 0.16, 0.10, frame, out=0.02, thick=0.08)   # lintel
        for k in range(bars):                                            # glazing bars
            put(-ww / 2 + ww * (k + 1) / (bars + 1), 0.0, 0.035, wh, frame, out=0.03, thick=0.03)
        if shutters:
            for s in (-1, 1):
                put(s * (ww / 2 + 0.17), 0.0, 0.28, wh, shutters, out=0.02, thick=0.04)

    def window_row(self, face, plane, span, z, n, ww, wh, skip=(), **kw) -> None:
        """n windows evenly spaced along `span` = (u0, u1); `skip` lists indices left out (a door is there)."""
        u0, u1 = span
        for i in range(n):
            if i in skip:
                continue
            self.window(face, u0 + (u1 - u0) * (i + 0.5) / n, z, ww, wh, plane, **kw)

    def door(self, x: float, z: float, w: float = 1.0, h: float = 2.1, look='WoodDark', frame='Trim', arch=False,
             plane=None) -> None:
        y = (self.fy if plane is None else plane)
        if self.floor_z == 0.0:
            self.floor_z = z                          # the first door built is the front door: its threshold is the floor
        self.cbox(w, 0.08, h, (x, y - 0.03, z + h / 2), look)
        if arch:
            top = S.taper_box(w, 0.08, 0.05, 0.08, w * 0.6, 0.0, 0)
            self.m.add(S.translate(top, (x, y - 0.03, z + h)), look)
        if self.far:
            return
        if not arch:
            self.cbox(w + 0.24, 0.10, 0.12, (x, y - 0.04, z + h + 0.06), frame)
        for s in (-1, 1):
            self.cbox(0.10, 0.10, h, (x + s * (w / 2 + 0.05), y - 0.04, z + h / 2), frame)
        self.m.add(S.sphere(0.04, 6, 3, loc=(x + w / 2 - 0.14, y - 0.09, z + 1.0)), 'Brass')

    # ---- roofs ------------------------------------------------------------------------------------
    def roof_gable(self, w, d, z, pitch, axis='x', over=0.45, look='Shingle', gable='Siding', cx=0.0, cy=0.0, thick=0.12) -> float:
        """Ridge along `axis`. Returns the ridge height."""
        half = (d if axis == 'x' else w) / 2
        t = math.tan(math.radians(pitch))
        rise, run = half * t, half + over
        length = run / math.cos(math.radians(pitch))
        zc = z + rise - run * t / 2 + thick / 2
        for s in (-1, 1):
            if axis == 'x':
                self.cbox(w + 2 * over, length, thick, (cx, cy + s * run / 2, zc), look, rot=(-s * pitch, 0, 0))
            else:
                self.cbox(length, d + 2 * over, thick, (cx + s * run / 2, cy, zc), look, rot=(0, s * pitch, 0))
        for s in (-1, 1):                                                # gable end walls
            if axis == 'x':
                self.m.add(S.taper_box(0.10, d, 0.10, 0.06, rise, 0.0, 0, base=(cx + s * (w / 2 - 0.05), cy, z)), gable)
            else:
                self.m.add(S.taper_box(w, 0.10, 0.06, 0.10, rise, 0.0, 0, base=(cx, cy + s * (d / 2 - 0.05), z)), gable)
        if not self.far:
            if axis == 'x':
                self.cbox(w + 2 * over + 0.04, 0.18, 0.10, (cx, cy, z + rise + thick + 0.02), 'Trim')
            else:
                self.cbox(0.18, d + 2 * over + 0.04, 0.10, (cx, cy, z + rise + thick + 0.02), 'Trim')
        return z + rise + thick

    def roof_flat(self, w, d, z, look='Slate', parapet=0.55, wall='Brick', cx=0.0, cy=0.0, coping='StoneLight') -> float:
        self.box(w, d, 0.10, (cx, cy, z), look)
        for s in (-1, 1):
            self.box(w, 0.22, parapet, (cx, cy + s * (d / 2 - 0.11), z), wall)
            self.box(0.22, d - 0.44, parapet, (cx + s * (w / 2 - 0.11), cy, z), wall)
        if not self.far:
            for s in (-1, 1):
                self.box(w + 0.16, 0.34, 0.08, (cx, cy + s * (d / 2 - 0.11), z + parapet), coping)
                self.box(0.34, d - 0.5, 0.08, (cx + s * (w / 2 - 0.11), cy, z + parapet), coping)
        return z + parapet + 0.08

    def roof_mansard(self, w, d, z, h, inset, look='Slate', cx=0.0, cy=0.0) -> float:
        self.m.add(S.taper_box(w + 0.5, d + 0.5, w - 2 * inset, d - 2 * inset, h, 0.0, 0, base=(cx, cy, z)), look)
        self.box(w - 2 * inset + 0.2, d - 2 * inset + 0.2, 0.12, (cx, cy, z + h), 'Charcoal')
        return z + h + 0.12

    def spire(self, cx, cy, z, w, h, look='Slate') -> float:
        self.m.add(S.taper_box(w + 0.3, w + 0.3, 0.06, 0.06, h, 0.0, 0, base=(cx, cy, z)), look)
        self.m.add(S.tube([(cx, cy, z + h - 0.1), (cx, cy, z + h + 0.7)], 0.03, 3 if self.far else 4), 'Iron')
        if not self.far:
            self.cbox(0.34, 0.03, 0.03, (cx, cy, z + h + 0.45), 'Iron')
        return z + h + 0.7

    # ---- porches, steps, posts --------------------------------------------------------------------
    def steps(self, x, y_top, z_top, width, look='Planks', solid=True, rise=0.19, run=0.30) -> float:
        """Steps down toward the street from (y_top, z_top). Returns how far they run out."""
        self.stair_x = x                               # visitors arrive at the foot of the steps
        n = max(1, int(math.ceil((z_top - 0.02) / rise)))
        h = z_top / n
        for k in range(1, n + 1):
            top = z_top - k * h                                        # tread k is k risers below the top
            if top < 0.02:
                continue                                               # the last riser lands on the ground
            y = y_top - (k - 0.5) * run
            if solid:
                self.box(width, run, top, (x, y, 0.0), look)
            else:
                self.cbox(width, run * 0.9, 0.05, (x, y, top - 0.025), look)
        if not solid and not self.far:
            foot = y_top - (n - 1.1) * run                               # just inside the front edge of the lowest tread (tread n - 1)
            drop = (y_top - foot) / (n * run)                            # how far down the flight that is
            for s in (-1, 1):                                            # stringers and a hand rail, ending at that tread
                self.m.add(S.tube([(x + s * (width / 2 - 0.04), y_top, z_top - 0.12), (x + s * (width / 2 - 0.04), foot, z_top * (1 - drop) + 0.02)], 0.04, 4), look)
                self.m.add(S.tube([(x + s * width / 2, y_top, z_top + 0.9), (x + s * width / 2, foot, z_top * (1 - drop) + 0.9)], 0.03, 4), look)
        return n * run

    def porch(self, x0, x1, depth, z, roof_z=None, deck='Planks', post='Trim', roof='Shingle', pitch=12.0, rail=True,
              gap=None) -> None:
        """A deck across x0..x1 in front of the front wall at height z, with posts and (optionally) its own roof.
        `gap` = (xa, xb): the rail is left open there (where the steps arrive)."""
        fy, xc, wd = self.fy, (x0 + x1) / 2, x1 - x0
        self.box(wd, depth, 0.14, (xc, fy - depth / 2, z - 0.14), deck)
        n = max(2, int(round(wd / 2.6)) + 1)
        xs = [x0 + 0.12 + (wd - 0.24) * i / (n - 1) for i in range(n)]
        top = roof_z if roof_z is not None else z + 1.0
        for x in xs:
            self.box(0.14, 0.14, top - z, (x, fy - depth + 0.12, z), post)
        if roof_z is not None:
            t = math.tan(math.radians(pitch))
            length = (depth + 0.35) / math.cos(math.radians(pitch))
            self.cbox(wd + 0.5, length, 0.09, (xc, fy - (depth + 0.35) / 2 + 0.05, roof_z + (depth + 0.35) * t / 2 + 0.05), roof,
                      rot=(pitch, 0, 0))
        if rail and not self.far:
            for a, b in zip(xs, xs[1:]):
                if gap and not (b <= gap[0] or a >= gap[1]):
                    continue
                for dz in (0.45, 0.9):
                    self.m.add(S.tube([(a, fy - depth + 0.12, z + dz), (b, fy - depth + 0.12, z + dz)], 0.03, 4), post)
        self.porch_depth = max(self.porch_depth, depth)

    def stilts(self, w, d, h, nx, ny, look='Pine', r=0.13, cx=0.0, cy=0.0) -> None:
        for i in range(nx):
            for k in range(ny):
                x = cx - w / 2 + 0.3 + (w - 0.6) * i / max(1, nx - 1)
                y = cy - d / 2 + 0.3 + (d - 0.6) * k / max(1, ny - 1)
                if self.far:
                    self.box(r * 1.7, r * 1.7, h, (x, y, 0.0), look)
                else:
                    post = S.cylinder(r, h + 0.05, 6, 0.0, base=(0, 0, -0.05), rot=(self.j.sym(1.5), self.j.sym(1.5), 0))
                    S.displace(post, lambda v: Vector((v.x, v.y, max(v.z, 0.0))))      # a leaning post still ends on the ground
                    self.m.add(S.translate(post, (x, y, 0.0)), look)
        if not self.far:
            for i in range(nx):                                          # girts tying each row of posts
                x = cx - w / 2 + 0.3 + (w - 0.6) * i / max(1, nx - 1)
                self.cbox(0.06, d - 0.6, 0.14, (x, cy, h * 0.55), look)

    def chimney(self, x, y, z0, z1, look='Brick', lean=0.0, size=0.62) -> None:
        self.box(size, size, z1 - z0, (x, y, z0), look, rot=(lean, lean * 0.6, 0))
        if not self.far:
            self.box(size + 0.14, size + 0.14, 0.10, (x, y, z1 - 0.02), 'StoneLight', rot=(lean, lean * 0.6, 0))
            self.box(0.30, 0.30, 0.22, (x, y, z1 + 0.08), 'Charcoal', rot=(lean, lean * 0.6, 0))


# ─────────────────────────────────────────── L1 Wormwood ───────────────────────────────────────────

@style('starter')
def starter(h: House) -> None:
    """The free fixer-upper: a crooked little cottage with a bathroom bump out the back and a leaning chimney."""
    w, d, wall = h.w, h.d - 1.0, 2.9                                    # the main block; the last row is the bump-out
    cy = -0.5
    h.body(w, d, wall, 0.0, 'Siding', cy=cy, plinth='StoneLight', corners='Trim')
    h.body(4.0, 1.4, 2.5, 0.0, 'SidingB', cx=3.5, cy=h.d / 2 - 0.7, plinth='StoneLight')        # bathroom bump-out
    h.cbox(4.3, 1.9, 0.10, (3.5, h.d / 2 - 0.55, 2.62), 'Shingle', rot=(-14, 0, 0))             # its lean-to roof
    ridge = h.roof_gable(w, d, wall, 30, axis='x', over=0.5, look='Shingle', gable='Siding', cy=cy)
    x = h.spec.doors[0]
    h.door(x, 0.18, 1.0, 2.05, 'WoodDark')
    h.window('F', -3.3, 0.95, 1.1, 1.2, h.fy, shutters='SidingC', bars=1)
    h.window('F', 3.2, 0.95, 1.1, 1.2, h.fy, shutters='SidingC', bars=1)
    h.window('L', cy + 1.5, 0.95, 1.1, 1.2, w / 2, bars=1)
    h.window('R', cy - 1.2, 0.95, 1.1, 1.2, -w / 2, bars=1)
    h.window('R', cy + 2.2, 0.95, 1.1, 1.2, -w / 2, bars=1)
    h.window('B', -2.6, 0.95, 1.1, 1.2, cy + d / 2, bars=1)
    h.window('B', 4.4, 1.3, 0.7, 0.7, h.d / 2)
    # the stoop: two steps and a little roof on crooked posts
    h.porch(x - 1.3, x + 1.3, 1.3, 0.18, roof_z=2.45, deck='Planks', post='WoodDark', pitch=14, rail=False)
    h.reach = h.steps(x, h.fy - 1.3, 0.18, 1.6, 'StoneLight')
    h.chimney(-3.6, cy + 0.6, wall + 0.6, ridge + 1.0, lean=4.0)
    if not h.far:
        h.cbox(1.1, 0.04, 0.45, (3.2, h.fy - 0.06, 1.75), 'Planks', rot=(0, 8, 0))               # a board nailed across a window
        h.m.add(S.tube([(-w / 2 - 0.42, h.fy - 0.5, wall + 0.02), (-w / 2 - 0.42, h.fy - 0.5, 0.3), (-w / 2 - 0.2, h.fy - 0.7, 0.1)], 0.05, 5), 'Galvanised')
        h.cbox(w + 0.7, 0.10, 0.10, (0.0, h.fy - 0.48, wall - 0.12), 'Galvanised', rot=(0, 1.2, 0))   # a sagging gutter


@style('shack')
def shack(h: House) -> None:
    """The condemned shack of the story start: two rooms under a patched roof, one window boarded, a stovepipe that
    leans, a notice nailed by the door."""
    w, d, wall = h.w, h.d, 2.6
    h.body(w, d, wall, 0.0, 'SidingC', plinth='StoneLight', corners='Trim')
    ridge = h.roof_gable(w, d, wall, 30, axis='x', over=0.4, look='Shingle', gable='SidingC')
    x = h.spec.doors[0]
    h.door(x, 0.12, 1.0, 2.0, 'WoodDark')
    h.window('F', 2.5, 0.95, 1.0, 1.1, h.fy, bars=1)                                           # window_grimy h:17:19
    h.window('R', -0.5, 0.95, 1.0, 1.1, -w / 2, bars=1)                                        # window_grimy v:11:16
    h.reach = h.steps(x, h.fy, 0.12, 1.4, 'StoneLight')
    h.chimney(2.6, 0.5, wall + 0.5, ridge + 0.7, lean=6.0, size=0.45)
    # these read from across the street, so the far level keeps them: the tin patch, the lean-to, the rain barrel
    h.cbox(1.6, 1.3, 0.05, (-1.6, -d / 4 - 0.1, wall + 0.92), 'Galvanised', rot=(30, 0, 4))
    h.body(2.4, 0.7, 1.7, 0.0, 'Planks', cx=-2.2, cy=d / 2 + 0.20)                              # a wood store on the back wall
    h.cbox(2.7, 1.0, 0.08, (-2.2, d / 2 + 0.22, 1.78), 'Galvanised', rot=(-16, 0, 0))
    h.m.add(S.cylinder(0.32, 0.85, 8 if h.far else 10, 0.0 if h.far else 0.02, base=(w / 2 - 0.40, h.fy - 0.45, 0.0)), 'WoodDark')
    if not h.far:
        h.cbox(1.2, 0.04, 0.16, (2.5, h.fy - 0.06, 1.25), 'Planks', rot=(0, 9, 0))               # boards across the window
        h.cbox(1.2, 0.04, 0.16, (2.5, h.fy - 0.06, 1.70), 'Planks', rot=(0, -6, 0))
        h.cbox(0.42, 0.03, 0.55, (x + 1.05, h.fy - 0.05, 1.45), 'Trim', rot=(0, 3, 0))           # the CONDEMNED notice
        h.cbox(0.30, 0.035, 0.06, (x + 1.05, h.fy - 0.055, 1.60), 'WoodDark', rot=(0, 3, 0))
        h.cbox(w + 0.5, 0.10, 0.10, (0.0, h.fy - 0.40, wall - 0.10), 'Galvanised', rot=(0, -1.6, 0))   # the gutter, sagging
        for k in range(3):                                                                      # barrel hoops
            h.m.add(S.torus(0.325, 0.014, 10, 3, loc=(w / 2 - 0.40, h.fy - 0.45, 0.15 + 0.28 * k)), 'Galvanised')


def _shack_dress(h: House, x: float, wall: float, ridge: float, board_x: float, store_cx: float, store_cy: float,
                 barrel: tuple, chimney: tuple) -> None:
    """What the three shacks share: the notice, the boarded window, a stovepipe, a tin patch, a wood store, a barrel."""
    h.chimney(chimney[0], chimney[1], wall + 0.5, ridge + 0.7, lean=6.0, size=0.45)
    h.cbox(1.6, 1.3, 0.05, (chimney[0] - 2.4, chimney[1] - 1.2, wall + 0.92), 'Galvanised', rot=(30, 0, 4))
    h.body(2.4, 0.7, 1.7, 0.0, 'Planks', cx=store_cx, cy=store_cy)
    h.cbox(2.7, 1.0, 0.08, (store_cx, store_cy + 0.02, 1.78), 'Galvanised', rot=(-16, 0, 0))
    h.m.add(S.cylinder(0.32, 0.85, 8 if h.far else 10, 0.0 if h.far else 0.02, base=(barrel[0], barrel[1], 0.0)), 'WoodDark')
    if not h.far:
        h.cbox(1.2, 0.04, 0.16, (board_x, h.fy - 0.06, 1.25), 'Planks', rot=(0, 9, 0))
        h.cbox(1.2, 0.04, 0.16, (board_x, h.fy - 0.06, 1.70), 'Planks', rot=(0, -6, 0))
        h.cbox(0.42, 0.03, 0.55, (x + 1.05, h.fy - 0.05, 1.45), 'Trim', rot=(0, 3, 0))
        h.cbox(0.30, 0.035, 0.06, (x + 1.05, h.fy - 0.055, 1.60), 'WoodDark', rot=(0, 3, 0))
        for k in range(3):
            h.m.add(S.torus(0.325, 0.014, 10, 3, loc=(barrel[0], barrel[1], 0.15 + 0.28 * k)), 'Galvanised')


@style('shack_lean')
def shack_lean(h: House) -> None:
    """The leaning variant: a narrow, deep shack, 6 x 8, with its ridge along the depth and a wall that leans."""
    w, d, wall = h.w, h.d, 2.6
    h.body(w, d, wall, 0.0, 'SidingC', plinth='StoneLight', corners='Trim')
    ridge = h.roof_gable(w, d, wall, 32, axis='x', over=0.4, look='Shingle', gable='SidingC')
    x = h.spec.doors[0]
    h.door(x, 0.12, 1.0, 2.0, 'WoodDark')
    h.window('F', 2.5, 0.95, 1.0, 1.1, h.fy, bars=1)                                           # window_grimy h:17:19
    h.window('R', 0.5, 0.95, 1.0, 1.1, -w / 2, bars=1)                                         # window_grimy v:12:14
    h.reach = h.steps(x, h.fy, 0.12, 1.4, 'StoneLight')
    _shack_dress(h, x, wall, ridge, board_x=2.5, store_cx=-1.2, store_cy=d / 2 + 0.20, barrel=(w / 2 - 0.40, h.fy - 0.45),
                 chimney=(1.8, 1.2))
    if not h.far:
        h.cbox(w + 0.5, 0.10, 0.10, (0.0, h.fy - 0.40, wall - 0.10), 'Galvanised', rot=(0, -2.2, 0))   # the gutter, sagging
        h.m.add(S.tube([(w / 2 + 0.25, 1.4, 0.06), (w / 2 - 0.02, 1.4, 1.9)], 0.05, 5), 'Planks')      # a prop holding the wall up


@style('shack_lshape')
def shack_lshape(h: House) -> None:
    """The L-shaped variant, 8 x 8 outer: the main room at the front left (5 x 6), the back room behind on the
    right (3 x 6), each under its own gable."""
    wall = 2.6
    mx, my, bx, by = -1.5, -1.0, 2.5, 1.0                              # the two blocks' centres (x 10..15 / z 13..19; x 15..18 / z 11..17)
    h.body(5.0, 6.0, wall, 0.0, 'SidingC', cx=mx, cy=my, plinth='StoneLight', corners='Trim')
    h.body(3.0, 6.0, wall - 0.3, 0.0, 'SidingB', cx=bx, cy=by, plinth='StoneLight', corners='Trim')
    ridge = h.roof_gable(5.0, 6.0, wall, 30, axis='x', over=0.4, look='Shingle', gable='SidingC', cx=mx, cy=my)
    h.roof_gable(3.0, 6.0, wall - 0.3, 30, axis='x', over=0.4, look='Shingle', gable='SidingB', cx=bx, cy=by)
    x = h.spec.doors[0]
    h.door(x, 0.12, 1.0, 2.0, 'WoodDark')                                                      # door_splintered h:12:19
    h.window('R', -1.5, 0.95, 1.0, 1.1, -h.w / 2, bars=1)                                      # window_grimy v:10:16
    h.window('B', 2.5, 0.95, 1.0, 1.1, h.d / 2, bars=1)                                        # window_grimy h:16:11
    h.reach = h.steps(x, h.fy, 0.12, 1.4, 'StoneLight')
    h.cbox(1.3, 0.55, 0.03, (x, h.fy - 0.52, 0.015), 'Planks')                               # a plank doormat past the step
    _shack_dress(h, x, wall, ridge, board_x=0.6, store_cx=-2.6, store_cy=my + 3.0 + 0.35, barrel=(bx + 0.9, by - 3.0 - 0.32),
                 chimney=(-0.6, 0.3))
    if not h.far:
        h.cbox(5.5, 0.10, 0.10, (mx, h.fy - 0.40, wall - 0.10), 'Galvanised', rot=(0, -1.6, 0))      # the gutter, sagging


@style('bungalow')
def bungalow(h: House) -> None:
    """Wide and low, with a porch right across the front that sags like a sigh."""
    w, d, wall = h.w, h.d, 2.8
    h.body(w, d, wall, 0.0, 'SidingB', plinth='StoneLight', corners='Trim')
    ridge = h.roof_gable(w, d, wall, 24, axis='x', over=0.6, look='Shingle', gable='SidingB')
    x = h.spec.doors[0]
    h.door(x, 0.30, 1.0, 2.05, 'WoodDark')
    h.window_row('F', h.fy, (-w / 2 + 0.6, w / 2 - 0.6), 0.95, 5, 1.2, 1.2, skip=(1,), shutters='Siding', bars=1)
    h.window_row('B', d / 2, (-w / 2 + 0.6, w / 2 - 0.6), 0.95, 4, 1.1, 1.2, bars=1)
    for face, plane in (('L', w / 2), ('R', -w / 2)):
        h.window_row(face, plane, (-d / 2 + 0.8, d / 2 - 0.8), 0.95, 2, 1.1, 1.2, bars=1)
    h.window('L', 0.0, wall + 0.7, 0.8, 0.6, w / 2 - 0.02)                                     # attic vents in the gables
    h.window('R', 0.0, wall + 0.7, 0.8, 0.6, -w / 2 + 0.02)
    h.porch(-w / 2 + 0.2, w / 2 - 0.2, 2.0, 0.30, roof_z=2.5, deck='Planks', post='Trim', pitch=9, gap=(x - 0.8, x + 0.8))
    h.reach = h.steps(x, h.fy - 2.0, 0.30, 1.6, 'Planks')
    h.chimney(3.4, 0.4, wall + 0.4, ridge + 0.7)
    if not h.far:
        h.cbox(1.5, 0.5, 0.45, (4.3, h.fy - 1.3, 0.55), 'WoodDark')                              # a porch bench
        h.cbox(1.5, 0.08, 0.5, (4.3, h.fy - 1.05, 0.95), 'WoodDark')


# ─────────────────────────────────────────── L3 Rot Row ───────────────────────────────────────────

@style('townhouse')
def townhouse(h: House) -> None:
    """Tall, thin and terribly proper: three gothic storeys under a steep front gable, a crypt door, a bay."""
    w, d = h.w, h.d
    wall = 3 * STOREY
    h.body(w, d, wall, 0.0, 'Brick', plinth='Granite', corners='StoneLight')
    ridge = h.roof_gable(w, d, wall, 52, axis='y', over=0.35, look='Slate', gable='Brick')
    x = h.spec.doors[0]
    h.door(x, 0.55, 1.1, 2.3, 'WoodDark', frame='StoneLight', arch=True)
    for s in range(3):
        z = s * STOREY + 1.0
        for u in ((-2.1, 2.1) if s == 0 else (-2.1, 0.0, 2.1)):
            h.window('F', u, z, 0.8, 1.5, h.fy, frame='StoneLight', arch=True)
        h.window_row('L', w / 2, (-d / 2 + 1.0, d / 2 - 1.0), z, 4, 0.8, 1.5, frame='StoneLight', arch=True)
        h.window_row('R', -w / 2, (-d / 2 + 1.0, d / 2 - 1.0), z, 4, 0.8, 1.5, frame='StoneLight', arch=True)
        h.window_row('B', d / 2, (-w / 2 + 0.6, w / 2 - 0.6), z, 2, 0.8, 1.5, frame='StoneLight', arch=True)
        if not h.far and s > 0:
            h.cbox(w + 0.16, d + 0.16, 0.12, (0, 0, s * STOREY), 'StoneLight')                   # string courses
    h.window('F', 0.0, wall + 1.2, 0.9, 1.3, h.fy + 0.02, frame='StoneLight', arch=True)        # the gable window
    h.box(2.4, 1.3, 0.55, (x, h.fy - 0.65, 0.0), 'Granite')                                    # the stoop
    h.porch_depth = 1.3
    h.reach = h.steps(x, h.fy - 1.3, 0.55, 2.0, 'Granite')
    h.spire(0.0, h.fy + 0.3, ridge - 0.2, 0.3, 1.2, 'Iron')                                       # a finial on the gable
    h.chimney(-2.2, 3.0, wall + 1.5, ridge + 0.9, look='Brick')
    h.chimney(2.2, -3.0, wall + 1.5, ridge + 0.9, look='Brick')
    if not h.far:
        for s in (-1, 1):                                                                     # iron railings on the stoop
            h.m.add(S.tube([(x + s * 1.1, h.fy - 0.1, 1.45), (x + s * 1.1, h.fy - 1.25, 1.45), (x + s * 1.1, h.fy - 1.25, 0.55)], 0.03, 4), 'Iron')


@style('walkup')
def walkup(h: House) -> None:
    """A three-storey brick walk-up: stoop, cornice, a fire escape down the front, a water tank on the roof."""
    w, d = h.w, h.d
    wall = 3 * STOREY + 0.3
    h.body(w, d, wall, 0.0, 'Brick', plinth='Granite')
    top = h.roof_flat(w, d, wall, look='Slate', wall='Brick')
    x = h.spec.doors[0]
    h.door(x, 0.75, 1.2, 2.2, 'WoodDark', frame='StoneLight')
    for s in range(3):
        z = s * STOREY + 1.25
        skip = (2,) if s == 0 else ()
        h.window_row('F', h.fy, (-w / 2 + 0.5, w / 2 - 0.5), z, 5, 1.1, 1.5, skip=skip, frame='StoneLight', bars=1)
        h.window_row('B', d / 2, (-w / 2 + 0.5, w / 2 - 0.5), z, 4, 1.1, 1.5, frame='StoneLight', bars=1)
        for face, plane in (('L', w / 2), ('R', -w / 2)):
            h.window_row(face, plane, (-d / 2 + 0.8, d / 2 - 0.8), z, 3, 1.0, 1.5, frame='StoneLight', bars=1)
    h.box(w + 0.5, 0.45, 0.35, (0, h.fy - 0.05, wall - 0.2), 'StoneLight')                       # cornice
    h.box(3.0, 1.4, 0.75, (x, h.fy - 0.7, 0.0), 'Granite')                                     # stoop
    h.porch_depth = 1.4
    h.reach = h.steps(x, h.fy - 1.4, 0.75, 2.2, 'Granite')
    h.box(1.5, 1.5, 0.3, (3.6, 2.4, top - 0.08), 'Iron')                                       # water tank stand
    h.m.add(S.cylinder(0.85, 1.6, 8 if h.far else 12, 0.0, base=(3.6, 2.4, top + 0.2)), 'WoodDark')
    h.m.add(S.cone(0.95, 0.6, 8 if h.far else 12, base=(3.6, 2.4, top + 1.8)), 'Rust')
    if not h.far:                                                                             # the fire escape
        fx = -3.4
        for s in (1, 2):
            z = s * STOREY + 1.05
            h.cbox(2.6, 0.9, 0.06, (fx, h.fy - 0.48, z), 'Iron')
            for u in (-1.28, 1.28):
                h.cbox(0.05, 0.9, 0.95, (fx + u, h.fy - 0.48, z + 0.5), 'Iron')
            h.cbox(2.6, 0.05, 0.05, (fx, h.fy - 0.92, z + 0.95), 'Iron')
            h.cbox(2.6, 0.05, 0.05, (fx, h.fy - 0.92, z + 0.5), 'Iron')
            h.m.add(S.tube([(fx + 0.9, h.fy - 0.75, z - STOREY + 0.1 if s > 1 else 2.6), (fx - 0.6, h.fy - 0.75, z)], 0.035, 4), 'Iron')
        for s in (-1, 1):
            h.m.add(S.tube([(x + s * 1.3, h.fy - 0.1, 1.7), (x + s * 1.3, h.fy - 1.3, 1.7), (x + s * 1.3, h.fy - 1.3, 0.75)], 0.03, 4), 'Iron')


@style('loft')
def loft(h: House) -> None:
    """A two-storey brick warehouse turned loft: tall factory windows, a loading door, a sawtooth roof light."""
    w, d = h.w, h.d
    wall = 2 * 3.6
    h.body(w, d, wall, 0.0, 'Brick', plinth='Granite')
    top = h.roof_flat(w, d, wall, look='Slate', wall='Brick', parapet=0.7)
    x = h.spec.doors[0]
    h.door(x, 0.25, 1.3, 2.3, 'Iron', frame='StoneLight')
    h.cbox(3.2, 0.10, 3.0, (4.6, h.fy - 0.03, 1.75), 'Rust')                                    # the old loading door
    for s in range(2):
        z = s * 3.6 + 1.1
        skip = (2, 4, 5) if s == 0 else ()
        h.window_row('F', h.fy, (-w / 2 + 0.6, w / 2 - 0.6), z, 6, 1.7, 2.2, skip=skip, frame='StoneLight', bars=2)
        h.window_row('B', d / 2, (-w / 2 + 0.6, w / 2 - 0.6), z, 5, 1.7, 2.2, frame='StoneLight', bars=2)
        for face, plane in (('L', w / 2), ('R', -w / 2)):
            h.window_row(face, plane, (-d / 2 + 0.8, d / 2 - 0.8), z, 4, 1.7, 2.2, frame='StoneLight', bars=2)
    for k in range(3):                                                                        # sawtooth roof lights
        y = -3.6 + 3.6 * k
        h.cbox(w - 2.0, 2.6, 0.10, (0, y + 0.55, top + 0.55), 'Slate', rot=(-24, 0, 0))
        h.cbox(w - 2.0, 0.08, 1.15, (0, y - 0.62, top + 0.52), 'WindowDark')
    h.box(2.6, 1.2, 0.25, (x, h.fy - 0.6, 0.0), 'Granite')
    h.porch_depth = 1.2
    h.reach = h.steps(x, h.fy - 1.2, 0.25, 2.0, 'Granite')
    h.chimney(-6.5, 5.0, wall, top + 2.6, look='Brick', size=0.9)
    if not h.far:
        h.cbox(w + 0.3, 0.3, 0.25, (0, h.fy - 0.02, wall - 0.3), 'StoneLight')                    # cornice band
        h.m.add(S.tube([(4.6, h.fy - 0.1, 4.2), (4.6, h.fy - 1.3, 4.2)], 0.06, 5), 'Iron')         # hoist beam
        h.m.add(S.tube([(4.6, h.fy - 1.2, 4.2), (4.6, h.fy - 1.2, 3.4)], 0.015, 4), 'Iron')
        h.cbox(2.2, 0.06, 0.6, (-4.5, h.fy - 0.06, 3.3), 'Planks', rot=(0, 2, 0))                   # a faded sign board


# ─────────────────────────────────────────── L4 Bayou (on posts) ───────────────────────────────────────────

def _raised(h: House, w, d, wall, look, roof_pitch, axis, porch_depth, nx, ny, roof='Rust', gable=None):
    z0 = STOREY                                                          # the living storey is one storey up
    h.floor_z = z0
    h.stilts(w, d + porch_depth, z0, nx, ny, cy=-porch_depth / 2)
    h.box(w + 0.2, d + 0.2, 0.22, (0, 0, z0 - 0.22), 'Planks')
    h.body(w, d, wall, z0, look, corners='Trim')
    return h.roof_gable(w, d, z0 + wall, roof_pitch, axis=axis, over=0.55, look=roof, gable=gable or look), z0


@style('stilt_shack')
def stilt_shack(h: House) -> None:
    """A narrow shotgun shack on posts: gable to the street, a front porch, a long stair down."""
    w, d, wall = h.w, h.d, 2.6
    ridge, z0 = _raised(h, w, d, wall, 'Planks', 30, 'y', 1.8, 3, 4)
    x = h.spec.doors[0]
    h.door(x, z0, 0.95, 2.05, 'WoodDark')
    h.window('F', 1.6, z0 + 0.9, 1.0, 1.2, h.fy, shutters='PaintGreen', bars=1)
    h.window('F', 0.0, z0 + wall + 0.5, 0.7, 0.7, h.fy + 0.02)
    for face, plane in (('L', w / 2), ('R', -w / 2)):
        h.window_row(face, plane, (-d / 2 + 0.8, d / 2 - 0.8), z0 + 0.9, 3, 1.0, 1.2, shutters='PaintGreen', bars=1)
    h.window('B', 1.5, z0 + 0.9, 1.0, 1.2, d / 2, bars=1)
    h.door(-1.5, z0, 0.95, 2.05, 'WoodDark', plane=-(d / 2) + d + 0.06)                          # the back door
    h.porch(-w / 2, w / 2, 1.8, z0, roof_z=z0 + 2.35, deck='Planks', post='Pine', roof='Rust', pitch=10, gap=(1.6, 3.4))
    h.reach = h.steps(2.5, h.fy - 1.8, z0, 1.5, 'Pine', solid=False, rise=0.22, run=0.25)
    h.m.add(S.tube([(0.5, 2.0, ridge - 0.3), (0.5, 2.0, ridge + 0.9), (0.7, 2.0, ridge + 1.1)], 0.09, 4 if h.far else 6), 'Rust')   # stovepipe


@style('stilt_cottage')
def stilt_cottage(h: House) -> None:
    """A raised Acadian cottage: a steep roof that sweeps out over a full front gallery, two front doors."""
    w, d, wall = h.w, h.d, 2.7
    z0 = STOREY
    h.floor_z = z0
    gal = 2.4
    h.stilts(w, d + gal, z0, 5, 4, cy=-gal / 2)
    h.box(w + 0.2, d + 0.2, 0.22, (0, 0, z0 - 0.22), 'Planks')
    h.body(w, d, wall, z0, 'SidingC', corners='Trim')
    ridge = h.roof_gable(w, d, z0 + wall, 40, axis='x', over=0.5, look='Shingle', gable='SidingC')
    for x in h.spec.doors:
        h.door(x, z0, 1.0, 2.1, 'WoodDark')
    h.window_row('F', h.fy, (-w / 2 + 0.6, w / 2 - 0.6), z0 + 0.85, 5, 1.1, 1.3, skip=(0, 4), shutters='PaintGreen', bars=1)
    h.window_row('B', d / 2, (-w / 2 + 0.6, w / 2 - 0.6), z0 + 0.85, 4, 1.1, 1.3, shutters='PaintGreen', bars=1)
    for face, plane in (('L', w / 2), ('R', -w / 2)):
        h.window_row(face, plane, (-d / 2 + 0.8, d / 2 - 0.8), z0 + 0.85, 2, 1.1, 1.3, shutters='PaintGreen', bars=1)
        h.window(face, 0.0, z0 + wall + 1.0, 0.8, 1.0, plane - (0.02 if face == 'L' else -0.02))     # attic windows
    h.porch(-w / 2, w / 2, gal, z0, roof_z=z0 + wall - 0.25, deck='Planks', post='Trim', roof='Shingle', pitch=16, gap=(-0.9, 0.9))
    h.reach = h.steps(0.0, h.fy - gal, z0, 1.8, 'Pine', solid=False, rise=0.22, run=0.25)
    h.chimney(0.0, 0.3, z0 + wall + 2.6, ridge + 1.0, look='Brick')
    if not h.far:                                                                             # the outside stair to the attic
        h.m.add(S.tube([(w / 2 - 0.5, h.fy - 0.3, z0 + 0.1), (w / 2 - 0.5, h.fy - 2.0, z0 + wall - 0.4)], 0.05, 4), 'Pine')


@style('stilt_manor')
def stilt_manor(h: House) -> None:
    """The fish camp: the biggest house on the bend, a deck all round, a tin roof and a side dock."""
    w, d, wall = h.w, h.d, 2.8
    z0 = STOREY
    h.floor_z = z0
    deck = 1.6
    h.stilts(w + 2 * deck - 0.4, d + 2 * deck - 0.4, z0, 6, 5)
    h.box(w + 2 * deck, d + 2 * deck, 0.22, (0, 0, z0 - 0.22), 'Planks')                        # the wrap-around deck
    bw, bd = w, d                                                                             # the camp on its walls; the deck wraps outside
    h.body(bw, bd, wall, z0, 'Planks', corners='WoodDark')
    ridge = h.roof_gable(bw, bd, z0 + wall, 22, axis='x', over=1.5, look='Galvanised', gable='Planks')
    x = h.spec.doors[0]
    fy = -bd / 2
    h.door(x, z0, 1.1, 2.1, 'WoodDark', plane=fy)
    h.window_row('F', fy, (-bw / 2 + 0.6, bw / 2 - 0.6), z0 + 0.85, 6, 1.2, 1.3, skip=(1,), shutters='PaintGreen', bars=1)
    h.window_row('B', bd / 2, (-bw / 2 + 0.6, bw / 2 - 0.6), z0 + 0.85, 5, 1.2, 1.3, bars=1)
    for face, plane in (('L', bw / 2), ('R', -bw / 2)):
        h.window_row(face, plane, (-bd / 2 + 0.8, bd / 2 - 0.8), z0 + 0.85, 4, 1.2, 1.3, bars=1)
    edge_y = -d / 2 - deck
    if not h.far:                                                                             # deck rail, open at the stair
        n = 9
        for i in range(n):
            xa = -w / 2 - deck + 0.1 + (w + 2 * deck - 0.2) * i / (n - 1)
            h.box(0.12, 0.12, 1.0, (xa, edge_y + 0.1, z0), 'Pine')
            if i and not (-1.2 < xa - (w + 2 * deck - 0.2) / (n - 1) / 2 < 1.2):
                xb = -w / 2 - deck + 0.1 + (w + 2 * deck - 0.2) * (i - 1) / (n - 1)
                h.m.add(S.tube([(xb, edge_y + 0.1, z0 + 0.92), (xa, edge_y + 0.1, z0 + 0.92)], 0.03, 4), 'Pine')
    h.porch_depth = deck + 1.0
    h.fy = -d / 2 - deck + 1.0                                                                 # the porch frame sits on the deck edge
    h.reach = h.steps(0.0, edge_y, z0, 2.0, 'Pine', solid=False, rise=0.22, run=0.25)
    h.fy = -d / 2
    h.chimney(-3.0, 0.5, z0 + wall + 1.2, ridge + 0.9, look='Rust', size=0.4)
    if not h.far:
        h.cbox(2.4, 0.06, 0.7, (2.5, fy - 0.07, z0 + 2.45), 'Planks', rot=(0, -2, 0))             # the camp sign


# ─────────────────────────────────────────── L5 Mausoleum Hills ───────────────────────────────────────────

@style('mansard')
def mansard(h: House) -> None:
    """Mansard Manor: two tall storeys under a slate mansard with dormers, a columned portico."""
    w, d = h.w, h.d
    wall = 2 * 3.3
    h.body(w, d, wall, 0.0, 'StoneLight', plinth='Granite', corners='Granite')
    top = h.roof_mansard(w, d, wall, 2.4, 1.5, 'Slate')
    x = h.spec.doors[0]
    h.door(x, 0.75, 1.9, 2.6, 'WoodDark', frame='Granite')
    for s in range(2):
        z = s * 3.3 + 1.3
        skip = (3,) if s == 0 else ()
        h.window_row('F', h.fy, (-w / 2 + 0.6, w / 2 - 0.6), z, 7, 1.2, 1.9, skip=skip, frame='Granite', bars=1)
        h.window_row('B', d / 2, (-w / 2 + 0.6, w / 2 - 0.6), z, 6, 1.2, 1.9, frame='Granite', bars=1)
        for face, plane in (('L', w / 2), ('R', -w / 2)):
            h.window_row(face, plane, (-d / 2 + 0.8, d / 2 - 0.8), z, 5, 1.2, 1.9, frame='Granite', bars=1)
    h.box(w + 0.6, d + 0.6, 0.30, (0, 0, wall - 0.3), 'Granite')                                # cornice
    for u in (-6.0, -3.0, 0.0, 3.0, 6.0):                                                       # dormers on the front
        h.box(1.3, 1.2, 1.5, (u, h.fy + 0.75, wall + 0.25), 'Slate')
        h.window('F', u, wall + 0.55, 0.8, 1.0, h.fy + 0.15, frame='StoneLight')
    # portico: four columns, a pediment, wide steps
    h.box(6.4, 2.6, 0.75, (x, h.fy - 1.3, 0.0), 'Granite')
    for u in (-2.7, -0.95, 0.95, 2.7):
        h.m.add(S.cylinder(0.24, 3.6, 6 if h.far else 10, 0.0, base=(x + u, h.fy - 2.2, 0.75)), 'Marble')
    h.box(6.6, 2.8, 0.35, (x, h.fy - 1.3, 4.35), 'Granite')
    h.m.add(S.taper_box(6.6, 2.8, 0.1, 2.8, 1.1, 0.0, 0, base=(x, h.fy - 1.3, 4.7)), 'StoneLight')
    h.porch_depth = 2.6
    h.reach = h.steps(x, h.fy - 2.6, 0.75, 5.6, 'Granite')
    for u in (-5.5, 5.5):
        h.chimney(u, 0.0, wall + 1.0, top + 1.5, look='StoneLight', size=0.9)
    if not h.far:
        for s in (-1, 1):
            h.m.add(S.sphere(0.3, 8, 5, loc=(x + s * 3.0, h.fy - 2.45, 1.05)), 'Granite')         # stone balls by the steps


@style('ravenspire')
def ravenspire(h: House) -> None:
    """Ravenspire Hall: a gothic hall with two gabled wings and a tower and spire over the door."""
    w, d = h.w, h.d
    wall = 2 * 3.4
    h.body(w, d, wall, 0.0, 'Granite', plinth='Slate')
    h.roof_gable(w, d, wall, 42, axis='x', over=0.4, look='Slate', gable='Granite')
    x = h.spec.doors[0]
    tw = 5.0
    for sx in (-1, 1):                                                                        # the wings: gables to the street
        cx = sx * (w / 2 - 3.2)
        h.body(6.4, 1.4, wall, 0.0, 'Granite', cx=cx, cy=h.fy - 0.7 + 0.05, plinth='Slate')
        h.roof_gable(6.4, 1.4 + d / 2, wall, 48, axis='y', over=0.35, look='Slate', gable='Granite', cx=cx, cy=h.fy - 0.7 + d / 4 + 0.05)
        for s in range(2):
            h.window_row('F', h.fy - 1.4 + 0.05, (cx - 2.6, cx + 2.6), s * 3.4 + 1.2, 2, 1.0, 2.0, frame='StoneLight', arch=True)
        h.window('F', cx, wall + 1.0, 1.0, 1.8, h.fy - 1.4 + 0.07, frame='StoneLight', arch=True)
    # the tower over the door
    th = wall + 5.2
    tcy = h.fy + 1.0                                                                          # the tower stands 1.5 m proud of the hall
    h.body(tw, tw, th, 0.0, 'Granite', cx=x, cy=tcy, plinth='Slate', corners='StoneLight')
    tip = h.spire(x, tcy, th, tw, 6.2, 'Slate')
    front = tcy - tw / 2
    h.door(x, 0.75, 1.9, 2.8, 'WoodDark', frame='StoneLight', arch=True, plane=front)
    for z in (5.0, 8.4, th - 2.6):
        h.window('F', x, z, 1.1, 2.0, front, frame='StoneLight', arch=True)
        for face, plane in (('L', x + tw / 2), ('R', x - tw / 2)):
            if z > wall:
                h.window(face, tcy, z, 1.1, 2.0, plane, frame='StoneLight', arch=True)
    if not h.far:
        for sx in (-1, 1):
            for sy in (-1, 1):                                                                # pinnacles on the tower
                h.spire(x + sx * (tw / 2 - 0.25), tcy + sy * (tw / 2 - 0.25), th, 0.35, 1.6, 'StoneLight')
    for s in range(2):
        z = s * 3.4 + 1.2
        h.window_row('B', d / 2, (-w / 2 + 0.8, w / 2 - 0.8), z, 8, 1.0, 2.0, frame='StoneLight', arch=True)
        for face, plane in (('L', w / 2), ('R', -w / 2)):
            h.window_row(face, plane, (-d / 2 + 0.8, d / 2 - 0.8), z, 4, 1.0, 2.0, frame='StoneLight', arch=True)
        h.window_row('F', h.fy, (x - tw / 2 - 5.0, x - tw / 2 - 0.4), z, 2, 1.0, 2.0, frame='StoneLight', arch=True)
        h.window_row('F', h.fy, (x + tw / 2 + 0.4, x + tw / 2 + 5.0), z, 2, 1.0, 2.0, frame='StoneLight', arch=True)
    h.box(4.4, 1.8, 0.75, (x, front - 0.9, 0.0), 'Slate')
    h.fy = front                                                                              # the door is on the tower's face
    h.porch_depth = 1.8
    h.reach = h.steps(x, front - 1.8, 0.75, 3.8, 'Slate')
    for u in (-8.0, 8.5):
        h.chimney(u, 2.5, wall + 2.0, wall + 8.2, look='Granite', size=0.8)
    h.tip = tip


@style('glass')
def glass(h: House) -> None:
    """The Glass Mausoleum: a marble plinth and colonnade holding dark glass walls under a glass vault."""
    w, d = h.w, h.d
    plinth, wall = 0.9, 5.2
    h.box(w + 1.2, d + 1.2, plinth, (0, 0, 0.0), 'Marble')
    h.floor_z = plinth
    h.body(w - 0.6, d - 0.6, wall, plinth, 'WindowDark')                                        # the glass box
    nx, ny = (6, 4) if h.far else (11, 8)
    for i in range(nx):                                                                       # the colonnade
        u = -w / 2 + 0.15 + (w - 0.3) * i / (nx - 1)
        for sy in (-1, 1):
            h.box(0.5, 0.5, wall, (u, sy * (d / 2 - 0.15), plinth), 'Marble')
    for k in range(1, ny - 1):
        v = -d / 2 + 0.15 + (d - 0.3) * k / (ny - 1)
        for sx in (-1, 1):
            h.box(0.5, 0.5, wall, (sx * (w / 2 - 0.15), v, plinth), 'Marble')
    h.box(w + 0.5, d + 0.5, 0.6, (0, 0, plinth + wall), 'Marble')                                # entablature
    z = plinth + wall + 0.6
    segs = 5 if h.far else 9
    r = d / 2 - 0.6                                                                           # a barrel vault along X, faceted
    for i in range(segs):
        a0, a1 = math.pi * i / segs, math.pi * (i + 1) / segs
        y0, z0, y1, z1 = -r * math.cos(a0), r * 0.42 * math.sin(a0), -r * math.cos(a1), r * 0.42 * math.sin(a1)
        length = math.hypot(y1 - y0, z1 - z0)
        ang = math.degrees(math.atan2(z1 - z0, y1 - y0))
        h.cbox(w - 1.0, length + 0.02, 0.08, (0, (y0 + y1) / 2, z + (z0 + z1) / 2), 'WindowDark', rot=(ang, 0, 0))
        if not h.far:
            h.cbox(w - 0.9, 0.10, 0.12, (0, y0, z + z0 + 0.02), 'Verdigris')                      # iron ribs between panes
    for sx in (-1, 1):                                                                        # the vault's glass ends
        h.m.add(S.taper_box(0.08, 2 * r, 0.08, 0.3, r * 0.42, 0.0, 0, base=(sx * (w / 2 - 0.55), 0, z)), 'WindowDark')
    x = h.spec.doors[0]
    h.door(x, plinth, 2.0, 3.2, 'Verdigris', frame='Marble', plane=h.fy + 0.3)
    h.porch_depth = 0.6
    h.reach = h.steps(x, h.fy - 0.6, plinth, 4.6, 'Marble')
    if not h.far:
        for s in (-1, 1):                                                                     # urns flanking the door
            h.m.add(S.lathe([(0.0, 0.0), (0.22, 0.0), (0.16, 0.25), (0.34, 0.7), (0.26, 0.95), (0.3, 1.0), (0.0, 1.0)], 8,
                            base=(x + s * 2.9, h.fy - 0.35, plinth)), 'Verdigris')
        h.cbox(w + 0.5, 0.12, 0.25, (0, h.fy - 0.25, plinth + wall + 0.3), 'Verdigris')           # a bronze band over the door
