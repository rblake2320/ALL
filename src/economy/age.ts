/**
 * Age gate, parental flags and purchase gating (docs/MONETIZATION.md §1 "Minors (E10+)", §4 rewarded ads).
 *
 *  - Neutral age gate: year of birth asked once, nothing about the threshold is shown; ONLY the bracket is stored.
 *    The age is computed conservatively (birthday not yet reached this year): born 2013, asked in 2026 → 12.
 *    The child bracket ('under13', a legacy id) is every age below CHILD_AGE_LIMIT (15, owner 2026-11-11).
 *  - The bracket can only move to a YOUNGER bracket from the client; moving older (e.g. an under-13 answering again
 *    with an earlier year) is refused — that needs the parental/account flow (ParentGate; none exists offline, so it
 *    fails closed). Teen spend-cap changes go through the same ParentGate.
 *  - FAIL CLOSED (security review 2026-11-05, D-2 / M-2): the stored record is sealed (SHA-256 over the record + a
 *    per-install salt kept in a SEPARATE profile record, `economy-age-seen`, which also marks "a bracket was decided
 *    here"; the prefs record carries a second decided marker). On load (`resolveStoredAge`):
 *      · no record and no decided marker            → 'unknown' (fresh install: the gate is shown);
 *      · record missing/corrupt but a marker exists  → 'under13';
 *      · record whose seal does not verify, or that cannot be verified (salt record gone) → 'under13';
 *      · a decided bracket without a valid decision time, or an unknown bracket value     → 'under13';
 *      · an unsealed (pre-seal, legacy) record is accepted only on an install that never wrote a marker, then sealed.
 *    Never unknown → adult from damaged data.
 *  - Honest limit: the seal is NOT a secret (a key in the client is public) — it stops casual edits and "delete one
 *    file" resets, not a user who recomputes it. A full wipe of ALL site/profile data is indistinguishable from a
 *    fresh install offline and shows the gate again; only the account-level bracket (Phase 4 server, verified parental
 *    consent) can close that.
 *  - under13: no real-money/GG purchases (no verified parental consent exists yet — COPPA), no rewarded ads, no
 *    analytics, no ads personalisation (there is none at all), preset names instead of free text (D-3). Bones
 *    unlocks (earned in play) stay available.
 *  - teen: monthly real-money cap (default $25, parent-adjustable 0..$100). The server enforces it in Phase 4; the
 *    client checks it before ever starting a checkout.
 * A single-player client cannot stop a determined user editing local data; the server is the authority online.
 */
import { CHILD_AGE_LIMIT } from '../shared/economy';
import type { AgeBracket, StoreSku } from '../shared/economy';
import { canonicalJson } from '../persistence/canonicalJson';
import { sha256Hex } from '../persistence/sha256';

export const DEFAULT_TEEN_CAP_CENTS = 2500;
export const MAX_TEEN_CAP_CENTS = 10_000;
export const REWARDED_ADS_PER_DAY = 5;
export const REWARDED_AD_BONES = 50;
export const MIN_BIRTH_YEAR = 1900;

const ORDER: Record<Exclude<AgeBracket, 'unknown'>, number> = { under13: 0, teen: 1, adult: 2 };

export interface AgeProfile {
  bracket: AgeBracket;
  /** ISO time the bracket was set (null when never). */
  decidedAt: string | null;
  /** Teen monthly real-money cap (cents); ignored for adults, 0 for under13. */
  spendCapCents: number;
  /** Real-money spent this month (server-reported in Phase 4; 0 offline). */
  spentThisMonthCents: number;
  spendMonth: string | null;
}

export const DEFAULT_AGE_PROFILE: AgeProfile = { bracket: 'unknown', decidedAt: null, spendCapCents: DEFAULT_TEEN_CAP_CENTS, spentThisMonthCents: 0, spendMonth: null };

export function isBracket(v: unknown): v is AgeBracket {
  return v === 'under13' || v === 'teen' || v === 'adult' || v === 'unknown';
}

