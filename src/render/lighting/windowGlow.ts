/**
 * Night window glow: materials named 'Glass' (ART_DIRECTION) on windows and neighbour houses are swapped for
 * renderer-owned clones whose emissive is driven by the time of day. Clones are shared per original material
 * (and per variant) so a whole street of windows costs no extra programs.
 */
import * as THREE from 'three';

const CANDLE = new THREE.Color('#ffb35a');

function isGlass(m: THREE.Material): boolean {
  return typeof m.name === 'string' && m.name.toLowerCase().includes('glass');
}

interface GlowEntry {
  mat: THREE.MeshStandardMaterial;
  strength: number;
}

export class WindowGlow {
  private readonly clones = new Map<string, GlowEntry>();
  private level = 0;

  /**
   * Replace every Glass material under `root` with a glow clone. `variant` lets groups glow differently
   * (e.g. neighbour houses dimmer than the player's lot). Returns the number of swapped materials.
   */
  apply(root: THREE.Object3D, variant = 'lot', strength = 1): number {
    let n = 0;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((m) => {
          const c = this.cloneFor(m, variant, strength);
          if (c !== m) n++;
          return c;
        });
      } else if (mesh.material) {
        const c = this.cloneFor(mesh.material, variant, strength);
        if (c !== mesh.material) n++;
        mesh.material = c;
      }
    });
    return n;
  }

  private cloneFor(m: THREE.Material, variant: string, strength: number): THREE.Material {
    if (!isGlass(m)) return m;
    if (this.isOwned(m)) return m;
    const std = m as THREE.MeshStandardMaterial;
    if (!std.isMeshStandardMaterial) return m;
    const key = `${m.uuid}|${variant}`;
    let e = this.clones.get(key);
    if (!e) {
      const clone = std.clone();
      clone.name = `${m.name}#glow`;
      clone.emissive = CANDLE.clone();
      clone.emissiveIntensity = 0;
      clone.userData = { ...clone.userData, windowGlow: true };
      e = { mat: clone, strength };
      this.clones.set(key, e);
      this.applyLevel(e);
    }
    return e.mat;
  }

  private isOwned(m: THREE.Material): boolean {
    return m.userData?.windowGlow === true;
  }

  private applyLevel(e: GlowEntry): void {
    e.mat.emissiveIntensity = this.level * 2.4 * e.strength;
    // lit glass reads as more opaque warm light; daytime glass stays as authored
    e.mat.opacity = Math.min(1, (e.mat.userData.baseOpacity ?? (e.mat.userData.baseOpacity = e.mat.opacity)) + this.level * 0.35);
  }

  /** 0 (day) .. 1 (night). Cheap: only touches the clone list when the level changes noticeably. */
  setLevel(level: number): void {
    const l = Number.isFinite(level) ? Math.min(Math.max(level, 0), 1) : 0;
    if (Math.abs(l - this.level) < 0.002) return;
    this.level = l;
    for (const e of this.clones.values()) this.applyLevel(e);
  }

  dispose(): void {
    for (const e of this.clones.values()) e.mat.dispose();
    this.clones.clear();
  }
}
