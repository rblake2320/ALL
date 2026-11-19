# Contract requests — SIM-ENGINE

All items are already shimmed locally (engine-internal, documented in `src/sim/engine/README.md`); nothing is blocked.
They are proposals to make the seams explicit for other modules.

## 1. `SimContext.failRun(agent, reason)` (or failure-returning effect handlers)
**Problem.** `EffectHandler` returns `void`, so a *system* effect cannot fail the run it executes in with a
player-facing reason (the engine's own `spend` effect does this internally: "Can't afford"). Systems can only call
`ctx.interrupt(agent, reason)`, which is a graceful *cancel* (no failure notification / `interactionFailed`).
**Proposal.** Add `failRun(agent: AgentState, reason: string): void` to `SimContext` (fails the active run at the
next safe point, reason shown to the player for player-sourced runs). Engine already has the mechanism
(`Engine.pendingFail`); exposing it is a one-line facade.

## 2. Repair warnings on the public API
**Problem.** `createSimulation(state)` repairs the save but `SimulationAPI` has no way to hand the warnings to
GAME/PLATFORM (for a "this save was repaired" toast). Today they are on the internal `EngineSimulation.repairWarnings`
and `repairWorld(state)` (exported from `src/sim/index.ts`) returns them.
**Proposal.** Add `readonly repairWarnings: string[]` to `SimulationAPI`.

## 3. Optional `DecayApi.preservationPerHour(agentId): number`
**Problem.** `NeedView.trend` for preservation can only be estimated by the engine (GDD base 1.3/h); the decay
system knows the real rate (coffin, sun, hygiene, hunger, exercise multipliers).
**Proposal.** Add the optional method to `DecayApi`. The engine already calls it when present.

## 4. SkillDef ownership
`src/sim/engine/content.ts` registers the six `SkillDef`s (GDD §7). SIM-PEOPLE keeps an identical copy behind
`REGISTER_PEOPLE_SKILLS = false`. The registry accepts a later module redefining a skill (reported as a content
problem, so `validateContent` fails). Please confirm the owner in CONTRACTS.md; either way only one module should
register them.

## 5. Engine scratch keys in `ActiveInteraction.data`
The engine stores its routing/run bookkeeping in `run.data` under keys starting with `_` (e.g. `_uo` used object,
`_ut` watched target, `_rk` resolution kind, `_rs/_re` route timing). Proposal: document in `types.ts` that
`data` keys starting with `_` are engine-reserved so behaviours never collide with them.


---
**RESOLVED by integration lead:** 1 → `SimContext.failRun` added; 2 → `SimulationAPI.repairWarnings` added; 3 → already in DecayApi; 4 → ENGINE owns SkillDefs (decision #8; SIM-PEOPLE removes its switch); 5 → documented in types.ts. See docs/CONTRACTS.md #18.
