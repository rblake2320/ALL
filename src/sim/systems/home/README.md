# SIM-HOME — systems & content reference

Owner: SIM-HOME (`src/sim/content/home/**`, `src/sim/systems/home/**`, `tests/unit/home/**`).
Exports: `homeContent: ContentModule` (`src/sim/content/home/index.ts`), `homeSystems: SimSystem[]`
(`src/sim/systems/home/index.ts`). Every id below is a constant in `src/sim/content/home/ids.ts` — content and
systems import from there, tests check that every referenced id is registered.

## Systems (registration order = tick order)

| id | owns | api |
|---|---|---|
| `decay` | preservation, vitality, limbs, crumbling, urns, reanimation, game over | `DecayApi.decayLevel(agentId)`, `preservationPerHour(agentId)` (engine needs-trend), `loseLimb(agentId, limb?)`, `crumble(agentId)`, `reanimate(agentId)`, `isRotten(objectId)` |
| `food` | cooking, eating, leftovers & spoilage, snacks, pizza delivery, object detail lines | `FoodApi.orderPizza(agentId)`, `FoodApi.objectDetail(objectId)` (covers **all** home objects), `pizzaPending()`, `leftovers(objectId)` |
| `economy` | bills, power cuts, Repo Ghoul, mailbox, painting sales | `EconomyApi.bills()`, `lotValue()`, `payAll(agentId)`, `owed()`, `addMail(n)`, `issueBill()`, `dispatchRepo()` |
| `upkeep` | breakage & repair, fire, lights, stereo loops, mess/flies/stench, room-environment mood, leisure behaviours | `startFire(objectId)`, `fires()`, `breakObject(objectId)`, `environment(agentId)` |

All hooks are fault tolerant (validate, never throw on missing agents/objects; malformed bills/leftovers are
sanitised) and deterministic (`ctx.rng`, ticks; iteration in sorted-id order). Hourly/daily work is idempotent
(guards in `flags`: `home.lastLimbHour`, `home.lastVitalityDay`, `home.lastBillDay`).

**api ↔ simulation context.** Per resolved contract decision #1 the engine's `ctx.sys(id)` wrapper appends the
invoking `SimContext` as the LAST argument of every api call; each home api method is wrapped by `apiMethod`
(`ctxRegistry.ts`), which uses and strips that trailing ctx. Only when it is absent (a caller bypassing the engine
wrapper) does it fall back to the registry heuristic: entries keyed by WorldState (latest ctx per world), resolving
to the world that is mid-step, else the most recently used one.

## Decay model (GDD §4) — `decay`
- Preservation decay/h = `(1.3 + 0.6·[hygiene<20] + 1.0·[hunger<10]) × sleep × strenuous 1.5 × outdoor-sun 1.2 ×
  difficulty (0.6/1/1.4) × traitMult('decay')`; applies on the lot and at work (`atWork` = base rate).
  Sleep multiplier = bed `params.sleepDecayMult`: coffins **0** (GDD restores: "pine coffin: decay halted"),
  bed / plot / floor / sofa nap 0.5. Powered refrigerated coffins add `params.preservationPerHour` (Chill-Rest 4,
  Cryo 5); unpowered they still halt decay. Awake, the same coffins offer Chill Out (+10/h stage needsPerHour, plain
  awake decay still applies). `strenuous` = running an interaction tagged `strenuous` (Dance, Work Out).
- Vitality −0.6 at 00:00 (`dayStart`), −0.25/h while preservation < 15; clamped 20..100; preservation re-capped.
  Cryo Sarcophagus: +2 vitality after a ≥ 6 h sleep powered ≥ 80% of it.
