# Contract requests & integration notes — UI-HUD

Owner: UI-HUD (`src/ui/hud/**`). Nothing below blocks the HUD: every item has a local shim, noted per item.

## H1 — GameController: small wrappers for the three commands the HUD dispatches itself (GAME)
The HUD needs `buyReward`, `renameHousehold` and `markNotificationsRead`, which have no controller method.
**Shim:** `src/ui/hud/lib/commands.ts` is the only place the HUD calls `game.sim.dispatch(...)` (error-contained,
plays `uiConfirm`/`uiError`). **Request:** add `buyReward(agentId, rewardId): CommandResult`,
`renameHousehold(name): CommandResult` and `markNotificationsRead(): void` to `GameController`, so the UI never
touches the sim directly; the HUD will switch in one file.

## H2 — Toast lifetime: let the HUD own expiry while it is visible (GAME)
The brief asks for ~6 s auto-dismiss with **hover pause**. `ToastCenter` (src/game/toasts.ts) also expires toasts on
its own TTL (7 s / 11 s), so a toast that is hovered for longer than its TTL still disappears under the cursor.
**Shim:** the HUD tracks unhovered visible time (`lib/toasts.ts`, unit-tested) and calls `dismissToast(id)` after 6 s;
it also pauses all clocks while a dialog is open or the tab is hidden, and dismisses overflow beyond 5.
**Request:** either drop the controller TTL while the HUD is mounted, or make it a long safety net (≥ 60 s), or add
`holdToast(id, held: boolean)`.

## H3 — Ultra speed availability (GAME)
Nothing in the contract says whether Ultra is currently allowed (GDD §2: every household zombie asleep or at work).
**Shim:** `ultraAllowed(game)` in `topbar/TopBar.tsx` (onLot members must have `anim === 'sleep'`, be passed out,
or show the `zzz` activity icon; at work / crumbled / away count as allowed). **Request:** `readonly ultraAllowed:
boolean` on the controller so UI and hotkey logic can never disagree.

## H4 — Camera & focus through the controller (GAME)
The HUD calls `game.renderer.rotateCamera(±1)` (top bar), `game.renderer.focus({x,z})` (toast/notice about an
object, "Show Mailbox") — all try/catch guarded. **Request:** `rotateCamera(dir)` and `focusObject(id)` on the
controller (it already owns `selectAgent(id, true)` for agents).

## H5 — Buy mode "Sell" for a hovered placed object (GAME)
`BuyState` only exposes `movingObjectId`; the HUD shows Sell (+ value) for that object. To offer Sell on mere hover,
expose `hoverObjectId: ObjectId | null` (buy mode only). **Shim:** Sell appears once an object is picked up.

## H6 — Phone vocabulary (GAME ✓, SIM-PEOPLE ✓ — documentation only)
`game.phone(action, params)` with `action ∈ invite | party | pizza | findJob | quitJob | callInSick` — GAME's
`resolvePhoneInteraction` maps these to SIM-PEOPLE's `phone_*` interactions through `params.action`. Params sent
(SIM-PEOPLE C4): invite `{ townieId }`, party `{ guests?: 'a12,a15' }` (omitted for "Surprise me"), findJob
`{ careerId }`. Availability shown in the HUD comes from `sim.menu(selected, { kind: 'self' })` phone entries
(reason strings verbatim), with a local fallback when the sim exposes none.

## H7 — Tutorial hint anchors (GAME — documentation only)
`HintBubble` resolves `hint.anchor` with `[data-hint-anchor~="<anchor>"]` (space-separated alias lists), so both
GAME's `HINT_ANCHORS` and descriptive names work. Tokens present in the HUD:
`household-portraits`, `needs-panel`, `speed-controls`, `clock`, `funds`, `bills`, `mode-live`, `mode-buy`,
`mode-build`, `modes`, `wall-mode`, `camera`, `save`, `notices`, `menu`, `agent-panel`, `tab-<needs|mood|skills|career|
relationships|aspiration|info>`, `phone`, `find-job`, `rewards`, `queue`, `toasts`, `choice`, `party`, `buy-catalog`,
`sell`, `build-tools`, `tool-<select|wall|room|deleteWall|door|window|floor|paintWall|eyedropper>`. Unknown or
off-screen anchors fall back to a centred callout.

