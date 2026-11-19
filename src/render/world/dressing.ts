/**
 * World dressing OUTSIDE the lot: grass terrain (procedural texture + macro colour variation), the sidewalk row
 * and curb, the street with faded lane marks, and the neighbourhood (houses, street lamps, fences, trees,
 * bushes, gravestones, hydrant, a parked hearse) from ModelLibrary ENV_MODELS ids. Nothing is ever placed on
 * a lot tile except the public sidewalk surface. Fog hides the edges.
 */
import * as THREE from 'three';
import type { ModelLibrary, ObjectVisualState } from '../contracts';
import { grassCanvas, sidewalkCanvas, asphaltCanvas } from './groundTextures';
import { instanceModel, placeMatrix, type InstancedProps } from './instancing';
import type { WindowGlow } from '../lighting/windowGlow';
import type { ThrottledWarn } from '../core/diagnostics';
import { mulberry32 } from '../core/math';
import { StaticBatcher } from '../objects/staticBatch';
import { mergeBatchParts, type BatchPart } from '../objects/chunks';

export interface LotDims {
  width: number;
  depth: number;
  sidewalkZ: number;
}

/**
 * W-025 S5: the walkable world is drawn by the world view (src/render/world/worldView.ts). The dressing then draws
 * only the far BACKDROP beyond the world's extent (§1.4 cold tier: the fake ring + fog), a ground plane under the
 * whole world, and the home lot's own sidewalk row and fence. `extent` is the world extent in scene (home-local)
 * coordinates. Absent = the legacy single-lot dressing, unchanged (AC-1).
 */
export interface WorldBackdrop {
  extent: { x0: number; z0: number; x1: number; z1: number };
}

/** Margin (m) between the world's extent and the backdrop ring of fake houses. */
export const BACKDROP_MARGIN = 14;

/**
 * Backdrop ring (pure): fake neighbourhood props OUTSIDE the world extent, facing it, so the fog edge never shows an
 * empty plain. Every placement lies at least BACKDROP_MARGIN − 5 m outside the extent.
 */
export function backdropLayout(extent: WorldBackdrop['extent']): EnvPlacement[] {
  const out: EnvPlacement[] = [];
  const r = mulberry32(9191);
  const houses = ['env_house_a', 'env_house_b', 'env_house_c'];
  const m = BACKDROP_MARGIN;
  const add = (id: string, x: number, z: number, yaw: number, scale = 1) => out.push({ id, x, z, yaw: yaw + (r() * 2 - 1) * 0.05, scale });
  // sparse on purpose: it sits beyond the unfinished frontier, mostly in fog (≈ 3 k triangles per house)
  const step = 44;
  let i = 0;
  for (let x = extent.x0 + 10; x <= extent.x1 - 10; x += step, i++) {
    add(houses[i % 3], x + r() * 4, extent.z0 - m, 0, 0.95 + r() * 0.1);
    add(houses[(i + 1) % 3], x + r() * 4, extent.z1 + m, Math.PI, 0.95 + r() * 0.1);
    add('env_tree_b', x + step / 2, extent.z0 - m - 4, r() * 6.28, 0.9 + r() * 0.3);
    add('env_tree_b', x + step / 2, extent.z1 + m + 4, r() * 6.28, 0.9 + r() * 0.3);
  }
  for (let z = extent.z0 + 20; z <= extent.z1 - 20; z += step, i++) {
    add(houses[i % 3], extent.x0 - m, z + r() * 4, Math.PI / 2, 0.95 + r() * 0.1);
    add(houses[(i + 2) % 3], extent.x1 + m, z + r() * 4, -Math.PI / 2, 0.95 + r() * 0.1);
  }
  return out;
}

export interface StreetLamp {
  obj: THREE.Object3D;
  x: number;
  y: number;
  z: number;
}

const GROUND_SIZE = 300;
const ROAD_WIDTH = 7.5;
const CURB_W = 0.25;
const CURB_TOP = 0.13;

