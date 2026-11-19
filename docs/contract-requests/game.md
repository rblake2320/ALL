# Contract requests — GAME (controller · loop · input · bootstrap)

Status legend: **[adopted]** already in a contract file · **[open]** please consider · **[fyi]** behaviour other
modules should know about (no contract change needed). Every open item has a local adapter in `src/game/**`, so
nothing is blocked.

## 1. `src/game/contracts.ts` (integration lead)

- **[adopted]** `appVersion`, `content`, `validateCazDetailed`, `dialogOptions` + `openDialog(d, opts)`,
  `ultraAllowed`, `rotateCamera`, `focusObject`, `buyReward`, `renameHousehold`, `markNotificationsRead`,
  `BuyState.hoverObjectId`, toast ownership (controller TTL ≥ 60 s safety net, list capped at 20), KEYMAP ownership
  rule — all implemented.
- **[open] Bootstrap hooks.** `createGameController()` returns `GameControllerImpl` (a subtype) with
  `boot(canvas): Promise<void>` (idempotent; installs DOM/input handlers, inits the renderer, waits for assets, enters
  the menu) and `dispose()` (HMR/tests). Please add both to `GameController` (or document `GameControllerImpl`) so a
  second bootstrap (dev harness, Electron preload variant) can use them without a cast.
- **[open] `gameOverReason: string | null`** — the sim `gameOver` event carries a reason ("Rest in Pieces"); the
  GameOver screen has no contract field to read it. Implemented on `GameControllerImpl`.
- **[open] `lotTemplates: readonly LotTemplate[]`** — the New Game screen needs names/descriptions/funds before a sim
  exists (UI-SHELL currently hard-codes `LOT_FUNDS`). Implemented on `GameControllerImpl` (from `LOT_TEMPLATES`).
- **[open] `validateCazDetailed()` field set** has no slot for household-level issues without an input of their own
  (lot, difficulty, member count) or for a corrupt appearance. Today they are reported as
  `{memberIndex: null, field: 'householdName'}` and `{memberIndex: i, field: 'firstName'}`. Suggest adding
  `'household' | 'appearance'` to the union.
- **[fyi] Name limits.** Validation follows the brief: names 1–24 code points (trimmed; control characters and
  invisible-only names rejected), exactly 3 non-reward traits, no conflicts (checked symmetrically), aspiration
  required, first names unique per household (case-insensitive). UI-SHELL's `NAME_MAX = 16` input cap is stricter,
  which is fine.

## 2. Semantics other modules rely on (please mirror in the contract comments)

- **[fyi] `version`** is a change counter bumped on every notification flush (throttled ≤ 12/s; discrete changes
  flush immediately; a throwing listener never blocks others).
- **[fyi] Screen flow.** `goto('newGame')` creates the CAZ state if absent (so `updateCaz` works there);
  `beginNewGame()` goes to `'caz'` (keeping lot/difficulty when called from `'newGame'`, fresh household otherwise).
  `goto('menu')` from `'game'` = `quitToMenu()`; from the crash screen it recovers (tears down, back to the menu).
  `'boot' | 'loading' | 'gameOver'` are controller-owned. From `'game'`, `goto('newGame'|'caz')`/`beginNewGame()`
  autosave and quit first.
- **[fyi] `sim` is null on the menu** — the living diorama behind the menu is an internal demo world (fixed seed,
  3 zombies, 1×, full autonomy, silent, never saved, rebuilt every 20 min).
- **[fyi] Auto-pause "holds".** The effective `speed` is 0 while a hold is active: a pending choice (if
  `autoPauseOnEvents`), a system dialog (`settings, saveLoad, pause, help, confirmQuit, credits, diagnostics` — HUD
  dialogs like phone/careers do not pause), the tab hidden (`pauseWhenUnfocused`), buy/build mode, a transition.
  Any explicit `setSpeed`/`togglePause` clears all holds. Ultra (4) is clamped to 3 with a toast unless
  `ultraAllowed`; it drops back to 3 automatically when someone wakes up.
