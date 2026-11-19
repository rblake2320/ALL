# SIM-SPATIAL — contract clarifications & requests

Nothing in the contracts blocks SIM-SPATIAL; everything below is implemented locally. Items 1–8 are behaviours other
modules rely on and should be written into `src/sim/contracts.ts` doc comments. Items R1–R3 are optional additions.

## Clarifications (implemented; please document in contracts.ts)

1. **faceObject slots expand per approach tile.** A slot with `faceObject: true` (or no `pose`) appears in `resolveSlots()` once
   per surviving approach tile. Every copy has the same `index` and `id` and exactly one `approach` tile, and its `pose`
   is that tile's centre moved 0.28 toward the object centre. Reserve by `index`, route to the entry's tile and use
   that entry's pose. Fixed-pose slots are always returned, even when `approach` is `[]`, so array position equals slot
   index for objects with no faceObject slots. The engine's `stages.ts` `poseFor()` already works with this.
2. **Approach filtering goes beyond in-bounds.** `ResolvedSlot.approach` also drops tiles inside a floor object's own
   footprint, and tiles cut off from the object by any wall segment (doors and windows count) along their shared
   row/column. This stops zombies using a fridge or TV through a wall. Blocked (non-walkable) tiles stay in the list
   because routing decides.
3. **Cost sign.** `BuildPreview.cost` and `BuildService.apply().cost` are signed: `> 0` is a charge and `< 0` a refund
   (`sell`, `removeWalls`). A no-op command returns `{ ok: true, cost: 0 }` and records no history.
4. **History semantics.** Undo refunds exactly what was paid, or re-charges exactly what was refunded. Redo re-charges
   the same amount. Both restore objects under their original ids from snapshots. If the world diverged (a primary
   object or wall no longer matches, or a restored object would now overlap furniture or fire, or straddle a wall),
   the step is reverted, the history is cleared and `false` is returned. Diverged dependent items, such as plates on a
   moved or sold table, are left alone. History holds 200 entries and is dropped if `ctx.state` is replaced.
5. **Version bumps by the build service.** `lot.version++` on object or wall-structure changes (wall added or removed,
   `openingId` changed). `lot.wallVersion++` on any wall change, paint included. `lot.floorVersion++` on floor changes.
   It then calls `spatial.invalidate()` and emits `{type:'lot', what}` per category. Restored snapshots emit
   `objectAdded`. Brand-new objects come from `ctx.spawnObject`, and removals go through `ctx.removeObject`, which
   emit their own events.
6. **Template openings.** `createLotTemplate()` lists doors and windows as `{ kind: 'opening', edge }` and leaves
   `WallSegment.openingId` null. The engine's `spawnObject` links them, and `linkOpenings(state)` is exported as an
   idempotent helper. The spatial grid also finds an unlinked opening by its edge, so doors work either way.
7. **Spatial caching.** The occupancy grid is rebuilt on `lot.version` / `lot.wallVersion` / `invalidate()` / a new
   state object. Once per new `state.tick` a cheap blocked-tile check also runs, so a fire spawned without a version
   bump is noticed on the next tick. `DistanceField` objects are shared LRU cache entries and must be treated as
   read-only.
8. **Helper conventions for the renderer.** `wallLocalToWorld(edge, side, px, pz)` returns the world point plus
   `facing`, the yaw of the item's front (inward normal), to use as `rotation.y`. The frame is a 1x1 footprint on the
   mounted tile with rotation h1→0, h0→2, v1→3, v0→1, so handedness matches floor objects. `openingFrame(edge)` returns
   the edge midpoint plus a yaw that puts local +X along the edge and local +Z toward side 1 (`h` → 0, `v` → π/2).
   Invalid keys give NaN coordinates, never throw.

## Requests (optional, non-blocking)

- **R1.** Add `blockedSlots?: number[]` to `BuildPreview`, so the buy UI gets the non-fatal blocked-slot warning from
  `preview()` without also calling `spatial.checkPlace()`.
- **R2.** State in `SimContext.placeItemNear`'s doc comment that it creates a NEW object (new id). The build service
  depends on this when it drops items off a sold surface: undo removes the copy and restores the original.
- **R3.** Document `SpatialAPI.nearestWalkable` tie-breaks. It returns the tile itself if walkable, else the closest
  tile one legal step away (never across a wall), else a scan that prefers the same room, then distance, then tile
  index.


---
**RESOLVED by integration lead:** items 1–8 documented in src/sim/contracts.ts (ResolvedSlot, BuildPreview, nearestWalkable, placeItemNear) and docs/CONTRACTS.md. R1 accepted: `BuildPreview.blockedSlots?: number[]` added. R2/R3 documented.

---
## Hardening addendum (independent hardener, SIM-SPATIAL) — clarifications the module now relies on

Nothing here blocks anyone; all items are implemented and tested in `tests/unit/spatial/build-interleavings.test.ts`
and `tests/unit/spatial/engine-integration.test.ts`.

- **H1. `SimContext.removeObject(id, reason)`: `reason` is player-facing.** The engine shows it as the failure text when
  a player-sourced run using the object fails ("Mort couldn't take a Shower — The drizzle shower was sold"). The build
  service used to pass the code `'build'`, which reached the player verbatim. It now passes sentences
  ("The X was sold" / "The X came down with the wall" / "The X was removed"). Please say so in the contracts.ts doc
  comment of `removeObject`.
- **H2. `SimContext.interrupt()` on a run-phase agent is deferred** (short 'exit' phase) and the agent KEEPS its slot
  reservation until the exit ends (engine invariant "run slot is reserved by its runner"). When the build service
  releases the users of a moved / sold / removed object it now keeps exactly those still-bound reservations and drops
  every stale one (it used to clear them all, which produced `aN run slot S on oM not reserved by it` from
  `checkInvariants()` for as long as the player stayed in build mode, and allowed double-booking). Please document the
  deferral in the `interrupt` doc comment.
- **H3. `BuildPreview.blockedSlots` (R1) is now populated** for buy / move / buyWallItem / moveWallItem (same indices as
  `spatial.checkPlace` / `checkWallItem`).
- **H4. Users of an object** (for move / sell / removal / undo / redo) = inUseBy + reservation holders + agents whose
  active run's `stageTarget` is the object (e.g. walking to a slot-less table). Users are interrupted BEFORE items on the
  object are gathered, so an end() hook that sets a carried plate down on that very surface cannot leave it floating.
  Undo / redo of a move also carries items that the history did not track and interrupts users.
- **H5. `findPath` on a distance-field cache miss** runs a single-target early-exit Dijkstra (the identical tile chain —
  settled tiles are final) and does not populate the cache; `distanceField()` still caches. Paths never depend on cache
  state (save → load determinism).
- **H6. BuildService refuses re-entrant `apply` / `undo` / `redo`** (an engine hook dispatching a build mid-command):
  `{ ok: false, reason: 'Still building — try again' }` / `false`. `preview` is always allowed.
- **Info for SIM-ENGINE (no change requested):** `failRunsUsingObject` also fails runs that were already gracefully
  cancelled (exit phase), so selling an object a zombie is using raises a "couldn't …" notification. With H1 the text is
  now meaningful; decide whether that notification is wanted at all.


---
**RESOLVED by integration lead:** H1/H2 documented in contracts.ts (removeObject reason is player-facing; interrupt deferral keeps reservation). H3–H6 recorded (decision #21). Engine policy decided: runs already in the exit phase do not raise failure notifications on object removal.
