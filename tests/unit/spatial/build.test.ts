import { describe, expect, it } from 'vitest';
import { createBuildService, rectEdges, BUILD_REASONS } from '../../../src/sim/spatial';
import type { BuildCommand } from '../../../src/sim/contracts';
import { addAgent, addFloor, addLoose, addObj, addWalls, blankLot, makeContent, makeCtx, makeWorld, structural } from './fixtures';

function world(funds = 10000, patch?: Parameters<typeof makeContent>[0]) {
  const state = makeWorld(blankLot(), funds);
  const ctx = makeCtx(state, makeContent(patch));
  const B = createBuildService(ctx);
  return { state, ctx, B, S: ctx.spatial };
}

describe('buy', () => {
  it('charges the price, spawns through ctx.spawnObject, bumps lot.version and emits a lot event', () => {
    const { state, ctx, B, S } = world(1000);
    const v = state.lot.version;
    const r = B.apply({ type: 'buy', defId: 'sofa_moldy', x: 5, z: 5, rot: 1, tint: '#3f5a4a' });
    expect(r).toMatchObject({ ok: true, cost: 320 });
    expect(state.household.funds).toBe(680);
    const obj = state.objects[r.objectId!];
    expect(obj).toMatchObject({ defId: 'sofa_moldy', value: 320, tint: '#3f5a4a', placement: { kind: 'floor', x: 5, z: 5, rot: 1 } });
    expect(state.lot.version).toBeGreaterThan(v);
    expect(ctx.events).toContainEqual({ type: 'lot', what: 'objects' });
    expect(ctx.events).toContainEqual({ type: 'objectAdded', objectId: obj.id });
    expect(S.isWalkable(5, 6)).toBe(false);
    expect(B.canUndo()).toBe(true);
  });

  it('is atomic on insufficient funds: "Not enough money" and nothing changes', () => {
    const { state, ctx, B } = world(100);
    const snap = JSON.stringify(state);
    const ev = ctx.events.length;
    const cmd: BuildCommand = { type: 'buy', defId: 'sofa_moldy', x: 5, z: 5, rot: 0 };
    expect(B.preview(cmd)).toMatchObject({ ok: false, reason: 'Not enough money', cost: 320 });
    expect(B.apply(cmd)).toMatchObject({ ok: false, reason: 'Not enough money', cost: 320 });
    expect(JSON.stringify(state)).toBe(snap);
    expect(ctx.events.length).toBe(ev);
    expect(B.canUndo()).toBe(false);
    const room: BuildCommand = { type: 'room', x0: 3, z0: 3, x1: 9, z1: 9 };
    expect(B.apply(room)).toMatchObject({ ok: false, reason: 'Not enough money' });
    expect(JSON.stringify(state)).toBe(snap);
  });

  it('rejects invalid purchases with the placement reason and never charges', () => {
    const { state, B } = world(5000);
    addFloor(state, 'chair_creaky', 5, 5, 0);
    const cases: [BuildCommand, string][] = [
      [{ type: 'buy', defId: 'chair_creaky', x: 5, z: 5, rot: 0 }, "Something's in the way"],
      [{ type: 'buy', defId: 'chair_creaky', x: 0, z: 0, rot: 0 }, 'Outside your lot'],
      [{ type: 'buy', defId: 'chair_creaky', x: NaN, z: 0, rot: 0 }, 'Outside your lot'],
      [{ type: 'buy', defId: 'item_meal', x: 8, z: 8, rot: 0 }, BUILD_REASONS.notForSale],
      [{ type: 'buy', defId: 'painting_greatgrand', x: 8, z: 8, rot: 0 }, 'Needs a wall'],
      [{ type: 'buy', defId: 'no_such', x: 8, z: 8, rot: 0 }, "That isn't in the catalog"],
      [{ type: 'buy', defId: 'chair_creaky', x: 8, z: 8, rot: 0.5 as 0 }, "Can't place that here"],
    ];
    for (const [cmd, reason] of cases) {
      expect(B.preview(cmd)).toMatchObject({ ok: false, reason });
      expect(B.apply(cmd)).toMatchObject({ ok: false, reason });
    }
    expect(state.household.funds).toBe(5000);
    expect(B.apply(null as unknown as BuildCommand)).toMatchObject({ ok: false, reason: BUILD_REASONS.badCommand });
    expect(B.apply({ type: 'teleport' } as unknown as BuildCommand)).toMatchObject({ ok: false, reason: BUILD_REASONS.badCommand });
  });

  it('ignores malformed tints', () => {
    const { state, B } = world();
    const r = B.apply({ type: 'buy', defId: 'chair_creaky', x: 5, z: 5, rot: 0, tint: 'url(javascript:1)' });
    expect(state.objects[r.objectId!].tint).toBeNull();
  });

  it('undo refunds exactly; redo re-charges and restores the SAME id', () => {
    const { state, B } = world(1000);
    const r = B.apply({ type: 'buy', defId: 'tv_crt', x: 7, z: 7, rot: 2 });
    expect(state.household.funds).toBe(700);
    expect(B.undo()).toBe(true);
    expect(state.household.funds).toBe(1000);
    expect(state.objects[r.objectId!]).toBeUndefined();
    expect(B.canRedo()).toBe(true);
    expect(B.redo()).toBe(true);
    expect(state.household.funds).toBe(700);
    expect(state.objects[r.objectId!]).toMatchObject({ defId: 'tv_crt', placement: { kind: 'floor', x: 7, z: 7, rot: 2 }, value: 300 });
    expect(B.redo()).toBe(false);
  });
});

