/**
 * GLB-backed zombie rig: one SkeletonUtils clone of the shared template per zombie, per-rig cloned materials,
 * an interruption-safe 0.25 s crossfader over AnimationMixer actions, morph-driven face, carry hold layer.
 * Inputs are assumed sanitised by the handle (index.ts) but every method stays defensive.
 */
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AnyAnimState, CarryItem, Expression, LimbState, ZombieAppearance } from '../../shared/appearance';
import { DIM } from '../../shared/dimensions';
import { resolveCarry } from './anchors';
import type { CarryAnchor, CarryPlacement } from './anchors';
import type { CarryLibrary } from './carry';
import { mirrorClip } from './clips';
import { clamp01, parseHex, skinColor } from './colors';
import { FaceController } from './face';
import { createRigUniforms, disposeMaterials, patchMaterial } from './materials';
import type { RigUniforms } from './materials';
import { PostureLayer, postureGain } from './posture';
import { ARM_CHAIN, BONE_NAMES, BUILD_MORPH, FACE_MORPHS, STITCH_HIDE_MORPHS } from './names';
import type { FaceMorph } from './names';
import {
  LOCOMOTION_ANIMS, ONE_SHOT_ANIMS, appearanceSeed, buildInfluence, carryHand, carryShown, floorContactLift, heightScale,
  resolveAnim, seatContactHeight, visibilityPlan,
} from './plan';
import type { AnimPlan } from './plan';

export type HighlightMode = 'none' | 'hover' | 'selected';

export interface RigStats {
  drawCalls: number;
  triangles: number;
  visibleNodes: string[];
  clip: string;
}

/** What every rig implementation (GLB or capsule fallback) provides to the handle. */
export interface RigImpl {
  readonly object: THREE.Object3D;
  readonly kind: 'gltf' | 'fallback' | 'cast';
  setAppearance(app: ZombieAppearance): void;
  setLimbs(limbs: LimbState): void;
  setDecay(level: number): void;
  setAnim(state: AnyAnimState): void;
  setExpression(expr: Expression): void;
  setTalking(on: boolean): void;
  setCarry(item: CarryItem | null): void;
  setHighlight(mode: HighlightMode): void;
  setMoveSpeed(scale: number): void;
  update(dtSec: number): void;
  headTop(out: THREE.Vector3): THREE.Vector3;
  stats(): RigStats;
  dispose(): void;
}

export interface RigTemplate {
  scene: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
  mirrored: Map<string, THREE.AnimationClip>;
  carryPose: Map<string, THREE.Quaternion>;
  /** Per-clip carry placements (GLB Rig extras carryAnchors). */
  anchors: Map<string, CarryAnchor>;
  lidClosure: Partial<Record<FaceMorph, number>>;
  carry: CarryLibrary;
}

export const CROSSFADE_SEC = 0.25;
const HIGHLIGHT = {
  none: { color: '#e8e0c8', strength: 0 },
  hover: { color: '#e8e0c8', strength: 0.25 },
  selected: { color: '#9fe870', strength: 0.55 },
} as const;
/** Head-top anchor at rest (glTF space): top of the skull 1.62 m + clearance for hair / bubbles. */
const HEAD_TOP_REST = new THREE.Vector3(0, DIM.HEAD_TOP, 0.012);

interface Fade {
  action: THREE.AnimationAction;
  clip: AnyAnimState;
  weight: number;
  target: number;
  /** Rig frame (update count) in which this clip started (pickup reveal: did the carried item arrive with it?). */
  start: number;
}

interface FaceBinding {
  mesh: THREE.Mesh;
  /** Morph index per FACE_MORPHS entry (-1 = absent). */
  face: Int16Array;
}

interface BuildBinding {
  mesh: THREE.Mesh;
  index: number;
}

/** Scale of a missing leg's shin bone (collapsed onto the knee; not exactly 0 so skinning stays finite). */
const COLLAPSED_LEG_SCALE = 1e-3;
/** Meshes too small to cast a visible shadow (each shadow-casting mesh costs a shadow-pass draw call). */
const NO_SHADOW = /^(Eyes_|Stitches$|Acc_(glasses|necklace|bowtie|flower|eyepatch|bandage)$)/;

/**
 * Every part of one rig is skinned to the same Rig skin: bind them all to ONE Skeleton so three.js updates and
 * uploads a single bone texture per rig per frame instead of one per visible part. Parts whose binding differs
 * (never the case for the exported asset) keep their own skeleton. Returns every distinct skeleton in use.
 */
