/**
 * Adversarial interleavings between the BuildService and an engine-faithful context (fixtures makeEngineLikeCtx):
 * interrupts that defer through an 'exit' phase, end() hooks that set carried items down mid-command, removal reasons
 * that reach the player, items placed on surfaces outside the history, corrupt duplicates and reordered snapshots.
 * Every scenario here failed against the original implementation.
 */
import { describe, expect, it } from 'vitest';
import { createBuildService } from '../../../src/sim/spatial';
import type { AgentState, ObjectState, WorldState } from '../../../src/sim/types';
import type { BuildCommand } from '../../../src/sim/contracts';
import {
  addAgent,
  addFloor,
  addLoose,
  addObj,
  addWall,
  addWalls,
  blankLot,
  buildInvariantViolations,
  fakeRun,
  makeContent,
  makeEngineLikeCtx,
  makeWorld,
  structural,
  testRng,
  type EngineLikeCtx,
} from './fixtures';
import { rectEdges, normalizeEdge } from '../../../src/sim/spatial';

/** end() hook like the engine's releaseHeld(agent, 'surface'): a carried item goes onto the nearest free surface. */
function setDownCarried(agent: AgentState, ctx: EngineLikeCtx): void {
  const id = agent.carryObjectId;
  if (!id) return;
  agent.carryObjectId = null;
  const obj = ctx.state.objects[id];
  if (!obj) return;
  const s = ctx.spatial.freeSurfaceNear(agent.pos, 3, null);
  obj.placement = s
    ? { kind: 'loose', x: s.x, z: s.z, y: s.y, parentId: s.objectId, surfaceIndex: s.index, facing: 0 }
    : { kind: 'loose', x: agent.pos.x, z: agent.pos.z, y: 0, parentId: null, surfaceIndex: null, facing: 0 };
}

function setup(funds = 100000, content = makeContent()) {
  const state = makeWorld(blankLot(), funds);
  const ctx = makeEngineLikeCtx(state, content, setDownCarried);
  const B = createBuildService(ctx);
  return { state, ctx, B, S: ctx.spatial };
}

function carrying(state: WorldState, agent: AgentState, defId: string): ObjectState {
  const o = addObj(state, defId, { kind: 'held', agentId: agent.id });
  agent.carryObjectId = o.id;
  return o;
}

