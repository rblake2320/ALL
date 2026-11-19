/**
 * Dynamic parts: binds named GLB nodes of an instance (screen, glow, bulb, flame, water, door, canvas, serving_N,
 * flag, broken, frost, speaker, pump) and drives them from ObjectVisualState every frame.
 *
 * Per-frame contract: `applyState` performs no allocations once the variant caches are warm — it writes
 * transforms in place, toggles visibility only on change and swaps shared materials by reference.
 *
 * Node extras (glTF extras -> userData, authored in tools/blender/objects):
 *   on: 'inUse'            glow/flame only active while in use (fridge light, stove burners)
 *   flicker: string        screen 'pulse'; glow 'bubble' | 'blink' | 'pulse' | 'buzz' | 'crackle' | 'float';
 *                          bulb 'candle' | 'window'; flame 'intensity' (no scale wobble)
 *   keepVisible: true      flame stays visible (dark) when off — stove coils
 *   alwaysOn: true         flame burns regardless of state — fire item, decorative candles
 *   openAngle: number      door swing in radians about +Y (negative swings toward +Z for a left hinge)
 *   axis/upAngle           flag rotation (axis 'x' | 'y' | 'z', radians when raised)
 *   axis/amp/rate          pump bob (axis 'y', metres, Hz)
 *   finished: true         canvas always shows the finished painting
 */
import * as THREE from 'three';
import type { ObjectVisualState } from '../contracts';
import { CANVAS_LEVELS, DIRT_LEVELS, EMISSIVE_LEVELS, MaterialVariants, hasEmissive } from './variants';

export type PartKind =
  | 'screen'
  | 'glow'
  | 'bulb'
  | 'flame'
  | 'water'
  | 'door'
  | 'canvas'
  | 'serving'
  | 'flag'
  | 'broken'
  | 'frost'
  | 'speaker'
  | 'pump';

const SIMPLE_PARTS: ReadonlySet<string> = new Set([
  'screen', 'glow', 'bulb', 'flame', 'water', 'door', 'canvas', 'flag', 'broken', 'frost', 'speaker', 'pump',
]);
const SERVING_RE = /^serving_([0-3])$/;

export function partKindOf(name: string): PartKind | null {
  if (SIMPLE_PARTS.has(name)) return name as PartKind;
  if (SERVING_RE.test(name)) return 'serving';
  return null;
}

interface MatSlot {
  mesh: THREE.Mesh;
  base: THREE.Material;
  variants: (THREE.Material | undefined)[];
  applied: THREE.Material;
  /** Someone else (e.g. the renderer's window glow) replaced the material: leave it alone. */
  external: boolean;
}

interface Part {
  kind: PartKind;
  node: THREE.Object3D;
  extras: Record<string, unknown>;
  slots: MatSlot[];
  kids: THREE.Object3D[];
  kidScale: THREE.Vector3[];
  basePos: THREE.Vector3;
  baseQuat: THREE.Quaternion;
  index: number;
  anim: number;
  level: number;
  visible: boolean | null;
  phase: number;
}

export interface InstanceRig {
  id: string;
  parts: Part[];
  paint: MatSlot[];
  tint: string | null;
  dirtLevel: number;
  lastT: number;
  phase: number;
  /** Placeholder instances have no dynamic parts but still take tint/dirt. */
  placeholder: boolean;
}

export const DEFAULT_VISUAL_STATE: Readonly<ObjectVisualState> = Object.freeze({
  powered: true,
  inUse: false,
  broken: false,
  lit: false,
  servings: 4,
  progress: 0,
  flag: false,
  dirt: 0,
  burning: false,
});

const AX_X = new THREE.Vector3(1, 0, 0);
const AX_Y = new THREE.Vector3(0, 1, 0);
const AX_Z = new THREE.Vector3(0, 0, 1);
const TMP_Q = new THREE.Quaternion();
const TAU = Math.PI * 2;

let phaseSeq = 0;
function nextPhase(): number {
  phaseSeq = (phaseSeq + 1) % 100000;
  return ((phaseSeq * 0.6180339887) % 1) * TAU;
}

