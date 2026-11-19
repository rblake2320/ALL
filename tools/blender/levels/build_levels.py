"""Build a level art kit (GLBs + public/assets/manifest.levels.json, optional Cycles previews/contact sheets).

Usage (headless Blender python, from the project root):
    /home/user/.venvs/blender/bin/python tools/blender/levels/build_levels.py [--level graveyard] [--only a,b]
        [--preview] [--sheets] [--no-ao] [--strict] [--res 192] [--samples 12] [--verify] [--out DIR]

Same guarantees as tools/blender/objects/build_all.py (whose common/* helpers it reuses):
* reproducible: canonical bmesh order + common/glb.py::quantize -> byte-identical rebuilds (stable sha256);
* atomic publish: every GLB is built into a private staging dir next to tools/blender/out/levels; only when ALL
  requested models built (and, with --strict, validated clean) are changed GLBs os.replace'd into
  public/assets/models/levels/<level>/, the manifest last (temp file + os.replace); a lock file serialises
  publishers; a failed build leaves public/ untouched;
* --verify rebuilds into a temp dir and compares bytes + manifest entries (exit 4 on any difference);
* --out DIR writes DIR/models/levels/<level>/*.glb + DIR/manifest.levels.json instead (public/ untouched).

Manifest (THREE axes): {version, models:[{id, level, object, variant, kind, file, bytes, sha256, triangles,
size:[x,y,z], bounds:{min,max}, materials, parts, states, tags}]} sorted by (level, id). Entries of other levels
are preserved.

Exit codes: 0 ok, 1 build failure, 2 bad args, 3 --strict warnings, 4 --verify mismatch, 5 lock held.
"""
from __future__ import annotations

import argparse
import filecmp
import json
import os
import shutil
import sys
import tempfile
import time
import traceback
from pathlib import Path
from typing import Dict, Optional

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))  # tools/blender -> common, objects, levels packages

from common import publish_lock  # noqa: E402
from common import glb_semantic, toolchain  # noqa: E402
from common import export, glb, preview, sheet  # noqa: E402
from common.model import Model, free_parts  # noqa: E402
from levels import kit  # noqa: E402
from levels import validate as lvalidate  # noqa: E402
from levels import l2_specs  # noqa: E402
from levels import l2_graves, l2_water, l2_structures, l2_props, l2_items, l2_store  # noqa: E402,F401

ROOT = HERE.parents[3]
PUBLIC = ROOT / 'public' / 'assets'
OUT_PREVIEW_ROOT = ROOT / 'tools' / 'blender' / 'out' / 'levels'
MANIFEST_VERSION = 1
LEVELS = {'graveyard': l2_specs}


class Paths:
    def __init__(self, level: str, out: Optional[Path]):
        base = out if out is not None else PUBLIC
        self.glb_dir = base / 'models' / 'levels' / level
        self.manifest = base / 'manifest.levels.json'
        self.preview = (out / 'previews' / level) if out is not None else OUT_PREVIEW_ROOT / level
        self.stage_parent = out if out is not None else OUT_PREVIEW_ROOT
        self.level = level


def preview_kind(spec: kit.LevelSpec) -> str:
    return {'wall': 'wall', 'item': 'item', 'env': 'env', 'opening': 'door', 'carry': 'item',
            'edge': 'floor'}.get(spec.kind, 'floor')