## H8 — Keyboard ownership (GAME)
The HUD handles keys only while its own widgets have focus: ↑/↓/←/→/Home/End/Enter/Space/Tab inside the interaction
menu, segmented controls and tabs; Esc closes the interaction menu, drawers and HUD dialogs (capture-phase listener,
`preventDefault()` + `stopPropagation()`); typing in search/rename fields stops propagation. **Request:** controller
hotkeys should ignore events that are `defaultPrevented` or whose target is editable / inside `[role="menu"]` or
`[role="dialog"]` (the shell's `useHotkey` already skips handled events), so Esc never both closes a HUD layer and
opens the pause menu, and arrows never pan the camera while navigating the menu.

## H9 — Bubbles (GAME — documentation only)
The HUD positions `game.bubbles` from `renderer.bubbleAnchors()` every animation frame (no controller notifications
needed) and does not interpret `until`; the controller prunes expired bubbles (it does). Removed bubbles get a
180 ms exit animation on the HUD side. Several bubbles of one agent stack upwards in list order.

## H10 — i18n (UI-SHELL — documentation only)
HUD strings live in `src/ui/hud/strings.ts` and are registered at import time with `registerStrings()` under the
`hud.` prefix; `ht(key)` resolves through the shell's `t()`. They can be merged into `src/i18n/en.ts` verbatim
(prefix `hud.`) whenever UI-SHELL prefers a single table.

## H11 — Theme note (UI-SHELL — FYI)
`base.css` gives every svg in `.ui-root` `max-width: 100%`. Inside shrink-to-fit wrappers (grid/flex items without an
explicit width) that resolves an icon to 0 px. The HUD sets `max-width: none` on `.hud .ui-icon`; the shell's own
`Icon` may want the same default.

## H12 — Bills view semantics (SIM-HOME — clarification)
`BillsView.outstanding` / `overdue` are read as **dollar amounts**; counts come from `bills[]` (unpaid / overdue).
If they are meant as counts, please say so in the contract comment and the HUD will adapt in one function
(`billSummary` in `topbar/TopBar.tsx`).


---
**RESOLVED by integration lead:** H1, H3, H4, H5 added to GameController/BuyState in src/game/contracts.ts (GAME implements; HUD should switch from shims to them). H2 → controller TTL becomes a ≥60 s safety net; HUD owns lifetime. H8 → hotkey ownership rule documented in contracts.ts above KEYMAP. H12 → BillsView amounts are dollars (documented). H6/H7/H9/H10/H11 recorded in docs/CONTRACTS.md decision #16.

**HUD adoption (UI-HUD):** switched to `ultraAllowed`, `rotateCamera`, `focusObject`, `buyReward`, `renameHousehold`,
`markNotificationsRead` and `BuyState.hoverObjectId` (hovered object → Sell / Move card). `lib/commands.ts` is now a
thin guard over those controller methods; the only renderer calls left in the HUD are the sanctioned
`renderer.bubbleAnchors()` and `renderer.thumbnail()`.

**FYI — Esc ownership as implemented (no contract change needed):** while any HUD layer is open (interaction menu,
notices drawer, HUD dialog) one window capture-phase listener gives each Esc press to the newest layer only and marks
it `defaultPrevented` + stops it, so `controller.escape()` never also opens the pause menu. A layer that was just told
to close is skipped for 300 ms (state re-renders are coalesced per frame), so a quick second Esc reaches the layer
underneath — or is still claimed if nothing else is open. Auto-repeat is claimed and ignored. Focused widgets that use
Esc themselves carry `[data-esc-local]` (household rename field; Buy search while it has text) and get the key first.
With no HUD layer open the listener is detached and Esc reaches the controller untouched.

---
**FYI — hardening pass (UI-HUD, no contract change needed):**
- Adopted the new save-status fields: the save button shows `lastSaveLabel` verbatim and, when `lastSaveFailed`,
  a red badge plus "Your progress is not safe yet. Click to try again." (`lastSavedAt` is not needed by the HUD).
- Keyboard: the HUD's radio groups / tab rails / info lists (speed, modes, tabs, needs, moodlets, skills, relationship
  filters + rows, build tools + style rails, buy categories, colour swatches) are each ONE Tab stop with arrow-key
  roving (`parts/roving.ts`). Arrow keys inside them are `preventDefault`ed + stopped, so the controller never pans
  the camera while a HUD widget has focus. The choice letter (`role="alertdialog"`) maps Digit1…9 to its options; the
  controller already ignores keys inside alertdialogs, so this never doubles as a speed change.
- Esc: the tutorial hint now registers as a HUD Esc layer while it is the top layer (no dialog / interaction menu
  open) — Esc dismisses it like "Got it" instead of opening the pause menu. The invite search field gets Esc first
  while it has text (`[data-esc-local]`), like the Buy search.
- The cursor cost label (`buildPreviewLabel`) hides while the pointer is over a HUD panel (it describes a click in the
  world). GAME may still update it while the pointer is over the HUD; nothing to change.

---
**Finishing pass (UI-HUD) — verified against the REAL game (built bundle, real controller/sim/renderer).**
Driver: `dev/ui-hud.real.cjs` (boot → menu → New Game → CAZ → game, then every HUD state at 1600×900 + 1280×720).