/** Conservative age from a year of birth; null for junk (non-integer, future, before 1900). */
export function ageFromBirthYear(year: unknown, now: Date): number | null {
  const y = typeof year === 'string' && /^\s*\d{4}\s*$/.test(year) ? Number(year.trim()) : year;
  if (typeof y !== 'number' || !Number.isInteger(y)) return null;
  const current = now.getFullYear();
  if (y < MIN_BIRTH_YEAR || y > current) return null;
  return Math.max(0, current - y - 1);
}

export function bracketForAge(age: number): Exclude<AgeBracket, 'unknown'> {
  // written so that a non-number (NaN) lands in the child bracket, never in 'adult'
  return !(age >= CHILD_AGE_LIMIT) ? 'under13' : !(age >= 18) ? 'teen' : 'adult';
}

export type AgeAnswer = { ok: true; profile: AgeProfile } | { ok: false; reason: 'invalid' | 'locked' };

/** Apply a year-of-birth answer. Refuses junk and any move to an older bracket once one is set. */
export function answerAgeGate(cur: AgeProfile, year: unknown, now: Date): AgeAnswer {
  const age = ageFromBirthYear(year, now);
  if (age === null) return { ok: false, reason: 'invalid' };
  const next = bracketForAge(age);
  if (cur.bracket !== 'unknown' && ORDER[next] > ORDER[cur.bracket]) return { ok: false, reason: 'locked' };
  return {
    ok: true,
    profile: {
      ...cur,
      bracket: next,
      decidedAt: now.toISOString(),
      spendCapCents: next === 'under13' ? 0 : next === 'teen' ? clampCap(cur.spendCapCents) : cur.spendCapCents,
    },
  };
}

export function clampCap(cents: unknown): number {
  const v = typeof cents === 'number' && Number.isFinite(cents) ? Math.round(cents) : DEFAULT_TEEN_CAP_CENTS;
  return Math.min(MAX_TEEN_CAP_CENTS, Math.max(0, v));
}

/**
 * Sanitise a stored profile (tampered/corrupt values never grant more than they should). `null`/`undefined` = nothing
 * stored → 'unknown'. Anything else that is not a well-formed record is DAMAGED data and fails closed to 'under13':
 * a non-object, an unknown bracket value, or a decided bracket without a valid decision time.
 */
export function sanitizeAgeProfile(raw: unknown): AgeProfile {
  if (raw === null || raw === undefined) return { ...DEFAULT_AGE_PROFILE };
  if (typeof raw !== 'object' || Array.isArray(raw)) return failClosedProfile(null);
  const r = raw as Record<string, unknown>;
  const decidedAt = typeof r.decidedAt === 'string' && !Number.isNaN(Date.parse(r.decidedAt)) ? r.decidedAt : null;
  let b: AgeBracket;
  if (!isBracket(r.bracket)) b = 'under13';
  else if (r.bracket === 'unknown') b = 'unknown';
  else b = decidedAt === null ? 'under13' : r.bracket;
  const spent = typeof r.spentThisMonthCents === 'number' && Number.isFinite(r.spentThisMonthCents) && r.spentThisMonthCents > 0 ? Math.round(r.spentThisMonthCents) : 0;
  return {
    bracket: b,
    decidedAt: b === 'unknown' ? null : (decidedAt ?? EPOCH_ISO),
    spendCapCents: b === 'under13' ? 0 : clampCap(r.spendCapCents),
    spentThisMonthCents: spent,
    spendMonth: typeof r.spendMonth === 'string' && /^\d{4}-\d{2}$/.test(r.spendMonth) ? r.spendMonth : null,
  };
}

const EPOCH_ISO = new Date(0).toISOString();

/** The youngest bracket, used whenever stored age data is missing-but-decided, damaged or unverifiable. */
export function failClosedProfile(decidedAt: string | null): AgeProfile {
  return { bracket: 'under13', decidedAt: decidedAt ?? EPOCH_ISO, spendCapCents: 0, spentThisMonthCents: 0, spendMonth: null };
}

// ───────────────────────── sealed storage (D-2) ─────────────────────────

export const AGE_RECORD_VERSION = 2;
/**
 * Revision of the age rules a stored bracket was decided under. 1 (or absent) = child limit 13; 2 = child limit 15
 * (owner, 2026-11-11). Only the bracket is stored, never the age, so a 'teen' decided under revision 1 may be 13 or
 * 14: it cannot be split, and is treated as a child profile until the parental / account flow can raise it.
 */
