/**
 * UI-SHELL keyboard / accessibility interaction checks against the dev harness (dev only).
 *   npx vite --config dev/ui-shell.vite.config.ts &   node dev/ui-shell.a11y.cjs
 */
const { chromium } = require('playwright');

const BASE = process.env.UI_SHELL_URL || 'http://localhost:5177/dev/ui-shell.html';
let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failed++;
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const open = async (q) => {
    await page.goto(`${BASE}?${q}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.ui-root');
    await page.waitForTimeout(900);
  };
  const dialog = () => page.evaluate(() => window.__game.dialog);
  const inModal = () => page.evaluate(() => {
    const m = [...document.querySelectorAll('.ui-modal')].pop();
    return !!m && m.contains(document.activeElement);
  });

  // 1. Focus starts inside the dialog and Tab never escapes it.
  await open('screen=menu&dialog=settings');
  check('settings: focus starts inside the dialog', await inModal());
  let trapped = true;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press(i % 7 === 6 ? 'Shift+Tab' : 'Tab');
    if (!(await inModal())) trapped = false;
  }
  check('settings: Tab / Shift+Tab stay trapped', trapped);

  // 2. Arrow keys move between tabs (automatic activation).
  await page.getByRole('tab', { name: /^Graphics/ }).focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  const sel = await page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent);
  check('settings: ArrowRight selects the next tab', sel === 'Audio', sel);
  await page.keyboard.press('End');
  await page.waitForTimeout(150);
  const last = await page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent);
  check('settings: End selects the last tab', last === 'Accessibility', last);

  // 3. Slider keyboard.
  const scale0 = await page.evaluate(() => window.__game.settings.uiScale);
  await page.locator('[role="slider"]').first().focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  const scale1 = await page.evaluate(() => window.__game.settings.uiScale);
  check('accessibility: ArrowRight steps the UI scale slider', Math.abs(scale1 - scale0 - 0.1) < 1e-6, `${scale0} → ${scale1}`);
  const rootScale = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim());
  check('accessibility: --ui-scale applied to <html>', rootScale === String(scale1), rootScale);

  // 4. Nested Esc closes only the innermost layer.
  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  await page.waitForTimeout(300);
  const twoModals = await page.evaluate(() => document.querySelectorAll('.ui-modal').length);
  check('reset: confirm opens on top', twoModals === 2, String(twoModals));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const afterEsc = await page.evaluate(() => document.querySelectorAll('.ui-modal').length);
  check('reset: Esc closes only the confirm', afterEsc === 1 && (await dialog()) === 'settings', `${afterEsc} modal(s), dialog=${await dialog()}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('settings: second Esc closes the dialog', (await dialog()) === null);

  // 5. Child dialog returns to its parent.
  await open('screen=game&dialog=pause');
  await page.getByRole('button', { name: /Settings/ }).click();
  await page.waitForTimeout(300);
  check('pause → settings', (await dialog()) === 'settings');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('settings Esc returns to pause', (await dialog()) === 'pause', String(await dialog()));
  await page.getByRole('button', { name: /Save Game/ }).click();
  await page.waitForTimeout(400);
  const saveTab = await page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent);
  check('pause → Save Game opens on the Save tab', saveTab === 'Save', saveTab);
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.waitForTimeout(300);
  check('saves Close returns to pause', (await dialog()) === 'pause', String(await dialog()));

  // 6. Main menu: arrows from nowhere land in the menu.
  await open('screen=menu');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);
  const focused = await page.evaluate(() => document.activeElement?.classList.contains('sh-menu__item'));
  check('menu: ArrowDown focuses the first item', !!focused);
  await page.keyboard.press('ArrowDown');
  const label = await page.evaluate(() => document.activeElement?.querySelector('.sh-menu__label')?.textContent);
  check('menu: ArrowDown moves to the next item', label === 'New Game', label);

  // 7. Tooltip on keyboard focus.
  await open('screen=game&dialog=pause');
  await page.keyboard.press('Shift+Tab');
  await page.waitForTimeout(300);
  const tipVisible = await page.evaluate(() => !!document.querySelector('.ui-tooltip'));
  check('tooltip appears on keyboard focus of an icon button', tipVisible);

  // 8. CAZ trait rules through the UI.
  await open('screen=caz');
  await page.getByRole('tab', { name: /^Personality/ }).click();
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => window.__game.caz.members[0].traits.slice());
  await page.locator('.sh-trait.is-blocked').first().click({ force: true });
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => window.__game.caz.members[0].traits.slice());
  check('caz: clicking a conflicting trait changes nothing', JSON.stringify(before) === JSON.stringify(after));
  await page.locator('.sh-trait.is-on').first().click();
  await page.waitForTimeout(200);
  const removed = await page.evaluate(() => window.__game.caz.members[0].traits.length);
  check('caz: clicking a chosen trait removes it', removed === 2, String(removed));
  await page.getByRole('button', { name: /Start the Afterlife/ }).click();
  await page.waitForTimeout(400);
  const stillCaz = await page.evaluate(() => window.__game.screen);
  const alert = await page.evaluate(() => document.querySelector('.sh-inline-issue')?.textContent ?? '');
  check('caz: Start with issues stays on CAZ and explains', stillCaz === 'caz' && alert.length > 0, alert);

  // 9. Error boundary renders the fatal screen.
  await open('screen=game&crash=1');
  const fatal = await page.evaluate(() => !!document.querySelector('.sh-fatal'));
  check('crash: error boundary shows the fatal screen', fatal);

  // 10. The fatal screen takes focus (alertdialog) so keyboard players can act.
  const fatalFocus = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
  check('crash: focus lands on Reload', /Reload/.test(fatalFocus), fatalFocus);

  // 11. A crash inside a portal tree (dialog/tooltip) still reaches the fatal screen.
  await open('screen=game&crash=overlay');
  await page.waitForTimeout(900);
  const overlayFatal = await page.evaluate(() => !!document.querySelector('.sh-fatal'));
  check('crash in a portal (dialog layer) shows the fatal screen', overlayFatal);

  // 12. Keyboard continuity: Enter on "New Game" lands on the selected lot card.
  await open('screen=menu');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  const ngFocus = await page.evaluate(() => {
    const a = document.activeElement;
    return a ? `${a.getAttribute('role')}:${a.getAttribute('aria-checked')}` : 'none';
  });
  check('new game: focus lands on the selected lot', ngFocus === 'radio:true', ngFocus);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  const lotNow = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  check('new game: arrows switch lots right away', lotNow === 'Empty Plot', String(lotNow));

  // 13. Settings opens with focus on the selected tab (arrows work immediately).
  await open('screen=game&dialog=settings');
  const setFocus = await page.evaluate(() => document.activeElement?.getAttribute('role') + ':' + document.activeElement?.textContent);
  check('settings: focus starts on the selected tab', setFocus === 'tab:Graphics', setFocus);

  // 14. UI scale applies on release, not mid-drag (no feedback loop under the pointer).
  await page.getByRole('tab', { name: /^Accessibility/ }).click();
  await page.waitForTimeout(300);
  const slider = page.locator('[role="slider"]').first();
  const box = await slider.boundingBox();
  const before14 = await page.evaluate(() => window.__game.settings.uiScale);
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.95, box.y + box.height / 2, { steps: 6 });
  const during = await page.evaluate(() => window.__game.settings.uiScale);
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after14 = await page.evaluate(() => window.__game.settings.uiScale);
  check('ui scale: unchanged while dragging', during === before14, `${before14} → ${during}`);
  check('ui scale: applied on release', after14 > before14, `${before14} → ${after14}`);

  // 15. "New save" creates a new slot instead of overwriting the world's manual slot.
  await open('screen=game&dialog=saveLoad');
  const n0 = await page.evaluate(async () => (await window.__game.listSaves()).length);
  await page.getByRole('button', { name: /^Save$/ }).click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /^Save$/ }).click();
  await page.waitForTimeout(700);
  const ids = await page.evaluate(async () => (await window.__game.listSaves()).map((x) => x.slotId));
  check('saves: two "new" saves make two new slots', ids.length === n0 + 2 && ids.filter((x) => x.startsWith('save-')).length >= 2, `${n0} → ${ids.length}`);

  // 16. Shell toasts on the menu: visible, dismissible, and they expire on their own.
  await open('screen=menu&toasts=1');
  const toastCount = await page.evaluate(() => document.querySelectorAll('.sh-toasts .ui-toast').length);
  check('toasts: shown on the main menu', toastCount === 2, String(toastCount));
  await page.locator('.sh-toasts button[aria-label="Dismiss"]').first().click();
  await page.waitForTimeout(300);
  const afterDismiss = await page.evaluate(() => window.__game.toasts.length);
  check('toasts: dismiss button removes one', afterDismiss === 1, String(afterDismiss));
  await page.mouse.move(5, 5);
  await page.waitForTimeout(6800);
  const afterExpire = await page.evaluate(() => window.__game.toasts.length);
  check('toasts: expire after ~6 s', afterExpire === 0, String(afterExpire));

  // 17. CAZ turntable is a slider: arrow keys turn it and report the angle.
  await open('screen=caz');
  await page.locator('.sh-stage__canvas').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  const yaw = await page.evaluate(() => document.querySelector('.sh-stage__canvas')?.getAttribute('aria-valuenow'));
  check('caz: turntable ArrowRight reports 15°', yaw === '15', String(yaw));

  // 18. Key combos are audible: Kbd renders real (visually hidden) text.
  await open('screen=game&dialog=help');
  await page.getByRole('tab', { name: /^Controls/ }).click();
  await page.waitForTimeout(300);
  const spoken = await page.evaluate(() => document.querySelector('.sh-keymap .ui-kbd-combo .u-sr-only')?.textContent ?? '');
  check('help: key chips carry screen-reader text', spoken.length > 0, spoken);

  // 19. Esc walks back through the new-game flow, one layer at a time.
  await open('screen=caz');
  await page.locator('.sh-member').nth(1).hover();
  await page.locator('.sh-member__remove').nth(1).click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const afterConfirmEsc = await page.evaluate(() => ({ screen: window.__game.screen, modals: document.querySelectorAll('.ui-modal').length, members: window.__game.caz.members.length }));
  check('caz: Esc closes only the remove-member confirm', afterConfirmEsc.screen === 'caz' && afterConfirmEsc.modals === 0 && afterConfirmEsc.members === 2, JSON.stringify(afterConfirmEsc));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('caz: Esc returns to New Game', (await page.evaluate(() => window.__game.screen)) === 'newGame');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('new game: Esc returns to the main menu', (await page.evaluate(() => window.__game.screen)) === 'menu');

  // 20. Reduce motion: the player's setting collapses animations to (near) zero.
  await open('screen=menu&motion=reduce');
  const motion = await page.evaluate(() => {
    const li = document.querySelector('.sh-menu__list > li');
    const d = li ? getComputedStyle(li).animationDuration : 'none';
    return { cls: document.documentElement.classList.contains('reduce-motion'), d };
  });
  check('reduce motion: html.reduce-motion set and menu animations collapse', motion.cls && parseFloat(motion.d) < 0.01, JSON.stringify(motion));

  // 21. Colour-blind need bars: patterns + glyphs, not colour alone.
  await open('screen=game&dialog=settings&cb=1');
  await page.getByRole('tab', { name: /^Accessibility/ }).click();
  await page.waitForTimeout(300);
  const cb = await page.evaluate(() => {
    const fill = document.querySelector('.sh-cb-preview .ui-need__fill[data-band="low"]');
    const glyph = document.querySelector('.sh-cb-preview .ui-need__glyph');
    return { cls: document.documentElement.classList.contains('cb-needs'), pattern: fill ? getComputedStyle(fill).backgroundImage.includes('gradient') : false, glyph: glyph ? getComputedStyle(glyph).display : 'none' };
  });
  check('colour-blind: low band is patterned and glyphs show', cb.cls && cb.pattern && cb.glyph !== 'none', JSON.stringify(cb));

  const realErrors = errors.filter((e) => !/simulated render crash|simulated crash inside a portal/.test(e));
  check('no unexpected page errors', realErrors.length === 0, realErrors.join(' | '));
  await browser.close();
  process.exitCode = failed ? 1 : 0;
  console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
})();
