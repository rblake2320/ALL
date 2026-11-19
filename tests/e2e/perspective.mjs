/**
 * Perspectives in the real browser (W-136, docs/DESIGN_OPEN_WORLD.md §4.1; acceptance OW-1..OW-5).
 *
 *   node tests/e2e/perspective.mjs [--dist=<dir>] [--no-build] [--out=dev/out/perspective] [--gpu]
 *
 * One new game (the default story start), then the player's path with the real HUD button, the real `V` / `Esc`
 * keys and a real mouse drag:
 *
 *   overview → shoulder (button) → walk (the camera stays on the zombie) → first person (V) → look around (drag)
 *   → Esc (overview, not the pause menu) → the overview camera is exactly where the player left it
 *   → Buy mode ends a close view and disables the button → the view follows the selection → Reduce motion cuts
 *   → 40 random perspective / mode / selection changes never leave the game without a valid camera
 *   → axe on the top bar in each view, no page error, no console error, no fatal screen.
 *
 * The camera is read from `renderer.stats()` (viewPose, perspective, perspectiveBodyHidden, drawnWallMode) and from
 * the scene itself (the zombie's rig `visible`). Screenshots of each view go to <out>/ for the PR.
 * Software rendering here says nothing about frame time (OW-18 is measured on named hardware by the desktop team).
 * Exit 0 = pass, 1 = fail.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const OUT = path.resolve(ROOT, opt('out', 'dev/out/perspective'));
const GPU = argv.includes('--gpu');
const LAUNCH = { headless: true, args: GPU ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
const log = (s) => console.log(s);
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
};

// Limits copied from src/render/camera/perspective.ts (PERSPECTIVE_LIMITS); a change there must be made here too.
const LIM = { eyeY: 1.55, forward: 0.12, shoulderMax: 6, shoulderPivotY: 1.3, shoulderSide: 0.4, fovShoulder: 50, fovFirst: 68, fovOverview: 32 };

function loadAxe() {
  const candidates = [process.env.AXE_CORE];
  try {
    candidates.push(require.resolve('axe-core/axe.min.js'));
  } catch {
    /* not installed */
  }
  for (const c of candidates) if (c && existsSync(c)) return { path: c, source: readFileSync(c, 'utf8') };
  return null;
}

// ── in-page ──
const screenIs = (sc) => {
  const g = window.__afterlife && window.__afterlife.game;
  return !!g && (g.screen === sc || !!g.fatalError);
};
/** Everything a check needs, read in one task. */
const probe = () => {
  const g = window.__afterlife.game;
  const st = g.renderer.stats();
  const id = g.selectedAgentId;
  const a = id && g.sim ? g.sim.state.agents[id] : null;
  // the rendered rig of the selected zombie (the scene names agent roots by id)
  let rig = null;
  const scene = g.renderer.scene && g.renderer.scene();
  const agents = scene && scene.getObjectByName('agents');
  if (agents && id) for (const c of agents.children) if (c.userData && c.userData.agentId === id) rig = { x: c.position.x, y: c.position.y, z: c.position.z, visible: c.visible };
  const btn = document.querySelector('[data-testid="perspective"]');
  const live = document.querySelector('[data-testid="perspective-live"]');
  return {
    perspective: g.perspective,
    stats: { perspective: st.perspective, agent: st.perspectiveAgent, hidden: st.perspectiveBodyHidden, walls: st.drawnWallMode, pose: st.viewPose, frames: st.frames },
    wallMode: g.wallMode,
    mode: g.mode,
    dialog: g.dialog,
    selected: id,
    presence: a ? a.presence : null,
    simPos: a ? { x: a.pos.x, z: a.pos.z } : null,
    rig,
    cam: g.renderer.getCamera(),
    fatal: g.fatalError,
    button: btn
      ? { name: btn.getAttribute('aria-label'), pressed: btn.getAttribute('aria-pressed'), disabled: btn.disabled, view: btn.getAttribute('data-perspective'), w: btn.getBoundingClientRect().width, h: btn.getBoundingClientRect().height }
      : null,
    live: live ? live.textContent : null,
  };
};

