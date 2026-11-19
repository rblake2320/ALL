/**
 * Living things: ONE rule for pets, plants and anything else a household looks after (docs/contract-requests/
 * living-things.md, owner direction 2026-11-12). Everything that lives gives a small benefit AND asks for upkeep:
 *
 *  - `care` (0..100) is the deterministic average of the thing's needs;
 *  - the benefit is a function of care by TIER: none below 25, half from 25, full from 60;
 *  - neglect never kills: it only withholds the benefit (a pet runs away and comes back, a plant wilts and revives);
 *  - caps and random encounters are DATA rows (a number in a table, not a rule in code), seeded from the world seed and
 *    capped per game day, so the game stays deterministic (D-003), replayable and never spammy. E10+ (D-085).
 *
 * PURE: no sim, no UI, no clock, no ctx.rng. The pets system (src/sim/systems/pets) and the plants system read the same
 * types, so a third kind of living thing is a data change.
 */

// ───────────────────────────────────────────── kinds ─────────────────────────────────────────────

export interface LivingKind {
  kind: string;
  /** The upkeep it asks for: the need ids whose average is the thing's care. */
  needs: readonly string[];
  /** Game days at care 0 before the lapse (gentle, never gore, always recoverable or returned). */
  lapseDays: number;
}

export const LIVING_KINDS: Readonly<Record<'pet' | 'plant', LivingKind>> = Object.freeze({
  pet: { kind: 'pet', needs: ['appetite', 'fun', 'hygiene', 'affection'], lapseDays: 1 },
  plant: { kind: 'plant', needs: ['water', 'tending'], lapseDays: 3 },
});

// ───────────────────────────────────────────── care and its tiers ─────────────────────────────────────────────

export const CARE_TIER_AT = Object.freeze({ half: 25, full: 60 });
export type CareTier = 'none' | 'half' | 'full';

/** Average of the named needs, each clamped to 0..100; a missing or broken need counts as 0 (fail closed). */
export function careOf(needs: Readonly<Record<string, unknown>> | null | undefined, ids: readonly string[]): number {
  if (!needs || ids.length === 0) return 0;
  let sum = 0;
  for (const id of ids) {
    const v = needs[id];
    sum += typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
  }
  return sum / ids.length;
}

export function careTier(care: number): CareTier {
  if (!(typeof care === 'number' && Number.isFinite(care))) return 'none';
  return care >= CARE_TIER_AT.full ? 'full' : care >= CARE_TIER_AT.half ? 'half' : 'none';
}

export const TIER_WEIGHT: Readonly<Record<CareTier, number>> = Object.freeze({ none: 0, half: 0.5, full: 1 });

// ───────────────────────────────────────────── caps ─────────────────────────────────────────────

export interface CapTable {
  /** Most living things of this kind a household holds. */
  household: number;
  /** Most of one species. */
  perSpecies: number;
}

/** Pets: 3 in all, at most 2 of one species (S14 decisions). Raised later by housing tiers, never to twenty. */
export const PET_CAPS: CapTable = Object.freeze({ household: 3, perSpecies: 2 });

/**
 * Why a NEW adoption is refused, or null. The cap applies to new adoptions only: a save that already holds more keeps them,
 * and simply cannot adopt another until it is under the cap.
 */
export function adoptionRefusal(caps: CapTable, existing: readonly { species: string }[], species: string): string | null {
  if (existing.length >= caps.household) return `The household already has as many pets as it can look after (${caps.household}).`;
  if (existing.filter((p) => p.species === species).length >= caps.perSpecies) return `The household already has ${caps.perSpecies} ${species}s: that is as many of one kind as it can look after.`;
  return null;
}

// ───────────────────────────────────────────── seeded rolls ─────────────────────────────────────────────

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

/** A number in [0, 1) that depends only on the world seed and the keys (no Math.random, no Date): same seed, same answer. */
export function seededUnit(seed: number, ...keys: (string | number)[]): number {
  let h = (fnv1a(keys.join('|')) ^ Math.imul(seed >>> 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ───────────────────────────────────────────── encounter rows ─────────────────────────────────────────────

/**
 * One row of an encounter table: who may do what, how likely, and how often. A new row is a data change, not new code.
 */
export interface EncounterRow {
  id: string;
  /** Which living thing acts. */
  actorKind: string;
  /** Species allowed to act (empty = any). */
  actorSpecies: readonly string[];
  /** What it meets (stray species, critter species; empty = nothing needed, e.g. a windfall). */
  others: readonly string[];
  /** Probability 0..1 per sighting (or per day for rows with no `others`). */
  chance: number;
  /** Most times per game day. Rows of one `group` share this cap (the lowest value counts). */
  maxPerDay: number;
  group: string;
  /** The actor's care must be at least this (0..100): a neglected thing does nothing. */
  minCare: number;
}

/** Problems in an encounter table (empty = sound). An uncapped, certain or unseeded row is a problem, so a bad table fails. */
export function validateEncounterTable(rows: readonly EncounterRow[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const capOfGroup = new Map<string, number>();
  for (const r of rows) {
    if (ids.has(r.id)) problems.push(`${r.id}: duplicate id`);
    ids.add(r.id);
    if (!(typeof r.chance === 'number' && r.chance > 0 && r.chance < 1)) problems.push(`${r.id}: chance must be between 0 and 1, not certain`);
    if (!(Number.isInteger(r.maxPerDay) && r.maxPerDay >= 1 && r.maxPerDay <= 10)) problems.push(`${r.id}: maxPerDay must be a whole number from 1 to 10 (uncapped rows are refused)`);
    if (!(typeof r.minCare === 'number' && r.minCare >= 0 && r.minCare <= 100)) problems.push(`${r.id}: minCare must be 0..100`);
    if (!r.group) problems.push(`${r.id}: needs a cap group`);
    const prev = capOfGroup.get(r.group);
    if (prev !== undefined && prev !== r.maxPerDay) problems.push(`${r.id}: rows of group ${r.group} must share one maxPerDay`);
    capOfGroup.set(r.group, r.maxPerDay);
  }
  return problems;
}

/** Does this roll succeed? Pure: same (seed, row, keys) always gives the same answer. */
export function rollEncounter(seed: number, row: Pick<EncounterRow, 'id' | 'chance'>, ...keys: (string | number)[]): boolean {
  return seededUnit(seed, row.id, ...keys) < row.chance;
}

/** Per-day counters of one living thing: which game day they are for, and how many times each group has fired. */
export interface EncounterCounters {
  day: number;
  n: Readonly<Record<string, number>>;
}

export const freshCounters = (day: number): EncounterCounters => ({ day, n: {} });

/** The counters for `day` (a new day starts from zero). */
export function countersFor(c: EncounterCounters | undefined | null, day: number): EncounterCounters {
  return c && c.day === day ? c : freshCounters(day);
}

export const canFire = (c: EncounterCounters, row: Pick<EncounterRow, 'group' | 'maxPerDay'>): boolean => (c.n[row.group] ?? 0) < row.maxPerDay;
export const recordFire = (c: EncounterCounters, row: Pick<EncounterRow, 'group'>): EncounterCounters => ({ day: c.day, n: { ...c.n, [row.group]: (c.n[row.group] ?? 0) + 1 } });
