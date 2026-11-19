/**
 * DEV-ONLY tiny SimulationAPI adapter for the render harness: exposes `state`, `spatial.roomAt` (flood-fill
 * rooms bounded by walls), `time()`, `drainEvents()` and a `step()` that walks agents along their `path`.
 * Everything else is a harmless stub.
 */
import type { SimEvent, SimulationAPI } from '../../sim/contracts';
import type { WorldState } from '../../sim/types';
import { TICK_MINUTES } from '../../sim/types';
import { timeInfo } from '../../sim/time';

export interface FakeSim extends SimulationAPI {
  /** Queue an event for the next drain (FX showcase). */
  emit(e: SimEvent): void;
}

/** Room ids per tile: 0 = outdoors (connected to the lot border without crossing a wall). */
export function computeRooms(state: WorldState): Int32Array {
  const lot = state.lot;
  const w = lot.width;
  const d = lot.depth;
  const ids = new Int32Array(w * d).fill(-1);
  const blocked = (x: number, z: number, dx: number, dz: number): boolean => {
    // edge between (x,z) and (x+dx, z+dz)
    if (dx === 1) return !!lot.walls[`v:${x + 1}:${z}`];
    if (dx === -1) return !!lot.walls[`v:${x}:${z}`];
    if (dz === 1) return !!lot.walls[`h:${x}:${z + 1}`];
    return !!lot.walls[`h:${x}:${z}`];
  };
  let next = 1;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (let start = 0; start < w * d; start++) {
    if (ids[start] !== -1) continue;
    const queue = [start];
    const region: number[] = [];
    let touchesBorder = false;
    ids[start] = -2;
    while (queue.length) {
      const i = queue.pop()!;
      region.push(i);
      const x = i % w;
      const z = Math.floor(i / w);
      if (x === 0 || z === 0 || x === w - 1 || z === d - 1) touchesBorder = true;
      for (const [dx, dz] of dirs) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= w || nz >= d) continue;
        const j = nz * w + nx;
        if (ids[j] !== -1 || blocked(x, z, dx, dz)) continue;
        ids[j] = -2;
        queue.push(j);
      }
    }
    const id = touchesBorder ? 0 : next++;
    for (const i of region) ids[i] = id;
  }
  return ids;
}

export function createFakeSim(state: WorldState): FakeSim {
  let rooms: Int32Array | null = null;
  let roomsKey = '';
  const events: SimEvent[] = [];
  const roomAt = (x: number, z: number): number => {
    const key = `${state.lot.version}|${state.lot.wallVersion}`;
    if (!rooms || key !== roomsKey) {
      rooms = computeRooms(state);
      roomsKey = key;
    }
    if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || z < 0 || x >= state.lot.width || z >= state.lot.depth) return 0;
    return rooms[z * state.lot.width + x];
  };
  const speed = 1.3 * TICK_MINUTES; // tiles per tick
  const sim = {
    state,
    content: { objects: {} },
    spatial: { roomAt, isIndoor: (x: number, z: number) => roomAt(x, z) !== 0 },
    build: {},
    step(): void {
      state.tick++;
      for (const a of Object.values(state.agents)) {
        a.prevPos = { x: a.pos.x, z: a.pos.z };
        a.prevFacing = a.facing;
        if (a.anim !== 'walk' && a.anim !== 'limp' && a.anim !== 'crawl') continue;
        const path = a.path;
        if (!path || path.length < 2) continue;
        const target = path[(a.pathIndex + 1) % path.length];
        const dx = target.x - a.pos.x;
        const dz = target.z - a.pos.z;
        const dist = Math.hypot(dx, dz);
        const step = a.anim === 'limp' ? speed * 0.6 : a.anim === 'crawl' ? speed * 0.3 : speed;
        if (dist <= step) {
          a.pos = { x: target.x, z: target.z };
          // loops the path (two-point paths, like sidewalk walk-bys, simply bounce between the ends)
          a.pathIndex = (a.pathIndex + 1) % path.length;
        } else {
          a.pos = { x: a.pos.x + (dx / dist) * step, z: a.pos.z + (dz / dist) * step };
          a.facing = Math.atan2(dx, dz);
        }
      }
    },
    dispatch: () => ({ ok: false, reason: 'fake sim' }),
    drainEvents(): SimEvent[] {
      return events.splice(0, events.length);
    },
    emit(e: SimEvent): void {
      events.push(e);
    },
    faults: () => [],
    time: () => timeInfo(state.tick),
    agent: (id: string) => state.agents[id],
    object: (id: string) => state.objects[id],
    household: () => [],
    summary: () => null,
    onLotSummaries: () => [],
    menu: () => [],
    queueView: () => [],
    needs: () => [],
    moodlets: () => [],
    skills: () => [],
    career: () => null,
    relationships: () => [],
    aspiration: () => null,
    objectView: () => null,
    townies: () => [],
    careersAvailable: () => [],
    party: () => null,
    lotValue: () => 0,
    serialize: () => JSON.parse(JSON.stringify(state)) as WorldState,
    checkInvariants: () => [],
  };
  return sim as unknown as FakeSim;
}
