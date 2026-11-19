# W-042 Housing progression: home classes, limits, renovation levels, projects and build timers

Status: **implementation-ready spec v1.0** (2026-11-05). Sources: DESIGN_LIVE_WORLD §3 (owner direction), GDD §6
(bills `40 + 0.005·lotValue + 10·n`, idempotent charges), §9 (household cap 8, `social_moveIn`), §15 (build rules,
instant build with exact undo), MONETIZATION §1/§8 (boosts sell convenience; GG price bands), DECISIONS D-012
(per-system RNG streams), D-017 (+1 household slot = a saved-world slot), D-019 (new systems ON for new games, OFF
for old saves), docs/levels/** (lot prices and unlocks), docs/systems/quick-build.md (storeys −1…2, C25
`buildRules.maxStorey`), crafting-salvage.md (materials, Stash, $ fallback ×1.25, tinkering), vehicles.md §6
(install times).

## 1. Player fantasy

*"We started in a mouldy fixer-upper with four coffins and a leaky roof. Three renovations later it has a second
storey, a guest wing, and the crew finished the porch while Mort pitched in. Next stop: a stilt house on the bayou,
then one day a mansion on the hill."*

Two progressions run side by side:
1. **Home level:** every home has a renovation level 1–10. Each level raises the home's limits: objects, rooms,
   storeys, household size. Each home *class* tops out at its own maximum level, so the starter home can be loved and
   improved, but the very top needs a bigger home.
2. **Household level (HL):** your household's standing in town, earned only by playing (skills, careers, quests,
   rot stages, finished projects, days lived). Renovations ask for a minimum HL, so money alone never skips
   progression, and real money never touches either.

Projects (renovations and extensions) take **game time** on a visible build timer, with a crew on the lot, scaffolding
and hammering. Zombies can pitch in, friends can lend a hand, coffee helps, and the clock can be nudged but never
skipped past a floor that is the same for every player.

## 2. Core rule: building stays instant, limits grow through projects

The classic Build/Buy tools and Quick Build stay **instant with exact undo** (GDD §15, quick-build.md §6). They are
the sandbox pillar and the undo contract depends on it. What takes time is anything that **raises a limit or adds a
structural feature**:

| Instant (unchanged) | Timed project (this spec) |
|---|---|
| Walls, rooms, floors, paint, doors, windows, objects, Quick Build pieces, *within the home's current limits* | Renovation level up (raises every limit) |
| Moving, selling, salvaging objects | Extensions: Room Addition, Porch, New Storey, Guest Wing, Basement Dig-Out, Grand Hall |
| Paint/decals on vehicles (vehicles.md §6) | Optional "shop jobs" for functional vehicle upgrades (§6.6) |
| Crafting at a station (zombie work, crafting-salvage.md) | Commissioned Necropolis blueprint builds (L7 §4.1, §11 here) |

So the owner's examples map exactly: a **Room Addition takes 2 h**, a **New Storey 12 h**, a **Guest Wing extension
1 game day** (§6.1). This resolves conflict X15 (README).

**Where the limits bite.** When an instant build command would exceed a limit, BuildService refuses it with a typed
reason (`limit:objects`, `limit:rooms`, `limit:storey`, `limit:basement`) and the UI offers the project that lifts it
("Object limit reached (90/90). Renovate to Lv 2 for +12, or add a Porch for +10"). Household limits refuse
`social_moveIn`, the W-033 Turning "move in" outcome and adding members (with the same kind of explanation).

**Opt-in for old saves (D-019 pattern).** `SimSettings.housing` (C32) is ON for new games and OFF for existing
saves. With it OFF, nothing in this spec runs: no limits, no projects, no HL. Players can turn it on in Settings →
Gameplay; at that moment the home's renovation level is initialised to the **lowest level whose limits fit the lot
as it is** (min 1, capped at the class maximum), and anything still over a limit is **grandfathered** (kept, never
evicted; it only blocks adding more of that kind). BALANCE harness scenarios run with `housing` OFF and stay
byte-identical (§13 test 1). A new scenario **H** runs with it ON.

## 3. Home classes and lot table

Every residential `LotDef` gets a class (C31 `LotDef.homeClass?`; a residential lot without one is `cottage`).

| Class | Max renovation | Lots (level doc) | Price | Unlock (from level docs, unchanged) | Character |
|---|---|---|---|---|---|
| `starter` | **Lv 6** | `wormwood:starter` Fixer-Upper (L1) | **free start** (worth $19,500; New Game net-worth rule $26,000, L1 §2) | start | The free home. Good, not lesser: just small. |
| `cottage` | Lv 8 | `wormwood:bungalow` $16,500 · `wormwood:townhouse` $22,000 (L1) | as listed | none | Room to grow; the townhouse is tall (storeys sooner) |
| `apartment` | **Lv 5** | `rotrow:walkup_2a` $12,000 · `rotrow:loft` $16,000 (L3) | as listed | day 3 or quest (L3) | Central, cheap, small: no upper storeys, no basement, no yard extensions |
| `stilt` | Lv 8 | `bayou:shotgun` $13,000 · `bayou:fishcamp` $15,000 · `bayou:acadian` $17,000 (L4) | as listed | $15k funds or quest (L4) | Living storey is storey 1 over posts (quick-build.md §12); never a basement ("the water table says no") |
| `mansion` | **Lv 10** | `mausoleum:mansard_manor` $68,000 · `ravenspire` $82,000 · `glass_mausoleum` $95,000 (L5) | as listed | reputation / $60k (L5) | The top tier: the only class that reaches Lv 10 with every extension |
| `plot` | Lv 10 | `wormwood:empty` $4,000 (L1) · `necropolis:plot_*` $3,000 + 500 × ring (L7) | as listed | none / L7 rule | Build-it-yourself: low furnished value, high ceiling, every room is yours to make |

Prices, unlocks and template contents are owned by the level docs and are not changed here. The owner's example order
("Bayou stilt house → Rot Row apartment → Mausoleum mansion") is about *size*, and this table orders by size; by price
and unlock the apartments come first (conflict X14).

### 3.1 Limits per class (Lv 1 → class max)

| Class | Objects | Rooms (indoor) | Household | Storeys allowed (via New Storey extension, §6.1) | Basement (−1) | Extension slots |
|---|---|---|---|---|---|---|
| `starter` | 90 → 150 | 6 → 9 | 4 → 6 | 0 → 1 (storey 1 needs Lv 4) | Lv 5 + L6 unlocked | 3 |
| `cottage` | 100 → 170 | 6 → 11 | 4 → 6 | 0 → 1 (Lv 3), → 2 townhouse only (Lv 7) | Lv 4 + L6 | 4 |
| `apartment` | 60 → 100 | 4 → 6 | 3 → 4 (walk-up) · 4 → 5 (loft) | 0 only (`buildRules.maxStorey 0`, C25) | never | 1 (Room Addition only) |
| `stilt` | 100 → 170 | 5 → 10 | 4 → 6 | 1 (from Lv 1) → 2 acadian only (Lv 6) | never | 3 |
| `mansion` | 180 → 240 (+80 in the basement) | 12 → 20 | 6 → **8** | 1 (Lv 1) → 2 (Lv 5) | Lv 3 + L6 | 6 |
| `plot` | 100 → 240 (+80 basement) | 8 → 16 | 4 → **8** | 0 → 1 (Lv 3) → 2 (Lv 6) | Lv 4 + L6 | 6 |

- **Interpolation (all numeric limits):** `limit(lv) = L1 + floor((Lmax − L1) × (lv − 1) / (maxLv − 1))`.
  Extensions then add their bonus on top (§6.1), and nothing ever exceeds the hard caps: household **8** (GDD §9),
  objects **240** above ground + **80** in the basement (L7 blueprint budget, levels README §7 snapshot ≤ 200 KB).
- **What counts.** Objects: placed `ObjectState`s that are not `item_*` (meals, dishes, limbs, curios, fish), not
  openings (doors/windows/gates) and not lot-service objects (mailbox, template-locked dressing). Wall items count.
  Rooms: indoor rooms from `SpatialAPI` room info, all storeys. Storeys: the highest storey index that holds any
  wall/floor/piece. Household: members with presence other than `gone`/`crumbled`.
- **Sanity check against shipped templates:** the Fixer-Upper ships with ~45 objects and 6 indoor rooms (fits Lv 1
  with room to spare), the bungalow has 42 objects / 5 rooms, the townhouse 45 / 4, the walk-up 30, the loft 32. Every
  level-doc template fits its class's Lv 1 limits (acceptance test 3).

Worked tables (the implementation derives them from the formula; these are the test vectors):

| Starter Lv | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Objects | 90 | 102 | 114 | 126 | 138 | 150 |
| Rooms | 6 | 6 | 7 | 7 | 8 | 9 |
| Household | 4 | 4 | 4 | 5 | 5 | 6 |

| Mansion Lv | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Objects | 180 | 186 | 193 | 200 | 206 | 213 | 220 | 226 | 233 | 240 |
| Rooms | 12 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 |
| Household | 6 | 6 | 6 | 6 | 6 | 7 | 7 | 7 | 7 | 8 |

## 4. Household level (HL)

A household-wide number 1–30, shown next to the household name ("The Graves · HL 7").

- **XP to reach level n:** `xpFor(n) = 50 × n × (n − 1)` (HL 2 = 100, HL 5 = 1,000, HL 10 = 4,500, HL 15 = 10,500,
  HL 18 = 15,300, HL 30 = 43,500).
- **Sources** (deterministic, computed by the `housing` system from SimEvents; no RNG):

| Source | HL xp | Cap |
|---|---|---|
| `skillUp` of a household member | 10 × new level | — |
| `promotion` | 40 × new level | — |
| `questCompleted` story / neighbourhood | 60 / 15 | neighbourhood ≤ 3 per game day |
| aspiration `milestone` | 30 | — |
| Legendary Party (GDD §11) | 25 | 1 per game day |
| rot stage reached (W-033): Seasoned / Vintage / Legendary | 30 / 60 / 120 | per zombie, once |
| project completed (§6) | 2 × size points | — |
| a new game day begins with ≥ 1 household member on the home lot or at work | 5 | 1 per day |

- **Pacing check** (reasonable-player BALANCE profile B, 3 zombies, 21 days): ~400 from skills, ~200 promotions,
  ~360 story quests, ~120 neighbourhood quests, ~90 milestones, ~105 days, ~8 projects ≈ **1,280 xp → HL 5 by day
  21**, HL 8 around day 50, HL 18 is a months-long goal. To validate in scenario H (§13).
- **Never purchasable.** No SKU, boost or subscription grants HL xp. (The MONETIZATION §1 "career XP ×1.25" boost
  speeds promotions slightly and therefore HL indirectly. That is accepted as an "edge, not a lock": it cannot raise
  the per-level requirement or skip a project. Flagged as Q-H4.)
- HL is household state, so it survives moving house (§9).

## 5. Renovation levels

Starting a renovation to level n needs: the home below its class maximum, **HL ≥ req(n)**, household **funds ≥
cost**, and the **materials** in the Stash (or bought with the crafting $ fallback at market buy × 1.25,
crafting-salvage.md §6).

**Story hook (W-113, docs/systems/story-start.md §4):** in a world on the Act 1 story arc (`flags.storyArc = 'act1'`,
the derelict start) Renovation **Lv 2** is first offered once the arc's finale `act1_lease` is complete ("the shack is
legally yours"); in classic worlds once `story_bills` is. The HL / funds / materials rules above still apply.

| Target Lv | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|
| HL required | 2 | 3 | 4 | 6 | 8 | 10 | 12 | 15 | 18 |
| Base $ | 400 | 700 | 1,100 | 1,600 | 2,300 | 3,200 | 4,400 | 6,000 | 8,000 |
| Materials | wood 10, scrap 5 | wood 15, scrap 10, cloth 5 | wood 20, scrap 15, glass 5 | wood 25, scrap 20, glass 10, wire 5 | wood 30, scrap 25, glass 15, wire 10, bone 5 | wood 35, scrap 30, glass 20, wire 15, bone 10 | wood 40, scrap 35, glass 25, wire 20, bone 15 | wood 45, scrap 40, glass 30, wire 25, bone 20, ecto 2 | wood 50, scrap 45, glass 35, wire 30, bone 25, ecto 4 |
| Size points S | 2 | 4 | 6 | 9 | 12 | 18 | 24 | 30 | 36 |
| Base duration (= 2 h × S) | 4 h | 8 h | 12 h | 18 h | 24 h | 36 h | 48 h | 60 h | 72 h |

- **Class multipliers** — cost: starter 1.0, cottage 1.1, apartment 0.8, stilt 1.0, mansion 2.5, plot 1.2;
  duration: apartment 0.75, mansion 1.5, others 1.0. Costs round to the nearest $10.
- **Totals:** starter to Lv 6 = **$6,100**; cottage to Lv 8 = $15,180; mansion to Lv 10 = **$69,250**. With the BALANCE
  money trend (+$16 … +$86/day after day 7 at L1–L2 wages, much more at L4–L5) the starter's Lv 2 lands in week 2 and
  Lv 6 around day 50–60, which is where HL 8 lands too: money and standing arrive together on purpose.
- **Materials pacing:** Lv 10 needs 230 units. The free salvage cap is 40 units/day (crafting-salvage.md §3), so a free
  path is ~6 days of salvaging, or $ at market × 1.25 (~$650 for Lv 10's commons; ecto from the L6 Catacomb Market at
  $50 by phone). Ecto (Lv 9–10) is also a full-moon free source.
- **Lot value:** each completed renovation adds **50 % of its $ cost** to `lotValue()`, so bills rise a little
  (starter Lv 6: +$3,050 value → +$15 per bill) and resale reflects the work (§9).
- **Effects on completion:** the limits recompute; a toast, `fx: 'confetti'` (reduceMotion: a static banner), the
  `projectDone` sfx, moodlet *Fresh Paint Smell* (+6, 24 h) on household members on the lot; render swaps the house's
  **curb-appeal set dressing** for that level band (Lv 1–3 / 4–6 / 7–10: fresher siding tint, fixed shutters, porch
  lights; cosmetic only).

## 6. Projects

### 6.1 Extensions

| Extension | Classes (max per home) | Requires | $ (× class cost mult) | Materials | S | Base duration | Effect |
|---|---|---|---|---|---|---|---|
| **Room Addition** | all (2) | Lv 2 | 250 | wood 6, scrap 2 | 1 | **2 h** | +1 room |
| **Porch** | starter, cottage, stilt, mansion, plot (1) | Lv 2 | 400 | wood 12, scrap 4 | 3 | 6 h | +10 objects (outdoor only) |
| **Balcony** | cottage, stilt, mansion, plot (1) | storey ≥ 1 built | 600 | wood 10, scrap 8, wire 4 | 4 | 8 h | +6 objects (storey ≥ 1 only) |
| **New Storey** | per §3.1 storey column (1 per allowed storey) | Lv in §3.1 | 1,500 | wood 30, scrap 20, glass 6 | 6 | **12 h** | maxStorey + 1 |
| **Guest Wing** | starter, cottage, stilt, mansion, plot (1) | Lv 4 | 2,000 | wood 25, scrap 15, cloth 10, glass 6 | 12 | **24 h (1 game day)** | +1 household, +1 room |
| **Basement Dig-Out** | per §3.1 basement column (1) | L6 unlocked (crypt quest) + Lv in §3.1 | 1,800 | scrap 20, bone 10, wire 6 | 12 | 24 h | storey −1 allowed (L6 dig tool works on this lot), +80-object basement budget |
| **Grand Hall** | mansion (1) | Lv 6 | 6,000 | wood 40, scrap 30, glass 20, wire 10, bone 10 | 24 | 48 h | +2 rooms, +30 objects |

Extension slots (§3.1) cap how many distinct extensions a home holds. Extensions stay with the home when you move
out and add resale value (50 % of their $).

### 6.2 Build timer formula

All timers run on **sim ticks** (1 tick = 0.25 game min; 240 ticks per game hour).

```
baseHours  = 2 × S × durationMult(class)                       // §5, §6.1; clamp [0.5, 120]
tinkFactor = 1 − 0.02 × min(10, maxTinkering(household))        // up to −20 % (C2 tinkering; 0 if not shipped)
B          = round(baseHours × tinkFactor × eventFactor × 240)  // ticks; eventFactor §7.3 (1.0 normally)
dueTick    = startTick + B − reducedFree − reducedPaid
cap:   reducedFree + reducedPaid ≤ floor(0.6 × B)               // floor duration = 0.4 B, the same for everyone
       reducedPaid ≤ floor(0.3 × B)                              // paid can never exceed half of the cap
       B − reduced ≥ 120 ticks (30 game min)                     // absolute floor
```

The rule of thumb **"2 game hours per size point"** lets content authors size new projects: count walls ÷ 3 + floor
tiles ÷ 9 + big objects ÷ 4 and round, or copy the nearest row above.

Real-time feel: at 1× (1 game-min/s) a Room Addition is 2 real minutes, a New Storey 12, a Guest Wing 24; at 3× (8
game-min/s) a day-long project is 3 real minutes. Time passing is not free in this game (needs decay, bills fall due,
zombies rot), so a shorter project is genuinely worth something, without real-time waiting walls.

### 6.3 The crew

- One **crew** per home (a seeded pair of NPC builders from the "Bonewright & Daughters" crew, render-only
  agents like the carpool hearse: not simulated agents, no autonomy cost). They appear on the lot 07:00–19:00 with
  scaffolding (`scaffold_project` dressing object, non-blocking, `passable: true`) around the affected area, and a
  lantern at night. The timer runs continuously 24 h (zombie crews do nights).
- **Crew slots:** 1 per home; a **2nd crew slot unlocks free at HL 12**. Crew slots are never sold (conflict X22).
- **Queue:** up to 3 queued projects; the next starts automatically when a crew frees up. Cost is charged **when a
  project starts**, not when queued; if funds/materials are short at that moment it is skipped with a notification
  and stays queued.
- **Power cuts** don't stop the crew. The Repo Ghoul never repossesses scaffolding or project materials. A fire that
  reaches the scaffold pauses the project until the fire is out (no damage).

### 6.4 Pitch In (household zombies)

- Interaction `home_pitchIn` on `scaffold_project`: 60 min, **not autonomous** (player-directed; keeps BALANCE
  autonomy untouched). Each completed run reduces the timer by `(0.5 + 0.05 × tinkering)` game hours (30 min at
  tinkering 0, 60 at 10). Pitch-In counts toward the free cap and on its own may remove at most **0.3 B**.
- Needs per hour: energy −6, hygiene −4, fun −2 (Ambitious and Tinkering ≥ 5: fun +2 instead). Tinkering xp 20/h
  (side skill rate, levels README §6). Moodlet *Pitched In* (+4, 6 h). Up to 3 zombies at once (3 slots on the
  scaffold). Anim: `saw` / `solder` (C21, fallbacks `clean` / `pickup`).

### 6.5 Shop jobs (vehicles)

Functional vehicle upgrades (vehicles.md §6: Engine T1–T3, Seats, Trunk, Tinted Windows, Reinforced Chassis) may
either be installed by a zombie as today (active run) **or** left at the L3 mechanic as a shop job: S = installMin ÷
30, + $40 labour, the vehicle is unavailable until done. Same timer and speed-up rules.

## 7. Speed-ups

### 7.1 Free sources

| Source | Reduction | Limits | How you get it |
|---|---|---|---|
| **Tinkering** | B × (1 − 0.02 × level), up to −20 % | applied to B, outside the cap | play (W-029 skill) |
| **Pitch In** (§6.4) | 30–60 min per zombie-hour | ≤ 0.3 B per project | play |
| **Builder's Coffee** (`item_builders_coffee`) | −45 min per cup ("Bring the Crew Coffee", 5 min) | ≤ 3 cups per project per game day | brew at the stove or an espresso machine ($4, 5 min, cooking xp 6); daily tasks; contest/newsletter rewards; gifts (W-043) |
| **Foreman's Favour** | −60 min (−90 at HL ≥ 10) | 1 token per game day at 00:00, banks up to 3 | free, daily |
| **Lend a Hand** (townie friend, offline) | −max(15 min, 0.02 B) | 1 per townie per project; ≤ 2 per game day | a visiting townie with friendship ≥ 35: social `social_lendHand` (base 0.85, friendship +2/0) |
| **Friend Help** (online, W-043) | −max(15 min, 0.02 B) | 1 per friend per project; helps (townie + online) ≤ 10 per project | friends' async Help |
| **Foreman's Tip** (Bones) | −60 min | ≤ 2 per project per game day; 30 Bones each | Bones are earned currency (MONETIZATION §2) |
| **Build-off Week** (live event, W-044) | `eventFactor` 0.85 on projects started during the event | applies to B (lowers the floor for everyone equally) | free event |
| **Featured Builder** booster (Daily Grave feature, W-044) | B × 0.9 on the next 3 projects | earned by votes only | contests |

### 7.2 Paid source

| Source | Price | Limits |
|---|---|---|
| **Rush Order** (Grave Gold) | **10 GG per game hour** (min 10 GG; the real-money equivalent shown, MONETIZATION §1) | ≤ 0.3 B per project and never below the shared floor `0.4 B`; signed-in 15+ only (no GG for under-15); teen cap applies |

- If a rushed project is cancelled, the unused paid minutes become **Rush Credit** on the account (server ledger,
  C34) for the next project. GG is never lost to a cancel, and Rush is never refunded as $ (no GG → $ path exists).
- The Afterlife+ subscription and Season Lease grant **nothing** that touches timers (convenience stays one SKU you
  can see and price).

### 7.3 Fairness proof (no paywall)

1. **Same floor for everyone.** Every project's fastest possible completion is `0.4 × B` after start (or 30 min),
   whatever is paid. Paid reduction only substitutes for free reduction inside the same 60 % cap.
2. **Free sources get close to the floor, offline and alone.** A project finishes at the first T where
   `T + reductions(T) ≥ B`. Worked cases (offline, no online friends, banked Favours spent at start):
   - **Room Addition** (B = 2 h; floor 48 min): one coffee + one Favour = 105 min of reduction at once → finishes at the
     **floor (48 min)**. Payers gain nothing.
   - **Starter Lv 6** (B = 24 h, tinkering 0; floor 9.6 h): 3 Favours + 3 coffees + 2 tips = 7.25 h at once, then two
     zombies Pitch In (1 h/h together) and 2 townie helps (≈ 1 h) → finishes at **≈ 13 h** vs the floor 9.6 h.
   - **Mansion Lv 10** (B = 97 h at tinkering 5; floor 38.9 h): 3 zombies Pitch In 6 h/day each (13.5 h/day of
     reduction, sub-cap 29 h), 3 coffees, 1.5 h Favour, 2 tips and 2 townie helps a day (≈ 23.6 h/day in all) →
     finishes at **≈ 47 h** vs the floor 38.9 h. With online friend helps it reaches the floor.
   So the free player's worst case is within **0.3 B** of the payer's best case, and on short projects it is equal.
   A test sweeps every project (§13 test 9).
3. **Nothing else is for sale.** HL xp, renovation levels, extension unlocks, household $, materials, crew slots and
   limits have **no SKU** (catalogue test). Paid currency never converts into $ or materials.
4. **Bounded edge.** The most a payer saves over a free player who ignores free speed-ups is 0.3 B per project; over
   the whole starter renovation path (Lv 2 → 6, Σ B = 66 h) that is ≤ 19.8 game hours (under one game day). Over a
   diligent free player it is at most the gaps in point 2 (0 on short projects, a few hours on long ones).
5. Telemetry (W-045 `project_done`) reports the free/paid reduction mix; the live-ops dashboard alarms if paid
   share of reductions > 25 % in any HL band, a sign that free sources are too hard to use.

## 8. Offline, unattended and travel behaviour

- **Game closed:** the sim is paused, so timers are paused. This is a life sim: game time only passes while you play.
  The Home panel says "Projects advance in game time" and shows the ETA as a game date ("Thu 14:00").
- **Household away from the home lot** (W-025 travel, work trips, holidays): the home is a frozen snapshot. On
  re-entry the closed-form catch-up (DESIGN_WORLD_LEVELS §1) completes any project whose `dueTick` passed, **at its
  due tick** (effects, HL xp and the `project` event carry that tick). Pitch In needs presence; coffee/tips/Favour can
  be applied from the phone anywhere ("Call the Foreman").
- **Online helps and gifts** (W-043) arrive as inbox items that the client applies through a journaled `inbox`
  command at a tick boundary (C38). Replay of the journal reproduces them exactly.
- **Moving out with a project running:** confirm dialog; the project is cancelled (75 % $ back, materials back,
  free reductions lost, paid minutes → Rush Credit).
- **Cancel** at any time with the same refund rule. Undo does not apply to projects.

## 9. Moving house (fills levels L1 Q2 / L5 "Move Household flow")

- Phone → **Real Estate** (or the Neighbourhood Map, W-025): lists unlocked residential lots with class, price,
  limits at Lv 1, extension slots and a "fits your household" check (household ≤ the new home's Lv 1 limit, or the
  move is refused with the reason).
- **Sale of the old home:** `lotValue × 0.9` (renovation and extension spends already raised lotValue by 50 %). The
  free starter sells too (its house value $19,500 at Lv 1), so moving up never punishes the free start.
- **Packing:** up to **40 placed objects** go into the moving van (household inventory, placed later at no cost);
  the rest are sold at normal depreciation. Items (meals, curios…) and the Stash always move.
- **Arrival:** the new home starts at **Lv 1** with its template furnishings; its own renovation path begins. HL,
  Bones, entitlements and relationships carry over. One home per household in v1 (L7 rentals are separate).
- Idempotency keys: `move:<fromLot>:<toLot>:<tick>` for the sale and the purchase, both in one command.

## 10. Data model (additive, optional fields)

```ts
// src/shared/world.ts (C31)
export type HomeClass = 'starter' | 'cottage' | 'apartment' | 'stilt' | 'mansion' | 'plot';
interface LotDef { /* … */ homeClass?: HomeClass }

