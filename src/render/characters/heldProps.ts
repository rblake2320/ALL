/**
 * W-120 (request F) HELD-PROP STOW: a sculpted held prop (docs/contract-requests/cast.md §4: "held props are part
 * of the sculpt and stay rigid on the hand") follows every clip, so in the clips that take the hands to the floor it
 * swings through it - the Lid Guard's coffin lid reached 374-422 mm below the floor at the crawl's t=0.867 s while
 * the hand bones themselves stayed >= +84 mm (docs/research/crawl-diagnostic.md). Lifting the whole body would float
 * the hands ~0.5 m, so the prop alone moves: during those clips it is stowed on the body (on the back when prone, on
 * the chest when supine) and comes back to the hand when the clip fades out.
 *
 * Mechanism (runtime only; the GLB is not edited): at template preparation the prop's vertices are found as the
 * rigid island of the body mesh skinned 100 % to `bone` - the GLB's deforming prop bone `prop_L/R` (a child of the
 * hand that no clip moves, W-120 step 2a), or the hand itself on older exports - welded by position so UV seams do
 * not split it, then re-skinned to a new bone `heldProp_<side>` added under that bone with an identity local
 * transform and its inverse bind matrix - so outside the stow clips the prop renders exactly as before. The stow pose is
 * measured on the rest mesh (prop principal axes -> long axis up, thin axis along the stow normal; placed `gap`
 * off the torso surface) and stored relative to the `anchor` bone; CastRig drives the bone's local transform each
 * frame by the stow clips' crossfade weights.
 */
import * as THREE from 'three';
import type { AnyAnimState } from '../../shared/appearance';
import type { CastBodyId } from '../../shared/cast';
import { HANDS_DOWN_PRONE_ANIMS, HANDS_DOWN_SUPINE_ANIMS } from './plan';
import { HELD_PROP_FIT } from './heldPropFit';

/**
 * Where a held prop is while a clip plays: stowed on the 'back' / 'chest', or put 'away' (W-151: shrunk into the
 * hand - for clips where neither the hand nor a stow spot keeps it out of the body or the furniture).
 */
export type StowSpot = 'back' | 'chest' | 'away';
/** Spots with a measured pose on the body. */
export const BODY_SPOTS: readonly Exclude<StowSpot, 'away'>[] = ['back', 'chest'];

export interface HeldPropRule {
  /**
   * Bone the sculpted prop is rigidly skinned to in the GLB: the deforming prop bone (`prop_L/R`, a child of the
   * hand, W-120 step 2a) on current cast exports, the hand itself on pre-2a exports.
   */
  bone: 'prop_L' | 'prop_R' | 'hand_L' | 'hand_R';
  /** Hand whose arm carries the prop (a missing arm leaves the prop with the collapsed hand). */
  hand: 'hand_L' | 'hand_R';
  /** Smallest island (vertices) accepted as the prop (the hand itself is welded to the arm and never qualifies). */
  minVerts: number;
  /** Bone the stowed prop rides on. */
  anchor: string;
  /** Clearance between the stowed prop and the torso surface (m, rest pose). */
  gap: number;
  /** Stow spot per played clip (plan.clip); clips not listed keep the prop in the hand. */
  stow: ReadonlyMap<AnyAnimState, StowSpot>;
  /** False for a prop too small to wear on the body (a phone): outside the hands-down clips it is put away instead. */
  wear?: boolean;
}

/** Prone hands-down clips stow on the back, supine ones on the chest (plan.ts clip tags). */
export function handsDownStow(): ReadonlyMap<AnyAnimState, StowSpot> {
  const m = new Map<AnyAnimState, StowSpot>();
  for (const c of HANDS_DOWN_PRONE_ANIMS) m.set(c, 'back');
  for (const c of HANDS_DOWN_SUPINE_ANIMS) m.set(c, 'chest');
  return m;
}

/**
 * W-151: the stow table of a body - the generated per-clip fit (heldPropFit.ts: every clip measured against the
 * body, tests/unit/clip-audit/heldPropFit.test.ts), falling back to the W-120 hands-down stow for a body without one.
 */
export function stowFor(body: string): Map<AnyAnimState, StowSpot> {
  const row = Object.prototype.hasOwnProperty.call(HELD_PROP_FIT, body) ? HELD_PROP_FIT[body] : undefined;
  if (!row) return new Map(handsDownStow());
  const m = new Map<AnyAnimState, StowSpot>();
  for (const k of Object.keys(row)) m.set(k as AnyAnimState, row[k]);
  return m;
}

