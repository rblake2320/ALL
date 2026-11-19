# Afterlife Lease — real-browser E2E suite

`npm run e2e` builds the production bundle, serves it with `vite preview` on a free local port, and drives headless
Chromium (SwiftShader WebGL2, no GPU needed) through the whole player flow. It prints a pass/fail table, writes
screenshots and `report.json` to `dev/out/e2e/`, and exits non-zero on any failed/skipped step **or any console error,
page error, unhandled rejection, failed request or HTTP ≥ 400 response** anywhere in the run.

```
tests/e2e/
  smoke.mjs        npm run e2e entry (kept for the existing package.json script) → run.mjs
  run.mjs          CLI: build/reuse dist, start preview, launch Chromium, print table, exit code
  flow.mjs         the scenario (ordered steps, each with explicit state waits + checks)
  lib/server.mjs   build freshness check, vite build, vite preview on a free port
  lib/harness.mjs  steps/checks/dependencies, console capture + allow-list, screenshots, table
  lib/inpage.mjs   functions evaluated inside the page (scene scans, IndexedDB corruption, queue watcher)
  phone-layout.mjs W-114 phone HUD check (separate script, see below)
  oldSave.mjs      W-134 a save from an OLDER build loads in this one (in place, .alsave, crash + update)
  soak.mjs         W-134 long soak: leaks and drift over many game days (verdict: lib/soakVerdict.mjs)
```

## Requirements

- Node ≥ 22.12 and `npm ci` done in the repo root.
- Playwright with its Chromium (`require('playwright')` must resolve: either installed globally and reachable via
  `NODE_PATH`, or `npm install --no-save playwright@1.63.0 axe-core@4.10.3` locally, in one command). In the build container it is preinstalled — **never** run
  `playwright install` there.

## Run

Linux / macOS (bash):

```bash
npm run e2e                                  # build if src/ changed since the last build, then run
node tests/e2e/run.mjs --rebuild             # force a fresh vite build
node tests/e2e/run.mjs --no-build            # reuse dist/ even if stale
node tests/e2e/run.mjs --dist=/tmp/al-dist   # build/serve another folder (keeps dist/ untouched)
node tests/e2e/run.mjs --url=http://127.0.0.1:4173/   # test an already running server (no build/serve)
node tests/e2e/run.mjs --out=dev/out/e2e-local        # screenshots/report elsewhere
node tests/e2e/run.mjs --headed              # watch it (needs a display)
```

Windows PowerShell:

```powershell
npm run e2e
node tests/e2e/run.mjs --rebuild
node tests/e2e/run.mjs --dist=$env:TEMP\al-dist
$env:NODE_PATH = "$(npm root -g)"; npm run e2e     # if playwright is installed globally
```

Environment variables `E2E_DIST`, `E2E_URL` and `E2E_OUT` are equivalent to `--dist`, `--url` and `--out`.

The runner starts the preview server itself on `127.0.0.1:<free port>` and stops it on exit (it never touches other
processes). Build reuse: `dist/` is reused when its `index.html` + entry chunks are newer than everything in `src/`,
`public/`, `index.html`, `vite.config.ts`, `package.json` and `tsconfig.json`. The build is `vite build` only — run
`npm run build` / `npm run typecheck` separately for type checking.

## What it covers (in order)

