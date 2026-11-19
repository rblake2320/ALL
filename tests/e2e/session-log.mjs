/**
 * W-117 playtest session log — real-browser check (docs/systems/session-log.md §7):
 *
 *   node tests/e2e/session-log.mjs [--no-build] [--url=http://127.0.0.1:4173/] [--out=dev/out/w117]
 *
 *  1. Fresh profile, age gate answered as an adult, New Game on the default derelict lot with planted household and
 *     member names; skip the story card.
 *  2. Two player actions: queue "check the mail" on the mailbox (Act 1 step 1) and buy a fridge; plus one click on
 *     the ground with nobody selected (a non-productive click).
 *  3. Pause → "Copy session log" → the dialog shows the summary → Copy. The clipboard (permissions granted) holds the
 *     header, the Act 1 funnel lines (act1_claim.mail done, act1_rest.sleep reached), time to first action, the
 *     player purchase and the non-productive click — and none of the planted names.
 * Exit 1 on any failed check. Screenshot: <out>/session-log-dialog.png.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureBuild, startPreview } from './lib/server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const a = argv.find((x) => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : d;
};
const OUT = path.resolve(ROOT, opt('out', path.join('dev', 'out', 'w117')));
mkdirSync(OUT, { recursive: true });

const NAMES = ['Bartholomew', 'Quackenbush', 'Zeldarine', 'Grimsbottom'];

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail).slice(0, 600)}`}`);
};

async function until(page, fn, arg, timeout = 120_000) {
  await page.waitForFunction(fn, arg, { polling: 250, timeout });
}

async function main() {
  let url = opt('url', '');
  let server = null;
  const log = (s) => console.log(s);
  if (!url) {
    await ensureBuild({ root: ROOT, distDir: path.join(ROOT, 'dist'), mode: argv.includes('--no-build') ? 'never' : 'auto', log });
    server = await startPreview({ root: ROOT, distDir: path.join(ROOT, 'dist'), log });
    url = server.url;
  }
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await until(page, () => window.__afterlife?.game?.screen === 'menu', undefined, 300_000);
    const gate = page.locator('.st-age-dialog .st-age__input');
    if (await gate.isVisible().catch(() => false)) {
      await gate.fill(String(new Date().getFullYear() - 30));
      await page.locator('[data-testid="age-continue"]').click({ force: true });
      await until(page, () => !document.querySelector('.st-age-dialog'));
    }
    check('session log ON by default for an adult profile', await page.evaluate(() => window.__afterlife.game.sessionLog?.enabled === true));
    await page.locator('.sh-menu__item', { hasText: 'New Game' }).first().click({ force: true });
    await until(page, () => window.__afterlife.game.screen === 'newGame' && document.querySelectorAll('.sh-lots [role="radio"]').length === 3);
    await page.getByRole('button', { name: 'Create your household' }).click({ force: true });
    await until(page, () => window.__afterlife.game.screen === 'caz' && !!window.__afterlife.game.caz);
    await page.evaluate((names) => {
      const g = window.__afterlife.game;
      if (g.caz.members.length < 2) g.addCazMember();
      g.updateCaz({ householdName: `${names[2]} ${names[3]}` });
      g.updateCazMember(0, { firstName: names[0], lastName: names[1] });
      g.updateCazMember(1, { firstName: names[2], lastName: names[3] });
    }, NAMES);
    check('CAZ: derelict lot, planted names', (await page.evaluate(() => [window.__afterlife.game.caz.lotTemplate, window.__afterlife.game.caz.members[0].firstName])).join() === 'derelict,Bartholomew');
    await until(page, () => window.__afterlife.game.validateCaz().length === 0, undefined, 60_000);
    await page.locator('.sh-editor__start').click({ force: true });
    await until(page, () => window.__afterlife.game.screen === 'game', undefined, 300_000);
    await until(page, () => window.__afterlife.game.renderer.loadProgress() >= 1 && !!document.querySelector('.hud-funds'), undefined, 300_000);
    const skip = page.locator('.hud-hint-bubble button', { hasText: 'Let’s go' });
    if (await skip.isVisible().catch(() => false)) await skip.click({ force: true });
    await page.waitForTimeout(1000);

    // a click on the world with nobody selected: nothing can happen (non-productive)
    await page.evaluate(() => window.__afterlife.game.selectAgent(null));
    await page.mouse.click(640, 600);
    await page.waitForTimeout(300);
    // action 1: check the mail (Act 1 step 1); action 2: buy a fridge
    const acted = await page.evaluate(() => {
      const g = window.__afterlife.game;
      const ids = g.sim.state.household.memberIds;
      g.selectAgent(ids[0]);
      const mb = Object.values(g.sim.state.objects).find((o) => o.defId === 'mailbox_crooked');
      g.openMenuFor({ kind: 'object', id: mb.id }, 400, 300);
      const e = g.menu && g.menu.entries.find((x) => x.interactionId === 'home_checkMail');
      if (e) g.chooseMenuEntry(e);
      g.setMode('buy');
      let bought = false;
      for (let z = 13; z < 19 && !bought; z++) for (let x = 11; x < 16 && !bought; x++) bought = g.applyBuild({ type: 'buy', defId: 'fridge_humming', x, z, rot: 0 });
      g.setMode('live');
      g.setSpeed(3);
      return { queued: !!e, bought };
    });
    check('two player actions issued (queue check mail, buy fridge)', acted.queued && acted.bought, acted);
    await until(page, () => (window.__afterlife.game.sim.state.quests.completions.act1_claim ?? 0) > 0, undefined, 120_000);
    check('Act 1 beat 1 completed in the real game', true);
    await page.waitForTimeout(1500);

    await page.evaluate(() => window.__afterlife.game.openDialog('pause'));
    await page.locator('.sh-pause__item', { hasText: 'Copy session log' }).click({ force: true });
    await page.locator('[data-testid="session-log-text"]').waitFor({ timeout: 30_000 });
    const shown = await page.locator('[data-testid="session-log-text"]').inputValue();
    check('dialog shows the summary', shown.startsWith('AFTERLIFE LEASE — PLAYTEST SESSION LOG'), shown.slice(0, 200));
    check('Save file offered on a top-level page (13+)', await page.locator('[data-testid="session-log-save"]').isVisible());
    await page.waitForTimeout(800); // modal rise-in
    await page.screenshot({ path: path.join(OUT, 'session-log-dialog.png') });
    await page.locator('[data-testid="session-log-copy"]').click({ force: true });
    await until(page, () => /Copied/.test(document.querySelector('[data-testid="session-log-status"]')?.textContent || ''), undefined, 15_000);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    check('clipboard: header', /^AFTERLIFE LEASE — PLAYTEST SESSION LOG\nsession S-[0-9A-Z]{8} · \d{4}-\d{2}-\d{2} · build \S+ · v/.test(clip), clip.slice(0, 300));
    check('clipboard: platform + world line', clip.includes('platform: desktop · landscape · 1280x720') && clip.includes('world: new · lot derelict'), clip.slice(0, 600));
    check('clipboard: Act 1 step lines (claim done, rest reached)', /\n\s+1\s+act1_claim\.mail\s+\d+:\d{2}\s+\d+:\d{2}\s+\d+:\d{2}\s+D1 /.test(clip) && /\n\s+2\s+act1_rest\.sleep\s/.test(clip), clip.split('ACT 1 FUNNEL')[1]?.slice(0, 600));
    check('clipboard: time to first action = the mail', /time to first action: \d+:\d{2} \(\d+ ms\) — queue:home_checkMail/.test(clip));
    check('clipboard: the player purchase', /player \(Buy\/Build\): 1 · \$\d/.test(clip) && clip.includes('fridge_humming'));
    check('clipboard: the non-productive click', /non-productive clicks: [1-9]/.test(clip), clip.match(/non-productive clicks:.*/)?.[0]);
    const leaked = NAMES.filter((n) => clip.toLowerCase().includes(n.toLowerCase()));
    check('clipboard: no household / member names', leaked.length === 0, leaked);
    await page.screenshot({ path: path.join(OUT, 'session-log-copied.png') });
    console.log('\n----- clipboard (head) -----\n' + clip.split('\nRAW EVENTS')[0] + '\n----- raw (first 25 lines) -----\n' + (clip.split('\nRAW EVENTS')[1] || '').split('\n').slice(0, 26).join('\n'));
    await ctx.close();
  } finally {
    await browser.close().catch(() => {});
    await server?.stop().catch(() => {});
  }
  for (const e of errors) check('no page errors', false, e);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${failed ? 'SESSION LOG E2E FAILED' : 'SESSION LOG E2E PASSED'}: ${results.length - failed}/${results.length} checks — screenshots in ${path.relative(ROOT, OUT)}`);
  return failed ? 1 : 0;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  },
);
