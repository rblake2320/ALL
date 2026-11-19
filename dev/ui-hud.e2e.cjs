/**
 * UI-HUD behaviour checks against the mock controller (dev harness must be served on :5178:
 *   HUD_HMR=0 npx vite --config dev/ui-hud.vite.config.ts). `hotkeys=1` pages add controller-style hotkeys with the
 * real KEYMAP ownership rule, for the keyboard checks (backlog #16, F6 / Tab entry, stale Esc layers).
 *   node dev/ui-hud.e2e.cjs
 * Each check drives the real HUD with mouse/keyboard and asserts on the mock controller's call log / state.
 */
const { chromium } = require('playwright');
const BASE = process.env.HUD_URL || 'http://localhost:5178/dev/ui-hud.html';

const checks = [];
const check = (name, query, fn) => checks.push({ name, query, fn });
const log = (p) => p.evaluate(() => window.__hud.game.log.slice());
const game = (p, expr) => p.evaluate(expr);
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

check('speed buttons + ultra lock', 'mode=live&bubbles=0', async (p) => {
  await p.click('.hud-speed__btn[aria-label="Faster"]');
  assert((await game(p, () => window.__hud.game.speed)) === 3, 'speed 3 not set');
  await p.click('.hud-speed__btn[aria-label="Ultra speed"]', { force: true }); // aria-disabled: a real click must be inert
  assert((await game(p, () => window.__hud.game.speed)) === 3, 'locked ultra must not change speed');
  await p.click('.hud-speed__btn[aria-label="Pause"]');
  assert((await game(p, () => window.__hud.game.speed)) === 0, 'pause not set');
});

check('arrow keys move the speed radiogroup', 'mode=live&bubbles=0', async (p) => {
  await p.focus('.hud-speed__btn[aria-checked="true"]');
  await p.keyboard.press('ArrowRight');
  assert((await game(p, () => window.__hud.game.speed)) === 2, 'ArrowRight should go 1 → 2');
  await p.keyboard.press('ArrowLeft');
  await p.keyboard.press('ArrowLeft');
  assert((await game(p, () => window.__hud.game.speed)) === 0, 'ArrowLeft twice should reach pause');
});

check('mode switch + wall mode + camera', 'mode=live&bubbles=0', async (p) => {
  await p.click('.hud-modes .ui-seg__opt >> text=Build');
  assert((await game(p, () => window.__hud.game.mode)) === 'build', 'mode not build');
  await p.click('.hud-walls .ui-seg__opt[aria-label="Walls down"]');
  assert((await game(p, () => window.__hud.game.wallMode)) === 'down', 'wall mode not down');
  await p.click('button[aria-label="Rotate camera left"]');
  assert((await log(p)).includes('rotateCamera:-1'), 'rotateCamera(-1) not called');
});

check('portrait click selects, double-click focuses', 'mode=live&bubbles=0', async (p) => {
  await p.click('.hud-member >> nth=2');
  assert((await game(p, () => window.__hud.game.selectedAgentId)) === 'a3', 'a3 not selected');
  await p.dblclick('.hud-member >> nth=0');
  assert((await log(p)).includes('selectAgent:a1:focus'), 'double-click did not focus');
});

check('agent tabs via keyboard (roving tabindex)', 'mode=live&bubbles=0', async (p) => {
  await p.focus('.hud-agent__tabs .ui-tab[aria-selected="true"]');
  await p.keyboard.press('ArrowRight');
  await p.keyboard.press('ArrowRight');
  const sel = await p.getAttribute('.hud-agent__tabs .ui-tab[aria-selected="true"]', 'aria-label');
  assert(sel === 'Skills', `expected Skills tab, got ${sel}`);
  assert((await p.locator('.hud-skill').count()) === 6, 'skills not rendered');
});

check('queue cancel', 'mode=live&bubbles=0', async (p) => {
  await p.hover('.hud-qitem >> nth=0');
  await p.click('.hud-qitem >> nth=0 >> .hud-qcancel');
  assert((await log(p)).includes('cancel:12'), 'cancelQueueItem(12) not called');
  assert((await p.locator('.hud-qitem >> nth=3 >> .hud-qcancel').count()) === 0, 'system item must not be cancellable');
});

check('interaction menu: keyboard into group, choose, Esc closes', 'mode=live&menu=social&bubbles=0', async (p) => {
  await p.waitForSelector('.hud-imenu');
  await p.keyboard.press('ArrowRight'); // open Friendly
  await p.waitForSelector('.hud-imenu.is-flyout');
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('Enter'); // Tell a Gross Joke
  assert((await log(p)).some((l) => l === 'choose:social_joke'), 'joke not chosen: ' + (await log(p)).join(','));
});

check('interaction menu: disabled entry does nothing, Esc twice closes', 'mode=live&menu=social&bubbles=0', async (p) => {
  await p.hover('[data-key="g:Friendly"]');
  await p.waitForSelector('.hud-imenu.is-flyout');
  await p.click('.hud-imenu.is-flyout .hud-imenu__row.is-disabled', { force: true });
  assert(!(await log(p)).some((l) => l.startsWith('choose:')), 'disabled row must not choose');
  await p.keyboard.press('Escape');
  assert((await p.locator('.hud-imenu.is-flyout').count()) === 0, 'Esc should close the flyout first');
  await p.keyboard.press('Escape');
  assert((await log(p)).includes('closeMenu'), 'second Esc should close the menu');
});

check('interaction menu: click outside closes', 'mode=live&menu=fridge&bubbles=0', async (p) => {
  await p.waitForSelector('.hud-imenu');
  await p.mouse.click(1300, 500);
  assert((await log(p)).includes('closeMenu'), 'outside click should close');
});