function axisOf(v: unknown): THREE.Vector3 {
  return v === 'y' ? AX_Y : v === 'z' ? AX_Z : AX_X;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function slotFor(mesh: THREE.Mesh): MatSlot | null {
  const mat = mesh.material;
  if (!mat || Array.isArray(mat)) return null;
  return { mesh, base: mat, variants: [], applied: mat, external: false };
}

/** Collect meshes under `root` (inclusive) without descending into nodes accepted by `stop`. */
function meshesUnder(root: THREE.Object3D, stop: (o: THREE.Object3D) => boolean, out: THREE.Mesh[]): void {
  const m = root as THREE.Mesh;
  if (m.isMesh) out.push(m);
  for (const c of root.children) if (!stop(c)) meshesUnder(c, stop, out);
}

function isPartNode(o: THREE.Object3D): boolean {
  return partKindOf(o.name) !== null;
}

export function bindInstance(root: THREE.Object3D, id: string, tint: string | null, placeholder: boolean): InstanceRig {
  const rig: InstanceRig = { id, parts: [], paint: [], tint, dirtLevel: -1, lastT: NaN, phase: nextPhase(), placeholder };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const mat = mesh.material;
      if (mat && !Array.isArray(mat) && mat.name === 'Paint') {
        const s = slotFor(mesh);
        if (s) rig.paint.push(s);
      }
    }
    const kind = partKindOf(o.name);
    if (!kind) return;
    const extras = (o.userData && typeof o.userData === 'object' ? o.userData : {}) as Record<string, unknown>;
    const part: Part = {
      kind,
      node: o,
      extras,
      slots: [],
      kids: [],
      kidScale: [],
      basePos: o.position.clone(),
      baseQuat: o.quaternion.clone(),
      index: 0,
      anim: 0,
      level: -1,
      visible: null,
      phase: rig.phase + rig.parts.length * 1.7,
    };
    if (kind === 'serving') part.index = Number(SERVING_RE.exec(o.name)?.[1] ?? 0);
    if (kind === 'screen' || kind === 'glow' || kind === 'bulb' || kind === 'flame' || kind === 'canvas') {
      const meshes: THREE.Mesh[] = [];
      meshesUnder(o, (c) => c !== o && (isPartNode(c) || c.name.startsWith('canvas_stroke')), meshes);
      for (const me of meshes) {
        if (kind !== 'canvas' && !hasEmissive(me.material as THREE.Material)) continue;
        if (kind === 'canvas' && (me.material as THREE.Material)?.name !== 'CanvasBlank') continue;
        const s = slotFor(me);
        if (s) part.slots.push(s);
      }
    }
    if (kind === 'flame' || kind === 'speaker' || kind === 'broken') {
      const kids = o.children.length > 0 ? o.children : [o];
      for (const k of kids) {
        part.kids.push(k);
        part.kidScale.push(k.scale.clone());
      }
    } else if (kind === 'canvas') {
      for (const c of o.children) {
        if (c.name.startsWith('canvas_stroke')) part.kids.push(c);
      }
      part.kids.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    }
    rig.parts.push(part);
  });
  return rig;
}

// ───────────────────────────── per-frame application ─────────────────────────────

function setVisible(p: Part, v: boolean): void {
  if (p.visible === v) return;
  p.visible = v;
  p.node.visible = v;
}

function setLevel(p: Part, level: number, variants: MaterialVariants, canvas = false): void {
  if (p.level === level) return;
  p.level = level;
  for (const s of p.slots) {
    if (s.external) continue;
    if (s.mesh.material !== s.applied) {
      s.external = true;
      continue;
    }
    let m = s.variants[level];
    if (!m) {
      m = canvas ? variants.canvas(s.base, level) : variants.emissive(s.base, level);
      s.variants[level] = m;
    }
    s.mesh.material = m;
    s.applied = m;
  }
}

function toLevel(f: number): number {
  const l = Math.round(f * EMISSIVE_LEVELS);
  return l < 0 ? 0 : l > EMISSIVE_LEVELS ? EMISSIVE_LEVELS : l;
}

/** Cheap deterministic hash noise in [0,1). */
function hash1(x: number): number {
  const s = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function flickerScreen(t: number, ph: number, mode: unknown): number {
  if (mode === 'pulse') return 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(t * 4.2 + ph));
  const roll = hash1(Math.floor(t * 9) + ph) < 0.06 ? 0.55 : 1;
  return (0.84 + 0.08 * Math.sin(t * 23 + ph) + 0.08 * Math.sin(t * 7.3 + ph * 2)) * roll;
}

function flickerFlame(t: number, ph: number): number {
  return 0.78 + 0.12 * Math.sin(t * 11 + ph) + 0.1 * Math.sin(t * 17.3 + ph * 1.7);
}

