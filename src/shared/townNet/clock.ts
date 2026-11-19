/**
 * The shared town's day and night (docs/CORE_CONCEPT.md fixed rule 2: one clock for everyone standing in the town).
 *
 * PURE: a function of real time only, so every server and every restart agree, and nothing has to be stored.
 *
 * This clock is for what the town LOOKS like. Schedules that players plan their week around (the home attack windows
 * of src/shared/homeDefense.ts) count real hours, not these faster town days.
 */

/** Real minutes one town day lasts. A starting value, to be tuned. */
export const TOWN_DAY_REAL_MINUTES = 120;

export interface TownClock {
  /** Town day number since 1 January 2026 UTC (0-based). */
  day: number;
  /** Whole minutes since the start of the town day, 0..1439. */
  minute: number;
}

const EPOCH_MS = Date.UTC(2026, 0, 1);

/** The town clock at a real time (milliseconds since 1970). Times before the epoch, or broken values, read as day 0, 00:00. */
export function townClockAt(epochMs: number): TownClock {
  if (!Number.isFinite(epochMs) || epochMs < EPOCH_MS) return { day: 0, minute: 0 };
  const dayMs = TOWN_DAY_REAL_MINUTES * 60_000;
  const since = epochMs - EPOCH_MS;
  const day = Math.floor(since / dayMs);
  const minute = Math.min(1439, Math.floor(((since - day * dayMs) / dayMs) * 1440));
  return { day, minute };
}
