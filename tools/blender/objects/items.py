"""Loose items spawned by gameplay. Origin at the base centre (floor or surface point)."""
from __future__ import annotations

import math

import bmesh

from mathutils import Vector

from common import shapes as S
from common.catalog import Spec
from common.model import Model
from common.rng import Jitter

from .electronics import screen_surface
from .registry import builder


def _brain_lobe(cy: float, a: float = 0.158, b: float = 0.064, h: float = 0.118, segs: int = 18):
    """One cerebral hemisphere: a rounded-oblong dome along X centred at y = ``cy`` with a flat bottom at z = 0 (the
    two hemispheres side by side leave the deep central fissure between them)."""
    prof = [(1.0, 0.0), (0.99, h * 0.3), (0.9, h * 0.6), (0.68, h * 0.84), (0.0, h)]
    return S.superlathe(prof, a, b, 2.3, segs, base=(0.0, cy, 0.0), cap_bottom=True, cap_top=False)


def _gyri(lobe, cy: float, side: int, lo: float, hi: float, j: Jitter, h: float = 0.118, r: float = 0.0172,
          bands: int = 2) -> list:
    """Fat cartoon gyri over one hemisphere between x = lo..hi: ``bands`` wavy ridges running from the central
    fissure (phi < 0) over the crown and down the outer flank (phi ~ 1.4), phi being the angle around the lobe's
    long axis (0 = straight up). Each control point is ray-cast onto the lobe and half-buried along its normal; the
    darker lobe showing between neighbouring ridges (plus the baked AO) reads as the sulci."""
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromBMesh(lobe)
    out = []
    w = hi - lo
    for b in range(bands):
        xc = lo + w * (b + 0.5) / bands + j.sym(0.004)
        amp = j.uniform(0.012, 0.018)
        ph = j.uniform(0, math.tau)
        step = j.uniform(2.0, 2.6)
        ctrl = []
        for i, phi in enumerate((-0.42, -0.02, 0.36, 0.72, 1.06, 1.38)):
            x = xc + amp * math.sin(ph + i * step)
            x = min(hi - r * 0.75, max(lo + r * 0.75, x))
            d = Vector((0.0, side * math.sin(phi), math.cos(phi)))
            hit, nrm, _i, _d = bvh.ray_cast(Vector((x, cy - side * 0.01, h * 0.2)), d, 1.0)
            if hit is not None:
                ctrl.append(hit + nrm * (r * 0.32))
        if len(ctrl) >= 3:
            pts = S.catmull(ctrl, 2)
            n = len(pts)
            radii = [r * (0.62 + 0.38 * math.sin(math.pi * (i + 0.5) / n) ** 0.5) for i in range(n)]
            out.append(S.tube(pts, radii=radii, segs=4))
    return out


def _cap_loop(bm, x_plane: float, tol: float = 2e-4):
    """Ordered boundary loop of a bisected mesh lying on the plane x = x_plane (for capping cut faces)."""
    edges = [e for e in bm.edges if e.is_boundary and all(abs(v.co.x - x_plane) < tol for v in e.verts)]
    if not edges:
        return []
    adj = {}
    for e in edges:
        a, b = e.verts
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    start = min(adj, key=lambda v: (round(v.co.z, 6), round(v.co.y, 6)))
    loop, prev, cur = [start], None, start
    for _ in range(len(adj) + 1):
        nxt = [v for v in adj[cur] if v is not prev]
        if not nxt or nxt[0] is start:
            break
        prev, cur = cur, nxt[0]
        loop.append(cur)
    return [v.co.copy() for v in loop]


def _loaf_slice(loaf, xa: float, xb: float, gap: float = 0.004):
    """Copy of ``loaf`` between x = xa and x = xb with flat pink cut caps; returns (crust_bm, caps_bm)."""
    sl = loaf.copy()
    for (x, keep_pos) in ((xa, True), (xb, False)):
        if x is None:
            continue
        geom = list(sl.verts) + list(sl.edges) + list(sl.faces)
        bmesh.ops.bisect_plane(sl, geom=geom, plane_co=(x, 0, 0), plane_no=(1, 0, 0),
                               clear_inner=keep_pos, clear_outer=not keep_pos)
    caps = bmesh.new()
    for x, sign in ((xa, -1.0), (xb, 1.0)):
        if x is None:
            continue
        loop = _cap_loop(sl, x)
        if len(loop) < 3:
            continue
        vs = [caps.verts.new(c) for c in loop]
        f = caps.faces.new(vs)
        f.normal_update()
        if f.normal.x * sign < 0:
            f.normal_flip()
    # pull the slice in a little so the cut lines read
    lo = xa if xa is not None else min(v.co.x for v in sl.verts)
    hi = xb if xb is not None else max(v.co.x for v in sl.verts)
    c = (lo + hi) / 2
    k = max(0.5, 1.0 - 2.0 * gap / max(1e-3, hi - lo))
    for b in (sl, caps):
        for v in b.verts:
            v.co.x = c + (v.co.x - c) * k
    return sl, caps


