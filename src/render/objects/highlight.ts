/**
 * Hover rim for furniture: adds a fresnel "ghost rim" shell (shared geometry, additive) to every mesh of the
 * hovered object, and removes it again. Library materials are shared between instances, so we never touch them.
 */
import * as THREE from 'three';

const rimVertex = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
const rimFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float rim = pow(f, 2.2) * uStrength + 0.06 * uStrength;
  gl_FragColor = vec4(uColor * rim, rim);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createRimMaterial(color = '#9fe870', strength = 0.9): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'hover-rim',
    vertexShader: rimVertex,
    fragmentShader: rimFragment,
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } },
    transparent: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

/** Was `m` folded into a static batch of `root`? (the batcher lists the originals on root.userData.__staticBatch) */
function isBatchedOriginal(m: THREE.Mesh, root: THREE.Object3D): boolean {
  const info = root.userData && (root.userData.__staticBatch as { sources?: THREE.Mesh[] } | undefined);
  return !!info && Array.isArray(info.sources) && info.sources.includes(m);
}

export class ObjectHighlighter {
  private readonly material = createRimMaterial();
  private target: THREE.Object3D | null = null;
  private shells: THREE.Mesh[] = [];

  /** Highlight `root` (null clears). Idempotent. */
  set(root: THREE.Object3D | null): void {
    if (root === this.target) return;
    this.clear();
    if (!root) return;
    this.target = root;
    // collect first, attach after, so the traversal never visits our own shells
    const pairs: [THREE.Mesh, THREE.Object3D][] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || m.userData.__rimShell || m.userData.staticChunk) return;
      if (!m.geometry || !m.geometry.getAttribute('normal')) return;
      // a static batch may be hidden while merged into a lot chunk: its shell hangs off the batch's parent instead
      // (batched originals are hidden for good, so their shells would never show — the batch shell covers them)
      if (m.userData.staticBatch === true) {
        if (m.parent) pairs.push([m, m.parent]);
        return;
      }
      if (!m.visible && isBatchedOriginal(m, root)) return;
      pairs.push([m, m]);
    });
    for (const [m, parent] of pairs) {
      const shell = new THREE.Mesh(m.geometry, this.material);
      shell.userData.__rimShell = true;
      shell.renderOrder = 15;
      shell.castShadow = false;
      shell.receiveShadow = false;
      shell.raycast = () => undefined;
      if (parent !== m) {
        shell.position.copy(m.position);
        shell.quaternion.copy(m.quaternion);
        shell.scale.copy(m.scale);
      }
      this.shells.push(shell);
      parent.add(shell);
    }
  }

  current(): THREE.Object3D | null {
    return this.target;
  }

  clear(): void {
    for (const s of this.shells) s.parent?.remove(s);
    this.shells = [];
    this.target = null;
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
  }
}
