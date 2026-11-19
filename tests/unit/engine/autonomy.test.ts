import { describe, expect, it } from 'vitest';
import type { AgentState } from '../../../src/sim/types';
import { putAt, setup, steps, until } from './helpers';

const HOME = [
  { defId: 'fridge_humming', x: 5, z: 5 },
  { defId: 'coffin_pine', x: 12, z: 5 },
  { defId: 'tv_crt', x: 18, z: 5 },
  { defId: 'shower_drizzle', x: 24, z: 5 },
  { defId: 'headstone_decor', x: 20, z: 20 },
];

/** First interaction the agent starts (ignoring idles) within maxTicks. */
function firstPick(sim: ReturnType<typeof setup>['sim'], a: AgentState, maxTicks = 400): string | null {
  for (let i = 0; i < maxTicks; i++) {
    sim.step();
    const id = a.active?.interactionId;
    if (id && !id.startsWith('engine_idle')) return id;
  }
  return null;
}

describe('autonomy', () => {
  it('a hungry zombie goes for food', () => {
    const { sim, agents } = setup({ objects: HOME, autonomy: 'full', needs: { hunger: 20 } });
    putAt(agents[0], 10, 12);
    expect(['fx_snack', 'fx_dinner']).toContain(firstPick(sim, agents[0]));
    expect(agents[0].active?.source).toBe('auto');
  });

  it('a tired zombie goes to bed and sleeps until rested', () => {
    const { sim, agents } = setup({ objects: HOME, autonomy: 'full', needs: { energy: 12 } });
    const a = agents[0];
    putAt(a, 10, 12);
    expect(firstPick(sim, a)).toBe('fx_sleep');
    until(sim, () => a.active?.phase === 'run');
    expect(a.anim).toBe('sleep');
    expect(a.posY).toBeGreaterThan(0.3);
    const e0 = a.needs.energy;
    steps(sim, 240);
    expect(a.needs.energy).toBeGreaterThan(e0 + 10); // energy does not decay while asleep
  });

  it('comfortable zombies idle (stretch/groan/wander/phone/yawn) instead of doing chores', () => {
    const { sim, agents } = setup({ objects: HOME, autonomy: 'full', needs: { hunger: 95, energy: 95, social: 95, fun: 95, hygiene: 95 } });
    const seen = new Set<string>();
    for (let i = 0; i < 600; i++) {
      sim.step();
      if (agents[0].active) seen.add(agents[0].active.interactionId);
    }
    for (const id of seen) expect(id.startsWith('engine_idle')).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
  });

  it("autonomy 'off' does nothing until a critical need, then only critical overrides act", () => {
    const { sim, agents } = setup({ objects: HOME, autonomy: 'off', needs: { hunger: 30, fun: 5 } });
    const a = agents[0];
    putAt(a, 10, 12);
    steps(sim, 300);
    expect(a.active).toBeNull();
    a.needs.hunger = 4;
    const pick = firstPick(sim, a, 40);
    expect(['fx_snack', 'fx_dinner']).toContain(pick);
    expect(a.status.feral).toBe(true);
    expect(a.active?.priority).toBe(400);
    expect(sim.engine.ctx.hasMoodlet(a, 'feralHunger')).toBe(true);
    until(sim, () => a.needs.hunger >= 20, 4000);
    steps(sim, 2);
    expect(a.status.feral).toBe(false);
    expect(sim.engine.ctx.hasMoodlet(a, 'feralHunger')).toBe(false);
  });

  it("autonomy 'off' with energy <= 3 picks a bed (energy-only scoring)", () => {
    const { sim, agents } = setup({ objects: HOME, autonomy: 'off', needs: { energy: 2, fun: 1 } });
    putAt(agents[0], 10, 12);
    expect(firstPick(sim, agents[0], 40)).toBe('fx_sleep');
  });

  it("'limited' only considers needs below 35", () => {
    const a1 = setup({ objects: HOME, autonomy: 'limited', needs: { fun: 40, hunger: 40, energy: 40, hygiene: 40, social: 40 } });
    putAt(a1.agents[0], 10, 12);
    expect(firstPick(a1.sim, a1.agents[0], 200)).toBeNull();
    const a2 = setup({ objects: HOME, autonomy: 'limited', needs: { fun: 20 } });
    putAt(a2.agents[0], 10, 12);
    expect(firstPick(a2.sim, a2.agents[0], 200)).toBe('fx_watchTv');
  });

  it('energy 0 makes a household zombie collapse on the floor and wake with Slept on the Floor', () => {
    const { sim, agents, objects } = setup({ objects: [{ defId: 'mirror_cracked', x: 8, z: 8 }], autonomy: 'off' });
    const a = agents[0];
    putAt(a, 8, 12);
    sim.dispatch({ type: 'queue', actorId: a.id, interactionId: 'fx_admire', target: { kind: 'object', id: objects[0].id } });
    until(sim, () => a.active?.phase === 'run');
    a.needs.energy = 0;
    sim.step();
    expect(a.active?.interactionId).toBe('engine_passOut');
    expect(a.status.passedOut).toBe(true);
    // the interrupted player order waits behind it
    expect(a.queue.some((q) => q.interactionId === 'fx_admire')).toBe(true);
    // can't be cancelled by the player
    expect(sim.dispatch({ type: 'cancel', actorId: a.id, uid: a.active!.uid }).ok).toBe(false);
    until(sim, () => a.active?.interactionId !== 'engine_passOut', 240 * 10);
    expect(a.needs.energy).toBeGreaterThan(39.99);
    expect(a.status.passedOut).toBe(false);
    expect(sim.engine.ctx.hasMoodlet(a, 'sleptOnFloor')).toBe(true);
  });

  it('feral hunger interrupts a player activity and re-queues it', () => {
    const { sim, agents, objects } = setup({ objects: [...HOME, { defId: 'mirror_cracked', x: 8, z: 14 }], autonomy: 'full' });
    const a = agents[0];
    putAt(a, 8, 18);
    const mirror = objects[objects.length - 1];
    sim.dispatch({ type: 'queue', actorId: a.id, interactionId: 'fx_admire', target: { kind: 'object', id: mirror.id } });
    until(sim, () => a.active?.phase === 'run');
    a.needs.hunger = 3;
    sim.step();
    steps(sim, 6);
    expect(['fx_snack', 'fx_dinner']).toContain(a.active?.interactionId);
    expect(a.queue.some((q) => q.interactionId === 'fx_admire' && q.source === 'player')).toBe(true);
    expect(sim.state.notifications.some((n) => n.title === 'Mort has gone feral!')).toBe(true);
  });

  it('visitors only use visitorAllowed interactions, and only outdoor objects until welcomed', () => {
    const { sim, agents } = setup({
      objects: [
        { defId: 'fridge_humming', x: 5, z: 5 },
        { defId: 'tv_crt', x: 10, z: 20 },
        { defId: 'headstone_decor', x: 20, z: 20 },
      ],
      autonomy: 'full',
    });
    // a walled room around the TV makes it "indoor"
    const w = sim.state.lot.walls;
    for (let x = 8; x <= 12; x++) {
      w[`h:${x}:18`] = { paint: ['wall_plaster_bone', 'wall_plaster_bone'], openingId: null };
      w[`h:${x}:25`] = { paint: ['wall_plaster_bone', 'wall_plaster_bone'], openingId: null };
    }
    for (let z = 18; z <= 24; z++) {
      w[`v:8:${z}`] = { paint: ['wall_plaster_bone', 'wall_plaster_bone'], openingId: null };
      w[`v:13:${z}`] = { paint: ['wall_plaster_bone', 'wall_plaster_bone'], openingId: null };
    }
    const door = sim.engine.ctx.spawnObject('door_splintered', { kind: 'opening', edge: 'h:10:25' });
    expect(door.id).toBeTruthy();
    sim.state.lot.version++;
    sim.engine.spatial.invalidate();
    expect(sim.spatial.isIndoor(10, 21)).toBe(true);
    const ctx = sim.engine.ctx;
    const v = ctx.createAgent({ role: 'townie', presence: 'offLot', firstName: 'Vera', lastName: 'Visitor', appearance: {} as never, traits: [] });
    v.visit = { arrivedTick: sim.state.tick, leaveTick: sim.state.tick + 10000, reason: 'dropIn', welcomed: false, leaving: false };
    ctx.spawnAgent(v.id, { x: 15.5, z: 26.5 });
    for (const n of ['hunger', 'fun', 'social', 'energy', 'hygiene'] as const) v.needs[n] = 10;
    agents[0].needs.social = 95;
    const used = new Set<string>();
    for (let i = 0; i < 1500; i++) {
      sim.step();
      if (v.active) used.add(`${v.active.interactionId}@${v.active.target.kind === 'object' ? sim.state.objects[v.active.target.id]?.defId : v.active.target.kind}`);
    }
    for (const u of used) expect(u.startsWith('fx_snack') || u.startsWith('fx_dinner') || u.startsWith('fx_watchTv')).toBe(false);
    expect([...used].some((u) => u.startsWith('fx_ritual') || u.startsWith('fx_chat') || u.startsWith('engine_idle'))).toBe(true);
    // once welcomed the TV becomes fair game, the fridge never does
    v.visit!.welcomed = true;
    v.needs.fun = 5;
    v.status.autonomyCooldownUntil = 0;
    let watched = false;
    for (let i = 0; i < 1500 && !watched; i++) {
      sim.step();
      if (v.active?.interactionId === 'fx_watchTv') watched = true;
      expect(v.active?.interactionId === 'fx_snack' || v.active?.interactionId === 'fx_dinner').toBe(false);
    }
    expect(watched).toBe(true);
  });

  it('service NPCs and walk-bys never run autonomy', () => {
    const { sim } = setup({ objects: HOME, autonomy: 'full' });
    const ctx = sim.engine.ctx;
    const s = ctx.createAgent({ role: 'service', presence: 'offLot', firstName: 'Pizza', lastName: 'Ghoul', appearance: {} as never, traits: [] });
    const w = ctx.createAgent({ role: 'townie', presence: 'offLot', firstName: 'Walt', lastName: 'Walker', appearance: {} as never, traits: [] });
    w.walkBy = { from: { x: 0.5, z: 28.5 }, to: { x: 29.5, z: 28.5 }, startedTick: 0 };
    ctx.spawnAgent(s.id);
    ctx.spawnAgent(w.id);
    s.needs.hunger = 1;
    w.needs.fun = 1;
    steps(sim, 400);
    expect(s.active).toBeNull();
    expect(w.active).toBeNull();
    expect(s.needs.hunger).toBe(1); // no decay either
  });

  it('backs off after autonomous failures (4 min, doubling, max 30)', () => {
    const { sim, agents, objects } = setup({ objects: [{ defId: 'fridge_humming', x: 5, z: 5 }], autonomy: 'full', needs: { hunger: 20 } });
    const a = agents[0];
    putAt(a, 5, 12);
    sim.state.household.utilitiesOn = false; // snack needs power, dinner fridge stage needs power
    void objects;
    steps(sim, 4);
    // nothing powered: zombie can't pick the fridge at all -> idles instead of failing
    expect(a.active?.interactionId ?? '').not.toMatch(/fx_snack|fx_dinner/);
    // force an autonomous failure and check the cooldown
    sim.engine.ctx.queue(a, { interactionId: 'fx_snack', target: { kind: 'object', id: objects[0].id }, source: 'auto' });
    if (a.active) sim.engine.ctx.interrupt(a, 'x');
    until(sim, () => !a.active && a.queue.length === 0, 50);
    const fails1 = a.status.autonomyFails;
    expect(fails1).toBeGreaterThanOrEqual(1);
    expect(a.status.autonomyCooldownUntil).toBeGreaterThan(sim.state.tick);
    expect((a.status.autonomyCooldownUntil - sim.state.tick) / 4).toBeLessThanOrEqual(30);
  });

  it('is deterministic: same seed, same picks', () => {
    const run = () => {
      const { sim, agents } = setup({ objects: HOME, autonomy: 'full', seed: 7, members: ['A', 'B', 'C'] });
      const log: string[] = [];
      for (let i = 0; i < 2000; i++) {
        sim.step();
        for (const a of agents) if (a.active && a.active.startedRunTick === sim.state.tick) log.push(`${sim.state.tick}:${a.id}:${a.active.interactionId}`);
      }
      return log.join('|');
    };
    expect(run()).toBe(run());
  });
});
