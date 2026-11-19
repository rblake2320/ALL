"""Builders for the structures kit. Geometry is in Blender axes (front = -Y), built from tools/blender/common.

Stairs/ramps: the run goes from Blender y = +run/2 (bottom, on the floor) to y = -run/2 (top, one storey up).
Each material tier has its own construction, not a recolour: wood is open carpentry, stone ("Bonecrete") is a
solid stepped block with parapets, metal is thin treads on a spine with wrought-iron scrollwork.
"""
from __future__ import annotations

import math
from typing import Callable, Dict

import bmesh
from mathutils import Vector

import manifest_meta as meta
from common import shapes as S
from common.model import Model

from .specs import STOREY_HEIGHT, WALL_HEIGHT, StructSpec

BuilderFn = Callable[[Model, StructSpec], None]
BUILDERS: Dict[str, BuilderFn] = {}
STEPS = 13
#: level of detail being built (set by the driver): 0 = full, 1 = far. LOD1 is authored, not decimated: the same
#: silhouette and walking surface with no bevels, fewer tube sides and none of the small trim.
LOD = 0
#: rails and parapets sit this far inside the tile edge, so two pieces side by side keep a gap between rails
RAIL_INSET = 0.050


def _bv(w: float) -> float:
    return w if LOD == 0 else 0.0


def _bs(n: int) -> int:
    return n if LOD == 0 else 0

LOOK = {
    # material: (tread, structure, rail, accent)
    'wood': ('Wood', 'WoodDark', 'WoodLight', 'Brass'),
    'stone': ('StoneLight', 'Granite', 'Granite', 'Bone'),
    'metal': ('Steel', 'Iron', 'Iron', 'Rust'),
}


def builder(*ids: str):
    def deco(fn: BuilderFn) -> BuilderFn:
        for i in ids:
            BUILDERS[i] = fn
        return fn

    return deco


def along_x(bm):
    """A profile built with S.prism(plane='XZ') is extruded along Y; turn it so the profile's u runs along -Y
    (bottom of the run at +Y) and the extrusion runs along X."""
    return S.rotate(bm, (0, 0, 90))


def step_profile(run: float, rise: float, steps: int, floor_cut: float = 0.0):
    """Stepped side silhouette, u = distance climbed along the run (0..run), v = height. CCW."""
    tread, riser = run / steps, rise / steps
    pts = [(0.0, 0.0)]
    for i in range(steps):
        pts.append((i * tread, (i + 1) * riser))
        pts.append(((i + 1) * tread, (i + 1) * riser))
    pts.append((run, floor_cut))
    return pts[::-1]


def climb_frames(run: float, rise: float) -> None:
    """Where a character steps on at the bottom and off at the top: half a tile outside each end of the run."""
    meta.add_frame('bottom', (0.0, run / 2 + 0.5, 0.0), 0.0, 'approach')
    meta.add_frame('top', (0.0, -run / 2 - 0.5, rise), 0.0, 'exit')


def place_run(bm, run: float):
    """Map profile u in [0, run] to Blender y in [+run/2, -run/2] (climbing toward -Y)."""
    along_x(bm)                     # u -> +Y
    S.xf(bm, scale=(1, -1, 1))      # u -> -Y (a mirror: fix the winding afterwards)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return S.translate(bm, (0, run / 2, 0))


def rail(m: Model, x: float, run: float, rise: float, look: str, accent: str, posts: int, crooked: bool,
         scroll: bool = False) -> None:
    """Handrail 0.9 m above the nosing line, with posts; `scroll` adds wrought-iron curls between posts."""
    def at(t: float, h: float = 0.0):
        t = 0.03 + 0.94 * t           # keep posts and caps inside the footprint
        return (x, run / 2 - t * run, t * rise + h)

    far = LOD > 0
    if far:
        scroll, posts = False, max(2, posts - 2)
    m.add(S.tube([at(0.0, 0.95), at(1.0, 0.95)], 0.024, 3 if far else 5), look)
    for i in range(posts):
        t = (i + 0.5) / posts if posts > 2 else i / max(1, posts - 1)
        lean = 0.035 if (crooked and i == 1) else 0.0
        b, top = at(t, 0.02), at(t, 0.95)
        m.add(S.tube([b, (top[0], top[1] + lean, top[2])], 0.018, 3 if far else 4), look)
        if scroll and i < posts - 1:
            t2 = t + 0.5 / posts
            c = at(t2, 0.50)
            pts = S.spiral(0.13, 0.03, 1.25, 9, center=(0, 0, 0))
            m.add(S.tube([(x, c[1] + p.x, c[2] + p.z) for p in pts], 0.009, 4), look)
    for t, r in ((0.0, 0.06), (1.0, 0.06)):
        b = at(t, 0.0)
        m.add(S.box(0.040, 0.08, 1.05, _bv(0.008), _bs(1), base=(x, b[1], b[2])), look)
        if not far:
            m.add(S.sphere(0.024, 8, 5, loc=(x, b[1], b[2] + 1.075)), accent)


@builder('qb_stairs_wood', 'qb_stairs_stone', 'qb_stairs_metal',
         'qb_grandstairs_wood', 'qb_grandstairs_stone', 'qb_grandstairs_metal')
def stairs(m: Model, spec: StructSpec) -> None:
    tread_l, struct_l, rail_l, accent = LOOK[spec.material]
    run, rise, W = spec.d, spec.rise, spec.w
    climb_frames(run, rise)
    grand = spec.kind == 'grandStairs'
    inner = W - 0.16                 # walkable width between the rails
    tr, rs = run / STEPS, rise / STEPS
    if spec.material == 'stone':
        body = S.prism(step_profile(run, rise, STEPS), inner, 0.0, 0)
        m.add(place_run(body, run), struct_l)
        for i in range(STEPS if LOD == 0 else 0):                      # lighter worn tread caps
            m.add(S.box(inner - 0.04, tr * 0.96, 0.03, 0.008, 1, loc=(0, run / 2 - (i + 0.5) * tr, (i + 1) * rs + 0.012)), tread_l)
        for sx in (-1, 1):                                             # parapets
            wall = S.prism([(0, 0), (run, 0), (run, rise + 0.55), (run - 0.25, rise + 0.55), (0, 0.55)], 0.04, _bv(0.008), _bs(1))
            m.add(S.translate(place_run(wall, run), (sx * (W / 2 - RAIL_INSET), 0, 0)), struct_l)
            for y, z in ((run / 2 - 0.06, 0.585), (-run / 2 + 0.06, rise + 0.585)) if LOD == 0 else ():
                m.add(S.sphere(0.024, 8, 5, loc=(sx * (W / 2 - RAIL_INSET), y, z)), accent)
        return
    thick = 0.045 if spec.material == 'wood' else 0.022
    for i in range(STEPS):
        y, z = run / 2 - (i + 0.5) * tr, (i + 1) * rs
        skew = 1.5 if (spec.material == 'wood' and i == 5) else 0.0     # one loose tread
        m.add(S.box(inner, tr * (0.98 if spec.material == 'wood' else 0.86), thick, _bv(0.01), _bs(1),
                    loc=(0, y, z - thick / 2), rot=(0, skew, 0)), tread_l)
    slope = math.degrees(math.atan2(rise, run))
    length = math.hypot(run, rise)
    if spec.material == 'wood':
        for sx in (-1, 1):                                             # stringers
            m.add(S.box(0.06, length - 0.30, 0.24, _bv(0.012), _bs(1), loc=(sx * (inner / 2 - 0.03), 0, rise / 2 - 0.08), rot=(-slope, 0, 0)), struct_l)
        if grand:
            m.add(S.box(0.06, length - 0.30, 0.24, 0.012, 1, loc=(0, 0, rise / 2 - 0.08), rot=(-slope, 0, 0)), struct_l)
        for y, h in ((-run / 2 + 0.10, rise - 0.10),):                 # support posts under the top
            for sx in (-1, 1):
                m.add(S.box(0.10, 0.10, h, 0.012, 1, base=(sx * (inner / 2 - 0.06), y, 0)), struct_l)
    else:                                                              # metal: a spine beam + brackets
        spines = (-0.9, 0.9) if grand else (0.0,)
        for x in spines:
            m.add(S.box(0.08, length - 0.30, 0.14, 0.012, 1, loc=(x, 0, rise / 2 - 0.12), rot=(-slope, 0, 0)), struct_l)
            m.add(S.box(0.12, 0.12, rise - 0.2, 0.012, 1, base=(x, -run / 2 + 0.10, 0)), struct_l)
        for i in range(0, STEPS if LOD == 0 else 0, 2):
            y, z = run / 2 - (i + 0.5) * tr, (i + 1) * rs
            m.add(S.box(inner - 0.1, 0.03, 0.05, 0.0, 0, loc=(0, y, z - thick - 0.03)), accent)
    for sx in (-1, 1):
        rail(m, sx * (W / 2 - RAIL_INSET), run, rise, rail_l, accent, 5 if grand else 4, crooked=spec.material == 'wood',
             scroll=spec.material == 'metal')


