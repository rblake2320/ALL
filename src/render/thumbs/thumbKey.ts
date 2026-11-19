/**
 * Thumbnail cache keys + a tiny bounded promise cache. Pure (no DOM); unit-tested.
 */
import { parseHexColor } from '../core/math';

/** Normalise a tint to '#rrggbb' lowercase, or null for none/invalid. */
export function normalizeTint(tint: unknown): string | null {
  const n = parseHexColor(tint);
  if (n === null) return null;
  return '#' + n.toString(16).padStart(6, '0');
}

/** Model ids are short identifiers; anything else is rejected. */
export function isValidModelId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 64 && /^[A-Za-z0-9_\-.]+$/.test(id);
}

/** Cache key for (modelId, tint); null when the model id is unusable. Equivalent tints map to the same key. */
export function thumbKey(modelId: unknown, tint?: unknown): string | null {
  if (!isValidModelId(modelId)) return null;
  const t = normalizeTint(tint);
  return t ? `${modelId}|${t}` : `${modelId}|`;
}

/**
 * Insertion-ordered bounded cache (evicts the oldest entry when full). Used for thumbnail promises so a
 * catalog with hundreds of tint variants cannot grow memory without bound.
 */
export class BoundedCache<V> {
  private readonly map = new Map<string, V>();
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = Number.isFinite(capacity) && capacity >= 1 ? Math.floor(capacity) : 1;
  }

  get size(): number {
    return this.map.size;
  }

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      // refresh recency
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}
