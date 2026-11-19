/**
 * UI-SHELL screenshot runner (dev only). Requires the harness server:
 *   npx vite --config dev/ui-shell.vite.config.ts &
 *   node dev/ui-shell.shots.cjs [filter[,filter…]] [--sizes=1600x900,1280x720] [--out=subdir] [--set=base|stress|all] [--jobs=2]
 * Writes dev/out/ui-shell/[subdir/]<name>@<w>x<h>.png and prints any console errors per shot.
 * Shots with their own `sizes` (narrow viewports) ignore --sizes.
 */
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const BASE = process.env.UI_SHELL_URL || 'http://localhost:5177/dev/ui-shell.html';
const args = process.argv.slice(2);
const opt = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
// Name filter: one or more comma-separated substrings (e.g. "caz,stress-saves").
const filters = (args.find((a) => !a.startsWith('--')) || '').split(',').filter(Boolean);
const SIZES = opt('sizes', '1600x900,1280x720')
  .split(',')
  .map((s) => s.split('x').map(Number));
const OUT = path.resolve(__dirname, 'out/ui-shell', opt('out', ''));
const SET = opt('set', 'all');
fs.mkdirSync(OUT, { recursive: true });

const tab = (name) => async (page) => {
  await page.getByRole('tab', { name: new RegExp('^' + name) }).first().click();
  await page.waitForTimeout(700);
};
const click = (selector) => async (page) => {
  await page.locator(selector).first().click();
  await page.waitForTimeout(600);
};
const hover = (selector) => async (page) => {
  await page.locator(selector).first().hover();
  await page.waitForTimeout(700);
};
const press = (key, times = 1) => async (page) => {
  for (let i = 0; i < times; i++) await page.keyboard.press(key);
  await page.waitForTimeout(400);
};
const focusTab = (times) => press('Tab', times);
const scrollTo = (selector) => async (page) => {
  await page.locator(selector).first().evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.waitForTimeout(400);
};

const NARROW = [[1024, 640]];

const BASE_SHOTS = [
  { name: 'loading', q: 'screen=boot&loading=0.62&freeze=1' },
  { name: 'menu', q: 'screen=menu' },
  { name: 'menu-nosaves-web', q: 'screen=menu&saves=none&quit=0' },
  { name: 'menu-hover', q: 'screen=menu', act: [hover('.sh-menu__item >> nth=1')] },
  { name: 'newgame', q: 'screen=newGame' },
  { name: 'newgame-empty-grim', q: 'screen=newGame', act: [click('.sh-lot >> nth=1'), click('[role="radio"]:has-text("Grim")')] },
  { name: 'caz-identity', q: 'screen=caz&freeze=1' },
  { name: 'caz-body', q: 'screen=caz&freeze=1', act: [tab('Body')] },
  { name: 'caz-hair', q: 'screen=caz&freeze=1', act: [tab('Hair')] },
  { name: 'caz-outfit', q: 'screen=caz&freeze=1', act: [tab('Outfit')] },
  { name: 'caz-personality', q: 'screen=caz&freeze=1', act: [tab('Personality')] },
  { name: 'caz-personality-conflict', q: 'screen=caz&freeze=1&caz=errors', act: [tab('Personality'), hover('.sh-trait.is-blocked')] },
  { name: 'caz-voice', q: 'screen=caz&freeze=1', act: [tab('Voice')] },
  { name: 'caz-full-errors', q: 'screen=caz&freeze=1&caz=errors', act: [hover('.sh-status--warn')] },
  { name: 'caz-start-refused', q: 'screen=caz&freeze=1&caz=errors', act: [click('.sh-editor__start')] },
  { name: 'caz-four', q: 'screen=caz&freeze=1&caz=full' },
  { name: 'caz-remove-confirm', q: 'screen=caz&freeze=1', act: [hover('.sh-member >> nth=1'), click('.sh-member__remove >> nth=1')] },
  { name: 'game', q: 'screen=game' },
  { name: 'pause', q: 'screen=game&dialog=pause' },
  { name: 'settings-graphics', q: 'screen=game&dialog=settings' },
  { name: 'settings-audio', q: 'screen=game&dialog=settings', act: [tab('Audio')] },
  { name: 'settings-gameplay', q: 'screen=game&dialog=settings', act: [tab('Gameplay')] },
  { name: 'settings-controls', q: 'screen=game&dialog=settings', act: [tab('Controls')] },
  { name: 'settings-accessibility', q: 'screen=game&dialog=settings', act: [tab('Accessibility')] },
  { name: 'settings-accessibility-cb', q: 'screen=game&dialog=settings&cb=1', act: [tab('Accessibility')] },
  { name: 'settings-select-open', q: 'screen=game&dialog=settings', act: [click('.ui-select')] },
  { name: 'settings-reset-confirm', q: 'screen=menu&dialog=settings', act: [click('button:has-text("Reset to defaults")')] },
  { name: 'saves-save', q: 'screen=game&dialog=saveLoad' },
  { name: 'saves-load-ingame', q: 'screen=game&dialog=saveLoad&saves=recovered', act: [tab('Load')] },
  { name: 'saves-load-menu', q: 'screen=menu&dialog=saveLoad' },
  { name: 'saves-empty', q: 'screen=menu&dialog=saveLoad&saves=none' },
  { name: 'saves-delete-confirm', q: 'screen=menu&dialog=saveLoad', act: [click('.sh-slot >> nth=1 >> button[aria-label="Delete"]')] },
  { name: 'help-guide', q: 'screen=game&dialog=help' },
  { name: 'help-keys', q: 'screen=game&dialog=help', act: [tab('Controls')] },
  { name: 'quit-ingame', q: 'screen=game&dialog=confirmQuit' },
  { name: 'quit-menu', q: 'screen=menu&dialog=confirmQuit' },
  { name: 'credits', q: 'screen=menu&dialog=credits' },
  { name: 'diagnostics', q: 'screen=game&dialog=diagnostics' },
  { name: 'gameover', q: 'screen=gameOver' },
  { name: 'fatal', q: 'screen=game&fatal=' + encodeURIComponent('Renderer lost the WebGL context and could not restore it.') },
  { name: 'crash-boundary', q: 'screen=game&crash=1' },
  { name: 'menu-scale140', q: 'screen=menu&scale=1.4' },
  { name: 'settings-scale80', q: 'screen=game&dialog=settings&scale=0.8' },
  { name: 'tooltip', q: 'screen=game&dialog=pause', act: [hover('.ui-modal__close')] },
  { name: 'focus-ring', q: 'screen=newGame', act: [focusTab(2)] },
  { name: 'gallery-icons', q: 'view=icons', full: true },
  { name: 'gallery-components', q: 'view=components', full: true },
  { name: 'gallery-portraits', q: 'view=portraits', full: true },
];

