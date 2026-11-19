/**
 * Real-browser "never lose a save" test across a game update (PRODUCTION_READINESS §2 "Old saves", W-134).
 *
 *   node tests/e2e/oldSave.mjs [--old-ref=<git ref>] [--old-dist=<built dir>] [--dist=<dir>] [--no-build]
 *                              [--play-ms=20000] [--only=A,B,C]
 *
 * A save made by an OLDER BUILD OF THE REAL GAME (not a hand-written fixture) is loaded by the current build, in real
 * Chromium, three ways:
 *
 *   A. in-place update     the old build writes the save into the profile's IndexedDB; the current build is then
 *                          served on the SAME origin with the SAME profile (what a player gets when the game
 *                          updates) → Continue.
 *   B. exported file       the `.alsave` the old build exported is imported by the current build in a FRESH profile.
 *   C. crash, then update  the old build is killed (CDP Page.crash) with unsaved play in its command journal, the
 *                          game updates, relaunch → Continue. The journalled play must be replayed on the migrated
 *                          world.
 *
 * "Loaded" means: no fatal, no page / console errors, no warning or failure notice, the world is stamped with the
 * current schema, and the old world's data is all still there. The comparison is generic: the whole sim state of the
 * old build (paused, right after its save) is diffed against the state the current build loads. Every difference must
 * be either a key the current build ADDED or `schemaVersion`; a changed or missing old value fails the run and is
 * printed by path. The migrated world must then run, save, and reload identical.
 *
 * The old build comes from `--old-dist` (already built) or is built from `--old-ref` (default origin/main) in a
 * temporary git worktree that borrows this checkout's node_modules (the script checks that package-lock.json is the
 * same at both commits and stops with a clear message when it is not). `--only=B` runs A too (B needs A's export).
 * Exit code 0 = pass, 1 = fail, 2 = cannot run.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureBuild, freePort, startPreview } from './lib/server.mjs';
import { diffStates } from './lib/stateDiff.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const a = argv.find((x) => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : d;
};
const PLAY_MS = Number(opt('play-ms', '20000'));
const ONLY = opt('only', 'A,B,C').toUpperCase().split(',');
const RUN_A = ONLY.includes('A') || ONLY.includes('B');
const RUN_B = ONLY.includes('B');
const RUN_C = ONLY.includes('C');
const LAUNCH = { headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], viewport: { width: 1280, height: 720 }, acceptDownloads: true };

const log = (s) => console.log(s);
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const cannotRun = (msg) => Object.assign(new Error(msg), { exitCode: 2 });

/** Build the old reference in a throwaway worktree. Returns { distDir, sha, cleanup }. */
async function buildOldRef(ref) {
  let sha;
  try {
    sha = git('rev-parse', '--verify', `${ref}^{commit}`);
  } catch {
    throw cannotRun(`--old-ref=${ref} is not a commit in this clone (fetch it, or pass --old-dist=<built dir>)`);
  }
  let lockDiffers = false;
  try {
    execFileSync('git', ['diff', '--quiet', sha, 'HEAD', '--', 'package-lock.json'], { cwd: ROOT });
  } catch {
    lockDiffers = true;
  }
  if (lockDiffers) {
    throw cannotRun(`package-lock.json differs between ${ref} (${sha.slice(0, 7)}) and HEAD: build that commit yourself (npm ci && npx vite build --outDir <dir>) and pass --old-dist=<dir>`);
  }
  const wt = mkdtempSync(path.join(tmpdir(), 'al-oldsave-src-'));
  const distDir = mkdtempSync(path.join(tmpdir(), 'al-oldsave-dist-'));
  const cleanup = () => {
    // Remove the borrowed node_modules LINK first, on its own: a recursive or forced delete of the worktree must never
    // be the thing that meets it (a delete that followed the junction would empty this checkout's node_modules).
    const link = path.join(wt, 'node_modules');
    try {
      if (lstatSync(link).isSymbolicLink()) unlinkSync(link);
    } catch {
      /* never created, or already gone */
    }
    if (existsSync(link)) {
      log(`!! ${link} is still there and is not a link: leaving the worktree ${wt} in place rather than deleting through it`);
      rmSync(distDir, { recursive: true, force: true });
      return;
    }
    try {
      git('worktree', 'remove', '--force', wt);
    } catch {
      rmSync(wt, { recursive: true, force: true });
      try {
        git('worktree', 'prune');
      } catch {
        /* nothing to prune */
      }
    }
    rmSync(distDir, { recursive: true, force: true });
  };
  try {
    git('worktree', 'add', '--detach', '--force', wt, sha);
    symlinkSync(path.join(ROOT, 'node_modules'), path.join(wt, 'node_modules'), 'junction');
    await ensureBuild({ root: wt, distDir, mode: 'always', log });
  } catch (e) {
    cleanup();
    throw e;
  }
  return { distDir, sha, cleanup };
}

