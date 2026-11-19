# W-073 clipping audit — interpenetration of every interaction × body × object

Owner report: zombies pass through furniture and objects generally (not only seats). Seating was fixed separately
(`docs/contract-requests/seating.md`, `tests/unit/seating`); this audit covers everything else and re-measures seats.

Requests to other owners: `docs/contract-requests/clipping.md`. CI gate: `tests/unit/clip-audit/gate-*.test.ts`,
allow-list `tools/clip-audit/allowlist.ts`.

## Method

**Detector** (`tools/clip-audit/**`, unit-tested by `tests/unit/clip-audit/{detector,harness,skinned}.test.ts`):

- **Real geometry, real clips.** Furniture = the shipped object GLBs placed exactly as the renderer places them
  (`placementTransform`) in their in-use visual state (doors open, pumps lifted) with the real dynamic-part code.
  Characters = the real runtime character factory (classic `zombie.glb` + the 25 cast bodies, retargeted clips,
  height scale, posture, carry anchors), posed at exact clip times and **CPU-skinned** (`SkinnedMesh.getVertexPosition`,
  bones + morphs) — no bounding boxes.
- **Penetration** = depth of the deepest point of one surface inside the other solid, measured both ways (body
  vertices in the furniture, and furniture surface samples every 15 mm in the body, so a 5 mm board through a thigh is
  caught), inside test by generalized winding number (robust to the open / overlapping primitives the builders emit),
  depth to the *visible* outer surface. Open transparent shells (the cryo sarcophagus' tilted glass canopy) are not
  solids (they enclose nothing; counting them flagged the sleeper as 268 mm "inside").
- **Renderer-exact root poses**: sim slot pose (`resolveSlotsFor` math) + every render offset (seat fit, and the
  W-073 fits below). `CLIP_AUDIT_FITS=0` measures the raw sim poses.
- **Checks**: `pen:object`, `pen:partner`, `pen:item-body` / `pen:item-object` (carry), `pen:floor`, `pen:self-arm` /
  `pen:self-leg`, `pen:wall-back` / `pen:wall-side` (worst case: a wall on the edges of the standing tile), plus contact
  gaps (seat / bed / bath float, hand-to-item, hands-to-work). Static: furniture vs footprint and walls, wall items
  behind the wall, surface heights, **lie surfaces vs catalog**, loose item bases, **pet clips vs the floor**,
  level-kit bounds, **doorways** (every body's walk half-width vs the door opening).
- **Thresholds** (`tools/clip-audit/thresholds.ts`): penetration > 15 mm = FAIL, 5–15 mm = WARN (cushion squish /
  skin contact), ≤ 5 mm PASS. FAIL is a geometric fact ("> 15 mm inside"), not yet a visibility verdict — the ranking
  below weighs visibility and frequency so S1 means "every player sees it". Look at any finding:
  `npx vite-node tools/clip-audit/run.ts shot --key '<scenario>' --look <body>@h0.5 --t <s>` (PNG, deepest point marked).

**Matrix** (`tools/clip-audit/scenarios.ts`, derived from the real sim content so new content is audited
automatically): 173 slot scenarios (every interaction stage × object slot × approach side × carry, incl. the 24 dining
seat + table composites), 52 social pairs (actor × target / fail anim at the sim's 1.0 m and 0.55 m spacing), 47
floor scenarios (every clip on open floor, with its carry) = **272 scenarios × 26 bodies (classic + 25 cast) = 7,072
combinations** per height; mixed-body pairs with `--partner <body>`.

**Runs in this audit** (`dev/out/clip-audit/`, not committed):

| run | what | evaluations |
|---|---|---|
| before | fits off (state at the start of W-073), 3 clip times: classic, walker, cone, hardhat, runner, thief complete, gold 196 + bride 52 scenarios | 1,880 |
| after | fits on, 3 clip times; stopped (shared CPU) after classic, walker, cone, hardhat complete + 123 runner scenarios | 1,211 |
| gate | fits on, 2 clip times, classic + mascot × every scenario (dining: one table per seat) | 508 |
| static | footprints, walls, surfaces, lie surfaces, item bases, 36 pet clip × species, 34 level models | 210 checks |
| doorway / reach | 26 bodies × 47 clips extents; walk half-width vs DOOR_WIDTH | 26 + 1,222 |
| full sweep (cross-check) | Terra on Spark2 at 81ad2a8: 272 × 26 × 3 heights = 21,216 (nightly) | posted on PR #1 |

## Ranked findings

Severity = depth (1: 15–30 mm, 2: 30–100, 3: > 100) × visibility (1: hidden with walls up / under a lid, 2: feet,
legs, small parts, 3: head / torso / arms through furniture or another zombie) × frequency (1: rare interaction or one
body, 2: regular household task, 3: every zombie, every day). **S1 ≥ 18, S2 9–17, S3 ≤ 8.** Counts are FAIL
evaluations in the *before* run (6 complete + 2 partial bodies) unless noted.

| # | finding | sev (D×V×F) | before | after | root-cause class | owner | status |
|---|---|---|---|---|---|---|---|
| F1 | Social partners stand inside each other (head-in-head, chest-in-chest) | **S1** 3×3×3 | 196 evals, all bodies, worst 235 mm | classic 23 → 2 (112 → 37 mm) | placement / collision rule: the sim stops the actor as soon as it enters a neighbouring tile (0.5–1.4 m) with no body-size awareness | render (W-073) | **fixed** (social spacing fit) |
| F1b | …residual: lunging social clips on wide bodies | S2 3×3×1 | — | mascot angry 287, feral 285, hug 246, kiss 185 | animation clip | Astra (A13) | requested, allow-listed |
| F2 | Zombies lean into counters, stoves, arcade, microwave, bins, mailbox (head through the worktop) | **S1** 3×3×2 | 199 evals, 7 bodies, worst 328 mm | classic 23 → 4 (261 → 37 mm) | slot / anchor data: work slots stand the root 0.22 m from the footprint edge (`faceObjectPose` +0.28, `frontStands` inset) while the clips lean 0.5–1.3 m ahead | render (W-073) | **fixed** (work stand-off) |
| F2b | …residual: floor-mopping `clean` / deep `pickup` bend on wide bodies | S2 3×3×1 | — | mascot clean 349, pickup 135 | animation clip (`clean` is a floor-mop clip reused for counters) | Astra (A7, A8) | requested, allow-listed |
| F3 | Repair / clean of beds, sarcophagus, desk, tub played standing *inside* the furniture (Spark2's worst: sarcophagus#lie:clean 260 mm) | **S1** 3×3×2 | included in F2 (183–268 mm) | 0 | placement rule: `home_repair` targets `at.target()` without a slot filter → resolves to the lie / sit / bath slot | render (W-073) + sim-home (E) | **fixed** in render (rest-slot approach); sim request E |
| F4 | Lying in the double bed: body 76–84 mm into the mattress; sarcophagus sleeper 235–268 mm "inside" | S2 2×3×3 | bed 76–84 (pelvis in the mattress), sarcophagus 235–268 | bed 62 (trunk on the mattress after the 5.7 cm lift; the head now presses into the pillow — F8), sarcophagus 67 (head in the headrest) | slot / anchor data (lie pose 0.54 vs mattress 0.595); detector (open glass canopy) | catalog + render (W-073) | **fixed** (`SlotSpec.lie` + lie lift; detector) |
| F5 | Clips put feet / toes / trunk through the floor: crawl 227, mourn kneel 149, flirt 76, cheer 49, collapse 163 | S2 3×2×2 | 503 evals, all bodies | legless crawl (the only crawl in play) ≥ −5 mm for every look but the dress / welded-prop residuals (W-120, request F: shield lid 422 → stowed); rest unchanged | animation clip (+ cast retarget foot roll) | Astra (A1–A4) | requested, allow-listed |
| F6 | Self-penetration: hands through the (big cast) head — admire 164, stretch 149, shower 142; classic idle forearms into the hips 77 | S2 2×3×2 | 112 evals | unchanged | animation clip | Astra (A5, A6) | requested, allow-listed |
| F7 | Seated: thighs pressed into cushions (30–58), forearms inside armrests (99), head / hands into the PC desk hutch (105), bear-suit back through backrests | S2 2×2×3 | sit body 449, sit arms 72 | unchanged | animation clip (seating.md §4.1) + body scale | Astra (A9–A11), cast | requested (seating.md + A9–A11), allow-listed |
| F8 | Lying residual: heads into pillows / headrests (bed 62, sarcophagus 67, pine coffin 55), knees / feet into coffin and slab sides (51–81) | S3 2×2×2 | 49 evals | ≤ 92 | animation clip / body scale | Astra (A4), cast (B3) | requested, allow-listed |
| F9 | Carry anchors on wide bodies: book in the mascot's chest (237), plate (51), pizza box into the spine (55), hand 30–57 mm off the book | S2 3×3×1 | 50 evals | unchanged | slot / anchor data (carry anchors computed on classic proportions) | Astra (A12), cast-runtime (B2) | requested, allow-listed |
| F10 | Worst-case walls: wide bodies / bend clips past a wall face beside / behind the standing tile (mascot 250–340; classic mourn 38) | S3 2×1×2 | new check | — | body scale / animation clip | cast (B1), Astra (A7) | requested, allow-listed |
| F11 | Doorways: walk half-width wider than the 0.43 m half opening — boss 998 mm (staff), strongman 1032 (barbell), mascot 715, ringmaster 657, fortune 532, tourist 525 | **S1** for those bodies 3×3×3 | 6 of 26 bodies | unchanged | body scale / props | cast assets (B1) | requested, allow-listed |
| F12 | Furniture beyond its footprint (next tile / through a wall): plot_budget 45, coffin_pine 45, gym_limb 20, coffin_chillrest 16 mm; armchair 21; level kits tree_willow 222, pond_murky 148, stairs_crypt 100, board_notice 46, rack_tools 20, den_stray_raccoon 19 | S3 2×2×1 | 11 static FAIL | 7 (armchair + 6 level kits) | object geometry | OBJECTS (W-073) / level kits (C) / D2 | **4 fixed** (builders, byte-identical rebuild); rest requested |
| F13 | Fridge door leaf swings into the zombie at `front` (35–51 mm) | S3 2×2×2 | 6 evals | unchanged | object geometry / dynamics | OBJECTS (D1) | requested, allow-listed |
| F14 | Pets | — | 36 clip × species floor checks: all PASS | — | — | — | pets have no runtime yet (W-013): no pet ↔ zombie / furniture interaction to audit; model footprints are in the manifest (D-043) |

Before → after, same 4 complete bodies (classic, walker, cone, hardhat) × all 272 scenarios = 1,088 evaluations
(FAIL checks per group; the wall checks are new in the after run):

| group | before FAIL | after FAIL | before worst mm | after worst mm |
|---|---|---|---|---|
| social (F1) | 110 | 21 | 205 | 183 |
| work-lean (F2/F3) | 128 | 47 | 328 | 191 |
| fridge door (F13) | 3 | 0 | 51 | 0 |
| lying (F4/F8) | 28 | 26 | 269 | 78 |
| floor feet (F5) | 244 | 244 | 210 | 210 |
| floor lying (F5) | 10 | 10 | 155 | 155 |
| self arm / leg (F6) | 54 / 11 | 54 / 11 | 134 / 37 | 134 / 37 |
| seated body / arms (F7) | 260 / 56 | 260 / 56 | 105 / 98 | 105 / 98 |
| carry (F9) | 19 | 19 | 48 | 48 |
| bath / item-object | 3 / 1 | 3 / 1 | 26 / 21 | 26 / 21 |
| walls back / side (F10) | — | 5 / 21 | — | 72 / 139 |

Verdicts on those 1,088: before 780 FAIL / 148 WARN / 160 PASS → after 667 / 219 / 202. Gate set, classic only:
184 → 144 penetration FAILs (social 23 → 2, work-lean 23 → 4). What remains is clip / body owned (requested).
The high raw FAIL rate (Spark2's 68 %) is mostly F5 feet 15–40 mm through the floor and F7 cushion press — real
geometry, ranked S2 by visibility; the severity column, not the raw count, is what to read.

## Fixes (root causes owned in this repo)

1. **Social spacing** (F1) — `src/render/agents/reach.ts` `socialSpacing` / `socialPush`, `agents.ts`
   `socialOffset`: two on-lot agents running a social / pair with each other (mutual `partnerId`), both standing and
   not at an object, are moved apart along their line, each by half the deficit (≤ `SOCIAL_PUSH_MAX` 0.35 m) until no
   10 cm height band of their **front profiles** overlaps (+2 cm). Front profiles are generated from the rigs:
   `src/render/agents/reachFit.ts` (`UPDATE_REACH_FIT=1 npx vitest run tests/unit/clip-audit/reachFit.test.ts`; the
   suite fails when a rebuild moves a profile by > 1.5 cm). `hug` is profiled without the arms.
2. **Work stand-off** (F2) — `workStandoff` / `standingOffset`: a standing clip at a standing work slot (faceObject,
   or a posed `stand` slot outside the footprint) moves back along the facing until no part of the body below the
   object's work surface (catalog `surfaces`, else `height`) reaches past the footprint edge (≤ 0.28 m: never out of
   the approach tile the sim reserved, so it cannot walk the body into a wall behind it).
3. **Rest-slot approach** (F3) — a standing clip on a posed sit / lie / bath slot is shown on that slot's first
   approach tile facing the object (same `faceObjectPose` math as the sim), then stand-off applies. This is the
   normal gameplay path: `home_repair` (and fire / cleaning stages without a slot filter) put the run's
   `stageTarget` + `slot` on the lie / sit / bath slot, and `AgentManager.syncOne` → `standingOffset` reads exactly
   those. `slot:sarcophagus_cryo#lie:clean` (Terra's visual confirmation, legs through the sarcophagus): 261 mm → 0;
   same cause and fix for coffin_chillrest#lie (50 → 0), desk_hauntedpc#sit (155 → 0), tub_icebath#bath.
   `tests/unit/clip-audit/restSlots.test.ts` gates it without an allow-list (root outside the footprint, ≤ 15 mm) and
   checks every lie slot × all 26 bodies × lying clip for the back resting on the modelled surface (−30 … +20 mm);
   both fail with the fits off (`CLIP_AUDIT_FITS=0`).
4. **Lie surfaces** (F4) — `SlotSpec.lie.height` on every `lie` slot (render-only data, checked ±15 mm against the GLB
   by the static `lie-surface` check), `lieLift` rests the back (`LIE_FIT`, lowest spine / chest vertex per body ×
   lying clip, generated with the reach table) on it: the double bed's sleepers rise 5.7 cm out of the mattress.
5. **Footprints** (F12) — `tools/blender/objects/beds.py` (plot_budget weed tufts, coffin_pine leaning lid,
   coffin_chillrest length / centre / refrigeration unit) and `hobbies.py` (gym_limb rear floor bar + feet) keep the
   models inside their footprints; rebuilt with `build_all.py --only … --strict` and `--verify` (4/4 byte-identical on
   a second build).
6. **Detector / tooling** — glass canopy, wall and doorway checks, lie-surface check, mixed-body pairs (`--partner`),
   `reach` command; the CLI now **exits 1 when any penetration FAIL is outside the allow-list** (`matrix` / `summary`;
   `--report-only` for report runs; `CLIP_AUDIT_NO_ALLOW=1` judges without the list) — `tests/unit/clip-audit/cliExit.test.ts`.

All fits are pure, damped like the seat fit, and render-only; unknown bodies / clips get no fit.

## W-120 — request F (crawl floor penetration): resolved at runtime

Diagnosis: Astra, draft PR #51 (`docs/research/crawl-diagnostic.md`). The Lid Guard (`shield`) coffin lid is part of
the sculpt, skinned 100 % to `hand_L`; in the crawl it swung 374–422 mm below the floor at t ≈ 0.867 s while the hand
bones stayed ≥ +84 mm, so a whole-root lift (≈ 0.5 m of floating hands) was ruled out. No GLB, Blender source or
allow-list row changed for it.

1. **Held-prop stow** (`src/render/characters/heldProps.ts`, rule table `HELD_PROP_RULES`). At template preparation
   the lid is found as the largest rigid island skinned 100 % to `hand_L` (welded by position; 963 vertices), re-skinned
   to a new bone `heldProp_L` (identity under `hand_L`, the hand's inverse bind - pixel-identical outside the stow
   clips). Its stow poses are measured on the rest mesh (principal axes: long axis up, dome outward, 3 cm off the
   torso) relative to `chest`. Clip tags in `plan.ts`: `HANDS_DOWN_PRONE_ANIMS` (crawl, clean, feral) stow it on the
   back, `HANDS_DOWN_SUPINE_ANIMS` (sleep, bath, beEmbalmed) on the chest, blended by the crossfade weights; a floor
   clamp (96 hull support points) keeps it ≥ 2 mm above the rig floor in every other clip (sit rim −16 mm, pickup
   −2.6 mm before). A lost left arm still takes the lid with the collapsed hand. The other cast hand props (boss,
   ringmaster, gamer, tourist, streamer) are welded into the arm surface: separating them needs a GLB rebuild.
2. **Stumps.** Cast bodies: `CastRig.clampStumps` raises a missing leg's thigh about the hip just enough that the knee
   (collapsed shin + stump cap) clears the floor by the cap radius (restored before the next mixer pass; clips that keep
   the knees up are untouched). Classic: the missing leg's meshes were already hidden; its shin / foot bones kept
   animating and dragged the morph-collapsed (zero-area) shin stitch seams to −14…−17 mm. The classic rig now
   collapses the lost shin onto the knee like the cast rig (prosthetic legs keep it; the thigh stump is unaffected).
3. **Floor-contact lift** (`plan.ts FLOOR_CONTACT_LIFT`, model units × height scale, crawl only): classic 14 mm
   (palms planted 13–16 mm deep), shield 15.5, runner 15.5, thief 19, granny 9.5, fortune 20.5, tourist 21.5 (belly /
   chest contact). Hand bones move by exactly that and nothing else.
4. **Audit** (`tools/clip-audit/rigs.ts`). `poseRig` maps t through `auditClipTime`: looping clips (LoopRepeat) wrap
   t mod duration, one-shots (LoopOnce + clampWhenFinished) clamp to the end pose - the loop mode is read from the
   action the rig set up, so the audit plays exactly what the renderer's AnimationMixer plays (t = 2 on the 1.6 s
   crawl is 0.4 s, no longer the last frame). `playingDuration` reads the duration of the RUNNING action: a stopped
   action keeps its last weight, so the old "any action with weight > 0.5" pick often returned the previous clip's
   duration (idle, 4 s) and the gate's 0.92 × d sample fell past the end of shorter clips, where the clamp showed the
   loop's first frame. With both fixed, the gate measures real mid-clip phases; the clips whose rows changed are
   listed under §Gate below.

Minima over the whole legless crawl cycle (120 Hz + end ε + t = 2), mm, root at floor y = 0
(`tests/unit/clip-audit/crawlFloor.test.ts` prints the table for all 26 looks):

| look / h | pelvis before → after | hand bones before → after | lowest visible mesh before → after |
|---|---:|---:|---:|
| classic / 0 | 101.2 → 113.5 | 35.0 → 47.4 | −14.1 (shin_R stitch) → +0.5 (hand_R) |
| classic / 0.5 | 112.7 → 126.4 | 39.0 → 52.7 | −15.8 → +0.6 |
| classic / 1 | 124.2 → 139.3 | 43.0 → 58.1 | −17.4 → +0.6 |
| shield / 0 | 107.5 → 122.1 | 83.8 → 98.4 | −374.0 (lid) → +0.5 (belly); lid ≥ +113.5 |
| shield / 0.5 | 114.4 → 129.9 | 89.1 → 104.6 | −397.9 → +0.6; lid ≥ +120.8 |
| shield / 1 | 121.3 → 137.7 | 94.5 → 110.9 | −421.8 → +0.6; lid ≥ +128.0 |

With the lid out of the way the shield's own crawl showed −44 mm thighs, −64 mm stump caps and −17 mm belly; items 2
and 3 fix those. Every other look: stump caps ≥ +4 mm, held props / lid ≥ 0, hands unmoved except the lift, lowest
visible vertex ≥ −5 mm except the residuals below. Intact-leg crawl (unreachable in play: the sim crawls only with
both legs gone) keeps the feet-drag of F5 / A1 (classic ≈ −217 mm, allow-listed); the lid stays above the floor there too.

**Residuals that need sculpt / GLB work (reported, not fixed here):** bride, granny, fortune - long dress / skirt /
robe hems skinned rigid to pelvis / thighs (−79…−199 mm); boss, ringmaster, gamer, tourist, streamer - held props
welded into the hand surface (−7…−237 mm), no separable island for the stow rule; ringmaster - tailcoat tails on
spine / pelvis. The crawl test exempts exactly those bone labels for exactly those looks; everything else on them
is held to −5 mm.

**Gate re-baseline (separate commit).** With the audit sampling the clip on screen, 11 gate measurements of other,
already-requested causes came out deeper than (or outside) their rows; they were hidden by the old sampling, not
introduced by W-120. Raised (old → new cap, mm): mascot pickup item-body 37 → 78, mascot walk / limp floor 40 → 52,
classic cry self-arm 32 → 48, mascot dance partner 79 → 128, mascot shower wall-side 256 → 339. New rows: classic
shower self-arm 117, mascot collapse floor 33, mascot talk~laugh partner 210, classic pickup item-body 75, mascot
paint item-body 53. No row covers crawl or the shield; `floor:crawl` classic keeps its F5 row.

## Determinism

`src/sim` is untouched. The catalog gained a render-only field (`lie`) that the sim never reads
(`tests/unit/clip-audit/simUntouched.test.ts`: no `.seat` / `.lie` read and no render-fit import under `src/sim`).
Real-content runs (balance scenarios A/11, B/22, D/33, with a double bed and a cryo sarcophagus bought, 2 game days)
serialize to the same SHA-256 with the old and the new catalog (`db01ad02…`, `34136d78…`, `471e5cd0…`). Saves and
journals are unaffected; object GLB changes are visual only.

## Gate

`tests/unit/clip-audit/gate-{slotsA,slotsB,social,floor}.test.ts` (every scenario × classic + mascot, 2 clip times,
renderer fits; files run in parallel, ≈ 8 min wall on a loaded 4-core box — sampled on purpose, the 21,216-job full
matrix is the Spark2 nightly) and `gate-static.test.ts` (static checks + doorways for all 26 bodies, ≈ 5 s). A
penetration over 15 mm fails unless `tools/clip-audit/allowlist.ts` has a row for (check, clip, body) — one row per
measured exception, capped at the measured worst × 1.1 + 3 mm, each pointing at a cause (finding, class, owner,
reason). So a clip / body that is clean today fails the day it starts clipping, and a documented exception that gets
worse fails too. When an owner lands a fix: remove the cause's rows, rerun with `CLIP_GATE_DUMP=1` to regenerate the
remaining rows from `dev/out/clip-audit/gate-*.json`.

## Coverage

Combinations: the matrix is 272 × 26 = 7,072 per height. Measured here: 1,880 before + 1,211 after full-detector
evaluations (6 bodies before / 4 after complete), 508 gate evaluations (classic + mascot × every scenario), 210 static
checks, 26 doorways, 26 × 27 front profiles — the 2,351 slot / pair / floor evaluations cover every scenario for 6
bodies and the widest body; the cross-check across all 26 bodies and three heights is Terra's Spark2 sweep at 81ad2a8 (partial
tally so far: 253 evals, mostly classic @ h0 — object 94, floor 49, partner 20, self 18, item-body 1; worst
sarcophagus#lie:clean 260 mm = F3, fixed here). Not covered: vehicles / playground extras (no content stages them on
furniture yet), pet interactions (no pet runtime), rotations other than 0 (the harness proves slot poses are
rotation-invariant in the rendered frame).