const STRESS_SHOTS = [
  // Longest names, $9,999,999, 8 members, day 9,999, 22 saves.
  { name: 'stress-loading', q: 'screen=boot&stress=1&freeze=1' },
  { name: 'stress-menu', q: 'screen=menu&stress=1' },
  { name: 'stress-caz-identity', q: 'screen=caz&stress=1&freeze=1' },
  { name: 'stress-caz-personality', q: 'screen=caz&stress=1&freeze=1', act: [tab('Personality')] },
  { name: 'stress-caz-outfit', q: 'screen=caz&stress=1&freeze=1', act: [tab('Outfit')] },
  { name: 'stress-saves-menu', q: 'screen=menu&dialog=saveLoad&stress=1' },
  { name: 'stress-saves-menu-end', q: 'screen=menu&dialog=saveLoad&stress=1', act: [scrollTo('.sh-saves__list')] },
  { name: 'stress-saves-ingame', q: 'screen=game&dialog=saveLoad&stress=1' },
  { name: 'stress-pause', q: 'screen=game&dialog=pause&stress=1' },
  { name: 'stress-quit', q: 'screen=game&dialog=confirmQuit&stress=1' },
  { name: 'stress-gameover', q: 'screen=gameOver&stress=1' },
  // UI scale extremes.
  { name: 'scale140-newgame', q: 'screen=newGame&scale=1.4' },
  { name: 'scale140-caz', q: 'screen=caz&scale=1.4&freeze=1' },
  { name: 'scale140-caz-personality', q: 'screen=caz&scale=1.4&freeze=1', act: [tab('Personality')] },
  { name: 'scale140-settings-audio', q: 'screen=game&dialog=settings&scale=1.4', act: [tab('Audio')] },
  { name: 'scale140-saves', q: 'screen=menu&dialog=saveLoad&scale=1.4&stress=1' },
  { name: 'scale140-gameover', q: 'screen=gameOver&scale=1.4&stress=1' },
  { name: 'scale140-pause', q: 'screen=game&dialog=pause&scale=1.4' },
  { name: 'scale140-settings-access', q: 'screen=game&dialog=settings&scale=1.4', act: [tab('Accessibility')] },
  { name: 'pause-save-failed', q: 'screen=game&dialog=pause&lastSave=' + encodeURIComponent('Save failed') },
  { name: 'quit-never-saved', q: 'screen=game&dialog=confirmQuit&lastSave=' },
  { name: 'crash-overlay', q: 'screen=game&crash=overlay', act: [async (page) => page.waitForTimeout(800)] },
  { name: 'scale80-menu', q: 'screen=menu&scale=0.8' },
  { name: 'scale80-caz', q: 'screen=caz&scale=0.8&freeze=1' },
  // Accessibility modes.
  { name: 'cb-components', q: 'view=components&cb=1', full: true },
  { name: 'lowfx-caz', q: 'screen=caz&quality=low&freeze=1' },
  { name: 'toasts-menu', q: 'screen=menu&toasts=1' },
  // Keyboard-only focus order.
  { name: 'focus-menu', q: 'screen=menu', act: [press('ArrowDown'), press('ArrowDown')] },
  { name: 'focus-caz', q: 'screen=caz&freeze=1', act: [focusTab(4)] },
  { name: 'focus-caz-tabs', q: 'screen=caz&freeze=1', act: [click('#caz-tab-identity'), press('ArrowDown', 4)] },
  { name: 'focus-settings', q: 'screen=game&dialog=settings', act: [focusTab(3)] },
  { name: 'focus-saves', q: 'screen=menu&dialog=saveLoad', act: [focusTab(3)] },
  // Narrow viewport.
  { name: 'narrow-menu', q: 'screen=menu&stress=1', sizes: NARROW },
  { name: 'narrow-newgame', q: 'screen=newGame', sizes: NARROW },
  { name: 'narrow-caz', q: 'screen=caz&stress=1&freeze=1', sizes: NARROW },
  { name: 'narrow-caz-personality', q: 'screen=caz&freeze=1', act: [tab('Personality')], sizes: NARROW },
  { name: 'narrow-settings', q: 'screen=game&dialog=settings', act: [tab('Audio')], sizes: NARROW },
  { name: 'narrow-saves', q: 'screen=game&dialog=saveLoad&stress=1', sizes: NARROW },
  { name: 'narrow-gameover', q: 'screen=gameOver&stress=1', sizes: NARROW },
  { name: 'narrow-help', q: 'screen=game&dialog=help', sizes: NARROW },
];

