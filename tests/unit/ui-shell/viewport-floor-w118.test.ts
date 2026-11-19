/**
 * W-118 (Sol's built-browser audit): the compact-window root floor (theme/scale.ts ⇄ theme/base.css), the compact
 * HUD switch that flips on the same thresholds, the modal focus-restore fallback to the game canvas, and catalog card
 * names that contain their visible text (WCAG 2.5.3). Browser evidence: tests/e2e/a11y.mjs (W-118 steps).
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTO_BASE_PX,
  AUTO_VH,
  AUTO_VW,
  CAP_VH,
  CAP_VW,
  FLOOR_MAX_H,
  FLOOR_CAP_VW,
  FLOOR_MAX_W,
  FLOOR_PX,
  FLOOR_STEP,
  TOUCH_FLOOR_QUERY,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  clampUiScale,
  compactFloorPx,
  effectiveUiScale,
  isCompactWindow,
  rootFontPx,
  touchFloorMatches,
  windowFitPx,
} from '../../../src/ui/theme/scale';
import { isPhoneLayout, PHONE_QUERY } from '../../../src/ui/hud/lib/phoneLayout';
import { _beginChain, _setChainOpener, _setWorldFallback, restoreFocus } from '../../../src/ui/common/Modal';
import { focusExit } from '../../../src/ui/hud/lib/focus';
import { catalogCardText } from '../../../src/ui/hud/buy/BuyCatalog';

const src = (p: string) => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8');

/** The pre-W-118 formula, written out independently of scale.ts (CSS viewport w×h, browser zoom z). */
const legacy = (w: number, h: number, s: number, z = 1) => Math.min((AUTO_BASE_PX + z * Math.min((AUTO_VH * h) / 100, (AUTO_VW * w) / 100)) * s, (z * CAP_VW * w) / 100, (z * CAP_VH * h) / 100);

describe('base.css ⇄ scale.ts (the exact CSS text the mirror is checked against)', () => {
  it('the root font-size is max(window-fit, compact floor) with the scale.ts constants', () => {
    const base = src('ui/theme/base.css');
    const fit = `min(calc(var(--ui-auto-size) * var(--ui-scale)), calc(${CAP_VW}vw * var(--ui-zoom)), calc(${CAP_VH}vh * var(--ui-zoom)))`;
    const floor = `min(calc(${FLOOR_PX}px * var(--ui-scale)), max(${FLOOR_PX}px, calc(${FLOOR_CAP_VW}vw * var(--ui-zoom))), max(0px, calc((${FLOOR_MAX_W}px - 100vw * var(--ui-zoom)) * ${FLOOR_STEP}), calc((${FLOOR_MAX_H}px - 100vh * var(--ui-zoom)) * ${FLOOR_STEP}), calc(var(--ui-touch-floor) * ${FLOOR_STEP}px)))`;
    expect(base).toContain(`font-size: max(${fit}, ${floor});`);
  });
  it('the touch floor media query is TOUCH_FLOOR_QUERY = PHONE_QUERY, and the variable defaults to 0', () => {
    const base = src('ui/theme/base.css');
    const css = TOUCH_FLOOR_QUERY.replace(/\s+/g, ' ');
    expect(base).toContain(`@media ${css} {\n  :root {\n    --ui-touch-floor: 1;`);
    expect(PHONE_QUERY).toBe(TOUCH_FLOOR_QUERY);
    expect(src('ui/theme/tokens.css')).toContain('--ui-touch-floor: 0;');
  });
  it('the floor thresholds are exactly where a window-fit cap would go under FLOOR_PX', () => {
    expect((CAP_VW * FLOOR_MAX_W) / 100).toBeCloseTo(FLOOR_PX, 9);
    expect((CAP_VH * FLOOR_MAX_H) / 100).toBeCloseTo(FLOOR_PX, 2);
  });
  it('phone.css no longer sets its own root size (one formula decides it)', () => {
    expect(src('ui/hud/phone.css')).not.toMatch(/html\[data-phone\]\s*\{[^}]*font-size/);
  });
});

