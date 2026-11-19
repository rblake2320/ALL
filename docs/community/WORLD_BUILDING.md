# World building: neighbourhoods, quests and activities

## 1. What works today

| Content | Today | Not built yet |
|---|---|---|
| Neighbourhoods and lots | Propose with the **World content** form, using the specs in §2 | Installable lot packs (W-084); multi-lot town runtime (W-025, in progress) |
| Quests | Propose with the form; quests ship as code in `src/sim/content/quests/` after review | Installable quest packs (W-084) |
| Activities (things zombies do) | Propose with the form; built as interactions in `src/sim/content/` | — |
| Shared online neighbourhoods | — | The shared-world milestone (W-096..W-099). Not part of community development. |

The Creator Kit's pack verifier admits **only** house-brand skins today (`REGISTRABLE` in `src/packs/verify.ts`).
Every other content type in a pack is rejected by design until its registrar exists. Don't put lots, quests or
objects into packs.

## 2. Specs to work from

| Topic | Spec |
|---|---|
| World and levels (neighbourhoods L1–L7, travel) | [DESIGN_WORLD_LEVELS.md](../DESIGN_WORLD_LEVELS.md) |
| Live world (townies, events, the town feeling alive) | [DESIGN_LIVE_WORLD.md](../DESIGN_LIVE_WORLD.md) |
| Homes, social, collections | [DESIGN_HOMES_SOCIAL_COLLECTIONS.md](../DESIGN_HOMES_SOCIAL_COLLECTIONS.md) |
| Progression and rewards | [DESIGN_PROGRESSION.md](../DESIGN_PROGRESSION.md) |
| Yards (fences, gates, paths, gardens) | [systems/yard-building.md](../systems/yard-building.md) |
| World scale (sizes, distances) | [systems/world-scale.md](../systems/world-scale.md) |
| Balance (prices, rewards, needs) | [BALANCE.md](../BALANCE.md) |
| Pillars: what the game is, and isn't | [DESIGN_PILLARS.md](../DESIGN_PILLARS.md) |

## 3. A good proposal

- **One thing.** One lot, one quest chain, or one activity per issue.
- **Player-facing first.** What the player sees and does, and why it's fun, before any implementation.
- **Fits the pillars.** Cosy macabre, E10+, mundane chores done earnestly by zombies, offline-first.
- **Uses what exists.** Name existing objects (ids in `public/assets/manifest.objects.json`), interactions and
  skills where you can. New objects become separate asset submissions.
- **Numbers from BALANCE.md.** Rewards and prices sit inside the existing ranges, or say why not.
- **Original.** No places, characters or quest lines taken from other games, books or films.

## 4. What happens next

`world` + `needs-triage` → owner checks direction → `ready` with a work item (`W-nnn`) → built by an agent or a
contributor → tested (determinism, saves, balance) → merged → playtest drop. See [TRIAGE.md](TRIAGE.md).
