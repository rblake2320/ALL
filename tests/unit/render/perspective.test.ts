/**
 * W-136 perspectives (docs/DESIGN_OPEN_WORLD.md §4.1, OW-1 / OW-2 / OW-4): the pure view maths and the camera rig.
 * The overview path must stay the identity; a close view must never write the orbit state; every input may be garbage.
 */
import { describe, expect, it } from 'vitest';
import { computeSpatial } from '../../../src/game/spatialAudio';
import { createRenderer } from '../../../src/render/index';
import { CameraRig } from '../../../src/render/camera/cameraRig';
import { CAMERA_LIMITS } from '../../../src/render/camera/cameraMath';
import {
  PERSPECTIVES,
  PERSPECTIVE_LIMITS as L,
  behindYaw,
  clampShoulderDistance,
  clampViewPitch,
  clearDistance,
  emptyViewPose,
  firstPersonPose,
  isPerspective,
  mixViewPose,
  nextPerspective,
  shoulderPivot,
  shoulderPose,
  smooth01,
  validSubject,
  zoomShoulderDistance,
  type PerspectiveSubject,
} from '../../../src/render/camera/perspective';

const S: PerspectiveSubject = { x: 10, y: 0, z: 12, facing: 0 };
const GARBAGE: unknown[] = [NaN, Infinity, -Infinity, undefined, null, 'x', {}, [], 1e308, -1e308];
const noWall = () => false;
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const snap = (rig: CameraRig) => ({ p: rig.camera.position.toArray(), q: rig.camera.quaternion.toArray(), fov: rig.camera.fov, near: rig.camera.near });

describe('perspective vocabulary', () => {
  it('cycles overview → shoulder → firstPerson → overview and restarts from garbage', () => {
    expect([...PERSPECTIVES]).toEqual(['overview', 'shoulder', 'firstPerson']);
    expect(nextPerspective('overview')).toBe('shoulder');
    expect(nextPerspective('shoulder')).toBe('firstPerson');
    expect(nextPerspective('firstPerson')).toBe('overview');
    for (const g of [...GARBAGE, 'Overview', 'first-person', '']) {
      expect(isPerspective(g)).toBe(false);
      expect(nextPerspective(g)).toBe('overview');
    }
  });

  it('validSubject refuses anything without four finite numbers', () => {
    expect(validSubject(S)).toBe(true);
    for (const k of ['x', 'y', 'z', 'facing'] as const) for (const g of GARBAGE) expect(validSubject({ ...S, [k]: g as number })).toBe(false);
    expect(validSubject(null)).toBe(false);
    expect(validSubject(undefined)).toBe(false);
    expect(validSubject({})).toBe(false);
  });
});

