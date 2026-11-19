/**
 * Phone-width HUD layout check (W-114).
 *
 *   node tests/e2e/phone-layout.mjs [--dist=<dir>] [--no-build | --rebuild] [--url=<running server>] [--out=<dir>]
 *                                  [--label=<screenshot prefix>] [--report-only]
 *                                  [--desktop-dump=<file.json>] [--desktop-compare=<file.json>]
 *
 * Builds the production bundle into a private folder (default: <tmp>/al-phone-dist, never dist/), serves it with
 * `vite preview`, and for each phone viewport (390×844 portrait, 844×390 landscape; deviceScaleFactor 1, isMobile,
 * hasTouch) plays the real first-run path: age gate → New Game → the furnished "starter" (Fixer-Upper) lot →
 * Create-a-Zombie (fixed names) → Move in. In the world it asserts, programmatically:
 *   - truncation: none of the listed HUD text elements (needs labels, mood/status pill, portrait name, activity,
 *     queue labels, tip buttons, top-bar labels, quest chip) has scrollWidth > clientWidth (single line) or
 *     scrollHeight > clientHeight (line-clamped), and no visible HUD element styled `text-overflow: ellipsis` is
 *     actually cut;
 *   - the first-run tip's box does not intersect the household portraits or the needs / agent panel;
 *   - every visible button / [role=button] / tab / radio / menuitem / switch in the HUD is ≥ 44×44 CSS px;
 *   - nothing overflows the viewport horizontally (document and every visible HUD element);
 *   - the quest panel is collapsed to a chip and the top bar's secondary tools live behind an overflow menu.
 * A negative control proves the truncation checker catches a deliberately narrowed element.
 *
 * W-118: on the way in, New Game and Create-a-Zombie (every editor tab) are audited on each phone viewport — no text
 * overflows its box, no two interactive elements intersect, the primary action (Create your household / Start the
 * Afterlife) is reachable — and screenshotted. The phone viewports run as iPhone 14 (Playwright device descriptor,
 * deviceScaleFactor 1 for screenshots) at 390×844 / 844×390, plus a 360×640 Android-size portrait.
 *
 * Desktop: at 1280×800 (no touch) it records the geometry of the main HUD regions. --desktop-dump writes it,
 * --desktop-compare fails on any box that moved / resized by more than 1 px versus a dump from another build (run
 * the dump against the base branch, then the compare against this one).
 *
 * Screenshots: <out>/<label>-<viewport>-<state>.png (default out dev/out/phone-layout). Exit 0 = every check passed.
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureBuild, startPreview } from './lib/server.mjs';
import { initScript } from './lib/inpage.mjs';
import { auditShell } from './lib/shellAudit.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const a = argv.find((x) => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : d;
};
const flag = (n) => argv.includes(`--${n}`);
const OUT = path.resolve(ROOT, opt('out', path.join('dev', 'out', 'phone-layout')));
const LABEL = opt('label', 'after');
const REPORT_ONLY = flag('report-only');
const MIN_TARGET = 44;
const PHONES = [
  { name: 'portrait-390x844', width: 390, height: 844 },
  { name: 'landscape-844x390', width: 844, height: 390 },
  { name: 'portrait-360x640', width: 360, height: 640 }, // W-118: small Android portrait
];
const DESKTOP = { name: 'desktop-1280x800', width: 1280, height: 800 };
const LAUNCH_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const POLL = { polling: 100 };

const log = (s) => console.log(s);
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail });
  const d = detail === undefined || detail === '' ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${d.length > 900 ? `${d.slice(0, 900)}…` : d}`);
  return !!ok;
};

// ─────────────────────────── in-page functions (serialised; must be self-contained) ───────────────────────────

/**
 * Truncation / target-size / overflow audit of the HUD. `textSels` are the listed elements that must never be cut.
 * @param {{ textSels: Record<string, string>, minTarget: number }} o
 */
