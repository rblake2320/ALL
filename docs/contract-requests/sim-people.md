# SIM-PEOPLE — contract requests & coordination notes

Nothing blocks SIM-PEOPLE; every item below is worked around locally (see `src/sim/systems/people/README.md`).

## R1 — Who owns the six SkillDefs? (decision needed)
The cross-module agreement for the life modules says "Skills … SkillDefs are provided by PEOPLE"; SIM-ENGINE's
registry treats skills as engine-owned and reports any later definition as a content problem
(`src/sim/engine/registry.ts`, README §1.3), which would fail `validateContent()`.

**Workaround:** PEOPLE exports `PEOPLE_SKILLS` (same ids, icons and GDD §7 xp curve; PEOPLE flavour text) from
`src/sim/content/people/skills.ts` but only registers them when `REGISTER_PEOPLE_SKILLS` is `true` (currently `false`).
**Request (pick one):** (a) keep the engine's SkillDefs — PEOPLE deletes the switch; or (b) PEOPLE owns them — the
engine drops its `skills` from `engineContent`, PEOPLE flips the switch (one line). Gameplay is identical either way.

## C1 — Api binding (resolved decision #1, implemented)
All five people apis read the SimContext appended as the LAST argument (`makeApi` in
`src/sim/systems/people/util.ts`); without it they fall back to the context of the system's latest hook. Covered by
`tests/unit/people/adversarial.test.ts` ("two simulations side by side"). `createPeopleSystems()` additionally returns
fresh system instances for hosts that want per-simulation objects.

## C2 — Preservation while at work (coordination with SIM-HOME)
HOME's `decay` system ticks `atWork` zombies at the normal rate. Careers therefore applies only the GDD §10 away rates
for hunger/energy/fun/social/hygiene and touches preservation only when no `decay` system is registered.
**Please keep** decay's `atWork` coverage (or tell PEOPLE if it changes, so freshness neither freezes nor decays twice).

## C3 — Carpool hearse hint for RENDER (optional)
`state.flags['people:carpool:until']` = tick until which the carpool hearse should idle at the curb (set when it
honks at T−30, extended to start + 60 min, shortened to now + 2 min when the zombie leaves). RENDER may show
`env_hearse` at the first entry point while `flags['people:carpool:until'] > state.tick`. A carpool `sfx`
(`carpoolHonk`) and a `puff` fx at the curb are emitted at arrival.

## C4 — Phone parameter vocabulary (for UI-HUD / GAME)
| interaction | params | notes |
|---|---|---|
| `phone_inviteOver` | `{ townieId }` | acquaintances accept at 0.55 + friendship/150; strangers are a cold call (35 %); refused after 23:00 |
| `phone_throwParty` | `{ guests?: 'a12,a15,…' }` | picked guest list (max 6 incl. visitors already present), else friends → acquaintances → strangers |
| `phone_findJob` | `{ careerId }` | |
| `phone_orderPizza` / `phone_quitJob` / `phone_callInSick` | — | pizza goes through `sys('food').orderPizza(actorId)` |
Menu children: invite → every townie (acquaintances first, strangers labelled "cold call"); findJob → the five careers;
other phone entries return `children: []` (the HUD already treats an empty list as "no submenu").

## C5 — Observation for SIM-ENGINE: loads are not byte-identical
`createSimulation(JSON copy of a live world)` bumps `lot.version` during repair, so `serialize()` of the copy differs
from the original in `lot.version` and every running stage's path-cache key `run.data._v`. Gameplay state matches
(people integration test normalises those keys). Harmless, but a deterministic-replay test comparing raw JSON would
flag it.

## C6 — Observation for SIM-HOME / SIM-ENGINE: freshness under full autonomy
In 7-day fully autonomous probes (normal difficulty, starter lot, 2–3 zombies, no player input) zombies often let
freshness reach 0 and crumble around day 5–7; preservation restores rarely out-score other needs. PEOPLE removed its
contribution (socials no longer fire at full Company, are damped for targets in crisis, and don't chase zombies on
the move). A critical-preservation nudge (like feral hunger) or stronger advertise on preservation interactions may
be worth a look — not blocking.

