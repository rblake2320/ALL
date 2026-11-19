/**
 * W-123 (D-070) resolver: resolveQuestAction(step, worldView, selectedAgent) — adversarial unit tests.
 *  - EVERY shipped quest step, daily task and weekly challenge resolves to a known kind (a new step type, a new stat
 *    key or a new objective kind cannot ship unhandled);
 *  - no valid object → missing + Buy filter; multiple candidates → nearest reachable, deterministic tie-break;
 *    unreachable; in use; missing arms; asleep / busy; already complete; already queued; unknown; garbage.
 * Real-module worlds (the engine's own menu decides availability) plus a few synthetic world views for exact
 * distances / reachability.
 */
import { describe, expect, it } from 'vitest';
import type { MenuEntry, ObjectiveDef } from '../../../src/sim/contracts';
import type { AgentState, TargetRef, WorldState } from '../../../src/sim/types';
import { ALL_QUESTS, DAILY_TASK_POOL } from '../../../src/sim/content/quests';
import { WEEKLY_POOL } from '../../../src/economy/daily';
import { ACTIVITY_CATEGORIES, QUEST_ACTION_KINDS, questPlan, resolveActivity, resolveQuestAction, type QuestAction, type QuestWorldView } from '../../../src/shared/questAction';
import { newWorld, opts, simOf, systemsWithQuests } from '../quests/helpers';
import { buyIn, MAIN_ROOM, BACK_ROOM } from '../quests/act1Driver';
import type { EngineSimulation } from '../../../src/sim/engine';

function world(lot: 'derelict' | 'starter' | 'empty' = 'derelict', seed = 41, members = 2): EngineSimulation {
  const systems = systemsWithQuests();
  return simOf(newWorld({ ...opts(seed, members), lotTemplate: lot }, systems), systems);
}

const ALL_STEPS: { key: string; objective: ObjectiveDef }[] = [
  ...ALL_QUESTS.flatMap((q) => q.steps.map((s) => ({ key: `${q.id}.${s.id}`, objective: s.objective }))),
  ...DAILY_TASK_POOL.map((d) => ({ key: `daily.${d.id}`, objective: d.objective })),
  ...WEEKLY_POOL.map((d) => ({ key: `weekly.${d.id}`, objective: d.objective })),
];

const obj = (o: unknown): { objective: ObjectiveDef } => ({ objective: o as ObjectiveDef });
const kindOf = (a: QuestAction) => (a.kind === 'mode' ? `mode:${a.mode}` : a.kind);
const q = (a: QuestAction) => {
  if (a.kind !== 'queue') throw new Error(`expected queue, got ${JSON.stringify(a)}`);
  return a;
};

