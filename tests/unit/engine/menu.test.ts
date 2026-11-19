import { describe, expect, it } from 'vitest';
import type { InteractionBehavior, SimSystem } from '../../../src/sim/contracts';
import { putAt, queue, setup, until } from './helpers';

describe('menu', () => {
  it('is empty unless the actor is an on-lot household member', () => {
    const { sim, agents, objects } = setup({ objects: [{ defId: 'fridge_humming', x: 5, z: 5 }] });
    const target = { kind: 'object' as const, id: objects[0].id };
    expect(sim.menu('a9999', target)).toEqual([]);
    const t = sim.engine.ctx.createAgent({ role: 'townie', presence: 'offLot', firstName: 'T', lastName: 'T', appearance: {} as never, traits: [] });
    sim.engine.ctx.spawnAgent(t.id);
    expect(sim.menu(t.id, target)).toEqual([]);
    sim.engine.ctx.despawnAgent(agents[0].id, 'atWork');
    expect(sim.menu(agents[0].id, target)).toEqual([]);
    expect(sim.menu(agents[0].id, { kind: 'banana' } as never)).toEqual([]);
  });

  it('object menus list the def interactions with availability + reasons (power, cost)', () => {
    const { sim, agents, objects } = setup({ objects: [{ defId: 'fridge_humming', x: 5, z: 5 }], funds: 5 });
    const a = agents[0];
    const m = sim.menu(a.id, { kind: 'object', id: objects[0].id });
    expect(m.map((e) => e.interactionId)).toEqual(['fx_snack', 'fx_dinner']);
    expect(m[0]).toMatchObject({ label: 'Grab a Snack', available: true, reason: null, icon: 'fridge' });
    expect(m[1]).toMatchObject({ available: false, reason: "Can't afford ($12)", cost: 12 });
    sim.state.household.utilitiesOn = false;
    const m2 = sim.menu(a.id, { kind: 'object', id: objects[0].id });
    expect(m2[0]).toMatchObject({ available: false, reason: 'The power is out' });
  });

  it('shows "In use" when every slot is taken by someone else', () => {
    const { sim, agents, objects } = setup({ members: ['A', 'B'], objects: [{ defId: 'shower_drizzle', x: 8, z: 8 }] });
    const [a, b] = agents;
    putAt(a, 8, 12);
    queue(sim, a, 'fx_shower', { kind: 'object', id: objects[0].id });
    expect(sim.menu(b.id, { kind: 'object', id: objects[0].id })[0]).toMatchObject({ available: false, reason: 'In use' });
    expect(sim.menu(a.id, { kind: 'object', id: objects[0].id })[0]).toMatchObject({ available: true });
  });

  it('tile -> Go Here; self -> player-allowed self interactions only', () => {
    const { sim, agents } = setup();
    const a = agents[0];
    expect(sim.menu(a.id, { kind: 'tile', x: 10, z: 10 }).map((e) => e.label)).toEqual(['Go Here']);
    expect(sim.menu(a.id, { kind: 'tile', x: 500, z: 10 })).toEqual([]);
    const self = sim.menu(a.id, { kind: 'self' });
    expect(self.map((e) => e.interactionId)).toEqual(['fx_phone']);
    expect(self[0].group).toBe('Phone');
    // clicking yourself is the same as self
    expect(sim.menu(a.id, { kind: 'agent', id: a.id }).map((e) => e.interactionId)).toEqual(['fx_phone']);
  });

  it('agent menus: socials gated by thresholds are greyed, status/requirement gates are hidden, labels templated', () => {
    const { sim, agents } = setup({ members: ['Mort', 'Ghoulia'] });
    const [a, b] = agents;
    const m = sim.menu(a.id, { kind: 'agent', id: b.id });
    const byId = Object.fromEntries(m.map((e) => [e.interactionId, e]));
    expect(byId.fx_chat).toMatchObject({ label: 'Chat with Ghoulia', available: true, group: 'Friendly' });
    expect(byId.fx_hug).toMatchObject({ available: false, reason: 'Not close enough yet' });
    expect(byId.fx_propose).toBeUndefined(); // status gate: partners
    expect(byId.fx_waveOver).toBeUndefined(); // requirement: target walking by
    expect(byId.fx_embalmOther).toMatchObject({ available: false, reason: 'Needs an embalm' });
    sim.engine.ctx.rel(a.id, b.id).friendship = 40;
    const m2 = sim.menu(a.id, { kind: 'agent', id: b.id });
    expect(m2.find((e) => e.interactionId === 'fx_hug')).toMatchObject({ available: true });
    const r = sim.engine.ctx.rel(a.id, b.id);
    r.partners = true;
    expect(sim.menu(a.id, { kind: 'agent', id: b.id }).find((e) => e.interactionId === 'fx_propose')).toBeDefined();
  });

  it('children come from behaviour.choices, with per-child availability and cost', () => {
    const beh: InteractionBehavior = {
      choices: () => [
        { label: 'Brain Loaf ($12)', params: { recipe: 'loaf' }, available: true, cost: 12 },
        { label: 'Medulla Flambé ($45)', params: { recipe: 'flambe' }, available: 'Needs Cooking 7', cost: 45 },
        { label: 'Caviar ($900)', params: { recipe: 'caviar' }, available: true, cost: 900 },
      ],
      label: () => 'Cook…',
    };
    const sys: SimSystem = { id: 'cooky', behaviors: { x_cook: beh } };
    const { sim, agents, objects } = setup({
      objects: [{ defId: 'fridge_humming', x: 5, z: 5 }],
      funds: 100,
      extraSystems: [sys],
      extraContent: [{ id: 'cook', interactions: [{ id: 'x_cook', label: 'Cook', icon: 'plate', targetKind: 'object', behavior: 'x_cook', stage: { target: { kind: 'target' }, duration: 5, anim: 'cook' } }] }],
    });
    sim.content.objects.fridge_humming.interactions.push('x_cook');
    const e = sim.menu(agents[0].id, { kind: 'object', id: objects[0].id }).find((x) => x.interactionId === 'x_cook')!;
    expect(e.label).toBe('Cook…');
    expect(e.children?.map((c) => [c.available, c.reason])).toEqual([
      [true, null],
      [false, 'Needs Cooking 7'],
      [false, "Can't afford ($900)"],
    ]);
    expect(e.children?.[0].params).toEqual({ recipe: 'loaf' });
    // choosing a child queues with its params
    const r = sim.dispatch({ type: 'queue', actorId: agents[0].id, interactionId: 'x_cook', target: { kind: 'object', id: objects[0].id }, params: e.children![0].params });
    expect(r.ok).toBe(true);
    expect(agents[0].active?.params.recipe).toBe('loaf');
  });

  it('a throwing behaviour.available/label/choices never breaks the menu', () => {
    const sys: SimSystem = {
      id: 'evil',
      behaviors: {
        x_evil: {
          available: () => {
            throw new Error('nope');
          },
          label: () => {
            throw new Error('nope');
          },
        },
      },
    };
    const { sim, agents } = setup({
      extraSystems: [sys],
      extraContent: [{ id: 'evil', interactions: [{ id: 'x_evil', label: 'Evil', icon: 'skull', targetKind: 'self', behavior: 'x_evil', stage: { target: { kind: 'here' }, duration: 1, anim: 'idle' } }] }],
    });
    const m = sim.menu(agents[0].id, { kind: 'self' });
    const e = m.find((x) => x.interactionId === 'x_evil')!;
    expect(e).toMatchObject({ label: 'Evil', available: false, reason: 'Something went wrong' });
    expect(sim.faults().length).toBeGreaterThan(0);
  });

  it('queueView reports labels, progress and cancellability', () => {
    const { sim, agents, objects } = setup({ objects: [{ defId: 'mirror_cracked', x: 8, z: 8 }] });
    const a = agents[0];
    putAt(a, 8, 10);
    queue(sim, a, 'fx_admire', { kind: 'object', id: objects[0].id });
    queue(sim, a, 'engine_goHere', { kind: 'tile', x: 3, z: 3 });
    until(sim, () => a.active?.phase === 'run');
    until(sim, () => (a.active?.elapsed ?? 0) >= 10);
    const qv = sim.queueView(a.id);
    expect(qv).toHaveLength(2);
    expect(qv[0]).toMatchObject({ label: 'Admire Reflection', active: true, cancellable: true, source: 'player' });
    expect(qv[0].progress).toBeGreaterThan(0.45);
    expect(qv[0].progress).toBeLessThan(0.6);
    expect(qv[1]).toMatchObject({ label: 'Go Here', active: false, progress: 0 });
    expect(sim.queueView('nobody')).toEqual([]);
    expect(sim.summary(a.id)?.activity).toBe('Admiring Reflection');
  });
});
