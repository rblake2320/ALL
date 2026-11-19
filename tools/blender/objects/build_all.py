"""Build every Afterlife Lease object/env model as GLB + manifest (+ optional Cycles previews).

Usage (headless Blender python, from the project root):
    /home/user/.venvs/blender/bin/python tools/blender/objects/build_all.py [--only id1,id2] [--preview]
        [--sheets] [--no-ao] [--strict] [--res 192] [--samples 12] [--verify] [--out DIR]

Vertex-colour AO is on by default (common/ao.py: deterministic BVH ray casts, one value per vertex); --no-ao skips it.
Every GLB is post-processed (common/glb.py::quantize): KHR_mesh_quantization for normals/colours, duplicate vertices
merged after quantisation and a canonical vertex/triangle order, so rebuilding from the same sources is
byte-identical (stable sha256 in the manifest).

Publishing is atomic: every GLB is first built into a private staging directory (tools/blender/out/objects/.stage-*,
same filesystem as public/). Only when ALL requested models built (and, with --strict, validated without warnings)
are the changed files moved into place with os.replace (unchanged files are not touched), followed by the manifest
(written to a temp file + os.replace). A failed or interrupted build leaves public/ exactly as it was, so a running
dev server / renderer never sees half-written GLBs or a manifest that points at missing files. A lock file
(.build.lock) serialises concurrent publishers.

--verify rebuilds the selected ids into a temporary directory (nothing in public/ is touched) and compares every
GLB byte-for-byte with the committed file and its manifest sha256 (and, for a full build, the manifest text);
exit code 4 on any difference.
--out DIR writes the GLBs to DIR/models/objects/ and the manifest to DIR/manifest.objects.json instead of
public/assets/ (reproducibility checks: `diff -r` against public/assets/models/objects).

Exit codes: 0 ok, 1 a model failed to build (nothing published), 2 bad arguments, 3 validation warnings with
--strict (nothing published), 4 --verify mismatch, 5 another build holds the publish lock.

Outputs
    public/assets/models/objects/<id>.glb
    public/assets/manifest.objects.json   {version, objects:{id:{file,bytes,sha256,tris,bounds:{min,max}}}} (THREE axes)
    tools/blender/out/objects/<id>.png    previews (--preview) + contact sheets (sheet_*.png)
    tools/blender/out/objects/report.json validation report (warnings per model)
"""
from __future__ import annotations

import argparse
import filecmp
import json
import os
import re
import shutil
import sys
import tempfile
import time
import traceback
from pathlib import Path
from typing import Dict, Optional

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))  # tools/blender -> `common`, `objects` packages

from common import publish_lock  # noqa: E402
from common import catalog, export, glb, preview, sheet  # noqa: E402
from common.model import Model, free_parts  # noqa: E402
from objects import registry  # noqa: E402
from objects import validate  # noqa: E402
from objects import (  # noqa: E402,F401  (import registers builders)
    bath,
    beds,
    decor,
    electronics,
    env,
    hobbies,
    items,
    kitchen,
    misc,
    openings,
    seating,
    surfaces,
)

ROOT = HERE.parents[3]
OUT_GLB = ROOT / 'public' / 'assets' / 'models' / 'objects'
MANIFEST = ROOT / 'public' / 'assets' / 'manifest.objects.json'
OUT_PREVIEW = ROOT / 'tools' / 'blender' / 'out' / 'objects'
MANIFEST_VERSION = 1


def _retarget(out: Path) -> None:
    """--out DIR: GLBs, manifest, previews and staging under DIR (public/ is never touched)."""
    global OUT_GLB, MANIFEST, OUT_PREVIEW
    OUT_GLB = out / 'models' / 'objects'
    MANIFEST = out / 'manifest.objects.json'
    OUT_PREVIEW = out / 'previews'


def preview_kind(spec: catalog.Spec) -> str:
    if spec.env:
        return 'env'
    return {'wall': 'wall', 'door': 'door', 'window': 'window', 'item': 'item'}.get(spec.placement, 'floor')


