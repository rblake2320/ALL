/**
 * Roofs and ceilings in the real browser (src/render/roofs).
 *
 *   node tests/e2e/roofs.mjs [--dist=<dir>] [--no-build] [--out=dev/out/roofs] [--gpu]
 *
 * One new game, then every view and mode the rules name, reading the roof layer from the scene itself:
 *   overview (zombie indoors) -> its roof gone, others kept -> wall mode down -> shoulder -> first person (ceiling in, roof kept)
 *   -> back to overview -> Buy and Build (all hidden) -> live again (roofs fade back) -> draw counts -> no page error.
 * Screenshots go to <out>/. Software rendering says nothing about frame time: the draw-count line is the cost report
 * here, and frame time Low/High is measured on named hardware with --gpu.
 * Exit 0 = pass, 1 = fail.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
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
const OUT = path.resolve(ROOT, opt('out', 'dev/out/roofs'));
const GPU = argv.includes('--gpu');
const LAUNCH = { headless: true, args: GPU ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
const log = (s) => console.log(s);
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
};

const screenIs = (sc) => {
  const g = window.__afterlife && window.__afterlife.game;
  return !!g && (g.screen === sc || !!g.fatalError);
};
/** The roof layer as the scene holds it: what is drawn right now, per building. */
const roofState = () => {
  const g = window.__afterlife.game;
  const scene = g.renderer.scene();
  const grp = scene.getObjectByName('roofs');
  const out = { buildings: {}, drawn: 0 };
  if (!grp) return { missing: true };
  for (const m of grp.children) {
    const [kind, id] = m.name.split(':');
    const b = (out.buildings[id] ??= { roof: 0, ceiling: 0, tris: 0 });
    const o = m.visible ? m.material.opacity : 0;
    b[kind] = Math.max(b[kind], o);
    b.tris += m.geometry.index ? m.geometry.index.count / 3 : 0;
    if (m.visible) out.drawn++;
  }
  const id = g.selectedAgentId;
  out.mode = g.mode;
  out.perspective = g.perspective;
  out.wallMode = g.wallMode;
  out.selected = id;
  return out;
};
const waitFor = (page, fn, arg, timeout = 120_000) => page.waitForFunction(fn, arg, { polling: 100, timeout });
const waitFrames = (page, n) =>
  page.evaluate(
    (k) =>
      new Promise((res) => {
        const g = window.__afterlife.game;
        const f0 = g.renderer.stats().frames;
        const t0 = performance.now();
        const tick = () => (g.renderer.stats().frames - f0 >= k || performance.now() - t0 > 120_000 ? res(true) : setTimeout(tick, 30));
        tick();
      }),
    n,
  );
