/**
 * W-117 session log through the REAL controller (fakes for renderer/audio/saves, real or fake sim):
 *  - consent: under-13 default OFF (nothing written), 13+ default ON, unanswered age = memory only (dropped on an
 *    under-13 answer, kept on 13+), the toggle and Clear work and persist;
 *  - persistence: the live session survives a simulated crash mid-write (crash-safe ProfileStore over a backend that
 *    throws / tears), and only the last 3 sessions are kept across 5 games;
 *  - non-productive world clicks (ground with nobody selected, Ultra while awake) through real pointer events;
 *  - PII property test: names / e-mails / free text planted in CAZ, household, rename and the world never reach the
 *    stored log or the summary;
 *  - determinism: recorder ON vs OFF over the same scripted play gives byte-identical saves.
 */
import { describe, expect, it } from 'vitest';
import type { SimModule } from '../../../src/game/simTypes';
import type { PickResult } from '../../../src/render/contracts';
import { SESSION_INDEX_KEY, SESSION_SLOT_KEYS, type SessionLogService } from '../../../src/game/sessionLog';
import { fromStored, type SessionLog } from '../../../src/feedback/sessionLog';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { createMemoryBackend, type MemoryBackend } from '../../../src/persistence/backends/memory';
import { ProfileStoreImpl } from '../../../src/persistence/profileStore';
import { ActivityTracker } from '../../../src/persistence/activity';
import { createHarness, startedHarness, type Harness } from '../game/controllerHarness';
import { flush } from '../game/fakes';

const real: SimModule = await (async () => {
  const mod = await import('../../../src/sim/index');
  return { createNewWorld: mod.createNewWorld, createSimulation: mod.createSimulation, loadContent: mod.loadContent, LOT_TEMPLATES: mod.LOT_TEMPLATES };
})();

function econ(bracket: string) {
  return {
    age: { bracket },
    onFrame() {},
    onSimEvents() {},
    registerNewWorld() {},
    noteImportedWorld() {},
    isUsable: () => true,
    buyLock: () => ({ state: 'free' }),
    focusStore() {},
  };
}

const svc = (h: Harness) => (h.game as unknown as { sessionLog: SessionLogService }).sessionLog;
const point = () => ({ x: 0, y: 0, z: 0 }) as PickResult extends { point: infer P } ? P : never;

function storedLogs(h: Harness): SessionLog[] {
  return SESSION_SLOT_KEYS.map((k) => h.profile.data.get(k)).filter((v) => v !== undefined && v !== null).map((v) => fromStored(v)!).filter(Boolean);
}

/** Write now and let the (real, crypto-hashing) store settle. */
async function persistNow(h: Harness) {
  svc(h).flush();
  await flush(20);
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 10));
}

