/**
 * Phone (compact) layout mode (W-114, widened by W-118). Driven by the viewport — never by user-agent sniffing. On if
 * EITHER
 *   - a touch-first device (`pointer: coarse`) whose SHORT side is <= 500 CSS px, in portrait or landscape (W-114), or
 *   - a compact window of any pointer (W-118): the UNZOOMED window is narrower than 800 px or shorter than 450 px
 *     (theme/scale.ts isCompactWindow) — exactly where base.css floors 1rem at 10 px x UI scale. Before W-118 a
 *     mouse-driven 390 px window kept the desktop HUD at a window-fit 1rem of 4.9 px (Sol: 51x6 px household button,
 *     9.8 px rotate). Layout and type size now flip on the same thresholds.
 *
 * "Unzoomed" = CSS viewport x browser zoom: a desktop browser zoomed to 200 % (CSS viewport 640x360 on a 1280x720
 * window) is NOT compact and keeps the desktop HUD and its zoom-following text size (WCAG 1.4.4, theme/scale.ts); a
 * tablet keeps it too. A phone / compact window gets 44 px touch targets (Apple HIG), the readable root floor,
 * safe-area insets and the compact arrangement in ../phone.css.
 *
 * The Hud mirrors the result onto `.hud[data-phone][data-orient]` and `<html data-phone>` while it is mounted;
 * every phone rule in CSS keys on those attributes, so this module is the single source of truth.
 */
import { useEffect, useState } from 'preact/hooks';
import { detectBrowserZoom, isCompactWindow, TOUCH_FLOOR_QUERY } from '../../theme/scale';
import { QUEUE_GEOMETRY, type Rect, type Size } from './layout';

/** Largest short side (CSS px) that still counts as a phone. */
export const PHONE_SHORT_SIDE_MAX = 500;
/** Minimum touch target edge (CSS px) on phone (Apple HIG 44 pt). */
export const PHONE_MIN_TARGET = 44;
/** Outer gutter (CSS px) on phone, added to the safe-area inset. */
export const PHONE_GUTTER = 8;

/** The touch half of the rule (short side <= 500 = width <= 500 OR height <= 500); = theme/scale TOUCH_FLOOR_QUERY. */
export const PHONE_QUERY = TOUCH_FLOOR_QUERY;

export interface PhoneLayout {
  phone: boolean;
  orient: 'portrait' | 'landscape';
}

/**
 * Pure twin of the rule (unit-tested): coarse pointer and short side <= 500 px, OR a compact window (unzoomed width
 * < 800 or height < 450) whatever the pointer. Missing / invalid sizes are unknown, never "tiny".
 */
export function isPhoneLayout(width: number, height: number, coarsePointer: boolean, zoom = 1): boolean {
  const w = Number.isFinite(width) && width > 0 ? width : Infinity;
  const h = Number.isFinite(height) && height > 0 ? height : Infinity;
  if (coarsePointer === true && Math.min(w, h) <= PHONE_SHORT_SIDE_MAX) return true;
  return isCompactWindow(width, height, zoom);
}

export function orientationOf(width: number, height: number): PhoneLayout['orient'] {
  return Number.isFinite(width) && Number.isFinite(height) && width > height ? 'landscape' : 'portrait';
}

function readPhoneLayout(): PhoneLayout {
  if (typeof window === 'undefined') return { phone: false, orient: 'landscape' };
  let coarse = false;
  try {
    coarse = typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_QUERY).matches : false;
  } catch {
    coarse = false;
  }
  // the query already encodes the touch short-side rule, so `coarse` here means "touch phone"
  const phone = coarse || isPhoneLayout(window.innerWidth, window.innerHeight, false, detectBrowserZoom(window));
  return { phone, orient: orientationOf(window.innerWidth, window.innerHeight) };
}

