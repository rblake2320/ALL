/**
 * PLATFORM real-browser check (Playwright + Chromium): real IndexedDB, Web Locks across two tabs,
 * CompressionStream, WebCrypto, durability across a reload, recovery from a corrupted primary in the real
 * store, and the desktop quit hook. Starts its own Vite dev server on port 5181 (PLATFORM's port).
 *
 *   bash:        node dev/platform.e2e.cjs
 *   PowerShell:  node dev/platform.e2e.cjs
 *
 * Exit code 0 = every step passed. Results are printed one line per step.
 */
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.AFTERLIFE_PLATFORM_PORT || 5181);

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: ROOT, logLevel: 'warn', server: { port: PORT, strictPort: true, hmr: false } });
  await server.listen();
  const url = `http://localhost:${PORT}/dev/platform.html`;
  const browser = await chromium.launch();
  let failed = 0;
  const report = (label, results) => {
    for (const r of results) {
      if (!r.ok) failed++;
      console.log(`${r.ok ? 'PASS' : 'FAIL'} [${label}] ${r.name}${r.detail ? ` — ${r.detail.split('\n')[0]}` : ''}`);
      if (!r.ok && r.detail.includes('\n')) console.log(r.detail);
    }
  };
  try {
    const context = await browser.newContext();
    const open = async () => {
      const page = await context.newPage();
      page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => !!window.__platform, null, { timeout: 60000 });
      return page;
    };
    const a = await open();
    report('write', await a.evaluate(() => window.__platform.run('write')));
    await a.reload({ waitUntil: 'load' });
    await a.waitForFunction(() => !!window.__platform, null, { timeout: 60000 });
    report('reload', await a.evaluate(() => window.__platform.run('verify')));
    const b = await open();
    const [ra, rb] = await Promise.all([a.evaluate(() => window.__platform.run('contend', 1)), b.evaluate(() => window.__platform.run('contend', 2))]);
    report('tab A', ra);
    report('tab B', rb);
    report('final', await b.evaluate(() => window.__platform.run('final')));
  } finally {
    await browser.close();
    await server.close();
  }
  console.log(failed === 0 ? 'ALL PASSED' : `${failed} step(s) FAILED`);
  process.exitCode = failed === 0 ? 0 : 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
