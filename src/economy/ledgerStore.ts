/**
 * Crash-safe, cross-window-safe persistence for the Bones ledger (docs/MONETIZATION.md §2).
 *
 * Storage (the game's shared StorageBackend — IndexedDB / localStorage / Electron atomic files / memory):
 *   economy:ledger:primary   current record   { format, v, entries[], count, headHash, sha256 }
 *   economy:ledger:backup    the previous GOOD record (rotated before every overwrite — the ProfileStore pattern)
 *   economy:ledger:quarantine  the last damaged record we replaced (diagnostics only; never read back as data)
 * plus a high-water mark { count, headHash } in the ProfileStore (key `economy-ledger-hwm`), written AFTER the ledger,
 * so a TRUNCATED ledger (entries chopped off the end, chain still valid) is detected: count < hwm.count.
 *
 * Every mutation runs inside `exclusive()`: an in-page Mutex + the cross-window LockProvider (Web Locks in browsers),
 * and RE-READS storage inside the lock, so two windows granting the same quest at once produce exactly one entry
 * (the second sees the first's key and gets `duplicate`). Backend writes are atomic per the StorageBackend contract;
 * the rotate-then-write order means a crash at any point leaves either the old or the new record readable, and a torn
 * primary (non-atomic backend) falls back to the backup.
 *
 * Load never throws: it reports `status` ('ok' | 'recovered' | 'corrupt' | 'empty' | 'unavailable' = could not READ —
 * an I/O error is never mistaken for a missing ledger, and nothing is written until storage reads again) and keeps the longest
 * verifying data it can find. Corruption is surfaced (WalletView.ledgerOk = false), never silently "fixed".
 */
import type { LedgerEntry } from '../shared/economy';
import type { ProfileStore, StorageBackend } from '../persistence/contracts';
import { utf8DecodeStrict, utf8Encode } from '../persistence/bytes';
import { canonicalJson } from '../persistence/canonicalJson';
import { errorMessage } from '../persistence/errors';
import { Mutex, noLocks, type LockProvider } from '../persistence/locks';
import { SHA256_HEX_RE, sha256Hex } from '../persistence/sha256';
import { GENESIS_HASH, applyEntry, isoNow, planAppend, verifyChain, type AppendRequest, type ChainIssue, type LedgerTotals } from './ledger';

export const LEDGER_FORMAT = 'afterlife-lease-ledger';
export const LEDGER_KEYS = { primary: 'economy:ledger:primary', backup: 'economy:ledger:backup', quarantine: 'economy:ledger:quarantine' } as const;
export const HWM_PROFILE_KEY = 'economy-ledger-hwm';
export const LEDGER_LOCK = 'afterlife-lease:economy-ledger';
const MAX_RECORD_BYTES = 8 * 1024 * 1024;

/** 'unavailable' = storage could not be READ (I/O error, not corruption): nothing is written until it can be. */
export type LedgerStatus = 'empty' | 'ok' | 'recovered' | 'corrupt' | 'unavailable';

export interface LedgerState {
  /** Always 'local-unverified': an unkeyed local chain is never authoritative (M-1; see ledgerTrust.ts). */
  trust: 'local-unverified';
  entries: LedgerEntry[];
  totals: LedgerTotals;
  headHash: string;
  status: LedgerStatus;
  /** Human-readable problems found on the last load (empty when healthy). */
  issues: string[];
}

export type AppendResult =
  | { ok: true; entry: LedgerEntry; state: LedgerState }
  | { ok: false; code: 'duplicate' | 'invalid' | 'insufficient' | 'capped' | 'serverOnly' | 'full' | 'io' | 'busy'; message: string; state: LedgerState };

interface Hwm {
  count: number;
  headHash: string;
}

type Decoded = { ok: true; entries: LedgerEntry[]; check: Awaited<ReturnType<typeof verifyChain>> } | { ok: false; error: string; partial: unknown[] | null };

async function encodeRecord(entries: readonly LedgerEntry[], headHash: string): Promise<Uint8Array> {
  const body = { format: LEDGER_FORMAT, v: 1, count: entries.length, headHash, entries };
  const text = canonicalJson(body);
  const sha = await sha256Hex(text);
  return utf8Encode(`${text.slice(0, -1)},"sha256":"${sha}"}`);
}

async function decodeRecord(bytes: Uint8Array | null): Promise<Decoded | null> {
  if (!bytes) return null;
  try {
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_RECORD_BYTES) return { ok: false, error: 'bad size', partial: null };
    const parsed: unknown = JSON.parse(utf8DecodeStrict(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'not a ledger record', partial: null };
    const rec = parsed as Record<string, unknown>;
    if (rec.format !== LEDGER_FORMAT || rec.v !== 1) return { ok: false, error: 'not a ledger record', partial: null };
    const entries = Array.isArray(rec.entries) ? (rec.entries as unknown[]) : null;
    const sha = rec.sha256;
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) if (k !== 'sha256') body[k] = v;
    if (typeof sha !== 'string' || !SHA256_HEX_RE.test(sha) || (await sha256Hex(canonicalJson(body))) !== sha) {
      return { ok: false, error: 'record checksum mismatch', partial: entries };
    }
    if (!entries) return { ok: false, error: 'missing entries', partial: null };
    const check = await verifyChain(entries);
    if (!check.ok) return { ok: false, error: `hash chain broken at entry ${check.at + 1} (${check.issue})`, partial: entries };
    if (rec.count !== entries.length || rec.headHash !== check.headHash) return { ok: false, error: 'record header does not match its entries', partial: entries };
    return { ok: true, entries: entries as LedgerEntry[], check };
  } catch (e) {
    return { ok: false, error: `unreadable (${errorMessage(e)})`, partial: null };
  }
}

