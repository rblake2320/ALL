#!/usr/bin/env node
/**
 * Desktop (Electron) verification driver — drives the REAL Electron app (dev build or the installed NSIS build)
 * through its remote-debugging port, reading state from window.__afterlife and acting through the UI.
 *
 *   node tests/desktop/electron-verify.mjs <command> [--exe <AfterlifeLease.exe>] [--minutes N] [--size WxH]
 *                                                    [--fullscreen] [--uncapped] [--tag name]
 *
 * commands
 *   play      new game → CAZ → enter → buy → wall → play N minutes → save (UI) → Quit to Desktop → state.json
 *   continue  relaunch → Continue → compare with state.json (household / funds / day / tick)
 *   single    second launch while the first runs must exit and leave exactly one window
 *   crash     Continue → play N minutes → hard-kill the whole process tree → relaunch → Continue → report loss
 *   fps       Continue → window at --size (physical pixels) or --fullscreen → 30 s rAF sample at speed 1
 *
 * Without --exe the unpackaged app runs (node_modules/electron + "."): run `npm run build` and
 * `npm run electron:build-main` first. Output: dev/out/desktop/<tag>/ (report.json, screenshots).
 * Needs playwright resolvable through NODE_PATH (same as tests/e2e). Exit code 0 = every check passed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../e2e/lib/inpage.mjs';
import { queryLines, secondInstanceOk, verdict } from './lib/verdict.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? def : argv[i + 1];
};
const flag = (name) => argv.includes(`--${name}`);
const exe = opt('exe', null);
const minutes = Number(opt('minutes', '10'));
const tag = opt('tag', cmd);
const outDir = join(root, 'dev', 'out', 'desktop', tag);
const stateFile = join(root, 'dev', 'out', 'desktop', 'state.json');
const userData = join(process.env.APPDATA ?? '', 'Afterlife Lease');
mkdirSync(outDir, { recursive: true });

const report = { command: cmd, exe: exe ?? 'electron . (unpackaged)', started: new Date().toISOString(), checks: [], events: [], data: {} };
const log = (...a) => console.log(...a);
const check = (name, ok, detail) => {
  report.checks.push({ name, ok: !!ok, detail });
  log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  return !!ok;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const finish = () => {
  report.finished = new Date().toISOString();
  // functional = every check passed; clean = additionally no renderer error outside the known-missing cast assets.
  const v = verdict(report);
  Object.assign(report, { functional: v.functional, clean: v.clean, pass: v.pass, knownErrors: v.known, unexpectedErrors: v.unexpected });
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  for (const e of v.unexpected) log(`  UNEXPECTED ${JSON.stringify(e).slice(0, 400)}`);
  const knownUrls = [...new Set(v.known.filter((e) => e.url).map((e) => e.url))];
  if (knownUrls.length) log(`  known missing cast assets (404, cloud-owned): ${knownUrls.join(', ')}`);
  log(`\n${report.pass ? 'PASS' : 'FAIL'} ${cmd}: ${report.checks.filter((c) => c.ok).length}/${report.checks.length} checks, ${v.unexpected.length} unexpected + ${v.known.length} known renderer error event(s) -> ${join(outDir, 'report.json')}`);
  process.exit(report.pass ? 0 : 1);
};

/** Processes of the game: ONLY those running from the exact executable under test (never other Electron apps). */
const bin = resolve(exe ?? require('electron')); // the electron package returns its binary path (and downloads it on first use)
const imageName = bin.split(/[\\/]/).pop();
// A failed query throws (queryLines): it must never read as "no processes".
const ps = (script) =>
  queryLines(spawnSync('powershell.exe', ['-NoProfile', '-Command', `$ErrorActionPreference='Stop'; try { ${script}; exit 0 } catch { [Console]::Error.WriteLine($_); exit 3 }`], { encoding: 'utf8' }), 'process query');
const ours = `Get-Process -Name '${imageName.replace(/\.exe$/i, '')}' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${bin.replace(/'/g, "''")}' }`;
const pids = () => ps(`${ours} | ForEach-Object { $_.Id }`).map(Number);
const killOurs = () => pids().map((pid) => spawnSync('taskkill', ['/F', '/PID', String(pid)], { encoding: 'utf8' }).stdout.trim());
const waitNoProcess = async (timeout = 30_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (pids().length === 0) return true;
    await sleep(250);
  }
  return false;
};

function spawnApp(extra = []) {
  const args = [...(exe ? [] : ['.']), ...extra];
  const child = spawn(bin, args, { cwd: root, stdio: 'ignore', detached: false });
  return child;
}

