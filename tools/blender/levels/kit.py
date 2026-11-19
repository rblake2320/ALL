"""Level art kits: model specs, builder registry, extra material looks and small authoring helpers.

Level models are NOT catalogue objects (most are community-lot-only and not in ``src/shared/catalog.ts`` yet), so
each level carries its own spec table (``l2_specs.py``) taken from its design doc (``docs/levels/L*.md``). Every
spec names the design object it serves (``obj``) and, for multi-mesh objects, the variant/state key (``variant``):
``grave_marked`` has four headstone variants, ``den_stray`` three species, ``item_curio`` one mesh per curio id,
``item_fish`` four shared body meshes + two junk catches.

Axes and conventions are the objects pipeline's (tools/blender/objects): Blender front = -Y (-> glTF +Z),
Z up (-> glTF +Y), 1 unit = 1 tile = 1 m, floor items centred on their footprint with the base at z = 0,
wall items with their back on the wall plane (Blender y = 0, body toward -Y), fence/edge pieces centred on the
tile edge. Dynamic parts are separate named nodes (``extras.part``) that the runtime shows/hides/animates.
"""
from __future__ import annotations

import math
from typing import Callable, Dict, List, Optional, Sequence, Tuple

import bmesh
from mathutils import Vector

from common import shapes as S
from common.materials import LOOKS, MatSpec
from common.model import Model

from .spec import LevelSpec  # noqa: F401  (re-exported for builders)

# ───────────────────────────── specs ─────────────────────────────


BuilderFn = Callable[[Model, LevelSpec], None]
BUILDERS: Dict[str, BuilderFn] = {}


def builder(*ids: str) -> Callable[[BuilderFn], BuilderFn]:
    def deco(fn: BuilderFn) -> BuilderFn:
        for i in ids:
            if i in BUILDERS:
                raise KeyError(f'duplicate level builder for {i}')
            BUILDERS[i] = fn
        return fn

    return deco


