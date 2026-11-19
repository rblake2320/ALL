/**
 * Pure layout math: clamping popups to the viewport, flyout/tooltip placement, bubble stacking,
 * SVG ring dash maths. All coordinates are CSS pixels in viewport space.
 */
import { clamp, isNum, num } from './format';

export interface Size {
  w: number;
  h: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Point {
  x: number;
  y: number;
}

function safeSize(s: Size): Size {
  return { w: Math.max(0, num(s?.w)), h: Math.max(0, num(s?.h)) };
}

/** Keep a box of `size` inside the viewport with a margin; boxes larger than the viewport pin to the margin. */
export function clampBox(x: number, y: number, size: Size, viewport: Size, margin = 8): Point {
  const s = safeSize(size);
  const v = safeSize(viewport);
  const m = Math.max(0, num(margin));
  const maxX = Math.max(m, v.w - m - s.w);
  const maxY = Math.max(m, v.h - m - s.h);
  return { x: clamp(num(x, m), m, maxX), y: clamp(num(y, m), m, maxY) };
}

/**
 * Interaction menu placement near the click point. Prefers below-right of the cursor (offset `gap`),
 * flips left/up when it would overflow, then clamps. `originX/Y` tell CSS where to grow the pop animation from.
 */
export function placeMenu(
  anchor: Point,
  size: Size,
  viewport: Size,
  margin = 8,
  gap = 10,
): { x: number; y: number; originX: 'left' | 'right'; originY: 'top' | 'bottom' } {
  const s = safeSize(size);
  const v = safeSize(viewport);
  const ax = clamp(num(anchor?.x, v.w / 2), 0, v.w);
  const ay = clamp(num(anchor?.y, v.h / 2), 0, v.h);
  let x = ax + gap;
  let originX: 'left' | 'right' = 'left';
  if (x + s.w > v.w - margin && ax - gap - s.w >= margin) {
    x = ax - gap - s.w;
    originX = 'right';
  }
  let y = ay - 18; // title row sits roughly level with the cursor
  let originY: 'top' | 'bottom' = 'top';
  if (y + s.h > v.h - margin && ay + 18 - s.h >= margin) {
    y = ay + 18 - s.h;
    originY = 'bottom';
  }
  const c = clampBox(x, y, s, v, margin);
  return { x: c.x, y: c.y, originX, originY };
}

/** Submenu flyout next to a parent row: right side preferred, flips left; top aligned with the row then clamped. */
export function placeFlyout(parent: Rect, size: Size, viewport: Size, margin = 8, gap = 6): { x: number; y: number; side: 'right' | 'left' } {
  const s = safeSize(size);
  const v = safeSize(viewport);
  const p: Rect = { x: num(parent?.x), y: num(parent?.y), w: Math.max(0, num(parent?.w)), h: Math.max(0, num(parent?.h)) };
  let side: 'right' | 'left' = 'right';
  let x = p.x + p.w + gap;
  if (x + s.w > v.w - margin) {
    const left = p.x - gap - s.w;
    if (left >= margin || left > v.w - margin - (x + s.w)) {
      x = left;
      side = 'left';
    }
  }
  const y = p.y - 6;
  const c = clampBox(x, y, s, v, margin);
  return { x: c.x, y: c.y, side };
}

export type Placement = 'top' | 'bottom' | 'left' | 'right';

/**
 * Tooltip placement around a target rect: tries `prefer`, then the opposite side, then the remaining sides,
 * picking the first that fits; falls back to the side with the most room. The tooltip is centred on the target
 * along the cross axis and clamped; `arrow` is the arrow offset along the cross axis, relative to the tooltip box.
 */
export function placeTooltip(
  target: Rect,
  size: Size,
  viewport: Size,
  prefer: Placement = 'top',
  gap = 8,
  margin = 6,
): { x: number; y: number; placement: Placement; arrow: number } {
  const s = safeSize(size);
  const v = safeSize(viewport);
  const t: Rect = { x: num(target?.x), y: num(target?.y), w: Math.max(0, num(target?.w)), h: Math.max(0, num(target?.h)) };
  const opposite: Record<Placement, Placement> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const order: Placement[] = [prefer, opposite[prefer], ...(['top', 'bottom', 'right', 'left'] as Placement[])].filter(
    (p, i, a) => a.indexOf(p) === i,
  );
  const room: Record<Placement, number> = {
    top: t.y - gap - margin,
    bottom: v.h - (t.y + t.h) - gap - margin,
    left: t.x - gap - margin,
    right: v.w - (t.x + t.w) - gap - margin,
  };
  const need = (p: Placement) => (p === 'top' || p === 'bottom' ? s.h : s.w);
  let placement = order.find((p) => room[p] >= need(p));
  if (!placement) placement = order.reduce((best, p) => (room[p] > room[best] ? p : best), order[0]);
  let x: number;
  let y: number;
  if (placement === 'top' || placement === 'bottom') {
    x = t.x + t.w / 2 - s.w / 2;
    y = placement === 'top' ? t.y - gap - s.h : t.y + t.h + gap;
  } else {
    y = t.y + t.h / 2 - s.h / 2;
    x = placement === 'left' ? t.x - gap - s.w : t.x + t.w + gap;
  }
  const c = clampBox(x, y, s, v, margin);
  const arrow =
    placement === 'top' || placement === 'bottom'
      ? clamp(t.x + t.w / 2 - c.x, 10, Math.max(10, s.w - 10))
      : clamp(t.y + t.h / 2 - c.y, 10, Math.max(10, s.h - 10));
  return { x: c.x, y: c.y, placement, arrow };
}

/**
 * Stack index per bubble: bubbles of the same agent stack upward, oldest at the bottom (index 0).
 * Input order = creation order (controller list order). Returns key → index.
 */
export function stackIndices<T extends { key: number; agentId: string }>(bubbles: readonly T[]): Map<number, number> {
  const perAgent = new Map<string, number>();
  const out = new Map<number, number>();
  for (const b of bubbles ?? []) {
    if (!b || typeof b.agentId !== 'string') continue;
    const i = perAgent.get(b.agentId) ?? 0;
    out.set(b.key, i);
    perAgent.set(b.agentId, i + 1);
  }
  return out;
}

/** stroke-dasharray / dashoffset for a progress ring of radius r. */
export function ringDash(progress: unknown, r: number): { circumference: number; offset: number } {
  const radius = isNum(r) && r > 0 ? r : 0;
  const circumference = 2 * Math.PI * radius;
  const p = clamp(num(progress), 0, 1);
  return { circumference, offset: circumference * (1 - p) };
}

/** Position of a fraction (0..1) along a bar of `width`, clamped so a marker of `markerW` stays inside. */
export function markerX(fraction: unknown, width: number, markerW = 0): number {
  const w = Math.max(0, num(width));
  const m = Math.max(0, num(markerW));
  return clamp(clamp(num(fraction), 0, 1) * w - m / 2, 0, Math.max(0, w - m));
}

/** Cursor-following label position: offset from the pointer, flipped to stay inside the viewport. */
export function cursorLabelPos(pointer: Point, size: Size, viewport: Size, offset: Point = { x: 18, y: 22 }, margin = 6): Point {
  const s = safeSize(size);
  const v = safeSize(viewport);
  const px = num(pointer?.x);
  const py = num(pointer?.y);
  let x = px + offset.x;
  let y = py + offset.y;
  if (x + s.w > v.w - margin) x = px - offset.x - s.w;
  if (y + s.h > v.h - margin) y = py - offset.y - s.h;
  return clampBox(x, y, s, v, margin);
}

/** Where to place a hint callout relative to an anchor rect: pick the side with the most room. */
export function placeCallout(anchor: Rect, size: Size, viewport: Size, gap = 14, margin = 10) {
  return placeTooltip(anchor, size, viewport, bestSide(anchor, viewport), gap, margin);
}

function bestSide(a: Rect, v: Size): Placement {
  const ax = num(a?.x);
  const ay = num(a?.y);
  const aw = num(a?.w);
  const ah = num(a?.h);
  const vw = num(v?.w);
  const vh = num(v?.h);
  const room: [Placement, number][] = [
    ['bottom', vh - (ay + ah)],
    ['top', ay],
    ['right', (vw - (ax + aw)) * 0.8],
    ['left', ax * 0.8],
  ];
  room.sort((p, q) => q[1] - p[1]);
  return room[0][0];
}

/**
 * Geometry of the action queue (rem, queue.css): the active item is ring 3.25 + gaps + a label of up to 15rem + the
 * cancel button (≈ 21rem); each queued tile is 2.5rem + a 0.375rem gap; the "+N" chip ≈ 2.75rem with its gap; the
 * pill's padding + border ≈ 1.1rem.
 */
export const QUEUE_GEOMETRY = { active: 21, tile: 2.875, more: 2.75, chrome: 1.1 } as const;

/**
 * How many queued tiles fit next to the active item in `availRem` of width, reserving room for a "+N" chip when
 * not everything fits. Never negative, never more than `queued` or `max`. `geometry` defaults to QUEUE_GEOMETRY (the
 * phone layout passes its 44 px-target geometry, lib/phoneLayout.ts).
 */
export function queueCapacity(availRem: number, queued: number, max = 8, geometry: { active: number; tile: number; more: number; chrome: number } = QUEUE_GEOMETRY): number {
  const q = Number.isFinite(queued) ? Math.max(0, Math.floor(queued)) : 0;
  const cap = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 8;
  if (!Number.isFinite(availRem)) return Math.min(q, cap);
  const g = geometry ?? QUEUE_GEOMETRY;
  const room = availRem - g.active - g.chrome;
  if (room <= 0) return 0;
  const all = Math.floor(room / g.tile + 1e-6);
  if (all >= q && q <= cap) return q;
  const withMore = Math.floor((room - g.more) / g.tile + 1e-6);
  return Math.max(0, Math.min(cap, q, withMore));
}
