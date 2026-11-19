import type { ComponentChildren, JSX } from 'preact';
import { cx } from './cx';

export interface PanelProps {
  title?: ComponentChildren;
  subtitle?: ComponentChildren;
  /** Right side of the header (icon buttons). */
  actions?: ComponentChildren;
  footer?: ComponentChildren;
  /** Candle-ink corner flourishes. */
  ornate?: boolean;
  solid?: boolean;
  flat?: boolean;
  headerRule?: boolean;
  bodyFlush?: boolean;
  /** Panels are interactive by default (pointer-events: auto). */
  passthrough?: boolean;
  as?: 'section' | 'div' | 'aside' | 'nav';
  class?: string;
  bodyClass?: string;
  style?: JSX.CSSProperties;
  'aria-label'?: string;
  id?: string;
  children?: ComponentChildren;
}

export function Panel({
  title,
  subtitle,
  actions,
  footer,
  ornate,
  solid,
  flat,
  headerRule,
  bodyFlush,
  passthrough,
  as = 'section',
  class: cls,
  bodyClass,
  style,
  id,
  children,
  ...aria
}: PanelProps) {
  const Tag = as;
  const hasHeader = title !== undefined || actions !== undefined;
  return (
    <Tag
      id={id}
      class={cx('ui-panel', !passthrough && 'ui-interactive', ornate && 'ui-panel--ornate', solid && 'ui-panel--solid', flat && 'ui-panel--flat', cls)}
      style={style}
      aria-label={aria['aria-label']}
    >
      {hasHeader ? (
        <header class={cx('ui-panel__header', headerRule && 'ui-panel__header--rule')}>
          <div class="ui-panel__titles">
            {title !== undefined ? <h2 class="ui-panel__title">{title}</h2> : null}
            {subtitle ? <p class="ui-panel__subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div class="ui-panel__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div class={cx('ui-panel__body', bodyFlush && 'ui-panel__body--flush', bodyClass)}>{children}</div>
      {footer ? <footer class="ui-panel__footer">{footer}</footer> : null}
    </Tag>
  );
}
