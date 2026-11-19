/**
 * Rig for a sculpted CAST body (shared/cast.ts): one SkeletonUtils clone of the cast template per zombie, per-rig
 * cloned materials (textures stay template-owned), the same interruption-safe 0.25 s crossfader, missing-limb
 * clip substitution, carry anchors, mood posture layer and highlight rim as the classic GltfRig.
 *
 * Differences from the classic rig (the cast body is one textured mesh with no style variants / face morphs):
 *  - limb loss collapses the forearm (arm) or shin (leg) bone to ~0 - its whole sub-chain (hand / foot) follows -
 *    and adds a small stump cap tinted to the body at the elbow / knee; a prosthetic adds a wooden peg arm / leg
 *    that follows the collapsed bone's animation;
 *  - setExpression drives the posture layer plus (when the body exposes an eye material) a subtle eye tint;
 *  - setTalking flaps the `jaw` bone when the skeleton has one, else nods the head slightly;
 *  - setDecay slightly dulls the body colour;
 *  - appearance.height scales +-6 % around the body's own height (castHeightScale).
 */
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AnyAnimState, CarryItem, Expression, LimbState, ZombieAppearance } from '../../shared/appearance';
import { EXPRESSIONS } from '../../shared/appearance';
import type { CastBodyId } from '../../shared/cast';
import { DIM } from '../../shared/dimensions';
import { resolveCarry } from './anchors';
import type { CarryPlacement } from './anchors';
import type { CarryLibrary } from './carry';
import type { CastLibrary, CastTemplate } from './cast';
import { mirrorClip } from './clips';
import { clamp01, parseHex } from './colors';
import { FaceController } from './face';
import { HeldPropStow } from './heldProps';
import { createRigUniforms, disposeMaterials, patchMaterial } from './materials';
import type { RigUniforms } from './materials';
import { ARM_CHAIN } from './names';
import { PostureLayer, postureGain } from './posture';
import {
  LOCOMOTION_ANIMS, ONE_SHOT_ANIMS, appearanceSeed, carryHand, carryShown, castHeightScale, floorContactLift, resolveAnim,
  seatContactHeight,
} from './plan';
import type { AnimPlan } from './plan';
import { CROSSFADE_SEC, countDrawCalls, shareSkeletons } from './rig';
import type { HighlightMode, RigImpl, RigStats } from './rig';

const HIGHLIGHT = {
  none: { color: '#e8e0c8', strength: 0 },
  hover: { color: '#e8e0c8', strength: 0.25 },
  selected: { color: '#9fe870', strength: 0.55 },
} as const;

/** Clearance (m) kept between a missing leg's stump cap and the floor by CastRig.clampStumps. */
export const STUMP_FLOOR_MARGIN = 0.004;
/** Collapsed bone scale (not exactly 0: keeps skinning normals finite). */
export const COLLAPSED_SCALE = 1e-3;
/** Per-expression eye tint: colour mixed over the eye colour + how much (subtle; never hides the eye colour). */
const EYE_TINT: Record<Expression, { color: string; mix: number; glow: number }> = {
  neutral: { color: '#000000', mix: 0, glow: 0 },
  happy: { color: '#ffe08a', mix: 0.25, glow: 0.18 },
  sad: { color: '#7fa6ff', mix: 0.3, glow: 0.1 },
  angry: { color: '#ff3b2e', mix: 0.45, glow: 0.35 },
  sleepy: { color: '#2a2630', mix: 0.35, glow: 0 },
  disgusted: { color: '#b6d84a', mix: 0.3, glow: 0.12 },
  flirty: { color: '#ff8fd0', mix: 0.3, glow: 0.2 },
  shocked: { color: '#ffffff', mix: 0.35, glow: 0.3 },
  focused: { color: '#9fe870', mix: 0.25, glow: 0.2 },
};
const EYE_TINT_LINEAR: Record<Expression, THREE.Color> = Object.fromEntries(
  EXPRESSIONS.map((e) => {
    const c = parseHex(EYE_TINT[e].color);
    return [e, new THREE.Color().setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace)];
  }),
) as Record<Expression, THREE.Color>;
const SIDES = ['L', 'R'] as const;
type Side = (typeof SIDES)[number];
type LimbKind = 'arm' | 'leg';
/** Bone collapsed per limb, its parent (where cap / peg live) and its child (peg direction). */
const LIMB_BONES: Record<LimbKind, { collapse: string; parent: string; child: string }> = {
  arm: { collapse: 'forearm', parent: 'upperarm', child: 'hand' },
  leg: { collapse: 'shin', parent: 'thigh', child: 'foot' },
};

