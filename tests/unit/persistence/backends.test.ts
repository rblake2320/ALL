import { afterEach, describe, expect, it } from 'vitest';
import type { NativeBridge, StorageBackend } from '../../../src/persistence/contracts';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { createLocalStorageBackend, LS_PREFIX } from '../../../src/persistence/backends/localStorage';
import { createIndexedDbBackend } from '../../../src/persistence/backends/indexedDb';
import { createElectronBackend } from '../../../src/persistence/backends/electron';
import { selectBackend, sharedBackend, resetSharedBackend } from '../../../src/persistence/backends/select';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createProfileStore, createSaveManager } from '../../../src/persistence';
import { StorageError } from '../../../src/persistence/errors';
import { FakeStorage } from './fakeStorage';
import { FakeIDBFactory } from './fakeIndexedDb';
import { makeMeta, makeWorld, silentLogger } from './fixtures';

const enc = (s: string) => new TextEncoder().encode(s);

/** Behaviour every backend must share (the StorageBackend contract). */
async function contractSuite(b: StorageBackend) {
  expect(await b.available()).toBe(true);
  expect(await b.read('slot:x:primary')).toBeNull();
  const data = new Uint8Array([0, 1, 2, 255, 128]);
  await b.write('slot:x:primary', data);
  data[0] = 99; // caller mutation must not reach stored data
  expect(Array.from((await b.read('slot:x:primary'))!)).toEqual([0, 1, 2, 255, 128]);
  const back = (await b.read('slot:x:primary'))!;
  back[1] = 77; // reader mutation must not reach stored data
  expect((await b.read('slot:x:primary'))![1]).toBe(1);
  await b.write('slot:x:primary', new Uint8Array(0));
  expect((await b.read('slot:x:primary'))!.byteLength).toBe(0);
  await b.write('slot:y:meta', enc('{}'));
  await b.write('profile:settings', enc('{}'));
  expect(await b.list('slot:')).toEqual(['slot:x:primary', 'slot:y:meta']);
  expect(await b.list('profile:')).toEqual(['profile:settings']);
  expect((await b.list('')).length).toBe(3);
  await b.remove('slot:x:primary');
  await b.remove('slot:x:primary'); // idempotent
  expect(await b.read('slot:x:primary')).toBeNull();
  // A view into a larger buffer stores only the view's bytes.
  const big = new Uint8Array([9, 9, 1, 2, 9]);
  await b.write('slot:z:primary', big.subarray(2, 4));
  expect(Array.from((await b.read('slot:z:primary'))!)).toEqual([1, 2]);
  await expect(b.write('slot:q:primary', 'str' as unknown as Uint8Array)).rejects.toThrow();
  const q = await b.quota();
  expect(q === null || (Number.isFinite(q) && q >= 0)).toBe(true);
}

describe('memory backend', () => {
  it('satisfies the contract', async () => contractSuite(createMemoryBackend()));
});

describe('localStorage backend', () => {
  it('satisfies the contract (base64 values under a namespaced prefix)', async () => {
    const s = new FakeStorage();
    await contractSuite(createLocalStorageBackend({ storage: s }));
    expect(s.getItem(`${LS_PREFIX}slot:y:meta`)).toBe('b64:e30=');
  });

  it('is unavailable when storage access throws (sandboxed iframe / disabled site data)', async () => {
    const s = new FakeStorage();
    s.throwOnAccess = true;
    expect(await createLocalStorageBackend({ storage: s }).available()).toBe(false);
    expect(
      await createLocalStorageBackend({
        storage: () => {
          throw new DOMException('denied', 'SecurityError');
        },
      }).available(),
    ).toBe(false);
    await expect(createLocalStorageBackend({ storage: s }).read('x')).rejects.toBeInstanceOf(StorageError);
  });

  it('damaged base64 reads as empty bytes (-> corrupt -> backup), plain text is tolerated', async () => {
    const s = new FakeStorage();
    const b = createLocalStorageBackend({ storage: s });
    s.setItem(`${LS_PREFIX}k1`, 'b64:@@@@');
    s.setItem(`${LS_PREFIX}k2`, '{"plain":true}');
    expect((await b.read('k1'))!.byteLength).toBe(0);
    expect(new TextDecoder().decode((await b.read('k2'))!)).toBe('{"plain":true}');
  });

  it('ignores foreign keys and reports remaining quota', async () => {
    const s = new FakeStorage(10_000);
    s.setItem('other-app', 'x'.repeat(1000));
    const b = createLocalStorageBackend({ storage: s, quotaChars: 10_000 });
    await b.write('slot:a:meta', new Uint8Array(300));
    expect(await b.list('')).toEqual(['slot:a:meta']);
    const q = (await b.quota())!;
    expect(q).toBeGreaterThan(5000);
    expect(q).toBeLessThan(7000);
  });
});

