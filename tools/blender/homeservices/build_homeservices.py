"""Build the home service models (Hearth, Wardrobe Coffin, Crypt Vault, Bone Workbench, Bone Gate) as GLBs.

    blender -b --factory-startup --python-exit-code 1 --python tools/blender/homeservices/build_homeservices.py -- \
        [--only ID,ID] [--no-ao] [--verify] [--preview] [--out DIR]

A SMALL OWN KIT: the GLBs go to public/assets/models/objects/homeservices/ (toolchains.json key "objects/homeservices":
Blender 5.2.3 on Windows), and their entries are merged into public/assets/manifest.objects.json, the one manifest the
object model library reads (entry paths are "models/objects/homeservices/<id>.glb"). The existing objects kit (Linux pin,
tools/blender/objects) is not touched: this driver reuses its builder registry, validation and publish helpers, and a full
rebuild of that kit leaves these entries and files alone (it keeps manifest entries of catalog ids and prunes only
top-level files).

--verify rebuilds into a temp dir and compares every GLB byte for byte with the committed file and the manifest entries.
--out DIR writes DIR/models/objects/homeservices/*.glb and DIR/manifest.objects.json instead of public/assets (scratch).
Exit codes: 0 ok, 1 a model failed to build, 2 bad arguments or wrong Blender, 3 validation warnings with --strict,
4 --verify mismatch.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
import traceback
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))  # tools/blender -> `common`, `objects`, `homeservices`

from common import catalog, toolchain  # noqa: E402
from objects import build_all as B  # noqa: E402  (its helpers: build_one, publish, manifest_text)
from objects import registry  # noqa: E402
from homeservices import models  # noqa: E402,F401  (import registers the builders)

KIT = 'objects/homeservices'
IDS = ['hearth_stone', 'wardrobe_coffin', 'vault_crypt', 'workbench_bone', 'gate_bone']
ROOT = HERE.parents[3]
GLB_DIR = ROOT / 'public' / 'assets' / 'models' / 'objects' / 'homeservices'
MANIFEST = ROOT / 'public' / 'assets' / 'manifest.objects.json'


def _build(specs: dict, ids: list, args: argparse.Namespace, stage: Path):
    entries, warnings = {}, {}
    for i, sid in enumerate(ids):
        res = B.build_one(specs[sid], args, stage)
        res['entry']['file'] = f'models/objects/homeservices/{sid}.glb'
        entries[sid] = res['entry']
        warnings[sid] = res['warnings']
        flag = ' !' if res['warnings'] else ''
        print(f'[{i + 1}/{len(ids)}] {sid:18s} {res["entry"]["tris"]:5d} tris {res["entry"]["bytes"] / 1024:6.1f} KB{flag}')
        for w in res['warnings']:
            print(f'      - {w}')
    return entries, warnings


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--no-ao', dest='ao', action='store_false')
    ap.set_defaults(ao=True)
    ap.add_argument('--strict', action='store_true')
    ap.add_argument('--preview', action='store_true')
    ap.add_argument('--res', type=int, default=192)
    ap.add_argument('--samples', type=int, default=12)
    ap.add_argument('--verify', action='store_true')
    ap.add_argument('--out', default=None, metavar='DIR')
    if argv is None:
        argv = sys.argv[1:]
        if '--' in argv:
            argv = argv[argv.index('--') + 1:]
    args = ap.parse_args(argv)
    toolchain.require(KIT, scratch=bool(args.out) and not args.verify)

    specs = catalog.all_specs()
    only = [s for s in args.only.split(',') if s]
    unknown = [s for s in only + IDS if s not in specs or s not in registry.BUILDERS]
    if unknown:
        print(f'unknown ids or ids with no catalog spec: {unknown}', file=sys.stderr)
        return 2
    ids = only or IDS

    glb_dir, manifest_path = GLB_DIR, MANIFEST
    if args.out:
        out = Path(args.out).resolve()
        glb_dir, manifest_path = out / 'models' / 'objects' / 'homeservices', out / 'manifest.objects.json'
        B.OUT_PREVIEW = out / 'previews'
    else:
        B.OUT_PREVIEW = ROOT / 'tools' / 'blender' / 'out' / 'homeservices'
    stage = Path(tempfile.mkdtemp(prefix='.stage-hs-'))
    try:
        try:
            entries, warnings = _build(specs, ids, args, stage)
        except Exception:
            traceback.print_exc()
            return 1
        if args.verify:
            bad = []
            committed = json.loads(MANIFEST.read_text(encoding='utf-8')).get('objects', {})
            for sid in ids:
                dst = GLB_DIR / f'{sid}.glb'
                if not dst.exists():
                    bad.append((sid, 'no committed file'))
                elif dst.read_bytes() != (stage / f'{sid}.glb').read_bytes():
                    bad.append((sid, 'GLB bytes differ'))
                if committed.get(sid) != entries[sid]:
                    bad.append((sid, 'manifest entry differs'))
            for sid, why in bad:
                print(f'VERIFY {sid}: {why}', file=sys.stderr)
            print(f'verify: {len(ids) - len({s for s, _ in bad})}/{len(ids)} reproducible')
            return 4 if bad else 0
        if args.strict and any(warnings.values()):
            print('--strict: validation warnings -- nothing published', file=sys.stderr)
            return 3
        # publish: GLBs into the kit folder, then the merged manifest (all other entries kept as they are)
        old = {}
        if manifest_path.exists():
            old = json.loads(manifest_path.read_text(encoding='utf-8'))
        elif args.out and MANIFEST.exists():
            old = json.loads(MANIFEST.read_text(encoding='utf-8'))
        manifest = {'version': old.get('version', B.MANIFEST_VERSION), 'objects': dict(old.get('objects', {}))}
        manifest['objects'].update(entries)
        B.OUT_GLB, B.MANIFEST = glb_dir, manifest_path
        st = B.publish({sid: stage / f'{sid}.glb' for sid in ids}, manifest, prune_to=None)
        print(f'published {st["replaced"]} changed, {st["unchanged"]} unchanged, manifest {"updated" if st["manifest"] else "unchanged"}')
        return 0
    finally:
        shutil.rmtree(stage, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
