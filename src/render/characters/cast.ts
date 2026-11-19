/**
 * CAST BODIES runtime library (shared/cast.ts contract): lazy-loads public/assets/models/characters/cast/<id>.glb
 * (+ optional public/assets/manifest.cast.json metadata), prepares one immutable CastTemplate per body, and
 * ref-counts it across rigs. Unreferenced templates stay warm in a small LRU (CAZ browsing flips bodies quickly),
 * older ones are disposed (geometry, textures, source materials, skeleton). Nothing here throws or rejects:
 * a body that cannot be loaded is reported once and `request()` resolves to null (the rig keeps the classic body).
 *
 * Animation binding: clips baked into the cast GLB (same names as ANIM_STATES / EXTRA_ANIM_STATES) win; any clip the GLB does not bake
 * is retargeted from zombie.glb by bone name (rest-relative rotations, pelvis translation scaled by the pelvis
 * height ratio; seat contact stays at SEAT_HEIGHT for sit* clips). Tracks for bones the body does not have are
 * dropped so three.js never warns about unbound tracks.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ANIM_STATES, EXTRA_ANIM_STATES, isExtraAnimState } from '../../shared/appearance';
import type { AnyAnimState } from '../../shared/appearance';
import { CAST_BODY_IDS, castBody, isCastBodyId } from '../../shared/cast';
import type { CastBodyDef, CastBodyId } from '../../shared/cast';
import { PREMIUM_BODY_IDS, isPremiumBodyId, premiumGlbPath, type PremiumDetail } from '../../shared/premiumBodies';
import { DIM } from '../../shared/dimensions';
import { parseCarryAnchors } from './anchors';
import type { CarryAnchor } from './anchors';
import { stripClip } from './clips';
import { HELD_PROP_RULES, prepareHeldProps } from './heldProps';
import type { HeldPropBinding } from './heldProps';
import { BONE_NAMES } from './names';
import { SEATED_ANIMS, SEAT_CONTACT_HEIGHT } from './plan';
import type { RigTemplate } from './rig';

export const CAST_MANIFEST = 'manifest.cast.json';
export const PREMIUM_MANIFEST = 'manifest.premium.json';
/** Conventional GLB path of a body (premium bodies: the file of `detail`). */
export const castGlbPath = (id: CastBodyId, detail: PremiumDetail = 'high'): string =>
  isPremiumBodyId(id) ? premiumGlbPath(id, detail) : `models/characters/cast/${id}.glb`;
/** Unreferenced templates kept warm (CAZ browsing / a zombie switching back) before the oldest is disposed. */
export const CAST_IDLE_KEEP = 3;
/** Head-top anchor clearance above the body's standing height (bubbles / plumbobs float just above the hat). */
export const CAST_HEAD_CLEARANCE = 0.06;

export interface CastManifestEntry {
  id: CastBodyId;
  /** GLB path relative to the assets base url. */
  file: string;
  /** Standing height the GLB is normalised to (defaults to CastBodyDef.height). */
  height: number;
  /** Material name whose colour follows appearance.eyeColor + a subtle per-expression tint (null = none). */
  eyeMaterial: string | null;
  /** Stump-cap tint ('#rrggbb'); null = sampled from the body material. */
  skinColor: string | null;
  /**
   * Shared-clip pelvis rule (docs/contract-requests/cast.md §2): per-body values; null = not in the manifest (the
   * GLB's Rig extras are used, then measured / neutral defaults).
   */
  pelvisRest: [number, number, number] | null;
  /** Scale of the zombie pelvis motion around its rest (null = cast / zombie pelvis rest height ratio). */
  pelvisScale: number | null;
  /** Added to the (absolute) pelvis of sit* clips. */
  seatPelvisOffset: [number, number, number] | null;
  /** Added to lying keys (weight lyingWeight(p.y)). */
  lyingOffset: [number, number, number] | null;
  /** Degrees the thighs are raised in the sit* clips so a long-legged body keeps its feet on the floor (null = 0). */
  sitThighLift: number | null;
  /** Per sit clip override of sitThighLift (degrees); null = none. Clips not listed use sitThighLift. */
  sitThighLiftByClip: Readonly<Record<string, number>> | null;
  /** Rest skull / headwear top (m); null = GLB extras / measured. */
  headTop: number | null;
  /** Per-body carry anchors (zombie.glb carryAnchors schema), raw; null = GLB extras / zombie.glb's. */
  carryAnchors: unknown;
  /** Manifest-level constants of the rule (shared by every body). */
  rule: PelvisRule;
}

export interface PelvisRule {
  /** P0: zombie.glb pelvis rest (null = read from the loaded zombie.glb). */
  zombiePelvisRest: [number, number, number] | null;
  sitClips: ReadonlySet<string>;
  lyingY0: number;
  lyingSpan: number;
}

