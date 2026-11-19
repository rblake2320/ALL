/**
 * W-123 (D-070) one-click quest rows — real-browser checks + screenshots:
 *
 *   node tests/e2e/questGo.mjs [--no-build] [--url=http://127.0.0.1:4173/] [--out=dev/out/w123] [--desktop-only|--phone-only]
 *
 * For desktop 1280×720 and phone portrait 390×844 (the phone with isMobile + hasTouch), on the DEFAULT new game (the
 * derelict shack, Act 1):
 *  1. with the camera panned away, clicking the "Patch… / Squatter's Rights" quest ROW itself (not a button; phone:
 *     inside the quest overlay) queues home_checkMail for a zombie, toasts "<Name> is heading to the …", folds the
 *     phone overlay, and frames the mailbox on screen clear of the HUD; screenshot go-queued-<vp>.png;
 *  2. the zombie walks there and the interaction starts (phase 'run' / the step completes); screenshot
 *     go-arrived-<vp>.png;
 *  3. the next row (Sleep in the coffin): desktop — keyboard Enter on the focused row, twice; phone — the Go button
 *     (≥ 44 px) tapped twice: exactly ONE home_sleep is queued;
 *  4. "missing": with the coffin sold, the row reads "Needs a coffin" + Shop; Shop opens Buy mode with the catalog
 *     filtered to the coffins ("For your quest — a coffin"); screenshot go-missing-catalog-<vp>.png.
 * Exit 1 on any failed check.
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
const OUT = path.resolve(ROOT, opt('out', path.join('dev', 'out', 'w123')));
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

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  try {
    await page.screenshot({ path: file, timeout: 180_000 });
    console.log(`      screenshot ${path.relative(ROOT, file)}`);
  } catch (e) {
    console.log(`      (screenshot ${name} failed: ${String(e.message).split('\n')[0]})`);
  }
}

const settle = (page, ms = 2500) => page.waitForTimeout(ms);

/** In page: is object `id` on screen and clear of every HUD panel? */
function objectAudit(id) {
  const g = window.__afterlife.game;
  const r = g.renderer;
  const canvas = document.getElementById('game-canvas');
  const cr = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
  const c = typeof r.objectPoint === 'function' ? r.objectPoint(id) : null;
  if (!c) return { ok: false, why: 'no point' };
  const s = r.worldToScreen(c.x, c.y, c.z);
  const PAD = 14;
  const box = { x: s.x + cr.left - PAD, y: s.y + cr.top - PAD, w: 2 * PAD, h: 2 * PAD };
  const covered = Array.from(document.querySelectorAll('[data-hud-region]'))
    .map((el) => (el.classList.contains('hud-queue') ? el.querySelector('.hud-queue__list') || el : el))
    .map((el) => ({ el, b: el.getBoundingClientRect() }))
    .filter(({ el, b }) => b.width > 1 && b.height > 1 && getComputedStyle(el).visibility !== 'hidden' && b.width * b.height < 0.5 * innerWidth * innerHeight)
    .filter(({ b }) => box.x < b.right && b.left < box.x + box.w && box.y < b.bottom && b.top < box.y + box.h)
    .map(({ el }) => String(el.className).split(' ')[0]);
  const onScreen = s.visible && box.x >= 0 && box.y >= 0 && box.x + box.w <= innerWidth && box.y + box.h <= innerHeight;
  return { ok: onScreen && covered.length === 0, onScreen, covered, x: Math.round(s.x), y: Math.round(s.y) };
}