@builder('qb_ramp_wood', 'qb_ramp_stone', 'qb_ramp_metal',
         'qb_ramp_narrow_wood', 'qb_ramp_narrow_stone', 'qb_ramp_narrow_metal')
def ramp(m: Model, spec: StructSpec) -> None:
    tread_l, struct_l, rail_l, accent = LOOK[spec.material]
    run, rise, W = spec.d, spec.rise, spec.w
    climb_frames(run, rise)
    inner = W - 0.16
    t = 0.10 if spec.material != 'metal' else 0.05
    if spec.material == 'stone':
        body = S.prism([(0, 0), (run, 0), (run, rise), (0, 0.0)][::-1], inner, 0.0, 0)
        m.add(place_run(body, run), struct_l)
        deck = S.prism([(0, 0.0), (run, rise), (run, rise + 0.02), (0, 0.02)], inner - 0.04, 0.0, 0)
        m.add(place_run(deck, run), tread_l)
    else:
        deck = S.prism([(0, -t), (run, rise - t), (run, rise), (0, 0.0)], inner, 0.0, 0)
        m.add(place_run(deck, run), tread_l)
        slope = math.degrees(math.atan2(rise, run))
        length = math.hypot(run, rise)
        xs = (-inner / 2 + 0.05, inner / 2 - 0.05) if W > 1 else (0.0,)
        for x in xs:
            m.add(S.box(0.08, length - 0.34, 0.16, 0.012, 1, loc=(x, 0, rise / 2 - t - 0.08), rot=(-slope, 0, 0)), struct_l)
        for k in (1, 2, 3):                                            # trestle legs
            y, h = run / 2 - k * run / 3 + 0.08, k * rise / 3 - t - 0.14
            for x in xs:
                m.add(S.box(0.09, 0.09, max(0.1, h), 0.012, 1, base=(x, y, 0)), struct_l)
        cleats = 8 if (spec.material == 'wood' and LOD == 0) else 0
        for i in range(cleats):                                        # anti-slip cleats on the planks
            u = (i + 0.5) / cleats
            m.add(S.box(inner - 0.06, 0.04, 0.018, 0.0, 0, loc=(0, run / 2 - u * run, u * rise + 0.009), rot=(-slope, 0, 0)), struct_l)
    for sx in (-1, 1):                                                 # curbs and a low rail on each side
        x = sx * (W / 2 - RAIL_INSET)
        e = 0.07 / run
        sides = 5 if LOD == 0 else 3
        m.add(S.tube([(x, run / 2 - e * run, e * rise + 0.14), (x, -run / 2 + e * run, (1 - e) * rise + 0.14)], 0.024, sides), rail_l)
        m.add(S.tube([(x, run / 2 - e * run, e * rise + 0.95), (x, -run / 2 + e * run, (1 - e) * rise + 0.95)], 0.024, sides), rail_l)
        for k in (range(4) if LOD == 0 else (0, 3)):
            u = e + (1 - 2 * e) * k / 3
            m.add(S.tube([(x, run / 2 - u * run, u * rise + 0.02), (x, run / 2 - u * run, u * rise + 0.95)], 0.018, 4 if LOD == 0 else 3), rail_l)
        if LOD == 0:
            m.add(S.sphere(0.024, 8, 5, loc=(x, run / 2 - 0.07, 0.07 / run * rise + 0.99)), accent)


@builder('qb_pillar_wood', 'qb_pillar_stone', 'qb_pillar_metal')
def pillar(m: Model, spec: StructSpec) -> None:
    _, struct_l, rail_l, accent = LOOK[spec.material]
    H = WALL_HEIGHT
    if spec.material == 'wood':
        post = S.box(0.30, 0.30, H - 0.24, _bv(0.02), _bs(1), base=(0, 0, 0.12))
        m.add(S.rotate(post, (0, 0, 2)), struct_l)                      # a little twisted
        m.add(S.box(0.35, 0.35, 0.12, _bv(0.02), _bs(1), base=(0, 0, 0)), 'Wood')
        m.add(S.box(0.35, 0.35, 0.12, _bv(0.02), _bs(1), base=(0, 0, H - 0.12)), 'Wood')
        for z in ((0.55, H - 0.55) if LOD == 0 else ()):               # iron straps
            m.add(S.box(0.325, 0.325, 0.05, 0.0, 0, loc=(0, 0, z), rot=(0, 0, 2)), 'Iron')
    elif spec.material == 'stone':
        prof = [(0.175, 0.0), (0.175, 0.14), (0.14, 0.20), (0.125, 0.30), (0.118, H - 0.34), (0.14, H - 0.24),
                (0.175, H - 0.16), (0.175, H)]
        m.add(S.lathe(prof, 12 if LOD == 0 else 8), struct_l)
        for z in ((0.24, H - 0.29) if LOD == 0 else ()):
            m.add(S.torus(0.135, 0.022, 12, 3, loc=(0, 0, z)), accent)   # bone-white collars
    else:
        m.add(S.box(0.35, 0.35, 0.06, 0.01, 1, base=(0, 0, 0)), struct_l)
        m.add(S.box(0.35, 0.35, 0.06, 0.01, 1, base=(0, 0, H - 0.06)), struct_l)
        m.add(S.box(0.26, 0.035, H - 0.12, 0.0, 0, base=(0, 0, 0.06)), struct_l)      # I-beam web
        m.add(S.box(0.035, 0.26, H - 0.12, 0.0, 0, base=(0, 0, 0.06)), struct_l)       # I-beam flange
        for sy in ((-1, 1) if LOD == 0 else ()):
            for z in (0.35, 1.35, 2.35):
                m.add(S.box(0.035, 0.012, 0.035, 0.0, 0, loc=(0.10 * sy, -0.022, z), rot=(0, 45, 0)), accent)   # rivet plates
        for z in ((0.55, H - 0.55) if LOD == 0 else ()):
            m.add(S.torus(0.16, 0.014, 10, 3, loc=(0, 0, z)), rail_l)


@builder('qb_stairwell_rail_wood', 'qb_stairwell_rail_stone', 'qb_stairwell_rail_metal')
def stairwell_rail(m: Model, spec: StructSpec) -> None:
    """Guard for one open edge of a stairwell: a 0.9 m railing one tile long, centred on the tile edge (y = 0),
    posts inset from the ends so neighbouring pieces do not double them."""
    _, struct_l, rail_l, accent = LOOK[spec.material]
    H, sides = 0.90, (5 if LOD == 0 else 3)
    if spec.material == 'stone':                                         # a low parapet with a cap
        m.add(S.box(0.96, 0.10, H - 0.05, _bv(0.012), _bs(1), base=(0, 0, 0)), struct_l)
        m.add(S.box(0.99, 0.14, 0.05, _bv(0.012), _bs(1), base=(0, 0, H - 0.05)), LOOK['stone'][0])
        for x in ((-0.30, 0.0, 0.30) if LOD == 0 else ()):                 # blind arches cut as dark insets
            m.add(S.box(0.16, 0.012, 0.46, 0.0, 0, loc=(x, -0.052, 0.42)), 'Black')
        return
    posts = (-0.40, 0.0, 0.40) if LOD == 0 else (-0.40, 0.40)
    for i, x in enumerate(posts):
        m.add(S.box(0.05, 0.05, H, 0.0, 0, base=(x, 0, 0), rot=(0, 1.5 if (spec.material == 'wood' and i == 1) else 0, 0)), rail_l)
        if LOD == 0:
            m.add(S.sphere(0.03, 6, 3, loc=(x, 0, H + 0.025)), accent)
    m.add(S.tube([(-0.49, 0, H - 0.03), (0.49, 0, H - 0.03)], 0.024, sides), rail_l)          # top rail
    m.add(S.tube([(-0.49, 0, 0.12), (0.49, 0, 0.12)], 0.018, sides), rail_l)               # bottom rail
    if spec.material == 'wood':
        for k in range(8 if LOD == 0 else 4):                              # slats
            x = -0.42 + 0.84 * (k + 0.5) / (8 if LOD == 0 else 4)
            m.add(S.box(0.03, 0.02, H - 0.17, 0.0, 0, base=(x, 0, 0.13)), LOOK['wood'][0])
    elif LOD == 0:                                                         # metal: wrought curls
        for x in (-0.20, 0.20):
            pts = S.spiral(0.13, 0.03, 1.25, 9, center=(0, 0, 0))
            m.add(S.tube([(x + p.x, 0, 0.50 + p.z) for p in pts], 0.009, 3), rail_l)
    else:
        m.add(S.tube([(-0.49, 0, 0.50), (0.49, 0, 0.50)], 0.014, 3), rail_l)


