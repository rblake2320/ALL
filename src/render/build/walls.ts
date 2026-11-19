/**
 * Wall layer: merged wall mesh (one draw call) with the procedural wallpaper atlas, cut openings, corner posts
 * and animated cutaway heights (in-place vertex updates — no rebuild per frame). Exposes per-edge heights for
 * wall items/openings visibility and box picking.
 */
import * as THREE from 'three';
import type { EdgeKey, LotState } from '../../sim/types';
import type { WallMode } from '../contracts';
import { DIM } from '../../shared/dimensions';
import { WALL_STYLES } from '../../shared/styles';
import { buildWallAtlas, buildWallAtlasAsync, type WallAtlas } from './wallPatterns';
import { buildWallMesh, applyWallHeights, updatePostHeights, rayWalls, type OpeningCut, type WallMeshData } from './wallGeometry';
import { isWallLowered, wallTargetHeight, type RoomLookup } from './cutaway';
import { WALL_CAP_SLOT, WALL_TRIM_SLOT } from './atlasLayout';
import { dampFactor, hashString } from '../core/math';
import { makeCanvas, ctx2d } from '../world/canvasUtil';

const HEIGHT_RATE = 11;

const ROUGH: Record<string, number> = { plaster: 0.9, stripes: 0.82, damask: 0.75, brick: 0.92, wood: 0.7, tile: 0.35, stone: 0.9, wallpaperFloral: 0.82 };

export interface WallPick {
  edge: EdgeKey;
  side: 0 | 1;
  t: number;
}

export class WallLayer {
  readonly group = new THREE.Group();
  private atlas: WallAtlas | null = null;
  private texture: THREE.CanvasTexture | null = null;
  private roughTex: THREE.CanvasTexture | null = null;
  private material: THREE.MeshStandardMaterial | null = null;
  private mesh: THREE.Mesh | null = null;
  private data: WallMeshData | null = null;
  private heights = new Float32Array(0);
  private targets = new Float32Array(0);
  private segIndex = new Map<EdgeKey, number>();
  private version = NaN;
  private openingsSig = NaN;
  private paintSig = NaN;
  private paintCheck = 0;
  private lastMode: WallMode | '' = '';
  private lastViewX = NaN;
  private lastViewZ = NaN;
  private lastRoomsVersion = NaN;
  private animating = false;
  /** Edge kept at full height even when cutaway / walls-down would lower it (a door/window/wall-item ghost on it). */
  private raised: EdgeKey | null = null;
  private raisedDirty = false;

  constructor(private anisotropy = 4) {
    this.group.name = 'walls';
  }

  /** Generate the atlas without blocking (one style per macrotask). */
  async prepareAsync(): Promise<void> {
    if (this.atlas) return;
    const atlas = await buildWallAtlasAsync();
    if (!this.atlas) this.adopt(atlas);
  }

  prepare(): void {
    if (this.atlas) return;
    this.adopt(buildWallAtlas());
  }

