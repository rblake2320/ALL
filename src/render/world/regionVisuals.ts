/**
 * Per-region visuals of the walkable world (W-025 S5, docs/DESIGN_WORLD_LEVELS.md §1.4): neighbour lots (home shells
 * with LODs + yard), the corner park, the Old Graveyard, street segments / ends (procedural road, curbs, crosswalks,
 * lane marks, lamps) and the honest placeholder boundary of unfinished areas (hatched ground, striped construction
 * fence or tall hedge, signs with an icon and colour band — never text alone).
 *
 * Every visual is built in its region's LOT-LOCAL frame under a root group whose transform is the region's scene frame
 * (worldFrame.ts). Shared resources (procedural textures, kit materials, model templates, shell prototypes) belong to
 * the world view; each visual owns only what it creates, through a `Tracker`, and frees it all in `dispose()`.
 */
import * as THREE from 'three';
import type { ModelLibrary } from '../contracts';
import type { WindowGlow } from '../lighting/windowGlow';
import type { StaticBatcher } from '../objects/staticBatch';
import { mergeBatchParts, type BatchPart } from '../objects/chunks';
import { placeMatrix } from './instancing';
import type { HomeShellLibrary, ShellPart } from './homeShells';
import { hash32, type RegionId, type RenderTier, type WorldRegionDef, type UnfinishedArea, type WorldRect } from '../../shared/world';
import { CORNER_PARK_TEMPLATE, GRAVEYARD_TEMPLATE, streetTiles, STREET_END_TEMPLATE } from '../../shared/mildewLane';
import type { RenderProfile } from './worldFrame';
import { grassCanvas, sidewalkCanvas, asphaltCanvas } from './groundTextures';
import { makeCanvas, ctx2d } from './canvasUtil';
import { mulberry32 } from '../core/math';
import { START_TEMPLATE_BOUNDS_V1 } from '../../shared/startNeighbours';

// ───────────────────────────── resource tracking (leak accounting) ─────────────────────────────

/** Live counts of world-view-owned GPU resources (tests assert they return to zero; the browser leak test samples gl.info). */
export const worldResourceCounts = { geometries: 0, textures: 0, materials: 0 };

/** Owns a region's geometries / textures / materials and frees them all at once. */
export class Tracker {
  private readonly items: { kind: 'geometries' | 'textures' | 'materials'; res: { dispose(): void } }[] = [];
  geometry<T extends THREE.BufferGeometry>(g: T): T {
    this.items.push({ kind: 'geometries', res: g });
    worldResourceCounts.geometries++;
    return g;
  }
  texture<T extends THREE.Texture>(t: T): T {
    this.items.push({ kind: 'textures', res: t });
    worldResourceCounts.textures++;
    return t;
  }
  material<T extends THREE.Material>(m: T): T {
    this.items.push({ kind: 'materials', res: m });
    worldResourceCounts.materials++;
    return m;
  }
  get size(): number {
    return this.items.length;
  }
  dispose(): void {
    for (const it of this.items) {
      try {
        it.res.dispose();
      } catch {
        /* already gone */
      }
      worldResourceCounts[it.kind]--;
    }
    this.items.length = 0;
  }
}

// ───────────────────────────── shared kit ─────────────────────────────

const canvasOk = (): boolean => typeof document !== 'undefined' && typeof document.createElement === 'function';

/** Shared materials / textures of the world view (created once, freed with the view). */
export class WorldKit {
  readonly track = new Tracker();
  readonly flat: THREE.MeshStandardMaterial;
  readonly sidewalk: THREE.MeshStandardMaterial;
  readonly road: THREE.MeshStandardMaterial;
  readonly dirt: THREE.MeshStandardMaterial;
  readonly hedgeGround: THREE.MeshStandardMaterial;
  readonly marks: THREE.MeshStandardMaterial;
  readonly placeholderHouse: THREE.BoxGeometry;
  readonly placeholderRoof: THREE.ConeGeometry;

