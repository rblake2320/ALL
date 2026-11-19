import { describe, expect, it } from 'vitest';
import { createSpatial, PLACEMENT_REASONS as R, rectEdges } from '../../../src/sim/spatial';
import { addFloor, addLoose, addObj, addWall, addWalls, makeContent, makeWorld, blankLot } from './fixtures';

function setup(patch?: Parameters<typeof makeContent>[0]) {
  const state = makeWorld(blankLot());
  const content = makeContent(patch);
  const S = createSpatial(() => state, content);
  return { state, content, S };
}

describe('checkPlace rule table', () => {
  it('accepts a valid placement with its tiles and price', () => {
    const { S } = setup();
    const r = S.checkPlace('sofa_velvet', 5, 5, 1);
    expect(r.ok).toBe(true);
    expect(r.cost).toBe(780);
    expect(r.tiles).toEqual([
      { x: 5, z: 5 },
      { x: 5, z: 6 },
      { x: 5, z: 7 },
    ]);
    expect(r.blockedSlots).toEqual([]);
  });

  it('rejects unknown / non-floor defs and bad numbers with player-facing reasons', () => {
    const { S } = setup();
    expect(S.checkPlace('nope', 5, 5, 0)).toMatchObject({ ok: false, reason: R.unknown, cost: 0 });
    expect(S.checkPlace('painting_greatgrand', 5, 5, 0)).toMatchObject({ ok: false, reason: 'Needs a wall' });
    expect(S.checkPlace('door_splintered', 5, 5, 0)).toMatchObject({ ok: false, reason: 'Needs a wall' });
    expect(S.checkPlace('item_dish', 5, 5, 0)).toMatchObject({ ok: false, reason: R.cantPlace });
    expect(S.checkPlace('chair_creaky', NaN, 5, 0)).toMatchObject({ ok: false, reason: 'Outside your lot' });
    expect(S.checkPlace('chair_creaky', 5, 5, 1.5 as 0)).toMatchObject({ ok: false, reason: R.cantPlace });
    expect(S.checkPlace('chair_creaky', 5, 5, 6 as 0).ok).toBe(true); // integer rotations wrap
  });

  it('every footprint tile must be buildable (margins, sidewalk, off-lot)', () => {
    const { S } = setup();
    for (const [x, z, rot] of [
      [0, 5, 0],
      [28, 5, 0], // 2-wide sofa spills onto x = 29
      [5, 26, 1], // rotated sofa spills onto z = 27
      [5, 28, 0],
      [-3, 5, 0],
      [5, 40, 0],
    ] as const) {
      expect(S.checkPlace('sofa_moldy', x, z, rot), `${x},${z},${rot}`).toMatchObject({ ok: false, reason: "Outside your lot" });
    }
    expect(S.checkPlace('sofa_moldy', 27, 26, 0).ok).toBe(true);
  });

  it("multi-tile objects (rugs included) can't straddle any wall segment, door or window", () => {
    const { state, S } = setup();
    addWall(state, 'v:6:5');
    expect(S.checkPlace('sofa_moldy', 5, 5, 0)).toMatchObject({ ok: false, reason: "Can't straddle a wall" });
    expect(S.checkPlace('rug_rag', 5, 4, 0)).toMatchObject({ ok: false, reason: "Can't straddle a wall" });
    expect(S.checkPlace('sofa_moldy', 5, 5, 1).ok).toBe(true); // rotated: no longer crosses x = 6
    addWall(state, 'h:10:11');
    addObj(state, 'door_splintered', { kind: 'opening', edge: 'h:10:11' });
    expect(S.checkPlace('coffin_pine', 10, 10, 0)).toMatchObject({ ok: false, reason: "Can't straddle a wall" });
    addWall(state, 'h:14:11');
    addObj(state, 'window_grimy', { kind: 'opening', edge: 'h:14:11' });
    expect(S.checkPlace('coffin_pine', 14, 10, 0)).toMatchObject({ ok: false, reason: "Can't straddle a wall" });
    // a wall along the OUTSIDE of the footprint is fine
    expect(S.checkPlace('coffin_pine', 14, 11, 0).ok).toBe(true);
    expect(S.checkPlace('coffin_pine', 14, 9, 0).ok).toBe(true);
  });

  it('overlap: furniture vs furniture blocks; rugs only collide with rugs', () => {
    const { state, S } = setup();
    addFloor(state, 'table_wake', 5, 5, 0);
    addFloor(state, 'rug_rag', 10, 10, 0);
    expect(S.checkPlace('chair_creaky', 6, 5, 0)).toMatchObject({ ok: false, reason: "Something's in the way" });
    expect(S.checkPlace('rug_funeral', 4, 4, 0).ok).toBe(true); // rug under furniture
    expect(S.checkPlace('chair_creaky', 11, 11, 0).ok).toBe(true); // furniture on a rug
    expect(S.checkPlace('rug_rag', 11, 11, 0)).toMatchObject({ ok: false, reason: "Something's in the way" });
    expect(S.checkPlace('rug_rag', 12, 10, 0).ok).toBe(true); // adjacent rugs are fine
  });

  it('loose items on the floor and fire block furniture; items on surfaces and rugs do not', () => {
    const { state, S } = setup();
    addLoose(state, 'item_limb_leg', 3.5, 3.5);
    addLoose(state, 'item_fire', 8.5, 8.5);
    const table = addFloor(state, 'table_rickety', 12, 12, 0);
    addLoose(state, 'item_meal', 12.5, 12.5, { parentId: table.id, surfaceIndex: 0, y: 0.76 });
    expect(S.checkPlace('chair_creaky', 3, 3, 0)).toMatchObject({ ok: false, reason: "Something's in the way" });
    expect(S.checkPlace('chair_creaky', 8, 8, 0)).toMatchObject({ ok: false, reason: "Something's in the way" });
    expect(S.checkPlace('rug_rag', 3, 3, 0).ok).toBe(true);
    // moving the table onto itself with its meal aboard is fine (ignoreObjectId)
    expect(S.checkPlace('table_rickety', 12, 12, 0, table.id).ok).toBe(true);
    // an item whose parent vanished counts as lying on the floor
    addLoose(state, 'item_dish', 15.5, 15.5, { parentId: 'o-gone', surfaceIndex: 0 });
    expect(S.checkPlace('chair_creaky', 15, 15, 0)).toMatchObject({ ok: false, reason: "Something's in the way" });
  });

  it('ignoreObjectId lets an object overlap its own current tiles', () => {
    const { state, S } = setup();
    const sofa = addFloor(state, 'sofa_moldy', 5, 5, 0);
    expect(S.checkPlace('sofa_moldy', 6, 5, 0).ok).toBe(false);
    expect(S.checkPlace('sofa_moldy', 6, 5, 0, sofa.id).ok).toBe(true);
    expect(S.checkPlace('sofa_moldy', 5, 5, 1, sofa.id).ok).toBe(true);
  });

  it('blocking objects may not sit on a door side tile; rugs may', () => {
    const { state, S } = setup();
    addWalls(state, rectEdges(5, 5, 9, 9));
    addObj(state, 'door_splintered', { kind: 'opening', edge: 'h:6:9' }); // side tiles (6,8) & (6,9)
    addObj(state, 'window_grimy', { kind: 'opening', edge: 'h:7:9' });
    expect(S.checkPlace('chair_creaky', 6, 8, 0)).toMatchObject({ ok: false, reason: 'Blocks a doorway' });
    expect(S.checkPlace('chair_creaky', 6, 9, 0)).toMatchObject({ ok: false, reason: 'Blocks a doorway' });
    expect(S.checkPlace('rug_rag', 6, 9, 0).ok).toBe(true);
    expect(S.checkPlace('chair_creaky', 7, 8, 0).ok).toBe(true); // in front of a window is fine
  });

  it('outdoorOnly / indoorOnly follow the current rooms', () => {
    const { state, S } = setup((o) => {
      o.indoor_test = { ...o.chair_creaky, id: 'indoor_test', indoorOnly: true };
    });
    addWalls(state, rectEdges(5, 5, 9, 9));
    expect(S.checkPlace('plot_budget', 6, 6, 0)).toMatchObject({ ok: false, reason: 'Must be placed outdoors' });
    expect(S.checkPlace('plot_budget', 12, 6, 0).ok).toBe(true);
    expect(S.checkPlace('indoor_test', 12, 6, 0)).toMatchObject({ ok: false, reason: 'Must be placed indoors' });
    expect(S.checkPlace('indoor_test', 6, 6, 0).ok).toBe(true);
  });

  it('flags slots whose every approach tile would be blocked (non-fatal)', () => {
    const { state, S } = setup();
    // fridge facing a wall: its only approach tile is wall-separated
    addWall(state, 'h:5:6');
    const r = S.checkPlace('fridge_humming', 5, 5, 0);
    expect(r.ok).toBe(true);
    expect(r.blockedSlots).toEqual([0]);
    // a chair boxed in by furniture on all four sides
    addFloor(state, 'counter_butcher', 10, 9, 0);
    addFloor(state, 'counter_butcher', 9, 10, 0);
    addFloor(state, 'counter_butcher', 11, 10, 0);
    addFloor(state, 'counter_butcher', 10, 11, 0);
    expect(S.checkPlace('chair_creaky', 10, 10, 0).blockedSlots).toEqual([0]);
    // the sofa's own second seat blocks nothing: both seats stay usable
    expect(S.checkPlace('sofa_moldy', 15, 15, 0).blockedSlots).toEqual([]);
    // TV whose viewing tiles are both covered
    addFloor(state, 'table_coffinlid', 20, 12, 0);
    addFloor(state, 'table_coffinlid', 20, 13, 0);
    expect(S.checkPlace('tv_crt', 20, 10, 0).blockedSlots).toEqual([0]);
  });
});

