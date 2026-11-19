import type { JSX } from 'preact';
import { cx } from './cx';

export interface ProgressBarProps {
  /** 0..1, or null for indeterminate. */
  value: number | null;
  tone?: 'toxic' | 'candle' | 'cryo' | 'bone';
  size?: 'sm' | 'md' | 'lg';
  stitched?: boolean;
  /** Disable the moving shimmer. */
  still?: boolean;
  /** Accessible name. */
  label?: string;
  valueText?: string;
  class?: string;
}

export function ProgressBar({ value, tone = 'toxic', size = 'md', stitched, still, label, valueText, class: cls }: ProgressBarProps) {
  const indeterminate = value === null || value === undefined || !Number.isFinite(value);
  const pct = indeterminate ? 0 : Math.round(Math.min(1, Math.max(0, value as number)) * 1000) / 10;
  return (
    <div
      class={cx(
        'ui-progress',
        tone !== 'toxic' && `ui-progress--${tone}`,
        size !== 'md' && `ui-progress--${size}`,
        stitched && 'ui-progress--stitched',
        still && 'ui-progress--still',
        indeterminate && 'ui-progress--indeterminate',
        cls,
      )}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
      aria-valuetext={valueText}
      style={{ '--pct': String(pct) } as JSX.CSSProperties}
    >
      <div class="ui-progress__fill" />
    </div>
  );
}
