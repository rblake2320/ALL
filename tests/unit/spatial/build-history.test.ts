import { describe, expect, it } from 'vitest';
import { createBuildService, normalizeEdge, rectEdges, type SpatialService } from '../../../src/sim/spatial';
import type { BuildCommand, BuildService } from '../../../src/sim/contracts';
import type { WorldState } from '../../../src/sim/types';
import { WALL_STYLES, FLOOR_STYLES } from '../../../src/shared/styles';
import { PHYSICAL_BY_ID } from '../../../src/shared/catalog';
import { specOf } from '../../../src/sim/spatial/defs';
import { floorFrame } from '../../../src/sim/spatial/grid';
import { frameSize, frameTiles } from '../../../src/sim/spatial/geometry';
import { addAgent, addFloor, addLoose, addObj, addWalls, blankLot, makeContent, makeCtx, makeWorld, structural, testRng } from './fixtures';

function world(funds = 10000) {
  const state = makeWorld(blankLot(), funds);
  const ctx = makeCtx(state);
  const B = createBuildService(ctx);
  return { state, ctx, B, S: ctx.spatial };
}

describe('undo / redo semantics', () => {
  it('undo/redo with empty stacks return false and change nothing (idempotent)', () => {
    const { state, B } = world();
    const snap = JSON.stringify(state);
    expect(B.undo()).toBe(false);
    expect(B.redo()).toBe(false);
    expect(B.canUndo() || B.canRedo()).toBe(false);
    expect(JSON.stringify(state)).toBe(snap);
    B.apply({ type: 'buy', defId: 'chair_creaky', x: 5, z: 5, rot: 0 });
    expect(B.undo()).toBe(true);
    const afterUndo = JSON.stringify(structural(state));
    expect(B.undo()).toBe(false);
    expect(JSON.stringify(structural(state))).toBe(afterUndo);
    expect(B.redo()).toBe(true);
    expect(B.redo()).toBe(false);
  });

  it('undo then redo is the identity on state and funds; a new apply clears the redo stack', () => {
    const { state, B } = world(5000);
    B.apply({ type: 'room', x0: 4, z0: 4, x1: 8, z1: 7, floor: 'floor_parquet', wallStyle: 'wall_damask_crimson' });
    B.apply({ type: 'buy', defId: 'sofa_velvet', x: 5, z: 5, rot: 0 });
    const snap = structural(state);
    expect(B.undo() && B.redo()).toBe(true);
    expect(structural(state)).toEqual(snap);
    expect(B.undo()).toBe(true);
    expect(B.canRedo()).toBe(true);
    B.apply({ type: 'buy', defId: 'chair_creaky', x: 10, z: 10, rot: 0 });
    expect(B.canRedo()).toBe(false);
    expect(B.redo()).toBe(false);
  });

  it('clearHistory forgets everything (leaving build mode)', () => {
    const { B } = world();
    B.apply({ type: 'buy', defId: 'chair_creaky', x: 5, z: 5, rot: 0 });
    B.apply({ type: 'buy', defId: 'chair_creaky', x: 6, z: 5, rot: 0 });
    B.undo();
    B.clearHistory();
    expect(B.canUndo() || B.canRedo()).toBe(false);
    expect(B.undo()).toBe(false);
  });

  it('undoing a sale needs the refund back: insufficient funds -> false, history kept, nothing changed', () => {
    const { state, B } = world(0);
    const sofa = addFloor(state, 'sofa_velvet', 5, 5, 0, { value: 780 });
    expect(B.apply({ type: 'sell', objectId: sofa.id })).toMatchObject({ ok: true, cost: -663 });
    state.household.funds = 600; // spent most of it on bills meanwhile
    const snap = JSON.stringify(state);
    expect(B.undo()).toBe(false);
    expect(JSON.stringify(state)).toBe(snap);
    expect(B.canUndo()).toBe(true);
    state.household.funds = 700;
    expect(B.undo()).toBe(true);
    expect(state.household.funds).toBe(37);
    expect(state.objects[sofa.id]).toBeDefined();
  });

  it('redo re-charges: insufficient funds -> false and nothing changes', () => {
    const { state, B } = world(400);
    B.apply({ type: 'buy', defId: 'tv_crt', x: 5, z: 5, rot: 0 });
    B.undo();
    state.household.funds = 10;
    const snap = JSON.stringify(state);
    expect(B.redo()).toBe(false);
    expect(JSON.stringify(state)).toBe(snap);
    expect(B.canRedo()).toBe(true);
  });

  it('a primary object changed outside the history -> undo refuses, clears history, refunds nothing', () => {
    const { state, B } = world(1000);
    const r = B.apply({ type: 'buy', defId: 'chair_creaky', x: 5, z: 5, rot: 0 });
    delete state.objects[r.objectId!]; // e.g. repossessed by the Repo Ghoul
    state.lot.version++;
    expect(B.undo()).toBe(false);
    expect(state.household.funds).toBe(940);
    expect(B.canUndo()).toBe(false);
  });

  it('a restore that would overlap something placed meanwhile is reverted (no overlapping furniture)', () => {
    const { state, B, S } = world(1000);
    const chair = addFloor(state, 'chair_creaky', 5, 5, 0, { value: 60 });
    B.apply({ type: 'sell', objectId: chair.id });
    addFloor(state, 'crate_prosthetic', 5, 5, 0); // gameplay spawned something on the spot
    const snap = structural(state);
    expect(B.undo()).toBe(false);
    expect(structural(state)).toEqual(snap);
    expect(S.objectsAt(5, 5).length).toBe(1);
    expect(B.canUndo()).toBe(false);
  });

  it('loose floor items inside a restored footprint are nudged out instead of blocking the undo', () => {
    const { state, B, S } = world(1000);
    const sofa = addFloor(state, 'sofa_moldy', 5, 5, 0, { value: 320 });
    B.apply({ type: 'sell', objectId: sofa.id });
    const limb = addLoose(state, 'item_limb_arm', 5.5, 5.5); // an arm fell off right there
    expect(B.undo()).toBe(true);
    const p = state.objects[limb.id].placement;
    if (p.kind !== 'loose') throw new Error();
    expect(S.isWalkable(Math.floor(p.x), Math.floor(p.z))).toBe(true);
  });

  it('dependent items that diverged are left alone (plate picked up, dropped copy eaten)', () => {
    const { state, B } = world(1000);
    addAgent(state, 'a1', 3.5, 3.5);
    const table = addFloor(state, 'table_rickety', 5, 5, 0, { value: 90 });
    const plate = addLoose(state, 'item_meal', 5.5, 5.5, { parentId: table.id, surfaceIndex: 0, y: 0.76 });
    B.apply({ type: 'move', objectId: table.id, x: 9, z: 9, rot: 0 });
    state.objects[plate.id].placement = { kind: 'held', agentId: 'a1' };
    expect(B.undo()).toBe(true);
    expect(state.objects[table.id].placement).toEqual({ kind: 'floor', x: 5, z: 5, rot: 0 });
    expect(state.objects[plate.id].placement).toEqual({ kind: 'held', agentId: 'a1' });

    const t2 = addFloor(state, 'table_rickety', 15, 15, 0, { value: 90 });
    const p2 = addLoose(state, 'item_dish', 15.5, 15.5, { parentId: t2.id, surfaceIndex: 0, y: 0.76 });
    B.apply({ type: 'sell', objectId: t2.id });
    const dropped = Object.values(state.objects).filter((o) => o.defId === 'item_dish');
    expect(dropped.length).toBe(1);
    delete state.objects[dropped[0].id]; // cleaned up by a zombie
    expect(B.undo()).toBe(true);
    expect(state.objects[t2.id]).toBeDefined();
    expect(state.objects[p2.id]).toBeUndefined(); // not resurrected: no duplication
    expect(Object.values(state.objects).filter((o) => o.defId === 'item_dish').length).toBe(0);
  });

  it('a replaced world state (load) drops the history', () => {
    const state = makeWorld(blankLot(), 1000);
    let current: WorldState = state;
    const base = makeCtx(state);
    const ctx = Object.create(base, { state: { get: () => current } });
    const B = createBuildService(ctx);
    B.apply({ type: 'buy', defId: 'chair_creaky', x: 5, z: 5, rot: 0 });
    current = makeWorld(blankLot(), 1000);
    expect(B.undo()).toBe(false);
    expect(B.canUndo()).toBe(false);
  });

  it('keeps at most 200 entries', () => {
    const { B } = world(1e6);
    for (let i = 0; i < 205; i++) B.apply({ type: 'floor', x0: 2, z0: 2, x1: 3, z1: 3, styleId: i % 2 ? 'floor_parquet' : 'floor_carpet_plum' });
    let n = 0;
    while (B.undo()) n++;
    expect(n).toBe(200);
  });

  it('undo of a buy interrupts whoever started using the object; undo emits lot + objectAdded events', () => {
    const { state, ctx, B } = world(1000);
    addAgent(state, 'a1', 6.5, 5.5);
    const r = B.apply({ type: 'buy', defId: 'armchair_tattered', x: 5, z: 5, rot: 0 });
    state.objects[r.objectId!].inUseBy = ['a1'];
    expect(B.undo()).toBe(true);
    expect(ctx.interrupts.map((i) => i.agentId)).toContain('a1');
    ctx.events.length = 0;
    expect(B.redo()).toBe(true);
    expect(ctx.events).toContainEqual({ type: 'objectAdded', objectId: r.objectId });
    expect(ctx.events).toContainEqual({ type: 'lot', what: 'objects' });
  });

  it('undo relocates agents standing where a restored object comes back', () => {
    const { state, B, S } = world(1000);
    const sofa = addFloor(state, 'sofa_moldy', 5, 5, 0, { value: 320 });
    B.apply({ type: 'sell', objectId: sofa.id });
    const a = addAgent(state, 'a1', 6.5, 5.5);
    expect(B.undo()).toBe(true);
    expect(S.isWalkable(Math.floor(a.pos.x), Math.floor(a.pos.z))).toBe(true);
    expect(a.prevPos).toEqual(a.pos);
  });
});

