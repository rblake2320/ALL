#!/usr/bin/env node
/**
 * Shared town, step 1, in real browsers: two people open the BUILT town page, each sees the other's zombie, and one
 * watches the other walk. Also proves the page can talk to its one server and to nothing else.
 *
 *   node tests/e2e/town.mjs [--shot=<file.png>]
 *
 * Builds the town server and a web build pointed at it (dist-town-e2e), starts both on this machine, and drives two
 * separate browser profiles. Exit 0 = every check passed.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort, startPreview, viteBin } from './lib/server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = path.join(ROOT, 'dist-town-e2e');
const shotArg = process.argv.find((a) => a.startsWith('--shot='));
const log = (m) => console.log(`[town-e2e] ${m}`);
const WALK_SPEED = 2.4; // tiles per second, src/shared/townNet/room.ts

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
};

function run(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`${args[0]} exited ${code}\n${out.slice(-3000)}`))));
  });
}

const townPort = await freePort();
const otherPort = await freePort();
const TOWN = `ws://127.0.0.1:${townPort}`;

log('building the town server');
await run([path.join(ROOT, 'scripts', 'build-town-server.mjs')], {});
log(`building the web pages for ${TOWN}`);
await run([viteBin(ROOT), 'build', '--outDir', DIST, '--emptyOutDir'], { NODE_ENV: 'production', VITE_TOWN_SERVER: TOWN });

const preview = await startPreview({ root: ROOT, distDir: DIST, log });
const origin = preview.url.replace(/\/$/, '');
// the real server, told to accept only the page's own origin
const serverProc = spawn(process.execPath, [path.join(ROOT, 'dist-server', 'town-server.mjs')], { cwd: ROOT, env: { ...process.env, PORT: String(townPort), HOST: '127.0.0.1', TOWN_ORIGINS: origin }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverOut = '';
serverProc.stdout.on('data', (d) => (serverOut += d));
serverProc.stderr.on('data', (d) => (serverOut += d));
const health = async () => {
  const res = await fetch(`http://127.0.0.1:${townPort}/healthz`);
  return res.json();
};
for (let i = 0; i < 50; i++) {
  try {
    await health();
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = null;
try {
  // ── what was built ──
  const townHtml = readFileSync(path.join(DIST, 'town.html'), 'utf8');
  const gameHtml = readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const csp = (html) => /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
  check('the town page may connect to its server and to no other', new RegExp(`connect-src 'self' data: blob: ${TOWN.replace(/[.]/g, '\\.')}(;|$)`).test(csp(townHtml)), csp(townHtml).match(/connect-src[^;]*/)?.[0]);
  check("the game's own page may connect to nobody", /connect-src 'self' data: blob:(;|$)/.test(csp(gameHtml)) && !/wss?:/.test(csp(gameHtml)));

  const open = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${preview.url}town.html`);
    return { name, ctx, page, errors };
  };
  const inTown = (p, n) => p.page.waitForFunction((want) => document.body.dataset.town === 'inTown' && document.body.dataset.players === String(want), n, { timeout: 240_000, polling: 250 });

  const a = await open('A');
  await inTown(a, 1);
  check('the first player is told they are alone', /only one/.test(await a.page.locator('#town-status').textContent()));
  const b = await open('B');
  await Promise.all([inTown(a, 2), inTown(b, 2)]);
  check('both pages report two zombies on the street', true);
  check('the server counts two players', (await health()).players === 2);

  await a.page.waitForTimeout(1500);
  const aSelf = await a.page.evaluate(() => window.__town.self());
  const bSeesA0 = (await b.page.evaluate(() => window.__town.others()))[0];
  check("B's view of A matches where A is", Math.hypot(bSeesA0.x - aSelf.x, bSeesA0.z - aSelf.z) < 0.02, `off by ${Math.hypot(bSeesA0.x - aSelf.x, bSeesA0.z - aSelf.z).toFixed(3)} tiles`);
  check('each page draws both zombies', (await a.page.evaluate(() => window.__town.drawn())).length === 2 && (await b.page.evaluate(() => window.__town.drawn())).length === 2);
  check('each page shows two name tags, one marked "(you)"', (await a.page.locator('.town-label').count()) === 2 && (await a.page.locator('.town-label--me').count()) === 1 && /\(you\)$/.test(await b.page.locator('.town-label--me').textContent()));

  // ── A walks; B watches ──
  let sawWalking = false;
  const watch = setInterval(() => {
    b.page.evaluate(() => window.__town.others()[0]?.moving).then((m) => (sawWalking ||= m === true)).catch(() => {});
  }, 200);
  const HOLD_MS = 3000;
  await a.page.keyboard.down('ArrowRight');
  await a.page.waitForTimeout(HOLD_MS);
  if (shotArg) {
    await b.page.screenshot({ path: path.resolve(ROOT, shotArg.slice(7)) });
    log(`saved ${shotArg.slice(7)}`);
  }
  await a.page.keyboard.up('ArrowRight');
  await a.page.waitForTimeout(1200);
  clearInterval(watch);
  const aSelf1 = await a.page.evaluate(() => window.__town.self());
  const bSeesA1 = (await b.page.evaluate(() => window.__town.others()))[0];
  const walked = Math.hypot(aSelf1.x - aSelf.x, aSelf1.z - aSelf.z);
  check('A moved', walked > 2, `${walked.toFixed(2)} tiles in ${HOLD_MS / 1000} s`);
  check('A moved no faster than the walking pace', walked <= WALK_SPEED * (HOLD_MS / 1000 + 0.5), `limit ${(WALK_SPEED * (HOLD_MS / 1000 + 0.5)).toFixed(2)}`);
  check('B saw A arrive at the same place', Math.hypot(bSeesA1.x - aSelf1.x, bSeesA1.z - aSelf1.z) < 0.02, `off by ${Math.hypot(bSeesA1.x - aSelf1.x, bSeesA1.z - aSelf1.z).toFixed(3)} tiles`);
  check('B saw A walking on the way, and standing at the end', sawWalking && bSeesA1.moving === false);
  check("A's own picture never had to be corrected by the server", (await a.page.evaluate(() => window.__town.corrections())) === 0);
  check('B did not move', await b.page.evaluate((s) => { const me = window.__town.self(); return me.x === s.x && me.z === s.z; }, await b.page.evaluate(() => window.__town.self())));

  // ── the page talks to its one server only, and the server answers the game page only ──
  // A second town server that accepts any page listens on another port. A page it serves is an ordinary web page
  // from a different site: it can reach that second server (control) but not the real one, and the town page cannot
  // reach the second one. (A blank page cannot be used here: the browser itself stops those reaching this machine.)
  const second = spawn(process.execPath, [path.join(ROOT, 'dist-server', 'town-server.mjs')], { cwd: ROOT, env: { ...process.env, PORT: String(otherPort), HOST: '127.0.0.1', TOWN_ORIGINS: '' }, stdio: 'ignore' });
  try {
    const OTHER = `ws://127.0.0.1:${otherPort}`;
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(`http://127.0.0.1:${otherPort}/healthz`);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const tryOpen = (url) =>
      new Promise((resolve) => {
        try {
          const ws = new WebSocket(url);
          ws.onopen = () => (ws.close(), resolve('opened'));
          ws.onerror = () => resolve('refused');
        } catch {
          resolve('refused');
        }
      });
    const stranger = await (await browser.newContext()).newPage();
    await stranger.goto(`http://127.0.0.1:${otherPort}/healthz`);
    check('control: a page from another site can reach the second, open server', (await stranger.evaluate(tryOpen, OTHER)) === 'opened');
    check('the real server refuses that page from another site', (await stranger.evaluate(tryOpen, TOWN)) === 'refused');
    check('the town page is refused a connection to the second server', (await a.page.evaluate(tryOpen, OTHER)) === 'refused');
    check('control: the real server is still serving the game page', (await health()).players === 2);
  } finally {
    second.kill();
  }

  // ── A leaves ──
  await a.ctx.close();
  await inTown(b, 1);
  check('when A closes the page, B is alone again and A\'s name tag is gone', (await b.page.locator('.town-label').count()) === 1);
  check('the server counts one player', (await health()).players === 1);
  await b.ctx.close();
  await new Promise((r) => setTimeout(r, 300));
  const end = await health();
  check('with everyone gone the server holds nobody and no room', end.players === 0 && end.rooms === 0);
  check('no page threw an error', a.errors.length === 0 && b.errors.length === 0, [...a.errors, ...b.errors].join(' | ').slice(0, 300));
  check('the server log holds no address', !/127\.0\.0\.1:\d+ |::ffff|remote/.test(serverOut.replace(/listening on port \d+/, '')), serverOut.trim().slice(0, 200));
} catch (e) {
  failed = e;
} finally {
  await browser.close().catch(() => {});
  serverProc.kill();
  await preview.stop().catch(() => {});
}
if (failed) {
  console.error(failed);
  process.exit(1);
}
console.log(failures === 0 ? '\nShared town e2e: all checks passed' : `\nShared town e2e: ${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
