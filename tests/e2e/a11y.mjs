/**
 * W-064 accessibility acceptance in a real browser (production build, headless Chromium + SwiftShader).
 * Re-runs the repro steps of Sol's W-023 audit (docs/desktop-reports/a11y-l10n.md on desktop/sol-a11y) against the
 * fixes, with the same pass/fail rules as the main suite (any console error / page error / failed request fails):
 *
 *   A4  Escape from the year-of-birth field closes the first-run age gate and the Store (focus was trapped)
 *   A2  browser zoom 200 % / 400 % scales rem text by exactly 2× / 4× (was capped at 150 %)
 *   A3  Store at 390 × 844 with 140 % UI scale: readable text, ≥ 24 px targets, cards contained, body scrolls
 *   A6  CAZ pose bar: the thumb sits under the checked pose; label colours clear 4.5:1; Notices badge 4.5:1
 *   A5  action queue <ol> has no aria-orientation
 *   A1  Buy mode by keyboard only: F6 → Tab to search → type → Tab to a card → Enter → arrows → Shift+Enter places (keeps placing, W-116)
 *       (funds drop), Enter on an occupied spot is refused and announced, R rotates, Esc cancels
 *   W-118 (Sol's built-browser audit + native-Chrome retest): Settings at 400 % zoom (CSS 320×256) reflows with every
 *       focus stop on screen; Store at 320×568 contained; every Buy category's cards named by their visible text
 *       (axe label-content-name-mismatch, with a negative control); F6 → world focuses the canvas and Pause →
 *       Settings → Esc → Esc hands focus back to it; compact windows (390×844, 844×390, 360×640, 320×480, 280×653,
 *       2000×300, mouse pointer, 140 %) get a ≥ 14 px root, ≥ 24 px HUD targets, nothing off-screen; and the desktop
 *       root size equals the pre-W-118 formula on 1280×720 / 1920×1080 / 2560×1440 / 800×600 × 80/100/140 % × zoom 1/2
 *   W-118 (Sol's native Chrome 400 % retest): every shared dialog at a 316×232 and a 320×256 CSS viewport (1264×928 /
 *       1280×1024 at 400 %) — main menu Settings (all tabs), Store (all tabs), Credits; the CAZ remove-zombie confirm;
 *       in game Pause, Save, Load, Settings (all tabs), Help, the session log, the Main Menu confirm, Careers,
 *       Household, Phone, Rewards, Invite, Store and Report-a-bug — each fits the viewport, its Close is on screen and
 *       hit-testable, every focus stop lands on screen, and Escape closes it with focus back on its opener
 *   axe WCAG 2.x A/AA rule scans of the Store, CAZ, Buy (every category) and compact HUD states when axe-core is available (AXE_CORE=<axe.min.js>
 *   or `axe-core` resolvable); without it those scans are reported as not run (never as passed).
 *
 *   node tests/e2e/a11y.mjs [--rebuild | --no-build] [--dist=<dir>] [--url=<http://…/>] [--out=<dir>]
 *
 * Browser zoom cannot be driven in headless Chromium; it is EMULATED exactly as Chromium presents it to the page:
 * CSS viewport = window / z, devicePixelRatio = z, outerWidth = the window's screen width (CDP device metrics +
 * an outerWidth override). Physical text size = CSS px × devicePixelRatio.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness } from './lib/harness.mjs';
import { ensureBuild, startPreview } from './lib/server.mjs';
import * as P from './lib/inpage.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POLL = { polling: 100 };

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
    out: path.resolve(ROOT, opt('out', process.env.E2E_OUT || path.join('dev', 'out', 'e2e-a11y'))),
    headed: flag('headed'),
  };
}

export function loadAxe() {
  const candidates = [process.env.AXE_CORE];
  try {
    candidates.push(require.resolve('axe-core/axe.min.js'));
  } catch {
    /* not installed */
  }
  for (const c of candidates) if (c && existsSync(c)) return { path: c, source: readFileSync(c, 'utf8') };
  return null;
}