  constructor(anisotropy = 4) {
    const t = this.track;
    const tex = (c: () => HTMLCanvasElement): THREE.Texture | null => {
      if (!canvasOk()) return null;
      try {
        const x = t.texture(new THREE.CanvasTexture(c()));
        x.colorSpace = THREE.SRGBColorSpace;
        x.wrapS = x.wrapT = THREE.RepeatWrapping;
        x.anisotropy = anisotropy;
        return x;
      } catch {
        return null;
      }
    };
    this.flat = t.material(new THREE.MeshStandardMaterial({ name: 'world-flat', vertexColors: true, roughness: 0.9, metalness: 0 }));
    this.sidewalk = t.material(new THREE.MeshStandardMaterial({ name: 'world-sidewalk', map: tex(() => sidewalkCanvas()), color: '#ffffff', roughness: 0.92 }));
    this.road = t.material(new THREE.MeshStandardMaterial({ name: 'world-road', map: tex(() => asphaltCanvas()), color: canvasOk() ? '#ffffff' : '#3a3a40', roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    this.marks = t.material(new THREE.MeshStandardMaterial({ name: 'world-marks', vertexColors: true, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    this.dirt = t.material(new THREE.MeshStandardMaterial({ name: 'world-unfinished-dirt', map: tex(() => hatchCanvas('#6b5236', '#c9a227')), color: canvasOk() ? '#ffffff' : '#6b5236', roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    this.hedgeGround = t.material(new THREE.MeshStandardMaterial({ name: 'world-unexplored-ground', map: tex(() => hatchCanvas('#2b3326', '#55604a')), color: canvasOk() ? '#ffffff' : '#2b3326', roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    this.placeholderHouse = t.geometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
    this.placeholderRoof = t.geometry(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0));
    void grassCanvas;
  }

  dispose(): void {
    this.track.dispose();
  }
}

/** Diagonal hatch (45°, 1:1 stripes): the "not built yet" ground — pattern + colour, so it reads without text or hue. */
export function hatchCanvas(base: string, stripe: string, px = 128): HTMLCanvasElement {
  const c = makeCanvas(px, px);
  const g = ctx2d(c);
  g.fillStyle = base;
  g.fillRect(0, 0, px, px);
  g.strokeStyle = stripe;
  g.lineWidth = px / 8;
  g.globalAlpha = 0.55;
  for (let i = -px; i <= px * 2; i += px / 2) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i - px, px);
    g.stroke();
  }
  g.globalAlpha = 1;
  return c;
}

// ───────────────────────────── geometry builder ─────────────────────────────

/** Accumulates axis-aligned boxes / ground quads (positions, normals, metre-scaled UVs, vertex colours) into one geometry. */
export class GeoBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly uv: number[] = [];
  private readonly col: number[] = [];
  private readonly idx: number[] = [];
  private readonly c = new THREE.Color();

  get empty(): boolean {
    return this.idx.length === 0;
  }

  private quad(p: number[][], n: number[], color: THREE.ColorRepresentation, uvScale: number, uAxis: 0 | 2): void {
    const base = this.pos.length / 3;
    this.c.set(color);
    for (const v of p) {
      this.pos.push(v[0], v[1], v[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.uv.push((uAxis === 0 ? v[0] : v[2]) * uvScale, (uAxis === 0 ? v[2] : v[0]) * uvScale + v[1] * uvScale);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Horizontal quad facing +Y over [x0,x1]×[z0,z1] at height y. */
  ground(x0: number, z0: number, x1: number, z1: number, y: number, color: THREE.ColorRepresentation = '#ffffff', uvScale = 0.25): this {
    this.quad([[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]], [0, 1, 0], color, uvScale, 0);
    return this;
  }

  /** Axis-aligned box (5 faces: no bottom). */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: THREE.ColorRepresentation, uvScale = 0.25): this {
    this.quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], color, uvScale, 0);
    this.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], color, uvScale, 0);
    this.quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], color, uvScale, 0);
    this.quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], color, uvScale, 2);
    this.quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], color, uvScale, 2);
    return this;
  }

  /** Vertical panel facing ±Z (a sign board): spans x0..x1, y0..y1 at z, UV 0..1. */
  panel(x0: number, y0: number, x1: number, y1: number, z: number, facePlusZ: boolean): this {
    const base = this.pos.length / 3;
    const pts = facePlusZ ? [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] : [[x1, y0], [x0, y0], [x0, y1], [x1, y1]];
    const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let i = 0; i < 4; i++) {
      this.pos.push(pts[i][0], pts[i][1], z);
      this.nor.push(0, 0, facePlusZ ? 1 : -1);
      this.uv.push(uvs[i][0], uvs[i][1]);
      this.col.push(1, 1, 1);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return this;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// ───────────────────────────── visuals ─────────────────────────────

export interface StreetLampVisual {
  obj: THREE.Object3D;
  /** Scene position of the bulb. */
  x: number;
  y: number;
  z: number;
}

export interface SignVisual {
  id: string;
  textKey: string;
  text: string;
  /** Scene position (tiles). */
  x: number;
  z: number;
}

export interface VisualContext {
  models: ModelLibrary;
  glow: WindowGlow;
  shells: HomeShellLibrary;
  kit: WorldKit;
  batcher: StaticBatcher;
  /** Shared model template (library instance, batched once); null when the model is not loaded yet. */
  template(id: string): THREE.Mesh | null;
  seed: number;
  profile: RenderProfile;
  /** Plan transform the start generator applied to a lot's built template (S7), or null (as authored). */
  lotTransform(regionId: RegionId): LotPlanTransform | null;
  /** Every non-unfinished region rect (world), for unfinished boundary edges. */
  openRects: readonly WorldRect[];
  /** Region placement → scene for sign / lamp positions. */
  toScene(x: number, z: number): { x: number; z: number };
  /** Resolved sign text (S8 owns the i18n strings; English fallback until then). */
  signText(key: string): string;
}

/** A built region. Owns its root group's contents. */
export interface RegionVisual {
  readonly regionId: RegionId;
  readonly root: THREE.Group;
  tier: RenderTier;
  /** Switch LOD / detail for a new tier (active ↔ warm). Cheap: rebuilds only the parts that differ. */
  setTier(tier: RenderTier): void;
  /** Wall cutaway for this region's shell (walls-down look: clipped at 1 m, window panes hidden). */
  setCut(cut: boolean): void;
  /** Swap a just-loaded shell prototype in (late assets). */
  refresh(): void;
  /** Scene-space boxes that block picking (shells), with what they are. */
  pickBoxes(): readonly THREE.Box3[];
  readonly lamps: StreetLampVisual[];
  readonly signs: SignVisual[];
  /** Resources owned right now (tests). */
  owned(): number;
  dispose(): void;
}

/**
 * How a lot's house was built from its template (W-025 S7, PR #66 `transformStartTemplate`): an X mirror across the
 * lot (x → W − x) and then a bounded translation (dx, dz) in lot tiles. Region rotation is the placement's job
 * (the region frame); this is the plan transform INSIDE the lot, applied to the shell at every LOD and to the
 * placeholder house, path and yard alike.
 */
export interface LotPlanTransform {
  mirrored: boolean;
  dx: number;
  dz: number;
}

/** Sanitise a plan transform (garbage → identity; S7 bounds: |dx| ≤ 3, −2 ≤ dz ≤ 1, integers). Pure. */
export function planTransform(t: Partial<LotPlanTransform> | null | undefined): LotPlanTransform {
  const int = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : 0);
  return { mirrored: t?.mirrored === true, dx: int(t?.dx, -3, 3), dz: int(t?.dz, -2, 1) };
}

const SHELL_TINTS = ['#ffffff', '#e8dccb', '#d6e0d8', '#e6d3dc', '#d9d2c1', '#cfd8e6', '#efe2c4'];
/** L1 (Wormwood) fallback shells for legacy regions without an assigned template. */
export const WORMWOOD_SHELLS = ['shell_starter', 'shell_wormwood_bungalow', 'shell_wormwood_townhouse'] as const;
/** Shell the clipped (cutaway) walls stop at, metres. */
export const SHELL_CUT_HEIGHT = 1.0;

/** Template shell, a seeded legacy fallback, or an empty ID for a genuinely vacant lot. */
export function shellIdFor(shells: HomeShellLibrary, region: WorldRegionDef, seed: number): string {
  if (region.templateId === 'empty') return '';
  const byTemplate = shells.forTemplate(region.templateId);
  if (byTemplate) return byTemplate.id;
  const h = hash32(seed >>> 0, hashId(region.id));
  return WORMWOOD_SHELLS[h % WORMWOOD_SHELLS.length];
}

function hashId(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

abstract class BaseVisual implements RegionVisual {
  readonly root = new THREE.Group();
  tier: RenderTier = 'warm';
  readonly lamps: StreetLampVisual[] = [];
  readonly signs: SignVisual[] = [];
  protected readonly track = new Tracker();
  protected readonly detail = new Tracker();
  protected detailGroup: THREE.Group | null = null;
  protected readonly boxes: THREE.Box3[] = [];
  protected readonly libInstances: THREE.Object3D[] = [];

  constructor(
    readonly regionId: RegionId,
    protected readonly ctx: VisualContext,
    protected readonly def: WorldRegionDef,
  ) {
    this.root.name = `region:${regionId}`;
    this.root.userData.regionId = regionId;
  }

  abstract build(tier: RenderTier): void;
  setTier(tier: RenderTier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    this.applyTier();
  }
  protected applyTier(): void {}
  setCut(_cut: boolean): void {}
  refresh(): void {}
  pickBoxes(): readonly THREE.Box3[] {
    return this.boxes;
  }
  owned(): number {
    return this.track.size + this.detail.size;
  }

  protected mesh(geo: THREE.BufferGeometry, mat: THREE.Material, name: string, cast = false, parent: THREE.Object3D = this.root): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.receiveShadow = true;
    m.castShadow = cast;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    parent.add(m);
    return m;
  }

  /** Merge library props (batched templates) into one mesh in this region's frame. */
  protected props(list: { id: string; x: number; z: number; yaw: number; scale?: number }[], tracker: Tracker, name: string, cast: boolean, parent: THREE.Object3D): THREE.Mesh | null {
    const parts: BatchPart[] = [];
    for (const p of list) {
      const tpl = this.ctx.template(p.id);
      if (!tpl) continue;
      // the batch is baked in template-root space: each copy's matrix is just its placement
      parts.push({ geometry: tpl.geometry, matrix: placeMatrix(p.x, 0, p.z, p.yaw, p.scale ?? 1) });
    }
    const geo = parts.length ? mergeBatchParts(parts) : null;
    if (!geo) return null;
    return this.mesh(tracker.geometry(geo), this.ctx.batcher.material, name, cast, parent);
  }

  protected clearDetail(): void {
    if (this.detailGroup) this.root.remove(this.detailGroup);
    this.detailGroup = null;
    this.detail.dispose();
    for (const o of this.libInstances) {
      try {
        this.ctx.models.release?.(o);
      } catch {
        /* optional */
      }
    }
    this.libInstances.length = 0;
    this.lamps.length = 0;
  }

  dispose(): void {
    this.clearDetail();
    this.track.dispose();
    while (this.root.children.length) this.root.remove(this.root.children[0]);
    this.root.removeFromParent();
    this.boxes.length = 0;
    this.signs.length = 0;
  }
}

/** Neighbour residential lot: sidewalk + front path, home shell (LOD0 active / LOD1 warm), yard props when active. */
export class LotVisual extends BaseVisual {
  private shellGroup: THREE.Group | null = null;
  private readonly shellTrack = new Tracker();
  private shellMat: THREE.MeshStandardMaterial | null = null;
  private placeholderMat: THREE.MeshStandardMaterial | null = null;
  private glassMeshes: THREE.Mesh[] = [];
  private cut = false;
  readonly shellId: string;
  private readonly tint: string;
  private shellLod: 0 | 1 | -1 = -1;
  private placeholder = false;
  /** Shell centre / size in lot-local tiles. */
  private cx = 15;
  private cz = 15;
  private sw = 10;
  private sd = 10;
  private doorX = 15;
  private plan: LotPlanTransform = { mirrored: false, dx: 0, dz: 0 };

  constructor(regionId: RegionId, ctx: VisualContext, def: WorldRegionDef) {
    super(regionId, ctx, def);
    this.shellId = shellIdFor(ctx.shells, def, ctx.seed);
    this.tint = SHELL_TINTS[hash32(ctx.seed >>> 0, hashId(regionId), 7) % SHELL_TINTS.length];
  }

  build(tier: RenderTier): void {
    this.tier = tier;
    if (this.def.templateId === 'empty') {
      this.mesh(this.track.geometry(new GeoBuilder().ground(0, 28, 30, 29, 0.025).build()), this.ctx.kit.sidewalk, 'lot-paving');
      return;
    }
    const info = this.ctx.shells.info(this.shellId);
    const bounds = START_TEMPLATE_BOUNDS_V1[this.def.templateId ?? ''];
    this.sw = info?.footprint.w ?? (bounds ? bounds.x1 - bounds.x0 : 10);
    this.sd = info?.footprint.d ?? (bounds ? bounds.z1 - bounds.z0 : 10);
    const t = planTransform(this.ctx.lotTransform(this.regionId));
    this.plan = t;
    const frontZ = (bounds?.z1 ?? 22) + t.dz;
    // Mirror the actual authored centre across the lot, then apply the saved translation.
    const centreX = bounds ? (bounds.x0 + bounds.x1) / 2 : 15;
    this.cx = (t.mirrored ? this.def.placement.width - centreX : centreX) + t.dx;
    this.cz = frontZ - this.sd / 2;
    const door = info?.doors[0]?.x ?? (bounds ? bounds.doorX - centreX : 0);
    this.doorX = this.cx + (t.mirrored ? -door : door);
    // sidewalk row (local z 28) + the front path from the door to the sidewalk: one draw
    const g = new GeoBuilder().ground(0, 28, 30, 29, 0.025);
    const px = Math.max(0.6, Math.min(29.4, this.doorX));
    g.ground(px - 0.6, frontZ + 0.4, px + 0.6, 28, 0.02);
    this.mesh(this.track.geometry(g.build()), this.ctx.kit.sidewalk, 'lot-paving');
    this.applyTier();
  }

  protected override applyTier(): void {
    if (this.def.templateId === 'empty') return;
    const lod: 0 | 1 = this.tier === 'active' ? 0 : 1;
    if (lod !== this.shellLod || this.placeholder) this.buildShell(lod);
    // A generated lot's real yard objects are drawn by the region object layer, with real collision/picking.
    // Only unassigned legacy scenery needs decorative stand-ins.
    if (this.tier === 'active' && !this.detailGroup && this.def.templateId === null) this.buildYard();
    if (this.tier !== 'active' && this.detailGroup) this.clearDetail();
  }

  override refresh(): void {
    if (this.placeholder) this.buildShell(this.shellLod === -1 ? 1 : (this.shellLod as 0 | 1));
  }

  private buildShell(lod: 0 | 1): void {
    if (this.shellGroup) this.root.remove(this.shellGroup);
    this.shellTrack.dispose();
    this.shellMat = null;
    this.placeholderMat = null;
    this.glassMeshes = [];
    this.boxes.length = 0;
    const grp = new THREE.Group();
    grp.name = `shell:${this.shellId}:lod${lod}`;
    grp.position.set(this.cx, 0, this.cz);
    // plan mirror (S7): scale −1 across the shell's own x (three.js flips the winding for a negative determinant)
    if (this.plan.mirrored) grp.scale.x = -1;
    this.shellGroup = grp;
    this.root.add(grp);
    this.shellLod = lod;
    const cast = this.tier === 'active' && this.ctx.profile === 'desktop';
    const parts: ShellPart[] | null = this.ctx.shells.get(this.shellId, lod);
    if (parts) {
      this.placeholder = false;
      for (const p of parts) {
        let mat: THREE.Material = p.material;
        if (p.glass) {
          const m = new THREE.Mesh(p.geometry, mat);
          this.ctx.glow.apply(m, 'house', 0.8);
          m.name = 'shell-glass';
          m.receiveShadow = false;
          m.castShadow = false;
          grp.add(m);
          this.glassMeshes.push(m);
          continue;
        }
        if (!this.shellMat) {
          const std = p.material as THREE.MeshStandardMaterial;
          this.shellMat = this.shellTrack.material(std.isMeshStandardMaterial ? std.clone() : new THREE.MeshStandardMaterial({ vertexColors: true }));
          this.shellMat.name = 'shell-tinted';
          this.shellMat.color.multiply(new THREE.Color(this.tint));
        }
        mat = this.shellMat;
        const m = new THREE.Mesh(p.geometry, mat);
        m.name = 'shell';
        m.castShadow = cast;
        m.receiveShadow = true;
        grp.add(m);
      }
    } else {
      // late / missing asset: an honest box house in the shell's footprint, swapped when the GLB lands
      this.placeholder = true;
      const mat = this.shellTrack.material(new THREE.MeshStandardMaterial({ name: 'shell-placeholder', color: new THREE.Color('#8a8078').multiply(new THREE.Color(this.tint)), roughness: 0.95 }));
      this.placeholderMat = mat;
      const body = new THREE.Mesh(this.ctx.kit.placeholderHouse, mat);
      body.scale.set(this.sw, 3.2, this.sd);
      body.name = 'shell-placeholder';
      body.castShadow = cast;
      const roof = new THREE.Mesh(this.ctx.kit.placeholderRoof, mat);
      roof.scale.set(this.sw, 2.2, this.sd);
      roof.position.y = 3.2;
      roof.castShadow = cast;
      grp.add(body, roof);
    }
    this.applyCut();
    grp.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(grp);
    if (!box.isEmpty()) this.boxes.push(box);
  }

  private buildYard(): void {
    const grp = new THREE.Group();
    grp.name = 'yard';
    this.detailGroup = grp;
    this.root.add(grp);
    const r = mulberry32(hash32(this.ctx.seed >>> 0, hashId(this.regionId), 3));
    const list: { id: string; x: number; z: number; yaw: number; scale?: number }[] = [];
    const side = (this.doorX < 15 ? 1 : -1) * (5 + r() * 2);
    list.push({ id: 'mailbox_crooked', x: this.doorX + 1.3, z: 27.4, yaw: 0 });
    // phone profile: the light pine instead of the 3–4.4 k-triangle dead trees (§1.4 phone triangle budget)
    const big = this.ctx.profile === 'phone' ? 'env_tree_b' : r() < 0.5 ? 'env_tree_a' : 'tree_gnarled';
    list.push({ id: big, x: 15 + side * 1.6, z: 25 + r(), yaw: r() * 6.28, scale: 0.8 + r() * 0.3 });
    list.push({ id: 'env_tree_b', x: 3 + r() * 3, z: 4 + r() * 4, yaw: r() * 6.28, scale: 0.85 + r() * 0.3 });
    list.push({ id: 'env_tree_b', x: 24 + r() * 3, z: 5 + r() * 5, yaw: r() * 6.28, scale: 0.85 + r() * 0.3 });
    for (let i = 0; i < (this.ctx.profile === 'phone' ? 1 : 3); i++) list.push({ id: 'env_bush', x: 15 - this.sw / 2 - 1 + i * 0.1 + (i === 2 ? this.sw + 2 : 0), z: 21 + i * 0.4, yaw: r() * 6.28, scale: 0.8 + r() * 0.4 });
    this.props(list, this.detail, 'yard-props', this.ctx.profile === 'desktop', grp);
    grp.updateMatrixWorld(true);
  }

  override setCut(cut: boolean): void {
    if (cut === this.cut) return;
    this.cut = cut;
    this.applyCut();
  }

  private applyCut(): void {
    const planes = this.cut ? [CUT_PLANE] : [];
    for (const m of [this.shellMat, this.placeholderMat]) {
      if (!m) continue;
      m.clippingPlanes = planes;
      m.side = this.cut ? THREE.DoubleSide : THREE.FrontSide;
      m.needsUpdate = true;
    }
    for (const g of this.glassMeshes) g.visible = !this.cut;
  }

  isCut(): boolean {
    return this.cut;
  }

  /** The plan transform this lot was built with (tests / debug). */
  planOf(): LotPlanTransform {
    return { ...this.plan };
  }

  /** The shell group (tests / debug). */
  shellObject(): THREE.Object3D | null {
    return this.shellGroup;
  }

  currentLod(): number {
    return this.shellLod;
  }

  isPlaceholder(): boolean {
    return this.placeholder;
  }

  override dispose(): void {
    super.dispose();
    this.shellTrack.dispose();
    this.shellGroup = null;
  }

  override owned(): number {
    return super.owned() + this.shellTrack.size;
  }
}

/** Keeps y ≤ SHELL_CUT_HEIGHT (world y is the same in every region frame). */
const CUT_PLANE = new THREE.Plane(new THREE.Vector3(0, -1, 0), SHELL_CUT_HEIGHT);

/** Corner park and Old Graveyard (community lots without a shipped template yet): paths, trees, graves, fence, gate gap. */
export class CommunityVisual extends BaseVisual {
  build(tier: RenderTier): void {
    this.tier = tier;
    const park = this.def.templateId === CORNER_PARK_TEMPLATE;
    const g = new GeoBuilder();
    g.ground(0, 28, 30, 29, 0.025);
    g.ground(14, 8, 16, 28, 0.02);
    if (park) g.ground(4, 14, 26, 16, 0.021);
    this.mesh(this.track.geometry(g.build()), this.ctx.kit.sidewalk, 'community-paving');
    const r = mulberry32(hash32(this.ctx.seed >>> 0, hashId(this.regionId), 5));
    const list: { id: string; x: number; z: number; yaw: number; scale?: number }[] = [];
    if (park) {
      for (const [x, z] of [[4, 5], [25, 6], [7, 22], [23, 23], [10, 10], [20, 11]] as [number, number][]) list.push({ id: r() < 0.5 ? 'env_tree_a' : 'env_tree_b', x: x + r(), z: z + r(), yaw: r() * 6.28, scale: 0.85 + r() * 0.3 });
      for (const x of [9, 21]) list.push({ id: 'pew_salvaged', x, z: 17.2, yaw: Math.PI });
      for (const x of [12.5, 17.5]) list.push({ id: 'lantern_post', x, z: 26, yaw: 0 });
    } else {
      // perimeter iron fence (1 m sections along +X; yaw −π/2 runs them along +Z), gate gap at local x 13–17 on the street edge
      for (let x = 0; x < 30; x++) {
        list.push({ id: 'env_fence', x, z: 0.2, yaw: 0 });
        if (x < 13 || x >= 17) list.push({ id: 'env_fence', x, z: 29.6, yaw: 0 });
      }
      for (let z = 0; z < 29; z++) {
        list.push({ id: 'env_fence', x: 0.2, z, yaw: -Math.PI / 2 });
        list.push({ id: 'env_fence', x: 29.8, z, yaw: -Math.PI / 2 });
      }
      for (let i = 0; i < 18; i++) {
        const gx = 3 + (i % 6) * 4.3 + r();
        const gz = 4 + Math.floor(i / 6) * 6 + r();
        if (Math.abs(gx - 15) < 2) continue;
        list.push({ id: i % 3 === 0 ? 'headstone_decor' : 'env_gravestones', x: gx, z: gz, yaw: (r() - 0.5) * 0.5 });
      }
      for (const [x, z] of [[4, 25], [26, 24], [3, 2.5]] as [number, number][]) list.push({ id: 'tree_gnarled', x, z, yaw: r() * 6.28, scale: 0.9 + r() * 0.3 });
      for (const x of [12.2, 17.8]) list.push({ id: 'lantern_post', x, z: 28.6, yaw: 0 });
    }
    // community dressing is the region's identity: drawn in both tiers (one merged mesh)
    const m = this.props(list, this.track, 'community-props', false, this.root);
    if (m) this.boxes.length = 0;
  }
}

/** Street segment / end: road, curbs with crosswalk ramps, zebra + centre dashes, one lamp per segment (active). */
export class StreetVisual extends BaseVisual {
  build(tier: RenderTier): void {
    this.tier = tier;
    const tiles = streetTiles(this.def);
    const W = this.def.placement.width;
    const end = this.def.templateId === STREET_END_TEMPLATE;
    const road = new GeoBuilder().ground(0, 1.25, W, 8.75, 0.006);
    this.mesh(this.track.geometry(road.build()), this.ctx.kit.road, 'street-road');
    const flat = new GeoBuilder();
    const curbH = 0.13;
    const cross = (x: number) => !!tiles && tiles[1 * W + x] === 'crosswalk';
    for (const [z0, z1] of [[1, 1.25], [8.75, 9]] as [number, number][]) {
      let x = 0;
      while (x < W) {
        let x2 = x;
        const c = cross(x);
        while (x2 < W && cross(x2) === c) x2++;
        // crosswalk tiles: a curb ramp (flush), elsewhere the 0.13 m curb
        flat.box(x, 0, z0, x2, c ? 0.02 : curbH, z1, c ? '#a9a49a' : '#8b867d');
        x = x2;
      }
    }
    // curbs are 13 cm tall: their shadow is not worth a shadow-pass draw per street
    this.mesh(this.track.geometry(flat.build()), this.ctx.kit.flat, 'street-curbs', false);
    const marks = new GeoBuilder();
    if (end) {
      for (let x = 0.4; x < W - 0.4; x += 0.9) marks.ground(x, 4.1, x + 0.5, 5.9, 0.012, '#d9d4c0');
    } else {
      for (let z = 1.6; z < 8.6; z += 0.9) marks.ground(14.1, z, 15.9, z + 0.5, 0.012, '#d9d4c0');
      for (let x = 0; x < W; x += 4) if (x + 2 < 13.5 || x > 16.5) marks.ground(x, 4.94, x + 2, 5.06, 0.011, '#c8bf9e');
    }
    if (!marks.empty) this.mesh(this.track.geometry(marks.build()), this.ctx.kit.marks, 'street-marks');
    this.applyTier();
  }

  protected override applyTier(): void {
    const wantLamp = this.tier === 'active' && this.def.templateId !== STREET_END_TEMPLATE;
    if (wantLamp && !this.detailGroup) this.buildLamp();
    if (!wantLamp && this.detailGroup) this.clearDetail();
  }

  private buildLamp(): void {
    const grp = new THREE.Group();
    grp.name = 'street-lamps';
    this.detailGroup = grp;
    this.root.add(grp);
    const n = Number(this.regionId.split(':')[2] ?? '0') || 0;
    const z = n % 2 === 0 ? 0.5 : 9.5;
    const x = 22;
    try {
      const obj = this.ctx.models.create('env_streetlamp', null);
      this.libInstances.push(obj);
      obj.position.set(x, 0, z);
      obj.rotation.y = z < 5 ? 0 : Math.PI;
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          // lamp posts sit on the verge, mostly outside the focused lot's shadow box: no shadow-pass draws
          m.castShadow = false;
          m.receiveShadow = true;
        }
      });
      grp.add(obj);
      const s = this.ctx.toScene(x, z);
      this.lamps.push({ obj, x: s.x, y: 3.8, z: s.z });
    } catch {
      /* lamp model unavailable: the street still draws */
    }
  }
}

