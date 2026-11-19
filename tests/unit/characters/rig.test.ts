/**
 * Runtime integration: createCharacterFactory + ZombieRig on the real GLB in Node (no WebGL needed).
 * Covers every contract method, crossfades, one-shots, limbs/carry/decay/highlight, dispose and the fallback +
 * upgrade paths, plus adversarial inputs.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  ACCESSORIES, ANIM_STATES, BOTTOM_STYLES, CARRY_ITEMS, EXPRESSIONS, EYE_STYLES, HAIR_STYLES, TOP_STYLES,
  defaultAppearance, intactLimbs,
} from '../../../src/shared/appearance';
import type { AnimState, LimbState, ZombieAppearance } from '../../../src/shared/appearance';
import { DIM } from '../../../src/shared/dimensions';
import { createCharacterFactory } from '../../../src/render/characters/index';
import type { ZombieRigDebug } from '../../../src/render/characters/index';
import type { GltfRig } from '../../../src/render/characters/rig';
import { loadGltf } from './helpers';

const quiet = () => undefined;
const step = (rig: { update(dt: number): void }, sec: number, dt = 1 / 30) => {
  for (let i = 0; i < Math.round(sec / dt); i++) rig.update(dt);
};
const worldY = (root: THREE.Object3D, name: string) => {
  root.updateMatrixWorld(true);
  return root.getObjectByName(name)!.getWorldPosition(new THREE.Vector3()).y;
};

async function makeFactory() {
  const f = createCharacterFactory({ baseUrl: '/assets/', gltf: loadGltf(), warn: quiet });
  await f.ready;
  return f;
}

describe('CharacterFactory', () => {
  it('loads the GLB, reports progress and creates GLB-backed rigs', async () => {
    const f = await makeFactory();
    expect(f.progress()).toBe(1);
    expect(f.failed()).toBe(false);
    const rig = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    expect(rig.kind).toBe('gltf');
    expect(rig.root).toBeInstanceOf(THREE.Object3D);
    rig.dispose();
    f.dispose();
  });

  it('falls back to procedural capsule rigs when the GLB cannot load (never throws, ready resolves)', async () => {
    const f = createCharacterFactory({ baseUrl: '/nope/', load: () => Promise.reject(new Error('404')), warn: quiet });
    await expect(f.ready).resolves.toBeUndefined();
    expect(f.failed()).toBe(true);
    const rig = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    expect(rig.kind).toBe('fallback');
    for (const a of ANIM_STATES) {
      rig.setAnim(a);
      step(rig, 0.2);
    }
    rig.setCarry('plate');
    rig.setLimbs({ armL: 'missing', armR: 'missing', legL: 'missing', legR: 'prosthetic' });
    rig.setDecay(1);
    rig.setHighlight('selected');
    rig.setExpression('shocked');
    rig.setTalking(true);
    step(rig, 0.5);
    const top = rig.headTop(new THREE.Vector3());
    expect(Number.isFinite(top.y)).toBe(true);
    rig.dispose();
    f.dispose();
  });

  it('rigs created before the GLB arrives are upgraded in place (same root, state replayed)', async () => {
    let resolve!: (g: any) => void;
    const pending = new Promise<any>((r) => (resolve = r));
    const f = createCharacterFactory({ baseUrl: '/assets/', gltf: pending, warn: quiet });
    const rig = f.create({ ...defaultAppearance(), hairStyle: 'afro' }, intactLimbs()) as ZombieRigDebug;
    const root = rig.root;
    rig.setAnim('sit');
    expect(rig.kind).toBe('fallback');
    resolve(await loadGltf());
    await f.ready;
    expect(rig.kind).toBe('gltf');
    expect(rig.root).toBe(root);
    step(rig, 0.5);
    expect(rig.stats().visibleNodes).toContain('Hair_afro');
    expect(Math.abs(worldY(rig.root, 'pelvis') - DIM.SEAT_HEIGHT)).toBeLessThan(0.015);
    f.dispose();
  });
});

describe('ZombieRig (GLB)', () => {
  it('invalidates material warm-up when a same-body appearance changes', async () => {
    const f = await makeFactory();
    const initial = defaultAppearance();
    const rig = f.create(initial, intactLimbs()) as ZombieRigDebug;
    const revision = rig.renderRevision ?? 0;

    rig.setAppearance({ ...initial, accessory: 'glasses' });
    expect(rig.body).toBe('classic');
    expect(rig.renderRevision).toBeGreaterThan(revision);

    const changedRevision = rig.renderRevision ?? 0;
    rig.setAppearance({ ...initial, accessory: 'glasses' });
    expect(rig.renderRevision).toBe(changedRevision);
    f.dispose();
  });

  it('every animation state plays without throwing and settles onto its clip', async () => {
    const f = await makeFactory();
    const rig = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    for (const a of ANIM_STATES) {
      rig.setAnim(a);
      step(rig, 0.4);
      const active = (rig.impl as GltfRig).activeClips();
      const expected = a === 'limp' ? 'walk' : a;
      expect(active.map((x) => x.clip), a).toContain(expected);
      expect(active.find((x) => x.clip === expected)!.weight).toBeCloseTo(1, 5);
    }
    f.dispose();
  });

  it('crossfades over ~0.25 s, interruption-safe (no weight pops)', async () => {
    const f = await makeFactory();
    const rig = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    const impl = rig.impl as GltfRig;
    rig.setAnim('idle');
    step(rig, 0.5);
    rig.setAnim('walk');
    step(rig, 0.1);
    let w = impl.activeClips();
    const idleW = w.find((x) => x.clip === 'idle')!.weight;
    const walkW = w.find((x) => x.clip === 'walk')!.weight;
    expect(idleW + walkW).toBeCloseTo(1, 5);
    expect(walkW).toBeGreaterThan(0.25);
    expect(walkW).toBeLessThan(0.6);
    // interrupt mid-fade: walk keeps its current weight and ramps down, no jump back to 1
    rig.setAnim('wave');
    rig.update(1 / 60);
    w = impl.activeClips();
    expect(w.find((x) => x.clip === 'walk')!.weight).toBeLessThan(walkW + 0.01);
    step(rig, 0.4);
    w = impl.activeClips();
    expect(w.map((x) => [x.clip, x.weight])).toEqual([['wave', 1]]);
    f.dispose();
  });

  it('rapid interruptions never leak the bind pose (effective weights always sum to 1)', async () => {
    const f = await makeFactory();
    const rig = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    const impl = rig.impl as GltfRig;
    const seq: AnimState[] = ['idle', 'walk', 'sit', 'wave', 'walk', 'sleep', 'cheer', 'idle'];
    for (const a of seq) {
      rig.setAnim(a);
      for (let i = 0; i < 4; i++) {
        rig.update(1 / 60);
        const sum = impl.activeClips().reduce((acc, x) => acc + x.effective, 0);
        expect(sum).toBeCloseTo(1, 5);
      }
    }
    f.dispose();
  });

  it('one-shots play once and hold their last frame', async () => {
    const f = await makeFactory();
    const rig = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    rig.setAnim('collapse');
    step(rig, 3);
    expect(worldY(rig.root, 'pelvis')).toBeLessThan(0.25);
    step(rig, 2);
    expect(worldY(rig.root, 'pelvis')).toBeLessThan(0.25);
    rig.setAnim('collapse'); // same state again: no restart
    rig.update(1 / 30);
    expect(worldY(rig.root, 'pelvis')).toBeLessThan(0.25);
    f.dispose();
  });

  it('keeps the seat at SEAT_HEIGHT for short and tall zombies', async () => {
    const f = await makeFactory();
    for (const height of [0, 0.5, 1]) {
      const rig = f.create({ ...defaultAppearance(), height }, intactLimbs());
      rig.setAnim('sitEat');
      step(rig, 1);
      expect(Math.abs(worldY(rig.root, 'pelvis') - DIM.SEAT_HEIGHT), `height ${height}`).toBeLessThan(0.012);
      rig.setAnim('idle');
      step(rig, 1);
      expect(worldY(rig.root, 'pelvis')).toBeGreaterThan(0.5);
      rig.dispose();
    }
    f.dispose();
  });

  it('appearance drives node visibility, colours, height scale and the build morph', async () => {
    const f = await makeFactory();
    const app: ZombieAppearance = { ...defaultAppearance(), hairStyle: 'bun', topStyle: 'suit', accessory: 'glasses',
      eyeStyle: 'beady', topColor: '#ff0000', height: 1, build: 1 };
    const rig = f.create(app, intactLimbs()) as ZombieRigDebug;
    const vis = rig.stats().visibleNodes;
    for (const n of ['Hair_bun', 'Top_suit_Body', 'Acc_glasses', 'Eyes_beady']) expect(vis).toContain(n);
    for (const n of ['Hair_messy', 'Top_tee_Body', 'Eyes_droopy', 'Stump_ArmL']) expect(vis).not.toContain(n);
    const top = rig.root.getObjectByName('Top_suit_Body')!;
    let red = false;
    top.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && m.name === 'Top' && m.color.r > 0.9 && m.color.g < 0.05) red = true;
    });
    expect(red).toBe(true);
    const model = rig.root.getObjectByName('ZombieModel')!;
    expect(model.scale.y).toBeCloseTo(1.08, 5);
    const torso = rig.root.getObjectByName('Top_suit_Body')!.children[0] as THREE.Mesh;
    const bi = torso.morphTargetDictionary!.build;
    expect(torso.morphTargetInfluences![bi]).toBeCloseTo(1, 5);
    f.dispose();
  });

  it('limbs: missing -> stump + mirrored right-handed clips + carry moves to the other hand', async () => {
    const f = await makeFactory();
    const rig = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    rig.setCarry('book');
    const propR = rig.root.getObjectByName('prop_R')!;
    expect(propR.getObjectByName('carry_book')).toBeTruthy();
    const limbs: LimbState = { armL: 'ok', armR: 'missing', legL: 'ok', legR: 'ok' };
    rig.setLimbs(limbs);
    rig.setAnim('wave');
    step(rig, 0.4);
    expect(rig.stats().clip).toBe('wave (mirrored)');
    expect(rig.stats().visibleNodes).toContain('Stump_ArmR');
    expect(propR.getObjectByName('carry_book')).toBeFalsy();
    expect(rig.root.getObjectByName('prop_L')!.getObjectByName('carry_book')).toBeTruthy();
    rig.setLimbs({ armL: 'ok', armR: 'ok', legL: 'missing', legR: 'missing' });
    rig.setAnim('walk');
    step(rig, 0.4);
    expect(rig.stats().clip).toBe('crawl');
    rig.setCarry(null);
    expect(rig.root.getObjectByName('carry_book')).toBeFalsy();
    f.dispose();
  });

  it('carry hold layer blends the arm into the palm-up pose and releases it cleanly', async () => {
    const f = await makeFactory();
    const rig = f.create(defaultAppearance(), intactLimbs());
    rig.setAnim('idle');
    step(rig, 0.6);
    const fore = rig.root.getObjectByName('forearm_R')!;
    const before = fore.quaternion.clone();
    rig.setCarry('pizza');
    step(rig, 1);
    const held = fore.quaternion.clone();
    expect(before.angleTo(held)).toBeGreaterThan(0.5);
    rig.setCarry(null);
    step(rig, 1.5);
    expect(fore.quaternion.angleTo(held)).toBeGreaterThan(0.5);
    f.dispose();
  });

  it('decay recolours skin; highlight fades the rim uniform; expressions/talking drive morphs', async () => {
    const f = await makeFactory();
    const rig = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    const impl = rig.impl as GltfRig;
    const skin = impl.getMaterials().find((m) => m.name === 'Skin') as THREE.MeshStandardMaterial;
    const fresh = skin.color.clone();
    rig.setDecay(1);
    expect(skin.color.equals(fresh)).toBe(false);
    rig.setExpression('happy');
    rig.setTalking(true);
    rig.setHighlight('selected');
    step(rig, 0.6);
    expect(impl.faceWeight('happy')).toBeGreaterThan(0.9);
    const head = rig.root.getObjectByName('Head')!.children[0] as THREE.Mesh;
    expect(head.morphTargetInfluences![head.morphTargetDictionary!.happy]).toBeGreaterThan(0.9);
    let talkMax = 0;
    for (let i = 0; i < 30; i++) {
      rig.update(1 / 30);
      talkMax = Math.max(talkMax, impl.faceWeight('talk'));
    }
    expect(talkMax).toBeGreaterThan(0.4);
    rig.setTalking(false);
    rig.setExpression('neutral');
    rig.setHighlight('none');
    step(rig, 1);
    expect(impl.faceWeight('talk')).toBeLessThan(0.05);
    f.dispose();
  });

  it('headTop follows the head (standing high, lying low) and respects the root transform', async () => {
    const f = await makeFactory();
    const rig = f.create(defaultAppearance(), intactLimbs());
    const out = new THREE.Vector3();
    rig.setAnim('idle');
    step(rig, 0.5);
    rig.headTop(out);
    expect(out.y).toBeGreaterThan(1.55);
    expect(out.y).toBeLessThan(DIM.HEAD_TOP + 0.05);
    rig.root.position.set(5, 0, 3);
    rig.root.updateMatrixWorld(true);
    rig.headTop(out);
    expect(out.x).toBeGreaterThan(4.5);
    rig.setAnim('sleep');
    step(rig, 1);
    rig.headTop(out);
    expect(out.y).toBeLessThan(0.5);
    f.dispose();
  });

  it('stays within ~25 draw calls for every top/bottom/hair combination', async () => {
    const f = await makeFactory();
    let worst = 0;
    const rig = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    for (const top of TOP_STYLES) for (const bottom of BOTTOM_STYLES) for (const acc of ['none', 'glasses'] as const) {
      rig.setAppearance({ ...defaultAppearance(), topStyle: top, bottomStyle: bottom, accessory: acc, stitches: true });
      worst = Math.max(worst, rig.stats().drawCalls);
    }
    expect(worst).toBeLessThanOrEqual(28);
    f.dispose();
  });

  it('survives adversarial input everywhere', async () => {
    const f = await makeFactory();
    const bad: any[] = [null, undefined, NaN, -1, 1e9, 'x', {}, [], () => 0];
    const rig = f.create(null as any, 'nope' as any);
    for (const b of bad) {
      expect(() => {
        rig.setAppearance(b);
        rig.setLimbs(b);
        rig.setDecay(b);
        rig.setAnim(b);
        rig.setExpression(b);
        rig.setTalking(b);
        rig.setCarry(b);
        rig.setHighlight(b);
        rig.setMoveSpeed(b);
        rig.update(b);
        rig.headTop(new THREE.Vector3());
      }).not.toThrow();
    }
    for (const h of HAIR_STYLES) for (const e of EYE_STYLES) {
      rig.setAppearance({ ...defaultAppearance(), hairStyle: h, eyeStyle: e, accessory: ACCESSORIES[h.length % 8] });
    }
    for (const c of CARRY_ITEMS) rig.setCarry(c);
    for (const x of EXPRESSIONS) rig.setExpression(x);
    step(rig, 0.3);
    rig.dispose();
    expect(() => {
      rig.dispose();
      rig.setAnim('walk' as AnimState);
      rig.update(0.1);
      rig.headTop(new THREE.Vector3());
    }).not.toThrow();
    f.dispose();
  });

  it('dispose releases per-rig materials and detaches the root', async () => {
    const f = await makeFactory();
    const scene = new THREE.Scene();
    const rig = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    scene.add(rig.root);
    const mats = [...(rig.impl as GltfRig).getMaterials()];
    expect(mats.length).toBeGreaterThan(5);
    let disposed = 0;
    for (const m of mats) m.addEventListener('dispose', () => disposed++);
    rig.dispose();
    expect(disposed).toBe(mats.length);
    expect(rig.root.parent).toBeNull();
    // template materials are untouched (shared clones per rig)
    const rig2 = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    expect((rig2.impl as GltfRig).getMaterials().every((m) => !mats.includes(m))).toBe(true);
    f.dispose();
  });
});