describe('move vs engine interrupt semantics', () => {
  it('a plate an end() hook sets down on the table being moved rides along with it (never floats)', () => {
    const { state, B, S } = setup();
    const table = addFloor(state, 'table_wake', 10, 10, 0, { value: 340 });
    const meal = addLoose(state, 'item_meal', 10.5, 10.5, { parentId: table.id, surfaceIndex: 0, y: 0.76 });
    const a = addAgent(state, 'a1', 12.5, 10.5, { active: fakeRun('route', meal.id, 0) });
    meal.reservedBy = { '0': a.id };
    const dish = carrying(state, a, 'item_dish');

    expect(B.apply({ type: 'move', objectId: table.id, x: 4, z: 4, rot: 1 }).ok).toBe(true);
    const dp = state.objects[dish.id].placement;
    expect(dp).toMatchObject({ kind: 'loose', parentId: table.id, surfaceIndex: 1 });
    expect(buildInvariantViolations(state, S)).toEqual([]);

    expect(B.undo()).toBe(true);
    expect(state.objects[table.id].placement).toEqual({ kind: 'floor', x: 10, z: 10, rot: 0 });
    expect(buildInvariantViolations(state, S)).toEqual([]);
    expect(B.redo()).toBe(true);
    expect(buildInvariantViolations(state, S)).toEqual([]);
  });

  it('a seated (run-phase) user keeps its slot until the engine walks it out; a routing user loses its slot', () => {
    const { state, ctx, B, S } = setup();
    const sofa = addFloor(state, 'sofa_moldy', 6, 6, 0, { value: 320 });
    const sitter = addAgent(state, 'a1', 6.55, 6.5, { posY: 0.46, active: fakeRun('run', sofa.id, 0) });
    const walker = addAgent(state, 'a2', 12.5, 12.5, { active: fakeRun('route', sofa.id, 1) });
    sofa.reservedBy = { '0': sitter.id, '1': walker.id };
    sofa.inUseBy = [sitter.id];

    expect(B.apply({ type: 'move', objectId: sofa.id, x: 14, z: 6, rot: 0 }).ok).toBe(true);
    expect(ctx.interrupts.map((i) => i.agentId).sort()).toEqual(['a1', 'a2']);
    expect(sitter.active?.phase).toBe('exit');
    expect(walker.active).toBeNull();
    expect(state.objects[sofa.id].reservedBy).toEqual({ '0': 'a1' }); // released by the engine when the exit ends
    expect(state.objects[sofa.id].inUseBy).toEqual([]);
    expect(buildInvariantViolations(state, S)).toEqual([]);
  });

  it('agents walking to a slot-less object (stage target only, no reservation) are interrupted when it moves', () => {
    const { state, ctx, B } = setup();
    const table = addFloor(state, 'table_rickety', 6, 6, 0);
    addAgent(state, 'a1', 12.5, 12.5, { active: fakeRun('route', table.id, null) });
    expect(B.apply({ type: 'move', objectId: table.id, x: 9, z: 9, rot: 0 }).ok).toBe(true);
    expect(ctx.interrupts.map((i) => i.agentId)).toEqual(['a1']);
    expect(state.agents.a1.active).toBeNull();
  });

  it('a child whose position is corrupt (NaN) lands on the moved surface instead of being left behind', () => {
    const { state, B, S } = setup();
    const table = addFloor(state, 'table_wake', 5, 5, 0);
    const bad = addLoose(state, 'item_dish', NaN, NaN, { parentId: table.id, surfaceIndex: null, y: 0.76 });
    expect(B.apply({ type: 'move', objectId: table.id, x: 12, z: 12, rot: 2 }).ok).toBe(true);
    const p = state.objects[bad.id].placement;
    if (p.kind !== 'loose') throw new Error('not loose');
    const pts = S.surfacePoints(state.objects[table.id]);
    expect(pts.some((q) => Math.abs(q.x - p.x) < 1e-9 && Math.abs(q.z - p.z) < 1e-9)).toBe(true);
    expect(p.parentId).toBe(table.id);
  });
});

describe('sell / demolish vs engine semantics', () => {
  it('removal reasons reaching the player are sentences ("…was sold"), never internal codes', () => {
    const { state, ctx, B } = setup();
    const shower = addFloor(state, 'shower_drizzle', 5, 5, 0, { value: 350 });
    addAgent(state, 'a1', 5.5, 5.5, { active: fakeRun('run', shower.id, 0) });
    shower.reservedBy = { '0': 'a1' };
    expect(B.apply({ type: 'sell', objectId: shower.id }).ok).toBe(true);
    expect(ctx.failures).toEqual([{ agentId: 'a1', reason: 'The drizzle shower was sold' }]);

    addWalls(state, ['h:10:10']);
    const door = addObj(state, 'door_splintered', { kind: 'opening', edge: 'h:10:10' }, { value: 120 });
    addAgent(state, 'a2', 10.5, 10.5, { active: fakeRun('run', door.id, null) }); // mid-slam: exit phase, then failed by removal
    addAgent(state, 'a4', 10.5, 11.5, { active: fakeRun('route', door.id, null) }); // walking there: gracefully cancelled
    expect(B.apply({ type: 'removeWalls', edges: ['h:10:10'] }).ok).toBe(true);
    expect(ctx.failures[1]).toEqual({ agentId: 'a2', reason: 'The splintered door came down with the wall' });
    expect(ctx.failures.some((f) => f.agentId === 'a4')).toBe(false);
    expect(state.agents.a4.active).toBeNull();

    const r = B.apply({ type: 'buy', defId: 'chair_creaky', x: 3, z: 3, rot: 0 });
    addAgent(state, 'a3', 3.5, 4.5, { active: fakeRun('run', r.objectId!, 0) });
    state.objects[r.objectId!].reservedBy = { '0': 'a3' };
    expect(B.undo()).toBe(true);
    expect(ctx.failures[2]).toEqual({ agentId: 'a3', reason: 'The creaky dining chair was removed' });

    for (const rm of ctx.removals) {
      expect(rm.reason, `removal of ${rm.id}`).toMatch(/^The .+ (was sold|was removed|came down with the wall)$/);
    }
  });

  it('interrupts users before taking items off: a plate an end() hook sets down on the sold table is dropped too', () => {
    const { state, B, S } = setup(1000);
    const table = addFloor(state, 'table_wake', 8, 8, 0, { value: 340 });
    const meal = addLoose(state, 'item_meal', 8.5, 8.5, { parentId: table.id, surfaceIndex: 0, y: 0.76 });
    const a = addAgent(state, 'a1', 10.5, 8.5, { active: fakeRun('route', meal.id, 0) });
    meal.reservedBy = { '0': a.id };
    const dish = carrying(state, a, 'item_dish');
    const before = Object.values(state.objects).filter((o) => o.defId === 'item_dish').length;

    expect(B.apply({ type: 'sell', objectId: table.id }).ok).toBe(true);
    expect(Object.values(state.objects).filter((o) => o.defId === 'item_dish').length).toBe(before); // neither lost nor duplicated
    for (const o of Object.values(state.objects)) {
      if (o.placement.kind === 'loose') expect(o.placement.parentId, `${o.id} still on the sold table`).not.toBe(table.id);
    }
    expect(buildInvariantViolations(state, S)).toEqual([]);

    expect(B.undo()).toBe(true);
    expect(state.objects[table.id]).toBeDefined();
    expect(state.objects[dish.id]?.placement).toMatchObject({ kind: 'loose', parentId: table.id });
    expect(buildInvariantViolations(state, S)).toEqual([]);
    expect(B.redo()).toBe(true);
    expect(buildInvariantViolations(state, S)).toEqual([]);
  });
});

