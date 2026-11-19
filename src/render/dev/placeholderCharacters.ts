/**
 * DEV-ONLY placeholder CharacterFactory: chibi-ish capsule zombies (big head, droopy eyes, long arms) built from
 * shared primitives, with procedural poses for every AnimState (walk/limp/crawl, all sits, sleep lying on the back
 * head toward -Z, dance, cook, ...), 0.25 s crossfades, mouth flaps, expressions, carry props, limb loss /
 * prosthetics, decay tint and hover/selection rim. Used when src/render/characters is not available.
 */
import * as THREE from 'three';
import type { CharacterFactory, ZombieRig } from '../contracts';
import { SKIN_TONES, intactLimbs, type ZombieAppearance, type LimbState, type AnimState, type AnyAnimState, type Expression, type CarryItem } from '../../shared/appearance';
import { effectiveAnim } from '../characters/plan';
import { DIM } from '../../shared/dimensions';

interface Pose {
  hipsY: number;
  hipsZ: number;
  /** World lift of the whole body (lying poses rest the back on y = 0). */
  lift: number;
  bodyRotX: number;
  torsoX: number;
  torsoZ: number;
  torsoY: number;
  headX: number;
  headZ: number;
  aL: [number, number, number];
  aR: [number, number, number];
  lL: [number, number];
  lR: [number, number];
}

function zeroPose(): Pose {
  return { hipsY: 0.8, hipsZ: 0, lift: 0, bodyRotX: 0, torsoX: 0, torsoZ: 0, torsoY: 0, headX: 0, headZ: 0, aL: [0, 0, 0], aR: [0, 0, 0], lL: [0, 0], lR: [0, 0] };
}

function lerpPose(a: Pose, b: Pose, t: number, out: Pose): Pose {
  const l = (x: number, y: number) => x + (y - x) * t;
  out.hipsY = l(a.hipsY, b.hipsY);
  out.hipsZ = l(a.hipsZ, b.hipsZ);
  out.lift = l(a.lift, b.lift);
  out.bodyRotX = l(a.bodyRotX, b.bodyRotX);
  out.torsoX = l(a.torsoX, b.torsoX);
  out.torsoZ = l(a.torsoZ, b.torsoZ);
  out.torsoY = l(a.torsoY, b.torsoY);
  out.headX = l(a.headX, b.headX);
  out.headZ = l(a.headZ, b.headZ);
  for (let i = 0; i < 3; i++) {
    out.aL[i] = l(a.aL[i], b.aL[i]);
    out.aR[i] = l(a.aR[i], b.aR[i]);
  }
  for (let i = 0; i < 2; i++) {
    out.lL[i] = l(a.lL[i], b.lL[i]);
    out.lR[i] = l(a.lR[i], b.lR[i]);
  }
  return out;
}

const LEG = 0.8;
const SIT = DIM.SEAT_HEIGHT;

