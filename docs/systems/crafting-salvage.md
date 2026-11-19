# W-029 Salvage, Stash and Crafting: the free path to everything

Status: **implementation-ready spec v1.0** (2026-11-05). Sources: DESIGN_PILLARS §B and §E, GDD §5 (cooking quality
formula, reused), §6 (economy, idempotency), §7 (skills), BALANCE.md, MONETIZATION §1, docs/levels/README.md §5
(money scale: hobbies below an L1 wage per hour at skill 0, about L2–L3 at skill 8–10), DESIGN_SURVIVAL_PETS_SAVES
§2–§3 (Thief pets).

## 1. Player fantasy

*"We're broke, but the junk pile out back is a coffee table waiting to happen."* You rummage in dumpsters, sort junk
piles, dig in the graveyard and strip the old sofa for parts. Then you turn the haul into furniture, decor, makeup, pet
gear and even a moped at your own Workbench, Sewing Table and Tinker Bench. Crafting trades **time for money**: it
never beats a job early, but it means a broke household can still furnish a home, and a skilled Tinkerer can make
lovely things.

## 2. Materials

| id | Name | Icon colour | Market buy (L3 Rot Row Market) | Market sell | Stash cap (base) | Notes |
|---|---|---|---|---|---|---|
| `scrap` | Scrap Metal | rust `#a5532f` | $2 | $1 | 100 | the common one |
| `wood` | Salvaged Wood | `#7a5a3e` | $3 | $1 | 100 | |
| `cloth` | Cloth Scraps | `#6b4f8a` | $3 | $1 | 100 | |
| `bone` | Bone | bone `#e8e0c8` | $3 | $1 | 100 | animal/soup bones and old ornaments, never anyone's remains (E10+, levels README §10) |
| `glass` | Glass | cryo `#7fe0ff` 50 % | $4 | $2 | 100 | |
| `wire` | Wire & Springs | `#b0a080` | $4 | $2 | 100 | |
| `ecto` | Ectoplasm | toxic `#9fe870` | $40 (L6 Catacomb Market only) | $20 | 20 | rare; full moons, séances, Ecto Trap |

Prices are integers. Selling rounds down (it is just the table value). Market sell is capped at **60 units per
household per game day** across all materials, so dumping a stash for cash is bounded (≤ $120/day, typically $40–70).

## 3. Free sources (with daily caps)

All yields are integers. Every draw comes from the salvage RNG stream (§8). Every free source counts toward the
**household daily free-material cap of 40 units** (`flags['salvage:free:<day>']`), so salvage stays a supplement,
never a wage. Above the cap, sources still give 1 unit per session as a trickle and show "You've picked the
neighbourhood clean today".

| Source | Where | Interaction | Duration | Yield (units) | Table (weights) | Per-source cap | Side effects |
|---|---|---|---|---|---|---|---|
| Dumpster | `dumpster_alley` (L3 Rot Row alleys, 2 per lot; L1 corner park 1) | `salvage_rummage` | 20 min | 1–3 (+1 at tinkering ≥ 4) | scrap 30, cloth 25, wood 15, glass 15, wire 15 | 3 rummages per dumpster per game day | hygiene −8; *Dumpster Diver* (−3, 2 h) unless Slob |
| Junk pile | `item_junkpile` spawned on the **home lot yard** | `salvage_sortJunk` | 25 min | 3–5 | wood 30, scrap 30, cloth 15, wire 15, glass 10 | the pile is consumed | hygiene −5 |
| Graveyard digging | L2 soft mounds (`grave_digGrub`, owned by the L2 doc) | adds a salvage roll | — | +1 bone (60 %) | bone | per L2 mound cooldown | — |
| Full-moon dig | L2 mounds on full-moon nights 20:00–04:00 | same | — | +1 ecto (8 %) | ecto | 2 ecto per household per full moon | — |
| Séance (L2) | moonlit séance event | event reward | — | 1 ecto (guaranteed once per séance) | ecto | 1/séance | — |
| Thief pet (W-013) | home | pet behaviour | — | 1 per game day | scrap 40, cloth 30, glass 15, wire 15 | 1/pet/day | — |
| **Salvage an object** | any owned object, Buy mode → *Salvage* (instead of *Sell*) | build command `salvage` | instant | crafted recipe objects: 60 % of their recipe materials (floor). Other catalogue objects: `floor(price / 50)` units split by the def's `salvageProfile` (default scrap 40/wood 40/cloth 20) | — | — | **no $ refund**; the object is removed like a sale |
| Ecto Trap | crafted object (§5) | passive | — | 1 ecto per full-moon night (00:00) | ecto | 1/trap, max 2 traps count | — |