export const DEFAULT_PELVIS_RULE: PelvisRule = {
  zombiePelvisRest: null,
  sitClips: SEATED_ANIMS as ReadonlySet<string>,
  lyingY0: 0.25,
  lyingSpan: 0.14,
};

/** Parse manifest.pelvisRule; anything malformed keeps the default (identical to the build's constants). */
export function parsePelvisRule(raw: unknown): PelvisRule {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const zp = vec3(r.zombiePelvisRest, 2.5);
  const sit = Array.isArray(r.sitClips) ? r.sitClips.filter((x): x is string => typeof x === 'string' && (ANIM_STATES as readonly string[]).includes(x)) : null;
  const y0 = typeof r.lyingY0 === 'number' && Number.isFinite(r.lyingY0) && r.lyingY0 > 0 && r.lyingY0 < 1 ? r.lyingY0 : DEFAULT_PELVIS_RULE.lyingY0;
  const span = typeof r.lyingSpan === 'number' && Number.isFinite(r.lyingSpan) && r.lyingSpan > 0.01 && r.lyingSpan < 1 ? r.lyingSpan : DEFAULT_PELVIS_RULE.lyingSpan;
  return { zombiePelvisRest: zp, sitClips: sit && sit.length ? new Set(sit) : DEFAULT_PELVIS_RULE.sitClips, lyingY0: y0, lyingSpan: span };
}

const FILE_RE = /^[A-Za-z0-9_\-/]{1,96}\.glb$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const NAME_RE = /^[A-Za-z0-9_.\- ]{1,64}$/;

function vec3(v: unknown, max = 1): [number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < max)) return null;
  return [v[0], v[1], v[2]];
}

function entryFrom(id: CastBodyId, raw: Record<string, unknown> | null, rule: PelvisRule = DEFAULT_PELVIS_RULE, detail: PremiumDetail = 'high'): CastManifestEntry {
  const def = castBody(id);
  const r = raw ?? {};
  const file = typeof r.file === 'string' && FILE_RE.test(r.file) && !r.file.includes('..') && !r.file.startsWith('/')
    ? r.file.replace(/^assets\//, '') : castGlbPath(id, detail);
  const h = typeof r.height === 'number' && Number.isFinite(r.height) && r.height > 1 && r.height < DIM.DOOR_HEIGHT ? r.height : def.height;
  const eyeRaw = r.eyeMaterial ?? r.eye_material ?? (r.eye as Record<string, unknown> | undefined)?.material ?? null;
  const eyeMaterial = typeof eyeRaw === 'string' && NAME_RE.test(eyeRaw) ? eyeRaw : null;
  const skin = r.skinColor ?? r.skin_color ?? r.stumpColor;
  const skinColor = typeof skin === 'string' && HEX_RE.test(skin) ? skin.toLowerCase() : null;
  const p = pelvisFields(r);
  return { id, file, height: h, eyeMaterial, skinColor, ...p, carryAnchors: r.carryAnchors ?? null, rule };
}

/** Largest thigh lift the builder may ask for (tools/blender/cast/lib/measure.py stops at 45). */
export const SIT_THIGH_LIFT_MAX = 45;

/**
 * Per-clip thigh lifts from a manifest entry or the Rig extras (object or its JSON text): only own keys that name a
 * clip (letters / digits, at most 32 characters) with a finite angle in [0, SIT_THIGH_LIFT_MAX] are kept; anything
 * else is dropped, and an input with no valid pair gives null.
 */
function liftByClip(v: unknown): Readonly<Record<string, number>> | null {
  const raw = typeof v === 'string' ? parseJson(v) : v;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, number> = Object.create(null) as Record<string, number>;
  let n = 0;
  for (const [k, x] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= 32 || !/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(k)) continue;
    if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > SIT_THIGH_LIFT_MAX) continue;
    out[k] = x;
    n++;
  }
  return n ? out : null;
}

/** Per-body pelvis / head fields from a manifest entry or the GLB's Rig extras (null = absent / invalid). */
function pelvisFields(r: Record<string, unknown>): Pick<CastManifestEntry, 'pelvisRest' | 'pelvisScale' | 'seatPelvisOffset' | 'lyingOffset' | 'sitThighLift' | 'sitThighLiftByClip' | 'headTop'> {
  const pv = (v: unknown, max: number) => vec3(typeof v === 'string' ? parseJson(v) : v, max);
  const num = (v: unknown, lo: number, hi: number) => {
    const n = typeof v === 'string' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) && n > lo && n < hi ? n : null;
  };
  return {
    pelvisRest: pv(r.pelvisRest, 2.5),
    pelvisScale: num(r.pelvisScale, 0.3, 3),
    seatPelvisOffset: pv(r.seatPelvisOffset, 0.5),
    lyingOffset: pv(r.lyingOffset, 0.5),
    sitThighLift: num(r.sitThighLift, -1e-9, SIT_THIGH_LIFT_MAX + 1e-9),
    sitThighLiftByClip: liftByClip(r.sitThighLiftByClip),
    headTop: num(r.headTop, 1, DIM.DOOR_HEIGHT),
  };
}

