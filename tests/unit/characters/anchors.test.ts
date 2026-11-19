/**
 * Pose anchors and rig geometry, evaluated with three.js (GLTFLoader + AnimationMixer) on the real asset:
 * sit -> pelvis at SEAT_HEIGHT, sleep/beEmbalmed -> lying on the back centred on the origin with the head toward -Z,
 * collapse ends on the floor, walk keeps a foot on the ground, mirror symmetry of left/right bones, carry frame.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DIM } from '../../../src/shared/dimensions';
import { loadGltf } from './helpers';

let gltf: GLTF;
beforeAll(async () => {
  gltf = await loadGltf();
});

function sample(clipName: string, t: number): (bone: string) => THREE.Vector3 {
  const scene = gltf.scene;
  const clip = gltf.animations.find((c) => c.name === clipName);
  if (!clip) throw new Error(`missing clip ${clipName}`);
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.play();
  mixer.setTime(Math.min(t, clip.duration - 1e-4));
  scene.updateMatrixWorld(true);
  const at = (bone: string) => {
    const o = scene.getObjectByName(bone);
    if (!o) throw new Error(`missing bone ${bone}`);
    return o.getWorldPosition(new THREE.Vector3());
  };
  const snapshot = new Map<string, THREE.Vector3>();
  for (const b of ['pelvis', 'head', 'foot_L', 'foot_R', 'hand_L', 'hand_R', 'thigh_L', 'shin_L', 'chest', 'neck', 'root']) {
    snapshot.set(b, at(b));
  }
  action.stop();
  mixer.uncacheRoot(scene);
  return (bone: string) => snapshot.get(bone) ?? at(bone);
}

describe('pose anchors', () => {
  const SEATED = ['sit', 'sitEat', 'sitTalk', 'sitTV', 'sitComputer', 'sitRead', 'sitChess'];

  it('sit* keep the pelvis at SEAT_HEIGHT with thighs forward', () => {
    for (const name of SEATED) {
      for (const t of [0, 0.7, 1.6]) {
        const p = sample(name, t);
        expect(Math.abs(p('pelvis').y - DIM.SEAT_HEIGHT), `${name}@${t}`).toBeLessThan(0.012);
        // knees in front of the hips (character front is +Z)
        expect(p('shin_L').z - p('thigh_L').z, name).toBeGreaterThan(0.2);
        // feet on the floor
        expect(p('foot_L').y, name).toBeLessThan(0.15);
      }
    }
  });

  it('sleep / beEmbalmed lie on the back, centred on the origin, head toward local -Z, near y = 0.1', () => {
    for (const name of ['sleep', 'beEmbalmed']) {
      for (const t of [0, 1.3, 2.9]) {
        const p = sample(name, t);
        expect(p('pelvis').y, name).toBeGreaterThan(0.05);
        expect(p('pelvis').y, name).toBeLessThan(0.16);
        expect(p('head').z, name).toBeLessThan(-0.4); // head bone origin = top of the neck
        expect(p('head').y, name).toBeLessThan(0.3);
        const mid = (p('head').z + p('foot_L').z) / 2;
        expect(Math.abs(mid), name).toBeLessThan(0.25);
        expect(Math.abs(p('pelvis').x)).toBeLessThan(0.05);
      }
    }
  });

  it('collapse ends lying on the floor; pickup and yawn end standing', () => {
    const end = sample('collapse', 1.6);
    expect(end('pelvis').y).toBeLessThan(0.2);
    expect(end('head').y).toBeLessThan(0.35);
    for (const name of ['pickup', 'yawn']) {
      const e = sample(name, 99);
      expect(e('head').y, name).toBeGreaterThan(1.25);
    }
  });

  it('bath sits low with the chest near the tub water line and legs forward', () => {
    const p = sample('bath', 1);
    expect(p('pelvis').y).toBeLessThan(0.1);
    // chest centre (between the chest and neck joints) sits ~0.45 above the tub floor, i.e. at the water line
    // TUB_RIM for a ~0.12 m tub floor
    const chestMid = (p('chest').y + p('neck').y) / 2;
    expect(chestMid).toBeGreaterThan(DIM.TUB_RIM - 0.25);
    expect(chestMid).toBeLessThan(DIM.TUB_RIM - 0.02);
    expect(p('foot_L').z).toBeGreaterThan(0.45);
  });

  it('crawl stays on the ground', () => {
    for (const t of [0, 0.4, 0.8, 1.2]) {
      const p = sample('crawl', t);
      expect(p('pelvis').y).toBeLessThan(0.2);
      expect(p('head').y).toBeLessThan(0.55);
    }
  });

  it('walk: in place, one foot always near the floor, 1 s cycle', () => {
    let minRootMove = 0;
    for (let i = 0; i < 10; i++) {
      const p = sample('walk', i / 10);
      const low = Math.min(p('foot_L').y, p('foot_R').y);
      expect(low, `t=${i / 10}`).toBeLessThan(0.112); // ankle joint 0.085 + heel/toe pivot
      minRootMove = Math.max(minRootMove, p('root').length());
      expect(Math.abs(p('pelvis').z)).toBeLessThan(0.05);
    }
    expect(minRootMove).toBeLessThan(1e-6);
  });

  it('idle stands with the head near the top of a 1.62 m zombie', () => {
    const p = sample('idle', 0.5);
    expect(p('head').y).toBeGreaterThan(1.2);
    expect(p('head').y).toBeLessThan(1.4);
    expect(Math.min(p('foot_L').y, p('foot_R').y)).toBeLessThan(0.1);
  });
});

describe('rig geometry', () => {
  it('left/right bones are exact mirrors (enables runtime clip mirroring)', () => {
    const pairs = [['shoulder_L', 'shoulder_R'], ['upperarm_L', 'upperarm_R'], ['forearm_L', 'forearm_R'],
      ['hand_L', 'hand_R'], ['thigh_L', 'thigh_R'], ['shin_L', 'shin_R'], ['foot_L', 'foot_R'], ['prop_L', 'prop_R']];
    for (const [l, r] of pairs) {
      const L = gltf.scene.getObjectByName(l)!;
      const R = gltf.scene.getObjectByName(r)!;
      expect(R.quaternion.x).toBeCloseTo(L.quaternion.x, 5);
      expect(R.quaternion.y).toBeCloseTo(-L.quaternion.y, 5);
      expect(R.quaternion.z).toBeCloseTo(-L.quaternion.z, 5);
      expect(R.quaternion.w).toBeCloseTo(L.quaternion.w, 5);
      expect(R.position.x).toBeCloseTo(-L.position.x, 5);
      expect(R.position.y).toBeCloseTo(L.position.y, 5);
      expect(R.position.z).toBeCloseTo(L.position.z, 5);
    }
  });

  it('the carry pose turns prop_R into an upright, forward-facing frame (items authored +Y up / +Z fwd)', () => {
    const scene = gltf.scene.clone(true);
    const rig = scene.getObjectByName('Rig')!;
    const carry = JSON.parse(rig.userData.carryPose as string) as Record<string, number[]>;
    for (const [bone, q] of Object.entries(carry)) scene.getObjectByName(bone)!.quaternion.fromArray(q);
    scene.updateMatrixWorld(true);
    for (const side of ['R', 'L']) {
      const prop = scene.getObjectByName(`prop_${side}`)!;
      const q = prop.getWorldQuaternion(new THREE.Quaternion());
      expect(Math.abs(q.w)).toBeGreaterThan(0.999);
      const pos = prop.getWorldPosition(new THREE.Vector3());
      expect(pos.z).toBeGreaterThan(0.25);
      expect(pos.y).toBeGreaterThan(0.7);
      expect(pos.y).toBeLessThan(1.05);
    }
  });

  it('rest pose: top of head ~1.62 m, feet on y = 0, facing +Z', () => {
    // raw rest positions: geometry.computeBoundingBox() would also include the expression morph deltas
    const box = new THREE.Box3();
    const head = gltf.scene.getObjectByName('Head')!;
    head.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const pos = m.geometry.getAttribute('position');
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i));
    });
    expect(Math.abs(box.max.y - 1.62)).toBeLessThan(0.004);
    const nose = box.max.z;
    expect(nose).toBeGreaterThan(0.15); // face toward +Z
    const shoe = gltf.scene.getObjectByName('Shoe_L') as THREE.Mesh;
    shoe.geometry.computeBoundingBox();
    expect(shoe.geometry.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.005);
    expect(shoe.geometry.boundingBox!.min.y).toBeLessThan(0.01);
    expect(shoe.geometry.boundingBox!.max.z).toBeGreaterThan(0.12); // toes forward (+Z)
  });
});

/** World facing direction of the face (head bone local +Z = character front) at time t of a clip. */
function faceDir(clipName: string, t: number): THREE.Vector3 {
  const scene = gltf.scene;
  const clip = gltf.animations.find((c) => c.name === clipName)!;
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.play();
  mixer.setTime(Math.min(t, clip.duration - 1e-4));
  scene.updateMatrixWorld(true);
  const q = scene.getObjectByName('head')!.getWorldQuaternion(new THREE.Quaternion());
  action.stop();
  mixer.uncacheRoot(scene);
  return new THREE.Vector3(0, 0, 1).applyQuaternion(q);
}