**Junk pile spawning (opt-in):** junk piles spawn **only after the household has completed its first craft** in this
world (`crafting.firstCraftTick` set; owning a station alone is not enough). Then one pile appears at 06:00 every second game day,
on a random free outdoor buildable tile ≥ 2 tiles from walls (salvage stream). There are at most 3 on the lot at once.
`item_junkpile` has env 0, does not block (`passable: true`), and is never autonomously cleaned (Clean Up ignores it).
The shipped starter lot has no Workbench, so BALANCE scenarios A–D never spawn a pile (§10).

**Salvage rate check (scale, levels README §5):** at skill 0 a zombie gathers ~5 units per game hour of effort
(dumpster 2/20 min, minus walking). At the market average sell (~$1.3) that is **≈ $7/h**, far below an L1 wage
($15–20/h). Turned into crafted goods (§6) and sold, it is ≈ $10–14/h at tinkering 0 and ≈ $25–35/h at tinkering 8–10,
hard-bounded by the sell caps. This matches the levels doc rule.

## 4. Stash, pockets, trunks

- **Stash** (`HouseholdState.stash`): per-material counts, household-level (not in a lot snapshot), shared by every
  station on the home lot. Base cap 100 per material (ecto 20). Each **Junk Crate** (`crate_junk`, §5) placed on the
  home lot adds +150 per material (ecto +5). At most 4 crates count, so the max is 700 (ecto 40). Gains over the cap
  are refused at the source ("Stash full") and the session still completes. The cap is shown in the HUD.
- **Pockets** (`AgentState.pockets`): **off the home lot**, gathered materials go to the gatherer's pockets (12 units
  in total per zombie). Pockets are emptied into the Stash automatically when the household arrives home (in trip
  order; overflow beyond the Stash cap is sold at market sell value with a toast, so nothing is silently lost).
- **Trunk** (W-031): each vehicle used on a trip adds shared **trip cargo** capacity (bike 10, moped 15, sedan 40,
  hearse 80; +50 % with the Trunk upgrade). When pockets fill, units go to the cargo of a vehicle in the trip. The
  pockets UI shows "Pockets 12/12 · Trunk 23/40".
- On the home lot, gathered units go straight into the Stash.

## 5. Crafting stations

| id | Name | Tier / $ | Footprint | Tags | Slot | Station bonus | Env | Tris | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `bench_work` | Splinter-Proof Workbench | free, $300 | 2×1 floor | `craftStation`, `workbench` | `work` stand (front) | +0 | 0 | ≤ 2,400 | vice, saw, a jar of mismatched screws |
| `table_stitchnmend` (exists, $120) | Stitch-n-Mend Table | — | (shipped) | adds `craftStation`, `sewing` | (shipped `work`) | +0 | (shipped) | (shipped) | gains crafting interactions; limb reattach unchanged |
| `bench_tinker` | Tinker Bench | free, $650 | 2×1 floor | `craftStation`, `tinker` | `work` stand | +0 | 0 | ≤ 2,800 | soldering lamp (`glow` node), oscilloscope with a heartbeat-flatline gag |
| `station_embalming` (exists, $1,600) | Home Embalming Station | — | (shipped) | adds `craftStation`, `chem` | (shipped `work`) | +0 | — | — | gains cosmetic/fuel recipes (no change to embalming) |
| `bench_masterwork` | Masterwork Bench | **bones** 400, $1,400 | 2×1 floor | `craftStation`, `workbench`, `tinker` | `work` stand | **+1 quality** | +1 | ≤ 3,000 | does both Workbench and Tinker recipes (earnable by play) |
| `bench_masterworkGilded` | Gilded Masterwork Bench | premium 500 GG (furniture), $1,400 | same | same | same | +1 (identical to the bones bench) | +1 | ≤ 3,000 | cosmetic skin of the above |
| `crate_junk` | Junk Crate | free, $120 (or crafted) | 1×1 floor | `stash` | — | — | 0 | ≤ 700 | +150 stash cap |

