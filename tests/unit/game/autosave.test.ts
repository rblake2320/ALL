import { describe, expect, it } from 'vitest';
import { AutosaveScheduler, formatSaveLabel, type AutosaveDeps } from '../../../src/game/autosave';
import { flush } from './fakes';

interface Harness {
  sched: AutosaveScheduler;
  clock: { t: number };
  world: { tick: number; mutations: number };
  writes: string[];
  gate: { hold(): void; release(): void; fail: boolean; throw: boolean };
  allowed: { v: boolean };
  interval: { ms: number };
}

function harness(over: Partial<AutosaveDeps> = {}): Harness {
  const clock = { t: 0 };
  const world = { tick: 0, mutations: 0 };
  const writes: string[] = [];
  let pending: (() => void) | null = null;
  let blocker: Promise<void> | null = null;
  const gate = {
    fail: false,
    throw: false,
    hold() {
      blocker = new Promise<void>((r) => (pending = r));
    },
    release() {
      const p = pending;
      blocker = null;
      pending = null;
      p?.();
    },
  };
  const allowed = { v: true };
  const interval = { ms: 5 * 60_000 };
  const sched = new AutosaveScheduler({
    now: () => clock.t,
    intervalMs: () => interval.ms,
    canAutosave: () => allowed.v,
    signature: () => `${world.tick}:${world.mutations}`,
    write: async (reason) => {
      writes.push(`${reason}@${world.tick}:${world.mutations}`);
      if (blocker) await blocker;
      if (gate.throw) throw new Error('io');
      return !gate.fail;
    },
    retryMs: 30_000,
    ...over,
  });
  return { sched, clock, world, writes, gate, allowed, interval };
}

describe('AutosaveScheduler — interval', () => {
  it('saves once per interval of REAL time, not before', async () => {
    const h = harness();
    h.world.tick = 10;
    h.clock.t = 4 * 60_000;
    h.sched.tick();
    await flush();
    expect(h.writes).toEqual([]);
    h.clock.t = 5 * 60_000;
    h.sched.tick();
    await flush();
    expect(h.writes).toEqual(['interval@10:0']);
    h.sched.tick();
    await flush();
    expect(h.writes.length).toBe(1);
  });

  it('is idempotent per sim tick: same signature → no second write', async () => {
    const h = harness();
    h.world.tick = 50;
    expect(await h.sched.trigger('quit')).toBe('saved');
    expect(await h.sched.trigger('hidden')).toBe('skipped');
    h.clock.t = 10 * 60_000;
    h.sched.tick();
    await flush();
    expect(h.writes.length).toBe(1);
    h.world.tick = 51;
    expect(await h.sched.trigger('quit')).toBe('saved');
    expect(h.writes.length).toBe(2);
  });

  it('paused build edits (same tick, new command) DO count as changes', async () => {
    const h = harness();
    await h.sched.trigger('a');
    h.world.mutations++; // e.g. bought a sofa while paused
    expect(await h.sched.trigger('b')).toBe('saved');
  });

  it('waits while a modal choice is pending, then saves as soon as it is allowed', async () => {
    const h = harness();
    h.world.tick = 5;
    h.allowed.v = false;
    h.clock.t = 6 * 60_000;
    h.sched.tick();
    await flush();
    expect(h.writes).toEqual([]);
    h.allowed.v = true;
    h.sched.tick();
    await flush();
    expect(h.writes).toEqual(['interval@5:0']);
  });

  it('interval 0 = off (event triggers still work)', async () => {
    const h = harness();
    h.interval.ms = 0;
    h.world.tick = 1;
    h.clock.t = 1e9;
    h.sched.tick();
    await flush();
    expect(h.writes).toEqual([]);
    expect(await h.sched.trigger('quit')).toBe('saved');
  });

  it('nothing to save (null signature) is skipped', async () => {
    const h = harness({ signature: () => null });
    expect(await h.sched.trigger('quit')).toBe('skipped');
    expect(h.writes).toEqual([]);
  });
});

