/**
 * Security review 2026-11-05 (docs/security/SECURITY_REVIEW_2026-11-05.md) — adversarial regression tests for the
 * economy findings H-1 / D-1 (Bones minting through forged/shared saves), D-2 / M-2 (age bracket fail-closed, parent
 * gate) and M-1 (local ledger is never authoritative). Each "exploit:" test reproduces the reviewer's attack against
 * the real modules; it failed (minted Bones / reached adult) before the fix.
 */
import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../../src/sim/contracts';
import type { LedgerEntry } from '../../../src/shared/economy';
import { ALL_QUESTS } from '../../../src/sim/content/quests';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { engineRepairHook } from '../../../src/persistence/semanticRepair';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { utf8DecodeStrict, utf8Encode } from '../../../src/persistence/bytes';
import { sha256Hex } from '../../../src/persistence/sha256';
import { ProfileStoreImpl } from '../../../src/persistence/profileStore';
import { EconomyService, PROFILE_KEYS } from '../../../src/economy/service';
import { GENESIS_HASH, MAX_ENTRY_AMOUNT, applyEntry, emptyTotals, planAppend, verifyChain } from '../../../src/economy/ledger';
import { isServerOnlyEntitlement } from '../../../src/economy/entitlements';
import { STORE_SKUS } from '../../../src/economy/skus';
import { REPEATABLE_BONES_PER_DAY, alreadyPaid, profileGrantOf } from '../../../src/economy/grantPolicy';
import { acceptAsAuthoritative, exportLocalLedger } from '../../../src/economy/ledgerTrust';
import { DEFAULT_AGE_PROFILE, resolveStoredAge, sanitizeAgeProfile, sealAgeProfile, type ParentGate } from '../../../src/economy/age';
import type { StorageBackend } from '../../../src/persistence/contracts';
import { makeMeta } from '../persistence/fixtures';
import { jsonClone, newWorld, opts, simOf, systemsWithQuests } from '../quests/helpers';
import { quiet, windowOn } from './helpers';

const T0 = Date.parse('2026-11-05T12:00:00Z');
const silent = { warn: () => undefined, error: () => undefined };
const ONE_OFF = ALL_QUESTS.filter((q) => !q.repeat);
const REPEAT = ALL_QUESTS.filter((q) => q.repeat);
const ONE_OFF_BONES = ONE_OFF.reduce((s, q) => s + q.reward.bones, 0);

function econ(backend: StorageBackend, o: { now?: () => number; parentGate?: ParentGate } = {}): { svc: EconomyService; profile: ProfileStoreImpl } {
  const now = o.now ?? (() => T0);
  const profile = new ProfileStoreImpl(() => Promise.resolve(backend), { logger: quiet, now });
  let r = 777;
  const svc = new EconomyService({ backend: () => Promise.resolve(backend), profile, now, randomU32: () => (r = (r * 1103515245 + 12345) >>> 0), logger: quiet, broadcast: false, ...(o.parentGate ? { parentGate: o.parentGate } : {}) });
  return { svc, profile };
}

/** Recompute both SHA-256s of an edited envelope — they are unkeyed, so anyone can (the reviewer's `reseal`). */
async function reseal(env: Record<string, unknown>): Promise<Uint8Array> {
  env.payloadSha256 = await sha256Hex(canonicalJson(env.payload));
  const h: Record<string, unknown> = Object.create(null);
  for (const [k, v] of Object.entries(env)) if (k !== 'payload' && k !== 'headerSha256') h[k] = v;
  env.headerSha256 = await sha256Hex(canonicalJson(h));
  return utf8Encode(JSON.stringify(env));
}

/** A real exported `.alsave` of a freshly created world (real sim + quests system). */
async function realExport(): Promise<Uint8Array> {
  const systems = systemsWithQuests();
  const sim = simOf(newWorld(opts(31), systems), systems);
  const mgr = new SaveManagerImpl({ backend: createMemoryBackend(), logger: silent, compress: false, repair: engineRepairHook(), now: () => T0 });
  const r = await mgr.save('mine', 'Mine', jsonClone(sim.state), makeMeta());
  if (!r.ok) throw new Error('save failed');
  const ex = await mgr.exportSlot('mine');
  if (!ex) throw new Error('export failed');
  return ex.data;
}

