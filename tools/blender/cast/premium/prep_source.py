"""Turn a rigged master character (Mixamo-named skeleton, e.g. a Tripo `anim rig --spec mixamo` GLB) into
  1. a cast SOURCE for build_cast.py: `<out>/<id>_rigged.glb` in the Zombie Smash 2 rig convention that
     lib/body.load_source expects (root, hips, spine, chest, neck, head, shoulder/upperarm/forearm/hand_L/R,
     thigh/shin/foot_L/R; empties eye_L, eye_R, skull_top; toes toward -Y; identity object transforms), and
  2. a reusable LOD0 for other engines: `<bank>/<id>_lod0.glb` (+ .fbx), same mesh on the untouched Mixamo skeleton.

    blender -b --factory-startup --python-exit-code 1 --python tools/blender/cast/premium/prep_source.py -- \
        --id undertaker --master <master.glb> --out <source dir> [--bank <dir>] [--tris 40000] [--tex 2048]

Nothing here is random or clock dependent. The master is never modified. Fails loudly (non-zero exit) when the
skeleton is not the expected one, when the front axis cannot be established, or when a vertex is left unweighted.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

PFX = 'mixamorig:'
#: ours -> the Mixamo bone that becomes it
RENAME = {
    'hips': 'Hips', 'spine': 'Spine', 'chest': 'Spine1', 'neck': 'Neck', 'head': 'Head',
    'shoulder_L': 'LeftShoulder', 'upperarm_L': 'LeftArm', 'forearm_L': 'LeftForeArm', 'hand_L': 'LeftHand',
    'shoulder_R': 'RightShoulder', 'upperarm_R': 'RightArm', 'forearm_R': 'RightForeArm', 'hand_R': 'RightHand',
    'thigh_L': 'LeftUpLeg', 'shin_L': 'LeftLeg', 'foot_L': 'LeftFoot',
    'thigh_R': 'RightUpLeg', 'shin_R': 'RightLeg', 'foot_R': 'RightFoot',
}
#: where each of our bones points (tail) = the head of this Mixamo bone
TAIL_AT = {
    'hips': 'Spine', 'spine': 'Spine1', 'chest': 'Neck', 'neck': 'Head', 'head': 'HeadTop_End',
    'shoulder_L': 'LeftArm', 'upperarm_L': 'LeftForeArm', 'forearm_L': 'LeftHand', 'hand_L': 'LeftHandMiddle4',
    'shoulder_R': 'RightArm', 'upperarm_R': 'RightForeArm', 'forearm_R': 'RightHand', 'hand_R': 'RightHandMiddle4',
    'thigh_L': 'LeftLeg', 'shin_L': 'LeftFoot', 'foot_L': 'LeftToe_End',
    'thigh_R': 'RightLeg', 'shin_R': 'RightFoot', 'foot_R': 'RightToe_End',
}
PARENT = {
    'hips': 'root', 'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck',
    'shoulder_L': 'chest', 'upperarm_L': 'shoulder_L', 'forearm_L': 'upperarm_L', 'hand_L': 'forearm_L',
    'shoulder_R': 'chest', 'upperarm_R': 'shoulder_R', 'forearm_R': 'upperarm_R', 'hand_R': 'forearm_R',
    'thigh_L': 'hips', 'shin_L': 'thigh_L', 'foot_L': 'shin_L',
    'thigh_R': 'hips', 'shin_R': 'thigh_R', 'foot_R': 'shin_R',
}


def die(msg: str) -> None:
    print('PREP-ERROR:', msg, flush=True)
    sys.exit(2)


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def select_only(*obs) -> None:
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]


def merge_target(name: str) -> str | None:
    """Which of OUR bones takes the weights of a Mixamo bone that has no bone of its own."""
    n = name[len(PFX):] if name.startswith(PFX) else name
    if n == 'Spine2':
        return 'chest'
    if n == 'HeadTop_End':
        return 'head'
    for side, s in (('Left', 'L'), ('Right', 'R')):
        if n.startswith(side + 'Hand') and n != side + 'Hand':
            return f'hand_{s}'
        if n.startswith(side + 'Toe'):
            return f'foot_{s}'
    return None


def resize_images(max_px: int) -> list:
    out = []
    for im in bpy.data.images:
        if not im.size[0]:
            continue
        w, h = im.size
        if max(w, h) > max_px:
            k = max_px / max(w, h)
            im.scale(max(1, round(w * k)), max(1, round(h * k)))
        out.append({'name': im.name, 'size': list(im.size)})
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--id', required=True)
    ap.add_argument('--master', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--bank')
    ap.add_argument('--tris', type=int, default=40000)
    ap.add_argument('--tex', type=int, default=2048)
    a = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])
    master = os.path.abspath(a.master)
    if not os.path.isfile(master):
        die(f'master not found: {master}')
    out_dir = os.path.abspath(a.out)
    os.makedirs(out_dir, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=master)
    arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    if len(arms) != 1:
        die(f'expected one armature, found {len(arms)}')
    arm = arms[0]
    # the skinned body is the mesh with an armature modifier; Tripo also ships a bone-display helper (an icosphere)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    skinned = [o for o in meshes if any(m.type == 'ARMATURE' for m in o.modifiers)]
    if len(skinned) != 1:
        die(f'expected one skinned mesh, found {[o.name for o in skinned]} of {[o.name for o in meshes]}')
    ob = skinned[0]
    for o in meshes:
        if o is not ob:
            if len(o.data.polygons) > 2000:
                die(f'unexpected second mesh {o.name} with {len(o.data.polygons)} faces')
            bpy.data.objects.remove(o, do_unlink=True)
    have = {b.name for b in arm.data.bones}
    need = {PFX + v for v in RENAME.values()} | {PFX + v for v in TAIL_AT.values()}
    if need - have:
        die(f'skeleton is missing {sorted(need - have)}')

    # ---- one object space: bake every object transform into the data
    for o in [o for o in bpy.data.objects if o.type == 'EMPTY']:
        for c in list(o.children):
            mw = c.matrix_world.copy()
            c.parent = None
            c.matrix_world = mw
        bpy.data.objects.remove(o, do_unlink=True)
    if ob.parent is not arm:
        mw = ob.matrix_world.copy()
        ob.parent = arm
        ob.matrix_world = mw
    select_only(arm, ob)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    def head(n: str) -> Vector:
        return arm.matrix_world @ arm.data.bones[PFX + n].head_local

    # ---- front axis from the feet (ankle -> toe end), then turn the toes to -Y and the left hand to +X
    fwd = Vector((0, 0, 0))
    for s in ('Left', 'Right'):
        d = head(s + 'Toe_End') - head(s + 'Foot')
        d.z = 0
        fwd += d
    if fwd.length < 1e-4:
        die('cannot establish the front axis from the feet')
    fwd.normalize()
    yaw = math.atan2(fwd.x, -fwd.y)                 # rotate by -yaw... solve R(yaw) * fwd = (0,-1,0)
    R = Matrix.Rotation(yaw, 4, 'Z')
    if ((R @ fwd) - Vector((0, -1, 0))).length > 1e-3:
        R = Matrix.Rotation(-yaw, 4, 'Z')
    if ((R @ fwd) - Vector((0, -1, 0))).length > 1e-3:
        die(f'front axis solve failed for {tuple(fwd)}')
    arm.matrix_world = R @ arm.matrix_world
    select_only(arm, ob)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if head('LeftHand').x <= head('RightHand').x:
        die('after facing -Y the left hand is not on +X: the rig is mirrored')

    # ---- decimate (UVs and vertex groups are interpolated by the collapse decimator)
    select_only(ob)
    tris0 = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if tris0 > a.tris:
        m = ob.modifiers.new('dec', 'DECIMATE')
        m.ratio = a.tris / tris0
        m.use_collapse_triangulate = True
        # the armature modifier must stay last
        while ob.modifiers[0].name != m.name:
            bpy.ops.object.modifier_move_up(modifier=m.name)
        bpy.ops.object.modifier_apply(modifier=m.name)
    tris1 = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    ob.data.shade_smooth()

    textures = resize_images(a.tex)

    # ---- size: feet on the floor, pelvis over the origin (build_cast normalises again; this keeps the LOD0 sane)
    zs = [v.co.z for v in ob.data.vertices]
    lo, hi = min(zs), max(zs)
    hp = head('Hips')
    arm.matrix_world = Matrix.Translation((-hp.x, -hp.y, -lo)) @ arm.matrix_world
    select_only(arm, ob)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    height = hi - lo

    stats = {'id': a.id, 'master': os.path.basename(master), 'masterSha256': sha256(master), 'masterTriangles': tris0,
             'triangles': tris1, 'textures': textures, 'height': round(height, 5), 'bones': len(arm.data.bones)}

    # ---- LOD0 for other engines: the untouched Mixamo skeleton
    if a.bank:
        bank = os.path.abspath(a.bank)
        os.makedirs(bank, exist_ok=True)
        select_only(arm, ob)
        glb = os.path.join(bank, f'{a.id}_lod0.glb')
        bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_animations=False,
                                  export_image_format='JPEG', export_image_quality=90, export_yup=True)
        fbx = os.path.join(bank, f'{a.id}_lod0.fbx')
        bpy.ops.export_scene.fbx(filepath=fbx, use_selection=True, add_leaf_bones=False, bake_anim=False,
                                 path_mode='COPY', embed_textures=True, object_types={'ARMATURE', 'MESH'})
        stats['bank'] = {os.path.basename(p): {'bytes': os.path.getsize(p), 'sha256': sha256(p)} for p in (glb, fbx)}

    # ---- cast source: merge the extra bones' weights, rename, lay the bones out, add root + landmarks
    vg = ob.vertex_groups
    merge = {}                                       # group index -> name of the Mixamo group that takes its weights
    for b in [b.name for b in arm.data.bones]:
        tgt = merge_target(b)
        if tgt is not None and vg.get(b) is not None:
            keep = PFX + RENAME[tgt]
            if vg.get(keep) is None:
                vg.new(name=keep)
            merge[vg[b].index] = keep
    moved = 0
    for v in ob.data.vertices:
        add = {}
        for g in v.groups:
            if g.group in merge and g.weight > 0:
                add[merge[g.group]] = add.get(merge[g.group], 0.0) + g.weight
        for keep, w in add.items():
            vg[keep].add([v.index], w, 'ADD')
            moved += 1
    for name in [g.name for g in vg if g.index in merge]:
        vg.remove(vg[name])
    stats['mergedWeights'] = moved
    for ours, theirs in RENAME.items():
        g = vg.get(PFX + theirs)
        if g is None:
            die(f'no vertex group for {theirs}')
        g.name = ours

    select_only(arm)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    tails = {ours: eb[PFX + t].head.copy() for ours, t in TAIL_AT.items()}
    for ours, theirs in RENAME.items():
        eb[PFX + theirs].name = ours
    for b in [b for b in eb if b.name not in RENAME]:
        eb.remove(b)
    root = eb.new('root')
    root.head = (0, 0, 0)
    root.tail = (0, 0, 0.1)
    for ours in RENAME:
        b = eb[ours]
        b.use_connect = False
        b.tail = tails[ours]
        if b.length < 1e-4:
            die(f'bone {ours} has no length')
        b.parent = eb[PARENT[ours]]
    bpy.ops.object.mode_set(mode='OBJECT')
    arm.data.bones['root'].use_deform = False

    unweighted = sum(1 for v in ob.data.vertices if not any(g.weight > 0 for g in v.groups))
    if unweighted:
        die(f'{unweighted} vertices have no weight after the merge')
    for s in ('L', 'R'):
        b = arm.data.bones[f'foot_{s}']
        if (b.tail_local - b.head_local).y > -0.05 * b.length:
            die(f'foot_{s} does not point to -Y')

    # landmarks: skull top = highest head-owned vertex; eyes = on the face surface at eye height, +-interocular/2
    hb = arm.data.bones['head']
    gi = vg['head'].index
    head_v = [v for v in ob.data.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups)]
    if len(head_v) < 50:
        die('too few head vertices to place the landmarks')
    top = max(head_v, key=lambda v: v.co.z).co.copy()
    hz = hb.head_local.z
    eye_z = hz + 0.56 * (top.z - hz)
    half = 0.185 * (top.z - hz)                       # half the interocular distance from the head height
    marks = {'skull_top': top}
    for s, sx in (('L', 1.0), ('R', -1.0)):
        near = [v.co for v in head_v if abs(v.co.z - eye_z) < 0.012 and abs(v.co.x - sx * half) < 0.012]
        if not near:
            die(f'no face surface found for eye_{s}')
        marks[f'eye_{s}'] = Vector((sx * half, min(c.y for c in near), eye_z))
    for n, p in marks.items():
        e = bpy.data.objects.new(n, None)
        e.empty_display_size = 0.02
        e.location = p
        bpy.context.scene.collection.objects.link(e)
    stats['marks'] = {n: [round(c, 5) for c in p] for n, p in marks.items()}

    arm.name = f'{a.id}_rig'
    ob.name = f'{a.id}_mesh'
    bpy.ops.object.select_all(action='SELECT')
    dst = os.path.join(out_dir, f'{a.id}_rigged.glb')
    bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_animations=False,
                              export_image_format='JPEG', export_image_quality=92, export_yup=True)
    stats['source'] = {'file': os.path.basename(dst), 'bytes': os.path.getsize(dst), 'sha256': sha256(dst)}
    with open(os.path.join(out_dir, f'{a.id}_prep.json'), 'w', encoding='utf-8') as fh:
        json.dump(stats, fh, indent=1, sort_keys=True)
    print('PREP-OK', json.dumps(stats), flush=True)


main()
