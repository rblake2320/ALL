"""Named Principled BSDF materials (flat colours x vertex-colour multiplier; no image textures)."""
from __future__ import annotations

import bpy

from .consts import MATERIAL_COLORS, MATERIAL_ROUGHNESS, MATERIALS, hex_lin


def make_material(name: str, hex_color: str, roughness: float, metallic: float = 0.0,
                  emission: tuple | None = None) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True  # still required in 5.x for node materials
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Col'
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    r, g, b = hex_lin(hex_color)
    mix.inputs[6].default_value = (r, g, b, 1.0)   # A (colour)
    nt.links.new(attr.outputs['Color'], mix.inputs[7])  # B
    # Export contract: Base Color stays an unlinked constant so glTF gets baseColorFactor; COLOR_0 ships separately
    # (export_vertex_color='ACTIVE') and three.js multiplies it in. Previews link the multiply (vertex_color_preview).
    bsdf.inputs['Base Color'].default_value = (r, g, b, 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    if emission is not None:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1.0)
        bsdf.inputs['Emission Strength'].default_value = 1.0
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    mat.diffuse_color = (r, g, b, 1.0)
    return mat


def build_materials() -> dict[str, bpy.types.Material]:
    mats = {}
    for name in MATERIALS:
        mats[name] = make_material(name, MATERIAL_COLORS[name], MATERIAL_ROUGHNESS[name])
    return mats


def set_material_color(mat: bpy.types.Material, hex_color: str) -> None:
    """Preview helper: recolour the constant colour input (mirrors the runtime recolouring)."""
    r, g, b = hex_lin(hex_color)
    for n in mat.node_tree.nodes:
        if n.bl_idname == 'ShaderNodeMix':
            n.inputs[6].default_value = (r, g, b, 1.0)
        elif n.bl_idname == 'ShaderNodeBsdfPrincipled':
            n.inputs['Base Color'].default_value = (r, g, b, 1.0)
    mat.diffuse_color = (r, g, b, 1.0)


def vertex_color_preview(mat: bpy.types.Material, on: bool = True) -> None:
    """Link (or unlink) colour x vertex-colour into Base Color; Cycles previews need it, export must not."""
    nt = mat.node_tree
    mix = next((n for n in nt.nodes if n.bl_idname == 'ShaderNodeMix'), None)
    bsdf = next((n for n in nt.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
    if mix is None or bsdf is None:
        return
    inp = bsdf.inputs['Base Color']
    for link in list(inp.links):
        nt.links.remove(link)
    if on:
        nt.links.new(mix.outputs[2], inp)
