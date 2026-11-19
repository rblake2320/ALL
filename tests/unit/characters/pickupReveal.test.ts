/**
 * Pickup reveal (plan.ts CARRY_REVEAL_AT): in the shared `pickup` clip the arm swings down past the thigh before the
 * hand reaches the item, so an item shown from the first frame cut 30-150 mm into the leg on every body (clip audit
 * `pen:item-body` at t = 0.096 s). The item is now shown only once the hand is down; every other clip is unchanged.
 * Checked on the classic rig and a premium body (Lowside, real published file).
 */
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultAppearance, intactLimbs } from '../../../src/shared/appearance';
import type { AnimState } from '../../../src/shared/appearance';
import { createCharacterFactory } from '../../../src/render/characters/index';
import type { ZombieRigDebug } from '../../../src/render/characters/index';
import { CARRY_REVEAL_AT, carryShown } from '../../../src/render/characters/plan';
import { parseGlbWithoutTextures } from './castFixture';
import { ROOT, loadGltf } from './helpers';

const ASSETS = resolve(ROOT, 'public/assets');
const quiet = () => undefined;

function factory() {
  return createCharacterFactory({
    baseUrl: '/assets/',
    gltf: loadGltf(),
    warn: quiet,
    loadCast: async (url) => parseGlbWithoutTextures(readFileSync(resolve(ASSETS, url.replace(/^\/assets\//, '')))),
    loadCastManifest: async (url) => JSON.parse(readFileSync(resolve(ASSETS, url.endsWith('manifest.premium.json') ? 'manifest.premium.json' : 'manifest.cast.json'), 'utf8')),
  });
}

/** Is the carried item drawn (a visible mesh named carry_<item> under the rig)? */
function itemShown(r: ZombieRigDebug, item: string): boolean {
  const o = r.root.getObjectByName(`carry_${item}`);
  if (!o) return false;
  let shown = true;
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) shown = false;
  return shown;
}

describe('pickup: the carried item appears when the hand reaches it', () => {
  it('rule: pickup hides before the reveal time, every other clip always shows', () => {
    const at = CARRY_REVEAL_AT.pickup!;
    expect(at).toBeGreaterThan(0.3);
    expect(at).toBeLessThan(0.62);
    expect(carryShown('pickup', 0)).toBe(false);
    expect(carryShown('pickup', at - 0.01)).toBe(false);
    expect(carryShown('pickup', at)).toBe(true);
    expect(carryShown('pickup', 1.2)).toBe(true);
    expect(carryShown('pickup', NaN)).toBe(true);
    for (const c of ['idle', 'walk', 'cook', 'read', 'standEat'] as AnimState[]) expect(carryShown(c, 0)).toBe(true);
  });

  /** Advance the rig to clip time ~t (s) of the pickup that started at the last setAnim. */
  const at = (r: ZombieRigDebug, from: number, to: number) => r.update(to - from);

  for (const body of ['classic', 'lowside'] as const) {
    const make = async () => {
      const f = factory();
      await f.ready;
      const r = f.create({ ...defaultAppearance(), body }, intactLimbs()) as ZombieRigDebug;
      await f.castSettled();
      expect(r.body).toBe(body);
      return { f, r };
    };

    it(`${body}: an item that arrives with the pickup (fridge, shelf) appears when the hand is down`, async () => {
      // both orders the callers use in one frame: the renderer (setAnim, then setCarry) and the clip audit (reverse)
      for (const order of ['anim-first', 'carry-first'] as const) {
        const { f, r } = await make();
        r.update(0.5);
        if (order === 'anim-first') {
          r.setAnim('pickup');
          r.setCarry('ingredients');
        } else {
          r.setCarry('ingredients');
          r.setAnim('pickup');
        }
        r.update(1 / 60);
        expect(itemShown(r, 'ingredients'), `${order}: first frame`).toBe(false);
        at(r, 1 / 60, 0.2);
        expect(itemShown(r, 'ingredients'), `${order}: 0.2 s, arm passing the thigh`).toBe(false);
        at(r, 0.2, 0.55);
        expect(itemShown(r, 'ingredients'), `${order}: 0.55 s, hand down`).toBe(true);
        at(r, 0.55, 1.5);
        expect(itemShown(r, 'ingredients'), `${order}: after the clip`).toBe(true);
        r.setAnim('idle');
        r.update(1 / 60);
        expect(itemShown(r, 'ingredients'), `${order}: idle`).toBe(true);
        f.dispose();
      }
    });

    it(`${body}: an item already carried into a pickup stays in the hand throughout (Throw Away)`, async () => {
      const { f, r } = await make();
      r.setAnim('walk');
      r.setCarry('dish');
      r.update(0.5);
      expect(itemShown(r, 'dish'), 'carried while walking').toBe(true);
      r.setAnim('pickup'); // the sim keeps the carry when a stage declares none (runner.ts)
      r.update(1 / 60);
      expect(itemShown(r, 'dish'), 'first frame').toBe(true);
      at(r, 1 / 60, 0.2);
      expect(itemShown(r, 'dish'), '0.2 s').toBe(true);
      at(r, 0.2, 0.45);
      expect(itemShown(r, 'dish'), '0.45 s').toBe(true);
      // a different item arriving during the clip still waits for the hand
      r.setCarry('limb');
      r.update(1 / 60);
      expect(itemShown(r, 'limb'), 'swapped in after 0.45 s').toBe(true);
      f.dispose();
    });
  }
});