interface Fade {
  action: THREE.AnimationAction;
  clip: AnyAnimState;
  weight: number;
  target: number;
  /** Rig frame (update count) in which this clip started (pickup reveal: did the carried item arrive with it?). */
  start: number;
}

interface LimbVisual {
  /** The collapsed bone (forearm / shin). */
  bone: THREE.Object3D;
  cap: THREE.Mesh | null;
  /** Follows the collapsed bone's local transform without its scale; carries the peg. */
  pegPivot: THREE.Object3D | null;
}

/** Shared unit geometries for stump caps / pegs (owned by the factory, disposed with it). */
export class CastParts {
  readonly cap: THREE.BufferGeometry;
  readonly peg: THREE.BufferGeometry;
  private disposed = false;

  constructor() {
    // dome cap: unit sphere squashed along the limb (+Y)
    this.cap = new THREE.SphereGeometry(1, 12, 8);
    // tapered peg along +Y from 0 to 1, with a rounded foot
    const peg = new THREE.CylinderGeometry(0.8, 1, 1, 10, 1);
    peg.translate(0, 0.5, 0);
    this.peg = peg;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cap.dispose();
    this.peg.dispose();
  }
}

const UP = new THREE.Vector3(0, 1, 0);

export class CastRig implements RigImpl {
  readonly kind = 'cast' as const;
  readonly object = new THREE.Group();
  readonly body: CastBodyId;
  private readonly inner: THREE.Object3D;
  private readonly tpl: CastTemplate;
  private readonly lib: CastLibrary;
  private readonly carryLib: CarryLibrary;
  private readonly parts: CastParts;
  private readonly mixer: THREE.AnimationMixer;
  private readonly bones = new Map<string, THREE.Object3D>();
  private readonly materials: THREE.Material[] = [];
  private readonly bodyMats: THREE.MeshStandardMaterial[] = [];
  private readonly bodyBase: THREE.Color[] = [];
  private readonly eyeMats: THREE.MeshStandardMaterial[] = [];
  private readonly uniforms: RigUniforms = createRigUniforms();
  private readonly skeletons: THREE.Skeleton[];
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly fades: Fade[] = [];
  private readonly face: FaceController;
  private faceSeed: number;
  private readonly posture: PostureLayer;
  /** Sculpted held props stowed off the hand in hands-down clips (W-120). */
  private readonly props: HeldPropStow;
  private readonly propClips: { clip: AnyAnimState; weight: number }[] = [];
  private readonly head: THREE.Object3D | null;
  /** Bone the talk layer moves (jaw, else head) and its amplitude (rad). */
  private readonly jaw: THREE.Object3D | null;
  private readonly talkAngle: number;
  private readonly jawAxis = new THREE.Vector3(1, 0, 0);
  private readonly jawSaved = new THREE.Quaternion();
  private jawApplied = false;
  private readonly chains: Record<Side, (THREE.Object3D | null)[]>;
  private readonly carryQuats: Record<Side, (THREE.Quaternion | null)[]>;
  private readonly headOffset = new THREE.Vector3();
  private readonly saved: THREE.Quaternion[] = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
  private readonly limbVis = new Map<string, LimbVisual>();
  private capMat: THREE.MeshStandardMaterial | null = null;
  private woodMat: THREE.MeshStandardMaterial | null = null;
  private heldSide: Side | null = null;
  private hand: Side | null = 'R';
  private app: ZombieAppearance;
  private limbs: LimbState;
  private decay = 0;
  private requested: AnyAnimState = 'idle';
  private plan: AnimPlan = { clip: 'idle', mirror: false, timeScale: 1 };
  private speed = 1;
  private scale = 1;
  private expr: Expression = 'neutral';
  private readonly eyeWeights = new Float32Array(EXPRESSIONS.length);
  private readonly eyeBase = new THREE.Color();
  private readonly tmpColor = new THREE.Color();
  private readonly tmpQ = new THREE.Quaternion();
  /** Thighs of missing legs raised this frame by clampStumps (restored before the next mixer pass). */
  private readonly stumpSaved = new Map<THREE.Object3D, THREE.Quaternion>();
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpQ2 = new THREE.Quaternion();
  private carryItem: CarryItem | null = null;
  private carryObj: THREE.Object3D | null = null;
  /** Update count, and the one in which the carried item last changed (pickup reveal). */
  private frame = 0;
  private carryFrame = -1;
  private extraObj: THREE.Object3D | null = null;
  private placement: CarryPlacement | null = null;
  private holdW = 0;
  private rimTarget = 0;
  private disposed = false;

