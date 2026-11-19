/**
 * Procedural capsule zombie used while the GLB loads or when it fails. Implements the full RigImpl surface
 * with simple pivot-based procedural motion so the scene never has a hole and every call stays safe.
 */
import * as THREE from 'three';
import type { AnyAnimState, CarryItem, Expression, LimbState, ZombieAppearance } from '../../shared/appearance';
import { DIM } from '../../shared/dimensions';
import type { CarryLibrary } from './carry';
import { clamp01, parseHex, skinColor } from './colors';
import { FaceController } from './face';
import { appearanceSeed, carryHand, heightScale, resolveAnim, SEATED_ANIMS } from './plan';
import type { AnimPlan } from './plan';
import { countDrawCalls } from './rig';
import type { HighlightMode, RigImpl, RigStats } from './rig';

const LYING: ReadonlySet<AnyAnimState> = new Set<AnyAnimState>(['sleep', 'beEmbalmed']);
const SIDES = ['L', 'R'] as const;

export class CapsuleRig implements RigImpl {
  readonly kind = 'fallback' as const;
  readonly object = new THREE.Group();
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.MeshStandardMaterial[] = [];
  private readonly body = new THREE.Group();
  private readonly pelvis = new THREE.Group();
  private readonly headPivot = new THREE.Group();
  private readonly arms: Record<'L' | 'R', THREE.Group> = { L: new THREE.Group(), R: new THREE.Group() };
  private readonly forearms: Record<'L' | 'R', THREE.Group> = { L: new THREE.Group(), R: new THREE.Group() };
  private readonly legs: Record<'L' | 'R', THREE.Group> = { L: new THREE.Group(), R: new THREE.Group() };
  private readonly hands: Record<'L' | 'R', THREE.Group> = { L: new THREE.Group(), R: new THREE.Group() };
  private readonly mouth: THREE.Mesh;
  private readonly eyes: THREE.Mesh[] = [];
  private readonly skinMat: THREE.MeshStandardMaterial;
  private readonly topMat: THREE.MeshStandardMaterial;
  private readonly bottomMat: THREE.MeshStandardMaterial;
  private readonly shoeMat: THREE.MeshStandardMaterial;
  private readonly hairMat: THREE.MeshStandardMaterial;
  private readonly woodMat: THREE.MeshStandardMaterial;
  private readonly hair: THREE.Mesh;
  private readonly face: FaceController;
  private readonly carryLib: CarryLibrary | null;
  private app: ZombieAppearance;
  private limbs: LimbState;
  private decay = 0;
  private plan: AnimPlan = { clip: 'idle', mirror: false, timeScale: 1 };
  private requested: AnyAnimState = 'idle';
  private speed = 1;
  private time = 0;
  private stateTime = 0;
  private scale = 1;
  private rim = 0;
  private rimTarget = 0;
  private readonly rimColor = new THREE.Color('#e8e0c8');
  private carryItem: CarryItem | null = null;
  private carryObj: THREE.Object3D | null = null;
  private disposed = false;