@builder('qb_landing_wood', 'qb_landing_stone', 'qb_landing_metal')
def landing(m: Model, spec: StructSpec) -> None:
    """A one-tile platform at storey height on its own legs: where a stair can exit when there is no slab."""
    tread_l, struct_l, rail_l, accent = LOOK[spec.material]
    H, t = spec.height, 0.20                                             # slab thickness (FLOOR_SLAB)
    m.add(S.box(0.98, 0.98, t if spec.material == 'stone' else 0.06, _bv(0.012), _bs(1), base=(0, 0, H - (t if spec.material == 'stone' else 0.06))), tread_l)
    if spec.material == 'stone':
        for sx in (-1, 1):                                               # two piers with a corbel
            m.add(S.box(0.22, 0.90, H - t, _bv(0.015), _bs(1), base=(sx * 0.34, 0, 0)), struct_l)
            m.add(S.box(0.30, 0.94, 0.10, _bv(0.012), _bs(1), base=(sx * 0.34, 0, H - t - 0.10)), struct_l)
    else:
        for sx in (-1, 1):
            for sy in (-1, 1):
                m.add(S.box(0.10, 0.10, H - 0.06, _bv(0.012), _bs(1), base=(sx * 0.40, sy * 0.40, 0)), struct_l)
            m.add(S.box(0.08, 0.92, 0.14, 0.0, 0, base=(sx * 0.40, 0, H - 0.20)), struct_l)       # beams under the deck
        for sy in (-1, 1):
            m.add(S.box(0.92, 0.06, 0.12, 0.0, 0, base=(0, sy * 0.40, H - 0.19)), struct_l)
            if LOD == 0:                                                 # knee braces
                for sx in (-1, 1):
                    m.add(S.tube([(sx * 0.40, sy * 0.40, H - 0.75), (sx * 0.10, sy * 0.40, H - 0.14)], 0.022, 4), rail_l)
        if LOD == 0 and spec.material == 'wood':
            for k in range(1, 5):                                        # plank seams
                m.add(S.box(0.012, 0.96, 0.004, 0.0, 0, loc=(-0.49 + 0.196 * k, 0, H + 0.001)), struct_l)
    meta.add_frame('top', (0.0, 0.0, H), 0.0, 'feet')


# ---------------------------------------------------------------------------------------------------
# Parking (docs/systems/vehicles.md §5)
# ---------------------------------------------------------------------------------------------------

@builder('pad_driveway')
def pad_driveway(m: Model, spec: StructSpec) -> None:
    m.add(S.box(1.96, 4.96, 0.03, 0.012, 1, base=(0, 0, 0)), 'StoneLight')
    for (x, y, sx, sy, rot) in ((-0.3, 1.2, 1.1, 0.03, 24), (0.25, 0.9, 0.7, 0.03, -38), (0.4, -1.3, 1.2, 0.03, 12),
                                (-0.45, -1.7, 0.6, 0.03, -52)):
        m.add(S.box(sx, sy, 0.004, 0.0, 0, loc=(x, y, 0.032), rot=(0, 0, rot)), 'Crack')
    m.add(S.cylinder(0.34, 0.004, 10, 0.0, base=(0.15, 0.2, 0.030)), 'Smudge')           # the oil stain
    for (x, y, seed) in ((-0.82, 2.2, 1), (0.86, -0.4, 2), (-0.88, -2.1, 3)):
        m.add(S.grass_tuft(0.07, 0.10, 4, base=(x, y, 0.03), seed=seed), 'GrassDry')


@builder('pad_garage')
def pad_garage(m: Model, spec: StructSpec) -> None:
    m.add(S.box(2.96, 5.96, 0.012, 0.0, 0, base=(0, 0, 0)), 'Granite')
    for x in (-1.3, 1.3):
        m.add(S.box(0.07, 5.2, 0.004, 0.0, 0, loc=(x, 0, 0.014)), 'Bone')
    m.add(S.box(2.67, 0.07, 0.004, 0.0, 0, loc=(0, 2.6, 0.014)), 'Bone')
    m.add(S.cylinder(0.30, 0.004, 8, 0.0, base=(0.2, -0.3, 0.012)), 'Smudge')


@builder('rack_bike')
def rack_bike(m: Model, spec: StructSpec) -> None:
    for sx in (-1, 1):
        m.add(S.tube([(sx * 0.32, 0.92, 0.035), (sx * 0.32, -0.92, 0.035)], 0.028, 5), 'Galvanised')
        m.add(S.box(0.10, 1.90, 0.014, 0.0, 0, base=(sx * 0.32, 0, 0)), 'Galvanised')
    for i, y in enumerate((-0.66, -0.22, 0.22, 0.66)):
        lean = 0.10 if i == 2 else 0.0                                 # somebody backed into this one
        pts = [(-0.32, y, 0.035), (-0.30, y + lean * 0.3, 0.55), (-0.16, y + lean, 0.78), (0.16, y + lean, 0.78),
               (0.30, y + lean * 0.3, 0.55), (0.32, y, 0.035)]
        m.add(S.tube(pts, 0.022, 5), 'Galvanised')
    m.add(S.box(0.16, 0.012, 0.10, 0.0, 0, loc=(0, -0.93, 0.50)), 'Bone')                # "2 small" sign
    m.add(S.tube([(0, -0.92, 0.035), (0, -0.93, 0.46)], 0.012, 4), 'Galvanised')


@builder('carport_crooked')
def carport_crooked(m: Model, spec: StructSpec) -> None:
    W, D = 3.0, 6.0
    posts = [(-1.30, -2.80, 2.25, 1.5), (1.30, -2.80, 2.30, -1.0), (-1.30, 2.80, 2.55, -1.5), (1.30, 2.80, 2.50, 2.0)]
    for x, y, h, lean in posts:
        p = S.box(0.16, 0.16, h, 0.02, 1, base=(0, 0, 0))
        S.rotate(p, (lean * 0.4, lean, 0))
        m.add(S.translate(p, (x, y, 0)), 'WoodDark')
        m.add(S.box(0.24, 0.24, 0.10, 0.02, 1, base=(x, y, 0)), 'StoneLight')
    slope = math.degrees(math.atan2(0.26, D - 0.3))
    for x in (-1.30, 1.30):
        m.add(S.box(0.12, D - 0.2, 0.16, 0.015, 1, loc=(x, 0, 2.44), rot=(slope, 0, 0)), 'Wood')
    for y, z in ((-2.8, 2.34), (-1.0, 2.44), (1.0, 2.53), (2.8, 2.62)):
        m.add(S.box(W - 0.2, 0.10, 0.12, 0.012, 1, loc=(0, y, z)), 'Wood')
    roof = S.slab(W - 0.06, D - 0.10, 0.035, 12, 2, base=(0, 0, 0))                     # corrugated sheet
    S.displace(roof, lambda v: Vector((v.x, v.y, v.z + 0.022 * math.sin(v.x * math.pi * 7.0))))
    S.rotate(roof, (slope, 0, 0.6))
    m.add(S.translate(roof, (0.0, 0, 2.57)), 'SheetMetal')
    m.add(S.box(0.9, 0.7, 0.012, 0.0, 0, loc=(0.6, 1.2, 2.66), rot=(slope, 0, 20)), 'Rust')
    for x in (-1.30, 1.30):                                                              # braces
        for y, s in ((-2.80, 1), (2.80, -1)):
            br = S.box(0.07, 0.07, 0.62, 0.01, 1, loc=(0, 0, 0))
            S.rotate(br, (s * 45, 0, 0))
            m.add(S.translate(br, (x, y + s * 0.24, 2.12)), 'Wood')
    m.node('glow', origin=(0, -2.8, 2.1), extras={'part': 'glow'}, transient=True)
    m.add(S.tube([(0, -2.8, 2.28), (0, -2.8, 2.12)], 0.006, 4), 'Iron')
    m.add(S.box(0.13, 0.13, 0.17, 0.02, 1, loc=(0, -2.8, 2.03)), 'Lantern', 'glow')
    m.add(S.box(0.16, 0.16, 0.02, 0.0, 0, loc=(0, -2.8, 2.125)), 'Iron')
    web = S.prism([(0, 0), (0.42, 0), (0, -0.42)], 0.004, 0.0, 0)                        # cobweb in a corner
    m.add(S.translate(web, (-1.22, 2.74, 2.48)), 'Cobweb')


