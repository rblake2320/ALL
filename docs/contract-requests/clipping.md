# Clipping (W-073) — requests to the animation / cast / level owners

Audit: `docs/audits/clipping-W073.md` (method, ranked findings, root causes). Gate: `tests/unit/clip-audit/gate-*.test.ts`
with the allow-list `tests/unit/clip-audit/allowlist.ts` — every entry below has an allow-list entry naming this file;
**remove the entry when the fix lands** (the gate then keeps it fixed).

All numbers are penetration depths measured by the audit on the real GLBs and the real clips (CPU-skinned at 3 clip
times, renderer root offsets applied), mm. Reproduce one finding:
`npx vite-node tools/clip-audit/run.ts matrix --bodies <body> --filter '<scenario key regex>' --run check`
and look at it: `npx vite-node tools/clip-audit/run.ts shot --key '<scenario key>' --look <body>@h0.5 --t <s>`.

What W-073 already fixed in this repo (no action needed): social partners standing inside each other, zombies
leaning into counters / stoves / bins, standing "repair" clips played inside beds and desks, the double bed's
mattress 5.5 cm above its lie pose, four furniture models overhanging their footprints — see the audit §Fixes.

## A. Animation clips — Astra (tools/blender/characters/**, zombie.glb; W-051)

Clips are shared by every body (cast bodies retarget zombie.glb), so each fix below lands for all 26 bodies.

| # | clip(s) | what goes through what | measured | request / acceptance |
|---|---|---|---|---|
| A1 | `crawl` | feet / shins 0.15–0.23 m below the floor (all bodies; classic −210 mm) | worst 227 mm (thief) | Keep the dragged legs on the floor plane: lowest foot/shin vertex ≥ −10 mm over the clip. Gate: `pen:floor` on `floor:crawl` ≤ 15 mm. **Request F (W-120), resolved at runtime:** the shield lid (−422 mm) is stowed on the back, missing-leg stumps are raised, a per-look contact lift (mm) applies; legless crawl ≥ −5 mm for every look except dress / robe hems (bride, granny, fortune), hand props welded into the hand (boss, ringmaster, gamer, tourist, streamer) and the ringmaster tailcoat — those need sculpt / GLB work (audit §W-120). The intact-leg feet drag here is unchanged. |
| A2 | `mourn` (kneel at urns, bone piles, plants) | kneeling feet / toes 0.1–0.15 m into the floor | worst 149 mm (cone) | Kneel with the toes on the floor (ankle plantar-flexed, toes ≥ 0) and knee on the floor plane (knee vertex ≥ −10 mm). |
| A3 | `flirt`, `cheer`, `stretch`, `hug`, `walk`/`limp` (cast) | foot rolls through the floor on tip-toe / weight shift | 27–76 mm (flirt 76 on gold) | Pin the planted foot's sole to y ≥ −10 mm; the cast retarget amplifies foot roll on long-footed bodies, so test on walker/gold/cone. |
| A4 | `collapse`, `sleep`, `beEmbalmed`, `bath` on a flat floor | shoulders / pelvis 25–240 mm below the root plane | collapse 163 mm (bride), classic 25 mm | `collapse` is played on the floor (passing out): lowest trunk vertex ≥ −10 mm. In `sleep` the head lies level with the back, so it sinks 55–67 mm into every pillow / headrest (pine coffin, double bed, sarcophagus): raise the head ≈ 8 cm (neck flexion) so it rests on the pillow top. Lying clips on beds are lifted by the renderer (lie lift), but the trunk sitting 12 mm below the root in every lying clip should be 0. |
| A5 | `admire`, `stretch`, `shower`, `cry`, `cook`, `listen`, `cheer`, `sitChess`, `wave` | hand / forearm through the head or chest (big cast heads) | 90–164 mm (thief admire 164; classic admire 61.7 mm hand into the pelvis — also Terra's Spark2 pilot at 81ad2a8) | Keep the hands ≥ 3 cm outside the head on the classic rig and add a head-clearance margin (the cast heads are up to 1.6× the classic head, `manifest.cast.json`): face-touching gestures should stop at the classic face + 6 cm. |
| A6 | `idle`, `groan`, `collapse`, `sit` | classic forearms hang into the hips (hands vanish into the shorts) | idle 77 mm (classic); self-penetration is a clip issue on the classic rig itself, not a cast scale / offset one | Abduct the upper arm ~8° in `idle`/`groan` so the forearm clears the pelvis mesh. `idle` is the most-seen pose in the game (S1). |
| A7 | `clean` used for wiping counters, cleaning stoves / fridges, repairing appliances, fighting fire | the floor-mopping bend reaches 0.7–1.3 m ahead; at a counter the head goes into the worktop | 328 mm before the fit; after the renderer stand-off ≤ 0.28 m it still reaches 150–200 mm on the widest bodies (mascot) | New clip **`wipe`** (counter-height scrub: hands at 0.85–0.95 m, 0.35–0.55 m ahead of the root, head ≤ 0.25 m ahead) and point `cleanStove`/`wipeDown`/`cleanFridge`/`repair` at it (contract edit in src/shared/appearance.ts + sim content by Claude Cloud at merge; the sim only stores the anim name). Acceptance: `pen:object` ≤ 15 mm at every counter-height `front` slot for every body. |
| A8 | `pickup` at bins / stereo / plants | bends the head 1.0–1.3 m forward into the trash can / stereo | 185 mm (mascot, trash_lidded) | Bend from the hips with the head ≤ 0.6 m ahead of the root (reach with the arm, not the head). |
| A9 | `sit*` thigh slope | thighs press into every cushion (already requested: `docs/contract-requests/seating.md` §4.1) | 30–50 mm on chairs / sofas, 46 mm at the chess table | as seating.md §4.1. |
| A10 | `sitTV`, `sitEat`, `sit` arms | forearms / elbows rest 6–10 cm *inside* armrests (armchair, velvet sofa end seats) | 99 mm (runner sitTV armchair) | The resting forearms / elbows sit wider than the armrests' inner faces on the armchair and the sofa end seats: bring them onto the thighs / lap (|x| ≤ 0.22 m from the spine line) or onto the armrest tops. |
| A11 | `sitRead`, `sitComputer` at the PC desk | head and hands into the desk hutch / monitor | 105 mm (walker sitRead) | Keep the head and hands above / behind the desk front edge while seated (lean less; the hutch and monitor occupy the desk top). |
| A13 | `angry`, `feral`, `kiss`, `hug`, `dance` (socials) | the lunge / lean reaches 0.8–1.0 m ahead of the root on big bodies; the renderer's social spacing moves partners apart by at most 0.35 m each, so wide bodies still meet head-in-head | mascot angry 287 mm, feral 285, hug 246, kiss 185; classic hug 37 | Keep the lunge ≤ 0.45 m ahead of the root (step-in amplitude), and author `hug` / `kiss` for a partner 0.75 m away (arms around the partner's back, not through the chest). Acceptance: `pen:partner` ≤ 15 mm for every gate body at 0.55 m and 1.0 m. |
| A12 | carry anchors (`anchors.py` carryAnchors) — `sitRead+book`, `phone`, `pickup+pizza` | book / pizza box into the chest; hand 30–57 mm off the book on cast bodies | 55 mm (bride pizza), 57 mm gap (gold book) | Anchors are computed on the classic proportions; please export them per body proportions or relative to both hands (see B2). |

