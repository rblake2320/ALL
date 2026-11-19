/**
 * W-116 opening polish — real-browser checks + screenshots for the owner playtest fixes:
 *
 *   node tests/e2e/openingPolish.mjs [--no-build] [--url=http://127.0.0.1:4173/] [--out=dev/out/w116]
 *
 * For desktop 1280×720 and phone portrait 390×844 (deviceScaleFactor 1; the phone with isMobile + hasTouch), on the
 * DEFAULT new game (the derelict shack, Act 1):
 *  1. first view: the story marker floats over the mailbox (act1_claim#mail), and the mailbox and the marker tip are on
 *     screen and NOT under any HUD panel ([data-hud-region]); screenshot first-view-marker-<vp>.png;
 *  2. "Show me": with the camera panned far away, the quest row's Show me brings the mailbox back on screen, clear of
 *     the HUD; screenshot show-me-<vp>.png;
 *  3. the mailbox reads the CONDEMNED letter (never "empty"); screenshot mailbox-letter-<vp>.png;
 *  4. the placement bar: item name + price + hint + a Done button (≥ 44 px on phone, with "Place another"); Done ends
 *     placement; screenshot placement-bar-<vp>.png;
 *  5. the household ledger's "Autonomous purchases" shows Daily cap ($50) on this new derelict world; Off is stored in
 *     the world; screenshot household-autobuy-<vp>.png.
 * Also at 360×640 (first view only): no toast rectangle intersects the story card (toasts wait on phone while it is
 * up) and a deferred toast appears once the card is gone. Exit 1 on any failed check.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureBuild, startPreview } from './lib/server.mjs';
import { initScript } from './lib/inpage.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const a = argv.find((x) => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : d;
};
const OUT = path.resolve(ROOT, opt('out', path.join('dev', 'out', 'w116')));
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail).slice(0, 600)}`}`);
  return !!ok;
};

async function until(page, what, fn, arg, timeout = 180_000) {
  try {
    await page.waitForFunction(fn, arg, { polling: 250, timeout });
  } catch (e) {
    throw new Error(`timed out (${timeout} ms) waiting for ${what}: ${String(e.message).split('\n')[0]}`);
  }
}

const tap = async (loc, timeout = 60_000) => {
  const el = loc.first();
  await el.waitFor({ state: 'visible', timeout });
  await el.click({ force: true, timeout });
};

/** In page: where the story target and the marker tip are on screen, and which HUD panels cover them. */
function targetAudit() {
  const g = window.__afterlife.game;
  const r = g.renderer;
  const m = typeof r.storyMarker === 'function' ? r.storyMarker() : null;
  const t = g.storyTarget;
  const out = { marker: m, target: t, vp: { w: innerWidth, h: innerHeight }, points: [], covered: [], offscreen: [] };
  if (!t) return out;
  const canvas = document.getElementById('game-canvas');
  const cr = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
  const c = typeof r.objectPoint === 'function' ? r.objectPoint(t.objectId) : null;
  const pts = [];
  if (c) pts.push(['object', c]);
  if (m) pts.push(['marker', m.tip]);
  const rects = Array.from(document.querySelectorAll('[data-hud-region]'))
    // the queue container spans the width; what covers the world is its list (the bubble)
    .map((el) => (el.classList.contains('hud-queue') ? el.querySelector('.hud-queue__list') || el : el))
    .map((el) => ({ el, b: el.getBoundingClientRect() }))
    .filter(({ el, b }) => b.width > 1 && b.height > 1 && getComputedStyle(el).visibility !== 'hidden' && b.width * b.height < 0.5 * innerWidth * innerHeight)
    .map(({ el, b }) => ({ region: el.getAttribute('data-hud-region') || el.closest('[data-hud-region]')?.getAttribute('data-hud-region'), cls: String(el.className).split(' ')[0], x: b.left, y: b.top, w: b.width, h: b.height }));
  const PAD = 14; // a small box around each point (the mailbox is ~0.6 world units across)
  for (const [name, p] of pts) {
    const s = r.worldToScreen(p.x, p.y, p.z);
    const box = { x: s.x + cr.left - PAD, y: s.y + cr.top - PAD, w: 2 * PAD, h: 2 * PAD };
    out.points.push({ name, x: Math.round(box.x + PAD), y: Math.round(box.y + PAD), visible: s.visible });
    if (!s.visible || box.x < 0 || box.y < 0 || box.x + box.w > innerWidth || box.y + box.h > innerHeight) out.offscreen.push(name);
    for (const q of rects) if (box.x < q.x + q.w && q.x < box.x + box.w && box.y < q.y + q.h && q.y < box.y + box.h) out.covered.push({ point: name, by: q.cls, region: q.region });
  }
  return out;
}

