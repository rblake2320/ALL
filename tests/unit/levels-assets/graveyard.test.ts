/**
 * L2 Old Graveyard art kit (tools/blender/levels -> public/assets/models/levels/graveyard + manifest.levels.json).
 *
 * Independent checks (TypeScript GLB reader shared with the objects suite, no Python geometry code):
 *   - the set of design objects in the manifest equals what docs/levels/L2-graveyard.md (+ README §8) lists, parsed
 *     from the doc itself, with per-object variant sets (4 headstones, 3 den species, 17 curios, 4 fish meshes + 2 junk)
 *   - every GLB parses; bytes/sha256/triangles/bounds in the manifest match the files
 *   - triangle budgets from the doc's "Tris" columns / "≤ N tris" notes (else ART_DIRECTION bands)
 *   - feet on the floor, footprints, wall items flush on the wall, carry props with a grip node
 *   - front orientation (+Z): tall parts behind the centre or a named node's surface facing +Z
 *   - dynamic/state nodes present, emissive parts at strength 2..6, no textures, flat colours
 *   - manifest fields agree with the Python spec table (system python3, like the catalog parity test)
 *   - reproducibility (BLENDER_PYTHON set): a fresh headless rebuild is byte-identical to the committed GLBs
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boundsOf, centroidAbove, emissiveStrengths, readGlb, type Glb } from '../models/glbReader';

const ROOT = join(__dirname, '..', '..', '..');
const ASSETS = join(ROOT, 'public', 'assets');
const DIR = join(ASSETS, 'models', 'levels', 'graveyard');
const DOC = readFileSync(join(ROOT, 'docs', 'levels', 'L2-graveyard.md'), 'utf8');
const README = readFileSync(join(ROOT, 'docs', 'levels', 'README.md'), 'utf8');

interface Entry {
  id: string; level: string; object: string; variant: string | null; kind: string; file: string; bytes: number;
  sha256: string; triangles: number; size: [number, number, number];
  bounds: { min: [number, number, number]; max: [number, number, number] }; materials: string[];
  footprint: [number, number]; budget: number; front: string; wallCentre: number | null; parts: string[];
  states: string[]; tags: string[];
}

const MANIFEST = JSON.parse(readFileSync(join(ASSETS, 'manifest.levels.json'), 'utf8')) as { version: number; models: Entry[] };
const MODELS = MANIFEST.models.filter((e) => e.level === 'graveyard');
const BY_OBJECT = new Map<string, Entry[]>();
for (const e of MODELS) BY_OBJECT.set(e.object, [...(BY_OBJECT.get(e.object) ?? []), e]);
const GLBS = new Map<string, Glb>(MODELS.map((e) => [e.id, readGlb(join(ASSETS, e.file))]));

// ───────────────────────────── design-doc parsing ─────────────────────────────

function section(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  if (a < 0) throw new Error(`doc section not found: ${start}`);
  const b = src.indexOf(end, a + start.length);
  return src.slice(a, b < 0 ? undefined : b);
}
const rows = (s: string) => s.split('\n').filter((l) => l.startsWith('| `'));
const cells = (l: string) => l.split('|').slice(1, -1).map((c) => c.trim());
const firstId = (cell: string) => /`([A-Za-z0-9_]+)`/.exec(cell)?.[1] ?? '';
const num = (s: string) => Number(s.replace(/[,\s]/g, ''));

/** §5.1: the 19 new objects with their Tris column. */
const NEW_OBJECTS = new Map<string, number>(
  rows(section(DOC, '### 5.1 New objects', '### 5.2')).map((l) => {
    const c = cells(l);
    return [firstId(c[0]), num(c[c.length - 1])] as const;
  }),
);
/** README §8 shared objects with their "≤ N tris" budgets. */
const SHARED = new Map<string, number>(
  rows(section(README, '## 8. Shared new objects', '## 9.')).map((l) => {
    const c = cells(l);
    const m = /≤\s*([\d,]+)\s*tris/.exec(c[c.length - 1]);
    return [firstId(c[0]), m ? num(m[1]) : NaN] as const;
  }),
);
/** "Also used from README §8: `item_curio`, …" (L2 §5.1 totals line). */
const USED_SHARED = [...(/Also used from README §8:([^\n]+(?:\n[^\n]+)?)/.exec(DOC)?.[1] ?? '').matchAll(/`([a-z_]+)`/g)]
  .map((m) => m[1]).filter((id) => SHARED.has(id));