  constructor(tpl: CastTemplate, lib: CastLibrary, carry: CarryLibrary, parts: CastParts, app: ZombieAppearance, limbs: LimbState) {
    this.tpl = tpl;
    this.lib = lib;
    this.carryLib = carry;
    this.parts = parts;
    this.body = tpl.id;
    this.app = app;
    this.limbs = limbs;
    this.hand = carryHand(limbs);
    this.inner = SkeletonUtils.clone(tpl.scene);
    this.inner.name = 'CastModel';
    this.inner.position.set(0, 0, 0);
    this.inner.quaternion.identity();
    this.inner.scale.setScalar(1);
    this.object.name = `ZombieCast_${tpl.id}`;
    this.object.add(this.inner);
    lib.acquire(tpl);
    this.skeletons = shareSkeletons(this.inner);
    for (const n of tpl.boneNames) {
      const o = this.inner.getObjectByName(n);
      if (o) this.bones.set(n, o);
    }
    this.cloneMaterials();
    const find = (n: string) => this.bones.get(n) ?? null;
    this.head = find('head');
    // talking flaps the jaw; bodies without one (the shipped cast) nod the head a little instead
    this.jaw = find('jaw') ?? this.head;
    this.talkAngle = find('jaw') ? 0.22 : 0.06;
    this.chains = { L: ARM_CHAIN.L.map(find), R: ARM_CHAIN.R.map(find) };
    this.carryQuats = {
      L: ARM_CHAIN.L.map((b) => tpl.carryPose.get(b) ?? null),
      R: ARM_CHAIN.R.map((b) => tpl.carryPose.get(b) ?? null),
    };
    this.mixer = new THREE.AnimationMixer(this.inner);
    this.faceSeed = this.seedFor(app);
    this.face = new FaceController(this.faceSeed);
    this.posture = new PostureLayer((n) => this.bones.get(n) ?? null);
    this.props = new HeldPropStow(tpl.heldProps, (n) => this.bones.get(n) ?? this.inner.getObjectByName(n));
    this.eyeWeights[0] = 1;
    this.inner.updateMatrixWorld(true);
    if (this.head) {
      const inv = new THREE.Matrix4().copy(this.head.matrixWorld).invert();
      this.headOffset.copy(tpl.headTopRest).applyMatrix4(inv);
    }
    if (this.jaw?.parent) {
      // opening = the chin (+Z) swings down = +rotation about the character's lateral axis, in the parent frame
      const pq = this.jaw.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      this.jawAxis.set(1, 0, 0).applyQuaternion(pq).normalize();
    }
    this.setAppearance(app);
    this.applyLimbs();
  }

  private seedFor(app: ZombieAppearance): number {
    let h = appearanceSeed(app) ^ 0x5bd1e995;
    for (let i = 0; i < this.body.length; i++) h = Math.imul(h ^ this.body.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  // ───────────────────────────── setup
  private cloneMaterials(): void {
    const cache = new Map<THREE.Material, THREE.Material>();
    const eyeName = this.tpl.entry.eyeMaterial;
    this.inner.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const clone = (src: THREE.Material): THREE.Material => {
        let m = cache.get(src);
        if (!m) {
          m = src.clone();
          m.name = src.name;
          patchMaterial(m, this.uniforms, false);
          cache.set(src, m);
          this.materials.push(m);
          const std = m as THREE.MeshStandardMaterial;
          if (std.color) {
            if (eyeName && src.name === eyeName) this.eyeMats.push(std);
            else {
              this.bodyMats.push(std);
              this.bodyBase.push(std.color.clone());
            }
          }
        }
        return m;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material as THREE.Material);
    });
  }

  private rimMat(color: THREE.ColorRepresentation, rough: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
    patchMaterial(m, this.uniforms, false);
    this.materials.push(m);
    return m;
  }