// ── functions evaluated in the page (must work on BOTH builds: only APIs that exist in every build since 1.0.0) ──
const screenIs = (sc) => {
  const g = window.__afterlife && window.__afterlife.game;
  return !!g && (g.screen === sc || !!g.fatalError);
};
const snapshot = () => {
  const g = window.__afterlife.game;
  return { state: JSON.parse(JSON.stringify(g.sim.state)), fatal: g.fatalError, toasts: g.toasts.map((t) => `${t.kind}|${t.title}|${t.text ?? ''}`) };
};
const continueAndSnapshot = async () => {
  const g = window.__afterlife.game;
  const saves = await g.listSaves();
  const ok = await g.continueLatest();
  if (g.sim) g.setSpeed(0); // read the world in the same task it was entered in: nothing has ticked yet
  return {
    ok,
    saves: saves.length,
    state: g.sim ? JSON.parse(JSON.stringify(g.sim.state)) : null,
    fatal: g.fatalError,
    toasts: g.toasts.map((t) => `${t.kind}|${t.title}|${t.text ?? ''}`),
  };
};

async function waitFor(page, what, fn, arg, timeout = 900_000) {
  try {
    await page.waitForFunction(fn, arg, { polling: 100, timeout });
  } catch {
    const s = await page.evaluate(() => {
      const g = window.__afterlife && window.__afterlife.game;
      return g ? { screen: g.screen, fatal: g.fatalError, saving: g.saving } : null;
    }).catch(() => null);
    throw new Error(`timed out waiting for ${what}: ${JSON.stringify(s)}`);
  }
}