@builder('item_meal')
def item_meal(m: Model, spec: Spec) -> None:
    """Oval porcelain platter on lettuce with a glistening BRAIN loaf: two plump hemispheres split by a deep fissure,
    covered in fat meandering gyri (baked AO darkens the sulci), a little cerebellum tucked under the back, pre-cut
    across its length into four servings (serving_0..serving_3, hidden one by one as they are eaten; pink cut faces
    between neighbours), plus parsley, a cherry tomato, two eyeball 'olives' and a party pick."""
    j = m.rng
    z0 = 0.021
    prof = [(0.0, 0.0), (0.86, 0.0), (1.0, 0.026), (0.95, 0.03), (0.84, 0.019), (0.0, 0.016)]
    m.add(S.superlathe(prof, 0.235, 0.165, 2.2, 18, cap_bottom=False, cap_top=False), 'Porcelain')
    rim = [(x, y, 0.0262) for x, y in S.superellipse_pts(0.235 * 0.935, 0.165 * 0.92, 2.2, 22)]
    m.add(S.tube(rim, 0.0038, 3, closed=True), 'Gold')
    for k in range(3):
        a = math.tau * k / 3 + 0.55
        leaf = S.superellipsoid(0.075, 0.046, 0.006, 0.6, 0.6, 8, 4,
                                loc=(math.cos(a) * 0.105, math.sin(a) * 0.06, 0.019),
                                rot=(j.sym(10), j.sym(10), math.degrees(a)))
        m.add(leaf, 'Lettuce')
    cuts = (None, -0.078, 0.0, 0.078, None)
    lobes = [(_brain_lobe(side * 0.06), side) for side in (-1, 1)]
    for lobe, _side in lobes:
        S.translate(lobe, (0, 0, z0))
    jg = j.fork('gyri')
    for k in range(4):
        xa, xb = cuts[k], cuts[k + 1]
        lo = xa if xa is not None else -0.158
        hi = xb if xb is not None else 0.158
        name = f'serving_{k}'
        # organic: smooth across the 90-degree edges of the 4-sided gyri tubes (cut caps are separate islands)
        m.node(name, origin=((lo + hi) / 2, 0.0, z0), extras={'part': 'serving', 'index': k}, smooth=120.0)
        for lobe, side in lobes:
            crust, caps = _loaf_slice(lobe, xa, xb, gap=0.0035)
            m.add(crust, 'BrainDark', name)
            m.add(caps, 'LoafCut', name)
            # gyri are laid on the whole lobe, then pulled in with the slice so they stay on its surface
            c = (lo + hi) / 2
            kk = max(0.5, 1.0 - 2.0 * 0.0035 / max(1e-3, hi - lo))
            for tb in _gyri(lobe, side * 0.06, side, lo, hi, jg):
                for v in tb.verts:
                    v.co.x = c + (v.co.x - c) * kk
                m.add(tb, 'Brain', name)
    # cerebellum: a ribbed little lobe tucked under the back (-X) end, part of the first serving
    cb = S.superlathe([(1.0, 0.0), (1.0, 0.012), (0.85, 0.035), (0.5, 0.05), (0.0, 0.054)], 0.05, 0.1, 2.2, 14,
                      base=(-0.152, 0.0, z0), cap_bottom=True, cap_top=False)
    m.add(cb, 'BrainDark', 'serving_0')
    for q in range(3):
        zq = z0 + 0.016 + q * 0.013
        arc = [(-0.152 - 0.048 * (1 - 0.18 * q) * math.cos(t), 0.095 * (1 - 0.2 * q) * math.sin(t), zq)
               for t in (0.5, 1.1, 1.57, 2.04, 2.64)]
        m.add(S.tube(arc, 0.0062, 4), 'Brain', 'serving_0')
    for lobe, _side in lobes:
        lobe.free()
    # garnish: parsley, a cherry tomato and two eyeball 'olives' staring up from the lettuce
    for k, (x, y) in enumerate(((-0.195, 0.07), (0.2, -0.075), (0.2, 0.085))):
        m.add(S.blob(0.024, 1, 0.45, 4, k, loc=(x, y, 0.031), scale=(1, 1, 0.55)), 'Parsley')
    m.add(S.sphere(0.019, 7, 5, loc=(-0.2, -0.06, 0.039)), 'EnamelRed')
    for k, (x, y, yaw) in enumerate(((0.212, 0.0, 20.0), (-0.214, 0.012, -30.0))):
        m.add(S.sphere(0.018, 8, 5, loc=(x, y, 0.038)), 'Porcelain')
        d = Vector((0.35 * math.cos(math.radians(yaw)), 0.35 * math.sin(math.radians(yaw)), 0.94)).normalized()
        c = Vector((x, y, 0.038)) + d * 0.0165
        m.add(_disc(c, d, 0.0095), 'Turquoise')
        m.add(_disc(c + d * 0.0012, d, 0.0045), 'Black')
    pick = S.cylinder(0.0025, 0.1, 4, 0.0, base=(0.0, 0.0, 0.0), rot=(0, 12, 0))
    flag = S.prism([(0.0, 0.0), (0.045, 0.012), (0.0, 0.026)], 0.002, 0.0, 0, plane='XZ')
    S.translate(flag, (0.0, 0.0, 0.07))
    S.rotate(flag, (0, 12, 0))
    m.add(S.translate(pick, (0.118, 0.0, 0.085)), 'WoodLight', 'serving_3')
    m.add(S.translate(flag, (0.118, 0.0, 0.085)), 'PaintRed', 'serving_3')


