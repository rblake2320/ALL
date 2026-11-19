/**
 * RENDER real-game visual QA (Playwright + SwiftShader WebGL2) against a BUILT game (vite build + vite preview):
 * boot → menu → New Game → Create-a-Zombie (turntable) → Start → game, then captures the renderer in the states the
 * player sees: starter house day / night / full moon, wall modes, zombies mid-activity (close-up), buy mode with the
 * real catalog thumbnails + a valid and an invalid placement ghost, build mode wall drag, and renderer stats per shot.
 *
 *   npx vite build --outDir <dist> && npx vite preview --outDir <dist> --port 4185 --strictPort &
 *   node dev/render.game.cjs <outDir> http://localhost:4185/ [quality=high] [shots=a,b,c]
 *
 * Writes <outDir>/<shot>.png + <outDir>/stats.json + <outDir>/log.txt. SwiftShader renders on the CPU: a full run
 * takes several minutes at 'high'.
 */
const fs = require('fs');
const path = require('path');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node-tools/node_modules/playwright'));
}

const out = path.resolve(process.argv[2] || path.join(__dirname, 'out', 'render', 'game'));
const url = process.argv[3] || 'http://localhost:4185/';
const quality = process.argv[4] || 'high';
const only = process.argv[5] ? new Set(process.argv[5].split(',')) : null;
const VIEW = { width: 1280, height: 720 };