/** WCAG luminance contrast of two CSS rgb()/rgba() strings, alpha-composited over `under` (rgb). In-page helper. */
function contrastInPage({ fg, bg, under }) {
  const parse = (s) => {
    const m = /rgba?\(([^)]+)\)/.exec(s);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (top, base) => ({ r: top.r * top.a + base.r * (1 - top.a), g: top.g * top.a + base.g * (1 - top.a), b: top.b * top.a + base.b * (1 - top.a), a: 1 });
  const lum = (c) => {
    const f = (v) => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const u = parse(under);
  const b = over(parse(bg), u);
  const f = over(parse(fg), b);
  const [l1, l2] = [lum(f), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

export async function main(argv = process.argv.slice(2)) {
  const { chromium } = require('playwright');
  const args = parseArgs(argv);
  mkdirSync(args.out, { recursive: true });
  for (const f of readdirSync(args.out)) if (/\.(png|json)$/.test(f)) rmSync(path.join(args.out, f));
  const h = new Harness({ outDir: args.out });
  const axe = loadAxe();
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
    await flow({ h, browser, url, axe });
  } catch (e) {
    fatal = e;
    console.error(`\nA11Y RUN ABORTED: ${e && e.stack ? e.stack : e}`);
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
  console.log(axe ? `\naxe-core: ${axe.path}` : '\naxe-core: NOT FOUND — rule scans were not run (set AXE_CORE=<path to axe.min.js>)');
  const ok = !fatal && h.ok;
  h.writeReport({ meta: { totalMs: Date.now() - t0, axe: axe ? axe.path : null }, fatal: fatal ? String(fatal.stack || fatal) : null });
  console.log(`\n${ok ? 'A11Y PASSED' : 'A11Y FAILED'} in ${((Date.now() - t0) / 1000).toFixed(1)} s — ${path.relative(ROOT, args.out) || args.out}`);
  return ok ? 0 : 1;
}

async function flow({ h, browser, url, axe }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(P.initScript);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
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
  // generous: under CPU contention SwiftShader frames take seconds and starve the page (README: Determinism and timing)
  const tap = async (loc, timeout = 90_000) => {
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
    await el.click({ force: true, timeout });
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
  /** Let finite CSS animations (dialog rise-in = scale 0.985) finish before measuring geometry. */
  const settle = () =>
    G(() =>
      Promise.race([
        Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect && a.effect.getTiming().iterations !== Infinity)
            .map((a) => a.finished.catch(() => undefined)),
        ),
        new Promise((r) => setTimeout(r, 5000)),
      ]).then(() => undefined),
    );
  /** Screenshot through CDP: page.screenshot() would reset an emulated device-metrics override (zoom). */
  const cdpShot = async (cdp, name) => {
    try {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path.join(h.outDir, `${String(++h.shotIndex).padStart(2, '0')}-${name}.png`), Buffer.from(data, 'base64'));
    } catch (e) {
      h.log(`    (screenshot ${name} failed: ${String(e.message).split('\n')[0]})`);
    }
  };
  const runAxe = async (label, selector) => {
    if (!axe) {
      h.log(`    (axe-core not available: ${label} rule scan not run)`);
      return;
    }
    await G((src) => {
      if (!window.axe) (0, eval)(src);
    }, axe.source);
    const res = await G(async (sel) => {
      const r = await window.axe.run(sel ? document.querySelector(sel) ?? document : document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
        rules: { 'color-contrast': { enabled: false } }, // backdrop is WebGL: measured with rendered colours instead
      });
      return r.violations.map((v) => ({ id: v.id, n: v.nodes.length, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
    }, selector);
    const watched = res.filter((v) => ['aria-allowed-attr', 'label-content-name-mismatch', 'aria-prohibited-attr', 'button-name', 'aria-valid-attr-value', 'target-size', 'nested-interactive', 'list', 'listitem'].includes(v.id));
    h.check(`axe (${label}): no ARIA / naming / target-size violations`, watched.length === 0, watched);
    if (res.length > watched.length) h.log(`    axe (${label}) other findings: ${JSON.stringify(res.filter((v) => !watched.includes(v)))}`);
  };

  // ─────────────────────────────── boot + A4 (first-run gate) ───────────────────────────────
  await step('boot to the first-run age gate', async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await untilScreen('menu', 300_000);
    await until('age gate shown', () => !!document.querySelector('.st-age-dialog .st-age__input'));
  });

  await step('A4: Escape in the first-run year field closes the gate', async () => {
    await until('year field focused (autofocus)', () => document.activeElement?.id === 'st-age-year', undefined, 15_000);
    await page.keyboard.type('19');
    h.check('typing stays in the field', (await G(() => document.getElementById('st-age-year')?.value)) === '19');
    await page.keyboard.press('Escape');
    await until('gate closed by Escape', () => !document.querySelector('.st-age-dialog'), undefined, 10_000);
    h.check('gate closed by Escape from the year field (Sol repro: it stayed open)', true);
    h.check('nothing was answered', (await G(() => window.__afterlife.game.economy?.age?.bracket ?? 'unknown')) === 'unknown');
  }, { needs: ['boot to the first-run age gate'] });

  await step('A4: Escape in the Store’s year field closes the Store', async () => {
    await tap(page.locator('.sh-menu__item', { hasText: 'Store' }));
    await until('store open with its age gate', () => !!document.querySelector('.st-dialog #st-age-year'));
    await page.locator('#st-age-year').focus();
    await page.keyboard.type('1');
    await page.keyboard.press('Escape');
    await until('store closed by Escape', () => !document.querySelector('.st-dialog') && window.__afterlife.game.dialog === null, undefined, 10_000);
    h.check('Store closed by Escape from st-age-year (Sol repro: dialog stayed "store")', true);
  }, { needs: ['A4: Escape in the first-run year field closes the gate'] });

  // ─────────────────────────────── A2: emulated browser zoom ───────────────────────────────
  await step('A2: browser zoom 200 % / 400 % scales text fully', async () => {
    const cdp = await context.newCDPSession(page);
    const W = 1280;
    const H = 720;
    const measure = async (z) => {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: Math.round(W / z), height: Math.round(H / z), deviceScaleFactor: z, mobile: false });
      await G(({ w }) => {
        Object.defineProperty(window, 'outerWidth', { configurable: true, get: () => w });
        window.dispatchEvent(new Event('resize'));
      }, { w: W });
      await page.waitForTimeout(400);
      return G(() => {
        const t = document.querySelector('.ui-modal__title');
        return {
          dpr: window.devicePixelRatio,
          inner: window.innerWidth,
          zoomVar: getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom').trim(),
          root: parseFloat(getComputedStyle(document.documentElement).fontSize),
          title: t ? parseFloat(getComputedStyle(t).fontSize) : NaN,
          sw: document.documentElement.scrollWidth,
        };
      });
    };
    await tap(page.locator('.sh-menu__item', { hasText: 'Settings' }));
    await until('settings open', () => window.__afterlife.game.dialog === 'settings' && !!document.querySelector('.ui-modal__title'));
    await settle();
    const m1 = await measure(1);
    const m2 = await measure(2);
    const m4 = await measure(4);
    const phys = (m) => m.title * m.dpr;
    h.log(`    zoom 100/200/400 %: ${JSON.stringify([m1, m2, m4])}`);
    h.check('--ui-zoom follows the browser zoom (1 / 2 / 4)', m1.zoomVar === '1' && m2.zoomVar === '2' && m4.zoomVar === '4', [m1.zoomVar, m2.zoomVar, m4.zoomVar]);
    h.check('Settings heading is 2.00× at 200 % (Sol: 1.5×)', Math.abs(phys(m2) / phys(m1) - 2) < 0.02, (phys(m2) / phys(m1)).toFixed(3));
    h.check('Settings heading is 4.00× at 400 % (Sol: 1.5×)', Math.abs(phys(m4) / phys(m1) - 4) < 0.04, (phys(m4) / phys(m1)).toFixed(3));
    h.check('rem text follows exactly (root font size constant in CSS px)', Math.abs(m2.root - m1.root) < 0.01 && Math.abs(m4.root - m1.root) < 0.01, [m1.root, m2.root, m4.root]);
    await h.shot(page, 'settings-zoom-400');
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await G(() => {
      delete window.outerWidth;
      window.dispatchEvent(new Event('resize'));
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.keyboard.press('Escape');
    await until('settings closed', () => window.__afterlife.game.dialog === null);
    await cdp.detach();
  }, { needs: ['boot to the first-run age gate'] });

  // ─────────────────────────────── A3: Store at 390 px / 140 % ───────────────────────────────
  await step('A3: Store at 390×844, UI scale 140 % — readable, contained, targets ≥ 24 px', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    // the Settings slider's own write path (a player can pick 140 % there; the slider itself is not under test)
    await G(() => window.__afterlife.game.updateSettings({ uiScale: 1.4 }));
    await until('scale applied', () => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim() === '1.4');
    await tap(page.locator('.sh-menu__item', { hasText: 'Store' }));
    await until('store open', () => !!document.querySelector('.st-dialog'));
    // answer the gate (adult) so the catalogue renders
    if (await page.locator('.st-dialog #st-age-year').count()) {
      await page.locator('.st-dialog #st-age-year').fill(String(new Date().getFullYear() - 30));
      await page.keyboard.press('Enter');
      await until('gate answered', () => !document.querySelector('.st-dialog #st-age-year'));
    }
    await until('cards', () => document.querySelectorAll('.st-dialog .st-card').length > 0);
    await settle();
    const geo = await G(() => {
      const panel = document.querySelector('.st-dialog').getBoundingClientRect();
      const body = document.querySelector('.st-dialog .ui-modal__body');
      const br = body.getBoundingClientRect();
      const texts = [];
      for (const el of document.querySelectorAll('.st-dialog *')) {
        if (!(el instanceof HTMLElement) || el.closest('[aria-hidden="true"], .u-sr-only')) continue;
        const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
        const r = el.getBoundingClientRect();
        if (own && r.width > 0 && r.height > 0) texts.push({ cls: el.className, fs: parseFloat(getComputedStyle(el).fontSize) });
      }
      const targets = [];
      for (const el of document.querySelectorAll('.st-dialog button, .st-dialog [role="tab"], .st-dialog input, .st-dialog select')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) targets.push({ cls: el.className, w: r.width, h: r.height });
      }
      const cards = Array.from(document.querySelectorAll('.st-dialog .st-card')).map((c) => c.getBoundingClientRect());
      return {
        root: parseFloat(getComputedStyle(document.documentElement).fontSize),
        sw: document.documentElement.scrollWidth,
        panel: { l: panel.left, r: panel.right, t: panel.top, b: panel.bottom },
        body: { l: br.left, r: br.right, t: br.top, b: br.bottom, oy: getComputedStyle(body).overflowY, sh: body.scrollHeight, ch: body.clientHeight },
        minText: texts.reduce((m, t) => Math.min(m, t.fs), 99),
        smallText: texts.filter((t) => t.fs < 9.5).slice(0, 5),
        desc: Math.min(...Array.from(document.querySelectorAll('.st-card__desc')).map((d) => parseFloat(getComputedStyle(d).fontSize))),
        smallTargets: targets.filter((t) => t.w < 24 || t.h < 24).slice(0, 8),
        nTargets: targets.length,
        cardsOutsideX: cards.filter((c) => c.left < br.left - 0.5 || c.right > br.right + 0.5).length,
        cardWidth: cards[0] ? cards[0].width : 0,
        columns: new Set(cards.map((c) => Math.round(c.left))).size,
      };
    });
    h.log(`    390px store: ${JSON.stringify(geo)}`);
    // Sol's W-023 condition shrank 1rem to ≈ 4.9 px here; W-118 floors it at 10 px × UI scale on compact windows
    h.check('W-118: the compact root floor applies (1rem = 14 px at 140 %, was ≈ 4.9 px)', Math.abs(geo.root - 14) < 0.05, geo.root);
    h.check('no horizontal page overflow', geo.sw <= 390, geo.sw);
    h.check('the dialog panel is inside the viewport', geo.panel.l >= 0 && geo.panel.r <= 390 && geo.panel.b <= 844, geo.panel);
    h.check('card descriptions ≥ 11 px (Sol: 4.29 px)', geo.desc >= 11, geo.desc);
    h.check('no visible Store text under 9.5 px', geo.smallText.length === 0, geo.smallText);
    h.check(`every one of ${geo.nTargets} controls is ≥ 24×24 px`, geo.smallTargets.length === 0, geo.smallTargets);
    h.check('one readable column, cards inside the body horizontally', geo.columns === 1 && geo.cardsOutsideX === 0 && geo.cardWidth >= 200, geo);
    h.check('the body scrolls inside the panel (content no longer spills below it)', geo.body.oy === 'auto' && geo.body.b <= geo.panel.b + 0.5 && geo.body.sh > geo.body.ch, geo.body);
    // the last card is reachable by scrolling the body and then lies inside it
    const last = await G(() => {
      const cards = document.querySelectorAll('.st-dialog .st-card');
      const c = cards[cards.length - 1];
      c.scrollIntoView({ block: 'end' });
      const r = c.getBoundingClientRect();
      const b = document.querySelector('.st-dialog .ui-modal__body').getBoundingClientRect();
      return { inside: r.bottom <= b.bottom + 1 && r.top >= b.top - 1, r: [r.top, r.bottom], b: [b.top, b.bottom] };
    });
    h.check('the last card scrolls fully into the body', last.inside, last);
    await h.shot(page, 'store-390');
    await runAxe('Store 390', '.st-dialog');
    await page.keyboard.press('Escape');
    await until('store closed', () => !document.querySelector('.st-dialog'));
    await G(() => window.__afterlife.game.updateSettings({ uiScale: 1 }));
    await page.setViewportSize({ width: 1280, height: 720 });
  }, { needs: ['A4: Escape in the first-run year field closes the gate'] });

  // ─────────────────────────────── W-118: dialogs reflow at 320 CSS px (Sol's native-Chrome retest) ───────────────────────────────
  /** Tab through the focus stops inside `scope` (Modal reveals each one); every stop's box must lie inside the viewport. */
  const focusWalk = (scope) =>
    G(async (sel) => {
      const root = document.querySelector(sel);
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const stops = Array.from(root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])')).filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
      });
      const outside = [];
      for (const e of stops) {
        e.focus(); // a real focus move: Modal's focusin brings it into view (revealFocused)
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const r = e.getBoundingClientRect();
        if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5) outside.push(`${e.tagName.toLowerCase()} "${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24)}" [${r.left.toFixed(1)}, ${r.top.toFixed(1)}, ${r.right.toFixed(1)}, ${r.bottom.toFixed(1)}]`);
      }
      return { vw, vh, stops: stops.length, outside };
    }, scope);

  await step('W-118: Settings at 400 % browser zoom (CSS 320×256) reflows; every focus stop scrolls into view', async () => {
    const cdp = await context.newCDPSession(page);
    try {
      await tap(page.locator('.sh-menu__item', { hasText: 'Settings' }));
      await until('settings open', () => window.__afterlife.game.dialog === 'settings' && !!document.querySelector('.ui-modal [role="tab"]'));
      await settle();
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 256, deviceScaleFactor: 4, mobile: false });
      await G(() => {
        Object.defineProperty(window, 'outerWidth', { configurable: true, get: () => 1280 });
        window.dispatchEvent(new Event('resize'));
      });
      await until('--ui-zoom 4', () => getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom').trim() === '4', undefined, 10_000);
      await page.waitForTimeout(400);
      const geo = await G(() => {
        const m = document.querySelector('.ui-modal').getBoundingClientRect();
        return { root: parseFloat(getComputedStyle(document.documentElement).fontSize), modal: { l: m.left, r: m.right, w: m.width }, sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth };
      });
      h.log(`    settings @400 %: ${JSON.stringify(geo)}`);
      h.check('1rem keeps its CSS px size at 400 % (WCAG 1.4.4 behaviour unchanged: 13.6 px)', Math.abs(geo.root - 13.6) < 0.05, geo.root);
      h.check('the dialog fits the 320 px CSS viewport (Sol: 549.74 px wide at x = 20.40)', geo.modal.l >= 0 && geo.modal.r <= geo.vw + 0.5 && geo.sw <= geo.vw, geo);
      const tabs = await page.locator('.ui-modal [role="tab"]').count();
      let total = 0;
      const outside = [];
      for (let i = 0; i < tabs; i++) {
        await page.locator('.ui-modal [role="tab"]').nth(i).click({ force: true });
        await page.waitForTimeout(250);
        const w = await focusWalk('.ui-modal');
        total += w.stops;
        outside.push(...w.outside.map((o) => `tab ${i}: ${o}`));
      }
      h.check(`all ${total} focus stops of all ${tabs} Settings tabs land inside the viewport`, total >= 20 && outside.length === 0, outside.slice(0, 8));
      // and with the real Tab key from the first tab (the trap's own wrap uses preventScroll)
      await page.locator('.ui-modal [role="tab"]').first().focus();
      const seen = [];
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Tab');
        await page.waitForTimeout(40);
        seen.push(await G(() => {
          const r = document.activeElement.getBoundingClientRect();
          return r.left >= -0.5 && r.top >= -0.5 && r.right <= document.documentElement.clientWidth + 0.5 && r.bottom <= document.documentElement.clientHeight + 0.5;
        }));
      }
      h.check('Tab ×30 (wrapping through the trap): the focused control is always on screen', seen.every(Boolean), seen.map((x) => (x ? 1 : 0)).join(''));
      await cdpShot(cdp, 'settings-zoom-400-reflow');
    } finally {
      await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
      await G(() => {
        delete window.outerWidth;
        window.dispatchEvent(new Event('resize'));
      });
      await cdp.detach().catch(() => {});
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.keyboard.press('Escape');
      await until('settings closed', () => window.__afterlife.game.dialog === null);
    }
  }, { needs: ['A4: Escape in the first-run year field closes the gate'] });

  await step('W-118: Store at 320×568 — Close and every focus stop inside the viewport', async () => {
    await page.setViewportSize({ width: 320, height: 568 });
    try {
      await tap(page.locator('.sh-menu__item', { hasText: 'Store' }));
      await until('store open', () => !!document.querySelector('.st-dialog .ui-modal__close'));
      await settle();
      const c = await G(() => {
        const r = document.querySelector('.st-dialog .ui-modal__close').getBoundingClientRect();
        return { l: r.left, r: r.right, t: r.top, b: r.bottom, root: parseFloat(getComputedStyle(document.documentElement).fontSize), sw: document.documentElement.scrollWidth };
      });
      h.check('Close button inside the viewport (Sol: right edge 325.86 at 320 px)', c.l >= 0 && c.r <= 320 && c.r - c.l >= 24 && c.b - c.t >= 24, c);
      h.check('compact root floor applies (≥ 10 px; was 4 px)', c.root >= 10 - 0.01, c.root);
      h.check('no horizontal page overflow', c.sw <= 320, c.sw);
      const w = await focusWalk('.st-dialog');
      h.check(`all ${w.stops} Store focus stops inside 320×568`, w.stops >= 3 && w.outside.length === 0, w.outside.slice(0, 8));
      await h.shot(page, 'store-320x568');
      await runAxe('Store 320', '.st-dialog');
    } finally {
      await page.keyboard.press('Escape');
      // Spark CI (run 43144265722, attempt 2): the Store was still open here, the failure was swallowed, and the NEXT
      // step timed out on "settings open" with focus on a Store tab. Report it where it happens, then close the
      // dialog through the game so one defect cannot fail the steps after it.
      const closed = await until('store closed', () => !document.querySelector('.st-dialog'), undefined, 10_000).then(() => true, () => false);
      h.check('Store at 320×568 closes on Escape', closed, closed ? undefined : await G(() => ({ focus: `${document.activeElement?.tagName}#${document.activeElement?.id}`, dialog: window.__afterlife.game.dialog })));
      if (!closed) {
        await G(() => window.__afterlife.game.closeDialog?.());
        await until('store closed through the game', () => !document.querySelector('.st-dialog'), undefined, 10_000).catch(() => {});
      }
      await page.setViewportSize({ width: 1280, height: 720 });
    }
  }, { needs: ['A4: Escape in the first-run year field closes the gate'] });

  // ─────────────── W-118: every shared dialog at Chrome 400 % zoom (CSS 316×232 and 320×256) ───────────────
  // Sol's native retest: a percentage max-height inside the centred modal grid fell back to the content height, so at
  // 316×232 a Close button sat at y = 254.81. The windows below are what a 1264×928 / 1280×1024 screen shows at 400 %.
  const ZOOM_SIZES = [
    { W: 1264, H: 928, z: 4, label: '316×232' },
    { W: 1280, H: 1024, z: 4, label: '320×256' },
  ];
  const setZoom = async (cdp, { W, H, z }) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: Math.round(W / z), height: Math.round(H / z), deviceScaleFactor: z, mobile: false });
    await G(({ w }) => {
      Object.defineProperty(window, 'outerWidth', { configurable: true, get: () => w });
      window.dispatchEvent(new Event('resize'));
    }, { w: W });
    await until(`--ui-zoom ${z}`, (x) => getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom').trim() === String(x), z, 10_000);
    await page.waitForTimeout(300);
  };
  const clearZoom = async (cdp) => {
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    await G(() => {
      delete window.outerWidth;
      window.dispatchEvent(new Event('resize'));
    });
    // Clearing the raw CDP override also drops Playwright's own viewport emulation, and Playwright skips a
    // setViewportSize() equal to the size it believes is current. That left the page at a stale phone-size window
    // (innerWidth 320), so every later "desktop" step ran in the phone layout (the Notices bell lives in the More menu
    // there). Force a real change, then prove the window is back.
    await page.setViewportSize({ width: 1281, height: 721 });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForFunction(() => innerWidth === 1280 && innerHeight === 720, null, { timeout: 15_000 });
  };
  /**
   * In-page audit of the TOP modal (the last [aria-modal="true"] in the DOM): its box inside the viewport, its Close
   * button on screen with every scroller of the dialog at the top, and every focus stop on screen once focused.
   */
  const auditTopDialog = () =>
    G(async () => {
      const dlg = Array.from(document.querySelectorAll('[aria-modal="true"]')).pop();
      if (!dlg) return { missing: true };
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const inside = (r) => r.width > 0 && r.height > 0 && r.left >= -0.5 && r.top >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5;
      const fmt = (r) => [r.left, r.top, r.right, r.bottom].map((v) => +v.toFixed(1));
      for (const e of [dlg, ...dlg.querySelectorAll('*')]) if (e.scrollTop) e.scrollTop = 0;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const box = dlg.getBoundingClientRect();
      const close = dlg.querySelector('.ui-modal__close, button[aria-label="Close"]');
      const cr = close ? close.getBoundingClientRect() : null;
      const hit = cr ? document.elementFromPoint(cr.left + cr.width / 2, cr.top + cr.height / 2) : null;
      const stops = Array.from(dlg.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[aria-hidden="true"]');
      });
      const outside = [];
      for (const e of stops) {
        e.focus();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const r = e.getBoundingClientRect();
        if (!inside(r)) outside.push(`${e.tagName.toLowerCase()} "${(e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)}" ${JSON.stringify(fmt(r))}`);
      }
      // back to the top, with focus on Close (or the dialog), so Escape is a plain dismissal
      for (const e of [dlg, ...dlg.querySelectorAll('*')]) if (e.scrollTop) e.scrollTop = 0;
      (close || dlg).focus();
      return {
        vw,
        vh,
        box: fmt(box),
        boxInside: inside(box),
        close: cr ? { box: fmt(cr), onScreen: inside(cr), reachable: !!hit && (hit === close || close.contains(hit)) } : null,
        stops: stops.length,
        outside,
      };
    });
  const focusId = () =>
    G(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return 'BODY';
      return a.id ? `#${a.id}` : `${a.tagName.toLowerCase()}.${String(a.className).split(' ')[0]} "${(a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 24)}"`;
    });
  /** Open a dialog from a focused opener, audit it, Escape, and check the opener has focus again. */
  const zoomDialog = async ({ name, size, focusOpener, open, isOpen, isClosed, arg, tabs = false, needClose = true }) => {
    await focusOpener();
    const opener = await focusId();
    await open();
    await until(`${name} open`, isOpen, arg, 30_000);
    await settle();
    const results = [];
    const tabCount = tabs ? await G(() => Array.from(document.querySelectorAll('[aria-modal="true"]')).pop()?.querySelectorAll('[role="tab"]').length ?? 0) : 0;
    for (let i = 0; i < Math.max(1, tabCount); i++) {
      if (tabCount) {
        await G((k) => Array.from(document.querySelectorAll('[aria-modal="true"]')).pop().querySelectorAll('[role="tab"]')[k].click(), i);
        await page.waitForTimeout(250);
      }
      results.push({ tab: i, ...(await auditTopDialog()) });
    }
    for (const r of results) {
      const tag = `[${size}] ${name}${tabCount ? ` tab ${r.tab + 1}/${tabCount}` : ''}`;
      h.check(`${tag}: the dialog fits the viewport`, !r.missing && r.boxInside, { box: r.box, vw: r.vw, vh: r.vh });
      if (needClose) h.check(`${tag}: Close is on screen and hit-testable (Sol: y = 254.81)`, !!r.close && r.close.onScreen && r.close.reachable, r.close);
      h.check(`${tag}: all ${r.stops} focus stops land on screen`, r.stops > 0 && r.outside.length === 0, r.outside.slice(0, 6));
    }
    await page.keyboard.press('Escape');
    await until(`${name} closed`, isClosed, arg, 30_000);
    await page.waitForTimeout(300);
    const back = await focusId();
    h.check(`[${size}] ${name}: Escape closes it and focus returns to the opener (${opener})`, back === opener, { opener, back });
    return results;
  };

  await step('W-118: shared dialogs at 400 % zoom (316×232, 320×256) — main menu: Settings (every tab), Store (every tab), Credits', async () => {
    const cdp = await context.newCDPSession(page);
    try {
      for (const size of ZOOM_SIZES) {
        await setZoom(cdp, size);
        for (const [label, item, dialogId, tabs] of [['Settings', 'Settings', 'settings', true], ['Store', 'Store', 'store', true], ['Credits', 'Credits', 'credits', false]]) {
          await zoomDialog({
            name: label,
            size: size.label,
            tabs,
            arg: dialogId,
            focusOpener: () => G((t) => Array.from(document.querySelectorAll('.sh-menu__item')).find((b) => (b.textContent || '').includes(t))?.focus(), item),
            open: () => page.keyboard.press('Enter'),
            isOpen: (d) => window.__afterlife.game.dialog === d && !!document.querySelector('[aria-modal="true"]'),
            isClosed: () => window.__afterlife.game.dialog === null && !document.querySelector('[aria-modal="true"]'),
          });
        }
        await cdpShot(cdp, `zoom-menu-${size.label}`);
      }
    } finally {
      await clearZoom(cdp);
      await cdp.detach().catch(() => {});
    }
  }, { needs: ['A4: Escape in the first-run year field closes the gate'] });

  // ─────────────────────────────── A6: CAZ pose bar ───────────────────────────────
  const poseAudit = () =>
    G((fnSrc) => {
      const contrast = (0, eval)(`(${fnSrc})`);
      const seg = document.querySelector('.sh-stage__poses .ui-seg');
      const thumb = seg.querySelector('.ui-seg__thumb');
      const tr = thumb ? thumb.getBoundingClientRect() : null;
      const segBg = getComputedStyle(seg).backgroundColor;
      const thumbTop = (/rgba?\([^)]*\)/.exec(getComputedStyle(thumb).backgroundImage) || [''])[0];
      return Array.from(seg.querySelectorAll('[role="radio"]')).map((o) => {
        const r = o.getBoundingClientRect();
        const checked = o.getAttribute('aria-checked') === 'true';
        const overlap = tr ? Math.max(0, Math.min(r.right, tr.right) - Math.max(r.left, tr.left)) : 0;
        const fg = getComputedStyle(o).color;
        const bg = checked ? thumbTop : segBg;
        return {
          label: o.textContent.trim() || o.getAttribute('aria-label'),
          checked,
          thumbAligned: checked ? !!tr && Math.abs(tr.left - r.left) <= 2 && Math.abs(tr.width - r.width) <= 2 : overlap <= 2,
          worst: Math.min(contrast({ fg, bg, under: 'rgb(255, 255, 255)' }), contrast({ fg, bg, under: 'rgb(0, 0, 0)' })),
        };
      });
    }, contrastInPage.toString());

  await step('A6: CAZ pose bar contrast + thumb placement', async () => {
    await tap(page.locator('.sh-menu__item', { hasText: 'New Game' }));
    await untilScreen('newGame', 60_000);
    await page.locator('.sh-lots [role="radio"]').first().waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {}); if (await page.locator('.sh-lots [role="radio"][data-lot="starter"]').count()) await tap(page.locator('.sh-lots [role="radio"][data-lot="starter"]')); // W-113: the shack is now the default; this suite needs the furnished 'starter' lot
    await tap(page.getByRole('button', { name: 'Create your household' }));
    await untilScreen('caz', 60_000);
    await until('pose bar', () => !!document.querySelector('.sh-stage__poses .ui-seg__thumb'));
    // the stage greets with a Wave and then returns to Idle: measure once the thumb has come to rest
    const thumbAtRest = () =>
      until('pose thumb at rest under the checked pose', () => {
        const seg = document.querySelector('.sh-stage__poses .ui-seg');
        const th = seg?.querySelector('.ui-seg__thumb');
        const ck = seg?.querySelector('[aria-checked="true"]');
        if (!th || !ck) return false;
        const a = th.getBoundingClientRect();
        const b = ck.getBoundingClientRect();
        const ok = Math.abs(a.left - b.left) <= 2 && Math.abs(a.width - b.width) <= 2 && document.getAnimations().every((x) => x.playState !== 'running' || x.effect?.getTiming().iterations === Infinity);
        // STABLE for 1 s under the SAME checked pose: a single aligned poll can land during the Wave greeting, just
        // before the checked pose flips back to Idle and the thumb's transition starts (CI run 42148343094).
        const key = ck.textContent;
        const w = window;
        if (!ok || w.__a6Key !== key) { w.__a6Key = ok ? key : null; w.__a6Since = performance.now(); return false; }
        return performance.now() - w.__a6Since >= 1000;
      }, undefined, 45_000);
    // The audit must see the same rest the wait saw. On a loaded machine the greeting can still flip the checked pose
    // (Wave -> Idle) between the 1 s rest and the audit (Windows verify:local at f77d720: Idle checked, thumb still
    // over Wave). Re-wait and re-audit, at most 3 times; a thumb that is really misaligned never rests aligned, so
    // thumbAtRest times out and the step still fails.
    const auditAtRest = async () => {
      let r = null;
      for (let i = 0; i < 3; i++) {
        await thumbAtRest();
        r = await poseAudit();
        if (r.every((o) => o.thumbAligned)) return r;
        h.log(`    pose bar moved after the rest wait (attempt ${i + 1}): ${JSON.stringify(r.map((o) => [o.label, o.checked, o.thumbAligned]))}`);
      }
      return r;
    };
    await settle();
    const a = await auditAtRest();
    h.log(`    poses: ${JSON.stringify(a)}`);
    h.check('the thumb sits under the checked pose only', a.every((o) => o.thumbAligned), a);
    h.check('every pose label ≥ 4.5:1 on its backplate (over white or black stage light)', a.every((o) => o.worst >= 4.5), a.map((o) => [o.label, o.worst.toFixed(2)]));
    await page.locator('.sh-stage__poses [role="radio"]').nth(2).click({ force: true });
    await until('pose 3 checked', () => document.querySelectorAll('.sh-stage__poses [role="radio"]')[2]?.getAttribute('aria-checked') === 'true');
    const b = await auditAtRest();
    h.check('after picking another pose the thumb follows the checked pose', b.every((o) => o.thumbAligned), b);
    h.check('…and the former pose ("Idle") reads ≥ 4.5:1 off the thumb', b[0].worst >= 4.5, b[0]);
    await h.shot(page, 'caz-poses');
    await runAxe('CAZ', '.sh-caz');
  }, { needs: ['boot to the first-run age gate'] });

  await step('W-118: CAZ remove-zombie confirm at 400 % zoom (316×232, 320×256)', async () => {
    const cdp = await context.newCDPSession(page);
    await G(() => window.__afterlife.game.addCazMember());
    await until('two zombies', () => window.__afterlife.game.caz.members.length === 2 && document.querySelectorAll('.sh-member__remove').length === 2);
    try {
      for (const size of ZOOM_SIZES) {
        await setZoom(cdp, size);
        await zoomDialog({
          name: 'CAZ remove-zombie confirm',
          size: size.label,
          needClose: false, // a confirmation: Cancel / Remove, no ×
          focusOpener: () => G(() => document.querySelectorAll('.sh-member__remove')[1].focus()),
          open: () => page.keyboard.press('Enter'),
          isOpen: () => !!document.querySelector('[role="alertdialog"]'),
          isClosed: () => !document.querySelector('[role="alertdialog"]'),
        });
        h.check(`[${size.label}] Escape in the confirm cancels it only (still on Create-a-Zombie, 2 zombies)`, (await G(() => window.__afterlife.game.screen === 'caz' && window.__afterlife.game.caz.members.length === 2)) === true);
        await cdpShot(cdp, `zoom-caz-${size.label}`);
      }
    } finally {
      await clearZoom(cdp);
      await cdp.detach().catch(() => {});
      await G(() => window.__afterlife.game.caz.members.length > 1 && window.__afterlife.game.removeCazMember(1));
      await until('back to one zombie', () => window.__afterlife.game.caz.members.length === 1, undefined, 15_000).catch(() => {});
    }
  }, { needs: ['A6: CAZ pose bar contrast + thumb placement'] });

  // ─────────────────────────────── in game: A5, badge, A1 ───────────────────────────────
  await step('enter game', async () => {
    if ((await G(() => window.__afterlife.game.screen)) !== 'caz') {
      await G(() => window.__afterlife.game.closeDialog?.());
      if ((await G(() => window.__afterlife.game.screen)) === 'menu') await tap(page.locator('.sh-menu__item', { hasText: 'New Game' }));
      await untilScreen('newGame', 60_000).catch(() => {});
      if ((await G(() => window.__afterlife.game.screen)) === 'newGame') { await page.locator('.sh-lots [role="radio"]').first().waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {}); if (await page.locator('.sh-lots [role="radio"][data-lot="starter"]').count()) await tap(page.locator('.sh-lots [role="radio"][data-lot="starter"]')); await tap(page.getByRole('button', { name: 'Create your household' })); }
      await untilScreen('caz', 60_000);
    }
    await until('caz valid', () => window.__afterlife.game.validateCaz().length === 0, undefined, 30_000);
    await tap(page.locator('.sh-editor__start'));
    await untilScreen('game', 300_000);
    await until('HUD', () => window.__afterlife.game.renderer.loadProgress() >= 1 && !!document.querySelector('.hud-funds'), undefined, 180_000);
    for (let i = 0; i < 6; i++) {
      const id = await G(() => window.__afterlife.game.hint?.id ?? null);
      if (!id) break;
      await G((x) => window.__afterlife.game.dismissHint(x, true), id); // tutorial tips are not under test here
      await page.waitForTimeout(200);
    }
  }, { needs: ['boot to the first-run age gate'] });

  await step('A5 + A6: queue list semantics, Notices badge contrast and name', async () => {
    await until('queue list', () => !!document.querySelector('.hud-queue__list'), undefined, 30_000);
    const q = await G(() => {
      const ol = document.querySelector('.hud-queue__list');
      return { tag: ol.tagName, orient: ol.getAttribute('aria-orientation'), role: ol.getAttribute('role') };
    });
    h.check('action queue is a native <ol> without aria-orientation', q.tag === 'OL' && q.orient === null && q.role === null, q);
    // the real badge CSS, rendered in place next to the bell (independent of whether a notice is unread right now)
    const badge = await G((fnSrc) => {
      const contrast = (0, eval)(`(${fnSrc})`);
      const host = document.querySelector('.hud-sys');
      const s = document.createElement('span');
      s.className = 'ui-badge ui-badge--danger ui-badge--solid ui-badge--count';
      s.textContent = '1';
      host.appendChild(s);
      const cs = getComputedStyle(s);
      const out = { fg: cs.color, bg: cs.backgroundColor, fs: parseFloat(cs.fontSize), ratio: contrast({ fg: cs.color, bg: cs.backgroundColor, under: 'rgb(0, 0, 0)' }) };
      s.remove();
      const bell = Array.from(document.querySelectorAll('.hud-sys button')).find((b) => (b.getAttribute('aria-label') || '').startsWith('Notices'));
      const vis = bell?.querySelector('.ui-iconbtn__badge');
      out.bell = bell ? { label: bell.getAttribute('aria-label'), badgeHidden: vis ? vis.getAttribute('aria-hidden') : 'none', badgeText: vis ? vis.textContent : null } : null;
      // diagnostics when the bell is missing: which system buttons exist, and the layout state
      out.sys = Array.from(document.querySelectorAll('.hud-sys button')).map((b) => b.getAttribute('aria-label'));
      out.layout = { phone: document.documentElement.hasAttribute('data-phone'), vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, zoom: getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom').trim(), tier: document.querySelector('.hud')?.getAttribute('data-tier') };
      return out;
    }, contrastInPage.toString());
    h.check('Notices badge ≥ 4.5:1 as rendered (Sol: 4.34:1)', badge.ratio >= 4.5, badge);
    h.check('the bell’s name carries the unread count; the badge is hidden from AT', !!badge.bell && (badge.bell.badgeHidden === 'none' || (badge.bell.badgeHidden === 'true' && badge.bell.label.includes(String(badge.bell.badgeText).replace('+', '')))), badge.bell ?? { sys: badge.sys, layout: badge.layout });
  }, { needs: ['enter game'] });

  await step('Escape closes the top layer only; focus returns to the opener', async () => {
    const active = () =>
      G(() => {
        const a = document.activeElement;
        return a ? { id: a.id, cls: String(a.className), text: (a.textContent || '').trim().slice(0, 40), label: a.getAttribute('aria-label') } : null;
      });
    const dlg = () => G(() => window.__afterlife.game.dialog);
    const tabTo = async (re) => {
      for (let i = 0; i < 20; i++) {
        const a = await active();
        if (a && new RegExp(re).test(a.text)) return true;
        await page.keyboard.press('Tab');
      }
      return false;
    };
    // tutorial tips are a HUD layer that claims Esc first by design (they pop up at any time): dismiss before each Esc
    // that is meant for the game, as the main flow does (clearHints)
    const clearHints = async () => {
      for (let i = 0; i < 6; i++) {
        const id = await G(() => window.__afterlife.game.hint?.id ?? null);
        if (!id) return;
        await G((x) => window.__afterlife.game.dismissHint(x, true), id);
        await until('tip gone', () => !document.querySelector('.hud-hint-bubble'), undefined, 20_000);
      }
    };
    await clearHints();
    await G(() => document.getElementById('game-canvas').focus());
    // 1. Pause -> Settings (child replaces its parent) -> Esc -> Pause, focused on Settings -> Esc -> canvas
    await page.keyboard.press('Escape');
    await until('pause open', () => window.__afterlife.game.dialog === 'pause' && !!document.querySelector('.sh-pause'));
    await settle();
    h.check('Pause opens on Resume', /sh-pause__item/.test((await active())?.cls ?? '') && /Resume/.test((await active())?.text ?? ''), await active());
    h.require('Tab reaches Pause > Settings', await tabTo('^Settings'));
    await page.keyboard.press('Enter');
    await until('settings open', () => window.__afterlife.game.dialog === 'settings');
    await page.keyboard.press('Escape');
    await until('back to pause', () => window.__afterlife.game.dialog === 'pause' && !!document.querySelector('.sh-pause'));
    await settle();
    const back = await active();
    h.check('Esc in Settings closes Settings only (Pause stays)', (await dlg()) === 'pause');
    h.check('focus returns to Pause > Settings, not Resume', /sh-pause__item/.test(back?.cls ?? '') && /^Settings/.test(back?.text ?? ''), back);
    await page.keyboard.press('Escape');
    await until('pause closed', () => window.__afterlife.game.dialog === null && !document.querySelector('.sh-pause'));
    const after = await active();
    h.check('closing Pause hands focus back to the game canvas (not <body>)', after?.id === 'game-canvas', after);
    // 2. a confirmation inside Pause: Esc closes the confirmation only, focus back on its button
    await clearHints();
    await page.keyboard.press('Escape');
    await until('pause open again', () => window.__afterlife.game.dialog === 'pause' && !!document.querySelector('.sh-pause'));
    await settle();
    h.check('a fresh Pause opens on Resume again', /Resume/.test((await active())?.text ?? ''), await active());
    h.require('Tab reaches Pause > Main Menu', await tabTo('^Main Menu'));
    await page.keyboard.press('Enter');
    await until('confirm open', () => !!document.querySelector('[role="alertdialog"]'));
    await page.keyboard.press('Escape');
    await until('confirm closed', () => !document.querySelector('[role="alertdialog"]'));
    h.check('Esc in the confirmation keeps Pause open and the game running', (await dlg()) === 'pause' && (await G(() => window.__afterlife.game.screen)) === 'game');
    h.check('focus returns to Pause > Main Menu', /^Main Menu/.test((await active())?.text ?? ''), await active());
    await page.keyboard.press('Escape');
    await until('pause closed again', () => window.__afterlife.game.dialog === null && !document.querySelector('.sh-pause'));
    // 3. a HUD layer (notification drawer) under a shell dialog: Esc closes the dialog, then the drawer
    await clearHints();
    await tap(page.locator('.hud-sys button[aria-label^="Notices"]'));
    await until('notice drawer open', () => !!document.querySelector('.hud-log'));
    await G(() => window.__afterlife.game.openDialog('help')); // F10's own action; the routing of Esc is under test
    await until('help open over the drawer', () => window.__afterlife.game.dialog === 'help' && !!document.querySelector('.ui-modal'));
    await page.keyboard.press('Escape');
    // state first, then the DOM: the UI re-renders on its next animation frame (seconds apart under SwiftShader)
    await until('help closed', () => window.__afterlife.game.dialog === null && !document.querySelector('.ui-modal'), undefined, 20_000);
    h.check('Esc closed Help, not the drawer underneath', !!(await G(() => document.querySelector('.hud-log'))));
    await clearHints();
    await page.waitForTimeout(400); // past the HUD's double-Esc grace window: the next Esc is a fresh press
    await page.keyboard.press('Escape');
    await until('drawer closed', () => !document.querySelector('.hud-log'), undefined, 20_000);
    h.check('the next Esc closes the drawer, and opens nothing else', (await dlg()) === null);
    await G(() => document.activeElement?.blur?.());
  }, { needs: ['enter game'] });

  await step('A1: Buy mode with the keyboard alone (select → move → place → refuse → rotate → cancel)', async () => {
    const funds = () => G(() => window.__afterlife.game.sim.state.household.funds);
    const objects = () => G(() => Object.keys(window.__afterlife.game.sim.state.objects).length);
    const live = () => G(() => document.querySelector('[data-testid="placement-live"]')?.textContent ?? '');
    const focusIn = (sel) => G((s) => !!document.activeElement?.closest(s), sel);
    await G(() => document.activeElement?.blur?.());
    await page.keyboard.press('KeyB');
    await until('buy mode', () => window.__afterlife.game.mode === 'buy' && !!document.querySelector('.hud-buy'));
    for (let i = 0; i < 12 && !(await focusIn('.hud-buy')); i++) await page.keyboard.press('F6');
    h.require('F6 reaches the Buy catalog', await focusIn('.hud-buy'));
    for (let i = 0; i < 30 && !(await G(() => document.activeElement?.matches('.hud-buy__search input'))); i++) await page.keyboard.press('Tab');
    h.require('Tab reaches the catalog search', await G(() => document.activeElement?.matches('.hud-buy__search input')));
    await page.keyboard.type('fern');
    await until('search results', () => document.querySelectorAll('.hud-buy__grid .hud-item').length > 0);
    for (let i = 0; i < 8 && !(await G(() => document.activeElement?.classList.contains('hud-item'))); i++) await page.keyboard.press('Tab');
    h.require('Tab reaches a catalog card', await G(() => document.activeElement?.classList.contains('hud-item')));
    const card = await G(() => ({ name: document.activeElement.getAttribute('aria-label'), desc: document.activeElement.getAttribute('aria-describedby') }));
    await page.keyboard.press('Enter');
    await until('placing', () => !!window.__afterlife.game.buy.placingDefId);
    const defId = await G(() => window.__afterlife.game.buy.placingDefId);
    const price = await G((d) => window.__afterlife.game.sim.content.objects[d].price, defId);
    h.check('Enter on the card starts placing and hands focus to the world', await G(() => document.activeElement?.id === 'game-canvas'), card);
    await until('start announced', () => /Placing .+Arrow keys move it/.test(document.querySelector('[data-testid="placement-live"]')?.textContent ?? ''), undefined, 10_000);
    h.check('the live region announced the keyboard instructions', true, await live());
    await page.keyboard.press('ArrowUp');
    await until('position announced', () => /at tile \d+, \d+/.test(document.querySelector('[data-testid="placement-live"]')?.textContent ?? ''), undefined, 10_000);
    // walk a spiral until the announcement says the spot is free
    const dirs = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    let ok = /Can place here/.test(await live());
    for (let leg = 0, n = 0; !ok && n < 60; leg++) {
      for (let s = 0; s < Math.floor(leg / 2) + 1 && !ok && n < 60; s++, n++) {
        await page.keyboard.press(dirs[leg % 4]);
        await page.waitForTimeout(60);
        ok = /Can place here/.test(await live());
      }
    }
    h.require('arrow keys found a free tile (announced "Can place here")', ok, await live());
    const f0 = await funds();
    const o0 = await objects();
    // W-116 (D-062): Enter places one and returns to the catalog; Shift+Enter places and keeps placing — used here so
    // the refusal / rotate / Esc checks below run on the same placement
    await page.keyboard.press('Shift+Enter');
    await until('placed', (f) => window.__afterlife.game.sim.state.household.funds < f, f0, 15_000);
    h.check('Shift+Enter kept placing (W-116)', !!(await G(() => window.__afterlife.game.buy.placingDefId)));
    h.check('Enter placed it: funds − price, one more object (Sol repro: 1→1, 6,500→6,500)', (await funds()) === f0 - price && (await objects()) === o0 + 1, { f0, f1: await funds(), price });
    await until('placed announced', () => /^Placed /.test(document.querySelector('[data-testid="placement-live"]')?.textContent ?? ''), undefined, 10_000);
    h.check('placement announced', true, await live());
    const f1 = await funds();
    await page.keyboard.press('Enter'); // same tile, now occupied
    await until('refusal announced', () => /Can't place here/.test(document.querySelector('[data-testid="placement-live"]')?.textContent ?? ''), undefined, 10_000);
    h.check('an occupied spot is refused with a spoken reason, nothing charged', (await funds()) === f1, await live());
    await page.keyboard.press('KeyR');
    await until('rotation announced', () => /Rotated to 90 degrees/.test(document.querySelector('[data-testid="placement-live"]')?.textContent ?? ''), undefined, 10_000);
    h.check('R rotates (announced)', (await G(() => window.__afterlife.game.buy.rot)) === 1);
    await runAxe('Buy catalog', '.hud-buy');
    await h.shot(page, 'buy-keyboard');
    await page.keyboard.press('Escape');
    await until('cancelled', () => window.__afterlife.game.buy.placingDefId === null, undefined, 10_000);
    // the HUD re-renders on its next animation frame (seconds apart under SwiftShader): wait for the DOM, not just state
    await until('cancel announced', () => /Stopped placing/.test(document.querySelector('[data-testid="placement-live"]')?.textContent ?? ''), undefined, 15_000);
    h.check('Esc cancels and says so', true, await live());
    await page.keyboard.press('Control+KeyZ');
    await until('undo refund', (f) => window.__afterlife.game.sim.state.household.funds === f, f0, 15_000);
    h.check('Ctrl+Z refunds the keyboard purchase', true);
  }, { needs: ['enter game'] });

  // ─────────────────────────────── W-118 in game ───────────────────────────────
  await step('W-118: Buy catalog — every category’s cards: accessible name contains the visible text (axe)', async () => {
    await G(() => document.activeElement?.blur?.());
    if ((await G(() => window.__afterlife.game.mode)) !== 'buy') {
      await page.keyboard.press('KeyB');
      await until('buy mode', () => window.__afterlife.game.mode === 'buy' && !!document.querySelector('.hud-buy'));
    }
    // a search narrows the grid (the old CI scan only ever saw "fern"): clear it
    await G(() => {
      const i = document.querySelector('.hud-buy__search input');
      if (i && i.value) {
        i.value = '';
        i.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await until('category tabs', () => document.querySelectorAll('.hud-cats [role="tab"]').length > 0 && !document.querySelector('.hud-buy__results'));
    const n = await page.locator('.hud-cats [role="tab"]').count();
    const seen = [];
    for (let i = 0; i < n; i++) {
      // a DOM click on the tab itself: the rail scrolls sideways and the active tab widens (its label shows), so a
      // coordinate click computed before the re-render can land on the previous tab
      await G((k) => {
        const t = document.querySelectorAll('.hud-cats [role="tab"]')[k];
        t?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        t?.click();
      }, i);
      // the HUD re-renders on its next animation frame: seconds apart under SwiftShader while axe runs (README: timing)
      await until(`category ${i} selected`, (k) => document.querySelectorAll('.hud-cats [role="tab"]')[k]?.getAttribute('aria-selected') === 'true', i, 90_000);
      await until(`category ${i} grid`, () => document.querySelectorAll('.hud-buy__grid .hud-item').length > 0, undefined, 60_000);
      await page.waitForTimeout(200);
      const cards = await G(() =>
        Array.from(document.querySelectorAll('.hud-buy__grid .hud-item')).map((b) => ({
          label: b.getAttribute('aria-label'),
          text: (b.textContent || '').replace(/\s+/g, ' ').trim(),
        })),
      );
      const cat = await G((k) => document.querySelectorAll('.hud-cats [role="tab"]')[k]?.getAttribute('aria-label') || document.querySelectorAll('.hud-cats [role="tab"]')[k]?.textContent, i);
      seen.push(`${cat}: ${cards.length}`);
      h.check(`[${cat}] no catalog card overrides its name with aria-label (${cards.length} cards)`, cards.length > 0 && cards.every((c) => c.label === null), cards.filter((c) => c.label !== null).slice(0, 3));
      await runAxe(`Buy ${cat}`, '.hud-buy');
    }
    h.log(`    categories: ${seen.join(', ')}`);
    h.check('every Buy category was scanned (Seating included)', n >= 5 && seen.some((s) => /seat/i.test(s)), seen);
    if (axe) {
      // negative control: the scan catches an aria-label that leaves out visible text (Sol's Seating failure)
      const caught = await G(async () => {
        const b = document.querySelector('.hud-buy__grid .hud-item');
        b.setAttribute('aria-label', 'Something else entirely');
        const r = await window.axe.run(b, { runOnly: ['label-content-name-mismatch'] });
        b.removeAttribute('aria-label');
        return r.violations.length > 0;
      });
      h.check('negative control: axe flags a card whose aria-label omits its visible text', caught);
    }
    await page.keyboard.press('KeyB'); // back to live
    await until('live mode', () => window.__afterlife.game.mode === 'live', undefined, 15_000).catch(() => G(() => window.__afterlife.game.setMode('live')));
  }, { needs: ['enter game'] });

  await step('W-118: F6 to the world focuses the canvas; Pause → Settings → Esc → Esc returns focus to the canvas', async () => {
    const clearHints = async () => {
      for (let i = 0; i < 6; i++) {
        const id = await G(() => window.__afterlife.game.hint?.id ?? null);
        if (!id) return;
        await G((x) => window.__afterlife.game.dismissHint(x, true), id);
        await until('tip gone', () => !document.querySelector('.hud-hint-bubble'), undefined, 20_000);
      }
    };
    await clearHints();
    // Sol's route: NO explicit canvas focus. Start from a HUD control reached by F6, then F6 on round to the world stop.
    await G(() => document.activeElement?.blur?.());
    h.check('start: focus on <body>', await G(() => document.activeElement === document.body));
    let atWorld = false;
    for (let i = 0; i < 16 && !atWorld; i++) {
      await page.keyboard.press('F6');
      await page.waitForTimeout(80);
      const a = await G(() => (document.activeElement === document.body ? 'BODY' : document.activeElement?.id || document.activeElement?.tagName));
      if (i > 0 && (a === 'game-canvas' || a === 'BODY')) {
        atWorld = true;
        h.check('F6’s world stop focuses the canvas, not <body> (Sol: BODY)', a === 'game-canvas', a);
      }
    }
    h.require('F6 cycled round to the world stop', atWorld);
    await clearHints();
    await page.keyboard.press('Escape');
    await until('pause open', () => window.__afterlife.game.dialog === 'pause' && !!document.querySelector('.sh-pause'));
    await settle();
    let ok = false;
    for (let i = 0; i < 20 && !ok; i++) {
      ok = await G(() => /^Settings/.test((document.activeElement?.textContent || '').trim()));
      if (!ok) await page.keyboard.press('Tab');
    }
    h.require('Tab reaches Pause > Settings', ok);
    await page.keyboard.press('Enter');
    await until('settings open', () => window.__afterlife.game.dialog === 'settings');
    await page.keyboard.press('Escape');
    await until('back to pause', () => window.__afterlife.game.dialog === 'pause' && !!document.querySelector('.sh-pause'));
    await settle();
    h.check('Esc from Settings returns to Pause with focus on its Settings item', await G(() => /^Settings/.test((document.activeElement?.textContent || '').trim())));
    await page.keyboard.press('Escape');
    await until('pause closed', () => window.__afterlife.game.dialog === null && !document.querySelector('.sh-pause'));
    await page.waitForTimeout(1200); // Sol measured after 1.2 s
    const after = await G(() => (document.activeElement === document.body ? 'BODY' : document.activeElement?.id || document.activeElement?.tagName));
    h.check('1.2 s after Pause closes, focus is on the game canvas (Sol: BODY)', after === 'game-canvas', after);
  }, { needs: ['enter game'] });

  await step('W-118: compact windows — readable root, every HUD control ≥ 24×24, nothing off-screen (mouse pointer)', async () => {
    await G(() => window.__afterlife.game.setSpeed(0));
    await G(() => window.__afterlife.game.updateSettings({ uiScale: 1.4 }));
    await until('scale 1.4', () => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim() === '1.4');
    const rows = [];
    try {
      for (const [w, hgt] of [[390, 844], [844, 390], [360, 640], [320, 480], [280, 653], [2000, 300], [1280, 720]]) {
        await page.setViewportSize({ width: w, height: hgt });
        for (const mode of ['live', 'buy']) {
          await G((m) => {
            const g = window.__afterlife.game;
            if (g.hint) g.dismissHint(g.hint.id, true);
            if (g.mode !== m) g.setMode(m);
          }, mode);
          await until(`${mode} HUD`, (m) => window.__afterlife.game.mode === m && !!document.querySelector(m === 'buy' ? '.hud-buy' : '.hud-agent'), mode, 30_000);
          await page.waitForTimeout(700);
          await settle();
          const m = await G(() => {
            const vw = document.documentElement.clientWidth;
            const vh = document.documentElement.clientHeight;
            const vis = (el) => {
              const r = el.getBoundingClientRect();
              if (r.width <= 1 || r.height <= 1) return false;
              for (let e = el; e; e = e.parentElement) {
                const cs = getComputedStyle(e);
                if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
              }
              return true;
            };
            const sel = 'button, [role="button"], [role="tab"], [role="radio"], [role^="menuitem"], [role="switch"], [role="checkbox"], a[href], input, select, summary';
            const small = [];
            const off = [];
            let n = 0;
            for (const e of document.querySelectorAll(`.hud ${sel}, .st-hud ${sel}`)) {
              if (!vis(e) || e.closest('[aria-hidden="true"]') || getComputedStyle(e).pointerEvents === 'none') continue;
              const r = e.getBoundingClientRect();
              // the part of the box that a scrolling ancestor shows (rail / grid items scrolled out are reachable by scrolling)
              let cl = { l: 0, t: 0, r: vw, b: vh };
              for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
                const cs = getComputedStyle(p);
                if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
                  const pr = p.getBoundingClientRect();
                  cl = { l: Math.max(cl.l, pr.left), t: Math.max(cl.t, pr.top), r: Math.min(cl.r, pr.right), b: Math.min(cl.b, pr.bottom) };
                }
              }
              const shown = r.right > cl.l + 1 && r.left < cl.r - 1 && r.bottom > cl.t + 1 && r.top < cl.b - 1;
              if (!shown) continue; // scrolled out of its scroller
              n++;
              const d = `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} "${(e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)}"`;
              if (r.width < 23.5 || r.height < 23.5) small.push(`${d} ${r.width.toFixed(1)}×${r.height.toFixed(1)}`);
              // a control the PAGE clips: outside the viewport and not inside a scroller that could bring it in
              const inScroller = cl.l > 0.5 || cl.t > 0.5 || cl.r < vw - 0.5 || cl.b < vh - 0.5;
              if (!inScroller && (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1)) off.push(`${d} [${r.left.toFixed(0)}, ${r.top.toFixed(0)}, ${r.right.toFixed(0)}, ${r.bottom.toFixed(0)}]`);
            }
            const sizes = Array.from(document.querySelectorAll(`.hud ${sel}`)).filter(vis).map((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); });
            return { vw, vh, root: parseFloat(getComputedStyle(document.documentElement).fontSize), phone: document.documentElement.hasAttribute('data-phone'), n, small, off, minSide: sizes.length ? Math.min(...sizes) : null, sw: document.documentElement.scrollWidth };
          });
          rows.push({ vp: `${w}x${hgt}`, mode, root: m.root, phone: m.phone, controls: m.n, minSide: m.minSide && +m.minSide.toFixed(1) });
          const compact = w < 800 || hgt < 450;
          // theme/scale.ts: 10 px × 1.4, capped at 4vw (never under 10 px) below 350 px wide
          const want = Math.min(14, Math.max(10, 0.04 * w));
          if (compact) h.check(`[${w}×${hgt} ${mode}] root = ${want.toFixed(1)} px at 140 % (Sol: 4.875 px) and the compact HUD is on`, Math.abs(m.root - want) < 0.05 && m.phone, { root: m.root, phone: m.phone });
          // compact windows: every control ≥ 24×24 outright. The desktop HUD is out of W-118's scope (its sizing must not
          // change): there WCAG 2.5.8's spacing exception applies and axe's target-size rule (below) is the check.
          if (compact) h.check(`[${w}×${hgt} ${mode}] every one of ${m.n} visible HUD controls ≥ 24×24`, m.n > 0 && m.small.length === 0, m.small.slice(0, 6));
          else h.log(`    [${w}×${hgt} ${mode}] desktop controls under 24 px (spacing exception; axe decides): ${JSON.stringify(m.small)}`);
          h.check(`[${w}×${hgt} ${mode}] no control clipped off-screen, no page overflow`, m.off.length === 0 && m.sw <= w, { off: m.off.slice(0, 6), sw: m.sw });
          await runAxe(`HUD ${w}x${hgt} ${mode}`, '.hud');
          if (compact && mode === 'live') {
            // a long toast (Sol's run: the storage warning covered the agent panel at 320×480). Pushed through the
            // controller's toast centre (test-only reach into the core; the HUD renders it like any sim notice).
            const pushed = await G(() => {
              const g = window.__afterlife.game;
              const tc = g.c?.toastCenter;
              if (!tc) return false;
              tc.push({ kind: 'warning', title: 'W-118 probe: a long notice', text: 'This browser did not grant persistent storage, so it may delete saves when space runs low. Use Export in the Load menu to keep a copy of your save.' });
              g.c.notifier?.notifyNow?.();
              return true;
            });
            if (pushed) {
              await until('probe toast', () => Array.from(document.querySelectorAll('.hud-toast')).some((t) => /W-118 probe/.test(t.textContent || '')), undefined, 30_000);
              await page.waitForTimeout(400);
              const t = await G(() => {
                const list = document.querySelector('.hud-toasts').getBoundingClientRect();
                const agent = document.querySelector('.hud-agent')?.getBoundingClientRect();
                const orient = document.querySelector('.hud')?.getAttribute('data-orient');
                const ov = agent ? Math.max(0, Math.min(list.right, agent.right) - Math.max(list.left, agent.left)) * Math.max(0, Math.min(list.bottom, agent.bottom) - Math.max(list.top, agent.top)) : 0;
                return { orient, list: [list.left, list.top, list.right, list.bottom].map(Math.round), agent: agent ? [agent.left, agent.top, agent.right, agent.bottom].map(Math.round) : null, overlap: Math.round(ov), shown: Math.round(list.height) };
              });
              h.check(`[${w}×${hgt}] a toast never covers the agent panel (and stays readable: ≥ 40 px shown, scrolls for the rest)`, t.overlap === 0 && t.shown >= 40, t);
              await h.shot(page, `w118-${w}x${hgt}-toast`);
              await G(() => {
                const g = window.__afterlife.game;
                for (const x of g.toasts) g.dismissToast(x.id);
              });
            } else h.log('    (toast centre not reachable: toast overlap not measured)');
          }
          await h.shot(page, `w118-${w}x${hgt}-${mode}`);
        }
      }
    } finally {
      h.log(`    ${rows.map((r) => `${r.vp} ${r.mode}: root ${r.root} px, ${r.controls} controls, smallest side ${r.minSide} px${r.phone ? ' (compact)' : ''}`).join('\n    ')}`);
      await G(() => window.__afterlife.game.setMode('live'));
      await G(() => window.__afterlife.game.updateSettings({ uiScale: 1 }));
      await page.setViewportSize({ width: 1280, height: 720 });
    }
  }, { needs: ['enter game'] });

  await step('W-118: shared dialogs at 400 % zoom (316×232, 320×256) — in game: Pause and its children, session log, confirm, HUD dialogs, Feedback, Store', async () => {
    const cdp = await context.newCDPSession(page);
    const clearTips = async () => {
      for (let i = 0; i < 6; i++) {
        const id = await G(() => window.__afterlife.game.hint?.id ?? null);
        if (!id) return;
        await G((x) => window.__afterlife.game.dismissHint(x, true), id);
        await page.waitForTimeout(150);
      }
    };
    const canvasFocus = () => G(() => document.getElementById('game-canvas').focus());
    const pauseItem = (t) => () => G((x) => Array.from(document.querySelectorAll('.sh-pause__item')).find((b) => (b.textContent || '').trim().startsWith(x))?.focus(), t);
    const hasItem = (t) => G((x) => Array.from(document.querySelectorAll('.sh-pause__item')).some((b) => (b.textContent || '').trim().startsWith(x)), t);
    /** One dialog's failure is recorded and the run moves on to the next dialog. */
    const guarded = async (label, fn) => {
      try {
        await fn();
      } catch (e) {
        h.check(`${label}: audited without error`, false, String(e && e.message ? e.message : e).split('\n')[0]);
        await G(() => {
          for (let i = 0; i < 4 && window.__afterlife.game.dialog; i++) window.__afterlife.game.closeDialog();
        });
      }
    };
    await G(() => window.__afterlife.game.setSpeed(0));
    try {
      for (const size of ZOOM_SIZES) {
        await setZoom(cdp, size);
        await clearTips();
        // Pause, opened from the world by Escape
        await guarded(`[${size.label}] Pause`, () =>
          zoomDialog({
            name: 'Pause',
            size: size.label,
            needClose: false, // Pause closes by Resume / Esc (no ×)
            focusOpener: canvasFocus,
            open: () => page.keyboard.press('Escape'),
            isOpen: () => window.__afterlife.game.dialog === 'pause' && !!document.querySelector('.sh-pause'),
            isClosed: () => window.__afterlife.game.dialog === null && !document.querySelector('[aria-modal="true"]'),
          }),
        );
        // Pause's children, each from its Pause item; Escape returns to Pause with that item focused
        await clearTips();
        await canvasFocus();
        await page.keyboard.press('Escape');
        await until('pause open', () => window.__afterlife.game.dialog === 'pause' && !!document.querySelector('.sh-pause'));
        await settle();
        for (const [item, dialogId, tabs] of [['Save Game', 'saveLoad', false], ['Load Game', 'saveLoad', false], ['Settings', 'settings', true], ['Help', 'help', false]]) {
          await guarded(`[${size.label}] ${item}`, () =>
            zoomDialog({
              name: `Pause › ${item}`,
              size: size.label,
              tabs,
              arg: dialogId,
              focusOpener: pauseItem(item),
              open: () => page.keyboard.press('Enter'),
              isOpen: (d) => window.__afterlife.game.dialog === d && !document.querySelector('.sh-pause') && !!document.querySelector('[aria-modal="true"]'),
              isClosed: () => window.__afterlife.game.dialog === 'pause' && !!document.querySelector('.sh-pause'),
            }),
          );
        }
        // the session log (a modal over Pause) and the Main Menu confirmation (an alertdialog over Pause)
        if (await hasItem('Copy session log')) {
          await guarded(`[${size.label}] session log`, () =>
            zoomDialog({
              name: 'Pause › Copy session log',
              size: size.label,
              focusOpener: pauseItem('Copy session log'),
              open: () => page.keyboard.press('Enter'),
              isOpen: () => document.querySelectorAll('[aria-modal="true"]').length >= 2,
              isClosed: () => document.querySelectorAll('[aria-modal="true"]').length === 1 && window.__afterlife.game.dialog === 'pause',
            }),
          );
        } else h.check(`[${size.label}] the session log entry exists in Pause`, false, 'no "Copy session log" item');
        await guarded(`[${size.label}] Main Menu confirm`, () =>
          zoomDialog({
            name: 'Pause › Main Menu confirmation',
            size: size.label,
            needClose: false,
            focusOpener: pauseItem('Main Menu'),
            open: () => page.keyboard.press('Enter'),
            isOpen: () => !!document.querySelector('[role="alertdialog"]'),
            isClosed: () => !document.querySelector('[role="alertdialog"]') && window.__afterlife.game.dialog === 'pause',
          }),
        );
        await page.keyboard.press('Escape');
        await until('pause closed', () => window.__afterlife.game.dialog === null && !document.querySelector('[aria-modal="true"]'), undefined, 20_000);
        // HUD dialogs (Careers / jobs, Household, Phone, Rewards, Invite) and the Store, over the world
        for (const d of ['careers', 'household', 'phone', 'rewards', 'invite', 'store']) {
          await clearTips();
          await guarded(`[${size.label}] ${d}`, () =>
            zoomDialog({
              name: d,
              size: size.label,
              tabs: d === 'store',
              arg: d,
              focusOpener: canvasFocus,
              open: () => G((x) => window.__afterlife.game.openDialog(x), d),
              isOpen: (x) => window.__afterlife.game.dialog === x && !!document.querySelector('[aria-modal="true"]'),
              isClosed: () => window.__afterlife.game.dialog === null && !document.querySelector('[aria-modal="true"]'),
            }),
          );
        }
        // Report a bug: F8 from the world (captures the screenshot, then opens the dialog)
        if (await G(() => !!window.__afterlife.game.feedback)) {
          await clearTips();
          await guarded(`[${size.label}] feedback`, () =>
            zoomDialog({
              name: 'Report a bug (F8)',
              size: size.label,
              focusOpener: canvasFocus,
              open: () => page.keyboard.press('F8'),
              isOpen: () => window.__afterlife.game.dialog === 'feedback' && !!document.querySelector('[aria-modal="true"]'),
              isClosed: () => window.__afterlife.game.dialog === null && !document.querySelector('[aria-modal="true"]'),
            }),
          );
        }
        await cdpShot(cdp, `zoom-game-${size.label}`);
      }
    } finally {
      await clearZoom(cdp);
      await cdp.detach().catch(() => {});
      await G(() => {
        for (let i = 0; i < 4 && window.__afterlife.game.dialog; i++) window.__afterlife.game.closeDialog();
      });
    }
  }, { needs: ['enter game'] });

  await step('W-118: desktop root px identical to the pre-W-118 formula (4 windows × 3 scales × zoom 1 / 2)', async () => {
    const cdp = await context.newCDPSession(page);
    const bad = [];
    let n = 0;
    try {
      for (const s of [0.8, 1, 1.4]) {
        await G((x) => window.__afterlife.game.updateSettings({ uiScale: x }), s);
        await until(`scale ${s}`, (x) => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim() === String(x), s);
        for (const [W, H] of [[1280, 720], [1920, 1080], [2560, 1440], [800, 600]]) {
          for (const z of [1, 2]) {
            await cdp.send('Emulation.setDeviceMetricsOverride', { width: Math.round(W / z), height: Math.round(H / z), deviceScaleFactor: z, mobile: false });
            await G(({ w }) => {
              Object.defineProperty(window, 'outerWidth', { configurable: true, get: () => w });
              window.dispatchEvent(new Event('resize'));
            }, { w: W });
            await until(`zoom ${z}`, (x) => getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom').trim() === String(x), z, 10_000);
            const got = await G(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
            // the pre-W-118 formula, on the CSS viewport the page sees
            const w = Math.round(W / z);
            const hh = Math.round(H / z);
            const want = Math.min((8.8 + z * Math.min((0.6667 * hh) / 100, (0.375 * w) / 100)) * s, (z * 1.25 * w) / 100, (z * 2.2223 * hh) / 100);
            n++;
            if (Math.abs(got - want) > 0.02) bad.push({ W, H, s, z, got, want });
          }
        }
      }
    } finally {
      await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
      await G(() => {
        delete window.outerWidth;
        window.dispatchEvent(new Event('resize'));
      });
      await cdp.detach().catch(() => {});
      await G(() => window.__afterlife.game.updateSettings({ uiScale: 1 }));
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    h.check(`${n} desktop measurements match the pre-W-118 root size (±0.02 px)`, n === 24 && bad.length === 0, bad);
  }, { needs: ['enter game'] });

  await context.close();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code));
}
