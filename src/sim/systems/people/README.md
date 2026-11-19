# SIM-PEOPLE — social, careers, townies, aspirations, events

Owner: SIM-PEOPLE (`src/sim/content/people/**`, `src/sim/systems/people/**`, `tests/unit/people/**`).
Exports: `peopleContent: ContentModule` (`src/sim/content/people/index.ts`), `peopleSystems: SimSystem[]` and the
factory `createPeopleSystems()` (`src/sim/systems/people/index.ts`). Every id below is a constant in
`src/sim/content/people/ids.ts` — content and systems import from there, never from string literals.

Design numbers come from `docs/GDD.md` §8–§13; semantics follow `src/sim/engine/README.md`.

---------------------------------------------------------------------------------------------------------------------

## 1. Systems (registration order = tick order)

| id | hooks | owns |
|---|---|---|
| `social` | init(false): housemates start met + friendship 30 · dayStart: relationship drift · hour: Lonely | behaviour `social`, SocialApi |
| `careers` | init: repair careers · tick: shift scheduling + at-work simulation · hour: at-work mood samples · dayStart: shift status, Monday sick-day reset | behaviour `career`, effect `careerChoice`, requirements, condition `careerLevel`, CareersApi |
| `townies` | init: generate 24 townies (idempotent) · tick: arrivals (each game minute), visitor supervisor, party scoring · hour: walk-bys + drop-ins · dayStart: housekeeping · agentLeft: clear visit state + doorbell schedule · autonomyCandidates (extra Welcome, emergency pizza) | behaviours `phone`, `visit`, requirement `noPartyActive`, TowniesApi |
| `aspirations` | init: field repair · hour: freshness sample + milestone check · dayStart: close the freshness day | effect `addVitality`, aspiration conditions, AspirationsApi |
| `events` | hour: full moon + life events · dayStart: lovesick · moodModifiers | life-event effects + conditions |

