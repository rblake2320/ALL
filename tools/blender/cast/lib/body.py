"""Source GLB -> cleaned, decimated, re-posed, normalised mesh on a zombie.glb-compatible skeleton.

Pipeline per body (all deterministic):
  1. import <sourceId>_rigged.glb (Zombie Smash 2: front -Y in Blender == glTF +Z, feet on z=0, 20/24-joint rig)
  2. weld split vertices (UVs live on loops, so seams survive), clear imported custom normals, shade smooth
  3. collapse-decimate to TRI_TARGET (vertex groups and UVs are interpolated by the decimator)
  4. re-pose the limbs with THEIR skin weights so each limb segment points along the classic rig's rest direction
     (arms down at the zombie A-pose angle + an optional per-body abduction for wide bodies, straight legs, feet
     forward) and apply that pose as the new rest shape
  5. scale to CastBodyDef.height (skull / headwear top), feet on z=0, pelvis centred on x/y
  6. build OUR armature: every bone gets the zombie bone's exact rest rotation and its head at the fitted joint;
     prop_L/prop_R placed like zombie.glb's (scaled by the mesh-measured hand size); skin weights renamed / merged onto it
"""
from __future__ import annotations

import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

from .config import CAST_BONES, TRI_TARGET

SIDES = ('L', 'R')
LIMB_ORDER = [f'{b}_{s}' for s in SIDES for b in ('upperarm', 'forearm', 'hand')] + \
             [f'{b}_{s}' for s in SIDES for b in ('thigh', 'shin', 'foot')]
CHAIN_CHILD = {'upperarm': 'forearm', 'forearm': 'hand', 'thigh': 'shin', 'shin': 'foot'}
SRC_NAME = {'pelvis': 'hips'}   # ours -> theirs (everything else has the same name)


def _src(n: str) -> str:
    return SRC_NAME.get(n, n)


def _select_only(ob) -> None:
    for o in bpy.context.view_layer.objects:
        if o is not None and o.select_get():
            o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def tri_count(me) -> int:
    return sum(len(p.vertices) - 2 for p in me.polygons)


# ---------------------------------------------------------------------------------------------------- import
def load_source(path: str) -> dict:
    before_obj = set(bpy.data.objects)
    before_act = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path, bone_heuristic='BLENDER')
    new = [o for o in bpy.data.objects if o not in before_obj]
    arm = next(o for o in new if o.type == 'ARMATURE')
    meshes = [o for o in new if o.type == 'MESH' and o.parent is arm]
    ob = max(meshes, key=lambda o: len(o.data.polygons))
    if arm.animation_data:
        for tr in list(arm.animation_data.nla_tracks):
            arm.animation_data.nla_tracks.remove(tr)
        arm.animation_data.action = None
    for a in list(bpy.data.actions):
        if a not in before_act:
            bpy.data.actions.remove(a)
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    marks = {}
    for o in new:
        if o.type == 'EMPTY':
            marks[o.name.split('.')[0]] = o.matrix_world.translation.copy()
    for o in new:
        if o is not arm and o is not ob:
            bpy.data.objects.remove(o, do_unlink=True)
    if arm.matrix_world != Matrix.Identity(4) or ob.matrix_world != Matrix.Identity(4):
        raise RuntimeError('source objects are not at identity transforms')
    ob.name = 'Body'
    ob.data.name = 'Body'
    return {'arm': arm, 'ob': ob, 'marks': marks}


def check_front(arm) -> None:
    """Zombie Smash 2 convention: toes toward -Y (Blender) == glTF +Z. Refuse anything else."""
    for s in SIDES:
        b = arm.data.bones[f'foot_{s}']
        if (b.tail_local - b.head_local).y > -0.05 * b.length:
            raise RuntimeError(f'foot_{s} does not point to -Y: front axis is not glTF +Z')


# ---------------------------------------------------------------------------------------------------- mesh
def weld_and_clean(ob) -> int:
    me = ob.data
    H = max(v.co.z for v in me.vertices)
    bm = bmesh.new()
    bm.from_mesh(me)
    n0 = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-5 * H)
    # drop tiny disconnected crumbs (scan noise) - they collapse to spikes after decimation
    bm.verts.ensure_lookup_table()
    bm.to_mesh(me)
    bm.free()
    _select_only(ob)
    if me.has_custom_normals:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    me.shade_smooth()
    me.update()
    return n0 - len(me.vertices)


#: vertex groups that mark a held prop from the weld to the weight remap (never exported)
PROP_TAG = {'L': '__prop_L', 'R': '__prop_R'}