describe('move', () => {
  it('moves a table and the plates on it (rotation applied to their surface points)', () => {
    const { state, B, S } = world();
    const table = addFloor(state, 'table_wake', 5, 5, 0, { value: 340 });
    const p0 = addLoose(state, 'item_meal', 5.5, 5.5, { parentId: table.id, surfaceIndex: 0, y: 0.76 });
    const p1 = addLoose(state, 'item_dish', 6.5, 5.5, { parentId: table.id, surfaceIndex: 1, y: 0.76 });
    const r = B.apply({ type: 'move', objectId: table.id, x: 12, z: 9, rot: 1 });
    expect(r).toMatchObject({ ok: true, cost: 0, objectId: table.id });
    const pts = S.surfacePoints(state.objects[table.id]);
    for (const [plate, idx] of [
      [p0, 0],
      [p1, 1],
    ] as const) {
      const pl = state.objects[plate.id].placement;
      expect(pl).toMatchObject({ kind: 'loose', parentId: table.id, surfaceIndex: idx, y: 0.76 });
      if (pl.kind !== 'loose') throw new Error();
      expect(pl.x).toBeCloseTo(pts[idx].x);
      expect(pl.z).toBeCloseTo(pts[idx].z);
      expect(pl.facing).toBeCloseTo(-Math.PI / 2);
    }
    expect(B.undo()).toBe(true);
    expect(state.objects[table.id].placement).toEqual({ kind: 'floor', x: 5, z: 5, rot: 0 });
    expect(state.objects[p0.id].placement).toEqual({ kind: 'loose', x: 5.5, z: 5.5, y: 0.76, parentId: table.id, surfaceIndex: 0, facing: 0 });
    expect(B.redo()).toBe(true);
    expect(state.objects[p1.id].placement).toMatchObject({ parentId: table.id, surfaceIndex: 1 });
  });

  it('interrupts users and releases reservations of the moved object and its items', () => {
    const { state, ctx, B } = world();
    const a = addAgent(state, 'a1', 5.5, 5.5);
    const b = addAgent(state, 'a2', 8.5, 8.5);
    const chair = addFloor(state, 'chair_creaky', 5, 5, 0, { inUseBy: ['a1'], reservedBy: { '0': 'a1' } });
    const table = addFloor(state, 'table_rickety', 6, 5, 0);
    const meal = addLoose(state, 'item_meal', 6.5, 5.5, { parentId: table.id, surfaceIndex: 0, y: 0.76 });
    meal.reservedBy = { '0': 'a2' };
    B.apply({ type: 'move', objectId: chair.id, x: 10, z: 10, rot: 0 });
    expect(ctx.interrupts.map((i) => i.agentId)).toEqual(['a1']);
    expect(state.objects[chair.id].reservedBy).toEqual({});
    expect(state.objects[chair.id].inUseBy).toEqual([]);
    B.apply({ type: 'move', objectId: table.id, x: 12, z: 12, rot: 0 });
    expect(ctx.interrupts.map((i) => i.agentId)).toEqual(['a1', 'a2']);
    expect(state.objects[meal.id].reservedBy).toEqual({});
    void a;
    void b;
  });

  it('relocates agents standing on newly blocked tiles (pos = prevPos = tile centre), not seated ones', () => {
    const { state, B, S } = world();
    const walker = addAgent(state, 'w', 10.4, 8.7, { path: [{ x: 20, z: 20 }], pathIndex: 0 });
    const sitter = addAgent(state, 's', 3.55, 3.5, { posY: 0.46 });
    addFloor(state, 'sofa_moldy', 3, 3, 0); // the sitter is inside it already
    const sofa2 = addFloor(state, 'sofa_moldy', 14, 14, 0);
    B.apply({ type: 'move', objectId: sofa2.id, x: 10, z: 8, rot: 0 });
    expect(S.isWalkable(Math.floor(walker.pos.x), Math.floor(walker.pos.z))).toBe(true);
    expect(walker.pos).toEqual(walker.prevPos);
    expect(walker.pos.x % 1).toBeCloseTo(0.5);
    expect(walker.path).toBeNull();
    expect(Math.hypot(walker.pos.x - 10.4, walker.pos.z - 8.7)).toBeLessThan(1.6);
    expect(sitter.pos).toEqual({ x: 3.55, z: 3.5 });
    expect(sitter.posY).toBe(0.46);
  });

  it('validates like checkPlace (self ignored) and treats no-op moves as ok/free', () => {
    const { state, B } = world();
    const sofa = addFloor(state, 'sofa_moldy', 5, 5, 0);
    addFloor(state, 'chair_creaky', 8, 5, 0);
    expect(B.apply({ type: 'move', objectId: sofa.id, x: 7, z: 5, rot: 0 })).toMatchObject({ ok: false, reason: "Something's in the way" });
    expect(B.apply({ type: 'move', objectId: sofa.id, x: 6, z: 5, rot: 0 }).ok).toBe(true); // overlaps its old self
    expect(B.apply({ type: 'move', objectId: sofa.id, x: 6, z: 5, rot: 0 })).toEqual({ ok: true, cost: 0 });
    expect(B.apply({ type: 'move', objectId: 'o404', x: 6, z: 5, rot: 0 })).toMatchObject({ ok: false, reason: BUILD_REASONS.gone });
    const dish = addLoose(state, 'item_dish', 2.5, 2.5);
    expect(B.apply({ type: 'move', objectId: dish.id, x: 3, z: 3, rot: 0 })).toMatchObject({ ok: false, reason: BUILD_REASONS.cantMove });
  });
});

