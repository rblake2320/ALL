/**
 * Write-ahead COMMAND JOURNAL (design §4.1): the sim is deterministic, so between two snapshots the only thing that
 * has to survive a crash is the ordered list of player commands (with the tick each was dispatched at) plus how far
 * time ran. Replaying that list onto the snapshot reproduces the lost seconds exactly.
 *
 * Storage layout (one namespace per world = its autosave slot id, e.g. `auto-00c0ffee`):
 *
 *   journal:<ns>:<epoch>:<seq8>     one CHUNK per flushed batch (append = a NEW key, never a rewrite)
 *
 * An EPOCH is the journal of one snapshot. Its `base` = { slotId, payloadSha256, tick } names that snapshot exactly,
 * so a journal can only ever replay onto its own snapshot (another save of the slot, an older backup, a different
 * world → no match → ignored). After every successful save the writer REBASES: it starts a fresh epoch (the commands
 * dispatched after the snapshot was taken carry over) and deletes the old epoch's chunks ("truncate/rotate").
 *
 * Entries are hash-chained: h_i = SHA-256(p_i | canonicalJson(body_i)), p_0 = SHA-256(canonicalJson({f, base, epoch})),
 * p_{i+1} = h_i. Each chunk also carries a SHA-256 over its own canonical text (catches torn/short writes on any
 * backend). Readers assemble entries by index across all chunks of the matching epoch (overlap from compaction or a
 * retried write is fine when identical) and stop at the first gap, bad hash, broken link, out-of-order tick or fork:
 * the result is always a verified PREFIX of what was written ("drop the corrupt tail, never block loading").
 * Checksums detect corruption, not tampering (a single-player client cannot hold a secret key).
 *
 * Bounded: at most `maxChunks` chunks per epoch — the next flush writes one compacted chunk (all entries) and then
 * removes the older ones; at most `maxEntries` entries per epoch (past that the epoch stops growing until the next
 * save rebases it — the snapshot itself is never at risk).
 *
 * Two-phase rebase (W-119): a save is STAGED before its snapshot write starts — `stage(base, mark)` opens the new
 * epoch at once and every later flush writes the staged epoch's chunk FIRST, then the current one (both up to the
 * same op). So whichever snapshot is in the slot when the page dies (the old one: the save never landed; the new one:
 * it landed but `rebase` had not run yet), a journal anchored to exactly that snapshot holds every flushed op. Without
 * it, ops flushed while the save was being written were durable only in the OLD epoch: a kill after the snapshot
 * landed but before the new epoch's first chunk lost all of them (up to the whole save latency, thumbnail included).
 * `rebase` with the same base + mark promotes the staged epoch (nothing rewritten); a failed save `unstage`s it (its
 * chunks name a snapshot that is not in the slot, so readers ignore them until the next purge removes them).
 *
 * Cross-window: only the holder of the per-namespace Web Lock (`afterlife-lease:journal:<backend>:<ns>`, held for the
 * whole session, acquired with ifAvailable) ever writes or deletes journal keys. A second window playing the same
 * world keeps its ops in memory and retries the lock; whoever acquires it purges epochs it does not own.
 * Every storage operation is counted by the persistence ActivityTracker, so the desktop quit flush waits for it.
 */
import type { StorageBackend } from './contracts';
import { utf8DecodeStrict, utf8Encode } from './bytes';
import { canonicalJson } from './canonicalJson';
import { errorMessage } from './errors';
import { type ActivityTracker, persistenceActivity } from './activity';
import { type LockProvider, noLocks, webLocks } from './locks';
import { SHA256_HEX_RE, sha256HexSync } from './sha256';

export const JOURNAL_PREFIX = 'journal:';
export const JOURNAL_FORMAT = 'afterlife-lease-journal';
export const JOURNAL_VERSION = 1;
export const DEFAULT_MAX_CHUNKS = 16;
export const DEFAULT_MAX_ENTRIES = 100_000;
/** A chunk bigger than this is refused on read (and never written: the epoch is marked full instead). */
export const MAX_CHUNK_BYTES = 8 * 1024 * 1024;

const NS_RE = /^[a-z0-9_-]{1,40}$/;
const EPOCH_RE = /^[0-9a-f]{16}$/;
const SEQ_DIGITS = 8;

export interface JournalBase {
  /** Slot holding the snapshot this epoch extends. */
  slotId: string;
  /** payloadSha256 of that snapshot's envelope. */
  payloadSha256: string;
  /** WorldState.tick of that snapshot. */
  tick: number;
}

/** What one entry records (hashed). `c` absent = a time marker ("the sim ran until tick t"). */
export interface JournalBody {
  /** Index within the epoch (0-based, dense). */
  i: number;
  /** sim tick at which the command was dispatched (or reached, for a marker). */
  t: number;
  /** Real play milliseconds since the snapshot (monotonic clock; never the wall clock). */
  at: number;
  /** The dispatched Command (JSON). */
  c?: unknown;
  /** Did the live dispatch succeed? Replays compare it to detect divergence. */
  ok?: boolean;
  /** Cheap world fingerprint at a marker (divergence check). */
  fp?: string;
}

export interface JournalEntry extends JournalBody {
  /** Previous entry's hash (the genesis hash for i = 0). */
  p: string;
  /** This entry's hash. */
  h: string;
}

