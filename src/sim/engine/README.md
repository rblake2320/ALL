# SIM-ENGINE — semantics reference (for SIM-HOME, SIM-PEOPLE, GAME, UI)

Owner: SIM-ENGINE (`src/sim/engine/**`, `src/sim/index.ts`). This file is the contract for everything the engine
implements on top of `src/sim/contracts.ts` + `src/sim/vocabulary.ts`. If something here disagrees with those files,
the contract files win and this file is a bug — tell SIM-ENGINE via `docs/contract-requests/`.

Units: 1 tick = 0.25 game minutes (`TICK_MINUTES`); all `*PerHour` rates are per game hour; durations are game minutes.
Facing: radians, 0 = +Z, `dirToFacing(x, z) = atan2(x, z)`.

---------------------------------------------------------------------------------------------------------------------

## 1. What the engine registers

### 1.1 Interactions (`ENGINE_INTERACTIONS`, content module id `engine`)
| id | targetKind | semantics |
|---|---|---|
| `engine_goHere` | tile | Walk to the tile (nearest walkable if blocked). Completes on arrival. Player only. |
| `engine_respond` | agent | Hidden partner half of every agent-target **social**. Stage `here`, open-ended; anim = actor def `social.targetAnim` (fail anim on failure is the social system's business); faces the actor every tick. Ends when the actor's social ends. `params.partnerId` = the actor. Never queue it yourself. |
| `engine_passOut` | self | Critical override at energy <= 0 (household only). Stage 0: `collapse` 0.75 min; stage 1: anim `sleep` on the floor, energy +6/h, `stopWhen energy >= 40`. Sets `status.passedOut` while running. Moodlet `sleptOnFloor` on completion. Uninterruptible, tags `['sleep']`. |
| `engine_exitLot` | self | Walk to the nearest entry point (stage `{kind:'exit'}`), then `despawnAgent(id, params.presence)`. Used by `ctx.sendOffLot`. If the exit is unreachable the agent is despawned anyway (never stuck on the lot). Uninterruptible and not player-cancellable; a cancel from a system (`ctx.interrupt`, build mode, a critical override) only restarts the walk, so `sendOffLot` always ends with the agent off the lot. |
| `engine_idle_stretch` | self | anim `stretch` 0.75 min. |
| `engine_idle_groan` | self | anim `groan` 0.75 min, voice `groan`. |
| `engine_idle_wander` | self | Walk to a random free tile within 4 tiles (`tileNear` of actor), anim idle 0.5 min. |
| `engine_idle_phone` | self | anim `phone`, carry `phone`, 3 min, fun +4/h. Needs 1 arm. |
| `engine_idle_yawn` | self | anim `yawn` 0.5 min. |

All idles are `hidden`, `playerAllowed:false`, `autonomous:false` (the autonomy idle path picks them explicitly).

### 1.2 Moodlets (engine)
| id | mood | duration | notes |
|---|---|---|---|
| `sleptOnFloor` | −10 | 360 min | after `engine_passOut` completes |
| `feralHunger` | −10 | until removed | while `status.feral` (added at hunger <= 5, removed at hunger >= 20) |

### 1.3 Skills
The engine content module defines the six `SkillDef`s (`SKILL_IDS`) with GDD §7 `xpPerLevel`
`[100,150,220,300,400,520,660,820,1000,1200]` and SIM-PEOPLE's flavour text (binding decision #8: SkillDefs are
ENGINE-owned). **Do not redefine skills** in home/people content (a later module that does is accepted as an
override but reported by `loadContentFrom` as a problem, which fails `validateContent`).

### 1.4 Behaviours
`standard` (no hooks) is the default when `InteractionDef.behavior` is omitted. Engine-internal keys used only by the
engine's own interactions: `engine_respond`, `engine_passOut`, `engine_exitLot`. Every other behaviour key must be
registered by a system (`SimSystem.behaviors`), otherwise `validateContent` reports it and the interaction fails at
runtime with "Something went wrong" (fault logged).

---------------------------------------------------------------------------------------------------------------------

