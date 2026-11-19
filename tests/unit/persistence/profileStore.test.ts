import { describe, expect, it } from 'vitest';
import { createProfileStore } from '../../../src/persistence';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { reconcile } from '../../../src/persistence/profileStore';
import { DEFAULT_SETTINGS } from '../../../src/game/contracts';
import { FaultyBackend, silentLogger } from './fixtures';

function store() {
  const backend = createMemoryBackend();
  return { backend, profile: createProfileStore({ backend, logger: silentLogger }) };
}

describe('ProfileStore', () => {
  it('round-trips values and returns the fallback when nothing is stored', async () => {
    const { profile } = store();
    expect(await profile.load('settings', DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    const s = { ...DEFAULT_SETTINGS, uiScale: 1.2, volumes: { ...DEFAULT_SETTINGS.volumes, music: 0.1 } };
    await profile.save('settings', s);
    expect(await profile.load('settings', DEFAULT_SETTINGS)).toEqual(s);
    await profile.save('achievements', ['firstMeal', 'firstLimb']);
    expect(await profile.load('achievements', [] as string[])).toEqual(['firstMeal', 'firstLimb']);
    await profile.save('tutorialStage', 3);
    expect(await profile.load('tutorialStage', 0)).toBe(3);
  });

  it('fills settings added in a newer version from the fallback; type-mismatched values fall back', async () => {
    const { profile } = store();
    await profile.save('settings', { quality: 'low', uiScale: 'huge', volumes: { master: 0.3 }, legacyKey: true });
    const loaded = await profile.load('settings', DEFAULT_SETTINGS);
    expect(loaded.quality).toBe('low');
    expect(loaded.uiScale).toBe(DEFAULT_SETTINGS.uiScale); // 'huge' had the wrong type
    expect(loaded.volumes).toEqual({ ...DEFAULT_SETTINGS.volumes, master: 0.3 });
    expect(loaded.autosaveMinutes).toBe(DEFAULT_SETTINGS.autosaveMinutes);
    expect((loaded as unknown as Record<string, unknown>).legacyKey).toBe(true);
  });

  it('a damaged primary falls back to the backup, then to the fallback — never throws', async () => {
    const { backend, profile } = store();
    await profile.save('settings', { ...DEFAULT_SETTINGS, uiScale: 0.9 });
    await profile.save('settings', { ...DEFAULT_SETTINGS, uiScale: 1.1 });
    const p = backend.store.get('profile:settings')!;
    p[p.length - 5] ^= 0x01;
    expect((await profile.load('settings', DEFAULT_SETTINGS)).uiScale).toBe(0.9);
    backend.store.set('profile:settings:bak', new Uint8Array([1, 2, 3]));
    expect(await profile.load('settings', DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    backend.read = async () => {
      throw new Error('EIO');
    };
    expect(await profile.load('settings', DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('records are bound to their key (a copied record is not trusted)', async () => {
    const { backend, profile } = store();
    await profile.save('a', { v: 1 });
    backend.store.set('profile:b', backend.store.get('profile:a')!);
    expect(await profile.load('b', { v: 0 })).toEqual({ v: 0 });
  });

  it('rejects invalid keys and unserializable values on save; invalid keys load the fallback', async () => {
    const { profile } = store();
    await expect(profile.save('../etc', 1)).rejects.toThrow(/invalid profile key/);
    await expect(profile.save('con', 1)).rejects.toThrow(/invalid profile key/);
    await expect(profile.save('x', { n: NaN })).rejects.toThrow(/non-finite/);
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    await expect(profile.save('x', cyc)).rejects.toThrow(/circular/);
    expect(await profile.load('../etc', 'fb')).toBe('fb');
    // undefined properties are omitted like JSON.stringify would
    await profile.save('opt', { a: 1, b: undefined });
    expect(await profile.load('opt', {} as Record<string, unknown>)).toEqual({ a: 1 });
  });

  it('rapid saves of one key coalesce (latest wins) and never interleave', async () => {
    const backend = new FaultyBackend();
    backend.delayMs = 2;
    const profile = createProfileStore({ backend, logger: silentLogger });
    const first = profile.save('settings', { n: 0 });
    while (backend.log.length === 0) await new Promise((r) => setTimeout(r, 0));
    await Promise.all([first, ...Array.from({ length: 20 }, (_, i) => profile.save('settings', { n: i + 1 }))]);
    expect(await profile.load('settings', { n: -1 })).toEqual({ n: 20 });
    const writes = backend.log.filter((l) => l === 'write profile:settings').length;
    expect(writes).toBe(2);
    expect(backend.maxActive).toBe(1);
  });

  it('save failures reject with the storage error (callers can show "settings not saved")', async () => {
    const backend = new FaultyBackend();
    backend.faults = [{ op: 'write', nth: 0, keyIncludes: 'profile:settings', mode: 'before', error: () => new DOMException('full', 'QuotaExceededError') }];
    const profile = createProfileStore({ backend, logger: silentLogger });
    await expect(profile.save('settings', { a: 1 })).rejects.toThrow(/full/);
    await profile.save('settings', { a: 2 });
    expect(await profile.load('settings', {})).toEqual({ a: 2 });
  });

  it('reconcile semantics', () => {
    expect(reconcile(null, { a: 1 })).toEqual({ a: 1 });
    expect(reconcile(5, 'x')).toBe(5);
    expect(reconcile([1], { a: 1 })).toEqual([1]);
    expect(reconcile([1], [2, 3])).toEqual([2, 3]);
    expect(reconcile({ a: { b: 1, c: 2 } }, { a: { b: 5 } })).toEqual({ a: { b: 5, c: 2 } });
    expect(reconcile({ a: 1 }, null)).toEqual({ a: 1 });
    expect(reconcile(undefined, 7)).toBe(7);
  });
});