def tag_prop_islands(ob) -> dict:
    """Mark the loose pieces of the source that are a held prop: a connected piece, not the body itself, whose
    vertices are all skinned to one hand or to a `prop_*` bone (the shield's lid, the streamer's phone). They stay
    loose through decimation and are later skinned to `prop_L` / `prop_R`, so the runtime can move a prop without
    the hand. A prop sculpted into the body surface is not a loose piece and is not found here."""
    me = ob.data
    nv = len(me.vertices)
    names = {g.index: g.name for g in ob.vertex_groups}
    hand = np.zeros((nv, 2))
    prop = np.zeros(nv)
    xs = np.empty(nv)
    for v in me.vertices:
        xs[v.index] = v.co.x
        for g in v.groups:
            n = names[g.group]
            if n == 'hand_L':
                hand[v.index, 0] += g.weight
            elif n == 'hand_R':
                hand[v.index, 1] += g.weight
            elif n.startswith('prop_'):
                prop[v.index] += g.weight
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    seen = np.zeros(nv, bool)
    pieces = []
    for v in bm.verts:
        if seen[v.index]:
            continue
        seen[v.index] = True
        stack, piece = [v], []
        while stack:
            u = stack.pop()
            piece.append(u.index)
            for e in u.link_edges:
                w = e.other_vert(u)
                if not seen[w.index]:
                    seen[w.index] = True
                    stack.append(w)
        pieces.append(piece)
    bm.free()
    body = max(pieces, key=len)
    found = {s: [] for s in SIDES}
    for piece in pieces:
        if piece is body:
            continue
        idx = np.array(piece)
        wl, wr, wp = hand[idx, 0].mean(), hand[idx, 1].mean(), prop[idx].mean()
        if max(wl, wr, wp) < 0.99:
            continue
        # the same side rule remap_weights uses for a prop bone: +X is the left hand
        side = 'L' if wl >= 0.99 else 'R' if wr >= 0.99 else ('L' if xs[idx].mean() > 0 else 'R')
        found[side].extend(int(i) for i in piece)
    for s in SIDES:
        if found[s]:
            ob.vertex_groups.new(name=PROP_TAG[s]).add(sorted(found[s]), 1.0, 'REPLACE')
    return {s: len(found[s]) for s in SIDES}


def _cap_loops(bm, edges, new_edges):
    """Make a face of every closed boundary loop (over `edges`) that contains an edge from `new_edges`."""
    from collections import defaultdict
    adj = defaultdict(list)
    for e in edges:
        a, b = e.verts
        adj[a].append((b, e))
        adj[b].append((a, e))
    pinched = sum(1 for v, ns in adj.items() if len(ns) != 2)
    seen, faces = set(), []
    for start in adj:
        if start in seen or len(adj[start]) != 2:
            continue
        loop, used, prev, cur = [start], [], None, start
        seen.add(start)
        while True:
            nxt = [(w, e) for w, e in adj[cur] if e is not prev]
            if not nxt:
                break
            w, e = nxt[0]
            used.append(e)
            if w is start or w in seen:
                break
            loop.append(w)
            seen.add(w)
            prev, cur = e, w
        if len(loop) >= 3 and any(e in new_edges for e in used):
            try:
                faces.append(bm.faces.new(loop))
            except ValueError:
                pass
    return faces, pinched