/** Procedural target pose for an anim at time τ (s). Shoulder: [pitch (− = forward/up), roll (− = out), elbow]. */
export function poseFor(anim: AnimState | string, tau: number, walkPhase: number, p: Pose): Pose {
  const s = Math.sin;
  Object.assign(p, zeroPose());
  p.aL = [-0.12, -0.08, -0.15];
  p.aR = [-0.12, 0.08, -0.15];
  p.torsoZ = 0.03 * s(tau * 1.1);
  p.headZ = 0.06 * s(tau * 0.7);
  const w = walkPhase;
  switch (anim) {
    case 'walk':
    case 'limp': {
      const lim = anim === 'limp';
      p.lL = [0.5 * s(w), Math.max(0, -s(w)) * 0.8];
      p.lR = [-0.5 * s(w) * (lim ? 0.35 : 1), lim ? 0.05 : Math.max(0, s(w)) * 0.8];
      p.hipsY = LEG + 0.025 * Math.abs(s(w)) - (lim ? 0.04 * Math.max(0, s(w)) : 0);
      p.torsoX = 0.14;
      p.aL = [-1.15 + 0.12 * s(w), -0.1, -0.2];
      p.aR = [-1.05 - 0.12 * s(w), 0.1, -0.25];
      p.headX = 0.08;
      break;
    }
    case 'crawl':
      p.hipsY = 0.32;
      p.bodyRotX = 1.25;
      p.lL = [-0.6 + 0.3 * s(w), 1.2];
      p.lR = [-0.6 - 0.3 * s(w), 1.2];
      p.aL = [-2.3 + 0.4 * s(w), -0.1, -0.3];
      p.aR = [-2.3 - 0.4 * s(w), 0.1, -0.3];
      p.headX = -0.9;
      break;
    case 'sit':
    case 'sitEat':
    case 'sitTalk':
    case 'sitTV':
    case 'sitComputer':
    case 'sitRead':
    case 'sitChess':
      p.hipsY = SIT + 0.06;
      p.hipsZ = 0.02;
      p.lL = [-1.5, 1.5];
      p.lR = [-1.5, 1.5];
      p.aL = [-0.5, -0.1, -1.0];
      p.aR = [-0.5, 0.1, -1.0];
      if (anim === 'sitTV') {
        p.torsoX = -0.22;
        p.aL = [-0.2, -0.25, -0.6];
        p.aR = [-0.2, 0.25, -0.6];
      }
      if (anim === 'sitEat') p.aR = [-1.4 + 0.35 * Math.max(0, s(tau * 2.2)), 0.25, -2.0];
      if (anim === 'sitTalk') p.aR = [-0.9 + 0.3 * s(tau * 3.1), 0.3 + 0.2 * s(tau * 2.3), -1.2];
      if (anim === 'sitComputer') {
        p.aL = [-1.05, -0.05, -0.5 + 0.05 * s(tau * 14)];
        p.aR = [-1.05, 0.05, -0.5 + 0.05 * s(tau * 13 + 1)];
        p.torsoX = 0.1;
      }
      if (anim === 'sitRead' || anim === 'sitChess') {
        p.aL = [-1.1, -0.25, -1.1];
        p.aR = [-1.1, 0.25, -1.1];
        p.headX = 0.35;
      }
      break;
    case 'sleep':
    case 'beEmbalmed':
    case 'collapse':
      // lying on the back, head toward local -Z, body centred on the origin
      p.hipsY = 0;
      p.hipsZ = 0.1;
      p.lift = 0.14;
      p.bodyRotX = -Math.PI / 2;
      p.aL = [0, -0.12, -0.1];
      p.aR = [0, 0.12, -0.1];
      p.headX = -0.05;
      p.torsoZ = 0;
      p.headZ = anim === 'sleep' ? 0.18 : 0.05;
      break;
    case 'bath':
      p.hipsY = 0.18;
      p.lL = [-1.45, 0.25];
      p.lR = [-1.45, 0.25];
      p.torsoX = -0.25;
      p.aL = [-0.3, -0.5, -0.4];
      p.aR = [-0.3, 0.5, -0.4];
      break;
    case 'dance':
    case 'cheer': {
      const b = Math.abs(s(tau * 6));
      p.hipsY = LEG - 0.05 * b;
      p.lL = [0.2 * s(tau * 6), 0.3 * b];
      p.lR = [-0.2 * s(tau * 6), 0.3 * b];
      p.torsoY = 0.35 * s(tau * 3);
      p.aL = [-2.6 + 0.4 * s(tau * 6), -0.4, -0.5];
      p.aR = [-2.6 - 0.4 * s(tau * 6), 0.4, -0.5];
      p.headZ = 0.15 * s(tau * 3);
      break;
    }
    case 'wave':
      p.aR = [-2.7, 0.35 + 0.35 * s(tau * 7), -0.6];
      break;
    case 'talk':
    case 'flirt':
      p.aR = [-0.9 + 0.35 * s(tau * 3.3), 0.3 + 0.25 * s(tau * 2.1), -1.0];
      p.aL = [-0.5 + 0.2 * s(tau * 2.7 + 1), -0.25, -0.9];
      if (anim === 'flirt') {
        p.headZ = 0.25;
        p.torsoZ = 0.12;
      }
      break;
    case 'listen':
      p.headZ = 0.2;
      break;
    case 'laugh':
      p.torsoX = -0.15 + 0.08 * s(tau * 14);
      p.headX = -0.35;
      p.aL = [-0.4, -0.4, -1.2];
      p.aR = [-0.4, 0.4, -1.2];
      break;
    case 'cry':
    case 'mourn':
      p.headX = 0.55;
      p.torsoX = 0.25;
      p.aL = [-1.9, 0.2, -2.0];
      p.aR = [-1.9, -0.2, -2.0];
      if (anim === 'mourn') {
        p.hipsY = 0.5;
        p.lL = [-1.6, 2.2];
        p.lR = [-0.2, 1.6];
      }
      break;
    case 'angry':
      p.aL = [-0.25, -0.35, -1.4];
      p.aR = [-0.25, 0.35, -1.4];
      p.hipsY = LEG - 0.03 * Math.abs(s(tau * 7));
      p.lL = [0.3 * Math.max(0, s(tau * 7)), 0.2];
      p.torsoX = 0.15;
      break;
    case 'kiss':
    case 'hug':
      p.torsoX = 0.25;
      p.aL = [-1.4, -0.6, -0.6];
      p.aR = [-1.4, 0.6, -0.6];
      break;
    case 'cook':
    case 'clean':
    case 'washHands':
    case 'stitch':
    case 'embalm':
    case 'paint':
      p.torsoX = 0.18;
      p.aL = [-0.9, -0.1, -0.7];
      p.aR = [-1.0 + 0.25 * s(tau * (anim === 'clean' ? 6 : 4)), 0.2 + 0.2 * Math.cos(tau * 4), -0.8];
      if (anim === 'clean') {
        p.torsoX = 0.5;
        p.headX = 0.3;
      }
      if (anim === 'paint') p.aR = [-1.6 + 0.3 * s(tau * 3), 0.2 * Math.cos(tau * 3), -0.4];
      break;
    case 'shower':
      p.headX = -0.4;
      p.aL = [-2.7 + 0.2 * s(tau * 5), -0.3, -1.4];
      p.aR = [-2.7 - 0.2 * s(tau * 5), 0.3, -1.4];
      break;
    case 'exercise':
      p.aL = [-0.2, -0.3, -0.4 - 1.6 * Math.max(0, s(tau * 2.5))];
      p.aR = [-0.2, 0.3, -0.4 - 1.6 * Math.max(0, s(tau * 2.5))];
      break;
    case 'read':
    case 'phone':
      if (anim === 'phone') p.aR = [-1.6, 0.9, -2.3];
      else {
        p.aL = [-1.2, -0.25, -1.2];
        p.aR = [-1.2, 0.25, -1.2];
        p.headX = 0.35;
      }
      break;
    case 'admire':
      p.aL = [-0.2, -0.9, -1.6];
      p.aR = [-0.2, 0.9, -1.6];
      p.headZ = 0.15 * s(tau * 1.5);
      break;
    case 'pickup':
      p.torsoX = 1.1;
      p.hipsY = LEG - 0.12;
      p.lL = [-0.5, 0.9];
      p.lR = [-0.5, 0.9];
      p.aL = [-1.2, -0.1, 0];
      p.aR = [-1.2, 0.1, 0];
      break;
    case 'groan':
    case 'yawn':
    case 'stretch':
      p.headX = -0.45;
      if (anim === 'stretch') {
        p.aL = [-2.9, -0.2, -0.2];
        p.aR = [-2.9, 0.2, -0.2];
      } else if (anim === 'yawn') p.aR = [-1.6, 0.2, -2.2];
      else {
        p.aL = [0.1, -0.05, 0];
        p.aR = [0.1, 0.05, 0];
      }
      break;
    case 'feral':
      p.torsoX = 0.55 + 0.05 * s(tau * 21);
      p.hipsY = LEG - 0.1;
      p.lL = [-0.4, 0.6];
      p.lR = [-0.4, 0.6];
      p.aL = [-1.3, -0.3, -0.8];
      p.aR = [-1.3, 0.3, -0.8];
      p.headX = -0.3 + 0.1 * s(tau * 17);
      break;
    case 'disgusted':
      p.torsoX = -0.25;
      p.headX = -0.2;
      p.aL = [-1.3, -0.3, -1.7];
      p.aR = [-1.3, 0.3, -1.7];
      break;
    case 'standEat':
      p.aR = [-1.4 + 0.35 * Math.max(0, s(tau * 2.2)), 0.25, -2.0];
      p.aL = [-0.8, -0.1, -1.2];
      break;
    default:
      break;
  }
  return p;
}