export function auditHud({ textSels, minTarget }) {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false; // empty or visually hidden (u-sr-only is 1×1, clipped)
    if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return false;
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    return true;
  };
  const describe = (el) => {
    const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : '';
    const label = el.getAttribute('aria-label') || (el.textContent || '').trim();
    return `${el.tagName.toLowerCase()}${cls} "${label.replace(/\s+/g, ' ').slice(0, 40)}"`;
  };
  /** Cut = content wider than the box (single-line ellipsis) or taller than it (line clamp). 1 px of slack. */
  const cut = (el) => {
    const cs = getComputedStyle(el);
    const clampsY = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
    const clipsX = cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis';
    if (clipsX && el.scrollWidth > el.clientWidth + 1) return `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`;
    if (clampsY && el.scrollHeight > el.clientHeight + 1) return `scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight} (line clamp)`;
    return null;
  };
  const truncated = [];
  const listed = {};
  for (const [name, sel] of Object.entries(textSels)) {
    const els = Array.from(document.querySelectorAll(sel)).filter(visible);
    listed[name] = els.length;
    for (const el of els) {
      // the element itself and every clipping descendant that carries text
      for (const e of [el, ...el.querySelectorAll('*')]) {
        if (!visible(e) || !(e.textContent || '').trim()) continue;
        const why = cut(e);
        if (why) truncated.push({ group: name, el: describe(e), why });
      }
    }
  }
  // generic sweep: any visible ellipsis-styled HUD element that is actually cut
  const roots = Array.from(document.querySelectorAll('.hud, .st-hud'));
  const sweep = [];
  for (const root of roots) {
    for (const e of root.querySelectorAll('*')) {
      if (getComputedStyle(e).textOverflow !== 'ellipsis' || !(e.textContent || '').trim() || !visible(e)) continue;
      const why = cut(e);
      if (why) sweep.push({ el: describe(e), why });
    }
  }
  // touch targets
  const small = [];
  const targetSel = 'button, [role="button"], [role="tab"], [role="radio"], [role="menuitem"], [role="menuitemradio"], [role="switch"], [role="checkbox"], a[href], input, select, summary';
  let targets = 0;
  for (const root of roots) {
    for (const e of root.querySelectorAll(targetSel)) {
      if (!visible(e) || e.closest('[aria-hidden="true"]') || e.closest('.ui-tooltip, .hud-tooltip')) continue;
      if (getComputedStyle(e).pointerEvents === 'none') continue;
      targets++;
      const r = e.getBoundingClientRect();
      // the layout box (offsetWidth / offsetHeight), not the transformed one: a tip that pops up mid-audit is still in
      // its rise-in scale animation (W-118: 44 px buttons measured 42 px at 95 % scale)
      const tw = e instanceof HTMLElement ? Math.max(r.width, e.offsetWidth) : r.width;
      const th = e instanceof HTMLElement ? Math.max(r.height, e.offsetHeight) : r.height;
      if (tw < minTarget - 0.5 || th < minTarget - 0.5) small.push(`${describe(e)} ${Math.round(tw)}×${Math.round(th)}`);
    }
  }
  // horizontal overflow
  const doc = { scrollWidth: document.documentElement.scrollWidth, clientWidth: vw, bodyScrollWidth: document.body.scrollWidth };
  const outside = [];
  for (const root of roots) {
    for (const e of [root, ...root.querySelectorAll('*')]) {
      if (!visible(e)) continue;
      const cs = getComputedStyle(e);
      if (cs.position === 'fixed' && e.classList.contains('hud-hintring')) continue;
      const r = e.getBoundingClientRect();
      // only elements that are on screen at all but stick out sideways (scrolled-away rail items are clipped by their scroller)
      if (r.left < -1 || r.right > vw + 1) {
        let clipped = false;
        for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
          const pcs = getComputedStyle(p);
          if (pcs.overflowX !== 'visible') {
            const pr = p.getBoundingClientRect();
            // a clipping ancestor that is itself scrolled out (an <svg> icon inside a tab at the edge of the sideways
            // tab strip) proves nothing: keep climbing to the scroller that actually clips it
            if (pr.left >= -1 && pr.right <= vw + 1) {
              clipped = true;
              break;
            }
          }
        }
        if (!clipped) outside.push(`${describe(e)} [${Math.round(r.left)}, ${Math.round(r.right)}]`);
      }
    }
  }
  return { vw, vh, listed, truncated, sweep, small, targets, doc, outside: outside.slice(0, 30) };
}

