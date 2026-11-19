/**
 * Crash simulation: a backend that dies at EVERY operation of a save (before applying it, after
 * applying it, or with a torn half-written value that violates atomicity). After each crash a fresh
 * SaveManager (= process restart, no in-memory caches) must load the OLD or the NEW world — never
 * neither, never a mix, never a throw.
 */
import { describe, expect, it } from 'vitest';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { FaultyBackend, makeMeta, makeWorld, silentLogger } from './fixtures';

const OLD = makeWorld(1);
const NEW = makeWorld(2);
const OLD_C = canonicalJson(OLD);
const NEW_C = canonicalJson(NEW);

function restart(backend: FaultyBackend): SaveManagerImpl {
  return new SaveManagerImpl({ backend: new FaultyBackend(backend.inner), logger: silentLogger });
}

async function opsPerSave(prefill: boolean): Promise<number> {
  const b = new FaultyBackend();
  const m = new SaveManagerImpl({ backend: b, logger: silentLogger });
  if (prefill) {
    await m.save('slot1', 'old', OLD, makeMeta());
    await m.save('slot1', 'old', OLD, makeMeta()); // also has a backup now
  }
  b.log.length = 0;
  await new SaveManagerImpl({ backend: b, logger: silentLogger }).save('slot1', 'new', NEW, makeMeta());
  return b.log.length;
}