describe('sell', () => {
  it('refunds value x (1 - depreciation), interrupts users, drops items via placeItemNear; undo restores exactly', () => {
    const { state, ctx, B } = world(1000);
    addAgent(state, 'a1', 5.5, 6.5);
    const table = addFloor(state, 'table_wake', 5, 5, 0, { value: 340, inUseBy: ['a1'] });
    const meal = addLoose(state, 'item_meal', 5.5, 5.5, { parentId: table.id, surfaceIndex: 0, y: 0.76 });
    meal.data = { servings: 3, quality: 4 };
    const before = structural(state);
    const r = B.apply({ type: 'sell', objectId: table.id });
    expect(r).toMatchObject({ ok: true, cost: -289 }); // floor(340 * 0.85)
    expect(state.household.funds).toBe(1289);
    expect(state.objects[table.id]).toBeUndefined();
    expect(state.objects[meal.id]).toBeUndefined();
    expect(ctx.interrupts.map((i) => i.agentId)).toEqual(['a1']);
    const dropped = Object.values(state.objects).filter((o) => o.defId === 'item_meal');
    expect(dropped.length).toBe(1);
    expect(dropped[0].data).toEqual({ servings: 3, quality: 4 });
    expect(dropped[0].placement).toMatchObject({ kind: 'loose', parentId: null });

    expect(B.undo()).toBe(true);
    expect(state.household.funds).toBe(1000);
    expect(structural(state)).toEqual(before); // same ids, same placements, dropped copy gone
    expect(ctx.events).toContainEqual({ type: 'objectAdded', objectId: table.id });

    expect(B.redo()).toBe(true);
    expect(state.household.funds).toBe(1289);
    expect(state.objects[table.id]).toBeUndefined();
    expect(Object.values(state.objects).filter((o) => o.defId === 'item_meal').map((o) => o.id)).toEqual([dropped[0].id]);
  });

  it('uses the content depreciation and refuses unsellable / missing / loose objects', () => {
    const { state, B } = world(0, (o) => {
      o.chair_creaky = { ...o.chair_creaky, depreciation: 0.5 };
      o.lamp_skull = { ...o.lamp_skull, sellable: false };
    });
    const chair = addFloor(state, 'chair_creaky', 5, 5, 0, { value: 61 });
    expect(B.preview({ type: 'sell', objectId: chair.id })).toMatchObject({ ok: true, cost: -30 });
    expect(B.apply({ type: 'sell', objectId: chair.id })).toMatchObject({ ok: true, cost: -30 });
    expect(state.household.funds).toBe(30);
    const lamp = addFloor(state, 'lamp_skull', 7, 7, 0, { value: 140 });
    expect(B.apply({ type: 'sell', objectId: lamp.id })).toMatchObject({ ok: false, reason: BUILD_REASONS.cantSell });
    const dish = addLoose(state, 'item_dish', 2.5, 2.5);
    expect(B.apply({ type: 'sell', objectId: dish.id })).toMatchObject({ ok: false, reason: BUILD_REASONS.cantSell });
    expect(B.apply({ type: 'sell', objectId: 'o999' })).toMatchObject({ ok: false, reason: BUILD_REASONS.gone });
    const freebie = addFloor(state, 'tree_gnarled', 9, 9, 0, { value: 0 });
    expect(B.apply({ type: 'sell', objectId: freebie.id })).toMatchObject({ ok: true, cost: 0 });
    expect(B.canUndo()).toBe(true); // a free removal is still undoable
  });

  it('selling a door turns the segment back into a solid wall; undo restores the door and its link', () => {
    const { state, B, S } = world();
    addWalls(state, ['h:5:5']);
    const door = addObj(state, 'door_splintered', { kind: 'opening', edge: 'h:5:5' }, { value: 120 });
    expect(S.canStep(5, 4, 5, 5)).toBe(true);
    expect(B.apply({ type: 'sell', objectId: door.id })).toMatchObject({ ok: true, cost: -102 });
    expect(state.lot.walls['h:5:5'].openingId).toBeNull();
    expect(S.canStep(5, 4, 5, 5)).toBe(false);
    expect(B.undo()).toBe(true);
    expect(state.lot.walls['h:5:5'].openingId).toBe(door.id);
    expect(S.canStep(5, 4, 5, 5)).toBe(true);
  });
});

