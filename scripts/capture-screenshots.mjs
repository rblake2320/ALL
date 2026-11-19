/**
 * Capture the README screenshots from the built game (docs/screenshots/*.png).
 *
 *   npm run build && node scripts/capture-screenshots.mjs [--out=docs/screenshots]
 *
 * Plays like a person through the menu and Create-a-Zombie, then photographs a few views at 1280x720 (2x pixels) and
 * one phone view. Uses software WebGL so it runs on a machine with no GPU; a real GPU gives nicer shadows.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPreview } from '../tests/e2e/lib/server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.find((a) => a.startsWith('--out='));
const OUT = path.resolve(ROOT, outArg ? outArg.slice(6) : 'docs/screenshots');
mkdirSync(OUT, { recursive: true });

const log = (m) => console.log(`[shots] ${m}`);
const server = await startPreview({ root: ROOT, distDir: path.join(ROOT, 'dist'), log });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = null;
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const until = (fn, arg, timeout = 60_000) => page.waitForFunction(fn, arg, { timeout, polling: 250 });
  const settle = (ms = 2500) => page.waitForTimeout(ms);
  const shot = async (name) => {
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    log(`saved ${name}.png`);
  };
  /** Clear toasts and tutorial tips so the picture shows the game, not a notice. */
  const tidy = async () => {
    await page.evaluate(() => {
      const g = window.__afterlife.game;
      for (const t of [...g.toasts]) g.dismissToast(t.id);
      if (g.hint) g.dismissHint(g.hint.id);
    });
    await settle(600);
  };

  await page.goto(server.url);
  await until(() => !!document.querySelector('.st-age-dialog .st-age__input'), undefined, 120_000);
  await page.locator('.st-age-dialog .st-age__input').fill(String(new Date().getFullYear() - 30));
  await page.locator('[data-testid="age-continue"]').click();
  await until(() => !document.querySelector('.st-age-dialog'));
  await settle();
  await shot('01-main-menu');

  await page.locator('.sh-menu__item', { hasText: 'New Game' }).click();
  await until(() => !!document.querySelector('.sh-lots [role="radio"][data-lot="starter"]'));
  await page.locator('.sh-lots [role="radio"][data-lot="starter"]').click();
  await page.getByRole('button', { name: 'Create your household' }).click();
  await until(() => !!window.__afterlife.game.caz && !!document.querySelector('.sh-caz__editor'));
  await page.getByRole('textbox', { name: 'First name' }).fill('Mortimer');
  await page.getByRole('textbox', { name: 'Last name' }).fill('Graves');
  await page.getByRole('textbox', { name: 'Household name' }).fill('The Graves');
  await until(() => window.__afterlife.game.validateCaz().length === 0);
  await settle();
  await shot('02-create-a-zombie');

  await page.locator('.sh-editor__start').click();
  await until(() => window.__afterlife.game.screen === 'game' && window.__afterlife.game.renderer.loadProgress() >= 1 && !!document.querySelector('.hud-funds'), undefined, 300_000);
  await page.evaluate(() => window.__afterlife.game.updateSettings({ showFps: false }));
  await settle(6000);
  await tidy();
  await shot('03-home');

  await page.evaluate(() => window.__afterlife.game.setWallMode('up'));
  await settle(3000);
  await tidy();
  await shot('04-walls-up');
  await page.evaluate(() => window.__afterlife.game.setWallMode('cutaway'));

  await page.keyboard.press('KeyB');
  await until(() => window.__afterlife.game.mode === 'buy');
  await settle(3000);
  await tidy();
  await shot('05-buy-mode');
  await page.keyboard.press('KeyL');
  await until(() => window.__afterlife.game.mode === 'live');

  await page.evaluate(() => window.__afterlife.game.setPerspective('shoulder'));
  await settle(4000);
  await tidy();
  if (await page.evaluate(() => window.__afterlife.game.perspective === 'shoulder')) await shot('06-over-the-shoulder');
  await page.evaluate(() => window.__afterlife.game.setPerspective('overview'));

  await page.setViewportSize({ width: 390, height: 844 });
  await settle(3000);
  await tidy();
  await shot('07-phone');
} catch (e) {
  failed = e;
} finally {
  await browser.close().catch(() => {});
  await server.stop().catch(() => {});
}
if (failed) {
  console.error(failed);
  process.exit(1);
}
log(`done: ${OUT}`);
