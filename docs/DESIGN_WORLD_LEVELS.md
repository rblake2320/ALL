# World framework & levels — design (W-015..W-020, framework = W-025)

Contract: `src/shared/world.ts` (types + pure helpers, tests in `tests/unit/shared/world.test.ts`). Per-level detail docs:
`docs/levels/L*.md`. Decisions: **D-068** (walkable connected world; supersedes "one simulated lot at a time") and
**D-069** (shared regional calendar, §1.17; contract `src/shared/calendar.ts`, tests in
`tests/unit/shared/calendar.test.ts`).

## 1. Framework (W-025): a walkable, connected world

**Player promise.** Your zombie walks out of the front door, down Mildew Lane, through a neighbour's front yard and in
at the Old Graveyard gate, with no loading screen anywhere along the way. Each new world starts somewhere different:
another lot shape, another shack, other neighbours, another spot on the street. The world is single-player and grows
over time: districts that are not built yet are fenced off with an honest "Under construction" sign, and they open in
later versions without breaking saves.

Numbers below were measured in this container (Node 22.23, `vite-node`, cloud VM, CPU model not reported) unless
marked **ASSUMPTION**. Every assumption is listed again in §1.14 with how a slice verifies it.

### 1.1 What exists today (read from the code)

| Fact | Where | Consequence for the design |
|---|---|---|
| A lot is a 30 × 30 tile grid, 1 tile = 1 world unit ≈ 1 m; buildable x [1,29) × z [1,27); sidewalk row z = 28; street beyond z = 30; entry points (0.5, 28.5) and (29.5, 28.5) | `src/sim/spatial/templates/builder.ts` `newLot()`, `src/shared/dimensions.ts` | Neighbouring lots' sidewalks already line up end to end: the two entry points become the **sidewalk portals**. No template changes. |
| `WorldState` has exactly one `lot`, one `objects` map, one `agents` map; objects and agents use lot-local coordinates | `src/sim/types.ts` | The home keeps `WorldState.lot`; other regions are added beside it. 43 `.lot` reads in 19 sim files outside `spatial/`, 143 `objects` references (grep) form the S1 audit surface. |
| Grid search is an 8-neighbour Dijkstra with early exit (not A*), plus string pulling; field cache LRU of 32; lots larger than 256 are clamped | `src/sim/spatial/pathfinding.ts`, `grid.ts` | Keep it for the local leg (paths in the home lot stay byte-identical). Measured below: one big stitched grid costs much more. |
| Tick = 0.25 game min; walk 1.3 tiles / game min; speed 3 = 8 game min/s = 32 ticks/s; ultra 30 game min/s = 120 ticks/s; ≤ 400 ticks per frame; per-frame tick CPU budget 28 ms (excess ticks dropped, never carried) | `src/sim/types.ts`, `src/sim/engine/constants.ts`, `src/game/loop.ts` | Radii in tiles convert to walking time (§1.4). A slow device slows game time instead of stuttering. |
| The renderer builds one lot and fakes the neighbourhood outside it (`envLayout`: 11 `env_house_*`, trees, lamps; 7.5 m road + 0.25 m curbs; 300 m ground; fog) | `src/render/world/dressing.ts` | Real neighbouring regions replace the fake houses near the player. The fake ring stays as the far backdrop beyond the world's edge. |
| Static objects merge into 8 × 8-tile chunks (a 30 × 30 lot = 4 × 4 chunks) | `src/render/objects/chunks.ts` `CHUNK_TILES` | A warm (low-detail) region is one merged mesh at a few draw calls. |
| Saves: one envelope, canonical JSON, gzip, SHA-256; `MIGRATIONS` empty at schema v1; journal epochs bind to the snapshot's `payloadSha256`; two-phase rebase (W-119: `mark` → `stage` → `committed` / `abandoned`) | `src/persistence/*`, `src/game/journal.ts`, `saveFlow.ts`, ARCHITECTURE §4.1 | The whole world stays ONE payload. No per-region storage keys, so every journal epoch still binds to exactly one snapshot. |
| `TownState` (v1) exists only as a type; `src/shared/world.ts` is imported nowhere | grep | Nothing to migrate from v1 `TownState`; old saves simply lack `town`. |

**Measured sim cost** (`sim.step()` over 6 game hours after warm-up, real content, seed 7):

| Template | on-lot agents | objects | ms / tick | world JSON | gzip | lot JSON | objects JSON |
|---|---|---|---|---|---|---|---|
| derelict | 1 / 4 / 8 | 10 | 0.22 / 0.30 / 0.51 | 48 / 55 / 67 KB | 6–8 KB | 8.1 KB | 2.5 KB |
| starter | 1 / 4 / 8 | 44–46 | 0.14 / 0.24 / 0.53 | 60 / 67 / 84 KB | 7–10 KB | 11.1 KB | 11–12 KB |
| empty | 2 / 4 / 10 | 2 | 0.09 / 0.18 / 0.45 | 43 / 51 / 66 KB | 6–8 KB | 4.6 KB | 0.5 KB |

Cost grows with **agents** (≈ 0.055 ms per extra on-lot agent per tick), barely with objects. The 24 townies' records
(35–50 KB) dominate save size, not the lot.

**Measured grid cost** (`distanceField` / far `findPath`, each including a grid rebuild after `lot.version++`):

| Grid | tiles | distance field | far path |
|---|---|---|---|
| 30 × 30 (one lot) | 900 | 0.72 ms | 0.44 ms |
| 64 × 64 | 4,096 | 1.37 ms | 1.25 ms |
| 96 × 96 (3 × 3 lots stitched) | 9,216 | 2.51 ms | 2.76 ms |
| 128 × 128 | 16,384 | 6.74 ms | 6.09 ms |

Stitching active lots into one grid would cost 3–9× per search and invalidate every cache on any change in any lot.
So each region keeps its own grid, and a small portal graph joins them (§1.7).

### 1.2 Topology: cells, regions, portals

- **World tile coordinates are signed:** integers in [−1,280, 1,280) on both axes (`WORLD_MIN_TILE`,
  `WORLD_MAX_TILE`), X right, Z toward "south", 1 tile = 1 m, the same axes as a lot. Continuous positions are floats
  in tile units. The Mildew Lane layout sits near the origin, and districts grow in every direction, including north
  (−Z) and west (−X), without moving any placed region. The legacy home placement (70, 0) is valid under the same rule.
  (Review fix, Sol on PR #57: the first draft documented negative-coordinate growth but its helpers rejected
  negative origins.)
