/**
 * Mood posture layer - ART_DIRECTION "Animation feel": happy = bouncy shoulders, sad = slump (and a matching
 * carriage for every other expression). Small additive rotations of the chest, neck, head and shoulders driven by
 * the explicit expression, layered over whatever clip plays: a slumped walk or a bouncy idle reads from the game
 * camera, where the face morphs alone are a few pixels.
 *
 * Deltas use the build's semantic axes (degrees, see tools/blender/characters/lib/skeleton.py): x pitches the top
 * of a bone forward, y tilts it toward the character's left, z turns its front toward the left; the right
 * shoulder mirrors (x, -y, -z). Each axis is converted once into the bone's parent rest frame, so applying the
 * layer is one quaternion pre-multiplication per bone per frame (no allocations). Like the carry hold layer the
 * edit must be undone (restore()) before the AnimationMixer runs: three's PropertyMixer only writes values that
 * changed, so a post-mixer edit left in place would accumulate on frozen clips.
 */
import * as THREE from 'three';
import { EXPRESSIONS } from '../../shared/appearance';
import type { AnyAnimState, Expression } from '../../shared/appearance';

export const POSTURE_BONES = ['chest', 'neck', 'head', 'shoulder_L', 'shoulder_R'] as const;
export type PostureBone = (typeof POSTURE_BONES)[number];
/** Floats per posture frame: (x, y, z) degrees for each POSTURE_BONES entry, right shoulder already mirrored. */
export const POSTURE_SIZE = POSTURE_BONES.length * 3;

const TAU = Math.PI * 2;

function put(out: Float32Array, bone: number, x: number, y: number, z: number): void {
  out[bone * 3] = x;
  out[bone * 3 + 1] = y;
  out[bone * 3 + 2] = z;
}

/** Both shoulders with the same LEFT-side semantics (mirrored onto the right). */
function shoulders(out: Float32Array, x: number, y: number, z: number): void {
  put(out, 3, x, y, z);
  put(out, 4, x, -y, -z);
}

/**
 * Carriage of `expr` at time `t` (s) written into `out` (POSTURE_SIZE floats, degrees). Pure; bounded to
 * |angle| <= 15 so it never fights the clip underneath.
 */
export function postureFor(expr: Expression, t: number, out: Float32Array): Float32Array {
  out.fill(0);
  const time = Number.isFinite(t) ? t : 0;
  switch (expr) {
    case 'happy': {
      // bouncy shoulders: two quick hitches a second, chest lifted, the head waggling along
      const b = Math.max(0, Math.sin(time * TAU * 2.1)) ** 1.5;
      put(out, 0, -3 - 1.5 * b, 0, 0);
      put(out, 1, -1, 0, 0);
      put(out, 2, -3, 4 * Math.sin(time * TAU * 1.05), 0);
      shoulders(out, 0, -7 * b, 0);
      break;
    }
    case 'sad': // slump: chest caves, head hangs, shoulders drop and roll forward
      put(out, 0, 9, 0, 0);
      put(out, 1, 6, 0, 0);
      put(out, 2, 9, 0, 0);
      shoulders(out, 0, 5, -6);
      break;
    case 'angry': {
      // tense: shoulders hunched up and trembling, chin jutting forward
      const tremble = 1.2 * Math.sin(time * TAU * 9);
      put(out, 0, 3, 0, 0);
      put(out, 1, 5, 0, 0);
      put(out, 2, -7, 0, 0);
      shoulders(out, 0, -6 + tremble, -3);
      break;
    }
    case 'sleepy': {
      // droopy, the head nodding now and then
      const nod = Math.max(0, Math.sin(time * TAU * 0.25)) ** 3;
      put(out, 0, 3, 0, 0);
      put(out, 1, 5, 0, 0);
      put(out, 2, 7 + 5 * nod, 5, 0);
      shoulders(out, 0, 4, -3);
      break;
    }
    case 'shocked': // recoil: chest pulled back, shoulders jumped up to the ears
      put(out, 0, -6, 0, 0);
      put(out, 1, -3, 0, 0);
      put(out, 2, -5, 0, 0);
      shoulders(out, 0, -11, 2);
      break;
    case 'flirty': // coy: head tilted, one shoulder raised toward the chin, a slow sway
      put(out, 0, 0, -3, 0);
      put(out, 1, 0, 3, 0);
      put(out, 2, -2, 9 + 2 * Math.sin(time * TAU * 0.5), 3);
      put(out, 3, 0, -7, 0);
      break;
    case 'disgusted': // recoil and turn the face away
      put(out, 0, -5, -3, -5);
      put(out, 1, -3, 0, 0);
      put(out, 2, -4, -6, -12);
      shoulders(out, 0, -5, 0);
      break;
    case 'focused': // leaning in
      put(out, 0, 3, 0, 0);
      put(out, 1, 5, 0, 0);
      put(out, 2, 2, 0, 0);
      shoulders(out, 0, 0, -4);
      break;
    default:
      break;
  }
  return out;
}

