/**
 * The player-flow scenario, as ordered harness steps (see tests/e2e/README.md for the list and rationale).
 *
 * Conventions:
 *  - Player actions go through real input: Playwright mouse/keyboard on the canvas and DOM controls found by
 *    role/label. window.__afterlife (the documented read-only debug handle from src/main.tsx) is used to READ state
 *    for assertions and to compute where to click (renderer.worldToScreen / pick / pickGrid). The only direct
 *    writes are the adversarial ones that a player cannot do by hand (flipping bytes in IndexedDB, concurrent API
 *    saves to provoke races, losing the WebGL context), each marked ADVERSARIAL.
 *  - Waits are on state (page.waitForFunction polling every 100 ms), never on fixed sleeps > 500 ms.
 */
import * as P from './lib/inpage.mjs';

const POLL = { polling: 100 };

/**
 * @param {{ h: import('./lib/harness.mjs').Harness, browser: import('playwright').Browser, url: string, viewport: { width: number, height: number } }} o
 */
export async function runFlow({ h, browser, url, viewport }) {
  const context = await browser.newContext({ viewport, acceptDownloads: false });
  await context.addInitScript(P.initScript);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  h.watch(page);

  // ───────────────────────────── helpers ─────────────────────────────
  const G = (fn, arg) => page.evaluate(fn, arg);
  const state = () => G(P.snapshotState);
  /** Wait for an in-page predicate; on timeout throw with the current state attached. */
  const until = async (what, fn, arg, timeout = 60_000) => {
    try {
      await page.waitForFunction(fn, arg, { ...POLL, timeout });
    } catch (e) {
      const s = await state().catch(() => null);
      const focus = await G(() => {
        const a = document.activeElement;
        return a ? `${a.tagName.toLowerCase()}${a.className && typeof a.className === 'string' ? `.${a.className.split(' ').join('.')}` : ''}` : null;
      }).catch(() => null);
      throw new Error(`timed out (${timeout} ms) waiting for ${what}; focus=${focus}; state=${JSON.stringify(s)}`);
    }
  };
  const untilScreen = (screen, timeout = 120_000) =>
    until(`screen=${screen}`, (sc) => {
      const g = window.__afterlife && window.__afterlife.game;
      return !!g && (g.screen === sc || !!g.fatalError);
    }, screen, timeout).then(async () => {
      const s = await state();
      if (s.fatal) throw new Error(`fatal error screen: ${s.fatal}`);
      return s;
    });
  const drainRejections = async () => {
    const list = await G(() => (window.__e2e ? window.__e2e.rejections.splice(0) : [])).catch(() => []);
    for (const r of list) h.recordError('unhandledrejection', r);
  };
  const step = async (name, fn, opts) => {
    const ok = await h.step(
      name,
      async () => {
        await fn();
        await drainRejections();
      },
      {
        ...opts,
        onFail: async () => {
          await page.mouse.up().catch(() => {}); // never leave a drag half-done for the next step
          await drainRejections();
          await h.shot(page, `FAIL-${name}`);
        },
      },
    );
    return ok;
  };
  /** Keyboard input must reach the controller's window handler, not a focused widget. */
  const blur = () =>
    G(() => {
      const a = document.activeElement;
      if (a && a !== document.body && typeof a.blur === 'function') a.blur();
    });
  const press = async (key) => {
    await blur();
    await page.keyboard.press(key);
  };
  const idle = () => G(P.persistenceIdle);
  /**
   * Click a DOM control. SwiftShader renders the 3D scene behind the UI at a few FPS under load, and Playwright's
   * "stable" actionability check waits for two identical animation frames per click, which costs seconds each. We
   * wait for the element to be visible + enabled by DOM polling instead, then click (real mouse events) with
   * force so that frame cadence is irrelevant. Every step asserts the click's EFFECT on game state anyway.
   */
  const tap = async (loc, { dbl = false, timeout = 30_000 } = {}) => {
    const el = loc.first();
    await el.waitFor({ state: 'visible', timeout });
    const handle = await el.elementHandle({ timeout });
    // enabled + actually hit-testable (a closing modal's backdrop lingers for a few hundred ms after dialog=null)
    await page
      .waitForFunction(
        (e) => {
          if (!e.isConnected || e.disabled || e.getAttribute('aria-disabled') === 'true') return false;
          const r = e.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!hit && (e === hit || e.contains(hit) || (e instanceof HTMLLabelElement && e.control === hit));
        },
        handle,
        { ...POLL, timeout },
      )
      .catch(async () => {
        // never hit-testable: name what covers it (W-050 b: "Return to menu" once reported as intercepted)
        const cover = await handle
          .evaluate((e) => {
            const r = e.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            const name = (x) => (x ? `${x.tagName.toLowerCase()}${x.id ? `#${x.id}` : ''}.${String(x.className).trim().split(/\s+/).join('.')}` : 'none');
            return `${name(e)} covered by ${name(hit)} (parent ${name(hit && hit.parentElement)})`;
          })
          .catch(() => 'target detached');
        h.log(`    (tap: ${cover}; clicking anyway)`);
      });
    if (dbl) await el.dblclick({ force: true, timeout });
    else await el.click({ force: true, timeout });
    await handle.dispose();
  };
  /** Click `buttonName` if a confirmation shows up before `doneFn()` (in-page) becomes true. */
  const confirmIfAsked = async (buttonName, doneFn, timeout = 60_000) => {
    const end = Date.now() + timeout;
    const b = page.getByRole('button', { name: buttonName, exact: true });
    while (Date.now() < end) {
      if (await G(doneFn).catch(() => false)) return false;
      if (await b.isVisible().catch(() => false)) {
        await tap(b);
        return true;
      }
      await page.waitForTimeout(100);
    }
    return false;
  };
  /** Pause (Digit0 / Space / ` TOGGLE pause per KEYMAP.pause — pressing it while already paused resumes). */
  const pauseGame = async () => {
    if ((await state()).speed !== 0) await press('Digit0');
    await until('paused', () => window.__afterlife.game.speed === 0, undefined, 10_000);
  };
  /** Tutorial tips are a HUD layer that claims Esc first (by design): dismiss any showing tip with "Got it". */
  const clearHints = async () => {
    for (let i = 0; i < 6; i++) {
      const id = await G(() => (window.__afterlife.game.hint ? window.__afterlife.game.hint.id : null));
      if (!id) return;
      await tap(page.locator('.hud-hint-bubble button', { hasText: 'Got it' }), { timeout: 15_000 }).catch(() => G((h) => window.__afterlife.game.dismissHint(h), id));
      await until('tip dismissed', (h) => !window.__afterlife.game.hint || window.__afterlife.game.hint.id !== h, id, 15_000);
    }
  };
  /** Press Esc until `done` holds (a tip that popped up in between takes the first Esc). */
  const escUntil = async (what, done, arg) => {
    for (let i = 0; i < 4; i++) {
      await clearHints();
      await press('Escape');
      try {
        await until(what, done, arg, 8_000);
        return;
      } catch (e) {
        if (i === 3) throw e;
      }
    }
  };
  /** DOM assertion that waits (the HUD re-renders on the next animation frame, which may be seconds away). */
  const expectDom = async (name, fn, arg, timeout = 20_000) => {
    let ok = true;
    try {
      await page.waitForFunction(fn, arg, { ...POLL, timeout });
    } catch {
      ok = false;
    }
    return h.check(name, ok);
  };
  const dialog = () => page.locator('[role="dialog"][aria-modal="true"]').last();
  const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
  const ensureLiveNoDialog = async () => {
    await G(() => {
      const g = window.__afterlife.game;
      // closing a child dialog (Save/Load, Settings opened from Pause) returns to its parent: close the whole chain
      for (let i = 0; i < 4 && g.dialog; i++) g.closeDialog();
      g.closeMenu();
      g.cancelPlacement();
    });
    if ((await state()).mode !== 'live') await press('KeyL');
    await until('live mode, no dialog', () => window.__afterlife.game.mode === 'live' && window.__afterlife.game.dialog === null, undefined, 10_000);
    await clearHints();
  };

  const saved = { named: null, snapshot: null, spamId: null };
  let mainAgent = null;

  // ───────────────────────────── boot → menu ─────────────────────────────
  await step('boot to main menu', async () => {
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await untilScreen('menu', 300_000);
    h.log(`    menu after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const version = await G(() => window.__afterlife.version);
    h.check('debug handle exposes a version', typeof version === 'string' && /^\d+\.\d+\.\d+/.test(version), version);
    const items = await page.locator('.sh-menu__item').allInnerTexts();
    h.check('menu lists Continue / New Game / Load Game / Settings', ['Continue', 'New Game', 'Load Game', 'Settings'].every((l) => items.some((t) => t.includes(l))), items.map((t) => t.split('\n')[0]));
    const cont = page.locator('.sh-menu__item', { hasText: 'Continue' });
    await until('save list loaded', () => !document.querySelector('.sh-menu__item[aria-busy="true"]') && !!document.querySelector('.sh-menu__detail'));
    h.check('Continue is disabled on a fresh profile', await cont.isDisabled());
    h.check('Continue says there are no saves', (await cont.innerText()).includes('No saves yet'));
    await h.shot(page, 'menu');
  });

  // ───────────────────────────── first-run age gate ─────────────────────────────
  // A fresh profile is asked once for a year of birth (docs/MONETIZATION.md §1). It sits over the menu, so it must be
  // answered like a player would before anything else can be clicked. Only the age bracket may be stored.
  await step('first-run age gate', async () => {
    await expectDom('age gate shown on a fresh profile', () => !!document.querySelector('.st-age-dialog .st-age__input'));
    const year = String(new Date().getFullYear() - 30);
    await page.locator('.st-age-dialog .st-age__input').fill(year);
    await tap(page.locator('[data-testid="age-continue"]'));
    await until('age gate closed', () => !document.querySelector('.st-age-dialog'));
    const leaked = await G((y) => {
      const hits = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if ((localStorage.getItem(k) || '').includes(y)) hits.push(k); }
      return hits;
    }, year);
    h.check('year of birth is not stored (only the bracket)', leaked.length === 0, leaked);
    await h.shot(page, 'menu-after-age-gate');
  }, { needs: ['boot to main menu'] });

  // ───────────────────────────── settings ─────────────────────────────
  await step('settings: change via dialog', async () => {
    await tap(page.locator('.sh-menu__item', { hasText: 'Settings' }));
    await until('settings dialog', () => window.__afterlife.game.dialog === 'settings');
    // W-039 first run: quality defaults to Auto; SwiftShader is a software rasteriser -> GPU tier Low, rendered at Low
    const auto = await G(() => {
      const g = window.__afterlife.game;
      const info = g.graphics;
      return { q: g.settings.quality, stored: g.settings.autoQuality, level: info?.level, kind: info?.auto?.gpuKind, ceiling: info?.auto?.ceiling, autoLevel: info?.auto?.level };
    });
    h.check('first run: quality is Auto (not High)', auto.q === 'auto', auto);
    h.check('Auto classifies SwiftShader as software and renders at Low', auto.kind === 'software' && auto.ceiling === 'low' && auto.autoLevel === 'low' && auto.level === 'low', auto);
    await expectDom('Settings shows the Auto status with the level it runs at', () => /^Auto — .*Low/.test(document.querySelector('[data-testid="quality-status"]')?.textContent ?? ''));
    await expectDom('the Auto radio is checked', () => document.querySelector('[aria-labelledby="set-quality-label"] [role="radio"][aria-checked="true"]')?.textContent.includes('Auto'));
    const low = page.locator('[aria-labelledby="set-quality-label"] [role="radio"]', { hasText: 'Low' });
    await tap(low);
    await until('quality=low', () => window.__afterlife.game.settings.quality === 'low');
    await expectDom('Low radio is checked', () => document.querySelector('[aria-labelledby="set-quality-label"] [role="radio"][aria-checked="true"]')?.textContent.includes('Low'));
    const fps = page.locator('[role="switch"][aria-labelledby="set-fps-label"]');
    const before = (await fps.getAttribute('aria-checked')) === 'true';
    await tap(fps);
    await until('showFps toggled', (b) => window.__afterlife.game.settings.showFps === !b, before);
    await expectDom('Show FPS switch flipped', (b) => document.querySelector('[role="switch"][aria-labelledby="set-fps-label"]')?.getAttribute('aria-checked') === String(!b), before);
    await h.shot(page, 'settings');
    await tap(dialog().getByRole('button', { name: 'Done' }));
    await until('settings closed', () => window.__afterlife.game.dialog === null);
    h.check('settings writes landed', (await idle()) === true);
  }, { needs: ['first-run age gate'] });

  await step('settings: persist across reload', async () => {
    const bootBefore = await G(() => window.__e2e.bootId);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await untilScreen('menu', 240_000);
    h.check('page really reloaded', (await G(() => window.__e2e.bootId)) !== bootBefore);
    h.check('age gate does not come back after reload', !(await page.locator('.st-age-dialog').count()));
    const s = await G(() => ({ q: window.__afterlife.game.settings.quality, fps: window.__afterlife.game.settings.showFps }));
    h.check('quality still low after reload', s.q === 'low', s);
    h.check('show FPS still on after reload', s.fps === true, s);
    await tap(page.locator('.sh-menu__item', { hasText: 'Settings' }));
    await until('settings dialog', () => window.__afterlife.game.dialog === 'settings');
    await expectDom('dialog shows Low selected', () => document.querySelector('[aria-labelledby="set-quality-label"] [role="radio"][aria-checked="true"]')?.textContent.includes('Low'));
    await page.keyboard.press('Escape');
    await until('settings closed by Esc', () => window.__afterlife.game.dialog === null);
  }, { needs: ['settings: change via dialog'] });

  // ───────────────────────────── new game + CAZ ─────────────────────────────
  await step('new game → create-a-zombie', async () => {
    await tap(page.locator('.sh-menu__item', { hasText: 'New Game' }));
    await untilScreen('newGame', 30_000);
    // W-113: the derelict claim (story start) is the first and default lot; this suite plays the furnished
    // 'starter' sandbox (fridge, shower, coffins), so it picks it explicitly.
    h.check('story-start lot listed first', (await page.locator('.sh-lots [role="radio"]').first().getAttribute('data-lot')) === 'derelict');
    h.check('story-start lot preselected', (await page.locator('.sh-lots [role="radio"][aria-checked="true"]').getAttribute('data-lot')) === 'derelict');
    await tap(page.locator('.sh-lots [role="radio"][data-lot="starter"]'));
    await expectDom('starter lot selected', () => document.querySelector('.sh-lots [role="radio"][aria-checked="true"]')?.getAttribute('data-lot') === 'starter');
    await tap(page.getByRole('button', { name: 'Create your household' }));
    await untilScreen('caz', 30_000);
    await until('caz member ready', () => !!window.__afterlife.game.caz && window.__afterlife.game.caz.members.length > 0 && !!document.querySelector('.sh-caz__editor'));
  }, { needs: ['boot to main menu'] });

  const cazMember = () => G(() => JSON.stringify(window.__afterlife.game.caz.members[window.__afterlife.game.caz.activeIndex]));
  const firstName = () => page.getByRole('textbox', { name: 'First name' });
  const lastName = () => page.getByRole('textbox', { name: 'Last name' });
  const household = () => page.getByRole('textbox', { name: 'Household name' });

  await step('caz: randomize', async () => {
    const before = await cazMember();
    await tap(page.locator('.sh-random button', { hasText: 'Everything' }));
    await until('member changed', (b) => JSON.stringify(window.__afterlife.game.caz.members[window.__afterlife.game.caz.activeIndex]) !== b, before);
    const after = JSON.parse(await cazMember());
    h.check('randomized member has 3 traits', Array.isArray(after.traits) && after.traits.length === 3, after.traits);
    h.check('randomized member has a first name', typeof after.firstName === 'string' && after.firstName.trim().length > 0, after.firstName);
    // Compare the field with the member's CURRENT first name, not the snapshot above: on a slow CI runner the member
    // can change again after `after` was read (main e2e at 258220e and #35 at 4a5845d failed here, local runs pass).
    const shown = () =>
      G(() => {
        const g = window.__afterlife.game.caz;
        return { state: g.members[g.activeIndex]?.firstName ?? null, inputs: Array.from(document.querySelectorAll('.sh-name-grid input')).map((i) => i.value) };
      });
    const okName = await expectDom('First name field shows the rolled name', () => {
      const g = window.__afterlife.game.caz;
      const n = g.members[g.activeIndex]?.firstName;
      return typeof n === 'string' && n.length > 0 && Array.from(document.querySelectorAll('.sh-name-grid input')).some((i) => i.value === n);
    });
    if (!okName) h.log(`    (rolled ${JSON.stringify(after.firstName)}; now ${JSON.stringify(await shown())})`);
  }, { needs: ['new game → create-a-zombie'] });

  await step('caz: invalid input shows errors', async () => {
    // Empty / whitespace-only first name.
    await firstName().fill('   ');
    await firstName().blur();
    await until('first-name error', () => !!document.querySelector('.ui-field__error') && /first name/i.test(document.querySelector('.ui-field__error').textContent || ''));
    h.check('whitespace first name is rejected', (await G(() => window.__afterlife.game.validateCazDetailed().some((e) => e.field === 'firstName'))) === true);
    // Over-long name is capped by the field, never stored past the limit.
    await firstName().fill('X'.repeat(300));
    const longLen = (await firstName().inputValue()).length;
    h.check('first name capped by maxLength', longLen > 0 && longLen < 300, longLen);
    // Empty household name.
    await household().fill('');
    await household().blur();
    await until('household error', () => Array.from(document.querySelectorAll('.ui-field__error')).some((e) => /household/i.test(e.textContent || '')));
    h.check('empty household name reported inline', true);
    // Untick a trait → only 2 traits.
    await tap(page.locator('.sh-editor__tabs [role="tab"]', { hasText: 'Personality' }));
    const on = page.locator('.sh-traits [role="checkbox"][aria-checked="true"]');
    await tap(on.first());
    await until('2 traits', () => window.__afterlife.game.caz.members[window.__afterlife.game.caz.activeIndex].traits.length === 2);
    const issues = await G(() => window.__afterlife.game.validateCazDetailed().map((e) => e.field));
    h.check('validation lists traits + householdName', issues.includes('traits') && issues.includes('householdName'), issues);
    await expectDom('footer shows "things to fix"', () => /thing(s)? to fix/.test(document.querySelector('.sh-editor__status')?.textContent || ''));
    // Pressing Start with errors must not start the game; it reveals the errors instead.
    await tap(page.locator('.sh-editor__start'));
    await expectDom('inline alerts are visible', () => document.querySelectorAll('.sh-caz [role="alert"]').length > 0);
    h.check('still on Create-a-Zombie after refused start', (await state()).screen === 'caz');
    await h.shot(page, 'caz-errors');
  }, { needs: ['caz: randomize'] });

  await step('caz: rename + edit trait → valid', async () => {
    // tick a trait that is not blocked
    await tap(page.locator('.sh-editor__tabs [role="tab"]', { hasText: 'Personality' }));
    const free = page.locator('.sh-traits [role="checkbox"][aria-checked="false"]:not([aria-disabled="true"])');
    await tap(free.first());
    await until('3 traits', () => window.__afterlife.game.caz.members[window.__afterlife.game.caz.activeIndex].traits.length === 3);
    await tap(page.locator('.sh-editor__tabs [role="tab"]', { hasText: 'Identity' }));
    await firstName().fill('Mortimer');
    await lastName().fill('Testgrave');
    await household().fill('The Testgraves');
    // add a second zombie so selection can switch between members
    await tap(page.locator('.sh-member-add'));
    await until('2 members', () => window.__afterlife.game.caz.members.length === 2);
    const m2 = await G(() => window.__afterlife.game.caz.members[1]);
    if (!m2.firstName || !m2.firstName.trim() || m2.traits.length !== 3) {
      await tap(page.locator('.sh-random button', { hasText: 'Everything' }));
      await until('member 2 valid', () => window.__afterlife.game.caz.members[1].traits.length === 3 && !!window.__afterlife.game.caz.members[1].firstName.trim());
    }
    const errs = await G(() => window.__afterlife.game.validateCaz());
    h.require('CAZ validates clean', errs.length === 0, errs);
    await until('Ready chip', () => /Ready to move in/.test(document.querySelector('.sh-editor__status')?.textContent || ''));
    const m1 = await G(() => window.__afterlife.game.caz.members[0]);
    h.check('member 1 renamed', m1.firstName === 'Mortimer' && m1.lastName === 'Testgrave', `${m1.firstName} ${m1.lastName}`);
    await h.shot(page, 'caz-valid');
  }, { needs: ['caz: invalid input shows errors'] });

  await step('enter game', async () => {
    const t0 = Date.now();
    await tap(page.locator('.sh-editor__start'));
    await untilScreen('game', 240_000);
    await until('renderer loaded + HUD', () => window.__afterlife.game.renderer.loadProgress() >= 1 && !!document.querySelector('.hud-funds') && !!document.querySelector('.hud-household'), undefined, 120_000);
    h.log(`    in game after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const s = await state();
    h.check('household name kept', s.world.household === 'The Testgraves', s.world.household);
    h.check('Mortimer Testgrave moved in', s.world.members.includes('Mortimer Testgrave'), s.world.members);
    h.check('two members', s.world.members.length === 2);
    await expectDom('funds plaque matches sim', (f) => (document.querySelector('.hud-funds')?.getAttribute('aria-label') || '').includes(f), money(s.world.funds));
    await h.shot(page, 'game');
    // first-run tutorial: a tip shows up and "Got it" dismisses it (the tip also owns Esc while visible)
    await until('first tutorial tip', () => !!window.__afterlife.game.hint, undefined, 30_000);
    const tip = await G(() => window.__afterlife.game.hint.id);
    await expectDom('tip bubble rendered', () => !!document.querySelector('.hud-hint-bubble'));
    await tap(page.locator('.hud-hint-bubble button', { hasText: 'Got it' }));
    await until('tip dismissed', (id) => !window.__afterlife.game.hint || window.__afterlife.game.hint.id !== id, tip, 15_000);
    h.check(`tutorial tip "${tip}" dismissed with Got it`, true);
  }, { needs: ['caz: rename + edit trait → valid'] });

  // ───────────────────────────── live mode ─────────────────────────────
  await step('select a zombie', async () => {
    await pauseGame(); // agents stand still, so picking is stable
    const ids = await G(() => window.__afterlife.game.sim.state.household.memberIds.slice());
    const sel0 = (await state()).selected;
    const other = ids.find((id) => id !== sel0) ?? ids[0];
    const otherName = await G((id) => window.__afterlife.game.sim.state.agents[id].firstName, other);
    await tap(page.locator(`.hud-member[aria-label^="${otherName.replace(/"/g, '\\"')}"]`).first());
    await until('selection switched', (id) => window.__afterlife.game.selectedAgentId === id, other);
    await expectDom('portrait shows pressed state', (n) => (document.querySelector('.hud-member.is-selected')?.getAttribute('aria-label') || '').startsWith(n), otherName);
    await press('Tab'); // cycleZombie
    await until('Tab cycles selection', (id) => window.__afterlife.game.selectedAgentId !== id, other);
    // settle on Mortimer for the rest of the run
    mainAgent = await G(() => {
      const sim = window.__afterlife.game.sim;
      return sim.state.household.memberIds.find((id) => sim.state.agents[id].firstName === 'Mortimer');
    });
    await tap(page.locator('.hud-member[aria-label^="Mortimer"]').first());
    await until('Mortimer selected', (id) => window.__afterlife.game.selectedAgentId === id, mainAgent);
    await expectDom('agent panel shows Mortimer', () => !!document.querySelector('[class*="hud-agent"]') && /Mortimer/.test(document.querySelector('[class*="hud-agent"]').textContent || ''));
  }, { needs: ['enter game'] });

  let queued = null;
  await step('click object → interaction menu', async () => {
    let found = null;
    await clearHints();
    for (let attempt = 0; attempt < 4 && !found; attempt++) {
      const r = await G(P.findInteractableObject, { actorId: mainAgent });
      h.log(`    scan: ${r.scanned} objects hit, candidates ${JSON.stringify(r.candidates.map((c) => `${c.defId}:${c.hits}:${c.entry.label}`))}`);
      if (!r.candidates.length) {
        // The view depends on the household's random lot framing: first zoom out, then aim the camera at an object
        // the sim says Mortimer can use (a framing with few usable objects in view is not a product failure).
        if (attempt === 0) await G(() => window.__afterlife.game.renderer.zoom(-2));
        else {
          const aimed = await G(({ actorId, skip }) => {
            const g = window.__afterlife.game;
            const sim = g.sim;
            const usable = Object.values(sim.state.objects).filter((o) => {
              try {
                return sim.menu(actorId, { kind: 'object', id: o.id }).some((e) => e.available && e.group === null && !(e.children && e.children.length) && !e.interactionId.startsWith('engine_'));
              } catch {
                return false;
              }
            });
            const o = usable[skip % Math.max(1, usable.length)];
            if (!o) return null;
            g.focusObject(o.id);
            return o.defId;
          }, { actorId: mainAgent, skip: attempt - 1 });
          h.log(`    aimed the camera at ${aimed ?? '(no usable object in the sim)'}`);
          await page.waitForTimeout(1200);
        }
        continue;
      }
      for (const c of r.candidates) {
        await page.mouse.move(c.x, c.y);
        await page.mouse.click(c.x, c.y);
        try {
          await until('menu opened', (id) => {
            const m = window.__afterlife.game.menu;
            return !!m && m.target.kind === 'object' && m.target.id === id;
          }, c.id, 20_000); // generous: CI runners render far slower than local (CI #40 befe2a0)
          found = c;
          break;
        } catch {
          await G(() => window.__afterlife.game.closeMenu());
        }
      }
    }
    h.require('an object click opened its menu', !!found);
    await page.locator('[role="menu"]').first().waitFor({ state: 'visible' });
    const labels = await page.locator('[role="menu"] [role="menuitem"]').allInnerTexts();
    h.check('menu lists the expected entry', labels.some((l) => l.includes(found.entry.label)), labels.map((l) => l.split('\n')[0]));
    queued = found;
    await h.shot(page, 'interaction-menu');
  }, { needs: ['select a zombie'] });

  await step('queue interaction → it starts', async () => {
    const before = await G((id) => window.__afterlife.game.sim.queueView(id).map((q) => q.uid), mainAgent);
    await tap(page.locator('[role="menu"] [role="menuitem"]', { hasText: queued.entry.label }).first());
    await until('menu closed', () => window.__afterlife.game.menu === null);
    const item = await G(({ id, before, label }) => window.__afterlife.game.sim.queueView(id).find((q) => !before.includes(q.uid) && q.label === label && q.source === 'player') || null, { id: mainAgent, before, label: queued.entry.label });
    h.require('player item added to the queue', !!item, item);
    await G(P.watchQueue, { agentId: mainAgent, uid: item.uid, label: queued.entry.label });
    await expectDom('queue UI shows the item', (l) => {
      const q = document.querySelector('.hud-queue');
      return !!q && (q.textContent.includes(l) || Array.from(q.querySelectorAll('[aria-label]')).some((e) => e.getAttribute('aria-label').includes(l)));
    }, queued.entry.label);
    await press('Digit3');
    await until('interaction became active', () => window.__e2e.queueWatch.sawActive, undefined, 120_000);
    await until('active ring shows it', () => window.__e2e.queueWatch.sawDomActive, undefined, 15_000).catch(() => {});
    const w = await G(() => ({ ...window.__e2e.queueWatch }));
    h.check('sim reports the run active', w.sawActive, w);
    h.check('queue UI showed it as the active action', w.sawDomActive, w);
    await press('Digit0');
    await G(() => window.__e2e.queueWatch.stop());
    await h.shot(page, 'queue-active');
  }, { needs: ['click object → interaction menu'] });

  await step('speed controls: keyboard 0..3', async () => {
    await ensureLiveNoDialog();
    for (const [key, sp] of [['Digit1', 1], ['Digit2', 2], ['Digit3', 3], ['Digit0', 0]]) {
      await press(key);
      await until(`speed ${sp}`, (s) => window.__afterlife.game.speed === s, sp, 10_000);
      await expectDom(`${key} → speed ${sp} (radio checked)`, (l) => document.querySelector('.hud-speed [role="radio"][aria-checked="true"]')?.getAttribute('aria-label') === l, ['Pause', 'Normal speed', 'Fast', 'Faster'][sp]);
    }
    // time stands still at 0 …
    const t0 = (await state()).world.tick;
    await page.waitForTimeout(400);
    h.check('paused: no ticks', (await state()).world.tick === t0);
    // … and runs at 3
    await press('Digit3');
    await until('ticks advance at speed 3', (t) => window.__afterlife.game.sim.state.tick > t + 2, t0, 30_000);
    await press('Space');
    await until('Space pauses', () => window.__afterlife.game.speed === 0);
    await press('Space');
    await until('Space resumes previous speed', () => window.__afterlife.game.speed === 3);
    await press('Digit0');
  }, { needs: ['enter game'] });

  await step('speed controls: buttons', async () => {
    for (const [name, sp] of [['Normal speed', 1], ['Fast', 2], ['Faster', 3], ['Pause', 0]]) {
      // tutorial tips take clicks by design; one covered the speed buttons on CI (#35 at 4f84cc4, both attempts)
      await clearHints();
      await tap(page.locator(`.hud-speed [role="radio"][aria-label="${name}"]`));
      await until(`speed ${sp}`, (s) => window.__afterlife.game.speed === s, sp, 10_000);
      await expectDom(`"${name}" button → speed ${sp}, radio checked`, (l) => document.querySelector('.hud-speed [role="radio"][aria-checked="true"]')?.getAttribute('aria-label') === l, name);
    }
    const ultra = page.locator('.hud-speed [role="radio"][aria-label="Ultra speed"]');
    if ((await ultra.count()) && (await ultra.getAttribute('aria-disabled')) === 'true') {
      await ultra.click({ force: true }); // deliberately clicking a locked control
      await page.waitForTimeout(200);
      h.check('locked Ultra button does not change speed', (await state()).speed === 0);
    }
  }, { needs: ['enter game'] });

  // ───────────────────────────── buy mode ─────────────────────────────
  const buyItem = await G(() => {
    const g = window.__afterlife.game;
    if (!g.sim) return null;
    const defs = Object.values(g.sim.content.objects).filter((d) => d.buyable && d.placement === 'floor' && d.footprint.w === 1 && d.footprint.d === 1 && d.price > 0);
    defs.sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
    const d = defs.find((x) => x.price >= 10) ?? defs[0];
    return d ? { id: d.id, name: d.name, price: d.price } : null;
  }).catch(() => null);

  /** Place `buyItem` through the catalog UI on a free visible tile; returns { cost, objectId }. */
  const placeViaUi = async (tag) => {
    await clearHints();
    await page.getByRole('searchbox', { name: 'Search the catalog' }).or(page.locator('input[aria-label="Search the catalog"]')).first().fill(buyItem.name);
    const card = page.locator('button.hud-item').filter({ hasText: buyItem.name }).first();
    try {
      await tap(card, { timeout: 45_000 });
    } catch (e) {
      const dom = await G(() => ({ search: document.querySelector('.hud-buy input')?.value, items: Array.from(document.querySelectorAll('.hud-item')).map((b) => b.getAttribute('aria-label')).slice(0, 12) }));
      throw new Error(`catalog card for "${buyItem.name}" not clickable: ${JSON.stringify(dom)} (${String(e.message).split('\n')[0]})`);
    }
    await until('placing item', (id) => window.__afterlife.game.buy.placingDefId === id, buyItem.id, 10_000);
    await clearHints();
    const tiles = await G(P.findPlaceTile, { defId: buyItem.id });
    h.require(`${tag}: a free visible tile exists`, tiles.length > 0);
    const t = tiles[0];
    const before = await state();
    await page.mouse.move(t.sx - 3, t.sy - 3);
    await page.mouse.move(t.sx, t.sy);
    await until('valid ghost label', () => /^\$/.test(window.__afterlife.game.buildPreviewLabel || ''), undefined, 15_000);
    await page.mouse.click(t.sx, t.sy);
    await until('object bought', (n) => Object.keys(window.__afterlife.game.sim.state.objects).length === n + 1, before.world.objects, 15_000);
    const after = await state();
    // W-116 (D-062): one click places ONE item and leaves placement by itself (no stray second purchase)
    await until('placement ended by itself after one item', () => window.__afterlife.game.buy.placingDefId === null, undefined, 10_000);
    h.check(`${tag}: one click = one item, back to the catalog`, (await state()).world.objects === before.world.objects + 1);
    return { before, after, cost: t.cost, tile: t };
  };

  await step('buy mode: place object, funds decrease', async () => {
    h.require('a cheap 1×1 catalog item exists', !!buyItem, buyItem);
    await ensureLiveNoDialog();
    await press('KeyB');
    await until('buy mode', () => window.__afterlife.game.mode === 'buy' && !!document.querySelector('.hud-buy'));
    const r = await placeViaUi('buy');
    h.check('funds decreased by the price', r.after.world.funds === r.before.world.funds - r.cost, { before: r.before.world.funds, after: r.after.world.funds, cost: r.cost });
    await until('funds plaque updated', (f) => (document.querySelector('.hud-funds')?.getAttribute('aria-label') || '').includes(f), money(r.after.world.funds), 10_000);
    h.check('undo is available', await G(() => window.__afterlife.game.canUndo));
    await h.shot(page, 'buy-placed');
    saved.buy = r;
  }, { needs: ['enter game'] });

  await step('buy mode: undo restores funds (and redo/undo cycles)', async () => {
    const r = saved.buy;
    await blur();
    await page.keyboard.press('Control+KeyZ');
    await until('undo refunds', (f) => window.__afterlife.game.sim.state.household.funds === f, r.before.world.funds, 10_000);
    h.check('object removed by undo', (await state()).world.objects === r.before.world.objects);
    await page.keyboard.press('Control+KeyY');
    await until('redo re-buys', (f) => window.__afterlife.game.sim.state.household.funds === f, r.after.world.funds, 10_000);
    await page.keyboard.press('Control+KeyZ');
    await until('undo again', (f) => window.__afterlife.game.sim.state.household.funds === f, r.before.world.funds, 10_000);
    // ADVERSARIAL: extra undos with an empty history must be harmless
    for (let i = 0; i < 3; i++) await page.keyboard.press('Control+KeyZ');
    await page.waitForTimeout(200);
    const s = await state();
    h.check('spurious undos change nothing', s.world.funds === r.before.world.funds && s.world.objects === r.before.world.objects, s.world);
    await until('funds plaque restored', (f) => (document.querySelector('.hud-funds')?.getAttribute('aria-label') || '').includes(f), money(r.before.world.funds), 10_000);
  }, { needs: ['buy mode: place object, funds decrease'] });

  // ───────────────────────────── build mode ─────────────────────────────
  await step('build mode: draw a wall, undo', async () => {
    await G(() => window.__afterlife.game.cancelPlacement());
    await press('KeyU');
    await until('build mode', () => window.__afterlife.game.mode === 'build' && !!document.querySelector('.hud-build'));
    await tap(page.locator('.hud-tool[data-hint-anchor="tool-wall"]'));
    await until('wall tool', () => window.__afterlife.game.buildTool.kind === 'wall');
    await clearHints(); // the "Building" tip pops up over the lot on first entry
    const style = await G(() => window.__afterlife.game.buildTool.style);
    const runs = await G(P.findWallRun, { style });
    h.require('a visible free wall run exists', runs.length > 0);
    let run = runs[0];
    const before = await state();
    // ADVERSARIAL: a zero-length drag (press + release on one vertex) must not build anything
    await page.mouse.move(run.ax, run.ay);
    await page.mouse.down();
    await page.mouse.move(run.ax + 1, run.ay);
    await page.mouse.up();
    await page.waitForTimeout(200);
    h.check('zero-length drag builds nothing', (await state()).world.walls === before.world.walls);
    // a tutorial tip can pop up over the lot at any moment: if the drag shows no preview, release, dismiss, retry
    let label = null;
    for (let attempt = 0; attempt < 3 && !label; attempt++) {
      await clearHints();
      // Re-find the run each attempt (the camera may have moved) and WAIT until nothing covers its endpoints:
      // a dismissed hint bubble stays in the DOM until the HUD's next animation frame, which can take a while
      // under SwiftShader. The old `if (!clear) continue;` burned all 3 attempts in ~40 ms (CI job 127638615840).
      if (attempt > 0) {
        const again = await G(P.findWallRun, { style });
        if (again.length > 0) run = again[0];
      }
      try {
        await page.waitForFunction(({ ax, ay, bx, by }) => {
          const c = document.getElementById('game-canvas');
          return document.elementFromPoint(ax, ay) === c && document.elementFromPoint(bx, by) === c;
        }, run, { polling: 100, timeout: 15_000 });
      } catch {
        const cover = await G(({ ax, ay, bx, by }) => {
          const name = (e) => (e ? `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}.${String(e.className).trim().split(/\s+/).join('.')}` : 'none');
          return [document.elementFromPoint(ax, ay), document.elementFromPoint(bx, by)].map(name).join(' | ');
        }, run).catch(() => 'unknown');
        h.log(`    (wall run endpoints still covered after 15 s on attempt ${attempt + 1}: covered by ${cover}; retrying)`);
        continue;
      }
      await page.mouse.move(run.ax, run.ay);
      await page.mouse.down();
      const steps = 8;
      for (let i = 1; i <= steps; i++) await page.mouse.move(run.ax + ((run.bx - run.ax) * i) / steps, run.ay + ((run.by - run.ay) * i) / steps);
      try {
        await until('wall preview label', () => /walls?/.test(window.__afterlife.game.buildPreviewLabel || ''), undefined, 10_000);
        label = await G(() => window.__afterlife.game.buildPreviewLabel);
      } catch {
        await page.mouse.up();
        // Escape only cancels a LIVE drag; with no drag it switches the build tool to Select, after which every
        // retry would pan the camera instead of drawing. So: Escape only if a preview is live, then restore the tool.
        if (await G(() => !!window.__afterlife.game.buildPreviewLabel)) await page.keyboard.press('Escape');
        if ((await G(() => window.__afterlife.game.buildTool.kind)) !== 'wall') {
          await tap(page.locator('.hud-tool[data-hint-anchor="tool-wall"]'));
          await until('wall tool', () => window.__afterlife.game.buildTool.kind === 'wall');
        }
        h.log(`    (wall drag attempt ${attempt + 1} showed no preview; retrying)`);
      }
    }
    h.require('wall drag shows a cost preview', !!label);
    await h.shot(page, 'build-drag');
    await page.mouse.up();
    await until('walls built', (n) => Object.keys(window.__afterlife.game.sim.state.lot.walls).length > n, before.world.walls, 15_000);
    const after = await state();
    h.check(`3 wall segments added (label "${label}")`, after.world.walls === before.world.walls + run.edges.length, { before: before.world.walls, after: after.world.walls });
    h.check('funds charged for the wall', after.world.funds === before.world.funds - run.cost, { before: before.world.funds, after: after.world.funds, cost: run.cost });
    await tap(page.locator('.hud-build').getByRole('button', { name: 'Undo' }));
    await until('wall undone', (n) => Object.keys(window.__afterlife.game.sim.state.lot.walls).length === n, before.world.walls, 10_000);
    h.check('undo refunds the wall', (await state()).world.funds === before.world.funds);
    await press('KeyL');
    await until('live mode', () => window.__afterlife.game.mode === 'live');
  }, { needs: ['enter game'] });

  // ───────────────────────────── saving ─────────────────────────────
  const openSaveDialog = async () => {
    await ensureLiveNoDialog();
    await escUntil('pause menu', () => window.__afterlife.game.dialog === 'pause');
    await tap(dialog().getByRole('button', { name: 'Save Game' }));
    await until('save dialog', () => window.__afterlife.game.dialog === 'saveLoad' && !!document.querySelector('.sh-saves__new'));
  };
  const newSaveInput = () => page.locator('.sh-saves__new input');
  const newSaveButton = () => page.locator('.sh-saves__savebtn');

  await step('save to a named slot', async () => {
    await ensureLiveNoDialog();
    await pauseGame(); // every save of this slot below captures the same world
    await openSaveDialog();
    // ADVERSARIAL: an empty name cannot be saved
    await newSaveInput().fill('');
    await expectDom('empty save name disables Save', () => document.querySelector('.sh-saves__savebtn')?.disabled === true);
    await expectDom('empty save name explains why', () => (document.querySelector('.sh-saves__new')?.textContent || '').includes('Give the save a name.'));
    await newSaveInput().fill('E2E Slot');
    await tap(newSaveButton());
    await until('saved status', () => /Saved “E2E Slot”/.test(document.querySelector('.sh-saves__status')?.textContent || ''), undefined, 30_000);
    const slots = await G(() => window.__afterlife.game.listSaves());
    const mine = slots.filter((s) => s.name === 'E2E Slot');
    h.require('exactly one "E2E Slot" save', mine.length === 1, slots.map((s) => s.name));
    saved.named = mine[0].slotId;
    saved.snapshot = (await state()).world;
    h.check('slot meta matches the world', mine[0].meta.householdName === saved.snapshot.household && mine[0].meta.funds === saved.snapshot.funds && mine[0].meta.day === saved.snapshot.day, mine[0].meta);
    await expectDom('slot listed in the dialog', () => Array.from(document.querySelectorAll('.sh-slot')).filter((e) => e.textContent.includes('E2E Slot')).length === 1);
    await h.shot(page, 'saved');
  }, { needs: ['enter game'] });

  await step('save spam: double-click, F5 burst, concurrent saves', async () => {
    // double-click "Save" with a new name → one slot, not two
    await newSaveInput().fill('Spam');
    await tap(newSaveButton(), { dbl: true });
    await until('spam saved', () => /Saved “Spam”/.test(document.querySelector('.sh-saves__status')?.textContent || ''), undefined, 30_000);
    await idle();
    const slots = await G(() => window.__afterlife.game.listSaves());
    const spam = slots.filter((s) => s.name === 'Spam');
    h.check('double-click created exactly one save', spam.length === 1, slots.map((s) => s.name));
    saved.spamId = spam[0] ? spam[0].slotId : null;
    await page.keyboard.press('Escape');
    await until('dialogs closed', () => window.__afterlife.game.dialog === null || window.__afterlife.game.dialog === 'pause');
    await G(() => {
      for (let i = 0; i < 4 && window.__afterlife.game.dialog; i++) window.__afterlife.game.closeDialog();
    });
    await until('no dialog', () => window.__afterlife.game.dialog === null);
    // F5 ×6 (quick-save) must neither reload the page nor fail
    const bootId = await G(() => window.__e2e.bootId);
    const countBefore = (await G(() => window.__afterlife.game.listSaves())).length;
    await blur();
    for (let i = 0; i < 6; i++) await page.keyboard.press('F5');
    await until('quick-saves settled', () => !window.__afterlife.game.saving, undefined, 30_000);
    await idle();
    h.check('F5 did not reload the page', (await G(() => window.__e2e.bootId)) === bootId);
    const st = await state();
    h.check('quick-save burst did not fail', st.lastSaveFailed === false, st);
    const after = await G(() => window.__afterlife.game.listSaves());
    h.check('quick-save burst added at most one slot', after.length <= countBefore + 1, { before: countBefore, after: after.length });
    // ADVERSARIAL: 6 concurrent overwrites of the named slot (also gives it a backup copy)
    const results = await G(async (id) => {
      const g = window.__afterlife.game;
      const rs = await Promise.allSettled(Array.from({ length: 6 }, () => g.saveGame(id, 'E2E Slot')));
      return rs.map((r) => (r.status === 'fulfilled' ? (r.value.ok ? 'ok' : `fail:${r.value.code}`) : `threw:${String(r.reason)}`));
    }, saved.named);
    h.check('concurrent saves never throw', results.every((r) => !r.startsWith('threw')), results);
    h.check('concurrent saves: every one ok or busy', results.every((r) => r === 'ok' || r === 'fail:busy'), results);
    h.check('concurrent saves: at least one landed', results.includes('ok'), results);
    await idle();
    const named = (await G(() => window.__afterlife.game.listSaves())).find((s) => s.slotId === saved.named);
    h.check('named slot still healthy', !!named && !named.recoveredFromBackup && named.meta.funds === saved.snapshot.funds, named && named.meta);
    h.check('world did not advance while paused', (await state()).world.tick === saved.snapshot.tick, { saved: saved.snapshot.tick, now: (await state()).world.tick });
    const keys = await G(P.listIdbKeys);
    h.check('named slot has a backup copy', keys.includes(`slot:${saved.named}:backup`), keys.filter((k) => k.includes(saved.named)));
  }, { needs: ['save to a named slot'] });

  await step('reload → Load restores household, funds, day', async () => {
    await idle();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await untilScreen('menu', 240_000);
    const cont = page.locator('.sh-menu__item', { hasText: 'Continue' });
    await until('Continue enabled', () => {
      const b = Array.from(document.querySelectorAll('.sh-menu__item')).find((x) => x.textContent.includes('Continue'));
      return !!b && !b.disabled;
    });
    await expectDom('Continue names the household + day', () => /The Testgraves · Day \d+/.test(Array.from(document.querySelectorAll('.sh-menu__item')).find((x) => x.textContent.includes('Continue'))?.textContent || ''));
    void cont;
    await tap(page.locator('.sh-menu__item', { hasText: 'Load Game' }));
    await until('load dialog', () => window.__afterlife.game.dialog === 'saveLoad' && !!document.querySelector('.sh-slot'));
    await tap(page.locator('.sh-slot', { hasText: 'E2E Slot' }).locator('.sh-slot__go'));
    await confirmIfAsked('Load save', () => window.__afterlife.game.screen === 'game' || window.__afterlife.game.screen === 'loading');
    await untilScreen('game', 180_000);
    await until('renderer loaded', () => window.__afterlife.game.renderer.loadProgress() >= 1, undefined, 120_000);
    const w = (await state()).world;
    const s = saved.snapshot;
    h.check('household restored', w.household === s.household, w.household);
    h.check('funds restored', w.funds === s.funds, { saved: s.funds, loaded: w.funds });
    h.check('day restored', w.day === s.day, { saved: s.day, loaded: w.day });
    h.check('members restored', JSON.stringify(w.members) === JSON.stringify(s.members), w.members);
    h.check('objects restored', w.objects === s.objects, { saved: s.objects, loaded: w.objects });
    // the loaded world starts running at once (the renderer finishes loading meanwhile), so it may be a few ticks on
    h.check('clock restored (same tick, or just past it)', w.tick >= s.tick && w.tick - s.tick < 120, { saved: s.tick, loaded: w.tick });
    await h.shot(page, 'loaded');
  }, { needs: ['save spam: double-click, F5 burst, concurrent saves'] });

  // ───────────────────────────── adversarial ─────────────────────────────
  await step('corrupt save primary → recovered from backup', async () => {
    await pauseGame();
    const r = await G(P.corruptIdbKey, { key: `slot:${saved.named}:primary` }); // ADVERSARIAL
    h.require('flipped a byte in IndexedDB', r.ok, r);
    const toastsBefore = await G(() => window.__afterlife.game.toasts.map((t) => t.id));
    await openSaveDialog();
    await tap(page.locator('.sh-saves [role="tab"], .ui-tabs [role="tab"]', { hasText: 'Load' }).first());
    const row = page.locator('.sh-slot', { hasText: 'E2E Slot' });
    await row.waitFor();
    await tap(row.locator('.sh-slot__go'));
    await confirmIfAsked('Load save', () => window.__afterlife.game.dialog === null || window.__afterlife.game.screen === 'loading', 30_000);
    await until('loaded recovered save', () => window.__afterlife.game.screen === 'game' && window.__afterlife.game.dialog === null && window.__afterlife.game.renderer.loadProgress() >= 1, undefined, 120_000);
    const w = (await state()).world;
    h.check('recovered world is the saved household', w.household === saved.snapshot.household && w.funds === saved.snapshot.funds && w.day === saved.snapshot.day, w);
    h.check('no fatal error', (await state()).fatal === null);
    const toast = await G((before) => window.__afterlife.game.toasts.filter((t) => !before.includes(t.id)).map((t) => `${t.title}: ${t.text}`), toastsBefore);
    h.check('player is told the backup was used', toast.some((t) => /recovered/i.test(t)), toast);
    await expectDom('recovery toast rendered in the HUD', () => /Save recovered/.test(document.body.textContent || ''));
    // the slot list now remembers that this slot runs on its backup copy
    const info = (await G(() => window.__afterlife.game.listSaves())).find((s) => s.slotId === saved.named);
    h.check('slot list flags the recovery after load', !!info && info.recoveredFromBackup === true, info && { recovered: info.recoveredFromBackup });
    await openSaveDialog();
    await tap(page.locator('.sh-saves [role="tab"], .ui-tabs [role="tab"]', { hasText: 'Load' }).first());
    await expectDom('dialog shows the Recovered badge', () => Array.from(document.querySelectorAll('.sh-slot')).some((e) => e.textContent.includes('E2E Slot') && !!e.querySelector('.sh-slot__recovered')));
    await h.shot(page, 'recovered-badge');
    await ensureLiveNoDialog();
    // saving over a recovered slot heals it: the next load is clean again
    const res = await G((id) => window.__afterlife.game.saveGame(id, 'E2E Slot').then((r) => (r.ok ? 'ok' : r.error)), saved.named);
    h.check('re-save over the recovered slot', res === 'ok', res);
    const healed = await G((id) => window.__afterlife.game.listSaves().then((l) => l.find((s) => s.slotId === id)), saved.named);
    h.check('slot healthy after re-save', !!healed && healed.recoveredFromBackup === false, healed && healed.recoveredFromBackup);
  }, { needs: ['reload → Load restores household, funds, day'] });

  await step('corrupt primary + backup → reported, no crash', async () => {
    h.require('spam slot exists', !!saved.spamId);
    for (const role of ['primary', 'backup']) {
      const r = await G(P.corruptIdbKey, { key: `slot:${saved.spamId}:${role}`, offsetFrac: 0.3 }); // ADVERSARIAL
      if (role === 'primary') h.require('flipped primary', r.ok, r);
    }
    const res = await G((id) => window.__afterlife.game.loadGame(id).then((r) => (r.ok ? { ok: true } : { ok: false, code: r.code, error: r.error })), saved.spamId);
    h.check('load refuses the corrupt save', res.ok === false && res.code === 'corrupt', res);
    const s = await state();
    h.check('still in the game, world intact', s.screen === 'game' && s.fatal === null && s.world.household === saved.snapshot.household, s);
    // and through the UI: the dialog reports the problem instead of crashing
    await openSaveDialog();
    await tap(page.locator('.sh-saves [role="tab"], .ui-tabs [role="tab"]', { hasText: 'Load' }).first());
    const row = page.locator('.sh-slot', { hasText: 'Spam' });
    if (await row.count()) {
      await tap(row.locator('.sh-slot__go'));
      await confirmIfAsked('Load save', () => !!document.querySelector('.sh-saves__status.is-bad'), 20_000);
      const told = () => {
        const st = document.querySelector('.sh-saves__status.is-bad');
        const msgs = [st ? st.textContent : '', ...window.__afterlife.game.toasts.map((t) => `${t.title}: ${t.text}`)];
        return msgs.find((m) => /corrupt|damaged|could not|couldn/i.test(m || '')) || null;
      };
      await until('damage reported', told, undefined, 20_000);
      h.check('player is told the save is damaged', true, await G(told));
    } else {
      h.check('unreadable save is listed or hidden without crashing', true, 'row hidden');
    }
    await h.shot(page, 'corrupt-reported');
    await ensureLiveNoDialog();
    h.check('game still running after the failed load', (await state()).screen === 'game');
  }, { needs: ['reload → Load restores household, funds, day'] });

  await step('resize 1280×720 ↔ 390×844', async () => {
    await ensureLiveNoDialog();
    for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 720 }]) {
      await page.setViewportSize(vp);
      await until(`canvas resized to ${vp.width}`, (w) => {
        const c = document.getElementById('game-canvas');
        return !!c && Math.abs(c.getBoundingClientRect().width - w) < 2 && c.width > 0;
      }, vp.width, 20_000);
      await expectDom(`${vp.width}×${vp.height}: no horizontal page scroll`, () => document.documentElement.scrollWidth <= innerWidth);
      await expectDom(`${vp.width}×${vp.height}: top bar laid out inside the viewport`, () => {
        const r = document.querySelector('.hud-topbar')?.getBoundingClientRect();
        return !!r && r.width > 0 && r.left >= -1 && r.right <= innerWidth + 1;
      });
      await expectDom(`${vp.width}×${vp.height}: speed + mode controls inside the viewport`, () =>
        ['.hud-speed', '.hud-modes'].every((sel) => {
          const r = document.querySelector(sel)?.getBoundingClientRect();
          return !!r && r.width > 0 && r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1;
        }));
      await expectDom(`${vp.width}×${vp.height}: canvas backing store matches`, () => {
        const c = document.getElementById('game-canvas');
        const r = c.getBoundingClientRect();
        return c.width > 0 && c.height > 0 && Math.abs(c.width / c.height - r.width / r.height) < 0.03;
      });
      await h.shot(page, `resize-${vp.width}x${vp.height}`);
    }
    h.check('no fatal error after resizes', (await state()).fatal === null);
  }, { needs: ['enter game'] });

  await step('WebGL context loss mid-game recovers', async () => {
    await ensureLiveNoDialog();
    await press('Digit1');
    const ok = await G(() => {
      const c = document.getElementById('game-canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      const ext = gl && gl.getExtension('WEBGL_lose_context');
      if (!ext) return false;
      window.__e2e.loseCtx = ext;
      ext.loseContext(); // ADVERSARIAL
      return true;
    });
    h.require('WEBGL_lose_context available', ok);
    // RendererImpl.stats() is the renderer's debug readout (not part of RendererAPI); the HUD-independent signal.
    const lost = () => window.__afterlife.game.renderer.stats().contextLost === true;
    await until('context reported lost', lost, undefined, 15_000);
    const t0 = (await state()).world.tick;
    await until('simulation keeps running while lost', (t) => window.__afterlife.game.sim.state.tick > t, t0, 30_000);
    h.check('no fatal error while lost', (await state()).fatal === null);
    await G(() => window.__e2e.loseCtx.restoreContext());
    await until('context restored', () => window.__afterlife.game.renderer.stats().contextLost === false, undefined, 30_000);
    await until('renders again (snapshot non-empty)', () => {
      try {
        return window.__afterlife.game.renderer.snapshot(64, 36).length > 200;
      } catch {
        return false;
      }
    }, undefined, 30_000);
    h.check('no fatal error after restore', (await state()).fatal === null);
    await press('Digit0');
    await h.shot(page, 'context-restored');
  }, { needs: ['enter game'] });

  await step('offline after load still works', async () => {
    await ensureLiveNoDialog();
    await context.setOffline(true); // ADVERSARIAL: no network from here on
    try {
      h.check('browser reports offline', (await G(() => navigator.onLine)) === false);
      await press('Digit3');
      const t0 = (await state()).world.tick;
      await until('time passes offline', (t) => window.__afterlife.game.sim.state.tick > t + 2, t0, 30_000);
      await press('Digit0');
      if (buyItem) {
        await press('KeyB');
        await until('buy mode', () => window.__afterlife.game.mode === 'buy' && !!document.querySelector('.hud-buy'));
        const r = await placeViaUi('offline buy');
        h.check('offline purchase charged', r.after.world.funds === r.before.world.funds - r.cost);
        await press('KeyL');
      }
      const res = await G(() => window.__afterlife.game.saveGame('e2e-offline', 'Offline').then((r) => (r.ok ? 'ok' : `${r.code}: ${r.error}`)));
      h.check('offline save works', res === 'ok', res);
      await escUntil('pause menu', () => window.__afterlife.game.dialog === 'pause');
      await tap(dialog().getByRole('button', { name: 'Settings' }));
      await until('settings opened offline', () => window.__afterlife.game.dialog === 'settings');
      await page.keyboard.press('Escape');
      await G(() => {
        for (let i = 0; i < 4 && window.__afterlife.game.dialog; i++) window.__afterlife.game.closeDialog();
      });
      await until('dialogs closed', () => window.__afterlife.game.dialog === null);
      h.check('still healthy offline', (await state()).fatal === null);
    } finally {
      await context.setOffline(false);
    }
  }, { needs: ['enter game'] });

  await step('quit to menu, Continue resumes', async () => {
    await ensureLiveNoDialog();
    const before = (await state()).world;
    await escUntil('pause menu', () => window.__afterlife.game.dialog === 'pause');
    await tap(dialog().getByRole('button', { name: 'Main Menu' }));
    await confirmIfAsked('Return to menu', () => window.__afterlife.game.screen === 'menu');
    await untilScreen('menu', 60_000);
    await idle();
    await until('Continue enabled', () => {
      const b = Array.from(document.querySelectorAll('.sh-menu__item')).find((x) => x.textContent.includes('Continue'));
      return !!b && !b.disabled;
    });
    await tap(page.locator('.sh-menu__item', { hasText: 'Continue' }));
    await untilScreen('game', 180_000);
    const w = (await state()).world;
    h.check('Continue resumes the household we quit', w.household === before.household && w.funds === before.funds && w.day === before.day, { before, w });
    await escUntil('pause menu', () => window.__afterlife.game.dialog === 'pause');
    await tap(dialog().getByRole('button', { name: 'Main Menu' }));
    await confirmIfAsked('Return to menu', () => window.__afterlife.game.screen === 'menu');
    await untilScreen('menu', 60_000);
    await idle();
    await h.shot(page, 'menu-after-quit');
  }, { needs: ['enter game'] });

  await step('corrupt settings profile → boots with sane settings', async () => {
    const keys = await G(P.listIdbKeys);
    const key = keys.find((k) => k === 'profile:settings');
    h.require('settings profile record exists', !!key, keys.filter((k) => k.startsWith('profile:')));
    const r = await G(P.corruptIdbKey, { key, offsetFrac: 0.4 }); // ADVERSARIAL
    h.require('flipped a byte in the settings record', r.ok, r);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await untilScreen('menu', 240_000);
    const s = await G(() => window.__afterlife.game.settings);
    h.check('settings are a complete, valid object', ['low', 'medium', 'high', 'ultra'].includes(s.quality) && typeof s.showFps === 'boolean' && s.volumes && typeof s.volumes.master === 'number', s);
    h.check('menu usable', (await page.locator('.sh-menu__item', { hasText: 'New Game' }).isEnabled()) === true);
  }, { needs: ['boot to main menu'] });

  await drainRejections();
  await context.close();
}
