/**
 * Adversarial sim-event routing tests: semantic events (skillUp / promotion / milestone) paired with the engine's own
 * notification in the same tick must yield exactly ONE toast (the engine's richer text) and ONE sound; distinct
 * events for the same zombie must not swallow each other; floods of choice / lot / focus events are coalesced per
 * frame; loops tied to a zombie stop when that zombie leaves the lot.
 */
import { describe, expect, it } from 'vitest';
import type { Notification } from '../../../src/sim/types';
import { startedHarness, type Harness } from './controllerHarness';

function note(h: Harness, n: Partial<Notification> & { id: number; kind: Notification['kind']; title: string; text: string }): void {
  h.gameSim().state.notifications.push({ tick: 0, agentId: null, objectId: null, read: false, ...n });
}

describe('one toast + one sound per achievement', () => {
  it('milestone + engine notification (kind good) → the engine text once, the milestone sting once, no generic ping', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    note(h, { id: 50, kind: 'good', title: 'Milestone: $5,000 funds', text: 'Mortimer earned 250 aspiration points (Undead Tycoon).', agentId: 'a1' });
    sim.events.push(
      { type: 'milestone', agentId: 'a1', aspirationId: 'tycoon', milestoneId: 'm1' },
      { type: 'sfx', id: 'milestone', agentId: 'a1' },
      { type: 'notify', id: 50 },
    );
    const sfxBefore = h.audio.sfxIds().length;
    await h.frames(1);
    const toasts = h.game.toasts.filter((t) => t.agentId === 'a1');
    expect(toasts.map((t) => t.title)).toEqual(['Milestone: $5,000 funds']);
    const sounds = h.audio.sfxIds().slice(sfxBefore);
    expect(sounds.filter((s) => s === 'milestone').length).toBe(1);
    expect(sounds).not.toContain('notify');
  });

  it('promotion + engine notification (kind career) → the engine text (title, wage) is the one shown', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    note(h, { id: 51, kind: 'career', title: 'Promoted!', text: 'Mortimer is now a Shift Lead at Graveyard Shift Retail! New wage: $24/h.', agentId: 'a1' });
    sim.events.push({ type: 'promotion', agentId: 'a1', level: 3, title: 'Shift Lead' }, { type: 'sfx', id: 'promotion', agentId: 'a1' }, { type: 'notify', id: 51 });
    await h.frames(1);
    const toasts = h.game.toasts.filter((t) => t.agentId === 'a1');
    expect(toasts.length).toBe(1);
    expect(toasts[0].text).toMatch(/New wage/);
  });

  it('skill-up with its notification → one toast with the engine text; one skillUp sound', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    note(h, { id: 52, kind: 'skill', title: 'Mortimer reached Cooking 10', text: 'Mortimer has mastered Cooking. Truly unholy talent.', agentId: 'a1' });
    sim.events.push({ type: 'skillUp', agentId: 'a1', skill: 'cooking', level: 10 }, { type: 'sfx', id: 'skillUp', agentId: 'a1' }, { type: 'notify', id: 52 });
    const before = h.audio.sfxIds().length;
    await h.frames(1);
    expect(h.game.toasts.filter((t) => t.agentId === 'a1').map((t) => t.text)).toEqual(['Mortimer has mastered Cooking. Truly unholy talent.']);
    const sounds = h.audio.sfxIds().slice(before);
    expect(sounds.filter((s) => s === 'skillUp').length).toBe(1);
    expect(sounds).not.toContain('notify');
  });

  it('a semantic event WITHOUT an engine notification still produces the controller fallback toast', async () => {
    const h = await startedHarness();
    h.gameSim().events.push({ type: 'skillUp', agentId: 'a1', skill: 'cooking', level: 2 });
    await h.frames(1);
    expect(h.game.toasts.some((t) => t.agentId === 'a1' && /Cooking/.test(t.title + t.text))).toBe(true);
  });

  it('two different skill-ups of the same zombie within 2 s are both announced', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    note(h, { id: 60, kind: 'skill', title: 'Mortimer reached Cooking 2', text: 'Cooking is now level 2.', agentId: 'a1' });
    sim.events.push({ type: 'skillUp', agentId: 'a1', skill: 'cooking', level: 2 }, { type: 'notify', id: 60 });
    await h.frames(1);
    note(h, { id: 61, kind: 'skill', title: 'Mortimer reached Charisma 1', text: 'Charisma is now level 1.', agentId: 'a1' });
    sim.events.push({ type: 'skillUp', agentId: 'a1', skill: 'charisma', level: 1 }, { type: 'notify', id: 61 });
    await h.frames(1);
    expect(h.game.toasts.filter((t) => t.agentId === 'a1').map((t) => t.title)).toEqual(['Mortimer reached Cooking 2', 'Mortimer reached Charisma 1']);
  });

  it('a genuinely duplicated notification (same text) within 2 s is still de-duplicated', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    note(h, { id: 70, kind: 'bad', title: 'Fridge broke', text: 'The fridge stopped humming.' });
    note(h, { id: 71, kind: 'bad', title: 'Fridge broke', text: 'The fridge stopped humming.' });
    sim.events.push({ type: 'notify', id: 70 }, { type: 'notify', id: 71 });
    await h.frames(1);
    expect(h.game.toasts.filter((t) => t.title === 'Fridge broke').length).toBe(1);
  });
});

