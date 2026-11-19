"""Composed 'Old Graveyard' diorama preview (Cycles, day + night) from the BUILT GLBs — what the kit looks like
together, at a game-like elevated 3/4 camera. Preview only: nothing here is shipped.

Usage (headless Blender python, from the project root):
    /home/user/.venvs/blender/bin/python tools/blender/levels/diorama.py [--time day|night|both] [--src DIR]
        [--res 1600x900] [--samples 32] [--out tools/blender/out/levels/graveyard]

--src is the asset root holding models/levels/graveyard/*.glb (default public/assets); existing catalogue objects
(lantern_post, tree_gnarled, env_tree_b, env_gravestones, trash_lidded, pew_salvaged, window_gothic, door_crypt …)
come from public/assets/models/objects. The layout is a condensed slice of docs/levels/L2-graveyard.md §3: the
mausoleum (walls cut away like the game camera does) with the vault stairs, the Old Section rows, Potter's Field
mounds + compost + tool rack, the Willow Pond, the Moon Circle, the firepit lawn and the front fence with its gate.
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))
from common import export  # noqa: E402
from common.materials import MatSpec, hex_to_linear, make_material  # noqa: E402
from common.preview import configure_cycles  # noqa: E402

ROOT = HERE.parents[3]


class Scene:
    def __init__(self, src: Path, night: bool):
        self.src = src
        self.night = night
        self.lights = []  # (pos, colour, watts)

    def place(self, mid: str, x: float, y: float, rot: float = 0.0, show=(), hide=(), scale: float = 1.0,
              z: float = 0.0, lib: str = 'levels', light=None):
        """Import a GLB and place it (Blender coords; rot = yaw degrees). State nodes listed in the level manifest
        are hidden unless named in ``show``."""
        path = (self.src / 'models' / 'levels' / 'graveyard' / f'{mid}.glb') if lib == 'levels' else \
            (ROOT / 'public' / 'assets' / 'models' / 'objects' / f'{mid}.glb')
        before = set(bpy.data.objects)
        with export.quiet():
            bpy.ops.import_scene.gltf(filepath=str(path))
        new = [o for o in bpy.data.objects if o not in before]
        holder = bpy.data.objects.new(f'_{mid}', None)
        bpy.context.scene.collection.objects.link(holder)
        for o in new:
            if o.parent is None:
                o.parent = holder
        holder.location = (x, y, z)
        holder.rotation_euler = (0, 0, math.radians(rot))
        holder.scale = (scale, scale, scale)
        states = {'flag', 'turned', 'glow', 'steam', 'broken', 'flame'} - set(show)
        states |= set(hide)
        for o in new:
            base = o.name.split('.')[0]
            if base in states:
                for q in [o] + list(o.children_recursive):
                    q.hide_render = True
        if light:
            off, col, w = light
            bpy.context.view_layer.update()
            p = holder.matrix_world @ Vector(off)
            self.lights.append((p, col, w))
        return holder


def _mat(name, hexc, rough=0.95, **kw):
    return make_material(name, MatSpec(hexc, roughness=rough, **kw))


def ground(sc: Scene):
    import bmesh
    from common import shapes as S
    grass = _mat('_d_grass', '#5c6e50')
    grass2 = _mat('_d_grass2', '#687a5a')
    gravel = _mat('_d_gravel', '#8d877a')
    side = _mat('_d_side', '#7d7a74', 0.9)
    road = _mat('_d_road', '#3a3840', 0.9)
    flag = _mat('_d_flag', '#77736b', 0.85)

    def obj(name, bm, mat):
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        me.materials.append(mat)
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob

    obj('_g', S.box(80, 80, 0.02, 0.0, 0, base=(0, 0, -0.02)), grass)
    from common.rng import Jitter
    j = Jitter('diorama-grass')
    for k in range(40):  # lighter lawn patches for a little value variation
        x, y = j.uniform(-16, 16), j.uniform(-6, 16)
        r = j.uniform(0.6, 1.8)
        obj(f'_gp{k}', S.cylinder(r, 0.002, 14, 0.0, base=(x, y, 0.0005 * (k % 4))), grass2)
    obj('_avenue', S.box(2.0, 16.5, 0.012, 0.0, 0, base=(0, 1.25, 0)), gravel)
    obj('_cross_l', S.box(9.0, 1.6, 0.012, 0.0, 0, base=(-5.5, 0.9, 0)), gravel)
    obj('_cross_r', S.box(9.0, 1.6, 0.012, 0.0, 0, base=(5.5, 0.9, 0)), gravel)
    obj('_spur', S.box(1.0, 2.2, 0.012, 0.0, 0, base=(-5.5, 3.6, 0)), gravel)
    obj('_side', S.box(80, 2.2, 0.05, 0.0, 0, base=(0, -8.0, 0)), side)
    obj('_road', S.box(80, 6, 0.01, 0.0, 0, base=(0, -12.0, 0)), road)
    # mausoleum floor (flagstones) + walls: back/left full height, front/right cut away (game cutaway)
    obj('_mfloor', S.box(5.8, 3.8, 0.03, 0.0, 0, base=(-6.0, 6.4, 0)), flag)
    wall = _mat('_d_wall', '#7d7a72', 0.9)
    T, H, C = 0.12, 2.7, 0.28
    obj('_mw_back', S.box(6.0, T, H, 0.0, 0, base=(-6.0, 8.3, 0)), wall)
    obj('_mw_left', S.box(T, 4.0, H, 0.0, 0, base=(-9.0, 6.4, 0)), wall)
    obj('_mw_front_l', S.box(2.4, T, C, 0.0, 0, base=(-7.8, 4.45, 0)), wall)
    obj('_mw_front_r', S.box(2.4, T, C, 0.0, 0, base=(-4.2, 4.45, 0)), wall)
    obj('_mw_right', S.box(T, 4.0, C, 0.0, 0, base=(-3.0, 6.4, 0)), wall)
    obj('_mw_cornice', S.box(6.2, 0.3, 0.2, 0.0, 0, base=(-6.0, 8.3, H)), wall)


def layout(sc: Scene):
    n = sc.night
    P = sc.place
    # mausoleum interior: vault stairs, pews, candelabras, window, door
    P('stairs_crypt', -6.0, 7.1, 0)
    P('pew_salvaged', -7.9, 5.7, 180, lib='objects')
    P('candelabra_drippy', -8.5, 7.8, 0, lib='objects', show=('flame',) if n else (),
      light=((0, 0, 1.4), '#ffb35a', 25) if n else None)
    P('candelabra_drippy', -3.5, 7.8, 0, lib='objects', show=('flame',) if n else (),
      light=((0, 0, 1.4), '#ffb35a', 25) if n else None)
    P('window_gothic', -7.5, 8.24, 0, lib='objects')
    P('den_stray_cat', -2.3, 7.6, -20)
    # Old Section: two rows of marked graves (all four headstone variants), obelisk, dead fern
    vids = ['grave_marked_rounded', 'grave_marked_cross', 'grave_marked_scroll', 'grave_marked_slab']
    for row, y in enumerate((2.6,)):
        for k, x in enumerate((-9.0, -7.5, -6.0, -4.5, -3.0)):
            P(vids[(k + row) % 4], x, y, 0, show=('flag',) if (k in (1, 3)) else ())
    P('obelisk_founder', -1.8, 6.2, 0)
    P('plant_deadfern', -2.0, 4.6, 0, lib='objects')
    # Potter's Field: soft mounds (two turned, one blessed at night), compost heap, tool rack, mower
    for k, x in enumerate((-9.0, -7.5, -6.0, -4.5, -3.0)):
        for row, y in enumerate((-2.0, -4.6)):
            show = ()
            if (k, row) in ((1, 0), (3, 1)):
                show = ('turned',)
            if n and (k, row) == (2, 0):
                show = ('glow',)
            P('mound_soft', x, y, 0, show=show)
    P('heap_compost', -1.9, -5.8, 0, show=('steam',) if not n else ())
    P('rack_tools', -10.3, -6.0, 90)
    P('mower_mulchmaster', -9.4, 0.0, 0)
    P('carry_shovel', -7.1, -2.25, 0, z=0.5, scale=1.0)
    P('curio_pocketWatch', -7.1, -2.95, 30)
    P('curio_tarnishedLocket', -2.6, -4.9, 0)
    # Willow Pond with reeds + the weeping willow, a lantern, a bench
    P('pond_murky', 5.5, 5.0, 0, show=('glow',) if n else ())
    for (x, y) in ((2.2, 4.0), (2.6, 6.9), (8.9, 6.6), (8.4, 2.8)):
        P('reeds_cattail', x, y, (x * 37) % 360)
    P('tree_willow', 9.6, 1.9, 20)
    P('item_fish_deep', 6.3, 2.6, 30)
    P('lantern_post', 1.5, 3.2, 0, lib='objects', show=('bulb',), light=((0, 0, 2.2), '#ffb35a', 90) if n else None)
    P('lantern_post', -1.5, -2.6, 0, lib='objects', light=((0, 0, 2.2), '#ffb35a', 90) if n else None)
    P('lantern_post', 1.5, -6.1, 0, lib='objects', light=((0, 0, 2.2), '#ffb35a', 90) if n else None)
    # Moon Circle + picnic lawn: séance (lit at night), firepit, bench, vending machine, notice board, dens, bins
    P('circle_seance', 5.0, -3.0, 0, show=('flame', 'glow') if n else (),
      light=((0, 0, 0.5), '#ffb35a', 60) if n else None)
    P('firepit_grill', 9.0, -5.2, 0, show=('flame',), light=((0, 0, 0.4), '#ff8a3a', 120 if n else 20))
    P('bench_gothic', 3.2, -6.4, 0)
    P('vending_gravecola', 10.4, -1.5, -90, light=((0, -0.5, 1.0), '#ffb070', 30) if n else None)
    P('board_notice', 2.2, -6.9, 10)
    P('den_stray_dog', 7.4, -6.6, 15)
    P('trash_lidded', 10.4, -3.2, -90, lib='objects')
    P('den_stray_raccoon', 10.6, -4.3, -100)
    P('tree_gnarled', -11.5, 2.5, 30, lib='objects')
    # boundary: iron fence with the double gate at the avenue, back fence, dressing beyond
    for k in range(-12, 12):
        x = k + 0.5
        if x in (-0.5, 0.5):
            P('gate_iron', x, -7.0, 0)
        else:
            P('fence_iron', x, -7.0, 0)
        P('fence_iron', x, 9.4, 0)
    for k, (x, y) in enumerate(((-9, 11.2), (-4, 11.5), (1.5, 11.0), (6.5, 11.6), (11, 11.0))):
        P('env_gravestones', x, y, (k * 40) % 360, lib='objects')
    for k, (x, y) in enumerate(((-12, 13), (-7, 14), (3, 14.5), (9, 13.5), (13, 12.5), (-2, 15.5))):
        P('env_tree_b', x, y, k * 50, lib='objects', scale=1.15)
    P('env_spire', 4.0, 30.0, 0)


def lights_world(sc: Scene):
    scn = bpy.context.scene
    world = bpy.data.worlds.new('_d_world')
    scn.world = world
    nt = world.node_tree
    if nt is None:
        world.use_nodes = True
        nt = world.node_tree
    bg = next(n for n in nt.nodes if n.type == 'BACKGROUND')
    sun = bpy.data.lights.new('_d_sun', 'SUN')
    if sc.night:
        bg.inputs['Color'].default_value = (*hex_to_linear('#2e2648'), 1)
        bg.inputs['Strength'].default_value = 0.9
        sun.color = hex_to_linear('#b8c4e0')
        sun.energy = 0.9
        sun.angle = math.radians(4)
        rot = (math.radians(55), 0, math.radians(150))
    else:
        bg.inputs['Color'].default_value = (*hex_to_linear('#a7ada8'), 1)
        bg.inputs['Strength'].default_value = 0.9
        sun.color = hex_to_linear('#e9dcc4')
        sun.energy = 2.6
        sun.angle = math.radians(14)
        rot = (math.radians(52), 0, math.radians(-38))
    ob = bpy.data.objects.new('_d_sun', sun)
    ob.rotation_euler = rot
    scn.collection.objects.link(ob)
    for i, (p, col, w) in enumerate(sc.lights):
        L = bpy.data.lights.new(f'_d_pl{i}', 'POINT')
        L.color = hex_to_linear(col)
        L.energy = w
        L.shadow_soft_size = 0.15
        o = bpy.data.objects.new(f'_d_pl{i}', L)
        o.location = p
        scn.collection.objects.link(o)
    if sc.night:  # low ground mist sheets (render-only stand-in for the game's mist plane)
        mist = _mat('_d_mist', '#9aa8c8', 0.9, alpha=0.1, double_sided=True)
        from common import shapes as S
        for k, z in enumerate((0.12, 0.3)):
            bm = S.box(40, 30, 0.001, 0.0, 0, base=(0, 3, z))
            me = bpy.data.meshes.new(f'_mist{k}')
            bm.to_mesh(me)
            bm.free()
            me.materials.append(mist)
            o = bpy.data.objects.new(f'_mist{k}', me)
            scn.collection.objects.link(o)


def camera(target=(0.4, -0.6, 0.0), az=30.0, el=42.0, dist=25.5, lens=34.0):
    cam = bpy.data.cameras.new('_d_cam')
    cam.lens = lens
    cam.clip_end = 300
    ob = bpy.data.objects.new('_d_cam', cam)
    bpy.context.scene.collection.objects.link(ob)
    a, e = math.radians(az), math.radians(el)
    d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    ob.location = Vector(target) + d * dist
    ob.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = ob


def render(time: str, src: Path, out: Path, res, samples: int) -> Path:
    export.reset_scene()
    sc = Scene(src, time == 'night')
    ground(sc)
    layout(sc)
    lights_world(sc)
    camera()
    configure_cycles(res[0], samples, threads=4)
    scn = bpy.context.scene
    scn.render.resolution_x, scn.render.resolution_y = res
    scn.cycles.max_bounces = 6
    scn.cycles.transparent_max_bounces = 16
    p = out / f'diorama_{time}.png'
    out.mkdir(parents=True, exist_ok=True)
    scn.render.filepath = str(p)
    with export.quiet():
        bpy.ops.render.render(write_still=True)
    return p


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--time', default='both', choices=('day', 'night', 'both'))
    ap.add_argument('--src', default=str(ROOT / 'public' / 'assets'))
    ap.add_argument('--res', default='1600x900')
    ap.add_argument('--samples', type=int, default=32)
    ap.add_argument('--out', default=str(ROOT / 'tools' / 'blender' / 'out' / 'levels' / 'graveyard'))
    if argv is None:
        argv = sys.argv[1:]
        if '--' in argv:
            argv = argv[argv.index('--') + 1:]
    a = ap.parse_args(argv)
    res = tuple(int(v) for v in a.res.split('x'))
    times = ('day', 'night') if a.time == 'both' else (a.time,)
    for t in times:
        p = render(t, Path(a.src), Path(a.out), res, a.samples)
        print(f'wrote {p}', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
