/** Cloud R1: one v3 migration for the published jobs-v2 and internal world-v2 saves. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import jobsV2 from '../../fixtures/world-batch-merge/jobs-v2.json';
import worldV2 from '../../fixtures/world-batch-merge/world-v2.json';
import provenance from '../../fixtures/world-batch-merge/provenance.json';
import legacyPets from '../../fixtures/world-batch-pets/pets-four-v2-world.json';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { MIGRATIONS, MIGRATION_V2_V3, migratePayload, type RawPayload } from '../../../src/persistence/migrations';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { engineRepairHook } from '../../../src/persistence/semanticRepair';
import { validateWorld } from '../../../src/persistence/validation';
import { PET_LIMITS } from '../../../src/persistence/validation/petsSchema';
import { noLocks } from '../../../src/persistence/locks';
import { createSimulation } from '../../../src/sim';
import { SAVE_SCHEMA_VERSION, type WorldState } from '../../../src/sim/types';
import { legacyTown } from '../../../src/shared/town';
import { backendOf, fixture } from '../world/v1Fixtures';
import { makeMeta, silentLogger } from './fixtures';
import { ac1Projection } from '../world/ac1Harness';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const manager = (backend: ReturnType<typeof createMemoryBackend>) => new SaveManagerImpl({ backend, logger: silentLogger, locks: noLocks, repair: engineRepairHook() });

describe('combined schema-v3 saves', () => {
  it('genuine four-pet v2 save gets only the normal cosmetic default, without repair warnings or repeat changes', () => {
    const result = migratePayload(copy(legacyPets) as unknown as RawPayload, 2);
    if (!result.ok) throw new Error(result.error);
    const expected = { ...legacyPets.pets, pets: legacyPets.pets.pets.map(p => ({ ...p, variant: 'normal' })) };
    expect(result.payload.pets).toEqual(expected);
    const validated = validateWorld(result.payload);
    if (!validated.ok) throw new Error(validated.errors.join('; '));
    expect(validated.warnings).toEqual([]);
    expect(validated.world.pets).toEqual(expected);
    const before = canonicalJson(result.payload);
    MIGRATION_V2_V3.migrate(result.payload);
    expect(canonicalJson(result.payload)).toBe(before);
  });

  it('preserves explicit normal/undead looks and lets structural validation report an invalid look', () => {
    const original = copy(legacyPets) as unknown as RawPayload;
    const pets = (original.pets as { pets: Record<string, unknown>[] }).pets;
    pets[0].variant = 'normal';
    pets[1].variant = 'undead';
    pets[2].variant = 'broken';
    pets[3].variant = null;
    const expected = copy(original.pets);
    const result = migratePayload(original, 2);
    if (!result.ok) throw new Error(result.error);
    expect(result.payload.pets).toEqual(expected);
    const validated = validateWorld(result.payload);
    if (!validated.ok) throw new Error(validated.errors.join('; '));
    expect(validated.warnings).toHaveLength(2);
    expect(validated.warnings[0]).toContain('pets.pets[2].variant');
    expect(validated.warnings[1]).toContain('pets.pets[3].variant');
    expect(validated.world.pets!.pets.map(p => p.variant)).toEqual(['normal', 'undead', 'normal', 'normal']);
  });

  it('leaves malformed and oversized pet blocks to validation without unbounded defaulting', () => {
    for (const pets of [null, [], {}, { pets: 'bad' }, { pets: Array.from({ length: PET_LIMITS.maxList + 1 }, () => ({})) }]) {
      const original: RawPayload = { schemaVersion: 2, seed: 1, tick: 0, pets: copy(pets) };
      const expected = copy(pets);
      const result = migratePayload(original, 2);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.payload.pets).toEqual(expected);
    }
  });

  it('uses exactly the authorized chain and genuinely distinct frozen v2 exports', () => {
    expect(SAVE_SCHEMA_VERSION).toBe(3);
    expect(MIGRATIONS.map(m => [m.from, m.to])).toEqual([[1, 2], [2, 3]]);
    expect(worldV2).toHaveProperty('town'); expect(worldV2).not.toHaveProperty('jobs');
    expect(jobsV2).toHaveProperty('jobs'); expect(jobsV2).not.toHaveProperty('town');
    expect(jobsV2.jobs.list).toHaveLength(1);
    for (const f of provenance.exports) expect(createHash('sha256').update(readFileSync(`tests/fixtures/world-batch-merge/${f.file}`)).digest('hex')).toBe(f.sha256);
  });

  for (const [name, value] of [['world-v2', worldV2], ['jobs-v2', jobsV2]] as const) {
    it(`${name}: fills only missing blocks, preserves valid state, and direct step replay is idempotent`, () => {
      const original = copy(value) as unknown as RawPayload;
      const result = migratePayload(copy(original), 2);
      if (!result.ok) throw new Error(result.error);
      expect(result.payload.schemaVersion).toBe(3);
      expect(result.payload.jobs).toEqual(original.jobs ?? { version: 1, nextId: 1, list: [] });
      expect(result.payload.town).toEqual(original.town ?? legacyTown(original.seed, original.tick));
      const before = canonicalJson(result.payload);
      MIGRATION_V2_V3.migrate(result.payload);
      expect(canonicalJson(result.payload)).toBe(before);
      expect(migratePayload(copy(result.payload), 3)).toMatchObject({ ok: true, applied: [] });
    });

    it(`${name}: real SaveManager load → save → load has identical v3 bytes and engine state`, async () => {
      const backend = createMemoryBackend();
      const old = new SaveManagerImpl({ backend, logger: silentLogger, locks: noLocks, schemaVersion: 2, migrations: [], repair: null });
      expect((await old.save('legacy', name, copy(value) as unknown as WorldState, makeMeta())).ok).toBe(true);
      const m = manager(backend);
      const a = await m.load('legacy');
      if (!a.ok) throw new Error(a.error);
      expect(a.warnings).toEqual([]);
      expect(a.world.schemaVersion).toBe(3);
      expect((await m.save('current', name, a.world, makeMeta())).ok).toBe(true);
      const b = await m.load('current');
      if (!b.ok) throw new Error(b.error);
      expect(canonicalJson(b.world)).toBe(canonicalJson(a.world));
      expect((await m.save('again', name, b.world, makeMeta())).ok).toBe(true);
      const c = await m.load('again');
      if (!c.ok) throw new Error(c.error);
      expect(c.payloadSha256).toBe(b.payloadSha256);
      expect(canonicalJson(c.world)).toBe(canonicalJson(a.world));
      const sim = createSimulation(c.world);
      expect(sim.repairWarnings).toEqual([]);
      expect(sim.faults()).toEqual([]);
      if (name === 'world-v2') expect(c.world.town).toEqual(worldV2.town);
      else expect(c.world.jobs).toEqual(jobsV2.jobs);
    });
  }

  it('genuine pre-world v1 save follows both steps and re-saves to stable v3 bytes', async () => {
    const f = fixture('starter');
    const backend = backendOf(f);
    const m = manager(backend);
    const a = await m.load(f.slotId);
    if (!a.ok) throw new Error(a.error);
    expect(a.warnings).toEqual([]);
    expect(a.world.schemaVersion).toBe(3);
    expect(a.world.jobs).toEqual({ version: 1, nextId: 1, list: [] });
    expect(a.world.town).toEqual(legacyTown(a.world.seed, a.world.tick));
    expect((await m.save('v3', 'upgraded', a.world, makeMeta())).ok).toBe(true);
    const b = await m.load('v3');
    if (!b.ok) throw new Error(b.error);
    expect(canonicalJson(b.world)).toBe(canonicalJson(a.world));
  });

  it('v1 cannot inject assignments; a future version is refused without mutation', () => {
    const old = { ...copy(jobsV2), schemaVersion: 1 } as unknown as RawPayload;
    const r = migratePayload(old, 1);
    expect(r.ok && r.payload.jobs).toEqual({ version: 1, nextId: 1, list: [] });
    const future = { ...copy(worldV2), schemaVersion: 4 } as unknown as RawPayload;
    const before = canonicalJson(future);
    expect(migratePayload(future, 4)).toMatchObject({ ok: false, code: 'future_version' });
    expect(canonicalJson(future)).toBe(before);
  });

  it('legacy determinism projection refuses to hide real job assignments', () => {
    expect(() => ac1Projection(copy(jobsV2) as unknown as WorldState)).toThrow('no assigned household jobs');
    const empty = { ...copy(jobsV2), jobs: { version: 1, nextId: 1, list: [] } } as unknown as WorldState;
    expect(ac1Projection(empty)).not.toHaveProperty('jobs');
  });
});
