"""Build the home exterior shells (W-049).

    blender -b --factory-startup --python-exit-code 1 --python tools/blender/homes/build_homes.py --
            [--only id1,id2] [--out DIR] [--preview] [--no-ao]

Outputs
  public/assets/models/homes/<id>.glb and <id>_lod1.glb
  public/assets/manifest.homes.json     per shell: home class, lot, tile footprint, lot rectangle, both levels of detail,
                                        bounds, floor outline and frames (D-043: approach, porch, mailbox)

A shell is built with the kit's named looks, ambient occlusion is baked per vertex, and then every opaque surface
is folded into ONE white material, `Shell`, whose colour lives in the vertex colours (look colour x occlusion).
Window panes keep their own material, `Glass`. So a shell has two materials and one mesh node.

Rules the build enforces (nothing is published if any shell breaks one): triangle budgets; one node, no interior
or room nodes; at most three materials, no textures; base on y = 0; inside the house's wall rectangle plus the
allowed reach for eaves, porches and steps; height in the expected range; LOD1 within 0.4 m of LOD0's bounds.
Exit codes: 0 ok, 1 a shell failed a check, 2 bad arguments, 5 another build holds the lock.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))  # tools/blender -> common, homes, manifest_meta

import bpy  # noqa: E402

import manifest_meta as meta  # noqa: E402
from common import ao, export, glb  # noqa: E402
from common.model import Model, free_parts  # noqa: E402
from homes import shells  # noqa: E402
from homes.specs import BUDGET, SPECS, ShellSpec  # noqa: E402

ROOT = HERE.parents[3]
PUBLIC = ROOT / 'public' / 'assets'
OUT = ROOT / 'tools' / 'blender' / 'out' / 'homes'
SHEET_DIR = ROOT / 'docs' / 'desktop-reports' / 'img' / 'homes'
MANIFEST = 'manifest.homes.json'
GLASS_LOOKS = ('WindowDark',)
LODS = ('', '_lod1')


def acquire_lock():
    OUT.mkdir(parents=True, exist_ok=True)
    f = open(OUT / '.build.lock', 'a+')
    try:
        if os.name == 'nt':
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


def fold_materials(m: Model) -> None:
    """Fold every opaque look into one white `Shell` material: the look's colour is multiplied into the vertex
    colours (which already hold the baked occlusion). Panes become `Glass`."""
    shell = bpy.data.materials.new('Shell')
    shell.use_nodes = True
    bsdf = shell.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (1.0, 1.0, 1.0, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.85
    bsdf.inputs['Metallic'].default_value = 0.0
    shell.diffuse_color = (1.0, 1.0, 1.0, 1.0)
    glass = None
    for ob in m.objects.values():
        if ob.type != 'MESH':
            continue
        me = ob.data
        attr = me.color_attributes.active_color or me.color_attributes.new('AO', 'FLOAT_COLOR', 'CORNER')
        if attr.domain != 'CORNER':
            raise RuntimeError(f'{ob.name}: vertex colours are not per corner')
        tints, slots = [], []
        for mat in me.materials:
            base = mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value
            if mat.name in GLASS_LOOKS:
                if glass is None:
                    glass = mat
                    glass.name = 'Glass'
                slots.append(1)
                tints.append((1.0, 1.0, 1.0))
            else:
                slots.append(0)
                tints.append((base[0], base[1], base[2]))
        for poly in me.polygons:
            tr, tg, tb = tints[poly.material_index]
            for li in poly.loop_indices:
                c = attr.data[li].color
                attr.data[li].color = (c[0] * tr, c[1] * tg, c[2] * tb, 1.0)
        new_index = [slots[p.material_index] for p in me.polygons]
        me.materials.clear()
        me.materials.append(shell)
        if glass is not None:
            me.materials.append(glass)
        for p, i in zip(me.polygons, new_index):
            p.material_index = i if glass is not None else 0


def build_model(spec: ShellSpec, lod: int, use_ao: bool):
    export.reset_scene()
    m = Model(spec.id + LODS[lod])
    h = shells.House(m, spec, lod)
    shells.BUILDERS[spec.style](h)
    # D-043 frames, from the shell itself: where a visitor stands at the door, the spot on the porch, the mailbox
    x = spec.doors[0]
    ax = h.stair_x if h.stair_x is not None else x
    front = h.fy - h.porch_depth - h.reach
    meta.add_frame('approach', (ax, front - 0.6, 0.0), 180.0, 'approach')
    meta.add_frame('porch', (x, h.fy - max(0.45, h.porch_depth * 0.5), h.floor_z), 0.0, 'feet')
    meta.add_frame('mailbox', (ax + 1.5, front - 0.9, 0.0), 0.0, 'attach')         # beside the path, still inside the yard
    m.build()
    meta.parent_frames(m.objects[m.body])
    frames = meta.collect_frames()
    outline = meta.outline(meta.scene_triangles())
    free_parts(m)
    if use_ao:
        ao.bake_vertex_ao(m, 'env')
    fold_materials(m)
    return m, frames, outline


def check(spec: ShellSpec, lod: int, info: glb.GlbInfo) -> list[str]:
    out = []
    if info.tris > BUDGET[lod]:
        out.append(f'{info.tris} triangles > budget {BUDGET[lod]}')
    if info.tris < BUDGET[lod] // 12:
        out.append(f'{info.tris} triangles (a placeholder?)')
    nodes = [n for n in info.node_names if n]
    if nodes != [spec.id + LODS[lod]]:
        out.append(f'nodes {nodes}: a shell is one node, with no interior or room nodes')
    mats = sorted(set(info.materials))
    if len(mats) > 3 or 'Shell' not in mats:
        out.append(f'materials {mats}: at most three, one of them Shell')
    if info.json.get('images') or info.json.get('textures'):
        out.append('GLB contains images/textures')
    lo, hi = info.bounds_min, info.bounds_max
    if not -0.002 <= lo[1] <= 0.004:
        out.append(f'base not on y = 0 (min y {lo[1]:.4f})')
    side, back, front = spec.reach
    if max(-lo[0], hi[0]) > spec.w / 2 + side:
        out.append(f'x {lo[0]:.2f}..{hi[0]:.2f} is wider than the {spec.w}-tile house plus {side} m')
    if -lo[2] > spec.d / 2 + back:
        out.append(f'the back reaches {-lo[2]:.2f} m, more than {spec.d / 2 + back:.2f}')
    if hi[2] > spec.d / 2 + front:
        out.append(f'the front reaches {hi[2]:.2f} m, more than {spec.d / 2 + front:.2f}')
    if max(-lo[0], hi[0]) < spec.w / 2 - 0.05 or hi[2] < spec.d / 2 - 0.05 or -lo[2] < spec.d / 2 - 1.2:
        out.append(f'the shell does not cover its {spec.w} x {spec.d} wall rectangle')
    if not spec.height[0] <= hi[1] <= spec.height[1]:
        out.append(f'height {hi[1]:.2f} m is outside {spec.height}')
    return out


def build_all(ids: list[str], root: Path, use_ao: bool) -> dict:
    root.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.homes-stage-', dir=root))
    entries, failures, staged = {}, [], []
    try:
        for sid in ids:
            spec = SPECS[sid]
            lods, keep = [], {}
            for lod in range(len(LODS)):
                m, frames, outline = build_model(spec, lod, use_ao)
                name = f'{sid}{LODS[lod]}.glb'
                path = stage / name
                export.export_glb(path, vertex_colors=True)
                glb.quantize(path)
                info = glb.inspect(path, exclude_from_bounds=())
                problems = check(spec, lod, info)
                lo, hi = [round(v, 4) for v in info.bounds_min], [round(v, 4) for v in info.bounds_max]
                if lod == 0:
                    keep = {'frames': frames, 'outline': outline, 'lo': lo, 'hi': hi, 'materials': sorted(set(info.materials))}
                    for fname, f in frames.items():
                        inside = lo[0] <= f['pos'][0] <= hi[0] and lo[2] <= f['pos'][2] <= hi[2]
                        if fname in ('approach', 'mailbox') and inside:
                            problems.append(f'frame {fname} is inside the shell')
                        if fname == 'porch' and not inside:
                            problems.append('frame porch is not on the shell')
                else:
                    drift = max(abs(a - b) for a, b in zip(lo + hi, keep['lo'] + keep['hi']))
                    if drift > 0.4:
                        problems.append(f'LOD1 bounds differ from LOD0 by {drift:.2f} m')
                    if frames != keep['frames']:
                        problems.append('LOD1 frames differ from LOD0')
                    if info.tris >= lods[0]['triangles']:
                        problems.append('LOD1 is not lighter than LOD0')
                if problems:
                    failures.append((name, problems))
                lods.append({'lod': lod, 'file': f'models/homes/{name}', 'bytes': path.stat().st_size, 'sha256': export.sha256(path),
                             'triangles': info.tris, 'budget': BUDGET[lod], 'bounds': {'min': lo, 'max': hi}})
                staged.append(name)
                print(f'[homes] {name}: {info.tris} triangles (budget {BUDGET[lod]}), '
                      f'{hi[0] - lo[0]:.1f} x {hi[2] - lo[2]:.1f} x {hi[1]:.1f} m' + ('' if not problems else '  FAILED: ' + '; '.join(problems)))
            entries[sid] = {
                'name': spec.name, 'level': spec.level, 'homeClass': spec.home_class, 'lot': spec.lot, 'template': spec.template,
                'tileFootprint': {'w': spec.w, 'd': spec.d}, 'doors': [{'x': x, 'z': spec.d / 2} for x in spec.doors],
                'lotRect': {'x0': spec.lot_at[0], 'z0': spec.lot_at[1], 'w': spec.w, 'd': spec.d},
                'bounds': {'min': keep['lo'], 'max': keep['hi']},
                'sizeM': {'width': round(keep['hi'][0] - keep['lo'][0], 2), 'depth': round(keep['hi'][2] - keep['lo'][2], 2),
                          'height': round(keep['hi'][1], 2)},
                'materials': keep['materials'], 'interior': False,
                'outline': keep['outline'], 'frames': keep['frames'], 'lods': lods,
            }
        if failures:
            return {'failures': failures}
        out_dir = root / 'models' / 'homes'
        out_dir.mkdir(parents=True, exist_ok=True)
        for name in staged:
            os.replace(stage / name, out_dir / name)
        return {'entries': entries}
    finally:
        shutil.rmtree(stage, ignore_errors=True)


def render_sheet(ids: list[str]) -> Path:
    import numpy as np
    from common import preview

    cell, cols = 420, 4
    rows = (len(ids) + cols - 1) // cols
    tmp = Path(tempfile.mkdtemp(prefix='homes-cells-'))
    sheet = np.zeros((rows * cell, cols * cell, 4), dtype=np.float32)
    sheet[..., :3], sheet[..., 3] = 0.5, 1.0
    for i, sid in enumerate(ids):
        m, _, _ = build_model(SPECS[sid], 0, True)
        png = tmp / f'{sid}.png'
        preview.render_preview(png, SPECS[sid].w, SPECS[sid].d, kind='env', res=cell, samples=24)
        img = bpy.data.images.load(str(png))
        r, c = i // cols, i % cols
        sheet[(rows - 1 - r) * cell:(rows - r) * cell, c * cell:(c + 1) * cell] = \
            np.array(img.pixels[:], dtype=np.float32).reshape(cell, cell, 4)
        bpy.data.images.remove(img)
    SHEET_DIR.mkdir(parents=True, exist_ok=True)
    out = bpy.data.images.new('homes_sheet', cols * cell, rows * cell, alpha=False)
    out.pixels.foreach_set(sheet.ravel())
    target = SHEET_DIR / 'shells.jpg'
    scene = bpy.context.scene
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = 88
    out.save_render(str(target), scene=scene)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f'[homes] sheet {target} (row order: {", ".join(ids)})')
    return target


def main() -> int:
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser(prog='build_homes.py')
    ap.add_argument('--only', default='')
    ap.add_argument('--out', default=None)
    ap.add_argument('--preview', action='store_true')
    ap.add_argument('--no-ao', dest='ao', action='store_false')
    args = ap.parse_args(argv)
    # one exporter per kit (tools/blender/toolchains.json): refuse to publish with another Blender
    import pathlib as _pathlib
    sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parents[1]))
    from common import toolchain as _toolchain
    _toolchain.require('homes', scratch=bool(args.out))
    only = [s for s in args.only.split(',') if s]
    unknown = [s for s in only if s not in SPECS]
    if unknown:
        print(f'unknown ids: {unknown} (known: {list(SPECS)})', file=sys.stderr)
        return 2
    ids = only or list(SPECS)
    root = Path(args.out).resolve() if args.out else PUBLIC
    try:
        lock = acquire_lock()
    except BlockingIOError:
        print('another build_homes.py is publishing; try again later', file=sys.stderr)
        return 5
    try:
        res = build_all(ids, root, args.ao)
        if 'failures' in res:
            for name, problems in res['failures']:
                print(f'[homes] FAILED {name}: ' + '; '.join(problems), file=sys.stderr)
            print('[homes] nothing published', file=sys.stderr)
            return 1
        if not only:
            text = json.dumps({'version': 1, 'units': 'm', 'up': '+Y', 'front': '+Z', 'budget': {'lod0': BUDGET[0], 'lod1': BUDGET[1]},
                               'materials': {'Shell': 'white; colour is in the vertex colours', 'Glass': 'window panes'},
                               'shells': res['entries']}, indent=1) + '\n'
            tmp = root / f'.{MANIFEST}.tmp'
            tmp.write_text(text, encoding='utf-8', newline='\n')
            os.replace(tmp, root / MANIFEST)
            print(f'[homes] wrote {root / MANIFEST}')
        else:
            print('[homes] subset build: manifest not rewritten')
        if args.preview:
            render_sheet(ids)
        return 0
    finally:
        lock.close()


if __name__ == '__main__':
    sys.exit(main())
