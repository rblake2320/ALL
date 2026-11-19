/**
 * Bones profile ledger — PURE core (no I/O). docs/MONETIZATION.md §2, contract `LedgerEntry` in src/shared/economy.ts.
 *
 * Append-only, hash-chained entries:
 *   hash = SHA-256(canonicalJson(entry without `hash`))   (entry includes prevHash, so the chain covers order)
 *   entry[0].prevHash = GENESIS_HASH; entry[i].prevHash = entry[i-1].hash; seq = i + 1 (contiguous).
 * Idempotency: every entry carries a unique `key` (grants: grantId; spends: `spend:<sku>:<nonce>`); a duplicate key is
 * refused by `planAppend`, and a chain containing one fails verification.
 *
 * Local scope (§1): the client ledger holds BONES ONLY. Grave Gold is server-authoritative — a local chain that
 * contains any `gg` entry is rejected as tampered, and `planAppend` refuses to mint one. Likewise `planAppend` refuses
 * entitlements that are sold only for GG / real money (src/economy/entitlements.ts), and the wallet ignores them if a
 * hand-edited chain carries one.
 * The checksums detect corruption and naive edits; they are NOT tamper-proofing (a single-player client cannot keep a
 * secret). The server ledger (Phase 4) is the authority.
 */
import type { Currency, LedgerEntry } from '../shared/economy';
import { ENTITLEMENT_ID_RE } from '../shared/economy';
import { canonicalJson } from '../persistence/canonicalJson';
import { SHA256_HEX_RE, sha256Hex } from '../persistence/sha256';
import { isServerOnlyEntitlement } from './entitlements';

export const GENESIS_HASH = '0'.repeat(64);
/** Upper bound for one entry (a grant/spend larger than this is a bug or an edit). */
export const MAX_ENTRY_AMOUNT = 100_000;
/** Hard cap on chain length kept locally (≈ years of play); appends beyond are refused, never truncated. */
export const MAX_LEDGER_ENTRIES = 20_000;
export const KEY_RE = /^[A-Za-z0-9:_.\-]{1,160}$/;
/** Entitlement id grammar — the shared contract (src/shared/economy.ts), never a local copy. */
export const ENTITLEMENT_RE = ENTITLEMENT_ID_RE;
const KINDS: ReadonlySet<LedgerEntry['kind']> = new Set(['grant', 'spend', 'refund', 'revoke']);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export type UnsignedEntry = Omit<LedgerEntry, 'hash'>;

/** Hash of an entry body (everything except `hash`). Optional fields that are undefined are omitted. */
export async function entryHash(e: UnsignedEntry): Promise<string> {
  const body: Record<string, unknown> = {
    seq: e.seq,
    ts: e.ts,
    kind: e.kind,
    currency: e.currency,
    amount: e.amount,
    key: e.key,
    reason: e.reason,
    prevHash: e.prevHash,
  };
  if (e.entitlements !== undefined) body.entitlements = e.entitlements;
  return sha256Hex(canonicalJson(body));
}

export interface LedgerTotals {
  bones: number;
  entitlements: Set<string>;
  keys: Set<string>;
}

export type ChainIssue =
  | 'shape'
  | 'seq'
  | 'prevHash'
  | 'hash'
  | 'duplicateKey'
  | 'serverCurrency'
  | 'overdraft'
  | 'tooLong';

export interface ChainCheck {
  ok: boolean;
  /** Number of leading entries that verify (the trustworthy prefix). */
  validPrefix: number;
  issue: ChainIssue | null;
  /** Index of the first bad entry (−1 when ok). */
  at: number;
  totals: LedgerTotals;
  headHash: string;
}

function isShape(v: unknown): v is LedgerEntry {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const e = v as Record<string, unknown>;
  for (const k of Object.keys(e)) {
    if (!['seq', 'ts', 'kind', 'currency', 'amount', 'key', 'reason', 'entitlements', 'prevHash', 'hash'].includes(k)) return false;
  }
  if (!Number.isSafeInteger(e.seq) || (e.seq as number) < 1) return false;
  if (typeof e.ts !== 'string' || !ISO_RE.test(e.ts)) return false;
  if (typeof e.kind !== 'string' || !KINDS.has(e.kind as LedgerEntry['kind'])) return false;
  if (e.currency !== 'bones' && e.currency !== 'gg') return false;
  if (!Number.isSafeInteger(e.amount) || (e.amount as number) < 0 || (e.amount as number) > MAX_ENTRY_AMOUNT) return false;
  if (typeof e.key !== 'string' || !KEY_RE.test(e.key)) return false;
  if (typeof e.reason !== 'string' || e.reason.length > 200) return false;
  if (e.entitlements !== undefined) {
    if (!Array.isArray(e.entitlements) || e.entitlements.length > 64) return false;
    if (!e.entitlements.every((x) => typeof x === 'string' && ENTITLEMENT_RE.test(x))) return false;
  }
  if (typeof e.prevHash !== 'string' || !SHA256_HEX_RE.test(e.prevHash)) return false;
  if (typeof e.hash !== 'string' || !SHA256_HEX_RE.test(e.hash)) return false;
  return true;
}

/** Apply one (already verified) entry to running totals. Returns false on overdraft. */
function apply(t: LedgerTotals, e: LedgerEntry): boolean {
  t.keys.add(e.key);
  switch (e.kind) {
    case 'grant':
    case 'refund':
      t.bones += e.amount;
      if (e.kind === 'grant') for (const x of e.entitlements ?? []) t.entitlements.add(x);
      if (e.kind === 'refund') for (const x of e.entitlements ?? []) t.entitlements.delete(x);
      return true;
    case 'spend':
      if (e.amount > t.bones) return false;
      t.bones -= e.amount;
      for (const x of e.entitlements ?? []) t.entitlements.add(x);
      return true;
    case 'revoke':
      // A revoke takes Bones back (capped at the balance: a revoke can never make it negative) and entitlements.
      t.bones -= Math.min(t.bones, e.amount);
      for (const x of e.entitlements ?? []) t.entitlements.delete(x);
      return true;
  }
}

