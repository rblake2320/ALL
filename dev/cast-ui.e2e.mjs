/**
 * Cast bodies — real-browser check on the BUILT game (UI/GAME side).
 *
 *   node dev/cast-ui.e2e.mjs [--rebuild | --no-build] [--dist=<dir>] [--url=http://127.0.0.1:4173/]
 *
 * Menu (demo household with cast bodies) → New Game → Create-a-Zombie Body tab: keyboard roving tabindex + aria,
 * pick 3 different cast bodies for 3 zombies (one per category), greyed-out style options, enter the game, HUD
 * portraits use the cast thumbnails, save to a named slot, reload the page, Continue → the bodies persist.
 * Zero console errors / failed requests (harness rule). Screenshots + report.json → dev/out/cast/.
 */
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness } from '../tests/e2e/lib/harness.mjs';
import { ensureBuild, startPreview } from '../tests/e2e/lib/server.mjs';
import * as P from '../tests/e2e/lib/inpage.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// own subfolder: dev/out/cast/ is shared with the runtime agent's screenshots (never wipe theirs)
const OUT = path.join(ROOT, 'dev', 'out', 'cast', 'ui');
const POLL = { polling: 100 };
const PICKS = ['granny', 'ringmaster', 'pizza'];

async function flow({ h, browser, url }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(P.initScript);
  const page = await context.newPage();
  page.setDefaultTimeout(240_000);
  h.watch(page);
  const G = (fn, arg) => page.evaluate(fn, arg);
  const until = async (what, fn, arg, timeout = 240_000) => {
    try {
      await page.waitForFunction(fn, arg, { ...POLL, timeout });
    } catch {
      throw new Error(`timed out waiting for ${what}`);
    }
  };
  const untilScreen = (sc, timeout = 240_000) => until(`screen=${sc}`, (s) => window.__afterlife?.game?.screen === s, sc, timeout);
  /** Real mouse click; under heavy load (SwiftShader at ~1 fps) fall back to a DOM click on the same element. */
  const tap = async (loc) => {
    const el = loc.first();
    await el.waitFor({ state: 'visible' });
    try {
      await el.click({ force: true, timeout: 15_000 });
    } catch {
      await el.evaluate((e) => e.click());
    }
  };
  const step = (name, fn, opts) => h.step(name, fn, { ...opts, onFail: async () => h.shot(page, `FAIL-${name}`) });
  const dialog = () => page.locator('[role="dialog"][aria-modal="true"]').last();
  const press = async (k) => {
    await G(() => document.activeElement && document.activeElement !== document.body && document.activeElement.blur());
    await page.keyboard.press(k);
  };
  const clearHints = async () => {
    for (let i = 0; i < 6; i++) {
      const id = await G(() => window.__afterlife.game.hint?.id ?? null);
      if (!id) return;
      await G((x) => window.__afterlife.game.dismissHint(x), id);
    }
  };
  /** First-run dialogs from other features (age question, …) may show on every boot: decline them. */
  const dismissFirstRun = async () => {
    for (let i = 0; i < 20; i++) {
      const clicked = await G(() => {
        const b = Array.from(document.querySelectorAll('[role="dialog"] button')).find((x) => x.textContent.trim() === 'Not now');
        if (b) b.click();
        return !!b;
      });
      if (!clicked && i > 3) break;
      await page.waitForTimeout(500);
    }
  };
  const bodies = () =>
    G(() => {
      const s = window.__afterlife.game.sim.serialize();
      return s.household.memberIds.map((id) => ({ name: s.agents[id].firstName, body: s.agents[id].appearance.body ?? null }));
    });

  await step('boot → menu (demo household)', async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await untilScreen('menu');
    // The demo sim has no public handle (GameController exposes only the player's sim); its bodies are covered by
    // tests/unit/game/cast.test.ts (DEMO_BODIES) — here we just capture it rendering.
    await until('renderer loaded', () => window.__afterlife.game.renderer.loadProgress() >= 1, undefined, 180_000);
    await dismissFirstRun();
    await until('no dialog', () => window.__afterlife.game.dialog === null && !document.querySelector('[role="dialog"][aria-modal="true"]'), undefined, 30_000).catch(() => {});
    await page.waitForTimeout(1500);
    await h.shot(page, 'menu-demo');
  });

  await step('new game → CAZ Body tab lists Classic + 25 cast bodies by category', async () => {
    await tap(page.locator('.sh-menu__item', { hasText: 'New Game' }));
    await untilScreen('newGame', 120_000);
    await tap(page.getByRole('button', { name: 'Create your household' }));
    await untilScreen('caz', 120_000);
    await until('caz ready', () => !!document.querySelector('.sh-caz__editor') && window.__afterlife.game.caz?.members.length > 0);
    await tap(page.locator('.sh-editor__tabs [role="tab"]', { hasText: 'Body' }));
    await until('picker', () => document.querySelectorAll('.sh-bodies [role="radio"]').length === 26);
    const info = await G(() => {
      const group = document.querySelector('.sh-bodies');
      const radios = Array.from(group.querySelectorAll('[role="radio"]'));
      return {
        groupRole: group.getAttribute('role'),
        labelled: !!document.getElementById(group.getAttribute('aria-labelledby') || '')?.textContent,
        cats: Array.from(group.querySelectorAll('[role="group"]')).map((g) => document.getElementById(g.getAttribute('aria-labelledby')).textContent + ':' + g.querySelectorAll('[role="radio"]').length),
        tabbable: radios.filter((r) => r.tabIndex === 0).length,
        checked: radios.filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.dataset.body),
        described: radios.every((r) => !!document.getElementById(r.getAttribute('aria-describedby') || '')?.textContent),
        labels: radios.every((r) => (r.getAttribute('aria-label') || '').length > 0),
      };
    });
    h.check('one radiogroup labelled "Body type"', info.groupRole === 'radiogroup' && info.labelled, info);
    h.check('categories Zombies 13 / Bosses 5 / Freshly Turned 7', JSON.stringify(info.cats) === JSON.stringify(['Zombies:13', 'Bosses:5', 'Freshly Turned:7']), info.cats);
    h.check('roving tabindex: exactly one tile tabbable, one checked', info.tabbable === 1 && info.checked.length === 1, info);
    h.check('every tile has an accessible name + blurb description', info.labels && info.described);
    await until('thumbnails decoded', () => Array.from(document.querySelectorAll('.sh-bodies img')).every((i) => i.complete), undefined, 240_000);
    const thumbs = await G(() => ({ imgs: Array.from(document.querySelectorAll('.sh-bodies img')).filter((i) => i.naturalWidth > 0).length, ph: document.querySelectorAll('.sh-body__ph').length }));
    h.check('all 25 thumbnails load (no placeholders)', thumbs.imgs === 25 && thumbs.ph === 0, thumbs);
    await h.shot(page, 'caz-body-picker');
  }, { needs: ['boot → menu (demo household)'] });

  await step('keyboard: arrows move focus + selection; Up/Down cross category rows; Home/End', async () => {
    await G(() => window.__afterlife.game.updateCazMember(0, { appearance: { ...window.__afterlife.game.caz.members[0].appearance, body: 'classic' } }));
    await until('classic', () => !window.__afterlife.game.caz.members[0].appearance.body);
    await page.locator('.sh-bodies [data-body="classic"]').focus();
    // read after the UI has re-rendered (the roving tabindex follows the selection)
    const cur = async () => {
      await until('roving tabindex follows selection', () => {
        const t = Array.from(document.querySelectorAll('.sh-bodies [role="radio"]')).filter((r) => r.tabIndex === 0).map((r) => r.dataset.body);
        return t.length === 1 && t[0] === (window.__afterlife.game.caz.members[0].appearance.body ?? 'classic') && document.activeElement?.dataset?.body === t[0];
      }, undefined, 30_000).catch(() => {});
      return snap();
    };
    const snap = () => G(() => ({ focus: document.activeElement?.dataset?.body ?? null, body: window.__afterlife.game.caz.members[0].appearance.body ?? 'classic', tabbable: Array.from(document.querySelectorAll('.sh-bodies [role="radio"]')).filter((r) => r.tabIndex === 0).map((r) => r.dataset.body) }));
    await page.keyboard.press('ArrowRight');
    let c = await cur();
    h.check('ArrowRight → Walker selected + focused + tabbable', c.focus === 'walker' && c.body === 'walker' && c.tabbable.join() === 'walker', c);
    await page.keyboard.press('ArrowDown');
    c = await cur();
    h.check('ArrowDown moves to the next row', c.focus !== 'walker' && c.body === c.focus, c);
    await page.keyboard.press('End');
    c = await cur();
    h.check('End → last body (Tourist)', c.focus === 'tourist' && c.body === 'tourist', c);
    await page.keyboard.press('ArrowUp');
    c = await cur();
    h.check('ArrowUp from Freshly Turned reaches the row above', c.focus !== 'tourist' && c.body === c.focus, c);
    await page.keyboard.press('Home');
    c = await cur();
    h.check('Home → Classic', c.focus === 'classic' && c.body === 'classic', c);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');
    c = await cur();
    h.check('Space on a selected tile keeps it', c.body === 'walker', c);
  }, { needs: ['new game → CAZ Body tab lists Classic + 25 cast bodies by category'] });

  await step('pick 3 different cast bodies (one per category); style options greyed', async () => {
    while ((await G(() => window.__afterlife.game.caz.members.length)) < 3) {
      await tap(page.locator('.sh-member-add'));
      await page.waitForTimeout(150);
    }
    for (let i = 0; i < 3; i++) {
      await tap(page.locator('.sh-member__btn').nth(i));
      await until(`member ${i} active`, (k) => window.__afterlife.game.caz.activeIndex === k, i);
      await tap(page.locator('.sh-editor__tabs [role="tab"]', { hasText: 'Body' }));
      // Wait until the editor SHOWS member i (a click lands on what is on screen; under SwiftShader load the
      // re-render after switching members can lag by seconds).
      await until(`editor shows member ${i}`, (k) => {
        const pressed = Array.from(document.querySelectorAll('.sh-member__btn')).findIndex((b) => b.getAttribute('aria-pressed') === 'true');
        const checked = document.querySelector('.sh-bodies [role="radio"][aria-checked="true"]')?.dataset.body;
        return pressed === k && checked === (window.__afterlife.game.caz.members[k].appearance.body ?? 'classic');
      }, i);
      const tile = page.locator(`.sh-bodies [data-body="${PICKS[i]}"]`);
      await tap(tile);
      const isSet = ([k, b]) => window.__afterlife.game.caz.members[k].appearance.body === b;
      try {
        await until(`member ${i} = ${PICKS[i]}`, isSet, [i, PICKS[i]], 30_000);
      } catch {
        // SwiftShader under heavy host load can drop a synthetic mouse click; the DOM click is the same handler
        h.log(`    (mouse click on ${PICKS[i]} was dropped; retrying as a DOM click)`);
        await tile.first().evaluate((e) => e.click());
        await until(`member ${i} = ${PICKS[i]}`, isSet, [i, PICKS[i]]);
      }
    }
    const st = await G(() => ({
      locked: !!document.querySelector('.sh-cast-lock'),
      fieldsets: Array.from(document.querySelectorAll('fieldset.sh-na')).map((f) => ({ disabled: f.disabled, described: !!document.getElementById(f.getAttribute('aria-describedby'))?.textContent })),
      heightEnabled: document.querySelectorAll('.ui-slider')[0]?.classList.contains('is-disabled') === false,
      buildDisabled: document.querySelectorAll('.ui-slider')[1]?.classList.contains('is-disabled') === true,
      eyeColorEnabled: !document.querySelector('[aria-labelledby="caz-eyecolor"]')?.closest('fieldset.sh-na'),
    }));
    h.check('lock notice explains greyed options', st.locked, st);
    h.check('skin / eye style / eye colour / stitches disabled + described', st.fieldsets.length === 4 && st.fieldsets.every((f) => f.disabled && f.described), st.fieldsets);
    h.check('height stays enabled, build disabled, eye colour disabled (no eye material, cast.md §2.7)', st.heightEnabled && st.buildDisabled && !st.eyeColorEnabled, st);
    await h.shot(page, 'caz-body-locked');
    await tap(page.locator('.sh-editor__tabs [role="tab"]', { hasText: 'Hair' }));
    const hair = await G(() => ({ notice: !!document.querySelector('.sh-cast-lock'), allDisabled: Array.from(document.querySelectorAll('.sh-tab .ui-choice, .sh-tab .ui-swatch')).every((b) => b.disabled || b.closest('fieldset')?.disabled) }));
    h.check('Hair tab: notice + every option disabled', hair.notice && hair.allDisabled, hair);
    await h.shot(page, 'caz-hair-locked');
    await tap(page.locator('.sh-editor__tabs [role="tab"]', { hasText: 'Outfit' }));
    const outfit = await G(() => ({ notice: !!document.querySelector('.sh-cast-lock'), allDisabled: Array.from(document.querySelectorAll('.sh-tab .ui-choice, .sh-tab .ui-swatch')).every((b) => b.disabled || b.closest('fieldset')?.disabled) }));
    h.check('Outfit tab: notice + every option disabled', outfit.notice && outfit.allDisabled, outfit);
    const portraits = await G(() => Array.from(document.querySelectorAll('.sh-member .ui-portrait')).map((p) => p.dataset.cast ?? null));
    h.check('household list portraits use the cast thumbnails', JSON.stringify(portraits) === JSON.stringify(PICKS), portraits);
    await G(() => window.__afterlife.game.updateCaz({ householdName: 'The Castwells' }));
    const errs = await G(() => window.__afterlife.game.validateCaz());
    h.require('CAZ validates clean with cast bodies', errs.length === 0, errs);
    await tap(page.locator('.sh-editor__tabs [role="tab"]', { hasText: 'Identity' }));
    await page.waitForTimeout(800);
    await h.shot(page, 'caz-identity-cast');
  }, { needs: ['new game → CAZ Body tab lists Classic + 25 cast bodies by category'] });

  await step('enter game: bodies reach the sim, HUD portraits use thumbnails', async () => {
    await tap(page.locator('.sh-editor__start'));
    await untilScreen('game');
    await until('renderer + HUD', () => window.__afterlife.game.renderer.loadProgress() >= 1 && !!document.querySelector('.hud-household'), undefined, 120_000);
    await clearHints();
    const b = await bodies();
    h.check('sim household bodies = picks', JSON.stringify(b.map((x) => x.body)) === JSON.stringify(PICKS), b);
    const town = await G(() => Object.values(window.__afterlife.game.sim.serialize().agents).filter((a) => a.role === 'townie').map((a) => a.appearance.body ?? null));
    const counts = {};
    for (const t of town) if (t) counts[t] = (counts[t] ?? 0) + 1;
    h.check('24 townies, ~60 % cast, no body more than twice', town.length === 24 && town.filter(Boolean).length >= 8 && town.filter(Boolean).length <= 20 && Object.values(counts).every((n) => n <= 2), town);
    await until('hud portraits', () => document.querySelectorAll('.hud-household .ui-portrait[data-cast]').length >= 3, undefined, 120_000).catch(() => {});
    const hud = await G(() => Array.from(document.querySelectorAll('.hud-household .ui-portrait')).map((p) => p.dataset.cast ?? null));
    h.check('HUD household bar shows the cast portraits', PICKS.every((p) => hud.includes(p)), hud);
    await page.waitForTimeout(2500);
    await h.shot(page, 'game-cast');
  }, { needs: ['pick 3 different cast bodies (one per category); style options greyed'] });

  await step('save → reload page → Continue: bodies persist', async () => {
    await press('Digit0');
    await until('paused', () => window.__afterlife.game.speed === 0, undefined, 60_000).catch(() => {});
    await clearHints();
    await press('Escape');
    await until('pause menu', () => window.__afterlife.game.dialog === 'pause', undefined, 120_000);
    await tap(dialog().getByRole('button', { name: 'Save Game' }));
    await until('save dialog', () => window.__afterlife.game.dialog === 'saveLoad' && !!document.querySelector('.sh-saves__new'));
    await page.locator('.sh-saves__new input').fill('Cast Slot');
    await tap(page.locator('.sh-saves__savebtn'));
    await until('saved', () => /Saved “Cast Slot”/.test(document.querySelector('.sh-saves__status')?.textContent || ''), undefined, 240_000);
    const townBefore = await G(() => Object.values(window.__afterlife.game.sim.serialize().agents).filter((a) => a.role === 'townie').map((a) => a.appearance.body ?? null));
    await G(P.persistenceIdle);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await untilScreen('menu');
    await dismissFirstRun();
    await until('Continue enabled', () => {
      const b = Array.from(document.querySelectorAll('.sh-menu__item')).find((x) => x.textContent.includes('Continue'));
      return !!b && !b.disabled;
    });
    await tap(page.locator('.sh-menu__item', { hasText: 'Continue' }));
    try {
      await until('leaving the menu', () => window.__afterlife.game.screen !== 'menu', undefined, 60_000);
    } catch {
      const st = await G(() => ({ screen: window.__afterlife.game.screen, dialog: window.__afterlife.game.dialog, modal: document.querySelector('[role="dialog"][aria-modal="true"]')?.textContent?.slice(0, 120) ?? null }));
      h.log(`    (Continue click had no effect: ${JSON.stringify(st)}; retrying as a DOM click)`);
      await dismissFirstRun();
      await page.locator('.sh-menu__item', { hasText: 'Continue' }).first().evaluate((e) => e.click());
    }
    await untilScreen('game');
    await until('renderer', () => window.__afterlife.game.renderer.loadProgress() >= 1, undefined, 120_000);
    await clearHints();
    const b = await bodies();
    h.check('bodies persisted across save + reload + Continue', JSON.stringify(b.map((x) => x.body)) === JSON.stringify(PICKS), b);
    const townAfter = await G(() => Object.values(window.__afterlife.game.sim.serialize().agents).filter((a) => a.role === 'townie').map((a) => a.appearance.body ?? null));
    h.check('townie bodies persisted unchanged', JSON.stringify(townAfter) === JSON.stringify(townBefore));
    const warnings = await G(() => window.__afterlife.game.sim.repairWarnings);
    h.check('no repair warnings on load', warnings.length === 0, warnings);
    await page.waitForTimeout(2500);
    await h.shot(page, 'game-after-reload');
  }, { needs: ['enter game: bodies reach the sim, HUD portraits use thumbnails'] });

  await context.close();
}