def cut_fused_prop(ob, arm, side: str, reach: float = 1.2) -> dict:
    """A prop sculpted into a hand (the boss's staff, the ringmaster's cane) is cut off ABOVE the fist with one plane
    and tagged as a prop piece, so step 2a skins it to prop_L / prop_R (W-120 step 2b, as decided: boss above the
    fist only; gamer and tourist are not cut).

    Prop vertices: skinned >= 95% to that hand and farther from the wrist than `reach` times the other, empty hand's
    own reach. Their principal axis is the prop's direction; the plane sits just past the fist along it. The mesh is
    bisected there, the prop side split off, and every new boundary loop capped on both sides. Open edges the source
    already had (eyes, mouth, tube ends) inside the hand region are closed first; elsewhere they are left alone.
    Returns counts; `open_new` must be 0."""
    from mathutils import Vector
    me = ob.data
    nv = len(me.vertices)
    names = {g.index: g.name for g in ob.vertex_groups}
    hand = {s: np.zeros(nv) for s in SIDES}
    for v in me.vertices:
        for g in v.groups:
            n = names[g.group]
            if n in ('hand_L', 'hand_R'):
                hand[n[-1]][v.index] += g.weight
    co = np.empty(nv * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    other = 'R' if side == 'L' else 'L'
    wrist = {s: np.array(arm.data.bones[f'hand_{s}'].head_local) for s in SIDES}
    plain = hand[other] >= 0.95
    r_hand = float(np.linalg.norm(co[plain] - wrist[other], axis=1).max())
    onhand = hand[side] >= 0.95
    prop = onhand & (np.linalg.norm(co - wrist[side], axis=1) > reach * r_hand)
    if not prop.any():
        raise RuntimeError(f'cut_fused_prop: nothing on hand_{side} beyond {reach:.2f} x the plain hand reach')
    P = co[prop]
    centre = P.mean(0)
    axis = np.linalg.svd(P - centre)[2][0]
    t = (co - centre) @ axis
    if t[prop].mean() < t[onhand & ~prop].mean():
        axis, t = -axis, -t                              # the prop points along +axis, away from the fist
    t_cut = float(t[onhand & ~prop].max()) + 0.02 * r_hand
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    pre = [e for e in bm.edges if e.is_boundary and all(onhand[v.index] for v in e.verts)]
    bmesh.ops.holes_fill(bm, edges=pre, sides=0)
    open_set = set(e for e in bm.edges if e.is_boundary)
    region = [f for f in bm.faces if any(onhand[v.index] for v in f.verts)]
    geom = list(set(v for f in region for v in f.verts)) + list(set(e for f in region for e in f.edges)) + region
    plane_co, plane_no = Vector(centre + axis * t_cut), Vector(axis)
    res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=plane_co, plane_no=plane_no, clear_inner=False, clear_outer=False)
    cut_verts = [v for v in res['geom_cut'] if isinstance(v, bmesh.types.BMVert)]
    gf = [g for g in geom if isinstance(g, bmesh.types.BMFace) and g.is_valid] + [f for v in cut_verts for f in v.link_faces]
    side_faces = list(set(f for f in gf if (Vector(f.calc_center_median()) - plane_co).dot(plane_no) > 1e-6))
    sp = bmesh.ops.split(bm, geom=side_faces, use_only_faces=True)
    piece_set = set(v for g in sp['geom'] if isinstance(g, bmesh.types.BMVert) for v in [g])
    bm.verts.ensure_lookup_table()
    new_edges = set(e for e in bm.edges if e.is_boundary and e not in open_set)
    caps, pinched = _cap_loops(bm, [e for e in bm.edges if e.is_boundary], new_edges)
    left = [e for e in bm.edges if e.is_boundary and e not in open_set]
    if left:                                              # a loop that touches a pinched source vertex: let Blender fill it
        filled = bmesh.ops.holes_fill(bm, edges=left, sides=0)
        caps += filled['faces']
        left = [e for e in bm.edges if e.is_boundary and e not in open_set]
        if left:
            filled = bmesh.ops.triangle_fill(bm, edges=left, use_beauty=True)
            caps += [g for g in filled['geom'] if isinstance(g, bmesh.types.BMFace)]
        left = [e for e in bm.edges if e.is_boundary and e not in open_set]
        # a crack: two boundary edges sharing a vertex whose far ends are already joined by an edge -> one triangle
        for e1 in list(left):
            for e2 in list(left):
                if e1 is e2 or not (e1.is_valid and e2.is_valid):
                    continue
                shared = set(e1.verts) & set(e2.verts)
                if len(shared) != 1:
                    continue
                b_ = shared.pop()
                a_, c_ = e1.other_vert(b_), e2.other_vert(b_)
                if bm.edges.get([a_, c_]) is not None and bm.faces.get([a_, b_, c_]) is None:
                    try:
                        caps.append(bm.faces.new([a_, b_, c_]))
                    except ValueError:
                        pass
    bmesh.ops.triangulate(bm, faces=caps)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    # a fin: a face with two of its edges on the new boundary is a sliver the bisect left standing; drop it
    fins = [f for f in set(f for e in bm.edges if e.is_boundary and e not in open_set for f in e.link_faces)
            if sum(1 for e in f.edges if e.is_boundary and e not in open_set) >= 2]
    if fins:
        bmesh.ops.delete(bm, geom=fins, context='FACES')
    open_new = sum(1 for e in bm.edges if e.is_boundary and e not in open_set)
    bm.verts.index_update()
    piece = sorted(v.index for v in piece_set if v.is_valid)
    bm.to_mesh(me)
    bm.free()
    me.update()
    (ob.vertex_groups.get(PROP_TAG[side]) or ob.vertex_groups.new(name=PROP_TAG[side])).add(piece, 1.0, 'REPLACE')
    return {'side': side, 'prop_verts': int(prop.sum()), 'piece_verts': len(piece), 'faces_split': len(side_faces),
            'caps': len(caps), 'pinched': pinched, 'open_new': open_new, 'cut_m_past_wrist': round(t_cut - float(((wrist[side] - centre) @ axis)), 4)}


