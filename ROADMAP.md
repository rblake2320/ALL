# Roadmap: where Afterlife Lease is going

**Start with [docs/CORE_CONCEPT.md](docs/CORE_CONCEPT.md):** what the game is meant to become and which rules are fixed.

This page is for anyone who wants to help build the game. It says what exists, what comes next and which rules a
piece of work has to respect. Pick something, open an issue to claim it ([CONTRIBUTING.md](CONTRIBUTING.md)), and
build towards it. The owner keeps the game's direction; the detailed list of work items is
[docs/WORKBOARD.md](docs/WORKBOARD.md).

## The idea

One game, two ways to play it.

Play style is a choice, and you can change it: run the household from above, roam the town as one zombie, or go and
fight.

- **Home mode: the life sim.** Everyone starts here, and children only ever see this. Needs, jobs, bills, pets,
  building a home, walking the town, visiting neighbours.
- **The fighting mode: missions and home defence.** For players of 15 and over who switch it on. Separate missions
  you queue for, alone or in a group, and scheduled attacks on extra homes that their owners defend.

Home-mode players are never attacked, never lose anything, and do not even see the fights.

## 1. Playable today

The life sim (needs, the decay economy, careers, social life, build and buy, synthesised sound, crash-safe saves), the
story start, the walkable world (neighbours, the street, the graveyard), pets and wildlife, home building, roofs and
ceilings. It runs in a browser and as a Windows app, with no account and no server.

A first test of the shared town also exists, separate from the game and off by default: two browsers on the same
street, each seeing the other's zombie walk ([docs/SHARED_TOWN.md](docs/SHARED_TOWN.md)).

## 2. Next, still single-player (no server needed)

Good places to start, because nothing here needs an account, hosting or a lawyer.

| What | Work item | Design |
|---|---|---|
| Job board: post and take real-priced jobs with the townies (mow, repair, pet-sit, cater) | W-160 | [player-jobs.md](docs/contract-requests/player-jobs.md) |
| Afterlife Rank: rank, XP and the unlock table, with a small reward at every rank | W-163, W-164 | [DESIGN_PACING.md](docs/DESIGN_PACING.md), [DESIGN_PROGRESSION.md](docs/DESIGN_PROGRESSION.md) |
| The voice ladder: zombies go from Groanish to mumbled words (rank 15), phrases (25) and a normal voice (40) | W-165, W-166 | [DESIGN_PACING.md §3](docs/DESIGN_PACING.md) |
| Yards: fences, gates, paths, gardens and a Gardening skill | W-109 | [docs/WORKBOARD.md](docs/WORKBOARD.md) |
| More of the world: new districts, and generated streets between them | W-138, levels L2 to L7 | [DESIGN_WORLD_LEVELS.md](docs/DESIGN_WORLD_LEVELS.md), [DESIGN_OPEN_WORLD.md §4.3](docs/DESIGN_OPEN_WORLD.md) |
| Over-the-shoulder and first-person play, with direct control of a zombie | W-136, W-137 | [DESIGN_OPEN_WORLD.md §4.1](docs/DESIGN_OPEN_WORLD.md) |
| Several homes per household, with permission levels for visitors | W-139 | [DESIGN_OPEN_WORLD.md §4.4](docs/DESIGN_OPEN_WORLD.md) |
| Home security against townies and strays: guard pets, alarms, locks, lights | W-142 | [DESIGN_OPEN_WORLD.md §4.8](docs/DESIGN_OPEN_WORLD.md) |
| New furniture, careers, pets, recipes, outfits and story beats | any time | [docs/community/](docs/community/README.md) |

## 3. Missions, and homes worth defending

The fighting side of the game. Nothing here is built yet except the schedule rules for home attacks, which exist as
tested code in `src/shared/homeDefense.ts`. **[docs/CORE_CONCEPT.md](docs/CORE_CONCEPT.md) sections 4 to 6 are the
guide**; older detail is in [combat-power.md](docs/contract-requests/combat-power.md) and
[zombie-build-system.md](docs/contract-requests/zombie-build-system.md).

- **Missions you queue for, not an open free-for-all.** Solo, duo, crew runs of four, raids of eight and a versus
  arena. Each mode has its own feel, roles in a group, rewards at the end and daily or weekly resets.