## C7 — Note for SIM-ENGINE README §8: non-adjacent socials
`social_waveOver` uses stage target `{ kind: 'tileNear', radius: 5, of: 'target' }` (agentAdjacent fallback) so
zombies wave from the yard instead of chasing walkers down the sidewalk. Such a social runs without
`engine_respond` (no wait phase); the `social` behaviour turns the target, plays its reaction anim and makes walkers
linger (`visit_linger`) while someone is waving. Works with the current engine; worth one sentence in §8.


---
**RESOLVED by integration lead:** R1 → option (a): skills stay ENGINE-owned; please remove the REGISTER_PEOPLE_SKILLS switch / unused export. C1–C4, C7 accepted (recorded in docs/CONTRACTS.md decisions #10–#12). C5 → engine contract: repairWorld must be a no-op on healthy worlds (decision #9). C6 → logged as known balance issue #13 for the integration balance pass.

---
## Hardening pass (independent hardener) — notes for the integration lead

Nothing blocks SIM-PEOPLE. Fixed inside PEOPLE's paths (details in `src/sim/systems/people/README.md`):
- **Doorbell after a welcome**: the engine re-queues a suspended `visit_waitAtDoor` after the welcome social, so a
  visitor walked back out and rang again. The ring schedule now lives in `people:bell:<id>` (no stage `sfxStart`) and
  a stale door wait of a welcomed visitor is refused in `begin` (party guests walk up once via `params.greet`).
- **Silent Loners / lonely zombies**: Loner `tagAd.social` −10 → −3, and non-hosting socials advertise a
  conversation's Company (2 × 8). Households of Loners sat at Company 0 (65 % of hours < 15); now ~0 %.
- **Emergency pizza (decision needed? — FYI)**: `phone_orderPizza` is now autonomous, but its `adjustScore` vetoes it
  unless the lot has nothing to eat (no working powered fridge/microwave, no unspoiled meal) and the zombie is hungry
  (≤ 35 or feral), $35 is available and nothing was ordered in the last 3 h. Observed: a kitchen fire destroyed fridge
  + stove + microwave and a household with $7,900 starved and crumbled by day 5. Please confirm this is acceptable
  design (it only fires when the alternative is starving).
- Socials never target a zombie heading for the carpool or a leaving guest; one host per welcome / wave-over.

### Observations for other modules (not fixed here — not PEOPLE's paths)
- **H1 (SIM-HOME, fire)**: a single kitchen fire can spread and ash the fridge, stove and microwave; nothing ever
  replaces them autonomously (see the emergency pizza above).
- **H2 (balance, #13 related)**: day-job workers come home with Amusement ~40 lower (GDD §10 away rate −4/h) and the
  engine keeps decaying fun/hunger/hygiene at the full *awake* rate while asleep (GDD §3 table says "Base decay /h
  (awake)"), so in 4-day probes a worker's Amusement is < 15 in ~20 % of their on-lot hours (stay-at-home zombies ~0 %).
  Candidates: reduced non-energy decay while asleep (ENGINE), more/longer fun sources (HOME).
- **H3 (SIM-HOME, autonomy spam)**: `home_slamDoor` (`traitAd` hothead +12) ran 35–56 times in 4 days for Hothead /
  Grumpy zombies; `home_practiceSpeech` (ambitious +8, 45 min) up to 36 times.
- **H4 (GDD §3 gap, unowned)**: "feral zombies may nibble a nearby zombie (big social penalty both ways)" is not
  implemented by any module. PEOPLE could add a hidden `social_feralNibble` (feral-only, hunger ad) if the lead wants
  it — say so and it will be added.


---
**RESOLVED by integration lead:** emergency pizza APPROVED as designed. H1 → backlog #15 (fire severity). H2 → backlog #12 (reduced non-energy decay while asleep, engine). H3 → backlog #13 (autonomy repetition penalty, engine). H4 → YES please: add hidden `social_feralNibble` (backlog #14; engine feral override will use it).