describe('every shipped step resolves to a known kind', () => {
  it('questPlan handles every quest / daily / weekly step (no "unknown" plan)', () => {
    expect(ALL_STEPS.length).toBeGreaterThan(80);
    const unhandled = ALL_STEPS.filter((s) => questPlan(s.objective).type === 'unknown').map((s) => s.key);
    expect(unhandled).toEqual([]);
  });

  for (const lot of ['derelict', 'starter', 'empty'] as const) {
    it(`resolves every step on a fresh ${lot} world to queue | mode | missing | blocked (never unknown / invalid)`, () => {
      const sim = world(lot);
      const bad: string[] = [];
      for (const s of ALL_STEPS) {
        const a = resolveQuestAction({ objective: s.objective }, sim, null);
        if (!QUEST_ACTION_KINDS.includes(a.kind)) bad.push(`${s.key}: kind ${String(a.kind)}`);
        if (a.kind === 'blocked' && (a.code === 'unknown' || a.code === 'invalid')) bad.push(`${s.key}: ${a.code}`);
        if (a.kind === 'blocked' && !(typeof a.reason === 'string' && a.reason.length > 0)) bad.push(`${s.key}: empty reason`);
        if (a.kind === 'missing' && (a.buyFilter.defIds.length === 0 || !a.need)) bad.push(`${s.key}: empty buy filter`);
        if (a.kind === 'queue') {
          // never something the engine's menu would refuse
          const entry = sim.menu(a.agentId, a.target).find((e) => e.interactionId === a.interactionId);
          const child = entry?.children?.find((c) => Object.keys(c.params).every((k) => c.params[k] === a.extra[k]));
          if (!entry || !(child ?? entry).available) bad.push(`${s.key}: queued ${a.interactionId} the menu refuses`);
        }
      }
      expect(bad).toEqual([]);
    });
  }

  it('the owner screenshot rows resolve as promised', () => {
    const sim = world('derelict');
    const step = (questId: string, stepId: string) => ALL_QUESTS.find((d) => d.id === questId)!.steps.find((s) => s.id === stepId)!.objective;
    expect(resolveQuestAction(obj(step('act1_patch', 'walls')), sim, null)).toMatchObject({ kind: 'mode', mode: 'build', tool: 'wall', count: 4 });
    expect(resolveQuestAction(obj(step('story_makeFriend', 'friend')), sim, null)).toMatchObject({ kind: 'queue', interactionId: 'phone_inviteOver' });
    expect(resolveQuestAction(obj(step('story_firstRepair', 'repair')), sim, null)).toMatchObject({ kind: 'blocked', reason: 'Nothing is broken right now' });
    expect(resolveQuestAction(obj(step('n_artist', 'goal')), sim, null)).toMatchObject({ kind: 'missing', need: 'an easel', buyFilter: { defIds: ['easel_morbid'], category: 'hobbies' } });
    expect(resolveQuestAction(obj(DAILY_TASK_POOL.find((d) => d.id === 'd_read2')!.objective), sim, null)).toMatchObject({ kind: 'missing', need: 'a bookshelf' });
    // Cerebellum Stew needs a fridge first, then the recipe (Cooking 2) — never "cook anything"
    expect(resolveQuestAction(obj(step('n_gourmet', 'goal')), sim, null).kind).toBe('missing');
    buyIn(sim, 'fridge_humming', MAIN_ROOM);
    const g = resolveQuestAction(obj(step('n_gourmet', 'goal')), sim, null);
    expect(g).toMatchObject({ kind: 'blocked', code: 'agent' });
    expect((g as { reason: string }).reason).toMatch(/cooking|skill|level/i);
  });
});