describe('consent + age defaults', () => {
  it('under-13: OFF by default — nothing recorded, nothing written; the summary is unavailable', async () => {
    const h = await startedHarness({ economy: econ('under13') });
    await h.frames(30);
    await persistNow(h);
    const s = svc(h);
    expect(s.enabled).toBe(false);
    expect(s.teenOrAdult).toBe(false);
    expect(storedLogs(h)).toEqual([]);
    expect(await s.list()).toEqual([]);
    expect(await s.summary()).toBeNull();
    expect(s.canSaveFile).toBe(false);
  });

  it('13+: ON by default — the session is written to the ring', async () => {
    const h = await startedHarness({ economy: econ('adult') });
    await h.frames(30);
    await persistNow(h);
    expect(svc(h).enabled).toBe(true);
    const logs = storedLogs(h);
    expect(logs).toHaveLength(1);
    expect(logs[0].header.bracket).toBe('13plus');
    expect(logs[0].events.map((e) => `${e.k}:${e.a ?? ''}`)).toEqual(expect.arrayContaining(['start:boot', 'screen:menu', 'screen:caz', 'screen:loading', 'world:new:starter', 'screen:game']));
  });

  it('age not answered: held in memory only (never written); an under-13 answer drops it, a 13+ answer keeps it', async () => {
    for (const answer of ['under13', 'teen'] as const) {
      const e = econ('unknown');
      const h = await startedHarness({ economy: e });
      await h.frames(10);
      await persistNow(h);
      expect(storedLogs(h)).toEqual([]); // nothing on disk while unanswered
      expect((await svc(h).log())?.events.some((x) => x.a === 'game')).toBe(true); // but kept in memory
      e.age.bracket = answer;
      await h.frames(5);
      await persistNow(h);
      if (answer === 'under13') {
        expect(storedLogs(h)).toEqual([]);
        expect(await svc(h).log()).toBeNull();
      } else {
        const logs = storedLogs(h);
        expect(logs).toHaveLength(1);
        expect(logs[0].events.some((x) => x.k === 'screen' && x.a === 'caz')).toBe(true); // onboarding kept
      }
    }
  });

  it('the toggle switches recording and is remembered; Clear deletes every stored session', async () => {
    const h = await startedHarness({ economy: econ('under13') });
    const s = svc(h);
    s.setEnabled(true); // a parent switches it on for a child profile
    await h.frames(10);
    await persistNow(h);
    expect(s.enabled).toBe(true);
    expect(h.profile.data.get(SESSION_INDEX_KEY)).toEqual({ v: 1, enabled: true });
    expect(storedLogs(h)).toHaveLength(1);
    expect(s.canSaveFile).toBe(false); // under-13: copy only
    expect(await s.summary()).toContain('player: child profile');
    await s.clear();
    await flush(20);
    expect(storedLogs(h)).toEqual([]);
    for (const k of SESSION_SLOT_KEYS) expect(h.profile.data.get(k)).toBeNull(); // tombstones
    s.setEnabled(false);
    await h.frames(10);
    await persistNow(h);
    expect(h.profile.data.get(SESSION_INDEX_KEY)).toEqual({ v: 1, enabled: false });
    expect(storedLogs(h)).toEqual([]);
    // the explicit choice wins on the next launch even for a 13+ profile
    const h2 = await createHarness({ economy: econ('adult'), setup: ({ profile }) => profile.data.set(SESSION_INDEX_KEY, { v: 1, enabled: false }) });
    await svc(h2).init();
    expect(svc(h2).enabled).toBe(false);
  });
});

/** A memory backend that throws (optionally tearing the write) on the Nth write from now. */
function crashy(inner: MemoryBackend) {
  let countdown = Infinity;
  let tear = false;
  let fired = 0;
  const b: MemoryBackend = {
    ...inner,
    store: inner.store,
    async write(key, data) {
      if (--countdown === 0) {
        if (tear) inner.store.set(key, data.slice(0, Math.floor(data.length / 2)));
        fired++;
        throw new Error('simulated crash');
      }
      return inner.write(key, data);
    },
  };
  return { backend: b, crashOnWrite: (n: number, torn: boolean) => ((countdown = n), (tear = torn)), fired: () => fired };
}