fs.mkdirSync(out, { recursive: true });
const log = [];
const stats = {};
const note = (s) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${s}`;
  log.push(line);
  console.log(line);
  fs.writeFileSync(path.join(out, 'log.txt'), log.join('\n') + '\n');
};

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(240000);
  const consoleLines = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') consoleLines.push(`[${m.type()}] ${m.text().slice(0, 500)}`);
  });
  page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));
  const t0 = Date.now();
  const game = (fn, arg) => page.evaluate(fn, arg);
  const state = () => game(() => {
    const g = window.__afterlife && window.__afterlife.game;
    return g ? { screen: g.screen, fatal: g.fatalError, progress: g.loadingProgress } : null;
  });
  const waitFor = async (pred, ms, what) => {
    const end = Date.now() + ms;
    for (;;) {
      const s = await state().catch(() => null);
      if (s && pred(s)) return s;
      if (Date.now() > end) throw new Error(`timeout waiting for ${what}: ${JSON.stringify(s)}`);
      await page.waitForTimeout(300);
    }
  };
  const rstats = () => game(() => {
    const r = window.__afterlife.game.renderer;
    return typeof r.stats === 'function' ? r.stats() : null;
  });
  /** Wait until the renderer has produced at least n more frames (SwiftShader: frames are slow and irregular). */
  const frames = async (n, maxMs = 120000) => {
    const start = await game(() => window.__afterlife.game.renderer.__frames || 0);
    const end = Date.now() + maxMs;
    while (Date.now() < end) {
      const f = await game(() => window.__afterlife.game.renderer.__frames || 0);
      if (f - start >= n) return;
      await page.waitForTimeout(200);
    }
  };
  const want = (name) => !only || only.has(name);
  const shot = async (name, settleFrames = 4) => {
    if (!want(name)) return;
    await frames(settleFrames);
    const ts = Date.now();
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    const s = await rstats();
    stats[name] = s;
    fs.writeFileSync(path.join(out, 'stats.json'), JSON.stringify(stats, null, 1));
    note(`shot ${name} (${((Date.now() - ts) / 1000).toFixed(1)}s) draws=${s && s.drawCalls} tris=${s && s.triangles} geo=${s && s.geometries} tex=${s && s.textures} fps=${s && s.fps && s.fps.toFixed(1)}`);
  };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    // frame counter hook (debug only): wraps renderer.frame once the controller exists
    await page.waitForFunction(() => !!(window.__afterlife && window.__afterlife.game), null, { timeout: 120000 });
    await game(() => {
      const r = window.__afterlife.game.renderer;
      if (r.__wrapped) return;
      const f = r.frame.bind(r);
      r.__frames = 0;
      r.frame = (a, dt) => {
        r.__frames++;
        f(a, dt);
      };
      r.__wrapped = true;
    });
    await waitFor((s) => s.screen === 'menu' || s.fatal, 300000, 'menu');
    note(`menu after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    await game((q) => window.__afterlife.game.updateSettings({ quality: q, pixelRatio: 1, tutorialEnabled: false, autoPauseOnEvents: false }), quality);
    await page.waitForTimeout(1500);
    await shot('menu', 6);
    await game(() => window.__afterlife.game.goto('newGame'));
    await page.waitForTimeout(800);
    await game(() => window.__afterlife.game.beginNewGame());
    await game(() => window.__afterlife.game.addCazMember());
    // the turntable canvas mounts with the CAZ screen; give the preview renderer a few frames after that
    await waitFor((s) => s.screen === 'caz' || s.fatal, 120000, 'caz screen');
    await page.waitForFunction(() => !!document.querySelector('.sh-stage__gl'), null, { timeout: 120000 }).catch(() => note('no CAZ stage canvas'));
    await page.waitForTimeout(6000);
    if (want('caz')) {
      await page.screenshot({ path: path.join(out, 'caz.png') });
      note('shot caz');
    }
    if (only && only.size === 1 && only.has('caz')) throw new Error('done (caz only)');
    await game(() => window.__afterlife.game.startGame());
    await waitFor((s) => s.screen === 'game' || s.fatal, 180000, 'game');
    note(`game after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    // let autonomy start: a few seconds at 3×, then 1×
    await game(() => window.__afterlife.game.setSpeed(3));
    await page.waitForTimeout(6000);
    await game(() => window.__afterlife.game.setSpeed(1));
    await game(() => window.__afterlife.game.setWallMode('cutaway'));
    await game(() => window.__afterlife.game.renderer.debugTime(12 * 60 + 30, 0));
    await shot('day-cutaway', 6);
    await game(() => window.__afterlife.game.setWallMode('up'));
    await shot('day-walls-up', 6);
    await game(() => window.__afterlife.game.setWallMode('down'));
    await shot('day-walls-down', 6);
    await game(() => window.__afterlife.game.setWallMode('cutaway'));
    for (const r of [1, 2, 3]) {
      await game(() => window.__afterlife.game.rotateCamera(1));
      await shot(`day-rot${r}`, 8);
    }
    await game(() => {
      const g = window.__afterlife.game;
      g.rotateCamera(1);
    });
    await game(() => window.__afterlife.game.renderer.debugTime(18 * 60 + 50, 0));
    await shot('dusk', 6);
    await game(() => window.__afterlife.game.renderer.debugTime(23 * 60, 0));
    await shot('night', 6);
    await game(() => window.__afterlife.game.renderer.debugTime(23 * 60, 1));
    await shot('fullmoon', 6);
    // carpool hearse idling at the curb by the first entry point (decision #10 / #14g), at dusk with headlamps
    if (want('carpool')) {
      await game(() => {
        const g = window.__afterlife.game;
        const st = g.sim.state;
        st.flags['people:carpool:until'] = st.tick + 100000;
        const e = st.lot.entryPoints[0];
        g.renderer.setCamera({ target: { x: e.x + 3, z: st.lot.depth - 1 }, distance: 14, pitch: 0.55, yaw: 0.5 }, true);
      });
      await page.waitForTimeout(6000);
      await shot('carpool', 8);
      await game(() => {
        const st = window.__afterlife.game.sim.state;
        delete st.flags['people:carpool:until'];
      });
    }
    await game(() => window.__afterlife.game.renderer.debugTime(12 * 60 + 30, 0));
    // zombies mid-activity: select the first member and frame them close
    const sel = await game(() => {
      const g = window.__afterlife.game;
      const ids = g.sim.state.household.memberIds;
      const id = ids[0];
      g.selectAgent(id, true);
      const a = g.sim.state.agents[id];
      return { id, anim: a.anim, pos: a.pos, interaction: a.active && a.active.interactionId };
    });
    note(`selected ${JSON.stringify(sel)}`);
    await game(() => window.__afterlife.game.renderer.setCamera({ distance: 9, pitch: 0.62 }));
    await page.waitForTimeout(2500);
    await shot('zombie-closeup', 10);
    await game(() => window.__afterlife.game.renderer.setCamera({ distance: 24, pitch: 0.8 }));
    // buy mode: catalog with real thumbnails + ghosts
    await game(() => window.__afterlife.game.setMode('buy'));
    await page.waitForTimeout(1000);
    // wait for thumbnails to land in the catalog
    const thumbsEnd = Date.now() + 120000;
    let thumbInfo = null;
    while (Date.now() < thumbsEnd) {
      thumbInfo = await game(() => {
        const imgs = [...document.querySelectorAll('img')].filter((i) => i.src.startsWith('data:image'));
        return { n: imgs.length, pending: window.__afterlife.game.renderer.stats ? window.__afterlife.game.renderer.stats().thumbnailsPending : -1 };
      });
      if (thumbInfo.n >= 8 && thumbInfo.pending === 0) break;
      await page.waitForTimeout(1000);
    }
    note(`catalog thumbnails ${JSON.stringify(thumbInfo)}`);
    // a valid spot: try indoor floor tiles (largest room first) until the controller's ghost reports valid
    await game(() => window.__afterlife.game.startPlacing('chair_creaky'));
    const candidates = await game(() => {
      const g = window.__afterlife.game;
      const sp = g.sim.spatial;
      const w = sp.width();
      const rooms = sp.rooms().filter((r) => r.indoor).sort((a, b) => b.tiles.length - a.tiles.length);
      const out = [];
      for (const room of rooms) for (const idx of room.tiles) out.push([idx % w, Math.floor(idx / w)]);
      return out;
    });
    let placedValid = false;
    for (let i = 0; i < candidates.length && i < 60 && !placedValid; i += 3) {
      const [x, z] = candidates[i];
      await game(([x, z]) => window.__afterlife.game.renderer.focus({ x: x + 0.5, z: z + 0.5 }, true), [x, z]);
      const p = await game(([x, z]) => window.__afterlife.game.renderer.worldToScreen(x + 0.5, 0, z + 0.5), [x, z]);
      await page.mouse.move(p.x - 2, p.y - 2);
      await page.mouse.move(p.x, p.y);
      await page.waitForTimeout(250);
      placedValid = await game(() => {
        const gh = window.__afterlife.game.renderer.ghost;
        return !!(gh && gh.ghost && gh.ghost.valid !== false);
      });
    }
    note(`valid ghost found: ${placedValid}`);
    if (placedValid) {
      await game(() => window.__afterlife.game.renderer.setCamera({ distance: 12, pitch: 0.75 }));
      await page.waitForTimeout(800);
      await shot('buy-ghost-valid', 6);
    }
    // an invalid spot: right on top of an existing object
    const busy = await game(() => {
      const g = window.__afterlife.game;
      const objs = Object.values(g.sim.state.objects).filter((o) => o.placement && o.placement.kind === 'floor');
      const o = objs[Math.floor(objs.length / 2)];
      return o ? [o.placement.x, o.placement.z] : null;
    });
    if (busy) {
      const [x, z] = busy;
      await game(([x, z]) => window.__afterlife.game.renderer.focus({ x: x + 0.5, z: z + 0.5 }, true), [x, z]);
      const p = await game(([x, z]) => window.__afterlife.game.renderer.worldToScreen(x + 0.5, 0, z + 0.5), [x, z]);
      await page.mouse.move(p.x - 2, p.y - 2);
      await page.mouse.move(p.x, p.y);
      await page.waitForTimeout(600);
      await shot('buy-ghost-invalid', 6);
    }
    await game(() => window.__afterlife.game.cancelPlacement());
    // build mode: wall drag preview over the lawn
    await game(() => window.__afterlife.game.setMode('build'));
    await game(() => window.__afterlife.game.setBuildTool({ kind: 'wall', style: 'plaster' }));
    const lawn = await game(() => {
      const g = window.__afterlife.game;
      const lot = g.sim.state.lot;
      // an empty outdoor run 4 tiles long near the front of the lot
      const z = Math.min(lot.sidewalkZ - 3, lot.depth - 4);
      return { x0: 3, x1: 7, z };
    });
    await game((l) => window.__afterlife.game.renderer.focus({ x: (l.x0 + l.x1) / 2, z: l.z }, true), lawn);
    await page.waitForTimeout(500);
    const a = await game((l) => window.__afterlife.game.renderer.worldToScreen(l.x0, 0, l.z), lawn);
    const b = await game((l) => window.__afterlife.game.renderer.worldToScreen(l.x1, 0, l.z), lawn);
    await page.mouse.move(a.x, a.y);
    await page.waitForTimeout(300);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(a.x + ((b.x - a.x) * i) / 6, a.y + ((b.y - a.y) * i) / 6);
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(600);
    await shot('build-wall-drag', 6);
    await page.mouse.up();
    await page.waitForTimeout(800);
    await shot('build-wall-placed', 6);
    await game(() => window.__afterlife.game.undo());
    await game(() => window.__afterlife.game.setMode('live'));
    await page.waitForTimeout(800);
    const fin = await rstats();
    stats.final = fin;
    note(`final stats ${JSON.stringify(fin)}`);
  } catch (e) {
    note(`FAILURE: ${e.message}`);
    await page.screenshot({ path: path.join(out, '99-failure.png') }).catch(() => {});
  }
  fs.writeFileSync(path.join(out, 'stats.json'), JSON.stringify(stats, null, 1));
  fs.writeFileSync(path.join(out, 'console.txt'), consoleLines.join('\n') + '\n');
  note(`console errors/warnings: ${consoleLines.length}`);
  for (const l of consoleLines.slice(0, 30)) console.log(l);
  await browser.close();
})();
