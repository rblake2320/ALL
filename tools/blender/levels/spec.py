"""Level model spec record (pure Python: no bpy, so tests can read the spec table with a system python3)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class LevelSpec:
    id: str                      #: model id == GLB file stem (unique in the level manifest)
    obj: str                     #: design-doc object/item id this mesh serves (e.g. 'grave_marked', 'item_curio')
    kind: str                    #: floor | wall | edge | opening | item | carry | env
    w: float                     #: footprint tiles along X (env: metres)
    d: float                     #: footprint tiles along Z/depth (env: metres)
    height: float                #: expected top (floor/item/env/edge/opening) or vertical extent (wall) in metres
    budget: int                  #: triangle cap (design doc "Tris" column, else ART_DIRECTION band)
    category: str                #: contact-sheet group
    doc: str                     #: design-doc reference (section)
    variant: Optional[str] = None
    parts: List[str] = field(default_factory=list)      #: required dynamic nodes
    tags: List[str] = field(default_factory=list)
    paint: Optional[str] = None  #: recolourable 'Paint' base colour (None = no Paint material)
    wall_centre: Optional[float] = None
    #: front rule for the orientation test: 'back_tall:<y>' (geometry above y metres sits behind the centre, -Z),
    #: 'facing:<node>' (>= 70% of that node's triangle area faces +Z), or '' (rotationally symmetric / n.a.)
    front: str = ''
    #: hidden in the default preview (state overlays) — also listed in the manifest as `states`
    states: List[str] = field(default_factory=list)
    notes: str = ''