describe('IndexedDB backend', () => {
  it('satisfies the contract', async () => {
    const f = new FakeIDBFactory();
    await contractSuite(createIndexedDbBackend({ factory: f as unknown as IDBFactory }));
  });

  it('quota aborts surface as StorageError(quota) and leave the previous value intact', async () => {
    const f = new FakeIDBFactory();
    const b = createIndexedDbBackend({ factory: f as unknown as IDBFactory });
    await b.write('k', new Uint8Array(100));
    f.quotaBytes = 150;
    await expect(b.write('k', new Uint8Array(500))).rejects.toMatchObject({ code: 'quota' });
    expect((await b.read('k'))!.byteLength).toBe(100);
    // ...and a SaveManager reports it as code 'quota'
    f.quotaBytes = Infinity;
    const m = new SaveManagerImpl({ backend: b, logger: silentLogger });
    expect((await m.save('s', 's', makeWorld(), makeMeta())).ok).toBe(true);
    f.quotaBytes = f.usedBytes() + 10;
    const r = await m.save('s', 's', makeWorld(2), makeMeta());
    expect(!r.ok && r.code).toBe('quota');
    const l = await m.load('s');
    expect(l.ok && l.world.seed).toBe(makeWorld().seed);
  });

  it('a hung open (blocked by another tab) times out as busy instead of hanging; later opens retry', async () => {
    const f = new FakeIDBFactory();
    f.openMode = 'hang';
    const b = createIndexedDbBackend({ factory: f as unknown as IDBFactory, openTimeoutMs: 30 });
    await expect(b.read('x')).rejects.toMatchObject({ code: 'busy' });
    expect(await b.available()).toBe(false);
    f.openMode = 'ok';
    expect(await b.available()).toBe(true);
  });

  it('open errors / throwing factories / missing indexedDB make it unavailable, never throw from available()', async () => {
    for (const mode of ['error', 'throw'] as const) {
      const f = new FakeIDBFactory();
      f.openMode = mode;
      expect(await createIndexedDbBackend({ factory: f as unknown as IDBFactory }).available()).toBe(false);
    }
    expect(await createIndexedDbBackend({ factory: () => undefined }).available()).toBe(false);
    expect(await createIndexedDbBackend().available()).toBe(false); // Node has no indexedDB
  });

  it('recovers from a lost connection and from versionchange by reopening', async () => {
    const f = new FakeIDBFactory();
    const b = createIndexedDbBackend({ factory: f as unknown as IDBFactory });
    await b.write('k', new Uint8Array([1]));
    f.connections[0].lose();
    expect(Array.from((await b.read('k'))!)).toEqual([1]);
    f.connections[f.connections.length - 1].onversionchange?.();
    expect(Array.from((await b.read('k'))!)).toEqual([1]);
    f.failNextTransactionCreate = 1; // connection closing underneath us
    expect(Array.from((await b.read('k'))!)).toEqual([1]);
    expect(f.opens).toBeGreaterThanOrEqual(3);
  });

  it('repairs a database that exists without our object store (version bump)', async () => {
    const f = new FakeIDBFactory();
    f.dbs.set('afterlife-lease', { version: 1, stores: new Map([['other', new Map()]]) });
    const b = createIndexedDbBackend({ factory: f as unknown as IDBFactory });
    expect(await b.available()).toBe(true);
    expect(f.dbs.get('afterlife-lease')!.version).toBe(2);
  });

  it('unknown stored value types read as empty (damaged) rather than throwing', async () => {
    const f = new FakeIDBFactory();
    const b = createIndexedDbBackend({ factory: f as unknown as IDBFactory });
    await b.write('k', new Uint8Array([1]));
    f.dbs.get('afterlife-lease')!.stores.get('kv')!.set('k', { not: 'bytes' });
    expect((await b.read('k'))!.byteLength).toBe(0);
  });
});