export function shareSkeletons(root: THREE.Object3D): THREE.Skeleton[] {
  let shared: THREE.SkinnedMesh | null = null;
  const used = new Set<THREE.Skeleton>();
  const sameBinding = (a: THREE.SkinnedMesh, b: THREE.SkinnedMesh): boolean => {
    const sa = a.skeleton;
    const sb = b.skeleton;
    if (sa.bones.length !== sb.bones.length || !a.bindMatrix.equals(b.bindMatrix)) return false;
    for (let i = 0; i < sa.bones.length; i++) {
      if (sa.bones[i] !== sb.bones[i]) return false;
      const ea = sa.boneInverses[i].elements;
      const eb = sb.boneInverses[i].elements;
      for (let k = 0; k < 16; k++) if (Math.abs(ea[k] - eb[k]) > 1e-5) return false;
    }
    return true;
  };
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.skeleton) return;
    if (!shared) {
      shared = m;
    } else if (m.skeleton !== shared.skeleton && sameBinding(m, shared)) {
      m.skeleton.dispose();
      m.bind(shared.skeleton, m.bindMatrix);
    }
    used.add(m.skeleton);
  });
  return [...used];
}

export function countDrawCalls(root: THREE.Object3D): { drawCalls: number; triangles: number } {
  let drawCalls = 0;
  let triangles = 0;
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    drawCalls++;
    const g = m.geometry;
    const n = g.index ? g.index.count : (g.attributes.position?.count ?? 0);
    triangles += Math.floor(n / 3);
  });
  return { drawCalls, triangles };
}

export class GltfRig implements RigImpl {
  readonly kind = 'gltf' as const;
  readonly object = new THREE.Group();
  private readonly inner: THREE.Object3D;
  private readonly tpl: RigTemplate;
  private readonly mixer: THREE.AnimationMixer;
  private readonly nodes = new Map<string, THREE.Object3D>();
  private readonly materials: THREE.Material[] = [];
  private readonly matsByName = new Map<string, THREE.MeshStandardMaterial[]>();
  private readonly uniforms: RigUniforms = createRigUniforms();
  private readonly faceMorphs: FaceBinding[] = [];
  private readonly buildMorphs: BuildBinding[] = [];
  private readonly skeletons: THREE.Skeleton[];
  private readonly bones = new Map<string, THREE.Object3D>();
  private stitchMesh: { mesh: THREE.Mesh; idx: Record<string, number> } | null = null;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly fades: Fade[] = [];
  private readonly face: FaceController;
  private faceSeed: number;
  /** Expression-driven carriage (happy = bouncy shoulders, sad = slump...) over every clip. */
  private readonly posture: PostureLayer;
  private readonly pelvis: THREE.Object3D | null;
  private readonly head: THREE.Object3D | null;
  private readonly chains: Record<'L' | 'R', (THREE.Object3D | null)[]>;
  private readonly carryQuats: Record<'L' | 'R', (THREE.Quaternion | null)[]>;
  private readonly headOffset = new THREE.Vector3();
  /** Animation-only arm rotations saved before the hold layer edits them (restored before mixer.update). */
  private readonly saved: THREE.Quaternion[] = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
  private heldSide: 'L' | 'R' | null = null;
  private hand: 'L' | 'R' | null = 'R';
  private app: ZombieAppearance;
  private limbs: LimbState;
  private decay = 0;
  private requested: AnyAnimState = 'idle';
  private plan: AnimPlan = { clip: 'idle', mirror: false, timeScale: 1 };
  private speed = 1;
  private scale = 1;
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