describe('real world: candidates, reachability, the engine’s reasons', () => {
  it('no valid object → missing with the Buy filter; buying one turns it into a queue at that object', () => {
    const sim = world();
    const paint = obj({ kind: 'interaction', ids: ['home_paint'], count: 1 });
    expect(resolveQuestAction(paint, sim, null)).toMatchObject({ kind: 'missing', need: 'an easel' });
    const id = buyIn(sim, 'easel_morbid', MAIN_ROOM)!;
    const a = q(resolveQuestAction(paint, sim, null));
    expect(a).toMatchObject({ interactionId: 'home_paint', objectId: id, target: { kind: 'object', id }, already: false });
    expect(a.targetName).toBe(sim.content.objects.easel_morbid.name);
  });

  it('multiple candidates: the nearest reachable wins (path cost from the agent)', () => {
    const sim = world();
    const a1 = buyIn(sim, 'shelf_moldering', MAIN_ROOM)!;
    const a2 = buyIn(sim, 'shelf_moldering', BACK_ROOM)!;
    const actor = sim.state.household.memberIds[0];
    const read = obj({ kind: 'interaction', ids: ['home_read'], count: 1 });
    const pick = q(resolveQuestAction(read, sim, actor));
    // move the actor next to the other shelf: the choice follows
    const other = pick.objectId === a1 ? a2 : a1;
    const slot = sim.spatial.resolveSlots(sim.state.objects[other])[0].approach[0];
    sim.state.agents[actor].pos = { x: slot.x + 0.5, z: slot.z + 0.5 };
    sim.state.agents[actor].prevPos = { x: slot.x + 0.5, z: slot.z + 0.5 };
    const again = q(resolveQuestAction(read, sim, actor));
    expect(again.objectId).toBe(other);
    expect(again.cost).toBeLessThanOrEqual(pick.cost + 1e-9 + 100);
    // same world twice → same answer (deterministic)
    expect(resolveQuestAction(read, sim, actor)).toEqual(again);
  });

  it('agent missing both arms → blocked with the engine’s own reason', () => {
    const sim = world();
    buyIn(sim, 'easel_morbid', MAIN_ROOM);
    const actor = sim.state.household.memberIds[0];
    const ag = sim.state.agents[actor];
    ag.limbs = { ...ag.limbs, armL: 'missing', armR: 'missing' };
    const a = resolveQuestAction(obj({ kind: 'interaction', ids: ['home_paint'], count: 1 }), sim, actor);
    expect(a).toMatchObject({ kind: 'blocked', code: 'agent' });
    expect((a as { reason: string }).reason).toMatch(/arm/i);
    // without a selection the able housemate is chosen instead
    const b = q(resolveQuestAction(obj({ kind: 'interaction', ids: ['home_paint'], count: 1 }), sim, null));
    expect(b.agentId).toBe(sim.state.household.memberIds[1]);
  });

  it('repair targets only broken objects, and picks the nearest broken one', () => {
    const sim = world('starter');
    const repair = obj({ kind: 'stat', key: 'repairs', count: 1 });
    expect(resolveQuestAction(repair, sim, null)).toMatchObject({ kind: 'blocked', reason: 'Nothing is broken right now' });
    const fridge = Object.values(sim.state.objects).find((o) => sim.content.objects[o.defId]?.interactions.includes('home_repair'))!;
    fridge.condition.broken = true;
    expect(q(resolveQuestAction(repair, sim, null))).toMatchObject({ interactionId: 'home_repair', objectId: fridge.id });
  });

  it('bills: "No bills to pay right now" until one arrives, then the mailbox', () => {
    const sim = world();
    const pay = obj({ kind: 'billsOnTime', count: 1 });
    expect(resolveQuestAction(pay, sim, null)).toMatchObject({ kind: 'blocked', reason: 'No bills to pay right now' });
    sim.state.household.bills.push({ id: 'b-test', issuedTick: sim.state.tick, dueTick: sim.state.tick + 9999, amount: 10, paidTick: null, stage: 0 });
    expect(q(resolveQuestAction(pay, sim, null)).interactionId).toBe('home_payBills');
  });

  it('a recipe step picks exactly that recipe from the menu’s children', () => {
    const sim = world('starter');
    const ag = sim.state.agents[sim.state.household.memberIds[0]];
    (ag.skills as Record<string, { level: number; xp: number }>).cooking = { level: 5, xp: 0 };
    const a = resolveQuestAction(obj({ kind: 'interaction', tags: ['cook'], match: { recipe: 'cerebellumStew' }, count: 1 }), sim, ag.id);
    if (a.kind === 'queue') expect(a.extra.recipe).toBe('cerebellumStew');
    else expect(a.kind).toBe('blocked'); // e.g. groceries unaffordable — still the engine's reason, never another recipe
  });

  it('already queued: the same action is reported as already queued (and still resolves to it)', () => {
    const sim = world();
    const id = buyIn(sim, 'easel_morbid', MAIN_ROOM)!;
    const actor = sim.state.household.memberIds[0];
    const paint = obj({ kind: 'interaction', ids: ['home_paint'], count: 1 });
    const a = q(resolveQuestAction(paint, sim, actor));
    expect(sim.dispatch({ type: 'queue', actorId: actor, interactionId: a.interactionId, target: a.target, params: a.extra }).ok).toBe(true);
    const b = q(resolveQuestAction(paint, sim, actor));
    expect(b).toMatchObject({ objectId: id, already: true });
  });

  it('quest already complete → blocked "Already done"', () => {
    const sim = world();
    expect(resolveQuestAction({ objective: { kind: 'interaction', ids: ['home_checkMail'], count: 1 }, done: true }, sim, null)).toEqual({ kind: 'blocked', reason: 'Already done', code: 'done' });
  });

  it('nobody home → blocked; a selected member at work falls back to the others', () => {
    const sim = world();
    const [a, b] = sim.state.household.memberIds;
    const mail = obj({ kind: 'interaction', ids: ['home_checkMail'], count: 1 });
    sim.state.agents[a].presence = 'atWork';
    expect(q(resolveQuestAction(mail, sim, a)).agentId).toBe(b);
    sim.state.agents[b].presence = 'atWork';
    expect(resolveQuestAction(mail, sim, a)).toMatchObject({ kind: 'blocked', code: 'nobody' });
  });
});

// ───────────────────────────── synthetic world views (exact geometry) ─────────────────────────────

interface FakeObj {
  id: string;
  x: number;
  z: number;
  reachable?: boolean;
  menu?: Partial<MenuEntry>;
}