  private adopt(atlas: WallAtlas): void {
    this.atlas = atlas;
    const tex = new THREE.CanvasTexture(this.atlas.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture = tex;
    this.roughTex = new THREE.CanvasTexture(roughnessCanvas(this.atlas));
    this.roughTex.colorSpace = THREE.NoColorSpace;
    this.material = new THREE.MeshStandardMaterial({ name: 'wall-atlas', map: tex, roughnessMap: this.roughTex, roughness: 1, metalness: 0 });
  }

  setAnisotropy(a: number): void {
    this.anisotropy = a;
    if (this.texture) {
      this.texture.anisotropy = a;
      this.texture.needsUpdate = true;
    }
  }

  /**
   * Rebuild when the wall version, the openings signature or the paint signature changes.
   * @param openings edge → cut (doors/windows currently in the walls)
   * @param openingsSig cheap signature of `openings` (renderer computes it while syncing objects)
   */
  sync(lot: LotState | null | undefined, openings: ReadonlyMap<EdgeKey, OpeningCut>, openingsSig: number, force = false): boolean {
    if (!lot || !this.atlas || !this.material) return false;
    const structural = force || lot.wallVersion !== this.version || openingsSig !== this.openingsSig;
    // paint changes normally bump wallVersion; re-check the paint signature periodically as a safety net
    if (!structural && this.paintCheck++ % 30 !== 0) return false;
    const paint = paintSignature(lot);
    if (!structural && paint === this.paintSig) return false;
    this.version = lot.wallVersion;
    this.openingsSig = openingsSig;
    this.paintSig = paint;
    this.rebuild(lot, openings);
    return true;
  }

  private rebuild(lot: LotState, openings: ReadonlyMap<EdgeKey, OpeningCut>): void {
    const prev = new Map<EdgeKey, number>();
    if (this.data) for (const s of this.data.segments) prev.set(s.key, this.heights[s.slot]);
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    const data = buildWallMesh(lot.walls, (k) => openings.get(k) ?? null, this.atlas!.layout.cells);
    this.data = data;
    this.segIndex.clear();
    data.segments.forEach((s, i) => this.segIndex.set(s.key, i));
    this.heights = new Float32Array(data.slotCount);
    this.targets = new Float32Array(data.slotCount);
    for (const s of data.segments) {
      const h = prev.get(s.key) ?? DIM.WALL_HEIGHT;
      this.heights[s.slot] = h;
      this.targets[s.slot] = h;
    }
    updatePostHeights(data, this.heights);
    this.lastMode = '';
    if (data.vertexCount === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(data.positions), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(data.uvs), 2).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, this.material!);
    mesh.name = 'wall-mesh';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.mesh = mesh;
    this.group.add(mesh);
    this.applyHeights();
  }

  /**
   * Recompute cutaway targets when the mode, the view direction (quantised) or the rooms changed, then animate
   * heights. `roomsVersion` should change whenever room ids may have changed (lot.version).
   */
  update(dt: number, mode: WallMode, viewX: number, viewZ: number, roomAt: RoomLookup | null, roomsVersion: number): void {
    const data = this.data;
    if (!data) return;
    const len = Math.hypot(viewX, viewZ) || 1;
    const vx = viewX / len;
    const vz = viewZ / len;
    const viewChanged = !(Math.abs(vx - this.lastViewX) < 0.01 && Math.abs(vz - this.lastViewZ) < 0.01);
    if (this.raisedDirty || mode !== this.lastMode || (mode === 'cutaway' && (viewChanged || roomsVersion !== this.lastRoomsVersion))) {
      this.raisedDirty = false;
      this.lastMode = mode;
      this.lastViewX = vx;
      this.lastViewZ = vz;
      this.lastRoomsVersion = roomsVersion;
      for (const s of data.segments) this.targets[s.slot] = wallTargetHeight(s.key !== this.raised && isWallLowered(mode, s.edge, vx, vz, roomAt));
      this.animating = true;
    }
    if (!this.animating) return;
    const k = dampFactor(HEIGHT_RATE, dt);
    let moving = false;
    for (const s of data.segments) {
      const i = s.slot;
      const d = this.targets[i] - this.heights[i];
      if (Math.abs(d) < 0.002) this.heights[i] = this.targets[i];
      else {
        this.heights[i] += d * k;
        moving = true;
      }
    }
    updatePostHeights(data, this.heights);
    this.applyHeights();
    this.animating = moving;
  }

  private applyHeights(): void {
    if (!this.mesh || !this.data) return;
    const geo = this.mesh.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    applyWallHeights(this.data, this.heights, pos.array as Float32Array, uv.array as Float32Array);
    pos.needsUpdate = true;
    uv.needsUpdate = true;
  }

