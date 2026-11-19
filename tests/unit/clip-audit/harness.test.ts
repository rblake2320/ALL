/**
 * CLIP-AUDIT harness pins against the REAL runtime + assets (skipped when the GLBs are not published):
 *  - the harness drives the runtime rig's private clip actions (exact-time sampling): fail loudly if renamed;
 *  - sampling is deterministic;
 *  - slot poses equal the sim's own resolveSlotsFor() output, and the slot pose expressed in the RENDERED object's
 *    frame is the same for all four rotations (sim slot math and render placement agree);
 *  - real-asset controls: a classic zombie idling on the floor passes, the same rig sunk 100 mm reads ~100 mm,
 *    a sitter dropped 150 mm into a real chair reads as a deep penetration while the shipped pose reads shallower.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PHYSICAL_SPECS } from '../../../src/shared/catalog';
import type { Rot } from '../../../src/shared/dimensions';
import { resolveSlotsFor, type ObjectGeom } from '../../../src/sim/spatial/slots';
import { frameCentre, frameTiles } from '../../../src/sim/spatial/geometry';
import type { Grid } from '../../../src/sim/spatial/grid';
import { hasAsset } from '../../../tools/clip-audit/assets';
import { lowestY, makeSolid, penetration } from '../../../tools/clip-audit/detect';
import { placeFloorObject, slotPose } from '../../../tools/clip-audit/objects';
import { internals, poseRig, rigFor, sampleRig } from '../../../tools/clip-audit/rigs';
import { buildMatrix } from '../../../tools/clip-audit/scenarios';

const published = hasAsset('models/characters/zombie.glb') && hasAsset('models/objects/chair_creaky.glb') && hasAsset('manifest.cast.json');

/** A wall-less, empty grid big enough for every frame used here (slot POSES do not depend on walls). */
function openGrid(): Grid {
  const w = 40;
  const d = 40;
  const n = w * d;
  return {
    w, d, n, buildable: { x0: 0, z0: 0, x1: w, z1: d }, sidewalkZ: d - 1,
    blocked: new Uint8Array(n), looseBlocked: new Uint8Array(n), objAt: new Array(n).fill(null), rugAt: new Array(n).fill(null),
    floorItemsAt: new Array(n).fill(null), wallH: new Uint8Array(w * (d + 1)), wallV: new Uint8Array((w + 1) * d),
    openingOf: new Map(), wallItems: new Map(), doorAdj: new Uint8Array(n), wallAdj: new Uint8Array(n), stepMask: new Uint8Array(n),
  };
}

describe('scenario matrix', () => {
  it('is derived from content, deterministic, and covers seats, beds, counters, socials and every clip', () => {
    const a = buildMatrix();
    const b = buildMatrix();
    expect(a.map((s) => s.key)).toEqual(b.map((s) => s.key));
    const keys = new Set(a.map((s) => s.key));
    expect(keys.has('slot:armchair_tattered#sit:sit')).toBe(true);
    expect(keys.has('slot:coffin_pine#lie:sleep')).toBe(true);
    expect(keys.has('slot:stove_greasefire#front:cook')).toBe(true);
    expect(keys.has('slot:chair_creaky#sit:sitEat+plate|table_rickety@0,1')).toBe(true);
    expect(keys.has('pair:hug~hug@0.55')).toBe(true);
    expect(keys.has('floor:walk')).toBe(true);
    // the "no free seat" fallback swaps sitEat for standEat in the sim (eating.ts): never a seated clip mid-air
    expect(keys.has('floor:sitEat+plate')).toBe(false);
    expect(keys.has('slot:tv_crt#watch:sitTV')).toBe(false);
  });
});