check('child list chooses entry + child', 'mode=live&menu=fridge&bubbles=0', async (p) => {
  await p.click('[data-key^="e0:home_cook"]');
  await p.waitForSelector('.hud-imenu.is-flyout');
  await p.click('.hud-imenu.is-flyout >> text=Cerebellum Stew');
  assert((await log(p)).includes('choose:home_cook>Cerebellum Stew'), 'child not chosen');
});

check('dialog: Esc closes and focus returns', 'mode=live&bubbles=0', async (p) => {
  await p.click('.hud-agent__phone');
  await p.waitForSelector('[role="dialog"]');
  const focusedInside = await p.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  assert(focusedInside, 'focus should move into the dialog');
  await p.keyboard.press('Escape');
  assert((await game(p, () => window.__hud.game.dialog)) === null, 'Esc should close the dialog');
});

check('dialog focus trap wraps with Tab', 'mode=live&dialog=phone&bubbles=0', async (p) => {
  await p.waitForSelector('[role="dialog"]');
  for (let i = 0; i < 12; i++) await p.keyboard.press('Tab');
  const inside = await p.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  assert(inside, 'Tab must stay inside the dialog');
});

check('phone → pizza calls game.phone', 'mode=live&dialog=phone&bubbles=0', async (p) => {
  await p.click('.hud-ptile.is-pizza');
  assert((await log(p)).some((l) => l.startsWith('phone:pizza')), 'phone(pizza) not called');
  assert((await game(p, () => window.__hud.game.dialog)) === null, 'phone dialog should close');
});

check('phone → invite → townie', 'mode=live&dialog=phone&bubbles=0', async (p) => {
  await p.click('.hud-ptile.is-invite');
  await p.waitForSelector('.hud-dialog--invite');
  await p.click('.hud-townie >> nth=0 >> button');
  assert((await log(p)).some((l) => l === 'phone:invite:{"townieId":"t3"}'), 'invite params wrong: ' + (await log(p)).join(' | '));
});

check('party guest list sends picked guests', 'mode=live&dialog=invite&invite=party&bubbles=0', async (p) => {
  const c = p.locator('.hud-check:not([disabled])');
  await c.nth(0).click();
  await c.nth(1).click();
  await p.click('text=Send Invitations');
  assert((await log(p)).some((l) => l === 'phone:party:{"guests":"t3,t5"}'), 'party params wrong: ' + (await log(p)).join(' | '));
});

check('careers: employed zombie cannot take a new job', 'mode=live&dialog=careers&bubbles=0', async (p) => {
  const enabled = await p.locator('.hud-jobcard button:not([disabled])').count();
  assert(enabled === 0, 'all Take the Job buttons must be disabled while employed');
});

check('careers: unemployed zombie joins', 'mode=live&dialog=careers&select=a3&bubbles=0', async (p) => {
  await p.click('.hud-jobcard >> nth=3 >> text=Take the Job');
  assert((await log(p)).some((l) => l === 'phone:findJob:{"careerId":"culinary"}'), 'findJob params wrong: ' + (await log(p)).join(' | '));
});

check('rewards: buying deducts points and marks owned', 'mode=live&dialog=rewards&bubbles=0', async (p) => {
  await p.click('.hud-reward >> nth=1 >> text=Buy');
  await p.waitForSelector('.hud-rewards__status.is-ok');
  const owned = await p.locator('.hud-reward.is-owned').count();
  assert(owned === 2, `expected 2 owned rewards, got ${owned}`);
});

check('household rename validates, then saves', 'mode=live&dialog=household&bubbles=0', async (p) => {
  await p.click('.hud-hhname .ui-iconbtn');
  await p.fill('#hud-rename-input', '   ');
  await p.keyboard.press('Enter');
  assert((await p.locator('.hud-rename__error').count()) === 1, 'empty name should error');
  await p.fill('#hud-rename-input', '  The   Ghoulsbys  ');
  await p.keyboard.press('Enter');
  const name = await game(p, () => window.__hud.game.sim.state.household.name);
  assert(name === 'The Ghoulsbys', `rename failed: "${name}"`);
});

check('autonomy setting', 'mode=live&dialog=household&bubbles=0', async (p) => {
  await p.click('.ui-seg__opt >> text=Limited');
  assert((await game(p, () => window.__hud.game.settings.autonomy)) === 'limited', 'autonomy not updated');
});

check('choice popup resolves', 'mode=live&choice=1&bubbles=0', async (p) => {
  await p.click('.hud-choice__opt >> nth=1');
  assert((await log(p)).includes('resolveChoice:c1:1'), 'resolveChoice not called');
});

check('toast hover pauses auto-dismiss', 'mode=live&toasts=1&bubbles=0', async (p) => {
  await p.hover('.hud-toast');
  await p.waitForTimeout(7000);
  assert((await p.locator('.hud-toast').count()) === 1, 'hovered toast must stay');
  await p.mouse.move(700, 450);
  await p.waitForTimeout(6600);
  assert((await p.locator('.hud-toast').count()) === 0, 'toast should auto-dismiss after ~6s unhovered');
});

check('toast click focuses the agent', 'mode=live&toasts=3&bubbles=0', async (p) => {
  await p.click('.hud-toast >> nth=0 >> .hud-toast__main');
  assert((await log(p)).some((l) => l === 'selectAgent:a2:focus'), 'toast should focus Ophelia: ' + (await log(p)).join(' | '));
});