describe('undo / redo of moves keep surfaces and users consistent', () => {
  it('an item set on the moved table after the move rides back on undo and forward again on redo', () => {
    const { state, B, S } = setup();
    const table = addFloor(state, 'table_wake', 5, 5, 0, { value: 340 });
    expect(B.apply({ type: 'move', objectId: table.id, x: 12, z: 9, rot: 1 }).ok).toBe(true);
    const pt = S.surfacePoints(state.objects[table.id])[1];
    const late = addLoose(state, 'item_dish', pt.x, pt.z, { parentId: table.id, surfaceIndex: 1, y: pt.y });

    expect(B.undo()).toBe(true);
    expect(buildInvariantViolations(state, S)).toEqual([]);
    expect(state.objects[late.id].placement).toMatchObject({ x: 6.5, z: 5.5, parentId: table.id, surfaceIndex: 1 });
    expect(B.redo()).toBe(true);
    expect(buildInvariantViolations(state, S)).toEqual([]);
    expect(state.objects[late.id].placement).toMatchObject({ x: pt.x, z: pt.z });
  });

  it('a tracked plate that diverged (moved to the other surface of the same table) still follows the table', () => {
    const { state, B, S } = setup();
    const table = addFloor(state, 'table_wake', 5, 5, 0);
    const plate = addLoose(state, 'item_meal', 5.5, 5.5, { parentId: table.id, surfaceIndex: 0, y: 0.76 });
    expect(B.apply({ type: 'move', objectId: table.id, x: 10, z: 10, rot: 0 }).ok).toBe(true);
    plate.placement = { kind: 'loose', x: 11.5, z: 10.5, y: 0.76, parentId: table.id, surfaceIndex: 1, facing: 0 };
    expect(B.undo()).toBe(true);
    expect(state.objects[table.id].placement).toEqual({ kind: 'floor', x: 5, z: 5, rot: 0 });
    expect(state.objects[plate.id].placement).toMatchObject({ x: 6.5, z: 5.5, surfaceIndex: 1 });
    expect(buildInvariantViolations(state, S)).toEqual([]);
  });

  it('undo / redo of a move interrupts whoever started using the object in between', () => {
    const { state, ctx, B, S } = setup();
    const chair = addFloor(state, 'chair_creaky', 5, 5, 0);
    expect(B.apply({ type: 'move', objectId: chair.id, x: 9, z: 9, rot: 0 }).ok).toBe(true);
    const a = addAgent(state, 'a1', 9.5, 9.5, { posY: 0.46, active: fakeRun('run', chair.id, 0) });
    chair.reservedBy = { '0': a.id };
    chair.inUseBy = [a.id];
    expect(B.undo()).toBe(true);
    expect(ctx.interrupts.map((i) => i.agentId)).toEqual(['a1']);
    expect(a.active?.phase).toBe('exit');
    expect(state.objects[chair.id].inUseBy).toEqual([]);
    expect(buildInvariantViolations(state, S)).toEqual([]);
  });

  it('moving a wall item carries what rests on its surfaces (wall shelves) and undo brings it back', () => {
    const content = makeContent((o) => {
      o.sconce_candle = { ...o.sconce_candle, surfaces: [{ x: 0.5, z: 0.2, y: 1.3 }] };
    });
    const { state, B, S } = setup(100000, content);
    addWalls(state, ['h:5:5', 'v:12:8']);
    const r = B.apply({ type: 'buyWallItem', defId: 'sconce_candle', edge: 'h:5:5', side: 1 });
    expect(r.ok).toBe(true);
    const shelf = state.objects[r.objectId!];
    const p0 = S.surfacePoints(shelf)[0];
    const item = addLoose(state, 'item_urn', p0.x, p0.z, { parentId: shelf.id, surfaceIndex: 0, y: p0.y });
    expect(B.apply({ type: 'moveWallItem', objectId: shelf.id, edge: 'v:12:8', side: 0 }).ok).toBe(true);
    expect(buildInvariantViolations(state, S)).toEqual([]);
    const moved = state.objects[item.id].placement;
    expect(moved).toMatchObject({ parentId: shelf.id, y: 1.3 });
    expect(B.undo()).toBe(true);
    expect(state.objects[item.id].placement).toMatchObject({ x: p0.x, z: p0.z });
    expect(buildInvariantViolations(state, S)).toEqual([]);
  });
});

