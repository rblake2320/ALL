# Live world, social, housing progression, events — owner direction (2026-11-05)

Principles (binding): fun first, no slop; **paying gives an edge, never a lock** — every reward, rank and feature
reachable by free players; E10+ safety for social features; original IP.

## 1. Reusable asset library (cross-game) — W-040
Owner will build more games; assets must be reusable. **The canonical library already exists: `rblake2320/asset-bank`**
(private, default branch `master`; owner's local copy `D:\character-bank`, `tools/bank.py add|add-static|export|list|catalog`, rig contract v1,
25 Zombie Smash 2 characters banked with cards). No new repo. Gap: Afterlife Lease builds art in-repo and banks nothing.
Plan: every art build here also banks its master + card (props, buildings, characters, creatures); the game keeps
consuming runtime derivatives in `public/assets`. Bank layout covers: scripted Blender pipelines (characters, cast bodies, objects, pets, levels, vehicles,
build pieces), source references (e.g. Zombie Smash 2 models by commit), built GLBs + versioned manifests
(semver per pack: `cast@1.0.0`, `pets@1.0.0` …), contact sheets, licence/provenance per asset, and a tiny loader spec
(glTF Y-up metres, front +Z, our bone names). Games consume packs by pinned version (npm package or git submodule +
`verify:assets` hash check). Afterlife Lease keeps working unchanged until the switch; migration is a parked/moved
record, never a deletion.

## 2. Bodies & quality tiers — W-041
Free starter zombie = the procedural Classic body (good, not lesser-made — just simpler). Detailed sculpted cast bodies
(25 from ZS2 + future) unlock by play (quests, rot stages, events) **and** by store — every body has an earnable path.

## 3. Housing progression & build timers — W-042
- **Free starter home** (Mildew Lane fixer-upper). Buyable homes in tiers across levels (Bayou stilt house → Rot Row
  apartment → Mausoleum Hills mansion), each with **limits**: lot size, max storeys, max rooms, max object count,
  max household size, unlockable extensions.
- **Renovation levels** per home (Lv 1–10): each level raises limits; requires funds + materials + household level.
- **Projects take time:** additions, upgrades, vehicle mods, crafting big items run on a **game-time build timer** that
  scales with size (e.g. room 2 h, storey 12 h, extension 1 game day). Speed-ups: Builder's Coffee (craftable/earned),
  friend "Help" (social), skill (Handiness/tinkering), daily free speed-ups, and paid Grave Gold boosts. No project
  ever requires payment; paid speed-up caps prevent pay-to-skip progression bottlenecks.
- Benchmark game owner cited: Dark War Survival (base-building timers, helps, events) — learn mechanics, copy nothing.

## 4. Social — W-043 (online, Phase 4)
Friends list (add by code/QR/username, requests, block, report), neighbour visits (async), gifts, "Help" on build
timers, clubs/crews, **in-game messaging**: under-15 = preset phrases + emotes only; 15+ = filtered text chat
(server-side moderation, e.g. Laya per D-024) with report/mute/block; voice chat out of scope v1. Calls/texts from
townies via the in-game phone (exists) extend to real friends.

## 5. Events, ratings, newsletter — W-044
- **Rate-it contests:** Zombie, Ride, Home, Room, Lot, Pet — weekly themes; players submit (snapshot via photo mode),
  others rate (1–5) from random pairs; anti-abuse (rate-limit, rater reputation, no self/friend vote rings).
- **The Daily Grave** (in-game newsletter): features top-ranked entries, community news, event results; featured
  players get Bones, a booster, a badge/cosmetic. Rank is earned by votes only — Grave Gold cannot buy votes or rank.
- Seasonal/live events (Halloween, Full Moon festival, Build-off weeks) with free + premium tracks (MONETIZATION §6).

## 6. Gameplay telemetry — W-045
Consent-gated (opt-in, off for under-15; COPPA's own threshold is under 13), no PII, pseudonymous install id; events: session start/end,
funnel (menu→CAZ→first build), quest progress, economy sinks/sources (Bones, $, GG), crashes/errors, perf (fps
buckets, quality preset, GPU tier). Local buffer → server batch (Phase 4); dashboards for balance + live ops.
Store only what a decision needs; retention limit; data deletion on request.

## 7. A world that grows — W-046
Scale hierarchy: **Lot → Neighbourhood (level) → Town → City → Region/State → Country**. Each tier unlocks with
progression and community growth (L7 Necropolis is the first shared town). New towns are seeded from blueprints and
player contributions; travel between tiers by vehicle/transit with time. Day/night + seasons everywhere (W-034).
Content cadence: new towns/regions as live updates/expansions.

## 8. Acceptance criteria (from Sol, Claude ZSM, Astra review — binding)
- **Assets:** bank masters separately from per-game runtime derivatives (LOD/retarget), with source hash, rig/units/clip
  compatibility, visual comparison and pinned import receipts. Reuse proof: export the same pinned asset into two
  disposable consumer projects, verify hashes/rigs, demonstrate the game-specific animation adapter. Hardware LOD is a
  device choice, never a penalty on free players; detailed originals are preserved.
- **Construction timers:** immutable project id, materials/spend ledger, remaining-work state; offline vs simulated
  time defined explicitly. Tests: restart mid-build, clock rollback, duplicate completion, cancel/refund, duplicate
  booster redemption — each leaves exactly one completed upgrade and exactly one spend/reward. Home limits shown
  before purchase; the starter home stays fun while long work runs.
- **Competitions:** score design only within disclosed categories; never score spend or boosters; no-spend
  qualification route; simulate spender vs non-spender cohorts under the same rules; newsletter grants use idempotent
  event ids, vote-abuse checks and an auditable selection record.
- **Social:** two real accounts complete invite/accept, send/receive message, block/report, reconnect, remove friend.
  NPC relationship tests don't count. Text chat, voice and multiplayer visits are separate services with owners.
  SECURITY.md stays accurate: these are future systems until shipped.
- **Telemetry:** today only a consent policy + no-op sink exist (`src/economy/analytics.ts`, `service.ts`). Ship needs
  verified opted-in delivery and opted-out non-delivery; events for construction wait/abandonment, free-player reward
  reachability, home-tier progression, performance; never message contents.
- **World growth:** every expansion step ships with performance budgets for city/UGC limits.
