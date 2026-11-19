# Getting started

From a fresh clone to running the game and the checks. Windows is the primary platform; macOS/Linux differences are
noted where they matter.

## 1. Requirements

| Need | Version | Notes |
|---|---|---|
| Node.js | 22.12 or newer (`engines` in `package.json`) | `node --version` |
| Git | any recent | Long paths on Windows: `git config --global core.longpaths true` |
| A WebGL2 browser | Chrome, Edge or Firefox | For playing; tests need no GPU |
| Blender | 4.x; record the exact version in your PR (there is no pin file yet) | **Only** for rebuilding 3D assets |

No accounts, API keys, cloud services or paid credits are needed to build, test or play.

## 2. Install and run

```powershell
git clone https://github.com/rblake2320/ALL.git
cd ALL
npm ci
npm run dev
```

Open the address Vite prints (normally <http://localhost:5173/>) and choose **New Game**. Saves stay in your browser.

The desktop app: `npm run electron:dev`.

## 3. The checks (same as CI)

```powershell
npm run typecheck
npm test
node scripts/verify-features.mjs --check
npm run e2e
```

| Command | Proves | Needs |
|---|---|---|
| `npm run typecheck` | Game and desktop app type-check | nothing |
| `npm test` | Every unit and adversarial suite (vitest) | nothing |
| `node scripts/verify-features.mjs --check` | The feature ledger's hash chain is intact and matches `features.json` | nothing |
| `npm run e2e` | The built game boots and a scripted session plays through | Chromium via Playwright |
| `npm run clip:gate` | No zombie clips through furniture in any seat/animation | slower; run when you touch art, seats or animations |
| `npm run verify:assets` | Committed models match their manifest hashes | run when you touch `public/assets/` |

[docs/TESTING.md](../TESTING.md) lists every suite. A pull request states the exact commands and counts it ran.

## 4. Play your change

1. `npm run dev`, start a **New Game**, and do the thing you changed.
2. Press **F8** (or Pause → **Report a bug / feedback**) if something breaks. **Export report file** saves a `.alreport`
   file on your machine with a scrubbed session log; attach it to the issue yourself. Nothing is uploaded.
3. Take a desktop (1280×720) and a phone-size (390×844) screenshot for anything visible.

## 5. Rules that every change follows

The full list is in [CONTRIBUTING.md](../../CONTRIBUTING.md). The ones people trip on:

- **Determinism.** The simulation never reads the clock, randomness or the device directly.
- **Saves are crash-safe.** A save-schema change needs a migration and a fixture test.
- **Tests are adversarial.** Hostile input, crash points, reload and replay, not only the happy path.
- **Original work only.** No art, names or code from other games; see [IP_NOTES](../IP_NOTES.md).
- **E10+ and privacy.** Nothing sends player data off the device.
- **Docs match code.** A doc claim the code doesn't implement is a P0 bug.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `npm ci` fails with EBADENGINE | Install Node 22.12+ |
| Paths too long on Windows | `git config --global core.longpaths true`, then clone again into a short path such as `C:\src` |
| e2e can't find a browser | Install Playwright's Chromium once: `npx playwright install chromium` |
| Black screen in the game | Your browser has WebGL2 disabled; try another browser or update GPU drivers |
| `verify-features --check` fails after your change | You changed a feature's evidence; update `docs/verification/features.json` in the same PR |
