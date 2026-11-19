/**
 * CLIP-AUDIT on a synthetic SKINNED rig (three.js SkinnedMesh + AnimationMixer, CPU skinned by the audit's
 * extractor): the skinned soup must follow the bones exactly, a clip that swings a forearm into a box must read
 * as a penetration of that forearm (and a pose that stops short as a clean gap), the left/right mirrored clip
 * (the runtime's own mirrorClip) must give the mirrored result, and a scaled rig must scale the depth.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mirrorClip } from '../../../src/render/characters/clips';
import { extractMeshes } from '../../../tools/clip-audit/assets';
import { contactGap, makeSolid, penetration } from '../../../tools/clip-audit/detect';
import { boxMesh } from '../../../tools/clip-audit/shapes';

const SEG = 0.3;
const R = 0.04;

/** Two mirrored two-bone arms hanging from a root: upperarm_X (0..0.3 down) + forearm_X (0.3..0.6 down). */
function makeRig(): { root: THREE.Group; mesh: THREE.SkinnedMesh; bones: Map<string, THREE.Bone> } {
  const root = new THREE.Group();
  const hips = new THREE.Bone();
  hips.name = 'root';
  root.add(hips);
  const bones: THREE.Bone[] = [hips];
  const byName = new Map<string, THREE.Bone>([['root', hips]]);
  const pos: number[] = [];
  const si: number[] = [];
  const sw: number[] = [];
  const idx: number[] = [];
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 0.3 : -0.3; // character left = +X
    const up = new THREE.Bone();
    up.name = `upperarm_${side}`;
    up.position.set(sx, 1.4, 0);
    hips.add(up);
    const fo = new THREE.Bone();
    fo.name = `forearm_${side}`;
    fo.position.set(0, -SEG, 0);
    up.add(fo);
    bones.push(up, fo);
    byName.set(up.name, up).set(fo.name, fo);
    const iu = bones.indexOf(up);
    const iF = bones.indexOf(fo);
    // a square tube from y = 1.4 down to 0.8, rings every 2 cm, rigidly skinned by height
    const rings = 31;
    const base = pos.length / 3;
    for (let k = 0; k < rings; k++) {
      const y = 1.4 - (0.6 * k) / (rings - 1);
      for (const [dx, dz] of [[-R, -R], [R, -R], [R, R], [-R, R]]) {
        pos.push(sx + dx, y, dz);
        si.push(y > 1.1 + 1e-9 ? iu : iF, 0, 0, 0);
        sw.push(1, 0, 0, 0);
      }
    }
    for (let k = 0; k < rings - 1; k++) {
      for (let j = 0; j < 4; j++) {
        const a = base + k * 4 + j, b = base + k * 4 + ((j + 1) % 4), c = a + 4, d = b + 4;
        idx.push(a, b, c, b, d, c);
      }
    }
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    const e = base + (rings - 1) * 4;
    idx.push(e, e + 1, e + 2, e, e + 2, e + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  const mesh = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial());
  mesh.name = 'Body';
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  return { root, mesh, bones: byName };
}

/** Forearm_L folds by `deg` about the character's forward axis (+Z): the hand swings out toward +X (left). */
function foldClip(deg: number): THREE.AnimationClip {
  const q0 = new THREE.Quaternion();
  const q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (deg * Math.PI) / 180);
  return new THREE.AnimationClip('fold', 1, [
    new THREE.QuaternionKeyframeTrack('forearm_L.quaternion', [0, 1], [...q0.toArray(), ...q1.toArray()]),
  ]);
}

function pose(rig: ReturnType<typeof makeRig>, clip: THREE.AnimationClip, t: number): void {
  const mixer = new THREE.AnimationMixer(rig.root);
  const a = mixer.clipAction(clip);
  a.setLoop(THREE.LoopOnce, 1);
  a.clampWhenFinished = true; // t = duration samples the last key, not the wrapped first one
  a.play();
  mixer.setTime(t);
  rig.root.updateMatrixWorld(true);
}