/** Long enough for the 0.25 s fade to finish whatever the software frame rate. */
const settle = async (page) => {
  const t0 = Date.now();
  await waitFrames(page, 4);
  await page.waitForTimeout(Math.max(0, 1200 - (Date.now() - t0)));
  await waitFrames(page, 4);
};
const near = (a, b) => Math.abs(a - b) < 0.02;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const dist = path.resolve(opt('dist', path.join(tmpdir(), 'al-roofs-dist')));
  await ensureBuild({ root: ROOT, distDir: dist, mode: argv.includes('--no-build') ? 'never' : 'auto', log });
  const server = await startPreview({ root: ROOT, distDir: dist, log });
  const browser = await chromium.launch(LAUNCH);
  const errors = [];
  let shot = 0;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text().slice(0, 240)}`));
    const snap = async (name) => {
      await waitFrames(page, 2);
      await page.screenshot({ path: path.join(OUT, `${String(++shot).padStart(2, '0')}-${name}.png`) });
    };

    await page.goto(server.url);
    await waitFor(page, screenIs, 'menu');
    await page.evaluate(() => {
      const g = window.__afterlife.game;
      g.beginNewGame();
      return g.startGame();
    });
    await waitFor(page, screenIs, 'game');
    await waitFor(page, () => {
      const g = window.__afterlife.game;
      return !!g.selectedAgentId && g.sim.state.agents[g.selectedAgentId].presence === 'onLot' && g.renderer.stats().agents > 0 && !g.saving;
    });
    await page.evaluate(() => {
      const g = window.__afterlife.game;
      if (g.dialog) g.closeDialog();
      g.setSpeed(1);
    });
    await settle(page);

    await page.evaluate(() => window.__afterlife.game.setSpeed(0));
    await settle(page);
    // where is the selected zombie: indoors (which building) or outside?
    const where = await page.evaluate(() => {
      const g = window.__afterlife.game;
      const a = g.sim.state.agents[g.selectedAgentId];
      return { x: a.pos.x, z: a.pos.z, room: g.sim.spatial.roomAt(a.pos.x, a.pos.z) };
    });
    log(`    selected zombie at (${where.x.toFixed(1)}, ${where.z.toFixed(1)}), room ${where.room}`);

    const s0 = await page.evaluate(roofState);
    check('the roof layer exists in the scene', !s0.missing);
    const ids = Object.keys(s0.buildings);
    check('the starting lot has at least one building with a roof and a ceiling mesh', ids.length >= 1, `${ids.length} building(s)`);
    log(`    draw calls from roofs, overview: ${s0.drawn}; triangles per building: ${ids.map((i) => s0.buildings[i].tris).join(', ')}`);

    // ── 1. overview, live ──
    await snap('overview');
    if (where.room > 0) {
      const mine = ids.filter((i) => near(s0.buildings[i].roof, 0));
      check('overview: the roof of the building the zombie is in has faded out', mine.length === 1, s0.buildings);
      check('overview: no ceiling is drawn from above', ids.every((i) => near(s0.buildings[i].ceiling, 0)));
      check('overview: every OTHER building keeps its roof', ids.filter((i) => !mine.includes(i)).every((i) => near(s0.buildings[i].roof, 1)));
    } else {
      check('overview: the zombie is outdoors, so nobody is inside and every roof on the lot (the household home) is hidden', ids.every((i) => near(s0.buildings[i].roof, 0)));
    }

    // ── 2. wall mode down ──
    for (const wm of ['down', 'up', 'cutaway']) {
      await page.evaluate((m) => window.__afterlife.game.setWallMode(m), wm);
      await settle(page);
      const s = await page.evaluate(roofState);
      check(`wall mode ${wm}: same roof rule (ceilings stay hidden from above)`, ids.every((i) => near(s.buildings[i].ceiling, 0)), s.buildings);
      if (wm === 'down') await snap('wallmode-down');
    }

    // ── 3. shoulder ──
    await page.click('[data-testid="perspective"]');
    await waitFor(page, () => window.__afterlife.game.perspective === 'shoulder', null, 60_000);
    await settle(page);
    const s1 = await page.evaluate(roofState);
    check('shoulder: no ceiling drawn', ids.every((i) => near(s1.buildings[i].ceiling, 0)), s1.buildings);
    await snap('shoulder');

    // ── 4. first person ──
    await page.keyboard.press('KeyV');
    await waitFor(page, () => window.__afterlife.game.perspective === 'firstPerson', null, 60_000);
    await settle(page);
    const s2 = await page.evaluate(roofState);
    if (where.room > 0) {
      const ceil = ids.filter((i) => near(s2.buildings[i].ceiling, 1));
      check('first person: exactly one ceiling (the zombie\'s building) is drawn', ceil.length === 1, s2.buildings);
    } else {
      check('first person outdoors: no ceiling', ids.every((i) => near(s2.buildings[i].ceiling, 0)));
    }
    check('first person: roofs stay (seen from outside)', ids.every((i) => near(s2.buildings[i].roof, 1)), s2.buildings);
    log(`    draw calls from roofs, first person: ${s2.drawn}`);
    await snap('first-person');

    // ── 5. back to overview ──
    await page.evaluate(() => window.__afterlife.game.setPerspective('overview'));
    await waitFor(page, () => window.__afterlife.game.perspective === 'overview', null, 60_000);
    await settle(page);

    // ── 5b. put the zombie INSIDE the building (the sim's own room grid picks the tile) and run the same views ──
    const moved = await page.evaluate(() => {
      const g = window.__afterlife.game;
      g.setSpeed(0); // paused: the zombie must stay where it is put while the views are checked
      const lot = g.sim.state.lot;
      for (let z = 0; z < lot.depth; z++)
        for (let x = 0; x < lot.width; x++) {
          if (g.sim.spatial.roomAt(x + 0.5, z + 0.5) > 0) {
            const a = g.sim.state.agents[g.selectedAgentId];
            a.pos = { x: x + 0.5, z: z + 0.5 };
            return { x: x + 0.5, z: z + 0.5 };
          }
        }
      return null;
    });
    check('the lot has an enclosed room to stand in', !!moved, moved);
    if (moved) {
      await waitFor(page, (m) => {
        const g = window.__afterlife.game;
        const a = g.sim.state.agents[g.selectedAgentId];
        return Math.abs(a.pos.x - m.x) < 3 && Math.abs(a.pos.z - m.z) < 3;
      }, moved, 30_000).catch(() => undefined);
      await settle(page);
      const i0 = await page.evaluate(roofState);
      const mine = ids.filter((i) => near(i0.buildings[i].roof, 0));
      check('INDOORS overview: the roof of the building the zombie is in has faded out', mine.length === 1, i0.buildings);
      check('INDOORS overview: no ceiling from above', ids.every((i) => near(i0.buildings[i].ceiling, 0)));
      log(`    draw calls from roofs, indoors overview: ${i0.drawn}`);
      await snap('indoors-overview');
      await page.click('[data-testid="perspective"]');
      await waitFor(page, () => window.__afterlife.game.perspective === 'shoulder', null, 60_000);
      await settle(page);
      const i1 = await page.evaluate(roofState);
      check('INDOORS shoulder: roof out, the ceiling of the room is drawn (rule 3)', ids.filter((i) => near(i1.buildings[i].roof, 0)).length === 1 && ids.filter((i) => near(i1.buildings[i].ceiling, 1)).length === 1, i1.buildings);
      await snap('indoors-shoulder');
      await page.keyboard.press('KeyV');
      await waitFor(page, () => window.__afterlife.game.perspective === 'firstPerson', null, 60_000);
      await settle(page);
      const i2 = await page.evaluate(roofState);
      check('INDOORS first person: the ceiling of this building is drawn, and its roof stays', ids.filter((i) => near(i2.buildings[i].ceiling, 1)).length === 1 && ids.every((i) => near(i2.buildings[i].roof, 1)), i2.buildings);
      log(`    draw calls from roofs, indoors first person: ${i2.drawn}`);
      await snap('indoors-first-person');
      await page.evaluate(() => window.__afterlife.game.setPerspective('overview'));
      await waitFor(page, () => window.__afterlife.game.perspective === 'overview', null, 60_000);
      await settle(page);
    }

    // ── 6. Buy and Build hide everything, live brings roofs back ──
    for (const mode of ['buy', 'build']) {
      await page.evaluate((m) => window.__afterlife.game.setMode(m), mode);
      await settle(page);
      const s = await page.evaluate(roofState);
      check(`${mode} mode: every roof and ceiling is hidden and costs no draw call`, ids.every((i) => near(s.buildings[i].roof, 0) && near(s.buildings[i].ceiling, 0)) && s.drawn === 0, { drawn: s.drawn });
      await snap(`${mode}-mode`);
    }
    await page.evaluate(() => window.__afterlife.game.setMode('live'));
    await settle(page);
    const s3 = await page.evaluate(roofState);
    check('back in live mode the roofs fade in again (the zombie\'s own stays out)', ids.filter((i) => near(s3.buildings[i].roof, 1)).length === (where.room > 0 || moved ? ids.length - 1 : ids.length), s3.buildings);

    // ── 7. churn: no error through 40 random changes ──
    await page.evaluate(() => {
      const g = window.__afterlife.game;
      let seed = 7;
      const rnd = (n) => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % n);
      for (let i = 0; i < 40; i++) {
        const k = rnd(3);
        if (k === 0) g.setMode(['live', 'buy', 'build'][rnd(3)]);
        else if (k === 1) g.setWallMode(['up', 'cutaway', 'down'][rnd(3)]);
        else g.renderer.stats();
      }
    });
    await waitFrames(page, 10);
    const sEnd = await page.evaluate(roofState);
    check('after churn the layer is still there and the game is not in a fatal state', !sEnd.missing && !(await page.evaluate(() => window.__afterlife.game.fatalError)));
    check('no page error, no console error', errors.length === 0, errors.slice(0, 5));
  } finally {
    await browser.close();
    await Promise.race([server.stop().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
  }
  const failed = checks.filter((c) => !c.ok);
  log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
