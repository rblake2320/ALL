/**
 * W-025 S5 world render budget check (AC-8 desktop, AC-9 phone profile; docs/DESIGN_WORLD_LEVELS.md §1.4 budgets).
 *
 *   node tests/e2e/worldPerf.mjs                 desktop 1280×720 + phone profile 390×844 (CPU throttle ×4)
 *   node tests/e2e/worldPerf.mjs --phone         phone profile only
 *   node tests/e2e/worldPerf.mjs --desktop       desktop only
 *   node tests/e2e/worldPerf.mjs --url=http://127.0.0.1:5174/dev/render.html   reuse a running render harness
 *   node tests/e2e/worldPerf.mjs --no-fail       report only (exit 0 even when over budget)
 *
 * Scene: the render harness' stress scene (15 zombies, ~150 objects) on a world with a town (world=1): the home plus
 * every Mildew Lane region inside the render radius, 17 more zombies standing in neighbour lots / streets (32 agents in
 * all), evening (street lamps + window glow). Measured per view over a camera sweep (home view, along the street at the
 * farthest zoom / lowest pitch, toward the graveyard, across the street): draw calls and triangles (max over frames,
 * shadow pass included), JS heap (CDP Runtime.getHeapUsage), frame interval p95 (rAF, SwiftShader = CPU-rendered, so
 * frame times here are an upper bound, not a GPU measurement). Also checks a pick in a non-home region and writes
 * "street from home" screenshots. Output: dev/out/world/ (report.json + PNGs).
 *
 * Budgets: desktop ≤ 650 draw calls, ≤ 1.5 M triangles; phone ≤ 350 draw calls, ≤ 400 k triangles, JS heap ≤ 250 MB.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort, viteBin } from './lib/server.mjs';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node-tools/node_modules/playwright'));
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const outDir = path.resolve(root, opt('out') ?? 'dev/out/world');
mkdirSync(outDir, { recursive: true });

const BUDGET = {
  desktop: { drawCalls: 650, triangles: 1_500_000, heapMB: 1500 },
  phone: { drawCalls: 350, triangles: 400_000, heapMB: 250 },
};
const FRAME_P95_MS = 33.3;

async function startVite() {
  const port = await freePort();
  const child = spawn(process.execPath, [viteBin(root), '--config', 'dev/render.vite.config.ts', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => reject(new Error(`vite did not start\n${out}`)), 120000);
    const on = (d) => {
      out += d;
      if (/ready in/i.test(out)) {
        clearTimeout(t);
        resolve();
      }
    };
    child.stdout.on('data', on);
    child.stderr.on('data', on);
    child.on('exit', (c) => reject(new Error(`vite exited ${c}\n${out}`)));
  });
  return { url: `http://127.0.0.1:${port}/dev/render.html`, stop: () => child.kill('SIGTERM') };
}

/** Camera views (yaw, pitch, distance, target x, z in scene = home-local tiles). */
const VIEWS = [
  { name: 'home', cam: '0.785,0.8,27,15,15.6' },
  { name: 'street-from-home', cam: '0,0.42,34,15,36' },
  { name: 'along-street-east', cam: '-1.35,0.35,60,30,35' },
  { name: 'along-street-west', cam: '1.35,0.35,60,0,35' },
  { name: 'toward-graveyard', cam: '-1.2,0.38,60,70,35' },
];