describe('preview mirrors placement warnings', () => {
  it('reports blockedSlots for buy / move / buyWallItem / moveWallItem exactly like the spatial checks', () => {
    const { state, B, S } = setup();
    addFloor(state, 'counter_butcher', 5, 6, 0); // right in front of a fridge at (5,5) rot 0
    const buy: BuildCommand = { type: 'buy', defId: 'fridge_humming', x: 5, z: 5, rot: 0 };
    expect(S.checkPlace('fridge_humming', 5, 5, 0).blockedSlots).toEqual([0]);
    expect(B.preview(buy)).toMatchObject({ ok: true, blockedSlots: [0] });
    expect(B.preview({ ...buy, x: 9 })).toMatchObject({ ok: true, blockedSlots: [] });
    const fridge = state.objects[B.apply({ ...buy, x: 9 }).objectId!];
    expect(B.preview({ type: 'move', objectId: fridge.id, x: 5, z: 5, rot: 0 })).toMatchObject({ ok: true, blockedSlots: [0] });

    addWalls(state, ['h:14:14', 'h:16:14']);
    addFloor(state, 'chair_creaky', 14, 14, 0); // stands where you would admire a painting on h:14:14 side 1
    expect(B.preview({ type: 'buyWallItem', defId: 'painting_greatgrand', edge: 'h:14:14', side: 1 })).toMatchObject({ ok: true, blockedSlots: [0] });
    const painting = B.apply({ type: 'buyWallItem', defId: 'painting_greatgrand', edge: 'h:16:14', side: 1 });
    expect(B.preview({ type: 'moveWallItem', objectId: painting.objectId!, edge: 'h:14:14', side: 1 })).toMatchObject({ ok: true, blockedSlots: [0] });
    expect(B.preview({ type: 'moveWallItem', objectId: painting.objectId!, edge: 'h:14:14', side: 0 })).toMatchObject({ ok: true, blockedSlots: [] });
  });
});