check('notices drawer opens, filters, Esc closes, marks read', 'mode=live&bubbles=0', async (p) => {
  await p.click('button[aria-label="Notices"]');
  await p.waitForSelector('.hud-log');
  await p.click('.hud-log .hud-chip >> text=Money');
  assert((await p.locator('.hud-logitem').count()) === 1, 'money filter should show 1 notice');
  assert((await log(p)).includes('markNotificationsRead'), 'opening should mark notices read');
  await p.keyboard.press('Escape');
  assert((await p.locator('.hud-log').count()) === 0, 'Esc should close the drawer');
});

check('buy: category, search, place, tint, rotate, cancel', 'mode=buy&cat=seating', async (p) => {
  await p.click('.hud-cat[aria-label="Kitchen"]');
  assert((await log(p)).includes('setBuyCategory:kitchen'), 'category not set');
  await p.fill('.hud-buy__search input', 'seance');
  assert((await p.locator('.hud-item').count()) === 1, 'search should find the Séance TV');
  await p.click('.hud-item');
  assert((await log(p)).some((l) => l.startsWith('startPlacing:tv_seance')), 'startPlacing not called');
  await p.click('.hud-detail__swatches .ui-swatch >> nth=1');
  assert((await log(p)).some((l) => l.startsWith('tint:#')), 'setPlacementTint not called');
  await p.click('button[aria-label="Rotate →"]');
  assert((await log(p)).includes('rotate:1'), 'rotatePlacement not called');
  await p.click('.hud-detail >> text=Cancel');
  assert((await log(p)).includes('cancelPlacement'), 'cancelPlacement not called');
});

check('buy: unaffordable item does not start placing', 'mode=buy&cat=beds&funds=420', async (p) => {
  await p.click('.hud-item.is-poor >> nth=0');
  assert(!(await log(p)).some((l) => l.startsWith('startPlacing')), 'poor item must not place');
});

check('buy: sell hovered object', 'mode=buy&hoverobj=1', async (p) => {
  await p.click('text=Sell for $255');
  assert((await log(p)).includes('sell:o4'), 'sellObject not called');
});

check('build: tool + style + whole room + undo', 'mode=build&tool=wall', async (p) => {
  await p.click('.hud-tool >> text=Paint');
  await p.click('.hud-style >> nth=4');
  await p.click('.hud-build__toggle .ui-toggle');
  const tool = await game(p, () => window.__hud.game.buildTool);
  assert(tool.kind === 'paintWall' && tool.wholeRoom === true && tool.styleId === 'wall_damask_crimson', 'paint tool wrong: ' + JSON.stringify(tool));
  await p.click('button[aria-label="Undo"]');
  assert((await log(p)).includes('undo'), 'undo not called');
  assert(await p.isDisabled('button[aria-label="Redo"]'), 'redo must be disabled when canRedo is false');
});

check('hint: Got it dismisses', 'mode=live&hint=needs&bubbles=0', async (p) => {
  await p.click('.hud-hint-bubble >> text=Got it');
  assert((await log(p)).includes('dismissHint:tut_freshness:false'), 'dismissHint not called');
});

check('Esc closes only the topmost layer (dialog over notices drawer)', 'mode=live&log=1&bubbles=0', async (p) => {
  await p.waitForSelector('.hud-log');
  await p.evaluate(() => window.__hud.game.openDialog('household'));
  await p.waitForSelector('[role="dialog"]');
  await p.keyboard.press('Escape');
  assert((await game(p, () => window.__hud.game.dialog)) === null, 'first Esc should close the dialog');
  assert((await p.locator('.hud-log').count()) === 1, 'drawer must survive the first Esc');
  await p.keyboard.press('Escape');
  assert((await p.locator('.hud-log').count()) === 0, 'second Esc closes the drawer');
});

check('double Esc on a closing dialog never falls through to the world', 'mode=live&bubbles=0', async (p) => {
  await p.evaluate(() => {
    window.__fell = 0;
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) window.__fell++;
    });
    window.__escape = () =>
      (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    window.__hud.game.openDialog('household');
  });
  await p.waitForSelector('[role="dialog"]');
  // Two presses in one task: the dialog cannot re-render (and unmount) in between, so the second lands on a closing layer.
  await p.evaluate(() => {
    window.__escape();
    window.__escape();
  });
  assert((await game(p, () => window.__hud.game.dialog)) === null, 'Esc should close the dialog');
  assert((await p.evaluate(() => window.__fell)) === 0, 'the quick second Esc must be claimed while the dialog closes');
  await p.waitForTimeout(450);
  assert((await p.locator('[role="dialog"]').count()) === 0, 'dialog should be gone');
  await p.evaluate(() => window.__escape());
  assert((await p.evaluate(() => window.__fell)) === 1, 'with nothing open, Esc belongs to the game');
});

