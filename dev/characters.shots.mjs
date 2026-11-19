// Playwright screenshots of the Character Lab (ASSETS-CHARACTERS). Usage:
//   npx vite --port 5176 --strictPort   (in another shell)
//   node dev/characters.shots.mjs [baseUrl] [outDir]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const base = process.argv[2] || 'http://localhost:5176/dev/characters.html';
const out = resolve(process.argv[3] || 'tools/blender/out/characters/shots');
mkdirSync(out, { recursive: true });

const SHOTS = [
  ['grid_idle', 'anim=idle&cam=game&seed=7&t=1.1'],
  ['grid_mixed', 'mixed=1&cam=game&seed=11&t=1.3'],
  ['grid_walk', 'anim=walk&cam=game&seed=5&t=0.8'],
  ['close_walk_side', 'anim=walk&cam=side&count=2&seed=3&t=0.4'],
  ['sit_eat', 'anim=sitEat&cam=game&count=4&seed=4&t=1.2'],
  ['sleep_bed', 'anim=sleep&cam=game&count=4&seed=9&t=1.0'],
  ['bath', 'anim=bath&cam=game&count=2&seed=2&t=1.0'],
  ['cook_counter', 'anim=cook&cam=game&count=4&seed=14&t=1.0'],
  ['dance_party', 'anim=dance&cam=game&seed=15&t=1.4'],
  ['decay_carry', 'anim=walk&cam=close&count=2&seed=6&decay=0.9&carry=plate&t=0.7'],
  ['decay_face', 'anim=idle&cam=face&count=1&seed=21&hair=bald&acc=none&top=tatters&decay=1&t=0.5'],
  ['limbs_limp', 'anim=walk&cam=game&count=4&seed=8&limbs=legL&t=0.9'],
  ['limbs_crawl', 'anim=walk&cam=game&count=4&seed=12&limbs=legL,legR&t=0.9'],
  ['prosthetic', 'anim=idle&cam=close&count=2&seed=13&limbs=armR:prosthetic,legL:prosthetic&t=0.5'],
  ['face_happy_talk', 'anim=idle&cam=face&count=1&seed=21&hair=bob&acc=none&expr=happy&talk=1&t=0.55'],
  ['face_angry', 'anim=idle&cam=face&count=1&seed=22&hair=messy&acc=none&expr=angry&t=0.6'],
  ['face_shocked', 'anim=idle&cam=face&count=1&seed=23&hair=afro&acc=none&eyes=wide&expr=shocked&t=0.6'],
  ['face_sad', 'anim=idle&cam=face&count=1&seed=24&hair=pigtails&acc=flower&expr=sad&t=0.6'],
  ['face_sleepy_beanie', 'anim=idle&cam=face&count=1&seed=25&hair=long&acc=beanie&eyes=sleepy&expr=sleepy&t=0.6'],
  ['carry_read_book', 'anim=read&cam=close&count=2&seed=26&carry=book&t=0.8'],
  ['carry_phone', 'anim=phone&cam=close&count=2&seed=27&carry=phone&t=0.8'],
  ['carry_paint_brush', 'anim=paint&cam=close&count=2&seed=28&carry=brush&t=0.9'],
  ['carry_pizza_walk', 'anim=walk&cam=close&count=2&seed=29&carry=pizza&t=0.9'],
  ['highlight_selected', 'anim=idle&cam=close&count=2&seed=30&hl=selected&t=0.8'],
  // added by the hardening pass: socials with a partner, anchored carry items, style lineups
  ['pair_hug', 'anim=hug&cam=pair&count=4&pair=1&seed=48&t=0.8'],
  ['pair_kiss', 'anim=kiss&cam=pair&count=4&pair=1&seed=49&t=0.8'],
  ['eat_plate_fork', 'anim=sitEat&cam=close&count=2&seed=31&carry=plate&t=1.0'],
  ['eat_one_arm', 'anim=sitEat&cam=close&count=2&seed=32&carry=plate&limbs=armL&t=1.0'],
  ['phone_ear', 'anim=phone&cam=face&count=1&seed=33&hair=bob&acc=none&carry=phone&t=0.9'],
  ['lineup_hair_game', 'lineup=hair&anim=idle&cam=top&seed=43&acc=none&t=0.6'],
  ['lineup_acc', 'lineup=acc&anim=idle&cam=strip&seed=44&hair=buzz&t=0.6'],
];

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.setDefaultTimeout(240000);
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const only = process.env.SHOTS ? new Set(process.env.SHOTS.split(',')) : null;
for (const [name, q] of SHOTS) {
  if (only && !only.has(name)) continue;
  // SwiftShader on a shared CPU can stall: retry a shot once instead of aborting the batch
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(`${base}?shot=1&${q}`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__charLab && window.__charLab.ready, null, { timeout: 60000 });
      const t0 = Date.now();
      await page.evaluate(() => window.__charLab.ready);
      await page.waitForFunction(() => window.__charLab.frames() > 0, null, { timeout: 240000 });
      const stats = await page.evaluate(() => window.__charLab.stats());
      await page.screenshot({ path: `${out}/${name}.png`, timeout: 300000 });
      const dcs = stats.rigs.map((r) => r.drawCalls);
      console.log(name, `${((Date.now() - t0) / 1000).toFixed(1)}s`, 'kinds', [...new Set(stats.rigs.map((r) => r.kind))].join(','),
        'drawCalls/rig', Math.min(...dcs), '-', Math.max(...dcs), 'frame calls', stats.calls);
      break;
    } catch (e) {
      console.log(name, `attempt ${attempt + 1} failed:`, String(e).split('\n')[0]);
    }
  }
}
await browser.close();
const errs = logs.filter((l) => l.includes('error') || l.includes('warn'));
if (errs.length) console.log(errs.slice(0, 20).join('\n'));
