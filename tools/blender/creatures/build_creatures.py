#!/usr/bin/env python
"""Build the non-pet creatures (creature contract v1) on the pets pipeline. Today: `gator_toothless`, Old Toothless
the undead alligator of the Swampside Bayou (docs/levels/L4-bayou.md §6).

    blender -b --factory-startup --python-exit-code 1 --python tools/blender/creatures/build_creatures.py --
            [--only gator_toothless] [--out DIR] [--preview]

Outputs
  public/assets/models/creatures/<id>.glb   one skeleton, two skinned meshes (Creature_lod0, Creature_lod1), the clips
  public/assets/manifest.creatures.json     file, bytes, sha256, triangles, bones, clips, size, floor outline, frames

The rig, the skinning, the clip baking, the export and the checks are the wildlife build's (tools/blender/wildlife),
which is itself the pets pipeline; this driver supplies the animal's own body, clips and budgets. Every GLB is
exported and checked in a staging folder first; the manifest is written last and never by a subset build.
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
for sub in ('pets', 'wildlife'):
    sys.path.insert(0, os.path.join(HERE, '..', sub))
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, HERE)
PROJECT_ROOT = os.path.normpath(os.path.join(HERE, '..', '..', '..'))

import build_wildlife as bw  # noqa: E402
import gator  # noqa: E402
import manifest_meta as meta  # noqa: E402
from petlib import build  # noqa: E402
from petlib.rig import Rig  # noqa: E402

ASSETS_DIR = os.path.join(PROJECT_ROOT, 'public', 'assets')
MANIFEST = 'manifest.creatures.json'
NODES = ('Creature_lod0', 'Creature_lod1')
FPS = bw.FPS

#: id -> (spec, clips, clip functions, look, triangle caps for LOD0 / LOD1, body builder)
CREATURES = {
    'gator_toothless': dict(spec=gator.SPEC, clips=gator.CLIPS, table=gator.TABLE, look='undead', budget=(6000, 2000),
                            body=gator.build_part, name='Old Toothless', doc='docs/levels/L4-bayou.md §6'),
}


def use(cid: str) -> dict:
    """Point the wildlife build's tables at one creature (its functions read them when called)."""
    c = CREATURES[cid]
    bw.WILDLIFE = {cid: c['spec']}
    bw.CLIPS = {cid: c['clips']}
    bw.wclips.TABLE = {cid: c['table']}
    bw.BUDGET = c['budget']
    bw.NODES = NODES
    bw.build_scene = build_scene
    return c


def build_scene(cid: str):
    c = CREATURES[cid]
    sp = c['spec']
    build.reset_scene()
    rig = Rig(sp)
    arm = bw.make_armature(rig, sp['scale'])
    mats = build.make_materials(next(iter(sp['paints'].values())))
    objs, tris = [], {}
    for name, detail, low in ((NODES[0], sp['detail'][0], False), (NODES[1], sp['detail'][1], True)):
        part = c['body'](rig, c['look'], name, detail=detail, low=low)
        tris[name] = build.tri_count(part)
        objs.append(build.part_to_object(part, mats, arm))
    return rig, arm, objs, tris


def add_frames(cid: str, rig: Rig, arm, objs) -> dict:
    """Contact frames (D-043) as Empties on the armature at rest, from the rig's joints and the mesh's extent."""
    vs = objs[0].data.vertices
    nose = min(v.co.y for v in vs)
    side = max(v.co.x for v in vs)
    jaw_tip = rig.tail['jaw']
    meta.add_frame('feet', (0.0, 0.0, 0.0), 0.0, 'feet', arm)
    meta.add_frame('mouth', (jaw_tip.x, jaw_tip.y + 0.06, jaw_tip.z + 0.03), 0.0, 'mouth', arm)       # where a fish is offered
    meta.add_frame('chin', (0.0, rig.head['jaw'].y - 0.10, rig.head['jaw'].z - 0.06), 0.0, 'hands', arm)  # the chin scratch
    meta.add_frame('approach', (0.0, nose - 0.55, 0.0), 180.0, 'approach', arm)                       # in front, facing him
    meta.add_frame('approach_side', (side + 0.45, rig.head['head'].y, 0.0), -90.0, 'approach', arm)   # beside the head
    return meta.collect_frames()


