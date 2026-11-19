/**
 * Seating geometry probes shared by the seating suite and dev/seating.measure: real furniture GLBs (raycast seat
 * cushion top / backrest / front edge / arms) and real character rigs posed in the `sit*` clips (classic zombie.glb via
 * three.js AnimationMixer + CPU skinning; cast bodies via the documented runtime retarget rule, CPU skinning) composed
 * with the renderer's placement (slot pose + facing, posY, height scale + inner seat offset) in object-local space.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DIM } from '../../../src/shared/dimensions';
import { PHYSICAL_SPECS, type PhysicalSpec, type SlotSpec } from '../../../src/shared/catalog';
import { ZOMBIE_GLB, accessor, parseGlb, readBodyGlb, readManifest, type Glb } from '../cast-assets/helpers';

export const ROOT = resolve(__dirname, '../../..');
/** SEAT_OBJ_DIR=<dir> measures another furniture build (e.g. the pre-fix GLBs for a before/after table). */
const OBJ_DIR = process.env.SEAT_OBJ_DIR ? resolve(process.env.SEAT_OBJ_DIR) : resolve(ROOT, 'public/assets/models/objects');

type V3 = [number, number, number];

function parseThree(path: string): Promise<GLTF> {
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
}

// ───────────────────────────── seats (objects) ─────────────────────────────

export interface SeatSlotRef {
  spec: PhysicalSpec;
  slot: SlotSpec;
  /** Slot root point in model-local space (footprint centred on the origin, +Z front). */
  rootLocal: { x: number; z: number };
  facing: number;
}

/** Every 'sit' slot in the catalog (the seats the sim can put a zombie on). */
export function seatSlots(): SeatSlotRef[] {
  const out: SeatSlotRef[] = [];
  for (const spec of PHYSICAL_SPECS) {
    for (const slot of spec.slots) {
      if (slot.kind !== 'sit' || !slot.pose) continue;
      out.push({
        spec, slot,
        rootLocal: { x: slot.pose.x - spec.footprint.w / 2, z: slot.pose.z - spec.footprint.d / 2 },
        facing: slot.facing ?? 0,
      });
    }
  }
  return out;
}

const CELL = 0.01;

export class SeatModel {
  private readonly meshes: THREE.Mesh[] = [];
  private readonly ray = new THREE.Raycaster();
  constructor(readonly id: string, scene: THREE.Object3D) {
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      // dynamic overlay nodes (screen glow, broken sparks) are not furniture surfaces
      if (m.isMesh && !/^(glow|broken)$/.test(m.name)) {
        (m.material as THREE.Material).side = THREE.DoubleSide;
        this.meshes.push(m);
      }
    });
  }
  /** First hit distance along a ray (Infinity when none). */
  cast(o: V3, d: V3, far = 10): number {
    this.ray.set(new THREE.Vector3(...o), new THREE.Vector3(...d).normalize());
    this.ray.far = far;
    const h = this.ray.intersectObjects(this.meshes, false);
    return h.length ? h[0].distance : Infinity;
  }
  private grid: { x0: number; z0: number; nx: number; nz: number; cols: Float32Array[] } | null = null;
  private readonly bottoms = new Map<THREE.Object3D, number>();
  /** Lowest world y of one mesh. */
  private bottom(o: THREE.Object3D): number {
    let y = this.bottoms.get(o);
    if (y === undefined) this.bottoms.set(o, (y = new THREE.Box3().setFromObject(o).min.y));
    return y;
  }
  /**
   * Is the model-local point inside the furniture? Column grid (1 cm): one downward ray per column collects every
   * crossing; a closed shell is entered through an up-facing surface and left through a down-facing one, and
   * shells nest, so a depth counter per mesh gives the solid intervals of the column.
   */
  insideAt(p: V3): boolean {
    const g = this.grid ?? (this.grid = this.buildGrid());
    const i = Math.round((p[0] - g.x0) / CELL);
    const k = Math.round((p[2] - g.z0) / CELL);
    if (i < 0 || k < 0 || i >= g.nx || k >= g.nz) return false;
    const iv = g.cols[k * g.nx + i];
    for (let j = 0; j < iv.length; j += 2) if (p[1] <= iv[j] && p[1] >= iv[j + 1]) return true;
    return false;
  }
  private buildGrid() {
    const box = new THREE.Box3();
    for (const m of this.meshes) box.expandByObject(m);
    const x0 = box.min.x, z0 = box.min.z;
    const nx = Math.ceil((box.max.x - x0) / CELL) + 1, nz = Math.ceil((box.max.z - z0) / CELL) + 1;
    const cols: Float32Array[] = [];
    const top = box.max.y + 0.1;
    const o = new THREE.Vector3();
    const down = new THREE.Vector3(0, -1, 0);
    const nrm = new THREE.Vector3();
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      o.set(x0 + i * CELL, top, z0 + k * CELL);
      this.ray.set(o, down);
      this.ray.far = top + 1;
      const hits = this.ray.intersectObjects(this.meshes, false);
      const out: number[] = [];
      // depth per mesh: a shell left open (no down-facing exit, e.g. the sheet ghost on the haunted PC's monitor)
      // is solid down to its OWN lowest point, never to the floor under it
      const state = new Map<THREE.Object3D, { depth: number; enter: number }>();
      for (const h of hits) {
        if (!h.face) continue;
        let s = state.get(h.object);
        if (!s) state.set(h.object, (s = { depth: 0, enter: 0 }));
        nrm.copy(h.face.normal).transformDirection(h.object.matrixWorld);
        if (nrm.y > 0) {
          if (s.depth++ === 0) s.enter = h.point.y;
        } else if (nrm.y < 0 && s.depth > 0) {
          if (--s.depth === 0) out.push(s.enter, h.point.y);
        }
      }
      for (const [obj, s] of state) if (s.depth > 0) out.push(s.enter, Math.max(0, this.bottom(obj)));
      cols.push(Float32Array.from(out));
    }
    return { x0, z0, nx, nz, cols };
  }
  /** Highest surface y below `from` at (x, z); -Infinity when nothing. */
  topAt(x: number, z: number, from = 0.9): number {
    const d = this.cast([x, from, z], [0, -1, 0], from + 0.01);
    return Number.isFinite(d) ? from - d : -Infinity;
  }
}

