# Quests plugin (`src/sim/systems/quests`)

Spec: docs/MONETIZATION.md §2. Contract types: `src/sim/contracts.ts` (`ObjectiveDef`, `QuestDef`, `QuestsApi`,
`QuestsView`, quest `SimEvent`s, `Command {type:'quest'}`), save format `src/sim/types.ts` (`WorldState.quests?`,
`QuestsState`, `ObjectiveProgress`). Content: `src/sim/content/quests/` (10 story, 20 neighbourhood, 40 daily tasks).

## Guarantees
- **Never feeds back.** The system writes only `state.quests` and emits quest events. It never draws from `ctx.rng`,
  never takes ids/uids, never notifies, never writes stats/needs/funds/queues. Proof: `tests/unit/quests/isolation.real.test.ts`
  steps the same scripted game with and without the system and requires byte-identical worlds outside `state.quests`;
  the balance fast test and the engine determinism/save-load suites run unchanged with the system registered.
- **Deterministic & save/load safe.** All progress lives in WorldState. EVENT objectives advance in `onEvent`
  (synchronous engine observer); STATE objectives are re-read every 4 ticks (1 game minute). Neighbourhood offers are
  picked by `fnv1a(worldId|day|slot)` among eligible ids, at `dayStart` only.
- **Idempotent grants.** `grantId = <worldId>:<questId>:<instance>`; `instance = completions + 1`. `worldId` is derived once
  from the world itself (seed, RNG state, household, tick) and stored — replaying a new game or re-loading an old save
  maps the same completion to the same grant id; save-slot copies share it on purpose (no farming by copying a save).
  Every completion is recorded in `state.quests.grants` (last 256) and exposed by `sys('quests').grants()`, so the
  game layer reconciles grants whose `questCompleted` event it never saw (crash between autosave and ledger write).
  The profile ledger refuses duplicate keys; healing never lowers `completions` below a granted instance.
- **Rewards** are Bones + `cosmetic:*` entitlements only (validator rejects anything else); repeatables grant no
  entitlements.
- **Build exploits.** `own`/`roomEnv` must hold for `holdMin` game minutes (default 15). Build mode pauses time and
  the undo history is cleared when leaving it, so a buy that is undone inside the session never completes a step.
  `own.fresh` counts objects whose id ≥ the world's `nextId` at objective start (undo/redo restores original ids, so a
  sold-then-restored old object never counts as new). Completed steps latch.
- **Robust.** Duplicate deliveries are de-duplicated by event key (`ic:<runUid>`, `su:<agent>:<skill>:<level>`, …);
  visitor/townie completions don't count; removed agents/objects simply stop counting. `healQuestsState` (on every
  init) drops unknown quests, re-numbers instances, raises completions from the grant log, resets broken progress — and
  is a strict no-op on a healthy state (decision #9). The persistence schema (`src/persistence/validation/questsSchema.ts`)
  keeps an absent block absent (old saves: zero warnings) and drops a broken one with a warning (never fatal).

- **Arc credit (W-116, D-061).** In a story-arc world `state.quests.arcLog` counts household events matching each arc
  EVENT step that is not running yet (since the arc's first quest started; de-duplicated by event key, capped at the
  step's target). A starting arc step takes that count once (`ObjectiveProgress.credited`, `questProgress.credited`);
  `walls` / `own.fresh` steps baseline at the arc start, `billsOnTime` counts from it. The event that finishes a step
  is logged only after the running steps, so it never also credits the step it starts. Classic worlds never log.

## Offering rules
- Story: start as soon as `requires` are complete, ≤ 3 at once by `order` (a DAG, so a slow step never blocks the chain).
  Story quests cannot be abandoned and never repeat.
- Neighbourhood: 2 slots, refilled at `dayStart` among quests with prerequisites done and `day - lastEndedDay ≥ cooldownDays`.
  Abandoning (`{type:'quest', action:'abandon'}`) frees the slot and starts the cooldown; the instance number is reused
  (it was never granted).

## Game-layer reuse (daily tasks)
`objectives.ts` is pure: `startObjective`, `observeObjectiveEvent` (drained events), `evaluateObjectiveState`
(periodic), `objectiveWorldOf(sim)`. Progress carries `worldId`; evaluated against another world it re-baselines
(keeps progress, counts only new growth), so switching saves never completes a task. Daily data:
`DAILY_TASK_POOL` (kinds restricted to "new activity" — `validateDailyPool`), picker `pickDailyTasks(pool, key)`.
