# Contract requests — RENDER

Owner: RENDER (`src/render/**` except `contracts.ts`, `models/**`, `characters/**`; `tests/unit/render/**`,
`dev/render.*`). Nothing here blocks anyone; every item already has a local implementation or work-around.

## 1. `snapshot()` returns a JPEG data URL (contract comment says PNG)
The brief asked for JPEG, and PLATFORM's `SaveMeta.thumbnail` limit (≤ 64 KB, png|jpeg|webp) makes PNG impractical:
a 320×180 PNG of the lot is routinely 80–150 KB. `snapshot(w, h)` returns `data:image/jpeg;base64,…` at quality 0.86,
stepping down (0.72 → 0.6 → 0.45) until it fits in 64 KB. `''` when there is no GL context.
**Request:** change the comment to "Screenshot of the current view (JPEG data URL, ≤ 64 KB) for save thumbnails".

## 2. Decay level for rigs (`SimulationAPI` has no `sys()`)
The brief says to use the decay system's `decayLevel(agentId)` when available. `SimulationAPI` exposes neither `sys()`
nor `decayLevel()`, so the renderer duck-types `(sim as any).sys?.('decay')?.decayLevel?.(id)` and otherwise uses
`1 − preservation / 100`.
**Request (optional):** add `decayLevel(agentId: AgentId): number` (0..1) to `SimulationAPI`, delegating to
`ctx.sys('decay')`.

## 3. Lamp "lit" window and decorative flames
`ObjectVisualState.lit` is computed by the renderer for specs with a `light`: lit during the lamps-on period of the
lighting keyframes (dusk ≈ 18:30 → dawn ≈ 06:30, i.e. whenever the keyed lamp factor ≥ 0.5 — slightly wider than
`TimeInfo.isNight` so lamps are already on at dusk) AND (candle OR powered) AND `data.off !== true`.
ASSETS-OBJECTS' request #2 (decorative candles without a light spec) is covered by their `alwaysOn` flame nodes.
**Request (optional):** add `night: boolean` to `ObjectVisualState` if more decorative-only glows appear.

## 4. Hovered build edge
`BuildOverlay` has no hovered-edge field. In `build` view mode the renderer highlights the edge returned by the most
recent `pickGrid()` call (the controller calls it on pointer move), which needs no new API.
**Request (optional):** `BuildOverlay.hoverEdge?: EdgeKey | null` if the controller ever wants to drive it explicitly.

## 5. `rotateCamera(+1)` direction
Implemented as "+1 = the camera orbits 45° clockwise as seen from above" (yaw decreases; yaw uses the dimensions.ts
facing convention: offset from target to camera = (sin yaw, cos yaw)). The first step snaps an orbited camera onto
the 45° grid in the travel direction. **Request:** document this in the contract comment.

## 6. ModelLibrary instance ownership
There is no `release(instance)`. The renderer ref-counts the GEOMETRIES of instances it created and disposes a
geometry's GPU buffers when its last instance is removed (three.js re-uploads on next use, so this is safe even for the
library's cached prototypes). Materials are never disposed by the renderer (the library owns its shared tint/dirt
variant cache). **Request (optional):** `release(instance)` on `ModelLibrary` for explicit ownership.

## 7. Static batching of furniture (FYI for ASSETS-OBJECTS)
GLB primitives arrive as one mesh per material (5–20 per object). For draw-call budget the renderer folds every
opaque, single-sided, untextured, non-emissive, non-`Paint`, non-glass mesh that is not under a dynamic-part node
(`screen glow bulb flame water door canvas serving_* flag broken frost speaker pump`) into one vertex-coloured mesh
per object (roughness/metalness per vertex), cached per model id. The original meshes stay in the tree (hidden), so
`update()` keeps working on dynamic parts and `Paint` slots (tint/dirt variant swaps). Batching assumes those
materials are not modified at runtime; please keep it that way (or name such parts as dynamic nodes).