/** Pure layout (unit-testable): where each env prop goes for a lot. Every position is outside the lot rectangle. */
export interface EnvPlacement {
  id: string;
  x: number;
  z: number;
  yaw: number;
  scale: number;
}

export function envLayout(dims: LotDims): EnvPlacement[] {
  const W = dims.width;
  const D = dims.depth;
  const far = D + CURB_W + ROAD_WIDTH + CURB_W; // far curb outer edge
  const r = mulberry32(4242);
  const jit = (a: number) => (r() * 2 - 1) * a;
  const out: EnvPlacement[] = [];
  const add = (id: string, x: number, z: number, yaw = 0, scale = 1) => out.push({ id, x, z, yaw: yaw + jit(0.04), scale });
  // neighbour houses, our side of the street (facing the street, +Z)
  add('env_house_a', -10, D * 0.45, 0);
  add('env_house_c', -23, D * 0.42, 0);
  add('env_house_b', W + 10.5, D * 0.47, 0);
  add('env_house_a', W + 24, D * 0.44, 0, 0.96);
  // back gardens behind the lot (houses facing the next street, -Z)
  add('env_house_b', W * 0.25, -13, Math.PI);
  add('env_house_c', W * 0.72, -12, Math.PI);
  // across the street, facing us (-Z)
  add('env_house_c', W * 0.12, far + 12, Math.PI);
  add('env_house_a', W * 0.45, far + 12.5, Math.PI, 1.02);
  add('env_house_b', W * 0.8, far + 12, Math.PI);
  add('env_house_a', -14, far + 12, Math.PI, 0.98);
  add('env_house_b', W + 15, far + 12.5, Math.PI);
  // trees & bushes around (never inside [0,W]×[0,D])
  const trees: [string, number, number][] = [
    ['env_tree_a', -4.5, 3],
    ['env_tree_b', -3.5, D * 0.75],
    ['env_tree_a', W + 4.5, D * 0.2],
    ['env_tree_b', W + 3.8, D * 0.7],
    ['env_tree_a', -17, -4],
    ['env_tree_b', W * 0.5, -6],
    ['env_tree_a', W + 17, -5],
    ['env_tree_b', -30, D * 0.8],
    ['env_tree_a', W + 32, D * 0.75],
    ['env_tree_b', W * 0.3, far + 4.5],
    ['env_tree_a', W * 0.62, far + 5],
    ['env_tree_b', -6, far + 4.5],
    ['env_tree_a', W + 6, far + 5],
  ];
  for (const [id, x, z] of trees) add(id, x, z, r() * Math.PI * 2, 0.85 + r() * 0.3);
  const bushes: [number, number][] = [
    [-1.6, 6],
    [-1.5, 14],
    [-1.7, 22],
    [W + 1.6, 9],
    [W + 1.5, 18],
    [W + 1.7, 24],
    [W * 0.2, -1.8],
    [W * 0.55, -1.6],
    [W * 0.85, -1.9],
  ];
  for (const [x, z] of bushes) add('env_bush', x, z, r() * Math.PI * 2, 0.8 + r() * 0.4);
  // a little old graveyard behind the back fence
  for (const [x, z] of [
    [W * 0.42, -4.2],
    [W * 0.5, -5.6],
    [W * 0.6, -4.4],
    [W * 0.34, -6.1],
  ] as [number, number][])
    add('env_gravestones', x, z, jit(0.4), 0.9 + r() * 0.2);
  // street furniture
  add('env_hydrant', -1.2, D - 0.55, 0.3);
  // a neighbour's hearse parked at the far curb (our side's lane belongs to the carpool, see carpool.ts)
  add('env_hearse', W + 9, far - CURB_W - 1.4, Math.PI);
  add('env_cart', W + 3.5, far + 1.1, 0.2);
  return out;
}