describe('desktop sizing is unchanged (regression: every listed window × scale × zoom)', () => {
  const windows = [[1280, 720], [1920, 1080], [2560, 1440], [800, 600]] as const;
  for (const [W, H] of windows) {
    for (const s of [0.8, 1, 1.4]) {
      for (const z of [1, 2]) {
        it(`${W}×${H} window, UI scale ${s}, browser zoom ${z}: root px identical to the pre-W-118 formula`, () => {
          // the browser presents a W×H window at zoom z as a W/z × H/z CSS viewport
          const before = legacy(W / z, H / z, s, z);
          expect(rootFontPx(W / z, H / z, s, z)).toBe(before);
          expect(rootFontPx(W / z, H / z, s, z, false)).toBe(windowFitPx(W / z, H / z, s, z));
          expect(compactFloorPx(W / z, H / z, s, z)).toBe(0);
          expect(isCompactWindow(W / z, H / z, z)).toBe(false);
          expect(isPhoneLayout(W / z, H / z, false, z)).toBe(false);
          // and the same numbers read as a CSS viewport of W×H
          expect(rootFontPx(W, H, s, z)).toBe(legacy(W, H, s, z));
        });
      }
    }
  }
  it('pinned values (13.6 / 16 / 18.4 px at 100 %; 140 % capped on 1280×720)', () => {
    expect(rootFontPx(1280, 720, 1)).toBeCloseTo(13.6, 4);
    expect(rootFontPx(1920, 1080, 1)).toBeCloseTo(16, 4);
    expect(rootFontPx(2560, 1440, 1)).toBeCloseTo(18.4, 4);
    expect(rootFontPx(800, 600, 0.8)).toBeCloseTo(9.44, 4);
    expect(rootFontPx(1280, 720, 1.4)).toBe(16); // 1.25vw cap
  });
});

