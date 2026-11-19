#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Run the same project commands as CI on the current machine. No GitHub API calls.
export async function runSteps(steps, outDir, cwd = process.cwd()) {
  mkdirSync(outDir, { recursive: true });
  const report = { startedAt: new Date().toISOString(), platform: process.platform, node: process.version, passed: false, steps: [] };
  for (const step of steps) {
    const log = join(outDir, `${step.id}.log`);
    const output = createWriteStream(log);
    const started = Date.now();
    console.log(`[verify:local] ${step.id}`);
    const result = await new Promise((done) => {
      const child = spawn(step.command, step.args, { cwd: step.cwd ?? cwd, env: process.env, shell: step.shell ?? false, stdio: ['ignore', 'pipe', 'pipe'] });
      let error;
      child.stdout.pipe(output, { end: false });
      child.stderr.pipe(output, { end: false });
      child.on('error', (e) => { error = e.message; });
      child.on('close', (code, signal) => {
        output.end(error ? `\n${error}\n` : '', () => done({ code, signal, error }));
      });
    });
    const passed = result.code === 0 && !result.signal && !result.error;
    report.steps.push({ id: step.id, passed, ...result, durationMs: Date.now() - started, log });
    writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`[verify:local] ${step.id}: ${passed ? 'PASS' : 'FAIL'} (${log})`);
  }
  report.passed = steps.length > 0 && report.steps.every((s) => s.passed);
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

/**
 * Can Playwright start the Chromium this checkout's browser suites use? A machine whose Playwright cache holds only
 * another browser build (Windows run at f77d720: chromium_headless_shell-1254 present, 1243 needed) used to fail all
 * three browser suites in 0.4 s each with a long Playwright banner. `launch` is injectable for tests.
 */
export async function browserPreflight(launch) {
  const start = launch ?? (async () => (await import('playwright')).chromium.launch({ headless: true }));
  try {
    const browser = await start();
    await browser.close();
    return { ok: true, message: 'Playwright Chromium starts' };
  } catch (error) {
    const text = String(error?.message ?? error);
    if (/Executable doesn't exist|npx playwright install|Looks like Playwright/i.test(text)) {
      return { ok: false, message: "Playwright's Chromium for this checkout is not installed. Run: npx playwright install chromium" };
    }
    return { ok: false, message: `Playwright Chromium could not start: ${text.split(/\r?\n/)[0]}` };
  }
}

/**
 * Is axe-core where the accessibility suite will look for it? Without it tests/e2e/a11y.mjs logs its WCAG rule scans
 * as not run and still exits 0, which this runner would report as browser-accessibility: PASS. `find` is injectable
 * for tests; the default is the suite's own lookup (AXE_CORE=<axe.min.js>, or a resolvable axe-core).
 */
export async function axePreflight(find) {
  const axe = await (find ?? (async () => (await import('../tests/e2e/a11y.mjs')).loadAxe()))();
  if (axe) return { ok: true, message: `axe-core: ${axe.path}` };
  return { ok: false, message: 'axe-core is not installed, so the accessibility rule scans would not run. Run: npm install --no-save playwright@1.63.0 axe-core@4.10.3 (both in one command: with npm 7+ a --no-save install removes packages an earlier --no-save added; or set AXE_CORE=<path to axe.min.js>)' };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--core', '--installer', '--help'].includes(arg))) throw new Error('Unknown option. Use --help.');
  if (args.includes('--help')) {
    console.log('npm run verify:local -- [--core] [--installer]\nDefault: core + smoke, accessibility and placement browser suites.\n--core: explicitly omit browser suites; this is NOT full acceptance.\n--installer: additionally package Windows NSIS (requires Windows).\nInstall root and scripts/creator dependencies first; browser suites require Playwright + Chromium + axe-core.');
    return;
  }
  if (args.includes('--installer') && process.platform !== 'win32') throw new Error('--installer requires Windows.');
  // fileURLToPath handles Windows drive letters, percent escapes and spaces.
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const npm = (id, command, dir = cwd) => ({ id, command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', command], cwd: dir, shell: process.platform === 'win32' });
  const node = (id, ...argv) => ({ id, command: process.execPath, args: argv });
  // Bound contention on shared machines without changing any performance assertion.
  const unit = { ...npm('unit', 'test'), args: ['run', 'test', '--', '--maxWorkers=2'] };
  if (!args.includes('--core')) {
    const failed = [await browserPreflight(), await axePreflight()].filter((pre) => !pre.ok);
    if (failed.length) {
      for (const pre of failed) console.error(`[verify:local] ${pre.message}`);
      console.error('[verify:local] Nothing was run: the browser suites are part of this check. Fix the above, or run --core for the non-browser checks only.');
      process.exitCode = 1;
      return;
    }
  }
  const steps = [npm('ledger', 'verify:ledger'), npm('typecheck', 'typecheck'), unit, npm('web-build', 'build'), npm('single-build', 'build:single'), npm('source-assets', 'verify:assets'), node('built-assets', 'scripts/verify-assets.mjs', '--root', 'dist/assets'), npm('creator-build', 'build', join(cwd, 'scripts/creator')), npm('creator-tests', 'test', join(cwd, 'scripts/creator'))];
  if (!args.includes('--core')) steps.push(npm('browser-smoke', 'e2e'), node('browser-accessibility', 'tests/e2e/a11y.mjs', '--no-build'), npm('browser-placement', 'e2e:placement'));
  if (args.includes('--installer')) steps.push(npm('windows-installer', 'dist:win'));
  const out = join(cwd, 'dev/out/local-verification', new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid);
  const result = await runSteps(steps, out, cwd);
  result.scope = args.includes('--core') ? 'core-only (browser acceptance not run)' : 'core-and-browser';
  result.windowsInstaller = args.includes('--installer');
  writeFileSync(join(out, 'report.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`[verify:local] ${result.passed ? 'PASS' : 'FAIL'} — ${result.scope}; report: ${join(out, 'report.json')}`);
  process.exitCode = result.passed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