describe('checkWallItem', () => {
  it('needs an existing plain wall on a buildable side with no other item on that side', () => {
    const { state, S } = setup();
    expect(S.checkWallItem('painting_greatgrand', 'h:5:5', 1)).toMatchObject({ ok: false, reason: 'Needs a wall' });
    addWall(state, 'h:5:5');
    const ok = S.checkWallItem('painting_greatgrand', 'h:5:5', 1);
    expect(ok).toMatchObject({ ok: true, cost: 200, tiles: [{ x: 5, z: 5 }] });
    const p = addObj(state, 'painting_greatgrand', { kind: 'wall', edge: 'h:5:5', side: 1 });
    expect(S.checkWallItem('sconce_candle', 'h:5:5', 1)).toMatchObject({ ok: false, reason: "Something's in the way" });
    expect(S.checkWallItem('sconce_candle', 'h:5:5', 0).ok).toBe(true); // other side is free
    expect(S.checkWallItem('painting_greatgrand', 'h:5:5', 1, p.id).ok).toBe(true); // moving onto itself
    addWall(state, 'h:6:5');
    addObj(state, 'window_grimy', { kind: 'opening', edge: 'h:6:5' });
    expect(S.checkWallItem('painting_greatgrand', 'h:6:5', 1)).toMatchObject({ ok: false, reason: "Something's in the way" });
  });

  it('rejects bad edges / sides / defs and walls whose mounted side is off the buildable area', () => {
    const { state, S } = setup();
    addWall(state, 'v:1:5'); // side 0 = tile (0,5): margin
    expect(S.checkWallItem('painting_greatgrand', 'v:1:5', 0)).toMatchObject({ ok: false, reason: 'Outside your lot' });
    expect(S.checkWallItem('painting_greatgrand', 'v:1:5', 1).ok).toBe(true);
    expect(S.checkWallItem('painting_greatgrand', 'junk', 1)).toMatchObject({ ok: false, reason: 'Needs a wall' });
    expect(S.checkWallItem('painting_greatgrand', 'v:1:5', 2 as 0)).toMatchObject({ ok: false, reason: 'Needs a wall' });
    expect(S.checkWallItem('chair_creaky', 'v:1:5', 1)).toMatchObject({ ok: false, reason: R.notWallItem });
    expect(S.checkWallItem('nope', 'v:1:5', 1)).toMatchObject({ ok: false, reason: R.unknown });
  });

  it('flags a blocked admire slot', () => {
    const { state, S } = setup();
    addWall(state, 'h:5:5');
    addFloor(state, 'shelf_moldering', 5, 5, 0);
    expect(S.checkWallItem('painting_greatgrand', 'h:5:5', 1)).toMatchObject({ ok: true, blockedSlots: [0] });
  });
});

