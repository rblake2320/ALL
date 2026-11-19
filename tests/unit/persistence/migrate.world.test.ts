/**
 * AC-7 / AC-22 (W-025 S2, docs/DESIGN_WORLD_LEVELS.md §1.11, §1.15): schema v1 → v2 → v3 migration on the REAL
 * persistence stack and the REAL engine, adversarially:
 *  - every schema-v1 fixture written by the pre-world build (derelict mid-Act-1, starter, empty; with and without a
 *    W-119 journal) loads into v3 with ZERO warnings and zero engine repairs, `lot` / `objects` / `agents` /
 *    `household` / `quests` (and every other field) deep-equal to the stored v1 payload, home at `wormwood:mildew_n2`;
 *  - its v1 journal replays onto the migrated world with zero divergence and reproduces the old engine's live world;
 *  - every lot template; idempotence (load twice, resave + reload, re-running the chain); corrupted / truncated current saves;
 *    unknown future versions refused cleanly; a crash at any point of a current-schema write leaves the previous good copy.
 */
import { describe, expect, it } from 'vitest';
import { createNewWorld, createSimulation } from '../../../src/sim/index';
import type { WorldState } from '../../../src/sim/types';
import { SAVE_SCHEMA_VERSION } from '../../../src/sim/types';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { noLocks } from '../../../src/persistence/locks';
import { engineRepairHook } from '../../../src/persistence/semanticRepair';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { buildEnvelope } from '../../../src/persistence/envelope';
import { utf8Encode } from '../../../src/persistence/bytes';
import { gzipBytes } from '../../../src/persistence/gzip';
import { MIGRATION_V2_V3, MIGRATIONS, migratePayload } from '../../../src/persistence/migrations';
import { validateWorld } from '../../../src/persistence/validation';
import { readJournal } from '../../../src/persistence/journal';
import { replayEntries } from '../../../src/game/journal';
import { legacyTown } from '../../../src/shared/town';
import { legacyReferenceWorld } from '../world/legacyReference';
import { LEGACY_HOME_LOT_ID } from '../../../src/shared/world';
import { ac1Options, ac1Projection, ac1SaveHash } from '../world/ac1Harness';
import { backendOf, fixture, rawV1Payload, V1, V1_NAMES } from '../world/v1Fixtures';
import acceptedReplay from '../world/fixtures/v1.accepted-00794ea-pets-outdoors-replay.json';
import { FaultyBackend, makeMeta } from './fixtures';

const silent = { warn: () => undefined, error: () => undefined };
const mgr = (backend: ConstructorParameters<typeof SaveManagerImpl>[0]['backend'], over: Partial<ConstructorParameters<typeof SaveManagerImpl>[0]> = {}) =>
  new SaveManagerImpl({ backend, logger: silent, locks: noLocks, repair: engineRepairHook(), ...over });
const strip = (w: unknown) => {
  const c = JSON.parse(JSON.stringify(w)) as Record<string, unknown>;
  delete c.town;
  delete c.jobs;
  delete c.schemaVersion;
  return c;
};

