/**
 * W-064 shell / theme accessibility fixes from Sol's W-023 audit (docs/desktop-reports/a11y-l10n.md, branch
 * desktop/sol-a11y): A2 root sizing vs browser zoom, A6 segmented-thumb contrast, the offline-safe cast art cache.
 * Browser-level evidence (emulated 200 / 400 % zoom, rendered colours) lives in tests/e2e/a11y.mjs.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_ENTRY_URL } from '../../../electron/appProtocol';
import { contrastRatio, mixHex } from '../../../src/ui/common/color';
import { thumbBox } from '../../../src/ui/common/Segmented';
import { castArtHref, castArtStats, preloadCastArt, setCastArtEnv, usedCastBodies } from '../../../src/ui/common/castArtCache';
import { castThumbUrl } from '../../../src/ui/common/castArt';
import { detectBrowserZoom, effectiveUiScale, rootFontPx } from '../../../src/ui/theme/scale';
import { _setChainOpener, restoreFocus } from '../../../src/ui/common/Modal';
import { hudOwnsEscape } from '../../../src/ui/hud/parts/hooks';
import {
  _resetNav, childKey, closeAllShellDialogs, closeShellDialog, openChildDialog, openRootDialog, syncNav, takeReturnFocus,
} from '../../../src/ui/shell/nav';
import type { DialogId } from '../../../src/game/contracts';

const css = (p: string) => readFileSync(new URL(`../../../src/ui/${p}`, import.meta.url), 'utf8');

/** The pre-W-064 formula (viewport caps evaluated on the zoomed CSS viewport). */
const oldRoot = (w: number, h: number, s: number) => Math.min((8.8 + Math.min(0.006667 * h, 0.00375 * w)) * s, 0.0125 * w, 0.022223 * h);

describe('A2: browser zoom scales text fully (scale.ts mirrors base.css)', () => {
  const windows = [[1280, 720], [1366, 768], [1600, 900], [1920, 1080], [2560, 1440], [1024, 640]] as const;
  it('reproduces Sol’s measurement with the old formula (heading capped at 150 % for 200 % and 400 %)', () => {
    const at = (z: number) => (oldRoot(1920 / z, 1080 / z, 1) * z) / oldRoot(1920, 1080, 1);
    expect(at(2)).toBeCloseTo(1.5, 2);
    expect(at(4)).toBeCloseTo(1.5, 2);
  });
  it('physical text size is exactly zoom × the 100 % size at 200 % and 400 % (all windows, all UI scales)', () => {
    for (const [w, h] of windows) {
      for (const s of [0.8, 1, 1.2, 1.4]) {
        const base = rootFontPx(w, h, s, 1);
        for (const z of [1.25, 1.5, 2, 3, 4]) {
          // zoom z: CSS viewport = window / z, physical px = CSS px × z
          expect((rootFontPx(w / z, h / z, s, z) * z) / base, `${w}x${h} s${s} z${z}`).toBeCloseTo(z, 6);
        }
      }
    }
  });
  it('a genuinely small window (no zoom) still gets the window-fit cap that keeps the HUD on screen', () => {
    expect(rootFontPx(1280, 720, 1.4)).toBeLessThanOrEqual(16.0001);
    expect(effectiveUiScale(1280, 720, 1.4)).toBeLessThan(1.2);
    // W-118: below 800 px wide the window-fit cap (4.875 px here, Sol's measurement) is floored at 10 px × scale
    expect(rootFontPx(390, 844, 1.4)).toBe(14);
    expect(rootFontPx(1024, 640, 1.4)).toBeCloseTo(12.8, 6); // ≥ 800×450: the window-fit cap alone, as before
  });
  it('base.css / tokens.css carry --ui-zoom in every viewport term', () => {
    expect(css('theme/tokens.css')).toContain('--ui-zoom: 1;');
    const base = css('theme/base.css');
    expect(base).toContain('calc(1.25vw * var(--ui-zoom))');
    expect(base).toContain('calc(2.2223vh * var(--ui-zoom))');
    expect(base).not.toMatch(/font-size: min\([^;]*, 1\.25vw, 2\.2223vh\)/);
  });
});