const UNFINISHED_FALLBACK_TEXT: Record<string, string> = {
  'world.unfinished.wormwoodNorth': 'UNDER CONSTRUCTION — Wormwood North. Not open in this version yet.',
  'world.unfinished.rotrowTram': 'UNDER CONSTRUCTION — the Rot Row tram line is coming soon. Not open in this version yet.',
  'world.unfinished.bayouRoad': 'Unexplored — here be ghouls. The Bayou road is not open in this version yet.',
  'world.unfinished.mausoleumHills': 'Unexplored — here be ghouls. Mausoleum Hills is not open in this version yet.',
};

/** English fallback for a sign key (S8 adds the i18n strings). */
export function fallbackSignText(key: string): string {
  return UNFINISHED_FALLBACK_TEXT[key] ?? 'UNDER CONSTRUCTION — not open in this version yet.';
}

/** Open-world edges of an unfinished rect: world segments along its border where an open region lies outside. Pure. */
export function openEdges(rect: WorldRect, open: readonly WorldRect[]): { x0: number; z0: number; x1: number; z1: number; side: 'n' | 's' | 'w' | 'e' }[] {
  const inOpen = (x: number, z: number) => open.some((r) => x >= r.x0 && x < r.x1 && z >= r.z0 && z < r.z1);
  const out: { x0: number; z0: number; x1: number; z1: number; side: 'n' | 's' | 'w' | 'e' }[] = [];
  const runs = (n: number, test: (i: number) => boolean, emit: (a: number, b: number) => void) => {
    let i = 0;
    while (i < n) {
      if (!test(i)) {
        i++;
        continue;
      }
      let j = i;
      while (j < n && test(j)) j++;
      emit(i, j);
      i = j;
    }
  };
  const w = rect.x1 - rect.x0;
  const d = rect.z1 - rect.z0;
  runs(w, (i) => inOpen(rect.x0 + i, rect.z0 - 1), (a, b) => out.push({ x0: rect.x0 + a, z0: rect.z0, x1: rect.x0 + b, z1: rect.z0, side: 'n' }));
  runs(w, (i) => inOpen(rect.x0 + i, rect.z1), (a, b) => out.push({ x0: rect.x0 + a, z0: rect.z1, x1: rect.x0 + b, z1: rect.z1, side: 's' }));
  runs(d, (i) => inOpen(rect.x0 - 1, rect.z0 + i), (a, b) => out.push({ x0: rect.x0, z0: rect.z0 + a, x1: rect.x0, z1: rect.z0 + b, side: 'w' }));
  runs(d, (i) => inOpen(rect.x1, rect.z0 + i), (a, b) => out.push({ x0: rect.x1, z0: rect.z0 + a, x1: rect.x1, z1: rect.z0 + b, side: 'e' }));
  return out;
}

