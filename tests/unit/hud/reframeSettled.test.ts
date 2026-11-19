/**
 * W-129: after a quest "Go" frames its target, a HUD region that appears inside REFRAME_WINDOW_MS (the phone "Needs"
 * tip that fires when Go opens the zombie panel) triggers exactly ONE re-frame that includes it.
 * Minimal DOM fakes (no DOM library in this repo's unit runner). Cases:
 *  1. a tip appearing 400 ms later → framed twice, the second time with the tip among the avoided rects;
 *  2. nothing new appears → framed once, the watcher stops at the window end (no endless rAF);
 *  3. a tip appearing AFTER the window → no re-frame (the camera never jumps late);
 *  4. a panel that keeps appearing/disappearing → still at most one re-frame;
 *  5. framing failure (unknown object) → no watcher at all.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REFRAME_WINDOW_MS, frameObjectClearSettled } from '../../../src/ui/hud/lib/storyFraming';

type Rect = { left: number; top: number; width: number; height: number };
class El {
  dataset: Record<string, string> = {};
  classList = { contains: (c: string) => this.className.split(' ').includes(c) };
  constructor(public className: string, public rect: Rect, hintId?: string) {
    if (hintId) this.dataset.hintId = hintId;
  }
  getBoundingClientRect() {
    const r = this.rect;
    return { ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top };
  }
  querySelector() {
    return null;
  }
}

let regions: El[] = [];
let clock = 0;
let frames: (() => void)[] = [];
const g = globalThis as Record<string, unknown>;
const saved: Record<string, unknown> = {};

beforeEach(() => {
  regions = [new El('hud-top', { left: 0, top: 0, width: 390, height: 120 })];
  clock = 0;
  frames = [];
  for (const k of ['window', 'document', 'getComputedStyle', 'requestAnimationFrame']) saved[k] = g[k];
  g.window = { innerWidth: 390, innerHeight: 844 };
  g.document = {
    getElementById: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0 }) }),
    querySelectorAll: () => regions,
    documentElement: { hasAttribute: () => true },
  };
  g.getComputedStyle = () => ({ visibility: 'visible', display: 'block', opacity: '1' });
});
afterEach(() => {
  for (const k of Object.keys(saved)) g[k] = saved[k];
});

function fakeGame(ok = true) {
  const calls: number[] = [];
  return { calls, game: { frameObject: () => (calls.push(regions.length), ok) } as never };
}
const opts = () => ({ now: () => clock, raf: (cb: () => void) => void frames.push(cb) });
/** Advance fake time in 16 ms frames, running queued rAF callbacks. */
function run(ms: number, onFrame?: (t: number) => void) {
  for (const end = clock + ms; clock < end; ) {
    clock += 16;
    onFrame?.(clock);
    const batch = frames;
    frames = [];
    for (const f of batch) f();
  }
}

describe('W-129 Go keeps its target clear of HUD that opens right after', () => {
  it('a tutorial tip appearing 400 ms later causes exactly one re-frame that sees it', () => {
    const { calls, game } = fakeGame();
    frameObjectClearSettled(game, 'o1', opts());
    run(REFRAME_WINDOW_MS + 500, (t) => {
      if (t >= 400 && !regions.some((r) => r.dataset.hintId)) regions.push(new El('hud-hint-bubble', { left: 95, top: 365, width: 200, height: 190 }, 'needs'));
    });
    expect(calls).toEqual([1, 2]);
  });

  it('a tip that grows in over 300 ms is measured at its FINAL size (the phone failure: framed under its first frame)', () => {
    const heights: number[] = [];
    const game = { frameObject: () => (heights.push(regions.find((r) => r.dataset.hintId)?.rect.height ?? 0), true) } as never;
    frameObjectClearSettled(game, 'o1', opts());
    run(REFRAME_WINDOW_MS + 1500, (t) => {
      const tip = regions.find((r) => r.dataset.hintId);
      if (t >= 400 && !tip) regions.push(new El('hud-hint-bubble', { left: 95, top: 460, width: 200, height: 20 }, 'needs'));
      else if (tip && tip.rect.height < 190) tip.rect = { ...tip.rect, top: tip.rect.top - 10, height: Math.min(190, tip.rect.height + 10) };
    });
    expect(heights).toEqual([0, 190]);
  });

  it('nothing new: framed once and the watcher stops at the end of the window', () => {
    const { calls, game } = fakeGame();
    frameObjectClearSettled(game, 'o1', opts());
    run(REFRAME_WINDOW_MS + 500);
    expect(calls).toEqual([1]);
    expect(frames.length).toBe(0);
  });

  it('a tip that appears after the window never moves the camera late', () => {
    const { calls, game } = fakeGame();
    frameObjectClearSettled(game, 'o1', opts());
    run(REFRAME_WINDOW_MS + 100);
    regions.push(new El('hud-hint-bubble', { left: 95, top: 365, width: 200, height: 190 }, 'needs'));
    run(1000);
    expect(calls).toEqual([1]);
  });

  it('a flickering panel still yields at most one re-frame', () => {
    const { calls, game } = fakeGame();
    frameObjectClearSettled(game, 'o1', opts());
    run(REFRAME_WINDOW_MS, (t) => {
      const on = Math.floor(t / 100) % 2 === 1;
      const has = regions.some((r) => r.className === 'hud-flicker');
      if (on && !has) regions.push(new El('hud-flicker', { left: 0, top: 600, width: 390, height: 80 }));
      if (!on && has) regions = regions.filter((r) => r.className !== 'hud-flicker');
    });
    expect(calls.length).toBe(2);
  });

  it('when the first framing fails, no watcher is started', () => {
    const { calls, game } = fakeGame(false);
    expect(frameObjectClearSettled(game, 'gone', opts())).toBe(false);
    expect(frames.length).toBe(0);
    expect(calls.length).toBe(1);
  });
});
