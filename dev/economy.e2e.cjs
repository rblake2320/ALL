/**
 * ECONOMY real-browser check (Playwright + SwiftShader): built game → first-run age gate → store → new game → complete
 * the first story quest → Bones granted once (reload, still once) → unlock an item in the store → place it in Buy
 * mode. Fails on ANY console error / page error. Screenshots: dev/out/economy/.
 *
 *   npx vite build --outDir dev/out/economy/build && npx vite preview --outDir dev/out/economy/build --port 5191 --strictPort &
 *   node dev/economy.e2e.cjs dev/out/economy http://localhost:5191/
 */
const { chromium } = require('playwright');
const path = require('path');
const out = process.argv[2] || path.join(__dirname, 'out', 'economy');
const url = process.argv[3] || 'http://localhost:5191/';

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.setDefaultTimeout(240000);
  const errors = [];
  const warnings = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    else if (m.type() === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  const G = (fn, arg) => page.evaluate(fn, arg);
  const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
  const waitFor = async (pred, ms, what) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await G(pred).catch(() => null);
      if (v) return v;
      if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
      await page.waitForTimeout(250);
    }
  };
  const econ = () => G(() => {
    const e = window.__afterlife.game.economy;
    const l = e.ledgerSnapshot;
    return { bones: e.wallet.bones, ok: e.wallet.ledgerOk, keys: l ? l.entries.map((x) => x.key) : [], bracket: e.age.bracket, toasts: e.toasts.map((t) => t.title) };
  });
  const report = {};
  // SwiftShader renders on the CPU: CSS fade-ins only advance between (slow) frames — wait until the panel is opaque.
  const settled = () => waitFor(() => { const tp = document.querySelector('.st-dialog .ui-tabpanel'); return !!tp && getComputedStyle(tp).opacity === '1'; }, 60000, 'store panel visible');
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await waitFor(() => window.__afterlife && window.__afterlife.game.screen === 'menu', 300000, 'menu');
    await G(() => window.__afterlife.game.updateSettings({ quality: 'low', pixelRatio: 0.5 }));
    // 1. first-run age gate (neutral year-of-birth)
    await page.waitForSelector('[data-testid="age-year"]', { timeout: 30000, state: 'visible' });
    await page.waitForTimeout(1500);
    await shot('01-age-gate');
    await page.fill('[data-testid="age-year"]', '1990');
    await page.click('[data-testid="age-continue"]');
    await waitFor(() => window.__afterlife.game.economy.age.bracket === 'adult', 5000, 'bracket');
    report.ageStored = await G(() => JSON.stringify(window.__afterlife.game.economy.age));
    // 2. store from the main menu
    await page.getByRole('button', { name: /^Store/ }).click();
    await page.waitForSelector('.st-dialog');
    await settled();
    await shot('02-store-featured');
    await page.getByRole('tab', { name: 'Grave Gold' }).click();
    await settled();
    await shot('03-store-gold');
    await page.click('[data-testid="buy-gg:coffin_stash"]');
    report.ggStatus = await page.textContent('[data-testid="store-status"]');
    await page.getByRole('tab', { name: 'Bundles' }).click();
    await settled();
    await shot('04-store-bundles');
    await page.keyboard.press('Escape');
    await waitFor(() => window.__afterlife.game.dialog === null, 5000, 'store closed');
    // 3. new game
    await G(() => window.__afterlife.game.beginNewGame());
    await page.waitForTimeout(800);
    await G(() => window.__afterlife.game.startGame());
    await waitFor(() => window.__afterlife.game.screen === 'game', 120000, 'game');
    await page.waitForTimeout(2000);
    await shot('05-game-hud');
    // 4. complete the first story quest (Brains for Dinner: cook a meal, eat a meal) — queued like a player would.
    await G(() => {
      const g = window.__afterlife.game;
      const s = g.sim.state;
      const fridge = Object.values(s.objects).find((o) => o.defId === 'fridge_humming');
      const a = s.household.memberIds[0];
      g.sim.dispatch({ type: 'queue', actorId: a, interactionId: 'home_cook', target: { kind: 'object', id: fridge.id }, params: { recipe: 'brainLoaf' } });
      g.setSpeed(3);
    });
    await waitFor(() => (window.__afterlife.game.sim.state.quests.completions.story_firstMeal || 0) >= 1, 900000, 'first story quest');
    await waitFor(() => window.__afterlife.game.economy.wallet.bones >= 30, 20000, 'bones granted');
    await G(() => window.__afterlife.game.setSpeed(0));
    await page.waitForTimeout(400);
    await shot('06-quest-granted');
    const e1 = await econ();
    report.afterQuest = e1;
    const questKeys = e1.keys.filter((k) => k.endsWith(':story_firstMeal:1'));
    if (questKeys.length !== 1) throw new Error(`expected exactly one first-quest grant, got ${questKeys.length}`);
    // 5. save, reload, continue: still exactly once (the world's grant record is reconciled → duplicate, refused)
    await G(() => window.__afterlife.game.saveGame());
    await page.waitForTimeout(800);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitFor(() => window.__afterlife && window.__afterlife.game.screen === 'menu', 300000, 'menu after reload');
    await waitFor(() => window.__afterlife.game.economy.ready, 10000, 'economy ready');
    if (await G(() => window.__afterlife.game.economy.needsAgeGate)) throw new Error('age gate asked twice');
    await G(() => window.__afterlife.game.continueLatest());
    await waitFor(() => window.__afterlife.game.screen === 'game', 120000, 'game after reload');
    await G(() => window.__afterlife.game.setSpeed(3));
    await page.waitForTimeout(6000);
    await G(() => window.__afterlife.game.setSpeed(0));
    const e2 = await econ();
    report.afterReload = e2;
    if (e2.keys.filter((k) => k.endsWith(':story_firstMeal:1')).length !== 1) throw new Error('first-quest grant not exactly once after reload');
    // 6. unlock an item with Bones (keyboard shortcut G opens the store)
    await page.mouse.move(640, 360);
    await page.keyboard.press('KeyG');
    await page.waitForSelector('.st-dialog');
    await page.getByRole('tab', { name: 'Items' }).click();
    await settled();
    await shot('07-store-items');
    const before = await econ();
    await page.click('[data-testid="unlock-item:candelabra_drippy"]');
    await waitFor(() => window.__afterlife.game.economy.isUsable('candelabra_drippy'), 10000, 'unlocked');
    await page.waitForTimeout(300);
    await shot('08-unlocked');
    const after = await econ();
    report.unlock = { before: before.bones, after: after.bones };
    await page.keyboard.press('Escape');
    // 7. place it in Buy mode (costs household $ as usual)
    await page.keyboard.press('KeyB');
    await page.waitForTimeout(600);
    const funds0 = await G(() => window.__afterlife.game.sim.state.household.funds);
    const count = () => G(() => Object.values(window.__afterlife.game.sim.state.objects).filter((o) => o.defId === 'candelabra_drippy').length);
    const n0 = await count();
    await G(() => window.__afterlife.game.setBuyCategory('lighting'));
    await page.waitForTimeout(500);
    await shot('09-buy-lighting');
    await G(() => window.__afterlife.game.startPlacing('candelabra_drippy'));
    let placed = false;
    for (const [x, y] of [[640, 380], [600, 400], [700, 420], [560, 340], [720, 330], [520, 420], [660, 300], [760, 400]]) {
      await page.mouse.move(x, y);
      await page.waitForTimeout(250);
      await page.mouse.click(x, y);
      await page.waitForTimeout(400);
      if ((await count()) > n0) {
        placed = true;
        break;
      }
      await G(() => { const g = window.__afterlife.game; if (!g.buy.placingDefId) g.startPlacing('candelabra_drippy'); });
    }
    await page.waitForTimeout(500);
    await shot('10-placed');
    const funds1 = await G(() => window.__afterlife.game.sim.state.household.funds);
    report.placed = { placed, funds0, funds1 };
    if (!placed) throw new Error('could not place the unlocked candelabra');
    // a locked item cannot be placed: it opens the store instead
    await G(() => window.__afterlife.game.cancelPlacement());
    await G(() => window.__afterlife.game.startPlacing('sofa_velvet'));
    report.lockedOpensStore = await G(() => ({ dialog: window.__afterlife.game.dialog, placing: window.__afterlife.game.buy.placingDefId }));
    await page.waitForTimeout(500);
    await shot('11-locked-opens-store');
    report.errors = errors;
    report.warnings = warnings.length;
    console.log(JSON.stringify(report, null, 2));
    if (errors.length) throw new Error(`console errors: ${errors.join(' | ')}`);
    console.log('ECONOMY E2E: PASS');
  } catch (e) {
    await shot('99-failure').catch(() => undefined);
    console.log(JSON.stringify({ ...report, errors, warnings }, null, 2));
    console.error('ECONOMY E2E: FAIL', e && e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
