# Building Afterlife Lease together

Afterlife Lease can grow into a community-built game: players, developers and their AI agents, artists and world
builders adding to the same game, while the owner keeps the game's direction and final integration.

> **Status: open.** The repository is public under the [MIT licence](../../LICENSE) (a few art files are not covered;
> see [CREDITS.md](../../CREDITS.md)). Anyone can fork it and open a pull request. Each section says what works
> **today** and what is **not built yet**. If a sentence here claims something the code does not do, that is a P0 bug
> (`tests/unit/community/onboarding.test.ts` checks the links, commands and status claims).

## 1. One path for every contribution

```
 idea / bug / asset / content
        │
  1. CLAIM ── open (or pick) an issue, comment "claim", a maintainer assigns it
        │
  2. BUILD SEPARATELY ── your own branch or fork; one work item per branch
        │
  3. TEST ── the same checks CI runs (GETTING_STARTED.md §3); attach the exact commands and counts
        │
  4. REVIEW ── draft PR → CODEOWNERS review; art also gets an art review
        │
  5. MERGE ── a maintainer merges into main, one PR at a time, CI green after each
        │
  6. PLAYTEST DROP ── a tagged, playable build; release notes credit every contributor (PLAYTEST.md)
```

Merging is not shipping. A merged change reaches players in the next playtest drop, and the owner can hold any
change back.

## 2. Ways to help

| Who | How | Needs code? | Ready today? |
|---|---|---|---|
| **Players** | Suggest ideas, report bugs, play drops and say what felt wrong | No | In-game reports work **on the device** (F8 → `.alreport` file). Sending them anywhere waits for privacy review ([§5](#5-gates-for-opening-the-project)). |
| **Developers + their AI agents** | Fix bugs, build work items from the [workboard](../WORKBOARD.md) | Yes | Yes for the team: [GETTING_STARTED.md](GETTING_STARTED.md), [AGENTS.md](../../AGENTS.md), [STARTER_TASKS.md](STARTER_TASKS.md) |
| **Artists** | Houses, furniture, zombies, pets, vehicles, animations | No (Blender or similar) | Rules are written ([ASSETS.md](ASSETS.md)). **House-brand skins** install today through the [Creator Kit](../contributors/CREATOR_KIT.md); 3D models go through art review into the repo. Asset Bank intake is W-040, **not built yet**. |
| **World builders** | Neighbourhoods, quests, activities | No (data + specs) | Specs and proposal forms only ([WORLD_BUILDING.md](WORLD_BUILDING.md)). Installable quest/lot packs need W-084, **not built yet**. |

## 3. You don't need to code

A clear bug report or a well-described idea is a real contribution. [TRIAGE.md](TRIAGE.md) explains how it becomes
an agent's assignment, and how the person who sent it sees progress on the same issue: label changes, the linked pull
request, and the drop it ships in.

## 4. Two separate milestones

1. **Community development** (this folder): people help build the single-player game, from today's code and assets.
2. **Shared online world**: persistent multiplayer neighbourhoods, accounts and servers (W-096..W-099,
   [ARCHITECTURE_PLATFORM.md](../ARCHITECTURE_PLATFORM.md)). Not built.

Milestone 1 does not wait for milestone 2. Nothing in this folder needs a server, an account or cloud saves.

## 5. Gates for opening the project

| # | Gate | State |
|---|---|---|
| G1 | Patent check before the code became public | Closed by the owner, 2026-11-19 |
| G2 | Licence model | Closed: MIT for the code and script-generated art; exceptions in [CREDITS.md](../../CREDITS.md). A pull request is offered under the same licence ([CONTRIBUTING.md](../../CONTRIBUTING.md)) |
| G3 | Children's privacy: the game is E10+, and GitHub requires its users to be 13 or over. Issues and Discussions are public; never post a child's personal details or a save that holds them | Open: counsel review still owed. The game itself sends nothing off the device |
| G4 | Repository safety: branch protection on `main`, required review, pull requests from forks need approval to run and get no secrets | Owner sets this in the repository settings |
| G5 | CI on every pull request | GitHub-hosted runners ([ci.yml](../../.github/workflows/ci.yml)) |
| G6 | Playtest drop: a regular, reproducible playable build ([PLAYTEST.md](PLAYTEST.md)) | Not started |
| G7 | Provenance: which art is script-generated and which is not | [CREDITS.md](../../CREDITS.md) and [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md); community art adds a record per submission ([ASSETS.md §4](ASSETS.md#4-provenance-and-credit)) |

## 6. Sponsorship and ad space stay with the owner

Contributors build the world; the owner alone sells and controls what appears on its signs, screens and shelves.
Revenue model and law: [MONETIZATION.md](../MONETIZATION.md) §4 and §10. This applies to the official game; the MIT
licence lets you run your own version your own way, under a different name.

**What the code enforces today** (checked by `tests/unit/community/onboarding.test.ts`):

| Protection | Where |
|---|---|
| Only the eight original house brands can appear; any other brand in a pack rejects the whole pack | `HOUSE_BRANDS` in `src/economy/brands.ts`; `src/packs/verify.ts` content stage |
| A skin claiming a real, licensed mark is refused (no licence registry exists yet) | `skinUsable` and `src/packs/verify.ts` |
| Packs must carry an Ed25519 signature from an allowed publisher key; unsigned packs load only in Creator mode and are flagged | `src/packs/verify.ts` signature stage |
| Global, per-skin kill switches | `setBrandsEnabled`, `setBrandSkinDisabled` |
| Packs can register brand skins and nothing else | `REGISTRABLE` in `src/packs/verify.ts` |

**Not built yet, so not "locked down" yet:**

- Billboards, TV and poster ad surfaces are not rendered in the game (W-014). Brand skins exist as data only.
- No sponsor licence registry, flight dates, contracts or creative-approval tooling (MONETIZATION §4).
- No impression measurement, and none may leave the device before children's-privacy sign-off.
- The house-brand names are not registered trademarks. Clearance and filing is a counsel question.
- Contributor terms that keep every sign, screen and brand slot the owner's to sell (gate G2).

**Rule for contributors:** no brand names, logos, sponsor messages or ad placements in any contribution, and no new
`brandSlots` without the owner's approval. A contribution that adds one is declined.

## 7. Files in this kit

| File | For |
|---|---|
| [GETTING_STARTED.md](GETTING_STARTED.md) | Reproducible setup, the checks, how to play your change |
| [../../AGENTS.md](../../AGENTS.md) | AI coding agents (and the people running them) |
| [STARTER_TASKS.md](STARTER_TASKS.md) | Approachable first tasks with clear tests |
| [ASSETS.md](ASSETS.md) | What an art submission must include |
| [WORLD_BUILDING.md](WORLD_BUILDING.md) | Neighbourhoods, quests and activities: what you can propose now |
| [TRIAGE.md](TRIAGE.md) | How ideas and bugs become assignments, and labels |
| [PLAYTEST.md](PLAYTEST.md) | Playtest drops and how feedback flows back |
| [labels.json](labels.json) | The label set the issue forms use |
| `.github/ISSUE_TEMPLATE/` | Forms: bug, idea, claim work, asset submission, world content, playtest feedback |
