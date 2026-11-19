# Starter tasks

Small, self-contained items with a clear finish line. Claim one with the **Claim work** form; one owner per item.
Each entry links its work item on the [workboard](../WORKBOARD.md), which stays the source of truth: if an item there
is no longer `todo`, it's taken.

## No code

| Item | What | Done when |
|---|---|---|
| **W-007** playtest | Play the current build for two hours and write up what confused you, what broke and what was fun | An issue with timestamps, screenshots and any `.alreport` files |
| **W-080** collection sets | Design ≥ 4 named collection sets of 6–12 pieces plus a completion piece, with ids, sources and rewards | A proposal that uses [BALANCE.md](../BALANCE.md) ranges and passes owner review |
| **Art reference** | Draw original reference sheets (front, side, top) for props on the targeted household list | Files plus provenance per [ASSETS.md](ASSETS.md) §4 |

## Small code

| Item | What | Done when |
|---|---|---|
| **W-081** CI hygiene | Bump GitHub Actions to their Node-24 majors and pin the Ubuntu runner | `.github/workflows/*.yml` updated; CI green on the PR |
| **W-089** naming | Rename `footprint` in the L2 `manifest.levels.json` to `outline` / `tileFootprint` (decision D-043) | Every reader updated; `npm test` green; no other manifest changed |
| **Blender pin** | Add a toolchain pin file recording the exact Blender version the asset scripts are built with, and check it in `tests/unit/models/pipeline.test.ts` | CONTRIBUTING and this kit point to the file; the test fails on a version mismatch |

## Bigger, but well specified

| Item | What | Spec |
|---|---|---|
| **W-087** input settings | Key rebinding with conflict detection and reset, persisted per profile | Workboard row W-087 |
| **W-034** seasons | Seasons, weather and holidays (Halloween first) | [systems/seasons-weather-holidays.md](../systems/seasons-weather-holidays.md) |
| **W-075** wildlife | Birds, squirrels, bats and frogs, plus a comic zombie chase | [systems/wildlife.md](../systems/wildlife.md) |

Every code task follows [GETTING_STARTED.md](GETTING_STARTED.md) §3 (the checks) and [CONTRIBUTING.md](../../CONTRIBUTING.md).
