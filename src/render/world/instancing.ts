/**
 * Collapse many copies of a static model into InstancedMeshes (one draw call per sub-mesh) — used for fences,
 * trees, gravestones and neighbour houses. Skinned/morphing meshes fall back to plain clones.
 */
import * as THREE from 'three';

export interface InstancedProps {
  group: THREE.Group;
  /** Owned instanced meshes (dispose() frees only their instance buffers; geometry/material stay shared). */
  meshes: THREE.InstancedMesh[];
}

function visibleChain(o: THREE.Object3D, root: THREE.Object3D): boolean {
  let n: THREE.Object3D | null = o;
  while (n) {
    if (!n.visible) return false;
    if (n === root) return true;
    n = n.parent;
  }
  return true;
}

/**
 * @param template a freshly created model instance (not added to the scene; consumed)
 * @param transforms world matrices, one per copy
 */
export function instanceModel(template: THREE.Object3D, transforms: readonly THREE.Matrix4[], opts: { castShadow: boolean; receiveShadow: boolean; name?: string }): InstancedProps {
  const group = new THREE.Group();
  group.name = opts.name ?? 'instanced';
  const meshes: THREE.InstancedMesh[] = [];
  if (transforms.length === 0) return { group, meshes };
  template.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(template.matrixWorld).invert();
  const local = new THREE.Matrix4();
  const m = new THREE.Matrix4();
  let fallback = false;
  template.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh || (mesh.morphTargetInfluences && mesh.morphTargetInfluences.length > 0)) {
      fallback = true;
      return;
    }
    if (!visibleChain(mesh, template)) return;
    local.multiplyMatrices(rootInv, mesh.matrixWorld);
    const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, transforms.length);
    for (let i = 0; i < transforms.length; i++) {
      m.multiplyMatrices(transforms[i], local);
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = opts.castShadow;
    im.receiveShadow = opts.receiveShadow;
    im.name = mesh.name;
    im.computeBoundingSphere();
    group.add(im);
    meshes.push(im);
  });
  if (fallback) {
    // rare: deformable env props — keep plain clones (correct, just more draw calls)
    for (const mesh of meshes) {
      group.remove(mesh);
      mesh.dispose();
    }
    meshes.length = 0;
    for (const t of transforms) {
      const c = template.clone(true);
      c.matrixAutoUpdate = false;
      c.matrix.copy(t);
      c.traverse((o) => {
        const me = o as THREE.Mesh;
        if (me.isMesh) {
          me.castShadow = opts.castShadow;
          me.receiveShadow = opts.receiveShadow;
        }
      });
      group.add(c);
    }
  }
  return { group, meshes };
}

/** Build a world matrix from position + yaw (+ optional uniform scale). */
export function placeMatrix(x: number, y: number, z: number, yaw: number, scale = 1, out = new THREE.Matrix4()): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return out.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(scale, scale, scale));
}
