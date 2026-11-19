/**
 * UI-HUD against the REAL game: built bundle, real GameController / simulation / renderer (WebGL via SwiftShader).
 * Boots once (menu → New Game → Create-a-Zombie → Start), then drives the HUD through every state with real data
 * and writes <out>/real-<state>@<w>x<h>.png plus a JSON report (timings, checks, console errors, perf samples).
 *
 *   npx vite build --outDir /tmp/al-dist && npx vite preview --outDir /tmp/al-dist --port 4178 --strictPort &
 *   node dev/ui-hud.real.cjs [outDir=dev/out/ui-hud/real] [url=http://localhost:4178/] [--only=a,b] [--set=base,stress,keys]
 *        [--sizes=1600x900,1280x720]
 *
 * SwiftShader renders on the CPU: boot takes 1–3 min and each capture a few seconds. The script drops the game to
 * low quality / 0.5 pixel ratio (persisted, then reloads) like dev/game.smoke.cjs. Test-only state edits (long names,
 * huge funds, an injected life-event letter) go through window.__afterlife.game.sim.state, never through the HUD.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const pos = argv.filter((a) => !a.startsWith('--'));
const flag = (name, def) => {
  const a = argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const OUT = path.resolve(pos[0] || path.join(__dirname, 'out', 'ui-hud', 'real'));
const URL = pos[1] || 'http://localhost:4178/';
const ONLY = flag('only', '').split(',').filter(Boolean);
const SETS = flag('set', 'base,stress,keys').split(',').filter(Boolean);
const SIZES = flag('sizes', '1600x900,1280x720')
  .split(',')
  .map((s) => s.split('x').map(Number));

const report = { url: URL, started: new Date().toISOString(), boot: {}, shots: [], checks: [], perf: {}, errors: [] };
const checks = report.checks;
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail === undefined ? null : detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail !== undefined ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: SIZES[0][0], height: SIZES[0][1] } });
  const page = await context.newPage();
  page.setDefaultTimeout(240000);
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') report.errors.push(`[${m.type()}] ${m.text()}`.slice(0, 400));
  });
  page.on('pageerror', (e) => report.errors.push(`[pageerror] ${e.message}`.slice(0, 400)));

  const G = (fn, arg) => page.evaluate(fn, arg);
  const state = () => G(() => {
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
  /** Wait until the page has produced `n` animation frames (SwiftShader: frames are slow, this is the real "settle"). */
  const frames = (n = 2) => G((k) => new Promise((res) => { let i = 0; const f = () => (++i >= k ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  let curSize = SIZES[0];
  const size = async ([w, h]) => {
    if (curSize[0] === w && curSize[1] === h) return;
    await page.setViewportSize({ width: w, height: h });
    curSize = [w, h];
    await page.waitForTimeout(300);
    await frames(1);
  };
  const shot = async (name, opts = {}) => {
    const [w, h] = curSize;
    const file = path.join(OUT, `real-${name}@${w}x${h}.png`);
    const t = Date.now();
    // The capture itself waits for a fresh compositor frame (HUD renders are rAF-coalesced, so they land in it).
    if (opts.frames) await frames(opts.frames);
    else await page.waitForTimeout(120);
    await page.screenshot({ path: file, timeout: 240000 });
    const ms = Date.now() - t;
    report.shots.push({ name, size: `${w}x${h}`, ms });
    console.log(`  · ${name}@${w}x${h} (${ms} ms)`);
  };
  const want = (name) => ONLY.length === 0 || ONLY.some((o) => name.includes(o));
  /** Run a scene: setup once, then capture at each size (setupPerSize re-runs setup after every resize). */
  const scene = async (name, setup, opts = {}) => {
    if (!want(name)) return;
    const t = Date.now();
    try {
      if (!opts.perSize && setup) await setup();
      for (const s of opts.sizes || SIZES) {
        await size(s);
        if (opts.perSize && setup) await setup(s);
        if (opts.before) await opts.before(s);
        await shot(name, opts);
        if (opts.after) await opts.after(s);
      }
      if (opts.cleanup) await opts.cleanup();
    } catch (e) {
      report.errors.push(`[scene ${name}] ${e.message}`.slice(0, 400));
      console.log(`✗ scene ${name}: ${e.message.split('\n')[0]}`);
      try {
        await page.keyboard.press('Escape');
        await G(() => { const g = window.__afterlife.game; g.closeMenu(); if (g.dialog) g.closeDialog(); });
      } catch {
        /* keep going */
      }
    }
    console.log(`scene ${name}: ${Date.now() - t} ms`);
  };

  try {
    // ── boot → menu (low quality, persisted) → reload → menu ──
    let t0 = Date.now();
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await waitFor((s) => s.screen === 'menu' || s.fatal, 420000, 'menu');
    report.boot.menuMs = Date.now() - t0;
    await G(() => window.__afterlife.game.updateSettings({ quality: 'low', pixelRatio: 0.5, autosaveMinutes: 0, pauseWhenUnfocused: false, muteWhenUnfocused: true }));
    await page.waitForTimeout(1200);
    t0 = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitFor((s) => s.screen === 'menu' || s.fatal, 420000, 'menu after reload');
    report.boot.menuReloadMs = Date.now() - t0;
    // ── New Game → CAZ (4 members) → game ──
    await G(() => window.__afterlife.game.goto('newGame'));
    await page.waitForTimeout(500);
    await G(() => {
      const g = window.__afterlife.game;
      g.beginNewGame();
      g.addCazMember();
      g.addCazMember();
      g.addCazMember();
    });
    const cazErrors = await G(() => window.__afterlife.game.validateCaz());
    check('CAZ valid with 4 members', cazErrors.length === 0, cazErrors);
    t0 = Date.now();
    await G(() => window.__afterlife.game.startGame());
    await waitFor((s) => s.screen === 'game' || s.fatal, 240000, 'game');
    report.boot.gameMs = Date.now() - t0;
    await page.waitForSelector('.hud-topbar', { timeout: 120000 });
    await frames(4);
    console.log('boot', JSON.stringify(report.boot));

    const ids = await G(() => {
      const g = window.__afterlife.game;
      const s = g.sim;
      const objs = Object.values(s.state.objects);
      const by = (re) => (objs.find((o) => re.test(o.defId)) || {}).id || null;
      return {
        members: s.household().map((m) => m.id),
        fridge: by(/^fridge/),
        tv: by(/^tv_/),
        sofa: by(/^sofa/),
        stove: by(/^stove/),
        mirror: by(/^mirror/),
        mailbox: by(/^mailbox/),
        coffin: by(/^coffin/),
      };
    });
    console.log('ids', JSON.stringify(ids));
    const [m1, m2] = ids.members;

    // ── tutorial hint (first thing a new player sees) ──
    if (SETS.includes('base')) {
      await scene('hint', async () => {
        await page.waitForSelector('.hud-hint-bubble', { timeout: 15000 }).catch(() => null);
      }, { sizes: [SIZES[0]] });
    }
    // Hints off from here on so they don't cover other states (dismiss through the real button first).
    await page.click('.hud-hint-bubble >> text=Got it', { timeout: 5000 }).catch(() => null);
    await G(() => window.__afterlife.game.updateSettings({ tutorialEnabled: false }));
    await G((id) => window.__afterlife.game.selectAgent(id), m1);
    await frames(3);

    if (SETS.includes('base')) {
      // ── live mode: agent panel tabs with real sim data ──
      const tab = async (label) => {
        await page.click(`.hud-agent__tabs [role="tab"][aria-label="${label}"]`);
        await frames(2);
      };
      await scene('live-needs', () => tab('Needs'));
      await scene('live-mood', () => tab('Mood'));
      await scene('live-mood-breakdown', async () => {
        await tab('Mood');
        await page.click('text=What adds up').catch(() => null);
      });
      await scene('live-skills', () => tab('Skills'));
      await scene('live-career', () => tab('Career'));
      await scene('live-relationships', () => tab('Relationships'));
      await scene('live-aspiration', () => tab('Aspiration'));
      await scene('live-info', () => tab('Info'));
      await tab('Needs');

      // ── interaction menus on real objects / zombies (positioned per viewport) ──
      const openMenu = async (target, fx, fy) => {
        await G(({ target, fx, fy }) => {
          const g = window.__afterlife.game;
          g.closeMenu();
          g.openMenuFor(target, Math.round(innerWidth * fx), Math.round(innerHeight * fy));
        }, { target, fx, fy });
        await page.waitForSelector('.hud-imenu', { timeout: 120000 });
        await frames(3);
      };
      const closeMenu = () => G(() => window.__afterlife.game.closeMenu());
      if (ids.fridge) {
        await scene('menu-fridge', (s) => openMenu({ kind: 'object', id: ids.fridge }, 0.66, 0.62), { perSize: true, after: closeMenu });
        await scene('menu-fridge-children', async () => {
          await openMenu({ kind: 'object', id: ids.fridge }, 0.66, 0.5);
          // keyboard into the first row that has a submenu (recipes)
          const n = await page.locator('.hud-imenu[data-level="0"] [data-idx]').count();
          for (let i = 0; i < n; i++) {
            const has = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-haspopup'));
            if (has === 'menu') break;
            await page.keyboard.press('ArrowDown');
          }
          await page.keyboard.press('ArrowRight');
          await page.waitForSelector('.hud-imenu.is-flyout', { timeout: 5000 }).catch(() => null);
          await page.keyboard.press('ArrowDown');
          await frames(2);
          // the open row's glyph must stay visible (dark on the toxic-green chip)
          const icon = await G(() => {
            const el = document.querySelector('.hud-imenu__row.is-open .hud-imenu__icon');
            const svg = el && el.querySelector('svg');
            if (!el || !svg) return null;
            const cs = getComputedStyle(el);
            const r = svg.getBoundingClientRect();
            return { color: cs.color, bg: cs.backgroundColor, svgW: r.width, svgH: r.height, stroke: getComputedStyle(svg).stroke, html: svg.outerHTML.slice(0, 300) };
          });
          report.menuIcon = icon;
          check('open menu row keeps a visible glyph', !!icon && icon.svgW > 4 && icon.color !== icon.bg, icon);
        }, { perSize: true, after: closeMenu });
      }
      if (m2) {
        await scene('menu-agent', async () => {
          await G((id) => window.__afterlife.game.selectAgent(id), m1);
          await openMenu({ kind: 'agent', id: m2 }, 0.45, 0.45);
          const g = page.locator('.hud-imenu[data-level="0"] .hud-imenu__row.is-group').first();
          if (await g.count()) {
            await g.hover();
            await page.waitForSelector('.hud-imenu.is-flyout', { timeout: 5000 }).catch(() => null);
          }
          await frames(2);
        }, { perSize: true, after: closeMenu });
      }
      if (ids.tv) await scene('menu-tv', () => openMenu({ kind: 'object', id: ids.tv }, 0.3, 0.3), { perSize: true, after: closeMenu });

      // ── action queue: queue real interactions through the menu UI ──
      await scene('queue', async () => {
        // Queue real interactions through the controller's own menu path (open → choose an entry of THAT menu),
        // in the page: fast and deterministic even at SwiftShader frame rates.
        const q = await G((targets) => {
          const g = window.__afterlife.game;
          g.setSpeed(0);
          const picked = [];
          for (const target of targets) {
            g.closeMenu();
            g.openMenuFor(target, 400, 300);
            const m = g.menu;
            if (!m) continue;
            const leaf = m.entries.find((e) => e.available && !(e.children && e.children.length) && e.interactionId !== '__game_select');
            const withKids = m.entries.find((e) => e.available && e.children && e.children.some((c) => c.available));
            if (withKids && picked.length % 2 === 1) {
              g.chooseMenuEntry(withKids, withKids.children.find((c) => c.available));
              picked.push(`${withKids.label} > ${withKids.children.find((c) => c.available).label}`);
            } else if (leaf) {
              g.chooseMenuEntry(leaf);
              picked.push(leaf.label);
            }
          }
          g.closeMenu();
          const id = g.selectedAgentId;
          return { picked, queue: g.sim.queueView(id).map((x) => `${x.active ? '*' : ''}${x.label}`), active: g.sim.agent(id) && g.sim.agent(id).active ? { id: g.sim.agent(id).active.interactionId, phase: g.sim.agent(id).active.phase, elapsed: g.sim.agent(id).active.elapsed } : null };
        }, [ids.tv, ids.mirror, ids.fridge, ids.sofa, ids.coffin].filter(Boolean).map((id) => ({ kind: 'object', id })));
        check('queue has player items', q.queue.length >= 3, q);
        await page.waitForSelector('.hud-qitem', { timeout: 30000 });
      }, { cleanup: () => G(() => window.__afterlife.game.setSpeed(1)) });

      // ── toasts (real notifications: cheats post 'info' + a funds change floater) ──
      // At SwiftShader frame rates a toast's 6 s HUD lifetime can run out before a capture finishes, so for this scene
      // the harness (not the HUD) turns the controller's dismissToast into a no-op and restores it afterwards.
      let toastCount = 0;
      await scene('toasts', async () => {
        await G(() => {
          const g = window.__afterlife.game;
          window.__realDismiss = window.__realDismiss || g.dismissToast.bind(g);
          g.dismissToast = () => undefined;
          g.setSpeed(1);
          g.sim.dispatch({ type: 'cheat', code: 'freshstart' });
          g.sim.dispatch({ type: 'cheat', code: 'motherlode' });
        });
        await page.waitForSelector('.hud-toast', { timeout: 120000 });
        toastCount = await page.locator('.hud-toast').count();
      }, {
        cleanup: () => G(() => {
          const g = window.__afterlife.game;
          if (window.__realDismiss) {
            g.dismissToast = window.__realDismiss;
            for (const t of g.toasts.slice()) g.dismissToast(t.id);
          }
        }),
      });
      check('toasts render from real notifications', toastCount >= 1, toastCount);
      await page.mouse.move(5, curSize[1] / 2);

      // ── notices drawer ──
      await scene('log', async () => {
        await page.click('button[aria-label="Notices"]');
        await page.waitForSelector('.hud-log');
      }, { cleanup: async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(300); } });

      // ── choice letter: a real life-event choice from content, offered exactly like the sim's fireLifeEvent ──
      await scene('choice', async () => {
        const ok = await G((agentId) => {
          const g = window.__afterlife.game;
          const s = g.sim;
          const ev = (s.content.lifeEvents || []).find((e) => e && e.choice && Array.isArray(e.choice.options) && e.choice.options.length >= 2);
          if (!ev) return false;
          const safeIdx = ev.choice.options.findIndex((o) => o && o.params && o.params.safe === true);
          s.state.choices.push({
            id: `c-hud-${s.state.tick}`,
            tick: s.state.tick,
            title: ev.choice.title,
            text: ev.choice.text,
            agentId,
            options: ev.choice.options.map((o) => ({ label: o.label, effect: o.effect, params: { ...(o.params || {}), agentId }, tooltip: o.tooltip || null })),
            expiresTick: s.state.tick + 480,
            defaultOption: safeIdx >= 0 ? safeIdx : 0,
          });
          return true;
        }, m1);
        check('life-event choice available in content', ok);
        await page.waitForSelector('.hud-choice', { timeout: 120000 });
      });
      // resolve it through the real UI (digit key inside the letter)
      if (await page.locator('.hud-choice').count()) {
        await page.focus('.hud-choice__opt >> nth=0');
        const speedBefore = await G(() => window.__afterlife.game.speed);
        await page.keyboard.press('Digit1');
        await page.waitForTimeout(600);
        const after = await G(() => ({ n: window.__afterlife.game.sim.state.choices.length, speed: window.__afterlife.game.speed }));
        check('choice letter: Digit1 resolves via controller, speed untouched', after.n === 0 && after.speed === speedBefore, after);
      }

      // ── HUD dialogs ──
      const dialog = async (id) => {
        await G((d) => window.__afterlife.game.openDialog(d), id);
        await page.waitForSelector('.hud-dialog', { timeout: 120000 });
        await frames(2);
      };
      const closeDialog = async () => {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(350);
      };
      for (const d of ['phone', 'careers', 'invite', 'rewards', 'household']) await scene(`dialog-${d}`, () => dialog(d), { cleanup: closeDialog });
      await scene('dialog-party', async () => {
        await dialog('phone');
        await page.click('.hud-ptile.is-party');
        await page.waitForSelector('.hud-dialog--invite');
        const c = page.locator('.hud-check:not([disabled])');
        const n = await c.count();
        for (let i = 0; i < Math.min(2, n); i++) await c.nth(i).click();
      }, { cleanup: closeDialog });

      // ── party HUD: throw a real party (phone → party) and step the sim until it starts ──
      await scene('party', async () => {
        await G((id) => window.__afterlife.game.selectAgent(id), m1);
        await G(() => window.__afterlife.game.phone('party'));
        const started = await G(() => {
          const g = window.__afterlife.game;
          for (let i = 0; i < 2400; i++) {
            g.sim.step();
            const p = g.sim.party();
            if (p && p.active) return { tick: g.sim.state.tick, guests: p.guests };
          }
          return null;
        });
        check('real party starts within 10 game hours', !!started, started);
        if (!started) throw new Error('no party');
        await page.waitForSelector('.hud-party', { timeout: 120000 });
      });

      // ── buy mode: real catalog + renderer thumbnails ──
      await scene('buy', async () => {
        await G(() => window.__afterlife.game.setMode('buy'));
        await page.waitForSelector('.hud-buy', { timeout: 180000 });
        await page.click('.hud-cat >> nth=1').catch(() => null);
        // let the renderer produce thumbnails (offscreen renders on the CPU)
        const t = Date.now();
        for (;;) {
          const pending = await page.locator('.hud-thumb.is-loading, .hud-thumb__shimmer').count().catch(() => 0);
          if (pending === 0 || Date.now() - t > 90000) break;
          await page.waitForTimeout(1000);
        }
        const imgs = await page.locator('.hud-item img').count();
        check('buy catalog shows real renderer thumbnails', imgs > 0, imgs);
        await page.hover('.hud-item >> nth=2');
        await page.waitForTimeout(400);
      });
      await scene('buy-placing', async () => {
        await page.click('.hud-item >> nth=1');
        await page.mouse.move(curSize[0] * 0.55, curSize[1] * 0.45);
        await page.waitForTimeout(300);
        await page.mouse.move(curSize[0] * 0.56, curSize[1] * 0.46);
        await frames(3);
      }, { perSize: true });
      await G(() => window.__afterlife.game.cancelPlacement());
      if (ids.sofa) {
        await scene('buy-moving', async () => {
          await G((id) => window.__afterlife.game.pickUpObject(id), ids.sofa);
          await frames(3);
        }, { cleanup: () => G(() => window.__afterlife.game.cancelPlacement()) });
      }
      await scene('buy-search', async () => {
        await page.fill('.hud-buy__search input', 'coffin');
        await page.waitForTimeout(800);
      }, { cleanup: () => page.fill('.hud-buy__search input', '') });

      // ── build mode tools ──
      const tool = async (label) => {
        await page.click(`.hud-tool >> text="${label}"`);
        await page.mouse.move(curSize[0] * 0.55, curSize[1] * 0.5);
        await page.waitForTimeout(250);
        await page.mouse.move(curSize[0] * 0.57, curSize[1] * 0.52);
        await frames(3);
      };
      await G(() => window.__afterlife.game.setMode('build'));
      await page.waitForSelector('.hud-build', { timeout: 180000 });
      for (const [name, label] of [['build-wall', 'Wall'], ['build-room', 'Room'], ['build-floor', 'Floors'], ['build-paint', 'Paint'], ['build-door', 'Doors'], ['build-window', 'Windows']]) {
        await scene(name, () => tool(label), { perSize: true });
      }
      await G(() => window.__afterlife.game.setMode('live'));
      await page.waitForSelector('.hud-agent', { timeout: 180000 });
    }

    // ── stress: longest names the game accepts, $9,999,999, UI scale 0.8 / 1.4, reduce motion, colourblind ──
    if (SETS.includes('stress')) {
      const nameInfo = await G(() => {
        const g = window.__afterlife.game;
        const s = g.sim;
        const r = g.renameHousehold('Wolstenholme-Fothergills'); // 24 = the game's household-name maximum
        const longs = [['Bartholomew-Maximilian', 'Featherstonehaugh-Kerr'], ['Clementine-Josephine', 'Wolstenholme-Fothers'], ['Archibald-Theodoricus', 'Montgomery-Throckmor'], ['Persephone-Gwendolyn', 'Higginbottom-Smythe']];
        s.household().forEach((m, i) => {
          const a = s.agent(m.id);
          if (a && longs[i]) {
            a.firstName = longs[i][0];
            a.lastName = longs[i][1];
          }
        });
        s.state.household.funds = 9999999;
        return { rename: r, name: s.state.household.name };
      });
      check('renameHousehold accepts a long name', nameInfo.rename && nameInfo.rename.ok, nameInfo);
      await frames(3);
      await scene('stress-live', async () => {
        await page.click('.hud-agent__tabs [role="tab"][aria-label="Mood"]');
      });
      await scene('stress-household', async () => {
        await G(() => window.__afterlife.game.openDialog('household'));
        await page.waitForSelector('.hud-dialog');
      }, { cleanup: async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(300); } });
      for (const [scale, label] of [[0.8, '08'], [1.4, '14']]) {
        await G((v) => window.__afterlife.game.updateSettings({ uiScale: v }), scale);
        await page.waitForTimeout(500);
        await scene(`scale${label}-live`, async () => {
          await page.click('.hud-agent__tabs [role="tab"][aria-label="Needs"]');
        }, { sizes: [[1280, 720]] });
        await scene(`scale${label}-menu`, async () => {
          await G((t) => { const g = window.__afterlife.game; g.closeMenu(); g.openMenuFor(t, 700, 380); }, { kind: 'object', id: ids.fridge });
          await page.waitForSelector('.hud-imenu');
        }, { sizes: [[1280, 720]], cleanup: () => G(() => window.__afterlife.game.closeMenu()) });
        await scene(`scale${label}-buy`, async () => {
          await G(() => window.__afterlife.game.setMode('buy'));
          await page.waitForSelector('.hud-buy');
          await page.waitForTimeout(1500);
        }, { sizes: [[1280, 720]], cleanup: () => G(() => window.__afterlife.game.setMode('live')) });
        await scene(`scale${label}-build`, async () => {
          await G(() => window.__afterlife.game.setMode('build'));
          await page.waitForSelector('.hud-build');
          await page.click('.hud-tool >> text="Floors"').catch(() => null);
          await page.waitForTimeout(500);
        }, { sizes: [[1280, 720]], cleanup: () => G(() => window.__afterlife.game.setMode('live')) });
        await scene(`scale${label}-dialog`, async () => {
          await G(() => window.__afterlife.game.openDialog('careers'));
          await page.waitForSelector('.hud-dialog');
        }, { sizes: [[1280, 720]], cleanup: async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(300); } });
        const fit = await G(() => {
          const out = [];
          for (const el of document.querySelectorAll('.hud .ui-panel, .hud-agent, .hud-topbar > *')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0) continue;
            if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.push(`${el.className.split(' ')[0]} ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
          }
          return { rootPx: parseFloat(getComputedStyle(document.documentElement).fontSize), offscreen: out };
        });
        check(`uiScale ${scale} @1280x720: every HUD panel on screen`, fit.offscreen.length === 0, fit);
      }
      await G(() => window.__afterlife.game.updateSettings({ uiScale: 1, reduceMotion: true, colorblindNeeds: true }));
      await page.waitForTimeout(500);
      await scene('rm-cb-live', async () => {
        await page.click('.hud-agent__tabs [role="tab"][aria-label="Needs"]');
        await G(() => window.__afterlife.game.sim.dispatch({ type: 'cheat', code: 'motherlode' }));
      });
      const rm = await G(() => ({ cls: document.documentElement.className, anims: document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName || a.constructor.name).slice(0, 12) }));
      check('reduce motion: no running CSS animations in the HUD', rm.anims.length === 0, rm);
      await G(() => window.__afterlife.game.updateSettings({ reduceMotion: false, colorblindNeeds: false }));
    }

    // ── keyboard-only + Esc ownership against the real controller ──
    if (SETS.includes('keys')) {
      await size(SIZES[0]);
      await G(() => window.__afterlife.game.setSpeed(1));
      // Backlog #16: Esc closes the interaction menu, an immediate digit hotkey must reach the controller.
      // Each attempt: an on-lot zombie selected, the game paused (no drift between steps), the previous menu gone,
      // then a fresh menu whose first row has keyboard focus.
      const freshMenu = async (targetId, x) => {
        await page.waitForFunction(() => !document.querySelector('.hud-imenu'), null, { timeout: 120000 }).catch(() => null);
        const ok = await G(({ targetId, x }) => {
          const g = window.__afterlife.game;
          const home = g.sim.household().find((m) => m.presence === 'onLot');
          if (home && g.selectedAgentId !== home.id) g.selectAgent(home.id);
          g.closeMenu();
          g.setSpeed(0);
          g.openMenuFor({ kind: 'object', id: targetId }, x, 420);
          return !!g.menu;
        }, { targetId, x });
        if (!ok) return false;
        await page.waitForFunction(() => document.activeElement && document.activeElement.getAttribute('role') === 'menuitem', null, { timeout: 120000 });
        return true;
      };
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!(await freshMenu(ids.fridge, 700 + attempt * 40))) {
          check(`Esc then 3 (attempt ${attempt + 1})`, false, 'menu did not open');
          continue;
        }
        await page.keyboard.press('Escape');
        await page.keyboard.press('Digit3');
        await page.waitForTimeout(500);
        const r = await G(() => ({ speed: window.__afterlife.game.speed, menu: !!window.__afterlife.game.menu, dialog: window.__afterlife.game.dialog }));
        check(`Esc then 3 (attempt ${attempt + 1}): menu closed, speed 3, no pause menu`, r.speed === 3 && !r.menu && r.dialog === null, r);
      }
      // Same within ONE task (no frame can run in between): the strictest version of the sequence.
      if (await freshMenu(ids.fridge, 820)) {
        const same = await G(() => {
          const fire = (code, key) => (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true }));
          fire('Escape', 'Escape');
          fire('Digit3', '3');
          const g = window.__afterlife.game;
          return { speed: g.speed, menu: !!g.menu, dialog: g.dialog, active: document.activeElement && document.activeElement.tagName };
        });
        check('Esc then 3 in one task: speed 3, menu closed, focus left the menu', same.speed === 3 && !same.menu && same.dialog === null, same);
      }
      // Choosing an entry with Enter, then a hotkey right away (the fridge always offers an available leaf: snacks).
      if (await freshMenu(ids.fridge, 860)) {
        const chose = await G(() => {
          const el = document.querySelector('.hud-imenu[data-level="0"] .hud-imenu__row:not(.is-disabled):not([aria-haspopup])');
          if (!el) return { skipped: true };
          el.focus();
          const fire = (code, key) => (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true }));
          fire('Enter', 'Enter');
          fire('Digit2', '2');
          const g = window.__afterlife.game;
          return { speed: g.speed, menu: !!g.menu };
        });
        check('Enter chooses, then 2 sets speed 2 in the same task', !chose.skipped && chose.speed === 2 && !chose.menu, chose);
      }
      // nothing may be left open before the next checks (a skipped step must not leave its menu behind)
      await G(() => {
        const g = window.__afterlife.game;
        g.closeMenu();
        if (g.dialog) g.closeDialog();
        g.setSpeed(1);
      });
      await page.waitForFunction(() => !document.querySelector('.hud-imenu, .hud-dialog'), null, { timeout: 120000 }).catch(() => null);
      await page.waitForTimeout(400); // past the Esc layers' closing grace
      // Esc with nothing open opens the pause menu (the controller owns it); Esc again closes it.
      await G(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      const paused = await G(() => window.__afterlife.game.dialog);
      check('Esc with no HUD layer reaches the controller (pause menu)', paused === 'pause', paused);
      // the shell's pause dialog owns the next Esc once it has rendered (at SwiftShader frame rates that takes a while)
      await page.waitForSelector('.ui-modal [role="dialog"], [aria-modal="true"]', { timeout: 120000 }).catch(() => null);
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.__afterlife.game.dialog === null, null, { timeout: 30000 }).catch(() => null);
      check('Esc closes the pause menu again', (await G(() => window.__afterlife.game.dialog)) === null);
      await G(() => { const g = window.__afterlife.game; if (g.dialog) g.closeDialog(); g.setSpeed(1); });
      await page.waitForFunction(() => !document.querySelector('[aria-modal="true"]'), null, { timeout: 120000 }).catch(() => null);
      // Keyboard-only tour. Tab on the world is the game's "next zombie"; F6 enters the HUD regions, then Tab walks
      // HUD controls (and must not cycle zombies while it does).
      await G(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
      const sel0 = await G(() => window.__afterlife.game.selectedAgentId);
      await page.keyboard.press('Tab');
      await page.waitForTimeout(300);
      const sel1 = await G(() => window.__afterlife.game.selectedAgentId);
      check('Tab on the world cycles to the next zombie', sel1 !== sel0, { sel0, sel1 });
      const where = () => G(() => {
        const a = document.activeElement;
        if (!a || a === document.body) return null;
        const r = a.getBoundingClientRect();
        const region = a.closest('[data-hud-region]');
        return { label: (a.getAttribute('aria-label') || a.textContent || a.tagName).trim().slice(0, 40), region: region ? region.getAttribute('data-hud-region') : null, visible: r.width > 0 && r.height > 0 };
      });
      await page.keyboard.press('F6');
      await page.waitForTimeout(200);
      const entry = await where();
      check('F6 enters the HUD (top bar) with keyboard focus', !!entry && entry.region === '10', entry);
      await shot('kbd-f6', { frames: 1 });
      const order = [entry];
      const selBefore = await G(() => window.__afterlife.game.selectedAgentId);
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Tab');
        order.push(await where());
        if (i === 9) await shot('kbd-tab10', { frames: 1 });
      }
      report.tabOrder = order;
      check('Tab order: every stop is a visible HUD control', order.every((d) => d && d.visible && d.region), order.filter((d) => !d || !d.visible || !d.region));
      check('Tab inside the HUD never cycled zombies', (await G(() => window.__afterlife.game.selectedAgentId)) === selBefore);
      const regionsSeen = [];
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('F6');
        const d = await where();
        regionsSeen.push(d ? d.region : null);
        if (!d) break;
      }
      report.f6Regions = regionsSeen;
      check('F6 cycles HUD regions in order and returns to the world', regionsSeen[regionsSeen.length - 1] === null && regionsSeen.length >= 3, regionsSeen);
      const speedKeys = await G(() => window.__afterlife.game.speed);
      check('keyboard tour never changed the game speed', speedKeys === 1, speedKeys);
    }

    // ── perf: main-thread metrics over 10 s of live play (real renderer + HUD) ──
    if (SETS.includes('base') && want('perf')) {
      await size(SIZES[0]);
      await G(() => { const g = window.__afterlife.game; g.setMode('live'); g.setSpeed(1); });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
      const a = await m();
      await page.waitForTimeout(10000);
      const b = await m();
      const per = (k) => +((b[k] - a[k]) * 100).toFixed(1); // seconds over 10 s → ms per second
      report.perf.real = {
        scriptMsPerSec: per('ScriptDuration'),
        layoutMsPerSec: per('LayoutDuration'),
        styleMsPerSec: per('RecalcStyleDuration'),
        taskMsPerSec: per('TaskDuration'),
        domNodes: b.Nodes,
        jsHeapMB: +(b.JSHeapUsedSize / 1048576).toFixed(1),
        hudNodes: await G(() => document.querySelectorAll('.hud *').length),
        fps: await G(() => window.__afterlife.game.fps),
      };
      console.log('perf', JSON.stringify(report.perf.real));
    }
  } catch (e) {
    report.errors.push(`[fatal] ${e.message}`);
    console.log('REAL RUN FAILURE:', e.message);
    await page.screenshot({ path: path.join(OUT, 'real-99-failure.png') }).catch(() => {});
  }
  report.finished = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed; ${report.errors.length} console errors/warnings`);
  for (const l of report.errors.slice(0, 30)) console.log('  ' + l);
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})();