- **Cell** = 10 × 10 world tiles (`CELL_TILES = 10`). Signed cell (cx, cz) = (⌊wx / 10⌋, ⌊wz / 10⌋) ∈ [−128, 128)².
  Its packed id is `(cz + 128) × 256 + (cx + 128)` (`cellIdOfWorldTile`): non-negative and unique, with floor
  semantics, so tile −1 lies in cell −1. A standard lot
  is exactly 3 × 3 cells. A street is 1 cell wide: 1 m verge + 0.25 m curb + 7.5 m road (today's `ROAD_WIDTH`) +
  0.25 m curb + 1 m verge = 10 m. Cells are the unit of world layout, streaming bookkeeping and the overview map.
  Simulation still happens per tile in each region's own grid. The world may span 256 × 256 cells (a defensive bound
  against corrupt saves, like the grid's `MAX_DIM`).
- **Region** = one rectangular grid of whole cells with its own lot-local tile grid (`LotState`), a `LotPlacement`
  (origin + quarter-turn rotation, see §1.3) and a kind:
  - `lot`: residential or community, 30 × 30 tiles, built from a lot template;
  - `street`: a street segment, 30 × 10 tiles per lot frontage, or 10 × 10 for street ends and corners. Road, curbs,
    verges, crosswalk tiles; no buildable area;
  - `path`: a footpath or alley, used between districts;
  - `unfinished`: fenced and signed, not walkable, not simulated (§1.10).
  RegionId: lots use their LotDef id `<levelId>:<slot>` (e.g. `wormwood:mildew_n2`), streets `street:<street>:<n>`,
  unfinished areas `unfinished:<slug>` (`RegionId` in world.ts).
- **Portal** = a pair of lot-local tiles in two adjacent regions that an agent may step between (`PortalDef`):
  - `sidewalk`: lot ↔ lot, at the sidewalk ends (today's entry points). The row z = 28 continues from one lot to
    the next, which gives a continuous pavement along the street.
  - `crosswalk`: lot sidewalk ↔ street, 2 tiles wide, one per lot frontage at local x 14–15, the front-path column of
    the shipped templates. Also street ↔ street.
  - `gate`: an opening object on a fence edge (`gate_iron`, `fence_*_gate`). It is closed or locked by object state.
  - `path`, and `stairs` (L6 floor −1, D-053; a vertical portal).
  Side-yard crossings between neighbouring lots (no fence, any tile along the shared edge) are **not** portals in v1.
  This keeps the portal graph small, respects fences and privacy, and matches how people walk down a street. A
  yard-building gate (W-109) can add a `gate` portal later.

**Mildew Lane district** (v1 world map, generator version 1, world tiles):

```
 x:   0        30 40       70      100      130     160 170      200
 z=0  .        .  +--n1---+--n2---+--n3---+--n4---+   .
      .        .  | rot 0 (fronts face +Z, today's orientation)   .
 z=20 +-park--+   |       |       |       |       |   +-graveyard-+
      | rot 3 |   |       |       |       |       |   |  rot 1    |
 z=28 |(front |   |=======sidewalk portals (z=28)=|   |(front -X) |
 z=30 |  +X)  |[e]|--street:mildew:1..4 (road)----|[e]G gate      |
 z=40 |       |   |=======sidewalk (world z=41)===|   |  x 171.5  |
 z=50 +-------+   +--s1---+--s2---+--s3---+--s4---+   +-----------+
                  | rot 2 (fronts face −Z, across the street)      .
 z=70             +-------+-------+-------+-------+
 [e] = street-end cell (10 × 10: turning circle + crosswalks), G = graveyard gate portal (world 171.5, 34.5)
 beyond x < 0, z < 0, z > 70, x > 200: unfinished / unexplored frontier (fenced, signed), then the fake backdrop + fog
```

| Region | kind | placement (originX, originZ, rot) | world rect |
|---|---|---|---|
| `wormwood:corner_park` | lot (park) | (0, 20, 3) | x 0–30, z 20–50 |
| `street:mildew:0` | street end | (30, 30, 0), 10 × 10 | x 30–40, z 30–40 |
| `wormwood:mildew_n1` … `n4` | lot | (40 + 30i, 0, 0) | x 40–160, z 0–30 |
| `street:mildew:1` … `4` | street | (40 + 30i, 30, 0), 30 × 10 | x 40–160, z 30–40 |
| `wormwood:mildew_s1` … `s4` | lot | (40 + 30i, 40, 2) | x 40–160, z 40–70 |
| `street:mildew:5` | street end | (160, 30, 0), 10 × 10 | x 160–170, z 30–40 |
| `graveyard:old_graveyard` | lot (community) | (170, 20, 1) | x 170–200, z 20–50 |

With these placements the graveyard's main gate (local x 14–15 at the sidewalk, L2 §3) lands at world (171.5, 34.5),
in the middle of the street band. The east street end leads straight in, and the unit test in
`tests/unit/shared/world.test.ts` pins the geometry. The 8 residential slots hold the home plus 7 neighbours (§1.9).
The old LotDef ids `wormwood:starter` / `wormwood:empty` / `wormwood:bungalow` / `wormwood:townhouse` stay valid as
**template catalogue entries** for New Game and Move Household (D-046). The physical lots are the slot ids above.
`LotDef.mapX/mapZ` become the overview-map pins only.

### 1.3 World ↔ lot coordinates

All simulation code stays **lot-local**: `ObjectState.placement`, `AgentState.pos`, paths, walls (`h:x:z` edges),
floors and the cutaway are unchanged. A region's `LotPlacement` maps lot-local to world coordinates
(`lotToWorld` / `worldToLot`, tile variants `lotTileToWorldTile` / `worldTileToLotTile`, facing
`lotFacingToWorld` / `worldFacingToLot`). Rotation `rot` = quarter turns. The lot front (+Z local, toward its
street) faces world +Z / −X / −Z / +X for rot 0 / 1 / 2 / 3:

| rot | world (x, z) of lot point (x, z) | footprint |
|---|---|---|
| 0 | (ox + x, oz + z) | W × D |
| 1 | (ox + D − z, oz + x) | D × W |
| 2 | (ox + W − x, oz + D − z) | W × D |
| 3 | (ox + z, oz + W − x) | D × W |

The transforms are exact for integer and half-integer inputs (a round trip gives exactly the input), never return
−0, and return null (NaN for facing) on any non-finite input or malformed placement. World coordinates are used only
for:
- streaming distances (§1.4);
- the portal-graph heuristic (§1.7);
- render group transforms;
- the camera;
- the overview map;
- hearse distances.

**How the existing single lot maps in:** an old save's lot becomes the home region at `wormwood:mildew_n2`, origin
(70, 0), rot 0. Its `LotState` and objects are kept byte for byte, and objects and agents without a `regionId` belong
to the home (§1.11).

### 1.4 Streaming: sim tiers and render tiers

Two separate tier systems. The **sim tier** is part of the world state and decides what is simulated. It depends
only on world data (household positions, tick), never on the camera or the device, so the same save gives the same
result on every machine. The **render tier** is view-only, may differ per device, and never feeds back into the sim.

**Sim tiers** (evaluated every 4 ticks = 1 game minute, at the start of `step()`, deterministic order by RegionId):

| Rule | Value | Why |
|---|---|---|
| Home region | **always active** | Keeps today's home systems (fridge, fire, bills, decay, garden) running unchanged with no catch-up. An empty furnished lot costs ≈ 0.1 ms/tick (agents dominate, table above). |
| Enter active | region rect within **45 tiles** (Chebyshev, world) of any household member's world position, or a member stands in it | A walker needs 45 / 1.3 ≈ 35 game min to reach it: the region is built and caught up long before arrival. 45 tiles from a Mildew Lane sidewalk covers both neighbours, the three lots across the street and the street segments. |
| Leave active | rect farther than **60 tiles** from every member **and** ≥ **120 ticks** (30 game min) since its last tier change | 15-tile band = 11.5 game min of walking, plus a minimum dwell, so pacing at a boundary cannot thrash. |
| Household-held regions (**review fix**) | every region a household member stands in is **always live**, as is the home. They are never capped, never frozen, and selecting a member is never refused | A member is always simulated correctly, wherever the player sends them. |
| Surroundings budget | the 45-tile surroundings add lots only up to **6 live lots in total**: `max(0, 6 − home-and-member-held lots)`. Streets/paths: ≤ **8**. Nearest first (ties: RegionId). `selectLiveRegions` in world.ts | Splitting the household spends the surroundings budget instead of growing past it. |
| **Worst-case live lots** | **9** = home + 8 members, each in a different lot (`LIVE_LOT_WORST_CASE`), with no surroundings. Together (the normal case): **≤ 6** | Lot count is not the cost driver. The cost is ≈ 0.1 ms per extra (nearly empty) lot + agents, so 9 lots + 32 agents ≈ 2.7 ms/tick worst case here, ≈ 3.6 ms/frame at ultra. |
| Crossing into a dormant region | a member who reaches a portal into a dormant region activates it **in that same tick, before the crossing**: build the grid (≈ 0.7 ms) + portal fields (≤ 6 ms) + closed-form catch-up. It is pre-activated 10 tiles ahead when the budget allows | No member ever stands in a frozen region; the worst one-off spike (8 members crossing in one tick) ≈ 55 ms, which the per-frame tick budget absorbs as slowed time. |
| Simulated agents | ≤ **32** world-wide: 8 household (GDD §9) + ≤ 24 others; ≤ **8 townies per lot region**, + ≤ 2 venue NPCs + ≤ 3 strays on community lots (levels README §4) | Measured ≈ 0.14 + 31 × 0.055 ≈ **1.9 ms/tick** for 32 agents here: speed 3 = 32 ticks/s ≈ 61 ms CPU per real second (≈ 1 ms/frame at 60 fps); ultra (120 ticks/s, only while all members sleep) ≈ 3.8 ms/frame. Townies are what the cap trims (they stay on their schedules); members never are. |
| Dormant region | snapshot only (`RegionSnapshot`); townies there exist only as schedule entries (§1.6) | Zero per-tick cost. |

**Render tiers** (view-only; recomputed per frame from the camera focus, with hysteresis):

| Tier | Desktop | Phone | What is drawn |
|---|---|---|---|
| active | sim-active regions within the warm radius of the camera, at most the **6 nearest lots** to the camera (a split household's far member lots render as warm shells or not at all until the camera goes there) | same | Full detail: objects (chunked), walls + cutaway, floors, agents, lights. |
| warm | rect within **120 tiles** of the camera focus (leave at 140) | **75** (leave at 90) | Low-detail shell: one merged static mesh per region (walls up, roof shell, yard objects), window glow, no interiors, no agents; no shadows on phone. ≤ 4 draw calls per region. |
| cold | beyond | beyond | Not drawn: today's `envLayout` backdrop ring beyond the world's extent, plus fog. |

Warm regions are built in the background (≤ 4 ms of build work per frame, spread across frames) before they can turn
active, so walking into a region never waits for assets. The camera may pan only over active + warm rects (camera
bounds = their union), never into cold land. Selecting or following a member who is somewhere else (a split
household) moves the camera focus to them, and their surroundings stream in around the new focus. Should a region turn sim-active before its render shell is ready (an
asset is late), the sim does not wait. The renderer draws its agents on a flat placeholder ground until the shell
lands, the same late-asset behaviour as today (`assets-late` rebuild).

**Render budgets** (busiest view; desktop = the existing ≤ 650 draw-call stress budget, levels README §7):

| Part | Desktop draw calls | Phone draw calls (**ASSUMPTION**, Low quality, no shadows) |
|---|---|---|
| focused lot (objects in 8 × 8 chunks, walls, floors, openings) | ≤ 150 | ≤ 80 |
| other active lots (≤ 5) | ≤ 5 × 30 = 150 | ≤ 5 × 15 = 75 |
| warm regions | ≤ 16 × 4 = 64 | ≤ 8 × 3 = 24 |
| agents at full detail (nearest to the camera) | ≤ 20 × ~10 = 200 | ≤ 12 × ~8 = 96 |
| farther agents as a 1-draw capsule LOD (existing capsule rig, W-056) | ≤ 12 | ≤ 12 |
| street dressing, sky, lamps, post | ≤ 70 | ≤ 40 |
| **total** | **≤ 646 (≤ 650)** | **≤ 327 (budget ≤ 350)** |

Other budgets:

| Budget | Desktop | Phone |
|---|---|---|
| Triangles visible | ≤ 1.5 M | ≤ 400 k (**ASSUMPTION**) |
| Memory | RAM < 1.5 GB total (levels README §7) | JS heap ≤ 250 MB, GPU ≤ 300 MB (**ASSUMPTION**) |
| Frame time | p95 ≤ 33.3 ms at the probed quality (W-039 Auto rule) | p95 ≤ 33.3 ms at Low |
| Sim memory | ≈ 10–25 KB JSON per dormant visited region (measured lot + objects): ~2.5 MB for 100 visited regions | same |

### 1.5 Simulation across regions

- **Engine.** `step()` keeps its order (README §5) but iterates the on-lot agents of **all active regions**, sorted by
  numeric id as today. For a home-only world the iteration order, RNG draws and results are identical to the current
  engine (AC-1). Each active region owns a spatial service: grid, `FieldCache(32)`, room map. A context gains
  `ctx.regionOf(agentId)` and `ctx.lotOf(regionId)`. `state.lot` stays the home lot, so home systems keep working.
- **State.** `AgentState.regionId?` and `ObjectState.regionId?` (absent = home; sim-owned type change in S1).
  Objects never change region. A carried item (`held`) travels with its holder and takes the holder's region when
  dropped. A dormant region's objects move out of `state.objects` into its `RegionSnapshot.objects`, which keeps the
  per-tick object set small. They move back on activation.
- **Crossing a boundary.** Movement (README §9) moves an agent along its local path. When the agent passes the portal
  tile's outer edge within a tick:
  - its `regionId` switches;
  - `pos` and `prevPos` are transformed through world coordinates (`worldToLot(b, lotToWorld(a, p))`), and so is
    `facing`;
  - the next local leg is planned in region b from the stored route.
  This all happens inside the movement phase of that tick, so it is deterministic and save/load-safe. The renderer
  interpolates world positions, so a crossing is visually seamless. If region b is not active (only possible for a
  townie, because members keep their surroundings active), the townie leaves the simulation at the portal and
  continues on its schedule (§1.6).
- **Interactions** resolve targets (objects, seats, tags) only in the actor's current region. A queued interaction
  whose target object is in another region gets a route stage first: walk via portals to the target's region, then
  the normal stage resolution. `engine_goHere` accepts a world tile (`params.wx/wz`). `engine_exitLot` becomes
  "walk to the district edge portal".
- **Townies on schedules** (§1.6) and **catch-up** (§1.8) feed regions as they activate.
- **Ownership** (what the player may do where):

| Region | Walk | Use objects | Build / Buy | Notes |
|---|---|---|---|---|
| Home (and later `ownedLotIds`) | yes | yes | **yes** | Full build/buy, as today. |
| Neighbour's residential lot | sidewalk, front path, yard | yard objects tagged `public` (bench, birdbath) | no | The house interior is entered only when welcomed: knock → the owner townie answers (friendship ≥ 0, 09:00–21:00, owner home) → welcomed for 2 h (the existing `VisitState.welcomed` idea, mirrored). Doors of townie homes are passable only for residents and welcomed agents. |
| Vacant lot ("For Sale" sign) | yes | no | no; it can be **bought** (Move Household D-046 / claim, §1.10) | |
| Community lot (park, graveyard, venues) | yes, within opening hours | venue interactions | no (L2 rule) | Closed venue = locked gate + sign with the hours. |
| Street / path | yes | dressing only | no | Road tiles cost +2 per step, crosswalk tiles cost 1, so paths use crosswalks. |
| Unfinished | no (fenced) | read the sign | no | §1.10. |

### 1.6 Townies on schedules

- The pool (24 Wormwood townies today, shared with the graveyard, L1 §8) gets **homes**: the 7 neighbour lots hold
  2–3 townies each (≈ 17). The rest live off-map, behind the district-edge portal toward the unfinished frontier.
- **Schedule** = a pure function `(worldSeed, townieId, day) → stops[]` of `{fromMin, toMin, regionId, activity}`:
  home overnight, work (off-map), venue visits drawn from each venue's hourly arrival weights (L-docs), walks.
  Uses `hash32`, never `WorldState.rng`, so abstract townies consume no RNG.
- **Materialise** when the scheduled region is active and the region's townie cap (8) is not reached (priority by
  `hash32(day, townieId)`, ties by id). The townie spawns at its scheduled spot, or at the region's entry portal when
  the schedule says it is mid-walk. **Dematerialise** when it walks out of the active set or its stop ends in a dormant
  region. Its needs advance in closed form from its last sim tick.
- Walk-bys (`WalkByState`) stay: a walk-by is a scheduled townie whose route passes the home's sidewalk.

### 1.7 Pathfinding across regions (hierarchical)

1. **Portal graph.** Nodes = portal endpoints. Edge kinds:
   - intra-region: the local Dijkstra distance between two portal tiles of the same region, computed when the region
     activates (≤ 8 portals per lot → ≤ 8 fields × 0.72 ms ≈ 6 ms once, cached by `lot.version`);
   - dormant regions: the last computed costs kept with the snapshot, or for never-built regions the template's
     precomputed costs;
   - crossing: one step.
   Size: Mildew Lane + graveyard ≈ 60 nodes; bound 2,000 nodes world-wide.
2. **Route** = A* on the portal graph (heuristic: world Euclidean distance; ties by portal id). The result is a list of
   portal ids, stored on the agent's active run (`run.data._route`), so it is saved and survives load.
3. **Local leg** = the existing `findPath` inside the current region to the next portal tile (or the final target),
   re-planned at each region entry or when the region's `lot.version` changes. The home lot's paths stay
   byte-identical.
4. **Doors, gates, curbs.** Each region grid builds two step masks: **public** and **resident** (900 bytes each per
   lot). Doors of townie homes and gates marked `private` are closed in the public mask, and a welcomed agent uses the
   resident mask. A `gate` portal is passable while its gate object is not locked (closed gates open on approach like
   doors today; venue gates lock outside opening hours). Curbs carry no height in the sim (`posY` 0). The renderer
   draws a 0.13 m curb (`CURB_TOP`) with ramps at crosswalks, and road tiles' +2 cost keeps routes on crosswalks.
5. **Failure.** No route → the existing route-fail semantics (`ROUTE_MAX_FAILS`, "Can't get there"). A route through a
   region that locks meanwhile (venue closes) re-plans at the next region entry.

### 1.8 Catch-up when a region reactivates

- Inputs: `(RegionSnapshot, caughtUpTick, now, hash32(worldSeed, regionIdHash, caughtUpTick, now))`. Output: the
  updated snapshot data and `caughtUpTick = now`. It never reads or advances `WorldState.rng`, never replays ticks,
  and runs once per activation.
- **Idempotent:** a second call with the same `now` sees `caughtUpTick == now` and changes nothing (apply twice =
  apply once, byte for byte).
- **Split-invariant:** every rule is written against absolute-tick schedules (e.g. "dirt +1 at every in-game midnight
  crossed", "an item despawns at foundTick + 48 h", "a mound re-settles at dugTick + 24 h", garden stage = f(plantTick,
  now)), so catching up a→c equals a→b then b→c. Determinism then does not depend on when a region happened to
  activate.
- Rules per kind:
  - neighbour residential: dirt, garden stages, item despawn;
  - community lots: per their L-doc (levels README §4: mounds, strays, items, dirt);
  - streets: dropped items despawn.
  The home never needs catch-up (always active).

### 1.9 Starting-point variation (seeded, bounded, always playable)

New Game keeps the D-060 choice of **lot type** (default derelict "The Condemned Shack" with Act 1; "Move-in ready
(sandbox)" `starter`; `empty`). The seed varies **where and how** that start looks:

1. `pickStart(seed, spec, attempt)` (world.ts, pure, frozen hash) picks a template from the weighted pool, the
   **street slot** (`mildew_n1`…`n4`, `mildew_s1`…`s4`), a `variantSeed` and a `neighbourSeed`. v1 pool for the
   story start: `derelict` (weight 3) plus two proposed derelict variants, `derelict_lean` and `derelict_lshape`
   (weight 1 each; new template data for Claude Cloud). `starter` / `empty` use their own single template.
2. The generator applies the bounded variation from `variantSeed`:
   - mirror the plan in X (or not);
   - shift the house shell by dx ∈ [−3, +3], dz ∈ [−2, +1] inside the buildable area;
   - shrink the buildable rectangle by 0–2 tiles per side;
   - one of 4 terrain palettes (grass / dirt / mud / leaf-litter patches; flat, no height in v1);
   - yard dressing: 1–3 dead trees, a stump, jittered;
   - the same starting object set (coffin, table, chair, sink, mailbox, doors, windows), with positions jittered
     inside their rooms.
3. The neighbours come from `neighbourSeed`: the 7 other slots are drawn from {`starter`, `wormwood_bungalow`,
   `wormwood_townhouse`, `empty`}, each at most twice, with exactly one vacant `empty` lot ("For Sale").
4. **Validation**, all required, with the real spatial code (`checkPlace` / `checkWallItem` / `checkOpening`,
   blocked-slot check, `distanceField` reachability; the same checks as `tests/unit/spatial/templates.test.ts`):
   - every placement is valid;
   - each Act 1 target object (`STORY_STEP_TARGETS` tags present at start: `mailbox`, `coffin`) is reachable from
     both sidewalk entries;
   - ≥ 12 free indoor floor tiles reachable from the front door (fridge, stove or microwave, shower: the Day-1
     essentials, story-start §3);
   - ≥ 4 buildable wall edges for `act1_patch`;
   - starting funds = $2,500 base (D-060) + $500 per household member beyond the first (GDD §6), identical for every start with the same household size;
   - lot value within ±10 % of the canonical derelict;
   - walking distance front door → graveyard gate ≤ 140 tiles (≤ 108 game min);
   - ≤ 20 template objects.
   On failure the generator retries with `attempt + 1` (≤ 8 attempts). After that it uses the **canonical fallback**:
   the shipped `derelict` at `mildew_n2`. Every start is therefore playable by construction.
5. The validated `StartPick` is saved in `town.start`, so a world never regenerates differently. A generator change
   bumps `genVersion` and affects new worlds only.
6. **Tests and balance** need fixed layouts. `NewGameOptions.startPick` (optional) overrides the pick: e2e suites and
   balance scenarios pass the canonical pick (`starter` at `mildew_n2`, attempt 0, variation off), so their numbers
   do not move.

7. **Starts must not look the same (diversity gate, review fix, Sol).** Reachability alone could pass with every
   seed falling back to the canonical shack, so AC-6 also measures what was actually built:
   - **Geometry signature** (`StartGeometry` → `startGeometrySignature`, world.ts), computed from the generated layout,
     never from `StartPick` seed fields. It has 6 parts:
     1. slot;
     2. lot rotation;
     3. buildable footprint;
     4. house shell (hash of the wall edge set + openings, order-independent);
     5. terrain (hash of the generated ground/floor array);
     6. neighbour lots (slot-ordered template ids + mirror flags).
     `signatureDistance` counts the parts in which two starts differ.
   - **Gate over seeds 1..50** (`START_DIVERSITY`, `evaluateStartDiversity`):
     - **≥ 48 distinct signatures**;
     - **≤ 2 canonical fallbacks** (4 %, under the 5 % bound; the test prints the count);
     - every pair of non-fallback starts differs in **≥ 2 parts**.
   - **Why these numbers.** Counting only the coarse parts (8 slots × 3 derelict templates × mirror 2 × 28 shell
     offsets × 4 terrains ≈ 5,400 combinations, before insets, jitter and neighbours), the birthday bound gives
     ≈ C(50, 2) / 5,400 ≈ 0.23 expected duplicate pairs among 50 starts. So 48/50 leaves room for one rare collision
     plus fallbacks, while a generator that varies too little fails at once.
     - A pair differing in only one part is a "near twin" (the same house moved one slot). With slot, terrain,
       footprint, shell and neighbours drawn independently, such pairs should not occur, so a single one fails the
       gate.
     - Fallbacks above 2/50 mean the validator rejects too much of the variation space, which is itself a bug.
   - **Reproducibility:** the same seed, and a save/reload of the world (JSON round trip), reproduce the identical
     signature.
   - S7 implements the generator side (the signature extraction from the built world: Astra).

Act 1 (D-060) works on every start because its objectives are tags and actions, not positions. AC-6 runs the whole
arc's reachability on 50 seeds plus the diversity gate.

### 1.10 Unfinished areas and expansion

- **Data** (`UnfinishedArea`): id, kind (`underConstruction` | `unexplored`), regions covered, sign text key, sign
  posts, planned level / pack, `sinceContentVersion`. The world map reserves the frontier around every open district:
  - Mildew Lane north (z < 0): "Wormwood North, under construction";
  - west (x < 0): the road toward Rot Row: "Rot Row tram line, coming soon";
  - south (z > 70): the Bayou road, unexplored;
  - east (x > 200): Mausoleum Hills, unexplored.
- **In the world:**
  - every street that runs into unfinished land ends at a road barrier with a sign: "UNDER CONSTRUCTION — <what>. Not
    open in this version yet.";
  - the unfinished region shows a construction fence, `scaffold_tarp` props and bare dirt (`underConstruction`), or a
    tall hedge and fog (`unexplored`, sign "Unexplored — here be ghouls");
  - **Read sign** (1 min, free) tells what is planned;
  - there is no portal into it, so routes never enter; the overview map draws it hatched (and labelled, for
    colour-blind players) with the same text.
- **Locked ≠ unfinished.** A built district that is still locked (unlock day 3, quest, funds) shows a closed gate with
  "Opens <condition>". That is honest about a rule, not missing content.
- **Expansion without breaking saves:**
  - a content pack or new version bumps `WorldMap.contentVersion`. It may only:
    1. turn unfinished regions open (same RegionId, now with a template and portals);
    2. append regions in empty cells outside the current extent;
    3. open the reserved **stub portals** at road barriers;
  - it may never move, resize, rotate or delete an open region, or change an open region's portals other than opening
    its stubs;
  - on load, `town.map.contentVersion < current` triggers a pure upgrade step that marks the regions open. Unfinished
    regions never had snapshots, so there is nothing to convert. A toast says "New area opened: <name>";
  - an older build that reads a newer world treats regions it does not know as unfinished and keeps their records
    untouched (forward-compatible). A schema bump still refuses with `future_version`.
- **Player-driven growth (Minecraft-like):** explore newly opened land; buy the vacant lot next door (adds to
  `ownedLotIds`, build/buy allowed there: slice S13); move house (D-046); L7 blueprint plots extend the town. Growth
  is single-player: every player's world grows on its own.

### 1.11 Saves, migration, journal

- **One payload.** `WorldState.town: TownStateV2` holds the map inputs, the home, the start pick, stream state and
  `regions` (only regions ever activated). Unvisited regions are rebuilt from (seed, generator version, template),
  so they cost nothing. No region is stored under its own storage key, so the W-119 journal (one epoch ↔ one snapshot
  sha) is unchanged.
- **Size budget** (uncompressed canonical JSON; gzip measured ≈ 8× smaller):

| Item | Typical | Hard limit |
|---|---|---|
| Lot region snapshot (lot + objects + data) | derelict 10.6 KB, starter ≈ 23 KB measured; graveyard ≤ 25 KB (L2 §9.10) | 200 KB (furnished residential), 120 KB (community) |
| Street region (only when it holds dropped items) | < 1 KB | 8 KB |
| Whole world, Wormwood + graveyard all visited (≈ 18 regions) | ≈ 84 KB (today's world) + 17 × 15 KB ≈ **0.35 MB** | — |
| Whole world | target **≤ 2 MB** (levels README §7) | **4 MB**, then the oldest never-modified neighbour snapshots are dropped and regenerate from the seed |

- **Combined migration v1 → v2 → v3** (Cloud R1, PR1 comment6819889825; `TownStateV2` retains its own version 2):
  - v1 → v2 is the published batch's household-jobs migration;
  - the single v2 → v3 step accepts published jobs-v2 and internal world-v2, adding missing jobs/town blocks and
    the normal cosmetic look only for older pets whose variant field is absent; explicit looks remain unchanged;
  - a missing `town` gets the home at `LEGACY_HOME_LOT_ID` (`wormwood:mildew_n2`), `legacyHome: true`,
    `expandPending: true`;
  - preserves existing `lot`, `objects`, `agents` and pet values;
  - valid older saves reach `repairWorld` with **zero warnings** (AC-7).
  - existing town edits and job progress survive; the actual v1/jobs-v2/world-v2 fixtures and stable v3 load/save/load
    checks are in `tests/unit/persistence/worldBatchV3.test.ts`.
- **Journal integration** (respects W-119):
  - walking and travel are ordinary journaled commands (`queue` with world-target params; `travelHearse`), and
    stream-tier changes are derived in `step()`, not journaled;
  - the time-marker fingerprint `fp` gains an optional `stream` hash (old journals without it still verify);
  - a migrated save replays its schema-v1 journal with streaming frozen (`expandPending`). The game then dispatches
    the journaled `townExpand` command after `recoverJournal`, so the v1 journal never diverges and later replays see
    the same expansion tick;
  - `saveSoon` triggers add the first entry into a region and the hearse arrival;
  - region snapshots are written as part of the normal world serialization (`mark` → `stage` → `committed`).
    Nothing writes saves outside `SaveManager`.

### 1.12 Vehicles and far districts

Adjacent areas are walked; no vehicle is needed for any of them. For far districts (route > 250 tiles: Rot Row,
Bayou, Mausoleum Hills once open) the carpool hearse (exists, `src/render/world/carpool.ts`) is the practical option:
- call it at any curb;
- it drives down the real street, so no loading screen;
- travel time = levels README §3 formula with `d` = route length in tiles (15–45 game min, × `vehicleMult`);
- `town.trip` holds the trip; the destination streams in during the drive. If the render shell is late on arrival,
  the hearse circles the block for up to 2 s real time, which is render only and never changes the arrival tick;
- walking there is never blocked; it is just long.
W-031 vehicles (bike, car) set `vehicleMult`. The L4 `env_hearseBoat` serves the Bayou. The overview map (the old
Neighbourhood Map screen) shows districts, pins, hours, unlock state and who is where, and offers "Walk there" or
"Call the hearse". It is a map, not a level select.

### 1.13 Non-goals (v1)

- **Shared online multiplayer** is out of scope: a separate later design behind the COPPA / legal gate (W-095).
  "For many players" here means many players, each with a distinct world and start.
- Terrain height and slopes (flat world v1; the curb is cosmetic).
- Side-yard crossings without gates, roads with traffic simulation (ambient cars stay render-only, vehicles §6 of
  docs/systems/vehicles.md), multi-floor regions other than the L6 stairs portal (D-053).
- Building on lots the household does not own.

### 1.14 Assumptions to verify (each owned by a slice)

| # | Assumption | Verified by |
|---|---|---|
| A1 | Phone CPU ≈ 4–5× slower than this container per tick (32 agents ≈ 8–10 ms/tick on a phone); speed 3 stays smooth, ultra drops ticks (time slows, by design of `TICK_BUDGET_MS`) | S10 Terra: Chromium CPU throttle ×4 + one real mid-range Android and iPhone |
| A2 | Phone budgets: ≤ 350 draw calls, ≤ 400 k triangles, JS heap ≤ 250 MB, GPU ≤ 300 MB; desktop warm-ring shells ≤ 4 draws each | S5 + S10 (no phone measurement exists in the repo; W-022 measured only an AMD iGPU: High 26 fps / Low 45–59 fps) |
| A3 | ~10 draw calls per full-detail agent on average (cast bodies 1–2 + shadow; classic rig up to ~28) | S5 renderer stats on the stress scene (15 zombies, ~150 objects) |
| A4 | A 10-tile street cell fits today's road (7.5 m + curbs) with 1 m verges for lamps and trees | S9 ZSM street kit |
| A5 | Hashing a ≤ 4 MB payload per save stays within the W-119 save path's time budget | S4: measure `savePayloadSha256` at 0.35 / 2 / 4 MB |
| A6 | Walking times (29–98 game min from a Mildew Lane slot to the graveyard gate) are acceptable next to the 28-min carpool | owner (open question) |
| A7 | Two step masks (public / resident) cover door privacy without touching template data | S3 |
| A8 | Devices agree on tz data for the 15 canonical zones (a zone whose rules changed recently could differ by an hour around a transition on an outdated OS; the sim never sees it because the day arrives as a command) | S15: ICU / tz version noted in the session diagnostics |
| A9 | WebCrypto Ed25519 is available on the target browsers and Electron (else: device-clock fallback, or a vetted pure-JS verifier, which needs a dependency approval) | S15 browser matrix (Terra) |
| A10 | A no-data time fetch fits COPPA's internal-operations exception (the IP is exposed to Cloudflare transiently) | legal review (W-095); until then, under-15 / unanswered profiles use the device clock only |

### 1.15 Acceptance criteria (every W-025 slice PR must meet the ones it touches)

| # | Criterion | How it is tested |
|---|---|---|
| AC-1 | **Home-only determinism.** Explicitly frozen home-only worlds match the independently archived approved batch for 7 game days; historical v1 fixtures are retained | `tests/unit/world/homeOnly.determinism*.test.ts`: accepted pet-enabled `3cc1f39` reference, 3 templates × 3 seeds, new/no-town/migrated; complete pets state compared; original fd20992 and c36 corpora preserved |
| AC-2 | **Walk with no load screen.** A household member walks home → neighbour's yard → Mildew Lane → graveyard gate → a graveyard bench, with no loading screen, no `lot` swap event, no renderer full rebuild, and frame time p95 ≤ 33.3 ms throughout | `tests/e2e/worldWalk.mjs` (real browser, desktop 1280×720 and phone 390×844): asserts no loading overlay, `renderer.stats()` rebuild counter unchanged, member arrives within its walk-time bound |
| AC-3 | **Travel round-trip determinism.** Same seed + same commands (home → neighbour → graveyard → home, on foot; and once by hearse) give a byte-identical `WorldState` vs a recorded reference run | `tests/unit/world/travel.roundtrip.test.ts` (golden hash), CI + Terra's Spark2 matrix |
| AC-4 | **Save/load mid-walk across a boundary.** Saving on the tick before, on, and after a portal crossing, then loading and continuing, gives the same final state as the uninterrupted run; journal replay after a kill in the middle of the walk recovers to the same state | `tests/unit/world/boundary.saveload.test.ts` + a `journalChaos`-style kill test |
| AC-5 | **Catch-up idempotency and split invariance.** catchUp(a→now) twice = once; catchUp(a→b)+(b→c) = catchUp(a→c), byte for byte, for every region kind, including 0 elapsed, 1 tick, 1 year and NaN/negative watermarks (refused, no change) | `tests/unit/world/catchup.test.ts` (property test, 200 random intervals per kind) |
| AC-6 | **50 seeded starts pass Act 1 reachability AND look different.** For seeds 1..50:<br>(1) Reachability: the start generator returns a validated start within 8 attempts or the canonical fallback; every Act 1 target is reachable from both sidewalk entries; Day-1 essentials fit; funds = $2,500 + $500 × (household size − 1) (D-060 base, GDD §6); graveyard walk ≤ 140 tiles; the full Act 1 arc completes headless on ≥ 10 of them.<br>(2) Diversity (`evaluateStartDiversity` on signatures computed from the generated layout, §1.9 item 7): ≥ 48/50 distinct geometry signatures; ≤ 2/50 canonical fallbacks, with the count printed in the test output; every pair of non-fallback starts differs in ≥ 2 of the 6 signature parts.<br>(3) The same seed reproduces the identical signature, and so does a save → reload of each world | `tests/unit/world/startgen.act1.test.ts` (S7). Already in this PR: the pure `pickStart` and the signature / gate contract (`tests/unit/shared/world.test.ts`: order independence, per-part sensitivity, JSON round trip, all-fallback / 3-fallback / duplicate / near-twin cases fail) |
| AC-7 | **Old saves migrate.** Every schema-v1 fixture (derelict mid-Act-1, starter, empty, with and without a journal) loads into schema v3 with **zero repair warnings**, its `lot` / `objects` / `agents` / `household` / `quests` deep-equal to the input, home at `wormwood:mildew_n2`, and its v1 journal replays with zero divergence before `townExpand` | `tests/unit/persistence/migrate.world.test.ts`, `worldBatchV3.test.ts` |
| AC-8 | **Perf, desktop.** Stress scene + 5 active lots + 16 warm regions + 32 agents: ≤ 650 draw calls, p95 ≤ 33.3 ms at High on the reference desktop (RTX 5090 run by ZSM) and at Low on the AMD iGPU (Sol); sim ≤ 2.5 ms/tick for 32 agents in Node CI | `tests/e2e/worldPerf.mjs` + `tests/unit/world/simBudget.test.ts` |
| AC-9 | **Perf, phone profile.** Same walk with Chromium mobile emulation (390×844, CPU throttle ×4): ≤ 350 draw calls, ≤ 400 k triangles, JS heap ≤ 250 MB, p95 ≤ 33.3 ms at Low at speed 1–3; then once on a real phone | `tests/e2e/worldPerf.mjs --phone`; device run recorded in `docs/desktop-reports/` |
| AC-10 | **Streaming bounds.** Pacing back and forth across the 45/60-tile band for 2 game hours changes tiers ≤ 4 times; with the household together, active lot regions ≤ 6; simulated agents ≤ 32 at all times; household members never in a dormant region | `tests/unit/world/stream.hysteresis.test.ts` |
| AC-11 | **Unfinished areas are honest and closed.** No route ever enters an unfinished region (fuzz 1,000 random targets); every road into one ends at a barrier with a readable sign (i18n key present, contrast ≥ 4.5:1 on the overview map); opening one via a content-version bump keeps every open region's state byte-identical | `tests/unit/world/unfinished.test.ts`, `tests/e2e/worldWalk.mjs` screenshot |
| AC-12 | **Save size.** The world with Wormwood + graveyard fully visited and furnished ≤ 2 MB uncompressed; the 4 MB hard cap is enforced deterministically | `tests/unit/world/saveSize.test.ts` |
| AC-13 | **Household split (review fix).** Send 8 members to 8 different lots, then select and command each in turn. Every member's region stays live and simulated (needs, interactions and arrival all match an unsplit reference run of that member); live lots never exceed 9 (home + 8); surroundings drop to 0 lots and recover as members regroup; no selection or command is refused for being "out of range"; sim ≤ 3.5 ms/tick in Node CI for that worst case. The pure rule is already tested (`selectLiveRegions` in `tests/unit/shared/world.test.ts`: worst case, partial split, a 300-case property test, garbage) | `tests/unit/world/householdSplit.test.ts` (runtime, S4) |
| AC-14 | **Route results are explained (S11/S13).** A route request returns either a route or exactly one reason code (`noPath` / `private` / `locked` / `unfinished`), shown as text and announced by the live region; no request fails silently | `tests/unit/world/routeResult.test.ts`, `tests/e2e/worldWalk.mjs` |
| AC-15 | **Accessible world seams (S11).** The selected member's region and world position are exposed (`SelectedActorView`). Follow and Recentre work by keyboard and by button. Map pins expose a stable `regionId`, label and status text (no colour-only status). Every sign's text is available as DOM text (`SignView`) and reachable by keyboard and screen reader without 3D text or hover. axe finds no new violations on the HUD and overview map | `tests/e2e/worldA11y.mjs` (desktop + 390×844), `tests/unit/ui-hud/worldSeams.test.ts` |
| AC-16 | **Input survives region transitions; no accidental walks (S11).** Crossing a region boundary keeps the selection, the queued commands, the keyboard focus (restored to the selected actor's proxy `[data-world-actor=<id>]`) and an in-progress pan/pinch. Only a classified `tap` may enqueue a walk: pans, pinches, long presses, cancels and the finger lifting within 300 ms after a pinch never do. The pure classifier is already tested (`classifyPointerGesture`) | `tests/e2e/worldWalk.mjs` (touch emulation, 200 random gestures → 0 unintended walk commands), `tests/unit/shared/world.test.ts` |
| AC-17 | **Regional calendar, same region (D-069).** Two clients in the same calendar region on the same real local date (any device zones that map to that region) compute the same calendar day, week, season and open event list | `tests/unit/shared/calendar.test.ts` (pure, already in this PR) + `tests/unit/game/regionalClock.test.ts` (S15) |
| AC-18 | **Regions roll over at their own local time.** Day changes at local midnight, the week at Monday 04:00 local, per region (London before New York, Tokyo on Sunday 19:00 UTC) | `calendar.test.ts` (already in this PR) |
| AC-19 | **Offline and clock rollback never regress.** Offline play advances with the device clock; setting the clock back (beyond the 5-min skew tolerance) holds the calendar without rewinding; an in-session jump (> 2 min wall vs monotonic) is ignored until a signed time arrives; across save/load the day never decreases (property test, 2,000 random clocks) | `calendar.test.ts` (pure guard, in this PR) + `regionalClock.test.ts` (S15, save/load) |
| AC-20 | **Signatures are checked.** A tampered time, key id or signature, a foreign key or a malformed body is rejected; a valid Ed25519 response is accepted; the endpoint response holds no player data and the request sends none (no cookies, no query, `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`) | `calendar.test.ts` (in this PR, real Ed25519 via node:crypto) + `tests/e2e/timeEndpoint.mjs` (S15, request inspection) |
| AC-21 | **Replay stays deterministic.** Calendar changes enter the sim only as journaled `calendar` commands; replaying a journal (including a refused regressing command) gives a byte-identical world; the sim source has no wall-clock or `Intl` reads (grep gate) | `calendar.test.ts` (reducer, in this PR) + `tests/unit/game/journalCalendar.test.ts` (S15) |
| AC-22 | **Old saves and the placeholder launch.** A save without `regionCalendar` loads with zero repair warnings and stays byte-identical until the first `calendar` command; while `LAUNCH_EPOCH_UTC` is null no command is ever sent and no regional event opens | `tests/unit/persistence/migrate.world.test.ts` + `calendar.test.ts` |


### 1.16 View and controller seams (S5 / S11 / S13; review fix, Sol)

These are the types in `src/shared/world.ts` that the renderer, HUD and controller must provide. They let the
walkable world be played by keyboard, screen reader and touch, not only by mouse on a 3D canvas.

| Seam | Type | Rule |
|---|---|---|
| Route request / result | `WorldRouteTarget`, `WorldRouteResult` | Every "walk there" (tap, click, map pin, keyboard) returns either a route (portals, length, ETA) or **one reason code**: `noPath` ("Can't get there"), `private` ("That's someone's home"), `locked` ("Closed until 09:00" / "Opens day 3"), `unfinished` ("Under construction"). The HUD shows the text and announces it in a polite live region. |
| Selected member | `SelectedActorView` | agentId, current `regionId`, interpolated world and lot-local position, render tier. Stable across region transitions; it drives the portrait, the "where is" label and camera follow. |
| Camera | `CameraFollowApi` | `follow(agentId)`, `following()`, `recentre()`; a Recentre button + key (proposed `C`, rebindable later under W-087). Following crosses regions without a jump cut; Reduce motion makes it snap instead of glide. |
| Map pins | `MapPinView` | Stable `regionId`, label, `status` (`open` / `closed` / `locked` / `unfinished`) + `statusText`, members present. Status is never colour-only (text + icon + hatch). Pins are a keyboard-navigable list as well as a map. |
| Signs | `SignView` | Every in-world sign (construction, road closed, venue hours, street names, "For Sale") has its resolved plain text in the DOM HUD: a "Signs nearby" list ordered by distance, readable by screen readers and reachable by Tab, with no 3D text, hover or pointer needed. The 3D sign is decoration of the same string. |
| Input across transitions | — | Region transitions never rebuild the input layer. Selection, queued commands and an in-progress gesture persist, and keyboard focus returns to the selected member's DOM proxy (`[data-world-actor=<id>]`) after any transition or camera recentre. |
| Gestures | `classifyPointerGesture` | Only a `tap` (≤ 10 px, ≤ 350 ms, one pointer, not within 300 ms after a pinch or pan ended) may enqueue a walk. Pan, pinch, long press (context menu, D-062 conventions) and cancel never do. |

### 1.17 Shared regional calendar (D-069)

**What the owner chose.**
- The game has a launch date. Each **calendar region** runs a world calendar from it: Day 1 = launch day in that
  region.
- Seasons, holidays, weekly sets and timed events open on the same real date for everyone in a region.
- Each player still pauses or speeds their own household's day: the sim clock stays player-controlled.
- This is not real-time play and not shared multiplayer. No player ever sees or affects another player's world.

**Calendar model** (`src/shared/calendar.ts`, pure, tested in `tests/unit/shared/calendar.test.ts`):
- `LAUNCH_EPOCH_UTC` is a **placeholder (`null`)**. The owner sets the real instant later. While it is null the
  calendar is off: no regional events, and the game sends no calendar command.
- Region table `CALENDAR_REGIONS`: 15 regions (PROPOSED), each with one canonical IANA zone, a hemisphere and device
  zone aliases. Examples: `americas-east` = America/New_York, `europe-west` = Europe/London, `asia-east` = Asia/Tokyo,
  `oceania-east` = Australia/Sydney (south). Every client in a region computes dates in the region's canonical zone,
  not its own device zone, so two clients in one region always agree.
- **Calendar day** = civil day number of the region's local date − that of the launch instant's local date in the same
  zone + 1. So Day 1 is the local launch date; a region where the launch instant falls on the next local date (Tokyo
  for an evening-UTC launch) starts one date later, and dates before it are pre-launch (day ≤ 0, no events).
  - DST gaps and overlaps, a missing local midnight (São Paulo 2018) and a skipped date (Samoa 2011, +2 days) are
    handled because the math reads local fields from `Intl`, never "UTC + fixed offset".
  - Leap days are ordinary days. An event set on Feb 29 opens only in leap years.
- **Week** = 1 at launch, +1 at every **Monday 04:00 local** (`WEEK_ROLLOVER`). 04:00 avoids the midnight-session
  edge and every DST transition hour.
- **Seasons**: meteorological, by local month and the region's hemisphere (north: Sep–Nov autumn; south: Mar–May
  autumn). This **supersedes W-034 §2's game-day seasons for which season is current**. W-034's weather, snow cover,
  per-world `seasons: on/off` toggle and holiday traditions stay. Weather blocks remain a pure hash of (seed, game
  block), with the weight tables of the regional season.
- **Events** (`CALENDAR_EVENTS`, PROPOSED anchors): `launch_week` (days 1–7); Halloween (Oct 31, both hemispheres);
  Long Night (Dec 21 north / Jun 21 south); Rising Day (Mar 20 / Sep 22); Cool-Down Carnival (Jul 15 / Jan 15). Each
  holiday window is 7 local days. Windows may cross the new year.
- **Inside a world:** an open holiday is held on the household's **next in-game day** after the window opened, once
  per window per world, at the W-034 in-game hours (Treat Night 18:00–22:00, ...). Halloween's game night is always
  a full moon. Speeding or pausing the household never moves real-date unlocks, and the regional calendar never sets
  the time of day.
- **Weekly sets and daily tasks** (profile level, DESIGN_PROGRESSION §3) rotate on the regional week and day from the
  same clock.

**Region assignment (COPPA-relevant, explicit):**
- The region comes from the **device time zone** (`Intl.DateTimeFormat().resolvedOptions().timeZone`) via
  `regionForZone`: exact canonical zone, else alias, else the region with the nearest standard offset (hemisphere
  breaks ties).
- A **player override** sits in Settings ("Calendar region"). Changing it never rewinds: the new region takes effect
  from the first day where its day ≥ the current one. Changes are limited to once per 7 days, so region-hopping for
  early holidays is pointless.
- **No IP geolocation, no location permission, no locale or language guessing, no account data.** The zone, the region
  and every clock reading stay on the device (ProfileStore and the world save) and are **never sent or stored
  elsewhere**. Under COPPA nothing here is collected from the child.

**Time source:**
- A tiny **stateless time endpoint** (Cloudflare Worker, free tier): `GET /v1/time` → `{"v":1,"t":<UTC ms>,"kid":"k1",
  "sig":"<base64url Ed25519 over 'afterlife-lease:time:v1:<kid>:<t>'>"}`.
  - The request has no query, body or cookies, and is sent with `credentials: 'omit'`, `referrerPolicy:
    'no-referrer'` and `cache: 'no-store'`.
  - The Worker stores and logs nothing: Workers Logs and Logpush stay off. It holds the private key as a secret; the
    client ships the public keys by `kid` (current + next, for rotation).
  - The Worker is about 20 lines: read `Date.now()`, sign, return JSON with `Cache-Control: no-store` and
    `Access-Control-Allow-Origin: *`.
  - Free-tier load: a fetch at launch + hourly while playing ≈ 3–10 requests per player per day, so roughly 10–30 k
    daily players fit the 100 k/day free quota (**ASSUMPTION**: cadence; re-measure at launch).
  - **Hosting needs the owner's approval** (pending decision 1, ARCHITECTURE_PLATFORM hosting).
  - Like any HTTP request it exposes the device IP to Cloudflare transiently. **Legal must confirm** that this fits
    COPPA's support-for-internal-operations exception. Until then under-15 and unanswered-age profiles use the device
    clock only (the same fail-closed rule as D-064).
- **Verification**: `verifySignedTime` takes a strict schema (exact keys, `v` 1, integer `t`, `kid` pattern,
  86-char base64url signature) plus Ed25519 via WebCrypto (`crypto.subtle.verify('Ed25519', …)`). Tests use
  node:crypto with real keys. Browsers without WebCrypto Ed25519 fall back to the device clock (**ASSUMPTION A9**: a
  pure-JS verifier would need a dependency approval).
- **Clock-skew tolerance: 5 minutes** (`CLOCK_SKEW_TOLERANCE_MS`).
  - Within it, the device clock is used as-is.
  - Beyond it, the session uses device-monotonic time + the last signed offset, re-measured hourly.
  - Responses with a round trip > 10 s are discarded.
- **Clock-change detection**: every game-minute pump compares wall and monotonic deltas; a difference > 2 minutes
  (`clockChanged`) flags the device clock as jumped until a signed time arrives.
- **Offline fallback + monotonic guard** (`advanceClock`):
  - offline, the calendar follows the device clock;
  - it **never goes backwards**: a device clock earlier than the last reading (beyond the tolerance) holds progress
    until real time catches up, rather than rewinding it;
  - a flagged jump is ignored;
  - a verified signed time is accepted but never lowers a day already reached;
  - pre-launch holds.
  A player who sets the device clock forward offline can open events early in their own single-player world. That is
  accepted: no FOMO, nothing shared, holidays return yearly. The guard only stops regressions.

**Determinism and saves:**
- **The sim never reads a clock or `Intl`** (grep gate in AC-21). The game layer computes (region, day, week, season,
  open events) and dispatches a journaled **`calendar` command** when any of them advances, on load, and after
  journal recovery. The sim applies `reduceWorldCalendar`: monotonic, idempotent, malformed or regressing commands
  refused with no change. Replay therefore re-applies the same commands at the same ticks.
- **World save** keeps `WorldState.regionCalendar` (`WorldCalendarState`): region, day, week, season, events, and the
  last **signed time + signature** backing it. A load re-verifies the signature: a tampered value is treated as
  unverified and frozen, never rewound.
- The profile keeps the `CalendarClockState` (highest day/week, last device reading, last signed time) for the
  cross-session rollback check.
- **Old saves:** `regionCalendar` is optional. Its absence means no calendar command has been received yet, so no
  schema bump is needed and repair warnings are zero. A v1 journal replays unchanged, and the first `calendar` command
  is dispatched after recovery (the same pattern as `townExpand`).

**In the walkable world** (data the S6 schedules and the S5 renderer read from `regionCalendar.events`):
- **decorations**: seasonal dressing sets per event on street regions, neighbour yards and community lots (jack-o'-
  skulls along Mildew Lane, Long Night candles). They are applied deterministically on region activation from (event,
  regionId) and removed when the window closes. Dormant regions pick them up in catch-up;
- **townie schedules**: event stops, e.g. trick-or-treat routes door to door along Mildew Lane 18:00–22:00 on
  Halloween game night, Rising Day graveyard visits weighted ×3, and fireworks watchers on Cool-Down night;
- **venues**: the Old Graveyard gate stays open and lit on holiday nights (Night of the Open Gates, L2 §10; Long
  Night lantern walk). Its sign and map pin say so (`statusText`).

**Slice S15** (Claude Cloud runtime + the tiny Worker): the regional clock in `src/game` (region pick, override, skew,
jump detection, signed fetch), the `calendar` command + `regionCalendar` in the sim, W-034 season wiring, the Worker
source + deploy script (deploy only after the hosting approval), and the S6/S5 hooks above. Acceptance: AC-17..AC-22.

### 1.18 S1 / S2 as built: audit, seams and contract notes

**S1 (region-aware engine).** `src/sim/engine/regions.ts` holds a region registry on the engine: the home region's
spatial service is the engine's original one (same object, same caches) and other active regions register their own
(`registerRegion`, called by S4 streaming). `eng.spatial` became an accessor that returns the service of the region
**in scope**. The step loop puts each agent's region in scope while it heals, updates and power-checks that agent, a
`queue` command resolves in the actor's region, and everything else (system ticks, views) runs in the home scope. For
a home-only world the scope never leaves the home, so all ≈ 120 `eng.spatial` call sites are unchanged.
`onLotSorted` (the agent list of `step()` and `ctx.agentsOnLot()`) keeps only agents in active regions. The context
gains `regionOf`, `lotOf` and `homeRegionId`.

Audit of the 43 `.lot` reads outside `spatial/` (the `objects` references follow the same split):

| Where | Classification | Change |
|---|---|---|
| `engine/objects.ts` (structural version bump, opening ↔ wall link) | the object's region | `scopeLot`; removal runs in the object's region; a dropped item takes its holder's region; objects created in a non-home scope get `regionId` |
| `engine/runner.ts` (`_v` route invalidation), `engine/stages.ts` (exit stage entry points), `engine/agents.ts` (`entryPointFor`) | the agent's region | `scopeLot` |
| `engine/agents.ts` `createAgent` / `spawnAgent` | home (agents arrive at the home sidewalk) | spawn clears a stale `regionId` and runs in the home scope |
| `engine/commands.ts` `queue` | actor's region | refuses an actor in a dormant region; a target object / partner in another region gets "Can't get there" / "isn't here" until S3 adds the route stage |
| `engine/repair.ts` | home lot, plus `regionId` / `town` hygiene | `repairPositions` skips agents in other regions (their grid is checked on activation, S4) |
| `engine/views.ts` lot value, `engine/world.ts`, `systems/home/economy/bills.ts`, `systems/home/services.ts`, `systems/quests/objectives.ts`, `systems/people/townies/visitorOps.ts` | **home-semantic** (bills, lot value, services, quests and visitors are about the home) | none |
| `engine/fixtures/spatial.ts` | test fixture (one lot) | none |

**S2 (map + combined schema v3).** Mildew Lane is data in `src/shared/mildewLane.ts` (`buildWorldMap`): the §1.2 placements,
4 frontier regions (§1.10), 6 sidewalk portals, 14 crosswalk portals (8 lot frontages, the park, 5 street joins) and
the graveyard `gate` portal. Portal far-side tiles are derived through the world.ts transforms, never typed in. Street
tile kinds come from `streetTiles` (verge / curb / road / crosswalk). `TownStateV2` is built by `src/shared/town.ts`
(`legacyTown` for migration, `newTown` plus the validated S7 pick for story starts, canonical pick for sandbox).
The combined v2 → v3 migration (`MIGRATION_V2_V3`) is pure and marked `silent`: it is listed in the load result's `migrated` but never shown as a
"Save recovered" warning. The structural schema is `src/persistence/validation/townSchema.ts`. The size budget is
`src/shared/worldBudget.ts` (`measureWorld`, `oversizedSnapshots`, `capWorldSize`). The game dispatches the journaled
`townExpand` after journal recovery (`lifecycle.expandTownIfPending`).

The combined batch implements the original S2 seams for S3 routing, S4 streaming and S7 varied story starts and
furnished neighbours. Sandbox starts retain the canonical pick. Production map/sign entry points (S13), resident
schedules (S6) and the graveyard gameplay builder (S14) continue in the follow-up batch; the sections below retain
the earlier slice handoffs and measurements.

**Contract notes (no signature in world.ts or calendar.ts changed):**
1. `WorldState.town` remains **optional** structurally in schema v3. A world without it is home-only at the legacy placement
   and behaves like `expandPending: true`. Every new world and every migrated save has one; the optional field keeps
   hand-made home-only payloads (and every existing fixture) valid with zero warnings. Published jobs-v2 and internal
   world-v2 payloads upgrade through the same v2→v3 step; their existing valid blocks are preserved.
2. `WorldMap` has no origin field, so `widthCells` / `depthCells` are the extent of the bounding box of all regions
   (x −30..230, z −30..100 → 26 × 13 cells). `regionsExtent()` returns the box itself.
3. A `PortalDef` endpoint names the tile with the smallest world coordinate of the opening, and the opening spans
   `width` tiles along the shared edge in increasing world coordinate. world.ts does not say which tile is named; S3
   reads it this way.
4. The graveyard gate portal joins the graveyard's street-edge tiles (local x 14–15, z 29; world (170, 34..35)) to
   `street:mildew:5`. The gate object itself stands one row in, at world (171.5, 34.5) as §1.2 says.
5. `SaveManager.save` now upgrades an older-schema world through the migration chain before writing it, and refuses a
   newer one. Before, the envelope header could carry v2 while the payload said v1, and the save would no longer load.
6. "Never modified" for the 4 MB cap is the absence of a numeric `RegionSnapshot.data.modifiedTick`, which S4 sets.

### 1.19 S3 as built: cross-lot movement, privacy, route results

**Pathfinding (§1.7).** Grids are never merged. `src/shared/worldRoute.ts` (pure) resolves every `PortalDef` into its
tile pairs (`portalSpans`, through the world.ts transforms, contract note 3) and runs A* on the portal graph: nodes
are the two sides of each portal, standing on a representative tile pair (usable on both sides, lowest extra cost,
nearest the span centre, lowest index); a crossing costs 1; intra-region edges are the region's own local Dijkstra
(`distanceField` of that region's spatial service, public or resident mask), evaluated lazily; the heuristic is the
world Euclidean distance (admissible: every step costs at least its length); ties by f, then g, then node key; a hard
cap of 2,000 expanded nodes. When the start and the target share a region and the local search reaches it, the route
is the local one (the home's paths are untouched). The engine side is `src/sim/engine/worldMove.ts`.

**Walking a route (§1.5).** A queued run whose target is in another region carries `params._wg` (target region). While
the agent is elsewhere, stage resolution returns a ROUTE LEG: the goal is the portal tile of the next crossing (the
pair cheapest from the agent plus the onward cost from the far tile to the next crossing or the target), and the leg's
path ends with one waypoint past it, in the next region. The movement step may leave the grid only there. The tick the
position leaves its region's grid, inside the movement phase, the agent crosses: `regionId` switches (deleted again
when it is the home), `pos`, `prevPos`, `facing`, `prevFacing` and the remaining path go through world coordinates,
the event `regionCrossed` is emitted, and the route is RE-PLANNED from the new position under the new region's scope
and mask (a gate that locked meanwhile or a placed object is seen at the next entry). Everything lives in the run's
saved data (`_route` = the remaining crossings, `_xp` / `_xpi` = the armed crossing), so a save on any tick reloads to
the same walk (AC-4: 34 save points around 12 crossings, plus a snapshot + journal replay after a mid-walk kill).

**Gates, doors, curbs.**
- Gate: a portal's gate object is `gateObjectId` (S14 sets it), else an object in side a with `data.gatePortal` = the
  portal id. `data.locked === true` refuses the crossing (`locked`); a closed but unlocked gate opens on approach.
  A walker who reaches a gate that locked meanwhile stops at it and the run fails with "It's closed".
- Locked district: a region whose district's level is not in `town.unlockedLevels` is `locked`.
- Doors (A7 verified): a residential lot other than the home (a Mildew slot) gets two spatial services over the same
  live lot: RESIDENT (every door works) and PUBLIC (every door with an indoor room on either side is `WALL_PRIVATE`,
  which blocks like a window; doors between two outdoor tiles, i.e. yard gates, stay open). An agent uses the resident
  mask when it is a resident (`RegionService.residents`, derived; S6 fills it), holds a welcome
  (`AgentState.welcome = { regionId, untilTick }`), or stands indoors right now (a visitor whose welcome ran out walks
  out, never trapped or teleported). Streets, the park and the graveyard have no private interior.
- Knock → welcome: `engine_knock` on such a door walks to the door's outdoor side and asks the house. It is answered
  when a resident is in the region, it is 09:00–21:00 and the resident's friendship with the knocker is ≥ 0; then
  the knocker is welcomed for 2 game hours. Otherwise the knock fails with the reason ("Nobody answered the door",
  "Too late to call…", "<name> won't let you in"). No RNG.
- Curbs: street regions carry a per-tile extra cost from `streetTiles` (road and curb +2, verge and crosswalk 0), as a
  property of the region's spatial VIEW (derived from the map, never saved). Paths on a grid with extra costs are not
  string-pulled (a shortcut could cut over road the search avoided). The lot grids, the home's included, have no extra
  cost, so their search and smoothing are unchanged.

**Route API (AC-14, S11 / S13 seam).** `SimulationAPI.worldRoute(actorId, target)` plans without changing the world
and returns the contract `WorldRouteResult`: a route (portal ids, `lengthTiles`, `etaGameMin` = length / the agent's
walking speed) or exactly one reason, decided in this order: malformed target / unknown region / tile outside the
region → `noPath`; unfinished region or district → `unfinished`; locked district → `locked`; a route with every rule
→ ok; a route only through a locked gate → `locked`; a route only through someone's private interior → `private`;
else `noPath`. "Walk there" is the journaled `queue` of `engine_goHere` with `params.regionId` (or `params.wx/wz`, a
world tile); its `CommandResult` carries the same `route`, and a refusal has the reason text as `reason`. Object and
agent targets in another region are queued the same way (the walk goes first, then the interaction's own stages).
`GameController.walkTo(actorId, target)` plans, dispatches and toasts a refusal: no request fails silently. The result
shape passes Sol's `routeFeedback` acceptance (PR #59: target echoed with the requested region, integer local tile,
string portal ids, finite non-negative length and ETA), checked in `tests/unit/world/routeResult.test.ts`.

**Activation seam (for S4).** `src/sim/engine/regionSetup.ts`: `activateRegion(eng, id, { lot, objects?, residents? })`
registers a region's services over a stable state view (`regionView` descriptor: the spatial service keeps only the
objects whose `regionId` is that region; the home's service keeps only objects WITHOUT `regionId`, i.e. all of them
in a home-only world). `streetLot` builds a street's plain lot. `restoreActiveRegions` re-registers the active
regions on load. Autonomy, nearest-tag / seat resolution, occupied tiles and the `tagOnLot` requirement read only the
scoped region's objects and agents.

**Contract notes and deviations (no signature in world.ts or calendar.ts changed):**
7. `WorldRouteTarget` stays region-local (as world.ts and S11 expect). The design's `params.wx/wz` world tile is also
   accepted by `engine_goHere` and resolved to the region containing it.
8. **Dormant regions are not walkable in S3**: a route that needs a region which is not active is `noPath` (there is
   no fifth code). S4 removes the limitation by activating regions ahead of walkers (§1.4); planning over dormant
   regions with estimated costs (§1.7 item 1) is S4's part of the graph. **Done in S4 (§1.21)**: dormant regions are
   planned over with exact costs from their snapshot and activate ahead of the walker.
9. An ACTIVE non-home region keeps its live `LotState` in `town.regions[id].snapshot.lot` (so it is part of the one
   payload and round-trips byte for byte); its objects stay in `state.objects` with `regionId`, and `snapshot.objects`
   is `{}` while the region is active. `town.stream.active` lists it. S4 freezes a region by moving its objects into
   the snapshot. **Kept and made the rule in S4 (§1.21, "one source of truth").**
10. The Old Graveyard gate (contract note 4) opens onto the middle of the street end's road (rows 4–5, the east-west
    crosswalk of `street:mildew:5`). A walker coming along the north verge crosses three curb / road tiles of the
    turning circle to reach it; every street segment is walked on its verge and crossed on its crosswalk (asserted in
    `travel.roundtrip.test.ts`). S9 / S14 may add a verge spur to the gate.
11. Sim contract additions (sim-owned, not world.ts): `AgentState.welcome?`, `SimEvent 'regionCrossed'`,
    `CommandResult.route?`, `SimulationAPI.worldRoute?`, `GameController.walkTo?`, the engine interaction
    `engine_knock`, `RegionService.publicSpatial? / residents?`. All are absent or unused in a home-only world, which
    stays byte-identical (AC-1 re-run on this slice: 3 templates × 3 seeds × 7 days + fixtures, all green).
12. Test stand-ins until their slices land: neighbour lots use the shipped `starter` / `empty` templates (S7), the Old
    Graveyard the `empty` template (S14), and the neighbour resident is supplied through `setRegionResidents` (S6).

### 1.20 S5 as built: renderer world view, deviations and measured budgets

**Scene frame.** The renderer keeps drawing the home lot where it always has: scene coordinates are the home region's
lot-local coordinates. Every other region is a group whose transform is `lotToWorld(region) ∘ worldToLot(home)`, a
quarter-turn rotation plus a translation (`src/render/world/worldFrame.ts`, `regionFrame`). Camera, picking, the
wall cutaway, lighting and every lot builder that works in home coordinates are unchanged, and a south-side home
(rot 2) still sees its street at +Z. World coordinates are used for render tiers and the world-facing APIs only.

**What draws what** (`src/render/world/worldView.ts`, `regionVisuals.ts`):

| Region | Active (full detail) | Warm (low detail) |
|---|---|---|
| home | the legacy lot layers (floors, walls + cutaway, objects in chunks, agents, lights) | always active |
| neighbour lot | sidewalk row + front path (1 draw), ZSM home shell **LOD0** (Shell + Glass, 2 draws, glass glows at night), merged yard props (mailbox, trees, bushes; 1 draw), shadows on desktop, its sim objects and agents | sidewalk + path, shell **LOD1**, no props, no shadows, agents as capsules (≤ 3 draws) |
| corner park / Old Graveyard | paving + one merged prop mesh (trees, benches, lanterns / iron fence with the gate gap, graves) | same (their identity) |
| street segment / end | road (asphalt texture), curbs with flush ramps at the crosswalk, zebra + centre dashes, one street lamp per segment (lit at night, a light source) | road, curbs, marks (3 draws) |
| unfinished | hatched ground, along every edge that faces open land a striped orange / white construction fence (`underConstruction`) or a 2.4 m hedge (`unexplored`), a sign post with a chevron-bordered board, a barrier icon, and a striped road barrier in front | same (never active) |
| beyond the extent | the dressing's backdrop ring of `env_house_*` / trees, 14 m outside the world extent, plus fog | — |

The fake neighbour houses (`env_house_*` in `envLayout`) are no longer placed around the home when the world view is
on; `WorldDressing.build(dims, force, world)` then draws a ground plane under the whole world, the home's own
sidewalk row and fence, and the backdrop ring only. A **home-only world** (no `town`, or a migrated save whose
`town.expandPending` is still true) never turns the world view on and builds the legacy dressing through the same
code as before.

**AC-1 parity, measured in the browser** (render harness, 1280×720, High, 19:30, paused; base = this branch's
parent 48b7ff6, same harness): fake sim without a town 305 / 305 draw calls, 1,186 / 1,186 meshes (triangles
469,603 / 469,593: the fake scene's FX particles vary frame to frame); the real sim's
new world with its town stripped (`sim=real&world=0`) 198 / 198 draw calls, 366,499 / 366,499 triangles, 724 / 724
meshes. The scene graph differs only by an empty `world-regions` group. Unit: `worldView.test.ts` asserts a
home-only world builds no region and maps every region to the home frame.

**Streaming.** `computeRenderTiers` (pure) follows §1.4: warm enter / leave 120 / 140 tiles (desktop) or 75 / 90
(phone), at most 6 lots active (home included), already-active lots rank 8 tiles closer (no thrash), unfinished
regions never active. Deviation until S4: no neighbour region is sim-active yet, so a lot turns render-active by the
§1.4 sim radii (45 enter / 60 leave) measured from the camera focus; once S4 registers regions,
`town.stream.active` makes them active as the table says. Builds are capped at 2 regions per frame (`deferred` in
`stats().world`); cold regions are disposed at once. Every geometry / texture / material a region creates goes
through a `Tracker` and is freed on disposal; shared resources (kit textures and materials, model templates, shell
prototypes) live with the view. Unit test: 20 stream-out / stream-in cycles leave `worldResourceCounts` exactly where
they started and `createdTotal === disposedTotal`. The browser leak run (`LEAK_WORLD=1 node dev/render.leak.cjs`)
sweeps the camera along Mildew Lane during the usual churn. Measured (120 s, SwiftShader, 71 region disposals,
14 LOD switches, one context loss + restore, attach / detach every 10 s): GPU geometries 163 at baseline, max 210 in
the first half, max 182 in the second half (no growth), textures 77 → max 82; the remaining difference at the end is
the once-per-session shared caches (shell prototypes, prop templates), no page errors.

**Profile.** The phone render profile is chosen by viewport: short side ≤ 500 CSS px (`PHONE_PROFILE_MAX_SIDE`).
It uses the phone radii, no shadows on warm or neighbour props, and a smaller full-rig cap.

**Agents and assumption A3 (measured, not met).** A classic zombie rig costs ≈ 21 main + ≈ 6.5 shadow draw calls in
the stress scene (render.drawcalls.cjs: 441 draws for 16 visible rigs), not the ≈ 10 the budget table assumes. The
existing stress scene alone is 614 draw calls (base), so the world view must not add rigs. Deviation: while the world
view is on, `AgentManager` keeps a full rig for at most 12 agents (7 on the phone profile) nearest to the camera
focus and within 28 tiles of it (34 once rigged, 4-tile rank slack), plus the selected and the followed member
always; every other drawn agent, and every agent standing in a warm region, is a tinted capsule in ONE instanced draw
(`farAgents.ts`, up to 32). Home-only worlds never turn this on. In the 15-zombie stress scene, zoomed into the home,
3 zombies are capsules; typical households (≤ 8 members + visitors) never notice. Capsules are not pickable.

**Camera.** `RendererAPI.follow / following / recentre` implement `CameraFollowApi`. F (`focusSelected`) selects,
follows and recentres the member; a manual pan stops following; Reduce motion (setting or OS) makes recentre snap.
C stays the wall-mode key. While the world view is on, the camera may pan over the union of drawn (active + warm)
regions (`CameraRig.setPanRect`) and the key light's shadow box moves to the lot under the camera focus. Following
uses the drawn rig, else the agent's sim position mapped through its region's frame, so a crossing never jumps.
HUD-aware framing (Sol P2 on S11, 844×390: the recentred zombie sat behind the agent panel): follow and recentre aim
at actor + a world offset that puts the actor's body box (0.6-tile footprint × 1.6 m) on the free spot nearest the
centre that covers no `[data-hud-region]` panel (`pickFramePoint` + `solveFocus` from `src/shared/framing.ts`,
rects from `hudPanelRects()`, wired in `main.tsx` via `RendererAPI.setFrameAvoid`). On flat ground the offset is a
constant per camera pose, so it is re-solved only when yaw / pitch / distance, the viewport or the HUD rects change
(read ≤ 4× a second) and holds through continuous follow and resizes (`src/render/camera/followFraming.ts`;
`tests/unit/render/followFraming.test.ts` at 844×390, 390×844, 360×640, 1280×720: zero overlap after recentre,
after 60 follow frames and after a resize; the HUD rects there are fixtures, the 844×390 agent panel is Sol's).

**Cutaway per region.** Neighbour shells have no interiors, so "cutaway" lowers a shell instead: its material clips
at 1 m (`localClippingEnabled`, one plane) and its window panes hide. In `cutaway` the shell of the lot under the
camera focus and any shell between the eye and the focus are cut; `down` cuts every full-detail neighbour; `up`
none. The home keeps its own wall cutaway.

**Picking.** `PickResult` gains `regionId` on agents / objects that stand in another region and a `worldTile` result:
`{ target: WorldRouteTarget (regionId + lot-local tile), world, what: 'ground' | 'structure' }`. A house shell in
front of the ground wins. `tile` stays the HOME lot's tile, so the existing live / build controllers never walk to
another region's coordinates by mistake (S11 maps `worldTile` to a route request). Sim objects of another region are
drawn in that region's place (never in the home's lot chunks or wall openings) and pick by id.

**Seams for later slices.** S4: a non-home region's `LotState` (walls, floors) is not drawn yet; the sim exposes no
region-lot accessor on `SimulationAPI`, so neighbour lots show their shell. Once S4 registers regions, the per-region
floor / wall layers can be added beside the shell. S7: neighbour shells are drawn from the three Wormwood (L1) shells
(`shell_starter`, `shell_wormwood_bungalow`, `shell_wormwood_townhouse`), chosen by `hash32(seed, regionId)` and
tinted per lot; a known `templateId` picks its own shell (matched by the manifest's `template`, else its `lot` field,
e.g. PR #65's `shell_derelict` with `lot: 'derelict'`; never by slot; a missing shell draws the placeholder house).
A start lot mirrored / shifted by the S7 generator (PR #66 `transformStartTemplate`: X mirror, then dx ∈ [−3, 3],
dz ∈ [−2, 1]) passes that plan transform through `WorldView.setLotTransforms`; the shell (every LOD), the
placeholder, the front path and the yard use it, and region rotation stays the placement's job (tested for a
mirrored + shifted lot and a mirrored rot-2 lot). S7 wires the call from its layout. S8: sign texts are English fallbacks keyed by
`signTextKey` (`fallbackSignText`); `RendererAPI.signs()` returns them as `SignView`s, nearest first. S9: the
unfinished placeholders (procedural fence, hedge, sign, barrier) are replaced by ZSM's kit. S10: real-device numbers.
`selectedActor()` returns the §1.16 `SelectedActorView`. Carpool hearse: in world mode its lane is 1 m further out
(the street's verge row).

PR #23 (home shells) is merged into `ship/final-phase` but not into `cloud/w025-s1s2`; this branch merges
`ship/final-phase` (6 commits: the shells, the outline-tips fix) to use them.

**Measured budgets** (`node tests/e2e/worldPerf.mjs`, render harness stress scene + town: 15 home zombies, ≈ 167
objects, 17 zombies in neighbour lots and streets = 32 agents, 19:30 with lamps; SwiftShader in this container;
max over 5 views: home, street from home, along the street east / west at max zoom and min pitch, toward the
graveyard):

| Profile | Draw calls (max / budget) | Triangles (max / budget) | JS heap (max / budget) | Frame p95 |
|---|---|---|---|---|
| desktop 1280×720, High | **597 / 650** ok (home view 506, where the legacy stress scene without a world draws 614) | **946 k / 1.5 M** ok | **49 MB** (RAM < 1.5 GB) ok | not measurable here (SwiftShader: 2.1–3.6 s per frame) |
| phone 390×844 @3×, mobile emulation, CPU ×4, Low | **262 / 350** ok | **446 k / 400 k OVER** (street-from-home view; 194–393 k in the other four views) | **37 MB / 250 MB** ok | not measurable here (SwiftShader) |

The phone triangle gap is the stress scene's own furniture, not the world: at the same view the legacy single-lot
stress scene (no world) measures 453 k triangles and 337 draw calls, of which ≈ 288 k are the ≈ 167 objects' chunks
and 47 k the home's iron fence. The world view's own share is ≈ 20 k (region meshes) + the backdrop ring; the phone
profile already draws the light pine instead of the 3–4.4 k-triangle trees in yards. Closing the gap needs an object
LOD for lot furniture (ZSM / S10), not more world LOD. Frame-time budgets (p95 ≤ 33.3 ms) need a GPU: S10 (Terra,
reference desktop + AMD iGPU + a real phone) signs AC-8 / AC-9 off. Screenshots of the street from home:
`docs/desktop-reports/img/world/street-from-home-desktop.jpg`, `…-phone.jpg` (19:30: lamps, window glow, the
across-the-street shell cut away between the eye and the focus, capsules for far agents).

### 1.21 S4 as built: streaming tiers, snapshots, catch-up

**Tier evaluation (§1.4).** `src/sim/engine/streaming.ts`. Every `STREAM_EVAL_TICKS` = 4 ticks, at the start of
`step()` before the tick advances, the live set is recomputed from world data only (member positions, the tick,
`town.stream`); nothing reads the camera or the device. It runs only when the world has a town and `expandPending` is
false (a migrated save stays frozen until `townExpand`, so a v1 journal replays unchanged).
- **Required** (never capped, no dwell): the home; every region a household member stands in; the region past the
  next portal of a member's route once the member is within `PREACTIVATE_TILES` = 10 (+ the portal's width) of that
  portal ("activate ahead of walkers"); the region of a member's queued or running object / agent target (that object
  is in `state.objects` only while its region is active).
- **Surroundings**: enter within `ENTER_RADIUS` 45 (Chebyshev, world rect ↔ member), leave beyond `LEAVE_RADIUS` 60,
  and both moves wait `MIN_DWELL_TICKS` 120 (30 game min) after the region's last tier change. In the budget order an
  incumbent gets the 15-tile band as a head start (and distance 0 while it dwells), so a nearer newcomer does not
  evict it one evaluation and lose to it the next.
- **Budget**: `selectLiveRegions` (world.ts, unchanged). Required regions go in as `memberRegions`; if there were more
  than 8 distinct ones they are added after it (never dropped).
- Deactivations run before activations, each in RegionId order. A member who reaches a portal into a region that is
  still dormant wakes it in that tick, before the crossing (`regions.activateNow`; townies do not wake regions, S6).
- **Replay**: tier changes are derived in `step()` (§1.11), never journaled as commands. The journal time-marker
  fingerprint gains the optional `|s<hash>` of the active set once anything besides the home is live, so a replay
  verifies the activations; a fingerprint without it (every pre-S4 journal) still verifies (`fingerprintMatches`).
  No `SimEvent` is emitted for a tier change: a new world streams its surroundings in at tick 0, and an event there
  would break AC-1's event-stream hash. S5 reads `town.stream.active`; S6 hooks `onStreamChange`.

**Planning through dormant regions (§1.7, lifts S3 note 8).** `RouteEnv.regionLive` is true for an active region
and for a dormant one that can be planned over. Planning-only services (`regions.planner` →
`planningServiceOf` / `planningSpatialOf`) are built over the region's snapshot (its frozen lot and objects, so a
frozen blocker still blocks), or over its regenerated build when it was never visited. They are never registered and
never simulated. The local costs are therefore exact, not estimates. Public / resident masks apply to dormant
neighbour houses too (`maskFor` reads the planning services).

**Storage: one source of truth (resolves S3 note 9).** Every datum of a non-home region lives in exactly one place:
- the grid: always `town.regions[id].snapshot.lot` (active or dormant), never copied;
- the objects: `state.objects` (with `regionId`) while active, `snapshot.objects` while dormant. An active region's
  `snapshot.objects` is `{}`; a dormant region has no object in `state.objects`. Held items travel with their holder
  and are never frozen;
- the closed-form data: `snapshot.data` (`genHash`, `modifiedTick`, `residents`).
Objects stay in `state.objects` while active because ≈ 140 engine call sites (interactions, home systems, views) read
them there; moving active objects into the record would have changed all of them for no saved-state gain. The
payload stays one world (§1.11), so every journal epoch still binds to one snapshot.

**Freeze / thaw.**
- *Freeze* (active → dormant): objects move into the snapshot (reservations cleared); non-household agents standing
  there stay in `state.agents` unsimulated and their needs are kept as absent residents (`data.residents`);
  `savedTick` and the catch-up watermark = now; `data.genHash` (an FNV hash of the lot + the object set: def, placement,
  tint) is set on the first build, and `data.modifiedTick` = now whenever a freeze finds the structure changed. A
  snapshot over its own hard limit drops its loose items (highest id first, with a note); then `capWorldSize` enforces
  the 4 MB cap in the S2 order (oldest never-modified neighbour first; home, owned and modified never).
- *Thaw* (dormant → active): `repairRecord` validates the snapshot, then the closed-form catch-up runs from the
  watermark to now, the objects go back into `state.objects` and the residents' caught-up needs go back to their
  agents. A region with no snapshot (never visited, or dropped by the cap) is built by the region builder.
- *Region builder* (S7 / S14 seam, `setRegionBuilder`, not saved): default = the street lot for streets, a plain
  30 × 30 lot (sidewalk + entry points, no objects) for lots. Tests install stand-ins (`starter` at n3, `empty`
  elsewhere). Because the default lots are empty, a new world's streamed surroundings touch nothing outside `town`.
- *Corruption* never crashes. A damaged lot drops the snapshot (rebuilt from the seed). Objects that are not a map,
  unknown defs, bad placements, ids that do not match their key or clash with the world are dropped. Loose items whose
  surface is gone fall to the floor. NaN or future watermarks and `savedTick` are repaired, damaged resident data is
  dropped. Each case leaves a note (`streamNotes`). On load, an active region whose live lot is damaged is set
  dormant with a repair warning, and its orphaned objects are dropped.

**Catch-up (§1.8, AC-5).** `src/sim/engine/catchUp.ts`, `catchUpRecord(record, now, env)`: refuses NaN, negative,
fractional or earlier `now` and damaged watermarks; a second call with the same `now` changes nothing; 0 elapsed is a
no-op byte for byte. Split invariance is exact, not approximate. Values are quantised once to a dyadic grid (1/1024),
every increment is a whole number of dyadic steps (minutes = ticks / 4, rates quantised to 1/64), schedules count
absolute hour boundaries, and clamps are min / max of monotone sums, so (a→b)+(b→c) equals (a→c) bit for bit. The
property test runs 200 random intervals per region kind, including 1 tick and 1 year. Rules, in order:
1. `dirt`: +51/1024 (≈ 0.05) per hour boundary on a surface under a dish or spoiled meal, counted from the spoil tick
   to the despawn tick;
2. `fridge`: leftovers age × `spoilMult`; totals recomputed;
3. `mealsOut`: meals and pizza age 1:1 and are spoiled at 24 h;
4. street dish age;
5. `itemDespawn`: street and path litter is gone at 48 h;
6. `garden`: hook for `growStartTick` / `growTicksPerStage` / `growMaxStage`; no shipped object uses it yet;
7. `residents`: absent residents' needs drift 2 points per hour boundary toward 60;
8. `townieSchedule`: no-op seam for S6.
The region is assumed powered and unattended. Bills are not a region rule: the home is always active (§1.8). The
region seed `hash32(worldSeed, fnv(regionId))` is passed for future random rules, which must key randomness on
absolute schedule slots.

**Contract notes and deviations (no signature in world.ts or calendar.ts changed):**
13. `STREAM_EVAL_TICKS` is named in a world.ts comment but not exported there; it is the sim constant
    `streaming.ts` `STREAM_EVAL_TICKS` = 4.
14. Dwell applies to entering as well as leaving (the design names it under "leave"). Without it a member pacing
    40 ↔ 70 tiles re-enters right after each leave, and AC-10's "≤ 4 changes in 2 game hours" is not met.
15. AC-1 now proves the projection, the event stream and "town changes only by streaming" (`expectTownStreamedOnly`):
    a new world's `town` is no longer frozen, because its empty surroundings stream in at tick 0. The pre-world
    hashes are unchanged (table in the PR).
16. Changed S3 expectations: dormant regions are routes now (`routeResult`); tests that exercise the S1 registry by
    hand freeze streaming (`expandPending`); S3 test helpers that place objects in a region wake it first. The AC-3
    golden `s3.travel.golden.json` is re-recorded. Root cause: with streaming on, (a) the never-activated n4 becomes
    plannable, so the return leg cuts through n4's front yard (`crosswalk:mildew_n4` + `sidewalk:mildew_n3-n4`, which
    avoids the road +2 of street 3), so crossings 10–12 change and the agent states differ; and (b) regions freeze and
    thaw, which changes `town.stream`, the snapshots, and which objects sit in `state.objects`. The journal `|s` suffix
    is not part of the world state, so it does not enter this hash. With streaming frozen, the S3 tree's golden (final
    `1dc921c0…a5763`, kept as `s3.travel.frozen.golden.json`) reproduces exactly: all 14 hashes and all 12 crossings
    (asserted in `travel.roundtrip.test.ts`). The S4 round trip has its own golden (`s4.stream.golden.json`).
    The shortcut is legal under D-068 / §1.5: neighbour yards and front paths are public; interiors require a
    welcome. `stream.privacy.test.ts` checks every n4 sample on that return leg against its public outdoor grid,
    and separately refuses an unwelcomed furnished interior while active, dormant and thawed, with no queued
    action, state mutation from the route query or charge. The plain never-visited n4 lot is the S7 builder seam
    described above; these checks do not claim that the finished neighbour-house population is integrated.