Recipes are listed per station kind: `workbench`, `sewing`, `tinker`, `chem`.

## 6. Crafting rules

- **Interaction** `craft_make` ("Make…", menu children = recipes known and buildable at that station, each showing
  materials as "have/need" and a $ fallback). Behaviour `craft`:
  1. **Stage start:** materials are reserved, then consumed atomically (idempotency key `craft:<runUid>`). If anything
     is missing, the run fails with "Needs 2 more Glass".
  2. **Run:** work progress accrues `minutes × speed`, `speed = 1 + 0.06 × tinkering` (×0.65 with one arm missing;
     two arms missing → cannot craft, GDD §4 rule). Tinkering xp 40/h (creativity 15/h for `sewing` recipes; mortuary
     10/h for `chem`). Fun +4/h, or +8/h for an *Artistic* zombie at `sewing`.
  3. **Interrupt-safe:** progress lives on a **WIP item** `item_wip` (loose on the station surface; `data = {recipeId,
     progressMin, quality?, crafterId, startedTick}`). Any household zombie can **Continue Crafting** it. Materials are
     never refunded, and never charged twice. Selling or salvaging the station drops the WIP item next to it.
  4. **Complete:** the output is spawned: for floor objects, as a **boxed item** `item_crate_boxed` (`data.defId`, `q`)
     placed near the station; the player places it from the household inventory in Buy mode for free. Consumables go
     straight into the wardrobe, fuel stock or stash. The quality roll is made at completion.
- **Quality 1–5** (mirrors GDD §5 cooking): `q = clamp(baseQ + floor(tinkering / 3) − 1 + stationBonus + (Artistic &&
  sewing ? 1 : 0), 1, 5)`. There is no random component, so quality is fully predictable and shown in the menu as
  "Expected quality ★★★".
- **Quality effects** on crafted objects (`ObjectState.data.crafted = true, q`):

| q | Env bonus | breakChance × | Sell multiplier `qm` |
|---|---|---|---|
| 1 | −1 | 1.3 | 0.8 |
| 2 | 0 | 1.15 | 0.9 |
| 3 | 0 | 1.0 | 1.0 |
| 4 | +1 | 0.85 | 1.1 |
| 5 | +1 | 0.7 | 1.2 |

  A crafted object behaves exactly like the catalogue object of the same `defId` in every other respect (same
  interactions and need numbers). **Crafting never makes a stronger need-restorer than buying.**
- **Crafted resale (anti-arbitrage):** `value = min(floor(1.5 × qm × marketCost(recipe)), floor(0.5 × catalogPrice))`.
  Selling uses the normal depreciation path on that value: `value × 0.85`. At most **5 crafted-object sales per
  household per game day** (`flags['craft:sold:<day>']`). Buying materials at market and selling the product makes at
  most `0.8 × marketCost` per item (a profit of ~$11 on a $14 chair, ~$60 on a $76 moped kit after 8+ hours of craft
  time). With the cap that is ≤ ~$60/day: allowed, but below a job.
- **$ fallback ("Buy missing at market price"):** at any station, missing materials can be bought instantly at
  **market buy × 1.25** (convenience premium; on any lot via the household phone "Order Supplies"). This keeps crafting
  usable before L3 unlocks the Market.
- **Recipe unlocks** (`WorldState.crafting.known`): a starter set is known for free; others unlock at a tinkering level
  (automatic, with a toast), through quests (`QuestRewardDef.recipes`), via the **Recipe Book** item (`book_recipes_*`
  $60–200 at the Library/Market, "Study" 60 min), or as store **blueprint cosmetics** (premium recipes only make
  *cosmetic variants* of free recipes).