/** The reviewer's forged "free Bones save": fresh worldId, a grant record per quest, cheated=false, huge tick. */
async function forge(exported: Uint8Array, wid: string, withRepeatables: boolean): Promise<Uint8Array> {
  const env = JSON.parse(utf8DecodeStrict(exported)) as { payload: Record<string, unknown> } & Record<string, unknown>;
  const grants = [];
  for (const q of ALL_QUESTS) {
    const n = q.repeat ? (withRepeatables ? 5 : 0) : 1;
    for (let i = 1; i <= n; i++) grants.push({ grantId: `${wid}:${q.id}:${i}`, questId: q.id, instance: i, tick: 0, bones: 0, entitlements: [] });
  }
  env.payload.quests = { version: 1, worldId: wid, active: [], completions: {}, lastEndedDay: {}, pinned: null, grants: grants.slice(-256) };
  if (withRepeatables) env.payload.tick = 10_000_000;
  (env.payload.flags as Record<string, unknown>).cheated = false;
  return reseal(env);
}

const qc = (wid: string, questId: string, instance = 1, bones = 30): SimEvent =>
  ({ type: 'questCompleted', questId, instance, grantId: `${wid}:${questId}:${instance}`, title: questId, grant: { grantId: `${wid}:${questId}:${instance}`, bones, reason: 'x' } }) as SimEvent;
const worldOf = (wid: string, extra: Record<string, unknown> = {}) => ({ seed: 42, tick: 10, flags: {}, quests: { worldId: wid, grants: [], active: [] }, household: { memberIds: [], bills: [] }, agents: {}, objects: {}, relationships: {}, stats: { counters: {}, agent: {} }, ...extra });

