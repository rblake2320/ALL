/** Input validation for HUD forms (pure). */

export const HOUSEHOLD_NAME_MAX = 28;

/** Control, zero-width, bidi-override and BOM characters (built from code points to keep the source ASCII-clean). */
const INVISIBLE_RANGES: [number, number][] = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad], // soft hyphen
  [0x034f, 0x034f], // combining grapheme joiner
  [0x061c, 0x061c], // Arabic letter mark (bidi)
  [0x115f, 0x1160], // Hangul fillers
  [0x180e, 0x180e], // Mongolian vowel separator
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0x3164, 0x3164], // Hangul filler
  [0xfe00, 0xfe0f], // variation selectors (meaningless without a base glyph worth keeping in a name)
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0], // halfwidth Hangul filler
];
const hex4 = (cp: number) => '\\u' + cp.toString(16).padStart(4, '0');
const INVISIBLE = new RegExp('[' + INVISIBLE_RANGES.map(([a, b]) => hex4(a) + '-' + hex4(b)).join('') + ']', 'g');

export type Validated<T> = { ok: true; value: T } | { ok: false; error: 'empty' | 'tooLong' | 'noLetters' };

/**
 * Household names: strip control/zero-width characters, collapse whitespace, 1..28 characters (code points),
 * must contain at least one letter or digit.
 */
export function validateHouseholdName(raw: unknown): Validated<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'empty' };
  const cleaned = raw.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return { ok: false, error: 'empty' };
  if (Array.from(cleaned).length > HOUSEHOLD_NAME_MAX) return { ok: false, error: 'tooLong' };
  if (!/[\p{L}\p{N}]/u.test(cleaned)) return { ok: false, error: 'noLetters' };
  return { ok: true, value: cleaned };
}

/** Party guest cap (GDD §11); also the fallback when a caller passes a junk cap. */
export const MAX_PARTY_GUESTS = 6;

function capOf(max: unknown): number {
  return typeof max === 'number' && Number.isFinite(max) ? Math.max(0, Math.floor(max)) : MAX_PARTY_GUESTS;
}

/** Clamp a guest-list selection to the party cap, preserving pick order and dropping duplicates/garbage. */
export function clampGuestList(ids: readonly unknown[] | null | undefined, max: number = MAX_PARTY_GUESTS): string[] {
  const cap = capOf(max);
  const out: string[] = [];
  if (cap === 0 || !Array.isArray(ids)) return out;
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0 || out.includes(id)) continue;
    out.push(id);
    if (out.length >= cap) break;
  }
  return out;
}

/** Toggle an id in a capped selection (a copy; junk entries dropped). Adding past the cap is a no-op. */
export function toggleGuest(selected: readonly string[] | null | undefined, id: string, max: number = MAX_PARTY_GUESTS): string[] {
  const cap = capOf(max);
  const sel = Array.isArray(selected) ? clampGuestList(selected, Number.MAX_SAFE_INTEGER) : [];
  if (typeof id !== 'string' || !id) return sel;
  if (sel.includes(id)) return sel.filter((x) => x !== id);
  if (sel.length >= cap) return sel;
  return [...sel, id];
}
