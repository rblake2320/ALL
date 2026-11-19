# W-046 A world that grows: lot → neighbourhood → town → city → region → country

Status: **implementation-ready spec v1.0** (2026-11-05). Sources: DESIGN_LIVE_WORLD §7 (owner direction),
DESIGN_WORLD_LEVELS §1 (one simulated lot at a time, snapshots, closed-form catch-up, ≤ 2 MB per world),
`src/shared/world.ts` (LevelDef, LotDef, TownState), docs/levels/README.md §3 (one 1000 × 1000 map plane, travel
formula `15 + 0.06·d` clamped 15–45 × vehicleMult), L7 (blueprints, council builds, 48 plots, ≤ 150 townies, online
plots), vehicles.md §3 (vehicleMult), seasons-weather-holidays.md (calendar, weather hash), MONETIZATION §5 (content
packs, signatures) and §8 (expansions at direct prices), housing-progression.md (HL), body-tiers.md.

## 1. Player fantasy

*"We started on Mildew Lane. Now the Necropolis has 30 houses, half of them built from our blueprints, and the
Ghost Train runs to Murkmoor City, where the night market is. Next season the Hollowlands open: swamp towns,
mountain crypts, a whole new state."*

The world grows in three ways at once: **you** unlock farther places by playing, **your town** grows from blueprints
and council builds (offline), and **the shared world** gets new towns and regions as live updates (online and free
packs) and as priced expansions.

## 2. The hierarchy

