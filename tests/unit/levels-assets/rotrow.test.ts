/** Independent GLB integrity, budgets, floor contact, and design-section 4 inventory checks. */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boundsOf, readGlb, type Glb } from '../models/glbReader';

const ROOT = join(__dirname, '..', '..', '..');
const ASSETS = join(ROOT, 'public', 'assets');
const DIR = join(ASSETS, 'models', 'levels', 'rotrow');
const DOC = readFileSync(join(ROOT, 'docs', 'levels', 'L3-rotrow.md'), 'utf8');

interface Entry {
  id: string; level: string; object: string; variant: string | null; kind: string; file: string; bytes: number;
  sha256: string; triangles: number; size: [number, number, number];
  bounds: { min: [number, number, number]; max: [number, number, number] }; footprint: [number, number];
  budget: number; states: string[];
}

const MANIFEST = JSON.parse(readFileSync(join(ASSETS, 'manifest.rotrow.json'), 'utf8')) as { version: number; models: Entry[] };
const MODELS = MANIFEST.models;
const GLBS = new Map<string, Glb>(MODELS.map((e) => [e.id, readGlb(join(ASSETS, e.file))]));

const section4 = DOC.match(/^## 4\..*?(?=^## |$(?![\s\S]))/ms)?.[0] ?? '';
const requiredObjects = [...section4.matchAll(/^\| `([^`]+)`/gm)].map((m) => m[1]);
const missingObjects = (objects: string[]) => requiredObjects.filter((id) => !objects.includes(id));

describe('L3 Rot Row kit: manifest.rotrow.json', () => {
  it('is versioned, sorted, unique, all rotrow, and every file lives in models/levels/rotrow', () => {
    expect(MANIFEST.version).toBe(1);
    expect(MODELS.length).toBeGreaterThanOrEqual(40);
    const ids = MODELS.map((e) => e.id);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of MODELS) {
      expect(e.level, e.id).toBe('rotrow');
      expect(e.file, e.id).toBe(`models/levels/rotrow/${e.id}.glb`);
    }
  });

  it('bytes + sha256 match the files on disk; no stray or missing GLBs', () => {
    for (const e of MODELS) {
      const buf = readFileSync(join(ASSETS, e.file));
      expect(buf.length, e.id).toBe(e.bytes);
      expect(createHash('sha256').update(buf).digest('hex'), e.id).toBe(e.sha256);
    }
    const files = readdirSync(DIR).filter((f) => statSync(join(DIR, f)).isFile());
    expect(files.sort()).toEqual(MODELS.map((e) => `${e.id}.glb`).sort());
  });

  it('triangles and bounds agree with an independent parse; triangles within budget', () => {
    for (const e of MODELS) {
      const g = GLBS.get(e.id)!;
      expect(g.tris, e.id).toBe(e.triangles);
      expect(e.triangles, `${e.id} over budget`).toBeLessThanOrEqual(e.budget);
      const b = boundsOf(g, ['broken', ...e.states]);
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(b.min[k] - e.bounds.min[k]), `${e.id} min[${k}]`).toBeLessThan(2e-3);
        expect(Math.abs(b.max[k] - e.bounds.max[k]), `${e.id} max[${k}]`).toBeLessThan(2e-3);
        expect(e.size[k], `${e.id} size[${k}]`).toBeGreaterThan(0);
      }
    }
  });

  it('floor items stand on the floor (no sinking or floating) with a footprint of at least one tile', () => {
    for (const e of MODELS.filter((m) => m.kind === 'floor')) {
      expect(Math.abs(e.bounds.min[1]), `${e.id} min y`).toBeLessThan(0.01);
      expect(e.footprint[0] >= 1 && e.footprint[1] >= 1, `${e.id} footprint`).toBe(true);
    }
  });

  it('every modelled object is named in docs/levels/L3-rotrow.md (no undocumented art)', () => {
    const undocumented = [...new Set(MODELS.map((e) => e.object))].filter((o) => !DOC.includes(`\`${o}\``) && !o.startsWith('env_'));
    expect(undocumented).toEqual([]);
  });

  it('covers every section 4 design object and rejects a missing required object', () => {
    expect(requiredObjects).toHaveLength(31);
    expect(new Set(requiredObjects).size).toBe(31);
    const objects = MODELS.map((e) => e.object);
    expect(missingObjects(objects)).toEqual([]);
    for (const id of requiredObjects) {
      expect(missingObjects(objects.filter((object) => object !== id))).toEqual([id]);
    }
  });

  it('stays within a 4 MB download budget for the whole level kit', () => {
    expect(MODELS.reduce((s, e) => s + e.bytes, 0)).toBeLessThan(4 * 1024 * 1024);
  });
});
