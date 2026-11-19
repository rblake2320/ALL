/**
 * World view math for the renderer (W-025 S5, docs/DESIGN_WORLD_LEVELS.md §1.3 / §1.4). Pure, unit-tested.
 *
 * SCENE FRAME. The renderer keeps drawing the home lot exactly where it always has: scene coordinates ARE the home
 * region's lot-local coordinates (tile units, y up). Every other region is drawn in a group whose transform maps its
 * own lot-local frame into that scene frame: lot-local → world (`lotToWorld` of the region's placement) → home-local
 * (`worldToLot` of the home placement). Placements are quarter turns, so the composite is a rigid motion: a rotation
 * about +Y by `yaw` and a translation. A home-only world therefore renders byte-for-byte the scene it rendered before
 * (AC-1), and camera, picking, cutaway and lighting code that works in home coordinates keeps working.
 *
 * RENDER TIERS (view-only, never read by the sim): `computeRenderTiers` picks active / warm / cold per region from the
 * camera focus in WORLD tiles with hysteresis (enter / leave radii) and the "at most 6 nearest lots at full detail"
 * cap. Until S4 registers non-home regions with the sim, "sim-active" is the home only, so a lot near the camera turns
 * render-active by the §1.4 sim radii (45 enter / 60 leave) measured from the camera focus (DESIGN §1.19 note).
 */
import { lotToWorld, worldToLot, placementWorldRect, type LotPlacement, type RegionId, type RegionKind, type RenderTier, type WorldPoint, type WorldRect } from '../../shared/world';

/** Rigid transform of a region's lot-local frame into the scene (home-local) frame. */
export interface RegionFrame {
  regionId: RegionId;
  /** Scene position of the region's lot-local origin. */
  x: number;
  z: number;
  /** Rotation about +Y (radians, quarter turns): scene facing = local facing + yaw. */
  yaw: number;
  cos: number;
  sin: number;
}

function cleanQuarter(v: number): number {
  // cos / sin of quarter turns: exact 0 / ±1 (no 6e-17 residue in transforms)
  const r = Math.round(v);
  return Math.abs(v - r) < 1e-9 ? r + 0 : v;
}

/**
 * Frame of `p` in the scene of `home`. null when either placement is invalid. Exact for integer / half-integer
 * coordinates (quarter-turn rotations only).
 */
export function regionFrame(home: LotPlacement, p: LotPlacement): RegionFrame | null {
  const w0 = lotToWorld(p, 0, 0);
  if (!w0) return null;
  const s0 = worldToLot(home, w0.x, w0.z);
  const w1 = lotToWorld(p, 0, 1);
  const s1 = w1 ? worldToLot(home, w1.x, w1.z) : null;
  if (!s0 || !s1) return null;
  // local +Z maps to (sin yaw, cos yaw) in the scene (facing convention 0 = +Z, atan2(x, z))
  const sin = cleanQuarter(s1.x - s0.x);
  const cos = cleanQuarter(s1.z - s0.z);
  const yaw = Math.atan2(sin, cos);
  return { regionId: p.regionId, x: s0.x + 0, z: s0.z + 0, yaw, cos, sin };
}

/** Lot-local point of the framed region → scene point (allocation-free with `out`). */
export function frameToScene(f: RegionFrame, x: number, z: number, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
  // rotation about +Y by yaw: x' = x cos + z sin, z' = -x sin + z cos (three.js Object3D.rotation.y convention)
  out.x = f.x + x * f.cos + z * f.sin;
  out.z = f.z - x * f.sin + z * f.cos;
  return out;
}

/** Scene point → the framed region's lot-local point. */
export function sceneToFrame(f: RegionFrame, sx: number, sz: number, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
  const dx = sx - f.x;
  const dz = sz - f.z;
  out.x = dx * f.cos - dz * f.sin;
  out.z = dx * f.sin + dz * f.cos;
  return out;
}

/** Scene (home-local) point → world point (null for an invalid home placement or non-finite input). */
export function sceneToWorld(home: LotPlacement, sx: number, sz: number): WorldPoint | null {
  return lotToWorld(home, sx, sz);
}

/** World point → scene (home-local) point. */
export function worldToScene(home: LotPlacement, wx: number, wz: number): WorldPoint | null {
  return worldToLot(home, wx, wz);
}

