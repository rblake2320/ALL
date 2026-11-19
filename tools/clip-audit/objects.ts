/**
 * CLIP-AUDIT furniture: shipped object GLBs placed exactly as the renderer places them (placementTransform from
 * src/render/objects/placement.ts) and put in their in-use visual state with the real dynamic-part code
 * (bindInstance / settleAnimations / applyState: fridge and shower doors swing open, pumps lift, servings show), then
 * converted into world-space solids. Character root poses come from the real sim slot math
 * (src/sim/spatial/geometry.ts frameLocalToWorld / worldFacing / faceObjectPose).
 */
import * as THREE from 'three';
import { PHYSICAL_SPECS, type PhysicalSpec, type SlotSpec } from '../../src/shared/catalog';
import type { Rot } from '../../src/shared/dimensions';
import { createPlacementTransform, placementTransform } from '../../src/render/objects/placement';
import { applyState, bindInstance, settleAnimations } from '../../src/render/models/dynamic';
import { MaterialVariants } from '../../src/render/models/variants';
import { createVisualState } from '../../src/render/objects/visualState';
import { faceObjectPose, frameCentre, frameLocalTile, frameLocalToWorld, worldFacing, type Frame } from '../../src/sim/spatial/geometry';
import { extractMeshes, loadGlb, hasAsset } from './assets';
import { makeSolid, type Solid } from './detect';
import type { Pose } from './rigs';

export const SPEC_BY_ID: ReadonlyMap<string, PhysicalSpec> = new Map(PHYSICAL_SPECS.map((s) => [s.id, s]));

/** Effect / conditional nodes that are not solid furniture (light cones, flames, water, frost, break sparks). */
export const NON_SOLID_NODE = /^(glow|flame(_\w+)?|water|frost|broken)$/;

/**
 * Open transparent shells (the cryo sarcophagus' tilted glass canopy): a dome with no floor encloses no solid, but its
 * winding number would count the whole space under it as "inside" — excluded from the furniture solid.
 */
export const OPEN_SHELL_MATERIAL = /^GlassCanopy/;

export function modelFile(id: string): string {
  return `models/objects/${id}.glb`;
}

export function hasModel(id: string): boolean {
  return hasAsset(modelFile(id));
}

export interface PlacedObject {
  id: string;
  spec: PhysicalSpec;
  frame: Frame;
  root: THREE.Object3D;
  solid: Solid;
}

const variants = new MaterialVariants();

/**
 * Place floor object `id` with its rotated footprint's min corner at tile (ox, oz), rotation `rot`, in-use state
 * `inUse`. Returns the world-space solid (non-solid effect nodes excluded); `visible` = measure depths to the
 * visible outer surface (see makeSolid; costly, cached setups only).
 */
export async function placeFloorObject(id: string, ox: number, oz: number, rot: Rot, inUse = true, visible = true): Promise<PlacedObject> {
  const spec = SPEC_BY_ID.get(id);
  if (!spec) throw new Error(`unknown object ${id}`);
  const gltf = await loadGlb(modelFile(id));
  const root = gltf.scene.clone(true);
  const holder = new THREE.Group();
  holder.add(root);
  const tf = placementTransform({ kind: 'floor', x: ox, z: oz, rot } as never, spec.footprint, createPlacementTransform());
  holder.position.set(tf.x, tf.y, tf.z);
  holder.rotation.set(0, tf.yaw, 0);
  const rig = bindInstance(root, id, null, false);
  const st = { ...createVisualState(), inUse, powered: true, servings: 4 };
  settleAnimations(rig, st);
  applyState(rig, st, 0, variants);
  applyState(rig, st, 0.001, variants);
  holder.updateMatrixWorld(true);
  const mesh = extractMeshes(holder, {
    skip: (o) => NON_SOLID_NODE.test(o.name),
    skipMaterial: (m) => OPEN_SHELL_MATERIAL.test(m.name),
    label: (m) => partLabel(m, id),
  });
  return { id, spec, frame: { w: spec.footprint.w, d: spec.footprint.d, ox, oz, rot }, root: holder, solid: makeSolid(mesh, { visible }) };
}

/** Nearest named ancestor below the model root (the GLB's part name, e.g. 'door', 'screen', or the model id). */
function partLabel(m: THREE.Mesh, id: string): string {
  for (let o: THREE.Object3D | null = m; o; o = o.parent) {
    if (o.name && o.name !== id && !/^(Scene|AuxScene)$/.test(o.name) && !/_mesh$|^mesh/.test(o.name)) return o.name;
    if (o.name === id) return id;
  }
  return m.name || id;
}

/** The sim's root pose for slot `slotIndex` of a floor object placed at `frame` (approach `approachIndex` for faceObject slots). */
export function slotPose(spec: PhysicalSpec, frame: Frame, slotIndex: number, approachIndex = 0): Pose & { kind: SlotSpec['kind'] } {
  const s = spec.slots[slotIndex];
  if (!s) throw new Error(`${spec.id} has no slot ${slotIndex}`);
  if (s.faceObject || !s.pose) {
    const a = s.approach[approachIndex] ?? s.approach[0];
    const t = frameLocalTile(frame, Math.floor(a.x), Math.floor(a.z));
    const p = faceObjectPose(t, frameCentre(frame));
    return { x: p.x, y: 0, z: p.z, facing: p.facing, kind: s.kind };
  }
  const p = frameLocalToWorld(frame, s.pose.x, s.pose.z);
  return { x: p.x, y: s.pose.y ?? 0, z: p.z, facing: worldFacing(frame.rot, s.facing ?? 0), kind: s.kind };
}
