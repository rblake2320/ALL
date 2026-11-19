/**
 * Custom select (button + listbox popover in the 'popover' portal layer so it floats above dialogs).
 * Keyboard: ↑/↓ open & move, Enter/Space choose, Esc close (without closing the parent dialog), Tab closes,
 * type-ahead by first letter. aria-activedescendant keeps focus on the button.
 */
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon, type IconName } from '../icons';
import { Portal } from './Portal';
import { computePosition } from './position';
import { cx } from './cx';
import { useUid } from './uid';

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  description?: string;
  icon?: IconName;
  disabled?: boolean;
}

export interface SelectProps<T extends string | number> {
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  ariaLabel?: string;
  labelledBy?: string;
  describedBy?: string;
  disabled?: boolean;
  placeholder?: string;
  class?: string;
  id?: string;
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  labelledBy,
  describedBy,
  disabled,
  placeholder = '—',
  class: cls,
  id,
}: SelectProps<T>) {
  const autoId = useUid();
  const baseId = id ?? autoId;
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = options.findIndex((o) => o.value === value);
  const [active, setActive] = useState(selectedIndex);
  const current = selectedIndex >= 0 ? options[selectedIndex] : null;

  const move = (from: number, dir: 1 | -1) => {
    const n = options.length;
    for (let k = 1; k <= n; k++) {
      const i = (((from + dir * k) % n) + n) % n;
      if (!options[i].disabled) return i;
    }
    return from;
  };

  const openList = (at?: number) => {
    if (disabled || options.length === 0) return;
    setActive(at ?? (selectedIndex >= 0 ? selectedIndex : move(-1, 1)));
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  };
  const choose = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    if (o.value !== value) onChange(o.value);
    close();
  };

  // Close on outside pointer.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (btnRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
      // A click on a dialog backdrop should only dismiss the dropdown, not the whole dialog.
      if ((t as Element | null)?.closest?.('.ui-modal-backdrop')) {
        const swallow = (ev: Event) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        document.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => document.removeEventListener('click', swallow, true), 600);
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const k = e.key;
    if (!open) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (k === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (k === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => move(a, 1));
    } else if (k === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => move(a, -1));
    } else if (k === 'Home') {
      e.preventDefault();
      setActive(move(-1, 1));
    } else if (k === 'End') {
      e.preventDefault();
      setActive(move(options.length, -1));
    } else if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      choose(active);
    } else if (k === 'Tab') {
      close(false);
    } else if (k.length === 1 && /\S/.test(k)) {
      const lower = k.toLowerCase();
      const n = options.length;
      for (let s = 1; s <= n; s++) {
        const i = (active + s) % n;
        if (!options[i].disabled && options[i].label.toLowerCase().startsWith(lower)) {
          setActive(i);
          break;
        }
      }
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        id={baseId}
        class={cx('ui-select', cls)}
        aria-haspopup="listbox"
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={open ? `${baseId}-list` : undefined}
        aria-activedescendant={open && active >= 0 ? `${baseId}-opt-${active}` : undefined}
        aria-label={labelledBy ? undefined : ariaLabel}
        aria-labelledby={labelledBy ? `${labelledBy} ${baseId}` : undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
      >
        {current?.icon ? <Icon name={current.icon} size="1rem" /> : null}
        <span class="ui-select__value">{current ? current.label : placeholder}</span>
        <Icon name="chevronDown" size="1rem" class="ui-select__chevron" />
      </button>
      {open ? (
        <Portal layer="popover">
          <Listbox
            id={`${baseId}-list`}
            baseId={baseId}
            anchor={btnRef}
            listRef={listRef}
            options={options}
            value={value}
            active={active}
            onHover={setActive}
            onChoose={choose}
          />
        </Portal>
      ) : null}
    </>
  );
}

function Listbox<T extends string | number>({
  id,
  baseId,
  anchor,
  listRef,
  options,
  value,
  active,
  onHover,
  onChoose,
}: {
  id: string;
  baseId: string;
  anchor: { current: HTMLElement | null };
  listRef: { current: HTMLUListElement | null };
  options: SelectOption<T>[];
  value: T;
  active: number;
  onHover: (i: number) => void;
  onChoose: (i: number) => void;
}) {
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current;
      const el = listRef.current;
      if (!a || !el) return;
      const r = a.getBoundingClientRect();
      el.style.minWidth = `${Math.round(r.width)}px`;
      const pos = computePosition(r, { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, 'bottom', 6, 8);
      const x = pos.placement === 'bottom' || pos.placement === 'top' ? Math.min(Math.max(8, r.left), window.innerWidth - el.offsetWidth - 8) : pos.x;
      el.style.left = `${Math.round(x)}px`;
      el.style.top = `${pos.y}px`;
      el.style.transformOrigin = pos.placement === 'top' ? 'bottom center' : 'top center';
    };
    place();
    // Follow the button when the window resizes or a scroll container under it moves.
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, []);

  useLayoutEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(`${baseId}-opt-${active}`)}`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <ul ref={listRef} id={id} role="listbox" class="ui-listbox" tabIndex={-1}>
      {options.map((o, i) => (
        <li
          key={String(o.value)}
          id={`${baseId}-opt-${i}`}
          role="option"
          class={cx('ui-option', i === active && 'is-active')}
          aria-selected={o.value === value ? 'true' : 'false'}
          aria-disabled={o.disabled ? 'true' : undefined}
          onPointerEnter={() => onHover(i)}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => onChoose(i)}
        >
          {o.icon ? <Icon name={o.icon} size="1rem" /> : null}
          <span>
            {o.label}
            {o.description ? <span class="ui-option__desc">{o.description}</span> : null}
          </span>
          {o.value === value ? <Icon name="check" size="1rem" class="ui-option__check" /> : null}
        </li>
      ))}
    </ul>
  );
}