describe('crash during save — old or new, never neither', () => {
  for (const prefill of [true, false]) {
    it(`${prefill ? 'existing slot (with backup)' : 'first save of a slot'}: every operation x every crash mode`, async () => {
      const n = await opsPerSave(prefill);
      expect(n).toBeGreaterThanOrEqual(4);
      const outcomes = new Map<string, number>();
      for (let i = 0; i < n; i++) {
        for (const mode of ['before', 'after', 'torn'] as const) {
          const backend = new FaultyBackend(createMemoryBackend());
          const m = new SaveManagerImpl({ backend, logger: silentLogger });
          if (prefill) {
            expect((await m.save('slot1', 'old', OLD, makeMeta())).ok).toBe(true);
            expect((await m.save('slot1', 'old', OLD, makeMeta())).ok).toBe(true);
          }
          backend.arm(i, mode);
          const fresh = new SaveManagerImpl({ backend, logger: silentLogger }); // no knownGood cache
          const r = await fresh.save('slot1', 'new', NEW, makeMeta());
          const op = backend.log[backend.log.length - 1];

          const after = restart(backend);
          const l = await after.load('slot1');
          let outcome: string;
          if (l.ok) {
            const c = canonicalJson(l.world);
            expect([OLD_C, NEW_C], `crash ${mode} at op ${i} (${op}) loaded a third world`).toContain(c);
            outcome = c === NEW_C ? 'new' : 'old';
            if (prefill === false) expect(outcome).toBe('new');
          } else {
            // Only a FIRST save may legitimately leave nothing behind: either no file, or (only when the
            // backend violates its atomicity contract) a torn file that is reported as damaged.
            expect(prefill, `crash ${mode} at op ${i} (${op}) lost the old save: ${l.error}`).toBe(false);
            expect(mode === 'torn' ? ['not_found', 'corrupt'] : ['not_found']).toContain(l.code);
            outcome = 'none';
          }
          // A save reported as successful must be what loads.
          if (r.ok) expect(outcome).toBe('new');
          outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);

          // The listing never throws and the slot is usable again: a retry succeeds and loads NEW.
          await after.listSlots();
          expect((await after.save('slot1', 'retry', NEW, makeMeta())).ok).toBe(true);
          const l2 = await restart(backend).load('slot1');
          expect(l2.ok && canonicalJson(l2.world)).toBe(NEW_C);
        }
      }
      if (prefill) expect(outcomes.get('old')).toBeGreaterThan(0);
      expect(outcomes.get('new')).toBeGreaterThan(0);
    });
  }

  it('torn primary AND torn meta in sequence (two crashes) still recovers the old world', async () => {
    const backend = new FaultyBackend(createMemoryBackend());
    const m = new SaveManagerImpl({ backend, logger: silentLogger });
    await m.save('slot1', 'old', OLD, makeMeta());
    await m.save('slot1', 'old', OLD, makeMeta());
    backend.faults = [{ op: 'write', nth: 0, keyIncludes: ':primary', mode: 'torn' }];
    expect((await new SaveManagerImpl({ backend, logger: silentLogger }).save('slot1', 'new', NEW, makeMeta())).ok).toBe(false);
    backend.inner.store.set('slot:slot1:meta', new Uint8Array([123, 34]));
    const l = await restart(backend).load('slot1');
    expect(l.ok && canonicalJson(l.world)).toBe(OLD_C);
    expect(l.ok && l.info.recoveredFromBackup).toBe(true);
  });

  it('crash at every operation of a FRESH IMPORT: existing slots untouched; the import is all-or-nothing', async () => {
    const src = new SaveManagerImpl({ backend: createMemoryBackend(), logger: silentLogger });
    expect((await src.save('src', 'src', NEW, makeMeta())).ok).toBe(true);
    const file = (await src.exportSlot('src'))!.data;
    // count the operations of one import
    const probe = new FaultyBackend(createMemoryBackend());
    await new SaveManagerImpl({ backend: probe, logger: silentLogger }).save('keep', 'keep', OLD, makeMeta());
    probe.log.length = 0;
    expect((await new SaveManagerImpl({ backend: probe, logger: silentLogger }).importFile(file)).ok).toBe(true);
    const n = probe.log.length;
    expect(n).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < n; i++) {
      for (const mode of ['before', 'after', 'torn'] as const) {
        const backend = new FaultyBackend(createMemoryBackend());
        expect((await new SaveManagerImpl({ backend, logger: silentLogger }).save('keep', 'keep', OLD, makeMeta())).ok).toBe(true);
        backend.arm(i, mode);
        const r = await new SaveManagerImpl({ backend, logger: silentLogger }).importFile(file);
        const after = restart(backend);
        const keep = await after.load('keep');
        expect(keep.ok && canonicalJson(keep.world), `crash ${mode} at op ${i} damaged an unrelated slot`).toBe(OLD_C);
        const imported = (await after.listSlots()).filter((s) => s.slotId.startsWith('import-'));
        expect(imported.length).toBeLessThanOrEqual(1);
        if (r.ok) expect(imported.map((s) => s.slotId)).toEqual([r.slotId]);
        for (const s of imported) {
          const l = await after.load(s.slotId);
          // only an atomicity-violating torn write may leave a damaged (but listed, deletable) import behind
          if (l.ok) expect(canonicalJson(l.world)).toBe(NEW_C);
          else expect(mode).toBe('torn');
        }
      }
    }
  });

  it('crash at every operation of a PROFILE write: the old or the new value loads, never the fallback', async () => {
    const { createProfileStore } = await import('../../../src/persistence');
    const probe = new FaultyBackend(createMemoryBackend());
    await createProfileStore({ backend: probe, logger: silentLogger }).save('settings', { v: 'old' });
    await createProfileStore({ backend: probe, logger: silentLogger }).save('settings', { v: 'old' }); // has a backup
    probe.log.length = 0;
    await createProfileStore({ backend: probe, logger: silentLogger }).save('settings', { v: 'new' });
    const n = probe.log.length;
    expect(n).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < n; i++) {
      for (const mode of ['before', 'after', 'torn'] as const) {
        const backend = new FaultyBackend(createMemoryBackend());
        await createProfileStore({ backend, logger: silentLogger }).save('settings', { v: 'old' });
        await createProfileStore({ backend, logger: silentLogger }).save('settings', { v: 'old' });
        backend.arm(i, mode);
        await createProfileStore({ backend, logger: silentLogger })
          .save('settings', { v: 'new' })
          .catch(() => undefined);
        const got = await createProfileStore({ backend: backend.inner, logger: silentLogger }).load('settings', { v: 'fallback' });
        expect(['old', 'new'], `crash ${mode} at op ${i}`).toContain(got.v);
      }
    }
  });

  it('crash during remove leaves the slot either intact-and-loadable or gone, never corrupt', async () => {
    for (let i = 0; i < 3; i++) {
      for (const mode of ['before', 'after'] as const) {
        const backend = new FaultyBackend(createMemoryBackend());
        const m = new SaveManagerImpl({ backend, logger: silentLogger });
        await m.save('slot1', 'a', OLD, makeMeta());
        await m.save('slot1', 'b', NEW, makeMeta());
        backend.arm(i, mode);
        await expect(restart2(backend).remove('slot1')).rejects.toThrow();
        const after = restart(backend);
        const l = await after.load('slot1');
        if (l.ok) expect([OLD_C, NEW_C]).toContain(canonicalJson(l.world));
        else expect(l.code).toBe('not_found');
        // still deletable
        await after.remove('slot1');
        expect(backend.inner.store.size).toBe(0);
      }
    }
    function restart2(b: FaultyBackend) {
      return new SaveManagerImpl({ backend: b, logger: silentLogger });
    }
  });
});