## 8. Shadow flags
The renderer keeps the libraries' `castShadow` flags (glass/emissive/flame parts off) and only forces rugs off; if a
library sets no flags at all it falls back to "opaque, non-emissive meshes cast".


---
**RESOLVED by integration lead:** 1 snapshot comment → JPEG ≤ 64 KB; 2 `SimulationAPI.decayLevel?` added (engine implements); 3 accepted as-is; 4 `BuildOverlay.hoverEdge?` added; 5 rotateCamera direction documented; 6 `ModelLibrary.release?` added; 7 batching constraint recorded for ASSETS-OBJECTS; 8 accepted. See docs/CONTRACTS.md #20.

---
## Finish pass (RENDER finisher) — FYI + one request

### 9. Static batching now also folds Paint, double-sided, static-glow and some dynamic-node meshes (request: extend #20)
To hit the draw-call budget (stress scene 1,345 → ~525 draws) the renderer's per-object batcher
(`src/render/objects/staticBatch.ts`) now merges, per instance:
- **root batch** — every opaque untextured mesh no dynamic part animates, *including* `Paint` meshes, double-sided
  parts (baked as two opposite-facing copies → single-pass) and constant emissive bits (per-vertex emissive);
- **sub-batches** — opaque meshes under dynamic nodes the library only MOVES or SHOWS/HIDES: `door`, `flag`, `pump`,
  `water`, `frost`, `serving_N` (one batch per node) and, per child group, `speaker` / `broken` kids;
- **glass batch** — alpha-blended untextured root parts (glass, cobwebs, smudges) in one single-pass transparent mesh.
Floor/loose objects' root batches are then merged into 8×8-tile lot chunks (`objects/chunks.ts`).
Never batched: anything under `screen` / `glow` / `bulb` / `flame` / `canvas`, textured / alpha-tested / skinned /
morph meshes, and the renderer's window-glow glass.
`Paint` swaps are detected by reference (the library only swaps in immutable cached variants) and re-baked.
**Request (ASSETS-OBJECTS, binding addition to #20):** for `door` / `flag` / `pump` / `water` / `frost` / `serving_N`
nodes and `speaker` / `broken` kids, animate only the node's transform / visibility (as `dynamic.ts` does today) —
never swap or mutate the materials of meshes under them; keep recolourable slots named exactly `Paint` and swap
(never mutate) their materials.

### 10. Renderer-side rig culling (FYI ASSETS-CHARACTERS)
Rig meshes keep `frustumCulled = false` (skinned bounds lag animation); the renderer now hides a whole rig
(`root.visible = false`) when a 2.6 m sphere around it is outside the camera frustum, and re-shows it next frame.
Rigs must not rely on `root.visible` staying true between `update()` calls.

### 11. Door swing rule (FYI GAME/HOME)
Doors get `inUse: true` while a zombie stands within 0.45 tiles of the door centre, or walks / limps / crawls within
1.0 tile of it (sim anim, not measured speed, so pausing doesn't close a door in a zombie's face).


---
**RESOLVED by integration lead:** #9 request accepted as binding decision #23 (ASSETS-OBJECTS: transform/visibility-only animation under batched dynamic nodes; swap-never-mutate Paint). #10/#11 recorded in #23.

### 12. `pick(..., { walls: false })` — walls still occlude (FYI GAME)
`walls: false` now means "never return a wall", not "see through walls": a ray stopped by a visible wall returns
`{ kind: 'none' }` instead of the zombie / object / floor tile hidden behind it (live-mode clicks, buy-mode hover).
Objects set into the wall (doors, windows, wall items) still win over their wall. Measured with the GPU ID-buffer
ground truth (`dev/render.pick.cjs`): 97.0 % of 18,444 cursor samples over 12 views agree exactly; the rest are the
deliberate zombie capsule halo / zombie-over-furniture bias and wall items beating their wall.
**Request (optional):** state this in the `RendererAPI.pick` comment.


---
**RESOLVED by integration lead:** #12 documented on RendererAPI.pick (walls occlude; walls:false = never return a wall).
