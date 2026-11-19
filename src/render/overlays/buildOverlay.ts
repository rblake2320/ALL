/**
 * Build-mode overlays: translucent wall preview segments (green add / red remove), tile highlights for
 * floor-paint / room / delete tools (tinted by the paint style), a cost/label sprite, and the hovered-edge
 * glow line under the cursor.
 */
import * as THREE from 'three';
import type { BuildOverlay } from '../contracts';
import type { EdgeKey } from '../../sim/types';
import { DIM } from '../../shared/dimensions';
import { FLOOR_STYLE_BY_ID, WALL_STYLE_BY_ID } from '../../shared/styles';
import { parseEdgeKey } from '../build/edges';
import { buildWallMesh } from '../build/wallGeometry';
import { gridLayout } from '../build/atlasLayout';
import type { WallSegment } from '../../sim/types';
import { makeCanvas, ctx2d } from '../world/canvasUtil';

/** Dummy atlas cells: preview walls are flat-shaded, UVs are irrelevant. */
const PREVIEW_CELLS = gridLayout(16, 4, 8, 8, 0).cells;

const ADD = new THREE.Color('#9fe870');
const REMOVE = new THREE.Color('#ff6a55');
const ROOM = new THREE.Color('#9fe870');
const MAX_EDGES = 512;
const MAX_TILES = 1024;