/**
 * Per-look rules. Only bodies whose prop is a separate rigid island on a prop bone are listed: the other cast hand
 * props (boss, gamer, tourist) are welded into the arm surface until W-120 step 2b cuts them free.
 */
export const HELD_PROP_RULES: Partial<Record<CastBodyId, readonly HeldPropRule[]>> = {
  shield: [{ bone: 'prop_L', hand: 'hand_L', minVerts: 200, anchor: 'chest', gap: 0.03, stow: stowFor('shield') }],
  // the phone (16 vertices on prop_L since W-120 step 2a) dipped 6.6-7.5 mm under the floor in the crawl
  streamer: [{ bone: 'prop_L', hand: 'hand_L', minVerts: 8, anchor: 'chest', gap: 0.02, stow: stowFor('streamer'), wear: false }],
  // the cane became a separate island on prop_L with the cast props batch (PR #74); unstowed it went 205-231 mm
  // under the floor through the whole legless crawl (clip gate, batch 1106)
  ringmaster: [{ bone: 'prop_L', hand: 'hand_L', minVerts: 8, anchor: 'chest', gap: 0.03, stow: stowFor('ringmaster') }],
};

/** Prepared stow data of one prop (immutable, template-owned). */
export interface HeldPropBinding {
  /** Name of the added bone that carries the prop (child of `parent`). */
  bone: string;
  /** Bone the prop was skinned to in the GLB; the carrier's parent and the frame its pose is expressed in. */
  parent: string;
  hand: 'hand_L' | 'hand_R';
  anchor: string;
  stow: ReadonlyMap<AnyAnimState, StowSpot>;
  /** Stowed prop-bone matrix in the anchor bone's frame, per body spot ('away' has none: the prop shrinks in the hand). */
  inAnchor: ReadonlyMap<StowSpot, THREE.Matrix4>;
  /** Prop hull support points in the prop bone's frame (its lowest point under any pose is one of them). */
  support: readonly THREE.Vector3[];
  /** Number of re-skinned vertices (diagnostics / tests). */
  vertexCount: number;
}

/** Floor clearance (m) the held-prop floor clamp keeps under the prop in every clip. */
export const PROP_FLOOR_MARGIN = 0.002;
/** Directions sampled for the prop's support points (Fibonacci sphere). */
const SUPPORT_DIRS = 96;

/** Indices of the points extreme along SUPPORT_DIRS directions (a dense subset of the convex hull's vertices). */
export function supportIndices(points: readonly THREE.Vector3[]): number[] {
  const out = new Set<number>();
  const dir = new THREE.Vector3();
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let k = 0; k < SUPPORT_DIRS; k++) {
    const y = 1 - (2 * (k + 0.5)) / SUPPORT_DIRS;
    const r = Math.sqrt(1 - y * y);
    dir.set(Math.cos(golden * k) * r, y, Math.sin(golden * k) * r);
    let best = -Infinity;
    let bi = -1;
    for (let i = 0; i < points.length; i++) {
      const d = points[i].dot(dir);
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    if (bi >= 0) out.add(bi);
  }
  return [...out].sort((a, b) => a - b);
}

export const heldPropBoneName = (hand: string): string => `heldProp_${hand.slice(-1)}`;

const TORSO_BONES = new Set(['pelvis', 'spine', 'chest', 'neck']);
const RIGID = 0.999;

function dominant(si: THREE.BufferAttribute, sw: THREE.BufferAttribute, i: number): { index: number; weight: number } {
  let weight = -1;
  let index = 0;
  for (let k = 0; k < 4; k++) {
    const w = sw.getComponent(i, k);
    if (w > weight) {
      weight = w;
      index = si.getComponent(i, k);
    }
  }
  return { index, weight };
}

