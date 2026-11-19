/**
 * CAZ validation adapter: prefers the controller's structured `validateCazDetailed()` (inline, per member/field) and
 * falls back to the flat `validateCaz()` list. Never throws.
 */
import type { GameController } from '../../game/contracts';

/** Mirrors the contract's `validateCazDetailed()` field union (GameController, decision #19). */
export type CazField = 'household' | 'householdName' | 'firstName' | 'lastName' | 'traits' | 'aspiration' | 'appearance';
export interface CazIssue {
  memberIndex: number | null;
  field: CazField;
  message: string;
}
export interface CazIssues {
  /** Every message, in controller order. */
  all: string[];
  /** Household-level (field householdName / no member). */
  household: CazIssue[];
  /** Per member index. */
  byMember: Record<number, CazIssue[]>;
  /** True when inline (structured) data was available. */
  detailed: boolean;
}

const FIELDS: readonly CazField[] = ['household', 'householdName', 'firstName', 'lastName', 'traits', 'aspiration', 'appearance'];

/** Unknown fields must not be pinned under an input: household-level → 'household', member-level → 'appearance'. */
function normalizeField(field: unknown, memberIndex: number | null): CazField {
  if (typeof field === 'string' && (FIELDS as readonly string[]).includes(field)) return field as CazField;
  return memberIndex === null ? 'household' : 'appearance';
}

type Validator = Partial<Pick<GameController, 'validateCaz' | 'validateCazDetailed'>>;

export function collectCazIssues(game: Validator): CazIssues {
  const out: CazIssues = { all: [], household: [], byMember: {}, detailed: false };
  let detailed: unknown = null;
  try {
    detailed = typeof game.validateCazDetailed === 'function' ? game.validateCazDetailed() : null;
  } catch {
    detailed = null;
  }
  if (Array.isArray(detailed)) {
    out.detailed = true;
    for (const raw of detailed) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Partial<CazIssue>;
      if (typeof r.message !== 'string' || r.message.length === 0) continue;
      const idx = typeof r.memberIndex === 'number' && Number.isInteger(r.memberIndex) && r.memberIndex >= 0 ? r.memberIndex : null;
      let field = normalizeField(r.field, idx);
      // Member fields reported without a member (and vice versa) are re-homed so they still show somewhere sensible.
      if (idx === null && field !== 'household' && field !== 'householdName') field = 'household';
      if (idx !== null && (field === 'household' || field === 'householdName')) field = 'appearance';
      const issue: CazIssue = { memberIndex: idx, field, message: r.message };
      out.all.push(issue.message);
      if (idx === null) out.household.push(issue);
      else (out.byMember[idx] ??= []).push(issue);
    }
    return out;
  }
  try {
    const flat = typeof game.validateCaz === 'function' ? game.validateCaz() : [];
    if (Array.isArray(flat)) for (const m of flat) if (typeof m === 'string' && m.length > 0) out.all.push(m);
  } catch (err) {
    out.all.push(err instanceof Error ? err.message : String(err));
  }
  return out;
}

/** The editor tab that fixes a member field (null for household-level fields, which live outside the tabs). */
export function tabForField(field: CazField): 'identity' | 'body' | 'personality' | null {
  switch (field) {
    case 'traits':
    case 'aspiration':
      return 'personality';
    case 'appearance':
      return 'body';
    case 'firstName':
    case 'lastName':
      return 'identity';
    default:
      return null;
  }
}

/** Household-level messages without an input of their own (lot, difficulty, member count…). */
export function generalHouseholdIssues(issues: CazIssues): string[] {
  return issues.household.filter((i) => i.field === 'household').map((i) => i.message);
}

/** First issue to jump to: household first, then the lowest member index. */
export function firstIssue(issues: CazIssues): CazIssue | null {
  if (issues.household.length) return issues.household[0];
  const keys = Object.keys(issues.byMember)
    .map(Number)
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
  for (const k of keys) if (issues.byMember[k]?.length) return issues.byMember[k][0];
  return null;
}