describe('persistence', () => {
  it('a crash at the 1st/2nd write of a session update (clean or torn) keeps the previous good copy readable', async () => {
    for (const torn of [false, true]) {
      for (const n of [1, 2]) {
        const inner = createMemoryBackend();
        const c = crashy(inner);
        const store = new ProfileStoreImpl(() => Promise.resolve(c.backend), { logger: { warn: () => {} }, activity: new ActivityTracker() });
        const h = await startedHarness({
          economy: econ('adult'),
          setup: ({ profile }) => {
            profile.load = (k, f) => store.load(k, f);
            profile.save = (k, v) => store.save(k, v);
          },
        });
        await h.frames(10);
        await persistNow(h);
        const reread = () => new ProfileStoreImpl(() => Promise.resolve(inner), { logger: { warn: () => {} }, activity: new ActivityTracker() });
        const first = fromStored(await reread().load<unknown>('slog-a', null))!;
        expect(first.events.length).toBeGreaterThan(3);
        h.game.setMode('buy'); // more events
        h.game.setMode('live');
        c.crashOnWrite(n, torn);
        await persistNow(h);
        expect(c.fired(), 'the crash really happened').toBe(1);
        const after = fromStored(await reread().load<unknown>('slog-a', null)); // "reload" after the crash
        expect(after, `crash at write ${n}${torn ? ' (torn)' : ''}`).not.toBeNull();
        expect(after!.header.id).toBe(first.header.id);
        expect(after!.events.length).toBeGreaterThanOrEqual(first.events.length); // old or new, never torn
      }
    }
  });

  it('keeps only the last 3 sessions (5 games in one run: oldest two overwritten), newest listed first', async () => {
    const h = await startedHarness({ economy: econ('adult') });
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push((await svc(h).log())!.header.id);
      const q = h.game.quitToMenu();
      await h.until(() => h.game.screen === 'menu');
      await q;
      h.game.beginNewGame(); // a second world in this run → a new session
      h.env.randoms.push(1000 + i);
      const started = h.game.startGame();
      await h.until(() => h.game.screen === 'game');
      await started;
      await h.frames(3);
    }
    ids.push((await svc(h).log())!.header.id);
    await persistNow(h);
    expect(new Set(ids).size).toBe(5);
    const stored = storedLogs(h).sort((a, b) => a.header.seq - b.header.seq);
    expect(stored.map((l) => l.header.id)).toEqual(ids.slice(2));
    expect(stored.slice(0, 2).every((l) => l.endReason === 'newGame')).toBe(true);
    const list = await svc(h).list();
    expect(list.map((x) => x.id)).toEqual([ids[4], ids[3], ids[2]]);
    expect(list[0].current).toBe(true);
    // a reload (new controller on the same profile) sees the 3 stored sessions
    const h2 = await createHarness({ economy: econ('adult'), setup: ({ profile }) => (profile.data = new Map(h.profile.data)) });
    const l2 = await svc(h2).list();
    expect(l2.filter((x) => !x.current).map((x) => x.id)).toEqual([ids[4], ids[3], ids[2]]);
  });

  it('Clear leaves no session bytes in primary or :bak on the real store (a lost primary cannot bring the session back)', async () => {
    const inner = createMemoryBackend();
    const open = () => new ProfileStoreImpl(() => Promise.resolve(inner), { logger: { warn: () => {} }, activity: new ActivityTracker() });
    const store = open();
    const h = await startedHarness({
      economy: econ('adult'),
      setup: ({ profile, saves }) => {
        profile.load = (k, f) => store.load(k, f);
        profile.save = (k, v) => store.save(k, v);
        saves.backend = inner; // as shipped: saves and the profile share one backend
      },
    });
    await h.frames(10);
    await persistNow(h);
    h.game.setMode('buy'); // a second write rotates the first record into :bak
    await persistNow(h);
    const id = (await svc(h).log())!.header.id;
    const holdsSession = (key: string) => {
      const bytes = inner.store.get(key);
      return bytes !== undefined && new TextDecoder().decode(bytes).includes(id);
    };
    expect(holdsSession('profile:slog-a'), 'the session is stored before Clear').toBe(true);
    expect(holdsSession('profile:slog-a:bak'), 'and rotated into the backup before Clear').toBe(true);
    await svc(h).clear();
    await flush(20);
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 10));
    for (const k of SESSION_SLOT_KEYS) {
      for (const suffix of ['', ':bak']) expect(holdsSession(`profile:${k}${suffix}`), `profile:${k}${suffix} still holds the cleared session`).toBe(false);
    }
    // a later launch whose primary record is lost or unreadable falls back to :bak: nothing may be there to restore
    inner.store.delete('profile:slog-a');
    expect(await open().load<unknown>('slog-a', null), 'slog-a restored from its backup after Clear').toBeNull();
  });

  it('…also when the save manager has a different backend from the profile store (a boot fallback): the double tombstone clears :bak', async () => {
    const inner = createMemoryBackend();
    const open = () => new ProfileStoreImpl(() => Promise.resolve(inner), { logger: { warn: () => {} }, activity: new ActivityTracker() });
    const store = open();
    const h = await startedHarness({
      economy: econ('adult'),
      setup: ({ profile, saves }) => {
        profile.load = (k, f) => store.load(k, f);
        profile.save = (k, v) => store.save(k, v);
        saves.backend = createMemoryBackend(); // a fallback boot path: the removes go to the wrong backend
      },
    });
    await h.frames(10);
    await persistNow(h);
    h.game.setMode('buy'); // a second write rotates the first record into :bak
    await persistNow(h);
    const id = (await svc(h).log())!.header.id;
    const holdsSession = (key: string) => {
      const bytes = inner.store.get(key);
      return bytes !== undefined && new TextDecoder().decode(bytes).includes(id);
    };
    expect(holdsSession('profile:slog-a'), 'the session is stored before Clear').toBe(true);
    expect(holdsSession('profile:slog-a:bak'), 'and rotated into the backup before Clear').toBe(true);
    await svc(h).clear();
    await flush(20);
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 10));
    for (const k of SESSION_SLOT_KEYS) {
      for (const suffix of ['', ':bak']) expect(holdsSession(`profile:${k}${suffix}`), `profile:${k}${suffix} still holds the cleared session`).toBe(false);
    }
    // a later launch whose primary record is lost or unreadable falls back to :bak: nothing may be there to restore
    inner.store.delete('profile:slog-a');
    expect(await open().load<unknown>('slog-a', null), 'slog-a restored from its backup after Clear').toBeNull();
  });
});

