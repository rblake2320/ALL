/**
 * Horizontal chip rail (build style swatches, door/window picks): one scrolling line with edge fades where it is
 * clipped, carousel arrows on the clipped side(s), wheel-to-sideways scrolling, roving arrow-key focus (the group
 * is one Tab stop) and the selected chip kept in view.
 */
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ht } from '../strings';
import { Icon } from './icons';
import { rovingKeyDown } from './roving';
import { scrollIntoViewIfNeeded, useHorizontalWheel, useOverflowFade, type OverflowState } from './scroll';
import { tip } from './tooltip';

function reducedMotion(): boolean {
  if (typeof document === 'undefined') return true;
  if (document.documentElement.classList.contains('reduce-motion')) return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function Rail({
  label,
  selectedKey,
  class: cls,
  role = 'radiogroup',
  size = 'md',
  children,
}: {
  label: string;
  /** Changes when the selection changes (keeps the selected chip in view). */
  selectedKey: unknown;
  class?: string;
  role?: 'radiogroup' | 'tablist' | 'group';
  /** 'sm' = pill-sized arrows for filter-chip rails. */
  size?: 'sm' | 'md';
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<OverflowState>('none');
  useOverflowFade(ref, 'x', [], setState);
  useHorizontalWheel(ref);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-checked="true"],[aria-selected="true"]');
    if (el) scrollIntoViewIfNeeded(el, 'x', 28);
  }, [selectedKey]);
  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(80, el.clientWidth * 0.75), behavior: reducedMotion() ? 'auto' : 'smooth' });
  };
  return (
    <div class={`hud-rail${size === 'sm' ? ' is-sm' : ''}`}>
      <div ref={ref} class={`hud-rail__track hud-ofl-x${cls ? ` ${cls}` : ''}`} role={role} aria-label={label} aria-orientation="horizontal" data-roving-group="" onKeyDown={rovingKeyDown}>
        {children}
      </div>
      {(state === 'start' || state === 'both') && (
        <button type="button" class="hud-rail__arrow is-prev" tabIndex={-1} aria-label={ht('rail.prev')} onClick={() => page(-1)} {...tip({ title: ht('rail.prev') })}>
          <Icon name="chevronLeft" size={size === 'sm' ? '0.8125rem' : '1rem'} strokeWidth={2.2} />
        </button>
      )}
      {(state === 'end' || state === 'both') && (
        <button type="button" class="hud-rail__arrow is-next" tabIndex={-1} aria-label={ht('rail.next')} onClick={() => page(1)} {...tip({ title: ht('rail.next') })}>
          <Icon name="chevronRight" size={size === 'sm' ? '0.8125rem' : '1rem'} strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
}
