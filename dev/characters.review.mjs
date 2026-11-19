// Art-review captures of the Character Lab (ASSETS-CHARACTERS): animation strips (?stagger=1), style lineups
// (?lineup=hair|acc|eyes|top|bottom) and close-ups, all in one browser session. Usage:
//   npx vite --port 5176 --strictPort            (in another shell)
//   node dev/characters.review.mjs <outDir> [set]  set = strips | lineups | all (default all) or a comma list of names
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const out = resolve(process.argv[2] || 'tools/blender/out/characters/review');
const which = process.argv[3] || 'all';
const base = process.env.CHAR_LAB_URL || 'http://localhost:5176/dev/characters.html';
mkdirSync(out, { recursive: true });

const strip = (anim, extra = '') => `anim=${anim}&cam=strip&count=6&stagger=1&same=1&seed=41&t=0.5${extra}`;
const STRIPS = [
  ['strip_idle', strip('idle')], ['strip_walk', strip('walk')], ['strip_hug', strip('hug')],
  ['strip_dance', strip('dance')], ['strip_angry', strip('angry')], ['strip_laugh', strip('laugh')],
  ['strip_kiss', strip('kiss')], ['strip_talk', strip('talk')], ['strip_cheer', strip('cheer')],
  ['strip_wave', strip('wave')], ['strip_flirt', strip('flirt')], ['strip_exercise', strip('exercise')],
  ['strip_read', strip('read', '&carry=book')], ['strip_phone', strip('phone', '&carry=phone')],
  ['strip_pickup', strip('pickup')], ['strip_collapse', strip('collapse')], ['strip_feral', strip('feral')],
  ['strip_groan', strip('groan')], ['strip_disgusted', strip('disgusted')], ['strip_shower', strip('shower')],
  ['strip_sitEat', strip('sitEat', '&carry=plate')], ['strip_standEat', strip('standEat', '&carry=plate')],
  ['strip_sitRead', strip('sitRead', '&carry=book')], ['strip_paint', strip('paint', '&carry=brush')],
  ['strip_walk_carry', strip('walk', '&carry=pizza')], ['strip_yawn', strip('yawn')],
  ['strip_stretch', strip('stretch')],
  // most-seen clips (finishing pass): seated on a chair, lying on a bed, at the counter, slouched at the TV
  ['strip_sit', strip('sit')], ['strip_sitTV', strip('sitTV')], ['strip_cook', strip('cook')],
  ['strip_sitTalk', strip('sitTalk')], ['strip_listen', strip('listen')],
  ['top_sleep', `anim=sleep&cam=top&count=6&stagger=1&same=1&seed=41&t=0.5`],
  ['top_walk', `anim=walk&cam=top&count=6&stagger=1&same=1&seed=41&t=0.5`],
  ['top_idle', `anim=idle&cam=top&count=6&stagger=1&same=1&seed=41&t=0.5`],
  ['side_walk', `anim=walk&cam=side&count=6&stagger=1&same=1&seed=41&t=0.5&perRow=6`],
  ['top_cook', `anim=cook&cam=top&count=6&stagger=1&same=1&seed=41&t=0.5`],
  ['top_sitTV', `anim=sitTV&cam=top&count=6&stagger=1&same=1&seed=41&t=0.5`],
  ['top_talk', `anim=talk&cam=top&count=6&stagger=1&same=1&seed=41&t=0.5`],
  ['top_sit', `anim=sit&cam=top&count=6&stagger=1&same=1&seed=41&t=0.5`],
  ['top_sitEat', `anim=sitEat&cam=top&count=6&stagger=1&same=1&seed=41&t=0.5&carry=plate`],
  // appearance variety: 12 random zombies (no shared look) from the game camera
  ['face_mohawk', `anim=idle&cam=face&count=1&seed=43&hair=mohawk&acc=none&t=0.6`],
  // mood carriage (expression layer): same zombie, one per expression, idling / walking
  ['lineup_expr', `lineup=expr&anim=idle&cam=strip&seed=46&acc=none&t=2.0`],
  ['lineup_expr_walk', `lineup=expr&anim=walk&cam=strip&seed=46&acc=none&t=2.0`],
  ['variety_a', `anim=idle&cam=top&count=12&perRow=6&spacing=1.0&seed=101&t=0.5`],
  ['variety_b', `anim=idle&cam=top&count=12&perRow=6&spacing=1.0&seed=202&t=0.5`],
];
const pair = (anim, extra = '') => `anim=${anim}&cam=pair&count=4&pair=1&seed=48&t=0.8${extra}`;
const PAIRS = [
  ['pair_hug', pair('hug')], ['pair_kiss', pair('kiss')], ['pair_talk', pair('talk')],
];
const LINEUPS = [
  ['lineup_hair_game', 'lineup=hair&anim=idle&cam=top&seed=43&acc=none&t=0.6'],
  ['lineup_hair_front', 'lineup=hair&anim=idle&cam=strip&seed=43&acc=none&t=0.6'],
  ['lineup_acc', 'lineup=acc&anim=idle&cam=strip&seed=44&hair=buzz&t=0.6'],
  ['lineup_eyes', 'lineup=eyes&anim=idle&cam=strip&seed=45&hair=bald&acc=none&perRow=5&spacing=0.7&t=0.6'],
  ['lineup_top', 'lineup=top&anim=idle&cam=strip&seed=46&acc=none&t=0.6'],
  ['lineup_bottom', 'lineup=bottom&anim=walk&cam=strip&seed=47&acc=none&perRow=3&t=0.6'],
];
let shots = [];
if (which === 'all' || which === 'strips') shots.push(...STRIPS);
if (which === 'all' || which === 'lineups') shots.push(...LINEUPS);
if (which === 'all' || which === 'pairs') shots.push(...PAIRS);
if (!shots.length) {
  const want = new Set(which.split(','));
  shots = [...STRIPS, ...LINEUPS, ...PAIRS].filter(([n]) => want.has(n));
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.CHAR_LAB_W) || 1100, height: Number(process.env.CHAR_LAB_H) || 470 } });
page.setDefaultTimeout(240000);
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
// CHAR_LAB_QUERY='assets=/tools/blender/out/characters/iter/' reviews a candidate build (build_zombie.py --out-dir)
const extraQuery = process.env.CHAR_LAB_QUERY ? `&${process.env.CHAR_LAB_QUERY}` : '';
async function capture(name, q) {
  const t0 = Date.now();
  await page.goto(`${base}?shot=1&${q}${extraQuery}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__charLab && window.__charLab.ready, null, { timeout: 60000 });
  await page.evaluate(() => window.__charLab.ready);
  await page.waitForFunction(() => window.__charLab.frames() > 0, null, { timeout: 240000 });
  const stats = await page.evaluate(() => window.__charLab.stats());
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 300000 });
  const dcs = stats.rigs.map((r) => r.drawCalls);
  const tris = stats.rigs.map((r) => r.triangles);
  console.log(`${name}: ${((Date.now() - t0) / 1000).toFixed(1)}s kinds=${[...new Set(stats.rigs.map((r) => r.kind))]} ` +
    `dc ${Math.min(...dcs)}-${Math.max(...dcs)} tris ${Math.min(...tris)}-${Math.max(...tris)}`);
}
for (const [name, q] of shots) {
  // the CPU is shared (SwiftShader): retry once on a timeout instead of aborting the batch
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await capture(name, q);
      break;
    } catch (e) {
      console.log(`${name}: attempt ${attempt + 1} failed: ${String(e).split('\n')[0]}`);
    }
  }
}
await browser.close();
const errs = logs.filter((l) => /error|warn/i.test(l) && !l.includes('[vite]'));
if (errs.length) console.log(errs.slice(0, 20).join('\n'));
