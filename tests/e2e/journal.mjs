/**
 * Real-browser crash test for the write-ahead command journal (design §4.1).
 *
 *   node tests/e2e/journal.mjs [--dist=<dir>] [--no-build] [--url=<running server>] [--stall-ms=<n>]
 *
 * Builds the production bundle into a private folder (never touches dist/), serves it with `vite preview`, and in a
 * persistent Chromium profile (real IndexedDB on disk):
 *   1. starts a new game (its autosave is the last snapshot), then plays for 30 s WITHOUT any further save: renames
 *      the household and queues actions along the way (the last one ~1.5 s before the kill);
 *   2. KILLS the tab with CDP Page.crash — no beforeunload, no pagehide, no visibilitychange, no dispose — 30 s after
 *      the last autosave, then closes the whole browser;
 *   3. relaunches the browser on the same profile, presses Continue (controller API), and checks that the world
 *      contains the last actions, that "Recovered N seconds of play" was shown, and that the recovered world was saved
 *      again at once. Prints the measured loss window (game ticks / real seconds after the last flushed batch).
 *
 * --stall-ms=<n> (W-134): on the relaunch, block the page's main thread for <n> ms right after the game asks for the
 * journal lock, so the lock manager's answer is queued behind a long task — what asset decoding, shader compiles or
 * a software-rendered frame do on a slow machine. The recovery must still happen (a wall-clock timeout on the lock
 * used to read that stall as "another window is playing this world" and loaded the snapshot without the journal).
 * Exit code 0 = pass. Player actions go through the documented debug handle window.__afterlife.game.
 */
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
const PLAY_MS = 30_000;
const STALL_MS = Math.max(0, Number(opt('stall-ms', '0')) || 0);
/** The last action must be at least this long before the kill (commands flush within 250 ms; see JOURNAL_COMMAND_FLUSH_MS). */
const LAST_ACTION_GRACE_MS = 1_500;
const SPEED = 2; // 3 game-min per real second = 12 ticks/s
const TICKS_PER_SEC = 12;
const LAUNCH = { headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], viewport: { width: 1280, height: 720 } };

const log = (s) => console.log(s);
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function waitFor(page, what, fn, arg, timeout = 900_000) {
  try {
    await page.waitForFunction(fn, arg, { polling: 100, timeout });
  } catch (e) {
    const s = await page.evaluate(() => {
      const g = window.__afterlife && window.__afterlife.game;
      return g ? { screen: g.screen, fatal: g.fatalError, saving: g.saving } : null;
    }).catch(() => null);
    throw new Error(`timed out waiting for ${what}: ${JSON.stringify(s)}`);
  }
}

const screenIs = (sc) => {
  const g = window.__afterlife && window.__afterlife.game;
  return !!g && (g.screen === sc || !!g.fatalError);
};