describe('detectBrowserZoom', () => {
  it('reads Chromium / Electron zoom from outer (screen px) vs inner (CSS px) width', () => {
    expect(detectBrowserZoom({ outerWidth: 1920, innerWidth: 960, devicePixelRatio: 2 })).toBe(2);
    expect(detectBrowserZoom({ outerWidth: 1936, innerWidth: 484, devicePixelRatio: 4 })).toBe(4); // + window frame
    expect(detectBrowserZoom({ outerWidth: 1280, innerWidth: 1024, devicePixelRatio: 1.25 })).toBe(1.25);
    // zoom on top of a 150 % OS display scale
    expect(detectBrowserZoom({ outerWidth: 1707, innerWidth: 853, devicePixelRatio: 3 })).toBe(2);
    expect(detectBrowserZoom({ outerWidth: 1920, innerWidth: 2880, devicePixelRatio: 0.67 })).toBe(0.67);
  });
  it('is 1 when nothing is zoomed, unknown, or the numbers do not add up', () => {
    expect(detectBrowserZoom({ outerWidth: 1296, innerWidth: 1280, devicePixelRatio: 1 })).toBe(1); // window frame
    expect(detectBrowserZoom({ outerWidth: 1920, innerWidth: 1500, devicePixelRatio: 1 })).toBe(1); // side panel open: dpr says no zoom
    expect(detectBrowserZoom({ outerWidth: 0, innerWidth: 1280, devicePixelRatio: 1 })).toBe(1); // headless / iframe
    expect(detectBrowserZoom({ outerWidth: 1280, innerWidth: 390, devicePixelRatio: 1 })).toBe(1); // emulated small viewport
    expect(detectBrowserZoom({ outerWidth: Number.NaN, innerWidth: 1280 })).toBe(1);
    expect(detectBrowserZoom(null)).toBe(1);
  });
});

