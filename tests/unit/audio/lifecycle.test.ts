/**
 * Engine lifecycle state machine under adversarial orderings: unlock while muted, mute/unmute races around the
 * deferred suspend, involuntary suspension (iOS interruptions / device loss) and recovery, contexts closed under
 * us, dispose mid-unlock, and the contract shape of stats().
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioAPI } from '../../../src/audio/contracts';
import { AudioEngine } from '../../../src/audio/engine';
import { createAudio } from '../../../src/audio/index';
import { FakeContext, asCtx } from './fakeAudio';

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

/** Advance audio time and drive the engine scheduler by hand (timer: false engines). */
function run(ctx: FakeContext, e: AudioEngine, seconds: number, step = 0.025): void {
  for (let t = 0; t < seconds; t += step) {
    ctx.advance(step);
    e.tick();
  }
}

/** Sources created while running `seconds` of engine time. */
function sourcesDuring(ctx: FakeContext, e: AudioEngine, seconds: number): number {
  const n = ctx.sources.length;
  run(ctx, e, seconds);
  return ctx.sources.length - n;
}

afterEach(() => {
  vi.useRealTimers();
  const g = globalThis as Record<string, unknown>;
  delete g.addEventListener;
  delete g.removeEventListener;
});

describe('unlock while muted (window hidden / unfocused at the first gesture)', () => {
  it('a context that is already running: unmute starts music, loops and ambience (regression)', async () => {
    vi.useFakeTimers();
    const ctx = new FakeContext();
    ctx.state = 'running'; // created inside the gesture
    const e = new AudioEngine({ contextFactory: () => asCtx(ctx), timer: true });
    e.setMuted(true);
    e.music('live');
    e.loop('tv:1', 'tvChatter', true, { pan: 0, gain: 1 });
    e.setAmbience({ night: true, indoor: false });
    await e.unlock();
    await flush();
    expect(e.unlocked).toBe(true);
    // parked while muted: suspended by us, no scheduler running
    expect(ctx.state).toBe('suspended');
    expect(e.timerRunning).toBe(false);
    e.setMuted(false);
    await flush();
    expect(ctx.state).toBe('running');
    expect(e.timerRunning).toBe(true);
    const n = ctx.sources.length;
    for (let i = 0; i < 80; i++) {
      ctx.advance(0.025);
      await vi.advanceTimersByTimeAsync(25);
    }
    expect(e.stats().musicMood).toBe('live');
    expect(e.stats().loops).toBe(1);
    expect(e.stats().ambientLoops).toBe(2);
    expect(ctx.sources.length - n).toBeGreaterThan(20);
    expect(e.stats().errors).toBe(0);
    e.dispose();
  });

  it('a suspended context: the gesture still resumes it (autoplay unlock), then it is parked until unmute', async () => {
    const ctx = new FakeContext();
    const e = new AudioEngine({ contextFactory: () => asCtx(ctx), timer: false });
    e.setMuted(true);
    e.music('night');
    await e.unlock();
    await flush();
    expect(ctx.resumeCalls).toBe(1); // inside the gesture
    expect(ctx.suspendCalls).toBe(1); // parked straight away
    expect(e.unlocked).toBe(true);
    expect(sourcesDuring(ctx, e, 1)).toBe(0); // time is frozen while parked
    // a second unlock while parked is a no-op (no resume/suspend flapping)
    await e.unlock();
    expect(ctx.resumeCalls).toBe(1);
    e.setMuted(false);
    await flush();
    expect(ctx.state).toBe('running');
    expect(sourcesDuring(ctx, e, 3)).toBeGreaterThan(10);
    expect(e.stats().musicMood).toBe('night');
  });

  it('muting while the unlock resume is still pending ends parked, and unmute plays', async () => {
    const ctx = new FakeContext();
    let finish: () => void = () => undefined;
    ctx.resume = () => {
      ctx.resumeCalls++;
      return new Promise<void>((r) => {
        finish = () => {
          ctx.state = 'running';
          r();
        };
      });
    };
    const e = new AudioEngine({ contextFactory: () => asCtx(ctx), timer: false });
    e.music('menu');
    const p = e.unlock();
    e.setMuted(true);
    finish();
    await p;
    await flush();
    expect(e.unlocked).toBe(true);
    expect(ctx.state).toBe('suspended');
    ctx.resume = FakeContext.prototype.resume.bind(ctx);
    e.setMuted(false);
    await flush();
    expect(ctx.state).toBe('running');
    expect(sourcesDuring(ctx, e, 3)).toBeGreaterThan(10);
  });
});