check('Esc closes only the topmost layer, even when pressed twice in one frame', 'mode=live&log=1&bubbles=0', async (p) => {
  await p.waitForSelector('.hud-log');
  await p.evaluate(() => window.__hud.game.openDialog('household'));
  await p.waitForSelector('[role="dialog"]');
  await p.evaluate(() => {
    const fire = () =>
      (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    fire();
    fire();
  });
  assert((await game(p, () => window.__hud.game.dialog)) === null, 'first Esc should close the dialog');
  await p.waitForTimeout(200);
  assert((await p.locator('.hud-log').count()) === 0, 'second Esc (same frame) should reach the drawer');
});

check('Esc in the rename field cancels the edit, not the dialog', 'mode=live&dialog=household&bubbles=0', async (p) => {
  await p.click('.hud-hhname .ui-iconbtn');
  await p.fill('#hud-rename-input', 'Half-typed');
  await p.keyboard.press('Escape');
  assert((await game(p, () => window.__hud.game.dialog)) === 'household', 'dialog must stay open');
  assert((await p.locator('#hud-rename-input').count()) === 0, 'edit mode should end');
  assert((await p.evaluate(() => document.activeElement && document.activeElement.id)) === 'hud-rename-btn', 'focus returns to the pencil');
  await p.keyboard.press('Escape');
  assert((await game(p, () => window.__hud.game.dialog)) === null, 'next Esc closes the dialog');
});

check('Esc in the buy search clears it before closing layers', 'mode=buy&cat=seating&log=1', async (p) => {
  await p.waitForSelector('.hud-log');
  await p.fill('.hud-buy__search input', 'seance');
  await p.keyboard.press('Escape');
  assert((await p.inputValue('.hud-buy__search input')) === '', 'first Esc clears the search');
  assert((await p.locator('.hud-log').count()) === 1, 'drawer stays while the search had text');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(100);
  assert((await p.locator('.hud-log').count()) === 0, 'Esc with an empty search closes the drawer');
});

check('Esc that closes a layer also hides the tooltip', 'mode=live&log=1&bubbles=0', async (p) => {
  await p.waitForSelector('.hud-log');
  await p.hover('.hud-log button[aria-label="Close notices"], .hud-log .hud-log__head .ui-iconbtn');
  await p.waitForSelector('.hud-tooltip', { timeout: 3000 });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(100);
  assert((await p.locator('.hud-log').count()) === 0, 'drawer should close');
  assert((await p.locator('.hud-tooltip').count()) === 0, 'tooltip should hide with it');
});

// ── hardening pass: keyboard, layout and lifecycle regressions ──
check('choice: digit keys pick an option without touching game speed', 'mode=live&choice=1&bubbles=0', async (p) => {
  await p.focus('.hud-choice__opt >> nth=0');
  await p.keyboard.press('Digit2');
  assert((await log(p)).includes('resolveChoice:c1:1'), 'Digit2 should resolve option 2');
  assert((await game(p, () => window.__hud.game.speed)) === 1, 'speed must not change');
});

check('needs grid is one Tab stop with 2-D arrow navigation', 'mode=live&tab=needs&bubbles=0', async (p) => {
  await p.focus('.hud-needs .hud-need[tabindex="0"]');
  const label = () => p.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label'));
  assert((await label()).startsWith('Appetite'), 'first stop should be Appetite');
  await p.keyboard.press('ArrowDown');
  assert((await label()).startsWith('Freshness'), 'ArrowDown should move a whole row (Freshness)');
  await p.keyboard.press('ArrowRight');
  assert((await label()).startsWith('Company'), 'ArrowRight should reach Company');
  await p.keyboard.press('Tab');
  const out = await p.evaluate(() => !document.activeElement.closest('.hud-needs'));
  assert(out, 'Tab should leave the needs grid');
  await p.keyboard.press('Shift+Tab');
  assert((await label()).startsWith('Company'), 'Shift+Tab should come back to the last focused need');
});

check('relationship filter chips: arrows move and select', 'mode=live&tab=relationships&bubbles=0', async (p) => {
  await p.focus('.hud-rels__bar .hud-chip[aria-checked="true"]');
  await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(80);
  const sel = await p.getAttribute('.hud-rels__bar .hud-chip[aria-checked="true"]', 'aria-label');
  assert(/^Household/.test(sel), `expected Household chip, got ${sel}`);
  assert((await p.locator('.hud-rel').count()) === 3, 'household filter should list 3');
});

check('relationship rows: one Tab stop, arrows walk the list', 'mode=live&tab=relationships&bubbles=0', async (p) => {
  await p.focus('.hud-rel[tabindex="0"]');
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('ArrowDown');
  const name = await p.evaluate(() => document.activeElement.getAttribute('aria-label'));
  assert(/^Bartholomew/.test(name), `expected third row, got ${name}`);
  assert((await p.locator('.hud-rel[tabindex="0"]').count()) === 1, 'exactly one tabbable row');
});

check('build palette + style rail are radiogroups with arrow selection', 'mode=build&tool=wall', async (p) => {
  await p.focus('.hud-tool[aria-checked="true"]');
  await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(80);
  assert((await game(p, () => window.__hud.game.buildTool.kind)) === 'room', 'ArrowRight should pick Room');
  await p.focus('.hud-tool[aria-checked="true"]');
  await p.keyboard.press('End');
  await p.waitForTimeout(80);
  assert((await game(p, () => window.__hud.game.buildTool.kind)) === 'eyedropper', 'End should pick the last tool');
  await p.click('.hud-tool >> text=Floors');
  await p.focus('.hud-styles .hud-style[aria-checked="true"]');
  await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(80);
  const tool = await game(p, () => window.__hud.game.buildTool);
  assert(tool.kind === 'floor' && tool.styleId === 'floor_planks_dark', `ArrowRight should pick the next floor, got ${JSON.stringify(tool)}`);
});

check('style rail arrows scroll a clipped rail', 'mode=build&tool=floor&scale=1.4', async (p) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  await p.waitForTimeout(300);
  await p.waitForSelector('.hud-rail__arrow.is-next');
  const before = await p.evaluate(() => document.querySelector('.hud-rail__track').scrollLeft);
  await p.click('.hud-rail__arrow.is-next');
  await p.waitForTimeout(700);
  const after = await p.evaluate(() => document.querySelector('.hud-rail__track').scrollLeft);
  assert(after > before, `rail should scroll (${before} → ${after})`);
  await p.waitForSelector('.hud-rail__arrow.is-prev');
});

