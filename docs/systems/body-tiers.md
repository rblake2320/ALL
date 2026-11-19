# W-041 Body tiers: the free Classic, and an earnable path to every cast body

Status: **implementation-ready spec v1.0** (2026-11-05). Sources: DESIGN_LIVE_WORLD §2 (owner direction),
`src/shared/cast.ts` (25 bodies, `BodyId = 'classic' | CastBodyId`), `src/economy/catalog.ts` (current tiers,
`BODY_UNLOCKS_LIVE = false`), MONETIZATION §1–§3/§8 (Bones, GG band 500–800 for a premium cast body, Starter Pack
with Goldie), `src/sim/contracts.ts` QuestDef/QuestRewardDef (entitlement rewards), D-004 (bodies from Zombie
Smash 2), docs/systems/rot-stages-family.md (stages), housing-progression.md (renovation, HL), contests-newsletter.md
(offline Fair, contests).

## 1. Player fantasy and rule

*"Everyone starts as a Classic: build them your way, every hair and stitch. Then the town notices you. Turn your first
neighbour and the Freshly Turned look is yours. Hit Fitness 8 and the Strongman shows up at your door."*

- **Free from the start: Classic** (the procedural style-driven body). It is the most customisable body in the game
  (hair, top, bottom, shoes, eyes, accessory, stitches, skin tone, build), and it keeps getting free style additions.
  It is simpler, not worse: cast bodies are single sculpted meshes that ignore most of those fields (cast.ts header).
- **Every one of the 25 cast bodies has an earnable path** (a "Cast Call" quest) **and** a Bones price, **and** a Grave
  Gold price for players who'd rather buy. No body is GG-only (conflict X17). Under-15 profiles use the earn path and
  Bones only (no GG, MONETIZATION §1).
- **Townies are never gated.** Townies and NPCs keep drawing from all 25 bodies + Classic (L7 §5), which is how players
  *see* what they can earn.

## 2. Mechanism: quests that grant `body:<id>` entitlements

No new unlock machinery is needed. A **Cast Call** is a one-time neighbourhood quest (`category: 'neighbourhood'`, no
`repeat`) whose `reward.entitlements` holds `body:<id>`. The quests system already emits `questCompleted` with a stable
`grantId`, and the game layer already turns that into an idempotent profile-ledger grant (MONETIZATION §2). The
entitlement id grammar (`ENTITLEMENT_ID_RE`) already accepts `body:<id>`.

- Cast Call ids: `cast_<bodyId>`; icon `sparkle`; reward Bones 25 + the entitlement (the Bones keep the one-premium-
  item-per-45-min pace honest without making bodies a Bones farm).
- A Cast Call is **offered** when its `requires` are met (so the quest log never floods: at most 4 Cast Calls active at
  once, lowest `order` first, the rest wait in a "Casting" tab with their requirements visible).
- **Profile-level outcome:** the entitlement is per profile, so a body earned in one world is available in every world
  (the same as Bones unlocks today). Copying a save cannot farm it (grantId is world-keyed and the ledger dedupes).
- **Fallbacks:** where a path depends on a system that may ship later (housing, W-033 rot stages, W-028 photos,
  W-034 holidays, a level), the table lists a fallback objective using kinds that exist today. The quest content uses
  the primary objective when that system is registered and the fallback otherwise (validated at content load).

## 3. All bodies: tiers, earn paths, prices

Bones bands: starter set 150, common 250, turned 300, uncommon 400, boss 600–800, Goldie 900. GG bands (MONETIZATION
§8 "premium cast body 500–800"): common 500, turned/uncommon 650, boss/Goldie 800. Existing `catalog.ts` Bones values
are kept where they exist.

