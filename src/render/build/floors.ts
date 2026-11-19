/**
 * Floor layer: one merged mesh (one draw call) for every floored tile, textured from the procedural floor atlas
 * with world-scaled UVs. Rebuilt only when lot.floorVersion (or the lot size) changes.
 */
import * as THREE from 'three';
import type { LotState } from '../../sim/types';
import { FLOOR_STYLES } from '../../shared/styles';
import { buildFloorAtlas, buildFloorAtlasAsync, type FloorAtlas } from './floorPatterns';
import { floorStyleSlot, floorTileUV, FLOOR_FALLBACK_SLOT } from './atlasLayout';
import { makeCanvas, ctx2d } from '../world/canvasUtil';

export const FLOOR_Y = 0.006;

const ROUGHNESS: Record<string, number> = {
  planks: 0.72,
  checker: 0.42,
  carpet: 0.97,
  stone: 0.86,
  tile: 0.38,
  dirt: 0.98,
  parquet: 0.55,
  marble: 0.22,
};

export class FloorLayer {
  readonly group = new THREE.Group();
  private atlas: FloorAtlas | null = null;
  private texture: THREE.CanvasTexture | null = null;
  private roughTex: THREE.CanvasTexture | null = null;
  private material: THREE.MeshStandardMaterial | null = null;
  private mesh: THREE.Mesh | null = null;
  private version = NaN;
  private dims = '';

  constructor(private anisotropy = 4) {
    this.group.name = 'floors';
  }

  /** Generate the atlas without blocking (one style per macrotask). */
  async prepareAsync(): Promise<void> {
    if (this.atlas) return;
    const atlas = await buildFloorAtlasAsync();
    if (!this.atlas) this.adopt(atlas);
  }

  /** Generate the atlas synchronously (tests / tools). */
  prepare(): void {
    if (this.atlas) return;
    this.adopt(buildFloorAtlas());
  }

  private adopt(atlas: FloorAtlas): void {
    this.atlas = atlas;
    const tex = new THREE.CanvasTexture(this.atlas.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture = tex;
    this.roughTex = new THREE.CanvasTexture(roughnessCanvas(this.atlas));
    this.roughTex.colorSpace = THREE.NoColorSpace;
    this.material = new THREE.MeshStandardMaterial({
      name: 'floor-atlas',
      map: tex,
      roughnessMap: this.roughTex,
      roughness: 1,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
  }

  setAnisotropy(a: number): void {
    this.anisotropy = a;
    if (this.texture) {
      this.texture.anisotropy = a;
      this.texture.needsUpdate = true;
    }
  }

  /** Rebuild if the floor version / lot size changed (or `force`). Never throws. */
  sync(lot: LotState | null | undefined, force = false): boolean {
    if (!lot || !this.atlas || !this.material) return false;
    const dims = `${lot.width}x${lot.depth}`;
    if (!force && lot.floorVersion === this.version && dims === this.dims) return false;
    this.version = lot.floorVersion;
    this.dims = dims;
    this.rebuild(lot);
    return true;
  }

  private rebuild(lot: LotState): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    const w = Number.isFinite(lot.width) ? Math.max(0, Math.min(Math.floor(lot.width), 512)) : 0;
    const d = Number.isFinite(lot.depth) ? Math.max(0, Math.min(Math.floor(lot.depth), 512)) : 0;
    const floors = Array.isArray(lot.floors) ? lot.floors : [];
    let count = 0;
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) if (floorStyleSlot(floors[z * w + x]) >= 0) count++;
    if (count === 0) return;
    const pos = new Float32Array(count * 12);
    const nor = new Float32Array(count * 12);
    const uv = new Float32Array(count * 8);
    const idx = new Uint32Array(count * 6);
    const cells = this.atlas!.layout.cells;
    const q = { u0: 0, v0: 0, u1: 0, v1: 0 };
    let t = 0;
    for (let z = 0; z < d; z++) {
      for (let x = 0; x < w; x++) {
        const slot = floorStyleSlot(floors[z * w + x]);
        if (slot < 0) continue;
        const cell = cells[slot] ?? cells[FLOOR_FALLBACK_SLOT];
        floorTileUV(cell, x, z, q);
        const p = t * 12;
        // (x,z) (x+1,z) (x+1,z+1) (x,z+1)
        pos.set([x, FLOOR_Y, z, x + 1, FLOOR_Y, z, x + 1, FLOOR_Y, z + 1, x, FLOOR_Y, z + 1], p);
        for (let k = 0; k < 4; k++) nor.set([0, 1, 0], p + k * 3);
        // canvas top (v1) is the cell's world z = 0 → z increases toward v0
        uv.set([q.u0, q.v1, q.u1, q.v1, q.u1, q.v0, q.u0, q.v0], t * 8);
        const b = t * 4;
        // CCW seen from above (+Y): (x,z) → (x,z+1) → (x+1,z+1)
        idx.set([b, b + 3, b + 2, b, b + 2, b + 1], t * 6);
        t++;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, this.material!);
    mesh.name = 'floor-tiles';
    mesh.receiveShadow = true;
    this.mesh = mesh;
    this.group.add(mesh);
  }

  dispose(): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    this.mesh = null;
    this.material?.dispose();
    this.texture?.dispose();
    this.roughTex?.dispose();
    this.material = null;
    this.texture = null;
    this.roughTex = null;
    this.atlas = null;
  }
}

/** Low-res roughness atlas with the same layout proportions (one flat value per style). */
function roughnessCanvas(atlas: FloorAtlas): HTMLCanvasElement {
  const scale = 1 / 8;
  const L = atlas.layout;
  const c = makeCanvas(Math.max(1, Math.round(L.width * scale)), Math.max(1, Math.round(L.height * scale)));
  const ctx = ctx2d(c);
  ctx.fillStyle = 'rgb(200,200,200)';
  ctx.fillRect(0, 0, c.width, c.height);
  L.cells.forEach((cell, i) => {
    const style = FLOOR_STYLES[i];
    const r = style ? ROUGHNESS[style.pattern] ?? 0.8 : 0.8;
    const v = Math.round(r * 255);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    const g = L.gutter;
    ctx.fillRect((cell.px - g) * scale, (cell.py - g) * scale, (cell.pw + 2 * g) * scale, (cell.ph + 2 * g) * scale);
  });
  return c;
}
