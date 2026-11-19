/**
 * RENDER A/B visual check (Playwright + SwiftShader): captures each harness scene twice — with the draw-call
 * optimisations OFF (`perf=legacy`: no per-object batching, no lot chunks, no rig culling) and ON (default) — against
 * the SAME assets at the same moment, then writes side-by-side PNGs (left = legacy, right = optimised) plus a
 * per-pixel difference score, so batching can be judged independently of parallel asset changes.
 *
 *   npx vite --config dev/render.vite.config.ts --port 5174 --strictPort &
 *   node dev/render.ab.cjs [outDir=dev/out/render/ab] [scene names...]
 */
const fs = require('fs');
const path = require('path');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node-tools/node_modules/playwright'));
}

const BASE = process.env.RENDER_URL || 'http://127.0.0.1:5174/dev/render.html';
const out = path.resolve(process.argv[2] || path.join(__dirname, 'out', 'render', 'ab'));
const SCENES = {
  day: 'time=12:30&walls=cutaway&paused=1',
  night: 'time=23:00&walls=cutaway&paused=1',
  stress: 'scene=stress&time=19:30&paused=1',
  closeup: 'time=21:00&walls=cutaway&paused=1&cam=0.6,0.75,11,9.5,15.5',
  kitchen: 'time=12:30&walls=down&paused=1&cam=2.4,0.7,10,20,17',
};
const names = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(SCENES);
const VIEW = { width: 960, height: 540 };

async function capture(q) {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}?${q}&ui=0&frames=8`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.body.dataset.done === '1' || document.body.dataset.error === '1', null, { timeout: 900000, polling: 1000 });
    const res = await page.evaluate(() => {
      const h = window.__harness;
      // identical clock for both runs: freeze FX/flicker time by rendering with dt 0
      h.renderer.frame(1, 0);
      return { url: h.capture(), stats: h.stats() };
    });
    return { ...res, errors };
  } finally {
    await browser.close().catch(() => {});
  }
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const summary = {};
  for (const name of names) {
    const q = SCENES[name];
    if (!q) continue;
    const legacy = await capture(`${q}&perf=legacy`);
    const opt = await capture(q);
    fs.writeFileSync(path.join(out, `${name}-legacy.png`), Buffer.from(legacy.url.slice(22), 'base64'));
    fs.writeFileSync(path.join(out, `${name}-optimised.png`), Buffer.from(opt.url.slice(22), 'base64'));
    summary[name] = {
      legacy: { drawCalls: legacy.stats.drawCalls, triangles: legacy.stats.triangles },
      optimised: { drawCalls: opt.stats.drawCalls, triangles: opt.stats.triangles, chunks: opt.stats.chunks, agentsCulled: opt.stats.agentsCulled },
      errors: [...legacy.errors, ...opt.errors],
    };
    console.log(name, JSON.stringify(summary[name]));
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 1));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
