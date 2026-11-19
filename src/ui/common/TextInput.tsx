import type { ComponentChildren, JSX } from 'preact';

import { t } from '../../i18n';
import { Icon, type IconName } from '../icons';
import { cx } from './cx';
import { useUid } from './uid';

export interface TextInputProps {
  label?: ComponentChildren;
  value: string;
  onInput: (v: string) => void;
  maxLength?: number;
  /** Validation message (shown + aria-invalid). */
  error?: string | null;
  hint?: ComponentChildren;
  placeholder?: string;
  icon?: IconName;
  /** Trailing slot inside the field (e.g. a dice IconButton). */
  trailing?: ComponentChildren;
  size?: 'md' | 'lg';
  showCounter?: boolean;
  onEnter?: () => void;
  onBlur?: () => void;
  disabled?: boolean;
  ariaLabel?: string;
  autoFocus?: boolean;
  id?: string;
  class?: string;
}

/** Clamp a string to `max` user-perceived characters (code points), tolerating garbage. */
export function clampText(v: unknown, max?: number): string {
  const s = typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
  if (!max || !Number.isFinite(max) || max <= 0) return s;
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, Math.floor(max)).join('') : s;
}

export function TextInput({
  label,
  value,
  onInput,
  maxLength,
  error,
  hint,
  placeholder,
  icon,
  trailing,
  size = 'md',
  showCounter,
  onEnter,
  onBlur,
  disabled,
  ariaLabel,
  autoFocus,
  id,
  class: cls,
}: TextInputProps) {
  const autoId = useUid();
  const inputId = id ?? autoId;
  const errId = `${inputId}-err`;
  const len = Array.from(value ?? '').length;
  const counter = showCounter ?? !!maxLength;
  const handle = (e: JSX.TargetedEvent<HTMLInputElement, Event>) => {
    const el = e.currentTarget;
    const next = clampText(el.value, maxLength);
    if (next !== el.value) el.value = next;
    onInput(next);
  };
  return (
    <div class={cx('ui-field', cls)}>
      {label !== undefined ? (
        <label class="ui-field__label" for={inputId}>
          <span>{label}</span>
          {hint ? <span class="ui-field__hint">{hint}</span> : null}
        </label>
      ) : null}
      <div class={cx('ui-input-wrap', size === 'lg' && 'ui-input-wrap--lg', error && 'has-error', disabled && 'is-disabled')}>
        {icon ? <Icon name={icon} size="1rem" class="ui-input-wrap__icon" /> : null}
        <input
          id={inputId}
          class="ui-input"
          type="text"
          value={value}
          placeholder={placeholder}
          maxLength={maxLength ? maxLength * 2 : undefined}
          spellcheck={false}
          autoComplete="off"
          autoFocus={autoFocus}
          disabled={disabled}
          aria-label={label === undefined ? ariaLabel : undefined}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errId : undefined}
          onInput={handle}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onEnter) {
              e.preventDefault();
              onEnter();
            }
          }}
          data-autofocus={autoFocus ? true : undefined}
        />
        {trailing}
      </div>
      {error || counter ? (
        <div class="ui-field__meta">
          {error ? (
            <span class="ui-field__error" id={errId} role="alert">
              <Icon name="warning" size="0.875rem" />
              {error}
            </span>
          ) : null}
          {counter && maxLength ? (
            <span class={cx('ui-field__counter', len >= maxLength && 'is-full')} aria-hidden="true">
              {t('common.counter', { count: len, max: maxLength })}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
