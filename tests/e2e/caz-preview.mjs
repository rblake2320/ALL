#!/usr/bin/env node
/**
 * Create-a-Zombie in a real browser, on the BUILT game: a player can see every zombie, the locked premium ones too.
 *
 *   node tests/e2e/caz-preview.mjs [--shots=<dir>] [--no-build]
 *
 * Proves (1) the first tab leads to the full list, (2) pressing a locked premium zombie shows that zombie on the
 * turntable, (3) a preview never changes the household, and ends when the player moves on, and (4) a game started
 * while previewing holds no premium body. A control profile that owns the body shows the checks can tell a preview
 * from a real selection. Exit 0 = every check passed.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureBuild, startPreview } from './lib/server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const shotsArg = process.argv.find((a) => a.startsWith('--shots='));
const SHOTS = shotsArg ? path.resolve(ROOT, shotsArg.slice(8)) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const log = (m) => console.log(`[caz-preview] ${m}`);
const PREMIUM = ['sexton', 'lowside', 'waitress', 'patient', 'fisherman'];

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
};

const DIST = path.join(ROOT, 'dist');
// dist/ is rebuilt when it is older than its inputs (--no-build: use it as it is, as CI does after the smoke test)
await ensureBuild({ root: ROOT, distDir: DIST, mode: process.argv.includes('--no-build') ? 'never' : 'auto', log });
const server = await startPreview({ root: ROOT, distDir: DIST, log });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let crashed = null;

/** A fresh profile at the Create-a-Zombie screen. `owns` stands in for a server that says the account owns bodies. */
async function openCreator({ owns = [], birthYearsAgo = 30 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  const glb = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => {
    if (/models\/characters\/premium\/[a-z_]+\.glb/.test(r.url())) glb.push({ url: r.url(), status: r.status() });
  });
  const until = (fn, arg, timeout = 60_000) => page.waitForFunction(fn, arg, { timeout, polling: 200 });
  await page.goto(server.url);
  await until(() => !!document.querySelector('.st-age-dialog .st-age__input'), undefined, 120_000);
  await page.locator('.st-age-dialog .st-age__input').fill(String(new Date().getFullYear() - birthYearsAgo));
  await page.locator('[data-testid="age-continue"]').click();
  await until(() => !document.querySelector('.st-age-dialog'));
  if (owns.length) {
    await page.evaluate((ids) => {
      const own = new Set(ids.map((i) => `body:${i}`));
      window.__afterlife.game.economy.walletImpl.entitlements = () => own;
    }, owns);
  }
  await page.locator('.sh-menu__item', { hasText: 'New Game' }).click();
  await until(() => !!document.querySelector('.sh-lots [role="radio"][data-lot="starter"]'));
  await page.locator('.sh-lots [role="radio"][data-lot="starter"]').click();
  await page.getByRole('button', { name: 'Create your household' }).click();
  await until(() => !!window.__afterlife.game.caz && !!document.querySelector('.sh-caz__editor'));
  const member = () => page.evaluate(() => JSON.stringify(window.__afterlife.game.caz.members[window.__afterlife.game.caz.activeIndex]));
  const household = () => page.evaluate(() => JSON.stringify(window.__afterlife.game.caz.members));
  const stageBadge = () => page.evaluate(() => document.querySelector('[data-testid="caz-tryon-stage"]')?.textContent ?? null);
  const tile = (id) => page.locator(`.sh-bodies [data-body="${id}"]`);
  const press = async (id) => {
    await tile(id).scrollIntoViewIfNeeded();
    await tile(id).click();
  };
  const tab = (name) => page.locator('.sh-editor__tabs [role="tab"]', { hasText: name }).click();
  const selectedTab = () => page.evaluate(() => document.querySelector('.sh-editor__tabs [role="tab"][aria-selected="true"]')?.textContent?.trim() ?? null);
  /** The turntable's pixels, for "did the picture change". */
  const stagePixels = async () => (await page.locator('.sh-stage__gl').screenshot()).toString('base64');
  return { ctx, page, errors, glb, until, member, household, stageBadge, tile, press, tab, selectedTab, stagePixels };
}