describe('walls', () => {
  it('addWalls charges per new segment, skips existing ones and auto-paints exterior/interior sides', () => {
    const { state, B, S } = world(1000);
    const edges = rectEdges(5, 5, 8, 8);
    expect(B.apply({ type: 'addWalls', edges })).toMatchObject({ ok: true, cost: 15 * 12 });
    expect(state.household.funds).toBe(820);
    expect(state.lot.walls['h:5:5'].paint).toEqual(['wall_exterior_siding', 'wall_plaster_bone']);
    expect(state.lot.walls['v:8:6'].paint).toEqual(['wall_plaster_bone', 'wall_exterior_siding']);
    expect(S.roomAt(6, 6)).toBeGreaterThan(0);
    expect(B.apply({ type: 'addWalls', edges })).toEqual({ ok: true, cost: 0 });
    expect(B.apply({ type: 'addWalls', edges: [...edges, 'h:10:10', 'h:10:10'] })).toMatchObject({ ok: true, cost: 15 });
    expect(state.household.funds).toBe(805);
  });

  it('an explicit style paints both sides of new segments at style price', () => {
    const { state, B } = world(1000);
    expect(B.apply({ type: 'addWalls', edges: ['v:4:4', 'v:4:5'], style: 'wall_brick_soot' })).toMatchObject({ ok: true, cost: 2 * (15 + 2 * 5) });
    expect(state.lot.walls['v:4:4'].paint).toEqual(['wall_brick_soot', 'wall_brick_soot']);
    expect(B.apply({ type: 'addWalls', edges: ['v:9:4'], style: 'wall_nope' })).toMatchObject({ ok: false, reason: BUILD_REASONS.unknownStyle });
  });

  it('rejects edges outside the lot, through furniture, malformed keys and oversized drags', () => {
    const { state, B } = world(100000);
    addFloor(state, 'sofa_moldy', 10, 10, 0);
    addFloor(state, 'rug_funeral', 15, 15, 0);
    const bad: [BuildCommand, string][] = [
      [{ type: 'addWalls', edges: ['v:0:5'] }, 'Outside your lot'],
      [{ type: 'addWalls', edges: ['h:5:28'] }, 'Outside your lot'],
      [{ type: 'addWalls', edges: ['h:5:29'] }, 'Outside your lot'], // street edge, beside the sidewalk
      [{ type: 'addWalls', edges: ['v:11:10'] }, "Something's in the way"], // through the sofa
      [{ type: 'addWalls', edges: ['h:16:16'] }, "Something's in the way"], // through the rug
      [{ type: 'addWalls', edges: ['h:3:3', 'garbage'] }, 'Outside your lot'],
      [{ type: 'addWalls', edges: 'h:3:3' as unknown as string[] }, BUILD_REASONS.badCommand],
      [{ type: 'addWalls', edges: Array.from({ length: 401 }, (_, i) => `h:${(i % 27) + 1}:${Math.floor(i / 27) + 1}`) }, BUILD_REASONS.tooBig],
    ];
    for (const [cmd, reason] of bad) expect(B.apply(cmd), reason).toMatchObject({ ok: false, reason });
    expect(Object.keys(state.lot.walls)).toEqual([]);
    // on the border of the buildable rect (one side buildable, the other a margin tile) is allowed
    expect(B.apply({ type: 'addWalls', edges: ['v:1:5', 'h:5:27', 'v:29:5'] })).toMatchObject({ ok: true, cost: 45 });
  });

  it('removeWalls refunds $10/segment plus the resale of openings and wall items on them; undo restores links', () => {
    const { state, B, S } = world(1000);
    addWalls(state, rectEdges(5, 5, 8, 8));
    const door = addObj(state, 'door_splintered', { kind: 'opening', edge: 'h:6:8' }, { value: 120 });
    const painting = addObj(state, 'painting_greatgrand', { kind: 'wall', edge: 'v:5:6', side: 1 }, { value: 200 });
    const win = addObj(state, 'window_grimy', { kind: 'opening', edge: 'v:8:6' }, { value: 90 });
    const before = structural(state);
    const r = B.apply({ type: 'removeWalls', edges: ['h:6:8', 'v:5:6', 'v:8:6', 'h:20:20'] });
    expect(r).toMatchObject({ ok: true, cost: -(30 + 102 + 170 + 76) });
    expect(state.household.funds).toBe(1378);
    for (const id of [door.id, painting.id, win.id]) expect(state.objects[id]).toBeUndefined();
    expect(state.lot.walls['h:6:8']).toBeUndefined();
    expect(S.roomAt(6, 6)).toBe(0);
    expect(B.undo()).toBe(true);
    expect(state.household.funds).toBe(1000);
    expect(structural(state)).toEqual(before);
    expect(state.lot.walls['h:6:8'].openingId).toBe(door.id);
    expect(S.canStep(6, 7, 6, 8)).toBe(true);
    expect(S.roomAt(6, 6)).toBeGreaterThan(0);
    expect(B.apply({ type: 'removeWalls', edges: ['h:20:20'] })).toEqual({ ok: true, cost: 0 });
  });
});

