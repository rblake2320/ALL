/**
 * Long soak in the real browser (PRODUCTION_READINESS §2 "Long soak"): many game days in one page, looking for what a
 * 7-minute smoke run cannot show — leaks, slow drifts, the sim slowing down, errors that need hours to appear.
 *
 *   node tests/e2e/soak.mjs [--minutes=30] [--sample-s=30] [--speed=3] [--dist=<dir>] [--no-build] [--url=<server>]
 *                           [--out=dev/out/soak] [--gpu] [--viewport=1280x720] [--new-world-min=0]
 *
 * One page, one new game (the default story start), played for `--minutes` of wall-clock time at `--speed` with a
 * scripted player that never stops poking at it: go-here orders, buy → move → sell, build a room → undo → redo,
 * mode switches, dialogs opened and closed, selection cycling, camera rotation, manual saves. Every `--sample-s` the
 * script forces a GC and records, through CDP `Performance.getMetrics` and the game's own counters:
 *
 *   JS heap, DOM nodes, JS event listeners, documents/frames   (page-level leaks)
 *   WebGL geometries, textures, shader programs, draw calls    (renderer leaks: `renderer.stats()`)
 *   toasts, notifications, tx log, queue lengths, sim objects  (unbounded game lists)
 *   size of the serialised world                               (save growth per game day)
 *   sim ticks per real second                                  (the game slowing down)
 *
 * Verdict. The first quarter of the run is warm-up (assets, shaders, first purchases). After it, a counter that
 * should be BOUNDED fails when it is still climbing at the end: the mean of the last quarter exceeds the mean of the
 * second quarter by more than its limit (ratio and absolute, both must be exceeded, so noise on a small number never
 * fails). The limits are in BOUNDED below, each with the reason. Heap and save size legitimately grow with game
 * days (history, relationships, stats), so they are reported as a rate per game day and fail only on the generous
 * caps in GROWTH. The run also fails on any page error, console error, fatal screen, sim fault, failed save, or a
 * tick rate in the last quarter below 60 % of the second quarter's at the same speed.
 *
 * Worlds. A household can die under this player (it keeps interrupting them); "game over" is a legitimate end of a
 * world, not a defect, so the script then does what a player does: back to the menu, new game, carry on. The same
 * happens every `--new-world-min` minutes when set (> 0), which soaks session teardown and start-up too. Game time
 * is counted across worlds; the number of worlds and why each ended is printed and stored in the report.
 *
 * Software rendering (default) measures leaks and drift, NOT frame time: pass `--gpu` on a machine with a real GPU.
 * Report: <out>/report.json (every sample) + a printed table. Exit 0 = pass, 1 = fail.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureBuild, startPreview } from './lib/server.mjs';
import { judge, quarters } from './lib/soakVerdict.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const a = argv.find((x) => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : d;
};
const MINUTES = Number(opt('minutes', '30'));
const SAMPLE_MS = Number(opt('sample-s', '30')) * 1000;
const SPEED = Number(opt('speed', '3'));
const OUT = path.resolve(ROOT, opt('out', 'dev/out/soak'));
const GPU = argv.includes('--gpu');
// A smaller viewport renders faster in software, so the same wall-clock time covers more game days.
const [VW, VH] = opt('viewport', '1280x720').split('x').map(Number);
const NEW_WORLD_MS = Math.max(0, Number(opt('new-world-min', '0')) || 0) * 60_000;
const log = (s) => console.log(s);
const TICKS_PER_DAY = 5760; // src/sim/types.ts (TICK_MINUTES 0.25)

if (!(MINUTES > 0) || !(SAMPLE_MS >= 5000) || ![1, 2, 3].includes(SPEED) || !(VW >= 320) || !(VH >= 240)) {
  console.error('usage: --minutes > 0, --sample-s >= 5, --speed 1|2|3, --viewport=WxH (≥ 320x240)');
  process.exit(2);
}

// ── in-page: the scripted player. Each action returns a short tag or null (could not act this time). ──
function playerAction(n) {
  const g = window.__afterlife.game;
  const sim = g.sim;
  if (!sim || g.screen !== 'game') return null;
  const st = sim.state;
  const rnd = (a, b) => a + Math.floor(Math.random() * (b - a));
  const members = st.household.memberIds;
  const who = members[n % members.length];
  const w = (window.__soak ??= { bought: [], rooms: 0 });
  switch (n % 12) {
    case 0: {
      g.selectAgent(who);
      g.openMenuFor({ kind: 'tile', x: rnd(4, st.lot.width - 4), z: rnd(4, st.lot.depth - 4) }, 300, 300);
      const e = g.menu && g.menu.entries.find((m) => m.interactionId === 'engine_goHere');
      if (e) g.chooseMenuEntry(e);
      else g.closeMenu();
      return e ? 'goHere' : null;
    }
    case 1: {
      // Buy the cheapest floor object the catalog offers on a free tile; remember it for the move / sell steps.
      g.setMode('buy');
      const defs = Object.values(sim.content.objects).filter((d) => d.buyable && d.sellable && d.price > 0 && d.price <= 150 && d.placement === 'floor' && d.footprint.w === 1 && d.footprint.d === 1 && !d.indoorOnly);
      defs.sort((a, b) => a.price - b.price);
      const before = new Set(Object.keys(st.objects));
      for (const d of defs.slice(0, 6)) {
        for (let k = 0; k < 12; k++) {
          if (g.applyBuild({ type: 'buy', defId: d.id, x: rnd(2, st.lot.width - 2), z: rnd(2, st.lot.depth - 2), rot: 0 })) {
            const id = Object.keys(sim.state.objects).find((o) => !before.has(o));
            if (id) w.bought.push(id);
            return `buy:${d.id}`;
          }
        }
      }
      return null;
    }
    case 2: {
      const id = w.bought.find((o) => sim.state.objects[o]);
      if (!id) return null;
      for (let k = 0; k < 12; k++) if (g.applyBuild({ type: 'move', objectId: id, x: rnd(2, st.lot.width - 2), z: rnd(2, st.lot.depth - 2), rot: (k % 4) })) return 'move';
      return null;
    }
    case 3: {
      const id = w.bought.shift();
      if (!id || !sim.state.objects[id]) return null;
      g.sellObject(id);
      return sim.state.objects[id] ? null : 'sell';
    }
    case 4: {
      g.setMode('build');
      const x0 = rnd(2, st.lot.width - 6);
      const z0 = rnd(2, st.lot.depth - 6);
      if (!g.applyBuild({ type: 'room', x0, z0, x1: x0 + 3, z1: z0 + 3 })) return null;
      w.rooms++;
      return 'room';
    }
    case 5: {
      if (!g.canUndo) return null;
      g.undo(); // the room goes away again: wall and floor meshes are built and freed over and over
      if (g.canRedo && n % 24 === 5) {
        g.redo();
        g.undo();
        return 'undo+redo+undo';
      }
      return 'undo';
    }
    case 7:
      g.setMode('live');
      g.cycleSelection(1);
      g.rotateCamera(n % 2 ? 1 : -1);
      return 'select+rotate';
    case 8: {
      const d = ['help', 'settings', 'saveLoad'][Math.floor(n / 12) % 3];
      g.openDialog(d);
      return `open:${d}`;
    }
    case 9:
      g.closeDialog();
      g.cycleWallMode();
      return 'close+walls';
    case 10:
      for (const t of g.toasts.slice()) g.dismissToast(t.id);
      g.markNotificationsRead();
      return 'dismiss';
    case 11:
      return 'save'; // done from Node (async), see below
    default:
      return null;
  }
}

function sampleInPage() {
  const g = window.__afterlife.game;
  if (typeof window.gc === 'function') window.gc();
  const sim = g.sim;
  const st = sim ? sim.state : null;
  const rs = g.renderer && typeof g.renderer.stats === 'function' ? g.renderer.stats() : {};
  let faults = 0;
  try {
    faults = sim && typeof sim.faults === 'function' ? sim.faults().length : 0;
  } catch {
    faults = -1;
  }
  const agents = st ? Object.values(st.agents) : [];
  return {
    screen: g.screen,
    fatal: g.fatalError,
    speed: g.speed,
    tick: st ? st.tick : -1,
    worldBytes: st ? JSON.stringify(st).length : 0,
    simObjects: st ? Object.keys(st.objects).length : 0,
    simAgents: agents.length,
    notifications: st && Array.isArray(st.notifications) ? st.notifications.length : 0,
    txLog: st && Array.isArray(st.household.txLog) ? st.household.txLog.length : 0,
    relationships: st && st.relationships ? Object.keys(st.relationships).length : 0,
    queueMax: agents.reduce((m, a) => Math.max(m, Array.isArray(a.queue) ? a.queue.length : 0), 0),
    toasts: g.toasts.length,
    faults,
    funds: st ? st.household.funds : 0,
    lastSaveFailed: g.lastSaveFailed,
    geometries: rs.geometries ?? 0,
    textures: rs.textures ?? 0,
    programs: rs.programs ?? 0,
    precompileCalls: rs.precompileCalls ?? 0,
    precompileMs: Math.round((rs.precompileMs ?? 0) * 100) / 100,
    drawCalls: rs.drawCalls ?? 0,
    triangles: rs.triangles ?? 0,
    rObjects: rs.objects ?? 0,
    particles: rs.particles ?? 0,
    frames: rs.frames ?? 0,
    lastFrameMs: Math.round(rs.lastFrameMs ?? 0),
    contextLost: !!rs.contextLost,
    domNodesLive: document.getElementsByTagName('*').length,
    canvases: document.getElementsByTagName('canvas').length,
  };
}

const fmt = (v) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e4 ? `${(v / 1e3).toFixed(0)}k` : Number.isInteger(v) ? String(v) : v.toFixed(1));

async function main() {
  mkdirSync(OUT, { recursive: true });
  let server = null;
  let browser = null;
  const errors = [];
  const samples = [];
  const actions = {};
  let saves = 0;
  let saveFailures = 0;
  try {
    let url = opt('url', '');
    if (!url) {
      const distDir = path.resolve(opt('dist', path.join(ROOT, 'dist')));
      await ensureBuild({ root: ROOT, distDir, mode: argv.includes('--no-build') ? 'never' : 'auto', log });
      server = await startPreview({ root: ROOT, distDir, log });
      url = server.url;
    }
    const args = ['--js-flags=--expose-gc', '--enable-precise-memory-info'];
    if (!GPU) args.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
    browser = await chromium.launch({ headless: true, args });
    const page = await browser.newPage({ viewport: { width: VW, height: VH } });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text().slice(0, 240)}`));
    page.on('crash', () => errors.push('the page crashed'));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');

    await page.goto(url);
    await page.waitForFunction(() => window.__afterlife?.game?.screen === 'menu' || !!window.__afterlife?.game?.fatalError, null, { timeout: 900_000, polling: 200 });
    const worlds = []; // { startedMin, endedMin, ticks, why }
    let tickOffset = 0; // game time already played in earlier worlds
    let worldStartedAt = Date.now();
    const startWorld = async () => {
      await page.evaluate(() => {
        const g = window.__afterlife.game;
        window.__soak = undefined;
        g.beginNewGame();
        g.addCazMember(); // two zombies: social + queue churn
        return g.startGame();
      });
      await page.waitForFunction(() => window.__afterlife.game.screen === 'game' || !!window.__afterlife.game.fatalError, null, { timeout: 900_000, polling: 200 });
      await page.evaluate((s) => window.__afterlife.game.setSpeed(s), SPEED);
      worldStartedAt = Date.now();
    };
    /** Leave the current world the way a player does (game over → menu, or Quit to menu) and start the next one. */
    const nextWorld = async (why, t0) => {
      const ended = await page.evaluate(async () => {
        const g = window.__afterlife.game;
        const tick = g.sim ? g.sim.state.tick : 0;
        const reason = g.screen === 'gameOver' ? 'game over' : 'quit to menu';
        if (g.screen === 'gameOver') g.goto('menu');
        else await g.quitToMenu();
        return { tick, reason };
      });
      await page.waitForFunction(() => window.__afterlife.game.screen === 'menu' || !!window.__afterlife.game.fatalError, null, { timeout: 900_000, polling: 200 });
      tickOffset += ended.tick;
      worlds.push({ startedMin: (worldStartedAt - t0) / 60_000, endedMin: (Date.now() - t0) / 60_000, ticks: ended.tick, why: `${why}: ${ended.reason}` });
      log(`   -- world ${worlds.length} ended after ${(ended.tick / TICKS_PER_DAY).toFixed(1)} game days (${why}); starting a new game`);
      await startWorld();
    };
    await startWorld();
    const build = await page.evaluate(() => window.__afterlife.version);
    log(`soak: ${MINUTES} min at speed ${SPEED}, sample every ${SAMPLE_MS / 1000} s, ${GPU ? 'real GPU' : 'software WebGL (leaks/drift only, not frame time)'}; build ${build}, viewport ${VW}×${VH}\n`);
    log('   min   day   ticks/s  heapMB  nodes  listeners  geom   tex  prog  pre#  pre-ms  draws  worldKB  notif  toasts  faults');

    const t0 = Date.now();
    const end = t0 + MINUTES * 60_000;
    let nextSample = t0; // first sample at once (baseline)
    let n = 0;
    let lastTick = null;
    let lastAt = null;
    while (Date.now() < end || samples.length < 8) {
      // The player keeps the game un-paused at the soak speed (dialogs pause it; that is the game's rule).
      const scr = await page.evaluate(() => ({ screen: window.__afterlife.game.screen, fatal: window.__afterlife.game.fatalError }));
      if (scr.fatal) {
        errors.push(`fatal: ${scr.fatal}`);
        break;
      }
      if (scr.screen === 'gameOver') await nextWorld('the household died', t0);
      else if (NEW_WORLD_MS > 0 && Date.now() - worldStartedAt >= NEW_WORLD_MS) await nextWorld('--new-world-min', t0);
      const tag = await page.evaluate(playerAction, n).catch((e) => `ERR:${String(e).slice(0, 80)}`);
      if (tag === 'save') {
        const r = await page.evaluate(async () => {
          const g = window.__afterlife.game;
          const r = await g.saveGame();
          return !!r && r.ok !== false;
        }).catch(() => false);
        saves++;
        if (!r) saveFailures++;
      }
      actions[tag ?? 'none'] = (actions[tag ?? 'none'] ?? 0) + 1;
      n++;
      await page.evaluate((s) => {
        const g = window.__afterlife.game;
        if (g.screen === 'game' && g.dialog === null && g.speed !== s) g.setSpeed(s);
      }, SPEED).catch(() => undefined);

      if (Date.now() >= nextSample) {
        nextSample += SAMPLE_MS;
        const inPage = await page.evaluate(sampleInPage);
        const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
        const now = Date.now();
        inPage.worldTick = inPage.tick;
        inPage.tick += tickOffset; // game time across worlds
        inPage.world = worlds.length + 1;
        const tps = lastTick === null ? 0 : (inPage.tick - lastTick) / ((now - lastAt) / 1000);
        lastTick = inPage.tick;
        lastAt = now;
        const s = {
          tMin: (now - t0) / 60_000,
          gameDay: inPage.tick / TICKS_PER_DAY,
          ticksPerSec: tps,
          heapBytes: m.JSHeapUsedSize ?? 0,
          domNodes: m.Nodes ?? 0,
          listeners: m.JSEventListeners ?? 0,
          documents: m.Documents ?? 0,
          ...inPage,
        };
        samples.push(s);
        log(
          `${s.tMin.toFixed(1).padStart(6)} ${s.gameDay.toFixed(1).padStart(5)} ${tps.toFixed(1).padStart(9)} ${(s.heapBytes / 1048576).toFixed(1).padStart(7)} ${String(s.domNodes).padStart(6)} ${String(s.listeners).padStart(10)} ${String(s.geometries).padStart(5)} ${String(s.textures).padStart(5)} ${String(s.programs).padStart(5)} ${String(s.precompileCalls).padStart(5)} ${Number(s.precompileMs).toFixed(1).padStart(8)} ${String(s.drawCalls).padStart(6)} ${(s.worldBytes / 1024).toFixed(0).padStart(8)} ${String(s.notifications).padStart(6)} ${String(s.toasts).padStart(7)} ${String(s.faults).padStart(7)}`,
        );
        if (inPage.fatal) {
          errors.push(`fatal: ${inPage.fatal}`);
          break;
        }
      }
      await page.waitForTimeout(700);
    }

    const verdict = judge(samples, { errors, saves, saveFailures, actions });
    const q = quarters(samples);
    const lastSample = samples.at(-1) ?? { precompileCalls: 0, precompileMs: 0 };
    const materialPrecompile = { calls: lastSample.precompileCalls, totalMs: lastSample.precompileMs };
    log(`\nplayer actions: ${Object.entries(actions).map(([k, v]) => `${k}×${v}`).join(', ')}; manual saves ${saves} (${saveFailures} failed)`);
    log(`worlds played: ${worlds.length + 1}${worlds.length ? ` (${worlds.map((w, i) => `#${i + 1} ${(w.ticks / TICKS_PER_DAY).toFixed(1)} days, ${w.why}`).join('; ')})` : ''}`);
    log(`game time covered: tick ${samples[0].tick} → ${samples.at(-1).tick} (${((samples.at(-1).tick - samples[0].tick) / TICKS_PER_DAY).toFixed(1)} game days)`);
    log(`material precompile: ${materialPrecompile.calls} calls, ${materialPrecompile.totalMs.toFixed(2)} ms cumulative`);
    log(`warm-up = first ${q.warmupCount} samples; compared: samples ${q.q2[0]}–${q.q2[1]} vs ${q.q4[0]}–${q.q4[1]}\n`);
    log('  metric            Q2 mean    Q4 mean    change   verdict');
    for (const r of verdict.rows) log(`  ${r.metric.padEnd(16)} ${fmt(r.q2).padStart(8)}   ${fmt(r.q4).padStart(8)}   ${(r.ratio >= 10 ? '≥10×' : `${r.ratio.toFixed(2)}×`).padStart(6)}   ${r.ok ? 'ok' : 'FAIL'}${r.note ? ` — ${r.note}` : ''}`);
    for (const c of verdict.checks) log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ build, minutes: MINUTES, speed: SPEED, gpu: GPU, viewport: [VW, VH], startedAt: new Date(t0).toISOString(), actions, saves, saveFailures, worlds, errors, materialPrecompile, verdict, samples }, null, 1));
    log(`\nreport: ${path.relative(ROOT, path.join(OUT, 'report.json'))}`);
    log(verdict.ok ? 'SOAK PASSED' : 'SOAK FAILED');
    return verdict.ok ? 0 : 1;
  } finally {
    const bounded = (p) => Promise.race([Promise.resolve(p).catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    if (browser) await bounded(browser.close());
    if (server) await bounded(server.stop());
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  },
);