/** Kill only the Chromium processes running on OUR temporary profile (never anyone else's). */
function killOwnBrowser(userDataDir) {
  const { execFileSync } = require('node:child_process');
  let out = '';
  try {
    out = execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' });
  } catch {
    return;
  }
  for (const line of out.split('\n')) {
    if (!line.includes(userDataDir)) continue;
    const pid = Number(line.trim().split(/\s+/)[0]);
    if (Number.isInteger(pid) && pid !== process.pid) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
}

async function main() {
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'al-journal-profile-'));
  const distDir = path.resolve(opt('dist', path.join(tmpdir(), 'al-journal-dist')));
  let server = null;
  let ctx = null;
  const errors = [];
  try {
    let url = opt('url', '');
    if (!url) {
      await ensureBuild({ root: ROOT, distDir, mode: argv.includes('--no-build') ? 'never' : 'auto', log });
      server = await startPreview({ root: ROOT, distDir, log });
      url = server.url;
    }

    // ── session 1: play, then crash ──
    ctx = await chromium.launchPersistentContext(userDataDir, LAUNCH);
    let page = ctx.pages()[0] ?? (await ctx.newPage());
    let deliberate = false;
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('crash', () => !deliberate && log(`!! page crashed on its own at +${((Date.now() - (globalThis.__t0 ?? Date.now())) / 1000).toFixed(1)} s`));
    page.on('close', () => !deliberate && log('!! page closed'));
    ctx.on('close', () => !deliberate && log('!! browser context closed (browser died?)'));
    page.on('console', (m) => m.type() === 'error' && log(`console.error: ${m.text().slice(0, 200)}`));
    await page.goto(url);
    await waitFor(page, 'menu', screenIs, 'menu');
    await page.evaluate(() => {
      const g = window.__afterlife.game;
      // An adult profile: the typed household renames below are free text, which a child / unanswered profile
      // no longer gets (preset names only, enforced by the game layer).
      g.economy?.answerAgeGate?.(1990);
      g.beginNewGame();
      return g.startGame();
    });
    await waitFor(page, 'game', screenIs, 'game');
    await waitFor(page, 'new-game autosave', () => {
      const g = window.__afterlife.game;
      return !g.saving && g.lastSavedAt !== null;
    });
    const t0 = Date.now(); // last autosave landed
    globalThis.__t0 = t0;
    log('new game autosaved; playing 30 s without saves…');
    const savedAt0 = await page.evaluate(() => window.__afterlife.game.lastSavedAt);
    const tick0 = await page.evaluate(() => window.__afterlife.game.sim.state.tick);
    await page.evaluate((s) => window.__afterlife.game.setSpeed(s), SPEED);
    const actions = [];
    const act = async (label, fn, arg) => {
      const r = await page.evaluate(fn, arg);
      actions.push({ label, atMs: Date.now() - t0, ...r });
      log(`  +${((Date.now() - t0) / 1000).toFixed(1)} s ${label} ${JSON.stringify(r)}`);
    };
    const queueGoHere = () => {
      const g = window.__afterlife.game;
      const sim = g.sim;
      const id = sim.state.household.memberIds[0];
      const x = 6 + Math.floor(Math.random() * 10);
      const z = 6 + Math.floor(Math.random() * 10);
      g.selectAgent(id);
      g.openMenuFor({ kind: 'tile', x, z }, 300, 300);
      const e = g.menu && g.menu.entries.find((m) => m.interactionId === 'engine_goHere');
      if (e) g.chooseMenuEntry(e);
      return { tick: sim.state.tick, queued: sim.queueView(id).length };
    };
    await page.waitForTimeout(8_000);
    await act('rename', () => {
      const g = window.__afterlife.game;
      g.renameHousehold('Journal Survivors');
      return { tick: g.sim.state.tick };
    });
    await page.waitForTimeout(8_000);
    await act('go here #1', queueGoHere);
    await page.waitForTimeout(Math.max(0, PLAY_MS - (Date.now() - t0) - 1_500));
    await act('rename (last action)', () => {
      const g = window.__afterlife.game;
      g.renameHousehold('Journal Survivors II');
      return { tick: g.sim.state.tick };
    });
    // On a loaded machine the last action can land later than planned: the kill still comes a full grace period
    // after it (W-134: without this the test killed the tab 0 ms after the rename and blamed the journal).
    const lastActionAt = Date.now();
    await page.waitForTimeout(Math.max(0, PLAY_MS - (Date.now() - t0), LAST_ACTION_GRACE_MS - (Date.now() - lastActionAt)));
    const before = await page.evaluate(() => {
      const g = window.__afterlife.game;
      return { tick: g.sim.state.tick, name: g.sim.state.household.name, lastSavedAt: g.lastSavedAt, saving: g.saving };
    });
    check('no autosave ran during the 30 s of play (the journal is the only record)', before.lastSavedAt === savedAt0, `lastSavedAt ${before.lastSavedAt} vs ${savedAt0}`);
    const killedAtMs = Date.now() - t0;
    deliberate = true;
    const cdp = await ctx.newCDPSession(page);
    const crashed = page.waitForEvent('crash', { timeout: 30_000 }).then(() => true, () => false);
    void cdp.send('Page.crash').catch(() => undefined); // the renderer dies: no unload handlers run
    log(`tab crashed: ${await crashed}`);
    // Then the whole browser goes away. Closing a context with a crashed page can hang under load: bound it, and
    // as a last resort kill the browser this script started (identified by its private profile dir).
    const closed = await Promise.race([ctx.close().then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), 20_000))]);
    if (!closed) killOwnBrowser(userDataDir);
    ctx = null;
    log(`killed the tab ${(killedAtMs / 1000).toFixed(1)} s after the last autosave at tick ${before.tick} (snapshot tick ${tick0})`);

    // ── session 2: relaunch on the same profile, Continue ──
    ctx = await chromium.launchPersistentContext(userDataDir, LAUNCH);
    page = ctx.pages()[0] ?? (await ctx.newPage());
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    if (STALL_MS > 0) {
      await page.addInitScript((ms) => {
        const orig = navigator.locks.request.bind(navigator.locks);
        window.__journalLockStalls = 0;
        navigator.locks.request = (name, ...rest) => {
          const p = orig(name, ...rest);
          if (String(name).includes(':journal:')) {
            window.__journalLockStalls++;
            // After request() returns, so the caller has already armed its timeout (a stall inside the call ran before
            // the timeout existed and tested nothing); still before the lock manager's answer, which is a later task.
            queueMicrotask(() => {
              const end = performance.now() + ms;
              while (performance.now() < end); // one long task: the answer waits behind it
            });
          }
          return p;
        };
      }, STALL_MS);
    }
    await page.goto(url);
    await waitFor(page, 'menu (relaunch)', screenIs, 'menu');
    // Continue and read the recovered tick in the SAME evaluate (then pause), so post-load ticking does not hide loss.
    const after = await page.evaluate(async () => {
      const g = window.__afterlife.game;
      const ok = await g.continueLatest();
      const tick = g.sim ? g.sim.state.tick : -1;
      g.setSpeed(0);
      return { ok, tick, name: g.sim ? g.sim.state.household.name : null, toasts: g.toasts.map((t) => t.title), fatal: g.fatalError };
    });
    check('Continue loads the world', after.ok === true);
    if (STALL_MS > 0) {
      const stalls = await page.evaluate(() => window.__journalLockStalls);
      check(`the main thread was blocked ${STALL_MS} ms behind the journal lock request`, stalls >= 1, `${stalls} stall(s)`);
    }
    await waitFor(page, 'game (relaunch)', screenIs, 'game');
    check('the last action survived the kill', after.name === 'Journal Survivors II', `name "${after.name}"`);
    const lastActionTick = actions[actions.length - 1].tick;
    check('the recovered world is at least as far as the last action', after.tick >= lastActionTick, `recovered tick ${after.tick}, last action tick ${lastActionTick}`);
    const recovered = after.toasts.find((t) => /^Recovered /.test(t));
    check('"Recovered N seconds of play" was shown once', !!recovered && after.toasts.filter((t) => /^Recovered /.test(t)).length === 1, recovered ?? 'none');
    await waitFor(page, 'immediate save of the recovered world', () => {
      const g = window.__afterlife.game;
      return !g.saving && g.lastSavedAt !== null && Date.now() - g.lastSavedAt < 60_000;
    }, undefined, 30_000).then(
      () => check('the recovered world was saved right away', true),
      (e) => check('the recovered world was saved right away', false, String(e)),
    );
    const lostTicks = before.tick - after.tick;
    log(`\nloss window: ${lostTicks} ticks ≈ ${(lostTicks / TICKS_PER_SEC).toFixed(2)} s of real play lost (out of ${(killedAtMs / 1000).toFixed(1)} s since the last autosave)`);
    check('loss window ≤ ~1 s', lostTicks >= 0 && lostTicks / TICKS_PER_SEC <= 1.5, `${lostTicks} ticks (live ${before.tick} → recovered ${after.tick})`);
    check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    check('no fatal error', after.fatal === null);
  } finally {
    const bounded = (p) => Promise.race([p.catch(() => undefined), new Promise((r) => setTimeout(r, 10_000))]);
    if (ctx) await bounded(ctx.close());
    killOwnBrowser(userDataDir);
    if (server) await bounded(server.stop());
    rmSync(userDataDir, { recursive: true, force: true });
  }
  const ok = checks.length > 0 && checks.every((c) => c.ok);
  log(`\n${ok ? 'JOURNAL E2E PASSED' : 'JOURNAL E2E FAILED'} (${checks.filter((c) => c.ok).length}/${checks.length} checks)`);
  return ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  },
);