describe('mute / unmute races', () => {
  async function unlocked() {
    const ctx = new FakeContext();
    const e = new AudioEngine({ contextFactory: () => asCtx(ctx), timer: true });
    await e.unlock();
    return { ctx, e };
  }

  it('unmute before the deferred suspend fires: the context is never suspended', async () => {
    vi.useFakeTimers();
    const { ctx, e } = await unlocked();
    e.setMuted(true);
    await vi.advanceTimersByTimeAsync(100);
    e.setMuted(false);
    await vi.advanceTimersByTimeAsync(400);
    expect(ctx.suspendCalls).toBe(0);
    expect(ctx.state).toBe('running');
    expect(e.timerRunning).toBe(true);
    e.dispose();
  });

  it('unmute right after the suspend was issued: resume is queued behind it and the scheduler restarts', async () => {
    vi.useFakeTimers();
    const { ctx, e } = await unlocked();
    e.music('party');
    e.setMuted(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(ctx.suspendCalls).toBe(1);
    expect(e.timerRunning).toBe(false); // no 40 Hz timer while parked
    e.setMuted(false);
    await flush();
    expect(ctx.state).toBe('running');
    expect(e.timerRunning).toBe(true);
    const n = ctx.sources.length;
    for (let i = 0; i < 80; i++) {
      ctx.advance(0.025);
      await vi.advanceTimersByTimeAsync(25);
    }
    expect(ctx.sources.length).toBeGreaterThan(n + 10);
    expect(e.stats().errors).toBe(0);
    e.dispose();
  });

  it('a mute storm (500 toggles) leaves exactly one timer and a consistent final state', async () => {
    vi.useFakeTimers();
    const { ctx, e } = await unlocked();
    for (let i = 0; i < 500; i++) {
      e.setMuted(i % 2 === 0);
      if (i % 7 === 0) await vi.advanceTimersByTimeAsync(170);
      if (i % 11 === 0) await flush();
    }
    e.setMuted(false);
    await vi.advanceTimersByTimeAsync(300);
    await flush();
    expect(ctx.state).toBe('running');
    expect(e.timerRunning).toBe(true);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(2); // the scheduler interval (+ at most a stray resume race)
    expect(e.stats().errors).toBe(0);
    e.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('involuntary suspension (iOS interruption, audio device loss)', () => {
  function stubWindowListeners() {
    const added: { type: string; fn: () => void }[] = [];
    const removed: string[] = [];
    const g = globalThis as Record<string, unknown>;
    g.addEventListener = (type: string, fn: () => void) => added.push({ type, fn });
    g.removeEventListener = (type: string) => removed.push(type);
    return { added, removed };
  }

  it('tries to resume at once, arms gesture listeners, and disarms them once running again', async () => {
    const win = stubWindowListeners();
    const ctx = new FakeContext();
    const e = new AudioEngine({ contextFactory: () => asCtx(ctx), timer: false });
    await e.unlock();
    await flush();
    e.music('live');
    ctx.rejectResume = true; // the interruption is still going on
    ctx.interrupt('interrupted');
    await flush();
    expect(e.stats().interruptions).toBe(1);
    expect(e.unlocked).toBe(false); // honest: nothing is audible right now
    expect(win.added.map((a) => a.type).sort()).toEqual(['keydown', 'pointerdown', 'touchend']);
    const resumesBefore = ctx.resumeCalls;
    // the next gesture resumes
    ctx.rejectResume = false;
    win.added[0].fn();
    await flush();
    expect(ctx.resumeCalls).toBe(resumesBefore + 1);
    expect(ctx.state).toBe('running');
    expect(e.unlocked).toBe(true);
    expect(win.removed.sort()).toEqual(['keydown', 'pointerdown', 'touchend']);
    expect(sourcesDuring(ctx, e, 3)).toBeGreaterThan(10);
  });

  it('the OS ending the interruption by itself restarts scheduling; repeated interruptions arm listeners once', async () => {
    const win = stubWindowListeners();
    const ctx = new FakeContext();
    const e = new AudioEngine({ contextFactory: () => asCtx(ctx), timer: false });
    await e.unlock();
    await flush();
    ctx.rejectResume = true;
    for (let i = 0; i < 5; i++) {
      ctx.interrupt(i % 2 ? 'suspended' : 'interrupted');
      await flush();
    }
    expect(win.added.length).toBe(3);
    ctx.endInterruption();
    await flush();
    expect(e.unlocked).toBe(true);
    expect(win.removed.length).toBe(3);
    expect(e.stats().errors).toBe(0);
  });

  it('no recovery while muted (our own suspend is not an interruption); muting disarms armed listeners', async () => {
    vi.useFakeTimers();
    const win = stubWindowListeners();
    const ctx = new FakeContext();
    const e = new AudioEngine({ contextFactory: () => asCtx(ctx), timer: true });
    await e.unlock();
    e.setMuted(true);
    await vi.advanceTimersByTimeAsync(200);
    await flush();
    expect(ctx.state).toBe('suspended');
    expect(e.stats().interruptions).toBe(0);
    expect(win.added.length).toBe(0);
    // interrupted while audible, then muted: listeners go away
    e.setMuted(false);
    await flush();
    ctx.rejectResume = true;
    ctx.interrupt();
    await flush();
    expect(win.added.length).toBe(3);
    e.setMuted(true);
    expect(win.removed.length).toBe(3);
    e.dispose();
  });

  it('works without window listeners (node, workers): recovery just retries resume', async () => {
    const ctx = new FakeContext();
    const e = new AudioEngine({ contextFactory: () => asCtx(ctx), timer: false });
    await e.unlock();
    ctx.rejectResume = true;
    ctx.interrupt();
    await flush();
    expect(e.stats().errors).toBe(0);
    ctx.rejectResume = false;
    ctx.endInterruption();
    await flush();
    expect(e.unlocked).toBe(true);
  });
});

describe('contexts closed under us', () => {
  it('the next unlock builds a fresh context, keeping desired loops, music and ambience', async () => {
    const made: FakeContext[] = [];
    const e = new AudioEngine({ contextFactory: () => asCtx(made[made.push(new FakeContext()) - 1]), timer: false });
    e.loop('shower:o1', 'shower', true, { pan: 0.2, gain: 0.8 });
    e.music('build');
    e.setAmbience({ night: false, indoor: true, rain: true });
    await e.unlock();
    expect(made.length).toBe(1);
    void made[0].close(); // someone else closed it
    await flush();
    expect(e.unlocked).toBe(false);
    await e.unlock();
    expect(made.length).toBe(2);
    expect(e.unlocked).toBe(true);
    expect(e.stats().loops).toBe(1);
    expect(e.stats().musicMood).toBe('build');
    expect(e.stats().ambientLoops).toBe(2); // day wind + rain
    expect(sourcesDuring(made[1], e, 2)).toBeGreaterThan(10);
    // the dead context is never touched again
    const n0 = made[0].nodesCreated;
    run(made[1], e, 1);
    expect(made[0].nodesCreated).toBe(n0);
  });

  it('recreation is bounded (a factory that always hands out closed contexts cannot spin)', async () => {
    let made = 0;
    const e = new AudioEngine({
      contextFactory: () => {
        made++;
        const c = new FakeContext();
        c.state = 'closed';
        return asCtx(c);
      },
      timer: false,
    });
    for (let i = 0; i < 10; i++) await e.unlock();
    expect(made).toBeLessThanOrEqual(4);
    expect(e.unlocked).toBe(false);
    expect(() => e.sfx('uiClick')).not.toThrow();
  });
});

describe('dispose', () => {
  it('dispose during a pending unlock leaves no listeners, timers or running scheduler', async () => {
    vi.useFakeTimers();
    const ctx = new FakeContext();
    ctx.hangResume = true;
    const e = new AudioEngine({ contextFactory: () => asCtx(ctx), timer: true });
    const p = e.unlock();
    await flush();
    expect(ctx.listenerCount).toBe(1);
    e.dispose();
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    expect(ctx.listenerCount).toBe(0);
    expect(e.timerRunning).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(e.unlocked).toBe(false);
    expect(ctx.closeCalls).toBe(1);
  });
});

describe('stats() — AudioAPI.stats contract', () => {
  it('is typed and shaped as Readonly<Record<string, string | number | boolean>>', async () => {
    const api: AudioAPI = createAudio({ contextFactory: () => asCtx(new FakeContext()), timer: false });
    const before = api.stats?.();
    expect(before).toBeDefined();
    await api.unlock();
    api.sfx('cash');
    api.music('live');
    const st: Readonly<Record<string, string | number | boolean>> | undefined = api.stats?.();
    for (const [k, v] of Object.entries(st ?? {})) expect(['string', 'number', 'boolean'], k).toContain(typeof v);
    expect(st?.unlocked).toBe(true);
    api.dispose();
    expect(api.stats?.().state).toBe('disposed');
  });

  it('never throws, even when the context state getter does', async () => {
    const ctx = new FakeContext();
    const e = new AudioEngine({ contextFactory: () => asCtx(ctx), timer: false });
    await e.unlock();
    Object.defineProperty(ctx, 'state', {
      get() {
        throw new Error('hostile');
      },
    });
    expect(() => e.stats()).not.toThrow();
    expect(e.stats().state).toBe('closed');
    expect(e.unlocked).toBe(false);
    expect(() => e.tick()).not.toThrow();
    expect(() => e.sfx('uiClick')).not.toThrow();
    expect(() => e.setMuted(true)).not.toThrow();
    expect(() => e.dispose()).not.toThrow();
  });
});
