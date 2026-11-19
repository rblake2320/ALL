/** Colour swatch + radiogroup picker (roving tabindex, arrow keys, names as tooltips). */
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { Icon } from '../icons';
import { readableOn, safeHex } from './color';
import { Tooltip } from './Tooltip';
import { cx } from './cx';

export interface SwatchProps {
  color: string;
  label: string;
  selected?: boolean;
  onClick?: () => void;
  size?: 'sm' | 'md' | 'lg';
  tabIndex?: number;
  role?: 'radio' | 'button';
  class?: string;
}

export function Swatch({ color, label, selected, onClick, size = 'md', tabIndex, role = 'button', class: cls }: SwatchProps) {
  const hex = safeHex(color, '#7f7f7f');
  const stateAttr = role === 'radio' ? { role: 'radio' as const, 'aria-checked': selected ? ('true' as const) : ('false' as const) } : { 'aria-pressed': selected ? ('true' as const) : ('false' as const) };
  return (
    <Tooltip content={label} delay={300}>
      <button
        type="button"
        class={cx('ui-swatch', size !== 'md' && `ui-swatch--${size}`, selected && 'is-selected', cls)}
        style={{ '--swatch': hex } as JSX.CSSProperties}
        aria-label={label}
        tabIndex={tabIndex}
        onClick={onClick}
        {...stateAttr}
      >
        <span class="ui-swatch__check" style={{ color: readableOn(hex) }} aria-hidden="true">
          <Icon name="check" size={size === 'sm' ? '0.75rem' : '0.9375rem'} strokeWidth={2.75} />
        </span>
      </button>
    </Tooltip>
  );
}

export interface SwatchPickerProps {
  colors: readonly (string | { value: string; label: string })[];
  value: string | null;
  onChange: (v: string) => void;
  ariaLabel?: string;
  labelledBy?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Compare case-insensitively (hex). Default true. */
  caseInsensitive?: boolean;
  class?: string;
}

export function SwatchPicker({ colors, value, onChange, ariaLabel, labelledBy, size = 'md', caseInsensitive = true, class: cls }: SwatchPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const items = colors.map((c) => (typeof c === 'string' ? { value: c, label: c.toUpperCase() } : c));
  const norm = (s: string | null) => (s === null ? null : caseInsensitive ? s.toLowerCase() : s);
  const selected = items.findIndex((c) => norm(c.value) === norm(value));

  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    const n = items.length;
    if (n === 0) return;
    let next = -1;
    const cur = selected < 0 ? 0 : selected;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (cur + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (cur - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    onChange(items[next].value);
    ref.current?.querySelectorAll<HTMLElement>('.ui-swatch')[next]?.focus();
  };

  return (
    <div ref={ref} class={cx('ui-swatches', cls)} role="radiogroup" aria-label={labelledBy ? undefined : ariaLabel} aria-labelledby={labelledBy} onKeyDown={onKeyDown}>
      {items.map((c, i) => (
        <Swatch
          key={c.value}
          color={c.value}
          label={c.label}
          role="radio"
          size={size}
          selected={i === selected}
          tabIndex={i === selected || (selected < 0 && i === 0) ? 0 : -1}
          onClick={() => onChange(c.value)}
        />
      ))}
    </div>
  );
}
