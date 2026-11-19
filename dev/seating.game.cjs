/**
 * SEATING in the real BUILT game (owner bug repro): boot → New Game → CAZ → Start (starter lot), then make the first
 * household member sit in the starter lot's armchair (home_sit via sim.dispatch) and capture it from two angles.
 *
 *   npx vite build --outDir <dist> && npx vite preview --outDir <dist> --port 4186 --strictPort &
 *   node dev/seating.game.cjs <outDir> [url=http://localhost:4186/] [defId=armchair_tattered]
 *
 * Writes <outDir>/game-<defId>-front34.png, -side.png and log.txt (sim pose, anim, rendered root offset).
 */
const fs = require('fs');
const path = require('path');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node-tools/node_modules/playwright'));
}
const out = path.resolve(process.argv[2] || path.join(__dirname, 'out', 'seating', 'game'));
const url = process.argv[3] || 'http://localhost:4186/';
const defId = process.argv[4] || 'armchair_tattered';
fs.mkdirSync(out, { recursive: true });
const log = [];
const note = (s) => {
  log.push(s);
  console.log(s);
  fs.writeFileSync(path.join(out, 'log.txt'), log.join('\n') + '\n');
};

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: 900, height: 640 }, deviceScaleFactor: 1 })).newPage();
  page.setDefaultTimeout(240000);
  page.on('pageerror', (e) => note(`[pageerror] ${e.message}`));
  const game = (fn, arg) => page.evaluate(fn, arg);
  const state = () => game(() => {
    const g = window.__afterlife && window.__afterlife.game;
    return g ? { screen: g.screen, fatal: g.fatalError } : null;
  });
  const waitFor = async (pred, ms, what) => {
    const end = Date.now() + ms;
    for (;;) {
      const s = await state().catch(() => null);
      if (s && pred(s)) return s;
      if (Date.now() > end) throw new Error(`timeout waiting for ${what}: ${JSON.stringify(s)}`);
      await page.waitForTimeout(300);
    }
  };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window.__afterlife && window.__afterlife.game), null, { timeout: 120000 });
    await waitFor((s) => s.screen === 'menu' || s.fatal, 300000, 'menu');
    await game(() => window.__afterlife.game.updateSettings({ quality: 'medium', pixelRatio: 1, tutorialEnabled: false, autoPauseOnEvents: false }));
    await game(() => window.__afterlife.game.goto('newGame'));
    await page.waitForTimeout(800);
    await game(() => window.__afterlife.game.beginNewGame());
    await game(() => window.__afterlife.game.addCazMember());
    await waitFor((s) => s.screen === 'caz' || s.fatal, 120000, 'caz');
    await page.waitForTimeout(2000);
    await game(() => window.__afterlife.game.startGame());
    await waitFor((s) => s.screen === 'game' || s.fatal, 180000, 'game');
    note('in game');
    const info = await game((def) => {
      const g = window.__afterlife.game;
      const st = g.sim.state;
      const obj = Object.values(st.objects).find((o) => o.defId === def);
      if (!obj) return { error: `no ${def} on the lot`, defs: [...new Set(Object.values(st.objects).map((o) => o.defId))] };
      const id = st.household.memberIds[0];
      const ag = st.agents[id];
      for (const q of [ag.active, ...(ag.queue || [])]) if (q && typeof q.uid === 'number') g.sim.dispatch({ type: 'cancel', actorId: id, uid: q.uid });
      const r = g.sim.dispatch({ type: 'queue', actorId: id, interactionId: 'home_sit', target: { kind: 'object', id: obj.id } });
      g.setSpeed(3);
      g.setWallMode('cutaway');
      return { id, obj: obj.id, placement: obj.placement, r };
    }, defId);
    note(`queued: ${JSON.stringify(info)}`);
    if (info.error) throw new Error(info.error);
    // wait until seated
    const end = Date.now() + 240000;
    let a = null;
    for (;;) {
      a = await game((id) => {
        const s = window.__afterlife.game.sim.state.agents[id];
        return { anim: s.anim, pos: s.pos, facing: s.facing, phase: s.active && s.active.phase, ix: s.active && s.active.interactionId, slot: s.active && s.active.slot };
      }, info.id);
      if (a.anim && a.anim.startsWith('sit') && a.phase === 'run') break;
      if (Date.now() > end) throw new Error(`never sat: ${JSON.stringify(a)}`);
      await page.waitForTimeout(500);
    }
    // pause the sim while capturing (the interaction would end between shots); the renderer keeps animating
    await game(() => window.__afterlife.game.setSpeed(0));
    await game(() => window.__afterlife.game.renderer.debugTime(12 * 60 + 30, 0));
    await page.waitForTimeout(2500);
    const root = await game((id) => {
      const r = window.__afterlife.game.renderer;
      const p = r.agents && r.agents.positionOf ? r.agents.positionOf(id) : null;
      return p;
    }, info.id).catch(() => null);
    note(`seated: ${JSON.stringify(a)} renderedPose=${JSON.stringify(root)}`);
    for (const [label, dyaw, pitch, dist] of [['front34', 0.6, 0.35, 4], ['side', -Math.PI / 2, 0.15, 3.6]]) {
      await game(([p, f, dy, pi, d]) => window.__afterlife.game.renderer.setCamera({ target: { x: p.x, z: p.z }, yaw: f + dy, pitch: pi, distance: d }, true), [a.pos, a.facing, dyaw, pitch, dist]);
      await page.waitForTimeout(3000);
      await page.screenshot({ path: path.join(out, `game-${defId}-${label}.png`) });
      note(`shot ${label}`);
    }
  } catch (e) {
    note(`FAILED ${e.stack || e}`);
    await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
    process.exitCode = 1;
  }
  await browser.close();
})();