check('bubbles: a removed bubble exits and its element goes away', 'mode=live', async (p) => {
  await p.waitForSelector('.hud-bubble');
  const n0 = await p.locator('.hud-bubble').count();
  await p.evaluate(() => window.__hud.game.setBubbles(window.__hud.game.bubbles.slice(1)));
  await p.waitForTimeout(150);
  // keep the controller notifying (~12x/s in the real game) so a per-render timer reset would show up as a leak
  for (let i = 0; i < 6; i++) {
    await p.evaluate(() => window.__hud.game.addFunds(0));
    await p.waitForTimeout(80);
  }
  await p.waitForTimeout(300);
  const n1 = await p.locator('.hud-bubble').count();
  assert(n1 === n0 - 1, `expected ${n0 - 1} bubbles after exit, got ${n1}`);
});

check('household bar never runs under the agent panel (8 members, 140%)', 'mode=live&stress=1&scale=1.4&bubbles=0', async (p) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => ({ bar: document.querySelector('.hud-household').getBoundingClientRect().bottom, panel: document.querySelector('.hud-agent').getBoundingClientRect().top, cls: document.querySelector('.hud-household').className }));
  assert(r.bar <= r.panel + 0.5, `bar bottom ${r.bar} overlaps panel top ${r.panel}`);
  assert(/is-(dense|scroll)/.test(r.cls), `expected dense/scroll density, got ${r.cls}`);
});

check('action queue clears the agent panel and the notices drawer', 'mode=live&stress=1&scale=1.4&bubbles=0', async (p) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  await p.waitForTimeout(400);
  const a = await p.evaluate(() => ({ q: document.querySelector('.hud-queue__list').getBoundingClientRect().toJSON(), panel: document.querySelector('.hud-agent').getBoundingClientRect().right }));
  assert(a.q.left >= a.panel, `queue left ${a.q.left} under agent panel right ${a.panel}`);
  await p.click('button[aria-label="Notices"]');
  await p.waitForTimeout(400);
  const b = await p.evaluate(() => ({ q: document.querySelector('.hud-queue__list').getBoundingClientRect().right, log: document.querySelector('.hud-log').getBoundingClientRect().left }));
  assert(b.q <= b.log, `queue right ${b.q} runs under the drawer (left ${b.log})`);
});

check('tall dialogs stay on screen and scroll their body', 'mode=live&dialog=careers&bubbles=0', async (p) => {
  await p.setViewportSize({ width: 1280, height: 720 });
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => {
    const d = document.querySelector('.hud-dialog').getBoundingClientRect();
    const b = document.querySelector('.hud-dialog .ui-modal__body');
    return { top: d.top, bottom: d.bottom, scrolls: b.scrollHeight > b.clientHeight, ofl: b.getAttribute('data-ofl') };
  });
  assert(r.top >= 0 && r.bottom <= 720, `dialog off screen: ${r.top}..${r.bottom}`);
  assert(r.scrolls && r.ofl === 'end', `body should scroll with an end fade (ofl=${r.ofl})`);
});

check('hint: Esc dismisses the tip instead of opening the pause menu', 'mode=live&hint=needs&bubbles=0', async (p) => {
  await p.keyboard.press('Escape');
  await p.waitForTimeout(100);
  const l = await log(p);
  assert(l.some((x) => x.startsWith('dismissHint:')), 'Esc should dismiss the hint');
  assert((await game(p, () => window.__hud.game.dialog)) === null, 'pause menu must not open');
});

check('notices drawer takes focus and gives it back to the bell', 'mode=live&bubbles=0', async (p) => {
  await p.focus('button[aria-label="Notices"]');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(250);
  const inDrawer = await p.evaluate(() => !!document.activeElement.closest('.hud-log'));
  assert(inDrawer, 'focus should move into the drawer');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  const back = await p.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label'));
  assert(back === 'Notices', `focus should return to the bell, got ${back}`);
});

check('failed save is flagged on the save button', 'mode=live&savefail=1&bubbles=0', async (p) => {
  assert((await p.locator('.hud-save.is-failed .hud-save__alert').count()) === 1, 'failed save badge missing');
  const label = await p.getAttribute('.hud-save', 'aria-label');
  assert(/failed/i.test(label), `aria-label should mention the failure: ${label}`);
});

check('cursor cost label hides over HUD panels', 'mode=build&tool=wall&label=%2445%20%C2%B7%203%20walls', async (p) => {
  await p.mouse.move(800, 300);
  await p.waitForTimeout(100);
  assert((await p.evaluate(() => getComputedStyle(document.querySelector('.hud-cursorlabel')).visibility)) === 'visible', 'label should show over the world');
  const box = await p.locator('.hud-build').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + 40);
  await p.waitForTimeout(100);
  assert((await p.evaluate(() => getComputedStyle(document.querySelector('.hud-cursorlabel')).visibility)) === 'hidden', 'label should hide over the build panel');
});

// ── backlog #16: closing the interaction menu hands focus back synchronously, so the next hotkey isn't swallowed ──
const fireKeys = (p, keys) =>
  p.evaluate((ks) => {
    const out = [];
    for (const [code, key] of ks) {
      (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true }));
      out.push(document.activeElement ? document.activeElement.getAttribute('role') || document.activeElement.id || document.activeElement.tagName : null);
    }
    return { focus: out, speed: window.__hud.game.speed, menu: !!window.__hud.game.menu, dialog: window.__hud.game.dialog };
  }, keys);
const menuFocused = (p) => p.waitForFunction(() => document.activeElement && document.activeElement.getAttribute('role') === 'menuitem', null, { timeout: 5000 });

