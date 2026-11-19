/**
 * Where a home shell stands on its lot (`lotRect` in public/assets/manifest.homes.json) and how it moves under an S7
 * plan transform (W-025 S7, `transformStartTemplate`: an X mirror of the LOT, x -> 30 - x, then a tile shift).
 *
 * A shell is authored centred on its house's wall rectangle (tests in assets.test.ts); `lotRect` says where that
 * rectangle is on the 30 x 30 lot map, so the shell can be stood exactly on the house the game builds from the same
 * map. Checked against the engine's own templates (src/sim/spatial/templates, and src/sim/world/startTemplates.ts where
 * it exists), the level docs' lot maps, and the S7 generator where it exists.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEdge } from '../../../src/sim/spatial/edges';
import { createLotTemplate } from '../../../src/sim/spatial/templates';

const ROOT = join(__dirname, '..', '..', '..');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const manifest = JSON.parse(readFileSync(join(ROOT, 'public', 'assets', 'manifest.homes.json'), 'utf8')) as Json;
const shells = manifest.shells as Record<string, Json>;

const LOT_W = 30;
const SIDEWALK_Z = 28;

interface Rect {
  x0: number;
  z0: number;
  w: number;
  d: number;
}
interface Plan {
  mirrored: boolean;
  dx: number;
  dz: number;
}
interface Placed {
  /** lot x of the shell's origin (the house centre) */
  cx: number;
  /** lot z of the shell's origin */
  cz: number;
  /** lot z of the front wall */
  frontZ: number;
  /** multiply shell-local x by this (−1 when mirrored) */
  sx: 1 | -1;
}

/**
 * The contract for placing a shell on a lot built with plan transform `t` (what src/render/world/regionVisuals.ts
 * must do): the house centre is mirrored about the LOT's middle (x = 15), not about itself, then shifted.
 */
function shellPlacement(r: Rect, t: Plan): Placed {
  const centre = r.x0 + r.w / 2;
  return { cx: (t.mirrored ? LOT_W - centre : centre) + t.dx, cz: r.z0 + r.d / 2 + t.dz, frontZ: r.z0 + r.d + t.dz, sx: t.mirrored ? -1 : 1 };
}

/** The wall rectangle the engine's transform produces (startGenerator.ts `edge`: x -> W - x - (h ? 1 : 0), then + dx). */
function transformedRect(r: Rect, t: Plan): Rect {
  return { x0: (t.mirrored ? LOT_W - (r.x0 + r.w) : r.x0) + t.dx, z0: r.z0 + t.dz, w: r.w, d: r.d };
}

/** Every S7 transform the generator may draw: |dx| ≤ 3, −2 ≤ dz ≤ 1, mirrored or not (56). */
const PLANS: Plan[] = [];
for (const mirrored of [false, true]) for (let dx = -3; dx <= 3; dx++) for (let dz = -2; dz <= 1; dz++) PLANS.push({ mirrored, dx, dz });

interface TemplateLike {
  lot: { walls: Record<string, unknown> };
  objects: { defId: string; placement: { kind: string; edge?: string } }[];
}

/** Wall rectangle and front-door centres (lot x) of an engine template. */
function templateRect(t: TemplateLike): { rect: Rect; doors: number[] } {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const key of Object.keys(t.lot.walls)) {
    const e = parseEdge(key)!;
    if (e.kind === 'h') { x0 = Math.min(x0, e.x); x1 = Math.max(x1, e.x + 1); z0 = Math.min(z0, e.z); z1 = Math.max(z1, e.z); }
    else { x0 = Math.min(x0, e.x); x1 = Math.max(x1, e.x); z0 = Math.min(z0, e.z); z1 = Math.max(z1, e.z + 1); }
  }
  const doors = t.objects
    .filter((o) => o.placement.kind === 'opening' && o.defId.startsWith('door'))
    .map((o) => parseEdge(o.placement.edge!)!)
    .filter((e) => e.kind === 'h' && e.z === z1)
    .map((e) => e.x + 0.5)
    .sort((a, b) => a - b);
  return { rect: { x0, z0, w: x1 - x0, d: z1 - z0 }, doors };
}

/**
 * Wall rectangle and front-door centres from a level doc's ASCII lot map: tile columns under the digit header,
 * `|`/`W`/`D` between columns are vertical walls, `+`/`-`/`D`/`W` on the lines between rows are horizontal walls.
 */
