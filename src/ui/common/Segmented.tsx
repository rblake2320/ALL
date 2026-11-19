/**
 * Segmented control (radiogroup with roving tabindex): arrows move + select; the highlight thumb slides.
 */
import type { ComponentChildren, JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon, type IconName } from '../icons';
import { Tooltip } from './Tooltip';
import { cx } from './cx';

export interface SegmentOption<T extends string | number> {
  value: T;
  label: ComponentChildren;
  icon?: IconName;
  disabled?: boolean;
  /** Tooltip text (required when the label is icon-only). */
  tooltip?: string;
  ariaLabel?: string;
}

export interface SegmentedProps<T extends string | number> {
  value: T;
  options: SegmentOption<T>[];
  onChange: (v: T) => void;
  ariaLabel?: string;
  labelledBy?: string;
  describedBy?: string;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  class?: string;
}

/**
 * Thumb geometry from LAYOUT offsets (offsetLeft/offsetWidth up to the positioned root), not getBoundingClientRect:
 * a control measured while an ancestor is mid entrance animation (scale / slide transform — e.g. the CAZ pose bar)
 * got a transformed rect, and since a transform never triggers the ResizeObserver the thumb stayed under the wrong
 * option, putting muted label text on the light thumb (Sol W-023 A6: CAZ "Idle" at 2.9–3.9:1).
 */
export function thumbBox(el: HTMLElement, root: HTMLElement): { left: number; width: number } {
  let left = 0;
  let n: HTMLElement | null = el;
  // .ui-seg is position:relative, so the offsetParent chain from an option ends at the root
  while (n && n !== root) {
    left += n.offsetLeft;
    const parent = n.offsetParent as HTMLElement | null;
    if (!parent || (parent !== root && !root.contains(parent))) {
      // not positioned as expected (should not happen): fall back to the rect delta
      const rr = root.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      return { left: Math.round(er.left - rr.left), width: Math.round(er.width) };
    }
    n = parent;
  }
  return { left: Math.round(left), width: Math.round(el.offsetWidth) };
}

export function Segmented<T extends string | number>({ value, options, onChange, ariaLabel, labelledBy, describedBy, size = 'md', block, class: cls }: SegmentedProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const el = root.querySelector<HTMLElement>('[aria-checked="true"]');
      if (!el) return setThumb(null);
      const next = thumbBox(el, root);
      setThumb((p) => (p && p.left === next.left && p.width === next.width ? p : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [value, options.length]);

  const idx = options.findIndex((o) => o.value === value);
  const step = (from: number, dir: 1 | -1) => {
    const n = options.length;
    for (let k = 1; k <= n; k++) {
      const i = (((from + dir * k) % n) + n) % n;
      if (!options[i].disabled) return i;
    }
    return from;
  };
  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = step(idx < 0 ? -1 : idx, 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = step(idx < 0 ? 0 : idx, -1);
    else if (e.key === 'Home') next = step(-1, 1);
    else if (e.key === 'End') next = step(options.length, -1);
    else return;
    e.preventDefault();
    e.stopPropagation();
    const o = options[next];
    if (!o) return;
    if (o.value !== value) onChange(o.value);
    const btns = ref.current?.querySelectorAll<HTMLElement>('[role="radio"]');
    btns?.[next]?.focus();
  };

  return (
    <div
      ref={ref}
      class={cx('ui-seg', size !== 'md' && `ui-seg--${size}`, block && 'ui-seg--block', cls)}
      role="radiogroup"
      aria-label={labelledBy ? undefined : ariaLabel}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onKeyDown={onKeyDown}
    >
      {thumb ? <span class="ui-seg__thumb" style={{ left: `${thumb.left}px`, width: `${thumb.width}px` }} aria-hidden="true" /> : null}
      {options.map((o, i) => {
        const checked = o.value === value;
        const btn = (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            class="ui-seg__opt"
            aria-checked={checked ? 'true' : 'false'}
            aria-label={o.ariaLabel}
            tabIndex={checked || (idx < 0 && i === 0) ? 0 : -1}
            disabled={o.disabled}
            onClick={() => !o.disabled && o.value !== value && onChange(o.value)}
          >
            {o.icon ? <Icon name={o.icon} size="1rem" class="ui-seg__icon" /> : null}
            {o.label !== null && o.label !== undefined && o.label !== '' ? <span>{o.label}</span> : null}
          </button>
        );
        return o.tooltip ? (
          <Tooltip key={String(o.value)} content={o.tooltip} block>
            {btn}
          </Tooltip>
        ) : (
          btn
        );
      })}
    </div>
  );
}