check('#16 Esc then 3 in ONE task: menu closes and the 3 reaches the game', 'mode=live&menu=fridge&bubbles=0&hotkeys=1', async (p) => {
  await menuFocused(p);
  const r = await fireKeys(p, [['Escape', 'Escape'], ['Digit3', '3']]);
  assert(!r.menu, 'Esc should close the menu');
  assert(r.focus[0] !== 'menuitem', `focus must leave the menu synchronously, still on ${r.focus[0]}`);
  assert(r.speed === 3, `the 3 was swallowed (speed ${r.speed})`);
  assert(r.dialog === null, 'nothing else may open');
});

check('#16 Esc then 3 as real key presses', 'mode=live&menu=social&bubbles=0&hotkeys=1', async (p) => {
  await menuFocused(p);
  await p.keyboard.press('Escape');
  await p.keyboard.press('Digit3');
  assert((await game(p, () => window.__hud.game.menu)) === null, 'menu should be closed');
  assert((await game(p, () => window.__hud.game.speed)) === 3, 'speed should be 3');
  assert((await game(p, () => window.__hud.game.dialog)) === null, 'Esc must not also open the pause menu');
});

check('#16 Enter on an entry, then 2 in the same task', 'mode=live&menu=fridge&bubbles=0&hotkeys=1', async (p) => {
  await menuFocused(p);
  await p.focus('.hud-imenu[data-level="0"] .hud-imenu__row:not(.is-disabled):not([aria-haspopup])');
  const r = await fireKeys(p, [['Enter', 'Enter'], ['Digit2', '2']]);
  assert((await log(p)).some((l) => l.startsWith('choose:')), 'Enter should choose the entry');
  assert(r.focus[0] !== 'menuitem', 'choosing must move focus out of the menu at once');
  assert(r.speed === 2, `the 2 was swallowed (speed ${r.speed})`);
});

check('#16 flyout: Esc steps back (menu stays, digits stay with the menu)', 'mode=live&menu=social&bubbles=0&hotkeys=1', async (p) => {
  await menuFocused(p);
  await p.keyboard.press('ArrowRight');
  await p.waitForSelector('.hud-imenu.is-flyout');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(120);
  assert((await game(p, () => !!window.__hud.game.menu)) === true, 'first Esc only closes the flyout');
  await p.keyboard.press('Digit3');
  assert((await game(p, () => window.__hud.game.speed)) !== 3, 'while the menu is open its keys belong to the menu');
  await p.keyboard.press('Escape');
  await p.keyboard.press('Digit3');
  assert((await game(p, () => window.__hud.game.speed)) === 3, 'after the menu closes the 3 reaches the game');
});

check('#16 focus returns to the world the menu was opened from', 'mode=live&bubbles=0&hotkeys=1', async (p) => {
  await p.mouse.click(800, 600); // the world stand-in (#world, tabindex=-1 like the real canvas)
  assert((await p.evaluate(() => document.activeElement && document.activeElement.id)) === 'world', 'clicking the world should focus it');
  await p.evaluate(() => window.__hud.game.openMenuFor({ kind: 'object', id: 'o3' }, 800, 600));
  await menuFocused(p);
  await p.keyboard.press('Escape');
  assert((await p.evaluate(() => document.activeElement && document.activeElement.id)) === 'world', 'focus should go back to the world');
});

check('#16 a close made by the controller also releases focus in the same task', 'mode=live&menu=fridge&bubbles=0&hotkeys=1', async (p) => {
  await menuFocused(p);
  const r = await p.evaluate(() => {
    window.__hud.game.setMode('build'); // the controller closes the menu itself
    const role = document.activeElement && document.activeElement.getAttribute('role');
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', key: '2', bubbles: true, cancelable: true }));
    return { role, speed: window.__hud.game.speed };
  });
  assert(r.role !== 'menuitem', `focus still on a menuitem after the controller closed the menu (${r.role})`);
  assert(r.speed === 2, `the 2 was swallowed (speed ${r.speed})`);
});

check('stale layer: Esc right after a menu CHOICE belongs to the game (frame not rendered yet)', 'mode=live&menu=fridge&bubbles=0&hotkeys=1', async (p) => {
  await menuFocused(p);
  await p.focus('.hud-imenu[data-level="0"] .hud-imenu__row:not(.is-disabled):not([aria-haspopup])');
  const r = await fireKeys(p, [['Enter', 'Enter'], ['Escape', 'Escape']]);
  assert(!r.menu, 'the choice closes the menu');
  assert(r.dialog === 'pause', `the fresh Esc should reach the game (pause menu), got ${r.dialog}`);
});

check('stale layer: Esc / digits right after the CONTROLLER closed a HUD dialog belong to the game', 'mode=live&dialog=phone&bubbles=0&hotkeys=1', async (p) => {
  await p.waitForSelector('[role="dialog"]');
  await p.waitForFunction(() => !!document.activeElement.closest('[role="dialog"]'));
  const r = await p.evaluate(() => {
    const fire = (code, key) => (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true }));
    window.__hud.game.closeDialog(); // e.g. a phone action / the controller closing it — not an Esc
    const inDialog = !!document.activeElement.closest('[role="dialog"]');
    fire('Digit2', '2');
    const speed = window.__hud.game.speed;
    fire('Escape', 'Escape');
    return { inDialog, speed, dialog: window.__hud.game.dialog };
  });
  assert(!r.inDialog, 'focus must leave the closed dialog synchronously');
  assert(r.speed === 2, `the 2 was swallowed by the closed dialog (speed ${r.speed})`);
  assert(r.dialog === 'pause', `a fresh Esc must not be swallowed by the closed dialog, got ${r.dialog}`);
});

