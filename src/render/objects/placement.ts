/**
 * Placement → world transform for every ObjectPlacement kind. Pure; mirrors src/shared/dimensions.ts
 * (localToWorld / rotYaw) without allocating so it can run per frame.
 *
 *  floor   model centre = localToWorld(w, d, x, z, rot, w/2, d/2), yaw = rotYaw(rot)
 *  wall    on the wall surface of `side`, facing into that side's tile (see edges.ts)
 *  opening centred on the wall plane at the edge midpoint
 *  loose   (x, y, z) with yaw = facing
 *  held    hidden (the rig shows the carried visual)
 */
import type { ObjectPlacement } from '../../sim/types';
import type { Rot } from '../../shared/dimensions';
import { DIM } from '../../shared/dimensions';
import { openingTransform, parseEdgeKey, wallItemTransform, normalizeSide, type EdgeTransform } from '../build/edges';

export interface PlacementTransform {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** False for held items and for malformed placements (which must never crash the renderer). */
  visible: boolean;
}

export function createPlacementTransform(): PlacementTransform {
  return { x: 0, y: 0, z: 0, yaw: 0, visible: false };
}

/** Coerce anything into a valid rotation index (NaN/garbage → 0, 5 → 1, -1 → 3). */
export function normalizeRot(r: unknown): Rot {
  const n = typeof r === 'number' && Number.isFinite(r) ? Math.round(r) : 0;
  return (((n % 4) + 4) % 4) as Rot;
}

/** Footprint dimension sanitiser (≥ 1e-3, finite; default 1). */
export function sanitizeDim(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 1e-3 && v < 1000 ? v : 1;
}

/** Yaw for a rotation index (same as rotYaw in dimensions.ts). */
export function yawForRot(r: Rot): number {
  return (-r * Math.PI) / 2;
}

/**
 * World centre of a floor object's footprint: identical to
 * localToWorld(w, d, ox, oz, rot, w/2, d/2) from src/shared/dimensions.ts.
 */
export function floorCenter(w: number, d: number, ox: number, oz: number, r: Rot, out: { x: number; z: number }): { x: number; z: number } {
  const px = w / 2;
  const pz = d / 2;
  switch (r) {
    case 0:
      out.x = ox + px;
      out.z = oz + pz;
      break;
    case 1:
      out.x = ox + (d - pz);
      out.z = oz + px;
      break;
    case 2:
      out.x = ox + (w - px);
      out.z = oz + (d - pz);
      break;
    case 3:
      out.x = ox + pz;
      out.z = oz + (w - px);
      break;
  }
  return out;
}

const tmpCenter = { x: 0, z: 0 };
const tmpEdgeT: EdgeTransform = { x: 0, y: 0, z: 0, yaw: 0 };

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Compute the transform for a placement. `footprint` is the UNROTATED catalog footprint.
 * Returns `out.visible` (false = hide the object).
 */
export function placementTransform(
  placement: ObjectPlacement | null | undefined,
  footprint: { w: number; d: number } | null | undefined,
  out: PlacementTransform,
  wallThickness: number = DIM.WALL_THICKNESS,
): PlacementTransform {
  out.visible = false;
  if (!placement || typeof placement !== 'object') return out;
  switch (placement.kind) {
    case 'floor': {
      if (!isNum(placement.x) || !isNum(placement.z)) return out;
      const w = sanitizeDim(footprint?.w);
      const d = sanitizeDim(footprint?.d);
      const r = normalizeRot(placement.rot);
      floorCenter(w, d, placement.x, placement.z, r, tmpCenter);
      out.x = tmpCenter.x;
      out.y = 0;
      out.z = tmpCenter.z;
      out.yaw = yawForRot(r);
      out.visible = true;
      return out;
    }
    case 'wall': {
      const e = parseEdgeKey(placement.edge);
      if (!e) return out;
      wallItemTransform(e, normalizeSide(placement.side), tmpEdgeT, wallThickness);
      out.x = tmpEdgeT.x;
      out.y = 0;
      out.z = tmpEdgeT.z;
      out.yaw = tmpEdgeT.yaw;
      out.visible = true;
      return out;
    }
    case 'opening': {
      const e = parseEdgeKey(placement.edge);
      if (!e) return out;
      openingTransform(e, tmpEdgeT);
      out.x = tmpEdgeT.x;
      out.y = 0;
      out.z = tmpEdgeT.z;
      out.yaw = tmpEdgeT.yaw;
      out.visible = true;
      return out;
    }
    case 'loose': {
      if (!isNum(placement.x) || !isNum(placement.z)) return out;
      out.x = placement.x;
      out.y = isNum(placement.y) ? placement.y : 0;
      out.z = placement.z;
      out.yaw = isNum(placement.facing) ? placement.facing : 0;
      out.visible = true;
      return out;
    }
    case 'held':
    default:
      return out;
  }
}

/**
 * Cheap numeric signature of a placement so per-frame sync can detect moves even if a system forgot to bump `rev`.
 * Not cryptographic; collisions only cost a missed transform refresh until the next rev bump.
 */
export function placementSignature(p: ObjectPlacement | null | undefined): number {
  if (!p || typeof p !== 'object') return -1;
  switch (p.kind) {
    case 'floor':
      return 1 + (fin(p.x) * 7919 + fin(p.z) * 104729 + fin(p.rot) * 13) * 1.0001;
    case 'loose':
      return 2 + fin(p.x) * 7919.37 + fin(p.z) * 104729.11 + fin(p.y) * 31.7 + fin(p.facing) * 3.3;
    case 'wall':
      return 3 + strSig(p.edge) * 2 + (p.side === 1 ? 1 : 0);
    case 'opening':
      return 4 + strSig(p.edge) * 2;
    case 'held':
      return 5;
    default:
      return -1;
  }
}

function fin(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function strSig(s: unknown): number {
  if (typeof s !== 'string') return 0;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000003;
  return h;
}
