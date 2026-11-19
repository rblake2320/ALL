"""L4 Swampside Bayou art kit (W-054) — models from docs/levels/L4-bayou.md §7 (new objects), §5.6 (curios) and
§12 (environment look).

Part 1 (this file today): the residential and lot objects a home player can place or meet first — boat, fishing
post, porch furniture, stove, crawdad trap and boil pot, forage plants, the bald cypress, the firefly lantern,
the crawdad bucket and the cypress rod.

Not built yet (part 2): the commercial lots' counters, racks, tank, booth, jukebox, hiring board, viewing platform
and sunning log; the eight Bayou Finds curios; the four environment models (`env_hearseBoat`, `env_stiltHouse_a/b`,
`env_cypressGroup`); and the animal `gator_toothless` (a creature, for the pets/wildlife pipeline).
Not meshes at all: `floor_boardwalk` (a procedural floor style) and everything §7 lists as reused.
"""
from __future__ import annotations

from typing import Dict

from .spec import LevelSpec

LEVEL_ID = 'bayou'
DOC = 'docs/levels/L4-bayou.md'


CURIO_HEIGHT = {
    'curio_bottleMessage': 0.060, 'curio_lanternHook': 0.016, 'curio_cypressCarving': 0.098,
    'curio_riverboatToken': 0.004, 'curio_pearlButton': 0.005, 'curio_fiddlePeg': 0.011,
    'curio_gatorTooth': 0.017, 'curio_sunkenCompass': 0.045,
}


def _s(id, kind, w, d, h, budget, cat, **kw) -> LevelSpec:
    return LevelSpec(id=id, obj=kw.pop('obj', id), kind=kind, w=w, d=d, height=h, budget=budget, category=cat,
                     doc=kw.pop('doc', f'§7 {id}'), **kw)


def specs() -> Dict[str, LevelSpec]:
    rows = [
        _s('pirogue_dock', 'floor', 1, 3, 0.62, 1600, 'water', tags=['boat', 'waterOk']),
        _s('post_fishing', 'floor', 1, 1, 1.20, 600, 'water', tags=['fishing', 'waterOk']),
        _s('chair_rocking', 'floor', 1, 1, 1.08, 1200, 'porch', tags=['seat'], front='back_tall:0.6'),
        _s('swing_porch', 'floor', 2, 1, 2.45, 1400, 'porch', tags=['seat'], parts=['swing'], front='back_tall:0.75'),
        _s('hammock_moss', 'floor', 2, 1, 1.35, 1500, 'porch', tags=['nap']),
        _s('stove_woodburning', 'floor', 1, 1, 2.30, 1300, 'home', tags=['warm'], parts=['flame']),
        _s('pot_crawdad', 'floor', 1, 1, 0.42, 700, 'water', tags=['trap'], parts=['full'], states=['full']),
        _s('pot_boil', 'floor', 1, 1, 0.95, 1200, 'home', tags=['cook'], parts=['water', 'flame']),
        _s('bush_bogberry', 'floor', 1, 1, 0.62, 900, 'nature', tags=['forage'],
           parts=['count_1', 'count_2', 'count_3'], states=['count_1', 'count_2', 'count_3']),
        _s('log_mushroom', 'floor', 1, 1, 0.42, 800, 'nature', tags=['forage'], parts=['glow']),
        _s('tree_cypress', 'floor', 2, 2, 7.0, 5500, 'nature', tags=['tree']),
        _s('lantern_firefly', 'floor', 1, 1, 1.05, 500, 'home', tags=['light'], parts=['glow']),
        _s('item_crawdads', 'item', 1, 1, 0.30, 300, 'items', tags=['food', 'sellable', 'ingredient']),
        _s('rod_cypress', 'wall', 1, 1, 0.16, 600, 'items', tags=['tools', 'rod'], wall_centre=1.5),
        # part 2: fish camp, diner, gator pond
        _s('rack_bait', 'floor', 1, 1, 1.46, 700, 'shop', tags=['bait'], front='back_tall:1.0'),
        _s('counter_tackle', 'floor', 3, 1, 1.96, 1800, 'shop', tags=['counter'], front='back_tall:1.2'),
        _s('tank_bait', 'floor', 2, 1, 1.07, 1000, 'shop', tags=['bait'], parts=['water']),
        _s('rack_rods', 'floor', 3, 1, 1.88, 1400, 'shop', tags=['rods'], front='back_tall:1.0'),
        _s('board_swampguide', 'floor', 1, 1, 1.72, 800, 'shop', tags=['career']),
        _s('counter_diner', 'floor', 5, 1, 1.35, 3000, 'diner', tags=['counter']),
        _s('booth_diner', 'floor', 2, 1, 1.155, 1300, 'diner', tags=['seat'], front='back_tall:0.75'),
        _s('jukebox_swamp', 'floor', 1, 1, 1.51, 1800, 'diner', tags=['music'], parts=['glow']),
        _s('platform_viewing', 'floor', 4, 2, 2.02, 2000, 'pond', tags=['view']),
        _s('den_gator', 'floor', 2, 2, 0.67, 1200, 'pond', tags=['gator']),
    ]
    # §5.6 Bayou Finds: one mesh per curio id for the shared `item_curio` object, each within 400 triangles
    for cid, h in CURIO_HEIGHT.items():
        rows.append(_s(cid, 'item', 1, 1, h, 400, 'curios', obj='item_curio', variant=cid, doc='§5.6 Bayou Finds',
                       tags=['curio', 'collectible'] + (['quest'] if cid == 'curio_gatorTooth' else ['sellable'])))
    # §12 environment models (sizes in metres)
    rows += [
        _s('env_hearseBoat', 'env', 2.2, 5.6, 2.3, 4000, 'env', doc='§12 env models', tags=['env', 'carpool'], parts=['glow']),
        _s('env_stiltHouse_a', 'env', 5.4, 5.6, 5.9, 4500, 'env', doc='§12 env models', tags=['env', 'dressing'], parts=['glow']),
        _s('env_stiltHouse_b', 'env', 6.0, 7.2, 5.4, 4500, 'env', doc='§12 env models', tags=['env', 'dressing'], parts=['glow']),
        _s('env_cypressGroup', 'env', 7.5, 7.0, 8.8, 6000, 'env', doc='§12 env models', tags=['env', 'dressing']),
    ]
    return {s.id: s for s in rows}