describe('non-productive clicks + first action (real pointer events, fake sim)', () => {
  it('ground clicks with nobody selected count; a click that opens a menu does not; Ultra while awake is a locked control', async () => {
    const h = await startedHarness({ economy: econ('adult') });
    h.game.selectAgent(null);
    h.renderer.pickFn = () => ({ kind: 'tile', x: 3, z: 3, point: point() });
    for (let i = 0; i < 3; i++) {
      h.pointer('pointerdown', 300, 200);
      h.pointer('pointerup', 300, 200);
      await h.frames(1);
    }
    h.renderer.pickFn = () => ({ kind: 'object', objectId: 'o1', point: point() });
    h.pointer('pointerdown', 300, 200);
    h.pointer('pointerup', 300, 200); // "select a zombie first" toast: nothing happened
    h.game.selectAgent('a1');
    const sim = h.gameSim();
    sim.menuEntries = [{ interactionId: 'home_sleep', label: 'Sleep', group: null, icon: 'coffin', available: true, reason: null, cost: null, params: {} }];
    h.pointer('pointerdown', 300, 200);
    h.pointer('pointerup', 300, 200); // opens the menu: productive
    expect(h.game.menu).not.toBeNull();
    h.game.chooseMenuEntry(h.game.menu!.entries[0]); // first meaningful action
    h.game.setSpeed(4); // fake household is awake → refused
    await h.frames(2);
    const log = (await svc(h).log())!;
    expect(log.agg.clicksNone.by).toEqual({ 'live:noSelection': 4, 'locked:ultra': 1 });
    expect(log.agg.clicksNone.n).toBe(5);
    expect(log.firstAction?.type).toBe('queue:home_sleep');
    const ms = log.firstAction!.ms;
    h.game.openMenuFor({ kind: 'self' }, 1, 1);
    if (h.game.menu) h.game.chooseMenuEntry(h.game.menu.entries[0]);
    expect((await svc(h).log())!.firstAction!.ms).toBe(ms);
  });
});

const PLANTED = ['Bartholomew', 'Quackenbush', 'Zeldarine', 'Grimsbottom', 'zelda.q@example.com', 'my phone is 555-0199', 'I live at 12 Elm Street'];

