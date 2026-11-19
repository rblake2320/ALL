#!/usr/bin/env python
"""Build the 25 Afterlife Lease cast bodies (src/shared/cast.ts) from the owner's Zombie Smash 2 models.

    /home/user/.venvs/blender/bin/python tools/blender/cast/build_cast.py [--only id[,id]] [--preview]
    /home/user/.venvs/blender/bin/python tools/blender/cast/build_cast.py --out-dir /tmp/castcheck   (reproducibility)

Inputs   --src DIR (default /home/user/zombie-smash-2/assets/models)/<sourceId>_rigged.glb  (read-only)
         public/assets/models/characters/zombie.glb (reference skeleton + the shared clips)
Outputs  public/assets/models/characters/cast/<id>.glb   skinned 'Body' on the zombie.glb skeleton, NO animations
         public/assets/ui/cast/<id>.webp                  256x256 CAZ thumbnail (transparent, bust)
         public/assets/manifest.cast.json                 {version, rigVersion, animationsShared, pelvisRule, bodies[]}
         tools/blender/out/cast/                          report.json; with --preview sheet_<id>.png + contact_sheet.png
With --out-dir DIR the same files go to DIR/models/characters/cast, DIR/ui/cast and DIR/manifest.cast.json.

Publishing is atomic: everything is exported + verified in a staging folder and then renamed over the live files
(GLBs first, thumbnails, manifest last). Any failed check publishes nothing. Deterministic: same input -> byte-
identical GLBs, manifest and thumbnails (thumbnails render on one CPU thread; see lib/preview.py).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402

from lib import anchors as AN  # noqa: E402
from lib import glb as G  # noqa: E402
from lib import measure as MS  # noqa: E402
from lib import preview as PV  # noqa: E402
from lib import profiles  # noqa: E402
from lib.build import build_body, reset_scene  # noqa: E402
from lib.config import (ASSETS_DIR, CAST_BONES, CAST_RIG_VERSION, DEFAULT_SRC, GLB_BYTES_BUDGET, GLB_DIR_REL,  # noqa: E402
                        MANIFEST_NAME, MANIFEST_VERSION, OUT_DIR, SIT_CLIPS, THUMB_DIR_REL, TOTAL_BYTES_BUDGET,
                        ZOMBIE_GLB, parse_cast_bodies)
from lib.retarget import LYING_SPAN, LYING_Y0  # noqa: E402
from lib.zref import ZombieRef  # noqa: E402


def log(msg: str) -> None:
    print(msg, flush=True)


def publish(staged: list[tuple[str, str]]) -> None:
    for src, dst in staged:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        try:
            os.replace(src, dst)
        except OSError:
            tmp = dst + '.tmp-cast'
            shutil.copyfile(src, tmp)
            os.replace(tmp, dst)


def pelvis_rule(zref, ztargets) -> dict:
    p0 = [round(v, 5) for v in (zref.head['pelvis'].x, zref.head['pelvis'].z, -zref.head['pelvis'].y)]
    return {
        'zombiePelvisRest': p0,
        'sitClips': list(SIT_CLIPS),
        'sit': 'p + seatPelvisOffset',
        'other': 'pelvisRest + (p - zombiePelvisRest) * pelvisScale + lyingOffset * clamp((lyingY0 - p.y) / lyingSpan, 0, 1)',
        'lyingY0': LYING_Y0, 'lyingSpan': LYING_SPAN,
        'sitThighLift': 'sit* clips: thigh_L/R.quaternion q -> qx(-sitThighLift deg) * q (pelvis-local X axis)',
        'seatContactY': round(ztargets['seat_min_y'], 4),
        'dropTracks': 'every .position/.scale track except pelvis.position; tracks of bones the body lacks (jaw)',
    }


def export_body(res: dict, bdef: dict, prof: dict, path: str, zrot: dict) -> dict:
    q = prof['jpeg']
    for attempt in range(5):
        G.export_glb(path, [res['arm'], res['ob']], q, attributes=res['hemVerts'] > 0)
        n = os.path.getsize(path)
        if n <= GLB_BYTES_BUDGET:
            break
        log(f'  [{bdef["id"]}] {n} bytes at JPEG q{q} > budget, retrying lower')
        q -= 7
    info = G.inspect(path)
    problems = G.verify(info, bdef['height'], zrot, os.path.getsize(path))
    return {'info': info, 'problems': problems, 'jpeg': q}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--src', default=DEFAULT_SRC)
    ap.add_argument('--only', default='', help='comma list of cast ids (others keep their published entry)')
    ap.add_argument('--out-dir', default=None)
    ap.add_argument('--preview', action='store_true', help='also render per-body clip sheets + contact sheet')
    ap.add_argument('--no-thumbs', action='store_true', help='skip the CAZ thumbnails (debug only; still publishes)')
    args = ap.parse_args(argv)
    # one exporter per kit (tools/blender/toolchains.json): refuse to publish with another Blender
    import pathlib as _pathlib
    sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parents[1]))
    from common import toolchain as _toolchain
    _toolchain.require('characters/cast', scratch=bool(args.out_dir))

    bodies = parse_cast_bodies()
    ids = [b['id'] for b in bodies]
    only = [s for s in args.only.split(',') if s]
    bad = [s for s in only if s not in ids]
    if bad:
        log(f'unknown cast ids: {bad}')
        return 2
    todo = [b for b in bodies if not only or b['id'] in only]

    root = os.path.abspath(args.out_dir) if args.out_dir else ASSETS_DIR
    glb_dir = os.path.join(root, GLB_DIR_REL)
    thumb_dir = os.path.join(root, THUMB_DIR_REL)
    man_path = os.path.join(root, MANIFEST_NAME)
    os.makedirs(OUT_DIR, exist_ok=True)
    stage_parent = root if args.out_dir else OUT_DIR
    os.makedirs(stage_parent, exist_ok=True)
    stage = tempfile.mkdtemp(prefix='.cast-stage-', dir=stage_parent)

    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    zref = ZombieRef()
    ztargets = MS.zombie_targets(zref)
    log(f'[cast] zombie reference: seat min y {ztargets["seat_min_y"]:.4f}, lying min y {ztargets["lie_min_y"]:.4f}, '
        f'lying centre z {ztargets["lie_center_z"]:.4f}')
    zrot = G.zombie_rest_rotations(ZOMBIE_GLB)
    zsha = G.sha256(ZOMBIE_GLB)
    plate_rel = AN.classic_offsets(ZOMBIE_GLB)

    old = {}
    if os.path.exists(man_path):
        try:
            with open(man_path, 'r', encoding='utf-8') as fh:
                old = {b['id']: b for b in json.load(fh).get('bodies', [])}
        except (OSError, ValueError, KeyError):
            old = {}

    entries, staged, report, failures = {}, [], {}, []
    tiles = []
    try:
        for bdef in todo:
            bid = bdef['id']
            src_path = os.path.join(args.src, f'{bdef["sourceId"]}_rigged.glb')
            log(f'[cast] {bid} <- {src_path}')
            prof = profiles.get(bid)
            res = build_body(bdef, src_path, prof, zref, ztargets, log)
            gpath = os.path.join(stage, f'{bid}.glb')
            ex = export_body(res, bdef, prof, gpath, zrot)
            if ex['problems']:
                for p in ex['problems']:
                    log(f'[cast] VERIFY FAILED {bid}: {p}')
                failures.append(bid)
                continue
            info = ex['info']
            nbytes = os.path.getsize(gpath)
            entries[bid] = {
                'id': bid, 'file': f'{GLB_DIR_REL}/{bid}.glb', 'bytes': nbytes, 'sha256': G.sha256(gpath),
                'sourceSha256': G.sha256(src_path), 'triangles': info['triangles'], 'height': bdef['height'],
                'headTop': round(info['max'][1], 4), 'pelvisRest': res['body']['pelvisRest'],
                'pelvisScale': res['body']['pelvisScale'], 'seatPelvisOffset': res['body']['seatPelvisOffset'],
                'lyingOffset': res['body']['lyingOffset'], 'sitThighLift': res['body']['sitThighLift'],
                'eyeMaterial': None, 'bones': list(info['joints']),
                'materials': info['materials'],
                'textures': [{'size': im['size'], 'bytes': im['bytes']} for im in info['images']],
                'limbCollapse': {k: v['quality'] for k, v in res['limbs'].items()},
                'carryAnchors': AN.fit_plate_anchors(gpath, res['carry'], plate_rel, res['hand']['k']),
                'seatProbe': res['seatProbe'],
                'thumbFace': PV.thumb_framing(res)['crop'],
            }
            staged.append((gpath, os.path.join(glb_dir, f'{bid}.glb')))
            report[bid] = {k: res[k] for k in ('seat', 'lie', 'clips', 'limbs', 'zombify', 'repose', 'useAO', 'maps')}
            report[bid].update({'hand': res['hand'], 'bytes': nbytes, 'triangles': info['triangles'], 'jpeg': ex['jpeg'],
                                'images': [im['size'] for im in info['images']]})
            log(f'[cast] {bid}: {info["triangles"]} tris, {nbytes / 1024:.0f} KiB, top {info["max"][1]:.3f} m '
                f'({time.time() - t0:.0f}s)')
            if not args.no_thumbs:
                tp = os.path.join(stage, f'{bid}.webp')
                entries[bid]['thumbFace'] = PV.thumbnail(res, tp, bdef['height'])
                staged.append((tp, os.path.join(thumb_dir, f'{bid}.webp')))
            if args.preview:
                PV.clip_sheet(res, zref, os.path.join(OUT_DIR, f'sheet_{bid}.png'), stage, bdef['height'])
                tpath = os.path.join(OUT_DIR, f'tile_{bid}.png')
                PV.contact_tile(res, tpath, bdef['height'], bdef['name'])
                tiles.append(tpath)
        if failures:
            log(f'[cast] {len(failures)} bodies failed verification ({failures}); nothing published')
            return 3
        # complete manifest: bodies not rebuilt keep their published entry (must exist and match its file)
        out_bodies = []
        for bdef in bodies:
            bid = bdef['id']
            if bid in entries:
                out_bodies.append(entries[bid])
                continue
            e = old.get(bid)
            f = os.path.join(root, GLB_DIR_REL, f'{bid}.glb')
            if not e or not os.path.exists(f) or G.sha256(f) != e.get('sha256'):
                log(f'[cast] {bid} is not rebuilt and has no valid published entry; run without --only')
                return 4
            out_bodies.append(e)
        total = sum(b['bytes'] for b in out_bodies)
        if total > TOTAL_BYTES_BUDGET:
            log(f'[cast] total {total} bytes > {TOTAL_BYTES_BUDGET}; nothing published')
            return 5
        manifest = {'version': MANIFEST_VERSION, 'rigVersion': CAST_RIG_VERSION, 'animationsShared': True,
                    'clipSource': 'models/characters/zombie.glb', 'clipSourceSha256': zsha,
                    'bones': CAST_BONES, 'pelvisRule': pelvis_rule(zref, ztargets), 'totalBytes': total, 'bodies': out_bodies}
        mpath = os.path.join(stage, MANIFEST_NAME)
        with open(mpath, 'w', encoding='utf-8') as fh:
            json.dump(manifest, fh, indent=2, sort_keys=False)
            fh.write('\n')
        staged.append((mpath, man_path))
        publish(staged)
        with open(os.path.join(OUT_DIR, 'report.json' if not only else f'report_{"_".join(only)}.json'), 'w') as fh:
            json.dump(report, fh, indent=1, default=float)
        log(f'[cast] published {len(entries)} bodies to {root} (total {total / 1024 / 1024:.2f} MiB, '
            f'{time.time() - t0:.0f}s)')
        if args.preview and tiles and not only:
            PV.contact_sheet(tiles, os.path.join(OUT_DIR, 'contact_sheet.png'))
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    return 0


if __name__ == '__main__':
    argv = sys.argv[1:]
    if '--' in argv:
        argv = argv[argv.index('--') + 1:]
    sys.exit(main(argv))
