import { describe, expect, it } from 'vitest';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { createLocalStorageBackend } from '../../../src/persistence/backends/localStorage';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { classifyStorageError, isQuotaError, StorageError, toStorageError } from '../../../src/persistence/errors';
import { FaultyBackend, makeMeta, makeWorld, quotaError, silentLogger } from './fixtures';
import { FakeStorage } from './fakeStorage';

const OLD_C = canonicalJson(makeWorld(1));

async function seeded(backend: FaultyBackend) {
  const m = new SaveManagerImpl({ backend, logger: silentLogger });
  expect((await m.save('slot1', 'old', makeWorld(1), makeMeta())).ok).toBe(true);
  expect((await m.save('slot1', 'old', makeWorld(1), makeMeta())).ok).toBe(true);
  return m;
}

describe('quota errors', () => {
  it('quota on the primary write -> code quota, old save intact', async () => {
    const backend = new FaultyBackend();
    const m = await seeded(backend);
    backend.faults = [{ op: 'write', nth: 0, keyIncludes: ':primary', mode: 'before', error: quotaError }];
    const r = await m.save('slot1', 'new', makeWorld(2), makeMeta());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('quota');
    expect(r.error).toMatch(/Not enough storage space/);
    const l = await new SaveManagerImpl({ backend, logger: silentLogger }).load('slot1');
    expect(l.ok && canonicalJson(l.world)).toBe(OLD_C);
    expect(l.ok && l.info.recoveredFromBackup).toBe(false);
  });

  it('quota while rotating the backup -> quota, old save intact', async () => {
    const backend = new FaultyBackend();
    const m = await seeded(backend);
    backend.faults = [{ op: 'write', nth: 0, keyIncludes: ':backup', mode: 'before', error: quotaError }];
    const r = await m.save('slot1', 'new', makeWorld(2), makeMeta());
    expect(!r.ok && r.code).toBe('quota');
    const l = await m.load('slot1');
    expect(l.ok && canonicalJson(l.world)).toBe(OLD_C);
  });

  it('quota on the meta record only: the save itself succeeds and the listing self-heals', async () => {
    const backend = new FaultyBackend();
    const m = await seeded(backend);
    backend.faults = [{ op: 'write', nth: 0, keyIncludes: ':meta', mode: 'before', error: quotaError }];
    const r = await m.save('slot1', 'new', makeWorld(2), makeMeta({ day: 99 }));
    expect(r.ok).toBe(true);
    const l = await m.load('slot1');
    expect(l.ok && l.world.seed).toBe(makeWorld(2).seed);
    const [info] = await m.listSlots();
    expect(info.meta.day).toBe(99);
  });

  it('localStorage: a real QuotaExceededError from setItem surfaces as quota; old save intact', async () => {
    const storage = new FakeStorage(60_000);
    const backend = createLocalStorageBackend({ storage });
    const m = new SaveManagerImpl({ backend, logger: silentLogger, compress: false });
    expect((await m.save('slot1', 'old', makeWorld(1), makeMeta())).ok).toBe(true);
    const huge = makeWorld(2);
    huge.flags.padding = 'x'.repeat(40_000);
    const r = await m.save('slot1', 'new', huge, makeMeta());
    expect(!r.ok && r.code).toBe('quota');
    const l = await m.load('slot1');
    expect(l.ok && canonicalJson(l.world)).toBe(OLD_C);
  });

  it('memory backend quota is enforced the same way', async () => {
    const backend = createMemoryBackend({ quotaBytes: 30_000 });
    const m = new SaveManagerImpl({ backend, logger: silentLogger, compress: false });
    expect((await m.save('a', 'a', makeWorld(1), makeMeta())).ok).toBe(true);
    const big = makeWorld(2);
    big.flags.padding = 'y'.repeat(30_000);
    expect(await m.save('a', 'b', big, makeMeta())).toMatchObject({ ok: false, code: 'quota' });
    expect((await m.load('a')).ok).toBe(true);
    expect(await backend.quota()).toBeGreaterThanOrEqual(0);
  });

  it('every known quota error shape is classified as quota', () => {
    const shapes: unknown[] = [
      quotaError(),
      new DOMException('x', 'NS_ERROR_DOM_QUOTA_REACHED'),
      Object.assign(new Error('legacy'), { code: 22 }),
      Object.assign(new Error('firefox'), { code: 1014 }),
      Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' }),
      Object.assign(new Error('quota'), { code: 'EDQUOT' }),
      new Error('[quota] Not enough disk space'),
      new Error("Error invoking remote method 'afterlife:storage:write': [quota] disk full"),
      new StorageError('quota', 'x'),
    ];
    for (const s of shapes) {
      expect(isQuotaError(s), String(s)).toBe(true);
      expect(classifyStorageError(s)).toBe('quota');
    }
    expect(classifyStorageError(new Error('[busy] locked'))).toBe('busy');
    expect(classifyStorageError(Object.assign(new Error('x'), { code: 'EBUSY' }))).toBe('busy');
    expect(classifyStorageError(new Error('[invalid] bad key'))).toBe('invalid');
    expect(classifyStorageError(new Error('EIO'))).toBe('io');
    expect(classifyStorageError(null)).toBe('io');
    expect(classifyStorageError({ get message() { throw new Error('getter bomb'); } })).toBe('io');
    expect(toStorageError(new Error('[quota] full'), 'ctx').message).toBe('ctx: full');
  });
});
