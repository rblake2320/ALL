# Working on Afterlife Lease with an AI agent

For AI coding agents and the people who run them. [CONTRIBUTING.md](CONTRIBUTING.md) applies to agent-written work
too, and you are responsible for every line your agent submits. The community path is in
[docs/community/](docs/community/README.md).

## What this is

A zombie life-sim, rated E10+. TypeScript, Three.js, Preact; Electron for the desktop app. The game runs on the
player's device with no account and talks to no server. A separate test page and a small server, off by default, are
the first step towards a shared town ([docs/SHARED_TOWN.md](docs/SHARED_TOWN.md)).

## Layout

| Path | What's there |
|---|---|
| `src/sim/` | The deterministic simulation: engine, content (`content/`), systems (`systems/`). Never reads the clock, randomness or device state directly |
| `src/game/` | The controller between sim, renderer and UI; input; saves flow; session log |
| `src/render/` | Three.js renderer: world, objects, characters, FX, picking |
| `src/ui/` | Preact UI: shell (menus, dialogs), HUD, feedback form |
| `src/persistence/` | Crash-safe saves: atomic writes, backups, checksums, migrations |
| `src/packs/` | Creator Kit pack verification and registry (only house-brand skins register today) |
| `src/feedback/` | Bug reports and the session log: scrubbed, on-device |
| `src/shared/townNet/`, `server/`, `src/town/` | The shared-town test: shared rules, the Node server, the `town.html` page |
| `tools/blender/` | Scripts that generate every 3D model |
| `public/assets/` | Built models and their `manifest.*.json` (SHA-256 per file) |
| `tests/unit/` | Vitest suites, adversarial cases included; `tests/e2e/` drives the built game in Chromium |
| `docs/` | Design specs, decisions (`DECISIONS.md`), the workboard (`WORKBOARD.md`), contracts (`CONTRACTS.md`) |

## Commands

| Command | Use |
|---|---|
| `npm ci` | Install exact versions (Node 22.12+) |
| `npm run dev` | Play at <http://localhost:5173/> |
| `npm run typecheck` | Types for the game and the desktop app |
| `npm test` | All unit and adversarial suites |
| `node scripts/verify-features.mjs --check` | Feature ledger hash chain |
| `npm run e2e` | The built game in a real browser |
| `npm run e2e:town` | The shared-town page in two real browsers against the real server |
| `npm run e2e:caz-preview` | Create-a-Zombie in a real browser: every zombie can be seen, a preview never enters the household |
| `npm run clip:gate` | Character/furniture clipping (art, seats, animations) |
| `npm run verify:assets` | Model files match their manifest hashes |

## Rules your agent must follow

1. **One work item per branch and PR**, on a branch in your fork made from `main`, PR opened against `main`.
2. **Stay in scope.** Touch only the files the assignment names. Ask in the issue before widening it.
3. **Determinism.** Sim code gets time and randomness only through journaled commands. Home-only worlds stay
   byte-identical (acceptance test AC-1 in docs/DESIGN_WORLD_LEVELS.md; its harness lands with W-025-S1).
4. **Saves.** Any schema change ships a migration and a fixture test. Never lose or overwrite a player's save.
5. **Adversarial tests.** Hostile input, crash points, reload and replay. A fix comes with a test that failed first.
   Check that the test would catch the bug (break the fix and watch it fail).
6. **Root cause.** Name the cause in the PR. No retry loops, sleeps or skipped tests to make CI pass.
7. **Docs match code.** Update the docs you affect. A doc claim the code doesn't implement is a P0 bug.
8. **Original work only.** No code, art, names or text from other games or copyrighted sources; see
   [docs/IP_NOTES.md](docs/IP_NOTES.md). No new dependency without asking in the issue first.
9. **Privacy.** The game sends no player data off the device. No telemetry, accounts or uploads. The shared-town
   test may send only what [docs/SHARED_TOWN.md](docs/SHARED_TOWN.md) lists (a look made of listed options, a
   preset-name number, a walking direction): never free text, never anything that identifies a person.
10. **No brands or ads.** No brand names, logos, sponsor messages, ad surfaces or new `brandSlots`. Sponsorship
    and ad space belong to the owner (docs/community/README.md §6).
11. **No secrets** in code, logs, issues or PRs. Never commit `node_modules`.
12. **Report honestly.** State the exact commands and the pass/fail counts. A skipped check is reported as skipped.
13. **Quiet.** One comment when the PR opens and one when it is ready for review. No per-step updates.

## Before you open the PR

```powershell
npm run typecheck
npm test
node scripts/verify-features.mjs --check
npm run e2e
```

Fill in [.github/pull_request_template.md](.github/pull_request_template.md) completely.
