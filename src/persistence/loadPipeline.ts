/**
 * bytes -> (gunzip) -> strict UTF-8 -> sanitized JSON -> verified envelope -> migrated payload ->
 * structurally validated WorldState -> semantically repaired WorldState.
 *
 * Every stage is total: any failure becomes a typed result ('corrupt' | 'future_version' |
 * 'invalid'), never an exception, so a damaged file can only ever cause a fallback to the backup.
 */
import type { WorldState } from '../sim/types';
import { utf8DecodeStrict } from './bytes';
import { type VerifiedEnvelope, verifyEnvelope } from './envelope';
import { GzipError, gunzipBytes, isGzip } from './gzip';
import { type Migration, migratePayload } from './migrations';
import { MAX_SAVE_BYTES, SanitizeError, mayContainReservedKeys, parseJsonRaw, stripReservedKeys } from './sanitize';
import type { RepairHook } from './semanticRepair';
import { validateWorld } from './validation';

export type PipelineFailureCode = 'corrupt' | 'future_version' | 'invalid';
export interface PipelineFailure {
  ok: false;
  code: PipelineFailureCode;
  error: string;
}

export interface DecodedSave {
  ok: true;
  envelope: VerifiedEnvelope;
  warnings: string[];
  bytes: number;
  compressed: boolean;
}

export interface PreparedWorld {
  ok: true;
  world: WorldState;
  /** Problems found and survived (validation notes, semantic repair). NOT schema upgrades. */
  warnings: string[];
  /** Migration steps applied, e.g. ['v1->v2 (household jobs)']; empty when the save was already current. */
  migrated: string[];
}

export interface DecodeOptions {
  maxBytes?: number;
  maxSchemaVersion: number;
}

const failure = (code: PipelineFailureCode, error: string): PipelineFailure => ({ ok: false, code, error });

function firstNonSpace(text: string): string {
  for (let i = 0; i < text.length && i < 4096; i++) {
    const c = text[i];
    if (c !== ' ' && c !== '\n' && c !== '\r' && c !== '\t') return c;
  }
  return '';
}

/** Stage 1: bytes to a checksum-verified envelope. */
export async function decodeSave(bytes: Uint8Array, opts: DecodeOptions): Promise<DecodedSave | PipelineFailure> {
  const maxBytes = opts.maxBytes ?? MAX_SAVE_BYTES;
  try {
    if (!(bytes instanceof Uint8Array)) return failure('corrupt', 'save data is not binary');
    if (bytes.byteLength === 0) return failure('corrupt', 'save file is empty');
    if (bytes.byteLength > maxBytes) return failure('invalid', `save file is too large (${bytes.byteLength} bytes, limit ${maxBytes})`);
    let raw: Uint8Array = bytes;
    const compressed = isGzip(bytes);
    if (compressed) {
      try {
        raw = await gunzipBytes(bytes, maxBytes);
      } catch (e) {
        if (e instanceof GzipError && e.code === 'too_large') return failure('invalid', e.message);
        return failure('corrupt', e instanceof Error ? e.message : String(e));
      }
    }
    let text: string;
    try {
      text = utf8DecodeStrict(raw);
    } catch {
      return failure('corrupt', 'save data is damaged (not valid UTF-8 text)');
    }
    if (firstNonSpace(text) !== '{') return failure('corrupt', 'not an Afterlife Lease save (not a JSON object)');
    let parsed: unknown;
    try {
      // RAW parse: the checksums must cover exactly what is stored. Reserved keys are stripped right after
      // verification, before anything copies or merges the data (see sanitize.ts).
      parsed = parseJsonRaw(text, { maxChars: maxBytes });
    } catch (e) {
      if (e instanceof SanitizeError && e.code === 'too_large') return failure('invalid', e.message);
      if (e instanceof SanitizeError && e.code === 'too_deep') return failure('corrupt', `save data is damaged (${e.message})`);
      return failure('corrupt', 'save data is damaged or truncated (invalid JSON)');
    }
    const checked = await verifyEnvelope(parsed, opts.maxSchemaVersion);
    if (!checked.ok) return checked;
    const warnings = [...checked.warnings];
    const dropped = mayContainReservedKeys(text) ? stripReservedKeys(checked.envelope.payload) : 0;
    if (dropped > 0) warnings.push(`${dropped} unsafe key(s) (__proto__/constructor/prototype) were ignored`);
    return { ok: true, envelope: checked.envelope, warnings, bytes: bytes.byteLength, compressed };
  } catch (e) {
    return failure('corrupt', `save could not be decoded: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export interface PrepareOptions {
  migrations: readonly Migration[];
  targetSchemaVersion: number;
  repair: RepairHook | null;
}

/** Stage 2: migrate + validate + repair. Mutates (owns) env.payload. */
export async function prepareWorld(env: VerifiedEnvelope, opts: PrepareOptions): Promise<PreparedWorld | PipelineFailure> {
  try {
    const migrated = migratePayload(env.payload, env.schemaVersion, opts.migrations, opts.targetSchemaVersion);
    if (!migrated.ok) return failure(migrated.code, migrated.error);
    // A schema upgrade is the normal result of a game update, not a problem: it is reported in `migrated` (callers
    // tell the player the save was updated), never in `warnings` (which the game shows as "Save recovered").
    const warnings: string[] = [];
    const validated = validateWorld(migrated.payload);
    if (!validated.ok) return failure('invalid', `save contents are invalid: ${validated.errors.slice(0, 5).join('; ')}`);
    warnings.push(...validated.warnings);
    let world = validated.world;
    if (opts.repair) {
      try {
        const repaired = await opts.repair(world);
        const recheck = validateWorld(repaired.world);
        if (recheck.ok) {
          world = recheck.world;
          warnings.push(...repaired.warnings);
          if (recheck.issues.length > 0) warnings.push(...recheck.warnings);
        } else {
          warnings.push(`semantic repair produced an invalid world and was discarded (${recheck.errors[0] ?? 'unknown'})`);
        }
      } catch (e) {
        warnings.push(`semantic repair failed and was skipped: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { ok: true, world, warnings, migrated: migrated.applied };
  } catch (e) {
    return failure('invalid', `save could not be prepared: ${e instanceof Error ? e.message : String(e)}`);
  }
}
