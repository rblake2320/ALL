/**
 * Hardened JSON.parse for untrusted save files and imports.
 *
 *  - Size cap (default 64 MiB of text) checked BEFORE parsing.
 *  - Depth cap (default 128) measured by a linear pre-scan, so pathological nesting can neither blow
 *    the parser's stack nor reach code that recurses over the result.
 *  - Keys '__proto__', 'constructor' and 'prototype' (RESERVED_KEYS) are DROPPED (including \u-escaped
 *    spellings). JSON.parse itself never invokes the __proto__ setter, but downstream spreads/merges
 *    (`{...x}`, Object.assign, deep-merge, `out[k] = v`) would — so those keys must not survive parsing.
 *
 * The WRITE side must agree: every serializer of stored data leaves RESERVED_KEYS out
 * (canonicalJson `dropKeys`), otherwise a checksum would cover data the loader never reconstructs.
 * Checksummed containers (save envelopes, profile records) are verified over the RAW parse
 * (parseJsonRaw — safe as long as nothing merges it) and stripped afterwards (stripReservedKeys), so a
 * file written by any producer stays loadable and only loses the unsafe keys.
 */

export const MAX_SAVE_BYTES = 64 * 1024 * 1024;
export const MAX_JSON_DEPTH = 128;

/** Object keys that can never be stored or loaded (prototype-pollution vectors). */
export const RESERVED_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
const FORBIDDEN_KEYS = RESERVED_KEYS;
/** Fast-path guard: if none of these substrings occur, no forbidden key can be present. */
const NEEDS_REVIVER = /__proto__|constructor|prototype|\\u/;

/** False when `text` provably contains no reserved key (no such substring, no \u escapes). */
export function mayContainReservedKeys(text: string): boolean {
  return NEEDS_REVIVER.test(text);
}

export type SanitizeErrorCode = 'too_large' | 'too_deep' | 'syntax';

export class SanitizeError extends Error {
  readonly code: SanitizeErrorCode;
  constructor(code: SanitizeErrorCode, message: string) {
    super(message);
    this.name = 'SanitizeError';
    this.code = code;
  }
}

export interface SanitizeOptions {
  maxChars?: number;
  maxDepth?: number;
}

export interface SanitizeResult {
  value: unknown;
  /** Number of forbidden keys removed. */
  droppedKeys: number;
}

/** Maximum nesting depth of objects/arrays in JSON text (strings are skipped correctly). */
export function measureJsonDepth(text: string, stopAbove = Infinity): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 92) i++; // backslash: skip escaped char
      else if (c === 34) inString = false;
      continue;
    }
    if (c === 34) inString = true;
    else if (c === 123 || c === 91) {
      depth++;
      if (depth > max) {
        max = depth;
        if (max > stopAbove) return max;
      }
    } else if (c === 125 || c === 93) depth--;
  }
  return max;
}

export function sanitizeParseDetailed(text: string, opts: SanitizeOptions = {}): SanitizeResult {
  if (typeof text !== 'string') throw new SanitizeError('syntax', 'expected JSON text');
  const maxChars = opts.maxChars ?? MAX_SAVE_BYTES;
  const maxDepth = opts.maxDepth ?? MAX_JSON_DEPTH;
  if (text.length > maxChars) throw new SanitizeError('too_large', `JSON text is ${text.length} chars (limit ${maxChars})`);
  const depth = measureJsonDepth(text, maxDepth);
  if (depth > maxDepth) throw new SanitizeError('too_deep', `JSON nesting exceeds ${maxDepth} levels`);
  let droppedKeys = 0;
  let value: unknown;
  try {
    if (!NEEDS_REVIVER.test(text)) {
      value = JSON.parse(text);
    } else {
      value = JSON.parse(text, function reviver(this: unknown, key: string, v: unknown) {
        if (FORBIDDEN_KEYS.has(key) && this !== null && typeof this === 'object' && !Array.isArray(this)) {
          droppedKeys++;
          return undefined; // deletes the property from its holder
        }
        return v;
      });
    }
  } catch (e) {
    throw new SanitizeError('syntax', e instanceof Error ? e.message : String(e));
  }
  return { value, droppedKeys };
}

/** Parse untrusted JSON (see module doc). Throws SanitizeError on oversize/overdeep/invalid input. */
export function sanitizeParse(text: string, opts: SanitizeOptions = {}): unknown {
  return sanitizeParseDetailed(text, opts).value;
}

/**
 * Size- and depth-capped JSON.parse that KEEPS every key (reserved ones become plain own properties —
 * JSON.parse never invokes the __proto__ setter). Only for verifying a checksum over exactly what is
 * stored; the result must go through stripReservedKeys before anything copies or merges it.
 */
export function parseJsonRaw(text: string, opts: SanitizeOptions = {}): unknown {
  if (typeof text !== 'string') throw new SanitizeError('syntax', 'expected JSON text');
  const maxChars = opts.maxChars ?? MAX_SAVE_BYTES;
  const maxDepth = opts.maxDepth ?? MAX_JSON_DEPTH;
  if (text.length > maxChars) throw new SanitizeError('too_large', `JSON text is ${text.length} chars (limit ${maxChars})`);
  if (measureJsonDepth(text, maxDepth) > maxDepth) throw new SanitizeError('too_deep', `JSON nesting exceeds ${maxDepth} levels`);
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    throw new SanitizeError('syntax', e instanceof Error ? e.message : String(e));
  }
}

/**
 * Delete RESERVED_KEYS own properties from every object reachable from `value`, in place (iterative —
 * no recursion, arbitrary depth). Returns how many were removed.
 */
export function stripReservedKeys(value: unknown): number {
  let removed = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const v = stack.pop();
    if (v === null || typeof v !== 'object') continue;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const item: unknown = v[i];
        if (item !== null && typeof item === 'object') stack.push(item);
      }
      continue;
    }
    const rec = v as Record<string, unknown>;
    for (const k of Object.keys(rec)) {
      if (FORBIDDEN_KEYS.has(k)) {
        delete rec[k]; // deletes the OWN property; never touches the prototype
        removed++;
        continue;
      }
      const child = rec[k];
      if (child !== null && typeof child === 'object') stack.push(child);
    }
  }
  return removed;
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
