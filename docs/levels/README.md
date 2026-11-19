# Level design docs — index & shared conventions (W-026)

Owner of `docs/levels/**`: level design agent (cloud). Framework contract: `src/shared/world.ts`; framework design:
`docs/DESIGN_WORLD_LEVELS.md`. Numbers come from `docs/GDD.md` and `docs/BALANCE.md`. Where a level needs a change
there, the level doc says **PROPOSED GDD CHANGE**. Every one is collected in §9 below so the lead can accept or
reject them in one pass. Decisions made while writing these docs are in §10, as proposed rows for `docs/DECISIONS.md`.

| # | Doc | Level id | Build order | One-line pitch |
|---|---|---|---|---|
| L1 | [L1-wormwood.md](L1-wormwood.md) | `wormwood` | shipped (+3 lots) | The starter street: what exists, 2 new house templates and a corner park |
| L2 | [L2-graveyard.md](L2-graveyard.md) | `graveyard` | **1st** (most detailed) | The free-food commons: digging, grave goods, fishing, strays and the crypt door |
| L3 | [L3-rotrow.md](L3-rotrow.md) | `rotrow` | 2nd | Downtown: pantry, shops, gym, library, office, nightclub, salon, two apartments |
| L4 | [L4-bayou.md](L4-bayou.md) | `bayou` | 3rd | Stilt houses, swamp foraging, boat tours, the Swamp Guide career |
| L5 | [L5-mausoleum.md](L5-mausoleum.md) | `mausoleum` | 4th | Old-money hill: mansions, wealth goals, galas, the high-end catalogue |
| L6 | [L6-underneath.md](L6-underneath.md) | `underneath` | 5th (needs floor −1) | The dig/build layer under every lot, plus the Catacomb Market |
| L7 | [L7-necropolis.md](L7-necropolis.md) | `necropolis` | 6th | The growing shared town: blueprints, gallery, square, Creator Kit |

### Totals (all seven docs)

| Level | New lots (templates) | New objects | New interactions | New moodlets | Story quests (Bones) | Repeatables | Daily tasks | Plans validated |
|---|---|---|---|---|---|---|---|---|
| L1 | 3 (bungalow, townhouse, corner park) | 7 | 9 | 5 | 3 (210) | 4 | 4 | 3/3 |
| L2 | 1 (graveyard) | 19 | 39 | 19 | 7 (590) | 9 | 6 | 1/1 |
| L3 | 9 (7 venues + 2 apartments) | 31 + 1 floor | 33 | 12 | 8 (610) | 9 | 6 | 9/9 |
| L4 | 6 (3 stilt houses + 3 venues) | 24 + 1 floor + 4 env + gator | 21 | 6 | 7 (620) | 8 | 5 | 6/6 |
| L5 | 6 (3 mansions + 3 venues) | 19 + roof kit | 23 | 10 | 7 (700) | 8 | 4 | 6/6 |
| L6 | 1 venue + floor −1 under every lot + 3 prefabs | 26 + 1 wall style | 17 | 5 | 7 (680) | 5 | 3 | 4/4 |
| L7 | 2 venues + 48 blueprint plots | 10 + 1 floor | 13 | 4 | 6 (720) | 5 | 3 | 3/3 |
| Shared (§8) | — | 9 | — | — | — | — | — | — |
| **Total** | **32 layouts** (29 lot templates + 3 basement prefabs) | **145** | **155** | **61** | **45 (4,130 Bones)** | **48** | **31** | **32/32** |

Collections:
- L2: Graveyard Curios (14) and Pond Life (10);
- L4: Bayou Waters (8) and Bayou Finds (8);
- L6: Catacomb Relics (8).

Each pays 150 Bones + a frame cosmetic.