export interface JournalChunk {
  ns: string;
  epoch: string;
  seq: number;
  base: JournalBase;
  /** Index of entries[0]. */
  first: number;
  entries: JournalEntry[];
  /** Wall clock at write (diagnostics only; never used for ordering). */
  wall: number;
}

export interface RecoveredJournal {
  ns: string;
  epoch: string;
  base: JournalBase;
  /** Verified prefix, in order. */
  entries: JournalEntry[];
  /** Highest chunk seq seen for this epoch (the next write uses a larger one). */
  maxSeq: number;
  /** Chunks of this epoch that were found. */
  chunkCount: number;
  /** Why the chain ended early (null = every stored entry verified). */
  stoppedBecause: string | null;
  /** Entries stored beyond the verified prefix (dropped). */
  droppedEntries: number;
  /** Damaged / foreign chunk problems (diagnostics). */
  problems: string[];
}

// ───────────────────────────── keys ─────────────────────────────

export function isJournalNamespace(ns: unknown): ns is string {
  return typeof ns === 'string' && NS_RE.test(ns);
}

export function journalPrefix(ns: string): string {
  return `${JOURNAL_PREFIX}${ns}:`;
}

export function chunkKey(ns: string, epoch: string, seq: number): string {
  return `${journalPrefix(ns)}${epoch}:${String(seq).padStart(SEQ_DIGITS, '0')}`;
}

export function parseChunkKey(key: string): { ns: string; epoch: string; seq: number } | null {
  const m = /^journal:([a-z0-9_-]{1,40}):([0-9a-f]{16}):(\d{8})$/.exec(key);
  if (!m) return null;
  return { ns: m[1], epoch: m[2], seq: Number(m[3]) };
}

// ───────────────────────────── hashing ─────────────────────────────

export function genesisHash(base: JournalBase, epoch: string): string {
  return sha256HexSync(canonicalJson({ f: JOURNAL_FORMAT, base: normBase(base), epoch }));
}

function bodyOf(e: JournalBody): JournalBody {
  const b: JournalBody = { i: e.i, t: e.t, at: e.at };
  if (e.c !== undefined) b.c = e.c;
  if (e.ok !== undefined) b.ok = e.ok;
  if (e.fp !== undefined) b.fp = e.fp;
  return b;
}

export function entryHash(prev: string, body: JournalBody): string {
  return sha256HexSync(`${prev}|${canonicalJson(bodyOf(body))}`);
}

/** Hash-chain `bodies` starting at `prev` (bodies[k].i must already be set). */
export function chainEntries(prev: string, bodies: readonly JournalBody[]): JournalEntry[] {
  const out: JournalEntry[] = [];
  let p = prev;
  for (const b of bodies) {
    const body = bodyOf(b);
    const h = entryHash(p, body);
    out.push({ ...body, p, h });
    p = h;
  }
  return out;
}

function normBase(b: JournalBase): JournalBase {
  return { slotId: b.slotId, payloadSha256: b.payloadSha256, tick: b.tick };
}

export function sameBase(a: JournalBase, b: JournalBase): boolean {
  return a.slotId === b.slotId && a.payloadSha256 === b.payloadSha256 && a.tick === b.tick;
}

function isBase(v: unknown): v is JournalBase {
  if (!v || typeof v !== 'object') return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.slotId === 'string' &&
    /^[a-z0-9_-]{1,40}$/.test(b.slotId) &&
    typeof b.payloadSha256 === 'string' &&
    SHA256_HEX_RE.test(b.payloadSha256) &&
    Number.isSafeInteger(b.tick) &&
    (b.tick as number) >= 0
  );
}

// ───────────────────────────── chunk codec ─────────────────────────────

export function encodeChunk(c: JournalChunk): Uint8Array {
  const body = {
    f: JOURNAL_FORMAT,
    v: JOURNAL_VERSION,
    ns: c.ns,
    epoch: c.epoch,
    seq: c.seq,
    base: normBase(c.base),
    first: c.first,
    entries: c.entries.map((e) => ({ ...bodyOf(e), p: e.p, h: e.h })),
    wall: Number.isFinite(c.wall) ? Math.floor(c.wall) : 0,
  };
  const text = canonicalJson(body);
  return utf8Encode(canonicalJson({ ...body, sha: sha256HexSync(text) }));
}

function isEntry(v: unknown): v is JournalEntry {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const e = v as Record<string, unknown>;
  return (
    Number.isSafeInteger(e.i) &&
    (e.i as number) >= 0 &&
    Number.isSafeInteger(e.t) &&
    (e.t as number) >= 0 &&
    typeof e.at === 'number' &&
    Number.isFinite(e.at) &&
    (e.ok === undefined || typeof e.ok === 'boolean') &&
    (e.fp === undefined || typeof e.fp === 'string') &&
    (e.c === undefined || (typeof e.c === 'object' && e.c !== null && typeof (e.c as { type?: unknown }).type === 'string')) &&
    typeof e.p === 'string' &&
    SHA256_HEX_RE.test(e.p) &&
    typeof e.h === 'string' &&
    SHA256_HEX_RE.test(e.h)
  );
}

