/**
 * Semantic repair hook. Structural validation (validation/) guarantees well-typed data; the
 * engine's `repairWorld` (exported by src/sim/index.ts, SIM-ENGINE) fixes meaning: dangling
 * references, stale reservations, impossible states.
 *
 * The engine is loaded lazily through import.meta.glob, so persistence never hard-depends on it:
 * when the module or the export is missing, or repair throws, loading continues with the
 * structurally valid world and a warning (fault barrier). Accepted return shapes, so the hook keeps
 * working whichever convention the engine settles on (see docs/contract-requests/platform.md):
 *   { world, warnings? } | WorldState | string[] (repaired in place) | void (in place)
 */
import type { WorldState } from '../sim/types';
import { isPlainObject } from './sanitize';

export type RepairHook = (world: WorldState) => Promise<{ world: WorldState; warnings: string[] }>;

type EngineModule = Record<string, unknown>;

/** Normalize whatever a repair function returned into { world, warnings }. */
export function normalizeRepairResult(input: WorldState, out: unknown): { world: WorldState; warnings: string[] } {
  if (out === undefined || out === null) return { world: input, warnings: [] };
  if (Array.isArray(out)) return { world: input, warnings: out.filter((w): w is string => typeof w === 'string') };
  if (isPlainObject(out)) {
    if (isPlainObject(out.world)) {
      const warnings = Array.isArray(out.warnings) ? out.warnings.filter((w): w is string => typeof w === 'string') : [];
      const repairs = Array.isArray(out.repairs) ? out.repairs.filter((w): w is string => typeof w === 'string') : [];
      return { world: out.world as unknown as WorldState, warnings: [...warnings, ...repairs] };
    }
    if ('schemaVersion' in out && 'agents' in out) return { world: out as unknown as WorldState, warnings: [] };
  }
  throw new Error('repairWorld returned an unrecognized value');
}

/** Wrap a repair function as a fault-contained hook. */
export function repairHookFrom(fn: (world: WorldState) => unknown): RepairHook {
  return async (world) => {
    const out = await fn(world);
    return normalizeRepairResult(world, out);
  };
}

let enginePromise: Promise<EngineModule | null> | null = null;

function loadEngine(): Promise<EngineModule | null> {
  if (!enginePromise) {
    enginePromise = (async () => {
      try {
        const loaders = import.meta.glob('../sim/index.ts');
        const load = Object.values(loaders)[0];
        if (!load) return null;
        const mod = (await load()) as unknown;
        return mod !== null && typeof mod === 'object' ? (mod as EngineModule) : null;
      } catch (e) {
        console.warn('[persistence] engine module unavailable for save repair:', e);
        return null;
      }
    })();
  }
  return enginePromise;
}

/** Default hook: the engine's repairWorld if it exists, else identity. */
export function engineRepairHook(): RepairHook {
  return async (world) => {
    const mod = await loadEngine();
    const fn = mod?.repairWorld;
    if (typeof fn !== 'function') return { world, warnings: [] };
    return normalizeRepairResult(world, await (fn as (w: WorldState) => unknown)(world));
  };
}
