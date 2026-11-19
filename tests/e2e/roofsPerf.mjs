/**
 * Roofs and ceilings: draw calls and frame time, roofs on vs off, at Low and High quality, on the real GPU.
 *
 *   node tests/e2e/roofsPerf.mjs [--dist=<dir>] [--no-build] [--seconds=8] [--rounds=3] [--out=dev/out/roofs-perf.json]
 *
 * Views: overview with the zombie outdoors (the roof of the shack is drawn), and first person indoors (roof + one ceiling).
 * "Roofs off" hides the roof group (nothing else changes). On/off runs are interleaved over several rounds so drift hits both.
 * Frame time = requestAnimationFrame deltas in the page (median and p95), draw calls = renderer.stats().drawCalls.
 * Real hardware only: run it WITHOUT software GL (this script never passes the swiftshader flags).
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
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
const SECONDS = Number(opt('seconds', 8));
const ROUNDS = Number(opt('rounds', 3));
const OUT = path.resolve(ROOT, opt('out', 'dev/out/roofs-perf.json'));
const log = (s) => console.log(s);

const screenIs = (sc) => {
  const g = window.__afterlife && window.__afterlife.game;
  return !!g && (g.screen === sc || !!g.fatalError);
};
const measure = (secs) =>
  new Promise((resolve) => {
    const g = window.__afterlife.game;
    const deltas = [];
    let last = performance.now();
    const t0 = last;
    const calls = [];
    const tick = (now) => {
      deltas.push(now - last);
      last = now;
      calls.push(g.renderer.stats().drawCalls);
      if (now - t0 < secs * 1000) requestAnimationFrame(tick);
      else {
        const s = [...deltas].sort((a, b) => a - b);
        const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
        const c = [...calls].sort((a, b) => a - b);
        resolve({ frames: deltas.length, medianMs: q(0.5), p95Ms: q(0.95), meanMs: deltas.reduce((a, b) => a + b, 0) / deltas.length, drawCalls: c[Math.floor(c.length / 2)] });
      }
    };
    requestAnimationFrame(tick);
  });

async function main() {
  const dist = path.resolve(opt('dist', path.join(tmpdir(), 'al-roofs-dist')));
  await ensureBuild({ root: ROOT, distDir: dist, mode: argv.includes('--no-build') ? 'never' : 'auto', log });
  const server = await startPreview({ root: ROOT, distDir: dist, log });
  const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync'] });
  const results = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto(server.url);
    await page.waitForFunction(screenIs, 'menu', { polling: 100, timeout: 120000 });
    await page.evaluate(() => {
      const g = window.__afterlife.game;
      g.beginNewGame();
      return g.startGame();
    });
    await page.waitForFunction(screenIs, 'game', { polling: 100, timeout: 120000 });
    await page.waitForFunction(() => {
      const g = window.__afterlife.game;
      return !!g.selectedAgentId && g.sim.state.agents[g.selectedAgentId].presence === 'onLot' && g.renderer.stats().agents > 0 && !g.saving;
    }, null, { polling: 100, timeout: 120000 });
    await page.evaluate(() => {
      const g = window.__afterlife.game;
      if (g.dialog) g.closeDialog();
      g.setSpeed(0);
    });
    const gpu = await page.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
    });
    log(`GPU: ${gpu}`);
    const place = (where) =>
      page.evaluate((w) => {
        const g = window.__afterlife.game;
        const a = g.sim.state.agents[g.selectedAgentId];
        if (w === 'indoors') {
          const lot = g.sim.state.lot;
          for (let z = 0; z < lot.depth; z++)
            for (let x = 0; x < lot.width; x++)
              if (g.sim.spatial.roomAt(x + 0.5, z + 0.5) > 0) {
                a.pos = { x: x + 0.5, z: z + 0.5 };
                return;
              }
        } else a.pos = { x: 15.5, z: 26.2 };
      }, where);
    const views = [
      { name: 'overview, zombie outdoors (roof drawn)', where: 'outdoors', persp: 'overview' },
      { name: 'first person indoors (roof + 1 ceiling)', where: 'indoors', persp: 'firstPerson' },
    ];
    for (const quality of ['low', 'high']) {
      await page.evaluate((q) => window.__afterlife.game.renderer.setQuality(q), quality);
      for (const v of views) {
        await place(v.where);
        await page.evaluate((p) => window.__afterlife.game.setPerspective(p), v.persp);
        await page.waitForTimeout(2500);
        const runs = { on: [], off: [] };
        for (let r = 0; r < ROUNDS; r++) {
          for (const mode of r % 2 === 0 ? ['on', 'off'] : ['off', 'on']) {
            await page.evaluate((on) => {
              const grp = window.__afterlife.game.renderer.scene().getObjectByName('roofs');
              grp.visible = on;
            }, mode === 'on');
            await page.waitForTimeout(800);
            runs[mode].push(await page.evaluate(measure, SECONDS));
          }
        }
        await page.evaluate(() => (window.__afterlife.game.renderer.scene().getObjectByName('roofs').visible = true));
        const agg = (rs) => ({
          drawCalls: rs[0].drawCalls,
          medianMs: +(rs.map((x) => x.medianMs).sort((a, b) => a - b)[Math.floor(rs.length / 2)]).toFixed(3),
          p95Ms: +(rs.map((x) => x.p95Ms).sort((a, b) => a - b)[Math.floor(rs.length / 2)]).toFixed(3),
          meanMs: +(rs.reduce((a, b) => a + b.meanMs, 0) / rs.length).toFixed(3),
          frames: rs.reduce((a, b) => a + b.frames, 0),
        });
        const row = { quality, view: v.name, on: agg(runs.on), off: agg(runs.off), raw: runs };
        results.push(row);
        log(`${quality.padEnd(4)} | ${v.name.padEnd(40)} | draws on ${row.on.drawCalls} off ${row.off.drawCalls} | median ms on ${row.on.medianMs} off ${row.off.medianMs} | p95 ms on ${row.on.p95Ms} off ${row.off.p95Ms} | mean ms on ${row.on.meanMs} off ${row.off.meanMs}`);
      }
    }
  } finally {
    await browser.close();
    await Promise.race([server.stop().catch(() => undefined), new Promise((r) => setTimeout(r, 15000))]);
  }
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), seconds: SECONDS, rounds: ROUNDS, results }, null, 2));
  log(`wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
