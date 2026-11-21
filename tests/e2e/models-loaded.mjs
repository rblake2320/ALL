#!/usr/bin/env node
/**
 * Every piece of furniture is drawn with its real model, never the plain fallback box.
 *
 *   node tests/e2e/models-loaded.mjs [--no-build] [--shot=<file.png>]
 *
 * When the browser cannot get or read a furniture model, the renderer quietly draws a coloured box in its place
 * (src/render/models/index.ts) and the game keeps running, so nothing else fails. This test starts a new game on
 * the BUILT game and fails if any furniture model listed in public/assets/manifest.objects.json was not downloaded,
 * or if the renderer reported falling back to a box for any of them.
 *
 * Control: --break=<model id> serves that one model as garbage bytes; the test must then fail (run it to check
 * the test can still tell). Exit 0 = every check passed.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureBuild, startPreview } from './lib/server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = path.join(ROOT, 'dist');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const BREAK = arg('break');
const SHOT = arg('shot');
const log = (m) => console.log(`[models-loaded] ${m}`);

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
};

await ensureBuild({ root: ROOT, distDir: DIST, mode: process.argv.includes('--no-build') ? 'never' : 'auto', log });
const manifest = JSON.parse(readFileSync(path.join(DIST, 'assets', 'manifest.objects.json'), 'utf8'));
const listed = Object.entries(manifest.objects ?? {}).map(([id, e]) => ({ id, file: String(e.file) }));
check('the built game lists furniture models', listed.length >= 60, String(listed.length));

const server = await startPreview({ root: ROOT, distDir: DIST, log });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let crashed = null;
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  if (BREAK) {
    const entry = listed.find((m) => m.id === BREAK);
    if (!entry) throw new Error(`--break: no model ${BREAK}`);
    await page.route(`**/${entry.file}`, (r) => r.fulfill({ status: 200, contentType: 'model/gltf-binary', body: 'not a model' }));
    log(`control: serving ${entry.file} as garbage`);
  }
  const fetched = new Map();
  const failedLoads = [];
  page.on('response', (r) => {
    const m = r.url().match(/\/assets\/(models\/objects\/[^?#]+\.glb)/);
    if (m) fetched.set(m[1], r.status());
  });
  page.on('requestfailed', (r) => {
    if (/\.glb|manifest\./.test(r.url())) failedLoads.push(`${r.failure()?.errorText} ${r.url()}`);
  });
  const fallbacks = [];
  page.on('console', (msg) => {
    const t = msg.text();
    if (/using a placeholder|every model will be a placeholder|could not upgrade placeholder|continuing with placeholders/.test(t)) fallbacks.push(t.slice(0, 200));
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const until = (fn, t = 120_000) => page.waitForFunction(fn, undefined, { timeout: t, polling: 250 });

  await page.goto(server.url);
  await until(() => !!document.querySelector('.st-age-dialog .st-age__input'));
  await page.locator('.st-age-dialog .st-age__input').fill(String(new Date().getFullYear() - 30));
  await page.locator('[data-testid="age-continue"]').click();
  await page.locator('.sh-menu__item', { hasText: 'New Game' }).click();
  await until(() => !!document.querySelector('.sh-lots [role="radio"][data-lot="starter"]'));
  await page.locator('.sh-lots [role="radio"][data-lot="starter"]').click();
  await page.getByRole('button', { name: 'Create your household' }).click();
  await until(() => !!window.__afterlife.game.caz && !!document.querySelector('.sh-caz__editor'));
  await page.locator('.sh-editor__start').click();
  await until(() => window.__afterlife.game.screen === 'game' && window.__afterlife.game.renderer.loadProgress() >= 1, 300_000);
  // every listed model is fetched at start-up; wait for the last of them, then give a broken one time to report
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline && listed.some((m) => !fetched.has(m.file))) await page.waitForTimeout(500);
  await page.waitForTimeout(5000);
  if (SHOT) await page.screenshot({ path: SHOT });

  const missing = listed.filter((m) => !fetched.has(m.file)).map((m) => m.id);
  const notOk = listed.filter((m) => fetched.has(m.file) && fetched.get(m.file) !== 200).map((m) => `${m.id}:${fetched.get(m.file)}`);
  check('every listed furniture model was downloaded', missing.length === 0, missing.slice(0, 10).join(', '));
  check('every furniture model answered 200', notOk.length === 0, notOk.slice(0, 10).join(', '));
  check('no model download failed', failedLoads.length === 0, failedLoads.slice(0, 5).join(' | '));
  check('the renderer drew no fallback box', fallbacks.length === 0, fallbacks.slice(0, 5).join(' | '));
  const objects = await page.evaluate(() => window.__afterlife.game.renderer.stats().objects);
  check('the starter home has its furniture in the scene', objects >= 40, String(objects));
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) {
  crashed = e;
} finally {
  await browser.close().catch(() => {});
  await server.stop().catch(() => {});
}
if (crashed) {
  console.error(crashed);
  process.exit(1);
}
console.log(failures === 0 ? '[models-loaded] all checks passed' : `[models-loaded] ${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
