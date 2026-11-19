/* RENDER perf + API probe (Playwright + SwiftShader).
 * 1. perf: renderer.frame() time on the stress scene (15 zombies + ~170 objects, dusk lamps, FX) at a tiny
 *    viewport, so software rasterisation does not dominate and the number approximates the CPU cost per frame
 *    (scene sync + culling + draw submission).
 * 2. api: in-browser contract checks — snapshot() JPEG ≤ 64 KB (incl. an oversized request), thumbnail() 128×128
 *    PNG, pick / pickGrid / worldToScreen / bubbleAnchors shapes, garbage inputs never throw.
 * Usage: node dev/render.perf.cjs [quality=high] [frames=140] [perf=]   (dev server on 5174, see render.shots.cjs)
 *        perf=legacy turns the draw-call optimisations off for an A/B (per-object batching, lot chunks, rig culling).
 */
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node-tools/node_modules/playwright'));
}

const BASE = process.env.RENDER_URL || 'http://127.0.0.1:5174/dev/render.html';

async function probe(quality, frames, viewport, perfMode) {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}?scene=stress&time=19:30&ui=0&quality=${quality}&frames=${frames}${perfMode ? `&perf=${perfMode}` : ''}`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.body.dataset.done === '1' || document.body.dataset.error === '1', null, { timeout: 600000, polling: 1000 });
    const perf = await page.evaluate(() => {
      const h = window.__harness;
      const s = h.stats();
      return { frames: h.frames, avgMs: +h.frameMsAvg.toFixed(2), maxMs: +h.frameMsMax.toFixed(2), drawCalls: s.drawCalls, triangles: s.triangles, objects: s.objects, agents: s.agents, particles: s.particles, lampLights: s.lampLights };
    });
    const api = await page.evaluate(async () => {
      const r = window.__harness.renderer;
      const out = {};
      const snap = r.snapshot(320, 180);
      out.snapshot = { jpeg: snap.startsWith('data:image/jpeg'), chars: snap.length, fits: snap.length <= 64 * 1024 };
      const big = r.snapshot(4096, 4096);
      out.snapshotHuge = { jpeg: big.startsWith('data:image/jpeg'), chars: big.length, fits: big.length <= 64 * 1024 };
      out.snapshotGarbage = r.snapshot(NaN, -5).length <= 64 * 1024;
      const url = await r.thumbnail('sofa_velvet', '#6e2a35');
      const img = new Image();
      img.src = url;
      await img.decode().catch(() => undefined);
      out.thumbnail = { png: url.startsWith('data:image/png'), w: img.naturalWidth, h: img.naturalHeight, cachedSame: (await r.thumbnail('sofa_velvet', '#6E2A35')) === url };
      out.thumbnailUnknown = (await r.thumbnail('no_such_model')).startsWith('data:image/png');
      const cw = innerWidth;
      const ch = innerHeight;
      out.pick = r.pick(cw / 2, ch / 2).kind;
      out.pickGarbage = r.pick(NaN, Infinity).kind;
      const g = r.pickGrid(cw / 2, ch / 2);
      out.pickGrid = g ? { x: g.x, z: g.z, inside: g.fx >= g.x && g.fx < g.x + 1 && g.fz >= g.z && g.fz < g.z + 1, edge: g.edge } : null;
      out.pickGridGarbage = r.pickGrid(NaN, NaN);
      const w = r.worldToScreen(15, 0, 15);
      out.worldToScreen = { finite: Number.isFinite(w.x) && Number.isFinite(w.y), visible: w.visible };
      const b = r.bubbleAnchors();
      out.bubbleAnchors = { count: b.length, scalesOk: b.every((a) => a.scale >= 0.5 && a.scale <= 1.2) };
      try {
        r.frame(NaN, -1);
        r.consumeEvents([null, 5, { type: 'fx', kind: 'nope' }, { type: 'voice' }, { type: 'lot', what: 'all' }]);
        r.setCamera({ yaw: NaN, distance: Infinity, target: { x: NaN, z: 1e9 } });
        r.rotateCamera(1e9);
        r.zoom(NaN);
        r.setPlacementGhost({ defId: 'nope', valid: false, tiles: [null, { x: NaN, z: 2 }] });
        r.setBuildOverlay({ edges: ['garbage', 'h:1:1'], valid: true, label: 42 });
        r.frame(0.5, 1 / 60);
        r.setPlacementGhost(null);
        r.setBuildOverlay(null);
        out.garbageSafe = true;
      } catch (e) {
        out.garbageSafe = String(e);
      }
      out.fps = r.fps();
      return out;
    });
    return { quality, viewport: `${viewport.width}x${viewport.height}`, perf, api, errors };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  const quality = process.argv[2] || 'high';
  const frames = Number(process.argv[3] || 140);
  const perfMode = process.argv[4] || '';
  console.log(JSON.stringify(await probe(quality, frames, { width: 320, height: 180 }, perfMode), null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
