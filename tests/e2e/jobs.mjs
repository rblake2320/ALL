/**
 * W-124 (D-071) household jobs — real-browser checks + screenshots:
 *
 *   node tests/e2e/jobs.mjs [--no-build] [--url=http://127.0.0.1:4173/] [--out=dev/out/w124] [--dist=dist]
 *                           [--desktop-only|--phone-only]
 *
 * For desktop 1280×720 and phone portrait 390×844 (isMobile + hasTouch), on a new two-zombie game on the Fixer-Upper
 * (starter) lot with grimy tables and a bored second zombie:
 *  1. the agent panel's Jobs tab lists the categories honestly (Yard work / Cooking "Coming later", disabled);
 *  2. zombie A gets Cleaning (whole lot, until done) through the UI (desktop: mouse; phone: taps, every control
 *     ≥ 44 px); zombie B gets Play — on desktop by KEYBOARD only (arrow keys in the category radiogroup, Enter on
 *     Assign); one journaled `job` command each; screenshot jobs-assigned-<vp>.png;
 *  3. both make REAL progress: surfaces actually get wiped (dirt → 0) and B's fun rises, credited `done` > 0;
 *     screenshot jobs-progress-<vp>.png;
 *  4. save, reload the page, load the save: the same assignments come back with their progress, and they CONTINUE
 *     (more credited work after the reload); screenshot jobs-reloaded-<vp>.png.
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
const OUT = path.resolve(ROOT, opt('out', path.join('dev', 'out', 'w124')));
const DIST = path.resolve(ROOT, opt('dist', 'dist'));
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
    console.log(`      screenshot ${file}`);
  } catch (e) {
    console.log(`      (screenshot ${name} failed: ${String(e.message).split('\n')[0]})`);
  }
}

const settle = (page, ms = 1500) => page.waitForTimeout(ms);

async function skipAgeGate(page) {
  const gate = page.locator('.st-age-dialog .st-age__input');
  if (await gate.isVisible().catch(() => false)) {
    await gate.fill(String(new Date().getFullYear() - 30));
    await tap(page.locator('[data-testid="age-continue"]'));
    await until(page, 'age gate closed', () => !document.querySelector('.st-age-dialog'));
  }
}

async function newStarterGame(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await until(page, 'menu', () => window.__afterlife?.game?.screen === 'menu', undefined, 600_000);
  await skipAgeGate(page);
  await tap(page.locator('.sh-menu__item', { hasText: 'New Game' }));
  await until(page, 'new game', () => window.__afterlife.game.screen === 'newGame' && document.querySelectorAll('.sh-lots [role="radio"]').length === 3);
  await tap(page.getByRole('button', { name: 'Create your household' }));
  await until(page, 'caz', () => window.__afterlife.game.screen === 'caz' && !!window.__afterlife.game.caz);
  await page.evaluate(() => {
    const g = window.__afterlife.game;
    g.updateCaz({ lotTemplate: 'starter' });
    while (g.caz.members.length < 2) g.addCazMember();
  });
  await until(page, 'caz valid', () => window.__afterlife.game.validateCaz().length === 0, undefined, 60_000);
  await tap(page.locator('.sh-editor__start'));
  await until(page, 'game', () => window.__afterlife.game.screen === 'game', undefined, 600_000);
  await until(page, 'renderer + HUD', () => window.__afterlife.game.renderer.loadProgress() >= 1 && !!document.querySelector('.hud-funds'), undefined, 600_000);
  await dismissTips(page);
}

async function dismissTips(page) {
  await page.evaluate(() => {
    const g = window.__afterlife.game;
    for (let i = 0; i < 4 && g.hint; i++) g.dismissHint(g.hint.id);
    for (const t of (g.toasts || []).slice()) g.dismissToast(t.id);
  });
}

/** Test setup: grime on every table / counter / stove; the second zombie is bored. Returns the dirty ids. */
function setupWork() {
  const sim = window.__afterlife.game.sim;
  const dirty = [];
  for (const [id, o] of Object.entries(sim.state.objects)) {
    const d = sim.content.objects[o.defId];
    if (o.placement.kind === 'floor' && d && (d.interactions.includes('home_wipeDown') || d.interactions.includes('home_cleanStove'))) {
      o.condition.dirt = 0.6;
      dirty.push(id);
    }
  }
  const [, b] = sim.state.household.memberIds;
  sim.state.agents[b].needs.fun = 15.5;
  return { dirty, members: sim.state.household.memberIds.slice(0, 2) };
}