describe('Electron bridge backend', () => {
  function fakeBridge(): NativeBridge & { files: Map<string, Uint8Array>; failNext: string | null } {
    const files = new Map<string, Uint8Array>();
    const bridge = {
      files,
      failNext: null as string | null,
      platform: 'win32',
      version: '1.0.0',
      storage: {
        read: async (k: string) => {
          if (bridge.failNext) throw new Error(bridge.failNext);
          return files.has(k) ? files.get(k)!.slice() : null;
        },
        write: async (k: string, d: Uint8Array) => {
          if (bridge.failNext) {
            const m = bridge.failNext;
            bridge.failNext = null;
            throw new Error(m);
          }
          files.set(k, d.slice());
        },
        remove: async (k: string) => void files.delete(k),
        list: async (p: string) => [...files.keys()].filter((k) => k.startsWith(p)),
        quota: async () => 123456,
      },
      setFullscreen: async () => undefined,
      isFullscreen: async () => false,
      quit: () => undefined,
      openSavesFolder: async () => undefined,
    };
    return bridge;
  }

  it('satisfies the contract', async () => contractSuite(createElectronBackend(fakeBridge())));

  it('maps "[code] message" errors from the main process back to StorageError codes', async () => {
    const br = fakeBridge();
    const b = createElectronBackend(br);
    for (const [msg, code] of [
      ["Error invoking remote method 'afterlife:storage:write': Error: [quota] Not enough disk space", 'quota'],
      ['[busy] file locked by another program', 'busy'],
      ['[invalid] key rejected', 'invalid'],
      ['[io] EIO', 'io'],
      ['something else', 'io'],
    ] as const) {
      br.failNext = msg;
      await expect(b.write('slot:a:primary', new Uint8Array([1]))).rejects.toMatchObject({ code });
    }
  });

  it('is unavailable without a bridge and tolerates a misbehaving bridge', async () => {
    expect(await createElectronBackend(null).available()).toBe(false);
    const br = fakeBridge();
    br.storage.read = (async () => 'not bytes') as unknown as NativeBridge['storage']['read'];
    br.storage.list = (async () => 'nope') as unknown as NativeBridge['storage']['list'];
    br.storage.quota = (async () => NaN) as unknown as NativeBridge['storage']['quota'];
    const b = createElectronBackend(br);
    await expect(b.read('x')).rejects.toMatchObject({ code: 'io' });
    await expect(b.list('slot:')).rejects.toMatchObject({ code: 'io' });
    expect(await b.quota()).toBeNull();
    expect(await b.available()).toBe(false);
  });

  it('a full SaveManager round trip over the bridge', async () => {
    const m = new SaveManagerImpl({ backend: createElectronBackend(fakeBridge()), logger: silentLogger });
    expect((await m.save('a', 'a', makeWorld(), makeMeta())).ok).toBe(true);
    expect((await m.load('a')).ok).toBe(true);
  });
});

describe('backend selection', () => {
  afterEach(() => {
    resetSharedBackend();
    delete (globalThis as { window?: unknown }).window;
  });

  const cand = (id: StorageBackend['id'], available: () => Promise<boolean>) => ({
    id,
    create: () => ({ ...createMemoryBackend(), id, available }),
  });

  it('picks the first available candidate in priority order', async () => {
    const b = await selectBackend({
      candidates: [cand('electron', async () => false), cand('indexeddb', async () => true), cand('localstorage', async () => true)],
      logger: silentLogger,
    });
    expect(b.id).toBe('indexeddb');
  });

  it('skips candidates that throw on creation, throw on probe, or hang; falls back to memory', async () => {
    const b = await selectBackend({
      candidates: [
        {
          id: 'electron',
          create: () => {
            throw new Error('no bridge');
          },
        },
        cand('indexeddb', () => new Promise<boolean>(() => undefined)),
        cand('localstorage', async () => {
          throw new DOMException('SecurityError', 'SecurityError');
        }),
      ],
      timeoutMs: 20,
      logger: silentLogger,
    });
    expect(b.id).toBe('memory');
    expect(b.durable).toBe(false);
  });

  it('in plain Node (no window/indexedDB/localStorage) the shared backend is memory, shared by saves and profile', async () => {
    const mgr = await createSaveManager({ logger: silentLogger });
    expect(mgr.backend.id).toBe('memory');
    expect(await sharedBackend()).toBe(mgr.backend);
    const profile = createProfileStore({ logger: silentLogger });
    await profile.save('settings', { a: 1 });
    expect(await mgr.backend.read('profile:settings')).not.toBeNull();
  });

  it('prefers the Electron bridge when window.afterlifeNative exists', async () => {
    const files = new Map<string, Uint8Array>();
    (globalThis as { window?: unknown }).window = {
      afterlifeNative: {
        platform: 'win32',
        version: '1',
        storage: {
          read: async (k: string) => files.get(k) ?? null,
          write: async (k: string, d: Uint8Array) => void files.set(k, d),
          remove: async (k: string) => void files.delete(k),
          list: async (p: string) => [...files.keys()].filter((k) => k.startsWith(p)),
          quota: async () => null,
        },
      },
    };
    const b = await selectBackend({ logger: silentLogger });
    expect(b.id).toBe('electron');
  });
});
