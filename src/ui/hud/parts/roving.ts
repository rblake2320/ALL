/**
 * Roving keyboard navigation for HUD radio groups, chip rails, tool palettes and swatch grids (WAI-ARIA radio /
 * tab patterns): the group is ONE Tab stop (the checked item, else the first), arrow keys move focus and — like a
 * native radio group — select the item they land on. Home/End jump to the ends.
 *
 *   <div role="radiogroup" onKeyDown={rovingKeyDown}> … <button role="radio" tabIndex={rovingIndex(i, sel, n)}>
 *
 * Grids (2D swatch sheets) use `cols` so ↑/↓ move by a whole row; 0 = a single line where every arrow moves by one.
 */

/** Next index for a key, or null when the key is not a navigation key. `disabled[i]` items are skipped. */
export function nextRovingIndex(
  current: number,
  count: number,
  key: string,
  opts: { cols?: number; wrap?: boolean; disabled?: readonly boolean[]; orientation?: 'horizontal' | 'vertical' | 'both' } = {},
): number | null {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (n === 0) return null;
  const cols = opts.cols && Number.isFinite(opts.cols) && opts.cols > 1 ? Math.floor(opts.cols) : 0;
  const wrap = opts.wrap !== false;
  const orientation = opts.orientation ?? 'both';
  const ok = (i: number) => i >= 0 && i < n && !(opts.disabled?.[i] ?? false);
  const cur = Number.isFinite(current) && current >= 0 && current < n ? Math.floor(current) : -1;
  const horiz = orientation !== 'vertical';
  const vert = orientation !== 'horizontal';
  let step = 0;
  if (key === 'Home' || key === 'End') {
    const order = key === 'Home' ? Array.from({ length: n }, (_, i) => i) : Array.from({ length: n }, (_, i) => n - 1 - i);
    return order.find(ok) ?? null;
  }
  if ((key === 'ArrowRight' && horiz) || (key === 'ArrowDown' && vert && !cols)) step = 1;
  else if ((key === 'ArrowLeft' && horiz) || (key === 'ArrowUp' && vert && !cols)) step = -1;
  else if (key === 'ArrowDown' && vert && cols) step = cols;
  else if (key === 'ArrowUp' && vert && cols) step = -cols;
  else return null;
  if (cur < 0) {
    const first = (step > 0 ? Array.from({ length: n }, (_, i) => i) : Array.from({ length: n }, (_, i) => n - 1 - i)).find(ok);
    return first ?? null;
  }
  let i = cur;
  for (let guard = 0; guard <= n; guard++) {
    let next = i + step;
    if (next < 0 || next >= n) {
      // rows never wrap (↓ on the last row stays put); single lines wrap unless told not to
      if (Math.abs(step) !== 1 || !wrap) return cur;
      next = (next + n) % n;
    }
    if (next === cur) return cur;
    if (ok(next)) return next;
    i = next;
  }
  return cur;
}

/** tabIndex for item `i` in a roving group: only the selected item (or the first, when none is) is tabbable. */
export function rovingTabIndex(i: number, selectedIndex: number, count: number): 0 | -1 {
  const sel = selectedIndex >= 0 && selectedIndex < count ? selectedIndex : 0;
  return i === sel ? 0 : -1;
}

const ITEM_SELECTOR = '[role="radio"],[role="tab"],[data-roving]';

/**
 * Keydown handler for a group container marked `data-roving-group`. Moves focus between the group's own items
 * (items of nested groups are left alone) and clicks the item it lands on, so selection follows focus. Set
 * `data-roving-cols` on the container to force a column count for grids (otherwise measured from the layout),
 * `data-roving-manual` to move focus only (Enter/Space then select natively).
 */
export function rovingKeyDown(e: KeyboardEvent): void {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const group = e.currentTarget as HTMLElement | null;
  const from = e.target as HTMLElement | null;
  if (!group || !from) return;
  const items = Array.from(group.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter((el) => el.closest('[data-roving-group]') === group);
  const idx = items.indexOf(from.closest(ITEM_SELECTOR) as HTMLElement);
  if (idx < 0) return;
  const cols = Number(group.getAttribute('data-roving-cols')) || measuredColumns(items);
  const orientation = (group.getAttribute('aria-orientation') as 'horizontal' | 'vertical' | null) ?? 'both';
  const disabled = items.map((el) => (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true');
  const next = nextRovingIndex(idx, items.length, e.key, { cols, disabled, orientation });
  if (next === null) return;
  e.preventDefault();
  e.stopPropagation();
  if (next === idx) return;
  const el = items[next];
  if (group.hasAttribute('data-roving-manual')) {
    // focus-only groups (info lists): the item we land on becomes the group's Tab stop
    for (const it of items) if (it !== el && it.tabIndex === 0) it.tabIndex = -1;
    el.tabIndex = 0;
  }
  el.focus({ preventScroll: false });
  if (!group.hasAttribute('data-roving-manual')) el.click();
}

/** Spread onto a focus-only list container (needs, moodlets, skills, relationships, traits). */
export const ROVING_LIST = { 'data-roving-group': '', 'data-roving-manual': '', onKeyDown: rovingKeyDown } as const;

/** Columns of a wrapped flex/grid sheet, read from the items' offsetTop (1 = a single row). */
function measuredColumns(items: HTMLElement[]): number {
  if (items.length < 2) return 0;
  const top = items[0].offsetTop;
  let cols = 0;
  for (const el of items) {
    if (Math.abs(el.offsetTop - top) > 2) break;
    cols++;
  }
  return cols >= items.length ? 0 : cols;
}