def decimate(ob, target: int = TRI_TARGET) -> int:
    me = ob.data
    arm_mods = [m for m in ob.modifiers if m.type == 'ARMATURE']
    arm_obj = arm_mods[0].object if arm_mods else None
    for m in list(ob.modifiers):
        ob.modifiers.remove(m)
    _select_only(ob)
    ratio = target / max(1, tri_count(me))
    for _ in range(4):
        if tri_count(me) <= target:
            break
        dm = ob.modifiers.new('dec', 'DECIMATE')
        dm.decimate_type = 'COLLAPSE'
        dm.ratio = min(1.0, ratio)
        dm.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=dm.name)
        ratio = target / max(1, tri_count(me)) * 0.995
    if arm_obj is not None:
        am = ob.modifiers.new('Armature', 'ARMATURE')
        am.object = arm_obj
    return tri_count(me)


# ---------------------------------------------------------------------------------------------------- weights QA
def head_dominance(ob) -> float:
    """Fraction of the lower-half vertices whose dominant weight is 'head' (a broken source skin is ~1.0)."""
    me = ob.data
    H = max(v.co.z for v in me.vertices)
    gi = ob.vertex_groups.get('head')
    if gi is None:
        return 0.0
    low = n = 0
    for v in me.vertices:
        if v.co.z > 0.5 * H or not v.groups:
            continue
        n += 1
        g = max(v.groups, key=lambda g: g.weight)
        low += g.group == gi.index
    return low / max(1, n)


def auto_weights(src: dict, voxel_frac: float = 0.012) -> dict:
    """Re-skin from scratch on THEIR skeleton (for sources whose shipped weights are unusable): voxel-remeshed
    watertight proxy -> bone-heat weights -> nearest-face-interpolated transfer onto the real mesh -> smooth,
    limit 4, normalise (the same recipe as zombie-smash-2's rig_character.py)."""
    arm, ob = src['arm'], src['ob']
    me = ob.data
    H = max(v.co.z for v in me.vertices)
    for b in arm.data.bones:
        b.use_deform = b.name not in ('root', 'neutral_bone')
    for m in list(ob.modifiers):
        ob.modifiers.remove(m)
    for g in list(ob.vertex_groups):
        ob.vertex_groups.remove(g)
    sc = bpy.context.scene
    for k, vs in enumerate((voxel_frac, voxel_frac * 1.6, voxel_frac * 2.5)):
        prx = ob.copy()
        prx.data = ob.data.copy()
        prx.name = 'WeightProxy'
        sc.collection.objects.link(prx)
        rm = prx.modifiers.new('vox', 'REMESH')
        rm.mode = 'VOXEL'
        rm.voxel_size = vs * H
        _select_only(prx)
        bpy.ops.object.modifier_apply(modifier='vox')
        _select_only(prx)
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
        bad = sum(1 for v in prx.data.vertices if not any(g.weight > 1e-4 for g in v.groups))
        if bad < 0.01 * len(prx.data.vertices):
            break
        bpy.data.objects.remove(prx, do_unlink=True)
        if k == 2:
            raise RuntimeError('bone heat failed at every voxel size')
    for b in arm.data.bones:
        if b.use_deform:
            ob.vertex_groups.new(name=b.name)
    dt = ob.modifiers.new('dt', 'DATA_TRANSFER')
    dt.object = prx
    dt.use_vert_data = True
    dt.data_types_verts = {'VGROUP_WEIGHTS'}
    dt.vert_mapping = 'POLYINTERP_NEAREST'
    dt.layers_vgroup_select_src = 'ALL'
    dt.layers_vgroup_select_dst = 'NAME'
    _select_only(ob)
    bpy.ops.object.modifier_apply(modifier='dt')
    bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
    bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.5, repeat=3)
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.data.objects.remove(prx, do_unlink=True)
    am = ob.modifiers.new('Armature', 'ARMATURE')
    am.object = arm
    return {'voxel': vs, 'unweighted_proxy': bad}


# ---------------------------------------------------------------------------------------------------- repose
def _rot_about(axis: Vector, deg: float) -> Matrix:
    return Matrix.Rotation(math.radians(deg), 3, axis)


