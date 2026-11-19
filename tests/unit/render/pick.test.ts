import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { resolvePick, inWallTolerance, AGENT_PICK_BIAS, WALL_OBJECT_TOLERANCE, type PickSources } from '../../../src/render/picking/scenePick';
import { DIM } from '../../../src/shared/dimensions';
import { coverCrop } from '../../../src/render/core/snapshot';

const ray = () => new THREE.Ray(new THREE.Vector3(5, 10, 5), new THREE.Vector3(0, -1, 0));
const P = () => new THREE.Vector3();
const base = (over: Partial<PickSources> = {}): PickSources => ({ agents: null, objects: null, walls: null, lot: { width: 30, depth: 30 }, ...over });

describe('scene pick policy', () => {
  it('falls through to the ground tile under the ray', () => {
    const r = resolvePick(ray(), base());
    expect(r).toMatchObject({ kind: 'tile', x: 5, z: 5 });
  });

  it('no tile outside the lot or when tiles are disabled', () => {
    const off = new THREE.Ray(new THREE.Vector3(-3, 10, 5), new THREE.Vector3(0, -1, 0));
    expect(resolvePick(off, base()).kind).toBe('none');
    expect(resolvePick(ray(), base({ lot: null })).kind).toBe('none');
    const up = new THREE.Ray(new THREE.Vector3(5, 10, 5), new THREE.Vector3(0, 1, 0));
    expect(resolvePick(up, base()).kind).toBe('none');
  });

  it('agents win near-ties with furniture but not clear losses', () => {
    const agents = () => ({ agentId: 'a1', t: 9.2, point: P() });
    expect(resolvePick(ray(), base({ agents, objects: () => ({ objectId: 'o1', t: 9.0, point: P() }) })).kind).toBe('agent');
    expect(resolvePick(ray(), base({ agents, objects: () => ({ objectId: 'o1', t: 9.2 - AGENT_PICK_BIAS - 0.1, point: P() }) })).kind).toBe('object');
  });

  // a camera-like ray looking toward -Z at a 'h' wall (cos to the wall normal = 0.8)
  const wallRay = () => new THREE.Ray(new THREE.Vector3(5, 6, 14), new THREE.Vector3(0, -0.6, -0.8));
  const tolH = inWallTolerance('h:5:5', { x: 0, z: -0.8 });

  it('walls occlude agents and objects behind them', () => {
    const walls = () => ({ edge: 'h:5:5', side: 1 as const, t: 8 });
    const r = resolvePick(wallRay(), base({ walls, agents: () => ({ agentId: 'a1', t: 8.1, point: P() }), objects: () => ({ objectId: 'o1', t: 8 + tolH + 0.05, point: P() }) }));
    expect(r).toMatchObject({ kind: 'wall', edge: 'h:5:5', side: 1 });
    // an object in front of the wall wins
    const r2 = resolvePick(wallRay(), base({ walls, objects: () => ({ objectId: 'o1', t: 7.5, point: P() }) }));
    expect(r2.kind).toBe('object');
  });

  it('walls occlude even when the caller does not want wall results (no clicking through walls)', () => {
    const walls = () => ({ edge: 'h:5:5', side: 1 as const, t: 8 });
    // floor behind the wall: 'none', not the hidden tile
    expect(resolvePick(wallRay(), base({ walls, wallResults: false })).kind).toBe('none');
    // an agent / object hidden behind the wall face stays hidden
    expect(resolvePick(wallRay(), base({ walls, wallResults: false, agents: () => ({ agentId: 'a1', t: 8.6, point: P() }) })).kind).toBe('none');
    expect(resolvePick(wallRay(), base({ walls, wallResults: false, objects: () => ({ objectId: 'o1', t: 8 + tolH + 0.3, point: P() }) })).kind).toBe('none');
    // in front of the wall (or set into it) still wins
    expect(resolvePick(wallRay(), base({ walls, wallResults: false, agents: () => ({ agentId: 'a1', t: 7.5, point: P() }) }))).toMatchObject({ kind: 'agent', agentId: 'a1' });
    expect(resolvePick(wallRay(), base({ walls, wallResults: false, objects: () => ({ objectId: 'door', t: 8 + tolH * 0.5, point: P() }) }))).toMatchObject({ kind: 'object', objectId: 'door' });
    // no wall on the ray → the tile as usual
    expect(resolvePick(ray(), base({ walls: () => null, wallResults: false })).kind).toBe('tile');
  });

  it('doors / windows / wall items set into the wall box beat the wall itself', () => {
    const walls = () => ({ edge: 'h:5:5', side: 1 as const, t: 8 });
    // door leaf on the wall centre plane: (thickness/2 + margin) / cos behind the box face
    const leaf = (DIM.WALL_THICKNESS / 2 + 0.02) / 0.8;
    const r = resolvePick(wallRay(), base({ walls, objects: () => ({ objectId: 'door', t: 8 + leaf, point: P() }) }));
    expect(r).toMatchObject({ kind: 'object', objectId: 'door' });
    // but an agent behind the wall face stays hidden
    const r2 = resolvePick(wallRay(), base({ walls, agents: () => ({ agentId: 'a1', t: 8.05, point: P() }) }));
    expect(r2.kind).toBe('wall');
  });

  it('the in-wall tolerance reaches the wall centre plane but never the far face, at any obliquity', () => {
    const boxDepth = DIM.WALL_THICKNESS + 0.04;
    for (const edge of ['h:3:4', 'v:3:4']) {
      for (let a = 0; a <= 90; a += 5) {
        const c = Math.cos((a * Math.PI) / 180);
        const s = Math.sin((a * Math.PI) / 180);
        const dir = edge[0] === 'h' ? { x: s, z: c } : { x: c, z: s };
        const tol = inWallTolerance(edge, dir);
        expect(Number.isFinite(tol)).toBe(true);
        // far face distance along the ray
        if (c > 1e-6) expect(tol).toBeLessThan(boxDepth / c);
        // the centre plane is reachable whenever the ray is not grazing
        if (c >= 0.35) expect(tol).toBeGreaterThanOrEqual((boxDepth / 2) / c - 1e-9);
      }
    }
    expect(inWallTolerance(null, { x: NaN, z: NaN })).toBeCloseTo(WALL_OBJECT_TOLERANCE);
  });

  it('the object query is bounded by the wall distance (plus the in-wall tolerance)', () => {
    let seenMax = -1;
    resolvePick(wallRay(), base({ walls: () => ({ edge: 'h:1:1', side: 0 as const, t: 4 }), objects: (_r, maxT) => ((seenMax = maxT), null) }));
    expect(seenMax).toBeCloseTo(4 + tolH);
    resolvePick(ray(), base({ objects: (_r, maxT) => ((seenMax = maxT), null) }));
    expect(seenMax).toBe(Infinity);
  });

  it('adversarial: NaN / Infinity hit distances are ignored', () => {
    const r = resolvePick(ray(), base({ agents: () => ({ agentId: 'a1', t: NaN, point: P() }), objects: () => ({ objectId: 'o', t: Infinity, point: P() }), walls: () => ({ edge: 'h:1:1', side: 0 as const, t: NaN }) }));
    expect(r.kind).toBe('tile');
    const g = resolvePick(ray(), base({ lot: { width: NaN, depth: NaN } }));
    expect(g.kind).toBe('none');
  });
});