@builder('door_garage')
def door_garage(m: Model, spec: StructSpec) -> None:
    """Roll-up door for an opening spanning 3 wall segments. Centred on the wall plane (Blender y = 0);
    the `door` node's origin is at the top of the opening: the renderer slides or scales it upward to open."""
    W, H = 2.84, 2.30
    for sx in (-1, 1):
        m.add(S.box(0.08, 0.20, H + 0.10, 0.012, 1, base=(sx * (W / 2 + 0.04), 0, 0)), 'Iron')         # tracks
    m.add(S.box(W + 0.24, 0.30, 0.26, 0.03, 1, base=(0, 0, H)), 'SheetMetal')                         # roller box
    m.add(S.box(W + 0.16, 0.10, 0.03, 0.0, 0, base=(0, 0, 0)), 'Granite')                             # threshold
    m.node('door', origin=(0, 0, H), extras={'part': 'door'})
    slats = 11
    sh = H / slats
    for i in range(slats):
        dent = 0.012 if i in (3, 4) else 0.0                                                            # a dent
        m.add(S.box(W, 0.045, sh * 0.94, 0.012, 1, base=(0, dent, i * sh + 0.003)), 'SheetMetal', 'door')
    m.add(S.box(0.50, 0.03, 0.05, 0.012, 1, loc=(0, -0.04, 0.42)), 'Iron', 'door')                    # handle
    m.add(S.box(0.34, 0.012, 0.11, 0.0, 0, loc=(0.9, -0.03, 1.55), rot=(0, 6, 0)), 'Rust', 'door')
    m.add(S.box(0.26, 0.012, 0.16, 0.0, 0, loc=(-0.8, -0.03, 0.95), rot=(0, -4, 0)), 'Bone', 'door')   # a taped-on notice


# ---------------------------------------------------------------------------------------------------
# The crew's project kit (housing-progression §6.3, §15): pole-and-plank scaffolding, a little crooked
# ---------------------------------------------------------------------------------------------------

DECK, GUARD = 2.0, 3.0            # working deck and guard rail heights (inside one 2.9 m storey plus the rail)
POLE_Y = (-0.40, 0.40)


def _pole(m: Model, x: float, y: float, h: float, lean: float = 0.0) -> None:
    p = S.cylinder(0.035, h, 6, 0.0, base=(0, 0, 0))
    S.rotate(p, (lean * 0.4, lean, 0))
    m.add(S.translate(p, (x, y, 0)), 'Pine')
    m.add(S.box(0.16, 0.16, 0.02, 0.0, 0, base=(x, y, 0)), 'WoodDark')                    # sole plate


def _scaffold_run(m: Model, xs, plank_over: float = 0.10) -> None:
    """Poles at each x (front and back), ledgers, transoms, a three-board deck, a toe board and back braces."""
    x0, x1 = xs[0], xs[-1]
    for i, x in enumerate(xs):
        for k, y in enumerate(POLE_Y):
            _pole(m, x, y, GUARD + 0.06 + 0.05 * ((i + k) % 2), lean=(0.5, -0.4, 0.3)[(i + k) % 3])
        m.add(S.tube([(x, -0.46, DECK - 0.11), (x, 0.46, DECK - 0.11)], 0.028, 5), 'Pine')   # transom under the deck
    for z in (1.0, DECK - 0.07, GUARD - 0.06):
        for y in POLE_Y:
            if z > DECK and y > 0:
                continue                                                                  # open toward the wall
            m.add(S.tube([(x0 - 0.06, y, z), (x1 + 0.06, y, z + 0.015)], 0.028, 5), 'Pine')
    m.add(S.tube([(x0 - 0.06, POLE_Y[0], DECK + 0.5), (x1 + 0.06, POLE_Y[0], DECK + 0.5)], 0.022, 5), 'Pine')   # mid rail
    length = x1 - x0 + 2 * plank_over
    for k, y in enumerate((-0.27, 0.0, 0.27)):
        m.add(S.box(length, 0.24, 0.035, 0.0, 0, loc=((x0 + x1) / 2, y, DECK - 0.027), rot=(0, 0, (0.9, -0.6, 0.5)[k])), 'WoodLight')
    m.add(S.box(x1 - x0, 0.02, 0.13, 0.0, 0, base=((x0 + x1) / 2, -0.43, DECK - 0.01)), 'WoodDark')   # toe board
    for a, b in zip(xs, xs[1:]):
        m.add(S.tube([(a, POLE_Y[1], 0.15), (b, POLE_Y[1], DECK - 0.2)], 0.024, 5), 'Pine')           # back brace
    for x in xs:                                                                          # rope lashings at the deck
        for y in POLE_Y:
            m.add(S.torus(0.045, 0.012, 6, 3, loc=(x, y, DECK - 0.07)), 'Straw')


def _ladder(m: Model, x: float, y0: float, y1: float, top: float, w: float = 0.40) -> None:
    for sx in (-1, 1):
        m.add(S.tube([(x + sx * w / 2, y0, 0.0), (x + sx * w / 2, y1, top)], 0.026, 5), 'Pine')
    n = 9
    for k in range(1, n + 1):
        t = k / (n + 1)
        m.add(S.tube([(x - w / 2 - 0.03, y0 + (y1 - y0) * t, top * t), (x + w / 2 + 0.03, y0 + (y1 - y0) * t, top * t)], 0.016, 4), 'WoodLight')


def _tarp(m: Model, x0: float, x1: float, y: float, top: float, drop: float, node: str = 'tarp', puff: float = 1.0) -> None:
    """A tarp roped to a rail: hangs with a belly, one corner come loose. Its own node, so wind can sway it."""
    m.node(node, origin=((x0 + x1) / 2, y, top), extras={'part': 'tarp'})
    w = x1 - x0
    sheet = S.slab(w, 0.012, drop, 6, 4, base=(0, 0, 0))

    def hang(v):
        u, t = v.x / w + 0.5, v.z / drop                       # across 0..1, bottom 0 .. top 1
        belly = 0.10 * math.sin(math.pi * u) * (1 - t) + 0.03 * math.sin(u * 9.0) * (1 - t)
        loose = 0.22 * max(0.0, u - 0.7) / 0.3 * (1 - t) ** 2  # the right bottom corner flaps out
        return Vector((v.x, v.y - puff * (belly + loose), v.z + 0.10 * max(0.0, u - 0.7) / 0.3 * (1 - t)))

    S.displace(sheet, hang)
    m.add(S.translate(sheet, ((x0 + x1) / 2, y, top - drop)), 'PaintGreen', node)
    for k in range(4):                                                                    # rope ties along the rail
        m.add(S.torus(0.035, 0.008, 6, 3, loc=(x0 + w * (0.08 + 0.28 * k), y, top), rot=(0, 90, 0)), 'Straw', node)


def _crew_lantern(m: Model, pos, hang_from=None) -> None:
    x, y, z = pos
    m.node('glow', origin=pos, extras={'part': 'glow'}, transient=True)
    if hang_from is not None:
        m.add(S.tube([hang_from, (x, y, z + 0.11)], 0.006, 4), 'Iron')
    m.add(S.box(0.14, 0.14, 0.18, 0.02, 1, loc=pos), 'Lantern', 'glow')
    m.add(S.box(0.17, 0.17, 0.025, 0.0, 0, loc=(x, y, z + 0.10)), 'Iron')
    m.add(S.box(0.16, 0.16, 0.02, 0.0, 0, loc=(x, y, z - 0.10)), 'Iron')
    m.add(S.torus(0.04, 0.007, 6, 3, loc=(x, y, z + 0.14), rot=(90, 0, 0)), 'Iron')


@builder('scaffold_bay')
def scaffold_bay(m: Model, spec: StructSpec) -> None:
    _scaffold_run(m, (-0.88, 0.88))
    meta.add_frame('work', (0.0, 0.0, DECK), 180.0, 'feet')                               # a crew member on the deck, facing the wall
    meta.add_frame('approach', (0.0, -1.0, 0.0), 180.0, 'approach')


@builder('scaffold_ladder')
def scaffold_ladder(m: Model, spec: StructSpec) -> None:
    _ladder(m, 0.0, -0.36, 0.34, GUARD - 0.05)
    for sx in (-1, 1):
        m.add(S.box(0.10, 0.10, 0.02, 0.0, 0, base=(sx * 0.20, -0.36, 0)), 'WoodDark')
    meta.add_frame('bottom', (0.0, -0.85, 0.0), 180.0, 'approach')
    meta.add_frame('top', (0.0, 0.34, DECK), 180.0, 'exit')


