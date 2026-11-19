/**
 * Save-schema migration registry. Each step upgrades a raw payload from `from` to `to` (to > from).
 * Loading chains steps until the payload reaches the target SAVE_SCHEMA_VERSION; the upgraded world
 * is stamped with the new schemaVersion, so re-saving stores it migrated and a later load applies no
 * step twice (idempotent). Payloads newer than the target are refused ('future_version') — an old
 * build must never "downgrade" (and thereby destroy) a newer save.
 *
 * Adding a migration when SAVE_SCHEMA_VERSION goes from N to N+1:
 *   MIGRATIONS.push({ from: N, to: N + 1, describe: '...', migrate(p) { ...mutate or return new p... } })
 * Migrations receive JSON data that has passed checksum verification but NOT world validation, so
 * they must be defensive (fields may be missing in hand-edited or very old files). They must also be
 * PURE functions of the payload: the SaveManager may dry-run the chain on a throwaway copy (e.g. to
 * check that an old primary is still loadable before rotating it into the backup).
 */
import { SAVE_SCHEMA_VERSION } from '../sim/types';
import { legacyTown } from '../shared/town';
import { isPlainObject } from './sanitize';
import { PET_LIMITS } from './validation/petsSchema';

export type RawPayload = Record<string, unknown>;

export interface Migration {
  from: number;
  to: number;
  describe?: string;
  /**
   * Lossless, invisible upgrade (nothing the player would notice or need to act on): it is listed in
   * `MigrationOutcome.applied` but NOT announced as a load warning (the game toasts load warnings as "Save recovered").
   */
  silent?: boolean;
  /** Mutate `payload` in place (return void) or return a replacement object. */
  migrate(payload: RawPayload): RawPayload | void;
}

/** Published batch v1 → v2: assignments did not exist in v1, so never import a foreign v1 job list. */
export const MIGRATION_V1_V2: Migration = {
  from: 1,
  to: 2,
  describe: 'household jobs',
  migrate(p) {
    p.jobs = { version: 1, nextId: 1, list: [] };
  },
};

/** Combined v3 accepts the published jobs-v2 and internal world-v2 through ONE step. Existing blocks are preserved
 * for normal structural/semantic validation; migration never overwrites valid town edits or job progress. Missing
 * town starts frozen at the legacy home until the journaled townExpand command. This step is idempotent. */
export const MIGRATION_V2_V3: Migration = {
  from: 2,
  to: 3,
  describe: 'walkable world: home lot at Mildew Lane slot n2',
  silent: true,
  migrate(p) {
    if (p.jobs === undefined) p.jobs = { version: 1, nextId: 1, list: [] };
    if (p.town === undefined) p.town = legacyTown(p.seed, p.tick);
    // Published pets-v2 predates cosmetic looks. This is a versioned default, not a corrupt-save repair.
    // Preserve explicit looks (including invalid values for validation) and leave malformed/oversize lists alone.
    if (isPlainObject(p.pets) && Array.isArray(p.pets.pets) && p.pets.pets.length <= PET_LIMITS.maxList) {
      for (const pet of p.pets.pets) if (isPlainObject(pet) && pet.variant === undefined) pet.variant = 'normal';
    }
  },
};

export const MIGRATIONS: readonly Migration[] = [MIGRATION_V1_V2, MIGRATION_V2_V3];

export type MigrationOutcome =
  /** applied: every step that ran; announced: the non-silent ones (load warnings). */
  | { ok: true; payload: RawPayload; applied: string[]; announced: string[] }
  | { ok: false; code: 'future_version' | 'invalid'; error: string };

/** Structural problems with a registry (duplicate sources, non-increasing steps, bad numbers). */
export function validateMigrationRegistry(registry: readonly Migration[]): string[] {
  const errors: string[] = [];
  const seen = new Set<number>();
  for (const m of registry) {
    if (!Number.isInteger(m.from) || !Number.isInteger(m.to) || m.from < 1) errors.push(`migration ${m.from}->${m.to}: versions must be positive integers`);
    else if (m.to <= m.from) errors.push(`migration ${m.from}->${m.to}: target must be greater than source`);
    if (seen.has(m.from)) errors.push(`migration from v${m.from} registered twice`);
    seen.add(m.from);
    if (typeof m.migrate !== 'function') errors.push(`migration ${m.from}->${m.to}: migrate is not a function`);
  }
  return errors;
}

export function migratePayload(
  payload: RawPayload,
  fromVersion: number,
  registry: readonly Migration[] = MIGRATIONS,
  target: number = SAVE_SCHEMA_VERSION,
): MigrationOutcome {
  if (!Number.isInteger(fromVersion) || fromVersion < 1) return { ok: false, code: 'invalid', error: `invalid schema version ${String(fromVersion)}` };
  if (fromVersion > target) {
    return { ok: false, code: 'future_version', error: `save uses schema v${fromVersion}, this build supports up to v${target} — update the game to load it` };
  }
  const registryErrors = validateMigrationRegistry(registry);
  if (registryErrors.length > 0) return { ok: false, code: 'invalid', error: `migration registry is broken: ${registryErrors.join('; ')}` };
  const byFrom = new Map(registry.map((m) => [m.from, m] as const));
  let current = fromVersion;
  let p = payload;
  const applied: string[] = [];
  const announced: string[] = [];
  while (current < target) {
    const step = byFrom.get(current);
    if (!step) return { ok: false, code: 'invalid', error: `no migration path from schema v${current} to v${target}` };
    if (step.to > target) return { ok: false, code: 'invalid', error: `migration v${step.from}->v${step.to} overshoots target v${target}` };
    let out: RawPayload | void;
    try {
      out = step.migrate(p);
    } catch (e) {
      return { ok: false, code: 'invalid', error: `migration v${step.from}->v${step.to} failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (out !== undefined) {
      if (!isPlainObject(out)) return { ok: false, code: 'invalid', error: `migration v${step.from}->v${step.to} returned a non-object` };
      p = out;
    }
    p.schemaVersion = step.to;
    const note = `v${step.from}->v${step.to}${step.describe ? ` (${step.describe})` : ''}`;
    applied.push(note);
    if (!step.silent) announced.push(note);
    current = step.to;
  }
  return { ok: true, payload: p, applied, announced };
}
