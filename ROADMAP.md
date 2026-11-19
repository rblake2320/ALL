# Roadmap: where Afterlife Lease is going

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
- **Frontier mode: fight, raid and defend.** For players of 15 and over who own a second home and switch it on.
  Weapons and loadouts, home defences, crews, and **Eviction Night** (working title): a scheduled night when
  households that opted in can raid and be raided.

Home-mode players are never attacked, never lose anything to a raid, and do not even see the fights.

## 1. Playable today

The life sim (needs, the decay economy, careers, social life, build and buy, synthesised sound, crash-safe saves), the
story start, the walkable world (neighbours, the street, the graveyard), pets and wildlife, home building, roofs and
ceilings. It runs in a browser and as a Windows app, with no account and no server.

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

## 3. Frontier mode and Eviction Night

The fight-raid-defend side of the game. Nothing here is built yet. The design is in
[combat-power.md](docs/contract-requests/combat-power.md) and
[DESIGN_OPEN_WORLD.md §4.7 to §4.8.1](docs/DESIGN_OPEN_WORLD.md).

- **Three ways to see and play, switched at any time:** the overview (classic life-sim camera), over the shoulder
  (roam the world as one zombie) and first person. The three views exist today; Frontier mode adds what fighting
  needs on top of them.
- **Health, healing and respawn:** a health bar that only matters in Frontier mode; ways to heal (food, embalming,
  rest, items) and to raise maximum health; a zombie that is beaten respawns back home after a short wait and loses
  nothing permanent.
- **Power levels:** four combat stats earned in play, one visible power number per zombie and per crew, and
  matchmaking that only allows a raid between crews of similar strength. Power can never be bought.
- **Weapons and loadouts:** crafted from salvage or found in the world; two weapons, one tool or trap, one perk.
- **Defences:** walls, gates, alarms, traps and guard pets, placed in Build mode. Every defence has an answer.
- **Eviction Night:** opt-in for each event. Crews with roles (lookout, breaker, carrier, guard). First against the
  home's saved defences while the owner is away, replayed for them afterwards; later live.
- **Takeovers:** a crew can hold a contested second home for a while. A first home can never be taken.
- **The night may be its own way to play.** One idea on the table: zombies leave home for the night and the event
  plays as an action game, then they come home with salvage, bruises and a trophy. Open for design.

**Rules that are not up for debate** (work that breaks one will not be merged):

1. Everything is opt-in. A household that did not join an event cannot be raided, and cannot raid.
2. Loss is bounded: only items the owner put at risk, capped per event. Nothing bought with real money is ever at
   risk. A death never costs stats, items, money or the zombie.
3. First homes are never taken.
4. Child profiles (under 15) stay in Home mode: no weapons, no raids, no fights shown.
5. Comic, not graphic. The base game stays suitable for an E10+ rating.

## 4. One shared town: everyone in the same world at the same time

**This is the headline goal.** Today each player has their own separate game. The aim is that when twenty people open
the game, they are in the same town, see each other walk around, wave, visit and (in Frontier mode) fight.

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

1. A server that runs the town and lets two browsers see each other's zombies walk the street.
2. Twenty or more players in one town; regions, interest management, reconnecting.
3. Emotes and preset phrases; visiting a home with the owner's permission.
4. Frontier mode on the shared server: health, combat, Eviction Night.

Nothing here is built yet. Design notes: [DESIGN_OPEN_WORLD.md §5](docs/DESIGN_OPEN_WORLD.md).

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