describe('animation readability (added by the hardening review)', () => {
  it('"head back" clips really look UP (look() pitch < 0 = up): cheer, groan, yawn, stretch, shower', () => {
    const peaks: [string, number][] = [['cheer', 0.3], ['groan', 1.2], ['yawn', 0.8], ['stretch', 1.5], ['shower', 0.7]];
    for (const [clip, t] of peaks) expect(faceDir(clip, t).y, clip).toBeGreaterThan(0.2);
    // ...while crying / mourning / reading still look down
    for (const [clip, t] of [['cry', 0.6], ['mourn', 1.0], ['read', 1.0]] as [string, number][]) {
      expect(faceDir(clip, t).y, clip).toBeLessThan(-0.2);
    }
  });

  it('idle and walk faces are not bowed toward the floor (readable from the elevated game camera)', () => {
    for (let i = 0; i < 4; i++) {
      expect(faceDir('idle', i).y, `idle ${i}`).toBeGreaterThan(-0.08);
      expect(faceDir('walk', i / 4).y, `walk ${i}`).toBeGreaterThan(-0.12);
    }
  });

  it('hug wraps a partner one tile away instead of crossing the arms on the own chest', () => {
    for (const t of [0, 0.8, 1.6]) {
      const p = sample('hug', t);
      expect(p('pelvis').z, 'stepped in').toBeGreaterThan(0.2);
      for (const h of ['hand_L', 'hand_R']) {
        expect(p(h).z, `${h} reaches around the partner`).toBeGreaterThan(0.65);
        expect(Math.abs(p(h).x), `${h} near the partner's spine`).toBeLessThan(0.12);
      }
      expect(p('hand_L').y - p('hand_R').y, 'one arm over the shoulder, one round the waist').toBeGreaterThan(0.15);
    }
  });

  it('kiss leans in toward the partner with one foot popped up behind', () => {
    const p = sample('kiss', 0.6);
    expect(p('head').z).toBeGreaterThan(0.3);
    expect(p('foot_R').y).toBeGreaterThan(0.22);
    expect(p('foot_R').z).toBeLessThan(p('foot_L').z);
  });

  it('dance steps side to side; angry stomps alternate feet; laugh goes from head-back to doubled over', () => {
    const xs = [0, 0.5, 1.0, 1.5].map((t) => sample('dance', t)('foot_L').x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.08);
    const pel = [0, 0.5, 1.0, 1.5].map((t) => sample('dance', t)('pelvis').x);
    expect(Math.max(...pel) - Math.min(...pel)).toBeGreaterThan(0.08);
    expect(sample('angry', 0.1)('foot_L').y - sample('angry', 0.1)('foot_R').y).toBeGreaterThan(0.06);
    expect(sample('angry', 0.8)('foot_R').y - sample('angry', 0.8)('foot_L').y).toBeGreaterThan(0.06);
    expect(faceDir('laugh', 0.2).y).toBeGreaterThan(0.2);
    const doubled = sample('laugh', 1.1);
    expect(doubled('head').z - doubled('pelvis').z).toBeGreaterThan(0.2);
  });
});
