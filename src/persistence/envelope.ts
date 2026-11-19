/**
 * Save envelope (contract: src/persistence/contracts.ts):
 *
 *   { format: 'afterlife-lease-save', formatVersion: 1, schemaVersion, gameVersion, slotId, name,
 *     createdAt, savedAt, playMinutes, meta, payloadSha256, headerSha256, payload }
 *
 *  - payloadSha256 = SHA-256(canonicalJson(payload))           (contract)
 *  - headerSha256  = SHA-256(canonicalJson(every field except payload/headerSha256))  (additive
 *    extension; covers payloadSha256 too, so ANY bit flip in the file is detected. Envelopes
 *    without it are still accepted, with a warning.)
 *
 * The on-disk text is canonical header fields followed by the payload as the LAST property, so the
 * header is readable at the top of an exported file. Formatting is irrelevant to verification:
 * hashes are computed over the canonical re-serialization of the parsed values.
 */
import type { SaveMeta } from './contracts';
import { canonicalJson } from './canonicalJson';
import { isIsoTimestamp, sanitizeMeta, sanitizeSlotName } from './meta';
import { isPlainObject } from './sanitize';
import { SHA256_HEX_RE, sha256Hex } from './sha256';
import { SLOT_ID_RE } from './slotKeys';

export const SAVE_FORMAT = 'afterlife-lease-save';
export const SAVE_FORMAT_VERSION = 1;

export interface EnvelopeHeader {
  format: typeof SAVE_FORMAT;
  formatVersion: number;
  schemaVersion: number;
  gameVersion: string;
  slotId: string;
  name: string;
  createdAt: string;
  savedAt: string;
  playMinutes: number;
  meta: SaveMeta;
  payloadSha256: string;
}

export interface SealedHeader extends EnvelopeHeader {
  headerSha256: string;
}

/** A parsed envelope whose checksums verified; payload is still raw JSON (not yet a WorldState). */
export interface VerifiedEnvelope extends EnvelopeHeader {
  headerSha256: string | null;
  payload: Record<string, unknown>;
}

export interface EnvelopeInput {
  payloadText: string;
  schemaVersion: number;
  gameVersion: string;
  slotId: string;
  name: string;
  createdAt: string;
  savedAt: string;
  playMinutes: number;
  meta: SaveMeta;
}

export async function sealHeader(h: EnvelopeHeader): Promise<SealedHeader> {
  const headerSha256 = await sha256Hex(canonicalJson(h));
  return { ...h, headerSha256 };
}

export async function buildEnvelope(input: EnvelopeInput): Promise<{ header: SealedHeader; text: string }> {
  const header = await sealHeader({
    format: SAVE_FORMAT,
    formatVersion: SAVE_FORMAT_VERSION,
    schemaVersion: input.schemaVersion,
    gameVersion: input.gameVersion,
    slotId: input.slotId,
    name: input.name,
    createdAt: input.createdAt,
    savedAt: input.savedAt,
    playMinutes: input.playMinutes,
    meta: input.meta,
    payloadSha256: await sha256Hex(input.payloadText),
  });
  const headerText = canonicalJson(header);
  return { header, text: `${headerText.slice(0, -1)},"payload":${input.payloadText}}` };
}

/** Human-readable export: 2-space indented header, then the payload, still self-verifying. */
export function prettyEnvelopeText(header: SealedHeader, payload: unknown): string {
  const h = canonicalJson(header, { indent: 2 });
  const p = canonicalJson(payload, { indent: 2 }).replace(/\n/g, '\n  ');
  return `${h.slice(0, -2)},\n  "payload": ${p}\n}\n`;
}

export type EnvelopeFailureCode = 'corrupt' | 'future_version' | 'invalid';
export type EnvelopeCheck =
  | { ok: true; envelope: VerifiedEnvelope; warnings: string[] }
  | { ok: false; code: EnvelopeFailureCode; error: string };

const fail = (code: EnvelopeFailureCode, error: string): EnvelopeCheck => ({ ok: false, code, error });

/**
 * Verify a parsed envelope: format, checksums, schema consistency. Never throws.
 * `maxSchemaVersion` is the newest world schema this build understands.
 */
