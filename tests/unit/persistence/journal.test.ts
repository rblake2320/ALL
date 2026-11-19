/**
 * Write-ahead command journal — storage layer (src/persistence/journal.ts), adversarially:
 * kill at every storage op of a multi-batch run (before / after / torn) on every backend, wrong snapshot, reordered /
 * duplicated / tampered / forked entries, compaction bounds, quota, storage cleared mid-session, two windows, clock
 * skew, journals of old saves, crash during rotation, and 10k-entry performance.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { NativeBridge, StorageBackend } from '../../../src/persistence/contracts';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { createLocalStorageBackend } from '../../../src/persistence/backends/localStorage';
import { createIndexedDbBackend } from '../../../src/persistence/backends/indexedDb';
import { createElectronBackend } from '../../../src/persistence/backends/electron';
import { noLocks } from '../../../src/persistence/locks';
import { utf8DecodeStrict, utf8Encode } from '../../../src/persistence/bytes';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { sha256HexSync } from '../../../src/persistence/sha256';
import { StorageError } from '../../../src/persistence/errors';
import {
  JournalWriter,
  chainEntries,
  chunkKey,
  decodeChunk,
  encodeChunk,
  genesisHash,
  parseChunkKey,
  readJournal,
  verifyChain,
  type JournalBase,
  type JournalBody,
  type JournalChunk,
  type JournalEntry,
} from '../../../src/persistence/journal';
import { FileStore } from '../../../electron/fileStore';
import { FakeStorage } from './fakeStorage';
import { FakeIDBFactory } from './fakeIndexedDb';
import { FakeLockManager, webLocksOver } from './fakeWebLocks';

const NS = 'auto-00c0ffee';
const BASE: JournalBase = { slotId: 'auto-00c0ffee', payloadSha256: 'a'.repeat(64), tick: 100 };
const silent = { warn: () => undefined };

function epochs(): () => string {
  let n = 0;
  return () => (++n).toString(16).padStart(16, '0');
}

function writer(backend: StorageBackend, over: Partial<ConstructorParameters<typeof JournalWriter>[0]> = {}): JournalWriter {
  return new JournalWriter({ backend, ns: NS, locks: noLocks, newEpoch: epochs(), logger: silent, wallNow: () => 1_700_000_000_000, ...over });
}

const cmd = (i: number) => ({ type: 'cancel', actorId: 'a1', uid: i });
const tickOf = (i: number) => BASE.tick + Math.floor(i / 3);

function recordN(w: JournalWriter, from: number, n: number): void {
  for (let i = from; i < from + n; i++) w.record({ t: tickOf(i), atAbs: i * 10, c: cmd(i), ok: true });
}

/** Every recovered entry must be exactly what was recorded at that index (a verified PREFIX of the truth). */
function expectPrefix(entries: readonly JournalEntry[]): void {
  entries.forEach((e, i) => {
    expect(e.i).toBe(i);
    expect(e.t).toBe(tickOf(i));
    expect(e.c).toEqual(cmd(i));
  });
}

async function rawChunks(b: StorageBackend): Promise<{ key: string; chunk: JournalChunk }[]> {
  const out: { key: string; chunk: JournalChunk }[] = [];
  for (const key of await b.list('journal:')) {
    const bytes = await b.read(key);
    const d = bytes ? decodeChunk(bytes, key) : null;
    if (d && d.ok) out.push({ key, chunk: d.chunk });
  }
  return out;
}

/** Re-encode a chunk with modified entries (valid chunk checksum: only the hash CHAIN can catch the edit). */
async function rewrite(b: StorageBackend, key: string, edit: (c: JournalChunk) => JournalChunk): Promise<void> {
  const d = decodeChunk((await b.read(key))!, key);
  if (!d.ok) throw new Error(d.error);
  await b.write(key, encodeChunk(edit(d.chunk)));
}

// ───────────────────────────── kill-switch wrapper ─────────────────────────────

type KillMode = 'before' | 'after' | 'torn';

/** Dies at the N-th storage op: the op is not applied / applied / applied as a torn half-write; nothing works after. */
class KillSwitch implements StorageBackend {
  readonly id: StorageBackend['id'];
  readonly durable = true;
  ops = 0;
  dead = false;
  constructor(
    readonly inner: StorageBackend,
    public killAt: number,
    private readonly mode: KillMode,
  ) {
    this.id = inner.id;
  }
  private async gate<T>(apply: () => Promise<T>, torn?: () => Promise<void>): Promise<T> {
    if (this.dead) throw new StorageError('io', 'process is dead');
    if (this.ops++ === this.killAt) {
      this.dead = true;
      if (this.mode === 'after') await apply();
      if (this.mode === 'torn' && torn) await torn();
      throw new StorageError('io', `killed (${this.mode})`);
    }
    return apply();
  }
  available() {
    return this.inner.available();
  }
  read(k: string) {
    return this.gate(() => this.inner.read(k));
  }
  write(k: string, d: Uint8Array) {
    return this.gate(
      () => this.inner.write(k, d),
      () => this.inner.write(k, d.slice(0, Math.max(1, Math.floor(d.length / 2)))),
    );
  }
  remove(k: string) {
    return this.gate(() => this.inner.remove(k));
  }
  list(p: string) {
    return this.gate(() => this.inner.list(p));
  }
  quota() {
    return this.inner.quota();
  }
}

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