/** Which side of the lot a neighbourhood prop stands on (merge/culling cluster). Pure. */
export function envSide(x: number, z: number, dims: LotDims): 'back' | 'front' | 'west' | 'east' {
  if (Number.isFinite(z) && z > dims.depth) return 'front';
  if (Number.isFinite(z) && z < 0) return 'back';
  if (Number.isFinite(x) && x < dims.width / 2) return 'west';
  return 'east';
}

/** Street lamp positions (outside the lot: on the far sidewalk and just beyond the lot's side edges). */
export function streetLampLayout(dims: LotDims): { x: number; z: number; yaw: number }[] {
  const W = dims.width;
  const D = dims.depth;
  const far = D + CURB_W + ROAD_WIDTH + CURB_W;
  return [
    { x: -2.2, z: D + 0.12, yaw: Math.PI },
    { x: W + 2.2, z: D + 0.12, yaw: Math.PI },
    { x: W * 0.5 - 6, z: far + 0.6, yaw: 0 },
    { x: W * 0.5 + 9, z: far + 0.6, yaw: 0 },
    { x: -18, z: far + 0.6, yaw: 0 },
    { x: W + 18, z: far + 0.6, yaw: 0 },
  ];
}

/** Fence segment transforms (env_fence runs 1 m along +X from its origin). Back + both sides, stopping short of the sidewalk. */
export function fenceLayout(dims: LotDims): { x: number; z: number; yaw: number }[] {
  const out: { x: number; z: number; yaw: number }[] = [];
  const W = Math.floor(dims.width);
  const zEnd = Math.max(0, Math.floor(dims.sidewalkZ) - 1);
  const inset = 0.45;
  for (let x = 0; x < W; x++) out.push({ x, z: -inset, yaw: 0 });
  // along +Z: yaw -PI/2 maps local +X onto world +Z
  for (let z = 0; z < zEnd; z++) {
    out.push({ x: -inset, z, yaw: -Math.PI / 2 });
    out.push({ x: W + inset, z, yaw: -Math.PI / 2 });
  }
  return out;
}

export class WorldDressing {
  readonly group = new THREE.Group();
  readonly lamps: StreetLamp[] = [];
  private readonly owned: { dispose(): void }[] = [];
  private instanced: InstancedProps[] = [];
  /** Library instances kept alive by this dressing (instancing templates, street lamps) — released on clear. */
  private readonly instances: THREE.Object3D[] = [];
  private dims: LotDims | null = null;
  private worldKey = '';
  private readonly lampState: ObjectVisualState = { powered: true, inUse: false, broken: false, lit: false, servings: 0, progress: 0, flag: false, dirt: 0, burning: false };
  private grassTex: THREE.Texture | null = null;
  /** Env templates are statically batched before instancing (a neighbour house: ~12 sub-meshes → ~3 draws). */
  private readonly batcher = new StaticBatcher();

  constructor(
    private readonly models: ModelLibrary,
    private readonly glow: WindowGlow,
    private readonly warn: ThrottledWarn,
    private anisotropy = 4,
  ) {
    this.group.name = 'world-dressing';
  }

  /**
   * (Re)build for a lot; no-op when the dimensions (and the world backdrop) are unchanged. Never throws. `world`
   * switches to the walkable-world backdrop (W-025 S5); omitted / null = the legacy single-lot dressing.
   */
  build(dims: LotDims, force = false, world: WorldBackdrop | null = null): void {
    const d = sanitizeDims(dims);
    const wk = world ? `${world.extent.x0},${world.extent.z0},${world.extent.x1},${world.extent.z1}` : '';
    if (!force && this.dims && this.dims.width === d.width && this.dims.depth === d.depth && this.dims.sidewalkZ === d.sidewalkZ && wk === this.worldKey) return;
    this.clear();
    this.dims = d;
    this.worldKey = wk;
    if (world) {
      this.buildWorldBackdrop(d, world);
      return;
    }
    try {
      this.buildGround(d);
    } catch (e) {
      this.warn.warn('dress-ground', 'ground build failed', e);
    }
    try {
      this.buildStreet(d);
    } catch (e) {
      this.warn.warn('dress-street', 'street build failed', e);
    }
    try {
      this.buildProps(d);
    } catch (e) {
      this.warn.warn('dress-props', 'env props failed', e);
    }
  }

