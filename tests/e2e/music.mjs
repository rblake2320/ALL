/**
 * Music is off until the player turns it on (W-150).
 *
 *   node tests/e2e/music.mjs [--dist=<dir>] [--no-build] [--out=dev/out/music]
 *
 * Real Chromium, production build. A fresh profile: music setting off, the audio engine's music channel at 0 (the
 * other channels at their defaults), the main menu shows "Music: Off". One click turns it on (engine channel = the
 * slider value); it stays on across a reload; Settings → Audio has the same switch and turns it off again.
 * Exit 0 = pass, 1 = fail.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
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
const OUT = path.resolve(ROOT, opt('out', 'dev/out/music'));
const SWITCH = '[role="switch"][aria-labelledby="set-music-label"]';
const log = (s) => console.log(s);
const checks = [];
const check = (name, ok, detail = '') => {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  checks.push({ name, ok: !!ok, detail: d });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${d ? ` — ${d}` : ''}`);
};

const read = () => {
  const g = window.__afterlife.game;
  const b = document.querySelector('[data-testid="menu-music"]');
  const eng = g.audio && g.audio.volumes ? { ...g.audio.volumes } : null;
  const sw = document.querySelector('[role="switch"][aria-labelledby="set-music-label"]');
  return {
    screen: g.screen,
    setting: g.settings.musicEnabled,
    slider: g.settings.volumes.music,
    engine: eng,
    item: b ? { text: b.querySelector('.sh-menu__label')?.textContent.trim(), pressed: b.getAttribute('aria-pressed'), h: b.getBoundingClientRect().height } : null,
    switch: sw ? sw.getAttribute('aria-checked') : null,
  };
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  const dist = path.resolve(opt('dist', path.join(tmpdir(), 'al-music-dist')));
  await ensureBuild({ root: ROOT, distDir: dist, mode: argv.includes('--no-build') ? 'never' : 'auto', log });
  const server = await startPreview({ root: ROOT, distDir: dist, log });
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    const menu = async () => {
      await page.goto(server.url);
      await page.waitForSelector('[data-testid="menu-music"]', { timeout: 240_000 });
      await page.waitForTimeout(800);
      // the first-run welcome (year of birth) covers the menu: "Not now"
      const notNow = page.getByRole('button', { name: 'Not now' });
      if (await notNow.count()) {
        await notNow.first().click();
        await page.waitForTimeout(500);
      }
    };
    await menu();
    let s = await page.evaluate(read);
    check('fresh profile: the music setting is off', s.setting === false, `musicEnabled ${s.setting}`);
    check('the music volume slider keeps its default', Math.abs(s.slider - 0.55) < 1e-9, `slider ${s.slider}`);
    check('the audio engine was given music = 0 and the other channels unchanged', !!s.engine && s.engine.music === 0 && s.engine.master === 0.8 && s.engine.sfx === 0.8 && s.engine.voice === 0.75, s.engine);
    check('the main menu says "Music: Off" (not pressed)', s.item?.text === 'Music: Off' && s.item?.pressed === 'false', s.item);
    await page.screenshot({ path: path.join(OUT, 'menu-off.png') });

    await page.click('[data-testid="menu-music"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="menu-music"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 30_000 }).catch(() => undefined);
    s = await page.evaluate(read);
    check('one click turns music on', s.setting === true && s.item?.text === 'Music: On' && s.item?.pressed === 'true', s.item);
    check('the engine music channel is now the slider value', !!s.engine && Math.abs(s.engine.music - 0.55) < 1e-9, s.engine);
    await page.screenshot({ path: path.join(OUT, 'menu-on.png') });

    await page.waitForTimeout(1200); // profile write
    await menu();
    s = await page.evaluate(read);
    check('the choice survives a reload', s.setting === true && s.item?.text === 'Music: On' && !!s.engine && Math.abs(s.engine.music - 0.55) < 1e-9, { setting: s.setting, engine: s.engine?.music });

    await page.evaluate(() => window.__afterlife.game.openDialog('settings'));
    await page.waitForSelector('[role="tab"]', { timeout: 30_000 });
    const tabs = await page.$$('[role="tab"]');
    for (const t of tabs) if (/audio/i.test((await t.textContent()) ?? '')) await t.click();
    await page.waitForSelector(SWITCH, { timeout: 30_000 });
    s = await page.evaluate(read);
    check('Settings → Audio has a Music switch, showing on', s.switch === 'true', `aria-checked ${s.switch}`);
    await page.screenshot({ path: path.join(OUT, 'settings-audio.png') });
    await page.click(SWITCH);
    await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('aria-checked') === 'false', SWITCH, { timeout: 30_000 }).catch(() => undefined);
    s = await page.evaluate(read);
    check('the switch turns music off again (engine back to 0, slider untouched)', s.setting === false && s.switch === 'false' && s.engine?.music === 0 && Math.abs(s.slider - 0.55) < 1e-9, { setting: s.setting, engine: s.engine?.music, slider: s.slider });
    await ctx.close();
  } catch (e) {
    check('the run completed', false, String(e && e.stack ? e.stack : e).slice(0, 800));
  } finally {
    await Promise.race([browser.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await Promise.race([server.stop().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
  }
  check('no page error', errors.length === 0, errors.slice(0, 4).join(' | '));
  const failed = checks.filter((c) => !c.ok);
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ at: new Date().toISOString(), checks }, null, 2));
  log(`\n${checks.length - failed.length}/${checks.length} checks passed; report + screenshots in ${path.relative(ROOT, OUT)}`);
  process.exit(failed.length ? 1 : 0);
}
main();