interface BackendKind {
  name: string;
  /** A fresh storage area: `open()` returns a new backend object over the SAME data (a relaunch). */
  make(): { open(): StorageBackend };
}

const BACKENDS: BackendKind[] = [
  {
    name: 'memory',
    make() {
      const m = createMemoryBackend();
      return { open: () => m };
    },
  },
  {
    name: 'localStorage',
    make() {
      const s = new FakeStorage();
      return { open: () => createLocalStorageBackend({ storage: s }) };
    },
  },
  {
    name: 'IndexedDB',
    make() {
      const f = new FakeIDBFactory();
      return { open: () => createIndexedDbBackend({ factory: f as unknown as IDBFactory }) };
    },
  },
  {
    name: 'electron (atomic files)',
    make() {
      const dir = mkdtempSync(join(tmpdir(), 'al-journal-'));
      tmpDirs.push(dir);
      return {
        open: () => {
          const fs = new FileStore({ dir });
          const bridge = { platform: 'win32', version: 't', storage: { read: (k: string) => fs.read(k), write: (k: string, d: Uint8Array) => fs.write(k, d), remove: (k: string) => fs.remove(k), list: (p: string) => fs.list(p), quota: () => fs.quota() } } as unknown as NativeBridge;
          return createElectronBackend(bridge);
        },
      };
    },
  },
];

/**
 * The scenario: rebase onto BASE, then 6 batches of 5 commands (maxChunks 3 → compactions in between), tracking how
 * many entries were acknowledged durable before the process died.
 */
async function scenario(b: StorageBackend): Promise<{ durable: number; total: number }> {
  const w = writer(b, { maxChunks: 3 });
  await w.acquire();
  let durable = 0;
  let total = 0;
  if ((await w.rebase(BASE, w.mark(), 0)) === 'failed') return { durable, total };
  for (let batch = 0; batch < 6; batch++) {
    recordN(w, total, 5);
    total += 5;
    const r = await w.flush();
    if (r === 'written') durable = w.persistedCount;
    if (r === 'failed') break;
  }
  return { durable, total };
}

describe('journal: kill at every point of a batch write, on every backend', () => {
  for (const kind of BACKENDS) {
    it(`${kind.name}: every kill point leaves a verified prefix ≥ what was acknowledged`, async () => {
      // Baseline: how many storage ops the full scenario takes.
      const probe = new KillSwitch(kind.make().open(), Number.MAX_SAFE_INTEGER, 'before');
      const full = await scenario(probe);
      expect(full.durable).toBe(30);
      const totalOps = probe.ops;
      expect(totalOps).toBeGreaterThan(8);
      for (const mode of ['before', 'after', 'torn'] as const) {
        for (let k = 0; k < totalOps; k++) {
          const area = kind.make();
          const ks = new KillSwitch(area.open(), k, mode);
          const { durable } = await scenario(ks);
          expect(ks.dead).toBe(true);
          // Relaunch: a fresh backend object over the same data, never touched by the dead process.
          const rec = await readJournal(area.open(), NS, BASE, { logger: silent });
          const got = rec?.entries ?? [];
          expectPrefix(got);
          expect(got.length, `${mode} kill at op ${k}`).toBeGreaterThanOrEqual(durable);
        }
      }
    }, 120_000);
  }
});