describe('snapshot cover-crop', () => {
  it('crops wide sources horizontally and tall sources vertically, centred', () => {
    expect(coverCrop(1600, 900, 320, 320)).toEqual({ x: 350, y: 0, w: 900, h: 900 });
    const t = coverCrop(900, 1600, 320, 180);
    expect(t.w).toBe(900);
    expect(t.h).toBeCloseTo(506.25);
    expect(t.y).toBeCloseTo((1600 - 506.25) / 2);
  });

  it('garbage sizes never produce NaN or negative rects', () => {
    for (const args of [
      [0, 0, 0, 0],
      [NaN, 100, 320, 180],
      [100, 100, Infinity, 1],
      [-5, -5, -1, -1],
    ] as [number, number, number, number][]) {
      const r = coverCrop(...args);
      for (const v of [r.x, r.y, r.w, r.h]) expect(Number.isFinite(v)).toBe(true);
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
    }
  });
});

import { fxAnchor, type FxAnchorSources } from '../../../src/render/fx/fxEvents';

describe('fx event anchoring', () => {
  const src = (o: Partial<FxAnchorSources> = {}): FxAnchorSources => ({ agentPos: () => null, agentSimPos: () => null, objectBounds: () => null, ...o });
  const out = () => ({ x: 0, y: 0, z: 0 });

  it('explicit positions win (with optional y)', () => {
    const o = out();
    expect(fxAnchor({ type: 'fx', kind: 'puff', pos: { x: 2, z: 3 }, y: 0.9, agentId: 'a1' }, src(), o)).toBe(true);
    expect(o).toEqual({ x: 2, y: 0.9, z: 3 });
  });

  it('agents use the rendered feet, else the sim position', () => {
    const o = out();
    expect(fxAnchor({ type: 'fx', kind: 'hearts', agentId: 'a1' }, src({ agentPos: () => ({ x: 1, y: 0.4, z: 2 }) }), o)).toBe(true);
    expect(o).toEqual({ x: 1, y: 0.4, z: 2 });
    expect(fxAnchor({ type: 'fx', kind: 'hearts', agentId: 'a1' }, src({ agentSimPos: () => ({ x: 7, y: 0, z: 8 }) }), o)).toBe(true);
    expect(o.x).toBe(7);
  });

  it('objects anchor a little below the middle of their bounds', () => {
    const o = out();
    expect(fxAnchor({ type: 'fx', kind: 'splash', objectId: 'o1' }, src({ objectBounds: () => ({ min: { x: 1, y: 0, z: 1 }, max: { x: 3, y: 1.6, z: 2 } }) }), o)).toBe(true);
    expect(o).toEqual({ x: 2, y: 0.5, z: 1.5 });
  });

  it('adversarial: unknown ids, NaN positions and garbage events are rejected', () => {
    const o = out();
    expect(fxAnchor({ type: 'fx', kind: 'puff', agentId: 'ghost' }, src(), o)).toBe(false);
    expect(fxAnchor({ type: 'fx', kind: 'puff', objectId: 'nope' }, src(), o)).toBe(false);
    expect(fxAnchor({ type: 'fx', kind: 'puff', pos: { x: NaN, z: 1 } }, src(), o)).toBe(false);
    expect(fxAnchor({ type: 'fx', kind: 'puff' }, src(), o)).toBe(false);
    expect(fxAnchor(null as never, src(), o)).toBe(false);
    expect(fxAnchor({ type: 'fx', kind: 'puff', agentId: 'a' }, src({ agentPos: () => ({ x: NaN, y: 0, z: 0 }) }), o)).toBe(false);
    expect(fxAnchor({ type: 'fx', kind: 'puff', objectId: 'o' }, src({ objectBounds: () => ({ min: { x: NaN, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }) }), o)).toBe(false);
  });
});
