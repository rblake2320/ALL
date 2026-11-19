/**
 * W-131 session-log side of the order trace. Proves the log can now explain "my zombie did not do what I ordered":
 *  1. failureCode maps real sim reasons to a CLOSED code; anything unknown is 'other';
 *  2. privacy: a reason carrying a name never reaches the stored log (only the code does);
 *  3. refused / failed / dropped / done orders all land as events AND survive ring eviction in the counts aggregate;
 *  4. the stored form round-trips through the strict loader with the new kinds intact; hostile keys are rejected.
 */
import { describe, expect, it } from 'vitest';
import { SessionRecorder, failureCode, fromStored, toStored, SESSION_KINDS } from '../../../src/feedback/sessionLog';

function recorder(capacity?: number) {
  let t = 0;
  const header = {
    id: 'S-0123456X', seq: 1, date: '2026-11-06', build: 'test', version: '1', bracket: '13plus' as const,
    platform: { segment: 'desktop' as const, orient: 'landscape' as const, viewport: '1280x720', dpr: 1, shell: 'web' as const, touch: false },
    graphics: { setting: 'auto', level: 'high', gpuKind: 'test', ceiling: 'high' },
  };
  const Rec = SessionRecorder as unknown as new (...a: unknown[]) => SessionRecorder;
  let rec: SessionRecorder;
  try {
    rec = new Rec({ header, now: () => (t += 10), capacity });
  } catch {
    rec = new Rec(header, () => (t += 10), capacity);
  }
  return rec;
}

describe('W-131 failureCode', () => {
  it.each([
    ['Already spotless', 'nothingToDo'],
    ['Not full yet', 'nothingToDo'],
    ["Can't get there", 'noRoute'],
    ["Can't reach the fridge", 'noRoute'],
    ['The tattered armchair was sold', 'targetGone'],
    ['Barnaby left', 'targetGone'],
    ['In use', 'inUse'],
    ['Someone else took it', 'inUse'],
    ['The power is out', 'noPower'],
    ['Something went wrong', 'fault'],
    ['Interrupted', 'interrupted'],
  ])('%s → %s', (reason, code) => expect(failureCode(reason)).toBe(code));

  // The reason strings the sim really produces for an order that was accepted and then failed at run time
  // (src/sim/engine/runner.ts reportFailure → 'interactionFailed' → src/game/sessionLog.ts failureCode(e.reason)),
  // or that was refused at queue time (src/sim/engine/commands.ts). Each row names where the text comes from.
  it.each([
    ['Humming fridge is in use', 'inUse'], // src/sim/engine/stages.ts:237 FAIL(`${capitalize(name)} is in use`)
    ['The fridge is in use', 'inUse'], // src/sim/engine/stages.ts:452 reason: `The ${noun} is in use`
    ['Ysolde is busy', 'inUse'], // src/sim/engine/socials.ts:39,42,44,48 `${target.firstName} is busy`; name from content/people/names.ts:14
    ["Can't go there", 'noRoute'], // src/sim/engine/commands.ts:45, runner.ts:132, stages.ts:394,398
    ["Can't find the way out", 'noRoute'], // src/sim/engine/stages.ts:535
    ['No room nearby', 'noRoute'], // src/sim/engine/stages.ts:366,502
    ['No free seat nearby', 'noRoute'], // src/sim/engine/stages.ts:467
    ["Barnaby isn't here", 'targetGone'], // src/sim/engine/commands.ts:40, runner.ts:128, stages.ts:243, socials.ts:32,172
    ['Barnaby isn’t here', 'targetGone'], // src/sim/systems/people/social/gates.ts:26 (typographic apostrophe)
  ])('run-time reason %s → %s', (reason, code) => expect(failureCode(reason)).toBe(code));

  it('a zombie name does not pick the code: "Ysolde" contains "sold" but nothing was sold', () => {
    expect(failureCode('Ysolde is asleep')).not.toBe('targetGone'); // src/sim/engine/socials.ts:46, requirements.ts:43-45
    expect(failureCode("Can't do that to yourself")).toBe('other'); // src/sim/engine/runner.ts:127: not a route failure
  });

  it('unknown, empty and non-string reasons are "other" (closed vocabulary, never echoes input)', () => {
    for (const x of ['Grumbleflax the Mighty', '', null, undefined, 42, { reason: 'x' }]) expect(failureCode(x)).toBe('other');
  });
});

describe('W-131 order events in the session log', () => {
  it('the new kinds are part of the closed kind list', () => {
    for (const k of ['ix.fail', 'ix.drop', 'ix.done']) expect(SESSION_KINDS).toContain(k);
  });

  it('refused / failed / dropped / done all recorded with closed codes; a reason with a name never appears', () => {
    const rec = recorder();
    rec.command({ type: 'queue', ok: false, id: 'home_wipeDown', target: 'counter_butcher', code: failureCode('Already spotless') });
    rec.order('fail', 'player', 'home_cleanDish', failureCode("Can't reach the dish"));
    rec.order('drop', 'player', 'home_sit', 'targetGone');
    rec.order('done', 'player', 'home_checkMail', 'ok');
    rec.order('fail', 'player', 'social_chat', failureCode('Barnaby left'));
    const log = rec.toLog();
    const keys = log.events.map((e) => `${e.k}|${e.a ?? ''}`);
    expect(keys).toContain('cmd|queue.refused.nothingToDo:home_wipeDown:counter_butcher');
    expect(keys).toContain('ix.fail|player:home_cleanDish:noRoute');
    expect(keys).toContain('ix.drop|player:home_sit:targetGone');
    expect(keys).toContain('ix.done|player:home_checkMail:ok');
    expect(JSON.stringify(log)).not.toMatch(/Barnaby|reach the dish|spotless/i);
    expect(log.agg.counts['order.refused:nothingToDo']).toBe(1);
    expect(log.agg.counts['order.drop:player:targetGone']).toBe(1);
  });

  it('counts survive ring eviction: 50 drops in a 10-event ring still count 50', () => {
    const rec = recorder(10);
    for (let i = 0; i < 50; i++) rec.order('drop', 'player', `home_x${i}`, 'queueFull');
    const log = rec.toLog();
    expect(log.events.length).toBeLessThanOrEqual(10);
    expect(log.agg.counts['order.drop:player:queueFull']).toBe(50);
  });

  it('stored form round-trips with the new kinds; a hostile key is dropped by the strict loader', () => {
    const rec = recorder();
    rec.order('drop', 'player', 'home_sit', 'targetGone');
    const stored = toStored(rec.toLog());
    const back = fromStored(JSON.parse(JSON.stringify(stored)));
    expect(back?.events.some((e) => e.k === 'ix.drop' && e.a === 'player:home_sit:targetGone')).toBe(true);
    const hostile = JSON.parse(JSON.stringify(stored));
    hostile.e.push([5, 'ix.fail', '<script>alert(1)</script>', null, null, null, null]);
    const cleaned = fromStored(hostile);
    expect(cleaned?.events.some((e) => (e.a ?? '').includes('<'))).toBe(false);
  });
});