export const AGE_POLICY = 2;
const SALT_RE = /^[0-9a-f]{32,64}$/;
const SEAL_RE = /^[0-9a-f]{64}$/;

/** Separate profile record: "a bracket was decided on this install" + the seal salt. */
export interface AgeSentinel {
  v: 1;
  decided: true;
  salt: string;
}

/** What is written under PROFILE_KEYS.age (v2). */
export interface StoredAgeRecord extends AgeProfile {
  v: typeof AGE_RECORD_VERSION;
  /** AGE_POLICY the bracket was decided under (absent on records written before revision 2). */
  agePolicy?: number;
  seal: string;
}

/** `policy` undefined = the body of a record written before the age-policy field existed. */
function sealBody(p: AgeProfile, salt: string, policy: number | undefined): string {
  if (policy !== undefined) return canonicalJson({ agePolicy: policy, bracket: p.bracket, decidedAt: p.decidedAt, salt, spendCapCents: p.spendCapCents, spendMonth: p.spendMonth, spentThisMonthCents: p.spentThisMonthCents, v: AGE_RECORD_VERSION });
  return canonicalJson({ bracket: p.bracket, decidedAt: p.decidedAt, salt, spendCapCents: p.spendCapCents, spendMonth: p.spendMonth, spentThisMonthCents: p.spentThisMonthCents, v: AGE_RECORD_VERSION });
}

export async function sealAgeProfile(p: AgeProfile, salt: string): Promise<StoredAgeRecord> {
  return { ...p, v: AGE_RECORD_VERSION, agePolicy: AGE_POLICY, seal: await sha256Hex(sealBody(p, salt, AGE_POLICY)) };
}

export function isSentinel(v: unknown): v is AgeSentinel {
  const r = v as Record<string, unknown> | null;
  return !!r && typeof r === 'object' && r.decided === true && typeof r.salt === 'string' && SALT_RE.test(r.salt);
}

export type AgeSource = 'fresh' | 'stored' | 'legacy' | 'failClosed';

export interface ResolvedAge {
  profile: AgeProfile;
  source: AgeSource;
  /** Why it failed closed (diagnostics), null otherwise. */
  reason: string | null;
}

/** A genuine 'teen' record decided when the child limit was 13: it may be a 13- or 14-year-old, so it is a child profile now. */
function earlierLimitTeen(p: AgeProfile): ResolvedAge {
  return { profile: failClosedProfile(p.decidedAt), source: 'failClosed', reason: `teen bracket was decided under the earlier age limit (now ${CHILD_AGE_LIMIT})` };
}

/**
 * Resolve the bracket from what the profile store returned (each `null` when missing OR damaged — the ProfileStore
 * cannot tell them apart, so both are treated as "gone"). Pure apart from hashing; never throws.
 */
export async function resolveStoredAge(input: { record: unknown; sentinel: unknown; prefsDecided: boolean }): Promise<ResolvedAge> {
  const { record, sentinel, prefsDecided } = input;
  const marker = isSentinel(sentinel) || prefsDecided;
  const fail = (reason: string): ResolvedAge => ({ profile: failClosedProfile(null), source: 'failClosed', reason });
  try {
    if (record === null || record === undefined) return marker ? fail('age record missing or damaged') : { profile: { ...DEFAULT_AGE_PROFILE }, source: 'fresh', reason: null };
    if (typeof record !== 'object' || Array.isArray(record)) return fail('age record damaged');
    const r = record as Record<string, unknown>;
    if (r.v === undefined && r.seal === undefined) {
      // Pre-seal record (written before the seal existed). Accepted once, on an install that never wrote a marker.
      if (marker) return fail('unsealed age record on a sealed install');
      const p = sanitizeAgeProfile(r);
      if (p.bracket === 'teen') return earlierLimitTeen(p);
      return { profile: p, source: p.bracket === 'under13' && r.bracket !== 'under13' ? 'failClosed' : 'legacy', reason: null };
    }
    if (r.v !== AGE_RECORD_VERSION || typeof r.seal !== 'string' || !SEAL_RE.test(r.seal)) return fail('age record has an unknown format');
    if (!isSentinel(sentinel)) return fail('age record cannot be verified');
    const p = sanitizeAgeProfile(r);
    // The seal covers the record AS STORED: a sanitised value that differs means an edit (or damage).
    if (p.bracket !== r.bracket || p.decidedAt !== r.decidedAt || p.spendCapCents !== r.spendCapCents) return fail('age record failed its integrity check');
    const policy = r.agePolicy;
    if (policy !== undefined && policy !== AGE_POLICY) return fail('age record was written under an unknown age policy');
    const expect = await sha256Hex(sealBody(p, sentinel.salt, policy));
    if (expect !== r.seal) return fail('age record failed its integrity check');
    if (policy === undefined && p.bracket === 'teen') return earlierLimitTeen(p);
    return { profile: p, source: 'stored', reason: null };
  } catch {
    return fail('age record could not be read');
  }
}