**Validation.** Every plan in these docs, all 32 lot/prefab layouts, was generated from data and checked with the
shipped spatial code (`createSpatial` → `checkPlace` / `checkWallItem` / `checkOpening`, blocked-slot check, and
`distanceField` reachability of every slot from both sidewalk entries), the same checks as
`tests/unit/spatial/templates.test.ts`. Each plan's object list is the input that produced it, so the implementer
can transcribe it straight into `src/sim/spatial/templates`.
- New objects were stood in with their documented footprint and slots.
- Water terrain and the floor −1 stairs landing were stood in with impassable placeholders and a south entry
  corridor respectively (noted where used).

## 1. Id conventions (all stable once saved, never rename)

| Thing | Pattern | Example |
|---|---|---|
| Lot | `<levelId>:<slug>` (world.ts) | `graveyard:old_graveyard` |
| Lot template | `<levelId>_<slug>`; L1 keeps `starter` / `empty` | `graveyard_main` |
| Object def (catalog) | `<noun>_<adjective>` like the existing catalogue; items `item_<noun>` | `mound_soft`, `item_curio` |
| Interaction | `<module>_<verb>`; modules: `park` (L1), `grave` (L2), `fish`, `curio`, `stray`, `pet` (shared), `town` (L3), `bayou`, `hills`, `under`, `necro` | `grave_digGrub` |
| Moodlet | camelCase | `dirtUnderNails` |
| Stat key | camelCase, global + per agent like `STAT` in `src/sim/content/home/ids.ts` | `gravesDug` |
| Quest | `story_<lv>_<slug>`, `n_<lv>_<slug>`, daily `d_<lv>_<slug>`; `<lv>` ∈ `ww gy rr by mh un np` | `story_gy_cryptKey` |
| Ambience | `amb_<levelId>[_<variant>]` | `amb_graveyard_night` |
| Music theme | `mus_<levelId>[_<variant>]` (each theme renders the existing `MusicMood`s) | `mus_graveyard` |
| Environment | `env_<levelId>` (sky/fog/ground palette set, see each doc §11) | `env_graveyard` |
| Collectible | `curio_<slug>` (data on `item_curio`), fish `fish_<slug>` (data on `item_fish`) | `curio_cameoBrooch` |

## 2. Lot grid (all levels)

- **Every lot is a standard 30 × 30 grid** (`newLot()` in `src/sim/spatial/templates/builder.ts`: sidewalk row z = 28,
  entry points at the sidewalk ends). Smaller lots (apartments, shops) shrink `LotState.buildable` instead of the
  grid. Pathfinding, the cutaway, the camera bounds and the save format already handle 30 × 30, and nothing new is needed.
  In each doc, `width×depth` in a LotDef table is the grid (30×30), and **buildable** is given separately.
- ASCII plans show one character per tile. A row label is the z coordinate; the ruler above gives x. `|` and `-` are
  walls on tile edges, drawn in the gap between tiles where the plan has room. Otherwise wall edges are listed
  under the plan in the same notation as the starter template (`h:x:z` = the edge along x at the north side of row
  z; `v:x:z` = the edge along z at the west side of column x).
- Shared plan legend (each plan adds its own letters):

| Char | Meaning | Char | Meaning |
|---|---|---|---|
| `.` | grass / ground | `=` | sidewalk (z = 28) |
| `:` | gravel or flagstone path | `~` | water (impassable; new terrain, L2 §4) |
| `#` | wall run | `D` | door |
| `W` | window | `f` | iron fence segment (`env_fence`, non-buildable dressing; becomes a catalogue item `fence_iron` in L2) |
| `T` | tree | `L` | lamp / lantern post |
| `B` | bench | `n` | notice board (`board_notice`, shared) |

## 3. Travel & map

- **Map space:** one global plane, 0..1000 × 0..1000 map units. Levels are tabs on the Neighbourhood Map, but lots
  share one coordinate system so distances work across tabs.
- **Travel time** (DESIGN_WORLD_LEVELS §1 says "15–45 game min by map distance"): `travelMin = clamp(round(15 + 0.06 × d), 15, 45) × vehicleMult`,
  where `d` is the Euclidean map distance between the two lots. `vehicleMult` = 1.0 for the carpool hearse; owned vehicles (DESIGN_PILLARS §D, W-031) set
  their own (e.g. bike 1.1, car 0.7). The vehicle doc owns those values, and the result is never below 10 min. Reference trips (carpool):