function approach(cur: number, target: number, rate: number, dt: number): number {
  const d = target - cur;
  const step = rate * dt;
  if (Math.abs(d) <= step) return target;
  return cur + Math.sign(d) * step;
}

function ease(x: number): number {
  return x * x * (3 - 2 * x);
}

function applyPart(p: Part, s: ObjectVisualState, t: number, dt: number, variants: MaterialVariants): void {
  const ph = p.phase;
  const ex = p.extras;
  switch (p.kind) {
    case 'screen': {
      const on = s.inUse && s.powered && !s.broken;
      setLevel(p, on ? toLevel(flickerScreen(t, ph, ex.flicker)) : 0, variants);
      return;
    }
    case 'glow': {
      const on = s.powered && (ex.on !== 'inUse' || s.inUse);
      const mode = ex.flicker;
      let f = 1;
      let show = true;
      if (on) {
        if (mode === 'bubble') f = 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(t * 2.1 + ph));
        else if (mode === 'blink') f = Math.sin(t * 3.0 + ph) > -0.3 ? 1 : 0.3;
        else if (mode === 'pulse') f = 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(t * 1.3 + ph));
        else if (mode === 'buzz') f = hash1(Math.floor(t * 20) + ph) < 0.05 ? 1 : 0.8 + 0.1 * Math.sin(t * 40 + ph);
        else if (mode === 'crackle') {
          show = hash1(Math.floor(t * 14) + ph) > 0.3;
          f = 0.7 + 0.3 * hash1(Math.floor(t * 31) + ph * 3);
        } else if (mode === 'float') f = 0.75 + 0.25 * Math.sin(t * 2.3 + ph);
      }
      if (mode === 'crackle' || mode === 'float') setVisible(p, on && show);
      if (mode === 'float') p.node.position.y = p.basePos.y + (on ? 0.025 * Math.sin(t * 1.4 + ph) : 0);
      setLevel(p, on ? toLevel(f) : 0, variants);
      return;
    }
    case 'bulb': {
      const on = s.lit && s.powered;
      let f = 1;
      if (on && ex.flicker === 'candle') f = 0.86 + 0.14 * flickerFlame(t, ph);
      setLevel(p, on ? toLevel(f) : 0, variants);
      return;
    }
    case 'flame': {
      const on = ex.alwaysOn === true || (ex.on === 'inUse' ? s.inUse && s.powered : s.lit);
      setVisible(p, on || ex.keepVisible === true);
      const scaleWobble = ex.flicker !== 'intensity';
      for (let i = 0; i < p.kids.length; i++) {
        const k = p.kids[i];
        const b = p.kidScale[i];
        if (on && scaleWobble) {
          const w = Math.sin(t * 13 + ph + i * 2.1) * 0.5 + Math.sin(t * 7.7 + ph * 1.3 + i) * 0.5;
          k.scale.set(b.x * (1 + 0.06 * w), b.y * (1 + 0.16 * w), b.z * (1 - 0.05 * w));
        } else {
          k.scale.copy(b);
        }
      }
      setLevel(p, on ? toLevel(flickerFlame(t, ph)) : 0, variants);
      return;
    }
    case 'water':
      setVisible(p, s.inUse);
      return;
    case 'frost':
      setVisible(p, s.powered);
      return;
    case 'serving':
      setVisible(p, p.index < s.servings);
      return;
    case 'door': {
      p.anim = approach(p.anim, s.inUse ? 1 : 0, 2.6, dt);
      const ang = num(ex.openAngle, -1.6) * ease(p.anim);
      p.node.quaternion.copy(p.baseQuat).multiply(TMP_Q.setFromAxisAngle(AX_Y, ang));
      return;
    }
    case 'flag': {
      p.anim = approach(p.anim, s.flag ? 1 : 0, 3.0, dt);
      const ang = num(ex.upAngle, Math.PI / 2) * ease(p.anim);
      p.node.quaternion.copy(p.baseQuat).multiply(TMP_Q.setFromAxisAngle(axisOf(ex.axis), ang));
      return;
    }
    case 'pump': {
      p.anim = approach(p.anim, s.inUse ? 1 : 0, 2.0, dt);
      const amp = num(ex.amp, 0.06);
      const rate = num(ex.rate, 1.2);
      const off = amp * p.anim * 0.5 * (1 - Math.cos(TAU * rate * t + ph));
      p.node.position.copy(p.basePos);
      const ax = axisOf(ex.axis === undefined ? 'y' : ex.axis);
      p.node.position.addScaledVector(ax, off);
      return;
    }
    case 'speaker': {
      const on = s.inUse && s.powered;
      const beat = on ? Math.pow(Math.abs(Math.sin(Math.PI * 2 * t + ph)), 6) : 0;
      for (let i = 0; i < p.kids.length; i++) {
        const b = p.kidScale[i];
        const k = 1 + 0.12 * beat * (i === 0 ? 1 : 0.8);
        p.kids[i].scale.set(b.x * k, b.y * k, b.z * k);
      }
      return;
    }
    case 'broken': {
      setVisible(p, s.broken);
      if (s.broken) {
        const jx = (hash1(Math.floor(t * 24) + ph) - 0.5) * 0.012;
        const jz = (hash1(Math.floor(t * 24) + ph + 7) - 0.5) * 0.012;
        p.node.position.set(p.basePos.x + jx, p.basePos.y + 0.01 * Math.sin(t * 3 + ph), p.basePos.z + jz);
        for (let i = 0; i < p.kids.length; i++) {
          const b = p.kidScale[i];
          const k = 1 + 0.12 * Math.sin(t * 2.4 + ph + i * 1.3);
          p.kids[i].scale.set(b.x * k, b.y * k, b.z * k);
        }
      }
      return;
    }
    case 'canvas': {
      const prog = ex.finished === true ? 1 : s.progress;
      setLevel(p, Math.round(prog * CANVAS_LEVELS), variants, true);
      const n = p.kids.length;
      for (let i = 0; i < n; i++) {
        const v = ex.finished === true || prog >= (i + 1) / (n + 1);
        if (p.kids[i].visible !== v) p.kids[i].visible = v;
      }
      return;
    }
  }
}

