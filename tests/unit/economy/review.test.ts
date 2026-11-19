/**
 * Adversarial review regressions (economy foundation review, 2026-11-05). Each block reproduces a defect found in
 * review; see docs/contract-requests/economy.md "R-series" for the write-up.
 */
import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../../src/sim/contracts';
import type { StorageBackend } from '../../../src/persistence/contracts';
import { ENTITLEMENT_ID_RE } from '../../../src/shared/economy';
import { ALL_QUESTS } from '../../../src/sim/content/quests';
import { validateQuests } from '../../../src/sim/systems/quests/validate';
import { loadContent } from '../../../src/sim/index';
import { grantsFromEvents, reconcileGrants } from '../../../src/economy/grants';
import { ENTITLEMENT_RE, emptyTotals, planAppend, GENESIS_HASH } from '../../../src/economy/ledger';
import { isServerOnlyEntitlement } from '../../../src/economy/entitlements';
import { STORE_SKUS } from '../../../src/economy/skus';
import { memory, service, windowOn } from './helpers';

const grant = (key: string, amount = 10) => ({ kind: 'grant' as const, currency: 'bones' as const, amount, key, reason: 'test' });
const world = (extra: Record<string, unknown> = {}) => ({ seed: 42, tick: 10, flags: {}, quests: { worldId: 'w16-abc', grants: [] }, household: { memberIds: [], bills: [] }, agents: {}, objects: {}, relationships: {}, stats: { counters: {}, agent: {} }, ...extra });

/** Backend whose reads fail (transiently) while `failing` is set — e.g. an IndexedDB hiccup or a locked file. */
function flaky(inner: StorageBackend): StorageBackend & { failing: boolean } {
  const b = {
    ...inner,
    failing: false,
    async read(key: string) {
      if (b.failing && key.startsWith('economy:ledger:')) throw new Error('EIO: transient read failure');
      return inner.read(key);
    },
    write: inner.write.bind(inner),
  };
  return b;
}