@builder('scaffold_tarp')
def scaffold_tarp(m: Model, spec: StructSpec) -> None:
    for x in (-0.90, 0.90):
        _pole(m, x, 0.0, GUARD)
    m.add(S.tube([(-0.96, 0.0, GUARD - 0.06), (0.96, 0.0, GUARD - 0.045)], 0.028, 5), 'Pine')
    _tarp(m, -0.86, 0.86, -0.02, GUARD - 0.06, 1.7)


@builder('lantern_crew')
def lantern_crew(m: Model, spec: StructSpec) -> None:
    apex = (0.0, 0.0, 1.62)
    for k in range(3):                                                                    # a tripod of lashed poles
        a = math.tau * k / 3 + 0.5
        m.add(S.tube([(0.36 * math.cos(a), 0.36 * math.sin(a), 0.0), (0.03 * math.cos(a), 0.03 * math.sin(a), apex[2] + 0.12)], 0.026, 5), 'Pine')
    m.add(S.torus(0.05, 0.014, 6, 3, loc=apex), 'Straw')
    _crew_lantern(m, (0.0, 0.0, 1.20), hang_from=apex)
    m.add(S.cylinder(0.10, 0.20, 8, 0.0, r_top=0.12, base=(0.26, -0.22, 0.0)), 'Galvanised')    # a bucket of nails
    m.add(S.box(0.30, 0.05, 0.03, 0.0, 0, loc=(-0.20, -0.26, 0.015), rot=(0, 0, 30)), 'WoodLight')   # an offcut


@builder('scaffold_project')
def scaffold_project(m: Model, spec: StructSpec) -> None:
    xs = (-1.36, 0.0, 1.36)
    _scaffold_run(m, xs, plank_over=0.06)
    _ladder(m, 0.92, -0.47, -0.30, DECK + 0.75, w=0.36)                                   # up the front, at the right
    _tarp(m, -1.30, -0.06, POLE_Y[0] + 0.045, GUARD - 0.06, 1.25, puff=0.4)               # inside the left bay's rail, so it stays on the tile
    _crew_lantern(m, (0.30, POLE_Y[0], GUARD - 0.34), hang_from=(0.30, POLE_Y[0], GUARD - 0.06))
    m.add(S.cylinder(0.09, 0.18, 8, 0.0, r_top=0.11, base=(-0.50, 0.12, DECK - 0.01)), 'Galvanised')   # paint bucket on the deck
    m.add(S.cylinder(0.10, 0.012, 8, 0.0, base=(-0.50, 0.12, DECK + 0.15)), 'PaintRed')
    m.add(S.box(0.26, 0.04, 0.03, 0.0, 0, loc=(0.55, 0.10, DECK + 0.006), rot=(0, 0, 25)), 'WoodDark')      # a hammer
    m.add(S.box(0.07, 0.09, 0.04, 0.0, 0, loc=(0.66, 0.15, DECK + 0.012), rot=(0, 0, 25)), 'Iron')
    for sx in (-1, 1):                                                                    # a sawhorse under the right bay
        m.add(S.tube([(0.70 + sx * 0.30, 0.02, 0.62), (0.70 + sx * 0.36, -0.14, 0.0)], 0.022, 4), 'Pine')
        m.add(S.tube([(0.70 + sx * 0.30, 0.02, 0.62), (0.70 + sx * 0.36, 0.18, 0.0)], 0.022, 4), 'Pine')
    m.add(S.box(0.84, 0.09, 0.06, 0.0, 0, loc=(0.70, 0.02, 0.63)), 'Pine')
    m.add(S.box(1.10, 0.20, 0.03, 0.0, 0, loc=(0.62, 0.02, 0.675), rot=(0, 0, 4)), 'WoodLight')              # a board half sawn
    m.add(S.box(0.26, 0.012, 0.34, 0.0, 0, loc=(-0.02, POLE_Y[0] - 0.045, 1.35), rot=(0, 3, 0)), 'Paper')    # the permit, nailed up
    meta.add_frame('pitch_in', (0.70, -0.75, 0.0), 180.0, 'approach')                     # home_pitchIn: at the sawhorse
    meta.add_frame('work', (-0.60, 0.0, DECK), 180.0, 'feet')                             # crew member on the deck
    meta.add_frame('work_2', (0.70, 0.0, DECK), 180.0, 'feet')


# ---------------------------------------------------------------------------------------------------
# Curb-appeal dressing (housing-progression §5): three bands of four pieces. Small, cheap, a little wrong.
# ---------------------------------------------------------------------------------------------------

def _glow(m: Model, pos, size=(0.14, 0.14, 0.18)) -> None:
    m.node('glow', origin=pos, extras={'part': 'glow'}, transient=True)
    m.add(S.box(size[0], size[1], size[2], 0.0, 0, loc=pos), 'Lantern', 'glow')


def _pickets(m: Model, x0: float, n: int, step: float, rail: float, loose=None, node=None, cx: float = 0.0, foot: float = 0.06) -> None:
    """Two rails and n pointed pickets from `foot` up to 0.87 m; `loose` is the index of one that hangs crooked."""
    for z in (0.25, 0.65):
        m.add(S.box(rail, 0.035, 0.07, 0.0, 0, loc=(cx, 0.02, z)), 'Trim', node)
    for k in range(n):
        x = x0 + step * k
        tilt = 9.0 if k == loose else 0.0
        m.add(S.box(0.09, 0.02, 0.78 - foot, 0.0, 0, base=(x, -0.012, foot), rot=(0, tilt, 0)), 'Trim', node)
        cap = S.taper_box(0.09, 0.02, 0.01, 0.02, 0.09, 0.0, 0, base=(0, 0, 0))
        S.rotate(cap, (0, tilt, 0), pivot=(0, 0, -0.72))
        m.add(S.translate(cap, (x, -0.012, 0.78)), 'Trim', node)


# band 1 (L1-L2)

@builder('curb_fence_picket')
def curb_fence_picket(m: Model, spec: StructSpec) -> None:
    """One tile of picket fence centred on the tile edge: a post, two rails, six pickets, one of them loose."""
    m.add(S.box(0.09, 0.09, 0.95, 0.0, 0, base=(-0.45, 0, 0)), 'Trim')
    m.add(S.cone(0.07, 0.08, 4, base=(-0.45, 0, 0.95)), 'Trim')
    _pickets(m, -0.32, 6, 0.15, 0.98, loose=3)
    m.add(S.box(0.9, 0.04, 0.02, 0.0, 0, base=(0.0, 0.0, 0.0)), 'Moss')                    # the weedy strip it stands in


@builder('curb_mailbox')
def curb_mailbox(m: Model, spec: StructSpec) -> None:
    post = S.box(0.09, 0.09, 1.05, 0.0, 0, base=(0, 0, 0))
    m.add(S.rotate(post, (0, 4, 0)), 'WoodDark')
    box = S.cylinder(0.11, 0.42, 8, 0.0, base=(0, 0, 0))
    S.rotate(box, (90, 0, 0))
    m.add(S.translate(box, (0.075, 0.21, 1.14)), 'Galvanised')                             # the tunnel-top box
    m.add(S.box(0.22, 0.42, 0.10, 0.0, 0, base=(0.075, 0.0, 1.04)), 'Galvanised')
    m.add(S.box(0.012, 0.03, 0.16, 0.0, 0, base=(0.19, 0.05, 1.12), rot=(-25, 0, 0)), 'EnamelRed')   # the flag, half up
    m.add(S.box(0.06, 0.012, 0.10, 0.0, 0, loc=(0.075, -0.215, 1.12)), 'Bone')            # a bone for a door pull
    m.add(S.box(0.26, 0.26, 0.03, 0.0, 0, base=(0, 0, 0)), 'SoilDark')
    meta.add_frame('use', (0.075, -0.75, 0.0), 180.0, 'approach')                          # where a zombie stands to collect the post


