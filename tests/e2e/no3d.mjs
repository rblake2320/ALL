/**
 * The 3D view cannot start (W-149, docs/DESIGN_OPEN_WORLD.md §5.1; acceptance OW-20).
 *
 *   node tests/e2e/no3d.mjs [--dist=<dir>] [--no-build] [--out=dev/out/no3d]
 *
 * Real Chromium with WebGL switched off (`--disable-gpu --disable-webgl --disable-webgl2`), which is what a player on
 * a machine without a usable GPU gets since Chrome removed the automatic software fallback. The game must show the
 * dedicated screen — what is wrong, three things to try, Try again — not the generic crash screen, at 1280×720 and at
 * 390×844, with keyboard focus on the button, nothing cut off, no page error, and no axe violation.
 * Exit 0 = pass, 1 = fail.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
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
const OUT = path.resolve(ROOT, opt('out', 'dev/out/no3d'));
const log = (s) => console.log(s);
const checks = [];
const check = (name, ok, detail = '') => {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  checks.push({ name, ok: !!ok, detail: d });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${d ? ` — ${d}` : ''}`);
};

function loadAxe() {
  const candidates = [process.env.AXE_CORE];
  try {
    candidates.push(require.resolve('axe-core/axe.min.js'));
  } catch {
    /* not installed */
  }
  for (const c of candidates) if (c && existsSync(c)) return { path: c, source: readFileSync(c, 'utf8') };
  return null;
}

const read = () => {
  const root = document.querySelector('[data-fatal-kind]');
  const card = document.querySelector('.sh-fatal__card');
  const r = card ? card.getBoundingClientRect() : null;
  const c = document.createElement('canvas');
  const g = window.__afterlife && window.__afterlife.game;
  const act = document.activeElement;
  return {
    webgl: !!(c.getContext('webgl2') || c.getContext('webgl')),
    fatal: g ? g.fatalError : null,
    kind: root ? root.getAttribute('data-fatal-kind') : null,
    role: root ? root.getAttribute('role') : null,
    title: document.getElementById('fatal-title')?.textContent.trim() ?? null,
    text: document.getElementById('fatal-text')?.textContent.trim() ?? null,
    steps: [...document.querySelectorAll('[data-testid="fatal-no3d-steps"] li')].map((li) => li.textContent.trim()),
    buttons: [...document.querySelectorAll('.sh-fatal__actions button')].map((b) => ({ text: b.textContent.trim(), w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height })),
    focus: act ? act.textContent.trim() : null,
    body: document.body.innerText,
    card: r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null,
    view: { w: window.innerWidth, h: window.innerHeight, scrollW: document.documentElement.scrollWidth },
  };
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  const dist = path.resolve(opt('dist', path.join(tmpdir(), 'al-no3d-dist')));
  await ensureBuild({ root: ROOT, distDir: dist, mode: argv.includes('--no-build') ? 'never' : 'auto', log });
  const server = await startPreview({ root: ROOT, distDir: dist, log });
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl', '--disable-webgl2'] });
  const axe = loadAxe();
  const errors = [];
  try {
    for (const [label, viewport] of [
      ['desktop 1280×720', { width: 1280, height: 720 }],
      ['phone 390×844', { width: 390, height: 844 }],
    ]) {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
      await page.goto(server.url);
      await page.waitForSelector('[data-fatal-kind]', { timeout: 180_000 });
      await page.waitForTimeout(500);
      const s = await page.evaluate(read);
      check(`[${label}] the browser really has no WebGL (the test's premise)`, s.webgl === false);
      check(`[${label}] the dedicated screen is shown, as an alert dialog`, s.kind === 'no3d' && s.role === 'alertdialog', `kind ${s.kind}`);
      check(`[${label}] it says what is wrong, in plain words`, s.title === 'This device can’t draw the 3D view' && /WebGL/.test(s.text ?? '') && /saves are safe/.test(s.text ?? ''), s.title);
      check(`[${label}] it is not the generic crash text`, !/Something came undone|Unexpected error/i.test(s.body), '');
      check(`[${label}] three things to try`, s.steps.length === 3 && /acceleration/.test(s.steps[0]) && /Update/.test(s.steps[1]) && /another/.test(s.steps[2]), s.steps);
      check(`[${label}] Try again is there and has the keyboard focus`, s.buttons.some((b) => b.text === 'Try again') && s.focus === 'Try again', `focus "${s.focus}"`);
      check(`[${label}] diagnostics can still be copied`, s.buttons.some((b) => b.text === 'Copy diagnostics'), s.buttons.map((b) => b.text));
      check(`[${label}] nothing is cut off sideways`, !!s.card && s.card.left >= 0 && s.card.right <= s.view.w + 0.5 && s.view.scrollW <= s.view.w + 0.5, s.card);
      if (viewport.width < 500) check(`[${label}] every button is at least 44 px high`, s.buttons.every((b) => b.h >= 43.5), s.buttons.map((b) => Math.round(b.h)));
      if (axe) {
        const res = await page.evaluate(async (src) => {
          if (!window.axe) (0, eval)(src);
          const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
          return r.violations.map((v) => ({ id: v.id, n: v.nodes.length, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
        }, axe.source);
        check(`[${label}] axe: no violations (contrast included: this screen is plain DOM)`, res.length === 0, res.length ? res : '');
      } else log('    (axe-core not available: rule scan not run)');
      await page.screenshot({ path: path.join(OUT, `${label.split(' ')[0]}.png`) });
      await ctx.close();
    }
  } catch (e) {
    check('the run completed', false, String(e && e.stack ? e.stack : e).slice(0, 800));
  } finally {
    await Promise.race([browser.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await Promise.race([server.stop().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
  }
  check('no page error', errors.length === 0, errors.slice(0, 4).join(' | '));
  const failed = checks.filter((c) => !c.ok);
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ at: new Date().toISOString(), axe: axe ? axe.path : null, checks }, null, 2));
  log(`\n${checks.length - failed.length}/${checks.length} checks passed${axe ? '' : ' (axe-core NOT available)'}; report + screenshots in ${path.relative(ROOT, OUT)}`);
  process.exit(failed.length ? 1 : 0);
}

main();
