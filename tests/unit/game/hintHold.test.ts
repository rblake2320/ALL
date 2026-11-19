/**
 * W-129: after a quest Go the hint engine holds NEW tips for GO_HINT_HOLD_MS so the target the camera just framed is
 * not covered on a phone (no gap on 390×844 fits the target once the Needs tip is up). Proves:
 *  1. an eligible tip does not start during the hold, and does start once it ends;
 *  2. a tip already showing is not hidden by a hold;
 *  3. holds only extend (a shorter or NaN hold never cuts one short);
 *  4. the real controller wiring: questGo returning 'queue' sets the hold (other kinds do not).
 */
import { describe, expect, it } from 'vitest';
import { GO_HINT_HOLD_MS, HintEngine, MIN_GAP_MS, type HintDef } from '../../../src/game/hints';

const defs: HintDef[] = [
  { id: 'a', title: 'A', text: 'a', anchor: null, when: () => true },
  { id: 'b', title: 'B', text: 'b', anchor: null, when: () => true },
];
const facts = { inGame: true, mode: 'live', choicePending: false } as never;
const engine = () => new HintEngine([], () => {}, defs);

describe('W-129 hint hold after quest Go', () => {
  it('no new tip during the hold; it starts once the hold ends', () => {
    const h = engine();
    h.hold(1000 + GO_HINT_HOLD_MS);
    h.update(facts, 1000, true);
    expect(h.current).toBeNull();
    h.update(facts, 1000 + GO_HINT_HOLD_MS - 1, true);
    expect(h.current).toBeNull();
    h.update(facts, 1000 + GO_HINT_HOLD_MS, true);
    expect(h.current?.id).toBe('a');
  });

  it('a tip already showing stays visible through a hold', () => {
    const h = engine();
    h.update(facts, 0, true);
    expect(h.current?.id).toBe('a');
    h.hold(10_000);
    h.update(facts, 100, true);
    expect(h.current?.id).toBe('a');
    // ...but the NEXT tip waits for the hold even after this one is dismissed
    h.dismiss('a', 200);
    h.update(facts, 200 + MIN_GAP_MS, true);
    expect(h.current).toBeNull();
    h.update(facts, 10_000, true);
    expect(h.current?.id).toBe('b');
  });

  it('holds only extend: a shorter or NaN hold never cuts an existing one short', () => {
    const h = engine();
    h.hold(5000);
    h.hold(1000);
    h.hold(Number.NaN);
    h.update(facts, 4999, true);
    expect(h.current).toBeNull();
    h.update(facts, 5000, true);
    expect(h.current?.id).toBe('a');
  });
});