describe('journal: chain + snapshot binding', () => {
  it('round trip: every recorded entry comes back, hash-chained from the snapshot', async () => {
    const m = createMemoryBackend();
    const w = writer(m);
    await w.acquire();
    await w.rebase(BASE, w.mark(), 0);
    recordN(w, 0, 10);
    expect(await w.flush()).toBe('written');
    recordN(w, 10, 5);
    w.record({ t: 200, atAbs: 999, fp: 'fp' });
    expect(await w.flush()).toBe('written');
    const rec = await readJournal(m, NS, BASE);
    expect(rec?.entries.length).toBe(16);
    expectPrefix(rec!.entries.slice(0, 15));
    expect(rec!.entries[15]).toMatchObject({ t: 200, fp: 'fp' });
    expect(rec!.entries[0].p).toBe(genesisHash(BASE, rec!.epoch));
    expect(rec!.stoppedBecause).toBeNull();
  });

  it('a journal only replays onto ITS snapshot: other sha / tick / slot / namespace → nothing', async () => {
    const m = createMemoryBackend();
    const w = writer(m);
    await w.acquire();
    await w.rebase(BASE, w.mark(), 0);
    recordN(w, 0, 4);
    await w.flush();
    expect(await readJournal(m, NS, { ...BASE, payloadSha256: 'b'.repeat(64) })).toBeNull();
    expect(await readJournal(m, NS, { ...BASE, tick: BASE.tick + 1 })).toBeNull();
    expect(await readJournal(m, NS, { ...BASE, slotId: 'save-00c0ffee' })).toBeNull();
    expect(await readJournal(m, 'auto-deadbeef', BASE)).toBeNull();
    // Entries transplanted into another epoch/base fail the chain at entry 0 (the genesis hash binds the base).
    const [{ chunk }] = await rawChunks(m);
    const other: JournalBase = { ...BASE, payloadSha256: 'c'.repeat(64) };
    await m.write(chunkKey(NS, 'f'.repeat(16), 0), encodeChunk({ ...chunk, epoch: 'f'.repeat(16), base: other }));
    const r = await readJournal(m, NS, other);
    expect(r?.entries.length).toBe(0);
    expect(r?.stoppedBecause).toMatch(/entry 0/);
  });

  it('old saves without journals (and junk keys) load fine: null, never a throw', async () => {
    const m = createMemoryBackend();
    expect(await readJournal(m, NS, BASE)).toBeNull();
    await m.write('journal:auto-00c0ffee:zz:1', utf8Encode('junk'));
    await m.write(`journal:${NS}:${'0'.repeat(15)}1:00000000`, utf8Encode('{not json'));
    await m.write(`journal:${NS}:${'0'.repeat(15)}2:00000000`, new Uint8Array(0));
    expect(await readJournal(m, NS, BASE, { logger: silent })).toBeNull();
    expect(await readJournal(m, 'BAD NS', BASE)).toBeNull();
  });

  it('reordered entries: the chain stops at the first swap (prefix kept)', async () => {
    const m = createMemoryBackend();
    const w = writer(m);
    await w.acquire();
    await w.rebase(BASE, w.mark(), 0);
    recordN(w, 0, 8);
    await w.flush();
    const [{ key }] = await rawChunks(m);
    await rewrite(m, key, (c) => {
      const e = c.entries.slice();
      [e[4], e[5]] = [e[5], e[4]];
      // also renumber so indices look dense — the links still betray the swap
      return { ...c, entries: e.map((x, i) => ({ ...x, i })) };
    });
    const r = await readJournal(m, NS, BASE);
    expect(r!.entries.length).toBe(4);
    expectPrefix(r!.entries);
    expect(r!.droppedEntries).toBe(4);
  });

  it('duplicated entries / duplicated chunks are harmless (deduplicated by hash)', async () => {
    const m = createMemoryBackend();
    const w = writer(m);
    await w.acquire();
    await w.rebase(BASE, w.mark(), 0);
    recordN(w, 0, 6);
    await w.flush();
    const [{ key, chunk }] = await rawChunks(m);
    await rewrite(m, key, (c) => ({ ...c, entries: [...c.entries, ...c.entries.slice(2, 4)] }));
    const k = parseChunkKey(key)!;
    await m.write(chunkKey(NS, k.epoch, 7), encodeChunk({ ...chunk, seq: 7 }));
    const r = await readJournal(m, NS, BASE);
    expect(r!.entries.length).toBe(6);
    expectPrefix(r!.entries);
  });

  it('tampered command (chunk checksum recomputed): replay stops right before it', async () => {
    const m = createMemoryBackend();
    const w = writer(m);
    await w.acquire();
    await w.rebase(BASE, w.mark(), 0);
    recordN(w, 0, 9);
    await w.flush();
    const [{ key }] = await rawChunks(m);
    await rewrite(m, key, (c) => ({ ...c, entries: c.entries.map((e) => (e.i === 6 ? { ...e, c: { type: 'cheat', code: 'motherlode' } } : e)) }));
    const r = await readJournal(m, NS, BASE);
    expect(r!.entries.length).toBe(6);
    expect(r!.stoppedBecause).toMatch(/entry 6 failed verification/);
  });

  it('bit flip anywhere in a chunk: the whole chunk is ignored (checksum), earlier chunks survive', async () => {
    const m = createMemoryBackend();
    const w = writer(m);
    await w.acquire();
    await w.rebase(BASE, w.mark(), 0);
    recordN(w, 0, 5);
    await w.flush();
    recordN(w, 5, 5);
    await w.flush();
    const keys = (await m.list('journal:')).sort();
    const last = keys[keys.length - 1];
    const bytes = (await m.read(last))!;
    for (const pos of [0, 10, Math.floor(bytes.length / 2), bytes.length - 2]) {
      const bad = bytes.slice();
      bad[pos] ^= 0x04;
      await m.write(last, bad);
      const r = await readJournal(m, NS, BASE, { logger: silent });
      expect(r!.entries.length).toBe(5);
      expectPrefix(r!.entries);
    }
  });

  it('a fork (two different valid entries for one index — e.g. two writers) stops the chain there', () => {
    const epoch = '1'.repeat(16);
    const g = genesisHash(BASE, epoch);
    const bodies: JournalBody[] = [0, 1, 2].map((i) => ({ i, t: tickOf(i), at: i, c: cmd(i), ok: true }));
    const a = chainEntries(g, bodies);
    const forkBody: JournalBody = { i: 2, t: tickOf(2), at: 2, c: { type: 'undo' }, ok: true };
    const fork = chainEntries(a[1].h, [forkBody]);
    const mk = (seq: number, entries: JournalEntry[]): JournalChunk => ({ ns: NS, epoch, seq, base: BASE, first: entries[0].i, entries, wall: 0 });
    const v = verifyChain(BASE, epoch, [mk(0, a), mk(1, fork)]);
    expect(v.entries.length).toBe(2);
    expect(v.stoppedBecause).toMatch(/ambiguous/);
  });

  it('ticks going backwards (or before the snapshot) end the chain', () => {
    const epoch = '2'.repeat(16);
    const g = genesisHash(BASE, epoch);
    const e = chainEntries(g, [
      { i: 0, t: 101, at: 0 },
      { i: 1, t: 105, at: 1 },
      { i: 2, t: 104, at: 2 },
    ]);
    const v = verifyChain(BASE, epoch, [{ ns: NS, epoch, seq: 0, base: BASE, first: 0, entries: e, wall: 0 }]);
    expect(v.entries.length).toBe(2);
    const before = chainEntries(g, [{ i: 0, t: 99, at: 0 }]);
    expect(verifyChain(BASE, epoch, [{ ns: NS, epoch, seq: 0, base: BASE, first: 0, entries: before, wall: 0 }]).entries.length).toBe(0);
  });

  it('chunk keys must match their content (a chunk copied under another key is refused)', async () => {
    const m = createMemoryBackend();
    const w = writer(m);
    await w.acquire();
    await w.rebase(BASE, w.mark(), 0);
    recordN(w, 0, 3);
    await w.flush();
    const [{ key }] = await rawChunks(m);
    const bytes = (await m.read(key))!;
    const k = parseChunkKey(key)!;
    expect(decodeChunk(bytes, chunkKey(NS, k.epoch, 5)).ok).toBe(false);
    expect(decodeChunk(bytes, chunkKey('auto-11111111', k.epoch, 0)).ok).toBe(false);
    const text = JSON.parse(utf8DecodeStrict(bytes)) as Record<string, unknown>;
    text.v = 99;
    const { sha: _s, ...rest } = text;
    const resealed = utf8Encode(canonicalJson({ ...rest, sha: sha256HexSync(canonicalJson(rest)) }));
    expect(decodeChunk(resealed, key)).toMatchObject({ ok: false, error: expect.stringMatching(/version/) });
  });
});