/** In page: the household's queue / active items for an interaction. */
function itemsFor(interactionId) {
  const sim = window.__afterlife.game.sim;
  const out = [];
  for (const id of sim.state.household.memberIds) {
    const a = sim.state.agents[id];
    for (const q of [a.active, ...a.queue]) if (q && q.interactionId === interactionId) out.push({ agent: id, phase: q.phase || 'queued', source: q.source, uid: q.uid });
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
  check('the default new game is the derelict shack', (await page.evaluate(() => window.__afterlife.game.caz.lotTemplate)) === 'derelict');
  await tap(page.locator('.sh-editor__start'));
  await until(page, 'game', () => window.__afterlife.game.screen === 'game', undefined, 600_000);
  await until(page, 'renderer + HUD', () => window.__afterlife.game.renderer.loadProgress() >= 1 && !!document.querySelector('.hud-funds'), undefined, 600_000);
  await page.evaluate(() => window.__afterlife.game.dismissHint('story:intro'));
  await until(page, 'card dismissed', () => !window.__afterlife.game.hint || window.__afterlife.game.hint.id !== 'story:intro', undefined, 20_000);
}

async function clearToasts(page) {
  await page.evaluate(() => {
    const g = window.__afterlife.game;
    for (const t of (g.toasts || []).slice()) g.dismissToast(t.id);
  });
}

/** Tutorial tips (e.g. "Your household") are callouts that can sit over the quest panel on a phone: close them. */
async function dismissTips(page) {
  await page.evaluate(() => {
    const g = window.__afterlife.game;
    if (g.hint) g.dismissHint(g.hint.id);
  });
}

async function openQuests(page, phone) {
  await dismissTips(page);
  if (!phone) return;
  if (await page.locator('#st-hud-panel').isVisible().catch(() => false)) return;
  // toasts sit where the quest chip is on a phone: clear them and wait until they are gone (as openingPolish does)
  await clearToasts(page);
  await until(page, 'toasts cleared', () => document.querySelectorAll('.hud-toast').length === 0, undefined, 20_000);
  for (let i = 0; i < 3 && !(await page.locator('#st-hud-panel').isVisible().catch(() => false)); i++) {
    await tap(page.locator('[data-testid="hud-quests-chip"]'));
    await page.waitForTimeout(800);
  }
  await until(page, 'quests overlay open', () => !!document.querySelector('#st-hud-panel'), undefined, 20_000);
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
    // 1. click the quest ROW (its title text — not a button). Paused, so the zombie (who may start right by the
    // mailbox) cannot finish the step before the framing is measured — Go queues while paused too.
    await page.evaluate(() => window.__afterlife.game.setSpeed(0));
    await page.evaluate(() => window.__afterlife.game.renderer.focus({ x: 2, z: 2 }, true));
    await settle(page, 1200);
    const mailbox = await page.evaluate(() => Object.values(window.__afterlife.game.sim.state.objects).find((o) => o.defId === 'mailbox_crooked').id);
    const away = await page.evaluate(objectAudit, mailbox);
    await openQuests(page, vp.phone);
    const row = page.locator('[data-testid="quest-act1_claim"]');
    await row.waitFor({ state: 'visible', timeout: 60_000 });
    check(`${tag}: the claim row offers Go (kind queue)`, (await row.getAttribute('data-go-kind')) === 'queue', await row.getAttribute('data-go-kind'));
    const label = await row.locator('[data-testid="quest-go"]').getAttribute('aria-label');
    check(`${tag}: Go button has a screen-reader label`, /^Go: /.test(label || ''), label);
    if (vp.phone) {
      const b = await row.locator('[data-testid="quest-go"]').boundingBox();
      check(`${tag}: Go button ≥ 44 px`, b && b.width >= 44 && b.height >= 44, b);
    }
    await clearToasts(page);
    await dismissTips(page);
    await settle(page, 400);
    await tap(row.locator('.st-task__title'));
    await until(page, 'checkMail queued', (id) => {
      const sim = window.__afterlife.game.sim;
      return sim.state.household.memberIds.some((m) => [sim.state.agents[m].active, ...sim.state.agents[m].queue].some((q) => q && q.interactionId === id));
    }, 'home_checkMail', 20_000);
    const items = await page.evaluate(itemsFor, 'home_checkMail');
    check(`${tag}: clicking the row queued exactly one Check Mail (player order)`, items.length === 1 && items[0].source === 'player', items);
    const toast = await page.evaluate(() => (window.__afterlife.game.toasts || []).map((t) => t.title).find((t) => / is heading to the /.test(t)) || null);
    check(`${tag}: toast "<Name> is heading to the …"`, !!toast, toast);
    if (!vp.phone) {
      // W-123 follow-up: the toast stack must never cover the open Quests panel (it sat on its top rows before)
      await until(page, 'toast rendered', () => document.querySelectorAll('.hud-toast').length > 0, undefined, 10_000);
      const overlap = await page.evaluate(() => {
        const panel = document.querySelector('#st-hud-panel')?.getBoundingClientRect();
        const bar = document.querySelector('.st-hud__bar')?.getBoundingClientRect();
        const hit = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        // what is actually painted: each toast clipped by its stack (the stack clips the slide-in entrance)
        const stack = document.querySelector('.hud-toasts');
        const clipX = stack && getComputedStyle(stack).overflowX !== 'visible' ? stack.getBoundingClientRect() : null;
        const toasts = [...document.querySelectorAll('.hud-toast')].map((t) => {
          const r = t.getBoundingClientRect();
          return clipX ? { left: Math.max(r.left, clipX.left), right: Math.min(r.right, clipX.right), top: r.top, bottom: r.bottom } : r;
        });
        const inView = toasts.every((t) => t.left >= 0 && t.right <= innerWidth && t.top >= 0);
        return { mode: document.documentElement.getAttribute('data-toasts-avoid'), toasts: toasts.length, panelHit: toasts.some((t) => hit(t, panel)), barHit: toasts.some((t) => hit(t, bar)), inView };
      });
      check(`${tag}: toasts clear of the Quests panel and bar, fully on screen`, overlap.toasts > 0 && !overlap.panelHit && !overlap.barHit && overlap.inView, overlap);
    }
    if (vp.phone) await until(page, 'quests overlay folded', () => !document.querySelector('#st-hud-panel'), undefined, 20_000);
    await settle(page, 3000);
    const framed = await page.evaluate(objectAudit, mailbox);
    check(`${tag}: camera framed the mailbox clear of the HUD (it was ${away.ok ? 'visible' : 'off / covered'} before)`, framed.ok, { away, framed });
    await shot(page, `go-queued-${tag}`);
    // 2. the zombie walks there and the interaction starts
    const actor = items[0].agent;
    const d0 = await page.evaluate(([a, o]) => { const sim = window.__afterlife.game.sim; const p = sim.state.agents[a].pos; const c = sim.spatial.objectCenter(sim.state.objects[o]); return Math.hypot(p.x - c.x, p.z - c.z); }, [actor, mailbox]);
    await page.evaluate(() => window.__afterlife.game.setSpeed(3));
    await until(page, 'check mail running or done', () => { const sim = window.__afterlife.game.sim; return (sim.state.quests.completions.act1_claim || 0) > 0 || sim.state.household.memberIds.some((m) => { const a = sim.state.agents[m].active; return a && a.interactionId === 'home_checkMail' && a.phase === 'run'; }); }, undefined, 240_000);
    await page.evaluate(() => window.__afterlife.game.setSpeed(0));
    const d1 = await page.evaluate(([a, o]) => { const sim = window.__afterlife.game.sim; const p = sim.state.agents[a].pos; const c = sim.spatial.objectCenter(sim.state.objects[o]); return Math.hypot(p.x - c.x, p.z - c.z); }, [actor, mailbox]);
    check(`${tag}: the zombie walked to the mailbox and the interaction started`, d1 <= Math.max(2.2, d0), { d0, d1 });
    await settle(page, 1500);
    await shot(page, `go-arrived-${tag}`);
    await page.evaluate(() => window.__afterlife.game.setSpeed(3));
    await until(page, 'Squatter’s Rights complete', () => (window.__afterlife.game.sim.state.quests.completions.act1_claim || 0) > 0, undefined, 240_000);
    await page.evaluate(() => window.__afterlife.game.setSpeed(0));
    // 3. next row: Enter on the focused row (desktop) / Go tapped twice (phone) — one queued sleep only
    await clearToasts(page);
    await openQuests(page, vp.phone);
    const rest = page.locator('[data-testid="quest-act1_rest"]');
    await rest.waitFor({ state: 'visible', timeout: 60_000 });
    if (vp.phone) {
      const go = rest.locator('[data-testid="quest-go"]');
      await go.waitFor({ state: 'visible', timeout: 30_000 });
      await go.click({ force: true });
      await openQuests(page, true);
      await rest.locator('[data-testid="quest-go"]').click({ force: true });
    } else {
      await rest.focus();
      await page.keyboard.press('Enter');
      await rest.focus();
      await page.keyboard.press('Enter');
    }
    await settle(page, 600);
    const sleeps = await page.evaluate(itemsFor, 'home_sleep');
    check(`${tag}: ${vp.phone ? 'two taps on Go' : 'Enter twice on the focused row'} queue ONE Sleep (no double-queue)`, sleeps.length === 1, sleeps);
    // 4. missing → Shop → filtered catalog
    await page.evaluate(() => {
      const g = window.__afterlife.game;
      for (const id of g.sim.state.household.memberIds) {
        const a = g.sim.state.agents[id];
        for (const q of [a.active, ...a.queue]) if (q && q.interactionId === 'home_sleep' && q.source === 'player') g.cancelQueueItem(q.uid);
      }
    });
    await settle(page, 800);
    await page.evaluate(() => {
      const g = window.__afterlife.game;
      const coffin = Object.values(g.sim.state.objects).find((o) => o.defId === 'coffin_pine');
      g.setMode('buy');
      g.sellObject(coffin.id);
      g.setMode('live');
    });
    await until(page, 'coffin sold', () => !Object.values(window.__afterlife.game.sim.state.objects).some((o) => o.defId === 'coffin_pine'), undefined, 20_000);
    await clearToasts(page);
    await openQuests(page, vp.phone);
    await until(page, 'row says missing', () => document.querySelector('[data-testid="quest-act1_rest"]')?.getAttribute('data-go-kind') === 'missing', undefined, 30_000);
    const need = await rest.locator('[data-testid="quest-go-need"]').textContent();
    const shop = rest.locator('[data-testid="quest-go"]');
    check(`${tag}: the row reads "Needs a coffin." with a Shop button`, /Needs a coffin/.test(need || '') && /Shop/.test((await shop.textContent()) || ''), need);
    await shot(page, `go-missing-row-${tag}`);
    await shop.click({ force: true });
    await until(page, 'buy catalog', () => window.__afterlife.game.mode === 'buy' && !!document.querySelector('[data-testid="buy-quest-filter"]'), undefined, 30_000);
    const cat = await page.evaluate(() => ({
      chip: document.querySelector('[data-testid="buy-quest-filter"]').textContent,
      items: Array.from(document.querySelectorAll('#hud-buy-grid .hud-item__name')).map((e) => e.textContent),
      category: window.__afterlife.game.buy.category,
    }));
    const coffinNames = await page.evaluate(() => ['coffin_pine', 'coffin_chillrest', 'sarcophagus_cryo'].map((d) => window.__afterlife.game.sim.content.objects[d].name));
    check(`${tag}: Shop opened the catalog filtered to what satisfies the step (coffins only)`, /a coffin/.test(cat.chip) && cat.items.length > 0 && cat.items.every((n) => coffinNames.includes(n)), cat);
    await settle(page, 1200);
    await shot(page, `go-missing-catalog-${tag}`);
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
  console.log(`\n${failed ? 'W-123 QUEST GO E2E FAILED' : 'W-123 QUEST GO E2E PASSED'}: ${results.length - failed}/${results.length} checks — screenshots in ${path.relative(ROOT, OUT)}`);
  return failed ? 1 : 0;
}

main().then((code) => process.exit(code));
