/**
 * UI-HUD screenshot runner: node dev/ui-hud.shots.cjs [filter] [--sizes=1600x900,1280x720]
 * Needs the harness served: HUD_HMR=0 npx vite --config dev/ui-hud.vite.config.ts  (http://localhost:5178/dev/ui-hud.html;
 * HUD_HMR=0 keeps edits other modules make in this tree from reloading a page mid-capture)
 * Writes dev/out/ui-hud/<state>@<w>x<h>.png and prints console errors per state.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.HUD_URL || 'http://localhost:5178/dev/ui-hud.html';
const OUT = process.env.HUD_OUT ? path.resolve(process.env.HUD_OUT) : path.join(__dirname, 'out', 'ui-hud');
const args = process.argv.slice(2);
const filter = args.find((a) => !a.startsWith('--')) || '';
const sizesArg = (args.find((a) => a.startsWith('--sizes=')) || '--sizes=1600x900,1280x720').slice(8);
const SIZES = sizesArg.split(',').map((s) => s.split('x').map(Number));

/** name, query, optional actions(page) run before the capture */
const STATES = [
  ['live-needs', 'mode=live&tab=needs&toasts=3'],
  ['live-mood', 'mode=live&tab=mood'],
  ['live-mood-breakdown', 'mode=live&tab=mood', async (p) => { await p.click('text=What adds up'); }],
  ['live-skills', 'mode=live&tab=skills'],
  ['live-career', 'mode=live&tab=career'],
  ['live-career-none', 'mode=live&tab=career&select=a3'],
  ['live-relationships', 'mode=live&tab=relationships'],
  ['live-aspiration', 'mode=live&tab=aspiration'],
  ['live-info', 'mode=live&tab=info'],
  ['live-info-crumbled', 'mode=live&tab=info&select=a4'],
  ['live-atwork', 'mode=live&tab=needs&select=a2'],
  ['live-noselect', 'mode=live&select=none&toasts=2'],
  ['live-collapsed', 'mode=live&collapsed=1'],
  ['menu-social', 'mode=live&menu=social&bubbles=0', async (p) => { await p.hover('[data-key="g:Friendly"]'); await p.waitForTimeout(400); }],
  ['menu-social-romantic', 'mode=live&menu=social&bubbles=0', async (p) => { await p.hover('[data-key="g:Romantic"]'); await p.waitForTimeout(400); await p.hover('.hud-imenu.is-flyout [data-idx="3"]'); await p.waitForTimeout(700); }],
  ['menu-fridge', 'mode=live&menu=fridge&bubbles=0', async (p) => { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(300); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); }],
  ['toasts', 'mode=live&toasts=5&tab=skills'],
  ['funds-change', 'mode=live&bubbles=0', async (p) => { await p.evaluate(() => window.__hud.game.addFunds(-212)); await p.waitForTimeout(120); await p.evaluate(() => window.__hud.game.addFunds(240)); }],
  ['saving', 'mode=live&saving=1&bubbles=0', async (p) => { await p.hover('.hud-save'); await p.waitForTimeout(700); }],
  ['buy-poor', 'mode=buy&cat=beds&funds=420', async (p) => { await p.waitForTimeout(900); await p.hover('.hud-item >> nth=3'); }],
  ['log', 'mode=live&log=1'],
  ['choice', 'mode=live&choice=1&bubbles=0'],
  ['party', 'mode=live&party=1&partyScore=78&tab=relationships'],
  ['party-choice-night', 'mode=live&party=1&partyScore=26&choice=1&night=1'],
  ['fullmoon-paused', 'mode=live&fullmoon=1&speed=0&tab=mood'],
  ['ultra', 'mode=live&ultra=1&speed=4'],
  ['tooltip-speed', 'mode=live', async (p) => { await p.hover('.hud-speed__btn.is-locked'); await p.waitForTimeout(700); }],
  ['tooltip-need', 'mode=live', async (p) => { await p.hover('.hud-needs .hud-need >> nth=2'); await p.waitForTimeout(700); }],
  ['hint-needs', 'mode=live&hint=needs&bubbles=0'],
  ['hint-speed', 'mode=live&hint=speed&bubbles=0'],
  ['fps-scale', 'mode=live&fps=1&scale=1.4&rm=1'],
  ['scale-small-cb', 'mode=live&scale=0.8&cb=1'],
  ['buy', 'mode=buy&cat=seating', async (p) => { await p.waitForTimeout(900); await p.hover('.hud-item >> nth=4'); await p.waitForTimeout(300); }],
  ['buy-placing', 'mode=buy&cat=electronics&placing=tv_seance&tint=%233f5a4a', async (p) => { await p.waitForTimeout(900); await p.mouse.move(720, 330); await p.waitForTimeout(100); }],
  ['buy-search', 'mode=buy&q=coffin', async (p) => { await p.waitForTimeout(900); }],
  ['buy-moving', 'mode=buy&cat=seating&moving=1', async (p) => { await p.waitForTimeout(900); }],
  ['buy-hover-object', 'mode=buy&cat=electronics&hoverobj=1', async (p) => { await p.waitForTimeout(900); }],
  ['buy-shimmer', 'mode=buy&cat=kitchen&thumbs=slow', async (p) => { await p.waitForTimeout(700); }],
  ['build-wall', 'mode=build&tool=wall', async (p) => { await p.mouse.move(760, 360); await p.waitForTimeout(100); }],
  ['build-room', 'mode=build&tool=room'],
  ['build-floor', 'mode=build&tool=floor', async (p) => { await p.mouse.move(700, 380); }],
  ['build-paint', 'mode=build&tool=paintWall&whole=1&label=Can%E2%80%99t%20paint%20outside%20walls', async (p) => { await p.mouse.move(820, 300); }],
  ['build-door', 'mode=build&tool=door', async (p) => { await p.waitForTimeout(900); }],
  ['build-eyedropper', 'mode=build&tool=eyedropper'],
  ['dialog-phone', 'mode=live&dialog=phone'],
  ['dialog-careers', 'mode=live&dialog=careers'],
  ['dialog-invite', 'mode=live&dialog=invite'],
  ['dialog-party', 'mode=live&dialog=invite&invite=party', async (p) => { const c = p.locator('.hud-check:not([disabled])'); await c.nth(0).click(); await c.nth(1).click(); }],
  ['dialog-rewards', 'mode=live&dialog=rewards'],
  ['dialog-household', 'mode=live&dialog=household'],
  ['dialog-household-rename', 'mode=live&dialog=household', async (p) => { await p.click('.hud-hhname .ui-iconbtn'); await p.fill('#hud-rename-input', '   '); await p.keyboard.press('Enter'); }],
  // ── stress / accessibility states (hardening pass) ──
  ['stress-live', 'mode=live&stress=1&toasts=3&tab=needs'],
  ['stress-mood', 'mode=live&stress=1&tab=mood&bubbles=0'],
  ['stress-rels', 'mode=live&stress=1&tab=relationships&bubbles=0'],
  ['stress-scale14', 'mode=live&stress=1&scale=1.4&tab=skills&bubbles=0'],
  ['stress-scale08', 'mode=live&stress=1&scale=0.8&tab=mood&toasts=2&bubbles=0'],
  ['stress-household', 'mode=live&stress=1&dialog=household'],
  ['stress-log', 'mode=live&stress=1&log=1&bubbles=0'],
  ['stress-buy', 'mode=buy&stress=1&cat=kitchen', async (p) => { await p.waitForTimeout(900); }],
  ['scale14-buy', 'mode=buy&cat=kitchen&scale=1.4', async (p) => { await p.waitForTimeout(900); }],
  ['scale14-build', 'mode=build&tool=floor&scale=1.4'],
  ['scale14-careers', 'mode=live&dialog=careers&scale=1.4'],
  ['scale08-menu', 'mode=live&scale=0.8&menu=social&bubbles=0', async (p) => { await p.hover('[data-key="g:Friendly"]'); await p.waitForTimeout(400); }],
  ['cb-needs', 'mode=live&cb=1&tab=needs&bubbles=0'],
  ['rm-live', 'mode=live&rm=1&fps=1&toasts=2'],
  ['savefail', 'mode=live&savefail=1&bubbles=0', async (p) => { await p.hover('.hud-save'); await p.waitForTimeout(700); }],
  ['kbd-focus-needs', 'mode=live&tab=needs&bubbles=0', async (p) => { await p.mouse.click(5, 5); for (let i = 0; i < 22; i++) await p.keyboard.press('Tab'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowDown'); }],
  ['kbd-focus-menu', 'mode=live&menu=social&bubbles=0', async (p) => { await p.waitForTimeout(200); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(250); await p.keyboard.press('ArrowDown'); }],
  ['kbd-focus-build', 'mode=build&tool=paintWall', async (p) => { await p.focus('.hud-tool[aria-checked="true"]'); await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(150); await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); await p.keyboard.press('ArrowRight'); }],
  // ── finishing pass: real-content lengths, keyboard entry, engine moodlet semantics ──
  ['live-mood-long', 'mode=live&tab=mood&select=a3&bubbles=0'],
  ['live-mood-single', 'mode=live&tab=mood&select=a2&bubbles=0'],
  ['live-needs-long', 'mode=live&tab=needs&select=a3&bubbles=0'],
  ['kbd-f6-topbar', 'mode=live&hotkeys=1&bubbles=0', async (p) => { await p.mouse.click(820, 620); await p.keyboard.press('F6'); await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); }],
  ['kbd-f6-agent', 'mode=live&hotkeys=1&bubbles=0&tab=skills', async (p) => { await p.mouse.click(820, 600); for (let i = 0; i < 3; i++) await p.keyboard.press('F6'); for (let i = 0; i < 4; i++) await p.keyboard.press('Tab'); await p.keyboard.press('ArrowRight'); }],
  ['narrow-live', 'mode=live&tab=career&toasts=2', null, { sizes: [[1024, 640]] }],
  ['narrow-buy', 'mode=buy&cat=seating', async (p) => { await p.waitForTimeout(900); }, { sizes: [[1024, 640]] }],
  ['narrow-dialog', 'mode=live&dialog=household', null, { sizes: [[1024, 640]] }],
  ['qhd-live', 'mode=live&tab=mood&party=1&toasts=3', null, { sizes: [[2560, 1440]] }],
  ['qhd-buy', 'mode=buy&cat=seating', async (p) => { await p.waitForTimeout(900); await p.hover('.hud-item >> nth=2'); }, { sizes: [[2560, 1440]] }],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  let failures = 0;
  const runs = [];
  for (const [name, query, act, opts] of STATES) {
    if (filter && !name.includes(filter)) continue;
    for (const [w, h] of opts && opts.sizes ? opts.sizes : SIZES) runs.push([w, h, name, query, act]);
  }
  runs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [w, h, name, query, act] of runs) {
    {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
      await page.goto(`${BASE}?${query}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(450);
      if (act) {
        try { await act(page); } catch (e) { errors.push('ACTION ' + e.message); }
      }
      await page.waitForTimeout(name === 'funds-change' ? 260 : 650);
      const file = path.join(OUT, `${name}@${w}x${h}.png`);
      await page.screenshot({ path: file });
      if (errors.length) { failures++; console.log(`✗ ${name}@${w}x${h}\n   ${errors.join('\n   ')}`); }
      else console.log(`✓ ${name}@${w}x${h}`);
      await page.close();
    }
  }
  await browser.close();
  process.exitCode = failures ? 1 : 0;
})();
