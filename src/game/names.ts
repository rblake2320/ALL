/**
 * Name rules shared by Create-a-Zombie validation, household renames and content-supplied name lists.
 *
 *  - control: C0/C1 controls, lone surrogates, line/paragraph separators and the bidi embedding / override / isolate
 *    controls (U+202A–202E, U+2066–2069, U+061C). Those can reverse or reflow surrounding UI text ("Trojan Source"
 *    style spoofing), so they are refused outright rather than stripped.
 *  - empty: nothing visible remains once whitespace, format characters (ZWSP, ZWJ, LRM/RLM, soft hyphen, word
 *    joiner, BOM …), lone combining marks and blank-looking letters (Hangul fillers, Braille blank) are removed.
 *  - tooLong: more than `max` code points after trimming (code points, not UTF-16 units: emoji count once).
 *  - nameKey(): the identity used for "two zombies can't share a first name" — NFKC-normalised, zero-width /
 *    blank-looking characters removed, whitespace runs collapsed, case-folded — so look-alikes (NFC vs NFD,
 *    full-width letters, zero-width padding) collide while "Mary Jane" and "MaryJane" stay distinct.
 */

import { LAST_NAMES } from '../sim/content/people/names';

export const NAME_MAX = 24;

const CONTROL = /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}\u202A-\u202E\u2066-\u2069\u061C]/u;
/** Characters that render as nothing (or as blank space) on their own. */
const INVISIBLE = /[\s\p{Cf}\p{Mn}\p{Me}\u115F\u1160\u3164\uFFA0\u2800\u034F]/gu;
/** Zero-width / blank-looking characters ignored when comparing names (visible marks and spaces are kept). */
const IGNORED_IN_KEY = /[\p{Cf}\u115F\u1160\u3164\uFFA0\u2800\u034F]/gu;

export type NameProblem = 'empty' | 'tooLong' | 'control';

export function nameLength(s: string): number {
  return Array.from(s).length;
}

/** Problem with a (raw, untrimmed) name, or null when valid. */
export function nameProblem(raw: unknown, max: number = NAME_MAX): NameProblem | null {
  if (typeof raw !== 'string') return 'empty';
  const s = raw.trim();
  if (CONTROL.test(s)) return 'control';
  if (s.replace(INVISIBLE, '').length === 0) return 'empty';
  if (nameLength(s) > max) return 'tooLong';
  return null;
}

/** Identity for uniqueness checks (look-alike names compare equal). */
export function nameKey(raw: string): string {
  let s = typeof raw === 'string' ? raw : '';
  try {
    s = s.normalize('NFKC');
  } catch {
    /* keep un-normalised */
  }
  return s.replace(IGNORED_IN_KEY, '').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
}

/** A content-supplied name usable as-is: already trimmed and valid by nameProblem. */
export function isUsableName(raw: unknown, max: number = NAME_MAX): raw is string {
  return typeof raw === 'string' && raw.trim() === raw && nameProblem(raw, max) === null;
}

/**
 * Typed names (security review D-3; legal check 2026-11-12): only an answered teen / adult profile may type a name.
 * A child profile and, failing closed, one whose age question is unanswered pick from the preset name pools.
 */
export function freeTextNamesForBracket(bracket: unknown): boolean {
  return bracket === 'teen' || bracket === 'adult';
}

/** A household name from the preset list (the sim people last-name pool) — what the preset picker offers. */
export function isPresetHouseholdName(raw: unknown): boolean {
  return typeof raw === 'string' && LAST_NAMES.includes(raw.trim());
}