- **[fyi] Build/buy.** Entering buy/build pauses; leaving to live dispatches `endBuildSession` (buy⇄build keeps the
  session). `applyBuild`/`sellObject` are refused in live mode. Placement keeps going after each click until
  Esc/right-click; a picked-up object is hidden via `setHiddenObject` until placed or cancelled.
- **[fyi] Interaction menu.** Tile menus always contain `engine_goHere` (synthesised if the sim omits it). Clicking
  another household member adds a synthetic first entry `interactionId: '__game_select'` ("Control <name>") —
  render it like any entry; `chooseMenuEntry` handles it locally. Entries with `children` need `child` passed.
- **[fyi] `phone(action, params)`** accepts the HUD vocabulary (`invite | party | pizza | findJob | quitJob |
  callInSick` = `InteractionDef.params.action`), a `phone_*` id, or a suffix (`orderPizza` → `phone_orderPizza`).
  Params are filtered to finite primitives; `__proto__`/`constructor` keys dropped.
- **[fyi] Tutorial hint anchors** (`hint.anchor`): `household-portraits`, `needs-panel`, `speed-controls`, `funds`,
  `mode-buy`, `mode-build`, `phone`, `buy-catalog`, `build-tools` (exported as `HINT_ANCHORS` from
  `src/game/hints.ts`). UI-HUD: please tag those elements (e.g. `data-hint-anchor="needs-panel"`); `null` = no arrow.
  `dismissHint(id, true)` ("never show again") sets `settings.tutorialEnabled = false`.
- **[fyi] Keyboard ownership.** Controller hotkeys (window, bubble phase) skip events that are `defaultPrevented`,
  come from editable targets, focused buttons (Space/Enter), or anything inside `[role="menu"|"menubar"|"dialog"|
  "alertdialog"]` / `[aria-modal="true"]`. **Escape while a dialog is open is left entirely to the UI** (HUD
  `useEscape` capture stack, shell `Modal` panel handler + window fallback) — the controller cannot see nested
  prompts, so it never closes dialogs itself and never `preventDefault`s an Escape it did not use. Its own chain is:
  interaction menu → active buy/build tool → open the pause menu.
- **[fyi] Toasts.** De-duplicated within 2 s (same kind+title+text, or merge key: an engine `skill`/`career`
  notification and the matching `skillUp`/`promotion` event produce ONE toast and ONE sound). The controller does
  not toast `interactionFailed` (the engine already posts a `bad` notification for player-sourced failures).
- **[fyi] Quit safety.** `quitToMenu()` autosaves first; if that save fails the game stays open with a toast, and a
  second `quitToMenu()` within 30 s leaves without saving (never silently loses progress, never traps the player).
  `continueLatest()` may load the `emergency` slot after a crash.
- **[fyi] Saves.** Per-world slots: autosave `auto-<seed8hex>`, manual `save-<seed8hex>` (or the slot a game was
  loaded from), crash `emergency`. All ids satisfy PLATFORM's `^[a-z0-9_-]{1,40}$` and avoid Windows device names.
  Autosave is idempotent per world signature (`tick` + successful-command count, so paused build edits count).

## 3. RENDER

- **[adopted]** `setPixelRatio(ratio)` (the controller passes the effective value; 0/auto resolved to
  `min(devicePixelRatio, 2)`, same as for `init`), `zoom` units (1 = one wheel notch, + = closer), `panWorld` axes
  (dz < 0 = away / W), `pickGrid().fx/fz` absolute (the controller clamps them into the reported tile).
- **[fyi]** While the loading screen is up the controller renders at ~4 fps (asset parsing shares the main thread).

## 4. PLATFORM

