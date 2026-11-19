"""Build the vehicle models (GLBs + public/assets/manifest.vehicles.json, optional Cycles preview sheet).

    blender -b --factory-startup --python tools/blender/vehicles/build_vehicles.py -- [--only veh_bike,veh_sedan]
            [--out DIR] [--preview] [--no-ao]

Uses the objects pipeline's helpers (tools/blender/common): canonical mesh order, vertex-colour AO and
common/glb.py::quantize, so a rebuild from the same sources is byte-identical.

Each vehicle is built twice: LOD0 (`<id>.glb`) and LOD1 (`<id>_lod1.glb`, for ambient traffic). All GLBs are built
and checked in a staging folder first; only when every requested model passes are they moved into place, and the
manifest is written last. A subset build (--only) never rewrites the manifest.

--out DIR writes DIR/models/vehicles/*.glb and DIR/manifest.vehicles.json instead of public/assets (for
reproducibility checks). Exit codes: 0 ok, 1 a model failed a check (nothing published), 2 bad arguments.
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
sys.path.insert(0, str(HERE.parents[1]))  # tools/blender -> common, vehicles packages

import manifest_meta as meta  # noqa: E402
from common import ao, export, glb  # noqa: E402
from common.model import Model, free_parts  # noqa: E402
from vehicles import models  # noqa: E402
from vehicles.specs import LODS, SPECS, VehicleSpec  # noqa: E402

ROOT = HERE.parents[3]
PUBLIC = ROOT / 'public' / 'assets'
SHEET_DIR = ROOT / 'docs' / 'desktop-reports' / 'img' / 'vehicles'
MANIFEST = 'manifest.vehicles.json'


def build_model(spec: VehicleSpec, lod: int, use_ao: bool) -> Model:
    export.reset_scene()
    m = Model(spec.id + LODS[lod], spec.paint)
    m.mats.paint_spec(spec.paint, roughness=0.5, coat=0.3)
    models.BUILDERS[spec.id](m, spec, lod)
    m.build()
    meta.parent_frames(m.objects[m.body])
    m.frames = meta.collect_frames()                # read from the scene, then removed: the GLB carries no frames
    m.outline = meta.outline(meta.scene_triangles())
    free_parts(m)
    if use_ao:
        ao.bake_vertex_ao(m, 'env')
    return m


def check(spec: VehicleSpec, lod: int, info: glb.GlbInfo, frames: dict) -> list[str]:
    """Problems with one exported GLB (empty = ok). Axes are glTF/three: X right-left, Y up, Z front."""
    out = []
    budget = spec.budget[lod]
    if info.tris > budget:
        out.append(f'{info.tris} triangles > budget {budget}')
    if info.tris < 0.25 * budget:
        out.append(f'{info.tris} triangles is under a quarter of the budget {budget} (placeholder?)')
    for n in spec.wheels + spec.parts:
        if n not in info.node_names:
            out.append(f'node {n} missing')
    lo, hi = info.bounds_min, info.bounds_max
    if not -0.004 <= lo[1] <= 0.004:
        out.append(f'wheels not on y = 0 (min y {lo[1]:.4f})')
    size = (hi[0] - lo[0], hi[2] - lo[2], hi[1] - lo[1])
    for label, got, want in zip(('width', 'length', 'height'), size, spec.size):
        if abs(got - want) > 0.06 * want + 0.02:
            out.append(f'{label} {got:.3f} m is not within 6% of the spec {want} m')
    limit = (1.0, 2.0) if spec.park == 'small' else (2.0, 5.0)     # a car spot is 2 x 5 tiles; small = half of one
    if size[0] > limit[0] or size[1] > limit[1]:
        out.append(f'{size[0]:.2f} x {size[1]:.2f} m does not fit a {spec.park} parking spot {limit}')
    for n in spec.wheels:
        if n not in info.node_world_pos:
            continue
        x, y, z = info.node_world_pos[n]
        if abs(y - spec.wheel_radius) > 0.004:
            out.append(f'{n}: axle height {y:.3f} != wheel radius {spec.wheel_radius}')
        front = n.split('_')[1].startswith('F')
        if (z > 0) != front:
            out.append(f'{n}: on the wrong end (z = {z:.2f}; front must be +Z)')
        if len(n) == 8 and (x > 0) != (n[-1] == 'L'):
            out.append(f'{n}: on the wrong side (x = {x:.2f}; left must be +X)')
    if 'glow' in info.node_bounds:
        glo, ghi = info.node_bounds['glow']
        if not (ghi[2] > 0 and glo[2] < 0):
            out.append('glow must hold both head lights (+Z) and tail lights (-Z)')
    if 'door' in spec.parts and 'door' in info.node_world_pos and info.node_world_pos['door'][0] <= 0:
        out.append('door must be on the left side (+X)')
    if 'Paint' not in info.materials:
        out.append('no Paint material')
    if info.json.get('images') or info.json.get('textures'):
        out.append('GLB contains images/textures')
    seats = [n for n in frames if n.startswith('seat_')]
    if len(seats) != spec.seats:
        out.append(f'{len(seats)} seat frames for {spec.seats} seats')
    for name, fr in frames.items():
        (x, y, z), kind = fr['pos'], fr['kind']
        if kind in ('seat', 'hands', 'feet') and not (lo[0] <= x <= hi[0] and lo[1] <= y <= hi[1] and lo[2] <= z <= hi[2]):
            out.append(f'frame {name} is outside the model')
        if kind == 'approach' and (lo[0] <= x <= hi[0] and lo[2] <= z <= hi[2]):
            out.append(f'frame {name} is inside the vehicle footprint')
    return out


def build_all(ids: list[str], root: Path, use_ao: bool) -> dict:
    root.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.vehicles-stage-', dir=root))
    entries, failures, staged = {}, [], []
    try:
        for vid in ids:
            spec = SPECS[vid]
            lods = []
            for lod in range(len(LODS)):
                m = build_model(spec, lod, use_ao)
                name = f'{vid}{LODS[lod]}.glb'
                path = stage / name
                export.export_glb(path, vertex_colors=use_ao)
                glb.quantize(path)
                info = glb.inspect(path, exclude_from_bounds=())
                problems = check(spec, lod, info, m.frames)
                if problems:
                    failures.append((name, problems))
                lo, hi = [round(v, 4) for v in info.bounds_min], [round(v, 4) for v in info.bounds_max]
                lods.append({'lod': lod, 'file': f'models/vehicles/{name}', 'bytes': path.stat().st_size,
                             'sha256': export.sha256(path), 'triangles': info.tris, 'budget': spec.budget[lod],
                             'bounds': {'min': lo, 'max': hi}})
                staged.append(name)
                print(f'[vehicles] {name}: {info.tris} triangles (budget {spec.budget[lod]}), '
                      f'{hi[0] - lo[0]:.2f} x {hi[2] - lo[2]:.2f} x {hi[1] - lo[1]:.2f} m'
                      + ('' if not problems else '  FAILED: ' + '; '.join(problems)))
                if lod == 0:
                    wheels = {n: [round(v, 4) for v in info.node_world_pos[n]] for n in spec.wheels if n in info.node_world_pos}
                    mats = sorted(set(info.materials))
                    outline, frames = m.outline, m.frames
                elif m.frames != frames:
                    failures.append((name, ['frames differ from LOD0']))
            b0 = lods[0]['bounds']
            entries[vid] = {
                'name': spec.name, 'park': spec.park, 'seats': spec.seats, 'paint': spec.paint,
                'size': {'width': round(b0['max'][0] - b0['min'][0], 3), 'length': round(b0['max'][2] - b0['min'][2], 3),
                         'height': round(b0['max'][1] - b0['min'][1], 3)},
                'wheelRadius': spec.wheel_radius, 'wheels': wheels, 'parts': sorted(spec.parts), 'materials': mats,
                'outline': outline,
                'frames': frames,
                'lods': lods,
            }
        if failures:
            return {'failures': failures}
        out_dir = root / 'models' / 'vehicles'
        out_dir.mkdir(parents=True, exist_ok=True)
        for name in staged:
            os.replace(stage / name, out_dir / name)
        return {'entries': entries}
    finally:
        shutil.rmtree(stage, ignore_errors=True)


def render_sheet(ids: list[str]) -> Path:
    """One row per vehicle: LOD0 from the front-left and rear-right, LOD1 from the front-left. Cycles on CPU."""
    import bpy
    import numpy as np
    from common import preview

    cell, shots = 420, ((0, 38.0), (0, 215.0), (1, 38.0))
    tmp = Path(tempfile.mkdtemp(prefix='vehicles-cells-'))
    sheet = np.zeros((len(ids) * cell, len(shots) * cell, 4), dtype=np.float32)
    for row, vid in enumerate(ids):
        spec = SPECS[vid]
        for col, (lod, az) in enumerate(shots):
            build_model(spec, lod, True)
            path = tmp / f'{vid}_{col}.png'
            w = max(2, int(round(spec.size[0] + 1)))
            d = max(2, int(round(spec.size[1] + 1)))
            preview.render_preview(path, max(w, d), max(w, d), 'env', cell, 40, az=az, el=22.0)
            img = bpy.data.images.load(str(path))
            sheet[(len(ids) - 1 - row) * cell:(len(ids) - row) * cell, col * cell:(col + 1) * cell] = \
                np.array(img.pixels[:], dtype=np.float32).reshape(cell, cell, 4)
            bpy.data.images.remove(img)
    SHEET_DIR.mkdir(parents=True, exist_ok=True)
    out = bpy.data.images.new('vehicles_sheet', len(shots) * cell, len(ids) * cell, alpha=False)
    out.pixels.foreach_set(sheet.ravel())
    target = SHEET_DIR / 'vehicles.jpg'
    scene = bpy.context.scene
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = 88
    out.save_render(str(target), scene=scene)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f'[vehicles] sheet {target} (rows: {", ".join(ids)}; columns: LOD0 front-left, LOD0 rear, LOD1 front-left)')
    return target


def main() -> int:
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser(prog='build_vehicles.py')
    ap.add_argument('--only', default='')
    ap.add_argument('--out', default=None)
    ap.add_argument('--preview', action='store_true')
    ap.add_argument('--no-ao', dest='ao', action='store_false')
    args = ap.parse_args(argv)
    # one exporter per kit (tools/blender/toolchains.json): refuse to publish with another Blender
    import pathlib as _pathlib
    sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parents[1]))
    from common import toolchain as _toolchain
    _toolchain.require('vehicles', scratch=bool(args.out))
    only = [s for s in args.only.split(',') if s]
    unknown = [s for s in only if s not in SPECS]
    if unknown:
        print(f'unknown ids: {unknown} (known: {list(SPECS)})', file=sys.stderr)
        return 2
    ids = only or list(SPECS)
    root = Path(args.out).resolve() if args.out else PUBLIC
    res = build_all(ids, root, args.ao)
    if 'failures' in res:
        for name, problems in res['failures']:
            print(f'[vehicles] FAILED {name}:\n  - ' + '\n  - '.join(problems), file=sys.stderr)
        print('[vehicles] nothing published', file=sys.stderr)
        return 1
    if not only:
        text = json.dumps({'version': 1, 'units': 'm', 'up': '+Y', 'front': '+Z', 'left': '+X',
                           'nodes': {'wheel': 'wheel_* (origin on the axle; spin about local X)', 'lights': 'glow',
                                     'door': 'door (cars; origin on the hinge line)'},
                           'recolour': 'Paint', 'vehicles': res['entries']}, indent=1) + '\n'
        tmp = root / f'.{MANIFEST}.tmp'
        tmp.write_text(text, encoding='utf-8', newline='\n')
        os.replace(tmp, root / MANIFEST)
        print(f'[vehicles] wrote {root / MANIFEST}')
    else:
        print('[vehicles] subset build: manifest not rewritten')
    if args.preview:
        render_sheet(ids)
    return 0


if __name__ == '__main__':
    sys.exit(main())