check('closing layer: a quick SECOND Esc after Esc closed the dialog is still claimed', 'mode=live&dialog=phone&bubbles=0&hotkeys=1', async (p) => {
  await p.waitForSelector('[role="dialog"]');
  const r = await fireKeys(p, [['Escape', 'Escape'], ['Escape', 'Escape']]);
  assert(r.dialog === null, `double Esc must close the dialog and NOT open the pause menu, got ${r.dialog}`);
});

// ── keyboard entry into the HUD (KEYMAP binds Tab to "next zombie"; F6 + keyboard-focus Tab make the HUD reachable) ──
const activeInfo = (p) =>
  p.evaluate(() => {
    const a = document.activeElement;
    const region = a && a.closest && a.closest('[data-hud-region]');
    let fv = false;
    try {
      fv = !!a && a.matches(':focus-visible');
    } catch {
      /* old engine */
    }
    return { tag: a ? a.tagName : null, id: a ? a.id : null, label: a ? (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 30) : null, region: region ? region.getAttribute('data-hud-region') : null, fv };
  });

check('F6 enters the HUD; Tab then walks HUD controls instead of cycling zombies', 'mode=live&bubbles=0&hotkeys=1', async (p) => {
  await p.mouse.click(800, 600); // world focused (like clicking the canvas)
  await p.keyboard.press('F6');
  const a = await activeInfo(p);
  assert(a.region === '10' && a.fv, `F6 should focus the top bar with a visible ring: ${JSON.stringify(a)}`);
  const before = await game(p, () => window.__hud.game.selectedAgentId);
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    await p.keyboard.press('Tab');
    const b = await activeInfo(p);
    assert(b.region !== null, `Tab ${i + 1} left the HUD: ${JSON.stringify(b)}`);
    seen.add(b.label);
  }
  assert(seen.size >= 5, `Tab should reach different controls, saw ${[...seen].join(' | ')}`);
  assert((await game(p, () => window.__hud.game.selectedAgentId)) === before, 'Tab inside the HUD must not cycle zombies');
  assert(!(await log(p)).some((l) => l.startsWith('cycleSelection')), 'controller must not see HUD Tabs');
});

check('Tab on the world still cycles zombies; Tab after a mouse click on a HUD button too', 'mode=live&bubbles=0&hotkeys=1', async (p) => {
  await p.mouse.click(800, 600);
  await p.keyboard.press('Tab');
  assert((await game(p, () => window.__hud.game.selectedAgentId)) !== 'a1', 'Tab on the world should select the next zombie');
  await p.click('.hud-agent__tabs [role="tab"] >> nth=2'); // mouse focus: no ring
  const sel = await game(p, () => window.__hud.game.selectedAgentId);
  await p.keyboard.press('Tab');
  assert((await game(p, () => window.__hud.game.selectedAgentId)) !== sel, 'Tab after a mouse click stays the game hotkey');
});

check('F6 visits each HUD region in order, then hands focus back to the world', 'mode=live&bubbles=0&hotkeys=1&toasts=2', async (p) => {
  await p.mouse.click(800, 600);
  const order = [];
  for (let i = 0; i < 9; i++) {
    await p.keyboard.press('F6');
    const a = await activeInfo(p);
    order.push(a.region);
    if (a.region === null) break;
  }
  const regs = order.filter((r) => r !== null).map(Number);
  assert(regs.length >= 4, `expected at least 4 regions, got ${order.join(',')}`);
  assert(regs.every((r, i) => i === 0 || r > regs[i - 1]), `regions out of order: ${order.join(',')}`);
  assert(order[order.length - 1] === null, `F6 past the last region should return to the world: ${order.join(',')}`);
  await p.keyboard.press('Shift+F6');
  const back = await activeInfo(p);
  assert(back.region === String(regs[regs.length - 1]), `Shift+F6 from the world should land on the last region (${back.region})`);
});

check('Tab wraps inside the HUD (never falls out to the browser)', 'mode=live&bubbles=0&hotkeys=1', async (p) => {
  await p.mouse.click(800, 600);
  await p.keyboard.press('F6');
  await p.keyboard.press('Shift+Tab');
  const a = await activeInfo(p);
  assert(a.region !== null, `Shift+Tab on the first HUD control should wrap to the last one: ${JSON.stringify(a)}`);
  await p.keyboard.press('Tab');
  const b = await activeInfo(p);
  assert(b.region === '10', `Tab on the last control should wrap to the top bar: ${JSON.stringify(b)}`);
});

check('keyboard: F6 → agent tabs → arrows switch tabs, Enter opens the phone dialog', 'mode=live&bubbles=0&hotkeys=1', async (p) => {
  await p.mouse.click(800, 600);
  let a;
  for (let i = 0; i < 6; i++) {
    await p.keyboard.press('F6');
    a = await activeInfo(p);
    if (a.region === '30') break;
  }
  assert(a.region === '30', 'F6 should reach the zombie panel');
  // walk to the tab rail
  for (let i = 0; i < 8; i++) {
    const role = await p.evaluate(() => document.activeElement.getAttribute('role'));
    if (role === 'tab') break;
    await p.keyboard.press('Tab');
  }
  await p.keyboard.press('ArrowRight');
  const sel = await p.getAttribute('.hud-agent__tabs [role="tab"][aria-selected="true"]', 'aria-label');
  assert(sel === 'Mood', `ArrowRight on the tab rail should select Mood, got ${sel}`);
  await p.focus('.hud-agent__phone');
  await p.keyboard.press('Enter');
  assert((await game(p, () => window.__hud.game.dialog)) === 'phone', 'Enter on the phone button opens the phone dialog');
});

