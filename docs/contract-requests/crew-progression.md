# Crew progression: building, upgrading and swapping a team of zombies over a forever game

Status: **proposal, nothing built.** Author: Fable 5.2 ZSM. For Claude Cloud to accept, change or reject. It joins
three existing documents and must not contradict them: `docs/DESIGN_PROGRESSION.md` (rank 1–100 then Reburial
prestige, level locks, household slots up to 8, recruiting townies), `docs/contract-requests/combat-power.md`
(power from play only, four stats, crew power with diminishing returns, matchmaking band), and
`docs/contract-requests/zombie-builder.md` (looks never touch power).

## 1. Owner direction (2026-11-12, verbatim)

> "having ways to add and upgrade players while you play or swap out but really high cost and there has to be
> rules like you want to build a team of solid zombies so you will want to upgrade as you play on but the game is a
> forever game so needs to have progression that matching that type of game"

## 2. What already exists on paper (do not redo)

- Household slots open with rank, up to 8 (`DESIGN_PROGRESSION.md` §2). Townies can be recruited or turned into an
  open slot (§4). Rank goes 1–100, then prestige tiers with no cap (§1).
- Each zombie has four combat stats 0–10 raised by play (Might, Grit, Reach, Cunning); crew power sums them with
  diminishing returns (`combat-power.md` §3.1).
- Fairness rule: bought things never give power (`combat-power.md` §3.4, decision D-006).

What is missing is the **team-building loop**: how a player chooses, grows, swaps and retires zombies over months,
what it costs, and what stops it from being trivial or pay-to-win.

## 3. Proposal

### 3.1 Roster and active crew

- **Roster:** every zombie the household has ever kept: the 8 household slots plus a **Crypt** (bench) that holds
  zombies not currently in the household. Crypt slots open with rank (start 2, up to 12).
- **Active crew:** up to 4 zombies chosen from the household for Frontier play (raids, defence, takeovers). The rest
  live their life-sim lives. Crew size is what crew power counts.
- Zombies in the Crypt keep their stats and do not age, earn or lose anything.

### 3.2 Getting new zombies (adding players)

| Way | Cost | Rule |
|---|---|---|
| Recruit a townie (exists on paper) | Bones + a relationship of at least "friend" | Starts at its own stats (townies have low, uneven stats) |
| Turn a townie (bite) | Bones + a cooldown of 7 game days per household | Starts at stat level 0; inherits one trait |
| Raise from a grave (new) | **Grave Goods** (rare, earned in raids, challenges, seasons) + Bones | Starts at level 0, rolls one trait from a visible list (no paid rerolls) |
| Create-a-Zombie | free for the first household, then a household slot only | Starts at level 0 |

New zombies always start weak. A strong crew is grown, never bought.

### 3.3 Upgrading (the long climb)

- **Stats** rise from play as `combat-power.md` §3.1 says. Each point costs more practice than the last
  (point 1 about an hour of play, point 10 about 40 hours), so a maxed zombie is a months-long project.
- **Perks:** each zombie gets one perk slot at level 3, a second at level 6, a third at level 9. A perk is a
  rule-bending bonus (e.g. "Night Owl: +1 Reach after dark", "Hoarder: carries two items"). Perks are learned
  from challenges and seasons and cost Grave Goods to slot. Max 3 per zombie, so specialists matter.
- **Mastery** after a stat reaches 10: further practice fills a mastery bar that gives cosmetic marks and a small
  capped bonus (+1 % per tier, cap +10 % on that stat). This is the forever part per zombie: there is always a next
  bar, but the gain shrinks so a veteran never becomes untouchable.
- **Upgrade costs are steep and earned:** Bones, Grave Goods and play time. **No real-money item raises a stat, a
  trait, a level, mastery or crew power** (keeps D-006 and the E10+/Teen question clean).

### 3.4 Swapping and retiring (high cost, with rules)

| Action | Cost | Rule |
|---|---|---|
| Move a zombie from household to Crypt or back | Bones, rising with the zombie's level | Once per game day per zombie |
| Change the active crew | free outside Frontier time | **Locked for 24 real hours after any raid or defence the crew joined**, and locked while a home of yours is under attack. No swapping in the middle of a fight |
| Retire a zombie for good ("Final Rest") | free | Returns 25 % of the Grave Goods spent on it; its name goes on the household's memorial wall; cannot be undone |
| Trade or gift a zombie to another player | **not allowed** | Keeps power unbuyable and stops account farming |

### 3.5 Rules that keep a forever game fair

1. **Crew power has a soft cap per rank band.** A crew's power above the cap for the player's rank counts at 25 %,
   so leveling the household (rank) and leveling the crew move together.
2. **Matchmaking uses the band** (`combat-power.md` §3.1), measured on the crew that was locked in, not on the
   roster.
3. **Death costs time, not the zombie** (as in `combat-power.md` §3.3); permanent loss only by Final Rest, which the
   player chooses.
4. **Seasons** (about 10 weeks) add new traits, new Grave Goods sources and a season track. Season rewards are
   cosmetic or Grave Goods; they never reset anyone's stats.
5. **Catch-up:** a household below the median power for its rank earns practice 50 % faster, so returning or new
   players can field a solid crew within weeks, not months.
6. **Home mode players** (children and anyone not opted into Frontier) still grow their zombies' life skills and
   collect looks; the combat stats simply stay unused. Nothing in Home mode is behind Frontier.

### 3.6 Looks, and how this meets the Zombie Builder

A zombie's looks (body, premium body, wound parts, palette, saved looks: `zombie-builder.md`) are separate from its
stats and traits, as in DC Universe Online, where appearance is collected and applied independently of gear. Paid
items in this game are looks only.

## 4. Decisions (all four accepted by the owner, 2026-11-12)

1. **Currency for upgrades:** this proposal uses only earned currency (Bones, Grave Goods, time). Selling upgrades
   for money would make the game pay-to-win and breaks D-006 and combat-power §3.4. Confirm.
2. **Crew size 4** and **Crypt up to 12**: right numbers?
3. **Final Rest is permanent:** confirm a zombie can be lost for good only by the player's own choice.
4. **The 24-hour crew lock** after a fight: right length?

## 5. Acceptance checks (with the code)

| ID | Check |
|---|---|
| CP-1 | No purchasable SKU changes any stat, trait, mastery, level or crew-power number (exhaustive over the catalogue) |
| CP-2 | A new zombie from every source starts at or below level 1 |
| CP-3 | The active crew cannot change during a fight or within 24 h after one; the lock survives save and reload |
| CP-4 | Crew power above the rank-band cap counts at 25 % |
| CP-5 | Zombies cannot be traded or gifted by any route |
| CP-6 | A season reset never lowers a stat |