  private getCapMat(): THREE.MeshStandardMaterial {
    if (!this.capMat) {
      this.capMat = this.rimMat(0xffffff, 0.85);
      this.capMat.name = 'CastStump';
      this.capMat.color.copy(this.tpl.tint).multiplyScalar(0.85);
    }
    return this.capMat;
  }

  private getWoodMat(): THREE.MeshStandardMaterial {
    if (!this.woodMat) {
      this.woodMat = this.rimMat('#8a5a36', 0.7);
      this.woodMat.name = 'CastPeg';
    }
    return this.woodMat;
  }

  /** Bone-local direction + length from a bone to its child at rest (template pose). */
  private restSegment(child: string): { dir: THREE.Vector3; len: number } {
    const c = this.tpl.scene.getObjectByName(child);
    const p = c?.position.clone() ?? new THREE.Vector3(0, -0.25, 0);
    const len = p.length();
    return { dir: len > 1e-4 ? p.divideScalar(len) : new THREE.Vector3(0, -1, 0), len: len > 1e-4 ? len : 0.25 };
  }

  private limbRadius(kind: LimbKind): number {
    const k = this.tpl.def.height / 1.72;
    return (kind === 'arm' ? 0.048 : 0.068) * Math.min(1.35, Math.max(0.8, k)) * (this.tpl.def.category === 'boss' ? 1.35 : 1);
  }

  /** Apply limb collapse + caps / pegs for the current LimbState (idempotent). */
  private applyLimbs(): void {
    for (const kind of ['arm', 'leg'] as const) {
      for (const s of SIDES) {
        const cond = this.limbs[`${kind}${s}` as keyof LimbState];
        const names = LIMB_BONES[kind];
        const bone = this.bones.get(`${names.collapse}_${s}`);
        const parent = this.bones.get(`${names.parent}_${s}`);
        const key = `${kind}${s}`;
        let vis = this.limbVis.get(key);
        if (!bone || !parent) continue;
        if (!vis) {
          vis = { bone, cap: null, pegPivot: null };
          this.limbVis.set(key, vis);
        }
        const gone = cond !== 'ok';
        bone.scale.setScalar(gone ? COLLAPSED_SCALE : 1);
        const r = this.limbRadius(kind);
        if (gone && !vis.cap) {
          const cap = new THREE.Mesh(this.parts.cap, this.getCapMat());
          cap.name = `Stump_${kind === 'arm' ? 'Arm' : 'Leg'}${s}`;
          const seg = this.restSegment(`${names.child}_${s}`);
          // cap sits at the joint (the collapsed bone's origin, in the parent's frame), domed along the limb
          cap.position.copy(bone.position);
          const rest = this.tpl.scene.getObjectByName(bone.name)?.quaternion ?? bone.quaternion;
          const dirInParent = seg.dir.clone().applyQuaternion(rest);
          cap.quaternion.setFromUnitVectors(UP, dirInParent);
          cap.scale.set(r, r * 0.55, r);
          cap.castShadow = false;
          cap.receiveShadow = true;
          cap.frustumCulled = false;
          parent.add(cap);
          vis.cap = cap;
        } else if (!gone && vis.cap) {
          vis.cap.removeFromParent();
          vis.cap = null;
        }
        const peg = cond === 'prosthetic';
        if (peg && !vis.pegPivot) {
          const pivot = new THREE.Object3D();
          pivot.name = `Prosthetic_${kind === 'arm' ? 'Arm' : 'Leg'}${s}`;
          const seg = this.restSegment(`${names.child}_${s}`);
          // arm: forearm + hand length; leg: shin + down to the floor (foot bone height at rest)
          let len = seg.len;
          if (kind === 'arm') len += 0.07 * (this.tpl.def.height / 1.72);
          else {
            const foot = this.tpl.scene.getObjectByName(`foot_${s}`);
            const fy = foot ? foot.getWorldPosition(new THREE.Vector3()).y : 0.08;
            len += Math.max(0, Math.min(0.15, fy));
          }
          const mesh = new THREE.Mesh(this.parts.peg, this.getWoodMat());
          mesh.name = `${pivot.name}_peg`;
          mesh.quaternion.setFromUnitVectors(UP, seg.dir);
          const pr = r * (kind === 'arm' ? 0.55 : 0.5);
          mesh.scale.set(pr, len, pr);
          mesh.castShadow = false;
          mesh.receiveShadow = true;
          mesh.frustumCulled = false;
          pivot.add(mesh);
          parent.add(pivot);
          vis.pegPivot = pivot;
        } else if (!peg && vis.pegPivot) {
          vis.pegPivot.removeFromParent();
          vis.pegPivot = null;
        }
      }
    }
  }

