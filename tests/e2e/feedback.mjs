/**
 * W-110 acceptance §5.3 in a real browser (production build, headless Chromium + SwiftShader), same harness and
 * pass/fail rules as tests/e2e/a11y.mjs (any console error / page error / failed request fails the run):
 *
 *   F1  F8 in game (the first-run age gate left unanswered → fails closed to under-13): the game pauses, the dialog
 *       shows chips ONLY (no text box, no "attach my save"), a screenshot ≤ 1280 px is attached; completed with the
 *       keyboard alone (Space on a chip, Tab to "Save report", Enter); the FB id is shown and focused; the outbox
 *       entry is under-13 / presets-only / no save, with diagnostics.
 *   F2  answer the age gate as an adult in the Store, then pause menu → "Report a bug / feedback": free text +
 *       screenshot, planted e-mail scrubbed, FB id shown; the outbox entry has the screenshot and diagnostics.
 *   F3  "Export report file" downloads <id>.alreport; it parses, verifies, and `feedback:ingest` files it.
 *   F4  Done returns to the pause menu; the outbox survives a page reload.
 *   F5  Settings → Help → "Report a bug" on the main menu opens the dialog; Escape returns to Settings.
 *
 *   node tests/e2e/feedback.mjs [--rebuild | --no-build] [--dist=<dir>] [--url=<http://…/>] [--out=<dir>] [--headed]
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness } from './lib/harness.mjs';
import { ensureBuild, startPreview } from './lib/server.mjs';
import * as P from './lib/inpage.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POLL = { polling: 100 };
const ID_RE = /^FB-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;

function parseArgs(argv) {
  const flag = (n) => argv.includes(`--${n}`);
  const opt = (n, d) => {
    const a = argv.find((x) => x.startsWith(`--${n}=`));
    return a ? a.slice(n.length + 3) : d;
  };
  return {
    build: flag('rebuild') ? 'always' : flag('no-build') ? 'never' : 'auto',
    dist: path.resolve(ROOT, opt('dist', process.env.E2E_DIST || 'dist')),
    url: opt('url', process.env.E2E_URL || ''),
    out: path.resolve(ROOT, opt('out', process.env.E2E_OUT || path.join('dev', 'out', 'e2e-feedback'))),
    headed: flag('headed'),
  };
}

export async function main(argv = process.argv.slice(2)) {
  const { chromium } = require('playwright');
  const args = parseArgs(argv);
  mkdirSync(args.out, { recursive: true });
  for (const f of readdirSync(args.out)) if (/\.(png|json|alreport)$/.test(f)) rmSync(path.join(args.out, f));
  rmSync(path.join(args.out, 'inbox'), { recursive: true, force: true });
  const h = new Harness({ outDir: args.out });
  let server = null;
  let browser = null;
  let fatal = null;
  const t0 = Date.now();
  try {
    let url = args.url;
    if (!url) {
      await ensureBuild({ root: ROOT, distDir: args.dist, mode: args.build, log: (s) => console.log(s) });
      server = await startPreview({ root: ROOT, distDir: args.dist, log: (s) => console.log(s) });
      url = server.url;
    }
    browser = await chromium.launch({ headless: !args.headed, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    await flow({ h, browser, url, out: args.out });
  } catch (e) {
    fatal = e;
    console.error(`\nFEEDBACK E2E ABORTED: ${e && e.stack ? e.stack : e}`);
  } finally {
    await browser?.close().catch(() => {});
    await server?.stop().catch(() => {});
  }
  console.log(`\n${'='.repeat(100)}\n${h.table()}`);
  if (h.errors.length) {
    console.log('\nconsole / page errors:');
    for (const e of h.errors) console.log(`  [${e.step}] ${e.kind}: ${e.text.split('\n')[0].slice(0, 300)}`);
  }
  if (h.warnings.size) {
    console.log('\nconsole warnings:');
    for (const [text, n] of h.warnings.entries()) console.log(`  ×${n} ${text}`);
  }
  const ok = !fatal && h.ok;
  h.writeReport({ meta: { totalMs: Date.now() - t0 }, fatal: fatal ? String(fatal.stack || fatal) : null });
  console.log(`\n${ok ? 'FEEDBACK E2E PASSED' : 'FEEDBACK E2E FAILED'} in ${((Date.now() - t0) / 1000).toFixed(1)} s — ${path.relative(ROOT, args.out) || args.out}`);
  return ok ? 0 : 1;
}

async function flow({ h, browser, url, out }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
  await context.addInitScript(P.initScript);
  const page = await context.newPage();
  page.setDefaultTimeout(180_000);
  h.watch(page);
  const G = (fn, arg) => page.evaluate(fn, arg);
  const until = async (what, fn, arg, timeout = 60_000) => {
    try {
      await page.waitForFunction(fn, arg, { ...POLL, timeout });
    } catch {
      const focus = await G(() => (document.activeElement ? `${document.activeElement.tagName}#${document.activeElement.id}.${document.activeElement.className}` : null)).catch(() => null);
      throw new Error(`timed out (${timeout} ms) waiting for ${what}; focus=${focus}`);
    }
  };
  const untilScreen = (sc, timeout = 240_000) => until(`screen=${sc}`, (s) => window.__afterlife?.game?.screen === s, sc, timeout);
  /** Same as a11y.mjs: wait until the element is the hit target (no entrance animation / overlay), then click. */
  const tap = async (loc, timeout = 120_000) => {
    const el = loc.first();
    await el.waitFor({ state: 'visible', timeout });
    const handle = await el.elementHandle({ timeout });
    await page
      .waitForFunction(
        (e) => {
          if (!e.isConnected || e.disabled) return false;
          const r = e.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!hit && (e === hit || e.contains(hit));
        },
        handle,
        { ...POLL, timeout },
      )
      .catch(() => {});
    try {
      await el.click({ force: true, timeout });
    } catch (e) {
      // SwiftShader on a loaded CI box can starve the page's main thread past Playwright's input timeout: fall back
      // to a DOM click on the same element (still the button's own handler) and say so in the log.
      h.log(`    (pointer click timed out — DOM click fallback: ${String(e.message).split('\n')[0].slice(0, 80)})`);
      await handle.evaluate((b) => b.click());
    }
    await handle.dispose();
  };
  const step = (name, fn, opts) =>
    h.step(
      name,
      async () => {
        await fn();
        const rej = await G(() => (window.__e2e ? window.__e2e.rejections.splice(0) : [])).catch(() => []);
        for (const r of rej) h.recordError('unhandledrejection', r);
      },
      { ...opts, onFail: async () => h.shot(page, `FAIL-${name}`) },
    );
  const outboxEntry = (id) => G(async (x) => {
    const fb = window.__afterlife.game.feedback;
    const list = await fb.outbox();
    const r = await fb.report(x);
    return { ids: list.map((e) => e.id), entry: list.find((e) => e.id === x) ?? null, report: r ? { ...r, screenshot: r.screenshot ? { ...r.screenshot, data: r.screenshot.data.length } : null } : null };
  }, id);
  const dismissHints = async () => {
    for (let i = 0; i < 6; i++) {
      const hid = await G(() => window.__afterlife.game.hint?.id ?? null);
      if (!hid) break;
      await G((x) => window.__afterlife.game.dismissHint(x, true), hid); // tutorial tips are not under test here
      await page.waitForTimeout(200);
    }
  };
  /** Tab (keyboard only) until the element matching `sel` has focus. */
  const tabTo = async (sel, max = 40) => {
    for (let i = 0; i < max; i++) {
      if (await G((s) => !!document.activeElement?.matches?.(s), sel)) return true;
      await page.keyboard.press('Tab');
    }
    return G((s) => !!document.activeElement?.matches?.(s), sel);
  };
  const ids = {};

  await step('boot; leave the first-run age gate unanswered', async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await untilScreen('menu', 300_000);
    await until('age gate shown', () => !!document.querySelector('.st-age-dialog .st-age__input'));
    await page.keyboard.press('Escape');
    await until('gate closed', () => !document.querySelector('.st-age-dialog'));
    h.check('bracket is unanswered (unknown → treated as under-13)', (await G(() => window.__afterlife.game.economy?.age?.bracket ?? 'unknown')) === 'unknown');
    h.check('the feedback service exists', await G(() => !!window.__afterlife.game.feedback));
  });

  await step('enter game', async () => {
    await tap(page.locator('.sh-menu__item', { hasText: 'New Game' }));
    await untilScreen('newGame', 60_000);
    await page.locator('.sh-lots [role="radio"]').first().waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {}); if (await page.locator('.sh-lots [role="radio"][data-lot="starter"]').count()) await tap(page.locator('.sh-lots [role="radio"][data-lot="starter"]')); // W-113: the shack is now the default; this suite needs the furnished 'starter' lot
    await tap(page.getByRole('button', { name: 'Create your household' }));
    await untilScreen('caz', 60_000);
    await until('caz valid', () => window.__afterlife.game.validateCaz().length === 0, undefined, 30_000);
    await tap(page.locator('.sh-editor__start'));
    await untilScreen('game', 300_000);
    await until('HUD', () => window.__afterlife.game.renderer.loadProgress() >= 1 && !!document.querySelector('.hud-funds'), undefined, 180_000);
    await dismissHints();
  }, { needs: ['boot; leave the first-run age gate unanswered'] });

  await step('F1: F8 → under-13 chips-only report, keyboard only, FB id + outbox entry', async () => {
    await G(() => {
      window.__afterlife.game.setSpeed(1);
      document.activeElement?.blur?.();
    });
    await until('running', () => window.__afterlife.game.speed > 0);
    await page.keyboard.press('F8');
    await until('feedback dialog open', () => window.__afterlife.game.dialog === 'feedback' && !!document.querySelector('.fb-dialog [data-testid="feedback-form"]'));
    const ui = await G(() => {
      const form = document.querySelector('[data-testid="feedback-form"]');
      const img = document.querySelector('[data-testid="feedback-shot"]');
      return {
        bracket: form?.getAttribute('data-bracket'),
        textarea: !!document.querySelector('.fb-dialog textarea, .fb-dialog [data-testid="feedback-text"]'),
        saveToggle: !!document.querySelector('.fb-dialog #fb-save'),
        chips: document.querySelectorAll('.fb-dialog .fb-chip').length,
        shot: img ? { w: img.naturalWidth, h: img.naturalHeight, len: img.getAttribute('src').length, src: img.getAttribute('src').slice(0, 23) } : null,
        speed: window.__afterlife.game.speed,
        draft: window.__afterlife.game.feedback.draft && { source: window.__afterlife.game.feedback.draft.source, area: window.__afterlife.game.feedback.draft.area },
        focus: document.activeElement?.getAttribute('data-preset'),
        modal: document.querySelector('.fb-dialog')?.getAttribute('aria-modal'),
        labelled: !!document.getElementById(document.querySelector('.fb-dialog')?.getAttribute('aria-labelledby') ?? '-')?.textContent,
      };
    });
    h.log(`    dialog: ${JSON.stringify(ui)}`);
    h.check('opened by the hotkey, area auto-filled from the mode', ui.draft?.source === 'hotkey' && ui.draft?.area === 'live', ui.draft);
    h.check('the game is paused behind the dialog', ui.speed === 0, ui.speed);
    h.check('under-13 (fails closed): chips only — no text box', ui.bracket === 'under13' && !ui.textarea, ui);
    h.check('under-13: no "attach my save"', !ui.saveToggle);
    h.check('8 preset chips', ui.chips === 8, ui.chips);
    h.check('screenshot attached: JPEG ≤ 1280 px and ≤ 300 KB', !!ui.shot && ui.shot.src === 'data:image/jpeg;base64,' && ui.shot.w > 0 && ui.shot.w <= 1280 && ui.shot.h <= 1280 && ui.shot.len * 0.75 <= 300 * 1024, ui.shot);
    h.check('dialog is modal and labelled; focus starts on the first chip', ui.modal === 'true' && ui.labelled && ui.focus === 'cantPlace', ui);
    await h.shot(page, 'F1-under13-dialog');
    // keyboard only: Space toggles the focused chip, Tab to "Save report", Enter sends
    await page.keyboard.press('Space');
    h.check('Space toggles the chip (aria-pressed)', (await G(() => document.querySelector('.fb-chip[data-preset="cantPlace"]')?.getAttribute('aria-pressed'))) === 'true');
    h.check('Tab reaches "Save report"', await tabTo('[data-testid="feedback-send"]'));
    await page.keyboard.press('Enter');
    await until('thanks + id', () => !!document.querySelector('[data-testid="feedback-id"]'), undefined, 30_000);
    const done = await G(() => ({ id: document.querySelector('[data-testid="feedback-id"]').textContent, title: document.querySelector('[data-testid="feedback-thanks"]').textContent, focused: document.activeElement === document.querySelector('[data-testid="feedback-thanks"]'), live: document.querySelector('.fb-done')?.getAttribute('aria-live') }));
    ids.kid = done.id;
    h.check('the FB id is shown ("Thanks! Your report is FB-…")', ID_RE.test(done.id) && done.title.includes(done.id), done);
    h.check('the result takes focus and sits in a live region', done.focused && done.live === 'polite', done);
    const o = await outboxEntry(done.id);
    h.log(`    outbox: ${JSON.stringify({ ids: o.ids, entry: o.entry, bracket: o.report?.bracket, presets: o.report?.presets, text: o.report?.text, save: o.report?.save, events: o.report?.diagnostics.events.length })}`);
    h.check('outbox entry present', o.ids.includes(done.id) && !!o.report);
    h.check('stored as under-13: presets only, no text, no save', o.report?.bracket === 'under13' && o.report.text === '' && o.report.save === null && o.report.presets.join() === 'cantPlace', o.report && { b: o.report.bracket, t: o.report.text, p: o.report.presets });
    h.check('diagnostics attached (events, version, graphics, fps)', o.report?.diagnostics.events.length > 0 && /diagnostics/.test(o.report.diagnostics.text) && !!o.report.game.version && !!o.report.diagnostics.graphics.quality, o.report?.diagnostics.events.slice(-5));
    h.check('screenshot stored', !!o.report?.screenshot && o.report.screenshot.width <= 1280);
    await h.shot(page, 'F1-thanks');
    await page.keyboard.press('Escape');
    await until('dialog closed', () => window.__afterlife.game.dialog === null);
    h.check('the game resumes after closing', (await G(() => window.__afterlife.game.speed)) > 0);
  }, { needs: ['enter game'] });

  await step('F2: adult → pause menu → "Report a bug": free text + screenshot, e-mail scrubbed, FB id', async () => {
    // answer the age gate in the Store (adult), the player-facing way
    await dismissHints();
    await tap(page.locator('[data-testid="hud-store"]'));
    await until('store open', () => window.__afterlife.game.dialog === 'store' && !!document.querySelector('.st-dialog #st-age-year'));
    await page.locator('.st-dialog #st-age-year').fill(String(new Date().getFullYear() - 30));
    await page.keyboard.press('Enter');
    await until('gate answered', () => window.__afterlife.game.economy?.age?.bracket === 'adult');
    await page.keyboard.press('Escape');
    await until('store closed', () => window.__afterlife.game.dialog === null);
    await G(() => document.activeElement?.blur?.());
    await page.keyboard.press('Escape');
    await until('pause menu', () => window.__afterlife.game.dialog === 'pause' && !!document.querySelector('.sh-pause__item'));
    await tap(page.locator('.sh-pause__item', { hasText: 'Report a bug' }));
    await until('feedback dialog', () => window.__afterlife.game.dialog === 'feedback' && !!document.querySelector('[data-testid="feedback-form"]'));
    const ui = await G(() => ({
      bracket: document.querySelector('[data-testid="feedback-form"]')?.getAttribute('data-bracket'),
      textarea: !!document.querySelector('[data-testid="feedback-text"]'),
      label: document.querySelector('label[for="fb-text"]')?.textContent ?? '',
      save: document.querySelector('#fb-save')?.getAttribute('aria-checked'),
      shot: !!document.querySelector('[data-testid="feedback-shot"]'),
      source: window.__afterlife.game.feedback.draft?.source,
      returnTo: window.__afterlife.game.dialogOptions?.returnTo ?? null,
    }));
    h.log(`    dialog: ${JSON.stringify(ui)}`);
    h.check('13+: labelled free-text box', ui.bracket === '13plus' && ui.textarea && ui.label.length > 0, ui);
    h.check('13+: "attach my save" offered and OFF by default', ui.save === 'false', ui.save);
    h.check('screenshot shown', ui.shot);
    h.check('opened from the pause menu (returns there)', ui.source === 'pause' && ui.returnTo === 'pause', ui);
    await page.locator('[data-testid="feedback-text"]').click();
    await page.keyboard.type('Sofa will not place next to the fridge. Contact me at zed.tester@example.com. Pressing B or Space here must not change mode.');
    h.check('typing stays in the text box (no hotkeys fired)', (await G(() => [window.__afterlife.game.mode, window.__afterlife.game.dialog].join())) === 'live,feedback');
    await page.locator('.fb-chip[data-preset="lookedWrong"]').click();
    await h.shot(page, 'F2-adult-dialog');
    await tap(page.locator('[data-testid="feedback-send"]'));
    await until('thanks + id', () => !!document.querySelector('[data-testid="feedback-id"]'), undefined, 30_000);
    const id = await G(() => document.querySelector('[data-testid="feedback-id"]').textContent);
    ids.adult = id;
    h.check('FB id shown', ID_RE.test(id) && id !== ids.kid, id);
    const o = await outboxEntry(id);
    h.log(`    report: ${JSON.stringify({ bracket: o.report?.bracket, text: o.report?.text, shot: o.report?.screenshot, presets: o.report?.presets, source: o.report?.source, errors: o.report?.diagnostics.errors.length })}`);
    h.check('outbox entry with screenshot + diagnostics', o.entry?.hasScreenshot === true && !!o.report?.screenshot && o.report.diagnostics.events.length > 0 && o.report.diagnostics.platform.userAgent.length > 0);
    h.check('free text stored, e-mail scrubbed', /Sofa will not place/.test(o.report?.text ?? '') && o.report.text.includes('[email]') && !o.report.text.includes('example.com'), o.report?.text);
    h.check('no save attached (toggle left off)', o.report?.save === null && o.entry?.hasSave === false);
    h.check('the household name never appears in the report', await G(async (x) => {
      const g = window.__afterlife.game;
      const name = g.sim.state.household.name;
      const r = await g.feedback.report(x);
      return !!name && !JSON.stringify({ ...r, screenshot: null }).includes(name);
    }, id));
  }, { needs: ['enter game'] });

  await step('F3: export → .alreport download; it verifies and feedback:ingest files it', async () => {
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.locator('[data-testid="feedback-export"]').click()]);
    const name = download.suggestedFilename();
    const file = path.join(out, name);
    await download.saveAs(file);
    h.check('file name is afterlife-report-<id>.alreport', name === `afterlife-report-${ids.adult}.alreport`, name);
    await until('export status', () => /exported/i.test(document.querySelector('[data-testid="feedback-export-status"]')?.textContent ?? ''));
    const text = readFileSync(file, 'utf8');
    const json = JSON.parse(text);
    h.check('versioned schema, base64 screenshot, checksum', json.format === 'afterlife-lease-report' && json.v === 1 && json.id === ids.adult && /^[0-9a-f]{64}$/.test(json.sha256) && typeof json.screenshot?.data === 'string' && json.screenshot.data.length > 100, { format: json.format, v: json.v, id: json.id });
    h.check('the outbox marks it exported', !!(await outboxEntry(ids.adult)).entry?.exportedAt);
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'feedback-ingest.mjs'), file, `--out=${path.join(out, 'inbox')}`], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
    h.log(`    ingest exit ${r.status}: ${r.stderr.trim().split('\n').pop()}`);
    h.check('feedback:ingest accepts and files the exported report', r.status === 0 && r.stdout.includes(`Filed ${ids.adult}`), r.stderr.slice(0, 400));
    const rec = JSON.parse(readFileSync(path.join(out, 'inbox', `${ids.adult.toLowerCase()}.json`), 'utf8'));
    h.check('normalised record: dedupe key, screenshot split out', /^[0-9a-f]{16}$/.test(rec.dedupeKey) && rec.attachments.screenshot?.file.endsWith('.jpg'), { key: rec.dedupeKey, shot: rec.attachments.screenshot });
  }, { needs: ['F2: adult → pause menu → "Report a bug": free text + screenshot, e-mail scrubbed, FB id'] });

  await step('F4: Done returns to the pause menu; the outbox survives a reload', async () => {
    await tap(page.locator('[data-testid="feedback-done"]'));
    await until('back to pause', () => window.__afterlife.game.dialog === 'pause');
    h.check('Done → pause menu', true);
    await page.keyboard.press('Escape');
    await until('resumed', () => window.__afterlife.game.dialog === null);
    await G(P.persistenceIdle);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await untilScreen('menu', 300_000);
    const list = await G(async () => (await window.__afterlife.game.feedback.outbox()).map((e) => e.id));
    h.log(`    outbox after reload: ${JSON.stringify(list)}`);
    h.check('both reports are still queued after the reload', list.includes(ids.kid) && list.includes(ids.adult), list);
  }, { needs: ['F1: F8 → under-13 chips-only report, keyboard only, FB id + outbox entry', 'F2: adult → pause menu → "Report a bug": free text + screenshot, e-mail scrubbed, FB id'] });

  await step('F5: main menu → Settings → Help → "Report a bug"; Escape returns to Settings', async () => {
    if ((await G(() => window.__afterlife?.game?.screen)) !== 'menu') {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await untilScreen('menu', 300_000);
    }
    if (await page.locator('.st-age-dialog').count()) await page.keyboard.press('Escape');
    await until('no dialog', () => !document.querySelector('.st-age-dialog'));
    await tap(page.locator('.sh-menu__item', { hasText: 'Settings' }));
    await until('settings', () => window.__afterlife.game.dialog === 'settings');
    await tap(page.getByRole('tab', { name: 'Help' }));
    await tap(page.locator('[data-testid="settings-feedback"]'));
    await until('feedback dialog', () => window.__afterlife.game.dialog === 'feedback' && !!document.querySelector('[data-testid="feedback-form"]'));
    const d = await G(() => window.__afterlife.game.feedback.draft);
    h.check('source settings, area menu', d?.source === 'settings' && d?.area === 'menu', d && { source: d.source, area: d.area });
    await page.keyboard.press('Escape');
    await until('back in settings', () => window.__afterlife.game.dialog === 'settings');
    h.check('Escape closes the report and returns to Settings; the draft is discarded', (await G(() => window.__afterlife.game.feedback.draft)) === null);
    await page.keyboard.press('Escape');
    await until('closed', () => window.__afterlife.game.dialog === null);
  }, { needs: ['boot; leave the first-run age gate unanswered'] });

  await context.close();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code));
}
