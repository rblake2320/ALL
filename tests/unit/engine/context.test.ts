import { describe, expect, it } from 'vitest';
import type { ContentModule } from '../../../src/sim/contracts';
import { TICK_MINUTES } from '../../../src/sim/types';
import { setup, putAt, steps } from './helpers';

describe('needs', () => {
  it('applies trait needGain to positive and needDecay to negative deltas unless raw; clamps to [0, cap]', () => {
    const { sim, agents } = setup({ needs: { hunger: 50 } });
    const a = agents[0];
    const ctx = sim.engine.ctx;
    a.traits = ['fx_glutton']; // gain x1.5, decay x2
    expect(ctx.changeNeed(a, 'hunger', 10)).toBeCloseTo(15);
    expect(ctx.changeNeed(a, 'hunger', -10)).toBeCloseTo(-20);
    expect(ctx.changeNeed(a, 'hunger', 10, { raw: true })).toBeCloseTo(10);
    expect(ctx.changeNeed(a, 'hunger', 500)).toBeCloseTo(100 - 55);
    expect(a.needs.hunger).toBe(100);
    expect(ctx.changeNeed(a, 'hunger', -1e6)).toBe(-100);
    expect(a.needs.hunger).toBe(0);
  });

  it('caps preservation at vitality and ignores NaN/Infinity deltas; heals NaN values', () => {
    const { sim, agents } = setup();
    const a = agents[0];
    const ctx = sim.engine.ctx;
    a.vitality = 60;
    a.needs.preservation = 50;
    ctx.changeNeed(a, 'preservation', 40);
    expect(a.needs.preservation).toBe(60);
    expect(ctx.needCap(a, 'preservation')).toBe(60);
    expect(ctx.changeNeed(a, 'fun', Number.NaN)).toBe(0);
    expect(ctx.changeNeed(a, 'fun', Number.POSITIVE_INFINITY)).toBe(0);
    a.needs.fun = Number.NaN;
    ctx.changeNeed(a, 'fun', 1);
    expect(Number.isFinite(a.needs.fun)).toBe(true);
    expect(ctx.changeNeed(a, 'notANeed' as never, 5)).toBe(0);
  });

  it('decays hunger/energy/social/fun/hygiene at GDD rates x difficulty but never preservation', () => {
    const { sim, agents } = setup({ needs: { hunger: 80, energy: 80, social: 80, fun: 80, hygiene: 80, preservation: 80 } });
    const a = agents[0];
    sim.state.settings.difficulty = 'grim';
    steps(sim, 240); // one game hour
    expect(80 - a.needs.hunger).toBeCloseTo(5.5 * 1.3, 1);
    expect(80 - a.needs.energy).toBeCloseTo(5.0 * 1.3, 1);
    expect(80 - a.needs.social).toBeCloseTo(4.0 * 1.3, 1);
    expect(80 - a.needs.fun).toBeCloseTo(4.5 * 1.3, 1);
    expect(80 - a.needs.hygiene).toBeCloseTo(3.5 * 1.3, 1);
    expect(a.needs.preservation).toBe(80);
  });

  it('trait mult nightEnergyDecay only applies at night', () => {
    const { sim, agents } = setup({ members: ['A', 'B'], needs: { energy: 90 } });
    const [a, b] = agents;
    a.traits = ['fx_nightowl'];
    steps(sim, 240); // 09:00-10:00 day
    expect(a.needs.energy).toBeCloseTo(b.needs.energy, 5);
    while (!sim.time().isNight) sim.step();
    a.needs.energy = 90;
    b.needs.energy = 90;
    steps(sim, 240);
    expect(90 - a.needs.energy).toBeCloseTo((90 - b.needs.energy) * 0.5, 1);
  });
});

