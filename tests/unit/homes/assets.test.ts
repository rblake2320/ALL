/**
 * Home exterior shells (tools/blender/homes/build_homes.py) against public/assets/manifest.homes.json, the level
 * docs and the rule in docs/DESIGN_HOMES_SOCIAL_COLLECTIONS.md §8: every home ships an exterior shell GLB with no
 * interior nodes. Budgets <= 6,000 / 2,000 triangles, at most three materials, floor outline and frames (D-043).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const ASSETS = join(ROOT, 'public', 'assets');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const manifest = JSON.parse(readFileSync(join(ASSETS, 'manifest.homes.json'), 'utf8')) as Json;
const shells = manifest.shells as Record<string, Json>;

/** id -> [lot id, level doc, home class, tiles wide, tiles deep]; sizes are the house wall bounds on the lot maps. */
const EXPECTED: Record<string, [string, string, string, number, number]> = {
  shell_starter: ['wormwood:starter', 'L1-wormwood.md', 'starter', 11, 10],
  // the story-start shack is a lot template, not a fixed lot: its `lot` is the template id (W-113, W-025 §1.9)
  shell_derelict: ['derelict', '../systems/story-start.md', 'starter', 8, 6],
  // its variants come from src/sim/world/startTemplates.ts (PR #66); no doc names them yet, so no doc check
  shell_derelict_lean: ['derelict_lean', '', 'starter', 6, 8],
  shell_derelict_lshape: ['derelict_lshape', '', 'starter', 8, 8],
  shell_wormwood_bungalow: ['wormwood:bungalow', 'L1-wormwood.md', 'cottage', 13, 9],
  shell_wormwood_townhouse: ['wormwood:townhouse', 'L1-wormwood.md', 'cottage', 7, 15],
  shell_rotrow_walkup: ['rotrow:walkup_2a', 'L3-rotrow.md', 'apartment', 12, 10],
  shell_rotrow_loft: ['rotrow:loft', 'L3-rotrow.md', 'apartment', 16, 14],
  shell_bayou_shotgun: ['bayou:shotgun', 'L4-bayou.md', 'stilt', 8, 12],
  shell_bayou_acadian: ['bayou:acadian', 'L4-bayou.md', 'stilt', 14, 10],
  shell_bayou_fishcamp: ['bayou:fishcamp', 'L4-bayou.md', 'stilt', 16, 14],
  shell_mausoleum_mansard: ['mausoleum:mansard_manor', 'L5-mausoleum.md', 'mansion', 18, 17],
  shell_mausoleum_ravenspire: ['mausoleum:ravenspire', 'L5-mausoleum.md', 'mansion', 24, 15],
  shell_mausoleum_glass: ['mausoleum:glass_mausoleum', 'L5-mausoleum.md', 'mansion', 20, 14],
};

function readGlb(file: string): { json: Json; data: Buffer } {
  const data = readFileSync(join(ASSETS, file));
  expect(data.readUInt32LE(0)).toBe(0x46546c67);
  return { json: JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString('utf8')) as Json, data };
}
const tris = (json: Json): number =>
  (json.meshes as Json[]).reduce((n, m) => n + (m.primitives as Json[]).reduce((k, p) => k + json.accessors[p.indices].count / 3, 0), 0);

describe('homes manifest', () => {
  it('lists the fourteen home shells, and every file on disk is listed', () => {
    expect(Object.keys(shells).sort()).toEqual(Object.keys(EXPECTED).sort());
    const files = Object.values(shells).flatMap((e) => (e.lods as Json[]).map((l) => (l.file as string).split('/').pop()!));
    expect(readdirSync(join(ASSETS, 'models', 'homes')).sort()).toEqual(files.sort());
    expect(manifest.budget).toEqual({ lod0: 6000, lod1: 2000 });
    expect(manifest.front).toBe('+Z');
  });

  it('covers every home class of the housing spec that has a house (a plot is empty land)', () => {
    const classes = new Set(Object.values(shells).map((e) => e.homeClass as string));
    expect([...classes].sort()).toEqual(['apartment', 'cottage', 'mansion', 'starter', 'stilt']);
  });
});