## 7. Recipe list (v1: 36 recipes)

Columns: materials · base work minutes at tinkering 0 · min tinkering · base quality · catalogue $ (its price if
bought) · `marketCost` (materials at market buy). The time rule of thumb is ≈ 0.6–0.9 game min per catalogue $ for
furniture, so the free path costs real time.

### Workbench (`workbench`)
| Recipe → output | Materials | Min | Tnk | bQ | Catalogue $ | Mkt $ | Unlock |
|---|---|---|---|---|---|---|---|
| Creaky Chair → `chair_creaky` | wood 4, scrap 1 | 40 | 0 | 3 | 60 | 14 | starter |
| Rickety Table → `table_rickety` | wood 5, scrap 1 | 50 | 0 | 3 | 90 | 17 | starter |
| Butcher-Block Counter → `counter_butcher` | wood 6, scrap 2 | 60 | 1 | 3 | 110 | 22 | starter |
| Coffin-Lid Coffee Table → `table_coffinlid` | wood 6, bone 1 | 60 | 1 | 3 | 120 | 21 | starter |
| Salvaged Pew → `pew_salvaged` | wood 8, scrap 1 | 80 | 1 | 3 | 150 | 26 | tnk 1 |
| Decorative Headstone → `headstone_decor` | bone 4, scrap 3 | 60 | 1 | 3 | 120 | 18 | tnk 1 |
| Moldering Bookshelf → `shelf_moldering` | wood 8, cloth 2, scrap 2 | 120 | 2 | 3 | 280 | 34 | tnk 2 |
| Pine Coffin → `coffin_pine` | wood 12, cloth 3, scrap 2 | 180 | 3 | 3 | 300 | 49 | tnk 3 |
| Junk Crate → `crate_junk` | wood 4, scrap 2 | 40 | 0 | 3 | 120 | 16 | starter |
| Bone Wind Chime → `decor_windchime` (new, wall/ceiling-free yard decor, env +1, $80) | bone 3, wire 1 | 30 | 0 | 3 | 80 | 13 | starter |
| Wedding Arch → `arch_wedding` (W-033) | wood 8, cloth 4, wire 2 | 120 | 3 | 3 | 300 | 44 | tnk 3 or quest |
| Lookout Mirror → `mirror_lookout` (W-028) | glass 3, scrap 3 | 60 | 1 | 3 | 180 | 18 | tnk 1 |
| Bike Rack → `rack_bike` (W-031) | scrap 4 | 30 | 0 | 3 | 60 | 8 | starter |
| Jack-o'-Skull (seasonal, W-034) → `decor_jackoskull` | wood 1, cloth 1 (+ a pumpkin in autumn) | 30 | 0 | 3 | 45 | 6 | autumn |

### Sewing (`table_stitchnmend`)
| Recipe → output | Materials | Min | Tnk | bQ | $ | Mkt $ | Unlock |
|---|---|---|---|---|---|---|---|
| Rag Rug → `rug_rag` | cloth 6 | 50 | 0 | 3 | 90 | 18 | starter |
| Mend Clothes (= `look_mendClothes`) | cloth 2 | 30 | 0 | — | ($10 thread) | 6 | starter |
| Homemade Wig → wardrobe wig (free styles) | cloth 4, wire 1 | 90 | 1 | — | 80 | 16 | tnk 1 |
| Patchwork Outfit → wardrobe outfit "Patchwork Pride" | cloth 6 | 60 | 0 | — | 60 | 18 | starter |
| Halloween Costume → wardrobe costume (W-034) | cloth 5, wire 1 | 60 | 0 | — | 60 | 19 | autumn |
| Pet Bandana → pet gear (W-013) | cloth 2 | 20 | 0 | — | 25 | 6 | starter |
| Pet Basket → `bed_pet` | cloth 6, wood 2 | 60 | 1 | 3 | 80 | 24 | tnk 1 |
| Lifelike Prosthetic upgrade (applies to one worn prosthetic: Passing penalty 0, W-027) | wood 2, cloth 2, wire 1 | 45 | 3 | — | ($150 at the L3 Clinic) | 16 | tnk 3 |