describe('H-1 forged / shared saves cannot mint Bones (re-keyed quests.worldId, flags.cheated=false)', () => {
  it('exploit: the reviewer flow — re-key worldId, reseal, import via the real importer, load, reconcile — pays 0 Bones on every import and across 10 forged worlds', async () => {
    const exported = await realExport();
    const backend = createMemoryBackend();
    const { svc } = econ(backend);
    await svc.init();
    const mgr = new SaveManagerImpl({ backend, logger: silent, compress: false, repair: engineRepairHook(), now: () => T0 });
    const kept: boolean[] = [];
    for (let n = 0; n < 10; n++) {
      const wid = `farm-${n}`;
      const r = await mgr.importFile(await forge(exported, wid, n % 2 === 1));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      kept.push((r.world as { quests?: { worldId?: string } }).quests?.worldId === wid);
      // What controller.importSave does after a successful import:
      svc.noteImportedWorld?.(r.world);
      // The player then loads the imported slot (a fresh world object) and plays a frame.
      const loaded = await mgr.load(r.slotId ?? r.info.slotId);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      svc.onFrame({ state: loaded.world } as never);
      await svc.idle();
      expect(svc.wallet.bones, `after forged import #${n}`).toBe(0);
    }
    expect(kept.every(Boolean)).toBe(true); // the importer keeps the forged id — the fix does not depend on it
    expect(svc.wallet.entitlements.has('cosmetic:frame_bone_gilded')).toBe(false);
  }, 60_000);

  it('exploit: a forged world that bypasses the importer (file dropped into the saves folder) is never reconciled; 10 forged worlds pay 0', async () => {
    const exported = await realExport();
    const { svc } = econ(createMemoryBackend());
    await svc.init();
    for (let n = 0; n < 10; n++) {
      const env = JSON.parse(utf8DecodeStrict(await forge(exported, `drop-${n}`, true))) as { payload: unknown };
      svc.onFrame({ state: env.payload } as never);
      await svc.idle();
    }
    expect(svc.wallet.bones).toBe(0);
  }, 60_000);

  it('exploit: one-time quest grants are idempotent per PROFILE — the same story quest completed in 10 different worlds pays once', async () => {
    const { svc } = econ(createMemoryBackend());
    await svc.init();
    const q = ONE_OFF[0];
    for (let n = 0; n < 10; n++) svc.onSimEvents({ state: worldOf(`w${n}`) }, [qc(`w${n}`, q.id, 1, q.reward.bones)]);
    await svc.idle();
    expect(svc.wallet.bones).toBe(q.reward.bones);
    expect(svc.ledgerSnapshot!.entries.map((e) => e.key)).toEqual([`profile:${q.id}:1`]);
  });

  it('exploit: repeatable grants are capped per profile per day across ALL worlds (and the cap resets the next local day)', async () => {
    let now = T0;
    const { svc } = econ(createMemoryBackend(), { now: () => now });
    await svc.init();
    const rep = REPEAT[0];
    for (let n = 0; n < 200; n++) svc.onSimEvents({ state: worldOf(`r${n}`) }, [qc(`r${n}`, rep.id, 1, rep.reward.bones)]);
    await svc.idle();
    const day1 = svc.wallet.bones;
    expect(day1).toBeLessThanOrEqual(REPEATABLE_BONES_PER_DAY);
    expect(day1).toBeGreaterThan(REPEATABLE_BONES_PER_DAY - rep.reward.bones);
    // achievements count against the same cap
    svc.onSimEvents({ state: worldOf('r0') }, [{ type: 'promotion', agentId: 'a1', level: 2, title: 'Boss' } as unknown as SimEvent]);
    await svc.idle();
    expect(svc.wallet.bones).toBe(day1);
    now = T0 + 86_400_000;
    svc.onSimEvents({ state: worldOf('next-day') }, [qc('next-day', rep.id, 1, rep.reward.bones)]);
    await svc.idle();
    expect(svc.wallet.bones).toBe(day1 + rep.reward.bones);
  });

  it('regression: idle() waits for a SLOW drain instead of returning early with grants still queued (loaded-machine flake)', async () => {
    // Every write takes 12 ms: 100 grants need well over the old 200 × 5 ms poll bound, as on a loaded CI box.
    const inner = createMemoryBackend();
    const slow: StorageBackend = { ...inner, id: inner.id, durable: inner.durable, write: async (k, d) => { await new Promise((r) => setTimeout(r, 12)); return inner.write(k, d); } };
    const { svc } = econ(slow);
    await svc.init();
    const rep = REPEAT[0];
    const n = Math.min(100, Math.floor(REPEATABLE_BONES_PER_DAY / rep.reward.bones));
    for (let i = 0; i < n; i++) svc.onSimEvents({ state: worldOf(`s${i}`) }, [qc(`s${i}`, rep.id, 1, rep.reward.bones)]);
    const t0 = Date.now();
    await svc.idle();
    expect(Date.now() - t0).toBeGreaterThan(0);
    expect(svc.wallet.bones).toBe(n * rep.reward.bones);
  }, 60_000);

  it('regression: idle() REJECTS on timeout rather than resolving silently with a partial wallet', async () => {
    const inner = createMemoryBackend();
    let hold = false;
    const stuck: StorageBackend = { ...inner, id: inner.id, durable: inner.durable, write: async (k, d) => { if (hold) await new Promise((r) => setTimeout(r, 400)); return inner.write(k, d); } };
    const { svc } = econ(stuck);
    await svc.init();
    hold = true;
    const rep = REPEAT[0];
    svc.onSimEvents({ state: worldOf('t0') }, [qc('t0', rep.id, 1, rep.reward.bones)]);
    await expect(svc.idle(50)).rejects.toThrow(/timed out after 50 ms/);
    hold = false;
    await svc.idle();
    expect(svc.wallet.bones).toBe(rep.reward.bones);
  }, 30_000);

  it("exploit: a save's flags.cheated=false is never trusted — a world the profile saw cheating stays ineligible after the flag is edited back", async () => {
    const { svc } = econ(createMemoryBackend());
    await svc.init();
    const q = ONE_OFF[1];
    svc.onSimEvents({ state: worldOf('cheater', { flags: { cheated: true } }) }, [qc('cheater', q.id)]);
    await svc.idle();
    expect(svc.wallet.bones).toBe(0);
    svc.onSimEvents({ state: worldOf('cheater', { flags: { cheated: false } }) }, [qc('cheater', q.id)]);
    await svc.idle();
    expect(svc.wallet.bones).toBe(0);
  });

  it('progress contained in an IMPORTED file is not paid retroactively; progress made after the import earns', async () => {
    const { svc } = econ(createMemoryBackend());
    await svc.init();
    const [inFile, later] = [ONE_OFF[2], ONE_OFF[3]];
    const imported = worldOf('imp', { quests: { worldId: 'imp', grants: [], active: [{ questId: inFile.id, instance: 1 }] } });
    svc.noteImportedWorld(imported);
    svc.onSimEvents({ state: imported }, [qc('imp', inFile.id, 1, inFile.reward.bones)]);
    await svc.idle();
    expect(svc.wallet.bones).toBe(0);
    svc.onSimEvents({ state: imported }, [qc('imp', later.id, 1, later.reward.bones)]);
    await svc.idle();
    expect(svc.wallet.bones).toBe(later.reward.bones);
  });

  it('importing a file that reuses a NATIVE world id downgrades it (never reconciled again)', async () => {
    const { svc } = econ(createMemoryBackend());
    await svc.init();
    svc.registerNewWorld(worldOf('mine'));
    expect(svc.worldRegistry.worlds.mine.origin).toBe('native');
    svc.noteImportedWorld(worldOf('mine'));
    expect(svc.worldRegistry.worlds.mine.origin).toBe('imported');
    const q = ONE_OFF[0];
    svc.onFrame({ state: worldOf('mine', { quests: { worldId: 'mine', grants: [{ grantId: `mine:${q.id}:1`, questId: q.id, instance: 1, tick: 1, bones: 0, entitlements: [] }] } }) } as never);
    await svc.idle();
    expect(svc.wallet.bones).toBe(0);
  });

  it('legit: a world created on this profile still reconciles a crash-lost grant, and the registry survives a restart', async () => {
    const b = createMemoryBackend();
    const { svc } = econ(b);
    svc.registerNewWorld(worldOf('home')); // before init: queued, applied once the registry loads
    await svc.init();
    await new Promise((r) => setTimeout(r, 20));
    const { svc: again } = econ(b);
    await again.init();
    expect(again.worldRegistry.worlds.home?.origin).toBe('native');
    const q = ONE_OFF[0];
    again.onFrame({ state: worldOf('home', { quests: { worldId: 'home', grants: [{ grantId: `home:${q.id}:1`, questId: q.id, instance: 1, tick: 1, bones: 0, entitlements: [] }] } }) } as never);
    await again.idle();
    expect(again.wallet.bones).toBe(q.reward.bones);
  });

  it('migration: a one-off quest already paid under a pre-fix world-scoped key is not paid again; nor a repeatable', async () => {
    const b = createMemoryBackend();
    const w = windowOn(b);
    const q = ONE_OFF[0];
    const rep = REPEAT[0];
    expect((await w.ledger.append({ kind: 'grant', currency: 'bones', amount: q.reward.bones, key: `oldworld:${q.id}:1`, reason: 'old' })).ok).toBe(true);
    expect((await w.ledger.append({ kind: 'grant', currency: 'bones', amount: rep.reward.bones, key: `oldworld:${rep.id}:1`, reason: 'old' })).ok).toBe(true);
    const { svc } = econ(b);
    await svc.init();
    svc.onSimEvents({ state: worldOf('newworld') }, [qc('newworld', q.id, 1, q.reward.bones), qc('oldworld', rep.id, 1, rep.reward.bones)]);
    await svc.idle();
    expect(svc.wallet.bones).toBe(q.reward.bones + rep.reward.bones);
    expect(svc.ledgerSnapshot!.entries.length).toBe(2);
  });

  it('grant policy (pure): one-off → profile key; repeatable/achievement → r: world key with its legacy key; junk → null', () => {
    const q = ONE_OFF[0];
    const rep = REPEAT[0];
    expect(profileGrantOf({ grantId: `any-world:${q.id}:1` }, true)).toMatchObject({ key: `profile:${q.id}:1`, cls: 'once' });
    expect(profileGrantOf({ grantId: `any-world:${q.id}:2` }, true)).toBeNull();
    expect(profileGrantOf({ grantId: `w:${rep.id}:3` }, true)).toMatchObject({ key: `r:w:${rep.id}:3`, legacyKeys: [`w:${rep.id}:3`], cls: 'repeatable' });
    expect(profileGrantOf({ grantId: 'w:milestone:a:b:c' }, false)).toMatchObject({ key: 'r:w:milestone:a:b:c', cls: 'repeatable' });
    expect(profileGrantOf({ grantId: 'bad id' }, true)).toBeNull();
    const once = profileGrantOf({ grantId: `x:${q.id}:1` }, true)!;
    expect(alreadyPaid(new Set([`w9:${q.id}:1`]), once)).toBe(true);
    expect(alreadyPaid(new Set([`w9:skill:a:${q.id}:1`]), once)).toBe(false); // achievement-shaped key never matches
  });
});

