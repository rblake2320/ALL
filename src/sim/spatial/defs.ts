/**
 * OBJECT DEFINITION LOOKUP (SIM-SPATIAL).
 *
 * The spatial module needs the PHYSICAL half of an object definition (footprint, slots, surfaces, passability,
 * layer, indoor/outdoor flags, placement kind, price) plus three gameplay numbers (env, depreciation, sellable).
 *  - Lookup order: ContentRegistry.objects[defId] (ObjectDef spreads PhysicalSpec) -> PHYSICAL_BY_ID[defId]
 *    (src/shared/catalog.ts) -> null. Unknown ids are ignored safely by every caller (never throw).
 *  - Defaults: env 0, depreciation 0.15 (clamped to [0,1]), sellable true, price >= 0 integer.
 *  - Floor objects block their tiles unless `passable === true` or `layer === 'rug'`.
 *  - Loose items block their tile only when `passable === false` (item_fire).
 *  - A wall opening lets zombies through only when its def placement is 'door' (windows / unknown openings block).
 */
import type { ContentRegistry, ObjectDef } from '../contracts';
import { PHYSICAL_BY_ID, type PhysicalSpec } from '../../shared/catalog';
import { sanitizeDim } from './geometry';

export type SpecLike = PhysicalSpec & Partial<Pick<ObjectDef, 'env' | 'depreciation' | 'sellable'>>;

export const DEFAULT_DEPRECIATION = 0.15;

/** Fresh-per-content cache so repeated lookups for the same id are a single property read. */
export function specOf(content: ContentRegistry | null | undefined, defId: unknown): SpecLike | null {
  if (typeof defId !== 'string' || defId.length === 0) return null;
  const objs = content && content.objects;
  if (objs && Object.prototype.hasOwnProperty.call(objs, defId)) {
    const d = objs[defId];
    if (d && typeof d === 'object') return d as SpecLike;
  }
  if (Object.prototype.hasOwnProperty.call(PHYSICAL_BY_ID, defId)) return PHYSICAL_BY_ID[defId] as SpecLike;
  return null;
}

export function footprintOf(s: SpecLike): { w: number; d: number } {
  const fp = s.footprint as { w?: unknown; d?: unknown } | undefined;
  return { w: sanitizeDim(fp && fp.w), d: sanitizeDim(fp && fp.d) };
}

export function isRug(s: SpecLike): boolean {
  return s.layer === 'rug';
}

/** Does a FLOOR-placed object with this spec block movement through its tiles? */
export function floorBlocks(s: SpecLike): boolean {
  return s.passable !== true && !isRug(s);
}

/** Does a LOOSE item with this spec block its tile? */
export function looseBlocks(s: SpecLike): boolean {
  return s.passable === false;
}

export function isDoor(s: SpecLike | null): boolean {
  return !!s && s.placement === 'door';
}

export function isOpeningSpec(s: SpecLike | null): boolean {
  return !!s && (s.placement === 'door' || s.placement === 'window');
}

export function envOf(s: SpecLike | null): number {
  const v = s ? s.env : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function depreciationOf(s: SpecLike | null): number {
  const v = s ? s.depreciation : undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_DEPRECIATION;
  return Math.max(0, Math.min(1, v));
}

export function sellableOf(s: SpecLike | null): boolean {
  return !s || s.sellable !== false;
}

export function priceOf(s: SpecLike | null): number {
  const v = s ? s.price : 0;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

/** Integer resale refund for an object value: floor(value x (1 - depreciation)), never negative. */
export function resaleValue(value: unknown, s: SpecLike | null): number {
  const v = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  return Math.max(0, Math.floor(v * (1 - depreciationOf(s)) + 1e-9));
}
