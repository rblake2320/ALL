"""Material palette (Principled BSDF) following docs/ART_DIRECTION.md.

* Colours are authored as sRGB hex and converted to linear for Blender (glTF baseColorFactor is linear).
* ``Paint`` is the recolourable primary material (the runtime tints it), ``Glass`` is alpha-blended (~0.35).
* Emissive materials use Emission Strength 2-6 (exported via KHR_materials_emissive_strength) so the renderer's
  bloom picks them up. Dynamic emissive parts live in their own nodes; the runtime toggles them.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Tuple

import bpy

RGB = Tuple[float, float, float]

# ── Palette (sRGB hex) ────────────────────────────────────────────────────────────────────────────
PALETTE = {
    # art-direction core
    'night_plum': '#1d1726',
    'grave_slate': '#2b2f3a',
    'moss': '#6f8f5e',
    'toxic': '#9fe870',
    'bone': '#e8e0c8',
    'parchment': '#d9cfb8',
    'rust': '#a5532f',
    'blood_wine': '#6e2a35',
    'candle': '#ffb35a',
    'cryo': '#7fe0ff',
    # woods (catalog WOOD variants + extras)
    'wood': '#6b4a35',
    'wood_dark': '#4a3326',
    'wood_light': '#8a6a4a',
    'wood_ebony': '#3b2a22',
    'pine': '#b08a5a',
    # fabrics
    'plum_fabric': '#5b3f6e',
    'green_fabric': '#3f5a4a',
    'red_fabric': '#6e3b3b',
    'slate_fabric': '#4a4a5e',
    'mustard_fabric': '#7a6a3a',
    'lining': '#e3d9c6',
    'lace': '#ece4d2',
    'stuffing': '#efe8d8',
    # metals
    'iron': '#2f2d33',
    'steel': '#9aa1a6',
    'chrome': '#c8ccd0',
    'brass': '#b08d4a',
    'bronze': '#7d5f3a',
    'gold': '#c9a94a',
    'galvanised': '#8d9396',
    # minerals / earth
    'porcelain': '#e6e1d6',
    'marble': '#d9d6cf',
    'granite': '#7f8381',
    'stone_light': '#a9a79c',
    'soil': '#5a4434',
    'soil_dark': '#35291f',
    'grass': '#62804f',
    'grass_dry': '#8a8a52',
    'ash': '#8c8782',
    'charcoal': '#3b3633',
    # organics
    'fern_dead': '#7a5a36',
    'fern_brown': '#5e4328',
    'terracotta': '#b0603a',
    'plant_green': '#5f9a3a',
    'plant_purple': '#7a3a6e',
    'brain': '#d98a94',
    'brain_dark': '#b06878',
    'skin': '#9fb88a',
    'skin_dark': '#7f9a6c',
    'straw': '#c9b06a',
    'cardboard': '#b08a5a',
    'wax': '#efe6cf',
    'crow': '#2a2830',
    'teeth': '#efe9d4',
    'gum': '#b0405a',
    # synthetics
    'rubber': '#2d2b2e',
    'plastic_beige': '#cfc4a6',
    'plastic_dark': '#33313a',
    'enamel_red': '#9a2b2b',
    'mold': '#7f9a4e',
    'mold_dark': '#566b3a',
    'paper': '#efe7cf',
    'cobweb': '#e8e4dc',
    'tile_white': '#dcd8cc',
    'grout': '#8e8a80',
    'curtain': '#9aa58a',
    'blood': '#7a1f2a',
    'shingle': '#3a3440',
    'siding_a': '#6f7a86',
    'siding_b': '#8a7a62',
    'siding_c': '#5a4f62',
    'trim': '#d9cfb8',
    'hedge': '#3f5a34',
    'cypress': '#2f4a35',
    'tire': '#26252a',
    'hearse_black': '#26242c',
    'curtain_purple': '#4b2a55',
}

# Emission colours (sRGB hex) for glow materials.
EMISSIVE = {
    'screen_crt': '#a8f0d0',
    'screen_tv': '#5a6ff0',
    'screen_arcade': '#9fe870',
    'screen_pc': '#8fe8a8',
    'microwave': '#ffb35a',
    'cryo': '#7fe0ff',
    'toxic': '#9fe870',
    'zapper': '#8f7cff',
    'flame': '#ffb35a',
    'flame_core': '#ffe3a0',
    'gas_flame': '#5aa8ff',
    'coil': '#ff5a2a',
    'bulb': '#ffc27a',
    'lantern': '#ffd59a',
    'window_warm': '#ffbf6a',
    'ghost': '#bff5d8',
    'tesla': '#b8a8ff',
    'fridge_light': '#fff1c8',
    'led_blue': '#4fb8ff',
}


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(h: str) -> RGB:
    h = h.lstrip('#')
    if len(h) != 6:
        raise ValueError(f'bad hex colour {h!r}')
    r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b))


def colour(name_or_hex: str) -> str:
    """Resolve a palette key or pass a hex through."""
    if name_or_hex.startswith('#'):
        return name_or_hex
    return PALETTE.get(name_or_hex) or EMISSIVE[name_or_hex]


def mix_hex(a: str, b: str, t: float) -> str:
    a, b = colour(a).lstrip('#'), colour(b).lstrip('#')
    ca = [int(a[i:i + 2], 16) for i in (0, 2, 4)]
    cb = [int(b[i:i + 2], 16) for i in (0, 2, 4)]
    return '#' + ''.join(f'{round(x + (y - x) * t):02x}' for x, y in zip(ca, cb))


@dataclass
class MatSpec:
    color: str
    roughness: float = 0.72
    metallic: float = 0.0
    emission: Optional[str] = None
    strength: float = 0.0
    alpha: float = 1.0
    double_sided: bool = False
    coat: float = 0.0


# Named looks reused across models. Keys double as the material names written to the GLB.
LOOKS = {
    'Glass': MatSpec('#c9d8d0', roughness=0.08, alpha=0.35, double_sided=True),
    'GlassGrimy': MatSpec('#a9b49a', roughness=0.35, alpha=0.42, double_sided=True),
    'Mirror': MatSpec('#59606a', roughness=0.12, metallic=0.85),
    'Wood': MatSpec(PALETTE['wood'], roughness=0.78),
    'WoodDark': MatSpec(PALETTE['wood_dark'], roughness=0.78),
    'WoodLight': MatSpec(PALETTE['wood_light'], roughness=0.76),
    'WoodEbony': MatSpec(PALETTE['wood_ebony'], roughness=0.7),
    'Pine': MatSpec(PALETTE['pine'], roughness=0.8),
    'Iron': MatSpec(PALETTE['iron'], roughness=0.55, metallic=0.65),
    'Steel': MatSpec(PALETTE['steel'], roughness=0.38, metallic=0.8),
    'Chrome': MatSpec(PALETTE['chrome'], roughness=0.2, metallic=0.9),
    'Brass': MatSpec(PALETTE['brass'], roughness=0.38, metallic=0.85),
    'Bronze': MatSpec(PALETTE['bronze'], roughness=0.5, metallic=0.75),
    'Gold': MatSpec(PALETTE['gold'], roughness=0.32, metallic=0.85),
    'Copper': MatSpec('#b06a42', roughness=0.4, metallic=0.85),
    'Galvanised': MatSpec(PALETTE['galvanised'], roughness=0.5, metallic=0.7),
    'Rust': MatSpec(PALETTE['rust'], roughness=0.85, metallic=0.2),
    'Bone': MatSpec(PALETTE['bone'], roughness=0.6),
    'BoneDark': MatSpec('#b9b09a', roughness=0.65),
    'Parchment': MatSpec(PALETTE['parchment'], roughness=0.85),
    'Paper': MatSpec(PALETTE['paper'], roughness=0.9, double_sided=True),
    'Lining': MatSpec(PALETTE['lining'], roughness=0.85),
    'Lace': MatSpec(PALETTE['lace'], roughness=0.9),
    'Stuffing': MatSpec(PALETTE['stuffing'], roughness=0.95),
    'CushionDark': MatSpec('#3a2f3c', roughness=0.9),
    'Porcelain': MatSpec(PALETTE['porcelain'], roughness=0.3),
    'Marble': MatSpec(PALETTE['marble'], roughness=0.3),
    'Granite': MatSpec(PALETTE['granite'], roughness=0.8),
    'StoneLight': MatSpec(PALETTE['stone_light'], roughness=0.85),
    'Soil': MatSpec(PALETTE['soil'], roughness=0.95),
    'SoilDark': MatSpec(PALETTE['soil_dark'], roughness=0.95),
    'Grass': MatSpec(PALETTE['grass'], roughness=0.9),
    'GrassDry': MatSpec(PALETTE['grass_dry'], roughness=0.9),
    'Moss': MatSpec(PALETTE['moss'], roughness=0.95),
    'Mold': MatSpec(PALETTE['mold'], roughness=0.95),
    'MoldDark': MatSpec(PALETTE['mold_dark'], roughness=0.95),
    'Ash': MatSpec(PALETTE['ash'], roughness=0.98),
    'Charcoal': MatSpec(PALETTE['charcoal'], roughness=0.9),
    'FernDead': MatSpec(PALETTE['fern_dead'], roughness=0.85, double_sided=True),
    'FernBrown': MatSpec(PALETTE['fern_brown'], roughness=0.85, double_sided=True),
    'Terracotta': MatSpec(PALETTE['terracotta'], roughness=0.85),
    'PlantGreen': MatSpec(PALETTE['plant_green'], roughness=0.6),
    'PlantPurple': MatSpec(PALETTE['plant_purple'], roughness=0.6),
    'Brain': MatSpec(PALETTE['brain'], roughness=0.45),
    'BrainDark': MatSpec(PALETTE['brain_dark'], roughness=0.5),
    'Skin': MatSpec(PALETTE['skin'], roughness=0.75),
    'SkinDark': MatSpec(PALETTE['skin_dark'], roughness=0.8),
    'Straw': MatSpec(PALETTE['straw'], roughness=0.95),
    'Cardboard': MatSpec(PALETTE['cardboard'], roughness=0.92),
    'Wax': MatSpec(PALETTE['wax'], roughness=0.55),
    'Crow': MatSpec(PALETTE['crow'], roughness=0.6),
    'Teeth': MatSpec(PALETTE['teeth'], roughness=0.5),
    'Gum': MatSpec(PALETTE['gum'], roughness=0.6),
    'Rubber': MatSpec(PALETTE['rubber'], roughness=0.85),
    'PlasticBeige': MatSpec(PALETTE['plastic_beige'], roughness=0.55),
    'PlasticDark': MatSpec(PALETTE['plastic_dark'], roughness=0.5),
    'EnamelRed': MatSpec(PALETTE['enamel_red'], roughness=0.45),
    'Cobweb': MatSpec(PALETTE['cobweb'], roughness=0.9, alpha=0.55, double_sided=True),
    'TileWhite': MatSpec(PALETTE['tile_white'], roughness=0.35),
    'Grout': MatSpec(PALETTE['grout'], roughness=0.9),
    'Curtain': MatSpec(PALETTE['curtain'], roughness=0.9, double_sided=True),
    'Blood': MatSpec(PALETTE['blood'], roughness=0.35),
    'BloodWine': MatSpec(PALETTE['blood_wine'], roughness=0.7),
    'Shingle': MatSpec(PALETTE['shingle'], roughness=0.9),
    'Trim': MatSpec(PALETTE['trim'], roughness=0.75),
    'Hedge': MatSpec(PALETTE['hedge'], roughness=0.95),
    'Cypress': MatSpec(PALETTE['cypress'], roughness=0.95),
    'Tire': MatSpec(PALETTE['tire'], roughness=0.9),
    'HearseBlack': MatSpec(PALETTE['hearse_black'], roughness=0.3, metallic=0.3, coat=0.6),
    'CurtainPurple': MatSpec(PALETTE['curtain_purple'], roughness=0.9, double_sided=True),
    'Slate': MatSpec(PALETTE['grave_slate'], roughness=0.8),
    'Plum': MatSpec(PALETTE['night_plum'], roughness=0.8),
    'Black': MatSpec('#25222a', roughness=0.6),
    'Felt': MatSpec('#2f4a3a', roughness=0.95),
    'Water': MatSpec('#8fc8e8', roughness=0.05, alpha=0.55, double_sided=True),
    'WaterDirty': MatSpec('#9a9a70', roughness=0.1, alpha=0.6, double_sided=True),
    'Ice': MatSpec('#d8f4ff', roughness=0.1, alpha=0.7),
    'Frost': MatSpec('#e6f8ff', roughness=0.6, alpha=0.8, emission='#bfefff', strength=0.6),
    'Mist': MatSpec('#cfefff', roughness=0.9, alpha=0.35, double_sided=True, emission='#9fe0ff', strength=0.8),
    # emissive (dynamic parts) — strength 2..6
    'ScreenCRT': MatSpec('#1f2a26', roughness=0.25, emission=EMISSIVE['screen_crt'], strength=3.0),
    # big flat screen: lower strength so its large area blooms blue instead of blowing out to white
    'ScreenTV': MatSpec('#1c2030', roughness=0.2, emission=EMISSIVE['screen_tv'], strength=2.4),
    'ScreenArcade': MatSpec('#1a2418', roughness=0.25, emission=EMISSIVE['screen_arcade'], strength=3.2),
    'ScreenPC': MatSpec('#1a2620', roughness=0.25, emission=EMISSIVE['screen_pc'], strength=3.0),
    'ScreenMicrowave': MatSpec('#2a2218', roughness=0.2, emission=EMISSIVE['microwave'], strength=3.0, alpha=1.0),
    'GlowCryo': MatSpec('#3a6a7a', roughness=0.3, emission=EMISSIVE['cryo'], strength=4.0),
    'GlowToxic': MatSpec('#4a7a3a', roughness=0.25, emission=EMISSIVE['toxic'], strength=4.0),
    'GlowZapper': MatSpec('#3a3470', roughness=0.3, emission=EMISSIVE['zapper'], strength=5.0),
    'GlowGhost': MatSpec('#a8d8c0', roughness=0.9, emission=EMISSIVE['ghost'], strength=2.2, alpha=0.6, double_sided=True),
    'GlowTesla': MatSpec('#6a5aa0', roughness=0.3, emission=EMISSIVE['tesla'], strength=5.0),
    'GlowLED': MatSpec('#204060', roughness=0.3, emission=EMISSIVE['led_blue'], strength=4.0),
    'GlowFridge': MatSpec('#e8e0c0', roughness=0.6, emission=EMISSIVE['fridge_light'], strength=2.5),
    'Flame': MatSpec('#ffb35a', roughness=0.9, emission=EMISSIVE['flame'], strength=4.5),
    'FlameCore': MatSpec('#ffe3a0', roughness=0.9, emission=EMISSIVE['flame_core'], strength=5.5),
    'GasFlame': MatSpec('#4a88e0', roughness=0.9, emission=EMISSIVE['gas_flame'], strength=4.5, alpha=0.85),
    'Coil': MatSpec('#5a2a20', roughness=0.5, emission=EMISSIVE['coil'], strength=3.5),
    'Bulb': MatSpec('#f0d8a8', roughness=0.4, emission=EMISSIVE['bulb'], strength=4.0),
    'SkullShade': MatSpec('#efe2c4', roughness=0.55, emission=EMISSIVE['bulb'], strength=3.0, alpha=0.88),
    'Lantern': MatSpec('#f0dcb0', roughness=0.4, emission=EMISSIVE['lantern'], strength=5.0),
    # named *Glass so the renderer's night window-glow system recognises it (it matches 'glass' in the name)
    'WindowGlass': MatSpec('#3a3428', roughness=0.3, emission=EMISSIVE['window_warm'], strength=2.6),
    'CanvasBlank': MatSpec('#e8e0c8', roughness=0.9),
    'Smoke': MatSpec('#5d5a5f', roughness=0.95, alpha=0.75),
    'Spark': MatSpec('#ffe27a', roughness=0.5, emission='#ffe27a', strength=5.0),
    'Book1': MatSpec('#6e2a35', roughness=0.8),
    'Book2': MatSpec('#3f5a4a', roughness=0.8),
    'Book3': MatSpec('#4a4a6e', roughness=0.8),
    'Book4': MatSpec('#8a6a3a', roughness=0.8),
    'Book5': MatSpec('#5b3f6e', roughness=0.8),
    'Magnet1': MatSpec('#c84a3a', roughness=0.4),
    'Magnet2': MatSpec('#3a8ac8', roughness=0.4),
    'Magnet3': MatSpec('#e8c83a', roughness=0.4),
    'Ink': MatSpec('#3a2a2a', roughness=0.8),
    'PatchA': MatSpec('#8a7a4a', roughness=0.9),
    'PatchB': MatSpec('#5a6e7a', roughness=0.9),
    'BlackVelvetButton': MatSpec('#2a2228', roughness=0.7),
    'LiningCryo': MatSpec('#cfe6ee', roughness=0.8),
    'QuiltB': MatSpec('#d9cfb8', roughness=0.9),
    'QuiltC': MatSpec('#a5532f', roughness=0.9),
    'GhostSheet': MatSpec('#eef2ec', roughness=0.85, alpha=0.82),
    'PaintRed': MatSpec('#9a2b35', roughness=0.6),
    'PaintGreen': MatSpec('#6f9a4e', roughness=0.6),
    'PaintMoon': MatSpec('#e8d27a', roughness=0.6),
    'PaintBone': MatSpec('#e8e0c8', roughness=0.6),
    'PotPurple': MatSpec('#5a3a6a', roughness=0.5),
    'RugB': MatSpec('#d9cfb8', roughness=0.95),
    'RugC': MatSpec('#6f8f5e', roughness=0.95),
    'RugD': MatSpec('#a5532f', roughness=0.95),
    'RugGold': MatSpec('#c9a23a', roughness=0.85),
    'Bark': MatSpec('#4a3b33', roughness=0.95),
    'BarkLight': MatSpec('#6a5a4c', roughness=0.95),
    'Wisp': MatSpec('#9fe870', roughness=0.9, alpha=0.45, emission='#9fe870', strength=2.0, double_sided=True),
    'Smudge': MatSpec('#6a6a50', roughness=0.9, alpha=0.4),
    'StainedRed': MatSpec('#b02a3a', roughness=0.2, alpha=0.6, emission='#b02a3a', strength=0.3),
    'StainedGreen': MatSpec('#3a9a5a', roughness=0.2, alpha=0.6, emission='#3a9a5a', strength=0.3),
    'StainedBlue': MatSpec('#3a5ab0', roughness=0.2, alpha=0.6, emission='#3a5ab0', strength=0.3),
    'Envelope': MatSpec('#e8dcc0', roughness=0.9),
    'Siding': MatSpec('#6f7a86', roughness=0.85),
    'SidingB': MatSpec('#8a7a62', roughness=0.85),
    'SidingC': MatSpec('#5a4f62', roughness=0.85),
    'Brick': MatSpec('#7a4a3e', roughness=0.9),
    'WindowDark': MatSpec('#23262e', roughness=0.2),
    'Planks': MatSpec('#7a6448', roughness=0.9),
    'Trousers': MatSpec('#3a3f55', roughness=0.9),
    'Ember': MatSpec('#5a2a20', roughness=0.8, emission='#ff7a3a', strength=1.2),
    'TailLight': MatSpec('#5a1010', roughness=0.4, emission='#ff3a3a', strength=3.0),
    # ── hardening pass additions ──
    # skull lamp: softer glowing shell + dark sockets that light up hot (jack-o'-lantern read at night)
    'SkullShell': MatSpec('#e9dcc0', roughness=0.6, emission='#ffb860', strength=0.9, alpha=0.92),
    'SkullEyes': MatSpec('#2e2420', roughness=0.7, emission='#ffd27a', strength=5.0),
    # big fire: saturated tongues at moderate strength so ACES keeps them orange instead of clipping to white
    'FireOuter': MatSpec('#c8401a', roughness=0.9, emission='#ff5a1e', strength=2.6),
    'FireMid': MatSpec('#e07a20', roughness=0.9, emission='#ff9a2a', strength=3.0),
    'FireCore': MatSpec('#f0c050', roughness=0.9, emission='#ffd060', strength=3.4),
    'MirrorBright': MatSpec('#8e98a2', roughness=0.16, metallic=0.55),
    'MirrorStreak': MatSpec('#dfe7ec', roughness=0.3, alpha=0.55),
    'Crack': MatSpec('#eef2f2', roughness=0.4),
    'Lapis': MatSpec('#2c4a8c', roughness=0.45, metallic=0.2),
    'Turquoise': MatSpec('#3aa6a0', roughness=0.5),
    'GlassCanopy': MatSpec('#bfe8f0', roughness=0.06, alpha=0.3, double_sided=True),
    'Worm': MatSpec('#d98a8a', roughness=0.45),
    'SoilClod': MatSpec('#4a3628', roughness=0.95),
    'Sod': MatSpec('#55703f', roughness=0.95),
    'HedgeLight': MatSpec('#5a7a42', roughness=0.9),
    'CypressLight': MatSpec('#3f5e40', roughness=0.9),
    'Berry': MatSpec('#7a1f3a', roughness=0.35),
    'Thorn': MatSpec('#3a2e28', roughness=0.8),
    'LoafCut': MatSpec('#e8a8ae', roughness=0.6),
    # oxidised bronze/copper patina (sconce insets, old fittings)
    'Verdigris': MatSpec('#5f8f7c', roughness=0.7, metallic=0.25),
    # vintage medical enamel (embalming pump cabinet)
    'EnamelMint': MatSpec('#8db39c', roughness=0.38),
    'Parsley': MatSpec('#4f8a3a', roughness=0.7),
    'Lettuce': MatSpec('#8ab45a', roughness=0.7, double_sided=True),
    'Velvet': MatSpec('#4b2a55', roughness=0.95),
    'Doily': MatSpec('#efe8d8', roughness=0.95, double_sided=True),
    'SheetMetal': MatSpec('#9aa1a6', roughness=0.45, metallic=0.7),
    'Leather': MatSpec('#5a3a2a', roughness=0.75),
    # hearse paint: plum-black with clear coat (pure black reads as a hole from the game camera)
    'HearsePaint': MatSpec('#3a3346', roughness=0.28, metallic=0.25, coat=0.7),
    'Whitewall': MatSpec('#e6e0d0', roughness=0.7),
    'HearseCurtain': MatSpec('#7a3f8a', roughness=0.9, double_sided=True),
}


class MaterialLibrary:
    """Per-model material cache (the scene is reset between models, so never share across builds)."""

    def __init__(self, paint_color: Optional[str] = None):
        self._cache: dict = {}
        self.paint_color = paint_color or PALETTE['wood']

    def get(self, name: str) -> bpy.types.Material:
        if name in self._cache:
            return self._cache[name]
        if name == 'Paint':
            spec = MatSpec(self.paint_color, roughness=0.72)
        else:
            spec = LOOKS.get(name)
            if spec is None:
                raise KeyError(f'unknown material look {name!r}')
        m = make_material(name, spec)
        self._cache[name] = m
        return m

    def custom(self, name: str, spec: MatSpec) -> bpy.types.Material:
        """A one-off material (e.g. fabric accent). Name must not collide with LOOKS keys."""
        if name in self._cache:
            return self._cache[name]
        m = make_material(name, spec)
        self._cache[name] = m
        return m

    def paint_spec(self, color: str, roughness: float = 0.72, metallic: float = 0.0, coat: float = 0.0) -> bpy.types.Material:
        """Override the Paint look (colour/roughness/metal) for this model. Call before first get('Paint')."""
        self.paint_color = color
        if 'Paint' in self._cache:
            raise RuntimeError('Paint already created')
        m = make_material('Paint', MatSpec(color, roughness=roughness, metallic=metallic, coat=coat))
        self._cache['Paint'] = m
        return m


def _principled(m: bpy.types.Material):
    nt = m.node_tree
    if nt is None:  # pre-5.0 fallback
        m.use_nodes = True
        nt = m.node_tree
    for n in nt.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            return n
    n = nt.nodes.new('ShaderNodeBsdfPrincipled')
    out = next((o for o in nt.nodes if o.type == 'OUTPUT_MATERIAL'), None) or nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(n.outputs['BSDF'], out.inputs['Surface'])
    return n


def make_material(name: str, spec: MatSpec) -> bpy.types.Material:
    m = bpy.data.materials.new(name)
    if m.name != name:
        # Blender appended .001 — a material with this name already exists in this build.
        raise RuntimeError(f'material name clash {name!r} -> {m.name!r}')
    b = _principled(m)
    col = hex_to_linear(colour(spec.color))
    b.inputs['Base Color'].default_value = (*col, 1.0)
    b.inputs['Roughness'].default_value = spec.roughness
    b.inputs['Metallic'].default_value = spec.metallic
    if spec.coat > 0:
        b.inputs['Coat Weight'].default_value = spec.coat
        b.inputs['Coat Roughness'].default_value = 0.15
    if spec.emission:
        b.inputs['Emission Color'].default_value = (*hex_to_linear(colour(spec.emission)), 1.0)
        b.inputs['Emission Strength'].default_value = spec.strength
    if spec.alpha < 1.0:
        b.inputs['Alpha'].default_value = spec.alpha
        m.surface_render_method = 'BLENDED'
        try:
            m.use_transparent_shadow = True
        except AttributeError:
            pass
    m.use_backface_culling = not spec.double_sided
    m.diffuse_color = (*col, spec.alpha)
    m.roughness = spec.roughness
    m.metallic = spec.metallic
    return m
