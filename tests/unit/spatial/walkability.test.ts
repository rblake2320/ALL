import { describe, expect, it } from 'vitest';
import { createSpatial, rectEdges } from '../../../src/sim/spatial';
import { addFloor, addLoose, addObj, addWall, addWalls, blankLot, bump, makeContent, makeWorld } from './fixtures';

function setup(w = 12, d = 12) {
  const state = makeWorld(blankLot(w, d));
  const content = makeContent();
  const S = createSpatial(() => state, content);
  return { state, content, S };
}

describe('bounds & buildable area', () => {
  it('standard lot: buildable [1,29)x[1,27), sidewalk never buildable, margins walkable', () => {
    const state = makeWorld(blankLot());
    const S = createSpatial(() => state, makeContent());
    expect(S.width()).toBe(30);
    expect(S.depth()).toBe(30);
    expect(S.isBuildable(1, 1)).toBe(true);
    expect(S.isBuildable(28, 26)).toBe(true);
    expect(S.isBuildable(0, 5)).toBe(false);
    expect(S.isBuildable(29, 5)).toBe(false);
    expect(S.isBuildable(5, 27)).toBe(false);
    expect(S.isBuildable(5, 28)).toBe(false);
    expect(S.isWalkable(0, 28)).toBe(true);
    expect(S.isWalkable(29, 29)).toBe(true);
    expect(S.inBounds(29.9, 0)).toBe(true);
    expect(S.inBounds(30, 0)).toBe(false);
    expect(S.inBounds(-0.1, 0)).toBe(false);
    expect(S.tileIndex(3, 2)).toBe(63);
    expect(S.tileIndex(30, 2)).toBe(-1);
    expect(S.tileOf({ x: 3.99, z: 2.01 })).toEqual({ x: 3, z: 2 });
  });

  it('a sidewalk row inside the buildable rect is still not buildable', () => {
    const lot = blankLot(10, 10);
    lot.buildable = { x0: 0, z0: 0, x1: 10, z1: 10 };
    lot.sidewalkZ = 4;
    const state = makeWorld(lot);
    const S = createSpatial(() => state, makeContent());
    expect(S.isBuildable(3, 4)).toBe(false);
    expect(S.isBuildable(3, 3)).toBe(true);
  });

  it('NaN / Infinity / garbage never throw and are never walkable', () => {
    const { S } = setup();
    for (const v of [NaN, Infinity, -Infinity]) {
      expect(S.inBounds(v, 1)).toBe(false);
      expect(S.isWalkable(1, v)).toBe(false);
      expect(S.isBuildable(v, v)).toBe(false);
      expect(S.canStep(v, 1, 1, 1)).toBe(false);
      expect(S.tileIndex(v, 0)).toBe(-1);
      expect(S.roomAt(v, 0)).toBe(0);
      expect(S.objectsAt(v, 0)).toEqual([]);
    }
    expect(() => S.tileOf(null as never)).not.toThrow();
    expect(S.debugFaults()).toEqual([]);
  });

  it('follows getState() when the world object is replaced (load / new game)', () => {
    const a = makeWorld(blankLot(10, 10));
    const b = makeWorld(blankLot(10, 10));
    addFloor(b, 'chair_creaky', 4, 4, 0);
    let current = a;
    const S = createSpatial(() => current, makeContent());
    expect(S.isWalkable(4, 4)).toBe(true);
    current = b; // same versions, different world
    expect(S.isWalkable(4, 4)).toBe(false);
    current = a;
    expect(S.isWalkable(4, 4)).toBe(true);
  });

  it('survives a missing / malformed lot', () => {
    const state = makeWorld(blankLot(8, 8));
    const S = createSpatial(() => state, makeContent());
    (state as unknown as { lot: unknown }).lot = null;
    expect(S.width()).toBe(0);
    expect(S.isWalkable(1, 1)).toBe(false);
    expect(S.findPath({ x: 1, z: 1 }, { x: 2, z: 2 })).toBeNull();
    (state as unknown as { lot: unknown }).lot = { width: NaN, depth: 'x', walls: null, floors: null };
    expect(S.isWalkable(0, 0)).toBe(false);
    expect(S.rooms()).toEqual([{ id: 0, indoor: false, tiles: [] }]);
  });
});