function jobsState() {
  const sim = window.__afterlife.game.sim;
  const list = (sim.state.jobs && sim.state.jobs.list) || [];
  return list.map((j) => ({ id: j.id, agentId: j.agentId, category: j.category, done: j.done, status: j.status, mode: j.mode.kind }));
}

async function openJobsFor(page, agentId) {
  await page.evaluate((id) => window.__afterlife.game.selectAgent(id, false), agentId);
  await until(page, 'agent panel', () => !!document.querySelector('.hud-agent'), undefined, 30_000);
  // expand if collapsed
  if (await page.locator('.hud-agent.is-collapsed').count()) await tap(page.getByRole('button', { name: 'Expand panel' }));
  await tap(page.getByRole('tab', { name: 'Jobs' }));
  await until(page, 'jobs tab', () => !!document.querySelector('.hud-jobs'), undefined, 30_000);
  await settle(page, 700);
}

/** Scroll the agent panel body back to the top (the job list) and let the tab's enter animation finish. */
async function showList(page) {
  await page.evaluate(() => {
    const b = document.querySelector('.hud-agent__body');
    if (b) b.scrollTop = 0;
  });
  await settle(page, 900);
}

/** Run at speed 3 until every job's credited count exceeds `before` (or ≥ 1); an in-page watcher pauses at once. */
async function runUntilBothProgress(page, before) {
  await page.evaluate((b) => {
    const g = window.__afterlife.game;
    window.__jobsWatch = { hit: false };
    const ok = () => {
      const l = g.sim.state.jobs?.list || [];
      return l.length === 2 && l.every((j) => j.done > (b ? b[j.id] ?? 0 : 0));
    };
    const t = setInterval(() => {
      if (ok()) {
        g.setSpeed(0);
        window.__jobsWatch.hit = true;
        clearInterval(t);
      }
    }, 50);
    g.setSpeed(3);
  }, before);
  await until(page, 'both jobs credited', () => window.__jobsWatch && window.__jobsWatch.hit, undefined, 420_000);
}

async function box(loc) {
  const b = await loc.boundingBox();
  return b ? { w: Math.round(b.width), h: Math.round(b.height) } : null;
}

