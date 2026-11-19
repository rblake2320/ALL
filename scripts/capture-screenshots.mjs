/**
 * Capture the README screenshots from the built game (docs/screenshots/*.png).
 *
 *   npm run build && node scripts/capture-screenshots.mjs [--out=docs/screenshots]
 *
 * Plays like a person through the menu and Create-a-Zombie, then photographs a few views at 1280x720 (2x pixels) and
 * one phone view. Uses software WebGL so it runs on a machine with no GPU; a real GPU gives nicer shadows.
 *
 * The pictures show the premium zombies (src/shared/premiumBodies.ts), on the High graphics level so their detailed
 * models load:
 *   - 02 is what every player sees today: a locked premium zombie previewed on the Create-a-Zombie turntable.
 *   - 03 to 07 show a household of four premium zombies. Premium zombies cannot be bought yet (the store marks them
 *     "coming soon"), so for these pictures only, the script answers "this account owns them" in place of the store's
 *     server. Nothing in the game is changed, and the README says so under the pictures.
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
/** The household in the pictures: first name and premium body, in order. */
const HOUSEHOLD = [
  ['Mortimer', 'sexton'],
  ['Dolores', 'waitress'],
  ['Hank', 'lowside'],
  ['Silas', 'fisherman'],
];
const server = await startPreview({ root: ROOT, distDir: path.join(ROOT, 'dist'), log });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = null;
try {
  let page = null;
  const until = (fn, arg, timeout = 60_000) => page.waitForFunction(fn, arg, { timeout, polling: 250 });
  const settle = (ms = 2500) => page.waitForTimeout(ms);
  const shot = async (name) => {
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    log(`saved ${name}.png`);
  };
  /** A fresh profile, past the age question, on the High graphics level, at Create-a-Zombie. */
  const openCreator = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
    page = await ctx.newPage();
    // High graphics on software WebGL draws slowly; a click can wait a long time for the page to answer.
    page.setDefaultTimeout(300_000);
    await page.goto(server.url);
    await until(() => !!document.querySelector('.st-age-dialog .st-age__input'), undefined, 120_000);
    await page.locator('.st-age-dialog .st-age__input').fill(String(new Date().getFullYear() - 30));
    await page.locator('[data-testid="age-continue"]').click();
    await until(() => !document.querySelector('.st-age-dialog'));
    // tutorial tips off: a tip opening over the house would be the subject of the picture
    await page.evaluate(() => window.__afterlife.game.updateSettings({ quality: 'high', tutorialEnabled: false }));
    return ctx;
  };
  const toCreator = async () => {
    await page.locator('.sh-menu__item', { hasText: 'New Game' }).click();
    await until(() => !!document.querySelector('.sh-lots [role="radio"][data-lot="starter"]'));
    await page.locator('.sh-lots [role="radio"][data-lot="starter"]').click();
    await page.getByRole('button', { name: 'Create your household' }).click();
    await until(() => !!window.__afterlife.game.caz && !!document.querySelector('.sh-caz__editor'));
  };
  const tab = (name) => page.locator('.sh-editor__tabs [role="tab"]', { hasText: name }).click();
  const bodyLoaded = async () => {
    await until(() => !document.querySelector('[data-testid="caz-body-status"]'), undefined, 180_000);
    await settle(4000);
  };

  // 02: what every player sees today. Nothing owned; a locked premium zombie previewed on the turntable.
  const publicCtx = await openCreator();
  await toCreator();
  await page.getByRole('textbox', { name: 'First name' }).fill('Mortimer');
  await page.getByRole('textbox', { name: 'Last name' }).fill('Graves');
  await page.getByRole('textbox', { name: 'Household name' }).fill('The Graves');
  await tab('Body');
  await page.locator('.sh-bodies [data-body="sexton"]').click();
  await until(() => !!document.querySelector('[data-testid="caz-tryon-stage"]'));
  await page.mouse.move(640, 300); // off the tile, so its tooltip does not cover the list
  await bodyLoaded();
  await shot('02-create-a-zombie');
  await publicCtx.close();

  await openCreator();
  /** Clear toasts and tutorial tips so the picture shows the game, not a notice. */
  const tidy = async () => {
    await page.evaluate(() => {
      const g = window.__afterlife.game;
      for (const t of [...g.toasts]) g.dismissToast(t.id);
      if (g.hint) g.dismissHint(g.hint.id);
    });
    await settle(600);
  };

  await settle();
  await shot('01-main-menu');

  // Stand in for the store's server (see the note at the top): this account owns the premium zombies.
  await page.evaluate((ids) => {
    const own = new Set(ids.map((i) => `body:${i}`));
    window.__afterlife.game.economy.walletImpl.entitlements = () => own;
  }, HOUSEHOLD.map(([, body]) => body));
  await toCreator();
  await page.getByRole('textbox', { name: 'Household name' }).fill('The Graves');
  for (let i = 0; i < HOUSEHOLD.length; i++) {
    const [first, body] = HOUSEHOLD[i];
    if (i > 0) {
      await page.getByRole('button', { name: /Add a zombie/ }).click();
      await until((n) => window.__afterlife.game.caz.members.length === n && window.__afterlife.game.caz.activeIndex === n - 1, i + 1);
    }
    await tab('Identity');
    await page.getByRole('textbox', { name: 'First name' }).fill(first);
    await page.getByRole('textbox', { name: 'Last name' }).fill('Graves');
    await tab('Body');
    await page.locator(`.sh-bodies [data-body="${body}"]`).click();
    await until(([k, b]) => window.__afterlife.game.caz.members[k].appearance.body === b, [i, body]);
    await bodyLoaded();
  }
  await until(() => window.__afterlife.game.validateCaz().length === 0);

  await page.locator('.sh-editor__start').click();
  await until(() => window.__afterlife.game.screen === 'game' && window.__afterlife.game.renderer.loadProgress() >= 1 && !!document.querySelector('.hud-funds'), undefined, 300_000);
  await page.evaluate(() => window.__afterlife.game.updateSettings({ showFps: false }));
  await settle(6000);
  // Bring the camera in on the household, so the zombies are the subject and not specks in a wide view.
  const framed = await page.evaluate((bodies) => {
    const g = window.__afterlife.game;
    const mine = Object.values(g.sim.state.agents).filter((a) => bodies.includes(a.appearance?.body));
    const cam = g.renderer.getCamera();
    const [kx, kz] = Object.keys(cam.target);
    const at = (a) => [a.pos[kx] ?? a.pos.x, a.pos[kz] ?? a.pos.z ?? a.pos.y];
    const pts = mine.map(at).filter((p) => p.every(Number.isFinite));
    if (pts.length === 0) return { members: mine.length, moved: false };
    const cx = pts.reduce((n, p) => n + p[0], 0) / pts.length;
    const cz = pts.reduce((n, p) => n + p[1], 0) / pts.length;
    const spread = Math.max(...pts.map((p) => Math.hypot(p[0] - cx, p[1] - cz)));
    g.renderer.setCamera({ target: { [kx]: cx, [kz]: cz }, distance: Math.max(9, Math.min(cam.distance, spread * 2.6 + 7)) }, true);
    return { members: mine.length, moved: true, spread, was: cam.distance, now: g.renderer.getCamera().distance, pts };
  }, HOUSEHOLD.map(([, body]) => body));
  log(`camera on the household: ${JSON.stringify(framed)}`);
  await settle(5000);
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