describe('corrupt walls and snapshots', () => {
  it('removing a wall removes EVERY opening on it and every raw key naming it; a rebuilt wall is solid', () => {
    const { state, B, S } = setup(0);
    addWall(state, 'h:5:5');
    state.lot.walls['h:05:5'] = { paint: ['wall_plaster_bone', 'wall_plaster_bone'], openingId: null }; // duplicate raw key
    addObj(state, 'door_splintered', { kind: 'opening', edge: 'h:5:5' }, { value: 120 });
    addObj(state, 'door_splintered', { kind: 'opening', edge: 'h:05:5' }, { value: 120 });
    state.lot.version++;
    const before = structural(state);
    const r = B.apply({ type: 'removeWalls', edges: ['h:5:5'] });
    expect(r).toMatchObject({ ok: true, cost: -(10 + 102 + 102) }); // one segment + both doors at 0.15 depreciation
    expect(Object.keys(state.lot.walls).filter((k) => normalizeEdge(k) === 'h:5:5')).toEqual([]);
    expect(Object.values(state.objects).filter((o) => o.placement.kind === 'opening')).toEqual([]);
    expect(B.apply({ type: 'addWalls', edges: ['h:5:5'] }).ok).toBe(true);
    expect(S.canStep(5, 4, 5, 5)).toBe(false); // no orphaned door resurrected by the new wall
    expect(B.undo()).toBe(true);
    expect(B.undo()).toBe(true);
    expect(structural(state)).toEqual(before);
  });

  it('a writer that rebuilds a wall record or placement with reordered keys is not "divergence"', () => {
    const { state, B } = setup();
    expect(B.apply({ type: 'addWalls', edges: ['h:5:5'] }).ok).toBe(true);
    const seg = state.lot.walls['h:5:5'];
    state.lot.walls['h:5:5'] = { openingId: seg.openingId, paint: [seg.paint[0], seg.paint[1]] } as typeof seg;
    const sofa = state.objects[B.apply({ type: 'buy', defId: 'sofa_moldy', x: 8, z: 8, rot: 1 }).objectId!];
    sofa.placement = { rot: 1, z: 8, x: 8, kind: 'floor' } as typeof sofa.placement;
    expect(B.undo()).toBe(true);
    expect(B.undo()).toBe(true);
    expect(state.lot.walls['h:5:5']).toBeUndefined();
  });

  it('room / floor commands tolerate a missing floors array (corrupt save) instead of failing', () => {
    const { state, B } = setup();
    (state.lot as { floors: unknown }).floors = undefined;
    expect(B.apply({ type: 'floor', x0: 2, z0: 2, x1: 4, z1: 3, styleId: 'floor_planks_worn' })).toMatchObject({ ok: true, cost: 10 });
    expect(state.lot.floors[2 * 30 + 3]).toBe('floor_planks_worn');
    expect(B.apply({ type: 'room', x0: 6, z0: 6, x1: 8, z1: 8 }).ok).toBe(true);
    expect(B.undo()).toBe(true);
    expect(B.undo()).toBe(true);
    expect(state.lot.floors[2 * 30 + 3] ?? null).toBeNull();
  });
});

describe('relocation', () => {
  it('a posed agent waiting (wait phase) on a newly blocked tile is moved out and interrupted', () => {
    const { state, ctx, B, S } = setup();
    const target = addFloor(state, 'chair_creaky', 2, 2, 0);
    const a = addAgent(state, 'a1', 7.5, 7.5, { active: fakeRun('wait', target.id, null) });
    expect(B.apply({ type: 'buy', defId: 'counter_butcher', x: 7, z: 7, rot: 0 }).ok).toBe(true);
    expect(S.isWalkable(Math.floor(a.pos.x), Math.floor(a.pos.z))).toBe(true);
    expect(ctx.interrupts.map((i) => i.agentId)).toEqual(['a1']);
  });
});

// ───────────────────────────── randomized sessions against engine semantics ─────────────────────────────

const FURNITURE = ['table_wake', 'table_rickety', 'counter_butcher', 'sofa_moldy', 'chair_creaky', 'table_coffinlid', 'shower_drizzle'];

function engineWorld(seed: number) {
  const state = makeWorld(blankLot(), 50000);
  const ctx = makeEngineLikeCtx(state, makeContent(), setDownCarried);
  const B = createBuildService(ctx);
  const rng = testRng(seed);
  addWalls(state, rectEdges(3, 3, 9, 8));
  addObj(state, 'door_splintered', { kind: 'opening', edge: 'h:5:8' }, { value: 120 });
  for (let i = 0; i < 9; i++) {
    const defId = FURNITURE[i % FURNITURE.length];
    const r = B.apply({ type: 'buy', defId, x: rng.int(1, 26), z: rng.int(1, 24), rot: rng.int(0, 3) as 0 });
    if (r.ok && ctx.spatial.surfacePoints(state.objects[r.objectId!]).length > 0) {
      const pt = ctx.spatial.surfacePoints(state.objects[r.objectId!])[0];
      addLoose(state, rng.chance(0.5) ? 'item_meal' : 'item_dish', pt.x, pt.z, { parentId: r.objectId!, surfaceIndex: pt.index, y: pt.y });
    }
  }
  for (let i = 0; i < 5; i++) addAgent(state, `a${i}`, rng.int(1, 27) + 0.5, rng.int(1, 25) + 0.5);
  B.clearHistory();
  return { state, ctx, B, S: ctx.spatial, rng };
}

