/**
 * ProfileStore — per-install data that is NOT part of a world save (settings, tutorial progress,
 * achievements). Stored under 'profile:<key>' with a rotated 'profile:<key>:bak', each record
 * checksummed; writes per key are serialized and coalesced (dragging a volume slider produces at
 * most one queued write).
 *
 * load(key, fallback) NEVER throws and always returns something shaped like `fallback`:
 *  - damaged primary -> backup -> fallback;
 *  - when fallback is a plain object, the stored value is merged OVER it recursively: keys missing
 *    from the stored data (a setting added in a newer version) come from fallback, values whose
 *    type differs from fallback's (tampered / corrupted) are replaced by fallback's, unknown keys
 *    are kept. Arrays and scalars are taken whole when their kind matches.
 *
 * save(): reserved keys ('__proto__', 'constructor', 'prototype') are left out (the loader would drop
 * them, so a checksum over them would make the whole record unreadable — every setting silently reset);
 * the record is decoded again BEFORE it is written (self-check), so what is stored is always loadable.
 * Records are verified over the raw parse and stripped afterwards (see sanitize.ts).
 */
import type { ProfileStore, StorageBackend } from './contracts';
import { type ActivityTracker, persistenceActivity } from './activity';
import { utf8DecodeStrict, utf8Encode } from './bytes';
import { canonicalJson } from './canonicalJson';
import { errorMessage } from './errors';
import { SlotQueue } from './locks';
import { MAX_JSON_DEPTH, RESERVED_KEYS, isPlainObject, mayContainReservedKeys, parseJsonRaw, stripReservedKeys } from './sanitize';
import { SHA256_HEX_RE, sha256Hex } from './sha256';
import { profileKeys } from './slotKeys';

export const PROFILE_FORMAT = 'afterlife-lease-profile';
const MAX_PROFILE_BYTES = 4 * 1024 * 1024;

type Kind = 'null' | 'array' | 'object' | 'string' | 'number' | 'boolean' | 'other';
function kindOf(v: unknown): Kind {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (isPlainObject(v)) return 'object';
  const t = typeof v;
  return t === 'string' || t === 'number' || t === 'boolean' ? t : 'other';
}

/** Merge stored data over the fallback's shape (see module doc). Exported for tests. */
export function reconcile<T>(fallback: T, stored: unknown, depth = 0): T {
  if (fallback === undefined) return stored as T;
  const fk = kindOf(fallback);
  if (fk === 'null') return stored as T; // no shape information
  const sk = kindOf(stored);
  if (fk !== sk) return fallback;
  if (fk !== 'object' || depth > 16) return stored as T;
  const f = fallback as Record<string, unknown>;
  const s = stored as Record<string, unknown>;
  const out: Record<string, unknown> = { ...f };
  for (const k of Object.keys(s)) {
    out[k] = Object.prototype.hasOwnProperty.call(f, k) ? reconcile(f[k], s[k], depth + 1) : s[k];
  }
  return out as T;
}

interface WriteReq {
  key: string;
  text: string;
}

export interface ProfileStoreOptions {
  logger?: { warn(...a: unknown[]): void };
  now?: () => number;
  /** Counts in-flight writes for the desktop quit flush (default: the shared persistenceActivity). */
  activity?: ActivityTracker;
}

/** The record wraps the value one level deep; keep the value within the decoder's depth cap. */
const MAX_VALUE_DEPTH = MAX_JSON_DEPTH - 2;

export class ProfileStoreImpl implements ProfileStore {
  private readonly queues = new Map<string, SlotQueue<WriteReq, { ok: true } | { ok: false; error: unknown }>>();
  private readonly log: { warn(...a: unknown[]): void };
  private readonly now: () => number;
  private readonly activity: ActivityTracker;

  constructor(private readonly backend: () => Promise<StorageBackend>, opts: ProfileStoreOptions = {}) {
    this.log = opts.logger ?? console;
    this.now = opts.now ?? (() => Date.now());
    this.activity = opts.activity ?? persistenceActivity;
  }

  async load<T>(key: string, fallback: T): Promise<T> {
    return (await this.loadChecked(key, fallback)).value;
  }

