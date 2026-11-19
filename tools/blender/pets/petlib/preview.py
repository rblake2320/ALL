"""Cycles contact sheets: rows = variants (normal, undead), columns = poses. CPU rendering, fixed seed."""
from __future__ import annotations

import math
import os
import tempfile

import bpy
import numpy as np
from mathutils import Vector

from . import build, clips
from .species import CLIP_TIMING, SPECIES, hex_lin

CELL = 480
SAMPLES = 40
# (clip, phase 0..1, camera azimuth degrees: 0 = straight in front of the pet, + toward the pet's left)
CELLS = [('idle', 0.10, 38.0), ('walk', 0.30, 78.0), ('run', 0.55, 78.0), ('sit', 0.20, 40.0), ('sleep', 0.20, 48.0),
         ('eat', 0.25, 70.0), ('play', 0.25, 55.0), ('beg', 0.25, 42.0)]


def _link_vertex_colors() -> None:
    """Previews multiply COLOR_0 into Base Color (the game's renderer does this at runtime)."""
    for mat in bpy.data.materials:
        nt = mat.node_tree
        bsdf = next((n for n in nt.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
        if bsdf is None:
            continue
        col = tuple(bsdf.inputs['Base Color'].default_value)
        attr = nt.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'Col'
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs[6].default_value = col
        nt.links.new(attr.outputs['Color'], mix.inputs[7])
        nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])


def _studio(size: float) -> bpy.types.Object:
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = SAMPLES
    scene.cycles.seed = 7
    scene.cycles.use_denoising = False
    scene.render.resolution_x = scene.render.resolution_y = CELL
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (*hex_lin('#3a3248'), 1.0)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    scene.world = world

    me = bpy.data.meshes.new('Floor')
    k = 40 * size
    me.from_pydata([(-k, -k, 0), (k, -k, 0), (k, k, 0), (-k, k, 0)], [], [(0, 1, 2, 3)])
    floor = bpy.data.objects.new('Floor', me)
    mat = bpy.data.materials.new('FloorMat')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*hex_lin('#55506a'), 1.0)
    bsdf.inputs['Roughness'].default_value = 0.9
    me.materials.append(mat)
    scene.collection.objects.link(floor)

    for name, energy, rot, colour in (('Key', 3.2, (52, 0, 35), '#fff1dc'), ('Fill', 1.1, (60, 0, -120), '#a9c4ff')):
        light = bpy.data.lights.new(name, 'SUN')
        light.energy = energy
        light.angle = math.radians(12)
        light.color = hex_lin(colour)
        ob = bpy.data.objects.new(name, light)
        ob.rotation_euler = tuple(math.radians(a) for a in rot)
        scene.collection.objects.link(ob)

    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.lens = 60
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


def _aim(cam, centre: Vector, dist: float, azimuth: float, elevation: float = 16.0) -> None:
    a, e = math.radians(azimuth), math.radians(elevation)
    # the pet faces -Y; azimuth 0 looks straight at its face, positive swings to its left (+X)
    pos = centre + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * dist
    cam.location = pos
    cam.rotation_euler = (centre - pos).to_track_quat('-Z', 'Y').to_euler()


def render_sheet(species: str, out_dir: str) -> str:
    rig, arm, objs, _ = build.build_scene(species)
    _link_vertex_colors()
    sp = SPECIES[species]
    lo = Vector((min(v.co.x for o in objs for v in o.data.vertices), min(v.co.y for o in objs for v in o.data.vertices), 0.0))
    hi = Vector((max(v.co.x for o in objs for v in o.data.vertices), max(v.co.y for o in objs for v in o.data.vertices),
                 max(v.co.z for o in objs for v in o.data.vertices)))
    size = max(hi.y - lo.y, hi.z)
    centre = Vector((0.0, 0.5 * (lo.y + hi.y), 0.46 * hi.z))
    cam = _studio(size)
    scene = bpy.context.scene
    tmp = tempfile.mkdtemp(prefix='pets-cells-')
    sheet = np.zeros((2 * CELL, len(CELLS) * CELL, 4), dtype=np.float32)
    for row, ob in enumerate(objs):
        for other in objs:
            other.hide_render = other is not ob
        for col, (clip, phase, az) in enumerate(CELLS):
            build.apply_pose(arm, rig, clips.pose_at(rig, clip, phase * CLIP_TIMING[clip][0]))
            _aim(cam, centre, 2.5 * size, az)
            path = os.path.join(tmp, f'{row}_{col}.png')
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            img = bpy.data.images.load(path)
            px = np.array(img.pixels[:], dtype=np.float32).reshape(CELL, CELL, 4)
            sheet[(1 - row) * CELL:(2 - row) * CELL, col * CELL:(col + 1) * CELL] = px
            bpy.data.images.remove(img)
    os.makedirs(out_dir, exist_ok=True)
    out = bpy.data.images.new(f'{species}_sheet', len(CELLS) * CELL, 2 * CELL, alpha=False)
    out.pixels.foreach_set(sheet.ravel())
    target = os.path.join(out_dir, f'{species}.jpg')
    out.filepath_raw = target
    out.file_format = 'JPEG'
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = 88
    out.save_render(target, scene=scene)
    print(f'[pets] sheet {target} ({sp["paint"]}; columns: {", ".join(c[0] for c in CELLS)}; rows: normal, undead)')
    return target