function fakeWorld(objs: FakeObj[], agents: Partial<AgentState>[] = [{}], opts2: { spatial?: boolean } = {}): QuestWorldView {
  const W = 20;
  const agentsMap: Record<string, AgentState> = {};
  agents.forEach((a, i) => {
    const id = a.id ?? `a${i + 1}`;
    agentsMap[id] = { id, role: 'household', presence: 'onLot', firstName: `Z${i + 1}`, pos: { x: 10.5, z: 10.5 }, queue: [], active: null, status: { passedOut: false }, ...a } as unknown as AgentState;
  });
  const objects: Record<string, unknown> = {};
  for (const o of objs) objects[o.id] = { id: o.id, defId: 'easel_morbid', placement: { kind: 'floor', x: o.x, z: o.z, rot: 0 }, condition: { broken: false } };
  const state = { tick: 0, agents: agentsMap, objects, household: { memberIds: Object.keys(agentsMap), bills: [], funds: 100 }, relationships: {} } as unknown as WorldState;
  const dist = new Float32Array(W * W);
  for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) dist[z * W + x] = Math.abs(x - 10) + Math.abs(z - 10);
  for (const o of objs) if (o.reachable === false) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) dist[(o.z + dz) * W + (o.x + dx)] = Infinity;
  const spatial = {
    distanceField: () => ({ dist, parent: new Int32Array(0), originIndex: 0, version: 0 }),
    tileIndex: (x: number, z: number) => z * W + x,
    inBounds: (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < W,
    resolveSlots: (o: { placement: { x: number; z: number } }) => [{ index: 0, id: 'front', kind: 'stand' as const, approach: [{ x: o.placement.x, z: o.placement.z + 1 }], pose: { x: 0, z: 0, y: 0, facing: 0 } }],
    objectTiles: (o: { placement: { x: number; z: number } }) => [{ x: o.placement.x, z: o.placement.z }],
  };
  return {
    state,
    content: {
      objects: { easel_morbid: { id: 'easel_morbid', name: 'Easel', tags: ['easel'], interactions: ['home_paint'], category: 'hobbies', price: 350 } as never },
      interactions: { home_paint: { id: 'home_paint', label: 'Paint', targetKind: 'object', tags: ['paint'], icon: 'paint' } as never, home_sleep: { id: 'home_sleep', label: 'Sleep', targetKind: 'object', tags: ['sleep'], icon: 'coffin' } as never },
    },
    spatial: opts2.spatial === false ? null : (spatial as never),
    menu: (_actor: string, t: TargetRef) => {
      const o = t.kind === 'object' ? objs.find((x) => x.id === t.id) : undefined;
      if (!o) return [];
      return [{ interactionId: 'home_paint', label: 'Paint', group: null, icon: 'paint', available: true, reason: null, cost: null, params: {}, ...(o.menu ?? {}) } as MenuEntry];
    },
  };
}

const PAINT = obj({ kind: 'interaction', ids: ['home_paint'], count: 1 });