function docRect(level: string, template: string): { rect: Rect; doors: number[] } {
  const text = readFileSync(join(ROOT, 'docs', 'levels', level), 'utf8');
  const at = text.indexOf(`(\`${template}\`)`);
  expect(at, `${level} has a section for ${template}`).toBeGreaterThan(0);
  const start = text.indexOf('```', at);
  const end = text.indexOf('```', start + 3);
  const lines = text.slice(start + 3, end).split('\n');
  const head = lines.find((l) => l.includes('tens:'))!;
  const tens = /tens:\s*(\d+)/.exec(head)![1]!;
  const digits = head.split('(')[0]!;
  let firstCol = -1, firstX = 0, k = 0;
  for (let i = 0; i < digits.length; i++) {
    if (!/\d/.test(digits[i]!)) continue;
    if (firstCol < 0) { firstCol = i; firstX = Number(tens[0]) * 10 + Number(digits[i]); }
    k++;
  }
  const wx = new Set<number>(), wz = new Set<number>(), doors: [number, number][] = [];
  let z: number | null = null;
  for (const l of lines) {
    const mz = /^z(\d\d)\s/.exec(l);
    if (mz) {
      z = Number(mz[1]);
      for (let i = firstCol - 1; i < l.length; i++) if ('|WD'.includes(l[i]!)) { wx.add(firstX + (i + 1 - firstCol) / 2); wz.add(z); wz.add(z + 1); }
    } else if (l.includes('+') && z !== null) {
      for (let i = firstCol - 1; i < l.length; i++) if ('+-DW'.includes(l[i]!)) {
        wz.add(z + 1);
        wx.add(firstX + (i - firstCol) / 2);
        if (l[i] === 'D') doors.push([firstX + (i - firstCol) / 2, z + 1]);
      }
    }
  }
  const xs = [...wx].filter(Number.isInteger), zs = [...wz];
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  return { rect: { x0, z0, w: x1 - x0, d: z1 - z0 }, doors: doors.filter((d) => d[1] === z1).map((d) => d[0] + 0.5).sort((a, b) => a - b) };
}

/** Door centres of a lot map or template, as the manifest states them: x offset from the house centre, merged double doors. */
function doorOffsets(rect: Rect, lotX: number[]): number[] {
  const centre = rect.x0 + rect.w / 2;
  const out: number[] = [];
  for (const x of lotX) {
    const off = x - centre;
    if (out.length && Math.abs(out[out.length - 1]! - (off - 1)) < 1e-9) out[out.length - 1] = off - 0.5;   // two door tiles side by side = one double door
    else out.push(off);
  }
  return out;
}

/** shell id -> [level doc with its lot map ('' = engine only), start template id ('' = not a start template)] */
const SOURCES: Record<string, [string, string]> = {
  shell_starter: ['', 'starter'],
  shell_derelict: ['', 'derelict'],
  shell_derelict_lean: ['', 'derelict_lean'],
  shell_derelict_lshape: ['', 'derelict_lshape'],
  shell_wormwood_bungalow: ['L1-wormwood.md', 'wormwood_bungalow'],
  shell_wormwood_townhouse: ['L1-wormwood.md', 'wormwood_townhouse'],
  shell_rotrow_walkup: ['L3-rotrow.md', ''],
  shell_rotrow_loft: ['L3-rotrow.md', ''],
  shell_bayou_shotgun: ['L4-bayou.md', ''],
  shell_bayou_acadian: ['L4-bayou.md', ''],
  shell_bayou_fishcamp: ['L4-bayou.md', ''],
  shell_mausoleum_mansard: ['L5-mausoleum.md', ''],
  shell_mausoleum_ravenspire: ['L5-mausoleum.md', ''],
  shell_mausoleum_glass: ['L5-mausoleum.md', ''],
};

// The S7 start templates and generator live in src/sim/world (PR #66, on the integration branch). Where they exist
// the engine itself is the oracle; where they do not, the two engine templates in src/sim/spatial/templates are.
const START_FILE = join(ROOT, 'src', 'sim', 'world', 'startTemplates.ts');
const GEN_FILE = join(ROOT, 'src', 'sim', 'world', 'startGenerator.ts');
const startMod = existsSync(START_FILE) ? ((await import(/* @vite-ignore */ '../../../src/sim/world/' + 'startTemplates')) as Json) : null;
const genMod = existsSync(GEN_FILE) ? ((await import(/* @vite-ignore */ '../../../src/sim/world/' + 'startGenerator')) as Json) : null;

