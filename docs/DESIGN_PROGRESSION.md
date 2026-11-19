# Long-term progression, level locks, challenges, NPCs — owner direction (2026-11-05)

This is a never-ending game: nobody hits max in a day. Progression must always offer a next goal, be earnable by free
players (MONETIZATION §1, DESIGN_LIVE_WORLD §8), and never block the core loop behind payment.

## What already exists (built, W-003)
3 daily tasks (40-task pool, local-midnight rotation, streak cap), 1 weekly challenge, 10-quest story chain,
20 repeatable neighbourhood quests, Bones rewards, idempotent grants. Characters already have skills 0–10, careers
(5 tracks × 5 levels), aspirations, rot stages (specced).

## 1. Player rank — "Afterlife Rank" (account level) — W-057
- **Rank 1 → 100**, then **Prestige** ("Reburial") tiers with cosmetic marks; no hard cap.
- **Rank XP sources:** quests, daily/weekly challenges, skill level-ups, career promotions, aspiration milestones,
  building/renovation projects completed, contest participation, collections. Diminishing returns on repeated
  identical actions (anti-grind, same rule family as the autonomy repetition penalty).
- **Pacing target:** rank 10 in ~3 h of play, rank 30 in ~2 weeks of regular play, rank 60 in ~3 months, rank 100 in
  ~1 year. XP curve: `xp(r) = round(400 × r^1.6)` (tunable; balance harness checks the targets).
- **Paid influence:** none on rank XP except Season Lease XP boosts capped at +10 % (never purchasable ranks).

## 2. Level locks (unlock table) — W-058
Content unlocks by rank so the world opens gradually (with "coming at rank N" shown, never hidden):
| Rank | Unlocks |
|---|---|
| 1 | Starter home, 1 zombie, Classic body, Wormwood Heights, Old Graveyard |
| 3 | 2nd household member slot, daily challenges, Bike |
| 5 | Downtown Rot Row, crafting Workbench, Quick Build wood tier |
| 8 | 3rd member slot, Weekly challenge sets, Moped |
| 12 | Swampside Bayou, homes tier 2, stone build tier, first cast-body earn quests |
| 16 | 4th member slot, Sedan, pets adoption limit 2 |
| 20 | Mausoleum Hills, homes tier 3, metal build tier, Hearse |
| 25 | 5th member slot, The Underneath (dig layer) |
| 30 | Contests submission, clubs (online), 6th slot |
| 40 | The Necropolis (shared town), 7th slot |
| 50 | 8th slot (household max), premium vehicle mods |
| 60+ | Towns/cities/regions per world-scale spec; prestige cosmetics |
Store items keep their rank requirement even when bought (paying never skips a lock); Bones/GG only buy what is unlocked.

## 3. Challenges — W-059 (extends W-003)
- **Daily:** 3 challenges (exists) + 1 bonus after completing all 3.
- **Weekly:** a **set of 7 challenges** released each week (like a shooter's weekly challenge set, adapted to life-sim
  verbs: "Host a party with 4 guests", "Renovate a room to level 3", "Adopt a stray", "Catch 5 fish at night",
  "Pass as living at the Country Crypt Club"). Completing 5/7 grants the weekly reward; all 7 grants a cosmetic.
- **Seasonal challenge track** tied to Season Lease (free + premium rows, MONETIZATION §6).
- **Side projects:** long multi-step projects (restore the old chapel, build a hearse from salvage, complete the
  grave-goods collection) that run in parallel with the main story; they are the endless backbone between story arcs.
All challenge data is content (sim quests vocabulary); weekly sets rotate deterministically from a seeded calendar.

## 4. Characters & control — W-060
- Each zombie levels skills/careers/rot stage (exists/specced). Household slots unlock by rank (table above).
- **Recruit/turn townies** into the household (rot-stages-family spec) once a slot is open.
- Later ranks: **manage multiple households** (one active at a time, others progress abstractly per world framework).

## 5. NPCs — W-061
Beyond the 24 townies + service NPCs (Repo Ghoul etc.):
- **Named story NPCs** per level with arcs and quest chains (the Graveskeeper, Mayor Mortimer, the Bayou Witch, the
  Mausoleum Hills socialite…), defined in docs/levels/**.
- **Venue staff** (shopkeepers, librarian, gym coach, DJ, diner cook) with schedules and services.
- **Rivals & mentors** who react to the player's rank and achievements; mentors teach skills, rivals compete in
  contests and gossip.
- **Living-world NPCs** ("warm" humans) for Look Alive interactions.
- All NPCs run on the same deterministic sim (autonomy budget per lot; perf caps per world-scale spec).
