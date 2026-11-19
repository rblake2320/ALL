# SIM-HOME — contract clarifications & requests

Nothing blocks SIM-HOME; everything below is worked around locally (see `src/sim/systems/home/README.md`).

## R1 — `SimSystem.api` needs its simulation context (worked around)
`api` methods are called as `ctx.sys(id).method(args)` with no `ctx`, and the engine reuses the same `SimSystem`
objects for every simulation it creates. Stateful apis (`EconomyApi.payAll`, `FoodApi.orderPizza`, `bills()`,
`decayLevel()`, …) therefore cannot know which world to act on when two simulations exist (lockstep determinism
tests, a menu-background sim + the game).

**Workaround (in `src/sim/systems/home/ctxRegistry.ts`):** every home hook records its ctx; the tick hook records the
tick it saw. An api call resolves to the simulation that is *mid-step* (its `state.tick` is past what our tick hook
saw), else the most recently used one. Correct for single-threaded step-by-step use, but heuristic.

**Request (pick one):**
- (a) `ctx.sys(id)` returns a per-engine wrapper that calls `api[m].call(system, ...args, ctx)` (append ctx as a
  trailing argument) — systems read it when present; or
- (b) allow `SimSystem.api` to be a factory `(ctx: SimContext) => Record<string, fn>` invoked once per engine.
Either keeps existing callers unchanged.

## C1 — Preservation trend (clarification, implemented)
The engine's needs view calls `sys('decay').preservationPerHour(agentId)`. Home returns decay + powered refrigerated
bed restore + fire drain + home-behaviour embalming gains; the engine adds the active stage's `needsPerHour` on top.
Please state this split in README §6 so nobody double-counts.

## C2 — Pine coffin decay (GDD ambiguity, decided)
GDD §4 says both "×0.5 while asleep in any coffin (×0 in refrigerated/cryo)" and "Pine coffin sleep: preservation
decay halted". Home implements the per-object restore list: `ObjectDef.params.sleepDecayMult` = 0 for every coffin
(pine/chill-rest/cryo; unpowered refrigerated coffins still halt decay), 0.5 for the normal bed, burial plot, floor
and sofa naps. Tunable in `content/home/objects.ts` if design prefers the other reading.

## C3 — Vain mood is people's (cross-module note)
People's `moodModifiers` already implement Vain ≥ 80 / < 40 (`vainFresh` / `vainRotten`). Home therefore does not
add a vain moodlet; `freshAsADaisy` (+5) is a general "freshness ≥ 90" moodlet for everyone.

## C4 — Objects removed during their own run (clarification)
`removeObject` fails every run using the object except `eng.currentRunUid` (only set while *effects* run). Behaviour
hooks that consume their own queued target (eating the last serving, selling a painting, stitching a limb, fitting
a prosthetic, repossessing) therefore defer the removal to `end()` (the run is in `eng.finishing`, so it is not
failed twice). Worth one line in README §12.


---
**RESOLVED by integration lead:** R1 → option (a) adopted: `ctx.sys(id)` appends the invoking SimContext as the LAST argument to every api call (see docs/CONTRACTS.md "Resolved contract decisions" #1; SIM-ENGINE implements the wrapper). C1 → `DecayApi.preservationPerHour?` added to contracts.ts. C2/C3/C4 accepted as decided.

**SIM-HOME follow-up:** implemented — every home api method (`apiMethod` in `src/sim/systems/home/ctxRegistry.ts`) reads the trailing ctx when present and strips it; the registry remains only as a fallback for callers that bypass the engine wrapper (keyed by WorldState, since the engine's world-creation context and the live simulation share one state). Also adopted the new `SimContext.failRun` for tasks that become impossible after a limb falls off.

---
## Hardening pass (SIM-HOME hardener) — notes for other modules (nothing blocks HOME; all worked around locally)

### H1 — SIM-ENGINE: document when `adjustScore` runs (README §10)
`gather()` drops candidates whose pre-score is ≤ 0, returns nothing when no candidate's optimistic pre-score clears
the idle threshold, and `choose()` validates/adjusts only the first `2 × AUTONOMY_TOP_N` by pre-score. So
`adjustScore` can only *refine* a candidate that already scores; a +N in `adjustScore` never rescues a low-pre-score
chore, and damped-but-positive candidates can crowd the validation window. HOME now gives gated chores (pay bills,
put away, throw away, check mail) an adBonus that gets them into the pool and returns ≤ 0 from `adjustScore` when
they don't apply, and drops (rather than damps) hobbies at critical hunger/energy. Please state these three rules in
README §10 so content authors don't rely on `adjustScore` bonuses alone.

### H2 — GAME: stop sfx loops whose object was removed (defence in depth)
`events.ts` tracks loops but `objectRemoved` doesn't stop loops whose `objectId` was removed. HOME now reconciles
stereo loops itself every tick (`flags['home.stereo.loops']`) and stops fire loops explicitly, but a generic
"objectRemoved → stop its loops" would protect every future looping object.

### H3 — SIM-SPATIAL: single source for item environment scores
`spatial/environment.ts` hard-codes `item_ash` at −1 (and dish −1 / fire −5) instead of reading `ObjectDef.env`;
HOME's def (and the brief) say ash −3. Suggest spatial reads `ObjectDef.env` for items too (dish/fire already
match), or tell HOME to change ash to −1.

### H4 — Balance pass (decision #13) data point
Unattended starter-home households now keep every need of the zombies who stay home above ~25 for 4+ days
(seeds 1, 2, 3, 77, 99, 4242, 31337). A zombie with an 8-hour job still drifts to low freshness and fun by day 4–5:
8 h at work (−1.3/h freshness, −4/h fun, −6/h energy) leaves too little home time for the $15 spray (+8) to keep up
against sleep and food. HOME only exempts triage (spray at freshness < 35) from its leisure damping; a stronger
"critical self-preservation" override is left to the balance pass as decided.

### H5 — SIM-ENGINE: `nearestTag` stages fail at once when the only candidate's slot is reserved
e.g. Put Away Leftovers / Cook… stage 0 while a housemate stands at the single fridge → "No free fridge" and an
autonomy backoff. A short wait (like `wait` for pairs) when the only matching object is merely reserved would make
kitchens with one fridge smoother. HOME mitigates (one cook at a time) but can't wait inside a stage resolution.


---
**ACKNOWLEDGED by integration lead:** H1–H5 queued in docs/INTEGRATION_BACKLOG.md (items 2–5 + balance section) for the phase-2 integration pass.
