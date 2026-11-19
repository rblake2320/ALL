/**
 * Shared material variants. Instances never get private material clones: every recolour (tint), dirt level,
 * emissive flicker level and canvas progress level is a quantised variant cached per base material, so a street of
 * candles costs a handful of materials and per-frame updates only swap references (no allocations after warm-up).
 */
import * as THREE from 'three';

export const EMISSIVE_LEVELS = 8;
export const DIRT_LEVELS = 4;
export const CANVAS_LEVELS = 10;

const GRIME = new THREE.Color('#4a4034');
const CHAR = new THREE.Color('#2a2420');
const CANVAS_WASH = new THREE.Color('#c4ad86');

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalise a tint string to lower-case #rrggbb, or null if it is not a usable colour. */
export function normalizeTint(tint: string | null | undefined): string | null {
  if (typeof tint !== 'string') return null;
  const t = tint.trim();
  if (!HEX_RE.test(t)) return null;
  if (t.length === 4) return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`.toLowerCase();
  return t.toLowerCase();
}

function isStandard(m: THREE.Material): m is THREE.MeshStandardMaterial {
  return (m as THREE.MeshStandardMaterial).isMeshStandardMaterial === true;
}

export function hasEmissive(m: THREE.Material | null | undefined): boolean {
  if (!m || !isStandard(m)) return false;
  const e = m.emissive;
  return m.emissiveIntensity > 0 && (e.r > 0.001 || e.g > 0.001 || e.b > 0.001);
}

export class MaterialVariants {
  private readonly map = new Map<string, THREE.Material>();
  private readonly owned = new Set<THREE.Material>();

  /** Number of cached variant materials (tests / diagnostics). */
  get size(): number {
    return this.map.size;
  }

  isOwned(m: THREE.Material): boolean {
    return this.owned.has(m);
  }

  private remember(key: string, m: THREE.Material): THREE.Material {
    this.map.set(key, m);
    this.owned.add(m);
    return m;
  }

  /** Recoloured 'Paint' material (tint = normalised #rrggbb or null for the authored colour), darkened by dirt. */
  paint(base: THREE.Material, tint: string | null, dirt: number): THREE.Material {
    const level = Math.max(0, Math.min(DIRT_LEVELS, Math.round(dirt)));
    if (!tint && level === 0) return base;
    const key = `${base.uuid}|p|${tint ?? ''}|${level}`;
    const hit = this.map.get(key);
    if (hit) return hit;
    const m = base.clone();
    if (isStandard(m)) {
      if (tint) m.color.set(tint);
      if (level > 0) {
        const k = level / DIRT_LEVELS;
        m.color.lerp(level === DIRT_LEVELS ? CHAR : GRIME, 0.22 * k).multiplyScalar(1 - 0.24 * k);
        m.roughness = Math.min(1, m.roughness + 0.08 * k);
      }
    }
    m.userData = { ...m.userData, variantOf: base.uuid };
    return this.remember(key, m);
  }

  /** Emissive intensity variant: level 0 = off .. EMISSIVE_LEVELS = as authored (returns the base). */
  emissive(base: THREE.Material, level: number): THREE.Material {
    const l = Math.max(0, Math.min(EMISSIVE_LEVELS, Math.round(level)));
    if (l === EMISSIVE_LEVELS || !isStandard(base)) return base;
    const key = `${base.uuid}|e|${l}`;
    const hit = this.map.get(key);
    if (hit) return hit;
    const m = base.clone() as THREE.MeshStandardMaterial;
    m.emissiveIntensity = base.emissiveIntensity * (l / EMISSIVE_LEVELS);
    m.userData = { ...m.userData, variantOf: base.uuid };
    return this.remember(key, m);
  }

  /** Canvas wash by painting progress level 0..CANVAS_LEVELS (0 returns the blank base). */
  canvas(base: THREE.Material, level: number): THREE.Material {
    const l = Math.max(0, Math.min(CANVAS_LEVELS, Math.round(level)));
    if (l === 0 || !isStandard(base)) return base;
    const key = `${base.uuid}|c|${l}`;
    const hit = this.map.get(key);
    if (hit) return hit;
    const m = base.clone() as THREE.MeshStandardMaterial;
    m.color.lerp(CANVAS_WASH, 0.6 * (l / CANVAS_LEVELS));
    m.userData = { ...m.userData, variantOf: base.uuid };
    return this.remember(key, m);
  }

  dispose(): void {
    for (const m of this.owned) m.dispose();
    this.owned.clear();
    this.map.clear();
  }
}