| From Mildew Lane starter (220,470) to | d | minutes |
|---|---|---|
| Corner Park (310,440) | 95 | 21 |
| Old Graveyard (420,400) | 212 | 28 |
| Rot Row Market (580,330) | 386 | 38 |
| Swamp Diner (160,740) | 277 | 32 |
| Hilltop Museum (680,150) | 560 | 45 (clamped) |
| Necropolis Square (860,540) | 644 | 45 (clamped) |
| Catacomb Market | via the crypt door only (L6): walk-through, 0 travel | — |

- **Opening hours:** `hours: {open, close}` in game hours. `close < open` means the lot is open past midnight
  (`{open: 20, close: 3}` = 20:00–03:00). The household is warned 30 min before closing, and the lot sends it home at
  close by the normal carpool trip. A household on a **24 h lot** (`hours` undefined) may stay forever.
- **Unlock union:** `LotDef.unlock` holds one requirement. Where a design says "day 3 **or** quest X", the LotDef
  carries the day rule, and the quest's completion pushes the level id into `TownState.unlockedLevels` early
  (`grantLevelUnlock` effect, PROPOSED in §9 P-W1).

## 4. Community-lot runtime rules (all levels)

| Rule | Value | Why |
|---|---|---|
| Max simulated townies on a community lot | **8** (+ up to 2 venue NPCs, + up to 3 strays/animals) | perf (§7); a venue feels busy at 5–8 |
| Max household members travelling | household cap 8 (GDD §9) | — |
| Max simulated agents per lot | **21** = 8 household + 8 townies + 2 NPC + 3 strays | autonomy cost scales with agents × candidates |
| Max placed objects per community lot | **240** (incl. wall-mounted, excl. floor tiles) | starter lot has ~45; the graveyard has 72 template objects + up to ~40 transient items |
| Townie arrival schedule | seeded from `(worldSeed, lotId, day)`: each venue has a per-hour arrival weight table (in each doc); arrivals are drawn hourly, stay 1–3 h | deterministic, no per-tick RNG |
| Venue NPCs | fixed named agents with role `npc`, a shift (hours), and a home lot that is not simulated | groundskeeper, librarian, DJ, … |
| Community-lot persistence | objects broken, dirt, items left behind, dug mounds' cooldowns persist in the lot snapshot; townies do not | DESIGN_WORLD_LEVELS §1 |
| Catch-up on re-entry (closed form) | mounds re-settle (cooldown expires), stray schedule recomputed for the current day, items older than 48 h despawn, dirt +1/day to cap | idempotent, per DESIGN_WORLD_LEVELS §1 |
| Free-food autonomy gate | free food (dig, forage, fish, pantry, pigeons) scores only when the actor's household funds < $12 (the cheapest recipe, Brain Loaf) **or** no paid food is reachable on the active lot | DESIGN_SURVIVAL_PETS_SAVES §2 |
| Daily cap | community interactions follow `DAILY_PICK_CAP = 6` (GDD §14); a free-food interaction counts as an **essential** (eating) only while Appetite < 55, else as non-essential | stops dig-farming by autonomy, never starves a broke zombie |

## 5. Economy & reward scales (shared across all docs)

- **Household $ (sim):** wages per GDD §10 (L1 $15–20/h). A level's money sources must stay **below an L1 wage per
  hour of effort** at skill 0, and reach about an L2 wage at skill 8–10, so hobbies never beat jobs early:
  - digging ≈ $4/h at skill 0, ≈ $11/h at skill 5, ≈ $20/h at skill 10 (capped by mound cooldowns);
  - fishing ≈ $3.5/h at skill 0, ≈ $14/h by day and ≈ $20/h at night at skill 6 (L2 §4.2–4.3);
  - a museum donation pays Bones, not $.