  async loadChecked<T>(key: string, fallback: T): Promise<{ value: T; readFailed: boolean }> {
    const keys = profileKeys(key);
    if (!keys) {
      this.log.warn(`[profile] invalid profile key ${JSON.stringify(key)}; using default`);
      return { value: fallback, readFailed: false };
    }
    let readFailed = false;
    try {
      const backend = await this.backend();
      for (const k of [keys.primary, keys.backup]) {
        let bytes: Uint8Array | null = null;
        try {
          bytes = await backend.read(k);
        } catch (e) {
          this.log.warn(`[profile] could not read ${k}:`, e);
          readFailed = true;
          continue;
        }
        if (!bytes) continue;
        const value = await this.decode(bytes, key);
        if (value.ok) {
          if (k === keys.backup) this.log.warn(`[profile] "${key}" restored from backup`);
          return { value: reconcile(fallback, value.value), readFailed };
        }
        this.log.warn(`[profile] "${k}" is damaged (${value.error})`);
      }
    } catch (e) {
      this.log.warn(`[profile] storage unavailable for "${key}":`, e);
      readFailed = true;
    }
    return { value: fallback, readFailed };
  }

  async save<T>(key: string, value: T): Promise<void> {
    const end = this.activity.begin();
    try {
      const keys = profileKeys(key);
      if (!keys) throw new Error(`[invalid] invalid profile key ${JSON.stringify(key)} (use 1-64 letters, digits, '_' or '-')`);
      // Snapshot synchronously so later mutation of `value` cannot leak into the write.
      const dropped: string[] = [];
      const valueText = canonicalJson(value, {
        undefinedProps: 'omit',
        maxDepth: MAX_VALUE_DEPTH,
        dropKeys: RESERVED_KEYS,
        onDroppedKey: (p) => dropped.push(p),
      });
      if (dropped.length > 0) this.log.warn(`[profile] "${key}": reserved key(s) left out (cannot be stored safely): ${dropped.slice(0, 5).join(', ')}`);
      let ms = this.now();
      if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) ms = 0;
      const body = `{"format":"${PROFILE_FORMAT}","key":${JSON.stringify(key)},"savedAt":${JSON.stringify(new Date(ms).toISOString())},"v":1,"value":${valueText}}`;
      if (body.length > MAX_PROFILE_BYTES) throw new Error(`[invalid] profile value "${key}" is too large`);
      const r = await this.queue(key).save({ key, text: body });
      if (!r.ok) throw r.error instanceof Error ? r.error : new Error(errorMessage(r.error));
    } finally {
      end();
    }
  }

  private queue(key: string) {
    let q = this.queues.get(key);
    if (!q) {
      q = new SlotQueue<WriteReq, { ok: true } | { ok: false; error: unknown }>(
        async (req) => {
          try {
            await this.write(req);
            return { ok: true };
          } catch (error) {
            return { ok: false, error };
          }
        },
        (error) => ({ ok: false, error }),
      );
      this.queues.set(key, q);
    }
    return q;
  }

  private async write(req: WriteReq): Promise<void> {
    const keys = profileKeys(req.key);
    if (!keys) throw new Error('[invalid] invalid profile key');
    const backend = await this.backend();
    const sha256 = await sha256Hex(req.text);
    const record = utf8Encode(`${req.text.slice(0, -1)},"sha256":"${sha256}"}`);
    // Self-check: never replace a readable record with one this build could not read back.
    const check = await this.decode(record, req.key);
    if (!check.ok) throw new Error(`[invalid] profile record "${req.key}" failed its self-check (${check.error}); nothing was written`);
    let existing: Uint8Array | null = null;
    try {
      existing = await backend.read(keys.primary);
    } catch {
      existing = null;
    }
    if (existing && (await this.decode(existing, req.key)).ok) await backend.write(keys.backup, existing);
    await backend.write(keys.primary, record);
  }

  private async decode(bytes: Uint8Array, key: string): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
    try {
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_PROFILE_BYTES) return { ok: false, error: 'bad size' };
      const text = utf8DecodeStrict(bytes);
      // Raw parse: the checksum covers exactly what is stored; reserved keys are stripped right after.
      const parsed = parseJsonRaw(text, { maxChars: MAX_PROFILE_BYTES });
      if (!isPlainObject(parsed) || parsed.format !== PROFILE_FORMAT || parsed.v !== 1) return { ok: false, error: 'not a profile record' };
      if (parsed.key !== key) return { ok: false, error: 'record belongs to another key' };
      const sha256 = parsed.sha256;
      if (typeof sha256 !== 'string' || !SHA256_HEX_RE.test(sha256)) return { ok: false, error: 'missing checksum' };
      const body = Object.create(null) as Record<string, unknown>; // mirrors stored keys exactly
      for (const [k, v] of Object.entries(parsed)) if (k !== 'sha256') body[k] = v;
      if ((await sha256Hex(canonicalJson(body))) !== sha256) return { ok: false, error: 'checksum mismatch' };
      const value = body.value;
      const dropped = mayContainReservedKeys(text) ? stripReservedKeys(value) : 0;
      if (dropped > 0) this.log.warn(`[profile] "${key}": ${dropped} reserved key(s) ignored`);
      return { ok: true, value };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  }
}