describe('journal: two-phase rebase (W-119)', () => {
  const NEXT: JournalBase = { slotId: 'auto-00c0ffee', payloadSha256: 'b'.repeat(64), tick: 100 };

  it('stage → every flush writes the staged epoch FIRST, up to the same op; rebase promotes it without rewriting', async () => {
    const m = createMemoryBackend();
    const order: string[] = [];
    const spy: StorageBackend = {
      ...m,
      write: async (k, d) => {
        order.push(k);
        return m.write(k, d);
      },
    };
    const w = writer(spy);
    await w.acquire();
    await w.rebase(BASE, w.mark(), 0);
    recordN(w, 0, 3);
    await w.flush();
    const oldEpoch = w.currentEpoch;
    const mark = w.mark(); // the save serializes here …
    recordN(w, 3, 2); // … the player keeps playing …
    order.length = 0;
    expect(await w.stage(NEXT, mark, 30)).toBe('written'); // … before the snapshot write starts
    expect(order.length).toBe(2);
    expect(parseChunkKey(order[0])!.epoch).not.toBe(oldEpoch); // the staged epoch first …
    expect(parseChunkKey(order[1])!.epoch).toBe(oldEpoch); // … then the current one
    expect(w.stagedCount).toBe(1);
    // Whichever snapshot ends up in the slot, its journal has every op: all 5 (old) / the 2 after the mark (new).
    expect((await readJournal(m, NS, BASE))!.entries.length).toBe(5);
    expect((await readJournal(m, NS, NEXT))!.entries.map((e) => e.c)).toEqual([cmd(3), cmd(4)]);
    recordN(w, 5, 1);
    expect(w.pendingCount).toBe(2); // one op, unwritten in both epochs
    await w.flush();
    expect(w.isDurableThrough(w.mark())).toBe(true);
    expect((await readJournal(m, NS, NEXT))!.entries.length).toBe(3);
    const writes = w.writeCount;
    expect(await w.rebase(NEXT, mark, 30)).toBe('nothing'); // the save landed: promote — no chunk rewritten …
    expect(w.writeCount).toBe(writes);
    expect(w.stagedCount).toBe(0);
    expect(w.currentBase).toEqual(NEXT);
    expect(await readJournal(m, NS, BASE)).toBeNull(); // … and the old epoch is truncated
    recordN(w, 6, 1);
    await w.flush();
    const r = (await readJournal(m, NS, NEXT))!;
    expect(r.entries.map((e) => e.c)).toEqual([cmd(3), cmd(4), cmd(5), cmd(6)]);
    expect(r.stoppedBecause).toBeNull();
  });

  it('a staged epoch is never purged as "another epoch"; unstage (save failed) leaves it to the next purge', async () => {
    const m = createMemoryBackend();
    const w = writer(m);
    await w.acquire();
    await w.rebase(BASE, w.mark(), 0);
    const markA = w.mark();
    recordN(w, 0, 2);
    await w.stage(NEXT, markA, 0); // save A staged …
    const markB = w.mark();
    recordN(w, 2, 2);
    const B: JournalBase = { ...NEXT, payloadSha256: 'c'.repeat(64), tick: 100 };
    await w.stage(B, markB, 0); // … and save B too (A still writing)
    await w.rebase(NEXT, markA, 0); // A lands: purges BASE's epoch, keeps B's staged one
    expect(await readJournal(m, NS, BASE)).toBeNull();
    expect((await readJournal(m, NS, B))!.entries.map((e) => e.c)).toEqual([cmd(2), cmd(3)]);
    w.unstage(markB); // B failed
    expect(w.stagedCount).toBe(0);
    recordN(w, 4, 1);
    await w.flush();
    expect((await readJournal(m, NS, NEXT))!.entries.length).toBe(5);
    const C: JournalBase = { ...NEXT, payloadSha256: 'd'.repeat(64), tick: 101 };
    await w.rebase(C, w.mark(), 0); // the next save purges B's leftovers
    expect(await readJournal(m, NS, B)).toBeNull();
  });

  it('a failing staged write fails the whole flush (the current epoch never gets ahead of a staged one)', async () => {
    const m = createMemoryBackend();
    let failStaged = false;
    let current = '';
    const flaky: StorageBackend = {
      ...m,
      write: async (k, d) => {
        if (failStaged && parseChunkKey(k)!.epoch !== current) throw new StorageError('io', 'flaky');
        return m.write(k, d);
      },
    };
    const w = writer(flaky);
    await w.acquire();
    await w.rebase(BASE, w.mark(), 0);
    current = w.currentEpoch!;
    await w.stage(NEXT, w.mark(), 0);
    failStaged = true;
    recordN(w, 0, 3);
    expect(await w.flush()).toBe('failed');
    expect(w.persistedCount).toBe(0); // not written to the current epoch either
    expect(w.isDurableThrough(w.mark())).toBe(false);
    failStaged = false;
    expect(await w.flush()).toBe('written');
    expect(w.isDurableThrough(w.mark())).toBe(true);
    expect((await readJournal(m, NS, NEXT))!.entries.length).toBe(3);
    expect((await readJournal(m, NS, BASE))!.entries.length).toBe(3);
  });
});