  constructor(app: ZombieAppearance, limbs: LimbState, carry: CarryLibrary | null) {
    this.app = app;
    this.limbs = limbs;
    this.carryLib = carry;
    this.object.name = 'ZombieFallback';
    this.skinMat = this.mat('#9fb88a');
    this.topMat = this.mat('#6b4f8a');
    this.bottomMat = this.mat('#3a3f55');
    this.shoeMat = this.mat('#2a2420');
    this.hairMat = this.mat('#3b2f2f');
    this.woodMat = this.mat('#8a5a36');
    const dark = this.mat('#3b1f27');
    const white = this.mat('#e6e1c6');

    this.object.add(this.body);
    this.body.add(this.pelvis);
    this.pelvis.position.set(0, 0.66, 0);
    const torso = this.mesh(new THREE.CapsuleGeometry(0.15, 0.3, 4, 10), this.topMat);
    torso.position.y = 0.27;
    torso.scale.set(1.1, 1, 0.75);
    const hips = this.mesh(new THREE.CapsuleGeometry(0.14, 0.06, 4, 10), this.bottomMat);
    hips.position.y = 0.04;
    hips.scale.set(1.15, 1, 0.8);
    this.pelvis.add(torso, hips);
    this.headPivot.position.set(0, 0.6, 0.02);
    this.pelvis.add(this.headPivot);
    const head = this.mesh(new THREE.SphereGeometry(0.17, 16, 12), this.skinMat);
    head.position.y = 0.17;
    head.scale.set(1, 1.05, 0.96);
    this.hair = this.mesh(new THREE.SphereGeometry(0.175, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), this.hairMat);
    this.hair.position.y = 0.18;
    this.headPivot.add(head, this.hair);
    for (const sx of [1, -1]) {
      const e = this.mesh(new THREE.SphereGeometry(0.036, 10, 8), white);
      e.position.set(0.065 * sx, 0.16, 0.14);
      e.scale.z = 0.6;
      const iris = this.mesh(new THREE.SphereGeometry(0.018, 8, 6), dark);
      iris.position.set(0, 0, 0.03);
      e.add(iris);
      this.eyes.push(e);
      this.headPivot.add(e);
    }
    this.mouth = this.mesh(new THREE.BoxGeometry(0.11, 0.012, 0.02), dark);
    this.mouth.position.set(0, 0.07, 0.155);
    this.headPivot.add(this.mouth);
    for (const s of SIDES) {
      const sx = s === 'L' ? 1 : -1;
      const arm = this.arms[s];
      arm.position.set(0.19 * sx, 0.5, 0);
      const upper = this.mesh(new THREE.CapsuleGeometry(0.045, 0.22, 4, 8), this.skinMat);
      upper.position.y = -0.14;
      const fore = this.forearms[s];
      fore.position.y = -0.29;
      const lower = this.mesh(new THREE.CapsuleGeometry(0.038, 0.2, 4, 8), this.skinMat);
      lower.position.y = -0.13;
      const hand = this.hands[s];
      hand.position.y = -0.3;
      const palm = this.mesh(new THREE.SphereGeometry(0.045, 8, 6), this.skinMat);
      hand.add(palm);
      fore.add(lower, hand);
      arm.add(upper, fore);
      this.pelvis.add(arm);
      const leg = this.legs[s];
      leg.position.set(0.09 * sx, 0.06, 0);
      const thigh = this.mesh(new THREE.CapsuleGeometry(0.065, 0.5, 4, 8), this.bottomMat);
      thigh.position.y = -0.33;
      const shoe = this.mesh(new THREE.BoxGeometry(0.1, 0.08, 0.2), this.shoeMat);
      shoe.position.set(0, -0.68, 0.04);
      leg.add(thigh, shoe);
      this.pelvis.add(leg);
    }
    this.face = new FaceController(appearanceSeed(app));
    this.setAppearance(app);
    this.setLimbs(limbs);
  }

