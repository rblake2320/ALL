/**
 * W-120 step 2a runtime: the held-prop stow follows the GLB's deforming prop bone (`prop_L/R`, a child of the hand).
 * Synthetic skinned meshes, so each case isolates one rule of prepareHeldProps / HeldPropStow:
 *  1. a rigid island on prop_L is found, re-skinned to heldProp_L UNDER prop_L, and renders bit-for-bit as before;
 *  2. the stow pose is driven in prop_L's frame (not the hand's): stowing moves the prop, fading out restores it;
 *  3. adversarial: a pre-2a export (prop skinned to hand_L, no prop_L) is skipped cleanly - the prop stays on the hand;
 *  4. adversarial: an island that is not 100 % rigid on prop_L, or is below minVerts, is never captured;
 *  5. adversarial: preparing twice does not add a second carrier bone or re-skin again;
 *  6. a missing arm (usable = false) leaves the prop at rest under the collapsed hand, never stowed.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HELD_PROP_RULES, HeldPropStow, prepareHeldProps, type HeldPropRule } from '../../../src/render/characters/heldProps';

type Skin = { bone: number; verts: THREE.Vector3[]; weight?: number };

/** chest(0) -> hand_L(1) -> prop_L(2), plus a torso box on chest and a prop box per `islands`. */
function build(opts: { propBone?: boolean; islands: Skin[] }) {
  const root = new THREE.Group();
  const chest = new THREE.Bone();
  chest.name = 'chest';
  chest.position.set(0, 1.2, 0);
  const hand = new THREE.Bone();
  hand.name = 'hand_L';
  hand.position.set(0.4, -0.3, 0.1);
  hand.quaternion.setFromEuler(new THREE.Euler(0.2, -0.4, 0.3));
  chest.add(hand);
  const bones = [chest, hand];
  if (opts.propBone !== false) {
    const prop = new THREE.Bone();
    prop.name = 'prop_L';
    prop.position.set(-0.03, 0.07, -0.006); // non-identity rest local, like the exported GLBs
    prop.quaternion.set(-0.548, 0.523, 0.438, 0.484).normalize();
    hand.add(prop);
    bones.push(prop);
  }
  root.add(chest);
  root.updateMatrixWorld(true);
  const pos: number[] = [];
  const si: number[] = [];
  const sw: number[] = [];
  const idx: number[] = [];
  const box = (centre: THREE.Vector3, size: THREE.Vector3, bone: number, weight = 1) => {
    const g = new THREE.BoxGeometry(size.x, size.y, size.z, 2, 2, 2);
    const base = pos.length / 3;
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i) + centre.x, p.getY(i) + centre.y, p.getZ(i) + centre.z);
      si.push(bone, 0, 0, 0);
      sw.push(weight, 1 - weight, 0, 0);
    }
    const gi = g.index!;
    for (let i = 0; i < gi.count; i++) idx.push(base + gi.getX(i));
  };
  box(new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0.4, 0.5, 0.25), 0);
  for (const isl of opts.islands) box(isl.verts[0], isl.verts[1], isl.bone, isl.weight ?? 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.setIndex(idx);
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
  root.add(mesh);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton);
  root.updateMatrixWorld(true);
  return { root, mesh, hand };
}

const lid = (bone = 2, weight = 1): Skin => ({ bone, weight, verts: [new THREE.Vector3(0.45, 0.85, 0.15), new THREE.Vector3(0.12, 0.5, 0.04)] });
const rule = (over: Partial<HeldPropRule> = {}): HeldPropRule => ({
  bone: 'prop_L', hand: 'hand_L', minVerts: 20, anchor: 'chest', gap: 0.03, stow: new Map([['crawl', 'back']]), ...over,
});

function skinned(mesh: THREE.SkinnedMesh): number[] {
  const v = new THREE.Vector3();
  const out: number[] = [];
  for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
    mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
    out.push(v.x, v.y, v.z);
  }
  return out;
}

const maxDiff = (a: number[], b: number[]) => a.reduce((m, x, i) => Math.max(m, Math.abs(x - b[i])), 0);

