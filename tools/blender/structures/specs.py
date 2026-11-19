"""Stand-alone kit for W-032 part 2 (decision D-038): parking objects from docs/systems/vehicles.md §5 and the
Quick Build stairs, ramps and pillars from docs/systems/quick-build.md §4.4 and §11, one GLB per material tier.

These are NOT catalogue objects yet: the catalogue/ObjectDef entries are registered with W-030/W-031.

Axes are the objects pipeline's: Blender front = -Y (glTF +Z), Z up (glTF +Y), 1 unit = 1 tile = 1 m, floor
pieces centred on their footprint with the base at z = 0.

Stairs and ramps climb along local +Z in glTF (Blender -Y): the bottom edge is at glTF z = -run/2 on the floor,
the top edge at z = +run/2 at the height of the next storey (STOREY_HEIGHT = 2.9 m).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

FENCE_STYLES = ('picket', 'iron', 'bone', 'hedge', 'stone')
FENCE_MAX_HEIGHT = 1.2   # yard-building §1: low and see-through for the cutaway
CURB_SET_BUDGET = 1200   # housing-progression §15: each band's set of dressing
STOREY_HEIGHT = 2.9      # DIM.WALL_HEIGHT + DIM.FLOOR_SLAB (docs/systems/quick-build.md §3)
WALL_HEIGHT = 2.7
MATERIALS = ('wood', 'stone', 'metal')   # QbMaterial


@dataclass
class StructSpec:
    id: str
    kind: str                 #: stairs | grandStairs | ramp | pillar | landing | edge | parking | opening | project | curb
    #:                          | fence | fencePost | gate
    w: float                  #: footprint tiles across (glTF X)
    d: float                  #: footprint tiles along the run / depth (glTF Z)
    budget: int
    doc: str
    material: Optional[str] = None
    parts: List[str] = field(default_factory=list)
    rise: Optional[float] = None      #: stairs/ramps: height gained over the run
    height: Optional[float] = None    #: expected top of the walkable/structural part (None = not checked)
    #: parking objects: spots in the shape of docs/systems/vehicles.md §5 `PhysicalSpec.parking`, glTF local
    #: coords: {x, z, rot (degrees about +Y, 0 = the vehicle's nose toward +Z), size: 'small' | 'car'}
    spots: List[dict] = field(default_factory=list)
    options: List[List[int]] = field(default_factory=list)   #: alternative ways to fill the spots (indices)
    needs_street: bool = False
    lods: bool = False                #: also built as <id>_lod1.glb (authored lower detail, same silhouette)
    band: Optional[int] = None        #: curb-appeal pieces: the level band whose set this piece belongs to (1, 2 or 3)
    style: Optional[str] = None       #: yard fences: picket | iron | bone | hedge | stone

    @property
    def budget_lod1(self) -> int:
        return int(self.budget * 0.45)


def _all() -> List[StructSpec]:
    out: List[StructSpec] = []
    for mat in MATERIALS:
        out += [
            StructSpec(f'qb_stairs_{mat}', 'stairs', 1, 3, 1800, 'quick-build §4.4/§11', mat, rise=STOREY_HEIGHT),
            StructSpec(f'qb_grandstairs_{mat}', 'grandStairs', 3, 3, 3500, 'quick-build §4.4/§11', mat, rise=STOREY_HEIGHT),
            StructSpec(f'qb_ramp_{mat}', 'ramp', 3, 3, 1200, 'quick-build §4.4/§11', mat, rise=STOREY_HEIGHT),
            StructSpec(f'qb_ramp_narrow_{mat}', 'ramp', 1, 3, 1200, 'quick-build §6 (Alt = narrow ramp)', mat, rise=STOREY_HEIGHT),
            StructSpec(f'qb_pillar_{mat}', 'pillar', 1, 1, 400, 'quick-build §6/§11', mat, height=WALL_HEIGHT),
            # W-083: the guard rail for the edges of a stairwell opening (a 0.9 m 'Half' railing, one tile long,
            # centred on the tile edge) and a free-standing landing at storey height
            StructSpec(f'qb_stairwell_rail_{mat}', 'edge', 1, 0.2, 300, 'quick-build §4.4 (stairwell)', mat),
            StructSpec(f'qb_landing_{mat}', 'landing', 1, 1, 500, 'quick-build §4.4 (stair exit)', mat, height=STOREY_HEIGHT),
        ]
    out += [
        # 1 car OR 2 small
        StructSpec('pad_driveway', 'parking', 2, 5, 300, 'vehicles §5', needs_street=True,
                   spots=[dict(x=0.0, z=0.0, rot=0, size='car'), dict(x=0.0, z=1.25, rot=0, size='small'),
                          dict(x=0.0, z=-1.25, rot=0, size='small')], options=[[0], [1, 2]]),
        # 1 car + 1 small
        StructSpec('carport_crooked', 'parking', 3, 6, 2800, 'vehicles §5', needs_street=True,
                   spots=[dict(x=0.5, z=0.0, rot=0, size='car'), dict(x=-1.0, z=0.6, rot=0, size='small')], options=[[0, 1]]),
        # 2 small, parked across the rack
        StructSpec('rack_bike', 'parking', 1, 2, 500, 'vehicles §5',
                   spots=[dict(x=0.0, z=0.44, rot=90, size='small'), dict(x=0.0, z=-0.44, rot=90, size='small')], options=[[0, 1]]),
        StructSpec('door_garage', 'opening', 3, 0.4, 1600, 'vehicles §5', parts=['door']),
        # 1 car OR 2 small, indoors
        StructSpec('pad_garage', 'parking', 3, 6, 100, 'vehicles §5',
                   spots=[dict(x=0.0, z=0.0, rot=0, size='car'), dict(x=-0.6, z=0.0, rot=0, size='small'),
                          dict(x=0.6, z=0.0, rot=0, size='small')], options=[[0], [1, 2]]),
    ]
    # the crew's kit for timed home projects (docs/systems/housing-progression.md §6.3, §15): dressing, passable.
    # `scaffold_project` is the ready-made three-tile run (the spec's object id, <= 1,800 triangles); the other
    # pieces are the same parts on their own, for the renderer to instance around larger project bounds.
    hp = 'housing-progression §6.3/§15'
    out += [
        StructSpec('scaffold_project', 'project', 3, 1, 1800, hp, parts=['glow', 'tarp']),
        StructSpec('scaffold_bay', 'project', 2, 1, 600, hp),
        StructSpec('scaffold_ladder', 'project', 1, 1, 300, hp),
        StructSpec('scaffold_tarp', 'project', 2, 1, 400, hp, parts=['tarp']),
        StructSpec('lantern_crew', 'project', 1, 1, 400, hp, parts=['glow']),
    ]
    # curb-appeal dressing (housing-progression §5/§15; pieces per band from the lead, PR #1 comment 6673034866).
    # A SET is a band's four pieces together, and the set must stay within CURB_SET_BUDGET triangles.
    cb = 'housing-progression §5/§15 (curb appeal)'
    out += [
        StructSpec('curb_fence_picket', 'curb', 1, 0.2, 300, cb, band=1),
        StructSpec('curb_mailbox', 'curb', 1, 1, 300, cb, band=1),
        StructSpec('curb_flowerbed', 'curb', 2, 1, 400, cb, band=1),
        StructSpec('curb_gnome_skull', 'curb', 1, 1, 300, cb, band=1),
        StructSpec('curb_planter', 'curb', 1, 1, 400, cb, band=2),
        StructSpec('curb_porch_light', 'curb', 1, 1, 300, cb, parts=['glow'], band=2),
        StructSpec('curb_bench', 'curb', 2, 1, 300, cb, band=2),
        StructSpec('curb_bike_rack', 'curb', 1, 1, 300, cb, band=2),
        StructSpec('curb_topiary', 'curb', 1, 1, 400, cb, band=3),
        StructSpec('curb_fountain', 'curb', 2, 2, 500, cb, parts=['water'], band=3),
        StructSpec('curb_gate_iron', 'curb', 1, 0.2, 400, cb, band=3),
        StructSpec('curb_lamp_post', 'curb', 1, 1, 300, cb, parts=['glow'], band=3),
    ]
    # yard fences and gates (docs/systems/yard-building.md §1/§3, W-109): drawn on tile edges like walls, but low
    # (<= FENCE_MAX_HEIGHT) so the yard stays visible. Per style: a 1 m run that tiles with no post of its own, a
    # post for corners and ends, and a gate whose leaf is the `door` node, hinged at its origin.
    yb = 'yard-building §1/§3'
    for style in FENCE_STYLES:
        out += [
            StructSpec(f'fence_{style}_run', 'fence', 1, 0.5, 300, yb, style=style),
            StructSpec(f'fence_{style}_post', 'fencePost', 0.5, 0.5, 300 if style == 'bone' else 200, yb, style=style),   # the bone post carries a skull
            StructSpec(f'fence_{style}_gate', 'gate', 1, 0.5, 700, yb, parts=['door'], style=style),
        ]
    for s in out:
        s.lods = s.id.startswith('qb_')
    return out


SPECS = {s.id: s for s in _all()}