describe.each(Object.keys(EXPECTED))('%s', (id) => {
  const e = shells[id]!;
  const [lot, doc, homeClass, w, d] = EXPECTED[id]!;
  const lods = e.lods as Json[];
  const glbs = lods.map((l) => readGlb(l.file));

  it('belongs to a lot the level doc defines, on that house\'s wall rectangle', () => {
    expect(e.lot).toBe(lot);
    if (doc) expect(readFileSync(join(ROOT, 'docs', 'levels', doc), 'utf8')).toContain(`\`${lot}\``);
    expect(e.homeClass).toBe(homeClass);
    expect(e.tileFootprint).toEqual({ w, d });
    const { min, max } = e.bounds as { min: number[]; max: number[] };
    // the walls are covered: the shell reaches each side, and the front wall line
    expect(max[0]!).toBeGreaterThanOrEqual(w / 2 - 0.05);
    expect(-min[0]!).toBeGreaterThanOrEqual(w / 2 - 0.05);
    expect(max[2]!).toBeGreaterThanOrEqual(d / 2 - 0.05);
    // and it stays near them: eaves and decks at the sides, porch and steps at the front
    expect(Math.max(max[0]!, -min[0]!)).toBeLessThanOrEqual(w / 2 + 1.8);
    expect(-min[2]!).toBeLessThanOrEqual(d / 2 + 1.8);
    expect(max[2]!).toBeLessThanOrEqual(d / 2 + 6.5);
    expect(min[1]!).toBeGreaterThanOrEqual(-0.002);
    expect(min[1]!).toBeLessThanOrEqual(0.004);
    expect(max[1]!).toBeGreaterThan(4);
  });

  it('files match the manifest and stay inside the budgets', () => {
    expect(lods.map((l) => l.file)).toEqual([`models/homes/${id}.glb`, `models/homes/${id}_lod1.glb`]);
    lods.forEach((l, i) => {
      const { json, data } = glbs[i]!;
      expect(data.length).toBe(l.bytes);
      expect(createHash('sha256').update(data).digest('hex')).toBe(l.sha256);
      expect(tris(json)).toBe(l.triangles);
      expect(l.triangles).toBeLessThanOrEqual(i === 0 ? 6000 : 2000);
      expect(l.triangles).toBeGreaterThan(i === 0 ? 500 : 160);
    });
    expect(lods[1]!.triangles).toBeLessThan(lods[0]!.triangles);
    for (let i = 0; i < 3; i++) {                     // the far level keeps the silhouette
      expect(Math.abs(lods[1]!.bounds.min[i] - lods[0]!.bounds.min[i])).toBeLessThanOrEqual(0.4);
      expect(Math.abs(lods[1]!.bounds.max[i] - lods[0]!.bounds.max[i])).toBeLessThanOrEqual(0.4);
    }
  });

  it('is an exterior only: one node, no interior or room nodes, no skin, no animation', () => {
    expect(e.interior).toBe(false);
    glbs.forEach(({ json }, i) => {
      const names = (json.nodes as Json[]).map((n) => n.name as string);
      expect(names).toEqual([id + (i ? '_lod1' : '')]);
      expect(json.meshes).toHaveLength(1);
      expect(json.skins ?? []).toHaveLength(0);
      expect(json.animations ?? []).toHaveLength(0);
    });
  });

  it('has at most three materials, no textures, and carries its colours per vertex', () => {
    expect(e.materials).toEqual(['Glass', 'Shell']);
    glbs.forEach(({ json }) => {
      const mats = (json.materials as Json[]).map((m) => m.name as string).sort();
      expect(mats.length).toBeLessThanOrEqual(3);
      expect(mats).toContain('Shell');
      expect(json.images ?? []).toHaveLength(0);
      expect(json.textures ?? []).toHaveLength(0);
      const shell = (json.materials as Json[]).find((m) => m.name === 'Shell')!;
      expect(shell.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1]).toEqual([1, 1, 1, 1]);   // white: colour is COLOR_0
      for (const p of json.meshes[0].primitives as Json[]) expect(p.attributes.COLOR_0, 'vertex colours').toBeDefined();
    });
  });

  it('has a floor outline of convex parts and the door, porch and mailbox frames', () => {
    const parts = e.outline as number[][][];
    expect(parts.length).toBeGreaterThanOrEqual(1);
    expect(parts.length).toBeLessThanOrEqual(8);
    for (const h of parts) {
      expect(h.length).toBeGreaterThanOrEqual(3);
      expect(h.reduce((t, p, i) => t + p[0]! * h[(i + 1) % h.length]![1]! - h[(i + 1) % h.length]![0]! * p[1]!, 0)).toBeGreaterThan(0);
    }
    const { min, max } = e.bounds as { min: number[]; max: number[] };
    const pts = parts.flat();
    expect(Math.min(...pts.map((p) => p[0]!))).toBeCloseTo(min[0]!, 2);
    expect(Math.max(...pts.map((p) => p[0]!))).toBeCloseTo(max[0]!, 2);
    expect(Math.max(...pts.map((p) => p[1]!))).toBeCloseTo(max[2]!, 2);
    const f = e.frames as Record<string, { pos: number[]; yaw: number; kind: string }>;
    expect(Object.keys(f).sort()).toEqual(['approach', 'mailbox', 'porch']);
    expect(f.approach!.kind).toBe('approach');
    expect(f.approach!.pos[1]).toBe(0);
    expect(f.approach!.pos[2]!).toBeGreaterThan(max[2]!);          // in front of everything, on the ground
    expect(f.approach!.yaw).toBe(180);                            // facing the house
    expect(f.mailbox!.pos[1]).toBe(0);
    expect(f.mailbox!.pos[2]!).toBeGreaterThan(f.approach!.pos[2]!);   // nearer the street
    expect(f.porch!.pos[2]!).toBeGreaterThan(d / 2);              // outside the front wall
    expect(f.porch!.pos[2]!).toBeLessThan(max[2]!);               // and on the shell
    expect(f.porch!.pos[1]!).toBeGreaterThan(0.1);                // up on the stoop, porch or deck
    expect(f.porch!.pos[0]).toBe((e.doors as Json[])[0]!.x);      // at the front door
    if (homeClass === 'stilt') expect(f.porch!.pos[1]).toBe(2.9);  // the living storey is one storey up
  });
});
