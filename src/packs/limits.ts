/**
 * Content-pack limits + path rules (docs/MONETIZATION.md §5). Shared by the zip reader and the verifier.
 * A pack path is a relative POSIX path of lowercase [a-z0-9._-] segments — anything else (absolute paths, '..',
 * backslashes, drive letters, NUL, empty segments, dot-files, very deep nesting) is rejected BEFORE any byte is used.
 */
export const PACK_LIMITS = {
  maxFiles: 512,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxManifestBytes: 256 * 1024,
  maxPathLength: 160,
  maxPathDepth: 6,
  /** Largest uncompressed/compressed ratio accepted for a zip entry (zip-bomb guard). */
  maxCompressionRatio: 100,
  maxJsonDepth: 16,
} as const;

/** Archive / compressed container extensions: nested archives are never accepted inside a pack. */
const NESTED_ARCHIVE_RE = /\.(zip|jar|apk|7z|rar|tar|tgz|gz|bz2|xz|zst|br|cab|iso|dmg|pack)$/i;
const SEG_RE = /^[a-z0-9_-][a-z0-9._-]{0,63}$/;

export type PathCheck = { ok: true; path: string } | { ok: false; reason: string };

export function checkPackPath(raw: unknown): PathCheck {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, reason: 'empty path' };
  if (raw.length > PACK_LIMITS.maxPathLength) return { ok: false, reason: `path too long: ${raw.slice(0, 40)}…` };
  if (/[\u0000-\u001f\\:]/.test(raw)) return { ok: false, reason: `forbidden character in path "${raw}"` };
  if (raw.startsWith('/')) return { ok: false, reason: `absolute path "${raw}"` };
  const segs = raw.split('/');
  if (segs.length > PACK_LIMITS.maxPathDepth) return { ok: false, reason: `path nested too deeply "${raw}"` };
  for (const s of segs) {
    if (s === '' || s === '.' || s === '..') return { ok: false, reason: `path traversal or empty segment in "${raw}"` };
    if (!SEG_RE.test(s)) return { ok: false, reason: `path segment "${s}" is not allowed (lowercase letters, digits, . _ - only; no dot-files)` };
  }
  if (NESTED_ARCHIVE_RE.test(raw)) return { ok: false, reason: `nested archive "${raw}" is not allowed inside a pack` };
  return { ok: true, path: raw };
}
