# Production readiness

One list of what stands between the current build and a public release. Each row says what is proven, by what, and
who closes what is left. Updated 2026-11-12 for `integration/batch-1106` (PR #85).

**Status in one line:** the single-player game on one home lot passes the automated checks on Linux (the project's
Spark runner) and, as of 2026-11-12, has had a first Windows run, a first installed-app pass and a first real-GPU
frame-time run. It is **not** release-ready: one save-journal failure is unexplained, the walkable world is not
merged, the installer is unsigned, and legal, rating and store work have not started.

## 1. Proven on this build (local runs, Linux, headless Chromium with SwiftShader)

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | clean |
| Unit + adversarial suites | `npm test` | 316 files passed, 4 skipped; 6,656 tests passed, 53 skipped, 0 failed (full run on 835c7cd) |
| Feature ledger | `node scripts/verify-features.mjs --check` | OK, 140 features |
| Clipping gate | `npm run clip:gate` | 16 files, 62 tests passed |
| Browser smoke (boot → new game → play → save → reload → corrupt-save recovery) | `node tests/e2e/run.mjs --rebuild` | 27 of 27 steps, 0 console or page errors |
| Accessibility (keyboard, focus, contrast, 400 % zoom, axe-core 4.10.3 rule scans) | `node tests/e2e/a11y.mjs` | passed |
| Phone layout (portrait and landscape, 44 px targets, no overflow) | `node tests/e2e/phone-layout.mjs` | 191 of 191 |
| Opening sequence (Act 1 first view, desktop and phone) | `node tests/e2e/openingPolish.mjs` | 42 of 42 |
| Build/buy placement matrix | `node tests/e2e/placement.mjs` | passed (10 steps) |
| Bug-report flow | `node tests/e2e/feedback.mjs` | 7 of 7 |
| Save journal | `node tests/e2e/journal.mjs` | 9 of 9 |
| Source and built assets match their SHA-256 manifests | `npm run verify:assets`, `--root dist/assets` | passed |
| Web build and single-file build | `npm run build`, `npm run build:single` | built (single file 2.9 MB + 40 MB assets) |
| Creator Kit | in `scripts/creator`: `npm ci --ignore-scripts && npm run build && npm test` (a fresh clone needs the install and build first) | passed, 56 tests |
| Balance sweep: unattended 14 days, scripted player 21 days, three difficulty levels, other careers, empty lot, save/load determinism | `npm run balance` | 7 files, 27 tests passed |
| Runtime dependency audit | `npm audit --omit=dev` | 0 vulnerabilities |

A second, independent pass on another machine (W-134, 2026-11-11, docs/verification/independent-run-batch-1106.md)
reproduced the unit, build, asset, clipping, Creator Kit and browser results above, and found two product defects that
are fixed on `perplexity/batch-1106-verify`: crash recovery dropped when the main thread stalls for more than 2 s
during load (D-074), and a "Save recovered" warning on every save from an older version (D-073).

Four defects were found by this pass and fixed in the batch (none existed in any single PR): the nine-tab phone agent
panel, a toast over the Act 1 story card, the Ringmaster's cane under the floor in the crawl, and a stale-window bug in
the a11y suite itself.

**Independent review, 2026-11-12 (ZSM's helper review, then the lead's).** ZSM had helper agents read the batch, the
#86–#91 stack and #94 area by area; 35 findings held after a refute pass. 14 fix branches were taken into this batch,
6 of them with the reviewer's corrections applied by the lead (journal at game over, job urgency clamp, clear-log on
a second backend, axe install command, age-gate race and desktop fallback D-083, first-person own-sound pan). Most
notable: a **save-loss defect** (reloading the latest save in the same window left a second journal timeline that
crash recovery could pick, dropping the play after the reload) and **game over replayed onto the last save**. Each
fix has a test that fails without it. The keyboard path to Store / Quests / Go was checked in real Chromium
(`dev/scripts/econ-keynav.mjs`, 16 of 16). Not taken: two unreviewed drafts on #92.

## 2. Not proven