def limb_targets(zref, profile: dict) -> dict[str, Vector]:
    """Rest directions (Blender armature space) the source limbs are re-posed to."""
    out = {}
    abd = profile.get('arm_abduction', 0.0)
    fwd = profile.get('arm_forward', 0.0)
    leg_abd = profile.get('leg_abduction', 0.0)
    for s in SIDES:
        sg = 1.0 if s == 'L' else -1.0
        # +Y axis rotation tilts a downward-pointing vector toward -X... rotate about the front axis so the arm swings
        # outward (away from the body midline) by `abd` degrees; about X so it swings forward by `fwd` degrees.
        R_arm = _rot_about(Vector((1, 0, 0)), -fwd) @ _rot_about(Vector((0, 1, 0)), -sg * abd)
        R_leg = _rot_about(Vector((0, 1, 0)), -sg * leg_abd)
        for b in ('upperarm', 'forearm', 'hand'):
            out[f'{b}_{s}'] = (R_arm @ zref.dir[f'{b}_{s}']).normalized()
        for b in ('thigh', 'shin'):
            out[f'{b}_{s}'] = (R_leg @ zref.dir[f'{b}_{s}']).normalized()
        out[f'foot_{s}'] = zref.dir[f'foot_{s}'].normalized()
    return out


def repose(src: dict, targets: dict[str, Vector], keep: set[str] = frozenset()) -> dict:
    """Rotate each limb segment (posed, in hierarchy order) onto its target direction, then apply the armature
    modifier so the posed shape becomes the rest shape. Returns posed joints {bone: (head, tail)}."""
    arm, ob = src['arm'], src['ob']
    pbs = arm.pose.bones
    applied = {}
    for name in LIMB_ORDER:
        if name in keep:
            continue
        bpy.context.view_layer.update()
        pb = pbs[name]
        kind, side = name.split('_')
        head = pb.head.copy()
        child = CHAIN_CHILD.get(kind)
        cur = (pbs[f'{child}_{side}'].head - head) if child else (pb.tail - head)
        if cur.length < 1e-6:
            continue
        q = cur.normalized().rotation_difference(targets[name])
        M = Matrix.Translation(head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head)
        pb.matrix = M @ pb.matrix
        applied[name] = round(math.degrees(q.angle), 1)
    bpy.context.view_layer.update()
    joints = {pb.name: (pb.head.copy(), pb.tail.copy()) for pb in pbs}
    am = next(m for m in ob.modifiers if m.type == 'ARMATURE')
    _select_only(ob)
    bpy.ops.object.modifier_apply(modifier=am.name)
    return {'joints': joints, 'angles': applied}


def normalize(src: dict, joints: dict, height: float) -> dict:
    """Uniform scale to `height`, feet on z=0, pelvis (their hips joint) on x=y=0. Returns the transform + joints."""
    ob = src['ob']
    me = ob.data
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    zmin, zmax = float(co[:, 2].min()), float(co[:, 2].max())
    S = height / (zmax - zmin)
    hx, hy = joints['hips'][0].x, joints['hips'][0].y
    M = Matrix.Translation((-hx * S, -hy * S, -zmin * S)) @ Matrix.Scale(S, 4)
    me.transform(M)
    me.update()
    J = {n: (M @ h, M @ t) for n, (h, t) in joints.items()}
    marks = {n: M @ p for n, p in src['marks'].items()}
    return {'M': M, 'S': S, 'joints': J, 'marks': marks}


# ---------------------------------------------------------------------------------------------------- our rig
def _hand_tip(co: np.ndarray, w: np.ndarray, head: Vector, tail: Vector) -> float | None:
    """95th percentile reach (m) of a hand's vertices along its bone axis, measured only within 6 cm of the axis
    (a held lid / pizza box / dumbbell spreads sideways and is ignored)."""
    ax = np.array(tail - head)
    if np.linalg.norm(ax) < 1e-6:
        return None
    ax /= np.linalg.norm(ax)
    rel = co[w > 0.5] - np.array(head)
    proj = rel @ ax
    lat = np.linalg.norm(rel - np.outer(proj, ax), axis=1)
    sel = (lat < 0.06) & (proj > -0.02)
    return float(np.percentile(proj[sel], 95)) if sel.sum() >= 10 else None


