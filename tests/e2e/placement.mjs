/**
 * Build/Buy placement in a real browser (production build, headless Chromium + SwiftShader): the ghost a player
 * sees must be exactly what the click does. Owner report: "adding a window to a wall — it showed GREEN (valid) but
 * I couldn't add it".
 *
 * For every placement kind (floor item, wall item, window, door) and from BOTH Build mode (door / window tools) and
 * Buy mode (catalog, eyedropper copy, hand tool):
 *   hover with the real mouse → read the ghost the renderer was handed (validity, edge / tile) and the cursor label
 *   → click → the sim changed EXACTLY when the ghost was valid, at the ghost's edge / tile, for the previewed price;
 *   an invalid ghost (occupied spot, and "Not enough money") changes nothing; then move it (and rotate floor
 *   items), sell it, undo / redo, checking funds at every step. A window placed on a wall that cutaway had lowered
 *   must be visible (it used to be placed but hidden with the lowered wall). Screenshots → dev/out/e2e-placement.
 *
 *   node tests/e2e/placement.mjs [--rebuild | --no-build] [--dist=<dir>] [--url=<http://…/>] [--out=<dir>] [--headed]
 *
 * Conventions as in flow.mjs: actions are real mouse / keyboard / DOM input; window.__afterlife is read to compute
 * where to point and to assert. The ghost is observed by wrapping renderer.setPlacementGhost (read-only spy, it
 * forwards every call). The only direct state write is SETUP for the funds edge case (household funds set to
 * price − 1 and restored), marked SETUP: a player cannot dial an exact balance by hand.
 *
 * Vehicles (W-031) are not built yet: their section is reported PENDING (never as passing).
 *
 * Timing (W-115): every wait is budgeted in RENDERED FRAMES (lib/waits.mjs), never in wall-clock time alone — on a
 * loaded CI runner SwiftShader draws one frame every few seconds and a first-use shader compile can block the page
 * for 20 s+, which used to surface as random "timed out waiting for …" failures. A warm-up step compiles the shaders
 * every later step needs before step 1, wall-mode changes wait for the cutaway animation to settle (renderer test
 * hook), and every step starts from the same view (walls cutaway, nothing being placed) so one failure cannot
 * cascade into the next step.
 */
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness } from './lib/harness.mjs';
import { ensureBuild, startPreview } from './lib/server.mjs';
import * as P from './lib/inpage.mjs';
import { waitFor, waitFrames, waitRenderSettled, renderProgress, MIN_FRAMES } from './lib/waits.mjs';

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
    out: path.resolve(ROOT, opt('out', process.env.E2E_OUT || path.join('dev', 'out', 'e2e-placement'))),
    headed: flag('headed'),
  };
}

// ───────────────────────────── in-page helpers (serialised; self-contained) ─────────────────────────────

/** Read-only spy: remember the last ghost the input layer handed the renderer (and count calls). */
function installGhostSpy() {
  const r = window.__afterlife.game.renderer;
  if (r.__ghostSpy) return;
  const orig = r.setPlacementGhost.bind(r);
  window.__ghost = { seq: 0, g: null };
  r.setPlacementGhost = (g) => {
    window.__ghost = { seq: window.__ghost.seq + 1, g: g ? JSON.parse(JSON.stringify(g)) : null };
    return orig(g);
  };
  r.__ghostSpy = true;
}

function snap() {
  const g = window.__afterlife.game;
  const s = g.sim.state;
  return {
    funds: s.household.funds,
    ids: Object.keys(s.objects).sort(),
    objects: Object.fromEntries(Object.entries(s.objects).map(([id, o]) => [id, { defId: o.defId, placement: o.placement }])),
    ghost: window.__ghost ? window.__ghost.g : null,
    label: g.buildPreviewLabel,
    mode: g.mode,
    placing: g.buy.placingDefId,
    moving: g.buy.movingObjectId,
    rot: g.buy.rot,
    hover: g.buy.hoverObjectId,
    tool: g.buildTool,
  };
}

/** Wait two animation frames (the controller hovers once per frame). */
function frames() {
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined))));
}

/**
 * Screen points over wall edges, resolved the way the input layer resolves them (renderer.pick walls first, then
 * the grid edge), with the build preview of `cmd(edge)` for each. `lowered`: also report whether the wall is
 * lowered by cutaway (a ray at 1.6 m above the edge does not hit it).
 */
function edgePoints({ kind, defId, objectId, side }) {
  const g = window.__afterlife.game;
  const sim = g.sim;
  const r = g.renderer;
  const canvas = document.getElementById('game-canvas');
  const onCanvas = (s) => s.visible && s.x > 130 && s.y > 130 && s.x < innerWidth - 300 && s.y < innerHeight - 280 && document.elementFromPoint(s.x, s.y) === canvas;
  const resolve = (sx, sy) => {
    const p = r.pick(sx, sy, { agents: false, objects: false, walls: true, tiles: false });
    if (p.kind === 'wall') return { edge: p.edge, side: p.side };
    const gp = r.pickGrid(sx, sy);
    return gp && gp.edge ? { edge: gp.edge, side: gp.edgeSide === 0 ? 0 : 1 } : null;
  };
  const out = [];
  for (const edge of Object.keys(sim.state.lot.walls)) {
    const [d, xs, zs] = edge.split(':');
    const x = Number(xs);
    const z = Number(zs);
    const mx = d === 'h' ? x + 0.5 : x;
    const mz = d === 'h' ? z : z + 0.5;
    const top = r.worldToScreen(mx, 1.6, mz);
    const topHit = top.visible ? resolve(top.x, top.y) : null;
    const lowered = !topHit || topHit.edge !== edge;
    for (const y of [1.2, 0.25]) {
      const s = r.worldToScreen(mx, y, mz);
      if (!onCanvas(s)) continue;
      const w = resolve(s.x, s.y);
      if (!w || w.edge !== edge) continue;
      if (side !== undefined && w.side !== side) continue;
      let cmd;
      if (kind === 'opening') cmd = objectId ? { type: 'moveOpening', objectId, edge } : { type: 'buyOpening', defId, edge, tint: null };
      else cmd = objectId ? { type: 'moveWallItem', objectId, edge, side: w.side } : { type: 'buyWallItem', defId, edge, side: w.side, tint: null };
      const pv = sim.build.preview(cmd);
      out.push({ edge, side: w.side, y, sx: s.x, sy: s.y, ok: pv.ok, reason: pv.reason ?? null, cost: pv.cost, lowered });
      break;
    }
  }
  out.sort((a, c) => Math.hypot(a.sx - innerWidth / 2, a.sy - innerHeight / 2) - Math.hypot(c.sx - innerWidth / 2, c.sy - innerHeight / 2));
  return out;
}

