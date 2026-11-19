/* eslint-disable */
/**
 * In-engine screenshots of the object models (Three.js + WebGL2 via SwiftShader).
 *   node dev/objects.shots.cjs [--only name,name] [--keep-server] [--out DIR] [--shot NAME 'QUERY' [WxH]]...
 * Starts its own Vite server on 5175 (HMR/watch off) if nothing is listening, opens dev/objects.html with several
 * presets and writes PNGs to tools/blender/out/objects/engine/ (captured in-page: WebGL canvas + painted labels).
 * --shot adds an ad-hoc capture (e.g. --shot chairs 'focus=chair_creaky,chair_ribcage&t=1&bloom=0' 900x600); when any
 * --shot is given only those are captured. --out writes the PNGs to another directory (e.g. a before/after set).
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
let OUT = path.join(ROOT, 'tools', 'blender', 'out', 'objects', 'engine');
const PORT = 5175;
const BASE = `http://localhost:${PORT}/dev/objects.html`;

const SHOTS = [
  { name: 'overview_day', q: 'state=powered&cam=iso&t=2.0&bloom=0&wrap=26&zoom=0.8', w: 1400, h: 900 },
  { name: 'overview_night_lit', q: 'state=powered,lit,inUse&night=1&cam=iso&t=2.0&wrap=26&zoom=0.8&lamps=0', w: 1400, h: 900 },
  { name: 'seating_surfaces', q: 'cats=seating,surfaces&state=powered&t=1&bloom=0', w: 1300, h: 760 },
  { name: 'kitchen_inuse', q: 'cats=kitchen&state=powered,inUse&t=1.3', w: 1300, h: 700 },
  { name: 'preservation_beds', q: 'cats=preservation,beds&state=powered,inUse&t=1.1', w: 1300, h: 760 },
  { name: 'electronics_hobbies_on', q: 'cats=electronics,hobbies&state=powered,inUse&progress=0.9&t=0.7', w: 1300, h: 760 },
  { name: 'decor_lighting_night', q: 'cats=decor,outdoor,lighting,misc&state=powered,lit,flag&night=1&t=0.4', w: 1400, h: 800 },
  { name: 'openings', q: 'cats=doors,windows&state=powered,inUse&t=3&cam=front&bloom=0', w: 1100, h: 650 },
  { name: 'items', q: 'cats=item&state=powered&servings=3&t=1', w: 1300, h: 650 },
  { name: 'env', q: 'cats=env&state=powered&t=1&bloom=0', w: 1500, h: 800 },
  { name: 'env_night', q: 'cats=env&state=powered,lit&night=1&t=1', w: 1500, h: 800 },
  { name: 'tinted_dirty', q: 'cats=seating,beds&state=powered&tint=variant&dirt=0.75&t=1&bloom=0', w: 1300, h: 760 },
  { name: 'broken', q: 'focus=fridge_humming,tv_crt,stove_greasefire,arcade_tombstone,microwave_nuke&state=broken,inUse&t=1.7', w: 1200, h: 650 },
  { name: 'closeup_fridge_open', q: 'focus=fridge_humming,fridge_cryo&state=powered,inUse&t=4&zoom=0.7', w: 1000, h: 750 },
  { name: 'closeup_servings', q: 'focus=item_meal,item_pizza&state=powered&servings=2&t=1&zoom=0.5&bloom=0', w: 900, h: 600 },
  { name: 'closeup_mailbox_flag', q: 'focus=mailbox_crooked,easel_morbid,item_painting&state=powered,flag&progress=0.55&t=2&zoom=0.7', w: 1000, h: 700 },
  { name: 'ao_check', q: 'focus=chair_creaky,sofa_moldy,counter_butcher,shelf_moldering&state=powered&t=1&bloom=0&zoom=0.7', w: 1100, h: 650 },
  { name: 'missing_placeholders', q: 'focus=chair_creaky,no_such_model,sofa_moldy&state=powered&t=1&bloom=0', w: 900, h: 600 },
  // hardening pass: close-ups of the redone third (day + one night/lit pass)
  { name: 'redone_beds_seating', q: 'focus=plot_budget,coffin_chillrest,sarcophagus_cryo,coffin_pine,chair_ribcage&state=powered&t=1&bloom=0&zoom=0.85', w: 1200, h: 700 },
  { name: 'redone_surfaces_hobbies', q: 'focus=table_wake,table_coffinlid,table_urnstand,table_bonechess,gym_limb&state=powered&t=1&bloom=0&zoom=0.85', w: 1200, h: 700 },
  { name: 'redone_kitchen_decor', q: 'focus=fridge_humming,trash_lidded,mirror_cracked,plant_deadfern,lamp_skull,diffuser_formaldehyde&state=powered&t=1&bloom=0&zoom=0.85', w: 1200, h: 700 },
  { name: 'redone_items', q: 'focus=item_meal,item_fire,item_limb_arm,item_limb_leg&state=powered&t=1&zoom=0.55', w: 1000, h: 600 },
  { name: 'redone_env', q: 'focus=env_tree_b,env_bush,env_hearse,tree_gnarled&state=powered&t=1&bloom=0', w: 1300, h: 700 },
  { name: 'redone_night_lit', q: 'focus=lamp_skull,item_fire,coffin_chillrest,sarcophagus_cryo,table_wake&state=powered,lit&night=1&t=1.2&zoom=0.85', w: 1200, h: 700 },
  // finish pass: the second redo batch, day close-up + powered night (status lights, glows, candle)
  { name: 'finish_redo_day', q: 'focus=coffin_chillrest,fridge_cryo,station_embalming&state=powered&t=1.3&bloom=0&zoom=0.5', w: 1200, h: 700 },
  { name: 'finish_redo_small', q: 'focus=item_meal,sconce_candle,env_bush&state=powered&servings=4&t=1&bloom=0&zoom=0.42', w: 1200, h: 700 },
  { name: 'finish_redo_night', q: 'focus=sconce_candle,coffin_chillrest,fridge_cryo,station_embalming&state=powered,lit,inUse&night=1&t=1.2&zoom=0.6', w: 1200, h: 700 },
  { name: 'finish_unpowered', q: 'focus=tub_icebath,desk_hauntedpc,arcade_tombstone,fridge_cryo,coffin_chillrest&state=lit&night=1&t=1&zoom=0.7', w: 1200, h: 700 },
];

function ping() {
  return new Promise((res) => {
    const req = http.get(`http://localhost:${PORT}/`, (r) => {
      r.resume();
      res(true);
    });
    req.on('error', () => res(false));
    req.setTimeout(1500, () => {
      req.destroy();
      res(false);
    });
  });
}

/**
 * Dedicated Vite server for screenshots: HMR and file watching are OFF, so edits made by other agents (or an asset
 * rebuild) can never full-reload a page mid-capture. Reuses an already-running server on the port if present.
 */
