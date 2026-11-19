/**
 * Buy-mode placement ghost: a translucent (≈0.55) copy of the model tinted green (valid) / red (invalid),
 * footprint tile decals and X markers on blocked slots. Owns its cloned materials.
 */
import * as THREE from 'three';
import type { ModelLibrary, PlacementGhost } from '../contracts';
import type { SpecResolver } from '../core/specs';
import type { ThrottledWarn } from '../core/diagnostics';
import { placementTransform, createPlacementTransform, normalizeRot } from '../objects/placement';
import { openingTransform, parseEdgeKey, wallItemTransform, normalizeSide, type EdgeTransform } from '../build/edges';
import { normalizeTint } from '../thumbs/thumbKey';
import { makeCanvas, ctx2d } from '../world/canvasUtil';

export const GHOST_OPACITY = 0.55;
const VALID = new THREE.Color('#9fe870');
const INVALID = new THREE.Color('#ff6a55');
const MAX_TILES = 128;

function tileTexture(): THREE.CanvasTexture {
  const c = makeCanvas(64, 64);
  const g = ctx2d(c);
  g.clearRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,255,255,0.28)';
  g.beginPath();
  g.roundRect(5, 5, 54, 54, 9);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(5, 5, 54, 54, 9);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function crossTexture(): THREE.CanvasTexture {
  const c = makeCanvas(64, 64);
  const g = ctx2d(c);
  g.clearRect(0, 0, 64, 64);
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(40,10,10,0.6)';
  g.lineWidth = 12;
  for (const k of [0, 1]) {
    g.beginPath();
    g.moveTo(14, 14);
    g.lineTo(50, 50);
    g.moveTo(50, 14);
    g.lineTo(14, 50);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.lineWidth = 7;
    void k;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class PlacementGhostView {
  readonly group = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private modelKey = '';
  private readonly materials: THREE.Material[] = [];
  private readonly tiles: THREE.InstancedMesh;
  private readonly crosses: THREE.InstancedMesh;
  private readonly owned: { dispose(): void }[] = [];
  private readonly tf = createPlacementTransform();
  private readonly et: EdgeTransform = { x: 0, y: 0, z: 0, yaw: 0 };
  private valid = true;
  private readonly m4 = new THREE.Matrix4();
  private ghost: PlacementGhost | null = null;

  constructor(
    private readonly models: ModelLibrary,
    private readonly specs: SpecResolver,
    private readonly warn: ThrottledWarn,
  ) {
    this.group.name = 'placement-ghost';
    const quad = new THREE.PlaneGeometry(0.96, 0.96);
    quad.rotateX(-Math.PI / 2);
    const tileTex = tileTexture();
    const tileMat = new THREE.MeshBasicMaterial({ map: tileTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.tiles = new THREE.InstancedMesh(quad, tileMat, MAX_TILES);
    this.tiles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TILES * 3), 3);
    this.tiles.count = 0;
    this.tiles.renderOrder = 6;
    const crossTex = crossTexture();
    const crossMat = new THREE.MeshBasicMaterial({ map: crossTex, color: '#ff6a55', transparent: true, depthWrite: false, depthTest: false });
    const cq = new THREE.PlaneGeometry(0.5, 0.5);
    cq.rotateX(-Math.PI / 2);
    this.crosses = new THREE.InstancedMesh(cq, crossMat, 32);
    this.crosses.count = 0;
    this.crosses.renderOrder = 30;
    this.owned.push(quad, tileTex, tileMat, crossTex, crossMat, cq);
    for (const m of [this.tiles, this.crosses]) {
      m.frustumCulled = false;
      m.raycast = () => undefined;
    }
    this.group.add(this.tiles, this.crosses);
    this.group.visible = false;
  }

  set(ghost: PlacementGhost | null): void {
    this.ghost = ghost && typeof ghost === 'object' && typeof ghost.defId === 'string' ? ghost : null;
    if (!this.ghost) {
      this.group.visible = false;
      return;
    }
    const g = this.ghost;
    this.group.visible = true;
    const key = `${g.defId}|${normalizeTint(g.tint) ?? ''}`;
    if (key !== this.modelKey) this.swapModel(g.defId, normalizeTint(g.tint), key);
    this.valid = g.valid !== false;
    this.applyTint();
    this.placeModel(g);
    this.placeTiles(g);
  }

  private swapModel(defId: string, tint: string | null, key: string): void {
    this.clearModel();
    this.modelKey = key;
    try {
      const inst = this.models.create(defId, tint);
      inst.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = false;
        m.receiveShadow = false;
        m.raycast = () => undefined;
        const src = Array.isArray(m.material) ? m.material : [m.material];
        const clones = src.map((mat) => {
          const c = mat.clone();
          c.transparent = true;
          c.opacity = GHOST_OPACITY * (mat.transparent ? Math.max(0.3, mat.opacity) : 1);
          c.depthWrite = false;
          this.materials.push(c);
          return c;
        });
        m.material = Array.isArray(m.material) ? clones : clones[0];
        m.renderOrder = 25;
      });
      this.model = inst;
      this.group.add(inst);
    } catch (e) {
      this.warn.warn('ghost-create', `ghost model ${defId} failed`, e);
      this.model = null;
    }
  }

  private applyTint(): void {
    const c = this.valid ? VALID : INVALID;
    for (const m of this.materials) {
      const s = m as THREE.MeshStandardMaterial;
      if (s.emissive) {
        s.emissive.copy(c);
        s.emissiveIntensity = 0.45;
      } else if ((m as THREE.MeshBasicMaterial).color) (m as THREE.MeshBasicMaterial).color.lerp(c, 0.4);
    }
  }

  private placeModel(g: PlacementGhost): void {
    if (!this.model) return;
    const spec = this.specs.get(g.defId);
    let ok = false;
    const edge = parseEdgeKey(g.edge);
    if (edge && (spec?.placement === 'wall' || spec?.placement === 'door' || spec?.placement === 'window' || g.side !== undefined)) {
      if (spec?.placement === 'wall') wallItemTransform(edge, normalizeSide(g.side), this.et);
      else openingTransform(edge, this.et);
      this.model.position.set(this.et.x, 0, this.et.z);
      this.model.rotation.set(0, this.et.yaw, 0);
      ok = true;
    } else if (Number.isFinite(g.x) && Number.isFinite(g.z)) {
      placementTransform({ kind: 'floor', x: g.x as number, z: g.z as number, rot: normalizeRot(g.rot) }, spec?.footprint ?? null, this.tf);
      ok = this.tf.visible;
      this.model.position.set(this.tf.x, 0.01, this.tf.z);
      this.model.rotation.set(0, this.tf.yaw, 0);
    }
    this.model.visible = ok;
  }

  private placeTiles(g: PlacementGhost): void {
    const tiles = Array.isArray(g.tiles) ? g.tiles : [];
    const c = this.valid ? VALID : INVALID;
    let n = 0;
    for (const t of tiles) {
      if (n >= MAX_TILES) break;
      if (!t || !Number.isFinite(t.x) || !Number.isFinite(t.z)) continue;
      this.m4.makeTranslation(Math.floor(t.x) + 0.5, 0.018, Math.floor(t.z) + 0.5);
      this.tiles.setMatrixAt(n, this.m4);
      this.tiles.setColorAt(n, c);
      n++;
    }
    this.tiles.count = n;
    this.tiles.instanceMatrix.needsUpdate = true;
    if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
    const blocked = Array.isArray(g.blockedSlots) ? g.blockedSlots : [];
    let b = 0;
    for (const t of blocked) {
      if (b >= 32) break;
      if (!t || !Number.isFinite(t.x) || !Number.isFinite(t.z)) continue;
      this.m4.makeTranslation(Math.floor(t.x) + 0.5, 0.05, Math.floor(t.z) + 0.5);
      this.crosses.setMatrixAt(b++, this.m4);
    }
    this.crosses.count = b;
    this.crosses.instanceMatrix.needsUpdate = true;
  }

  /** Gentle opacity pulse so the ghost reads as "not placed yet". */
  update(t: number): void {
    if (!this.ghost || !this.model) return;
    const k = 0.9 + 0.1 * Math.sin(t * 4);
    for (const m of this.materials) m.opacity = GHOST_OPACITY * k;
  }

  private clearModel(): void {
    if (this.model) {
      this.group.remove(this.model);
      try {
        this.models.release?.(this.model);
      } catch {
        /* optional */
      }
    }
    this.model = null;
    for (const m of this.materials) m.dispose();
    this.materials.length = 0;
    this.modelKey = '';
  }

  dispose(): void {
    this.clearModel();
    this.tiles.dispose();
    this.crosses.dispose();
    for (const o of this.owned) o.dispose();
  }
}
