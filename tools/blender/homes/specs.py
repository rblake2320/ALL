"""Home exterior shells (W-049): one per home, what other players see from the street.

docs/DESIGN_HOMES_SOCIAL_COLLECTIONS.md §8: every home type ships an exterior shell GLB with no interior nodes, so
another player's home renders without its interior ever being delivered. A lived-in home stays tile-built.

Each shell stands on its house's wall bounds from the level doc's lot map: `w` x `d` tiles (1 tile = 1 m), walls on
tile edges, centred on the origin, front toward glTF +Z (Blender -Y, the street). `doors` are the front doors'
x offsets from the house centre, read from the same maps (tools: see docs/desktop-reports/home-shells.md).
`lot_at` is where that wall rectangle starts on the lot map (tiles), so a shell can be stood exactly where the game
builds the house from the same map (manifest `lotRect`; S7 plan transforms mirror the lot about x = 15).

Budgets: <= 6,000 triangles (LOD0) and <= 2,000 (LOD1); at most three materials; no interior.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Tuple

BUDGET = (6000, 2000)
STOREY = 2.9


@dataclass
class ShellSpec:
    id: str
    name: str
    level: str                      #: L1 | L3 | L4 | L5
    home_class: str                 #: starter | cottage | apartment | stilt | mansion (housing-progression §3)
    lot: str                        #: LotDef id
    template: str                   #: lot template id
    w: int                          #: house width in tiles (glTF X)
    d: int                          #: house depth in tiles (glTF Z)
    doors: Tuple[float, ...]        #: front-door centres, x offset from the house centre (metres)
    style: str                      #: builder name in shells.py
    #: where the wall rectangle starts on the 30 x 30 lot map, in tiles (x0, z0); its size is w x d. The game's
    #: tile-built house stands there, so the shell is placed at (x0 + w/2, z0 + d/2) on the lot (manifest lotRect).
    lot_at: Tuple[int, int] = (0, 0)
    #: how far the shell may reach outside the w x d walls: (sides, back, front) in metres (eaves, porches, steps)
    reach: Tuple[float, float, float] = (0.8, 0.8, 3.0)
    height: Tuple[float, float] = (3.0, 9.0)      #: allowed overall height range, metres
    notes: List[str] = field(default_factory=list)


SPECS = {s.id: s for s in [
    # L1 Wormwood Heights
    ShellSpec('shell_starter', 'Fixer-Upper on Mildew Lane', 'L1', 'starter', 'wormwood:starter', 'starter',
              11, 10, (0.0,), 'starter', lot_at=(9, 9), height=(4.0, 7.0)),
    # the story-start shack (W-113): a lot template placed by the start generator at a Mildew Lane slot (W-025 §1.9),
    # so `lot` is the template id; walls x 11..19, z 13..19 on the template, front door at x 13
    ShellSpec('shell_derelict', 'The Condemned Shack on Mildew Lane', 'L1', 'starter', 'derelict', 'derelict',
              8, 6, (-1.5,), 'shack', lot_at=(11, 13), height=(4.0, 6.5)),
    # its two variants (src/sim/world/startTemplates.ts): lean = walls x 12..18, z 11..19, door at x 14;
    # lshape = x 10..18, z 11..19 with the main room x 10..15 / z 13..19 and the back room x 15..18 / z 11..17
    ShellSpec('shell_derelict_lean', 'The Leaning Shack', 'L1', 'starter', 'derelict_lean', 'derelict_lean',
              6, 8, (-0.5,), 'shack_lean', lot_at=(12, 11), height=(4.0, 6.5)),
    ShellSpec('shell_derelict_lshape', 'The Crooked-L Shack', 'L1', 'starter', 'derelict_lshape', 'derelict_lshape',
              8, 8, (-1.5,), 'shack_lshape', lot_at=(10, 11), height=(4.0, 6.5)),
    ShellSpec('shell_wormwood_bungalow', 'Sagging Bungalow', 'L1', 'cottage', 'wormwood:bungalow', 'wormwood_bungalow',
              13, 9, (-3.0,), 'bungalow', lot_at=(7, 11), height=(4.0, 7.0)),
    # L3 Downtown Rot Row (the lead's list places the townhouse here; its lot is wormwood:townhouse)
    ShellSpec('shell_wormwood_townhouse', 'Narrow Townhouse', 'L3', 'cottage', 'wormwood:townhouse', 'wormwood_townhouse',
              7, 15, (0.0,), 'townhouse', lot_at=(11, 6), height=(13.0, 16.5)),
    ShellSpec('shell_rotrow_walkup', 'Walk-Up 2A, Rot Row', 'L3', 'apartment', 'rotrow:walkup_2a', 'rotrow_walkup',
              12, 10, (0.5,), 'walkup', lot_at=(9, 10), height=(10.5, 13.0)),
    ShellSpec('shell_rotrow_loft', 'Market Street Loft', 'L3', 'apartment', 'rotrow:loft', 'rotrow_loft',
              16, 14, (-0.5,), 'loft', lot_at=(7, 5), height=(9.0, 12.0)),
    # L4 Swampside Bayou: the living storey sits one storey up on posts (quick-build §12)
    ShellSpec('shell_bayou_shotgun', 'Shotgun Stilt Shack', 'L4', 'stilt', 'bayou:shotgun', 'bayou_shotgun',
              8, 12, (-1.5,), 'stilt_shack', lot_at=(11, 10), reach=(0.8, 0.8, 5.8), height=(7.5, 10.5)),
    ShellSpec('shell_bayou_acadian', 'Raised Acadian Cottage', 'L4', 'stilt', 'bayou:acadian', 'bayou_acadian',
              14, 10, (-3.5, 3.5), 'stilt_cottage', lot_at=(8, 8), reach=(0.8, 0.8, 6.4), height=(9.5, 12.5)),
    ShellSpec('shell_bayou_fishcamp', 'Fish Camp on the Bend', 'L4', 'stilt', 'bayou:fishcamp', 'bayou_fishcamp',
              16, 14, (-3.5,), 'stilt_manor', lot_at=(12, 5), reach=(1.8, 1.8, 5.6), height=(8.0, 11.5)),
    # L5 Mausoleum Hills
    ShellSpec('shell_mausoleum_mansard', 'Mansard Manor', 'L5', 'mansion', 'mausoleum:mansard_manor', 'mausoleum_mansard',
              18, 17, (0.0,), 'mansard', lot_at=(6, 4), reach=(0.8, 0.8, 4.0), height=(9.5, 12.0)),
    ShellSpec('shell_mausoleum_ravenspire', 'Ravenspire Hall', 'L5', 'mansion', 'mausoleum:ravenspire', 'mausoleum_ravenspire',
              24, 15, (0.5,), 'ravenspire', lot_at=(3, 5), reach=(0.8, 0.8, 5.0), height=(16.0, 21.0)),
    ShellSpec('shell_mausoleum_glass', 'The Glass Mausoleum', 'L5', 'mansion', 'mausoleum:glass_mausoleum', 'mausoleum_glass',
              20, 14, (-2.5,), 'glass', lot_at=(5, 7), height=(7.0, 11.0)),
]}
