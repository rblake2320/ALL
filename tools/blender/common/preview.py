"""Cycles CPU preview renders: elevated 3/4 studio view with a 1.62 m reference capsule and a 1 m tile grid.

Call ``render_preview`` AFTER export (it adds helper objects to the scene). Keeps render cost tiny (shared CPU):
192 px, 12 samples + OpenImageDenoise when available, 2 threads.
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Tuple

import bmesh
import bpy
from mathutils import Vector

from . import dims
from .materials import MatSpec, make_material
from .shapes import box, cylinder, merge, sphere

Bounds = Tuple[Tuple[float, float, float], Tuple[float, float, float]]


def scene_bounds(objs: Iterable[bpy.types.Object]) -> Bounds:
    dg = bpy.context.evaluated_depsgraph_get()
    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    for ob in objs:
        if ob.type != 'MESH':
            continue
        ev = ob.evaluated_get(dg)
        for c in ev.bound_box:
            w = ev.matrix_world @ Vector(c)
            for k in range(3):
                lo[k] = min(lo[k], w[k])
                hi[k] = max(hi[k], w[k])
    if lo[0] == math.inf:
        return ((-0.5, -0.5, 0), (0.5, 0.5, 1))
    return (tuple(lo), tuple(hi))  # type: ignore[return-value]


def _obj(name: str, bm: bmesh.types.BMesh, mat: bpy.types.Material) -> bpy.types.Object:
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def _floor(w: int, d: int, b: Bounds, wall_kind: str) -> None:
    light = make_material('_pv_tile_a', MatSpec('#8f918b', roughness=0.9))
    dark = make_material('_pv_tile_b', MatSpec('#7b7d78', roughness=0.9))
    foot = make_material('_pv_tile_f', MatSpec('#8a93a3', roughness=0.9))
    (lx, ly, _), (hx, hy, _) = b
    nx0 = math.floor(min(lx, -w / 2) - 1.0 + w / 2)
    nx1 = math.ceil(max(hx + 0.9, w / 2) + 1.0 + w / 2)
    ny0 = math.floor(min(ly, -d / 2) - 1.0 + d / 2)
    ny1 = math.ceil(max(hy, d / 2) + 1.0 + d / 2)
    bm = bmesh.new()
    mats = [light, dark, foot]
    for ix in range(nx0, nx1):
        for iy in range(ny0, ny1):
            x0, y0 = ix - w / 2, iy - d / 2
            vs = [bm.verts.new((x0 + a, y0 + c, 0.0)) for a, c in ((0, 0), (1, 0), (1, 1), (0, 1))]
            f = bm.faces.new(vs)
            inside = 0 <= ix < w and 0 <= iy < d and wall_kind == 'floor'
            f.material_index = 2 if inside else (ix + iy) % 2
    me = bpy.data.meshes.new('_pv_floor')
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new('_pv_floor', me)
    bpy.context.scene.collection.objects.link(ob)


def _walls(kind: str) -> None:
    mat = make_material('_pv_wall', MatSpec('#a59e93', roughness=0.9))
    T = dims.WALL_THICKNESS
    H = dims.WALL_HEIGHT
    parts = []
    if kind == 'wall':
        # wall surface at y=0, wall body behind it (+Y)
        parts.append(box(3.0, T, H, 0.0, 0, base=(0, T / 2, 0)))
    elif kind in ('door', 'window'):
        hw = (dims.DOOR_WIDTH if kind == 'door' else dims.WINDOW_WIDTH) / 2
        parts.append(box(1.5 - hw, T, H, 0.0, 0, base=(-(hw + (1.5 - hw) / 2), 0, 0)))
        parts.append(box(1.5 - hw, T, H, 0.0, 0, base=((hw + (1.5 - hw) / 2), 0, 0)))
        if kind == 'door':
            parts.append(box(2 * hw, T, H - dims.DOOR_HEIGHT, 0.0, 0, base=(0, 0, dims.DOOR_HEIGHT)))
        else:
            top = dims.WINDOW_SILL + dims.WINDOW_HEIGHT
            parts.append(box(2 * hw, T, dims.WINDOW_SILL, 0.0, 0, base=(0, 0, 0)))
            parts.append(box(2 * hw, T, H - top, 0.0, 0, base=(0, 0, top)))
    if parts:
        _obj('_pv_wall', merge(*parts), mat)


def _capsule(x: float, y: float) -> None:
    mat = make_material('_pv_capsule', MatSpec('#9b9aa3', roughness=0.6))
    r = 0.17
    h = dims.CHARACTER_HEIGHT
    bm = merge(cylinder(r, h - 2 * r, 16, 0.0, base=(0, 0, r), cap=False),
               sphere(r, 16, 8, loc=(0, 0, r)), sphere(r, 16, 8, loc=(0, 0, h - r)))
    bmesh.ops.translate(bm, vec=(x, y, 0), verts=bm.verts)
    ob = _obj('_pv_capsule', bm, mat)
    for p in ob.data.polygons:
        p.use_smooth = True


def _camera(points: List[Vector], target: Vector, az_deg: float, el_deg: float, lens: float) -> None:
    cam = bpy.data.cameras.new('_pv_cam')
    cam.lens = lens
    cam.sensor_width = 36
    cam.clip_start = 0.05
    cam.clip_end = 200
    ob = bpy.data.objects.new('_pv_cam', cam)
    bpy.context.scene.collection.objects.link(ob)
    az, el = math.radians(az_deg), math.radians(el_deg)
    d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))).normalized()
    f = -d
    r = f.cross(Vector((0, 0, 1))).normalized()
    u = r.cross(f).normalized()
    half = math.atan(cam.sensor_width / 2 / lens)
    t = math.tan(half) * 0.9
    dist = 0.5
    for p in points:
        rel = p - target
        x, y, z = rel.dot(r), rel.dot(u), rel.dot(f)
        dist = max(dist, abs(x) / t - z, abs(y) / t - z)
    ob.location = target + d * dist
    ob.rotation_euler = f.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = ob


def _lights() -> None:
    sc = bpy.context.scene
    sun = bpy.data.lights.new('_pv_sun', 'SUN')
    sun.energy = 3.2
    sun.angle = math.radians(12)
    sun.color = (1.0, 0.96, 0.9)
    ob = bpy.data.objects.new('_pv_sun', sun)
    ob.rotation_euler = (math.radians(50), 0, math.radians(-35))
    sc.collection.objects.link(ob)
    fill = bpy.data.lights.new('_pv_fill', 'SUN')
    fill.energy = 0.8
    fill.color = (0.85, 0.9, 1.0)
    ob2 = bpy.data.objects.new('_pv_fill', fill)
    ob2.rotation_euler = (math.radians(65), 0, math.radians(150))
    sc.collection.objects.link(ob2)
    world = bpy.data.worlds.new('_pv_world')
    sc.world = world
    nt = world.node_tree
    if nt is None:
        world.use_nodes = True
        nt = world.node_tree
    bg = next(n for n in nt.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (0.32, 0.31, 0.33, 1)
    bg.inputs['Strength'].default_value = 0.9


def configure_cycles(res: int, samples: int, threads: int = 2) -> None:
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.max_bounces = 4
    sc.cycles.diffuse_bounces = 2
    sc.cycles.glossy_bounces = 2
    sc.cycles.transmission_bounces = 4
    sc.cycles.transparent_max_bounces = 8
    try:
        sc.cycles.use_denoising = True
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:  # pragma: no cover - denoiser not compiled in
        sc.cycles.use_denoising = False
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = threads
    sc.render.resolution_x = res
    sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    try:
        sc.view_settings.view_transform = 'AgX'
        sc.view_settings.look = 'AgX - Medium High Contrast'
    except TypeError:
        pass


def _wire_vertex_ao() -> None:
    """If the model carries a baked 'AO' colour attribute, multiply it into every material's base colour so the
    Cycles preview matches what the engine shows (meshes without AO get a constant 1.0 attribute)."""
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH' and not o.name.startswith('_pv_')]
    if not any(o.data.color_attributes.get('AO') for o in meshes):
        return
    for o in meshes:
        me = o.data
        if me.color_attributes.get('AO') is None:
            attr = me.color_attributes.new('AO', 'BYTE_COLOR', 'CORNER')
            for dd in attr.data:
                dd.color = (1.0, 1.0, 1.0, 1.0)
    done = set()
    for o in meshes:
        for slot in o.material_slots:
            mat = slot.material
            if mat is None or mat.name in done or mat.node_tree is None:
                continue
            done.add(mat.name)
            nt = mat.node_tree
            bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if bsdf is None:
                continue
            base = tuple(bsdf.inputs['Base Color'].default_value)
            ca = nt.nodes.new('ShaderNodeVertexColor')
            ca.layer_name = 'AO'
            mul = nt.nodes.new('ShaderNodeMix')
            mul.data_type = 'RGBA'
            mul.blend_type = 'MULTIPLY'
            mul.inputs['Factor'].default_value = 1.0
            mul.inputs['A'].default_value = base
            nt.links.new(ca.outputs['Color'], mul.inputs['B'])
            nt.links.new(mul.outputs['Result'], bsdf.inputs['Base Color'])


def render_preview(out: Path, w: int, d: int, kind: str = 'floor', res: int = 192, samples: int = 12,
                   hide: Sequence[str] = (), az: float = 32.0, el: float = 34.0, threads: int = 2) -> None:
    """kind: 'floor' | 'wall' | 'door' | 'window' | 'item' | 'env'."""
    _wire_vertex_ao()
    for name in hide:
        ob = bpy.data.objects.get(name)
        if ob is not None:
            ob.hide_render = True
            for ch in ob.children_recursive:
                ch.hide_render = True
    model_objs = [o for o in bpy.context.scene.objects if not o.name.startswith('_pv_') and not o.hide_render]
    b = scene_bounds(model_objs)
    (lx, ly, lz), (hx, hy, hz) = b
    cap_x = hx + 0.45
    _floor(w, d, b, 'floor' if kind in ('floor', 'item') else 'wall')
    _walls(kind)
    _capsule(cap_x, 0.0 if kind not in ('wall',) else -0.3)
    _lights()
    pts = [Vector((x, y, z)) for x in (lx, hx) for y in (ly, hy) for z in (max(0.0, lz), hz)]
    pts += [Vector((cap_x + sx * 0.17, sy * 0.17, z)) for sx in (-1, 1) for sy in (-1, 1) for z in (0, dims.CHARACTER_HEIGHT)]
    if kind == 'item':
        # loose items are tiny: frame the item, keep the capsule only partially in view
        pts = [Vector((x, y, z)) for x in (lx, hx) for y in (ly, hy) for z in (0.0, max(hz, 0.25))]
        pts += [Vector((lx - 0.15, ly - 0.15, 0)), Vector((hx + 0.15, hy + 0.15, 0))]
    target = sum(pts, Vector()) / len(pts)
    _camera(pts, target, az, el, lens=60 if kind != 'env' else 50)
    configure_cycles(res, samples, threads)
    sc = bpy.context.scene
    sc.render.filepath = str(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    from .export import quiet
    with quiet():
        bpy.ops.render.render(write_still=True)