def build_one(spec: catalog.Spec, args: argparse.Namespace, out_dir: Path = None) -> dict:
    out_dir = OUT_GLB if out_dir is None else out_dir
    export.reset_scene()
    paint = spec.variants[0] if spec.variants else None
    m = Model(spec.id, paint)
    registry.BUILDERS[spec.id](m, spec)
    m.build()
    free_parts(m)
    if args.ao:
        from common import ao
        ao.bake_vertex_ao(m, preview_kind(spec))
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f'{spec.id}.glb'
    # export + post-process a temp file, then rename (out_dir is a private staging dir for real builds)
    tmp = out_dir / f'.{spec.id}.tmp.glb'
    export.export_glb(tmp, vertex_colors=args.ao)
    glb.quantize(tmp)
    os.replace(tmp, path)
    info = glb.inspect(path)
    warnings = validate.check(spec, info)
    entry = {
        'file': f'models/objects/{spec.id}.glb',
        'bytes': path.stat().st_size,
        'sha256': export.sha256(path),
        'tris': info.tris,
        'bounds': {'min': [round(v, 4) for v in info.bounds_min], 'max': [round(v, 4) for v in info.bounds_max]},
    }
    if args.preview:
        w, d = (spec.w, spec.d) if not spec.env else validate.env_footprint(spec)
        preview.render_preview(OUT_PREVIEW / f'{spec.id}.png', w, d, preview_kind(spec), args.res, args.samples,
                               hide=('broken',))
    return {'entry': entry, 'warnings': warnings}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='', help='comma-separated ids')
    ap.add_argument('--preview', action='store_true')
    ap.add_argument('--sheets', action='store_true', help='contact sheets from existing previews')
    ap.add_argument('--no-ao', dest='ao', action='store_false', help='skip the vertex-colour AO bake')
    ap.add_argument('--ao', dest='ao', action='store_true', help=argparse.SUPPRESS)
    ap.set_defaults(ao=True)
    ap.add_argument('--strict', action='store_true', help='exit non-zero on validation warnings')
    ap.add_argument('--res', type=int, default=192)
    ap.add_argument('--samples', type=int, default=12)
    ap.add_argument('--verify', action='store_true',
                    help='rebuild into a temp dir and compare bytes with the committed GLBs + manifest (exit 4 on diff)')
    ap.add_argument('--out', default=None, metavar='DIR',
                    help='write DIR/models/objects/*.glb + DIR/manifest.objects.json instead of public/assets/')
    if argv is None:
        argv = sys.argv[1:]
        if '--' in argv:
            argv = argv[argv.index('--') + 1:]
    args = ap.parse_args(argv)
    # one exporter per kit (tools/blender/toolchains.json): refuse to publish with another Blender
    import pathlib as _pathlib
    sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parents[1]))
    from common import toolchain as _toolchain
    _toolchain.require('objects', scratch=bool(args.out) and not args.verify)
    if args.out is not None:
        _retarget(Path(args.out).resolve())

    specs = catalog.all_specs()
    missing = [i for i in specs if i not in registry.BUILDERS]
    only = [s for s in args.only.split(',') if s]
    unknown = [s for s in only if s not in specs]
    if unknown:
        print(f'unknown ids: {unknown}', file=sys.stderr)
        return 2
    ids = only or [i for i in specs if i in registry.BUILDERS]
    if args.verify:
        return verify(specs, ids, args)

    try:
        lock = publish_lock.acquire(OUT_PREVIEW / '.build.lock')
    except BlockingIOError:
        print(f'another build_all.py is publishing ({OUT_PREVIEW / ".build.lock"}); try again later', file=sys.stderr)
        return 5
    try:
        return _build_and_publish(specs, ids, missing, args)
    finally:
        lock.close()


def _read_json(path: Path) -> Optional[dict]:
    try:
        v = json.loads(path.read_text())
        return v if isinstance(v, dict) else None
    except (OSError, ValueError):
        return None


def manifest_text(manifest: dict) -> str:
    return json.dumps({'version': manifest['version'], 'objects': dict(sorted(manifest['objects'].items()))},
                      indent=1) + '\n'