def _disc(centre: Vector, normal: Vector, r: float, segs: int = 10):
    """Flat round disc facing ``normal`` (eye irises/pupils)."""
    bm = bmesh.new()
    n = normal.normalized()
    u = n.orthogonal().normalized()
    w = n.cross(u)
    vs = [bm.verts.new(centre + (u * math.cos(math.tau * k / segs) + w * math.sin(math.tau * k / segs)) * r)
          for k in range(segs)]
    f = bm.faces.new(vs)
    f.normal_update()
    if f.normal.dot(n) < 0:
        f.normal_flip()
    return bm


@builder('item_pizza')
def item_pizza(m: Model, spec: Spec) -> None:
    j = m.rng
    B = 0.38
    # open cardboard box: tray + low walls; lid flipped open behind, nearly flat
    m.add(S.box(B, B, 0.006, 0.002, 1, base=(0, 0, 0)), 'Cardboard')
    for sx in (-1, 1):
        m.add(S.box(0.006, B, 0.04, 0.002, 1, base=(sx * (B / 2 - 0.003), 0, 0)), 'Cardboard')
    for sy in (-1, 1):
        m.add(S.box(B, 0.006, 0.04, 0.002, 1, base=(0, sy * (B / 2 - 0.003), 0)), 'Cardboard')
    lid = S.box(B, B - 0.01, 0.006, 0.002, 1, base=(0, 0, 0))
    S.translate(lid, (0, (B - 0.01) / 2, 0))
    S.rotate(lid, (12, 0, 0))
    m.add(S.translate(lid, (0, B / 2, 0.04)), 'Cardboard')
    logo = S.text('BRAINZ', 0.05, 0.002, loc=(0, 0, 0), rot=(0, 0, 0))  # reads upright from the front
    S.translate(logo, (0, B / 2 - 0.03, 0.008))
    S.rotate(logo, (12, 0, 0), pivot=(0, 0, 0))
    m.add(S.translate(logo, (0, B / 2, 0.04)), 'Blood')
    m.add(S.cylinder(0.172, 0.004, 24, 0.0, base=(0, 0, 0.006)), 'Paper')
    # four slices with brain-matter toppings
    r = 0.165
    for k in range(4):
        a0 = math.pi / 2 * k + 0.03
        a1 = math.pi / 2 * (k + 1) - 0.03
        am = (a0 + a1) / 2
        cx, cy = math.cos(am) * r * 0.45, math.sin(am) * r * 0.45
        name = f'serving_{k}'
        m.node(name, origin=(cx, cy, 0.01), extras={'part': 'serving', 'index': k})
        pts = [(0.0, 0.0)] + [(math.cos(a0 + (a1 - a0) * i / 6) * r, math.sin(a0 + (a1 - a0) * i / 6) * r) for i in range(7)]
        base = S.prism(pts, 0.012, 0.003, 1, plane='XY')
        m.add(S.translate(base, (0, 0, 0.01)), 'Cardboard', name)
        m.add(S.translate(S.prism([(x * 0.97, y * 0.97) for x, y in pts], 0.004, 0.0, 0, plane='XY'), (0, 0, 0.022)), 'PaintMoon',
              name)
        crust = S.tube([(math.cos(a0 + (a1 - a0) * i / 6) * r * 0.96, math.sin(a0 + (a1 - a0) * i / 6) * r * 0.96, 0.024)
                        for i in range(7)], 0.012, 5)
        m.add(crust, 'Pine', name)
        jj = j.fork(f'p{k}')
        for q in range(3):
            rr = jj.uniform(0.04, 0.12)
            aa = jj.uniform(a0 + 0.15, a1 - 0.15)
            p = Vector((math.cos(aa) * rr, math.sin(aa) * rr, 0.029))
            sq = [p + Vector((jj.sym(0.02), jj.sym(0.02), 0)) for _ in range(3)]
            m.add(S.tube([p] + sq, 0.007, 4), 'Brain', name)
        m.add(S.sphere(0.008, 5, 3, loc=(math.cos(am) * 0.09, math.sin(am) * 0.09, 0.03), scale=(1, 1, 0.5)), 'PlantGreen',
              name)


