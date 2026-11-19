# W-124 Household jobs — design note (D-071)

Owner request: "zombies can be given broad tasks such as yard work, cleaning or play". The examples are not a closed
list. A **job** is a persistent assignment, part of the world. For example: "Mort, clean the kitchen until it's done",
or "Ghoulia, play every evening from 6 PM to 9 PM". The zombie picks real targets by itself, gives way to urgent
needs, and stops when nothing is left to do.

## 1. Model (`WorldState.jobs`, schema v2)

| Field | Meaning |
|---|---|
| `id` | `j1`, `j2`, … (`JobsState.nextId`, never reused) |
| `agentId` | household member |
| `category` | `src/shared/jobs.ts` `JOB_CATEGORIES` id |
| `scope` | `{kind:'lot'}` · `{kind:'room', x, z}` (the room that contains a **lot-local** anchor tile; room ids are recomputed when walls change, so the anchor persists instead) · `{kind:'object', id}` |
| `mode` | `once` (one real completion) · `untilDone` (until nothing remains) · `recurring {from, to}` (each day inside `[from, to)` game hours; it may wrap past midnight) |
| `priority` | `high` / `normal` / `low`. The run order is priority, then the player's order. |
| `paused` | paused by the player |
| `lotId` | the W-025 seam: always `null` (the one simulated home lot) until town state exists. A job that belongs to another lot never runs. |
| runtime | `status`, `reason`, `runUid`, `interactionId`, `targetKey`, `targetName`, `before` (the measured state when the run was queued), `reached`, `done`, `breakNeed`, `nextCheckTick`, `skips[]`, `restKey`. All of it is saved, so a reload continues byte-identically. |

Changing anything goes through ONE ordinary command, `{type:'job', action:'assign'|'cancel'|'pause'|'resume'|'priority'|'move', …}`.
The command is journaled like every dispatch and validated by the jobs system (`src/sim/systems/jobs`).
`GameController.job(cmd)` is the UI's only way in. Limits: 6 jobs per zombie, 24 per household, and no duplicates.

Saves are versioned. `SAVE_SCHEMA_VERSION` is 2, and the v1 → v2 migration gives old saves an **empty** list:
a hand-edited v1 `jobs` key is discarded. Saved data is untrusted.
`src/persistence/validation/jobsSchema.ts` checks the structure: each broken entry is dropped on its own, unknown keys
are stripped, and every value is bounded. On load, `healJobsState` checks the meaning: it drops jobs of non-members,
unknown or "coming later" categories, `untilDone` on open-ended work, and over-limit lists.

## 2. Runtime

- **Picking.** The engine has a new hook, `SimSystem.beforeAutonomy(ctx, agent)`. It is called for an idle household
  member right before free will, whatever the free-will setting. At that point the first runnable job asks the W-123
  core: `resolveActivity({category}, world, agent, {all: true})`. The core returns ranked candidates, validated by the
  engine's own menu, with the nearest reachable first. Objects another member queued or uses are already excluded.
  The job then filters the candidates by agent targets another member queued, by its scope, by the targets it skipped,
  and by "free interactions only". The run is an ordinary `auto` queue item marked `params.jobId`. When it ends, the
  next one starts at once, between interactions. Assigning or resuming a job also cuts short plain free-will leisure
  (never sleep, never an uninterruptible step).
- **Urgency.** The thresholds are the engine's own (`home/autonomy.ts URGENT_HELP`: hunger 40, energy 35, hygiene 25,
  freshness 35, fun 15, social 15). Below one of them, the job's run is gracefully interrupted and the job takes a
  `break`. Needs the work itself restores never count: playing while bored is fine. Free will looks after the need, and
  the job resumes once the need is `RESUME_MARGIN` (20) points above its threshold (hysteresis).
  **A need capped under (or at) its threshold** (freshness cannot exceed vitality, so vitality 35 or less can never
  clear the freshness threshold 35) uses a lower line for that need only: just above the neglect line
  (`VITALITY_NEGLECT_BELOW + 1`, or one under the cap if lower). The zombie can then work at its cap and still stops
  before it is worked into neglect. Needs whose cap clears the threshold keep the engine's number.
  With **free will off** the player is in charge, so only the engine's critical overrides interrupt (feral hunger,
  passing out). The job resumes after them.
