import type { ComponentChildren, JSX } from 'preact';
import { Icon } from '../icons';
import { cx } from './cx';

export interface CardProps {
  selected?: boolean;
  disabled?: boolean;
  /** Renders a <button>; `role` decides which ARIA state reflects `selected`. */
  onClick?: (e: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
  role?: 'button' | 'radio' | 'checkbox';
  compact?: boolean;
  /** Show the round check badge when selected (default true for interactive cards). */
  check?: boolean;
  class?: string;
  style?: JSX.CSSProperties;
  title?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  tabIndex?: number;
  onKeyDown?: (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => void;
  /** Extra `data-*` attributes (keys without the `data-` prefix), e.g. { lot: 'derelict' } → data-lot="derelict". */
  dataset?: Record<string, string>;
  children?: ComponentChildren;
}

export function Card({
  selected,
  disabled,
  onClick,
  role = 'button',
  compact,
  check,
  class: cls,
  style,
  children,
  tabIndex,
  onKeyDown,
  title,
  dataset,
  ...aria
}: CardProps) {
  const data: Record<string, string> = {};
  if (dataset) for (const k of Object.keys(dataset)) if (/^[a-z][a-z0-9-]*$/.test(k)) data[`data-${k}`] = dataset[k];
  const classes = cx('ui-card', compact && 'ui-card--compact', onClick && 'ui-card--interactive', selected && 'is-selected', cls);
  const showCheck = (check ?? !!onClick) && selected;
  if (!onClick) {
    return (
      <div class={classes} style={style} title={title} aria-label={aria['aria-label']} {...data}>
        {children}
      </div>
    );
  }
  const stateAttr =
    role === 'button'
      ? { 'aria-pressed': selected ? ('true' as const) : ('false' as const) }
      : { 'aria-checked': selected ? ('true' as const) : ('false' as const), role };
  return (
    <button
      type="button"
      class={classes}
      style={style}
      disabled={disabled}
      onClick={onClick}
      onKeyDown={onKeyDown}
      tabIndex={tabIndex}
      title={title}
      aria-label={aria['aria-label']}
      aria-describedby={aria['aria-describedby']}
      {...data}
      {...stateAttr}
    >
      {children}
      {showCheck ? (
        <span class="ui-card__check" aria-hidden="true">
          <Icon name="check" size="0.875rem" strokeWidth={2.5} />
        </span>
      ) : null}
    </button>
  );
}