**Api binding** (CONTRACTS.md resolved decision #1): every api method takes the `SimContext` the engine appends as the
LAST argument (`makeApi` in `util.ts`). Without it (direct calls, tests) the context bound by the system's latest hook
is used. Every api method is fault-contained (a throw returns its fallback; junk ids return `null` / `[]` / a reason).

## 2. Behaviours

| key | interactions | semantics |
|---|---|---|
| `social` | all 24 `social_*` + hidden `social_feralNibble` | `available`/`begin`/`startStage` run the gates (§5). Outcome rolled ONCE at `startStage` with `ctx.rng` (`run.data.success`, `run.data.chance`); deltas/moodlets/outcomes applied ONCE at `completeStage` (or at `end('canceled')` if the reaction already played — the joke landed). `tick`: alternating voice babble every 2 min, target reaction at 60 % (bubble/voice/sfx/fx; target `failAnim` on failure; unlinked targets turn and react in place). `adjustScore`: see §5.3. |
| `phone` | all 6 `phone_*` | `params.action` = invite / party / pizza / findJob / quitJob / callInSick. Validated in `available` + `begin`, executed at `completeStage` (idempotent, `run.data.done`), failures → `bad` notification (quiet for autonomous runs). `choices`: invite → every townie, acquaintances first (`params.townieId`), findJob → the 5 careers (`params.careerId`); other actions return `[]`. Label: "Order Brain Pizza ($35)". Pizza calls `ctx.sys('food').orderPizza(actorId)` and stamps `people:pizza:lastOrder`. `adjustScore`: every call is vetoed except the **emergency pizza** (§5.3). |
| `career` | `career_goToWork` | `begin` refuses when there is no pending shift or the 60-min grace passed. `completeStage` (at the lot exit) → `markDeparture`; `end('complete')` → `despawnAgent(id, 'atWork')`. |
| `visit` | `visit_walkBy`, `visit_linger`, `visit_waitAtDoor`, `visit_leave` | walkBy end(complete) → despawn off-lot · linger ends a minute after nobody is waving at them · waitAtDoor rings the doorbell on a per-visit schedule (on arrival at the door, then every 20 min, max 3 within the visit's first hour; kept in `people:bell:<id>` so a wait the engine re-queues after a social neither rings at once nor resets the cap) and finishes when welcomed/leaving; a re-queued wait of an already-welcomed visitor is refused in `begin`/`startStage` (pre-welcomed party guests carry `params.greet` and walk up once) · leave end(complete/failed) → despawn off-lot (canceled = moved in). |

## 3. Effects

| id | params | semantics |
|---|---|---|
| `careerChoice` | `{ perf?, funds?, hunger?, energy?, fun?, social?, hygiene?, preservation?, xp?, skill?, moodlet?, text?, chance?, fail<Key>?…, agentId?, careerId?, safe? }` | Work-event option. `chance` makes it a gamble (`fail*` keys apply on a loss). Funds > 0 earn / < 0 spend, idempotent per choice id (`careerChoice:<choiceId>:funds`; "couldn't afford" note if broke). Re-reviews promotion/firing when not at work. |
| `addVitality` | `{ amount = 20, agentId? }` | Second Wind: vitality += amount (20..100), moodlet `secondWind`. |
| `event_neighbourComplains` | `{ friendship = −8 }` | a reeking household member (outdoors first) loses friendship with a random townie; `smellShamed`. |
| `event_lottery` | `{ amount = 500 }` | earn (key `lottery:<tick>`), `lotteryWinner`. |
| `event_fanLetter` | `{ min = 5, max = 25 }` | earn (key `fanLetter:<tick>`), `fanMail`, witty fan line. |
| `event_chainLetter` | `{ forward: boolean, agentId? }` | choice option: forward → `chainLetterSpread`, up to 3 met townies −1 friendship; bin → 50 % `cursedChainLetter`. |
| `event_ravenThief` | `{ min = 10, max = 40 }` | spend min(roll, funds) (key `raven:<tick>`), `outwittedByBird`. |
| `event_graveRobber` | `{ maxValue = 300 }` | removes one outdoor floor object worth < maxValue (never mailbox/doors/windows/in-use), `robbed`. |

## 4. Requirements and condition kinds

Requirements (all accept `params.reason`): `hasCareer`, `noCareer`, `sickDayAvailable` (≤ 3/week, a pending shift,
before start + 60 min), `noPartyActive`.

Condition kinds (engine kinds `funds`, `skill`, `stat`, `and/or/not`, … are reused, never re-registered):

| kind | params | true when |
|---|---|---|
| `careerLevel` | `{min}` | agent's career level ≥ min |
| `friends` | `{min, minFriendship = 35}` | met non-service agents with friendship ≥ minFriendship (or best friends) ≥ min |
| `relationshipFlag` | `{flag}` | `kissed` (stat `kisses` > 0, ever) · `partners` (partners/engaged/married) · `engaged` · `married` · `bestFriends` |
| `romanceMax` | `{min}` | highest romance with anyone ≥ min |
| `skillsAtLevel` | `{count, level}` | number of skills ≥ level ≥ count |
| `freshStreak` | `{days, min = 70}` | consecutive closed days whose every hourly household-average freshness sample was ≥ 70 |
| `clockBetween` | `{from, to}` | hour in [from, to) (wraps midnight; from = to → always) |
| `lotHasTag` | `{tag, min = 1}` | ≥ min non-broken objects with the tag |
| `noOutdoorLight` | `{}` | no lit light (`light` tag; powered if it needs power; `data.on !== false`) outdoors |
| `reekingOutdoors` | `{}` | an on-lot household member with hygiene 0 stands outdoors |
| `householdHome` | `{min = 1}` | household members on the lot ≥ min |
| `eventCooldown` | `{id, hours}` | life event `id` hasn't fired for `hours` (stamp `people:ev:<id>`) |

## 5. Social rules

### 5.1 Success chance (GDD §9)
`base + 0.03 × charisma + (actorMood + targetMood)/400 + friendship/400 + Σ actor TraitDef.socialBonus
+ params['actorTrait.<id>'] (actor has trait) + params['targetTrait.<id>'] (target has trait)
− 0.25 if actor hygiene < 15 (unless target Slob) − 0.2 if target mood ≤ −50`, clamped 0.05..0.95.
`baseChance ≥ 1` (Welcome In) always succeeds. Trait params shipped: mean socials Grumpy +.15 / Hothead +.20,
joke Cheerful +.15 / Grumpy target −.25, Compliment Their Decay Vain target +.20.

### 5.2 Gates (`checkGates`)
`params.gate` met (default; `params.autoIntroduce` on Groan Small Talk / Gross Joke / Compliment Their Decay lets them
double as the introduction with a stranger — "auto first interaction": met + 3 friendship, stat `townsfolkMet`) / notMet
(`social_introduce` is hidden from menus but autonomous) / visitor / visitorWaiting / walkBy; `SocialDef.status` notPartnered (pair not a
couple and neither already spoken for) / partners / engaged / married / partnersOrMore / notMarried; outcome gates
(bestFriends once; moveIn: household actor, townie target, friendship ≥ 50 or a couple, household < 8); service NPCs,
off-lot or missing targets and self are refused. min/max friendship + min romance are left to the engine menu
(greyed with a reason) but re-checked at begin/startStage.

### 5.3 Autonomy shaping (`adjustScore`, advertise)
Advertise: non-hosting socials promise a conversation's Company (`advertise.social` = 2 × the +8 per-social gain,
`SOCIAL_AD_CONVERSATION`) so a lonely zombie's chat can compete with flat GDD desirability bonuses (+40 cleaning,
+30 mirrors); hosting socials keep the honest +8. Guards (return 0): the target is heading for the carpool
(`career_goToWork` active/queued) or is a leaving guest; another agent is already doing the same hosting duty
(welcome / wave over / invite to stay / ask to leave) to that guest.
+ max(minFriendship, minRomance)/10 (relationship ladder: the most intimate allowed social wins ties) · × 0.7 when
it would repeat the pair's previous social (`people:last:<pairKey>`) · non-hosting socials × clamp((100 − appetite)/40, 0, 1) where appetite = Company, or min(Company,
Amusement) for socials that promise fun (a bored zombie still jokes; personality picks WHICH social, not WHETHER) ·
no autonomous romance with someone else's partner (−25), couples +8, romance < 10 −6 · mean socials −15 vs friends
and × 0.3 within 12 h of the pair's last mean social · × 0.3 when the target is in crisis (a need ≤ 15 / feral) ·
× 0.5 when the target is walking somewhere · Welcome +wait/3 (max +20), other socials −10 with an unwelcomed guest ·
guests' introductions +5 · Loners −10 for Wave Over. Hosting socials = welcome, waveOver, inviteToStay, askToLeave and
introductions to guests.