describe('journal: rotation, compaction, bounds', () => {
  it('rebase truncates: the old epoch is deleted, ops after the snapshot mark carry over', async () => {
    const m = createMemoryBackend();
    const w = writer(m);
    await w.acquire();
    await w.rebase(BASE, w.mark(), 0);
    recordN(w, 0, 5);
    await w.flush();
    const mark = w.mark(); // a save serializes the world here …
    w.record({ t: 150, atAbs: 500, c: cmd(99), ok: true }); // … the player keeps playing while it writes …
    const next: JournalBase = { slotId: 'auto-00c0ffee', payloadSha256: 'd'.repeat(64), tick: 140 };
    expect(await w.rebase(next, mark, 400)).toBe('written'); // … and the save lands
    expect(await readJournal(m, NS, BASE)).toBeNull(); // truncated
    const r = await readJournal(m, NS, next);
    expect(r!.entries.map((e) => e.c)).toEqual([cmd(99)]);
    expect(r!.entries[0].at).toBe(100); // relative to the snapshot moment
    expect((await m.list('journal:')).length).toBe(1);
  });

  it('a slower save finishing after a newer one never rewinds the journal', async () => {
    const m = createMemoryBackend();
    const w = writer(m);
    await w.acquire();
    await w.rebase(BASE, w.mark(), 0);
    const oldMark = w.mark();
    recordN(w, 0, 3);
    const newMark = w.mark();
    recordN(w, 3, 2);
    const newer: JournalBase = { ...BASE, payloadSha256: 'e'.repeat(64), tick: 101 };
    await w.rebase(newer, newMark, 30);
    expect(await w.rebase({ ...BASE, payloadSha256: 'f'.repeat(64) }, oldMark, 10)).toBe('nothing');
    expect(w.currentBase).toEqual(newer);
    expect((await readJournal(m, NS, newer))!.entries.length).toBe(2);
  });

  it('crash during rotation (new epoch written, old not yet deleted): each snapshot still finds its own journal', async () => {
    const inner = createMemoryBackend();
    const ks = new KillSwitch(inner, Number.MAX_SAFE_INTEGER, 'before');
    const w = writer(ks);
    await w.acquire();
    await w.rebase(BASE, w.mark(), 0);
    recordN(w, 0, 4);
    await w.flush();
    const next: JournalBase = { ...BASE, payloadSha256: '9'.repeat(64), tick: 101 };
    const mark = w.mark();
    recordN(w, 4, 2);
    ks.killAt = ks.ops + 1; // op +0 = the new epoch's chunk, op +1 = the listing for the purge → dies there
    await w.rebase(next, mark, 0);
    expect(ks.dead).toBe(true);
    expect((await readJournal(inner, NS, BASE))!.entries.length).toBe(4); // the old snapshot (if the save had not landed)
    expect((await readJournal(inner, NS, next))!.entries.length).toBe(2); // the new snapshot (the save landed)
  });

  it("rebase with purgeOthers 'same-base' (a load that replayed nothing): another epoch on the SAME snapshot is deleted, another snapshot's journal stays", async () => {
    const m = createMemoryBackend();
    const elsewhere: JournalBase = { slotId: 'save-0001', payloadSha256: 'c'.repeat(64), tick: 90 };
    const a = writer(m, { newEpoch: () => 'a'.repeat(16) }); // the journal of another snapshot of this world
    await a.acquire();
    await a.rebase(elsewhere, a.mark(), 0);
    recordN(a, 0, 3);
    await a.flush();
    const b = writer(m, { newEpoch: () => 'b'.repeat(16) }); // a session on BASE: the timeline about to be left
    await b.acquire();
    await b.rebase(BASE, b.mark(), 0, { purgeOthers: false });
    recordN(b, 0, 5);
    await b.flush();
    expect((await readJournal(m, NS, BASE))!.entries.length).toBe(5);
    // BASE is loaded again without replaying b's epoch (a reload while playing): the new writer anchors on BASE too.
    const c = writer(m, { newEpoch: () => 'c'.repeat(16) });
    await c.acquire();
    await c.rebase(BASE, c.mark(), 0, { purgeOthers: 'same-base' });
    expect((await m.list('journal:')).some((k) => k.includes('b'.repeat(16)))).toBe(false); // the left timeline is gone
    recordN(c, 0, 2);
    await c.flush();
    const r = await readJournal(m, NS, BASE);
    expect(r!.epoch).toBe('c'.repeat(16)); // although the left epoch was the longer one
    expect(r!.entries.length).toBe(2);
    expect((await readJournal(m, NS, elsewhere))!.entries.length).toBe(3); // not this snapshot's journal: untouched
  });

  it("a save that rebases the writer WHILE its 'same-base' purge runs still gets its own purge of every other epoch", async () => {
    const m = createMemoryBackend();
    let during: (() => void) | null = null;
    const b: StorageBackend = {
      ...m,
      read: (k) => m.read(k),
      write: (k, d) => m.write(k, d),
      remove: (k) => m.remove(k),
      async list(p) {
        const hook = during;
        during = null;
        await Promise.resolve(); // storage is async: the purge's flush is in flight by now
        hook?.(); // the save lands right while the purge is listing the namespace
        return m.list(p);
      },
    };
    const elsewhere: JournalBase = { slotId: 'save-0001', payloadSha256: 'c'.repeat(64), tick: 90 };
    const a = writer(m, { newEpoch: () => 'a'.repeat(16) }); // the journal of another snapshot of this world
    await a.acquire();
    await a.rebase(elsewhere, a.mark(), 0);
    recordN(a, 0, 3);
    await a.flush();
    a.release();
    const ids = ['c'.repeat(16), 'd'.repeat(16)];
    const c = writer(b, { newEpoch: () => ids.shift()! });
    await c.acquire();
    const NEXT: JournalBase = { ...BASE, payloadSha256: 'e'.repeat(64), tick: 100 };
    // A load that replayed nothing ('same-base' purge) … and an autosave lands during that purge (default: 'all').
    during = () => void c.rebase(NEXT, c.mark(), 0);
    await c.rebase(BASE, c.mark(), 0, { purgeOthers: 'same-base' });
    await c.flush(); // the follow-up flush the save scheduled has run too
    recordN(c, 0, 2);
    await c.flush();
    expect((await readJournal(m, NS, NEXT))!.entries.length).toBe(2);
    // The save supersedes every other epoch of the world: the other snapshot's journal must be gone as well.
    const epochsLeft = new Set((await m.list('journal:')).map((k) => k.split(':')[2]));
    expect([...epochsLeft]).toEqual(['d'.repeat(16)]);
  });

  it(`stays within maxChunks via compaction, and reads back everything`, async () => {
    const m = createMemoryBackend();
    const w = writer(m, { maxChunks: 4 });
    await w.acquire();
    await w.rebase(BASE, w.mark(), 0);
    let n = 0;
    for (let b = 0; b < 25; b++) {
      recordN(w, n, 3);
      n += 3;
      await w.flush();
      expect((await m.list('journal:')).length).toBeLessThanOrEqual(4);
    }
    const r = await readJournal(m, NS, BASE);
    expect(r!.entries.length).toBe(75);
    expectPrefix(r!.entries);
  });

  it('maxEntries: the epoch stops growing (warned once) until the next save rebases it', async () => {
    const m = createMemoryBackend();
    const warns: unknown[] = [];
    const w = writer(m, { maxEntries: 10, logger: { warn: (...a: unknown[]) => warns.push(a) } });
    await w.acquire();
    await w.rebase(BASE, w.mark(), 0);
    recordN(w, 0, 25);
    expect(w.isFull).toBe(true);
    await w.flush();
    expect((await readJournal(m, NS, BASE))!.entries.length).toBe(10);
    expect(warns.length).toBe(1);
    const next = { ...BASE, payloadSha256: '7'.repeat(64), tick: 100 };
    await w.rebase(next, w.mark(), 0);
    expect(w.isFull).toBe(false);
    recordN(w, 0, 3);
    await w.flush();
    expect((await readJournal(m, NS, next))!.entries.length).toBe(3);
  });
});