describe('synthetic: distances, ties, reachability, use, sleep', () => {
  it('nearest wins; an exact tie goes to the lower object id (o2 before o10 — numeric, not string order)', () => {
    const w = fakeWorld([
      { id: 'o10', x: 7, z: 9 },
      { id: 'o2', x: 13, z: 9 },
      { id: 'o3', x: 2, z: 2 },
    ]);
    expect(q(resolveQuestAction(PAINT, w, 'a1')).objectId).toBe('o2');
    // key insertion order must not matter
    const w2 = fakeWorld([
      { id: 'o2', x: 13, z: 9 },
      { id: 'o10', x: 7, z: 9 },
    ]);
    expect(q(resolveQuestAction(PAINT, w2, 'a1')).objectId).toBe('o2');
    const w3 = fakeWorld([
      { id: 'o2', x: 2, z: 2 },
      { id: 'o10', x: 9, z: 9 },
    ]);
    expect(q(resolveQuestAction(PAINT, w3, 'a1')).objectId).toBe('o10');
  });

  it('unreachable: the nearer but walled-off object is skipped; alone it is blocked "Can’t get there"', () => {
    const w = fakeWorld([
      { id: 'o1', x: 10, z: 8, reachable: false },
      { id: 'o2', x: 3, z: 3 },
    ]);
    expect(q(resolveQuestAction(PAINT, w, 'a1')).objectId).toBe('o2');
    expect(resolveQuestAction(PAINT, fakeWorld([{ id: 'o1', x: 10, z: 8, reachable: false }]), 'a1')).toMatchObject({ kind: 'blocked', reason: 'Can’t get there' });
  });

  it('in use: the menu’s "In use" skips that easel; with only that one, the reason is shown', () => {
    const busy = { available: false, reason: 'In use' };
    expect(q(resolveQuestAction(PAINT, fakeWorld([{ id: 'o1', x: 10, z: 8, menu: busy }, { id: 'o2', x: 2, z: 2 }]), 'a1')).objectId).toBe('o2');
    expect(resolveQuestAction(PAINT, fakeWorld([{ id: 'o1', x: 10, z: 8, menu: busy }]), 'a1')).toEqual({ kind: 'blocked', reason: 'In use', code: 'agent' });
  });

  it('asleep / busy: with no selection the awake, free zombie goes; a selected sleeper still queues (waits its turn)', () => {
    const sleeping = { id: 'a1', active: { interactionId: 'home_sleep', source: 'auto', target: { kind: 'self' } } } as unknown as Partial<AgentState>;
    const busy = { id: 'a2', pos: { x: 10.5, z: 8.5 }, queue: [{ uid: 1, interactionId: 'home_read', target: { kind: 'self' }, params: {}, source: 'player', priority: 200, queuedTick: 0 }] } as unknown as Partial<AgentState>;
    const free = { id: 'a3', pos: { x: 2.5, z: 2.5 } } as Partial<AgentState>;
    const w = fakeWorld([{ id: 'o1', x: 10, z: 8 }], [sleeping, busy, free]);
    expect(q(resolveQuestAction(PAINT, w, null))).toMatchObject({ agentId: 'a3', wait: null });
    expect(q(resolveQuestAction(PAINT, w, 'a1'))).toMatchObject({ agentId: 'a1', wait: 'asleep' });
    expect(q(resolveQuestAction(PAINT, w, 'a2'))).toMatchObject({ agentId: 'a2', wait: 'busy' });
    // everyone asleep or busy: the busy one beats the sleeper
    expect(q(resolveQuestAction(PAINT, fakeWorld([{ id: 'o1', x: 10, z: 8 }], [sleeping, busy]), null)).agentId).toBe('a2');
  });

  it('without spatial data it still answers (straight-line distance)', () => {
    expect(q(resolveQuestAction(PAINT, fakeWorld([{ id: 'o1', x: 1, z: 1 }, { id: 'o2', x: 11, z: 11 }], [{}], { spatial: false }), 'a1')).objectId).toBe('o2');
  });
});

describe('resolveActivity: the shared core (W-124 seam)', () => {
  it('ranked candidates, best first; resolveQuestAction is the top one', () => {
    const w = fakeWorld([
      { id: 'o3', x: 2, z: 2 },
      { id: 'o1', x: 10, z: 8 },
      { id: 'o2', x: 13, z: 9 },
    ]);
    const r = resolveActivity(PAINT, w, 'a1');
    expect(r.candidates.map((c) => c.action.objectId)).toEqual(['o1', 'o2', 'o3']);
    expect(r.best).toEqual(r.candidates[0].action);
    expect(resolveQuestAction(PAINT, w, 'a1')).toEqual(r.best);
    expect(resolveActivity(PAINT, w, 'a1', { limit: 1 }).candidates).toHaveLength(1);
    // positions are LOT-LOCAL tiles of the active lot — never world / map coordinates
    expect(r.candidates[0].place).toEqual({ space: 'lot', lotId: null, x: 10, z: 8 });
  });

  it('skips objects another household member already queued (unless asked not to)', () => {
    const other = { id: 'a2', pos: { x: 2.5, z: 2.5 }, queue: [{ uid: 9, interactionId: 'home_paint', target: { kind: 'object', id: 'o1' }, params: {}, source: 'player', priority: 200, queuedTick: 0 }] } as unknown as Partial<AgentState>;
    const w = fakeWorld([{ id: 'o1', x: 10, z: 8 }, { id: 'o2', x: 2, z: 2 }], [{ id: 'a1' }, other]);
    expect(q(resolveQuestAction(PAINT, w, 'a1')).objectId).toBe('o2');
    expect(resolveActivity(PAINT, w, 'a1', { excludeClaimed: false }).candidates[0].action.objectId).toBe('o1');
    const only = fakeWorld([{ id: 'o1', x: 10, z: 8 }], [{ id: 'a1' }, other]);
    expect(resolveQuestAction(PAINT, only, 'a1')).toMatchObject({ kind: 'blocked', reason: 'Someone else is already on it' });
  });

  it('categories resolve on a real world (clean / yard / play / …); unknown categories are "unknown"', () => {
    const sim = world('starter');
    for (const c of Object.keys(ACTIVITY_CATEGORIES)) expect(QUEST_ACTION_KINDS, c).toContain(resolveActivity({ category: c }, sim, null, { all: true }).best.kind);
    const play = resolveActivity({ category: 'play' }, sim, null, { all: true });
    for (const c of play.candidates) expect(sim.menu(c.action.agentId, c.action.target).find((e) => e.interactionId === c.action.interactionId)?.available).toBe(true);
    expect(resolveActivity({ category: 'juggling' }, sim, null).best).toMatchObject({ kind: 'blocked', code: 'unknown' });
    expect(resolveActivity({ category: '__proto__' }, sim, null).best).toMatchObject({ kind: 'blocked', code: 'unknown' });
    expect(resolveActivity(null, sim, null).best).toMatchObject({ kind: 'blocked', code: 'invalid' });
  });
});