  /**
   * Keep one wall up while a door / window / wall-item ghost targets it. Without this a lowered (cutaway / walls
   * down) wall showed a full-height ghost, but the item placed there was hidden with the lowered wall, so the click
   * looked like it did nothing. null releases it (the wall animates back to its cutaway height).
   */
  setRaised(edge: EdgeKey | null): void {
    const e = typeof edge === 'string' && edge.length > 0 ? edge : null;
    if (e === this.raised) return;
    this.raised = e;
    this.raisedDirty = true;
  }

  /**
   * True once the heights have reached the targets for `mode` (cutaway / raise-for-ghost applied and the height
   * animation finished). Picking and wall-item visibility read the CURRENT heights, so a caller that needs a stable
   * view (e2e harness, W-115) waits for this instead of a wall-clock delay: the animation advances per rendered frame
   * (dt is clamped per frame), so on a slow software-rendered runner it can take many seconds.
   */
  isSettled(mode: WallMode): boolean {
    if (!this.data) return true;
    return this.lastMode === mode && !this.raisedDirty && !this.animating;
  }

  /** Current animated height of an edge's wall (0 if there is no wall). */
  heightOf(edge: EdgeKey): number {
    const i = this.segIndex.get(edge);
    if (i === undefined || !this.data) return 0;
    return this.heights[this.data.segments[i].slot];
  }

  hasWall(edge: EdgeKey): boolean {
    return this.segIndex.has(edge);
  }

  /** Ray vs each wall segment's current box (door/window gaps let the ray through). Nearest hit + the side it comes from. */
  pick(o: THREE.Vector3, d: THREE.Vector3): WallPick | null {
    const data = this.data;
    if (!data) return null;
    const hit = rayWalls(data.segments, this.heights, o.x, o.y, o.z, d.x, d.y, d.z);
    return hit ? { edge: hit.segment.key, side: hit.side, t: hit.t } : null;
  }

  segmentCount(): number {
    return this.data ? this.data.segments.length : 0;
  }

  dispose(): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    this.mesh = null;
    this.data = null;
    this.material?.dispose();
    this.texture?.dispose();
    this.roughTex?.dispose();
    this.material = null;
    this.texture = null;
    this.roughTex = null;
    this.atlas = null;
  }
}

/** Cheap paint signature (allocation free) so repaints rebuild even if a system forgot to bump wallVersion. */
export function paintSignature(lot: LotState): number {
  let h = 0;
  const walls = lot.walls;
  if (!walls || typeof walls !== 'object') return 0;
  for (const k in walls) {
    const w = walls[k];
    h = (h + hashString(k)) % 2147483647;
    if (w && Array.isArray(w.paint)) {
      const a = typeof w.paint[0] === 'string' ? hashString(w.paint[0]) : 1;
      const b = typeof w.paint[1] === 'string' ? hashString(w.paint[1]) : 2;
      h = (h + ((a * 31 + b * 17) % 1000003)) % 2147483647;
    }
  }
  return h;
}

function roughnessCanvas(atlas: WallAtlas): HTMLCanvasElement {
  const scale = 1 / 8;
  const L = atlas.layout;
  const c = makeCanvas(Math.max(1, Math.round(L.width * scale)), Math.max(1, Math.round(L.height * scale)));
  const ctx = ctx2d(c);
  ctx.fillStyle = 'rgb(220,220,220)';
  ctx.fillRect(0, 0, c.width, c.height);
  L.cells.forEach((cell, i) => {
    const style = WALL_STYLES[i];
    let r = style ? ROUGH[style.pattern] ?? 0.85 : 0.85;
    if (i === WALL_TRIM_SLOT) r = 0.6;
    if (i === WALL_CAP_SLOT) r = 0.92;
    const v = Math.round(r * 255);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    const g = L.gutter;
    ctx.fillRect((cell.px - g) * scale, (cell.py - g) * scale, (cell.pw + 2 * g) * scale, (cell.ph + 2 * g) * scale);
  });
  return c;
}