/** Rectangles of the tip and the regions it must not cover. */
export function tipRects() {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    return { sel, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };
  return {
    tip: box('.hud-hint-bubble'),
    guarded: ['.hud-household', '.hud-agent__portrait', '.hud-agent__head', '.hud-needs', '.hud-agent'].map(box).filter(Boolean),
  };
}

/** Geometry of the main HUD regions (desktop no-change proof). */
export function desktopGeometry() {
  const sels = [
    '.hud-topbar',
    '.hud-topbar [role="radiogroup"]',
    '.hud-funds',
    '.hud-household',
    '.hud-member',
    '.hud-agent',
    '.hud-agent__head',
    '.hud-agent__name',
    '.hud-agent__tabs',
    '.hud-needs',
    '.hud-need',
    '.hud-queue',
    '.st-hud',
    '.st-hud__bar',
    '.st-hud__panel',
    '.hud-hint-bubble',
    '.hud-hint-bubble__actions button',
  ];
  const out = {};
  for (const s of sels) {
    // [left, top, width, height, content key]: boxes are compared only when the content matches (the sim may have
    // started an autonomous action, a different tip, … before the run paused — that is content, not layout)
    out[s] = Array.from(document.querySelectorAll(s)).map((el) => {
      const r = el.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height), (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)];
    });
  }
  out.__phone = document.documentElement.matches('[data-phone]') || !!document.querySelector('.hud[data-phone]');
  return out;
}

// ─────────────────────────── browser flow ───────────────────────────

async function enterWorld(page, shotBase) {
  const G = (fn, arg) => page.evaluate(fn, arg);
  const until = async (what, fn, arg, timeout = 180_000) => {
    try {
      await page.waitForFunction(fn, arg, { ...POLL, timeout });
    } catch {
      const s = await G(() => {
        const g = window.__afterlife && window.__afterlife.game;
        return g ? { screen: g.screen, fatal: g.fatalError, dialog: g.dialog, hint: g.hint && g.hint.id } : null;
      }).catch(() => null);
      throw new Error(`timed out (${timeout} ms) waiting for ${what}: ${JSON.stringify(s)}`);
    }
  };
  /** DOM click without Playwright's two-frame stability wait (SwiftShader draws a few FPS under load). */
  const tap = async (loc, timeout = 60_000) => {
    const el = loc.first();
    await el.waitFor({ state: 'visible', timeout });
    await el.scrollIntoViewIfNeeded({ timeout }).catch(() => {});
    await el.click({ force: true, timeout });
  };
  const screenIs = (sc) => {
    const g = window.__afterlife && window.__afterlife.game;
    return !!g && (g.screen === sc || !!g.fatalError);
  };
  await page.goto(page.__url, { waitUntil: 'domcontentloaded' });
  await until('menu', screenIs, 'menu', 600_000);
  // first-run age gate (fresh profile)
  await page.locator('.st-age-dialog .st-age__input').waitFor({ state: 'visible', timeout: 60_000 });
  await page.locator('.st-age-dialog .st-age__input').fill(String(new Date().getFullYear() - 30));
  await tap(page.locator('[data-testid="age-continue"]'));
  await until('age gate closed', () => !document.querySelector('.st-age-dialog'), undefined, 60_000);
  await tap(page.locator('.sh-menu__item', { hasText: 'New Game' }));
  await until('new game screen', screenIs, 'newGame', 60_000);
  await shellChecks(page, shotBase, 'new-game', '.sh-screen', '.sh-newgame__foot .ui-btn--primary');
  // the existing furnished starter lot (Fixer-Upper)
  const starter = page.locator('.sh-lots [role="radio"]', { hasText: 'Fixer-Upper' });
  await tap(starter);
  await until('starter lot chosen', () => {
    const r = document.querySelector('.sh-lots [role="radio"][aria-checked="true"]');
    return !!r && /Fixer-Upper/.test(r.textContent || '');
  }, undefined, 30_000);
  await tap(page.getByRole('button', { name: 'Create your household' }));
  await until('create-a-zombie', () => window.__afterlife.game.screen === 'caz' && !!window.__afterlife.game.caz && !!document.querySelector('.sh-caz__editor'), undefined, 60_000);
  // fixed (long-ish, realistic) names so the layout under test is the same every run
  await page.getByRole('textbox', { name: 'First name' }).fill('Ghoulia');
  await page.getByRole('textbox', { name: 'Last name' }).fill('Graveworth');
  await page.getByRole('textbox', { name: 'Household name' }).fill('The Graveworths');
  const lot = await G(() => window.__afterlife.game.caz.lotTemplate);
  check(`[${shotBase}] household moves into the starter lot`, lot === 'starter', lot);
  await shellChecks(page, shotBase, 'caz', '.sh-caz', '.sh-editor__start');
  // every editor tab (Identity / Body / Hair / Outfit / Personality / Voice): its panel must lay out as well
  const tabs = await page.locator('.sh-editor__tabs [role="tab"]').count();
  for (let i = 0; i < tabs; i++) {
    await page.locator('.sh-editor__tabs [role="tab"]').nth(i).click({ force: true });
    await page.waitForTimeout(300);
    await shellChecks(page, shotBase, `caz-tab-${i}`, '.sh-caz', '.sh-editor__start', i === 3 || i === 4);
  }
  await page.locator('.sh-editor__tabs [role="tab"]').first().click({ force: true });
  const errs = await G(() => window.__afterlife.game.validateCaz());
  if (errs.length) throw new Error(`CAZ not valid: ${JSON.stringify(errs)}`);
  await tap(page.locator('.sh-editor__start'));
  await until('game', screenIs, 'game', 600_000);
  await until('renderer + HUD', () => window.__afterlife.game.renderer.loadProgress() >= 1 && !!document.querySelector('.hud-household') && !!document.querySelector('.hud-agent'), undefined, 600_000);
  const fatal = await G(() => window.__afterlife.game.fatalError);
  if (fatal) throw new Error(`fatal: ${fatal}`);
}

