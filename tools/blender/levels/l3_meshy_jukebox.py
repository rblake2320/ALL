"""Adapt the retained Meshy source to the game's flat-material art contract.

No API calls at build time. The immutable textured source supplies geometry and
colour-region guidance; the shipped model contains the existing game palette,
vertex AO, recolourable Paint and a separate emissive glow node, no images/UVs.
"""
import hashlib
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector

from common import export
from .kit import node
from .l3_common import palette, box

SOURCE = Path(__file__).with_name('l3_meshy') / 'textured.glb'
SOURCE_SHA = '9661fc7222e7d81bd1a5096a5da27333ddae22f4969bbc6d59177e514efeea10'


def region(rgb):
    """Quantize semantic colour regions to the established Rot Row palette."""
    r, g, b = rgb
    if g > r * 1.5 and b > r * 1.5 and max(g, b) > .18:
        return 'RRNeonTeal'
    if r > b * 1.5 and g > r * .45 and r > .07:
        return 'Brass'
    if r > g * 2.5 and r > b * 3 and r > .15:
        return 'RRPink'
    if r > g * 1.12 and b > g * 1.1:
        return 'Paint'
    return 'RRInk'


def build(m, spec):
    if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != SOURCE_SHA:
        raise ValueError('Meshy source hash mismatch; no unreviewed source substitution')
    palette(m)
    with export.quiet():
        bpy.ops.import_scene.gltf(filepath=str(SOURCE))
    imported = list(bpy.context.scene.objects)
    meshes = [o for o in imported if o.type == 'MESH']
    if len(meshes) != 1:
        raise ValueError(f'expected one source mesh, found {len(meshes)}')
    ob = meshes[0]
    me = ob.data
    me.calc_loop_triangles()
    uv = me.uv_layers.active
    if uv is None:
        raise ValueError('source lacks UV colour-region guidance')
    samples = {}
    for i, mat in enumerate(me.materials):
        bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        links = bsdf.inputs['Base Color'].links
        if len(links) != 1 or links[0].from_node.type != 'TEX_IMAGE':
            raise ValueError('unexpected source base-colour graph')
        img = links[0].from_node.image
        w, h = img.size
        pixels = np.empty(w*h*4, dtype=np.float32)
        img.pixels.foreach_get(pixels)
        samples[i] = (w, h, pixels.reshape(h, w, 4))
    positions = [ob.matrix_world @ v.co for v in me.vertices]
    lo = Vector(tuple(min(p[k] for p in positions) for k in range(3)))
    hi = Vector(tuple(max(p[k] for p in positions) for k in range(3)))
    if hi.z-lo.z <= 0:
        raise ValueError('source has no height')
    scale = spec.height/(hi.z-lo.z)
    centre = Vector(((lo.x+hi.x)/2, (lo.y+hi.y)/2, lo.z))
    groups = {}
    for tri in me.loop_triangles:
        w, h, pixels = samples[tri.material_index]
        # Sample inside each triangle, away from UV seams. Four samples reduce
        # a single texel deciding a whole face while retaining exact topology.
        corners = [uv.data[j].uv.copy() for j in tri.loops]
        colours = []
        for weights in ((1/3,1/3,1/3),(.6,.2,.2),(.2,.6,.2),(.2,.2,.6)):
            u, v = sum((c*t for c,t in zip(corners, weights)), Vector((0,0)))
            colours.append(pixels[min(h-1,max(0,int(v*h))), min(w-1,max(0,int(u*w))), :3])
        mat = region(np.mean(colours, axis=0))
        groups.setdefault(mat, []).append(tuple(tri.vertices))
    if not groups.get('Paint') or not groups.get('RRNeonTeal'):
        raise ValueError(f'source missing required colour regions: {list(groups)}')
    node(m, 'glow', 'glow', emissiveAnimation='musicBeat')
    m.nodes[m.body].extras.update(source='Meshy', sourceTask='01a1adf4-334c-7327-8b9f-2e59dc163afa',
                                 sourceSha256=SOURCE_SHA, adaptation='flat palette; original topology plus grille and controls')
    for mat in sorted(groups):
        bm = bmesh.new()
        used = sorted({i for face in groups[mat] for i in face})
        verts = {i: bm.verts.new((positions[i]-centre)*scale) for i in used}
        for face in groups[mat]:
            bm.faces.new([verts[i] for i in face])
        bm.normal_update()
        m.add(bm, mat, 'glow' if mat == 'RRNeonTeal' else None)
    # Recover readable controls/grille as geometry rather than image textures.
    # Raycast to the retained source surface so details are attached, not floating.
    from mathutils.bvhtree import BVHTree
    points = [(p-centre)*scale for p in positions]
    tree = BVHTree.FromPolygons(points, [tuple(t.vertices) for t in me.loop_triangles], all_triangles=True)
    def front(x, z):
        hit, _, _, _ = tree.ray_cast(Vector((x, -2, z)), Vector((0, 1, 0)), 4)
        if hit is None:
            raise ValueError(f'no front surface for detail at {x},{z}')
        return hit.y-.008
    for x in (-.15,-.09,-.03,.03,.09,.15):
        y = min(front(x,z) for z in (.34,.52,.70))
        box(m,(.012,.012,.36),(x,y,.34),'Brass',b=0)
    for x in (-.21,-.105,.105,.21):
        box(m,(.045,.016,.032),(x,front(x,1.08),1.064),'RRPink',b=0)
    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)
    print('Meshy source regions:', {k:len(v) for k,v in sorted(groups.items())}, flush=True)