async function main() {
  const argv = process.argv.slice(2);
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) if (/\.(png|json)$/.test(f)) rmSync(path.join(OUT, f));
  const h = new Harness({ outDir: OUT });
  const urlArg = argv.find((a) => a.startsWith('--url='))?.slice(6);
  let server = null;
  let browser = null;
  let fatal = null;
  try {
    let url = urlArg;
    if (!url) {
      const distArg = argv.find((a) => a.startsWith('--dist='))?.slice(7);
      const dist = path.resolve(ROOT, distArg ?? 'dist');
      await ensureBuild({ root: ROOT, distDir: dist, mode: argv.includes('--rebuild') ? 'always' : argv.includes('--no-build') ? 'never' : 'auto', log: console.log });
      server = await startPreview({ root: ROOT, distDir: dist, log: console.log });
      url = server.url;
    }
    browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    await flow({ h, browser, url });
  } catch (e) {
    fatal = e;
    console.error(e);
  } finally {
    await browser?.close().catch(() => {});
    await server?.stop().catch(() => {});
  }
  console.log(`\n${h.table()}`);
  if (h.errors.length) for (const e of h.errors) console.log(`  [${e.step}] ${e.kind}: ${e.text.split('\n')[0].slice(0, 300)}`);
  h.writeReport({ meta: {}, fatal: fatal ? String(fatal.stack || fatal) : null });
  process.exit(!fatal && h.ok ? 0 : 1);
}

main();
