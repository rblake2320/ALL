# Player job board ("Odd Jobs") — owner direction 2026-11-12

> "a player is having a hard time keeping up a task and they can post jobs that other players can do … they invite the
> player to their home to do the task, like mow the yard or chop wood … real prices, nothing like $1, it has to match
> normal work … people could filter what shows on their feed … think bigger."

Status: **design only, nothing built; after Early Access 1** (out of EA1 scope per `docs/LAUNCH_PLAN.md`, 2026-11-13). Extends the private-homes/invites spec (DESIGN_HOMES_SOCIAL_COLLECTIONS §2,
W-066), the social feed (§5, W-069) and the online service (docs/systems/social.md, Phase 4). Proposed work ids:
W-160 (single-player townie board), W-161 (online board), W-162 (crews and contracts).

## 1. The loop in one paragraph
A household that is falling behind (lawn overgrown, firewood out, broken boiler, a pet that needs walking while the
zombies are at work) posts a **job**: what, where, when, how long, and the pay. Someone takes it, is let into that home
for that job only, does the work with their own zombie, and is paid from **escrow** when the work is done. The poster
gets the result (a mown lawn, a stacked woodpile, a fixed boiler) applied to their lot; the worker gets money, skill
XP, rank XP and reputation. Both sides win, and the money is earned, not given.

## 2. Ship it single-player first (W-160)
The online service does not exist yet and the COPPA rule keeps player data on the device until counsel signs off. So
the first version uses **townies** on both sides, entirely in the deterministic sim:
- **You hire:** post a job, a townie with the right skill takes it at the posted rate, walks to your lot, does the work
  with the same interaction the household would use, and is paid from escrow.