/** A free localhost port (never a fixed one: another browser may already be debugging on it). */
const freePort = () =>
  new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });

async function launch(extra = []) {
  const PORT = await freePort();
  const child = spawnApp([`--remote-debugging-port=${PORT}`, ...(flag('uncapped') ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : []), ...extra]);
  let exit = null;
  child.on('exit', (code, signal) => (exit = { code, signal }));
  let browser = null;
  for (let i = 0; i < 120 && !browser && !exit; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    } catch {
      await sleep(250);
    }
  }
  if (!browser) throw new Error(`could not attach to the app on port ${PORT} (exit=${JSON.stringify(exit)})`);
  let page = null;
  for (let i = 0; i < 120 && !page; i++) {
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('app://')) ?? null; // only ever the game's own page
    if (!page) await sleep(250);
  }
  if (!page) throw new Error(`no app:// renderer page; targets: ${JSON.stringify(browser.contexts().flatMap((c) => c.pages()).map((p) => p.url()))}`);
  page.on('pageerror', (e) => report.events.push({ kind: 'pageerror', message: e.message }));
  page.on('response', (r) => {
    if (r.status() >= 400) report.events.push({ kind: 'response', url: r.url(), status: r.status() });
  });
  page.on('requestfailed', (r) => report.events.push({ kind: 'requestfailed', url: r.url(), failure: r.failure()?.errorText ?? null }));
  page.on('console', (m) => {
    if (m.type() === 'error') report.events.push({ kind: 'console', message: m.text().slice(0, 300), location: m.location()?.url ?? null });
  });
  const app = { child, browser, page, exit: () => exit };
  await untilScreen(app, 'menu');
  return app;
}

const G = (app, fn, arg) => app.page.evaluate(fn, arg);
const state = (app) => G(app, P.snapshotState);
async function until(app, what, fn, arg, timeout = 60_000) {
  try {
    await app.page.waitForFunction(fn, arg, { polling: 100, timeout });
  } catch {
    throw new Error(`timed out (${timeout} ms) waiting for ${what}; state=${JSON.stringify(await state(app).catch(() => null))}`);
  }
}
const untilScreen = (app, screen, timeout = 180_000) =>
  until(app, `screen=${screen}`, (sc) => !!window.__afterlife && !!window.__afterlife.game && (window.__afterlife.game.screen === sc || !!window.__afterlife.game.fatalError), screen, timeout);
const shot = (app, name) => app.page.screenshot({ path: join(outDir, `${name}.png`) }).catch((e) => log(`  (screenshot ${name} failed: ${e.message.split('\n')[0]})`));
async function clearHints(app) {
  for (let i = 0; i < 6; i++) {
    const id = await G(app, () => (window.__afterlife.game.hint ? window.__afterlife.game.hint.id : null));
    if (!id) return;
    await app.page.locator('.hud-hint-bubble button', { hasText: 'Got it' }).click({ timeout: 5000 }).catch(() => G(app, (h) => window.__afterlife.game.dismissHint(h), id));
    await sleep(300);
  }
}
async function escUntil(app, what, done) {
  for (let i = 0; i < 4; i++) {
    await clearHints(app);
    await app.page.keyboard.press('Escape');
    try {
      await until(app, what, done, undefined, 8000);
      return;
    } catch (e) {
      if (i === 3) throw e;
    }
  }
}
async function liveNoDialog(app) {
  await G(app, () => {
    const g = window.__afterlife.game;
    for (let i = 0; i < 4 && g.dialog; i++) g.closeDialog();
    g.closeMenu();
    g.cancelPlacement();
  });
  if ((await state(app)).mode !== 'live') await app.page.keyboard.press('KeyL');
  await until(app, 'live mode', () => window.__afterlife.game.mode === 'live' && window.__afterlife.game.dialog === null, undefined, 10_000);
  await clearHints(app);
}
const dialog = (app) => app.page.locator('[role="dialog"][aria-modal="true"]').last();

/** Window title, version, GPU (WEBGL_debug_renderer_info), pixel sizes. */
const environment = (app) =>
  G(app, () => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const game = document.getElementById('game-canvas');
    return {
      title: document.title,
      version: window.__afterlife.version,
      userAgent: navigator.userAgent,
      gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
      devicePixelRatio: window.devicePixelRatio,
      innerCss: [window.innerWidth, window.innerHeight],
      innerPhysical: [Math.round(window.innerWidth * window.devicePixelRatio), Math.round(window.innerHeight * window.devicePixelRatio)],
      canvasBuffer: game ? [game.width, game.height] : null,
      quality: window.__afterlife.game.settings.quality,
      pixelRatioSetting: window.__afterlife.game.settings.pixelRatio,
      autosaveMinutes: window.__afterlife.game.settings.autosaveMinutes,
    };
  });

