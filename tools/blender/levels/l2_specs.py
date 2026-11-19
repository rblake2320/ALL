"""L2 Old Graveyard art kit — every model the design doc (docs/levels/L2-graveyard.md) asks for.

Sources, in doc order:
  §5.1  the 19 new objects (grave_marked has 4 headstone variants, den_stray 3 species variants,
        plaque_fish also a Bones gold-frame variant §13)
  §5.1/README §8  shared objects L2 uses: board_notice, fence_iron, gate_iron, shelf_curio, bowl_pet, bed_pet,
        item_curio (one mesh per curio id, §4.2: 14 sellable + 3 key fragments), item_fish (four shared body meshes
        small/deep/long/eel + the two junk catches, §4.3)
  §4.1/§4.3 + README P-W22  carry props for the proposed carry items `shovel` and `rod`
  §3    new environment model env_spire
  §9    Night of the Open Gates dressing: lantern_jack, bob_for_brains
  §13   store tie-ins: the 8 "Moonlit Mourning" premium items + the Bones table_seance

Not built here (by design, see the report / tools/blender/levels/README.md): path_gravel (a procedural floor
*style*, P-W4 in src/shared/styles.ts, not a mesh), the ground-mist plane (a renderer fog plane), the
firepit_backyard home version (same mesh as firepit_grill: `aliases`), and everything §5.2 lists as reused.
"""
from __future__ import annotations

from typing import Dict, List

from .spec import LevelSpec

LEVEL_ID = 'graveyard'
DOC = 'docs/levels/L2-graveyard.md'


def _s(id, obj, kind, w, d, h, budget, cat, doc, **kw) -> LevelSpec:
    return LevelSpec(id=id, obj=obj, kind=kind, w=w, d=d, height=h, budget=budget, category=cat, doc=doc, **kw)


# curio id -> (budget, approx height m)
CURIOS = [
    'curio_clayMarble', 'curio_tinSoldier', 'curio_dollHand', 'curio_loveLetter', 'curio_apothecaryBottle',
    'curio_glassEye', 'curio_silverSpoon', 'curio_pocketWatch', 'curio_tarnishedLocket', 'curio_funeralBell',
    'curio_fossilBeetle', 'curio_cameoBrooch', 'curio_jetRing', 'curio_signetRing',
    'curio_keyBow', 'curio_keyShaft', 'curio_keyBit',
]
CURIO_HEIGHT = {
    'curio_clayMarble': 0.05, 'curio_tinSoldier': 0.12, 'curio_dollHand': 0.027, 'curio_loveLetter': 0.017,
    'curio_apothecaryBottle': 0.16, 'curio_glassEye': 0.05, 'curio_silverSpoon': 0.04, 'curio_pocketWatch': 0.04,
    'curio_tarnishedLocket': 0.014, 'curio_funeralBell': 0.12, 'curio_fossilBeetle': 0.06, 'curio_cameoBrooch': 0.025,
    'curio_jetRing': 0.04, 'curio_signetRing': 0.045, 'curio_keyBow': 0.012, 'curio_keyShaft': 0.016,
    'curio_keyBit': 0.015,
}

GRAVE_VARIANTS = [('grave_marked_rounded', 0), ('grave_marked_cross', 1), ('grave_marked_scroll', 2),
                  ('grave_marked_slab', 3)]


