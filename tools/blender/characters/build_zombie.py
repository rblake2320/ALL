#!/usr/bin/env python
"""Build the Afterlife Lease zombie character (headless Blender via the bpy module).

    /home/user/.venvs/blender/bin/python tools/blender/characters/build_zombie.py [--preview] [--sheets ...]
    /home/user/.venvs/blender/bin/python tools/blender/characters/build_zombie.py --out-dir /tmp/zb   (reproducibility)

Outputs
  public/assets/models/characters/zombie.glb     skinned rig + every variant mesh + 45 animations + morphs
  public/assets/manifest.characters.json         {version, file, bytes, sha256, animations[], morphs[], nodes[], ...}
  tools/blender/out/characters/*.png             (--preview) Cycles contact sheets
With --out-dir DIR the same two files go to DIR/models/characters/zombie.glb and DIR/manifest.characters.json
(public/assets is not touched), e.g. to prove a clean rebuild is byte-identical to the published asset.

Publishing is atomic: the GLB and manifest are exported + verified in a staging folder next to the target and only
then renamed over the live files (the renderer loads them live; a failed or interrupted build changes nothing).
Deterministic: no wall-clock or unseeded randomness; rebuilding produces byte-identical output.
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

import bpy  # noqa: E402  (must precede mathutils users)

from lib import build  # noqa: E402
from lib.anchors import compute_anchors  # noqa: E402
from lib.checks import hair_clearance  # noqa: E402
from lib.anim.bake import bake_all  # noqa: E402
from lib.anim.clips import all_clips  # noqa: E402
from lib.consts import ANIM_STATES, DIM, PROJECT_ROOT  # noqa: E402
from lib.export import export_glb, gltf_local_quat, inspect, verify, write_manifest  # noqa: E402
from lib.face import LID_CLOSURE  # noqa: E402
from lib.names import required_nodes  # noqa: E402
from lib.skeleton import CARRY_POSE_L, ORDER, base_kind, euler_matrix, mirror_name  # noqa: E402

GLB_REL = 'models/characters/zombie.glb'
MANIFEST_NAME = 'manifest.characters.json'
TRIANGLE_BUDGET = 14000   # CONTRACTS #15 / ART_DIRECTION: all variants present
GLB_BYTES_BUDGET = 4 * 1024 * 1024
ASSETS_DIR = os.path.join(PROJECT_ROOT, 'public', 'assets')
GLB_PATH = os.path.join(ASSETS_DIR, GLB_REL)
MANIFEST_PATH = os.path.join(ASSETS_DIR, MANIFEST_NAME)
OUT_DIR = os.path.join(PROJECT_ROOT, 'tools', 'blender', 'out', 'characters')


def publish_paths(out_dir: str | None) -> tuple[str, str]:
    """(glb path, manifest path) under an assets root (public/assets unless --out-dir)."""
    root = os.path.abspath(out_dir) if out_dir else ASSETS_DIR
    return os.path.join(root, GLB_REL), os.path.join(root, MANIFEST_NAME)


def stage_dir_for(out_dir: str | None) -> str:
    """A fresh staging folder OUTSIDE the served asset folder (tools/blender/out/characters, same filesystem as
    public/assets, so the final rename is atomic); with --out-dir, inside that folder."""
    parent = os.path.abspath(out_dir) if out_dir else OUT_DIR
    os.makedirs(parent, exist_ok=True)
    return tempfile.mkdtemp(prefix='.zombie-stage-', dir=parent)


def publish(staged: list[tuple[str, str]]) -> None:
    """Move staged files over their targets: GLB first, manifest last (its sha256 describes the new GLB).
    Each move is an atomic rename; across filesystems the file is first copied next to its target."""
    for src, dst in staged:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        try:
            os.replace(src, dst)
        except OSError:
            tmp = dst + '.tmp-zombie'
            shutil.copyfile(src, tmp)
            os.replace(tmp, dst)


def rig_metadata(arm, sk, clips: dict) -> dict:
    """Extras stored on the 'Rig' node (three.js: rig.userData): carry pose, per-clip carry anchors, face tuning,
    pose anchors."""
    carry = {}
    for side in ('L', 'R'):
        for k, v in CARRY_POSE_L.items():
            name = k if side == 'L' else mirror_name(k)
            vals = v if side == 'L' else (v[0], -v[1], -v[2])
            R = euler_matrix(vals[0], vals[1], vals[2], ORDER[base_kind(name)])
            carry[name] = gltf_local_quat(arm, name, R)
    return {
        'zombieRigVersion': 2,
        'carryPose': carry,
        'carryAnchors': compute_anchors(arm, sk, clips),
        'lidClosure': dict(LID_CLOSURE),
        'anchors': {'seatHeight': DIM['SEAT_HEIGHT'], 'lieHeight': 0.11, 'headTop': 1.62},
    }


def set_extras(arm, meta: dict) -> None:
    for k, v in meta.items():
        arm[k] = json.dumps(v) if isinstance(v, (dict, list)) else v


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--preview', action='store_true', help='render Cycles contact sheets after export')
    ap.add_argument('--preview-only', action='store_true', help='skip export, only render sheets')
    ap.add_argument('--sheets', default='all', help='comma list: appearance,expressions,poses (or poses_<n>),limbs,walk,hair,cycles (or cycle_<clip>) '
                         'or all')
    ap.add_argument('--morph-normals', action='store_true', help='export morph normals (bigger file)')
    ap.add_argument('--out-dir', default=None,
                    help='write models/characters/zombie.glb + manifest.characters.json under this folder instead of '
                         'public/assets (reproducibility checks; public/assets is left untouched)')
    args = ap.parse_args(argv)
    # one exporter per kit (tools/blender/toolchains.json): refuse to publish with another Blender
    import pathlib as _pathlib
    sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parents[1]))
    from common import toolchain as _toolchain
    _toolchain.require('characters', scratch=bool(args.out_dir))
    glb_path, manifest_path = publish_paths(args.out_dir)

    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    ch = build.build_character()
    arm = ch['arm']
    tot, rows = build.tri_report(ch['parts'])
    print(f'[zombie] built {len(ch["objects"])} meshes, {tot} triangles ({time.time() - t0:.1f}s)')
    clearance_problems, clearance = hair_clearance(ch['parts'])
    print('[zombie] hair shell clearance (min mm): ' + ', '.join(f'{k[5:] if k.startswith("Hair_") else k} {v}'
                                                              for k, v in sorted(clearance.items())))
    if tot > TRIANGLE_BUDGET:
        clearance_problems.append(f'{tot} triangles exceeds the {TRIANGLE_BUDGET} budget')
    if clearance_problems:
        for p in clearance_problems:
            print('[zombie] CHECK FAILED:', p, file=sys.stderr)
        return 3

    clips = all_clips()
    names = bake_all(arm, ch['sk'], clips, list(ANIM_STATES))
    print(f'[zombie] baked {len(names)} actions ({time.time() - t0:.1f}s)')

    meta = rig_metadata(arm, ch['sk'], clips)
    set_extras(arm, meta)

    if not args.preview_only:
        stage = stage_dir_for(args.out_dir)
        try:
            staged_glb = os.path.join(stage, os.path.basename(glb_path))
            staged_man = os.path.join(stage, MANIFEST_NAME)
            export_glb(staged_glb, morph_normals=args.morph_normals)
            info = inspect(staged_glb)
            problems = verify(info, required_nodes())
            if os.path.getsize(staged_glb) > GLB_BYTES_BUDGET:
                problems.append(f'{os.path.getsize(staged_glb)} bytes exceeds the {GLB_BYTES_BUDGET} byte budget')
            if problems:
                for p in problems:
                    print('[zombie] VERIFY FAILED (nothing published):', p, file=sys.stderr)
                return 2
            man = write_manifest(staged_man, staged_glb, GLB_REL, info, clips,
                                 {'oneShots': [n for n in ANIM_STATES if not clips[n]['loop']], 'fps': 30,
                                  'meshCount': len(info['meshNodes']), 'rigVersion': meta['zombieRigVersion'],
                                  'carryAnchors': sorted(meta['carryAnchors'].keys()),
                                  'hairClearanceMm': clearance})
            publish([(staged_glb, glb_path), (staged_man, manifest_path)])
        finally:
            shutil.rmtree(stage, ignore_errors=True)
        print(f'[zombie] exported {glb_path} ({man["bytes"] / 1024:.0f} KiB, {man["triangles"]} tris, '
              f'{len(man["animations"])} animations) sha256={man["sha256"][:12]} ({time.time() - t0:.1f}s)')

    if args.preview or args.preview_only:
        from lib import sheets
        sheets.render_all(ch, clips, OUT_DIR, args.sheets)
        print(f'[zombie] previews written to {OUT_DIR} ({time.time() - t0:.1f}s)')
    return 0


if __name__ == '__main__':
    argv = sys.argv[1:]
    if '--' in argv:
        argv = argv[argv.index('--') + 1:]
    sys.exit(main(argv))
