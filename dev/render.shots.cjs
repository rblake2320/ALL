/* RENDER harness screenshots (Playwright + SwiftShader WebGL2).
 * Usage: node dev/render.shots.cjs [shotName ...]
 * Dev server (HMR off so parallel edits never reload a page mid-capture):
 *   npx vite --config dev/render.vite.config.ts --port 5174 --strictPort
 * Output: dev/out/render/<name>.png + dev/out/render/console.log
 */
const path = require('path');
const fs = require('fs');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node-tools/node_modules/playwright'));
}

const BASE = process.env.RENDER_URL || 'http://127.0.0.1:5174/dev/render.html';
const OUT = path.join(__dirname, 'out', 'render');
const VIEW = { width: 1280, height: 720 };
/** Frames to render before the shot (FX need time to develop; static scenes settle quickly). */
const FRAMES = { fx: 60, stress: 20, thumbs: 30, caz: 12, 'real-sim': 120, atlas: 2, sofa: 30, walkers: 40 };

const SHOTS = {
  day: 'time=12:30&walls=cutaway&ui=0&paused=1',
  dusk: 'time=18:45&walls=cutaway&ui=0&paused=1',
  night: 'time=23:00&walls=cutaway&ui=0&paused=1',
  fullmoon: 'time=23:00&moon=1&walls=cutaway&ui=0&paused=1',
  'walls-up': 'time=12:30&walls=up&ui=0&paused=1',
  'walls-cutaway': 'time=12:30&walls=cutaway&ui=0&paused=1&cam=0.785,0.9,26',
  'walls-down': 'time=12:30&walls=down&ui=0&paused=1',
  'ghost-valid': 'scene=ghost-valid&time=12:30&ui=0&paused=1',
  'ghost-invalid': 'scene=ghost-invalid&time=12:30&ui=0&paused=1',
  build: 'scene=build&time=12:30&ui=0&paused=1',
  fx: 'scene=fx&time=21:30&ui=0',
  caz: 'scene=caz&time=12:30&ui=0&paused=1',
  thumbs: 'scene=thumbs&time=12:30&ui=0&paused=1',
  stress: 'scene=stress&time=19:30&ui=1',
  closeup: 'time=21:00&walls=cutaway&ui=0&paused=1&cam=0.6,0.75,11,9.5,15.5',
  low: 'time=12:30&walls=cutaway&ui=0&paused=1&quality=low',
  'real-sim': 'sim=real&walls=cutaway&ui=1',
  atlas: 'scene=atlas&ui=0&paused=1',
  sofa: 'time=12:30&walls=down&ui=0&cam=3.1416,0.45,6.5,9.5,16.5',
  walkers: 'time=12:30&walls=down&ui=0&cam=0.6,0.6,9,13.5,16.5',
  wisp: 'time=21:00&walls=cutaway&ui=0&paused=1&cam=0.5,0.6,6.5,8.2,14.3',
  'context-restore': 'time=12:30&walls=cutaway&ui=0&paused=1&contextloss=1',
};

async function shoot(name, q, log) {
  // a fresh browser per shot: a crashed GPU process can't take the rest of the batch down
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 1 });
    page.on('console', (m) => {
      if (m.type() !== 'debug') log.push(`[${name}] ${m.type()}: ${m.text().slice(0, 400)}`);
    });
    page.on('pageerror', (e) => log.push(`[${name}] PAGEERROR: ${e.message}`));
    page.on('crash', () => log.push(`[${name}] PAGE CRASHED`));
    const t0 = Date.now();
    const frames = FRAMES[name] ?? 10;
    await page.goto(`${BASE}?${q}&frames=${frames}`, { waitUntil: 'load' });
    try {
      await page.waitForFunction(() => document.body.dataset.done === '1' || document.body.dataset.error === '1', null, { timeout: 400000, polling: 1000 });
    } catch (e) {
      log.push(`[${name}] TIMEOUT waiting for frames`);
    }
    if (q.includes('contextloss=1')) {
      const ok = await page.evaluate(() => window.__harness.loseContext(800));
      log.push(`[${name}] loseContext → ${ok}`);
    }
    if (name === 'thumbs') {
      try {
        await page.waitForFunction(() => document.querySelectorAll('img[data-loaded="1"]').length >= 12, null, { timeout: 120000 });
      } catch {
        log.push(`[${name}] thumbnails did not all load`);
      }
    }
    const info = await page.evaluate(() => {
      const h = window.__harness;
      return h ? { ready: h.ready, frames: h.frames, frameMs: Math.round(h.frameMs), libs: h.libs, sim: h.sim, error: h.error, stats: h.stats() } : null;
    });
    log.push(`[${name}] ${((Date.now() - t0) / 1000).toFixed(1)}s ${JSON.stringify(info)}`);
    // in-page capture (compositor screenshots of SwiftShader WebGL are extremely slow in headless Chromium)
    const url = await page.evaluate(() => {
      try {
        return window.__harness && window.__harness.capture();
      } catch (e) {
        return 'ERR ' + String(e);
      }
    });
    if (url && url.startsWith('data:image/png;base64,')) fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(url.slice(22), 'base64'));
    else log.push(`[${name}] capture failed: ${String(url).slice(0, 200)}`);
    console.log('shot', name);
  } catch (e) {
    log.push(`[${name}] FAILED: ${e.message.split('\n')[0]}`);
    console.log('failed', name, e.message.split('\n')[0]);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS);
  const log = [];
  for (const name of names) {
    const q = SHOTS[name];
    if (!q) {
      console.error('unknown shot', name);
      continue;
    }
    await shoot(name, q, log);
    fs.writeFileSync(path.join(OUT, 'console.log'), log.join('\n') + '\n');
  }
  console.log(log.filter((l) => /error|PAGEERROR|TIMEOUT|warn|FAILED|CRASH|capture failed/i.test(l)).slice(0, 60).join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