describe('moodlets', () => {
  it('stacks up to maxStacks, refreshes the end tick and expires', () => {
    const { sim, agents } = setup();
    const a = agents[0];
    const ctx = sim.engine.ctx;
    ctx.addMoodlet(a, 'fx_happy');
    ctx.addMoodlet(a, 'fx_happy');
    ctx.addMoodlet(a, 'fx_happy', { stacks: 5 });
    const m = a.moodlets.find((x) => x.id === 'fx_happy')!;
    expect(m.stacks).toBe(3);
    const end1 = m.endTick!;
    steps(sim, 40);
    ctx.addMoodlet(a, 'fx_happy');
    expect(m.endTick!).toBeGreaterThan(end1);
    expect(ctx.mood(a)).toBeGreaterThan(20);
    steps(sim, Math.ceil(60 / TICK_MINUTES) + 2);
    expect(ctx.hasMoodlet(a, 'fx_happy')).toBe(false);
  });

  it('logs unknown moodlets as faults instead of crashing; indefinite moodlets persist until removed', () => {
    const { sim, agents } = setup();
    const a = agents[0];
    const ctx = sim.engine.ctx;
    ctx.addMoodlet(a, 'nope_not_real');
    expect(a.moodlets).toHaveLength(0);
    expect(sim.faults().some((f) => f.message.includes('nope_not_real'))).toBe(true);
    ctx.addMoodlet(a, 'fx_sad');
    steps(sim, 2000);
    expect(ctx.hasMoodlet(a, 'fx_sad')).toBe(true);
    ctx.removeMoodlet(a, 'fx_sad');
    expect(ctx.hasMoodlet(a, 'fx_sad')).toBe(false);
  });

  it('moodlet duration is scaled by traitMult(moodletDuration:<id>)', () => {
    const extra: ContentModule = {
      id: 'x',
      traits: [{ id: 'x_hot', name: 'Hot', description: '', icon: 'angry', conflicts: [], reward: false, mult: { 'moodletDuration:fx_happy': 2 } }],
    };
    const { sim, agents } = setup({ extraContent: [extra] });
    const a = agents[0];
    a.traits = ['x_hot'];
    sim.engine.ctx.addMoodlet(a, 'fx_happy');
    const m = a.moodlets[0];
    expect((m.endTick! - m.startTick) * TICK_MINUTES).toBeCloseTo(120);
  });
});

describe('skills', () => {
  it('levels with xpPerLevel and skillGain, emits skillUp + notification + fx + sfx, caps at 10', () => {
    const { sim, agents } = setup();
    const a = agents[0];
    const ctx = sim.engine.ctx;
    a.traits = ['fx_quick']; // charisma x2
    a.skills.charisma = { level: 0, xp: 0 }; // new worlds start with a little random xp
    a.skills.logic = { level: 0, xp: 0 };
    ctx.addXp(a, 'charisma', 50); // 100 xp -> level 1
    expect(a.skills.charisma.level).toBe(1);
    expect(a.skills.charisma.xp).toBeCloseTo(0);
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'skillUp' && e.agentId === a.id && e.level === 1)).toBe(true);
    expect(ev.some((e) => e.type === 'fx' && e.kind === 'skillUp')).toBe(true);
    expect(ev.some((e) => e.type === 'sfx' && e.id === 'skillUp')).toBe(true);
    expect(sim.state.notifications.some((n) => n.kind === 'skill' && n.title.includes('Charisma 1'))).toBe(true);
    ctx.addXp(a, 'charisma', 1e9);
    expect(a.skills.charisma.level).toBe(10);
    expect(a.skills.charisma.xp).toBe(0);
    ctx.addXp(a, 'logic', -5);
    ctx.addXp(a, 'logic', Number.NaN);
    ctx.addXp(a, 'juggling' as never, 100);
    expect(a.skills.logic).toEqual({ level: 0, xp: 0 });
    expect(ctx.skillLevel(a, 'logic')).toBe(0);
  });
});

describe('money', () => {
  it('spend/earn are integer, never negative, and idempotent per key', () => {
    const { sim } = setup({ funds: 100 });
    const ctx = sim.engine.ctx;
    expect(ctx.spend(30.4, 'x', 'k1')).toBe(true);
    expect(sim.state.household.funds).toBe(70);
    expect(ctx.spend(30, 'x', 'k1')).toBe(true); // already done
    expect(sim.state.household.funds).toBe(70);
    expect(ctx.spend(1000, 'too much')).toBe(false);
    expect(sim.state.household.funds).toBe(70);
    expect(ctx.spend(-5, 'neg')).toBe(false);
    expect(ctx.spend(Number.NaN, 'nan')).toBe(false);
    expect(sim.state.household.funds).toBe(70);
    ctx.earn(10.6, 'pay', 'e1');
    ctx.earn(10.6, 'pay', 'e1');
    ctx.earn(-50, 'neg');
    ctx.earn(Number.NaN, 'nan');
    expect(sim.state.household.funds).toBe(81);
    expect(Number.isInteger(sim.state.household.funds)).toBe(true);
    // a failed spend does not burn its key
    expect(ctx.spend(500, 'later', 'k2')).toBe(false);
    ctx.earn(1000, 'gift');
    expect(ctx.spend(500, 'later', 'k2')).toBe(true);
    expect(sim.state.household.funds).toBe(581);
  });

  it('heals corrupted funds and bounds the txLog', () => {
    const { sim } = setup();
    const ctx = sim.engine.ctx;
    sim.state.household.funds = Number.NaN;
    expect(ctx.spend(1, 'x')).toBe(false);
    expect(sim.state.household.funds).toBe(0);
    for (let i = 0; i < 400; i++) ctx.earn(1, 'drip', `drip${i}`);
    expect(sim.state.household.txLog.length).toBeLessThanOrEqual(256);
    expect(sim.state.household.funds).toBe(400);
  });
});

