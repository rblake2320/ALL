import type { ComponentChildren } from 'preact';
import { Icon, type IconName } from '../icons';
import { cx } from './cx';

export function EmptyState({
  icon = 'tombstone',
  title,
  text,
  action,
  class: cls,
}: {
  icon?: IconName;
  title: ComponentChildren;
  text?: ComponentChildren;
  action?: ComponentChildren;
  class?: string;
}) {
  return (
    <div class={cx('ui-empty', cls)}>
      <div class="ui-empty__icon" aria-hidden="true">
        <Icon name={icon} size="1.625rem" />
      </div>
      <div class="ui-empty__title">{title}</div>
      {text ? <p class="ui-empty__text">{text}</p> : null}
      {action ? <div class="ui-empty__action">{action}</div> : null}
    </div>
  );
}