describe('AC-7: schema-v1 fixtures from the pre-world build load into schema v3', () => {
  it('the fixture set: one per template, with and without a journal, all schema v1 from fd20992', () => {
    expect(V1.engine).toBe('fd20992');
    expect(V1.schemaVersion).toBe(1);
    expect(V1_NAMES).toEqual(['derelict', 'derelict+journal', 'empty', 'empty+journal', 'starter', 'starter+journal']);
    expect(fixture('derelict').quests.some((q) => q.startsWith('act1_'))).toBe(true); // mid-Act-1
    expect(fixture('starter').compressed).toBe(true); // gzip-stored saves are covered too
  });

  for (const name of V1_NAMES) {
    it(`${name}: zero warnings, zero repairs, every v1 field deep-equal, home at the legacy slot`, async () => {
      const f = fixture(name);
      const raw = await rawV1Payload(f);
      const res = await mgr(backendOf(f)).load(f.slotId);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.warnings).toEqual([]);
      expect(res.payloadSha256).toBe(f.snapshotSha); // the journal anchor is the STORED snapshot
      const w = res.world;
      expect(w.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
      for (const k of ['lot', 'objects', 'agents', 'household', 'quests'] as const) expect(w[k], k).toEqual(raw[k]);
      expect(strip(w)).toEqual(strip(raw)); // ...and every other field
      expect(w.town).toEqual(legacyTown(raw.seed, raw.tick));
      expect(w.town?.homeLotId).toBe(LEGACY_HOME_LOT_ID);
      expect(w.town?.expandPending).toBe(true);
      expect(ac1SaveHash(w)).toBe(f.snapshotHash);
      const sim = createSimulation(w);
      expect(sim.repairWarnings).toEqual([]);
      expect(sim.faults()).toEqual([]);
    });
  }

  for (const name of V1_NAMES.filter((n) => n.endsWith('+journal'))) {
    it(`${name}: the v1 journal replays with zero divergence and matches the independent accepted pet-enabled engine`, async () => {
      const f = fixture(name);
      const backend = backendOf(f);
      const res = await mgr(backend).load(f.slotId);
      if (!res.ok) throw new Error(res.error);
      const replayStart = structuredClone(res.world);
      const sim = createSimulation(res.world);
      const rec = await readJournal(backend, f.slotId, { slotId: f.slotId, payloadSha256: res.payloadSha256!, tick: res.world.tick }, { logger: silent });
      expect(rec).not.toBeNull();
      expect(rec!.stoppedBecause).toBeNull();
      const r = await replayEntries(sim, rec!.entries, { now: () => 0 });
      expect(r).toMatchObject({ applied: rec!.entries.length, stopped: null, diverged: false });
      expect(rec!.entries.filter((e) => e.c !== undefined).length).toBe(f.journal!.commands);
      expect(sim.state.tick).toBe(f.journal!.endTick);
      // The accepted base adds persistent pets and the earlier _mess0 guard. Record its actual replay independently,
      // keep every historical v1 byte/hash, and compare complete pet state rather than hiding the added feature.
      expect(acceptedReplay.engine).toBe('00794ead432a550e6bef79d96a8553097fdd3064');
      const reference = acceptedReplay.runs.find(run => run.name === name);
      expect(reference).toBeDefined();
      expect(r.applied).toBe(reference!.applied);
      // Historical comparison excludes only #105's inert accounting; the current replay comparison stays complete.
      expect(ac1SaveHash(legacyReferenceWorld(sim.state))).toBe(reference!.hash);
      const again = createSimulation(replayStart);
      const repeated = await replayEntries(again, rec!.entries, { now: () => 0 });
      expect(repeated).toMatchObject({ applied: r.applied, stopped: null, diverged: false });
      expect(canonicalJson(again.serialize())).toBe(canonicalJson(sim.serialize()));
      expect(sim.state.pets).toEqual(reference!.pets);
      expect(sim.state.town?.expandPending).toBe(true); // streaming stayed frozen through the v1 journal
      expect(sim.dispatch({ type: 'townExpand' })).toEqual({ ok: true }); // then the game opens the world
    });
  }

  it('the journal of a v1 save is bound to the STORED (v1) snapshot: a different anchor finds nothing to replay', async () => {
    const f = fixture('derelict+journal');
    const backend = backendOf(f);
    const res = await mgr(backend).load(f.slotId);
    if (!res.ok) throw new Error(res.error);
    const wrong = await readJournal(backend, f.slotId, { slotId: f.slotId, payloadSha256: ac1SaveHash(res.world).replace(/^./, 'f'), tick: res.world.tick }, { logger: silent });
    expect(!wrong || wrong.entries.length === 0).toBe(true);
  });
});