async function measureProfile(browser, base, profile) {
  const phone = profile === 'phone';
  const ctx = await browser.newContext(
    phone
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' }
      : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  );
  const errors = [];
  const quality = phone ? 'low' : 'high';
  const views = [];
  let pick = null;
  for (const v of VIEWS) {
    // a fresh page per view: SwiftShader frames are slow, a busy page must not delay the next navigation
    const page = await ctx.newPage();
    page.setDefaultNavigationTimeout(600000);
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text().slice(0, 300));
    });
    const cdp = await ctx.newCDPSession(page);
    if (phone) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto(`${base}?scene=stress&world=1&worldAgents=17&time=19:30&quality=${quality}&ui=0&cam=${v.cam}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__harness && window.__harness.ready, null, { timeout: 900000, polling: 500 });
    // streaming settles (≤ 2 region builds per frame), shells / models land
    await page.waitForFunction(() => {
      const s = window.__harness.renderer.stats();
      return s.world && s.world.on && s.world.deferred === 0 && s.world.built > 0;
    }, null, { timeout: 600000, polling: 500 });
    await page.waitForTimeout(phone ? 6000 : 3000);
    const m = await page.evaluate(
      (ms) =>
        new Promise((resolve) => {
          const R = window.__harness.renderer;
          const iv = [];
          let maxDraw = 0;
          let maxTri = 0;
          let last = performance.now();
          const t0 = last;
          const step = (now) => {
            iv.push(now - last);
            last = now;
            const s = R.stats();
            maxDraw = Math.max(maxDraw, s.drawCalls);
            maxTri = Math.max(maxTri, s.triangles);
            if (now - t0 < ms) requestAnimationFrame(step);
            else {
              iv.shift();
              iv.sort((a, b) => a - b);
              const p95 = iv.length ? iv[Math.min(iv.length - 1, Math.floor(iv.length * 0.95))] : NaN;
              const st = R.stats();
              resolve({ drawCalls: maxDraw, triangles: maxTri, frames: iv.length, frameP95: p95, frameMedian: iv[Math.floor(iv.length / 2)], world: st.world, agents: st.agents, agentsCulled: st.agentsCulled, objects: st.objects, geometries: st.geometries, textures: st.textures, sceneRebuilds: st.sceneRebuilds, quality: st.quality, pixelRatio: st.pixelRatio });
            }
          };
          requestAnimationFrame(step);
        }),
      phone ? 8000 : 5000,
    );
    const heap = await cdp.send('Runtime.getHeapUsage');
    m.heapMB = Math.round((heap.usedSize / 1048576) * 10) / 10;
    m.view = v.name;
    if (v.name === 'street-from-home') {
      const png = await page.evaluate(() => window.__harness.capture());
      const file = path.join(outDir, `street-from-home-${profile}.png`);
      writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
      m.screenshot = path.relative(root, file);
      // pick in a non-home region: the ground of the lot across the street (s2 local (14.5, 20.5) → scene (15.5, 49.5))
      pick = await page.evaluate(() => {
        const R = window.__harness.renderer;
        const p = R.worldToScreen(15.5, 0, 49.5);
        if (!p.visible) return { skipped: 'not visible' };
        const r = R.pick(p.x, p.y, { agents: false, objects: true, walls: false, tiles: true });
        return { kind: r.kind, target: r.target ?? null, what: r.what ?? null };
      });
    }
    views.push(m);
    await page.close();
    console.log(`[${profile}] ${v.name}: ${m.drawCalls} draws, ${(m.triangles / 1000).toFixed(0)}k tris, heap ${m.heapMB} MB, p95 ${m.frameP95.toFixed(1)} ms, regions active ${m.world?.active} warm ${m.world?.warm}`);
  }
  await ctx.close();
  const b = BUDGET[profile];
  const max = (k) => Math.max(...views.map((v) => v[k]));
  const summary = {
    profile,
    viewport: phone ? '390×844 @3x, mobile emulation, CPU throttle ×4, quality Low' : '1280×720 @1x, quality High',
    drawCalls: { max: max('drawCalls'), budget: b.drawCalls, ok: max('drawCalls') <= b.drawCalls },
    triangles: { max: max('triangles'), budget: b.triangles, ok: max('triangles') <= b.triangles },
    heapMB: { max: max('heapMB'), budget: b.heapMB, ok: max('heapMB') <= b.heapMB },
    frameP95: { max: max('frameP95'), budget: FRAME_P95_MS, ok: max('frameP95') <= FRAME_P95_MS, note: 'SwiftShader (CPU) rendering in a container: not a device measurement' },
    pick,
    pickOk: !!pick && (pick.skipped !== undefined || (pick.kind === 'worldTile' && pick.target?.regionId === 'wormwood:mildew_s2')),
    errors,
    views,
  };
  return summary;
}

(async () => {
  const want = flag('phone') ? ['phone'] : flag('desktop') ? ['desktop'] : ['desktop', 'phone'];
  const server = opt('url') ? { url: opt('url'), stop: () => undefined } : await startVite();
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
  const report = { at: new Date().toISOString(), profiles: [] };
  try {
    for (const p of want) report.profiles.push(await measureProfile(browser, server.url, p));
  } finally {
    await browser.close();
    server.stop();
  }
  writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));
  console.log('\n| profile | draw calls (max / budget) | triangles (max / budget) | JS heap MB (max / budget) | frame p95 ms (SwiftShader) | pick s2 |');
  console.log('|---|---|---|---|---|---|');
  let ok = true;
  for (const s of report.profiles) {
    const mark = (x) => (x.ok ? 'ok' : 'OVER');
    console.log(`| ${s.profile} | ${s.drawCalls.max} / ${s.drawCalls.budget} ${mark(s.drawCalls)} | ${s.triangles.max} / ${s.triangles.budget} ${mark(s.triangles)} | ${s.heapMB.max} / ${s.heapMB.budget} ${mark(s.heapMB)} | ${s.frameP95.max.toFixed(1)} | ${s.pickOk ? 'ok' : 'FAIL'} |`);
    ok = ok && s.drawCalls.ok && s.triangles.ok && s.heapMB.ok && s.pickOk && s.errors.length === 0;
    if (s.errors.length) console.log(`  ${s.profile} page errors:`, s.errors.slice(0, 5));
  }
  console.log(`report: ${path.relative(root, path.join(outDir, 'report.json'))}`);
  process.exit(ok || flag('no-fail') ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