// ───────────────────────────── randomized mixed sequences ─────────────────────────────

const BUY_DEFS = [
  'chair_creaky',
  'sofa_moldy',
  'sofa_velvet',
  'table_wake',
  'table_rickety',
  'coffin_pine',
  'bed_normal',
  'rug_rag',
  'rug_funeral',
  'lamp_skull',
  'tv_crt',
  'counter_butcher',
  'plant_deadfern',
  'plot_budget',
  'tree_gnarled',
  'table_bonechess',
];

function checkInvariants(state: WorldState, S: SpatialService, where: string): void {
  const content = makeContent();
  expect(S.debugFaults(), where).toEqual([]);
  expect(Number.isInteger(state.household.funds) && state.household.funds >= 0, `${where}: funds ${state.household.funds}`).toBe(true);
  const furn = new Map<string, string>();
  const rugs = new Map<string, string>();
  const wallKeys = new Set(Object.keys(state.lot.walls).map((k) => normalizeEdge(k)));
  for (const o of Object.values(state.objects)) {
    const p = o.placement;
    if (p.kind === 'floor') {
      const spec = specOf(content, o.defId)!;
      const f = floorFrame(o, spec)!;
      const layer = spec.layer === 'rug' ? rugs : furn;
      for (const t of frameTiles(f)) {
        const k = `${t.x},${t.z}`;
        expect(layer.has(k), `${where}: ${o.id} overlaps ${layer.get(k)} at ${k}`).toBe(false);
        layer.set(k, o.id);
        expect(S.isBuildable(t.x, t.z), `${where}: ${o.id} off the buildable area`).toBe(true);
      }
      const s = frameSize(f);
      for (let j = 0; j < s.d; j++) for (let i = 1; i < s.w; i++) expect(wallKeys.has(`v:${f.ox + i}:${f.oz + j}`), `${where}: wall through ${o.id}`).toBe(false);
      for (let j = 1; j < s.d; j++) for (let i = 0; i < s.w; i++) expect(wallKeys.has(`h:${f.ox + i}:${f.oz + j}`), `${where}: wall through ${o.id}`).toBe(false);
    } else if (p.kind === 'opening') {
      expect(state.lot.walls[p.edge]?.openingId, `${where}: opening ${o.id} not linked`).toBe(o.id);
    } else if (p.kind === 'wall') {
      expect(wallKeys.has(p.edge), `${where}: wall item ${o.id} without wall`).toBe(true);
    } else if (p.kind === 'loose' && p.parentId !== null) {
      expect(state.objects[p.parentId], `${where}: item ${o.id} on missing parent`).toBeDefined();
    }
  }
  for (const [k, seg] of Object.entries(state.lot.walls)) {
    if (seg.openingId === null) continue;
    const o = state.objects[seg.openingId];
    expect(o && o.placement.kind === 'opening' && o.placement.edge === k, `${where}: wall ${k} links ${seg.openingId}`).toBe(true);
  }
}