describe('W-120 step 2a: held-prop stow on the prop bone', () => {
  it('the shipped shield rule reads the lid from prop_L and keys arm loss on hand_L', () => {
    const [r] = HELD_PROP_RULES.shield!;
    expect(r.bone).toBe('prop_L');
    expect(r.hand).toBe('hand_L');
  });

  it('captures the rigid island on prop_L, parents the carrier under prop_L, and renders unchanged at rest', () => {
    const { root, mesh } = build({ islands: [lid()] });
    const before = skinned(mesh);
    const [b] = prepareHeldProps(root, mesh, [rule()]);
    expect(b).toBeDefined();
    expect(b.parent).toBe('prop_L');
    expect(b.hand).toBe('hand_L');
    expect(b.bone).toBe('heldProp_L');
    expect(b.vertexCount).toBeGreaterThanOrEqual(20);
    expect(root.getObjectByName('heldProp_L')!.parent!.name).toBe('prop_L');
    root.updateMatrixWorld(true);
    expect(maxDiff(skinned(mesh), before)).toBeLessThan(1e-6);
  });

  it('stows in the prop bone frame and returns exactly to rest when the stow clip fades out', () => {
    const { root, mesh } = build({ islands: [lid()] });
    const rest = skinned(mesh);
    const bindings = prepareHeldProps(root, mesh, [rule()]);
    const stow = new HeldPropStow(bindings, (n) => root.getObjectByName(n));
    expect(stow.size).toBe(1);
    stow.update([{ clip: 'crawl', weight: 1 }], () => true, root);
    root.updateMatrixWorld(true);
    expect(stow.last[0].stow).toBe(1);
    const stowed = skinned(mesh);
    expect(maxDiff(stowed, rest)).toBeGreaterThan(0.05); // the lid really moved to the back
    // and it sits exactly at the measured stow pose: carrier world = anchor world × inAnchor (frame bugs show here)
    const want = root.getObjectByName('chest')!.matrixWorld.clone().multiply(bindings[0].inAnchor.get('back')!);
    const got = root.getObjectByName('heldProp_L')!.matrixWorld;
    expect(maxDiff(Array.from(got.elements), Array.from(want.elements))).toBeLessThan(1e-6);
    // the torso (first box) is never touched by the stow
    const torsoN = 54 * 3; // BoxGeometry(…, 2, 2, 2): 6 faces × 3 × 3 vertices
    expect(maxDiff(stowed.slice(0, torsoN), rest.slice(0, torsoN))).toBeLessThan(1e-9);
    stow.update([{ clip: 'idle', weight: 1 }], () => true, root);
    root.updateMatrixWorld(true);
    expect(maxDiff(skinned(mesh), rest)).toBeLessThan(1e-6);
  });

  it("W-151 'away': the prop shrinks into the hand by the clip's weight, is gone at full weight, and returns exactly", () => {
    const { root, mesh } = build({ islands: [lid()] });
    const rest = skinned(mesh);
    const away = new Map(rule().stow as Map<never, never>) as Map<string, string>;
    away.set('sitTV', 'away');
    const bindings = prepareHeldProps(root, mesh, [rule({ stow: away as never })]);
    // both body spots are always measured, whatever the table lists
    expect([...bindings[0].inAnchor.keys()].sort()).toEqual(['back', 'chest']);
    const stow = new HeldPropStow(bindings, (n) => root.getObjectByName(n));
    const bone = root.getObjectByName('heldProp_L')!;
    stow.update([{ clip: 'sitTV' as never, weight: 1 }], () => true, root);
    root.updateMatrixWorld(true);
    expect(stow.last[0]).toMatchObject({ stow: 1, away: 1 });
    expect(bone.scale.toArray()).toEqual([0, 0, 0]);
    // every prop vertex collapses onto the carrier (the hand); the torso does not move
    const gone = skinned(mesh);
    const torsoN = 54 * 3;
    expect(maxDiff(gone.slice(0, torsoN), rest.slice(0, torsoN))).toBeLessThan(1e-9);
    const p = bone.getWorldPosition(new THREE.Vector3());
    for (let i = torsoN; i < gone.length; i += 3) {
      expect(Math.hypot(gone[i] - p.x, gone[i + 1] - p.y, gone[i + 2] - p.z)).toBeLessThan(1e-6);
    }
    // mid-crossfade (sitting down): half size, still at the hand, no rotation towards a body spot
    stow.update([{ clip: 'sitTV' as never, weight: 0.5 }, { clip: 'idle', weight: 0.5 }], () => true, root);
    expect(stow.last[0].away).toBeCloseTo(0.5, 6);
    expect(bone.scale.x).toBeCloseTo(0.5, 6);
    expect(bone.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
    // hostile weights never produce a negative / NaN scale
    stow.update([{ clip: 'sitTV' as never, weight: 7 }, { clip: 'sitTV' as never, weight: NaN }], () => true, root);
    expect(bone.scale.x).toBe(0);
    stow.update([{ clip: 'idle', weight: 1 }], () => true, root);
    root.updateMatrixWorld(true);
    expect(bone.scale.toArray()).toEqual([1, 1, 1]);
    expect(maxDiff(skinned(mesh), rest)).toBeLessThan(1e-6);
  });

  it('adversarial: a pre-2a export (lid on hand_L, no prop_L) is skipped - the prop stays on the hand', () => {
    const { root, mesh } = build({ propBone: false, islands: [lid(1)] });
    const before = skinned(mesh);
    expect(prepareHeldProps(root, mesh, [rule()])).toEqual([]);
    expect(root.getObjectByName('heldProp_L')).toBeUndefined();
    expect(maxDiff(skinned(mesh), before)).toBe(0);
  });

  it('adversarial: a prop_L island that is not fully rigid, or is too small, is never captured', () => {
    const soft = build({ islands: [lid(2, 0.9)] });
    expect(prepareHeldProps(soft.root, soft.mesh, [rule()])).toEqual([]);
    const tiny = build({ islands: [lid()] });
    expect(prepareHeldProps(tiny.root, tiny.mesh, [rule({ minVerts: 10_000 })])).toEqual([]);
  });

  it('adversarial: preparing the same template twice adds no second carrier and re-skins nothing', () => {
    const { root, mesh } = build({ islands: [lid()] });
    prepareHeldProps(root, mesh, [rule()]);
    const bones = mesh.skeleton.bones.length;
    const si = Array.from((mesh.geometry.attributes.skinIndex as THREE.BufferAttribute).array);
    expect(prepareHeldProps(root, mesh, [rule()])).toEqual([]);
    expect(mesh.skeleton.bones.length).toBe(bones);
    expect(Array.from((mesh.geometry.attributes.skinIndex as THREE.BufferAttribute).array)).toEqual(si);
  });

  it('a missing arm leaves the prop at rest under the hand (never stowed)', () => {
    const { root, mesh } = build({ islands: [lid()] });
    const rest = skinned(mesh);
    const stow = new HeldPropStow(prepareHeldProps(root, mesh, [rule()]), (n) => root.getObjectByName(n));
    stow.update([{ clip: 'crawl', weight: 1 }], (h) => h !== 'hand_L', root);
    root.updateMatrixWorld(true);
    expect(stow.last[0].stow).toBe(0);
    expect(maxDiff(skinned(mesh), rest)).toBeLessThan(1e-6);
  });
});