describe('unknown steps and garbage never throw', () => {
  it('unknown objective kinds / stat keys → blocked "unknown"', () => {
    const sim = world();
    expect(resolveQuestAction(obj({ kind: 'teleport', count: 1 }), sim, null)).toMatchObject({ kind: 'blocked', code: 'unknown' });
    expect(resolveQuestAction(obj({ kind: 'stat', key: 'noSuchCounter', count: 1 }), sim, null)).toMatchObject({ kind: 'blocked', code: 'unknown' });
    expect(resolveQuestAction(obj({ kind: 'interaction', count: 1 }), sim, null)).toMatchObject({ kind: 'blocked', code: 'unknown' });
    expect(resolveQuestAction(obj({ kind: 'interaction', ids: ['no_such_interaction'], count: 1 }), sim, null)).toMatchObject({ kind: 'blocked', code: 'none' });
    expect(questPlan({ kind: 'event', event: 'eclipse', count: 1 } as never)).toEqual({ type: 'unknown' });
  });

  it('garbage step / world / agent inputs → blocked "invalid"', () => {
    const sim = world();
    const junk: unknown[] = [null, undefined, 0, 42, 'x', [], {}, { objective: null }, { objective: 7 }, { objective: 'walls' }, { objective: [] }];
    for (const j of junk) expect(resolveQuestAction(j as never, sim, null)).toMatchObject({ kind: 'blocked' });
    for (const w of [null, undefined, 1, {}, { state: null }, { state: {}, content: {} }]) expect(resolveQuestAction(PAINT, w as never, null)).toMatchObject({ kind: 'blocked', code: 'invalid' });
    const throwing = { ...fakeWorld([{ id: 'o1', x: 2, z: 2 }]), menu: () => { throw new Error('boom'); } };
    expect(resolveQuestAction(PAINT, throwing, 'a1').kind).toBe('blocked');
    const nonArray = { ...fakeWorld([{ id: 'o1', x: 2, z: 2 }]), menu: () => 'nope' as never };
    expect(resolveQuestAction(PAINT, nonArray, 'a1').kind).toBe('blocked');
    for (const sel of [42, {}, 'ghost', '__proto__'] as unknown[]) expect(QUEST_ACTION_KINDS).toContain(resolveQuestAction(PAINT, sim, sel as never).kind);
    const broken = { ...sim, state: { ...sim.state, agents: null, objects: 'x', household: { memberIds: ['a1', null, 5] } } } as unknown as QuestWorldView;
    expect(QUEST_ACTION_KINDS).toContain(resolveQuestAction(PAINT, broken, null).kind);
  });

  it('fuzz: random objectives on a real world always give a known kind with text', () => {
    const sim = world();
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const kinds = ['interaction', 'event', 'stat', 'skill', 'friends', 'career', 'own', 'roomEnv', 'days', 'billsOnTime', 'funds', 'walls', 'bogus', 7, null];
    const vals = [undefined, null, 1, -3, 'cook', ['eat'], ['home_read', 5], { recipe: 'x' }, NaN, 'skillUp', 'mealsCooked'];
    for (let i = 0; i < 400; i++) {
      const o: Record<string, unknown> = { kind: kinds[Math.floor(rnd() * kinds.length)] };
      for (const k of ['ids', 'tags', 'key', 'count', 'event', 'skill', 'match', 'targetTags', 'atLeast', 'level', 'defIds']) if (rnd() < 0.4) o[k] = vals[Math.floor(rnd() * vals.length)];
      const a = resolveQuestAction({ objective: o as never }, sim, rnd() < 0.5 ? sim.state.household.memberIds[0] : null);
      expect(QUEST_ACTION_KINDS).toContain(a.kind);
      if (a.kind === 'blocked') expect(a.reason.length).toBeGreaterThan(0);
      expect(kindOf(a)).toBeTruthy();
    }
  });
});