## B. Cast runtime / cast assets (src/render/characters/**, tools/blender/cast/**)

| # | what | measured | request |
|---|---|---|---|
| B1 | Doorways: walking half-width (arms + held props) vs the 0.43 m door half-opening | boss 995 mm (staff in hand_L), strongman 1031, mascot 715, ringmaster 658, fortune / tourist 532 | Props swing wide of the body: carry them closer (|x| ≤ 0.40 m) or swing them in front while walking. Bodies themselves (no arms): only mascot (534) and tourist (532) are wider than a door — they need a sideways shuffle through doorways (render) or narrower suits (art). |
| B2 | Carry anchors on cast bodies (A12) | — | Retarget the anchor matrices per body (scale by the forearm / hand length ratio) so the item sits in the palm. |
| B3 | Big cast heads sink into the pillow in lying clips (head 0.13–0.27 m below the root: jogger, bride, tourist, runner) | jogger 268 mm | Per-body head lift in lying clips (neck pre-rotation like `sitThighLift`). |
| B4 | Boss rigid cape (already in cast.md 'Big Lug'): through seats, beds, the floor when kneeling | 223 mm (mourn) | as cast.md. |

## C. Level kits (tools/blender/levels/**, tools/blender/rotrow/**)

Floor-kind level models whose bounds exceed their manifest footprint (neighbours / paths placed on the next tile
intersect them): tree_willow 222 mm, pond_murky 148, stairs_crypt 100, board_notice 46, rack_tools 20,
den_stray_raccoon 19. Either enlarge the footprint in the manifest or pull the geometry in (≤ 5 mm); trees may
declare a canopy exemption (`canopy: true`) the static check can honour.

## D. Objects (W-073 follow-ups, OBJECTS lane)

| # | what | measured | note |
|---|---|---|---|
| D1 | Fridge doors swing into the user standing at `front` | 35–51 mm (shoulder / forearm in `door_leaf`) | open the leaf to 110° (away from the user) or hinge it on the far side of the slot. |
| D2 | `armchair_tattered` back overhangs its footprint by 21 mm | static | Hidden inside a wall (wall half-thickness 60 mm); left alone to not disturb the W-073 seating fit — fix with the next armchair rebuild. |

## E. Sim content (sim-home) — not changed here (determinism)

`home_repair` targets `at.target()` without a slot filter, so repairing a bed / sarcophagus / desk / tub resolves to
the object's lie / sit / bath slot and the zombie stands *inside* the furniture. The renderer now shows it on the
slot's first approach tile (W-073 rest-slot approach), but the sim position is still inside the object. Request: give
`repair` (and `cleanFridge`, `cleanStove`) an explicit slot filter (`front` / `use` / a new `work` faceObject slot)
in the next balance-affecting content change, with a save-compat test.
