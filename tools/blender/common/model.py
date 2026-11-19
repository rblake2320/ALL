"""Model assembly: named nodes (glTF nodes) made of merged bmesh parts with per-part materials.

* Geometry is always authored in MODEL space (Blender axes); a node's ``origin`` becomes its pivot (object
  location) and vertices are re-expressed relative to it at build time. Pivots matter for runtime animation:
  flames scale from their base, doors swing about the hinge, flags rotate about their pin, cones pulse about
  their centre.
* Nodes without geometry become empties (pure pivots / groups, e.g. ``door`` with the leaf as a child, or
  ``flame`` grouping five candle flames).
* ``extras`` are exported as glTF node extras -> Three.js ``Object3D.userData`` (runtime animation hints).
"""
from __future__ import annotations

import math
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

import bmesh
import bpy
from mathutils import Matrix, Vector

from .materials import MaterialLibrary
from .rng import Jitter


@dataclass
class Node:
    name: str
    parent: Optional[str] = None
    origin: Tuple[float, float, float] = (0.0, 0.0, 0.0)
    parts: List[Tuple[bmesh.types.BMesh, str]] = field(default_factory=list)
    extras: Dict[str, object] = field(default_factory=dict)
    smooth_angle: float = 42.0
    weighted: bool = True
    #: excluded from AO occlusion (transient/emissive parts) and from preview 'off' captures
    transient: bool = False


class Model:
    def __init__(self, model_id: str, paint: Optional[str] = None):
        self.id = model_id
        self.mats = MaterialLibrary(paint)
        self.rng = Jitter(model_id)
        self.nodes: 'OrderedDict[str, Node]' = OrderedDict()
        self.body = model_id
        self.node(self.body)
        self.objects: Dict[str, bpy.types.Object] = {}

    # ── authoring ──
    def node(self, name: str, parent: Optional[str] = None, origin: Sequence[float] = (0, 0, 0),
             extras: Optional[dict] = None, smooth: float = 42.0, weighted: bool = True,
             transient: bool = False) -> Node:
        if name in self.nodes:
            n = self.nodes[name]
            if extras:
                n.extras.update(extras)
            return n
        if parent is not None and parent not in self.nodes:
            raise KeyError(f'{self.id}: parent node {parent!r} not defined before {name!r}')
        if len(name) > 60:
            raise ValueError(f'node name too long: {name}')
        n = Node(name, parent, tuple(float(c) for c in origin), [], dict(extras or {}), smooth, weighted, transient)
        self.nodes[name] = n
        return n

    def add(self, bm: bmesh.types.BMesh, mat: str = 'Paint', node: Optional[str] = None) -> None:
        """Add geometry (model space) with a material look name to a node (default: the body)."""
        name = node or self.body
        if name not in self.nodes:
            self.node(name)
        self.nodes[name].parts.append((bm, mat))

    def add_many(self, items: Sequence[Tuple[bmesh.types.BMesh, str]], node: Optional[str] = None) -> None:
        for bm, mat in items:
            self.add(bm, mat, node)

    def world_origin(self, name: str) -> Vector:
        return Vector(self.nodes[name].origin)

    # ── build ──
    def build(self) -> Dict[str, bpy.types.Object]:
        scene = bpy.context.scene
        coll = scene.collection
        for n in self.nodes.values():
            if not n.parts:
                ob = bpy.data.objects.new(n.name, None)
                ob.empty_display_type = 'PLAIN_AXES'
                ob.empty_display_size = 0.05
            else:
                me = self._mesh(n)
                ob = bpy.data.objects.new(n.name, me)
            if ob.name != n.name:
                raise RuntimeError(f'{self.id}: object name clash {n.name!r} -> {ob.name!r}')
            coll.objects.link(ob)
            o = Vector(n.origin)
            if n.parent:
                parent = self.objects[n.parent]
                ob.parent = parent
                ob.matrix_parent_inverse = Matrix.Identity(4)
                ob.location = o - Vector(self.nodes[n.parent].origin)
            else:
                ob.location = o
            for k, v in n.extras.items():
                ob[k] = v
            if n.parts:
                self._shade(ob, n)
            self.objects[n.name] = ob
        return self.objects

    def _mesh(self, n: Node) -> bpy.types.Mesh:
        mats: List[str] = []
        merged = bmesh.new()
        tmp = bpy.data.meshes.new('_tmp_' + n.name)
        off = Vector(n.origin)
        for bm, mat in n.parts:
            if mat not in mats:
                mats.append(mat)
            idx = mats.index(mat)
            for f in bm.faces:
                f.material_index = idx
            bm.to_mesh(tmp)
            merged.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
        if off.length > 0:
            bmesh.ops.translate(merged, vec=-off, verts=merged.verts)
        canon = _canonical_bmesh(merged)
        merged.free()
        me = bpy.data.meshes.new(n.name)
        canon.to_mesh(me)
        canon.free()
        for name in mats:
            me.materials.append(self.mats.get(name))
        return me

    def _shade(self, ob: bpy.types.Object, n: Node) -> None:
        me = ob.data
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(n.smooth_angle))
        if n.weighted:
            mod = ob.modifiers.new('weighted', 'WEIGHTED_NORMAL')
            mod.mode = 'FACE_AREA'
            mod.weight = 50
            mod.keep_sharp = True


def _canonical_bmesh(src: bmesh.types.BMesh) -> bmesh.types.BMesh:
    """Copy of ``src`` with a canonical element order: vertices sorted by position (ties broken by their neighbours'
    positions), each face's loop rotated to start at its smallest vertex index, faces sorted.

    bmesh operators (bevel in particular) emit faces in an order that depends on memory addresses, so the same model
    came out with a different face order every run — enough float noise in Blender's normal evaluation to flip
    int8-quantised normals and change the GLB bytes. Material indices are preserved."""
    src.verts.index_update()       # indices are stale after from_mesh/ops; faces below map through them
    src.verts.ensure_lookup_table()

    def vkey(v):
        nb = sorted((round(e.other_vert(v).co.x, 6), round(e.other_vert(v).co.y, 6), round(e.other_vert(v).co.z, 6))
                    for e in v.link_edges)
        return (round(v.co.x, 6), round(v.co.y, 6), round(v.co.z, 6), tuple(nb))

    order = sorted(range(len(src.verts)), key=lambda i: vkey(src.verts[i]))
    rank = [0] * len(order)
    for r, i in enumerate(order):
        rank[i] = r
    out = bmesh.new()
    nv = [out.verts.new(src.verts[i].co) for i in order]
    faces = []
    for f in src.faces:
        idx = [rank[v.index] for v in f.verts]
        k = idx.index(min(idx))
        faces.append((tuple(idx[k:] + idx[:k]), f.material_index))
    faces.sort()
    seen = set()
    dropped = 0
    for idx, mi in faces:
        if idx in seen:
            dropped += 1
            continue
        seen.add(idx)
        try:
            nf = out.faces.new([nv[i] for i in idx])
        except ValueError:  # same vertex set with another winding: keep the first
            dropped += 1
            continue
        nf.material_index = mi
    if dropped:
        raise RuntimeError(f'canonical mesh dropped {dropped} duplicate face(s)')
    return out


def free_parts(model: Model) -> None:
    for n in model.nodes.values():
        for bm, _ in n.parts:
            bm.free()
        n.parts.clear()