describe('view poses', () => {
  it('behindYaw puts the camera behind the zombie: the view direction equals the facing direction', () => {
    for (const f of [0, 0.3, Math.PI / 2, Math.PI, -2.5, 7]) {
      const y = behindYaw(f);
      // view direction for a yaw is (-sin, -cos); facing direction is (sin f, cos f)
      expect(-Math.sin(y)).toBeCloseTo(Math.sin(f), 9);
      expect(-Math.cos(y)).toBeCloseTo(Math.cos(f), 9);
      expect(y).toBeGreaterThanOrEqual(-Math.PI);
      expect(y).toBeLessThan(Math.PI);
    }
    for (const g of GARBAGE) expect(Number.isFinite(behindYaw(g))).toBe(true);
  });

  it('first person: at eye height, just in front of the body, looking along the yaw; positive pitch looks down', () => {
    const o = emptyViewPose();
    firstPersonPose(S, behindYaw(0), 0, o); // zombie faces +Z
    expect(o.y).toBeCloseTo(L.firstPerson.eyeY, 9);
    expect(o.x).toBeCloseTo(S.x, 9);
    expect(o.z).toBeCloseTo(S.z + L.firstPerson.forward, 9);
    expect(o.lz).toBeGreaterThan(o.z);
    expect(o.ly).toBeCloseTo(o.y, 9);
    expect(o.fovDeg).toBe(L.firstPerson.fovDeg);
    firstPersonPose(S, behindYaw(0), 0.5, o);
    expect(o.ly).toBeLessThan(o.y);
    firstPersonPose(S, behindYaw(0), -0.5, o);
    expect(o.ly).toBeGreaterThan(o.y);
    // facing +X
    firstPersonPose(S, behindYaw(Math.PI / 2), 0, o);
    expect(o.lx).toBeGreaterThan(o.x);
    expect(o.lz).toBeCloseTo(o.z, 9);
  });

  it('first person: the eye is under the top of the head and pitch is clamped (never looks through its own spine)', () => {
    expect(L.firstPerson.eyeY).toBeLessThan(1.78);
    expect(L.firstPerson.eyeY).toBeGreaterThan(1.2);
    const o = emptyViewPose();
    for (const p of [9, -9, 1e9]) {
      firstPersonPose(S, 0, p, o);
      const pitch = Math.asin(o.y - o.ly);
      expect(Math.abs(pitch)).toBeLessThanOrEqual(L.firstPerson.pitchMax + 1e-9);
    }
  });

  it('shoulder: behind and above, the stated distance from the pivot, looking at the pivot beside the zombie', () => {
    const o = emptyViewPose();
    const yaw = behindYaw(0); // camera on the -Z side of a zombie facing +Z
    shoulderPose(S, yaw, L.shoulder.pitchDefault, L.shoulder.distance, o);
    const piv = shoulderPivot(S, yaw, { x: 0, y: 0, z: 0 });
    expect(o.z).toBeLessThan(S.z);
    expect(o.y).toBeGreaterThan(piv.y);
    expect(dist(o, piv)).toBeCloseTo(L.shoulder.distance, 9);
    expect([o.lx, o.ly, o.lz]).toEqual([piv.x, piv.y, piv.z]);
    expect(Math.hypot(piv.x - S.x, piv.z - S.z)).toBeCloseTo(L.shoulder.side, 9);
    expect(piv.y).toBeCloseTo(L.shoulder.pivotY, 9);
    expect(o.fovDeg).toBe(L.shoulder.fovDeg);
  });

  it('shoulder: the camera never sinks under the floor and the distance is bounded', () => {
    const o = emptyViewPose();
    for (const p of [L.shoulder.pitchMin, -5, 0]) {
      shoulderPose({ ...S, y: 0 }, 1, p, L.shoulder.distanceMax, o);
      expect(o.y).toBeGreaterThanOrEqual(L.floorY);
    }
    shoulderPose(S, 1, 0.3, 1e9, o);
    expect(dist(o, shoulderPivot(S, 1, { x: 0, y: 0, z: 0 }))).toBeLessThanOrEqual(L.shoulder.distanceMax + 1e-9);
  });

  it('every pose stays finite for garbage yaw / pitch / distance (36 000 combinations)', () => {
    const o = emptyViewPose();
    let n = 0;
    for (const y of GARBAGE)
      for (const p of GARBAGE)
        for (const d of GARBAGE) {
          for (let i = 0; i < 18; i++) {
            const s = { x: i * 3.7 - 20, y: (i % 3) * 0.2, z: 40 - i * 5.1, facing: i };
            shoulderPose(s, y as number, p as number, d as number, o);
            expect(Object.values(o).every(Number.isFinite)).toBe(true);
            firstPersonPose(s, y as number, p as number, o);
            expect(Object.values(o).every(Number.isFinite)).toBe(true);
            n += 2;
          }
        }
    expect(n).toBe(36000);
  });

  it('clamps: pitch per mode, shoulder distance, zoom steps', () => {
    expect(clampViewPitch('shoulder', 99)).toBe(L.shoulder.pitchMax);
    expect(clampViewPitch('shoulder', -99)).toBe(L.shoulder.pitchMin);
    expect(clampViewPitch('firstPerson', 99)).toBe(L.firstPerson.pitchMax);
    expect(clampViewPitch('firstPerson', -99)).toBe(L.firstPerson.pitchMin);
    for (const g of GARBAGE.slice(0, 8)) {
      expect(clampViewPitch('shoulder', g)).toBe(L.shoulder.pitchDefault);
      expect(clampViewPitch('firstPerson', g)).toBe(L.firstPerson.pitchDefault);
      expect(clampShoulderDistance(g)).toBe(L.shoulder.distance);
    }
    expect(zoomShoulderDistance(L.shoulder.distance, 1)).toBeLessThan(L.shoulder.distance);
    expect(zoomShoulderDistance(L.shoulder.distance, -1)).toBeGreaterThan(L.shoulder.distance);
    expect(zoomShoulderDistance(L.shoulder.distance, 1000)).toBe(L.shoulder.distanceMin);
    expect(zoomShoulderDistance(L.shoulder.distance, -1000)).toBe(L.shoulder.distanceMax);
    expect(zoomShoulderDistance(L.shoulder.distance, NaN)).toBe(L.shoulder.distance);
  });

  it('mixViewPose: 0 → a, 1 → b, monotone between, NaN lands on b', () => {
    const a = { x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: -1, fovDeg: 32 };
    const b = { x: 10, y: 4, z: -6, lx: 8, ly: 1, lz: 2, fovDeg: 68 };
    const o = emptyViewPose();
    expect(mixViewPose(a, b, 0, o)).toEqual(a);
    expect(mixViewPose(a, b, 1, o)).toEqual(b);
    expect(mixViewPose(a, b, 7, o)).toEqual(b);
    expect(mixViewPose(a, b, -7, o)).toEqual(a);
    expect(mixViewPose(a, b, NaN, o)).toEqual(b);
    let last = -1;
    for (let k = 0; k <= 1.0001; k += 0.05) {
      const s = smooth01(k);
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
  });
});

describe('clearDistance (the shoulder camera stops in front of a drawn wall)', () => {
  const wallsAt = (keys: string[]) => {
    const set = new Set(keys);
    return (kind: 'h' | 'v', x: number, z: number) => set.has(`${kind}:${x}:${z}`);
  };

  it('nothing in the way: the full distance', () => {
    expect(clearDistance(5.5, 5.5, 1, 0, 3.2, noWall)).toBe(3.2);
    expect(clearDistance(5.5, 5.5, -0.3, 0.8, 6, noWall)).toBe(6);
  });

  it('a wall on each of the four sides is found at the right distance, minus the clearance', () => {
    const c = L.wallClearance;
    // tile (5,5) spans [5,6]x[5,6]; the camera pivot stands at its centre
    expect(clearDistance(5.5, 5.5, 1, 0, 4, wallsAt(['v:7:5']))).toBeCloseTo(1.5 - c, 9);
    expect(clearDistance(5.5, 5.5, -1, 0, 4, wallsAt(['v:4:5']))).toBeCloseTo(1.5 - c, 9);
    expect(clearDistance(5.5, 5.5, 0, 1, 4, wallsAt(['h:5:8']))).toBeCloseTo(2.5 - c, 9);
    expect(clearDistance(5.5, 5.5, 0, -1, 4, wallsAt(['h:5:5']))).toBeCloseTo(0.5 - c, 9);
  });

  it('only the wall segment actually crossed counts (the neighbour row is not a hit)', () => {
    expect(clearDistance(5.5, 5.5, 1, 0, 4, wallsAt(['v:7:4', 'v:7:6']))).toBe(4);
    // direction (2, 1): reaches X = 7 at z = 6.25, i.e. in row 6, after 1.5 * sqrt(5) / 2
    const d = clearDistance(5.5, 5.5, 2, 1, 4, wallsAt(['v:7:6']));
    expect(d).toBeCloseTo((1.5 * Math.sqrt(5)) / 2 - L.wallClearance, 9);
    expect(clearDistance(5.5, 5.5, 2, 1, 4, wallsAt(['v:7:5']))).toBe(4);
  });

  it('the nearest of several walls wins; a wall beyond the distance is ignored', () => {
    expect(clearDistance(5.5, 5.5, 1, 0, 6, wallsAt(['v:9:5', 'v:7:5', 'v:8:5']))).toBeCloseTo(1.5 - L.wallClearance, 9);
    expect(clearDistance(5.5, 5.5, 1, 0, 2, wallsAt(['v:9:5']))).toBe(2);
  });

  it('never negative, never past the distance: a wall right behind the pivot gives 0', () => {
    expect(clearDistance(5.95, 5.5, 1, 0, 4, wallsAt(['v:6:5']))).toBe(0);
  });

  it('agrees with a brute-force march on 2 000 random rays in a random wall field', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const keys: string[] = [];
    for (let i = 0; i < 160; i++) keys.push(`${rnd() < 0.5 ? 'h' : 'v'}:${Math.floor(rnd() * 20)}:${Math.floor(rnd() * 20)}`);
    const has = wallsAt(keys);
    const set = new Set(keys);
    let hits = 0;
    for (let i = 0; i < 2000; i++) {
      const ox = 1 + rnd() * 18;
      const oz = 1 + rnd() * 18;
      const a = rnd() * Math.PI * 2;
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      const max = 0.5 + rnd() * 6;
      const got = clearDistance(ox, oz, dx, dz, max, has, 0);
      // brute force: step 0.5 mm, a wall is crossed when the tile changes across an edge that carries one
      let want = max;
      let px = ox;
      let pz = oz;
      for (let t = 0.0005; t <= max; t += 0.0005) {
        const x = ox + dx * t;
        const z = oz + dz * t;
        const fx0 = Math.floor(px);
        const fz0 = Math.floor(pz);
        const fx1 = Math.floor(x);
        const fz1 = Math.floor(z);
        let hit = false;
        if (fx1 !== fx0 && set.has(`v:${Math.max(fx0, fx1)}:${fz0}`)) hit = true;
        if (fz1 !== fz0 && set.has(`h:${fx0}:${Math.max(fz0, fz1)}`)) hit = true;
        if (hit) {
          want = t;
          break;
        }
        px = x;
        pz = z;
      }
      if (want < max) hits++;
      // corner-grazing rays may resolve a crossing one segment apart: allow 2 % of the rays a different answer
      if (Math.abs(got - want) > 0.002) hits += 10000;
    }
    const disagreements = Math.floor(hits / 10000);
    expect(disagreements).toBeLessThanOrEqual(40);
    expect(hits % 10000).toBeGreaterThan(300); // the field really does block a good share of the rays
  });

  it('garbage in: 0 or the full distance, never NaN, and a throwing probe is treated as no wall', () => {
    for (const g of GARBAGE) {
      const r = [
        clearDistance(g as number, 5, 1, 0, 3, noWall),
        clearDistance(5, g as number, 1, 0, 3, noWall),
        clearDistance(5, 5, g as number, g as number, 3, noWall),
        clearDistance(5, 5, 1, 0, g as number, noWall),
        clearDistance(5.5, 5.5, 1, 0, 3, noWall, g as number),
      ];
      for (const v of r) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(64);
      }
    }
    expect(clearDistance(5.5, 5.5, 0, 0, 3, noWall)).toBe(3);
    expect(
      clearDistance(5.5, 5.5, 1, 0, 3, () => {
        throw new Error('boom');
      }),
    ).toBe(3);
    expect(clearDistance(5.5, 5.5, 1, 0, 1e9, noWall)).toBe(64);
  });
});

