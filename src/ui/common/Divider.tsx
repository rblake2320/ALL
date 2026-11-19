import { cx } from './cx';

/** Ornamental flourish used by dividers and screen titles (original: candle-diamond with tendrils). */
export function Ornament({ width = 46, class: cls }: { width?: number; class?: string }) {
  return (
    <svg class={cx('ui-divider__ornament', cls)} width={width} height={(width * 12) / 46} viewBox="0 0 46 12" fill="none" aria-hidden="true">
      <path d="M1 6h12.5c2.2 0 3.4-2.6 5.6-2.6 1.4 0 2.2 1 2.9 2.6" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity=".7" />
      <path d="M45 6H32.5c-2.2 0-3.4 2.6-5.6 2.6-1.4 0-2.2-1-2.9-2.6" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity=".7" />
      <path d="M23 1.6l3.1 4.4L23 10.4 19.9 6z" fill="currentColor" opacity=".9" />
      <circle cx="23" cy="6" r="1.05" fill="#1d1726" />
    </svg>
  );
}

export interface DividerProps {
  variant?: 'line' | 'ornament' | 'label';
  label?: string;
  class?: string;
}

export function Divider({ variant = 'line', label, class: cls }: DividerProps) {
  if (variant === 'line') return <hr class={cx('ui-divider', cls)} />;
  if (variant === 'label') {
    return (
      <div class={cx('ui-divider', 'ui-divider--label', cls)} role="separator">
        <span class="ui-divider__text">{label}</span>
      </div>
    );
  }
  return (
    <div class={cx('ui-divider', 'ui-divider--ornament', cls)} role="separator">
      <Ornament />
    </div>
  );
}