@builder('item_dish')
def item_dish(m: Model, spec: Spec) -> None:
    j = m.rng
    m.add(S.lathe([(0.0, 0.0), (0.075, 0.0), (0.085, 0.006), (0.13, 0.018), (0.128, 0.022), (0.08, 0.012), (0.0, 0.01)], 20),
          'Porcelain')
    for k in range(4):
        m.add(S.blob(j.uniform(0.02, 0.04), 1, 0.4, 3, k, loc=(j.sym(0.05), j.sym(0.05), 0.012), scale=(1.4, 1, 0.12)),
              'Rust' if k % 2 else 'MoldDark')
    fork = S.merge(S.box(0.13, 0.014, 0.004, 0.001, 1, base=(0, 0, 0)),
                   *[S.box(0.04, 0.003, 0.003, 0.0, 0, base=(0.085, dy, 0.0)) for dy in (-0.005, 0.0, 0.005)])
    S.rotate(fork, (0, -4, 25))
    m.add(S.translate(fork, (-0.03, -0.02, 0.016)), 'Steel')
    for k in range(5):
        m.add(S.sphere(0.004, 4, 3, loc=(j.sym(0.09), j.sym(0.09), 0.014)), 'Cardboard')


def _hand(at: Vector, yaw: float, s: float = 1.0):
    palm = S.superellipsoid(0.045 * s, 0.035 * s, 0.015 * s, 0.6, 0.6, 10, 6)
    parts = [palm]
    for k in range(4):
        y = (-0.024 + k * 0.016) * s
        L = (0.05 + 0.008 * (1 - abs(k - 1.5))) * s
        parts.append(S.tube([(0.04 * s, y, 0.0), (0.04 * s + L * 0.6, y, 0.006 * s), (0.04 * s + L, y + 0.004, -0.004 * s)],
                            0.008 * s, 5))
    parts.append(S.tube([(0.0, 0.03 * s, 0.0), (0.03 * s, 0.055 * s, 0.004), (0.05 * s, 0.06 * s, 0.0)], 0.009 * s, 5))
    bm = S.merge(*parts)
    S.rotate(bm, (0, 0, yaw))
    return S.translate(bm, at)