describe('journal: hostile storage conditions', () => {
  it('quota exceeded: flush fails quietly, ops stay in memory, and everything lands once space is back', async () => {
    let quota = 10_000_000;
    const inner = createMemoryBackend();
    const b: StorageBackend = {
      ...inner,
      id: 'memory',
      durable: true,
      async write(k, d) {
        if (d.byteLength > quota) throw new StorageError('quota', 'full');
        return inner.write(k, d);
      },
      read: (k) => inner.read(k),
      list: (p) => inner.list(p),
      remove: (k) => inner.remove(k),
    };
    const w = writer(b);
    await w.acquire();
    await w.rebase(BASE, w.mark(), 0);
    recordN(w, 0, 5);
    await w.flush();
    quota = 10;
    recordN(w, 5, 5);
    expect(await w.flush()).toBe('failed');
    expect(w.error).toMatch(/full/);
    expect(w.pendingCount).toBe(5);
    quota = 10_000_000;
    expect(await w.flush()).toBe('written');
    const r = await readJournal(inner, NS, BASE);
    expect(r!.entries.length).toBe(10);
    expectPrefix(r!.entries);
  });

  it('storage cleared mid-session: reads give nothing usable (never a throw); the next save re-anchors it', async () => {
    const m = createMemoryBackend();
    const w = writer(m);
    await w.acquire();
    await w.rebase(BASE, w.mark(), 0);
    recordN(w, 0, 4);
    await w.flush();
    m.store.clear(); // user cleared site data
    recordN(w, 4, 3);
    expect(await w.flush()).toBe('written');
    const r = await readJournal(m, NS, BASE);
    expect(r?.entries.length ?? 0).toBe(0); // entries 0-3 are gone: nothing after them can be trusted
    const next = { ...BASE, payloadSha256: '3'.repeat(64), tick: 102 };
    const mark = w.mark();
    recordN(w, 7, 2);
    await w.rebase(next, mark, 0);
    expect((await readJournal(m, NS, next))!.entries.length).toBe(2);
  });

  it('two windows: only the lock holder writes; the other takes over (and purges) once the first is gone', async () => {
    const m = createMemoryBackend();
    const mgr = new FakeLockManager();
    const locks = webLocksOver(mgr);
    const a = writer(m, { locks, newEpoch: () => 'a'.repeat(16) });
    const b = writer(m, { locks, newEpoch: () => 'b'.repeat(16) });
    expect(await a.acquire()).toBe(true);
    expect(await b.acquire()).toBe(false);
    await a.rebase(BASE, a.mark(), 0);
    await b.rebase(BASE, b.mark(), 0);
    recordN(a, 0, 3);
    recordN(b, 0, 2);
    expect(await a.flush()).toBe('written');
    expect(await b.flush()).toBe('not-holder');
    expect((await m.list('journal:')).every((k) => k.includes('a'.repeat(16)))).toBe(true);
    await a.dispose();
    expect(await b.acquire()).toBe(true);
    expect(await b.flush()).toBe('written');
    const keys = await m.list('journal:');
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.includes('b'.repeat(16)))).toBe(true); // a's epoch purged by the new holder
  });

  it('clock skew: wall clock jumps both ways, monotonic time even goes backwards — order and replay are unaffected', async () => {
    const m = createMemoryBackend();
    const walls = [5e12, 1e3, -1, Number.NaN, 4e12];
    let wi = 0;
    const w = writer(m, { wallNow: () => walls[wi++ % walls.length] });
    await w.acquire();
    await w.rebase(BASE, w.mark(), 1000);
    const ats = [1500, 900, 400, 3000, 2900];
    ats.forEach((at, i) => w.record({ t: tickOf(i), atAbs: at, c: cmd(i), ok: true }));
    await w.flush();
    recordN(w, 5, 1);
    await w.flush();
    const r = await readJournal(m, NS, BASE);
    expect(r!.entries.length).toBe(6);
    expectPrefix(r!.entries);
    const seen = r!.entries.map((e) => e.at);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0);
  });

  it('performance: 10 000 commands are written in batches and read + verified well under the budget', async () => {
    const m = createMemoryBackend();
    const w = writer(m);
    await w.acquire();
    await w.rebase(BASE, w.mark(), 0);
    const t0 = performance.now();
    for (let b = 0; b < 100; b++) {
      recordN(w, b * 100, 100);
      await w.flush();
    }
    const tWrite = performance.now() - t0;
    const t1 = performance.now();
    const r = await readJournal(m, NS, BASE);
    const tRead = performance.now() - t1;
    expect(r!.entries.length).toBe(10_000);
    expect(tRead).toBeLessThan(1500);
    expect(tWrite).toBeLessThan(5000);
  });
});

