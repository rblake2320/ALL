import { describe, expect, it } from 'vitest';
import { createSpatial, rectEdges } from '../../../src/sim/spatial';
import { computeRooms } from '../../../src/sim/spatial/rooms';
import { addObj, addWalls, blankLot, bump, makeContent, makeWorld } from './fixtures';

function setup(w = 12, d = 12) {
  const state = makeWorld(blankLot(w, d));
  const S = createSpatial(() => state, makeContent());
  return { state, S };
}

describe('rooms', () => {
  it('an open lot is one outdoor room covering every tile', () => {
    const { S } = setup();
    const rooms = S.rooms();
    expect(rooms.length).toBe(1);
    expect(rooms[0]).toMatchObject({ id: 0, indoor: false });
    expect(rooms[0].tiles.length).toBe(144);
    expect(S.isIndoor(5, 5)).toBe(false);
  });

  it('an enclosed rectangle becomes room 1 with exactly its tiles', () => {
    const { state, S } = setup();
    addWalls(state, rectEdges(3, 3, 6, 5));
    const r = S.rooms();
    expect(r.length).toBe(2);
    expect(r[1]).toMatchObject({ id: 1, indoor: true });
    expect(r[1].tiles).toEqual([39, 40, 41, 51, 52, 53]);
    expect(S.roomAt(4, 4)).toBe(1);
    expect(S.isIndoor(3, 3)).toBe(true);
    expect(S.roomAt(6, 4)).toBe(0);
    expect(r[0].tiles.length + r[1].tiles.length).toBe(144);
  });

  it('doors and windows still separate rooms', () => {
    const { state, S } = setup();
    addWalls(state, rectEdges(3, 3, 6, 6));
    addObj(state, 'door_splintered', { kind: 'opening', edge: 'h:4:6' });
    addObj(state, 'window_grimy', { kind: 'opening', edge: 'v:3:4' });
    bump(state);
    expect(S.roomAt(4, 4)).toBe(1);
    expect(S.roomAt(4, 6)).toBe(0);
  });

  it('ids are ordered by minimum tile index and regions touching the lot edge are outdoors', () => {
    const { state, S } = setup();
    addWalls(state, rectEdges(6, 6, 9, 9)); // later in index order
    addWalls(state, rectEdges(1, 1, 3, 3)); // earlier
    addWalls(state, rectEdges(0, 9, 3, 12)); // touches the lot boundary -> outdoors
    const rooms = S.rooms();
    expect(rooms.map((r) => r.id)).toEqual([0, 1, 2]);
    expect(S.roomAt(1, 1)).toBe(1);
    expect(S.roomAt(7, 7)).toBe(2);
    expect(S.roomAt(1, 10)).toBe(0);
  });

  it('nested rooms get distinct ids; a room is never the outdoor id', () => {
    const { state, S } = setup(14, 14);
    addWalls(state, rectEdges(2, 2, 12, 12));
    addWalls(state, rectEdges(5, 5, 8, 8));
    expect(S.roomAt(3, 3)).toBe(1);
    expect(S.roomAt(6, 6)).toBe(2);
  });

  it('recomputes after a wall is removed (wallVersion bump)', () => {
    const { state, S } = setup();
    addWalls(state, rectEdges(3, 3, 6, 6));
    expect(S.roomAt(4, 4)).toBe(1);
    delete state.lot.walls['h:4:6'];
    state.lot.wallVersion++;
    state.lot.version++;
    expect(S.roomAt(4, 4)).toBe(0);
    expect(S.rooms().length).toBe(1);
    state.lot.walls['h:4:6'] = { paint: ['a', 'b'], openingId: null };
    S.invalidate();
    expect(S.roomAt(4, 4)).toBe(1);
  });

  it('picks up a wall edit even when only lot.version was bumped, and survives paint-only bumps', () => {
    const { state, S } = setup();
    addWalls(state, rectEdges(3, 3, 6, 6));
    expect(S.roomAt(4, 4)).toBe(1);
    delete state.lot.walls['v:6:4'];
    state.lot.version++; // writer forgot wallVersion
    expect(S.roomAt(4, 4)).toBe(0);
    state.lot.walls['v:6:4'] = { paint: ['a', 'b'], openingId: null };
    state.lot.version++;
    expect(S.roomAt(4, 4)).toBe(1);
    state.lot.walls['v:6:4'].paint = ['c', 'd'];
    state.lot.wallVersion++; // paint only
    expect(S.rooms().length).toBe(2);
  });

  it('returned room arrays are copies (callers may mutate them)', () => {
    const { state, S } = setup();
    addWalls(state, rectEdges(3, 3, 6, 6));
    const a = S.rooms();
    a[1].tiles.length = 0;
    a.pop();
    expect(S.rooms()[1].tiles.length).toBe(9);
  });

  it('computeRooms partitions every tile exactly once (property check)', () => {
    const w = 9;
    const d = 7;
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    for (let trial = 0; trial < 30; trial++) {
      const H = new Set<string>();
      const V = new Set<string>();
      for (let i = 0; i < 25; i++) {
        H.add(`${Math.floor(rnd() * w)},${Math.floor(rnd() * (d + 1))}`);
        V.add(`${Math.floor(rnd() * (w + 1))},${Math.floor(rnd() * d)}`);
      }
      const rd = computeRooms(w, d, (x, z) => H.has(`${x},${z}`), (x, z) => V.has(`${x},${z}`));
      const seen = new Array(w * d).fill(0);
      for (const r of rd.rooms) for (const t of r.tiles) seen[t]++;
      expect(seen.every((c) => c === 1)).toBe(true);
      for (const r of rd.rooms) for (const t of r.tiles) expect(rd.roomOf[t]).toBe(r.id);
      // boundary tiles are always outdoors
      for (let x = 0; x < w; x++) expect(rd.roomOf[x]).toBe(0);
      // neighbours with no wall between them share a room
      for (let z = 0; z < d; z++)
        for (let x = 0; x < w; x++) {
          if (x + 1 < w && !V.has(`${x + 1},${z}`)) expect(rd.roomOf[z * w + x]).toBe(rd.roomOf[z * w + x + 1]);
          if (z + 1 < d && !H.has(`${x},${z + 1}`)) expect(rd.roomOf[z * w + x]).toBe(rd.roomOf[(z + 1) * w + x]);
        }
    }
  });
});
