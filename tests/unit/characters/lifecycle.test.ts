/**
 * Loader fallback / upgrade / dispose / release (finishing pass): the factory never throws or rejects whatever the
 * loader does, GPU resources are released exactly once by their owner (capsule on upgrade, per-rig materials and
 * skeleton on rig dispose, template + carry library on factory dispose) and shared resources survive a single
 * rig's disposal.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ANIM_STATES, defaultAppearance, intactLimbs } from '../../../src/shared/appearance';
import { createCharacterFactory } from '../../../src/render/characters/index';
import type { ZombieRigDebug } from '../../../src/render/characters/index';
import { loadGltf } from './helpers';

const step = (rig: { update(dt: number): void }, sec: number, dt = 1 / 30) => {
  for (let i = 0; i < Math.round(sec / dt); i++) rig.update(dt);
};

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => (o as THREE.Mesh).isMesh && out.push(o as THREE.Mesh));
  return out;
}

function countDisposals(list: { addEventListener(t: 'dispose', f: () => void): void }[]): () => number {
  let n = 0;
  for (const x of new Set(list)) x.addEventListener('dispose', () => n++);
  return () => n;
}

function exerciseEverything(rig: ZombieRigDebug): void {
  for (const a of ANIM_STATES) {
    rig.setAnim(a);
    rig.update(0.05);
  }
  rig.setCarry('pizza');
  rig.setExpression('happy');
  rig.setTalking(true);
  rig.setDecay(0.7);
  rig.setHighlight('hover');
  rig.setMoveSpeed(2);
  rig.setLimbs({ armL: 'missing', armR: 'prosthetic', legL: 'ok', legR: 'missing' });
  step(rig, 0.3);
  const top = rig.headTop(new THREE.Vector3());
  expect(Number.isFinite(top.x + top.y + top.z)).toBe(true);
}

describe('loader failures', () => {
  it('a loader that throws synchronously still resolves ready, reports failure once and serves capsules', async () => {
    const warnings: string[] = [];
    const f = createCharacterFactory({
      baseUrl: '/assets/',
      load: () => {
        throw new Error('boom');
      },
      warn: (m) => warnings.push(m),
    });
    await expect(f.ready).resolves.toBeUndefined();
    expect(f.failed()).toBe(true);
    expect(f.progress()).toBe(1);
    expect(warnings.some((w) => w.includes('fallback'))).toBe(true);
    const rig = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    expect(rig.kind).toBe('fallback');
    exerciseEverything(rig);
    rig.dispose();
    f.dispose();
  });

  it('a structurally wrong glTF (no Rig / bones) is rejected the same way, never half-used', async () => {
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    const f = createCharacterFactory({
      baseUrl: '/assets/', gltf: { scene, animations: [] } as unknown as GLTF, warn: () => undefined,
    });
    await f.ready;
    expect(f.failed()).toBe(true);
    expect(f.template()).toBeNull();
    const rig = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    expect(rig.kind).toBe('fallback');
    exerciseEverything(rig);
    f.dispose();
  });

  it('reports load progress monotonically and 1 when done', async () => {
    let resolve!: (g: GLTF) => void;
    let report!: (x: number) => void;
    const f = createCharacterFactory({
      baseUrl: '/assets/',
      load: (_url, onProgress) => {
        report = onProgress;
        return new Promise<GLTF>((r) => (resolve = r));
      },
      warn: () => undefined,
    });
    await Promise.resolve();
    expect(f.progress()).toBe(0);
    report(0.4);
    expect(f.progress()).toBeCloseTo(0.4);
    report(NaN);
    expect(f.progress()).toBeGreaterThanOrEqual(0);
    report(7);
    expect(f.progress()).toBeLessThanOrEqual(1);
    resolve(await loadGltf(true));
    await f.ready;
    expect(f.progress()).toBe(1);
    expect(f.failed()).toBe(false);
    f.dispose();
  });
});

describe('upgrade + release', () => {
  it('the capsule stand-in is released when the GLB rig replaces it; disposed rigs are never upgraded', async () => {
    let resolve!: (g: GLTF) => void;
    const f = createCharacterFactory({ baseUrl: '/assets/', gltf: new Promise<GLTF>((r) => (resolve = r)), warn: () => undefined });
    const keep = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    const gone = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    const capsule = keep.impl.object;
    const capsuleMeshes = meshes(capsule);
    expect(capsuleMeshes.length).toBeGreaterThan(3);
    const geoDisposed = countDisposals(capsuleMeshes.map((m) => m.geometry));
    gone.dispose();
    resolve(await loadGltf(true));
    await f.ready;
    expect(keep.kind).toBe('gltf');
    expect(capsule.parent).toBeNull();
    expect(geoDisposed()).toBe(new Set(capsuleMeshes.map((m) => m.geometry)).size);
    expect(gone.kind).toBe('fallback');
    expect(gone.root.children.length).toBe(0); // nothing re-attached to a disposed handle
    f.dispose();
  });

  it('disposing one rig keeps shared template geometry and the carry library alive for the others', async () => {
    const f = createCharacterFactory({ baseUrl: '/assets/', gltf: loadGltf(true), warn: () => undefined });
    await f.ready;
    const tpl = f.template()!;
    const tplGeoDisposed = countDisposals(meshes(tpl.scene).map((m) => m.geometry));
    const a = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    const b = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    a.setCarry('book');
    b.setCarry('book');
    step(a, 0.2);
    a.dispose();
    expect(tplGeoDisposed()).toBe(0);
    expect(tpl.carry.isDisposed).toBe(false);
    // b still renders its book and animates
    let carried = 0;
    b.root.traverse((o) => o.name.startsWith('carry') && carried++);
    expect(carried).toBeGreaterThan(0);
    exerciseEverything(b);
    f.dispose();
  });

  it('factory.dispose releases the template, the carry library and every live rig exactly once', async () => {
    const f = createCharacterFactory({ baseUrl: '/assets/', gltf: loadGltf(true), warn: () => undefined });
    await f.ready;
    const tpl = f.template()!;
    const tplMeshes = meshes(tpl.scene);
    const geoDisposed = countDisposals(tplMeshes.map((m) => m.geometry));
    const matDisposed = countDisposals(tplMeshes.map((m) => m.material as THREE.Material));
    const scene = new THREE.Scene();
    const rigs = [0, 1, 2].map(() => f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug);
    for (const r of rigs) scene.add(r.root);
    const rigMats = rigs.flatMap((r) => meshes(r.root).map((m) => m.material as THREE.Material));
    const rigMatDisposed = countDisposals(rigMats);
    f.dispose();
    expect(geoDisposed()).toBe(new Set(tplMeshes.map((m) => m.geometry)).size);
    expect(matDisposed()).toBe(new Set(tplMeshes.map((m) => m.material)).size);
    expect(rigMatDisposed()).toBe(new Set(rigMats).size);
    expect(tpl.carry.isDisposed).toBe(true);
    expect(scene.children.length).toBe(0); // rig roots detached
    expect(f.template()).toBeNull();
    // idempotent, and later calls stay safe
    expect(() => f.dispose()).not.toThrow();
    const late = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    expect(late.kind).toBe('fallback');
    exerciseEverything(late);
    late.dispose();
  });
});

describe('CONTRACTS #23: rigs never rely on root.visible', () => {
  it('a frustum-hidden rig keeps animating, blending its face/carriage and counting its parts', async () => {
    const f = createCharacterFactory({ baseUrl: '/assets/', gltf: loadGltf(), warn: () => undefined });
    await f.ready;
    const rig = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    rig.setAnim('walk');
    step(rig, 0.5);
    const calls = rig.stats().drawCalls;
    const foot = () => {
      rig.root.updateMatrixWorld(true);
      return rig.root.getObjectByName('foot_L')!.getWorldPosition(new THREE.Vector3());
    };
    rig.root.visible = false; // what the renderer does off-screen
    const before = foot();
    rig.setExpression('happy');
    rig.setAnim('talk');
    step(rig, 1.5);
    expect(foot().distanceTo(before)).toBeGreaterThan(1e-3);
    const impl = rig.impl as unknown as { faceWeight(n: string): number; postureWeight(e: string): number };
    expect(impl.faceWeight('happy')).toBeGreaterThan(0.9);
    expect(impl.postureWeight('happy')).toBeGreaterThan(0.99);
    rig.root.visible = true;
    expect(rig.stats().drawCalls).toBe(calls);
    expect(Number.isFinite(rig.headTop(new THREE.Vector3()).y)).toBe(true);
    f.dispose();
  });
});
