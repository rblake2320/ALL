"""Per-level driver for the L4 Swampside Bayou art kit (decision D-042: one manifest per level).

    blender -b --factory-startup --python tools/blender/levels/build_l4.py -- [--only id1,id2] [--out DIR]
            [--preview] [--no-ao]

Outputs
  public/assets/models/levels/bayou/<id>.glb
  public/assets/manifest.bayou.json     {version, level, models: [...]} — the entry shape of manifest.levels.json
                                        with the D-043 names: `tileFootprint` for the grid size and a generated
                                        `outline` (list of convex parts) per model

Reuses the level kit: `build_levels.build_one` builds, bakes AO, exports, quantizes and validates one model, so the
rebuild is byte-identical and the checks are the L2 kit's. Every validator warning is a failure here. All models
are built in a staging folder first; only when every one passes are they moved into place, the manifest last.
A subset build (--only) never rewrites the manifest.

The publish lock is the pattern of tools/blender/objects/build_all.py (msvcrt byte-range lock on Windows, fcntl
elsewhere), so desktop and cloud builders converge (W-063).
Exit codes: 0 ok, 1 a model failed a check (nothing published), 2 bad arguments, 5 another build holds the lock.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))  # tools/blender -> common, objects, levels, manifest_meta

import manifest_meta as meta  # noqa: E402
from levels import build_levels as BL  # noqa: E402
from levels import kit, l4_specs  # noqa: E402
from levels import l4_env, l4_home, l4_items, l4_shop  # noqa: E402,F401  (register builders)

ROOT = HERE.parents[3]
PUBLIC = ROOT / 'public' / 'assets'
OUT = ROOT / 'tools' / 'blender' / 'out' / 'levels'
SHEET_DIR = ROOT / 'docs' / 'desktop-reports' / 'img' / 'levels'
LEVEL = l4_specs.LEVEL_ID
MANIFEST = f'manifest.{LEVEL}.json'


def acquire_lock(level: str = LEVEL):
    OUT.mkdir(parents=True, exist_ok=True)
    f = open(OUT / f'.build.{level}.lock', 'a+')
    try:
        if os.name == 'nt':  # Windows: byte-range lock on the first byte (released by the OS when the process exits)
            import msvcrt
            f.seek(0)
            try:
                msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as e:
                raise BlockingIOError(str(e)) from e
        else:
            import fcntl
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        f.close()
        raise
    return f


def scene_outline(sid: str, hidden: tuple, convex_only: bool = False) -> list:
    """Floor outline (D-043) of the model build_one left in the scene, without its hidden state nodes.
    convex_only: one hull, no notch search. Used for environment dressing, which nothing is placed against
    and whose organic shapes (a cluster of tree crowns) have no sensible cut into a few convex parts."""
    import bpy

    def chain(ob):
        while ob is not None:
            yield ob.name
            ob = ob.parent

    objs = [ob for ob in bpy.context.scene.objects if ob.type == 'MESH' and not any(n in hidden for n in chain(ob))]
    if not objs:
        raise RuntimeError(f'{sid}: no meshes left in the scene to outline')
    tris = meta.scene_triangles(objs)
    if convex_only:
        return [meta.convex_hull_xz(p for t in tris for p in t)]
    return meta.outline(tris)


def render_sheet(ids, specs, args, level: str = LEVEL) -> Path:
    import bpy
    import numpy as np

    cell, cols = 300, 5
    rows = (len(ids) + cols - 1) // cols
    tmp = Path(tempfile.mkdtemp(prefix=f'{level}-cells-'))
    pargs = SimpleNamespace(ao=True, res=cell, samples=28)
    sheet = np.zeros((rows * cell, cols * cell, 4), dtype=np.float32)
    sheet[..., :3], sheet[..., 3] = 0.5, 1.0
    for i, sid in enumerate(ids):
        BL.build_one(specs[sid], level, pargs, tmp / 'glb', tmp)
        img = bpy.data.images.load(str(tmp / f'{sid}.png'))
        r, c = i // cols, i % cols
        sheet[(rows - 1 - r) * cell:(rows - r) * cell, c * cell:(c + 1) * cell] = \
            np.array(img.pixels[:], dtype=np.float32).reshape(cell, cell, 4)
        bpy.data.images.remove(img)
    SHEET_DIR.mkdir(parents=True, exist_ok=True)
    out = bpy.data.images.new(f'{level}_sheet', cols * cell, rows * cell, alpha=False)
    out.pixels.foreach_set(sheet.ravel())
    target = SHEET_DIR / f'{level}.jpg'
    scene = bpy.context.scene
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = 88
    out.save_render(str(target), scene=scene)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f'[{level}] sheet {target} (row order: {", ".join(ids)})')
    return target


def with_frames(fn, store: dict):
    """Wrap a kit builder so the contact frames it authors (FRAME_ Empties, D-043) are read and removed before the
    kit builds and exports the model. The kit's own build_one has no hook for frames; this keeps them out of the GLB."""
    def wrapped(m, spec):
        import bpy
        fn(m, spec)
        if any(o.name.startswith(meta.FRAME_PREFIX) for o in bpy.context.scene.objects):
            root = bpy.data.objects.new('_frames', None)
            bpy.context.scene.collection.objects.link(root)
            meta.parent_frames(root)
            store[spec.id] = meta.collect_frames()
            bpy.data.objects.remove(root, do_unlink=True)
    return wrapped


