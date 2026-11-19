/**
 * Slot ids and storage key layout.
 *
 *   slot:<id>:primary   current save envelope (gzip or JSON bytes)
 *   slot:<id>:backup    previous GOOD save (rotated from primary before every overwrite)
 *   slot:<id>:meta      small JSON summary for fast slot listing (a cache; rebuilt if damaged)
 *   profile:<key>[:bak] per-install profile records (see profileStore.ts)
 *
 * Slot ids are case-INsensitive (canonicalized to lowercase) because the desktop build stores keys
 * as files and Windows/macOS file systems are case-insensitive: "Slot1" and "slot1" must be the same
 * slot on every backend. Windows device names (CON, PRN, AUX, NUL, COM0-9, LPT0-9) are refused so a
 * slot id never maps to a reserved file name.
 */

export const SLOT_ID_RE = /^[a-z0-9_-]{1,40}$/i;
export const WINDOWS_RESERVED_RE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;

export const AUTOSAVE_SLOT = 'autosave';

export type SlotIdCheck = { ok: true; id: string } | { ok: false; error: string };

export function canonicalSlotId(raw: unknown): SlotIdCheck {
  if (typeof raw !== 'string') return { ok: false, error: 'slot id must be a string' };
  if (!SLOT_ID_RE.test(raw)) return { ok: false, error: `invalid slot id "${raw.slice(0, 60)}" (use 1-40 letters, digits, '_' or '-')` };
  const id = raw.toLowerCase();
  if (WINDOWS_RESERVED_RE.test(id)) return { ok: false, error: `slot id "${id}" is a reserved device name on Windows` };
  return { ok: true, id };
}

export function isAutosaveId(id: string): boolean {
  return id === AUTOSAVE_SLOT || /^autosave-\d{1,2}$/.test(id);
}

export type SlotRole = 'primary' | 'backup' | 'meta';

export interface SlotKeys {
  primary: string;
  backup: string;
  meta: string;
}

export const SLOT_PREFIX = 'slot:';

export function slotKeys(id: string): SlotKeys {
  return { primary: `slot:${id}:primary`, backup: `slot:${id}:backup`, meta: `slot:${id}:meta` };
}

/** Parse 'slot:<id>:<role>' (ids must already be canonical lowercase). Anything else -> null. */
export function parseSlotKey(key: string): { id: string; role: SlotRole } | null {
  const m = /^slot:([a-z0-9_-]{1,40}):(primary|backup|meta)$/.exec(key);
  if (!m) return null;
  if (WINDOWS_RESERVED_RE.test(m[1])) return null;
  return { id: m[1], role: m[2] as SlotRole };
}

export const PROFILE_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function profileKeys(key: string): { primary: string; backup: string } | null {
  if (typeof key !== 'string' || !PROFILE_KEY_RE.test(key) || WINDOWS_RESERVED_RE.test(key)) return null;
  return { primary: `profile:${key}`, backup: `profile:${key}:bak` };
}