- **Three ways to see and play, switched at any time:** the overview (classic life-sim camera), over the shoulder
  (roam the world as one zombie) and first person. The three views exist today.
- **Health, healing and respawn:** a health bar that only matters in missions; ways to heal and to raise maximum
  health; a beaten zombie respawns back home after a short wait and loses nothing permanent.
- **Power levels, weapons and loadouts:** four combat stats earned in play, one power number per zombie and per crew;
  weapons crafted from salvage or found in the world. Power can never be bought.
- **Homes:** your main home is always protected. Extra homes can be attacked only in a scheduled weekly window, after
  a grace period, with a free pass, a 48-hour lock on switching the fighting mode on or off, and defences you build or hire: guard dogs, traps, weapons and
  hired guards.
- **Hordes, crews and blocks:** friends roaming together, lasting crews, and a crew's home block.

Good first pieces: a health bar and healing in the life sim's own rules; one solo mission against computer-controlled
enemies; hired guards as a job type; a "defence strength" number for a home.

The fixed rules (nobody attacked in the town, 15 and over with the mode switched on, bounded loss, no bought power)
are listed in the core concept. Work that breaks one will not be merged.

## 4. One shared town: everyone in the same world at the same time

**This is the headline goal.** Today each player has their own separate game. The aim is that when twenty people open
the game, they are in the same town, see each other walk around, wave, visit, and team up for missions.

How it is meant to work, the same way most browser multiplayer games do it:

- **One server runs the game rules and has the final say.** The rules in `src/sim/` already run without a screen and
  give the same result every time, so the same code can run on a small Node.js server and in each browser.
- **Each browser sends what its player does and receives what everyone near them is doing,** many times a second
  over a WebSocket. The browser shows its own zombie's moves at once and corrects itself if the server disagrees.
- **Only what is near you is sent to you.** The town is already split into regions; a player gets updates for their
  region and the ones next to it. A home's inside is never sent to someone who is not allowed in.
- **First version: no accounts, nothing stored.** You get a zombie and a preset name, you can use emotes and preset
  phrases, and when you leave nothing about you is kept. That keeps it safe for younger players and means no
  personal details are collected.

Steps, each one playable:

1. A server that runs the town and lets two browsers see each other's zombies walk the street. **Built as a test
   page** ([docs/SHARED_TOWN.md](docs/SHARED_TOWN.md)); not yet reachable from the game, and not hosted.
2. Twenty or more players in one town; regions, interest management, reconnecting.
3. Emotes and preset phrases; visiting a home with the owner's permission.
4. Missions on the server: small separate rooms of up to eight players, with health and combat.

Steps 2 to 4 are not built. Design notes: [DESIGN_OPEN_WORLD.md §5](docs/DESIGN_OPEN_WORLD.md).

## 5. Online accounts and saves that follow you

Nothing here is built, and today nothing leaves the player's device. The design is in
[ARCHITECTURE_PLATFORM.md](docs/ARCHITECTURE_PLATFORM.md) and [docs/systems/social.md](docs/systems/social.md).

| What | Work item |
|---|---|
| Accounts and login (email or a store account), with parental consent for children | W-096 |
| The server, hosting and a staging environment | W-097 |
| Cloud saves that follow you between devices and never silently overwrite | W-098 |
| A server-held ledger for the in-game currencies | W-099 |
| Friends, visiting each other's homes, parties, crews | W-143, [DESIGN_HOMES_SOCIAL_COLLECTIONS.md](docs/DESIGN_HOMES_SOCIAL_COLLECTIONS.md) |
| Talking in the game: preset phrases and emotes for under-15s, filtered text chat for 15 and over, with mute, block and report on everything | W-143 |
| The job board between players | W-161 |

**Rules for online work:**

1. Children play this game. No feature may collect or send a player's personal details (an email address, a name,
   chat) until the children's-privacy review is finished. Design and code against a local test server are welcome
   before then; switching it on for players is the owner's call.
2. Under-15 profiles: preset phrases and emotes only, friends and crew only, no strangers.
3. The server decides money, positions and permissions. A client is never trusted.
4. A home's inside is never sent to a player who is not allowed in.

## Where to talk

Until the game has its own chat, [GitHub Discussions](https://github.com/rblake2320/ALL/discussions) is where players and builders meet: ideas,
questions, show-and-tell. Bugs and claimed work go in Issues.