def hand_scale(ob, J: dict, zref) -> dict:
    """Hand size of this body relative to the classic hand, from the MESH (wrist -> fingertip reach), not from bone
    lengths: the source rigs' hand bones run wrist -> fingertip while zombie.glb's hand bone (and its palm / carry
    anchors) is laid out on its own 0.11 m hand, so a bone-length ratio over-scaled every palm anchor ~3x (the plate
    floated ~20 cm off the hand, the phone ~10 cm off the ear). Same factor for both hands: the smaller hand wins
    (a held prop only ever enlarges one side)."""
    me = ob.data
    nv = len(me.vertices)
    co = np.empty(nv * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    tips = []
    for s in SIDES:
        g = ob.vertex_groups.get(f'hand_{s}')
        if g is None:
            continue
        w = np.zeros(nv)
        for v in me.vertices:
            for e in v.groups:
                if e.group == g.index:
                    w[v.index] = e.weight
        t = _hand_tip(co, w, J[f'hand_{s}'][0], J[f'hand_{s}'][1])
        if t is not None:
            tips.append(t)
    zt = []
    for s in SIDES:
        zo = next((o for o in zref.meshes if o.name == f'Z_Hand_{s}'), None)
        if zo is None:
            continue
        zc = np.array([zo.matrix_world @ v.co for v in zo.data.vertices])
        zt.append(_hand_tip(zc, np.ones(len(zc)), zref.head[f'hand_{s}'], zref.tail[f'hand_{s}']))
    zt = [t for t in zt if t]
    if not tips or not zt:
        raise RuntimeError('cannot measure the hand size')
    k = min(max(min(tips) / (sum(zt) / len(zt)), 0.6), 2.2)
    return {'k': round(k, 4), 'tip': round(min(tips), 4), 'zombieTip': round(sum(zt) / len(zt), 4)}


def cast_joints(J: dict, zref, pelvis_z: float, top: float, hand_k: float) -> dict:
    """Bone heads + lengths for OUR skeleton from the fitted joints (normalised space). hand_k = hand_scale()['k']."""
    heads, lengths = {}, {}
    heads['root'] = Vector((0, 0, 0))
    lengths['root'] = 0.22 * top / 1.62
    heads['pelvis'] = Vector((0, 0, pelvis_z))
    for n in ('spine', 'chest', 'neck', 'head'):
        heads[n] = J[n][0].copy()
    for s in SIDES:
        for b in ('shoulder', 'upperarm', 'forearm', 'hand', 'thigh', 'shin', 'foot'):
            heads[f'{b}_{s}'] = J[f'{b}_{s}'][0].copy()
    nxt = {'pelvis': 'spine', 'spine': 'chest', 'chest': 'neck', 'neck': 'head'}
    for n, c in nxt.items():
        lengths[n] = max(0.03, (heads[c] - heads[n]).length)
    lengths['head'] = max(0.05, 0.9 * (top - heads['head'].z))
    for s in SIDES:
        lengths[f'shoulder_{s}'] = max(0.03, (heads[f'upperarm_{s}'] - heads[f'shoulder_{s}']).length)
        lengths[f'upperarm_{s}'] = (heads[f'forearm_{s}'] - heads[f'upperarm_{s}']).length
        lengths[f'forearm_{s}'] = (heads[f'hand_{s}'] - heads[f'forearm_{s}']).length
        lengths[f'hand_{s}'] = (J[f'hand_{s}'][1] - J[f'hand_{s}'][0]).length
        lengths[f'thigh_{s}'] = (heads[f'shin_{s}'] - heads[f'thigh_{s}']).length
        lengths[f'shin_{s}'] = (heads[f'foot_{s}'] - heads[f'shin_{s}']).length
        lengths[f'foot_{s}'] = (J[f'foot_{s}'][1] - J[f'foot_{s}'][0]).length
        # prop bone: zombie.glb's palm offset in the hand frame, scaled by the measured hand size
        k = hand_k
        heads[f'prop_{s}'] = heads[f'hand_{s}'] + (zref.head[f'prop_{s}'] - zref.head[f'hand_{s}']) * k
        lengths[f'prop_{s}'] = zref.length[f'prop_{s}'] * k
    return {'heads': heads, 'lengths': lengths}


def build_armature(cj: dict, zref, name: str = 'Rig'):
    data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(arm)
    _select_only(arm)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = data.edit_bones
    zb = zref.arm.data.bones
    for n in CAST_BONES:
        b = eb.new(n)
        h = Vector(cj['heads'][n])
        b.head = h
        b.tail = h + zref.vec[n] * (cj['lengths'][n] / zref.vec[n].length)
        b.roll = zref.roll[n]
        b.use_connect = False
        b.use_deform = n != 'root' and not n.startswith('prop_')
    for n in CAST_BONES:
        p = zb[n].parent
        if p is not None:
            eb[n].parent = eb[p.name]
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return arm


def set_pelvis_head(arm, zref, z: float) -> None:
    _select_only(arm)
    bpy.ops.object.mode_set(mode='EDIT')
    b = arm.data.edit_bones['pelvis']
    L = b.length
    b.head = (0, 0, z)
    b.tail = Vector((0, 0, z)) + zref.vec['pelvis'] * (L / zref.vec['pelvis'].length)
    b.roll = zref.roll['pelvis']
    bpy.ops.object.mode_set(mode='OBJECT')


def rest_rotation_error(arm, zref) -> float:
    err = 0.0
    for b in arm.data.bones:
        d = b.matrix_local.to_3x3() - zref.rest_rot[b.name]
        err = max(err, max(abs(x) for r in d for x in r))
    return err


# ---------------------------------------------------------------------------------------------------- weights
def remap_weights(ob, J: dict, hip_z: float) -> dict:
    """Rename / merge the source vertex groups onto our bone set. Returns stats + the per-vertex 'skirt' mask."""
    me = ob.data
    nv = len(me.vertices)
    names = [g.name for g in ob.vertex_groups]
    W = np.zeros((nv, len(names)), np.float64)
    for v in me.vertices:
        for g in v.groups:
            W[v.index, g.group] = g.weight
    deform = [n for n in CAST_BONES if n != 'root' and not n.startswith('prop_')]
    out = {n: np.zeros(nv) for n in deform}
    co = np.empty(nv * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    skirt = np.zeros(nv)
    stats = {}
    tagged = {s: (W[:, names.index(PROP_TAG[s])] > 0.5 if PROP_TAG[s] in names else np.zeros(nv, bool)) for s in SIDES}
    for gi, gname in enumerate(names):
        w = W[:, gi]
        if not w.any() or gname in PROP_TAG.values():
            continue
        tgt = 'pelvis' if gname == 'hips' else gname
        if tgt in out:
            out[tgt] += w
        elif gname.startswith('skirt_'):
            # dress / robe: blend from the pelvis at the waist toward the thigh on the vertex's side lower down,
            # so a seated or striding body carries its skirt with the legs instead of through them
            u = np.clip((hip_z - co[:, 2]) / max(0.45 * hip_z, 1e-6), 0, 1)
            k = 0.8 * u * u * (3 - 2 * u)
            xw = 0.06 * hip_z
            t = np.clip((co[:, 0] + xw) / (2 * xw), 0, 1)
            t = t * t * (3 - 2 * t)
            out['pelvis'] += w * (1 - k)
            out['thigh_L'] += w * k * t
            out['thigh_R'] += w * k * (1 - t)
            skirt += w
        elif gname.startswith('cape_'):
            out['pelvis'] += w
            skirt += w
        elif gname.startswith('prop_'):
            # held prop (phone): rigid on the nearer hand
            hx = J[gname][0].x if gname in J else float(np.average(co[:, 0], weights=w))
            out['hand_L' if hx > 0 else 'hand_R'] += w
        else:
            # unknown helper bone: nearest of our bones by head distance
            h = J[gname][0] if gname in J else Vector(np.average(co, axis=0, weights=w))
            best = min((n for n in deform if _src(n) in J), key=lambda n: (J[_src(n)][0] - h).length)
            out[best] += w
        stats[gname] = int((w > 0.01).sum())
    # normalise, prune < 0.02, keep the 4 largest
    M = np.stack([out[n] for n in deform], 1)
    # limb-loss hygiene: vertices owned by the torso / another limb never carry forearm/hand or shin/foot weight
    # (otherwise collapsing that bone drags them along = a tear); a dress never follows the shins.
    col = {n: j for j, n in enumerate(deform)}
    dom = M.argmax(1)
    for s in SIDES:
        for chain, lower in (((f'upperarm_{s}', f'forearm_{s}', f'hand_{s}'), (f'forearm_{s}', f'hand_{s}')),
                             ((f'thigh_{s}', f'shin_{s}', f'foot_{s}'), (f'shin_{s}', f'foot_{s}'))):
            outside = ~np.isin(dom, [col[n] for n in chain])
            if lower[0].startswith('shin'):
                outside |= skirt > 0.3
            for n in lower:
                M[outside, col[n]] = 0
    M[M < 0.02] = 0
    if M.shape[1] > 4:
        idx = np.argsort(-M, axis=1)[:, 4:]
        np.put_along_axis(M, idx, 0, axis=1)
    tot = M.sum(1)
    unweighted = int((tot < 1e-6).sum())
    if unweighted:
        # orphan verts -> nearest bone segment
        heads = np.array([J[_src(n)][0] for n in deform])
        tails = np.array([J[_src(n)][1] for n in deform])
        for i in np.nonzero(tot < 1e-6)[0]:
            p = co[i]
            ab = tails - heads
            t = np.clip(((p - heads) * ab).sum(1) / np.maximum((ab * ab).sum(1), 1e-12), 0, 1)
            d = np.linalg.norm(p - (heads + ab * t[:, None]), axis=1)
            M[i, int(d.argmin())] = 1.0
        tot = M.sum(1)
    M /= tot[:, None]
    # a held prop is rigid on its hand. In W (what the measurements pose with) it stays on `hand_*`; in the mesh it
    # is skinned to `prop_*`, the hand's child, which no clip moves - the same motion, but the runtime can move the
    # prop bone to stow the prop (W-120)
    is_prop = tagged['L'] | tagged['R']
    for s in SIDES:
        M[tagged[s], :] = 0.0
        M[tagged[s], col[f'hand_{s}']] = 1.0
    # skirt / cape hem mask (W-120): 1 at the free edge, 0 where the cloth attaches; a marker only, no bone
    hem = np.zeros(nv)
    cloth = skirt > 0.05
    if cloth.any():
        z_lo, z_hi = float(co[cloth, 2].min()), float(co[cloth, 2].max())
        u = np.clip((z_hi - co[:, 2]) / max(z_hi - z_lo, 1e-6), 0, 1)
        hem = np.where(cloth, np.clip(skirt, 0, 1) * u * u * (3 - 2 * u), 0.0)
        if hem.max() > 0:
            hem = hem / hem.max()                        # exactly 1 at the lowest, loosest edge
    for g in list(ob.vertex_groups):
        ob.vertex_groups.remove(g)
    for j, n in enumerate(deform):
        vg = ob.vertex_groups.new(name=n)
        col_j = np.where(is_prop, 0.0, M[:, j])
        col = col_j
        nz = np.nonzero(col > 0)[0]
        # group by identical weight is slow; add per-vertex (deterministic order)
        for i in nz:
            vg.add([int(i)], float(col[i]), 'REPLACE')
    for s in SIDES:
        if tagged[s].any():
            ob.vertex_groups.new(name=f'prop_{s}').add([int(i) for i in np.nonzero(tagged[s])[0]], 1.0, 'REPLACE')
    return {'merged': stats, 'unweighted_fixed': unweighted, 'skirt': skirt > 0.3, 'cloth': skirt > 0.02, 'W': M,
            'bones': deform, 'props': {s: int(tagged[s].sum()) for s in SIDES}, 'hem': np.round(hem, 4)}


def bind(ob, arm) -> None:
    ob.parent = arm
    ob.matrix_parent_inverse = Matrix.Identity(4)
    for m in list(ob.modifiers):
        ob.modifiers.remove(m)
    am = ob.modifiers.new('Armature', 'ARMATURE')
    am.object = arm


PROP_FOOT_Z, PROP_FOOT_R = 0.05, 0.06   # m, prop-bone frame: centre (along +Z) and radius of a carried item's footprint


def _prop_surface(P: Matrix, pts: np.ndarray) -> float | None:
    """Highest point (along the prop bone, +Y = up off the palm) of `pts` (world) under a carried item's footprint,
    in the frame of the prop bone whose rest matrix (world) is P."""
    if not len(pts):
        return None
    inv = np.array(P.inverted())
    q = pts @ inv[:3, :3].T + inv[:3, 3]
    under = np.hypot(q[:, 0], q[:, 2] - PROP_FOOT_Z) < PROP_FOOT_R
    return float(q[under, 1].max()) if under.any() else None


def settle_prop_bones(ob, arm, zref, weights: dict) -> dict:
    """Seat the prop bones (the default palm carry's frame; no clip moves them) on this body's hands. Scaling
    zombie.glb's palm offset by the hand size fits a cartoon mitten; a realistic hand is thinner and its fingers
    curl, so a carried item hovers 1-4 cm over it. Each prop bone moves along its own axis until the hand surface
    under an item's footprint is where the classic hand's is in the classic prop frame. Call after bind, at rest,
    before anything reads the prop bones. Returns {side: moved m | None (no hand under the footprint)}."""
    co = np.empty(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get('co', co)
    mw = np.array(ob.matrix_world)
    co = co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
    dom = weights['W'].argmax(1)
    moves = {}
    for s in SIDES:
        zo = next((o for o in zref.meshes if o.name == f'Z_Hand_{s}'), None)
        hc = None if zo is None else _prop_surface(
            zref.arm.matrix_world @ zref.arm.data.bones[f'prop_{s}'].matrix_local,
            np.array([zo.matrix_world @ v.co for v in zo.data.vertices]))
        hb = _prop_surface(arm.matrix_world @ arm.data.bones[f'prop_{s}'].matrix_local,
                           co[dom == weights['bones'].index(f'hand_{s}')])
        moves[s] = None if hc is None or hb is None else hb - hc
    _select_only(arm)
    bpy.ops.object.mode_set(mode='EDIT')
    for s, m in moves.items():
        if m:
            b = arm.data.edit_bones[f'prop_{s}']
            d = (b.tail - b.head).normalized() * m
            b.head, b.tail = b.head + d, b.tail + d
    bpy.ops.object.mode_set(mode='OBJECT')
    return {s: None if m is None else round(m, 4) for s, m in moves.items()}


def evaluated_coords(ob) -> np.ndarray:
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    ev.to_mesh_clear()
    co = co.reshape(-1, 3)
    mw = np.array(ob.matrix_world)
    return co @ mw[:3, :3].T + mw[:3, 3]