describe('checkOpening', () => {
  it('needs a wall; doors need both side tiles walkable, windows do not', () => {
    const { state, S } = setup();
    expect(S.checkOpening('door_splintered', 'h:5:5')).toMatchObject({ ok: false, reason: 'Needs a wall' });
    addWall(state, 'h:5:5');
    expect(S.checkOpening('door_splintered', 'h:5:5')).toMatchObject({ ok: true, cost: 120 });
    addFloor(state, 'chair_creaky', 5, 4, 0);
    expect(S.checkOpening('door_splintered', 'h:5:5')).toMatchObject({ ok: false, reason: "Something's in the way" });
    expect(S.checkOpening('window_grimy', 'h:5:5').ok).toBe(true);
  });

  it('one opening per segment, no wall items on it, buildable edges only', () => {
    const { state, S } = setup();
    addWall(state, 'h:5:5');
    const d = addObj(state, 'door_splintered', { kind: 'opening', edge: 'h:5:5' });
    expect(S.checkOpening('window_grimy', 'h:5:5')).toMatchObject({ ok: false, reason: "Something's in the way" });
    expect(S.checkOpening('door_splintered', 'h:5:5', d.id).ok).toBe(true);
    addWall(state, 'h:8:5');
    addObj(state, 'sconce_candle', { kind: 'wall', edge: 'h:8:5', side: 0 });
    expect(S.checkOpening('window_grimy', 'h:8:5')).toMatchObject({ ok: false, reason: "Something's in the way" });
    addWall(state, 'v:0:5'); // lot boundary: side 0 is off the lot
    expect(S.checkOpening('door_splintered', 'v:0:5')).toMatchObject({ ok: false, reason: 'Outside your lot' });
    addWall(state, 'h:5:28'); // touches the sidewalk row
    expect(S.checkOpening('door_splintered', 'h:5:28')).toMatchObject({ ok: false, reason: 'Outside your lot' });
    expect(S.checkOpening('chair_creaky', 'h:5:5')).toMatchObject({ ok: false, reason: R.notOpening });
    expect(S.checkOpening('door_splintered', '???')).toMatchObject({ ok: false, reason: 'Needs a wall' });
  });
});