| # | step | how |
|---|------|-----|
| 1 | boot → main menu | wait for `screen === 'menu'`; menu items; Continue disabled with "No saves yet" |
| 2 | settings change | first run is **Auto** (W-039): SwiftShader classified `software` → tier Low, rendered at Low, status line "Auto — … Low"; then Render quality **Low**, toggle **Show FPS** (real clicks); writes awaited via the persistence idle hook |
| 3 | settings persist | reload (proved by a per-load id) → settings still Low/FPS on; dialog shows Low checked; Esc closes |
| 4 | New Game → CAZ | New Game → "Create your household" |
| 5 | CAZ randomize | "Everything" re-rolls the member; the first-name field shows the new name |
| 6 | CAZ invalid input | whitespace first name, 300-char name (capped), empty household name, only 2 traits → inline errors, "things to fix", Start refused |
| 7 | CAZ valid | re-tick a trait, rename to Mortimer Testgrave / The Testgraves, add a 2nd zombie → "Ready to move in" |
| 8 | enter game | Start → game; household, members and funds plaque match the sim |
| 9 | select a zombie | household portrait click switches selection; Tab cycles; agent panel shows Mortimer |
| 10 | interaction menu | scans the canvas with `renderer.pick` for an unobstructed object with an available interaction, clicks it, waits for the `role=menu` |
| 11 | queue + start | click the menu entry → player item in `sim.queueView`; queue UI shows it; at speed 3 it becomes the active ring item |
| 12 | speed keys | `1 2 3 0` + Space pause/resume; radio state follows; ticks frozen at 0, advancing at 3 |
| 13 | speed buttons | Normal/Fast/Faster/Pause buttons; locked Ultra does nothing |
| 14 | Buy: place | `B`, search catalog, click card, hover a free tile (found with `spatial.checkPlace` + `worldToScreen` + `pickGrid`), click → funds − price, plaque updates |
| 15 | Buy: undo | Ctrl+Z refunds and removes; Ctrl+Y redoes; extra undos on empty history are harmless |
| 16 | Build: wall | `U`, Wall tool, zero-length drag builds nothing, 3-segment drag builds 3 walls and charges, toolbar Undo refunds |
| 17 | save named slot | Esc → Save Game → empty name refused → "E2E Slot" saved; slot meta = world |
| 18 | save spam | double-click Save (one slot only), F5 ×6 (no page reload, no failure, ≤ 1 new slot), 6 concurrent API overwrites (ok/busy only, never throw; leaves a backup copy) |
| 19 | reload → Load | reload, Continue names household + day, Load Game → E2E Slot: household, funds, day, members, objects, tick identical |
| 20 | corrupt primary | flip one byte of `slot:<id>:primary` in IndexedDB → load uses the backup, "Save recovered" toast, slot gets the Recovered badge, re-saving heals it |
| 21 | corrupt both | flip primary (+ backup if present) of another slot → `loadGame` returns `corrupt`, the dialog reports it, the running game is untouched |
| 22 | resize | 390×844 and back to 1280×720: no horizontal scroll, top bar / speed / mode controls inside the viewport, canvas backing store follows |
| 23 | WebGL context loss | `WEBGL_lose_context.loseContext()` mid-game → renderer reports lost, sim keeps ticking, `restoreContext()` → renders again (non-empty snapshot) |
| 24 | offline | `context.setOffline(true)` after load: time passes, a purchase, a save and the settings dialog all work with zero failed requests |
| 25 | quit to menu | Esc → Main Menu → confirm → menu; Continue resumes the same household/funds/day; quit again |
| 26 | corrupt settings | flip a byte of `profile:settings` → reload boots to a usable menu with complete, valid settings (from the backup record) |

Steps declare dependencies; a step whose prerequisite failed is reported as SKIP (and fails the run) instead of
producing a cascade of misleading errors.

## Accessibility suite (`node tests/e2e/a11y.mjs`)

W-064 acceptance from Sol's W-023 audit, same build/serve/console policy, screenshots in `dev/out/e2e-a11y`
(`--no-build` reuses `dist/`; CI runs it after the smoke suite). Steps: Escape in the age-gate year field (first run +
Store); emulated 200 % / 400 % browser zoom; Store at 390×844 with 140 % UI scale; CAZ pose bar contrast + thumb;
queue list semantics + Notices badge contrast; **Escape closes the top layer only and focus returns to the opener**
(Pause → Settings → Esc lands on Pause › Settings, closing Pause returns to the canvas, Esc in the Main Menu
confirmation keeps Pause open, Esc with Help over the notification drawer closes Help first); Buy mode by keyboard
alone (select, arrows, Enter places, refusal announced, R rotates, Esc cancels, Ctrl+Z refunds). axe-core rule scans
run when `axe-core` resolves (or `AXE_CORE=<axe.min.js>`), otherwise they are reported as not run.

## Test hooks

Only the existing read-only debug handle `window.__afterlife = { game, version }` (src/main.tsx) and the desktop quit
hook `window.__afterlifeLeasePersistence.whenIdle()` (src/persistence/activity.ts) are used — no product cheats were
added. Player actions go through real mouse/keyboard input; the handle is used to read state for assertions and to
compute where to click. The only direct writes are adversarial ones a player cannot perform by hand (flipping bytes in
IndexedDB, concurrent `saveGame` calls, losing the WebGL context), each marked `ADVERSARIAL` in flow.mjs.
`RendererImpl.stats()` (debug readout, not part of `RendererAPI`) is read for the context-lost flag. Between steps,
`ensureLiveNoDialog()` resets leftover UI state through the public controller methods (`closeDialog` — repeated, since
closing Save/Load or Settings returns to the Pause menu that opened it — `closeMenu`, `cancelPlacement`) so one failed
step cannot strand the next one behind a dialog.

## Determinism and timing

- Fresh browser context per run (empty IndexedDB/localStorage), fixed 1280×720 viewport, fixed names and choices;
  the scene scans sort candidates deterministically.