describe('R1 ledger: a transient READ error is not corruption (must never rewrite the ledger)', () => {
  it('append during a read outage fails with io and keeps every entry', async () => {
    const mem = memory();
    const b = flaky(mem);
    const w = windowOn(b);
    for (let i = 0; i < 5; i++) expect((await w.ledger.append(grant(`g${i}`, 100))).ok).toBe(true);
    b.failing = true;
    const r = await windowOn(b).ledger.append(grant('during-outage', 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('io');
    b.failing = false;
    const after = await windowOn(b).ledger.load();
    expect(after.status).toBe('ok');
    expect(after.entries.length).toBe(5);
    expect(after.totals.bones).toBe(500);
    // and once storage is back the queued grant is written on top of the full history
    expect((await windowOn(b).ledger.append(grant('during-outage', 1))).ok).toBe(true);
    expect((await windowOn(b).ledger.load()).totals.bones).toBe(501);
  });

  it('load during a read outage reports a problem but does not claim the ledger is gone', async () => {
    const b = flaky(memory());
    const w = windowOn(b);
    await w.ledger.append(grant('a', 7));
    b.failing = true;
    const s = await windowOn(b).ledger.load();
    expect(s.issues.length).toBeGreaterThan(0);
    b.failing = false;
    expect((await windowOn(b).ledger.load()).totals.bones).toBe(7);
  });

  it('a damaged primary that gets overwritten is quarantined first (diagnostics are never lost)', async () => {
    const b = memory();
    const w = windowOn(b);
    await w.ledger.append(grant('a', 7));
    await w.ledger.append(grant('b', 7));
    const bad = new Uint8Array([123, 34, 120]); // '{"x' — torn
    b.store.set('economy:ledger:primary', bad);
    b.store.delete('economy:ledger:backup');
    await windowOn(b).ledger.append(grant('c', 1));
    expect(b.store.get('economy:ledger:quarantine')).toEqual(bad);
  });
});

describe('R2 entitlement id grammar is ONE contract (sim quest content ↔ economy ledger)', () => {
  it('every shipped quest reward entitlement passes the shared grammar and survives grantsFromEvents', () => {
    expect(ENTITLEMENT_RE).toBe(ENTITLEMENT_ID_RE);
    const ents = ALL_QUESTS.flatMap((q) => q.reward.entitlements ?? []);
    expect(ents.length).toBeGreaterThan(0);
    for (const e of ents) expect(ENTITLEMENT_ID_RE.test(e), e).toBe(true);
    for (const q of ALL_QUESTS) {
      if (!q.reward.entitlements?.length) continue;
      const ev = { type: 'questCompleted', questId: q.id, instance: 1, grantId: `w1:${q.id}:1`, title: q.title, grant: { grantId: `w1:${q.id}:1`, bones: q.reward.bones, reason: 'x', entitlements: q.reward.entitlements } } as SimEvent;
      expect(grantsFromEvents([ev], world())[0].entitlements, q.id).toEqual(q.reward.entitlements);
    }
  });

  it('the sim quest validator rejects an entitlement the ledger could not store', () => {
    const base = ALL_QUESTS.find((q) => q.reward.entitlements?.length)!;
    const errs = validateQuests([{ ...base, requires: [], reward: { bones: 5, entitlements: ['cosmetic:frame_boneGilded'] } }], loadContent());
    expect(errs.join('\n')).toMatch(/entitlement/);
  });

  it('the story finale cosmetic actually reaches the wallet', async () => {
    const s = service(memory());
    await s.init();
    const q = ALL_QUESTS.find((x) => x.reward.entitlements?.length)!;
    const gid = `w16-abc:${q.id}:1`;
    s.onSimEvents({ state: world() }, [{ type: 'questCompleted', questId: q.id, instance: 1, grantId: gid, title: q.title, grant: { grantId: gid, bones: q.reward.bones, reason: 'x', entitlements: q.reward.entitlements } } as SimEvent]);
    await s.idle();
    for (const e of q.reward.entitlements!) expect(s.wallet.entitlements.has(e), e).toBe(true);
  });
});

describe('R3 nothing sold only for Grave Gold / real money can be unlocked by the local client', () => {
  it('server-only entitlements: every content of a GG/real-money-only SKU, never a Bones-sold one', () => {
    for (const sku of STORE_SKUS) {
      for (const c of sku.contents) {
        if (c.contentId === 'currency:gg') continue;
        const soldForBones = STORE_SKUS.some((o) => o.priceBones !== undefined && o.contents.some((x) => x.contentId === c.contentId));
        expect(isServerOnlyEntitlement(c.contentId), `${sku.id} → ${c.contentId}`).toBe(!soldForBones);
      }
    }
    expect(isServerOnlyEntitlement('cosmetic:frame_bone_gilded')).toBe(false);
  });

  it('planAppend refuses a local entry carrying a premium entitlement', async () => {
    const p = await planAppend([], emptyTotals(), GENESIS_HASH, { kind: 'grant', currency: 'bones', amount: 1, key: 'x:1', reason: 'r', entitlements: ['rug_funeral'] }, '2026-11-05T12:00:00.000Z');
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.code).toBe('serverOnly');
  });

  it('an edited save (forged quests.grants) cannot unlock premium items or mint arbitrary Bones', async () => {
    const s = service(memory());
    await s.init();
    const forged = [
      { grantId: 'w16-abc:story_firstMeal:1', questId: 'story_firstMeal', instance: 1, tick: 5, bones: 1000, entitlements: ['rug_funeral', 'boost:skip_night', 'body:gold'] },
      { grantId: 'w16-abc:made_up_quest:1', questId: 'made_up_quest', instance: 1, tick: 5, bones: 1000, entitlements: [] },
      { grantId: 'other-world:story_firstMeal:1', questId: 'story_firstMeal', instance: 1, tick: 5, bones: 30, entitlements: [] },
      ...Array.from({ length: 200 }, (_, i) => ({ grantId: `w16-abc:story_firstMeal:${i + 2}`, questId: 'story_firstMeal', instance: i + 2, tick: 5, bones: 1000, entitlements: [] })),
    ];
    // Even a world this profile created (the only kind ever reconciled — security review H-1) is paid from definitions.
    s.registerNewWorld(world());
    s.onFrame({ state: world({ quests: { worldId: 'w16-abc', grants: forged } }) } as never);
    await s.idle();
    const firstMeal = ALL_QUESTS.find((q) => q.id === 'story_firstMeal')!;
    // exactly the content reward of the one legitimate (non-repeatable, instance 1) completion
    expect(s.wallet.bones).toBe(firstMeal.reward.bones);
    expect(s.buyLock('rug_funeral').state).toBe('hidden');
    expect(s.wallet.entitlements.has('boost:skip_night')).toBe(false);
  });

  it('a hand-edited ledger with a premium entitlement still does not unlock it (wallet ignores server-only ids)', async () => {
    const b = memory();
    const w = windowOn(b);
    // Bypass planAppend the way an editor would: write a valid, re-hashed chain directly.
    const { entryHash } = await import('../../../src/economy/ledger');
    const body = { seq: 1, ts: '2026-11-05T12:00:00.000Z', kind: 'grant' as const, currency: 'bones' as const, amount: 1, key: 'edit:1', reason: 'x', entitlements: ['rug_funeral'], prevHash: GENESIS_HASH };
    const entry = { ...body, hash: await entryHash(body) };
    const { canonicalJson } = await import('../../../src/persistence/canonicalJson');
    const { sha256Hex } = await import('../../../src/persistence/sha256');
    const { utf8Encode } = await import('../../../src/persistence/bytes');
    const text = canonicalJson({ format: 'afterlife-lease-ledger', v: 1, count: 1, headHash: entry.hash, entries: [entry] });
    b.store.set('economy:ledger:primary', utf8Encode(`${text.slice(0, -1)},"sha256":"${await sha256Hex(text)}"}`));
    expect((await w.ledger.load()).status).toBe('ok');
    const s = service(b);
    await s.init();
    expect(s.wallet.bones).toBe(1);
    expect(s.buyLock('rug_funeral').state).toBe('hidden');
  });
});

describe('R4 save compatibility: a pre-economy save (no quests block) loads with zero warnings and pays nothing', () => {
  it('SaveManager + engine repair: no warnings, no console noise; the economy reconciles nothing from it', async () => {
    const { SaveManagerImpl } = await import('../../../src/persistence/saveManager');
    const { createMemoryBackend } = await import('../../../src/persistence/backends/memory');
    const { engineRepairHook } = await import('../../../src/persistence/semanticRepair');
    const { makeMeta } = await import('../persistence/fixtures');
    const { newWorld, opts, systemsWithout, jsonClone } = await import('../quests/helpers');
    const { QUESTS_SYSTEM_ID } = await import('../../../src/sim/systems/quests');
    const old = jsonClone(newWorld(opts(77), systemsWithout(QUESTS_SYSTEM_ID)));
    expect('quests' in old).toBe(false);
    const warns: unknown[] = [];
    const logger = { warn: (...a: unknown[]) => void warns.push(a), error: (...a: unknown[]) => void warns.push(a) };
    const mgr = new SaveManagerImpl({ backend: createMemoryBackend(), logger, repair: engineRepairHook() });
    expect((await mgr.save('old', 'Old', old, makeMeta())).ok).toBe(true);
    const loaded = await mgr.load('old');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.warnings).toEqual([]);
    expect(warns).toEqual([]);
    expect('quests' in loaded.world).toBe(false);
    expect(reconcileGrants(loaded.world as never)).toEqual([]);
  });
});

