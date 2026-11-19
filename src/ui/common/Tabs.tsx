/**
 * Tabs (WAI-ARIA tabs pattern, automatic activation): ←/→ (and ↑/↓) move + select, Home/End jump.
 * Pair with <TabPanel idBase value={id}> for aria-controls/labelledby wiring.
 */
import type { ComponentChildren, JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon, type IconName } from '../icons';
import { cx } from './cx';

export interface TabItem {
  id: string;
  label: ComponentChildren;
  icon?: IconName;
  badge?: ComponentChildren;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Used to build element ids (tab: `${idBase}-tab-${id}`, panel: `${idBase}-panel-${id}`). */
  idBase: string;
  ariaLabel: string;
  variant?: 'underline' | 'pills';
  orientation?: 'horizontal' | 'vertical';
  fill?: boolean;
  /** Mark the selected tab `data-autofocus` (Modal focuses it on open: arrows switch tabs right away). */
  autoFocusSelected?: boolean;
  class?: string;
}

export const tabId = (base: string, id: string) => `${base}-tab-${id}`;
export const panelId = (base: string, id: string) => `${base}-panel-${id}`;

/** Next enabled index in a direction, wrapping; returns `from` if none. */
export function nextEnabledIndex(items: { disabled?: boolean }[], from: number, dir: 1 | -1): number {
  const n = items.length;
  if (n === 0) return -1;
  for (let k = 1; k <= n; k++) {
    const i = (((from + dir * k) % n) + n) % n;
    if (!items[i].disabled) return i;
  }
  return from;
}

export function Tabs({ items, value, onChange, idBase, ariaLabel, variant = 'underline', orientation = 'horizontal', fill, autoFocusSelected, class: cls }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ left: number; width: number; top: number; height: number } | null>(null);
  const vertical = orientation === 'vertical';

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const el = list.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!el) return setInd(null);
      const next = vertical
        ? { left: el.offsetLeft, width: 2, top: el.offsetTop + 6, height: Math.max(0, el.offsetHeight - 12) }
        : { left: el.offsetLeft + 8, width: Math.max(0, el.offsetWidth - 16), top: 0, height: 0 };
      setInd((p) => (p && p.left === next.left && p.width === next.width && p.top === next.top && p.height === next.height ? p : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  }, [value, items.length, vertical]);

  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    const idx = items.findIndex((it) => it.id === value);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = nextEnabledIndex(items, idx < 0 ? -1 : idx, 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = nextEnabledIndex(items, idx < 0 ? 0 : idx, -1);
    else if (e.key === 'Home') next = nextEnabledIndex(items, -1, 1);
    else if (e.key === 'End') next = nextEnabledIndex(items, items.length, -1);
    else return;
    e.preventDefault();
    e.stopPropagation();
    if (next < 0 || next >= items.length) return;
    const it = items[next];
    if (it.id !== value) onChange(it.id);
    const btn = listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(tabId(idBase, it.id))}`);
    btn?.focus();
  };

  return (
    <div
      ref={listRef}
      class={cx('ui-tabs', `ui-tabs--${variant}`, vertical && 'ui-tabs--vertical', fill && 'ui-tabs--fill', cls)}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={vertical ? 'vertical' : undefined}
      onKeyDown={onKeyDown}
    >
      {items.map((it) => {
        const selected = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            id={tabId(idBase, it.id)}
            class="ui-tab"
            aria-selected={selected ? 'true' : 'false'}
            aria-controls={panelId(idBase, it.id)}
            tabIndex={selected ? 0 : -1}
            data-autofocus={autoFocusSelected && selected ? true : undefined}
            disabled={it.disabled}
            onClick={() => !it.disabled && it.id !== value && onChange(it.id)}
          >
            {it.icon ? <Icon name={it.icon} size="1.0625rem" class="ui-tab__icon" /> : null}
            <span>{it.label}</span>
            {it.badge ? <span class="ui-tab__badge">{it.badge}</span> : null}
          </button>
        );
      })}
      {ind && variant === 'underline' ? (
        <span
          class="ui-tabs__indicator"
          style={vertical ? { left: `${ind.left}px`, top: `${ind.top}px`, height: `${ind.height}px`, width: '2px', bottom: 'auto' } : { left: `${ind.left}px`, width: `${ind.width}px` }}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}

export function TabPanel({
  idBase,
  value,
  class: cls,
  children,
}: {
  idBase: string;
  value: string;
  class?: string;
  children: ComponentChildren;
}) {
  return (
    <div role="tabpanel" id={panelId(idBase, value)} aria-labelledby={tabId(idBase, value)} class={cx('ui-tabpanel', cls)} tabIndex={-1} key={value}>
      {children}
    </div>
  );
}