describe('room / floor / paint', () => {
  it('room = perimeter walls (existing skipped) + floor fill + interior paint, priced per styles.ts', () => {
    const { state, B, S } = world(5000);
    addWalls(state, ['h:5:5']); // one perimeter wall already exists (plaster both sides)
    const cmd: BuildCommand = { type: 'room', x0: 5, z0: 5, x1: 9, z1: 8, floor: 'floor_checker_bw', wallStyle: 'wall_damask_crimson' };
    const expected = 13 * 15 + 12 * 7 + 14 * 6;
    expect(B.preview(cmd)).toMatchObject({ ok: true, cost: expected });
    expect(B.apply(cmd)).toMatchObject({ ok: true, cost: expected });
    expect(state.household.funds).toBe(5000 - expected);
    expect(state.lot.walls['h:5:5'].paint).toEqual(['wall_plaster_bone', 'wall_damask_crimson']);
    expect(state.lot.walls['h:6:8'].paint).toEqual(['wall_damask_crimson', 'wall_exterior_siding']);
    expect(state.lot.floors[6 * 30 + 6]).toBe('floor_checker_bw');
    expect(S.isIndoor(8, 7)).toBe(true);
    expect(B.undo()).toBe(true);
    expect(state.household.funds).toBe(5000);
    expect(Object.keys(state.lot.walls)).toEqual(['h:5:5']);
    expect(state.lot.walls['h:5:5'].paint).toEqual(['wall_plaster_bone', 'wall_plaster_bone']);
    expect(state.lot.floors.every((f) => f === null)).toBe(true);
  });

  it('room defaults: floor omitted -> worn planks; floor null -> floors untouched; corner order irrelevant', () => {
    const { state, B } = world(5000);
    expect(B.apply({ type: 'room', x0: 4, z0: 4, x1: 2, z1: 2 })).toMatchObject({ ok: true, cost: 8 * 15 + 4 * 5 });
    expect(state.lot.floors[2 * 30 + 2]).toBe('floor_planks_worn');
    expect(B.apply({ type: 'room', x0: 10, z0: 10, x1: 12, z1: 12, floor: null })).toMatchObject({ ok: true, cost: 8 * 15 });
    expect(state.lot.floors[10 * 30 + 10]).toBeNull();
    expect(B.apply({ type: 'room', x0: 10, z0: 10, x1: 12, z1: 12, floor: null })).toEqual({ ok: true, cost: 0 });
  });

  it('room validation: too small, outside, too big, unknown styles, cutting furniture', () => {
    const { state, B } = world(1e6);
    addFloor(state, 'sofa_moldy', 20, 20, 0);
    const bad: [BuildCommand, string][] = [
      [{ type: 'room', x0: 3, z0: 3, x1: 3, z1: 9 }, BUILD_REASONS.tooSmall],
      [{ type: 'room', x0: 0, z0: 3, x1: 4, z1: 6 }, 'Outside your lot'],
      [{ type: 'room', x0: 3, z0: 24, x1: 6, z1: 29 }, 'Outside your lot'],
      [{ type: 'room', x0: 3, z0: 3, x1: 6, z1: 6, floor: 'floor_lava' }, BUILD_REASONS.unknownStyle],
      [{ type: 'room', x0: 3, z0: 3, x1: 6, z1: 6, wallStyle: 'wall_lava' }, BUILD_REASONS.unknownStyle],
      [{ type: 'room', x0: 21, z0: 18, x1: 24, z1: 23 }, "Something's in the way"], // left wall would split the sofa
      [{ type: 'room', x0: NaN, z0: 3, x1: 6, z1: 6 }, 'Outside your lot'],
    ];
    for (const [cmd, reason] of bad) expect(B.apply(cmd), JSON.stringify(cmd)).toMatchObject({ ok: false, reason });
    expect(B.apply({ type: 'room', x0: -100, z0: -100, x1: 100, z1: 100 })).toMatchObject({ ok: false, reason: BUILD_REASONS.tooBig });
    expect(Object.keys(state.lot.walls)).toEqual([]);
    // the whole buildable area (28 x 26 = 728 tiles, 108 edges) fits the per-op budget; the sofa is inside, not cut
    expect(B.preview({ type: 'room', x0: 1, z0: 1, x1: 29, z1: 27, floor: null })).toMatchObject({ ok: true, cost: 108 * 15 });
  });

  it('floor: price per changed tile, removal free, exact undo', () => {
    const { state, B } = world(1000);
    const cmd: BuildCommand = { type: 'floor', x0: 2, z0: 2, x1: 5, z1: 4, styleId: 'floor_marble_black' };
    expect(B.apply(cmd)).toMatchObject({ ok: true, cost: 6 * 14 });
    expect(B.apply(cmd)).toEqual({ ok: true, cost: 0 });
    expect(B.apply({ type: 'floor', x0: 4, z0: 3, x1: 6, z1: 4, styleId: 'floor_marble_black' })).toMatchObject({ cost: 14 }); // 1 new tile
    expect(B.apply({ type: 'floor', x0: 2, z0: 2, x1: 3, z1: 3, styleId: null })).toMatchObject({ ok: true, cost: 0 });
    expect(state.lot.floors[2 * 30 + 2]).toBeNull();
    expect(state.household.funds).toBe(1000 - 7 * 14);
    expect(B.undo()).toBe(true);
    expect(state.lot.floors[2 * 30 + 2]).toBe('floor_marble_black');
    expect(B.apply({ type: 'floor', x0: 0, z0: 0, x1: 2, z1: 2, styleId: 'floor_marble_black' })).toMatchObject({ ok: false, reason: 'Outside your lot' });
    expect(B.apply({ type: 'floor', x0: 0, z0: 0, x1: 31, z1: 30, styleId: 'floor_marble_black' })).toMatchObject({ ok: false, reason: BUILD_REASONS.tooBig });
    expect(B.apply({ type: 'floor', x0: 3, z0: 3, x1: 4, z1: 4, styleId: 'floor_lava' })).toMatchObject({ ok: false, reason: BUILD_REASONS.unknownStyle });
  });

  it('paintWall / paintRoom charge per changed side', () => {
    const { state, B } = world(1000);
    addWalls(state, rectEdges(5, 5, 8, 8));
    expect(B.apply({ type: 'paintWall', edge: 'h:6:5', side: 1, styleId: 'wall_damask_midnight' })).toMatchObject({ ok: true, cost: 6 });
    expect(B.apply({ type: 'paintWall', edge: 'h:6:5', side: 1, styleId: 'wall_damask_midnight' })).toEqual({ ok: true, cost: 0 });
    expect(B.apply({ type: 'paintWall', edge: 'h:6:4', side: 1, styleId: 'wall_damask_midnight' })).toMatchObject({ ok: false, reason: 'Needs a wall' });
    expect(B.apply({ type: 'paintWall', edge: 'h:6:5', side: 1, styleId: 'nope' })).toMatchObject({ ok: false, reason: BUILD_REASONS.unknownStyle });
    // inside: 12 sides, one already midnight-damask -> 11 x $5 brick
    expect(B.apply({ type: 'paintRoom', x: 6, z: 6, styleId: 'wall_brick_soot' })).toMatchObject({ ok: true, cost: 12 * 5 });
    expect(state.lot.walls['h:6:5'].paint[1]).toBe('wall_brick_soot');
    // the outdoor "room" paints every exterior side
    expect(B.apply({ type: 'paintRoom', x: 1, z: 1, styleId: 'wall_stone_crypt' })).toMatchObject({ ok: true, cost: 12 * 8 });
    expect(state.lot.walls['h:6:5'].paint[0]).toBe('wall_stone_crypt');
    expect(B.undo() && B.undo()).toBe(true);
    expect(state.lot.walls['h:6:5'].paint).toEqual(['wall_plaster_bone', 'wall_damask_midnight']);
  });
});

