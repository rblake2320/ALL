/**
 * ObjectState → ObjectVisualState mapping (pure; unit-tested). The renderer owns these visual decisions:
 *   powered  = doesn't need power, or (utilities on && not broken)
 *   inUse    = inUseBy.length > 0
 *   lit      = lamps-on time && object has a light && (candle || powered) && data.off !== true
 *   servings = data.servings clamped to 0..4 (model has serving_0..serving_3)
 *   progress = data.progress clamped to 0..1
 *   flag     = mailbox && (data.mail > 0 || bills outstanding)
 *   dirt     = condition.dirt clamped 0..1
 *   burning  = condition.burning
 */
import type { ObjectVisualState } from '../contracts';
import type { ObjectState } from '../../sim/types';
import type { PhysicalSpec } from '../../shared/catalog';

export interface VisualEnv {
  utilitiesOn: boolean;
  /** Lamps-on period (dusk → dawn). */
  lampsOn: boolean;
  /** Any unpaid bill in the household. */
  billsOutstanding: boolean;
}

export function createVisualState(): ObjectVisualState {
  return { powered: true, inUse: false, broken: false, lit: false, servings: 0, progress: 0, flag: false, dirt: 0, burning: false };
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Whether a spec counts as a candle-type light (glows without power). */
export function isCandleLight(spec: Pick<PhysicalSpec, 'light' | 'tags'> | null | undefined): boolean {
  if (!spec || !spec.light) return false;
  return spec.light.powered === false || (Array.isArray(spec.tags) && spec.tags.includes('candle'));
}

export function isMailbox(spec: Pick<PhysicalSpec, 'tags'> | null | undefined): boolean {
  return !!spec && Array.isArray(spec.tags) && spec.tags.includes('mailbox');
}

/** Fill `out` for one object. `spec` may be null for unknown defs (treated as an unpowered prop). */
export function computeVisualState(
  obj: Pick<ObjectState, 'condition' | 'data' | 'inUseBy'> | null | undefined,
  spec: Pick<PhysicalSpec, 'needsPower' | 'light' | 'tags'> | null | undefined,
  env: VisualEnv,
  out: ObjectVisualState,
): ObjectVisualState {
  const cond = obj && obj.condition && typeof obj.condition === 'object' ? obj.condition : null;
  const data = obj && obj.data && typeof obj.data === 'object' ? obj.data : null;
  const broken = !!(cond && cond.broken === true);
  const needsPower = !!(spec && spec.needsPower);
  const powered = !needsPower || (env.utilitiesOn === true && !broken);
  out.powered = powered;
  out.broken = broken;
  out.inUse = !!(obj && Array.isArray(obj.inUseBy) && obj.inUseBy.length > 0);
  const switchedOff = !!(data && data.off === true);
  const hasLight = !!(spec && spec.light);
  out.lit = env.lampsOn === true && hasLight && (isCandleLight(spec) || powered) && !switchedOff;
  const servings = num(data ? data.servings : undefined, 0);
  out.servings = Math.max(0, Math.min(4, Math.round(servings)));
  out.progress = clamp01(num(data ? data.progress : undefined, 0));
  out.flag = isMailbox(spec) && (num(data ? data.mail : undefined, 0) > 0 || env.billsOutstanding === true);
  out.dirt = clamp01(num(cond ? cond.dirt : undefined, 0));
  out.burning = !!(cond && cond.burning === true);
  return out;
}

/** True when two visual states are identical (lets callers skip redundant library updates). */
export function visualStateEquals(a: ObjectVisualState, b: ObjectVisualState): boolean {
  return (
    a.powered === b.powered &&
    a.inUse === b.inUse &&
    a.broken === b.broken &&
    a.lit === b.lit &&
    a.servings === b.servings &&
    a.progress === b.progress &&
    a.flag === b.flag &&
    a.dirt === b.dirt &&
    a.burning === b.burning
  );
}
