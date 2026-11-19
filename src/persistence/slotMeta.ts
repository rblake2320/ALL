/**
 * 'slot:<id>:meta' records: a small checksummed summary of a slot so the load menu can list slots
 * without decompressing and verifying every full save. The record is a CACHE — written last in the
 * save sequence and rebuilt from the primary/backup envelope whenever it is missing, damaged or
 * stale — so it can never cause data loss, only a (self-healing) stale listing.
 */
import type { SaveSlotInfo } from './contracts';
import { canonicalJson } from './canonicalJson';
import { utf8DecodeStrict, utf8Encode } from './bytes';
import { isIsoTimestamp, sanitizeMeta, sanitizeSlotName } from './meta';
import { isPlainObject, sanitizeParse } from './sanitize';
import { SHA256_HEX_RE, sha256Hex } from './sha256';

export const META_FORMAT = 'afterlife-lease-slot-meta';
const MAX_META_BYTES = 256 * 1024;

export interface MetaRecord {
  info: SaveSlotInfo;
  /** payloadSha256 of the primary this record describes (staleness detection). */
  payloadSha256: string;
}

export async function encodeMetaRecord(rec: MetaRecord): Promise<Uint8Array> {
  const body = { format: META_FORMAT, v: 1, info: rec.info, payloadSha256: rec.payloadSha256 };
  const sha256 = await sha256Hex(canonicalJson(body));
  return utf8Encode(canonicalJson({ ...body, sha256 }));
}

function finiteNonNeg(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/** Decode + verify; returns null for anything damaged or describing a different slot. */
export async function decodeMetaRecord(bytes: Uint8Array, expectedSlotId: string): Promise<MetaRecord | null> {
  try {
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_META_BYTES) return null;
    const parsed = sanitizeParse(utf8DecodeStrict(bytes), { maxChars: MAX_META_BYTES, maxDepth: 16 });
    if (!isPlainObject(parsed) || parsed.format !== META_FORMAT || parsed.v !== 1) return null;
    if (typeof parsed.sha256 !== 'string' || !SHA256_HEX_RE.test(parsed.sha256)) return null;
    const { sha256, ...body } = parsed;
    if ((await sha256Hex(canonicalJson(body))) !== sha256) return null;
    const info = parsed.info;
    if (!isPlainObject(info) || info.slotId !== expectedSlotId) return null;
    if (typeof parsed.payloadSha256 !== 'string' || !SHA256_HEX_RE.test(parsed.payloadSha256)) return null;
    if (!isIsoTimestamp(info.savedAt) || !isIsoTimestamp(info.createdAt)) return null;
    const playMinutes = finiteNonNeg(info.playMinutes);
    const bytesLen = finiteNonNeg(info.bytes);
    if (playMinutes === null || bytesLen === null) return null;
    const meta = sanitizeMeta(info.meta).meta;
    return {
      payloadSha256: parsed.payloadSha256,
      info: {
        slotId: expectedSlotId,
        name: sanitizeSlotName(info.name, meta.householdName),
        savedAt: info.savedAt,
        createdAt: info.createdAt,
        playMinutes,
        meta,
        isAutosave: info.isAutosave === true,
        recoveredFromBackup: info.recoveredFromBackup === true,
        bytes: bytesLen,
      },
    };
  } catch {
    return null;
  }
}
