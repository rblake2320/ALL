"""Build the structures kit (parking objects + Quick Build stairs, ramps and pillars) as GLBs with
public/assets/manifest.structures.json and an optional Cycles preview sheet.

    blender -b --factory-startup --python tools/blender/structures/build_structures.py -- [--only id1,id2]
            [--out DIR] [--preview] [--no-ao]

Same guarantees as tools/blender/vehicles/build_vehicles.py: common/* helpers, byte-identical rebuilds, every GLB
built and checked in a staging folder before anything is moved into place, manifest written last, and a subset
build (--only) never rewrites the manifest. Exit codes: 0 ok, 1 a model failed a check, 2 bad arguments.
"""
from __future__ import annotations

import argparse
import dataclasses
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))

import manifest_meta as meta  # noqa: E402
from common import ao, export, glb  # noqa: E402
from common.model import Model, free_parts  # noqa: E402
from structures import models  # noqa: E402
from structures.specs import CURB_SET_BUDGET, FENCE_MAX_HEIGHT, SPECS, StructSpec  # noqa: E402

ROOT = HERE.parents[3]
PUBLIC = ROOT / 'public' / 'assets'
SHEET_DIR = ROOT / 'docs' / 'desktop-reports' / 'img' / 'structures'
MANIFEST = 'manifest.structures.json'


def build_model(spec: StructSpec, use_ao: bool, lod: int = 0) -> Model:
    models.LOD = lod
    export.reset_scene()
    m = Model(spec.id)
    models.BUILDERS[spec.id](m, spec)
    for n in m.nodes.values():            # crooked parts must never poke through the floor
        for bm, _ in n.parts:
            for v in bm.verts:
                if v.co.z < 0.0:
                    v.co.z = 0.0
    m.build()
    meta.parent_frames(m.objects[m.body])
    m.frames = meta.collect_frames()
    m.outline = meta.outline(meta.scene_triangles())
    free_parts(m)
    if use_ao:
        ao.bake_vertex_ao(m, 'door' if spec.kind == 'opening' else 'floor')
    return m