@builder('item_limb_arm')
def item_limb_arm(m: Model, spec: Spec) -> None:
    """A dropped zombie arm (~0.62 along X): chunky green upper arm in a ragged purple sleeve with the humerus
    poking out, a stitched elbow, a plump hand with splayed fingers (one waving up a little)."""
    j = m.rng
    z = 0.055
    shoulder = Vector((-0.27, 0.02, z))
    elbow = Vector((0.02, -0.025, z))
    wrist = Vector((0.22, 0.03, z - 0.006))
    m.add(S.tube(S.catmull([shoulder, (shoulder + elbow) / 2 + Vector((0, 0, 0.004)), elbow], 2),
                 radii=[0.056, 0.055, 0.052, 0.05, 0.048], segs=10), 'Skin')
    m.add(S.sphere(0.05, 10, 6, loc=elbow), 'Skin')
    m.add(S.tube([elbow, (elbow + wrist) / 2, wrist], radii=[0.047, 0.042, 0.035], segs=10), 'Skin')
    m.add(_hand(wrist + Vector((0.022, 0.006, -0.012)), 14, 1.3), 'Skin')
    # ragged sleeve + the bone end sticking out of it
    cuff = S.tube([shoulder + Vector((-0.03, 0, 0)), shoulder + Vector((0.08, -0.004, 0))], 0.064, 10)
    for v in cuff.verts:
        if v.co.x > shoulder.x + 0.06:
            a = math.atan2(v.co.z - z, v.co.y - shoulder.y)
            v.co.x += 0.03 * math.sin(a * 5)
    m.add(cuff, 'Book5')
    m.add(S.cylinder(0.058, 0.012, 10, 0.0, base=(shoulder.x - 0.03, shoulder.y, z), rot=(0, -90, 0)), 'BloodWine')
    m.add(S.tube([shoulder + Vector((-0.02, 0.0, 0.0)), shoulder + Vector((-0.07, 0.008, 0.004))], 0.016, 6), 'Bone')
    m.add(S.sphere(0.024, 8, 5, loc=shoulder + Vector((-0.08, 0.008, 0.004)), scale=(0.8, 1.2, 1.0)), 'Bone')
    # stitched elbow seam + a bruise
    m.add(S.stitches(elbow + Vector((-0.03, -0.05, 0.02)), elbow + Vector((0.03, -0.05, 0.03)), 4, 0.011,
                     (0, -1, 0.3), 0.0025), 'Ink')
    m.add(S.sphere(0.024, 6, 4, loc=(-0.13, -0.01, z + 0.045), scale=(1.4, 1, 0.3)), 'SkinDark')


@builder('item_limb_leg')
def item_limb_leg(m: Model, spec: Spec) -> None:
    """A dropped zombie leg (~0.85 along X): patched trouser thigh with the femur poking out, stitched green shin, a
    striped sock and a big scuffed shoe with the toe peeking out of a hole."""
    j = m.rng
    z = 0.08
    hip = Vector((-0.4, 0.0, z))
    knee = Vector((-0.02, 0.02, z - 0.004))
    ankle = Vector((0.28, -0.01, z - 0.022))
    m.add(S.tube([hip, (hip + knee) / 2, knee], radii=[0.08, 0.076, 0.068], segs=10), 'Trousers')
    cuff = S.tube([knee + Vector((-0.02, 0, 0)), knee + Vector((0.07, -0.002, 0))], 0.072, 10)
    for v in cuff.verts:
        if v.co.x > knee.x + 0.05:
            a = math.atan2(v.co.z - z, v.co.y - knee.y)
            v.co.x += 0.03 * math.sin(a * 4)
    m.add(cuff, 'Trousers')
    m.add(S.box(0.12, 0.004, 0.08, 0.002, 1, loc=(-0.22, -0.078, z + 0.012), rot=(10, 0, 6)), 'PatchA')
    m.add(S.cylinder(0.078, 0.014, 10, 0.0, base=(hip.x - 0.012, hip.y, z), rot=(0, -90, 0)), 'BloodWine')
    m.add(S.tube([hip + Vector((-0.01, 0, 0)), hip + Vector((-0.06, 0.01, 0.006))], 0.02, 6), 'Bone')
    m.add(S.sphere(0.03, 8, 5, loc=hip + Vector((-0.075, 0.01, 0.006))), 'Bone')
    m.add(S.tube([knee, (knee + ankle) / 2, ankle], radii=[0.058, 0.052, 0.04], segs=10), 'Skin')
    m.add(S.stitches(knee + Vector((0.1, -0.045, 0.035)), knee + Vector((0.22, -0.035, 0.03)), 4, 0.011, (0, -1, 0.5),
                     0.0025), 'Ink')
    # striped sock + shoe (toe up) with a hole and a peeking green toe
    for k in range(3):
        m.add(S.cylinder(0.046, 0.022, 10, 0.004, base=(ankle.x - 0.06 + k * 0.026, ankle.y, ankle.z), rot=(0, 90, 0)),
              'Lining' if k % 2 == 0 else 'PaintRed')
    shoe = S.superellipsoid(0.062, 0.056, 0.068, 0.5, 0.5, 12, 8)
    m.add(S.translate(shoe, (ankle.x + 0.06, ankle.y, 0.075)), 'Black')
    sole = S.box(0.028, 0.116, 0.15, 0.01, 1, base=(0, 0, 0))
    m.add(S.translate(sole, (ankle.x + 0.12, ankle.y, 0.0)), 'Rubber')
    m.add(S.sphere(0.02, 8, 5, loc=(ankle.x + 0.112, ankle.y - 0.02, 0.118), scale=(1.0, 1.0, 0.9)), 'Skin')
    m.add(S.tube([(ankle.x + 0.04, ankle.y - 0.035, 0.12), (ankle.x + 0.07, ankle.y, 0.142), (ankle.x + 0.04, ankle.y + 0.035, 0.12)],
                 0.005, 3), 'Paper')


