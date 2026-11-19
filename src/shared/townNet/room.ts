/**
 * One room of the shared town: who is in it and where they stand. PURE and deterministic.
 *
 * The SERVER owns a room and is the only one that moves anybody (docs/CORE_CONCEPT.md: "one server runs the rules and
 * has the final say"). A browser runs the very same `stepWalk` on its own zombie to show the move at once, then
 * checks itself against what the server says.
 *
 * Nobody can walk faster by sending more messages: each tick a player earns one step, may save up at most
 * `INPUT_BURST`, and every step is the same length.
 */
import { canStand, spawnPoint, type WalkArea } from './street';
import type { InputMsg, PlayerInfo, SnapMsg, TownLook } from './protocol';

/** Server ticks per second. One input = one tick of walking. */
export const TOWN_TICK_HZ = 30;
/** A snapshot is sent every this many ticks. */
export const SNAP_EVERY_TICKS = 2;
/** Walking speed, tiles per second (a tile is one metre). One pace for everyone (fixed rule 1). */
export const WALK_SPEED = 2.4;
/** Players in one room. More players open another room. */
export const ROOM_CAPACITY = 24;
/** Steps a player may save up while their messages are delayed. */
export const INPUT_BURST = 6;
/** Inputs kept waiting per player; older ones are dropped. */
export const INPUT_QUEUE_MAX = 12;
/** A zombie still counts as walking for this many ticks after its last step (hides network gaps from the animation). */
export const MOVING_HOLD_TICKS = 5;

export interface Walker {
  x: number;
  z: number;
  facing: number;
}

/**
 * One tick of walking in direction (mx, mz). Uses only + - * / and sqrt, which give the same bits in every engine, so
 * a browser's prediction matches the server exactly. Slides along the edge of the walkable area. Returns whether the
 * zombie moved.
 */
export function stepWalk(w: Walker, mx: number, mz: number, area: WalkArea): boolean {
  if (!Number.isFinite(mx) || !Number.isFinite(mz)) return false;
  let len = Math.sqrt(mx * mx + mz * mz);
  if (len < 0.05) return false;
  if (len > 1) {
    mx /= len;
    mz /= len;
    len = 1;
  }
  const step = WALK_SPEED / TOWN_TICK_HZ;
  const nx = w.x + mx * step;
  const nz = w.z + mz * step;
  w.facing = Math.atan2(mx, mz);
  if (canStand(area, nx, nz)) {
    w.x = nx;
    w.z = nz;
    return true;
  }
  if (mx !== 0 && canStand(area, nx, w.z)) {
    w.x = nx;
    return true;
  }
  if (mz !== 0 && canStand(area, w.x, nz)) {
    w.z = nz;
    return true;
  }
  return false;
}

export interface RoomPlayer extends Walker {
  id: number;
  name: number;
  look: TownLook;
  /** Highest input seq applied. */
  lastSeq: number;
  /** Steps this player may take now (0 .. INPUT_BURST). */
  budget: number;
  queue: InputMsg[];
  /** Tick of the last step that moved the zombie; -1 = never. */
  movedTick: number;
}

export interface Room {
  area: WalkArea;
  tick: number;
  nextId: number;
  /** Total players ever admitted (drives the spawn point). */
  admitted: number;
  players: Map<number, RoomPlayer>;
}

export function createRoom(area: WalkArea): Room {
  return { area, tick: 0, nextId: 1, admitted: 0, players: new Map() };
}

export const roomIsFull = (room: Room): boolean => room.players.size >= ROOM_CAPACITY;

/** Admit a player, or null when the room is full. */
export function addPlayer(room: Room, name: number, look: TownLook): RoomPlayer | null {
  if (roomIsFull(room)) return null;
  const at = spawnPoint(room.area, room.admitted);
  const p: RoomPlayer = { id: room.nextId, name, look, x: at.x, z: at.z, facing: 0, lastSeq: 0, budget: 1, queue: [], movedTick: -1 };
  room.nextId += 1;
  room.admitted += 1;
  room.players.set(p.id, p);
  return p;
}

export function removePlayer(room: Room, id: number): boolean {
  return room.players.delete(id);
}

/** Queue a player's input. Out-of-order and repeated `seq` are dropped; a full queue drops its oldest entry. */
export function queueInput(room: Room, id: number, msg: InputMsg): boolean {
  const p = room.players.get(id);
  if (!p) return false;
  const newest = p.queue.length ? p.queue[p.queue.length - 1].seq : p.lastSeq;
  if (msg.seq <= newest) return false;
  if (p.queue.length >= INPUT_QUEUE_MAX) p.queue.shift();
  p.queue.push(msg);
  return true;
}

/** Advance the room one tick: every player, lowest id first, takes the steps they have earned. */
export function stepRoom(room: Room): void {
  room.tick += 1;
  const ids = [...room.players.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const p = room.players.get(id)!;
    p.budget = Math.min(INPUT_BURST, p.budget + 1);
    while (p.budget > 0 && p.queue.length > 0) {
      const input = p.queue.shift()!;
      p.budget -= 1;
      p.lastSeq = input.seq;
      if (stepWalk(p, input.mx, input.mz, room.area)) p.movedTick = room.tick;
    }
  }
}

export const isMoving = (room: Room, p: RoomPlayer): boolean => p.movedTick >= 0 && room.tick - p.movedTick <= MOVING_HOLD_TICKS;

const round = (n: number, places: number): number => {
  const k = 10 ** places;
  return Math.round(n * k) / k;
};

export function playerInfo(p: RoomPlayer): PlayerInfo {
  return { id: p.id, name: p.name, look: p.look, x: round(p.x, 2), z: round(p.z, 2), f: round(p.facing, 2) };
}

/** The snapshot for one player: everyone else rounded to a centimetre, their own position exact. */
export function snapshotFor(room: Room, id: number, minute: number): SnapMsg | null {
  const me = room.players.get(id);
  if (!me) return null;
  const rows: SnapMsg['p'] = [];
  for (const p of room.players.values()) {
    if (p.id === id) continue;
    rows.push([p.id, round(p.x, 2), round(p.z, 2), round(p.facing, 2), isMoving(room, p) ? 1 : 0]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  return { t: 'snap', k: room.tick, a: me.lastSeq, minute, you: [me.x, me.z], p: rows };
}