| # | Body (id) | Category | Cast Call: primary objective (system) | Fallback objective (exists today) | Bones | GG |
|---|---|---|---|---|---|---|
| 0 | **Classic** (`classic`) | procedural | **free at start** | — | — | — |
| 1 | Walker (`walker`) | zombie | requires `story_firstMeal`; `days 1` | same | 150 | 500 |
| 2 | Freshly Turned (`civilian`) | turned | requires `story_makeFriend`; Turn a warm townie (W-033 `stat turnings 1`) | `friends 2` | 150 | 650 |
| 3 | Runner (`runner`) | zombie | `skill fitness 4` | same | 250 | 500 |
| 4 | Jogger (`jogger`) | turned | `interaction tags [exercise] 15` | same | 300 | 650 |
| 5 | Hard Hat (`hardhat`) | zombie | `renovation 2` (housing, C33) | `stat repairs 10` | 250 | 500 |
| 6 | Cone-Head (`cone`) | zombie | `visitLot wormwood:corner_park 3` (P-W6, L1) | `stat townsfolkMet 8` | 250 | 500 |
| 7 | Pickpocket (`thief`) | zombie | `stat graveGoodsFound 5` (L2) | `stat paintingsSold 3` | 250 | 500 |
| 8 | Granny (`granny`) | zombie | `rotStage vintage` (W-033, C33) | `days 42` | 400 | 650 |
| 9 | Bride (`bride`) | zombie | `stat weddingsHeld 1` (W-033) | `interaction ids [social_elope] 1` | 400 | 650 |
| 10 | Nurse (`nurse`) | zombie | `skill mortuary 5` | same | 250 | 500 |
| 11 | Sneezer (`sneezer`) | zombie | requires `story_by_forage` (L4); `days 1` | `interaction tags [plant] 10` | 250 | 500 |
| 12 | Screamer (`screamer`) | zombie | `stat holidaysCelebrated:halloween 1` (W-034) | `stat partiesThrown 3` | 400 | 650 |
| 13 | Clown (`clown`) | zombie | `stat legendaryParties 1` (GDD §11) | same (stat added by the people system) | 400 | 650 |
| 14 | Lid Guard (`shield`) | zombie | requires the L6 capstone story quest; `days 1` | `stat repairs 25` | 400 | 650 |
| 15 | Goldie (`gold`) | zombie | `funds 25000` (read-only) | same | 900 | 800 (also in the Starter Pack) |
| 16 | Big Lug (`boss`) | boss | `householdLevel 10` (housing, C33) | `days 60` | 600 | 800 |
| 17 | Strongman (`strongman`) | boss | `skill fitness 8` | same | 600 | 800 |
| 18 | Ringmaster (`ringmaster`) | boss | requires `story_mh_gala` (L5 capstone); `days 1` | `stat partiesThrown 8` | 700 | 800 |
| 19 | Fortune Teller (`fortune`) | boss | requires `story_gy_seance` (L2); `days 1` | `stat fullMoonsSeen 4` | 600 | 800 |
| 20 | Mascot (`mascot`) | boss | enter 3 contests **or** 3 offline Wormwood Fairs (`stat contestEntries 3`, contests-newsletter.md §8) | `stat partiesThrown 5` | 700 | 800 |
| 21 | Middle Manager (`business`) | turned | `career 3` | same | 300 | 650 |
| 22 | Gamer (`gamer`) | turned | `skill logic 6` | same | 300 | 650 |
| 23 | Delivery Driver (`pizza`) | turned | `interaction ids [phone_orderPizza] 8` (or W-031 gig `stat gigsDone 5`) | same | 300 | 650 |
| 24 | Streamer (`streamer`) | turned | `stat photosTaken 20` (W-028) | `stat townsfolkMet 15` | 300 | 650 |
| 25 | Tourist (`tourist`) | turned | visit 5 levels: steps `visitLot {levelId}` × 5 (P-W6) | `days 30` | 300 | 650 |

- **Pacing:** in a first week a player typically earns Walker, Freshly Turned (or its fallback), Runner and one of
  Hard Hat/Cone-Head/Nurse, i.e. 3–5 bodies, with Bones enough for one more. Bosses are weeks-to-months goals.
- **Changed from `catalog.ts` today:** every body gets both a Bones and a GG price (today 18 are `free`, 6 are `bones`,
  `gold` is `premium` only). `CatalogEntry.tier` stays `bones` for all 25 (so store filters work) with `priceGG` added
  as the alternative (C35). The values in the table are the new `BODY_BONES`/`BODY_PREMIUM` data.

## 4. Turning unlocks on without taking anything away (migration)

Today every body is usable (`BODY_UNLOCKS_LIVE = false`). When CAZ enforcement ships (contract request E3) and the
flag flips:
1. **Grandfather grant:** on first launch of that build, scan every save slot's household appearances (and the CAZ
   "recent bodies" list if present). Each cast body found is granted as `body:<id>` with reason `grandfather` and key
   `grandfather:<profileId>:<bodyId>` (idempotent). Zombies already wearing a body never lose it.
2. A one-time notice: "Cast bodies are now earned through Cast Calls. You keep every body you've already used."
3. Ledger note: the ledger requires a positive `amount`; entitlement-only grants use `currency: 'bones', amount: 1`
   with reason `grandfather` (1 Bone each, harmless), or C35 allows `amount: 0` for entitlement-only grants (lead's
   choice, Q-B2).

