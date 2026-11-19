/**
 * Decision D-043: every art manifest entry carries generated placement data for free placement — `outline`,
 * the tight floor shape as a list of convex parts, and contact frames (where a character sits, stands, holds on).
 * Produced by tools/blender/manifest_meta.py from the built scene, in glTF axes (X left, Y up, Z front).
 * Winding rule, the same expression the Python side documents: shoelace = sum(x[i]*z[i+1] - x[i+1]*z[i]) > 0.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ASSETS = join(__dirname, '..', '..', '..', 'public', 'assets');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const load = (name: string): Json => JSON.parse(readFileSync(join(ASSETS, name), 'utf8')) as Json;

const pets = load('manifest.pets.json');
const wildlife = load('manifest.wildlife.json');
const vehicles = load('manifest.vehicles.json');
const structures = load('manifest.structures.json');

const shoelace = (poly: number[][]): number =>
  poly.reduce((sum, p, i) => sum + p[0]! * poly[(i + 1) % poly.length]![1]! - poly[(i + 1) % poly.length]![0]! * p[1]!, 0);

/** Every part convex and counter-clockwise (shoelace > 0); together they cover the bounds to within `slack`. */
function expectOutline(parts: number[][][], min: number[], max: number[], slack = 0.012): void {
  expect(parts.length).toBeGreaterThanOrEqual(1);
  const poly = parts.flat();
  let twiceArea = 0;
  for (const part of parts) {
    expect(part.length).toBeGreaterThanOrEqual(3);
    expect(shoelace(part)).toBeGreaterThan(0);
    twiceArea += shoelace(part);
    for (let i = 0; i < part.length; i++) {
      const [x0, z0] = part[i]!;
      const [x1, z1] = part[(i + 1) % part.length]!;
      const [x2, z2] = part[(i + 2) % part.length]!;
      expect((x1! - x0!) * (z2! - z1!) - (z1! - z0!) * (x2! - x1!)).toBeGreaterThan(0);
    }
  }
  const xs = poly.map((p) => p[0]!);
  const zs = poly.map((p) => p[1]!);
  expect(Math.min(...xs)).toBeLessThanOrEqual(min[0]! + slack);
  expect(Math.max(...xs)).toBeGreaterThanOrEqual(max[0]! - slack);
  expect(Math.min(...zs)).toBeLessThanOrEqual(min[2]! + slack);
  expect(Math.max(...zs)).toBeGreaterThanOrEqual(max[2]! - slack);
  // never larger than the bounding box, and a real area
  const box = (max[0]! - min[0]!) * (max[2]! - min[2]!);
  expect(twiceArea / 2).toBeGreaterThan(0);
  expect(twiceArea / 2).toBeLessThanOrEqual(box + 1e-6);
}

function expectFrame(f: Json): void {
  expect(f.pos).toHaveLength(3);
  for (const v of f.pos as number[]) expect(Number.isFinite(v)).toBe(true);
  expect(typeof f.yaw).toBe('number');
  expect(typeof f.kind).toBe('string');
}

describe('pets: footprint + frames', () => {
  it.each(Object.keys(pets.species))('%s', (id) => {
    const e = pets.species[id] as Json;
    expectOutline(e.outline, e.bounds.min, e.bounds.max);
    expect(Object.keys(e.frames).sort()).toEqual(['approach', 'collar', 'mouth', 'pet']);
    Object.values(e.frames).forEach((f) => expectFrame(f as Json));
    // a zombie approaches from the front, outside the animal, facing it
    expect(e.frames.approach.pos[2]).toBeGreaterThan(e.bounds.max[2] + 0.3);
    expect(e.frames.approach.pos[1]).toBe(0);
    expect(e.frames.approach.yaw).toBe(180);
    // head and mouth are on the animal, in its front half, above the floor
    for (const n of ['pet', 'mouth', 'collar']) {
      const p = e.frames[n].pos as number[];
      expect(p[1]!).toBeGreaterThan(0.02);
      expect(p[1]!).toBeLessThanOrEqual(e.bounds.max[1]);
      expect(p[2]!).toBeGreaterThan(0);
      expect(Math.abs(p[0]!)).toBeLessThan(1e-3);
    }
  });
});

describe('wildlife: footprint + perch frame', () => {
  it.each(Object.keys(wildlife.species))('%s', (id) => {
    const e = wildlife.species[id] as Json;
    expectOutline(e.outline, e.bounds.min, e.bounds.max);
    expect(e.frames.feet).toEqual({ pos: [0, 0, 0], yaw: 0, kind: 'feet' });
  });
});

