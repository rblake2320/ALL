/**
 * RENDER leak + robustness check in a real browser (Playwright + SwiftShader): ~2 minutes of churn against the
 * harness' fake sim — objects added / moved / re-tinted / dirtied / removed, zombies spawned / despawned / sent to
 * work, placement ghosts and build overlays swapped, hover rims toggled, attach(null)/attach(sim) cycles and a WebGL
 * context loss + restore — while sampling renderer.info.memory. Passes when geometries/textures plateau (no linear
 * growth), return near the baseline after cleanup, frame() never throws, and the page logs no errors.
 *
 *   npx vite --config dev/render.vite.config.ts --port 5174 --strictPort &
 *   node dev/render.leak.cjs [seconds=120] [out.json]
 *   LEAK_WORLD=1 node dev/render.leak.cjs ...   W-025 S5: the same churn on a world with a town, while the camera sweeps
 *                                               east-west across Mildew Lane so region meshes stream in and out
 */
const fs = require('fs');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node-tools/node_modules/playwright'));
}

const seconds = Number(process.argv[2] || 120);
const outFile = process.argv[3] || '';
const base = process.env.RENDER_URL || 'http://127.0.0.1:5174/dev/render.html';
const worldMode = process.env.LEAK_WORLD === '1';

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  // a small viewport keeps SwiftShader frames cheap: this is about bookkeeping, not pixels
  const page = await browser.newPage({ viewport: { width: 480, height: 270 }, deviceScaleFactor: 1 });
  const errors = [];
  const warnings = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 300));
    else if (m.type() === 'warning') warnings.push(m.text().slice(0, 300));
  });
  await page.goto(`${base}?time=19:30&ui=0&quality=high${worldMode ? '&world=1&worldAgents=8' : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__harness && window.__harness.ready, null, { timeout: 600000, polling: 500 });
  const sample = () =>
    page.evaluate(() => {
      const R = window.__harness.renderer;
      const s = R.stats();
      return { t: performance.now(), frames: window.__harness.frames, geometries: s.geometries, textures: s.textures, programs: s.programs, objects: s.objects, agents: s.agents, chunks: s.chunks, particles: s.particles, drawCalls: s.drawCalls, contextLost: s.contextLost, world: s.world ? { built: s.world.built, created: s.world.createdTotal, disposed: s.world.disposedTotal, lod: s.world.lodSwitches } : null };
    });
  // warm up: every model the churn uses gets created (and uploaded) once before the baseline
  await page.evaluate(() => {
    const st = window.__harness.fake.state;
    window.__churn = { base: { objects: Object.keys(st.objects), agents: Object.keys(st.agents) }, n: 0 };
  });
  await page.waitForTimeout(3000);
  const baseline = await sample();
  const samples = [baseline];
  const t0 = Date.now();
  let lostOnce = false;
  let cycles = 0;
  while (Date.now() - t0 < seconds * 1000) {
    const elapsed = (Date.now() - t0) / 1000;
    if (worldMode)
      await page.evaluate((elapsed) => {
        // sweep the focus along Mildew Lane (scene x −110 … 140): regions stream in / out, lots switch LOD
        const R = window.__harness.renderer;
        R.setCamera({ target: { x: 15 + 125 * Math.sin(elapsed / 7), z: 35 }, distance: 40, pitch: 0.6 }, false);
      }, elapsed);
    await page.evaluate((elapsed) => {
      const H = window.__harness;
      const R = H.renderer;
      const sim = H.fake;
      const st = sim.state;
      const C = window.__churn;
      let seed = (C.n = C.n + 1) * 7919;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const defs = ['sofa_velvet', 'chair_creaky', 'lamp_skull', 'tv_crt', 'coffin_pine', 'rug_round', 'table_wake', 'candelabra_drippy', 'plant_deadfern', 'item_dish', 'item_fire', 'stereo_gramophone'];
      const tints = [null, '#2c4a3e', '#6e2a35', '#3b3866'];
      // objects
      for (let i = 0; i < 6; i++) {
        const id = `churn${Math.floor(rnd() * 30)}`;
        const r = rnd();
        if (!st.objects[id] || r < 0.3) {
          st.objects[id] = {
            id,
            defId: defs[Math.floor(rnd() * defs.length)],
            placement: { kind: 'floor', x: 1 + Math.floor(rnd() * 26), z: 18 + Math.floor(rnd() * 8), rot: Math.floor(rnd() * 4) },
            value: 10,
            purchasedTick: st.tick - Math.floor(rnd() * 100),
            tint: tints[Math.floor(rnd() * tints.length)],
            condition: { dirt: rnd(), broken: rnd() < 0.1, burning: false },
            data: {},
            reservedBy: {},
            inUseBy: rnd() < 0.3 ? ['a1'] : [],
            rev: C.n,
          };
        } else if (r < 0.55) {
          st.objects[id].placement = { kind: 'floor', x: 1 + Math.floor(rnd() * 26), z: 18 + Math.floor(rnd() * 8), rot: Math.floor(rnd() * 4) };
          st.objects[id].rev++;
        } else if (r < 0.7) {
          st.objects[id].condition.dirt = rnd();
          st.objects[id].condition.burning = rnd() < 0.15;
        } else delete st.objects[id];
      }
      // zombies
      for (let i = 0; i < 2; i++) {
        const id = `cz${Math.floor(rnd() * 8)}`;
        const src = st.agents[Object.keys(st.agents)[0]];
        if (!st.agents[id] || rnd() < 0.25) {
          const a = JSON.parse(JSON.stringify(src));
          a.id = id;
          a.pos = { x: 2 + rnd() * 26, z: 18 + rnd() * 8 };
          a.prevPos = { ...a.pos };
          a.anim = rnd() < 0.5 ? 'walk' : 'idle';
          a.presence = 'onLot';
          a.needs.hygiene = rnd() * 30;
          st.agents[id] = a;
        } else if (rnd() < 0.5) st.agents[id].presence = st.agents[id].presence === 'onLot' ? 'atWork' : 'onLot';
        else delete st.agents[id];
      }
      // overlays + hover
      const r2 = rnd();
      if (r2 < 0.3) R.setPlacementGhost({ defId: defs[Math.floor(rnd() * defs.length)], x: 5 + Math.floor(rnd() * 10), z: 20, rot: Math.floor(rnd() * 4), valid: rnd() < 0.5, tiles: [{ x: 5, z: 20 }], blockedSlots: rnd() < 0.5 ? [{ x: 6, z: 20 }] : [] });
      else if (r2 < 0.45) R.setPlacementGhost(null);
      if (rnd() < 0.3) R.setBuildOverlay({ edges: [`h:${3 + Math.floor(rnd() * 5)}:20`, 'v:9:20'], edgeMode: rnd() < 0.5 ? 'add' : 'remove', valid: rnd() < 0.5, tiles: [{ x: 4, z: 21 }], tileMode: 'paint', styleId: 'floor_checker', label: `$${Math.floor(rnd() * 900)}` });
      else if (rnd() < 0.2) R.setBuildOverlay(null);
      const ids = Object.keys(st.objects);
      R.setHover(rnd() < 0.5 && ids.length ? { kind: 'object', id: ids[Math.floor(rnd() * ids.length)] } : null);
      R.setHiddenObject(rnd() < 0.2 && ids.length ? ids[Math.floor(rnd() * ids.length)] : null);
      // events (fx + garbage) must never throw
      R.consumeEvents([{ type: 'fx', kind: 'puff', pos: { x: 10, z: 22 } }, { type: 'voice', agentId: 'a1', emotion: 'happy', durationMs: 500 }, null, { type: 'nope' }, { type: 'fx', kind: 'sparkle', agentId: 'missing' }]);
      void elapsed;
    }, elapsed);
    // attach/detach cycle every ~10 s
    if (Math.floor(elapsed / 10) > cycles) {
      cycles = Math.floor(elapsed / 10);
      await page.evaluate(() => {
        const R = window.__harness.renderer;
        R.attach(null);
        R.frame(1, 1 / 60);
        R.attach(window.__harness.fake);
      });
    }
    // one context loss + restore half way through
    if (!lostOnce && elapsed > seconds / 2) {
      lostOnce = true;
      const ok = await page.evaluate(() => window.__harness.loseContext(800));
      samples.push({ ...(await sample()), note: `context loss/restore ${ok}` });
    }
    await page.waitForTimeout(250);
    if (samples.length < 2 || Date.now() - samples[samples.length - 1].wall > 5000 || !samples[samples.length - 1].wall) {
      const s = await sample();
      s.wall = Date.now();
      s.elapsed = Math.round(elapsed);
      samples.push(s);
    }
  }
  // cleanup back to the original world, let a few frames run
  await page.evaluate(() => {
    const H = window.__harness;
    const st = H.fake.state;
    const C = window.__churn;
    for (const id of Object.keys(st.objects)) if (!C.base.objects.includes(id)) delete st.objects[id];
    for (const id of Object.keys(st.agents)) if (!C.base.agents.includes(id)) delete st.agents[id];
    H.renderer.setPlacementGhost(null);
    H.renderer.setBuildOverlay(null);
    H.renderer.setHover(null);
    H.renderer.setHiddenObject(null);
  });
  if (worldMode) {
    // back home: the regions around the home rebuild, everything else streamed out
    await page.evaluate(() => window.__harness.renderer.setCamera({ target: { x: 15, z: 15 } }, false));
    for (let i = 0; i < 40; i++) {
      await page.evaluate(() => window.__harness.renderer.setCamera({ target: { x: 15, z: 15 } }, false));
      await page.waitForTimeout(250);
    }
  }
  await page.waitForTimeout(4000);
  const end = await sample();
  const mid = samples.filter((s) => s.elapsed !== undefined && s.elapsed >= seconds * 0.5);
  const firstHalf = samples.filter((s) => s.elapsed !== undefined && s.elapsed < seconds * 0.5);
  const maxGeoFirst = Math.max(...firstHalf.map((s) => s.geometries));
  const maxGeoSecond = Math.max(...mid.map((s) => s.geometries));
  const report = {
    seconds,
    baseline,
    end,
    framesDuringRun: end.frames - baseline.frames,
    geometries: { baseline: baseline.geometries, maxFirstHalf: maxGeoFirst, maxSecondHalf: maxGeoSecond, end: end.geometries },
    textures: { baseline: baseline.textures, max: Math.max(...samples.map((s) => s.textures)), end: end.textures },
    programs: { baseline: baseline.programs, end: end.programs },
    contextRestored: !end.contextLost,
    errors,
    warnings: warnings.slice(0, 20),
    samples,
  };
  const s = JSON.stringify(report, null, 1);
  if (outFile) fs.writeFileSync(outFile, s);
  console.log(JSON.stringify({ ...report, samples: undefined }, null, 1));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