describe('A6: segmented control contrast (CAZ pose bar)', () => {
  const forms = css('theme/forms.css');
  const thumb = /\.ui-seg__thumb \{[^}]*linear-gradient\(180deg, rgba\((\d+), (\d+), (\d+), [\d.]+\), rgba\((\d+), (\d+), (\d+)/.exec(forms);
  const hex = (r: string, g: string, b: string) => `#${[r, g, b].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
  it('selected labels clear 4.5:1 on the lightest point of the thumb', () => {
    expect(thumb).not.toBeNull();
    const top = hex(thumb![1], thumb![2], thumb![3]);
    expect(contrastRatio('#f6f0dd', top)).toBeGreaterThanOrEqual(4.5); // --text-strong
    expect(contrastRatio('#ece5cf', top)).toBeGreaterThanOrEqual(4.5); // --text
  });
  it('the CAZ pose bar sits on the strong panel and uses --text for unselected poses', () => {
    const caz = css('shell/caz.css');
    expect(caz).toMatch(/\.sh-stage__poses \.ui-seg \{[^}]*background: var\(--bg-panel-strong\)/);
    expect(caz).toMatch(/\.sh-stage__poses \.ui-seg__opt:not\(\[aria-checked='true'\]\) \{\s*color: var\(--text\)/);
    // --text on the strong panel even composited over a white stage light
    expect(contrastRatio('#ece5cf', mixHex('#181320', '#ffffff', 0.06))).toBeGreaterThanOrEqual(4.5);
  });
  it('the thumb is placed from layout offsets, immune to an ancestor’s entrance transform', () => {
    // fake layout tree: root ▸ wrapper(positioned) ▸ option
    const root = { offsetLeft: 999, offsetParent: null, offsetWidth: 300, contains: (n: unknown) => n === wrap || n === opt } as unknown as HTMLElement;
    const wrap = { offsetLeft: 40, offsetParent: root, offsetWidth: 120 } as unknown as HTMLElement;
    const opt = { offsetLeft: 6, offsetParent: wrap, offsetWidth: 58, getBoundingClientRect: () => ({ left: 1e6, width: 1e6 }) } as unknown as HTMLElement;
    expect(thumbBox(opt, root)).toEqual({ left: 46, width: 58 });
  });
});

describe('W-050: offline-safe cast thumbnails (castArtCache)', () => {
  let online = true;
  const fetched: string[] = [];
  const install = (fail = false) =>
    setCastArtEnv({
      online: () => online,
      fetchBlob: async (u) => {
        fetched.push(u);
        if (fail) {
          online = false; // connection dropped during the download
          throw new Error('net::ERR_INTERNET_DISCONNECTED');
        }
        return new Blob(['x']);
      },
      objectUrl: () => `blob:art/${fetched.length}`,
    });
  afterEach(() => {
    online = true;
    fetched.length = 0;
    vi.unstubAllGlobals();
    setCastArtEnv(null);
  });

  it('online: network URL until preloaded, then the cached blob URL forever (also offline)', async () => {
    install();
    expect(castArtHref('sneezer')).toBe(castThumbUrl('sneezer'));
    await preloadCastArt(['sneezer', 'boss', 'sneezer', 'not-a-body']);
    expect(fetched).toHaveLength(2);
    expect(castArtHref('sneezer')).toMatch(/^blob:/);
    online = false;
    expect(castArtHref('sneezer')).toMatch(/^blob:/);
    expect(castArtStats()).toMatchObject({ ready: 2, failed: 0 });
  });

  it('offline: no request at all — the portrait draws its procedural face (href null)', async () => {
    install();
    online = false;
    expect(castArtHref('mascot')).toBeNull();
    await preloadCastArt(['mascot']);
    expect(fetched).toHaveLength(0);
  });

  it('desktop app (app://), computer offline: the thumbnail is a local file, so the portrait still uses it', () => {
    // browser defaults (no injected env), as shipped: only the page the asset URL resolves against differs
    vi.stubGlobal('navigator', { onLine: false });
    vi.stubGlobal('location', { href: APP_ENTRY_URL });
    setCastArtEnv(null);
    expect(castArtHref('sneezer')).toBe(castThumbUrl('sneezer'));
    // control: a web build in an offline browser keeps the W-050 behaviour
    vi.stubGlobal('location', { href: 'https://play.example/afterlife/index.html' });
    setCastArtEnv(null);
    expect(castArtHref('sneezer')).toBeNull();
  });

  it('a download cut by going offline is forgotten (retried later), never thrown', async () => {
    install(true);
    await expect(preloadCastArt(['boss'])).resolves.toBeUndefined();
    expect(castArtStats().failures).toBe(1);
    online = true;
    install(false);
    await preloadCastArt(['boss']);
    expect(castArtHref('boss')).toMatch(/^blob:/);
  });

  it('usedCastBodies collects household + on-lot cast bodies, ignoring classic and junk', () => {
    expect(usedCastBodies([{ body: 'boss' }, { body: 'classic' }, null, 7, { body: 'sneezer' }, { body: 'boss' }, { body: 'nope' }])).toEqual(
      expect.arrayContaining(['boss', 'sneezer']),
    );
    expect(usedCastBodies([{ body: 'boss' }, { body: 'boss' }])).toEqual(['boss']);
    expect(usedCastBodies([])).toEqual([]);
  });
});

describe('W-064 Escape closes the top dialog only; focus is restored', () => {
  /** A focusable stand-in (node env: no DOM). */
  const el = (name: string, log: string[], connected = true) =>
    ({ isConnected: connected, focus: () => log.push(name) }) as unknown as HTMLElement;
  const navGame = () => {
    const g = {
      dialog: 'pause' as DialogId,
      openDialog(d: DialogId) {
        g.dialog = d;
      },
      closeDialog() {
        g.dialog = null;
      },
    };
    return g;
  };

  it('the HUD Esc stack yields to any open shell / store Modal (it is drawn above every HUD layer)', () => {
    expect(hudOwnsEscape(1, 0, false)).toBe(true);
    expect(hudOwnsEscape(3, 1, false)).toBe(false); // notification log open + Help (F10) on top: Esc closes Help
    expect(hudOwnsEscape(1, 2, false)).toBe(false); // Settings + its Reset confirm: the Modal stack picks the top one
    expect(hudOwnsEscape(0, 0, false)).toBe(false);
    expect(hudOwnsEscape(2, 0, true)).toBe(false); // a widget handling Esc itself ([data-esc-local])
    expect(hudOwnsEscape(2, NaN, false)).toBe(true); // a garbage count never blocks the HUD from closing its own layer
  });

  it('closing a modal focuses its opener; an opener that no longer exists falls back to the chain opener, not <body>', () => {
    const log: string[] = [];
    _setChainOpener(el('canvas', log));
    expect(restoreFocus(el('menu-button', log))).not.toBeNull();
    expect(log).toEqual(['menu-button']);
    restoreFocus(el('pause-item (unmounted)', log, false)); // Pause was replaced by Settings, then by Pause again
    expect(log).toEqual(['menu-button', 'canvas']);
    restoreFocus(null);
    expect(log).toEqual(['menu-button', 'canvas', 'canvas']);
    const throwing = {
      isConnected: true,
      focus: () => {
        throw new Error('detached');
      },
    } as unknown as HTMLElement;
    expect(restoreFocus(throwing)).not.toBeNull(); // a throwing focus() falls through to the chain opener
    expect(log.at(-1)).toBe('canvas');
    _setChainOpener(null);
    expect(restoreFocus(el('gone', log, false))).toBeNull();
    expect(restoreFocus(undefined as unknown as HTMLElement)).toBeNull();
  });

  it('Pause -> child -> back focuses the item that opened the child (once), keyed by child + Save/Load tab', () => {
    _resetNav();
    const g = navGame();
    const cases: [DialogId, 'save' | 'load' | undefined][] = [['settings', undefined], ['saveLoad', 'save'], ['saveLoad', 'load'], ['help', undefined]];
    for (const [child, mode] of cases) {
      g.dialog = 'pause';
      openChildDialog(g, child, mode ? { saveLoadMode: mode } : undefined);
      syncNav(g.dialog);
      closeShellDialog(g);
      expect(g.dialog).toBe('pause');
      syncNav(g.dialog);
      expect(takeReturnFocus('pause')).toBe(childKey(child, mode));
      expect(takeReturnFocus('pause')).toBeNull(); // consumed: a later fresh Pause opens on Resume
    }
    expect(childKey('saveLoad', 'save')).not.toBe(childKey('saveLoad', 'load'));
  });

  it('adversarial: no return focus after close-all, a root dialog, a controller jump elsewhere, or for another parent', () => {
    _resetNav();
    const g = navGame();
    openChildDialog(g, 'settings');
    closeAllShellDialogs(g);
    expect(takeReturnFocus('pause')).toBeNull();
    g.dialog = 'pause';
    openChildDialog(g, 'settings');
    syncNav('household'); // the controller replaced the dialog on its own (a notification action)
    expect(takeReturnFocus('pause')).toBeNull();
    g.dialog = 'pause';
    openChildDialog(g, 'help');
    openRootDialog(g, 'credits');
    expect(takeReturnFocus('pause')).toBeNull();
    g.dialog = 'pause';
    openChildDialog(g, 'help');
    expect(takeReturnFocus('settings')).toBeNull();
    expect(takeReturnFocus(null)).toBeNull();
    expect(takeReturnFocus('pause')).toBe('help');
    g.dialog = null;
    openChildDialog(g, 'settings'); // opened with no parent: nothing to return to
    expect(takeReturnFocus('pause')).toBeNull();
  });
});