describe('occupancy', () => {
  it('non-passable floor objects block every footprint tile (rotation aware)', () => {
    const { state, S } = setup();
    addFloor(state, 'sofa_velvet', 2, 2, 1); // 3x1 rotated -> 1 wide x 3 deep
    expect([S.isWalkable(2, 2), S.isWalkable(2, 3), S.isWalkable(2, 4)]).toEqual([false, false, false]);
    expect(S.isWalkable(3, 2)).toBe(true);
    expect(S.isWalkable(2, 5)).toBe(true);
    expect(S.objectsAt(2, 3).length).toBe(1);
  });

  it('rugs and passable items never block; fire does', () => {
    const { state, S } = setup();
    addFloor(state, 'rug_funeral', 4, 4, 0);
    addLoose(state, 'item_dish', 1.5, 1.5);
    addLoose(state, 'item_limb_arm', 2.5, 1.5);
    const fire = addLoose(state, 'item_fire', 7.5, 7.5);
    expect(S.isWalkable(5, 5)).toBe(true);
    expect(S.objectsAt(5, 5)).toEqual([]); // rugs are not reported as floor objects
    expect(S.isWalkable(1, 1)).toBe(true);
    expect(S.isWalkable(2, 1)).toBe(true);
    expect(S.isWalkable(7, 7)).toBe(false);
    delete state.objects[fire.id];
    bump(state);
    expect(S.isWalkable(7, 7)).toBe(true);
  });

  it('unknown defIds and malformed placements are ignored safely', () => {
    const { state, S } = setup();
    addObj(state, 'no_such_thing', { kind: 'floor', x: 3, z: 3, rot: 0 });
    addObj(state, 'sofa_moldy', { kind: 'floor', x: NaN, z: 3, rot: 0 });
    addObj(state, 'sofa_moldy', { kind: 'floor', x: 1, z: 1, rot: 7 as 0 }); // rot wraps to 3
    addObj(state, 'sofa_moldy', { kind: 'floor', x: 5, z: 5, rot: 0.5 as 0 }); // non-integer rot ignored
    addObj(state, 'sofa_moldy', { kind: 'floor', x: 40, z: 40, rot: 0 }); // off the lot
    (state.objects as Record<string, unknown>).junk = null;
    (state.objects as Record<string, unknown>).junk2 = { id: 'junk2', defId: 'sofa_moldy' };
    bump(state);
    expect(S.isWalkable(3, 3)).toBe(true);
    expect(S.isWalkable(1, 1)).toBe(false); // the wrapped-rotation sofa covers (1,1),(1,2)
    expect(S.isWalkable(1, 2)).toBe(false);
    expect(S.isWalkable(5, 5)).toBe(true);
    expect(S.debugFaults()).toEqual([]);
  });

  it('notices a fire spawned without a version bump on the next tick, and immediately after invalidate()', () => {
    const { state, S } = setup();
    expect(S.isWalkable(6, 6)).toBe(true);
    addLoose(state, 'item_fire', 6.5, 6.5);
    state.lot.version--; // pretend the spawner forgot to bump
    expect(S.isWalkable(6, 6)).toBe(true); // stale within the same tick (documented)
    state.tick++;
    expect(S.isWalkable(6, 6)).toBe(false);
    const f2 = addLoose(state, 'item_fire', 8.5, 6.5);
    state.lot.version--;
    S.invalidate();
    expect(S.isWalkable(8, 6)).toBe(false);
    void f2;
  });
});

describe('walls, doors and windows', () => {
  it('a plain wall blocks the orthogonal step across it in both directions', () => {
    const { state, S } = setup();
    addWall(state, 'v:5:5'); // between (4,5) and (5,5)
    expect(S.canStep(4, 5, 5, 5)).toBe(false);
    expect(S.canStep(5, 5, 4, 5)).toBe(false);
    expect(S.canStep(4, 4, 5, 4)).toBe(true);
    addWall(state, 'h:2:3'); // between (2,2) and (2,3)
    expect(S.canStep(2, 2, 2, 3)).toBe(false);
    expect(S.canStep(2, 3, 2, 2)).toBe(false);
  });

  it('doors pass, windows block, unknown / dangling openings block', () => {
    const { state, S } = setup();
    addWalls(state, ['v:5:1', 'v:5:2', 'v:5:3', 'v:5:4']);
    addObj(state, 'door_splintered', { kind: 'opening', edge: 'v:5:1' });
    addObj(state, 'window_grimy', { kind: 'opening', edge: 'v:5:2' });
    addObj(state, 'mystery_portal', { kind: 'opening', edge: 'v:5:3' });
    state.lot.walls['v:5:4'].openingId = 'o999'; // dangling link
    bump(state);
    expect(S.canStep(4, 1, 5, 1)).toBe(true);
    expect(S.canStep(5, 1, 4, 1)).toBe(true);
    expect(S.canStep(4, 2, 5, 2)).toBe(false);
    expect(S.canStep(4, 3, 5, 3)).toBe(false);
    expect(S.canStep(4, 4, 5, 4)).toBe(false);
  });

  it('an opening object on an edge works even when the wall was never linked to it', () => {
    const { state, S } = setup();
    addWall(state, 'h:3:6');
    addObj(state, 'door_splintered', { kind: 'opening', edge: 'h:3:6' });
    state.lot.walls['h:3:6'].openingId = null;
    bump(state);
    expect(S.canStep(3, 5, 3, 6)).toBe(true);
  });

  it('accepts non-canonical wall keys from old saves', () => {
    const { state, S } = setup();
    state.lot.walls['v:05:005'] = { paint: ['a', 'b'], openingId: null };
    bump(state);
    expect(S.canStep(4, 5, 5, 5)).toBe(false);
  });
});