  private mat(hex: string): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.75 });
    this.mats.push(m);
    return m;
  }

  private mesh(g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh {
    this.geos.push(g);
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true;
    return mesh;
  }

  private setRgb(m: THREE.MeshStandardMaterial, hex: string): void {
    const c = parseHex(hex);
    m.color.setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace);
  }

  setAppearance(app: ZombieAppearance): void {
    this.app = app;
    this.setRgb(this.topMat, app.topColor);
    this.setRgb(this.bottomMat, app.bottomColor);
    this.setRgb(this.shoeMat, app.shoeColor);
    this.setRgb(this.hairMat, app.hairColor);
    this.hair.visible = app.hairStyle !== 'bald';
    this.setDecay(this.decay);
    this.scale = heightScale(app.height);
    this.body.scale.setScalar(this.scale);
  }

  setLimbs(limbs: LimbState): void {
    this.limbs = limbs;
    for (const s of SIDES) {
      const arm = limbs[s === 'L' ? 'armL' : 'armR'];
      this.arms[s].visible = arm !== 'missing';
      const leg = limbs[s === 'L' ? 'legL' : 'legR'];
      this.legs[s].visible = leg !== 'missing';
    }
    this.plan = resolveAnim(this.requested, limbs);
    this.attachCarry();
  }

  setDecay(level: number): void {
    this.decay = clamp01(level);
    const c = skinColor(this.app.skinTone, this.decay);
    this.skinMat.color.setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace);
  }

  /** The capsule has no clips: extra states always play their core fallback (resolveAnim's default). */
  setAnim(state: AnyAnimState): void {
    const plan = resolveAnim(state, this.limbs);
    this.requested = state;
    if (plan.clip !== this.plan.clip) this.stateTime = 0;
    this.plan = plan;
    this.face.setAnimHint(plan.clip);
  }

  setExpression(expr: Expression): void {
    this.face.setExpression(expr);
  }

  setTalking(on: boolean): void {
    this.face.setTalking(on);
  }

  setCarry(item: CarryItem | null): void {
    this.carryItem = item;
    this.attachCarry();
  }

  private attachCarry(): void {
    if (this.carryObj) this.carryObj.removeFromParent();
    this.carryObj = null;
    if (!this.carryItem || !this.carryLib || this.carryLib.isDisposed) return;
    const hand = carryHand(this.limbs);
    if (!hand) return;
    this.carryObj = this.carryLib.create(this.carryItem);
    this.carryObj.rotation.x = -Math.PI / 2;
    this.hands[hand].add(this.carryObj);
  }

  setHighlight(mode: HighlightMode): void {
    this.rimTarget = mode === 'selected' ? 0.35 : mode === 'hover' ? 0.15 : 0;
    this.rimColor.set(mode === 'selected' ? '#9fe870' : '#e8e0c8');
  }

  setMoveSpeed(scale: number): void {
    this.speed = scale;
  }

  update(dtIn: number): void {
    if (this.disposed) return;
    const dt = Number.isFinite(dtIn) && dtIn > 0 ? Math.min(dtIn, 0.25) : 0;
    const clip = this.plan.clip;
    const loco = clip === 'walk' || clip === 'limp' || clip === 'crawl';
    this.time += dt * (loco ? this.speed : 1) * this.plan.timeScale;
    this.stateTime += dt;
    const t = this.time;
    const sw = Math.sin(t * Math.PI * 2);
    const p = this.pelvis;
    p.position.set(0, 0.66, 0);
    p.rotation.set(0, 0, 0);
    this.headPivot.rotation.set(-0.15, 0.1 * Math.sin(t * 0.8), 0.05 * Math.sin(t * 1.3));
    for (const s of SIDES) {
      this.arms[s].rotation.set(0, 0, s === 'L' ? 0.12 : -0.12);
      this.forearms[s].rotation.set(-0.3, 0, 0);
      this.legs[s].rotation.set(0, 0, 0);
    }
    if (clip === 'walk' || clip === 'limp') {
      p.position.y += 0.02 * Math.abs(sw);
      this.legs.L.rotation.x = 0.45 * sw;
      this.legs.R.rotation.x = -0.45 * sw;
      for (const s of SIDES) this.arms[s].rotation.x = -1.0 + 0.1 * sw;
      p.rotation.x = 0.2;
    } else if (clip === 'crawl') {
      p.position.set(0, 0.14, -0.25);
      p.rotation.x = 1.45;
      this.arms.L.rotation.x = -2.6 + 0.5 * sw;
      this.arms.R.rotation.x = -2.6 - 0.5 * sw;
    } else if (SEATED_ANIMS.has(clip) || clip === 'bath') {
      p.position.y = clip === 'bath' ? 0.08 : DIM.SEAT_HEIGHT / this.scale + 0.02;
      for (const s of SIDES) {
        this.legs[s].rotation.x = -1.5;
        this.arms[s].rotation.x = -0.5;
      }
    } else if (LYING.has(clip) || (clip === 'collapse' && this.stateTime > 1.2)) {
      p.position.set(0, 0.12, 0.15);
      p.rotation.x = -Math.PI / 2;
    } else if (clip === 'wave' || clip === 'cheer' || clip === 'stretch' || clip === 'yawn') {
      this.arms.R.rotation.z = -2.6 + (clip === 'wave' ? 0.3 * Math.sin(t * 8) : 0);
      if (clip !== 'wave') this.arms.L.rotation.z = 2.6;
      p.position.y += clip === 'cheer' ? 0.04 * Math.abs(sw) : 0;
    } else {
      p.position.y += 0.006 * Math.sin(t * 1.6);
      p.rotation.z = 0.02 * Math.sin(t * 0.7);
      if (clip === 'talk' || clip === 'sitTalk' || clip === 'phone') {
        this.arms.R.rotation.x = -0.7 + 0.2 * Math.sin(t * 3);
      }
    }
    const w = this.face.update(dt);
    const blink = w[0];
    for (const e of this.eyes) e.scale.y = Math.max(0.08, 1 - blink);
    this.mouth.scale.y = 1 + w[1] * 3.5;
    this.rim += (this.rimTarget - this.rim) * (1 - Math.exp(-dt * 12));
    for (const m of this.mats) {
      m.emissive.copy(this.rimColor);
      m.emissiveIntensity = this.rim;
    }
  }

  headTop(out: THREE.Vector3): THREE.Vector3 {
    this.headPivot.updateWorldMatrix(true, false);
    return out.set(0, 0.18 + (DIM.HEAD_TOP - DIM.CHARACTER_HEIGHT), 0).applyMatrix4(this.headPivot.matrixWorld);
  }

  stats(): RigStats {
    const { drawCalls, triangles } = countDrawCalls(this.object);
    return { drawCalls, triangles, visibleNodes: [], clip: this.plan.clip };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.carryObj) this.carryObj.removeFromParent();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.object.removeFromParent();
  }
}