/** Vertices of the largest island (welded by position) skinned 100 % to bone index `bi`, or null. */
export function rigidIsland(geo: THREE.BufferGeometry, bi: number, minVerts: number): number[] | null {
  const pa = geo.attributes.position as THREE.BufferAttribute;
  const si = geo.attributes.skinIndex as THREE.BufferAttribute | undefined;
  const sw = geo.attributes.skinWeight as THREE.BufferAttribute | undefined;
  if (!pa || !si || !sw) return null;
  const n = pa.count;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const weld = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pa.getX(i) * 1e4)},${Math.round(pa.getY(i) * 1e4)},${Math.round(pa.getZ(i) * 1e4)}`;
    const j = weld.get(k);
    if (j === undefined) weld.set(k, i);
    else union(i, j);
  }
  const idx = geo.index;
  const tris = idx ? idx.count : n;
  for (let t = 0; t + 2 < tris; t += 3) {
    const a = idx ? idx.getX(t) : t;
    union(a, idx ? idx.getX(t + 1) : t + 1);
    union(a, idx ? idx.getX(t + 2) : t + 2);
  }
  const islands = new Map<number, { verts: number[]; rigid: boolean }>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let isl = islands.get(r);
    if (!isl) {
      isl = { verts: [], rigid: true };
      islands.set(r, isl);
    }
    isl.verts.push(i);
    const d = dominant(si, sw, i);
    if (d.index !== bi || d.weight < RIGID) isl.rigid = false;
  }
  let best: number[] | null = null;
  for (const isl of islands.values()) {
    if (isl.rigid && isl.verts.length >= minVerts && (!best || isl.verts.length > best.length)) best = isl.verts;
  }
  return best;
}

/** Principal axes (descending variance) of a point set: Jacobi eigen-decomposition of the covariance. */
export function principalAxes(points: readonly THREE.Vector3[]): { centre: THREE.Vector3; axes: [THREE.Vector3, THREE.Vector3, THREE.Vector3] } {
  const c = new THREE.Vector3();
  for (const p of points) c.add(p);
  c.divideScalar(Math.max(1, points.length));
  const a = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) {
    const d = [p.x - c.x, p.y - c.y, p.z - c.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) a[i][j] += d[i] * d[j];
  }
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 32; sweep++) {
    const off = a[0][1] ** 2 + a[0][2] ** 2 + a[1][2] ** 2;
    if (off < 1e-18) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      if (Math.abs(a[p][q]) < 1e-20) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const cs = 1 / Math.sqrt(t * t + 1);
      const sn = t * cs;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = cs * akp - sn * akq;
        a[k][q] = sn * akp + cs * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k];
        const aqk = a[q][k];
        a[p][k] = cs * apk - sn * aqk;
        a[q][k] = sn * apk + cs * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p];
        const vkq = v[k][q];
        v[k][p] = cs * vkp - sn * vkq;
        v[k][q] = sn * vkp + cs * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  const axis = (i: number) => new THREE.Vector3(v[0][i], v[1][i], v[2][i]).normalize();
  return { centre: c, axes: [axis(order[0]), axis(order[1]), axis(order[2])] };
}

/**
 * Rest-space transform that stows the prop at `spot`: long axis up, thin axis along the spot normal (the dome's
 * apex outward), centred on the anchor's height and `gap` off the torso surface it covers.
 */
export function stowTransform(prop: readonly THREE.Vector3[], torso: readonly THREE.Vector3[], anchorRest: THREE.Vector3, spot: Exclude<StowSpot, 'away'>, gap: number): THREE.Matrix4 {
  const { centre, axes } = principalAxes(prop);
  const [e1, , e3] = axes;
  if (e1.y < 0) e1.negate(); // keep the end that is up at rest up
  // dome apex: the thin-axis side away from the rim (the widest ring of vertices)
  let rimR = -1;
  let rimS = 0;
  let meanS = 0;
  const d = new THREE.Vector3();
  for (const p of prop) {
    d.subVectors(p, centre);
    const s = d.dot(e3);
    meanS += s;
    const r = d.addScaledVector(e3, -s).length();
    if (r > rimR) {
      rimR = r;
      rimS = s;
    }
  }
  meanS /= Math.max(1, prop.length);
  if (meanS - rimS < 0) e3.negate();
  const e2 = new THREE.Vector3().crossVectors(e3, e1).normalize();
  e1.crossVectors(e2, e3).normalize();
  const n = new THREE.Vector3(0, 0, spot === 'back' ? -1 : 1);
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(n, up);
  const src = new THREE.Matrix4().makeBasis(e1, e2, e3);
  const dst = new THREE.Matrix4().makeBasis(up, side, n);
  const rot = dst.multiply(src.transpose());
  // extent of the rotated prop, then the torso surface it covers
  const box = new THREE.Box3();
  const q = new THREE.Vector3();
  for (const p of prop) box.expandByPoint(q.subVectors(p, centre).applyMatrix4(rot));
  const halfW = Math.max(-box.min.x, box.max.x);
  const y0 = anchorRest.y + box.min.y;
  const y1 = anchorRest.y + box.max.y;
  let surface = spot === 'back' ? Infinity : -Infinity;
  for (const p of torso) {
    if (p.y < y0 || p.y > y1 || Math.abs(p.x - anchorRest.x) > halfW) continue;
    surface = spot === 'back' ? Math.min(surface, p.z) : Math.max(surface, p.z);
  }
  if (!Number.isFinite(surface)) surface = anchorRest.z;
  const z = spot === 'back' ? surface - gap - box.max.z : surface + gap - box.min.z;
  const target = new THREE.Vector3(anchorRest.x, anchorRest.y, z);
  return new THREE.Matrix4().makeTranslation(target.x, target.y, target.z).multiply(rot).multiply(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
}

/**
 * Re-skin each rule's prop island to its own prop bone and measure the stow poses (mutates the template mesh /
 * skeleton once; every rig clones it). The scene must be at rest. A rule whose island or bones are absent is
 * skipped (the prop stays on the hand).
 */
export function prepareHeldProps(scene: THREE.Object3D, mesh: THREE.SkinnedMesh, rules: readonly HeldPropRule[]): HeldPropBinding[] {
  const out: HeldPropBinding[] = [];
  scene.updateMatrixWorld(true);
  for (const rule of rules) {
    const sk = mesh.skeleton;
    const bi = sk.bones.findIndex((b) => b.name === rule.bone);
    const hand = sk.bones[bi]; // the carrier's parent: the prop bone (or the hand on pre-2a exports)
    const anchor = scene.getObjectByName(rule.anchor);
    const name = heldPropBoneName(rule.hand);
    if (bi < 0 || !hand || !anchor || scene.getObjectByName(name)) continue;
    const island = rigidIsland(mesh.geometry, bi, rule.minVerts);
    if (!island) continue;
    // rest positions (scene space) of the prop and of the torso surface
    const v = new THREE.Vector3();
    const prop = island.map((i) => mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).clone());
    const si = mesh.geometry.attributes.skinIndex as THREE.BufferAttribute;
    const sw = mesh.geometry.attributes.skinWeight as THREE.BufferAttribute;
    const inIsland = new Uint8Array(si.count);
    for (const i of island) inIsland[i] = 1;
    const torso: THREE.Vector3[] = [];
    for (let i = 0; i < si.count; i++) {
      if (inIsland[i]) continue;
      const b = sk.bones[dominant(si, sw, i).index];
      if (b && TORSO_BONES.has(b.name)) torso.push(mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).clone());
    }
    const anchorRest = anchor.getWorldPosition(new THREE.Vector3());
    // the prop bone: identity under the hand + the hand's inverse bind -> skins the prop exactly like the hand
    const bone = new THREE.Bone();
    bone.name = name;
    hand.add(bone);
    bone.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton([...sk.bones, bone], [...sk.boneInverses, sk.boneInverses[bi].clone()]);
    sk.dispose();
    mesh.bind(skeleton, mesh.bindMatrix);
    const ni = skeleton.bones.length - 1;
    for (const i of island) {
      si.setXYZW(i, ni, 0, 0, 0);
      sw.setXYZW(i, 1, 0, 0, 0);
    }
    si.needsUpdate = true;
    sw.needsUpdate = true;
    const anchorInv = anchor.matrixWorld.clone().invert();
    const inAnchor = new Map<StowSpot, THREE.Matrix4>();
    for (const spot of BODY_SPOTS) {
      const s = stowTransform(prop, torso, anchorRest, spot, rule.gap);
      inAnchor.set(spot, anchorInv.clone().multiply(s).multiply(bone.matrixWorld));
    }
    const boneInv = bone.matrixWorld.clone().invert();
    const support = supportIndices(prop).map((i) => prop[i].clone().applyMatrix4(boneInv));
    out.push({ bone: name, parent: rule.bone, hand: rule.hand, anchor: rule.anchor, stow: rule.stow, inAnchor, support, vertexCount: island.length });
  }
  return out;
}

/**
 * Per-rig driver of the prepared props (CastRig owns one). Each frame: blend the prop bone from the hand-held
 * identity towards the stow pose of the playing stow clips, then clamp it above the rig's floor (root y = 0): the
 * clamp is the safety net for clips that only graze the floor with the prop (a seated rim, the pickup bend).
 */
export class HeldPropStow {
  /** `hand` is the carrier's parent frame (`b.parent`); arm usability is keyed by `b.hand`. */
  private readonly items: { b: HeldPropBinding; bone: THREE.Object3D; hand: THREE.Object3D; anchor: THREE.Object3D }[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly h = new THREE.Matrix4();
  private readonly rootInv = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly acc = new THREE.Quaternion();
  private readonly accP = new THREE.Vector3();
  private readonly w = new Map<StowSpot, number>();
  /** Last frame's stow weight / floor-clamp lift (m) per prop (tests / diagnostics). */
  readonly last: { stow: number; floorLift: number; away: number }[] = [];

  constructor(bindings: readonly HeldPropBinding[], find: (name: string) => THREE.Object3D | null | undefined) {
    for (const b of bindings) {
      const bone = find(b.bone);
      const hand = find(b.parent);
      const anchor = find(b.anchor);
      if (bone && hand && anchor) {
        this.items.push({ b, bone, hand, anchor });
        this.last.push({ stow: 0, floorLift: 0, away: 0 });
      }
    }
  }

  get size(): number {
    return this.items.length;
  }

  /**
   * Pose every prop bone for the current clip weights (`clips`: played clip + normalised weight). `usable(hand)`
   * is false when that hand's arm is gone (the prop then vanishes with the collapsed hand, as before, and is left
   * at the hand). `root` is the rig root whose y = 0 plane is the floor; its world matrices are refreshed here.
   */
  update(clips: readonly { clip: AnyAnimState; weight: number }[], usable: (hand: 'hand_L' | 'hand_R') => boolean, root: THREE.Object3D): void {
    if (!this.items.length) return;
    root.updateWorldMatrix(true, true);
    this.rootInv.copy(root.matrixWorld).invert();
    for (let n = 0; n < this.items.length; n++) {
      const it = this.items[n];
      const last = this.last[n];
      last.stow = 0;
      last.floorLift = 0;
      last.away = 0;
      it.bone.position.set(0, 0, 0);
      it.bone.quaternion.identity();
      it.bone.scale.set(1, 1, 1);
      if (!usable(it.b.hand)) continue;
      this.w.clear();
      let total = 0;
      let away = 0;
      for (const c of clips) {
        const spot = it.b.stow.get(c.clip);
        if (!spot || !(c.weight > 0)) continue;
        // 'away' has no pose on the body: the prop stays at the hand and shrinks by that clip's weight
        if (spot === 'away') away += c.weight;
        else {
          this.w.set(spot, (this.w.get(spot) ?? 0) + c.weight);
          total += c.weight;
        }
      }
      total = Math.min(1, total);
      away = Math.min(1, away);
      last.stow = Math.min(1, total + away);
      last.away = away;
      const k = away >= 1 - 1e-4 ? 0 : 1 - away;
      if (total >= 1e-4) {
        // blend (in hand space) from the hand-held identity towards each spot's stowed pose
        this.accP.set(0, 0, 0);
        this.acc.set(0, 0, 0, Math.max(0, 1 - total));
        for (const [spot, w] of this.w) {
          const inA = it.b.inAnchor.get(spot);
          if (!inA) continue;
          this.m.copy(it.hand.matrixWorld).invert().multiply(it.anchor.matrixWorld).multiply(inA);
          this.m.decompose(this.p, this.q, this.s);
          this.accP.addScaledVector(this.p, w);
          const sign = this.acc.dot(this.q) < 0 ? -1 : 1;
          this.acc.set(this.acc.x + sign * w * this.q.x, this.acc.y + sign * w * this.q.y, this.acc.z + sign * w * this.q.z, this.acc.w + sign * w * this.q.w);
        }
        it.bone.position.copy(this.accP);
        it.bone.quaternion.copy(this.acc.normalize());
      }
      it.bone.scale.setScalar(k);
      if (k === 0) {
        // put away: nothing left to clamp
        it.bone.updateMatrixWorld(true);
        continue;
      }
      // floor clamp: the prop's lowest hull point in root space
      this.s.setScalar(k);
      this.h.multiplyMatrices(this.rootInv, it.hand.matrixWorld);
      this.m.compose(it.bone.position, it.bone.quaternion, this.s).premultiply(this.h);
      let minY = Infinity;
      for (const sp of it.b.support) minY = Math.min(minY, this.v.copy(sp).applyMatrix4(this.m).y);
      if (minY < PROP_FLOOR_MARGIN) {
        const lift = PROP_FLOOR_MARGIN - minY;
        last.floorLift = lift;
        // translate the prop straight up in root space, expressed back in the hand frame
        this.m.elements[13] += lift;
        this.m.premultiply(this.h.invert());
        this.m.decompose(it.bone.position, it.bone.quaternion, this.s);
        it.bone.scale.setScalar(k);
      }
      it.bone.updateMatrixWorld(true);
    }
  }

  /** Back to the hand-held rest (identity). */
  reset(): void {
    for (const it of this.items) {
      it.bone.position.set(0, 0, 0);
      it.bone.quaternion.identity();
      it.bone.scale.set(1, 1, 1);
    }
  }
}