/** Floor *styles* are procedural textures (src/shared/styles.ts), not meshes. */
const NOT_A_MESH: Record<string, string> = { path_gravel: 'floor style (P-W4 pattern in styles.ts), rendered procedurally' };
/** §4.2 curio ids (14 sellable + 3 key fragments). */
const CURIOS = rows(section(DOC, '### 4.2 Grave goods', '### 4.3')).flatMap((l) =>
  [...cells(l)[0].matchAll(/`(curio_[A-Za-z]+)`/g)].map((m) => m[1]));
const CURIO_BUDGET = num(/Model \(≤\s*([\d,]+)\s*tris\)/.exec(DOC)![1]);
/** §4.3 fish table: species -> shared mesh; junk ids. */
const FISH_ROWS = rows(section(DOC, '### 4.3 Fishing', '### 4.4'));
const FISH_MESHES = new Set(FISH_ROWS.filter((l) => firstId(cells(l)[0]).startsWith('fish_'))
  .map((l) => /^(small|deep|long|eel)\b/.exec(cells(l)[cells(l).length - 1])?.[1]).filter(Boolean) as string[]);
const JUNK = FISH_ROWS.map((l) => firstId(cells(l)[0])).filter((id) => id.startsWith('junk_'));
const FISH_BUDGET = num(/Four shared meshes \(small, deep, long, eel\), each ≤\s*([\d,]+) tris/.exec(README)![1]);
/** §3 new env model. */
const ENV = /`(env_[a-z]+)` \(new env model, ≤\s*([\d,]+) tris/.exec(DOC)!;
/** §13 store tie-ins: the premium set table + the Bones unlock table. */
const S13 = section(DOC, '## 13. Store tie-ins', '## 14.');
const STORE_SET = rows(section(S13, 'Premium themed set', 'Bones unlocks')).map((l) => firstId(cells(l)[0]));
const BONES_UNLOCKS = rows(section(S13, 'Bones unlocks', 'Pet cosmetics')).map((l) => firstId(cells(l)[0]));
/** §9 Night of the Open Gates dressing objects + README P-W22 carry items used by L2 (§4.1/§4.3). */
const EVENT_ITEMS = ['lantern_jack', 'bob_for_brains'];
const CARRY = ['shovel', 'rod'];
const ART_FURNITURE = 3000;

describe('design-doc parity (docs/levels/L2-graveyard.md)', () => {
  it('the doc parses into the expected sets (guards the parser itself)', () => {
    expect(NEW_OBJECTS.size).toBe(19);
    expect(CURIOS).toHaveLength(17);
    expect(new Set(CURIOS).size).toBe(17);
    expect([...FISH_MESHES].sort()).toEqual(['deep', 'eel', 'long', 'small']);
    expect(JUNK.sort()).toEqual(['junk_oldBoot', 'junk_tinCan']);
    expect(STORE_SET).toHaveLength(8);
    expect(BONES_UNLOCKS).toEqual(['tree_willow', 'table_seance', 'plaque_fish']);
    expect(USED_SHARED.sort()).toEqual(['bed_pet', 'board_notice', 'bowl_pet', 'fence_iron', 'gate_iron', 'item_curio',
      'item_fish', 'path_gravel', 'shelf_curio']);
    for (const id of EVENT_ITEMS) expect(DOC).toContain(`\`${id}\``);
    for (const c of CARRY) expect(DOC).toContain(`carry \`${c}\``);
  });

  it('the manifest covers exactly the doc objects (nothing missing, nothing extra)', () => {
    const want = new Set<string>([...NEW_OBJECTS.keys(), ...USED_SHARED.filter((id) => !(id in NOT_A_MESH)), ENV[1],
      ...EVENT_ITEMS, ...STORE_SET, ...BONES_UNLOCKS, ...CARRY]);
    expect([...BY_OBJECT.keys()].sort()).toEqual([...want].sort());
  });

  it('grave_marked has the four headstone variants 0-3; den_stray the three species', () => {
    expect(BY_OBJECT.get('grave_marked')!.map((e) => e.variant).sort()).toEqual(['0', '1', '2', '3']);
    const species = [...(/Variant by species:([^|]+)/.exec(DOC)![1].matchAll(/\((cat|dog|raccoon)\)/g))].map((m) => m[1]);
    expect(BY_OBJECT.get('den_stray')!.map((e) => e.variant).sort()).toEqual(species.sort());
  });

  it('item_curio has one mesh per curio id, named curio_<slug> (README §8)', () => {
    const cur = BY_OBJECT.get('item_curio')!;
    expect(cur.map((e) => e.id).sort()).toEqual([...CURIOS].sort());
    for (const e of cur) expect(e.variant).toBe(e.id);
  });

  it('item_fish has the four shared body meshes + the two junk catches', () => {
    expect(BY_OBJECT.get('item_fish')!.map((e) => e.variant).sort()).toEqual([...FISH_MESHES, ...JUNK].sort());
  });

  it('plaque_fish ships the wood frame and the Bones gold-frame variant (§13)', () => {
    expect(BY_OBJECT.get('plaque_fish')!.map((e) => e.variant).sort()).toEqual(['gold', 'wood']);
  });

  it('respects every triangle budget the docs give (else ART_DIRECTION furniture/large bands)', () => {
    for (const e of MODELS) {
      let cap = ART_FURNITURE;
      if (NEW_OBJECTS.has(e.object)) cap = NEW_OBJECTS.get(e.object)!;
      else if (e.object === 'item_curio') cap = CURIO_BUDGET;
      else if (e.object === 'item_fish') cap = FISH_BUDGET;
      else if (SHARED.has(e.object)) cap = SHARED.get(e.object)!;
      else if (e.object === ENV[1]) cap = num(ENV[2]);
      expect(Number.isFinite(cap), e.id).toBe(true);
      expect(e.triangles, `${e.id} budget ${cap}`).toBeLessThanOrEqual(cap);
      expect(e.budget, `${e.id} manifest budget`).toBeLessThanOrEqual(cap);
    }
  });
});

describe('manifest.levels.json', () => {
  it('is versioned, sorted, and its graveyard entries point at files in models/levels/graveyard', () => {
    expect(MANIFEST.version).toBe(1);
    const keys = MANIFEST.models.map((e) => `${e.level}/${e.id}`);
    expect(keys).toEqual([...keys].sort());
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of MODELS) expect(e.file).toBe(`models/levels/graveyard/${e.id}.glb`);
  });

  it('records bytes + sha256 that match the files on disk, and no stray GLBs exist', () => {
    for (const e of MODELS) {
      const buf = readFileSync(join(ASSETS, e.file));
      expect(buf.length, e.id).toBe(e.bytes);
      expect(createHash('sha256').update(buf).digest('hex'), e.id).toBe(e.sha256);
    }
    const files = readdirSync(DIR).filter((f) => statSync(join(DIR, f)).isFile());
    expect(files.sort()).toEqual(MODELS.map((e) => `${e.id}.glb`).sort());
  });

  it('stays within a 4 MB download budget for the whole level kit', () => {
    expect(MODELS.reduce((s, e) => s + e.bytes, 0)).toBeLessThan(4 * 1024 * 1024);
  });

  it('triangles, bounds and size agree with an independent parse of every GLB', () => {
    for (const e of MODELS) {
      const g = GLBS.get(e.id)!;
      expect(g.tris, e.id).toBe(e.triangles);
      const b = boundsOf(g, ['broken', ...e.states]);
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(b.min[k] - e.bounds.min[k]), `${e.id} min[${k}]`).toBeLessThan(2e-3);
        expect(Math.abs(b.max[k] - e.bounds.max[k]), `${e.id} max[${k}]`).toBeLessThan(2e-3);
        expect(Math.abs(e.size[k] - (e.bounds.max[k] - e.bounds.min[k])), `${e.id} size`).toBeLessThan(2e-3);
      }
    }
  });

  it('matches the Python spec table (kind, footprint, budget, front rule, parts, states)', () => {
    const r = spawnSync('python3', [join(ROOT, 'tools', 'blender', 'levels', 'specs_json.py'), 'graveyard'], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const specs = (JSON.parse(r.stdout) as { specs: Record<string, unknown>[] }).specs;
    expect(specs.map((s) => s.id).sort()).toEqual(MODELS.map((e) => e.id).sort());
    for (const s of specs) {
      const e = MODELS.find((m) => m.id === s.id)!;
      expect(e.object).toBe(s.obj);
      expect(e.kind).toBe(s.kind);
      expect(e.footprint).toEqual([s.w, s.d]);
      expect(e.budget).toBe(s.budget);
      expect(e.front).toBe(s.front);
      expect(e.parts).toEqual([...(s.parts as string[])].sort());
      expect(e.states).toEqual([...(s.states as string[])].sort());
    }
  });
});