/**
 * Unfinished area (§1.10 placeholder until ZSM's S9 kit): hatched ground over the whole region; along every edge
 * that faces open land a striped construction fence (`underConstruction`, orange/white, 1.2 m) or a tall hedge
 * (`unexplored`, 2.4 m); a sign post per `UnfinishedArea.signs` with a hazard-chevron board, a barrier icon and the
 * text (the text is ALSO in the DOM via SignView). Pattern, height and shape carry the meaning, not colour or text alone.
 */
export class UnfinishedVisual extends BaseVisual {
  build(tier: RenderTier): void {
    this.tier = tier;
    const u: UnfinishedArea | undefined = this.def.unfinished;
    const construction = (u?.kind ?? 'underConstruction') === 'underConstruction';
    const { width: W, depth: D } = this.def.placement;
    const ground = new GeoBuilder().ground(0, 0, W, D, 0.012);
    this.mesh(this.track.geometry(ground.build()), construction ? this.ctx.kit.dirt : this.ctx.kit.hedgeGround, 'unfinished-ground');
    // boundary along open edges (region placement is rot 0 for every Mildew Lane frontier: local = world − origin)
    const ox = this.def.placement.originX;
    const oz = this.def.placement.originZ;
    const rect = { x0: ox, z0: oz, x1: ox + W, z1: oz + D };
    const fence = new GeoBuilder();
    for (const e of openEdges(rect, this.ctx.openRects)) {
      const horizontal = e.side === 'n' || e.side === 's';
      const len = horizontal ? e.x1 - e.x0 : e.z1 - e.z0;
      const inset = 0.35;
      for (let i = 0; i < len; i++) {
        const lx = (horizontal ? e.x0 + i : e.x0) - ox;
        const lz = (horizontal ? e.z0 : e.z0 + i) - oz;
        const ix = e.side === 'w' ? inset : e.side === 'e' ? -inset : 0;
        const iz = e.side === 'n' ? inset : e.side === 's' ? -inset : 0;
        if (construction) {
          const stripe = i % 2 === 0 ? '#e0701c' : '#efe9dc';
          if (horizontal) {
            fence.box(lx + 0.05, 0.15, lz + iz - 0.05, lx + 0.95, 1.15, lz + iz + 0.05, stripe);
            fence.box(lx - 0.04, 0, lz + iz - 0.06, lx + 0.06, 1.3, lz + iz + 0.06, '#5a5148');
          } else {
            fence.box(lx + ix - 0.05, 0.15, lz + 0.05, lx + ix + 0.05, 1.15, lz + 0.95, stripe);
            fence.box(lx + ix - 0.06, 0, lz - 0.04, lx + ix + 0.06, 1.3, lz + 0.06, '#5a5148');
          }
        } else if (horizontal) fence.box(lx, 0, lz + iz - 0.45, lx + 1, 2.4, lz + iz + 0.45, i % 3 === 0 ? '#1f3a22' : '#24432a');
        else fence.box(lx + ix - 0.45, 0, lz, lx + ix + 0.45, 2.4, lz + 1, i % 3 === 0 ? '#1f3a22' : '#24432a');
      }
    }
    // sign posts + boards (shared flat material for the post, per-sign canvas texture for the board)
    for (const [i, s] of (u?.signs ?? []).entries()) {
      if (s.regionId !== this.regionId) continue;
      const fx = Math.sin(s.facing);
      const fz = Math.cos(s.facing);
      // post
      fence.box(s.x - 0.07, 0, s.z - 0.07, s.x + 0.07, 2.1, s.z + 0.07, '#4a4038');
      // road barrier in front of the sign (striped, hip height): the "closed" shape
      const bx = s.x + fx * 1.2;
      const bz = s.z + fz * 1.2;
      const along = Math.abs(fx) > Math.abs(fz);
      for (let k = -2; k < 2; k++) {
        const c = k % 2 === 0 ? '#d63a2a' : '#f2efe6';
        if (along) fence.box(bx - 0.06, 0.6, bz + k * 0.5, bx + 0.06, 0.9, bz + k * 0.5 + 0.5, c);
        else fence.box(bx + k * 0.5, 0.6, bz - 0.06, bx + k * 0.5 + 0.5, 0.9, bz + 0.06, c);
      }
      for (const k of [-2, 2]) {
        if (along) fence.box(bx - 0.05, 0, bz + k * 0.5 - 0.05, bx + 0.05, 0.9, bz + k * 0.5 + 0.05, '#3d3a36');
        else fence.box(bx + k * 0.5 - 0.05, 0, bz - 0.05, bx + k * 0.5 + 0.05, 0.9, bz + 0.05, '#3d3a36');
      }
      this.buildBoard(s.x, s.z, s.facing, u!, i, construction);
    }
    if (!fence.empty) this.mesh(this.track.geometry(fence.build()), this.ctx.kit.flat, 'unfinished-boundary', this.ctx.profile === 'desktop' && tier === 'active');
  }