### 5.4 Outcomes
Deltas: friendship [ok, fail]; romance gains × max(actor, target) Π romanceMult (Hopeless Romantic 1.5), losses
unscaled; clamp −100..100 / 0..100; social need +8 both (half on failure); fun on success; charisma xp 6; shareRecipe
+10 cooking xp to target; `kiss: true` → stat `kisses` (both), `firstKiss` + "First kiss!" notification once; household
participants' aspiration milestones are re-checked right after every social. Special outcomes: introduce (met
always), bestFriends, bite (target preservation −2 raw always; success fun +10 + `nibbled`, failure `bitten`),
becomePartners (`itsOfficial`, clears `lovesick`), propose (`engaged`), marry (married, `newlyweds` 3 days, stat
`marriages`, a townie spouse moves in if there is room), moveIn (`joinHousehold`: role household, memberIds, visit/walkBy
cleared, aspiration assigned if none, `movedIn`/`newRoommate`), breakUp (`heartbroken`), askToLeave
(`sendVisitorHome`), inviteToStay (leaveTick +3 h, at most 8 h ahead), welcome (`visit.welcomed`, met), waveOver
(walker → visitor heading for the door). Daily drift (dayStart, once per day): friendship → 0 by 1/day (2 if ≥ 60)
without interaction for 24 h; romance −2/day without romantic interaction (stamp `people:rom:<pairKey>`); best friends
lost below 0.

