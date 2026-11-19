/**
 * RENDER picking accuracy (Playwright + SwiftShader): compares renderer.pick() against a GPU ground truth (an ID
 * render: every agent / object / wall / floor in a unique flat colour, merged chunks swapped for the precise
 * originals — src/render/dev/pickTruth.ts) on a grid of cursor positions, for 8 camera rotations × 2 pitches in
 * 'cutaway' and 'up' wall modes. Reports agreement per ground-truth category plus the kinds of mismatch (the agent
 * capsule halo and the zombie-over-furniture bias are deliberate).
 *
 *   npx vite --config dev/render.vite.config.ts --port 5174 --strictPort &
 *   node dev/render.pick.cjs [out.json] [quick]
 */
const fs = require('fs');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node-tools/node_modules/playwright'));
}

const outFile = process.argv[2] || '';
const base = process.env.RENDER_URL || 'http://127.0.0.1:5174/dev/render.html';

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}?time=12:30&ui=0&paused=1&frames=8`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.dataset.done === '1' || document.body.dataset.error === '1', null, { timeout: 600000, polling: 500 });
  // full: 8 rotations × 2 pitches × 2 wall modes; quick (2nd arg "quick"): 8 rotations cutaway + 4 'up', mixed pitches
  const quick = process.argv[3] === 'quick';
  const views = [];
  if (quick) {
    for (let r = 0; r < 8; r++) views.push({ mode: 'cutaway', yaw: Math.PI / 4 - (r * Math.PI) / 4, pitch: r % 2 ? 1.0 : 0.6 });
    for (let r = 0; r < 8; r += 2) views.push({ mode: 'up', yaw: Math.PI / 4 - (r * Math.PI) / 4, pitch: 0.8 });
  } else for (const mode of ['cutaway', 'up']) for (let r = 0; r < 8; r++) for (const pitch of [0.55, 1.0]) views.push({ mode, yaw: Math.PI / 4 - (r * Math.PI) / 4, pitch });
  const report = { views: [], totals: {} };
  for (const v of views) {
    const res = await page.evaluate(async (v) => {
      const H = window.__harness;
      const R = H.renderer;
      R.setWallMode(v.mode);
      R.setCamera({ target: { x: 13, z: 15 }, yaw: v.yaw, pitch: v.pitch, distance: 20 }, true);
      // let the walls settle into the cutaway heights for this view
      for (let i = 0; i < 10; i++) R.frame(1, 0.15);
      const samples = [];
      for (let y = 12; y < 360; y += 12) for (let x = 12; x < 640; x += 12) samples.push({ x, y });
      const truth = H.pickTruth(samples);
      const out = { n: 0, agree: 0, byCat: {}, mismatch: {} };
      samples.forEach((s, i) => {
        const t = truth[i];
        // the ID buffer pixel (x, y) covers [x, x+1) × [y, y+1): pick at its centre
        const p = R.pick(s.x + 0.5, s.y + 0.5);
        const got = p.kind === 'agent' ? `agent:${p.agentId}` : p.kind === 'object' ? `object:${p.objectId}` : p.kind === 'wall' ? 'wall' : p.kind === 'tile' ? 'ground' : 'none';
        const cat = t.split(':')[0];
        const c = (out.byCat[cat] = out.byCat[cat] || { n: 0, ok: 0 });
        c.n++;
        out.n++;
        // ground under the lot → tile; ground outside the lot / dressing → none (both "ground-ish")
        const ok = t === got || (cat === 'ground' && (got === 'ground' || got === 'none')) || (cat === 'none' && got === 'ground');
        if (ok) {
          c.ok++;
          out.agree++;
        } else {
          const k = `${cat}→${got.split(':')[0]}`;
          out.mismatch[k] = (out.mismatch[k] || 0) + 1;
        }
      });
      return out;
    }, v);
    report.views.push({ ...v, ...res });
    for (const [cat, c] of Object.entries(res.byCat)) {
      const T = (report.totals[cat] = report.totals[cat] || { n: 0, ok: 0 });
      T.n += c.n;
      T.ok += c.ok;
    }
    for (const [k, n] of Object.entries(res.mismatch)) report.totals[`mismatch ${k}`] = (report.totals[`mismatch ${k}`] || 0) + n;
    console.log(`${v.mode} yaw=${v.yaw.toFixed(2)} pitch=${v.pitch}: ${res.agree}/${res.n} agree`, JSON.stringify(res.mismatch));
  }
  for (const [k, v] of Object.entries(report.totals)) if (v && v.n) v.rate = +(v.ok / v.n).toFixed(4);
  report.errors = errors;
  console.log(JSON.stringify(report.totals, null, 1));
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