def build_one(spec: kit.LevelSpec, level: str, args, out_dir: Path, preview_dir: Optional[Path]) -> dict:
    export.reset_scene()
    m = Model(spec.id, spec.paint)
    if spec.paint:
        m.mats.paint_spec(spec.paint, roughness=0.6)
    kit.BUILDERS[spec.id](m, spec)
    if spec.kind in ('floor', 'item', 'edge', 'opening', 'env'):
        for n in m.nodes.values():  # crooked/leaning parts must never poke through the floor
            for bm, _ in n.parts:
                for v in bm.verts:
                    if v.co.z < 0.0:
                        v.co.z = 0.0
    m.build()
    free_parts(m)
    if args.ao:
        from common import ao
        ao.bake_vertex_ao(m, preview_kind(spec) if spec.kind != 'carry' else 'door')
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f'{spec.id}.glb'
    tmp = out_dir / f'.{spec.id}.tmp.glb'
    export.export_glb(tmp, vertex_colors=args.ao)
    glb.quantize(tmp)
    os.replace(tmp, path)
    info = glb.inspect(path, exclude_from_bounds=('broken',) + tuple(spec.states))
    warnings = lvalidate.check(spec, info, path)
    lo = [round(v, 4) for v in info.bounds_min]
    hi = [round(v, 4) for v in info.bounds_max]
    entry = {
        'id': spec.id,
        'level': level,
        'object': spec.obj,
        'variant': spec.variant,
        'kind': spec.kind,
        'file': f'models/levels/{level}/{spec.id}.glb',
        'bytes': path.stat().st_size,
        'sha256': export.sha256(path),
        'triangles': info.tris,
        'size': [round(hi[k] - lo[k], 4) for k in range(3)],
        'bounds': {'min': lo, 'max': hi},
        'materials': sorted(set(info.materials)),
        'footprint': [spec.w, spec.d],
        'budget': spec.budget,
        'front': spec.front,
        'wallCentre': spec.wall_centre,
        'parts': sorted(spec.parts),
        'states': sorted(spec.states),
        'tags': list(spec.tags),
    }
    if preview_dir is not None and spec.kind in ('item', 'carry'):
        # preview only (the GLB is already written): blow tiny items up so they fill the frame, stand carry props
        # on the floor
        import bpy
        ext = max(hi[k] - lo[k] for k in range(3))
        k = min(8.0, max(1.0, 0.35 / max(ext, 1e-3)))
        for o in bpy.context.scene.objects:
            if o.parent is None:
                o.scale = o.scale * k
                o.location = o.location * k
                if spec.kind == 'carry':
                    o.location.z -= lo[1] * k
    if preview_dir is not None:
        w, d = (int(round(spec.w)), int(round(spec.d))) if spec.kind != 'env' else (5, 5)
        preview.render_preview(preview_dir / f'{spec.id}.png', max(1, w), max(1, d), preview_kind(spec), args.res,
                               args.samples, hide=tuple(spec.states) + ('broken',))
        if spec.states:
            # second capture with every state overlay visible (re-import the GLB into a clean scene)
            export.reset_scene()
            with export.quiet():
                import bpy
                bpy.ops.import_scene.gltf(filepath=str(path))
            preview.render_preview(preview_dir / f'{spec.id}__states.png', max(1, w), max(1, d),
                                   preview_kind(spec), args.res, args.samples)
    return {'entry': entry, 'warnings': warnings}


def manifest_text(models: list) -> str:
    ms = sorted(models, key=lambda e: (e['level'], e['id']))
    return json.dumps({'version': MANIFEST_VERSION, 'models': ms}, indent=1) + '\n'


def _read_json(path: Path) -> Optional[dict]:
    try:
        v = json.loads(path.read_text())
        return v if isinstance(v, dict) else None
    except (OSError, ValueError):
        return None


def _write_text_atomic(path: Path, text: str) -> bool:
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


