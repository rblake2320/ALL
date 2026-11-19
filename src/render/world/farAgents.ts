/**
 * Far-agent LOD (W-025 S5, docs/DESIGN_WORLD_LEVELS.md §1.4 budget row "farther agents as a 1-draw capsule LOD"):
 * agents standing in a WARM region (shell only, no rigs) are drawn as tinted capsules in ONE instanced draw call, at
 * most `FAR_AGENT_MAX` of them, nearest to the camera focus first. Agents in active regions keep their full rigs;
 * agents in cold regions are not drawn. Owns its geometry / material / instance buffer (freed in dispose()).
 */
import * as THREE from 'three';

/** Capsules drawn at most (one instanced draw however many: §1.4 budgets 12, the 32-agent cap needs up to 25). */
export const FAR_AGENT_MAX = 32;

export interface FarAgent {
  id: string;
  /** Scene position (feet). */
  x: number;
  z: number;
  color: string | null;
}

export class FarAgents {
  readonly mesh: THREE.InstancedMesh;
  private readonly geo: THREE.CapsuleGeometry;
  private readonly mat: THREE.MeshStandardMaterial;
  private readonly m = new THREE.Matrix4();
  private readonly c = new THREE.Color();
  private ids: string[] = [];

  constructor() {
    this.geo = new THREE.CapsuleGeometry(0.24, 1.05, 3, 8).translate(0, 0.765, 0);
    this.mat = new THREE.MeshStandardMaterial({ name: 'far-agent', roughness: 0.85 });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, FAR_AGENT_MAX);
    this.mesh.name = 'far-agents';
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(FAR_AGENT_MAX * 3), 3);
  }

  /** Draw these agents (the nearest `FAR_AGENT_MAX` to (fx, fz) win). Returns how many are drawn. */
  set(list: readonly FarAgent[], fx: number, fz: number): number {
    const sorted = list
      .filter((a) => a && Number.isFinite(a.x) && Number.isFinite(a.z))
      .sort((a, b) => Math.hypot(a.x - fx, a.z - fz) - Math.hypot(b.x - fx, b.z - fz) || (a.id < b.id ? -1 : 1));
    const n = Math.min(FAR_AGENT_MAX, sorted.length);
    this.ids = [];
    for (let i = 0; i < n; i++) {
      const a = sorted[i];
      this.m.makeTranslation(a.x, 0, a.z);
      this.mesh.setMatrixAt(i, this.m);
      this.c.set('#6b7a5a');
      if (typeof a.color === 'string' && /^#[0-9a-f]{6}$/i.test(a.color)) this.c.set(a.color);
      this.mesh.setColorAt(i, this.c);
      this.ids.push(a.id);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return n;
  }

  drawn(): readonly string[] {
    return this.ids;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geo.dispose();
    this.mat.dispose();
  }
}
