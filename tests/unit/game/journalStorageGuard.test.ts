/**
 * Design §4.5 — storage-eviction guard: when the browser denies `navigator.storage.persist()`, ONE non-blocking
 * notice per install offers Export Save. Never when persistence is granted / already persisted, never on desktop,
 * never with a non-durable backend (that has its own warning), never a throw when the API misbehaves.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setStorageManagerForTests, storageManager, STORAGE_NOTICE_PROFILE_KEY, STORAGE_NOTICE_TITLE } from '../../../src/game/storageGuard';
import type { NativeBridge, StorageBackend } from '../../../src/persistence/contracts';
import { startedHarness, createHarness } from './controllerHarness';

const original = storageManager;

function sm(opts: { persisted?: boolean | 'throw'; persist?: boolean | 'throw' | 'hang' }) {
  const calls = { persisted: 0, persist: 0 };
  return {
    calls,
    fn: () => ({
      persisted: async () => {
        calls.persisted++;
        if (opts.persisted === 'throw') throw new Error('nope');
        return opts.persisted ?? false;
      },
      persist: () => {
        calls.persist++;
        if (opts.persist === 'throw') return Promise.reject(new Error('denied by policy'));
        if (opts.persist === 'hang') return new Promise<boolean>(() => undefined);
        return Promise.resolve(opts.persist ?? false);
      },
    }),
  };
}

async function webHarness(backendId: StorageBackend['id'], profile?: unknown) {
  const h = await createHarness({
    tutorial: { v: 1, seen: [] },
    setup: ({ saves, profile: p }) => {
      saves.backend = { ...saves.backend, id: backendId };
      if (profile !== undefined) p.data.set(STORAGE_NOTICE_PROFILE_KEY, profile);
    },
  });
  h.game.beginNewGame();
  h.game.addCazMember();
  const p = h.game.startGame();
  await h.until(() => h.game.screen === 'game');
  await p;
  await h.frames(5);
  return h;
}

const notices = (h: { game: { toasts: { title: string }[] } }) => h.game.toasts.filter((t) => t.title === STORAGE_NOTICE_TITLE);

describe('persistent-storage notice (web)', () => {
  afterEach(() => setStorageManagerForTests(original));

  it('denied → one warning toast offering Export, remembered in the profile; later sessions stay quiet', async () => {
    const s = sm({ persist: false });
    setStorageManagerForTests(s.fn);
    const h = await webHarness('indexeddb');
    expect(notices(h).length).toBe(1);
    expect(notices(h)[0]).toMatchObject({ kind: 'warning' });
    expect((notices(h)[0] as unknown as { text: string }).text).toMatch(/Export/);
    await h.frames(3);
    expect(h.profile.saves.some((x) => x.key === STORAGE_NOTICE_PROFILE_KEY)).toBe(true);
    // Another game in the same page: not again.
    await h.game.quitToMenu();
    h.game.beginNewGame();
    const p = h.game.startGame();
    await h.until(() => h.game.screen === 'game');
    await p;
    await h.frames(5);
    expect(notices(h).length).toBeLessThanOrEqual(1);
    expect(s.calls.persist).toBe(1);
    // A new page load (same install, profile remembers): no notice at all.
    const h2 = await webHarness('localstorage', { v: 1, shown: true });
    expect(notices(h2).length).toBe(0);
  });

  it('granted, already persisted, desktop, memory backend, missing API, throwing / hanging API → no notice, no crash', async () => {
    for (const [label, s, backend, native] of [
      ['granted', sm({ persist: true }), 'indexeddb', false],
      ['already persisted', sm({ persisted: true }), 'indexeddb', false],
      ['desktop', sm({ persist: false }), 'indexeddb', true],
      ['electron backend', sm({ persist: false }), 'electron', false],
      ['persist throws', sm({ persist: 'throw' }), 'localstorage', false],
      ['persisted throws', sm({ persisted: 'throw' }), 'indexeddb', false],
      ['persist hangs', sm({ persist: 'hang' }), 'indexeddb', false],
    ] as const) {
      setStorageManagerForTests(s.fn);
      const h = await createHarness({
        tutorial: { v: 1, seen: [] },
        setup: ({ saves, env }) => {
          saves.backend = { ...saves.backend, id: backend };
          if (native) env.nativeBridge = { platform: 'win32', version: '1', storage: {} } as unknown as NativeBridge;
        },
      });
      h.game.beginNewGame();
      const p = h.game.startGame();
      await h.until(() => h.game.screen === 'game');
      await p;
      await h.frames(5);
      expect(notices(h).length, label).toBe(0);
      expect(h.game.fatalError, label).toBeNull();
    }
    setStorageManagerForTests(() => null);
    const h = await startedHarness();
    expect(notices(h).length).toBe(0);
  });
});