/**
 * Parse manifest.cast.json defensively. Accepted shapes: `{bodies: [{id, ...}]}`, `{bodies: {id: {...}}}`, a bare
 * array, or `{<id>: {...}}`. Unknown ids / malformed entries are ignored; bodies the manifest does not list still
 * get an entry with conventional defaults (the GLB path is tried anyway, a 404 just keeps the classic body).
 */
export function parseCastManifest(raw: unknown): Map<CastBodyId, CastManifestEntry> {
  const listed = new Map<CastBodyId, Record<string, unknown>>();
  const take = (id: unknown, v: unknown) => {
    if (isCastBodyId(id) && v && typeof v === 'object' && !Array.isArray(v)) listed.set(id, v as Record<string, unknown>);
  };
  let src: unknown = raw;
  if (src && typeof src === 'object' && !Array.isArray(src) && 'bodies' in (src as object)) src = (src as { bodies: unknown }).bodies;
  if (Array.isArray(src)) {
    for (const e of src) if (e && typeof e === 'object') take((e as { id?: unknown }).id, e);
  } else if (src && typeof src === 'object') {
    for (const [k, v] of Object.entries(src as Record<string, unknown>)) take(k, v);
  }
  const rule = parsePelvisRule(raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { pelvisRule?: unknown }).pelvisRule : null);
  const out = new Map<CastBodyId, CastManifestEntry>();
  for (const id of CAST_BODY_IDS) out.set(id, entryFrom(id, listed.get(id) ?? null, rule));
  return out;
}

export interface CastTemplate {
  readonly id: CastBodyId;
  readonly def: CastBodyDef;
  readonly entry: CastManifestEntry;
  /** Source scene (never added to a live scene; rigs SkeletonUtils.clone it). */
  readonly scene: THREE.Object3D;
  /** Clips by ANIM_STATE name: baked (from the GLB) or retargeted lazily from zombie.glb. */
  readonly clips: Map<string, THREE.AnimationClip>;
  readonly mirrored: Map<string, THREE.AnimationClip>;
  /** Names of the clips baked into the cast GLB (diagnostics / tests). */
  readonly baked: ReadonlySet<string>;
  readonly carryPose: Map<string, THREE.Quaternion>;
  readonly anchors: Map<string, CarryAnchor>;
  /** Bones present in the cast skeleton. */
  readonly boneNames: ReadonlySet<string>;
  /** Head-top anchor at rest, model space. */
  readonly headTopRest: THREE.Vector3;
  /** Stump cap tint (linear). */
  readonly tint: THREE.Color;
  /** Sculpted held props re-skinned to their own stowable bone (heldProps.ts, W-120); empty for most bodies. */
  readonly heldProps: readonly HeldPropBinding[];
  /** Resolve a clip (baked, else retargeted from zombie.glb), or null. */
  clip(name: AnyAnimState): THREE.AnimationClip | null;
}

function parseJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function parsePose(raw: unknown): Map<string, THREE.Quaternion> {
  const out = new Map<string, THREE.Quaternion>();
  const o = parseJson(raw);
  if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
  for (const [bone, q] of Object.entries(o as Record<string, unknown>)) {
    if (Array.isArray(q) && q.length === 4 && q.every((x) => typeof x === 'number' && Number.isFinite(x))) {
      out.set(bone, new THREE.Quaternion(q[0], q[1], q[2], q[3]).normalize());
    }
  }
  return out;
}

function trackNode(name: string): { node: string; prop: string } {
  const i = name.lastIndexOf('.');
  return i < 0 ? { node: name, prop: '' } : { node: name.slice(0, i), prop: name.slice(i + 1) };
}