  private buildBoard(x: number, z: number, facing: number, u: UnfinishedArea, i: number, construction: boolean): void {
    const text = this.ctx.signText(u.signTextKey);
    const sc = this.ctx.toScene(x, z);
    this.signs.push({ id: `${u.id}#${i}`, textKey: u.signTextKey, text, x: sc.x, z: sc.z });
    const geo = this.track.geometry(new GeoBuilder().panel(-1.2, 1.2, 1.2, 2.3, 0.08, true).build());
    let mat: THREE.MeshStandardMaterial;
    if (canvasOk()) {
      try {
        const tex = this.track.texture(new THREE.CanvasTexture(signCanvas(text, construction)));
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        mat = this.track.material(new THREE.MeshStandardMaterial({ name: 'sign-board', map: tex, roughness: 0.8, side: THREE.DoubleSide }));
      } catch {
        mat = this.track.material(new THREE.MeshStandardMaterial({ name: 'sign-board', color: construction ? '#e0a21c' : '#6d7a5c', side: THREE.DoubleSide }));
      }
    } else mat = this.track.material(new THREE.MeshStandardMaterial({ name: 'sign-board', color: construction ? '#e0a21c' : '#6d7a5c', side: THREE.DoubleSide }));
    const m = new THREE.Mesh(geo, mat);
    m.name = `sign:${u.id}#${i}`;
    m.position.set(x, 0, z);
    m.rotation.y = facing;
    m.castShadow = false;
    m.receiveShadow = true;
    m.userData.signText = text;
    this.root.add(m);
  }
}