# ───────────────────────────── extra looks ─────────────────────────────
# Graveyard palette from docs/levels/L2-graveyard.md §12 (ground moss #5f7a52, dirt #5a4634, gravel #8d877a,
# water #3e4f45, lily pads #6f8f5e, lanterns #ffb35a, blessing toxic #9fe870) + ART_DIRECTION core colours.
LEVEL_LOOKS: Dict[str, MatSpec] = {
    'GyMoss': MatSpec('#5f7a52', roughness=0.95),
    'GyDirt': MatSpec('#5a4634', roughness=0.95),
    'GyDirtFresh': MatSpec('#3a2a1e', roughness=0.98),
    'GyGravel': MatSpec('#8d877a', roughness=0.95),
    'GyGravelDark': MatSpec('#6f6a60', roughness=0.95),
    'GyMud': MatSpec('#4d3f30', roughness=0.7),
    'GyStone': MatSpec('#8e8b82', roughness=0.88),
    'GyStoneWarm': MatSpec('#9c9283', roughness=0.88),
    'GyStoneDark': MatSpec('#6c6a66', roughness=0.9),
    'GySlab': MatSpec('#7a8080', roughness=0.85),
    'GyLichen': MatSpec('#a3a45e', roughness=0.95),
    'PondWater': MatSpec('#3e4f45', roughness=0.08, alpha=0.86, double_sided=False),
    'PondDeep': MatSpec('#25332d', roughness=0.2),
    'LilyPad': MatSpec('#6f8f5e', roughness=0.6, double_sided=True),
    'LilyPadDark': MatSpec('#557347', roughness=0.6, double_sided=True),
    'LilyFlower': MatSpec('#e6c9d6', roughness=0.6, double_sided=True),
    'PondEyes': MatSpec('#3a4a20', roughness=0.4, emission='#d8f070', strength=4.0),
    'Willow': MatSpec('#7d8f6a', roughness=0.85, double_sided=True),
    'WillowDark': MatSpec('#5f7352', roughness=0.85, double_sided=True),
    'Cattail': MatSpec('#5a3a24', roughness=0.9),
    'Reed': MatSpec('#7f8a55', roughness=0.85, double_sided=True),
    'ReedDry': MatSpec('#a39a62', roughness=0.85, double_sided=True),
    'Void': MatSpec('#120e17', roughness=0.95),
    'VoidGlow': MatSpec('#1e1828', roughness=0.9, emission='#3a2a5a', strength=2.0),
    'RuneGlow': MatSpec('#3c5a2c', roughness=0.4, emission='#9fe870', strength=3.5),
    'BlessGlow': MatSpec('#4a7a3a', roughness=0.6, emission='#9fe870', strength=2.6, alpha=0.7, double_sided=True),
    'CandleFlame': MatSpec('#ffb35a', roughness=0.9, emission='#ffb35a', strength=4.5),
    'CoalGlow': MatSpec('#5a2416', roughness=0.8, emission='#ff6a2a', strength=3.0),
    'Steam': MatSpec('#e8ece4', roughness=0.95, alpha=0.4, double_sided=True),
    'Livery': MatSpec('#7a2a38', roughness=0.4, coat=0.4),
    'LiveryAccent': MatSpec('#e8e0c8', roughness=0.5),
    'LiveryMower': MatSpec('#5f8a4a', roughness=0.4, coat=0.35),
    'Decal': MatSpec('#efe6cf', roughness=0.6),
    'DecalInk': MatSpec('#3a1a22', roughness=0.6),
    'ScreenSoda': MatSpec('#2a1418', roughness=0.25, emission='#ffb070', strength=2.8),
    'Cork': MatSpec('#a77a4e', roughness=0.95),
    'PaperOld': MatSpec('#e3d6b4', roughness=0.9, double_sided=True),
    'PaperPink': MatSpec('#e0b8b8', roughness=0.9, double_sided=True),
    'PaperGreen': MatSpec('#bcd0a8', roughness=0.9, double_sided=True),
    'Bamboo': MatSpec('#b89a5a', roughness=0.7),
    'FloatRed': MatSpec('#b8322e', roughness=0.4),
    'Line': MatSpec('#d9d2c0', roughness=0.6),
    'Wicker': MatSpec('#a47a48', roughness=0.9),
    'WickerDark': MatSpec('#7a5634', roughness=0.9),
    'Cushion': MatSpec('#8a5a6e', roughness=0.95),
    'Enamel': MatSpec('#d8dccf', roughness=0.35),
    'EnamelRim': MatSpec('#3f5a6e', roughness=0.35),
    'Tin': MatSpec('#a9aaa4', roughness=0.4, metallic=0.7),
    'TinRed': MatSpec('#a8382e', roughness=0.55),
    'Clay': MatSpec('#b9805a', roughness=0.7),
    'ClaySwirl': MatSpec('#6a8fa8', roughness=0.6),
    'Cobalt': MatSpec('#2a4fa8', roughness=0.08, alpha=0.6, double_sided=True),
    'Cork2': MatSpec('#b38a5a', roughness=0.9),
    'EyeWhite': MatSpec('#efeadc', roughness=0.15),
    'EyeIris': MatSpec('#3f78b8', roughness=0.2),
    'FeltRed': MatSpec('#7a2a30', roughness=0.95),
    'Silver': MatSpec('#c4c7c9', roughness=0.25, metallic=0.9),
    'Jet': MatSpec('#1f1c24', roughness=0.12, metallic=0.1),
    'Amber': MatSpec('#a8642a', roughness=0.35),
    'Shell': MatSpec('#f0e2d0', roughness=0.5),
    'Coral': MatSpec('#c97a62', roughness=0.5),
    'WaxSeal': MatSpec('#9a2030', roughness=0.4),
    'Leather': MatSpec('#5a3a2a', roughness=0.75),
    'LeatherDark': MatSpec('#3e2a20', roughness=0.8),
    'Pumpkin': MatSpec('#d4722a', roughness=0.6),
    'PumpkinDark': MatSpec('#a8521e', roughness=0.65),
    'PumpkinGlow': MatSpec('#ffb35a', roughness=0.8, emission='#ffb35a', strength=4.0),
    'Stem': MatSpec('#5a5a2e', roughness=0.8),
    'Crystal': MatSpec('#c8b8f0', roughness=0.05, alpha=0.55, emission='#a890ff', strength=2.2),
    'TableCloth': MatSpec('#4b2a55', roughness=0.95, double_sided=True),
    'Fringe': MatSpec('#c9a94a', roughness=0.7),
    'Flower1': MatSpec('#c97a9a', roughness=0.6),
    'Flower2': MatSpec('#e8d27a', roughness=0.6),
    'Flower3': MatSpec('#a8b8e8', roughness=0.6),
    'Leaf': MatSpec('#5a7a42', roughness=0.7, double_sided=True),
    'LeafDead': MatSpec('#8a6a3a', roughness=0.8, double_sided=True),
    'Peel': MatSpec('#c9a04a', roughness=0.7),
    'Spire': MatSpec('#5d5a66', roughness=0.9),
    'SpireRoof': MatSpec('#3c3846', roughness=0.85),
    'BellBronze': MatSpec('#8a6a3a', roughness=0.4, metallic=0.8),
    'Hay': MatSpec('#b9a05a', roughness=0.95),
    'Rope': MatSpec('#a8925e', roughness=0.9),
    'RubberGreen': MatSpec('#3f5a3a', roughness=0.85),
    'IronOld': MatSpec('#6a6470', roughness=0.5, metallic=0.55),
}