describe('D-2 / M-2 age bracket fails closed', () => {
  const NOW = new Date('2026-11-05T12:00:00Z');
  const adultRecord = { bracket: 'adult', decidedAt: '2026-01-01T00:00:00.000Z', spendCapCents: 2500, spentThisMonthCents: 0, spendMonth: null };

  it('exploit: wiping only the age record after a decision → under-13 (was: unknown → gate → adult)', async () => {
    const b = createMemoryBackend();
    const { svc } = econ(b);
    await svc.init();
    expect(svc.answerAgeGate(2016)).toBe('ok');
    await svc.ageSettled();
    for (const k of [...b.store.keys()]) if (k.includes(PROFILE_KEYS.age) && !k.includes(PROFILE_KEYS.ageSeen)) b.store.delete(k);
    const { svc: again } = econ(b);
    await again.init();
    expect(again.age.bracket).toBe('under13');
    expect(again.needsAgeGate).toBe(false);
    expect(again.answerAgeGate(1990)).toBe('locked');
    expect(again.ageResolution).toBe('failClosed');
  });

  it('exploit: wiping the age record AND its seal/marker record still fails closed (prefs marker)', async () => {
    const b = createMemoryBackend();
    const { svc } = econ(b);
    await svc.init();
    svc.answerAgeGate(2016);
    await svc.ageSettled();
    for (const k of [...b.store.keys()]) if (k.includes('economy-age')) b.store.delete(k);
    const { svc: again } = econ(b);
    await again.init();
    expect(again.age.bracket).toBe('under13');
  });

  it('exploit: a hand-edited "adult" record with a recomputed ProfileStore checksum fails the seal → under-13', async () => {
    const b = createMemoryBackend();
    const { svc, profile } = econ(b);
    await svc.init();
    svc.answerAgeGate(2016);
    await svc.ageSettled();
    // The editor rewrites the record through a ProfileStore (= recomputes the unkeyed checksum) but cannot fix the seal.
    const stored = await profile.load<Record<string, unknown>>(PROFILE_KEYS.age, {});
    await profile.save(PROFILE_KEYS.age, { ...stored, bracket: 'adult', spendCapCents: 2500 });
    // ... or drops the seal entirely (an "old format" record on a sealed install).
    const { svc: a } = econ(b);
    await a.init();
    expect(a.age.bracket).toBe('under13');
    await a.ageSettled();
    const { profile: p2 } = econ(b);
    await p2.save(PROFILE_KEYS.age, adultRecord);
    const { svc: c } = econ(b);
    await c.init();
    expect(c.age.bracket).toBe('under13');
  });

  it('a sealed record verifies and survives restarts; corrupt bytes on disk → under-13', async () => {
    const b = createMemoryBackend();
    const { svc } = econ(b);
    await svc.init();
    svc.answerAgeGate(1990);
    await svc.ageSettled();
    const { svc: again } = econ(b);
    await again.init();
    expect(again.age.bracket).toBe('adult');
    expect(again.ageResolution).toBe('stored');
    for (const k of [...b.store.keys()]) if (k.startsWith(`profile:${PROFILE_KEYS.age}`) && !k.includes('seen')) b.store.set(k, utf8Encode('{"garbage":'));
    const { svc: c } = econ(b);
    await c.init();
    expect(c.age.bracket).toBe('under13');
  });

  it('fresh install (no records at all) still shows the gate — the documented offline limit of a FULL wipe', async () => {
    const { svc } = econ(createMemoryBackend());
    await svc.init();
    expect(svc.age.bracket).toBe('unknown');
    expect(svc.needsAgeGate).toBe(true);
  });

  it('exploit: a storage READ FAILURE is not a fresh install → under-13 for the session, nothing overwritten (was: unknown → gate → adult, saved)', async () => {
    const b = createMemoryBackend();
    const { svc } = econ(b);
    await svc.init();
    expect(svc.answerAgeGate(2016)).toBe('ok');
    await svc.ageSettled();
    const ageRecords = () => JSON.stringify([...b.store].filter(([k]) => k.startsWith('profile:economy-age') || k.startsWith('profile:economy-prefs')).map(([k, v]) => [k, utf8DecodeStrict(v)]));
    const before = ageRecords();
    // Every read throws (a locked / unreadable saves folder); writes still reach the same store.
    const broken: StorageBackend = { ...b, read: async () => { throw new Error('EIO'); } };
    const { svc: again } = econ(broken);
    await again.init();
    expect(again.age.bracket).toBe('under13');
    expect(again.needsAgeGate).toBe(false);
    expect(again.ageResolution).toBe('failClosed');
    expect(again.answerAgeGate(1990)).toBe('locked');
    await again.ageSettled();
    // The records that could not be read were left alone: the next start with working storage resolves them as stored.
    expect(ageRecords()).toBe(before);
    const { svc: later } = econ(b);
    await later.init();
    expect(later.age.bracket).toBe('under13');
    expect(later.ageResolution).toBe('stored');
  });

  it('race: a read that fails ONCE (the re-probe would succeed) still fails closed; so does an unreadable primary with an empty backup', async () => {
    const b = createMemoryBackend();
    const { svc } = econ(b);
    await svc.init();
    expect(svc.answerAgeGate(2016)).toBe('ok');
    await svc.ageSettled();
    // Transient: every age, marker and prefs key throws on its first read only (prefs holds the 'decided' marker, which
    // would otherwise catch this on its own).
    const seen = new Set<string>();
    const flaky: StorageBackend = {
      ...b,
      read: async (k: string) => {
        if (/economy-(age|prefs)/.test(k) && !seen.has(k)) {
          seen.add(k);
          throw new Error('EBUSY');
        }
        return b.read(k);
      },
    };
    const { svc: again } = econ(flaky);
    await again.init();
    expect(again.needsAgeGate).toBe(false);
    expect(again.age.bracket).toBe('under13');
    expect(again.ageResolution).toBe('failClosed');
    // Partial: primaries unreadable, backups absent.
    const partial: StorageBackend = {
      ...b,
      read: async (k: string) => {
        if (/economy-(age|prefs)/.test(k) && !k.endsWith(':bak')) throw new Error('EIO');
        if (/economy-(age|prefs).*:bak$/.test(k)) return null;
        return b.read(k);
      },
    };
    const { svc: third } = econ(partial);
    await third.init();
    expect(third.needsAgeGate).toBe(false);
    expect(third.ageResolution).toBe('failClosed');
  });

  // Finding 14, fallback variant. Lead decision 2026-11-12: child mode for the session, nothing written.
  it('exploit: desktop app that fell back to browser storage (saves folder unavailable) shows no gate over a record it never read', async () => {
    // window.afterlifeNative exists (this IS the desktop app) but the session's backend is not the Electron one:
    // backends/select.ts moves on to IndexedDB when the saves folder cannot be listed, and that store has no age records.
    const g = globalThis as { window?: unknown };
    const prev = g.window;
    g.window = { afterlifeNative: { platform: 'win32', version: '1', storage: { read: async () => { throw new Error('[io] EPERM'); } } } };
    try {
      const { svc } = econ({ ...createMemoryBackend(), id: 'indexeddb' });
      await svc.init();
      expect(svc.needsAgeGate).toBe(false);
      expect(svc.age.bracket).toBe('under13');
    } finally {
      if (prev === undefined) delete g.window;
      else g.window = prev;
    }
  });

  it('migration: a pre-seal (legacy) record on an install without markers is kept and sealed; old saves keep their bracket', async () => {
    const b = createMemoryBackend();
    const { profile } = econ(b);
    await profile.save(PROFILE_KEYS.age, adultRecord);
    const { svc } = econ(b);
    await svc.init();
    expect(svc.age.bracket).toBe('adult');
    expect(svc.ageResolution).toBe('legacy');
    await svc.ageSettled();
    const { svc: again } = econ(b);
    await again.init();
    expect(again.age.bracket).toBe('adult');
    expect(again.ageResolution).toBe('stored');
  });

  it('pure resolve: missing-but-decided / unverifiable / junk → under13, never adult', async () => {
    const salt = 'ab'.repeat(16);
    const sentinel = { v: 1, decided: true, salt };
    const sealed = await sealAgeProfile({ ...DEFAULT_AGE_PROFILE, bracket: 'adult', decidedAt: NOW.toISOString() }, salt);
    expect((await resolveStoredAge({ record: sealed, sentinel, prefsDecided: true })).profile.bracket).toBe('adult');
    expect((await resolveStoredAge({ record: sealed, sentinel: null, prefsDecided: false })).profile.bracket).toBe('under13');
    expect((await resolveStoredAge({ record: { ...sealed, bracket: 'teen' }, sentinel, prefsDecided: true })).profile.bracket).toBe('under13');
    expect((await resolveStoredAge({ record: null, sentinel, prefsDecided: false })).profile.bracket).toBe('under13');
    expect((await resolveStoredAge({ record: null, sentinel: null, prefsDecided: true })).profile.bracket).toBe('under13');
    expect((await resolveStoredAge({ record: null, sentinel: null, prefsDecided: false })).profile.bracket).toBe('unknown');
    expect((await resolveStoredAge({ record: 'junk', sentinel: null, prefsDecided: false })).profile.bracket).toBe('under13');
    expect(sanitizeAgeProfile({ bracket: 'adult' }).bracket).toBe('under13'); // reviewer's "cleared" record
  });

  it('spend-cap changes and older brackets need the parent gate, which fails closed with no parent set up', async () => {
    const { svc } = econ(createMemoryBackend());
    await svc.init();
    svc.answerAgeGate(2010); // teen
    expect(await svc.setSpendCap(10_000)).toBe('parentRequired');
    expect(svc.age.spendCapCents).toBe(2500);
    expect(await svc.changeAgeBracket(1990)).toBe('parentRequired');
    expect(svc.age.bracket).toBe('teen');
    expect(await svc.changeAgeBracket(2018)).toBe('ok'); // younger: allowed
    expect(svc.age.bracket).toBe('under13');
    // A configured parent gate (Phase 4 seam) is the only way through.
    const approve: ParentGate = { configured: true, authorize: () => Promise.resolve(true) };
    const { svc: p } = econ(createMemoryBackend(), { parentGate: approve });
    await p.init();
    p.answerAgeGate(2010);
    expect(await p.setSpendCap(5000)).toBe('ok');
    expect(p.age.spendCapCents).toBe(5000);
  });

  it('exploit: a second window that loaded before the first answer cannot move the stored bracket older', async () => {
    const b = createMemoryBackend();
    const { svc: a } = econ(b);
    const { svc: t } = econ(b);
    await Promise.all([a.init(), t.init()]); // both still show the gate
    expect(a.answerAgeGate(2016)).toBe('ok'); // child: stored and sealed
    await a.ageSettled();
    t.answerAgeGate(1990); // this window never heard about it: its own copy still says 'unknown'
    await t.ageSettled();
    const { svc: c } = econ(b);
    await c.init();
    expect(c.age.bracket).toBe('under13'); // was: 'adult' (new salt + adult record written over the child one)
    expect(t.age.bracket).toBe('under13'); // the stale window lands on the stored bracket too
    expect(t.needsAgeGate).toBe(false);
  });

  it('exploit: the same stale window after the age record and its seal were wiped still cannot write adult (stored prefs marker)', async () => {
    const b = createMemoryBackend();
    const { svc: a } = econ(b);
    const { svc: t } = econ(b);
    await Promise.all([a.init(), t.init()]);
    a.answerAgeGate(2016);
    await a.ageSettled();
    for (const k of [...b.store.keys()]) if (k.includes('economy-age')) b.store.delete(k);
    t.answerAgeGate(1990); // its own copy of the prefs has no decided marker either
    await t.ageSettled();
    const { svc: c } = econ(b);
    await c.init();
    expect(c.age.bracket).toBe('under13');
    expect(t.age.bracket).toBe('under13');
  });

  it('the storage re-check refuses only unapproved OLDER writes: a stale window may still move younger, a parent-approved older bracket is stored', async () => {
    const b = createMemoryBackend();
    const { svc: a } = econ(b);
    const { svc: t } = econ(b);
    await Promise.all([a.init(), t.init()]);
    a.answerAgeGate(1990);
    await a.ageSettled();
    t.answerAgeGate(2016); // younger than what the other window stored: applies, sealed with the stored salt
    await t.ageSettled();
    const { svc: c } = econ(b);
    await c.init();
    expect(c.age.bracket).toBe('under13');
    expect(c.ageResolution).toBe('stored');
    const approve: ParentGate = { configured: true, authorize: () => Promise.resolve(true) };
    const { svc: p } = econ(b, { parentGate: approve });
    await p.init();
    expect(await p.changeAgeBracket(1990)).toBe('ok');
    await p.ageSettled();
    const { svc: d } = econ(b);
    await d.init();
    expect(d.age.bracket).toBe('adult');
    expect(d.ageResolution).toBe('stored');
  });
});

