"""Build one cast body into the current Blender scene (zombie reference already loaded)."""
from __future__ import annotations

import json

import bpy
import numpy as np

from . import body as B
from . import measure as MS
from . import retarget as RT
from . import textures as TX
from .config import CAST_RIG_VERSION, TRI_TARGET


def reset_scene(zref) -> None:
    keep = {zref.arm, *zref.meshes}
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    keep_act = set(zref.actions.values())
    for a in list(bpy.data.actions):
        if a not in keep_act:
            bpy.data.actions.remove(a)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images, bpy.data.cameras,
                 bpy.data.lights, bpy.data.worlds, bpy.data.node_groups):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)
    zref.clear()


def seed_of(body_id: str) -> float:
    return float(sum((i + 1) * ord(c) for i, c in enumerate(body_id)) % 997) / 97.0


def build_body(bdef: dict, src_path: str, profile: dict, zref, ztargets: dict, log=print) -> dict:
    bid = bdef['id']
    reset_scene(zref)
    src = B.load_source(src_path)
    B.check_front(src['arm'])
    welded = B.weld_and_clean(src['ob'])
    # a body sculpted with empty hands has no held prop: its loose pieces (finger tips, cuff shreds) stay with the hand
    loose_props = {s: 0 for s in B.SIDES} if profile.get('no_props') else B.tag_prop_islands(src['ob'])
    cut = None
    if profile.get('fused_prop'):
        cut = B.cut_fused_prop(src['ob'], src['arm'], profile['fused_prop'], profile.get('fused_reach', 1.2))
        log(f'  [{bid}] cut the sculpted prop off hand_{cut["side"]} above the fist: {cut}')
        if cut['open_new']:
            raise RuntimeError(f'{bid}: the prop cut left {cut["open_new"]} open edges')
    tris = B.decimate(src['ob'], profile.get('tri_target', TRI_TARGET))   # premium representations set their own
    log(f'  [{bid}] welded {welded} verts, decimated to {tris} tris')
    hd = B.head_dominance(ob := src['ob'])
    reskinned = None
    if hd > 0.3 or profile.get('reskin'):
        reskinned = B.auto_weights(src)
        log(f'  [{bid}] source skin unusable (head owns {hd:.0%} of the lower body): re-skinned {reskinned}')
    targets = B.limb_targets(zref, profile)
    rp = B.repose(src, targets, set(profile.get('keep_pose', ())))
    log(f'  [{bid}] re-posed limbs (deg): {rp["angles"]}')
    nm = B.normalize(src, rp['joints'], bdef['height'])
    J = nm['joints']
    ob = src['ob']
    # source maps before the source armature / material go away
    maps = TX.source_maps(ob)
    base = TX.pixels(maps['base'])
    orm = TX.pixels(maps['orm']) if maps['orm'] is not None else None
    nrm = TX.pixels(maps['normal']) if maps['normal'] is not None else None
    bpy.data.objects.remove(src['arm'], do_unlink=True)

    hip_z = (J['thigh_L'][0].z + J['thigh_R'][0].z) / 2
    hs = B.hand_scale(ob, J, zref)
    log(f'  [{bid}] hand size {hs}')
    cj = B.cast_joints(J, zref, J['hips'][0].z, bdef['height'], hs['k'])
    arm = B.build_armature(cj, zref)
    rerr = B.rest_rotation_error(arm, zref)
    if rerr > 1e-5:
        raise RuntimeError(f'rest orientation mismatch {rerr}')
    weights = B.remap_weights(ob, J, hip_z)
    for s in B.SIDES:                                    # a prop bone deforms only where a prop is skinned to it
        if weights['props'][s]:
            arm.data.bones[f'prop_{s}'].use_deform = True
    hem = weights['hem']
    if float(hem.max()) > 0:
        attr = ob.data.attributes.new('_HEMMASK', 'FLOAT', 'POINT')
        attr.data.foreach_set('value', hem.astype(np.float32))
    B.bind(ob, arm)
    if profile.get('settle_props'):
        log(f'  [{bid}] prop bones seated on the hands (m along the bone): {B.settle_prop_bones(ob, arm, zref, weights)}')
    if any(weights['props'].values()) or float(hem.max()) > 0:
        log(f'  [{bid}] held-prop pieces (source verts {loose_props}) -> prop bones {weights["props"]}; '
            f'hem mask on {int((hem > 0).sum())} verts')
    log(f'  [{bid}] merged source groups {weights["merged"]}, orphan verts fixed {weights["unweighted_fixed"]}')

    # ---- textures / material
    co = np.empty(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    zstats = None
    if bdef['category'] == 'turned':
        marks = {k: list(v) for k, v in nm['marks'].items()}
        z = TX.zombify(base, ob, co, marks, weights, profile, seed_of(bid))
        base = z['pixels']
        zstats = z['stats']
        log(f'  [{bid}] zombified skin: {zstats}')
    base_img = TX.new_image(f'{bid}_basecolor', TX.resized(base, profile['base_size']), non_color=False)
    orm_img = TX.new_image(f'{bid}_orm', TX.resized(orm, profile['orm_size']), True) if orm is not None else None
    nrm_img = TX.new_image(f'{bid}_normal', TX.resized(nrm, profile['normal_size']), True) if nrm is not None else None
    use_ao = orm is not None and TX.orm_has_occlusion(orm)
    old = list(ob.data.materials)
    ob.data.materials.clear()
    mat = TX.build_material('Body', base_img, orm_img, nrm_img, use_ao)
    ob.data.materials.append(mat)
    for m in old:
        if m.users == 0:
            bpy.data.materials.remove(m)

    # ---- anchors
    s = hip_z / zref.hip_height
    body = {'pelvisRest': list(RT.to_gl(arm.data.bones['pelvis'].head_local)), 'pelvisScale': round(s, 5),
            'seatPelvisOffset': [0.0, 0.0, 0.0], 'lyingOffset': [0.0, 0.0, 0.0], 'sitThighLift': 0.0}
    seat = MS.fit_seat(zref, ob, arm, body, weights, ztargets, log)
    # per-body art direction on top of the fit (profiles): a deep-backed body sits further forward on the seat so its
    # back meets the backrest inside the renderer's slide range; a low-hanging belly / hip mass sits a little higher
    if profile.get('seat_forward') or profile.get('seat_lift'):
        so = body['seatPelvisOffset']
        body['seatPelvisOffset'] = [so[0], round(so[1] + profile.get('seat_lift', 0.0), 4),
                                    round(so[2] + profile.get('seat_forward', 0.0), 4)]
    if profile.get('lift_per_clip'):
        per_clip = MS.fit_thigh_lift_by_clip(zref, ob, arm, body, weights)
        log(f'  [{bid}] thigh lift per sit clip: {per_clip}')
    lie = MS.fit_lying(zref, ob, arm, body, ztargets, weights)
    # realistic shoulder blades and necks sit behind the torso plane the fit rests on the mattress: lift them out
    if profile.get('lie_lift'):
        lo = body['lyingOffset']
        body['lyingOffset'] = [lo[0], round(lo[1] + profile['lie_lift'], 4), lo[2]]
    log(f'  [{bid}] pelvis {body["pelvisRest"]} scale {body["pelvisScale"]} seatOffset {body["seatPelvisOffset"]} '
        f'lyingOffset {body["lyingOffset"]} sitThighLift {body["sitThighLift"]}')
    probe = MS.seat_probe(zref, ob, arm, body, weights)
    clips = MS.clip_report(zref, ob, arm, body, weights)
    limbs = MS.limb_collapse(ob, arm, weights)
    log(f'  [{bid}] limb collapse: ' + ', '.join(f'{k} {v["quality"]} ({v["torn_verts"]} torn, {v["torn_max_mm"]} mm)'
                                               for k, v in limbs.items()))
    RT.rest_pose(arm)
    carry = MS.scaled_carry_anchors(zref, arm, hs['k'])
    if profile.get('book_fixed'):
        # a lower-detail file of the same body holds the book exactly as its high file does (fitted there: the
        # coarse mesh is too open for a reliable overlap test)
        carry.update(profile['book_fixed'])
    elif profile.get('fit_book'):
        arm_k = sum(arm.data.bones[f'{b}_{s}'].length for b in ('upperarm', 'forearm') for s in 'LR') / \
            sum(zref.length[f'{b}_{s}'] for b in ('upperarm', 'forearm') for s in 'LR')
        log(f'  [{bid}] book anchors fitted to the hands: {MS.fit_book_anchors(zref, arm, body, carry, arm_k)}')
        log(f'  [{bid}] book sized and cleared: {MS.fit_book_to_body(zref, ob, arm, body, weights, carry, log)}')
    head_top = float(co[:, 2].max())
    extras = {'castRigVersion': CAST_RIG_VERSION, 'castBody': bid, 'animationsShared': True,
              'pelvisRest': body['pelvisRest'], 'pelvisScale': body['pelvisScale'],
              'seatPelvisOffset': body['seatPelvisOffset'], 'lyingOffset': body['lyingOffset'],
              'sitThighLift': body.get('sitThighLift', 0.0), 'headTop': round(head_top, 4)}
    if body.get('sitThighLiftByClip'):
        extras['sitThighLiftByClip'] = body['sitThighLiftByClip']
    for k, v in extras.items():
        arm[k] = json.dumps(v) if isinstance(v, (list, dict)) else v
    return {'arm': arm, 'ob': ob, 'body': body, 'weights': weights, 'seat': seat, 'lie': lie, 'clips': clips,
            'limbs': limbs, 'carry': carry, 'headTop': head_top, 'zombify': zstats, 'marks': nm['marks'],
            'useAO': use_ao, 'maps': {k: v is not None for k, v in (('orm', orm), ('normal', nrm))},
            'repose': rp['angles'], 'reskinned': reskinned, 'hand': hs,
            'props': weights['props'], 'hemVerts': int((hem > 0).sum()), 'cut': cut,
            'seatProbe': probe}