@builder('item_bonepile')
def item_bonepile(m: Model, spec: Spec) -> None:
    j = m.rng
    # bones piled in a low mound
    for k in range(13):
        a = j.uniform(0, math.tau)
        r = j.uniform(0.0, 0.3)
        zz = 0.03 + (0.3 - r) * 0.35 + j.uniform(0.0, 0.03)
        L = j.uniform(0.14, 0.3)
        b = S.bone(L, j.uniform(0.012, 0.018), 1.9, segs=6)
        S.rotate(b, (j.sym(25), j.sym(25), math.degrees(a) + j.sym(60)))
        m.add(S.translate(b, (math.cos(a) * r, math.sin(a) * r * 0.8, zz)), 'Bone' if k % 3 else 'BoneDark')
    for k in range(3):
        rib = S.torus(0.09, 0.009, 10, 4, arc=150)
        S.rotate(rib, (j.uniform(40, 80), 0, j.uniform(0, 360)))
        m.add(S.translate(rib, (j.sym(0.15), j.sym(0.12), 0.08)), 'Bone')
    # scraps of clothing and the skull on top
    m.add(S.box(0.22, 0.16, 0.012, 0.004, 1, loc=(0.16, -0.1, 0.03), rot=(6, -8, 25)), 'Book5')
    m.add(S.box(0.16, 0.1, 0.01, 0.003, 1, loc=(-0.2, 0.12, 0.05), rot=(-10, 12, -40)), 'Trousers')
    m.add(S.prism([(0.0, 0.0), (0.03, 0.0), (0.045, -0.12), (0.015, -0.14), (-0.015, -0.12)], 0.006, 0.0, 0, plane='XY',
                  loc=(-0.05, -0.12, 0.13), rot=(10, 0, 30)), 'BloodWine')
    sk, so = S.skull(0.085, loc=(0.0, -0.02, 0.24), rot=(8, 0, 12), segs=10)
    m.add(sk, 'Bone')
    m.add(so, 'Black')
    # faint ghostly wisp rising out of the pile (glow; floats gently)
    m.node('glow', origin=(0.0, 0.0, 0.25), extras={'part': 'glow', 'flicker': 'float'}, transient=True)
    wisp = S.catmull([(0.0, 0.02, 0.25), (0.04, 0.03, 0.29), (-0.02, 0.04, 0.33), (0.03, 0.05, 0.38)], 3)
    radii = [0.03 + 0.02 * math.sin(math.pi * i / (len(wisp) - 1)) for i in range(len(wisp))]
    radii[-1] = 0.0
    m.add(S.tube(wisp, radii=radii, segs=6), 'GlowGhost', 'glow')


@builder('item_urn')
def item_urn(m: Model, spec: Spec) -> None:
    j = m.rng
    m.add(S.box(0.22, 0.22, 0.06, 0.012, 2, base=(0, 0, 0)), 'Marble')
    m.add(S.box(0.2, 0.2, 0.015, 0.004, 1, base=(0, 0, 0.06)), 'Gold')
    prof = [(0.0, 0.0), (0.055, 0.0), (0.06, 0.012), (0.035, 0.03), (0.04, 0.05), (0.085, 0.12), (0.1, 0.18), (0.085, 0.25),
            (0.045, 0.29), (0.04, 0.3), (0.055, 0.31), (0.05, 0.32), (0.0, 0.32)]
    m.add(S.lathe(prof, 18, base=(0, 0, 0.075)), 'Bronze')
    m.add(S.torus(0.098, 0.006, 20, 3, loc=(0, 0, 0.075 + 0.18)), 'Gold')
    m.add(S.lathe([(0.055, 0.0), (0.05, 0.02), (0.02, 0.04), (0.012, 0.05), (0.02, 0.06), (0.0, 0.07)], 14,
                  base=(0, 0, 0.075 + 0.32)), 'Bronze')
    for sx in (-1, 1):
        h = S.torus(0.04, 0.007, 10, 4, arc=200, rot=(90, 0, 0))
        S.rotate(h, (0, sx * 100, 0))
        m.add(S.translate(h, (sx * 0.08, 0, 0.075 + 0.24)), 'Bronze')
    m.add(S.tube([(0.07, -0.08, 0.075), (0.09, -0.1, 0.1)], 0.003, 3), 'PlantGreen')
    m.add(S.blob(0.014, 1, 0.3, 3, 2, loc=(0.092, -0.102, 0.104), scale=(1, 1, 0.7)), 'PaintMoon')


