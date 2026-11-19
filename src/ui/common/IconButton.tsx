import type { ButtonHTMLAttributes, ComponentChildren } from 'preact';
import { Icon, type IconName } from '../icons';
import { Tooltip } from './Tooltip';
import type { Placement } from './position';
import { cx } from './cx';
import { ariaKeyShortcuts } from './hotkeys';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'icon' | 'size' | 'label' | 'class'> {
  icon: IconName;
  /** Required: accessible name AND tooltip text. */
  label: string;
  /** Extra tooltip line. */
  description?: ComponentChildren;
  hotkey?: string | readonly string[];
  size?: 'xs' | 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'glass' | 'primary' | 'danger';
  /** Toggle state (aria-pressed). */
  pressed?: boolean;
  badge?: ComponentChildren;
  tooltipPlacement?: Placement;
  /** Hide the tooltip (e.g. inside a menu that already shows labels). */
  noTooltip?: boolean;
  iconSize?: string;
  class?: string;
}

export function IconButton({
  icon,
  label,
  description,
  hotkey,
  size = 'md',
  variant = 'ghost',
  pressed,
  badge,
  tooltipPlacement = 'top',
  noTooltip,
  iconSize,
  class: cls,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const isz = iconSize ?? (size === 'lg' ? '1.5rem' : size === 'xs' ? '0.875rem' : size === 'sm' ? '1.125rem' : '1.25rem');
  const btn = (
    <button
      {...rest}
      type={type}
      class={cx('ui-iconbtn', size !== 'md' && `ui-iconbtn--${size}`, variant !== 'ghost' && `ui-iconbtn--${variant}`, cls)}
      aria-label={label}
      aria-pressed={pressed === undefined ? undefined : pressed ? 'true' : 'false'}
      aria-keyshortcuts={hotkey ? ariaKeyShortcuts(hotkey) : undefined}
    >
      <Icon name={icon} size={isz} />
      {badge ? <span class="ui-iconbtn__badge">{badge}</span> : null}
    </button>
  );
  if (noTooltip) return btn;
  return (
    <Tooltip content={label} description={description} hotkey={hotkey} placement={tooltipPlacement}>
      {btn}
    </Tooltip>
  );
}
