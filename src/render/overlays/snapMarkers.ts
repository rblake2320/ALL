/**
 * Snap-point markers (home build rules, docs/contract-requests/home-build-system.md step 2): glowing rings on the
 * ground where the item being placed may stand while the first 20 items still go on snap points. One InstancedMesh,
 * one draw call, a slow pulse; nothing is drawn when there are no points. Floor points are mint, garden points lime,
 * wall points cyan (a ring at the foot of the wall edge); service points (working furniture) pink.
 */
import * as THREE from 'three';

export interface SnapMarkerPoint {
  x: number;
  z: number;
  kind: string;
}

const CAPACITY = 1024;
const COLORS: Record<string, number> = { floor: 0x7cf0c0, garden: 0xb6f06a, wall: 0x7fd9ff, ceiling: 0xffd27f, service: 0xff7fd0 };

export class SnapMarkers {
  readonly group = new THREE.Group();
  private readonly geometry = new THREE.RingGeometry(0.17, 0.27, 28);
  private readonly material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
  private readonly mesh: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private count = 0;

  constructor() {
    this.group.name = 'snapMarkers';
    this.geometry.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, CAPACITY);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    this.group.add(this.mesh);
  }

  /** Show these points (or none). At most CAPACITY are drawn. */
  set(points: readonly SnapMarkerPoint[] | null): void {
    const list = points ?? [];
    const n = Math.min(list.length, CAPACITY);
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const p = list[i];
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
      this.dummy.position.set(p.x, 0.04, p.z);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, col.setHex(COLORS[p.kind] ?? COLORS.floor));
    }
    this.count = n;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  get visibleCount(): number {
    return this.count;
  }

  /** Slow pulse; `t` in seconds. */
  update(t: number): void {
    if (this.count === 0) return;
    this.material.opacity = 0.55 + 0.25 * Math.sin(t * 3);
  }

  dispose(): void {
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