### 5.4b Feral nibble (GDD §3, backlog #14)
`social_feralNibble` (`CRITICAL_SOCIALS`, outside the §9 table; `hidden`, `autonomous: true`, never in menus, never
player-queued) — gate `feral`: the actor must be feral (hunger ≤ 5), the target not a walk-by, and the actor's
`people:nibble:<id>` cooldown (180 min, stamped when the bite starts — a dodged bite counts) must have expired.
Tagged `feralFallback` (the engine's `FERAL_FALLBACK_TAG`): the engine's feral override only considers it when no other
food candidate is valid (no reachable fridge / meal / leftovers / emergency pizza). Advertises hunger 30; 4 minutes;
base chance 0.75 (+ the mean-social trait modifiers); friendship −20 / −12 on the pair (shared, so both ways); no
Company or charisma for anyone; `adjustScore` passes it through untouched (no Company appetite / relationship
shaping). Success: target preservation −3 (raw), biter hunger +12 (5 → 17: still feral, still hunting for real food),
target `chewedOn` (−14, 8 h); always: biter `feralRemorse` (−6, 6 h), stat `feralNibbles` (global + biter), a `social`
notification ("Mort bit Ghoulia!" / "Mort lunged at Ghoulia"). Sleeping / passed-out / feral / busy-critical targets
are refused by the engine's social checks.

### 5.5 SocialApi (+ extras)
`relationships(agentId)` → met (or non-zero) relationships, service NPCs excluded, couples first then friendship ·
`label(a, b)` (Stranger/Acquaintance/Friend/Good Friend/Best Friend/Disliked/Nemesis, "· Crush" at romance ≥ 30,
Partner/Fiancé(e)/Spouse) · `friendCount(agentId, min?)` · `maxRomance(agentId)` · `partnerOf(agentId)` ·
`chance(actorId, targetId, interactionId)`.

## 6. Careers (GDD §10)
- A shift belongs to the day it starts on. T−60: "Carpool soon" notification + soft honk. T−30: honk + puff fx at the
  curb, `flags['people:carpool:until']` (renderer hint: show the hearse while `> tick`), `career_goToWork` queued at
  system priority (front); a sleeping zombie (sleep tag/anim, not passed out) is interrupted. Re-queued at most every
  10 min if cancelled. Not departed by start + 60 → missed (−25, streak +1). Crumbled/away zombies are excused.
- Departure: status atWork, `shiftStartTick` = official start, mood sample, penalties recorded (preservation < 30 →
  −10, hygiene < 20 → −6), 25 % chance of a work event between start + 1 h and end − 1 h, `firstDayJitters` on the
  first ever shift.
- At work (presence atWork, the engine doesn't touch them): hunger −4, energy −5 (was −6: 21-day balance pass, docs/BALANCE.md), fun −2 (was −4: backlog balance
  lever "careers' away-rate for fun", see GDD §10), hygiene −3 per hour (× difficulty), social +3; preservation is left to HOME's `decay` system (which ticks atWork zombies) and only applied
  here at 1.3 × preset × traitMult('decay') when no decay system exists. Hourly mood samples.
- Shift end: spawn home, pay `wage × hours × worked fraction` (late arrivals prorated) with key
  `career:pay:<agentId>:<day>` (idempotent), performance `+ (8 + moodAvg/10 + 2 × min(4, skill/levelReq)) ×
  traitMult('careerPerf')` (gain only; Ambitious 1.25 implements the GDD "+3") − penalties − 3 if late; moodlets
  `goodDayAtWork` (≥ +15) / `badDayAtWork` (≤ +3); stats `shiftsWorked`, `wagesEarned`.
- Review: ≥ 100 → promotion if the level's `promoteReq` skills are met (level +1, performance 20, `promoted`, event
  `promotion`, sfx), else capped at 100 with a one-time "needs Skill N" note; ≤ −80 or 3 missed in a row → fired.
- Sick days: ≤ 3 per week (reset Monday), −5 performance, `playingHooky`, cancels the carpool.
- CareersApi: `view(agentId)` (status text: at work until …, carpool waiting, next shift, day off, sick, missed) ·
  `available()` · `join(agentId, trackId)` (first shift skipped if its carpool time already passed) · `quit(agentId)`
  (not while at work) · extras `callInSick(agentId)`, `nextShiftTick(agentId)`.