describe('CameraRig perspectives', () => {
  const settle = (rig: CameraRig, subject: PerspectiveSubject | null = S, sec = 3) => {
    for (let i = 0; i < sec * 60; i++) rig.update(1 / 60, null, subject);
  };

  it('OW-1: a rig that never leaves the overview is unchanged by the new code paths', () => {
    const a = new CameraRig();
    const b = new CameraRig();
    a.setBounds({ width: 24, depth: 30 }, true);
    b.setBounds({ width: 24, depth: 30 }, true);
    // b also receives a subject every frame and a no-op perspective request: neither may show
    b.setPerspective('overview', S);
    for (let i = 0; i < 200; i++) {
      for (const r of [a, b]) {
        if (i % 7 === 0) r.orbit(0.1, -0.02);
        if (i % 11 === 0) r.zoom(1, { x: 3, z: 4 });
        if (i % 13 === 0) r.pan(12, -7, 720);
        if (i % 17 === 0) r.panWorld(0.4, -0.2);
        if (i % 19 === 0) r.rotate(1);
      }
      a.update(1 / 60, null);
      b.update(1 / 60, null, S);
      expect(snap(b)).toEqual(snap(a));
    }
    expect(b.camera.fov).toBe(CAMERA_LIMITS.fovDeg);
    expect(b.getPerspective()).toBe('overview');
    expect(b.closeness()).toBe(0);
    expect(b.insideSubject()).toBe(false);
  });

  it('OW-2: overview → shoulder → firstPerson → overview restores the exact camera and orbit state', () => {
    const rig = new CameraRig();
    rig.setBounds({ width: 24, depth: 30 }, true);
    rig.orbit(0.4, 0.1);
    rig.zoom(2, null);
    settle(rig, null);
    const state0 = rig.getState();
    const cam0 = snap(rig);
    expect(rig.setPerspective('shoulder', S)).toBe('shoulder');
    settle(rig);
    rig.orbit(0.7, 0.2);
    rig.pan(40, 10, 720);
    rig.zoom(3, { x: 1, z: 1 });
    rig.panWorld(5, 5);
    rig.rotate(2);
    settle(rig);
    expect(rig.setPerspective('firstPerson', S)).toBe('firstPerson');
    settle(rig);
    rig.orbit(-1.2, 0.5);
    rig.pan(-90, 30, 720);
    rig.zoom(-4, null);
    settle(rig);
    expect(rig.getState()).toEqual(state0); // the orbit goal was never written
    expect(rig.setPerspective('overview', null)).toBe('overview');
    settle(rig, null);
    expect(rig.getState()).toEqual(state0);
    const cam1 = snap(rig);
    for (let i = 0; i < 3; i++) expect(cam1.p[i]).toBeCloseTo(cam0.p[i], 9);
    for (let i = 0; i < 4; i++) expect(cam1.q[i]).toBeCloseTo(cam0.q[i], 9);
    expect(cam1.fov).toBe(cam0.fov);
    expect(Math.abs(cam1.near - cam0.near)).toBeLessThanOrEqual(1e-3); // the rig's own near-plane hysteresis
  });

  it('shoulder: the camera sits its distance behind the pivot and keeps the bearing the player had', () => {
    const rig = new CameraRig();
    rig.setBounds({ width: 24, depth: 30 }, true);
    settle(rig, null);
    const yaw0 = rig.getState().yaw;
    rig.setPerspective('shoulder', S);
    settle(rig);
    expect(rig.viewYaw()).toBeCloseTo(yaw0, 9);
    const piv = shoulderPivot(S, rig.viewYaw(), { x: 0, y: 0, z: 0 });
    expect(dist(rig.camera.position, piv)).toBeCloseTo(L.shoulder.distance, 6);
    expect(rig.camera.fov).toBeCloseTo(L.shoulder.fovDeg, 6);
    expect(rig.closeness()).toBe(1);
    expect(rig.insideSubject()).toBe(false);
  });

  it('OW-3: the close views stay attached while the zombie walks (600 frames, both views)', () => {
    for (const mode of ['shoulder', 'firstPerson'] as const) {
      const rig = new CameraRig();
      rig.setPerspective(mode, S, true);
      const s = { ...S };
      for (let i = 0; i < 600; i++) {
        s.x += 0.03;
        s.z += Math.sin(i / 40) * 0.02;
        s.facing = Math.atan2(0.03, Math.sin(i / 40) * 0.02);
        if (i % 50 === 0) rig.orbit(0.3, 0.05);
        rig.update(1 / 60, null, s);
        const p = rig.camera.position;
        if (mode === 'firstPerson') {
          expect(Math.hypot(p.x - s.x, p.z - s.z)).toBeCloseTo(L.firstPerson.forward, 6);
          expect(p.y).toBeCloseTo(s.y + L.firstPerson.eyeY, 6);
        } else {
          const piv = shoulderPivot(s, rig.viewYaw(), { x: 0, y: 0, z: 0 });
          expect(dist(p, piv)).toBeLessThanOrEqual(L.shoulder.distanceMax + 1e-6);
          expect(dist(p, piv)).toBeGreaterThan(L.shoulder.distanceMin - 1e-6);
        }
      }
    }
  });

  it('first person from above starts looking where the zombie faces; from the shoulder it keeps the bearing', () => {
    const rig = new CameraRig();
    rig.setPerspective('firstPerson', { ...S, facing: 1.1 }, true);
    expect(rig.viewYaw()).toBeCloseTo(behindYaw(1.1), 9);
    expect(rig.insideSubject()).toBe(true);
    const rig2 = new CameraRig();
    rig2.setPerspective('shoulder', S, true);
    rig2.orbit(0.9, 0);
    settle(rig2);
    const yaw = rig2.viewYaw();
    rig2.setPerspective('firstPerson', { ...S, facing: 2.5 }, true);
    expect(rig2.viewYaw()).toBeCloseTo(yaw, 6);
  });

  it('drags look around: a drag to the right turns the view right in both close views; first person tips with the pointer', () => {
    for (const mode of ['shoulder', 'firstPerson'] as const) {
      const rig = new CameraRig();
      rig.setPerspective(mode, S, true);
      const y0 = rig.viewYaw();
      rig.orbit(-0.3, 0); // what the controller sends for a drag to the right
      settle(rig, S, 1);
      expect(rig.viewYaw()).toBeCloseTo(y0 - 0.3, 6);
      const y1 = rig.viewYaw();
      rig.pan(50, 0, 720); // a pan drag to the right is the same look
      settle(rig, S, 1);
      expect(rig.viewYaw()).toBeLessThan(y1);
    }
    const fp = new CameraRig();
    fp.setPerspective('firstPerson', S, true);
    fp.orbit(0, -0.4); // drag down
    settle(fp, S, 1);
    const pose = fp.appliedPose();
    expect(pose.ly).toBeLessThan(pose.y); // looks down
  });

  it('the shoulder camera is pulled in front of a wall and released when the probe is cleared', () => {
    const rig = new CameraRig();
    rig.setPerspective('shoulder', { x: 5.5, y: 0, z: 5.5, facing: Math.PI }, true);
    // bearing: camera on the +Z side
    rig.orbit(-rig.viewYaw(), 0);
    settle(rig, { x: 5.5, y: 0, z: 5.5, facing: Math.PI });
    const free = rig.camera.position.z;
    rig.wallProbe = (kind, _x, z) => kind === 'h' && z === 7;
    settle(rig, { x: 5.5, y: 0, z: 5.5, facing: Math.PI }, 1);
    expect(rig.camera.position.z).toBeLessThan(7 - L.wallClearance + 1e-6);
    expect(rig.camera.position.z).toBeLessThan(free);
    rig.wallProbe = null;
    settle(rig, { x: 5.5, y: 0, z: 5.5, facing: Math.PI }, 1);
    expect(rig.camera.position.z).toBeCloseTo(free, 6);
  });

  it('glide: the change takes glideSec, is continuous, and cuts under Reduce motion', () => {
    const rig = new CameraRig();
    rig.setBounds({ width: 24, depth: 30 }, true);
    settle(rig, null);
    const before = rig.camera.position.clone();
    rig.setPerspective('shoulder', S);
    expect(rig.camera.position.distanceTo(before)).toBeLessThan(1e-9); // the first frame is where the camera was
    let prev = rig.camera.position.clone();
    let maxStep = 0;
    const frames = Math.ceil(L.glideSec * 60) + 2;
    for (let i = 0; i < frames; i++) {
      rig.update(1 / 60, null, S);
      maxStep = Math.max(maxStep, rig.camera.position.distanceTo(prev));
      prev = rig.camera.position.clone();
    }
    expect(rig.closeness()).toBe(1);
    expect(maxStep).toBeLessThan(before.distanceTo(prev) * 0.2); // no jump: no frame covers a fifth of the way
    const cut = new CameraRig();
    cut.reduceMotion = true;
    cut.setPerspective('shoulder', S);
    expect(cut.closeness()).toBe(1);
    cut.setPerspective('overview', null);
    expect(cut.closeness()).toBe(0);
  });

  it('OW-4: garbage never leaves the rig in a close view or with a broken camera', () => {
    const rig = new CameraRig();
    for (const g of [...GARBAGE, 'sideways', 'OVERVIEW']) {
      expect(rig.setPerspective(g, S)).toBe('overview');
    }
    for (const mode of ['shoulder', 'firstPerson'] as const) {
      for (const g of GARBAGE) {
        expect(rig.setPerspective(mode, g as never)).toBe('overview');
        expect(rig.setPerspective(mode, { ...S, x: g as number })).toBe('overview');
        expect(rig.setPerspective(mode, { ...S, facing: g as number })).toBe('overview');
      }
    }
    rig.setPerspective('firstPerson', S, true);
    for (const g of GARBAGE) {
      rig.orbit(g as number, g as number);
      rig.pan(g as number, g as number, g as number);
      rig.zoom(g as number, null);
      rig.rotate(g as number);
      rig.update(g as number, null, { ...S, z: g as number });
      rig.update(1 / 60, null, g as never);
    }
    expect(rig.getPerspective()).toBe('firstPerson');
    expect(rig.camera.position.toArray().every(Number.isFinite)).toBe(true);
    expect(rig.camera.quaternion.toArray().every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(rig.camera.fov)).toBe(true);
    // a subject that goes missing holds the last pose (the renderer then hands the view back)
    settle(rig);
    const held = snap(rig);
    for (let i = 0; i < 30; i++) rig.update(1 / 60, null, null);
    expect(snap(rig)).toEqual(held);
  });

  it('sound follows the view: in first person the real renderer is heard from the zombie, not from the overview left behind', () => {
    // never initialised (no GPU): only its camera, projection and listening point are used
    const r = createRenderer({ models: {}, characters: {} } as never);
    const vp = { width: 1280, height: 720 };
    r.setCamera({ target: { x: 5, z: 5 }, yaw: 0, pitch: 0.7, distance: 40 }, true); // zoomed out over the yard
    const orbit = r.getCamera();
    const zombie: PerspectiveSubject = { x: 17, y: 0, z: 5, facing: Math.PI / 2 }; // 12 tiles away, facing +X
    const stove = { x: 20, y: 0.6, z: 5 }; // three tiles in front of it
    const own = { x: zombie.x, y: 1.2, z: zombie.z }; // where the game puts a zombie's own sounds (eventWorldPos)
    const before = computeSpatial(stove, r, vp)!.gain;
    expect(before).toBeLessThan(0.5); // far from the overview target and zoomed out
    const rig = (r as unknown as { cam: CameraRig }).cam;
    expect(rig.setPerspective('firstPerson', zombie, true)).toBe('firstPerson');
    expect(r.worldToScreen(stove.x, stove.y, stove.z).visible).toBe(true);
    expect(r.worldToScreen(own.x, own.y, own.z).visible).toBe(false); // the body is behind the eye camera
    const heard = [stove, own].map((p) => Number(computeSpatial(p, r, vp)!.gain.toFixed(6)));
    expect(heard).toEqual([1, 1]);
    expect(r.getCamera()).toEqual(orbit); // the overview state is still never written
    rig.setPerspective('overview', null, true);
    expect(computeSpatial(stove, r, vp)!.gain).toBe(before); // and the overview sounds as it did
    r.dispose();
  });

  it('the framing probe always measures the overview, whatever the perspective', () => {
    const rig = new CameraRig();
    rig.setBounds({ width: 24, depth: 30 }, true);
    settle(rig, null);
    const want = rig.probe(7, 9, () => snap(rig));
    rig.setPerspective('firstPerson', S, true);
    const during = snap(rig);
    expect(rig.probe(7, 9, () => snap(rig))).toEqual(want);
    expect(snap(rig)).toEqual(during); // and puts the close view back
  });
});