  setAnisotropy(a: number): void {
    this.anisotropy = a;
    if (this.grassTex) {
      this.grassTex.anisotropy = a;
      this.grassTex.needsUpdate = true;
    }
  }

  private track<T extends { dispose(): void }>(x: T): T {
    this.owned.push(x);
    return x;
  }

  private buildGround(d: LotDims, world: { cx: number; cz: number; size: number } | null = null): void {
    const gsize = world ? world.size : GROUND_SIZE;
    const geo = this.track(new THREE.PlaneGeometry(gsize, gsize, 64, 64));
    geo.rotateX(-Math.PI / 2);
    geo.translate(world ? world.cx : d.width / 2, 0, world ? world.cz : d.depth / 2);
    // macro colour variation (breaks texture repetition) + slightly fresher lawn on the lot
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const r = mulberry32(17);
    const blobs: [number, number, number, number][] = [];
    const bcx = world ? world.cx : d.width / 2;
    const bcz = world ? world.cz : d.depth / 2;
    const bspan = world ? gsize * 0.75 : 220;
    for (let i = 0; i < (world ? 160 : 90); i++) blobs.push([bcx + (r() - 0.5) * bspan, bcz + (r() - 0.5) * bspan, 6 + r() * 18, (r() - 0.5) * 0.35]);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      let v = 0;
      for (const [bx, bz, rad, amt] of blobs) {
        const dd = Math.hypot(x - bx, z - bz);
        if (dd < rad) v += amt * (1 - dd / rad) * (1 - dd / rad);
      }
      const onLot = x > 0 && x < d.width && z > 0 && z < d.sidewalkZ;
      const lot = onLot ? 0.03 : -0.02;
      // drier near the street
      const street = !world && z > d.depth - 2 && z < d.depth + 14 ? 0.08 : 0;
      colors[i * 3] = 1 + v * 0.6 + street * 0.6;
      colors[i * 3 + 1] = 1 + v * 0.45 + lot;
      colors[i * 3 + 2] = 1 + v * 0.3;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const tex = this.track(new THREE.CanvasTexture(grassCanvas()));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(gsize / 4, gsize / 4);
    tex.anisotropy = this.anisotropy;
    this.grassTex = tex;
    const mat = this.track(new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.96, metalness: 0, name: 'ground-grass' }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'ground';
    mesh.receiveShadow = true;
    mesh.renderOrder = -10;
    this.group.add(mesh);
  }

