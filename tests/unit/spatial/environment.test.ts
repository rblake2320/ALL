import { describe, expect, it } from 'vitest';
import { createSpatial, rectEdges } from '../../../src/sim/spatial';
import { envContribution } from '../../../src/sim/spatial/environment';
import { loadContent } from '../../../src/sim/index';
import type { ObjectState } from '../../../src/sim/types';
import { addFloor, addLoose, addObj, addWalls, blankLot, makeContent, makeWorld } from './fixtures';

function room3x3() {
  const state = makeWorld(blankLot(20, 20));
  const content = makeContent((o) => {
    o.statue_test = { ...o.chair_creaky, id: 'statue_test', env: 100 };
  });
  const S = createSpatial(() => state, content);
  addWalls(state, rectEdges(3, 3, 6, 6)); // 9-tile room
  return { state, content, S };
}

describe('roomEnvironment', () => {
  it('an empty room scores 0; decor adds env scaled by sum / sqrt(tiles) * 2', () => {
    const { state, S } = room3x3();
    expect(S.roomEnvironment(4, 4)).toBe(0);
    addObj(state, 'painting_greatgrand', { kind: 'wall', edge: 'h:4:3', side: 1 }); // env 4, mounted inside
    state.tick++;
    expect(S.roomEnvironment(4, 4)).toBeCloseTo((4 / 3) * 2);
    expect(S.roomEnvironment(5, 5)).toBeCloseTo((4 / 3) * 2); // every tile of the room
  });

  // Backlog #4 changed this rule: items used to be hard-coded (dish/ash -1, fire -5, ignoring their def). Every
  // object — spawned items included — now contributes its ContentRegistry def env, so SIM-HOME's numbers are the
  // single source (ash -3).
  it('dirty dishes, ash and fire contribute their def env (dish -1, ash -3, fire -5), dirt subtracts 2 x dirt', () => {
    const { state, S } = room3x3();
    addObj(state, 'painting_greatgrand', { kind: 'wall', edge: 'h:4:3', side: 1 }); // +4
    addLoose(state, 'item_dish', 4.5, 4.5); // -1
    addLoose(state, 'item_ash', 3.5, 5.5); // -3
    state.tick++;
    expect(S.roomEnvironment(4, 4)).toBeCloseTo((0 / 3) * 2);
    addLoose(state, 'item_fire', 5.5, 3.5); // -5
    state.tick++;
    expect(S.roomEnvironment(4, 4)).toBeCloseTo((-5 / 3) * 2);
    const c = addFloor(state, 'candelabra_drippy', 3, 3, 0, { condition: { broken: false, dirt: 0.5, burning: false, burnMinutes: 0 } }); // 2 - 1
    state.tick++;
    expect(S.roomEnvironment(4, 4)).toBeCloseTo((-4 / 3) * 2);
    c.condition.dirt = 7; // clamped to 1 -> 2 - 2 = 0
    state.tick++;
    expect(S.roomEnvironment(4, 4)).toBeCloseTo((-5 / 3) * 2);
  });

  it('item env comes from the content def, not a spatial table (a re-tuned dish counts as tuned)', () => {
    const state = makeWorld(blankLot(20, 20));
    const content = makeContent((o) => {
      o.item_dish = { ...o.item_dish, env: -7 };
      o.item_ash = { ...o.item_ash, env: 0 };
    });
    const S = createSpatial(() => state, content);
    addWalls(state, rectEdges(3, 3, 6, 6));
    addLoose(state, 'item_dish', 4.5, 4.5);
    addLoose(state, 'item_ash', 3.5, 5.5); // env 0: contributes nothing
    state.tick++;
    expect(S.roomEnvironment(4, 4)).toBeCloseTo((-7 / 3) * 2);
    // junk env values are ignored (0), never NaN
    content.objects.item_dish = { ...content.objects.item_dish, env: Number.NaN };
    state.tick++;
    expect(S.roomEnvironment(4, 4)).toBe(0);
  });

  it('clamps to [-10, 10]', () => {
    const { state, S } = room3x3();
    const statue = addFloor(state, 'statue_test', 4, 4, 0);
    state.tick++;
    expect(S.roomEnvironment(4, 4)).toBe(10);
    delete state.objects[statue.id];
    for (let i = 0; i < 20; i++) addLoose(state, 'item_fire', 3.5 + (i % 3), 3.5 + Math.floor(i / 7));
    state.tick++;
    expect(S.roomEnvironment(4, 4)).toBe(-10);
  });

  it('openings and held items never count; objects only count in their own room', () => {
    const { state, S } = room3x3();
    addObj(state, 'window_gothic', { kind: 'opening', edge: 'v:3:4' });
    addObj(state, 'painting_greatgrand', { kind: 'wall', edge: 'h:4:3', side: 0 }); // hung OUTSIDE (mounted tile (4,2))
    addObj(state, 'rug_funeral', { kind: 'floor', x: 10, z: 10, rot: 0 }); // outdoors
    state.tick++;
    expect(S.roomEnvironment(4, 4)).toBe(0);
  });

  it('outdoors uses yard objects within 4 tiles only', () => {
    const state = makeWorld(blankLot(30, 30));
    const S = createSpatial(() => state, makeContent());
    addFloor(state, 'tree_gnarled', 15, 15, 0); // env 2, centre (15.5, 15.5)
    // 49 lattice tiles lie within radius 4 of a tile centre on an open lot
    expect(S.roomEnvironment(15, 18)).toBeCloseTo((2 / 7) * 2);
    expect(S.roomEnvironment(15, 20)).toBe(0);
    addWalls(state, rectEdges(14, 14, 17, 17)); // the tree is now indoors
    expect(S.roomEnvironment(15, 18)).toBe(0);
    expect(S.roomEnvironment(15, 15)).toBeGreaterThan(0);
  });

  it('is recomputed on the next tick (dish spawned without a version bump)', () => {
    const { state, S } = room3x3();
    expect(S.roomEnvironment(4, 4)).toBe(0);
    addLoose(state, 'item_dish', 4.5, 4.5);
    state.lot.version--; // no structural bump
    expect(S.roomEnvironment(4, 4)).toBe(0); // same tick: cached
    state.tick++;
    expect(S.roomEnvironment(4, 4)).toBeCloseTo((-1 / 3) * 2);
  });

  it('bad input returns 0 and never throws', () => {
    const { S } = room3x3();
    for (const [x, z] of [
      [NaN, 1],
      [1, Infinity],
      [-1, 3],
      [99, 2],
    ])
      expect(S.roomEnvironment(x, z)).toBe(0);
    expect(S.debugFaults()).toEqual([]);
  });

  it('real content: every spawned item contributes exactly its SIM-HOME def env (ash -3, dish -1, fire -5)', () => {
    const real = loadContent();
    const items = Object.values(real.objects).filter((d) => d.category === 'item');
    expect(items.length).toBeGreaterThan(5);
    const probe = (defId: string, dirt = 0): number =>
      envContribution(real, { id: 'o1', defId, condition: { broken: false, dirt, burning: false, burnMinutes: 0 } } as ObjectState);
    for (const d of items) expect(probe(d.id), d.id).toBe(d.env);
    expect(probe('item_ash')).toBe(-3);
    expect(probe('item_dish')).toBe(-1);
    expect(probe('item_fire')).toBe(-5);
    expect(probe('item_dish', 0.5)).toBe(-2); // the dirt rule applies to items too
    expect(probe('no_such_def')).toBe(0);
  });
});
