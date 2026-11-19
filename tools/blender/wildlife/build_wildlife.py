#!/usr/bin/env python
"""Build the ambient wildlife (docs/systems/wildlife.md, W-076) on the pets pipeline (creature contract v1).

    blender -b --factory-startup --python tools/blender/wildlife/build_wildlife.py -- [--only songbird,frog]
            [--out DIR] [--preview]

Outputs
  public/assets/models/wildlife/<id>.glb   one skeleton, two skinned meshes (Wild_lod0 <= 1,500 triangles,
                                           Wild_lod1 <= 500), the clips listed for that animal
  public/assets/manifest.wildlife.json     file, bytes, sha256, triangles, bones, clips, size, colour variants,
                                           and a convex footprint polygon per animal

Every GLB is exported and checked in a staging folder first and only then moved into place; the manifest is
written last and never by a subset build (--only). Deterministic: no wall-clock, no unseeded randomness.
Exit codes: 0 ok, 1 a model failed a check (nothing published), 2 bad arguments.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'pets'))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..'))
PROJECT_ROOT = os.path.normpath(os.path.join(HERE, '..', '..', '..'))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import manifest_meta as meta  # noqa: E402
from petlib import body, build  # noqa: E402
from petlib.rig import Rig, euler  # noqa: E402

import clips as wclips  # noqa: E402
import extras  # noqa: E402
from specs import BUDGET, CLIPS, FPS, WILDLIFE  # noqa: E402

ASSETS_DIR = os.path.join(PROJECT_ROOT, 'public', 'assets')
MANIFEST = 'manifest.wildlife.json'
SHEET_DIR = os.path.join(PROJECT_ROOT, 'docs', 'desktop-reports', 'img', 'wildlife')
NODES = ('Wild_lod0', 'Wild_lod1')


def make_armature(rig: Rig, scale: float):
    data = bpy.data.armatures.new('Rig')
    arm = bpy.data.objects.new('Rig', data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for n, h, t, p in rig.table:
        b = data.edit_bones.new(n)
        b.head, b.tail, b.roll = Vector(h) * scale, Vector(t) * scale, 0.0
        if p:
            b.parent = data.edit_bones[p]
        b.use_connect = False
        b.use_deform = n != 'root'
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return arm


def pose_of(rig: Rig, species: str, clip: str, t: float):
    dur, loop = CLIPS[species][clip]
    p = (t / dur) % 1.0 if loop else min(1.0, t / dur)
    return wclips.TABLE[species][clip](rig, p)


def apply_pose(arm, pose, scale: float) -> None:
    B = {b.name: b.matrix_local.to_3x3() for b in arm.data.bones}
    for pb in arm.pose.bones:
        pb.rotation_quaternion = build._basis(B[pb.name], euler(pose.rot.get(pb.name, (0.0, 0.0, 0.0))))
        pb.location = (B['hips'].inverted() @ (pose.loc * scale)) if pb.name == 'hips' else Vector((0, 0, 0))
    bpy.context.view_layer.update()


def build_scene(species: str):
    sp = WILDLIFE[species]
    scale = sp['scale']
    build.reset_scene()
    rig = Rig(sp)                               # reference size: clips and IK are solved here
    arm = make_armature(rig, scale)
    mats = build.make_materials(next(iter(sp['paints'].values())))
    objs, tris = [], {}
    for name, detail, low in ((NODES[0], sp['detail'][0], False), (NODES[1], sp['detail'][1], True)):
        part = body.build_part(rig, 'normal', name=name, detail=detail, low=low)
        extras.decorate(species, rig, part, low)          # each animal's own marks (W-083)
        for i in range(len(part.co)):
            part.co[i] = part.co[i] * scale
        tris[name] = build.tri_count(part)
        objs.append(build.part_to_object(part, mats, arm))
    return rig, arm, objs, tris


def ground_clearance(species: str, rig: Rig, arm, objs) -> dict:
    """Lowest deformed vertex (mm) per ground clip over every frame; flight and climbing are not checked."""
    sp = WILDLIFE[species]
    out = {}
    dg = bpy.context.evaluated_depsgraph_get()
    for clip in sp['ground']:
        dur, _ = CLIPS[species][clip]
        low = 1e9
        for f in range(round(dur * FPS) + 1):
            apply_pose(arm, pose_of(rig, species, clip, f / FPS), sp['scale'])
            dg.update()
            for ob in objs:
                ev = ob.evaluated_get(dg)
                me = ev.to_mesh()
                low = min(low, min(v.co.z for v in me.vertices))
                ev.to_mesh_clear()
        out[clip] = round(low * 1000.0, 1)
    apply_pose(arm, wclips.Pose(), sp['scale'])
    return out


def bake(species: str, rig: Rig, arm) -> None:
    sp = WILDLIFE[species]
    B = {b.name: b.matrix_local.to_3x3() for b in arm.data.bones}
    bones = [b.name for b in arm.data.bones]
    arm.animation_data_create()
    ad = arm.animation_data
    for name, (dur, loop) in CLIPS[species].items():
        nframes = round(dur * FPS)
        frames = list(range(nframes + 1))
        quats, locs = {b: [] for b in bones}, []
        for f in frames:
            pose = pose_of(rig, species, name, f / FPS)
            for b in bones:
                q = build._basis(B[b], euler(pose.rot.get(b, (0.0, 0.0, 0.0))))
                if quats[b] and quats[b][-1].dot(q) < 0:
                    q = -q
                quats[b].append(q)
            locs.append(B['hips'].inverted() @ (pose.loc * sp['scale']))
        if loop:
            for b in bones:
                quats[b][-1] = quats[b][0].copy()
            locs[-1] = locs[0].copy()
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        slot = act.slots.new(id_type='OBJECT', name='Rig')
        cb = act.layers.new('Layer').strips.new(type='KEYFRAME').channelbags.new(slot)
        for b in bones:
            for i in range(4):
                build._write(cb.fcurves.new(f'pose.bones["{b}"].rotation_quaternion', index=i, group_name=b), frames,
                             [q[i] for q in quats[b]])
        for i in range(3):
            build._write(cb.fcurves.new('pose.bones["hips"].location', index=i, group_name='hips'), frames, [v[i] for v in locs])
        act.frame_range = (0, nframes)
        act.use_frame_range = True
        ad.action = act
        ad.action_slot = slot
        track = ad.nla_tracks.new()
        track.name = name
        st = track.strips.new(name, 0, act)
        try:
            st.action_slot = slot
        except Exception:  # noqa: BLE001
            pass
        track.mute = True
        ad.action = None


def verify(species: str, info: dict, rig: Rig, clearance: dict) -> list[str]:
    sp = WILDLIFE[species]
    out = []
    want = CLIPS[species]
    names = sorted(a['name'] for a in info['animations'])
    if names != sorted(want):
        out.append(f'clips {names} != {sorted(want)}')
    for a in info['animations']:
        if a['name'] in want and abs(a['duration'] - want[a['name']][0]) > 1e-3:
            out.append(f"{a['name']}: duration {a['duration']} != {want[a['name']][0]}")
    if sorted(info['meshes']) != sorted(NODES):
        out.append(f"mesh nodes {sorted(info['meshes'])}")
    for node, cap in zip(NODES, BUDGET):
        m = info['meshes'].get(node)
        if not m:
            continue
        if m['triangles'] > cap:
            out.append(f"{node}: {m['triangles']} triangles > {cap}")
        if m['triangles'] < cap // 5:
            out.append(f"{node}: {m['triangles']} triangles (placeholder?)")
        if not m['skinned']:
            out.append(f'{node}: not skinned')
        tol = 0.004 * max(sp['scale'], 0.5)
        if not -tol <= m['min'][1] <= tol:
            out.append(f"{node}: feet not on y = 0 (min y {m['min'][1]})")
    if info['skins'] != 1:
        out.append(f"{info['skins']} skins")
    missing = [b for b in rig.order if b != 'root' and b not in info['joints']]
    if missing:
        out.append(f'bones missing from the skin: {missing}')
    if info['images'] or info['textures']:
        out.append('GLB contains images/textures')
    if 'Paint' not in info['materials']:
        out.append('no Paint material')
    for clip, mm in clearance.items():
        if mm < -5.0 * max(sp['scale'], 0.5):
            out.append(f'{clip}: mesh sinks {-mm} mm below the floor')
    return out


def build_one(species: str, stage: str) -> tuple[dict, list[str]]:
    sp = WILDLIFE[species]
    rig, arm, objs, tris = build_scene(species)
    clearance = ground_clearance(species, rig, arm, objs)
    outline = meta.outline(meta.scene_triangles([objs[0]]))
    meta.add_frame('feet', (0.0, 0.0, 0.0), 0.0, 'feet', arm)        # the perch / standing point
    frames = meta.collect_frames()
    bake(species, rig, arm)
    path = os.path.join(stage, f'{species}.glb')
    build.export_glb(path)
    info = build.inspect(path)
    problems = verify(species, info, rig, clearance)
    lo = [min(m['min'][i] for m in info['meshes'].values()) for i in range(3)]
    hi = [max(m['max'][i] for m in info['meshes'].values()) for i in range(3)]
    entry = {
        'file': f'models/wildlife/{species}.glb', 'bytes': os.path.getsize(path), 'sha256': build.sha256(path),
        'plan': rig.plan, 'triangles': {k: info['meshes'][k]['triangles'] for k in sorted(info['meshes'])},
        'bones': info['joints'], 'materials': [m for m in info['materials'] if m],
        'clips': [{'name': n, 'duration': d, 'loop': lp} for n, (d, lp) in CLIPS[species].items()],
        'paints': sp['paints'],
        'bounds': {'min': lo, 'max': hi},
        'sizeM': {'width': round(hi[0] - lo[0], 3), 'height': round(hi[1] - lo[1], 3), 'length': round(hi[2] - lo[2], 3)},
        'outline': outline,
        'frames': frames,
        'groundClearanceMm': clearance,
    }
    print(f"[wildlife] {species}: triangles {entry['triangles']}, size {entry['sizeM']}"
          + ('' if not problems else '  FAILED: ' + '; '.join(problems)))
    return entry, problems


def render_sheet(ids: list[str]) -> str:
    import numpy as np
    from petlib import preview

    cell = 360
    cols = max(len(CLIPS[s]) for s in ids) + 1          # every clip at LOD0, then one LOD1 cell
    tmp = tempfile.mkdtemp(prefix='wildlife-cells-')
    sheet = np.zeros((len(ids) * cell, cols * cell, 4), dtype=np.float32)
    sheet[..., :3], sheet[..., 3] = 0.16, 1.0
    for row, species in enumerate(ids):
        sp = WILDLIFE[species]
        rig, arm, objs, _ = build_scene(species)
        preview._link_vertex_colors()
        vs = [v.co for v in objs[0].data.vertices]
        size = max(max(v.y for v in vs) - min(v.y for v in vs), max(v.z for v in vs), 2 * max(abs(v.x) for v in vs))
        cam = preview._studio(size)
        scene = bpy.context.scene
        scene.render.resolution_x = scene.render.resolution_y = cell
        cells = [(c, 0) for c in CLIPS[species]] + [(next(iter(CLIPS[species])), 1)]
        for col, (clip, lod) in enumerate(cells):
            for i, ob in enumerate(objs):
                ob.hide_render = i != lod
            pose = pose_of(rig, species, clip, 0.3 * CLIPS[species][clip][0])
            apply_pose(arm, pose, sp['scale'])
            centre = Vector((0.0, 0.5 * (min(v.y for v in vs) + max(v.y for v in vs)), 0.5 * max(v.z for v in vs) + pose.loc.z * sp['scale']))
            preview._aim(cam, centre, 2.9 * size, 62.0, 14.0)
            path = os.path.join(tmp, f'{row}_{col}.png')
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            img = bpy.data.images.load(path)
            sheet[(len(ids) - 1 - row) * cell:(len(ids) - row) * cell, col * cell:(col + 1) * cell] = \
                np.array(img.pixels[:], dtype=np.float32).reshape(cell, cell, 4)
            bpy.data.images.remove(img)
    os.makedirs(SHEET_DIR, exist_ok=True)
    out = bpy.data.images.new('wildlife_sheet', cols * cell, len(ids) * cell, alpha=False)
    out.pixels.foreach_set(sheet.ravel())
    target = os.path.join(SHEET_DIR, 'wildlife.jpg')
    scene = bpy.context.scene
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = 88
    out.save_render(target, scene=scene)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f'[wildlife] sheet {target} (rows: {", ".join(ids)}; columns: each clip at LOD0, then LOD1)')
    return target


def main() -> int:
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser(prog='build_wildlife.py')
    ap.add_argument('--only', default='')
    ap.add_argument('--out', default=None)
    ap.add_argument('--preview', action='store_true')
    args = ap.parse_args(argv)
    # one exporter per kit (tools/blender/toolchains.json): refuse to publish with another Blender
    import pathlib as _pathlib
    sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parents[1]))
    from common import toolchain as _toolchain
    _toolchain.require('wildlife', scratch=bool(args.out))
    only = [s for s in args.only.split(',') if s]
    unknown = [s for s in only if s not in WILDLIFE]
    if unknown:
        print(f'unknown ids: {unknown} (known: {list(WILDLIFE)})', file=sys.stderr)
        return 2
    ids = only or list(WILDLIFE)
    root = os.path.abspath(args.out) if args.out else ASSETS_DIR
    os.makedirs(root, exist_ok=True)
    stage = tempfile.mkdtemp(prefix='.wildlife-stage-', dir=root)
    try:
        entries, failed = {}, False
        for species in ids:
            entries[species], problems = build_one(species, stage)
            failed = failed or bool(problems)
        if failed:
            print('[wildlife] nothing published', file=sys.stderr)
            return 1
        out_dir = os.path.join(root, 'models', 'wildlife')
        os.makedirs(out_dir, exist_ok=True)
        for species in ids:
            os.replace(os.path.join(stage, f'{species}.glb'), os.path.join(out_dir, f'{species}.glb'))
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    if not only:
        text = json.dumps({'version': 1, 'contract': 'creature v1 (pets pipeline)', 'fps': FPS, 'units': 'm', 'up': '+Y',
                           'front': '+Z', 'lods': {'lod0': NODES[0], 'lod1': NODES[1]}, 'budget': {'lod0': BUDGET[0], 'lod1': BUDGET[1]},
                           'recolour': 'Paint', 'species': entries}, indent=1) + '\n'
        tmp = os.path.join(root, f'.{MANIFEST}.tmp')
        with open(tmp, 'w', encoding='utf-8', newline='\n') as fh:
            fh.write(text)
        os.replace(tmp, os.path.join(root, MANIFEST))
        print(f'[wildlife] wrote {os.path.join(root, MANIFEST)}')
    else:
        print('[wildlife] subset build: manifest not rewritten')
    if args.preview:
        render_sheet(ids)
    return 0


if __name__ == '__main__':
    sys.exit(main())
