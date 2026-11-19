/**
 * Scene picking policy: agents (capsules) → objects (bounds + precise raycast) → walls (current-height boxes) →
 * ground tiles. Zombies win near-ties with furniture (they sit in sofas, stand at counters); walls occlude everything
 * behind them except objects set into / onto the wall itself (doors, windows, wall items).
 */
import * as THREE from 'three';
import type { PickResult } from '../contracts';
import type { AgentPick } from '../agents/agents';
import type { ObjectPick } from '../objects/objects';
import type { WallPick } from '../build/walls';
import { rayPlaneY } from './rayMath';

/** Agents beat furniture hits up to this much further along the ray (tiles). */
export const AGENT_PICK_BIAS = 0.35;
/**
 * Objects up to this far (measured along the wall normal) behind the wall box's front face still win over the
 * wall: doors/windows sit in the wall plane and thin wall items (paintings, sconces) inside the box margin. Less
 * than the box depth (WALL_THICKNESS + 2 × 0.02), so items on the far side of a wall stay occluded.
 */
export const WALL_OBJECT_TOLERANCE = 0.12;

/** In-wall tolerance along the ray: the normal depth divided by the ray's obliquity to that wall. Pure. */
export function inWallTolerance(edge: unknown, dir: { x: number; z: number }): number {
  const c = typeof edge === 'string' && edge.charCodeAt(0) === 104 /* 'h' */ ? Math.abs(dir.z) : Math.abs(dir.x);
  const cos = Number.isFinite(c) ? Math.min(1, c) : 1;
  return WALL_OBJECT_TOLERANCE / Math.max(0.35, cos);
}

export interface PickSources {
  agents: ((ray: THREE.Ray) => AgentPick | null) | null;
  objects: ((ray: THREE.Ray, maxT: number) => ObjectPick | null) | null;
  walls: ((o: THREE.Vector3, d: THREE.Vector3) => WallPick | null) | null;
  /** Strays and household pets (W-013): wins like an agent (animals stand next to furniture). */
  pets?: ((ray: THREE.Ray) => { id: string; kind: 'stray' | 'pet'; t: number; point: THREE.Vector3 } | null) | null;
  /** Lot size for tile hits ([0,width) × [0,depth)); null disables tiles. */
  lot: { width: number; depth: number } | null;
  /**
   * Whether a wall may be the RESULT (default true). Walls always occlude: with false, a ray stopped by a wall
   * yields 'none' instead of reaching agents / objects / floor tiles hidden behind it.
   */
  wallResults?: boolean;
}

/** Resolve a ray into a PickResult. Never throws on garbage hits (non-finite t are ignored). */
export function resolvePick(ray: THREE.Ray, src: PickSources): PickResult {
  const ag = src.agents ? src.agents(ray) : null;
  const wall = src.walls ? src.walls(ray.origin, ray.direction) : null;
  const wallT = wall && Number.isFinite(wall.t) ? wall.t : Infinity;
  const tol = wallT < Infinity ? inWallTolerance(wall!.edge, ray.direction) : 0;
  const obj = src.objects ? src.objects(ray, wallT + tol) : null;
  const objT = obj && Number.isFinite(obj.t) ? obj.t : Infinity;
  const agT = ag && Number.isFinite(ag.t) ? ag.t : Infinity;
  const pet = src.pets ? src.pets(ray) : null;
  const petT = pet && Number.isFinite(pet.t) ? pet.t : Infinity;
  if (pet && petT < Infinity && petT <= wallT && petT <= agT && petT <= objT + AGENT_PICK_BIAS) return { kind: 'pet', petKind: pet.kind, petId: pet.id, point: pet.point };
  if (ag && agT < Infinity && agT <= wallT && agT <= objT + AGENT_PICK_BIAS) return { kind: 'agent', agentId: ag.agentId, point: ag.point };
  if (obj && objT <= wallT + tol && objT < Infinity) return { kind: 'object', objectId: obj.objectId, point: obj.point };
  if (wall && wallT < Infinity) return src.wallResults === false ? { kind: 'none' } : { kind: 'wall', edge: wall.edge, side: wall.side, point: ray.at(wallT, new THREE.Vector3()) };
  if (src.lot) {
    const t = rayPlaneY(ray.origin.y, ray.direction.y, 0);
    if (t !== Infinity) {
      const p = ray.at(t, new THREE.Vector3());
      const w = Number.isFinite(src.lot.width) ? src.lot.width : 0;
      const d = Number.isFinite(src.lot.depth) ? src.lot.depth : 0;
      if (p.x >= 0 && p.z >= 0 && p.x < w && p.z < d) return { kind: 'tile', x: Math.floor(p.x), z: Math.floor(p.z), point: p };
    }
  }
  return { kind: 'none' };
}