def _replace_file(src: Path, dst: Path) -> None:
    """os.replace when src/dst share a filesystem (atomic), else copy to a sibling temp file + os.replace."""
    try:
        os.replace(src, dst)
    except OSError:
        tmp = dst.with_name(f'.{dst.name}.publish.tmp')
        shutil.copyfile(src, tmp)
        os.replace(tmp, dst)


def _write_text_atomic(path: Path, text: str) -> bool:
    """Atomically replace ``path`` with ``text``; returns False (and touches nothing) when it is already identical."""
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        if path.read_text() == text:
            return False
    except OSError:
        pass
    tmp = path.with_name(f'.{path.name}.tmp')
    tmp.write_text(text)
    os.replace(tmp, path)
    return True


STALE_RE = re.compile(r'^(?:\.[a-z0-9_]+\.(?:tmp|publish\.tmp)\.glb|\.[a-z0-9_]+\.glb\.publish\.tmp|[a-z0-9_]+\.glb)$')


def publish(staged: Dict[str, Path], manifest: dict, prune_to: Optional[set] = None) -> Dict[str, int]:
    """Swap staged GLBs into OUT_GLB (only files whose bytes changed), then atomically replace the manifest.

    GLBs go first, the manifest last: the manifest only ever lists files that are complete on disk. With
    ``prune_to`` (full builds), GLBs of ids no longer in the catalog and temp files left by older crashed builds
    are removed AFTER the new manifest is in place (nothing references them any more)."""
    OUT_GLB.mkdir(parents=True, exist_ok=True)
    stats = {'replaced': 0, 'unchanged': 0, 'pruned': 0}
    for sid, src in staged.items():
        dst = OUT_GLB / f'{sid}.glb'
        if dst.exists() and filecmp.cmp(src, dst, shallow=False):
            stats['unchanged'] += 1
            continue
        _replace_file(src, dst)
        stats['replaced'] += 1
    stats['manifest'] = int(_write_text_atomic(MANIFEST, manifest_text(manifest)))
    if prune_to is not None:
        for f in sorted(OUT_GLB.iterdir()):
            if not f.is_file() or not STALE_RE.match(f.name):
                continue
            if f.name.endswith('.glb') and not f.name.startswith('.') and f.name[:-4] in prune_to:
                continue
            f.unlink()
            stats['pruned'] += 1
            print(f'  pruned stale {f.name}')
    return stats


def _build_and_publish(specs: dict, ids: list, missing: list, args: argparse.Namespace) -> int:
    old = _read_json(MANIFEST) or {}
    manifest = {'version': MANIFEST_VERSION,
                'objects': {k: v for k, v in (old.get('objects') or {}).items() if k in specs}}
    report_path = OUT_PREVIEW / 'report.json' if args.out is None else Path(args.out) / 'report.json'
    report = {k: v for k, v in (_read_json(report_path) or {}).items() if k in specs}

    stage_parent = OUT_PREVIEW if args.out is None else Path(args.out)
    stage_parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.stage-', dir=stage_parent))
    failures = []
    staged: Dict[str, Path] = {}
    t0 = time.time()
    try:
        for i, sid in enumerate(ids):
            t = time.time()
            try:
                res = build_one(specs[sid], args, stage)
            except Exception:  # keep going; report at the end (nothing is published on failure)
                traceback.print_exc()
                failures.append(sid)
                continue
            staged[sid] = stage / f'{sid}.glb'
            manifest['objects'][sid] = res['entry']
            report[sid] = {'tris': res['entry']['tris'], 'bytes': res['entry']['bytes'], 'warnings': res['warnings']}
            flag = ' !' if res['warnings'] else ''
            print(f'[{i + 1:2d}/{len(ids)}] {sid:24s} {res["entry"]["tris"]:6d} tris '
                  f'{res["entry"]["bytes"] / 1024:7.1f} KB {time.time() - t:5.1f}s{flag}')
            for w in res['warnings']:
                print(f'      - {w}')

        _write_text_atomic(report_path, json.dumps(dict(sorted(report.items())), indent=1) + '\n')
        warned = [s for s in ids if report.get(s, {}).get('warnings')]
        if failures:
            print(f'FAILED: {failures} -- nothing published ({MANIFEST.parent} unchanged)', file=sys.stderr)
            rc = 1
        elif args.strict and warned:
            print(f'--strict: validation warnings for {warned} -- nothing published', file=sys.stderr)
            rc = 3
        else:
            full = set(ids) == {i for i in specs if i in registry.BUILDERS}
            st = publish(staged, manifest, prune_to=set(specs) if full else None)
            total = sum(v['bytes'] for v in manifest['objects'].values())
            print(f'built {len(ids)}/{len(ids)} in {time.time() - t0:.1f}s; published {st["replaced"]} changed, '
                  f'{st["unchanged"]} unchanged, manifest {"updated" if st["manifest"] else "unchanged"}; '
                  f'{len(manifest["objects"])} models, {total / 1024 / 1024:.2f} MiB total')
            rc = 0
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    if missing:
        print(f'NO BUILDER for: {missing}')
    if rc == 0 and (args.preview or args.sheets):
        make_sheets(specs)
    return rc


