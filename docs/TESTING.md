# Afterlife Lease — Testing

Every test command in `package.json`, what each suite covers, and the browser/e2e drivers outside Vitest.

## Numbers as of the last full run

These come from one `npx vitest run --reporter=json` on **2026-11-05 (15:59 UTC)**, Linux container, Node 22.23,
in about 152 s. They show the state at that moment, while other modules were still being edited. Re-run the
command to get current numbers.

| | Count |
|---|---|
| Test files | 177 |
| Tests | 3,820 total: **3,811 passed, 2 failed, 7 skipped** |
| Skipped | 5 balance full-sweep tests (run only with `npm run balance`), 2 headless-Blender pipeline tests (run only with `BLENDER_PYTHON` set) |
| Failed at that run | `tests/unit/home/upkeep.test.ts` (TV leisure rate expected 17, got 20, during the balance pass) and `tests/unit/ui-shell/shell-logic.test.ts` (KEYMAP gained `focusHud` and the test's expected group list had not caught up yet). Both were in progress in their owners' modules. Both files passed when re-run at 16:08 UTC (46/46). |

Tests per suite (`tests/unit/<suite>/`, files / tests / failed):

| Suite | Files | Tests | What it shows |
|---|---|---|---|
| `audio` | 16 | 150 | The procedural engine never throws without WebAudio (`api-noop`). Mix bounds never clip, polyphony caps hold, the PRNG is deterministic, every SfxId has a recipe, the voice plan and render work, the scheduler and loop manager behave, and context-loss recovery works. Uses a strict fake AudioContext that throws wherever browsers throw. |
| `balance` | 1 | 8 (5 skipped) | `fast.test.ts` registers the fast subset of `tests/balance/balance.test.ts`, about 30 game days: unattended and reasonable-player households meet the GDD §18 targets, grim is harder than normal, with 0 faults and 0 invariant violations. |
| `characters` | 10 | 128 | Character GLB structure matches the manifest (bones, clips, morphs, triangle budget). Also covers anchors, carry, faces, motion, rig lifecycle and dispose/release, and the fallback rig. |
| `electron` | 10 | 187 | Main process against a mocked Electron API. File store atomic writes, kill-at-every-step and Windows quirks (read-only attribute, EPERM/EBUSY, device names). IPC argument validation, the preload sandbox contract, the `app://` protocol and CSP (incl. no WASM in shipped GLBs), storage key ↔ filename mapping, logger rotation and window state, plus the safety of the build scripts (`inline-build` refuses to delete unsafe folders). |
| `engine` | 23 | 192 | The tick runner, commands, interactions and socials, autonomy, registry and `validateContent`. **Determinism**: same seed gives the same state, and save → load → continue matches never saving. Also fault containment, fuzzing with synthetic and real content, repair idempotency, views, and performance budgets. |
| `game` | 25 | 576 | The controller: fixed-step loop, speed, settings, autosave scheduling and idempotency, save flow, event routing and flood control, keyboard and pointer input, CAZ validation, hints, diagnostics. A **contract-conformance** test checks GameController against `src/game/contracts.ts`, plus controller × real-simulation integration. |
| `home` | 10 | 168 (1 failed) | Home content and systems: decay/preservation, food, economy/bills, upkeep, fire severity, autonomy gates, plus adversarial and multi-day integration runs on the real engine. |
| `models` | 5 | 1,229 (2 skipped) | Every object GLB: manifest SHA-256 and size, node structure and naming (`Paint`, dynamic parts), units and orientation, ModelLibrary loading, variants and fallback. The skipped pipeline tests rebuild GLBs with headless Blender and compare them byte-for-byte. |
| `people` | 10 | 160 | Social, careers, townies, aspirations and life events, plus adversarial and multi-day integration runs on the real engine. |
| `town` | 3 | 135 | Shared town, step 1: messages (only listed options, no free text), the walkable street, the room (pace cannot be cheated), the town clock, the browser's prediction; and the real server over real WebSocket connections (two players see each other, every limit enforced); and the connection rule of the built pages (only the town page, only a well-formed server address). |
| `persistence` | 17 | 225 | Envelope and checksums, canonical JSON, migrations, validation and repair, reserved keys, quota, cross-tab concurrency and races, the emergency-save lock, the quit flush, and **crash safety**: the backend is killed at every operation (before, after, torn write) and the old or the new world must load. |
| `render` | 19 | 237 | Camera math, cutaway in 8 orientations, wall geometry, edges, chunked static batching, picking and grid picking, interpolation, FX pool, lighting keyframes, thumbnails, the RendererAPI surface, and scene churn (no leaks). |
| `spatial` | 14 | 207 | Pathfinding (incl. equivalence oracles), walkability, rooms, slots, placement rules, Build/Buy commands with undo/redo history and interleavings, lot templates, environment scoring, engine integration. |
| `ui-hud` | 8 | 201 | HUD view-model logic, command mapping, number/time formatting, KEYMAP → key labels and layout, colour contrast, hardening. |
| `ui-shell` | 9 | 152 (1 failed) | Shell logic, CAZ issue mapping, colour helpers, formatting, i18n completeness, icons and portraits, toasts, hardening. |

The two persistence/electron rows together are `npm run test:platform`: 27 files, 412 tests at that run. One more
persistence file (`untrustedImport.test.ts`) was added after the run started, so it is not counted.

---

## Commands (`package.json`)

| Command | What it runs | Notes |
|---|---|---|
| `npm test` | `vitest run`: every `tests/unit/**/*.test.ts` (and `tests/adversarial/**`, which does not exist yet) per `vitest.config.ts` | Node environment, 60 s per-test timeout. This is the CI gate. |
| `npm run test:watch` | `vitest` in watch mode | Local development. |
| `npm run test:platform` | `vitest run tests/unit/persistence tests/unit/electron` | Persistence + desktop shell only. |
| `npm run balance` | `vitest run --config tests/balance/vitest.config.ts --mode full` | **Full balance sweep**: every scenario × 5 seeds, printed report. One world at a time, timeout 1 h per test, so it is slow. Without `--mode full` (`npx vitest run --config tests/balance/vitest.config.ts`) only the fast subset runs. `tests/balance/verify_1_1.test.ts` / `verify_1_2.test.ts` are independent checks on other seeds (about 10 min each; narrow them with `VERIFY_SEEDS`). Not run in CI. |
| `npm run e2e:town` | `node tests/e2e/town.mjs` | Shared town, step 1 (docs/SHARED_TOWN.md). Builds the town server and a web build pointed at it (`dist-town-e2e`), then drives two separate browser profiles on the built `town.html`: 23 checks (both see each other, one watches the other walk at the walking pace, no prediction corrections, name tags, the page's connection rule, the server's web-site check with controls, leaving, nothing kept). |
| `npm run e2e:caz-preview` | `node tests/e2e/caz-preview.mjs` | Create-a-Zombie on the built game, three browser profiles: a new player owning nothing, a child profile, and a control profile that owns one premium body. Checks that the first tab leads to all 31 zombies, that pressing a locked premium zombie shows it on the turntable (model downloaded, picture changed, labelled a preview), that the household member is unchanged, that the preview ends on every way of moving on, and that a game started during a preview holds no premium body. |
| `npm run e2e` | `node tests/e2e/smoke.mjs` | Browser E2E suite against the production build (`tests/e2e/lib/server.mjs` rebuilds `dist/` when stale, without a type-check, and serves it with `vite preview` on a free port). Needs Playwright + Chromium. The suite (`smoke.mjs` → `run.mjs` → `flow.mjs`) landed while this page was being written and is not in the counts above; it launches Chromium with SwiftShader WebGL and writes `dev/out/e2e/report.json` + screenshots. CI runs the job only when `tests/e2e/smoke.mjs` exists. |
| `npm run typecheck` | `tsc` on `tsconfig.json` and `electron/tsconfig.json`, no emit | Must report 0 errors. |
| `npm run verify:assets` | `node scripts/verify-assets.mjs`: each manifest entry under `public/assets` against SHA-256 and size | `--root dist/assets` checks a finished build. `--strict` makes orphan files an error. `--json` gives machine output. Exit code: 0 ok, 1 failed, 2 usage error. |

PowerShell runs the same commands. To pass Vitest a filter, add it after `--`, e.g.
`npm test -- tests/unit/persistence`.

### Targeted runs

```powershell
npx vitest run tests/unit/engine/determinism.test.ts      # one file
npx vitest run tests/unit/persistence -t "crash"          # name filter
$env:BLENDER_PYTHON="C:\path\to\blender\python.exe"; npx vitest run tests/unit/models/pipeline.test.ts   # Blender rebuild check
```

---

## Write-ahead command journal (design §4.1, §4.2, §4.5)

| File | Tests | What it proves |
|---|---|---|
| `tests/unit/persistence/journal.test.ts` | 24 | Storage layer. **Kill at every storage op** of a multi-batch run with compactions, in 3 modes (op not applied / applied then died / torn half-write), on **memory, localStorage, IndexedDB and the Electron file store** (real files in a temp dir). Each relaunch must read a verified prefix of the truth that is at least as long as what was acknowledged durable. Also: journals bind to their snapshot (other sha / tick / slot / namespace → nothing; entries moved to another base fail at entry 0), reordered / duplicated / tampered (checksum resealed) / forked entries, bit flips anywhere in a chunk, ticks going backwards, chunk-key mismatch, wrong version, rotation, stale-save rebase ignored, crash mid-rotation, compaction bound, entry bound, quota exceeded then freed, storage cleared mid-session, two windows with Web Locks (only the holder writes, takeover + purge), clock skew (wall and monotonic), 10 000 entries written and read+verified (< 1.5 s). |
| `tests/unit/game/journal.test.ts` | 16 | Game level on the REAL sim + REAL SaveManager. **2 game days (11 520 ticks) of random commands** (queue / cancel / settings / choices / walls / undo / redo / rename), then a kill. Snapshot + replay must be **byte-identical (canonical JSON)** to the uninterrupted world: once with no save after the new game (all ~300 commands replayed), once with autosaves and event saves landing mid-play (carry-over across rebases). Also: **10 000-command replay < 2 s** (≈ 0.3–0.4 s measured), divergence detection (rebuilds and replays only the safe prefix), torn last chunk, wrong snapshot, old saves without journals, storage cleared + quota, deleting a slot drops its journal. Controller tests: kill without unload → Continue → last actions back, one "Recovered N seconds of play" toast, immediate save, **measured loss ≈ 0.4 s**. pagehide / beforeunload / hidden flush the journal even when the save they start never lands. Two windows (only the lock holder journals; takeover after the first window is disposed). Emergency crash save (journal flushed, then rebased onto `emergency`). Event-driven saves: debounce, ≥ 10 s spacing, idempotency, build exit, purchase, day rollover, quest completion via the router, `GameController.saveSoon`. |
| `tests/unit/game/journalStorageGuard.test.ts` | 2 | `persist()` denied → exactly one Export-Save notice, remembered in the profile. Granted / already persisted / desktop / electron backend / throwing / hanging API → no notice, no crash. |
| `tests/e2e/journal.mjs` | 1 scenario | **Real Chromium, production build, persistent profile (IndexedDB on disk).** New game, then 30 s of play with no save: renames and queued actions, the last one 1.5 s before the kill. Then **CDP `Page.crash`** (no beforeunload / pagehide / visibilitychange) and the browser is closed. Relaunch on the same profile → Continue: the last action is present, the toast was shown, the recovered world is saved at once, and the loss window is printed. Run: `node tests/e2e/journal.mjs` (builds into the OS temp dir, never touches `dist/`; `--no-build`, `--dist=`, `--url=` as in `run.mjs`). |
| `tests/unit/game/responsiveTimeout.test.ts` | 6 | `withResponsiveTimeout` (D-074) on an event-loop model with stalls: an answer that arrives during a 2 s – 10 min stall wins (the wall-clock timeout loses), no answer still times out after the budget, 20 stalled turns exhaust it, rejection / late answer / garbage budgets never hang or leak a timer. |
| `tests/unit/game/journal.test.ts` (W-134 cases) | 3 | Real sim + real journal: a 12 s stall while the lock answers still replays the crashed session; another window really holding the lock is decided at once with no warning; a lock manager that never answers gives up after 2 s of responsive time and logs it. |
| `node tests/e2e/journal.mjs --stall-ms=3000` | 1 scenario | The crash test above with the page's main thread blocked for 3 s right behind the journal lock request on relaunch (real Web Locks). The recovery must still happen. Fails on any build without D-074. |

```bash
npx vitest run tests/unit/persistence/journal.test.ts tests/unit/game/journal.test.ts tests/unit/game/journalStorageGuard.test.ts tests/unit/game/responsiveTimeout.test.ts
node tests/e2e/journal.mjs
node tests/e2e/journal.mjs --stall-ms=3000
```

## Saves across a game update (W-134)

`npm run e2e:oldsave` (`tests/e2e/oldSave.mjs`) loads a save made by an **older build of the real game** in the
current build, in real Chromium. The old build is built from `--old-ref` (default `origin/main`) in a temporary git
worktree, or taken from `--old-dist`. Both builds are served one after the other on the same origin, so the browser
profile's IndexedDB carries over the way it does when the game updates.

| Scenario | What must hold |
|---|---|
| A. in-place update | Continue works; every value of the old world is intact (whole-state diff: only added keys and `schemaVersion` may differ); current schema; one "Save updated" notice and no warning; the world runs, saves, and reloads identical |
| B. exported `.alsave` into a fresh profile | Import succeeds; same whole-state diff; no warning |
| C. crash with unsaved play, then update | The old build is killed with CDP `Page.crash`; after the update Continue loads, the journalled play is replayed on the migrated world, and the world keeps running |

Unit side: `tests/unit/persistence/migrations.test.ts` (the upgrade is reported in `LoadResult.migrated`, never in
`warnings`; a real repair is still a warning) and `tests/unit/game/controller.test.ts` (one `info` toast "Save
updated", no "Save recovered").

```bash
npm run e2e:oldsave                                   # builds origin/main as the old build
node tests/e2e/oldSave.mjs --old-ref=v1.0.0           # any older commit with the same package-lock.json
node tests/e2e/oldSave.mjs --old-dist=/tmp/old-dist --only=C
```

## Perspectives (W-136)

`npm run e2e:perspective` (`tests/e2e/perspective.mjs`) plays the three views in real Chromium with the real button,
the real `V` / `Esc` keys and a real mouse drag: overview → shoulder → a walk (the camera stays on the zombie, checked
against the drawn body and against the sim position) → first person (camera at the eyes, own body not drawn, walls
drawn up, the wall-view setting untouched) → look around → `Esc` (overview, not the pause menu; the overview camera
exactly where the player left it) → Buy ends a close view → Reduce motion cuts → 40 random view / mode / selection
changes → the More-menu row on a 390 × 844 window (44 px targets) → axe on the top-bar tools in each view. The camera
is read from `renderer.stats()` (`viewPose`, `perspective`, `perspectiveBodyHidden`, `drawnWallMode`). Screenshots and
`report.json` go to `dev/out/perspective/`. Software GL says nothing about frame time; OW-18 is for named hardware.
Pure maths and the rig: `tests/unit/render/perspective.test.ts` (27). Game rules: `tests/unit/game/perspective.test.ts` (12).

## No 3D (W-149)

`npm run e2e:no3d` (`tests/e2e/no3d.mjs`) starts the game in Chromium with WebGL switched off and checks, at
1280 × 720 and 390 × 844, that the dedicated screen is shown (not the generic crash screen), names the cause, lists
three things to try, focuses Try again, keeps Copy diagnostics, cuts nothing off, has 44 px buttons on the narrow
window and passes axe including colour contrast (the screen is plain DOM). Unit: `tests/unit/shared/fatalKinds.test.ts`.

## Long soak (W-134)

`npm run e2e:soak` (`tests/e2e/soak.mjs`) plays one page for `--minutes` (default 30) at speed 3 with a scripted
player (go-here orders, buy → move → sell, room → undo → redo, dialogs, camera, manual saves) and samples, after a
forced GC, the JS heap, DOM nodes and event listeners (CDP), WebGL geometries / textures / programs / draw calls
(`renderer.stats()`), the capped game lists, the size of the serialised world and the sim tick rate. The verdict is
a pure function, `tests/e2e/lib/soakVerdict.mjs`, unit-tested in `tests/unit/e2e/soakVerdict.test.ts`: the first
quarter is warm-up; a bounded counter fails when the last quarter's mean exceeds the second quarter's by more than
both its ratio and its absolute limit; heap and save size are judged per game day; a slowing sim, a fault, an
error or a failed save fails the run. Software WebGL measures leaks and drift, not frame time (`--gpu` for that).
The report with every sample is `dev/out/soak/report.json`.

## Browser drivers (`dev/`, not part of `npm test`)

These are Playwright scripts against the real built game or a per-module harness page. In the dev container
Playwright and Chromium are preinstalled. Elsewhere install them with
`npm install --no-save playwright@1.63.0 axe-core@4.10.3; npx playwright install chromium` (one install command: with npm 7+ a second `--no-save` install removes the packages the first one added).

| Driver | Proves |
|---|---|
| `dev/game.smoke.cjs` | The built game, end to end with SwiftShader WebGL: boot → menu → settings persist across reload → New Game → CAZ → game → interaction menu → speed 3 → buy ghost → build → save → quit → continue, plus `.alsave` export. Serve `dist/` with `vite preview` on port 5173 first (the header has bash and PowerShell commands). |
| `dev/platform.e2e.cjs` | Real Chromium persistence: IndexedDB, Web Locks across 2 tabs, gzip, WebCrypto, reload, recovery (Vite on port 5181). |
| `dev/ui-hud.e2e.cjs`, `ui-hud.real.cjs`, `ui-hud.perf.cjs` | HUD keyboard/focus behaviour, HUD states on the real game, HUD performance. |
| `dev/ui-shell.a11y.cjs` | Shell keyboard / accessibility interaction checks against the harness (port 5177). |
| `dev/render.*.cjs` | Draw-call budget, leaks, picking accuracy, perf and real-game shots for the renderer. |
| `dev/audio.verify.mjs` | Audio verification in Chromium: renders SFX/music offline and reports peak/loudness/budget (starts Vite on 5179). |
| `dev/*.shots.*` | Screenshot sets for visual review. |

## Continuous integration

`.github/workflows/ci.yml` runs on push to `main`, pull requests and manual dispatch.

* **Matrix job** (`windows-latest`, `ubuntu-latest`, Node 22.x): `npm ci` → `npm run typecheck` → `npm test` →
  `npm run build` → `npm run build:single` → `npm run verify:assets` → `verify-assets --root dist/assets`.
* **Windows only:** `npm run dist:win` (`--publish never`), then uploads `release/<version>/*.exe` as the
  `afterlife-lease-windows-installer` artifact.
* **e2e job** (the project's Spark runner, `docs/CI_RUNNERS.md`): runs after build-test, not on draft pull requests,
  only when `tests/e2e/smoke.mjs` exists. It installs Playwright 1.63.0 and axe-core 4.10.3 in one `--no-save`
  command, runs `npx playwright install chromium` (system libraries are installed once on the runner), then the
  smoke, accessibility and placement suites. Reports are kept on the runner; the upload is optional.
* Permissions are `contents: read`. A newer push to the same ref cancels the run in progress.