def _replace_file(src: Path, dst: Path) -> None:
    try:
        os.replace(src, dst)
    except OSError:
        tmp = dst.with_name(f'.{dst.name}.publish.tmp')
        shutil.copyfile(src, tmp)
        os.replace(tmp, dst)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--level', default='graveyard', choices=sorted(LEVELS))
    ap.add_argument('--only', default='')
    ap.add_argument('--preview', action='store_true')
    ap.add_argument('--sheets', action='store_true')
    ap.add_argument('--no-ao', dest='ao', action='store_false')
    ap.set_defaults(ao=True)
    ap.add_argument('--strict', action='store_true')
    ap.add_argument('--res', type=int, default=192)
    ap.add_argument('--samples', type=int, default=12)
    ap.add_argument('--verify', action='store_true')
    ap.add_argument('--out', default=None)
    if argv is None:
        argv = sys.argv[1:]
        if '--' in argv:
            argv = argv[argv.index('--') + 1:]
    args = ap.parse_args(argv)
    mod = LEVELS[args.level]
    specs = mod.specs()
    only = [s for s in args.only.split(',') if s]
    unknown = [s for s in only if s not in specs]
    if unknown:
        print(f'unknown ids: {unknown}', file=sys.stderr)
        return 2
    ids = only or list(specs)
    missing = [i for i in ids if i not in kit.BUILDERS]
    if missing:
        print(f'NO BUILDER for: {missing}', file=sys.stderr)
        return 1
    p = Paths(args.level, Path(args.out).resolve() if args.out else None)
    if args.verify or not args.out:   # a scratch build (--out) may use any Blender; publishing and verifying may not
        wrong = toolchain.check(f'levels/{args.level}')
        if wrong:
            print(wrong, file=sys.stderr)
            return 2
    if args.verify:
        return verify(specs, ids, args, p)
    if args.sheets and not args.preview and not only:
        make_sheets(specs, p)
        return 0
    try:
        lock = publish_lock.acquire(OUT_PREVIEW_ROOT / '.build.lock')
    except BlockingIOError:
        print('another build_levels.py is publishing; try again later', file=sys.stderr)
        return 5
    try:
        return _build_and_publish(specs, ids, args, p)
    finally:
        lock.close()


def _build_and_publish(specs, ids, args, p: Paths) -> int:
    old = _read_json(p.manifest) or {}
    keep = [e for e in (old.get('models') or []) if isinstance(e, dict)
            and not (e.get('level') == p.level and e.get('id') not in specs)]
    by_id = {(e.get('level'), e.get('id')): e for e in keep}
    p.stage_parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.stage-', dir=p.stage_parent))
    report_path = p.preview / 'report.json'
    report = {k: v for k, v in (_read_json(report_path) or {}).items() if k in specs}
    failures, staged = [], {}
    t0 = time.time()
    rc = 0
    try:
        for i, sid in enumerate(ids):
            t = time.time()
            try:
                res = build_one(specs[sid], p.level, args, stage, p.preview if args.preview else None)
            except Exception:
                traceback.print_exc()
                failures.append(sid)
                continue
            staged[sid] = stage / f'{sid}.glb'
            by_id[(p.level, sid)] = res['entry']
            report[sid] = {'triangles': res['entry']['triangles'], 'bytes': res['entry']['bytes'],
                           'warnings': res['warnings']}
            flag = ' !' if res['warnings'] else ''
            print(f'[{i + 1:2d}/{len(ids)}] {sid:24s} {res["entry"]["triangles"]:6d} tris '
                  f'{res["entry"]["bytes"] / 1024:7.1f} KB {time.time() - t:5.1f}s{flag}', flush=True)
            for w in res['warnings']:
                print(f'      - {w}', flush=True)
        _write_text_atomic(report_path, json.dumps(dict(sorted(report.items())), indent=1) + '\n')
        warned = [s for s in ids if report.get(s, {}).get('warnings')]
        if failures:
            print(f'FAILED: {failures} -- nothing published', file=sys.stderr)
            rc = 1
        elif args.strict and warned:
            print(f'--strict: validation warnings for {warned} -- nothing published', file=sys.stderr)
            rc = 3
        else:
            p.glb_dir.mkdir(parents=True, exist_ok=True)
            replaced = unchanged = 0
            for sid, src in staged.items():
                dst = p.glb_dir / f'{sid}.glb'
                if dst.exists() and filecmp.cmp(src, dst, shallow=False):
                    unchanged += 1
                    continue
                _replace_file(src, dst)
                replaced += 1
            # level entries whose id is gone are dropped; stale GLBs pruned only after the manifest is in place
            models = [e for (lv, i), e in by_id.items() if lv != p.level or i in specs]
            changed = _write_text_atomic(p.manifest, manifest_text(models))
            pruned = 0
            for f in sorted(p.glb_dir.iterdir()):
                if f.is_file() and f.suffix == '.glb' and (f.name.startswith('.') or f.stem not in specs):
                    f.unlink()
                    pruned += 1
            total = sum(e['bytes'] for e in models if e['level'] == p.level)
            print(f'built {len(ids)} in {time.time() - t0:.1f}s; published {replaced} changed, {unchanged} unchanged, '
                  f'{pruned} pruned, manifest {"updated" if changed else "unchanged"}; '
                  f'{p.level}: {sum(1 for e in models if e["level"] == p.level)} models, {total / 1024:.1f} KiB')
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    if rc == 0 and (args.preview or args.sheets):
        make_sheets(specs, p)
    return rc