function tileTex(): THREE.CanvasTexture {
  const c = makeCanvas(64, 64);
  const g = ctx2d(c);
  g.fillStyle = 'rgba(255,255,255,0.42)';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 2;
  g.strokeRect(2, 2, 60, 60);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class BuildOverlayView {
  readonly group = new THREE.Group();
  /** Wall preview: depth pre-pass + translucent colour pass sharing one merged geometry (clean single shell). */
  private readonly wallDepth: THREE.Mesh;
  private readonly wallColor: THREE.Mesh;
  private wallKey = '';
  private readonly tiles: THREE.InstancedMesh;
  private readonly hover: THREE.Mesh;
  private readonly label: THREE.Sprite;
  private labelText = '';
  private labelTex: THREE.CanvasTexture | null = null;
  private readonly labelCanvas = makeCanvas(256, 64);
  private readonly owned: { dispose(): void }[] = [];
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();
  private hoverEdge: EdgeKey | null = null;
  /** True while the controller drives the hovered edge through BuildOverlay.hoverEdge. */
  private explicitHover = false;
  private wallMat: THREE.MeshStandardMaterial;

  constructor() {
    this.group.name = 'build-overlay';
    this.wallMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      depthFunc: THREE.LessEqualDepth,
      emissive: ADD.clone(),
      emissiveIntensity: 0.6,
      roughness: 0.6,
    });
    const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });
    this.wallDepth = new THREE.Mesh(new THREE.BufferGeometry(), depthMat);
    this.wallDepth.renderOrder = 21;
    this.wallColor = new THREE.Mesh(this.wallDepth.geometry, this.wallMat);
    this.wallColor.renderOrder = 22;
    this.wallDepth.visible = false;
    this.wallColor.visible = false;
    this.owned.push(depthMat);
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.rotateX(-Math.PI / 2);
    const tt = tileTex();
    const tileMat = new THREE.MeshBasicMaterial({ map: tt, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.tiles = new THREE.InstancedMesh(quad, tileMat, MAX_TILES);
    this.tiles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TILES * 3), 3);
    this.tiles.count = 0;
    this.tiles.renderOrder = 6;
    const line = new THREE.BoxGeometry(1, 0.03, 0.1);
    const hoverMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#d8ffb8').multiplyScalar(1.6), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
    this.hover = new THREE.Mesh(line, hoverMat);
    this.hover.visible = false;
    this.hover.renderOrder = 23;
    const labelMat = new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false });
    this.label = new THREE.Sprite(labelMat);
    this.label.visible = false;
    this.label.renderOrder = 40;
    this.label.center.set(0.5, 0);
    this.owned.push(this.wallMat, quad, tt, tileMat, line, hoverMat, labelMat);
    for (const o of [this.wallDepth, this.wallColor, this.tiles, this.hover, this.label] as THREE.Object3D[]) {
      o.frustumCulled = false;
      o.raycast = () => undefined;
      this.group.add(o);
    }
  }

  set(o: BuildOverlay | null): void {
    if (!o || typeof o !== 'object') {
      this.setWalls([], false);
      this.tiles.count = 0;
      this.label.visible = false;
      if (this.explicitHover) {
        this.explicitHover = false;
        this.applyHoverEdge(null);
      }
      return;
    }
    if (o.hoverEdge !== undefined) {
      this.explicitHover = true;
      this.applyHoverEdge(typeof o.hoverEdge === 'string' ? o.hoverEdge : null);
    } else if (this.explicitHover) {
      this.explicitHover = false;
      this.applyHoverEdge(null);
    }
    const valid = o.valid !== false;
    // wall previews (merged like real walls: corner posts, no overlapping boxes)
    const edges = Array.isArray(o.edges) ? o.edges : [];
    const remove = o.edgeMode === 'remove';
    const col = !valid || remove ? REMOVE : ADD;
    this.wallMat.emissive.copy(col);
    this.wallMat.opacity = remove ? 0.5 : 0.42;
    let cx = 0;
    let cz = 0;
    let cy = 0;
    let cnt = 0;
    const keys: string[] = [];
    for (const k of edges) {
      if (keys.length >= MAX_EDGES) break;
      const e = parseEdgeKey(k);
      if (!e) continue;
      keys.push(k);
      cx += e.kind === 'h' ? e.x + 0.5 : e.x;
      cz += e.kind === 'h' ? e.z : e.z + 0.5;
      cy = DIM.WALL_HEIGHT;
      cnt++;
    }
    this.setWalls(keys, remove);
    // tiles
    const tiles = Array.isArray(o.tiles) ? o.tiles : [];
    let tc: THREE.Color = ROOM;
    if (o.tileMode === 'remove' || !valid) tc = REMOVE;
    else if (o.tileMode === 'paint') {
      const st = o.styleId ? FLOOR_STYLE_BY_ID[o.styleId] ?? WALL_STYLE_BY_ID[o.styleId] : undefined;
      tc = st ? this.tmpColor.set(st.base).lerp(ADD, 0.25) : ADD;
    }
    let t = 0;
    for (const tile of tiles) {
      if (t >= MAX_TILES) break;
      if (!tile || !Number.isFinite(tile.x) || !Number.isFinite(tile.z)) continue;
      const x = Math.floor(tile.x) + 0.5;
      const z = Math.floor(tile.z) + 0.5;
      this.m4.makeTranslation(x, 0.02, z);
      this.tiles.setMatrixAt(t, this.m4);
      this.tiles.setColorAt(t, tc);
      cx += x;
      cz += z;
      cnt++;
      t++;
    }
    this.tiles.count = t;
    this.tiles.instanceMatrix.needsUpdate = true;
    if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
    // label
    const text = typeof o.label === 'string' ? o.label.slice(0, 40) : '';
    if (text && cnt > 0) {
      if (text !== this.labelText) this.drawLabel(text, valid);
      this.label.visible = true;
      this.label.position.set(cx / cnt, (cy || 0.3) + 0.35, cz / cnt);
    } else this.label.visible = false;
  }

  private setWalls(keys: string[], remove: boolean): void {
    const key = (remove ? 'r|' : 'a|') + keys.join(',');
    if (key === this.wallKey) return;
    this.wallKey = key;
    const old = this.wallDepth.geometry;
    if (keys.length === 0) {
      this.wallDepth.visible = false;
      this.wallColor.visible = false;
      return;
    }
    const walls: Record<string, WallSegment> = {};
    for (const k of keys) walls[k] = { paint: ['', ''], openingId: null };
    // removal previews wrap the existing wall slightly
    const data = buildWallMesh(walls, () => null, PREVIEW_CELLS, { thickness: DIM.WALL_THICKNESS + (remove ? 0.07 : 0.015), height: DIM.WALL_HEIGHT + (remove ? 0.05 : 0.01) });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.computeBoundingSphere();
    this.wallDepth.geometry = geo;
    this.wallColor.geometry = geo;
    this.wallDepth.visible = true;
    this.wallColor.visible = true;
    old.dispose();
  }

  private drawLabel(text: string, valid: boolean): void {
    this.labelText = text;
    const c = this.labelCanvas;
    const g = ctx2d(c);
    g.clearRect(0, 0, c.width, c.height);
    g.font = '600 30px "Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif';
    const w = Math.min(c.width - 8, g.measureText(text).width + 36);
    const x = (c.width - w) / 2;
    g.fillStyle = 'rgba(29,23,38,0.88)';
    g.beginPath();
    g.roundRect(x, 6, w, 50, 14);
    g.fill();
    g.strokeStyle = valid ? 'rgba(159,232,112,0.75)' : 'rgba(255,106,85,0.85)';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = valid ? '#e8e0c8' : '#ffb3a6';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, c.width / 2, 32);
    if (!this.labelTex) {
      this.labelTex = new THREE.CanvasTexture(c);
      this.labelTex.colorSpace = THREE.SRGBColorSpace;
      (this.label.material as THREE.SpriteMaterial).map = this.labelTex;
      (this.label.material as THREE.SpriteMaterial).needsUpdate = true;
    } else this.labelTex.needsUpdate = true;
    this.label.scale.set(2.0, 0.5, 1);
  }

  /** Hovered edge from pickGrid (build mode). Ignored while the overlay drives `hoverEdge` explicitly. */
  setHoverEdge(edge: EdgeKey | null): void {
    if (this.explicitHover) return;
    this.applyHoverEdge(edge);
  }

  private applyHoverEdge(edge: EdgeKey | null): void {
    if (edge === this.hoverEdge) return;
    this.hoverEdge = edge;
    const e = parseEdgeKey(edge);
    if (!e) {
      this.hover.visible = false;
      return;
    }
    this.hover.visible = true;
    if (e.kind === 'h') {
      this.hover.position.set(e.x + 0.5, 0.03, e.z);
      this.hover.rotation.set(0, 0, 0);
    } else {
      this.hover.position.set(e.x, 0.03, e.z + 0.5);
      this.hover.rotation.set(0, Math.PI / 2, 0);
    }
  }

  update(t: number): void {
    if (this.hover.visible) (this.hover.material as THREE.MeshBasicMaterial).opacity = 0.65 + 0.25 * Math.sin(t * 5);
  }

  dispose(): void {
    this.wallDepth.geometry.dispose();
    this.tiles.dispose();
    this.labelTex?.dispose();
    for (const o of this.owned) o.dispose();
  }
}
