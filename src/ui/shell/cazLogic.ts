/** Pure Create-a-Zombie helpers: trait picking rules, voice seeds, household summaries. */
import type { TraitInfo } from './data';
import { TRAITS_REQUIRED } from './data';

export type TraitBlock = { kind: 'conflict'; withId: string } | { kind: 'full' } | null;

function conflictsOf(id: string, traits: readonly TraitInfo[]): Set<string> {
  const out = new Set<string>();
  for (const tr of traits) {
    if (tr.id === id) for (const c of tr.conflicts) out.add(c);
    else if (tr.conflicts.includes(id)) out.add(tr.id); // conflicts are treated symmetrically
  }
  return out;
}

/** Why `id` can't be added right now (null = can toggle). Selected traits are never blocked (can be removed). */
export function traitBlockReason(id: string, selected: readonly string[], traits: readonly TraitInfo[]): TraitBlock {
  const sel = Array.isArray(selected) ? selected : [];
  if (sel.includes(id)) return null;
  const c = conflictsOf(id, traits);
  const hit = sel.find((s) => c.has(s));
  if (hit) return { kind: 'conflict', withId: hit };
  if (sel.length >= TRAITS_REQUIRED) return { kind: 'full' };
  return null;
}

/** Toggle a trait respecting the 3-trait limit and conflicts. Returns a new array (or the same one if unchanged). */
export function toggleTrait(selected: readonly string[], id: string, traits: readonly TraitInfo[]): string[] {
  const sel = Array.isArray(selected) ? [...selected] : [];
  if (!traits.some((tr) => tr.id === id && !tr.reward)) return sel;
  if (sel.includes(id)) return sel.filter((s) => s !== id);
  if (traitBlockReason(id, sel, traits) !== null) return sel;
  return [...sel, id];
}

/** Clean a trait list: known, non-reward, unique, conflict-free (first wins), at most 3. */
export function sanitizeTraits(selected: readonly unknown[], traits: readonly TraitInfo[]): string[] {
  const out: string[] = [];
  if (!Array.isArray(selected)) return out;
  for (const raw of selected) {
    if (typeof raw !== 'string') continue;
    if (out.length >= TRAITS_REQUIRED) break;
    const tr = traits.find((x) => x.id === raw);
    if (!tr || tr.reward || out.includes(raw)) continue;
    if (traitBlockReason(raw, out, traits) !== null) continue;
    out.push(raw);
  }
  return out;
}

/** Stable voice timbre seed from a member's identity (FNV-1a). */
export function voiceSeed(firstName: string, lastName: string, index: number): number {
  const s = `${firstName ?? ''}\u0000${lastName ?? ''}\u0000${Number.isFinite(index) ? index : 0}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 1_000_000;
}

/** Expression that suits a preview pose. */
export function poseExpression(pose: string): 'neutral' | 'happy' | 'sleepy' | 'angry' {
  switch (pose) {
    case 'dance':
    case 'wave':
    case 'laugh':
      return 'happy';
    case 'groan':
      return 'sleepy';
    default:
      return 'neutral';
  }
}

/** Wrap a yaw angle into (-π, π]. */
export function wrapYaw(yaw: number): number {
  if (!Number.isFinite(yaw)) return 0;
  const tau = Math.PI * 2;
  let y = yaw % tau;
  if (y > Math.PI) y -= tau;
  if (y <= -Math.PI) y += tau;
  return y;
}

/** Yaw (radians, any range) → whole degrees in [0, 360) for the turntable's aria-valuenow. */
export function yawDegrees(yaw: number): number {
  if (!Number.isFinite(yaw)) return 0;
  const deg = Math.round((yaw * 180) / Math.PI) % 360;
  const d = deg < 0 ? deg + 360 : deg;
  return d === 360 || Object.is(d, -0) ? 0 : d;
}
