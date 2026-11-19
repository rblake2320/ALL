# Seating — seat geometry contract, fix notes and requests to the rig owners

Owner bug (starter lot, classic zombie in the red `armchair_tattered`): the zombie looked perched on the front of the
armchair — thighs and knees vanished into the seat, the shins / feet came out through the front of the chair's base,
the back did not meet the backrest.

## 1. Root causes (measured)

Measurements: `tests/unit/seating` (real GLBs, raycasts; real rigs, skinned vertices; composed exactly like the game:
slot pose → AgentManager → rig height-scale rule). Seat frame = metres from the slot root (the sitter's rig root),
+z = the way the sitter faces.

1. **Furniture had solid volume where the sit\* clips put the legs.** Every sit\* clip stands the shins / feet on the
   floor from z ≈ +0.15 (tucked foot) to +0.70 (toes), with calves under the thighs from z ≈ +0.02. The upholstered
   seats were solid boxes from the floor to the cushion out to z = +0.37…+0.41 (armchair +0.39, moldy loveseat +0.38,
   velvet sofa +0.41) and the PC desk's drawer pedestal + tower left a 0.24 m kneehole for feet that spread ±0.35 m.
   So the lower legs were *inside* the chair (armchair: up to 82 % of the shin / foot samples of a body inside).
2. **The backrest position was one number for bodies whose backs differ by 27 cm.** The lumbar back (rearmost
   trunk vertex at cushion + 0.22) sits 0.04 m (screamer) … 0.165 m (classic) … 0.31 m (boss, strongman) behind the
   rig root; the backrest faces were 0.10 (armchair, loveseat) / 0.20 (chairs, pew) / 0.22 m (velvet sofa) behind the
   slot root. With one root per seat, slim bodies sat 12–17 cm off the backrest and big ones up to 27 cm into it.
3. **Seat data was implicit.** A `sit` slot only had a root pose; nothing said where the modelled cushion / back /
   lip were, so nothing could fit a body to the seat or test it.
4. **(Rig — not fixed here, see §4.)** The shared sit\* clips slope the thighs steeply down: classic `sit` hip joint
   (thigh_L) at y 0.53, z −0.02; knee (shin_L origin) at y 0.32, z +0.21 → 42° down (right leg 22°; sitEat 31°,
   sitTV 39°). The knees sit ~14 cm *below* the 0.46 m cushion top, so on any seat the thighs dip into the front of
   the cushion. This is what reads as "perched on the front edge".

## 2. Seat geometry contract (`SlotSpec.seat`, src/shared/seating.ts)

Every `kind: 'sit'` slot declares the modelled seat (required, tested ±1.5 cm against the GLB):

| field    | meaning |
|----------|---------|
| `height` | cushion top under the hips, object-local y. Renderer lifts the rig by `height − DIM.SEAT_HEIGHT` while seated. |
| `back`   | backrest face at lumbar height (`height + SEAT_LUMBAR` = +0.22) behind the slot root; `null` = backless (stools). |
| `front`  | front lip of the seat ahead of the slot root. |

Renderer (src/render/agents/seat.ts, `AgentManager`): while an agent plays a sit\* clip on a sit slot with seat data
(`active.stageTarget` object + `active.slot`), its root slides along its facing so the body's lumbar back rests on
the backrest face (1.5 cm into the padding), clamped to [−0.08, +0.12] m and so that the hip contact stays 5 cm behind
the lip; the offset is damped (no pop when the clip starts). Per-body / per-clip lumbar back + seat-contact z come
from `src/render/agents/seatFit.ts`, **generated from the rigs** by `tests/unit/seating/seatFit.test.ts`
(`UPDATE_SEAT_FIT=1 npx vitest run tests/unit/seating/seatFit.test.ts`; the suite fails when a cast / classic rebuild
moves a body by > 1 cm — rerun the generator after rebuilding character GLBs).

Furniture (tools/blender/objects/seating.py, one seat frame for every upholstered seat):
`SEAT_BACK` 0.11 (backrest face), `SEAT_LIP` 0.17 (cushion lip), `SEAT_KICK` −0.06 (base face, *behind* the root:
the space under the front of the seat is open for tucked feet and calves), cushion = 10 cm slab on top. Arms run past
the lip to the floor. Desk: the drawers hang under the top and the tower stands on the desk, so the kneehole is the
whole width between the desk legs.

## 3. Per-object numbers (seat frame, metres; before → after)

| object / slot | cushion top | back face | lip | solid under the seat front | shin/foot samples inside (worst body) |
|---|---|---|---|---|---|
| chair_creaky | 0.460 → 0.460 | 0.20 → 0.20 | 0.23 → 0.23 | open (legs) | 0 → 0 |
| chair_ribcage | 0.467 → 0.467 | 0.21 → 0.21 | 0.23 → 0.23 | open | 1 % → 0 |
| armchair_tattered (root z 0.48 → 0.52) | 0.456 → 0.455 | 0.10 → 0.09 | 0.40 → 0.175 | to +0.39 → −0.06 | 82 % (nurse) → 0 |
| sofa_moldy sit0/sit1 | 0.442/0.444 → 0.463/0.450 | 0.10 → 0.10 | 0.38 → 0.17 | to +0.37 → −0.06 | 100 % (granny feet) → 0 |
| sofa_velvet sit0–2 | 0.455 → 0.455 | 0.22 → 0.11 | 0.38 → 0.17 | to +0.41 → −0.06 | 92 % (nurse) → 0 |
| pew_salvaged sit0/sit1 | 0.46 → 0.46 | 0.20 → 0.19 | 0.24 → 0.17 | apron +0.22 → behind root | 0 → 0 |
| desk_hauntedpc stool | 0.454 → 0.455 | — | 0.18 → 0.18 | kneehole ±0.12 → ±0.42 | 53 % (thief, feet in pedestal) → 0 |
| table_bonechess sitL/sitR | 0.450 → 0.451 | — | 0.18 → 0.18 | open | 0 → 0 |

Back on the backrest (lumbar back vs face, + = into the padding), classic `sit`: armchair +0.065 → +0.015, velvet
sofa −0.055 → +0.015, pew −0.035 → +0.015; worst slim body (screamer) on the pew/chairs: 0.17 m gap → ≤ 0.12 m
(shift clamp); big backs (strongman, mascot, fortune) ≤ 0.20 m into the padding (lip cap wins), boss cape excluded.

Before/after failure counts of the suite's checks: `SEAT_BEFORE=1 SEAT_OBJ_DIR=dev/out/seating/before-assets/models/objects
npx vitest run tests/unit/seating/seating.test.ts` (old GLBs, no fit) vs. the normal run (all green).

## 4. Requests to the rig owners (tools/blender/characters/** — Astra; src/render/characters/** — cast-runtime)

1. **sit\* thigh slope (main remaining visual issue).** `anim/base.py::sit_legs` targets the ankles at
   `feet_y = −0.40` (0.40 m ahead of the root, 0.085 m high). With the classic thigh 0.312 m + shin 0.333 m and the hip
   joint 0.53 m high, the hip→ankle distance is 0.60 of a 0.645 m reach, so the IK nearly straightens the leg and the
   knee drops to y 0.32 (14 cm below the cushion). Please put the ankles at ≈ **−0.29** (shin vertical): the knee then
   sits at ≈ y 0.42, z +0.29 and the thigh slopes ≈ 21° (the most the classic legs allow with the feet on the floor at
   SEAT_HEIGHT 0.46 — knee height with a vertical shin is 0.418 m). Keep the tucked foot (`dr`) ≤ 0.10 m behind the
   other. Acceptance: in `tests/unit/seating`, `KNEE_PRESS` can drop from 0.12 to 0.06 with the suite green, and
   `anchors.test.ts` gets `shin_L.y > 0.38` for every sit clip. Furniture then has room for a deeper lip (`SEAT_LIP`
   0.17 → 0.24) — tell OBJECTS and the lip/kick constants + catalog `seat.front` move together.
2. **Height scale sinks tall sitters' feet.** rig.ts / castRig.ts keep the pelvis on SEAT_HEIGHT by offsetting the
   scaled model (`inner.y = SEAT_HEIGHT·(1−s)`), so at s = 1.06–1.08 the feet go 3–4 cm through the floor (civilian,
   jogger, pizza, strongman @1.06: −0.031…−0.038; the suite tolerates −0.045). Suggest blending a knee lift with
   `s` (thigh pre-rotation like `sitThighLift`) or scaling the legs about the pelvis.
3. **Mascot seat contact** is ~0.50 m (others 0.40): the bear suit's hips float 4–6 cm above every cushion
   (`pelvisRule.seatContactY` is not met for that body).
4. **Boss cape** (rigid on the pelvis) passes up to 0.32 m through every backrest (already noted in cast.md); the
   seat fit cannot fix it without sliding him off the lip, so the suite exempts it.
5. After any character / cast GLB rebuild, regenerate `src/render/agents/seatFit.ts` (command in §2).