function emptyState(status: LedgerStatus, issues: string[] = []): LedgerState {
  return { trust: 'local-unverified', entries: [], totals: { bones: 0, entitlements: new Set(), keys: new Set() }, headHash: GENESIS_HASH, status, issues };
}

export interface LedgerStoreOptions {
  backend: () => Promise<StorageBackend>;
  /** High-water-mark store (the game's ProfileStore). */
  profile: ProfileStore;
  /** Cross-window lock (default: none — callers pass webLocks() in browsers). */
  locks?: LockProvider;
  now?: () => number;
  logger?: { warn(...a: unknown[]): void };
}

export class LedgerStore {
  private readonly mutex = new Mutex();
  private readonly locks: LockProvider;
  private readonly now: () => number;
  private readonly log: { warn(...a: unknown[]): void };
  private last: LedgerState = emptyState('empty');

  constructor(private readonly opts: LedgerStoreOptions) {
    this.locks = opts.locks ?? noLocks;
    this.now = opts.now ?? (() => Date.now());
    this.log = opts.logger ?? console;
  }

  /** Last state seen by this instance (loaded or written). */
  get state(): LedgerState {
    return this.last;
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    return this.mutex.run(() => this.locks.run(LEDGER_LOCK, fn, { timeoutMs: 15_000 }));
  }

  /** Load (under the lock, so a write in another window is never observed half-done). Never throws. */
  async load(): Promise<LedgerState> {
    try {
      return await this.exclusive(() => this.readLocked(true));
    } catch (e) {
      this.log.warn('[economy] ledger load failed:', e);
      // Keep what this instance last saw; a never-loaded instance reports 'unavailable' (not 'empty': data may exist).
      const s: LedgerState = { ...this.last, status: this.last.status === 'empty' ? 'unavailable' : this.last.status, issues: [`could not open the Bones ledger (${errorMessage(e)})`] };
      this.last = s;
      return s;
    }
  }

  /**
   * Append one entry atomically + idempotently (re-reads storage under the lock first). `req` may be a function of the
   * freshly read state (e.g. a price that depends on what is already owned); returning a failure from it aborts
   * without writing. Never throws.
   */
  async append(req: AppendRequest | ((s: LedgerState) => AppendRequest | { fail: 'duplicate' | 'invalid' | 'insufficient' | 'capped'; message: string })): Promise<AppendResult> {
    try {
      return await this.exclusive(async () => {
        const cur = await this.readLocked(true);
        const r = typeof req === 'function' ? req(cur) : req;
        if ('fail' in r) return { ok: false, code: r.fail, message: r.message, state: cur };
        const plan = await planAppend(cur.entries, cur.totals, cur.headHash, r, isoNow(this.now()));
        if (!plan.ok) return { ok: false, code: plan.code, message: plan.message, state: cur };
        const entries = [...cur.entries, plan.entry];
        await this.writeLocked(entries, plan.entry.hash);
        const totals: LedgerTotals = { bones: cur.totals.bones, entitlements: new Set(cur.totals.entitlements), keys: new Set(cur.totals.keys) };
        applyEntry(totals, plan.entry);
        this.last = { trust: 'local-unverified', entries, totals, headHash: plan.entry.hash, status: cur.status === 'empty' ? 'ok' : cur.status, issues: cur.issues };
        return { ok: true, entry: plan.entry, state: this.last };
      });
    } catch (e) {
      const busy = (e as { code?: unknown })?.code === 'busy';
      this.log.warn('[economy] ledger append failed:', e);
      return { ok: false, code: busy ? 'busy' : 'io', message: errorMessage(e), state: this.last };
    }
  }

