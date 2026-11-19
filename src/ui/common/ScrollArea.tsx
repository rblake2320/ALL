/** Scroll container with themed scrollbars and edge fades that appear only when content overflows. */
import type { ComponentChildren, JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { cx } from './cx';

export interface ScrollAreaProps {
  children?: ComponentChildren;
  axis?: 'y' | 'x';
  fade?: boolean;
  maxHeight?: string;
  class?: string;
  style?: JSX.CSSProperties;
  role?: JSX.HTMLAttributes<HTMLDivElement>['role'];
  'aria-label'?: string;
  tabIndex?: number;
  id?: string;
}

export function ScrollArea({ children, axis = 'y', fade = true, maxHeight, class: cls, style, role, tabIndex, id, ...aria }: ScrollAreaProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Set up once per mount (not per render: the shell re-renders on every controller notification). Children that
  // come and go are tracked with a MutationObserver so the edge fades follow content changes and tab switches.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !fade || axis !== 'y') {
      if (el) {
        delete el.dataset.fadeTop;
        delete el.dataset.fadeBottom;
      }
      return;
    }
    const update = () => {
      const top = el.scrollTop > 2;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
      if (el.dataset.fadeTop !== String(top)) el.dataset.fadeTop = String(top);
      if (el.dataset.fadeBottom !== String(bottom)) el.dataset.fadeBottom = String(bottom);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    let ro: ResizeObserver | null = null;
    let mo: MutationObserver | null = null;
    const observeChildren = () => {
      if (!ro) return;
      ro.disconnect();
      ro.observe(el);
      for (const child of Array.from(el.children)) ro.observe(child);
    };
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      observeChildren();
    }
    if (typeof MutationObserver !== 'undefined') {
      mo = new MutationObserver(() => {
        observeChildren();
        update();
      });
      mo.observe(el, { childList: true });
    }
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [fade, axis]);
  return (
    <div
      ref={ref}
      id={id}
      class={cx('ui-scroll', axis === 'x' && 'ui-scroll--x', cls)}
      style={{ ...(maxHeight ? { maxHeight } : {}), ...(style as object) }}
      role={role}
      aria-label={aria['aria-label']}
      tabIndex={tabIndex}
    >
      {children}
    </div>
  );
}