  constructor(tpl: RigTemplate, app: ZombieAppearance, limbs: LimbState) {
    this.tpl = tpl;
    this.app = app;
    this.limbs = limbs;
    this.hand = carryHand(limbs);
    this.inner = SkeletonUtils.clone(tpl.scene);
    this.inner.name = 'ZombieModel';
    this.object.name = 'ZombieGltf';
    this.object.add(this.inner);
    this.skeletons = shareSkeletons(this.inner);
    const rigNode = this.inner.getObjectByName('Rig') ?? this.inner;
    for (const child of rigNode.children) {
      if ((child as THREE.Bone).isBone) continue;
      this.nodes.set(child.name, child);
    }
    this.cloneMaterials();
    this.bindMorphs();
    for (const b of BONE_NAMES) {
      const o = this.inner.getObjectByName(b);
      if (o) this.bones.set(b, o);
    }
    const find = (n: string) => this.bones.get(n) ?? null;
    this.pelvis = find('pelvis');
    this.head = find('head');
    this.chains = { L: ARM_CHAIN.L.map(find), R: ARM_CHAIN.R.map(find) };
    this.carryQuats = {
      L: ARM_CHAIN.L.map((b) => tpl.carryPose.get(b) ?? null),
      R: ARM_CHAIN.R.map((b) => tpl.carryPose.get(b) ?? null),
    };
    this.mixer = new THREE.AnimationMixer(this.inner);
    this.faceSeed = appearanceSeed(app);
    this.face = new FaceController(this.faceSeed, tpl.lidClosure);
    this.posture = new PostureLayer((n) => this.bones.get(n) ?? null); // measured on the rest pose
    // head-top offset in head-bone space from the rest pose
    this.inner.updateMatrixWorld(true);
    if (this.head) {
      const inv = new THREE.Matrix4().copy(this.head.matrixWorld).invert();
      this.headOffset.copy(HEAD_TOP_REST).applyMatrix4(inv);
    }
    this.setAppearance(app);
  }