/** Keep only tracks whose node exists in the cast skeleton (unbound tracks make three.js warn every bind). */
export function filterClip(clip: THREE.AnimationClip, bones: ReadonlySet<string>): THREE.AnimationClip {
  const tracks = clip.tracks.filter((t) => bones.has(trackNode(t.name).node));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

export interface RetargetInfo {
  /** Rest local rotation of each bone in the cast skeleton / in zombie.glb. */
  castRest: ReadonlyMap<string, THREE.Quaternion>;
  zombieRest: ReadonlyMap<string, THREE.Quaternion>;
  /** Zombie pelvis rest (P0) and cast pelvis rest (Pc), rig-root space. */
  zombiePelvis: readonly [number, number, number];
  castPelvis: readonly [number, number, number];
  /** Pelvis motion scale around the rest (s). */
  pelvisScale: number;
  seatPelvisOffset: readonly [number, number, number];
  lyingOffset: readonly [number, number, number];
  /**
   * Degrees the thighs are raised in the manifest's sit clips (the builder's knee lift for long legs): thigh_L/R
   * q -> qx(-deg) * q about the pelvis-local X axis. 0 / absent = clips play as authored.
   */
  sitThighLift?: number;
  /** Per sit clip override of sitThighLift (degrees). */
  sitThighLiftByClip?: Readonly<Record<string, number>> | null;
  /** Clips whose pelvis is absolute (seat contact); default SEATED_ANIMS. */
  sitClips?: ReadonlySet<string>;
  lyingY0?: number;
  lyingSpan?: number;
}

/** Weight of the lying offset for a pelvis key at height y (1 lying, 0 upright / kneeling). */
export function lyingWeight(y: number, y0 = DEFAULT_PELVIS_RULE.lyingY0, span = DEFAULT_PELVIS_RULE.lyingSpan): number {
  return Math.min(1, Math.max(0, (y0 - y) / span));
}

/**
 * Retarget a (stripped) zombie.glb clip onto a cast skeleton with the same bone names (the shared-clip rule of
 * docs/contract-requests/cast.md): rotations relative to each skeleton's rest (q' = castRest * zombieRest^-1 * q,
 * a no-op for the built bodies whose rests equal zombie.glb's); pelvis translation
 *   seat clips : p' = p + seatPelvisOffset           (seat contact stays at SEAT_HEIGHT / the saddle height)
 *   others     : p' = Pc + (p - P0) * s + lyingOffset * w(p.y)
 * and, in the manifest's sit clips only, thigh_L/R raised by sitThighLift (q' = qx(-lift) * q).
 * Tracks for bones the body lacks are dropped.
 */
export function retargetClip(clip: THREE.AnimationClip, info: RetargetInfo, bones: ReadonlySet<string>): THREE.AnimationClip {
  // the manifest's sitClips names core clips only (parsePelvisRule admits ANIM_STATES); seat-contact extras
  // (drive, row, playKeys at the chair seat; bike / moped / swing saddles) always take the seat rule (W-056)
  const seated = (info.sitClips ?? DEFAULT_PELVIS_RULE.sitClips).has(clip.name)
    || (isExtraAnimState(clip.name) && SEAT_CONTACT_HEIGHT.has(clip.name));
  const y0 = info.lyingY0 ?? DEFAULT_PELVIS_RULE.lyingY0;
  const span = info.lyingSpan ?? DEFAULT_PELVIS_RULE.lyingSpan;
  const tracks: THREE.KeyframeTrack[] = [];
  const q = new THREE.Quaternion();
  const d = new THREE.Quaternion();
  const s = info.pelvisScale;
  const P0 = info.zombiePelvis;
  const Pc = info.castPelvis;
  const so = info.seatPelvisOffset;
  const lo = info.lyingOffset;
  const perClip = info.sitThighLiftByClip;
  const ownLift = perClip && Object.prototype.hasOwnProperty.call(perClip, clip.name) ? perClip[clip.name] : info.sitThighLift;
  const liftDeg = (info.sitClips ?? DEFAULT_PELVIS_RULE.sitClips).has(clip.name) ? (ownLift ?? 0) : 0;
  const lift = Number.isFinite(liftDeg) && liftDeg > 0
    ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (-Math.min(liftDeg, SIT_THIGH_LIFT_MAX) * Math.PI) / 180)
    : null;
  for (const t of clip.tracks) {
    const { node, prop } = trackNode(t.name);
    if (!bones.has(node)) continue;
    const values = Float32Array.from(t.values as ArrayLike<number>);
    if (prop === 'quaternion') {
      const cr = info.castRest.get(node);
      const zr = info.zombieRest.get(node);
      const rebase = cr && zr && Math.abs(cr.dot(zr)) < 1 - 1e-7;
      const raise = lift !== null && (node === 'thigh_L' || node === 'thigh_R');
      if (rebase || raise) {
        if (rebase) d.copy(zr).invert().premultiply(cr); // castRest * zombieRest^-1
        for (let i = 0; i < values.length; i += 4) {
          q.set(values[i], values[i + 1], values[i + 2], values[i + 3]);
          if (rebase) q.premultiply(d);
          if (raise) q.premultiply(lift);
          q.normalize();
          values[i] = q.x;
          values[i + 1] = q.y;
          values[i + 2] = q.z;
          values[i + 3] = q.w;
        }
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(t.name, Array.from(t.times), Array.from(values)));
    } else if (prop === 'position') {
      for (let i = 0; i < values.length; i += 3) {
        if (seated) {
          values[i] += so[0];
          values[i + 1] += so[1];
          values[i + 2] += so[2];
        } else {
          const w = lyingWeight(values[i + 1], y0, span);
          for (let a = 0; a < 3; a++) values[i + a] = Pc[a] + (values[i + a] - P0[a]) * s + lo[a] * w;
        }
      }
      tracks.push(new THREE.VectorKeyframeTrack(t.name, Array.from(t.times), Array.from(values)));
    } else {
      tracks.push(t.clone());
    }
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

function textureOf(m: THREE.Material): THREE.Texture | null {
  const map = (m as THREE.MeshStandardMaterial).map;
  return map && map.isTexture ? map : null;
}

/** Average colour of a texture image (browser only; null when the image is not readable). */
function averageTextureColor(tex: THREE.Texture | null): THREE.Color | null {
  try {
    const img = tex?.image as (CanvasImageSource & { width?: number; height?: number }) | undefined;
    if (!img || !img.width || !img.height) return null;
    const make = typeof OffscreenCanvas === 'function'
      ? () => new OffscreenCanvas(8, 8)
      : typeof document !== 'undefined'
        ? () => Object.assign(document.createElement('canvas'), { width: 8, height: 8 })
        : null;
    if (!make) return null;
    const c = make();
    const g = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!g) return null;
    g.drawImage(img, 0, 0, 8, 8);
    const px = g.getImageData(0, 0, 8, 8).data;
    let r = 0;
    let gr = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      r += px[i];
      gr += px[i + 1];
      b += px[i + 2];
      n++;
    }
    if (!n) return null;
    return new THREE.Color().setRGB(r / n / 255, gr / n / 255, b / n / 255, THREE.SRGBColorSpace);
  } catch {
    return null;
  }
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  const m = mesh.material as THREE.Material | THREE.Material[];
  return Array.isArray(m) ? m : m ? [m] : [];
}

