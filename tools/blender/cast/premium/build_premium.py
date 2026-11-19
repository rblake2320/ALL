#!/usr/bin/env python
"""Build the premium bodies (tools/blender/cast/premium/bodies.json) with the cast pipeline (../lib).

    blender -b --factory-startup --python-exit-code 1 --python tools/blender/cast/premium/build_premium.py -- --src <dir of *_rigged.glb>
        [--only a,b] [--out-dir DIR] [--preview] [--no-thumbs]

Sources come from prep_source.py (one `<sourceId>_rigged.glb` per body). Every body is published twice, the same
design on the same 22-bone cast rig:
    public/assets/models/characters/premium/<id>.glb       `high`  (budget declared in bodies.json)
    public/assets/models/characters/premium/<id>_low.glb   `low`   (the unchanged cast budget)
plus public/assets/ui/premium/<id>.webp and public/assets/manifest.premium.json. The 25-body cast kit, its
manifest and its budget are not touched.

Publishing is staged: everything is built and verified in a staging folder, then the files are renamed into place
one by one, the manifest last. A failed check publishes nothing and exits non-zero (also after an uncaught exception).
It is not transactional: a rename that fails part-way (a file held open on Windows) leaves newer GLBs under the old
manifest; tests/unit/premium-assets then fails on the hash mismatch, and a full rebuild repairs it.
With --only, bodies that are not rebuilt keep their published entry, which must still match its files, and
zombie.glb (the clip source they were fitted to) must be unchanged since that manifest.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import shutil
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
CAST = os.path.dirname(HERE)
sys.path.insert(0, CAST)
sys.path.insert(0, str(pathlib.Path(CAST).parent))

import bpy  # noqa: E402

from common import toolchain  # noqa: E402
from lib import anchors as AN  # noqa: E402
from lib import glb as G  # noqa: E402
from lib import measure as MS  # noqa: E402
from lib import preview as PV  # noqa: E402
from lib import profiles  # noqa: E402
from lib.build import build_body  # noqa: E402
from lib.config import ASSETS_DIR, CAST_BONES, CAST_RIG_VERSION, PROJECT_ROOT, ZOMBIE_GLB  # noqa: E402
from lib.zref import ZombieRef  # noqa: E402

import build_cast as BC  # noqa: E402  (pelvis_rule, publish)

BODIES_JSON = os.path.join(HERE, 'bodies.json')
GLB_DIR_REL = 'models/characters/premium'
THUMB_DIR_REL = 'ui/premium'
MANIFEST_NAME = 'manifest.premium.json'
OUT_DIR = os.path.join(PROJECT_ROOT, 'tools', 'blender', 'out', 'premium')
REP_KEYS = {'suffix', 'triTarget', 'triBudget', 'texBase', 'texNormal', 'texOrm', 'bytesBudget'}
#: per-body pose tuning (same keys as lib/profiles.py)
#: seat_forward / seat_lift / lie_lift (m) are measured, not guessed: seat_forward brings the lumbar back of the sit
#: clips (src/render/agents/seatFit.ts column 0) to about the classic body's -0.17 m; lie_lift clears the bed
#: penetration of the first build (Astra's audit of 9e39c26, bed_normal).
#: plate_shift {anchor: (x, z)} (m, in the plate's own plane, before it is settled on the hand): in the standing eat
#: the other arm comes across the plate. Measured with the runtime audit code on the built high file (Astra's audit
#: of 3aeb32c: Night Shift's plate 19.7 mm inside the right upper arm at 2.76 s; Bed Nine 8.8 mm); the smallest
#: 10 mm-step shift that leaves no overlap.
PROFILES = {
    'sexton': {'seat_forward': 0.02, 'lie_lift': 0.05},
    'lowside': {'arm_abduction': 14.0, 'seat_forward': 0.11, 'seat_lift': 0.012, 'lie_lift': 0.03},
    'waitress': {'plate_shift': {'standEat': (0.01, 0.0)}},
    'patient': {'seat_forward': 0.03, 'lie_lift': 0.02, 'plate_shift': {'standEat': (0.01, 0.01)}},
    'fisherman': {'arm_abduction': 12.0, 'seat_forward': 0.12, 'lie_lift': 0.025},
}


def log(msg: str) -> None:
    print(msg, flush=True)


def load_spec() -> dict:
    with open(BODIES_JSON, 'r', encoding='utf-8') as fh:
        spec = json.load(fh)
    reps = spec['representations']
    if set(reps) != {'high', 'low'}:
        raise SystemExit(f'bodies.json: representations must be exactly high and low, got {sorted(reps)}')
    for name, r in reps.items():
        if set(r) != REP_KEYS:
            raise SystemExit(f'bodies.json: representation {name} keys {sorted(set(r) ^ REP_KEYS)} differ')
    ids = [b['id'] for b in spec['bodies']]
    if len(set(ids)) != len(ids):
        raise SystemExit('bodies.json: duplicate ids')
    for b in spec['bodies']:
        if not {'id', 'sourceId', 'name', 'height', 'blurb'} <= set(b):
            raise SystemExit(f'bodies.json: body {b.get("id")} is missing a field')
    return spec


def export_rep(res: dict, bdef: dict, rep: dict, path: str, zrot: dict, jpeg: int) -> dict:
    limits = {'tris': rep['triBudget'], 'bytes': rep['bytesBudget'], 'tex': rep['texBase']}
    q = jpeg
    for _ in range(5):
        G.export_glb(path, [res['arm'], res['ob']], q, attributes=res['hemVerts'] > 0)
        if os.path.getsize(path) <= rep['bytesBudget']:
            break
        log(f'  [{bdef["id"]}] {os.path.getsize(path)} bytes at JPEG q{q} > budget, retrying lower')
        q -= 7
    info = G.inspect(path)
    return {'info': info, 'jpeg': q, 'problems': G.verify(info, bdef['height'], zrot, os.path.getsize(path), limits)}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--src', required=True)
    ap.add_argument('--only', default='')
    ap.add_argument('--out-dir', default=None)
    ap.add_argument('--preview', action='store_true')
    ap.add_argument('--no-thumbs', action='store_true')
    args = ap.parse_args(argv)
    toolchain.require('characters/premium', scratch=bool(args.out_dir))

    spec = load_spec()
    reps = spec['representations']
    bodies = spec['bodies']
    ids = [b['id'] for b in bodies]
    only = [s for s in args.only.split(',') if s]
    bad = [s for s in only if s not in ids]
    if bad:
        log(f'unknown premium ids: {bad}')
        return 2
    todo = [b for b in bodies if not only or b['id'] in only]
    for b in todo:
        p = os.path.join(args.src, f'{b["sourceId"]}_rigged.glb')
        if not os.path.isfile(p):
            log(f'[premium] source not found: {p}')
            return 2

    root = os.path.abspath(args.out_dir) if args.out_dir else ASSETS_DIR
    glb_dir = os.path.join(root, GLB_DIR_REL)
    thumb_dir = os.path.join(root, THUMB_DIR_REL)
    man_path = os.path.join(root, MANIFEST_NAME)
    os.makedirs(OUT_DIR, exist_ok=True)
    stage_parent = root if args.out_dir else OUT_DIR
    os.makedirs(stage_parent, exist_ok=True)
    stage = tempfile.mkdtemp(prefix='.premium-stage-', dir=stage_parent)

    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    zref = ZombieRef()
    ztargets = MS.zombie_targets(zref)
    zrot = G.zombie_rest_rotations(ZOMBIE_GLB)
    plate_rel = AN.classic_offsets(ZOMBIE_GLB)
    grip_rel = AN.classic_grips(ZOMBIE_GLB)

    old = {}
    old_clip = None
    if os.path.exists(man_path):
        with open(man_path, 'r', encoding='utf-8') as fh:
            om = json.load(fh)
        old, old_clip = {b['id']: b for b in om['bodies']}, om.get('clipSourceSha256')
    zsha = G.sha256(ZOMBIE_GLB)
    # A body that is not rebuilt keeps seat, lying, thigh-lift and carry values fitted to the clip source it was built
    # against. --only may keep such bodies only while that clip source is unchanged.
    if only and len(todo) < len(bodies) and old_clip != zsha:
        log(f'[premium] zombie.glb changed since the published manifest ({old_clip} -> {zsha}): every body must be '
            f'rebuilt; run without --only. Nothing published.')
        return 4

    entries, staged, report, failures = {}, [], {}, []
    try:
        for b in todo:
            bid = b['id']
            src_path = os.path.join(args.src, f'{b["sourceId"]}_rigged.glb')
            bdef = {'id': bid, 'sourceId': b['sourceId'], 'name': b['name'], 'category': 'zombie',
                    'height': float(b['height'])}
            entry = {'id': bid, 'name': b['name'], 'height': bdef['height'], 'sourceSha256': G.sha256(src_path),
                     'representations': {}}
            report[bid] = {}
            book_fixed = {}
            for rname in ('high', 'low'):
                rep = reps[rname]
                prof = dict(profiles.DEFAULT)
                prof.update(PROFILES.get(bid, {}))
                prof.update({'no_props': True, 'lift_per_clip': True, 'fit_book': True, 'settle_props': True,'tri_target': rep['triTarget'], 'base_size': rep['texBase'],
                             'normal_size': rep['texNormal'], 'orm_size': rep['texOrm']})
                if rname != 'high' and book_fixed:
                    prof['book_fixed'] = book_fixed
                log(f'[premium] {bid}/{rname} <- {src_path}')
                res = build_body(bdef, src_path, prof, zref, ztargets, log)
                if rname == 'high':
                    book_fixed = {k: res['carry'][k] for k in ('read', 'sitRead') if k in res['carry']}
                fname = f'{bid}{rep["suffix"]}.glb'
                gpath = os.path.join(stage, fname)
                ex = export_rep(res, bdef, rep, gpath, zrot, prof['jpeg'])
                if ex['problems']:
                    for p in ex['problems']:
                        log(f'[premium] VERIFY FAILED {bid}/{rname}: {p}')
                    failures.append(f'{bid}/{rname}')
                    continue
                info = ex['info']
                nbytes = os.path.getsize(gpath)
                entry['representations'][rname] = {
                    'file': f'{GLB_DIR_REL}/{fname}', 'bytes': nbytes, 'sha256': G.sha256(gpath),
                    'triangles': info['triangles'], 'headTop': round(info['max'][1], 4),
                    'pelvisRest': res['body']['pelvisRest'], 'pelvisScale': res['body']['pelvisScale'],
                    'seatPelvisOffset': res['body']['seatPelvisOffset'], 'lyingOffset': res['body']['lyingOffset'],
                    'sitThighLift': res['body']['sitThighLift'],
                    'sitThighLiftByClip': res['body']['sitThighLiftByClip'], 'eyeMaterial': None, 'bones': list(info['joints']),
                    'materials': info['materials'],
                    'textures': [{'size': im['size'], 'bytes': im['bytes']} for im in info['images']],
                    'limbCollapse': {k: v['quality'] for k, v in res['limbs'].items()},
                    'carryAnchors': AN.fit_grip_anchors(
                        gpath, AN.fit_plate_anchors(gpath, res['carry'], plate_rel, res['hand']['k'], settle=True, log=log,
                                                    shift=prof.get('plate_shift')), grip_rel, log=log),
                    'seatProbe': res['seatProbe'],
                }
                staged.append((gpath, os.path.join(glb_dir, fname)))
                report[bid][rname] = {k: res[k] for k in ('seat', 'lie', 'clips', 'limbs', 'repose', 'useAO', 'maps')}
                report[bid][rname].update({'hand': res['hand'], 'bytes': nbytes, 'triangles': info['triangles'],
                                           'jpeg': ex['jpeg'], 'images': [im['size'] for im in info['images']],
                                           'reskinned': res['reskinned']})
                log(f'[premium] {bid}/{rname}: {info["triangles"]} tris, {nbytes / 1024:.0f} KiB, '
                    f'top {info["max"][1]:.3f} m ({time.time() - t0:.0f}s)')
                if rname == 'high':
                    if not args.no_thumbs:
                        tp = os.path.join(stage, f'{bid}.webp')
                        entry['thumbFace'] = PV.thumbnail(res, tp, bdef['height'])
                        staged.append((tp, os.path.join(thumb_dir, f'{bid}.webp')))
                    if args.preview:
                        PV.clip_sheet(res, zref, os.path.join(OUT_DIR, f'sheet_{bid}.png'), stage, bdef['height'])
            if len(entry['representations']) == 2:
                entries[bid] = entry
        if failures:
            log(f'[premium] {len(failures)} builds failed verification ({failures}); nothing published')
            return 3
        out_bodies = []
        for b in bodies:
            bid = b['id']
            if bid in entries:
                out_bodies.append(entries[bid])
                continue
            e = old.get(bid)
            ok = bool(e) and all(
                os.path.exists(os.path.join(root, r['file'])) and G.sha256(os.path.join(root, r['file'])) == r['sha256']
                for r in e['representations'].values())
            if not ok:
                log(f'[premium] {bid} is not rebuilt and has no valid published entry; run without --only')
                return 4
            out_bodies.append(e)
        total = sum(r['bytes'] for e in out_bodies for r in e['representations'].values())
        if total > spec['totalBytesBudget']:
            log(f'[premium] total {total} bytes > {spec["totalBytesBudget"]}; nothing published')
            return 5
        manifest = {'version': 1, 'rigVersion': CAST_RIG_VERSION, 'animationsShared': True,
                    'clipSource': 'models/characters/zombie.glb', 'clipSourceSha256': zsha,
                    'bones': CAST_BONES, 'pelvisRule': BC.pelvis_rule(zref, ztargets),
                    'budgets': {k: {kk: vv for kk, vv in v.items() if kk != 'suffix'} for k, v in reps.items()},
                    'totalBytes': total, 'bodies': out_bodies}
        mpath = os.path.join(stage, MANIFEST_NAME)
        with open(mpath, 'w', encoding='utf-8', newline='\n') as fh:
            json.dump(manifest, fh, indent=2, sort_keys=False)
            fh.write('\n')
        staged.append((mpath, man_path))
        BC.publish(staged)
        rname = 'report.json' if not only else f'report_{"_".join(only)}.json'
        with open(os.path.join(OUT_DIR, rname), 'w', encoding='utf-8', newline='\n') as fh:
            json.dump(report, fh, indent=1, default=float)
        log(f'[premium] published {len(entries)} bodies x 2 to {root} (total {total / 1024 / 1024:.2f} MiB, '
            f'{time.time() - t0:.0f}s)')
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    return 0


if __name__ == '__main__':
    argv = sys.argv[1:]
    if '--' in argv:
        argv = argv[argv.index('--') + 1:]
    # Blender exits 0 after an uncaught Python exception unless it was started with --python-exit-code. A failed
    # build must not look like a published one to a wrapper that reads the exit code, whatever flags it passed.
    try:
        code = main(argv)
    except SystemExit:
        raise
    except BaseException:  # noqa: BLE001
        import traceback
        traceback.print_exc()
        code = 1
    sys.exit(code)