// src/sim/types.ts (C26, C27, C32)
interface HouseholdState { /* … */ level?: { xp: number; level: number; capDay: number; capCounts: Record<string, number> } }
type ExtensionId = 'roomAddition' | 'porch' | 'balcony' | 'newStorey' | 'guestWing' | 'basement' | 'grandHall';
type SpeedSource = 'pitchIn' | 'coffee' | 'favour' | 'townieHelp' | 'friendHelp' | 'bonesTip' | 'rush';
interface ProjectState {
  id: string;                                  // `prj_<lotId>_<n>` (n = home.nextProject++)
  kind: 'renovation' | 'extension' | 'shopJob' | 'commission';
  target: number | ExtensionId | string;       // level, extension id, vehicle upgrade id, blueprint id
  startTick: number; baseTicks: number;        // B
  reducedFree: number; reducedPaid: number;    // ticks
  bySource: Partial<Record<SpeedSource, number>>;
  dayUse: { day: number; coffee: number; tips: number; townieHelps: number };
  helpers: string[];                           // townie agent ids / hashed friend ids (dedupe), ≤ 10
  paidKeys: string[];                          // ledger idempotency keys of Rush spends
  costPaid: number; materialsPaid: Partial<Record<MaterialId, number>>;
}
interface HomeState {
  renovation: number; extensions: ExtensionId[]; spent: number;
  projects: ProjectState[]; queue: { kind: ProjectState['kind']; target: ProjectState['target'] }[];
  favour: { bank: number; lastDay: number }; nextProject: number;
}
interface LotState { /* … */ home?: HomeState }      // per-lot snapshot data (travels with the lot)
interface SimSettings { /* … */ housing?: boolean }