describe('M-1 the local ledger is accepted locally but always flagged unverified', () => {
  it('a forged 500k chain built with planAppend verifies and loads, but carries trust "local-unverified" and is refused as authoritative', async () => {
    const chain: LedgerEntry[] = [];
    const t = emptyTotals();
    let head = GENESIS_HASH;
    const bonesSold = [...new Set(STORE_SKUS.filter((s) => s.priceBones !== undefined).flatMap((s) => s.contents.map((c) => c.contentId)))].filter((e) => !isServerOnlyEntitlement(e)).slice(0, 64);
    for (let i = 0; i < 5; i++) {
      const p = await planAppend(chain, t, head, { kind: 'grant', currency: 'bones', amount: MAX_ENTRY_AMOUNT, key: `forged:${i}`, reason: 'x', ...(i === 0 ? { entitlements: bonesSold } : {}) }, '2026-11-05T00:00:00.000Z');
      expect(p.ok).toBe(true);
      if (!p.ok) return;
      chain.push(p.entry);
      applyEntry(t, p.entry);
      head = p.entry.hash;
    }
    expect((await verifyChain(chain)).ok).toBe(true);
    const b = createMemoryBackend();
    const text = canonicalJson({ format: 'afterlife-lease-ledger', v: 1, count: chain.length, headHash: head, entries: chain });
    b.store.set('economy:ledger:primary', utf8Encode(`${text.slice(0, -1)},"sha256":"${await sha256Hex(text)}"}`));
    const w = windowOn(b);
    const st = await w.ledger.load();
    expect(st.status).toBe('ok'); // accepted locally (by design: a client cannot keep a secret)
    expect(st.totals.bones).toBe(500_000);
    expect(st.trust).toBe('local-unverified');
    const exp = exportLocalLedger(st);
    expect(exp.trust).toBe('local-unverified');
    expect(acceptAsAuthoritative(exp)).toMatchObject({ ok: false, reason: 'local-unverified' });
    expect(acceptAsAuthoritative(st)).toMatchObject({ ok: false, reason: 'local-unverified' });
    expect(acceptAsAuthoritative({ ...exp, trust: 'server-verified' })).toMatchObject({ ok: false, reason: 'no-verifier' });
    const { svc } = econ(b);
    await svc.init();
    expect(svc.wallet.trust).toBe('local-unverified');
    expect(svc.wallet.gg).toBeNull(); // Grave Gold stays server-only
  });
});