describe.skipIf(!published)('harness on the real runtime + assets', () => {
  it('slot poses equal the sim (resolveSlotsFor) and are rotation-invariant in the rendered object frame', async () => {
    const g = openGrid();
    for (const spec of PHYSICAL_SPECS) {
      if (spec.placement !== 'floor' || !spec.slots.some((s) => s.pose && !s.faceObject)) continue;
      const local: string[] = [];
      for (const rot of [0, 1, 2, 3] as Rot[]) {
        const frame = { w: spec.footprint.w, d: spec.footprint.d, ox: 12, oz: 12, rot };
        const geom: ObjectGeom = { frame, body: frameTiles(frame), solidBody: true, centre: frameCentre(frame) };
        const sim = resolveSlotsFor(g, spec, geom);
        spec.slots.forEach((s, i) => {
          if (!s.pose || s.faceObject) return;
          const ours = slotPose(spec, frame, i);
          const theirs = sim.find((r) => r.index === i)!;
          expect(ours.x, `${spec.id}#${s.id} rot ${rot}`).toBeCloseTo(theirs.pose!.x, 9);
          expect(ours.z).toBeCloseTo(theirs.pose!.z, 9);
          expect(ours.y).toBeCloseTo(theirs.pose!.y, 9);
          expect(Math.cos(ours.facing - theirs.pose!.facing)).toBeCloseTo(1, 9);
        });
      }
      if (!hasAsset(`models/objects/${spec.id}.glb`)) continue;
      for (const rot of [0, 1, 2, 3] as Rot[]) {
        const o = await placeFloorObject(spec.id, 12, 12, rot, false, false);
        const inv = new THREE.Matrix4().copy(o.root.matrixWorld).invert();
        const yaw = o.root.rotation.y;
        const fmt = (v: number) => (Math.round(v * 1e6) / 1e6 + 0).toFixed(6);
        spec.slots.forEach((s, i) => {
          if (!s.pose || s.faceObject) return;
          const p = slotPose(spec, o.frame, i);
          const v = new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(inv);
          const f = Math.atan2(Math.sin(p.facing - yaw), Math.cos(p.facing - yaw));
          const key = `${fmt(v.x)},${fmt(v.z)},${fmt(f)}`;
          local[i] = local[i] ?? key;
          expect(key, `${spec.id}#${s.id} rot ${rot}`).toBe(local[i]);
        });
      }
    }
  }, 240000);

  it('drives the runtime rig at exact clip times, deterministically', async () => {
    const lr = await rigFor({ body: 'classic', height: 0.5 });
    expect(internals(lr.rig).actions).toBeInstanceOf(Map);
    const pose = { x: 3, y: 0, z: 4, facing: 0.7 };
    poseRig(lr, { anim: 'walk' }, pose, 0.31);
    const a = sampleRig(lr);
    poseRig(lr, { anim: 'sit' }, pose, 1.2);
    poseRig(lr, { anim: 'walk' }, pose, 0.31);
    const b = sampleRig(lr);
    expect(a.clip).toBe('walk');
    expect(Array.from(b.body.pos)).toEqual(Array.from(a.body.pos));
    poseRig(lr, { anim: 'walk' }, pose, 0.11);
    const c = sampleRig(lr);
    expect(Array.from(c.body.pos)).not.toEqual(Array.from(a.body.pos));
  }, 120000);

  it('real-asset controls: floor contact, a known 100 mm sink, a body walked into a real fridge', async () => {
    const lr = await rigFor({ body: 'classic', height: 0.5 });
    poseRig(lr, { anim: 'idle' }, { x: 0, y: 0, z: 0, facing: 0 }, 1);
    const feet = lowestY(makeSolid(sampleRig(lr).body), (l) => /^foot_/.test(l));
    expect(Math.abs(feet.y)).toBeLessThan(0.015);
    poseRig(lr, { anim: 'idle' }, { x: 0, y: -0.1, z: 0, facing: 0 }, 1);
    const sunk = lowestY(makeSolid(sampleRig(lr).body), (l) => /^foot_/.test(l));
    expect(sunk.y).toBeCloseTo(feet.y - 0.1, 6);
    // a zombie idling at the fridge's front slot vs the same zombie walked 0.45 m into the fridge body
    const fridge = await placeFloorObject('fridge_humming', 5, 5, 0, false, false);
    const p0 = slotPose(fridge.spec, fridge.frame, 0);
    poseRig(lr, { anim: 'idle' }, p0, 1);
    const shipped = penetration(makeSolid(sampleRig(lr).body), fridge.solid);
    const into = { ...p0, x: p0.x + Math.sin(p0.facing) * 0.45, z: p0.z + Math.cos(p0.facing) * 0.45 };
    poseRig(lr, { anim: 'idle' }, into, 1);
    const inside = penetration(makeSolid(sampleRig(lr).body), fridge.solid);
    expect(shipped.maxDepthMm).toBeLessThan(15);
    expect(inside.maxDepthMm).toBeGreaterThan(100);
    expect(inside.worstPart).toMatch(/pelvis|spine|chest|thigh|head|neck/);
  }, 120000);
});