/**
 * A screen point where renderer.pick hits object `id`: objects only (Buy mode's hand tool) or, with `walls`, the
 * eyedropper's pick (walls, objects, tiles). Samples the object's whole extent: a door / window is often half
 * hidden behind a perpendicular wall from this camera.
 */
function objectPoint({ id, walls = false }) {
  const g = window.__afterlife.game;
  const r = g.renderer;
  const sc = r.scene();
  const o = sc && sc.getObjectByName(`obj:${id}`);
  if (!o) return null;
  const p = o.getWorldPosition(o.position.clone());
  const canvas = document.getElementById('game-canvas');
  const offs = [0, 0.15, -0.15, 0.3, -0.3, 0.4, -0.4];
  for (const dy of [1.3, 0.9, 1.6, 0.5, 1.9, 0.25]) {
    for (const dx of offs) {
      for (const dz of offs) {
        const s = r.worldToScreen(p.x + dx, p.y + dy, p.z + dz);
        if (!s.visible || s.x < 130 || s.y < 130 || s.x > innerWidth - 300 || s.y > innerHeight - 280) continue;
        if (document.elementFromPoint(s.x, s.y) !== canvas) continue;
        const pk = r.pick(s.x, s.y, { agents: false, objects: true, walls, tiles: walls });
        if (pk.kind === 'object' && pk.objectId === id) return { sx: s.x, sy: s.y };
      }
    }
  }
  return null;
}

/** Is the placed object drawn (its holder and every ancestor visible)? */
function objectVisible({ id }) {
  const sc = window.__afterlife.game.renderer.scene();
  const o = sc && sc.getObjectByName(`obj:${id}`);
  if (!o) return false;
  for (let n = o; n; n = n.parent) if (!n.visible) return false;
  return true;
}

/** Free / occupied floor tiles for `defId` at `rot` whose centre maps back to the same tile. */
function floorPoints({ defId, rot, objectId }) {
  const g = window.__afterlife.game;
  const sim = g.sim;
  const r = g.renderer;
  const canvas = document.getElementById('game-canvas');
  const b = sim.state.lot.buildable;
  const def = sim.content.objects[defId];
  const out = [];
  for (let z = b.z0; z < b.z1; z++) {
    for (let x = b.x0; x < b.x1; x++) {
      const s = r.worldToScreen(x + 0.5, 0, z + 0.5);
      if (!s.visible || s.x < 130 || s.y < 130 || s.x > innerWidth - 300 || s.y > innerHeight - 280) continue;
      if (document.elementFromPoint(s.x, s.y) !== canvas) continue;
      const pg = r.pickGrid(s.x, s.y);
      if (!pg || pg.x !== x || pg.z !== z) continue;
      // the ghost is centred on the cursor: origin = cursor − floor(size / 2) (footprints here are 1×1 / 1×2 / 2×1)
      const w = rot % 2 === 0 ? def.footprint.w : def.footprint.d;
      const d = rot % 2 === 0 ? def.footprint.d : def.footprint.w;
      const ox = Math.floor(x + 0.5 - w / 2);
      const oz = Math.floor(z + 0.5 - d / 2);
      const cmd = objectId ? { type: 'move', objectId, x: ox, z: oz, rot } : { type: 'buy', defId, x: ox, z: oz, rot, tint: null };
      const pv = sim.build.preview(cmd);
      out.push({ x, z, ox, oz, sx: s.x, sy: s.y, ok: pv.ok, reason: pv.reason ?? null, cost: pv.cost });
    }
  }
  out.sort((a, c) => Math.hypot(a.sx - innerWidth / 2, a.sy - innerHeight / 2) - Math.hypot(c.sx - innerWidth / 2, c.sy - innerHeight / 2));
  return out;
}

// ───────────────────────────── runner ─────────────────────────────

export async function main(argv = process.argv.slice(2)) {
  const { chromium } = require('playwright');
  const args = parseArgs(argv);
  mkdirSync(args.out, { recursive: true });
  for (const f of readdirSync(args.out)) if (/\.(png|json)$/.test(f)) rmSync(path.join(args.out, f));
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
    await flow({ h, browser, url });
  } catch (e) {
    fatal = e;
    console.error(`\nPLACEMENT RUN ABORTED: ${e && e.stack ? e.stack : e}`);
  } finally {
    await browser?.close().catch(() => {});
    await server?.stop().catch(() => {});
  }
  console.log(`\n${'='.repeat(100)}\n${h.table()}`);
  if (h.errors.length) {
    console.log('\nconsole / page errors:');
    for (const e of h.errors) console.log(`  [${e.step}] ${e.kind}: ${e.text.split('\n')[0].slice(0, 300)}`);
  }
  // PENDING (vehicles, not built) is reported but neither passes nor fails the run; anything else must PASS.
  const counted = h.results.filter((r) => r.status !== 'PENDING');
  const ok = !fatal && counted.length > 0 && counted.every((r) => r.status === 'PASS') && h.errors.length === 0;
  h.writeReport({ meta: { totalMs: Date.now() - t0 }, fatal: fatal ? String(fatal.stack || fatal) : null });
  console.log(`\n${ok ? 'PLACEMENT PASSED' : 'PLACEMENT FAILED'} in ${((Date.now() - t0) / 1000).toFixed(1)} s — ${path.relative(ROOT, args.out) || args.out}`);
  return ok ? 0 : 1;
}