describe('canStep: diagonals and corner cutting', () => {
  it('allows open diagonals', () => {
    const { S } = setup();
    expect(S.canStep(3, 3, 4, 4)).toBe(true);
    expect(S.canStep(4, 4, 3, 3)).toBe(true);
    expect(S.canStep(3, 3, 2, 4)).toBe(true);
    expect(S.canStep(3, 3, 4, 2)).toBe(true);
  });

  it('blocks a diagonal when ANY of the 4 edges meeting at the shared corner has a wall', () => {
    // diagonal (3,3) -> (4,4) shares corner point (4,4); its four edges:
    for (const e of ['h:3:4', 'h:4:4', 'v:4:3', 'v:4:4']) {
      const { state, S } = setup();
      addWall(state, e);
      expect(S.canStep(3, 3, 4, 4), e).toBe(false);
      expect(S.canStep(4, 4, 3, 3), e).toBe(false);
      // the other diagonal through the same corner is blocked too: (4,3)->(3,4)
      expect(S.canStep(4, 3, 3, 4), e).toBe(false);
    }
  });

  it('blocks corner cutting past a wall END (wall ends exactly at the corner)', () => {
    const { state, S } = setup();
    addWalls(state, ['v:4:0', 'v:4:1', 'v:4:2', 'v:4:3']); // wall along x=4 from z=0 to z=4, ends at point (4,4)
    expect(S.canStep(3, 3, 4, 4)).toBe(false); // would slip past the wall end
    expect(S.canStep(3, 4, 4, 4)).toBe(true); // going below the wall end orthogonally is fine
    expect(S.canStep(3, 4, 4, 5)).toBe(true); // diagonal one row further down is clear
  });

  it('doors and windows count as walls for corner cutting', () => {
    const { state, S } = setup();
    addWall(state, 'h:4:4');
    addObj(state, 'door_splintered', { kind: 'opening', edge: 'h:4:4' });
    bump(state);
    expect(S.canStep(4, 3, 4, 4)).toBe(true); // straight through the door
    expect(S.canStep(3, 3, 4, 4)).toBe(false); // not diagonally through its frame
    expect(S.canStep(5, 3, 4, 4)).toBe(false);
  });

  it('blocks diagonals squeezing between two blocked tiles or past one', () => {
    const { state, S } = setup();
    addFloor(state, 'chair_creaky', 4, 3, 0);
    expect(S.canStep(3, 3, 4, 4)).toBe(false); // intermediate (4,3) blocked
    expect(S.canStep(4, 4, 3, 3)).toBe(false);
    addFloor(state, 'chair_creaky', 3, 4, 0);
    expect(S.canStep(3, 3, 4, 4)).toBe(false);
    expect(S.canStep(3, 3, 2, 4)).toBe(false); // intermediate (3,4) is the second chair
    expect(S.canStep(3, 3, 2, 2)).toBe(true); // (2,3) and (3,2) are clear
  });

  it('destination must be walkable; the source may be blocked (stepping out of furniture)', () => {
    const { state, S } = setup();
    addFloor(state, 'chair_creaky', 5, 5, 0);
    expect(S.canStep(4, 5, 5, 5)).toBe(false);
    expect(S.canStep(5, 5, 4, 5)).toBe(true);
    expect(S.canStep(5, 5, 6, 6)).toBe(true);
  });

  it('rejects non-neighbours, same tile and off-lot steps', () => {
    const { S } = setup();
    expect(S.canStep(3, 3, 3, 3)).toBe(false);
    expect(S.canStep(3, 3, 5, 3)).toBe(false);
    expect(S.canStep(0, 0, -1, 0)).toBe(false);
    expect(S.canStep(11, 11, 12, 12)).toBe(false);
  });

  it('canStep is symmetric when both tiles are walkable (exhaustive over a walled grid)', () => {
    const { state, S } = setup(8, 8);
    addWalls(state, [...rectEdges(2, 2, 5, 5), 'v:6:0', 'h:6:7']);
    addObj(state, 'door_splintered', { kind: 'opening', edge: 'h:3:2' });
    addFloor(state, 'chair_creaky', 6, 3, 0);
    bump(state);
    for (let z = 0; z < 8; z++)
      for (let x = 0; x < 8; x++)
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dz) continue;
            const tx = x + dx;
            const tz = z + dz;
            if (!S.isWalkable(x, z) || !S.isWalkable(tx, tz)) continue;
            expect(S.canStep(x, z, tx, tz)).toBe(S.canStep(tx, tz, x, z));
          }
  });
});