/** Current phone layout; re-renders on media-query changes, resizes and orientation changes. */
export function usePhoneLayout(): PhoneLayout {
  const [s, set] = useState(readPhoneLayout);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const update = () =>
      set((prev) => {
        const next = readPhoneLayout();
        return prev.phone === next.phone && prev.orient === next.orient ? prev : next;
      });
    let mq: MediaQueryList | null = null;
    try {
      mq = typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_QUERY) : null;
    } catch {
      mq = null;
    }
    mq?.addEventListener?.('change', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    update();
    return () => {
      mq?.removeEventListener?.('change', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);
  return s;
}

/**
 * Action-queue geometry (rem) on phone: 44 px ring, tiles and cancel button (fixed px, so their rem size depends on
 * the root size), a label of up to 16rem, 6 px gaps. Same shape as QUEUE_GEOMETRY.
 */
export function phoneQueueGeometry(remPx: number): { [K in keyof typeof QUEUE_GEOMETRY]: number } {
  const r = Number.isFinite(remPx) && remPx > 0 ? remPx : 10;
  const t = PHONE_MIN_TARGET / r;
  const gap = 6 / r;
  return { active: t + gap + 16 + gap + t, tile: t + gap, more: t + gap, chrome: 14 / r };
}

/** Area of the overlap of two rects (0 when they only touch). */
export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export type CalloutSide = 'top' | 'bottom' | 'left' | 'right';

/**
 * Place a callout of `size` next to `anchor` without covering any `avoid` rect (on phone: the household portraits
 * and the selected zombie's panel with its needs). An anchor inside an avoided region points at the whole region
 * (the callout sits beside the panel, not on it). Tries the four sides (most room first) at the centred position and
 * slid along the cross axis; then any free spot in the viewport closest to the anchor (`placement: 'center'`, no
 * arrow); and only if nothing is free, the side with the least overlap. Viewport-clamped with `margin`.
 */
export function placeCalloutAvoiding(
  anchor: Rect,
  size: Size,
  viewport: Size,
  avoid: readonly Rect[],
  gap = 14,
  margin = 10,
): { x: number; y: number; placement: CalloutSide | 'center'; arrow: number; overlap: number } {
  const n = (v: number, d = 0) => (Number.isFinite(v) ? v : d);
  const s = { w: Math.max(0, n(size?.w)), h: Math.max(0, n(size?.h)) };
  const v = { w: Math.max(0, n(viewport?.w)), h: Math.max(0, n(viewport?.h)) };
  const rects = (avoid ?? []).filter((r) => r && r.w > 0 && r.h > 0).map((r) => ({ x: n(r.x), y: n(r.y), w: n(r.w), h: n(r.h) }));
  let a: Rect = { x: n(anchor?.x), y: n(anchor?.y), w: Math.max(0, n(anchor?.w)), h: Math.max(0, n(anchor?.h)) };
  for (const r of rects) if (overlapArea(a, r) > 0 || (a.w === 0 && a.h === 0 && a.x >= r.x && a.x <= r.x + r.w && a.y >= r.y && a.y <= r.y + r.h)) a = union(a, r);
  const clampX = (x: number) => Math.min(Math.max(x, margin), Math.max(margin, v.w - margin - s.w));
  const clampY = (y: number) => Math.min(Math.max(y, margin), Math.max(margin, v.h - margin - s.h));
  const cost = (x: number, y: number) => rects.reduce((sum, r) => sum + overlapArea({ x, y, w: s.w, h: s.h }, r), 0);
  const room: [CalloutSide, number][] = [
    ['bottom', v.h - (a.y + a.h) - s.h],
    ['top', a.y - s.h],
    ['right', v.w - (a.x + a.w) - s.w],
    ['left', a.x - s.w],
  ];
  room.sort((p, q) => q[1] - p[1]);
  let best: { x: number; y: number; placement: CalloutSide | 'center'; overlap: number } | null = null;
  for (const [side] of room) {
    const vertical = side === 'top' || side === 'bottom';
    const main = side === 'top' ? a.y - gap - s.h : side === 'bottom' ? a.y + a.h + gap : side === 'left' ? a.x - gap - s.w : a.x + a.w + gap;
    // must fit on that side without the clamp pushing it back over the anchor
    const fits = vertical ? main >= margin - 0.5 && main + s.h <= v.h - margin + 0.5 : main >= margin - 0.5 && main + s.w <= v.w - margin + 0.5;
    const centre = vertical ? a.x + a.w / 2 - s.w / 2 : a.y + a.h / 2 - s.h / 2;
    const span = vertical ? Math.max(1, a.w) : Math.max(1, a.h);
    const slides = [0, -0.5, 0.5, -1, 1].map((k) => centre + k * (span / 2 + (vertical ? s.w : s.h) / 2));
    for (const c of slides) {
      const x = vertical ? clampX(c) : clampX(main);
      const y = vertical ? clampY(main) : clampY(c);
      const o = cost(x, y) + (fits ? 0 : 1e9);
      if (!best || o < best.overlap) best = { x, y, placement: side, overlap: o };
      if (o === 0) break;
    }
    if (best && best.overlap === 0) break;
  }
  if (!best || best.overlap > 0) {
    // any free spot, nearest the anchor centre
    const step = 8;
    const ax = a.x + a.w / 2;
    const ay = a.y + a.h / 2;
    let free: { x: number; y: number; d: number } | null = null;
    for (let y = margin; y <= Math.max(margin, v.h - margin - s.h); y += step) {
      for (let x = margin; x <= Math.max(margin, v.w - margin - s.w); x += step) {
        if (cost(x, y) > 0 || overlapArea({ x, y, w: s.w, h: s.h }, a) > 0) continue;
        const d = Math.hypot(x + s.w / 2 - ax, y + s.h / 2 - ay);
        if (!free || d < free.d) free = { x, y, d };
      }
    }
    if (free) best = { x: free.x, y: free.y, placement: 'center', overlap: 0 };
  }
  const b = best ?? { x: clampX(a.x), y: clampY(a.y + a.h + gap), placement: 'bottom' as const, overlap: cost(clampX(a.x), clampY(a.y + a.h + gap)) };
  const overlap = b.overlap >= 1e9 ? b.overlap - 1e9 : b.overlap;
  const arrow =
    b.placement === 'top' || b.placement === 'bottom'
      ? Math.min(Math.max(a.x + a.w / 2 - b.x, 10), Math.max(10, s.w - 10))
      : b.placement === 'center'
        ? 0
        : Math.min(Math.max(a.y + a.h / 2 - b.y, 10), Math.max(10, s.h - 10));
  return { x: b.x, y: b.y, placement: b.placement, arrow, overlap };
}
