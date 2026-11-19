/**
 * RENDER draw-call profiler (Playwright + SwiftShader): opens the render harness (or any page exposing a Renderer
 * via window.__harness.renderer / window.__afterlife.game.renderer), renders a few frames, then wraps
 * WebGLRenderer.renderBufferDirect for ONE frame and attributes every draw to its pass (shadow / main / post) and
 * to the top-level scene group + model id that issued it.
 *
 *   npx vite --config dev/render.vite.config.ts --port 5174 --strictPort &
 *   node dev/render.drawcalls.cjs ["scene=stress&time=19:30"] [width] [height] [out.json]
 */
const fs = require('fs');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node-tools/node_modules/playwright'));
}

const query = process.argv[2] || 'scene=stress&time=19:30';
const width = Number(process.argv[3] || 1280);
const height = Number(process.argv[4] || 720);
const outFile = process.argv[5] || '';
const base = process.env.RENDER_URL || 'http://127.0.0.1:5174/dev/render.html';

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text().slice(0, 300)}`);
  });
  await page.goto(`${base}?${query}&ui=0&frames=14`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.dataset.done === '1' || document.body.dataset.error === '1', null, { timeout: 900000, polling: 1000 });
  const r = await page.evaluate(() => {
    const R = window.__harness.renderer;
    const gl = R.gl;
    const scene = R.scene();
    const topOf = (o) => {
      let n = o;
      while (n && n.parent && n.parent !== scene) n = n.parent;
      return (n && (n.name || n.type)) || '?';
    };
    const idOf = (o, top) => {
      if (top === 'objects') {
        let h = o;
        while (h.parent && h.parent.name !== 'objects') h = h.parent;
        const inst = h.children && h.children[0];
        return (inst && inst.name) || h.name;
      }
      if (top === 'agents') return 'zombie';
      if (top === 'world-dressing') {
        let h = o;
        while (h.parent && h.parent.name !== 'world-dressing') h = h.parent;
        return h.name || o.name;
      }
      return o.name || o.type;
    };
    const counts = { shadow: {}, main: {}, other: {} };
    const ids = { shadow: {}, main: {} };
    let total = 0;
    const orig = gl.renderBufferDirect.bind(gl);
    gl.renderBufferDirect = (camera, sc, geometry, material, object, group) => {
      total++;
      const pass = sc === null ? 'shadow' : sc === scene ? 'main' : 'other';
      const top = sc === null || sc === scene ? topOf(object) : material.name || material.type;
      counts[pass][top] = (counts[pass][top] || 0) + 1;
      if (pass !== 'other') {
        const id = idOf(object, top);
        const k = `${top}/${id}`;
        ids[pass][k] = (ids[pass][k] || 0) + 1;
      }
      return orig(camera, sc, geometry, material, object, group);
    };
    try {
      R.frame(1, 1 / 60);
    } finally {
      gl.renderBufferDirect = orig;
    }
    const st = R.stats();
    const top = (m, n) =>
      Object.entries(m)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n);
    let casters = 0;
    let meshes = 0;
    scene.traverseVisible((o) => {
      if (o.isMesh) {
        meshes++;
        if (o.castShadow) casters++;
      }
    });
    return { total, stats: st, visibleMeshes: meshes, casters, byGroup: counts, topIdsMain: top(ids.main, 30), topIdsShadow: top(ids.shadow, 30) };
  });
  r.errors = errors.slice(0, 20);
  const s = JSON.stringify(r, null, 1);
  if (outFile) fs.writeFileSync(outFile, s);
  console.log(s);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
