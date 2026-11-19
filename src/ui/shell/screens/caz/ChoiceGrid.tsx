/** Radio-style grid of visual choices (hairstyles, eyes, outfits) with roving tabindex + arrow keys. */
import type { ComponentChildren, JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { Tooltip } from '../../../common/Tooltip';
import { cx } from '../../../common/cx';

export interface ChoiceItem<T extends string> {
  value: T;
  label: string;
  preview?: ComponentChildren;
  disabled?: boolean;
  tooltip?: string;
}

export function ChoiceGrid<T extends string>({
  items,
  value,
  onChange,
  labelledBy,
  ariaLabel,
  min = '5.25rem',
  class: cls,
}: {
  items: ChoiceItem<T>[];
  value: T;
  onChange: (v: T) => void;
  labelledBy?: string;
  ariaLabel?: string;
  min?: string;
  class?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const idx = items.findIndex((i) => i.value === value);
  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(e.key) || items.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const btns = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? []);
    const cols = Math.max(1, Math.round((ref.current?.clientWidth ?? 1) / Math.max(1, btns[0]?.offsetWidth ?? 1)));
    // Start from the focused tile (the selection may not have re-rendered yet after a fast key repeat).
    const focused = btns.findIndex((b) => b === document.activeElement);
    const cur = focused >= 0 ? focused : idx < 0 ? 0 : idx;
    let next = cur;
    if (e.key === 'ArrowRight') next = cur + 1;
    else if (e.key === 'ArrowLeft') next = cur - 1;
    else if (e.key === 'ArrowDown') next = cur + cols;
    else if (e.key === 'ArrowUp') next = cur - cols;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    next = Math.min(items.length - 1, Math.max(0, next));
    const it = items[next];
    if (!it || it.disabled) return;
    if (next !== cur || it.value !== value) onChange(it.value);
    btns[next]?.focus();
  };
  return (
    <div
      ref={ref}
      class={cx('ui-choice-grid', cls)}
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : ariaLabel}
      style={{ '--choice-min': min } as JSX.CSSProperties}
      onKeyDown={onKeyDown}
    >
      {items.map((it, i) => {
        const checked = it.value === value;
        const btn = (
          <button
            key={it.value}
            type="button"
            role="radio"
            class="ui-choice"
            aria-checked={checked ? 'true' : 'false'}
            tabIndex={checked || (idx < 0 && i === 0) ? 0 : -1}
            disabled={it.disabled}
            onClick={() => it.value !== value && onChange(it.value)}
          >
            {it.preview}
            <span class="ui-choice__label">{it.label}</span>
          </button>
        );
        return it.tooltip ? (
          <Tooltip key={it.value} content={it.tooltip} block>
            {btn}
          </Tooltip>
        ) : (
          btn
        );
      })}
    </div>
  );
}