/** Every texture referenced by a material (any slot). */
export function texturesOf(m: THREE.Material): THREE.Texture[] {
  const out: THREE.Texture[] = [];
  for (const v of Object.values(m as unknown as Record<string, unknown>)) {
    if (v && typeof v === 'object' && (v as THREE.Texture).isTexture) out.push(v as THREE.Texture);
  }
  return out;
}

/** Release everything a parsed cast glTF owns (geometry, materials, textures, skeletons), each exactly once. */
export function disposeCastScene(scene: THREE.Object3D | null | undefined): void {
  const done = new Set<{ dispose(): void }>();
  const once = (x: { dispose(): void } | null | undefined) => {
    if (!x || done.has(x)) return;
    done.add(x);
    try {
      x.dispose();
    } catch {
      /* already gone */
    }
  };
  scene?.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    once(m.geometry);
    for (const mat of materialsOf(m)) {
      for (const t of texturesOf(mat)) once(t);
      once(mat);
    }
    if (m.isSkinnedMesh) once(m.skeleton);
  });
}

/**
 * Build the immutable template for one cast body from its parsed glTF. Throws when the asset is structurally
 * unusable (no skinned mesh, no pelvis/head bones); the library then reports the body as failed.
 */
export function prepareCastTemplate(id: CastBodyId, gltf: GLTF, entry: CastManifestEntry, classic: RigTemplate | null): CastTemplate {
  const scene = gltf.scene;
  if (!scene) throw new Error(`cast ${id}: no scene`);
  scene.updateMatrixWorld(true);
  let body: THREE.SkinnedMesh | null = null;
  scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    if (!body || m.name === 'Body') body = m;
  });
  const bodyMesh = body as THREE.SkinnedMesh | null;
  if (!bodyMesh) throw new Error(`cast ${id}: no skinned mesh`);
  const boneNames = new Set<string>();
  for (const b of bodyMesh.skeleton.bones) boneNames.add(b.name);
  for (const n of BONE_NAMES) if (scene.getObjectByName(n)) boneNames.add(n);
  for (const req of ['pelvis', 'head']) if (!boneNames.has(req)) throw new Error(`cast ${id}: no ${req} bone`);
  // GLB extras on the armature ('Rig': castBody, pelvisRest, pelvisScale, seatPelvisOffset, lyingOffset, headTop
  // and optionally carryPose / carryAnchors): the fallback for every per-body value the manifest does not give
  let extras: Record<string, unknown> = {};
  const rigNode = scene.getObjectByName('Rig');
  if (rigNode?.userData && Object.keys(rigNode.userData).length) extras = rigNode.userData;
  else {
    scene.traverse((o) => {
      const u = o.userData;
      if (u && (u.pelvisRest !== undefined || u.carryPose !== undefined || u.carryAnchors !== undefined)) extras = u;
    });
  }
  const own = pelvisFields(extras);
  const castRest = new Map<string, THREE.Quaternion>();
  for (const n of boneNames) {
    const b = scene.getObjectByName(n);
    if (b) castRest.set(n, b.quaternion.clone());
  }
  const zombieRest = new Map<string, THREE.Quaternion>();
  let zPelvis: [number, number, number] = entry.rule.zombiePelvisRest ?? [0, 0.66, 0];
  if (classic) {
    for (const n of BONE_NAMES) {
      const b = classic.scene.getObjectByName(n);
      if (b) zombieRest.set(n, b.quaternion.clone());
    }
    const zp = classic.scene.getObjectByName('pelvis');
    if (zp && !entry.rule.zombiePelvisRest) zPelvis = [zp.position.x, zp.position.y, zp.position.z];
  }
  const pelvis = scene.getObjectByName('pelvis')!;
  const cPelvis: [number, number, number] = entry.pelvisRest ?? own.pelvisRest ?? [pelvis.position.x, pelvis.position.y, pelvis.position.z];
  const ratio = zPelvis[1] > 0.2 && cPelvis[1] > 0.2 ? cPelvis[1] / zPelvis[1] : 1;
  const info: RetargetInfo = {
    castRest, zombieRest, zombiePelvis: zPelvis, castPelvis: cPelvis,
    pelvisScale: entry.pelvisScale ?? own.pelvisScale ?? (ratio > 0.3 && ratio < 3 ? ratio : 1),
    seatPelvisOffset: entry.seatPelvisOffset ?? own.seatPelvisOffset ?? [0, 0, 0],
    lyingOffset: entry.lyingOffset ?? own.lyingOffset ?? [0, 0, 0],
    sitThighLift: entry.sitThighLift ?? own.sitThighLift ?? 0,
    // the two lift fields travel together: a manifest that states the lift decides both (its table or none), and
    // only a manifest that is silent about the lift leaves them to the GLB's Rig extras
    sitThighLiftByClip: entry.sitThighLift !== null || entry.sitThighLiftByClip !== null ? entry.sitThighLiftByClip : own.sitThighLiftByClip,
    sitClips: entry.rule.sitClips, lyingY0: entry.rule.lyingY0, lyingSpan: entry.rule.lyingSpan,
  };
  const clips = new Map<string, THREE.AnimationClip>();
  const baked = new Set<string>();
  const states = new Set<string>([...ANIM_STATES, ...EXTRA_ANIM_STATES]);
  for (const c of gltf.animations ?? []) {
    if (!states.has(c.name)) continue;
    try {
      clips.set(c.name, filterClip(stripClip(c), boneNames));
      baked.add(c.name);
    } catch {
      /* malformed clip: retargeted from zombie.glb instead */
    }
  }
  const pose = parsePose(extras.carryPose);
  let carryPose: Map<string, THREE.Quaternion>;
  if (pose.size) carryPose = pose;
  else {
    carryPose = new Map();
    for (const [bone, q] of classic?.carryPose ?? []) {
      const cr = castRest.get(bone);
      const zr = zombieRest.get(bone);
      carryPose.set(bone, cr && zr ? zr.clone().invert().premultiply(cr).multiply(q) : q.clone());
    }
  }
  // carry anchors: per body (manifest, scaled to this body's hands), else GLB extras, else zombie.glb's
  const manifestAnchors = parseCarryAnchors(entry.carryAnchors);
  const ownAnchors = manifestAnchors.size ? manifestAnchors : parseCarryAnchors(extras.carryAnchors);
  const anchors = ownAnchors.size ? ownAnchors : new Map(classic?.anchors ?? []);
  // head top: manifest / Rig extras headTop, else the measured top of the rest mesh, else the contract height
  let top = entry.headTop ?? own.headTop ?? entry.height;
  if (entry.headTop === null && own.headTop === null) {
    try {
      const g = bodyMesh.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox!.clone().applyMatrix4(bodyMesh.matrixWorld);
      if (Number.isFinite(bb.max.y) && bb.max.y > 1.2 && bb.max.y < DIM.DOOR_HEIGHT) top = bb.max.y;
    } catch {
      /* keep the contract height */
    }
  }
  const head = scene.getObjectByName('head')!;
  const hp = head.getWorldPosition(new THREE.Vector3());
  const headTopRest = new THREE.Vector3(hp.x, top + CAST_HEAD_CLEARANCE, hp.z);
  // stump tint: manifest, else body material colour x average texture colour
  const tint = new THREE.Color('#8f9a7a');
  if (entry.skinColor) tint.set(entry.skinColor);
  else {
    const mats = materialsOf(bodyMesh);
    const skin = mats.find((m) => /skin|flesh|body/i.test(m.name)) ?? mats[0];
    const base = (skin as THREE.MeshStandardMaterial | undefined)?.color;
    const avg = skin ? averageTextureColor(textureOf(skin)) : null;
    if (base) tint.copy(base);
    if (avg) tint.multiply(avg);
  }
  // held props (W-120): measured on the rest pose, after every other rest measurement
  let heldProps: HeldPropBinding[] = [];
  const rules = HELD_PROP_RULES[id];
  if (rules?.length) {
    try {
      heldProps = prepareHeldProps(scene, bodyMesh, rules);
    } catch {
      heldProps = []; // the prop stays on the hand
    }
  }
  const mirrored = new Map<string, THREE.AnimationClip>();
  const tpl: CastTemplate = {
    id, def: castBody(id), entry, scene, clips, mirrored, baked, carryPose, anchors, boneNames, headTopRest, tint, heldProps,
    clip(name: AnyAnimState): THREE.AnimationClip | null {
      const have = clips.get(name);
      if (have) return have;
      const src = classic?.clips.get(name);
      if (!src) return null;
      const c = retargetClip(src, info, boneNames);
      clips.set(name, c);
      return c;
    },
  };
  return tpl;
}