def ensure_look(m: Model, name: str) -> str:
    """Register a level look on the model's material library (no-op for shared LOOKS / Paint)."""
    if name in LEVEL_LOOKS and name not in LOOKS:
        m.mats.custom(name, LEVEL_LOOKS[name])
    return name


def add(m: Model, bm: bmesh.types.BMesh, mat: str = 'Paint', node: Optional[str] = None) -> None:
    ensure_look(m, mat)
    m.add(bm, mat, node)


def flat_text(body: str, size: float, loc: Sequence[float], rot: Sequence[float] = (90, 0, 0),
              align: str = 'CENTER') -> bmesh.types.BMesh:
    """Painted/engraved lettering: zero-depth text facing Blender -Y (the model front) by default."""
    bm = S.text(body, size, 0.0, loc=loc, rot=rot, align=align, resolution=1)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # zero-depth curves come out with an arbitrary winding: force every glyph face to face the requested normal
    want = S.matrix((0, 0, 0), rot).to_3x3() @ Vector((0, 0, 1))
    for f in bm.faces:
        f.normal_update()
        if f.normal.dot(want) < 0:
            f.normal_flip()
    return bm


def node(m: Model, name: str, part: Optional[str] = None, origin: Sequence[float] = (0, 0, 0),
         transient: bool = False, parent: Optional[str] = None, **extras) -> str:
    ex = dict(extras)
    if part:
        ex['part'] = part
    m.node(name, parent=parent, origin=origin, extras=ex, transient=transient)
    return name


def rounded_outline(w: float, h: float, r: float, n: int = 6) -> List[Tuple[float, float]]:
    """Headstone silhouette (u across, v up) with rounded shoulders of radius r."""
    pts = [(-w / 2, 0.0), (w / 2, 0.0)]
    for k in range(n + 1):
        a = math.pi / 2 * k / n
        pts.append((w / 2 - r + math.cos(a) * r, h - r + math.sin(a) * r))
    for k in range(n + 1):
        a = math.pi / 2 + math.pi / 2 * k / n
        pts.append((-w / 2 + r + math.cos(a) * r, h - r + math.sin(a) * r))
    out = []
    for p in pts:
        if not out or (abs(out[-1][0] - p[0]) > 1e-6 or abs(out[-1][1] - p[1]) > 1e-6):
            out.append(p)
    return out


def noisy_outline(rx: float, ry: float, n: int, amp: float, j, power: float = 2.4) -> List[Tuple[float, float]]:
    """Irregular rounded blob outline (superellipse + jitter), CCW."""
    pts = []
    for k in range(n):
        a = math.tau * k / n
        c, s = math.cos(a), math.sin(a)
        ex = 2.0 / power
        x = math.copysign(abs(c) ** ex, c) * rx
        y = math.copysign(abs(s) ** ex, s) * ry
        f = 1.0 + j.sym(amp)
        pts.append((x * f, y * f))
    return pts