| Gap | Why it matters | Who closes it |
|---|---|---|
| **Save-journal crash safety: one unexplained failure** | On the Spark runner, run 43144265722 failed `journalChaos` ("recovered state 451 is older than the acknowledged 504", 15 % write failures). Not reproduced since: later Spark runs soak 24 seeds each and passed; 4 of 4 single-core runs on Spark 2 and every local seed passed. The two journal defects fixed on 2026-11-12 (reload epoch, game-over replay) are in the controller, not the hostile-storage path this test drives, so they do not explain it. If real, a crash while storage is failing could lose a few minutes of confirmed progress. CI prints the storage state on failure | Claude Cloud: find the cause before release |
| **Independent CI: first green run** | Run 43172487315 on the self-hosted Spark runner `afterlife-spark2`, commit f77d720: unit 317 files / 6,660 tests passed, smoke, accessibility and placement browser suites passed with no retry, Creator Kit passed. Linux ARM64 only | — |
| **Windows**: first run done, not yet clean | Opus 2 ZSM on f77d720: `verify:local` unit 6,659 passed, 1 failed (a test that assumed `/` separators; fixed in this batch, 45/45 on Windows); smoke 27/27, placement 10/10; accessibility 19/19 on a quiet machine, one load race in the check (fixed in this batch). `dist:win` built `AfterlifeLease-Setup-1.0.0-x64.exe` (136,775,728 bytes, unsigned). Installed app: install, boot, settings, new game, modes, fullscreen, saves, single instance, uninstall worked. Not run: buy/build, audio, export/import dialogs, monitor changes. Two product defects found: quitting with X can leave one save write unfinished (nothing lost; cleaned on next start), and installed-build tests write into the player's real saves (no test profile) | Opus 2 ZSM: quit path and test profile (designs accepted); re-run `verify:local` on the pushed batch |
| **Real GPU performance**: desktop measured, phone not | Terra ZSM on f77d720, production build, real Chrome: RTX 5090, 32 of 32 cases at 1080p and 720p (every quality level, miniature look on and off, day and night, 3 and 4 zombies), median frame interval 6.1 ms, 99th percentile 6.2 to 12.2 ms (browser frame cadence, not a GPU timer). AMD integrated adapter, 1080p Low, 3 zombies: median 18.1 ms. Not measured: a mid-range discrete card, any phone, households above four (Create-a-Zombie caps at four) | Terra ZSM; owner for a real phone |
| **Firefox and Safari** on this build | Last cross-browser pass (W-006) predates the batch | Desktop agent |
| **Screen reader** pass with a real reader | axe and keyboard checks do not replace it | Owner-assisted (already an open owner item) |
| **Balance with household jobs, quest Go and the derelict story start** | The full sweep (`npm run balance`: 7 files, 27 tests, 38 min) passed on this build, but its scripted players never assign a job, never press Go, and play only the starter and empty lots. The new features and the default story start are not balance-tested | Claude Cloud: add those scenarios to tests/balance |
| **Long soak** on a real GPU | W-134 built `npm run e2e:soak` and ran it in software rendering: 4.8 game days in one page and 4 worlds in another, no leak or drift (docs/verification/independent-run-batch-1106.md §3.2). Software rendering covers under 5 game days in 35 min and says nothing about frame time | Owner or Terra: `node tests/e2e/soak.mjs --gpu --minutes=120` on the workstation |
| **Old saves** from a real player | W-134: `npm run e2e:oldsave` loads a save written by the `main` build (schema v1) in this build three ways (in place, exported `.alsave`, crash then update) with a whole-world diff; passes. Not yet done: a save exported by the owner from an older real session | Owner: export one old save; anyone: run it through Import |

## 3. Not built or not merged

| Item | State |
|---|---|
| Walkable connected world (Sol's #78, #79, #59) | Conflicts with this batch in engine, save and renderer code. Until merged, the game is one home lot |
| Release pipeline (W-094): versioning, signed builds, rollback | Not started. Version is still 1.0.0 with a long `[Unreleased]` changelog |
| In-world sponsor surfaces (W-014) | Not built; brand skins are data only |
| Bug-search harness, HUD motion check | Proposed, not built |
| macOS build (W-021), Steam (W-092), mobile stores (W-093) | Not started |

## 4. Owner and counsel only

| Item | State |
|---|---|
| Merge PR #85 | The batch is green on the Spark runner; a merge needs the owner (the lead's session cannot merge) |
| Branch protection on `main` and `ship/final-phase` | Not set |
| Windows code signing (W-036): certificate choice | Blocked on the decision; unsigned installers trigger SmartScreen |
| Ratings and legal (W-095): E10+ rating, privacy policy, terms, EULA, COPPA/GDPR-K | Not started; needs counsel |
| Patent check before anything is public (IP_NOTES) | Open |
| Price model for the Steam build | Open |

## 5. Order of work to reach a first release candidate

1. Done: the Spark runner `afterlife-spark2` runs CI. Owner merges PR #85. Windows: `npm run verify:local` on a Windows
   machine before the release.
2. Sol resolves the walkable-world conflicts against the merged batch (or the first release ships as one home lot: an
   owner decision).
3. Claude Cloud: balance scenarios for jobs / Go / the derelict start, soak run, old-save load, then cut `playtest-YYYYMMDD` from the green commit.
4. Owner and Terra: frame time on real hardware; owner-assisted screen-reader pass.
5. Release pipeline (W-094) and signing (W-036).
6. Legal and rating (W-095) before any public build.