try {
  // ───────── a new player, owning nothing (what the public build is today) ─────────
  const p = await openCreator();
  check('the creator opens on the Identity tab', (await p.selectedTab()) === 'Identity');
  const card = p.page.locator('[data-testid="caz-zombie-card"]');
  check('the first tab shows which zombie this is and how many there are', (await card.count()) === 1 && /31 zombies/.test(await card.innerText()), (await card.innerText().catch(() => '')).replace(/\s+/g, ' '));
  await card.getByRole('button', { name: 'Browse all zombies' }).click();
  await p.until(() => document.querySelector('.sh-editor__tabs [role="tab"][aria-selected="true"]')?.textContent?.includes('Body'));
  check('"Browse all zombies" opens the Body tab', (await p.selectedTab()) === 'Body');
  const tiles = await p.page.evaluate(() => [...document.querySelectorAll('.sh-bodies [data-body]')].map((b) => ({ id: b.dataset.body, locked: b.hasAttribute('data-locked'), disabled: b.getAttribute('aria-disabled') === 'true', text: b.textContent })));
  check('31 zombies are listed', tiles.length === 31, String(tiles.length));
  check('the five premium zombies are locked and say they can be previewed', PREMIUM.every((id) => tiles.some((t) => t.id === id && t.locked && /Coming soon/.test(t.text) && /Tap to preview/.test(t.text))));
  check('no free zombie offers a preview', tiles.filter((t) => !t.locked).every((t) => !/preview/i.test(t.text)));
  check('exactly the five premium zombies are locked, and none is announced as a disabled control', tiles.filter((t) => t.locked).map((t) => t.id).sort().join() === [...PREMIUM].sort().join() && tiles.every((t) => !t.disabled));

  await p.page.waitForTimeout(3500); // the greeting wave ends; the turntable settles
  const mine = await p.member();
  const plainStage = await p.stagePixels();
  check('no preview at the start', (await p.stageBadge()) === null);

  await p.press('sexton');
  await p.until(() => !!document.querySelector('[data-testid="caz-tryon-stage"]'));
  check('pressing a locked premium zombie labels the turntable as a preview of it', /Preview: The Sexton/.test((await p.stageBadge()) ?? '') && /coming soon/i.test((await p.stageBadge()) ?? ''), (await p.stageBadge()) ?? '');
  check('the Body tab says it is a preview and nothing changed', /Previewing The Sexton/.test(await p.page.locator('[data-testid="caz-tryon-notice"]').innerText()));
  check('the pressed tile is marked as previewing, and still not selected', await p.page.evaluate(() => {
    const t = document.querySelector('.sh-bodies [data-body="sexton"]');
    return t.hasAttribute('data-tryon') && t.getAttribute('aria-checked') === 'false' && /Previewing/.test(t.textContent);
  }));
  await p.until(() => !document.querySelector('[data-testid="caz-body-status"]'), undefined, 120_000);
  await p.page.waitForTimeout(2500);
  check('the premium model was downloaded', p.glb.some((g) => /premium\/sexton(_low)?\.glb/.test(g.url) && g.status === 200), JSON.stringify(p.glb.map((g) => `${g.status} ${g.url.split('/').pop()}`)));
  const previewStage = await p.stagePixels();
  check('the turntable picture changed', previewStage !== plainStage);
  check('the household member is unchanged by the preview', (await p.member()) === mine);
  check('the household is still valid', (await p.page.evaluate(() => window.__afterlife.game.validateCaz().length)) === 0);
  if (SHOTS) await p.page.screenshot({ path: path.join(SHOTS, 'preview-sexton.png') });

  await p.press('sexton');
  await p.until(() => !document.querySelector('[data-testid="caz-tryon-stage"]'));
  check('pressing it again stops the preview', (await p.stageBadge()) === null && (await p.member()) === mine);

  await p.press('waitress');
  await p.until(() => !!document.querySelector('[data-testid="caz-tryon-stage"]'));
  await p.page.locator('[data-testid="caz-tryon-notice"]').getByRole('button', { name: 'Stop preview' }).click();
  await p.until(() => !document.querySelector('[data-testid="caz-tryon-stage"]'));
  check('"Stop preview" stops it', (await p.member()) === mine);

  await p.press('waitress');
  await p.until(() => !!document.querySelector('[data-testid="caz-tryon-stage"]'));
  await p.tab('Identity');
  await p.until(() => !document.querySelector('[data-testid="caz-tryon-stage"]'));
  await p.tab('Body');
  await p.page.waitForTimeout(400);
  check('leaving the Body tab ends the preview, and coming back does not restore it', (await p.stageBadge()) === null && (await p.member()) === mine);

  await p.tile('lowside').focus();
  await p.page.keyboard.press('Enter');
  await p.until(() => !!document.querySelector('[data-testid="caz-tryon-stage"]'));
  check('the keyboard can preview too (Enter), without selecting', /Lowside/.test((await p.stageBadge()) ?? '') && (await p.member()) === mine);

  await p.press('bride');
  await p.until(() => !document.querySelector('[data-testid="caz-tryon-stage"]'));
  const afterBride = JSON.parse(await p.member());
  check('choosing a free zombie ends the preview and selects that zombie', afterBride.appearance.body === 'bride' && (await p.stageBadge()) === null, String(afterBride.appearance.body));

  await p.press('patient');
  await p.until(() => !!document.querySelector('[data-testid="caz-tryon-stage"]'));
  await p.page.locator('.sh-random button', { hasText: 'Look' }).click();
  await p.until(() => !document.querySelector('[data-testid="caz-tryon-stage"]'));
  const rolled = JSON.parse(await p.member());
  check('rolling a new look ends the preview and never rolls a premium body', !PREMIUM.includes(rolled.appearance.body), String(rolled.appearance.body));

  await p.press('fisherman');
  await p.until(() => !!document.querySelector('[data-testid="caz-tryon-stage"]'));
  await p.page.getByRole('button', { name: /Add a zombie/ }).click();
  await p.until(() => window.__afterlife.game.caz.members.length === 2);
  await p.page.waitForTimeout(400);
  check('adding another zombie ends the preview', (await p.stageBadge()) === null);
  check('no household member has a premium body', JSON.parse(await p.household()).every((m) => !PREMIUM.includes(m.appearance.body)));

  // start the game while a preview is showing: the started household must hold no premium body
  await p.tab('Body');
  await p.press('sexton');
  await p.until(() => !!document.querySelector('[data-testid="caz-tryon-stage"]'));
  const before = await p.household();
  await p.until(() => window.__afterlife.game.validateCaz().length === 0);
  await p.page.locator('.sh-editor__start').click();
  await p.until(() => window.__afterlife.game.screen === 'game' && !!window.__afterlife.game.sim, undefined, 300_000);
  const started = await p.page.evaluate(() => Object.values(window.__afterlife.game.sim.state.agents).map((a) => ({ name: a.name ?? a.firstName ?? '', body: a.appearance?.body ?? 'classic' })));
  check('a game started during a preview holds no premium body', started.length >= 2 && started.every((a) => !PREMIUM.includes(a.body)), JSON.stringify(started.map((a) => a.body)));
  check('the household that started is the one the player made', JSON.parse(before).every((m) => started.some((a) => a.body === (m.appearance.body ?? 'classic'))));
  check('no page errors for the new player', p.errors.length === 0, p.errors.slice(0, 2).join(' | '));
  await p.ctx.close();

  // ───────── a child profile: can look, sees no price ─────────
  const kid = await openCreator({ birthYearsAgo: 8 });
  await kid.tab('Body');
  await kid.press('sexton');
  await kid.until(() => !!document.querySelector('[data-testid="caz-tryon-stage"]'));
  const kidText = await kid.page.evaluate(() => `${document.querySelector('.sh-bodies').textContent} ${document.querySelector('[data-testid="caz-tryon-stage"]').textContent} ${document.querySelector('[data-testid="caz-tryon-notice"]').textContent}`);
  check('a child profile can preview, and is shown no price anywhere', !/\bGG\b|\d,\d{3}/.test(kidText));
  await kid.ctx.close();

  // ───────── control: an account that owns the body really selects it, so the checks above can tell the two apart ─────────
  const o = await openCreator({ owns: ['sexton'] });
  await o.tab('Body');
  const ownedBefore = await o.member();
  await o.press('sexton');
  await o.until(() => window.__afterlife.game.caz.members[0].appearance.body === 'sexton');
  check('control: an owner pressing the same tile changes the household member (a real selection)', (await o.member()) !== ownedBefore && JSON.parse(await o.member()).appearance.body === 'sexton');
  check('control: an owner gets no preview label and no preview hint on the owned tile', (await o.stageBadge()) === null && !(await o.tile('sexton').innerText()).match(/preview/i));
  check('control: a body the owner does not own is still only a preview', await (async () => {
    await o.press('lowside');
    await o.until(() => !!document.querySelector('[data-testid="caz-tryon-stage"]'));
    return JSON.parse(await o.member()).appearance.body === 'sexton';
  })());
  await o.ctx.close();
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
console.log(failures === 0 ? '[caz-preview] all checks passed' : `[caz-preview] ${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
