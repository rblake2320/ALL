/**
 * withEffectProbe in isolation (a fake cleaning behaviour that does NOTHING — the "it finished but nothing happened"
 * case cannot be faked from outside a real step). Proves the counting rule exactly:
 *  - complete + mess unchanged → interactionNoEffect + cleanFails 1;   complete + mess reduced → nothing;
 *  - failed → cleanFails 1 (no NoEffect event);   canceled → nothing (pause / player cancel / preemption);
 *  - auto source → nothing;   the inner behaviour's own begin/end still run and its begin result is passed through;
 *  - messOf: loose dish = 1, gone = 0, dirt + trash fill add up.
 */
import { describe, expect, it } from 'vitest';
import { CLEAN_FAILS, messOf, withEffectProbe } from '../../../src/sim/systems/home/upkeep/stuck';

function harness(src: 'player' | 'auto' | 'system' = 'player') {
  const obj: any = { id: 'o1', defId: 'counter_butcher', condition: { dirt: 0.8 }, data: {} };
  const events: any[] = [];
  const ctx: any = { state: { objects: { o1: obj } }, emit: (e: any) => events.push(e) };
  const run: any = { uid: 7, interactionId: 'home_wipeDown', source: src, target: { kind: 'object', id: 'o1' }, data: {} };
  const calls: string[] = [];
  const beh = withEffectProbe({ begin: () => (calls.push('begin'), 'inner-begin'), end: (_c: unknown, _a: unknown, _r: unknown, _d: unknown, o: string) => void calls.push(`end:${o}`) } as any);
  return { obj, events, ctx, run, calls, beh, actor: { id: 'a1' } as any, def: { id: 'home_wipeDown' } as any };
}

describe('W-131 effect probe', () => {
  it('complete with the mess unchanged → interactionNoEffect + cleanFails', () => {
    const h = harness();
    expect(h.beh.begin!(h.ctx, h.actor, h.run, h.def)).toBe('inner-begin');
    h.beh.end!(h.ctx, h.actor, h.run, h.def, 'complete');
    expect(h.events).toEqual([{ type: 'interactionNoEffect', agentId: 'a1', uid: 7, interactionId: 'home_wipeDown', targetId: 'o1', source: 'player' }]);
    expect(h.obj.data[CLEAN_FAILS]).toBe(1);
    expect(h.calls).toEqual(['begin', 'end:complete']);
  });

  it('complete with the mess reduced → nothing recorded', () => {
    const h = harness();
    h.beh.begin!(h.ctx, h.actor, h.run, h.def);
    h.obj.condition.dirt = 0;
    h.beh.end!(h.ctx, h.actor, h.run, h.def, 'complete');
    expect(h.events).toEqual([]);
    expect(h.obj.data[CLEAN_FAILS]).toBeUndefined();
  });

  it('failed counts; canceled and autonomous runs never do', () => {
    const f = harness();
    f.beh.begin!(f.ctx, f.actor, f.run, f.def);
    f.beh.end!(f.ctx, f.actor, f.run, f.def, 'failed');
    expect(f.obj.data[CLEAN_FAILS]).toBe(1);
    expect(f.events).toEqual([]);
    const c = harness();
    c.beh.begin!(c.ctx, c.actor, c.run, c.def);
    c.beh.end!(c.ctx, c.actor, c.run, c.def, 'canceled');
    expect(c.obj.data[CLEAN_FAILS]).toBeUndefined();
    const a = harness('auto');
    a.beh.begin!(a.ctx, a.actor, a.run, a.def);
    a.beh.end!(a.ctx, a.actor, a.run, a.def, 'complete');
    a.beh.end!(a.ctx, a.actor, a.run, a.def, 'failed');
    expect(a.obj.data[CLEAN_FAILS]).toBeUndefined();
    expect(a.events).toEqual([]);
  });

  it('a target that was already clean at the start never counts as no-effect', () => {
    const h = harness();
    h.obj.condition.dirt = 0;
    h.beh.begin!(h.ctx, h.actor, h.run, h.def);
    h.beh.end!(h.ctx, h.actor, h.run, h.def, 'complete');
    expect(h.events).toEqual([]);
  });

  it('messOf: loose dish = 1, gone = 0, dirt + trash fill add up', () => {
    expect(messOf({ id: 'd', defId: 'item_dish', data: {} } as any)).toBe(1);
    expect(messOf(null)).toBe(0);
    expect(messOf({ id: 't', defId: 'trash_lidded', condition: { dirt: 0.5 }, data: { fill: 3 } } as any)).toBeCloseTo(3.5);
  });
});