/** Gameplay between build steps: idle agents start using a free slot (reserving it) and may pick up an item. */
function gameplay(state: WorldState, ctx: EngineLikeCtx, rng: ReturnType<typeof testRng>): void {
  const objs = Object.values(state.objects).filter((o) => o.placement.kind === 'floor' || o.placement.kind === 'loose');
  for (const a of Object.values(state.agents)) {
    if (a.active || !rng.chance(0.5) || objs.length === 0) continue;
    const o = objs[rng.int(0, objs.length - 1)];
    const slots = ctx.spatial.resolveSlots(o);
    const free = slots.find((s) => o.reservedBy[String(s.index)] === undefined);
    const phase = (['route', 'wait', 'run'] as const)[rng.int(0, 2)];
    a.active = fakeRun(phase, o.id, free ? free.index : null);
    if (free) o.reservedBy[String(free.index)] = a.id;
    if (phase === 'run') o.inUseBy.push(a.id);
    if (!a.carryObjectId && rng.chance(0.3)) {
      const item = Object.values(state.objects).find((x) => x.placement.kind === 'loose' && x.id !== o.id);
      if (item) {
        item.placement = { kind: 'held', agentId: a.id };
        a.carryObjectId = item.id;
      }
    }
  }
  // the engine eventually walks exiting agents out
  for (const a of Object.values(state.agents)) {
    if (a.active && a.active.phase === 'exit' && rng.chance(0.5)) {
      for (const o of Object.values(state.objects)) {
        for (const [k, v] of Object.entries(o.reservedBy)) if (v === a.id) delete o.reservedBy[k];
      }
      a.active = null;
    }
  }
}

function randomCommand(state: WorldState, rng: ReturnType<typeof testRng>): BuildCommand {
  const floor = Object.values(state.objects).filter((o) => o.placement.kind === 'floor');
  const pick = <T,>(a: T[]): T | undefined => (a.length ? a[rng.int(0, a.length - 1)] : undefined);
  const roll = rng.int(0, 5);
  if (roll <= 2) {
    const o = pick(floor);
    return { type: 'move', objectId: o ? o.id : 'o404', x: rng.int(1, 26), z: rng.int(1, 24), rot: rng.int(0, 3) as 0 };
  }
  if (roll === 3) {
    const o = pick(floor);
    return { type: 'sell', objectId: o ? o.id : 'o404' };
  }
  if (roll === 4) return { type: 'buy', defId: pick(FURNITURE)!, x: rng.int(1, 26), z: rng.int(1, 24), rot: rng.int(0, 3) as 0 };
  return { type: 'removeWalls', edges: [pick(Object.keys(state.lot.walls)) ?? 'h:3:3'] };
}

describe('randomized sessions with engine-faithful interrupts', () => {
  for (const seed of [11, 12, 13, 14]) {
    it(`seed ${seed}: no floating items, no stale or missing reservations, exact money after every step`, () => {
      const { state, ctx, B, S, rng } = engineWorld(seed);
      let applied = 0;
      for (let step = 0; step < 120; step++) {
        gameplay(state, ctx, rng);
        const where = `seed ${seed} step ${step}`;
        const roll = rng.next();
        const funds = state.household.funds;
        if (roll < 0.15) B.undo();
        else if (roll < 0.25) B.redo();
        else {
          const cmd = randomCommand(state, rng);
          const r = B.apply(cmd);
          if (r.ok) applied++;
          expect(state.household.funds, `${where} money for ${JSON.stringify(cmd)}`).toBe(r.ok ? funds - r.cost : funds);
        }
        expect(buildInvariantViolations(state, S), where).toEqual([]);
        expect(S.debugFaults(), where).toEqual([]);
        for (const r of ctx.removals) expect(r.reason ?? '', where).toMatch(/^The .+ (was sold|was removed|came down with the wall)$/);
      }
      expect(applied).toBeGreaterThan(15);
    });
  }
});