describe('event floods are coalesced per frame', () => {
  it('300 choice events in one frame cause one synchronous UI flush, not 300', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    sim.state.choices.push({ id: 'c1', tick: 0, title: 't', text: 'x', agentId: 'a1', options: [], expiresTick: 999, defaultOption: 0 });
    for (let i = 0; i < 300; i++) sim.events.push({ type: 'choice', choiceId: 'c1' });
    const before = h.notifications;
    await h.frames(1);
    expect(h.game.speed).toBe(0);
    expect(h.notifications - before).toBeLessThanOrEqual(4);
  });

  it('50 lot events in one frame re-validate the buy ghost once, not 50 times', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    h.game.startPlacing('chair_creaky');
    h.renderer.gridResult = { x: 6, z: 6, fx: 6.5, fz: 6.5, edge: null, edgeSide: 0 };
    h.pointer('pointermove', 300, 300);
    await h.frames(1);
    let checks = 0;
    const real = sim.spatial.checkPlace;
    (sim.spatial as { checkPlace: typeof real }).checkPlace = (...args) => {
      checks++;
      return real(...args);
    };
    for (let i = 0; i < 50; i++) sim.events.push({ type: 'lot', what: 'objects' });
    await h.frames(1);
    expect(checks).toBeGreaterThanOrEqual(1);
    expect(checks).toBeLessThanOrEqual(2);
  });

  it('100 focus events in one frame move the camera once (the last one wins)', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    const before = h.renderer.count('focus');
    for (let i = 0; i < 100; i++) sim.events.push({ type: 'focus', pos: { x: i, z: i } });
    await h.frames(1);
    expect(h.renderer.count('focus') - before).toBe(1);
    expect(h.renderer.last('focus')!.args[0]).toEqual({ x: 99, z: 99 });
  });
});

describe('looping sounds follow their emitter', () => {
  it('a loop tied to a zombie stops when that zombie leaves the lot (no full-volume orphan)', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    sim.events.push({ type: 'sfxLoop', id: 'snore', key: 'snore:a1', on: true, agentId: 'a1' });
    await h.frames(1);
    sim.state.agents.a1.presence = 'atWork';
    await h.frames(40);
    const offs = h.audio.named('loop').filter((c) => c.args[0] === 'snore:a1' && c.args[2] === false);
    expect(offs.length).toBe(1);
    const onsAfterLeave = h.audio.named('loop').filter((c) => c.args[0] === 'snore:a1' && c.args[2] === true && c.args[3] === undefined);
    expect(onsAfterLeave.length).toBe(0);
  });
});

describe('malformed events', () => {
  it('prototype-named event types and junk entries are skipped without side effects', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    const junk = [{ type: 'constructor', agentId: 'a1' }, { type: '__proto__' }, { type: 'toString', id: 1 }, null, 42, 'notify', { type: 'notify', id: Number.NaN }] as never[];
    sim.events.push(...junk, { type: 'sfx', id: 'eat' });
    await h.frames(1);
    expect(h.game.fatalError).toBeNull();
    expect(h.audio.sfxIds()).toContain('eat');
    expect(h.game.toasts.length).toBe(0);
  });
});