- **[open] Web Locks timeout.** In the SwiftShader smoke run an autosave failed with `busy` ("another window of the
  game is busy saving") because the 15 s lock wait elapsed while the main thread was starved. The controller retries
  with backoff and warns, but a longer wait for autosaves (or `ifAvailable` + caller retry) would avoid the scary
  toast on slow machines.
- **[open] Electron.** If `pauseWhenUnfocused` is off the controller keeps simulating from a 500 ms timer while frames
  stall; please create the BrowserWindow with `backgroundThrottling: false` so that timer is not clamped. The
  controller never blocks `beforeunload` in Electron (it only prompts in browsers, not under automation) and calls
  `afterlifeNative.quit()` after a best-effort autosave + profile flush (`quitApp`).
- **[fyi]** `main.tsx` falls back to an in-memory SaveManager/ProfileStore (`src/game/fallbacks.ts`) if
  `createSaveManager()` rejects or hangs > 8 s, and warns the player in game that saves are temporary
  (`backend.durable === false`).

## 5. SIM-ENGINE / SIM-PEOPLE

- **[fyi]** The controller relies on: `dispatch` never throwing (it is still wrapped), `menu(tile)` offering
  `engine_goHere`, phone interactions carrying `params.action`, `drainEvents()` every frame (also while paused, so
  build/dispatch events flow), `repairWarnings` (one summarising toast after loading a repaired save; details stay in
  `faults()`), `state.choices` for the auto-pause hold, and `state.notifications[].read` for
  `markNotificationsRead()` (no command is sent when nothing is unread).
- **[open]** If milestone/promotion notifications are also emitted as `notify` events with kinds other than
  `career`, the player may see two toasts; please use kind `career` for promotions or tell us the kind.


---
**RESOLVED by integration lead:** all [open] items adopted — GameController: lotTemplates, gameOverReason, boot(canvas), dispose(); validateCazDetailed union += household/appearance. RENDER: setPixelRatio added; pickGrid fx/fz = absolute world coords; zoom/panWorld units documented. PLATFORM: autosave uses Web Locks ifAvailable + caller retry, manual saves wait ≤30 s; Electron backgroundThrottling false. SIM: notification kinds fixed (skill/career/good/romance|social). See docs/CONTRACTS.md #19.

## 6. Hardening pass (GAME independent hardener) — behaviour other modules should know

- **[fyi → UI-SHELL / UI-HUD] Contract #22 implemented.** `lastSavedAt` (epoch ms of the current world's last good
  save, or of the save it was loaded from; `null` on the menu) and `lastSaveFailed`. `validateCazDetailed()` now emits
  `'household'` (lot / difficulty / member count) and `'appearance'` (corrupt look) per #19/#22.
- **[fyi → UI-SHELL] `saveGame(slotId)`** lower-cases UI-minted ids and refuses controller-owned slots
  (`auto-*`, `emergency`, legacy `autosave[-N]`) with `{ ok: false, code: 'invalid' }`. Two identical requests in
  flight (same slot, name and world state — a double-click) share one write.
- **[fyi → UI-SHELL / PLATFORM] Exports keep PLATFORM's `.alsave` name** (the old sanitiser forced `.json`, producing
  `afterlife-x-day3.alsave.json` and skipping Electron's `.alsave` save-dialog filter). Known extensions `.alsave` /
  `.json` are kept, anything else gets `.alsave`; non-JSON names download as `application/octet-stream`.
- **[fyi → UI] Keyboard while a dialog is open.** The controller no longer `preventDefault`s Tab / arrows / Space /
  Enter outside the dialog (focus must be able to move INTO it); it still blocks F1, F3, F5, F10 and ctrl+S / P / R
  (reload / save-page / print) in game. Modals must keep their own focus trap.
- **[fyi → all] `dispose()` tears down the renderer** (`renderer.dispose()`) and silences music, as the contract says
  ("listeners/loops/renderer"). A second bootstrap must create its own renderer. `boot()` is idempotent and shares one
  promise; `dispose()` during boot leaves no listeners, loop or timers behind.
- **[fyi → SIM-ENGINE / SIM-PEOPLE] Achievement toasts.** Within one drained batch, a `skillUp` / `promotion` /
  `milestone` event is paired with the engine notification of kind `skill` / `career` / `good` for the same zombie:
  the notification's (richer) text is the toast, the event contributes only its sting (no generic notify ping). This
  needs both to be emitted in the SAME tick (they are today); a semantic event with no notification gets a controller
  fallback toast. Toasts are no longer merged per zombie, so two different skill-ups within 2 s both show.