- Waits are on state (`page.waitForFunction`, 100 ms polling), never fixed sleeps > 500 ms.
- SwiftShader renders the 3D scene on the CPU at a few frames per second, and slower under load. Playwright's
  per-click "stable for two animation frames" check would then cost seconds per click, so DOM clicks go through
  `tap()`: wait (DOM polling) until the control is visible, enabled and actually hit-testable at its centre, then click
  with real mouse events. Every click is followed by an assertion on its effect.
- Tutorial tips are a HUD layer that owns Esc while shown (by design) and can pop up over the lot at any time; the
  flow dismisses them with their "Got it" button before Esc-driven actions and canvas drags (`clearHints`/`escUntil`),
  and retries a wall drag whose preview never appeared. `Digit0`/Space/` are pause TOGGLES (KEYMAP.pause), so the flow
  pauses through `pauseGame()` which only presses when the game is running.
- Measured: 26/26 steps in ~8–10 min on a 4-CPU container that other jobs were loading (load average ≈ 5). Boots
  (~20–45 s each, four page loads) and screenshots (~5–15 s each under SwiftShader, 17 of them) dominate; timeouts are
  generous rather than tight so contention slows the run down instead of failing it.

## Placement suite timing (W-115)

`tests/e2e/placement.mjs` budgets every wait in **rendered frames**, not wall-clock time (`tests/e2e/lib/waits.mjs`).
On a loaded 4-CPU runner SwiftShader draws one frame every 2–10 s, and the first frame that draws a new material
(first Build-mode frame, first ghost of a kind) compiles shaders on the page's main thread — measured locally under
load: an 8.4 s frame on entering Build mode. While the page is inside such a frame it handles no input and answers no
evaluate, so the old fixed 15–25 s timeouts expired after only one to three frames and reported "timed out waiting
for window tool / undo again / walls cutaway" although the input had not been dropped (the failure screenshot,
taken seconds later, showed the requested state). Now:

- `waitFor()` fails only after **≥ its old wall-clock budget AND ≥ 12 rendered frames** (hard cap 8 min), and the
  error says how many frames the game rendered and the slowest sampled frame.
- Frame count, last frame time and "walls settled" come from `renderer.stats()` (`frames`, `lastFrameMs`,
  `wallsSettled`): test hooks added for W-115, read-only.
- Wall-mode changes press C once per confirmed change (never a second press the page has not processed yet) and then
  wait for the cutaway height animation to settle instead of a fixed 400 ms.
- Two warm-up steps run before the placement steps: a cold load to the menu in a throwaway tab, then (in game) every
  build tool, catalog ghost, wall mode and the hand-tool highlight once, waiting until no new shader program is
  compiled for 3 rendered frames. The world is not changed.
- Every step starts from the same view (`baseline()`: no dialog, nothing placed or carried, walls cutaway and
  settled), so one failed step cannot cascade into the next.

## Console policy

Every `console.error`, `pageerror`, unhandled rejection (captured by an init script), failed request and HTTP ≥ 400
response fails the run and is attributed to the step it happened in. `CONSOLE_ALLOW` in `lib/harness.mjs` is the
allow-list; each entry must carry a written justification. It is currently **empty**. Console warnings are listed in
the summary but do not fail the run (the persistence/profile recovery warnings are expected in steps 20 and 26).

## Output

`dev/out/e2e/NN-<name>.png` (key states + `FAIL-<step>.png` on failure) and `dev/out/e2e/report.json` (results,
errors, warnings, timings, browser version). The folder's old PNG/JSON files are removed at the start of each run.

## Phone HUD layout (W-114)

`node tests/e2e/phone-layout.mjs` builds into `<tmp>/al-phone-dist` (never `dist/`), then at 390×844 and 844×390
(deviceScaleFactor 1, `isMobile`, `hasTouch`) goes age gate → New Game → Fixer-Upper (`starter`) → Create-a-Zombie →
Move in and asserts: no truncated HUD label (needs, mood pill, names, activity, queue bubble, tip buttons, quest chip;
plus every visible `text-overflow: ellipsis` element), the first tip clear of the portraits / agent panel, every visible
HUD control ≥ 44×44, no horizontal overflow, quest chip + top-bar overflow menu present; and a negative control that
the checker flags a deliberately narrowed name and a shrunk button. Screenshots: `dev/out/phone-layout/<label>-*.png`.
Desktop no-change proof: run it once against the base branch's build with `--desktop-dump=<file>` and once against
this one with `--desktop-compare=<file>` (1280×800 HUD boxes, ±1 px). Options: `--label=`, `--only=portrait,landscape,desktop`,
`--dist=`, `--no-build`, `--rebuild`, `--url=`, `--report-only`.