const seatCache = new Map<string, Promise<SeatModel>>();
export function loadSeat(id: string): Promise<SeatModel> {
  let p = seatCache.get(id);
  if (!p) {
    p = parseThree(resolve(OBJ_DIR, `${id}.glb`)).then((g) => new SeatModel(id, g.scene));
    seatCache.set(id, p);
  }
  return p;
}

/** Seat-frame direction (+Z = the sitter's front) → model-local. */
export function seatToLocal(ref: SeatSlotRef, p: V3): V3 {
  const c = Math.cos(ref.facing), s = Math.sin(ref.facing);
  return [ref.rootLocal.x + p[0] * c + p[2] * s, p[1], ref.rootLocal.z - p[0] * s + p[2] * c];
}

export interface SeatMeasure {
  /** Cushion top under the hips (model-local y; the highest surface within 6 cm of the root). */
  height: number;
  /** Distance from the slot root to the backrest face at lumbar height (seat frame -Z); null = no back. */
  back: number | null;
  /** Distance from the slot root to the seat's front lip (seat frame +Z). */
  front: number;
  /** Free half-width between arms (seat frame X) at cushion + 0.12; Infinity = no arms. */
  armHalf: number;
}

/** Lumbar height above the cushion top where the backrest face is measured (and the sitter's back). */
export const LUMBAR_ABOVE_SEAT = 0.22;

/** Probe the modelled seat along the slot's seat frame. */
export function measureSeat(model: SeatModel, ref: SeatSlotRef): SeatMeasure {
  let height = -Infinity;
  for (const dz of [-0.04, 0, 0.04]) for (const dx of [-0.04, 0, 0.04]) {
    const p = seatToLocal(ref, [dx, 0, dz]);
    height = Math.max(height, model.topAt(p[0], p[2]));
  }
  const o = seatToLocal(ref, [0, 0, 0]);
  const dir = (v: V3): V3 => { const q = seatToLocal(ref, v); return [q[0] - o[0], 0, q[2] - o[2]]; };
  const lumbar = height + LUMBAR_ABOVE_SEAT;
  // start in front of the root so a root already inside the back still reports the face
  let backHit = Infinity;
  for (const dy of [-0.06, -0.03, 0, 0.03, 0.06]) for (const dx of [-0.05, 0, 0.05]) {
    const start = seatToLocal(ref, [dx, lumbar + dy, 0.25]);
    backHit = Math.min(backHit, model.cast(start, dir([0, 0, -1]), 1.0));
  }
  const back = Number.isFinite(backHit) ? backHit - 0.25 : null;
  // front lip: walk forward until the surface drops 6 cm below the cushion top
  let front = 0;
  for (let z = 0; z < 1.2; z += 0.005) {
    const p = seatToLocal(ref, [0, 0, z]);
    if (model.topAt(p[0], p[2], height + 0.05) < height - 0.06) break;
    front = z;
  }
  let armHalf = Infinity;
  for (const sx of [-1, 1]) {
    const a = seatToLocal(ref, [0, height + 0.12, 0.05]);
    armHalf = Math.min(armHalf, model.cast(a, dir([sx, 0, 0]), 0.6));
  }
  return { height, back, front, armHalf };
}

