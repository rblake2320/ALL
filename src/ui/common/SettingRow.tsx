import type { ComponentChildren } from 'preact';
import { cx } from './cx';

/**
 * Label + description on the left, control on the right. Wire the control with
 * `aria-labelledby={`${id}-label`}` and `aria-describedby={`${id}-desc`}` (see settingIds()).
 * `onLabelClick` lets toggle rows flip when the text is clicked.
 */
export function SettingRow({
  id,
  label,
  description,
  children,
  stack,
  wide,
  onLabelClick,
  class: cls,
}: {
  id: string;
  label: ComponentChildren;
  description?: ComponentChildren;
  children: ComponentChildren;
  stack?: boolean;
  wide?: boolean;
  onLabelClick?: () => void;
  class?: string;
}) {
  return (
    <div class={cx('ui-setting', stack && 'ui-setting--stack', cls)}>
      <div class="ui-setting__text" onClick={onLabelClick} style={onLabelClick ? { cursor: 'pointer' } : undefined}>
        <div class="ui-setting__label" id={`${id}-label`}>
          {label}
        </div>
        {description ? (
          <div class="ui-setting__desc" id={`${id}-desc`}>
            {description}
          </div>
        ) : null}
      </div>
      <div class={cx('ui-setting__control', wide && 'ui-setting__control--wide')}>{children}</div>
    </div>
  );
}

export const settingIds = (id: string, hasDesc = true) => ({
  labelledBy: `${id}-label`,
  describedBy: hasDesc ? `${id}-desc` : undefined,
});
