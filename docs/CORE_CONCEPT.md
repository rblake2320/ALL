# The core concept

This page is the guide for anyone building Afterlife Lease, whether you write code or build inside the game. It says
what the game is meant to become and which rules are fixed. It is deliberately short. Where a piece is already built
the page says so; **everything else is not built yet** and is yours to pick up ([ROADMAP.md](../ROADMAP.md)).

The owner sets the direction. Details here can change through an issue and a pull request; the numbered **fixed
rules** change only by the owner's decision.

Where an older design document disagrees with this page, this page wins and the older one is due an update.

## 1. One game, several ways to play

You run a household of zombies. How you play it is your choice, and you can switch at any time:

| Way to play | What it feels like | State |
|---|---|---|
| **Run the household** | The classic life sim from above: needs, jobs, bills, pets, building a home | Playable |
| **Roam** | Over the shoulder or first person as one zombie, walking the town | Views playable; shared town not built |
| **Missions** | Separate fights and challenges you choose to enter, alone or in a group | Not built |

## 2. Your household is yours, at your own pace

- You start with your own team of up to four zombies. Every other player has their own.
- While you run your household you may pause, fast-forward and use boosts. It affects nobody else.
- **Boosts shorten your own tasks** (a night's sleep, a work shift, a build, healing). They are earned in play and
  friends can chip in. A boost never speeds up a fight or anyone else's game.

**Fixed rule 1.** A shared activity (a mission, a fight, anything players do together) runs at one pace for everyone
in it. While one of your zombies is in a shared activity, your fast-forward is locked.

**Fixed rule 2.** The shared town has one clock: the same day and night for everyone standing in it. Your bills,
shifts and sleep follow your own household's calendar.

A zombie in a shared activity is "away" from home, the same way a zombie at work is today. It comes back with what
happened: loot, bruises, a story.

## 3. The town is where people meet

The shared town is a hub: walk around, meet people, visit homes you are invited to, show off your zombie.

**Fixed rule 3.** Nobody can be attacked in the town or on any street. Fighting happens only in missions and in the
scheduled home attacks of section 5.

How the shared town works technically (one server runs the rules and has the final say; first version has no
accounts, no free-text chat and stores nothing) is in [ROADMAP.md §4](../ROADMAP.md).

## 4. Missions: different modes, each with its own feel

Fights are not an open free-for-all. They are separate missions you queue for. Only you and your group are inside,
and each kind plays differently, so there is always another one to try.

| Mode | Group | Idea |
|---|---|---|
| Solo | 1 | Short runs; learn a build |
| Duo | 2 | You and a friend |
| Crew run | 4 | The standard group: a full household, or four friends with one zombie each |
| Raid | 8 | Two crews, harder bosses, the best rewards |
| Versus arena | by queue | Player against player, only for those who queue for it |
| Home attack / defence | crew | The scheduled event of section 5 |

What keeps a mission game alive, and what each mode should have:

- **Roles.** A group works best with a mix, for example one who soaks damage, one who heals, one who controls the
  crowd, and damage dealers. Your build decides your role
  ([zombie-build-system.md](contract-requests/zombie-build-system.md)).
- **Rewards at the end.** Gear and style pieces. Looks are collected separately from stats, so a strong zombie can
  still look how its player wants ([crew-progression.md](contract-requests/crew-progression.md)).
- **Daily and weekly resets.** Each mission pays out once per day or week.
- **Short and long options.** A ten-minute solo run or an hour-long raid.
- **Health, healing and respawn.** A beaten zombie respawns back home after a short wait and loses nothing
  permanent ([combat-power.md §3.3](contract-requests/combat-power.md)).

**Fixed rule 4.** Missions and home attacks are for profiles of 15 and over that switched the fighting mode on.
Child profiles play the life sim and the town, and never see a fight.

**Fixed rule 5.** Comic, not graphic. Power is earned in play and can never be bought.

## 5. Homes: one protected, the rest defended

**Fixed rule 6. Your main home is always protected.** It can never be attacked.

Any other home you buy or build can be attacked, but only under these conditions. The schedule rules below are
already written as tested code in [`src/shared/homeDefense.ts`](../src/shared/homeDefense.ts) (nothing in the game
calls it yet); the numbers are starting values to be tuned.

| Rule | Starting value |
|---|---|
| Attacks happen only in scheduled windows | One window a week |
| A window is open for a limited time | 24 hours |
| **Grace period:** a new home is safe until it has had one full cycle to set up | Its first window is the first one opening at least a week after you got it |
| Attacks on one home per window are capped | 3, and a breached home is shielded for the rest of that window |
| **Free pass:** every extra home gets one "skip this attack" pass after its grace period, usable on any window | 1 per home; more are earned in missions |
| **Vacation mode:** a shield for when you are away. It cannot be started during a window, and not every time | Up to 14 days, then 4 windows before the next one |
| Who may attack you | Only crews close to your home's defence strength |
| What you can lose | Only what you placed in the home's at-risk set, capped per window. Never anything bought with real money |

**Defending.** You do not have to be online. Your defences fight for you and you can watch a replay.

- **Guard dogs** and other guard pets.
- **Traps, alarms, locks, lights, walls and gates,** placed in Build mode.
- **Weapons** for the zombies who are home.
- **Hired muscle.** Not everyone has a group of friends, so you can hire computer-controlled guards for a window,
  paid in in-game money at real-wage prices. Several tiers, and a cap, so money alone cannot make a home unbeatable.
- **Players as guards.** A player can take a paid guard job on the job board and defend your home
  ([player-jobs.md](contract-requests/player-jobs.md)).

Every defence has an answer, and an attack is a timed mission against the home, not a siege.

**Changing your main home.** Allowed, with rules so it cannot be used to dodge an attack: not while a window is open,
not in the 24 hours before one, not more than once in 30 days, and the home you leave becomes an ordinary extra home
with a fresh grace period. These rules are in the same tested file.

## 6. Hordes, crews and blocks

- **A horde** is a group of friends moving through the town together.
- **A crew** is a lasting group with a name, roles and a shared stash of crew rewards.
- **A block** is the stretch of town where a crew's members have their main homes. A crew can claim it, decorate it
  and earn shared perks for it. Blocks are made of main homes, so a block cannot be attacked; a crew's extra homes
  can.

Open for design: how a crew claims a block, what the perks are, and whether crews compete for anything beyond the
scheduled home attacks.

## 7. Two kinds of builders

The world is meant to keep growing through what people add to it.

| | Who | What they add | How |
|---|---|---|---|
| **Code builders** | Anyone who forks the repository | New systems, modes, objects, careers, fixes | A pull request ([CONTRIBUTING.md](../CONTRIBUTING.md)) |
| **In-game builders** | Anyone with the play link; no code | Homes, and buildings for the shared town such as a shop, a diner or a mart | The game's own Build and Buy tools; a finished lot is saved as a small file and submitted for the town |

**Fixed rule 7.** Nothing reaches the shared town without review: code by pull request, in-game builds by a
maintainer's approval. An in-game build is data, never code.

In-game building of your own home is playable today. Submitting a lot to a shared town is not built: see "shared
building" in [DESIGN_OPEN_WORLD.md §4.10](DESIGN_OPEN_WORLD.md).

## 8. What we are not building

- An open world where anyone can attack anyone.
- Pay-to-win: no selling of power, speed in fights, or protection that money alone can buy.
- Anything that collects a child's personal details.