describe('compact windows get a readable floor (Sol: 4.875 px at 390×844, 140 %)', () => {
  it('reproduces the defect with the old formula and shows the fix', () => {
    expect(legacy(390, 844, 1.4)).toBeCloseTo(4.875, 6);
    expect(rootFontPx(390, 844, 1.4)).toBe(14);
    expect(rootFontPx(844, 390, 1.4)).toBe(14);
    expect(rootFontPx(360, 640, 1)).toBe(10);
    expect(rootFontPx(320, 480, 0.8)).toBe(8);
  });
  it('a 2.01rem HUD control (Sol: rotate 9.8 px) now clears 24 px at 100 % and above', () => {
    for (const [w, h] of [[390, 844], [844, 390], [360, 640], [320, 480], [280, 653], [2000, 300]]) {
      for (const s of [1, 1.2, 1.4]) expect(2.4 * rootFontPx(w, h, s)).toBeGreaterThanOrEqual(24);
    }
  });
  it('extreme windows: never below FLOOR_PX × scale (capped at 4vw, never under FLOOR_PX on ≥ 100 % ), always finite', () => {
    for (const [w, h] of [[320, 480], [280, 653], [2000, 300], [1, 1], [0, 0], [100000, 10], [10, 100000], [799, 2000], [3000, 449]]) {
      for (const s of [UI_SCALE_MIN, 1, UI_SCALE_MAX]) {
        const r = rootFontPx(w, h, s);
        expect(Number.isFinite(r)).toBe(true);
        expect(r).toBeGreaterThanOrEqual(Math.min(FLOOR_PX * s, Math.max(FLOOR_PX, (FLOOR_CAP_VW * w) / 100)) - 1e-9);
        if (s >= 1) expect(r).toBeGreaterThanOrEqual(FLOOR_PX - 1e-9);
      }
    }
    // 280 px at 140 %: 4vw = 11.2 px (14 px broke the needs labels mid-word); 320 px: 12.8 px; 350 px and up: 14 px
    expect(rootFontPx(280, 653, 1.4)).toBeCloseTo(11.2, 9);
    expect(rootFontPx(320, 480, 1.4)).toBeCloseTo(12.8, 9);
    expect(rootFontPx(350, 640, 1.4)).toBe(14);
    expect(rootFontPx(200, 400, 1.4)).toBe(10);
  });
  it('the floor never lowers a size: root ≥ window-fit everywhere (random sweep, zoom 0.25…5)', () => {
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 3000; i++) {
      const w = r() * 4000;
      const h = r() * 2400;
      const s = 0.5 + r();
      const z = [0.25, 0.5, 1, 1.5, 2, 4, 5][Math.floor(r() * 7)];
      const c = r() < 0.3;
      expect(rootFontPx(w, h, s, z, c)).toBeGreaterThanOrEqual(windowFitPx(w, h, s, z) - 1e-12);
      expect(rootFontPx(w, h, s, z, c)).toBeLessThanOrEqual(Math.max(windowFitPx(w, h, s, z), FLOOR_PX * clampUiScale(s)) + 1e-12);
      // monotonic in the scale
      expect(rootFontPx(w, h, Math.min(1.4, s + 0.1), z, c)).toBeGreaterThanOrEqual(rootFontPx(w, h, s, z, c) - 1e-9);
    }
  });
  it('the layout switch and the floor flip together (both strictly below 800 / 450 unzoomed)', () => {
    for (const [w, h, z] of [[799, 900, 1], [800, 900, 1], [1280, 449, 1], [1280, 450, 1], [399.5, 900, 2], [400, 900, 2], [160, 113, 5], [3200, 1800, 0.25], [3195, 1800, 0.25]] as const) {
      const floored = compactFloorPx(w, h, 1, z) > 0;
      expect(floored, `${w}×${h}@${z}`).toBe(isCompactWindow(w, h, z));
    }
  });
  it('zoom 0.25 and 5: the floor follows the UNZOOMED window', () => {
    // 1280×720 at 25 %: CSS viewport 5120×2880 — still desktop
    expect(rootFontPx(5120, 2880, 1, 0.25)).toBe(legacy(5120, 2880, 1, 0.25));
    // 1280×720 at 500 %: CSS viewport 256×144 — still desktop sizing (WCAG 1.4.4: text 5× physically)
    expect(rootFontPx(256, 144, 1, 5)).toBeCloseTo(13.6, 4);
    expect(isCompactWindow(256, 144, 5)).toBe(false);
    // a real 390×844 phone window zoomed to 500 %: compact, the floor in CSS px is unchanged by the zoom
    expect(rootFontPx(78, 168.8, 1.4, 5)).toBe(14);
    // an absurd zoom reads as 1
    for (const z of [0, -2, NaN, Infinity]) expect(rootFontPx(390, 844, 1, z)).toBe(rootFontPx(390, 844, 1, 1));
  });
  it('touch phones get the floor at any size up to a 500 px short side; mouse windows only below 800×450', () => {
    expect(rootFontPx(1280, 480, 1, 1, true)).toBe(Math.max(windowFitPx(1280, 480, 1), 10));
    expect(compactFloorPx(1280, 480, 1, 1, false)).toBe(0);
    expect(compactFloorPx(1280, 480, 1, 1, true)).toBe(10);
    expect(compactFloorPx(1280, 480, 1, 1, 'yes' as unknown as boolean)).toBe(0); // only a real true counts
  });
  it('NaN / garbage inputs: finite results, UI scale clamped like applyThemeSettings', () => {
    for (const g of [NaN, Infinity, -Infinity, -1, 0]) {
      expect(Number.isFinite(rootFontPx(g, g, g, g))).toBe(true);
      expect(Number.isFinite(compactFloorPx(g, g, g, g))).toBe(true);
      expect(Number.isFinite(effectiveUiScale(g, 844, g, g))).toBe(true);
      expect(isCompactWindow(g, g, g)).toBe(false);
    }
    expect(rootFontPx(390, 844, NaN)).toBe(10);
    expect(rootFontPx(390, 844, 99)).toBe(14);
    expect(rootFontPx(390, 844, -3)).toBe(8);
    expect(rootFontPx(390, 844, 0.8, 1, true)).toBe(8);
  });
  it('effectiveUiScale: never above the request; the full request on a compact window', () => {
    expect(effectiveUiScale(390, 844, 1.4)).toBe(1.4);
    expect(effectiveUiScale(280, 653, 1.4)).toBeCloseTo(1.12, 9); // the 4vw cap: 11.2 px on the 10 px base
    expect(effectiveUiScale(280, 653, 1)).toBe(1); // auto < 10 px here: must not report > 100 %
    expect(effectiveUiScale(1280, 720, 1.4)).toBeLessThan(1.2);
    for (const [w, h] of [[280, 653], [390, 844], [799, 500], [800, 600], [1280, 720]]) {
      for (const s of [0.8, 1, 1.4]) expect(effectiveUiScale(w, h, s)).toBeLessThanOrEqual(s + 1e-12);
    }
  });
  it('touchFloorMatches never throws', () => {
    expect(touchFloorMatches(null)).toBe(false);
    expect(touchFloorMatches({})).toBe(false);
    expect(touchFloorMatches({ matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(
      touchFloorMatches({
        matchMedia: () => {
          throw new Error('x');
        },
      }),
    ).toBe(false);
  });
});

describe('modal focus restore falls back to the game canvas (Sol: F6 → Pause → Settings → Esc → Esc left BODY)', () => {
  const el = (name: string, log: string[], connected = true) => ({ isConnected: connected, focus: () => log.push(name) }) as unknown as HTMLElement;
  afterEach(() => {
    _setChainOpener(null);
    _setWorldFallback(null);
  });
  it('opener disconnected → canvas', () => {
    const log: string[] = [];
    _setWorldFallback(() => el('canvas', log));
    _beginChain(el('pause-item', log, false));
    expect(restoreFocus(el('gone', log, false))).not.toBeNull();
    expect(log).toEqual(['canvas']);
  });
  it('opener = BODY (focus was on body when the chain opened) → canvas, and a stale opener from an earlier chain is NOT reused', () => {
    const log: string[] = [];
    _setWorldFallback(() => el('canvas', log));
    _setChainOpener(el('main-menu Settings button (old chain)', log)); // what the bug kept around
    _beginChain(null); // a new chain opened from <body> (document.activeElement === body → not usable)
    restoreFocus(null);
    expect(log).toEqual(['canvas']);
  });
  it('a usable opener still wins over the canvas', () => {
    const log: string[] = [];
    _setWorldFallback(() => el('canvas', log));
    _beginChain(el('canvas-as-opener', log));
    restoreFocus(el('menu-button', log));
    expect(log).toEqual(['menu-button']);
    restoreFocus(el('unmounted', log, false));
    expect(log).toEqual(['menu-button', 'canvas-as-opener']);
  });
  it('nested modals: while another modal is still open the canvas is never focused (the trap keeps focus there)', () => {
    const log: string[] = [];
    _setWorldFallback(() => el('canvas', log));
    _beginChain(null);
    expect(restoreFocus(el('gone', log, false), 1)).toBeNull();
    expect(log).toEqual([]);
    expect(restoreFocus(el('parent-dialog-button', log), 1)).not.toBeNull();
    expect(log).toEqual(['parent-dialog-button']);
    // the last one closes: now the canvas
    restoreFocus(null, 0);
    expect(log).toEqual(['parent-dialog-button', 'canvas']);
  });
  it('no canvas (main menu without a world) and no opener → null, never throws', () => {
    _setWorldFallback(() => null);
    expect(restoreFocus(null)).toBeNull();
    _setWorldFallback(() => {
      throw new Error('boom');
    });
    expect(restoreFocus(null)).toBeNull();
  });
  it('HUD layers: focusExit still says blur for a body / gone opener (releaseFocus then focuses the world)', () => {
    const layer = { contains: (n: unknown) => n === active };
    const active = { isConnected: true };
    const body = { isConnected: true, focus: () => undefined };
    expect(focusExit(active, body, layer, [body])).toBe('blur');
    expect(focusExit(active, { isConnected: false, focus: () => undefined }, layer)).toBe('blur');
    expect(src('ui/hud/lib/focus.ts')).toMatch(/blur\?\.\(\);\s*\/\/[^\n]*\n\s*focusWorld\(doc\);/);
    expect(src('ui/hud/parts/keynav.ts')).toContain('if (!focusWorld(document)');
  });
});

describe('catalog cards: the accessible name is the visible text (WCAG 2.5.3, every category)', () => {
  it('no overriding aria-label on Buy cards or labelled Build style chips', () => {
    const buy = src('ui/hud/buy/BuyCatalog.tsx');
    const card = buy.slice(buy.indexOf('function CatalogCard'), buy.indexOf('function DetailCard'));
    expect(card).not.toMatch(/aria-label=/);
    expect(card).toContain(`<span class="hud-item__name">{it.name}</span>{' '}`);
    expect(card).toMatch(/class=\{`hud-item__env u-num[^`]*`\} aria-hidden="true"/);
    expect(card).toContain('<BonesLock game={game} defId={it.defId} describedElsewhere />');
    const build = src('ui/hud/build/BuildTools.tsx');
    expect(build).not.toMatch(/aria-label=\{`\$\{s\.name\}/);
    expect(build).toContain('aria-label={compact ? `${name}, ${price}` : undefined}');
  });
  it('catalogCardText name = what the browser computes from the content', () => {
    const it0 = { name: 'Salvaged Pew', price: 150, env: 1, needsPower: false };
    expect(catalogCardText(it0, true, null).name).toBe('Salvaged Pew $150');
    expect(catalogCardText(it0, false, 'Unlock in the store for 260 Bones').name).toBe('Salvaged Pew $150, Can’t afford');
    expect(catalogCardText(it0, true, 'Unlock in the store for 260 Bones').description).toBe('Environment +1. Unlock in the store for 260 Bones');
  });
});

describe('agent-panel CSS variables are written only in phone mode and only when they change', () => {
  it('setRootVar: no write for an unchanged value, removal only when set, never throws', async () => {
    const { setRootVar } = await import('../../../src/ui/hud/agent/AgentPanel');
    const props = new Map<string, string>();
    let writes = 0;
    const html = {
      style: {
        getPropertyValue: (n: string) => props.get(n) ?? '',
        setProperty: (n: string, v: string) => {
          writes++;
          props.set(n, v);
        },
        removeProperty: (n: string) => {
          writes++;
          const v = props.get(n) ?? '';
          props.delete(n);
          return v;
        },
      },
    };
    expect(setRootVar(html, '--hud-agent-t', '500px')).toBe(true);
    expect(setRootVar(html, '--hud-agent-t', '500px')).toBe(false); // same value: no whole-document style invalidation
    expect(setRootVar(html, '--hud-agent-t', null)).toBe(true);
    expect(setRootVar(html, '--hud-agent-t', null)).toBe(false); // desktop: nothing set, nothing written
    expect(writes).toBe(2);
    const broken = {
      style: {
        getPropertyValue: (): string => {
          throw new Error('x');
        },
        setProperty: () => undefined,
        removeProperty: () => '',
      },
    };
    expect(setRootVar(broken, '--x', '1px')).toBe(false);
  });
  it('the panel publishes them only in phone mode', () => {
    const panel = src('ui/hud/agent/AgentPanel.tsx');
    expect(panel).toContain("setRootVar(html, '--hud-agent-t', phone ?");
    expect(panel).toContain("setRootVar(html, '--hud-agent-r', phone ?");
  });
});
