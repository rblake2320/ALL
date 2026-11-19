"""Cycles renders: CAZ thumbnails (256x256 WEBP, transparent, bust framing), per-body clip sheets and the contact
sheet (tools/blender/out/cast/). Lighting is identical for every body."""
from __future__ import annotations

import math
import os

import bpy
import numpy as np
from mathutils import Euler, Vector

from . import retarget as RT

SLATE = (0.0242, 0.0284, 0.0423)          # #2b2f3a (linear)
SHEET_CLIPS = ('idle', 'walk', 'sit', 'sitEat', 'sleep', 'cook', 'hug', 'dance')
BED_HEIGHT = 0.42
SEAT_HEIGHT = 0.46


def setup_stage(samples: int = 24) -> dict:
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = False
    sc.cycles.seed = 7
    try:
        sc.cycles.use_denoising = True
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:  # pragma: no cover
        sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 4
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'None'
    w = bpy.data.worlds.new('CastWorld')
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.05, 0.05, 0.07, 1)
    bg.inputs[1].default_value = 1.0
    objs = []

    def light(name, kind, energy, loc, rot, size=1.0, color=(1, 1, 1)):
        ld = bpy.data.lights.new(name, kind)
        ld.energy = energy
        ld.color = color
        if kind == 'AREA':
            ld.size = size
        o = bpy.data.objects.new(name, ld)
        sc.collection.objects.link(o)
        o.location = loc
        o.rotation_euler = Euler(rot)
        objs.append(o)
        return o
    light('Key', 'AREA', 260, (1.6, -2.4, 2.8), (math.radians(52), 0, math.radians(32)), 2.0, (1.0, 0.95, 0.88))
    light('Fill', 'AREA', 90, (-2.4, -1.6, 1.4), (math.radians(70), 0, math.radians(-56)), 2.5, (0.82, 0.86, 1.0))
    light('Rim', 'AREA', 160, (-0.6, 2.4, 2.6), (math.radians(-50), 0, math.radians(190)), 1.5, (0.75, 1.0, 0.7))
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    objs.append(cam)
    return {'cam': cam, 'objs': objs}


def _look(cam, target: Vector, yaw_deg: float, pitch_deg: float, dist: float) -> None:
    yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
    d = Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
    cam.location = target + d * dist
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()


def _box(name, size, loc, color):
    me = bpy.data.meshes.new(name)
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.scale = size
    o.location = loc
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*color, 1)
    m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.8
    me.materials.append(m)
    return o


def render_to(path: str, w: int, h: int, fmt: str = 'PNG', transparent: bool = False, quality: int = 90) -> None:
    sc = bpy.context.scene
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = transparent
    st = sc.render.image_settings
    st.file_format = fmt
    st.color_mode = 'RGBA' if transparent else 'RGB'
    if fmt == 'WEBP':
        st.quality = quality
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def thumb_framing(res: dict) -> dict:
    """Head-based bust framing: the skull (neck joint -> skull top) spans half the frame, eyes 30 % from the top
    (lower when tall headwear needs the room). Returns ortho size F, eye fraction and the matching UI face crop."""
    marks = res['marks']
    top = res['headTop']
    neck = res['arm'].data.bones['neck'].head_local.z
    eye_z = (marks['eye_L'].z + marks['eye_R'].z) / 2 if 'eye_L' in marks else neck + 0.6 * (top - neck)
    skull = marks['skull_top'].z if 'skull_top' in marks else top
    hs = max(0.12, skull - neck)
    F = 2.0 * hs
    frac = 0.30
    need = top + 0.02 - eye_z
    if need > frac * F:
        frac = min(0.45, need / F)
        if need > frac * F:
            F = need / frac
    fy = frac + 0.05                      # face centre a little below the eye line
    size = round(62.0 * F / hs, 1)        # castArt.ts: image drawn `size` units wide in the 100-unit portrait
    return {'F': F, 'eye_z': eye_z, 'frac': frac, 'crop': {'fx': 0.5, 'fy': round(fy, 3), 'size': size}}


def thumbnail(res: dict, path: str, height: float) -> dict:
    """Bust portrait (see thumb_framing); returns the face crop for the manifest."""
    st = setup_stage(48)
    cam = st['cam']
    cam.data.type = 'ORTHO'
    fr = thumb_framing(res)
    F = fr['F']
    cam.data.ortho_scale = F
    centre = Vector((0, 0, fr['eye_z'] - (0.5 - fr['frac']) * F))
    _look(cam, centre, 18, 0, 6.0)
    RT.rest_pose(res['arm'])
    # OpenImageDenoise on several CPU threads changes a few pixels from run to run (max 5/255 on 5 of 65,536 pixels,
    # fisherman), so the published WEBP changed bytes on every rebuild. One thread makes the thumbnail byte-identical
    # (3 runs, same SHA-256) at about +4 s per body.
    rd = bpy.context.scene.render
    mode, threads = rd.threads_mode, rd.threads
    rd.threads_mode, rd.threads = 'FIXED', 1
    try:
        render_to(path, 256, 256, 'WEBP', transparent=True, quality=92)
    finally:
        rd.threads_mode, rd.threads = mode, threads
    for o in st['objs']:
        bpy.data.objects.remove(o, do_unlink=True)
    return fr['crop']


