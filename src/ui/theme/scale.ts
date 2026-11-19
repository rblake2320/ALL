/**
 * Root type scale math, mirroring the CSS (keep in sync — tests/unit/ui-shell/hardening.test.ts checks the constants):
 *
 *   tokens.css  --ui-auto-size: calc(8.8px + var(--ui-zoom) * min(0.6667vh, 0.375vw))
 *   base.css    html { font-size: max(<window-fit>, <compact floor>) }
 *     window-fit     min(calc(var(--ui-auto-size) * var(--ui-scale)), calc(1.25vw * var(--ui-zoom)), calc(2.2223vh * var(--ui-zoom)))
 *     compact floor  min(calc(10px * var(--ui-scale)), max(10px, calc(4vw * var(--ui-zoom))), max(0px, calc((800px - 100vw * var(--ui-zoom)) * 1000),
 *                      calc((450px - 100vh * var(--ui-zoom)) * 1000), calc(var(--ui-touch-floor) * 1000px)))
 *   --ui-touch-floor is 1 under TOUCH_FLOOR_QUERY (a coarse pointer with a short side <= 500 CSS px), else 0.
 *
 * The window-fit terms (vw / vh) are evaluated on the UNZOOMED window: browser zoom z shrinks the CSS viewport to
 * 1/z, so multiplying the viewport terms by z (--ui-zoom, set by watchBrowserZoom in ./index.ts) keeps the root size
 * in CSS px exactly what it was at 100 % — text then grows with the zoom by the full factor (WCAG 1.4.4; Sol W-023
 * A2 measured the old formula capping a heading at 150 % at both 200 % and 400 %). A genuinely small window (z = 1)
 * still gets the window-fit sizing that keeps the game HUD on screen.
 *
 * Compact floor (W-118): the window-fit cap was sized for the desktop landscape HUD; on a narrow or short window it
 * fell to ~4.9 px at 390 px wide (Sol's audit: 51x6 px and 9.8x9.8 px HUD targets). Wherever a window-fit cap would
 * push 1rem below FLOOR_PX — i.e. the UNZOOMED window is narrower than 800 px or shorter than 450 px — or the device
 * is a touch phone, the root is floored at FLOOR_PX x the UI scale and the HUD switches to its compact (phone) layout
 * (hud/lib/phoneLayout.ts uses isCompactWindow below, so layout and type size flip together). The step terms are
 * `(threshold - window) * 1000` clamped to [0, floor]: a 0.01 px wide ramp, i.e. a step a pure-CSS formula can
 * express without media queries, and still measured on the unzoomed window (x --ui-zoom), so a zoomed desktop is
 * NOT a narrow window and keeps the WCAG 1.4.4 behaviour above. Every desktop window (>= 800x450) is unchanged.
 *
 * Used by Settings to explain when a small window limits the chosen UI scale.
 */
export const AUTO_BASE_PX = 8.8;
export const AUTO_VH = 0.6667;
export const AUTO_VW = 0.375;
export const CAP_VW = 1.25;
export const CAP_VH = 2.2223;
/** Readable root floor (CSS px at UI scale 1) on compact windows / touch phones. */
export const FLOOR_PX = 10;
/** The floor applies below these UNZOOMED window sizes: where 1.25vw / 2.2223vh would fall under FLOOR_PX. */
export const FLOOR_MAX_W = 800;
export const FLOOR_MAX_H = 450;
/** On very narrow windows the SCALED floor is capped at this many vw (unzoomed), but never under FLOOR_PX. */
export const FLOOR_CAP_VW = 4;
/** Steepness of the CSS step terms (px per px of window). */
export const FLOOR_STEP = 1000;
/** Touch phones get the floor at any window size up to a 500 px short side (= hud/lib/phoneLayout PHONE_QUERY). */
export const TOUCH_FLOOR_QUERY = '(pointer: coarse) and (max-width: 500px), (pointer: coarse) and (max-height: 500px)';
export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.4;

const finite = (v: number, d: number) => (Number.isFinite(v) ? v : d);

/** Clamp a UI scale setting like applyThemeSettings does (NaN → 1). */
export function clampUiScale(scale: number): number {
  return Number.isFinite(scale) ? Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, scale)) : 1;
}

const zoomOf = (z: number | undefined): number => (z !== undefined && Number.isFinite(z) && z > 0 ? z : 1);

/** Resolution-aware root size before the player's scale (CSS px). `zoom` = browser zoom (CSS viewport is window/zoom). */
export function autoRootPx(viewportW: number, viewportH: number, zoom = 1): number {
  const z = zoomOf(zoom);
  const w = Math.max(0, finite(viewportW, 0));
  const h = Math.max(0, finite(viewportH, 0));
  return AUTO_BASE_PX + z * Math.min((AUTO_VH * h) / 100, (AUTO_VW * w) / 100);
}

/** The window-fit size alone (the pre-W-118 formula; still the whole story on every window >= 800x450). */
export function windowFitPx(viewportW: number, viewportH: number, uiScale: number, zoom = 1): number {
  const z = zoomOf(zoom);
  const w = Math.max(0, finite(viewportW, 0));
  const h = Math.max(0, finite(viewportH, 0));
  return Math.min(autoRootPx(w, h, z) * clampUiScale(uiScale), (z * CAP_VW * w) / 100, (z * CAP_VH * h) / 100);
}

