# W-075 Ambient wildlife (birds, squirrels, critters) + zombie chase — owner direction (2026-11-05)

The world must feel alive: occasional birds fly over and land on trees, roofs and fences; squirrels dart across lawns
and up trees; zombies sometimes give a comic chase and never catch anything (E10+, D-008). Separate from pets/strays
(W-013): wildlife is ambient, not adoptable (except strays already specced).

## Creatures (art W-076 — creature contract v1, same pipeline as the W-009 pets; ≤ 1,500 tris each, LOD1 ≤ 500)
| Creature | When | Behaviour | Clips |
|---|---|---|---|
| Songbird (2 colour variants) | day | fly-over arcs, land on tree/fence/roof perch points, hop, peck, fly off when a zombie comes within 3 m | fly, glide, land, perch-idle, hop, peck, takeoff |
| Pigeon | day, streets/L3 | flock on sidewalks; scatter on approach (ties to "Chase Pigeons" free food) | walk, peck, takeoff, fly |
| Crow (exists, W-009) | dusk/night, graveyard | perch on gravestones/lamp posts, caw | (existing) |
| Squirrel | day, lawns with trees | dart across lawn, freeze, run up tree trunk, chitter from branch | run, freeze, climb, idle-tail, chitter |
| Bat | night | swoop circles around lamps/moon | fly, flap-hover |
| Frog / firefly swarm | L4 bayou night | hop near water / glowing particles | hop, idle |

## Simulation & determinism
- Spawns come from a **per-lot wildlife stream** (`ctx.stream('wildlife')`, D-012) on a schedule (time of day, season,
  weather — rain = fewer birds). Positions/paths are deterministic from the stream + lot layout (perch points authored
  on trees, fences, roofs, gravestones). Creatures are lightweight **sim critters** (not full agents): id, kind, path,
  state; capped per lot (≤ 6 birds, ≤ 2 squirrels, ≤ 4 bats) for perf; not persisted beyond the current lot snapshot
  (re-seeded on load from the stream — save-compatible and byte-identical worlds when the feature is off).

## Zombie chase (comic, never a catch)
- Autonomy option **"Chase Squirrel/Bird"** for zombies with Playful/Feral/Hyperactive traits or low Fun: ad bonus
  small (fun +8 / 10 min), daily cap (repetition rules, D-012 family), never when hungry < 20 (no implication of eating).
- Animation: `chase` (EXTRA_ANIM_STATES, fallback `walk`) at jog speed for 4–8 s, then a lunge-and-miss (`jump`
  extra or `disgusted` fallback) as the squirrel shoots up a tree / bird takes off; zombie gets *Got Away Again!*
  (fun +5) or *Squirrel Rage* (−3, Hot-Headed). Player can also order it ("Chase the Squirrel").
- Townies and pets react too (dogs bark and chase, cats stalk birds) once pets ship (W-013).

## Audio
Birdsong by time of day/season, squirrel chitter, crow caws, bat squeaks — procedural audio module gets new SFX ids;
ambience mixes per level (existing ambience engine).

## Acceptance
Visible wildlife in every outdoor scene at the right times; perches look seated (W-073 clipping detector covers
perch/landing contacts); AMD-Low perf budget holds with max critters; feature-off saves byte-identical; chase never
results in catching/eating; E10+ review.

## Render status (2026-11-12)
`src/render/wildlife` draws the sim's critter list (songbird, pigeon, squirrel, bat, frog; fireflies have no model yet): the layer reads `ambientWildlife` ten times a second, eases each rig toward the latest position, and fetches a species' model only when one of its critters is inside the camera's view (`manifest.wildlife.json`). Dispose releases rigs and library with the renderer. Strays and pets are a different system (`docs/DESIGN_SURVIVAL_PETS_SAVES.md` §3, `src/sim/systems/pets`, `src/render/pets`).
