"""Yard building art kit (W-109, docs/systems/yard-building.md §1/§3): the things a player places in the yard.

Fences and gates are edge pieces and live in the structures kit (tools/blender/structures). This kit holds the
floor objects: outdoor furniture now; the garden, trees, flower beds and yard structures follow.

Where a level doc already defines the object, this kit uses that id, footprint and triangle budget, so one model
serves the level and the yard (docs/levels/L1-wormwood.md §4 says the park pieces are "also buyable for yards").

Outdoor furniture, eight pieces in the spec:
  built here      picnic_table, swing_creaky, birdbath_skull (L1 §4 ids) · grill_bbq, pond_yard (new)
  reused as is    the bench  -> `curb_bench` (structures kit, curb-appeal band 2)
                  the hammock -> `hammock_moss` (L4 Bayou kit)
                  the firepit -> `firepit_grill` (L2 kit; L2 §5 names its home version `firepit_backyard`)
"""
from __future__ import annotations

from typing import Dict

from .spec import LevelSpec

LEVEL_ID = 'yard'
DOC = 'docs/systems/yard-building.md'

#: spec piece -> the existing model that serves it (kit manifest, id). Nothing is built for these.
REUSED = {
    'bench': ('manifest.structures.json', 'curb_bench'),
    'hammock': ('manifest.bayou.json', 'hammock_moss'),
    'firepit': ('manifest.levels.json', 'firepit_grill'),
}


def _s(id, w, d, h, budget, doc, **kw) -> LevelSpec:
    return LevelSpec(id=id, obj=kw.pop('obj', id), kind='floor', w=w, d=d, height=h, budget=budget,
                     category=kw.pop('cat', 'furniture'), doc=doc, tags=['outdoorOnly'] + kw.pop('tags', []), **kw)


def specs() -> Dict[str, LevelSpec]:
    l1 = 'L1-wormwood §4'
    yb = 'yard-building §1/§3'
    rows = [
        _s('picnic_table', 2, 3, 0.78, 2000, l1, tags=['seat', 'table', 'diningTable']),
        _s('swing_creaky', 2, 1, 2.25, 1400, l1, tags=['swing', 'play'], parts=['swing0', 'swing1'], paint='#7a4a3a'),
        _s('birdbath_skull', 1, 1, 1.02, 900, 'L1-wormwood §9 (premium decor)', tags=['decor', 'perch'], parts=['water']),
        _s('grill_bbq', 1, 1, 0.92, 1200, yb, tags=['grill', 'cook'], parts=['flame', 'lid']),
        _s('pond_yard', 2, 2, 0.30, 1400, yb, tags=['pond', 'water', 'decor'], parts=['water']),
    ]
    rows += _garden_rows()
    # cheap one-tile decor for start-lot variety (W-025 S7 start generator); catalog price about $10-40
    rows += [
        _s('stump_rotten', 1, 1, 0.51, 600, yb, cat='decor', tags=['decor', 'cheap', 'stump']),
        _s('branches_fallen', 1, 1, 0.25, 500, yb, cat='decor', tags=['decor', 'cheap', 'branches']),
        _s('rocks_small', 1, 1, 0.29, 600, yb, cat='decor', tags=['decor', 'cheap', 'rocks']),
    ]
    rows += [
        _s('shed_tool', 2, 2, 2.37, 3000, yb, cat='structures', tags=['shed', 'storage'], parts=['door'], paint='#6e5a48'),
        _s('gazebo_wilted', 3, 3, 3.62, 5500, l1, cat='structures', tags=['shelter', 'seat'], paint='#d9d4c6'),
        _s('greenhouse_grim', 2, 3, 2.40, 4000, yb, cat='structures', tags=['greenhouse', 'garden'], parts=['door'], paint='#3d5a4a'),
        _s('doghouse_crypt', 1, 1, 1.03, 1200, yb, cat='structures', tags=['doghouse', 'pet'], paint='#8a3b32'),
    ]
    return {s.id: s for s in rows}


#: growth stages are separate models: `<base>_s1` sprout / sapling, `_s2` growing / young, `_s3` ripe / mature
STAGES = (1, 2, 3)
CROPS = ('cabbage', 'mushroom', 'pumpkin')
TREES = ('rotapple', 'bonebirch', 'gravepine', 'bloodmaple')
FLOWERBEDS = ('nightshade', 'marigold', 'lily')

#: (height per stage, triangle budget per stage)
_CROP = {'cabbage': ((0.09, 0.15, 0.23), (400, 1000, 1800)),
         'mushroom': ((0.07, 0.12, 0.35), (400, 1200, 1800)),
         'pumpkin': ((0.12, 0.18, 0.38), (400, 1200, 1800))}
_TREE = {'rotapple': ((0.86, 2.2, 4.2), (400, 2200, 4500)),
         'bonebirch': ((0.95, 2.5, 4.7), (400, 1500, 3000)),
         'gravepine': ((0.98, 2.68, 5.18), (400, 1000, 1800)),
         'bloodmaple': ((0.85, 2.3, 4.0), (600, 2200, 3500))}
#: models whose placement outline is one convex hull: a crop is several separate plants standing on the plot,
#: and it is the plot that is placed, so the gaps between the plants are not walkable space
#: the gazebo is used through its seat frames (approach outside, pose inside), so it is solid for placement too
HULL_OUTLINE = frozenset(f'crop_{c}_s{st}' for c in CROPS for st in STAGES) | {'gazebo_wilted'}

_BED = {'nightshade': (0.32, 1500), 'marigold': (0.28, 1500), 'lily': (0.58, 1500)}


def _garden_rows():
    g = 'yard-building §1/§3'
    rows = [_s('garden_plot', 2, 2, 0.45, 900, g, cat='garden', tags=['garden', 'plot'])]
    for c in CROPS:
        hs, bs = _CROP[c]
        for st in STAGES:
            rows.append(_s(f'crop_{c}_s{st}', 2, 2, hs[st - 1], bs[st - 1], g, cat='garden', obj=f'crop_{c}',
                           variant=f's{st}', tags=['crop', c, f'stage{st}']))
    for t in TREES:
        hs, bs = _TREE[t]
        for st in STAGES:
            w = 2 if st == 3 else 1                       # a grown tree needs a 2 x 2 footprint
            rows.append(_s(f'tree_{t}_s{st}', w, w, hs[st - 1], bs[st - 1], g, cat='trees', obj=f'tree_{t}',
                           variant=f's{st}', tags=['tree', t, f'stage{st}']))
    for b in FLOWERBEDS:
        h, budget = _BED[b]
        rows.append(_s(f'flowerbed_{b}', 2, 1, h, budget, g, cat='garden', tags=['flowerbed', 'decor']))
    return rows
