import { describe, expect, it } from 'vitest';
import { SESSION_SLOT_KEYS, type SessionLogService } from '../../../src/game/sessionLog';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { ProfileStoreImpl } from '../../../src/persistence/profileStore';
import { ActivityTracker } from '../../../src/persistence/activity';
import { startedHarness, type Harness } from '../game/controllerHarness';
import { flush } from '../game/fakes';

function econ(bracket: string) {
  return { age: { bracket }, onFrame() {}, onSimEvents() {}, registerNewWorld() {}, noteImportedWorld() {}, isUsable: () => true, buyLock: () => ({ state: 'free' }), focusStore() {} };
}
const svc = (h: Harness) => (h.game as unknown as { sessionLog: SessionLogService }).sessionLog;
async function settle() {
  await flush(20);
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 10));
}

describe('Clear vs a concurrent persist', () => {
  it('a pagehide flush while Clear is still running does not write the cleared session back', async () => {
    const inner = createMemoryBackend();
    const store = new ProfileStoreImpl(() => Promise.resolve(inner), { logger: { warn: () => {} }, activity: new ActivityTracker() });
    let hook: (() => void) | null = null;
    const h = await startedHarness({
      economy: econ('adult'),
      setup: ({ profile, saves }) => {
        profile.load = (k, f) => store.load(k, f);
        profile.save = (k, v) => store.save(k, v);
        saves.backend = {
          ...inner,
          remove: async (key: string) => {
            await inner.remove(key);
            if (key === 'profile:slog-a' && hook) {
              const f = hook;
              hook = null;
              f();
            }
          },
        };
      },
    });
    await h.frames(10);
    svc(h).flush();
    await settle();
    h.game.setMode('buy');
    svc(h).flush();
    await settle();
    const id = (await svc(h).log())!.header.id;
    const holds = (key: string) => {
      const b = inner.store.get(key);
      return b !== undefined && new TextDecoder().decode(b).includes(id);
    };
    expect(holds('profile:slog-a')).toBe(true);
    hook = () => svc(h).flush('pagehide'); // tab hidden while Clear is still working through the other slots
    await svc(h).clear();
    await settle();
    const leaked = SESSION_SLOT_KEYS.flatMap((k) => [`profile:${k}`, `profile:${k}:bak`]).filter(holds);
    expect(leaked, 'keys still holding the cleared session').toEqual([]);
  });
});