def ribbon(points: Sequence[Sequence[float]], widths: Sequence[float], side: Sequence[float] = (1, 0, 0)
           ) -> bmesh.types.BMesh:
    """A flat strip along ``points`` (leaves/fronds/paper), double-sided material expected."""
    bm = bmesh.new()
    sv = Vector(side).normalized()
    prev = None
    for p, w in zip(points, widths):
        p = Vector(p)
        a = bm.verts.new(p - sv * w / 2)
        b = bm.verts.new(p + sv * w / 2)
        if prev is not None:
            bm.faces.new((prev[0], prev[1], b, a))
        prev = (a, b)
    return bm


def clamp_z(m: Model, z0: float = 0.0, node_name: Optional[str] = None) -> None:
    n = m.nodes[node_name or m.body]
    for bm, _ in n.parts:
        for v in bm.verts:
            if v.co.z < z0:
                v.co.z = z0


def dome(rx: float, ry: float, h: float, rings: int = 4, segs: int = 12, j=None, power: float = 2.6,
         lump: float = 0.1, loc: Sequence[float] = (0, 0, 0), edge: float = 0.0) -> bmesh.types.BMesh:
    """Open (bottomless) elliptical earth mound: a centre vertex + ``rings`` rings of ``segs`` vertices, rounded
    superellipse footprint, smooth cosine profile, deterministic lumps. ``edge`` lifts the outer ring (a lip)."""
    bm = bmesh.new()
    centre = bm.verts.new((0.0, 0.0, h))
    rings_v = []
    for r in range(1, rings + 1):
        t = r / rings
        z = h * (math.cos(t * math.pi / 2) ** 1.3) if r < rings else edge
        ring = []
        for k in range(segs):
            a = math.tau * k / segs
            c, s = math.cos(a), math.sin(a)
            ex = 2.0 / power
            x = math.copysign(abs(c) ** ex, c) * rx * t
            y = math.copysign(abs(s) ** ex, s) * ry * t
            dz = 0.0
            if j is not None and r < rings:
                dz = j.sym(lump) * h
                x += j.sym(0.015)
                y += j.sym(0.015)
            ring.append(bm.verts.new((x, y, max(0.0, z + dz))))
        rings_v.append(ring)
    for k in range(segs):
        bm.faces.new((centre, rings_v[0][k], rings_v[0][(k + 1) % segs]))
    for ra, rb in zip(rings_v, rings_v[1:]):
        for k in range(segs):
            k2 = (k + 1) % segs
            bm.faces.new((ra[k], rb[k], rb[k2], ra[k2]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
    return S.translate(bm, loc)


def quad(w: float, h: float, centre: Sequence[float], facing: str = '-Y') -> bmesh.types.BMesh:
    """Single-sided rectangle (screens, decal plates): ``facing`` '-Y' (model front) or '+Z' (up)."""
    bm = bmesh.new()
    cx, cy, cz = centre
    if facing == '-Y':
        vs = [bm.verts.new((cx + a * w / 2, cy, cz + b * h / 2)) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    else:
        vs = [bm.verts.new((cx + a * w / 2, cy + b * h / 2, cz)) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    f = bm.faces.new(vs)
    f.normal_update()
    want = Vector((0, -1, 0)) if facing == '-Y' else Vector((0, 0, 1))
    if f.normal.dot(want) < 0:
        f.normal_flip()
    return bm


def front_poly(pts: Sequence[Tuple[float, float]], centre: Sequence[float]) -> bmesh.types.BMesh:
    """Single-sided polygon fan in the XZ plane facing the model front (-Y): carved cut-outs, painted marks."""
    bm = bmesh.new()
    cx, cy, cz = centre
    c = bm.verts.new((cx + sum(p[0] for p in pts) / len(pts), cy, cz + sum(p[1] for p in pts) / len(pts)))
    ring = [bm.verts.new((cx + u, cy, cz + v)) for u, v in pts]
    for k in range(len(ring)):
        f = bm.faces.new((c, ring[k], ring[(k + 1) % len(ring)]))
        f.normal_update()
        if f.normal.y > 0:
            f.normal_flip()
    return bm
