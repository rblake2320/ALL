/**
 * Scroll affordances for HUD scroll areas (hidden or thin scrollbars on dark glass need a visible cue):
 *
 *   useOverflowFade(ref, axis)  keeps `data-ofl` on the element in sync with where content is clipped:
 *                               'start' | 'end' | 'both' (attribute removed when everything fits). CSS turns that
 *                               into edge fades (see .hud-ofl-y / .hud-ofl-x in hud.css).
 *   scrollIntoViewIfNeeded(el)  nudges a child into its scroll container without moving the page.
 *
 * The pure part (overflowState) is unit-tested; the hook only wires DOM events to it.
 */
import { useLayoutEffect, useRef } from 'preact/hooks';

export type OverflowState = 'none' | 'start' | 'end' | 'both';

/**
 * Which edges hide content. `pos` = scrollTop/Left, `client` = visible size, `scroll` = content size.
 * A 1px tolerance absorbs sub-pixel layouts; junk input means "nothing hidden".
 */
export function overflowState(pos: number, client: number, scroll: number, tolerance = 1): OverflowState {
  const p = Number.isFinite(pos) ? Math.max(0, pos) : 0;
  const c = Number.isFinite(client) ? Math.max(0, client) : 0;
  const s = Number.isFinite(scroll) ? Math.max(0, scroll) : 0;
  const tol = Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : 1;
  if (s <= c + tol) return 'none';
  const atStart = p <= tol;
  const atEnd = p + c >= s - tol;
  if (atStart && atEnd) return 'none';
  if (atStart) return 'end';
  if (atEnd) return 'start';
  return 'both';
}

function applyOverflow(el: HTMLElement, axis: 'x' | 'y'): OverflowState {
  const st = axis === 'y' ? overflowState(el.scrollTop, el.clientHeight, el.scrollHeight) : overflowState(el.scrollLeft, el.clientWidth, el.scrollWidth);
  if (st === 'none') {
    if (el.hasAttribute('data-ofl')) el.removeAttribute('data-ofl');
  } else if (el.getAttribute('data-ofl') !== st) el.setAttribute('data-ofl', st);
  return st;
}

/**
 * Keep `data-ofl` on `ref.current` in sync with its scroll position / content size. `onChange` (optional) hears
 * every state change — used by rails that show scroll arrows.
 */
export function useOverflowFade(ref: { current: HTMLElement | null }, axis: 'x' | 'y' = 'y', deps: readonly unknown[] = [], onChange?: (s: OverflowState) => void): void {
  const cb = useRef(onChange);
  cb.current = onChange;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    let last: OverflowState | null = null;
    const apply = (node: HTMLElement, ax: 'x' | 'y') => {
      const st = applyOverflow(node, ax);
      if (st !== last) {
        last = st;
        cb.current?.(st);
      }
    };
    const update = () => {
      frame = 0;
      apply(el, axis);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    apply(el, axis);
    el.addEventListener('scroll', schedule, { passive: true });
    let ro: ResizeObserver | null = null;
    let mo: MutationObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(schedule);
      ro.observe(el);
      for (const child of Array.from(el.children)) ro.observe(child);
    }
    if (typeof MutationObserver !== 'undefined') {
      mo = new MutationObserver(() => {
        if (ro) for (const child of Array.from(el.children)) ro.observe(child);
        schedule();
      });
      mo.observe(el, { childList: true, subtree: true, characterData: true });
    }
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
      mo?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Scroll `el` into view inside its nearest scrollable ancestor only (never scrolls the document). */
export function scrollIntoViewIfNeeded(el: HTMLElement | null, axis: 'x' | 'y' = 'y', pad = 8): void {
  if (!el) return;
  let box: HTMLElement | null = el.parentElement;
  while (box) {
    const cs = getComputedStyle(box);
    const ov = axis === 'y' ? cs.overflowY : cs.overflowX;
    if (ov === 'auto' || ov === 'scroll') break;
    box = box.parentElement;
  }
  if (!box) return;
  const r = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  if (axis === 'y') {
    if (r.top < b.top + pad) box.scrollTop -= b.top + pad - r.top;
    else if (r.bottom > b.bottom - pad) box.scrollTop += r.bottom - (b.bottom - pad);
  } else if (r.left < b.left + pad) box.scrollLeft -= b.left + pad - r.left;
  else if (r.right > b.right - pad) box.scrollLeft += r.right - (b.right - pad);
}

/**
 * Horizontal rails (style chips, categories, filter chips): a plain mouse wheel scrolls them sideways. Only while
 * the rail can actually scroll in that direction, so the wheel never gets swallowed at either end.
 */
export function useHorizontalWheel(ref: { current: HTMLElement | null }): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 1) return;
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * el.clientWidth : e.deltaY;
      const next = Math.max(0, Math.min(max, el.scrollLeft + dy));
      if (next === el.scrollLeft) return;
      e.preventDefault();
      el.scrollLeft = next;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
}
