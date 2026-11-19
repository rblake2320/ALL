import { describe, expect, it } from 'vitest';
import { migratePayload, MIGRATIONS, validateMigrationRegistry, type Migration } from '../../../src/persistence/migrations';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { SAVE_SCHEMA_VERSION } from '../../../src/sim/types';
import { makeMeta, makeWorld, silentLogger } from './fixtures';

function countingRegistry(counter: Record<string, number>): Migration[] {
  return [
    {
      from: 1,
      to: 2,
      describe: 'add mood cache',
      migrate(p) {
        counter['1->2'] = (counter['1->2'] ?? 0) + 1;
        const flags = p.flags as Record<string, unknown>;
        flags.migratedTo2 = true;
        flags.runs12 = ((flags.runs12 as number | undefined) ?? 0) + 1; // data-level application count
      },
    },
    {
      from: 2,
      to: 3,
      describe: 'rename',
      migrate(p) {
        counter['2->3'] = (counter['2->3'] ?? 0) + 1;
        return { ...p, flags: { ...(p.flags as Record<string, unknown>), migratedTo3: true } };
      },
    },
  ];
}

describe('migration registry', () => {
  it('the shipped registry is well-formed and reaches SAVE_SCHEMA_VERSION', () => {
    expect(validateMigrationRegistry(MIGRATIONS)).toEqual([]);
    const r = migratePayload({ schemaVersion: 1 }, 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
  });

  it('chains steps in order, stamps schemaVersion, applies each exactly once', () => {
    const counter: Record<string, number> = {};
    const r = migratePayload({ schemaVersion: 1, flags: {} }, 1, countingRegistry(counter), 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.schemaVersion).toBe(3);
    expect(r.payload.flags).toEqual({ migratedTo2: true, migratedTo3: true, runs12: 1 });
    expect(counter).toEqual({ '1->2': 1, '2->3': 1 });
    expect(r.applied).toEqual(['v1->v2 (add mood cache)', 'v2->v3 (rename)']);
    // Re-running on the migrated payload is a no-op (idempotent).
    const again = migratePayload(r.payload, 3, countingRegistry(counter), 3);
    expect(again.ok && again.applied).toEqual([]);
    expect(counter).toEqual({ '1->2': 1, '2->3': 1 });
  });

  it('starts mid-chain', () => {
    const counter: Record<string, number> = {};
    const r = migratePayload({ schemaVersion: 2, flags: {} }, 2, countingRegistry(counter), 3);
    expect(r.ok).toBe(true);
    expect(counter).toEqual({ '2->3': 1 });
  });

  it('refuses future versions, gaps, overshoots, throwing and broken steps', () => {
    const fut = migratePayload({}, 9, [], 3);
    expect(!fut.ok && fut.code).toBe('future_version');
    const gap = migratePayload({}, 1, [{ from: 2, to: 3, migrate() {} }], 3);
    expect(!gap.ok && gap.code).toBe('invalid');
    const over = migratePayload({}, 1, [{ from: 1, to: 5, migrate() {} }], 3);
    expect(!over.ok && over.error).toMatch(/overshoots/);
    const boom = migratePayload({}, 1, [
      {
        from: 1,
        to: 2,
        migrate() {
          throw new Error('kaboom');
        },
      },
    ], 2);
    expect(!boom.ok && boom.error).toMatch(/kaboom/);
    const nonObj = migratePayload({}, 1, [{ from: 1, to: 2, migrate: () => [] as unknown as Record<string, unknown> }], 2);
    expect(!nonObj.ok && nonObj.error).toMatch(/non-object/);
    expect(migratePayload({}, 0).ok).toBe(false);
    expect(migratePayload({}, 1.5).ok).toBe(false);
    expect(validateMigrationRegistry([{ from: 1, to: 1, migrate() {} }, { from: 1, to: 2, migrate() {} }]).length).toBeGreaterThanOrEqual(2);
  });
});

describe('migration through the SaveManager', () => {
  it('a v1 save loads migrated to v3 once; re-saving stores v3 so later loads apply nothing', async () => {
    const backend = createMemoryBackend();
    const v1 = new SaveManagerImpl({ backend, schemaVersion: 1, migrations: [], logger: silentLogger });
    // A schema-v1 world as the v1 build wrote it; makeWorld() follows the current schema.
    const v1World = { ...makeWorld(), schemaVersion: 1 };
    expect((await v1.save('slot1', 'Old', v1World, makeMeta())).ok).toBe(true);

    const counter: Record<string, number> = {};
    // Newer build: schema v3, its validator still accepts the payload shape (flags are free-form).
    const v3 = new SaveManagerImpl({ backend, schemaVersion: 3, migrations: countingRegistry(counter), logger: silentLogger });
    const loaded = await v3.load('slot1');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.world.schemaVersion).toBe(3);
    expect(loaded.world.flags).toMatchObject({ migratedTo2: true, migratedTo3: true, runs12: 1 });
    // A schema upgrade is reported as `migrated`, never as a warning (the game shows warnings as "Save recovered").
    expect(loaded.migrated).toEqual(['v1->v2 (add mood cache)', 'v2->v3 (rename)']);
    expect(loaded.warnings).toEqual([]);
    expect(counter).toEqual({ '1->2': 1, '2->3': 1 });

    // Saving dry-runs the chain once on a throwaway copy of the OLD primary (rotation safety check:
    // only a loadable primary may replace the backup) — that is why migrations must be pure.
    expect((await v3.save('slot1', 'Old', loaded.world, makeMeta())).ok).toBe(true);
    expect(counter).toEqual({ '1->2': 2, '2->3': 2 });
    const again = await v3.load('slot1');
    expect(again.ok).toBe(true);
    expect(counter).toEqual({ '1->2': 2, '2->3': 2 }); // the stored save is v3: nothing runs on load
    if (again.ok) {
      expect(again.migrated).toEqual([]);
      expect(again.warnings).toEqual([]);
      expect(again.world.flags.runs12).toBe(1); // applied to the persisted data exactly once
      expect(again.world.schemaVersion).toBe(3);
    }
    // The backup (rotated old primary) is still the untouched v1 original.
    const backupWorld = await v3.load('slot1');
    expect(backupWorld.ok).toBe(true);

    // ...and the old build now refuses it as a future version rather than mangling it.
    const oldAgain = await v1.load('slot1');
    expect(!oldAgain.ok && oldAgain.code).toBe('future_version');
    // ...and refuses to overwrite it.
    const overwrite = await v1.save('slot1', 'Old', v1World, makeMeta());
    expect(overwrite.ok).toBe(false);
    if (!overwrite.ok) expect(overwrite.error).toMatch(/newer version/);
    expect((await v3.load('slot1')).ok).toBe(true);
  });
});