  /**
   * W-120 stump floor clamp: a missing leg's shin is collapsed to the knee, where the stump cap sits; clips that
   * drag the thighs along the floor (crawl) would push the knee end - cap and thigh surface - below it. Raise the
   * thigh about the hip, in the vertical plane of the limb, just enough that the knee clears the rig's floor
   * (root y = 0) by the cap radius. Hip and pelvis stay put (no root lift); clips that keep the knees up are untouched.
   */
  private clampStumps(): void {
    let first = true;
    for (const s of SIDES) {
      if (this.limbs[`leg${s}` as keyof LimbState] !== 'missing') continue;
      const thigh = this.bones.get(`thigh_${s}`);
      const knee = this.bones.get(`shin_${s}`);
      if (!thigh || !knee || !thigh.parent) continue;
      if (first) {
        this.object.updateWorldMatrix(true, true);
        this.tmpM.copy(this.object.matrixWorld).invert(); // the rig root's frame: the floor is y = 0
        first = false;
      }
      const hip = thigh.getWorldPosition(this.tmpA).applyMatrix4(this.tmpM);
      const k = knee.getWorldPosition(this.tmpB).applyMatrix4(this.tmpM);
      const clear = this.limbRadius('leg') * this.scale + STUMP_FLOOR_MARGIN;
      if (k.y >= clear) continue;
      const d = k.sub(hip);
      const len = d.length();
      if (len < 1e-4) continue;
      const want = Math.min(1, (clear - hip.y) / len);
      const delta = Math.asin(want < -1 ? -1 : want) - Math.asin(Math.max(-1, Math.min(1, d.y / len)));
      if (!(delta > 1e-5)) continue;
      // axis (root frame): horizontal, across the limb, so that a positive turn lifts the knee
      const axis = this.tmpA.set(d.z, 0, -d.x);
      if (axis.lengthSq() < 1e-10) axis.set(1, 0, 0);
      axis.normalize().negate();
      // turn in the root frame -> thigh-local: q' = Prel^-1 * R * Prel * q (Prel = thigh parent relative to the root)
      const prel = thigh.parent.getWorldQuaternion(this.tmpQ2).premultiply(this.object.getWorldQuaternion(this.tmpQ).invert());
      this.tmpQ.setFromAxisAngle(axis, delta).multiply(prel).premultiply(prel.clone().invert());
      this.stumpSaved.set(thigh, thigh.quaternion.clone());
      thigh.quaternion.premultiply(this.tmpQ);
    }
  }

  /** Pegs follow their collapsed bone's animated local transform (minus the collapse scale). */
  private syncPegs(): void {
    for (const v of this.limbVis.values()) {
      if (!v.pegPivot) continue;
      v.pegPivot.position.copy(v.bone.position);
      v.pegPivot.quaternion.copy(v.bone.quaternion);
    }
  }

  private applyBodyColor(): void {
    // decay dulls the sculpted texture slightly (skin tone does not apply to cast bodies)
    const d = clamp01(this.decay) * 0.35;
    for (let i = 0; i < this.bodyMats.length; i++) {
      this.tmpColor.setRGB(0.78, 0.76, 0.62).multiply(this.bodyBase[i]);
      this.bodyMats[i].color.copy(this.bodyBase[i]).lerp(this.tmpColor, d);
    }
  }