const SHOTS = SET === 'base' ? BASE_SHOTS : SET === 'stress' ? STRESS_SHOTS : [...BASE_SHOTS, ...STRESS_SHOTS];

async function capture(browser, shot, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(`${BASE}?${shot.q}`, { waitUntil: 'networkidle', timeout: 90000 });
  } catch (e) {
    errors.push('goto: ' + e.message.split('\n')[0]);
  }
  await page.waitForSelector(shot.q.startsWith('view=') ? '.dev-root' : '.ui-root', { timeout: 15000 }).catch(() => errors.push('ui root never rendered'));
  // Under CPU load headless frames can lag CSS transitions; capture end states (keyframe animations still play).
  await page.addStyleTag({ content: '*, *::before, *::after { transition-duration: 0s !important; transition-delay: 0s !important; }' });
  await page.waitForTimeout(1800);
  for (const a of shot.act || []) {
    try {
      await a(page);
    } catch (e) {
      errors.push('action failed: ' + e.message.split('\n')[0]);
    }
  }
  const file = path.join(OUT, `${shot.name}@${w}x${h}.png`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.screenshot({ path: file, fullPage: !!shot.full, timeout: 90000 });
      break;
    } catch (e) {
      if (attempt === 1) errors.push('screenshot: ' + e.message.split('\n')[0]);
    }
  }
  await ctx.close();
  const expectError = shot.name.startsWith('crash-');
  return errors.filter((e) => !(expectError && /simulated (render )?crash|fatal render error/.test(e)));
}

(async () => {
  const browser = await chromium.launch();
  let failures = 0;
  {
    // Warm-up: let Vite finish dependency optimisation (it reloads the page once on first visit).
    const warm = await browser.newPage();
    await warm.goto(`${BASE}?screen=caz`, { waitUntil: 'networkidle' });
    await warm.waitForTimeout(2500);
    await warm.close();
  }
  const jobs = [];
  for (const shot of SHOTS) {
    if (filters.length && !filters.some((f) => shot.name.includes(f))) continue;
    for (const [w, h] of shot.sizes || SIZES) jobs.push({ shot, w, h });
  }
  const CONCURRENCY = Number(opt('jobs', '2'));
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { shot, w, h } = jobs[next++];
      const real = await capture(browser, shot, w, h);
      if (real.length) {
        failures++;
        console.log(`✗ ${shot.name}@${w}x${h}\n   ${real.join('\n   ')}`);
      } else console.log(`✓ ${shot.name}@${w}x${h}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));
  await browser.close();
  console.log(`${jobs.length - failures}/${jobs.length} shots clean → ${OUT}`);
  if (failures) process.exitCode = 1;
})();
