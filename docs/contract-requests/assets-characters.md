# Contract notes / requests — ASSETS-CHARACTERS

Module: `tools/blender/characters/**`, `public/assets/models/characters/zombie.glb`,
`public/assets/manifest.characters.json`, `src/render/characters/**`, `dev/characters.*`, `tests/unit/characters/**`.
Nothing here blocks anyone; every item is handled locally. Items 1, 3 and 4 were adopted (CONTRACTS #15).

## 1. "sit* → pelvis at SEAT_HEIGHT" — adopted
The `pelvis` bone origin is the seat contact point; in every `sit*` clip it is at `DIM.SEAT_HEIGHT` above the rig
root for every height scale (the rig offsets the scaled model). Tested in `anchors.test.ts` / `rig.test.ts`.

## 2. Walk speed vs. leg reach
`walk` is a 1.0 s cycle. With 0.65 m legs a 1.3 m/s stride is out of reach, so stance travel is capped at 0.58 m
(≈1.1 m/s authored): at `setMoveSpeed(1)` and 1.3 tiles/s the feet shuffle-slide ~14 % (reads as a shuffle).
RENDER: keep calling `setMoveSpeed(actualTilesPerSec / 1.3)`.
**`setMoveSpeed(0)` freezes the locomotion cycle** (RENDER's `moveSpeedScale()` returns 0 for a walker that is not
moving — e.g. blocked or the sim is paused); NaN / negative / non-numbers fall back to 1; values clamp to ≤ 6.
Non-locomotion clips ignore the move speed.

## 3. Eye meshes are `Eyes_<style>` — adopted
Five meshes `Eyes_droopy|wide|mismatched|sleepy|beady`, each with the same 10 expression morphs as `Head`.

## 4. Triangle budget — adopted (14k)
13,896 triangles with every variant present (build fails above 14,000). Visible per zombie: mean ≈ 3.8k over all
style combinations, heaviest ≈ 4.6k (tatters + shorts + hair + beanie); draw calls ≤ 28, mean ≤ 25
(`hardening.test.ts`). A carried item adds 1 draw call (2 for the phone's glowing screen).

## 5. Behaviour the renderer can rely on
- Missing-limb substitution inside `setAnim`: `walk` with one leg missing → `limp` (mirrored for the right leg),
  both legs missing → `crawl` (upright idle-type states → slow crawl). Right-handed clips (wave, phone, paint, cook,
  stitch, standEat, sitEat, sitChess, pickup, embalm, flirt, admire) are mirrored when the right arm is missing.
- **Carried items follow the clip** (new): by default an item rests on the right palm (`prop_R`, left when the right
  arm is gone) with the arm blended into a carry pose during idle/walk/limp/listen/groan. Clips with their own grip
  use exported anchors (GLB `Rig` extras `carryAnchors`, computed at build time from the clip pose):
  `sitEat` / `standEat` + plate|dish → plate level on the left palm and a fork in the right hand;
  `read` / `sitRead` + book → open book between both hands facing the reader; `phone` + phone → handset pressed to
  the right ear. Anchors mirror with the clip; when the holding hand is missing the plate is hidden (fork only) and
  the open book falls back to a closed book on the remaining palm. The renderer only calls `setCarry(item)`.
- **Socials:** `hug` and `kiss` assume the partner stands one tile (1 m) away facing this zombie (how the sim places
  social partners) and step in to meet them (pelvis forward 0.27 m / 0.22 m). Diagonal partners (1.41 m) will not
  touch — acceptable, but RENDER/SIM may prefer orthogonal neighbours for these two socials.
- Root lifts stay the renderer's job: `sleep` root at BED_HEIGHT, `beEmbalmed` at SLAB_HEIGHT, `bath` at the tub
  floor; lying clips are centred on the origin with the head toward local −Z.
- `headTop()` ≈ 1.70–1.78 standing (head bone + offset), follows lying / seated poses. The skull top of the rest
  mesh is exactly 1.62 m.
- Highlight is an additive fresnel rim on every rig material (hover bone-white, selected toxic-green).
- Tiny parts (eyes, stitches, glasses, necklace, bowtie, flower, eyepatch, bandage) never cast shadows; the rig sets
  this itself, so it holds after the capsule → GLB upgrade too.
- Before the GLB has loaded (or if it fails) `create()` returns a procedural capsule rig; it is swapped for the
  skinned rig in place (same `root`). Disposing the factory mid-load releases the late GLB.
- Each rig binds all of its parts to ONE `THREE.Skeleton` (one bone-texture upload per zombie per frame) and disposes
  that skeleton's bone texture in `dispose()`.

## 6. Crossfades (deviation from the brief's wording, kept on purpose)
The brief says "AnimationMixer with crossFadeTo 0.25 s". The rig uses AnimationMixer actions with its own
normalised 0.25 s weight ramp instead of `crossFadeTo`: three.js restarts a fade at full weight when it is
interrupted, and a rapid A→B→C change leaked the bind pose (arms flashing toward the T-pose). The ramp is
interruption-safe and keeps effective weights summing to 1 (tested).

## 7. Manifest
`public/assets/manifest.characters.json` = `{version, file, bytes, sha256, animations[{name,duration,loop}], morphs[],
morphTargets{mesh:[names]}, nodes[], bones[], materials[], triangles, oneShots[], fps, meshCount, rigVersion,
carryAnchors[], hairClearanceMm{}}` (per-module manifest, CONTRACTS #14f). `animations` is in GLB order
(alphabetical), not ANIM_STATES order - look clips up by name.

## 8. Build / publish (finishing pass)
- `/home/user/.venvs/blender/bin/python tools/blender/characters/build_zombie.py` exports + verifies the GLB and
  manifest in a staging folder (`tools/blender/out/characters/.zombie-stage-*`) and only then renames them over
  `public/assets/...` (GLB first, manifest last). A failed or interrupted build changes nothing that is served.
- `--out-dir DIR` builds into `DIR/models/characters/zombie.glb` + `DIR/manifest.characters.json` without touching
  public/assets (reproducibility check: a clean-pycache rebuild is byte-identical to the published files).
- `--preview [--sheets ...]` Cycles sheets; new `cycles` set = 6-frame strips of the most-seen clips with stand-in
  props (`sheet_cycle_<clip>.png`).

## 9. Runtime behaviour added in the finishing pass (no API change)
- **Mood carriage**: `setExpression()` now also drives a small additive posture layer (ART_DIRECTION "happy =
  bouncy shoulders, sad = slump"; angry tense/chin out, sleepy droop + nods, shocked shoulders up, flirty head tilt,
  disgusted recoil, focused lean-in) on chest/neck/head/shoulders, blended over ~0.5 s. It is off for lying/crawling
  clips (sleep, beEmbalmed, bath, crawl, collapse) and softened on clips that already act the emotion. The seat
  anchor (pelvis) and every carry anchor are unaffected; `headTop()` follows the posed head as before.
- **Per-zombie loop phase**: a looping clip starts at a deterministic per-zombie phase (from the appearance), so a
  household loaded together does not idle / walk in lockstep. One-shots still start at frame 0. Blink rhythm is
  re-seeded per zombie too (rigs upgraded from the capsule were all using the default appearance's seed).
- `cook` is now a 4.8 s loop (stir, taste from the spoon, season, stir). Other durations unchanged.