@builder('curb_flowerbed')
def curb_flowerbed(m: Model, spec: StructSpec) -> None:
    m.add(S.box(1.84, 0.80, 0.12, 0.0, 0, base=(0, 0, 0)), 'Soil')
    for sx, sy, w, d in ((0, -0.42, 1.92, 0.08), (0, 0.42, 1.92, 0.08), (-0.93, 0, 0.08, 0.84), (0.93, 0, 0.08, 0.84)):
        m.add(S.box(w, d, 0.17, 0.0, 0, base=(sx, sy, 0)), 'StoneLight')
    j = m.rng
    looks = ('PlantPurple', 'EnamelRed', 'Bone', 'PlantPurple', 'Berry', 'EnamelRed', 'Bone')
    for k in range(7):                                                                     # wilting flowers
        x, y = -0.75 + 0.25 * k, j.sym(0.22)
        h, lean = j.uniform(0.22, 0.42), j.sym(0.10)
        m.add(S.tube([(x, y, 0.12), (x + lean, y, 0.12 + h)], 0.012, 3), 'PlantGreen')
        m.add(S.cone(0.06, 0.07, 5, base=(x + lean, y, 0.12 + h - 0.02)), looks[k])
    for (x, y) in ((-0.5, 0.25), (0.35, -0.2), (0.7, 0.22)):                                  # leaf tufts
        m.add(S.cone(0.10, 0.12, 5, base=(x, y, 0.12)), 'PlantGreen')


@builder('curb_gnome_skull')
def curb_gnome_skull(m: Model, spec: StructSpec) -> None:
    """A garden gnome with a skull for a face, a tall red hat and a tiny shovel."""
    m.add(S.cone(0.17, 0.30, 8, base=(0, 0, 0)), 'PaintMoon')                                # the coat
    m.add(S.cylinder(0.16, 0.03, 8, 0.0, base=(0, 0, 0)), 'SoilDark')
    m.add(S.sphere(0.115, 8, 5, loc=(0, -0.01, 0.36), scale=(1.0, 1.0, 1.05)), 'Bone')      # the skull
    for sx in (-1, 1):
        m.add(S.sphere(0.03, 5, 3, loc=(sx * 0.045, -0.105, 0.375)), 'Black')              # eye sockets
    m.add(S.box(0.10, 0.03, 0.035, 0.0, 0, loc=(0, -0.10, 0.295)), 'BoneDark')             # the jaw line
    hat = S.cone(0.125, 0.34, 8, base=(0, 0, 0))
    S.rotate(hat, (8, -6, 0))
    m.add(S.translate(hat, (0, 0.0, 0.44)), 'EnamelRed')
    m.add(S.tube([(0.20, -0.02, 0.0), (0.17, -0.03, 0.34)], 0.012, 3), 'WoodLight')         # shovel
    m.add(S.box(0.07, 0.012, 0.09, 0.0, 0, loc=(0.205, -0.02, 0.05)), 'Steel')


# band 2 (L3-L4)

@builder('curb_planter')
def curb_planter(m: Model, spec: StructSpec) -> None:
    m.add(S.taper_box(0.70, 0.36, 0.80, 0.44, 0.34, 0.0, 0, base=(0, 0, 0.04)), 'Planks')
    for sx in (-1, 1):
        m.add(S.box(0.06, 0.34, 0.04, 0.0, 0, base=(sx * 0.28, 0, 0)), 'WoodDark')          # feet
    m.add(S.box(0.72, 0.36, 0.03, 0.0, 0, base=(0, 0, 0.35)), 'SoilDark')
    for k, (x, r, look) in enumerate(((-0.22, 0.15, 'Hedge'), (0.02, 0.19, 'HedgeLight'), (0.25, 0.14, 'Hedge'))):
        m.add(S.blob(r, 1, 0.22, 2.4, seed=60 + k, loc=(x, 0, 0.36 + r * 0.75), scale=(1.0, 0.9, 0.9)), look)
    m.add(S.tube([(0.30, -0.10, 0.38), (0.40, -0.22, 0.30), (0.42, -0.24, 0.12)], 0.012, 3), 'PlantGreen')   # a trailing vine


@builder('curb_porch_light')
def curb_porch_light(m: Model, spec: StructSpec) -> None:
    """A jar light on a shepherd's hook, for beside the porch steps."""
    m.add(S.tube([(0, 0, 0.0), (0.01, 0, 1.45), (0.10, 0, 1.62), (0.22, 0, 1.60), (0.24, 0, 1.50)], 0.022, 5), 'Iron')
    m.add(S.cylinder(0.09, 0.02, 8, 0.0, base=(0, 0, 0)), 'Iron')
    m.add(S.tube([(0.24, 0, 1.50), (0.24, 0, 1.43)], 0.006, 3), 'Iron')
    m.add(S.cylinder(0.075, 0.03, 8, 0.0, base=(0.24, 0, 1.40)), 'Galvanised')
    _glow(m, (0.24, 0.0, 1.31), (0.11, 0.11, 0.17))
    m.add(S.cylinder(0.06, 0.02, 8, 0.0, base=(0.24, 0, 1.205)), 'Galvanised')


@builder('curb_bench')
def curb_bench(m: Model, spec: StructSpec) -> None:
    for sx in (-1, 1):                                                                     # cast-iron ends
        x = sx * 0.78
        m.add(S.tube([(x, -0.26, 0.0), (x, -0.22, 0.42), (x, 0.20, 0.44), (x, 0.30, 0.92)], 0.028, 4), 'Iron')
        m.add(S.tube([(x, 0.26, 0.0), (x, 0.18, 0.44)], 0.028, 4), 'Iron')
        m.add(S.tube([(x, -0.24, 0.42), (x, -0.24, 0.62), (x, 0.10, 0.64)], 0.022, 4), 'Iron')   # arm rest
    for k in range(4):                                                                     # seat slats, one missing
        if k == 2:
            continue
        m.add(S.box(1.62, 0.10, 0.03, 0.0, 0, loc=(0, -0.19 + 0.125 * k, 0.455)), 'Planks')
    for k in range(3):                                                                     # back slats
        m.add(S.box(1.62, 0.03, 0.10, 0.0, 0, loc=(0, 0.215 + 0.03 * k, 0.56 + 0.14 * k), rot=(-12, 0, 0)), 'Planks')
    meta.add_frame('seat_0', (-0.40, -0.02, 0.47), 0.0, 'seat')
    meta.add_frame('seat_1', (0.40, -0.02, 0.47), 0.0, 'seat')


@builder('curb_bike_rack')
def curb_bike_rack(m: Model, spec: StructSpec) -> None:
    """A single street hoop rack (the wave kind), bolted to the pavement."""
    pts = [(-0.40, 0, 0.0), (-0.40, 0, 0.62), (-0.30, 0, 0.80), (-0.20, 0, 0.62), (-0.20, 0, 0.30), (-0.10, 0, 0.14),
           (0.0, 0, 0.30), (0.0, 0, 0.62), (0.10, 0, 0.80), (0.20, 0, 0.62), (0.20, 0, 0.30), (0.30, 0, 0.14), (0.40, 0, 0.30),
           (0.40, 0, 0.0)]
    m.add(S.tube(pts, 0.025, 5), 'Galvanised')
    for x in (-0.40, 0.40):
        m.add(S.cylinder(0.07, 0.015, 6, 0.0, base=(x, 0, 0)), 'Steel')
    m.add(S.torus(0.05, 0.008, 6, 3, loc=(0.0, 0.0, 0.42), rot=(90, 0, 0)), 'Rust')         # a lock somebody left
    meta.add_frame('park', (0.0, -0.55, 0.0), 90.0, 'attach')                              # a bike stands across the rack


# band 3 (L5+)

@builder('curb_topiary')
def curb_topiary(m: Model, spec: StructSpec) -> None:
    """A clipped three-ball topiary in a stone urn, the top ball a skull that nobody will admit to trimming."""
    m.add(S.lathe([(0.0, 0.0), (0.20, 0.0), (0.14, 0.10), (0.26, 0.36), (0.30, 0.40), (0.0, 0.40)], 8), 'StoneLight')
    m.add(S.tube([(0, 0, 0.38), (0.01, 0, 1.55)], 0.03, 4), 'WoodDark')
    for z, r in ((0.66, 0.30), (1.10, 0.23)):
        m.add(S.sphere(r, 8, 5, loc=(0, 0, z)), 'Hedge')
    m.add(S.sphere(0.17, 8, 5, loc=(0, 0, 1.50), scale=(1.0, 1.05, 1.1)), 'HedgeLight')
    for sx in (-1, 1):
        m.add(S.sphere(0.045, 5, 3, loc=(sx * 0.065, -0.15, 1.52)), 'Black')