def verify(specs, ids, args, p: Paths) -> int:
    committed = {e['id']: e for e in ((_read_json(p.manifest) or {}).get('models') or [])
                 if isinstance(e, dict) and e.get('level') == p.level}
    bad = []
    kit_dir = f'levels/{p.level}'
    exact = toolchain.canonical(kit_dir)   # elsewhere Blender's last float bits differ: compare by content
    with tempfile.TemporaryDirectory(prefix='al-lv-verify-') as td:
        out = Path(td)
        for sid in ids:
            try:
                res = build_one(specs[sid], p.level, args, out, None)
            except Exception:
                traceback.print_exc()
                bad.append((sid, 'build failed'))
                continue
            fresh = (out / f'{sid}.glb').read_bytes()
            ref_path = p.glb_dir / f'{sid}.glb'
            ref = ref_path.read_bytes() if ref_path.exists() else b''
            if not exact:
                delta = glb_semantic.diff(str(ref_path), str(out / f'{sid}.glb')) if ref else ['no published file']
                if delta:
                    bad.append((sid, 'content differs: ' + '; '.join(delta[:3])))
                else:
                    print(f'  ok {sid} (content)', flush=True)
            elif fresh != ref:
                bad.append((sid, f'bytes differ ({len(fresh)} vs {len(ref)})'))
            elif committed.get(sid) != res['entry']:
                bad.append((sid, 'manifest entry is stale'))
            else:
                print(f'  ok {sid} {res["entry"]["sha256"][:12]}', flush=True)
    if set(ids) == set(specs):
        extra = sorted(set(committed) - set(specs))
        if extra:
            bad.append(('manifest', f'entries without a spec: {extra}'))
    for sid, why in bad:
        print(f'  MISMATCH {sid}: {why}', file=sys.stderr)
    good = len(ids) - len([b for b in bad if b[0] != "manifest"])
    if exact:
        print(f'verify: {good}/{len(ids)} reproducible')
    else:
        print(f'verify: cross-platform: semantic match {good}/{len(ids)} (this is {toolchain.this_platform()}; '
              f'{kit_dir} is byte-identical on {toolchain.pin(kit_dir)["platform"]} only)')
    return 4 if bad else 0


SHEET_GROUPS = [
    ('graves', ('graves',)),
    ('water_nature', ('water', 'nature')),
    ('structures', ('structures',)),
    ('props', ('props',)),
    ('items_curios_fish', ('items', 'curios', 'fish')),
    ('env_events_store', ('env', 'events', 'store')),
]


def make_sheets(specs, p: Paths) -> None:
    allt = []
    for name, cats in SHEET_GROUPS:
        tiles = []
        for s in specs.values():
            if s.category not in cats:
                continue
            for suffix, label in (('', s.id), ('__states', s.id + ' +states')):
                f = p.preview / f'{s.id}{suffix}.png'
                if f.exists():
                    tiles.append((label, f))
        if tiles:
            sheet.contact_sheet(tiles, p.preview / f'sheet_{name}.png', cols=6, title=f'{p.level} {name}')
            allt += [t for t in tiles if not t[0].endswith('+states')]
    if allt:
        sheet.contact_sheet(allt, p.preview / 'sheet_all.png', cols=10, title=f'afterlife lease level kit {p.level}')


if __name__ == '__main__':
    sys.exit(main())
