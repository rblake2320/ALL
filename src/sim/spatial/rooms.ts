/**
 * ROOM DETECTION (SIM-SPATIAL) — pure flood fill over wall arrays.
 *
 * Conventions:
 *  - 4-neighbour flood fill; ANY wall segment separates rooms (doors and windows count as walls for rooms).
 *  - Every region that contains a tile on the lot boundary (x = 0, z = 0, x = w-1 or z = d-1) is OUTDOORS = room 0
 *    (all such regions merge into room 0).
 *  - Enclosed regions get ids 1..n ordered by their minimum tile index (z * w + x).
 *  - `rooms[0]` is always the outdoor room ({ id: 0, indoor: false }); `rooms[k]` has id k.
 */
import type { RoomInfo } from '../contracts';

export interface RoomData {
  /** Room id per tile index. */
  roomOf: Int32Array;
  rooms: RoomInfo[];
}

/**
 * @param hasH (x, z) -> edge 'h:x:z' has a wall segment.
 * @param hasV (x, z) -> edge 'v:x:z' has a wall segment.
 */
export function computeRooms(
  w: number,
  d: number,
  hasH: (x: number, z: number) => boolean,
  hasV: (x: number, z: number) => boolean,
): RoomData {
  const n = w * d;
  const comp = new Int32Array(n).fill(-1);
  const compTiles: number[][] = [];
  const compOutdoor: boolean[] = [];
  const stack: number[] = [];
  for (let start = 0; start < n; start++) {
    if (comp[start] !== -1) continue;
    const c = compTiles.length;
    const tiles: number[] = [];
    let outdoor = false;
    comp[start] = c;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop() as number;
      tiles.push(i);
      const x = i % w;
      const z = (i - x) / w;
      if (x === 0 || z === 0 || x === w - 1 || z === d - 1) outdoor = true;
      // east: crosses v:(x+1):z
      if (x + 1 < w && comp[i + 1] === -1 && !hasV(x + 1, z)) {
        comp[i + 1] = c;
        stack.push(i + 1);
      }
      // west: crosses v:x:z
      if (x - 1 >= 0 && comp[i - 1] === -1 && !hasV(x, z)) {
        comp[i - 1] = c;
        stack.push(i - 1);
      }
      // south (+Z): crosses h:x:(z+1)
      if (z + 1 < d && comp[i + w] === -1 && !hasH(x, z + 1)) {
        comp[i + w] = c;
        stack.push(i + w);
      }
      // north (-Z): crosses h:x:z
      if (z - 1 >= 0 && comp[i - w] === -1 && !hasH(x, z)) {
        comp[i - w] = c;
        stack.push(i - w);
      }
    }
    tiles.sort((a, b) => a - b);
    compTiles.push(tiles);
    compOutdoor.push(outdoor);
  }

  // Components are discovered in order of their minimum tile index, so indoor ids follow that order.
  const roomOf = new Int32Array(n);
  const compRoom = new Int32Array(compTiles.length);
  const outdoorTiles: number[] = [];
  const rooms: RoomInfo[] = [{ id: 0, indoor: false, tiles: outdoorTiles }];
  for (let c = 0; c < compTiles.length; c++) {
    if (compOutdoor[c]) {
      compRoom[c] = 0;
      for (const t of compTiles[c]) outdoorTiles.push(t);
    } else {
      const id = rooms.length;
      compRoom[c] = id;
      rooms.push({ id, indoor: true, tiles: compTiles[c] });
    }
  }
  outdoorTiles.sort((a, b) => a - b);
  for (let i = 0; i < n; i++) roomOf[i] = compRoom[comp[i]];
  return { roomOf, rooms };
}
