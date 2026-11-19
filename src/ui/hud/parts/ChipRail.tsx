/**
 * Single-select filter chips (relationship filters, notice-log filters) as one scrolling line: a WAI-ARIA
 * radiogroup with roving focus (one Tab stop, arrows move + select), edge fades and small carousel arrows where chips
 * are clipped (so "there is more" is visible even when the cut falls between two chips), wheel scrolling, and the
 * selected chip kept in view. Built on Rail.
 */
import type { ComponentChildren } from 'preact';
import { Rail } from './Rail';
import { rovingTabIndex } from './roving';

export interface Chip<T extends string> {
  value: T;
  label: string;
  count?: number;
  icon?: ComponentChildren;
}

export function ChipRail<T extends string>({ value, chips, onChange, label, class: cls }: { value: T; chips: Chip<T>[]; onChange: (v: T) => void; label: string; class?: string }) {
  const sel = chips.findIndex((c) => c.value === value);
  return (
    <Rail class={`hud-chiprail${cls ? ` ${cls}` : ''}`} label={label} selectedKey={`${value}|${chips.length}`} size="sm">
      {chips.map((c, i) => (
        <button
          type="button"
          role="radio"
          key={c.value}
          aria-checked={c.value === value ? 'true' : 'false'}
          tabIndex={rovingTabIndex(i, sel, chips.length)}
          aria-label={c.count !== undefined ? `${c.label} (${c.count})` : c.label}
          class="hud-chip"
          onClick={() => c.value !== value && onChange(c.value)}
        >
          {c.icon}
          <span class="hud-chip__label">{c.label}</span>
          {c.count !== undefined && <span class="hud-chip__count u-num">{c.count}</span>}
        </button>
      ))}
    </Rail>
  );
}