function randomCommand(rng: ReturnType<typeof testRng>, state: WorldState): BuildCommand {
  const objs = Object.values(state.objects);
  const walls = Object.keys(state.lot.walls);
  const pick = <T>(a: T[]): T | undefined => (a.length ? a[rng.int(0, a.length - 1)] : undefined);
  const k = rng.int(0, 11);
  switch (k) {
    case 0:
    case 1:
      return { type: 'buy', defId: pick(BUY_DEFS)!, x: rng.int(1, 27), z: rng.int(1, 25), rot: rng.int(0, 3) as 0 };
    case 2: {
      const o = pick(objs.filter((x) => x.placement.kind !== 'loose'));
      return { type: 'sell', objectId: o ? o.id : 'o-missing' };
    }
    case 3: {
      const o = pick(objs.filter((x) => x.placement.kind === 'floor'));
      return { type: 'move', objectId: o ? o.id : 'o-missing', x: rng.int(1, 27), z: rng.int(1, 25), rot: rng.int(0, 3) as 0 };
    }
    case 4: {
      const len = rng.int(1, 5);
      const x = rng.int(1, 24);
      const z = rng.int(1, 22);
      const horiz = rng.chance(0.5);
      return { type: 'addWalls', edges: Array.from({ length: len }, (_, i) => (horiz ? `h:${x + i}:${z}` : `v:${x}:${z + i}`)) };
    }
    case 5:
      return { type: 'removeWalls', edges: [pick(walls) ?? 'h:3:3', pick(walls) ?? 'h:4:4'] };
    case 6: {
      const x0 = rng.int(1, 22);
      const z0 = rng.int(1, 20);
      return {
        type: 'room',
        x0,
        z0,
        x1: x0 + rng.int(2, 5),
        z1: z0 + rng.int(2, 5),
        floor: rng.chance(0.3) ? null : pick(FLOOR_STYLES)!.id,
        wallStyle: rng.chance(0.5) ? pick(WALL_STYLES)!.id : undefined,
      };
    }
    case 7: {
      const x0 = rng.int(1, 24);
      const z0 = rng.int(1, 22);
      return { type: 'floor', x0, z0, x1: x0 + rng.int(1, 4), z1: z0 + rng.int(1, 4), styleId: rng.chance(0.2) ? null : pick(FLOOR_STYLES)!.id };
    }
    case 8: {
      const e = pick(walls);
      return e ? { type: 'paintWall', edge: e, side: rng.int(0, 1) as 0, styleId: pick(WALL_STYLES)!.id } : { type: 'paintRoom', x: 2, z: 2, styleId: pick(WALL_STYLES)!.id };
    }
    case 9: {
      const e = pick(walls);
      return { type: 'buyOpening', defId: rng.chance(0.5) ? 'door_splintered' : 'window_grimy', edge: e ?? 'h:2:2' };
    }
    case 10: {
      const e = pick(walls);
      return { type: 'buyWallItem', defId: rng.chance(0.5) ? 'painting_greatgrand' : 'sconce_candle', edge: e ?? 'h:2:2', side: rng.int(0, 1) as 0 };
    }
    default: {
      const o = pick(objs.filter((x) => x.placement.kind === 'opening' || x.placement.kind === 'wall'));
      const e = pick(walls) ?? 'h:2:2';
      if (o && o.placement.kind === 'opening') return { type: 'moveOpening', objectId: o.id, edge: e };
      if (o) return { type: 'moveWallItem', objectId: o.id, edge: e, side: rng.int(0, 1) as 0 };
      return { type: 'paintRoom', x: rng.int(1, 27), z: rng.int(1, 25), styleId: pick(WALL_STYLES)!.id };
    }
  }
}