/**
 * Is the model-local point inside a closed furniture shell? The nearest surface straight above it is seen from
 * inside (its outward normal points up). Robust to overlapping shells (each cushion is closed on its own).
 */
export function insideSolid(model: SeatModel, p: V3): boolean {
  return model.insideAt(p);
}

// ───────────────────────────── sitters ─────────────────────────────

/** A posed sitter in rig-root space (before placement): bone points and skinned vertex clouds. */
export interface SitterPose {
  pelvis: V3;
  /** Hip mass (pelvis-weighted skin + the top of the thighs next to it): what rests on the cushion. */
  hip: V3[];
  /** Trunk skin (spine/chest) between hip and shoulder heights: what rests against the backrest. */
  torso: V3[];
  /** Thighs, shins and feet. */
  leg: V3[];
}

export interface Sitter {
  id: string;
  label: string;
  /** Uniform height scale range the runtime applies (appearance.height 0..1). */
  scales: number[];
  pose(clip: string, t: number): SitterPose;
}

export const SIT_CLIPS = ['sit', 'sitEat', 'sitTalk', 'sitTV', 'sitComputer', 'sitRead', 'sitChess'] as const;

function sitterFromVerts(pelvis: V3, groups: { hip: V3[]; torso: V3[]; leg: V3[] }): SitterPose {
  return {
    pelvis,
    hip: ((h) => (h.length ? h : groups.hip))(groups.hip.filter((v) => Math.abs(v[2] - pelvis[2]) < 0.14 && v[1] < pelvis[1] + 0.05)),
    torso: groups.torso.filter((v) => v[1] > pelvis[1] + 0.1 && v[1] < pelvis[1] + 0.42),
    leg: groups.leg,
  };
}

// classic: three.js on the real asset
const CLASSIC_GROUPS: Record<string, RegExp> = {
  hip: /^(Torso|Bottom_pants_Waist)_mesh$/,
  torso: /^(Torso|Top_tee_Body)_mesh$/,
  leg: /^(LegUpper_[LR]|LegLower_[LR]|Bottom_pants_Leg[LR]|Foot_[LR]|Shoe_[LR])_mesh$/,
};

export async function classicSitter(): Promise<Sitter> {
  const gltf = await parseThree(ZOMBIE_GLB);
  const scene = gltf.scene;
  const mixer = new THREE.AnimationMixer(scene);
  const meshes: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
  });
  const pelvisBone = scene.getObjectByName('pelvis')!;
  return {
    id: 'classic', label: 'classic zombie',
    scales: [0.88, 1.0, 1.08],
    pose(clip, t) {
      mixer.stopAllAction();
      const c = gltf.animations.find((a) => a.name === clip)!;
      const act = mixer.clipAction(c);
      act.reset().play();
      mixer.setTime(Math.min(t, c.duration - 1e-4));
      scene.updateMatrixWorld(true);
      const groups = { hip: [] as V3[], torso: [] as V3[], leg: [] as V3[] };
      const v = new THREE.Vector3();
      for (const m of meshes) {
        const name = m.name.endsWith('_mesh') ? m.name : `${m.name}_mesh`;
        const keys = (Object.keys(CLASSIC_GROUPS) as (keyof typeof groups)[]).filter((k) => CLASSIC_GROUPS[k].test(name) || CLASSIC_GROUPS[k].test(m.parent?.name ?? ''));
        if (!keys.length) continue;
        m.skeleton.update();
        const n = m.geometry.attributes.position.count;
        for (let i = 0; i < n; i += 2) {
          m.getVertexPosition(i, v);
          v.applyMatrix4(m.matrixWorld);
          for (const k of keys) groups[k].push([v.x, v.y, v.z]);
        }
      }
      const p = pelvisBone.getWorldPosition(new THREE.Vector3());
      return sitterFromVerts([p.x, p.y, p.z], groups);
    },
  };
}