/** Clips that already lie / crawl (no carriage layer) or that act the emotion out themselves (softened). */
const POSTURE_GAIN: Partial<Record<AnyAnimState, number>> = {
  sleep: 0, beEmbalmed: 0, bath: 0, crawl: 0, collapse: 0,
  // extras (W-056): emotes and whole-body actions soften the carriage like their core counterparts
  pray: 0.3, prank: 0.4, punch: 0.4, toast: 0.4, jump: 0.5, chase: 0.5, shiver: 0.4, vows: 0.5, selfie: 0.5,
  pose: 0.5, crouchPet: 0.5, swing: 0.5, djScratch: 0.5, playGuitar: 0.6,
  cry: 0.3, mourn: 0.3, laugh: 0.4, cheer: 0.4, angry: 0.4, yawn: 0.4, disgusted: 0.4, feral: 0.4,
  dance: 0.5, flirt: 0.5, kiss: 0.5, hug: 0.6, phone: 0.5, sitEat: 0.6, standEat: 0.6, read: 0.7, sitRead: 0.7,
};

/** How strongly the posture layer applies on top of `clip` (0..1). */
export function postureGain(clip: AnyAnimState): number {
  return POSTURE_GAIN[clip] ?? 1;
}

const EXPR_COUNT = EXPRESSIONS.length;
const DEG = Math.PI / 180;
const X_SEM = new THREE.Vector3(1, 0, 0); // character lateral (+ = left)
const Y_SEM = new THREE.Vector3(0, 0, -1); // Blender +Y (back) in glTF / three axes
const Z_SEM = new THREE.Vector3(0, 1, 0); // up

/** Per-rig posture state: expression blend weights + the bones it edits (see module doc). */
export class PostureLayer {
  private readonly bones: (THREE.Object3D | null)[];
  /** Semantic x / y / z axes of each bone in its parent's rest frame. */
  private readonly axes: THREE.Vector3[][];
  private readonly saved: THREE.Quaternion[];
  private readonly weights = new Float32Array(EXPR_COUNT);
  private readonly frame = new Float32Array(POSTURE_SIZE);
  private readonly sum = new Float32Array(POSTURE_SIZE);
  private readonly qa = new THREE.Quaternion();
  private readonly qb = new THREE.Quaternion();
  private active = 0;
  private time = 0;
  private applied = false;

  /** `find` resolves bone names on a rig still in its REST pose (axes are measured from it). */
  constructor(find: (name: string) => THREE.Object3D | null | undefined) {
    this.weights[0] = 1; // 'neutral'
    this.bones = POSTURE_BONES.map((n) => find(n) ?? null);
    this.saved = POSTURE_BONES.map(() => new THREE.Quaternion());
    const pq = new THREE.Quaternion();
    this.axes = this.bones.map((b) => {
      if (b?.parent) b.parent.getWorldQuaternion(pq);
      else pq.identity();
      pq.invert();
      return [X_SEM.clone().applyQuaternion(pq), Y_SEM.clone().applyQuaternion(pq), Z_SEM.clone().applyQuaternion(pq)];
    });
  }

  setExpression(expr: Expression): void {
    const i = EXPRESSIONS.indexOf(expr);
    this.active = i < 0 ? 0 : i;
  }

  /** Current blend weight of an expression's carriage (tests / debugging). */
  weight(expr: Expression): number {
    const i = EXPRESSIONS.indexOf(expr);
    return i < 0 ? 0 : this.weights[i];
  }

  /** Undo last frame's edit (call before the AnimationMixer runs). */
  restore(): void {
    if (!this.applied) return;
    for (let i = 0; i < this.bones.length; i++) this.bones[i]?.quaternion.copy(this.saved[i]);
    this.applied = false;
  }

  /** Blend toward the active expression and apply the carriage scaled by `gain` (0 = off). */
  apply(dtIn: number, gainIn: number): void {
    const dt = Number.isFinite(dtIn) && dtIn > 0 ? dtIn : 0;
    const gain = Number.isFinite(gainIn) ? Math.min(1, Math.max(0, gainIn)) : 0;
    this.time += dt;
    const k = 1 - Math.exp(-dt * 5);
    const sum = this.sum;
    sum.fill(0);
    for (let e = 0; e < EXPR_COUNT; e++) {
      const target = e === this.active ? 1 : 0;
      let w = this.weights[e] + (target - this.weights[e]) * k;
      if (Math.abs(target - w) < 1e-4) w = target; // settle exactly (a held carriage is perfectly still)
      this.weights[e] = w;
      if (e === 0 || w < 1e-3) continue; // neutral carries no delta
      postureFor(EXPRESSIONS[e], this.time, this.frame);
      for (let i = 0; i < POSTURE_SIZE; i++) sum[i] += w * this.frame[i];
    }
    let peak = 0;
    for (let i = 0; i < POSTURE_SIZE; i++) peak = Math.max(peak, Math.abs(sum[i]));
    if (peak * gain < 0.01) return;
    for (let i = 0; i < this.bones.length; i++) {
      const b = this.bones[i];
      if (!b) continue;
      const ax = this.axes[i];
      this.saved[i].copy(b.quaternion);
      // same order as the build's euler_matrix(..., 'XYZ'): x applied first -> D = Rz * Ry * Rx
      const s = gain * DEG;
      this.qa.setFromAxisAngle(ax[2], sum[i * 3 + 2] * s);
      this.qb.setFromAxisAngle(ax[1], sum[i * 3 + 1] * s);
      this.qa.multiply(this.qb);
      this.qb.setFromAxisAngle(ax[0], sum[i * 3] * s);
      this.qa.multiply(this.qb);
      b.quaternion.premultiply(this.qa);
    }
    this.applied = true;
  }
}