## 2. Effects (`ENGINE_EFFECTS`) — `ctx.runEffect({id, params}, ec)`
`who` defaults to `'actor'`. "target agent" = `ec.targetAgent` (social/agent target); "target object" = `ec.targetObject`
(the **current stage's** object, else the queued target object). Text placeholders `{actor} {target} {object} {amount}`
are substituted in `notify` title/text.

| id | params | semantics |
|---|---|---|
| `needs` | `{deltas, who?, raw?}` | `ctx.changeNeed` per need (trait multipliers unless `raw`). `who:'both'` allowed. |
| `moodlet` | `{id, who?, chance?, durationMin?}` | `who: actor/target/both`; `chance` rolled once via `ctx.rng`. |
| `removeMoodlet` | `{id, who?}` | |
| `xp` | `{skill, amount, who?}` | `ctx.addXp` (trait `skillGain` applied). |
| `spend` | `{amount, reason}` | Inside a run: idempotency key `run:<origUid>:<stage>:<s|c>:<effectIndex>:spend` (`origUid` survives suspension/re-queue); **insufficient funds fails the interaction with "Can't afford"**. Outside a run: `choice:<choiceId>:spend` for choice options, else `params.key` if given. |
| `earn` | `{amount, reason}` | Same keying as `spend`. |
| `notify` | `{kind, title, text}` | Notification bound to the actor + target object. |
| `bubble` | `{icon, style?, who?}` | style default `thought`. |
| `fx` | `{kind, who?}` | `who:'object'` uses the target object. |
| `sfx` | `{id}` | positioned at the actor (or target object if no actor). |
| `voice` | `{emotion, who?, durationMs?}` | default 1200 ms. |
| `spawnItem` | `{defId, at, data?}` | `actorSurface/targetSurface` → `placeItemNear` (surface within 3 tiles, else floor); `actorFloor/targetFloor` → floor near; `held` → spawned into the actor's hand (anything already held is dropped to the floor). `data` values `'$tick'` → current tick, `'$actor'` → actor id, `'$target'` → target agent id. The new object id is written to `run.data.spawnedId`. No room anywhere (packed lot) fails the run with "There's no room to put the {item} down" (gameplay, not a fault). |
| `removeTarget` | `{}` | `ctx.removeObject(targetObject)`; other zombies using it fail with "The {object} was used up". |
| `releaseHeld` | `{to}` | `'destroy'|'floor'|'surface'`. |
| `holdTarget` | `{}` | Pick up the target loose item (fails the run with "Can't pick that up" if it is not loose). |
| `setTargetData` | `{key, value}` | JSON value; bumps `rev`. |
| `incTargetData` | `{key, amount}` | numeric add (missing → 0). |
| `breakChance` | `{chance?}` | default = target `ObjectDef.breakChance`; × actor `traitMult('breakChance')`. On break: `condition.broken = true`, notification "X broke!", fx `smoke`. |
| `repair` | `{}` | `broken = false`, notification. |
| `stat` | `{key, amount?, perAgent?}` | `perAgent` → keyed by actor. |
| `carry` | `{item}` | visual carry only. |
| `clearDirt` | `{}` | target `condition.dirt = 0`. |
| `queue` | `{interactionId, target, source?, front?, params?}` | `target: 'self'|'stageTarget'|'queuedTarget'`; source defaults to the run's source. |
| `leaveLot` | `{presence}` | `ctx.sendOffLot(actor, presence)`. |

Unknown effect ids are logged as faults (`where: 'effect:<id>'`) and skipped. An effect that **throws** inside a run
aborts that run (outcome `failed`, reason "Something went wrong"); outside a run it is logged and swallowed.
Lookup order: engine effects, then system effects (system ids must not collide with engine ids).

## 3. Requirements (`ENGINE_REQUIREMENTS`) — return `true` or a player-facing reason
| id | params | reason when failing |
|---|---|---|
| `power` | — | "The power is out" (utilities off) / "{Object} is broken" (needsPower object broken) |
| `notBroken` / `broken` | — | "{Object} is broken" / "It isn't broken" |
| `skill` | `{skill, min}` | "Needs Cooking 3" |
| `funds` | `{min}` | "Needs $40" |
| `arms` / `legs` | `{min}` | "Needs an arm" / "Needs 2 arms" / "Needs a leg" (functional = `ok` or `prosthetic`) |
| `tagOnLot` | `{tag}` | "Needs a fridge" (some non-broken object with the tag on the lot) |
| `trait` / `notTrait` | `{id}` | "Requires Neat Freak" / "Neat Freak zombies won't" |
| `household` | — | "Household only" |
| `targetHousehold` / `targetNotHousehold` | — | "{Target} isn't family" / "{Target} already lives here" |
| `targetVisitor` / `targetWalkBy` | — | "{Target} isn't visiting" / "{Target} isn't walking by" |
| `needBelow` | `{need, max}` | "Not hungry" / "Not tired" / "Already fresh" / "Not lonely" / "Not bored" / "Already clean" |
| `needAbove` | `{need, min}` | "Too hungry" / "Too tired" / "Too rotten" / "Too lonely" / "Too bored" / "Too smelly" |
| `outdoors` / `indoors` | — | target object's tile (else actor's tile): "Must be outdoors" / "Must be indoors" |
| `notCarrying` | — | "Hands are full" |
| `carrying` | `{item?}` | "Not carrying anything" / "Not carrying a plate" |
| `targetData` | `{key, equals?, min?, max?, truthy?}` | "Not available" (or `params.reason` if given) |
| `hourBetween` | `{from, to}` | "Only between 10 AM and 9 PM" (wraps midnight; `from==to` = always) |
| `notSelf` | — | "Can't do that to yourself" |
| `targetOnLot` | — | "{Target} isn't here" |
| `targetAwake` | — | "{Target} is asleep" / "{Target} is away" |

