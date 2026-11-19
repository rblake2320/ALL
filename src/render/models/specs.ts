/**
 * Spec lookups for the model library: catalog specs (footprint/height/placement/category/power) and approximate
 * sizes of the environment props (from `ENV_MODELS[].size` in src/shared/catalog.ts — the single source of truth
 * shared with tools/blender/objects/validate.py).
 */
import { ENV_MODELS, PHYSICAL_BY_ID, type BuyCategory, type PhysicalSpec, type PlacementKind } from '../../shared/catalog';
import { DIM } from '../../shared/dimensions';

export interface ModelShape {
  id: string;
  placement: PlacementKind | 'env';
  category: BuyCategory | 'env';
  /** Footprint in tiles (env: approximate metres). */
  w: number;
  d: number;
  height: number;
  needsPower: boolean;
  /** Vertical centre for wall items. */
  wallCentre: number;
}

/** Approximate (width X, depth Z, height Y) for environment props, derived from `ENV_MODELS[].size`. */
export const ENV_DIMS: Readonly<Record<string, readonly [number, number, number]>> = Object.freeze(
  Object.fromEntries(
    ENV_MODELS.map((e) => {
      const z = (e as { size?: { w?: unknown; d?: unknown; h?: unknown } }).size;
      const pos = (v: unknown, fb: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fb);
      return [e.id, Object.freeze([pos(z?.w, 1), pos(z?.d, 1), pos(z?.h, 1)] as const)];
    }),
  ),
);

const WALL_CENTRES: Readonly<Record<string, number>> = { painting_greatgrand: 1.6, sconce_candle: 1.7 };

const ENV_IDS: ReadonlySet<string> = new Set(ENV_MODELS.map((e) => e.id));

export function isEnvId(id: string): boolean {
  return ENV_IDS.has(id);
}

/** Every model id the asset pipeline must provide (catalog + environment). */
export function allModelIds(): string[] {
  return [...Object.keys(PHYSICAL_BY_ID), ...ENV_MODELS.map((e) => e.id)];
}

export function specOf(id: string): PhysicalSpec | null {
  return Object.prototype.hasOwnProperty.call(PHYSICAL_BY_ID, id) ? PHYSICAL_BY_ID[id] : null;
}

export function shapeOf(id: string): ModelShape {
  const s = specOf(id);
  if (s) {
    const w = Number.isFinite(s.footprint?.w) && s.footprint.w > 0 ? s.footprint.w : 1;
    const d = Number.isFinite(s.footprint?.d) && s.footprint.d > 0 ? s.footprint.d : 1;
    const h = Number.isFinite(s.height) && s.height > 0 ? s.height : 1;
    return {
      id,
      placement: s.placement,
      category: s.category,
      w,
      d,
      height: h,
      needsPower: !!s.needsPower,
      wallCentre: WALL_CENTRES[id] ?? 1.5,
    };
  }
  const env = Object.prototype.hasOwnProperty.call(ENV_DIMS, id) ? ENV_DIMS[id] : undefined;
  if (env) {
    return { id, placement: 'env', category: 'env', w: env[0], d: env[1], height: env[2], needsPower: false, wallCentre: 1.5 };
  }
  return { id, placement: 'floor', category: 'misc', w: 1, d: 1, height: 0.8, needsPower: false, wallCentre: 1.5 };
}

/** Local-space bounds of the shape as [minX, minY, minZ, maxX, maxY, maxZ] (used for placeholders/fallbacks). */
export function shapeBounds(sh: ModelShape): [number, number, number, number, number, number] {
  switch (sh.placement) {
    case 'wall': {
      const h = Math.max(0.1, sh.height);
      return [-0.35, sh.wallCentre - h / 2, 0, 0.35, sh.wallCentre + h / 2, 0.08];
    }
    case 'door':
      return [-0.5, 0, -DIM.WALL_THICKNESS / 2 - 0.02, 0.5, DIM.DOOR_HEIGHT + 0.1, DIM.WALL_THICKNESS / 2 + 0.02];
    case 'window':
      return [-0.5, DIM.WINDOW_SILL - 0.1, -DIM.WALL_THICKNESS / 2 - 0.02, 0.5, DIM.WINDOW_SILL + sh.height + 0.07,
        DIM.WALL_THICKNESS / 2 + 0.02];
    case 'item': {
      const r = 0.22;
      return [-r, 0, -r, r, Math.max(0.04, sh.height), r];
    }
    case 'env':
      if (sh.id === 'env_fence') return [0, 0, -0.04, 1, sh.height, 0.04];
      return [-sh.w / 2, 0, -sh.d / 2, sh.w / 2, sh.height, sh.d / 2];
    default: {
      const hw = sh.w / 2 - 0.05;
      const hd = sh.d / 2 - 0.05;
      return [-hw, 0, -hd, hw, Math.max(0.02, sh.height), hd];
    }
  }
}
