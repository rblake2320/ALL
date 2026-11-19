// Real-browser check of the economy HUD keyboard path (helper/keynav-economy-hud): F6 reaches the Bones / Store /
// Quests region, Tab leaves it into the HUD root and wraps back, Shift+Tab from the HUD's first stop lands on the
// economy HUD's last stop, and every landing point is inside the viewport.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import path from 'node:path';
import { ensureBuild, startPreview } from '../../tests/e2e/lib/server.mjs';
import { waitFor } from '../../tests/e2e/lib/waits.mjs';
const ROOT = path.resolve(import.meta.dirname, '../..');
const distDir = path.join(ROOT, 'dist');
const log = (s) => console.log(s);
const fails = [];
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) fails.push(name); };
await ensureBuild({ root: ROOT, distDir, mode: process.argv.includes('--no-build') ? 'never' : 'auto', log });
const server = await startPreview({ root: ROOT, distDir, log });
const browser = await chromium.launch();
try {
  for (const vp of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport: vp });
    await page.goto(server.url);
    await waitFor(page, 'menu', (s) => window.__afterlife?.game?.screen === s, 'menu');
    await page.evaluate(() => { const g = window.__afterlife.game; g.beginNewGame(); return g.startGame(); });
    await waitFor(page, 'game', (s) => window.__afterlife.game.screen === s, 'game');
    await page.evaluate(() => window.__afterlife.game.setSpeed(0));
    await page.waitForTimeout(1500);
    const where = () => page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return { region: null, body: true };
      const r = a.getBoundingClientRect();
      const reg = a.closest('[data-hud-region]');
      const inView = r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5;
      return { region: reg?.getAttribute('data-hud-region') ?? null, eco: !!a.closest('[data-testid="economy-hud"]'), inView, label: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 40) };
    });
    const tag = `${vp.width}x${vp.height}`;
    const hasEco = await page.locator('[data-testid="economy-hud"]').count();
    check(`${tag}: economy HUD is mounted`, hasEco > 0);
    if (!hasEco) { await page.close(); continue; }
    // F6 cycle: does it reach region 15?
    let reached = null;
    const seen = [];
    for (let i = 0; i < 16 && !reached; i++) {
      await page.keyboard.press('F6');
      await page.waitForTimeout(120);
      const w = await where();
      seen.push(w.region ?? (w.body ? 'body' : '?'));
      if (w.eco) reached = w;
    }
    check(`${tag}: F6 reaches the economy HUD`, !!reached, `cycle: ${seen.join(' → ')}`);
    if (reached) check(`${tag}: its focused control is in view`, reached.inView, reached.label);
    // Tab through the economy HUD until focus leaves it; then keep tabbing until it comes back (wrap)
    let left = null, back = null, outOfView = [];
    for (let i = 0; i < 120 && !(left && back); i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(40);
      const w = await where();
      if (w.body) { outOfView.push('body'); break; }
      if (!w.inView) outOfView.push(`${w.region}:${w.label}`);
      if (!left && !w.eco) left = w;
      else if (left && w.eco) back = w;
    }
    check(`${tag}: Tab leaves the economy HUD into the HUD`, !!left && left.region !== null, left ? `${left.region}:${left.label}` : 'never left');
    check(`${tag}: Tab wraps back to the economy HUD`, !!back);
    check(`${tag}: no Tab stop out of view or on <body>`, outOfView.length === 0, outOfView.slice(0, 5).join(', '));
    // Shift+Tab: the step back into the economy HUD lands on a control in view
    let backIn = null;
    const shiftOut = [];
    for (let i = 0; i < 120 && !backIn; i++) {
      await page.keyboard.press('Shift+Tab');
      await page.waitForTimeout(40);
      const w = await where();
      if (w.body) { shiftOut.push('body'); break; }
      if (!w.inView) shiftOut.push(`${w.region}:${w.label}`);
      if (w.eco && i > 0) backIn = w;
    }
    check(`${tag}: Shift+Tab reaches the economy HUD`, !!backIn, backIn?.label ?? '');
    check(`${tag}: no Shift+Tab stop out of view or on <body>`, shiftOut.length === 0, shiftOut.slice(0, 5).join(', '));
    await page.close();
  }
} finally {
  await browser.close();
  await server.stop();
}
console.log(fails.length ? `ECON KEYNAV FAILED (${fails.length})` : 'ECON KEYNAV PASSED');
process.exit(fails.length ? 1 : 0);