def check(spec: StructSpec, info: glb.GlbInfo) -> list[str]:
    """Problems with one exported GLB (empty = ok). Axes are glTF/three: X across, Y up, Z along the run."""
    out = []
    if info.tris > spec.budget:
        out.append(f'{info.tris} triangles > budget {spec.budget}')
    if info.tris < 20:
        out.append(f'{info.tris} triangles (empty?)')
    for n in spec.parts:
        if n not in info.node_names:
            out.append(f'node {n} missing')
    lo, hi = info.bounds_min, info.bounds_max
    if not -0.002 <= lo[1] <= 0.004:
        out.append(f'base not on y = 0 (min y {lo[1]:.4f})')
    if spec.rise is not None and max(abs(lo[0]), abs(hi[0])) > spec.w / 2 - 0.025:
        out.append(f'rails reach {max(abs(lo[0]), abs(hi[0])):.3f} m from the centre: two pieces side by side need a 5 cm gap '
                   f'(<= {spec.w / 2 - 0.025:.3f})')
    if spec.kind != 'opening':
        if hi[0] - lo[0] > spec.w + 0.04 or max(abs(lo[0]), abs(hi[0])) > spec.w / 2 + 0.03:
            out.append(f'width {lo[0]:.2f}..{hi[0]:.2f} does not fit {spec.w} tile(s) centred on the origin')
        if hi[2] - lo[2] > spec.d + 0.04 or max(abs(lo[2]), abs(hi[2])) > spec.d / 2 + 0.03:
            out.append(f'depth {lo[2]:.2f}..{hi[2]:.2f} does not fit {spec.d} tile(s) centred on the origin')
    if spec.rise is not None:
        v = info.vertices
        if v is None:
            out.append('no vertex data to check the walking surface')
        else:
            # the walking surface must start on the floor at -Z and reach the next storey at +Z
            # (rails and parapets sit within 7.5 cm of the sides and are left out)
            mid = abs(v[:, 0]) < spec.w / 2 - 0.075           # rails and parapets sit outside this
            near_top = v[(v[:, 2] > spec.d / 2 - 0.30) & mid]
            # stairs: the lowest tread; ramps: the deck starts on the floor, so every vertex counts
            floor_cut = 0.05 if spec.kind != 'ramp' else -1.0
            near_bottom = v[(v[:, 2] < -spec.d / 2 + 0.30) & mid & (v[:, 1] > floor_cut)]
            top = float(near_top[:, 1].max()) if len(near_top) else -1.0
            first = float(near_bottom[:, 1].min()) if len(near_bottom) else 9.0
            if abs(top - spec.rise) > 0.03:
                out.append(f'top of the run is at {top:.3f} m, not the storey height {spec.rise}')
            if first > 0.26:
                out.append(f'lowest step is {first:.3f} m high (must be reachable from the floor)')
    if spec.kind in ('fence', 'fencePost', 'gate'):
        if hi[1] > FENCE_MAX_HEIGHT:
            out.append(f'{hi[1]:.3f} m tall: a yard fence stays at or under {FENCE_MAX_HEIGHT} m')
        if spec.kind in ('fence', 'gate') and (lo[0] > -0.47 or hi[0] < 0.47):
            out.append(f'spans x {lo[0]:.3f}..{hi[0]:.3f}: it must fill its tile edge so neighbours meet')
        if spec.kind == 'gate':
            leaf = info.node_bounds.get('door')
            hinge = info.node_world_pos.get('door')
            if leaf is None or hinge is None:
                out.append('gate without a door leaf')
            else:
                if abs(hinge[0] - leaf[0][0]) > 0.08 and abs(hinge[0] - leaf[1][0]) > 0.08:
                    out.append(f'the door node origin (x {hinge[0]:.2f}) is not on an edge of the leaf ({leaf[0][0]:.2f}..{leaf[1][0]:.2f})')
                if leaf[1][0] - leaf[0][0] < 0.6:
                    out.append(f'the leaf is {leaf[1][0] - leaf[0][0]:.2f} m wide: too narrow to walk through')
    if spec.kind == 'pillar' and max(hi[0] - lo[0], hi[2] - lo[2]) > 0.36:
        out.append(f'pillar is {max(hi[0] - lo[0], hi[2] - lo[2]):.3f} m across (the spec says a 0.35 m post)')
    if spec.height is not None and abs(hi[1] - spec.height) > 0.02:
        out.append(f'height {hi[1]:.3f} != {spec.height}')
    if info.json.get('images') or info.json.get('textures'):
        out.append('GLB contains images/textures')
    half = {'car': (1.0, 2.5), 'small': (0.5, 1.0)}          # half extents of a spot (across, along)
    for i, sp in enumerate(spec.spots):
        ax, al = half[sp['size']]
        hx, hz = (al, ax) if sp['rot'] % 180 == 90 else (ax, al)
        if spec.id != 'rack_bike' and (abs(sp['x']) + hx > spec.w / 2 + 0.01 or abs(sp['z']) + hz > spec.d / 2 + 0.01):
            out.append(f'parking spot {i} ({sp["size"]}) does not fit the {spec.w} x {spec.d} footprint')
    return out