def build_one(cid: str, stage: str):
    c = use(cid)
    sp = c['spec']
    rig, arm, objs, tris = build_scene(cid)
    clearance = bw.ground_clearance(cid, rig, arm, objs)
    outline = meta.outline(meta.scene_triangles(objs))        # both levels of detail: the outline covers whichever is shown
    frames = add_frames(cid, rig, arm, objs)
    bw.bake(cid, rig, arm)
    path = os.path.join(stage, f'{cid}.glb')
    build.export_glb(path)
    info = build.inspect(path)
    problems = bw.verify(cid, info, rig, clearance)
    lo = [min(m['min'][i] for m in info['meshes'].values()) for i in range(3)]
    hi = [max(m['max'][i] for m in info['meshes'].values()) for i in range(3)]
    for name, f in frames.items():
        x, y, z = f['pos']
        inside = lo[0] <= x <= hi[0] and lo[2] <= z <= hi[2]
        if f['kind'] == 'approach' and inside:
            problems.append(f'frame {name} is inside the animal')
        if f['kind'] in ('mouth', 'hands') and not (inside and lo[1] - 0.05 <= y <= hi[1] + 0.05):
            problems.append(f'frame {name} is off the animal')
    entry = {
        'name': c['name'], 'doc': c['doc'], 'file': f'models/creatures/{cid}.glb', 'bytes': os.path.getsize(path),
        'sha256': build.sha256(path), 'plan': rig.plan, 'look': c['look'],
        'triangles': {k: info['meshes'][k]['triangles'] for k in sorted(info['meshes'])},
        'budget': {'lod0': c['budget'][0], 'lod1': c['budget'][1]},
        'bones': info['joints'], 'materials': [m for m in info['materials'] if m],
        'clips': [{'name': n, 'duration': d, 'loop': lp} for n, (d, lp) in c['clips'].items()],
        'paints': sp['paints'], 'bounds': {'min': lo, 'max': hi},
        'sizeM': {'width': round(hi[0] - lo[0], 3), 'height': round(hi[1] - lo[1], 3), 'length': round(hi[2] - lo[2], 3)},
        'outline': outline, 'frames': frames, 'groundClearanceMm': clearance,
    }
    print(f"[creatures] {cid}: triangles {entry['triangles']}, size {entry['sizeM']}, clearance {clearance}"
          + ('' if not problems else '  FAILED: ' + '; '.join(problems)))
    return entry, problems


def main() -> int:
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser(prog='build_creatures.py')
    ap.add_argument('--only', default='')
    ap.add_argument('--out', default=None)
    ap.add_argument('--preview', action='store_true')
    args = ap.parse_args(argv)
    # one exporter per kit (tools/blender/toolchains.json): refuse to publish with another Blender
    import pathlib as _pathlib
    sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parents[1]))
    from common import toolchain as _toolchain
    _toolchain.require('creatures', scratch=bool(args.out))
    only = [s for s in args.only.split(',') if s]
    unknown = [s for s in only if s not in CREATURES]
    if unknown:
        print(f'unknown ids: {unknown} (known: {list(CREATURES)})', file=sys.stderr)
        return 2
    ids = only or list(CREATURES)
    root = os.path.abspath(args.out) if args.out else ASSETS_DIR
    os.makedirs(root, exist_ok=True)
    stage = tempfile.mkdtemp(prefix='.creatures-stage-', dir=root)
    try:
        entries, failed = {}, False
        for cid in ids:
            entries[cid], problems = build_one(cid, stage)
            failed = failed or bool(problems)
        if failed:
            print('[creatures] nothing published', file=sys.stderr)
            return 1
        out_dir = os.path.join(root, 'models', 'creatures')
        os.makedirs(out_dir, exist_ok=True)
        for cid in ids:
            os.replace(os.path.join(stage, f'{cid}.glb'), os.path.join(out_dir, f'{cid}.glb'))
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    if not only:
        text = json.dumps({'version': 1, 'contract': 'creature v1 (pets pipeline)', 'fps': FPS, 'units': 'm', 'up': '+Y',
                           'front': '+Z', 'lods': {'lod0': NODES[0], 'lod1': NODES[1]}, 'recolour': 'Paint',
                           'creatures': entries}, indent=1) + '\n'
        tmp = os.path.join(root, f'.{MANIFEST}.tmp')
        with open(tmp, 'w', encoding='utf-8', newline='\n') as fh:
            fh.write(text)
        os.replace(tmp, os.path.join(root, MANIFEST))
        print(f'[creatures] wrote {os.path.join(root, MANIFEST)}')
    else:
        print('[creatures] subset build: manifest not rewritten')
    if args.preview:
        bw.SHEET_DIR = os.path.join(PROJECT_ROOT, 'docs', 'desktop-reports', 'img', 'creatures')
        for cid in ids:
            use(cid)
            sheet = bw.render_sheet([cid])
            target = os.path.join(bw.SHEET_DIR, f'{cid}.jpg')
            os.replace(sheet, target)
            print(f'[creatures] sheet {target}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