const CARRY_COLORS: Record<CarryItem, string> = {
  plate: '#e8e0c8',
  dish: '#bfb39a',
  ingredients: '#a5532f',
  limb: '#9fb88a',
  book: '#6e2a35',
  phone: '#2b2f3a',
  brush: '#ffb35a',
  pizza: '#d9a050',
};

const ONE_SHOTS = new Set<string>(['pickup', 'yawn', 'collapse']);

let sharedGeo: Record<string, THREE.BufferGeometry> | null = null;
function geo(): Record<string, THREE.BufferGeometry> {
  if (sharedGeo) return sharedGeo;
  sharedGeo = {
    torso: new THREE.CapsuleGeometry(0.17, 0.32, 6, 14),
    head: new THREE.SphereGeometry(0.19, 20, 16),
    eye: new THREE.SphereGeometry(0.045, 10, 8),
    pupil: new THREE.SphereGeometry(0.02, 8, 6),
    lid: new THREE.SphereGeometry(0.05, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    upper: new THREE.CapsuleGeometry(0.055, 0.24, 4, 10),
    lower: new THREE.CapsuleGeometry(0.048, 0.24, 4, 10),
    hand: new THREE.SphereGeometry(0.06, 10, 8),
    thigh: new THREE.CapsuleGeometry(0.075, 0.28, 4, 10),
    shin: new THREE.CapsuleGeometry(0.06, 0.28, 4, 10),
    shoe: new THREE.BoxGeometry(0.12, 0.08, 0.22),
    mouth: new THREE.BoxGeometry(0.11, 0.025, 0.02),
    hair: new THREE.SphereGeometry(0.2, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
    bun: new THREE.SphereGeometry(0.08, 10, 8),
    stump: new THREE.SphereGeometry(0.06, 8, 6),
    carry: new THREE.BoxGeometry(0.2, 0.06, 0.18),
    stitch: new THREE.BoxGeometry(0.1, 0.008, 0.01),
  };
  return sharedGeo;
}

class PlaceholderRig implements ZombieRig {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly headG = new THREE.Group();
  private readonly arm: THREE.Group[] = [];
  private readonly elbow: THREE.Group[] = [];
  private readonly leg: THREE.Group[] = [];
  private readonly knee: THREE.Group[] = [];
  private readonly stumps: THREE.Mesh[] = [];
  private readonly mats: THREE.MeshStandardMaterial[] = [];
  private readonly skin = new THREE.MeshStandardMaterial({ roughness: 0.75 });
  private readonly top = new THREE.MeshStandardMaterial({ roughness: 0.85 });
  private readonly bottom = new THREE.MeshStandardMaterial({ roughness: 0.85 });
  private readonly shoe = new THREE.MeshStandardMaterial({ roughness: 0.7 });
  private readonly hairMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  private readonly eyeMat = new THREE.MeshStandardMaterial({ roughness: 0.3, emissiveIntensity: 0.25 });
  private readonly dark = new THREE.MeshStandardMaterial({ color: '#2a1e22', roughness: 0.6 });
  private readonly wood = new THREE.MeshStandardMaterial({ color: '#8a6440', roughness: 0.7 });
  private readonly carryMat = new THREE.MeshStandardMaterial({ roughness: 0.6 });
  private readonly mouth: THREE.Mesh;
  private readonly lids: THREE.Mesh[] = [];
  private readonly hair: THREE.Mesh;
  private readonly bun: THREE.Mesh;
  private readonly carryMesh: THREE.Mesh;
  private app: ZombieAppearance;
  private limbs: LimbState = intactLimbs();
  private anim: AnimState = 'idle';
  private expr: Expression = 'neutral';
  private talking = false;
  private decay = 0;
  private moveScale = 1;
  private tau = 0;
  private animTime = 0;
  private walkPhase = 0;
  private fade = 1;
  private readonly from = zeroPose();
  private readonly target = zeroPose();
  private readonly cur = zeroPose();
  private highlight: 'none' | 'hover' | 'selected' = 'none';

  constructor(app: ZombieAppearance, limbs: LimbState) {
    const g = geo();
    this.app = { ...app };
    this.mats.push(this.skin, this.top, this.bottom, this.shoe, this.hairMat, this.eyeMat, this.dark, this.wood, this.carryMat);
    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.add(this.torso);
    const torsoMesh = new THREE.Mesh(g.torso, this.top);
    torsoMesh.position.y = 0.3;
    torsoMesh.scale.set(1.05, 1, 0.8);
    this.torso.add(torsoMesh);
    for (let i = 0; i < 3; i++) {
      const st = new THREE.Mesh(g.stitch, this.dark);
      st.position.set(0, 0.42 - i * 0.07, 0.14);
      st.rotation.z = 0.5;
      this.torso.add(st);
    }
    this.headG.position.y = 0.66;
    this.torso.add(this.headG);
    const head = new THREE.Mesh(g.head, this.skin);
    head.position.y = 0.16;
    head.scale.set(1, 1.05, 0.95);
    this.headG.add(head);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(g.eye, this.eyeMat);
      eye.position.set(0.075 * sx, 0.19, 0.155);
      this.headG.add(eye);
      const pupil = new THREE.Mesh(g.pupil, this.dark);
      pupil.position.set(0.075 * sx, 0.185, 0.195);
      this.headG.add(pupil);
      const lid = new THREE.Mesh(g.lid, this.skin);
      lid.position.set(0.075 * sx, 0.195, 0.157);
      lid.rotation.x = -0.35;
      this.lids.push(lid);
      this.headG.add(lid);
    }
    this.mouth = new THREE.Mesh(g.mouth, this.dark);
    this.mouth.position.set(0, 0.07, 0.172);
    this.headG.add(this.mouth);
    this.hair = new THREE.Mesh(g.hair, this.hairMat);
    this.hair.position.y = 0.19;
    this.headG.add(this.hair);
    this.bun = new THREE.Mesh(g.bun, this.hairMat);
    this.bun.position.set(0, 0.37, -0.06);
    this.headG.add(this.bun);
    for (const sx of [1, -1]) {
      const sh = new THREE.Group();
      sh.position.set(0.24 * sx, 0.5, 0);
      this.torso.add(sh);
      const up = new THREE.Mesh(g.upper, this.top);
      up.position.y = -0.17;
      sh.add(up);
      const el = new THREE.Group();
      el.position.y = -0.34;
      sh.add(el);
      const lo = new THREE.Mesh(g.lower, this.skin);
      lo.position.y = -0.16;
      el.add(lo);
      const hand = new THREE.Mesh(g.hand, this.skin);
      hand.position.y = -0.34;
      el.add(hand);
      const stump = new THREE.Mesh(g.stump, this.skin);
      stump.position.copy(sh.position);
      stump.visible = false;
      this.torso.add(stump);
      this.stumps.push(stump);
      this.arm.push(sh);
      this.elbow.push(el);
    }
    for (const sx of [1, -1]) {
      const hip = new THREE.Group();
      hip.position.set(0.1 * sx, 0, 0);
      this.hips.add(hip);
      const th = new THREE.Mesh(g.thigh, this.bottom);
      th.position.y = -0.2;
      hip.add(th);
      const kn = new THREE.Group();
      kn.position.y = -0.4;
      hip.add(kn);
      const sn = new THREE.Mesh(g.shin, this.bottom);
      sn.position.y = -0.18;
      kn.add(sn);
      const sh = new THREE.Mesh(g.shoe, this.shoe);
      sh.position.set(0, -0.37, 0.04);
      kn.add(sh);
      const stump = new THREE.Mesh(g.stump, this.bottom);
      stump.position.copy(hip.position);
      stump.position.y = -0.04;
      stump.visible = false;
      this.hips.add(stump);
      this.stumps.push(stump);
      this.leg.push(hip);
      this.knee.push(kn);
    }
    this.carryMesh = new THREE.Mesh(g.carry, this.carryMat);
    this.carryMesh.position.set(0, 0.28, 0.32);
    this.carryMesh.visible = false;
    this.torso.add(this.carryMesh);
    this.setAppearance(app);
    this.setLimbs(limbs);
    poseFor('idle', 0, 0, this.target);
    Object.assign(this.from, this.target);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
  }

  setAppearance(app: ZombieAppearance): void {
    if (!app || typeof app !== 'object') return;
    this.app = { ...app };
    const sc = 0.88 + 0.2 * clamp01(app.height);
    const bw = 0.9 + 0.25 * clamp01(app.build);
    this.root.scale.set(sc * bw, sc, sc * bw);
    this.applySkin();
    this.top.color.set(safeHex(app.topColor, '#6b4f8a'));
    this.bottom.color.set(safeHex(app.bottomColor, '#3a3f55'));
    this.shoe.color.set(safeHex(app.shoeColor, '#2a2420'));
    this.hairMat.color.set(safeHex(app.hairColor, '#3b2f2f'));
    this.eyeMat.color.set(safeHex(app.eyeColor, '#f2e86d'));
    this.eyeMat.emissive.set(safeHex(app.eyeColor, '#f2e86d'));
    const hs = app.hairStyle;
    this.hair.visible = hs !== 'bald';
    this.hair.scale.set(hs === 'afro' ? 1.35 : 1, hs === 'mohawk' ? 1.4 : hs === 'buzz' ? 0.75 : 1, hs === 'mohawk' ? 0.35 : hs === 'long' ? 1.15 : 1);
    this.bun.visible = hs === 'bun' || hs === 'pigtails';
  }

  private applySkin(): void {
    const tone = SKIN_TONES[Math.abs(Math.floor(Number(this.app.skinTone) || 0)) % SKIN_TONES.length];
    this.skin.color.set(tone).lerp(new THREE.Color('#6f7a55'), this.decay * 0.55).multiplyScalar(1 - this.decay * 0.18);
  }

  setLimbs(limbs: LimbState): void {
    if (!limbs || typeof limbs !== 'object') return;
    this.limbs = { ...intactLimbs(), ...limbs };
    const ids: (keyof LimbState)[] = ['armL', 'armR', 'legL', 'legR'];
    const groups = [this.arm[0], this.arm[1], this.leg[0], this.leg[1]];
    ids.forEach((id, i) => {
      const c = this.limbs[id];
      groups[i].visible = c !== 'missing';
      this.stumps[i].visible = c === 'missing';
      groups[i].traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if (c === 'prosthetic') {
          if (!m.userData.origMat) m.userData.origMat = m.material;
          m.material = this.wood;
        } else if (m.userData.origMat) {
          m.material = m.userData.origMat as THREE.Material;
          delete m.userData.origMat;
        }
      });
    });
  }

  setDecay(level: number): void {
    this.decay = clamp01(level);
    this.applySkin();
  }

  setAnim(requested: AnyAnimState): void {
    // procedural poses exist for core states only: extras pose as their EXTRA_ANIM_FALLBACK
    const state = effectiveAnim(requested) as AnimState;
    if (state === this.anim) return;
    Object.assign(this.from, this.cur);
    this.from.aL = [...this.cur.aL];
    this.from.aR = [...this.cur.aR];
    this.from.lL = [...this.cur.lL];
    this.from.lR = [...this.cur.lR];
    this.anim = state;
    this.fade = 0;
    this.animTime = 0;
  }

  setExpression(expr: Expression): void {
    this.expr = expr;
  }

  setTalking(on: boolean): void {
    this.talking = !!on;
  }

  setCarry(item: CarryItem | null): void {
    this.carryMesh.visible = !!item;
    if (item) this.carryMat.color.set(CARRY_COLORS[item] ?? '#cccccc');
  }

  setHighlight(mode: 'none' | 'hover' | 'selected'): void {
    if (mode === this.highlight) return;
    this.highlight = mode;
    const c = mode === 'selected' ? new THREE.Color('#2f5a1a') : mode === 'hover' ? new THREE.Color('#2a3a22') : new THREE.Color(0, 0, 0);
    for (const m of [this.skin, this.top, this.bottom, this.shoe, this.hairMat]) {
      m.emissive.copy(c);
      m.emissiveIntensity = mode === 'none' ? 0 : 1;
    }
  }

  setMoveSpeed(scale: number): void {
    this.moveScale = Number.isFinite(scale) ? Math.max(0, Math.min(6, scale)) : 1;
  }

  update(dtSec: number): void {
    const dt = Number.isFinite(dtSec) ? Math.min(Math.max(dtSec, 0), 0.25) : 0;
    this.tau += dt;
    this.animTime += dt;
    this.walkPhase += dt * Math.PI * 2 * 0.95 * this.moveScale;
    const t = ONE_SHOTS.has(this.anim) ? Math.min(this.animTime, 1.2) : this.tau;
    poseFor(this.anim, t, this.walkPhase, this.target);
    this.fade = Math.min(1, this.fade + dt / 0.25);
    const k = this.fade * this.fade * (3 - 2 * this.fade);
    lerpPose(this.from, this.target, k, this.cur);
    const p = this.cur;
    this.body.rotation.x = p.bodyRotX;
    this.body.position.set(0, p.lift, p.hipsZ);
    this.hips.position.y = p.hipsY;
    this.torso.rotation.set(p.torsoX, p.torsoY, p.torsoZ);
    this.headG.rotation.set(p.headX, 0, p.headZ);
    const arms = [p.aL, p.aR];
    for (let i = 0; i < 2; i++) {
      this.arm[i].rotation.set(arms[i][0], 0, arms[i][1] * (i === 0 ? 1 : 1));
      this.elbow[i].rotation.x = arms[i][2];
      const legs = i === 0 ? p.lL : p.lR;
      this.leg[i].rotation.x = legs[0];
      this.knee[i].rotation.x = legs[1];
    }
    // face
    const flap = this.talking ? 0.5 + 0.5 * Math.abs(Math.sin(this.tau * 17)) : 0;
    let mouthY = 1 + flap * 3;
    let mouthX = 1;
    let lid = -0.35;
    switch (this.expr) {
      case 'happy':
        mouthX = 1.3;
        break;
      case 'sad':
        mouthX = 0.8;
        lid = -0.1;
        break;
      case 'angry':
        lid = 0.2;
        break;
      case 'sleepy':
        lid = 0.45;
        break;
      case 'shocked':
        mouthY += 2.2;
        lid = -0.9;
        break;
      case 'disgusted':
        mouthX = 0.7;
        mouthY += 0.8;
        break;
      default:
        break;
    }
    if (this.anim === 'sleep' || this.anim === 'collapse') lid = 1.2;
    this.mouth.scale.set(mouthX, mouthY, 1);
    for (const l of this.lids) l.rotation.x = lid;
  }

  private readonly headLocal = new THREE.Vector3(0, 0.38, 0);

  headTop(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.headG.localToWorld(out.copy(this.headLocal));
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
    this.root.removeFromParent();
  }
}

function clamp01(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
}

function safeHex(c: unknown, fb: string): string {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : fb;
}

export function createPlaceholderCharacters(): CharacterFactory {
  return {
    ready: Promise.resolve(),
    progress: () => 1,
    create(app: ZombieAppearance, limbs: LimbState): ZombieRig {
      return new PlaceholderRig(app, limbs);
    },
    dispose(): void {
      if (sharedGeo) for (const g of Object.values(sharedGeo)) g.dispose();
      sharedGeo = null;
    },
  };
}