/**
 * W-118: a shell screen (New Game, Create-a-Zombie) on this viewport — no text runs out of its box, no two controls
 * intersect, the primary action is reachable (tests/e2e/lib/shellAudit.mjs). Phone viewports only: the desktop run
 * reaches these screens too, where the audit is informational.
 */
async function shellChecks(page, vp, what, root, start, screenshot = true) {
  await page.waitForTimeout(600); // rise-in animations
  const a = await page.evaluate(auditShell, { root, start });
  const phone = !vp.startsWith('desktop');
  if (phone) {
    check(`[${vp}] ${what}: no text overflows its box`, a.overflowCount === 0, a.overflow);
    check(`[${vp}] ${what}: no two interactive elements intersect (${a.controls} checked)`, a.controls > 0 && a.overlapCount === 0, a.overlaps);
    check(`[${vp}] ${what}: the primary action is reachable`, !!a.start && a.start.reachable, a.start);
    check(`[${vp}] ${what}: no horizontal page overflow`, a.sw <= a.vw, { sw: a.sw, vw: a.vw });
  } else log(`    [${vp}] ${what}: ${a.overflowCount} overflow, ${a.overlapCount} overlaps, start ${JSON.stringify(a.start)}`);
  if (screenshot) await shot(page, `${vp}-${what}`);
  // back to the top of a scrolled screen for the next step
  await page.evaluate((r) => document.querySelector(r)?.scrollTo?.(0, 0), root);
}

async function shot(page, name) {
  const file = path.join(OUT, `${LABEL}-${name}.png`);
  try {
    await page.screenshot({ path: file, timeout: 180_000 });
    log(`      screenshot ${path.relative(ROOT, file)}`);
  } catch (e) {
    log(`      (screenshot ${name} failed: ${String(e.message).split('\n')[0]})`);
  }
  return file;
}

const TEXT_SELS = {
  'household portrait names': '.hud-member__name',
  'agent portrait name': '.hud-agent__name',
  'mood / status pill': '.hud-moodchip',
  'current activity': '.hud-agent__activity',
  'needs labels': '.hud-need',
  'feelings': '.hud-feeling',
  'action queue bubble': '.hud-qactive__text, .hud-qitem',
  'tip popover': '.hud-hint-bubble',
  'top bar': '.hud-topbar',
  'quest chip / panel': '.st-hud',
};

const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