function seededWorld(funds: number) {
  const state = makeWorld(blankLot(), funds);
  addWalls(state, rectEdges(3, 3, 8, 7));
  addObj(state, 'door_splintered', { kind: 'opening', edge: 'h:5:7' }, { value: 120 });
  addObj(state, 'painting_greatgrand', { kind: 'wall', edge: 'v:3:4', side: 1 }, { value: 200 });
  const t = addFloor(state, 'table_wake', 4, 4, 0, { value: 340 });
  addLoose(state, 'item_meal', 4.5, 4.5, { parentId: t.id, surfaceIndex: 0, y: 0.76 });
  addLoose(state, 'item_dish', 5.5, 4.5, { parentId: t.id, surfaceIndex: 1, y: 0.76 });
  addFloor(state, 'sofa_moldy', 12, 12, 1, { value: 320 });
  const ctx = makeCtx(state);
  return { state, ctx, B: createBuildService(ctx) as BuildService, S: ctx.spatial };
}

describe('randomized build sessions (adversarial interleavings)', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`seed ${seed}: invariants hold after every step; full undo restores the start, full redo the end`, () => {
      const { state, B, S } = seededWorld(seed % 2 ? 4000 : 60000);
      const rng = testRng(1000 + seed);
      const start = structural(state);
      let applied = 0;
      for (let step = 0; step < 150; step++) {
        const roll = rng.next();
        if (roll < 0.15) B.undo();
        else if (roll < 0.22) B.redo();
        else {
          const cmd = randomCommand(rng, state);
          const before = state.household.funds;
          const preview = B.preview(cmd);
          const r = B.apply(cmd);
          expect(preview.ok, `step ${step} preview/apply ok mismatch for ${JSON.stringify(cmd)}`).toBe(r.ok);
          if (r.ok) {
            applied++;
            expect(preview.cost).toBe(r.cost);
            expect(state.household.funds, `step ${step} money for ${JSON.stringify(cmd)}`).toBe(before - r.cost);
          } else {
            expect(state.household.funds).toBe(before);
          }
        }
        checkInvariants(state, S, `seed ${seed} step ${step}`);
      }
      expect(applied).toBeGreaterThan(20);
      while (B.redo()) checkInvariants(state, S, `seed ${seed} flushing redo`); // entries undone at the very end
      const end = structural(state);
      while (B.undo()) checkInvariants(state, S, `seed ${seed} unwinding`);
      expect(structural(state)).toEqual(start);
      while (B.redo()) checkInvariants(state, S, `seed ${seed} rewinding`);
      expect(structural(state)).toEqual(end);
    });
  }

  it('catalog sanity used by the generator', () => {
    for (const id of BUY_DEFS) expect(PHYSICAL_BY_ID[id].placement).toBe('floor');
  });
});
