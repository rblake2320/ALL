/**
 * Carry placement: where a carried item goes for the current clip.
 *
 * Default ('palm'): on the carry hand's prop bone (prop_R, or prop_L when the right arm is gone), with the arm
 * blended into the palm-up carry pose during HOLD_ANIMS. Some clips hold items their own way - plate on the left
 * palm + a fork in the right hand while eating, an open book between both hands while reading, the phone at
 * the ear. Those come from the GLB ('Rig' extras carryAnchors, computed by tools/blender/characters/lib/anchors.py
 * from the clip pose): item parented to a bone with a fixed local matrix, mirrored together with the clip.
 * Everything here is pure (no scene access) and total: malformed anchor data is ignored.
 */
import * as THREE from 'three';
import { CARRY_ITEMS } from '../../shared/appearance';
import type { CarryItem, LimbState } from '../../shared/appearance';
import type { CarryExtra, CarryVariant } from './carry';
import { mirrorBoneName } from './names';
import { HOLD_ANIMS, HOLD_ITEMS, carryHand } from './plan';
import type { AnimPlan } from './plan';

export interface AnchorExtra {
  item: CarryExtra;
  bone: string;
  matrix: THREE.Matrix4;
}

export interface CarryAnchor {
  items: ReadonlySet<CarryItem>;
  bone: string;
  matrix: THREE.Matrix4;
  variant: Exclude<CarryVariant, 'palm'>;
  extra: AnchorExtra | null;
}

export interface CarryPlacement {
  /** 'extra' = the item's hand is gone but the anchor's extra prop still shows (one-armed eater: fork, no plate). */
  kind: 'none' | 'palm' | 'anchor' | 'extra';
  /** Parent bone (prop_R / prop_L for 'palm'). */
  bone: string;
  /** Local matrix under `bone` (anchors only). */
  matrix: THREE.Matrix4 | null;
  variant: CarryVariant;
  extra: AnchorExtra | null;
  /** Blend the arm into the palm-up carry pose. */
  hold: boolean;
  /** Stable identity: re-attach only when this changes. */
  key: string;
}

const NONE: CarryPlacement = { kind: 'none', bone: '', matrix: null, variant: 'palm', extra: null, hold: false, key: 'none' };
const BONE_RE = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
const VARIANTS = new Set(['centered', 'open']);

function parseMatrix(v: unknown): THREE.Matrix4 | null {
  if (!Array.isArray(v) || v.length !== 16 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  const m = new THREE.Matrix4().fromArray(v as number[]);
  // must be a rotation with one uniform item scale in [ANCHOR_SCALE_MIN, ANCHOR_SCALE_MAX] (1 = rigid) and a
  // translation: no shear, uneven scale, mirror or projection. A determinant near 1 is NOT enough - diag(1000,
  // 0.001, 1) and a shear both have determinant 1 - so the columns themselves are checked.
  const e = m.elements;
  if (Math.abs(e[3]) + Math.abs(e[7]) + Math.abs(e[11]) > 1e-6 || Math.abs(e[15] - 1) > 1e-6) return null;
  return uniformScale(e, m.determinant()) ? m : null;
}

/** Smallest / largest uniform scale an anchor may give its item (a broad body holds a larger book). */
export const ANCHOR_SCALE_MIN = 0.75;
export const ANCHOR_SCALE_MAX = 1.6;

/** True when the 3 x 3 part is a rotation times one scale s in [ANCHOR_SCALE_MIN, ANCHOR_SCALE_MAX] (1 % tolerance). */
function uniformScale(e: ArrayLike<number>, det: number): boolean {
  if (!(det > 0)) return false;
  const s = Math.cbrt(det);
  if (!(s >= ANCHOR_SCALE_MIN - 1e-6 && s <= ANCHOR_SCALE_MAX + 1e-6)) return false;
  const tol = 0.01;
  for (let i = 0; i < 3; i++) {
    const a = i * 4;
    if (Math.abs(Math.hypot(e[a], e[a + 1], e[a + 2]) - s) > tol * s) return false;
    const b = ((i + 1) % 3) * 4;
    if (Math.abs(e[a] * e[b] + e[a + 1] * e[b + 1] + e[a + 2] * e[b + 2]) > tol * s * s) return false;
  }
  return true;
}

function parseJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

/** Parse + validate the GLB's carryAnchors extras (JSON string or object). Invalid entries are dropped. */
export function parseCarryAnchors(raw: unknown): Map<string, CarryAnchor> {
  const out = new Map<string, CarryAnchor>();
  const obj = parseJson(raw);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const [anim, val] of Object.entries(obj as Record<string, unknown>)) {
    if (!val || typeof val !== 'object') continue;
    const a = val as Record<string, unknown>;
    const items = Array.isArray(a.items)
      ? a.items.filter((x): x is CarryItem => typeof x === 'string' && (CARRY_ITEMS as readonly string[]).includes(x))
      : [];
    const matrix = parseMatrix(a.matrix);
    const bone = typeof a.bone === 'string' && BONE_RE.test(a.bone) ? a.bone : null;
    const variant = typeof a.variant === 'string' && VARIANTS.has(a.variant) ? (a.variant as 'centered' | 'open') : null;
    if (!items.length || !matrix || !bone || !variant) continue;
    let extra: AnchorExtra | null = null;
    const ex = a.extra as Record<string, unknown> | undefined;
    if (ex && typeof ex === 'object' && ex.item === 'fork' && typeof ex.bone === 'string' && BONE_RE.test(ex.bone)) {
      const em = parseMatrix(ex.matrix);
      if (em) extra = { item: 'fork', bone: ex.bone, matrix: em };
    }
    out.set(anim, { items: new Set(items), bone, matrix, variant, extra });
  }
  return out;
}