async function runPhone(browser, url, vp) {
  log(`\n=== ${vp.name} ===`);
  // iPhone 14 descriptor (user agent, isMobile, hasTouch) at this viewport; deviceScaleFactor 1 for the screenshots
  const context = await browser.newContext({ ...devices['iPhone 14'], viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await context.addInitScript(initScript);
  const page = await context.newPage();
  page.__url = url;
  page.setDefaultTimeout(120_000);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && pageErrors.push(`console.error: ${m.text().slice(0, 300)}`));
  const G = (fn, arg) => page.evaluate(fn, arg);
  try {
    const t0 = Date.now();
    await enterWorld(page, vp.name);
    log(`    in the world after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    // freeze time so the clock / needs do not reflow between measurements
    await G(() => window.__afterlife.game.setSpeed(0));
    await page.waitForFunction(() => !!window.__afterlife.game.hint && !!document.querySelector('.hud-hint-bubble'), undefined, { ...POLL, timeout: 120_000 });
    await page.waitForTimeout(800); // the tip places itself on a 120 ms interval
    await shot(page, `${vp.name}-tip`);

    // ── tip popover ──
    const tr = await G(tipRects);
    const hits = tr.tip ? tr.guarded.filter((g) => intersects(tr.tip, g)) : [];
    check(`[${vp.name}] tip popover shown`, !!tr.tip, tr.tip);
    check(`[${vp.name}] tip does not cover the portrait / needs panel`, !!tr.tip && hits.length === 0, hits.length ? { tip: tr.tip, covers: hits } : tr.tip);
    let a = await G(auditHud, { textSels: TEXT_SELS, minTarget: MIN_TARGET });
    const tipCut = a.truncated.filter((t) => t.group === 'tip popover');
    check(`[${vp.name}] tip buttons / text not truncated`, tipCut.length === 0, tipCut);
    const tipBtns = await G(() => Array.from(document.querySelectorAll('.hud-hint-bubble button')).map((b) => ({ text: b.textContent.trim(), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height), sw: b.scrollWidth, cw: b.clientWidth })));
    check(`[${vp.name}] tip buttons show their full labels`, tipBtns.length >= 2 && tipBtns.every((b) => b.sw <= b.cw + 1 && b.w >= MIN_TARGET && b.h >= MIN_TARGET), tipBtns);

    // ── dismiss the tip, show an action in the queue, re-audit ──
    for (let i = 0; i < 6; i++) {
      const id = await G(() => (window.__afterlife.game.hint ? window.__afterlife.game.hint.id : null));
      if (!id) break;
      await page.locator('.hud-hint-bubble button', { hasText: 'Got it' }).first().click({ force: true }).catch(() => G((h) => window.__afterlife.game.dismissHint(h), id));
      await page.waitForFunction((h) => !window.__afterlife.game.hint || window.__afterlife.game.hint.id !== h, id, { ...POLL, timeout: 30_000 }).catch(() => {});
    }
    // let autonomy pick something (the "Chosen on their own" queue bubble), then freeze again
    await G(() => window.__afterlife.game.setSpeed(3));
    await page
      .waitForFunction(() => {
        const g = window.__afterlife.game;
        const id = g.selectedAgentId;
        return !!id && g.sim.queueView(id).length > 0 && !!document.querySelector('.hud-queue');
      }, undefined, { ...POLL, timeout: 240_000 })
      .catch(() => log('    (no queued action appeared within 240 s)'));
    await G(() => window.__afterlife.game.setSpeed(0));
    // a tip that popped up meanwhile is dismissed (it is audited above)
    await G(() => {
      const g = window.__afterlife.game;
      if (g.hint) g.dismissHint(g.hint.id);
    });
    await page.waitForTimeout(800);
    const queueText = await G(() => (document.querySelector('.hud-queue') ? document.querySelector('.hud-queue').textContent.trim().slice(0, 80) : null));
    log(`    queue: ${JSON.stringify(queueText)}`);
    await shot(page, `${vp.name}-world`);
    a = await G(auditHud, { textSels: TEXT_SELS, minTarget: MIN_TARGET });
    log(`    listed elements: ${JSON.stringify(a.listed)}`);
    for (const group of Object.keys(TEXT_SELS)) {
      if (group === 'tip popover') continue;
      const cutHere = a.truncated.filter((t) => t.group === group);
      check(`[${vp.name}] ${group}: no truncation`, cutHere.length === 0, cutHere.length ? cutHere : `${a.listed[group]} element(s)`);
    }
    check(`[${vp.name}] no visible ellipsis-styled HUD element is cut`, a.sweep.length === 0, a.sweep);
    check(`[${vp.name}] every visible HUD control ≥ ${MIN_TARGET}×${MIN_TARGET} (${a.targets} checked)`, a.targets > 0 && a.small.length === 0, a.small);
    check(`[${vp.name}] no horizontal page overflow`, a.doc.scrollWidth <= a.doc.clientWidth && a.doc.bodyScrollWidth <= a.doc.clientWidth, a.doc);
    check(`[${vp.name}] no HUD element sticks out of the viewport sideways`, a.outside.length === 0, a.outside);

    // ── phone-specific structure ──
    const st = await G(() => {
      const panel = document.querySelector('.st-hud__panel');
      const chip = document.querySelector('.st-hud__questchip');
      const more = document.querySelector('.hud-topbar__more');
      const modes = Array.from(document.querySelectorAll('.hud-modes [role="radio"]')).map((b) => (b.textContent || '').trim());
      return {
        phone: !!document.querySelector('.hud[data-phone]') || document.documentElement.hasAttribute('data-phone'),
        panelOpen: !!panel && panel.getBoundingClientRect().width > 0,
        chip: !!chip && chip.getBoundingClientRect().width > 0,
        more: !!more && more.getBoundingClientRect().width > 0,
        modes,
      };
    });
    check(`[${vp.name}] phone layout mode is active`, st.phone, st);
    check(`[${vp.name}] quest panel collapsed to a toggle chip`, st.chip && !st.panelOpen, st);
    check(`[${vp.name}] top-bar overflow menu present`, st.more, st);
    check(`[${vp.name}] Live / Buy / Build tabs keep visible text labels`, st.modes.length === 3 && st.modes.every((t) => /\w{3,}/.test(t)), st.modes);
    // open the quest chip + the overflow menu, audit + screenshot them as well (a tip that popped up since is closed
    // first: tips are a separate layer, checked above)
    const noHint = () =>
      G(() => {
        const g = window.__afterlife.game;
        if (g.hint) g.dismissHint(g.hint.id);
      });
    await noHint();
    if (st.chip) {
      await page.locator('.st-hud__questchip').first().click({ force: true });
      await page.waitForTimeout(600);
      await shot(page, `${vp.name}-quests-open`);
      const q = await G(auditHud, { textSels: { 'quest panel': '.st-hud__panel' }, minTarget: MIN_TARGET });
      const qr = await G(() => {
        const p = document.querySelector('.st-hud__panel');
        const r = p ? p.getBoundingClientRect() : null;
        return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null;
      });
      check(`[${vp.name}] opened quest panel fits the viewport`, !!qr && qr.left >= 0 && qr.right <= vp.width && qr.bottom <= vp.height, qr);
      check(`[${vp.name}] opened quest panel: controls ≥ 44 px, no overflow`, q.small.length === 0 && q.outside.length === 0, { small: q.small, outside: q.outside });
      await page.locator('.st-hud__questchip').first().click({ force: true });
      await page.waitForTimeout(400);
    }
    if (st.more) {
      await noHint();
      await page.locator('.hud-topbar__more').first().click({ force: true });
      await page.waitForTimeout(600);
      await shot(page, `${vp.name}-overflow-menu`);
      const m = await G(auditHud, { textSels: { 'overflow menu': '.hud-topbar__overflow' }, minTarget: MIN_TARGET });
      const items = await G(() => Array.from(document.querySelectorAll('.hud-topbar__overflow [role="menuitem"]')).map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim()));
      check(`[${vp.name}] overflow menu lists the secondary tools`, items.length >= 3, items);
      check(`[${vp.name}] overflow menu: controls ≥ 44 px, nothing cut or outside`, m.small.length === 0 && m.truncated.length === 0 && m.outside.length === 0, { small: m.small, cut: m.truncated, outside: m.outside });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }

    // ── Buy / Build on phone: reached through the labelled mode tabs; screenshots + page-overflow check (their
    //    catalog / tool panels are outside W-114's live-HUD scope, so their target sizes are reported, not asserted) ──
    // by visible text on phone, by accessible name where the tab is icon-only (the pre-W-114 build)
    const modeTab = (name) => page.locator(`.hud-modes [role="radio"]:has-text("${name}"), .hud-modes [role="radio"][aria-label="${name}"]`).first();
    for (const mode of ['Buy', 'Build']) {
      await noHint();
      await modeTab(mode).click({ force: true });
      await page.waitForFunction((m) => window.__afterlife.game.mode === m, mode.toLowerCase(), { ...POLL, timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(800);
      await shot(page, `${vp.name}-${mode.toLowerCase()}`);
      const b = await G(auditHud, { textSels: {}, minTarget: MIN_TARGET });
      check(`[${vp.name}] ${mode} mode: no horizontal page overflow`, b.doc.scrollWidth <= b.doc.clientWidth, b.doc);
      log(`    ${mode}: ${b.small.length} of ${b.targets} controls under ${MIN_TARGET} px${b.small.length ? `: ${b.small.slice(0, 6).join('; ')}` : ''}; ${b.outside.length} sticking out`);
    }
    await modeTab('Live').click({ force: true });
    await page.waitForFunction(() => window.__afterlife.game.mode === 'live' && !!document.querySelector('.hud-agent__name'), undefined, { ...POLL, timeout: 60_000 }).catch(() => {});
    // the agent panel rises in (opacity animation): let it finish so the negative control measures a visible element
    await page
      .waitForFunction(() => {
        const el = document.querySelector('.hud-agent');
        return !!el && el.getAnimations().every((a) => a.playState !== 'running') && getComputedStyle(el).opacity === '1';
      }, undefined, { ...POLL, timeout: 30_000 })
      .catch(() => {});

    // ── negative control: the checker must catch a deliberately narrowed element ──
    const neg = await G(
      ({ fn, minTarget }) => {
        const audit = new Function(`return (${fn})`)();
        const el = document.querySelector('.hud-agent__name') || document.querySelector('.hud-member__name');
        if (!el) return { ok: false, why: 'no element' };
        const prev = el.getAttribute('style') || '';
        el.setAttribute('style', `${prev};width:3ch !important;max-width:3ch !important;display:block !important;overflow:hidden !important;text-overflow:ellipsis !important;white-space:nowrap !important`);
        const r = audit({ textSels: { probe: el.classList.contains('hud-agent__name') ? '.hud-agent__name' : '.hud-member__name' }, minTarget });
        el.setAttribute('style', prev);
        const btn = document.querySelector('.hud button');
        let caughtSmall = false;
        if (btn) {
          const p2 = btn.getAttribute('style') || '';
          btn.setAttribute('style', `${p2};width:20px !important;height:20px !important;min-width:0 !important;min-height:0 !important;padding:0 !important`);
          caughtSmall = audit({ textSels: {}, minTarget }).small.length > 0;
          btn.setAttribute('style', p2);
        }
        return { ok: true, caughtCut: r.truncated.length > 0, caughtSweep: r.sweep.length > 0, caughtSmall, sample: r.truncated[0] };
      },
      { fn: auditHud.toString(), minTarget: MIN_TARGET },
    );
    check(`[${vp.name}] negative control: checker flags a deliberately narrowed name`, neg.ok && neg.caughtCut && neg.caughtSweep, neg);
    check(`[${vp.name}] negative control: checker flags a deliberately shrunk 20×20 button`, neg.ok && neg.caughtSmall, neg);
    check(`[${vp.name}] no page errors`, pageErrors.length === 0, pageErrors.slice(0, 3));
  } catch (e) {
    check(`[${vp.name}] flow completed`, false, String(e && e.stack ? e.stack : e).split('\n').slice(0, 4).join(' | '));
    await shot(page, `${vp.name}-FAIL`);
  } finally {
    await Promise.race([context.close().catch(() => {}), new Promise((r) => setTimeout(r, 15_000))]);
  }
}

async function runDesktop(browser, url) {
  const dump = opt('desktop-dump', '');
  const compare = opt('desktop-compare', '');
  log(`\n=== ${DESKTOP.name} ===`);
  const context = await browser.newContext({ viewport: { width: DESKTOP.width, height: DESKTOP.height }, deviceScaleFactor: 1 });
  await context.addInitScript(initScript);
  const page = await context.newPage();
  page.__url = url;
  page.setDefaultTimeout(120_000);
  const G = (fn, arg) => page.evaluate(fn, arg);
  try {
    await enterWorld(page, DESKTOP.name);
    await G(() => window.__afterlife.game.setSpeed(0));
    await page.waitForFunction(() => !!window.__afterlife.game.hint && !!document.querySelector('.hud-hint-bubble'), undefined, { ...POLL, timeout: 120_000 });
    await page.waitForTimeout(1000);
    await shot(page, `${DESKTOP.name}-tip`);
    const geo = await G(desktopGeometry);
    check(`[${DESKTOP.name}] phone layout mode is NOT active`, geo.__phone === false, geo.__phone);
    if (dump) {
      writeFileSync(path.resolve(ROOT, dump), JSON.stringify(geo, null, 1));
      log(`    desktop geometry written to ${dump}`);
    }
    if (compare) {
      const base = JSON.parse(readFileSync(path.resolve(ROOT, compare), 'utf8'));
      const diffs = [];
      const skipped = [];
      let boxes = 0;
      for (const [sel, list] of Object.entries(base)) {
        if (sel.startsWith('__')) continue;
        const now = geo[sel] || [];
        if (now.length !== list.length) diffs.push(`${sel}: ${list.length} → ${now.length} element(s)`);
        for (let i = 0; i < Math.min(now.length, list.length); i++) {
          boxes++;
          // different content (the sim rolled other needs / mood / an autonomous action): only the horizontal geometry
          // (left, width) is layout; top / height may follow the text
          const sameContent = list[i][4] === now[i][4];
          const dims = sameContent ? [0, 1, 2, 3] : [0, 2];
          if (!sameContent) skipped.push(`${sel}[${i}]`);
          if (dims.some((k) => Math.abs(list[i][k] - now[i][k]) > 1)) diffs.push(`${sel}[${i}]: ${JSON.stringify(list[i].slice(0, 4))} → ${JSON.stringify(now[i].slice(0, 4))}${sameContent ? '' : ' (x/width only)'}`);
        }
      }
      if (skipped.length) log(`    (content differs, compared on x/width only: ${skipped.join(', ')})`);
      check(`[${DESKTOP.name}] HUD geometry identical to ${compare} (${boxes} boxes, ${boxes - skipped.length} on all four edges, ±1 px)`, boxes >= 15 && diffs.length === 0, diffs);
    }
  } catch (e) {
    check(`[${DESKTOP.name}] flow completed`, false, String(e && e.stack ? e.stack : e).split('\n').slice(0, 4).join(' | '));
    await shot(page, `${DESKTOP.name}-FAIL`);
  } finally {
    await Promise.race([context.close().catch(() => {}), new Promise((r) => setTimeout(r, 15_000))]);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const distDir = path.resolve(opt('dist', path.join(tmpdir(), 'al-phone-dist')));
  let server = null;
  let browser = null;
  try {
    let url = opt('url', '');
    if (!url) {
      await ensureBuild({ root: ROOT, distDir, mode: flag('no-build') ? 'never' : flag('rebuild') ? 'always' : 'auto', log });
      server = await startPreview({ root: ROOT, distDir, log });
      url = server.url;
    }
    browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
    const only = opt('only', '');
    for (const vp of PHONES) if (!only || only.split(',').includes(vp.name.split('-')[0])) await runPhone(browser, url, vp);
    if (!only || only.split(',').includes('desktop')) await runDesktop(browser, url);
  } finally {
    const bounded = (p) => Promise.race([p.catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    if (browser) await bounded(browser.close());
    if (server) await bounded(server.stop());
  }
  const failed = checks.filter((c) => !c.ok);
  writeFileSync(path.join(OUT, `${LABEL}-report.json`), JSON.stringify({ ok: failed.length === 0, checks }, null, 1));
  log(`\n${failed.length === 0 ? 'PHONE LAYOUT PASSED' : 'PHONE LAYOUT FAILED'} (${checks.length - failed.length}/${checks.length} checks)`);
  for (const f of failed) log(`  FAIL ${f.name}`);
  return failed.length === 0 || REPORT_ONLY ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  },
);
