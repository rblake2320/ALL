# W-117 Local playtest session log

Status: **built (client only, no network)** — 2026-11-06. Decision: D-064 (number may be renumbered at merge; W-116
adds D-061+ concurrently). Code: `src/feedback/sessionLog.ts` (pure recorder + strict storage form),
`src/feedback/sessionSummary.ts` (`summarizeSession`), `src/game/sessionLog.ts` (service: wiring, consent,
persistence, export), `src/ui/feedback/SessionLogDialog.tsx` (Pause → "Copy session log"), Settings → Help toggle +
Clear. Tests: `tests/unit/feedback/sessionLog*.test.ts`, `tests/e2e/session-log.mjs`.

## 1. Why (owner direction)
Playtests yielded only the player's written notes. Industry practice pairs observation with behavioural data: a
step-level onboarding funnel (step id + time since session start), time to first meaningful action, stalls,
non-productive clicks, segmentation by platform. The constraint is E10+ / COPPA: **record locally only**, no account,
device or persistent identifier, nothing uploaded, export only when the player chooses, under-15 local-only. The
claude.ai test page blocks file downloads, so the export is **copy-to-clipboard text** (plus a file where downloads
work).

## 2. What is recorded (closed vocabulary + numbers only)
Every event is `{ t, k, a?, n?, m?, g?, c? }`: `t` = ms since the session started (monotonic clock), `k` = kind,
`a` = closed-vocabulary id (W-110 trail alphabet `[A-Za-z0-9:._-]`, ≤ 62 chars), `n`/`m` = numbers, `g` = sim tick,
`c` = merged repeat count.