async function ensureServer() {
  if (await ping()) return null;
  const { createServer } = await import('vite');
  const server = await createServer({
    root: ROOT,
    configFile: path.join(ROOT, 'vite.config.ts'),
    logLevel: 'error',
    server: { port: PORT, strictPort: true, hmr: false, watch: null },
  });
  await server.listen();
  return { kill: () => server.close() };
}

(async () => {
  const args = process.argv.slice(2);
  const onlyIdx = args.indexOf('--only');
  let only = onlyIdx >= 0 ? new Set(args[onlyIdx + 1].split(',')) : null;
  const outIdx = args.indexOf('--out');
  if (outIdx >= 0) OUT = path.resolve(args[outIdx + 1]);
  const custom = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--shot') continue;
    const name = args[i + 1];
    const q = args[i + 2];
    const size = /^(\d+)x(\d+)$/.exec(args[i + 3] || '');
    if (!name || !q) throw new Error('--shot needs NAME and QUERY');
    custom.push({ name, q, w: size ? Number(size[1]) : 1200, h: size ? Number(size[2]) : 700 });
  }
  if (custom.length) {
    SHOTS.length = 0;
    SHOTS.push(...custom);
    only = null;
  }
  fs.mkdirSync(OUT, { recursive: true });
  const server = await ensureServer();
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  try {
    for (const s of SHOTS) {
      if (only && !only.has(s.name)) continue;
      const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
      page.on('pageerror', (e) => errors.push(`${s.name}: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`${s.name}: console ${m.text()}`);
      });
      const url = `${BASE}?ui=0&frames=2&${s.q}`;
      const file = path.join(OUT, `${s.name}.png`);
      let ok = false;
      for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
        const t0 = Date.now();
        try {
          await page.goto(url, { waitUntil: 'load', timeout: 120000 });
          await page.waitForFunction(() => window.__objectsReady === true, null, { timeout: 600000, polling: 1000 });
          await page.waitForTimeout(300);
          // capture inside the page (canvas + painted labels): avoids compositor stalls under SwiftShader
          const dataUrl = await page.evaluate(() => (window.__capture ? window.__capture() : null), null);
          if (!dataUrl || !dataUrl.startsWith('data:image/png;base64,')) throw new Error('in-page capture unavailable (page reloaded?)');
          fs.writeFileSync(file, Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'));
          const info = await page.evaluate(() => ({ ph: window.__viewer?.placeholders ?? [] }));
          console.log(`${s.name.padEnd(26)} ${((Date.now() - t0) / 1000).toFixed(1)}s placeholders=${JSON.stringify(info.ph)}`);
          ok = true;
        } catch (e) {
          console.log(`${s.name.padEnd(26)} attempt ${attempt} failed: ${String(e && e.message).split('\n')[0]}`);
        }
      }
      if (!ok) errors.push(`${s.name}: screenshot failed`);
      await page.close();
    }
  } finally {
    await browser.close();
    if (server && !args.includes('--keep-server')) server.kill();
  }
  if (errors.length) {
    console.log('PAGE ERRORS:\n' + errors.join('\n'));
    process.exitCode = 1;
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