- **Collectible sell values** use three bands: common $5–35, uncommon $40–80, rare $90–200. Sale channels:
  - **"Sell Curios by Mail"** at any mailbox: 100 % of value, paid in the next 09:00 mail;
  - **Rot Row Market's curio counter**: 110 %, instantly.
  The value never changes with rarity luck after the find, and there is no paid randomness anywhere.
- **Bones** (profile currency, MONETIZATION §2). The target is that an engaged free player unlocks one premium item
  about every 45 min. The current Bones catalogue's mid items cost 120–300 (`src/economy/catalog.ts`), so the level
  budget is about **260 Bones per engaged hour**. Every level uses this scale:

| Reward | Bones |
|---|---|
| story step quest | 40–120 (the level's capstone 150–200 + a cosmetic) |
| repeatable `n_` quest | 15–60 |
| daily task | 6–15 |
| a level's full story chain | about 500–900 total |
| completed collection (all curios / all fish) | a one-time 150 Bones + a cosmetic entitlement |

- **Catalogue tiers** per MONETIZATION §3 and `src/economy/catalog.ts`. Anything needed to survive or to use the
  level's core loop (shovel, rod, pet bowl, cheapest bed of a new kind) is **free**. Nicer variants are `bones`.
  Themed sets are `premium` (GG bands: small decor 150–300, furniture 300–600, set 1,200–1,800 with the
  sum-of-parts shown). `sponsor` items are free and carry a house-brand skin (Grave-Cola, Mulch Master, Coffin Coffee,
  Brain Bran, Rot-Pop, Crypt-Kicks, Volt-Hearse, Necro-Tech; never a real mark).
- New buyable objects default to `free` until `src/economy/catalog.ts` lists them, which is safe by design.

## 6. Interaction-number scales (match the shipped content)

| Kind | Reference (shipped) | New content stays within |
|---|---|---|
| Amusement /h | TV 20, video games 20, arcade 22, dance 18, chess 10, read 11, music 10, paint 8 | 6–22 (event-only séance/parade up to 25) |
| Skill xp /h | stove 40, mirror 30, embalming 50, chess 30, read 25, gym 45, dance 20 | primary skill object 35–45; side xp 10–25 |
| Social /h from activities | browse web +3, eating together +4 | +3…+8 (group venue activities); socials themselves unchanged (+8 per success) |
| Hunger | jerky +20 ($5), burrito +40 ($8), serving 45–70 | free snacks +6…+24; free meals ≤ +50 |
| Freshness | spray +8 ($15 = $1.88/pt), Chill Out +10/h, embalm +45 ($30), ice bath +22 | paid venue treatments ≤ $1.88 per point (never cheaper per point than embalming, $0.67); free ≤ +10/h |
| adBonus | 2–4 hobbies, 12–14 chores | the same |
| Duration | 5–90 min | the same; event joins 60 min |

New **animation states** a level needs are marked "proposed clip (fallback `x`)". `ANIM_STATES` lives in
`src/shared/appearance.ts` (lead-owned), so every doc names an existing fallback that ships if the clip is not made.

## 7. Performance & test budgets (every level's acceptance criteria repeat these)

- Draw calls **≤ 650** on the busiest view of every lot (renderer stress budget, task #92). Each doc gives its own
  estimate.
- Triangles: furniture 300–3,000, large items ≤ 6,000, environment buildings ≤ 6,000, characters per ART_DIRECTION.
  Background dressing (neighbouring houses, skyline) uses `ENV_MODELS`-style low-poly pieces: instanced, no shadows
  beyond 40 m.
- RAM < 1.5 GB total; a lot swap ≤ 2 s load target; a world save ≤ 2 MB uncompressed with every level's lots visited
  (DESIGN_WORLD_LEVELS §1). The per-lot snapshot budget is ≤ 120 KB for a community lot, ≤ 200 KB for a furnished
  residential one.
- **Determinism** (every level): same seed + same commands produce byte-identical `WorldState` after:
  - a first entry (template build);
  - a home → venue → home round trip;
  - save → load in the middle of the trip, and during each level's signature interaction;
  - catch-up applied once vs twice (idempotent).
- **Balance:** every level that adds food, freshness or money sources must keep the GDD §18 targets. Rerun
  `npm run balance` (all 110 runs) plus that level's own scenario (listed in the doc).

## 8. Shared new objects used by several levels

Defined once here; levels only list them under "reused".

| id | Name | Tier / $ | Footprint | Tags | Slots | Interactions | Art & tris |
|---|---|---|---|---|---|---|---|
| `board_notice` | Community Notice Board | not buyable (community dressing) | 1×1, floor | `notice`, `quest` | `front` stand | `town_readBoard` (shows the level's repeatable quests and events; 2 min; fun +2) | Weathered cork board on two posts, pinned papers, a crooked "LOST: LEFT ARM" flyer. ≤ 900 tris |
| `fence_iron` | Wrought-Iron Fence | free, $20/segment | wall-edge item (like a wall: built with the wall tool as a fence style) | `fence` | — | — | The existing `env_fence` mesh as a placeable fence style; passable = false; does not count as a room wall. ≤ 300 tris per segment |
| `gate_iron` | Creaky Iron Gate | free, $120 | opening on a fence edge | `door`, `gate` | — | door behaviour (`home_slamDoor` disabled on gates) | Two-leaf wrought-iron gate with curled finials, squeaks open (`doorOpen` sfx pitched up). ≤ 1,200 tris |
| `path_gravel` | Gravel Path (floor style) | $2/tile | floor style | — | — | — | Pattern `gravel`, base `#8d877a`, accent `#6f6a60`. Needs a new floor pattern in `styles.ts` (§9 P-W4) |
| `item_curio` | (collectible) | item | 1×1 item | `curio`, `collectible`, `sellable` | `grab` | `curio_pickUp`, `curio_examine`, `curio_sellMail`, `curio_display` | Per-curio models `curio_<slug>`, each ≤ 400 tris; data `{curioId, foundTick, finderId}` |
| `item_fish` | (catch) | item | 1×1 item | `fish`, `sellable`, `ingredient` | `grab` | `fish_grill`, `fish_putInFridge`, `fish_sellMail`, `fish_mount` | Four shared meshes (small, deep, long, eel), each ≤ 300 tris, tinted per species; data `{fishId, weightG, caughtTick}` |
| `shelf_curio` | Curio Cabinet | free, $220 | 1×1, floor, indoor | `decor`, `display` | `front` stand | `curio_display` (place a curio: up to 4 surfaces), `curio_admireCollection` (10 min, fun +10/h) | Glass-front cabinet, 4 small shelves (4 `SurfaceSpec`s), bone knobs. Env +1, +1 per displayed curio up to +5. ≤ 1,600 tris |
| `bowl_pet` | Chipped Pet Bowl | free, $25 | 1×1, floor | `pet`, `petFood` | `use` | `pet_fillBowl` ($4 kibble), pet-side eat | Enamel bowl with "GOOD BOI (RIP)" lettering. ≤ 400 tris |
| `bed_pet` | Pet Basket | free, $80 | 1×1, floor | `pet`, `petBed` | `lie` (pet) | pet sleep | Wicker basket with a moth-eaten cushion. ≤ 900 tris |

## 9. All PROPOSED GDD / contract changes (collected; each doc explains its own)

| # | Change | Where | Needed by |
|---|---|---|---|
| P-W1 | `grantLevelUnlock(levelId)` quest/effect so a quest can unlock a level before its `LevelDef.unlock` rule | `src/shared/world.ts`, quests system | L3, L4, L5, L6 |
| P-W2 | **New skills `digging` and `fishing`** (W-027 separately proposes **Charm** for Look Alive; with it the skill bar goes from 6 to 9, so the UI must scroll or group) (SKILL_IDS + GDD §7; same xp table). Digging: graves (L2), tunnels (L6). Fishing: ponds (L2, L4), the Swamp Guide career (L4). The existing "Gardening skill" mention in DESIGN_SURVIVAL_PETS_SAVES §2 is folded into **digging** (foraging uses digging), so there are two new skills, not three | `src/sim/types.ts`, GDD §7 | L2, L4, L6 |
| P-W3 | Water terrain: tiles flagged `water` in `LotState` (impassable, not buildable, renders as a water plane); fishing slots approach from the bank. **L2 does not need it**: its pond is one large object (`pond_murky`), so L2 can be built first without a terrain change | `src/sim/types.ts` LotState, spatial, render | L4 (bayou channels) |
| P-W4 | Floor patterns `gravel`, `mud`, `boardwalk`, `cobble`, `grass_lawn` | `src/shared/styles.ts`, render | L2–L7 |
| P-W5 | New `ANIM_STATES`: `dig`, `fishCast`, `fishWait`, `crouchPet`, `swing`, `row`, `pray` (respectful kneel), `toast` (raise glass). Each has a fallback that already ships | `src/shared/appearance.ts`, characters | L1–L6 |
| P-W6 | New objective kinds `visitLot {lotId|levelId, count}` and `collect {set, count}` (curio/fish sets) | `src/sim/contracts.ts` ObjectiveDef | L1–L7 quests |
| P-W7 | Agent role `stray` / `pet` (the pets system W-013), with trust per (household, stray) | sim contracts | L2, L4 |
| P-W8 | **6th career track Swamp Guide** (fishing skill) | GDD §10 | L4 |
| P-W9 | **Reputation** town stat 0–100 (`unlock.kind 'reputation'`): derived, not stored, from friends, parties, donations and Legendary Parties | GDD new §19 | L5 |
| P-W10 | New aspiration **Old Money (Very Old)** | GDD §12 | L5 |
| P-W11 | Spatial floor −1 (multi-level lots) | spatial, render, saves | L6 |
| P-W12 | Rename "Club Thriller" → **"The Rigor Room"** (avoid a strong association with a famous song/album title) | DESIGN_WORLD_LEVELS §2 | L3 |
| P-W6b | Quest steps with `anyOf` objectives (either objective completes the step) | `src/sim/contracts.ts` QuestStepDef | L4, L5, L6, L7 |
| P-W6c | Objective kinds `lotValue {atLeast}` (read only) and `litRoom` | ObjectiveDef | L5, L6 |
| P-W13 | **Autonomous scavenging trip** when broke and hungry (10:00, ≤ 1/day, back by 17:00) | DESIGN_WORLD_LEVELS §1 travel rule | L2 (scenario F) |
| P-W14 | `LotDef.days?: number[]` weekday opening (library closed Mondays, office weekdays) | `src/shared/world.ts` | L3, L5 |
| P-W15 | Household `groceryCredit` spent before funds on cooking charges (bulk buying) | GDD §5/§6 | L3 |
| P-W16 | Raised rooms (render-only floor offset + pilings + steps) | render, template metadata | L4 |
| P-W17 | `VenueKind` adds `parlor` (funeral parlour) | `src/shared/world.ts` | L5 |
| P-W18 | Rent income line (commissioned Necropolis plots, Mondays, idempotent) | GDD §6 | L7 |
| P-W19 | Underground cool: preservation decay ×0.8 on floor −1 | GDD §4 | L6 |
| P-W20 | New recipe **Fish Supper**; unpowered **cold-store crate** (spoil ×0.75); **pickled snacks** (never spoil) | GDD §5 | L2, L6 |
| P-W21 | Household **pet cap 3** | pets design (W-013) | L2, L4 |
| P-W22 | New carry items `shovel`, `rod`, `bouquet` (CARRY_ITEMS) | `src/shared/appearance.ts` | L2, L3, L6 |
| P-W23 | Gala party variant (8 guests, formal dress, catering) + `phone_throwGala` | GDD §11 | L5 |
| P-W24 | New SFX ids (listed per doc §Music) and an `underground` flag in `AmbienceState` (reverb send) | `src/shared/audioIds.ts`, audio | all |
| P-W25 | Necropolis unlock union (day 30 **or** 2 of 4 level capstones) via P-W1 | world | L7 |

## 10. Proposed rows for `docs/DECISIONS.md`

| Decision | Why | Rejected alternatives & why |
|---|---|---|
| All lots stay 30 × 30 grids; small lots shrink `buildable` | No new spatial or render path; saves and pathfinding already proven at 30 × 30 | Per-lot grid sizes: touches spatial, render camera and snapshot code for no gameplay gain |
| Two new skills (digging, fishing), not three | Digging carries both L2 graves and L6 tunnels; foraging is too small for a skill | Separate "gardening" skill: a third skill bar with one interaction behind it |
| Graveyard digging is **only** in unmarked soft mounds and compost; marked graves can only be honoured | E10+ and tone: zombies dig for grub and lost trinkets, never exhume anyone | Digging any grave: grave-robbing reads as gore/disrespect; rating risk |
| Collectibles are single `item_curio` / `item_fish` defs with data ids | One def each keeps the catalogue small; per-curio models are tiny variants | A def per curio: 25+ catalogue entries that are never bought |
| Travel time formula `15 + 0.06·d`, clamped 15–45, × vehicle multiplier | Matches the framework's range; adjacent lots 20–28 min, far levels hit the cap | Fixed per-level times: odd within a level; real road routing: overkill |
| No on-water pathing in v1; boats are rabbit-hole "tour" interactions | Water terrain is impassable (P-W3); a boat agent on water needs a second nav layer | Free boat steering: big nav/render cost for one level |
| Free food is gated by funds < $12 or no paid food reachable | DESIGN_SURVIVAL_PETS_SAVES §2 rule, made concrete with the cheapest recipe | Always-on free food: autonomy would farm worms instead of cooking and break the BALANCE grocery numbers |
| Séance is comedic, one NPC medium, full-moon only | E10+, fits "Moonstruck" (GDD §2), rare enough to be an event | Player-run séances any night: devalues the event, adds occult tone |
| Rename "Club Thriller" | Trademark/association caution (IP_NOTES §2 spirit) | Keep: low-risk word, but the album association is strong |
| L2 pond is a single large object, not water terrain | L2 is built first; an object reuses placement, slots and render with zero spatial changes | Water terrain for L2: blocks the first level on a spatial/render change only L4 really needs |
| Grave-digging / tunnel finds are keyed to the tile (`(seed, lotId, tileIndex)`), and mound cooldowns persist | Undo/re-dig and reload can never re-roll loot; deterministic | Time-keyed rolls: save-scum and re-dig exploits |
| Bones never come directly from selling or donating; only quests/tasks/collections pay Bones | MONETIZATION §2 (Bones are earned by quests, tasks, achievements) | Bones per donated curio: turns the museum into a Bones farm |
| No GG "instant dig" or similar boosts | MONETIZATION §1: boosts sell convenience, never skip the core loop; a $ dig crew already exists in the sim | A GG dig boost: pay-to-skip the L6 core loop |
| Necropolis blueprints exclude agents, items, money and free text | Privacy (no free-text UGC for under-15), anti-cheat (no item/money smuggling), small size | Full lot snapshots as blueprints: leaks state, trivially exploitable |
| Offline Necropolis grows by seeded "council builds" (1/week) | The level must feel alive without the Phase 4 server | Waiting for online: L7 would be empty offline |
| Club venue Passing gate is hard (refuse entry), with a reputation alternative | Look Alive needs stakes; the alternative keeps players without W-027 unblocked | Soft fee gate only: no reason to care about Passing |
| Lot template layouts validated with the real spatial code before writing them down | Every object in the L1/L2 plans was placed through `checkPlace` / `checkWallItem` / `checkOpening` and every slot path-checked from both sidewalk entries (scratch harness, same checks as `tests/unit/spatial/templates.test.ts`) | Hand-drawn plans only: the starter template needed several fixes in review; drawings drift from code |

## 11. Cross-system hooks (DESIGN_PILLARS.md, W-027..W-034, specs in `docs/systems/**`)

The level docs use these systems where they exist. Each hook degrades cleanly if its system lands later: the level
ships without that hook, and nothing in it is a stub.

| Pillar system | How the levels use it | Levels |
|---|---|---|
| **Salvage & Stash** (W-029) | Digging, junk piles, demolition and fishing junk drop salvage materials (Scrap, Bone, Cloth, Wood, Glass, Wire, Ectoplasm) into the household Stash; each level's loot table lists them | L2, L4, L6, L7 |
| **Crafting** (W-029) | Some new level objects have a crafted recipe (materials) as well as a $ price, marked "craftable" in the object tables | L2, L4, L6 |
| **Look Alive / Passing** (W-027) | Some "living-world" venues gate entry or best interactions on Passing (Country Crypt Club ≥ 60, Rot Row job interviews ≥ 40); a public slip (limb drop, groan) drops Passing | L3, L5 |
| **Vehicles** (W-031) | Travel time multiplier (§3); parking spots `spot_parking` on every community lot's curb; L4 boat tours are a separate rabbit hole | all |
| **Seasons, weather, holidays** (W-034) | Each doc's "seasonal" events hang off the W-034 calendar ids (`autumn`, `halloween`, `winter`, `spring`, `summer`); until it lands, only the moon-phase events run | all |
| **Rot Stages** (W-033) | Some quest steps and venue perks check the stage (e.g. Legendary-stage zombies get the museum's "Living History" tour) | L5, L7 |
| **Quick Build** (W-030) | Templates are authored with the classic room/wall builder; a Quick Build piece set per level (stilts, mansard roof, catacomb arches) is listed under store tie-ins | L4, L5, L6 |

## 12. References (shared)

Real-world references were used for layout logic only. No other game's content is copied. Each doc lists its own
references too.

- Rural cemetery movement & Mount Auburn: https://en.wikipedia.org/wiki/Rural_cemetery ·
  https://www.tclf.org/mount-auburn-cemetery-ma · https://w1.planning.org/greatplaces/spaces/2013/mountauburncemetery.htm
- Groton Cemetery (MA) inventory form: path/avenue widths, sections, entrance receiving tomb:
  https://gpl.org/uploads/pages/img/Documents/GrotonCemeteryFormE.pdf
- Downtown anchors and the evening economy: https://ced.sog.unc.edu/key-elements-of-successful-downtowns/ ·
  https://www.canr.msu.edu/news/parking_meters_and_evening_hours_can_increase_downtown_retail_shopping ·
  https://economicdevelopment.extension.wisc.edu/articles/creative-uses-for-downtown-buildings-in-small-towns/
- Acadian raised houses: https://freepages.rootsweb.com/~acadiancajun/genealogy/chousing.htm ·
  https://chambersarchitects.com/?p=7796 · https://denr.louisiana.gov/assets/TAD/education/ECEP/drafting/a/app-a.htm
- Atchafalaya Basin ecology: https://www.ebsco.com/research-starters/earth-and-atmospheric-sciences/atchafalaya-swamp ·
  https://wise.er.usgs.gov/dp/pdfs/FS-021-02.pdf
- Second Empire architecture: https://www.phmc.state.pa.us/Portal/Communities/Architecture/styles/second-empire.html ·
  https://en.wikipedia.org/wiki/Second_Empire_architecture_in_the_United_States_and_Canada
- Paris Catacombs (quarry-to-ossuary layout): https://en.wikipedia.org/wiki/Catacombs_of_Paris
- Shy/feral adult cat socialisation (trust pacing): https://www.maddiesfund.org/assets/lifesaving-academy/feline-lifesaving/APA!%20Guide%20to%20Socializing%20Adult%20Cats.pdf
- Raccoon activity patterns (after dusk, bins): https://skedaddlewildlife.com/location/baltimore-md/blog/why-raccoons-are-most-active-at-night