function watch(page, errors, label) {
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${label} console.error: ${m.text().slice(0, 240)}`));
}

/** New game on the page's build, PLAY_MS of play with real player commands; leaves the game running at speed 3. */
async function playNewGame(page, url, householdName) {
  await page.goto(url);
  await waitFor(page, 'menu', screenIs, 'menu');
  await page.evaluate(() => {
    const g = window.__afterlife.game;
    // These fixtures issue typed renames: unanswered/child profiles correctly accept only preset names.
    const age = g.economy?.answerAgeGate?.(1990);
    if (age !== undefined && age !== 'ok') throw new Error(`Adult fixture setup refused: ${age}`);
    g.beginNewGame();
    return g.startGame();
  });
  await waitFor(page, 'game', screenIs, 'game');
  await waitFor(page, 'new-game autosave', () => {
    const g = window.__afterlife.game;
    return !g.saving && g.lastSavedAt !== null;
  });
  await page.evaluate(() => window.__afterlife.game.setSpeed(3));
  const goHere = () => {
    const g = window.__afterlife.game;
    const st = g.sim.state;
    g.selectAgent(st.household.memberIds[0]);
    g.openMenuFor({ kind: 'tile', x: 6 + Math.floor(Math.random() * 10), z: 6 + Math.floor(Math.random() * 10) }, 300, 300);
    const e = g.menu && g.menu.entries.find((m) => m.interactionId === 'engine_goHere');
    if (e) g.chooseMenuEntry(e);
    else g.closeMenu();
    return !!e;
  };
  await page.waitForTimeout(PLAY_MS / 3);
  await page.evaluate(goHere);
  await page.waitForTimeout(PLAY_MS / 3);
  const renamed = await page.evaluate((n) => {
    const g = window.__afterlife.game;
    const before = g.sim.state.household.name;
    const result = g.renameHousehold(n);
    return { before, result, after: g.sim.state.household.name };
  }, householdName);
  if (!renamed.result?.ok || renamed.after !== householdName || renamed.before === renamed.after) {
    throw cannotRun(`Old-build fixture rename was not accepted as a change: ${JSON.stringify(renamed)}`);
  }
  check('old build: typed rename accepted and changed the household', true, `${renamed.before} → ${renamed.after}`);
  await page.evaluate(goHere);
  await page.waitForTimeout(PLAY_MS / 3);
}

function compare(label, before, after, currentSchema) {
  if (!after.state) {
    check(`${label}: the world loaded`, false, `fatal ${after.fatal}; toasts ${after.toasts.join(' / ')}`);
    return;
  }
  const d = diffStates(before.state, after.state);
  const real = d.changed.filter((c) => !c.startsWith('state.schemaVersion:'));
  check(
    `${label}: every value of the old world is intact`,
    real.length === 0,
    real.length ? `${real.length} changed/dropped: ${real.slice(0, 6).join(' ; ')}` : `tick ${after.state.tick}, ${Object.keys(after.state.objects).length} objects, $${after.state.household.funds}, "${after.state.household.name}"`,
  );
  check(`${label}: stamped with the current schema`, after.state.schemaVersion === currentSchema, `v${before.state.schemaVersion} → v${after.state.schemaVersion}`);
  log(`      keys the current build added: ${d.added.length ? d.added.slice(0, 12).join(', ') : 'none'}`);
  check(`${label}: no fatal error`, after.fatal === null, String(after.fatal));
  // A game update is not a problem with the save (D-073): no warning / bad toast at all, in particular no "Save recovered".
  const bad = after.toasts.filter((t) => /^(warning|bad)\|/.test(t));
  check(`${label}: no warning or failure notice`, bad.length === 0, bad.join(' / '));
}

async function main() {
  const dirs = [];
  const tmp = (p) => {
    const d = mkdtempSync(path.join(tmpdir(), p));
    dirs.push(d);
    return d;
  };
  const newDist = path.resolve(opt('dist', path.join(tmpdir(), 'al-oldsave-new-dist')));
  let old = null;
  let server = null;
  let served = '';
  let ctx = null;
  const errors = [];
  const bounded = (p, ms = 15_000) => Promise.race([Promise.resolve(p).catch(() => undefined), new Promise((r) => setTimeout(r, ms))]);
  const closeCtx = async () => {
    if (ctx) await bounded(ctx.close(), 20_000);
    ctx = null;
  };
  let port = 0;
  /** Serve `distDir` on the one origin of this run (stopping whatever was served before). */
  const serve = async (distDir) => {
    if (server && served === distDir) return server.url;
    if (server) await bounded(server.stop());
    server = await startPreview({ root: ROOT, distDir, log, port });
    served = distDir;
    return server.url;
  };
  const open = async (profile, errs, label) => {
    ctx = await chromium.launchPersistentContext(profile, LAUNCH);
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    watch(page, errs, label);
    return page;
  };
  try {
    const oldDistArg = opt('old-dist', '');
    if (oldDistArg) {
      if (!existsSync(path.join(oldDistArg, 'index.html'))) throw cannotRun(`--old-dist=${oldDistArg} has no index.html`);
      old = { distDir: path.resolve(oldDistArg), sha: 'prebuilt', cleanup: () => undefined };
    } else {
      old = await buildOldRef(opt('old-ref', 'origin/main'));
    }
    await ensureBuild({ root: ROOT, distDir: newDist, mode: argv.includes('--no-build') ? 'never' : 'auto', log });
    const currentSchema = Number(/SAVE_SCHEMA_VERSION = (\d+)/.exec(readFileSync(path.join(ROOT, 'src/sim/types.ts'), 'utf8'))?.[1]);
    if (!Number.isInteger(currentSchema)) throw cannotRun('could not read SAVE_SCHEMA_VERSION from src/sim/types.ts');
    port = await freePort();
    log(`old build ${old.sha.slice(0, 8)} → current build ${git('rev-parse', '--short', 'HEAD')} (schema v${currentSchema}), origin 127.0.0.1:${port}\n`);

    let before = null;
    let alsave = null;
    let alsaveName = '';

    if (RUN_A) {
      log('A. in-place update (same origin, same profile)');
      const profile = tmp('al-oldsave-profile-a-');
      let page = await open(profile, errors, 'A/old');
      await playNewGame(page, await serve(old.distDir), 'Old Build Family');
      const saved = await page.evaluate(async () => {
        const g = window.__afterlife.game;
        g.setSpeed(0);
        const r = await g.saveGame();
        const slots = await g.listSaves();
        return { ok: !!r && r.ok !== false, slotId: r && r.info ? r.info.slotId : null, slots: slots.map((s) => s.slotId) };
      });
      before = await page.evaluate(snapshot);
      check('old build: saved its world', saved.ok && before.fatal === null, `schema v${before.state.schemaVersion}, tick ${before.state.tick}, household "${before.state.household.name}", slots ${saved.slots.join(', ')}`);
      check('old build really is an older schema', before.state.schemaVersion < currentSchema, `v${before.state.schemaVersion} < v${currentSchema}`);
      const slotId = saved.slotId ?? saved.slots.find((s) => !/^auto/.test(String(s))) ?? saved.slots[0];
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.evaluate((id) => window.__afterlife.game.exportSave(id), slotId)]);
      alsave = readFileSync(await download.path());
      alsaveName = download.suggestedFilename();
      check('old build: exported an .alsave', alsave.length > 100 && /\.alsave$/.test(alsaveName), `${alsaveName}, ${alsave.length} bytes (slot ${slotId})`);
      await closeCtx();

      const url = await serve(newDist);
      page = await open(profile, errors, 'A/new');
      await page.goto(url);
      await waitFor(page, 'menu (updated build)', screenIs, 'menu');
      const after = await page.evaluate(continueAndSnapshot);
      check('A: the updated build lists the old saves and Continue works', after.ok === true && after.saves >= 1, `${after.saves} slot(s)`);
      compare('A', before, after, currentSchema);
      const updated = after.toasts.filter((t) => t.startsWith('info|Save updated|'));
      check('A: one plain "Save updated" notice', updated.length === 1, after.toasts.join(' / ') || 'no toasts');
      if (after.state) {
        // The migrated world must keep running, save, and come back identical.
        await page.evaluate(() => window.__afterlife.game.setSpeed(3));
        await page.waitForTimeout(Math.min(PLAY_MS, 15_000));
        const ran = await page.evaluate(async () => {
          const g = window.__afterlife.game;
          g.setSpeed(0);
          const r = await g.saveGame();
          return { saved: !!r && r.ok !== false, tick: g.sim.state.tick, fatal: g.fatalError, state: JSON.parse(JSON.stringify(g.sim.state)) };
        });
        check('A: the migrated world keeps running', ran.tick > after.state.tick && ran.fatal === null, `tick ${after.state.tick} → ${ran.tick}`);
        check('A: the migrated world saves', ran.saved);
        await page.reload();
        await waitFor(page, 'menu (reload)', screenIs, 'menu');
        const again = await page.evaluate(continueAndSnapshot);
        const d = again.state ? diffStates(ran.state, again.state) : { changed: ['no world'], added: [] };
        check('A: save → reload of the migrated world is identical', again.ok === true && d.changed.length === 0 && d.added.length === 0, d.changed.concat(d.added).slice(0, 5).join(' ; ') || `tick ${again.state.tick}, schema v${again.state.schemaVersion}`);
        check('A: the second load shows no "Save updated" (the stored save is current now)', !again.toasts.some((t) => t.includes('|Save updated|')), again.toasts.join(' / '));
      }
      await closeCtx();
    }

    if (RUN_B) {
      log("\nB. the old build's .alsave imported by the current build (fresh profile)");
      const url = await serve(newDist);
      const page = await open(tmp('al-oldsave-profile-b-'), errors, 'B/new');
      await page.goto(url);
      await waitFor(page, 'menu (fresh profile)', screenIs, 'menu');
      const after = await page.evaluate(async ({ b64, name }) => {
        const g = window.__afterlife.game;
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const r = await g.importSave(new File([bytes], name));
        let ok = !!r && r.ok !== false;
        // Importing adds the slot; the player then loads it.
        if (ok && !g.sim) ok = await g.continueLatest();
        if (g.sim) g.setSpeed(0);
        return { ok, error: r && r.ok === false ? r.error : null, state: g.sim ? JSON.parse(JSON.stringify(g.sim.state)) : null, fatal: g.fatalError, toasts: g.toasts.map((t) => `${t.kind}|${t.title}|${t.text ?? ''}`) };
      }, { b64: alsave.toString('base64'), name: alsaveName });
      check('B: the current build imports the old .alsave and opens it', after.ok === true, after.error ?? '');
      compare('B', before, after, currentSchema);
      await closeCtx();
    }

    if (RUN_C) {
      log('\nC. old build killed with unsaved play in its journal, then the game updates');
      const profile = tmp('al-oldsave-profile-c-');
      const errorsOld = [];
      let page = await open(profile, errorsOld, 'C/old');
      await playNewGame(page, await serve(old.distDir), 'Crashed Before Update');
      const live = await page.evaluate(() => {
        const g = window.__afterlife.game;
        return { tick: g.sim.state.tick, name: g.sim.state.household.name };
      });
      await page.waitForTimeout(1_500); // commands flush within 250 ms; the kill comes well after the last one
      const cdp = await ctx.newCDPSession(page);
      const crashed = page.waitForEvent('crash', { timeout: 30_000 }).then(() => true, () => false);
      void cdp.send('Page.crash').catch(() => undefined); // the renderer dies: no unload handlers run
      const didCrash = await crashed;
      check('C: old renderer actually crashed', didCrash, `live tick ≥ ${live.tick}`);
      await closeCtx();
      errors.push(...errorsOld);

      const url = await serve(newDist);
      page = await open(profile, errors, 'C/new');
      await page.goto(url);
      await waitFor(page, 'menu (after crash + update)', screenIs, 'menu');
      const after = await page.evaluate(continueAndSnapshot);
      check('C: Continue loads a world after crash + update', after.ok === true && !!after.state && after.fatal === null, `fatal ${after.fatal}`);
      if (after.state) {
        check('C: stamped with the current schema', after.state.schemaVersion === currentSchema, `v${after.state.schemaVersion}`);
        check(
          'C: unsaved play from the old build is replayed on the migrated world',
          after.state.household.name === 'Crashed Before Update' && after.state.tick >= live.tick,
          `household "${after.state.household.name}", tick ${after.state.tick} (live at the last read ${live.tick})`,
        );
        check('C: "Recovered N seconds of play" shown once', after.toasts.filter((t) => /^good\|Recovered /.test(t)).length === 1, after.toasts.join(' / ') || 'no toasts');
        const bad = after.toasts.filter((t) => /^(warning|bad)\|/.test(t));
        check('C: no warning or failure notice', bad.length === 0, bad.join(' / '));
        await page.evaluate(() => window.__afterlife.game.setSpeed(3));
        await page.waitForTimeout(8_000);
        const ran = await page.evaluate(() => ({ tick: window.__afterlife.game.sim.state.tick, fatal: window.__afterlife.game.fatalError }));
        check('C: the recovered world keeps running', ran.tick > after.state.tick && ran.fatal === null, `tick ${after.state.tick} → ${ran.tick}`);
      }
      await closeCtx();
    }

    check('no page or console errors in any session', errors.length === 0, errors.slice(0, 4).join(' | '));
  } finally {
    await closeCtx();
    if (server) await bounded(server.stop());
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    if (old) old.cleanup();
  }
  const ok = checks.length > 0 && checks.every((c) => c.ok);
  log(`\n${ok ? 'OLD-SAVE E2E PASSED' : 'OLD-SAVE E2E FAILED'} (${checks.filter((c) => c.ok).length}/${checks.length} checks)`);
  return ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exit(e && e.exitCode ? e.exitCode : 1);
  },
);
