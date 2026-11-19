#!/usr/bin/env python
"""Independent review of the published cast bodies (does NOT import tools/blender/cast/lib).

Poses every published cast GLB with zombie.glb's clips through the runtime rule as WRITTEN in
docs/contract-requests/cast.md §2 (numpy LBS straight from the GLB data - what three.js will do), measures contacts
against stand-in furniture built from the real object specs (src/shared/catalog.ts slot poses + object bounds), and
renders Cycles panels for a visual read.

    /home/user/.venvs/blender/bin/python tools/blender/cast/verify/verify_cast.py --out DIR [--only a,b] [--no-render]
        [--assets public/assets]  (GLBs + manifest.cast.json to check; default the published ones)
Then compose the sheets (system python with PIL):  python3 tools/blender/cast/verify/compose.py DIR

Stand-ins (character-local, metres, glTF axes: +Y up, +Z = the body's front):
  chair_creaky   seat box x +-0.24, z [-0.267, 0.23], top 0.46 (SEAT_HEIGHT); back panel z [-0.267, -0.22] to 0.95
  table          top 0.76 (TABLE_HEIGHT), z [0.30, 1.10] in front of the chair (plate check)
  bed_normal     mattress x +-0.45, z [-1.035, 0.935] (lie0 slot), top 0.42: the renderer lifts the rig root to BED_HEIGHT
  counter        front face z 0.297 (frontStands inset 0.22 + counter_butcher bounds), top 0.92 (COUNTER_HEIGHT)
  door           2.10 x 0.86 opening (DIM.DOOR_HEIGHT / DOOR_WIDTH)
  hug partner    1 m away facing this body (contract §5 Socials), both playing 'hug'
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from gltfnp import Clips, Glb, SkinnedMesh, qmul, rest_local, world_mats  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
ZOMBIE = os.path.join(ROOT, 'public', 'assets', 'models', 'characters', 'zombie.glb')
SEAT_H, TABLE_H, BED_H, COUNTER_H, DOOR_H, DOOR_W = 0.46, 0.76, 0.42, 0.92, 2.10, 0.86
SEAT = dict(x=0.24, z0=-0.267, z1=0.23)
BACK_Z = -0.22
BED = dict(x=0.45, z0=-1.035, z1=0.935)
COUNTER_Z = 0.297
SIT_CLIPS = ('sit', 'sitEat', 'sitTalk', 'sitTV', 'sitComputer', 'sitRead', 'sitChess')
UPRIGHT = ('idle', 'walk', 'talk', 'listen', 'cheer', 'dance', 'wave', 'stretch', 'angry', 'shower', 'admire', 'phone')
CLASSIC_MESHES = ('Head', 'Torso', 'ArmUpper_L', 'ArmUpper_R', 'ArmLower_L', 'ArmLower_R', 'Hand_L', 'Hand_R',
                  'LegUpper_L', 'LegUpper_R', 'LegLower_L', 'LegLower_R', 'Foot_L', 'Foot_R')


# =============================================================================================== posing
class Poser:
    """A skinned body + the runtime rule. classic=True plays every track as authored (zombie.glb itself)."""

    def __init__(self, g: Glb, clips: Clips, entry: dict | None, rule: dict | None, mesh_names=None):
        self.g, self.clips, self.entry, self.rule = g, clips, entry, rule
        self.rest = rest_local(g)
        mesh_nodes = [i for i, n in enumerate(g.nodes) if 'mesh' in n and 'skin' in n and
                      (mesh_names is None or n.get('name') in mesh_names)]
        self.meshes = [SkinnedMesh(g, i) for i in mesh_nodes]
        self.classic = entry is None
        off, tris, dom, pos = 0, [], [], []
        for m in self.meshes:
            tris.append(m.tri + off); off += len(m.pos)
            dom.append(np.array([m.jnames[j] for j in m.dominant_joint()]))
            pos.append(m.pos)
        self.tri, self.dom, self.restv = np.concatenate(tris), np.concatenate(dom), np.concatenate(pos)

    def posed(self, clip, t=0.0):
        vs, W = self.pose(clip, t)
        return np.concatenate(vs), W

    def locals_at(self, clip: str, t: float) -> dict:
        g, L = self.g, dict(self.rest)
        sit = clip in SIT_CLIPS
        for i, n in enumerate(g.nodes):
            name = n.get('name')
            if name is None:
                continue
            q = self.clips.sample(clip, name, 'rotation', t)
            tr = list(n.get('translation', [0, 0, 0]))
            sc = list(n.get('scale', [1, 1, 1]))
            if q is None and not self.classic:
                continue
            if q is None:
                q = n.get('rotation', [0, 0, 0, 1])
            if self.classic:
                p = self.clips.sample(clip, name, 'translation', t)
                s = self.clips.sample(clip, name, 'scale', t)
                tr = p if p is not None else tr
                sc = s if s is not None else sc
            else:
                e = self.entry
                if sit and name in ('thigh_L', 'thigh_R') and e.get('sitThighLift', 0):
                    a = math.radians(-e['sitThighLift'])
                    q = qmul([math.sin(a / 2), 0, 0, math.cos(a / 2)], q)
                if name == 'pelvis':
                    p = self.clips.sample(clip, 'pelvis', 'translation', t)
                    if p is not None:
                        tr = self.remap(np.asarray(p), clip)
            M = np.eye(4)
            from gltfnp import qmat
            M[:3, :3] = qmat(q) * np.asarray(sc, float)
            M[:3, 3] = tr
            L[i] = M
        return L

    def remap(self, p: np.ndarray, clip: str) -> np.ndarray:
        r, e = self.rule, self.entry
        if clip in r['sitClips']:
            return p + np.asarray(e['seatPelvisOffset'])
        P0 = np.asarray(r['zombiePelvisRest'])
        w = min(1.0, max(0.0, (r['lyingY0'] - p[1]) / r['lyingSpan']))
        return np.asarray(e['pelvisRest']) + (p - P0) * e['pelvisScale'] + np.asarray(e['lyingOffset']) * w

    def pose(self, clip: str | None, t: float = 0.0):
        L = self.rest if clip is None else self.locals_at(clip, t)
        W = world_mats(self.g, L)
        return [m.skin_with(W) for m in self.meshes], W

    def joint(self, W: dict, name: str) -> np.ndarray:
        return W[self.g.byname[name]]


# =============================================================================================== metrics
def r3(x) -> float:
    return round(float(x), 3)


def in_box(v, x, z0, z1, y0, y1):
    return (np.abs(v[:, 0]) < x) & (v[:, 2] > z0) & (v[:, 2] < z1) & (v[:, 1] > y0) & (v[:, 1] < y1)


def edge_stretch(rest: np.ndarray, posed: np.ndarray, tri: np.ndarray) -> dict:
    e = np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]])
    e = np.unique(np.sort(e, 1), axis=0)
    l0 = np.linalg.norm(rest[e[:, 0]] - rest[e[:, 1]], axis=1)
    l1 = np.linalg.norm(posed[e[:, 0]] - posed[e[:, 1]], axis=1)
    ok = l0 > 1e-4
    r = l1[ok] / l0[ok]
    return {'max': r3(r.max()), 'min': r3(r.min()), 'n_over_2': int((r > 2.0).sum()), 'n_under_0_35': int((r < 0.35).sum())}


def body_metrics(P: Poser, entry: dict, Pz: Poser) -> dict:
    rest, dom, tri = P.restv, P.dom, P.tri
    legs = np.isin(dom, ['shin_L', 'shin_R', 'foot_L', 'foot_R'])
    feet = legs & (rest[:, 1] < 0.12)
    hands = np.isin(dom, ['hand_L', 'hand_R', 'forearm_L', 'forearm_R'])
    torso = np.isin(dom, ['pelvis', 'spine', 'chest'])
    head = np.isin(dom, ['head', 'neck'])
    out = {'height': r3(rest[:, 1].max()), 'width': r3(np.ptp(rest[:, 0])), 'depth': r3(np.ptp(rest[:, 2]))}
    # front direction: toes ahead of the ankle, face ahead of the neck
    _, W0 = P.pose(None)
    ank = P.joint(W0, 'foot_L')[:3, 3]
    out['front'] = {'toes_dz': r3(rest[feet, 2].max() - ank[2]),
                    'face_dz': r3(rest[head, 2].max() - P.joint(W0, 'head')[:3, 3][2]),
                    'back_dz': r3(P.joint(W0, 'head')[:3, 3][2] - rest[head, 2].min())}
    clips = P.clips
    # ---- standing / walking
    st = {}
    stretch_worst = {}
    for clip in UPRIGHT + ('cook', 'hug', 'sit', 'sitEat', 'sleep', 'mourn', 'exercise', 'pickup', 'clean'):
        d = clips.duration(clip)
        fmin, fcontact, top, sw = 9, -9, -9, None
        for k in range(8):
            v, W = P.posed(clip, d * k / 8)
            fy = v[feet, 1].min()
            fmin = min(fmin, fy); fcontact = max(fcontact, fy); top = max(top, v[:, 1].max())
            s = edge_stretch(rest, v, tri)
            if sw is None or s['max'] > sw['max']:
                sw = dict(s, t=r3(d * k / 8))
        if clip in UPRIGHT:
            st[clip] = {'feet_min': r3(fmin), 'feet_lowest_max': r3(fcontact), 'top': r3(top)}
        if clip in ('idle', 'walk'):
            for k in range(8):
                v, W = P.posed(clip, d * k / 8)
                out['walk_head_top'] = max(out.get('walk_head_top', 0), r3(v[head, 1].max()))
        stretch_worst[clip] = sw
    out['upright'] = st
    out['stretch'] = stretch_worst
    out['door_clear'] = r3(DOOR_H - out['walk_head_top'])          # head/headwear while idling / walking
    out['arms_up_top'] = r3(max(s['top'] for s in st.values()))     # cheer / stretch (hands above the head)
    out['door_width_clear'] = r3(DOOR_W - out['width'])
    # ---- sit (all 7 clips): seat sink / float, back, feet, shins through the seat front
    sit = {}
    for clip in SIT_CLIPS:
        d = clips.duration(clip)
        worst = {}
        for k in range(6):
            v, W = P.posed(clip, d * k / 6)
            fp = (np.abs(v[:, 0]) < SEAT['x']) & (v[:, 2] > SEAT['z0']) & (v[:, 2] < SEAT['z1'])
            seat_band = fp & (v[:, 1] < SEAT_H + 0.15) & ~legs
            low = v[seat_band, 1].min() if seat_band.any() else 9
            # the seat slab (top 6 cm of the seat; the chair is open underneath): shins / feet through it
            shins_in = in_box(v, SEAT['x'], SEAT['z0'] + 0.02, SEAT['z1'] - 0.01, SEAT_H - 0.06, SEAT_H - 0.01) & legs
            hip = fp & np.isin(dom, ['pelvis', 'thigh_L', 'thigh_R']) & (v[:, 2] < SEAT['z1'] - 0.04)
            back_in = (np.abs(v[:, 0]) < SEAT['x']) & (v[:, 2] < BACK_Z - 0.01) & (v[:, 2] > SEAT['z0']) & \
                (v[:, 1] > SEAT_H) & (v[:, 1] < 0.95)
            vals = {'seat_low': low, 'feet_min': v[feet, 1].min(), 'feet_max_low': v[feet, 1].min(),
                    'shin_in_seat': int(shins_in.sum()), 'back_in': int(back_in.sum()),
                    'sink_verts': int((fp & (v[:, 1] < SEAT_H - 0.075)).sum()),
                    'hip_low': float(v[hip, 1].min()) if hip.any() else 9.0}
            for kk, vv in vals.items():
                if kk in ('feet_min', 'seat_low', 'hip_low'):
                    worst[kk] = min(worst.get(kk, 9), vv)
                elif kk == 'feet_max_low':
                    worst[kk] = max(worst.get(kk, -9), vv)
                else:
                    worst[kk] = max(worst.get(kk, 0), vv)
        sit[clip] = {k: (r3(v) if isinstance(v, float) else v) for k, v in worst.items()}
    out['sit'] = sit
    # ---- sitEat plate
    a = entry['carryAnchors'].get('sitEat')
    if a:
        d = clips.duration('sitEat')
        res = []
        for k in range(6):
            v, W = P.posed('sitEat', d * k / 6)
            A = P.joint(W, a['bone']) @ np.array(a['matrix']).reshape(4, 4).T
            c = A[:3, 3]
            hv = v[dom == a['bone']]
            dist = np.linalg.norm(hv - c, axis=1).min()
            # body verts (not that hand) inside the plate disc volume (r 0.11, +-2 cm)
            rel = (v - c) @ A[:3, :3]
            inside = (np.hypot(rel[:, 0], rel[:, 2]) < 0.11) & (np.abs(rel[:, 1]) < 0.02) & (dom != a['bone'])
            fork = None
            if 'extra' in a:
                F = P.joint(W, a['extra']['bone']) @ np.array(a['extra']['matrix']).reshape(4, 4).T
                fv = v[dom == a['extra']['bone']]
                fork = np.linalg.norm(fv - F[:3, 3], axis=1).min()
            res.append((dist, c[1], int(inside.sum()), A[:3, 1][1], fork, c[2]))
        out['plate'] = {'hand_gap_max': r3(max(r[0] for r in res)), 'y_range': [r3(min(r[1] for r in res)), r3(max(r[1] for r in res))],
                        'body_in_plate_max': max(r[2] for r in res), 'level_min_cos': r3(min(r[3] for r in res)),
                        'fork_gap_max': r3(max(r[4] for r in res)) if res[0][4] is not None else None,
                        'z_range': [r3(min(r[5] for r in res)), r3(max(r[5] for r in res))]}
    # open book (read / sitRead): centre must not sit inside the body (belly)
    for an in ('read', 'sitRead'):
        a = entry['carryAnchors'].get(an)
        if not a:
            continue
        import bpy  # noqa: F401
        from mathutils import Vector
        from mathutils.bvhtree import BVHTree
        d = clips.duration(an)
        worst = {'inside': 0, 'hand_gap_max': 0.0, 'surf_gap_min': 9.0}
        for k in range(4):
            v, W = P.posed(an, d * k / 4)
            A = P.joint(W, a['bone']) @ np.array(a['matrix']).reshape(4, 4).T
            c = Vector(A[:3, 3])
            tb = BVHTree.FromPolygons([Vector(p) for p in v], tri.tolist())
            hits, o = 0, c.copy()
            for _ in range(16):
                h = tb.ray_cast(o, Vector((0, 0, 1)))
                if h[0] is None:
                    break
                hits += 1
                o = h[0] + Vector((0, 0, 1e-4))
            worst['inside'] = max(worst['inside'], hits % 2)
            worst['surf_gap_min'] = min(worst['surf_gap_min'], tb.find_nearest(c)[3])
            worst['hand_gap_max'] = max(worst['hand_gap_max'], float(np.linalg.norm(v[hands] - A[:3, 3], axis=1).min()))
        out[an] = {k: (r3(v) if isinstance(v, float) else v) for k, v in worst.items()}
    # phone at the ear
    a = entry['carryAnchors'].get('phone')
    if a:
        d = clips.duration('phone')
        gaps = []
        for k in range(6):
            v, W = P.posed('phone', d * k / 6)
            A = P.joint(W, a['bone']) @ np.array(a['matrix']).reshape(4, 4).T
            gaps.append((np.linalg.norm(v[dom == a['bone']] - A[:3, 3], axis=1).min(),
                         np.linalg.norm(v[head] - A[:3, 3], axis=1).min()))
        out['phone'] = {'hand_gap_max': r3(max(g[0] for g in gaps)), 'head_gap_min': r3(min(g[1] for g in gaps)),
                        'head_gap_max': r3(max(g[1] for g in gaps))}
    # ---- sleep (root lifted to BED_HEIGHT: measure relative to the mattress top = rig y 0)
    lie = {}
    for clip in ('sleep', 'beEmbalmed'):
        d = clips.duration(clip)
        mins, sinks, zs, hz = [], [], [], []
        for k in range(4):
            v, W = P.posed(clip, d * k / 4)
            on = (np.abs(v[:, 0]) < BED['x'])
            mins.append(v[:, 1].min())
            sinks.append(int((v[:, 1] < -0.03).sum()))
            zs.append((v[:, 2].min(), v[:, 2].max()))
            hz.append(P.joint(W, 'head')[:3, 3][2] - P.joint(W, 'pelvis')[:3, 3][2])
        lie[clip] = {'min_y': r3(min(mins)), 'max_min_y': r3(max(mins)), 'sink_verts': max(sinks),
                     'z': [r3(min(z[0] for z in zs)), r3(max(z[1] for z in zs))], 'head_minus_pelvis_z': r3(max(hz))}
    out['lie'] = lie
    # ---- cook at the counter
    d = clips.duration('cook')
    ci = {'hand_in': 0, 'body_in': 0, 'hand_depth': 0.0, 'body_depth': 0.0, 'hand_min_y_over_counter': 9}
    for k in range(10):
        v, W = P.posed('cook', d * k / 10)
        box = (v[:, 2] > COUNTER_Z) & (v[:, 1] < COUNTER_H) & (np.abs(v[:, 0]) < 0.5)
        hb, bb = box & hands, box & ~hands
        ci['hand_in'] = max(ci['hand_in'], int(hb.sum()))
        ci['body_in'] = max(ci['body_in'], int(bb.sum()))
        if hb.any():
            ci['hand_depth'] = max(ci['hand_depth'], float(np.minimum(COUNTER_H - v[hb, 1], v[hb, 2] - COUNTER_Z).max()))
        if bb.any():
            ci['body_depth'] = max(ci['body_depth'], float(np.minimum(COUNTER_H - v[bb, 1], v[bb, 2] - COUNTER_Z).max()))
        over = hands & (v[:, 2] > COUNTER_Z)
        if over.any():
            ci['hand_min_y_over_counter'] = min(ci['hand_min_y_over_counter'], float(v[over, 1].min()))
        ci.setdefault('hand_reach_z', 0.0)
        ci['hand_reach_z'] = max(ci['hand_reach_z'], float(v[hands, 2].max()))
    out['cook'] = {k: (r3(v) if isinstance(v, float) else v) for k, v in ci.items()}
    return out


def hug_overlap(P: Poser, t: float) -> dict:
    """Two copies 1 m apart facing each other; count A-vertices inside B's closed surface (ray parity, approx)."""
    import bpy  # noqa: F401  (mathutils needs bpy loaded)
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    v, _ = P.posed('hug', t)
    tri = P.tri
    B = v.copy(); B[:, 0] *= -1; B[:, 2] = 1.0 - B[:, 2]          # rotate 180 deg about Y, then 1 m along +Z
    tb = BVHTree.FromPolygons([Vector(p) for p in B], tri.tolist())
    ta = BVHTree.FromPolygons([Vector(p) for p in v], tri.tolist())
    pairs = ta.overlap(tb)
    # penetration depth proxy: A-vertices inside B (odd ray-hit parity along +X), and their distance to B's surface
    inside = []
    for i in range(0, len(v), 3):
        p = Vector(v[i])
        if abs(p.z - 0.5) > 0.45:
            continue
        hits, o = 0, p.copy()
        for _ in range(12):
            h = tb.ray_cast(o, Vector((1, 0, 0)))
            if h[0] is None:
                break
            hits += 1
            o = h[0] + Vector((1e-4, 0, 0))
        if hits % 2 == 1:
            n = tb.find_nearest(p)
            inside.append(n[3])
    return {'tri_pairs': len(pairs), 'verts_inside': len(inside) * 3,
            'max_depth': r3(max(inside) if inside else 0.0)}