/** Frames per second measured with requestAnimationFrame over `ms`, plus frame-time percentiles. */
const measureFps = (app, ms) =>
  G(app, (dur) =>
    new Promise((res) => {
      const t = [];
      const step = (now) => {
        t.push(now);
        if (now - t[0] < dur) requestAnimationFrame(step);
        else {
          const d = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
          const q = (p) => d[Math.min(d.length - 1, Math.floor(d.length * p))];
          res({ frames: d.length, seconds: (t[t.length - 1] - t[0]) / 1000, fps: +(d.length / ((t[t.length - 1] - t[0]) / 1000)).toFixed(1), frameMs: { p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +d[d.length - 1].toFixed(2) }, rendererFps: window.__afterlife.game.renderer.fps() });
        }
      };
      requestAnimationFrame(step);
    }), ms);

const windowTitles = () => ps(`${ours} | Where-Object { $_.MainWindowTitle } | ForEach-Object { $_.MainWindowTitle }`);
const saveFiles = () => {
  const dir = join(userData, 'saves');
  return existsSync(dir) ? readdirSync(dir).map((f) => ({ file: f, bytes: statSync(join(dir, f)).size })) : null;
};

async function continueGame(app) {
  await until(app, 'Continue enabled', () => {
    const b = Array.from(document.querySelectorAll('.sh-menu__item')).find((x) => x.textContent.includes('Continue'));
    return !!b && !b.disabled;
  }, undefined, 30_000);
  await app.page.locator('.sh-menu__item', { hasText: 'Continue' }).click();
  await untilScreen(app, 'game');
  await until(app, 'renderer loaded', () => window.__afterlife.game.renderer.loadProgress() >= 1 && !!document.querySelector('.hud-funds'), undefined, 120_000);
  return state(app);
}

/** Run the game at `speed` for `ms`, sampling tick / fps / fatal every 10 s. */
async function playFor(app, ms, speed = 'Digit3') {
  await liveNoDialog(app);
  await app.page.keyboard.press(speed);
  const samples = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(Math.min(10_000, Math.max(0, end - Date.now())));
    await clearHints(app).catch(() => {});
    const s = await state(app);
    samples.push({ t: new Date().toISOString(), tick: s.world?.tick, day: s.world?.day, funds: s.world?.funds, fps: s.renderer?.fps, speed: s.speed, dialog: s.dialog, fatal: s.fatal });
    if (s.fatal) break;
    if (s.dialog) await G(app, () => window.__afterlife.game.closeDialog()); // an event/choice dialog pauses the sim: dismiss and go on
    if (s.speed === 0) await app.page.keyboard.press(speed);
  }
  return samples;
}

async function quitToDesktop(app) {
  await liveNoDialog(app);
  await escUntil(app, 'pause menu', () => window.__afterlife.game.dialog === 'pause');
  await dialog(app).getByRole('button', { name: 'Quit to Desktop' }).click();
  const saveQuit = app.page.getByRole('button', { name: 'Save & quit', exact: true });
  await saveQuit.waitFor({ state: 'visible', timeout: 10_000 });
  await shot(app, 'quit-dialog');
  const t0 = Date.now();
  await saveQuit.click();
  const gone = await waitNoProcess(30_000);
  check('Quit to Desktop → Save & quit ends every game process', gone, { exit: app.exit(), seconds: +((Date.now() - t0) / 1000).toFixed(1), left: pids() });
}

