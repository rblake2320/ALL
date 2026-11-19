# W-109 Yard building — owner direction (2026-11-06)

"I should have ways to add and build things in the yard." Today the yard (lot outside the house walls) supports only a
handful of buyable items (`outdoorOnly`: headstone decor, gnarled tree, mailbox, outdoor light). Fences are scenery
(`env_fence` in `src/render/world/dressing.ts`), not buildable; there are no paths, patios, gardens, gates or yard
structures. This spec makes the yard a full build space, using the same placement engine and the same
preview-equals-commit rule as indoors (W-120 / previewCommitParity).

## 1. What players can do in the yard
| Tool | What it does | Built on |
|---|---|---|
| **Fences & gates** | Draw fence runs on grid edges like walls (picket, wrought iron, bone, hedge, stone low wall); place a **gate** on a fence edge like a door | new wall *kind* `fence`: blocks movement, does **not** close rooms, low (≤ 1.2 m), see-through for cutaway |
| **Paths & patios** | Paint outdoor floor styles on tiles: gravel, flagstone, brick, deck boards, mud, moss | floor styles (`src/shared/styles.ts`), outdoor-only flag |
| **Terrain paint** | Grass / dirt / dead grass / swamp mud on yard tiles (cosmetic + environment score) | per-tile ground style |
| **Garden plots** | Place a plot; plant/water/weed/harvest crops (rot-brain cabbage, swamp mushrooms, graveyard pumpkins) → food (W-074 "Scavenged/Home" tier) | new object + interactions; new **Gardening** skill (D-050 Outdoor group) |
| **Trees, bushes, flowers** | Plant; they grow over days (3 stages) | objects with growth state (deterministic) |
| **Outdoor furniture** | Picnic table, bench, BBQ grill, firepit (never ignites on shared lots, D-051), hammock, pond, birdbath (wildlife perch, W-075), swing set | floor objects, `outdoorOnly` |
| **Yard structures** | Shed, gazebo, greenhouse, carport/garage (vehicles W-031), doghouse (pets W-013) | Quick Build pieces (W-030) or single objects |
| **Lighting & decor** | Lamp posts, lanterns, string lights, gnomes, tombstones, curb-appeal sets (W-049 bands) | existing light system |
| **Driveway & parking** | Paint driveway tiles; vehicles park there | W-031 |

## 2. Rules
- **Same engine, same checks.** All yard placement goes through `checkPlace`/`checkWallItem`/`checkOpening` and the
  build service; ghost validity = click result (previewCommitParity extended to yard cases).
- `outdoorOnly` items refuse indoors ("Must be placed outdoors"), `indoorOnly` items refuse outdoors; fences never
  create rooms; gates keep routing open; nothing may block the sidewalk/lot entry or the front door approach
  (reason "Blocks the way in").
- Placement limits: yard object count cap per lot tier (housing-progression); growth and garden state are
  deterministic (seeded per lot, D-012); saves stay compatible (new fields optional, migration tests).
- **Curb appeal**: a yard environment score (paths, plants, light, tidiness) feeds housing tiers, contests (W-044) and
  "Look Alive" visitors; shown on the lot panel.
- **Privacy (W-066)**: the yard is part of the exterior — visible to other players; interiors are not.
- E10+: crops and food are synthetic/comedic (D-008).

## 3. Art (desktop members)
Fence/gate sets (5 styles), path/patio textures (6), 8 outdoor furniture pieces, 3 garden crops × 3 growth stages,
4 trees × 3 stages, shed/gazebo/greenhouse/doghouse. Budgets per ART_DIRECTION; footprints + contact frames (D-043);
clipping gate (W-073). Overlaps W-049 curb-appeal sets — reuse, don't duplicate.

## 4. Acceptance (each is a test)
1. Unit: fence edges block pathing but do not form rooms; gate edges pass; room detection unchanged indoors.
2. Unit: every yard item × yard tiles × 4 rotations: preview.ok === apply.ok (parity); outdoorOnly/indoorOnly refusals.
3. Unit: garden/tree growth deterministic across save/load; feature-off saves byte-identical.
4. e2e (tests/e2e/placement.mjs): draw a fence run, place a gate, paint a path, place a BBQ, plant a tree, move,
   sell, undo — in a real browser with screenshots.
5. Balance: gardening food does not trivialise survival (BALANCE targets hold).