| Kind | What | Source |
|---|---|---|
| `start` / `end` | entry (`boot`, `newGame`, `continue`, `enabled`, `resume`, `cleared`) / reason (`newGame`, `newWorld`, `pagehide`, `dispose`, `disabled`) | service |
| header | session id (random), ring seq, UTC date, build SHA, version, bracket, platform segment (desktop / phone via `isPhoneLayout`), orientation, viewport, dpr, web/desktop shell, coarse pointer, quality setting + level, GPU kind + ceiling | service |
| `screen` `mode` `speed` `dialog` `key` `error` | the W-110 EventTrail taps (same hook points: setScreen, setMode, setSpeed, openDialog, KEYMAP actions, `Core.report`) — errors by fault-barrier code only | `EventTrail.listen` |
| `world` | `new:<lot>` / `load:saved`; difficulty, story arc | CAZ state at loading + world flags |
| `step.on` / `step.done` / `quest.done` | every quest step activated / completed (`<questId>.<stepId>`, time in step), Bones awarded | drained `questStarted/Progress/Completed` + active quests at world entry |
| `first` | first successful player `queue` or `buy` → time to first action + type | command observer |
| `cmd` `buy` `build` | player commands: interaction id + target def id, cancel, buy/sell/move/undo/redo (def id, funds delta, funds after), build command type, choice option index, reward id, quest action; rename/cheat recorded **without** their text. A refused queue order is `queue.refused.<code>:<ix>:<target>` with the closed W-131 `failureCode` of the sim's reason (e.g. `nothingToDo` for "Already spotless") | `GameSession.setCommandObserver` (read-only, after dispatch) |
| `cmd` `buy` `build` | player commands: interaction id + target def id, cancel, buy/sell/move/undo/redo (def id, funds delta, funds after), build command type, choice option index, reward id, quest action; rename/cheat recorded **without** their text | `GameSession.setCommandObserver` (read-only, after dispatch) |
| `quest.go` | a quest / task row's Go (W-123): `<questId>.<stepId>` / `daily.<taskId>` / `weekly.<challengeId>` + `:<queue|mode|missing|blocked>` — ids and the resolved kind only | `GameController.questGo` |
| `job.assign` / `job.done` / `job.blocked` | household jobs (W-124, D-071): a job was assigned / finished (nothing left, its one real completion, or a daily window's "done for now") / got blocked — the job **category id** only (`clean`, `play`, …), never names, targets or the reason text | drained `job` sim events |
| `click.none` | world clicks/taps that changed nothing (`live:noSelection`, `live:nothing`, `buy:refused`, `buy:empty`, `build:none`), refused locked controls (`locked:ultra`, `locked:item`) | controller click wrapper (probe before/after) |
| `stall.start` / `stall.end` | ≥ 60 s with no player input while in game, unpaused, no dialog, tab visible; idle time counts only while eligible | service frame clock + page input listeners |
| `auto.ix` / `auto.spend` | autonomous household interactions completed (idle fidgets folded into `engine_idle`); sim-side spend by closed category (`groceries`, `bill`, `theft`, `pizza`, `ix:<interactionId>` mapped from the content label, `other`) — the funds reason text is never stored | drained events |
| `sim` | notable event TYPES: `notify.<kind>`, `fx.fire`, `fx.smoke`, `theft`, skillUp, promotion, milestone, choice, interactionFailed, agentSpawned, gameOver | drained events |
| `ix.fail` / `ix.drop` / `ix.done` | W-131 order trace, `<source>:<interactionId>:<code>`. `ix.fail`: a player/system run failed, `code` = `failureCode(reason)` (closed: `nothingToDo`, `noRoute`, `targetGone`, `inUse`, `noPower`, `broken`, `needs`, `needLow`, `fault`, `interrupted`, `other`). `ix.drop`: a queued order left the queue without running (`targetGone`, `leftLot`, `queueFull`). `ix.done`: a player order completed. Counts survive eviction as `order.<outcome>:<source>:<code>` (and `order.refused:<code>`). The reason TEXT is never stored | drained events (`interactionFailed`, `orderDropped`, `interactionCompleted`) |
| `hour` | each in-game hour: funds, lowest need id + value (household members on the lot) | state read |
| `fps` / `quality` | one fps sample per 30 s in game; quality level changes | renderer |
| `log` | CAZ member count, platform segment / orientation changes, feedback trail marks | service |

Aggregates kept beside the ring (survive eviction): funnel (≤ 400 steps), quests + Bones, stalls (≤ 100),
non-productive clicks (count, by reason, first 100 timestamps), player / sim-side / refund spend totals by id,
autonomous interaction counts, notable counts, error counts, fps min/avg/max, mode/speed/dialog/command counters.

## 3. Privacy by construction
- The recorder API takes ids and numbers; strings pass `trailKey` (reduced alphabet). It never reads names,
  notification text, funds reasons, hover labels or anything typed. `renameHousehold` / `cheat` are recorded as
  `cmd rename` / `cmd cheat` only.
- No persistent identifier: the session id is `S-` + 8 Crockford symbols from the platform CSPRNG (never the sim RNG,
  never `GameEnv.randomU32`, so recording cannot shift the game's random stream) and exists only in this log; the ring
  keeps 3 sessions. Only the UTC **date** is stored, no clock time.
- **Consent / age:** Settings → Help "Record playtest session log (stays on this device)". Default ON for an answered
  15+ profile, OFF for under-15. While the age question is unanswered, events are kept in memory only (never written);
  an under-15 answer drops them, a 15+ answer keeps them (so the first-launch onboarding funnel is not lost for
  teens/adults). An explicit choice overrides the default and is remembered (`slog-index`). Under-15 (if a parent
  switches it on): copy only, no file export. **Clear session log** restarts the log at once, then writes each slot's tombstone twice (so the rotated backup holds no session either) and removes the slot and its backup from the store; saving waits until Clear is done.
- No network code exists for this feature.
- PII property test plants names / e-mails / phone / street text in CAZ, the household, a rename and a world
  notification, plays the real sim, and asserts the stored records and the summary contain none (case-insensitive).

## 4. Summary (`summarizeSession(log)`, pure)
Header (session, date, build, platform, graphics, bracket, duration, end reason, world) → **Act 1 funnel table**
(`#  step  reached  in step  done at  sim`) + beats and Bones → other quest steps → time to first action → stalls →
non-productive clicks (by reason + timestamps) → purchases (player vs household sim-side vs refunds, totals by id) →
autonomous interactions → notable events → last 12 hourly funds / lowest-need samples → fps + quality → errors →
counters → **raw events**, one compact line each (`m:ss.mmm kind id n= m= @D1/09:25 ×count`).

## 5. Storage
The existing crash-safe ProfileStore (checksummed records, `:bak` rotation, atomic backend writes) via the
coalescing ProfileWriter: `profile:slog-a|b|c` (one session each, compact tuple events), `profile:slog-index`
(`{ v:1, enabled }`). The live session is written at most every 10 s when it changed, on tab hide / pagehide / quit /
dispose, and when it ends; a crash keeps the previous good copy (tested with a backend that throws or tears the
write). On load every record is re-validated (`fromStored`): unknown kinds, bad alphabet, non-finite numbers are
dropped. Ring order = `header.seq`; the newest overwrites the oldest. Ring of 5,000 raw events per session (oldest
evicted, counted). Worst case ~300 KB per slot.

Sessions: one starts at app boot (so menu → New Game → CAZ → game is in the funnel); a second world in the same run
(New Game again, Load/Continue from a session that already has a world) ends it and starts a new one; a page restored
from the back/forward cache starts a new one.

## 6. Determinism (D-003 / D-012)
The service only reads: EventTrail taps, the command observer runs before (reads funds/def ids) and after
`sim.dispatch` without touching the command or result, drained events are already drained for the renderer/router,
state reads are plain property reads. Proven by `sessionLog.game.test.ts › determinism`: the same scripted play with
the recorder ON vs OFF gives byte-identical canonical saves.

## 7. Verification
- `tests/unit/feedback/sessionLog.test.ts` (12): ring bound + eviction + aggregates survive, merge, stall 59 s / 61 s /
  pause excluded / background gap cap (fake timers), first action set once, click counting, strict storage round trip
  + tamper, summary layout.
- `tests/unit/feedback/sessionLog.game.test.ts` (9): under-13 OFF, 13+ ON, unanswered age memory-only, toggle + Clear,
  crash mid-write (clean + torn, 1st/2nd write), last-3 retention across 5 games + reload, non-productive clicks via
  real pointer events + locked Ultra + first action, PII property test (real sim), determinism ON vs OFF.
- `tests/unit/feedback/sessionLog.act1.test.ts` (1): the scripted Act 1 player on the real sim → 14 steps in order,
  8 beats, 340 Bones in the summary.
- `tests/e2e/session-log.mjs`: real Chromium, derelict new game with planted names, 2 actions + a ground click,
  Pause → Copy session log → clipboard holds the header, Act 1 step lines, first action, purchase, click, no names.

## 8. Not in scope / follow-ups
- No upload (would need W-097 + consent flow of docs/systems/telemetry.md).
- Autonomous **object** purchases do not exist in the sim today; "sim-side spend" covers autonomy / interaction costs
  (including costs of player-queued interactions, which the funds event cannot attribute), bills, theft.
- A tester-facing "mark a moment" button (free text is deliberately excluded).