describe('AutosaveScheduler — concurrency', () => {
  it('concurrent triggers coalesce into ONE follow-up write', async () => {
    const h = harness();
    h.world.tick = 1;
    h.gate.hold();
    const first = h.sched.trigger('interval');
    expect(h.sched.busy).toBe(true);
    h.world.tick = 2;
    const followers = [h.sched.trigger('hidden'), h.sched.trigger('quit'), h.sched.trigger('unload'), h.sched.trigger('hidden')];
    // all followers share one promise
    expect(new Set(followers).size).toBe(1);
    h.gate.release();
    expect(await first).toBe('saved');
    const outcomes = await Promise.all(followers);
    expect(outcomes.every((o) => o === 'saved')).toBe(true);
    expect(h.writes).toEqual(['interval@1:0', 'hidden@2:0']);
  });

  it('the follow-up is skipped when nothing changed during the in-flight write', async () => {
    const h = harness();
    h.world.tick = 7;
    h.gate.hold();
    const first = h.sched.trigger('interval');
    const second = h.sched.trigger('quit');
    h.gate.release();
    expect(await first).toBe('saved');
    expect(await second).toBe('skipped');
    expect(h.writes.length).toBe(1);
  });

  it('a re-entrant trigger from inside write() coalesces instead of writing in parallel', async () => {
    let sched!: AutosaveScheduler;
    let inner: Promise<string> | null = null;
    let active = 0;
    let maxActive = 0;
    let tick = 1;
    sched = new AutosaveScheduler({
      now: () => 0,
      intervalMs: () => 60_000,
      canAutosave: () => true,
      signature: () => `${tick}`,
      write: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        if (!inner) {
          tick = 2;
          inner = sched.trigger('nested');
        }
        await flush(2);
        active--;
        return true;
      },
    });
    await sched.trigger('outer');
    await inner;
    expect(maxActive).toBe(1);
  });

  it('a failed or throwing write never rejects and backs off', async () => {
    const h = harness();
    h.world.tick = 3;
    h.gate.fail = true;
    expect(await h.sched.trigger('interval')).toBe('failed');
    expect(h.sched.consecutiveFailures).toBe(1);
    expect(h.sched.dueAt).toBe(30_000); // retry soon, not after the full interval
    h.gate.fail = false;
    h.gate.throw = true;
    expect(await h.sched.trigger('interval')).toBe('failed');
    expect(h.sched.dueAt).toBe(60_000); // doubled
    h.gate.throw = false;
    expect(await h.sched.trigger('interval')).toBe('saved');
    expect(h.sched.consecutiveFailures).toBe(0);
    expect(h.sched.dueAt).toBe(5 * 60_000);
  });

  it('a throwing signature() is contained', async () => {
    const h = harness({
      signature: () => {
        throw new Error('broken state');
      },
    });
    await expect(h.sched.trigger('x')).resolves.toBe('failed');
    expect(h.sched.busy).toBe(false);
  });

  it('markSaved / dirty / reset', async () => {
    const h = harness();
    h.world.tick = 9;
    expect(h.sched.dirty()).toBe(true);
    h.sched.markSaved('9:0');
    expect(h.sched.dirty()).toBe(false);
    expect(await h.sched.trigger('quit')).toBe('skipped');
    h.sched.reset(null);
    expect(h.sched.dirty()).toBe(true);
  });
});

describe('formatSaveLabel', () => {
  const T = Date.UTC(2026, 10, 5, 12);
  it.each([
    [T, T, false, 'Saved just now'],
    [T, T + 59_999, false, 'Saved just now'],
    [T, T + 60_000, false, 'Saved 1 min ago'],
    [T, T + 3 * 60_000 + 5_000, false, 'Saved 3 min ago'],
    [T, T + 59 * 60_000, false, 'Saved 59 min ago'],
    [T, T + 60 * 60_000, false, 'Saved 1 h ago'],
    [T, T + 23 * 3_600_000, false, 'Saved 23 h ago'],
    [T, T + 24 * 3_600_000, false, 'Saved 1 day ago'],
    [T, T + 72 * 3_600_000, false, 'Saved 3 days ago'],
    [T, T - 10 * 60_000, false, 'Saved just now'], // clock went backwards
    [T, NaN, false, 'Saved just now'],
    [null, T, false, null],
    [NaN, T, false, null],
    [T, T + 600_000, true, 'Save failed'],
    [null, T, true, 'Save failed'],
  ] as const)('%s → %s (failed=%s) = %s', (ok, now, failed, label) => {
    expect(formatSaveLabel(ok as number | null, now as number, failed)).toBe(label);
  });
});