export async function verifyEnvelope(obj: unknown, maxSchemaVersion: number): Promise<EnvelopeCheck> {
  try {
    if (!isPlainObject(obj)) return fail('corrupt', 'not an Afterlife Lease save (top level is not an object)');
    if (obj.format !== SAVE_FORMAT) return fail('corrupt', 'not an Afterlife Lease save (wrong or missing format tag)');
    const fv = obj.formatVersion;
    if (typeof fv !== 'number' || !Number.isInteger(fv) || fv < 1) return fail('corrupt', 'save header is damaged (formatVersion)');
    if (fv > SAVE_FORMAT_VERSION) {
      return fail('future_version', `save file format v${fv} is newer than this build supports (v${SAVE_FORMAT_VERSION}) — update the game`);
    }
    const payloadSha = obj.payloadSha256;
    if (typeof payloadSha !== 'string' || !SHA256_HEX_RE.test(payloadSha)) return fail('corrupt', 'save header is damaged (payload checksum missing)');
    const payload = obj.payload;
    if (!isPlainObject(payload)) return fail('corrupt', 'save payload is missing or not an object');

    let actual: string;
    try {
      actual = await sha256Hex(canonicalJson(payload));
    } catch (e) {
      return fail('corrupt', `save payload cannot be canonicalized: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (actual !== payloadSha) return fail('corrupt', 'save data is damaged (payload checksum mismatch)');

    const warnings: string[] = [];
    // Null prototype: mirrors the stored keys EXACTLY (an own "__proto__" key from a raw parse stays a
    // plain key instead of hitting Object.prototype's setter).
    const headerFields = Object.create(null) as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) if (k !== 'payload' && k !== 'headerSha256') headerFields[k] = v;
    let headerSha: string | null = null;
    if (obj.headerSha256 !== undefined) {
      if (typeof obj.headerSha256 !== 'string' || !SHA256_HEX_RE.test(obj.headerSha256)) return fail('corrupt', 'save header is damaged (header checksum malformed)');
      const h = await sha256Hex(canonicalJson(headerFields));
      if (h !== obj.headerSha256) return fail('corrupt', 'save header is damaged (header checksum mismatch)');
      headerSha = obj.headerSha256;
    } else {
      warnings.push('save header has no checksum (older or hand-made file); header fields were not verified');
    }

    const sv = obj.schemaVersion;
    if (typeof sv !== 'number' || !Number.isInteger(sv) || sv < 1) return fail('corrupt', 'save header is damaged (schemaVersion)');
    if (payload.schemaVersion !== sv) return fail('corrupt', `schema version mismatch between header (v${sv}) and payload`);
    if (sv > maxSchemaVersion) {
      return fail('future_version', `save uses world schema v${sv}, this build supports up to v${maxSchemaVersion} — update the game to load it`);
    }

    // Header fields are covered by headerSha256, but a hand-made or legacy file may still be odd:
    // normalize instead of trusting.
    const metaResult = sanitizeMeta(obj.meta);
    warnings.push(...metaResult.warnings);
    const slotId = typeof obj.slotId === 'string' && SLOT_ID_RE.test(obj.slotId) ? obj.slotId.toLowerCase() : '';
    if (!slotId) warnings.push('save header slot id missing or malformed');
    const savedAt = isIsoTimestamp(obj.savedAt) ? obj.savedAt : new Date(0).toISOString();
    if (savedAt !== obj.savedAt) warnings.push('save timestamp missing or malformed');
    const createdAt = isIsoTimestamp(obj.createdAt) ? obj.createdAt : savedAt;
    const pm = obj.playMinutes;
    const playMinutes = typeof pm === 'number' && Number.isFinite(pm) && pm >= 0 ? pm : 0;
    const envelope: VerifiedEnvelope = {
      format: SAVE_FORMAT,
      formatVersion: fv,
      schemaVersion: sv,
      gameVersion: typeof obj.gameVersion === 'string' ? obj.gameVersion.slice(0, 64) : 'unknown',
      slotId,
      name: sanitizeSlotName(obj.name, metaResult.meta.householdName),
      createdAt,
      savedAt,
      playMinutes,
      meta: metaResult.meta,
      payloadSha256: payloadSha,
      headerSha256: headerSha,
      payload,
    };
    return { ok: true, envelope, warnings };
  } catch (e) {
    return fail('corrupt', `save could not be verified: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Re-seal the verified header (e.g. for export) — identical hash when nothing was normalized. */
export async function resealVerified(env: VerifiedEnvelope): Promise<SealedHeader> {
  return sealHeader({
    format: SAVE_FORMAT,
    formatVersion: env.formatVersion,
    schemaVersion: env.schemaVersion,
    gameVersion: env.gameVersion,
    slotId: env.slotId,
    name: env.name,
    createdAt: env.createdAt,
    savedAt: env.savedAt,
    playMinutes: env.playMinutes,
    meta: env.meta,
    payloadSha256: env.payloadSha256,
  });
}