describe('vehicles: footprint + seats, hands, feet, approach', () => {
  it.each(Object.keys(vehicles.vehicles))('%s', (id) => {
    const e = vehicles.vehicles[id] as Json;
    const { min, max } = e.lods[0].bounds as { min: number[]; max: number[] };
    expectOutline(e.outline, min, max);
    const names = Object.keys(e.frames);
    Object.values(e.frames).forEach((f) => expectFrame(f as Json));
    const seats = names.filter((n) => n.startsWith('seat_')).sort();
    expect(seats).toEqual(Array.from({ length: e.seats as number }, (_, i) => `seat_${i}`));
    for (const sName of seats) {
      const p = e.frames[sName].pos as number[];
      expect(e.frames[sName].kind).toBe('seat');
      expect(p[0]! >= min[0]! && p[0]! <= max[0]!).toBe(true);
      expect(p[2]! >= min[2]! && p[2]! <= max[2]!).toBe(true);
      expect(p[1]!).toBeGreaterThan(0.4);
      expect(p[1]!).toBeLessThan(max[1]!);
    }
    // the driver sits on the left (+X) in cars, on the centre line on two-wheelers
    if (e.park === 'car') expect(e.frames.seat_0.pos[0]).toBeGreaterThan(0.2);
    else {
      expect(e.frames.seat_0.pos[0]).toBe(0);
      expect(names).toEqual(expect.arrayContaining(['hand_L', 'hand_R', 'foot_L', 'foot_R']));
      expect(e.frames.hand_L.pos[0]).toBeGreaterThan(0);
      expect(e.frames.hand_R.pos[0]).toBeLessThan(0);
      expect(e.frames.hand_L.pos[2]).toBeGreaterThan(e.frames.seat_0.pos[2]); // bars are ahead of the saddle
    }
    // approach points are on the floor, outside the vehicle
    for (const n of names.filter((x) => e.frames[x].kind === 'approach')) {
      const p = e.frames[n].pos as number[];
      expect(p[1]!).toBe(0);
      expect(p[0]! > max[0]! || p[0]! < min[0]! || p[2]! > max[2]! || p[2]! < min[2]!).toBe(true);
    }
    expect(e.frames.approach.pos[0]).toBeGreaterThan(max[0]!); // you get on / in from the left
    if (e.park === 'car') expect(e.frames.trunk.pos[2]).toBeLessThan(min[2]!); // behind the car
  });
});

describe('field names and the outline code', () => {
  it('no manifest uses `footprint` or `collision`; structures give their grid size as `tileFootprint`', () => {
    const all = [pets.species, wildlife.species, vehicles.vehicles, structures.models] as Json[];
    for (const group of all) {
      for (const [id, e] of Object.entries(group)) {
        expect(Object.keys(e as Json), id).not.toContain('footprint');
        expect(Object.keys(e as Json), id).not.toContain('collision');
        expect(Array.isArray((e as Json).outline[0][0]), id).toBe(true);
      }
    }
    for (const e of Object.values(structures.models as Json)) {
      expect(Object.keys((e as Json).tileFootprint).sort()).toEqual(['d', 'w']);
    }
  });

  it('the outline code passes its own cases: L and U shapes split, narrow gaps and enclosed holes do not', () => {
    const script = join(ASSETS, '..', '..', 'tools', 'blender', 'manifest_meta.py');
    const py = ['python3', 'python'].find((c) => spawnSync(c, ['-c', 'import sys; sys.exit(0)']).status === 0);
    expect(py, 'a system python is needed for this check').toBeDefined();
    const r = spawnSync(py!, [script, '--selftest'], { encoding: 'utf8' });
    expect(r.stdout + r.stderr).toContain('manifest_meta selftest: ok');
    expect(r.status).toBe(0);
  });
});

describe('structures: floor outline, parking spots, stair frames', () => {
  it.each(Object.keys(structures.models))('%s', (id) => {
    const e = structures.models[id] as Json;
    expectOutline(e.outline, e.bounds.min, e.bounds.max);
    if (e.vertical) {
      expectFrame(e.frames.bottom);
      expectFrame(e.frames.top);
      expect(e.frames.bottom.pos).toEqual([0, 0, -(e.vertical.run / 2 + 0.5)]);
      expect(e.frames.top.pos).toEqual([0, e.vertical.rise, e.vertical.run / 2 + 0.5]);
    }
  });

  it('parking objects carry the spots of docs/systems/vehicles.md §5', () => {
    const count = (id: string, size: string): number =>
      (structures.models[id].parking.spots as Json[]).filter((s) => s.size === size).length;
    // driveway and garage marker: 1 car OR 2 small
    for (const id of ['pad_driveway', 'pad_garage']) {
      expect(count(id, 'car')).toBe(1);
      expect(count(id, 'small')).toBe(2);
      expect(structures.models[id].parking.options).toEqual([[0], [1, 2]]);
    }
    // carport: 1 car + 1 small; bike rack: 2 small
    expect([count('carport_crooked', 'car'), count('carport_crooked', 'small')]).toEqual([1, 1]);
    expect(structures.models.carport_crooked.parking.options).toEqual([[0, 1]]);
    expect([count('rack_bike', 'car'), count('rack_bike', 'small')]).toEqual([0, 2]);
    expect(structures.models.pad_driveway.parking.needsStreetAccess).toBe(true);
    expect(structures.models.carport_crooked.parking.needsStreetAccess).toBe(true);
    expect(structures.models.door_garage.parking).toBeUndefined();
    // spots of one option never overlap each other
    const half = { car: [1.0, 2.5], small: [0.5, 1.0] } as Record<string, number[]>;
    for (const id of ['pad_driveway', 'pad_garage', 'carport_crooked', 'rack_bike']) {
      const p = structures.models[id].parking as Json;
      for (const option of p.options as number[][]) {
        for (let a = 0; a < option.length; a++) {
          for (let b = a + 1; b < option.length; b++) {
            const [A, B] = [p.spots[option[a]!] as Json, p.spots[option[b]!] as Json];
            const ext = (s: Json): number[] => (s.rot % 180 === 90 ? [half[s.size]![1]!, half[s.size]![0]!] : half[s.size]!);
            const overlapX = Math.abs(A.x - B.x) < ext(A)[0]! + ext(B)[0]! - 1e-6;
            const overlapZ = Math.abs(A.z - B.z) < ext(A)[1]! + ext(B)[1]! - 1e-6;
            // the bike rack parks two bikes side by side closer than a full "small" box; everything else must be clear
            if (id !== 'rack_bike') expect(overlapX && overlapZ).toBe(false);
          }
        }
      }
    }
  });
});