@builder('item_painting')
def item_painting(m: Model, spec: Spec) -> None:
    j = m.rng
    tilt = -14
    cw, ch = 0.6, 0.5
    z0 = 0.1
    import mathutils as _mu
    rot = _mu.Euler((math.radians(tilt), 0, 0)).to_matrix()
    centre = Vector((0, 0.0, z0 + 0.03 + ch / 2))
    # small tabletop easel-stand behind and under the frame
    for sx in (-1, 1):
        m.add(S.tube([(sx * 0.2, 0.16, 0.0), (sx * 0.1, 0.07, z0 + ch * 0.8)], 0.012, 5), 'WoodDark')
        m.add(S.box(0.04, 0.12, 0.03, 0.006, 1, base=(sx * 0.25, -0.03, 0.0)), 'WoodDark')
    m.add(S.box(0.6, 0.07, 0.025, 0.005, 1, base=(0, -0.04, z0 - 0.025)), 'WoodDark')
    for sx in (-1, 1):
        m.add(S.box(0.03, 0.03, z0 - 0.025, 0.005, 1, base=(sx * 0.25, -0.04, 0.0)), 'WoodDark')
    frame_w = 0.05
    for sz in (-1, 1):
        bar = S.box(cw + 2 * frame_w, 0.04, frame_w, 0.01, 2, loc=(0, 0, sz * (ch / 2 + frame_w / 2)))
        m.add(S.translate(S.rotate(bar, (tilt, 0, 0)), centre), 'Gold')
    for sx in (-1, 1):
        bar = S.box(frame_w, 0.04, ch, 0.01, 2, loc=(sx * (cw / 2 + frame_w / 2), 0, 0))
        m.add(S.translate(S.rotate(bar, (tilt, 0, 0)), centre), 'Gold')
    back = S.box(cw, 0.01, ch, 0.0, 0, loc=(0, 0.012, 0))
    m.add(S.translate(S.rotate(back, (tilt, 0, 0)), centre), 'WoodLight')
    face_c = centre + rot @ Vector((0, -0.006, 0))
    m.node('canvas', origin=tuple(face_c), extras={'part': 'canvas', 'finished': True})
    m.add(screen_surface(cw, ch, 0.0, 1, 1, center=tuple(face_c), tilt=tilt), 'CanvasBlank', 'canvas')

    def on(u: float, v: float, off: float = 0.004):
        return tuple(face_c + rot @ Vector((u, -off, v)))

    # finished art: night sky, a big moon, a crooked house on a green hill (always visible: 'finished')
    def poly_on(name: str, mat: str, pts, off: float) -> None:
        m.node(name, parent='canvas', origin=on(0, 0))
        bm = S.prism(pts, 0.004, 0.0, 0, plane='XZ')
        for v in bm.verts:
            p = face_c + rot @ Vector((v.co.x, -off + v.co.y, v.co.z))
            v.co = p
        m.add(bm, mat, name)

    poly_on('canvas_stroke_0', 'Plum', [(-0.29, -0.05), (0.29, -0.05), (0.29, 0.24), (-0.29, 0.24)], 0.003)
    poly_on('canvas_stroke_1', 'PaintMoon', [(0.19 + math.cos(a) * 0.065, 0.12 + math.sin(a) * 0.065)
                                            for a in [math.tau * i / 12 for i in range(12)]], 0.006)
    poly_on('canvas_stroke_2', 'PaintGreen', [(-0.29, -0.24), (0.29, -0.24), (0.29, -0.08), (0.1, -0.03), (-0.1, -0.06),
                                              (-0.29, -0.02)], 0.006)
    poly_on('canvas_stroke_3', 'Black', [(-0.2, -0.07), (-0.04, -0.06), (-0.035, 0.06), (-0.11, 0.15), (-0.2, 0.07)], 0.009)


