"""Street and district art kit (W-025 slice S9, docs/DESIGN_WORLD_LEVELS.md §1.2, §1.10, §3).

What a walkable street needs that did not exist as a model: a street nameplate, the "under construction" sign, the
road barrier and the construction fence that close an unfinished area, the kerb ramp at a crosswalk, and the
turning circle of a street end.

The road, the sidewalk and the crosswalk markings stay procedural (`asphaltCanvas`, `sidewalkCanvas` in
src/render/world): they are flat, they tile over any street length, and a mesh would add draw calls for nothing.
The kerb has height (CURB_TOP 0.13 m in dressing.ts), so the ramp through it is a mesh.
"""
from __future__ import annotations

from typing import Dict

from .spec import LevelSpec

LEVEL_ID = 'street'
DOC = 'docs/DESIGN_WORLD_LEVELS.md'

#: the renderer's kerb (src/render/world/dressing.ts CURB_W, CURB_TOP) and the design's street cell (§1.2)
CURB_W, CURB_TOP = 0.25, 0.13
ROAD_WIDTH, VERGE, CELL = 7.5, 1.0, 10.0

#: the turning circle is non-simulated dressing: one hull, like the other env models
HULL_OUTLINE = frozenset({'street_end_circle'})


def _s(id, kind, w, d, h, budget, **kw) -> LevelSpec:
    return LevelSpec(id=id, obj=kw.pop('obj', id), kind=kind, w=w, d=d, height=h, budget=budget,
                     category=kw.pop('cat', 'street'), doc='DESIGN_WORLD_LEVELS §3 S9', tags=kw.pop('tags', []), **kw)


def specs() -> Dict[str, LevelSpec]:
    rows = [
        _s('sign_street', 'floor', 1, 1, 2.67, 500, tags=['sign', 'street', 'text'], parts=['plate', 'plate_cross'],
           paint='#2f3a34'),
        _s('sign_construction', 'floor', 1, 1, 1.42, 600, tags=['sign', 'unfinished', 'text'], parts=['plate']),
        _s('barrier_road', 'floor', 3, 1, 1.13, 900, tags=['barrier', 'unfinished', 'blocksPath'], parts=['glow']),
        _s('fence_construction_run', 'edge', 1, 1, 1.86, 300, tags=['fence', 'unfinished']),
        _s('fence_construction_post', 'edge', 1, 1, 2.00, 300, tags=['fencePost', 'unfinished']),
        _s('curb_ramp', 'floor', 2, 1, 0.14, 400, tags=['kerb', 'crosswalk']),
        _s('street_end_circle', 'env', 10, 10, 1.05, 1500, tags=['streetEnd']),
    ]
    return {s.id: s for s in rows}
