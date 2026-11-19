import { describe, expect, it } from 'vitest';
import type { LedgerEntry } from '../../../src/shared/economy';
import { GENESIS_HASH, emptyTotals, entryHash, planAppend, verifyChain, applyEntry, type AppendRequest } from '../../../src/economy/ledger';

const TS = '2026-11-05T12:00:00.000Z';

async function chainOf(reqs: AppendRequest[]): Promise<LedgerEntry[]> {
  const out: LedgerEntry[] = [];
  const totals = emptyTotals();
  let head = GENESIS_HASH;
  for (const r of reqs) {
    const p = await planAppend(out, totals, head, r, TS);
    if (!p.ok) throw new Error(p.message);
    out.push(p.entry);
    applyEntry(totals, p.entry);
    head = p.entry.hash;
  }
  return out;
}

const grant = (key: string, amount: number): AppendRequest => ({ kind: 'grant', currency: 'bones', amount, key, reason: 'test' });

describe('ledger hash chain', () => {
  it('builds a verifying chain with contiguous seq, linked prevHash and correct totals', async () => {
    const c = await chainOf([grant('g1', 100), grant('g2', 50), { kind: 'spend', currency: 'bones', amount: 120, key: 'spend:item:x:1', reason: 'unlock', entitlements: ['sofa_velvet'] }]);
    const v = await verifyChain(c);
    expect(v.ok).toBe(true);
    expect(v.totals.bones).toBe(30);
    expect([...v.totals.entitlements]).toEqual(['sofa_velvet']);
    expect(c.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(c[0].prevHash).toBe(GENESIS_HASH);
    expect(c[1].prevHash).toBe(c[0].hash);
    const { hash, ...body } = c[2];
    expect(await entryHash(body)).toBe(hash);
  });

  it('detects a tampered amount (hash mismatch) and reports the trustworthy prefix', async () => {
    const c = await chainOf([grant('g1', 10), grant('g2', 20), grant('g3', 30)]);
    const bad = c.map((e) => ({ ...e }));
    bad[1].amount = 20000;
    const v = await verifyChain(bad);
    expect(v.ok).toBe(false);
    expect(v.issue).toBe('hash');
    expect(v.validPrefix).toBe(1);
  });

  it('detects a re-hashed tamper through the chain link (prevHash)', async () => {
    const c = await chainOf([grant('g1', 10), grant('g2', 20), grant('g3', 30)]);
    const bad = c.map((e) => ({ ...e }));
    bad[1].amount = 9999;
    const { hash: _h, ...body } = bad[1];
    bad[1].hash = await entryHash(body); // attacker recomputes this entry's hash…
    const v = await verifyChain(bad);
    expect(v.ok).toBe(false);
    expect(v.issue).toBe('prevHash'); // …but the next entry still links to the old one
    expect(v.validPrefix).toBe(2);
  });

  it('detects reordering and removal from the middle', async () => {
    const c = await chainOf([grant('g1', 10), grant('g2', 20), grant('g3', 30)]);
    expect((await verifyChain([c[0], c[2], c[1]])).ok).toBe(false);
    expect((await verifyChain([c[0], c[2]])).issue).toBe('seq');
    expect((await verifyChain([c[1], c[2]])).ok).toBe(false);
  });

  it('rejects duplicate keys both when planning and when verifying a forged chain', async () => {
    const c = await chainOf([grant('g1', 10)]);
    const v = await verifyChain(c);
    const p = await planAppend(c, v.totals, v.headHash, grant('g1', 10), TS);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.code).toBe('duplicate');
    // Forge: append an entry with a duplicate key but a valid hash/link.
    const forgedBody = { seq: 2, ts: TS, kind: 'grant' as const, currency: 'bones' as const, amount: 10, key: 'g1', reason: 'x', prevHash: c[0].hash };
    const forged = [...c, { ...forgedBody, hash: await entryHash(forgedBody) }];
    expect((await verifyChain(forged)).issue).toBe('duplicateKey');
  });

  it('never lets a client chain hold Grave Gold', async () => {
    const p = await planAppend([], emptyTotals(), GENESIS_HASH, { kind: 'grant', currency: 'gg', amount: 1000, key: 'gg1', reason: 'mint' }, TS);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.code).toBe('serverOnly');
    const body = { seq: 1, ts: TS, kind: 'grant' as const, currency: 'gg' as const, amount: 1000, key: 'gg1', reason: 'x', prevHash: GENESIS_HASH };
    expect((await verifyChain([{ ...body, hash: await entryHash(body) }])).issue).toBe('serverCurrency');
  });

  it('refuses overdrafts, non-integer/negative/NaN/huge amounts and bad keys', async () => {
    const t = emptyTotals();
    for (const amount of [-1, 1.5, Number.NaN, Infinity, 1e9]) {
      const p = await planAppend([], t, GENESIS_HASH, grant('k', amount), TS);
      expect(p.ok).toBe(false);
    }
    expect((await planAppend([], t, GENESIS_HASH, { kind: 'spend', currency: 'bones', amount: 1, key: 's', reason: '' }, TS)).ok).toBe(false);
    for (const key of ['', 'has space', 'a/b', 'x'.repeat(200), '__proto__"']) expect((await planAppend([], t, GENESIS_HASH, grant(key, 1), TS)).ok).toBe(false);
    // A forged spend that overdraws fails verification.
    const body = { seq: 1, ts: TS, kind: 'spend' as const, currency: 'bones' as const, amount: 5, key: 's1', reason: 'x', prevHash: GENESIS_HASH };
    expect((await verifyChain([{ ...body, hash: await entryHash(body) }])).issue).toBe('overdraft');
  });

  it('rejects junk shapes without throwing', async () => {
    for (const junk of [null, 42, 'x', {}, [null], [{}], [{ seq: 1 }], [[1, 2]]]) {
      const v = await verifyChain(junk);
      if (Array.isArray(junk) && junk.length === 0) expect(v.ok).toBe(true);
      else expect(v.ok).toBe(false);
    }
    const c = await chainOf([grant('g1', 1)]);
    expect((await verifyChain([{ ...c[0], extra: 1 }])).issue).toBe('shape');
  });
});
