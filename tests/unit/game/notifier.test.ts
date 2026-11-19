import { describe, expect, it } from 'vitest';
import { Notifier } from '../../../src/game/notifier';
import { FakeEnv } from './fakes';

function make(env = new FakeEnv(), errors: unknown[] = []) {
  const n = new Notifier({
    minIntervalMs: 1000 / 12,
    now: () => env.now(),
    setTimeout: (cb, ms) => env.setTimeout(cb, ms),
    clearTimeout: (h) => env.clearTimeout(h),
    onListenerError: (e) => errors.push(e),
  });
  return { n, env, errors };
}

describe('Notifier', () => {
  it('discrete changes notify immediately and bump the version', () => {
    const { n } = make();
    let calls = 0;
    n.subscribe(() => calls++);
    const v = n.version;
    n.notifyNow();
    n.notifyNow();
    expect(calls).toBe(2);
    expect(n.version).toBe(v + 2);
  });

  it('continuous changes are throttled to ≤ 12/s', () => {
    const { n, env } = make();
    let calls = 0;
    n.subscribe(() => calls++);
    for (let i = 0; i < 1000; i++) {
      n.markDirty();
      env.advance(1);
      n.pump(env.now());
    }
    // 1000 ms of continuous dirtiness
    expect(calls).toBeGreaterThanOrEqual(10);
    expect(calls).toBeLessThanOrEqual(13);
  });

  it('a dirty flag is flushed by the fallback timer even if no frame pumps it', () => {
    const { n, env } = make();
    let calls = 0;
    n.subscribe(() => calls++);
    n.markDirty();
    expect(calls).toBe(0);
    env.advance(200);
    expect(calls).toBe(1);
    expect(n.isDirty).toBe(false);
  });

  it('a throwing listener is reported and does not block the others', () => {
    const { n, errors } = make();
    const seen: string[] = [];
    n.subscribe(() => seen.push('a'));
    n.subscribe(() => {
      throw new Error('bad component');
    });
    n.subscribe(() => seen.push('c'));
    n.notifyNow();
    expect(seen).toEqual(['a', 'c']);
    expect(errors.length).toBe(1);
  });

  it('re-entrant notifications become one extra pass, never recursion', () => {
    const { n } = make();
    let depth = 0;
    let maxDepth = 0;
    let passes = 0;
    n.subscribe(() => {
      depth++;
      maxDepth = Math.max(maxDepth, depth);
      passes++;
      if (passes < 3) n.notifyNow();
      depth--;
    });
    n.notifyNow();
    expect(maxDepth).toBe(1);
    expect(passes).toBe(3);
  });

  it('a listener that always re-notifies cannot spin forever', () => {
    const { n, env } = make();
    let calls = 0;
    n.subscribe(() => {
      calls++;
      n.notifyNow();
    });
    n.notifyNow();
    expect(calls).toBe(4); // MAX_PASSES, then deferred
    env.advance(100);
    expect(calls).toBeLessThan(10);
  });

  it('unsubscribe (including during a pass, and twice) is safe', () => {
    const { n } = make();
    const seen: string[] = [];
    let offB: () => void = () => undefined;
    n.subscribe(() => {
      seen.push('a');
      offB();
    });
    offB = n.subscribe(() => seen.push('b'));
    n.notifyNow();
    expect(seen).toEqual(['a']);
    offB();
    expect(n.listenerCount).toBe(1);
    // same function subscribed twice → two independent subscriptions
    const fn = () => seen.push('x');
    const u1 = n.subscribe(fn);
    n.subscribe(fn);
    u1();
    n.notifyNow();
    expect(seen.filter((s) => s === 'x').length).toBe(1);
  });

  it('dispose stops everything; non-function subscribers are ignored', () => {
    const { n, env } = make();
    let calls = 0;
    n.subscribe(() => calls++);
    n.subscribe(42 as never)();
    n.dispose();
    n.notifyNow();
    n.markDirty();
    env.advance(500);
    expect(calls).toBe(0);
  });
});