// ───────────────────────────── per-model geometry ─────────────────────────────

function facingRatio(g: Glb, name: string): number {
  let front = 0, total = 0;
  for (const n of g.nodes) {
    if (!g.under(n.index, name)) continue;
    const p = n.positions, ix = n.indices;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const area = Math.hypot(nx, ny, nz);
      total += area;
      if (area > 1e-12 && nz / area > 0.5) front += area;
    }
  }
  return total > 0 ? front / total : 0;
}

describe.each(MODELS.map((e) => [e.id, e] as const))('%s', (id, e) => {
  const g = GLBS.get(id)!;
  const b = boundsOf(g, ['broken', ...e.states]);

  it('has every dynamic part and state overlay as a named node', () => {
    for (const p of [...e.parts, ...e.states]) expect(g.byName.has(p), `${id} missing node ${p}`).toBe(true);
  });

  it('uses flat colours only (no images/textures/samplers), and Paint where recolourable', () => {
    const js = g.json as Record<string, unknown>;
    expect(js.images ?? []).toEqual([]);
    expect(js.textures ?? []).toEqual([]);
    for (const m of g.json.materials ?? []) expect(m.name ?? '', id).not.toMatch(/\.\d{3}$/);
    if (e.object === 'item_fish' && !e.variant!.startsWith('junk_')) expect(e.materials).toContain('Paint');
    if (e.object === 'plaque_fish') expect(e.materials).toContain('Paint');
  });

  it('gives emissive parts an emissive material of strength 2..6', () => {
    for (const p of e.parts.filter((x) => ['flame', 'glow', 'bulb', 'screen'].includes(x))) {
      const st = emissiveStrengths(g, p);
      expect(st.length, `${id}:${p}`).toBeGreaterThan(0);
      expect(Math.max(...st), `${id}:${p}`).toBeGreaterThanOrEqual(2);
      expect(Math.max(...st), `${id}:${p}`).toBeLessThanOrEqual(6.01);
    }
  });

  it('stands where it should (feet on the floor / back on the wall / centred on the edge) within its footprint', () => {
    const [w, d] = e.footprint;
    if (e.kind === 'floor' || e.kind === 'item') {
      expect(b.min[1], `${id} lowest point`).toBeGreaterThanOrEqual(-0.012);
      expect(b.min[1], `${id} floating`).toBeLessThanOrEqual(0.02);
      expect(b.min[0]).toBeGreaterThanOrEqual(-w / 2 * 1.15);
      expect(b.max[0]).toBeLessThanOrEqual(w / 2 * 1.15);
      expect(b.min[2]).toBeGreaterThanOrEqual(-d / 2 * 1.15);
      expect(b.max[2]).toBeLessThanOrEqual(d / 2 * 1.15);
    } else if (e.kind === 'wall') {
      expect(b.min[2], `${id} back on the wall plane`).toBeGreaterThanOrEqual(-0.01);
      expect(b.max[2], `${id} depth`).toBeLessThanOrEqual(0.4);
      expect(Math.abs(b.min[0]), id).toBeLessThanOrEqual(0.575);
      expect(Math.abs(b.max[0]), id).toBeLessThanOrEqual(0.575);
      if (e.wallCentre !== null) expect(Math.abs((b.min[1] + b.max[1]) / 2 - e.wallCentre), id).toBeLessThan(0.15);
    } else if (e.kind === 'edge' || e.kind === 'opening') {
      expect(b.min[1]).toBeGreaterThanOrEqual(-0.012);
      expect(b.min[1]).toBeLessThanOrEqual(0.02);
      expect(b.min[0]).toBeGreaterThanOrEqual(-0.56);
      expect(b.max[0]).toBeLessThanOrEqual(0.56);
      expect(Math.abs(b.min[2])).toBeLessThan(0.2);
      expect(Math.abs(b.max[2])).toBeLessThan(0.2);
    } else if (e.kind === 'carry') {
      expect(g.byName.has('grip'), `${id} grip anchor`).toBe(true);
      expect(b.max[1] - b.min[1], `${id} runs along +Y`).toBeGreaterThan(Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]));
    } else if (e.kind === 'env') {
      expect(b.min[1]).toBeGreaterThanOrEqual(-0.02);
      expect(b.max[0] - b.min[0]).toBeLessThanOrEqual(w * 1.3);
      expect(b.max[2] - b.min[2]).toBeLessThanOrEqual(d * 1.3);
    }
  });

  it('faces the front (+Z) per its front rule', () => {
    if (e.front.startsWith('back_tall:')) {
      const c = centroidAbove(g, Number(e.front.split(':')[1]), ['broken', ...e.states]);
      expect(c, id).not.toBeNull();
      expect(c![2], `${id} tall parts behind the centre`).toBeLessThan(-0.05);
    } else if (e.front.startsWith('facing:')) {
      const node = e.front.split(':')[1];
      expect(g.byName.has(node), `${id} has ${node}`).toBe(true);
      expect(facingRatio(g, node), `${id}:${node} faces +Z`).toBeGreaterThanOrEqual(0.7);
    }
  });
});