describe('ids, relationships, stats', () => {
  it('rel() is keyed a|b sorted and never stores self/unknown pairs', () => {
    const { sim, agents } = setup({ members: ['A', 'B'] });
    const [a, b] = agents;
    const ctx = sim.engine.ctx;
    const r1 = ctx.rel(b.id, a.id);
    const r2 = ctx.rel(a.id, b.id);
    expect(r1).toBe(r2);
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    expect(sim.state.relationships[key]).toBe(r1);
    expect(r1.a < r1.b).toBe(true);
    const n = Object.keys(sim.state.relationships).length;
    ctx.rel(a.id, a.id).friendship = 50;
    ctx.rel(a.id, 'a999').friendship = 50;
    expect(Object.keys(sim.state.relationships).length).toBe(n);
  });

  it('newId/newUid stay unique even with a corrupted counter', () => {
    const { sim, agents } = setup();
    const ctx = sim.engine.ctx;
    const n = Number(agents[0].id.slice(1));
    sim.state.nextId = n; // collides with an existing agent id
    const id = ctx.newId('a');
    expect(sim.state.agents[id]).toBeUndefined();
    sim.state.nextId = Number.NaN;
    expect(Number.isFinite(ctx.newUid())).toBe(true);
  });

  it('stat()/statValue() track global and per-agent counters, ignoring junk', () => {
    const { sim, agents } = setup();
    const ctx = sim.engine.ctx;
    ctx.stat('mealsCooked');
    ctx.stat('mealsCooked', 2);
    ctx.stat('limbs', 1, agents[0].id);
    ctx.stat('', 5);
    ctx.stat('bad', Number.NaN);
    expect(ctx.statValue('mealsCooked')).toBe(3);
    expect(ctx.statValue('limbs', agents[0].id)).toBe(1);
    expect(ctx.statValue('bad')).toBe(0);
  });
});