- **DONE — INTEGRATION_BACKLOG #16.** The interaction menu hands focus back SYNCHRONOUSLY on every close path (Esc,
  choosing an entry, click outside, and closes the controller makes itself — target gone, mode switch, a new menu —
  via a synchronous `subscribe` listener): to the element that had focus when it opened (the canvas), else `blur()`.
  HUD dialogs do the same when they are closed by anything but Esc. A flyout's Esc / ← moves focus to the parent row
  before the flyout unmounts. Esc layers closed elsewhere (still mounted until the next coalesced render) no longer
  claim Esc, so a fresh Esc right after a choice reaches the controller. Real game before: "Esc then 3" left speed 1
  (3 swallowed) in 3/3 attempts and in a same-task dispatch, Enter-then-2 swallowed, and a fresh Esc after a choice
  was eaten; after (final bundle): all pass (dev/out/ui-hud/real/report-keys.json, 14/14).
- **H13 (SIM-ENGINE — clarification, please document in src/sim/contracts.ts).** `MoodletView.mood` is the TOTAL
  effect (engine views.ts reports `def.mood × stacks`); `stacks` is informational. The HUD multiplied by stacks
  again (a 3-stack −6 moodlet showed −54 and outranked a −30 one). HUD fixed (`moodletTotal`); suggest
  `mood: number; // total effect, already × stacks`.
- **H14 (SIM-PEOPLE / SIM-ENGINE — clarification).** `PartyView.endsLabel` comes in two shapes: the party system
  returns a complete phrase ("Ends 1:16 AM" / "Party’s over"), the engine fallback a bare time ("Today 1:16 AM").
  The HUD's "Ends {when}" showed "Ends Ends 1:16 AM" in the real game. HUD now accepts both (`partyEndsTime`).
  Request: document "complete phrase, show verbatim" and make the fallback say "Ends …" too.
- **H15 (SIM-ENGINE — labels).** `gerund("Cook…")` yields "Cook…ing" (AgentSummary.activity, real game). HUD repairs
  it for display (`cleanActivityLabel`). Request: gerund() should drop a trailing ellipsis; ideally the activity names
  the recipe ("Cooking Cerebellum Stew") the way the queue could.
- **H16 (GAME / UI-SHELL — keyboard access).** KEYMAP binds Tab / Shift+Tab to "next zombie", so in the real game Tab
  never reached the HUD (a 40-press Tab tour moved focus 0 times; dev/out/ui-hud/real-before/report.json). After:
  F6 lands on the top bar, 31 Tabs visit only visible HUD controls without cycling zombies. HUD-local fix, no controller
  change needed: **F6 / Shift+F6** cycles HUD regions (top bar → household → zombie panel → queue → party/letters →
  toasts → notices → buy/build → world), and **Tab while a HUD control has keyboard focus** moves between HUD controls
  (stopped before the controller's window listener; wraps inside the HUD). Tab on the world, or after a MOUSE click
  on a HUD button, is still "next zombie". Request (UI-SHELL / integration lead): list F6 "Move between HUD panels"
  in Help — e.g. a documentation-only `KEYMAP.focusHud: ['F6']` the controller ignores, or a line in KeyMapTable.
- **FYI (SIM-HOME content).** `home_repair` uses icon `question` (BUBBLE_ICONS has no wrench), so "Repair" shows a "?"
  in the real interaction menu. Suggest adding `wrench` to BUBBLE_ICONS (the HUD draws any BUBBLE_ICONS id).


---
**RESOLVED by integration lead:** #16 DONE (verified). H13 → MoodletView.mood documented as total (× stacks). H14 → PartyView.endsLabel documented as a complete phrase; engine fallback fix queued (backlog #17). H15 → backlog #18. H16 → backlog #19 (documentation-only KEYMAP.focusHud + Help listing). Wrench icon → backlog #20.
- **FYI → UI-SHELL (perf).** `ui-portrait-alert` animates the portrait ring's `stroke-opacity` (and `ui-pulse-critical`
  a `box-shadow`) forever: a main-thread style recalc + repaint every frame while any zombie has a critical need
  (~40 recalcs/s measured on an otherwise idle HUD). The HUD no longer uses either in its own surfaces (alert pings are
  `transform`/`opacity` pseudo-elements; the household bar turns the ring animation off) — idle HUD now does 0 style
  recalcs/s (`dev/ui-hud.e2e.cjs` guards it). Suggest the same for the shell keyframes.
- **FYI (keyboard).** The action queue is one Tab stop: ← → walk the items, Delete / Backspace cancels the focused
  order (focus moves to a neighbour first). Cancel buttons stay for the mouse (tabIndex −1).