## 5. Create-a-Zombie (CAZ) flow

- **Body picker** shows all 26 tiles. Owned: normal. Locked: a lock badge, and the tooltip/side card shows the blurb,
  the Cast Call objective with progress ("Fitness 3 / 4"), the Bones price, and the GG price with its real-money
  equivalent. Buttons: *Try on* (preview in CAZ, any body, any time), *Unlock for N Bones*, *Buy for N GG* (hidden for
  under-15; "Sign in to buy" offline), *Track Cast Call* (pins the quest).
- Trying on a locked body never blocks saving the zombie: *Save* with a locked body selected asks "Keep the Classic for
  now?" and reverts the body field only.
- **Randomise** picks only owned bodies (Classic included).
- Existing zombies (in a world) can change body in the mirror "Change Look" flow (W-027) under the same rules.
- Accessibility: tiles are a keyboard grid; screen reader: "Strongman. Locked. Earn: reach Fitness 8, you have 5.
  Or 600 Bones."

## 6. Data model (C35, C36)

```ts
// src/shared/economy.ts (C35)
export interface EarnPath { questId: string; summary: string /* i18n key */ }
export interface CatalogEntry { /* … */ earn?: EarnPath }
// ledger: allow amount 0 for kind 'grant' when entitlements is non-empty (Q-B2), or keep amount 1

// src/economy/data/bodies.json (data, owned by economy): { bodyId, bones, gg, castCall: 'cast_<id>', starter?: boolean }[]

// src/sim/content/quests/cast.ts (content, owned by quests): 25 QuestDefs `cast_<id>`

// src/game/contracts.ts (C36): CAZ body picker state per body
type BodyLock = { state: 'owned' } | { state: 'locked'; questId: string; progress: number; target: number; bones: number; gg: number | null };
```

New objective kinds used (C33, shared with housing): `renovation {level}`, `householdLevel {level}`, `rotStage
{stage}`; and P-W6 `visitLot`. New stat keys asked of other systems: `turnings`, `weddingsHeld`,
`holidaysCelebrated:<id>`, `legendaryParties`, `fullMoonsSeen`, `contestEntries`, `photosTaken`, `gigsDone`
(each owner adds the counter; until then the fallback objective applies).

## 7. Determinism and balance

- Cast Calls only read sim state and grant profile entitlements; they never change needs, money or RNG. A body has no
  stats (cast.ts), so no body can be "stronger" (parity test).
- BALANCE scenarios: Cast Call quests are additional quests in the quests system. They must not alter the quest offer
  order of existing quests: they live in their own pool with their own cap of 4 active (test 2).

## 8. Acceptance tests

| # | Test |
|---|---|
| 1 | Every `CAST_BODY_IDS` entry has a Cast Call quest, a Bones price and a GG price; no body is GG-only; Classic is free |
| 2 | With Cast Calls registered, BALANCE scenarios A–D produce byte-identical WorldState for the existing quest pool (Cast Calls in a separate pool) |
| 3 | Completing `cast_runner` grants `body:runner` exactly once across reload, replay and a copied save |
| 4 | Fallback selection: with W-033 absent, `cast_granny` uses `days 42`; with it present, `rotStage vintage` |
| 5 | Grandfather scan grants each body found in any slot once; a second launch grants nothing |
| 6 | CAZ: a locked body can be tried on, cannot be saved, Randomise never picks it; under-15 sees no GG button |
| 7 | Store: buying with Bones or GG yields the same entitlement; buying a body you already own is refused |
| 8 | i18n: every Cast Call summary key exists in all shipped locales |

## 9. Open questions for the lead

| Id | Question | Default |
|---|---|---|
| Q-B1 | Classic only at the very start (Walker after the first story quest, ~1 game hour)? | yes |
| Q-B2 | Entitlement-only ledger grants: allow `amount: 0`, or keep `amount: 1` Bone? | `amount: 0` (cleaner) |
| Q-B3 | Every body also sold for GG (store choice), with the Starter Pack keeping Goldie? | yes |
| Q-B4 | Bones prices always available (no weekly rotation; the Featured tab rotates instead)? MONETIZATION §1 says "cast bodies in rotation" | always available, rotation only in Featured (no FOMO) |

## References

- Unlock-by-play vs store is the common pattern in creator/life games (e.g. The Sims 4 base game free with priced packs,
  MONETIZATION §8). Every unlock condition and name here is original. Source art provenance: `src/shared/cast.ts`
  (Zombie Smash 2 @ 9c79c4c) and asset-library.md §5.