describe('an old purge never deletes the current epoch (CI soak seeds 5 and 9, Sol probe 2026-11-12)', () => {
  it('a stage promoted to current while an "all" purge of an older epoch is mid-list keeps its durable chunk', async () => {
    const mem = createMemoryBackend();
    let pauseList = false;
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((r) => (enter = r));
    const gate = new Promise<void>((r) => (release = r));
    const backend: StorageBackend = {
      ...mem,
      list: async (prefix: string) => {
        const keys = await mem.list(prefix);
        if (pauseList) {
          pauseList = false;
          enter();
          await gate;
        }
        return keys;
      },
    };
    const w = writer(backend);
    const epochOf = (): string => (w as unknown as { epoch: string }).epoch;
    expect(await w.acquire()).toBe(true);
    const a = { slotId: 'autosave', payloadSha256: 'a'.repeat(64), tick: 0 };
    const b = { slotId: 'autosave', payloadSha256: 'b'.repeat(64), tick: 1 };
    await w.rebase(a, w.mark(), 0, { purgeOthers: false });
    w.record({ t: 1, atAbs: 1 } as never);
    expect(await w.flush()).toBe('written');
    const oldEpoch = epochOf();
    const mark = w.mark();
    await w.stage(b, mark, 1);
    w.record({ t: 2, atAbs: 2 } as never);
    expect(await w.flush()).toBe('written');
    const stagedEpoch = (w as unknown as { staged: { epoch: string }[] }).staged[0].epoch;
    const current = (await mem.list('')).find((k) => k.includes(`:${stagedEpoch}:`));
    expect(current).toBeTruthy();
    pauseList = true;
    // an older epoch's "all" purge already running, paused at its storage list
    const sweeping = (w as unknown as { purgeOthers(e: string, b: unknown, m: 'all'): Promise<void> }).purgeOthers(oldEpoch, a, 'all');
    await entered;
    await w.rebase(b, mark, 1, { purgeOthers: false }); // the stage becomes the current epoch
    expect(epochOf()).toBe(stagedEpoch);
    release();
    await sweeping;
    expect(await mem.read(current!)).not.toBeNull();
    w.release();
  });
});
