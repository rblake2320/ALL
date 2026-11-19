/**
 * Screen ↔ world helpers: client (CSS px, relative to the canvas) → camera ray / ground point, and
 * world → client projection with visibility.
 */
import * as THREE from 'three';
import { rayPlaneY } from './rayMath';

export class Picker {
  private readonly ndc = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private readonly v = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly size: () => { width: number; height: number },
  ) {}

  /** Camera ray through a client point; null for garbage input. The returned ray is reused — copy if kept. */
  ray(clientX: number, clientY: number): THREE.Ray | null {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    const { width, height } = this.size();
    if (!(width > 0) || !(height > 0)) return null;
    this.ndc.set((clientX / width) * 2 - 1, -(clientY / height) * 2 + 1);
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster.ray;
  }

  /** Ground (y = h) point under a client point. */
  ground(clientX: number, clientY: number, out: THREE.Vector3, h = 0): THREE.Vector3 | null {
    const r = this.ray(clientX, clientY);
    if (!r) return null;
    const t = rayPlaneY(r.origin.y, r.direction.y, h);
    if (t === Infinity || t > 5000) return null;
    return r.at(t, out);
  }

  /** World → client CSS px. visible = in front of the camera and inside the viewport. */
  project(x: number, y: number, z: number): { x: number; y: number; visible: boolean; depth: number } {
    const { width, height } = this.size();
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return { x: 0, y: 0, visible: false, depth: Infinity };
    this.v.set(x, y, z);
    const depth = this.v.distanceTo(this.camera.position);
    this.v.project(this.camera);
    const sx = ((this.v.x + 1) / 2) * width;
    const sy = ((1 - this.v.y) / 2) * height;
    const inFront = this.v.z > -1 && this.v.z < 1;
    const inside = sx >= 0 && sx <= width && sy >= 0 && sy <= height;
    return { x: Number.isFinite(sx) ? sx : 0, y: Number.isFinite(sy) ? sy : 0, visible: inFront && inside, depth };
  }
}