def build_all(ids: list[str], root: Path, use_ao: bool) -> dict:
    root.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.structures-stage-', dir=root))
    entries, failures, staged_extra = {}, [], []
    try:
        for sid in ids:
            spec = SPECS[sid]
            m = build_model(spec, use_ao)
            path = stage / f'{sid}.glb'
            export.export_glb(path, vertex_colors=use_ao)
            glb.quantize(path)
            info = glb.inspect(path, exclude_from_bounds=())
            problems = check(spec, info)
            if problems:
                failures.append((sid, problems))
            lo, hi = [round(v, 4) for v in info.bounds_min], [round(v, 4) for v in info.bounds_max]
            e = {'kind': spec.kind, 'file': f'models/structures/{sid}.glb', 'bytes': path.stat().st_size,
                 'sha256': export.sha256(path), 'triangles': info.tris, 'budget': spec.budget,
                 'tileFootprint': {'w': spec.w, 'd': spec.d}, 'bounds': {'min': lo, 'max': hi},
                 'materials': sorted(set(info.materials)), 'parts': sorted(spec.parts), 'doc': spec.doc}
            e['outline'] = m.outline
            if spec.material:
                e['material'] = spec.material
            if spec.band is not None:
                e['band'] = spec.band
            if spec.style is not None:
                e['style'] = spec.style
            if spec.kind == 'gate':
                hinge = info.node_world_pos['door']
                e['door'] = {'node': 'door', 'hinge': [round(hinge[0], 4), round(hinge[1], 4), round(hinge[2], 4)], 'axis': '+Y', 'opens': 90}
                if sorted(m.frames) != ['back', 'front']:
                    failures.append((sid, [f'a gate needs front and back frames, found {sorted(m.frames)}']))
            if spec.spots:
                e['parking'] = {'spots': spec.spots, 'options': spec.options, 'needsStreetAccess': spec.needs_street}
            if spec.rise is not None:
                e['vertical'] = {'kind': 'ramp' if spec.kind == 'ramp' else 'stairs', 'run': spec.d, 'width': spec.w,
                                 'rise': spec.rise, 'climbs': '+Z'}
                if sorted(m.frames) != ['bottom', 'top']:
                    failures.append((sid, [f'stairs and ramps need bottom and top frames, found {sorted(m.frames)}']))
                e['frames'] = m.frames
            elif m.frames:
                e['frames'] = m.frames                 # project pieces: where the crew and helpers stand
            if spec.lods:                                   # the far level of detail: same silhouette, under 45% of the budget
                m1 = build_model(spec, use_ao, lod=1)
                p1 = stage / f'{sid}_lod1.glb'
                export.export_glb(p1, vertex_colors=use_ao)
                glb.quantize(p1)
                i1 = glb.inspect(p1, exclude_from_bounds=())
                bad = check(dataclasses.replace(spec, budget=spec.budget_lod1), i1)
                drift = max(abs(a - b) for a, b in zip(list(i1.bounds_min) + list(i1.bounds_max), list(info.bounds_min) + list(info.bounds_max)))
                if drift > 0.08:                            # LOD1 drops the finials (up to 6.3 cm of height)
                    bad.append(f'LOD1 bounds differ from LOD0 by {drift:.3f} m')
                if i1.tris >= info.tris:
                    bad.append(f'LOD1 has {i1.tris} triangles, LOD0 {info.tris}')
                if m1.frames != m.frames:
                    bad.append('LOD1 frames differ from LOD0')
                if bad:
                    failures.append((f'{sid}_lod1', bad))
                e['lod1'] = {'file': f'models/structures/{sid}_lod1.glb', 'bytes': p1.stat().st_size, 'sha256': export.sha256(p1),
                             'triangles': i1.tris, 'budget': spec.budget_lod1}
                staged_extra.append(f'{sid}_lod1')
                print(f'[structures] {sid}_lod1: {i1.tris} triangles (budget {spec.budget_lod1})' + ('' if not bad else '  FAILED: ' + '; '.join(bad)))
            entries[sid] = e
            print(f'[structures] {sid}: {info.tris} triangles (budget {spec.budget})'
                  + ('' if not problems else '  FAILED: ' + '; '.join(problems)))
        for band in sorted({SPECS[s].band for s in ids if SPECS[s].band is not None}):       # a curb-appeal SET has one budget
            members = [s for s in SPECS if SPECS[s].band == band]
            if all(s in entries for s in members):
                total = sum(entries[s]['triangles'] for s in members)
                print(f'[structures] curb-appeal set, band {band}: {total} triangles (budget {CURB_SET_BUDGET})')
                if total > CURB_SET_BUDGET:
                    failures.append((f'curb set band {band}', [f'{total} triangles > {CURB_SET_BUDGET}']))
        if failures:
            return {'failures': failures}
        out_dir = root / 'models' / 'structures'
        out_dir.mkdir(parents=True, exist_ok=True)
        for sid in list(ids) + staged_extra:
            os.replace(stage / f'{sid}.glb', out_dir / f'{sid}.glb')
        return {'entries': entries}
    finally:
        shutil.rmtree(stage, ignore_errors=True)


