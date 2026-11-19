/**
 * PREMIUM BODIES real-browser check (Playwright, the machine's own GPU by default): the render harness with the
 * sample household given the five premium bodies, day and night, plus each body on the Create-a-Zombie turntable.
 * Waits until every rig shows its wanted body, captures, and records per-zombie draw calls, the WebGL renderer
 * string and every console / network problem.
 *
 *   npx vite --config dev/render.vite.config.ts --port 5181 --strictPort &
 *   node dev/premium.shots.cjs [outDir]            (PREMIUM_SOFTWARE=1 = SwiftShader, for machines without a GPU)
 * Writes <outDir>/*.png + <outDir>/report.json (default dev/out/premium/runtime). Exit 1 when a body did not load,
 * a premium zombie needs more than one shadow draw or more than three main draws (the body plus the two passes of
 * the selection outline on the selected zombie), or the page reported an error.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const IDS = ['sexton', 'lowside', 'waitress', 'patient', 'fisherman'];
const outDir = path.resolve(process.argv[2] || 'dev/out/premium/runtime');
const base = process.env.RENDER_URL || 'http://127.0.0.1:5181/dev/render.html';
fs.mkdirSync(outDir, { recursive: true });

const SHOTS = [
  { name: 'day_household', q: `cast=${IDS.join(',')}&time=13:00` },
  { name: 'day_closeup', q: `cast=${IDS.join(',')}&time=13:00&cam=0.7,0.55,9,11,15` },
  { name: 'night_closeup', q: `cast=${IDS.join(',')}&time=22:30&cam=0.7,0.55,9,11,15` },
  { name: 'mixed_with_cast_and_classic', q: 'cast=sexton,walker,classic,fisherman,boss&time=11:00&cam=0.7,0.55,9,11,15' },
  ...IDS.map((id) => ({ name: `caz_${id}`, q: `scene=caz&cazbody=${id}&cazheight=0.5&time=13:00` })),
];

(async () => {
  const args = process.env.PREMIUM_SOFTWARE
    ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
    : ['--use-gl=angle', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'];
  // PREMIUM_CHANNEL=chrome uses the installed Chrome (no Playwright browser download needed)
  const browser = await chromium.launch({ args, ...(process.env.PREMIUM_CHANNEL ? { channel: process.env.PREMIUM_CHANNEL } : {}) });
  const report = {};
  let bad = 0;
  for (const shot of SHOTS) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    const problems = [];
    page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
    page.on('console', (m) => {
      // a failed request is recorded with its URL by the response / requestfailed handlers below; the console's own
      // 'Failed to load resource' line has no URL (the browser's favicon probe lands here)
      if (m.text().startsWith('Failed to load resource')) return;
      if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${m.type()}] ${m.text().slice(0, 300)}`);
    });
    page.on('requestfailed', (r) => problems.push(`[requestfailed] ${r.url()}`));
    page.on('response', (r) => {
      if (r.status() >= 400) problems.push(`[http ${r.status()}] ${r.url()}`);
    });
    const t0 = Date.now();
    await page.goto(`${base}?${shot.q}&ui=0`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__harness && window.__harness.ready, null, { timeout: 300000, polling: 500 });
    await page.waitForFunction(() => {
      const h = window.__harness;
      const rigs = h.rigBodies();
      const st = h.castStats() || { failed: [] };
      return rigs.length > 0 && rigs.every((r) => r.body === r.wanted || (st.failed || []).includes(r.wanted));
    }, null, { timeout: 300000, polling: 500 });
    await page.waitForTimeout(1500);
    const data = await page.evaluate(() => {
      const h = window.__harness;
      const R = h.renderer;
      const gl = R.gl;
      const ctx = gl.getContext();
      const dbg = ctx.getExtension('WEBGL_debug_renderer_info');
      const agentOf = (o) => {
        for (let n = o; n; n = n.parent) if (typeof n.name === 'string' && n.name.startsWith('agent:')) return n;
        return null;
      };
      const per = {};
      const orig = gl.renderBufferDirect.bind(gl);
      gl.renderBufferDirect = (camera, sc, geometry, material, object, group) => {
        const a = agentOf(object);
        if (a) {
          const pass = sc === null ? 'shadow' : 'main';
          per[a.name] = per[a.name] || { main: 0, shadow: 0, body: '' };
          per[a.name][pass]++;
        }
        return orig(camera, sc, geometry, material, object, group);
      };
      try {
        R.frame(1, 1 / 60);
      } finally {
        gl.renderBufferDirect = orig;
      }
      const bodies = {};
      for (const r of h.rigBodies()) bodies[r.id] = r;
      for (const k of Object.keys(per)) per[k].body = bodies[k] ? `${bodies[k].kind}:${bodies[k].body}` : '?';
      return {
        per, rigs: h.rigBodies(), cast: h.castStats(), png: h.capture(),
        gpu: dbg ? ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
        triangles: gl.info.render.triangles,
      };
    });
    fs.writeFileSync(path.join(outDir, `${shot.name}.png`), Buffer.from(data.png.split(',')[1], 'base64'));
    delete data.png;
    const wanted = data.rigs.filter((r) => IDS.includes(r.wanted));
    const notLoaded = wanted.filter((r) => r.body !== r.wanted).map((r) => r.wanted);
    const heavy = Object.values(data.per).filter((p) => IDS.some((id) => p.body.endsWith(`:${id}`)) && (p.main > 3 || p.shadow > 1)).map((p) => p.body);
    const failed = notLoaded.length > 0 || heavy.length > 0 || problems.length > 0 || wanted.length === 0;
    if (failed) bad++;
    report[shot.name] = { query: shot.q, seconds: Math.round((Date.now() - t0) / 1000), failed, notLoaded, heavy, ...data, problems: problems.slice(0, 30) };
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));
    console.log(shot.name, JSON.stringify({ failed, premium: wanted.length, notLoaded, heavy, problems: problems.length, gpu: data.gpu }));
    await page.close();
  }
  await browser.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
