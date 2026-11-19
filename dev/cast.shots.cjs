/**
 * CAST BODIES real-browser check (Playwright + SwiftShader): the render harness with the sample household given
 * cast bodies (walking / sitting on the sofa / sleeping in the coffin / dancing / walking outside), day + night.
 * Waits until every rig shows its wanted body, then captures, and measures the draw calls each cast zombie issues
 * (main + shadow pass) against the classic rig.
 *
 *   npx vite --config dev/render.vite.config.ts --port 5181 --strictPort &
 *   node dev/cast.shots.cjs [outDir]
 * Writes <outDir>/*.png + <outDir>/report.json (default dev/out/cast/runtime).
 */
const fs = require('fs');
const path = require('path');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node-tools/node_modules/playwright'));
}

const outDir = path.resolve(process.argv[2] || 'dev/out/cast/runtime');
const base = process.env.RENDER_URL || 'http://127.0.0.1:5181/dev/render.html';
fs.mkdirSync(outDir, { recursive: true });

const SHOTS = [
  { name: 'day_household', q: 'cast=walker,boss,granny,clown,bride&time=13:00' },
  { name: 'night_household', q: 'cast=walker,boss,granny,clown,bride&time=22:30' },
  { name: 'day_mix', q: 'cast=nurse,ringmaster,gamer,classic,pizza&time=10:30' },
  { name: 'night_mix', q: 'cast=mascot,cone,tourist,strongman,classic&time=21:00&moon=1' },
  { name: 'day_closeup', q: 'cast=walker,boss,granny,clown,bride&time=13:00&cam=0.7,0.55,9,11,15' },
  { name: 'night_closeup', q: 'cast=walker,boss,granny,clown,bride&time=22:30&cam=0.7,0.55,9,11,15' },
  { name: 'caz_boss_tall', q: 'scene=caz&cazbody=boss&cazheight=1&time=13:00' },
  { name: 'caz_granny_limbs', q: 'scene=caz&cazbody=granny&cazlimbs=armR:missing,legL:prosthetic&time=13:00' },
  { name: 'stress_all', q: 'cast=all&scene=stress&time=15:00' },
  { name: 'classic_baseline', q: 'time=13:00' },
];

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const reportFile = path.join(outDir, 'report.json');
  let report = {};
  try {
    report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  } catch {
    report = {};
  }
  // CAST_SHOTS=name1,name2 runs a subset (results merge into the existing report)
  const only = (process.env.CAST_SHOTS || '').split(',').filter(Boolean);
  for (const shot of SHOTS.filter((s) => !only.length || only.includes(s.name))) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const problems = [];
    page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${m.type()}] ${m.text().slice(0, 300)}`);
    });
    page.on('requestfailed', (r) => problems.push(`[requestfailed] ${r.url()}`));
    page.on('response', (r) => {
      if (r.status() >= 400) problems.push(`[http ${r.status()}] ${r.url()}`);
    });
    const t0 = Date.now();
    await page.goto(`${base}?${shot.q}&ui=0`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__harness && window.__harness.ready, null, { timeout: 600000, polling: 500 });
    // every rig on its wanted body (or permanently classic after a failure)
    await page.waitForFunction(() => {
      const h = window.__harness;
      const rigs = h.rigBodies();
      const st = h.castStats() || { failed: [] };
      return rigs.length > 0 && rigs.every((r) => r.body === r.wanted || (st.failed || []).includes(r.wanted));
    }, null, { timeout: 600000, polling: 500 });
    await page.waitForTimeout(1500); // a few frames of animation
    const data = await page.evaluate(() => {
      const h = window.__harness;
      const R = h.renderer;
      const gl = R.gl;
      const scene = R.scene();
      const agentOf = (o) => {
        for (let n = o; n; n = n.parent) if (typeof n.name === 'string' && n.name.startsWith('agent:')) return n;
        return null;
      };
      const per = {};
      const orig = gl.renderBufferDirect.bind(gl);
      let total = 0;
      gl.renderBufferDirect = (camera, sc, geometry, material, object, group) => {
        total++;
        const a = agentOf(object);
        if (a) {
          const k = a.name;
          const pass = sc === null ? 'shadow' : 'main';
          per[k] = per[k] || { main: 0, shadow: 0, body: '' };
          per[k][pass]++;
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
      return { total, per, rigs: h.rigBodies(), cast: h.castStats(), png: h.capture() };
    });
    const file = path.join(outDir, `${shot.name}.png`);
    fs.writeFileSync(file, Buffer.from(data.png.split(',')[1], 'base64'));
    delete data.png;
    report[shot.name] = { query: shot.q, seconds: Math.round((Date.now() - t0) / 1000), ...data, problems: problems.slice(0, 30) };
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 1));
    console.log(shot.name, JSON.stringify({ total: data.total, rigs: data.rigs.length, problems: problems.length }));
    await page.close();
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
