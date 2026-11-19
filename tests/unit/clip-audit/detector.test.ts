/**
 * CLIP-AUDIT detector on synthetic solids: known penetrations, known floats and clean fits must read exactly, and
 * the adversarial cases (thin boards with no vertex inside, single-sided sheets, inverted normals, overlapping
 * shells, mirroring transforms, scaled scenes, stray vertices) must not fool it.
 */
import { describe, expect, it } from 'vitest';
import { contactGap, lowestY, makeSolid, penetration } from '../../../tools/clip-audit/detect';
import {
  TriBvh, closestOnTri, mergeMeshes, orientOutward, transformMesh, type TriMesh,
} from '../../../tools/clip-audit/geometry';
import { boxMesh, labelled, sheetMesh, sphereMesh } from '../../../tools/clip-audit/shapes';
import { THRESHOLDS, penVerdict } from '../../../tools/clip-audit/thresholds';

const MM = 1000;

/** Deterministic LCG in [0,1). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function scale(m: TriMesh, k: number): TriMesh {
  return transformMesh(m, [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1]);
}

describe('winding number + orientation repair', () => {
  it('reads 1 inside and 0 outside closed boxes and spheres', () => {
    const b = new TriBvh(boxMesh([0, 0, 0], [1, 1, 1]));
    expect(b.winding(0.5, 0.5, 0.5)).toBeCloseTo(1, 6);
    expect(b.winding(0.999, 0.001, 0.5)).toBeCloseTo(1, 4);
    expect(Math.abs(b.winding(1.01, 0.5, 0.5))).toBeLessThan(1e-3);
    expect(Math.abs(b.winding(5, 5, 5))).toBeLessThan(1e-3);
    const s = new TriBvh(sphereMesh([0, 0, 0], 0.3, 's', 32, 20));
    expect(s.winding(0, 0, 0)).toBeGreaterThan(0.95);
    expect(s.winding(0.25, 0, 0)).toBeGreaterThan(0.9);
    expect(Math.abs(s.winding(0.35, 0, 0))).toBeLessThan(0.05);
  });

  it('repairs inside-out components (inverted normals) without touching correct ones', () => {
    const inv = orientOutward(mergeMeshes([boxMesh([0, 0, 0], [1, 1, 1], 'a', true), boxMesh([2, 0, 0], [3, 1, 1], 'b')]));
    expect(inv.components).toBe(2);
    expect(inv.flipped).toBe(1);
    const b = new TriBvh(inv.mesh);
    expect(b.winding(0.5, 0.5, 0.5)).toBeCloseTo(1, 6);
    expect(b.winding(2.5, 0.5, 0.5)).toBeCloseTo(1, 6);
  });

  it('keeps outward winding under a mirroring transform', () => {
    const m = transformMesh(boxMesh([0, 0, 0], [1, 1, 1]), [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(new TriBvh(m).winding(-0.5, 0.5, 0.5)).toBeCloseTo(1, 6);
  });

  it('treats an open-bottomed box (furniture without a base) as solid away from the opening', () => {
    const b = new TriBvh(orientOutward(boxMesh([0, 0, 0], [1, 1, 1], 'o', false, true)).mesh);
    expect(b.winding(0.5, 0.8, 0.5)).toBeGreaterThan(0.5);
    expect(b.winding(0.5, 1.2, 0.5)).toBeLessThan(0.5);
  });

  it('closest point agrees with brute force on random queries', () => {
    const m = mergeMeshes([sphereMesh([0, 0.5, 0], 0.3), boxMesh([0.4, 0, -0.2], [0.9, 0.3, 0.2])]);
    const bvh = new TriBvh(m);
    const r = rng(7);
    const tmp = new Float64Array(5);
    for (let k = 0; k < 200; k++) {
      const x = r() * 2 - 0.6, y = r() * 1.2 - 0.1, z = r() * 1.2 - 0.6;
      let best = Infinity;
      for (let t = 0; t < m.tri.length; t += 3) {
        closestOnTri(m.pos, m.tri[t] * 3, m.tri[t + 1] * 3, m.tri[t + 2] * 3, x, y, z, tmp);
        best = Math.min(best, Math.sqrt(tmp[3]));
      }
      expect(bvh.closest(x, y, z).d).toBeCloseTo(best, 9);
    }
  });

  it('raycasts both triangle sides', () => {
    const b = new TriBvh(boxMesh([0, 0, 0], [1, 1, 1]));
    expect(b.raycast(0.5, 2, 0.5, 0, -1, 0)).toBeCloseTo(1, 9);
    expect(b.raycast(0.5, 0.5, 0.5, 0, -1, 0)).toBeCloseTo(0.5, 9);
    expect(b.raycast(5, 2, 0.5, 0, -1, 0)).toBe(Infinity);
  });
});

describe('penetration depth', () => {
  const seat = boxMesh([-0.25, 0, -0.25], [0.25, 0.46, 0.25], 'seat');

  it('measures a known sink exactly (sphere 60 mm into a box top)', () => {
    const ball = makeSolid(sphereMesh([0, 0.46 + 0.1 - 0.06, 0], 0.1, 'pelvis', 48, 32));
    const p = penetration(ball, makeSolid(seat));
    expect(p.maxDepthMm).toBeGreaterThan(57);
    expect(p.maxDepthMm).toBeLessThan(61);
    expect(p.worstPart).toBe('pelvis');
    expect(penVerdict(p.maxDepthMm)).toBe('FAIL');
  });

  it('passes a clean fit: resting on the surface reads ~0 depth and ~0 gap', () => {
    const ball = makeSolid(sphereMesh([0, 0.46 + 0.1, 0], 0.1, 'pelvis', 48, 32));
    const s = makeSolid(seat);
    const p = penetration(ball, s);
    expect(p.maxDepthMm).toBeLessThan(1);
    expect(penVerdict(p.maxDepthMm)).toBe('PASS');
    expect(Math.abs(contactGap(ball, s, () => true).gapMm)).toBeLessThan(1);
  });

  it('measures a float: 50 mm above the seat is a 50 mm gap and no penetration', () => {
    const ball = makeSolid(sphereMesh([0, 0.46 + 0.1 + 0.05, 0], 0.1, 'pelvis', 48, 32));
    const s = makeSolid(seat);
    expect(penetration(ball, s).maxDepthMm).toBe(0);
    const g = contactGap(ball, s, () => true);
    expect(g.gapMm).toBeGreaterThan(49);
    expect(g.gapMm).toBeLessThan(51);
    expect(g.gapMm > THRESHOLDS.floatFailMm).toBe(true);
  });

  it('reports a negative gap equal to the depth when the contact interpenetrates', () => {
    const ball = makeSolid(sphereMesh([0, 0.46 + 0.1 - 0.03, 0], 0.1, 'pelvis', 48, 32));
    const g = contactGap(ball, makeSolid(seat), () => true);
    expect(g.gapMm).toBeLessThan(-28);
    expect(g.gapMm).toBeGreaterThan(-31);
  });

  it('catches a THIN board through a limb even though no limb vertex is inside the board', () => {
    // coarse limb (vertex rings 2.6 cm apart) and a 4 mm board between two rings
    const limb = sphereMesh([0, 0.5, 0], 0.08, 'shin_L', 16, 12);
    const ys = new Set<number>();
    for (let i = 1; i < limb.pos.length; i += 3) ys.add(Math.round(limb.pos[i] * 1e4) / 1e4);
    const sorted = [...ys].sort((a, b) => a - b);
    const mid = sorted.findIndex((y) => y >= 0.5);
    const y0 = (sorted[mid - 1] + sorted[mid]) / 2;
    const board = makeSolid(boxMesh([-0.3, y0 - 0.002, -0.3], [0.3, y0 + 0.002, 0.3], 'shelf'));
    const L = makeSolid(limb);
    const p = penetration(L, board);
    expect(p.aInside).toBe(0);
    expect(p.maxDepthMm).toBeGreaterThan(60);
    expect(p.worstPart).toBe('shin_L');
    // the vertex-only direction alone would have missed it
    expect(penetration(L, board, { oneWay: true }).maxDepthMm).toBe(0);
  });

  it('catches a single-sided sheet (zero thickness) cutting through a body part', () => {
    const p = penetration(makeSolid(sphereMesh([0, 0.5, 0], 0.1, 'chest', 32, 20)), makeSolid(sheetMesh(-0.5, 0.5, -0.5, 0.5, 0.52)));
    // the sheet's centre is 100 - 20 = 80 mm from the (polygonal) sphere surface
    expect(p.maxDepthMm).toBeGreaterThan(75);
    expect(p.maxDepthMm).toBeLessThanOrEqual(80);
  });

  it('is immune to inverted object normals', () => {
    const ball = makeSolid(sphereMesh([0, 0.5, 0], 0.1, 'pelvis', 48, 32));
    const a = penetration(ball, makeSolid(seat));
    const b = penetration(ball, makeSolid(boxMesh([-0.25, 0, -0.25], [0.25, 0.46, 0.25], 'seat', true)));
    expect(b.maxDepthMm).toBeCloseTo(a.maxDepthMm, 3);
    expect(b.aInside).toBe(a.aInside);
  });

  it('sees through overlapping shells (cushion sunk into its frame) and measures depth to the VISIBLE surface', () => {
    // frame box + a cushion box overlapping it: the frame's top face is buried inside the cushion
    const frame = boxMesh([-0.3, 0, -0.3], [0.3, 0.3, 0.3], 'frame');
    const cushion = boxMesh([-0.25, 0.25, -0.25], [0.25, 0.46, 0.25], 'cushion');
    const knee = makeSolid(sphereMesh([0, 0.33, 0], 0.03, 'thigh_L', 24, 16));
    const visible = makeSolid(mergeMeshes([frame, cushion]), { visible: true });
    const p = penetration(knee, visible);
    expect(p.aInside).toBe(p.aTested);
    // deepest knee point y = 0.30 -> 160 mm under the cushion top; 50 mm from the cushion side walls (x/z = 0.25)
    // is nearer: the visible-surface depth of the knee bottom is min(160, 50 + ...) -> > 100 for the core
    expect(p.maxDepthMm).toBeGreaterThan(100);
    // naive closest-surface depth would stop at the buried frame top (y = 0.30): <= 60 mm
    const naive = penetration(knee, makeSolid(mergeMeshes([frame, cushion])));
    expect(naive.maxDepthMm).toBeLessThanOrEqual(60);
  });

  it('scales: the same scene at 2x reads 2x deeper', () => {
    const ballM = sphereMesh([0, 0.5, 0], 0.1, 'pelvis', 48, 32);
    const a = penetration(makeSolid(ballM), makeSolid(seat)).maxDepthMm;
    const b = penetration(makeSolid(scale(ballM, 2)), makeSolid(scale(seat, 2))).maxDepthMm;
    expect(b / a).toBeGreaterThan(1.97);
    expect(b / a).toBeLessThan(2.03);
  });

  it('ignores a stray vertex (fewer than minInsideSamples) but not a real part', () => {
    // a fingertip box whose 4 bottom corners sit 5 mm inside the seat (>= minInsideSamples): a real contact
    const tip = boxMesh([0.2, 0.455, -0.01], [0.24, 0.47, 0.01], 'hand_R');
    // a single stray vertex 60 mm inside: noise (an unwelded vertex, a hair card tip), not a penetrating part
    const one = { pos: Float64Array.from([0.1, 0.4, 0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1]), tri: Uint32Array.from([0, 1, 2]), vLabel: new Int32Array(3), labels: ['hair'] };
    const p = penetration(makeSolid(one, false), makeSolid(seat), { oneWay: true });
    expect(p.aInside).toBe(1);
    expect(p.maxDepthMm).toBe(0);
    expect(p.worstPart).toBeNull();
    const q = penetration(makeSolid(tip), makeSolid(seat), { oneWay: true });
    expect(q.worstPart).toBe('hand_R');
  });

  it('labels the worst part by inside count across both directions', () => {
    const body = mergeMeshes([labelled(sphereMesh([0, 0.44, 0], 0.08), 'pelvis'), labelled(sphereMesh([0.2, 0.47, 0], 0.03), 'hand_R')]);
    const p = penetration(makeSolid(body), makeSolid(seat));
    expect(p.worstPart).toBe('pelvis');
    expect(p.byPart.hand_R.inside).toBeGreaterThan(0);
  });

  it('finds the lowest point per label set (feet vs floor)', () => {
    const body = mergeMeshes([labelled(boxMesh([-0.1, -0.012, 0], [0, 0.1, 0.2]), 'foot_L'), labelled(boxMesh([0, 0.03, 0], [0.1, 0.1, 0.2]), 'foot_R')]);
    const s = makeSolid(body);
    expect(lowestY(s, (l) => l === 'foot_R').y * MM).toBeCloseTo(30, 6);
    expect(lowestY(s, () => true).label).toBe('foot_L');
  });

  it('is deterministic (identical results on repeated runs)', () => {
    const run = () => JSON.stringify(penetration(makeSolid(sphereMesh([0.1, 0.5, 0.05], 0.1, 'p', 40, 24)), makeSolid(seat)));
    expect(run()).toBe(run());
  });
});