- **You work:** townies post jobs on the board; your zombie travels (Sol's walkable world) to their lot, does the work,
  gets paid. This is a new money source between career shifts and the first reason to walk the town.
- Every rule below (wage floor, escrow, reviews, filters) is built and tested here, so going online later changes who
  sits on the other side, not the rules.

## 3. Real prices (the wage floor)
Pay is checked against the game's own career wages ($15–$72/h across 25 career levels, `content/people/careers.ts`):
| Job tier | Floor | Ceiling | Examples |
|---|---|---|---|
| Chore | entry wage, **$16/h** | 3 × floor | mow, rake, chop wood, wash dishes, take out trash, feed pets |
| Skilled | median career wage at the needed skill level (~$28/h at skill 4) | 3 × floor | repair boiler, rewire, build a fence, cook for a party, tutor a skill |
| Expert | top-tier wage for that skill (up to $72/h) | 3 × floor | restore an antique, build a room, embalm (mortuary), train a guard pet |
- The board computes the floor from **tier × skill level × estimated hours** (each job type carries an hour estimate
  from its sim interaction). A post below the floor is refused with the floor shown ("Fair pay for this is at least
  $48"). There is no "$1 job".
- The ceiling stops money laundering between accounts (§8).
- Tips are allowed after the job, capped at 25 % of the pay.
- Pay is **in-game money only.** Never Bones, never Grave Gold, never anything bought with real money, and never a
  transfer between players that is not tied to finished work.

## 4. Job types (bigger than chores)
1. **Yard & house chores:** mow, weed, rake, chop wood, shovel the path, clean, laundry, trash.
2. **Repairs & trades:** fix appliances, plumbing, wiring, roof patch, paint a room; uses the build tiers. The sim has
   no Handiness skill today (skills: cooking, charisma, mortuary, logic, creativity, fitness): W-160 adds Handiness,
   and Gardening arrives with W-109; until then repairs key off logic.
3. **Building contracts:** build a fence, a deck, a room from the poster's blueprint (co-build permission, rank 30).
4. **Care:** pet-sitting (feed/walk/play while the household is at work), house-sitting during a trip, plant watering.
5. **Food & events:** cook a meal, cater a party, bartend, DJ, decorate before a party, clean up after it.
6. **Teaching:** a skilled zombie tutors yours (both gain XP; teacher paid). Mentors (progression §5) post these too.
7. **Errands across town:** fetch an item from the shop, deliver a crafted object, haul salvage with a vehicle.
8. **Gathering:** fish, forage, dig in The Underneath, collect grave goods for someone's collection.
9. **Crew contracts (W-162):** big jobs split into roles (2 builders + 1 electrician + 1 cook) that a crew/club takes
   as a team; pay shared by role.
10. **Standing work:** a recurring job (mow every Saturday) the same worker can keep; it becomes a regular client.
11. **Town boards:** NPC businesses and town projects (restore the chapel, clean the graveyard) post bigger jobs that
    many players chip in on; ties into side projects (progression §3).

## 5. How a job runs
1. **Post** (poster): pick the type and target (the lawn, the woodpile, a broken object), time window, pay (≥ floor),
   who may take it (§6), optional skill minimum. Pay moves into **escrow** at once, so the poster cannot spend it twice.
2. **Take** (worker): accept; the poster's home grants a **job pass**: that lot only, those objects only, that time
   window only, no build/buy, no access to other rooms' objects unless the job needs them.
3. **Work:** the worker's zombie travels and runs the real interaction. Online, the work runs in the worker's game
   against a snapshot and the result is sent back (§7).
4. **Done:** the result is checked against what was asked (lawn tiles mown ≥ 95 %, wood stacked = N logs, object
   condition repaired). Pass → escrow pays out, both leave a review. Fail or no-show → escrow returns to the poster;
   partial work is paid pro rata.
5. **Disputes:** automatic from the check result; no free-text arguing. Repeated disputes lower reputation (§8).

## 6. Who sees and takes it (feed filters)
Filters live in the feed sidebar and the board:
- **Who:** friends only / crew & club / my town / anyone (anyone is 15+ only, §9).
- **What:** job type, skill needed (and "only jobs I can do now"), pay range, pay per hour, duration, time window.
- **Where:** distance / travel time, this lot's district.
- **Trust:** poster rating, "regular clients first", hide posters I blocked.
- **Notifications:** per filter, with quiet hours (same settings as the feed's notification categories).
Saved filters are presets ("Weekend yard work near me, $20/h+").

## 7. Online model (W-161, Phase 4)
- **Asynchronous by default:** the poster does not need to be online. The worker visits a **snapshot** of the lot, the
  work runs in the worker's deterministic sim, and the result (a small, typed diff: tile states, object conditions,
  inventory deltas) is delivered to the poster's inbox and applied deterministically on their next load. The server
  validates the diff against the job (only the targeted tiles/objects, only the allowed change kinds).
- **Live visits** (both online) reuse the W-066 visit session.
- Escrow, payouts and reviews are server-authoritative; the client never mints money.

## 8. Abuse and economy guards
- Wage floor and ceiling (§3); daily caps on jobs posted and earned per household; no self-hiring (same account,
  device, or household cluster).
- Escrow-only payment, no direct transfers. Pay above the ceiling is refused, so the board cannot move wealth.
- Reviews are **preset tags** (on time, great work, left a mess, no-show), never free text.
- Reputation decays toward neutral; new accounts can take chores only until they have 5 good reviews.
- A worker can never take items, change build, or see other rooms' contents; a job pass expires on its own.
- Report and block from the job card.

## 9. Children (under 15) — hard rules
- Single-player townie board (§2): fully available.
- Online: **friends and crew only**, never "anyone"; presets only (no free-text job notes); no visits to or from
  strangers; and nothing goes online at all until the children's-privacy counsel sign-off (COPPA directive).
- Posting/taking is gated by the same consent state as other online features (D-082).

## 10. Rank gates (progression §2)
Rank 5 townie board (work for townies); rank 10 hire townies and online friends-only jobs (matches visitor invites);
rank 20 skilled/expert jobs and standing work; rank 30 building contracts and crew contracts (matches co-build);
rank 40 town boards in The Necropolis.

## 11. Acceptance tests (when built)
- Wage floor: every job type × skill level refuses pay below the floor and above the ceiling; control posts at the
  floor pass.
- Escrow: money leaves the poster at post time; cancel, no-show, fail, partial and pass each end with conserved money
  (sum before = sum after) across 1,000 random job lifecycles (fuzz), including crashes mid-job (save/load).
- Job pass: a worker zombie cannot use, move or sell any object outside the job (adversarial: try every interaction on
  every object).
- Result check: a half-mown lawn fails, a fully mown one passes; partial pay is pro rata.
- Determinism: same seed + same jobs → identical lot and money after 7 days; the online diff applied on the poster's
  side equals the worker-side result.
- Child profile: online filters never offer "anyone"; free-text fields absent.