17. `modifiedTick` is set only when the structure changed since it was generated, not on every freeze: if every
    snapshot were "modified", the S2 cap could never drop anything.
18. Open for S9 / S14 (S3 note 10, unchanged here): the Old Graveyard gate opens onto the middle of the road at street
    end 5 (`street:mildew:5`, rows 4–5), so walkers cross curb and road tiles of the turning circle to reach it. A verge
    spur or moving the gate is S9 / S14's call. S4 leaves it as is.
19. The perf numbers and the AC-13 budget are measured in `tests/unit/world/householdSplit.test.ts` (printed per run).

## 2. Levels (each ships complete: map, lots, community lots, townies, objects, interactions, quests, art, music, tests, screenshots)

Since D-068 each level is a **district** of the walkable world (§1.2). Where a level doc says "travel" or "map pin",
read "walk there (adjacent districts) or call the hearse (far districts)".

| Level | Unlock | Residential lots | Community lots | Signature systems |
|---|---|---|---|---|
| **L1 Wormwood Heights** | start | Mildew Lane fixer-upper, Empty Plot (+2 new) | — (gets a corner park) | existing game |
| **L2 Old Graveyard** | start (adjacent) | — | Old Graveyard (dig for grub, grave goods, fishing pond, strays, crypt door to L6, night events: moonlit séance) | free food, strays→pets, fishing skill |
| **L3 Downtown Rot Row** | day 3 or quest | 2 apartments (small lots) | Brain Bank pantry, Rot Row Market, Grimm's Gym, Dusty Tomes Library, Necro-Tech office (career workplace), Club Thriller nightclub, Salon | shopping, gym/library skill venues, nightlife, pantry |
| **L4 Swampside Bayou** | funds $15k or quest | 3 stilt-house lots | Bayou Bait & Tackle, Swamp Diner, Gator Pond | swamp foraging, boating/fishing, new career (Swamp Guide) |
| **L5 Mausoleum Hills** | reputation / funds $60k | 3 mansion lots | Hilltop Museum, Country Crypt Club, Fancy Funeral Parlor | wealth aspirations, high-end catalogue, parties |
| **L6 The Underneath** | crypt quest | dig layer under ANY lot | Catacomb Market (community underground) | basements/crypts/tunnels (spatial multi-level: floor −1), digging tool, light/darkness |
| **L7 The Necropolis** | late game | grows with blueprints | town square, gallery | lot blueprints import/export, expanding map, Creator Kit + MCP (Phase 3) |