- Limb loss hourly per on-lot zombie: `((50−p)/50)² × 0.08 × traitMult('limbLoss') × (fitness≥5 ? .5) ×
  (strenuous ? 1.5) × (p=0 ? 3)`; intact limbs only, arms 35 / legs 15 weights. Spawns `item_limb_arm|leg` (data
  `limbId, ownerId, ownerName, createdTick, rotten`), fx `limbDrop` + sfx, owner `lostLimb` (Clumsy also
  `hilariousLimb`), witnesses within 6 tiles in the room: Squeamish `squeamishHorror`, Grumpy/Party Animal/Hothead
  `hilariousLimb`, others `grossedOut`. A task whose arms/legs requirement is no longer met is interrupted.
  Limbs rot after 48 h (`rotten=true`, flies).
- Stitching: success `0.5 + 0.06·mortuary` (cap .95); fail drops the limb + `butterfingers`. One-armed ×1.35 time;
  every stitching interaction needs only one functional arm (GDD §4: only an armless zombie can't stitch).
- Preservation 0: `fallingApart` (−30); household members crumble after 24 consecutive hours (at work: on return).
  Crumble → presence `crumbled`, `item_bonepile` (data `ownerId, name, crumbledTick`), `status.bonePileId`,
  living members get `mourning`. 72 h later → `item_urn`, presence `gone`. Reanimate (kit consumed): preservation 55,
  vitality −15 (min 20), limbs restored, `backFromDead`, mourning lifted.
- Game over when every household member is crumbled/gone: `state.gameOver = true`, `{type:'gameOver', reason:'Rest in Pieces'}`.
- `freshAsADaisy` while preservation ≥ 90 (off < 85); `reeking` while hygiene 0 (off ≥ 15; Slobs immune).
  Vain ≥80/<40 mood is people's `moodModifiers` (vainFresh/vainRotten) — not duplicated here.

## Food (GDD §5) — `food`
- Recipes (`content/home/recipes.ts`): brainLoaf, brainJerky, cerebellumStew, frontalLasagna, medullaFlambe
  (requiresTag `cryoFridge`), brainBurrito (microwave), brainPizza (phone).
- Cook… (fridge `home_cook` / stove `home_cookAtStove`, behaviour `cook`, choices = recipes; autonomy picks the best
  affordable dish ≤ ~3% of funds): stage 0 at a fridge charges `ctx.spend(cost, …, 'cook:<origUid>')`; stage 1 at a
  stove lasts `cookMinutes` (×1.35 one-armed). Quality `clamp(base + ⌊cooking/3⌋ − 1 + stove.qualityBonus, 1, 6)`.
  Fire chance `max(0, .06 − .01·cooking) × stove.fireMult × traitMult('fireChance') × (stove dirt ≥ .6 ? 1.5)`,
  rolled once at stage start, ignites mid-cook. Meal → `ctx.placeItemNear('item_meal', stove)` (data `servings,
  quality, recipeId, mealName, createdTick, ageMin, spoiled, cookId`); the cook queues Have a Serving and calls idle
  hungry housemates. Stove grime +0.15 per cook. Groceries (key `cookRefund:<origUid>`) go back if the cook fails or is really canceled before
  the hob (a suspension — social respond / critical override — re-queues a copy with the same key first, which keeps them).
  `available`: Cook… on the fridge needs a working, powered stove ("The power is out" / "The stove is broken") so
  a power cut doesn't loop walk → pay → fail → refund.
- Eating (behaviour `eat`, modes item / leftovers / recipe / snack): hunger `recipe.hunger × (0.8 + 0.1q)` (spoiled
  ½) applied over the eating stage; no seat → `standEat` + `ateStandingUp`; company within 2.6 tiles → social +4/h,
  2+ household → `familyDinner`; q ≥ 5 `deliciousMeal`, q ≤ 1 `questionableMeal` (GDD §5 — Brain Jerky is q1, so
  snacking on it counts); spoiled → 60% × traitMult('spoilSick') `foodPoisoning` (hunger drains +½ × 5.5/h ×
  difficulty 0.7/1/1.3 while it lasts); Gourmand +10 fun/h. Dish left on the table surface (else floor).
- Leftovers: fridge `data.leftovers` = JSON `[{s,q,r,a}]`, plus `leftoverServings` / `spoiledServings`. Aged
  hourly: `a += 60 × params.spoilMult (cryo .5) × (powered ? 1 : 2)`; spoiled at 48 h. Meals left out spoil at 24 h.
- Pizza: `orderPizza(agentId)` → `ctx.spend(35, …, 'pizza:<n>')`, one order at a time, ghoul arrives 50–70 min later
  (`townies.createService('pizza')` → fallback `ctx.createAgent` role service), walks to the mailbox/front door,
  `item_pizza` (6 servings, q3) on a surface if any, then `sendOffLot('gone')`. Watchdog 120 min delivers directly.
  Flags: `home.pizza.due|by|npc|spawned|delivered|count`.

## Economy (GDD §6) — `economy`
- Bills Mon/Thu 09:00: `40 + round(0.005 × lotValue) + 10 × living members` (balance pass; was 0.012 / 15), due +3 days. `lotValue` = placed
  object values + walls × $15 + floor tile prices. Stage 1 reminder (due −1 day), 2 final notice (+3 days),
  3 power cut (+4: `utilitiesOn=false`, sfx powerOff, `powerOut`), 4 repo (+6).
- Pay Bills (mailbox) / Pay Bills Online are **autonomous** but gated in `payBills.adjustScore`: only household
  members, only when the oldest unpaid bill is due within 24 h (`AUTO_PAY_HOURS`, the "due tomorrow" reminder) or
  overdue, and only if funds cover it (score +10, +3 per overdue day). Broke households still go through every stage.
- `payAll(agentId)` pays oldest-first, each bill keyed `bill:<id>` (never double-charged), stops at the first
  unaffordable bill (`"Not enough money ($N needed)"`), restores power when nothing is past the cut threshold,
  gives the payer `billsPaid`. Mailbox data `bills`, `mail`, `flag` mirror the household.
- Repo Ghoul: most valuable sellable floor/wall objects (never doors/windows/mailboxes/bone piles/urns/items) until
  value ≥ 1.2 × owed; each one vanishes with fx `puff`; then bills are cleared, power restored, household
  `repossessed`, ghoul leaves. Paying while it is on the lot sends it home empty-handed. Watchdog 4 h.
- Painting sale: earn `data.value` keyed `painting:<objectId>`; `paintingSold` moodlet; stat `paintingsSold`.

## Upkeep — `upkeep`
- `home_wear` on appliance stages: `breakChance × traitMult('breakChance')` on the stage object if breakable else
  the queued target (TV from a sofa). Broken → `condition.broken`, fx `zap` + sfx, warning. Repair 30 min (zap
  chance `max(0, .15 − .03·logic)` → `zapped`).
- Fire: `item_fire` (data `burningId, burnMin, spreadMin, fireEvent`) on a flammable floor object; 10% per 10 min to
  an adjacent flammable object; 60 min → `item_ash`; `panicking` within 4 tiles; −10 preservation/h within 1.5 tiles;
  Fight Fire 20 min, 70%, auto-retries up to 6 attempts (same source and priority).
  **Severity limits (backlog #15):** one ignition = one fire event (`fireEvent`, inherited by the fires it spreads to);
  an event spreads at most `FIRE_MAX_SPREADS` = 2 times (`flags['home.fire.spreads.<event>']`). While anything burns,
  every awake, non-feral household zombie on the lot that is not panicking about it *right now* (Panicking moodlet
  AND the fire in sight — the moodlet alone lingers an hour) is queued to Fight Fire at **critical** priority, nearest
  fire first, a critical crew of at most `MAX_FIREFIGHTERS_PER_FIRE` = 2 per fire (non-panicking volunteers are raised
  to critical first), re-summoned no sooner than every 10 min (`flags['home.fire.called.<id>']`); autonomy 'off'
  leaves it to the player. An ashed fridge / stove / microwave posts "Your fridge burned — buy a new one" (stove /
  microwave lines alike) instead of the generic "Burned to a crisp". Flags are cleared once every fire is out.
- Every 5 min: `stenchNearby` / `faintStench` (diffuser in room) near reeking zombies (traitMult `stenchMood`,
  Slob immune); Neat Freaks near mess get `disgustedByMess`. Hourly: flies on dishes ≥ 6 h, spoiled meals, rotten
  limbs, overflowing trash; powered fly zapper within `params.radius` zaps them; surfaces under dishes grime up.
- `moodModifiers`: room environment `spatial.roomEnvironment × 0.8` → −8..+8 (negative × traitMult `messMood`).
  SIM-SPATIAL reads every object's env — spawned items included — from these defs (backlog #4): dish −1, ash −3,
  fire −5, limbs −2, bone pile −3, urn +3, painting +3.
- Stereo music (`upkeep/loops.ts`): every tick the audible set (playing ∧ powered ∧ not broken/burning) is reconciled
  with `flags['home.stereo.loops']`, so a stereo that is sold, repossessed, burns, breaks or loses power while playing
  gets `sfxLoop {key:'stereo:<id>', on:false}` (the event layer never stops loops by itself). Fire loops are stopped
  explicitly; both are re-emitted on load (`init(loaded)`). The flag is only written once a stereo actually plays.

## Autonomy sanity (`autonomy.ts` + behaviour `adjustScore` / `available`) — autonomous picks only
The engine scores Σ need gains + adBonus + soft-capped (traitAd + trait tagAd), applies its repetition penalty, then
lets `adjustScore` refine only candidates whose pre-score already clears the idle bar, validating the first 2×TOP_N by
pre-score (engine README §10). Flat trait bonuses (Artistic +25, Lazy +15, Gourmand +20/+10, Neat Freak +40) used to
outweigh real needs — the engine now caps them (≈ 12 at most) — and HOME behaviours still apply:
- `leisureScore` (paint, read, TV, dance, listen, sit, mirror, plants, epitaphs, mourning, chores, activity …):
  NEVER when every stopWhen stage is already within 8 points of its threshold (Watch TV at fun ≥ 90, shower at
  hygiene ≥ 90); × `basicNeedDamp` — hunger < 40 / energy < 35 / hygiene < 25 scale the score down to ×0.15 at
  15 / 10 / 5; hunger and energy at the floor drop the candidate entirely (so damped hobbies can't fill the engine's
  validation window and hide the fridge). Never damped when the activity restores the low need itself, or any need
  that is urgent (`URGENT_HELP`: e.g. the spray at freshness < 35).
- Cook: NEVER when funds < $12, a housemate is cooking (or has a cook queued), a fresh meal/pizza is out or a fridge
  holds fresh leftovers, or nobody on the lot is below hunger 60 (`COOK_WHEN_HUNGER_BELOW`; balance pass, was 75).
- Eat: NEVER at hunger ≥ 65 (meals, leftovers, burritos) / ≥ 55 (jerky) — balance pass, were 80 / 70: a ~50-point serving at 75+ was
  mostly wasted and groceries were a household's biggest expense (docs/BALANCE.md). Nap: only below energy 75
  (`autoNeed`). Sleep: × 0.5 (× 0.2 below hunger 30) while hunger < 60 unless energy ≤ 15 — eat before bed.
- Put Away Leftovers: `available` → "The fridge is full" when no fridge has room. Fit Prosthetic: NEVER while the
  zombie's own fresh limb lies on the lot (stitching is free). Gated chores (put away, throw away, check mail, pay
  bills) carry an adBonus just large enough to enter the candidate pool; their `adjustScore` decides.
- The Reanimation Kit manual is not tagged `read` (Bookworms re-read it in loops).

## Tuning knobs (for the integration balance pass — resolved decision #13)
- Decay: `decay/rates.ts` (`PRES_*`, `VITALITY_*`), bed `params` in `content/home/objects.ts`.
- Limb loss / stitching: `decay/limbs.ts` (`LIMB_LOSS_*`, `STITCH_*`, `ONE_ARM_SLOWDOWN`); crumble/reanimate windows in `decay/death.ts`.
- Self-preservation autonomy: Preservative Spray `params {autoMax: 35, autoUrgency: 0.8}` (`content/home/interactions/kitchen.ts`);
  Self-Embalm `adjustScore` ((50 − pres) × 0.3 below 50, `decay/behaviors.ts`); refrigerated-bed bonus in `sleepBehavior.adjustScore`.
- Food: fire `BASE_FIRE_CHANCE` / `FIRE_CHANCE_PER_LEVEL` / greasy ×1.5 (`food/cooking.ts`); spoilage `LEFTOVER_SPOIL_MIN` /
  `MEAL_OUT_SPOIL_MIN` (`food/leftovers.ts`); pizza delay/watchdog (`food/pizza.ts`).
- Money: `BILL_*` (balance pass: `BILL_LOT_RATE` 0.012 → 0.005, `BILL_PER_MEMBER` 15 → 10), stage day thresholds (`economy/bills.ts`); `REPO_VALUE_FACTOR` (`economy/repo.ts`).
- Balance harness: `tests/balance/harness.ts` (`npm run balance`); results and rationale in `docs/BALANCE.md`.
- Upkeep: fire spread/burn/fight constants (`upkeep/fire.ts`); mess radii & dish-flies delay (`upkeep/mess.ts`); zap chance (`upkeep/wear.ts`).
- A task whose arms/legs requirement stops holding after a limb falls off is ended with `ctx.failRun` ("Lost an arm mid-task").
- Autonomy sanity: `PRESSING_NEEDS`, `DAMP_MIN`, `URGENT_HELP`, `STOP_WHEN_MARGIN` (`autonomy.ts`); `COOK_WHEN_HUNGER_BELOW`
  (`food/cooking.ts`); `EAT_WHEN_HUNGER_BELOW` / `SNACK_WHEN_HUNGER_BELOW` (`food/eating.ts`); `SLEEP_HUNGRY_BELOW` /
  `SLEEP_ANYWAY_ENERGY` (`decay/behaviors.ts`); `AUTO_PAY_HOURS` (`economy/index.ts`); nap `autoMax 75` (content).

## Tests (`tests/unit/home/`)
`fakeCtx.ts` (FakeSim + mini stage runner) · `fakeContext.ts` (SimContext) · `fakeVocabulary.ts` (engine effect/requirement
subset) · `content` · `decay` · `food` · `economy` · `upkeep` · `adversarial` · `autonomy` (adjustScore/available rules,
stereo loop reconciliation, hook fuzz) · `integration` (real engine, multi-day) · `integration.life` (real engine +
people: an unattended household eats, sleeps, works, socialises, pays its own bills for 4 days).

## Registered ids
**Behaviours:** sleep, embalm, beEmbalmed, stitch, beStitched, pickUpLimb, fitProsthetic, reanimate, kitReanimate,
mourn, mirror (decay) · cook, eat, putAwayLeftovers, throwAway, cleanFridge, deliverPizza (food) · payBills,
checkMail, repossess, sellPainting (economy) · activity, sit, toggle, watchTv, dance, listen, read, paint, cleanUp,
wipeDown, fightFire, repair, emptyTrash, feedPlant, epitaph (upkeep).
`activity` params: `xpSkill/xpPerHour` (hands-on aware), `funMultKey` (trait mult on stage fun), `autoNeed/autoMax/
autoUrgency`, `nightPenalty`, `standingAnim`, `highScoreChance`.

**Effects:** `home_wear` {} · `home_reanimate` {agentId?} · `home_loseLimb` {limb?, agentId?} · `home_vitality`
{amount, agentId?} · `home_startFire` {objectId? | tag?} · `home_breakRandom` {tag?} · `home_payBills` {} ·
`home_addMail` {count?}.

**Requirements** (all honour `params.reason`): `home_hasLeftovers`, `home_hasSpoiledLeftovers`,
`home_carryingOwnLimb`, `home_carryingLimbOfTarget`, `home_limbOwner {owner}`, `home_limbFresh`,
`home_limbOwnerHere`, `home_limbStillMissing`, `home_missingLimb`, `home_canBeEmbalmed`, `home_stitchTools`,
`home_reanimatable`, `home_crumbledMember`, `home_billsDue`, `home_dirty {min}`, `home_trashFill {min}`.

**Conditions:** `home_dishCount {min}`, `home_anyReeking`, `home_billsOverdue`, `home_powerOff`, `home_fireOnLot`,
`home_avgFreshness {min}`, `home_anyMissingLimb`.

**Stats** (global; "both" = also per agent): mealsCooked*, mealsEaten*, limbsLost*, limbsReattached*,
prosthetics*, crumbled, reanimations*, billsPaid, billsIssued, powerCuts, repossessions, paintingsFinished*,
paintingsSold*, embalmedOthers*, selfEmbalms*, firesStarted, firesFought*, objectsBroken, repairs*, pizzasOrdered,
dishesCleaned* (* = both).

**Flags** (`FLAG`): `home.lastLimbHour`, `home.lastVitalityDay`, `home.lastBillDay`, `home.mail`, `home.pizza.*`,
`home.repo.*`, `home.power.seen`, `home.stereo.loops`, `home.fire.spreads.<event>`, `home.fire.called.<agentId>`.

**Object data keys** (`DATA` in ids.ts): meals `servings quality recipeId mealName createdTick ageMin spoiled cookId`;
fridge `leftovers leftoverServings spoiledServings`; easel `progress artistId`; stereo `playing`; lights `on`;
mailbox `mail bills flag`; trash `fill`; dirty items `flies`; painting `value title artistId`; limbs `limbId ownerId
ownerName createdTick rotten`; bone pile / urn `ownerId name crumbledTick`; fire `burningId burnMin spreadMin`;
fire also `fireEvent`; carnivorous plant `lastFedTick`.

**Trait hooks read** (people's TraitDef.mult): decay, limbLoss, fireChance, spoilSick, breakChance, embalmOther,
tvFun, napFun, readingFun, danceFun, paintingFun, stenchMood, messMood. Interaction tags matching people's tagAd:
cook, eat, clean, mirror, tv, nap, read, paint, dance, exercise, embalm.

## Interactions (prefix `home_`)
Seats: sit, nap (sofas), contemplate (pew) · Beds: sleep · Chill-Rest / Cryo: chillOut (awake, 60 min, +10 Freshness/h, power; autonomy below 40) · Surfaces: wipeDown · Fridge: cook, grabJerky ($5),
eatLeftovers, grabSpray ($15), cleanFridge, repair · Stove: cookAtStove, cleanStove, repair · microwaveBurrito ($8)
· brewEspresso ($4) · washHands · Trash: emptyTrash, rummageTrash · Meals/pizza: haveServing, putAwayLeftovers,
throwAwayFood · Dish: cleanDish · Ash: cleanAsh · Shower · iceBath · Station: selfEmbalm ($40),
stitchSelfStation · Table: stitchSelf, practiceStitch · Agents: embalmOther ($30 since the balance pass, mortuary ≥ 2, pair
beEmbalmed), stitchOther (pair beStitched) · Crate: fitProsthetic · Mirror: admireDecay, practiceSpeech,
checkFreshness · Limbs: pickUpLimb, limbStitch, limbReattachOther, throwAwayLimb · Bone pile: reanimate, mournPile
· Kit: kitReanimate, readKitManual · Urn: mournUrn, payRespects · TV: watchTv (choices) · Stereo: stereoToggle,
dance, listenMusic · PC: browseWeb, playVideoGames, program, payBillsOnline · playChess · read (choices) · paint ·
Painting: sellPainting, admirePainting · workout · playArcade · Plants: feedPlant ($3), mournFern, waterFern ·
readEpitaph · admirePortrait · admireRug · broodTree · watchZapper · sniffDiffuser · gazeWindow · slamDoor ·
Mailbox: payBills, checkMail · Lights: toggleLight · Fire: fightFire · Hidden: deliverPizza, repossess.
