import { Icon } from '../icons';
import { cx } from './cx';

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  labelledBy?: string;
  describedBy?: string;
  id?: string;
  class?: string;
}

/** On/off switch (role="switch"). Space/Enter toggle (native button). */
export function Toggle({ checked, onChange, disabled, ariaLabel, labelledBy, describedBy, id, class: cls }: ToggleProps) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      class={cx('ui-toggle', cls)}
      aria-checked={checked ? 'true' : 'false'}
      aria-label={labelledBy ? undefined : ariaLabel}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span class="ui-toggle__thumb">
        <span class="ui-toggle__glyph">
          <Icon name="check" size="0.625rem" strokeWidth={3} />
        </span>
      </span>
    </button>
  );
}
