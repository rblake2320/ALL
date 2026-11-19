/** Slider value math: snapping (float-safe), percent mapping and keyboard stepping. */

function decimalsOf(step: number): number {
  if (!Number.isFinite(step)) return 0;
  const s = String(step);
  const e = s.indexOf('e-');
  if (e >= 0) return Number(s.slice(e + 2)) || 0;
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** Normalise min/max so min <= max, both finite. */
export function normRange(min: number, max: number): [number, number] {
  const lo = Number.isFinite(min) ? min : 0;
  const hi = Number.isFinite(max) ? max : lo + 1;
  return lo <= hi ? [lo, hi] : [hi, lo];
}

/** Clamp to [min,max] and snap to the step grid anchored at min. Non-finite value → min. */
export function snapToStep(value: number, min: number, max: number, step: number): number {
  const [lo, hi] = normRange(min, max);
  let v = Number.isFinite(value) ? value : lo;
  v = Math.min(hi, Math.max(lo, v));
  if (Number.isFinite(step) && step > 0) {
    const n = Math.round((v - lo) / step);
    v = lo + n * step;
    const d = Math.min(10, Math.max(decimalsOf(step), decimalsOf(lo)));
    v = Number(v.toFixed(d));
    if (v > hi) v = Number((v - step).toFixed(d));
    if (v < lo) v = lo;
  }
  return v;
}

/** Value → 0..100 position. Degenerate ranges map to 0. */
export function valueToPercent(value: number, min: number, max: number): number {
  const [lo, hi] = normRange(min, max);
  if (hi - lo <= 0) return 0;
  const v = Number.isFinite(value) ? value : lo;
  return Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));
}

/** 0..100 → snapped value. */
export function percentToValue(pct: number, min: number, max: number, step: number): number {
  const [lo, hi] = normRange(min, max);
  const p = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
  return snapToStep(lo + ((hi - lo) * p) / 100, lo, hi, step);
}

/** Keyboard handling for role="slider": returns the new value or null when the key isn't a slider key. */
export function keyboardStep(key: string, value: number, min: number, max: number, step: number, pageSteps = 10): number | null {
  const [lo, hi] = normRange(min, max);
  const s = Number.isFinite(step) && step > 0 ? step : (hi - lo) / 100 || 1;
  const v = Number.isFinite(value) ? value : lo;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return snapToStep(v + s, lo, hi, step);
    case 'ArrowLeft':
    case 'ArrowDown':
      return snapToStep(v - s, lo, hi, step);
    case 'PageUp':
      return snapToStep(v + s * pageSteps, lo, hi, step);
    case 'PageDown':
      return snapToStep(v - s * pageSteps, lo, hi, step);
    case 'Home':
      return lo;
    case 'End':
      return snapToStep(hi, lo, hi, step);
    default:
      return null;
  }
}