describe('wall items and openings', () => {
  it('buyWallItem / moveWallItem validate through checkWallItem', () => {
    const { state, B } = world(1000);
    addWalls(state, ['h:5:5', 'h:6:5']);
    const r = B.apply({ type: 'buyWallItem', defId: 'painting_greatgrand', edge: 'h:5:5', side: 1 });
    expect(r).toMatchObject({ ok: true, cost: 200 });
    expect(B.apply({ type: 'buyWallItem', defId: 'sconce_candle', edge: 'h:5:5', side: 1 })).toMatchObject({ ok: false, reason: "Something's in the way" });
    expect(B.apply({ type: 'buyWallItem', defId: 'sconce_candle', edge: 'h:9:9', side: 1 })).toMatchObject({ ok: false, reason: 'Needs a wall' });
    expect(B.apply({ type: 'moveWallItem', objectId: r.objectId!, edge: 'h:6:5', side: 0 })).toMatchObject({ ok: true, cost: 0 });
    expect(state.objects[r.objectId!].placement).toEqual({ kind: 'wall', edge: 'h:6:5', side: 0 });
    expect(B.undo()).toBe(true);
    expect(state.objects[r.objectId!].placement).toEqual({ kind: 'wall', edge: 'h:5:5', side: 1 });
  });

  it('buyOpening links the wall; moveOpening relinks both walls; undo restores both', () => {
    const { state, B, S } = world(1000);
    addWalls(state, ['v:5:5', 'v:5:7']);
    expect(B.apply({ type: 'buyOpening', defId: 'door_splintered', edge: 'v:5:6' })).toMatchObject({ ok: false, reason: 'Needs a wall' });
    const r = B.apply({ type: 'buyOpening', defId: 'door_splintered', edge: 'v:5:5' });
    expect(r).toMatchObject({ ok: true, cost: 120 });
    expect(state.lot.walls['v:5:5'].openingId).toBe(r.objectId);
    expect(S.canStep(4, 5, 5, 5)).toBe(true);
    expect(B.apply({ type: 'moveOpening', objectId: r.objectId!, edge: 'v:5:7' })).toMatchObject({ ok: true });
    expect(state.lot.walls['v:5:5'].openingId).toBeNull();
    expect(state.lot.walls['v:5:7'].openingId).toBe(r.objectId);
    expect(S.canStep(4, 5, 5, 5)).toBe(false);
    expect(S.canStep(4, 7, 5, 7)).toBe(true);
    expect(B.undo()).toBe(true);
    expect(state.lot.walls['v:5:5'].openingId).toBe(r.objectId);
    expect(state.lot.walls['v:5:7'].openingId).toBeNull();
    expect(B.undo()).toBe(true);
    expect(state.lot.walls['v:5:5'].openingId).toBeNull();
    expect(state.household.funds).toBe(1000);
  });
});