def verify(specs: dict, ids: list, args: argparse.Namespace) -> int:
    """Reproducibility check: fresh build of ``ids`` into a temp dir vs the committed files (bytes + sha256; for a
    full build also the exact manifest text)."""
    committed_raw = _read_json(MANIFEST) or {}
    committed = committed_raw.get('objects') or {}
    args.preview = False
    bad = []
    fresh_manifest = {'version': MANIFEST_VERSION, 'objects': {k: v for k, v in committed.items() if k in specs}}
    with tempfile.TemporaryDirectory(prefix='al-verify-') as td:
        out = Path(td)
        for sid in ids:
            try:
                res = build_one(specs[sid], args, out)
            except Exception:  # pragma: no cover - reported as a mismatch
                traceback.print_exc()
                bad.append((sid, 'build failed'))
                continue
            fresh_manifest['objects'][sid] = res['entry']
            fresh = (out / f'{sid}.glb').read_bytes()
            ref_path = OUT_GLB / f'{sid}.glb'
            ref = ref_path.read_bytes() if ref_path.exists() else b''
            sha = res['entry']['sha256']
            if fresh != ref:
                bad.append((sid, f'bytes differ ({len(fresh)} vs {len(ref)})'))
            elif committed.get(sid) != res['entry']:
                bad.append((sid, 'manifest entry is stale (bytes/sha256/tris/bounds)'))
            else:
                print(f'  ok {sid} {sha[:12]}')
    full = set(ids) == {i for i in specs if i in registry.BUILDERS}
    if full and not bad:
        try:
            same = MANIFEST.read_text() == manifest_text(fresh_manifest)
        except OSError:
            same = False
        if not same:
            bad.append(('manifest', f'{MANIFEST.name} text differs from a fresh full build'))
    for sid, why in bad:
        print(f'  MISMATCH {sid}: {why}', file=sys.stderr)
    print(f'verify: {len(ids) - len([b for b in bad if b[0] != "manifest"])}/{len(ids)} reproducible'
          + (' (manifest identical)' if full and not bad else ''))
    return 4 if bad else 0


SHEET_GROUPS = [
    ('seating_surfaces', ('seating', 'surfaces')),
    ('kitchen_bath', ('kitchen', 'preservation')),
    ('beds_electronics_hobbies', ('beds', 'electronics', 'hobbies')),
    ('decor_light_yard', ('decor', 'outdoor', 'misc', 'lighting')),
    ('openings_items', ('doors', 'windows', 'item')),
    ('env', ('env',)),
]


def make_sheets(specs: dict) -> None:
    allt = []
    for name, cats in SHEET_GROUPS:
        tiles = [(s.id, OUT_PREVIEW / f'{s.id}.png') for s in specs.values() if s.category in cats
                 and (OUT_PREVIEW / f'{s.id}.png').exists()]
        if tiles:
            sheet.contact_sheet(tiles, OUT_PREVIEW / f'sheet_{name}.png', cols=6, title=name.replace('_', ' '))
            allt += tiles
    if allt:
        sheet.contact_sheet(allt, OUT_PREVIEW / 'sheet_all.png', cols=10, title='afterlife lease objects')


if __name__ == '__main__':
    sys.exit(main())