const MIRROR = new THREE.Matrix4().makeScale(-1, 1, 1);

/** Left/right mirror of a bone-local transform (bone frames of the two sides are exact mirror images). */
export function mirrorLocalMatrix(m: THREE.Matrix4, out = new THREE.Matrix4()): THREE.Matrix4 {
  return out.copy(MIRROR).multiply(m).multiply(MIRROR);
}

function armOk(limbs: LimbState, bone: string): boolean {
  if (bone.endsWith('_L')) return limbs.armL !== 'missing';
  if (bone.endsWith('_R')) return limbs.armR !== 'missing';
  // a central bone (chest) is held by both hands
  return limbs.armL !== 'missing' && limbs.armR !== 'missing';
}

/**
 * Where `item` goes for animation plan `plan` with `limbs` (inputs assumed sanitised). Falls back from an anchor to
 * the palm when the anchor's hand is missing, and to nothing when no hand is left.
 */
export function resolveCarry(item: CarryItem | null, plan: AnimPlan, limbs: LimbState,
  anchors: ReadonlyMap<string, CarryAnchor>): CarryPlacement {
  if (!item) return NONE;
  const a = anchors.get(plan.clip);
  if (a && a.items.has(item)) {
    const bone = plan.mirror ? mirrorBoneName(a.bone) : a.bone;
    let extra: AnchorExtra | null = null;
    if (a.extra) {
      const eb = plan.mirror ? mirrorBoneName(a.extra.bone) : a.extra.bone;
      if (armOk(limbs, eb)) {
        extra = { item: a.extra.item, bone: eb, matrix: plan.mirror ? mirrorLocalMatrix(a.extra.matrix) : a.extra.matrix.clone() };
      }
    }
    const tag = `${item}|${plan.clip}|${plan.mirror ? 'm' : ''}|${bone}|${extra ? extra.bone : '-'}`;
    if (armOk(limbs, bone)) {
      const matrix = plan.mirror ? mirrorLocalMatrix(a.matrix) : a.matrix.clone();
      return { kind: 'anchor', bone, matrix, variant: a.variant, extra, hold: false, key: `anchor|${tag}` };
    }
    // the holding hand is gone: never fall back onto the eating hand (the plate would fly to the mouth) -
    // keep just the extra prop when there is one
    if (extra) return { kind: 'extra', bone: '', matrix: null, variant: a.variant, extra, hold: false, key: `extra|${tag}` };
  }
  const hand = carryHand(limbs);
  if (!hand) return NONE;
  const hold = HOLD_ITEMS.has(item) && HOLD_ANIMS.has(plan.clip);
  return { kind: 'palm', bone: `prop_${hand}`, matrix: null, variant: 'palm', extra: null, hold, key: `${item}|palm|${hand}` };
}