describe('corrupt state', () => {
  it('tolerates null wall records, a missing walls map and junk objects', () => {
    const { state, B, S } = world(1000);
    (state.lot.walls as Record<string, unknown>)['h:3:3'] = null;
    (state.objects as Record<string, unknown>).junk = null;
    expect(B.apply({ type: 'addWalls', edges: ['h:3:3'] })).toMatchObject({ ok: true, cost: 15 });
    expect(S.canStep(3, 2, 3, 3)).toBe(false);
    (state.lot as unknown as { walls: unknown }).walls = undefined;
    expect(B.apply({ type: 'addWalls', edges: ['h:4:3'] })).toMatchObject({ ok: true, cost: 15 });
    expect(Object.keys(state.lot.walls)).toEqual(['h:4:3']);
    expect(B.apply({ type: 'sell', objectId: 'junk' })).toMatchObject({ ok: false });
    expect(S.debugFaults()).toEqual([]);
  });

  it('agents with NaN positions are ignored by relocation', () => {
    const { state, B } = world(1000);
    const a = addAgent(state, 'a1', NaN, 5);
    expect(B.apply({ type: 'buy', defId: 'chair_creaky', x: 5, z: 5, rot: 0 }).ok).toBe(true);
    expect(Number.isNaN(a.pos.x)).toBe(true);
  });
});