## 3. Build order (walkable world)

Each slice is one PR, merged only when CI is green and the acceptance criteria it touches pass. Owners are
suggestions (docs/WORKBOARD.md `W-025-S*` rows).

| # | Slice | Owner | Depends on | Acceptance |
|---|---|---|---|---|
| S1 | **Region-aware engine, home only**: `regionId?` on agents/objects, per-region spatial service, `ctx.regionOf/lotOf`, audit of the 43 `.lot` / 143 `objects` sim references; nothing new is visible | Claude Cloud | — | AC-1 |
| S2 | **World map + combined schema v3**: Mildew Lane map data (§1.2), street regions (road/curb/crosswalk tiles), `TownStateV2`, v1→v2 jobs then v2→v3 combined migration, `townExpand`, `NewGameOptions.startPick` | Claude Cloud | S1 | AC-7, AC-12 (size harness) |
| S3 | **Portal graph + hierarchical pathfinding + boundary crossing + public/resident masks + gates** | Claude Cloud | S2 | AC-3 (on foot), AC-4, AC-11 (routing part) |
| S4 | **Sim streaming tiers + snapshots + catch-up** (hysteresis, caps, payload-hash timing A5) | Claude Cloud | S3 | AC-5, AC-10, AC-12 |
| S5 | **Renderer world view**: one group per region with its placement transform, existing lot builders reused per group, warm shells, capsule LOD for far agents, camera follow + bounds over active ∪ warm, picking returns `regionId`, street dressing per street region, fake ring only beyond the extent | Claude Cloud | S2 (render can start on static map data), S4 | AC-2, AC-8 |
| S6 | **Townie homes + schedules + materialise/dematerialise**, neighbour households on the 7 slots, knock → welcomed | Claude Cloud | S4 | AC-3, AC-10 |
| S7 | **Start generator**: `derelict_lean` / `derelict_lshape` templates, variation, validation, fallback, 50-seed reachability gate + geometry-signature diversity gate (`StartGeometry` extraction from the built world, ≥ 48/50 distinct, ≤ 2 fallbacks, pairwise ≥ 2) | Claude Cloud (generator) + Astra (signature extraction + diversity gate) | S2 | AC-6 |
| S8 | **Unfinished areas + expansion**: barriers, signs, Read sign, content-version upgrade, forward-compatible unknown regions | Claude Cloud (runtime), Claude ZSM (art) | S3, S9 art | AC-11 |
| S9 | **Street & district art kits**: road / crosswalk / curb-ramp pieces (or keep procedural textures, ZSM's call), street-end turning circle, `sign_street` nameplate, `sign_construction`, `barrier_road`, `fence_construction`, warm-tier shell rules per house template | Claude ZSM | — (parallel) | ART_DIRECTION budgets; reproducible builds |
| S10 | **Determinism + perf verification**: Spark2 matrix (AC-1/3/4/5 on 10 seeds), 50-seed start gate nightly, phone profile and real device runs, draw-call / heap logs | Terra | S4, S5 | AC-8, AC-9 (sign-off) |
| S11 | **Accessibility + phone**: tap-to-walk anywhere on the visible world, camera follow / recentre, overview map on phone, sign text size + contrast, hatched (not colour-only) unfinished areas, Reduce motion during the hearse drive, 44 px targets; verifies the §1.16 seams (route reason codes, `SelectedActorView`, follow/recentre, map pins, DOM sign text, focus restore, gesture classifier) | Sol ZSM | S5, S13 | AC-9, AC-11 (contrast), AC-14, AC-15, AC-16 |
| S12 | **Traversal clips if needed**: open gate, knock, read sign, step off curb, wave at a neighbour; fallbacks `walk` / `idle` ship if a clip is not made | Astra | S3 | W-051 gates |
| S13 | **Overview map + hearse for far districts + Move Household + buy the vacant lot** | Claude Cloud | S4, S5 | AC-3 (hearse leg) |
| S14 | **L2 Old Graveyard gameplay** on the connected world (W-015 build: its lot at `graveyard:old_graveyard`, gate portal, venue rules, catch-up rules) | Claude Cloud | S4, S6 | L2 §13 tests + AC-2 |
| S15 | **Shared regional calendar** (§1.17, D-069): regional clock in `src/game` (device zone → region, override, skew, jump detection, signed fetch), journaled `calendar` command + `regionCalendar` in the sim, W-034 season wiring, event hooks for S5/S6; plus the tiny stateless Cloudflare Worker (deploy only after the owner's hosting approval) | Claude Cloud | S2 (command plumbing); none for the pure helpers | AC-17..AC-22 |

Then L3 Rot Row → L4 Bayou → L5 Mausoleum Hills open as districts, each turning its unfinished frontier into open
regions by a content-version bump (§1.10). L6 Underneath adds `stairs` portals to floor −1 regions (needs the D-053
spatial pass first). L7 Necropolis grows by appending blueprint plots. Level art (Blender, scripted, reproducible,
≤ ART_DIRECTION budgets) keeps going in parallel from the per-level docs.

**Existing art kits that slot in:**

| Kit (manifest) | Slots into |
|---|---|
| L2 graveyard kit (`manifest.levels.json`, 68 models: `fence_iron`, `gate_iron`, `arch_ironGate`, `bench_gothic`, `env_spire`, `tree_willow`, graves, pond, …) | the `graveyard:old_graveyard` region, its perimeter fence and the gate portal at the end of Mildew Lane |
| Curb kit (`manifest.structures.json`: `curb_fence_picket`, `curb_mailbox`, `curb_flowerbed`, `curb_planter`, `curb_porch_light`, `curb_bench`, `curb_lamp_post`, `curb_gate_iron`, `curb_fountain`, `curb_topiary`, `curb_bike_rack`, `curb_gnome_skull`) | neighbour lots' front yards (curb appeal), the street verges, the turning circles |
| Fences (`manifest.structures.json`: picket / iron / bone / hedge / stone × run / post / gate) | lot boundaries; every `*_gate` = a `gate` portal; `fence_hedge_run` lines `unexplored` edges |
| `scaffold_tarp` (`manifest.structures.json`) | `underConstruction` dressing |
| Yard kit (`manifest.yard.json`: `birdbath_skull`, `grill_bbq`, `picnic_table`, `pond_yard`, `swing_creaky`) + W-109 yard building | neighbour back yards, `public` yard objects |
| Bayou kit (`manifest.bayou.json`: `env_stiltHouse_a/b`, `env_cypressGroup`, `tree_cypress`, `pirogue_dock`, `platform_viewing`, `env_hearseBoat`, …) | the Bayou district's warm shells, its unexplored frontier backdrop, the hearse-boat far-travel vehicle |
| Rot Row kit (`manifest.rotrow.json`: `env_brick_block`, `env_shopfront_a/b`, `env_tram_stop`, `env_neon_sign`, `env_rooftop_billboard`, …) | the west frontier backdrop ("Rot Row tram line, coming soon"); the tram stop becomes the far-travel point when L3 opens |
| Base environment (`manifest.objects.json`: `env_house_a/b/c`, `env_streetlamp`, `env_hydrant`, `env_fence`, `env_tree_a/b`, `env_bush`, `env_gravestones`, `env_hearse`, `env_cart`) | street lamps and hydrants in street regions; the far backdrop beyond the world's extent; the carpool hearse |

New art still needed (S9): `sign_construction`, `barrier_road`, `fence_construction` (or a reuse of `fence_picket_run`
with tarp), `sign_street`, and optionally road / crosswalk / curb-ramp meshes. The road is procedural today
(`asphaltCanvas`, `sidewalkCanvas`).
