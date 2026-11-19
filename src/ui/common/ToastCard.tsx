/** Toast card (visual only — the HUD owns the toast stack, timing and positioning). */
import type { ComponentChildren, JSX } from 'preact';
import { t } from '../../i18n';
import { Icon, type IconName } from '../icons';
import { IconButton } from './IconButton';
import { cx } from './cx';

export type ToastKind = 'info' | 'good' | 'bad' | 'warning' | 'money' | 'career' | 'social' | 'decay' | 'romance' | 'skill';

const KIND_ICON: Record<ToastKind, IconName> = {
  info: 'info',
  good: 'sparkle',
  bad: 'skull',
  warning: 'warning',
  money: 'money',
  career: 'career',
  social: 'chat',
  decay: 'limb',
  romance: 'heart',
  skill: 'skills',
};

export function toastIcon(kind: string): IconName {
  return Object.prototype.hasOwnProperty.call(KIND_ICON, kind) ? KIND_ICON[kind as ToastKind] : 'info';
}

export interface ToastCardProps {
  kind: ToastKind | string;
  title: ComponentChildren;
  text?: ComponentChildren;
  icon?: IconName;
  /** e.g. "Mon 9:00 AM" or "2 min ago". */
  time?: string;
  onDismiss?: () => void;
  onClick?: () => void;
  actions?: ComponentChildren;
  /** Remaining lifetime 0..1 (draws a draining bar). */
  remaining?: number;
  compact?: boolean;
  class?: string;
}

export function ToastCard({ kind, title, text, icon, time, onDismiss, onClick, actions, remaining, compact, class: cls }: ToastCardProps) {
  const r = typeof remaining === 'number' && Number.isFinite(remaining) ? Math.min(1, Math.max(0, remaining)) : null;
  const onKey = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };
  return (
    <div
      class={cx('ui-toast', 'ui-interactive', compact && 'ui-toast--compact', cls)}
      data-kind={kind}
      role="status"
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onKey}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <span class="ui-toast__icon" aria-hidden="true">
        <Icon name={icon ?? toastIcon(kind)} size={compact ? '0.9375rem' : '1.125rem'} />
      </span>
      <div class="ui-toast__body">
        <div class="ui-toast__title">{title}</div>
        {text ? <div class="ui-toast__text">{text}</div> : null}
        {time ? <div class="ui-toast__meta">{time}</div> : null}
        {actions ? <div class="ui-toast__actions">{actions}</div> : null}
      </div>
      {onDismiss ? (
        <IconButton
          icon="close"
          size="xs"
          label={t('common.dismiss')}
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
        />
      ) : (
        <span />
      )}
      {r !== null ? <span class="ui-toast__progress" style={{ transform: `scaleX(${r})` }} aria-hidden="true" /> : null}
    </div>
  );
}
