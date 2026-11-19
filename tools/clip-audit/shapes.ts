/**
 * Synthetic solids for the detector's self-tests and calibration: boxes, UV spheres, single-sided sheets, all as
 * labelled triangle soups with outward (CCW) winding unless `inverted`.
 */
import type { TriMesh } from './geometry';

type V3 = [number, number, number];

export function boxMesh(min: V3, max: V3, label = 'box', inverted = false, openBottom = false): TriMesh {
  const pos = new Float64Array(24);
  for (let i = 0; i < 8; i++) {
    pos[i * 3] = i & 1 ? max[0] : min[0];
    pos[i * 3 + 1] = i & 2 ? max[1] : min[1];
    pos[i * 3 + 2] = i & 4 ? max[2] : min[2];
  }
  // outward CCW faces (-z, +z, -y, +y, -x, +x)
  const faces = [
    [0, 2, 1, 1, 2, 3],
    [4, 5, 6, 5, 7, 6],
    [0, 1, 4, 1, 5, 4],
    [2, 6, 3, 3, 6, 7],
    [0, 4, 2, 2, 4, 6],
    [1, 3, 5, 3, 7, 5],
  ];
  const tri: number[] = [];
  faces.forEach((f, k) => {
    if (openBottom && k === 2) return;
    tri.push(...f);
  });
  if (inverted) for (let t = 0; t < tri.length; t += 3) [tri[t + 1], tri[t + 2]] = [tri[t + 2], tri[t + 1]];
  return { pos, tri: Uint32Array.from(tri), vLabel: new Int32Array(8), labels: [label] };
}

export function sphereMesh(c: V3, r: number, label = 'sphere', seg = 24, ring = 16, inverted = false): TriMesh {
  const pos: number[] = [];
  for (let j = 0; j <= ring; j++) {
    const th = (j / ring) * Math.PI;
    for (let i = 0; i < seg; i++) {
      const ph = (i / seg) * Math.PI * 2;
      pos.push(c[0] + r * Math.sin(th) * Math.cos(ph), c[1] + r * Math.cos(th), c[2] + r * Math.sin(th) * Math.sin(ph));
    }
  }
  const tri: number[] = [];
  for (let j = 0; j < ring; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * seg + i;
      const b = j * seg + ((i + 1) % seg);
      const cc = (j + 1) * seg + i;
      const d = (j + 1) * seg + ((i + 1) % seg);
      // outward: theta grows downward, phi grows toward +z from +x
      if (j > 0) tri.push(a, b, cc);
      if (j < ring - 1) tri.push(b, d, cc);
    }
  }
  if (inverted) for (let t = 0; t < tri.length; t += 3) [tri[t + 1], tri[t + 2]] = [tri[t + 2], tri[t + 1]];
  return { pos: Float64Array.from(pos), tri: Uint32Array.from(tri), vLabel: new Int32Array(pos.length / 3), labels: [label] };
}

/** Single-sided horizontal sheet at height y (zero thickness, open). */
export function sheetMesh(x0: number, x1: number, z0: number, z1: number, y: number, label = 'sheet'): TriMesh {
  const pos = Float64Array.from([x0, y, z0, x1, y, z0, x0, y, z1, x1, y, z1]);
  return { pos, tri: Uint32Array.from([0, 2, 1, 1, 2, 3]), vLabel: new Int32Array(4), labels: [label] };
}

/** Relabel every vertex of a soup. */
export function labelled(m: TriMesh, label: string): TriMesh {
  return { pos: m.pos, tri: m.tri, vLabel: new Int32Array(m.pos.length / 3), labels: [label] };
}