// cast: documented runtime rule (docs/contract-requests/cast.md §2) + CPU skinning (no textures needed)
type Q = number[];
type M4 = Float64Array;
const qmul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
function compose(t: number[], q: Q): M4 {
  const [x, y, z, w] = q;
  const m = new Float64Array(16);
  m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y + z * w); m[2] = 2 * (x * z - y * w);
  m[4] = 2 * (x * y - z * w); m[5] = 1 - 2 * (x * x + z * z); m[6] = 2 * (y * z + x * w);
  m[8] = 2 * (x * z + y * w); m[9] = 2 * (y * z - x * w); m[10] = 1 - 2 * (x * x + y * y);
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
  return m;
}
function mmul(a: M4, b: M4): M4 {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

let zombieRaw: Glb | null = null;
function zombie(): Glb {
  return (zombieRaw ??= parseGlb(readFileSync(ZOMBIE_GLB)));
}
function sampleTrack(anim: any, nodeName: string, path: string, t: number): number[] | null {
  const Z = zombie();
  const idx = Z.json.nodes.findIndex((n: any) => n.name === nodeName);
  const ch = anim.channels.find((c: any) => c.target.node === idx && c.target.path === path);
  if (!ch) return null;
  const s = anim.samplers[ch.sampler];
  const times = accessor(Z, s.input).map((r) => r[0]);
  const vals = accessor(Z, s.output);
  if (t <= times[0]) return vals[0];
  if (t >= times[times.length - 1]) return vals[vals.length - 1];
  let i = 0;
  while (times[i + 1] < t) i++;
  const f = (t - times[i]) / (times[i + 1] - times[i]);
  const a = vals[i], b = vals[i + 1];
  const sign = path === 'rotation' && a.reduce((s2, x, k) => s2 + x * b[k], 0) < 0 ? -1 : 1;
  const v = a.map((x, k) => x * (1 - f) + sign * b[k] * f);
  if (path === 'rotation') { const n = Math.hypot(...v); return v.map((x) => x / n); }
  return v;
}

export const CAST_MANIFEST = readManifest();
/** Premium bodies as flat entries (their high representation): same fields as a cast manifest body. */
export const PREMIUM_ENTRIES: any[] = JSON.parse(readFileSync(resolve(ROOT, 'public/assets/manifest.premium.json'), 'utf8'))
  .bodies.map((b: any) => ({ id: b.id, height: b.height, ...b.representations.high }));

export function castSitter(id: string): Sitter {
  const entry = CAST_MANIFEST.bodies.find((b: any) => b.id === id) ?? PREMIUM_ENTRIES.find((b) => b.id === id);
  if (!entry) throw new Error(`no cast body ${id}`);
  const g = parseGlb(readBodyGlb(entry.file));
  const prim = g.json.meshes[0].primitives[0];
  const skin = g.json.skins[0];
  const ibm = accessor(g, skin.inverseBindMatrices).map((r) => Float64Array.from(r));
  const parent = new Map<number, number>();
  g.json.nodes.forEach((n: any, i: number) => (n.children ?? []).forEach((c: number) => parent.set(c, i)));
  const pos = accessor(g, prim.attributes.POSITION);
  const joints = accessor(g, prim.attributes.JOINTS_0);
  const weights = accessor(g, prim.attributes.WEIGHTS_0);
  const names: string[] = skin.joints.map((j: number) => g.json.nodes[j].name);
  // dominant bone per vertex → body-part groups
  const dom = pos.map((_, i) => names[joints[i][weights[i].indexOf(Math.max(...weights[i]))]]);
  // per-clip lift when the body has one (premium bodies), else the single sitThighLift
  const liftQOf = (clip: string): Q => {
    const deg = entry.sitThighLiftByClip?.[clip] ?? entry.sitThighLift ?? 0;
    const lift = (-deg * Math.PI) / 180;
    return [Math.sin(lift / 2), 0, 0, Math.cos(lift / 2)];
  };
  const pelvisNode = g.json.nodes.findIndex((n: any) => n.name === 'pelvis');
  return {
    id, label: `${entry.id} (${entry.height} m)`,
    scales: [0.94, 1.0, 1.06],
    pose(clip, t) {
      const anim = zombie().json.animations.find((a: any) => a.name === clip);
      const liftQ = liftQOf(clip);
      const local = new Map<number, M4>();
      g.json.nodes.forEach((n: any, i: number) => {
        let tr: number[] = n.translation ?? [0, 0, 0];
        let q: Q = n.rotation ?? [0, 0, 0, 1];
        const r = anim && n.name ? sampleTrack(anim, n.name, 'rotation', t) : null;
        if (r) q = r;
        if (r && (n.name === 'thigh_L' || n.name === 'thigh_R')) q = qmul(liftQ, q);
        if (anim && n.name === 'pelvis') {
          const p = sampleTrack(anim, 'pelvis', 'translation', t);
          if (p) tr = p.map((x, k) => x + entry.seatPelvisOffset[k]);
        }
        local.set(i, compose(tr, q));
      });
      const world = new Map<number, M4>();
      const W = (i: number): M4 => {
        const c = world.get(i);
        if (c) return c;
        const m = parent.has(i) ? mmul(W(parent.get(i)!), local.get(i)!) : local.get(i)!;
        world.set(i, m);
        return m;
      };
      const skinM = skin.joints.map((j: number, k: number) => mmul(W(j), ibm[k]));
      const groups = { hip: [] as V3[], torso: [] as V3[], leg: [] as V3[] };
      for (let i = 0; i < pos.length; i++) {
        const v = pos[i];
        const o: V3 = [0, 0, 0];
        for (let k = 0; k < 4; k++) {
          const w = weights[i][k];
          if (w <= 0) continue;
          const m = skinM[joints[i][k]];
          for (let r = 0; r < 3; r++) o[r] += w * (m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]);
        }
        const b = dom[i];
        if (b === 'pelvis') groups.hip.push(o);
        if (b === 'spine' || b === 'chest' || b === 'pelvis') groups.torso.push(o);
        if (b.startsWith('thigh') || b.startsWith('shin') || b.startsWith('foot')) groups.leg.push(o);
      }
      const pm = W(pelvisNode);
      return sitterFromVerts([pm[12], pm[13], pm[14]], groups);
    },
  };
}