async function newDerelictGame(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await until(page, 'menu', () => window.__afterlife?.game?.screen === 'menu', undefined, 600_000);
  const gate = page.locator('.st-age-dialog .st-age__input');
  if (await gate.isVisible().catch(() => false)) {
    await gate.fill(String(new Date().getFullYear() - 30));
    await tap(page.locator('[data-testid="age-continue"]'));
    await until(page, 'age gate closed', () => !document.querySelector('.st-age-dialog'));
  }
  await tap(page.locator('.sh-menu__item', { hasText: 'New Game' }));
  await until(page, 'new game', () => window.__afterlife.game.screen === 'newGame' && document.querySelectorAll('.sh-lots [role="radio"]').length === 3);
  await tap(page.getByRole('button', { name: 'Create your household' }));
  await until(page, 'caz', () => window.__afterlife.game.screen === 'caz' && !!window.__afterlife.game.caz);
  await until(page, 'caz valid', () => window.__afterlife.game.validateCaz().length === 0, undefined, 60_000);
  const lot = await page.evaluate(() => window.__afterlife.game.caz.lotTemplate);
  check('the default new game is the derelict shack', lot === 'derelict', lot);
  await tap(page.locator('.sh-editor__start'));
  await until(page, 'game', () => window.__afterlife.game.screen === 'game', undefined, 600_000);
  await until(page, 'renderer + HUD', () => window.__afterlife.game.renderer.loadProgress() >= 1 && !!document.querySelector('.hud-funds'), undefined, 600_000);
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  try {
    await page.screenshot({ path: file, timeout: 180_000 });
    console.log(`      screenshot ${path.relative(ROOT, file)}`);
  } catch (e) {
    console.log(`      (screenshot ${name} failed: ${String(e.message).split('\n')[0]})`);
  }
}

/** Wait for the camera to settle and a few frames to draw (SwiftShader is slow under load). */
async function settle(page, ms = 2500) {
  await page.waitForTimeout(ms);
}

