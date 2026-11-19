/**
 * SEATING screenshot regression (Playwright + SwiftShader): every seat object × body (classic + cast bodies) from two
 * camera angles (3/4 front and side profile), composed into one contact sheet per body.
 *
 *   npx vite --config dev/render.vite.config.ts --port 5175 --strictPort &
 *   node dev/seating.shots.cjs <outDir> [bodies=classic,boss,civilian,walker] [anim=sit] [url=http://127.0.0.1:5175] [query]
 * Before sheet (original furniture, no seat fit): query 'fit=0&objects=/dev/out/seating/before-assets/'.
 *
 * Writes <outDir>/<body>-<anim>.png (sheet: one column per seat, rows = angles) + <outDir>/log.txt.
 */
const fs = require('fs');
const path = require('path');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node-tools/node_modules/playwright'));
}

const out = path.resolve(process.argv[2] || path.join(__dirname, 'out', 'seating', 'after'));
const bodies = (process.argv[3] || 'classic,boss,civilian,walker').split(',');
const anim = process.argv[4] || 'sit';
const base = process.argv[5] || 'http://127.0.0.1:5175';
/** Extra page query (e.g. 'fit=0&objects=/dev/out/seating/before-assets/' for the before sheet). */
const extra = process.argv[6] || '';
const VIEW = { width: 640, height: 520 };
/** [label, yaw offset, pitch, distance]: 3/4 front-left, side profile (camera on the sitter's left). */
const ANGLES = [
  ['front34', 0.6, 0.32, 3.4],
  ['side', -Math.PI / 2, 0.12, 3.2],
];
fs.mkdirSync(out, { recursive: true });
const log = [];
const note = (s) => {
  log.push(s);
  console.log(s);
  fs.writeFileSync(path.join(out, 'log.txt'), log.join('\n') + '\n');
};

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const body of bodies) {
    const page = await (await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 })).newPage();
    page.on('pageerror', (e) => note(`[pageerror] ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') note(`[console] ${m.text().slice(0, 300)}`); });
    await page.goto(`${base}/dev/seating.html?body=${body}&anim=${anim}${extra ? `&${extra}` : ''}`);
    await page.waitForFunction(() => window.__seating && (window.__seating.ready || window.__seating.error), null, { timeout: 180000 });
    const err = await page.evaluate(() => window.__seating.error);
    if (err) throw new Error(err);
    // wait for every rig to swap in its real GLB body
    const want = body === 'classic' ? null : body;
    const t0 = Date.now();
    for (;;) {
      const rigs = await page.evaluate(() => window.__seating.rigs());
      const f = await page.evaluate(() => window.__seating.frames);
      const ok = rigs.length > 0 && rigs.every((r) => (want ? r.body === want : r.kind !== 'fallback' && r.kind !== '?')) && f > 20;
      if (ok || Date.now() - t0 > 120000) {
        note(`${body}: rigs ${JSON.stringify(rigs.slice(0, 2))} frames ${f} ok=${ok}`);
        break;
      }
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(1500);
    await page.evaluate(() => (window.__seating.live = false));
    const seats = await page.evaluate(() => window.__seating.seats);
    // one column per object (multi-seat objects: framed on the first seat), rows = angles
    const cols = [];
    const seen = new Set();
    for (const s of seats) {
      if (seen.has(s.defId)) continue;
      seen.add(s.defId);
      cols.push(s);
    }
    const shots = [];
    for (const s of cols) {
      for (const [label, yaw, pitch, dist] of ANGLES) {
        // camera yaw convention: yaw 0 looks from +Z (the front) toward -Z; seats face +Z (desk/chess seats are
        // rotated, so frame relative to the seat's own facing)
        const facing = s.defId === 'desk_hauntedpc' ? Math.PI : s.defId === 'table_bonechess' ? Math.PI / 2 : 0;
        await page.evaluate(([x, z, y, p, d]) => window.__seating.focus(x, z, y, p, d), [s.x, s.z, facing + yaw, pitch, dist]);
        const url = await page.evaluate(() => window.__seating.capture());
        note(`  ${s.defId} ${label} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
        fs.mkdirSync(path.join(out, body), { recursive: true });
        fs.writeFileSync(path.join(out, body, `${s.defId}-${label}-${anim}.png`), Buffer.from(url.split(',')[1], 'base64'));
        shots.push({ name: `${s.defId}/${s.slotId}`, label, url });
      }
    }
    // compose the sheet in-page
    const sheet = await page.evaluate(async ({ shots, cols, rows, title }) => {
      const W = 320, H = 260, PAD = 22;
      const c = document.createElement('canvas');
      c.width = cols * W;
      c.height = rows * H + PAD;
      const g = c.getContext('2d');
      g.fillStyle = '#120e18';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#e8e0c8';
      g.font = '15px monospace';
      g.fillText(title, 8, 16);
      for (let i = 0; i < shots.length; i++) {
        const img = new Image();
        img.src = shots[i].url;
        await img.decode();
        const col = Math.floor(i / rows), row = i % rows;
        g.drawImage(img, img.width * 0.25, img.height * 0.2, img.width * 0.5, img.height * 0.5, col * W, PAD + row * H, W, H);
        g.fillStyle = 'rgba(0,0,0,0.6)';
        g.fillRect(col * W, PAD + row * H, W, 16);
        g.fillStyle = '#e8e0c8';
        g.font = '11px monospace';
        g.fillText(`${shots[i].name} ${shots[i].label}`, col * W + 4, PAD + row * H + 12);
      }
      return c.toDataURL('image/png');
    }, { shots, cols: cols.length, rows: ANGLES.length, title: `${body} · ${anim}` });
    const file = path.join(out, `${body}-${anim}.png`);
    fs.writeFileSync(file, Buffer.from(sheet.split(',')[1], 'base64'));
    note(`wrote ${file} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    await page.close();
  }
  await browser.close();
})().catch((e) => {
  note(`FAILED ${e.stack || e}`);
  process.exit(1);
});
