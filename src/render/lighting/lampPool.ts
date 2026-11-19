/**
 * Lamp light pool selection (pure; unit-tested). Only `max` PointLights exist; they are given to the lit lamps
 * nearest the camera target (weighted by a per-candidate bias so lot lamps beat street lamps). Every other lit
 * lamp stays emissive-only. O(n·k) partial selection, allocation free.
 */

export interface LampCandidate {
  x: number;
  y: number;
  z: number;
  /** Added to the distance when ranking (street lamps get a penalty). */
  bias: number;
}

/**
 * Writes the indices of the chosen candidates into `out` (nearest first) and returns how many were chosen.
 * Candidates with non-finite coordinates are skipped.
 */
export function selectLamps(
  candidates: readonly LampCandidate[],
  count: number,
  targetX: number,
  targetZ: number,
  max: number,
  out: Int32Array,
  scratch: Float64Array,
): number {
  const n = Math.max(0, Math.min(count, candidates.length));
  const k = Math.max(0, Math.min(Math.floor(Number.isFinite(max) ? max : 0), out.length, scratch.length));
  if (k === 0 || n === 0) return 0;
  const tx = Number.isFinite(targetX) ? targetX : 0;
  const tz = Number.isFinite(targetZ) ? targetZ : 0;
  let chosen = 0;
  for (let i = 0; i < n; i++) {
    const c = candidates[i];
    if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.z)) continue;
    const bias = Number.isFinite(c.bias) ? c.bias : 0;
    const d = Math.hypot(c.x - tx, c.z - tz) + bias;
    if (chosen < k) {
      // insertion sort into the chosen list
      let j = chosen++;
      while (j > 0 && scratch[j - 1] > d) {
        scratch[j] = scratch[j - 1];
        out[j] = out[j - 1];
        j--;
      }
      scratch[j] = d;
      out[j] = i;
    } else if (d < scratch[k - 1]) {
      let j = k - 1;
      while (j > 0 && scratch[j - 1] > d) {
        scratch[j] = scratch[j - 1];
        out[j] = out[j - 1];
        j--;
      }
      scratch[j] = d;
      out[j] = i;
    }
  }
  return chosen;
}
