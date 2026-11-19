import type { ComponentChildren } from 'preact';
import { Icon, type IconName } from '../icons';
import { cx } from './cx';

export type BadgeTone = 'neutral' | 'accent' | 'warm' | 'danger' | 'info';

export interface BadgeProps {
  tone?: BadgeTone;
  solid?: boolean;
  caps?: boolean;
  /** Numeric counter badge (99+ cap). */
  count?: number;
  /** Just a dot. */
  dot?: boolean;
  icon?: IconName;
  /** Accessible label (required for dot/count badges that convey meaning). */
  label?: string;
  class?: string;
  children?: ComponentChildren;
}

export function Badge({ tone = 'neutral', solid, caps, count, dot, icon, label, class: cls, children }: BadgeProps) {
  const toneCls = tone === 'neutral' ? null : `ui-badge--${tone}`;
  if (dot) {
    return <span class={cx('ui-badge', 'ui-badge--dot', 'ui-badge--solid', toneCls, cls)} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'} />;
  }
  const isCount = typeof count === 'number';
  const text = isCount ? (Number.isFinite(count) ? (count > 99 ? '99+' : String(Math.max(0, Math.floor(count)))) : '!') : null;
  return (
    <span
      class={cx('ui-badge', toneCls, (solid || isCount) && 'ui-badge--solid', isCount && 'ui-badge--count', caps && 'ui-badge--caps', cls)}
      aria-label={label}
    >
      {icon ? <Icon name={icon} size="0.875rem" /> : null}
      {text ?? children}
    </span>
  );
}