describe('an update of the game is not a problem with the save (shipped registry)', () => {
  it('load and import report the upgrade in `migrated`, with no warning of their own', async () => {
    expect(SAVE_SCHEMA_VERSION).toBeGreaterThan(1); // otherwise this test proves nothing
    const backend = createMemoryBackend();
    const old = new SaveManagerImpl({ backend, schemaVersion: 1, migrations: [], logger: silentLogger });
    expect((await old.save('slot1', 'Old', { ...makeWorld(), schemaVersion: 1 }, makeMeta())).ok).toBe(true);
    const file = await old.exportSlot('slot1');
    expect(file).not.toBeNull();

    const now = new SaveManagerImpl({ backend, logger: silentLogger });
    const loaded = await now.load('slot1');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.world.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(loaded.migrated!.length).toBe(SAVE_SCHEMA_VERSION - 1); // one step per version
    expect(loaded.migrated![0]).toMatch(/^v1->v2/);
    expect(loaded.warnings).toEqual([]);
    expect(loaded.info.recoveredFromBackup).toBe(false);

    // The exported .alsave from the old build, imported into an empty profile of the current build.
    const fresh = new SaveManagerImpl({ backend: createMemoryBackend(), logger: silentLogger });
    const imported = await fresh.importFile(file!.data);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.world.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(imported.migrated!.length).toBe(SAVE_SCHEMA_VERSION - 1);
    expect(imported.warnings).toEqual([]);
    // The import stored the upgraded world: loading it again upgrades nothing.
    const reloaded = await fresh.load(imported.info.slotId);
    expect(reloaded.ok && reloaded.migrated).toEqual([]);

    // Loading must not have rewritten the old save: the old build still reads its own file.
    const untouched = await old.load('slot1');
    expect(untouched.ok && untouched.world.schemaVersion).toBe(1);
  });

  it('a real problem is still a warning when the save is also upgraded', async () => {
    const backend = createMemoryBackend();
    const old = new SaveManagerImpl({ backend, schemaVersion: 1, migrations: [], logger: silentLogger });
    expect((await old.save('slot1', 'Old', { ...makeWorld(), schemaVersion: 1 }, makeMeta())).ok).toBe(true);
    const repair = async (world: ReturnType<typeof makeWorld>) => ({ world, warnings: ['object o9 was off-lot'] });
    const now = new SaveManagerImpl({ backend, logger: silentLogger, repair });
    const loaded = await now.load('slot1');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.warnings).toEqual(['object o9 was off-lot']);
    expect(loaded.migrated!.length).toBe(SAVE_SCHEMA_VERSION - 1);
  });
});
