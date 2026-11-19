/** contextWatch helpers: total state reads, raced resume, statechange subscription, gesture retry arming. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RECOVERY_EVENTS, armGestureRetry, resumeWithin, stateOf, tryResume, trySuspend, watchContextState } from '../../../src/audio/contextWatch';
import { FakeContext, asCtx } from './fakeAudio';

afterEach(() => {
  vi.useRealTimers();
  const g = globalThis as Record<string, unknown>;
  delete g.addEventListener;
  delete g.removeEventListener;
});

describe('contextWatch', () => {
  it('stateOf never throws', () => {
    const ctx = new FakeContext();
    expect(stateOf(asCtx(ctx))).toBe('suspended');
    Object.defineProperty(ctx, 'state', { get: () => { throw new Error('x'); } });
    expect(stateOf(asCtx(ctx))).toBe('closed');
    expect(stateOf({} as BaseAudioContext)).toBe('undefined');
  });

  it('resumeWithin gives up on a resume that never settles and clears its timer', async () => {
    vi.useFakeTimers();
    const ctx = new FakeContext();
    ctx.hangResume = true;
    let done = false;
    void resumeWithin(asCtx(ctx), 1500).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1400);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    // a normal resume settles immediately and leaves no timer behind
    const ok = new FakeContext();
    await resumeWithin(asCtx(ok), 1500);
    expect(ok.state).toBe('running');
    expect(vi.getTimerCount()).toBe(0);
    // rejecting / missing resume never throws
    ok.rejectResume = true;
    await expect(resumeWithin(asCtx(ok), 10)).resolves.toBeUndefined();
    await expect(resumeWithin({} as BaseAudioContext, 10)).resolves.toBeUndefined();
  });

  it('tryResume / trySuspend report outcomes and swallow everything', async () => {
    const ctx = new FakeContext();
    const results: boolean[] = [];
    tryResume(asCtx(ctx), (ok) => results.push(ok));
    ctx.rejectResume = true;
    tryResume(asCtx(ctx), (ok) => results.push(ok));
    await Promise.resolve();
    await Promise.resolve();
    expect(results).toEqual([true, false]);
    expect(trySuspend(asCtx(ctx))).toBe(true);
    expect(trySuspend({} as BaseAudioContext)).toBe(false);
    const throwing = { suspend: () => { throw new Error('sync'); }, resume: () => { throw new Error('sync'); } } as unknown as BaseAudioContext;
    expect(trySuspend(throwing)).toBe(false);
    expect(() => tryResume(throwing, (ok) => results.push(ok))).not.toThrow();
    expect(results[results.length - 1]).toBe(false);
  });

  it('watchContextState prefers addEventListener, falls back to onstatechange, and unsubscribes', async () => {
    const ctx = new FakeContext();
    let n = 0;
    const off = watchContextState(asCtx(ctx), () => n++);
    expect(ctx.listenerCount).toBe(1);
    void ctx.resume();
    await Promise.resolve();
    await Promise.resolve();
    expect(n).toBe(1);
    off();
    expect(ctx.listenerCount).toBe(0);
    const plain = { state: 'running' } as unknown as BaseAudioContext & { onstatechange: (() => void) | null };
    const off2 = watchContextState(plain, () => n++);
    plain.onstatechange?.();
    expect(n).toBe(2);
    off2();
    expect(plain.onstatechange).toBeNull();
    const frozen = Object.freeze({ state: 'running' }) as unknown as BaseAudioContext;
    expect(() => watchContextState(frozen, () => n++)()).not.toThrow();
  });

  it('armGestureRetry needs a window, arms every recovery gesture and disarms them all', () => {
    expect(armGestureRetry(() => undefined)).toBeNull();
    const added: string[] = [];
    const removed: string[] = [];
    const g = globalThis as Record<string, unknown>;
    g.addEventListener = (t: string) => added.push(t);
    g.removeEventListener = (t: string) => removed.push(t);
    const disarm = armGestureRetry(() => undefined);
    expect(disarm).not.toBeNull();
    expect(added.sort()).toEqual([...RECOVERY_EVENTS].sort());
    disarm?.();
    expect(removed.sort()).toEqual([...RECOVERY_EVENTS].sort());
    g.addEventListener = () => {
      throw new Error('blocked');
    };
    expect(armGestureRetry(() => undefined)).toBeNull();
  });
});
