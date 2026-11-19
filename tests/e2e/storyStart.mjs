/**
 * W-113 story start — real-browser check + screenshots (docs/systems/story-start.md §7):
 *
 *   node tests/e2e/storyStart.mjs [--no-build] [--url=http://127.0.0.1:4173/] [--out=dev/out/w113]
 *
 *  1. New Game ("plot step") at 390×844 and 844×390 (phone portrait / landscape, deviceScaleFactor 1):
 *     the derelict claim is the first card and preselected; no card child overflows its card horizontally
 *     (tag, name, description, funds); no lot name wraps one word per line; no horizontal page scroll.
 *  2. A desktop 1280×720 New Game screenshot.
 *  3. Start the default (derelict) game: the "Rise and Squat" card is up (hint id story:intro), the world carries
 *     the act1 story arc and the first story quest is act1_claim; screenshot of the first in-game view.
 * Exit 1 on any failed check. Screenshots: <out>/caz-plot-390x844.png, caz-plot-844x390.png, caz-plot-1280x720.png,
 * derelict-first-view.png, derelict-first-view-skipped.png.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureBuild, startPreview } from './lib/server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const a = argv.find((x) => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : d;
};
const OUT = path.resolve(ROOT, opt('out', path.join('dev', 'out', 'w113')));
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail).slice(0, 400)}`}`);
};

async function until(page, fn, arg, timeout = 120_000) {
  await page.waitForFunction(fn, arg, { polling: 250, timeout });
}

async function toNewGame(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await until(page, () => window.__afterlife?.game?.screen === 'menu', undefined, 300_000);
  // fresh profile: the age gate sits over the menu
  const gate = page.locator('.st-age-dialog .st-age__input');
  if (await gate.isVisible().catch(() => false)) {
    await gate.fill(String(new Date().getFullYear() - 30));
    await page.locator('[data-testid="age-continue"]').click({ force: true });
    await until(page, () => !document.querySelector('.st-age-dialog'));
  }
  await page.locator('.sh-menu__item', { hasText: 'New Game' }).first().click({ force: true });
  await until(page, () => window.__afterlife.game.screen === 'newGame' && document.querySelectorAll('.sh-lots [role="radio"]').length === 3);
  await page.waitForTimeout(900); // rise-in animation
}

/** Layout audit of the New Game cards, in page. */
function audit() {
  const out = { order: [], selected: null, overflow: [], oneWordLines: [], pageScroll: document.documentElement.scrollWidth > window.innerWidth + 1 };
  for (const card of document.querySelectorAll('.sh-lots [role="radio"]')) {
    out.order.push(card.getAttribute('data-lot'));
    if (card.getAttribute('aria-checked') === 'true') out.selected = card.getAttribute('data-lot');
    const cr = card.getBoundingClientRect();
    for (const el of card.querySelectorAll('.sh-lot__body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.left < cr.left - 1 || r.right > cr.right + 1 || el.scrollWidth > el.clientWidth + 1) {
        if (getComputedStyle(el).textOverflow === 'ellipsis' && r.right <= cr.right + 1) continue; // ellipsised inside the card
        out.overflow.push({ lot: card.getAttribute('data-lot'), cls: el.className, text: (el.textContent || '').slice(0, 40), right: Math.round(r.right), cardRight: Math.round(cr.right), sw: el.scrollWidth, cw: el.clientWidth });
      }
    }
    const name = card.querySelector('.sh-lot__name');
    if (name) {
      const words = (name.textContent || '').trim().split(/\s+/).length;
      const lh = parseFloat(getComputedStyle(name).lineHeight) || 20;
      const lines = Math.round(name.getBoundingClientRect().height / lh);
      if (words > 1 && lines >= words) out.oneWordLines.push({ lot: card.getAttribute('data-lot'), words, lines });
    }
  }
  return out;
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
  const errors = [];
  try {
    for (const vp of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 1280, height: 720 },
    ]) {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${vp.width}x${vp.height} pageerror: ${e.message}`));
      await toNewGame(page, url);
      const a = await page.evaluate(audit);
      const tag = `${vp.width}x${vp.height}`;
      check(`${tag}: derelict card first`, a.order[0] === 'derelict', a.order);
      check(`${tag}: three lots (derelict, starter, empty)`, a.order.join() === 'derelict,starter,empty', a.order);
      check(`${tag}: derelict preselected`, a.selected === 'derelict', a.selected);
      check(`${tag}: nothing overflows a card`, a.overflow.length === 0, a.overflow);
      check(`${tag}: no lot name wraps one word per line`, a.oneWordLines.length === 0, a.oneWordLines);
      check(`${tag}: no horizontal page scroll`, !a.pageScroll);
      await page.screenshot({ path: path.join(OUT, `caz-plot-${tag}.png`), fullPage: false });
      if (vp.width === 390) {
        // the furnished card scrolled into view (its tag was the one that overflowed)
        await page.locator('.sh-lots [data-lot="starter"]').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(OUT, `caz-plot-${tag}-starter.png`) });
      }
      if (vp.width === 1280) {
        await page.getByRole('button', { name: 'Create your household' }).click({ force: true });
        await until(page, () => window.__afterlife.game.screen === 'caz' && !!window.__afterlife.game.caz);
        check('CAZ state carries the derelict lot', (await page.evaluate(() => window.__afterlife.game.caz.lotTemplate)) === 'derelict');
        await until(page, () => window.__afterlife.game.validateCaz().length === 0, undefined, 60_000);
        await page.locator('.sh-editor__start').click({ force: true });
        await until(page, () => window.__afterlife.game.screen === 'game', undefined, 300_000);
        await until(page, () => window.__afterlife.game.renderer.loadProgress() >= 1 && !!document.querySelector('.hud-funds'), undefined, 300_000);
        const s = await page.evaluate(() => {
          const g = window.__afterlife.game;
          return { hint: g.hint && g.hint.id, title: g.hint && g.hint.title, arc: g.sim.state.flags.storyArc, quests: g.sim.state.quests.active.map((q) => q.questId), funds: g.sim.state.household.funds, objects: Object.keys(g.sim.state.objects).length };
        });
        check('first view: the story card is up', s.hint === 'story:intro' && s.title === 'Rise and Squat', s);
        check('first view: world on the act1 arc, first beat act1_claim', s.arc === 'act1' && s.quests[0] === 'act1_claim', s);
        check('first view: the bare shack (≤ 12 objects) and $2,500', s.objects <= 12 && s.funds === 2500, s);
        await page.waitForTimeout(2500); // let SwiftShader draw a few frames
        await page.screenshot({ path: path.join(OUT, 'derelict-first-view.png') });
        await page.locator('.hud-hint-bubble button', { hasText: 'Let’s go' }).click({ force: true });
        await until(page, () => !window.__afterlife.game.hint || window.__afterlife.game.hint.id !== 'story:intro', undefined, 15_000);
        check('the card skips with its button', true);
        await page.waitForTimeout(1500);
        await page.screenshot({ path: path.join(OUT, 'derelict-first-view-skipped.png') });
      }
      await ctx.close();
    }
  } finally {
    await browser.close().catch(() => {});
    await server?.stop().catch(() => {});
  }
  for (const e of errors) check('no page errors', false, e);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${failed ? 'STORY START E2E FAILED' : 'STORY START E2E PASSED'}: ${results.length - failed}/${results.length} checks — screenshots in ${path.relative(ROOT, OUT)}`);
  return failed ? 1 : 0;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  },
);