/**
 * Renderer placement of a sitter point (rig-root space) in seat-frame coordinates for height scale `s`: the model is
 * scaled by s about the rig root and lifted by SEAT_HEIGHT·(1−s) (rig.ts / castRig.ts), the root stands at the slot
 * pose (y = slot.pose.y = posY) moved by the renderer's seat offset (src/render/agents/seat.ts).
 */
export function seatFramePoint(ref: SeatSlotRef, p: V3, s: number, off: { forward: number; lift: number }): V3 {
  const y0 = ref.slot.pose?.y ?? 0;
  return [p[0] * s, y0 + p[1] * s + DIM.SEAT_HEIGHT * (1 - s) + off.lift, p[2] * s + off.forward];
}

export function seatSpecs(): PhysicalSpec[] {
  const ids = new Set(seatSlots().map((r) => r.spec.id));
  return PHYSICAL_SPECS.filter((s) => ids.has(s.id));
}

/** Sample times used for every sit clip (seconds; clamped to the clip). */
export const SIT_TIMES = [0, 0.7, 1.4, 2.1];

/** Lumbar back of a posed sitter: rearmost trunk vertex at lumbar height (rig-root z, scale 1). */
export function lumbarBack(p: SitterPose): number {
  const y0 = DIM.SEAT_HEIGHT + LUMBAR_ABOVE_SEAT;
  let z = Infinity;
  for (const v of p.torso) if (Math.abs(v[1] - y0) < 0.05 && v[2] < z) z = v[2];
  return z;
}

/** All sitters the suites cover: classic + every cast body. */
export async function allSitters(): Promise<Sitter[]> {
  return [await classicSitter(), ...[...CAST_MANIFEST.bodies, ...PREMIUM_ENTRIES].map((b: any) => castSitter(b.id))];
}

/** Seat contact of a posed sitter: mean z of the hip-mass vertices within 2 cm of the lowest one (rig-root, scale 1). */
export function hipContactZ(p: SitterPose): number {
  let y0 = Infinity;
  for (const v of p.hip) y0 = Math.min(y0, v[1]);
  let sum = 0, n = 0;
  for (const v of p.hip) if (v[1] < y0 + 0.02) { sum += v[2]; n++; }
  return n ? sum / n : p.pelvis[2];
}
