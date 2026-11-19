/**
 * withResponsiveTimeout (src/game/saves.ts): a timeout that stands for "the other side did not answer" must not be
 * spent by our OWN blocked main thread (W-134: a 2 s wall-clock timeout on the journal lock dropped the crash
 * recovery whenever a long frame landed between the request and its answer).
 *
 * StallEnv models the browser's event loop for that case: `stall(ms)` is one long task — the clock jumps, then the
 * timers that became due run ONCE (a timer armed by one of them waits for a later turn), exactly as a blocked main
 * thread behaves. `turn(ms)` is an ordinary idle turn.
 */
import { describe, expect, it } from 'vitest';
import { RESPONSIVE_SLICE_MS, withResponsiveTimeout, withTimeout } from '../../../src/game/saves';

export class StallEnv {
  t = 0;
  private timers: { id: number; at: number; cb: () => void }[] = [];
  private next = 1;
  setTimeout(cb: () => void, ms: number): unknown {
    const id = this.next++;
    this.timers.push({ id, at: this.t + Math.max(0, ms), cb });
    return id;
  }
  clearTimeout(h: unknown): void {
    this.timers = this.timers.filter((x) => x.id !== h);
  }
  get armed(): number {
    return this.timers.length;
  }
  /** One task of `ms`: time passes, then every timer that is due now runs once. */
  stall(ms: number): void {
    this.t += ms;
    const due = this.timers.filter((x) => x.at <= this.t).sort((a, b) => a.at - b.at || a.id - b.id);
    this.timers = this.timers.filter((x) => !due.includes(x));
    for (const d of due) d.cb();
  }
  turn(ms = RESPONSIVE_SLICE_MS): void {
    this.stall(ms);
  }
}
const micro = async (n = 8): Promise<void> => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};
function deferred<T>(): { p: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const p = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { p, resolve, reject };
}

describe('withResponsiveTimeout', () => {
  it('an answer that arrives during a long stall wins, however long the stall (the wall-clock timeout loses)', async () => {
    for (const stallMs of [2_001, 12_000, 41_894 /* longest stall measured in headless Chromium */, 600_000]) {
      const env = new StallEnv();
      const d = deferred<string>();
      const wall = withTimeout(d.p, 2000, env, () => 'timeout');
      const resp = withResponsiveTimeout(d.p, 2000, env, () => 'timeout');
      env.stall(stallMs); // the main thread is blocked; the answer is queued behind it…
      d.resolve('granted'); // …and is delivered as soon as the thread is back
      await micro();
      for (let i = 0; i < 100; i++) env.turn();
      expect(await wall, `wall clock, ${stallMs} ms`).toBe('timeout'); // the old behaviour: our own stall read as "no answer"
      expect(await resp, `responsive, ${stallMs} ms`).toBe('granted');
      expect(env.armed).toBe(0); // no timer left behind
    }
  });

  it('no answer at all still times out, after the budget in responsive time (never hangs)', async () => {
    const env = new StallEnv();
    const never = new Promise<string>(() => undefined);
    let out: string | null = null;
    void withResponsiveTimeout(never, 2000, env, () => 'timeout').then((v) => (out = v));
    const slices = 2000 / RESPONSIVE_SLICE_MS;
    for (let i = 0; i < slices - 1; i++) env.turn();
    await micro();
    expect(out).toBeNull(); // one slice short
    env.turn();
    await micro();
    expect(out).toBe('timeout');
    expect(env.t).toBe(2000); // on a responsive thread it is the same 2 s as before
    expect(env.armed).toBe(0);
  });

  it('many stalls in a row each cost one slice: 20 stalled turns exhaust a 2 s budget', async () => {
    const env = new StallEnv();
    let out: string | null = null;
    void withResponsiveTimeout(new Promise<string>(() => undefined), 2000, env, () => 'timeout').then((v) => (out = v));
    for (let i = 0; i < 19; i++) env.stall(5000);
    await micro();
    expect(out).toBeNull();
    env.stall(5000);
    await micro();
    expect(out).toBe('timeout');
  });

  it('a rejection resolves with the fallback at once and clears its timer; a late answer after the timeout is ignored', async () => {
    const env = new StallEnv();
    const bad = deferred<string>();
    const r = withResponsiveTimeout(bad.p, 2000, env, () => 'fallback');
    bad.reject(new Error('lock manager threw'));
    expect(await r).toBe('fallback');
    expect(env.armed).toBe(0);

    const late = deferred<string>();
    let calls = 0;
    const r2 = withResponsiveTimeout(late.p, 300, env, () => (calls++, 'timeout'));
    for (let i = 0; i < 3; i++) env.turn();
    expect(await r2).toBe('timeout');
    late.resolve('granted');
    await micro();
    expect(calls).toBe(1);
    expect(env.armed).toBe(0);
  });

  it('garbage budgets and slices never hang or throw: at least one slice, default slice length', async () => {
    for (const [ms, slice] of [[0, 100], [-5, 100], [Number.NaN, 100], [Number.POSITIVE_INFINITY, 100], [250, 0], [250, Number.NaN], [250, -1]] as const) {
      const env = new StallEnv();
      let out: string | null = null;
      void withResponsiveTimeout(new Promise<string>(() => undefined), ms, env, () => 'timeout', slice).then((v) => (out = v));
      for (let i = 0; i < 4 && out === null; i++) {
        env.turn(RESPONSIVE_SLICE_MS);
        await micro();
      }
      expect(out, `ms ${ms}, slice ${slice}`).toBe('timeout');
    }
  });

  it('a throwing onTimeout rejects instead of hanging', async () => {
    const env = new StallEnv();
    const r = withResponsiveTimeout(new Promise<string>(() => undefined), 100, env, () => {
      throw new Error('boom');
    });
    env.turn();
    await expect(r).rejects.toThrow('boom');
  });
});