def render_sheet(ids: list[str]) -> Path:
    import bpy
    import numpy as np
    from common import preview

    cell, cols = 360, 5
    rows = (len(ids) + cols - 1) // cols
    tmp = Path(tempfile.mkdtemp(prefix='structures-cells-'))
    sheet = np.zeros((rows * cell, cols * cell, 4), dtype=np.float32)
    sheet[..., :3] = 0.5
    sheet[..., 3] = 1.0
    for i, sid in enumerate(ids):
        spec = SPECS[sid]
        build_model(spec, True)
        path = tmp / f'{sid}.png'
        side = max(2, int(round(max(spec.w, spec.d) + 1)))
        preview.render_preview(path, side, side, 'door' if spec.kind == 'opening' else 'floor', cell, 32, az=140.0, el=24.0)
        img = bpy.data.images.load(str(path))
        r, c = i // cols, i % cols
        sheet[(rows - 1 - r) * cell:(rows - r) * cell, c * cell:(c + 1) * cell] = \
            np.array(img.pixels[:], dtype=np.float32).reshape(cell, cell, 4)
        bpy.data.images.remove(img)
    SHEET_DIR.mkdir(parents=True, exist_ok=True)
    out = bpy.data.images.new('structures_sheet', cols * cell, rows * cell, alpha=False)
    out.pixels.foreach_set(sheet.ravel())
    target = SHEET_DIR / 'structures.jpg'
    scene = bpy.context.scene
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = 88
    out.save_render(str(target), scene=scene)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f'[structures] sheet {target} (row order: {", ".join(ids)})')
    return target


def main() -> int:
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser(prog='build_structures.py')
    ap.add_argument('--only', default='')
    ap.add_argument('--out', default=None)
    ap.add_argument('--preview', action='store_true')
    ap.add_argument('--no-ao', dest='ao', action='store_false')
    args = ap.parse_args(argv)
    # one exporter per kit (tools/blender/toolchains.json): refuse to publish with another Blender
    import pathlib as _pathlib
    sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parents[1]))
    from common import toolchain as _toolchain
    _toolchain.require('structures', scratch=bool(args.out))
    only = [s for s in args.only.split(',') if s]
    unknown = [s for s in only if s not in SPECS]
    if unknown:
        print(f'unknown ids: {unknown}', file=sys.stderr)
        return 2
    ids = only or list(SPECS)
    missing = [i for i in ids if i not in models.BUILDERS]
    if missing:
        print(f'no builder for: {missing}', file=sys.stderr)
        return 1
    root = Path(args.out).resolve() if args.out else PUBLIC
    res = build_all(ids, root, args.ao)
    if 'failures' in res:
        for sid, problems in res['failures']:
            print(f'[structures] FAILED {sid}:\n  - ' + '\n  - '.join(problems), file=sys.stderr)
        print('[structures] nothing published', file=sys.stderr)
        return 1
    if not only:
        text = json.dumps({'version': 1, 'units': 'm', 'up': '+Y', 'front': '+Z', 'storeyHeight': 2.9,
                           'note': 'stand-alone kit (D-038): not catalogue objects until W-030/W-031 register them',
                           'models': res['entries']}, indent=1) + '\n'
        tmp = root / f'.{MANIFEST}.tmp'
        tmp.write_text(text, encoding='utf-8', newline='\n')
        os.replace(tmp, root / MANIFEST)
        print(f'[structures] wrote {root / MANIFEST}')
    else:
        print('[structures] subset build: manifest not rewritten')
    if args.preview:
        render_sheet(ids)
    return 0


if __name__ == '__main__':
    sys.exit(main())
