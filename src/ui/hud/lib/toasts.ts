/**
 * Toast lifetime bookkeeping (pure). The controller owns the toast list; the HUD decides when each one has been
 * on screen long enough (≈6 s of *unhovered* time) and asks the controller to dismiss it.
 */
import type { Toast } from '../../../game/contracts';
import { isNum } from './format';

export const TOAST_LIFETIME_MS = 6000;
export const TOAST_MAX_VISIBLE = 5;

export interface ToastClock {
  /** ms of visible, unpaused time accumulated so far. */
  shown: number;
  /** last `now` we accounted for. */
  last: number;
}

export type ToastClocks = Record<number, ToastClock>;

/** Newest `max` toasts (newest first) + ids of older ones that should be dismissed to respect the cap. */
export function visibleToasts(toasts: readonly Toast[], max = TOAST_MAX_VISIBLE): { visible: Toast[]; overflow: number[] } {
  const list = (toasts ?? []).filter((t) => t && isNum(t.id));
  const sorted = list.slice().sort((a, b) => (isNum(b.createdAt) ? b.createdAt : 0) - (isNum(a.createdAt) ? a.createdAt : 0) || b.id - a.id);
  const cap = Math.max(0, Math.floor(isNum(max) ? max : TOAST_MAX_VISIBLE));
  return { visible: sorted.slice(0, cap), overflow: sorted.slice(cap).map((t) => t.id) };
}

/**
 * Advance every toast's clock to `now`. Paused toasts (hovered, or all when `allPaused`) do not age.
 * New toasts start aging from max(createdAt, first time we saw them) so a toast created while the HUD was
 * hidden still gets its full time. Returns the next clocks and ids whose lifetime is used up.
 */
export function advanceToastClocks(
  prev: ToastClocks,
  toasts: readonly Toast[],
  now: number,
  paused: ReadonlySet<number>,
  lifetime = TOAST_LIFETIME_MS,
  allPaused = false,
): { clocks: ToastClocks; expired: number[] } {
  const clocks: ToastClocks = {};
  const expired: number[] = [];
  const t = isNum(now) ? now : 0;
  const life = isNum(lifetime) && lifetime > 0 ? lifetime : TOAST_LIFETIME_MS;
  for (const toast of toasts ?? []) {
    if (!toast || !isNum(toast.id)) continue;
    const c = prev[toast.id];
    if (!c) {
      clocks[toast.id] = { shown: 0, last: t };
      continue;
    }
    const dt = Math.max(0, t - c.last);
    const shown = paused.has(toast.id) || allPaused ? c.shown : c.shown + dt;
    clocks[toast.id] = { shown, last: t };
    if (shown >= life) expired.push(toast.id);
  }
  return { clocks, expired };
}

/** Remaining fraction 0..1 for a toast's progress bar. */
export function toastRemaining(clock: ToastClock | undefined, lifetime = TOAST_LIFETIME_MS): number {
  if (!clock) return 1;
  const life = isNum(lifetime) && lifetime > 0 ? lifetime : TOAST_LIFETIME_MS;
  return Math.max(0, Math.min(1, 1 - clock.shown / life));
}