// src/sim/contracts.ts (C28, C29, C30)
| { type: 'project'; action: 'start' | 'queue' | 'cancel'; kind?: ProjectState['kind']; target?: ProjectState['target']; projectId?: string; buyMissing?: boolean }
| { type: 'project'; action: 'speedup'; projectId: string; source: Exclude<SpeedSource, 'pitchIn' | 'townieHelp' | 'friendHelp'>; qty: number; ledgerKey?: string }
// SimEvent
| { type: 'project'; what: 'started' | 'progress' | 'done' | 'cancelled' | 'skipped'; projectId: string; lotId: string; dueTick: number }
| { type: 'householdLevel'; level: number }
// SimulationAPI
home?(): HomeView | null;                 // limits, usage, renovation, extensions, projects with ETA and cap bars
homeLimits?(lotId?: string): HomeLimits;  // pure: class + renovation + extensions
// BuildPreview.reason gains the prefixes 'limit:objects' | 'limit:rooms' | 'limit:storey' | 'limit:basement'
```

- **Determinism:** no RNG at all (crew names come from the lot id hash at render time only). Completion is
  `tick ≥ dueTick`, checked each tick for ≤ 2 running projects (O(1)). A `rush` speed-up carries a `ledgerKey` from
  the server spend; the sim records it in `paidKeys` and refuses a duplicate key, so a replayed or doubled command
  never applies twice. Offline/dev builds have no GG, so `rush` is refused there ("Sign in").
- **Size:** HomeState ≤ 1.5 KB per lot.
- **Settings OFF** → the housing system registers but early-returns; no fields are created.

## 11. Interplay with other systems and levels

| System / level | Hook |
|---|---|
| W-029 crafting | materials, Stash, $ fallback; Builder's Coffee recipe lives in food (stove/espresso), not a station |
| W-030 Quick Build | New Storey / Basement Dig-Out set the allowed storeys that `buildRules.maxStorey` (C25) clamps further per lot |
| W-031 vehicles | shop jobs (§6.5); Garage door stays a normal object (no extension gate) |
| W-033 family | Turning / move-in respect `maxHousehold`; rot stages give HL xp |
| W-034 seasons | crew still works in snow; a blizzard block (if W-034 defines one) pauses outdoor extensions (porch, balcony) only |
| W-043 social | Friend Help, gifts of coffee, visiting a friend's home shows its renovation plaque |
| W-044 contests | "Home" and "Lot" contests show the home's class and level; Build-off Week eventFactor; Featured Builder booster |
| L6 Underneath | Basement Dig-Out is the gate for storey −1 on a lot; L6's own dig tool and prices are unchanged |
| L7 Necropolis | **commissioned builds** become projects (kind `commission`, S = ceil(objects ÷ 20) + ceil(walls ÷ 30)); "Build over a day" in L7 §4.1 becomes this timer and keeps its discount rule (conflict X21) |
| Quests | new objective kinds `renovation {level}`, `householdLevel {level}` (C33); suggested quests below |

Suggested quests (content for the quests owner; Bones per levels README §5): `n_ww_firstReno` "Fixer-Upper No More"
(reach Lv 2, 60 Bones, unlocks the Hard Hat cast body, body-tiers.md); `story_ww_addition` "Room to Rot" (complete a
Room Addition, 50); `n_any_pitchIn` "Many Hands" (Pitch In 3 times, 20, repeatable 7 days).

## 12. UI flows

- **Home panel** (HUD → household → *Home* tab; hotkey `H` outside Quick Build): class badge + name, renovation
  level dial (Lv 3 / 6), HL bar, limit meters (`Objects 84/114`, `Rooms 6/7`, `Storeys 0/1`, `Household 3/4`), each
  meter with a glyph and text (colour-blind safe), extension slots, the running project card(s) and the queue.
- **Start Project dialog:** what it unlocks (before → after limits), $ cost, materials with Stash counts and a "Buy
  missing ($N)" toggle, HL requirement (lock + "HL 4 needed: you are HL 3, 140 xp to go" + where xp comes from),
  base duration and ETA as a game date. Buttons: Start / Queue / Cancel.
- **Project card:** progress ring, ETA, a **cap bar** showing free reduction (bone colour), paid reduction (gold,
  hatched) and the floor marker ("Fastest possible: Thu 02:00"). Buttons: *Pitch In* (select zombies), *Coffee*
  (n in the fridge), *Favour* (bank n/3), *Tip 30 Bones*, *Ask friends* (online), *Rush (n GG ≈ $x.xx)*; disabled
  buttons say why ("Daily coffee limit reached").
- **Build mode:** a compact limits strip; hitting a limit shows the refusal reason and a "See upgrades" link.
- **Completion:** toast + optional camera focus on the house (reduceMotion: no camera move) + newspaper mention in the
  next Daily Grave local edition (W-044).
- **Real Estate** (§9): list with filters by level/class/price; compare view; confirm with sale/packing summary.
- **Accessibility:** every flow keyboard-complete (tab order: meters → projects → buttons), screen-reader strings
  ("Renovation level 3 of 6. Objects 84 of 114."), timers announced on completion only, never every tick.

## 13. Acceptance tests

| # | Test | Kind |
|---|---|---|
| 1 | BALANCE scenarios A–D, seeds 11/22/33, 3 days, housing OFF vs feature absent → **byte-identical** WorldState | isolation |
| 2 | Turning housing ON in an existing save initialises the lowest fitting level; over-limit content is kept; 0 repair warnings | migration |
| 3 | Every level-doc residential template fits its class's Lv 1 limits (objects, rooms, storeys) | data |
| 4 | `homeLimits` matches the §3.1 worked tables for starter and mansion at every level; hard caps 8 / 240 / 80 never exceeded with all extensions | unit |
| 5 | BuildService refuses buy/room/addWalls/qbPlace over a limit with the typed reason; undo/redo never bypasses limits; a refused command charges nothing | unit |
| 6 | `social_moveIn` and Turning refuse at `maxHousehold` with a reason; existing over-limit households are grandfathered | unit |
| 7 | HL: each source adds exactly its xp once; caps per day hold; replaying the journal gives the same HL; `xpFor` table | unit |
| 8 | Project start charges $ and materials once (idempotency key), fails cleanly when short; queue skips and retries | unit |
| 9 | **Fairness sweep:** for every project kind × class × tinkering 0/5/10, simulate an offline free player using every free source at its daily limit: completion ≤ floor + 0.3 B, and = floor for every project with B ≤ 4 h; no combination of paid + free goes below 0.4 B or 30 min | property |
| 10 | Rush with a duplicate `ledgerKey` applies once; Rush offline/dev is refused; cancel converts unused paid ticks to Rush Credit exactly | unit |
| 11 | Completion tick exact: a project due at tick T completes at T whether the lot is active, snapshotted (catch-up on re-entry) or saved/loaded mid-project | determinism |
| 12 | Save/load mid-project and mid-Pitch-In → byte-identical to an uninterrupted run (journal replay) | determinism |
| 13 | Moving: sale price, packing ≤ 40 objects, refused when the household does not fit; HL and Stash carry over | integration |
| 14 | Scenario **H** (housing ON, profile B + a renovation each time funds ≥ cost + $1,500 reserve), 5 seeds × 60 days: GDD §18 targets hold; HL 5 ± 1 by day 21; starter Lv 6 between day 40 and 70 | balance |
| 15 | Catalogue test: no SKU grants HL xp, renovation, extension, limits, $, materials or crew slots | economy |
| 16 | UI: keyboard-only start → speed-up → completion; screen-reader strings; cap bar glyphs | e2e |

## 14. Edge cases

- Funds drop below zero risk: projects never charge after start; bills follow GDD §6 unchanged.
- A household member at work cannot Pitch In; a crumbled member's xp contributions stay counted.
- Two projects affecting the same limit: limits apply in completion order; a queued New Storey beyond the class
  maximum is refused at queue time.
- Lot snapshot from an older build without `home`: treated as housing OFF for that lot until the player opts in.
- Clock edits / cheats: `cheat` commands that change time are already journaled; they move `tick`, so timers follow
  the sim clock. No wall-clock is read anywhere.

## 15. Audio and render needs

- SFX (C22 additions): `projectStart` (tape measure + whistle), `crewHammer` loop (positional, day only, ducked at
  night), `projectDone` (saw flourish + small brass sting), `coffeeSlurp`.
- Render: `scaffold_project` (≤ 1,800 tris, instanced poles + planks, sized to the project bounds), two crew NPC
  appearances drawn from cast bodies `hardhat` and `strongman` (render-only), curb-appeal dressing sets per level band
  (≤ 1,200 tris each).

## 16. Open questions for the lead

| Id | Question | Default here |
|---|---|---|
| Q-H1 | Instant build within limits + timed limit-raising projects (vs timing every wall)? | yes (§2) |
| Q-H2 | Class maximum levels (starter 6, apartment 5, cottage/stilt 8, mansion/plot 10)? | yes |
| Q-H3 | Housing ON for new games, OFF (opt-in) for existing saves, like D-019? | yes |
| Q-H4 | Accept that the paid career-XP boost indirectly speeds HL (edge, not lock)? | yes; alternative: HL ignores boosted xp |
| Q-H5 | 2nd crew slot free at HL 12, never sold? | yes |
| Q-H6 | Rush price 10 GG per game hour, paid cap 0.3 B, shared floor 0.4 B? | yes |
| Q-H7 | Move House: 90 % of lotValue on sale, 40 packed objects? | yes |

## References

- Alliance/"help" mechanics in base builders (reduction per help with a per-building cap): [Rise of Kingdoms wiki: Alliance Center](https://riseofkingdoms.fandom.com/wiki/Buildings/Alliance_Center);
  [BlueStacks: Dark War Survival alliance guide](https://www.bluestacks.com/blog/game-guides/dark-war-survival/dws-alliance-guide-en.html);
  [LDShop: Dark War Survival building upgrade guide](https://www.ldshop.gg/blog/dark-war-survival/building-upgrade.html)
  (third-party, top-up seller: mechanics only, numbers unverified).
- Timed boosts with stacking limits: [Clash of Clans wiki: Magic Items](https://clashofclans.fandom.com/wiki/Magic_Items/List);
  [Clock Tower overview (Sportskeeda)](https://www.sportskeeda.com/esports/what-builder-base-clock-tower-clash-clans).
- Lessons taken: helps work best as small, capped, social reductions; boosts that only *substitute* for free
  reductions under a shared cap keep paying players from out-running free ones; long timers want a "start it before
  you stop playing" rhythm, which a game-time life sim replaces with "start it before bed". No names, numbers or
  content from those games are used.