### Tinker Bench (`tinker`)
| Recipe → output | Materials | Min | Tnk | bQ | $ | Mkt $ | Unlock |
|---|---|---|---|---|---|---|---|
| Skull Lamp → `lamp_skull` | bone 1, glass 2, wire 2 | 60 | 1 | 3 | 140 | 19 | starter |
| Lantern Post → `lantern_post` | scrap 4, glass 2, wire 2 | 80 | 2 | 3 | 180 | 24 | tnk 2 |
| Fly Zapper → `zapper_fly` | wire 3, glass 1, scrap 1 | 50 | 1 | 3 | 110 | 18 | tnk 1 |
| Boombox → `stereo_boombox` | scrap 3, wire 4, glass 1 | 120 | 3 | 3 | 250 | 26 | tnk 3 |
| Ecto Trap → `trap_ecto` (new, outdoor 1×1, env 0) | glass 4, wire 4, ecto 1 | 180 | 5 | 3 | — (craft only) | 72 | tnk 5 |
| Bone-Shaker Bicycle → vehicle `veh_bike` | scrap 8, wire 2, cloth 1 | 180 | 2 | 3 | 250 | 27 | tnk 2 |
| Rattletrap Moped → `veh_moped` | scrap 18, wire 8, glass 2 | 480 | 4 | 3 | 900 | 76 | tnk 4 |
| Beater Sedan → `veh_sedan` | scrap 40, wire 12, glass 8, cloth 6 | 840 | 6 | 3 | 3,200 | 178 | tnk 6 |
| Family Hearse → `veh_hearse` | scrap 60, wire 20, glass 10, cloth 10, ecto 2 | 1,200 | 8 | 3 | 7,500 | 330 | tnk 8 |
| Engine Tune T1 (vehicle upgrade) | scrap 8, wire 6 | 240 | 4 | — | 400 | 40 | tnk 4 |
| Engine Tune T2 | scrap 14, wire 10, ecto 1 | 360 | 6 | — | 900 | 108 | tnk 6 |
| Engine Tune T3 | scrap 20, wire 14, ecto 3 | 480 | 8 | — | 1,600 | 216 | tnk 8 |
| Tinted Window Film (vehicle upgrade) | glass 4, cloth 2 | 120 | 3 | — | 350 | 22 | tnk 3 |
| Reinforced Chassis (vehicle upgrade) | scrap 16, wire 4 | 240 | 5 | — | 500 | 48 | tnk 5 |

Vehicle crafts above 8 h are worked in several sessions (WIP item). Vehicle quality is fixed at "crafted": crafted
vehicles have the catalogue stats; q affects only resale (§6) and the starting condition `60 + 8 × q`.

