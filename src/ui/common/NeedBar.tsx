/**
 * Need bar: 0..100 value on a candle-orange → teal ramp, optional cap (vitality) with hatched unavailable zone,
 * trend chevrons (1–3 by magnitude), critical pulse, and colour-blind mode (pattern + glyph; global via
 * html.cb-needs or forced with `colorblind`).
 */
import type { JSX } from 'preact';
import { t } from '../../i18n';
import { Icon, type IconName } from '../icons';
import { needBand, needColor } from './color';
import { clamp, trendLabel, trendMagnitude } from './format';
import { cx } from './cx';

export interface NeedBarProps {
  value: number;
  /** Maximum reachable value (preservation ≤ vitality). Default 100. */
  cap?: number;
  /** Net change per game hour. */
  trend?: number;
  label?: string;
  icon?: IconName;
  critical?: boolean;
  /** Show the numeric value next to the label. */
  showValue?: boolean;
  compact?: boolean;
  layout?: 'stack' | 'row';
  /** Force colour-blind patterns regardless of the global setting (previews). */
  colorblind?: boolean;
  class?: string;
}

export function NeedBar({ value, cap = 100, trend = 0, label, icon, critical, showValue, compact, layout = 'stack', colorblind, class: cls }: NeedBarProps) {
  const v = clamp(value, 0, 100);
  const c = clamp(cap, 0, 100);
  const mag = trendMagnitude(trend);
  const band = needBand(v);
  const isCritical = critical ?? v <= 15;
  const color = needColor(v);
  const trendText = trendLabel(mag);
  const arrows = Math.abs(mag);
  const glyph: IconName = band === 'low' ? 'warning' : band === 'mid' ? 'minus' : 'check';
  const aria = t('need.aria', { label: label ?? '', value: Math.round(v), trend: trendText }) + (c < 100 ? ' ' + t('need.capped', { cap: Math.round(c) }) : '');

  return (
    <div
      class={cx('ui-need', compact && 'ui-need--compact', layout === 'row' && 'ui-need--row', isCritical && 'is-critical', colorblind && 'ui-need--cb', cls)}
      style={{ '--pct': String(v), '--cap': String(c), '--need-color': color } as JSX.CSSProperties}
      role="meter"
      aria-label={aria}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v)}
    >
      {icon ? (
        <span class="ui-need__icon" aria-hidden="true">
          <Icon name={icon} size={compact ? '0.875rem' : '1rem'} />
        </span>
      ) : null}
      {label || showValue || arrows > 0 ? (
        <div class="ui-need__head" aria-hidden="true">
          {label ? <span class="ui-need__label">{label}</span> : <span class="u-grow" />}
          <span class="ui-need__glyph">
            <Icon name={glyph} size="0.75rem" strokeWidth={2.25} />
          </span>
          {showValue ? <span class="ui-need__value">{Math.round(v)}</span> : null}
          {arrows > 0 ? (
            <span class="ui-need__trend" data-dir={mag > 0 ? 'up' : 'down'} title={trendText}>
              {Array.from({ length: arrows }, (_, i) => (
                <Icon key={i} name={mag > 0 ? 'trendUp' : 'trendDown'} size="0.875rem" strokeWidth={2.4} />
              ))}
            </span>
          ) : null}
        </div>
      ) : null}
      <div class="ui-need__track" aria-hidden="true">
        <div class="ui-need__fill" data-band={band} />
        {c < 100 ? (
          <>
            <div class="ui-need__cap" />
            <div class="ui-need__capmark" />
          </>
        ) : null}
      </div>
    </div>
  );
}