async function waitFor(page, what, fn, arg, timeout = 600_000) {
  try {
    await page.waitForFunction(fn, arg, { polling: 100, timeout });
  } catch {
    const s = await page.evaluate(probe).catch(() => null);
    throw new Error(`timed out waiting for ${what}: ${JSON.stringify(s)}`);
  }
}
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
const view = (page, p) => waitFor(page, `perspective ${p}`, (want) => window.__afterlife.game.perspective === want && window.__afterlife.game.renderer.stats().perspective === want, p, 60_000);
/** The glide is over when two samples a few frames apart give the same camera relative to the zombie. */
async function settled(page) {
  let last = '';
  for (let i = 0; i < 60; i++) {
    await waitFrames(page, 3);
    const p = await page.evaluate(probe);
    const o = p.rig ?? { x: 0, y: 0, z: 0 };
    const key = [p.stats.pose.x - o.x, p.stats.pose.y - o.y, p.stats.pose.z - o.z, p.stats.pose.fovDeg].map((v) => v.toFixed(3)).join(',');
    if (key === last) return p;
    last = key;
  }
  return page.evaluate(probe);
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const camKey = (c) => [c.target.x, c.target.z, c.yaw, c.pitch, c.distance].map((v) => v.toFixed(6)).join(' ');

async function main() {
  mkdirSync(OUT, { recursive: true });
  const dist = path.resolve(opt('dist', path.join(tmpdir(), 'al-perspective-dist')));
  await ensureBuild({ root: ROOT, distDir: dist, mode: argv.includes('--no-build') ? 'never' : 'auto', log });
  const server = await startPreview({ root: ROOT, distDir: dist, log });
  const browser = await chromium.launch(LAUNCH);
  const errors = [];
  const axe = loadAxe();
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
    const runAxe = async (label) => {
      if (!axe) return log(`    (axe-core not available: ${label} scan not run)`);
      const res = await page.evaluate(
        async (src) => {
          if (!window.axe) (0, eval)(src);
          const r = await window.axe.run(document.querySelector('.hud-right') ?? document, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
            rules: { 'color-contrast': { enabled: false } }, // the backdrop is WebGL
          });
          return r.violations.map((v) => ({ id: v.id, n: v.nodes.length, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
        },
        axe.source,
      );
      check(`axe (${label}): no violations in the top-bar tools`, res.length === 0, res.length ? res : '');
    };

    await page.goto(server.url);
    await waitFor(page, 'menu', screenIs, 'menu');
    await page.evaluate(() => {
      const g = window.__afterlife.game;
      g.beginNewGame();
      return g.startGame();
    });
    await waitFor(page, 'game', screenIs, 'game');
    await waitFor(page, 'a selected zombie that is drawn', () => {
      const g = window.__afterlife.game;
      return !!g.selectedAgentId && g.sim.state.agents[g.selectedAgentId].presence === 'onLot' && g.renderer.stats().agents > 0 && !g.saving;
    });
    // the intro may hold a hint / story dialog: close anything modal so the keys reach the game
    await page.evaluate(() => {
      const g = window.__afterlife.game;
      if (g.dialog) g.closeDialog();
      g.setSpeed(1);
    });
    await waitFrames(page, 10);

    // ── 1. overview is the start, and is untouched ──
    const p0 = await page.evaluate(probe);
    check('a new game starts in the overview', p0.perspective === 'overview' && p0.stats.perspective === 'overview' && near(p0.stats.pose.fovDeg, LIM.fovOverview, 1e-6), `fov ${p0.stats.pose.fovDeg}`);
    check('the view button is there, named with the current view, not pressed', !!p0.button && p0.button.name === 'View: Overview' && p0.button.pressed === 'false' && !p0.button.disabled, p0.button);
    check('the live region exists and is silent before any change', p0.live === '', JSON.stringify(p0.live));
    const cam0 = p0.cam;
    await snap('overview');
    await runAxe('overview');

    // ── 2. shoulder, by the real button ──
    await page.click('[data-testid="perspective"]');
    await view(page, 'shoulder');
    const p1 = await settled(page);
    check('button → over the shoulder, attached to the selected zombie', p1.stats.agent === p1.selected && p1.button.view === 'shoulder' && p1.button.pressed === 'true', p1.button);
    check('the change is announced', p1.live === 'View: Over the shoulder' && p1.button.name === 'View: Over the shoulder', JSON.stringify(p1.live));
    const pivotDist = (p) => Math.hypot(p.stats.pose.x - p.rig.x, p.stats.pose.y - (p.rig.y + LIM.shoulderPivotY), p.stats.pose.z - p.rig.z);
    check('shoulder: the camera is behind and above the zombie, within reach of it', !!p1.rig && pivotDist(p1) <= LIM.shoulderMax + LIM.shoulderSide + 0.01 && p1.stats.pose.y > p1.rig.y + 1, p1.rig ? `${pivotDist(p1).toFixed(2)} tiles from the pivot, camera y ${p1.stats.pose.y.toFixed(2)}` : 'no rig');
    check('shoulder: wider lens than the overview, the body stays visible, the wall view is the player’s', near(p1.stats.pose.fovDeg, LIM.fovShoulder, 1e-6) && p1.rig.visible === true && !p1.stats.hidden && p1.stats.walls === p1.wallMode, `fov ${p1.stats.pose.fovDeg}, walls ${p1.stats.walls}`);
    check('shoulder: the overview camera state was not written', camKey(p1.cam) === camKey(cam0), `${camKey(p1.cam)} vs ${camKey(cam0)}`);
    await snap('shoulder');
    await runAxe('shoulder');

    // ── 3. the view follows the zombie on a walk (OW-3) ──
    const walk = await page.evaluate(() => {
      const g = window.__afterlife.game;
      const st = g.sim.state;
      const a = st.agents[g.selectedAgentId];
      // a tile a good way off, on the lot
      const tx = Math.max(2, Math.min(st.lot.width - 3, Math.round(a.pos.x) + (a.pos.x > st.lot.width / 2 ? -6 : 6)));
      const tz = Math.max(2, Math.min(st.lot.depth - 3, Math.round(a.pos.z) + (a.pos.z > st.lot.depth / 2 ? -5 : 5)));
      g.openMenuFor({ kind: 'tile', x: tx, z: tz }, 300, 300);
      const e = g.menu && g.menu.entries.find((m) => m.interactionId === 'engine_goHere');
      if (e) g.chooseMenuEntry(e);
      else g.closeMenu();
      g.setSpeed(2);
      return { ok: !!e, from: { x: a.pos.x, z: a.pos.z }, to: { x: tx, z: tz } };
    });
    check('a walk was ordered (Go Here)', walk.ok, walk);
    let worst = 0;
    let worstSim = 0;
    let worstAt = null;
    let moved = 0;
    let samples = 0;
    let start = null;
    for (let i = 0; i < 40; i++) {
      await waitFrames(page, 2);
      const p = await page.evaluate(probe);
      if (!p.rig || p.perspective !== 'shoulder') break;
      start ??= p.rig;
      moved = Math.max(moved, Math.hypot(p.rig.x - start.x, p.rig.z - start.z));
      const d = pivotDist(p);
      if (d > worst) {
        worst = d;
        worstAt = { rig: p.rig, sim: p.simPos, cam: p.stats.pose };
      }
      // independent of the renderer's own idea of where the body is: the camera against the SIM position
      // (one tick of interpolation + the seat / lying fit may separate the two by a tile or so)
      worstSim = Math.max(worstSim, Math.hypot(p.stats.pose.x - p.simPos.x, p.stats.pose.z - p.simPos.z));
      samples++;
    }
    check('shoulder: the camera stays its distance from the drawn zombie for the whole walk', samples >= 30 && worst <= LIM.shoulderMax + LIM.shoulderSide + 0.01, `${samples} samples, worst ${worst.toFixed(2)} tiles, zombie moved ${moved.toFixed(2)} tiles${worst > 4 ? ` at ${JSON.stringify(worstAt)}` : ''}`);
    check('shoulder: and within reach of where the sim says the zombie is', worstSim <= LIM.shoulderMax + LIM.shoulderSide + 1.5, `worst ${worstSim.toFixed(2)} tiles (flat)`);
    check('the zombie really walked while it was watched', moved > 1, `${moved.toFixed(2)} tiles`);

    // ── 4. first person, by the real key ──
    await page.locator('canvas').first().focus().catch(() => {});
    await page.keyboard.press('KeyV');
    await view(page, 'firstPerson');
    const p2 = await settled(page);
    const eye = Math.hypot(p2.stats.pose.x - p2.rig.x, p2.stats.pose.z - p2.rig.z);
    check('V → first person: the camera is at the zombie’s eyes', near(eye, LIM.forward, 0.02) && near(p2.stats.pose.y - p2.rig.y, LIM.eyeY, 0.02), `${eye.toFixed(3)} tiles from the body axis, ${(p2.stats.pose.y - p2.rig.y).toFixed(3)} above the feet`);
    check('first person: the zombie’s own body is not drawn', p2.stats.hidden === true && p2.rig.visible === false, `hidden ${p2.stats.hidden}, rig.visible ${p2.rig.visible}`);
    check('first person: every wall is drawn up, and the player’s wall view is unchanged', p2.stats.walls === 'up' && p2.wallMode === p0.wallMode, `drawn ${p2.stats.walls}, setting ${p2.wallMode}`);
    check('first person: wide lens, announced', near(p2.stats.pose.fovDeg, LIM.fovFirst, 1e-6) && p2.live === 'View: First person', `fov ${p2.stats.pose.fovDeg}, "${p2.live}"`);
    await snap('first-person');
    await runAxe('first person');

    // ── 5. look around with a real drag ──
    const dir = (p) => Math.atan2(p.stats.pose.lx - p.stats.pose.x, p.stats.pose.lz - p.stats.pose.z);
    const d0 = dir(p2);
    await page.mouse.move(640, 400);
    await page.mouse.down({ button: 'right' });
    for (let i = 1; i <= 10; i++) await page.mouse.move(640 + i * 20, 400, { steps: 2 });
    await page.mouse.up({ button: 'right' });
    const p3 = await settled(page);
    let turned = dir(p3) - d0;
    while (turned > Math.PI) turned -= 2 * Math.PI;
    while (turned < -Math.PI) turned += 2 * Math.PI;
    check('a drag turns the view (and the view is still first person, on the same zombie)', Math.abs(turned) > 0.3 && p3.perspective === 'firstPerson' && p3.stats.agent === p2.stats.agent, `${turned.toFixed(2)} rad`);
    check('looking around did not move the overview camera', camKey(p3.cam) === camKey(cam0), camKey(p3.cam));
    await snap('first-person-turned');

    // ── 6. Esc → overview, exactly where the player left it (OW-2) ──
    // Esc closes the innermost layer only (KEYMAP ownership rule): an open tip or tooltip takes the first press.
    let presses = 0;
    let pausedOnTheWay = false;
    for (; presses < 5; ) {
      await page.keyboard.press('Escape');
      presses++;
      await waitFrames(page, 3);
      const p = await page.evaluate(probe);
      if (p.dialog !== null) pausedOnTheWay = true;
      if (p.perspective === 'overview' || pausedOnTheWay) break;
    }
    await view(page, 'overview');
    const p4 = await settled(page);
    check('Esc returns to the overview and does not open the pause menu', !pausedOnTheWay && p4.dialog === null && p4.button.pressed === 'false' && p4.live === 'View: Overview', `${presses} press(es) (open tips close first), dialog ${p4.dialog}, "${p4.live}"`);
    check('the overview camera is exactly where the player left it', camKey(p4.cam) === camKey(cam0) && near(p4.stats.pose.fovDeg, LIM.fovOverview, 1e-6), `${camKey(p4.cam)}`);
    check('back in the overview the body is drawn again and the wall view is the player’s', p4.rig.visible === true && !p4.stats.hidden && p4.stats.walls === p4.wallMode, `visible ${p4.rig.visible}, walls ${p4.stats.walls}`);
    let toPause = 0;
    for (; toPause < 5 && (await page.evaluate(() => window.__afterlife.game.dialog)) !== 'pause'; toPause++) {
      await page.keyboard.press('Escape');
      await waitFrames(page, 3);
    }
    check('from the overview Esc opens the pause menu as before', (await page.evaluate(() => window.__afterlife.game.dialog)) === 'pause', `${toPause} press(es)`);
    await page.evaluate(() => window.__afterlife.game.closeDialog());
    await snap('overview-again');

    // ── 7. Buy mode ends a close view; the button is disabled there ──
    await page.evaluate(() => window.__afterlife.game.setPerspective('firstPerson'));
    await view(page, 'firstPerson');
    await page.keyboard.press('F2');
    await waitFor(page, 'buy mode', () => window.__afterlife.game.mode === 'buy', null, 30_000);
    const p5 = await settled(page);
    check('entering Buy returns to the overview', p5.perspective === 'overview' && p5.stats.perspective === 'overview' && !p5.stats.hidden, p5.perspective);
    check('the view button is disabled in Buy', p5.button.disabled === true, p5.button);
    await page.keyboard.press('KeyV');
    await waitFrames(page, 4);
    check('V does nothing in Buy', (await page.evaluate(probe)).perspective === 'overview');
    await page.keyboard.press('F1');
    await waitFor(page, 'live mode', () => window.__afterlife.game.mode === 'live', null, 30_000);

    // ── 8. Reduce motion: the change cuts ──
    await page.evaluate(() => window.__afterlife.game.updateSettings({ reduceMotion: true }));
    await waitFrames(page, 3);
    await page.evaluate(() => window.__afterlife.game.setPerspective('shoulder'));
    await waitFrames(page, 2);
    const cut = await page.evaluate(probe);
    check('Reduce motion: the lens is the shoulder lens on the next frame (no glide)', cut.stats.perspective === 'shoulder' && near(cut.stats.pose.fovDeg, LIM.fovShoulder, 1e-6), `fov ${cut.stats.pose.fovDeg}`);
    await page.evaluate(() => window.__afterlife.game.updateSettings({ reduceMotion: false }));

    // ── 9. the view follows the selection (when there is someone else at home) ──
    const members = await page.evaluate(() => {
      const g = window.__afterlife.game;
      return g.sim.state.household.memberIds.filter((id) => g.sim.state.agents[id].presence === 'onLot');
    });
    if (members.length > 1) {
      await page.keyboard.press('Tab');
      await waitFrames(page, 4);
      const p6 = await page.evaluate(probe);
      check('Tab moves the close view to the next zombie', p6.perspective === 'shoulder' && p6.stats.agent === p6.selected && p6.selected !== cut.selected, `${cut.selected} → ${p6.selected}`);
    } else log('    (one zombie at home: the selection check is covered by the unit test only)');

    // ── 10. 40 random changes: always a valid camera, never a fatal ──
    const chaos = await page.evaluate(async () => {
      const g = window.__afterlife.game;
      const views = ['overview', 'shoulder', 'firstPerson', 'sideways', null];
      let bad = 0;
      let seed = 7;
      const rnd = (n) => (seed = (seed * 1103515245 + 12345) >>> 0) % n;
      for (let i = 0; i < 40; i++) {
        const k = rnd(6);
        if (k === 0) g.setMode(['live', 'buy', 'build'][rnd(3)]);
        else if (k === 1) g.cycleSelection(1);
        else if (k === 2) g.cyclePerspective();
        else if (k === 3) g.renderer.orbit(rnd(100) - 50, rnd(100) - 50);
        else if (k === 4) g.renderer.zoom(rnd(20) - 10);
        else g.setPerspective(views[rnd(views.length)]);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        const p = g.renderer.stats().viewPose;
        if (!Object.values(p).every(Number.isFinite)) bad++;
        if (g.mode !== 'live' && g.perspective !== 'overview') bad++;
        if (g.perspective !== 'overview' && g.renderer.stats().perspectiveAgent !== g.selectedAgentId) bad++;
      }
      g.setMode('live');
      g.setPerspective('overview');
      return { bad, fatal: g.fatalError };
    });
    check('40 random view / mode / selection changes: the camera is always valid and the rules hold', chaos.bad === 0 && chaos.fatal === null, chaos);
    const end = await settled(page);
    check('after all of it the overview camera state is a valid orbit state', end.perspective === 'overview' && Object.values(end.cam.target).every(Number.isFinite) && Number.isFinite(end.cam.yaw) && Number.isFinite(end.cam.distance), camKey(end.cam));

    // ── 11. phone-size window: the three views are a row of the More menu, each a 44 px target ──
    await page.setViewportSize({ width: 390, height: 844 });
    await waitFrames(page, 6);
    await page.evaluate(() => {
      const g = window.__afterlife.game;
      if (g.dialog) g.closeDialog();
    });
    await page.click('[aria-controls="hud-topbar-overflow"]');
    await page.waitForSelector('[data-testid="perspective-shoulder"]', { timeout: 30_000 });
    const tiles = await page.evaluate(() =>
      ['overview', 'shoulder', 'firstPerson'].map((v) => {
        const el = document.querySelector(`[data-testid="perspective-${v}"]`);
        const r = el.getBoundingClientRect();
        return { v, w: r.width, h: r.height, checked: el.getAttribute('aria-checked'), text: el.textContent.trim() };
      }),
    );
    check('phone (390×844): Overview / Over the shoulder / First person are in the More menu, each at least 44 px', tiles.every((t) => t.w >= 43.5 && t.h >= 43.5) && tiles[0].checked === 'true', tiles);
    await snap('phone-more-menu');
    await page.click('[data-testid="perspective-firstPerson"]');
    await view(page, 'firstPerson');
    const ph = await settled(page);
    check('phone: choosing First person there works and is announced', ph.stats.hidden === true && ph.live === 'View: First person', `"${ph.live}"`);
    await page.keyboard.press('Escape'); // closes the More menu if it is still open
    await snap('phone-first-person');
    await page.evaluate(() => window.__afterlife.game.setPerspective('overview'));

    check('no fatal screen', (await page.evaluate(() => window.__afterlife.game.fatalError)) === null);
  } catch (e) {
    check('the run completed', false, String(e && e.stack ? e.stack : e).slice(0, 1200));
  } finally {
    await Promise.race([browser.close().catch(() => undefined), new Promise((r) => setTimeout(r, 20_000))]);
    await Promise.race([server.stop().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
  }
  check('no page error and no console error', errors.length === 0, errors.slice(0, 6).join(' | '));
  const failed = checks.filter((c) => !c.ok);
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ at: new Date().toISOString(), gpu: GPU, axe: axe ? axe.path : null, checks }, null, 2));
  log(`\n${checks.length - failed.length}/${checks.length} checks passed${axe ? '' : ' (axe-core NOT available: rule scans not run)'}; report + screenshots in ${path.relative(ROOT, OUT)}`);
  process.exit(failed.length ? 1 : 0);
}

main();