describe('front rules are not vacuous', () => {
  it('every sign, screen and brand decal in the kit faces +Z', () => {
    let n = 0;
    for (const e of MODELS) {
      const g = GLBS.get(e.id)!;
      for (const name of ['sign', 'screen', 'brand_decal']) {
        if (!g.byName.has(name)) continue;
        n++;
        expect(facingRatio(g, name), `${e.id}:${name}`).toBeGreaterThanOrEqual(0.7);
      }
    }
    expect(n).toBeGreaterThanOrEqual(15);
  });

  it('a mirrored copy of a headstone fails the back_tall rule (the check can fail)', () => {
    const g = GLBS.get('grave_marked_rounded')!;
    const c = centroidAbove(g, 0.45, ['flag'])!;
    expect(-c[2]).toBeGreaterThan(0.05); // flipping Z would put the stone in front
  });

  it('the pond lists six fishing bank stones inside its 7x5 footprint', () => {
    const g = GLBS.get('pond_murky')!;
    const extras = g.json.nodes!.find((nd) => nd.name === 'pond_murky')!.extras as { fishSpots: [number, number][] };
    expect(extras.fishSpots).toHaveLength(6);
    for (const [x, z] of extras.fishSpots) {
      expect(Math.abs(x)).toBeLessThanOrEqual(3.5);
      expect(Math.abs(z)).toBeLessThanOrEqual(2.5);
    }
  });

  it('the tool rack exposes 3 shovels + 3 rods as separately hideable nodes', () => {
    const g = GLBS.get('rack_tools')!;
    for (const k of [0, 1, 2]) {
      expect(g.byName.has(`shovel_${k}`)).toBe(true);
      expect(g.byName.has(`rod_${k}`)).toBe(true);
    }
  });
});

/**
 * Reproducibility (slow: needs headless Blender). Run with:
 *   BLENDER_PYTHON=/home/user/.venvs/blender/bin/python npx vitest run tests/unit/levels-assets
 * The full check is tools/blender/levels/check_repro.sh.
 */
const BLENDER_PY = process.env.BLENDER_PYTHON ?? '';
describe.runIf(BLENDER_PY !== '' && existsSync(BLENDER_PY))('graveyard kit reproducibility (headless Blender)', () => {
  it('rebuilds a cross-section of models byte-identically to the committed GLBs + manifest entries', () => {
    const ids = ['grave_marked_scroll', 'pond_murky', 'vending_gravecola', 'curio_pocketWatch', 'gate_iron', 'env_spire'];
    const r = spawnSync(BLENDER_PY, [join(ROOT, 'tools', 'blender', 'levels', 'build_levels.py'), '--verify', '--only', ids.join(',')],
      { encoding: 'utf8', timeout: 600000 });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stdout).toContain(`verify: ${ids.length}/${ids.length} reproducible`);
  }, 600000);
});