# =============================================================================================== blender scene
def bl(v: np.ndarray) -> np.ndarray:
    return np.stack([v[:, 0], -v[:, 2], v[:, 1]], 1)


class Stage:
    def __init__(self, tmpdir: str, samples: int):
        import bpy
        self.bpy = bpy
        self.tmp = tmpdir
        bpy.ops.wm.read_factory_settings(use_empty=True)
        sc = bpy.context.scene
        sc.render.engine = 'CYCLES'
        sc.cycles.device = 'CPU'
        sc.cycles.samples = samples
        sc.cycles.use_adaptive_sampling = False
        sc.cycles.use_denoising = True
        sc.cycles.max_bounces = 3
        sc.view_settings.view_transform = 'Standard'
        sc.render.film_transparent = False
        sc.render.image_settings.file_format = 'PNG'
        w = bpy.data.worlds.new('W'); sc.world = w; w.use_nodes = True
        w.node_tree.nodes['Background'].inputs[0].default_value = (0.35, 0.37, 0.42, 1)
        w.node_tree.nodes['Background'].inputs[1].default_value = 0.6
        sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
        sun.data.energy = 3.2
        sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
        sc.collection.objects.link(sun)
        cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
        sc.collection.objects.link(cam); sc.camera = cam
        self.cam = cam
        self.dyn = []
        self.mats = {}
        self.grey = self.flat('grey', (0.55, 0.55, 0.55))
        # furniture stand-ins are see-through so penetration stays visible
        self.wood = self.flat('wood', (0.45, 0.30, 0.18), 0.45)
        self.cloth = self.flat('mattress', (0.65, 0.68, 0.75), 0.45)
        self.stone = self.flat('counter', (0.50, 0.52, 0.50), 0.45)
        self.plate = self.flat('plate', (0.95, 0.92, 0.85))
        self.red = self.flat('red', (0.8, 0.1, 0.1))
        self.floor = self.flat('floor', (0.30, 0.28, 0.26))
        self.add_box('Floor', (-6, 6), (-6, 6), (-0.02, 0.0), self.floor, keep=True)

    def flat(self, name, rgb, alpha=1.0):
        bpy = self.bpy
        m = bpy.data.materials.new(name); m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*rgb, 1)
        b.inputs['Roughness'].default_value = 0.8
        if alpha < 1:
            b.inputs['Alpha'].default_value = alpha
        return m

    def body_material(self, g: Glb, key: str):
        if key in self.mats:
            return self.mats[key]
        bpy = self.bpy
        mdef = g.js['materials'][0]
        pbr = mdef.get('pbrMetallicRoughness', {})
        m = bpy.data.materials.new('Body_' + key); m.use_nodes = True
        nt = m.node_tree
        b = nt.nodes['Principled BSDF']

        def tex(info, non_color):
            ti = g.js['textures'][info['index']]['source']
            p = os.path.join(self.tmp, f'{key}_{ti}.jpg')
            with open(p, 'wb') as fh:
                fh.write(g.image_bytes(ti))
            img = bpy.data.images.load(p)
            if non_color:
                img.colorspace_settings.name = 'Non-Color'
            n = nt.nodes.new('ShaderNodeTexImage'); n.image = img
            return n
        if 'baseColorTexture' in pbr:
            nt.links.new(tex(pbr['baseColorTexture'], False).outputs['Color'], b.inputs['Base Color'])
        if 'metallicRoughnessTexture' in pbr:
            t = tex(pbr['metallicRoughnessTexture'], True)
            sep = nt.nodes.new('ShaderNodeSeparateColor')
            nt.links.new(t.outputs['Color'], sep.inputs['Color'])
            nt.links.new(sep.outputs['Green'], b.inputs['Roughness'])
            nt.links.new(sep.outputs['Blue'], b.inputs['Metallic'])
        if 'normalTexture' in mdef:
            t = tex(mdef['normalTexture'], True)
            nm = nt.nodes.new('ShaderNodeNormalMap')
            nt.links.new(t.outputs['Color'], nm.inputs['Color'])
            nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
        self.mats[key] = m
        return m

    def add_mesh(self, name, verts_gl, tri, uv=None, mat=None, xform=None):
        bpy = self.bpy
        v = verts_gl.copy()
        if xform is not None:
            v = v @ xform[:3, :3].T + xform[:3, 3]
        me = bpy.data.meshes.new(name)
        me.from_pydata(bl(v).tolist(), [], tri.tolist())
        if uv is not None:
            lay = me.uv_layers.new(name='UV')
            lv = np.empty(len(me.loops), np.int64); me.loops.foreach_get('vertex_index', lv)
            u = uv[lv].copy(); u[:, 1] = 1 - u[:, 1]
            lay.data.foreach_set('uv', u.ravel())
        me.shade_smooth()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        if mat:
            me.materials.append(mat)
        self.dyn.append(ob)
        return ob

    def add_box(self, name, xr, zr, yr, mat, keep=False):
        """Box from glTF-space ranges."""
        bpy = self.bpy
        x0, x1 = xr; z0, z1 = zr; y0, y1 = yr
        corners = np.array([[x, y, z] for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)], float)
        faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
        me = bpy.data.meshes.new(name)
        me.from_pydata(bl(corners).tolist(), [], faces)
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        me.materials.append(mat)
        if not keep:
            self.dyn.append(ob)
        return ob

    def add_disc(self, name, A: np.ndarray, r: float, mat, thick=0.012):
        n = 24
        ang = np.linspace(0, 2 * math.pi, n, endpoint=False)
        ring = np.stack([np.cos(ang) * r, np.zeros(n), np.sin(ang) * r], 1)
        v = np.concatenate([ring + [0, thick / 2, 0], ring - [0, thick / 2, 0]])
        v = v @ A[:3, :3].T + A[:3, 3]
        faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))] + \
            [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
        bpy = self.bpy
        me = bpy.data.meshes.new(name); me.from_pydata(bl(v).tolist(), [], faces)
        ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
        me.materials.append(mat); self.dyn.append(ob)

    def clear(self):
        bpy = self.bpy
        for o in self.dyn:
            me = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            bpy.data.meshes.remove(me)
        self.dyn = []

    def shoot(self, path, eye_gl, look_gl, lens=50, res=(400, 520)):
        from mathutils import Vector
        sc = self.bpy.context.scene
        sc.render.resolution_x, sc.render.resolution_y = res
        e = Vector(bl(np.array([eye_gl]))[0]); t = Vector(bl(np.array([look_gl]))[0])
        self.cam.location = e
        self.cam.rotation_euler = (t - e).to_track_quat('-Z', 'Y').to_euler()
        self.cam.data.lens = lens
        sc.render.filepath = path
        self.bpy.ops.render.render(write_still=True)


def render_body(S: Stage, P: Poser, Pz: Poser, entry: dict, outdir: str, bid: str):
    mat = S.grey if P.classic else S.body_material(P.g, bid)
    H = float(P.restv[:, 1].max())
    cl = P.clips
    shots = []

    def body(name, clip, t, xf=None):
        vs, W = P.pose(clip, t)
        for i, (v, m) in enumerate(zip(vs, P.meshes)):
            S.add_mesh(f'{name}{i}', v, m.tri, None if P.classic else m.uv, mat, xf)
        return np.concatenate(vs), W

    def X(tx=0.0, tz=0.0, rot=0.0):
        c, s = math.cos(rot), math.sin(rot)
        M = np.eye(4); M[:3, :3] = [[c, 0, s], [0, 1, 0], [-s, 0, c]]; M[:3, 3] = [tx, 0, tz]
        return M
    # 1 door + classic for scale (front)
    body('b', 'idle', 0.0)
    for zm in Pz.meshes:
        pass
    vz, _ = Pz.pose('idle', 0.0)
    for i, zm in enumerate(Pz.meshes):
        S.add_mesh(f'z{i}', vz[i], zm.tri, None, S.grey, X(0.95))
    S.add_box('jambL', (-DOOR_W / 2 - 0.08, -DOOR_W / 2), (-0.06, 0.06), (0, DOOR_H), S.wood)
    S.add_box('jambR', (DOOR_W / 2, DOOR_W / 2 + 0.08), (-0.06, 0.06), (0, DOOR_H), S.wood)
    S.add_box('head', (-DOOR_W / 2 - 0.08, DOOR_W / 2 + 0.08), (-0.06, 0.06), (DOOR_H, DOOR_H + 0.08), S.wood)
    S.shoot(f'{outdir}/{bid}_1door.png', (0.45, 1.15, 4.6), (0.45, 1.05, 0), 40)
    S.clear()
    # 2 close-up 3/4 front (skin / clothes read)
    body('b', None, 0.0)
    S.shoot(f'{outdir}/{bid}_2face.png', (0.55, H * 0.9, 1.3), (0, H * 0.78, 0), 50)
    S.shoot(f'{outdir}/{bid}_3back.png', (-1.6, H * 0.6, -2.6), (0, H * 0.5, 0), 40)
    S.clear()
    # 4 walk: 4 phases side by side, side view
    d = cl.duration('walk')
    for k in range(4):
        body(f'w{k}', 'walk', d * k / 4, X(tx=(k - 1.5) * 0.75))
    S.shoot(f'{outdir}/{bid}_4walk.png', (0.0, 0.9, 5.2), (0.0, 0.85, 0), 35, (640, 400))
    S.clear()
    # 5 sit (side) - chair stand-in
    body('b', 'sit', cl.duration('sit') * 0.3)
    S.add_box('seat', (-SEAT['x'], SEAT['x']), (SEAT['z0'], SEAT['z1']), (0, SEAT_H), S.wood)
    S.add_box('back', (-SEAT['x'], SEAT['x']), (SEAT['z0'], BACK_Z), (SEAT_H, 0.95), S.wood)
    S.shoot(f'{outdir}/{bid}_5sit.png', (3.2, 0.75, 0.15), (0, 0.65, 0.1), 45)
    S.clear()
    # 6 sitEat: chair + table + plate/fork from the manifest anchors (3/4 front-left)
    v, W = body('b', 'sitEat', cl.duration('sitEat') * 0.35)
    S.add_box('seat', (-SEAT['x'], SEAT['x']), (SEAT['z0'], SEAT['z1']), (0, SEAT_H), S.wood)
    S.add_box('back', (-SEAT['x'], SEAT['x']), (SEAT['z0'], BACK_Z), (SEAT_H, 0.95), S.wood)
    S.add_box('table', (-0.45, 0.45), (0.25, 1.0), (TABLE_H - 0.04, TABLE_H), S.wood)
    a = entry['carryAnchors'].get('sitEat')
    if a:
        A = P.joint(W, a['bone']) @ np.array(a['matrix']).reshape(4, 4).T
        S.add_disc('plate', A, 0.11, S.plate)
        if 'extra' in a:
            F = P.joint(W, a['extra']['bone']) @ np.array(a['extra']['matrix']).reshape(4, 4).T
            # fork: thin bar along the anchor's local Y
            S.add_disc('fork', F, 0.012, S.red, 0.16)
    S.shoot(f'{outdir}/{bid}_6sitEat.png', (1.9, 1.5, 1.9), (0, 0.85, 0.15), 45)
    S.clear()
    # 7 sleep on the bed (root at BED_HEIGHT), side view
    lift = X(); lift[1, 3] = BED_H
    body('b', 'sleep', 0.0, lift)
    S.add_box('mattress', (-BED['x'], BED['x']), (BED['z0'], BED['z1']), (0, BED_H), S.cloth)
    S.shoot(f'{outdir}/{bid}_7sleep.png', (3.4, 0.9, -0.05), (0, 0.5, -0.05), 40, (560, 360))
    S.clear()
    # 8 cook at the counter (side)
    body('b', 'cook', cl.duration('cook') * 0.2)
    S.add_box('counter', (-0.5, 0.5), (COUNTER_Z, COUNTER_Z + 0.91), (0, COUNTER_H), S.stone)
    S.shoot(f'{outdir}/{bid}_8cook.png', (3.4, 1.2, 0.35), (0, 1.0, 0.35), 40)
    S.clear()
    # 9 hug pair (side)
    t = cl.duration('hug') * 0.5
    body('a', 'hug', t)
    body('b', 'hug', t, X(tz=1.0, rot=math.pi))
    S.shoot(f'{outdir}/{bid}_9hug.png', (3.6, 1.15, 0.5), (0, 1.0, 0.5), 40)
    S.clear()


def render_poses(a) -> int:
    os.makedirs(os.path.join(a.out, '_tex'), exist_ok=True)
    man = json.load(open(os.path.join(a.assets, 'manifest.cast.json')))
    clips = Clips(Glb(ZOMBIE))
    S = Stage(os.path.join(a.out, '_tex'), a.samples)
    for spec in a.pose.split(','):
        bid, clip, frac = spec.split(':')
        e = next(b for b in man['bodies'] if b['id'] == bid)
        P = Poser(Glb(os.path.join(a.assets, e['file'])), clips, e, man['pelvisRule'])
        t = clips.duration(clip) * float(frac)
        v, W = P.posed(clip, t)
        m = P.meshes[0]
        S.add_mesh('b', v, m.tri, m.uv, S.body_material(P.g, bid))
        c = v.mean(0)
        S.shoot(f'{a.out}/pose_{bid}_{clip}_{frac}_a.png', (c[0] + 1.3, c[1] + 0.5, c[2] + 2.0), tuple(c), 45)
        S.shoot(f'{a.out}/pose_{bid}_{clip}_{frac}_b.png', (c[0] - 2.4, c[1] + 0.3, c[2] - 0.2), tuple(c), 45)
        S.clear()
    return 0


# =============================================================================================== main
#: W-120 markers. Bodies whose skirt / cape carries `_HEMMASK`, and bodies whose held prop is a loose piece on a
#: prop bone. Kept here, not imported from the build, so this stays an independent check.
HEM_BODIES = {'boss', 'bride', 'business', 'fortune', 'granny'}
PROP_PIECES = {'shield': {'prop_L'}, 'streamer': {'prop_L'}, 'business': {'prop_L', 'prop_R'}, 'boss': {'prop_L'}, 'ringmaster': {'prop_L'}}


def check_markers(g, bid: str) -> None:
    """`_HEMMASK` exists only on the named bodies and lies in [0, 1]; prop bones carry vertices only on the named
    bodies, and those vertices are rigid (weight 1)."""
    prim = g.js['meshes'][0]['primitives'][0]
    at = prim['attributes']
    has = '_HEMMASK' in at
    assert has == (bid in HEM_BODIES), f'{bid}: _HEMMASK present={has}'
    assert [k for k in at if k.startswith('_')] == (['_HEMMASK'] if has else []), f'{bid}: unexpected custom attributes'
    if has:
        h = g.acc(at['_HEMMASK']).reshape(-1)
        assert h.min() >= 0.0 and h.max() <= 1.0, f'{bid}: _HEMMASK outside [0, 1] ({h.min()}, {h.max()})'
        assert abs(h.max() - 1.0) < 1e-6, f'{bid}: _HEMMASK never reaches 1'
    names = [g.nodes[i]['name'] for i in g.js['skins'][0]['joints']]
    J, W = g.acc(at['JOINTS_0']), g.acc(at['WEIGHTS_0'])
    for bone in ('prop_L', 'prop_R'):
        w = (W * (J == names.index(bone))).sum(1)
        used = bool((w > 1e-3).any())
        assert used == (bone in PROP_PIECES.get(bid, set())), f'{bid}: vertices on {bone}: {used}'
        assert not ((w > 1e-3) & (w < 0.999)).any(), f'{bid}: a vertex is only partly on {bone}'
        if used:                                       # the piece is closed: no open edge touches it
            pos = g.acc(at['POSITION'])
            _, wid = np.unique(np.round(pos * 1e5).astype(np.int64), axis=0, return_inverse=True)   # weld seam-split vertices
            wid = wid.reshape(-1)
            idx = wid[g.acc(prim['indices']).reshape(-1, 3)]
            on = set(wid[np.nonzero(w > 0.999)[0]].tolist())
            cnt = {}
            for tri in idx:
                for k in range(3):
                    a_, b_ = int(tri[k]), int(tri[(k + 1) % 3])
                    key = (a_, b_) if a_ < b_ else (b_, a_)
                    cnt[key] = cnt.get(key, 0) + 1
            open_on_prop = sum(1 for (a_, b_), n in cnt.items() if n == 1 and (a_ in on or b_ in on))
            assert open_on_prop == 0, f'{bid}: {open_on_prop} open edges touch the {bone} piece'


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--assets', default=os.path.join(ROOT, 'public', 'assets'))
    ap.add_argument('--only', default='')
    ap.add_argument('--no-render', action='store_true')
    ap.add_argument('--samples', type=int, default=12)
    ap.add_argument('--pose', default='', help='id:clip:frac[,..] -> render only these poses (front 3/4 + side)')
    a = ap.parse_args(argv)
    if a.pose:
        return render_poses(a)
    os.makedirs(a.out, exist_ok=True)
    man = json.load(open(os.path.join(a.assets, 'manifest.cast.json')))
    z = Glb(ZOMBIE)
    clips = Clips(z)
    Pz = Poser(z, clips, None, None, CLASSIC_MESHES)
    only = [s for s in a.only.split(',') if s]
    S = None if a.no_render else Stage(os.path.join(a.out, '_tex'), a.samples)
    os.makedirs(os.path.join(a.out, '_tex'), exist_ok=True)
    results = {}
    rpath = os.path.join(a.out, 'metrics.json')
    if os.path.exists(rpath) and only:
        results = json.load(open(rpath))
    # classic reference numbers (same stand-ins)
    if not only or 'classic' in only:
        zent = {'carryAnchors': json.loads(z.nodes[z.byname['Rig']]['extras']['carryAnchors'])}
        rc = body_metrics(Pz, zent, Pz)
        rc['hug'] = hug_overlap(Pz, clips.duration('hug') * 0.5)
        if S is not None:
            render_body(S, Pz, Pz, zent, a.out, '_classic')
        rc['note'] = 'classic zombie.glb base meshes (segmented: stretch/hug parity are not comparable) with their own tracks'
        results['_classic'] = rc
        print('classic', json.dumps({k: rc[k] for k in ('height', 'cook', 'plate', 'hug', 'sit')}), flush=True)
    for e in man['bodies']:
        bid = e['id']
        if only and bid not in only:
            continue
        g = Glb(os.path.join(a.assets, e['file']))
        P = Poser(g, clips, e, man['pelvisRule'])
        assert len(P.meshes) == 1
        check_markers(g, bid)
        r = body_metrics(P, e, Pz)
        r['hug'] = hug_overlap(P, clips.duration('hug') * 0.5)
        results[bid] = r
        print(bid, json.dumps({k: r[k] for k in ('height', 'front', 'door_clear', 'cook', 'plate', 'hug') if k in r}), flush=True)
        if S is not None:
            render_body(S, P, Pz, e, a.out, bid)
        with open(rpath, 'w') as fh:
            json.dump(results, fh, indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