/**
 * Parse manifest.premium.json (tools/blender/cast/premium) defensively: one entry per premium body for the wanted
 * `detail`, taken from `bodies[].representations[detail]`. A body the manifest does not list, a missing
 * representation, an unknown id or a malformed entry gives the conventional path and defaults (same policy as
 * parseCastManifest: the file is tried anyway, a 404 keeps the classic body).
 */
export function parsePremiumManifest(raw: unknown, detail: PremiumDetail): Map<CastBodyId, CastManifestEntry> {
  const listed = new Map<CastBodyId, Record<string, unknown>>();
  const bodies = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { bodies?: unknown }).bodies : null;
  if (Array.isArray(bodies)) {
    for (const b of bodies) {
      if (!b || typeof b !== 'object') continue;
      const id = (b as { id?: unknown }).id;
      const reps = (b as { representations?: unknown }).representations;
      if (!isPremiumBodyId(id) || !reps || typeof reps !== 'object' || Array.isArray(reps)) continue;
      const rep = (reps as Record<string, unknown>)[detail];
      if (!rep || typeof rep !== 'object' || Array.isArray(rep)) continue;
      const file = (rep as { file?: unknown }).file;
      // a representation may only name its own file: a `low` entry pointing at the high GLB (or anywhere else) is ignored
      const own = file === premiumGlbPath(id, detail);
      listed.set(id, { ...(rep as Record<string, unknown>), file: own ? file : undefined, height: (b as { height?: unknown }).height });
    }
  }
  const rule = parsePelvisRule(raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { pelvisRule?: unknown }).pelvisRule : null);
  const out = new Map<CastBodyId, CastManifestEntry>();
  for (const id of PREMIUM_BODY_IDS) out.set(id, entryFrom(id, listed.get(id) ?? null, rule, detail));
  return out;
}

