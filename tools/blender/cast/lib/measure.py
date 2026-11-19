"""Anchor fitting + quality checks, all measured on the skinned mesh posed with the zombie.glb clips through the
runtime rule (retarget.apply_pose)."""
from __future__ import annotations

import json

import bpy
import numpy as np
from mathutils import Vector

from . import retarget as RT
from .body import evaluated_coords, set_pelvis_head
from .config import SIT_CLIPS

SEAT_FWD = 0.12        # seat region (hip mass): up to this far (m) in front of the posed pelvis origin


def gl(co: np.ndarray) -> np.ndarray:
    """Blender (x, y, z) -> glTF (x, z, -y) for an (N, 3) array."""
    return np.stack([co[:, 0], co[:, 2], -co[:, 1]], 1)


# ------------------------------------------------------------------------------------------------ zombie targets
def zombie_targets(zref) -> dict:
    """Seat-contact and lying extents of the classic body itself (the cast must match them)."""
    out = {}
    names_seat = ('Z_Torso',)
    mins = []
    f0, f1 = zref.clip_frames('sit')
    for fr in (f0, (f0 + f1) // 2):
        zref.set_clip('sit', fr)
        bpy.context.view_layer.update()
        pel = RT.to_gl(zref.arm.pose.bones['pelvis'].head)
        for o in zref.meshes:
            if o.name in names_seat:
                c = gl(evaluated_coords(o))
                m = c[:, 2] < pel.z + SEAT_FWD
                mins.append(float(c[m, 1].min()))
    out['seat_min_y'] = min(mins)
    zref.set_clip('sit', (f0 + f1) // 2)
    bpy.context.view_layer.update()
    out['sit_knee_z'] = max(RT.to_gl(zref.arm.pose.bones[f'shin_{s}'].head).z for s in 'LR')
    zref.set_clip('sleep', zref.clip_frames('sleep')[0])
    bpy.context.view_layer.update()
    allc = np.concatenate([gl(evaluated_coords(o)) for o in zref.meshes])
    out['lie_min_y'] = float(allc[:, 1].min())
    out['lie_center_z'] = float((allc[:, 2].min() + allc[:, 2].max()) / 2)
    zref.clear()
    bpy.context.view_layer.update()
    return out


# ------------------------------------------------------------------------------------------------ cast fitting
def _dominant(weights: dict, names) -> np.ndarray:
    bi = [weights['bones'].index(n) for n in names]
    return np.isin(weights['W'].argmax(1), bi)


def seat_region(ob, arm, weights: dict, thigh_len: float) -> np.ndarray:
    rest = np.empty(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get('co', rest)
    rz = rest.reshape(-1, 3)[:, 2]
    hip_z = (arm.data.bones['thigh_L'].head_local.z + arm.data.bones['thigh_R'].head_local.z) / 2
    band = (rz > hip_z - 0.35 * thigh_len) & (rz < hip_z + 0.12)
    region = _dominant(weights, ('pelvis',)) & ~weights['skirt'] & band
    if region.sum() < 20:   # long dress / robe: the hip mass is skirt-weighted
        region = _dominant(weights, ('pelvis', 'thigh_L', 'thigh_R')) & band
    return region


def seat_probe(zref, ob, arm, body: dict, weights: dict, n: int = 24) -> list:
    """Rest positions (glTF coords) of the n hip-mass vertices lowest in the seated pose (for the TS tests)."""
    thigh_len = (arm.data.bones['thigh_L'].length + arm.data.bones['thigh_R'].length) / 2
    region = seat_region(ob, arm, weights, thigh_len)
    f0, f1 = zref.clip_frames('sit')
    RT.apply_pose(zref, arm, 'sit', (f0 + f1) // 2, body)
    c = gl(evaluated_coords(ob))
    pel = RT.to_gl(arm.pose.bones['pelvis'].head)
    RT.rest_pose(arm)
    rest = np.empty(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get('co', rest)
    rest = gl(rest.reshape(-1, 3))
    idx = np.nonzero(region & (c[:, 2] < pel.z + SEAT_FWD))[0]
    idx = idx[np.argsort(c[idx, 1], kind='stable')[:n]]
    return [[round(float(v), 5) for v in rest[i]] for i in sorted(idx.tolist())]


def seat_min(zref, ob, arm, body: dict, weights: dict, thigh_len: float, clip='sit') -> float:
    region = seat_region(ob, arm, weights, thigh_len)
    f0, f1 = zref.clip_frames(clip)
    best = 1e9
    for fr in (f0, (f0 + f1) // 2):
        RT.apply_pose(zref, arm, clip, fr, body)
        c = gl(evaluated_coords(ob))
        pel = RT.to_gl(arm.pose.bones['pelvis'].head)
        m = region & (c[:, 2] < pel.z + SEAT_FWD)
        if m.any():
            best = min(best, float(c[m, 1].min()))
    RT.rest_pose(arm)
    return best


def fit_seat(zref, ob, arm, body: dict, weights: dict, targets: dict, log) -> dict:
    """Move the pelvis bone origin (rest) so the seated hip mass touches SEAT_HEIGHT; residual -> seatPelvisOffset."""
    thigh_len = (arm.data.bones['thigh_L'].length + arm.data.bones['thigh_R'].length) / 2
    hip_z = (arm.data.bones['thigh_L'].head_local.z + arm.data.bones['thigh_R'].head_local.z) / 2
    lo, hi = hip_z - 0.55 * thigh_len, hip_z + 0.05
    rest = np.empty(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get('co', rest)
    rz = rest.reshape(-1, 3)[:, 2]
    pz = arm.data.bones['pelvis'].head_local.z
    body['seatPelvisOffset'] = [0.0, 0.0, 0.0]
    for it in range(5):
        body['pelvisRest'] = list(RT.to_gl(arm.data.bones['pelvis'].head_local))
        sm = seat_min(zref, ob, arm, body, weights, thigh_len)
        delta = sm - targets['seat_min_y']
        log(f'    seat iter {it}: pelvis z {pz:.4f} seat min {sm:.4f} (target {targets["seat_min_y"]:.4f})')
        if abs(delta) < 0.002:
            break
        npz = min(hi, max(lo, pz + delta))
        if abs(npz - pz) < 1e-5:
            break
        pz = npz
        set_pelvis_head(arm, zref, pz)
    body['pelvisRest'] = [round(x, 5) for x in RT.to_gl(arm.data.bones['pelvis'].head_local)]
    sm = seat_min(zref, ob, arm, body, weights, thigh_len)
    resid = targets['seat_min_y'] - sm
    body['seatPelvisOffset'] = [0.0, round(resid, 4) if abs(resid) >= 0.002 else 0.0, 0.0]
    # long-legged bodies: lift the knees in sit* until the feet stay above the floor
    feet = (rz < 0.12) & _dominant(weights, ('shin_L', 'shin_R', 'foot_L', 'foot_R'))
    body['sitThighLift'] = 0.0
    lift = 0.0
    for _ in range(16):
        lowest = 1e9
        for clip in SIT_CLIPS:
            g0, g1 = zref.clip_frames(clip)
            for fr in (g0, (g0 + g1) // 2):
                RT.apply_pose(zref, arm, clip, fr, body)
                c = gl(evaluated_coords(ob))
                lowest = min(lowest, float(c[feet, 1].min()))
        if lowest >= -0.01 or lift >= 45:
            break
        lift += 3.0
        body['sitThighLift'] = lift
    RT.rest_pose(arm)
    # short-thighed (big-headed) bodies: slide forward on the seat until the knees clear the seat front like the
    # classic body's do (otherwise the shins pass through the chair)
    f0, f1 = zref.clip_frames('sit')
    RT.apply_pose(zref, arm, 'sit', (f0 + f1) // 2, body)
    knee = max(RT.to_gl(arm.pose.bones[f'shin_{s}'].head).z for s in 'LR')
    RT.rest_pose(arm)
    dz = min(0.15, max(0.0, targets['sit_knee_z'] - knee))
    body['seatPelvisOffset'][2] = round(dz, 4) if dz >= 0.005 else 0.0
    return {'pelvis_z': pz, 'seat_min_y': sm, 'residual': resid, 'knee_z': knee, 'forward': dz,
            'thigh_lift': lift, 'sit_feet_min_y': lowest}


def fit_thigh_lift_by_clip(zref, ob, arm, body: dict, weights: dict) -> dict:
    """Per sit clip: the smallest thigh lift (0.5 deg steps, 0..45) that keeps the feet on the floor through the
    clip (first, middle and last frame). Stored as body['sitThighLiftByClip']; body['sitThighLift'] stays the
    largest of them (what a reader without the per-clip table applies)."""
    rest = np.empty(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get('co', rest)
    rz = rest.reshape(-1, 3)[:, 2]
    feet = (rz < 0.12) & _dominant(weights, ('shin_L', 'shin_R', 'foot_L', 'foot_R'))
    out, lows = {}, {}
    for clip in SIT_CLIPS:
        g0, g1 = zref.clip_frames(clip)
        lift, lowest = 0.0, 0.0
        while True:
            body['sitThighLiftByClip'] = {clip: lift}
            lowest = 1e9
            for fr in (g0, (g0 + g1) // 2, g1):
                RT.apply_pose(zref, arm, clip, fr, body)
                lowest = min(lowest, float(gl(evaluated_coords(ob))[feet, 1].min()))
            if lowest >= 0.003 or lift >= 45.0:
                break
            lift += 0.5
        out[clip] = lift
        lows[clip] = round(lowest, 4)
    RT.rest_pose(arm)
    body['sitThighLiftByClip'] = out
    body['sitThighLift'] = max(out.values())
    return {'lift': out, 'feet_min_y': lows}


def fit_book_anchors(zref, arm, body: dict, carry: dict, arm_k: float) -> dict:
    """Chest-anchored book ('read', 'sitRead'): put it where THIS body's hands are. zombie.glb's anchor keeps a fixed
    offset from the classic chest, so on a deep chest or belly the book sits inside the body and away from the
    hands. Rule (middle frame of the clip): origin = midpoint of the two palms (prop bones) in the chest frame +
    the classic anchor's offset from the classic palms' midpoint, scaled by the arm length ratio. Rotation kept."""
    out = {}
    for key in ('read', 'sitRead'):
        e = carry.get(key)
        if not e or e.get('bone') != 'chest':
            continue
        clip = key if key in zref.actions else 'sitRead'
        g0, g1 = zref.clip_frames(clip)
        fr = (g0 + g1) // 2
        zref.set_clip(clip, fr)
        bpy.context.view_layer.update()
        zp = zref.arm.pose.bones
        zmid = (zp['prop_L'].head + zp['prop_R'].head) / 2
        zlocal = zp['chest'].matrix.inverted() @ zmid
        RT.apply_pose(zref, arm, clip, fr, body)
        cp = arm.pose.bones
        cmid = (cp['prop_L'].head + cp['prop_R'].head) / 2
        clocal = cp['chest'].matrix.inverted() @ cmid
        m = list(e['matrix'])
        # e['matrix'] was already scaled by arm_k from the classic value: classic anchor = m / arm_k
        new = [clocal[i] + (m[12 + i] / arm_k - zlocal[i]) * arm_k for i in range(3)]
        out[key] = {'from': [round(v, 4) for v in m[12:15]], 'to': [round(v, 4) for v in new]}
        m[12], m[13], m[14] = (round(v, 6) for v in new)
        carry[key] = dict(e, matrix=m)
    RT.rest_pose(arm)
    return out


# The open book (src/render/characters/carry.ts, openBook()): two halves hinged on the item's Z axis, each raised
# BOOK_HINGE rad; per half (its own frame) the cover + pages fill x 0..BOOK_W, y BOOK_Y, z +-BOOK_HALF_Z.
BOOK_HINGE, BOOK_W, BOOK_Y, BOOK_HALF_Z = 0.21, 0.135, (-0.007, 0.011), 0.095
BOOK_SCALE_MAX = 1.6           # the renderer accepts carried-item scales up to this (anchors.ts ANCHOR_SCALE_MAX)
BOOK_FIT_GAP, BOOK_FIT_PEN = 0.015, 0.006   # m: accepted hand gap / overlap here (the audit fails at 25 / 15 mm)


def _book_halves(k: float):
    """[(rotation item -> half frame, box centre, box half size)] of the two halves at scale k."""
    out = []
    for side in (-1.0, 1.0):
        a = side * BOOK_HINGE
        r = np.array([[np.cos(a), np.sin(a), 0.0], [-np.sin(a), np.cos(a), 0.0], [0.0, 0.0, 1.0]])
        c = np.array([side * BOOK_W / 2, (BOOK_Y[0] + BOOK_Y[1]) / 2, 0.0]) * k
        h = np.array([BOOK_W / 2, (BOOK_Y[1] - BOOK_Y[0]) / 2, BOOK_HALF_Z]) * k
        out.append((r, c, h))
    return out


def _book_samples(k: float) -> np.ndarray:
    """Points on both faces of both halves (item frame)."""
    pts = []
    for r, c, h in _book_halves(k):
        gx, gy, gz = np.meshgrid(np.linspace(-1, 1, 9), (-1.0, 1.0), np.linspace(-1, 1, 11), indexing='ij')
        q = c + np.stack([gx.ravel(), gy.ravel(), gz.ravel()], 1) * h
        pts.append(q @ r)            # half frame -> item frame (r is item -> half, so its transpose applied to rows)
    return np.concatenate(pts)


def _book_box_dist(local: np.ndarray, k: float) -> np.ndarray:
    """Signed distance (m) of item-frame points to the book: > 0 outside, < 0 inside (depth)."""
    best = np.full(len(local), 1e9)
    for r, c, h in _book_halves(k):
        d = np.abs(local @ r.T - c) - h
        outside = np.linalg.norm(np.maximum(d, 0.0), axis=1)
        best = np.minimum(best, np.where(outside > 0, outside, d.max(1)))
    return best


_RAYS = (Vector((0.31, 0.22, 0.925)).normalized(), Vector((-0.87, 0.41, -0.27)).normalized(),
         Vector((0.19, -0.93, 0.31)).normalized())


def _inside(tree, p) -> bool:
    """Point inside the surface: an odd number of crossings along at least two of three fixed rays (the decimated
    body has open edges and thin flaps, so the nearest face's normal alone is not a reliable side test)."""
    odd = 0
    for d in _RAYS:
        o, n = p, 0
        while n < 64:
            hit = tree.ray_cast(o, d)
            if hit[0] is None:
                break
            n += 1
            o = hit[0] + d * 1e-5
        odd += n & 1
    return odd >= 2


def fit_book_to_body(zref, ob, arm, body: dict, weights: dict, carry: dict, log) -> dict:
    """After fit_book_anchors: size the open book to this body's hands and move it clear of the body.
    A broad body holds its hands further apart than the book is wide, and a deep chest / coat reaches into it. Per
    clip ('read', 'sitRead'; 8 %, 50 % and 92 % of the clip, the runtime rule), over a uniform scale 1..BOOK_SCALE_MAX
    (steps of 0.05), a forward shift 0..0.10 m and an up / down shift of 0 / +-0.02 m in the chest frame: the smallest
    scale, then the smallest shift, where both hands are within BOOK_FIT_GAP of the book and neither the book nor the
    body (everything but the forearms and hands) is more than BOOK_FIT_PEN inside the other. No such placement: the
    one with the smallest worst excess is kept and reported as 'unmet'."""
    from mathutils.bvhtree import BVHTree
    bones = weights['bones']
    dom = weights['W'].argmax(1)
    side_of = {s: np.isin(dom, [bones.index(n) for n in (f'forearm_{s}', f'hand_{s}', f'prop_{s}') if n in bones])
               for s in 'LR'}
    holding = side_of['L'] | side_of['R']
    polys = [tuple(p.vertices) for p in ob.data.polygons if not any(holding[v] for v in p.vertices)]
    out = {}
    for key in ('read', 'sitRead'):
        e = carry.get(key)
        if not e or e.get('bone') != 'chest':
            continue
        clip = key if key in zref.actions else 'sitRead'
        g0, g1 = zref.clip_frames(clip)
        frames = []
        for u in (0.08, 0.5, 0.92):
            RT.apply_pose(zref, arm, clip, g0 + (g1 - g0) * u, body)
            co = evaluated_coords(ob)
            tree = BVHTree.FromPolygons([tuple(v) for v in co], polys)
            chest = np.array(arm.matrix_world @ arm.pose.bones['chest'].matrix)
            frames.append((co, tree, chest))
        A0 = np.array(e['matrix'], np.float64).reshape(4, 4).T

        def measure(k, dy, dz):
            A = A0.copy()
            A[:3, 3] += (0.0, dy, dz)
            gap, pen = {'L': 0.0, 'R': 0.0}, 0.0
            samples = _book_samples(k)
            for co, tree, chest in frames:
                M = chest @ A                                             # item frame -> world (rigid)
                inv = np.linalg.inv(M)
                local = co @ inv[:3, :3].T + inv[:3, 3]
                d = _book_box_dist(local, k)
                for s in 'LR':
                    gap[s] = max(gap[s], float(max(d[side_of[s]].min(), 0.0)) if side_of[s].any() else 1.0)
                rest = d[~holding]
                pen = max(pen, float(-rest.min()) if len(rest) else 0.0)
                for p in samples @ M[:3, :3].T + M[:3, 3]:
                    v = Vector(p)
                    loc, _n, _i, dist = tree.find_nearest(v, 0.35)
                    if loc is not None and dist > pen and _inside(tree, v):
                        pen = dist
            return gap['L'], gap['R'], pen

        best = None
        for k in [round(1.0 + 0.05 * i, 2) for i in range(int(round((BOOK_SCALE_MAX - 1.0) / 0.05)) + 1)]:
            for dz in [round(0.01 * i, 2) for i in range(11)]:
                for dy in (0.0, -0.02, 0.02):
                    gl_, gr_, pen = measure(k, dy, dz)
                    excess = max(gl_ - BOOK_FIT_GAP, gr_ - BOOK_FIT_GAP, pen - BOOK_FIT_PEN)
                    if best is None or excess < best[0] - 1e-9:
                        best = (excess, k, dy, dz, gl_, gr_, pen)
                    if excess <= 0:
                        break
                if best[0] <= 0:
                    break
            if best[0] <= 0:
                break
        excess, k, dy, dz, gl_, gr_, pen = best
        m = A0.copy()
        m[:3, 3] += (0.0, dy, dz)
        m[:3, :3] *= k
        carry[key] = dict(e, matrix=[round(float(v), 6) for v in m.T.reshape(-1)])
        out[key] = {'scale': k, 'shift': [0.0, dy, dz], 'gap_mm': [round(gl_ * 1000, 1), round(gr_ * 1000, 1)],
                    'pen_mm': round(pen * 1000, 1), 'unmet': excess > 0}
        if excess > 0:
            log(f'    book {key}: NO placement within limits (worst excess {excess * 1000:.1f} mm)')
    RT.rest_pose(arm)
    return out


LIE_SOFT_SINK = 0.25   # m: hats / hair / veils / held props may press this far into the mattress (pillow end)


def fit_lying(zref, ob, arm, body: dict, targets: dict, weights: dict) -> dict:
    """Lying lift + centring. The lift rests the TORSO (pelvis / spine / chest-owned, not skirt / cape) on the
    mattress plane like the classic body's back; everything else (cone / top hat / straw hat brim, ponytail, veil,
    held lid) may press up to LIE_SOFT_SINK into the mattress / pillow, and capes / skirts are ignored (cloth folds).
    Fitting the lowest vertex of the whole body instead floated the Big Lug 0.44 m (rigid cape) and the bride, mascot,
    fortune teller, jogger, tourist, ringmaster 12-25 cm above the bed (veil, hats, ponytail)."""
    body['lyingOffset'] = [0.0, 0.0, 0.0]
    f0, f1 = zref.clip_frames('sleep')
    # a cape / train trailing behind the legs (Big Lug: skinned to the hips by the source, so no cloth weight) folds too
    rest = np.empty(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get('co', rest)
    rest = rest.reshape(-1, 3)
    hip_z = (arm.data.bones['thigh_L'].head_local.z + arm.data.bones['thigh_R'].head_local.z) / 2
    trailing = (rest[:, 1] > 0.3) & (rest[:, 2] < hip_z)          # > 30 cm behind the pelvis, below the hips
    torso = _dominant(weights, ('pelvis', 'spine', 'chest')) & ~weights['skirt'] & ~trailing
    solid = ~weights['cloth'] & ~trailing    # any skirt / cape influence: cloth folds on a bed
    lows_t, lows_s, ext = [], [], None
    for fr in (f0, (f0 + f1) // 2):
        RT.apply_pose(zref, arm, 'sleep', fr, body)
        c = gl(evaluated_coords(ob))
        lows_t.append(float(c[torso, 1].min()))
        lows_s.append(float(c[solid, 1].min()))
        if ext is None:
            ext = (float(c[:, 2].min()), float(c[:, 2].max()))
    RT.rest_pose(arm)
    dy_torso = targets['lie_min_y'] - min(lows_t)
    dy_solid = targets['lie_min_y'] - min(lows_s) - LIE_SOFT_SINK
    dy = max(dy_torso, dy_solid)
    dz = targets['lie_center_z'] - (ext[0] + ext[1]) / 2
    body['lyingOffset'] = [0.0, round(dy, 4), round(dz, 4)]
    return {'dy': dy, 'dz': dz, 'dy_torso': dy_torso, 'dy_solid': dy_solid + LIE_SOFT_SINK}


# ------------------------------------------------------------------------------------------------ checks
def clip_report(zref, ob, arm, body: dict, weights: dict) -> dict:
    """Ground contact of the feet in walk/idle/sit, lying contact, hand height in sitEat (plate reach)."""
    rest = np.empty(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get('co', rest)
    feet = rest.reshape(-1, 3)[:, 2] < 0.12
    rep = {}
    for clip in ('idle', 'walk', 'sit', 'sitEat', 'cook', 'dance', 'hug'):
        f0, f1 = zref.clip_frames(clip)
        frames = sorted(set(int(f0 + (f1 - f0) * k / 6) for k in range(7)))
        mins = []
        for fr in frames:
            RT.apply_pose(zref, arm, clip, fr, body)
            c = gl(evaluated_coords(ob))
            mins.append(float(c[feet, 1].min()))
        rep[clip] = {'feet_min_y': round(min(mins), 3), 'feet_contact_max': round(max(mins), 3)}
    for clip in ('sleep', 'beEmbalmed'):
        RT.apply_pose(zref, arm, clip, zref.clip_frames(clip)[0], body)
        c = gl(evaluated_coords(ob))
        rep[clip] = {'min_y': round(float(c[:, 1].min()), 3),
                     'z_extent': [round(float(c[:, 2].min()), 3), round(float(c[:, 2].max()), 3)]}
    RT.rest_pose(arm)
    return rep


def limb_collapse(ob, arm, weights: dict) -> dict:
    """Scale forearm/shin bones to ~0 (what the runtime does for a missing limb) and measure collateral damage:
    vertices owned by the torso / other limbs that move (tears) and how much of the lost limb stays visible."""
    W = weights['W']
    bones = weights['bones']
    dom = W.argmax(1)
    RT.rest_pose(arm)
    rest = evaluated_coords(ob)
    out = {}
    chains = {'forearm_L': ('upperarm_L', 'forearm_L', 'hand_L'), 'forearm_R': ('upperarm_R', 'forearm_R', 'hand_R'),
              'shin_L': ('thigh_L', 'shin_L', 'foot_L'), 'shin_R': ('thigh_R', 'shin_R', 'foot_R')}
    for b, chain in chains.items():
        pb = arm.pose.bones[b]
        pb.scale = (1e-3, 1e-3, 1e-3)
        bpy.context.view_layer.update()
        c = evaluated_coords(ob)
        pb.scale = (1, 1, 1)
        disp = np.linalg.norm(c - rest, axis=1)
        own = np.isin(dom, [bones.index(n) for n in chain])
        lost = np.isin(dom, [bones.index(n) for n in chain[1:]])
        torn = (~own) & (disp > 0.01)
        # collapsed-limb residue: limb verts left further than 4 cm from the joint after the collapse
        joint = np.array(arm.data.bones[b].head_local)
        resid = lost & (np.linalg.norm(c - joint, axis=1) > 0.04)
        q = 'clean' if torn.sum() == 0 else ('minor' if torn.sum() < 25 and disp[torn].max() < 0.03 else 'tears')
        out[b] = {'torn_verts': int(torn.sum()), 'torn_max_mm': round(float(disp[torn].max() * 1000) if torn.any() else 0.0, 1),
                  'residual_verts': int(resid.sum()), 'quality': q}
    bpy.context.view_layer.update()
    return out


def scaled_carry_anchors(zref, arm, hand_k: float) -> dict:
    """zombie.glb carryAnchors with the translation scaled to this body's hand size (hand-bone anchors; hand_k from
    body.hand_scale, the mesh-measured hand reach ratio) / arm length (chest anchors)."""
    raw = zref.arm.get('carryAnchors')
    if raw is None:
        return {}
    anchors = json.loads(raw) if isinstance(raw, str) else dict(raw)
    kh = {s: hand_k for s in 'LR'}
    arm_len = lambda a, s: a.data.bones[f'upperarm_{s}'].length + a.data.bones[f'forearm_{s}'].length  # noqa: E731
    ka = (arm_len(arm, 'L') + arm_len(arm, 'R')) / (zref.length['upperarm_L'] + zref.length['forearm_L'] +
                                                     zref.length['upperarm_R'] + zref.length['forearm_R'])

    def scale(entry):
        m = list(entry['matrix'])
        b = entry['bone']
        k = kh[b[-1]] if b.startswith('hand_') else ka
        m[12], m[13], m[14] = (round(m[12] * k, 6), round(m[13] * k, 6), round(m[14] * k, 6))
        e = dict(entry, matrix=m)
        if 'extra' in entry:
            e['extra'] = scale(entry['extra'])
        return e
    return {k: scale(v) for k, v in sorted(anchors.items())}

