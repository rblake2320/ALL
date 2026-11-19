/**
 * Edge math (renderer-local implementation of the rules in src/sim/types.ts):
 *   'h:x:z' — horizontal edge from (x,z) to (x+1,z), lying on the line z, running along +X.
 *   'v:x:z' — vertical edge from (x,z) to (x,z+1), lying on the line x, running along +Z.
 * Side 0 is the -Z tile (for 'h') / the -X tile (for 'v'); side 1 is the +Z / +X tile.
 *
 * The edge frame's normal always points toward side 1. Pure, allocation-free when an `out` is supplied.
 */
import { DIM } from '../../shared/dimensions';

export type EdgeKind = 'h' | 'v';

export interface ParsedEdge {
  kind: EdgeKind;
  x: number;
  z: number;
}

export interface EdgeFrame {
  kind: EdgeKind;
  x: number;
  z: number;
  /** Edge endpoints (world). */
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  /** Midpoint (world). */
  midX: number;
  midZ: number;
  /** Unit tangent (start → end). */
  tanX: number;
  tanZ: number;
  /** Unit normal pointing to side 1. */
  nX: number;
  nZ: number;
}

/** Coordinates beyond this are rejected as garbage (lots are ~30 tiles). */
const MAX_COORD = 100000;

/** Parse an EdgeKey; returns null for anything malformed (wrong kind, non-integers, NaN, huge values). */
export function parseEdgeKey(key: unknown): ParsedEdge | null {
  if (typeof key !== 'string' || key.length < 5 || key.length > 32) return null;
  const parts = key.split(':');
  if (parts.length !== 3) return null;
  const kind = parts[0];
  if (kind !== 'h' && kind !== 'v') return null;
  if (!/^-?\d+$/.test(parts[1]) || !/^-?\d+$/.test(parts[2])) return null;
  const x = Number(parts[1]);
  const z = Number(parts[2]);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(z)) return null;
  if (Math.abs(x) > MAX_COORD || Math.abs(z) > MAX_COORD) return null;
  return { kind, x, z };
}

export function edgeKeyOf(kind: EdgeKind, x: number, z: number): string {
  return `${kind}:${x}:${z}`;
}

export function createEdgeFrame(): EdgeFrame {
  return { kind: 'h', x: 0, z: 0, startX: 0, startZ: 0, endX: 1, endZ: 0, midX: 0.5, midZ: 0, tanX: 1, tanZ: 0, nX: 0, nZ: 1 };
}

/** Fill `out` with the world-space frame of an edge. */
export function edgeFrame(e: ParsedEdge, out: EdgeFrame = createEdgeFrame()): EdgeFrame {
  out.kind = e.kind;
  out.x = e.x;
  out.z = e.z;
  out.startX = e.x;
  out.startZ = e.z;
  if (e.kind === 'h') {
    out.endX = e.x + 1;
    out.endZ = e.z;
    out.tanX = 1;
    out.tanZ = 0;
    out.nX = 0;
    out.nZ = 1;
  } else {
    out.endX = e.x;
    out.endZ = e.z + 1;
    out.tanX = 0;
    out.tanZ = 1;
    out.nX = 1;
    out.nZ = 0;
  }
  out.midX = (out.startX + out.endX) / 2;
  out.midZ = (out.startZ + out.endZ) / 2;
  return out;
}

/** Normalise any side-ish input to 0 | 1 (anything other than 1 / '1' / true → 0). */
export function normalizeSide(side: unknown): 0 | 1 {
  return side === 1 || side === '1' || side === true ? 1 : 0;
}

/** The tile on the given side of an edge. */
export function edgeSideTile(e: ParsedEdge, side: 0 | 1, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
  if (e.kind === 'h') {
    out.x = e.x;
    out.z = side === 1 ? e.z : e.z - 1;
  } else {
    out.x = side === 1 ? e.x : e.x - 1;
    out.z = e.z;
  }
  return out;
}

/** Unit direction pointing from the wall plane into the tile on `side`. */
export function sideNormal(e: ParsedEdge, side: 0 | 1, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
  const s = side === 1 ? 1 : -1;
  if (e.kind === 'h') {
    out.x = 0;
    out.z = s;
  } else {
    out.x = s;
    out.z = 0;
  }
  return out;
}

export interface EdgeTransform {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/**
 * Wall item (painting, sconce) transform: origin on the wall SURFACE of `side` (half a wall thickness off the
 * centre line), centred along the edge, local +Z facing into the tile on that side.
 */
export function wallItemTransform(e: ParsedEdge, side: 0 | 1, out: EdgeTransform, thickness: number = DIM.WALL_THICKNESS): EdgeTransform {
  const s = side === 1 ? 1 : -1;
  const half = (Number.isFinite(thickness) && thickness > 0 ? thickness : DIM.WALL_THICKNESS) / 2;
  if (e.kind === 'h') {
    out.x = e.x + 0.5;
    out.z = e.z + s * half;
    out.yaw = s === 1 ? 0 : Math.PI;
  } else {
    out.x = e.x + s * half;
    out.z = e.z + 0.5;
    out.yaw = s === 1 ? Math.PI / 2 : -Math.PI / 2;
  }
  out.y = 0;
  return out;
}

/**
 * Opening (door/window) transform: centred on the wall plane at the edge midpoint; local +X runs along the
 * edge and local +Z faces side 1 ('h': yaw 0 → +Z; 'v': yaw PI/2 → +X).
 */
export function openingTransform(e: ParsedEdge, out: EdgeTransform): EdgeTransform {
  if (e.kind === 'h') {
    out.x = e.x + 0.5;
    out.z = e.z;
    out.yaw = 0;
  } else {
    out.x = e.x;
    out.z = e.z + 0.5;
    out.yaw = Math.PI / 2;
  }
  out.y = 0;
  return out;
}

/** Signed distance of a world point from the edge's line, positive on side 1. */
export function signedDistanceToEdgeLine(e: ParsedEdge, px: number, pz: number): number {
  return e.kind === 'h' ? pz - e.z : px - e.x;
}

/** The four edge keys around a tile (for overlays/tests): top (line z), bottom (line z+1), left (line x), right (line x+1). */
export function tileEdges(x: number, z: number): { top: string; bottom: string; left: string; right: string } {
  return {
    top: edgeKeyOf('h', x, z),
    bottom: edgeKeyOf('h', x, z + 1),
    left: edgeKeyOf('v', x, z),
    right: edgeKeyOf('v', x + 1, z),
  };
}