describe('objects', () => {
  it('spawnObject bumps lot.version for floor objects only and emits events; unknown defs throw', () => {
    const { sim } = setup();
    const ctx = sim.engine.ctx;
    const v0 = sim.state.lot.version;
    const o = ctx.spawnObject('chair_creaky', { kind: 'floor', x: 3, z: 3, rot: 0 });
    expect(sim.state.lot.version).toBe(v0 + 1);
    ctx.spawnObject('item_dish', { kind: 'loose', x: 6.5, z: 6.5, y: 0, parentId: null, surfaceIndex: null, facing: 0 });
    expect(sim.state.lot.version).toBe(v0 + 1);
    const ev = sim.drainEvents();
    expect(ev.filter((e) => e.type === 'objectAdded')).toHaveLength(2);
    expect(() => ctx.spawnObject('no_such_def', { kind: 'floor', x: 1, z: 1, rot: 0 })).toThrow();
    expect(() => ctx.spawnObject('chair_creaky', { kind: 'floor', x: Number.NaN, z: 1, rot: 0 })).toThrow();
    ctx.removeObject(o.id);
    expect(sim.state.lot.version).toBe(v0 + 2);
    ctx.removeObject('nope'); // no-op
  });

  it('placeItemNear prefers a free surface, then the floor; surfaceOnly returns null', () => {
    const { sim } = setup({ objects: [{ defId: 'table_rickety', x: 10, z: 10 }] });
    const ctx = sim.engine.ctx;
    const table = Object.values(sim.state.objects).find((o) => o.defId === 'table_rickety')!;
    const m1 = ctx.placeItemNear('item_meal', { x: 10.5, z: 11.5 })!;
    expect(m1.placement.kind === 'loose' && m1.placement.parentId).toBe(table.id);
    const m2 = ctx.placeItemNear('item_meal', { x: 10.5, z: 11.5 })!; // table full -> floor
    expect(m2.placement.kind === 'loose' && m2.placement.parentId).toBe(null);
    expect(ctx.placeItemNear('item_meal', { x: 10.5, z: 11.5 }, { surfaceOnly: true })).toBeNull();
    expect(ctx.placeItemNear('nope', { x: 1, z: 1 })).toBeNull();
    expect(ctx.placeItemNear('item_meal', { x: Number.NaN, z: 1 })).toBeNull();
  });

  it('holdItem/releaseHeld keep placement and carry in sync', () => {
    const { sim, agents } = setup({ objects: [{ defId: 'table_rickety', x: 10, z: 10 }] });
    const a = agents[0];
    putAt(a, 10, 11);
    const ctx = sim.engine.ctx;
    const meal = ctx.placeItemNear('item_meal', { x: 3.5, z: 3.5 }, {})!;
    ctx.holdItem(a, meal);
    expect(meal.placement).toEqual({ kind: 'held', agentId: a.id });
    expect(a.carryObjectId).toBe(meal.id);
    expect(a.carrying).toBe('plate');
    const dish = ctx.spawnObject('item_dish', { kind: 'loose', x: 4.5, z: 4.5, y: 0, parentId: null, surfaceIndex: null, facing: 0 });
    ctx.holdItem(a, dish); // swaps: meal dropped
    expect(meal.placement.kind).toBe('loose');
    expect(a.carryObjectId).toBe(dish.id);
    const placed = ctx.releaseHeld(a, 'surface')!;
    expect(placed.placement.kind === 'loose' && placed.placement.parentId).toBeTruthy();
    expect(a.carryObjectId).toBeNull();
    expect(a.carrying).toBeNull();
    ctx.holdItem(a, meal);
    expect(ctx.releaseHeld(a, 'destroy')).toBeNull();
    expect(sim.state.objects[meal.id]).toBeUndefined();
    expect(ctx.releaseHeld(a, 'floor')).toBeNull();
    // placed furniture can't be held
    const table = Object.values(sim.state.objects).find((o) => o.defId === 'table_rickety')!;
    ctx.holdItem(a, table);
    expect(table.placement.kind).toBe('floor');
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('removeObject drops surface items, clears holders and interrupts users', () => {
    const { sim, agents } = setup({ objects: [{ defId: 'table_rickety', x: 10, z: 10 }] });
    const ctx = sim.engine.ctx;
    const table = Object.values(sim.state.objects).find((o) => o.defId === 'table_rickety')!;
    const meal = ctx.placeItemNear('item_meal', { x: 10.5, z: 10.5 })!;
    ctx.removeObject(table.id);
    expect(meal.placement.kind === 'loose' && meal.placement.parentId).toBeNull();
    ctx.holdItem(agents[0], meal);
    ctx.removeObject(meal.id);
    expect(agents[0].carryObjectId).toBeNull();
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('powered() follows utilities and needsPower/broken', () => {
    const { sim } = setup({ objects: [{ defId: 'tv_crt', x: 10, z: 10 }, { defId: 'chair_creaky', x: 12, z: 12 }] });
    const ctx = sim.engine.ctx;
    const tv = Object.values(sim.state.objects).find((o) => o.defId === 'tv_crt')!;
    const chair = Object.values(sim.state.objects).find((o) => o.defId === 'chair_creaky')!;
    expect(ctx.powered(tv)).toBe(true);
    tv.condition.broken = true;
    expect(ctx.powered(tv)).toBe(false);
    tv.condition.broken = false;
    sim.state.household.utilitiesOn = false;
    expect(ctx.powered(tv)).toBe(false);
    expect(ctx.powered(chair)).toBe(true);
    expect(ctx.powered()).toBe(false);
  });
});

describe('agents', () => {
  it('createAgent issues a<n> ids, joins the household for role household, spawn/despawn emit events and hooks', () => {
    const arrived: string[] = [];
    const left: string[] = [];
    const { sim } = setup({ extraSystems: [{ id: 'watch', agentArrived: (_c, a) => void arrived.push(a.id), agentLeft: (_c, a) => void left.push(a.id) }] });
    const ctx = sim.engine.ctx;
    const t = ctx.createAgent({ role: 'townie', presence: 'offLot', firstName: 'Tess', lastName: 'Tomb', appearance: {} as never, traits: ['fx_cheery', 'fx_cheery', 7 as never] });
    expect(t.id).toMatch(/^a\d+$/);
    expect(t.traits).toEqual(['fx_cheery']);
    expect(sim.state.household.memberIds).not.toContain(t.id);
    const h = ctx.createAgent({ role: 'household', presence: 'offLot', firstName: '\u0000Bad\nName', lastName: 'X', appearance: null as never, traits: [] });
    expect(sim.state.household.memberIds).toContain(h.id);
    expect(h.firstName).toBe('BadName');
    ctx.spawnAgent(t.id);
    ctx.spawnAgent(t.id); // idempotent
    expect(arrived).toEqual([t.id]);
    expect(sim.state.agents[t.id].presence).toBe('onLot');
    ctx.despawnAgent(t.id, 'onLot' as never); // invalid presence -> offLot
    expect(sim.state.agents[t.id].presence).toBe('offLot');
    expect(left).toEqual([t.id]);
    ctx.spawnAgent('a99999');
    expect(sim.faults().some((f) => f.where === 'spawnAgent')).toBe(true);
  });

  it('sendOffLot walks to the exit then despawns with the given presence', () => {
    const { sim, agents } = setup();
    const a = agents[0];
    putAt(a, 15, 20);
    sim.engine.ctx.sendOffLot(a, 'atWork', 'Off to work');
    expect(a.active?.interactionId).toBe('engine_exitLot');
    for (let i = 0; i < 2000 && a.presence === 'onLot'; i++) sim.step();
    expect(a.presence).toBe('atWork');
    expect(a.active).toBeNull();
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('an agent walled in is still despawned by sendOffLot', () => {
    const { sim, agents } = setup();
    const a = agents[0];
    putAt(a, 15, 15);
    const walls = sim.state.lot.walls;
    for (const k of ['h:15:15', 'h:15:16', 'v:15:15', 'v:16:15']) walls[k] = { paint: ['wall_plaster_bone', 'wall_plaster_bone'], openingId: null };
    sim.state.lot.version++;
    sim.engine.ctx.sendOffLot(a, 'offLot', 'bye');
    for (let i = 0; i < 400 && a.presence === 'onLot'; i++) sim.step();
    expect(a.presence).toBe('offLot');
  });
});

describe('effects, requirements, conditions, choices', () => {
  it('unknown effect ids are faults, not crashes; throwing effects are contained', () => {
    const { sim, agents } = setup({ extraSystems: [{ id: 'boom', effects: { boom: () => { throw new Error('kaboom'); } } }] });
    const ctx = sim.engine.ctx;
    const ec = { actor: agents[0], run: null, def: null, stage: null, targetAgent: null, targetObject: null };
    ctx.runEffect({ id: 'nonexistent' }, ec);
    ctx.runEffect({ id: 'boom' }, ec);
    ctx.runEffect(null as never, ec);
    expect(sim.faults().map((f) => f.where)).toEqual(expect.arrayContaining(['effect:nonexistent', 'effect:boom']));
  });

  it('engine requirement checks return player-facing reasons and honour params.reason', () => {
    const { sim, agents } = setup({ funds: 10 });
    const ctx = sim.engine.ctx;
    const a = agents[0];
    const def = sim.content.interactions.fx_snack;
    const rc = { actor: a, def, target: { kind: 'self' } as const, targetAgent: null, targetObject: null, params: {} };
    expect(ctx.checkRequirement({ id: 'funds', params: { min: 40 } }, rc)).toBe('Needs $40');
    expect(ctx.checkRequirement({ id: 'skill', params: { skill: 'cooking', min: 3 } }, rc)).toBe('Needs Cooking 3');
    expect(ctx.checkRequirement({ id: 'needBelow', params: { need: 'hunger', max: 50 } }, rc)).toBe('Not hungry');
    expect(ctx.checkRequirement({ id: 'needBelow', params: { need: 'hunger', max: 50, reason: 'Full!' } }, rc)).toBe('Full!');
    a.limbs.armL = 'missing';
    a.limbs.armR = 'prosthetic';
    expect(ctx.checkRequirement({ id: 'arms', params: { min: 1 } }, rc)).toBe(true);
    expect(ctx.checkRequirement({ id: 'arms', params: { min: 2 } }, rc)).toBe('Needs 2 arms');
    expect(ctx.checkRequirement({ id: 'hourBetween', params: { from: 22, to: 2 } }, rc)).toMatch(/Only between/);
    expect(ctx.checkRequirement({ id: 'mystery' }, rc)).toBe('Something went wrong');
    expect(sim.faults().some((f) => f.where === 'requirement:mystery')).toBe(true);
    expect(ctx.checkRequirement({ id: 'tagOnLot', params: { tag: 'fridge' } }, rc)).toBe('Needs a fridge');
  });

  it('evalCondition supports engine kinds + system kinds and is false for unknown kinds', () => {
    const { sim, agents } = setup({ funds: 5000 });
    const ctx = sim.engine.ctx;
    const a = agents[0];
    expect(ctx.evalCondition({ kind: 'funds', params: { min: 5000 } }, null)).toBe(true);
    expect(ctx.evalCondition({ kind: 'and', params: { all: [{ kind: 'always', params: {} }, { kind: 'fx_always', params: {} }] } }, a)).toBe(true);
    expect(ctx.evalCondition({ kind: 'not', params: { cond: { kind: 'always', params: {} } } }, a)).toBe(false);
    expect(ctx.evalCondition({ kind: 'or', params: { any: [{ kind: 'never', params: {} }, { kind: 'skill', params: { skill: 'logic', min: 0 } }] } }, a)).toBe(true);
    expect(ctx.evalCondition({ kind: 'wat', params: {} }, a)).toBe(false);
    expect(ctx.evalCondition(undefined as never, a)).toBe(false);
  });

  it('offerChoice auto-resolves the default option at expiry and runs its effect once', () => {
    const { sim, agents } = setup({ funds: 0 });
    const id = sim.engine.ctx.offerChoice({
      title: 'Found a wallet',
      text: 'Keep it?',
      agentId: agents[0].id,
      options: [
        { label: 'Keep', effect: 'earn', params: { amount: 40, reason: 'wallet' }, tooltip: null },
        { label: 'Return', effect: 'notify', params: { kind: 'good', title: 'Nice', text: 'You returned it' }, tooltip: null },
      ],
      expiresTick: sim.state.tick + 4,
      defaultOption: 0,
    });
    expect(sim.state.choices.map((c) => c.id)).toContain(id);
    steps(sim, 6);
    expect(sim.state.choices).toHaveLength(0);
    expect(sim.state.household.funds).toBe(40);
  });

  it('sys() appends the invoking SimContext as the last argument and caches one wrapper per system', () => {
    const seen: unknown[][] = [];
    const { sim } = setup({ extraSystems: [{ id: 'echo', api: { echo: (...args: unknown[]) => (seen.push(args), args.length) } }] });
    const ctx = sim.engine.ctx;
    expect(ctx.sys('echo').echo('a', 2)).toBe(3);
    expect(seen[0].slice(0, 2)).toEqual(['a', 2]);
    expect(seen[0][2]).toBe(ctx);
    expect(ctx.sys('echo')).toBe(ctx.sys('echo'));
    expect(Object.isFrozen(ctx.sys('echo'))).toBe(true);
  });

  it('failRun fails the active run at the next safe point with a player-facing reason (persisted across saves)', () => {
    const { sim, agents, objects } = setup({ objects: [{ defId: 'mirror_cracked', x: 6, z: 6 }] });
    const a = agents[0];
    putAt(a, 6, 8);
    sim.dispatch({ type: 'queue', actorId: a.id, interactionId: 'fx_admire', target: { kind: 'object', id: objects[0].id } });
    for (let i = 0; i < 40 && a.active?.phase !== 'run'; i++) sim.step();
    sim.engine.ctx.failRun(a, 'The mirror cracked some more');
    expect(a.active).not.toBeNull(); // deferred
    expect(sim.serialize().agents[a.id].active?.data._fail).toBe('The mirror cracked some more');
    sim.drainEvents();
    sim.step();
    expect(a.active).toBeNull();
    expect(sim.drainEvents().some((e) => e.type === 'interactionFailed' && e.reason === 'The mirror cracked some more')).toBe(true);
    expect(sim.state.notifications.at(-1)?.text).toBe('The mirror cracked some more');
    sim.engine.ctx.failRun(a, 'nothing running'); // no-op
    sim.engine.ctx.failRun(null as never, 'x');
  });

  it('sys() returns the api or an empty object for missing systems', () => {
    const { sim } = setup({ extraSystems: [{ id: 'economy', api: { lotValue: () => 1234 } }] });
    expect(sim.engine.ctx.sys('economy').lotValue()).toBe(1234);
    expect(sim.engine.ctx.sys('missing')).toEqual({});
    expect(sim.lotValue()).toBe(1234);
  });
});