### Embalming Station (`chem`)
| Recipe → output | Materials | Min | Skill | $ equiv | Mkt $ | Unlock |
|---|---|---|---|---|---|---|
| Homebrew Face Paint (kitTier 2, 8 uses) | cloth 1, glass 1, bone 1 (+$5 pigments) | 30 | tnk 1 | (Salon $120/10) | 15 | starter |
| Eau de Living (6 uses) | glass 1 (+$5) | 20 | — | 15 | 9 | starter |
| Preservative Spray (1 use, +8 freshness, as the fridge's) | glass 1, bone 1 | 15 | mortuary 2 | 15 | 7 | mortuary 2 |
| Motor-Grade Fluid (fuel, 4 units) | bone 1, glass 1 | 20 | — | 8 | 7 | starter |

**Preservative Spray** is the only crafted freshness item. Its effect equals the shipped $15 spray. It is player-only
(no autonomy picks a crafted spray before a fridge one), so the decay economy is unchanged. It saves money, not need
points.

## 8. Data model (additive)

```ts
// src/sim/types.ts (all optional; lazily created on first write)
export type MaterialId = 'scrap' | 'wood' | 'cloth' | 'bone' | 'glass' | 'wire' | 'ecto';
// HouseholdState gains:
//   stash?: Partial<Record<MaterialId, number>>;      // integers ≥ 0
//   fuelUnits?: number;                                // W-031 fuel stock
// AgentState gains:
//   pockets?: Partial<Record<MaterialId, number>>;     // ≤ 12 total
// WorldState gains:
export interface CraftingState {
  known: string[];                 // recipe ids
  firstCraftTick: number | null;   // junk-pile opt-in (§3)
  junkPiles: { lastSpawnDay: number };
  // RNG: ctx.stream('salvage'); stream states live in WorldState.rngStreams (README §4)
}
//   crafting?: CraftingState;

// src/sim/contracts.ts
export interface MaterialDef { id: MaterialId; name: string; buy: number; sell: number; baseCap: number; icon: BubbleIcon }
export interface CraftRecipeDef {
  id: string; name: string;
  station: 'workbench' | 'sewing' | 'tinker' | 'chem';
  inputs: Partial<Record<MaterialId, number>>;
  extraCost?: number;                 // $ (pigments)
  minutes: number;                    // base work minutes at tinkering 0
  req?: { skill: SkillId; level: number }[];
  baseQuality?: number;               // objects only
  output:
    | { kind: 'object'; defId: ObjectDefId }
    | { kind: 'wardrobe'; itemId: string }
    | { kind: 'consumable'; itemId: string; uses: number }
    | { kind: 'fuel'; units: number }
    | { kind: 'vehicle'; defId: string }
    | { kind: 'vehicleUpgrade'; upgradeId: string }
    | { kind: 'agentUpgrade'; upgradeId: 'lifelikeProsthetic' }
    | { kind: 'service'; effect: EffectRef };     // e.g. mend clothes
  unlock: 'starter' | { skill: SkillId; level: number } | { quest: string } | { book: string } | { season: string } | { entitlement: string };
  cosmeticOf?: string;                 // premium blueprint = cosmetic variant of this recipe id
}
// ContentModule gains: materials?: MaterialDef[]; craftRecipes?: CraftRecipeDef[]
// ContentRegistry gains: materials: Record<MaterialId, MaterialDef>; craftRecipes: Record<string, CraftRecipeDef>
// ObjectDef.params may set: salvageProfile: 'scrap:40,wood:40,cloth:20' (string; parsed by the system)
// BuildCommand gains: | { type: 'salvage'; objectId: ObjectId }      (no $; stash gains; undo within session restores
//                                                                     the object and removes exactly the gained units)
// SkillId gains 'tinkering' (SKILL_IDS + engine SkillDef, xp table = GDD §7). See README "Skills roster".
// Effects: craft_consumeMaterials, craft_produce, salvage_gain {table, min, max}; Requirements: craft_hasMaterials, craft_knowsRecipe
// SimEvent: | { type: 'stash'; delta: Partial<Record<MaterialId, number>>; reason: string }
```

- **Money and materials atomicity:** a material spend and any $ fallback is one transaction with idempotency key
  `craft:<uid>` in `household.txLog` (the existing ring). Undo of a `salvage` build op restores the object under its
  original id and removes the exact units gained, or refuses with "Those materials were already used".
- **Schema:** optional fields, no version bump. The `tinkering` skill needs a migration step: an existing
  `agent.skills` without `tinkering` gets `{level 0, xp 0}`. This must happen in **the engine's skill accessor**
  (missing key reads as 0 and is written on first xp), **not** in repairWorld. That keeps decision #9 (repair is a
  no-op on healthy worlds) and avoids a schema bump.
- **Determinism:** the salvage roll tables use `ctx.stream('salvage')`. Craft quality has no RNG. Junk-pile tile
  selection uses the salvage stream at 06:00 only.

## 9. UI flows

- **Stash HUD chip** (next to funds): a crate icon plus the total. Clicking it opens the **Stash panel**: 7 material
  rows (count / cap, sell button with daily remaining, "Order Supplies" buy button), and a pockets/trunk summary while
  off-lot.
