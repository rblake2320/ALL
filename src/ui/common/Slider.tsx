/**
 * Slider (role="slider"): pointer drag with capture, keyboard (arrows, PgUp/PgDn, Home/End), value label,
 * optional end labels and ticks. `onChange` fires continuously; `onCommit` on release / key up.
 */
import type { ComponentChildren, JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { keyboardStep, percentToValue, snapToStep, valueToPercent } from './sliderMath';
import { cx } from './cx';
import { useUid } from './uid';

export interface SliderProps {
  label?: ComponentChildren;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  /** Value → display text (also used as aria-valuetext). */
  format?: (v: number) => string;
  minLabel?: ComponentChildren;
  maxLabel?: ComponentChildren;
  ticks?: number[];
  disabled?: boolean;
  /** Accessible name when no visible label. */
  ariaLabel?: string;
  showValue?: boolean;
  class?: string;
  id?: string;
}

export function Slider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  onCommit,
  format,
  minLabel,
  maxLabel,
  ticks,
  disabled,
  ariaLabel,
  showValue = true,
  class: cls,
  id,
}: SliderProps) {
  const autoId = useUid();
  const baseId = id ?? autoId;
  const railRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const v = snapToStep(value, min, max, step);
  const pct = valueToPercent(v, min, max);
  const text = format ? format(v) : String(v);
  // Latest value we emitted. Controller re-renders are coalesced per frame, so rapid key presses must step from
  // this, not from the (possibly stale) prop; a new prop value from outside wins.
  const lastRef = useRef(v);
  const propRef = useRef(v);
  if (propRef.current !== v) {
    propRef.current = v;
    lastRef.current = v;
  }

  const fromPointer = (clientX: number) => {
    const rail = railRef.current;
    if (!rail) return v;
    const r = rail.getBoundingClientRect();
    const p = r.width > 0 ? ((clientX - r.left) / r.width) * 100 : 0;
    return percentToValue(p, min, max, step);
  };

  const emit = (next: number) => {
    if (next !== lastRef.current) {
      lastRef.current = next;
      onChange(next);
    }
  };

  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).focus();
    try {
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
    setDragging(true);
    emit(fromPointer(e.clientX));
  };
  const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    emit(fromPointer(e.clientX));
  };
  const endDrag = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    onCommit?.(lastRef.current);
  };
  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const next = keyboardStep(e.key, lastRef.current, min, max, step);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    emit(next);
  };
  const onKeyUp = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) onCommit?.(lastRef.current);
  };

  const labelId = `${baseId}-label`;
  return (
    <div class={cx('ui-slider', dragging && 'is-dragging', disabled && 'is-disabled', cls)} style={{ '--pct': String(pct) } as JSX.CSSProperties}>
      {label !== undefined || showValue ? (
        <div class="ui-slider__head">
          {label !== undefined ? (
            <span class="ui-slider__label" id={labelId}>
              {label}
            </span>
          ) : (
            <span />
          )}
          {showValue ? (
            <span class="ui-slider__value" aria-hidden="true">
              {text}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        class="ui-slider__control"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-valuemin={Math.min(min, max)}
        aria-valuemax={Math.max(min, max)}
        aria-valuenow={v}
        aria-valuetext={text}
        aria-disabled={disabled ? 'true' : undefined}
        aria-labelledby={label !== undefined ? labelId : undefined}
        aria-label={label === undefined ? ariaLabel : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
      >
        <div class="ui-slider__rail" ref={railRef}>
          <div class="ui-slider__track" />
          <div class="ui-slider__fill" />
          {ticks?.map((tk) => (
            <span key={tk} class="ui-slider__tick" style={{ left: `${valueToPercent(tk, min, max)}%` }} />
          ))}
          <div class="ui-slider__thumb" />
        </div>
      </div>
      {minLabel !== undefined || maxLabel !== undefined ? (
        <div class="ui-slider__ends" aria-hidden="true">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      ) : null}
    </div>
  );
}
