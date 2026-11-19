import { describe, expect, it } from 'vitest';
import { LEDGER_KEYS, HWM_PROFILE_KEY } from '../../../src/economy/ledgerStore';
import type { StorageBackend } from '../../../src/persistence/contracts';
import { utf8DecodeStrict, utf8Encode } from '../../../src/persistence/bytes';
import { entryHash } from '../../../src/economy/ledger';
import { memory, sharedLocks, windowOn } from './helpers';

const grant = (key: string, amount = 10) => ({ kind: 'grant' as const, currency: 'bones' as const, amount, key, reason: 'test' });

function readRecord(b: ReturnType<typeof memory>, key: string): Record<string, unknown> {
  return JSON.parse(utf8DecodeStrict(b.store.get(key)!)) as Record<string, unknown>;
}

describe('LedgerStore persistence', () => {
  it('starts empty, appends, and reloads the same balance in a fresh instance', async () => {
    const b = memory();
    const w = windowOn(b);
    expect((await w.ledger.load()).status).toBe('empty');
    expect((await w.ledger.append(grant('q1', 30))).ok).toBe(true);
    expect((await w.ledger.append(grant('q2', 12))).ok).toBe(true);
    const again = await windowOn(b).ledger.load();
    expect(again.status).toBe('ok');
    expect(again.totals.bones).toBe(42);
    expect(again.entries.length).toBe(2);
  });

  it('is idempotent by key across instances (reload never double-pays)', async () => {
    const b = memory();
    expect((await windowOn(b).ledger.append(grant('w1:story_firstMeal:1', 30))).ok).toBe(true);
    const r = await windowOn(b).ledger.append(grant('w1:story_firstMeal:1', 30));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('duplicate');
    expect((await windowOn(b).ledger.load()).totals.bones).toBe(30);
  });

  it('duplicate-grant storm: 200 concurrent appends of 20 keys from 4 windows → exactly 20 entries', async () => {
    const b = memory();
    const locks = sharedLocks();
    const wins = [0, 1, 2, 3].map(() => windowOn(b, locks));
    const jobs: Promise<unknown>[] = [];
    for (let i = 0; i < 200; i++) jobs.push(wins[i % 4].ledger.append(grant(`k${i % 20}`, 5)));
    const results = (await Promise.all(jobs)) as { ok: boolean; code?: string }[];
    expect(results.filter((r) => r.ok).length).toBe(20);
    expect(results.filter((r) => !r.ok).every((r) => r.code === 'duplicate')).toBe(true);
    const final = await windowOn(b).ledger.load();
    expect(final.status).toBe('ok');
    expect(final.entries.length).toBe(20);
    expect(final.totals.bones).toBe(100);
  });

  it('concurrent spends from two windows cannot overdraw (state re-read under the lock)', async () => {
    const b = memory();
    const locks = sharedLocks();
    const [a, c] = [windowOn(b, locks), windowOn(b, locks)];
    await a.ledger.append(grant('seed', 100));
    await c.ledger.load(); // c has a stale view: 100 Bones
    const spend = (key: string) => ({ kind: 'spend' as const, currency: 'bones' as const, amount: 80, key, reason: 'x', entitlements: ['sofa_velvet'] });
    const [r1, r2] = await Promise.all([a.ledger.append(spend('s:a')), c.ledger.append(spend('s:c'))]);
    expect([r1.ok, r2.ok].filter(Boolean).length).toBe(1);
    expect((await windowOn(b).ledger.load()).totals.bones).toBe(20);
  });

  it('crash mid-write (primary write throws after backup rotation) keeps the previous good state', async () => {
    const b = memory();
    const w = windowOn(b);
    await w.ledger.append(grant('a', 10));
    await w.ledger.append(grant('b', 10));
    let fail = true;
    const crashing: StorageBackend = { ...b, write: async (k, d) => {
      if (fail && k === LEDGER_KEYS.primary) throw new Error('power cut');
      return b.write(k, d);
    } };
    const cw = windowOn(crashing);
    const r = await cw.ledger.append(grant('c', 10));
    expect(r.ok).toBe(false);
    fail = false;
    const after = await windowOn(b).ledger.load();
    expect(after.status).toBe('ok');
    expect(after.totals.bones).toBe(20);
    // and the interrupted grant can simply be retried
    expect((await windowOn(b).ledger.append(grant('c', 10))).ok).toBe(true);
  });

  it('torn primary (non-atomic backend: half the bytes written) recovers from the backup and repairs storage', async () => {
    const b = memory();
    const w = windowOn(b);
    await w.ledger.append(grant('a', 10));
    await w.ledger.append(grant('b', 15));
    const p = b.store.get(LEDGER_KEYS.primary)!;
    b.store.set(LEDGER_KEYS.primary, p.slice(0, Math.floor(p.length / 2)));
    const s = await windowOn(b).ledger.load();
    expect(s.status).toBe('recovered');
    expect(s.totals.bones).toBe(10); // the backup = state before the last write
    expect(s.issues.join(' ')).toMatch(/damaged/);
    expect(b.store.has(LEDGER_KEYS.quarantine)).toBe(true);
    expect((await windowOn(b).ledger.load()).status).toBe('ok'); // primary was rewritten
  });

  it('detects a record edited with a recomputed record checksum but a broken chain', async () => {
    const b = memory();
    const w = windowOn(b);
    await w.ledger.append(grant('a', 10));
    await w.ledger.append(grant('b', 10));
    const rec = readRecord(b, LEDGER_KEYS.primary);
    const entries = rec.entries as Record<string, unknown>[];
    entries[1].amount = 5000;
    const { sha256: _s, ...body } = rec;
    const { canonicalJson } = await import('../../../src/persistence/canonicalJson');
    const { sha256Hex } = await import('../../../src/persistence/sha256');
    const text = canonicalJson(body);
    b.store.set(LEDGER_KEYS.primary, utf8Encode(`${text.slice(0, -1)},"sha256":"${await sha256Hex(text)}"}`));
    const s = await windowOn(b).ledger.load();
    expect(s.status).toBe('recovered');
    expect(s.totals.bones).toBe(10);
  });

  it('detects truncation (entries chopped off the end, chain still valid) via the high-water mark', async () => {
    const b = memory();
    const w = windowOn(b);
    for (const k of ['a', 'b', 'c']) await w.ledger.append(grant(k, 10));
    // Truncate BOTH copies to 1 entry with valid checksums (a careful attacker / a restored old backup).
    const { canonicalJson } = await import('../../../src/persistence/canonicalJson');
    const { sha256Hex } = await import('../../../src/persistence/sha256');
    const rec = readRecord(b, LEDGER_KEYS.primary);
    const entries = (rec.entries as { hash: string }[]).slice(0, 1);
    const body = { format: rec.format, v: rec.v, count: 1, headHash: entries[0].hash, entries };
    const text = canonicalJson(body);
    const bytes = utf8Encode(`${text.slice(0, -1)},"sha256":"${await sha256Hex(text)}"}`);
    b.store.set(LEDGER_KEYS.primary, bytes);
    b.store.set(LEDGER_KEYS.backup, bytes);
    const s = await windowOn(b).ledger.load();
    expect(s.status).toBe('corrupt');
    expect(s.issues.join(' ')).toMatch(/truncated/);
    expect(s.totals.bones).toBe(10);
    expect(await windowOn(b).profile.load(HWM_PROFILE_KEY, { count: 0, headHash: '' })).toMatchObject({ count: 3 });
  });

  it('both copies damaged: keeps the longest verifying prefix and reports corruption (never throws)', async () => {
    const b = memory();
    const w = windowOn(b);
    for (const k of ['a', 'b', 'c', 'd']) await w.ledger.append(grant(k, 10));
    const rec = readRecord(b, LEDGER_KEYS.primary);
    (rec.entries as Record<string, unknown>[])[2].reason = 'edited';
    b.store.set(LEDGER_KEYS.primary, utf8Encode(JSON.stringify(rec)));
    b.store.set(LEDGER_KEYS.backup, utf8Encode('garbage{'));
    const s = await windowOn(b).ledger.load();
    expect(s.status).toBe('corrupt');
    expect(s.entries.length).toBe(2);
    expect(s.totals.bones).toBe(20);
  });

  it('reorder of stored entries is detected', async () => {
    const b = memory();
    const w = windowOn(b);
    for (const k of ['a', 'b', 'c']) await w.ledger.append(grant(k, 10));
    const rec = readRecord(b, LEDGER_KEYS.primary);
    const e = rec.entries as unknown[];
    [e[0], e[1]] = [e[1], e[0]];
    b.store.set(LEDGER_KEYS.primary, utf8Encode(JSON.stringify(rec)));
    expect((await windowOn(b).ledger.load()).status).not.toBe('ok');
  });

  it('a read failure of the backend is reported, not thrown', async () => {
    const broken: StorageBackend = { ...memory(), read: async () => { throw new Error('EIO'); } };
    const w = windowOn(broken);
    const s = await w.ledger.load();
    // An I/O error is not an empty ledger (review R1): reported as 'unavailable', and nothing may be written over it.
    expect(s.status).toBe('unavailable');
    expect(s.issues.length).toBeGreaterThan(0);
    const r = await w.ledger.append(grant('x', 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('io');
  });

  it('entry hashes cover every field (sanity)', async () => {
    const base = { seq: 1, ts: '2026-11-05T00:00:00.000Z', kind: 'grant' as const, currency: 'bones' as const, amount: 1, key: 'k', reason: 'r', prevHash: '0'.repeat(64) };
    const h = await entryHash(base);
    for (const patch of [{ seq: 2 }, { ts: '2026-11-05T00:00:01.000Z' }, { amount: 2 }, { key: 'j' }, { reason: 's' }, { entitlements: ['x'] }]) expect(await entryHash({ ...base, ...patch })).not.toBe(h);
  });
});
