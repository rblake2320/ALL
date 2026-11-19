# Run verification without hosted Actions

Run these commands from an authenticated checkout of this repository with Node.js 22.12 or newer:

```powershell
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Root dependency installation failed' }
npm --prefix scripts/creator ci --ignore-scripts
if ($LASTEXITCODE -ne 0) { throw 'Creator dependency installation failed' }
npm install --no-save playwright@1.63.0 axe-core@4.10.3   # one command: a second --no-save install removes the first's packages
if ($LASTEXITCODE -ne 0) { throw 'Playwright installation failed' }
npx playwright install chromium
if ($LASTEXITCODE -ne 0) { throw 'Chromium installation failed' }
npm run verify:local
if ($LASTEXITCODE -ne 0) { throw 'Verification failed; inspect dev/out/local-verification' }
```

The command runs ledger validation, renderer/Electron typechecking, unit/adversarial tests, both web builds, source/built asset verification, Creator Kit build/tests, and the smoke, accessibility and placement browser suites. The unit suite uses at most two workers to reduce contention on shared machines; test thresholds are unchanged. Every step retains stdout, stderr and exit status in a unique `dev/out/local-verification/` directory. Any failed step makes the command exit nonzero; later checks still run to collect their results. Nothing is uploaded and no GitHub runner is invoked.

`npm run verify:local -- --core` explicitly omits browser acceptance and labels the report **core-only**. `--installer` additionally packages the Windows installer and refuses to run on other operating systems. This command does not register a self-hosted runner, change GitHub budgets, replace required branch checks, run every optional art/performance gate, or certify the other operating system. Existing test skips remain visible in the test log.