/**
 * Parental / account authorisation seam (Phase 4: a parent account with verified consent, server-side). Offline
 * there is no parent account, so `NO_PARENT_GATE` fails closed: moving to an older bracket and changing the teen
 * spend cap are refused.
 */
export interface ParentGate {
  /** A parent/guardian account is linked to this profile. */
  readonly configured: boolean;
  /** Ask the parent to approve `action`; resolves false on any doubt. */
  authorize(action: { kind: 'spendCap'; cents: number } | { kind: 'olderBracket'; to: Exclude<AgeBracket, 'unknown'> }): Promise<boolean>;
}

export const NO_PARENT_GATE: ParentGate = Object.freeze({ configured: false, authorize: () => Promise.resolve(false) });

/** Bracket change that needs the parent gate (any move to an older bracket once one is set). */
export function needsParentFor(cur: AgeProfile, next: Exclude<AgeBracket, 'unknown'>): boolean {
  return cur.bracket !== 'unknown' && ORDER[next] > ORDER[cur.bracket];
}

/** Teen cap value change (pure). The SERVICE only applies it after the ParentGate approved (fails closed offline). */
export function setSpendCap(cur: AgeProfile, cents: number): AgeProfile {
  if (cur.bracket === 'under13') return { ...cur, spendCapCents: 0 };
  return { ...cur, spendCapCents: clampCap(cents) };
}

export type PurchaseBlock = 'ageGate' | 'under13' | 'ageMin' | 'cap' | 'signIn';

/**
 * Whether a real-money / GG SKU may proceed to checkout. In this offline build the final answer is always
 * 'signIn' (Phase 4), but the age checks run first so the UI explains the real reason to minors.
 */
export function realMoneyBlock(sku: StoreSku, age: AgeProfile, signedIn: boolean): PurchaseBlock | null {
  if (age.bracket === 'unknown') return 'ageGate';
  if (age.bracket === 'under13') return 'under13';
  const years = age.bracket === 'adult' ? 18 : CHILD_AGE_LIMIT;
  if (sku.ageMin > years) return 'ageMin';
  if (age.bracket === 'teen' && sku.priceUsdCents !== undefined && age.spentThisMonthCents + sku.priceUsdCents > age.spendCapCents) return 'cap';
  if (!signedIn) return 'signIn';
  return null;
}

/** Bones unlocks are earned-currency only: allowed for every answered bracket (gate must be answered first). */
export function bonesBlock(sku: StoreSku, age: AgeProfile): PurchaseBlock | null {
  if (age.bracket === 'unknown') return 'ageGate';
  const years = age.bracket === 'adult' ? 18 : age.bracket === 'teen' ? CHILD_AGE_LIMIT : 0;
  if (sku.ageMin > years) return 'ageMin';
  return null;
}

/** Opt-in rewarded ads: never under-13, never unanswered, at most 5 a day. */
export function rewardedAdAllowed(age: AgeProfile, watchedToday: number): boolean {
  if (age.bracket !== 'teen' && age.bracket !== 'adult') return false;
  return Number.isInteger(watchedToday) && watchedToday >= 0 && watchedToday < REWARDED_ADS_PER_DAY;
}
