#!/usr/bin/env python
"""Build the Afterlife Lease pets (headless Blender).

    blender -b --factory-startup --python tools/blender/pets/build_pets.py -- [options]

    --species cat,dog,raccoon,crow   subset to build (default: all; a subset never rewrites the manifest)
    --out-dir DIR                    write DIR/models/pets/*.glb + DIR/manifest.pets.json instead of public/assets
                                     (reproducibility: a clean rebuild must be byte-identical to the published files)
    --preview                        also render Cycles contact sheets to docs/desktop-reports/img/pets/
    --preview-only                   render the sheets without exporting

Outputs
  public/assets/models/pets/<species>.glb   one skeleton, two skinned meshes (Pet_normal, Pet_undead), 9 clips
  public/assets/manifest.pets.json          {file, bytes, sha256, triangles, bones, clips, ...} per species

Each GLB is exported and verified in a staging folder and only then moved over the live file, so a failed build
changes nothing. Deterministic: no wall-clock, no unseeded randomness.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..'))
PROJECT_ROOT = os.path.normpath(os.path.join(HERE, '..', '..', '..'))

import bpy  # noqa: E402

import manifest_meta as meta  # noqa: E402
from petlib import build  # noqa: E402
from petlib.species import CLIP_TIMING, CLIPS, FPS, SPECIES, VARIANT_MATERIALS  # noqa: E402

ASSETS_DIR = os.path.join(PROJECT_ROOT, 'public', 'assets')
MANIFEST_NAME = 'manifest.pets.json'
SHEET_DIR = os.path.join(PROJECT_ROOT, 'docs', 'desktop-reports', 'img', 'pets')


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser(prog='build_pets.py')
    ap.add_argument('--species', default=','.join(SPECIES))
    ap.add_argument('--out-dir')
    ap.add_argument('--preview', action='store_true')
    ap.add_argument('--preview-only', action='store_true')
    args = ap.parse_args(argv)
    args.species = [s for s in args.species.split(',') if s]
    unknown = [s for s in args.species if s not in SPECIES]
    if unknown:
        ap.error(f'unknown species: {unknown} (known: {list(SPECIES)})')
    return args


def build_one(species: str, root: str, stage: str) -> dict:
    rig, arm, objs, tris = build.build_scene(species)
    clearance = build.ground_clearance(arm, rig, objs)
    outline = meta.outline(meta.scene_triangles([objs[0]]))
    nose = min(v.co.y for v in objs[0].data.vertices)                 # front-most point (Blender -Y)
    # frames are Empties on the armature at rest, placed from the rig's own joints
    meta.add_frame('approach', (0.0, nose - 0.45, 0.0), 180.0, 'approach', arm)   # where a zombie stands, facing the pet
    meta.add_frame('pet', rig.head['head'], 0.0, 'hands', arm)                    # a hand on the head
    meta.add_frame('mouth', rig.tail['jaw'], 0.0, 'mouth', arm)                   # food, toys
    meta.add_frame('collar', rig.head['neck'], 0.0, 'attach', arm)                # collars, leashes
    frames = meta.collect_frames()
    build.bake_clips(arm, rig)
    rel = f'models/pets/{species}.glb'
    staged = os.path.join(stage, f'{species}.glb')
    build.export_glb(staged)
    info = build.inspect(staged)
    problems = build.verify(info, rig, clearance)
    for name, n in tris.items():
        if info['meshes'].get(name, {}).get('triangles') != n:
            problems.append(f"{name}: exported {info['meshes'].get(name, {}).get('triangles')} triangles, built {n}")
    if problems:
        raise SystemExit(f'[pets] {species}: verification FAILED\n  - ' + '\n  - '.join(problems))
    lo = [min(m['min'][i] for m in info['meshes'].values()) for i in range(3)]
    hi = [max(m['max'][i] for m in info['meshes'].values()) for i in range(3)]
    entry = {
        'file': rel,
        'bytes': os.path.getsize(staged),
        'sha256': build.sha256(staged),
        'plan': rig.plan,
        'paint': SPECIES[species]['paint'],
        'triangles': {k: info['meshes'][k]['triangles'] for k in sorted(info['meshes'])},
        'bones': info['joints'],
        'materials': [m for m in info['materials'] if m],
        'bounds': {'min': lo, 'max': hi},
        'sizeM': {'width': round(hi[0] - lo[0], 3), 'height': round(hi[1] - lo[1], 3), 'length': round(hi[2] - lo[2], 3)},
        'groundClearanceMm': clearance,
        'outline': outline,
        'frames': frames,
    }
    target = os.path.join(root, rel.replace('/', os.sep))
    os.makedirs(os.path.dirname(target), exist_ok=True)
    os.replace(staged, target)
    print(f"[pets] {species}: {entry['bytes']} bytes, triangles {entry['triangles']}, size {entry['sizeM']}")
    return entry


def main() -> None:
    args = parse_args()
    # one exporter per kit (tools/blender/toolchains.json): refuse to publish with another Blender
    import pathlib as _pathlib
    sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parents[1]))
    from common import toolchain as _toolchain
    _toolchain.require('pets', scratch=bool(args.out_dir))
    root = os.path.abspath(args.out_dir) if args.out_dir else ASSETS_DIR
    if not args.preview_only:
        os.makedirs(root, exist_ok=True)
        stage = tempfile.mkdtemp(prefix='.pets-stage-', dir=root)
        try:
            entries = {sp: build_one(sp, root, stage) for sp in args.species}
        finally:
            shutil.rmtree(stage, ignore_errors=True)
        if args.species == list(SPECIES):
            manifest = {
                'version': 1,
                'fps': FPS,
                'units': 'm',
                'up': '+Y',
                'front': '+Z',
                'clips': [{'name': c, 'duration': CLIP_TIMING[c][0], 'loop': CLIP_TIMING[c][1]} for c in CLIPS],
                'variants': {'normal': 'Pet_normal', 'undead': 'Pet_undead'},
                'variantMaterials': VARIANT_MATERIALS,
                'recolour': 'Paint',
                'triangleBudget': build.TRI_BUDGET,
                'species': entries,
            }
            path = os.path.join(root, MANIFEST_NAME)
            tmp = path + '.tmp'
            with open(tmp, 'w', encoding='utf-8', newline='\n') as fh:
                json.dump(manifest, fh, indent=2)
                fh.write('\n')
            os.replace(tmp, path)
            print(f'[pets] wrote {path}')
        else:
            print('[pets] subset build: manifest not rewritten')
    if args.preview or args.preview_only:
        from petlib import preview
        for sp in args.species:
            preview.render_sheet(sp, SHEET_DIR)


if __name__ == '__main__':
    main()