export function emptyTotals(): LedgerTotals {
  return { bones: 0, entitlements: new Set(), keys: new Set() };
}

/** Verify a whole chain; never throws. Reports the longest verifying prefix so recovery can keep it. */
export async function verifyChain(entries: unknown): Promise<ChainCheck> {
  const totals = emptyTotals();
  const fail = (issue: ChainIssue, at: number, head: string): ChainCheck => ({ ok: false, validPrefix: at, issue, at, totals, headHash: head });
  if (!Array.isArray(entries)) return fail('shape', 0, GENESIS_HASH);
  if (entries.length > MAX_LEDGER_ENTRIES) return fail('tooLong', 0, GENESIS_HASH);
  let prev = GENESIS_HASH;
  for (let i = 0; i < entries.length; i++) {
    const e: unknown = entries[i];
    if (!isShape(e)) return fail('shape', i, prev);
    if (e.seq !== i + 1) return fail('seq', i, prev);
    if (e.prevHash !== prev) return fail('prevHash', i, prev);
    const { hash, ...body } = e;
    if ((await entryHash(body)) !== hash) return fail('hash', i, prev);
    if (e.currency !== 'bones') return fail('serverCurrency', i, prev);
    if (totals.keys.has(e.key)) return fail('duplicateKey', i, prev);
    const snapshot = { bones: totals.bones, ents: new Set(totals.entitlements) };
    if (!apply(totals, e)) {
      totals.bones = snapshot.bones;
      totals.entitlements = snapshot.ents;
      return fail('overdraft', i, prev);
    }
    prev = hash;
  }
  return { ok: true, validPrefix: entries.length, issue: null, at: -1, totals, headHash: prev };
}

export interface AppendRequest {
  kind: LedgerEntry['kind'];
  currency: Currency;
  amount: number;
  key: string;
  reason: string;
  entitlements?: string[];
}

export type AppendPlan =
  | { ok: true; entry: LedgerEntry }
  | { ok: false; code: 'duplicate' | 'invalid' | 'insufficient' | 'serverOnly' | 'full'; message: string };

/** Clean a free-text reason for storage (control chars removed, ≤ 120 chars). */
export function cleanReason(r: unknown): string {
  const s = typeof r === 'string' ? r : '';
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120);
}

/**
 * Build the next entry for a verified chain (totals/headHash from verifyChain). Pure + deterministic for a given
 * `ts`. Refuses duplicates, GG (server-only), non-positive or non-integer amounts and overdrafts.
 */
export async function planAppend(chain: readonly LedgerEntry[], totals: LedgerTotals, headHash: string, req: AppendRequest, ts: string): Promise<AppendPlan> {
  if (req.currency !== 'bones') return { ok: false, code: 'serverOnly', message: 'Grave Gold is handled by the server; this build cannot change it.' };
  if (!KINDS.has(req.kind)) return { ok: false, code: 'invalid', message: 'unknown entry kind' };
  if (typeof req.key !== 'string' || !KEY_RE.test(req.key)) return { ok: false, code: 'invalid', message: 'invalid idempotency key' };
  if (totals.keys.has(req.key)) return { ok: false, code: 'duplicate', message: 'already recorded' };
  if (!Number.isSafeInteger(req.amount) || req.amount < 0 || req.amount > MAX_ENTRY_AMOUNT) return { ok: false, code: 'invalid', message: 'amount must be a whole number of Bones' };
  if (req.amount === 0 && !(req.entitlements && req.entitlements.length > 0)) return { ok: false, code: 'invalid', message: 'an entry must move Bones or entitlements' };
  if (req.kind === 'spend' && req.amount > totals.bones) return { ok: false, code: 'insufficient', message: 'not enough Bones' };
  if (chain.length >= MAX_LEDGER_ENTRIES) return { ok: false, code: 'full', message: 'ledger is full' };
  if (!ISO_RE.test(ts)) return { ok: false, code: 'invalid', message: 'bad timestamp' };
  const ents = req.entitlements === undefined ? undefined : [...new Set(req.entitlements)].sort();
  if (ents && !ents.every((x) => ENTITLEMENT_RE.test(x))) return { ok: false, code: 'invalid', message: 'invalid entitlement id' };
  // Content sold only for Grave Gold / real money is a SERVER entitlement (§1): the local ledger never records it.
  if (ents && ents.some(isServerOnlyEntitlement)) return { ok: false, code: 'serverOnly', message: 'That item is sold for Grave Gold; only the server can grant it.' };
  const body: UnsignedEntry = {
    seq: chain.length + 1,
    ts,
    kind: req.kind,
    currency: 'bones',
    amount: req.amount,
    key: req.key,
    reason: cleanReason(req.reason),
    ...(ents ? { entitlements: ents } : {}),
    prevHash: headHash,
  };
  return { ok: true, entry: { ...body, hash: await entryHash(body) } };
}

/** Apply a freshly planned entry to totals (caller has already verified it via planAppend). */
export function applyEntry(totals: LedgerTotals, e: LedgerEntry): void {
  apply(totals, e);
}

/** ISO timestamp with millisecond precision, clamped to a sane range (clock garbage never breaks the chain). */
export function isoNow(ms: number): string {
  const v = Number.isFinite(ms) && ms > 0 && ms < 8.64e15 ? ms : 0;
  return new Date(v).toISOString();
}