// ─────────────────────────────────────────── commands ───────────────────────────────────────────
async function play() {
  check('no game process before launch', pids().length === 0, pids());
  const app = await launch();
  report.data.environment = await environment(app);
  report.data.windowTitles = windowTitles();
  check('document title is "Afterlife Lease"', report.data.environment.title === 'Afterlife Lease', report.data.environment.title);
  check('window title is "Afterlife Lease"', report.data.windowTitles.includes('Afterlife Lease'), report.data.windowTitles);
  check('WebGL runs on the NVIDIA GPU', /NVIDIA/i.test(report.data.environment.gpu ?? ''), report.data.environment.gpu);
  await shot(app, '01-menu');

  await app.page.locator('.sh-menu__item', { hasText: 'New Game' }).click();
  await app.page.getByRole('button', { name: 'Create your household' }).click();
  await until(app, 'caz ready', () => !!window.__afterlife.game.caz && window.__afterlife.game.caz.members.length > 0 && !!document.querySelector('.sh-caz__editor'));
  await app.page.locator('.sh-random button', { hasText: 'Everything' }).click();
  await sleep(1500);
  await shot(app, '02-caz');
  const cazErrors = await G(app, () => window.__afterlife.game.validateCazDetailed());
  check('randomized zombie is valid in CAZ', cazErrors.length === 0, cazErrors);
  await app.page.locator('.sh-editor__start').click();
  await untilScreen(app, 'game');
  await until(app, 'renderer loaded + HUD', () => window.__afterlife.game.renderer.loadProgress() >= 1 && !!document.querySelector('.hud-funds'), undefined, 180_000);
  const s0 = await state(app);
  check('entered the game with a household', !!s0.world && s0.world.members.length > 0 && !s0.fatal, s0.world);
  await clearHints(app);
  await sleep(2000);
  await shot(app, '03-game');

  // buy one cheap floor item through the catalog UI
  const item = await G(app, () => {
    const defs = Object.values(window.__afterlife.game.sim.content.objects).filter((d) => d.buyable && d.placement === 'floor' && d.footprint.w === 1 && d.footprint.d === 1 && d.price >= 10);
    defs.sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
    return defs[0] ? { id: defs[0].id, name: defs[0].name, price: defs[0].price } : null;
  });
  await app.page.keyboard.press('KeyB');
  await until(app, 'buy mode', () => window.__afterlife.game.mode === 'buy' && !!document.querySelector('.hud-buy'));
  await clearHints(app);
  await app.page.locator('input[aria-label="Search the catalog"]').first().fill(item.name);
  await app.page.locator('button.hud-item').filter({ hasText: item.name }).first().click();
  await until(app, 'placing item', (id) => window.__afterlife.game.buy.placingDefId === id, item.id, 10_000);
  await clearHints(app);
  const tiles = await G(app, P.findPlaceTile, { defId: item.id });
  const before = await state(app);
  await app.page.mouse.move(tiles[0].sx - 3, tiles[0].sy - 3);
  await app.page.mouse.move(tiles[0].sx, tiles[0].sy);
  await until(app, 'valid ghost', () => /^\$/.test(window.__afterlife.game.buildPreviewLabel || ''), undefined, 15_000);
  await app.page.mouse.click(tiles[0].sx, tiles[0].sy);
  await until(app, 'object bought', (n) => Object.keys(window.__afterlife.game.sim.state.objects).length === n + 1, before.world.objects, 15_000);
  const afterBuy = await state(app);
  check(`buy mode: "${item.name}" placed and charged`, afterBuy.world.funds === before.world.funds - tiles[0].cost, { before: before.world.funds, after: afterBuy.world.funds, cost: tiles[0].cost });
  await shot(app, '04-buy');
  await G(app, () => window.__afterlife.game.cancelPlacement());

  // build a wall run by dragging
  await app.page.keyboard.press('KeyU');
  await until(app, 'build mode', () => window.__afterlife.game.mode === 'build' && !!document.querySelector('.hud-build'));
  await app.page.locator('.hud-tool[data-hint-anchor="tool-wall"]').click();
  await until(app, 'wall tool', () => window.__afterlife.game.buildTool.kind === 'wall');
  await clearHints(app);
  const run = (await G(app, P.findWallRun, { style: await G(app, () => window.__afterlife.game.buildTool.style) }))[0];
  const beforeWall = await state(app);
  await app.page.mouse.move(run.ax, run.ay);
  await app.page.mouse.down();
  for (let i = 1; i <= 8; i++) await app.page.mouse.move(run.ax + ((run.bx - run.ax) * i) / 8, run.ay + ((run.by - run.ay) * i) / 8);
  await sleep(500);
  await shot(app, '05-build-drag');
  await app.page.mouse.up();
  await until(app, 'walls built', (n) => Object.keys(window.__afterlife.game.sim.state.lot.walls).length > n, beforeWall.world.walls, 15_000);
  const afterWall = await state(app);
  check('build mode: wall built and charged', afterWall.world.walls === beforeWall.world.walls + run.edges.length && afterWall.world.funds === beforeWall.world.funds - run.cost, { walls: [beforeWall.world.walls, afterWall.world.walls], funds: [beforeWall.world.funds, afterWall.world.funds], cost: run.cost });
  await app.page.keyboard.press('KeyL');

  // play
  log(`  playing ${minutes} min at speed 3 ...`);
  const samples = await playFor(app, minutes * 60_000);
  report.data.playSamples = samples;
  const last = samples[samples.length - 1];
  check(`simulation advanced for ${minutes} min without a fatal error`, !!last && !last.fatal && last.tick > afterWall.world.tick, { firstTick: afterWall.world.tick, lastTick: last?.tick, day: last?.day });
  report.data.playFps = { min: Math.min(...samples.map((x) => x.fps ?? 0)), max: Math.max(...samples.map((x) => x.fps ?? 0)) };
  await shot(app, '06-after-play');

  // save through the UI
  await liveNoDialog(app);
  await app.page.keyboard.press('Digit0');
  await until(app, 'paused', () => window.__afterlife.game.speed === 0, undefined, 10_000).catch(() => app.page.keyboard.press('Digit0'));
  await escUntil(app, 'pause menu', () => window.__afterlife.game.dialog === 'pause');
  await dialog(app).getByRole('button', { name: 'Save Game' }).click();
  await until(app, 'save dialog', () => window.__afterlife.game.dialog === 'saveLoad' && !!document.querySelector('.sh-saves__new'));
  await app.page.locator('.sh-saves__new input').fill('Desktop Verify');
  await app.page.locator('.sh-saves__savebtn').click();
  await until(app, 'saved status', () => /Saved “Desktop Verify”/.test(document.querySelector('.sh-saves__status')?.textContent || ''), undefined, 30_000);
  await shot(app, '07-saved');
  const snap = (await state(app)).world;
  const slots = await G(app, () => window.__afterlife.game.listSaves().then((l) => l.map((s) => ({ slotId: s.slotId, name: s.name, day: s.meta.day, funds: s.meta.funds }))));
  check('save "Desktop Verify" is listed with the current funds/day', slots.some((s) => s.name === 'Desktop Verify' && s.funds === snap.funds && s.day === snap.day), slots);
  writeFileSync(stateFile, JSON.stringify(snap, null, 2));

  await quitToDesktop(app);
  report.data.saveFiles = saveFiles();
  report.data.userData = userData;
  check('save files exist under %APPDATA%\\Afterlife Lease\\saves', (report.data.saveFiles ?? []).length > 0, report.data.saveFiles);
}