def specs() -> Dict[str, LevelSpec]:
    out: List[LevelSpec] = []
    a = out.append
    # ── §5.1 new objects ──
    for mid, v in GRAVE_VARIANTS:
        a(_s(mid, 'grave_marked', 'floor', 1, 2, 0.88 if v == 3 else 1.05, 900, 'graves', '§5.1 grave_marked', variant=str(v),
             parts=['flag'], states=['flag'], front='back_tall:0.45', tags=['grave', 'marked']))
    a(_s('mound_soft', 'mound_soft', 'floor', 1, 2, 0.22, 500, 'graves', '§5.1 mound_soft',
         parts=['turned', 'glow'], states=['turned', 'glow'], tags=['dig', 'mound']))
    a(_s('heap_compost', 'heap_compost', 'floor', 2, 2, 1.0, 1200, 'graves', '§5.1 heap_compost',
         parts=['steam'], states=['steam'], front='back_tall:0.75', tags=['dig', 'compost']))
    a(_s('pond_murky', 'pond_murky', 'floor', 7, 5, 0.45, 5800, 'water', '§5.1 pond_murky',
         parts=['water', 'glow'], states=['glow'], tags=['pond', 'water', 'fishing']))
    a(_s('stairs_crypt', 'stairs_crypt', 'floor', 2, 2, 2.3, 2800, 'structures', '§5.1 stairs_crypt',
         parts=['door'], front='facing:sign', tags=['crypt', 'stairs']))
    a(_s('circle_seance', 'circle_seance', 'floor', 3, 3, 1.15, 2400, 'structures', '§5.1 circle_seance',
         parts=['flame', 'glow'], states=['flame', 'glow'], tags=['seance']))
    a(_s('firepit_grill', 'firepit_grill', 'floor', 2, 2, 1.1, 1600, 'props', '§5.1 firepit_grill',
         parts=['flame'], tags=['grill', 'cook'], notes='aliases: firepit_backyard (home version, same mesh)'))
    a(_s('vending_gravecola', 'vending_gravecola', 'floor', 1, 1, 1.9, 1800, 'props', '§5.1 vending_gravecola',
         parts=['screen', 'brand_decal', 'broken'], states=['broken'], front='facing:screen',
         tags=['vending', 'sponsor', 'brand:Grave-Cola', 'skin:grave_cola_vending']))
    a(_s('tree_willow', 'tree_willow', 'floor', 3, 3, 4.5, 4500, 'nature', '§5.1 tree_willow',
         parts=['sway'], tags=['tree', 'perch']))
    for mid, sp in (('den_stray_cat', 'cat'), ('den_stray_dog', 'dog'), ('den_stray_raccoon', 'raccoon')):
        a(_s(mid, 'den_stray', 'floor', 1, 1, {'cat': 0.5, 'dog': 0.55, 'raccoon': 0.5}[sp], 400, 'props',
             '§5.1 den_stray', variant=sp, front='facing:opening', tags=['strayDen', sp]))
    a(_s('rack_tools', 'rack_tools', 'floor', 1, 1, 1.95, 1400, 'props', '§5.1 rack_tools',
         parts=['shovel_0', 'shovel_1', 'shovel_2', 'rod_0', 'rod_1', 'rod_2', 'bulb'],
         front='back_tall:1.0', tags=['tools', 'shovel', 'rod', 'indoor']))
    a(_s('mower_mulchmaster', 'mower_mulchmaster', 'floor', 2, 1, 1.1, 3200, 'props', '§5.1 mower_mulchmaster',
         parts=['brand_decal'], front='facing:sign',
         tags=['mower', 'sponsor', 'brand:Mulch Master', 'skin:mulch_master_mower']))
    a(_s('obelisk_founder', 'obelisk_founder', 'floor', 1, 1, 2.6, 1000, 'graves', '§5.1 obelisk_founder',
         front='facing:sign', tags=['grave', 'marked', 'monument']))
    a(_s('reeds_cattail', 'reeds_cattail', 'floor', 1, 1, 1.3, 600, 'nature', '§5.1 reeds_cattail',
         parts=['sway'], tags=['plant', 'forage']))
    a(_s('plot_grub', 'plot_grub', 'floor', 1, 2, 0.75, 600, 'graves', '§5.1 plot_grub',
         parts=['turned'], states=['turned'], front='facing:sign', tags=['dig', 'mound', 'outdoorOnly']))
    a(_s('shovel_trusty', 'shovel_trusty', 'wall', 1, 1, 1.3, 500, 'props', '§5.1 shovel_trusty',
         wall_centre=1.15, tags=['tools', 'shovel']))
    a(_s('rod_bent', 'rod_bent', 'wall', 1, 1, 0.62, 400, 'props', '§5.1 rod_bent', wall_centre=1.4,
         tags=['tools', 'rod']))
    a(_s('plaque_fish', 'plaque_fish', 'wall', 1, 1, 0.42, 500, 'props', '§5.1 plaque_fish', variant='wood',
         wall_centre=1.5, paint='#8a9a8a', front='facing:sign', tags=['decor', 'trophy']))
    a(_s('plaque_fish_gold', 'plaque_fish', 'wall', 1, 1, 0.42, 500, 'props', '§13 plaque_fish gold frame',
         variant='gold', wall_centre=1.5, paint='#8a9a8a', front='facing:sign', tags=['decor', 'trophy', 'bones']))
    a(_s('item_cryptKey', 'item_cryptKey', 'item', 1, 1, 0.016, 300, 'items', '§5.1 item_cryptKey',
         tags=['key', 'quest']))
    # ── README §8 shared objects L2 uses ──
    a(_s('board_notice', 'board_notice', 'floor', 1, 1, 1.75, 900, 'props', 'README §8 board_notice',
         front='facing:sign', tags=['notice', 'quest']))
    a(_s('fence_iron', 'fence_iron', 'edge', 1, 1, 1.15, 300, 'structures', 'README §8 fence_iron',
         tags=['fence']))
    a(_s('gate_iron', 'gate_iron', 'opening', 1, 1, 1.45, 1200, 'structures', 'README §8 gate_iron',
         parts=['door', 'door_b'], tags=['door', 'gate']))
    a(_s('shelf_curio', 'shelf_curio', 'floor', 1, 1, 1.7, 1600, 'props', 'README §8 shelf_curio',
         front='facing:glass', tags=['decor', 'display', 'indoor']))
    a(_s('bowl_pet', 'bowl_pet', 'floor', 1, 1, 0.09, 400, 'props', 'README §8 bowl_pet', front='facing:sign',
         tags=['pet', 'petFood']))
    a(_s('bed_pet', 'bed_pet', 'floor', 1, 1, 0.32, 900, 'props', 'README §8 bed_pet', tags=['pet', 'petBed']))
    for cid in CURIOS:
        a(_s(cid, 'item_curio', 'item', 1, 1, CURIO_HEIGHT[cid], 400, 'curios', '§4.2 curios', variant=cid,
             tags=['curio', 'collectible'] + (['quest', 'cryptKey'] if cid.startswith('curio_key') else ['sellable'])))
    for mid, v in (('item_fish_small', 'small'), ('item_fish_deep', 'deep'), ('item_fish_long', 'long'),
                   ('item_fish_eel', 'eel')):
        a(_s(mid, 'item_fish', 'item', 1, 1, {'small': 0.047, 'deep': 0.077, 'long': 0.072, 'eel': 0.06}[v], 300, 'fish', '§4.3 fish meshes',
             variant=v, paint={'small': '#8a9a7a', 'deep': '#9a8a6a', 'long': '#6a7a7a', 'eel': '#4a5a6a'}[v],
             parts=['glow'] if v == 'eel' else [], tags=['fish', 'sellable', 'ingredient']))
    a(_s('junk_oldBoot', 'item_fish', 'item', 1, 1, 0.14, 300, 'fish', '§4.3 junk', variant='junk_oldBoot',
         tags=['fish', 'junk']))
    a(_s('junk_tinCan', 'item_fish', 'item', 1, 1, 0.08, 300, 'fish', '§4.3 junk', variant='junk_tinCan',
         tags=['fish', 'junk']))
    # ── carry props (README P-W22) ──
    a(_s('carry_shovel', 'shovel', 'carry', 1, 1, 1.05, 300, 'props', '§4.1 carry shovel (P-W22)',
         tags=['carry']))
    a(_s('carry_rod', 'rod', 'carry', 1, 1, 1.3, 300, 'props', '§4.3 carry rod (P-W22)', tags=['carry']))
    # ── environment ──
    a(_s('env_spire', 'env_spire', 'env', 4.5, 4.5, 16.0, 2500, 'env', '§3 env_spire', tags=['env', 'dressing']))
    # ── §9 events ──
    a(_s('lantern_jack', 'lantern_jack', 'floor', 1, 1, 0.45, 900, 'events', '§9 Night of the Open Gates',
         parts=['flame'], front='facing:flame', tags=['decor', 'halloween', 'dressing']))
    a(_s('bob_for_brains', 'bob_for_brains', 'floor', 1, 1, 0.85, 1500, 'events', '§9 Night of the Open Gates',
         parts=['water'], tags=['halloween', 'joinable']))
    # ── §13 store tie-ins ──
    a(_s('statue_angelWeeping', 'statue_angelWeeping', 'floor', 1, 1, 1.9, 3000, 'store', '§13 Moonlit Mourning',
         front='facing:face', tags=['decor', 'premium', 'set:moonlitMourning']))
    a(_s('bench_gothic', 'bench_gothic', 'floor', 2, 1, 1.0, 2400, 'store', '§13 Moonlit Mourning',
         front='back_tall:0.6', tags=['seating', 'premium', 'set:moonlitMourning']))
    a(_s('arch_ironGate', 'arch_ironGate', 'floor', 2, 1, 2.45, 2600, 'store', '§13 Moonlit Mourning',
         tags=['decor', 'premium', 'set:moonlitMourning']))
    a(_s('obelisk_mini', 'obelisk_mini', 'floor', 1, 1, 1.25, 800, 'store', '§13 Moonlit Mourning',
         tags=['decor', 'premium', 'set:moonlitMourning']))
    a(_s('lantern_ironCage', 'lantern_ironCage', 'floor', 1, 1, 0.62, 900, 'store', '§13 Moonlit Mourning',
         parts=['bulb'], tags=['lighting', 'premium', 'set:moonlitMourning']))
    a(_s('wreath_mourning', 'wreath_mourning', 'wall', 1, 1, 0.62, 1400, 'store', '§13 Moonlit Mourning',
         wall_centre=1.55, tags=['decor', 'premium', 'set:moonlitMourning']))
    a(_s('candle_cluster', 'candle_cluster', 'floor', 1, 1, 0.42, 1200, 'store', '§13 Moonlit Mourning',
         parts=['flame'], tags=['lighting', 'premium', 'set:moonlitMourning']))
    a(_s('urn_planterStone', 'urn_planterStone', 'floor', 1, 1, 0.95, 1400, 'store', '§13 Moonlit Mourning',
         tags=['decor', 'premium', 'set:moonlitMourning', 'outdoor']))
    a(_s('table_seance', 'table_seance', 'floor', 2, 2, 1.05, 2600, 'store', '§13 Bones unlock',
         parts=['glow', 'flame'], tags=['seance', 'bones']))
    d = {}
    for s in out:
        if s.id in d:
            raise KeyError(f'duplicate level model id {s.id}')
        d[s.id] = s
    return d


#: design objects whose GLB is shared with another id (runtime alias, no extra file)
ALIASES = {'firepit_backyard': 'firepit_grill'}