@builder('item_fire')
def item_fire(m: Model, spec: Spec) -> None:
    """Accidental indoor bonfire: a ring of soot-blackened stones, crossed charred logs with glowing cracks, and a
    cluster of twisting flame tongues in three heat layers (deep orange outside, gold core) so it stays orange under
    ACES tone mapping instead of clipping to white. Node 'flame' (alwaysOn) flickers per tongue."""
    j = m.rng
    for k in range(9):
        a = math.tau * k / 9 + j.sym(0.15)
        r = 0.34 + j.sym(0.03)
        m.add(S.blob(0.065, 1, 0.3, 3.0, k, loc=(math.cos(a) * r, math.sin(a) * r, 0.04), scale=(1.2, 1.0, 0.7),
                     flat_bottom=-0.55), 'Charcoal' if k % 3 == 0 else 'Granite')
    for k in range(4):
        a = math.pi * k / 4 + 0.2
        log = S.cylinder(0.05, 0.56, 8, 0.012, base=(0, 0, 0), rot=(0, 90, 0))
        S.translate(log, (-0.28, 0, 0))
        S.rotate(log, (0, 0, math.degrees(a)))
        m.add(S.translate(log, (0, 0, 0.05 + 0.028 * (k % 2))), 'Charcoal')
        m.add(S.translate(S.rotate(S.box(0.3, 0.012, 0.012, 0.0, 0, base=(0, -0.045, 0.03)), (0, 0, math.degrees(a))),
                          (0, 0, 0.05 + 0.028 * (k % 2))), 'Ember')
    m.node('flame', origin=(0, 0, 0.08), extras={'part': 'flame', 'alwaysOn': True})
    tongues = [((0.0, 0.0), 0.92, 0.16, 'FireOuter'), ((0.17, 0.07), 0.6, 0.11, 'FireOuter'),
               ((-0.16, 0.09), 0.66, 0.12, 'FireOuter'), ((0.09, -0.16), 0.52, 0.1, 'FireOuter'),
               ((-0.12, -0.13), 0.48, 0.1, 'FireOuter'), ((0.0, 0.0), 0.7, 0.115, 'FireMid'),
               ((0.1, 0.05), 0.46, 0.08, 'FireMid'), ((-0.08, -0.05), 0.4, 0.075, 'FireMid'),
               ((0.02, 0.01), 0.42, 0.065, 'FireCore')]
    for k, ((x, y), h, r, mat) in enumerate(tongues):
        name = f'flame_{k}'
        m.node(name, parent='flame', origin=(x, y, 0.08), transient=True)
        fl = S.flame(h, r, base=(0, 0, 0), segs=8, lean=j.sym(0.07))
        tw = j.uniform(0.6, 1.3) * (1 if k % 2 else -1)
        for v in fl.verts:
            t = v.co.z / h
            ang = tw * t
            x0, y0 = v.co.x, v.co.y
            v.co.x = x0 * math.cos(ang) - y0 * math.sin(ang) + 0.03 * math.sin(t * 5.0 + k) * t
            v.co.y = x0 * math.sin(ang) + y0 * math.cos(ang)
        m.add(S.translate(fl, (x, y, 0.08)), mat, name)
    for k in range(7):
        a = j.uniform(0, math.tau)
        r = j.uniform(0.12, 0.3)
        m.add(S.sphere(0.018, 5, 3, loc=(math.cos(a) * r, math.sin(a) * r, 0.012), scale=(1, 1, 0.5)), 'Coil', 'flame')


@builder('item_ash')
def item_ash(m: Model, spec: Spec) -> None:
    j = m.rng
    m.add(S.blob(0.34, 2, 0.18, 3.0, 4, loc=(0, 0, 0.0), scale=(1.0, 0.8, 0.22), flat_bottom=0.0), 'Ash')
    m.add(S.blob(0.16, 1, 0.3, 3.0, 6, loc=(0.12, 0.05, 0.03), scale=(1.0, 0.8, 0.35), flat_bottom=-0.08), 'Charcoal')
    for k in range(3):
        a = j.uniform(0, math.tau)
        stick = S.cylinder(0.014, 0.28, 6, 0.0, base=(0, 0, 0), rot=(0, 86, 0))
        S.rotate(stick, (0, j.sym(10), math.degrees(a)))
        m.add(S.translate(stick, (j.sym(0.1), j.sym(0.08), 0.05)), 'Charcoal')
    for k in range(4):
        m.add(S.sphere(0.012, 5, 3, loc=(j.sym(0.15), j.sym(0.12), 0.06), scale=(1, 1, 0.5)), 'Ember')
