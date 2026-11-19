import { describe, expect, it } from 'vitest';
import { SpeedState, gateSpeed, isAsleep, isSpeed, ultraAllowed, type MemberLike } from '../../../src/game/speed';

const m = (presence: MemberLike['presence'], anim: string, passedOut = false): MemberLike => ({ presence, anim, status: { passedOut } });

describe('ultra speed gating (GDD §2)', () => {
  const table: { name: string; members: (MemberLike | null | undefined)[]; allowed: boolean }[] = [
    { name: 'everyone home asleep', members: [m('onLot', 'sleep'), m('onLot', 'sleep')], allowed: true },
    { name: 'one awake at home', members: [m('onLot', 'sleep'), m('onLot', 'idle')], allowed: false },
    { name: 'awake but at work', members: [m('atWork', 'walk'), m('onLot', 'sleep')], allowed: true },
    { name: 'off-lot members never block', members: [m('offLot', 'idle'), m('atWork', 'idle')], allowed: true },
    { name: 'passed out on the floor counts as asleep', members: [m('onLot', 'collapse', true)], allowed: true },
    { name: 'crumbled / gone are ignored', members: [m('crumbled', 'idle'), m('gone', 'idle'), m('onLot', 'sleep')], allowed: true },
    { name: 'eating at home blocks', members: [m('onLot', 'sitEat')], allowed: false },
    { name: 'sleep-adjacent anims are NOT sleep', members: [m('onLot', 'yawn')], allowed: false },
    { name: 'nobody home', members: [], allowed: true },
    { name: 'holes in the list are tolerated', members: [null, undefined, m('onLot', 'sleep')], allowed: true },
    { name: 'missing status object', members: [{ presence: 'onLot', anim: 'idle', status: null }], allowed: false },
  ];
  for (const row of table) {
    it(row.name, () => expect(ultraAllowed(row.members)).toBe(row.allowed));
  }

  it('isAsleep', () => {
    expect(isAsleep(m('onLot', 'sleep'))).toBe(true);
    expect(isAsleep(m('onLot', 'idle', true))).toBe(true);
    expect(isAsleep(m('onLot', 'idle'))).toBe(false);
  });

  it('gateSpeed clamps ultra to 3 when not allowed, passes everything else', () => {
    expect(gateSpeed(4, false)).toEqual({ speed: 3, clamped: true });
    expect(gateSpeed(4, true)).toEqual({ speed: 4, clamped: false });
    for (const s of [0, 1, 2, 3] as const) expect(gateSpeed(s, false)).toEqual({ speed: s, clamped: false });
  });

  it('isSpeed rejects junk', () => {
    for (const v of [0, 1, 2, 3, 4]) expect(isSpeed(v)).toBe(true);
    for (const v of [5, -1, 1.5, '1', null, undefined, NaN]) expect(isSpeed(v)).toBe(false);
  });
});

describe('SpeedState holds', () => {
  it('a hold pauses without forgetting the chosen speed; releasing resumes it', () => {
    const s = new SpeedState();
    s.set(3);
    expect(s.addHold('dialog')).toBe(true);
    expect(s.effective).toBe(0);
    expect(s.chosen).toBe(3);
    expect(s.addHold('choice')).toBe(false); // already paused
    expect(s.releaseHold('dialog')).toBe(false); // still held by 'choice'
    expect(s.effective).toBe(0);
    expect(s.releaseHold('choice')).toBe(true);
    expect(s.effective).toBe(3);
  });

  it('an explicit player speed change clears every hold (the player wins)', () => {
    const s = new SpeedState();
    s.addHold('choice');
    s.addHold('build');
    s.set(2);
    expect(s.effective).toBe(2);
    expect(s.holdList).toEqual([]);
  });

  it('toggle: pause ⇄ resume to the last running speed, and resume clears holds', () => {
    const s = new SpeedState();
    s.set(2);
    expect(s.toggle()).toBe(0);
    expect(s.toggle()).toBe(2);
    s.addHold('hidden');
    expect(s.effective).toBe(0);
    expect(s.toggle()).toBe(2); // resume from an auto-pause
    expect(s.holdList).toEqual([]);
  });

  it('toggle from a fresh pause resumes at 1×', () => {
    const s = new SpeedState();
    s.set(0);
    expect(s.toggle()).toBe(1);
  });

  it('demote lowers ultra without touching holds', () => {
    const s = new SpeedState();
    s.set(4);
    s.addHold('dialog');
    s.demote(3);
    expect(s.chosen).toBe(3);
    expect(s.effective).toBe(0);
    s.releaseHold('dialog');
    expect(s.effective).toBe(3);
  });

  it('ignores invalid speeds', () => {
    const s = new SpeedState();
    s.set(2);
    s.set(9 as never);
    expect(s.chosen).toBe(2);
    s.reset(7 as never);
    expect(s.chosen).toBe(1);
  });
});