- **Completion is real.** A run counts only when it COMPLETED and the measured state changed:
  - mess (grime + trash fill + spoiled food + a dish or ash pile lying about) went down;
  - broken → fixed;
  - fun or company rose by at least 1 point;
  - skill XP rose.
  A completed run that changed nothing ("Made no difference") is not progress. Its target is skipped for 60 game
  minutes.
- **Ends.**
  - `once`: the first credited completion.
  - `untilDone`: nothing remains. For cleaning, no in-scope object where the engine's menu offers one of the chores
    or refuses it only because the object is in use / this zombie has no arm for it (that work is still left, and the
    job says why it is blocked; "already spotless" style refusals mean nothing is left);
    for repairs, nothing broken; for play and social, the need is at 92 or more. The zombie gets a toast.
  - `recurring`: idles politely outside its window ("Starts at 6 PM"). Inside the window it works whenever there is
    work, and says "done for now" once per window. Closing the window cancels queued or active job work through
    the engine's normal cancellation path; the assignment remains for its next window, including overnight schedules.
- **Blocked.**
  - An unreachable target is never queued (engine distance field). The job says why: "Can't get to the Rickety Table".
  - A target that disappears mid-run fails that run. A lot job moves on to the next target; an object job reports
    "It's gone".
  - A run that never arrives is skipped for 60 minutes.
  - Blocked jobs look again every 30 game minutes.
- **Cancel / pause** act immediately: the run is cancelled (the engine's graceful exit) and nothing is queued again.
- **Money.** Jobs never buy anything. Costly interactions are never picked. On top of that, `ctx.spend` refuses any
  spend made while a job-marked run executes, whether it comes from effects or behaviour hooks (for example groceries).
- **Permissions.** Household members only, on their home lot only. Scopes and places are lot-local tiles, never
  neighbourhood-map coordinates.

## 3. Categories (honesty rule)

A category is **available** only when it is not flagged `later` AND at least one of its routes is an implemented
interaction: it exists in the registry, it is visible, it is free, and an object def (or an agent target) hosts it.
The rule is computed (`jobCategoryStatuses`), and `tests/unit/shared/jobs.test.ts` fails if a visible category has
zero routes.

| Available now | What it runs | Real change |
|---|---|---|
| Cleaning | dishes, ash, wipe tables / counters, clean stove, empty trash, toss spoiled leftovers, put leftovers away | mess down |
| Repairs | repair broken objects | broken → fixed |
| Play | video games, arcade, chess, TV, music, dancing | fun up |
| Hobbies | paint, read, chess, program, stitch | skill XP |
| Study | read, program, practice speech | skill XP |
| Exercise | workout, dance | fitness XP |
| Socialize | chat / joke / compliment visitors (not housemates, no phone calls) | company up |

| Coming later (disabled) | Why |
|---|---|
| Yard work | Garden plots and yard chores arrive with yard building (W-109). Today's only yard "chore", watering the dead fern, changes nothing. |
| Cooking | Every recipe buys groceries, and jobs never spend money. |

## 4. UI

The agent panel has a **Jobs** tab (between Skills and Career). Each job row shows the category and scope, the mode,
the status with its current target or reason, the progress (`3 done`, `Fun 64 / 92`), and buttons for priority
(cycles), up, down, pause / resume and cancel. "Move up" past a job of a different priority takes on that job's
priority.

The new-job form has these controls:
- a category radiogroup (arrow keys; "Coming later" chips are disabled and explain why);
- **Where** (whole lot, the rooms that host the chore, the objects);
- priority;
- **How often** (Once / Until done / Daily, with Until done disabled for open-ended work);
- the daily window.

Accessibility: every control is a real `<button>` or `<select>` with a label, status lines are polite live regions, and
on phone (`.hud[data-phone]`) every control is at least 44 px. The CSS is self-contained (`agent/jobs.css`, only
`.hud-job*` selectors) so it does not collide with W-118.

## 5. Session log

The session log has three new kinds: `job.assign`, `job.done` and `job.blocked`. Each carries the category id only,
never a name, a target or the reason text.

## 6. Limits / follow-ups

- Yard work waits for W-109 garden content, and cooking waits for a "job grocery budget" decision.
- Social jobs only talk to visitors. Inviting someone over is a player decision.
- Room labels are guessed from what the room holds (Kitchen, Bedroom, Bathroom, Living room, Room).
- A target that someone else improves while the job walks to it is still credited to the job, because the state did
  change.
- Town lots (W-025): `lotId` is ready, but only the home lot runs.