- **[fyi → UI-HUD] Per-frame coalescing.** However many `choice` / `lot` / `focus` events one frame carries, the
  auto-pause + UI flush, the buy/build re-validation and the camera move happen once (focus: last one wins).
- **[fyi → UI-HUD] `chooseMenuEntry(entry, child?)`** re-validates first (target gone / actor left → the menu closes,
  nothing is queued) and only accepts entries of the open menu and children of that entry (same object, or the same
  interactionId + label + params). Anything else is refused (`uiError`).
- **[fyi → UI-SHELL] CAZ voice seed (#17).** Random members now carry `voiceSeed`; `updateCazMember(i, { voiceSeed })`
  is accepted (integer 0..2147483646) and passed to `createNewWorld`. Re-rolling look / traits / name keeps it; "all"
  rolls a new one. Names: bidi controls (U+202A–202E, U+2066–2069, U+061C), line/paragraph separators and lone
  surrogates are rejected as control characters; names made only of invisible / blank-looking characters (ZWSP, LRM,
  soft hyphen, Hangul fillers, Braille blank …) count as empty; duplicate first names compare NFKC-normalised with
  zero-width characters ignored (look-alikes collide).
- **[open → PLATFORM, low] Crash-save lock wait.** The emergency save after a fatal error passes `{ autosave: true }`
  (so it is listed as an autosave), which also means Web Locks `ifAvailable`: if another window holds the save lock at
  that moment it fails `busy` instead of waiting. A `SaveManager.save` option to wait for the lock while still flagging
  the slot as an autosave (e.g. `opts.waitForLock?: boolean`) would make the crash save more reliable. Workaround
  today: the crash screen's "Try emergency save" goes through the normal (waiting) manual path.


---
**RESOLVED by integration lead:** [open] crash-save lock → `opts.waitForLock?: boolean` added to SaveManager.save in src/persistence/contracts.ts; implementation queued as docs/INTEGRATION_BACKLOG.md #11. All [fyi] items noted.
- **[open → UI-HUD, low] Focus after the interaction menu closes.** The UI re-renders once per animation frame
  (`subscribeCoalesced`), so for a frame after Esc / a choice closes the menu, the focused `[role="menuitem"]` is still
  in the DOM and — per the KEYMAP ownership rule — the next hotkey (e.g. Esc then 3 pressed quickly) belongs to the UI
  and is dropped. Seen in the SwiftShader smoke run (few fps). Suggest moving focus out of the menu synchronously in its
  close path (e.g. `(document.activeElement as HTMLElement)?.blur()` before `game.closeMenu()`); the controller must not
  second-guess `[role="menu"]` ownership itself (other HUD menus use it too).

## 7. Integration pass (phase 2) — behaviour other modules should know

- **[fyi → SIM-HOME / SIM-ENGINE] Loops (backlog #3).** The event layer now DOES stop loops by itself: `objectRemoved`
  stops every tracked loop whose `objectId` matches and `agentDespawned` every loop with that `agentId`, in the batch that
  carries the event. A loop silenced because its object vanished is remembered (bounded) and resumes on that object's
  `objectAdded` (build undo / redo re-insert objects under their old id), unless an `sfxLoop` event for the same key
  arrived meanwhile — the sim's own latest `on` / `off` per key always wins. HOME's stereo / fire reconciliation stays the
  source of truth; please update the upkeep README line "the event layer never stops loops by itself". Emitters should
  keep tagging object loops with `objectId` (run loops are agent-tagged and ended by the engine).
- **[fyi → PLATFORM] Crash save (backlog #11).** `emergencySave()` passes `{ autosave: true, waitForLock: true }`; GAME's
  job watchdog (45 s) outlasts PLATFORM's ≤ 30 s lock wait. Ordinary autosaves never pass `waitForLock`.