@builder('curb_fountain')
def curb_fountain(m: Model, spec: StructSpec) -> None:
    m.add(S.lathe([(0.0, 0.0), (0.92, 0.0), (0.92, 0.34), (0.80, 0.38), (0.78, 0.20), (0.0, 0.20)], 12), 'Marble')   # basin
    m.node('water', origin=(0, 0, 0.30), extras={'part': 'water'})
    m.add(S.cylinder(0.78, 0.02, 12, 0.0, base=(0, 0, 0.29)), 'Water', 'water')
    m.add(S.lathe([(0.0, 0.20), (0.16, 0.20), (0.10, 0.34), (0.08, 0.80), (0.14, 0.88), (0.36, 0.98), (0.38, 1.04), (0.30, 1.00),
                   (0.0, 0.96)], 10), 'Marble')                                             # pedestal and bowl
    m.add(S.cylinder(0.29, 0.015, 10, 0.0, base=(0, 0, 0.995)), 'Water', 'water')
    m.add(S.sphere(0.09, 8, 5, loc=(0, 0, 1.10), scale=(1.0, 1.0, 1.1)), 'Bone')             # a skull spout
    for sx in (-1, 1):
        m.add(S.sphere(0.022, 5, 3, loc=(sx * 0.035, -0.08, 1.115)), 'Black')
    m.add(S.tube([(0, -0.09, 1.07), (0, -0.20, 1.06), (0, -0.26, 1.0)], 0.012, 4), 'Water', 'water')
    meta.add_frame('view', (0.0, -1.5, 0.0), 180.0, 'approach')


@builder('curb_gate_iron')
def curb_gate_iron(m: Model, spec: StructSpec) -> None:
    """One tile of iron railing with spear tops between two stone piers, centred on the tile edge."""
    for sx in (-1, 1):
        m.add(S.box(0.16, 0.16, 1.30, 0.0, 0, base=(sx * 0.42, 0, 0)), 'Granite')
        m.add(S.sphere(0.09, 6, 4, loc=(sx * 0.42, 0, 1.38)), 'Granite')
    for z in (0.20, 1.02):
        m.add(S.box(0.70, 0.03, 0.04, 0.0, 0, loc=(0, 0, z)), 'Iron')
    for k in range(6):
        x = -0.275 + 0.11 * k
        top = 1.18 + 0.06 * math.sin(math.pi * k / 5)
        m.add(S.box(0.022, 0.022, top - 0.14, 0.0, 0, base=(x, 0, 0.14)), 'Iron')
        m.add(S.cone(0.028, 0.09, 4, base=(x, 0, top)), 'Iron')
    m.add(S.torus(0.09, 0.012, 8, 3, loc=(0, 0, 0.62), rot=(90, 0, 0)), 'Iron')              # a ring ornament


@builder('curb_lamp_post')
def curb_lamp_post(m: Model, spec: StructSpec) -> None:
    m.add(S.lathe([(0.0, 0.0), (0.17, 0.0), (0.15, 0.10), (0.08, 0.22), (0.055, 0.60), (0.045, 2.70), (0.07, 2.76), (0.0, 2.76)], 8), 'Iron')
    m.add(S.tube([(-0.22, 0, 2.52), (0.22, 0, 2.52)], 0.018, 4), 'Iron')                    # ladder bar
    m.add(S.cylinder(0.14, 0.03, 6, 0.0, base=(0, 0, 2.76)), 'Iron')
    _glow(m, (0.0, 0.0, 2.93), (0.20, 0.20, 0.28))
    m.add(S.cone(0.20, 0.16, 6, base=(0, 0, 3.07)), 'Iron')
    m.add(S.sphere(0.03, 5, 3, loc=(0, 0, 3.25)), 'Brass')


# ---------------------------------------------------------------------------------------------------
# Yard fences and gates (yard-building §1/§3). A run is exactly one tile long and has no post, so runs tile;
# the post goes on corners and ends; a gate fills one tile and its leaf is the `door` node, hinged at its origin.
# ---------------------------------------------------------------------------------------------------

HINGE_X = -0.40                     # the gate leaf's hinge line (the node origin), Blender x


def _gate_frames() -> None:
    """Where a character stands to open the gate from the yard side (front) and the far side."""
    meta.add_frame('front', (0.0, -0.75, 0.0), 180.0, 'approach')
    meta.add_frame('back', (0.0, 0.75, 0.0), 0.0, 'approach')


def _leaf(m: Model, z: float = 0.0) -> None:
    m.node('door', origin=(HINGE_X, 0.0, z), extras={'part': 'door', 'hinge': 'z', 'opens': 90})


# picket (the same pickets and rails as the curb-appeal fence)

@builder('fence_picket_run')
def fence_picket_run(m: Model, spec: StructSpec) -> None:
    _pickets(m, -0.42, 7, 0.14, 1.0, loose=None, foot=0.0)        # a run stands on the ground; posts are separate pieces


@builder('fence_picket_post')
def fence_picket_post(m: Model, spec: StructSpec) -> None:
    m.add(S.box(0.11, 0.11, 0.98, 0.0, 0, base=(0, 0, 0)), 'Trim')
    m.add(S.cone(0.085, 0.10, 4, base=(0, 0, 0.98)), 'Trim')
    m.add(S.box(0.15, 0.15, 0.04, 0.0, 0, base=(0, 0, 0.90)), 'Trim')


@builder('fence_picket_gate')
def gate_picket(m: Model, spec: StructSpec) -> None:
    for sx in (-1, 1):                                                                     # jamb posts
        m.add(S.box(0.10, 0.10, 1.02, 0.0, 0, base=(sx * 0.45, 0, 0)), 'Trim')
        m.add(S.cone(0.055, 0.10, 4, base=(sx * 0.45, 0, 1.02)), 'Trim')
    _leaf(m)
    _pickets(m, -0.30, 5, 0.15, 0.78, node='door', cx=0.0)
    m.add(S.box(0.80, 0.03, 0.06, 0.0, 0, loc=(0.0, 0.02, 0.45), rot=(0, -27, 0)), 'Trim', 'door')   # the brace
    m.add(S.box(0.07, 0.03, 0.04, 0.0, 0, loc=(0.36, -0.03, 0.66)), 'Iron', 'door')        # latch
    for z in (0.25, 0.65):
        m.add(S.box(0.05, 0.02, 0.10, 0.0, 0, loc=(HINGE_X, -0.03, z)), 'Iron', 'door')    # hinges
    _gate_frames()


# wrought iron

def _iron_bars(m: Model, x0: float, n: int, step: float, rail: float, node=None, arch: float = 0.0, foot: float = 0.08) -> None:
    for z in (0.18, 0.92):
        m.add(S.box(rail, 0.03, 0.035, 0.0, 0, loc=(0, 0, z)), 'Iron', node)
    for k in range(n):
        x = x0 + step * k
        top = 1.02 + arch * math.sin(math.pi * k / max(1, n - 1))
        m.add(S.box(0.022, 0.022, top - foot, 0.0, 0, base=(x, 0, foot)), 'Iron', node)
        m.add(S.cone(0.028, 0.08, 4, base=(x, 0, top)), 'Iron', node)


@builder('fence_iron_run')
def fence_iron_run(m: Model, spec: StructSpec) -> None:
    _iron_bars(m, -0.4375, 8, 0.125, 1.0, foot=0.0)


@builder('fence_iron_post')
def fence_iron_post(m: Model, spec: StructSpec) -> None:
    m.add(S.box(0.07, 0.07, 1.06, 0.0, 0, base=(0, 0, 0)), 'Iron')
    m.add(S.box(0.12, 0.12, 0.05, 0.0, 0, base=(0, 0, 0)), 'Iron')
    m.add(S.sphere(0.055, 6, 4, loc=(0, 0, 1.12)), 'Iron')


@builder('fence_iron_gate')
def gate_iron(m: Model, spec: StructSpec) -> None:
    for sx in (-1, 1):
        m.add(S.box(0.07, 0.07, 1.10, 0.0, 0, base=(sx * 0.455, 0, 0)), 'Iron')
        m.add(S.sphere(0.05, 6, 4, loc=(sx * 0.455, 0, 1.15)), 'Iron')
    _leaf(m)
    _iron_bars(m, -0.33, 7, 0.11, 0.80, node='door', arch=0.08)
    m.add(S.torus(0.09, 0.012, 8, 3, loc=(0, 0, 0.56), rot=(90, 0, 0)), 'Iron', 'door')
    m.add(S.box(0.06, 0.04, 0.05, 0.0, 0, loc=(0.37, -0.02, 0.60)), 'Brass', 'door')       # latch
    _gate_frames()


# bone

