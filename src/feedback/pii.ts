/**
 * PII scrubbing for feedback reports (W-110 §1 "no personal data", docs/SECURITY.md T10). Runs on the client before
 * anything is stored AND again in `feedback:ingest` (never trust the producer).
 *
 * Removed:
 *  - every name the player typed or the world holds: household, zombie/townie first + last names, save names,
 *    Create-a-Zombie drafts (`knownNames`, matched case-insensitively on letter/digit boundaries, ≥ 2 characters);
 *  - e-mail addresses, URLs' user-info / query / fragment, IPv4/IPv6 addresses (only 127.0.0.1, the local dev/preview
 *    server, is kept), phone-like digit runs;
 *  - the account part of file-system paths (C:\Users\<x>, /home/<x>, /Users/<x>, file:// URLs, %USERPROFILE%), and
 *    any remaining absolute local path is cut down to its last segment;
 *  - control / bidi-override characters (they can hide text in an issue tracker).
 * Replacements are fixed tokens ([name], [email], …) so the report stays readable and dedupes stably.
 */

const UNSAFE_CHARS = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff]', 'g');
const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
// "at"/"dot" obfuscations: name (at) host (dot) com
const EMAIL_OBFUSCATED_RE = /[\p{L}\p{N}._%+-]+\s*[([{]\s*at\s*[)\]}]\s*[\p{L}\p{N}-]+(?:\s*[([{]\s*dot\s*[)\]}]\s*[\p{L}\p{N}-]+)+/giu;
const URL_RE = /\b([a-z][a-z0-9+.-]{1,15}):\/\/([^\s/?#@]*@)?([^\s/?#]*)([^\s?#]*)(\?[^\s#]*)?(#\S*)?/gi;
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const IPV6_RE = /\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b/gi;
// 7+ digits, optionally separated by spaces/dashes/dots/parentheses, optional leading + (phone numbers, IDs).
const PHONE_RE = /(?<![\w.])\+?\(?\d[\d\s().-]{5,}\d(?!\w)/g;
// Folder names may hold spaces ("C:\Users\Jane Doe"), so a path never ends at whitespace: the account segment runs to
// the next separator, quote or line end, and a file:// URL or network share runs to the next quote or line end.
const FILE_URL_RE = /\bfile:\/\/[^"'`\r\n]*/gi;
const WIN_USER_RE = /([A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+)[^\\/"'`\r\n]+/gi;
const UNC_RE = /\\\\[^\\\s]+\\[^"'`\r\n]*/g;
const NIX_USER_RE = /(\/(?:home|Users|var\/home|root)\/)[^/"'`\r\n]+/g;
const ENV_USER_RE = /%(?:USERPROFILE|USERNAME|HOMEPATH|APPDATA|LOCALAPPDATA)%/gi;
const TILDE_USER_RE = /~[A-Za-z0-9._-]+(?=\/)/g;
// Any other absolute local path (D:\…, /Volumes/…, /opt/…). A folder name may hold spaces when a separator follows
// it; the last segment ends at whitespace. Not matched: URL paths, relative (./x/y, ~/x/y) and "and/or" style slashes.
const WIN_PATH_RE = /(?<![\p{L}\p{N}])[A-Za-z]:[\\/]+(?:[^\\/:"'`\r\n]*[^\\/:\s"'`][\\/]+)*[^\\/\s"'`]*/gu;
const NIX_PATH_RE = /(?<![\p{L}\p{N}_.~/\\\]<])\/[^/\s"'`]+\/+(?:[^/"'`\r\n]*[^/\s"'`]\/+)*[^/\s"'`]*/gu;

export const MIN_NAME_LEN = 2;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Normalise a list of names: trimmed, deduped (case-insensitive), ≥ 2 chars, longest first (so "Mort" never splits "Mortimer"). */
export function normaliseNames(names: Iterable<unknown>): string[] {
  const seen = new Map<string, string>();
  for (const raw of names) {
    if (typeof raw !== 'string') continue;
    const whole = raw.replace(UNSAFE_CHARS, '').replace(/\s+/g, ' ').trim();
    // the whole phrase ("The Grimsbys") and each word of it ("Grimsbys") — players retype either
    const parts = [whole, ...whole.split(/[\s,;:]+/)];
    for (const p of parts) {
      const s = p.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (Array.from(s).length < MIN_NAME_LEN || s.length > 80) continue;
      if (/^(the|and|of|de|la|le|van|von)$/i.test(s)) continue; // connector words alone are not identifying
      const k = s.toLocaleLowerCase();
      if (!seen.has(k)) seen.set(k, s);
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.length - a.length);
}

/** One compiled matcher for a name list (null when empty). Exported for tests. */
export function nameMatcher(names: readonly string[]): RegExp | null {
  if (names.length === 0) return null;
  const alt = names.slice(0, 2000).map(escapeRe).join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt})(?![\\p{L}\\p{N}])`, 'giu');
}

function scrubUrl(_m: string, scheme: string, _user: string | undefined, host: string, path: string): string {
  const s = scheme.toLowerCase();
  if (s === 'file') return `file://[path]`;
  return `${s}://${scrubHost(host)}${path}`;
}

function scrubHost(host: string): string {
  return host.replace(IPV4_RE, (ip) => (ip === '127.0.0.1' ? ip : '[ip]'));
}

/** A path whose account part is already [user] stays; any other absolute local path keeps only its last segment. */
function lastSegment(path: string): string {
  if (path.includes('[user]')) return path;
  return path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1) || '[path]';
}

export interface ScrubOptions {
  names?: readonly string[] | RegExp | null;
  /** Hard cap on the result (characters); default unlimited. */
  maxLen?: number;
  /**
   * Replace phone-like digit runs (default true — for what the player typed). Diagnostics pass false: ticks, seeds
   * and byte counts are long numbers too, and diagnostics never contain player-typed text (names are matched above).
   */
  phones?: boolean;
}

/** Scrub one string. Never throws; non-strings become ''. */
export function scrubText(input: unknown, opts: ScrubOptions = {}): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  let s = input.replace(UNSAFE_CHARS, '');
  // URLs first: their user-info (user:pass@host) would otherwise read as an e-mail address
  s = s.replace(FILE_URL_RE, 'file://[path]').replace(URL_RE, scrubUrl);
  s = s.replace(EMAIL_RE, '[email]').replace(EMAIL_OBFUSCATED_RE, '[email]');
  s = s.replace(WIN_USER_RE, '$1[user]').replace(UNC_RE, '[path]').replace(NIX_USER_RE, '$1[user]').replace(ENV_USER_RE, '[user]').replace(TILDE_USER_RE, '~[user]');
  s = s.replace(WIN_PATH_RE, lastSegment).replace(NIX_PATH_RE, lastSegment);
  s = s.replace(IPV6_RE, '[ip]').replace(IPV4_RE, (ip) => (ip === '127.0.0.1' ? ip : '[ip]'));
  if (opts.phones !== false) s = s.replace(PHONE_RE, (m) => (m.replace(/\D/g, '').length >= 7 ? '[number]' : m));
  const re = opts.names instanceof RegExp ? opts.names : nameMatcher(normaliseNames(opts.names ?? []));
  if (re) {
    re.lastIndex = 0;
    s = s.replace(re, '[name]');
  }
  if (opts.maxLen !== undefined && s.length > opts.maxLen) s = `${s.slice(0, Math.max(0, opts.maxLen - 1))}…`;
  return s;
}

/**
 * Deep-scrub a JSON-like value: every string (values AND object keys) goes through scrubText. Arrays/objects are
 * copied (the input is never mutated); depth-capped; non-JSON values (functions, symbols, bigint) are dropped.
 */
export function scrubDeep<T>(value: T, opts: ScrubOptions = {}, depth = 0): T {
  const re = opts.names instanceof RegExp ? opts.names : nameMatcher(normaliseNames(opts.names ?? []));
  const o: ScrubOptions = { names: re, phones: opts.phones };
  const walk = (v: unknown, d: number): unknown => {
    if (typeof v === 'string') return scrubText(v, o);
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'boolean' || v === null) return v;
    if (d > 32 || typeof v !== 'object') return null;
    if (Array.isArray(v)) return v.map((x) => walk(x, d + 1));
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (x === undefined || typeof x === 'function' || typeof x === 'symbol' || typeof x === 'bigint') continue;
      out[scrubText(k, o)] = walk(x, d + 1);
    }
    return out;
  };
  return walk(value, depth) as T;
}
