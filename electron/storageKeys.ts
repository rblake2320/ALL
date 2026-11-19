/**
 * Storage key <-> file name mapping for the desktop save folder. PURE (no electron, no fs).
 *
 * Keys come from an untrusted renderer, so they are validated strictly:
 *   - segments of [A-Za-z0-9_-], separated by ':'  (e.g. 'slot:autosave:primary', 'profile:settings')
 *   - <= 120 chars, no empty segments, no Windows device names (CON, PRN, AUX, NUL, COM0-9, LPT0-9,
 *     including the superscript-digit variants) in ANY segment
 * which makes path traversal ('..', '/', '\\', drive letters, NUL bytes, ADS ':' streams) impossible
 * by construction. File names are then derived losslessly AND case-insensitively-safe (NTFS/APFS are
 * case-insensitive): ':' -> '.', an uppercase letter X -> '~x'. 'profile:tutorialStage' becomes
 * 'profile.tutorial~stage.dat'; two distinct keys can never collide on any file system.
 */

export const KEY_MAX_LENGTH = 120;
export const FILE_NAME_MAX_LENGTH = 200;
export const DATA_EXT = '.dat';
/** Temp files: '<file>.tmp-<pid>-<n>' (never matches DATA_EXT, cleaned up at startup). */
export const TMP_RE = /\.tmp-\d+-\d+$/;

const KEY_RE = /^[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*$/;
const PREFIX_RE = /^[A-Za-z0-9_:-]*$/;
const RESERVED_RE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;
const FILE_STEM_RE = /^[a-z0-9_.~-]+$/;

export type KeyCheck = { ok: true; key: string } | { ok: false; reason: string };

export function isReservedDeviceName(segment: string): boolean {
  return RESERVED_RE.test(segment);
}

export function validateKey(key: unknown): KeyCheck {
  if (typeof key !== 'string') return { ok: false, reason: 'key must be a string' };
  if (key.length === 0 || key.length > KEY_MAX_LENGTH) return { ok: false, reason: `key length must be 1-${KEY_MAX_LENGTH}` };
  if (!KEY_RE.test(key)) return { ok: false, reason: 'key contains forbidden characters or empty segments' };
  for (const seg of key.split(':')) {
    if (isReservedDeviceName(seg)) return { ok: false, reason: `key segment "${seg}" is a reserved Windows device name` };
  }
  if (encodeKey(key).length > FILE_NAME_MAX_LENGTH) return { ok: false, reason: 'key is too long once encoded as a file name' };
  return { ok: true, key };
}

export function validatePrefix(prefix: unknown): KeyCheck {
  if (typeof prefix !== 'string') return { ok: false, reason: 'prefix must be a string' };
  if (prefix.length > KEY_MAX_LENGTH || !PREFIX_RE.test(prefix)) return { ok: false, reason: 'prefix contains forbidden characters' };
  return { ok: true, key: prefix };
}

function encodeKey(key: string): string {
  let out = '';
  for (const ch of key) {
    if (ch === ':') out += '.';
    else if (ch >= 'A' && ch <= 'Z') out += '~' + ch.toLowerCase();
    else out += ch;
  }
  return out + DATA_EXT;
}

/** File name for a VALID key (call validateKey first). */
export function keyToFileName(key: string): string {
  const v = validateKey(key);
  if (!v.ok) throw new Error(`[invalid] ${v.reason}`);
  return encodeKey(key);
}

/** Inverse of keyToFileName; null for anything that is not one of our data files (incl. temps). */
export function fileNameToKey(name: string): string | null {
  if (!name.endsWith(DATA_EXT)) return null;
  const stem = name.slice(0, -DATA_EXT.length);
  if (!FILE_STEM_RE.test(stem)) return null;
  let key = '';
  for (let i = 0; i < stem.length; i++) {
    const ch = stem[i];
    if (ch === '.') key += ':';
    else if (ch === '~') {
      const next = stem[i + 1];
      if (!next || next < 'a' || next > 'z') return null;
      key += next.toUpperCase();
      i++;
    } else key += ch;
  }
  const v = validateKey(key);
  if (!v.ok || encodeKey(key) !== name) return null;
  return key;
}