async function cont() {
  const want = JSON.parse(readFileSync(stateFile, 'utf8'));
  const app = await launch();
  await shot(app, '01-menu-continue');
  const s = await continueGame(app);
  await shot(app, '02-continued');
  check('Continue restores household, funds, day and tick from the last session (run directly after play)', s.world.household === want.household && s.world.funds === want.funds && s.world.day === want.day && s.world.tick === want.tick, { want: { household: want.household, funds: want.funds, day: want.day, tick: want.tick }, got: { household: s.world.household, funds: s.world.funds, day: s.world.day, tick: s.world.tick } });
  check('Continue restores objects and walls', s.world.objects === want.objects && s.world.walls === want.walls, { want: [want.objects, want.walls], got: [s.world.objects, s.world.walls] });
  await quitToDesktop(app);
}

async function single() {
  const app = await launch();
  const before = pids().length;
  const second = spawnApp();
  const code = await new Promise((res) => {
    const t = setTimeout(() => res('still running after 15 s'), 15_000);
    second.on('exit', (c) => (clearTimeout(t), res(c)));
  });
  await sleep(1500);
  const titles = windowTitles();
  check('second launch exits by itself with code 0', secondInstanceOk(code), { exitCode: code });
  check('still exactly one game window', titles.length === 1, { titles, processesBefore: before, processesAfter: pids().length });
  check('first instance is still responsive', (await state(app)).screen === 'menu');
  if (typeof code !== 'number') second.kill();
  await G(app, () => window.__afterlife.game.quitApp());
  check('first instance quits', await waitNoProcess(20_000), pids());
}