  // ───────────────────────────── ZombieRig surface
  setAppearance(app: ZombieAppearance): void {
    this.app = app;
    const seed = this.seedFor(app);
    if (seed !== this.faceSeed) {
      this.faceSeed = seed;
      this.face.reseed(seed);
    }
    const c = parseHex(app.eyeColor);
    this.eyeBase.setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace);
    this.applyEyes();
    this.scale = castHeightScale(app.height);
    this.inner.scale.setScalar(this.scale);
  }

  setLimbs(limbs: LimbState): void {
    this.restoreLayers();
    this.limbs = limbs;
    this.hand = carryHand(limbs);
    this.applyLimbs();
    this.play(resolveAnim(this.requested, limbs, this.hasClip), false);
    this.placement = null;
    this.attachCarry();
  }

  setDecay(level: number): void {
    this.decay = clamp01(level);
    this.applyBodyColor();
  }

  /** Baked clips of this body, else zombie.glb's (shared-clip rule), so cast bodies inherit extras (W-056). */
  private readonly hasClip = (name: string): boolean => this.tpl.clip(name as AnyAnimState) !== null;

  setAnim(state: AnyAnimState): void {
    this.requested = state;
    this.play(resolveAnim(state, this.limbs, this.hasClip), false);
  }

  private clipFor(plan: AnimPlan): THREE.AnimationClip | null {
    const base = this.tpl.clip(plan.clip) ?? this.tpl.clip('idle');
    if (!base || !plan.mirror) return base;
    let m = this.tpl.mirrored.get(plan.clip);
    if (!m) {
      m = mirrorClip(base);
      this.tpl.mirrored.set(plan.clip, m);
    }
    return m;
  }

  private play(plan: AnimPlan, force: boolean): void {
    const same = plan.clip === this.plan.clip && plan.mirror === this.plan.mirror;
    const prev = this.plan;
    this.plan = plan;
    this.face.setAnimHint(plan.clip);
    if (!same) this.attachCarry();
    const clip = this.clipFor(plan);
    if (!clip) return;
    let action = this.actions.get(clip.name);
    if (!action) {
      action = this.mixer.clipAction(clip);
      this.actions.set(clip.name, action);
    }
    action.timeScale = this.timeScaleFor(plan);
    if (same && !force && prev.timeScale === plan.timeScale && this.fades.some((f) => f.action === action)) return;
    let fade = this.fades.find((f) => f.action === action);
    if (!fade) {
      action.reset();
      if (ONE_SHOT_ANIMS.has(plan.clip)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.time = this.loopPhase(plan.clip) * clip.duration;
      }
      const first = this.fades.length === 0;
      action.setEffectiveWeight(first ? 1 : 0);
      action.play();
      fade = { action, clip: plan.clip, weight: first ? 1 : 0, target: 1, start: this.frame };
      this.fades.push(fade);
    }
    for (const f of this.fades) f.target = f === fade ? 1 : 0;
  }

  private loopPhase(clip: string): number {
    let h = this.faceSeed ^ 0x9e3779b9;
    for (let i = 0; i < clip.length; i++) h = Math.imul(h ^ clip.charCodeAt(i), 16777619);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    return (h >>> 0) / 4294967296;
  }

  private timeScaleFor(plan: AnimPlan): number {
    return (LOCOMOTION_ANIMS.has(plan.clip) ? this.speed : 1) * plan.timeScale;
  }

  setExpression(expr: Expression): void {
    this.expr = expr;
    this.face.setExpression(expr);
    this.posture.setExpression(expr);
  }

  setTalking(on: boolean): void {
    this.face.setTalking(on);
  }

  setCarry(item: CarryItem | null): void {
    if (item === this.carryItem) return;
    this.carryItem = item;
    this.carryFrame = this.frame;
    this.attachCarry();
  }

  /** Carry parent bone; bodies without prop bones carry on the hand. */
  private carryBone(name: string): THREE.Object3D | null {
    return this.bones.get(name) ?? (name.startsWith('prop_') ? this.bones.get(`hand_${name.slice(5)}`) ?? null : null);
  }

  private detachCarry(): void {
    this.carryObj?.removeFromParent();
    this.extraObj?.removeFromParent();
    this.carryObj = null;
    this.extraObj = null;
  }

  private attachCarry(): void {
    if (this.disposed) return;
    const next = resolveCarry(this.carryItem, this.plan, this.limbs, this.tpl.anchors);
    if (this.placement && this.placement.key === next.key) {
      this.placement = next;
      return;
    }
    this.restoreLayers();
    this.detachCarry();
    this.placement = next;
    if (next.kind === 'none' || !this.carryItem || this.carryLib.isDisposed) return;
    const parent = next.kind === 'extra' ? null : this.carryBone(next.bone);
    if (parent) {
      const obj = this.carryLib.create(this.carryItem, next.variant);
      if (next.matrix) next.matrix.decompose(obj.position, obj.quaternion, obj.scale);
      parent.add(obj);
      this.carryObj = obj;
    }
    if (next.extra) {
      const ep = this.carryBone(next.extra.bone);
      if (ep) {
        const ex = this.carryLib.createExtra(next.extra.item);
        next.extra.matrix.decompose(ex.position, ex.quaternion, ex.scale);
        ep.add(ex);
        this.extraObj = ex;
      }
    }
  }

  setHighlight(mode: HighlightMode): void {
    const h = HIGHLIGHT[mode] ?? HIGHLIGHT.none;
    if (h.strength > 0) this.uniforms.uRimColor.value.set(h.color);
    this.rimTarget = h.strength;
  }

  setMoveSpeed(scale: number): void {
    const s = Number.isFinite(scale) && scale >= 0 ? scale : 1;
    if (s === this.speed) return;
    this.speed = s;
    for (const f of this.fades) {
      if (LOCOMOTION_ANIMS.has(f.clip)) f.action.timeScale = this.speed * (f.clip === this.plan.clip ? this.plan.timeScale : 1);
    }
  }

  private applyEyes(): void {
    if (!this.eyeMats.length) return;
    const c = this.tmpColor.copy(this.eyeBase);
    let gr = 0;
    let gg = 0;
    let gb = 0;
    for (let e = 1; e < EXPRESSIONS.length; e++) {
      const w = this.eyeWeights[e];
      if (w < 1e-3) continue;
      const t = EYE_TINT[EXPRESSIONS[e]];
      const tint = EYE_TINT_LINEAR[EXPRESSIONS[e]];
      c.lerp(tint, t.mix * w);
      gr += tint.r * t.glow * w;
      gg += tint.g * t.glow * w;
      gb += tint.b * t.glow * w;
    }
    for (const m of this.eyeMats) {
      m.color.copy(c);
      m.emissive.setRGB(gr, gg, gb);
    }
  }

  private restoreLayers(): void {
    for (const [bone, q] of this.stumpSaved) bone.quaternion.copy(q);
    this.stumpSaved.clear();
    if (this.heldSide) {
      const bones = this.chains[this.heldSide];
      for (let i = 0; i < bones.length; i++) bones[i]?.quaternion.copy(this.saved[i]);
      this.heldSide = null;
    }
    if (this.jawApplied && this.jaw) {
      this.jaw.quaternion.copy(this.jawSaved);
      this.jawApplied = false;
    }
  }

  update(dtIn: number): void {
    if (this.disposed) return;
    const dt = Number.isFinite(dtIn) && dtIn > 0 ? Math.min(dtIn, 0.25) : 0;
    const step = dt / CROSSFADE_SEC;
    let total = 0;
    for (let i = this.fades.length - 1; i >= 0; i--) {
      const f = this.fades[i];
      if (f.weight < f.target) f.weight = Math.min(f.target, f.weight + step);
      else if (f.weight > f.target) f.weight = Math.max(f.target, f.weight - step);
      if (f.weight <= 0 && f.target <= 0) {
        f.action.stop();
        this.fades.splice(i, 1);
        continue;
      }
      total += f.weight;
    }
    const norm = total > 1e-6 ? 1 / total : 0;
    let seatLift = 0;
    let floorLift = 0;
    let postureW = 0;
    for (const f of this.fades) {
      const w = f.weight * norm;
      f.action.setEffectiveWeight(w);
      seatLift += w * seatContactHeight(f.clip);
      floorLift += w * floorContactLift(this.body, f.clip);
      postureW += w * postureGain(f.clip);
    }
    this.restoreLayers();
    this.posture.restore();
    this.mixer.update(dt);
    this.inner.position.y = (seatLift > 0 ? seatLift * (1 - this.scale) : 0) + floorLift * this.scale;
    this.revealCarry();
    this.frame++;
    const holding = this.carryObj !== null && this.placement !== null && this.placement.hold;
    this.holdW += ((holding ? 1 : 0) - this.holdW) * (1 - Math.exp(-dt * 8));
    if (this.holdW > 0.001 && this.hand) {
      const bones = this.chains[this.hand];
      const quats = this.carryQuats[this.hand];
      for (let i = 0; i < bones.length; i++) {
        const b = bones[i];
        const q = quats[i];
        if (!b) continue;
        this.saved[i].copy(b.quaternion);
        if (q) b.quaternion.slerp(q, this.holdW);
      }
      this.heldSide = this.hand;
    }
    this.posture.apply(dt, postureW);
    const fw = this.face.update(dt);
    if (this.jaw) {
      const open = fw[1]; // 'talk'
      if (open > 1e-3) {
        this.jawSaved.copy(this.jaw.quaternion);
        this.tmpQ.setFromAxisAngle(this.jawAxis, open * this.talkAngle);
        this.jaw.quaternion.premultiply(this.tmpQ);
        this.jawApplied = true;
      }
    }
    this.clampStumps();
    this.syncPegs();
    if (this.props.size) {
      this.propClips.length = 0;
      for (const f of this.fades) this.propClips.push({ clip: f.clip, weight: f.action.getEffectiveWeight() });
      // a prop on a lost arm vanishes with its collapsed hand, as before
      this.props.update(this.propClips, (hand) => this.limbs[hand === 'hand_L' ? 'armL' : 'armR'] === 'ok', this.object);
    }
    // eye tint follows the expression (~0.5 s)
    if (this.eyeMats.length) {
      const k = 1 - Math.exp(-dt * 5);
      const active = EXPRESSIONS.indexOf(this.expr);
      let moved = false;
      for (let e = 0; e < EXPRESSIONS.length; e++) {
        const target = e === active ? 1 : 0;
        let w = this.eyeWeights[e] + (target - this.eyeWeights[e]) * k;
        if (Math.abs(target - w) < 1e-4) w = target;
        if (w !== this.eyeWeights[e]) moved = true;
        this.eyeWeights[e] = w;
      }
      if (moved) this.applyEyes();
    }
    const u = this.uniforms.uRimStrength;
    u.value += (this.rimTarget - u.value) * (1 - Math.exp(-dt * 12));
    if (Math.abs(u.value - this.rimTarget) < 1e-3) u.value = this.rimTarget;
  }

  /** Show the carried item only once the active clip lets the hand hold it (plan.ts CARRY_REVEAL_AT). */
  private revealCarry(): void {
    if (!this.carryObj) return;
    let active: Fade | null = null;
    for (const f of this.fades) if (f.target === 1) active = f;
    // only an item that ARRIVES with the clip (set in the frame the clip started, or later) waits for the hand; an
    // item already carried into it (Throw Away: the sim keeps the carry, runner.ts) stays in the hand throughout
    const arrived = active !== null && this.carryFrame >= active.start;
    this.carryObj.visible = active && arrived ? carryShown(active.clip, active.action.time) : true;
  }

  headTop(out: THREE.Vector3): THREE.Vector3 {
    if (!this.head) {
      this.object.updateWorldMatrix(true, false);
      return out.copy(this.tpl.headTopRest).multiplyScalar(this.scale).applyMatrix4(this.object.matrixWorld);
    }
    this.head.updateWorldMatrix(true, false);
    return out.copy(this.headOffset).applyMatrix4(this.head.matrixWorld);
  }

  stats(): RigStats {
    const { drawCalls, triangles } = countDrawCalls(this.object);
    const visibleNodes: string[] = ['Body'];
    for (const v of this.limbVis.values()) {
      if (v.cap) visibleNodes.push(v.cap.name);
      if (v.pegPivot) visibleNodes.push(v.pegPivot.name);
    }
    return { drawCalls, triangles, visibleNodes, clip: this.plan.clip + (this.plan.mirror ? ' (mirrored)' : '') };
  }

  /** Blend weight of an expression's body carriage (tests / debugging). */
  postureWeight(expr: Expression): number {
    return this.posture.weight(expr);
  }

  activeClips(): { clip: string; weight: number; effective: number }[] {
    return this.fades.map((f) => ({ clip: f.clip, weight: f.weight, effective: f.action.getEffectiveWeight() }));
  }

  getMaterials(): readonly THREE.Material[] {
    return this.materials;
  }

  /** Eye materials driven by eyeColor + expression (empty when the body exposes none). */
  getEyeMaterials(): readonly THREE.MeshStandardMaterial[] {
    return this.eyeMats;
  }

  bone(name: string): THREE.Object3D | null {
    return this.bones.get(name) ?? null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.inner);
    } catch {
      /* ignore */
    }
    this.detachCarry();
    for (const v of this.limbVis.values()) {
      v.cap?.removeFromParent();
      v.pegPivot?.removeFromParent();
    }
    this.limbVis.clear();
    disposeMaterials(this.materials);
    this.materials.length = 0;
    for (const sk of this.skeletons) sk.dispose();
    this.skeletons.length = 0;
    this.fades.length = 0;
    this.actions.clear();
    this.object.removeFromParent();
    this.inner.removeFromParent();
    this.lib.release(this.tpl);
  }
}
