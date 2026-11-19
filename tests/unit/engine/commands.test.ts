import { describe, expect, it } from 'vitest';
import type { Command, SimSystem } from '../../../src/sim/contracts';
import { NEED_IDS } from '../../../src/sim/types';
import { putAt, setup, steps } from './helpers';

describe('dispatch', () => {
  it('never throws on garbage and answers {ok:false, reason}', () => {
    const { sim } = setup();
    const junk: unknown[] = [null, undefined, 42, 'queue', {}, { type: 'nope' }, { type: 'queue' }, { type: 'cancel', actorId: 'a1', uid: Number.NaN }, { type: 'build' }, { type: 'choice', choiceId: 'c0', option: 0 }, { type: 'setSettings', settings: null }, { type: 'renameHousehold', name: 7 }, { type: 'cheat', code: null }, { type: 'buyReward', agentId: 'a1', rewardId: 'x' }];
    for (const j of junk) {
      const r = sim.dispatch(j as Command);
      expect(r.ok).toBe(false);
      expect(typeof r.reason).toBe('string');
    }
  });

  it('queue validation: household member on the lot, player-allowed, matching target kinds', () => {
    const { sim, agents, objects } = setup({ members: ['A', 'B'], objects: [{ defId: 'fridge_humming', x: 5, z: 5 }, { defId: 'chair_creaky', x: 9, z: 9 }] });
    const [a, b] = agents;
    const fridge = { kind: 'object' as const, id: objects[0].id };
    const t = sim.engine.ctx.createAgent({ role: 'townie', presence: 'offLot', firstName: 'Tow', lastName: 'Nie', appearance: {} as never, traits: [] });
    sim.engine.ctx.spawnAgent(t.id);
    expect(sim.dispatch({ type: 'queue', actorId: t.id, interactionId: 'fx_snack', target: fridge })).toEqual({ ok: false, reason: 'Not in your household' });
    expect(sim.dispatch({ type: 'queue', actorId: a.id, interactionId: 'engine_respond', target: { kind: 'agent', id: b.id } })).toEqual({ ok: false, reason: "That can't be ordered" });
    expect(sim.dispatch({ type: 'queue', actorId: a.id, interactionId: 'fx_snack', target: { kind: 'self' } })).toEqual({ ok: false, reason: 'Invalid target' });
    expect(sim.dispatch({ type: 'queue', actorId: a.id, interactionId: 'fx_sit', target: fridge })).toEqual({ ok: false, reason: 'Not available here' });
    expect(sim.dispatch({ type: 'queue', actorId: a.id, interactionId: 'fx_snack', target: { kind: 'object', id: 'o9999' } })).toEqual({ ok: false, reason: "It's gone" });
    expect(sim.dispatch({ type: 'queue', actorId: a.id, interactionId: 'fx_chat', target: { kind: 'agent', id: a.id } })).toEqual({ ok: false, reason: "Can't do that to yourself" });
    expect(sim.dispatch({ type: 'queue', actorId: a.id, interactionId: 'engine_goHere', target: { kind: 'tile', x: -4, z: 2 } })).toEqual({ ok: false, reason: "Can't go there" });
    expect(sim.dispatch({ type: 'queue', actorId: a.id, interactionId: 'fx_snack', target: { kind: 'object' } as never })).toEqual({ ok: false, reason: 'Invalid target' });
    // engine-reserved params can't be smuggled in
    const ok = sim.dispatch({ type: 'queue', actorId: a.id, interactionId: 'fx_snack', target: fridge, params: { _costPaid: true, partnerOf: b.id, note: 'hi' } });
    expect(ok.ok).toBe(true);
    expect(a.active?.params).toEqual({ note: 'hi' });
    sim.engine.ctx.despawnAgent(b.id, 'atWork');
    expect(sim.dispatch({ type: 'queue', actorId: b.id, interactionId: 'fx_snack', target: fridge })).toEqual({ ok: false, reason: "B isn't home" });
  });

  it('build / undo / redo / endBuildSession go through the BuildService', () => {
    const { sim, agents } = setup({ funds: 1000 });
    putAt(agents[0], 20, 20);
    const r = sim.dispatch({ type: 'build', cmd: { type: 'buy', defId: 'chair_creaky', x: 4, z: 4, rot: 0 } });
    expect(r.ok).toBe(true);
    expect(r.id).toMatch(/^o\d+$/);
    expect(sim.state.household.funds).toBe(940);
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    expect(sim.state.household.funds).toBe(1000);
    expect(sim.state.objects[r.id!]).toBeUndefined();
    expect(sim.dispatch({ type: 'redo' }).ok).toBe(true);
    expect(sim.state.household.funds).toBe(940);
    expect(sim.dispatch({ type: 'endBuildSession' }).ok).toBe(true);
    expect(sim.dispatch({ type: 'undo' })).toEqual({ ok: false, reason: 'Nothing to undo' });
    expect(sim.dispatch({ type: 'build', cmd: { type: 'buy', defId: 'chair_creaky', x: 4, z: 4, rot: 0 } }).ok).toBe(false); // overlap
    expect(sim.dispatch({ type: 'build', cmd: { type: 'floor', x0: 0, z0: 0, x1: 1, z1: 1, styleId: null } }).ok).toBe(false);
  });

  it('build commands that throw inside the BuildService are contained', () => {
    const { sim } = setup();
    (sim.engine.build as { apply: unknown }).apply = () => {
      throw new Error('build exploded');
    };
    const r = sim.dispatch({ type: 'build', cmd: { type: 'sell', objectId: 'o1' } });
    expect(r.ok).toBe(false);
    expect(sim.faults().some((f) => f.where === 'dispatch')).toBe(true);
  });

  it('choice runs the option effect then removes the choice; bad options are rejected', () => {
    const { sim, agents } = setup({ funds: 0 });
    const id = sim.engine.ctx.offerChoice({
      title: 'Bribe?',
      text: '',
      agentId: agents[0].id,
      options: [
        { label: 'Take it', effect: 'earn', params: { amount: 25, reason: 'bribe' }, tooltip: null },
        { label: 'No', effect: 'notify', params: { kind: 'info', title: 'Virtuous', text: 'You refused' }, tooltip: null },
      ],
      expiresTick: sim.state.tick + 1000,
      defaultOption: 1,
    });
    expect(sim.dispatch({ type: 'choice', choiceId: id, option: 5 })).toEqual({ ok: false, reason: 'Invalid option' });
    expect(sim.dispatch({ type: 'choice', choiceId: id, option: 0.5 })).toEqual({ ok: false, reason: 'Invalid option' });
    expect(sim.dispatch({ type: 'choice', choiceId: id, option: 0 }).ok).toBe(true);
    expect(sim.state.household.funds).toBe(25);
    expect(sim.state.choices).toHaveLength(0);
    expect(sim.dispatch({ type: 'choice', choiceId: id, option: 0 })).toEqual({ ok: false, reason: 'That choice is gone' });
    expect(sim.state.household.funds).toBe(25);
  });

  it('setSettings validates each field', () => {
    const { sim } = setup();
    expect(sim.dispatch({ type: 'setSettings', settings: { autonomy: 'limited', difficulty: 'grim', visitorsEnabled: false } }).ok).toBe(true);
    expect(sim.state.settings).toEqual({ autonomy: 'limited', difficulty: 'grim', visitorsEnabled: false });
    expect(sim.dispatch({ type: 'setSettings', settings: { autonomy: 'chaos' as never } }).ok).toBe(false);
    expect(sim.dispatch({ type: 'setSettings', settings: { difficulty: 'nightmare' as never } }).ok).toBe(false);
    expect(sim.dispatch({ type: 'setSettings', settings: { visitorsEnabled: 'yes' as never } }).ok).toBe(false);
    expect(sim.state.settings.autonomy).toBe('limited');
  });

  it('buyReward delegates to the aspirations system (and reports when it is missing)', () => {
    const calls: string[] = [];
    const asp: SimSystem = { id: 'aspirations', api: { buyReward: (agentId: string, rewardId: string) => (calls.push(`${agentId}:${rewardId}`), rewardId === 'ok' ? true : 'Not enough points') } };
    const { sim, agents } = setup({ extraSystems: [asp] });
    expect(sim.dispatch({ type: 'buyReward', agentId: agents[0].id, rewardId: 'ok' })).toEqual({ ok: true });
    expect(sim.dispatch({ type: 'buyReward', agentId: agents[0].id, rewardId: 'pricey' })).toEqual({ ok: false, reason: 'Not enough points' });
    expect(calls).toHaveLength(2);
    const plain = setup();
    expect(plain.sim.dispatch({ type: 'buyReward', agentId: plain.agents[0].id, rewardId: 'ok' })).toEqual({ ok: false, reason: 'Rewards are unavailable' });
  });

  it('renameHousehold sanitises control/bidi characters and enforces 1..40 chars', () => {
    const { sim } = setup();
    expect(sim.dispatch({ type: 'renameHousehold', name: '  The\u0000 Rot‮  Family\n ' }).ok).toBe(true);
    expect(sim.state.household.name).toBe('The Rot Family');
    expect(sim.dispatch({ type: 'renameHousehold', name: '   ' }).ok).toBe(false);
    expect(sim.dispatch({ type: 'renameHousehold', name: 'x'.repeat(41) }).ok).toBe(false);
    expect(sim.dispatch({ type: 'renameHousehold', name: '<script>' }).ok).toBe(true);
    expect(sim.state.household.name).toBe('script');
  });

  it('markNotificationsRead marks everything read', () => {
    const { sim } = setup();
    sim.engine.ctx.notify({ kind: 'info', title: 'x', text: 'y' });
    expect(sim.state.notifications.some((n) => !n.read)).toBe(true);
    expect(sim.dispatch({ type: 'markNotificationsRead' }).ok).toBe(true);
    expect(sim.state.notifications.every((n) => n.read)).toBe(true);
  });

  it('cheats: graverobber/motherlode +$5000, freshstart fills needs to cap; flags.cheated is set', () => {
    const { sim, agents } = setup({ funds: 0, needs: { hunger: 10, preservation: 10 } });
    expect(sim.dispatch({ type: 'cheat', code: 'graverobber' }).ok).toBe(true);
    expect(sim.dispatch({ type: 'cheat', code: ' MOTHERLODE ' }).ok).toBe(true);
    expect(sim.state.household.funds).toBe(10000);
    agents[0].vitality = 70;
    expect(sim.dispatch({ type: 'cheat', code: 'freshstart' }).ok).toBe(true);
    for (const n of NEED_IDS) expect(agents[0].needs[n]).toBe(n === 'preservation' ? 70 : 100);
    expect(sim.state.flags.cheated).toBe(true);
    expect(sim.dispatch({ type: 'cheat', code: 'iddqd' })).toEqual({ ok: false, reason: 'Unknown cheat' });
  });

  it('dispatching then stepping keeps invariants (smoke over every command type)', () => {
    const { sim, agents, objects } = setup({ funds: 2000, objects: [{ defId: 'mirror_cracked', x: 8, z: 8 }] });
    const a = agents[0];
    const cmds: Command[] = [
      { type: 'queue', actorId: a.id, interactionId: 'fx_admire', target: { kind: 'object', id: objects[0].id } },
      { type: 'build', cmd: { type: 'buy', defId: 'table_rickety', x: 3, z: 20, rot: 1 } },
      { type: 'setSettings', settings: { autonomy: 'full' } },
      { type: 'renameHousehold', name: 'Ghastly' },
      { type: 'markNotificationsRead' },
      { type: 'cheat', code: 'freshstart' },
      { type: 'undo' },
      { type: 'redo' },
      { type: 'endBuildSession' },
    ];
    for (const c of cmds) {
      sim.dispatch(c);
      steps(sim, 10);
      expect(sim.checkInvariants()).toEqual([]);
    }
    expect(sim.faults()).toEqual([]);
  });
});