async function crash() {
  let app = await launch();
  const start = await continueGame(app);
  report.data.environment = await environment(app);
  log(`  playing ${minutes} min at speed 3 before the kill ...`);
  const samples = await playFor(app, minutes * 60_000);
  const atKill = await state(app);
  const slotsBefore = await G(app, () => window.__afterlife.game.listSaves().then((l) => l.map((s) => ({ slotId: s.slotId, name: s.name, day: s.meta.day, savedAt: s.savedAt ?? s.meta.savedAt ?? null }))));
  report.data.beforeKill = { start: start.world, atKill: atKill.world, slots: slotsBefore, samples: samples.length };
  await shot(app, '01-before-kill');
  report.data.taskkill = killOurs();
  check('hard kill removed every game process', await waitNoProcess(15_000), pids());
  report.data.saveFilesAfterKill = saveFiles();
  check('no temp files left in saves after the kill', !(report.data.saveFilesAfterKill ?? []).some((f) => /\.tmp/.test(f.file)), report.data.saveFilesAfterKill);

  app = await launch();
  await shot(app, '02-relaunch-menu');
  const s = await continueGame(app);
  await shot(app, '03-recovered');
  const lostTicks = atKill.world.tick - s.world.tick;
  report.data.recovered = { world: s.world, lostTicks, lostDays: atKill.world.day - s.world.day };
  check('relaunch after the kill: Continue loads a valid game of the same household', !s.fatal && s.world.household === atKill.world.household, s.world);
  check('recovered game is newer than the session start (an autosave during play survived the kill)', s.world.tick > start.world.tick, { startTick: start.world.tick, recoveredTick: s.world.tick, killTick: atKill.world.tick });
  await quitToDesktop(app);
}

async function fps() {
  // The app restores its window from window-state.json: write the wanted size (DIP) before launching.
  const scale = Number(opt('scale', '1.25'));
  const wsFile = join(userData, 'window-state.json');
  const prev = existsSync(wsFile) ? readFileSync(wsFile, 'utf8') : null;
  if (flag('fullscreen')) writeFileSync(wsFile, JSON.stringify({ bounds: null, maximized: false, fullscreen: true }));
  else {
    const [w, h] = opt('size', '1920x1080').split('x').map(Number);
    const frame = { w: Number(opt('frame-w', '16')), h: Number(opt('frame-h', '39')) }; // window frame around the content, DIP
    writeFileSync(wsFile, JSON.stringify({ bounds: { x: 0, y: 0, width: Math.round(w / scale) + frame.w, height: Math.round(h / scale) + frame.h }, maximized: false, fullscreen: false }));
  }
  const app = await launch();
  await continueGame(app);
  await liveNoDialog(app);
  const quality = opt('quality', null);
  if (quality) await G(app, (q) => window.__afterlife.game.updateSettings({ quality: q }), quality);
  // --emulate WxH: exact viewport through CDP (Emulation.setDeviceMetricsOverride, DSF 1) when the size cannot fit
  // on the desktop as a real window. The canvas drawing buffer is rendered at that size; the result is labelled emulated.
  const emulate = opt('emulate', null);
  let cdp = null;
  if (emulate) {
    const [width, height] = emulate.split('x').map(Number);
    cdp = await app.page.context().newCDPSession(app.page);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await sleep(2000);
    const got = await environment(app);
    report.data.emulated = { width, height };
    check(`emulated viewport is exactly ${emulate} (inner size and canvas drawing buffer)`, got.innerCss[0] === width && got.innerCss[1] === height && !!got.canvasBuffer && got.canvasBuffer[0] === width && got.canvasBuffer[1] === height, { innerCss: got.innerCss, devicePixelRatio: got.devicePixelRatio, canvasBuffer: got.canvasBuffer });
  }
  await app.page.keyboard.press('Digit1');
  await sleep(5000);
  report.data.environment = await environment(app);
  report.data.fps = await measureFps(app, 30_000);
  await shot(app, 'fps');
  if (cdp) await cdp.send('Emulation.clearDeviceMetricsOverride');
  log(`  ${JSON.stringify(report.data.environment.innerPhysical)} canvas ${JSON.stringify(report.data.environment.canvasBuffer)} quality=${report.data.environment.quality}: ${JSON.stringify(report.data.fps)}`);
  check('rendered frames during the sample', report.data.fps.frames > 0, report.data.fps);
  await G(app, () => window.__afterlife.game.quitApp());
  await waitNoProcess(20_000);
  if (prev !== null) writeFileSync(wsFile, prev);
}

const commands = { play, continue: cont, single, crash, fps };
if (!commands[cmd]) {
  console.error(`usage: node tests/desktop/electron-verify.mjs <${Object.keys(commands).join('|')}> [--exe path] [--minutes N] [--size WxH] [--fullscreen] [--uncapped] [--tag name]`);
  process.exit(2);
}
try {
  await commands[cmd]();
} catch (e) {
  check(`${cmd} ran to the end`, false, String(e.message).slice(0, 1500));
  killOurs();
}
finish();
