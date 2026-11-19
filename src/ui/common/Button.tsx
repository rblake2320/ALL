import type { ButtonHTMLAttributes, ComponentChildren } from 'preact';
import { Icon, type IconName } from '../icons';
import { Kbd } from './Kbd';
import { ariaKeyShortcuts } from './hotkeys';
import { Spinner } from './Spinner';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'icon' | 'size' | 'loading' | 'class'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  /** KEYMAP combo shown as a hint chip (display only — bind the key with useHotkey). */
  hotkey?: string;
  loading?: boolean;
  block?: boolean;
  class?: string;
  children?: ComponentChildren;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  hotkey,
  loading = false,
  block,
  class: cls,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const iconSize = size === 'lg' ? '1.25rem' : size === 'sm' ? '1rem' : '1.125rem';
  return (
    <button
      {...rest}
      type={type}
      class={cx('ui-btn', `ui-btn--${variant}`, size !== 'md' && `ui-btn--${size}`, block && 'ui-btn--block', cls)}
      disabled={disabled || loading}
      aria-busy={loading ? 'true' : undefined}
      aria-keyshortcuts={hotkey ? ariaKeyShortcuts(hotkey) : undefined}
    >
      {loading ? (
        <span class="ui-btn__icon">
          <Spinner size={iconSize} />
        </span>
      ) : icon ? (
        <span class="ui-btn__icon">
          <Icon name={icon} size={iconSize} />
        </span>
      ) : null}
      {children !== undefined && children !== null ? <span class="ui-btn__label">{children}</span> : null}
      {iconRight && !loading ? (
        <span class="ui-btn__icon">
          <Icon name={iconRight} size={iconSize} />
        </span>
      ) : null}
      {hotkey ? <Kbd combo={hotkey} class="ui-btn__kbd" /> : null}
    </button>
  );
}