## 7. Townies, visitors, parties (GDD §11)
- 24 townies generated once from `state.seed` with a private RNG (cast independent of other systems' draws): unique
  names, palette appearance, 3 non-conflicting personality traits, occupation, a few skill levels, vitality 80–100.
  Flag `people:townies:generated`. Loading a save without townies generates them once.
- Arrivals are flags `people:arrive:<id>` (tick) + `people:arriveWhy:<id>` (invited | dropIn | party | walkBy),
  processed each game minute. Visitors get `visit` (2–4 h; party guests until the party ends; party guests
  pre-welcomed), refreshed needs and re-attached limbs, then `visit_waitAtDoor` on the outdoor tile of the door closest
  to the street. Walk-bys get `walkBy` (entry point → farthest entry point) and `visit_walkBy`.
- Hourly: walk-bys 07–22, 20 % when fewer than 2 visitors/walkers + pending; drop-ins 10–21, 4 % per friend
  (friendship ≥ 35) with someone home, max 3 guests + pending, not during parties. A townie isn't reused within 6 h
  (walk-by) / 12 h (drop-in).
- Supervisor (every tick): walkers despawn at the far end / after 90 min and are re-queued if interrupted; visitors
  leave at leaveTick, at the 01:00–06:00 curfew (not party guests), when miserable (mood ≤ −50, friendship −3), or when
  left on the doorstep for 60 min (invited: 90 min, friendship −3); leaving visitors are force-despawned after an hour;
  stray townies are sent home. Household autonomy gets an extra Welcome candidate after a 10-minute wait.
- Emergency pizza (`phone_orderPizza` is the one autonomous phone call, advertised as a 50-hunger meal and offered
  through autonomyCandidates): only for an on-lot household zombie at Appetite ≤ 35 (or feral) when the household has
  $35, no order went out in the last 3 h (`people:pizza:lastOrder`, also stamped by player orders) and the lot has
  nothing else to eat (`foodOnLot`: no working powered fridge/microwave, no unspoiled meal/pizza with servings) — e.g.
  the kitchen burned down or the power is cut. Otherwise the household starved with money in the bank.
- Invitations: acquaintances accept at 0.55 + friendship/150, strangers are a cold call at 0.35 (Loner −.15, Social
  Butterfly +.1, clamp 0.2..0.95); after 23:00 / before 07:00 "too late"; arrival in 20–60 min. The phone menu lists
  acquaintances first, then strangers ("cold call").
- Walk-bys stop (`visit_linger`, up to 20 min) while someone is waving at them; Wave Over is performed from the yard
  (`tileNear` radius 5, agentAdjacent fallback) without `engine_respond`.
- Parties: host needs Amusement ≥ 30; visitors already present join; up to 6 guests total — the player's pick
  (`params.guests` 'a12,a15') or friends, then acquaintances, then strangers — arrive over 60 min; every 15 min score sample = 0.45 × guests' (mood+100)/2 + 0.25 ×
  guests' fun + 15 music (a powered stereo in use or `data.playing/on`) + 10 food out (meal/pizza with servings) ×
  host traitMult('partyScore'), running average; after 4 h: ≥ 70 `legendaryParty` (household + guests), ≤ 30
  `lameParty`, else `goodHost`; host↔guest friendship +10/+4/−3; stats `partiesThrown`, `legendaryParties`,
  `lameParties`; music events party → normal/sad; guests trickle out.
- TowniesApi: `list(forAgentId)` (met first, friendship desc; `available` = off-lot and not on the way) · `party()` ·
  `createService(kind)` ('pizza' | 'repo', anything else → pizza; idle service agents of that kind are reused) ·
  extras `invite(actorId, townieId)`, `throwParty(hostId)`, `endParty()`.

## 8. Aspirations + rewards (GDD §12, §8)
Milestones are checked hourly and right after promotions/parties; each completes once (out of order allowed), adds its
points, stat `milestones`, `milestone` event, sfx + sparkle, notification ("Aspiration complete!" when all are done).
`buyReward(agentId, rewardId)`: household + living only; trait rewards once (Already owned) into `rewardTraits`;
consumables run their effect (Second Wind refused at vitality 100); "Needs N more aspiration points".
Extras: `check(agentId?)`, `freshStreak()`.

## 9. Life events, moon, trait moods (GDD §13, §2, §8)
- The `events` system runs EVERY `LifeEventDef` in the registry hourly: condition → `hourlyChance` → effect or choice
  (bound to a random home member, 2 h expiry, default = option with `params.safe`). People ships: neighbour complains
  (reeking outdoors, 30 %/h, 12 h cooldown), lottery (mail time, 1 %/day), fan letter (10 %/day), chain letter choice
  (8 %/day), raven (07–19, 2 %/h, 48 h), grave-robber (03:00, 4 %, no outdoor light, 72 h).
- Full moon (time.fullMoon): `moonstruck` for home + at-work members until 06:00, once per night.
- Hopeless Romantics without a partner for 7 daily checks get `lovesick` (until partnered); once per day.
- moodModifiers (labels/values from the modifier-only moodlet defs): Night Owl +8 night / −5 day · Vain freshness ≥ 80
  +10 / < 40 −12 · Loner −5 with ≥ 4 agents in the same indoor room · Social Butterfly +8 during a party.

## 10. Trait hooks for other modules
Mult keys: `limbLoss` (clumsy 2, ironStitches 0), `fireChance` (clumsy 1.5), `decay` (wellPreserved 0.7), `spoilSick`
(castIronStomach 0), `careerPerf` (ambitious 1.25), `partyScore` (partyAnimal 1.15), `nightEnergyDecay` (nightOwl 0.8),
`moodletDuration:furious` (hothead 2), `breakChance` (clumsy 1.25); optional HOME multipliers `tvFun`/`napFun` (lazy
1.3), `readingFun` (bookworm 2), `danceFun`/`partyFun` (partyAnimal 1.5), `paintingFun` (artistic 1.5), `embalmOther`
(squeamish 0.7), `stenchMood`/`messMood` (slob 0, neatFreak messMood 1.5). Loner tagAd `social` −3 (needs company less, not never — −10 kept a
household of Loners at Company 0), `party` −30. tagAd keys: cook, eat, clean (slob −1000),
mirror, tv, nap, exercise, read, paint, dance, party, social, embalm. HOME implements the hasTrait-only effects (Gourmand
eating fun, Neat Freak mess moodlet, Clumsy laughing at limb loss, Squeamish horror).

## 11. Persistent data
Only WorldState fields: agents (`career`, `visit`, `walkBy`, aspiration fields, `rewardTraits`), relationships,
stats, party, choices and `flags` under the `people:` prefix: `townies:generated`, `arrive:<id>`, `arriveWhy:<id>`,
`lastVisit:<id>`, `leavingSince:<id>`, `car:{notified,honked,requeue,arrive,pen,event,departing,capNote}:<id>`,
`carpool:until`, `rom:<pairKey>`, `mean:<pairKey>`, `last:<pairKey>`, `driftDay`, `fresh:{init,dayOk,samples,day,streak}`, `ev:<eventId>`,
`moon`, `single:<id>`, `lovesickDay`, `bell:<id>`, `pizza:lastOrder`, `nibble:<id>`. Stale entries are pruned (bell when the visitor
leaves, lastVisit > 2 days, mean > 2 days, rom after 30 days at
zero romance, leavingSince when off-lot).

Stats written: `feralNibbles` (global + biter), `partiesThrown`, `legendaryParties`, `lameParties` (global + host), `kisses`, `socials`,
`townsfolkMet`, `shiftsMissed`, `milestones` (per agent), `marriages`, `promotions`, `firings`, `shiftsWorked`,
`wagesEarned` (global + per agent), `breakUps`, `townieVisits`, `movedIn`, `lifeEvents` (global). Read from HOME:
`paintingsSold`, `embalmedOthers` (per agent).

## 12. Content
Traits (18 + 5 reward), careers (5 × 5 + 3 work events each), aspirations (5) + rewards (6), names (146 first, 90
last, 40 occupations + service NPC names), 6 life events, 54 moodlets, 24 socials (+ the hidden feral nibble), 6 phone + 5
system interactions.
SkillDefs are ENGINE-owned (CONTRACTS.md decision #8); people only grants xp and reads `ctx.content.skills` names.
