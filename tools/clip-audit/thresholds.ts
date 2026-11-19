/**
 * CLIP-AUDIT thresholds (tunable; documented in docs/audits/clipping-W073.md §Method).
 *
 * Penetration is the depth of the deepest point of one surface inside the other solid (both directions are
 * measured, so a thin board through a limb is caught by the board's samples inside the limb even when no body
 * vertex lies inside the 5 mm board). Gaps are the smallest distance between the two surfaces of a support contact
 * (negative = they interpenetrate there).
 */
export const THRESHOLDS = {
  /** Penetration deeper than this on a visible surface = FAIL (mm). */
  penFailMm: 15,
  /** Penetration between warn and fail = WARN (mm). Below = cushion squish / skin contact, accepted. */
  penWarnMm: 5,
  /** A support contact (pelvis-seat, body-bed, feet-floor, back-backrest) with a gap above this = FLOAT FAIL (mm). */
  floatFailMm: 30,
  /** Hand to held item gap above this = FAIL (mm). */
  handItemFailMm: 25,
  /** Hand to the work surface (counter, sink, stove, desk) farther than this at every sampled time = WARN (mm). */
  workGapWarnMm: 60,
  /** Ignore isolated inside points: a part counts as penetrating only with at least this many inside samples. */
  minInsideSamples: 3,
  /** Winding number above which a point is inside a solid. */
  insideWinding: 0.5,
  /** Object surface sample spacing for the object-in-body direction (m). */
  sampleSpacing: 0.015,
} as const;

export type Verdict = 'PASS' | 'WARN' | 'FAIL';

export function penVerdict(mm: number): Verdict {
  if (!(mm > THRESHOLDS.penWarnMm)) return 'PASS';
  return mm > THRESHOLDS.penFailMm ? 'FAIL' : 'WARN';
}

export function floatVerdict(gapMm: number, failMm: number = THRESHOLDS.floatFailMm): Verdict {
  return gapMm > failMm ? 'FAIL' : 'PASS';
}

export function worst(...v: Verdict[]): Verdict {
  return v.includes('FAIL') ? 'FAIL' : v.includes('WARN') ? 'WARN' : 'PASS';
}
