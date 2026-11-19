/**
 * Shared physical conventions. The simulation, renderer, furniture models and character rig
 * MUST agree on these numbers. 1 world unit = 1 lot tile (~1 metre).
 *
 * Axes: X right, Y up, Z toward the street ("front"). Lot tile (x,z) spans [x,x+1]x[z,z+1].
 * Model-local convention for furniture: footprint centred on origin, x in [-w/2,w/2],
 * z in [-d/2,d/2], y from 0 (floor). Object FRONT faces +Z (the side zombies approach from).
 * Character-local convention: feet on y=0, facing +Z.
 */
export const DIM = {
  TILE: 1,
  WALL_HEIGHT: 2.7,
  WALL_THICKNESS: 0.12,
  WALL_CUTAWAY_HEIGHT: 0.28,
  DOOR_WIDTH: 0.86,
  DOOR_HEIGHT: 2.1,
  WINDOW_WIDTH: 0.78,
  WINDOW_SILL: 0.9,
  WINDOW_HEIGHT: 1.15,

  /** Top of a chair/sofa cushion. Rig 'sit' poses put the pelvis here. */
  SEAT_HEIGHT: 0.46,
  /** Dining/desk/coffee-table heights. Surface items (plates) sit on these. */
  TABLE_HEIGHT: 0.76,
  COFFEE_TABLE_HEIGHT: 0.42,
  COUNTER_HEIGHT: 0.92,
  /** Top of the mattress/lining inside coffins & beds. Rig 'sleep' lies at this height. */
  BED_HEIGHT: 0.42,
  /** Embalming table top. */
  SLAB_HEIGHT: 0.86,
  /** Ice bath water line (rig 'bath' sits so the chest is at this height). */
  TUB_RIM: 0.6,

  CHARACTER_HEIGHT: 1.62,
  /** Approx head-top height used for bubbles when standing. */
  HEAD_TOP: 1.78,
} as const;

export type Rot = 0 | 1 | 2 | 3;

/** Yaw (Three.js rotation.y) for an object rotation index. Local +Z front maps through this. */
export function rotYaw(r: Rot): number {
  return (-r * Math.PI) / 2;
}

/** Footprint dimensions after rotation. */
export function rotatedSize(w: number, d: number, r: Rot): { w: number; d: number } {
  return r % 2 === 0 ? { w, d } : { w: d, d: w };
}

/**
 * Map a continuous local point (px,pz) in footprint space [0,w]x[0,d] to world (x,z),
 * for an object whose rotated footprint's min corner sits at tile (ox,oz).
 */
export function localToWorld(
  w: number,
  d: number,
  ox: number,
  oz: number,
  r: Rot,
  px: number,
  pz: number,
): { x: number; z: number } {
  switch (r) {
    case 0:
      return { x: ox + px, z: oz + pz };
    case 1:
      return { x: ox + (d - pz), z: oz + px };
    case 2:
      return { x: ox + (w - px), z: oz + (d - pz) };
    case 3:
      return { x: ox + pz, z: oz + (w - px) };
  }
}

/** Rotate a local direction vector into world space. */
export function rotateDir(r: Rot, vx: number, vz: number): { x: number; z: number } {
  switch (r) {
    case 0:
      return { x: vx, z: vz };
    case 1:
      return { x: -vz, z: vx };
    case 2:
      return { x: -vx, z: -vz };
    case 3:
      return { x: vz, z: -vx };
  }
}

/** Facing angle (radians) for a direction; facing 0 = +Z. Matches Three.js rotation.y. */
export function dirToFacing(x: number, z: number): number {
  return Math.atan2(x, z);
}

export function normalizeAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r < -Math.PI) r += Math.PI * 2;
  return r;
}