async function flow({ h, browser, url }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(P.initScript);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  h.watch(page);
  const G = (fn, arg) => page.evaluate(fn, arg);
  const S = () => G(snap);
  const describe = async () => {
    const s = await S().catch(() => null);
    return s && { mode: s.mode, placing: s.placing, moving: s.moving, label: s.label, ghost: s.ghost, funds: s.funds, wallMode: await G(() => window.__afterlife.game.wallMode).catch(() => null) };
  };
  /** State wait budgeted in rendered frames (W-115): fails after ≥ `minMs` AND ≥ MIN_FRAMES frames, not after `minMs` alone. */
  const until = (what, fn, arg, minMs = 60_000, minFrames = MIN_FRAMES) => waitFor(page, what, fn, arg, { minMs, minFrames, describe, log: (x) => h.log(x) });
  /** Pre-game screens (the 3D view may not be drawing yet): plain wall-clock wait, as before. */
  const untilScreen = async (sc, timeout = 300_000) => {
    try {
      await page.waitForFunction((x) => window.__afterlife?.game?.screen === x, sc, { ...POLL, timeout });
    } catch {
      throw new Error(`timed out (${timeout} ms) waiting for screen=${sc}; ${JSON.stringify(await G(() => window.__afterlife?.game?.screen).catch(() => null))}`);
    }
  };
  const tap = async (loc, timeout = 60_000) => {
    const el = loc.first();
    await el.waitFor({ state: 'visible', timeout });
    await el.click({ force: true, noWaitAfter: true, timeout });
  };
  const blur = () => G(() => document.activeElement?.blur?.());
  const press = async (key) => {
    await blur();
    await page.keyboard.press(key);
  };
  const clearHints = async () => {
    for (let i = 0; i < 6; i++) {
      const id = await G(() => window.__afterlife.game.hint?.id ?? null);
      if (!id) return;
      await G((x) => window.__afterlife.game.dismissHint(x, true), id); // tutorial tips are not under test here
    }
  };
  const step = (name, fn, opts = {}) =>
    h.step(
      name,
      async () => {
        if (opts.baseline !== false) await baseline();
        await fn();
        const rej = await G(() => (window.__e2e ? window.__e2e.rejections.splice(0) : [])).catch(() => []);
        for (const r of rej) h.recordError('unhandledrejection', r);
      },
      { ...opts, onFail: async () => h.shot(page, `FAIL-${name}`) },
    );
  /** Real mouse hover (two moves so a pointermove always fires), then let the controller re-hover. */
  const hoverAt = async (sx, sy) => {
    await clearHints();
    await page.mouse.move(sx - 3, sy + 2);
    await page.mouse.move(sx, sy);
    await G(frames);
    await G(frames);
    return S();
  };
  const clickAt = async (sx, sy, shift = false) => {
    // W-116 (D-062): a plain click places ONE item and ends placement; Shift+click keeps placing
    if (shift) await page.keyboard.down('Shift');
    try {
      await page.mouse.click(sx, sy);
    } finally {
      if (shift) await page.keyboard.up('Shift');
    }
    await G(frames);
    return S();
  };
  const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
  const toMode = async (key, mode) => {
    await press(key);
    await until(`${mode} mode`, (m) => window.__afterlife.game.mode === m, mode, 15_000);
    await clearHints();
  };
  /**
   * The invariant, for one hover → click at (sx, sy): the sim changed iff the ghost was valid, at the ghost's place,
   * for the previewed price. `expectChange(before, after, ghost)` checks WHAT changed when it was valid.
   */
  const hoverClick = async (tag, pt, { expectValid, expectChange, expectReason, shift = false }) => {
    const pre = await hoverAt(pt.sx, pt.sy);
    const ghost = pre.ghost;
    h.check(`${tag}: ghost shown`, !!ghost, pre.label);
    if (!ghost) return { pre, post: pre, ghost };
    h.check(`${tag}: ghost ${expectValid ? 'GREEN' : 'RED'} as previewed (label "${pre.label}")`, ghost.valid === expectValid, { ghost, label: pre.label });
    if (expectReason) h.check(`${tag}: label says "${expectReason}"`, pre.label === expectReason, pre.label);
    if (ghost.valid) h.check(`${tag}: label shows the price or "Move here"`, /^\$|^Move here/.test(pre.label ?? ''), pre.label);
    const post = await clickAt(pt.sx, pt.sy, shift);
    const changed = post.funds !== pre.funds || JSON.stringify(post.objects) !== JSON.stringify(pre.objects);
    h.check(`${tag}: world changed ⇔ ghost was valid (${ghost.valid ? 'valid → applied' : 'invalid → nothing'})`, changed === ghost.valid, { funds: [pre.funds, post.funds], objects: [pre.ids.length, post.ids.length] });
    if (ghost.valid && changed && expectChange) expectChange(pre, post, ghost);
    return { pre, post, ghost };
  };
  const newIds = (pre, post) => post.ids.filter((i) => !pre.ids.includes(i));
  const undo = async (what, fn, arg) => {
    await press('Control+KeyZ');
    await until(what, fn, arg, 15_000);
  };
  const redo = async (what, fn, arg) => {
    await press('Control+KeyY');
    await until(what, fn, arg, 15_000);
  };
  /** SETUP: set household funds (a player cannot dial an exact balance); returns the previous value. */
  const setFunds = (f) =>
    G((v) => {
      const s = window.__afterlife.game.sim.state.household;
      const prev = s.funds;
      s.funds = v;
      return prev;
    }, f);
  /** Funds edge case at one point: price − 1 → RED "Not enough money" and nothing happens; price exactly → GREEN. */
  const fundsCase = async (tag, pt, price) => {
    const restore = await setFunds(price - 1);
    try {
      await page.mouse.move(pt.sx + 40, pt.sy + 40);
      const r = await hoverClick(`${tag} with $${price - 1} (1 short)`, pt, { expectValid: false, expectReason: 'Not enough money' });
      h.check(`${tag}: 1 short buys nothing`, r.post.funds === price - 1 && r.post.ids.length === r.pre.ids.length, r.post.funds);
      await setFunds(price);
      await page.mouse.move(pt.sx + 40, pt.sy + 40);
      const pre = await hoverAt(pt.sx, pt.sy);
      h.check(`${tag}: exactly affordable ($${price}) is GREEN`, pre.ghost?.valid === true, { ghost: pre.ghost, label: pre.label });
    } finally {
      await setFunds(restore);
    }
  };
  const sellUndoRedo = async (tag, id) => {
    // hover the object with the hand tool (Buy mode, not placing), then Delete sells it
    await until('not placing', () => !window.__afterlife.game.buy.placingDefId, undefined, 25_000);
    const op = await findPoint({ id });
    h.require(`${tag}: the object is on screen for the hand tool`, !!op);
    const pv = await G((i) => window.__afterlife.game.sim.build.preview({ type: 'sell', objectId: i }), id);
    const f0 = (await S()).funds;
    await hoverAt(op.sx, op.sy);
    await until(`${tag} hovered`, (i) => window.__afterlife.game.buy.hoverObjectId === i, id, 25_000);
    await press('Delete');
    await until(`${tag} sold`, (i) => !window.__afterlife.game.sim.state.objects[i], id, 25_000);
    const f1 = (await S()).funds;
    h.check(`${tag}: sold for the previewed refund ${money(-pv.cost)}`, pv.ok && f1 - f0 === -pv.cost, { f0, f1, preview: pv });
    await undo(`${tag} undo sell`, (i) => !!window.__afterlife.game.sim.state.objects[i], id);
    h.check(`${tag}: undo restores it and re-charges the refund`, (await S()).funds === f0);
    await redo(`${tag} redo sell`, (i) => !window.__afterlife.game.sim.state.objects[i], id);
    h.check(`${tag}: redo sells it again for the same refund`, (await S()).funds === f1);
    await undo(`${tag} undo again`, (i) => !!window.__afterlife.game.sim.state.objects[i], id);
    h.check(`${tag}: undo again → back, funds ${money(f0)}`, (await S()).funds === f0);
  };
  /**
   * objectPoint() retried until ≥ 20 s AND ≥ MIN_FRAMES rendered frames (W-115): on a slow CI runner the renderer may
   * not have synced the object yet, or a hint or toast covers every candidate point (CI #35 / main 258220e).
   */
  const findPoint = async (arg) => {
    const t0 = Date.now();
    const f0 = (await G(renderProgress)).frames;
    for (let i = 0; ; i++) {
      const op = await G(objectPoint, arg);
      if (op) return op;
      if (i % 5 === 4) await clearHints();
      const frames = (await G(renderProgress)).frames - f0;
      if ((Date.now() - t0 >= 20_000 && frames >= MIN_FRAMES) || Date.now() - t0 >= 300_000) {
        h.log(`    (object ${arg.id} not pickable after ${((Date.now() - t0) / 1000).toFixed(1)} s / ${frames} frames)`);
        return null;
      }
      await waitFrames(page, 1);
    }
  };
  /** Hand tool: click the object to pick it up (Buy mode, not placing). */
  const pickUp = async (tag, id) => {
    await page.mouse.move(640, 300);
    const op = await findPoint({ id });
    h.require(`${tag}: the object is on screen for the hand tool`, !!op);
    // Wait for the hover pick to land BEFORE clicking (as the sell path does): picking runs on a rendered frame, so on a
    // slow CI runner an immediate click hit nothing (main placement matrix at 258220e: "window picked up" timed out).
    await hoverAt(op.sx, op.sy);
    await until(`${tag} hovered for pick-up`, (i) => window.__afterlife.game.buy.hoverObjectId === i, id, 20_000);
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.mouse.click(op.sx, op.sy);
      const ok = await until(`${tag} pick-up click ${attempt + 1}`, (i) => window.__afterlife.game.buy.movingObjectId === i, id, 10_000, 4).then(() => true, () => false);
      if (ok) break;
      h.log(`    (${tag} pick-up click ${attempt + 1} did not take; hover=${JSON.stringify(await G(() => window.__afterlife.game.buy.hoverObjectId))}; retrying)`);
      await hoverAt(op.sx, op.sy);
    }
    await until(`${tag} picked up`, (i) => window.__afterlife.game.buy.movingObjectId === i, id, 25_000);
  };
  const searchCatalog = async (name, defId) => {
    await page.locator('input[aria-label="Search the catalog"]').first().fill(name);
    await tap(page.locator('button.hud-item').filter({ hasText: name }));
    await until(`placing ${defId}`, (d) => window.__afterlife.game.buy.placingDefId === d, defId, 15_000);
    await clearHints();
  };
  const saved = {};
  /**
   * Wall-mode hotkey (C) until `mode`: cutaway hides doors/windows/wall items on lowered walls from the hand tool.
   * Each press is confirmed before the next (a press the page has not processed yet must not be doubled), then the
   * wall height animation must have SETTLED (renderer test hook, W-115): it advances per rendered frame, so the old
   * fixed 400 ms let picking run against half-raised walls whenever a frame took longer than that.
   */
  const wallMode = async (mode) => {
    for (let i = 0; i < 4; i++) {
      const cur = await G(() => window.__afterlife.game.wallMode);
      if (cur === mode) break;
      await press('KeyC');
      await until(`wall mode to leave ${cur}`, (c) => window.__afterlife.game.wallMode !== c, cur, 15_000);
    }
    await until(`walls ${mode}`, (m) => window.__afterlife.game.wallMode === m, mode, 25_000);
    await until(`walls ${mode} settled (cutaway animation done)`, (m) => window.__afterlife.game.renderer.getWallMode() === m && window.__afterlife.game.renderer.stats().wallsSettled === true, mode, 25_000);
    await waitFrames(page, 2);
  };
  /**
   * Every step after boot starts from the same view (W-115): no dialog, nothing being placed / carried, walls cutaway
   * and settled. A failed step used to leave walls 'up' (or a placement active) and the NEXT step then failed for
   * that reason ("the object is on screen for the hand tool" behind a raised front wall).
   */
  const baseline = async () => {
    await clearHints();
    if (await G(() => window.__afterlife.game.dialog !== null)) {
      await press('Escape');
      await until('no dialog', () => window.__afterlife.game.dialog === null, undefined, 15_000);
    }
    for (let i = 0; i < 3 && (await G(() => !!(window.__afterlife.game.buy.placingDefId || window.__afterlife.game.buy.movingObjectId))); i++) {
      await press('Escape');
      await until('placement / carry cancelled', () => !window.__afterlife.game.buy.placingDefId && !window.__afterlife.game.buy.movingObjectId, undefined, 15_000).catch(() => {});
    }
    await wallMode('cutaway');
  };

  // ───────────────────────────── cold-load warm-up (W-115) ─────────────────────────────
  // Load the game once in a throwaway tab of the same browser context (HTTP cache, compiled scripts, GPU-process
  // shader cache) and let it draw its first frames, so the measured boot below is not the cold start.
  await step('warm-up: cold load once (W-115)', async () => {
    const warm = await context.newPage();
    try {
      const t0 = Date.now();
      await warm.goto(url, { waitUntil: 'domcontentloaded' });
      await warm.waitForFunction(() => window.__afterlife?.game?.screen === 'menu', undefined, { ...POLL, timeout: 300_000 });
      await warm.waitForFunction(() => window.__afterlife.game.renderer.loadProgress() >= 1, undefined, { ...POLL, timeout: 300_000 }).catch(() => {});
      await warm.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined))))));
      h.log(`    cold load to the menu + first frames: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    } finally {
      await warm.close().catch(() => {});
    }
  }, { baseline: false });

  // ───────────────────────────── boot ─────────────────────────────
  await step('boot → new game → in game (paused)', async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await untilScreen('menu');
    if (await page.locator('.st-age-dialog').count()) await page.keyboard.press('Escape');
    await tap(page.locator('.sh-menu__item', { hasText: 'New Game' }));
    await untilScreen('newGame', 60_000);
    await page.locator('.sh-lots [role="radio"]').first().waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {}); if (await page.locator('.sh-lots [role="radio"][data-lot="starter"]').count()) await tap(page.locator('.sh-lots [role="radio"][data-lot="starter"]')); // W-113: the shack is now the default; this suite needs the furnished 'starter' lot
    await until('starter lot selected', () => { const r = document.querySelector('.sh-lots [role="radio"][aria-checked="true"]'); return !r || r.getAttribute('data-lot') === 'starter'; }, undefined, 30_000, 0);
    await tap(page.getByRole('button', { name: 'Create your household' }));
    await untilScreen('caz', 60_000);
    await until('caz valid', () => window.__afterlife.game.validateCaz().length === 0, undefined, 30_000, 0);
    await tap(page.locator('.sh-editor__start'));
    await untilScreen('game');
    await until('HUD', () => window.__afterlife.game.renderer.loadProgress() >= 1 && !!document.querySelector('.hud-funds'), undefined, 180_000, 0);
    await clearHints();
    if ((await G(() => window.__afterlife.game.speed)) !== 0) await press('Digit0');
    await until('paused', () => window.__afterlife.game.speed === 0, undefined, 25_000);
    await G(installGhostSpy);
    h.check('wall mode is cutaway (the owner’s default view)', (await G(() => window.__afterlife.game.wallMode)) === 'cutaway');
  }, { baseline: false });
  const IN_GAME = ['boot → new game → in game (paused)'];

  // ───────────────────────────── in-game warm-up (W-115) ─────────────────────────────
  /**
   * Before the first placement step, use every tool / ghost / wall mode / highlight the suite will use ONCE, without
   * changing the world, and wait until no new shader program is compiled for a few rendered frames. On SwiftShader the
   * first frame that draws a new material compiles its shaders on the main thread (measured locally under load: an
   * 8.4 s frame on the first Build-mode frame), and that stall used to land inside whichever step came first.
   */
  await step('warm-up: shaders and first frames for every tool, ghost and wall mode (W-115)', async () => {
    const settle = async (what) => {
      const r = await waitRenderSettled(page, { stableFrames: 3 });
      h.log(`    warm-up ${what}: settled after ${(r.ms / 1000).toFixed(1)} s (${r.programs} shader programs, last frame ${r.lastFrameMs} ms)`);
    };
    const f0 = await G(renderProgress);
    await settle('in game');
    await toMode('KeyU', 'build');
    for (const kind of ['window', 'door', 'eyedropper']) {
      await tap(page.locator(`.hud-tool[data-hint-anchor="tool-${kind}"]`));
      await until(`${kind} tool (warm-up)`, (k) => window.__afterlife.game.buildTool.kind === k, kind, 25_000);
      await clearHints();
      if (kind !== 'eyedropper') {
        const defId = await G(() => window.__afterlife.game.buildTool.defId);
        await page.mouse.move(640, 300);
        const pt = (await G(edgePoints, { kind: 'opening', defId })).find((p) => p.ok);
        if (pt) await hoverAt(pt.sx, pt.sy); // valid ghost + the raised-for-ghost wall
      }
      await settle(`${kind} tool`);
    }
    for (const m of ['up', 'down', 'cutaway']) {
      await wallMode(m);
      await settle(`walls ${m}`);
    }
    await page.mouse.move(640, 300);
    await press('Escape'); // build tool → select (never opens the pause menu: a non-select tool takes Esc first)
    await toMode('KeyB', 'buy');
    // hand-tool hover highlight on an existing object
    const anyObj = await G(() => Object.keys(window.__afterlife.game.sim.state.objects).find((id) => window.__afterlife.game.sim.state.objects[id].placement.kind === 'floor'));
    const op = anyObj ? await G(objectPoint, { id: anyObj }) : null;
    if (op) await hoverAt(op.sx, op.sy);
    await settle('hand tool hover');
    // Buy-catalog ghosts: a floor item and a wall item (placement started and cancelled: nothing is bought)
    const defs = await G(() => {
      const all = Object.values(window.__afterlife.game.sim.content.objects).filter((d) => d.buyable);
      const pick = (f) => all.filter(f).sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))[0];
      const fl = pick((d) => d.placement === 'floor' && d.footprint.w === 1 && d.footprint.d === 1 && d.price >= 10);
      const wl = pick((d) => d.placement === 'wall' && d.category !== 'doors' && d.category !== 'windows');
      return [fl && { id: fl.id, name: fl.name, kind: 'floor' }, wl && { id: wl.id, name: wl.name, kind: 'wall' }].filter(Boolean);
    });
    for (const d of defs) {
      await searchCatalog(d.name, d.id);
      await page.mouse.move(640, 300);
      const pt = d.kind === 'floor' ? (await G(floorPoints, { defId: d.id, rot: await G(() => window.__afterlife.game.buy.rot) })).find((p) => p.ok) : (await G(edgePoints, { kind: 'wall', defId: d.id })).find((p) => p.ok);
      if (pt) await hoverAt(pt.sx, pt.sy);
      await settle(`${d.kind} item ghost`);
      await page.mouse.move(640, 300);
      await press('Escape');
      await until('warm-up placement cancelled', () => !window.__afterlife.game.buy.placingDefId, undefined, 25_000);
    }
    await page.locator('input[aria-label="Search the catalog"]').first().fill('');
    await page.mouse.move(640, 300);
    h.check('warm-up left the world untouched and paused', await G(() => window.__afterlife.game.speed === 0 && !window.__afterlife.game.buy.placingDefId));
    h.log(`    warm-up rendered ${(await G(renderProgress)).frames - f0.frames} frames`);
  }, { needs: IN_GAME });

  // ───────────────────────────── window (Build mode tool) ─────────────────────────────
  const openingByTool = async (kind) => {
    await toMode('KeyU', 'build');
    await tap(page.locator(`.hud-tool[data-hint-anchor="tool-${kind}"]`));
    await until(`${kind} tool`, (k) => window.__afterlife.game.buildTool.kind === k, kind, 25_000);
    await clearHints();
    const defId = await G(() => window.__afterlife.game.buildTool.defId);
    const price = await G((d) => window.__afterlife.game.sim.content.objects[d].price, defId);
    await page.mouse.move(640, 300);
    const pts = await G(edgePoints, { kind: 'opening', defId });
    const valid = pts.filter((p) => p.ok);
    // the owner's case: a wall that cutaway lowered (front wall) — prefer one for windows
    const target = (kind === 'window' && valid.find((p) => p.lowered)) || valid[0];
    h.require(`${kind}: a visible wall edge where the ${defId} fits`, !!target, pts.slice(0, 6));
    h.log(`    ${kind} target ${target.edge} (lowered by cutaway: ${target.lowered}); ${valid.length}/${pts.length} visible edges valid`);
    let placedId = null;
    const r = await hoverClick(`${kind} tool on ${target.edge}`, target, {
      expectValid: true,
      expectChange: (pre, post, ghost) => {
        const ids = newIds(pre, post);
        placedId = ids[0] ?? null;
        h.check(`${kind}: exactly one ${defId} added`, ids.length === 1 && post.objects[ids[0]].defId === defId, ids);
        h.check(`${kind}: placed on the ghost's edge ${ghost.edge}`, ids.length === 1 && post.objects[ids[0]].placement.edge === ghost.edge, ids.length ? post.objects[ids[0]].placement : null);
        h.check(`${kind}: charged the previewed ${money(price)}`, post.funds === pre.funds - price, { before: pre.funds, after: post.funds });
      },
    });
    h.require(`${kind}: placed`, !!placedId);
    await until(`${kind} drawn (not hidden with a lowered wall)`, (i) => {
      const sc = window.__afterlife.game.renderer.scene();
      const o = sc && sc.getObjectByName(`obj:${i}`);
      if (!o) return false;
      for (let n = o; n; n = n.parent) if (!n.visible) return false;
      return true;
    }, placedId, 15_000);
    h.check(`${kind}: the placed ${defId} is visible${target.lowered ? ' on the cutaway-lowered wall (owner bug: placed but hidden)' : ''}`, await G(objectVisible, { id: placedId }));
    await h.shot(page, `${kind}-build-tool-placed`);
    // invalid: the same spot is now occupied → RED, click changes nothing
    await page.mouse.move(target.sx + 40, target.sy + 40);
    await hoverClick(`${kind} tool again on ${target.edge} (occupied)`, target, { expectValid: false });
    if (kind === 'window') await h.shot(page, `${kind}-build-tool-occupied-red`); // SwiftShader shots cost ~40 s each
    // funds edge case on another valid edge
    const other = (await G(edgePoints, { kind: 'opening', defId })).find((p) => p.ok && p.edge !== target.edge);
    if (h.check(`${kind}: a second free edge for the funds case`, !!other)) await fundsCase(`${kind} tool on ${other.edge}`, other, price);
    // a click off any wall must not buy (stale hover command)
    const before = await S();
    await page.mouse.move(target.sx + 40, target.sy + 40);
    const sky = { sx: 200, sy: 160 };
    const off = await hoverAt(sky.sx, sky.sy);
    if (!off.ghost) {
      const post = await clickAt(sky.sx, sky.sy);
      h.check(`${kind}: a click with no ghost (off the walls) buys nothing`, post.funds === before.funds && post.ids.length === before.ids.length, { funds: [before.funds, post.funds] });
    } else h.log(`    (${kind}: point ${sky.sx},${sky.sy} still has a ghost on ${off.ghost.edge}; stale-click case skipped)`);
    saved[kind] = { id: placedId, defId, price, edge: target.edge };
    void r;
  };
  await step('window: Build-mode tool → place (cutaway wall), occupied RED, funds short RED', () => openingByTool('window'), { needs: IN_GAME });
  await step('door: Build-mode tool → place, occupied RED, funds short RED', () => openingByTool('door'), { needs: IN_GAME });

  // ───────────────────────────── window from Buy mode (eyedropper copy → Buy placement) ─────────────────────────────
  await step('window: Buy-mode placement (eyedropper copy) → place, occupied RED', async () => {
    const w = saved.window;
    await toMode('KeyU', 'build');
    await wallMode('up');
    await tap(page.locator('.hud-tool[data-hint-anchor="tool-eyedropper"]'));
    await until('eyedropper', () => window.__afterlife.game.buildTool.kind === 'eyedropper', undefined, 25_000);
    await page.mouse.move(640, 300);
    // the eyedropper picks with walls too: the copied window must be the first thing under the cursor
    const op = await findPoint({ id: w.id, walls: true });
    h.require('the placed window can be eyedropped', !!op);
    await hoverAt(op.sx, op.sy);
    await page.mouse.click(op.sx, op.sy);
    await until('Buy mode placing a window copy', (d) => window.__afterlife.game.mode === 'buy' && window.__afterlife.game.buy.placingDefId === d, w.defId, 15_000);
    await clearHints();
    await page.mouse.move(640, 300);
    const pts = await G(edgePoints, { kind: 'opening', defId: w.defId });
    const target = pts.find((p) => p.ok && p.edge !== w.edge);
    h.require('a free wall edge for the Buy-mode window', !!target);
    let placed = null;
    await hoverClick(`Buy-mode window on ${target.edge}`, target, {
      expectValid: true,
      expectChange: (pre, post, ghost) => {
        const ids = newIds(pre, post);
        placed = ids[0];
        h.check('Buy-mode window: one window added on the ghost edge for its price', ids.length === 1 && post.objects[ids[0]].placement.edge === ghost.edge && post.funds === pre.funds - w.price, { ids, funds: [pre.funds, post.funds] });
      },
    });
    h.require('Buy-mode window placed', !!placed);
    // W-116 (D-062): the eyedropper copy placed ONE window and returned to the catalog (no stray second purchase)
    await until('eyedropper placement ended after one window', () => !window.__afterlife.game.buy.placingDefId, undefined, 15_000);
    h.check('Buy-mode window: one click = one window, placement ended', !(await G(() => window.__afterlife.game.buy.placingDefId)));
    // re-enter placement explicitly (as the player would from the catalog) for the occupied / funds cases
    await G((d) => window.__afterlife.game.startPlacing(d), w.defId);
    await until('placing the window copy again', (d) => window.__afterlife.game.buy.placingDefId === d, w.defId, 15_000);
    await page.mouse.move(target.sx + 40, target.sy + 40);
    await hoverClick(`Buy-mode window again on ${target.edge} (occupied)`, target, { expectValid: false });
    await fundsCase('Buy-mode window', (await G(edgePoints, { kind: 'opening', defId: w.defId })).find((p) => p.ok) ?? target, w.price);
    await h.shot(page, 'window-buy-mode-placed');
    await press('Escape');
    await until('placement cancelled', () => !window.__afterlife.game.buy.placingDefId, undefined, 25_000);
    saved.window2 = { ...w, id: placed, edge: target.edge };
    await wallMode('cutaway');
  }, { needs: ['window: Build-mode tool → place (cutaway wall), occupied RED, funds short RED'] });

  // ───────────────────────────── move / sell / undo openings (Buy hand tool) ─────────────────────────────
  const moveOpening = async (key) => {
    const o = saved[key];
    await toMode('KeyB', 'buy');
    if (await G(() => !!window.__afterlife.game.buy.placingDefId)) await press('Escape');
    await wallMode('up');
    await pickUp(`${key}`, o.id);
    await page.mouse.move(640, 300);
    const pts = await G(edgePoints, { kind: 'opening', defId: o.defId, objectId: o.id });
    const bad = pts.find((p) => !p.ok);
    if (bad) await hoverClick(`move ${key}: onto ${bad.edge} ("${bad.reason}")`, bad, { expectValid: false });
    const good = pts.find((p) => p.ok && p.edge !== o.edge);
    h.require(`move ${key}: a free edge to move to`, !!good);
    await page.mouse.move(good.sx + 40, good.sy + 40);
    await hoverClick(`move ${key}: onto ${good.edge}`, good, {
      expectValid: true,
      expectChange: (pre, post, ghost) => {
        h.check(`move ${key}: moved to the ghost edge, free of charge, same object`, post.objects[o.id]?.placement.edge === ghost.edge && post.funds === pre.funds && post.ids.length === pre.ids.length, post.objects[o.id]);
      },
    });
    await until(`${key} dropped`, () => !window.__afterlife.game.buy.movingObjectId, undefined, 25_000);
    await h.shot(page, `${key}-moved`);
    await sellUndoRedo(`sell ${key}`, o.id);
    await wallMode('cutaway');
  };
  await step('window: move (Buy hand tool), sell, undo/redo', () => moveOpening('window'), { needs: ['window: Build-mode tool → place (cutaway wall), occupied RED, funds short RED'] });
  await step('door: move (Buy hand tool), sell, undo/redo', () => moveOpening('door'), { needs: ['door: Build-mode tool → place, occupied RED, funds short RED'] });

  // ───────────────────────────── wall item (Buy catalog) ─────────────────────────────
  await step('wall item: Buy catalog → place, occupied RED, funds short RED, move, sell, undo/redo', async () => {
    await toMode('KeyB', 'buy');
    const def = await G(() => {
      const defs = Object.values(window.__afterlife.game.sim.content.objects).filter((d) => d.buyable && d.placement === 'wall' && d.category !== 'doors' && d.category !== 'windows');
      defs.sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
      return defs[0] ? { id: defs[0].id, name: defs[0].name, price: defs[0].price } : null;
    });
    h.require('a buyable wall item exists', !!def, def);
    await searchCatalog(def.name, def.id);
    await page.mouse.move(640, 300);
    const pts = await G(edgePoints, { kind: 'wall', defId: def.id });
    // A face cutaway does NOT lower (W-115): the item stays pickable when the hand tool raises the walls below. On a
    // lowered front wall it ends up low on the raised wall, under the catalog panel, and "the object is on screen for
    // the hand tool" failed whenever a toast or tip happened to hide the back-wall candidates while picking a target.
    const target = pts.find((p) => p.ok && !p.lowered) ?? pts.find((p) => p.ok);
    h.require('a wall face where it fits', !!target, pts.slice(0, 5));
    let id = null;
    await hoverClick(`wall item on ${target.edge}/${target.side} (Shift+click)`, target, {
      expectValid: true,
      shift: true,
      expectChange: (pre, post, ghost) => {
        const ids = newIds(pre, post);
        id = ids[0];
        h.check('wall item: one added on the ghost edge + side for its price', ids.length === 1 && post.objects[ids[0]].placement.edge === ghost.edge && post.objects[ids[0]].placement.side === ghost.side && post.funds === pre.funds - def.price, { ids, placement: ids[0] && post.objects[ids[0]].placement, ghost });
      },
    });
    h.require('wall item placed', !!id);
    h.check('wall item: Shift+click kept placing (W-116)', (await G(() => window.__afterlife.game.buy.placingDefId)) === def.id);
    await page.mouse.move(target.sx + 40, target.sy + 40);
    await hoverClick(`wall item again on ${target.edge} (occupied)`, target, { expectValid: false });
    const other = (await G(edgePoints, { kind: 'wall', defId: def.id })).find((p) => p.ok);
    if (h.check('wall item: a second free face for the funds case', !!other)) await fundsCase(`wall item on ${other.edge}`, other, def.price);
    await h.shot(page, 'wall-item-placed');
    await press('Escape');
    await until('placement cancelled', () => !window.__afterlife.game.buy.placingDefId, undefined, 25_000);
    await wallMode('up');
    await pickUp('wall item', id);
    await page.mouse.move(640, 300);
    const mv = (await G(edgePoints, { kind: 'wall', defId: def.id, objectId: id })).find((p) => p.ok && p.edge !== target.edge);
    h.require('wall item: a free face to move to', !!mv);
    await hoverClick(`move wall item onto ${mv.edge}/${mv.side}`, mv, {
      expectValid: true,
      expectChange: (pre, post, ghost) => h.check('wall item moved to the ghost edge/side, free', post.objects[id]?.placement.edge === ghost.edge && post.objects[id]?.placement.side === ghost.side && post.funds === pre.funds, post.objects[id]),
    });
    await until('wall item dropped', () => !window.__afterlife.game.buy.movingObjectId, undefined, 25_000);
    await sellUndoRedo('sell wall item', id);
    await wallMode('cutaway');
  }, { needs: IN_GAME });

  // ───────────────────────────── floor item (Buy catalog) ─────────────────────────────
  await step('floor item: Buy catalog → rotate, place, occupied RED, funds short RED, move+rotate, sell, undo/redo', async () => {
    await toMode('KeyB', 'buy');
    if (await G(() => !!window.__afterlife.game.buy.placingDefId)) await press('Escape');
    const def = await G(() => {
      const defs = Object.values(window.__afterlife.game.sim.content.objects).filter((d) => d.buyable && d.placement === 'floor' && d.footprint.w === 1 && d.footprint.d === 1 && d.price >= 10);
      defs.sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
      return defs[0] ? { id: defs[0].id, name: defs[0].name, price: defs[0].price } : null;
    });
    h.require('a cheap 1×1 floor item exists', !!def, def);
    await searchCatalog(def.name, def.id);
    const rot0 = (await S()).rot;
    await press('KeyR');
    await until('rotated', (r) => window.__afterlife.game.buy.rot === (r + 1) % 4, rot0, 25_000);
    const rot = (rot0 + 1) % 4;
    await page.mouse.move(640, 300);
    const pts = await G(floorPoints, { defId: def.id, rot });
    const target = pts.find((p) => p.ok);
    h.require('a free visible tile', !!target);
    let id = null;
    await hoverClick(`floor item at ${target.x},${target.z} rot ${rot}`, target, {
      expectValid: true,
      expectChange: (pre, post, ghost) => {
        const ids = newIds(pre, post);
        id = ids[0];
        const pl = ids[0] && post.objects[ids[0]].placement;
        h.check('floor item: one added at the ghost tile + rotation for its price', ids.length === 1 && pl.x === ghost.x && pl.z === ghost.z && pl.rot === ghost.rot && ghost.rot === rot && post.funds === pre.funds - def.price, { pl, ghost });
      },
    });
    h.require('floor item placed', !!id);
    // W-116 (D-062): one click = one item → back to the catalog, the bar gone, the card still highlighted
    await until('floor placement ended after one item', () => !window.__afterlife.game.buy.placingDefId && !document.querySelector('[data-testid="placement-bar"]'), undefined, 15_000);
    {
      // the playtest bug: a second click right after placing must NOT buy another copy
      const free = (await G(floorPoints, { defId: def.id, rot })).find((p) => p.ok);
      if (free) {
        const pre2 = await hoverAt(free.sx, free.sy);
        const post2 = await clickAt(free.sx, free.sy);
        h.check('floor item: a second click after placing buys nothing (W-116)', post2.funds === pre2.funds && post2.ids.length === pre2.ids.length, { funds: [pre2.funds, post2.funds], ids: [pre2.ids.length, post2.ids.length] });
      } else h.log('    (no second free tile on screen for the second-click check)');
    }
    h.check('floor item: the catalog keeps the item highlighted', await G((d) => window.__afterlife.game.buy.lastDefId === d, def.id));
    // re-enter from the catalog card, then the placement bar shows name, price, hint and Done
    await searchCatalog(def.name, def.id);
    await until('placement bar', () => !!document.querySelector('[data-testid="placement-bar"] [data-testid="placement-done"]'), undefined, 15_000);
    const bar = await G(() => {
      const b = document.querySelector('[data-testid="placement-bar"]');
      const d = b?.querySelector('[data-testid="placement-done"]')?.getBoundingClientRect();
      return { text: b?.textContent ?? '', done: d ? { w: d.width, h: d.height } : null };
    });
    h.check('placement bar: item name, price and the Shift hint', bar.text.includes(def.name) && bar.text.includes(money(def.price)) && /Shift\+click to keep placing/.test(bar.text), bar);
    if ((await G(() => window.__afterlife.game.buy.rot)) !== rot) {
      await press('KeyR');
      await until('rotation restored', (r) => window.__afterlife.game.buy.rot === r, rot, 15_000);
    }
    await page.mouse.move(target.sx + 40, target.sy + 40);
    await hoverClick(`floor item again at ${target.x},${target.z} (occupied)`, target, { expectValid: false });
    const other = (await G(floorPoints, { defId: def.id, rot })).find((p) => p.ok);
    if (h.check('floor item: a second free tile for the funds case', !!other)) await fundsCase(`floor item at ${other.x},${other.z}`, other, def.price);
    await h.shot(page, 'floor-item-placed');
    // the bar's Done ends placement (Esc is covered by the other steps)
    await tap(page.locator('[data-testid="placement-done"]'));
    await until('placement done (Done button)', () => !window.__afterlife.game.buy.placingDefId, undefined, 25_000);
    // move + rotate: pick it up, R, drop on another tile
    await pickUp('floor item', id);
    const r1 = (await S()).rot;
    await press('KeyR');
    await until('carried item rotated', (r) => window.__afterlife.game.buy.rot === (r + 1) % 4, r1, 25_000);
    const rot2 = (r1 + 1) % 4;
    await page.mouse.move(640, 300);
    const mv = (await G(floorPoints, { defId: def.id, rot: rot2, objectId: id })).find((p) => p.ok && (p.x !== target.x || p.z !== target.z));
    h.require('floor item: a free tile to move to', !!mv);
    await hoverClick(`move floor item to ${mv.x},${mv.z} rot ${rot2}`, mv, {
      expectValid: true,
      expectChange: (pre, post, ghost) => {
        const pl = post.objects[id]?.placement;
        h.check('floor item moved + rotated exactly as the ghost showed, free', pl && pl.x === ghost.x && pl.z === ghost.z && pl.rot === ghost.rot && pl.rot === rot2 && post.funds === pre.funds, { pl, ghost });
      },
    });
    await until('floor item dropped', () => !window.__afterlife.game.buy.movingObjectId, undefined, 25_000);
    await h.shot(page, 'floor-item-moved-rotated');
    await sellUndoRedo('sell floor item', id);
  }, { needs: IN_GAME });

  // ───────────────────────────── vehicles (W-031 not built) ─────────────────────────────
  h.results.push({ name: 'vehicles (W-031 not built)', status: 'PENDING', ms: 0, checks: 0, failed: 0, failedChecks: 0, detail: 'vehicle system W-031 not built yet (art only, PR #8): buy / place / move / sell vehicles to be added here' });
  h.log('\n-- vehicles (W-031 not built): PENDING (not run, not counted as passing)');

  await context.close();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code));
}