/** Sign board art: chevron hazard border (shape), a barrier icon (shape), a colour band and the text. */
export function signCanvas(text: string, construction: boolean): HTMLCanvasElement {
  const w = 512;
  const h = 236;
  const c = makeCanvas(w, h);
  const g = ctx2d(c);
  g.fillStyle = construction ? '#f0b323' : '#c9d1b8';
  g.fillRect(0, 0, w, h);
  // chevron border
  g.save();
  g.beginPath();
  g.rect(0, 0, w, h);
  g.rect(18, 18, w - 36, h - 36);
  g.clip('evenodd');
  g.fillStyle = construction ? '#1b1b1b' : '#33402b';
  for (let x = -h; x < w + h; x += 36) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + 18, 0);
    g.lineTo(x + 18 - h, h);
    g.lineTo(x - h, h);
    g.closePath();
    g.fill();
  }
  g.restore();
  // icon: a striped road barrier on two legs (construction) / a hedge with a question mark (unexplored)
  g.fillStyle = '#1b1b1b';
  if (construction) {
    g.fillRect(44, 70, 10, 90);
    g.fillRect(130, 70, 10, 90);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? '#f2efe6' : '#d63a2a';
      g.fillRect(34 + i * 30, 80, 30, 26);
    }
  } else {
    g.fillStyle = '#2d4a2a';
    g.beginPath();
    g.arc(92, 120, 48, Math.PI, 0);
    g.fill();
    g.fillStyle = '#1b1b1b';
    g.font = 'bold 64px sans-serif';
    g.fillText('?', 76, 112);
  }
  // text (decoration of the DOM string): wrap into the right panel
  g.fillStyle = '#141414';
  g.font = 'bold 26px sans-serif';
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const wd of words) {
    const t = line ? `${line} ${wd}` : wd;
    if (g.measureText(t).width > 300 && line) {
      lines.push(line);
      line = wd;
    } else line = t;
  }
  if (line) lines.push(line);
  lines.slice(0, 5).forEach((l, i) => g.fillText(l, 180, 64 + i * 32));
  return c;
}

/** Factory: the visual for a region def (null for the home, drawn by the lot layers). */
export function createRegionVisual(def: WorldRegionDef, ctx: VisualContext): BaseVisual | null {
  if (def.kind === 'street') return new StreetVisual(def.id, ctx, def);
  if (def.kind === 'unfinished') return new UnfinishedVisual(def.id, ctx, def);
  if (def.kind === 'lot') {
    if (def.templateId === CORNER_PARK_TEMPLATE || def.templateId === GRAVEYARD_TEMPLATE) return new CommunityVisual(def.id, ctx, def);
    return new LotVisual(def.id, ctx, def);
  }
  return null;
}

export type { BaseVisual };
