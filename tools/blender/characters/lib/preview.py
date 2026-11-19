"""Cycles contact sheets: posed static copies of the rig laid out on a grid with 3D text labels.

Low cost by design (shared 4-core CPU): one render per sheet, small resolution, few samples + denoise.
"""
from __future__ import annotations

import math
import os

import bpy
from mathutils import Euler, Vector

from .consts import hex_lin

V = Vector
PREVIEW_COLLECTION = 'PreviewSheet'


def _mat(name: str, hex_color: str, rough: float = 0.8, emit: float = 0.0):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled')
    r, g, b = hex_lin(hex_color)
    bsdf.inputs['Base Color'].default_value = (r, g, b, 1)
    bsdf.inputs['Roughness'].default_value = rough
    if emit:
        bsdf.inputs['Emission Color'].default_value = (r, g, b, 1)
        bsdf.inputs['Emission Strength'].default_value = emit
    return m


def sheet_collection() -> bpy.types.Collection:
    col = bpy.data.collections.get(PREVIEW_COLLECTION)
    if col is None:
        col = bpy.data.collections.new(PREVIEW_COLLECTION)
        bpy.context.scene.collection.children.link(col)
    return col


def clear_sheet() -> None:
    col = bpy.data.collections.get(PREVIEW_COLLECTION)
    if col is None:
        return
    for ob in list(col.objects):
        data = ob.data
        bpy.data.objects.remove(ob, do_unlink=True)
        if data is not None and data.users == 0:
            if isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)
            elif isinstance(data, bpy.types.Curve):
                bpy.data.curves.remove(data)
            elif isinstance(data, bpy.types.Light):
                bpy.data.lights.remove(data)
            elif isinstance(data, bpy.types.Camera):
                bpy.data.cameras.remove(data)


def setup_render(width: int, height: int, samples: int = 12) -> None:
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.max_bounces = 4
    sc.cycles.diffuse_bounces = 2
    sc.cycles.glossy_bounces = 2
    sc.cycles.transparent_max_bounces = 4
    try:
        sc.cycles.use_denoising = True
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:  # noqa: BLE001 - denoiser availability differs per build
        sc.cycles.use_denoising = False
    sc.render.resolution_x = width
    sc.render.resolution_y = height
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    try:
        sc.view_settings.view_transform = 'AgX'
        sc.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:  # noqa: BLE001
        pass
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = 3


def setup_world(night: bool = False) -> None:
    sc = bpy.context.scene
    if sc.world is None:
        sc.world = bpy.data.worlds.new('PreviewWorld')
    w = sc.world
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.bl_idname == 'ShaderNodeBackground')
    r, g, b = hex_lin('#3a3446' if not night else '#1d1726')
    bg.inputs['Color'].default_value = (r, g, b, 1)
    bg.inputs['Strength'].default_value = 0.9


def add_light(name: str, loc, rot_deg, energy: float, color: str, size: float = 2.0):
    col = sheet_collection()
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = energy
    ld.color = hex_lin(color)
    ld.size = size
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    ob.rotation_euler = Euler([math.radians(a) for a in rot_deg])
    col.objects.link(ob)
    return ob


def add_ground(size: float, center=(0, 0, 0)):
    col = sheet_collection()
    me = bpy.data.meshes.new('PreviewGround')
    s = size / 2
    me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new('PreviewGround', me)
    ob.location = center
    me.materials.append(_mat('PreviewGroundMat', '#5d6b52', 0.95))
    col.objects.link(ob)
    return ob


def add_box(name: str, size, local_center, origin=(0.0, 0.0, 0.0), yaw_deg: float = 0.0, color: str = '#8a6a4a'):
    """Prop box (chair / bed / counter stand-ins for pose sheets) placed in a figure's frame: `local_center` in the
    character's space, turned with it by `yaw_deg` about `origin` (as snapshot() turns the figure)."""
    col = sheet_collection()
    sx, sy, sz = (v / 2 for v in size)
    cx, cy, cz = local_center
    verts = [(cx + x * sx, cy + y * sy, cz + z * sz) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    ob = bpy.data.objects.new(name, me)
    ob.location = origin
    ob.rotation_euler = Euler((0, 0, math.radians(yaw_deg)))
    me.materials.append(_mat(name + 'Mat', color, 0.85))
    col.objects.link(ob)
    return ob


def add_camera(target: Vector, yaw_deg: float, pitch_deg: float, dist: float, ortho_scale: float | None = None,
               lens: float = 50.0):
    col = sheet_collection()
    cd = bpy.data.cameras.new('PreviewCam')
    if ortho_scale is not None:
        cd.type = 'ORTHO'
        cd.ortho_scale = ortho_scale
    else:
        cd.lens = lens
    cd.clip_end = 200
    ob = bpy.data.objects.new('PreviewCam', cd)
    yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
    # yaw 0 = camera in front of the characters (at -Y) looking toward +Y
    off = V((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch))) * dist
    ob.location = target + off
    direction = target - ob.location
    ob.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    col.objects.link(ob)
    bpy.context.scene.camera = ob
    return ob


def add_label(text: str, loc, size: float = 0.12, color: str = '#e8e0c8'):
    col = sheet_collection()
    cu = bpy.data.curves.new('Label', 'FONT')
    cu.body = text
    cu.size = size
    cu.align_x = 'CENTER'
    ob = bpy.data.objects.new('Label', cu)
    ob.location = loc
    ob.rotation_euler = Euler((math.radians(55), 0, 0))
    cu.materials.append(_mat('PreviewLabelMat', color, 0.5, emit=0.6))
    col.objects.link(ob)
    return ob


def snapshot(objs: list, offset: Vector, material_map: dict | None = None, yaw_deg: float = 0.0) -> list:
    """Evaluate each object (armature deformation + shape keys) and place a static copy at offset."""
    col = sheet_collection()
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for ob in objs:
        ev = ob.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
        if material_map:
            for i, m in enumerate(me.materials):
                if m is not None and m.name in material_map:
                    me.materials[i] = material_map[m.name]
        cp = bpy.data.objects.new(ob.name + '_snap', me)
        cp.matrix_world = ob.matrix_world.copy()
        cp.rotation_euler = Euler((0, 0, math.radians(yaw_deg)))
        cp.location = offset
        col.objects.link(cp)
        out.append(cp)
    return out


def standard_lights(center: Vector, span: float) -> None:
    add_light('Key', center + V((-span * 0.6, -span * 0.9, span * 1.1)), (50, 0, -35), 260 * span * span / 4,
              '#ffe2c0', size=span * 0.9)
    add_light('Fill', center + V((span * 0.9, -span * 0.5, span * 0.5)), (70, 0, 60), 90 * span * span / 4,
              '#9fb3ff', size=span)
    add_light('Rim', center + V((0.3 * span, span * 1.0, span * 0.8)), (-55, 0, 180), 140 * span * span / 4,
              '#c7b2ff', size=span * 0.6)


def render_to(path: str) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path