  private buildStreet(d: LotDims): void {
    const xMin = -140;
    const xMax = d.width + 140;
    const len = xMax - xMin;
    const cx = (xMin + xMax) / 2;
    const swTex = this.track(new THREE.CanvasTexture(sidewalkCanvas()));
    swTex.colorSpace = THREE.SRGBColorSpace;
    swTex.wrapS = THREE.RepeatWrapping;
    swTex.repeat.set(len / 4, 1);
    swTex.anisotropy = this.anisotropy;
    const swMat = this.track(new THREE.MeshStandardMaterial({ map: swTex, roughness: 0.92, name: 'sidewalk' }));
    // our sidewalk: the lot's sidewalk row, continued along the street
    const sw = this.track(new THREE.BoxGeometry(len, 0.04, 1));
    this.fixBoxTopUV(sw);
    const swMesh = new THREE.Mesh(sw, swMat);
    swMesh.position.set(cx, 0.0, d.sidewalkZ + 0.5);
    swMesh.receiveShadow = true;
    this.group.add(swMesh);
    // curb
    const curbMat = this.track(new THREE.MeshStandardMaterial({ color: '#8b867d', roughness: 0.88, name: 'curb' }));
    const curbGeo = this.track(new THREE.BoxGeometry(len, CURB_TOP + 0.06, CURB_W));
    const curb = new THREE.Mesh(curbGeo, curbMat);
    curb.position.set(cx, (CURB_TOP - 0.06) / 2, d.depth + CURB_W / 2);
    curb.receiveShadow = true;
    curb.castShadow = true;
    this.group.add(curb);
    // road
    const asTex = this.track(new THREE.CanvasTexture(asphaltCanvas()));
    asTex.colorSpace = THREE.SRGBColorSpace;
    asTex.wrapS = asTex.wrapT = THREE.RepeatWrapping;
    asTex.repeat.set(len / 4, ROAD_WIDTH / 4);
    asTex.anisotropy = this.anisotropy;
    const roadMat = this.track(new THREE.MeshStandardMaterial({ map: asTex, roughness: 0.9, name: 'road', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    const roadGeo = this.track(new THREE.PlaneGeometry(len, ROAD_WIDTH));
    roadGeo.rotateX(-Math.PI / 2);
    const road = new THREE.Mesh(roadGeo, roadMat);
    const roadZ = d.depth + CURB_W + ROAD_WIDTH / 2;
    road.position.set(cx, 0.006, roadZ);
    road.receiveShadow = true;
    this.group.add(road);
    // lane marks: dashed centre line + faded edge lines, merged into one mesh
    const marks: THREE.BufferGeometry[] = [];
    for (let x = xMin; x < xMax; x += 4) {
      const g = new THREE.PlaneGeometry(2, 0.12);
      g.rotateX(-Math.PI / 2);
      g.translate(x + 1, 0, roadZ);
      marks.push(g);
    }
    for (const ez of [d.depth + CURB_W + 0.35, d.depth + CURB_W + ROAD_WIDTH - 0.35]) {
      const g = new THREE.PlaneGeometry(len, 0.08);
      g.rotateX(-Math.PI / 2);
      g.translate(cx, 0, ez);
      marks.push(g);
    }
    const merged = this.track(mergeSimple(marks));
    for (const g of marks) g.dispose();
    const markMat = this.track(new THREE.MeshStandardMaterial({ color: '#c8bf9e', roughness: 0.85, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, name: 'lane-marks' }));
    const markMesh = new THREE.Mesh(merged, markMat);
    markMesh.position.y = 0.008;
    markMesh.receiveShadow = true;
    this.group.add(markMesh);
    // far curb + sidewalk
    const farCurb = new THREE.Mesh(curbGeo, curbMat);
    const farCurbZ = d.depth + CURB_W + ROAD_WIDTH + CURB_W / 2;
    farCurb.position.set(cx, (CURB_TOP - 0.06) / 2, farCurbZ);
    farCurb.receiveShadow = true;
    this.group.add(farCurb);
    const farSwGeo = this.track(new THREE.BoxGeometry(len, 0.08, 1.6));
    this.fixBoxTopUV(farSwGeo, 1.6);
    const farSw = new THREE.Mesh(farSwGeo, swMat);
    farSw.position.set(cx, 0.04, farCurbZ + CURB_W / 2 + 0.8);
    farSw.receiveShadow = true;
    this.group.add(farSw);
  }

  /** W-025 S5 world mode: a ground plane under the whole world, the home's own sidewalk + fence, the far backdrop ring. */
  private buildWorldBackdrop(d: LotDims, world: WorldBackdrop): void {
    const e = world.extent;
    const ok = [e.x0, e.z0, e.x1, e.z1].every(Number.isFinite) && e.x1 > e.x0 && e.z1 > e.z0;
    const ext = ok ? e : { x0: -100, z0: -30, x1: 160, z1: 100 };
    try {
      const size = Math.min(2400, Math.max(ext.x1 - ext.x0, ext.z1 - ext.z0) + 2 * 150);
      this.buildGround(d, { cx: (ext.x0 + ext.x1) / 2, cz: (ext.z0 + ext.z1) / 2, size });
    } catch (err) {
      this.warn.warn('dress-ground', 'ground build failed', err);
    }
    try {
      const swTex = this.track(new THREE.CanvasTexture(sidewalkCanvas()));
      swTex.colorSpace = THREE.SRGBColorSpace;
      swTex.wrapS = THREE.RepeatWrapping;
      swTex.repeat.set(d.width / 4, 1);
      swTex.anisotropy = this.anisotropy;
      const swMat = this.track(new THREE.MeshStandardMaterial({ map: swTex, roughness: 0.92, name: 'sidewalk' }));
      const sw = this.track(new THREE.BoxGeometry(d.width, 0.04, 1));
      this.fixBoxTopUV(sw);
      const swMesh = new THREE.Mesh(sw, swMat);
      swMesh.position.set(d.width / 2, 0, d.sidewalkZ + 0.5);
      swMesh.receiveShadow = true;
      swMesh.name = 'home-sidewalk';
      this.group.add(swMesh);
    } catch (err) {
      this.warn.warn('dress-street', 'home sidewalk failed', err);
    }
    try {
      this.buildProps(d, backdropLayout(ext), false);
    } catch (err) {
      this.warn.warn('dress-props', 'backdrop props failed', err);
    }
  }

  /** Box UVs: map the top face to world metres (u along X / 4 m, v across). */
  private fixBoxTopUV(g: THREE.BoxGeometry, depthMetres = 1): void {
    void depthMetres;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 verts each). Only the +y face is visible; it already spans 0..1.
    for (let i = 0; i < uv.count; i++) if (i < 8 || i >= 12) uv.setXY(i, uv.getX(i) * 0.02, uv.getY(i) * 0.1);
    uv.needsUpdate = true;
  }

  /**
   * Neighbourhood props. Every static (batchable) part of every prop is merged in world space into ONE mesh per side
   * of the lot (back / across the street / west / east — each frustum-culled on its own), split into shadow casters
   * (props hugging the lot: fences, bushes, hydrant, street-lamp posts) and non-casters. What cannot be batched
   * (neighbours' window glass that glows at night, emissive bits) is instanced per model; street lamps keep their
   * live bulb/glow parts for models.update().
   */
  private buildProps(d: LotDims, layout: EnvPlacement[] = envLayout(d), streetLamps = true): void {
    const byId = new Map<string, THREE.Matrix4[]>();
    for (const p of layout) {
      const list = byId.get(p.id) ?? [];
      list.push(placeMatrix(p.x, 0, p.z, p.yaw, p.scale));
      byId.set(p.id, list);
    }
    const fences = fenceLayout(d).map((f) => placeMatrix(f.x, 0, f.z, f.yaw));
    byId.set('env_fence', fences);
    const clusters = new Map<string, BatchPart[]>();
    const addPart = (geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, cast: boolean) => {
      const key = `${envSide(matrix.elements[12], matrix.elements[14], d)}${cast ? ':cast' : ''}`;
      const list = clusters.get(key) ?? [];
      list.push({ geometry, matrix });
      clusters.set(key, list);
    };
    for (const [id, mats] of byId) {
      try {
        const tpl = this.models.create(id, null);
        this.instances.push(tpl);
        const isHouse = id.startsWith('env_house');
        if (isHouse) this.glow.apply(tpl, 'house', 0.8);
        // only props hugging the lot cast into the (lot-fitted) shadow map; distant houses would just cost draws
        const nearLot = id === 'env_fence' || id === 'env_bush' || id === 'env_hydrant';
        const merged = this.models.has(id) ? this.batcher.batch(id, tpl) : null;
        if (merged) {
          // the batch is baked in template-root space, so each copy's world matrix is just its placement
          for (const m of mats) addPart(merged.geometry, m, nearLot);
          // merged into the side clusters: keep it out of the per-model instancing below
          merged.visible = false;
        }
        const inst = instanceModel(tpl, mats, { castShadow: nearLot, receiveShadow: true, name: id });
        if (inst.meshes.length > 0 || inst.group.children.length > 0) {
          this.instanced.push(inst);
          this.group.add(inst.group);
        }
      } catch (e) {
        this.warn.warn('env-' + id, `env model ${id} failed`, e);
      }
    }
    for (const l of streetLamps ? streetLampLayout(d) : []) {
      try {
        const obj = this.models.create('env_streetlamp', null);
        this.instances.push(obj);
        obj.position.set(l.x, 0, l.z);
        obj.rotation.y = l.yaw;
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        // static parts → the side cluster (one draw for all posts); the bulb/glow stay live for models.update()
        const merged = this.models.has('env_streetlamp') ? this.batcher.batch('env_streetlamp', obj) : null;
        if (merged) {
          obj.updateMatrixWorld(true);
          addPart(merged.geometry, merged.matrixWorld.clone(), true);
          merged.visible = false;
        }
        this.group.add(obj);
        this.lamps.push({ obj, x: l.x, y: 3.8, z: l.z });
      } catch (e) {
        this.warn.warn('env-lamp', 'street lamp failed', e);
      }
    }
    for (const [key, parts] of clusters) {
      try {
        const geo = mergeBatchParts(parts);
        if (!geo) continue;
        this.track(geo);
        const mesh = new THREE.Mesh(geo, this.batcher.material);
        mesh.name = `env:${key}`;
        mesh.castShadow = key.endsWith(':cast');
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.raycast = () => undefined;
        this.group.add(mesh);
      } catch (e) {
        this.warn.warn('env-merge', `neighbourhood merge ${key} failed`, e);
      }
    }
  }

  /** Per frame: street lamp bulbs follow the lamps-on period. */
  update(timeSec: number, lampsOn: boolean): void {
    this.lampState.lit = lampsOn;
    for (const l of this.lamps) {
      try {
        this.models.update(l.obj, this.lampState, timeSec);
      } catch (e) {
        this.warn.warn('env-lamp-update', 'street lamp update failed', e);
      }
    }
  }

  private clear(): void {
    for (const inst of this.instanced) for (const m of inst.meshes) m.dispose();
    for (const o of this.instances) {
      try {
        this.models.release?.(o);
      } catch {
        /* optional */
      }
    }
    this.instances.length = 0;
    this.instanced = [];
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
    this.lamps.length = 0;
    this.grassTex = null;
    while (this.group.children.length) this.group.remove(this.group.children[0]);
  }

  dispose(): void {
    this.clear();
    this.batcher.dispose();
    this.dims = null;
  }
}

function sanitizeDims(d: LotDims): LotDims {
  const w = Number.isFinite(d?.width) && d.width > 0 ? Math.min(d.width, 200) : 30;
  const dp = Number.isFinite(d?.depth) && d.depth > 0 ? Math.min(d.depth, 200) : 30;
  const s = Number.isFinite(d?.sidewalkZ) && d.sidewalkZ >= 0 && d.sidewalkZ < dp ? d.sidewalkZ : Math.max(0, dp - 2);
  return { width: w, depth: dp, sidewalkZ: s };
}

/** Merge non-indexed-compatible simple geometries (positions/normals/uvs + indices). */
export function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vCount = 0;
  let iCount = 0;
  for (const g of geos) {
    vCount += g.getAttribute('position').count;
    iCount += g.index ? g.index.count : g.getAttribute('position').count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of geos) {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const n = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const t = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
    for (let i = 0; i < p.count; i++) {
      pos[(vo + i) * 3] = p.getX(i);
      pos[(vo + i) * 3 + 1] = p.getY(i);
      pos[(vo + i) * 3 + 2] = p.getZ(i);
      nor[(vo + i) * 3] = n ? n.getX(i) : 0;
      nor[(vo + i) * 3 + 1] = n ? n.getY(i) : 1;
      nor[(vo + i) * 3 + 2] = n ? n.getZ(i) : 0;
      uv[(vo + i) * 2] = t ? t.getX(i) : 0;
      uv[(vo + i) * 2 + 1] = t ? t.getY(i) : 0;
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo;
    else for (let i = 0; i < p.count; i++) idx[io + i] = vo + i;
    io += g.index ? g.index.count : p.count;
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