describe('fault containment of the new paths', () => {
  it('a throwing ctx.interrupt aborts the move atomically (rolled back, nothing charged, no history)', () => {
    const { state, ctx, B } = setup(500);
    const chair = addFloor(state, 'chair_creaky', 5, 5, 0, { reservedBy: { '0': 'a1' } });
    addAgent(state, 'a1', 5.5, 6.5, { active: fakeRun('route', chair.id, 0) });
    const snap = structural(state);
    ctx.interrupt = () => {
      throw new Error('engine bug');
    };
    expect(B.apply({ type: 'move', objectId: chair.id, x: 9, z: 9, rot: 0 })).toMatchObject({ ok: false, reason: "Couldn't build that" });
    expect(structural(state)).toEqual(snap);
    expect(B.canUndo()).toBe(false);
  });

  it('a throwing interrupt during undo of a move is contained: the undo still completes', () => {
    const { state, ctx, B } = setup();
    const chair = addFloor(state, 'chair_creaky', 5, 5, 0);
    expect(B.apply({ type: 'move', objectId: chair.id, x: 9, z: 9, rot: 0 }).ok).toBe(true);
    addAgent(state, 'a1', 9.5, 9.5, { active: fakeRun('run', chair.id, 0) });
    chair.reservedBy = { '0': 'a1' };
    ctx.interrupt = () => {
      throw new Error('engine bug');
    };
    expect(B.undo()).toBe(true);
    expect(state.objects[chair.id].placement).toEqual({ kind: 'floor', x: 5, z: 5, rot: 0 });
    expect(B.canRedo()).toBe(true);
  });

  it('a commit that throws (cache invalidation fails) still records history and keeps money exact', () => {
    const { state, ctx, B } = setup(1000);
    const real = ctx.spatial.invalidate.bind(ctx.spatial);
    let broken = true;
    ctx.spatial.invalidate = () => {
      if (broken) throw new Error('cache bug');
      real();
    };
    const r = B.apply({ type: 'buy', defId: 'chair_creaky', x: 4, z: 4, rot: 0 });
    expect(r.ok).toBe(true);
    expect(state.household.funds).toBe(940);
    expect(B.canUndo()).toBe(true);
    broken = false;
    expect(B.undo()).toBe(true);
    expect(state.household.funds).toBe(1000);
    expect(state.objects[r.objectId!]).toBeUndefined();
  });

  it('a conflict check that throws reverts the undo, returns the money and clears history', () => {
    const { state, ctx, B } = setup(1000);
    const sofa = addFloor(state, 'sofa_moldy', 5, 5, 0, { value: 320 });
    expect(B.apply({ type: 'sell', objectId: sofa.id }).ok).toBe(true);
    const funds = state.household.funds;
    const snap = structural(state);
    ctx.spatial.invalidate = () => {
      throw new Error('cache bug'); // restoredConflicts calls it while verifying the restored sofa
    };
    addLoose(state, 'item_dish', 5.5, 5.5); // forces the nudge path inside the conflict check
    const withDish = structural(state);
    expect(B.undo()).toBe(false);
    expect(state.household.funds).toBe(funds);
    expect(state.objects[sofa.id]).toBeUndefined();
    expect(structural(state)).toEqual(withDish);
    expect(B.canUndo()).toBe(false);
    void snap;
  });
});

