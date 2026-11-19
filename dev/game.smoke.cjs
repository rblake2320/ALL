/**
 * GAME browser smoke test (Playwright + SwiftShader WebGL): boot → menu → reload with low quality (settings persist)
 * → New Game → CAZ → game → click (interaction menu) → speed 3 → buy ghost → build → save → quit → continue.
 * Screenshots + diagnostics go to dev/out/game/.
 *
 *   bash:        npx vite build --outDir dist && npx vite preview --outDir dist --port 5173 --strictPort &
 *                node dev/game.smoke.cjs dev/out/game http://localhost:5173/
 *   PowerShell:  npx vite build --outDir dist; Start-Process -NoNewWindow npx.cmd -ArgumentList 'vite','preview','--outDir','dist','--port','5173','--strictPort'
 *                node dev/game.smoke.cjs dev/out/game http://localhost:5173/
 *
 * SwiftShader renders on the CPU: expect minutes per step in a container; on a real GPU it takes seconds.
 */
// Browser smoke test for the GAME module: boot → menu → new game → CAZ → game → buy → quit.
const { chromium } = require('playwright');
const out = process.argv[2] || require('path').join(__dirname, 'out', 'game');
const url = process.argv[3] || 'http://localhost:5173/';
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await context.newPage();
  page.setDefaultTimeout(180000);
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const state = () => page.evaluate(() => { const g = window.__afterlife && window.__afterlife.game; return g ? { screen: g.screen, fatal: g.fatalError, label: g.loadingLabel, progress: g.loadingProgress } : null; });
  const waitFor = async (pred, ms, what) => {
    const end = Date.now() + ms;
    for (;;) {
      const s = await state();
      if (s && pred(s)) return s;
      if (Date.now() > end) throw new Error(`timeout waiting for ${what}: ${JSON.stringify(s)}`);
      await page.waitForTimeout(250);
    }
  };
  try {
    await page.screenshot({ path: `${out}/00-boot.png` });
    const menu = await waitFor((s) => s.screen === 'menu' || s.fatal, 300000, 'menu');
    console.log('menu reached in', Date.now() - t0, 'ms', JSON.stringify(menu));
    // SwiftShader is CPU rendering: drop to low quality, persist, reload (also proves settings survive a reload).
    await page.evaluate(() => window.__afterlife.game.updateSettings({ quality: 'low', pixelRatio: 0.5 }));
    await page.waitForTimeout(1500);
    const t1 = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded' });
    const menu2 = await waitFor((s) => s.screen === 'menu' || s.fatal, 300000, 'menu after reload');
    const q = await page.evaluate(() => window.__afterlife.game.settings.quality + '/' + window.__afterlife.game.settings.pixelRatio);
    console.log('menu after reload in', Date.now() - t1, 'ms, settings', q, JSON.stringify(menu2));
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/01-menu.png` });
    await page.evaluate(() => window.__afterlife.game.goto('newGame'));
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}/02-newgame.png` });
    await page.evaluate(() => window.__afterlife.game.beginNewGame());
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/03-caz.png` });
    const errs = await page.evaluate(() => window.__afterlife.game.validateCaz());
    console.log('validateCaz:', JSON.stringify(errs));
    await page.evaluate(() => window.__afterlife.game.addCazMember());
    await page.evaluate(() => window.__afterlife.game.startGame());
    const g = await waitFor((s) => s.screen === 'game' || s.fatal, 60000, 'game');
    console.log('game reached', JSON.stringify(g));
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${out}/04-game.png` });
    const info = await page.evaluate(() => { const gm = window.__afterlife.game; return { speed: gm.speed, selected: gm.selectedAgentId, saveLabel: gm.lastSaveLabel, tick: gm.sim && gm.sim.state.tick, members: gm.sim && gm.sim.state.household.memberIds.length, hint: gm.hint && gm.hint.id, toasts: gm.toasts.map((t) => t.title) }; });
    console.log('in game:', JSON.stringify(info));
    // click the canvas centre (opens a menu if a zombie/object/tile is there)
    await page.mouse.click(480, 300);
    await page.waitForTimeout(500);
    const menuInfo = await page.evaluate(() => { const m = window.__afterlife.game.menu; return m ? { title: m.title, entries: m.entries.map((e) => e.label).slice(0, 6) } : null; });
    console.log('menu after click:', JSON.stringify(menuInfo));
    await page.screenshot({ path: `${out}/05-click.png` });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Digit3');
    await page.waitForTimeout(2000);
    const tick2 = await page.evaluate(() => window.__afterlife.game.sim.state.tick);
    console.log('tick after 2s at speed 3:', tick2, 'speed', await page.evaluate(() => window.__afterlife.game.speed));
    await page.keyboard.press('KeyB');
    await page.waitForTimeout(800);
    await page.evaluate(() => window.__afterlife.game.startPlacing('sofa_moldy'));
    await page.mouse.move(450, 310);
    await page.waitForTimeout(300);
    await page.mouse.move(460, 320);
    await page.waitForTimeout(500);
    const buy = await page.evaluate(() => { const gm = window.__afterlife.game; return { mode: gm.mode, speed: gm.speed, placing: gm.buy.placingDefId, label: gm.buildPreviewLabel }; });
    console.log('buy mode:', JSON.stringify(buy));
    await page.screenshot({ path: `${out}/06-buy.png` });
    await page.keyboard.press('Escape');
    await page.keyboard.press('KeyU');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/07-build.png` });
    await page.keyboard.press('KeyL');
    const saved = await page.evaluate(async () => { const r = await window.__afterlife.game.saveGame(); return r.ok ? r.info.slotId : r.error; });
    console.log('manual save:', saved);
    const slots = await page.evaluate(async () => (await window.__afterlife.game.listSaves()).map((s) => `${s.slotId}:${s.isAutosave}:${s.meta.thumbnail ? s.meta.thumbnail.length : 0}`));
    console.log('slots:', JSON.stringify(slots));
    // Export through the real PLATFORM exporter + browser download: the file keeps PLATFORM's .alsave name.
    if (typeof saved === 'string' && !saved.includes(' ')) {
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.evaluate((id) => window.__afterlife.game.exportSave(id), saved)]);
      const name = download.suggestedFilename();
      console.log('export filename:', name, name.endsWith('.alsave') && !name.endsWith('.alsave.json') ? 'OK' : 'UNEXPECTED');
    }
    // Keyboard ownership with a dialog open: Tab must reach the page (focus moves into the dialog), F5 must not reload.
    await page.evaluate(() => window.__afterlife.game.openDialog('help'));
    await page.waitForTimeout(300);
    const tabPrevented = await page.evaluate(() => {
      const e = new KeyboardEvent('keydown', { code: 'Tab', key: 'Tab', bubbles: true, cancelable: true });
      document.body.dispatchEvent(e);
      return e.defaultPrevented;
    });
    console.log('Tab prevented while dialog open:', tabPrevented, tabPrevented ? 'UNEXPECTED' : 'OK');
    await page.evaluate(() => window.__afterlife.game.closeDialog());
    await page.evaluate(() => window.__afterlife.game.quitToMenu());
    await waitFor((s) => s.screen === 'menu', 20000, 'menu after quit');
    console.log('back on menu');
    const cont = await page.evaluate(() => window.__afterlife.game.continueLatest());
    await waitFor((s) => s.screen === 'game', 20000, 'continue');
    console.log('continue:', cont);
    const diag = await page.evaluate(() => window.__afterlife.game.diagnostics());
    require('fs').writeFileSync(`${out}/diagnostics.txt`, diag);
  } catch (e) {
    console.log('SMOKE FAILURE:', e.message);
    await page.screenshot({ path: `${out}/99-failure.png` }).catch(() => {});
    const diag = await page.evaluate(() => window.__afterlife && window.__afterlife.game.diagnostics()).catch(() => null);
    if (diag) require('fs').writeFileSync(`${out}/diagnostics.txt`, diag);
  }
  console.log('--- console errors/warnings (' + logs.length + ') ---');
  for (const l of logs.slice(0, 40)) console.log(l);
  await browser.close();
})();