describe('fault containment', () => {
  it('a throwing ctx.spawnObject rolls back, refunds and records no history', () => {
    const { state, ctx, B } = world(1000);
    const before = structural(state);
    ctx.failSpawns = 1;
    expect(B.apply({ type: 'buy', defId: 'chair_creaky', x: 5, z: 5, rot: 0 })).toMatchObject({ ok: false, reason: BUILD_REASONS.failed });
    expect(structural(state)).toEqual(before);
    expect(state.household.funds).toBe(1000);
    expect(B.canUndo()).toBe(false);
    expect(B.apply({ type: 'buy', defId: 'chair_creaky', x: 5, z: 5, rot: 0 }).ok).toBe(true);
  });

  it('preview never mutates and mirrors apply for a battery of commands', () => {
    const cmds: BuildCommand[] = [
      { type: 'buy', defId: 'sofa_velvet', x: 4, z: 4, rot: 3 },
      { type: 'buy', defId: 'sofa_velvet', x: 0, z: 4, rot: 3 },
      { type: 'addWalls', edges: rectEdges(10, 10, 13, 12) },
      { type: 'removeWalls', edges: ['h:20:20'] },
      { type: 'room', x0: 15, z0: 15, x1: 19, z1: 18, floor: 'floor_parquet', wallStyle: 'wall_wood_panel' },
      { type: 'floor', x0: 2, z0: 20, x1: 6, z1: 24, styleId: 'floor_dirt_packed' },
      { type: 'paintRoom', x: 2, z: 2, styleId: 'wall_tile_morgue' },
      { type: 'buyOpening', defId: 'window_grimy', edge: 'h:3:3' },
      { type: 'sell', objectId: 'o1' },
    ];
    for (const cmd of cmds) {
      const a = world(2000);
      const b = world(2000);
      addFloor(a.state, 'chair_creaky', 20, 20, 0, { value: 60 });
      addFloor(b.state, 'chair_creaky', 20, 20, 0, { value: 60 });
      const snap = JSON.stringify(a.state);
      const p = a.B.preview(cmd);
      expect(JSON.stringify(a.state)).toBe(snap);
      const r = b.B.apply(cmd);
      expect({ ok: p.ok, reason: p.reason, cost: p.cost }, JSON.stringify(cmd)).toEqual({ ok: r.ok, reason: r.reason, cost: r.cost });
    }
  });
});