describe('PII property test (real simulation)', () => {
  it('names, e-mails and free text planted in CAZ, the household, a rename and the world never reach the log or the summary', async () => {
    const h = await createHarness({ realSim: real, economy: econ('adult'), tutorial: { v: 1, seen: [] } });
    h.game.beginNewGame();
    h.game.addCazMember();
    h.game.updateCaz({ householdName: 'Zeldarine Grimsbottom', lotTemplate: 'derelict' });
    h.game.updateCazMember(0, { firstName: 'Bartholomew', lastName: 'Quackenbush' });
    h.game.updateCazMember(1, { firstName: 'Zeldarine', lastName: 'Grimsbottom' });
    h.env.randoms.push(4242);
    const started = h.game.startGame();
    await h.until(() => h.game.screen === 'game');
    await started;
    const sim = h.game.sim!;
    expect(Object.values(sim.state.agents).some((a) => a.firstName === 'Bartholomew')).toBe(true);
    h.game.renameHousehold('zelda.q@example.com'); // free text in a command
    // free text planted in the world itself (notifications, a choice-like text field)
    sim.state.notifications.push({ id: 999_999, tick: sim.state.tick, kind: 'info', title: 'my phone is 555-0199', text: 'I live at 12 Elm Street', agentId: null, objectId: null, read: false });
    h.game.setSpeed(3);
    for (let i = 0; i < 6; i++) {
      // queue whatever the selected zombie can do on the tile and on itself, buy and sell a fridge
      h.game.openMenuFor({ kind: 'tile', x: 12, z: 15 }, 10, 10);
      if (h.game.menu) h.game.chooseMenuEntry(h.game.menu.entries[0]);
      h.game.openMenuFor({ kind: 'self' }, 10, 10);
      const m = h.game.menu;
      const e = m?.entries.find((x) => x.available && !x.children?.length);
      if (e) h.game.chooseMenuEntry(e);
      else h.game.closeMenu();
      h.game.setMode('buy');
      h.game.applyBuild({ type: 'buy', defId: 'fridge_humming', x: 13, z: 13, rot: 0 });
      h.game.setMode('live');
      await h.frames(120);
    }
    h.game.openDialog('pause');
    await persistNow(h);
    const s = svc(h);
    const summary = (await s.summary())!;
    const stored = JSON.stringify([...h.profile.data.entries()].filter(([k]) => k.startsWith('slog')));
    expect(summary).toContain('ACT 1 FUNNEL');
    expect(summary).toContain('lot derelict');
    expect(stored.length).toBeGreaterThan(500);
    for (const p of PLANTED) {
      expect(summary, p).not.toContain(p);
      expect(stored, p).not.toContain(p);
    }
    // the case-insensitive check too (a name inside an id would be just as bad)
    for (const p of ['bartholomew', 'quackenbush', 'zeldarine', 'grimsbottom', 'example.com', '555-0199', 'elm street']) {
      expect(summary.toLowerCase()).not.toContain(p);
      expect(stored.toLowerCase()).not.toContain(p);
    }
  });
});

describe('determinism', () => {
  async function play(enabled: boolean): Promise<{ save: string; events: number }> {
    const h = await createHarness({ realSim: real, economy: econ('adult'), tutorial: { v: 1, seen: [] }, setup: ({ profile }) => profile.data.set(SESSION_INDEX_KEY, { v: 1, enabled }) });
    h.game.beginNewGame();
    h.game.addCazMember();
    h.game.updateCaz({ lotTemplate: 'derelict' });
    h.env.randoms.push(777);
    const started = h.game.startGame();
    await h.until(() => h.game.screen === 'game');
    await started;
    h.game.setSpeed(3);
    for (let i = 0; i < 4; i++) {
      h.game.openMenuFor({ kind: 'tile', x: 12, z: 15 }, 10, 10);
      if (h.game.menu) h.game.chooseMenuEntry(h.game.menu.entries[0]);
      h.game.setMode('buy');
      h.game.applyBuild({ type: 'buy', defId: 'fridge_humming', x: 13, z: 13, rot: 0 });
      h.game.setMode('live');
      h.renderer.pickFn = () => ({ kind: 'none' });
      h.pointer('pointerdown', 5, 5);
      h.pointer('pointerup', 5, 5);
      await h.frames(150);
    }
    const save = canonicalJson(h.game.sim!.serialize(), { undefinedProps: 'omit' });
    const log = await svc(h).log();
    h.game.dispose();
    return { save, events: log?.events.length ?? 0 };
  }

  it('recorder ON vs OFF: byte-identical saves after the same ~600 frames of scripted play', async () => {
    const on = await play(true);
    const off = await play(false);
    expect(on.events).toBeGreaterThan(20); // it really recorded
    expect(off.events).toBe(0);
    expect(on.save.length).toBeGreaterThan(10_000);
    expect(on.save === off.save).toBe(true);
  });
});