describe('hostile identifiers and re-entrancy', () => {
  const PROTO_KEYS = ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty'];

  it('style ids naming Object.prototype members are "Unknown style": never free, never NaN, never persisted', () => {
    const { state, B } = setup(1000);
    addWall(state, 'h:9:9');
    for (const k of PROTO_KEYS) {
      const cmds: BuildCommand[] = [
        { type: 'addWalls', edges: ['h:5:5'], style: k },
        { type: 'room', x0: 12, z0: 12, x1: 14, z1: 14, floor: k },
        { type: 'room', x0: 12, z0: 12, x1: 14, z1: 14, wallStyle: k },
        { type: 'floor', x0: 2, z0: 2, x1: 4, z1: 4, styleId: k },
        { type: 'paintWall', edge: 'h:9:9', side: 0, styleId: k },
        { type: 'paintRoom', x: 2, z: 2, styleId: k },
      ];
      for (const cmd of cmds) {
        const snap = structural(state);
        const pv = B.preview(cmd);
        const r = B.apply(cmd);
        expect(r, `${k}: ${JSON.stringify(cmd)}`).toMatchObject({ ok: false, reason: 'Unknown style', cost: 0 });
        expect(pv.ok).toBe(false);
        expect(Number.isFinite(pv.cost)).toBe(true);
        expect(structural(state)).toEqual(snap);
      }
    }
    expect(state.household.funds).toBe(1000);
    expect(B.canUndo()).toBe(false);
  });

  it('object ids and reservations naming Object.prototype members are "gone" / ignored, never interrupted', () => {
    const { state, ctx, B } = setup();
    for (const k of PROTO_KEYS) {
      for (const cmd of [
        { type: 'move', objectId: k, x: 5, z: 5, rot: 0 },
        { type: 'moveWallItem', objectId: k, edge: 'h:5:5', side: 0 },
        { type: 'moveOpening', objectId: k, edge: 'h:5:5' },
        { type: 'sell', objectId: k },
      ] as BuildCommand[]) {
        expect(B.apply(cmd), `${k}: ${cmd.type}`).toMatchObject({ ok: false, reason: "That's no longer here" });
      }
    }
    const chair = addFloor(state, 'chair_creaky', 5, 5, 0, { reservedBy: { '0': '__proto__', '1': 'constructor' }, inUseBy: ['__proto__'] });
    expect(B.apply({ type: 'move', objectId: chair.id, x: 8, z: 8, rot: 0 }).ok).toBe(true);
    expect(ctx.interrupts).toEqual([]);
    expect(state.objects[chair.id].reservedBy).toEqual({});
    expect(({} as Record<string, unknown>).active).toBeUndefined(); // nothing was written onto Object.prototype
  });

  it('a build command dispatched from inside another one (engine hook) is refused; the outer one completes exactly', () => {
    const { state, ctx, B } = setup(1000);
    const chair = addFloor(state, 'chair_creaky', 5, 5, 0);
    addAgent(state, 'a1', 5.5, 6.5, { active: fakeRun('route', chair.id, 0) });
    chair.reservedBy = { '0': 'a1' };
    const start = structural(state);
    const nested: unknown[] = [];
    const orig = ctx.interrupt;
    ctx.interrupt = (agent, reason) => {
      orig(agent, reason);
      nested.push(B.apply({ type: 'buy', defId: 'lamp_skull', x: 9, z: 9, rot: 0 }), B.undo(), B.redo());
    };
    expect(B.apply({ type: 'move', objectId: chair.id, x: 12, z: 12, rot: 0 }).ok).toBe(true);
    expect(nested).toEqual([{ ok: false, reason: 'Still building — try again', cost: 0 }, false, false]);
    expect(state.household.funds).toBe(1000);
    ctx.interrupt = orig;
    expect(B.undo()).toBe(true);
    expect(B.canUndo()).toBe(false);
    expect(structural(state)).toEqual(start);
    expect(B.preview({ type: 'buy', defId: 'lamp_skull', x: 9, z: 9, rot: 0 }).ok).toBe(true); // guard released
  });
});

describe('objects destroyed by an end() hook mid-command', () => {
  it('move / sell abort atomically when an interrupted run destroys the object itself', () => {
    for (const cmdOf of [(id: string): BuildCommand => ({ type: 'move', objectId: id, x: 12, z: 12, rot: 0 }), (id: string): BuildCommand => ({ type: 'sell', objectId: id })]) {
      const state = makeWorld(blankLot(), 1000);
      const ctx = makeEngineLikeCtx(state, makeContent(), (agent, c) => {
        // e.g. a behaviour that consumes its own target in end() (decision #5: self-consuming runs)
        if (c.state.objects.o1) c.removeObject('o1', 'consumed');
      });
      const B = createBuildService(ctx);
      const chair = addFloor(state, 'chair_creaky', 5, 5, 0, { id: 'o1', value: 60 } as Partial<ObjectState>);
      addAgent(state, 'a1', 5.5, 6.5, { active: fakeRun('route', chair.id, 0) });
      chair.reservedBy = { '0': 'a1' };
      const r = B.apply(cmdOf(chair.id));
      expect(r).toMatchObject({ ok: false, reason: "Couldn't build that" });
      expect(state.household.funds).toBe(1000);
      expect(B.canUndo()).toBe(false);
      expect(buildInvariantViolations(state, ctx.spatial)).toEqual([]);
    }
  });
});