describe('migration over every lot template, idempotence and re-saves', () => {
  for (const tpl of ['derelict', 'starter', 'empty'] as const) {
    for (const seed of [3, 4242]) {
      it(`${tpl} seed ${seed}: v1 world → v2 with zero warnings; load twice / resave + reload / re-run the chain: identical`, async () => {
        const v1World = ac1Projection(createNewWorld(ac1Options(tpl, seed)));
        expect(v1World.schemaVersion).toBe(1);
        const backend = createMemoryBackend();
        expect((await mgr(backend, { schemaVersion: 1, migrations: [], repair: null }).save('slot1', 'old', v1World, makeMeta())).ok).toBe(true);
        const m = mgr(backend);
        const a = await m.load('slot1');
        const b = await m.load('slot1');
        if (!a.ok || !b.ok) throw new Error('load failed');
        expect(a.warnings).toEqual([]);
        expect(canonicalJson(a.world)).toBe(canonicalJson(b.world)); // loading twice: identical
        expect(strip(a.world)).toEqual(strip(v1World));
        expect(a.world.town).toEqual(legacyTown(seed, 0));
        // resave (now a v2 envelope) + reload: identical, and nothing migrates any more
        expect((await m.save('slot1', 'new', a.world, makeMeta())).ok).toBe(true);
        const c = await m.load('slot1');
        if (!c.ok) throw new Error(c.error);
        expect(canonicalJson(c.world)).toBe(canonicalJson(a.world));
        expect(c.warnings).toEqual([]);
        const d = await m.load('slot1');
        expect(d.ok && canonicalJson(d.world)).toBe(canonicalJson(a.world));
        // the chain is a no-op on v2 and pure on v1 (dry-runs on copies give equal results)
        const again = migratePayload(JSON.parse(canonicalJson(c.world)) as Record<string, unknown>, SAVE_SCHEMA_VERSION);
        expect(again.ok && again.applied).toEqual([]);
        const p1 = migratePayload(JSON.parse(JSON.stringify(v1World)) as Record<string, unknown>, 1);
        const p2 = migratePayload(JSON.parse(JSON.stringify(v1World)) as Record<string, unknown>, 1);
        expect(p1.ok && p2.ok && canonicalJson(p1.payload)).toBe(p2.ok ? canonicalJson(p2.payload) : '');
        // the old copy rotated into the backup is the untouched v1 original and still loads (migrated) if needed
        backend.store.set('slot:slot1:primary', new Uint8Array([1, 2, 3]));
        const e = await m.load('slot1');
        expect(e.ok && e.info.recoveredFromBackup).toBe(true);
      });
    }
  }

  it('the authorized jobs/world chain is pure and adds missing blocks without recovery warnings', () => {
    expect(MIGRATIONS.map((x) => `${x.from}->${x.to}`)).toEqual(['1->2', '2->3']);
    expect(SAVE_SCHEMA_VERSION).toBe(3);
    expect(MIGRATION_V2_V3.silent).toBe(true);
    const p: Record<string, unknown> = { schemaVersion: 1, seed: 9, tick: 77 };
    const r = migratePayload(p, 1);
    expect(r.ok && r.announced).toEqual(['v1->v2 (household jobs)']);
    expect(r.ok && r.applied).toEqual(['v1->v2 (household jobs)', 'v2->v3 (walkable world: home lot at Mildew Lane slot n2)']);
    expect(p.town).toEqual(legacyTown(9, 77));
    // defensive: a damaged v1 payload still migrates (validation repairs the world's own fields afterwards)
    const junk: Record<string, unknown> = { schemaVersion: 1, seed: 'x', tick: -5 };
    expect(migratePayload(junk, 1).ok).toBe(true);
    expect(junk.town).toEqual(legacyTown(0, 0));
  });

  it('a schema-v1 world handed straight to a v3 SaveManager is upgraded on save (header and payload never disagree)', async () => {
    const backend = createMemoryBackend();
    const v1World = ac1Projection(createNewWorld(ac1Options('empty', 8)));
    const m = mgr(backend);
    expect((await m.save('slot1', 'x', v1World, makeMeta())).ok).toBe(true);
    const l = await m.load('slot1');
    expect(l.ok && l.world.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(l.ok && l.world.town).toEqual(legacyTown(8, 0));
    const future = { ...v1World, schemaVersion: SAVE_SCHEMA_VERSION + 1 };
    const r = await m.save('slot2', 'x', future, makeMeta());
    expect(!r.ok && r.code).toBe('invalid');
  });
});

describe('damaged and foreign v2 saves', () => {
  async function v2Bytes(compress: boolean): Promise<{ backend: ReturnType<typeof createMemoryBackend>; world: WorldState }> {
    const backend = createMemoryBackend();
    const world = createNewWorld(ac1Options('starter', 12));
    const m = mgr(backend, { compress });
    expect((await m.save('slot1', 'a', world, makeMeta())).ok).toBe(true);
    expect((await m.save('slot1', 'b', world, makeMeta())).ok).toBe(true); // now also has a backup
    return { backend, world };
  }

  for (const compress of [false, true]) {
    it(`truncated / bit-flipped v2 (${compress ? 'gzip' : 'plain'}): never throws; falls back to the backup; without one reports corrupt`, async () => {
      const { backend, world } = await v2Bytes(compress);
      const good = backend.store.get('slot:slot1:primary')!;
      const expected = canonicalJson(world);
      const cuts = [1, 10, Math.floor(good.length / 3), Math.floor(good.length / 2), good.length - 1];
      for (const cut of cuts) {
        backend.store.set('slot:slot1:primary', good.slice(0, cut));
        const l = await mgr(backend).load('slot1');
        expect(l.ok, `cut ${cut}`).toBe(true);
        if (l.ok) {
          expect(l.info.recoveredFromBackup).toBe(true);
          expect(canonicalJson(l.world)).toBe(expected);
        }
      }
      const flipped = good.slice();
      flipped[Math.floor(flipped.length * 0.6)] ^= 0x20;
      backend.store.set('slot:slot1:primary', flipped);
      const lf = await mgr(backend).load('slot1');
      expect(lf.ok && lf.info.recoveredFromBackup).toBe(true);
      const backup = backend.store.get('slot:slot1:backup')!;
      backend.store.delete('slot:slot1:backup');
      for (const cut of cuts) {
        backend.store.set('slot:slot1:primary', good.slice(0, cut));
        const l = await mgr(backend).load('slot1');
        expect(l.ok, `cut ${cut} without backup`).toBe(false);
        if (!l.ok) expect(['corrupt', 'invalid']).toContain(l.code);
      }
      backend.store.set('slot:slot1:backup', backup);
    });
  }

  async function sealed(payload: Record<string, unknown>, schemaVersion: number, compress = false): Promise<Uint8Array> {
    const env = await buildEnvelope({
      payloadText: canonicalJson(payload),
      schemaVersion,
      gameVersion: 't',
      slotId: 'slot1',
      name: 'forged',
      createdAt: '2026-01-01T00:00:00.000Z',
      savedAt: '2026-01-02T00:00:00.000Z',
      playMinutes: 1,
      meta: makeMeta(),
    });
    const bytes = utf8Encode(env.text);
    return compress ? gzipBytes(bytes) : bytes;
  }

  it('a checksum-valid v2 with a damaged town: the town is dropped / repaired with notes; the home lot is untouched', async () => {
    const world = createNewWorld(ac1Options('derelict', 21)) as WorldState & Record<string, unknown>;
    const cases: [string, (t: Record<string, unknown>) => void, RegExp, 'dropped' | 'kept'][] = [
      ['v: 3', (t) => (t.v = 3), /neighbourhood data reset/, 'dropped'],
      ['homeLotId junk', (t) => (t.homeLotId = 'NOT A REGION'), /neighbourhood data reset/, 'dropped'],
      ['town is a string', () => undefined, /neighbourhood data reset/, 'dropped'],
      ['snapshot garbage', (t) => ((t.regions as Record<string, Record<string, unknown>>)[LEGACY_HOME_LOT_ID].snapshot = { savedTick: 1, lot: 'x', objects: {}, data: {} }), /snapshot dropped/, 'kept'],
      ['home missing from ownedLotIds and active set', (t) => {
        t.ownedLotIds = [];
        (t.stream as Record<string, unknown>).active = [];
      }, /home missing/, 'kept'],
      ['trip arrives before it departs', (t) => (t.trip = { to: 'graveyard:old_graveyard', agents: [], departTick: 50, arriveTick: 10 }), /trip/, 'kept'],
    ];
    for (const [label, mutate, note, outcome] of cases) {
      const w = JSON.parse(JSON.stringify(world)) as Record<string, unknown>;
      if (label === 'town is a string') w.town = 'hello';
      else mutate(w.town as Record<string, unknown>);
      const backend = createMemoryBackend();
      backend.store.set('slot:slot1:primary', await sealed(w, SAVE_SCHEMA_VERSION));
      const l = await mgr(backend).load('slot1');
      expect(l.ok, label).toBe(true);
      if (!l.ok) continue;
      expect(l.warnings.join(' | '), label).toMatch(note);
      expect(l.world.lot, label).toEqual(world.lot);
      expect(l.world.objects, label).toEqual(world.objects);
      expect(l.world.agents, label).toEqual(world.agents);
      if (outcome === 'dropped') expect('town' in l.world, label).toBe(false);
      else expect(l.world.town?.homeLotId, label).toBe(world.town!.homeLotId);
      const sim = createSimulation(l.world); // and the engine runs it
      sim.step();
      expect(sim.faults(), label).toEqual([]);
    }
  });

  it('agents / objects with a malformed regionId fall back to the home region (dropped with a note)', async () => {
    const world = createNewWorld(ac1Options('starter', 22)) as WorldState;
    const w = JSON.parse(JSON.stringify(world)) as WorldState;
    const aid = w.household.memberIds[0];
    (w.agents[aid] as unknown as Record<string, unknown>).regionId = 'Bad Region!';
    const v = validateWorld(w);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.warnings.join(' ')).toMatch(/region \(back to the home region\)/);
    expect('regionId' in v.world.agents[aid]).toBe(false);
    // a well-formed foreign region id is kept as is (S4 worlds), never rewritten
    (w.agents[aid] as unknown as Record<string, unknown>).regionId = 'wormwood:mildew_n3';
    const v2 = validateWorld(w);
    expect(v2.ok && v2.world.agents[aid].regionId).toBe('wormwood:mildew_n3');
    expect(v2.ok && v2.warnings).toEqual([]);
  });

  it('an unknown FUTURE schema is refused cleanly (load, import, overwrite) — never a crash, never a downgrade', async () => {
    const world = createNewWorld(ac1Options('empty', 23)) as WorldState & Record<string, unknown>;
    for (const compress of [false, true]) {
      const backend = createMemoryBackend();
      const payload = { ...JSON.parse(JSON.stringify(world)), schemaVersion: SAVE_SCHEMA_VERSION + 1, town: { v: 3, somethingNew: true } };
      backend.store.set('slot:slot1:primary', await sealed(payload, SAVE_SCHEMA_VERSION + 1, compress));
      const m = mgr(backend);
      const l = await m.load('slot1');
      expect(l.ok).toBe(false);
      if (!l.ok) {
        expect(l.code).toBe('future_version');
        expect(l.error).toContain(`schema v${SAVE_SCHEMA_VERSION + 1}`);
      }
      const imp = await m.importFile(await sealed(payload, SAVE_SCHEMA_VERSION + 1, compress));
      expect(!imp.ok && imp.code).toBe('future_version');
      const over = await m.save('slot1', 'x', world, makeMeta());
      expect(over.ok).toBe(false);
      expect(backend.store.get('slot:slot1:primary')).toBeDefined(); // the newer save is left alone
      expect(await m.listSlots()).toBeInstanceOf(Array);
    }
    // and a pre-world (schema-v1) build refuses a v2 save the same way
    const backend = createMemoryBackend();
    expect((await mgr(backend).save('slot1', 'x', world, makeMeta())).ok).toBe(true);
    const old = await mgr(backend, { schemaVersion: 1, migrations: [] }).load('slot1');
    expect(!old.ok && old.code).toBe('future_version');
  });
});