check('queue: one Tab stop, arrows walk the items, Delete cancels and keeps focus in the queue', 'mode=live&bubbles=0&hotkeys=1', async (p) => {
  const stops = await p.evaluate(() => [...document.querySelectorAll('.hud-queue__list [tabindex="0"], .hud-queue__list button:not([tabindex="-1"])')].length);
  assert(stops === 1, `the queue should be ONE Tab stop, found ${stops}`);
  await p.focus('.hud-qactive__ring');
  await p.keyboard.press('ArrowRight');
  const label = await p.evaluate(() => document.activeElement.getAttribute('aria-label'));
  assert(/^Cook Frontal Lobe Lasagna/.test(label), `ArrowRight should reach the first queued order, got ${label}`);
  await p.keyboard.press('Delete');
  assert((await log(p)).includes('cancel:12'), 'Delete should cancel the focused order');
  const inQueue = await p.evaluate(() => !!document.activeElement.closest('.hud-queue__list'));
  assert(inQueue, 'focus must stay in the queue after cancelling');
  await p.keyboard.press('End');
  await p.keyboard.press('Delete');
  assert(!(await log(p)).includes('cancel:15'), 'a system order (Go to Work) cannot be cancelled');
});

check('F6 reaches the choice letter (non-modal) and its options; digits still answer it', 'mode=live&choice=1&bubbles=0&hotkeys=1', async (p) => {
  await p.mouse.click(800, 700);
  let a = null;
  for (let i = 0; i < 8; i++) {
    await p.keyboard.press('F6');
    a = await activeInfo(p);
    if (a.region === '50' || a.region === null) break;
  }
  assert(a && a.region === '50', `F6 should reach the letter region, got ${JSON.stringify(a)}`);
  const inLetter = await p.evaluate(() => !!document.activeElement.closest('.hud-choice'));
  assert(inLetter, 'focus should be on a letter option');
  await p.keyboard.press('Tab');
  const still = await p.evaluate(() => !!document.activeElement.closest('.hud-choice'));
  assert(still, 'Tab should walk to the next option');
  await p.keyboard.press('Digit1');
  assert((await log(p)).includes('resolveChoice:c1:0'), 'Digit1 inside the letter answers option 1');
  assert((await game(p, () => window.__hud.game.speed)) === 1, 'and does not change the speed');
});

check('F6 reaches the tutorial tip; its buttons are in the HUD Tab cycle', 'mode=live&hint=needs&bubbles=0&hotkeys=1', async (p) => {
  await p.mouse.click(1000, 700);
  let a = null;
  for (let i = 0; i < 8; i++) {
    await p.keyboard.press('F6');
    a = await activeInfo(p);
    if (a.region === '55' || a.region === null) break;
  }
  assert(a && a.region === '55', `F6 should reach the tip, got ${JSON.stringify(a)}`);
  await p.keyboard.press('Tab');
  const label = await p.evaluate(() => document.activeElement.textContent.trim());
  assert(/Got it/.test(label), `Tab should reach "Got it", got ${label}`);
  await p.keyboard.press('Enter');
  assert((await log(p)).some((l) => l.startsWith('dismissHint:')), 'Enter on "Got it" dismisses the tip');
});

// ── perf guards: an idle HUD (overdue bills, critical needs, paused clock) must not restyle every frame ──
check('idle HUD with live alerts costs no per-frame style recalcs', 'mode=live&stress=1&tab=needs&bubbles=0&speed=0', async (p) => {
  await p.waitForTimeout(800);
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Performance.enable');
  const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const a = await m();
  await p.waitForTimeout(2000);
  const b = await m();
  const recalcs = b.RecalcStyleCount - a.RecalcStyleCount;
  assert(recalcs <= 3, `${recalcs} style recalcs in 2 s while idle (an infinite box-shadow / stroke animation is back?)`);
  const anims = await p.evaluate(() => document.getAnimations().filter((x) => x.playState === 'running').map((x) => x.animationName));
  assert(anims.includes('hud-ping') && anims.includes('hud-ping-round'), `alert pings should still run (compositor-only): ${anims.join(',')}`);
});

check('reduce motion: no CSS animation runs in the HUD', 'mode=live&stress=1&tab=needs&toasts=3&party=1&rm=1&bubbles=1', async (p) => {
  await p.waitForTimeout(800);
  const anims = await p.evaluate(() => document.getAnimations().filter((x) => x.playState === 'running' && !(x instanceof CSSTransition)).map((x) => x.animationName));
  assert(anims.length === 0, `running animations with reduce motion: ${anims.join(',')}`);
});

check('no console errors with every panel open', 'mode=live&toasts=5&choice=1&party=1&fps=1&log=1&bubbles=1', async () => {});

(async () => {
  const browser = await chromium.launch();
  let failed = 0;
  const only = process.argv[2] || '';
  for (const c of checks) {
    if (only && !c.name.includes(only)) continue;
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    try {
      await page.goto(`${BASE}?${c.query}`, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(400);
      await c.fn(page);
      if (errors.length) throw new Error('console: ' + errors.join(' | '));
      console.log(`✓ ${c.name}`);
    } catch (e) {
      failed++;
      console.log(`✗ ${c.name}\n    ${String(e.message).split('\n')[0]}`);
    }
    await page.close();
  }
  await browser.close();
  const ran = checks.filter((c) => !only || c.name.includes(only)).length;
  console.log(`\n${ran - failed}/${ran} checks passed`);
  process.exitCode = failed ? 1 : 0;
})();