def _load_png(path: str) -> np.ndarray:
    img = bpy.data.images.load(path)
    W, H = img.size
    a = np.empty(W * H * 4, np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(H, W, 4)


def save_png(arr: np.ndarray, path: str) -> None:
    H, W = arr.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), W, H, alpha=True)
    img.pixels.foreach_set(np.ascontiguousarray(arr, np.float32).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


def clip_sheet(res: dict, zref, path: str, tmpdir: str, height: float) -> None:
    """2 rows (3/4 front, side) x 8 clips, stand-in chair / bed / floor."""
    st = setup_stage(20)
    cam = st['cam']
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = max(2.1, height * 1.18)
    floor = _box('Floor', (4, 4, 0.02), (0, 0, -0.01), (0.16, 0.17, 0.2))
    chair = _box('Chair', (0.46, 0.44, SEAT_HEIGHT), (0, 0.12, SEAT_HEIGHT / 2), (0.35, 0.22, 0.14))
    bed = _box('Bed', (0.9, 2.1, BED_HEIGHT), (0, 0, BED_HEIGHT / 2), (0.55, 0.5, 0.62))
    arm = res['arm']
    W, H = 200, 260
    tiles = []
    for row, (yaw, pitch) in enumerate(((-28, 8), (-90, 4))):
        for clip in SHEET_CLIPS:
            f0, f1 = zref.clip_frames(clip)
            fr = f0 + (f1 - f0) // 3
            RT.apply_pose(zref, arm, clip, fr, res['body'])
            chair.hide_render = clip not in ('sit', 'sitEat')
            bed.hide_render = clip != 'sleep'
            arm.location = (0, 0, BED_HEIGHT if clip == 'sleep' else 0)
            bpy.context.view_layer.update()
            tgt = Vector((0, 0, height * 0.5)) if clip != 'sleep' else Vector((0, 0, BED_HEIGHT + 0.3))
            _look(cam, tgt, yaw if clip != 'sleep' else yaw - 50, pitch if clip != 'sleep' else 30, 6.0)
            p = os.path.join(tmpdir, f'{row}_{clip}.png')
            render_to(p, W, H)
            tiles.append(_load_png(p))
    arm.location = (0, 0, 0)
    RT.rest_pose(arm)
    sheet = np.zeros((2 * H, len(SHEET_CLIPS) * W, 4), np.float32)
    for i, t in enumerate(tiles):
        r, c = divmod(i, len(SHEET_CLIPS))
        sheet[(1 - r) * H:(2 - r) * H, c * W:(c + 1) * W] = t   # Blender pixel rows are bottom-up
    sheet[..., 3] = 1
    save_png(sheet, path)
    for o in st['objs'] + [floor, chair, bed]:
        bpy.data.objects.remove(o, do_unlink=True)


def contact_tile(res: dict, path: str, height: float, label: str) -> None:
    st = setup_stage(20)
    cam = st['cam']
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 2.35
    floor = _box('Floor', (4, 4, 0.02), (0, 0, -0.01), (0.16, 0.17, 0.2))
    td = bpy.data.curves.new('Label', 'FONT')
    td.body = label
    td.size = 0.13
    td.align_x = 'CENTER'
    to = bpy.data.objects.new('Label', td)
    bpy.context.scene.collection.objects.link(to)
    to.location = (0, -0.6, 0.02)
    tm = bpy.data.materials.new('LabelMat')
    tm.use_nodes = True
    tm.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value = (0.9, 0.85, 0.7, 1)
    tm.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 2.0
    td.materials.append(tm)
    RT.rest_pose(res['arm'])
    _look(cam, Vector((0, 0, 1.0)), -20, 6, 6.0)
    to.rotation_euler = (math.radians(80), 0, math.radians(-20))
    render_to(path, 240, 300)
    for o in st['objs'] + [floor, to]:
        bpy.data.objects.remove(o, do_unlink=True)


def contact_sheet(tile_paths: list[str], path: str, cols: int = 5) -> None:
    tiles = [_load_png(p) for p in tile_paths]
    h, w = tiles[0].shape[:2]
    rows = (len(tiles) + cols - 1) // cols
    sheet = np.zeros((rows * h, cols * w, 4), np.float32)
    sheet[..., 3] = 1
    for i, t in enumerate(tiles):
        r, c = divmod(i, cols)
        rr = rows - 1 - r
        sheet[rr * h:(rr + 1) * h, c * w:(c + 1) * w] = t
    save_png(sheet, path)