- **Station menu "Make…":** a recipe chooser dialog (not a cramped submenu). Tabs per category (Furniture, Decor,
  Wardrobe, Vehicles, Upgrades, Consumables). Each card has a thumbnail (renderer `thumbnail()`), inputs as chips
  `have/need` (red when short), time at the current skill, expected quality stars, *Make* and *Make (buy missing
  $N)* buttons, and lock reasons ("Tinkering 4"). Keyboard: arrows move between cards, Enter makes, `B` buys missing
  and makes. Screen reader: "Bone Wind Chime. Needs bone 3 of 3, wire 1 of 0. 30 minutes. Quality 3 stars. Missing
  wire."
- **Boxed items:** the Buy mode catalogue gets a **"Household Inventory"** tab (boxed crafted items, placement free).
- **Salvage in Buy mode:** with an object selected, `Delete` = Sell (existing). The new `Shift+Delete` or the
  *Salvage* button shows the material preview "+3 wood +1 scrap (no money)".
- **WIP feedback:** a progress ring over `item_wip`, and a "Continue Crafting" menu entry.

## 10. Balance (BALANCE.md stays valid)

- **No autonomy:** every salvage/craft interaction is `autonomous: false` (player-only), including
  `salvage_sortJunk`. So scenarios A–D gain no autonomy candidates and stay identical.
- **No spawns without opt-in:** junk piles spawn only after the household's first completed craft (§3). No BALANCE
  scenario crafts, so no scenario world ever spawns a pile.
- **Stream isolation:** the salvage stream is never touched in A–D. The worlds are byte-identical (test 8).
- **Money ceilings:** material sell ≤ $120/day, crafted sales ≤ 5/day (≤ ~$60/day of arbitrage), photo sales
  (W-028) ≤ 2/day. The free paths, summed and played optimally, peak at ≈ $200–260/day at skill 8–10 with many hours
  of effort. That is an L2–L3 wage-equivalent, per the levels doc rule. They can only **raise** funds trends (targets
  are lower bounds) and cannot create repo/power-cut events.
- **New scenario `CR`** (harness): B + a Workbench on day 2 + a crafting player (crafts furniture 2 h/day from free
  sources, sells the excess). Targets: unchanged GDD §18 targets plus "funds trend ≥ B". It must also show crafting
  < 25 % of waking time (the existing anti-spam target applies to player-driven runs as well).

## 11. Render needs

- New models (Blender, scripted, ART_DIRECTION): `bench_work` (≤ 2,400), `bench_tinker` (≤ 2,800),
  `bench_masterwork` (≤ 3,000; gilded = `Paint` swap + brass trim variant), `crate_junk` (≤ 700),
  `item_junkpile` (≤ 1,200, 3 seeded variants via node visibility), `dumpster_alley` (≤ 1,800, lid node),
  `item_wip` (≤ 600: a sawhorse with a sheet; per station kind a different prop node), `item_crate_boxed` (≤ 300),
  `decor_windchime` (≤ 600, `flag` node sways), `trap_ecto` (≤ 1,500, `glow` node), `decor_jackoskull` (≤ 800,
  `flame` node).
- Material icons: 7 inline SVG icons (UI). Stash pickups show a `money`-style FX variant `fx: 'materials'` (new
  FxKind) with coloured chips.
- New anim clips: **`saw`** (workbench; fallback `cook`), **`solder`** (tinker; fallback `stitch`), **`rummage`**
  (dumpster/junk; fallback `clean`). `stitch` already exists for sewing.

## 12. Audio needs

New SFX: `sawWood`, `hammerTap`, `solderSizzle`, `sewingMachine` (treadle), `junkRummage` (metal/cloth clatter),
`materialsGain` (soft chime + chip clicks), `craftComplete` (two-note flourish), `dumpsterLid`.

## 13. Store tie-ins (cosmetic only)

- **Blueprints** (premium 150–300 GG or bones): cosmetic variants of free recipes, e.g. *Art-Nouveau Chair* =
  `chair_creaky` stats, a different mesh/paint. `cosmeticOf` links them, and the unit test asserts identical gameplay
  stats.
- The Gilded Masterwork Bench = a skin of the bones Masterwork Bench.
- **No material packs for GG.** Materials are never sold for real money (paid materials would be paid power and
  shortcut the free loop).