def run(level: str, specs_module, prog: str) -> int:
    """Build one per-level kit: public/assets/models/levels/<level>/ and public/assets/manifest.<level>.json."""
    manifest = f'manifest.{level}.json'
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser(prog=prog)
    ap.add_argument('--only', default='')
    ap.add_argument('--out', default=None)
    ap.add_argument('--preview', action='store_true')
    ap.add_argument('--no-ao', dest='ao', action='store_false')
    args = ap.parse_args(argv)
    # one exporter per kit (tools/blender/toolchains.json): refuse to publish with another Blender
    import pathlib as _pathlib
    sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parents[1]))
    from common import toolchain as _toolchain
    _toolchain.require(f'levels/{level}', scratch=bool(args.out))
    specs = specs_module.specs()
    only = [s for s in args.only.split(',') if s]
    unknown = [s for s in only if s not in specs]
    if unknown:
        print(f'unknown ids: {unknown}', file=sys.stderr)
        return 2
    ids = only or list(specs)
    missing = [i for i in ids if i not in kit.BUILDERS]
    if missing:
        print(f'no builder for: {missing}', file=sys.stderr)
        return 1
    root = Path(args.out).resolve() if args.out else PUBLIC
    try:
        lock = acquire_lock(level)
    except BlockingIOError:
        print(f'another {prog} is publishing; try again later', file=sys.stderr)
        return 5
    try:
        root.mkdir(parents=True, exist_ok=True)
        stage = Path(tempfile.mkdtemp(prefix=f'.{level}-stage-', dir=root))
        bargs = SimpleNamespace(ao=args.ao, res=192, samples=12)
        entries, failed, frames = [], False, {}
        try:
            for sid in ids:
                plain = kit.BUILDERS[sid]
                kit.BUILDERS[sid] = with_frames(plain, frames)
                try:
                    res = BL.build_one(specs[sid], level, bargs, stage, None)
                finally:
                    kit.BUILDERS[sid] = plain
                e = res['entry']
                if sid in frames:
                    e['frames'] = frames[sid]
                e['tileFootprint'] = e.pop('footprint')
                hull = specs[sid].kind == 'env' or sid in getattr(specs_module, 'HULL_OUTLINE', ())
                e['outline'] = scene_outline(sid, ('broken',) + tuple(specs[sid].states), hull)
                entries.append(e)
                failed = failed or bool(res['warnings'])
                print(f"[{level}] {sid}: {e['triangles']} triangles (budget {specs[sid].budget}), top {e['bounds']['max'][1]:.2f} m"
                      + ('' if not res['warnings'] else '  FAILED: ' + '; '.join(res['warnings'])))
            if failed:
                print(f'[{level}] nothing published', file=sys.stderr)
                return 1
            out_dir = root / 'models' / 'levels' / level
            out_dir.mkdir(parents=True, exist_ok=True)
            for sid in ids:
                os.replace(stage / f'{sid}.glb', out_dir / f'{sid}.glb')
        finally:
            shutil.rmtree(stage, ignore_errors=True)
        if not only:
            text = json.dumps({'version': 1, 'level': level, 'doc': specs_module.DOC, 'units': 'm', 'up': '+Y', 'front': '+Z',
                               'models': sorted(entries, key=lambda x: x['id'])}, indent=1) + '\n'
            tmp = root / f'.{manifest}.tmp'
            tmp.write_text(text, encoding='utf-8', newline='\n')
            os.replace(tmp, root / manifest)
            print(f'[{level}] wrote {root / manifest}')
        else:
            print(f'[{level}] subset build: manifest not rewritten')
        if args.preview:
            render_sheet(ids, specs, args, level)
        return 0
    finally:
        lock.close()


def main() -> int:
    return run(LEVEL, l4_specs, 'build_l4.py')


if __name__ == '__main__':
    sys.exit(main())