describe('R3b reconcileGrants (pure) — save records are validated against quest content', () => {
  const q1 = ALL_QUESTS.find((q) => !q.repeat)!;
  const rep = ALL_QUESTS.find((q) => q.repeat)!;
  const rec = (questId: string, instance: number, grantId = `w16-abc:${questId}:${instance}`) => ({ grantId, questId, instance, tick: 1, bones: 999, entitlements: ['rug_funeral'] });
  it('pays the definition reward; rejects unknown quests, wrong ids, bad instances, cheated worlds', () => {
    const w = (grants: unknown[], extra: Record<string, unknown> = {}) => ({ ...world(), tick: 0, quests: { worldId: 'w16-abc', grants }, ...extra });
    expect(reconcileGrants(w([rec(q1.id, 1)]))).toEqual([{ grantId: `w16-abc:${q1.id}:1`, bones: q1.reward.bones, reason: `Quest complete: ${q1.title}`, ...(q1.reward.entitlements ? { entitlements: q1.reward.entitlements } : {}) }]);
    expect(reconcileGrants(w([rec(q1.id, 2)]))).toEqual([]); // one-off quest, second instance
    expect(reconcileGrants(w([rec('nope', 1)]))).toEqual([]);
    expect(reconcileGrants(w([rec(q1.id, 1, 'other:x:1')]))).toEqual([]);
    expect(reconcileGrants(w([rec(q1.id, 1.5)]))).toEqual([]);
    expect(reconcileGrants(w([rec(q1.id, 1)], { flags: { cheated: true } }))).toEqual([]);
    // repeatable: at most one instance per cooldown since day 0 (day 0 → only instance 1)
    expect(reconcileGrants(w([rec(rep.id, 1), rep && rec(rep.id, 2)])).map((g) => g.grantId)).toEqual([`w16-abc:${rep.id}:1`]);
    expect(reconcileGrants(w([rec(q1.id, 1), rec(q1.id, 1)]))).toHaveLength(1);
  });
});

describe('R7 exact top-up (MONETIZATION.md §8) is computed for a short GG balance', () => {
  it('950 GG Season Lease with 0 / 900 / 950 GG', async () => {
    const { exactTopUp } = await import('../../../src/economy/pricing');
    expect(exactTopUp(0, 950)).toMatchObject({ shortGG: 950, exactCents: 941 });
    expect(exactTopUp(900, 950)).toMatchObject({ shortGG: 50, exactCents: 50 });
    expect(exactTopUp(950, 950)).toBeNull();
  });
});