type EntryState = 'loading' | 'ready' | 'failed';

interface Entry {
  state: EntryState;
  tpl: CastTemplate | null;
  promise: Promise<CastTemplate | null>;
  refs: number;
}

export interface CastLibraryOptions {
  baseUrl: string;
  loadGlb: (url: string) => Promise<GLTF>;
  loadManifest: (url: string) => Promise<unknown>;
  /** zombie.glb template (shared clips / carry data), read when a body finishes loading. */
  classic: () => RigTemplate | null;
  /** Resolves when zombie.glb has loaded or failed (cast loads wait for it so shared clips are available). */
  after: Promise<unknown>;
  warn: (msg: string, err?: unknown) => void;
  /** Network reachability; a load that fails while offline is forgotten (retried later), not marked failed. */
  online?: () => boolean;
  /**
   * Which file a premium body loads (default 'high'). Read once per body when its load starts; a `high` file that
   * fails to load falls back to `low` before the body is marked failed.
   */
  premiumDetail?: () => PremiumDetail;
}

export interface CastLibraryStats {
  /** Bodies with a live template. */
  loaded: CastBodyId[];
  /** Bodies kept warm with no rig using them. */
  idle: CastBodyId[];
  refs: Partial<Record<CastBodyId, number>>;
  failed: CastBodyId[];
}

export class CastLibrary {
  private readonly entries = new Map<CastBodyId, Entry>();
  /** Unreferenced ready templates, oldest first. */
  private readonly idle = new Set<CastBodyId>();
  private manifest: Promise<Map<CastBodyId, CastManifestEntry>> | null = null;
  private premium: Promise<unknown> | null = null;
  private disposed = false;

  constructor(private readonly opts: CastLibraryOptions) {}

  private url(path: string): string {
    const b = this.opts.baseUrl;
    return (b.endsWith('/') ? b : b + '/') + path;
  }

  private loadManifest(): Promise<Map<CastBodyId, CastManifestEntry>> {
    if (!this.manifest) {
      this.manifest = (async () => {
        let raw: unknown = null;
        try {
          raw = await this.opts.loadManifest(this.url(CAST_MANIFEST));
        } catch (e) {
          this.opts.warn(`could not load ${CAST_MANIFEST}; cast bodies use conventional paths and defaults`, e);
        }
        return parseCastManifest(raw);
      })();
    }
    return this.manifest;
  }