function clamp01(v: number): number {
  return v > 0 ? (v < 1 ? v : 1) : 0;
}

/** Sanitise an incoming state into `out` (tolerates NaN/undefined fields from buggy callers). */
export function sanitizeState(s: Partial<ObjectVisualState> | null | undefined, out: ObjectVisualState): ObjectVisualState {
  const src = s ?? DEFAULT_VISUAL_STATE;
  out.powered = src.powered !== false;
  out.inUse = src.inUse === true;
  out.broken = src.broken === true;
  out.lit = src.lit === true;
  const sv = typeof src.servings === 'number' && Number.isFinite(src.servings) ? Math.floor(src.servings) : 0;
  out.servings = sv < 0 ? 0 : sv > 4 ? 4 : sv;
  out.progress = typeof src.progress === 'number' && Number.isFinite(src.progress) ? clamp01(src.progress) : 0;
  out.flag = src.flag === true;
  out.dirt = typeof src.dirt === 'number' && Number.isFinite(src.dirt) ? clamp01(src.dirt) : 0;
  out.burning = src.burning === true;
  return out;
}

export function applyState(rig: InstanceRig, s: ObjectVisualState, timeSec: number, variants: MaterialVariants): void {
  const t = Number.isFinite(timeSec) ? timeSec : Number.isFinite(rig.lastT) ? rig.lastT : 0;
  let dt = Number.isFinite(rig.lastT) ? t - rig.lastT : 0;
  if (!(dt > 0)) dt = 0;
  if (dt > 0.25) dt = 0.25;
  rig.lastT = t;
  const dirt = s.burning ? DIRT_LEVELS : Math.round(s.dirt * DIRT_LEVELS);
  if (dirt !== rig.dirtLevel) {
    rig.dirtLevel = dirt;
    for (const slot of rig.paint) {
      if (slot.external) continue;
      if (slot.mesh.material !== slot.applied) {
        slot.external = true;
        continue;
      }
      let m = slot.variants[dirt];
      if (!m) {
        m = variants.paint(slot.base, rig.tint, dirt);
        slot.variants[dirt] = m;
      }
      slot.mesh.material = m;
      slot.applied = m;
    }
  }
  for (let i = 0; i < rig.parts.length; i++) applyPart(rig.parts[i], s, t, dt, variants);
}

/** Jump animated parts (doors, flags, pumps) straight to their targets (e.g. right after creation). */
export function settleAnimations(rig: InstanceRig, s: ObjectVisualState): void {
  for (const p of rig.parts) {
    if (p.kind === 'door') p.anim = s.inUse ? 1 : 0;
    else if (p.kind === 'flag') p.anim = s.flag ? 1 : 0;
    else if (p.kind === 'pump') p.anim = s.inUse ? 1 : 0;
  }
}