/** The compact floor term of base.css (0 on desktop windows). `coarse` = TOUCH_FLOOR_QUERY matches. */
export function compactFloorPx(viewportW: number, viewportH: number, uiScale: number, zoom = 1, coarse = false): number {
  const z = zoomOf(zoom);
  const w = Math.max(0, finite(viewportW, 0));
  const h = Math.max(0, finite(viewportH, 0));
  const on = Math.max(0, (FLOOR_MAX_W - w * z) * FLOOR_STEP, (FLOOR_MAX_H - h * z) * FLOOR_STEP, (coarse === true ? 1 : 0) * FLOOR_STEP);
  return Math.min(FLOOR_PX * clampUiScale(uiScale), Math.max(FLOOR_PX, (z * FLOOR_CAP_VW * w) / 100), on);
}

/**
 * Is this a compact window — one that gets the readable floor and the compact HUD? The unzoomed window narrower than
 * FLOOR_MAX_W or shorter than FLOOR_MAX_H. Unknown sizes (NaN, <= 0) count as NOT compact (a layout must not flip
 * on a bad reading). Same thresholds as the CSS step terms.
 */
export function isCompactWindow(viewportW: number, viewportH: number, zoom = 1): boolean {
  const z = zoomOf(zoom);
  const ok = (v: number) => Number.isFinite(v) && v > 0;
  return (ok(viewportW) && viewportW * z < FLOOR_MAX_W) || (ok(viewportH) && viewportH * z < FLOOR_MAX_H);
}

/** Final root font size in CSS px (1rem) for a CSS viewport, UI scale setting, browser zoom and pointer. */
export function rootFontPx(viewportW: number, viewportH: number, uiScale: number, zoom = 1, coarse = false): number {
  return Math.max(windowFitPx(viewportW, viewportH, uiScale, zoom), compactFloorPx(viewportW, viewportH, uiScale, zoom, coarse));
}

/**
 * The scale the player actually gets after the window cap (<= the requested scale). On a compact window the floor
 * (FLOOR_PX x scale) honours the requested scale in full, so this never reports more than was asked for.
 */
export function effectiveUiScale(viewportW: number, viewportH: number, uiScale: number, zoom = 1, coarse = false): number {
  const auto = autoRootPx(viewportW, viewportH, zoom);
  const want = clampUiScale(uiScale);
  if (!(auto > 0)) return want;
  // the floor is in charge: the scale applies on the compact base size (FLOOR_PX), up to the narrow-window 4vw cap
  const floor = compactFloorPx(viewportW, viewportH, uiScale, zoom, coarse);
  if (floor > 0 && floor >= windowFitPx(viewportW, viewportH, uiScale, zoom)) return Math.min(want, floor / FLOOR_PX);
  return Math.min(want, rootFontPx(viewportW, viewportH, uiScale, zoom, coarse) / auto);
}

/** Does the touch floor apply on this device right now (TOUCH_FLOOR_QUERY)? False when matchMedia is unavailable. */
export function touchFloorMatches(win: { matchMedia?: (q: string) => { matches: boolean } } | null | undefined): boolean {
  try {
    return !!win && typeof win.matchMedia === 'function' && win.matchMedia(TOUCH_FLOOR_QUERY).matches === true;
  } catch {
    return false;
  }
}

/** Browser zoom levels (Chromium / Electron presets; Firefox and Safari use a subset). */
export const ZOOM_PRESETS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5] as const;
/** Operating-system display scales a devicePixelRatio is made of (times the browser zoom). */
const OS_SCALES = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3, 3.5, 4];

/**
 * Browser zoom factor of the page. Chromium, Electron, Firefox and Safari report `outerWidth` in screen (zoom-
 * independent) pixels and `innerWidth` in CSS pixels, so their ratio is the zoom (plus a few px of window frame).
 * The estimate is accepted only when it snaps to a real zoom preset (±4 %) AND leaves a plausible OS display scale
 * in devicePixelRatio (dpr = os × zoom) — so a browser side panel that narrows the page (ratio ≈ 1.3 at dpr 1)
 * is not mistaken for zoom. Anything unknown (headless, iframes, outerWidth 0) reads as 1 = no zoom.
 */
export function detectBrowserZoom(win: { outerWidth?: number; innerWidth?: number; devicePixelRatio?: number } | null | undefined): number {
  if (!win) return 1;
  const outer = finite(win.outerWidth ?? NaN, 0);
  const inner = finite(win.innerWidth ?? NaN, 0);
  const dpr = finite(win.devicePixelRatio ?? NaN, 1) || 1;
  if (outer <= 0 || inner <= 0) return 1;
  const ratio = outer / inner;
  let best: number = 1;
  let err = Infinity;
  for (const p of ZOOM_PRESETS) {
    const e = Math.abs(ratio / p - 1);
    if (e < err) {
      err = e;
      best = p;
    }
  }
  if (err > 0.04 || best === 1) return 1;
  const os = dpr / best;
  return OS_SCALES.some((o) => Math.abs(os / o - 1) <= 0.04) ? best : 1;
}