## 14. Interplay with levels

| Level | Introduces |
|---|---|
| L1 Wormwood | Workbench + Junk Crate (free), the corner-park dumpster, starter recipes, quest `story_ww_handyCorpse` (craft a chair, 60 Bones) |
| L2 Graveyard | Bone from digging, ecto on full moons and séances, grave goods (owned by L2) |
| L3 Rot Row | Market (buy/sell materials, recipe books), alley dumpsters (2), the Library's Recipe Books, Tinker Bench in the catalogue |
| L4 Bayou | Driftwood (wood ×1.5 at bayou junk piles), cloth from old nets |
| L5 Mausoleum Hills | Masterwork Bench in the high-end catalogue; "Antique Restoration" commissions (a repeatable `n_mh_restore` quest: craft a q ≥ 4 item, pays Bones) |
| L6 Underneath | Ecto buy at the Catacomb Market; tunnel digging yields scrap/bone (owned by L6) |
| L7 Necropolis | Blueprints export crafted builds; a Creator Kit recipe format = `CraftRecipeDef` (Phase 3 packs) |

## 15. Edge cases

- Station sold mid-craft: the WIP item drops next to the station's old spot. Continuing needs any station of that kind.
- Two zombies continue the same WIP: the reservation on `item_wip` lets one at a time work (slot `work` of the station
  plus a WIP reservation). The second fails with "Someone's already working on it".
- Stash at cap with a craft output that is a material (none in v1): refused at queue time.
- A recipe unlocked through an entitlement that is later revoked (refund): already-crafted items stay; the recipe is
  hidden again.
- Crafted vehicle when the household already has the max vehicles (4, W-031): the craft is refused at queue time.
- Corrupt stash (negative, NaN, unknown material keys): engine accessor clamps to 0 and ignores unknown keys; repair
  warns once.
- Undo of `salvage` after the gained materials were spent: undo refused with a reason, history kept (BuildService
  "world diverged" rule: revert + clear history).
- Travel while a zombie is crafting: the run is interrupted (graceful). The WIP stays on the home lot.

## 16. Acceptance tests

1. Every recipe's inputs and outputs reference registered ids (`validateContent`). Every cosmetic recipe matches its
   base recipe's stats.
2. **Anti-arbitrage property:** for every recipe and q ∈ 1..5, `resale × 0.85 − marketCost × 1.0 ≤ 0.8 × marketCost`.
   Selling is capped at 5/day. Exhaustive check.
3. Atomicity: kill a craft at every phase (route/wait/run/exit). Materials are consumed exactly once, WIP progress is
   kept, and save/load mid-run continues exactly.
4. Determinism: a 3-day crafting run versus save → load at random ticks → continue gives byte-identical state.
   Journal replay (W-004) of crafting commands is byte-identical.
5. **Isolation:** BALANCE scenario A seeds 11/22/33 for 3 days, with and without the salvage system registered, give
   byte-identical state.
6. Caps: free-material cap 40/day, market sell 60/day, crafted sales 5/day. The cap resets at midnight and a save at
   23:59 → load → midnight resets once.
7. Pockets → stash on arrival home, including overflow auto-sell. Trunk cargo with 2 vehicles. Catch-up does not
   duplicate the transfer (idempotent arrival key `arrive:<tripId>`).
8. Fuzz: 10,000 random build/craft/salvage/undo commands. Invariants: stash ≥ 0, ≤ cap; funds ≥ 0; no orphan WIP
   items; no NaN.
9. Perf: the recipe chooser with 36 recipes and thumbnails opens in < 100 ms (cached thumbs). The stash accessor costs
   O(1).

## References

- Valheim and Minecraft-style survival-craft loops (gather → station → recipe tiers unlocked by progression) are the
  generic mechanic adopted. Recipes, materials and stations here are original.
- The cooking quality formula from GDD §5 is reused for crafting quality, so one rule set covers both.
- MONETIZATION §1 (unlocks are entitlements; in-world items still cost $; no paid power) is why materials are never
  sold for GG.