/** Decode + verify one chunk. Any defect (torn bytes, bad checksum, wrong key, bad shape) → an error string. */
export function decodeChunk(bytes: Uint8Array, key: string): { ok: true; chunk: JournalChunk } | { ok: false; error: string } {
  const k = parseChunkKey(key);
  if (!k) return { ok: false, error: 'not a journal chunk key' };
  if (bytes.byteLength === 0) return { ok: false, error: 'empty chunk' };
  if (bytes.byteLength > MAX_CHUNK_BYTES) return { ok: false, error: 'chunk too large' };
  let raw: unknown;
  try {
    raw = JSON.parse(utf8DecodeStrict(bytes));
  } catch {
    return { ok: false, error: 'chunk is not JSON (torn write?)' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'chunk is not an object' };
  const o = raw as Record<string, unknown>;
  if (o.f !== JOURNAL_FORMAT) return { ok: false, error: 'not a journal chunk' };
  if (o.v !== JOURNAL_VERSION) return { ok: false, error: `unsupported journal version ${String(o.v)}` };
  const { sha, ...rest } = o;
  let text: string;
  try {
    text = canonicalJson(rest);
  } catch (e) {
    return { ok: false, error: `chunk is not canonical JSON: ${errorMessage(e)}` };
  }
  if (typeof sha !== 'string' || sha256HexSync(text) !== sha) return { ok: false, error: 'chunk checksum mismatch' };
  if (o.ns !== k.ns || o.epoch !== k.epoch || o.seq !== k.seq) return { ok: false, error: 'chunk does not belong to its key' };
  if (!isBase(o.base)) return { ok: false, error: 'chunk base is invalid' };
  if (!Number.isSafeInteger(o.first) || (o.first as number) < 0) return { ok: false, error: 'chunk first index is invalid' };
  if (!Array.isArray(o.entries) || !o.entries.every(isEntry)) return { ok: false, error: 'chunk entries are invalid' };
  return {
    ok: true,
    chunk: {
      ns: k.ns,
      epoch: k.epoch,
      seq: k.seq,
      base: normBase(o.base),
      first: o.first as number,
      entries: o.entries as JournalEntry[],
      wall: typeof o.wall === 'number' ? o.wall : 0,
    },
  };
}

// ───────────────────────────── reading ─────────────────────────────

/**
 * Walk the hash chain over every candidate entry (by index) and return the verified prefix. Stops — never throws —
 * at a gap, a bad hash/link, a tick that goes backwards (or before the snapshot), or a fork (two different valid
 * entries for one index: ambiguous, so nothing past it is trusted).
 */
export function verifyChain(base: JournalBase, epoch: string, chunks: readonly JournalChunk[]): { entries: JournalEntry[]; stoppedBecause: string | null; stored: number } {
  const byIndex = new Map<number, JournalEntry[]>();
  let maxIndex = -1;
  for (const c of [...chunks].sort((a, b) => a.seq - b.seq)) {
    c.entries.forEach((e) => {
      const list = byIndex.get(e.i) ?? [];
      list.push(e);
      byIndex.set(e.i, list);
      if (e.i > maxIndex) maxIndex = e.i;
    });
  }
  const out: JournalEntry[] = [];
  let prev = genesisHash(base, epoch);
  let lastTick = base.tick;
  let stoppedBecause: string | null = null;
  for (let i = 0; i <= maxIndex; i++) {
    const cands = byIndex.get(i);
    if (!cands || cands.length === 0) {
      stoppedBecause = `entry ${i} is missing`;
      break;
    }
    const valid = new Map<string, JournalEntry>();
    for (const e of cands) {
      if (e.p !== prev) continue;
      if (entryHash(prev, e) !== e.h) continue;
      valid.set(e.h, e);
    }
    if (valid.size === 0) {
      stoppedBecause = `entry ${i} failed verification`;
      break;
    }
    if (valid.size > 1) {
      stoppedBecause = `entry ${i} is ambiguous (two different entries)`;
      break;
    }
    const e = [...valid.values()][0];
    if (e.t < lastTick) {
      stoppedBecause = `entry ${i} goes back in time (tick ${e.t} < ${lastTick})`;
      break;
    }
    out.push(e);
    prev = e.h;
    lastTick = e.t;
  }
  return { entries: out, stoppedBecause, stored: maxIndex + 1 };
}

export interface ReadOptions {
  activity?: ActivityTracker;
  logger?: { warn(...a: unknown[]): void };
}

/**
 * Read the journal of namespace `ns` that extends exactly the snapshot `base`. Returns null when there is none (or
 * nothing readable). Never throws: unreadable keys / damaged chunks are skipped and reported in `problems`.
 */
export async function readJournal(backend: StorageBackend, ns: string, base: JournalBase, opts: ReadOptions = {}): Promise<RecoveredJournal | null> {
  if (!isJournalNamespace(ns)) return null;
  const end = (opts.activity ?? persistenceActivity).begin();
  try {
    let keys: string[];
    try {
      keys = await backend.list(journalPrefix(ns));
    } catch (e) {
      opts.logger?.warn('[journal] could not list journal chunks:', e);
      return null;
    }
    const problems: string[] = [];
    const byEpoch = new Map<string, JournalChunk[]>();
    const maxSeq = new Map<string, number>();
    for (const key of keys) {
      const k = parseChunkKey(key);
      if (!k || k.ns !== ns) continue;
      maxSeq.set(k.epoch, Math.max(maxSeq.get(k.epoch) ?? -1, k.seq));
      let bytes: Uint8Array | null;
      try {
        bytes = await backend.read(key);
      } catch (e) {
        problems.push(`${key}: unreadable (${errorMessage(e)})`);
        continue;
      }
      if (!bytes) continue;
      const d = decodeChunk(bytes, key);
      if (!d.ok) {
        problems.push(`${key}: ${d.error}`);
        continue;
      }
      if (!sameBase(d.chunk.base, base)) continue; // another snapshot's journal
      const list = byEpoch.get(k.epoch) ?? [];
      list.push(d.chunk);
      byEpoch.set(k.epoch, list);
    }
    // Normally one epoch matches. Two can only appear if two writers anchored on the same snapshot (lock lost): take
    // the one that verifies further (ties: the larger epoch id, deterministic).
    let best: RecoveredJournal | null = null;
    for (const [epoch, chunks] of byEpoch) {
      const v = verifyChain(base, epoch, chunks);
      const r: RecoveredJournal = {
        ns,
        epoch,
        base: normBase(base),
        entries: v.entries,
        maxSeq: maxSeq.get(epoch) ?? 0,
        chunkCount: chunks.length,
        stoppedBecause: v.stoppedBecause,
        droppedEntries: Math.max(0, v.stored - v.entries.length),
        problems,
      };
      if (!best || r.entries.length > best.entries.length || (r.entries.length === best.entries.length && epoch > best.epoch)) best = r;
    }
    if (best && problems.length > 0) opts.logger?.warn(`[journal] ${problems.length} damaged journal chunk(s) skipped:`, problems.slice(0, 3));
    return best;
  } finally {
    end();
  }
}

// ───────────────────────────── lock ─────────────────────────────

export interface HeldLock {
  /** Let go; resolves once the lock manager has actually released it (another window may take it then). */
  release(): Promise<void>;
}

/** Acquire `name` without waiting and HOLD it until release() (null when another window holds it). Never throws. */
export function holdLock(locks: LockProvider, name: string): Promise<HeldLock | null> {
  return new Promise<HeldLock | null>((resolve) => {
    let letGo!: () => void;
    const done = new Promise<void>((r) => (letGo = r));
    let settled = false;
    let finished!: Promise<void>;
    finished = locks
      .run(
        name,
        async () => {
          settled = true;
          resolve({
            release: () => {
              letGo();
              return finished.then(() => new Promise<void>((r) => setTimeout(r, 0)));
            },
          });
          await done;
        },
        { ifAvailable: true },
      )
      .then(
        () => undefined,
        () => {
          if (!settled) resolve(null);
        },
      );
  });
}

export function journalLockName(backendId: string, ns: string): string {
  return `afterlife-lease:journal:${backendId}:${ns}`;
}

// ───────────────────────────── writer ─────────────────────────────

export interface JournalWriterOptions {
  backend: StorageBackend;
  ns: string;
  /** Default: Web Locks when available (cross-window), else none. */
  locks?: LockProvider;
  activity?: ActivityTracker;
  /** Wall clock (diagnostics in chunks only). */
  wallNow?: () => number;
  /** Random 16-hex epoch ids (injectable for tests). */
  newEpoch?: () => string;
  maxChunks?: number;
  maxEntries?: number;
  logger?: { warn(...a: unknown[]): void };
}

/** One recorded op (absolute monotonic time; made epoch-relative when written). */
export interface JournalOp {
  /** Global op serial of this writer (monotonic, never reused). */
  g: number;
  t: number;
  /** Monotonic ms when it happened. */
  atAbs: number;
  c?: unknown;
  ok?: boolean;
  fp?: string;
}

export type FlushOutcome = 'written' | 'nothing' | 'not-holder' | 'no-base' | 'full' | 'failed';

/** An epoch opened for a snapshot whose save is still being written (two-phase rebase, see the header). */
interface StagedEpoch {
  base: JournalBase;
  epoch: string;
  /** Ops with g >= markG belong to it (recorded after the snapshot was serialized). */
  markG: number;
  /** Monotonic ms the snapshot was taken at. */
  epochAt: number;
  /** How many of its ops are durably written. */
  persisted: number;
  lastHash: string;
  lastAt: number;
  nextSeq: number;
  chunkSeqs: number[];
  /** Became the current epoch (rebase) while one of its writes was in flight: that write updates the writer. */
  promoted: boolean;
}

function randomEpoch(): string {
  const b = new Uint8Array(8);
  try {
    globalThis.crypto.getRandomValues(b);
  } catch {
    for (let i = 0; i < 8; i++) b[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Writer side of one namespace's journal (one per played world). Pure bookkeeping + storage; it knows nothing about
 * the sim (src/game/journal.ts feeds it).
 */
export class JournalWriter {
  readonly ns: string;
  private readonly backend: StorageBackend;
  private readonly locks: LockProvider;
  private readonly activity: ActivityTracker;
  private readonly wallNow: () => number;
  private readonly newEpoch: () => string;
  private readonly maxChunks: number;
  private readonly maxEntries: number;
  private readonly log: { warn(...a: unknown[]): void };

  private lock: HeldLock | null = null;
  private acquiring: Promise<boolean> | null = null;
  private disposed = false;
  /**
   * Set by rebase(): chunks of other epochs in the namespace are deleted by the next successful flush — 'all': every
   * other epoch; 'same-base': only the other epochs anchored on this writer's own snapshot.
   */
  private needPurge: false | 'all' | 'same-base' = false;

  private nextG = 0;
  /** Ops of the current epoch (or, before the first base, everything since the session started). */
  private ops: JournalOp[] = [];
  /** Global serial of the first op that belongs to the current epoch. */
  private epochStartG = 0;
  private base: JournalBase | null = null;
  private epoch: string | null = null;
  /** Monotonic ms the current epoch's snapshot was taken at (entries' `at` are relative to it). */
  private epochAt = 0;
  /** How many of `ops` are durably written in the current epoch. */
  private persisted = 0;
  private lastHash = '';
  private lastAt = 0;
  private nextSeq = 0;
  private chunkSeqs: number[] = [];
  /** Epochs of saves being written right now (written before the current epoch on every flush). */
  private staged: StagedEpoch[] = [];
  private full = false;
  private flushing: Promise<FlushOutcome> | null = null;
  private flushAgain = false;
  private lastError: string | null = null;
  private writes = 0;

  constructor(opts: JournalWriterOptions) {
    if (!isJournalNamespace(opts.ns)) throw new Error(`invalid journal namespace "${String(opts.ns)}"`);
    this.ns = opts.ns;
    this.backend = opts.backend;
    this.locks = opts.locks ?? webLocks() ?? noLocks;
    this.activity = opts.activity ?? persistenceActivity;
    this.wallNow = opts.wallNow ?? (() => Date.now());
    this.newEpoch = opts.newEpoch ?? randomEpoch;
    this.maxChunks = Math.max(2, opts.maxChunks ?? DEFAULT_MAX_CHUNKS);
    this.maxEntries = Math.max(1, opts.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.log = opts.logger ?? console;
  }

  // ── state ──
  get holder(): boolean {
    return this.lock !== null;
  }
  get currentBase(): JournalBase | null {
    return this.base;
  }
  get currentEpoch(): string | null {
    return this.epoch;
  }
  /** Ops in memory for the current epoch. */
  get size(): number {
    return this.ops.length;
  }
  get persistedCount(): number {
    return this.persisted;
  }
  /** Ops not yet durable — in the current epoch, plus those of any staged epoch. */
  get pendingCount(): number {
    let n = this.ops.length - this.persisted;
    for (const s of this.staged) n += this.ops.length - this.firstIndexAtOrAfter(s.markG) - s.persisted;
    return n;
  }
  /** Saves whose epochs are staged (diagnostics / tests). */
  get stagedCount(): number {
    return this.staged.length;
  }
  get chunkCount(): number {
    return this.chunkSeqs.length;
  }
  get isFull(): boolean {
    return this.full;
  }
  get busy(): boolean {
    return this.flushing !== null;
  }
  get error(): string | null {
    return this.lastError;
  }
  get writeCount(): number {
    return this.writes;
  }
  /** The last recorded op (null when none in this epoch). */
  get lastOp(): JournalOp | null {
    return this.ops.length > 0 ? this.ops[this.ops.length - 1] : null;
  }

  /** Try to become the namespace's writer (no waiting). Idempotent; concurrent calls share one attempt. */
  acquire(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.lock) return Promise.resolve(true);
    if (this.acquiring) return this.acquiring;
    this.acquiring = holdLock(this.locks, journalLockName(this.backend.id, this.ns)).then((l) => {
      this.acquiring = null;
      if (this.disposed) {
        void l?.release();
        return false;
      }
      this.lock = l;
      return l !== null;
    });
    return this.acquiring;
  }

  /** Mark: ops recorded from now on come AFTER a snapshot being serialized right now. */
  mark(): number {
    return this.nextG;
  }

  /** Record one op (write-ahead: call BEFORE applying it). Returns it so the caller can fill in `ok`. */
  record(op: Omit<JournalOp, 'g'>): JournalOp {
    const o: JournalOp = { g: this.nextG++, ...op };
    if (this.full) return o;
    if (this.ops.length >= this.maxEntries) {
      this.full = true;
      this.log.warn(`[journal] ${this.ns}: ${this.maxEntries} entries since the last save; journaling pauses until the next save`);
      return o;
    }
    this.ops.push(o);
    return o;
  }

  /**
   * Adopt a recovered chain (after replaying it onto its snapshot): it becomes this writer's current epoch and new
   * ops continue it. A chain that ended early or is spread over many chunks is compacted on the next flush.
   */
  adopt(rec: RecoveredJournal, nowAbs: number): void {
    const last = rec.entries[rec.entries.length - 1];
    const lastAt = last ? last.at : 0;
    this.base = normBase(rec.base);
    this.epoch = rec.epoch;
    this.epochAt = nowAbs - lastAt;
    this.epochStartG = this.nextG;
    this.ops = rec.entries.map((e) => ({ g: this.nextG++, t: e.t, atAbs: this.epochAt + e.at, ...(e.c !== undefined ? { c: e.c } : {}), ...(e.ok !== undefined ? { ok: e.ok } : {}), ...(e.fp !== undefined ? { fp: e.fp } : {}) }));
    this.persisted = this.ops.length;
    this.lastHash = last ? last.h : genesisHash(this.base, rec.epoch);
    this.lastAt = lastAt;
    this.nextSeq = rec.maxSeq + 1;
    // Force a compaction (rewrite the verified prefix as one chunk, delete the rest) when anything was dropped.
    const dirty = rec.stoppedBecause !== null || rec.problems.length > 0 || rec.chunkCount >= this.maxChunks;
    this.chunkSeqs = dirty ? new Array<number>(this.maxChunks).fill(-1) : new Array<number>(rec.chunkCount).fill(-1);
    this.staged = [];
    this.full = false;
  }

  /** Index in `ops` of the first op with g >= `g` (ops are ordered by g). */
  private firstIndexAtOrAfter(g: number): number {
    const ops = this.ops;
    let lo = 0;
    let hi = ops.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ops[mid].g < g) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Phase 1 of a rebase: a snapshot taken at `markG` (see mark()) is ABOUT to be written as `base`. Opens its epoch
   * now and flushes it (ops recorded since the mark), so the journal for that snapshot is durable before the snapshot
   * itself can be; from then on every flush keeps it up to date. Resolves with the flush outcome; call it before the
   * snapshot write starts and `rebase` (same base + mark) once it is durable, or `unstage` if the save failed.
   */
  stage(base: JournalBase, markG: number, snapshotAtAbs: number): Promise<FlushOutcome> {
    if (this.disposed) return Promise.resolve('nothing');
    if (this.base && markG < this.epochStartG) return Promise.resolve('nothing'); // older than the current epoch
    const nb = normBase(base);
    if (!this.staged.some((s) => s.markG === markG && sameBase(s.base, nb))) {
      const epoch = this.newEpoch();
      this.staged.push({ base: nb, epoch, markG, epochAt: snapshotAtAbs, persisted: 0, lastHash: genesisHash(nb, epoch), lastAt: 0, nextSeq: 0, chunkSeqs: [], promoted: false });
    }
    return this.flush();
  }

  /**
   * Every op recorded before serial `g` is durable — in the current epoch (ops older than it are in its snapshot) AND
   * in every staged epoch — so a kill now loses none of them whichever of those snapshots is in the slot.
   */
  isDurableThrough(g: number): boolean {
    if (!this.base || this.epoch === null || this.full) return false;
    const n = this.firstIndexAtOrAfter(g);
    if (n > this.persisted) return false;
    for (const s of this.staged) if (n - this.firstIndexAtOrAfter(s.markG) > s.persisted) return false;
    return true;
  }

  /** Ops recorded since `markG` (a staged epoch with none needs no write before its snapshot can land). */
  hasOpsSince(markG: number): boolean {
    return this.nextG > markG;
  }

  /** The save staged at `markG` failed: stop writing its epoch (chunks already written are purged later). */
  unstage(markG: number): void {
    this.staged = this.staged.filter((s) => s.markG !== markG);
  }

  /**
   * A snapshot taken at `markG` (see mark()) is now durable as `base`: start a new epoch holding the ops recorded
   * after the mark, write it, then delete every older chunk of the namespace. A mark older than the current epoch
   * (a slower save that finished after a newer one) is ignored.
   */
  async rebase(base: JournalBase, markG: number, snapshotAtAbs: number, opts: { purgeOthers?: boolean | 'same-base' } = {}): Promise<FlushOutcome> {
    if (this.base && markG < this.epochStartG) return 'nothing';
    const purge = opts.purgeOthers === 'same-base' ? 'same-base' : opts.purgeOthers !== false ? 'all' : false;
    const nb = normBase(base);
    const st = this.staged.find((s) => s.markG === markG && sameBase(s.base, nb)) ?? null;
    // Saves staged before this one are settled (saves land in order): superseded or failed.
    this.staged = this.staged.filter((s) => s.markG > markG);
    if (st) {
      // Phase 2: the staged epoch is already durable up to `persisted` — it simply becomes the current one.
      st.promoted = true;
      this.ops = this.ops.filter((o) => o.g >= markG);
      this.base = st.base;
      this.epoch = st.epoch;
      this.epochAt = st.epochAt;
      this.epochStartG = markG;
      this.persisted = Math.min(st.persisted, this.ops.length);
      this.lastHash = st.lastHash;
      this.lastAt = st.lastAt;
      this.nextSeq = st.nextSeq;
      this.chunkSeqs = st.chunkSeqs.slice();
      this.full = false;
      this.needPurge = purge;
      return this.flush();
    }
    const keep = this.ops.filter((o) => o.g >= markG);
    this.base = normBase(base);
    this.epoch = this.newEpoch();
    this.epochAt = snapshotAtAbs;
    this.ops = keep;
    this.epochStartG = markG;
    this.persisted = 0;
    this.lastHash = genesisHash(this.base, this.epoch);
    this.lastAt = 0;
    this.nextSeq = 0;
    this.chunkSeqs = [];
    this.full = false;
    // A fresh save supersedes every other epoch of the world. Merely LOADING an old snapshot does not: another
    // slot's journal (e.g. the crash tail of the autosave) stays until this session's first save. But an epoch on the
    // SAME snapshot that the load did not adopt is a timeline the player left by reloading ('same-base'): it goes, or
    // a later recovery could pick it over this one.
    this.needPurge = purge;
    return this.flush();
  }

  /**
   * Write pending ops as one new chunk (or a compacted one). One flush at a time; a call during a flush schedules one
   * follow-up and shares its result. Never throws.
   */
  flush(): Promise<FlushOutcome> {
    if (this.flushing) {
      this.flushAgain = true;
      return this.flushing.then(() => this.flushing ?? this.flush());
    }
    const end = this.activity.begin();
    const p = this.doFlush()
      .catch((e: unknown): FlushOutcome => {
        this.lastError = errorMessage(e);
        return 'failed';
      })
      .finally(() => {
        end();
        this.flushing = null;
        if (this.flushAgain) {
          this.flushAgain = false;
          void this.flush();
        }
      });
    this.flushing = p;
    return p;
  }

  private async doFlush(): Promise<FlushOutcome> {
    if (this.disposed) return 'nothing';
    if (!this.lock) return 'not-holder';
    // Every lane is written up to the same op, staged epochs FIRST: whatever is durable in the current epoch is
    // durable in every staged one too (a kill between the two writes loses at most this batch, in the old epoch).
    const upto = this.nextG;
    let stagedWrote = false;
    for (const s of this.staged.slice()) {
      const r = await this.flushStaged(s, upto);
      if (r === 'failed') return 'failed';
      if (r === 'written') stagedWrote = true;
    }
    if (!this.base || this.epoch === null) return stagedWrote ? 'written' : 'no-base';
    const base = this.base;
    const epoch = this.epoch;
    const total = this.firstIndexAtOrAfter(upto);
    const compact = this.chunkSeqs.length >= this.maxChunks;
    if (total <= this.persisted && !compact && !this.needPurge) return stagedWrote ? 'written' : 'nothing';
    let wrote = stagedWrote;
    if (total > this.persisted || compact) {
      const from = compact ? 0 : this.persisted;
      const prev = from === 0 ? genesisHash(base, epoch) : this.lastHash;
      let lastAt = from === 0 ? 0 : this.lastAt;
      const bodies: JournalBody[] = [];
      for (let i = from; i < total; i++) {
        const o = this.ops[i];
        const at = Math.max(lastAt, Math.max(0, Math.round(o.atAbs - this.epochAt)));
        lastAt = at;
        const b: JournalBody = { i, t: o.t, at };
        if (o.c !== undefined) b.c = o.c;
        if (o.ok !== undefined) b.ok = o.ok;
        if (o.fp !== undefined) b.fp = o.fp;
        bodies.push(b);
      }
      const entries = chainEntries(prev, bodies);
      const seq = this.nextSeq++;
      const bytes = encodeChunk({ ns: this.ns, epoch, seq, base, first: from, entries, wall: this.wallNow() });
      if (bytes.byteLength > MAX_CHUNK_BYTES) {
        this.full = true;
        return 'full';
      }
      const oldSeqs = this.chunkSeqs.slice();
      try {
        await this.backend.write(chunkKey(this.ns, epoch, seq), bytes);
        this.writes++;
      } catch (e) {
        // Not durable (quota / storage gone): keep everything in memory and retry on the next flush, under a new seq
        // (if the failed write did land after all, its entries are identical to the retry's — readers dedupe).
        this.lastError = errorMessage(e);
        return 'failed';
      }
      if (this.epoch !== epoch) return 'written'; // rebased while writing: the new epoch owns the state now
      wrote = true;
      this.lastError = null;
      this.persisted = total;
      if (entries.length > 0) {
        this.lastHash = entries[entries.length - 1].h;
        this.lastAt = entries[entries.length - 1].at;
      }
      if (compact) {
        this.chunkSeqs = [seq];
        for (const s of oldSeqs) if (s >= 0) await this.removeQuietly(chunkKey(this.ns, epoch, s));
        // Seqs adopted from a recovered chain are unknown (-1): purge everything else of this epoch by listing.
        if (oldSeqs.some((s) => s < 0)) await this.purge((k) => k.epoch === epoch && k.seq !== seq);
        if (this.needPurge && this.epoch === epoch) await this.runPurge(epoch, base);
        return 'written';
      }
      this.chunkSeqs.push(seq);
    }
    if (this.needPurge && this.epoch === epoch) {
      // Only after the new epoch's first chunk is durable (or there is nothing to carry over): a crash in between
      // leaves both epochs, and readers pick the one matching the snapshot that is actually in the slot.
      await this.runPurge(epoch, base);
    }
    return wrote ? 'written' : 'nothing';
  }

  /**
   * Run the purge rebase() asked for, then clear the request — but only if no newer rebase replaced it during the
   * awaits (a save landing mid-purge sets a new request for its own epoch, which must not be lost).
   */
  private async runPurge(epoch: string, base: JournalBase): Promise<void> {
    const mode = this.needPurge;
    if (!mode) return;
    await this.purgeOthers(epoch, base, mode);
    if (this.needPurge === mode && this.epoch === epoch) this.needPurge = false;
  }

  /** The purge asked for by rebase() (see needPurge): every other epoch, or only those anchored on `base`. */
  private async purgeOthers(epoch: string, base: JournalBase, mode: 'all' | 'same-base'): Promise<void> {
    if (mode !== 'same-base') {
      // Never the current epoch either: a stage promoted to current while this older purge waited on storage
      // would otherwise lose its durable chunks (recovered state older than acknowledged; CI soak seeds 5 and 9).
      await this.purge((k) => k.epoch !== epoch && k.epoch !== this.epoch && !this.isStagedEpoch(k.epoch));
      return;
    }
    let keys: string[];
    try {
      keys = await this.backend.list(journalPrefix(this.ns));
    } catch {
      return;
    }
    for (const key of keys) {
      const k = parseChunkKey(key);
      // Never this writer's own epochs: the one being flushed, the current one (a save may rebase meanwhile), staged ones.
      if (!k || k.ns !== this.ns || k.epoch === epoch || k.epoch === this.epoch || this.isStagedEpoch(k.epoch)) continue;
      let bytes: Uint8Array | null;
      try {
        bytes = await this.backend.read(key);
      } catch {
        continue;
      }
      if (!bytes) continue;
      const d = decodeChunk(bytes, key);
      if (d.ok && sameBase(d.chunk.base, base)) await this.removeQuietly(key);
    }
  }

  /** An epoch of a save still being written: never purged as "another epoch". */
  private isStagedEpoch(epoch: string): boolean {
    return this.staged.some((s) => s.epoch === epoch);
  }

  /** Write a staged epoch's unwritten ops (g < upto) as one chunk (a compacted one past maxChunks). Never throws. */
  private async flushStaged(s: StagedEpoch, upto: number): Promise<FlushOutcome> {
    const start = this.firstIndexAtOrAfter(s.markG);
    const end = this.firstIndexAtOrAfter(upto);
    const total = end - start;
    const compact = s.chunkSeqs.length >= this.maxChunks;
    if (total <= s.persisted && !compact) return 'nothing';
    const from = compact ? 0 : s.persisted;
    let lastAt = from === 0 ? 0 : s.lastAt;
    const bodies: JournalBody[] = [];
    for (let i = from; i < total; i++) {
      const o = this.ops[start + i];
      const at = Math.max(lastAt, Math.max(0, Math.round(o.atAbs - s.epochAt)));
      lastAt = at;
      const b: JournalBody = { i, t: o.t, at };
      if (o.c !== undefined) b.c = o.c;
      if (o.ok !== undefined) b.ok = o.ok;
      if (o.fp !== undefined) b.fp = o.fp;
      bodies.push(b);
    }
    const entries = chainEntries(from === 0 ? genesisHash(s.base, s.epoch) : s.lastHash, bodies);
    const seq = s.nextSeq++;
    const bytes = encodeChunk({ ns: this.ns, epoch: s.epoch, seq, base: s.base, first: from, entries, wall: this.wallNow() });
    if (bytes.byteLength > MAX_CHUNK_BYTES) {
      // Too big to stage: fall back to the one-phase rebase for this save.
      this.unstage(s.markG);
      return 'nothing';
    }
    const oldSeqs = s.chunkSeqs.slice();
    try {
      await this.backend.write(chunkKey(this.ns, s.epoch, seq), bytes);
      this.writes++;
    } catch (e) {
      this.lastError = errorMessage(e);
      return 'failed';
    }
    const last = entries.length > 0 ? entries[entries.length - 1] : null;
    if (s.promoted) {
      // Promoted while writing: the writer's current epoch IS this one now.
      if (this.epoch === s.epoch) {
        if (total > this.persisted) {
          this.persisted = total;
          if (last) {
            this.lastHash = last.h;
            this.lastAt = last.at;
          }
        }
        this.chunkSeqs = compact ? [seq] : [...this.chunkSeqs, seq];
        if (compact) for (const q of oldSeqs) await this.removeQuietly(chunkKey(this.ns, s.epoch, q));
      }
      return 'written';
    }
    if (!this.staged.includes(s)) return 'written'; // unstaged / superseded meanwhile
    s.persisted = total;
    if (last) {
      s.lastHash = last.h;
      s.lastAt = last.at;
    }
    s.chunkSeqs = compact ? [seq] : [...s.chunkSeqs, seq];
    if (compact) for (const q of oldSeqs) await this.removeQuietly(chunkKey(this.ns, s.epoch, q));
    return 'written';
  }

  private async purge(match: (k: { epoch: string; seq: number }) => boolean): Promise<void> {
    let keys: string[];
    try {
      keys = await this.backend.list(journalPrefix(this.ns));
    } catch {
      return;
    }
    for (const key of keys) {
      const k = parseChunkKey(key);
      if (k && k.ns === this.ns && match(k)) await this.removeQuietly(key);
    }
  }

  private async removeQuietly(key: string): Promise<void> {
    try {
      await this.backend.remove(key);
    } catch (e) {
      this.log.warn(`[journal] could not remove ${key}:`, e);
    }
  }

  /** Forget the namespace on disk (slot deleted / world over). Holder only. */
  async clear(): Promise<void> {
    this.ops = [];
    this.staged = [];
    this.persisted = 0;
    this.base = null;
    this.epoch = null;
    this.chunkSeqs = [];
    if (!this.lock) return;
    const end = this.activity.begin();
    try {
      // A chunk write already in flight would land after the purge lists the namespace: let it land first.
      const inFlight = this.flushing;
      if (inFlight) await inFlight.catch(() => undefined);
      await this.purge(() => true);
    } finally {
      end();
    }
  }

  /** Final flush (best effort) then release the lock. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    try {
      await this.flush();
    } catch {
      /* best effort */
    }
    this.disposed = true;
    const l = this.lock;
    this.lock = null;
    if (l) await l.release();
  }

  /** Release at once (no flush) — tests / a window that lost its storage. */
  release(): void {
    this.disposed = true;
    void this.lock?.release();
    this.lock = null;
  }
}
