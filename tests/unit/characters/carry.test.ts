/**
 * Carry placement (src/render/characters/anchors.ts + carry.ts) and its use by the GLB rig:
 *  - anchor parsing is total (garbage dropped), mirroring is an exact involution,
 *  - placement rules (anchor vs palm fallback vs none) for every limb combination,
 *  - on the real asset: the plate rests level on the left palm while a fork eats from it (sitEat / standEat),
 *    the open book sits between both hands facing the reader, the phone is pressed to the right ear outside the
 *    head - and everything mirrors when the right arm is missing.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CARRY_ITEMS, defaultAppearance, intactLimbs } from '../../../src/shared/appearance';
import type { AnimState, CarryItem, LimbState } from '../../../src/shared/appearance';
import { ANCHOR_SCALE_MAX, ANCHOR_SCALE_MIN, mirrorLocalMatrix, parseCarryAnchors, resolveCarry } from '../../../src/render/characters/anchors';
import type { CarryAnchor } from '../../../src/render/characters/anchors';
import { CarryLibrary } from '../../../src/render/characters/carry';
import { createCharacterFactory } from '../../../src/render/characters/index';
import type { ZombieRigDebug } from '../../../src/render/characters/index';
import type { AnimPlan } from '../../../src/render/characters/plan';
import { loadGltf, readGlbJson } from './helpers';

const quiet = () => undefined;
const plan = (clip: AnimState, mirror = false): AnimPlan => ({ clip, mirror, timeScale: 1 });
const limbs = (o: Partial<LimbState> = {}): LimbState => ({ ...intactLimbs(), ...o });
const ID = new THREE.Matrix4().makeTranslation(0.01, 0.02, 0.03).toArray();

function anchorsFixture(): Map<string, CarryAnchor> {
  return parseCarryAnchors(JSON.stringify({
    sitEat: { items: ['plate', 'dish'], bone: 'hand_L', matrix: ID, variant: 'centered',
      extra: { item: 'fork', bone: 'hand_R', matrix: ID } },
    read: { items: ['book'], bone: 'chest', matrix: ID, variant: 'open' },
    phone: { items: ['phone'], bone: 'hand_R', matrix: ID, variant: 'centered' },
  }));
}

describe('parseCarryAnchors', () => {
  it('reads the exported structure (JSON string or object)', () => {
    const a = anchorsFixture();
    expect([...a.keys()].sort()).toEqual(['phone', 'read', 'sitEat']);
    expect(a.get('sitEat')!.extra!.bone).toBe('hand_R');
    expect(a.get('read')!.variant).toBe('open');
    expect(parseCarryAnchors({ phone: { items: ['phone'], bone: 'hand_R', matrix: ID, variant: 'centered' } }).size).toBe(1);
  });

  it('drops garbage without throwing', () => {
    const bad: unknown[] = [undefined, null, 42, 'not json{', '[]', [], { x: null }, { x: 'str' },
      { a: { items: ['plate'], bone: 'hand_L', matrix: [1, 2, 3], variant: 'centered' } },             // short matrix
      { a: { items: ['plate'], bone: 'hand_L', matrix: new Array(16).fill(NaN), variant: 'centered' } },
      { a: { items: ['plate'], bone: 'hand_L', matrix: new THREE.Matrix4().makeScale(3, 3, 3).toArray(), variant: 'centered' } },
      { a: { items: ['plate'], bone: 'hand_L', matrix: new THREE.Matrix4().makeScale(-1, 1, 1).toArray(), variant: 'centered' } },
      { a: { items: ['spoon'], bone: 'hand_L', matrix: ID, variant: 'centered' } },                    // unknown item
      { a: { items: ['plate'], bone: 'hand L; drop', matrix: ID, variant: 'centered' } },              // bad bone name
      { a: { items: ['plate'], bone: 'hand_L', matrix: ID, variant: 'palm' } },                        // not an anchor variant
    ];
    for (const b of bad) expect(() => parseCarryAnchors(b)).not.toThrow();
    for (const b of bad) expect(parseCarryAnchors(b).size).toBe(0);
    // a broken extra is dropped but the anchor survives
    const a = parseCarryAnchors({ a: { items: ['plate'], bone: 'hand_L', matrix: ID, variant: 'centered',
      extra: { item: 'fork', bone: 'hand_R', matrix: 'nope' } } });
    expect(a.get('a')!.extra).toBeNull();
  });

  it('accepts one uniform item scale inside the allowed range and nothing else that is not rigid', () => {
    const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.7, 1.1));
    const at = (sx: number, sy = sx, sz = sx): number[] =>
      new THREE.Matrix4().compose(new THREE.Vector3(0.1, 0.2, 0.3), rot, new THREE.Vector3(sx, sy, sz)).toArray();
    const size = (matrix: number[]): number =>
      parseCarryAnchors({ read: { items: ['book'], bone: 'chest', matrix, variant: 'open' } }).size;
    for (const s of [ANCHOR_SCALE_MIN, 0.9, 1.25, 1.45, ANCHOR_SCALE_MAX]) expect(size(at(s)), `scale ${s}`).toBe(1);
    // the scale survives parsing and mirroring
    const kept = parseCarryAnchors({ read: { items: ['book'], bone: 'chest', matrix: at(1.45), variant: 'open' } }).get('read')!;
    const sc = new THREE.Vector3();
    kept.matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), sc);
    expect(sc.toArray()).toEqual([1.45, 1.45, 1.45].map((x) => expect.closeTo(x, 9)));
    mirrorLocalMatrix(kept.matrix).decompose(new THREE.Vector3(), new THREE.Quaternion(), sc);
    expect(sc.toArray().map(Math.abs)).toEqual([1.45, 1.45, 1.45].map((x) => expect.closeTo(x, 9)));
    // outside the range, uneven, sheared, mirrored or collapsed: dropped
    const bad = [at(ANCHOR_SCALE_MIN - 0.02), at(ANCHOR_SCALE_MAX + 0.02), at(3), at(0.1), at(1.3, 1.3, 1.6), at(1.2, 1 / 1.2, 1.3),
      at(-1.3), at(1.3, -1.3, 1.3), at(0), new THREE.Matrix4().makeScale(1.3, 1.3, 1.3).multiply(new THREE.Matrix4().makeShear(0, 0.4, 0, 0, 0, 0)).toArray()];
    for (const [i, m] of bad.entries()) expect(size(m), `bad ${i}`).toBe(0);
    // determinant 1 without being rigid (Astra's audit of 3aeb32c): uneven scales and a shear
    const shear = new THREE.Matrix4().identity().toArray();
    shear[4] = 100;
    const det1 = [new THREE.Matrix4().makeScale(1000, 0.001, 1).toArray(), new THREE.Matrix4().makeScale(2, 0.5, 1).toArray(), shear,
      at(1.25, 0.8, 1)];
    for (const [i, m] of det1.entries()) expect(size(m), `determinant-1 ${i}`).toBe(0);
  });

  it('mirroring is an exact, rigid involution that flips the lateral axis', () => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(0.1, -0.2, 0.3),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.7, 1.1)), new THREE.Vector3(1, 1, 1));
    const once = mirrorLocalMatrix(m);
    const twice = mirrorLocalMatrix(once);
    for (let i = 0; i < 16; i++) expect(twice.elements[i]).toBeCloseTo(m.elements[i], 12);
    expect(once.determinant()).toBeCloseTo(1, 12);
    const p = new THREE.Vector3().setFromMatrixPosition(once);
    expect(p.toArray()).toEqual([-0.1, -0.2, 0.3].map((x) => expect.closeTo(x, 12)));
  });
});

describe('resolveCarry rules', () => {
  const A = anchorsFixture();

  it('nothing carried -> none; unanchored clip -> palm of the right hand (hold pose only in HOLD_ANIMS)', () => {
    expect(resolveCarry(null, plan('walk'), limbs(), A).kind).toBe('none');
    const walk = resolveCarry('pizza', plan('walk'), limbs(), A);
    expect(walk).toMatchObject({ kind: 'palm', bone: 'prop_R', hold: true, variant: 'palm' });
    expect(resolveCarry('pizza', plan('talk'), limbs(), A)).toMatchObject({ kind: 'palm', hold: false });
    // anchor exists for the clip but not for this item -> palm
    expect(resolveCarry('pizza', plan('sitEat'), limbs(), A).kind).toBe('palm');
  });

  it('anchored clip -> bone + matrix + extra; key changes only when the attachment changes', () => {
    const eat = resolveCarry('plate', plan('sitEat'), limbs(), A);
    expect(eat).toMatchObject({ kind: 'anchor', bone: 'hand_L', variant: 'centered', hold: false });
    expect(eat.extra).toMatchObject({ item: 'fork', bone: 'hand_R' });
    expect(resolveCarry('plate', plan('sitEat'), limbs(), A).key).toBe(eat.key);
    expect(resolveCarry('dish', plan('sitEat'), limbs(), A).key).not.toBe(eat.key);
    expect(resolveCarry('book', plan('read'), limbs(), A)).toMatchObject({ kind: 'anchor', bone: 'chest', variant: 'open' });
  });

  it('mirrored clips mirror the anchor bones and matrices', () => {
    const m = resolveCarry('phone', plan('phone', true), limbs({ armR: 'missing' }), A);
    expect(m).toMatchObject({ kind: 'anchor', bone: 'hand_L' });
    const p = new THREE.Vector3().setFromMatrixPosition(m.matrix!);
    expect(p.x).toBeCloseTo(-0.01, 9);
    const eat = resolveCarry('plate', plan('sitEat', true), limbs({ armL: 'missing' }), A);
    // mirrored plate hand (hand_R) exists; mirrored fork hand (hand_L) is gone -> no extra
    expect(eat).toMatchObject({ kind: 'anchor', bone: 'hand_R', extra: null });
  });

  it('falls back to the palm when the anchor hand is missing, and to nothing without hands', () => {
    // one-armed reader: the open book needs both hands -> closed book on the remaining palm
    expect(resolveCarry('book', plan('read'), limbs({ armR: 'missing' }), A)).toMatchObject({ kind: 'palm', bone: 'prop_L' });
    expect(resolveCarry('book', plan('read'), limbs({ armL: 'missing' }), A)).toMatchObject({ kind: 'palm', bone: 'prop_R' });
    // one-armed eater: the plate hand is gone -> fork only (never the plate on the eating hand)
    expect(resolveCarry('plate', plan('sitEat'), limbs({ armL: 'missing' }), A)).toMatchObject({ kind: 'extra', extra: { bone: 'hand_R' } });
    for (const item of CARRY_ITEMS) {
      for (const clip of ['walk', 'sitEat', 'read', 'phone'] as AnimState[]) {
        expect(resolveCarry(item, plan(clip), limbs({ armL: 'missing', armR: 'missing' }), A).kind).toBe('none');
      }
    }
    // prosthetic hands hold things like real ones
    expect(resolveCarry('book', plan('read'), limbs({ armL: 'prosthetic' }), A).kind).toBe('anchor');
  });
});

describe('CarryLibrary', () => {
  it('builds every item in every variant, shares geometry between instances and disposes once', () => {
    const lib = new CarryLibrary();
    const a = lib.create('plate');
    const b = lib.create('plate');
    const meshesOf = (o: THREE.Object3D) => {
      const out: THREE.Mesh[] = [];
      o.traverse((x) => (x as THREE.Mesh).isMesh && out.push(x as THREE.Mesh));
      return out;
    };
    expect(meshesOf(a)[0].geometry).toBe(meshesOf(b)[0].geometry);
    for (const item of CARRY_ITEMS) {
      for (const v of ['palm', 'centered', 'open'] as const) {
        const o = lib.create(item, v);
        expect(o.name).toBe(`carry_${item}`);
        const box = new THREE.Box3().setFromObject(o);
        const size = box.getSize(new THREE.Vector3());
        expect(Math.max(size.x, size.y, size.z), `${item}/${v}`).toBeLessThan(0.6); // the spare forearm is the longest
        expect(meshesOf(o).length).toBeGreaterThan(0);
      }
    }
    // the open book is wider than tall-off-the-page (two pages side by side)
    const open = new THREE.Box3().setFromObject(lib.create('book', 'open')).getSize(new THREE.Vector3());
    expect(open.x).toBeGreaterThan(0.22);
    expect(lib.createExtra('fork').name).toBe('carry_fork');
    // baked: every item is one draw call (the phone adds its glowing screen)
    for (const item of CARRY_ITEMS) {
      const count = meshesOf(lib.create(item)).length;
      expect(count, item).toBe(item === 'phone' ? 2 : 1);
    }
    expect(meshesOf(lib.create('book', 'open')).length).toBe(1);
    expect(meshesOf(lib.createExtra('fork')).length).toBe(1);
    let disposed = 0;
    meshesOf(a)[0].geometry.addEventListener('dispose', () => disposed++);
    lib.dispose();
    lib.dispose();
    expect(disposed).toBe(1);
    expect(lib.isDisposed).toBe(true);
  });
});

describe('carry anchors on the real asset', () => {
  const rigNode = (readGlbJson().json.nodes as any[]).find((n) => n.name === 'Rig');
  const exported = parseCarryAnchors(rigNode.extras.carryAnchors);

  it('the GLB exports valid anchors for eating, reading and phoning', () => {
    for (const anim of ['sitEat', 'standEat', 'read', 'sitRead', 'phone']) expect(exported.has(anim), anim).toBe(true);
    expect(exported.get('sitEat')!.extra?.item).toBe('fork');
    expect(exported.get('read')!.variant).toBe('open');
  });

  async function rigWith(anim: AnimState, item: CarryItem, l: LimbState = intactLimbs()) {
    const f = createCharacterFactory({ baseUrl: '/assets/', gltf: loadGltf(), warn: quiet });
    await f.ready;
    const rig = f.create(defaultAppearance(), l) as ZombieRigDebug;
    rig.setAnim(anim);
    rig.setCarry(item);
    for (let i = 0; i < 30; i++) rig.update(1 / 30);
    rig.root.updateMatrixWorld(true);
    return { f, rig };
  }
  const world = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
  const up = (o: THREE.Object3D) => new THREE.Vector3(0, 1, 0).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));

  it('eating: plate level on the left palm in front of the body, fork in the right hand', async () => {
    for (const anim of ['sitEat', 'standEat'] as AnimState[]) {
      const { f, rig } = await rigWith(anim, 'plate');
      const plate = rig.root.getObjectByName('carry_plate')!;
      expect(plate.parent!.name, anim).toBe('hand_L');
      expect(up(plate).y, `${anim} plate level`).toBeGreaterThan(0.95);
      const handL = world(rig.root.getObjectByName('hand_L')!);
      expect(world(plate).distanceTo(handL), anim).toBeLessThan(0.16);
      expect(world(plate).z, `${anim} in front`).toBeGreaterThan(0.2);
      expect(rig.root.getObjectByName('carry_fork')!.parent!.name).toBe('hand_R');
      // the plate never flies to the mouth: it stays below the chin over the whole clip
      const head = rig.root.getObjectByName('head')!;
      for (let i = 0; i < 12; i++) {
        rig.update(0.25);
        rig.root.updateMatrixWorld(true);
        expect(world(plate).y, anim).toBeLessThan(world(head).y - 0.2);
        expect(up(plate).y, anim).toBeGreaterThan(0.9);
      }
      f.dispose();
    }
  });

  it('reading: open book between both hands, pages facing the reader', async () => {
    for (const anim of ['read', 'sitRead'] as AnimState[]) {
      const { f, rig } = await rigWith(anim, 'book');
      const book = rig.root.getObjectByName('carry_book')!;
      expect(book.userData.carryVariant).toBe('open');
      const mid = world(rig.root.getObjectByName('hand_L')!).add(world(rig.root.getObjectByName('hand_R')!)).multiplyScalar(0.5);
      expect(world(book).distanceTo(mid), anim).toBeLessThan(0.12);
      const toHead = world(rig.root.getObjectByName('head')!).sub(world(book)).normalize();
      expect(up(book).dot(toHead), `${anim} pages face the reader`).toBeGreaterThan(0.6);
      f.dispose();
    }
  });

  it('phoning: the phone is pressed to the right side of the head, outside the skull, and mirrors', async () => {
    for (const [l, side] of [[intactLimbs(), -1], [{ ...intactLimbs(), armR: 'missing' }, 1]] as [LimbState, number][]) {
      const { f, rig } = await rigWith('phone', 'phone', l);
      const phone = rig.root.getObjectByName('carry_phone')!;
      const head = rig.root.getObjectByName('head')!;
      head.updateWorldMatrix(true, false);
      // head centre ~0.14 above the head bone (neck top), in head space
      const centre = new THREE.Vector3(0, 0.14, 0).applyMatrix4(head.matrixWorld);
      const p = world(phone);
      const local = p.clone().sub(centre);
      expect(Math.sign(local.x), 'ear side').toBe(side);
      expect(local.length()).toBeGreaterThan(0.15);   // outside the skull (head radius ~0.17 incl. the cheek gap)
      expect(local.length()).toBeLessThan(0.30);      // ...but at the ear
      f.dispose();
    }
  });

  it('carry follows clip changes: palm while walking, anchored while eating, palm again after', async () => {
    const { f, rig } = await rigWith('walk', 'plate');
    expect(rig.root.getObjectByName('carry_plate')!.parent!.name).toBe('prop_R');
    rig.setAnim('sitEat');
    rig.update(1 / 30);
    expect(rig.root.getObjectByName('carry_plate')!.parent!.name).toBe('hand_L');
    expect(rig.root.getObjectByName('carry_fork')).toBeTruthy();
    rig.setAnim('walk');
    rig.update(1 / 30);
    expect(rig.root.getObjectByName('carry_plate')!.parent!.name).toBe('prop_R');
    expect(rig.root.getObjectByName('carry_fork')).toBeFalsy();
    let count = 0;
    rig.root.traverse((o) => o.name.startsWith('carry_') && count++);
    expect(count).toBe(1);
    f.dispose();
  });
});
