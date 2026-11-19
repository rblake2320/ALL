/**
 * UI-HUD main-thread cost against the mock controller (plain Chromium, no WebGL — measures the HUD alone).
 *   node dev/ui-hud.perf.cjs [--seconds=10]      (harness served on :5178, e.g. HUD_HMR=0 npx vite --config dev/ui-hud.vite.config.ts)
 *
 * Scenarios (stress data: 8 members, 30 moodlets, 24 relationships, 12 queued orders, long toasts):
 *   notify12  — the controller notifying 12×/s (its in-game cadence) with the clock advancing: HUD re-render cost
 *   bubbles   — no notifications, 6 bubbles following moving anchors every frame: per-frame loop cost + allocations
 *   idle      — nothing changing: the HUD must cost ~nothing
 * Prints ms of script / layout / style per second, DOM nodes, and (bubbles) heap allocated per second by HUD code.
 */
const { chromium } = require('playwright');

const BASE = process.env.HUD_URL || 'http://localhost:5178/dev/ui-hud.html';
const SECONDS = Number((process.argv.find((a) => a.startsWith('--seconds=')) || '--seconds=10').slice(10)) || 10;

async function metrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

async function run(browser, name, query, setup) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`${BASE}?${query}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  if (setup) await page.evaluate(setup);
  await page.waitForTimeout(500);
  const a = await metrics(cdp);
  let sampling = null;
  if (name === 'bubbles') {
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.startSampling', { samplingInterval: 512 });
  }
  await page.waitForTimeout(SECONDS * 1000);
  if (name === 'bubbles') {
    const { profile } = await cdp.send('HeapProfiler.stopSampling');
    // attribute sampled allocations to HUD source (src/ui/hud) vs everything else
    let hud = 0;
    let total = 0;
    const byFn = new Map();
    const walk = (node, stack) => {
      const url = node.callFrame.url || '';
      const here = url.includes('/src/ui/hud/') ? `${node.callFrame.functionName || '(anon)'} @ ${url.split('/src/ui/hud/')[1]}:${node.callFrame.lineNumber + 1}` : null;
      const inHud = stack || here;
      total += node.selfSize;
      if (inHud) {
        hud += node.selfSize;
        const k = here || stack;
        byFn.set(k, (byFn.get(k) || 0) + node.selfSize);
      }
      for (const c of node.children || []) walk(c, inHud);
    };
    walk(profile.head, null);
    sampling = { hudBytesPerSec: Math.round(hud / SECONDS), totalBytesPerSec: Math.round(total / SECONDS), top: [...byFn.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, v]) => `${k}: ${Math.round(v / SECONDS)} B/s`) };
  }
  const b = await metrics(cdp);
  const per = (k) => +(((b[k] - a[k]) * 1000) / SECONDS).toFixed(2);
  const res = {
    scenario: name,
    scriptMsPerSec: per('ScriptDuration'),
    layoutMsPerSec: per('LayoutDuration'),
    styleMsPerSec: per('RecalcStyleDuration'),
    taskMsPerSec: per('TaskDuration'),
    layouts: b.LayoutCount - a.LayoutCount,
    styleRecalcs: b.RecalcStyleCount - a.RecalcStyleCount,
    domNodes: b.Nodes,
    hudNodes: await page.evaluate(() => document.querySelectorAll('.hud *').length),
    jsHeapMB: +(b.JSHeapUsedSize / 1048576).toFixed(1),
    ...(sampling ? { alloc: sampling } : {}),
  };
  await page.close();
  return res;
}

(async () => {
  const browser = await chromium.launch();
  const out = [];
  // 12 notifications/s with the clock moving (re-renders every subscribed component)
  out.push(
    await run(browser, 'notify12', 'mode=live&stress=1&tab=mood&toasts=3&party=1&bubbles=0', () => {
      const g = window.__hud.game;
      window.__iv = setInterval(() => g.advance(1), 83);
    }),
  );
  // per-frame bubble loop only: anchors move every frame (live=1), no controller notifications
  out.push(await run(browser, 'bubbles', 'mode=live&live=1&speed=0&bubbles=1', null));
  out.push(await run(browser, 'idle', 'mode=live&stress=1&tab=needs&bubbles=0&speed=0', null));
  for (const r of out) console.log(JSON.stringify(r));
  await browser.close();
})();