/** A world rect expressed in the scene frame (axis-aligned: quarter turns keep rects axis-aligned). */
export function worldRectToScene(home: LotPlacement, r: WorldRect): WorldRect | null {
  const a = worldToLot(home, r.x0, r.z0);
  const b = worldToLot(home, r.x1, r.z1);
  if (!a || !b) return null;
  return { x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z) };
}

/** Chebyshev distance (tiles) from a point to a rect (0 inside). */
export function rectDistance(r: WorldRect, x: number, z: number): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.max(dx, dz);
}

export type RenderProfile = 'desktop' | 'phone';

/** §1.4 render radii (world tiles, Chebyshev from the camera focus to the region rect). */
export const RENDER_RADII = {
  desktop: { warmEnter: 120, warmLeave: 140 },
  phone: { warmEnter: 75, warmLeave: 90 },
  /** Full-detail radius while S4 has not registered neighbour regions with the sim (§1.4 sim radii as a stand-in). */
  activeEnter: 45,
  activeLeave: 60,
  /** At most this many LOT regions render at full detail (home included). */
  activeLots: 6,
  /** Rank slack (tiles) a lot that is already active keeps over a newcomer, so ties never thrash. */
  rankSlack: 8,
} as const;

export interface TierRegion {
  id: RegionId;
  kind: RegionKind;
  rect: WorldRect;
  /** Simulated this tick (home, or a region S4 registered). */
  simActive: boolean;
}

export interface TierInput {
  regions: readonly TierRegion[];
  /** Camera focus, world tiles. */
  focus: WorldPoint;
  profile: RenderProfile;
  homeId: RegionId;
  /** Previous tiers (hysteresis); absent = cold. */
  prev: ReadonlyMap<RegionId, RenderTier>;
}

/**
 * Render tier per region (§1.4 table). The home is always active (its layers are the legacy lot builders). A lot is
 * active when it is sim-active or within the active radius (enter 45 / leave 60), within the warm radius, and among
 * the `activeLots` nearest lots (an already-active lot ranks `rankSlack` tiles closer). Streets / paths near the focus
 * are active (they carry street lamps); everything else within the warm radius (enter / leave by profile) is warm;
 * the rest is cold. Unfinished regions are never active (they are boundaries, not content). Pure and deterministic.
 */
export function computeRenderTiers(input: TierInput): Map<RegionId, RenderTier> {
  const out = new Map<RegionId, RenderTier>();
  const radii = input.profile === 'phone' ? RENDER_RADII.phone : RENDER_RADII.desktop;
  const fx = Number.isFinite(input.focus?.x) ? input.focus.x : 0;
  const fz = Number.isFinite(input.focus?.z) ? input.focus.z : 0;
  const lotCands: { id: RegionId; rank: number }[] = [];
  const dist = new Map<RegionId, number>();
  for (const r of input.regions) {
    if (!r || typeof r.id !== 'string') continue;
    const d = rectDistance(r.rect, fx, fz);
    dist.set(r.id, d);
    const prev = input.prev.get(r.id) ?? 'cold';
    if (r.id === input.homeId) continue;
    const warmR = prev === 'cold' ? radii.warmEnter : radii.warmLeave;
    if (!(d <= warmR)) continue;
    out.set(r.id, 'warm');
    if (r.kind === 'unfinished') continue;
    const actR = prev === 'active' ? RENDER_RADII.activeLeave : RENDER_RADII.activeEnter;
    if (!r.simActive && !(d <= actR)) continue;
    if (r.kind === 'lot') lotCands.push({ id: r.id, rank: d - (prev === 'active' ? RENDER_RADII.rankSlack : 0) });
    else out.set(r.id, 'active');
  }
  out.set(input.homeId, 'active');
  lotCands.sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const room = Math.max(0, RENDER_RADII.activeLots - 1);
  for (let i = 0; i < lotCands.length && i < room; i++) out.set(lotCands[i].id, 'active');
  return out;
}

/** World rect of a placement (re-exported for the view code). */
export function regionRect(p: LotPlacement): WorldRect | null {
  return placementWorldRect(p);
}

/**
 * Where a region's CONTENTS (agents, sim objects) are drawn: `'home'` = untransformed (the home lot), a frame = in
 * that region's place in the scene, null = not drawn now (the region is warm / cold). Agents and objects without a
 * `regionId` are home content and never ask.
 */
export type ContentFrameLookup = (regionId: string) => RegionFrame | 'home' | null;