describe('crash safety: a kill during a v2 write leaves the previous good copy readable', () => {
  it('slot holding a migrated v1 save; the first v2 write crashes at every operation × every mode → old or new, never neither', async () => {
    const f = fixture('empty');
    const OLD = await mgr(backendOf(f)).load(f.slotId);
    if (!OLD.ok) throw new Error(OLD.error);
    const OLD_C = canonicalJson(OLD.world);
    // NEW: the migrated world opened (townExpand) and a region snapshot written (the v2 shape at its fullest)
    const sim = createSimulation(JSON.parse(JSON.stringify(OLD.world)) as WorldState);
    expect(sim.dispatch({ type: 'townExpand' }).ok).toBe(true);
    for (let i = 0; i < 60; i++) sim.step();
    const NEW = sim.serialize();
    NEW.town!.regions['street:mildew:2'] = {
      id: 'street:mildew:2',
      snapshot: { savedTick: NEW.tick, lot: JSON.parse(JSON.stringify(NEW.lot)), objects: {}, data: { dirt: 1 } },
      caughtUpTick: NEW.tick,
      firstActiveTick: 10,
    };
    const NEW_C = canonicalJson(NEW);
    // count the operations of one v2 save over the v1 slot
    const probe = new FaultyBackend(backendOf(f));
    await new SaveManagerImpl({ backend: probe, logger: silent, locks: noLocks }).save(f.slotId, 'new', NEW, makeMeta());
    const n = probe.log.length;
    expect(n).toBeGreaterThanOrEqual(4);
    const outcomes = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      for (const mode of ['before', 'after', 'torn'] as const) {
        const backend = new FaultyBackend(backendOf(f));
        backend.arm(i, mode);
        const r = await new SaveManagerImpl({ backend, logger: silent, locks: noLocks }).save(f.slotId, 'new', NEW, makeMeta());
        const after = mgr(new FaultyBackend(backend.inner));
        const l = await after.load(f.slotId);
        expect(l.ok, `crash ${mode} at op ${i} (${backend.log[backend.log.length - 1]}) lost the save`).toBe(true);
        if (!l.ok) continue;
        const c = canonicalJson(l.world);
        expect([OLD_C, NEW_C], `crash ${mode} at op ${i} loaded a third world`).toContain(c);
        const outcome = c === NEW_C ? 'new' : 'old';
        if (r.ok) expect(outcome).toBe('new');
        outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
        // the slot stays usable: a retry lands and loads NEW
        expect((await after.save(f.slotId, 'retry', NEW, makeMeta())).ok).toBe(true);
        const l2 = await mgr(new FaultyBackend(backend.inner)).load(f.slotId);
        expect(l2.ok && canonicalJson(l2.world)).toBe(NEW_C);
      }
    }
    expect(outcomes.get('old')).toBeGreaterThan(0);
    expect(outcomes.get('new')).toBeGreaterThan(0);
    console.log(`[AC-7 crash] ${n} ops × 3 modes: ${[...outcomes].map(([k, v]) => `${k}=${v}`).join(' ')}`);
  }, 120_000);
});