  private async readLocked(repair: boolean): Promise<LedgerState> {
    const backend = await this.opts.backend();
    // A read that THROWS is an I/O failure, not a missing or damaged record: propagate it, so load() reports
    // 'unavailable' and append() fails with 'io' (retried) — treating it as "no ledger" would let the next append
    // write a fresh one-entry chain over the player's whole history (and lower the high-water mark to match).
    const read = (k: string) => backend.read(k);
    const [pBytes, bBytes] = [await read(LEDGER_KEYS.primary), await read(LEDGER_KEYS.backup)];
    const [primary, backup] = [await decodeRecord(pBytes), await decodeRecord(bBytes)];
    const hwm = await this.opts.profile.load<Hwm>(HWM_PROFILE_KEY, { count: 0, headHash: GENESIS_HASH });
    const hwmCount = Number.isSafeInteger(hwm.count) && hwm.count > 0 ? hwm.count : 0;
    const issues: string[] = [];

    type Good = Extract<Decoded, { ok: true }>;
    const good = (d: Decoded | null): Good | null => (d && d.ok ? d : null);
    /** `slack` = how many trailing entries may be missing (the backup is the state BEFORE the last write). */
    const consistent = (d: Decoded | null, slack = 0): boolean => {
      if (!d || !d.ok) return false;
      if (d.entries.length < hwmCount - slack) return false;
      if (hwmCount > 0 && d.entries.length >= hwmCount && d.entries[hwmCount - 1]?.hash !== hwm.headHash) return false;
      return true;
    };

    if (!primary && !backup) {
      if (hwmCount > 0) {
        issues.push(`the Bones ledger is missing (expected ${hwmCount} entries)`);
        this.last = emptyState('corrupt', issues);
      } else this.last = emptyState('empty');
      return this.last;
    }
    const gp = good(primary);
    if (gp && consistent(gp)) {
      this.last = { trust: 'local-unverified', entries: gp.entries, totals: gp.check.totals, headHash: gp.check.headHash, status: 'ok', issues };
      return this.last;
    }
    issues.push(primary ? (primary.ok ? `the Bones ledger was truncated (${primary.entries.length} of ${hwmCount} entries)` : `the Bones ledger is damaged: ${primary.error}`) : 'the Bones ledger is missing');
    const gb = good(backup);
    if (gb && consistent(gb, 1)) {
      issues.push(`restored from the backup copy (${gb.entries.length} entries)${gb.entries.length < hwmCount ? '; the most recent entry was lost and will be re-earned where possible' : ''}`);
      this.last = { trust: 'local-unverified', entries: gb.entries, totals: gb.check.totals, headHash: gb.check.headHash, status: 'recovered', issues };
      if (repair) await this.restoreLocked(pBytes, gb.entries, gb.check.headHash);
      return this.last;
    }
    // Neither copy is fully trustworthy: keep the longest verifying prefix we can find, flag it as corrupt.
    let best: { entries: LedgerEntry[]; totals: LedgerTotals; head: string } = { entries: [], totals: emptyState('empty').totals, head: GENESIS_HASH };
    for (const d of [primary, backup]) {
      if (!d) continue;
      const list = d.ok ? d.entries : d.partial;
      if (!list) continue;
      const check = await verifyChain(list);
      const n = check.ok ? list.length : check.validPrefix;
      if (n > best.entries.length) {
        const prefix = (list as LedgerEntry[]).slice(0, n);
        const again = await verifyChain(prefix);
        best = { entries: prefix, totals: again.totals, head: again.headHash };
      }
    }
    if (backup && !backup.ok) issues.push(`the backup copy is damaged too: ${backup.error}`);
    issues.push(`kept ${best.entries.length} verified entries`);
    this.last = { trust: 'local-unverified', entries: best.entries, totals: best.totals, headHash: best.head, status: 'corrupt', issues };
    return this.last;
  }

  /** Put a good copy back as primary (the damaged bytes go to quarantine for diagnostics). */
  private async restoreLocked(bad: Uint8Array | null, entries: LedgerEntry[], head: string): Promise<void> {
    try {
      const backend = await this.opts.backend();
      if (bad) await backend.write(LEDGER_KEYS.quarantine, bad);
      await backend.write(LEDGER_KEYS.primary, await encodeRecord(entries, head));
      // The loss was reported once (issues); the restored copy is the new baseline.
      await this.opts.profile.save<Hwm>(HWM_PROFILE_KEY, { count: entries.length, headHash: head });
    } catch (e) {
      this.log.warn('[economy] could not restore the ledger from backup:', e);
    }
  }

  private async writeLocked(entries: readonly LedgerEntry[], head: string): Promise<void> {
    const backend = await this.opts.backend();
    const record = await encodeRecord(entries, head);
    // Self-check: never replace a readable record with one this build could not read back.
    const check = await decodeRecord(record);
    if (!check || !check.ok) throw new Error(`ledger record failed its self-check (${check && !check.ok ? check.error : 'empty'})`);
    // Read errors propagate (see readLocked): never overwrite a primary we could not look at.
    const existing = await backend.read(LEDGER_KEYS.primary);
    const prev = await decodeRecord(existing);
    if (existing && prev && prev.ok) await backend.write(LEDGER_KEYS.backup, existing);
    // A damaged primary about to be replaced is kept for diagnostics (never read back as data).
    else if (existing) await backend.write(LEDGER_KEYS.quarantine, existing);
    await backend.write(LEDGER_KEYS.primary, record);
    // High-water mark last: a crash before this line leaves hwm ≤ count, which load accepts.
    try {
      await this.opts.profile.save<Hwm>(HWM_PROFILE_KEY, { count: entries.length, headHash: head });
    } catch (e) {
      this.log.warn('[economy] could not record the ledger high-water mark (truncation detection weakened):', e);
    }
  }
}

export type { ChainIssue };
