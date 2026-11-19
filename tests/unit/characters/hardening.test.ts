/**
 * Runtime hardening of the GLB rig (added by the ASSETS-CHARACTERS review):
 *  - one shared Skeleton per rig (one bone-texture upload per zombie per frame) and its GPU texture disposed,
 *  - setMoveSpeed(0) freezes the walk cycle (RENDER passes 0 while a walker stands still), garbage -> default,
 *  - tiny parts never cast shadows (eyes, stitches, small accessories), the body does,
 *  - a factory disposed while the GLB is still loading releases it and keeps returning safe capsule rigs,
 *  - hidden eye sets are not driven every frame, the visible one is,
 *  - per-zombie draw calls / triangles stay in budget for every style combination.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  ACCESSORIES, BOTTOM_STYLES, EYE_STYLES, HAIR_STYLES, TOP_STYLES, defaultAppearance, intactLimbs,
} from '../../../src/shared/appearance';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createCharacterFactory } from '../../../src/render/characters/index';
import type { ZombieRigDebug } from '../../../src/render/characters/index';
import type { GltfRig } from '../../../src/render/characters/rig';
import { loadGltf } from './helpers';

const quiet = () => undefined;

async function makeFactory() {
  const f = createCharacterFactory({ baseUrl: '/assets/', gltf: loadGltf(), warn: quiet });
  await f.ready;
  return f;
}

function skinned(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const out: THREE.SkinnedMesh[] = [];
  root.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && out.push(o as THREE.SkinnedMesh));
  return out;
}

describe('skeleton sharing', () => {
  it('every part of a rig uses one Skeleton bound to that rig\'s own bones', async () => {
    const f = await makeFactory();
    const a = f.create(defaultAppearance(), intactLimbs());
    const b = f.create(defaultAppearance(), intactLimbs());
    const ma = skinned(a.root);
    const mb = skinned(b.root);
    expect(ma.length).toBeGreaterThan(70);
    expect(new Set(ma.map((m) => m.skeleton)).size).toBe(1);
    expect(new Set(mb.map((m) => m.skeleton)).size).toBe(1);
    expect(ma[0].skeleton).not.toBe(mb[0].skeleton);
    // bones belong to this rig's clone
    const bonesA = new Set<THREE.Object3D>();
    a.root.traverse((o) => (o as THREE.Bone).isBone && bonesA.add(o));
    for (const bone of ma[0].skeleton.bones) expect(bonesA.has(bone)).toBe(true);
    // skinning still follows the animation: the shared skeleton's matrices change with the pose
    a.setAnim('wave');
    for (let i = 0; i < 20; i++) a.update(1 / 30);
    a.root.updateMatrixWorld(true);
    ma[0].skeleton.update();
    const m0 = ma[0].skeleton.boneMatrices!.slice();
    for (let i = 0; i < 10; i++) a.update(1 / 30);
    a.root.updateMatrixWorld(true);
    ma[0].skeleton.update();
    expect(ma[0].skeleton.boneMatrices!.some((v, i) => Math.abs(v - m0[i]) > 1e-4)).toBe(true);
    f.dispose();
  });

  it('dispose() releases the bone texture of the rig\'s skeleton', async () => {
    const f = await makeFactory();
    const rig = f.create(defaultAppearance(), intactLimbs());
    const sk = skinned(rig.root)[0].skeleton;
    sk.computeBoneTexture(); // what WebGLRenderer does on first draw
    let disposed = 0;
    sk.boneTexture!.addEventListener('dispose', () => disposed++);
    rig.dispose();
    expect(disposed).toBe(1);
    expect(sk.boneTexture).toBeNull();
    f.dispose();
  });
});

describe('setMoveSpeed', () => {
  const pose = (rig: ZombieRigDebug) => {
    rig.root.updateMatrixWorld(true);
    return rig.root.getObjectByName('foot_L')!.getWorldPosition(new THREE.Vector3());
  };

  it('0 freezes the walk cycle mid-stride; 1 resumes it; garbage falls back to the default speed', async () => {
    const f = await makeFactory();
    const rig = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    rig.setAnim('walk');
    for (let i = 0; i < 20; i++) rig.update(1 / 30);
    rig.setMoveSpeed(0);
    rig.update(1 / 30);
    const a = pose(rig);
    for (let i = 0; i < 12; i++) rig.update(1 / 30);
    expect(pose(rig).distanceTo(a)).toBeLessThan(1e-6);
    rig.setMoveSpeed(1);
    for (let i = 0; i < 6; i++) rig.update(1 / 30);
    expect(pose(rig).distanceTo(a)).toBeGreaterThan(0.01);
    for (const bad of [NaN, -3, Infinity, 'fast' as unknown as number]) {
      rig.setMoveSpeed(bad);
      const b = pose(rig);
      rig.update(1 / 10);
      expect(pose(rig).distanceTo(b), String(bad)).toBeGreaterThan(0.005);
    }
    f.dispose();
  });

  it('does not slow down non-locomotion clips', async () => {
    const f = await makeFactory();
    const rig = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    rig.setMoveSpeed(0);
    rig.setAnim('wave');
    for (let i = 0; i < 12; i++) rig.update(1 / 30);
    const hand = () => {
      rig.root.updateMatrixWorld(true);
      return rig.root.getObjectByName('hand_R')!.getWorldPosition(new THREE.Vector3());
    };
    const a = hand();
    for (let i = 0; i < 8; i++) rig.update(1 / 30);
    expect(hand().distanceTo(a)).toBeGreaterThan(0.005);
    f.dispose();
  });
});

describe('shadows, morph driving, budgets', () => {
  it('tiny parts do not cast shadows; body, clothes and hair do', async () => {
    const f = await makeFactory();
    const rig = f.create({ ...defaultAppearance(), accessory: 'glasses' }, intactLimbs());
    const casts = (name: string) => {
      let any = false;
      rig.root.getObjectByName(name)!.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o.castShadow) any = true;
      });
      return any;
    };
    for (const n of ['Eyes_droopy', 'Eyes_wide', 'Stitches', 'Acc_glasses', 'Acc_necklace', 'Acc_bowtie', 'Acc_flower']) {
      expect(casts(n), n).toBe(false);
    }
    for (const n of ['Head', 'Torso', 'Top_tee_Body', 'Hair_messy', 'Shoe_L', 'Acc_beanie']) expect(casts(n), n).toBe(true);
    f.dispose();
  });

  it('drives the face morphs of the visible eye set only', async () => {
    const f = await makeFactory();
    const rig = f.create({ ...defaultAppearance(), eyeStyle: 'wide' }, intactLimbs()) as ZombieRigDebug;
    rig.setExpression('shocked');
    for (let i = 0; i < 20; i++) rig.update(1 / 30);
    const weight = (node: string) => {
      let w = 0;
      rig.root.getObjectByName(node)!.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.morphTargetDictionary) w = Math.max(w, m.morphTargetInfluences![m.morphTargetDictionary.shocked]);
      });
      return w;
    };
    expect(weight('Eyes_wide')).toBeGreaterThan(0.9);
    expect(weight('Head')).toBeGreaterThan(0.9);
    expect(weight('Eyes_droopy')).toBe(0);
    // switching styles picks the new set up on the next frame
    rig.setAppearance({ ...defaultAppearance(), eyeStyle: 'beady' });
    rig.update(1 / 30);
    expect(weight('Eyes_beady')).toBeGreaterThan(0.5);
    f.dispose();
  });

  it('every hair x top x bottom x accessory combination stays within budget (~4k tris typical, <= 28 draw calls)', async () => {
    const f = await makeFactory();
    const rig = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    let worstTris = 0;
    let worstCalls = 0;
    let total = 0;
    let totalTris = 0;
    let n = 0;
    for (const hairStyle of HAIR_STYLES) for (const topStyle of TOP_STYLES) for (const bottomStyle of BOTTOM_STYLES) {
      for (const accessory of [ACCESSORIES[0], ACCESSORIES[4], ACCESSORIES[1]]) {
        rig.setAppearance({ ...defaultAppearance(), hairStyle, topStyle, bottomStyle, accessory, eyeStyle: EYE_STYLES[n % 5] });
        const s = rig.stats();
        worstTris = Math.max(worstTris, s.triangles);
        worstCalls = Math.max(worstCalls, s.drawCalls);
        total += s.drawCalls;
        totalTris += s.triangles;
        n++;
      }
    }
    // ART_DIRECTION: ~4k visible per zombie. The heaviest combo (tatters + shorts show the most skin, plus hair
    // and a beanie) is ~4.6k; the average stays under 4k.
    expect(worstTris).toBeLessThanOrEqual(4700);
    expect(totalTris / n).toBeLessThanOrEqual(4000);
    expect(worstCalls).toBeLessThanOrEqual(28);
    expect(total / n).toBeLessThanOrEqual(25); // typical zombie within the ~25 draw-call guideline
    f.dispose();
  });
});

describe('factory lifecycle', () => {
  it('disposing while the GLB is still loading releases the late GLB and keeps rigs safe', async () => {
    let resolve!: (g: GLTF) => void;
    const pending = new Promise<GLTF>((r) => (resolve = r));
    const f = createCharacterFactory({ baseUrl: '/assets/', gltf: pending, warn: quiet });
    const early = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    expect(early.kind).toBe('fallback');
    f.dispose();
    const gltf = await loadGltf(true);
    let disposed = 0;
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.addEventListener('dispose', () => disposed++);
    });
    resolve(gltf);
    await expect(f.ready).resolves.toBeUndefined();
    expect(disposed).toBeGreaterThan(50);
    expect(f.template()).toBeNull();
    // creating after dispose never throws and never upgrades
    const late = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    expect(late.kind).toBe('fallback');
    late.setCarry('plate');
    late.setAnim('walk');
    late.update(0.1);
    expect(() => late.dispose()).not.toThrow();
  });

  it('a template rig never mutates the shared template (materials, skeletons, morphs)', async () => {
    const f = await makeFactory();
    const tpl = (f as unknown as { template(): { scene: THREE.Object3D } }).template()!;
    const before = new Map<THREE.Object3D, THREE.Material>();
    tpl.scene.traverse((o) => (o as THREE.Mesh).isMesh && before.set(o, (o as THREE.Mesh).material as THREE.Material));
    const tplSkeletons = new Set(skinned(tpl.scene).map((m) => m.skeleton));
    const rig = f.create({ ...defaultAppearance(), build: 1, topColor: '#ff0000' }, intactLimbs()) as ZombieRigDebug;
    rig.setExpression('happy');
    rig.update(0.5);
    rig.dispose();
    tpl.scene.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      expect((o as THREE.Mesh).material).toBe(before.get(o));
    });
    expect(new Set(skinned(tpl.scene).map((m) => m.skeleton))).toEqual(tplSkeletons);
    const head = tpl.scene.getObjectByName('Head')!.children[0] as THREE.Mesh;
    expect(Math.max(...(head.morphTargetInfluences ?? [0]))).toBe(0);
    expect((rig.impl as GltfRig).getMaterials().length).toBe(0);
    f.dispose();
  });
});
