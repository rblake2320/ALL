"""Scene reset + glTF export wrapper (uncompressed GLB: Draco/meshopt are unavailable in this bpy build)."""
from __future__ import annotations

import hashlib
import io
import logging
import os
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import bpy

log = logging.getLogger('blender.export')


def reset_scene() -> None:
    """Empty factory scene (fast: ~50 ms). Units metric, 1 BU = 1 m."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0


@contextmanager
def quiet() -> Iterator[None]:
    """Silence the exporter's INFO chatter (it prints straight to fd 1/2)."""
    devnull = os.open(os.devnull, os.O_WRONLY)
    saved = os.dup(1), os.dup(2)
    sys.stdout.flush()
    sys.stderr.flush()
    try:
        os.dup2(devnull, 1)
        os.dup2(devnull, 2)
        yield
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
        os.dup2(saved[0], 1)
        os.dup2(saved[1], 2)
        os.close(devnull)
        os.close(saved[0])
        os.close(saved[1])


def export_glb(path: Path, vertex_colors: bool = False) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    kwargs = dict(
        filepath=str(path),
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
        export_texcoords=False,
        export_normals=True,
        export_tangents=False,
        export_materials='EXPORT',
        export_vertex_color='ACTIVE' if vertex_colors else 'NONE',
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_attributes=False,
        export_draco_mesh_compression_enable=False,
        use_selection=False,
        use_visible=False,
        export_copyright='Afterlife Lease (procedural, original)',
    )
    if vertex_colors:
        kwargs['export_all_vertex_colors'] = False
        kwargs['export_active_vertex_color_when_no_material'] = True
    with quiet():
        res = bpy.ops.export_scene.gltf(**kwargs)
    if 'FINISHED' not in res:
        raise RuntimeError(f'glTF export failed for {path}: {res}')


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 16), b''):
            h.update(chunk)
    return h.hexdigest()
