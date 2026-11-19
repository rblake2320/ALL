/**
 * Physical spec lookup: the shared catalog first, then the simulation's content registry (mods / content-only
 * objects), then a safe generic fallback so unknown ids never crash anything.
 */
import { PHYSICAL_BY_ID, type PhysicalSpec } from '../../shared/catalog';
import type { SimulationAPI } from '../../sim/contracts';

export const FALLBACK_SPEC: PhysicalSpec = {
  id: 'unknown',
  name: 'Unknown Object',
  description: '',
  category: 'misc',
  price: 0,
  buyable: false,
  placement: 'floor',
  footprint: { w: 1, d: 1 },
  height: 1,
  tags: [],
  slots: [],
  modelNotes: '',
};

export class SpecResolver {
  private sim: SimulationAPI | null = null;
  private readonly cache = new Map<string, PhysicalSpec | null>();

  setSim(sim: SimulationAPI | null): void {
    this.sim = sim;
    this.cache.clear();
  }

  /** Spec for a def id, or null when unknown everywhere. */
  get(defId: unknown): PhysicalSpec | null {
    if (typeof defId !== 'string' || defId.length === 0) return null;
    const hit = this.cache.get(defId);
    if (hit !== undefined) return hit;
    let spec: PhysicalSpec | null = PHYSICAL_BY_ID[defId] ?? null;
    if (!spec && this.sim) {
      try {
        const def = this.sim.content?.objects?.[defId];
        if (def && typeof def === 'object' && def.footprint) spec = def;
      } catch {
        spec = null;
      }
    }
    this.cache.set(defId, spec);
    return spec;
  }

  /** Spec or the generic fallback. */
  getOrFallback(defId: unknown): PhysicalSpec {
    return this.get(defId) ?? FALLBACK_SPEC;
  }
}