  /** Entry of a premium body for `detail` (manifest.premium.json, fetched once; unreadable = conventional paths). */
  private async premiumEntry(id: CastBodyId, detail: PremiumDetail): Promise<CastManifestEntry> {
    if (!this.premium) {
      this.premium = (async () => {
        try {
          return await this.opts.loadManifest(this.url(PREMIUM_MANIFEST));
        } catch (e) {
          this.opts.warn(`could not load ${PREMIUM_MANIFEST}; premium bodies use conventional paths and defaults`, e);
          return null;
        }
      })();
    }
    return parsePremiumManifest(await this.premium, detail).get(id)!;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  state(id: CastBodyId): 'idle' | EntryState {
    return this.entries.get(id)?.state ?? 'idle';
  }

  /** The ready template, or null (not requested / loading / failed / evicted). */
  get(id: CastBodyId): CastTemplate | null {
    const e = this.entries.get(id);
    return e && e.state === 'ready' ? e.tpl : null;
  }

  /** Start (or join) loading a body; resolves to its template or null. Never rejects. */
  request(id: CastBodyId): Promise<CastTemplate | null> {
    if (this.disposed || !isCastBodyId(id)) return Promise.resolve(null);
    const have = this.entries.get(id);
    if (have) return have.promise;
    const entry: Entry = { state: 'loading', tpl: null, refs: 0, promise: Promise.resolve(null) };
    this.entries.set(id, entry);
    entry.promise = (async (): Promise<CastTemplate | null> => {
      let gltf: GLTF | null = null;
      try {
        await Promise.resolve(this.opts.after).catch(() => undefined);
        const premium = isPremiumBodyId(id);
        const detail: PremiumDetail = premium ? (this.opts.premiumDetail?.() ?? 'high') : 'high';
        let me = premium ? await this.premiumEntry(id, detail) : (await this.loadManifest()).get(id)!;
        if (this.disposed) return this.drop(id, entry);
        try {
          gltf = await this.opts.loadGlb(this.url(me.file));
        } catch (e) {
          if (!premium || detail === 'low' || (this.opts.online && !this.opts.online())) throw e;
          this.opts.warn(`could not load the high-detail file of '${id}'; trying the low-detail file`, e);
          me = await this.premiumEntry(id, 'low');
          gltf = await this.opts.loadGlb(this.url(me.file));
        }
        if (this.disposed || this.entries.get(id) !== entry) {
          disposeCastScene(gltf?.scene);
          return this.entries.get(id) === entry ? this.drop(id, entry) : null;
        }
        const tpl = prepareCastTemplate(id, gltf, me, this.opts.classic());
        entry.tpl = tpl;
        entry.state = 'ready';
        // rigs waiting on this body acquire it in their .then callbacks; only a template nobody picked up by the
        // next macrotask (its zombie was disposed / switched mid-load) joins the idle LRU. Parking it right away
        // could evict bodies that a batch load (a household arriving together) is about to use.
        setTimeout(() => {
          if (!this.disposed && this.entries.get(id) === entry && entry.refs === 0) this.park(id);
        }, 0);
        return tpl;
      } catch (e) {
        disposeCastScene(gltf?.scene);
        if (this.opts.online && !this.opts.online()) return this.drop(id, entry); // connection lost mid-load: retry later
        entry.state = 'failed';
        this.opts.warn(`could not load cast body '${id}'; keeping the classic body`, e);
        return null;
      }
    })();
    return entry.promise;
  }

  private drop(id: CastBodyId, entry: Entry): null {
    entry.state = 'failed';
    if (this.entries.get(id) === entry) this.entries.delete(id);
    return null;
  }

  /** A rig starts using a ready template. */
  acquire(tpl: CastTemplate): void {
    const e = this.entries.get(tpl.id);
    if (!e || e.tpl !== tpl) return;
    e.refs++;
    this.idle.delete(tpl.id);
  }

  /** A rig stopped using a template (dispose / body switch). Idle templates beyond CAST_IDLE_KEEP are disposed. */
  release(tpl: CastTemplate): void {
    const e = this.entries.get(tpl.id);
    if (!e || e.tpl !== tpl || e.refs <= 0) return;
    e.refs--;
    if (e.refs === 0) this.park(tpl.id);
  }

  private park(id: CastBodyId): void {
    this.idle.delete(id);
    this.idle.add(id);
    while (this.idle.size > CAST_IDLE_KEEP) {
      const oldest = this.idle.values().next().value as CastBodyId;
      this.idle.delete(oldest);
      this.evict(oldest);
    }
  }

  private evict(id: CastBodyId): void {
    const e = this.entries.get(id);
    if (!e || e.refs > 0) return;
    this.entries.delete(id);
    disposeCastScene(e.tpl?.scene);
    e.tpl = null;
  }

  stats(): CastLibraryStats {
    const loaded: CastBodyId[] = [];
    const failed: CastBodyId[] = [];
    const refs: Partial<Record<CastBodyId, number>> = {};
    for (const [id, e] of this.entries) {
      if (e.state === 'ready') loaded.push(id);
      if (e.state === 'failed') failed.push(id);
      if (e.refs) refs[id] = e.refs;
    }
    return { loaded, idle: [...this.idle], refs, failed };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const e of this.entries.values()) {
      disposeCastScene(e.tpl?.scene);
      e.tpl = null;
    }
    this.entries.clear();
    this.idle.clear();
  }
}