| Tier | What it is | In data | Map | Simulated? |
|---|---|---|---|---|
| **Lot** | one 30 × 30 grid (levels README §2) | `LotDef` | pin on a neighbourhood map | the active lot only |
| **Neighbourhood** | a level: lots + townies + venues + quests + art + music | `LevelDef` (exists) | tab on the town map | its lots as snapshots |
| **Town** | 1–8 neighbourhoods sharing one 1000 × 1000 map plane, one townie roster, one council | `TownDef` (new) | the **Town Map** (today's Neighbourhood Map) | snapshots; roster |
| **City** | 2–6 towns linked by transit | `CityDef` | **City Map**: towns as nodes, rail/road links | nothing below town is loaded |
| **Region / State** | 2–5 cities with a shared climate and theme | `RegionDef` | **Region Map** | nothing |
| **Country** | regions + the national calendar and events | `CountryDef` | **Country Map** (the "atlas") | nothing |

Launch geography (original names):

| Country | Region | City | Town | Neighbourhoods (levels) |
|---|---|---|---|---|
| **Duskland** | **The Gloaming** (temperate; seasons per W-034) | **Wormwood** | **Wormwood Heights** (`wormwood_town`) | L1 Wormwood Heights, L2 Old Graveyard, L3 Downtown Rot Row, L4 Swampside Bayou, L5 Mausoleum Hills, L6 The Underneath |
| | | | **The Necropolis** (`necropolis_town`) | L7 The Necropolis (growing, 48 plots) |
| | | **Murkmoor City** (expansion 1, §7) | 3 towns: Old Quarter, Canal Ward, Lantern Market | 2–3 neighbourhoods each |
| | **The Hollowlands** (cold, foggy; snow ×1.5) | 2 cities (later) | … | … |

So L1–L6 are neighbourhoods of the first town, and **L7 is the first town that grows** (DESIGN_LIVE_WORLD §7: "L7
Necropolis is the first shared town"). This keeps every level doc valid unchanged.

## 3. Unlocks

| Tier | Unlock rule (first matching) | Reason |
|---|---|---|
| Neighbourhood | `LevelDef.unlock` + quest early-unlock (P-W1), unchanged | levels docs |
| Town: Necropolis | day 30 **or** 2 of 4 level capstones (P-W25), unchanged | L7 |
| City: Murkmoor | **HL 10** and either (own a home at renovation ≥ 4) or (Necropolis has ≥ 12 occupied plots) | standing + a town that grew |
| Region: Hollowlands | **HL 18** and 2 cities' capstone quests | late game |
| Country atlas | always visible (locked tiers shown greyed with their rules) | goals on the horizon |

- Unlocks are per **world** (sim state), never purchasable. A priced expansion (§7) adds the *content*; inside it, the
  same play unlocks apply. No unlock can be skipped with GG.
- Each new tier introduces at least one **new system flavour** (city: transit, apartments with neighbours, a night
  market; Hollowlands: cold-weather survival via W-034 multipliers, mountain crypts), so growth is new play, not
  just more pins.

## 4. Travel between tiers

| Trip | Time (game) | Mode |
|---|---|---|
| lot ↔ lot in a town | `clamp(round(15 + 0.06 d), 15, 45) × vehicleMult` (unchanged) | carpool, own vehicle, walk |
| town ↔ town (same city) | `60 + 0.5 × linkKm` minutes × modeMult; Wormwood ↔ Necropolis = 60 min | **Ghost Train** (transit, $8/person, 06:00–01:00, every 30 min) or own vehicle (vehicleMult) |
| city ↔ city | 3–6 game hours | train ($25/person) or own car/hearse (×1.0, fuel ×3) |
| region ↔ region | 8–12 game hours (an overnight trip) | night train ($60/person, sleeper: Rest restores as in a pine coffin) |

- Transit is a rabbit hole like the carpool (no on-map pathing). Arrival is a lot in the destination town (its
  station lot, or the household's own lot there).
- The trip uses the existing `TownState.trip` (+ C16 `groups`/`tripId`) with `to` = a lot id in another town. The
  whole household travels (DESIGN_WORLD_LEVELS v1 rule); workers at work stay at work and are carpooled home to the
  home town after their shift.
- **Home town:** the household lives in one town. Its home lot keeps its snapshot; projects keep their timers
  (housing §8). Moving house across towns uses the housing §9 flow with travel time added.
- **Jobs:** careers are tied to a workplace town; working in another town is allowed if one-way travel ≤ 90 min
  (the carpool picks up earlier).

## 5. Shared vs personal

| Layer | Who sees it | Where it comes from | Authority |
|---|---|---|---|
| **Personal** (offline, default) | your save only | shipped content + your actions + seeded **council builds** (L7 §4.2) | your sim |
| **Shared-content** (online or packs, free) | everyone | signed content packs (MONETIZATION §5): new neighbourhoods/towns, seasonal dressing, curated community blueprints for council builds | first-party signature |
| **Shared-town plots** (online) | each player's copy of a town | the server fills reserved plots with other players' published blueprints (L7 §4.4) + seeded townie households | server picks; your sim simulates them as townies |

No live multiplayer: a "shared town" is a town whose *buildings* come from other players, lived in by local townies
(L7 §4.4). Visiting a friend's actual household is social.md §4.1.

**Town growth rule (generalised from L7):** every growing town has rings of plots; when 5/6 of the available plots
are occupied, the next ring opens; the council builds 1 blueprint per game week (offline) until 75 % of plots are
filled; the last 25 % are reserved for the player and online plots. Townie cap per town 150 (L7), oldest council
households move away beyond it (deterministic).

## 6. Data model (additive; C44, C45)

```ts
// src/shared/world.ts
export type TownId = string;     // 'wormwood_town', 'necropolis_town', 'murkmoor_oldquarter'
export type CityId = string; export type RegionId = string; export type CountryId = string;

export interface TownDef {
  id: TownId; name: string; cityId: CityId;
  levels: LevelId[];                    // neighbourhoods on this town's map (one 1000 × 1000 plane)
  station?: string;                     // transit lot id (LotDef.id)
  growth?: { rings: number[]; reserveShare: number; councilPerWeek: number; townieCap: number };
  unlock: { kind: 'none' | 'day' | 'quest' | 'hl' | 'compound'; value?: number | string; all?: Unlock[]; any?: Unlock[] };
  climate?: string;                     // W-034 climate profile id (defaults to the region's)
  pack?: string;                        // content pack id that provides it ('base' for shipped)
}
export interface CityDef { id: CityId; name: string; regionId: RegionId; towns: TownId[]; links: { a: TownId; b: TownId; km: number; modes: ('train' | 'road')[] }[]; unlock: TownDef['unlock'] }
export interface RegionDef { id: RegionId; name: string; countryId: CountryId; cities: CityId[]; climate: string; unlock: TownDef['unlock'] }
export interface CountryDef { id: CountryId; name: string; regions: RegionId[] }

// LevelDef gains: townId?: TownId  (missing = 'wormwood_town' for L1–L6, 'necropolis_town' for L7)

// C45 — LevelId opens for packs: shipped ids stay the literal union; packs use a namespaced form
export type BuiltinLevelId = (typeof LEVEL_IDS)[number];
export type LevelId = BuiltinLevelId | `${string}:${string}`;   // '<packId>:<slug>', validated by the pack loader

// src/sim/types.ts WorldState (optional)
geo?: {
  homeTownId: TownId; activeTownId: TownId;
  unlockedTowns: TownId[]; unlockedCities: CityId[]; unlockedRegions: RegionId[];
  towns: Record<TownId, {                // inactive towns only; the active town lives in WorldState.town (unchanged)
    town: TownState;                     // its snapshots/unlocked levels as of the last visit
    compacted?: { savedTick: number; council: { plotId: string; blueprintId: string }[] };
  }>;
};
```

- **Migration:** a world without `geo` is `{ homeTownId: 'wormwood_town', activeTownId: 'wormwood_town',
  unlockedTowns: ['wormwood_town'], … }` read lazily (no write, no repair warning). L7 entry moves the Wormwood
  `TownState` into `geo.towns['wormwood_town']` and makes Necropolis active, at a tick boundary.
- **Catch-up across towns:** the same closed form per lot snapshot (DESIGN_WORLD_LEVELS §1), applied when a town is
  re-entered; council builds for the elapsed weeks are applied in week order (seeded from `(worldSeed, townId, week)`).

### 6.1 Save size (conflict X19)
DESIGN_WORLD_LEVELS sets ≤ 2 MB per world. With several towns that needs a rule:
- **Active town** ≤ 2 MB (the existing budget, unchanged).
- **Inactive towns are compacted** after 14 game days away: lot snapshots that are byte-equal to their template +
  catch-up are dropped (rebuilt on entry, deterministic); council plots keep only `{plotId, blueprintId}`; townie
  records keep relationships with the household only. Target ≤ 150 KB per inactive town.
- **Whole world ≤ 4 MB** uncompressed (saves are gzip'd by PLATFORM; ~1 MB on disk). Proposed as a change to
  DESIGN_WORLD_LEVELS §1 (Q-W1).

## 7. Content cadence

| Drop | Contents | Price model (MONETIZATION §8) | Cadence |
|---|---|---|---|
| **Neighbourhood update** | 1 new neighbourhood in an existing town: 3–6 lots, 1–2 venues, quests, a Cast Call or two, music | **free** (shared-content pack) | every ~8 weeks, aligned with Season Lease |
| **Seasonal dressing** | W-034 holiday dressing, event lots for live events (contests-newsletter.md §10) | free | per event |
| **Council blueprint drop** | 12 curated community blueprints (from contest winners, with creator credit and consent) for council builds in every growing town | free | monthly |
| **City expansion** | a new city (2–3 towns, 6–9 neighbourhoods), a career, a system flavour | priced expansion ($39.99) or game pack ($19.99), Steam DLC | ~1 per year |
| **Region** | a new region (climate, 2 cities over time) | expansion | ~1 per 18 months |

Fairness: towns built from player blueprints and the growing Necropolis are always free; a priced expansion is new
content, never a faster path through content the player already has.

## 8. UI

- **Atlas** (main menu and phone → Map → zoom out): Country → Region → City → Town → Neighbourhood → Lot, pinch/scroll
  or `+`/`−`, breadcrumb at the top, locked tiers greyed with their unlock rule and progress.
- **Trip planner:** destination, mode (with times and costs), who goes, ETA as a game time; warnings for shifts and
  opening hours.
- **Town panel:** occupancy rings, council's next build day, townie count, "Your blueprints in this town".
- Keyboard: arrow keys move between nodes, `Enter` zooms in, `Backspace` zooms out; screen reader: "Murkmoor City,
  locked: household level 10 needed, you are 7."

## 9. Acceptance tests

| # | Test |
|---|---|
| 1 | Old saves (no `geo`) load with 0 repair warnings and byte-identical WorldState until L7 is entered |
| 2 | Town round trip Wormwood → Necropolis → Wormwood equals a reference run; save/load mid-train trip |
| 3 | Compaction: compact + re-enter produces the same lot state as never compacting (for template-equal lots) |
| 4 | Council builds over N elapsed weeks applied once on re-entry (idempotent), in week order |
| 5 | Pack-namespaced `LevelId`s validate; a pack level referring to an unknown town is rejected whole |
| 6 | World with 3 towns visited and 48 Necropolis plots: ≤ 4 MB uncompressed, active town ≤ 2 MB |
| 7 | Unlock rules: none purchasable (catalogue test); compound rules evaluate correctly |

## 10. Open questions for the lead

| Id | Question | Default |
|---|---|---|
| Q-W1 | Raise the save budget to ≤ 4 MB per world with ≤ 2 MB for the active town + compaction? | yes |
| Q-W2 | L1–L6 = one town (Wormwood Heights), L7 = the second town? | yes |
| Q-W3 | `LevelId` opens to `'<pack>:<slug>'` for packs (C45)? | yes |
| Q-W4 | City/region names (Duskland, The Gloaming, Murkmoor, Hollowlands) OK after an IP check? | yes, pending IP_NOTES review |

## References

- Neighbourhood/town structure and travel are original; real-world references for town structure are in the levels
  README §12 (downtown anchors, rural cemetery planning). Growth by player blueprints follows L7. No other game's maps
  or names are used.