async function runViewport(browser, url, vp) {
  const tag = vp.name;
  console.log(`\n=== ${tag} (${vp.width}×${vp.height}) ===`);
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, ...(vp.phone ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(initScript);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  try {
    await newDerelictGame(page, url);
    if (vp.phone) check(`${tag}: phone layout active`, await page.evaluate(() => document.documentElement.hasAttribute('data-phone')));
    // 1. first view
    await until(page, 'story marker over the target', () => {
      const r = window.__afterlife.game.renderer;
      return typeof r.storyMarker === 'function' && !!r.storyMarker();
    }, undefined, 120_000);
    await settle(page, 3000);
    let a = await page.evaluate(targetAudit);
    check(`${tag}: first view — the marker points at the mailbox (act1_claim#mail)`, a.marker && a.marker.stepId === 'mail' && a.target && a.target.defId === 'mailbox_crooked', { marker: a.marker, target: a.target });
    check(`${tag}: first view — the mailbox and its marker are on screen`, a.points.length === 2 && a.offscreen.length === 0, a);
    check(`${tag}: first view — not under any HUD panel`, a.covered.length === 0, a);
    check(`${tag}: first view — the story card is up`, (await page.evaluate(() => window.__afterlife.game.hint && window.__afterlife.game.hint.id)) === 'story:intro');
    // follow-up: no toast may sit on the story card (phone: toasts wait until the card is gone)
    const tc = await page.evaluate(() => {
      const card = document.querySelector('.hud-hint-bubble')?.getBoundingClientRect();
      const toasts = Array.from(document.querySelectorAll('.hud-toast, .st-toast')).map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
      const hit = card ? toasts.filter((r) => r.left < card.right && card.left < r.right && r.top < card.bottom && card.top < r.bottom).length : -1;
      return { card: !!card, toasts: toasts.length, hit, pending: (window.__afterlife.game.toasts || []).length };
    });
    check(`${tag}: no toast overlaps the story card`, tc.card && tc.hit === 0, tc);
    await shot(page, `first-view-marker-${tag}`);
    if (vp.firstViewOnly) {
      await page.evaluate(() => window.__afterlife.game.dismissHint('story:intro'));
      if (tc.pending > 0) {
        await until(page, 'deferred toasts shown after the card', () => document.querySelectorAll('.hud-toast').length > 0, undefined, 30_000);
        check(`${tag}: the deferred toast appears once the card is gone (nothing lost)`, true);
      }
      return;
    }
    // dismiss the card
    await page.evaluate(() => window.__afterlife.game.dismissHint('story:intro'));
    await until(page, 'card dismissed', () => !window.__afterlife.game.hint || window.__afterlife.game.hint.id !== 'story:intro', undefined, 20_000);
    // 2. Show me
    await page.evaluate(() => window.__afterlife.game.renderer.focus({ x: 2, z: 2 }, true));
    await settle(page, 1200);
    const away = await page.evaluate(targetAudit);
    if (vp.phone) {
      // the deferred toasts came back with the card gone: clear them (they sit where the quest chip is)
      await page.evaluate(() => {
        const g = window.__afterlife.game;
        for (const t of (g.toasts || []).slice()) g.dismissToast(t.id);
      });
      await until(page, 'toasts cleared', () => document.querySelectorAll('.hud-toast').length === 0, undefined, 20_000);
      await tap(page.locator('[data-testid="hud-quests-chip"]'));
      await until(page, 'quests overlay open', () => !!document.querySelector('#st-hud-panel'), undefined, 20_000);
    }
    await tap(page.locator('[data-testid="quest-show-me"]'));
    if (vp.phone) await until(page, 'quests overlay folded for the view', () => !document.querySelector('#st-hud-panel'), undefined, 20_000);
    await settle(page, 3500);
    a = await page.evaluate(targetAudit);
    check(`${tag}: Show me — the camera had been moved away first`, away.offscreen.length > 0 || away.covered.length > 0 || JSON.stringify(away.points) !== JSON.stringify(a.points), away.points);
    check(`${tag}: Show me — the mailbox is back on screen and clear of the HUD`, a.offscreen.length === 0 && a.covered.length === 0 && a.points.length === 2, a);
    await shot(page, `show-me-${tag}`);
    // 3. the CONDEMNED letter
    await page.evaluate(() => {
      const g = window.__afterlife.game;
      const sim = g.sim;
      const mb = Object.values(sim.state.objects).find((o) => o.defId === 'mailbox_crooked');
      sim.dispatch({ type: 'queue', actorId: sim.state.household.memberIds[0], interactionId: 'home_checkMail', target: { kind: 'object', id: mb.id } });
      g.setSpeed(3);
    });
    await until(page, 'mail checked', () => window.__afterlife.game.sim.state.notifications.some((n) => /checked the mail/.test(n.title)), undefined, 240_000);
    await page.evaluate(() => window.__afterlife.game.setSpeed(0));
    const letter = await page.evaluate(() => window.__afterlife.game.sim.state.notifications.filter((n) => /checked the mail/.test(n.title)).pop().text);
    check(`${tag}: the mailbox reads the CONDEMNED letter`, /CONDEMNED/.test(letter) && !/Nothing today|empty/i.test(letter), letter);
    check(`${tag}: … and Squatter's Rights completed`, (await page.evaluate(() => window.__afterlife.game.sim.state.quests.completions.act1_claim)) === 1);
    await until(page, 'the letter toast is on screen', () => Array.from(document.querySelectorAll('.hud-toasts, .hud-toast, [data-hud-region="60"]')).some((e) => /CONDEMNED/.test(e.textContent || '')), undefined, 30_000).catch(() => {});
    await settle(page, 800);
    await shot(page, `mailbox-letter-${tag}`);
    // 4. placement bar
    await page.evaluate(() => window.__afterlife.game.setMode('buy'));
    await until(page, 'buy mode', () => window.__afterlife.game.mode === 'buy' && !!document.querySelector('.hud-buy'), undefined, 30_000);
    await page.evaluate(() => window.__afterlife.game.startPlacing('chair_creaky'));
    await until(page, 'placement bar', () => !!document.querySelector('[data-testid="placement-bar"]'), undefined, 30_000);
    const bar = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="placement-bar"]');
      const d = b.querySelector('[data-testid="placement-done"]').getBoundingClientRect();
      return { text: b.textContent, done: { w: Math.round(d.width), h: Math.round(d.height) }, another: !!b.querySelector('[role="switch"]'), inView: d.left >= 0 && d.right <= innerWidth && d.top >= 0 && d.bottom <= innerHeight };
    });
    check(`${tag}: placement bar names the item, its price and the mode hint`, /Creaky/.test(bar.text) && /\$/.test(bar.text) && (vp.phone ? /Tap to place one/.test(bar.text) : /Shift\+click to keep placing/.test(bar.text)), bar);
    check(`${tag}: Done button on screen${vp.phone ? ' and ≥ 44 px' : ''}`, bar.inView && (!vp.phone || (bar.done.w >= 44 && bar.done.h >= 44)), bar.done);
    if (vp.phone) check(`${tag}: touch "Place another" toggle present`, bar.another);
    await shot(page, `placement-bar-${tag}`);
    const tipOver = await page.evaluate(() => {
      const d = document.querySelector('[data-testid="placement-done"]').getBoundingClientRect();
      const el = document.elementFromPoint(d.left + d.width / 2, d.top + d.height / 2);
      return el && !el.closest('[data-testid="placement-done"]') ? String(el.className).slice(0, 60) : null;
    });
    check(`${tag}: nothing (tips included) covers the Done button`, tipOver === null, tipOver);
    await tap(page.locator('[data-testid="placement-done"]'));
    await until(page, 'Done ends placement', () => !window.__afterlife.game.buy.placingDefId && !document.querySelector('[data-testid="placement-bar"]'), undefined, 30_000);
    check(`${tag}: Done ended placement, nothing bought`, (await page.evaluate(() => Object.values(window.__afterlife.game.sim.state.objects).filter((o) => o.defId === 'chair_creaky').length)) === 1);
    await page.evaluate(() => window.__afterlife.game.setMode('live'));
    // 5. household setting
    await page.evaluate(() => window.__afterlife.game.openDialog('household'));
    await until(page, 'household ledger', () => !!document.querySelector('[data-testid="household-autobuy"]'), undefined, 30_000);
    await page.locator('[data-testid="household-autobuy"]').scrollIntoViewIfNeeded().catch(() => {});
    const hb = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="household-autobuy"]');
      const sel = el.querySelector('[aria-checked="true"]');
      return { text: el.textContent, selected: sel ? sel.textContent : null, flag: window.__afterlife.game.sim.state.flags['household.autoBuy'] };
    });
    check(`${tag}: household ledger shows Autonomous purchases = Daily cap ($50) on a new derelict world`, /Autonomous purchases/.test(hb.text) && /Daily cap/.test(hb.selected || '') && /\$50/.test(hb.text) && hb.flag === 50, hb);
    await settle(page, 600);
    await shot(page, `household-autobuy-${tag}`);
    await tap(page.locator('[data-testid="household-autobuy"] [role="radio"]', { hasText: 'Off' }));
    await until(page, 'Off stored in the world', () => window.__afterlife.game.sim.state.flags['household.autoBuy'] === 'off', undefined, 20_000);
    check(`${tag}: choosing Off stores it in the world (sim-owned)`, true);
  } catch (e) {
    check(`${tag}: run`, false, String(e && e.stack ? e.stack : e).slice(0, 800));
    await shot(page, `failure-${tag}`);
  } finally {
    for (const e of errors) check(`${tag}: no page errors`, false, e);
    await ctx.close();
  }
}

async function main() {
  let url = opt('url', '');
  let server = null;
  const log = (s) => console.log(s);
  if (!url) {
    await ensureBuild({ root: ROOT, distDir: path.join(ROOT, 'dist'), mode: argv.includes('--no-build') ? 'never' : 'auto', log });
    server = await startPreview({ root: ROOT, distDir: path.join(ROOT, 'dist'), log });
    url = server.url;
  }
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    for (const vp of [
      { name: 'desktop-1280x720', width: 1280, height: 720, phone: false },
      { name: 'phone-390x844', width: 390, height: 844, phone: true },
      { name: 'phone-360x640', width: 360, height: 640, phone: true, firstViewOnly: true },
    ]) {
      if (argv.includes('--phone-only') && !vp.phone) continue;
      if (argv.includes('--desktop-only') && vp.phone) continue;
      await runViewport(browser, url, vp);
    }
  } finally {
    await browser.close().catch(() => {});
    await server?.stop().catch(() => {});
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${failed ? 'W-116 OPENING E2E FAILED' : 'W-116 OPENING E2E PASSED'}: ${results.length - failed}/${results.length} checks — screenshots in ${path.relative(ROOT, OUT)}`);
  return failed ? 1 : 0;
}

main().then((code) => process.exit(code));