describe('skinned rig through the audit extractor', () => {
  it('CPU skinning follows the bones exactly (bone-labelled vertices)', () => {
    const rig = makeRig();
    pose(rig, foldClip(90), 1);
    const m = extractMeshes(rig.root);
    expect(new Set(m.labels)).toEqual(new Set(['upperarm_L', 'forearm_L', 'upperarm_R', 'forearm_R']));
    // the left wrist end (rest y = 0.8 on x = 0.3) folds 90 deg about +Z around the elbow (0.3, 1.1): -> (0.6, 1.1)
    let tip = new THREE.Vector3(-9, 0, 0);
    for (let i = 0; i < m.pos.length / 3; i++) {
      if (m.labels[m.vLabel[i]] !== 'forearm_L') continue;
      if (m.pos[i * 3] > tip.x) tip = new THREE.Vector3(m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]);
    }
    expect(tip.x).toBeCloseTo(0.6, 5);
    expect(Math.abs(tip.y - 1.1)).toBeLessThanOrEqual(R + 1e-6);
  });

  it('catches a clip that drives the forearm into a box, and passes the pose that stops short', () => {
    const rig = makeRig();
    // a cabinet beside the left arm whose face is at x = 0.5: the folded forearm's wrist end reaches x = 0.6
    const cab = makeSolid(boxMesh([0.5, 0.9, -0.3], [1.0, 1.3, 0.3], 'cabinet'));
    pose(rig, foldClip(90), 1);
    const deep = penetration(makeSolid(extractMeshes(rig.root)), cab);
    expect(deep.worstPart).toBe('forearm_L');
    expect(deep.maxDepthMm).toBeGreaterThan(97);
    expect(deep.maxDepthMm).toBeLessThanOrEqual(100.1);
    // a third of the way into the fold the forearm stops short of the cabinet: clean, with a measurable gap
    const rig2 = makeRig();
    pose(rig2, foldClip(90), 1 / 3);
    const body = makeSolid(extractMeshes(rig2.root));
    expect(penetration(body, cab).maxDepthMm).toBe(0);
    const g = contactGap(body, cab, (l) => l === 'forearm_L');
    // the gap is the smallest distance from a forearm vertex to the cabinet box (brute force, point-to-AABB)
    let best = Infinity;
    for (let i = 0; i < body.mesh.pos.length / 3; i++) {
      if (body.mesh.labels[body.mesh.vLabel[i]] !== 'forearm_L') continue;
      const [x, y, z] = [body.mesh.pos[i * 3], body.mesh.pos[i * 3 + 1], body.mesh.pos[i * 3 + 2]];
      const dx = Math.max(0.5 - x, 0, x - 1.0), dy = Math.max(0.9 - y, 0, y - 1.3), dz = Math.max(-0.3 - z, 0, z - 0.3);
      best = Math.min(best, Math.hypot(dx, dy, dz));
    }
    expect(g.gapMm).toBeGreaterThan(5);
    expect(Math.abs(g.gapMm - best * 1000)).toBeLessThan(0.11);
  });

  it("the runtime's mirrored clip gives the mirrored result (left box hit by the left arm = right box by the right arm)", () => {
    const rig = makeRig();
    const left = makeSolid(boxMesh([0.5, 0.9, -0.3], [1.0, 1.3, 0.3], 'cabinet'));
    const right = makeSolid(boxMesh([-1.0, 0.9, -0.3], [-0.5, 1.3, 0.3], 'cabinet'));
    pose(rig, foldClip(90), 1);
    const a = penetration(makeSolid(extractMeshes(rig.root)), left);
    const rigM = makeRig();
    pose(rigM, mirrorClip(foldClip(90)), 1);
    const mirrored = makeSolid(extractMeshes(rigM.root));
    const b = penetration(mirrored, right);
    expect(b.worstPart).toBe('forearm_R');
    expect(b.maxDepthMm).toBeCloseTo(a.maxDepthMm, 3);
    // and the mirrored arm no longer touches the left cabinet
    expect(penetration(mirrored, left).maxDepthMm).toBe(0);
  });

  it('a scaled rig (height scale) scales the measured depth', () => {
    const rig = makeRig();
    const cab = boxMesh([0.5, 0.9, -0.3], [1.0, 1.3, 0.3], 'cabinet');
    pose(rig, foldClip(90), 1);
    const d1 = penetration(makeSolid(extractMeshes(rig.root)), makeSolid(cab)).maxDepthMm;
    rig.root.scale.setScalar(1.5);
    pose(rig, foldClip(90), 1);
    const scaledCab = { ...cab, pos: cab.pos.map((v) => v * 1.5) };
    const d2 = penetration(makeSolid(extractMeshes(rig.root)), makeSolid(scaledCab)).maxDepthMm;
    expect(d2 / d1).toBeGreaterThan(1.45);
    expect(d2 / d1).toBeLessThan(1.55);
  });

  it('skips hidden meshes and explicitly skipped subtrees (carried props are not body)', () => {
    const rig = makeRig();
    const prop = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial());
    prop.name = 'carry';
    rig.bones.get('forearm_L')!.add(prop);
    const hidden = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial());
    hidden.visible = false;
    rig.root.add(hidden);
    rig.root.updateMatrixWorld(true);
    const all = extractMeshes(rig.root);
    const body = extractMeshes(rig.root, { skip: (o) => o === prop });
    expect(all.pos.length - body.pos.length).toBe(prop.geometry.attributes.position.count * 3);
    expect(all.labels).toContain('carry');
    expect(body.labels).not.toContain('carry');
  });
});