Every requirement also accepts `params.reason` to override the message. Unknown ids → fault logged, treated as
**unsatisfied** ("Something went wrong").

## 4. Conditions (`ctx.evalCondition`)
Engine kinds: `always`, `never`, `funds {min}`, `skill {skill, min}` (agent), `stat {key, min, perAgent?}`,
`moodlet {id}`, `trait {id}`, `flag {key, equals?}`, `and {all: ConditionRef[]}`, `or {any: ConditionRef[]}`,
`not {cond}`. Systems add kinds via `SimSystem.conditions`. Unknown kind → `false` + fault.

---------------------------------------------------------------------------------------------------------------------

## 5. Tick order (`step()`), never throws
1. `state.tick++`; `ctx.time = timeInfo(tick)`.
2. Self-heal the per-agent fields the engine relies on (status, needs, queue, moodlets, traits, NaN position, NaN run
   timers, a stale `status.passedOut` without a running `engine_passOut`), then snapshot `prevPos`/`prevFacing` for every
   on-lot agent.
3. While `utilitiesOn` is false, every running stage is power-checked each tick (see §7). This reads only saved state, so
   a power cut made by a system/command right before a save ends the same runs after loading (decision #9).
4. For each **on-lot** agent sorted by numeric id (fault barrier per agent — a throw aborts that agent's active
   interaction cleanly and is logged as `agent:<id>`):
   a. base need decay (§6) — household members and visitors only;
   b. moodlet expiry (`endTick <= tick`);
   c. critical overrides (feral / pass out, household only) and preemption checks;
   d. interaction state machine (§7);
   e. movement (§9) + nudge out of blocked tiles;
   f. autonomy if idle (§10).
5. Moodlet expiry for agents not on the lot (at work keeps expiring).
6. `system.tick(ctx, 0.25)` for each system in registration order (fault barrier per system).
7. Boundary hooks (fault barrier per system): on a new day `dayStart(ctx, day)` **then** on a new hour `hour(ctx, hour)`.
   Engine hourly work runs right after the systems' `hour` hooks: power check of running stages.
8. Choices with `expiresTick <= tick` auto-resolve `defaultOption` (its effect runs) and are removed.
9. Housekeeping (hourly): notifications trimmed to 120, `txLog` to 256, game-over fallback (every member `gone`).

A system whose hooks throw 50 times is disabled (hooks only; its effects/requirements/behaviours/api stay callable)
and the player gets a notification. `faults()` keeps the last 200 `{tick, where, message}`.

## 6. Needs, mood
- **The engine decays hunger, energy, social, fun, hygiene ONLY** (on-lot household members + visitors), per hour:
  hunger 5.5, energy 5.0, social 4.0, fun 4.5, hygiene 3.5 × difficulty (relaxed 0.7 / normal 1.0 / grim 1.3)
  × trait `needDecay[need]` (applied by `changeNeed`). Night Owl: energy × trait `mult.nightEnergyDecay` at night.
  **Asleep** = the active run is in phase `run` and either the def has tag `sleep` or the current stage anim is `sleep`
  (beds, coffins, naps, `engine_passOut`). Asleep, energy does **not** decay and the other needs slow down
  (`SLEEP_DECAY_MULT`, GDD §3, backlog #12): hunger ×0.5, social ×0.3, fun ×0.3, hygiene ×0.5. Preservation follows
  HOME's bed `sleepDecayMult`. Walking to bed, waiting, and a cancel's exit minute are awake. The needs-view `trend`
  applies the same factors.
- **Preservation is never decayed by the engine** (home `decay` system owns it; difficulty preset for it is
  relaxed 0.6 / grim 1.4 — read `state.settings.difficulty`). Agents away (`atWork`) are not touched by the engine
  (home `decay` ticks their preservation, careers applies the GDD §10 away rates — decision #10).
- Stage `needsPerHour` applies to **any** need including preservation, via `changeNeed` (so capped by vitality), scaled
  by `ObjectDef.params[scaleByObjectParam[need]]` (number; missing → 1) of the stage's object.
- `changeNeed(agent, need, delta, {raw})`: unless `raw`, positive deltas × Π trait `needGain[need]`, negative
  deltas × Π trait `needDecay[need]` (traits + rewardTraits). Clamped to `[0, needCap]`, `needCap = vitality` for
  preservation else 100. NaN/Infinity deltas are ignored. Returns the applied delta.
- Mood = Σ need contributions (GDD §3 formula/weights) + Σ moodlet `mood × stacks` + Σ trait `baseMood`
  + Σ `system.moodModifiers` (computed once per agent per tick) → clamped −100..100.
  Bands: <= −50 miserable, <= −15 uneasy, < 15 fine, < 50 good, else great ("Undead and Loving It").
- `needs()` view `trend`: analytical per-hour estimate (engine decay + active stage rate + group bonus; for
  preservation `sys('decay').preservationPerHour(agentId)` — the home-owned rate, decision #2 — plus the stage rate,
  else GDD base 1.3 × difficulty × trait). Away at work: GDD §10 away rates (+ decay api for preservation).
- Moodlets: `addMoodlet` on an existing id adds stacks (capped `maxStacks`) and refreshes `endTick` to
  `now + duration`. Duration × actor `traitMult('moodletDuration:<id>')` (e.g. Hothead `{ 'moodletDuration:furious': 2 }`).
  Unknown moodlet ids are logged as faults and ignored.
- `addXp`: × Π trait `skillGain[skill]`; levels with `SkillDef.xpPerLevel`; level-up emits `skillUp`, a `skill`
  notification, fx `skillUp`, sfx `skillUp`. Level 10 is max (xp stays 0).

## 7. Interaction state machine
- **Queue**: kept sorted by `priority` desc, then FIFO (`front:true` = first among equal priority). Default priority by
  source: auto 100, player 200, system 300 (`PRIORITY`). Player commands: max 8 items (queued + active).
  Hard cap 12 for systems; a full queue still admits an item that outranks its lowest-priority entry (that entry is
  dropped), so a pass-out / feral meal is never locked out. `ctx.queue` returns `null` for unknown interaction ids /
  off-lot agents (fault logged).
- **Preemption**: if the queue head outranks the active run, the active run is suspended when it is interruptible
  (or still routing/waiting): player > auto cancels auto runs (not re-queued); system/critical suspend player runs
  (a fresh copy is re-queued at the front) and cancel auto runs.
- **Begin** (head dequeued): target validated (object exists & not held by someone else / agent on lot / tile in
  bounds) → `requires` → `behavior.available` → (social) target availability → **then** the ActiveInteraction is
  created and `behavior.begin` runs. Failures before `begin` produce no `begin`/`end` calls. Once `begin` was called,
  `end` is called **exactly once** (complete, canceled or failed — including when begin itself returns a reason).
- **Stage resolution** (`StageTarget`), then `fallback` if unresolvable (reason of the primary is reported):
  - `target` — object: a free slot (filtered by `slots` ids) whose approach tile is reachable, cheapest by
    `distanceField`; object without slots → nearest reachable adjacent tile facing the object. Held by the actor →
    `here`. Agent target → treated as `agentAdjacent`. Tile → that tile (nearest walkable). Self → `here`.
  - `nearestTag` — every non-broken, non-burning on-lot object with the tag (skip power-needing ones when the stage
    needs power and the power is out), free slot as above, cheapest path. Reason "No free <tag>".
    **Tag wait** (backlog #5): when every matching object is merely reserved / in use (or unpowered with at least one
    in use) — and no `fallback` resolves — the run does not fail: it enters phase `wait` (`run.data._tw = 1`, bubble
    `clock`) bound to NO object (`stageTarget` self, no reservation, so selling one of the busy candidates never
    fails it), re-resolves once per game minute (`TAG_WAIT_RECHECK_MIN`) and routes as soon as a slot frees; after
    `TAG_WAIT_MAX_MIN` (20) game minutes, or when the candidates disappear / break, it fails with the resolver's
    reason ("The fridge is in use" / "No working fridge here"). Cancel ends it at once (route/wait semantics).
    Socials and pair halves never tag-wait (their `wait` phase means engage / start together).
  - `seat` — objects with free `sit` slots whose pose lies within `radius` of `near` (actor or queued target).
    `preferTable`: seats whose pose-forward tile (0.8 tiles ahead) holds an object tagged table/desk/surface come
    first. `facingTarget`: pose facing within 60° of the direction to the queued target. Cheapest path wins.
  - `tileNear` — walkable reachable tiles within `radius` (Euclid) of the target centre / actor, not occupied by
    another agent or another agent's route goal. `of:'target'` → cheapest; `of:'actor'` → random (`ctx.rng`) using a
    bounded local search (radius <= 8, no full distance field). Pose faces the target centre.
  - `seat` / `tileNear` stages placed **at** a queued object target — `seat` with `near:'target'` or
    `facingTarget`, `tileNear` with `of:'target'` (watch TV, dance by the stereo): the queued object also joins
    `inUseBy` while running (TV turns on), its power/broken state is what the power check uses, and it is the shared
    object for the joinable group bonus. Removing it ends the run ("It's gone"). Stages placed relative to the actor
    (`near:'actor'` / `of:'actor'`, e.g. eat at a seat near me after grabbing a serving) do not watch the queued
    target: someone clearing or picking up the platter does not interrupt the diner.
  - `agentAdjacent` — free walkable tile 8-adjacent to the target agent's tile (4-neighbours preferred), cheapest.
  - `here` — current position.  `exit` — the entry point with the cheapest path.
- **Slots**: the chosen slot index is written to `obj.reservedBy[slot] = agentId` at resolution and the agent joins
  `obj.inUseBy` when the stage run starts. Both are released on EVERY exit path (stage change, complete, cancel,
  fail, despawn, object removal, fault).
- **Route**: `spatial.findPath` to the chosen approach tile (best by distance field). Repath when `lot.version`
  changes or the next step is blocked. Fails ("Can't get there") after 3 failed attempts or when routing exceeds
  3 × expected time (+5 min). On arrival the agent snaps to the slot pose (`pos`, `posY`, `facing`).
- **Wait**: socials/pairs (see §8; timeout 30 game minutes → "{Target} didn't respond") and the `nearestTag` tag wait
  above (≤ 20 game minutes).
- **Run**: at the run start of the **first** stage `def.cost` is charged (key `cost:<uid>`; failure "Can't afford").
  At every stage start: power check (`stage.power ?? objectDef.needsPower`) → "The power is out" / "{Object} is
  broken"; then `effectsOnStart`, `behavior.startStage` (reason aborts), anim/expression/carry/bubble/voice/sfx.
  Each tick: needsPerHour, skillXpPerHour, joinable group bonus (+3 social/h and +1.5 fun/h per other participant
  of the same interaction on the same object, max 3), `behavior.tick` ('done' finishes the stage), `stopWhen`
  (threshold capped at the need cap), duration. Stage complete → `effectsOnComplete`, `behavior.completeStage`,
  next stage. Last stage → `moodletsOnComplete` (rolled `chance`, `to`), `behavior.end('complete')`.
  Open-ended stages (duration >= 1e8) safety-stop after 18 game hours.
  Power is re-checked hourly (broken objects) and every tick while the utilities are off.
- **`ctx.failRun(agent, reason)`**: fails the active run at the next safe point (right after the current effect or
  behaviour hook returns, else at the agent's next update) with `reason` shown for player-sourced runs. The request is
  stored in `run.data._fail`, so it survives a save taken before it is processed. `ctx.interrupt` stays a graceful
  cancel.
- **Cancel**: route/wait → ends immediately (`canceled`). run → graceful exit: phase `exit` for 1 game minute
  (anim idle), then `end('canceled')`. A run in its exit minute always ends `canceled`, even if its object vanishes
  or it is failed meanwhile (no failure notification for something the player already stopped). Player cancel follows
  `interruptible` only: a running non-interruptible interaction is refused ("Can't stop now"); hidden system items
  such as Go to Work stay cancellable (`QueueView.cancellable`); `engine_exitLot` is never player-cancellable.
  `ctx.cancel`/`ctx.interrupt` from systems always cancel (graceful).
- **End**: releases slots/inUse, stops sfx loops, agent stands up (pos → approach tile, posY 0), visual carry cleared
  unless an object is held, `behavior.end` exactly once, partner ended (see §8). Failures of **player-sourced**
  items notify the player (`bad` notification "{Actor} couldn't {label}: {reason}") and emit `interactionFailed`.
  Auto failures set an autonomy cooldown (4 min doubling to 30).
- Reserved `run.data` keys start with `_` (engine scratch). Behaviours may use any other key.

## 8. Socials and pairs
- **Social** = `targetKind:'agent'` + `def.social`. The actor's stage target is `agentAdjacent` (or `target`, same
  thing). Target must be on the lot, awake (not passed out / sleeping), not feral ("{Target} is too hungry to talk"),
  and not running an uninterruptible interaction or anything above system priority (a critical override such as a
  feral meal — the system-priority respond must never suspend it) nor holding a critical item in its queue (a Fight
  Fire call would preempt the respond within the minute and the actor would re-pick the same social, looping dozens of
  1-minute socials while the fire burned — balance pass), else "{Target} is busy" ("is asleep" / "is at
  work" / "is leaving" when more precise). The same check guards pair partners. Relationship
  gates (`minFriendship`, `maxFriendship`, `minRomance`, `status`) are checked by the engine at begin as well.
  The actor routes next to the target and stops as soon as it is on a neighbouring tile with no wall between them.
  If the target moved > 1.5 tiles since the route was planned, the actor re-routes once it is within 3 tiles of its
  goal (or immediately if the target moved > 6 tiles); max 4 re-routes, then "{Target} wandered off". When two
  agents walk towards each other for socials/pairs, the one with the higher id stops and waits.
- On arrival (phase `wait`) the engine **suspends the target's current interruptible interaction** (player/auto
  items re-queued at the front as a fresh QueueItem copy with a new uid; idles dropped), then gives the target a
  hidden `engine_respond` (system priority, `params.partnerId = actor`, `run.partnerId = actor`) and starts it
  immediately. When the respond is running both face each other and the actor's run starts. Target anim =
  `def.social.targetAnim`. If the target is asleep / passed out / away / leaving when the actor arrives → fails with
  that reason ("{Target} is asleep" ...); if it is merely busy (another social, an uninterruptible run) the actor waits
  in place and engages as soon as it frees up, up to the 30-minute wait timeout ("{Target} didn't respond").
- **Non-adjacent socials** (decision #12): a social whose first stage targets `tileNear` (e.g. waving at a walk-by)
  runs without `engine_respond` and without target busy checks; the social behaviour handles the reaction.
- Outcome math (success roll, friendship/romance, moodlets, outcomes) is the **social system's behaviour**
  (`def.behavior`, e.g. `social`); the engine only choreographs. `run.partnerId` is set on both runs.
- **Pair** (`def.pair`): partner agent = the queued target agent, else `params.partnerId`. After the actor's stage 0
  resolves, the partner gets `pair.partnerInteraction` at system priority with `params.partnerOf = actorId`, target =
  the actor's stage-0 object (`sameObject`) or the actor (`actor`); the partner's current interruptible interaction
  is suspended as for socials. Both wait in pose; stage 0's run starts on the same tick for both.
  Busy partner → "{Partner} is busy". Partner failing to start → "{Partner} couldn't join".
- **Either side ending ends both** (actor complete → partner `complete`; otherwise partner `canceled`).

## 9. Movement
1.3 tiles / game minute × legs (2: 1.0, 1: 0.6, 0: 0.3) × feral 1.15. Anim `walk` / `limp` / `crawl` (feral uses
`feral` when standing idle). Facing follows the path. An agent that is not in a pose is never left inside a blocked
tile: it is nudged to `spatial.nearestWalkable` (also after build changes and object spawns).

## 10. Autonomy (GDD §14)
- Candidates: every on-lot object's `def.interactions` (target = object) ∪ agent-target interactions × other on-lot
  agents ∪ `system.autonomyCandidates` ∪ (idle set when nothing scores). Filters: `autonomous !== false`, not hidden,
  requirements, `behavior.available`, social gates, cost affordable, power, object not burning/held/fully reserved,
  reachable. Visitors: `visitorAllowed` only, and until `visit.welcomed` only outdoor objects + socials. Service NPCs
  and walk-bys never run autonomy.
- Score = needPart + bonus, where needPart = Σ_need W × (D(v) − D(min(cap, v + ad))) with D(v) = (100 − v)² / 100,
  W = `traitMult('needWeight:<need>')` (1), ad = `advertise` or derived from stages (needsPerHour × duration, stopWhen
  stages up to the threshold, social defs: `social.social`/`fun`), and bonus = `adBonus` + capped(Σ `traitAd` + trait
  `tagAd` for the def's tags). Then × the repetition factors, × 1/(1 + pathCost/14), × 0.6 when the object is in use by
  someone else (non-joinable), then `behavior.adjustScore`. Weighted pick among the top 3 (`ctx.rng`) **of those that
  clear the idle threshold**; best < 6 → idle behaviour (a below-threshold candidate is never picked just because
  something else cleared the bar).
- **Trait-bonus cap** (backlog #13): the summed positive traitAd + tagAd of a candidate is soft-capped,
  `TRAIT_AD_CAP × (1 − e^(−raw / TRAIT_AD_CAP))` with TRAIT_AD_CAP = 12 (Neat Freak +40 → 11.6, Gourmand +20 → 9.8,
  Hothead +12 → 7.6): personality still orders hobbies but can no longer out-bid a real need. Negative sums (vetoes
  such as Slob −1000 on cleaning) are uncapped.
- **Repetition penalty** (backlog #13, `repetition.ts`): every completed run of an autonomous-capable interaction is
  remembered per zombie for 6 game hours in `flags['engine:done:<agentId>']` ("id@tick;…", pruned hourly, WorldState
  only). With n = completions of the same interaction id in that window: essentials (tags eat / cook / snack / sleep /
  nap / hygiene / preserve / embalm / money / fire / repair / limb / reanimate / clean, or advertising ≥ 5 of hunger /
  energy / hygiene / preservation) get score × 0.85ⁿ; everything else gets needPart × 0.85ⁿ + positive bonus × 0.6ⁿ
  (negative bonuses are never softened). Spam comes from flat desirability at satisfied needs (a Hothead slammed a
  door ~250×/day) and that part fades fast, while a bored zombie's third TV session stays a real need. Feral and
  exhaustion overrides ignore it. `clean` chores count as essential: each run needs an actual mess.
- **Daily cap** (balance review, `repetition.ts` `DAILY_PICK_CAP`): normal / limited autonomy picks one NON-essential
  interaction id at most 6 times per game day per agent (socials pooled over partners — the def id is the key); a
  capped id pre-scores 0 until midnight. Counted at pick time (`recordPick` after a successful queue, so interrupted
  runs count) in `flags['engine:picks:<agentId>'] = "<day>|id=n;…"`; another day's or a departed agent's tally is
  pruned hourly, junk is ignored. Critical modes and player orders are never capped.
- **Scoring rules for content authors** (backlog #2 / sim-home H1) — `adjustScore` can only *refine*:
  1. a candidate whose pre-score (need part + bonus, repetition applied, before distance) is ≤ 0 is dropped before
     validation — `adjustScore` never sees it;
  2. if no candidate's optimistic score (pre-score over the straight-line distance, an upper bound of the real one)
     clears the idle threshold, nothing is returned and no pathfinding runs — the zombie idles;
  3. only the first 2 × AUTONOMY_TOP_N (= 6) candidates by distance-attenuated pre-score are validated (requirements,
     `available`, power, social gates) and passed through `adjustScore`; anything below that window is never seen.
  So a gated chore needs an `adBonus` large enough to enter the window, and its `adjustScore` should veto (return ≤ 0)
  rather than rely on adding a bonus; likewise drop (not damp) hobbies that must never crowd out food.
- Engine loops that can break ties iterate objects / agents in **id order** (o1, o2, …, o10), never in JSON key order:
  saves are written with sorted keys ('o10' < 'o9') and build undo re-inserts old ids at the end, so this keeps
  save → load → continue deterministic (decision #9, backlog #6).
- `settings.autonomy`: `limited` → only needs < 35 count and a candidate must improve one of them; `off` → only the
  critical overrides. Failure backoff: 4 game minutes doubling to 30 (`status.autonomyCooldownUntil/autonomyFails`).
  After an idle pick the agent re-plans no sooner than 1.5 game minutes later. Candidates whose optimistic score
  (straight-line distance) cannot beat the idle threshold skip pathfinding entirely.
- Critical overrides (household, any setting): hunger <= 5 → `status.feral = true` (moodlet `feralHunger`,
  notification, bubble), hunger-only scoring ×3 at critical priority, non-food runs interrupted; cleared at
  hunger >= 20. Candidates tagged `FERAL_FALLBACK_TAG` ('feralFallback' — SIM-PEOPLE's hidden `social_feralNibble`)
  are last-resort food: the feral pick first considers everything else, and only when no other hunger candidate is
  valid (no reachable fridge / meal / emergency pizza) runs a second pass over them. Normal / limited / energy
  autonomy never offers them (backlog #14). While a critical item already waits at the queue head (e.g. the feral meal something suspended),
  no new pick is made — `preempt()` hands over to the waiting one. Energy <= 0 → `engine_passOut` at critical
  priority. With autonomy `off`, energy <= 3 → energy-only pick.

## 11. Menus, commands
- `menu(actor, target)`: actor must be an on-lot household member, else `[]`. Tile → tile interactions (Go Here);
  self → `self` interactions with `playerAllowed !== false` and not hidden; agent → agent interactions (socials hidden
  when a requirement / behaviour.available fails, shown greyed when the engine social gate — min/max friendship,
  min romance — fails); object → the object's `def.interactions`. Reasons: requirements, behaviour.available, target
  busy ("In use" / "{Target} is busy"), "Can't afford ($N)", "The power is out", "{Object} is broken".
  Children from `behavior.choices`. Labels: `behavior.label` or `{target}` / `{param:key}` templating.
- Menu reasons also cover the stage-0 resolution: a `nearestTag` stage with no such object on the lot shows
  "Needs a {tag}"; a powered `seat`/`tileNear` stage near the target checks that object's power.
- `dispatch(cmd)` never throws (`{ok:false, reason}`). `queue` checks: household member on the lot, def not hidden
  and `playerAllowed !== false`, `targetKind` matches (agent self-click → self), the object lists the interaction,
  max 8 player items (queued + active), current availability. Params starting with `_` and `partnerOf` are
  stripped. A player order preempts autonomous activity immediately. Cheats: `graverobber`/`motherlode` (+$5,000),
  `freshstart` (household needs to cap); any cheat sets `flags.cheated = true`.

## 12. How systems are consumed
- `ctx.sys(id)` returns a frozen per-simulation wrapper of the system's `api` (cached per system per engine) whose
  every call is `api[method](...callerArgs, ctx)` — the invoking SimContext is appended LAST (binding decision #1).
  Missing system → `{}`. Throwing api calls made by engine views are contained (`api:<sys>.<method>` faults). Views delegate: `career` → `careers.view`, `careersAvailable` →
  `careers.available`, `relationships` → `social.relationships`, `aspiration` → `aspirations.view`, `buyReward` →
  `aspirations.buyReward`, `bills` → `economy.bills`, `lotValue` → `economy.lotValue`, `objectView.detail` →
  `food.objectDetail`, `townies` → `townies.list`, `party` → `townies.party`. Missing systems → engine fallbacks.
- `init(ctx, loaded)`: `createNewWorld` builds the world, calls every system's `init(ctx, false)` (people generates
  townies there), then the game calls `createSimulation(state)` which runs `repairWorld` and `init(ctx, true)` —
  **init(true) must be idempotent** (rebuild caches only).
- `agentArrived`/`agentLeft` fire from `spawnAgent`/`despawnAgent` (after presence changed).
- `onEvent(ctx, e)` (observer seam, used by the quests system): every `ctx.emit` is delivered synchronously, in emit
  order, to each system's `onEvent` in registration order (fault barrier `system:<id>.onEvent`). An emit made while
  observers run is queued behind the current event (FIFO, never recursive; one cascade delivers at most 1024 events).
  `finishRun(complete)` emits `{type:'interactionCompleted', uid, agentId, interactionId, targetId, source, household,
  params}` (params = queued params + the run's public scalar `data`, `_` keys excluded) after behaviour `end()`.
  Views: `quests()` → `quests.view`; command `{type:'quest', action, questId}` → `quests.command`.
- `ctx.agentsOnLot()` returns agents in id order (a1, a2, …, a10) — never JSON key order (backlog #6).
- Engine-written flags: `engine:done:<agentId>` (autonomy repetition history, §10), `engine:picks:<agentId>` (daily cap, §10). Systems keep their own prefixes.
- `createAgent` with role `household` appends to `household.memberIds`. `createNewWorld` honours
  `NewMemberSpec.voiceSeed` (decision #17).
- `spawnObject` throws on an unknown defId (your hook's fault barrier logs it); `placeItemNear` returns null instead.
- `removeObject(id, reason)` fails runs using the object with `reason` (default "The {object} is gone"; the reason is
  player-facing, so pass a full sentence), drops queue items targeting it, clears a holder's hand, drops surface items
  resting on it to the floor, bumps `lot.version` for floor objects.
- `holdItem(agent, obj)` immediately fails other zombies' runs bound to that item ("Someone else took it") so no run
  is left holding a reservation it lost.
- `spawnAgent` on an agent that still carries a stale run ends it properly first (end() once, reservations freed).
- The `feralHunger` moodlet is tied to `status.feral`: a system that clears the flag directly (e.g. reanimation) also
  loses the moodlet on the agent's next update.
- Money: `spend/earn` round to integers, reject NaN/negative, never let funds go below 0; a `key` already in
  `household.txLog` is a no-op (`spend` returns true). A run suspended and re-queued (social respond, critical
  override) keeps its idempotency keys (`params._origUid`) and won't pay `def.cost` twice (`params._costPaid`).
- `ctx.mood(agent)` is the cheap value-only path; the `mood()` view builds contributors. System `moodModifiers`
  are evaluated once per agent per tick.

## 13. Persistence / repair
- `createSimulation(state)` = `repairWorld` (structure: NaN/out-of-range needs, vitality, unknown defs/moodlets/
  interactions/traits, dangling reservations/in-use/carry/active/partner links, duplicate uids/notification ids,
  `nextId`, relationship key normalisation, settings/flags/stats shapes, a role-`household` agent missing from
  `memberIds` is re-added — or demoted to townie when the household is full) → wiring → `repairPositions` (off-grid /
  stuck agents to the nearest walkable tile) → `init(ctx, true)`. Warnings: `SimulationAPI.repairWarnings`
  (empty for healthy worlds — GAME shows a "save was repaired" toast otherwise).
- Repair is idempotent and does not touch healthy worlds, so save → load → continue is bit-identical to never
  having saved (covered by the determinism tests). End to end through PLATFORM's SaveManager (canonical, key-sorted
  JSON + envelope + validation + this repair hook) over 3 real-content game days with a build undo in the mix:
  tests/unit/engine/backlog.probe.test.ts (backlog #6).
- Every tick the engine also self-heals the fields its own steps rely on (missing status/needs/queue/moodlets/
  traits, NaN position, NaN run timers, stale `passedOut`, clobbered `reservedBy`/`inUseBy`) before touching them.
- Engine state that is not in `WorldState` is limited to per-tick caches and the system failure counters (a system
  disabled after 50 failures is re-enabled by a reload). Nothing the simulation's outcome depends on is kept in
  memory between ticks — covered by the save/load-every-tick and real-module periodic save/load tests.