function engineTemplate(templateId: string): TemplateLike | null {
  if (templateId === 'starter' || templateId === 'derelict') return createLotTemplate(templateId) as unknown as TemplateLike;
  if (startMod) return startMod.createStartTemplate(templateId) as TemplateLike;
  return null;
}

describe('home shell lot rectangles', () => {
  it('every shell has one, the size of its tile footprint, inside the buildable lot', () => {
    for (const [id, e] of Object.entries(shells)) {
      const r = e.lotRect as Rect;
      expect(r, id).toBeDefined();
      expect([r.x0, r.z0, r.w, r.d].every(Number.isInteger), id).toBe(true);
      expect({ w: r.w, d: r.d }, id).toEqual(e.tileFootprint);
      expect(r.x0, id).toBeGreaterThanOrEqual(1);
      expect(r.x0 + r.w, id).toBeLessThanOrEqual(LOT_W - 1);
      expect(r.z0, id).toBeGreaterThanOrEqual(1);
      expect(r.z0 + r.d, id).toBeLessThanOrEqual(SIDEWALK_Z - 1);              // front yard between the house and the sidewalk
      for (const dd of e.doors as { x: number; z: number }[]) expect(dd.z, `${id} door on the front wall`).toBe(r.d / 2);
    }
    expect(Object.keys(shells).sort()).toEqual(Object.keys(SOURCES).sort());
  });

  describe.each(Object.keys(SOURCES))('%s', (id) => {
    const e = shells[id]!;
    const rect = e.lotRect as Rect;
    const manifestDoors = (e.doors as { x: number }[]).map((dd) => dd.x);
    const [level, templateId] = SOURCES[id]!;

    it.skipIf(!level)('is the house on the level doc\'s lot map, doors included', () => {
      const d = docRect(level, (e.template as string));
      expect(d.rect).toEqual(rect);
      expect(doorOffsets(d.rect, d.doors)).toEqual(manifestDoors);
    });

    const tpl = templateId ? engineTemplate(templateId) : null;
    it.skipIf(!tpl)('is the house the engine builds from its template, doors included', () => {
      const t = templateRect(tpl!);
      expect(t.rect).toEqual(rect);
      expect(doorOffsets(t.rect, t.doors)).toEqual(manifestDoors);
    });

    it.skipIf(!templateId)('stands on the transformed house under every S7 plan transform, and stays on the lot', () => {
      const { min, max } = e.bounds as { min: number[]; max: number[] };
      const f = e.frames as Record<string, { pos: number[] }>;
      for (const t of PLANS) {
        const p = shellPlacement(rect, t);
        const want = transformedRect(rect, t);
        // the shell's walls (±w/2 about its origin, front at +d/2) cover exactly the transformed wall rectangle
        expect(p.cx - rect.w / 2, JSON.stringify(t)).toBe(want.x0);
        expect(p.cx + rect.w / 2).toBe(want.x0 + want.w);
        expect(p.frontZ).toBe(want.z0 + want.d);
        expect(p.cz - rect.d / 2).toBe(want.z0);
        // the front doors land on the transformed front wall, inside it
        for (const dx of manifestDoors) {
          const lotX = p.cx + p.sx * dx;
          expect(lotX).toBeGreaterThan(want.x0);
          expect(lotX).toBeLessThan(want.x0 + want.w);
        }
        // eaves, porch and steps stay on the lot; nothing reaches the sidewalk
        const xs = [p.cx + p.sx * min[0]!, p.cx + p.sx * max[0]!];
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...xs)).toBeLessThanOrEqual(LOT_W);
        expect(p.cz + min[2]!).toBeGreaterThanOrEqual(0);
        expect(p.cz + max[2]!).toBeLessThan(SIDEWALK_Z);
        expect(p.cz + f.mailbox!.pos[2]!).toBeLessThan(SIDEWALK_Z);
      }
    });

    it.skipIf(!templateId || !genMod || !startMod)('matches the S7 generator\'s own transform for every plan', () => {
      const original = startMod!.createStartTemplate(templateId) as TemplateLike;
      const registry = genMod!.transformStartTemplate.length >= 2 ? { objects: new Proxy({}, { get: () => ({ footprint: { w: 1, d: 1 } }) }) } : undefined;
      for (const t of PLANS) {
        const moved = genMod!.transformStartTemplate(original, registry, t.mirrored, t.dx, t.dz) as TemplateLike;
        expect(templateRect(moved).rect, JSON.stringify(t)).toEqual(transformedRect(rect, t));
      }
    });
  });
});