async function runViewport(browser, url, vp) {
  const tag = vp.name;
  console.log(`\n=== ${tag} (${vp.width}×${vp.height}) ===`);
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, ...(vp.phone ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(initScript);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const slot = `jobs-e2e-${tag}`;
  try {
    await newStarterGame(page, url);
    await page.evaluate(() => window.__afterlife.game.setSpeed(0));
    const { dirty, members } = await page.evaluate(setupWork);
    const [a, b] = members;
    check(`${tag}: the starter lot has grimy surfaces to clean`, dirty.length >= 3, dirty);

    // 1. honest categories
    await openJobsFor(page, a);
    const cats = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.hud-jobs__cat')).map((el) => ({ id: el.getAttribute('data-cat'), disabled: el.getAttribute('aria-disabled') === 'true', later: !!el.querySelector('.hud-jobs__later'), label: el.getAttribute('aria-label') })),
    );
    const later = cats.filter((c) => c.disabled).map((c) => c.id);
    check(`${tag}: Yard work and Cooking are "Coming later" and disabled; the rest are offered`, JSON.stringify(later) === JSON.stringify(['yard', 'cooking']) && cats.filter((c) => c.disabled).every((c) => c.later && /Coming later/.test(c.label)), cats);
    check(`${tag}: the category picker is a labelled radiogroup`, (await page.locator('.hud-jobs__cats[role="radiogroup"][aria-label]').count()) === 1);
    // clicking a later category assigns nothing
    await tap(page.locator('.hud-jobs__cat[data-cat="yard"]'));
    check(`${tag}: a "coming later" category cannot be picked`, (await page.locator('.hud-jobs__cat[data-cat="yard"][aria-checked="true"]').count()) === 0);
    await shot(page, `jobs-tab-${tag}`);

    // 2a. A: Cleaning, whole lot, Daily 6 AM–5 AM (pointer / touch). Daily windows never end on their own, so both
    // jobs are still there to save and reload once they have made progress.
    await tap(page.locator('.hud-jobs__cat[data-cat="clean"]'));
    await tap(page.getByRole('radio', { name: 'Daily' }));
    await page.locator('select[id$="-from"]').selectOption('6');
    await page.locator('select[id$="-to"]').selectOption('5');
    if (vp.phone) {
      const sizes = {
        cat: await box(page.locator('.hud-jobs__cat[data-cat="clean"]')),
        where: await box(page.locator('.hud-jobs__select').first()),
        mode: await box(page.getByRole('radio', { name: 'Daily' })),
        from: await box(page.locator('select[id$="-from"]')),
        assign: await box(page.locator('.hud-jobs__assign')),
        tab: await box(page.getByRole('tab', { name: 'Jobs' })),
      };
      check(`${tag}: every Jobs control is ≥ 44 px (category, where, mode, hours, assign, tab)`, Object.values(sizes).every((s) => s && s.w >= 44 && s.h >= 44), sizes);
    }
    await tap(page.locator('.hud-jobs__assign'));
    await until(page, 'clean job', (id) => (window.__afterlife.game.sim.state.jobs?.list || []).some((j) => j.agentId === id && j.category === 'clean'), a, 20_000);
    check(`${tag}: Cleaning assigned to zombie A`, true);
    await until(page, 'job row rendered', () => document.querySelectorAll('.hud-job .hud-job__actions button').length >= 5, undefined, 20_000);
    const rowSizes = vp.phone ? await page.evaluate(() => Array.from(document.querySelectorAll('.hud-job__actions button')).map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })) : [];
    if (vp.phone) check(`${tag}: job row buttons (priority, up, down, pause, cancel) are ≥ 44 px`, rowSizes.length >= 5 && rowSizes.every(([w, h]) => w >= 44 && h >= 44), rowSizes);
    const labels = await page.evaluate(() => Array.from(document.querySelectorAll('.hud-job__actions button')).map((el) => el.getAttribute('aria-label') || el.textContent));
    check(`${tag}: job row controls have screen-reader labels`, labels.length >= 5 && labels.every((l) => l && l.trim().length > 3) && labels.some((l) => /^Pause /.test(l)) && labels.some((l) => /^Cancel /.test(l)), labels);

    // 2b. B: Play, Daily 6 AM–5 AM — keyboard only on desktop
    await openJobsFor(page, b);
    if (!vp.phone) {
      await page.locator('.hud-jobs__cat[aria-checked="true"]').focus();
      // clean → repairs → play
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await settle(page, 300);
      const focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-cat'));
      check(`${tag}: arrow keys move through the categories (focus on Play)`, focused === 'play', focused);
      await page.getByRole('radio', { name: 'Daily' }).focus();
      await page.keyboard.press('Enter');
      await settle(page, 300);
      await page.locator('select[id$="-from"]').focus();
      await page.locator('select[id$="-from"]').selectOption('6');
      await page.locator('select[id$="-to"]').selectOption('5');
      await page.locator('.hud-jobs__assign').focus();
      await page.keyboard.press('Enter');
    } else {
      await tap(page.locator('.hud-jobs__cat[data-cat="play"]'));
      await tap(page.getByRole('radio', { name: 'Daily' }));
      await page.locator('select[id$="-from"]').selectOption('6');
      await page.locator('select[id$="-to"]').selectOption('5');
      await tap(page.locator('.hud-jobs__assign'));
    }
    await until(page, 'play job', (id) => (window.__afterlife.game.sim.state.jobs?.list || []).some((j) => j.agentId === id && j.category === 'play'), b, 20_000);
    const assigned = await page.evaluate(jobsState);
    check(`${tag}: exactly two jobs — Cleaning for A, Play for B (daily 6 AM–5 AM)`, assigned.length === 2 && assigned.some((j) => j.agentId === a && j.category === 'clean' && j.mode === 'recurring') && assigned.some((j) => j.agentId === b && j.category === 'play' && j.mode === 'recurring'), assigned);
    await dismissTips(page);
    await showList(page);
    await shot(page, `jobs-assigned-${tag}`);

    // 3. real progress (an in-page watcher pauses the game the moment BOTH jobs have a credited completion)
    await runUntilBothProgress(page, null);
    const mid = await page.evaluate(({ dirty: ids, b: bid }) => {
      const sim = window.__afterlife.game.sim;
      return { jobs: (sim.state.jobs?.list || []).map((j) => ({ id: j.id, category: j.category, done: j.done, status: j.status })), wiped: ids.filter((id) => sim.state.objects[id] && sim.state.objects[id].condition.dirt === 0).length, fun: sim.state.agents[bid].needs.fun, tick: sim.state.tick };
    }, { dirty, b });
    check(`${tag}: both jobs have credited completions`, mid.jobs.length === 2 && mid.jobs.every((j) => j.done >= 1), mid.jobs);
    check(`${tag}: Cleaning made real progress (surfaces wiped to dirt 0)`, mid.wiped >= 1, mid);
    check(`${tag}: Play made real progress (fun rose)`, mid.fun > 15.5 + 1, mid);
    await openJobsFor(page, a);
    const rowText = await page.locator('.hud-job').first().textContent();
    check(`${tag}: the Jobs tab shows status + progress ("… done")`, /done/.test(rowText || ''), rowText);
    await dismissTips(page);
    await showList(page);
    await shot(page, `jobs-progress-${tag}`);

    // 4. save → reload → load → continue
    const saved = await page.evaluate(async (s) => {
      const r = await window.__afterlife.game.saveGame(s, 'Jobs E2E');
      return { ok: r.ok, code: r.code };
    }, slot);
    check(`${tag}: saved mid-assignment`, saved.ok, saved);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await until(page, 'menu after reload', () => window.__afterlife?.game?.screen === 'menu', undefined, 600_000);
    await skipAgeGate(page);
    const loaded = await page.evaluate(async (s) => {
      const r = await window.__afterlife.game.loadGame(s);
      return { ok: r.ok };
    }, slot);
    check(`${tag}: loaded the save`, loaded.ok, loaded);
    await until(page, 'game after load', () => window.__afterlife.game.screen === 'game' && window.__afterlife.game.renderer.loadProgress() >= 1, undefined, 600_000);
    await page.evaluate(() => window.__afterlife.game.setSpeed(0));
    await dismissTips(page);
    const back = await page.evaluate(jobsState);
    const same = mid.jobs.every((j) => back.some((x) => x.id === j.id && x.category === j.category && x.done >= j.done));
    check(`${tag}: after reload the same assignments are back with their progress`, back.length === 2 && same, { before: mid.jobs, after: back });
    // fresh work for both (test setup), then they must carry on by themselves
    await page.evaluate(setupWork);
    const doneBefore = Object.fromEntries(back.map((j) => [j.id, j.done]));
    await runUntilBothProgress(page, doneBefore);
    const after = await page.evaluate(jobsState);
    check(`${tag}: both jobs continued after the reload (more credited real work)`, after.length === 2 && after.every((j) => j.done > doneBefore[j.id]), { before: doneBefore, after });
    await openJobsFor(page, b);
    await dismissTips(page);
    await showList(page);
    await shot(page, `jobs-reloaded-${tag}`);
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
    await ensureBuild({ root: ROOT, distDir: DIST, mode: argv.includes('--no-build') ? 'never' : 'auto', log });
    server = await startPreview({ root: ROOT, distDir: DIST, log });
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
  console.log(`\n${failed ? 'W-124 JOBS E2E FAILED' : 'W-124 JOBS E2E PASSED'}: ${results.length - failed}/${results.length} checks — screenshots in ${OUT}`);
  return failed ? 1 : 0;
}

main().then((code) => process.exit(code));