  // ───────────────────────────── setup helpers
  private cloneMaterials(): void {
    const cache = new Map<THREE.Material, THREE.Material>();
    for (const [name, node] of this.nodes) {
      const cast = !NO_SHADOW.test(name);
      node.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = cast;
      });
    }
    this.inner.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      const src = mesh.material as THREE.Material;
      let m = cache.get(src);
      if (!m) {
        m = src.clone();
        m.name = src.name;
        patchMaterial(m, this.uniforms, src.name === 'Skin');
        cache.set(src, m);
        this.materials.push(m);
        const list = this.matsByName.get(src.name) ?? [];
        list.push(m as THREE.MeshStandardMaterial);
        this.matsByName.set(src.name, list);
      }
      mesh.material = m;
    });
  }

  private bindMorphs(): void {
    this.inner.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
      const dict = mesh.morphTargetDictionary;
      const face = new Int16Array(FACE_MORPHS.length);
      let any = false;
      FACE_MORPHS.forEach((n, i) => {
        const idx = dict[n];
        face[i] = idx === undefined ? -1 : idx;
        if (idx !== undefined) any = true;
      });
      const build = dict[BUILD_MORPH] ?? -1;
      if (any) this.faceMorphs.push({ mesh, face });
      if (build >= 0) this.buildMorphs.push({ mesh, index: build });
      if (dict[STITCH_HIDE_MORPHS.armL] !== undefined) {
        const idx: Record<string, number> = {};
        for (const k of Object.values(STITCH_HIDE_MORPHS)) idx[k] = dict[k] ?? -1;
        this.stitchMesh = { mesh, idx };
      }
    });
  }

  private setMat(name: string, hex: string): void {
    const list = this.matsByName.get(name);
    if (!list) return;
    const c = parseHex(hex);
    for (const m of list) m.color.setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace);
  }

  private applySkin(): void {
    const c = skinColor(this.app.skinTone, this.decay);
    const list = this.matsByName.get('Skin');
    if (list) for (const m of list) m.color.setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace);
    this.uniforms.uDecay.value = clamp01(this.decay);
  }

  private applyVisibility(): void {
    const plan = visibilityPlan(this.app, this.limbs);
    for (const [name, node] of this.nodes) node.visible = plan.visible.has(name);
    // W-120: a missing leg's meshes are hidden, but its shin / foot bones kept animating - the crawl drags them
    // under the floor, taking the (morph-collapsed, zero-area) shin stitch seams along. Collapse the lost shin onto
    // the knee like the cast rig does; prosthetic legs keep it (the peg is skinned to it), the thigh stump is unaffected.
    for (const s of ['L', 'R'] as const) {
      const shin = this.bones.get(`shin_${s}`);
      if (shin) shin.scale.setScalar(this.limbs[s === 'L' ? 'legL' : 'legR'] === 'missing' ? COLLAPSED_LEG_SCALE : 1);
    }
    if (this.stitchMesh) {
      const infl = this.stitchMesh.mesh.morphTargetInfluences;
      if (infl) {
        for (const [k, v] of Object.entries(plan.stitchMorphs)) {
          const i = this.stitchMesh.idx[k];
          if (i !== undefined && i >= 0) infl[i] = v;
        }
      }
    }
  }

  // ───────────────────────────── ZombieRig surface
  setAppearance(app: ZombieAppearance): void {
    this.app = app;
    // a rig upgraded from the capsule fallback is constructed with the default look: re-seed per zombie so a
    // household loaded together does not blink (or start its loops) in lockstep
    const seed = appearanceSeed(app);
    if (seed !== this.faceSeed) {
      this.faceSeed = seed;
      this.face.reseed(seed);
    }
    this.applyVisibility();
    this.applySkin();
    this.setMat('Hair', app.hairColor);
    this.setMat('Top', app.topColor);
    this.setMat('Bottom', app.bottomColor);
    this.setMat('Shoes', app.shoeColor);
    this.setMat('Iris', app.eyeColor);
    const b = buildInfluence(app.build);
    for (const mb of this.buildMorphs) {
      if (mb.mesh.morphTargetInfluences) mb.mesh.morphTargetInfluences[mb.index] = b;
    }
    this.scale = heightScale(app.height);
    this.inner.scale.setScalar(this.scale);
  }

  setLimbs(limbs: LimbState): void {
    this.restoreHold();
    this.limbs = limbs;
    this.hand = carryHand(limbs);
    this.applyVisibility();
    this.play(resolveAnim(this.requested, limbs, this.hasClip), false);
    this.placement = null; // limbs may move the item to the other hand even when the clip stays
    this.attachCarry();
  }

  setDecay(level: number): void {
    this.decay = clamp01(level);
    this.applySkin();
  }

  /** Clips of the loaded zombie.glb (extras play only when present; W-056). */
  private readonly hasClip = (name: string): boolean => this.tpl.clips.has(name);

  setAnim(state: AnyAnimState): void {
    this.requested = state;
    this.play(resolveAnim(state, this.limbs, this.hasClip), false);
  }

  private clipFor(plan: AnimPlan): THREE.AnimationClip | null {
    const base = this.tpl.clips.get(plan.clip) ?? this.tpl.clips.get('idle') ?? null;
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
    if (!same) this.attachCarry(); // anchored items follow the clip (plate on the palm, book in both hands...)
    const clip = this.clipFor(plan);
    if (!clip) return;
    const key = clip.name;
    let action = this.actions.get(key);
    if (!action) {
      action = this.mixer.clipAction(clip);
      this.actions.set(key, action);
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
      }
      const first = this.fades.length === 0;
      if (!ONE_SHOT_ANIMS.has(plan.clip)) action.time = this.loopPhase(plan.clip) * clip.duration;
      action.setEffectiveWeight(first ? 1 : 0);
      action.play();
      fade = { action, clip: plan.clip, weight: first ? 1 : 0, target: 1, start: this.frame };
      this.fades.push(fade);
    }
    for (const f of this.fades) f.target = f === fade ? 1 : 0;
  }

  /**
   * Deterministic per-zombie start phase (0..1) of a looping clip: zombies that start the same loop together
   * (a household idling after load, two sitters at one table) do not move in lockstep. One-shots start at 0.
   */
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

  private detachCarry(): void {
    this.carryObj?.removeFromParent();
    this.extraObj?.removeFromParent();
    this.carryObj = null;
    this.extraObj = null;
  }

  /** (Re)place the carried item for the current item / clip / limbs; no-op when the placement is unchanged. */
  private attachCarry(): void {
    if (this.disposed) return;
    const next = resolveCarry(this.carryItem, this.plan, this.limbs, this.tpl.anchors);
    if (this.placement && this.placement.key === next.key) {
      this.placement = next; // same attachment; the hold flag may still change with the clip
      return;
    }
    this.restoreHold();
    this.detachCarry();
    this.placement = next;
    if (next.kind === 'none' || !this.carryItem || this.tpl.carry.isDisposed) return;
    const parent = next.kind === 'extra' ? null : this.bones.get(next.bone);
    if (parent) {
      const obj = this.tpl.carry.create(this.carryItem, next.variant);
      if (next.matrix) next.matrix.decompose(obj.position, obj.quaternion, obj.scale);
      parent.add(obj);
      this.carryObj = obj;
    }
    if (next.extra) {
      const ep = this.bones.get(next.extra.bone);
      if (ep) {
        const ex = this.tpl.carry.createExtra(next.extra.item);
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

  /** 0 freezes the locomotion cycle (the renderer passes 0 while a walker is not actually moving). */
  setMoveSpeed(scale: number): void {
    const s = Number.isFinite(scale) && scale >= 0 ? scale : 1;
    if (s === this.speed) return;
    this.speed = s;
    for (const f of this.fades) {
      if (LOCOMOTION_ANIMS.has(f.clip)) f.action.timeScale = this.speed * (f.clip === this.plan.clip ? this.plan.timeScale : 1);
    }
  }

  update(dtIn: number): void {
    if (this.disposed) return;
    const dt = Number.isFinite(dtIn) && dtIn > 0 ? Math.min(dtIn, 0.25) : 0;
    // crossfade weights (interruption-safe: always ramps from the current weight)
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
    // normalise so interrupted fades never leak the bind pose (PropertyMixer fills weight < 1 with it)
    const norm = total > 1e-6 ? 1 / total : 0;
    let seatLift = 0;
    let floorLift = 0;
    let postureW = 0;
    for (const f of this.fades) {
      const w = f.weight * norm;
      f.action.setEffectiveWeight(w);
      seatLift += w * seatContactHeight(f.clip);
      floorLift += w * floorContactLift('classic', f.clip);
      postureW += w * postureGain(f.clip);
    }
    // three's PropertyMixer only writes values that changed, so post-mixer edits must never be left in the
    // scene graph across frames: undo last frame's hold + posture layers before the mixer runs.
    this.restoreHold();
    this.posture.restore();
    this.mixer.update(dt);
    // keep the seat contact (SEAT_HEIGHT, or a saddle's height) where it is whatever the zombie's height scale
    // (offset the scaled model, absolute; blended by clip weight)
    // + the floor-contact lift of floor clips (W-120: the crawl's planted palms), model units
    this.inner.position.y = (seatLift > 0 ? seatLift * (1 - this.scale) : 0) + floorLift * this.scale;
    this.revealCarry();
    this.frame++;
    // carry hold layer (palm placements only; anchored items are held by the clip itself)
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
    // mood carriage over the clip (chest / neck / head / shoulders; disjoint from the hold layer's arm bones)
    this.posture.apply(dt, postureW);
    // face (Head + the visible Eyes_* set)
    const w = this.face.update(dt);
    for (const mb of this.faceMorphs) {
      const infl = mb.mesh.morphTargetInfluences;
      if (!infl || !mb.mesh.visible || (mb.mesh.parent !== null && !mb.mesh.parent.visible)) continue;
      for (let i = 0; i < mb.face.length; i++) {
        const idx = mb.face[i];
        if (idx >= 0) infl[idx] = w[i];
      }
    }
    // highlight fade
    const u = this.uniforms.uRimStrength;
    u.value += (this.rimTarget - u.value) * (1 - Math.exp(-dt * 12));
    if (Math.abs(u.value - this.rimTarget) < 1e-3) u.value = this.rimTarget;
  }

  private restoreHold(): void {
    if (!this.heldSide) return;
    const bones = this.chains[this.heldSide];
    for (let i = 0; i < bones.length; i++) bones[i]?.quaternion.copy(this.saved[i]);
    this.heldSide = null;
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
      return out.set(0, DIM.HEAD_TOP * this.scale, 0).applyMatrix4(this.object.matrixWorld);
    }
    this.head.updateWorldMatrix(true, false);
    return out.copy(this.headOffset).applyMatrix4(this.head.matrixWorld);
  }

  stats(): RigStats {
    const { drawCalls, triangles } = countDrawCalls(this.object);
    const visibleNodes: string[] = [];
    for (const [n, node] of this.nodes) if (node.visible) visibleNodes.push(n);
    return { drawCalls, triangles, visibleNodes, clip: this.plan.clip + (this.plan.mirror ? ' (mirrored)' : '') };
  }

  /** Current morph weight of a face morph (tests / debugging). */
  faceWeight(name: FaceMorph): number {
    const i = FACE_MORPHS.indexOf(name);
    return i < 0 ? 0 : this.face.weights[i];
  }

  /** Blend weight of an expression's body carriage (tests / debugging). */
  postureWeight(expr: Expression): number {
    return this.posture.weight(expr);
  }

  /** Effective weights of active clips (tests / debugging). */
  activeClips(): { clip: string; weight: number; effective: number }[] {
    return this.fades.map((f) => ({ clip: f.clip, weight: f.weight, effective: f.action.getEffectiveWeight() }));
  }

  getMaterials(): readonly THREE.Material[] {
    return this.materials;
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
    disposeMaterials(this.materials);
    this.materials.length = 0;
    // bone textures are GPU resources owned by the (per-rig) skeletons
    for (const sk of this.skeletons) sk.dispose();
    this.skeletons.length = 0;
    this.fades.length = 0;
    this.actions.clear();
    this.object.removeFromParent();
    this.inner.removeFromParent();
  }
}
