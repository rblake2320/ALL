/**
 * The runtime against the REAL published cast bodies (public/assets/models/characters/cast/*.glb +
 * manifest.cast.json). Skipped until the assets are published. Textures are stripped for Node (castFixture
 * parseGlbWithoutTextures); geometry, skin, Rig extras and the manifest are the shipped ones.
 */
import * as THREE from 'three';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANIM_STATES, defaultAppearance, intactLimbs } from '../../../src/shared/appearance';
import { CAST_BODY_IDS } from '../../../src/shared/cast';
import type { CastBodyId } from '../../../src/shared/cast';
import { DIM } from '../../../src/shared/dimensions';
import { createCharacterFactory } from '../../../src/render/characters/index';
import type { ZombieRigDebug } from '../../../src/render/characters/index';
import { parseGlbWithoutTextures } from './castFixture';
import { ROOT, loadGltf } from './helpers';

const ASSETS = resolve(ROOT, 'public/assets');
const MANIFEST = resolve(ASSETS, 'manifest.cast.json');
const published = existsSync(MANIFEST) && CAST_BODY_IDS.every((id) => existsSync(resolve(ASSETS, `models/characters/cast/${id}.glb`)));

const step = (rig: { update(dt: number): void }, sec: number, dt = 1 / 30) => {
  for (let i = 0; i < Math.round(sec / dt); i++) rig.update(dt);
};

function factory(warnings: string[]) {
  return createCharacterFactory({
    baseUrl: '/assets/',
    gltf: loadGltf(),
    warn: (m) => warnings.push(m),
    loadCast: async (url) => parseGlbWithoutTextures(readFileSync(resolve(ASSETS, url.replace(/^\/assets\//, '')))),
    loadCastManifest: async () => JSON.parse(readFileSync(MANIFEST, 'utf8')),
  });
}

const wy = (r: ZombieRigDebug, bone: string) => {
  r.root.updateMatrixWorld(true);
  return r.root.getObjectByName(bone)!.getWorldPosition(new THREE.Vector3()).y;
};

describe.skipIf(!published)('published cast bodies on the runtime', () => {
  const manifest = published ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as { bodies: { id: CastBodyId; headTop: number; seatPelvisOffset: number[] }[] }) : { bodies: [] };

  it('every body loads as a single-draw cast rig, plays all 45 states, sits on the seat, stands on the floor', async () => {
    const warnings: string[] = [];
    const f = factory(warnings);
    const rigs = CAST_BODY_IDS.map((id) => [id, f.create({ ...defaultAppearance(), body: id }, intactLimbs()) as ZombieRigDebug] as const);
    await f.ready;
    await f.castSettled();
    for (const [id, r] of rigs) {
      expect(r.kind, id).toBe('cast');
      expect(r.stats().drawCalls, id).toBe(1);
      const sk = new Set<THREE.Skeleton>();
      r.root.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && sk.add((o as THREE.SkinnedMesh).skeleton));
      expect(sk.size, id).toBe(1);
      const entry = manifest.bodies.find((b) => b.id === id)!;
      r.setAnim('idle');
      step(r, 0.5);
      const feet = Math.min(wy(r, 'foot_L'), wy(r, 'foot_R'));
      expect(feet, `${id} feet`).toBeGreaterThan(-0.05);
      expect(feet, `${id} feet`).toBeLessThan(0.2);
      const top = r.headTop(new THREE.Vector3()).y;
      expect(Math.abs(top - entry.headTop), `${id} headTop ${top}`).toBeLessThan(0.2);
      r.setAnim('sit');
      step(r, 0.6);
      expect(wy(r, 'pelvis'), `${id} seat`).toBeCloseTo(DIM.SEAT_HEIGHT + (entry.seatPelvisOffset?.[1] ?? 0), 2);
      for (const a of ANIM_STATES) {
        r.setAnim(a);
        r.update(0.05);
      }
      r.setAnim('sleep');
      step(r, 0.6);
      expect(r.headTop(new THREE.Vector3()).y, `${id} lying`).toBeLessThan(0.9);
    }
    expect(warnings).toEqual([]);
    f.dispose();
  }, 120000);

  it('limb collapse and carry anchors on real skeletons; all templates freed on dispose', async () => {
    const warnings: string[] = [];
    const f = factory(warnings);
    const r = f.create({ ...defaultAppearance(), body: 'boss' }, { armL: 'ok', armR: 'missing', legL: 'prosthetic', legR: 'ok' }) as ZombieRigDebug;
    await f.ready;
    await f.castSettled();
    expect(r.kind).toBe('cast');
    r.setCarry('plate');
    r.setAnim('walk');
    step(r, 0.5);
    expect(r.root.getObjectByName('carry_plate')?.parent?.name).toBe('prop_L');
    expect(r.root.getObjectByName('Stump_ArmR')).toBeTruthy();
    expect(r.root.getObjectByName('Prosthetic_LegL')).toBeTruthy();
    r.setLimbs(intactLimbs());
    r.setAnim('sitEat');
    step(r, 0.3);
    expect(r.root.getObjectByName('carry_plate')?.parent?.name).toBe('hand_L');
    r.dispose();
    f.dispose();
    expect(f.castStats().loaded).toEqual([]);
    expect(warnings).toEqual([]);
  }, 60000);
});