def _bone_rails(m: Model, length: float, node=None) -> None:
    for z, r in ((0.26, 0.022), (0.66, 0.022)):                                            # long bones for rails
        m.add(S.tube([(-length / 2 + 0.03, 0, z), (length / 2 - 0.03, 0, z)], r, 4), 'Bone', node)
        for sx in (-1, 1):
            m.add(S.sphere(r * 1.7, 5, 3, loc=(sx * (length / 2 - 0.035), 0, z), scale=(0.8, 1.0, 1.25)), 'Bone', node)


@builder('fence_bone_run')
def fence_bone_run(m: Model, spec: StructSpec) -> None:
    _bone_rails(m, 1.0)
    for k in range(5):                                                                     # rib pickets, a little uneven
        x = -0.36 + 0.18 * k
        h = 0.80 + 0.05 * math.sin(k * 2.1)
        m.add(S.tube([(x, 0.0, 0.0), (x, -0.015, 0.45), (x, 0.0, h)], 0.018, 4, radii=[0.020, 0.015, 0.010]), 'BoneDark' if k % 2 else 'Bone')


@builder('fence_bone_post')
def fence_bone_post(m: Model, spec: StructSpec) -> None:
    for k in range(5):                                                                     # a stack of vertebrae
        w = 0.11 - 0.007 * k
        m.add(S.box(w, w, 0.15, 0.0, 0, base=(0, 0, 0.17 * k), rot=(0, 0, 18 * k)), 'Bone' if k % 2 == 0 else 'BoneDark')
    sk, so = S.skull(0.085, loc=(0, 0, 0.98), segs=6)
    m.add(sk, 'Bone')
    m.add(so, 'Black')


@builder('fence_bone_gate')
def gate_bone(m: Model, spec: StructSpec) -> None:
    for sx in (-1, 1):
        m.add(S.tube([(sx * 0.455, 0, 0.0), (sx * 0.455, 0, 1.02)], 0.035, 6, radii=[0.045, 0.030]), 'Bone')   # femur posts
        m.add(S.sphere(0.055, 6, 4, loc=(sx * 0.455, 0, 1.06)), 'Bone')
    _leaf(m)
    _bone_rails(m, 0.80, node='door')
    for a in (-1, 1):                                                                      # crossed bones
        m.add(S.bone(0.74, 0.020, 1.7, loc=(0, -0.02, 0.46), rot=(0, a * 30, 0), segs=6), 'BoneDark', 'door')
    m.add(S.box(0.06, 0.04, 0.05, 0.0, 0, loc=(0.37, -0.02, 0.66)), 'Iron', 'door')
    _gate_frames()


# hedge

def _hedge(m: Model, length: float, depth: float, height: float, seed: int, node=None, cx: float = 0.0) -> None:
    """A clipped box hedge with a lumpy top and faces; its two ends stay flat so runs meet cleanly."""
    bm = S.slab(length, depth, height, 4, 3, base=(0, 0, 0))

    def lump(v):
        end = abs(abs(v.x) - length / 2) < 1e-4
        k = 0.0 if end else 1.0
        return Vector((v.x, v.y + k * 0.025 * math.sin(v.x * 23.0 + seed) * (1 if v.y > 0 else -1),
                       v.z + (k * 0.035 * math.sin(v.x * 17.0 + seed * 1.7) if v.z > height - 1e-4 else 0.0)))   # ends stay level

    S.displace(bm, lump)
    m.add(S.translate(bm, (cx, 0, 0.04)), 'Hedge', node)
    m.add(S.box(length - 0.04, depth * 0.5, 0.05, 0.0, 0, base=(cx, 0, 0)), 'WoodDark', node)   # the stems, in shadow


@builder('fence_hedge_run')
def fence_hedge_run(m: Model, spec: StructSpec) -> None:
    _hedge(m, 1.0, 0.38, 0.92, seed=3)


@builder('fence_hedge_post')
def fence_hedge_post(m: Model, spec: StructSpec) -> None:
    m.add(S.box(0.44, 0.44, 0.86, 0.0, 0, base=(0, 0, 0.04)), 'Hedge')                      # a corner block, clipped higher
    m.add(S.blob(0.24, 1, 0.16, 2.2, seed=11, loc=(0, 0, 0.98), scale=(1.0, 1.0, 0.8)), 'HedgeLight')
    m.add(S.box(0.20, 0.20, 0.05, 0.0, 0, base=(0, 0, 0)), 'WoodDark')


@builder('fence_hedge_gate')
def gate_hedge(m: Model, spec: StructSpec) -> None:
    for sx in (-1, 1):                                                                     # hedge stubs each side, with a post in them
        _hedge(m, 0.14, 0.38, 0.92, seed=5 + sx, cx=sx * 0.43)
        m.add(S.box(0.07, 0.07, 1.0, 0.0, 0, base=(sx * 0.40, -0.02, 0)), 'WoodDark')
    _leaf(m)
    for k in range(5):                                                                     # a wicket of five boards with a curved top
        x = -0.28 + 0.14 * k
        h = 0.72 + 0.14 * math.sin(math.pi * (k + 0.5) / 5)
        m.add(S.box(0.12, 0.025, h, 0.0, 0, base=(x, -0.02, 0.08)), 'Planks', 'door')
    for z in (0.26, 0.62):
        m.add(S.box(0.70, 0.03, 0.06, 0.0, 0, loc=(0, 0.01, z)), 'WoodDark', 'door')
    m.add(S.torus(0.035, 0.008, 6, 3, loc=(0.30, -0.045, 0.62), rot=(90, 0, 0)), 'Iron', 'door')   # ring latch
    _gate_frames()


# low stone wall

def _wall(m: Model, length: float, seed: int, cx: float = 0.0, height: float = 0.70) -> None:
    m.add(S.box(length, 0.30, height, 0.0, 0, base=(cx, 0, 0)), 'Granite')
    m.add(S.box(length, 0.36, 0.07, 0.0, 0, base=(cx, 0, height)), 'StoneLight')            # coping
    n = max(1, int(round(length / 0.34)))
    for row, z in enumerate((0.20, 0.45)):                                                 # a few mortar lines, both faces
        for sy in (-1, 1):
            m.add(S.box(length, 0.006, 0.014, 0.0, 0, loc=(cx, sy * 0.152, z)), 'Charcoal')
            for k in range(n):
                x = cx - length / 2 + length * (k + (0.5 if row else 0.25)) / n
                if abs(x - cx) < length / 2 - 0.02:
                    m.add(S.box(0.014, 0.006, 0.24, 0.0, 0, loc=(x, sy * 0.152, z + 0.125)), 'Charcoal')


@builder('fence_stone_run')
def fence_stone_run(m: Model, spec: StructSpec) -> None:
    _wall(m, 1.0, seed=1)
    m.add(S.blob(0.07, 1, 0.3, 3.0, seed=4, loc=(0.22, 0.0, 0.79), scale=(1.6, 1.2, 0.35)), 'Moss')   # moss on the coping


@builder('fence_stone_post')
def fence_stone_post(m: Model, spec: StructSpec) -> None:
    m.add(S.box(0.42, 0.42, 0.92, 0.0, 0, base=(0, 0, 0)), 'Granite')
    m.add(S.box(0.48, 0.48, 0.08, 0.0, 0, base=(0, 0, 0.92)), 'StoneLight')
    m.add(S.taper_box(0.40, 0.40, 0.10, 0.10, 0.16, 0.0, 0, base=(0, 0, 1.0)), 'StoneLight')
    for z in (0.30, 0.62):
        m.add(S.box(0.426, 0.426, 0.014, 0.0, 0, loc=(0, 0, z)), 'Charcoal')


@builder('fence_stone_gate')
def gate_stone(m: Model, spec: StructSpec) -> None:
    for sx in (-1, 1):                                                                     # piers
        m.add(S.box(0.16, 0.34, 1.0, 0.0, 0, base=(sx * 0.42, 0, 0)), 'Granite')
        m.add(S.box(0.20, 0.38, 0.07, 0.0, 0, base=(sx * 0.42, 0, 1.0)), 'StoneLight')
    _leaf(m)
    for z in (0.16, 0.80):                                                                 # a low iron gate between them
        m.add(S.box(0.66, 0.03, 0.035, 0.0, 0, loc=(0, 0, z)), 'Iron', 'door')
    for k in range(5):
        x = -0.26 + 0.13 * k
        m.add(S.box(0.022, 0.022, 0.82, 0.0, 0, base=(x, 0, 0.08)), 'Iron', 'door')
        m.add(S.cone(0.028, 0.07, 4, base=(x, 0, 0.90)), 'Iron', 'door')
    m.add(S.box(0.05, 0.04, 0.05, 0.0, 0, loc=(0.30, -0.02, 0.52)), 'Brass', 'door')
    _gate_frames()
